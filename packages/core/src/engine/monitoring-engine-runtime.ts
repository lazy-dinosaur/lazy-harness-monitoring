// Monitoring engine v2 runtime: bounded in-session scheduling; no host hooks/network/model calls of its own.
// Timeout/cancel is logical. Hard termination is owned by the worker execution port implementation.
// Turns a trigger (module matched its purpose + selected evidence) into the module's declared background jobs and
// enforces the ENGINE RULES that are not module options: loop guard, idempotency, user-approved budget gate before
// any job that declares cost, uncertain effect = terminal stop (never retried), risk-tier output limits, report mode.
import { assertMonitoringWatchable, resolveMonitoringWatch } from '../sdk/trigger-points.ts'
import { createInMemoryWorkerPort } from '../sdk/worker-execution-memory.ts'
import type { WorkerExecutionPort, WorkerExecutionLimits, WorkerCompletion } from '../sdk/worker-execution.ts'
import { canonicalJsonHash } from '../sdk/canonical-json.ts'
import { parseMonitoringJsonData } from '../sdk/schema.ts'
import { freezeMonitoringData } from '../sdk/diagnostics.ts'
import type { MonitoringEffectiveJob, MonitoringModuleDeclaration } from '../sdk/declaration.ts'
import type { RealtimeWatchModule } from './monitoring-core-realtime-selection.ts'
import type { Grants } from '../sdk/contracts.generated.ts'

export type CostKind = 'judgeCalls' | 'workerDispatches' | 'sdkCalls' | 'embeddingCalls' | 'usd'
export type EvidenceItem = Readonly<{ id: string; kind: string; version: string; text: string }>
export type Trigger = Readonly<{ moduleId: string; eventId: string; sessionId: string; evidence: readonly EvidenceItem[]; subjectKey?: string; turn?: number; origin?: Readonly<{ moduleId: string; jobId: string; depth: number }>; /** Present when the module needs `judge.view`: the exact judge view of the triggering event. */ view?: unknown }>
export type BudgetLease = Readonly<{ consume(kind: CostKind, amount: number): void; remaining(kind: CostKind): number }>
export type JobContext = Readonly<{ trigger: Trigger; job: MonitoringEffectiveJob; lease?: BudgetLease; signal: AbortSignal }>
/** Completions are bounded plain JSON data. Report text is at most 65536 UTF-8 bytes; effect IDs are nonempty, at most 512 characters. */
export type JobResult = Readonly<{ status: 'executed' | 'proposed' | 'prepared' | 'rejected' | 'unknown'; effectId?: string; report?: Readonly<{ text: string }>; output?: unknown }>
// Validate/copy the whole injected completion before reading its discriminants or constructing reports.
function parseWorkerCompletion(input: unknown): WorkerCompletion<JobResult> {
  const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
  const only = (v: Record<string, unknown>, allowed: readonly string[]) => Object.keys(v).every(k => allowed.includes(k))
  const bad = (): never => { throw new Error('malformed worker result') }
  if (!object(input)) return bad()
  const c = parseMonitoringJsonData(input)
  if (!object(c)) return bad()
  if (c.status !== 'completed') {
    if (!only(c, ['status', 'certainty', 'reason']) || !['failed', 'timed-out', 'cancelled', 'refused'].includes(c.status as string) || !['terminal', 'uncertain'].includes(c.certainty as string) || typeof c.reason !== 'string' || !c.reason) return bad()
  } else {
    if (!only(c, ['status', 'certainty', 'value']) || c.certainty !== 'terminal' || !object(c.value)) return bad()
    const r = c.value
    if (!only(r, ['status', 'effectId', 'report', 'output']) || !['executed', 'proposed', 'prepared', 'rejected', 'unknown'].includes(r.status as string)) return bad()
    if (Object.hasOwn(r, 'effectId') && (typeof r.effectId !== 'string' || !r.effectId || r.effectId.length > 512)) return bad()
    if (Object.hasOwn(r, 'report') && (!object(r.report) || !only(r.report, ['text']) || typeof r.report.text !== 'string' || Buffer.byteLength(r.report.text, 'utf8') > 65536)) return bad()
    // Optional output is module-owned JSON, not a provider-specific schema. The shared parser bounds it.
  }
  return freezeMonitoringData(c) as WorkerCompletion<JobResult>
}

