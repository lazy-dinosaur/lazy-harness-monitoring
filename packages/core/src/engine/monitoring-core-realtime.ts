import { createHash } from 'node:crypto'
import { freezeMonitoringData } from '../sdk/diagnostics.ts'
import { parseMonitoringJsonData } from '../sdk/schema.ts'
import { observationEvents, type ObservationContext, type ObservationFrame, type PiMonitoringObserver } from '../observer/monitoring-observer.ts'
import type { Json } from './monitoring-core.ts'

export type RealtimeDependency = Readonly<{ id: string; version: string }>
export type RealtimeSignal = Readonly<{ frame: ObservationFrame; epoch: number; step: number; generation: number }>
export type RealtimePrepared = Readonly<{ channel: 'context' | 'module'; payload: Json; dependencies?: readonly RealtimeDependency[] }>
export type RealtimeLease = Readonly<{ signal: AbortSignal; isCurrent(): boolean }>
export type RealtimeCandidate = Readonly<{ id: string; frameId: string; sourceEvent: string; sessionId: string; binding: number; epoch: number; generation: number; startedStep: number; readyStep: number; preparedAt: number; channel: 'context' | 'module'; payload: Json; dependencies: readonly RealtimeDependency[]; contentHash: string }>
export type RealtimeOffer = Readonly<{ candidate: RealtimeCandidate; isCurrent(): boolean }>
export type RealtimeLimits = { maxEvents: number; maxJobs: number; maxQueued: number; maxActive: number; maxReady: number; maxTrace: number; maxFrameBytes: number; maxReadyBytes: number; maxDependencies: number; jobTimeoutMs: number }
export type RealtimeOptions = Readonly<{
  enabled?: boolean
  watchEvents: readonly string[]
  isPermitted(signal: RealtimeSignal): boolean
  dependencies(signal: RealtimeSignal): readonly RealtimeDependency[]
  sourceVersion(id: string): string | undefined
  prepare(signal: RealtimeSignal, lease: RealtimeLease): RealtimePrepared | undefined | Promise<RealtimePrepared | undefined>
  /** task154: delivery-side trace (frame-tied coordinator reasons such as offered / source_changed / no_result). */
  onTrace?(row: Record<string, unknown>): void
  limits?: Partial<RealtimeLimits>
}>
export type RealtimeTrace = Readonly<{ sequence: number; at: number; epoch: number; step: number; generation: number; reason: string; frameId?: string; jobId?: string }>
type Scope = Readonly<{ sessionId: string; binding: number }>
type Job = { id: string; input: RealtimeSignal; dependencies: readonly RealtimeDependency[]; controller: AbortController; key?: string; invalid?: string; timer?: ReturnType<typeof setTimeout> }
type Ready = { candidate: RealtimeCandidate; job: Job; bytes: number }
const defaults: RealtimeLimits = { maxEvents: 2048, maxJobs: 128, maxQueued: 32, maxActive: 2, maxReady: 32, maxTrace: 512, maxFrameBytes: 131072, maxReadyBytes: 65536, maxDependencies: 32, jobTimeoutMs: 1000 }
const knownEvents = new Set<string>(observationEvents)
const hardStops = new Set(['session_shutdown', 'session_before_switch', 'session_before_fork'])
const newGenerations = new Set(['session_before_tree', 'session_tree', 'session_before_compact', 'session_compact', 'session_compact_failed', 'model_select', 'thinking_level_select'])
const stopReasons = new Set(['stopped', 'disposed', 'aborted', 'scope_changed', 'source_gap', 'identity_conflict', 'event_budget', 'missing_source_frame', 'malformed'])
const data = <T>(value: T): T => freezeMonitoringData(parseMonitoringJsonData(value) as T)
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512

