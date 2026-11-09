import { createHash, randomUUID } from 'node:crypto'
import { observationEvents, type ObservationStage, type ObservationSnapshot, type ObservationFrame, type ObservationOutcome } from '@lazy-harness/monitoring-core/host'
export { observationEvents, type ObservationStage, type ObservationSnapshot, type ObservationFrame, type ObservationOutcome }

/** Read-only structural boundary: no private Agent fields, model calls or writes. */
export interface ObservationContext {
  sessionManager: { getSessionId(): string; getLeafId(): string | null; getBranch(): Array<{ id: string; parentId: string | null; type: string }>; buildSessionProjection(): { messages: unknown[] } }
  getSystemPrompt(): string
  signal?: AbortSignal
}
export type ObservationConsumer = (frame: ObservationFrame, lease: { signal: AbortSignal; isCurrent(): boolean }) => Promise<unknown> | unknown
export type ObservationLimits = { maxQueue: number; maxRetained: number; maxSnapshotBytes: number; maxMessages: number; workerTimeoutMs: number; /** 0 = off (default, unchanged behaviour). >0: snapshot keeps only the newest N messages (byte-bounded) and stays available. */ tailMessages: number }
type Binding = { id: number; sessionId: string; context: ObservationContext }
type Job = { frame: ObservationFrame; binding: Binding; epoch: number; controller: AbortController; logicalDone: boolean }
const defaults: ObservationLimits = { maxQueue: 64, maxRetained: 512, maxSnapshotBytes: 65536, maxMessages: 128, workerTimeoutMs: 1000, tailMessages: 0 }
const omitted = ['thinking-body', 'opaque-signatures', 'image-bytes', 'raw-provider-data', 'headers', 'arbitrary-tool-details']
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const immutable = <T>(x: T): T => { const copy = JSON.parse(JSON.stringify(x)); const freeze = (v: any): any => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } return v }; return freeze(copy) }
const errorText = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 240)
function blocks(content: any): unknown {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return { omitted: 'unsupported-content' }
  return content.map(b => b?.type === 'text' ? { type: 'text', text: b.text } : b?.type === 'thinking' ? { type: 'thinking', available: Boolean(b.thinking), redacted: Boolean(b.redacted), bodyOmitted: true } : b?.type === 'image' ? { type: 'image', mimeType: b.mimeType, bodyOmitted: true } : b?.type === 'toolCall' ? { type: 'toolCall', id: b.id, name: b.name, arguments: b.arguments, ...(b.namespace ? { namespace: b.namespace } : {}) } : { type: b?.type ?? 'unknown', unsupported: true })
}
export function visibleMessage(m: any) {
  const result: Record<string, unknown> = { role: m?.role ?? 'unknown' }
  for (const k of ['timestamp', 'toolCallId', 'toolName', 'isError', 'stopReason', 'errorMessage', 'customType', 'display']) if (m?.[k] !== undefined) result[k] = m[k]
  if (m?.content !== undefined) result.content = blocks(m.content)
  if (m?.summary !== undefined) result.summary = m.summary
  if (m?.command !== undefined) { result.command = m.command; result.output = m.output; result.cancelled = m.cancelled; result.exitCode = m.exitCode }
  if (m?.toolsAdded) result.toolNamesAdded = m.toolsAdded.map((t: any) => t.name)
  if (m?.toolsRemoved) result.toolNamesRemoved = m.toolsRemoved.map((t: any) => typeof t === 'string' ? t : t.name)
  return result
}
function payload(event: any) {
  const out: Record<string, unknown> = {}
  for (const k of ['text', 'source', 'streamingBehavior', 'reason', 'toolCallId', 'parentToolCallId', 'toolName', 'args', 'input', 'isError', 'turnIndex', 'messageEntryId', 'toolResultEntryIds', 'oldLeafId', 'newLeafId', 'aborted', 'willRetry', 'fromExtension', 'messageType', 'command', 'outcome']) if (event[k] !== undefined) out[k] = event[k]
  if (event.message) out.message = visibleMessage(event.message)
  if (event.assistantMessageEvent) { const a = event.assistantMessageEvent; out.stream = a.type?.startsWith('thinking') ? { type: a.type, bodyOmitted: true } : { type: a.type, ...(a.type === 'text_delta' ? { delta: a.delta } : {}) } }
  if (event.result) out.result = { content: blocks(event.result.content), detailsOmitted: event.result.details !== undefined }
  if (event.type === 'tool_result') out.content = blocks(event.content)
  if (event.compactionEntry) out.compaction = { id: event.compactionEntry.id, firstKeptEntryId: event.compactionEntry.firstKeptEntryId, summary: event.compactionEntry.summary }
  return out
}
export function readObservationSnapshot(ctx: ObservationContext, stage: ObservationStage, observedMessages: unknown[] | undefined, limits: ObservationLimits): ObservationSnapshot {
  const manager = ctx.sessionManager, sessionId = manager.getSessionId(), leafId = manager.getLeafId()
  if (!sessionId || typeof sessionId !== 'string') throw new Error('missing native session identity')
  const projection = manager.buildSessionProjection(), source = projection.messages
  const nativeBranch = manager.getBranch()
  if (limits.tailMessages > 0) {
    // Tail mode (opt-in): keep the newest messages within the byte bound instead of marking the whole snapshot
    // unavailable, so long sessions keep a constant-size frame and stay observable. `truncatedHead` says how many
    // of the oldest messages were left out; a too-large system prompt is omitted (null) rather than failing.
    let keep = Math.min(limits.tailMessages, source.length)
    const tailOf = <T>(xs: readonly T[] | undefined, n: number) => xs === undefined ? undefined : xs.slice(Math.max(0, xs.length - n))
    const build = (n: number, prompt: string | null) => {
      const msgs = tailOf(source, n)!, obs = tailOf(observedMessages, n)
      return { sessionId, leafId, branch: tailOf(nativeBranch, n)!.map(({ id, parentId, type }) => ({ id, parentId, type })), canonicalMessages: msgs.map(visibleMessage), effectiveSystemPrompt: prompt, stage, ...(obs ? { observedMessages: obs.map(visibleMessage) } : {}), available: true, truncatedHead: source.length - msgs.length, fullProviderContext: false as const, omitted }
    }
    let prompt: string | null = ctx.getSystemPrompt()
    let tail = build(keep, prompt)
    if (Buffer.byteLength(JSON.stringify(tail), 'utf8') > limits.maxSnapshotBytes) { prompt = null; tail = build(keep, prompt) }
    while (keep > 0 && Buffer.byteLength(JSON.stringify(tail), 'utf8') > limits.maxSnapshotBytes) { keep = Math.floor(keep / 2); tail = build(keep, prompt) }
    const canonicalHash = hash([sessionId, leafId, tail.canonicalMessages, tail.effectiveSystemPrompt, tail.available, tail.truncatedHead])
    return immutable({ ...tail, canonicalHash, revision: hash([canonicalHash, stage, tail.observedMessages]) })
  }
  const excessive = source.length > limits.maxMessages || nativeBranch.length > limits.maxMessages || (observedMessages?.length ?? 0) > limits.maxMessages
  const branch = excessive ? [] : nativeBranch.map(({ id, parentId, type }) => ({ id, parentId, type }))
  const canonicalMessages = excessive ? [] : source.map(visibleMessage)
  const base = { sessionId, leafId, branch, canonicalMessages, effectiveSystemPrompt: excessive ? null : ctx.getSystemPrompt(), stage, ...(observedMessages && !excessive ? { observedMessages: observedMessages.map(visibleMessage) } : {}), available: !excessive, ...(excessive ? { missing: 'message-count-limit' } : {}), fullProviderContext: false as const, omitted }
  const bytes = Buffer.byteLength(JSON.stringify(base), 'utf8')
  const bounded = bytes > limits.maxSnapshotBytes ? { ...base, branch: [], canonicalMessages: [], effectiveSystemPrompt: null, observedMessages: undefined, available: false, missing: 'snapshot-byte-limit' } : base
  const canonicalHash = hash([sessionId, leafId, bounded.canonicalMessages, bounded.effectiveSystemPrompt, bounded.available])
  return immutable({ ...bounded, canonicalHash, revision: hash([canonicalHash, stage, bounded.observedMessages]) })
}
const invalidates = new Set<string>(['session_before_switch', 'session_before_fork', 'session_before_tree', 'session_tree', 'session_before_compact', 'session_compact', 'session_shutdown', 'context', 'context_with_system', 'input'])
function normalizedKind(e: any): string {
  if (e.type === 'tool_result') return 'tool.result.observed'
  if (e.type === 'tool_call') return 'tool.call.observed'
  if (e.type === 'message_end') return e.message?.role === 'user' ? 'user.input' : e.message?.role === 'toolResult' ? 'tool.result' : e.message?.role === 'assistant' ? 'assistant.message' : 'message.end'
  return e.type.replaceAll('_', '.')
}
export class PiMonitoringObserver {
  readonly limits: Readonly<ObservationLimits>
  private readonly run = randomUUID() // Host-owned observation correlation, never a native entry ID.
  private cursor = 0
  private bindingCount = 0
  private epoch = 0
  private binding?: Binding
  private readonly queue: Job[] = []
  private active?: Job
  private readonly retained: ObservationFrame[] = []
  private readonly results: ObservationOutcome[] = []
  private idleWaiters: Array<() => void> = []
  private evicted = 0
  private evictedOutcomes = 0
  private lastError = ''
  constructor(private readonly consumer: ObservationConsumer, limits: Partial<ObservationLimits> = {}) {
    this.limits = Object.freeze({ ...defaults, ...limits })
    if (this.limits.maxSnapshotBytes < 1024 || Object.entries(this.limits).some(([k, n]) => !Number.isSafeInteger(n) || n < (k === 'tailMessages' ? 0 : 1))) throw new Error('invalid observer limits')
  }
  get frames(): readonly ObservationFrame[] { return Object.freeze([...this.retained]) }
  get outcomes(): readonly ObservationOutcome[] { return Object.freeze([...this.results]) }
  getStatus() { return immutable({ sessionId: this.binding?.sessionId ?? null, observed: this.cursor, retained: this.retained.length, evicted: this.evicted, evictedOutcomes: this.evictedOutcomes, queued: this.queue.length, active: Boolean(this.active), epoch: this.epoch, lastError: this.lastError }) }
  open(ctx: ObservationContext): number {
    this.invalidate('session replaced')
    this.binding = undefined
    const probe = readObservationSnapshot(ctx, 'canonical_projection', undefined, this.limits)
    this.binding = { id: ++this.bindingCount, sessionId: probe.sessionId, context: ctx }
    return this.binding.id
  }
  record(bindingId: number, event: any, ctx: ObservationContext): void {
    const b = this.binding
    if (!b || b.id !== bindingId) return // An old runtime cannot publish into its replacement.
    try {
      if (ctx.sessionManager.getSessionId() !== b.sessionId) throw new Error('native session identity changed without rebind')
      b.context = ctx
      if (invalidates.has(event.type) || event.message?.stopReason === 'aborted' || event.type === 'agent_end' && ctx.signal?.aborted) this.invalidate(event.type)
      const stage: ObservationStage = event.type === 'context' ? 'context_conversation_at_hook' : event.type === 'context_with_system' ? 'context_with_system_at_hook' : 'canonical_projection'
      const snapshot = readObservationSnapshot(ctx, stage, event.messages, this.limits)
      const data = payload(event), tooLarge = Buffer.byteLength(JSON.stringify(data), 'utf8') > this.limits.maxSnapshotBytes
      const frame: ObservationFrame = immutable({ id: `observation:${this.run}:${++this.cursor}`, cursor: this.cursor, sourceEvent: event.type, kind: normalizedKind(event), sessionId: b.sessionId, binding: b.id, epoch: this.epoch, payload: tooLarge ? { omitted: 'payload-byte-limit' } : data, snapshot, available: snapshot.available && !tooLarge })
      this.retained.push(frame)
      if (this.retained.length > this.limits.maxRetained) { this.retained.shift(); this.evicted++ }
      if (!frame.available) this.publish({ frameId: frame.id, status: 'unavailable', reason: snapshot.missing ?? 'payload-byte-limit' })
      else if (this.queue.length >= this.limits.maxQueue) this.publish({ frameId: frame.id, status: 'overflow', reason: 'bounded diagnostic queue' })
      else { this.queue.push({ frame, binding: b, epoch: this.epoch, controller: new AbortController(), logicalDone: false }); queueMicrotask(() => this.pump()) }
      if (event.type === 'session_shutdown') this.close(bindingId)
    } catch (e) { this.fail(e) }
  }
  fail(e: unknown) { this.lastError = errorText(e); this.publish({ status: 'error', reason: this.lastError }) }
  close(bindingId?: number) { if (bindingId !== undefined && this.binding?.id !== bindingId) return; this.invalidate('closed'); this.binding = undefined; this.notifyIdle() }
  private invalidate(reason: string) {
    this.epoch++
    for (const job of this.queue.splice(0)) { job.controller.abort(reason); this.publish({ frameId: job.frame.id, status: 'cancelled', reason }) }
    this.active?.controller.abort(reason)
    this.notifyIdle()
  }
  private current(job: Job) {
    if (job.controller.signal.aborted || this.binding !== job.binding || job.epoch !== this.epoch) return false
    try { return readObservationSnapshot(job.binding.context, 'canonical_projection', undefined, this.limits).canonicalHash === job.frame.snapshot.canonicalHash } catch { return false }
  }
  private publish(value: ObservationOutcome) { this.results.push(immutable(value)); if (this.results.length > this.limits.maxRetained) { this.results.shift(); this.evictedOutcomes++ } }
  private pump() {
    if (this.active) return
    const job = this.queue.shift()
    if (!job) { this.notifyIdle(); return }
    if (!this.current(job)) { this.publish({ frameId: job.frame.id, status: 'stale', reason: 'superseded before diagnostic consumer' }); queueMicrotask(() => this.pump()); return }
    this.active = job
    const timer = setTimeout(() => { job.logicalDone = true; job.controller.abort('observer worker deadline'); this.publish({ frameId: job.frame.id, status: 'timeout', reason: 'physical slot remains until actual settlement' }) }, this.limits.workerTimeoutMs)
    const operation = Promise.resolve().then(() => this.consumer(job.frame, { signal: job.controller.signal, isCurrent: () => this.current(job) }))
    void operation.then(() => { if (!job.logicalDone) this.publish({ frameId: job.frame.id, status: this.current(job) ? 'handled' : 'stale', reason: 'diagnostic callback settled; not delivery/action acceptance' }) }, e => { if (!job.logicalDone) this.publish({ frameId: job.frame.id, status: job.controller.signal.aborted ? 'cancelled' : 'error', reason: errorText(e) }) }).finally(() => { clearTimeout(timer); this.active = undefined; this.pump() })
  }
  idle(): Promise<void> { if (!this.active && !this.queue.length) return Promise.resolve(); return new Promise(resolve => this.idleWaiters.push(resolve)) }
  private notifyIdle() { if (!this.active && !this.queue.length) for (const resolve of this.idleWaiters.splice(0)) resolve() }
}
export function createPiObservationExtension(options: { enabled?: boolean; observer: PiMonitoringObserver }) {
  return (pi: { on(event: any, handler: any): unknown }): void => {
    if (options.enabled !== true) return
    let binding: number | undefined
    for (const eventName of observationEvents) pi.on(eventName, (event: any, ctx: ObservationContext) => {
      try {
        if (eventName === 'session_start') binding = options.observer.open(ctx)
        if (binding !== undefined) options.observer.record(binding, event, ctx)
      } catch (e) { options.observer.fail(e) }
      return undefined // Notification/read-only: never replace input/context/results or continue a run.
    })
  }
}