export type JobHandler = Readonly<{ run(context: JobContext): JobResult | Promise<JobResult>; idempotencyKey?(trigger: Trigger): string | undefined }>
export type WorkerJobRequest = Readonly<{ handlerId: string; context: Omit<JobContext, 'signal'> }>
/** Compatibility adapter: trusted existing handlers run through the same worker port contract. */
export function createHandlerWorkerPort(handlers: Readonly<Record<string, JobHandler>>, limits: Partial<WorkerExecutionLimits> = {}): WorkerExecutionPort<WorkerJobRequest, JobResult> {
  return createInMemoryWorkerPort((request: WorkerJobRequest, signal) => {
    const handler = handlers[request.handlerId]
    if (!handler) throw new Error('worker handler unavailable')
    return handler.run(Object.freeze({ ...request.context, signal }))
  }, limits)
}
export type Report = Readonly<{ moduleId: string; jobId: string; eventId: string; sessionId: string; mode: 'always' | 'on-result'; text: string; riskTier: string }>
export type ReportEnqueueReceipt = Readonly<{ reportId: string; status: 'enqueued' | 'failed' | 'unknown'; reason?: string }>
export type ReportDeliveryReceipt = Readonly<{ reportId: string; status: 'delivered'; boundary: 'context_with_system' }>
export function monitoringReportId(report: Report): string { return canonicalJsonHash(report) }
export type JobOutcome = Readonly<{ moduleId: string; jobId: string; eventId: string; key?: string; status: 'executed' | 'proposed' | 'prepared' | 'rejected' | 'uncertain' | 'skipped'; reason: string; effectId?: string; reported: boolean; reportReceipt?: ReportEnqueueReceipt }>
export type RegisteredModule = Readonly<{ moduleId: string; declaration: MonitoringModuleDeclaration; declarationHash: string; jobs: readonly MonitoringEffectiveJob[]; /** task154 run stage (default active). */ stage?: 'off' | 'observe' | 'shadow' | 'active' }>

/** Explicit user-approved budget windows; never created implicitly. Reservation = the job's declared per-run caps. */
export class ApprovedBudgetGate {
  private readonly windows = new Map<string, { caps: Partial<Record<CostKind, number>>; used: Partial<Record<CostKind, number>>; reserved: Partial<Record<CostKind, number>>; revoked: boolean }>()
  constructor(private readonly maxWindows = 1024) { if (!Number.isSafeInteger(maxWindows) || maxWindows < 1) throw new Error('invalid budget window bound') }
  approve(scope: Readonly<{ moduleId: string; jobId?: string; caps: Partial<Record<CostKind, number>>; approvedBy: string }>) {
    if (!scope.approvedBy || Object.values(scope.caps).some(v => typeof v !== 'number' || !Number.isFinite(v) || !(v > 0))) throw new Error('invalid budget approval')
    const key = scope.jobId ? `${scope.moduleId}.${scope.jobId}` : scope.moduleId, prior = this.windows.get(key)
    if (prior && Object.values(prior.reserved).some(n => n! > 0)) throw new Error('budget window has live reservations')
    if (!prior && this.windows.size >= this.maxWindows) throw new Error('budget window capacity')
    this.windows.set(key, { caps: { ...scope.caps }, used: {}, reserved: {}, revoked: false })
  }
  /** Explicit scope expiry. In-flight reservations remain owned until raw settlement. */
  revoke(moduleId: string, jobId?: string): void {
    const key = jobId ? `${moduleId}.${jobId}` : moduleId, w = this.windows.get(key)
    if (!w) return
    w.revoked = true
    if (!Object.values(w.reserved).some(n => n! > 0)) this.windows.delete(key)
  }
  getStatus() { return { windows: this.windows.size, maxWindows: this.maxWindows } }
  reserve(moduleId: string, jobId: string, perRun: Partial<Record<CostKind, number>>): { lease?: BudgetLease & { settle(): void }; reason?: string } {
    const key = this.windows.has(`${moduleId}.${jobId}`) ? `${moduleId}.${jobId}` : moduleId, w = this.windows.get(key)
    if (!w) return { reason: 'budget_not_approved' }
    if (w.revoked) return { reason: 'budget_revoked' }
    const kinds = Object.keys(perRun) as CostKind[]
    for (const k of kinds) { const cap = w.caps[k]; if (cap === undefined) return { reason: `budget_kind_not_approved:${k}` }; if ((w.used[k] ?? 0) + (w.reserved[k] ?? 0) + perRun[k]! > cap) return { reason: `budget_exhausted:${k}` } }
    for (const k of kinds) w.reserved[k] = (w.reserved[k] ?? 0) + perRun[k]!
    const spent: Partial<Record<CostKind, number>> = {}; let open = true
    const lease = {
      consume(kind: CostKind, amount: number) {
        if (!open) throw new Error('budget lease closed')
        if (!Number.isFinite(amount) || !(amount >= 0) || !kinds.includes(kind)) throw new Error(`budget_kind_not_declared:${kind}`)
        if ((spent[kind] ?? 0) + amount > perRun[kind]!) throw new Error(`budget_per_run_exceeded:${kind}`)
        spent[kind] = (spent[kind] ?? 0) + amount
      },
      remaining: (kind: CostKind) => (perRun[kind] ?? 0) - (spent[kind] ?? 0),
      settle: () => { if (!open) return; open = false; for (const k of kinds) { w.reserved[k] = (w.reserved[k] ?? 0) - perRun[k]!; w.used[k] = (w.used[k] ?? 0) + (spent[k] ?? 0) }; if (w.revoked && !Object.values(w.reserved).some(n => n! > 0)) this.windows.delete(key) },
    }
    return { lease }
  }
  usage(moduleId: string, jobId?: string) { const w = this.windows.get(jobId ? `${moduleId}.${jobId}` : moduleId); return w ? { caps: { ...w.caps }, used: { ...w.used }, reserved: { ...w.reserved } } : undefined }
}