/** Source-host preparation only: no inference, injection, business effects, durable cache or background activation. */
export class RealtimeMonitoringCoordinator {
  readonly limits: Readonly<RealtimeLimits>
  private readonly options: RealtimeOptions
  private state: 'idle' | 'running' | 'stopped' | 'disposed' = 'idle'
  private scope?: Scope
  private epoch = 0
  private step = 0
  private generation = 0
  private cursor = 0
  private sequence = 0
  private admitted = 0
  private started = 0
  private peakActive = 0
  private readyBytes = 0
  private traceEvicted = 0
  private agentIdle = false
  private lastEvent = ''
  private contextAvailable = false
  private scheduled = false
  private readonly seen = new Map<string, string>()
  private readonly queue: Job[] = []
  private readonly active = new Map<string, Job>()
  private readonly mailbox = new Map<string, Ready>()
  private readonly retained: RealtimeTrace[] = []
  private readonly waiters: Array<() => void> = []

  constructor(options: RealtimeOptions) {
    this.limits = Object.freeze({ ...defaults, ...options.limits })
    if (Object.values(this.limits).some(n => !Number.isSafeInteger(n) || n < 1) || this.limits.jobTimeoutMs > 2147483647) throw new Error('invalid realtime limits')
    if (!Array.isArray(options.watchEvents) || !options.watchEvents.length || new Set(options.watchEvents).size !== options.watchEvents.length || options.watchEvents.some(e => !knownEvents.has(e) || e === 'context' || e === 'context_with_system')) throw new Error('invalid realtime watch events')
    if (['isPermitted', 'dependencies', 'sourceVersion', 'prepare'].some(k => typeof (options as any)[k] !== 'function')) throw new Error('explicit realtime host ports required')
    this.options = Object.freeze({ ...options, enabled: options.enabled === true, watchEvents: Object.freeze([...options.watchEvents]), limits: this.limits })
  }

  start(scope: Scope & { afterCursor?: number }): boolean {
    if (!this.options.enabled) return false
    if (this.state !== 'idle' || !text(scope.sessionId) || !Number.isSafeInteger(scope.binding) || scope.binding < 1 || !Number.isSafeInteger(scope.afterCursor ?? 0) || (scope.afterCursor ?? 0) < 0) throw new Error('invalid or already used realtime scope')
    this.scope = data({ sessionId: scope.sessionId, binding: scope.binding })
    this.cursor = scope.afterCursor ?? 0
    this.generation++
    this.state = 'running'
    return true
  }

  /** Synchronous bounded admission; never awaits a preparation/model promise. Diagnostic frame.epoch is NOT a watch lease. */
  accept(input: ObservationFrame): void {
    if (this.state !== 'running') return
    let frame: ObservationFrame
    try {
      frame = data(input)
      if (!text(frame.id) || !text(frame.kind) || !knownEvents.has(frame.sourceEvent) || !text(frame.sessionId) || !Number.isSafeInteger(frame.binding) || frame.binding < 1 || !Number.isSafeInteger(frame.cursor) || frame.cursor < 1 || typeof frame.available !== 'boolean' || !frame.snapshot || frame.snapshot.sessionId !== frame.sessionId || typeof frame.snapshot.available !== 'boolean') throw new Error()
    } catch { this.stop('malformed'); return }
    if (frame.sessionId !== this.scope!.sessionId || frame.binding !== this.scope!.binding) { this.stop('scope_changed'); return }
    const fingerprint = digest(frame), prior = this.seen.get(frame.id)
    if (prior) { if (prior !== fingerprint) this.stop('identity_conflict'); else this.note('duplicate', frame.id); return }
    if (frame.cursor !== this.cursor + 1) { this.stop('source_gap'); return }
    if (this.seen.size >= this.limits.maxEvents) { this.stop('event_budget'); return }
    this.cursor = frame.cursor
    this.seen.set(frame.id, fingerprint)
    this.lastEvent = frame.sourceEvent
    if (hardStops.has(frame.sourceEvent)) { this.stop('scope_changed'); return }
    const payload = frame.payload as any
    if (payload?.aborted === true || payload?.message?.stopReason === 'aborted') { this.stop('aborted'); return }
    if (frame.sourceEvent === 'input') this.advanceIntent()
    if (newGenerations.has(frame.sourceEvent)) { this.generation++; this.invalidate('scope_changed'); return }
    if (frame.sourceEvent === 'context') {
      this.step++
      this.agentIdle = false
      this.contextAvailable = frame.available && frame.snapshot.available
      this.note('step', frame.id)
      return
    }
    if (frame.sourceEvent === 'context_with_system') {
      this.contextAvailable = this.step > 0 && this.contextAvailable && frame.available && frame.snapshot.available
      this.note(this.contextAvailable ? 'same_step' : 'unavailable', frame.id)
      return
    }
    if (frame.sourceEvent === 'agent_start') this.agentIdle = false
    if (frame.sourceEvent === 'agent_settled') {
      this.agentIdle = true
      for (const { job, candidate } of this.mailbox.values()) if (candidate.channel === 'context') this.note('no_next_context', job.input.frame.id, job.id)
    }
    if (!frame.available || !frame.snapshot.available || bytes(frame) > this.limits.maxFrameBytes) { this.note('unavailable', frame.id); return }
    if (!this.options.watchEvents.includes(frame.sourceEvent)) return
    const signal = data({ frame, epoch: this.epoch, step: this.step, generation: this.generation })
    let dependencies: readonly RealtimeDependency[]
    try { dependencies = this.normalizeDependencies(this.options.dependencies(signal)) } catch { this.note('malformed_dependencies', frame.id); return }
    const job: Job = { id: `${this.scope!.sessionId}/${this.scope!.binding}/${++this.admitted}`, input: signal, dependencies, controller: new AbortController(), key: this.coalesceKey(signal) }
    const reason = this.invalidReason(job)
    if (reason) { this.cancel(job, reason); return }
    if (job.key) {
      const index = this.queue.findIndex(old => old.key === job.key)
      if (index >= 0) this.cancel(this.queue.splice(index, 1)[0], 'coalesced')
    }
    if (this.queue.length >= this.limits.maxQueued) { this.cancel(job, 'overflow'); return }
    this.queue.push(job)
    this.note('queued', frame.id, job.id)
    this.schedule()
  }

