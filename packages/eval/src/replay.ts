import { canonicalJson, canonicalJsonHash, createInMemoryWorkerPort, effectiveMonitoringJobs, effectiveMonitoringStage, resolveMonitoringWatch, type MonitoringModelBackend, type MonitoringModelRequest, type WorkerCompletion, type WorkerExecutionPort, type WorkerJobRequest } from '@lazy-harness/monitoring-core'
import { createRealtimeSelectionPipeline, type RealtimeSelectionPacket } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-selection.ts'
import { ApprovedBudgetGate, MonitoringModuleRuntime, monitoringReportId, watchModuleFromDeclaration, type JobResult, type ReportDeliveryReceipt, type ReportEnqueueReceipt } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { redactSecrets } from '@lazy-harness/monitoring-core/engine/monitoring-core-redaction.ts'
import { createManifest, parseDataset, parseManifest, parseModules, type EvalModule, type ReplayDataset, type RunManifest, type StubOutput } from './contracts.ts'

export type ContentIdentity = { hash: string; bytes: number; body?: unknown }
export type MaterialIdentity = { id: string; kind: string; version: string; provenance: unknown; content: ContentIdentity }
export type EvalReceipt = (ReportDeliveryReceipt & { evidence: 'synthetic' }) | { reportId: string; status: 'delivered'; kind: 'private-candidate'; evidence: 'synthetic' }
export type TraceRecord = {
  schemaVersion: 'monitoring-eval-trace/v1'; manifestHash: string; opportunityId: string; frameIndex: number; moduleId: string; frameId: string; sourceEvent: string
  input: ContentIdentity; provenance: { sessionId: string; binding: number; epoch: number; cursor: number; snapshotRevision: string; canonicalHash: string }
  trigger: { matchedPoints: string[]; admittedPoints: string[]; unavailable: boolean }; selection: { status: string[]; considered: MaterialIdentity[]; selected: MaterialIdentity[] }
  judgement: { mode: 'run' | 'skip' | 'defer' | 'none'; inputs: ContentIdentity[]; raw: ContentIdentity[] }
  work: { dispatched: ContentIdentity[]; completion: { status: string; certainty: string; value: ContentIdentity }[]; outcomes: { status: string; reason: ContentIdentity }[] }
  report: { enqueue: ReportEnqueueReceipt[]; delivery: EvalReceipt[]; censored: boolean }
  cancellation: { requested: boolean; observed: boolean }; proposed: boolean; received: boolean
  latency: { unit: 'logical-ms'; captureToJudge: number | null; judgeToWorker: number | null; workerToReady: number | null; readyToReceipt: number | null; endToEnd: number | null }
  cost: { kind: 'stub-estimate'; judgeCalls: number; workerCalls: number; usd: number }
}
export type RunArtifact = { manifest: RunManifest; trace: TraceRecord[]; retention: { dropped: number; bytes: number }; traceHash: string }
// Redact every string recursively, including explicit-consent bodies. No generic file sink that persists bodies implicitly.
export function redacted(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value)
  if (Array.isArray(value)) return value.map(redacted)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [redactSecrets(k), redacted(v)]))
  return value
}
export function identity(value: unknown, consent: boolean): ContentIdentity {
  const body = redacted(value), text = canonicalJson(body)
  return { hash: canonicalJsonHash(body), bytes: Buffer.byteLength(text), ...(consent ? { body } : {}) }
}
class Retention {
  readonly records: TraceRecord[] = []; dropped = 0; bytes = 0
  constructor(private readonly limits: RunManifest['limits']) {}
  add(record: TraceRecord) {
    this.records.push(record); this.bytes += Buffer.byteLength(canonicalJson(record))
    while (this.records.length > this.limits.maxRecords || this.bytes > this.limits.maxTraceBytes) {
      this.bytes -= Buffer.byteLength(canonicalJson(this.records.shift()!)); this.dropped++
    }
  }
}
export async function replay(manifestInput: RunManifest, datasetInput: ReplayDataset, modulesInput: EvalModule[], observeModelInput?: (request: MonitoringModelRequest) => void): Promise<RunArtifact> {
  const manifest = parseManifest(manifestInput), dataset = parseDataset(datasetInput), modules = parseModules(modulesInput)
  const expected = createManifest({ ...manifest, modules, dataset })
  if (canonicalJsonHash(expected) !== canonicalJsonHash(manifest)) throw new Error('manifest does not bind this replay/config/version/cost')
  if (dataset.frames.length > manifest.limits.maxFrames || dataset.outputs.some(o => !modules.some(m => m.id === o.moduleId))) throw new Error('replay admission limit or unknown module')
  for (const m of modules) for (const f of dataset.frames) {
    if (m.knobs.stage !== 'off' && resolveMonitoringWatch(m.knobs.watchPoints).matches(f) && !dataset.outputs.some(o => o.moduleId === m.id && o.frameId === f.id)) throw new Error('missing deterministic model output')
  }
  const manifestHash = canonicalJsonHash(manifest), retention = new Retention(manifest.limits), consent = manifest.contentConsent
  let random = manifest.seed
  const tick = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return 1 + random % 5 }
  for (const m of modules) {
    let script: StubOutput | undefined
    let raw: unknown[] = [], inputs: MonitoringModelRequest[] = [], traces: Record<string, unknown>[] = []
    let dispatched: ContentIdentity[] = [], completions: WorkerCompletion<JobResult>[] = [], enqueues: ReportEnqueueReceipt[] = []
    const binding = m.knobs.model
    const ceilings = { maxCalls: 512, maxConcurrent: 1, maxQueued: 1, timeoutMs: m.knobs.timeoutMs, maxInputBytes: 131072, maxOutputBytes: 65536, maxOutputTokens: 128, maxReservedTokens: 100000, maxReservedUsd: 1 }
    const backend: MonitoringModelBackend = {
      version: binding.version, provider: binding.provider, model: binding.model, kind: 'native-classifier', roles: ['judge'], parametersSchema: { type: 'object', properties: {}, additionalProperties: false }, ceilings,
      estimate: () => ({ maxInputTokens: 1, maxEstimatedUsd: 0 }),
      invoke(request) {
        if (!script) throw new Error('missing deterministic model output')
        inputs.push(request); observeModelInput?.(request)
        const tasks = (request.body as { state: { tasks: { view: { context: { references: unknown[] } } }[] } }).state.tasks
        const answers: Record<string, unknown> = {}
        tasks.forEach((task, i) => {
          answers[`decision_${i}`] = { type: 'choice', choice: script!.mode, confidence: 1 }
          task.view.context.references.forEach((_, j) => { answers[`ref_${i}_${j}`] = { type: 'bool', probability: script!.select ? 1 : 0 } })
        })
        const value = { stopReason: 'stop', answers }; raw.push(value); return { value }
      },
    }
    const job = m.declaration.jobs[0], budget = new ApprovedBudgetGate()
    if (job.cost) budget.approve({ moduleId: m.id, caps: Object.fromEntries(Object.entries(job.cost.caps).map(([k, v]) => [k, v! * dataset.frames.length])), approvedBy: 'synthetic-fixture' })
    const memory = createInMemoryWorkerPort<WorkerJobRequest, JobResult>(request => {
      if (script?.worker === 'failed') throw new Error('synthetic worker failure')
      for (const [kind, amount] of Object.entries(job.cost?.caps ?? {})) request.context.lease?.consume(kind as keyof NonNullable<typeof job.cost>['caps'], amount!)
      return { status: 'prepared', output: { evidenceIds: request.context.trigger.evidence.map(e => e.id), notApproved: true, notWritten: true }, report: { text: 'Synthetic review candidate; no action performed.' } }
    }, { maxActive: 1, maxQueued: 1, maxWork: 512, timeoutMs: m.knobs.timeoutMs })
    const workerPort: WorkerExecutionPort<WorkerJobRequest, JobResult> = { ...memory,
      begin(request, options) { dispatched.push(identity({ handlerId: request.handlerId, trigger: request.context.trigger, job: request.context.job }, consent)); return memory.begin(request, options) },
      async wait(ticket) { const completion = await memory.wait(ticket); completions.push(completion); return completion },
    }
    const runtime = new MonitoringModuleRuntime({ modules: [{ moduleId: m.id, declaration: m.declaration, declarationHash: manifest.modules.find(x => x.id === m.id)!.coreDeclarationHash, jobs: effectiveMonitoringJobs(m.declaration, [{ id: job.id, report: m.knobs.report }], '/report')!, stage: effectiveMonitoringStage(m.declaration, m.knobs.stage, '/stage') }], handlers: {}, budget, workerPort, jobTimeoutMs: m.knobs.timeoutMs, maxOutcomes: 1,
      report(report) { const receipt: ReportEnqueueReceipt = { reportId: monitoringReportId(report), status: script?.delivery === 'failed' ? 'failed' : 'enqueued' }; enqueues.push(receipt); return receipt },
    })
    const watch = watchModuleFromDeclaration(m.id, { ...m.declaration, purpose: { question: m.knobs.question } }, m.grants, 'synthetic-review', { events: m.knobs.watchPoints })
    const pipeline = createRealtimeSelectionPipeline({ enabled: m.knobs.stage !== 'off', material: { allowedKinds: m.declaration.watch.kinds, references: redacted(m.references) as typeof m.references, historyTurns: m.knobs.historyTurns, historyMode: 'message', toolFields: { bash: ['command'] }, limits: { ...m.knobs.material, maxEvents: 512, maxFrames: 512, maxTrace: 1 } }, selection: { modules: [watch], modelConfig: { modelConfigVersion: 1, defaultJudgeProfile: binding.id, profiles: [{ id: binding.id, backend: binding.id, backendVersion: binding.version, provider: binding.provider, model: binding.model, role: 'judge' }] }, modelHost: { backends: { [binding.id]: backend }, maxProfiles: 1, maxTotalConcurrent: 1 }, goal: 'Synthetic mechanical evaluation only', isPermitted: () => true, trace: row => traces.push(row), limits: { maxRequests: 512, maxConcurrentRequests: 1, maxTrace: 1, coreTimeoutMs: m.knobs.timeoutMs } } })
    try {
      for (const [frameIndex, frame] of dataset.frames.entries()) {
        script = dataset.outputs.find(o => o.moduleId === m.id && o.frameId === frame.id)
        raw = []; inputs = []; traces = []; dispatched = []; completions = []; enqueues = []
        pipeline.accept(frame); await pipeline.idle()
        const referenceIds = new Set(inputs.flatMap(r => (r.body as { state: { tasks: { view: { context: { references: { id: string }[] } } }[] } }).state.tasks.flatMap(t => t.view.context.references.map(ref => ref.id))))
        const considered = pipeline.window.snapshot(frame.id, m.declaration.watch.kinds).materials.filter(r => referenceIds.has(r.id)).map(r => ({ id: r.id, kind: r.kind, version: r.version, provenance: r.provenance, content: identity(r.text, consent) }))
        const selected: MaterialIdentity[] = [], outcomes: TraceRecord['work']['outcomes'] = []
        for (const offer of pipeline.coordinator.takeReady('module')) {
          if (!offer.isCurrent()) continue
          const packets = (offer.candidate.payload as unknown as { packets: RealtimeSelectionPacket[] }).packets
          for (const packet of packets) {
            selected.push(...packet.materials.map(r => ({ id: r.id, kind: r.kind, version: r.version, provenance: r.provenance, content: identity(r.text, consent) })))
            const controller = new AbortController(); if (script?.cancel) controller.abort('synthetic-cancel')
            const result = await runtime.onTrigger({ moduleId: m.id, eventId: packet.eventId, sessionId: frame.sessionId, subjectKey: packet.eventId, evidence: packet.materials.map(r => ({ id: r.id, kind: r.kind, version: r.version, text: r.text })) }, controller.signal)
            outcomes.push(...result.map(r => ({ status: r.status, reason: identity(r.reason, consent) })))
          }
        }
        await runtime.idle()
        if (frame.sourceEvent === 'session_start') continue
        const proposed = outcomes.some(o => o.status === 'prepared'), delivery: EvalReceipt[] = []
        if (script?.delivery === 'delivered') {
          for (const r of enqueues.filter(r => r.status === 'enqueued')) delivery.push({ reportId: r.reportId, status: 'delivered', kind: 'hook-boundary', boundary: 'context_with_system', evidence: 'synthetic' })
          if (m.privateCandidate && proposed) delivery.push({ reportId: canonicalJsonHash([m.id, frame.id, 'private-candidate']), status: 'delivered', kind: 'private-candidate', evidence: 'synthetic' })
        }
        const matchedPoints = m.knobs.watchPoints.filter(p => resolveMonitoringWatch([p]).matches(frame))
        const admitted = traces.some(t => t.type === 'judgement') || inputs.length > 0
        const captureToJudge = admitted ? tick() : null, judgeToWorker = dispatched.length ? tick() : null, workerToReady = proposed ? tick() : null, readyToReceipt = delivery.length ? tick() : null
        const statuses = traces.filter(t => t.type === 'selection').map(t => String(t.status))
        retention.add({ schemaVersion: 'monitoring-eval-trace/v1', manifestHash, opportunityId: `${m.id}/${frame.id}`, frameIndex, moduleId: m.id, frameId: frame.id, sourceEvent: frame.sourceEvent,
          input: identity({ payload: frame.payload, snapshot: frame.snapshot }, consent), provenance: { sessionId: frame.sessionId, binding: frame.binding, epoch: frame.epoch, cursor: frame.cursor, snapshotRevision: frame.snapshot.revision, canonicalHash: canonicalJsonHash(frame.snapshot.canonicalHash) },
          trigger: { matchedPoints, admittedPoints: admitted ? matchedPoints : [], unavailable: !frame.available || !frame.snapshot.available }, selection: { status: statuses, considered, selected },
          judgement: { mode: raw.length ? script!.mode : 'none', inputs: inputs.map(r => identity(r, consent)), raw: raw.map(r => identity(r, consent)) },
          work: { dispatched, completion: completions.map(c => ({ status: c.status, certainty: c.certainty, value: identity(c, consent) })), outcomes },
          report: { enqueue: enqueues, delivery, censored: proposed && !delivery.length }, cancellation: { requested: script?.cancel ?? false, observed: completions.some(c => c.status === 'cancelled' || (c.status === 'refused' && c.reason === 'caller_aborted')) }, proposed, received: delivery.length > 0,
          latency: { unit: 'logical-ms', captureToJudge, judgeToWorker, workerToReady, readyToReceipt, endToEnd: delivery.length ? (captureToJudge ?? 0) + (judgeToWorker ?? 0) + (workerToReady ?? 0) + (readyToReceipt ?? 0) : null },
          cost: { kind: 'stub-estimate', judgeCalls: inputs.length, workerCalls: dispatched.length, usd: inputs.length * manifest.stubCost.judgeUsd + dispatched.length * manifest.stubCost.workerUsd } })
      }
    } finally { pipeline.halt('stopped'); pipeline.dispose(); runtime.dispose(); await pipeline.idle(); await runtime.idle() }
  }
  const trace = retention.records.sort((a, b) => a.frameIndex - b.frameIndex || (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0))
  return { manifest, trace, retention: { dropped: retention.dropped, bytes: retention.bytes }, traceHash: canonicalJsonHash(trace) }
}
export const artifactBytes = (artifact: RunArtifact) => canonicalJson(artifact) + '\n'