/** Records every attempted key, including uncertain ones, so an uncertain effect is never retried. */
export interface IdempotencyStore { get(key: string): string | undefined; put(key: string, state: string): void }
/** Protection keys have instance lifetime, NOT diagnostic-ring lifetime. No TTL/LRU eviction. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly m = new Map<string, string>()
  constructor(private readonly maxKeys = 4096) { if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new Error('invalid idempotency bound') }
  get(k: string) { return this.m.get(k) }
  put(k: string, s: string) { if (!this.m.has(k) && this.m.size >= this.maxKeys) throw new Error('idempotency_capacity'); this.m.set(k, s) }
  getStatus() { return { keys: this.m.size, maxKeys: this.maxKeys } }
}

export type RuntimeOptions = Readonly<{ modules: readonly RegisteredModule[]; handlers: Readonly<Record<string, JobHandler>>; budget: ApprovedBudgetGate; idempotency?: IdempotencyStore; report?(report: Report): ReportEnqueueReceipt; /** task154 judgement trace sink: one `job` row per outcome. */ trace?(row: Readonly<Record<string, unknown>>): void; maxOriginDepth?: number; jobTimeoutMs?: number; maxActive?: number; maxQueued?: number; maxWork?: number; maxOutcomes?: number; workerPort?: WorkerExecutionPort<WorkerJobRequest, JobResult> }>