  /** Explicit host/LLM-owned intent change; never guesses a task boundary from text. */
  advanceIntent(): void {
    if (this.state !== 'running') return
    this.epoch++
    this.invalidate('intent_changed')
  }

  /** Context offers are available only at a current context hook; module offers may be read after normal agent settlement. */
  takeReady(channel: 'context' | 'module'): readonly RealtimeOffer[] {
    if (channel !== 'context' && channel !== 'module') throw new Error('invalid realtime channel')
    if (this.state !== 'running' || channel === 'context' && (this.agentIdle || !this.contextAvailable || !['context', 'context_with_system'].includes(this.lastEvent))) return []
    const offers: RealtimeOffer[] = []
    for (const [id, ready] of this.mailbox) {
      if (ready.candidate.channel !== channel) continue
      const reason = this.invalidReason(ready.job)
      this.mailbox.delete(id); this.readyBytes -= ready.bytes
      if (reason) { this.cancel(ready.job, reason); continue }
      this.note('offered', ready.job.input.frame.id, id)
      offers.push(Object.freeze({ candidate: ready.candidate, isCurrent: () => this.invalidReason(ready.job) === undefined }))
    }
    return Object.freeze(offers)
  }

  stop(reason = 'stopped'): void {
    if (!stopReasons.has(reason)) throw new Error('invalid realtime stop reason')
    if (this.state === 'stopped' || this.state === 'disposed') return
    this.state = 'stopped'; this.generation++
    this.invalidate(reason)
    this.note(reason)
  }
  dispose(): void { this.stop('disposed'); this.state = 'disposed' }
  idle(): Promise<void> { return this.queue.length || this.active.size ? new Promise(resolve => this.waiters.push(resolve)) : Promise.resolve() }
  get traces(): readonly RealtimeTrace[] { return Object.freeze([...this.retained]) }
  getStatus() { return data({ state: this.state, enabled: this.options.enabled === true, scope: this.scope ?? null, epoch: this.epoch, step: this.step, generation: this.generation, cursor: this.cursor, observed: this.seen.size, admitted: this.admitted, started: this.started, active: this.active.size, peakActive: this.peakActive, queued: this.queue.length, ready: this.mailbox.size, readyBytes: this.readyBytes, agentIdle: this.agentIdle, traceEvicted: this.traceEvicted }) }

