import { monitoringWatchSupport } from '../sdk/trigger-points.ts'
import { buildRegionCompactionTask, applyRegionCompaction, regionCompactionCandidates } from './region-compaction.ts'
import { createHash } from 'node:crypto'
import { freezeMonitoringData } from '../sdk/diagnostics.ts'
import { parseMonitoringJsonData } from '../sdk/schema.ts'
import { createMonitoringModelRouter, parseMonitoringModelConfiguration, type MonitoringModelHost, type MonitoringBoundModelProfile, type MonitoringModelBackend, type MonitoringModelRequest } from '../sdk/models.ts'
import { observationEvents, parseObservationFrame, type ObservationFrame } from '../host/frames.ts'
import { MonitoringCore, type Grants, type JudgeQuestion, type JudgeTask, type Json, type Reference } from './monitoring-core.ts'
import { RealtimeMonitoringCoordinator, type RealtimeSignal, type RealtimeLease, type RealtimePrepared, type RealtimeDependency, type RealtimeLimits } from './monitoring-core-realtime.ts'
import { RealtimeMaterialWindow, type RealtimeMaterial, type MaterialWindowOptions } from './monitoring-core-realtime-material.ts'
import type { WindowProjectionSource } from './monitoring-core-source-projection.ts'
import type { InputProjectionBatch } from './monitoring-core-input-projection.ts'

export type RealtimeWatchModule = Readonly<{ id: string; watchEvents: readonly string[]; /** task154: conditional trigger points of this module (deterministic frame predicate); needs an independent per-module pipeline. */ trigger?: (frame: Readonly<{ sourceEvent: string; payload: unknown }>) => boolean; /** task154: purpose-scoped region compaction (declaration need `region.compact`): before the judgement, Jev keeps only the between-region items this module's purpose needs. */ compactRegion?: boolean; referenceKinds: readonly string[]; grants: Grants; question: JudgeQuestion; destination: string; includeCurrentMaterial?: boolean; /** Opt-in (declaration `needs` adapter `judge.view`): the packet carries the exact judge view so a module job can run its own follow-up Jev matching (Stage 2 decisions ②/③). */ includeJudgeView?: boolean }>
export type RealtimeInputProjection = Readonly<{
  evidenceId: string; contractId: string
  sourceVersion(id: string): string | undefined
  capture(options: Readonly<{ input: RealtimeSignal; window: RealtimeMaterialWindow; modules: readonly RealtimeWatchModule[]; referenceKinds: readonly string[]; evidenceRevision: RealtimeDependency; contractRevision: RealtimeDependency }>): WindowProjectionSource
}>
export type RealtimeSelectionPacket = Readonly<{ moduleId: string; destination: string; requestId: string; eventId: string; scopeId: string; profileId: string; profileFingerprint: string; evidenceRefs: readonly string[]; materials: readonly RealtimeMaterial[]; projectionVersion?: string; view?: Json }>
export type RealtimeSelectionLimits = { maxRequests: number; maxConcurrentRequests: number; maxModules: number; maxViewBytes: number; maxOutputBytes: number; maxTrace: number; coreTimeoutMs: number }
export type RealtimeSelectionOptions = Readonly<{ enabled?: boolean; /** task154 judgement trace sink (monitoring-trace/v1): `judgement` and terminal `selection` rows; never changes outcomes. */ trace?: (row: Readonly<Record<string, unknown> & { type: string }>) => void; /** Opt-in: judge only material observed up to the judged frame (no later events) and drop repeated identical items. */ frameBoundedMaterial?: boolean; /** With frameBoundedMaterial: keep only the newest N other observation items in the judge view. */ frameTailItems?: number; /** Opt-in: list the ids of THIS frame's own items in the judged event payload (metadata only) so the judge can tell the current event from context. */ currentInPayload?: boolean; window: RealtimeMaterialWindow; modules: readonly RealtimeWatchModule[]; modelConfig: unknown; modelHost: MonitoringModelHost; goal: string; isPermitted(moduleId: string, input: RealtimeSignal): boolean; inputProjection?: RealtimeInputProjection; limits?: Partial<RealtimeSelectionLimits> }>
type Work = { input: RealtimeSignal; lease: RealtimeLease; dependency: RealtimeDependency; materials: readonly RealtimeMaterial[]; currentIds: readonly string[]; metadataDependencies: readonly RealtimeDependency[]; projection?: WindowProjectionSource; prepared: Map<string, InputProjectionBatch>; packets: RealtimeSelectionPacket[]; physical: Set<Promise<unknown>> }
const defaults: RealtimeSelectionLimits = { maxRequests: 64, maxConcurrentRequests: 4, maxModules: 8, maxViewBytes: 65536, maxOutputBytes: 49152, maxTrace: 256, coreTimeoutMs: 10000 }
const data = <T>(value: T): T => freezeMonitoringData(parseMonitoringJsonData(value) as T)
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200

