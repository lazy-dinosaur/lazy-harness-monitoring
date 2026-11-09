export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Reference = Readonly<{ id: string; kind: string; version: string; content: string }>
export type ContextSnapshot = Readonly<{ scopeId: string; version: string; goal: string; references: readonly Reference[] }>
export type CoreEvent = Readonly<{ id: string; kind: string; scopeId: string; contextVersion: string; sequence: number; payload: Json }>
export type Decision = Readonly<{ mode: 'run' | 'skip' | 'defer'; reason: string; evidenceRefs: readonly string[]; confidence?: number }>
export type JudgeQuestion = Readonly<{ instructions: string; criteria: Readonly<Record<Decision['mode'], string>>; reference?: Readonly<{ instructions: string; criteria: Readonly<{ true: string; false: string }> }>; /** false = ask no per-item selection questions (verification stages). */ selectReferences?: false }>
export type View = Readonly<{ event: CoreEvent; eventRef: string; context: ContextSnapshot }>
export type JudgeTask = Readonly<{ processorId: string; question: JudgeQuestion; view: View }>
export type JudgeBatchPort = (tasks: readonly JudgeTask[], signal: AbortSignal) => Promise<Record<string, Decision>>
export type Proposal = Readonly<{ kind: string; payload: Json; evidenceRefs: readonly string[] }>
export type ProposalRequest = Proposal & Readonly<{ requestId: string; processorId: string; eventId: string; scopeId: string; contextVersion: string }>
export type Receipt = Readonly<{ requestId: string; status: 'recorded' | 'rejected' | 'unknown'; recordId?: string; reason?: string }>
export type ProposalSink = (request: ProposalRequest, isCurrent: () => boolean, signal: AbortSignal) => Promise<Receipt> | Receipt
export type Invocation = Readonly<{ view: View; decision: Decision; signal: AbortSignal; readReference: (id: string) => Promise<Reference> }>
export type Processor = Readonly<{ id: string; eventKinds: readonly string[]; referenceKinds: readonly string[]; allowedActions: readonly string[]; question?: JudgeQuestion; run: (invocation: Invocation) => Promise<readonly Proposal[]> | readonly Proposal[] }>
export type Grants = Readonly<{ actions: readonly string[]; referenceKinds: readonly string[] }>
export type Outcome = Readonly<{ processorId: string; status: 'recorded' | 'no-action' | 'skipped' | 'deferred' | 'failed' | 'cancelled' | 'stale' | 'unverified'; reason: string; decision?: Decision; readRefs: readonly string[]; receipts: readonly Receipt[] }>
export type EventReport = Readonly<{ eventId: string; status: 'processed' | 'duplicate' | 'stale' | 'stopped' | 'rejected'; reason?: string; outcomes: readonly Outcome[] }>
export type Limits = { maxEvents: number; maxJudgeBatches: number; maxExecutions: number; maxConcurrent: number; maxQueued: number; maxReads: number; maxProposals: number; timeoutMs: number }
type Entry = Readonly<{ spec: Processor; grant: Grants }>
type Work = { controller: AbortController; scopeId: string; version: string; epoch: number; processorId?: string; timer: ReturnType<typeof setTimeout> }
type Waiter = { signal: AbortSignal; resolve: (release: () => void) => void; reject: (error: Error) => void; abort: () => void }
const defaults: Limits = { maxEvents: 128, maxJudgeBatches: 128, maxExecutions: 256, maxConcurrent: 2, maxQueued: 128, maxReads: 8, maxProposals: 4, timeoutMs: 10000 }
const text = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300)
function assertJson(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error('JSON nesting limit')
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
  if (Array.isArray(value)) { for (const item of value) assertJson(item, depth + 1); return }
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) { for (const item of Object.values(value)) assertJson(item, depth + 1); return }
  throw new Error('non-JSON payload')
}
function immutable<T>(value: T): T {
  const json = JSON.stringify(value)
  if (!json || json.length > 131072) throw new Error('invalid or excessive JSON data')
  const freeze = (x: any): any => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x) } return x }
  return freeze(JSON.parse(json))
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error(String(signal.reason ?? 'cancelled'))) }
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