  private normalizeDependencies(value: unknown): readonly RealtimeDependency[] {
    const dependencies = data(value) as RealtimeDependency[]
    if (!Array.isArray(dependencies) || !dependencies.length || dependencies.length > this.limits.maxDependencies || new Set(dependencies.map(d => d?.id)).size !== dependencies.length || dependencies.some(d => !d || Object.keys(d).some(k => !['id', 'version'].includes(k)) || !text(d.id) || !text(d.version))) throw new Error('invalid realtime dependencies')
    return dependencies
  }
  private invalidReason(job: Job): string | undefined {
    if (job.invalid) return job.invalid
    if (this.state !== 'running' || job.input.generation !== this.generation || job.input.frame.sessionId !== this.scope?.sessionId || job.input.frame.binding !== this.scope?.binding) return 'scope_changed'
    if (job.input.epoch !== this.epoch) return 'intent_changed'
    try { if (this.options.isPermitted(job.input) !== true) return 'permission_changed' } catch { return 'permission_check_failed' }
    try {
      for (const dependency of job.dependencies) {
        const version = this.options.sourceVersion(dependency.id)
        if (version !== undefined && typeof version !== 'string') return 'source_check_failed'
        if (version !== dependency.version) return 'source_changed'
      }
    } catch { return 'source_check_failed' }
  }
  private coalesceKey(input: RealtimeSignal): string | undefined {
    if (input.frame.sourceEvent === 'message_update') return `message:${input.generation}:${input.epoch}:${input.step}`
    const id = (input.frame.payload as any)?.toolCallId
    if (input.frame.sourceEvent === 'tool_execution_update' && typeof id === 'string') return `tool:${input.generation}:${input.epoch}:${input.step}:${id}`
  }
  private note(reason: string, frameId?: string, jobId?: string) {
    this.retained.push(Object.freeze({ sequence: ++this.sequence, at: performance.now(), epoch: this.epoch, step: this.step, generation: this.generation, reason, ...(frameId ? { frameId } : {}), ...(jobId ? { jobId } : {}) }))
    if (frameId && this.options.onTrace && reason !== 'step' && reason !== 'same_step') { try { this.options.onTrace({ frameId, reason, ...(jobId ? { jobId } : {}) }) } catch { /* tracing never changes outcomes */ } }
    if (this.retained.length > this.limits.maxTrace) { this.retained.shift(); this.traceEvicted++ }
  }
  private cancel(job: Job, reason: string) {
    if (job.invalid) return
    job.invalid = reason
    if (job.timer) clearTimeout(job.timer)
    job.controller.abort(reason)
    this.note(reason, job.input.frame.id, job.id)
  }
  private invalidate(reason: string) {
    for (const job of this.queue.splice(0)) this.cancel(job, reason)
    for (const job of this.active.values()) this.cancel(job, reason)
    for (const ready of this.mailbox.values()) this.cancel(ready.job, reason)
    this.mailbox.clear(); this.readyBytes = 0
    this.notifyIdle()
  }
  private schedule() {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => { this.scheduled = false; this.pump() })
  }
  private pump() {
    while (this.state === 'running' && this.active.size < this.limits.maxActive && this.queue.length) {
      const job = this.queue.shift()!, reason = this.invalidReason(job)
      if (reason) { this.cancel(job, reason); continue }
      if (this.started >= this.limits.maxJobs) { this.cancel(job, 'job_budget'); continue }
      this.started++
      this.active.set(job.id, job); this.peakActive = Math.max(this.peakActive, this.active.size)
      this.note('started', job.input.frame.id, job.id)
      job.timer = setTimeout(() => this.cancel(job, 'timeout'), this.limits.jobTimeoutMs)
      void Promise.resolve().then(() => {
        const reason = this.invalidReason(job)
        if (reason) { this.cancel(job, reason); return undefined }
        return this.options.prepare(job.input, Object.freeze({ signal: job.controller.signal, isCurrent: () => this.invalidReason(job) === undefined }))
      }).then(result => {
        const invalid = this.invalidReason(job)
        if (invalid) { this.cancel(job, invalid); return }
        if (result === undefined) { this.note('no_result', job.input.frame.id, job.id); return }
        try {
          const prepared = data(result)
          if (!prepared || !['context', 'module'].includes(prepared.channel) || Object.keys(prepared).some(k => !['channel', 'payload', 'dependencies'].includes(k)) || !Object.hasOwn(prepared, 'payload')) throw new Error()
          const combined = new Map(job.dependencies.map(d => [d.id, d]))
          if (prepared.dependencies) for (const d of this.normalizeDependencies(prepared.dependencies)) {
            if (combined.has(d.id) && combined.get(d.id)!.version !== d.version) throw new Error()
            combined.set(d.id, d)
          }
          job.dependencies = this.normalizeDependencies([...combined.values()])
          const reason = this.invalidReason(job)
          if (reason) { this.cancel(job, reason); return }
          const body = { id: job.id, frameId: job.input.frame.id, sourceEvent: job.input.frame.sourceEvent, sessionId: this.scope!.sessionId, binding: this.scope!.binding, epoch: job.input.epoch, generation: job.input.generation, startedStep: job.input.step, readyStep: this.step, preparedAt: performance.now(), channel: prepared.channel, payload: prepared.payload, dependencies: job.dependencies }
          const candidate: RealtimeCandidate = data({ ...body, contentHash: digest(body) }), size = bytes(candidate)
          if (this.mailbox.size >= this.limits.maxReady || size + this.readyBytes > this.limits.maxReadyBytes) { this.cancel(job, 'mailbox_overflow'); return }
          this.mailbox.set(job.id, { job, candidate, bytes: size }); this.readyBytes += size
          this.note('ready', job.input.frame.id, job.id)
          if (candidate.channel === 'context' && this.agentIdle) this.note('no_next_context', job.input.frame.id, job.id)
        } catch { this.cancel(job, 'malformed_result') }
      }, () => this.cancel(job, 'failed')).finally(() => {
        if (job.timer) clearTimeout(job.timer)
        this.active.delete(job.id)
        this.pump(); this.notifyIdle()
      })
    }
    this.notifyIdle()
  }
  private notifyIdle() { if (!this.queue.length && !this.active.size) for (const resolve of this.waiters.splice(0)) resolve() }
}