/** Reuses existing Core judgement/read/receipt and admitted native model protocols. No worker/effect or model discovery is implemented here. */
export class RealtimeSelectionBridge {
  readonly limits: Readonly<RealtimeSelectionLimits>
  private readonly options: RealtimeSelectionOptions
  private readonly projection?: RealtimeInputProjection
  private readonly modules: readonly RealtimeWatchModule[]
  private readonly profiles = new Map<string, MonitoringBoundModelProfile>()
  private readonly models: ReturnType<typeof createMonitoringModelRouter>
  private readonly core: MonitoringCore
  private readonly jobs = new Map<string, Work>()
  private readonly seen = new Set<string>()
  private readonly published = new Map<string, readonly string[]>()
  private readonly pending = new Set<Promise<RealtimePrepared | undefined>>()
  private readonly records: Array<Readonly<{ frameId: string; status: string; moduleId?: string; mode?: string }>> = []
  private disposed = false
  private requests = 0
  private traceEvicted = 0

  constructor(options: RealtimeSelectionOptions) {
    this.limits = Object.freeze({ ...defaults, ...options.limits })
    if (Object.values(this.limits).some(n => !Number.isSafeInteger(n) || n < 1) || this.limits.coreTimeoutMs > 2147483647 || this.limits.maxRequests * this.limits.maxModules > Number.MAX_SAFE_INTEGER) throw new Error('invalid selection limits')
    if (!options.window || typeof options.isPermitted !== 'function' || typeof options.goal !== 'string' || options.goal.length > 8192) throw new Error('explicit selection host ports required')
    // task154: `trigger` is a host-code predicate (not data); it is held aside while the rest is validated as plain data.
    if (!Array.isArray(options.modules) || options.modules.some(m => m?.trigger !== undefined && typeof m.trigger !== 'function')) throw new Error('invalid selection modules')
    const triggers = new Map(options.modules.map(m => [m?.id, m?.trigger]))
    this.modules = Object.freeze((data(options.modules.map(m => { const { trigger: _trigger, ...rest } = m; return rest })) as RealtimeWatchModule[]).map(m => triggers.get(m.id) ? Object.freeze({ ...m, trigger: triggers.get(m.id) }) : m))
    if (!Array.isArray(this.modules) || !this.modules.length || this.modules.length > this.limits.maxModules || new Set(this.modules.map(m => m.id)).size !== this.modules.length) throw new Error('invalid selection modules')
    // task154 independence rule: a conditional trigger is enforced at admission of THIS module's own pipeline; a batched
    // multi-module bridge would still judge the module on every frame of the hook, so it is refused.
    if (this.modules.length > 1 && this.modules.some(m => m.trigger)) throw new Error('conditional trigger points require independent per-module pipelines')
    if (options.inputProjection !== undefined) {
      const port = options.inputProjection
      if (!port || !text(port.evidenceId) || !text(port.contractId) || port.evidenceId === port.contractId || [port.evidenceId, port.contractId].some(id => /^(event|material|window):/.test(id) || options.window.sourceVersion(id) !== undefined) || typeof port.sourceVersion !== 'function' || typeof port.capture !== 'function') throw new Error('invalid selection projection ports')
      this.projection = Object.freeze({ evidenceId: port.evidenceId, contractId: port.contractId, sourceVersion: port.sourceVersion.bind(port), capture: port.capture.bind(port) })
      if ([this.projection.evidenceId, this.projection.contractId].some(id => !text(this.projection!.sourceVersion(id)))) throw new Error('selection metadata version unavailable')
    }
    const config = parseMonitoringModelConfiguration(options.modelConfig)
    this.models = createMonitoringModelRouter(config, this.projection ? this.guardedModelHost(options.modelHost) : options.modelHost)
    this.options = Object.freeze({ ...options, enabled: options.enabled === true, modules: this.modules, modelConfig: config, limits: this.limits })
    this.core = new MonitoringCore({
      limits: { maxEvents: this.limits.maxRequests, maxJudgeBatches: this.limits.maxRequests, maxExecutions: this.limits.maxRequests * this.modules.length, maxConcurrent: 2, maxQueued: this.limits.maxRequests, maxReads: options.window.limits.maxSources, maxProposals: 1, timeoutMs: this.limits.coreTimeoutMs },
      judgeBatch: (tasks, signal) => this.judge(tasks, signal),
      readReference: async (ref, context) => { const job = this.jobs.get(context.scopeId); if (!job || !this.current(job)) throw new Error('selection scope/source changed'); return this.options.window.read(ref) },
      sink: (request, coreCurrent, signal) => {
        const job = this.jobs.get(request.scopeId)
        if (!job || signal.aborted || !coreCurrent() || !this.current(job, request.processorId)) return { requestId: request.requestId, status: 'rejected', reason: 'selection scope/grant/source changed' }
        const packet = data(request.payload) as unknown as RealtimeSelectionPacket
        if (packet.moduleId !== request.processorId || packet.eventId !== request.eventId || packet.scopeId !== request.scopeId || packet.requestId !== request.requestId) return { requestId: request.requestId, status: 'rejected', reason: 'selection identity mismatch' }
        job.packets.push(packet)
        return { requestId: request.requestId, status: 'recorded', recordId: `selection:${hash(request.requestId)}` }
      },
    })
    try {
      if (Object.keys(config.judgeProfiles ?? {}).some(id => !this.modules.some(m => m.id === id))) throw new Error('unknown module judge route')
      for (const module of this.modules) {
        if (Object.keys(module).some(k => !['id', 'watchEvents', 'referenceKinds', 'grants', 'question', 'destination', 'includeCurrentMaterial', 'includeJudgeView', 'trigger', 'compactRegion'].includes(k)) || (module.compactRegion !== undefined && typeof module.compactRegion !== 'boolean') || (module.trigger !== undefined && typeof module.trigger !== 'function') || (module.includeCurrentMaterial !== undefined && typeof module.includeCurrentMaterial !== 'boolean') || !text(module.destination) || !Array.isArray(module.watchEvents) || !module.watchEvents.length || module.watchEvents.some((e: string) => !(observationEvents as readonly string[]).includes(e) || monitoringWatchSupport(e) !== 'watchable') || !Array.isArray(module.referenceKinds) || module.referenceKinds.some((k: string) => !options.window.accepts(k))) throw new Error('invalid module material declaration')
        if (module.includeJudgeView !== undefined && typeof module.includeJudgeView !== 'boolean') throw new Error('invalid module judge-view request')
        const route = config.judgeProfiles?.[module.id] ?? config.defaultJudgeProfile
        if (!route) throw new Error('explicit classifier route required')
        const profile = this.models.resolveProfile(route, 'judge')
        if (profile.kind !== 'native-classifier') throw new Error('purpose-built native classifier required; general worker/JSON judgement is not admitted here')
        this.profiles.set(module.id, profile)
        this.core.registerProcessor({ id: module.id, eventKinds: module.watchEvents, referenceKinds: module.referenceKinds, allowedActions: ['monitoring.selected-material'], question: module.question,
          run: async ({ view, decision, signal, readReference }) => {
            const job = this.jobs.get(view.context.scopeId)
            if (!job || !this.current(job, module.id)) throw new Error('selection scope/grant/source changed')
            // Opt-in: a run decision always carries this frame's own admitted current material (the trigger source), so the
            // judge does not have to re-select it; referenced documents still come only from the judge's selection.
            const auto = module.includeCurrentMaterial === true ? job.currentIds.filter(id => view.context.references.some(r => r.id === id)) : []
            const ids = [...new Set([...auto, ...decision.evidenceRefs.filter(id => id !== view.eventRef)])]
            if (!ids.length || !ids.some(id => job.currentIds.includes(id))) { this.note(job.input, 'no_selected_current_material', module.id); throw new Error('no selected current material') }
            const selected = ids
            const references = await Promise.all(selected.map(id => readReference(id)))
            if (!this.current(job, module.id)) throw new Error('selection changed while reading')
            const materials = references.map(ref => { const material = job.materials.find(m => m.id === ref.id && m.version === ref.version && m.content === ref.content); if (!material) throw new Error('selected source mismatch'); return material })
            const requestId = JSON.stringify([view.context.scopeId, view.context.version, view.event.id, module.id, 0])
            let projectionVersion: string | undefined
            if (job.projection) {
              const batch = job.prepared.get(module.id)
              if (!batch) throw new Error('prepared projection missing')
              const guarded = batch.checkRunEvidence(module.id, decision, references)
              if (!guarded.eligible) { this.note(job.input, 'required_evidence_rejected', module.id); throw new Error('required evidence not checked') }
              projectionVersion = batch.projections.find(p => p.processorId === module.id)?.projectionVersion
              if (!text(projectionVersion)) throw new Error('prepared projection version unavailable')
            }
            const packet: RealtimeSelectionPacket = { moduleId: module.id, destination: module.destination, requestId, eventId: view.event.id, scopeId: view.context.scopeId, profileId: profile.id, profileFingerprint: profile.fingerprint, evidenceRefs: decision.evidenceRefs.filter(id => id === view.eventRef || selected.includes(id)), materials, ...(projectionVersion ? { projectionVersion } : {}), ...(module.includeJudgeView === true ? { view: data(view) as unknown as Json } : {}) }
            return [{ kind: 'monitoring.selected-material', payload: data(packet) as unknown as Json, evidenceRefs: [view.eventRef, ...references.map(r => r.id)] }]
          },
        }, module.grants)
      }
      if (this.options.enabled) this.core.start()
    } catch { this.core.dispose(); this.models.dispose(); throw new Error('selection module/profile admission rejected') }
  }