export class MonitoringModuleRuntime {
  private readonly modules = new Map<string, RegisteredModule>()
  private readonly store: IdempotencyStore
  private readonly outcomeLog: JobOutcome[] = []
  private outcomesEvicted = 0
  get outcomes(): readonly JobOutcome[] { return Object.freeze([...this.outcomeLog]) }
  private readonly work: WorkerExecutionPort<WorkerJobRequest, JobResult>
  constructor(private readonly options: RuntimeOptions) {
    if (!Number.isSafeInteger(options.maxOutcomes ?? 256) || (options.maxOutcomes ?? 256) < 1) throw new Error('invalid outcome retention')
    const limits = { ...(options.maxActive !== undefined ? { maxActive: options.maxActive } : {}), ...(options.maxQueued !== undefined ? { maxQueued: options.maxQueued } : {}), ...(options.maxWork !== undefined ? { maxWork: options.maxWork } : {}), ...(options.jobTimeoutMs !== undefined ? { timeoutMs: options.jobTimeoutMs } : {}) }
    if (Object.entries(limits).some(([key, n]) => !Number.isSafeInteger(n) || n < (key === 'maxQueued' ? 0 : 1)) || (limits.timeoutMs ?? 1) > 2147483647) throw new Error('invalid runtime work limits')
    if (options.workerPort && Object.entries(limits).some(([key, n]) => options.workerPort!.limits[key as keyof WorkerExecutionLimits] > n)) throw new Error('worker port exceeds runtime limits')
    this.work = options.workerPort ?? createHandlerWorkerPort(options.handlers, limits)
    for (const m of options.modules) {
      assertMonitoringWatchable(m.declaration.watch.events)
      if (this.modules.has(m.moduleId)) throw new Error('duplicate runtime module')
      for (const j of m.jobs) if (j.enabled && !options.workerPort && typeof options.handlers[`${m.moduleId}.${j.id}`]?.run !== 'function') throw new Error(`missing job handler ${m.moduleId}.${j.id}`)
      this.modules.set(m.moduleId, m)
    }
    this.store = options.idempotency ?? new MemoryIdempotencyStore()
  }
  /** Auto-started for handler compatibility. Restart only after raw idle; lifetime count never resets. */
  start() { this.work.start() }
  stop(reason?: string) { this.work.stop(reason) }
  dispose() { this.work.dispose() }
  idle() { return this.work.idle() }
  getStatus() { return Object.freeze({ ...this.work.getStatus(), outcomesRetained: this.outcomeLog.length, outcomesEvicted: this.outcomesEvicted }) }
  private record(o: JobOutcome) { this.outcomeLog.push(Object.freeze(o)); if (this.outcomeLog.length > (this.options.maxOutcomes ?? 256)) { this.outcomeLog.shift(); this.outcomesEvicted++ }; try { this.options.trace?.({ type: 'job', ...o, stage: this.modules.get(o.moduleId)?.stage ?? 'active' }) } catch { /* tracing never changes outcomes */ } return o }
  async onTrigger(trigger: Trigger, signal: AbortSignal = new AbortController().signal): Promise<readonly JobOutcome[]> {
    const state = this.work.getStatus().state
    if (state !== 'running') return [this.record({ moduleId: trigger.moduleId, jobId: '*', eventId: trigger.eventId, status: 'skipped', reason: `runtime_${state}`, reported: false })]
    const m = this.modules.get(trigger.moduleId)
    if (!m) return [this.record({ moduleId: trigger.moduleId, jobId: '*', eventId: trigger.eventId, status: 'skipped', reason: 'unknown_module', reported: false })]
    const out: JobOutcome[] = []
    for (const job of m.jobs) out.push(await this.runJob(m, job, trigger, signal))
    return out
  }
  private async runJob(m: RegisteredModule, job: MonitoringEffectiveJob, trigger: Trigger, parent: AbortSignal): Promise<JobOutcome> {
    const base = { moduleId: m.moduleId, jobId: job.id, eventId: trigger.eventId }
    // task154 run stage: off/observe never run jobs; shadow runs only read-only jobs and withholds their reports.
    const stage = m.stage ?? 'active'
    if (stage === 'off' || stage === 'observe') return this.record({ ...base, status: 'skipped', reason: `stage:${stage}`, reported: false })
    if (stage === 'shadow' && job.riskTier !== 'read-only') return this.record({ ...base, status: 'skipped', reason: 'stage:shadow-effects-withheld', reported: false })
    const skip = (reason: string, key?: string) => this.record({ ...base, ...(key ? { key } : {}), status: 'skipped', reason, reported: false })
    if (!job.enabled) return skip('job_disabled')
    // Loop guard: never react to events produced by this module's own jobs; bounded depth for others.
    if (trigger.origin && (trigger.origin.moduleId === m.moduleId || trigger.origin.depth >= (this.options.maxOriginDepth ?? 1))) return skip('loop_guard')
    const handler = this.options.handlers[`${m.moduleId}.${job.id}`]!
    const idem = job.declared.idempotency
    const material = idem === 'per-event' ? trigger.eventId : idem === 'per-subject' ? trigger.subjectKey : handler?.idempotencyKey?.(trigger)
    if (!material) return skip(`idempotency_key_missing:${idem}`)
    const key = canonicalJsonHash([m.moduleId, m.declarationHash, job.id, idem, material])
    const prior = this.store.get(key)
    if (prior) return skip(`duplicate:${prior}`, key)
    let lease: (BudgetLease & { settle(): void }) | undefined
    if (job.declared.cost) {
      const r = this.options.budget.reserve(m.moduleId, job.id, job.declared.cost.caps as Partial<Record<CostKind, number>>)
      if (!r.lease) return skip(r.reason!, key)
      lease = r.lease
    }
    try { this.store.put(key, 'started') } catch { lease?.settle(); return skip('idempotency_capacity', key) }
    let completion: WorkerCompletion<JobResult>
    try {
      const ticket = this.work.begin({ handlerId: `${m.moduleId}.${job.id}`, context: Object.freeze({ trigger, job, ...(lease ? { lease } : {}) }) }, { signal: parent })
      // Logical timeout must not release a budget reservation. Raw acknowledgement owns settlement.
      void this.work.settled(ticket).then(() => lease?.settle(), () => { /* Unknown raw state: retain reservation. */ })
      const raw = await this.work.wait(ticket)
      try { completion = parseWorkerCompletion(raw) } catch { completion = { status: 'failed', certainty: 'uncertain', reason: 'malformed_worker_result' } }
    } catch { completion = { status: 'failed', certainty: 'uncertain', reason: 'worker_port_failed' } }
    if (completion.status === 'refused' || (completion.status === 'cancelled' && completion.certainty === 'terminal')) {
      this.store.put(key, 'rejected'); return skip(completion.reason, key)
    }
    const result = completion.status === 'completed' ? completion.value : undefined
    const failure = completion.status === 'completed' ? undefined : completion.reason
    // Uncertain effect = terminal stop: the key stays consumed, so the same trigger is never retried.
    if (failure !== undefined || !result || result.status === 'unknown') { this.store.put(key, 'uncertain'); return this.record({ ...base, key, status: 'uncertain', reason: failure ?? 'unknown_result', reported: false }) }
    // Risk-tier output limits.
    if (job.riskTier === 'proposal' && result.status === 'executed') { this.store.put(key, 'uncertain'); return this.record({ ...base, key, status: 'uncertain', reason: 'tier_violation:proposal_executed', reported: false }) }
    if (job.riskTier === 'read-only' && (result.status === 'executed' || result.status === 'proposed')) { this.store.put(key, 'uncertain'); return this.record({ ...base, key, status: 'uncertain', reason: `tier_violation:read_only_${result.status}`, reported: false }) }
    if (result.status === 'executed' && !result.effectId) { this.store.put(key, 'uncertain'); return this.record({ ...base, key, status: 'uncertain', reason: 'missing_effect_receipt', reported: false }) }
    this.store.put(key, result.status)
    let reported = false, reportReceipt: ReportEnqueueReceipt | undefined
    if (stage === 'shadow' && result.status !== 'rejected') return this.record({ ...base, key, status: result.status, reason: 'stage:shadow-report-withheld', reported: false, ...(result.report?.text ? { withheldReport: result.report.text } : {}) } as JobOutcome)
    if (result.status !== 'rejected' && (job.report === 'always' || (job.report === 'on-result' && result.report?.text))) {
      const text = result.report?.text ?? `${m.moduleId}.${job.id}: ${result.status}`
      const report = Object.freeze({ moduleId: m.moduleId, jobId: job.id, eventId: trigger.eventId, sessionId: trigger.sessionId, mode: job.report, text, riskTier: job.riskTier })
      const reportId = monitoringReportId(report)
      reportReceipt = { reportId, status: 'failed', reason: 'receiver_absent' }
      if (this.options.report) {
        try {
          const receipt = this.options.report(report)
          reportReceipt = receipt && receipt.reportId === reportId && ['enqueued', 'failed', 'unknown'].includes(receipt.status)
            ? Object.freeze({ reportId, status: receipt.status })
            : { reportId, status: 'unknown', reason: 'invalid_receiver_receipt' }
        } catch { reportReceipt = { reportId, status: 'unknown', reason: 'receiver_exception' } }
      }
      reported = reportReceipt.status === 'enqueued'
    }
    return this.record({ ...base, key, status: result.status, reason: reportReceipt && !reported ? `report_${reportReceipt.status}` : 'ok', ...(result.effectId ? { effectId: result.effectId } : {}), reported, ...(reportReceipt ? { reportReceipt: Object.freeze(reportReceipt) } : {}) })
  }
}