/** Explicit portable library. No event hooks, model SDK, business storage or daemon. */
export class MonitoringCore {
  private running = false
  private disposed = false
  private epoch = 0
  private readonly registry = new Map<string, Entry>()
  private readonly contexts = new Map<string, ContextSnapshot>()
  private readonly sequences = new Map<string, number>()
  private readonly seen = new Map<string, { fingerprint: string; result: Promise<EventReport> }>()
  private readonly work = new Set<Work>()
  private readonly queue: Waiter[] = []
  private physicalActive = 0
  private pendingEvents = 0
  private judgeBatches = 0
  private executions = 0
  readonly limits: Readonly<Limits>
  constructor(private readonly ports: { judgeBatch?: JudgeBatchPort; sink: ProposalSink; readReference?: (reference: Reference, context: ContextSnapshot, signal: AbortSignal) => Promise<Reference>; limits?: Partial<Limits> }) {
    this.limits = Object.freeze({ ...defaults, ...ports.limits })
    for (const [key, value] of Object.entries(this.limits)) if (!Number.isSafeInteger(value) || value < (['maxJudgeBatches', 'maxExecutions'].includes(key) ? 0 : 1)) throw new Error(`invalid limit ${key}`)
  }
  registerProcessor(spec: Processor, grant: Grants): () => void {
    if (this.disposed || !/^[a-z][a-z0-9._-]{1,79}$/.test(spec.id) || this.registry.has(spec.id)) throw new Error('invalid or duplicate processor')
    if (!spec.eventKinds.length || spec.eventKinds.length > 32 || [...spec.eventKinds, ...spec.referenceKinds, ...spec.allowedActions].some(x => !text(x))) throw new Error('invalid processor declaration')
    if (spec.allowedActions.some(x => !grant.actions.includes(x)) || spec.referenceKinds.some(x => !grant.referenceKinds.includes(x))) throw new Error('processor exceeds host grants')
    if (spec.question && (!text(spec.question.instructions) || ['run', 'skip', 'defer'].some(k => !text(spec.question!.criteria[k as Decision['mode']])) || (spec.question.reference !== undefined && (!text(spec.question.reference.instructions) || !text(spec.question.reference.criteria?.true) || !text(spec.question.reference.criteria?.false))))) throw new Error('invalid judge question')
    const { run, ...metadata } = spec
    if (typeof run !== 'function') throw new Error('missing processor handler')
    const entry: Entry = Object.freeze({ spec: Object.freeze({ ...immutable(metadata), run }), grant: immutable(grant) })
    this.registry.set(spec.id, entry)
    return () => { if (this.registry.get(spec.id) === entry) this.unregisterProcessor(spec.id) }
  }
  unregisterProcessor(id: string): boolean {
    const removed = this.registry.delete(id)
    for (const work of this.work) if (work.processorId === id) work.controller.abort('unregistered')
    return removed
  }
  setContext(input: ContextSnapshot) {
    if (this.disposed || !text(input.scopeId) || !text(input.version) || typeof input.goal !== 'string') throw new Error('invalid context')
    const context = immutable(input)
    if (new Set(context.references.map(r => r.id)).size !== context.references.length || context.references.some(r => !text(r.id) || r.id.startsWith('event:') || !text(r.kind) || !text(r.version) || typeof r.content !== 'string')) throw new Error('invalid reference snapshot')
    const previous = this.contexts.get(context.scopeId)
    if (previous?.version === context.version) {
      if (JSON.stringify(previous) !== JSON.stringify(context)) throw new Error('context version reused with different data')
      return
    }
    this.contexts.set(context.scopeId, context); this.sequences.delete(context.scopeId)
    for (const work of this.work) if (work.scopeId === context.scopeId) work.controller.abort('context changed')
  }
  start() { if (this.disposed) throw new Error('disposed'); if (!this.running) { this.running = true; this.epoch++ } }
  stop() { this.running = false; this.epoch++; for (const work of this.work) work.controller.abort('stopped') }
  dispose() { this.stop(); this.disposed = true; this.registry.clear(); this.contexts.clear(); this.seen.clear(); this.sequences.clear() }
  getStatus() { return immutable({ state: this.disposed ? 'disposed' : this.running ? 'running' : 'stopped', processors: [...this.registry.keys()], active: this.physicalActive, queued: this.queue.length, pendingEvents: this.pendingEvents, used: { events: this.seen.size, judgeBatches: this.judgeBatches, executions: this.executions } }) }
  async acceptEvent(input: CoreEvent): Promise<EventReport> {
    if (![input.id, input.kind, input.scopeId, input.contextVersion].every(text) || !Number.isSafeInteger(input.sequence) || input.sequence < 0) throw new Error('invalid event identity')
    assertJson(input.payload)
    const event = immutable(input)
    if (!this.running || this.disposed) return { eventId: event.id, status: 'stopped', outcomes: [] }
    const context = this.contexts.get(event.scopeId)
    if (!context || context.version !== event.contextVersion) return { eventId: event.id, status: 'stale', outcomes: [] }
    const key = JSON.stringify([event.scopeId, event.contextVersion, event.id]), fingerprint = JSON.stringify(event)
    const prior = this.seen.get(key)
    if (prior) return prior.fingerprint === fingerprint ? { ...await prior.result, status: 'duplicate' } : { eventId: event.id, status: 'rejected', reason: 'event identity conflict', outcomes: [] }
    if (event.sequence <= (this.sequences.get(event.scopeId) ?? -1)) return { eventId: event.id, status: 'stale', reason: 'out of order', outcomes: [] }
    if (this.seen.size >= this.limits.maxEvents) return { eventId: event.id, status: 'rejected', reason: 'event budget', outcomes: [] }
    this.sequences.set(event.scopeId, event.sequence); this.pendingEvents++
    const entries = [...this.registry.values()].filter(e => e.spec.eventKinds.includes(event.kind))
    const result = this.process(event, context, entries)
    this.seen.set(key, { fingerprint, result })
    void result.then(() => this.pendingEvents--, () => this.pendingEvents--)
    return result
  }
  private createWork(context: ContextSnapshot, processorId?: string): Work {
    const controller = new AbortController()
    const work: Work = { controller, scopeId: context.scopeId, version: context.version, epoch: this.epoch, processorId, timer: setTimeout(() => controller.abort('deadline'), this.limits.timeoutMs) }
    this.work.add(work); return work
  }
  private closeWork(work: Work) { clearTimeout(work.timer); this.work.delete(work) }
  private current(work: Work, entry?: Entry) { return this.running && !this.disposed && work.epoch === this.epoch && !work.controller.signal.aborted && this.contexts.get(work.scopeId)?.version === work.version && (!entry || this.registry.get(entry.spec.id) === entry) }
  private releaseSlot(): () => void {
    let held = true
    return () => {
      if (!held) return; held = false; this.physicalActive--
      while (this.queue.length) {
        const next = this.queue.shift()!; next.signal.removeEventListener('abort', next.abort)
        if (next.signal.aborted) continue
        this.physicalActive++; next.resolve(this.releaseSlot()); break
      }
    }
  }
  private acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new Error(String(signal.reason)))
    if (this.physicalActive < this.limits.maxConcurrent) { this.physicalActive++; return Promise.resolve(this.releaseSlot()) }
    if (this.queue.length >= this.limits.maxQueued) return Promise.reject(new Error('queue limit'))
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { signal, resolve, reject, abort: () => { const i = this.queue.indexOf(waiter); if (i >= 0) this.queue.splice(i, 1); reject(new Error(String(signal.reason))) } }
      signal.addEventListener('abort', waiter.abort, { once: true }); this.queue.push(waiter)
    })
  }
  private async stage<T>(work: Work, operation: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
    const release = await this.acquire(work.controller.signal)
    const raw = Promise.resolve().then(() => { if (!this.current(work)) throw new Error('stale or cancelled'); return operation(work.controller.signal) })
    // Keep the physical slot even after logical timeout if an adapter ignores abort.
    void raw.then(release, release)
    return abortable(raw, work.controller.signal)
  }
  private view(event: CoreEvent, context: ContextSnapshot, entry: Entry): View {
    return immutable({ event, eventRef: `event:${event.id}`, context: { ...context, references: context.references.filter(r => entry.spec.referenceKinds.includes(r.kind) && entry.grant.referenceKinds.includes(r.kind)) } })
  }
  private validDecision(value: unknown, view: View): Decision {
    const d = value as Decision
    const allowed = new Set([view.eventRef, ...view.context.references.map(r => r.id)])
    if (!d || !['run', 'skip', 'defer'].includes(d.mode) || !text(d.reason) || !Array.isArray(d.evidenceRefs) || !d.evidenceRefs.length || d.evidenceRefs.some(id => !allowed.has(id)) || (d.confidence !== undefined && (!Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1))) throw new Error('missing or invalid judgement/evidence')
    return immutable(d)
  }
  private async process(event: CoreEvent, context: ContextSnapshot, entries: Entry[]): Promise<EventReport> {
    const jobs = new Map<Entry, Promise<Outcome>>()
    for (const entry of entries.filter(e => !e.spec.question)) jobs.set(entry, this.run(entry, event, context, { mode: 'run', reason: 'declared unconditional observer', evidenceRefs: [`event:${event.id}`] }))
    const questioned = entries.filter(e => e.spec.question)
    let decisions: Record<string, Decision> = {}, judgeError = ''
    if (questioned.length) {
      const work = this.createWork(context)
      try {
        if (this.judgeBatches >= this.limits.maxJudgeBatches) throw new Error('judge batch budget')
        if (!this.ports.judgeBatch) throw new Error('judge unavailable')
        this.judgeBatches++
        decisions = await this.stage(work, signal => this.ports.judgeBatch!(questioned.map(entry => ({ processorId: entry.spec.id, question: entry.spec.question!, view: this.view(event, context, entry) })), signal))
      } catch (error) { judgeError = message(error) } finally { this.closeWork(work) }
    }
    for (const entry of questioned) jobs.set(entry, this.run(entry, event, context, decisions?.[entry.spec.id], judgeError))
    return immutable({ eventId: event.id, status: 'processed', outcomes: await Promise.all(entries.map(e => jobs.get(e)!)) })
  }
  private async run(entry: Entry, event: CoreEvent, context: ContextSnapshot, raw: unknown, judgeError = ''): Promise<Outcome> {
    const view = this.view(event, context, entry), reads = new Set<string>(), receipts: Receipt[] = []
    const out = (status: Outcome['status'], reason: string, decision?: Decision): Outcome => immutable({ processorId: entry.spec.id, status, reason, decision, readRefs: [...reads], receipts })
    const work = this.createWork(context, entry.spec.id)
    let decision: Decision
    try {
      if (!this.current(work, entry)) return out(this.running ? 'stale' : 'cancelled', 'not current')
      try { if (judgeError) throw new Error(judgeError); decision = this.validDecision(raw, view) } catch (error) { return out('deferred', message(error)) }
      if (decision.mode !== 'run') return out(decision.mode === 'skip' ? 'skipped' : 'deferred', decision.reason, decision)
      if (this.executions >= this.limits.maxExecutions) throw new Error('execution budget')
      this.executions++
      let readCount = 0
      const proposals = await this.stage(work, signal => entry.spec.run({ view, decision, signal, readReference: async id => {
        if (!this.current(work, entry)) throw new Error('stale reference read')
        if (++readCount > this.limits.maxReads) throw new Error('read budget')
        const ref = view.context.references.find(r => r.id === id)
        if (!ref) throw new Error('reference not granted')
        const result = this.ports.readReference ? await this.ports.readReference(ref, context, signal) : ref
        if (!this.current(work, entry) || result.id !== ref.id || result.version !== ref.version || result.kind !== ref.kind || result.content !== ref.content) throw new Error('reference receipt mismatch or stale')
        reads.add(id); return immutable(result)
      } }))
      if (!this.current(work, entry)) return out(this.running ? 'stale' : 'cancelled', 'late execution discarded', decision)
      if (!Array.isArray(proposals) || proposals.length > this.limits.maxProposals) throw new Error('invalid proposal count')
      for (const proposal of proposals) assertJson(proposal?.payload)
      const requests = proposals.map((p: Proposal, index: number): ProposalRequest => {
        if (!p || !entry.spec.allowedActions.includes(p.kind) || !entry.grant.actions.includes(p.kind) || !Array.isArray(p.evidenceRefs) || !p.evidenceRefs.length || p.evidenceRefs.some(id => id !== view.eventRef && !reads.has(id))) throw new Error('proposal exceeds grants or lacks read evidence')
        return immutable({ ...p, requestId: JSON.stringify([context.scopeId, context.version, event.id, entry.spec.id, index]), processorId: entry.spec.id, eventId: event.id, scopeId: context.scopeId, contextVersion: context.version })
      })
      for (const request of requests) {
        const receipt = await this.stage(work, signal => {
          if (!this.current(work, entry)) throw new Error('late proposal discarded')
          return this.ports.sink(request, () => this.current(work, entry), signal)
        })
        if (!receipt || receipt.requestId !== request.requestId || !['recorded', 'rejected', 'unknown'].includes(receipt.status) || (receipt.status === 'recorded' && !text(receipt.recordId))) return out('unverified', 'invalid proposal receipt', decision)
        receipts.push(immutable(receipt))
      }
      return out(!requests.length ? 'no-action' : receipts.every(r => r.status === 'recorded') ? 'recorded' : 'unverified', 'proposal processing complete; not business-state acceptance', decision)
    } catch (error) {
      const status = !this.running || work.epoch !== this.epoch ? 'cancelled' : this.contexts.get(context.scopeId)?.version !== context.version || this.registry.get(entry.spec.id) !== entry ? 'stale' : 'failed'
      return out(status, message(error), raw && typeof raw === 'object' ? raw as Decision : undefined)
    } finally { this.closeWork(work) }
  }
}