  get projectionDependencyCount() { return this.projection ? 2 : 0 }
  readonly sourceVersion = (id: string): string | undefined => {
    const material = this.options.window.sourceVersion(id)
    if (!this.projection || ![this.projection.evidenceId, this.projection.contractId].includes(id)) return material
    if (material !== undefined) throw new Error('selection projection dependency collision')
    const version = this.projection.sourceVersion(id)
    return text(version) ? version : undefined
  }
  private metadataDependencies(): readonly RealtimeDependency[] {
    if (!this.projection) return []
    return data([this.projection.evidenceId, this.projection.contractId].map(id => { const version = this.sourceVersion(id); if (!version) throw new Error('selection metadata version unavailable'); return { id, version } }))
  }
  /** Read-only dispatch fence. Router still owns validation, estimate, reservation and raw drain. */
  private guardedModelHost(host: MonitoringModelHost): MonitoringModelHost {
    const backends: Record<string, MonitoringModelBackend> = {}
    for (const [id, backend] of Object.entries(host.backends)) backends[id] = { ...backend,
      estimate: (request, profile) => { this.assertDispatch(request, profile); return backend.estimate.call(backend, request, profile) },
      invoke: (request, context) => { this.assertDispatch(request, context.profile); return backend.invoke.call(backend, request, context) },
    }
    return { ...host, backends }
  }
  private assertDispatch(request: MonitoringModelRequest, profile: MonitoringBoundModelProfile) {
    const tasks = (request.body as any)?.state?.tasks
    if (request.kind !== 'native-classifier' || !Array.isArray(tasks) || !tasks.length) throw new Error('selection dispatch scope unavailable')
    for (const task of tasks) {
      const job = this.jobs.get(task?.view?.context?.scopeId), batch = job?.prepared.get(task?.processorId)
      if (!job || !batch || !this.current(job, task.processorId) || this.profiles.get(task.processorId)?.fingerprint !== profile.fingerprint || JSON.stringify(batch.request) !== JSON.stringify(request)) throw new Error('selection dispatch no longer current')
    }
  }
  private matching(input: RealtimeSignal) { return this.modules.filter(m => m.watchEvents.includes(input.frame.sourceEvent) && (!m.trigger || triggered(m, input))) }
  private permitted(id: string, input: RealtimeSignal) { try { return this.options.isPermitted(id, input) === true } catch { return false } }
  private signalKey(input: RealtimeSignal) { return hash([input.frame.sessionId, input.frame.binding, input.epoch, input.generation, input.frame.id]) }
  canPrepare(input: RealtimeSignal): boolean {
    if (this.disposed || this.options.enabled !== true) return false
    const published = this.published.get(this.signalKey(input))
    return published ? published.every(id => this.permitted(id, input)) : this.matching(input).some(m => this.permitted(m.id, input))
  }
  private snapshot(input: RealtimeSignal) {
    const kinds = [...new Set(this.matching(input).filter(m => this.permitted(m.id, input)).flatMap(m => [...m.referenceKinds]))]
    return this.options.window.snapshot(input.frame.id, kinds, this.options.frameBoundedMaterial === true ? { boundToFrame: true, dedupe: true, ...(this.options.frameTailItems !== undefined ? { tailItems: this.options.frameTailItems } : {}) } : undefined)
  }
  dependencies(input: RealtimeSignal): readonly RealtimeDependency[] {
    const snapshot = this.snapshot(input)
    return data([snapshot.dependency, ...snapshot.materials.map(r => ({ id: r.id, version: r.version })), ...this.metadataDependencies()])
  }
  readonly prepare = (input: RealtimeSignal, lease: RealtimeLease): Promise<RealtimePrepared | undefined> => {
    const operation = this.perform(input, lease); this.pending.add(operation)
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation))
    return operation
  }
  private async perform(input: RealtimeSignal, lease: RealtimeLease): Promise<RealtimePrepared | undefined> {
    if (!this.canPrepare(input) || lease.signal.aborted || !lease.isCurrent()) { this.note(input, 'scope_or_permission_unavailable'); return }
    const key = this.signalKey(input)
    if (this.seen.has(key)) { this.note(input, 'duplicate'); return }
    if (this.requests >= this.limits.maxRequests || this.jobs.size >= this.limits.maxConcurrentRequests) { this.note(input, 'request_limit'); return }
    this.seen.add(key); this.requests++
    const snapshot = this.snapshot(input)
    if (!snapshot.available || !snapshot.currentIds.length || !snapshot.materials.length) { this.note(input, 'material_unavailable'); return }
    // task154 purpose-scoped region compaction (input preparation, not the judgement; user-confirmed option A): for a
    // single-module pipeline whose module declares `region.compact`, Jev first keeps only the between-region items THIS
    // module's purpose needs (verbatim; [memo]/[state]/[omitted] head lines always stay). A failed compaction keeps the
    // window's own newest-first region. Kept originals also feed the module memo.
    let materials = snapshot.materials, compactTexts: string[] = []
    const compactor = this.modules.length === 1 && this.modules[0]!.compactRegion === true ? this.modules[0]! : undefined
    if (compactor) {
      const region = regionCompactionCandidates(materials)
      if (region.length > 1) {
        const task = buildRegionCompactionTask({ module: compactor, materials, key, request: this.requests, dependency: snapshot.dependency, frame: input.frame, goal: this.options.goal })
        try {
          const out = await this.models.judgeBatch([task], lease.signal)
          const applied = applyRegionCompaction(materials, out[compactor.id]?.evidenceRefs ?? [])
          materials = applied.materials
          compactTexts = applied.compactTexts
          this.note(input, 'region_compacted', compactor.id)
        } catch { this.note(input, 'region_compaction_failed', compactor.id) }
        if (lease.signal.aborted || !lease.isCurrent()) { this.note(input, 'scope_or_permission_unavailable'); return }
      }
    }
    let metadataDependencies: readonly RealtimeDependency[], projection: WindowProjectionSource | undefined
    try {
      metadataDependencies = this.metadataDependencies()
      if (this.projection) {
        if (!lease.isCurrent() || lease.signal.aborted) throw new Error('projection lease changed')
        projection = this.projection.capture(Object.freeze({ input, window: this.options.window, modules: Object.freeze(this.matching(input).filter(m => this.permitted(m.id, input))), referenceKinds: Object.freeze([...new Set(snapshot.materials.map(m => m.kind))]), evidenceRevision: metadataDependencies[0], contractRevision: metadataDependencies[1] }))
        const expected = [snapshot.dependency, ...snapshot.materials.map(m => ({ id: m.id, version: m.version })), ...metadataDependencies]
        const actual = data(projection.dependencies)
        if (projection.frameId !== input.frame.id || typeof projection.project !== 'function' || typeof projection.binding !== 'function' || !Array.isArray(actual) || actual.length !== expected.length || new Set(actual.map(d => d.id)).size !== expected.length || actual.some(d => !expected.some(e => e.id === d.id && e.version === d.version)) || projection.host.evidenceRevision.id !== metadataDependencies[0].id || projection.host.evidenceRevision.version !== metadataDependencies[0].version || projection.host.contractRevision.id !== metadataDependencies[1].id || projection.host.contractRevision.version !== metadataDependencies[1].version || !lease.isCurrent() || lease.signal.aborted || metadataDependencies.some(d => this.sourceVersion(d.id) !== d.version)) throw new Error('projection snapshot changed')
      }
    } catch { this.note(input, 'projection_capture_rejected'); return }
    const scopeId = `selection:${hash([key, this.requests])}`, references = materials.map(({ id, kind, version, content }) => ({ id, kind, version, content }))
    const version = this.projection ? hash([snapshot.dependency, references, metadataDependencies]) : hash([snapshot.dependency, references])
    const context = { scopeId, version, goal: this.options.goal, references }
    if (bytes(context) > this.limits.maxViewBytes) { this.note(input, 'view_limit'); return }
    const job: Work = { input, lease, dependency: snapshot.dependency, materials, currentIds: snapshot.currentIds.filter(id => materials.some(m => m.id === id)), metadataDependencies, projection, prepared: new Map(), packets: [], physical: new Set() }
    this.jobs.set(scopeId, job)
    try {
      this.core.setContext(context)
      // Event payload is metadata ONLY. All source bodies must pass the per-module reference grants.
      const report = await this.core.acceptEvent({ id: input.frame.id, kind: input.frame.sourceEvent, scopeId, contextVersion: version, sequence: input.frame.cursor, payload: { sourceEvent: input.frame.sourceEvent, ...(this.options.currentInPayload === true ? { currentReferenceIds: [...job.currentIds] } : {}) } })
      for (const outcome of report.outcomes) this.note(input, outcome.status, outcome.processorId, outcome.decision?.mode)
      await Promise.allSettled([...job.physical])
      // task154: a completed judgement (any decision) moves THIS module window's region start; selected originals become its memo.
      if (report.outcomes.some(o => o.decision?.mode !== undefined)) this.options.window.markJudged(input.frame.id, [...compactTexts, ...job.packets.flatMap(p => p.materials.filter(m => ['conversation-history', 'user-text', 'assistant-text'].includes(m.kind)).map(m => String((m as any).text ?? m.content)))])
      { const isReg = (m: RealtimeMaterial) => { try { return m.kind === 'conversation-history' && JSON.parse(m.content)?.region === true } catch { return false } }; this.emit({ type: 'judgement', frameId: input.frame.id, sourceEvent: input.frame.sourceEvent, cursor: input.frame.cursor, sessionId: input.frame.sessionId, moduleIds: this.matching(input).map(m => m.id), input: { materials: materials.map(m => ({ id: m.id, kind: m.kind, bytes: bytes(m.content) })), regionItems: materials.filter(isReg).length, omitted: materials.some(m => /^\[omitted /.test(m.text)), compactionKept: compactTexts.length, ...(compactor ? { compactionCandidates: snapshot.materials.filter(isReg).length } : {}) }, outcomes: report.outcomes.map(o => ({ moduleId: o.processorId, status: o.status, mode: o.decision?.mode })), evidence: job.packets.map(p => ({ moduleId: p.moduleId, ids: p.materials.map(m => m.id) })), bodies: materials.map(m => ({ id: m.id, text: m.text })) }) }
      if (!this.current(job)) return
      const packets = job.packets.filter(p => this.current(job, p.moduleId))
      if (!packets.length) return
      const payload = data({ kind: 'monitoring.selected-material-batch', eventId: input.frame.id, epoch: input.epoch, generation: input.generation, packets })
      if (bytes(payload) > this.limits.maxOutputBytes) { this.note(input, 'batch_limit'); return }
      this.published.set(key, data(packets.map(p => p.moduleId)))
      return { channel: 'module', payload: payload as unknown as Json, dependencies: data([snapshot.dependency, ...snapshot.materials.map(r => ({ id: r.id, version: r.version })), ...job.metadataDependencies]) }
    } catch { this.note(input, 'core_or_material_rejected') }
    finally {
      // A must retain its raw preparation slot even when the nested core timed out logically.
      await Promise.allSettled([...job.physical])
      this.jobs.delete(scopeId)
    }
  }
  private current(job: Work, moduleId?: string): boolean {
    if (this.disposed || job.lease.signal.aborted || !job.lease.isCurrent() || !this.options.window.getStatus().available || this.options.window.sourceVersion(job.dependency.id) !== job.dependency.version || job.materials.some(r => this.options.window.sourceVersion(r.id) !== r.version)) return false
    try { if (job.metadataDependencies.some(d => this.sourceVersion(d.id) !== d.version)) return false } catch { return false }
    return moduleId === undefined || this.permitted(moduleId, job.input)
  }
  private judge(tasks: readonly JudgeTask[], signal: AbortSignal) {
    const admitted = tasks.filter(task => {
      const job = this.jobs.get(task.view.context.scopeId)
      const ok = !!job && this.current(job, task.processorId) && job.currentIds.some(id => task.view.context.references.some(r => r.id === id))
      if (!ok && job) this.note(job.input, 'material_or_permission_not_visible', task.processorId)
      return ok
    })
    if (!admitted.length) return Promise.resolve({})
    const jobs = [...new Set(admitted.map(t => this.jobs.get(t.view.context.scopeId)!))]
    const prepare = this.projection ? (group: readonly JudgeTask[]) => {
      const owners = [...new Set(group.map(task => this.jobs.get(task.view.context.scopeId)))]
      const job = owners.length === 1 ? owners[0] : undefined
      if (!job?.projection || group.some(task => !this.current(job, task.processorId))) throw new Error('selection projection owner unavailable')
      const batch = job.projection.project(group, job.lease)
      for (const projection of batch.projections) job.prepared.set(projection.processorId, batch)
      return batch.request ? { tasks: batch.tasks, request: batch.request } : { tasks: batch.tasks }
    } : undefined
    const work = this.models.judgeBatch(admitted, AbortSignal.any([signal, ...jobs.map(j => j.lease.signal)]), prepare)
    for (const job of jobs) job.physical.add(work)
    void work.then(() => { for (const job of jobs) job.physical.delete(work) }, () => { for (const job of jobs) job.physical.delete(work) })
    return work
  }
  private note(input: RealtimeSignal, status: string, moduleId?: string, mode?: string) {
    this.records.push(Object.freeze({ frameId: input.frame.id, status, ...(moduleId ? { moduleId } : {}), ...(mode ? { mode } : {}) }))
    if (TRACED_SELECTION.has(status)) this.emit({ type: 'selection', frameId: input.frame.id, sourceEvent: input.frame.sourceEvent, status, ...(moduleId ? { moduleId } : { moduleIds: this.modules.map(m => m.id) }) })
    if (this.records.length > this.limits.maxTrace) { this.records.shift(); this.traceEvicted++ }
  }
  private emit(row: Readonly<Record<string, unknown> & { type: string }>) { try { this.options.trace?.(row) } catch { /* tracing never changes outcomes */ } }
  get traces() { return Object.freeze([...this.records]) }
  getStatus() { return data({ disposed: this.disposed, requests: this.requests, active: this.jobs.size, traceEvicted: this.traceEvicted, core: this.core.getStatus(), models: this.models.getStatus(), profiles: [...this.profiles].map(([moduleId, p]) => ({ moduleId, id: p.id, kind: p.kind, fingerprint: p.fingerprint })) }) }
  async idle() { while (this.pending.size) await Promise.allSettled([...this.pending]); await this.models.idle() }
  dispose() { if (this.disposed) return; this.disposed = true; this.core.dispose(); this.models.dispose() }
}