/** Map a v2 declaration onto the existing selection bridge module shape (one judge question per module). */
export function watchModuleFromDeclaration(moduleId: string, declaration: MonitoringModuleDeclaration, grants: Grants, destination: string, options: { events?: readonly string[] } = {}): RealtimeWatchModule {
  // task154: `watch.events` may name trigger points (hook + deterministic condition); `options.events` is the
  // configuration-selected subset (`effectiveMonitoringWatch`). Conditional points yield a per-module `trigger`.
  assertMonitoringWatchable(options.events ?? declaration.watch.events)
  const resolved = resolveMonitoringWatch(options.events ?? declaration.watch.events)
  return { id: moduleId, watchEvents: [...resolved.sourceEvents], ...(resolved.conditional ? { trigger: resolved.matches } : {}), referenceKinds: [...declaration.watch.kinds], // The bridge's own hand-off action is engine-owned; module job actions are enforced by the runtime, not the bridge.
    grants: { actions: ['monitoring.selected-material'], referenceKinds: [...grants.referenceKinds] }, question: declaration.purpose.question, destination, includeCurrentMaterial: true, ...(declaration.needs?.some(n => n.adapter === 'judge.view') ? { includeJudgeView: true } : {}), ...(declaration.needs?.some(n => n.adapter === 'region.compact') ? { compactRegion: true } : {}) }
}