/** Install AFTER the existing observer. Notification-only: no raw-event reads, context edits, continuation or implicit observer creation. */
export function createPiRealtimeTap(options: { enabled?: boolean; observer: Pick<PiMonitoringObserver, 'frames'>; coordinator: RealtimeMonitoringCoordinator }) {
  const enabled = options.enabled === true, observer = options.observer, coordinator = options.coordinator
  const off: Array<() => void> = []
  let installed = false
  let lastCursor = 0
  const dispose = () => {
    let failed = false
    for (const unsubscribe of off.splice(0)) { try { unsubscribe() } catch { failed = true } }
    coordinator.dispose()
    if (failed) throw new Error('realtime tap cleanup failed')
  }
  return Object.freeze({
    extension(pi: { on(name: string, handler: (event: any, ctx: ObservationContext) => undefined): unknown }): void {
      if (!enabled) return
      if (installed) throw new Error('realtime tap already installed')
      installed = true
      try {
        for (const name of observationEvents) {
          const unsubscribe = pi.on(name, (_event, ctx) => {
            const state = coordinator.getStatus().state
            if (state === 'stopped' || state === 'disposed' || state === 'idle' && name !== 'session_start') return undefined
            try {
              const frame = observer.frames.at(-1)
              if (!frame || frame.cursor <= lastCursor || frame.sourceEvent !== name || frame.sessionId !== ctx.sessionManager.getSessionId()) { coordinator.stop('missing_source_frame'); return undefined }
              lastCursor = frame.cursor
              if (name === 'session_start' && coordinator.getStatus().state === 'idle') coordinator.start({ sessionId: frame.sessionId, binding: frame.binding, afterCursor: frame.cursor - 1 })
              coordinator.accept(frame)
            } catch { coordinator.stop('missing_source_frame') }
            return undefined
          })
          if (typeof unsubscribe !== 'function') throw new Error('realtime tap needs unsubscribe handles')
          off.push(unsubscribe as () => void)
        }
      } catch { try { dispose() } catch { /* Every owned handle was attempted and the coordinator is disposed. */ } throw new Error('realtime tap setup rejected') }
    },
    dispose,
  })
}