const TRACED_SELECTION = new Set(['material_unavailable', 'request_limit', 'view_limit', 'duplicate', 'scope_or_permission_unavailable', 'projection_capture_rejected', 'core_or_material_rejected', 'batch_limit', 'region_compaction_failed', 'no_selected_current_material', 'required_evidence_rejected'])
function triggered(m: RealtimeWatchModule, input: RealtimeSignal): boolean { try { return m.trigger!(input.frame) === true } catch { return false } }
/**
 * One selection pipeline (window + bridge + coordinator). Host-neutral (ADR 0062): a host adapter hands every observed
 * frame to `accept` in order; `halt` fails the pipeline closed when the host loses its frame sequence.
 */
export function createRealtimeSelectionPipeline(options: { enabled?: boolean; material: MaterialWindowOptions; selection: Omit<RealtimeSelectionOptions, 'enabled' | 'window'>; realtimeLimits?: Partial<RealtimeLimits> }) {
  const enabled = options.enabled === true
  const window = new RealtimeMaterialWindow({ ...options.material, enabled, metaEvents: [...new Set(options.selection.modules.flatMap(m => [...m.watchEvents]))] })
  let selection: RealtimeSelectionBridge
  try { selection = new RealtimeSelectionBridge({ ...options.selection, enabled, window }) } catch (error) { window.dispose(); throw error }
  let coordinator: RealtimeMonitoringCoordinator
  try {
    coordinator = new RealtimeMonitoringCoordinator({ enabled, ...(options.selection.trace ? { onTrace: (r: Record<string, unknown>) => options.selection.trace!({ type: 'delivery', moduleIds: options.selection.modules.map(m => m.id), ...r }) } : {}), watchEvents: [...new Set(options.selection.modules.flatMap(m => [...m.watchEvents]))], isPermitted: input => selection.canPrepare(input), dependencies: input => selection.dependencies(input), sourceVersion: selection.sourceVersion, prepare: selection.prepare, limits: { maxDependencies: window.limits.maxSources + 1 + selection.projectionDependencyCount, ...options.realtimeLimits } })
    if (coordinator.limits.maxDependencies < window.limits.maxSources + 1 + selection.projectionDependencyCount) throw new Error('realtime dependency ceiling is below admitted material scope')
  } catch (error) { selection.dispose(); window.dispose(); throw error }
  const skip = (state: string, frame: ObservationFrame) => state === 'stopped' || state === 'disposed' || (state === 'idle' && frame.sourceEvent !== 'session_start')
  const accept = (frame: ObservationFrame, readProgress?: () => unknown): void => {
    if (!enabled) return
    try { frame = parseObservationFrame(frame) } catch { window.stop(); coordinator.stop('malformed'); return }
    const ws = window.getStatus().state
    if (!skip(ws, frame)) { try { if (ws === 'idle') window.start({ sessionId: frame.sessionId, binding: frame.binding, afterCursor: frame.cursor - 1 }); window.capture(frame, coordinator.getStatus().step, readProgress) } catch { window.stop() } }
    const cs = coordinator.getStatus().state
    if (!skip(cs, frame)) { try { if (cs === 'idle') coordinator.start({ sessionId: frame.sessionId, binding: frame.binding, afterCursor: frame.cursor - 1 }); coordinator.accept(frame) } catch { coordinator.stop('missing_source_frame') } }
  }
  const halt = (reason = 'missing_source_frame') => { window.stop(); coordinator.stop(reason) }
  const dispose = () => { let failed = false; for (const close of [() => coordinator.dispose(), () => window.dispose(), () => selection.dispose()]) { try { close() } catch { failed = true } } if (failed) throw new Error('selection pipeline cleanup failed') }
  return Object.freeze({ window, selection, coordinator, accept, halt,
    advanceIntent() { window.advanceIntent(); coordinator.advanceIntent() },
    async idle() { await coordinator.idle(); await selection.idle() }, dispose,
  })
}

/**
 * task154 default composition: modules decide and trigger INDEPENDENTLY. One pipeline per module, each with its own
 * material window (own budget), coordinator (own admission and trigger condition), selection bridge and judge requests,
 * so one module's size, failure or timing never changes another module's input or outcome. Frames are fanned out.
 */
export function createIndependentSelectionPipelines(options: Parameters<typeof createRealtimeSelectionPipeline>[0]) {
  const modules = options.selection.modules
  if (!modules.length || new Set(modules.map(m => m.id)).size !== modules.length) throw new Error('unique modules required')
  const pipelines: Array<ReturnType<typeof createRealtimeSelectionPipeline>> = []
  try { for (const module of modules) pipelines.push(createRealtimeSelectionPipeline({ ...options, selection: { ...options.selection, modules: [module] } })) } catch (error) { for (const p of pipelines) { try { p.dispose() } catch { /* every owner attempted */ } } throw error }
  const byModule = Object.freeze(Object.fromEntries(modules.map((m, i) => [m.id, pipelines[i]!])))
  const dispose = () => { let failed = false; for (const p of pipelines) { try { p.dispose() } catch { failed = true } } if (failed) throw new Error('independent pipeline cleanup failed') }
  return Object.freeze({ byModule, pipelines: Object.freeze([...pipelines]),
    accept(frame: ObservationFrame, readProgress?: () => unknown) { for (const p of pipelines) p.accept(frame, readProgress) },
    halt(reason?: string) { for (const p of pipelines) p.halt(reason) },
    advanceIntent() { for (const p of pipelines) p.advanceIntent() },
    async idle() { await Promise.all(pipelines.map(p => p.idle())) }, dispose,
  })
}
