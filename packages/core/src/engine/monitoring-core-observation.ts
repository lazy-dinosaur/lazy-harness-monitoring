import { createHash } from 'node:crypto'
import { MonitoringCore, type CoreEvent, type EventReport, type Grants, type JudgeBatchPort, type Limits, type Processor, type ProposalRequest, type Receipt, type Reference } from './monitoring-core.ts'
import type { ObservationFrame } from '../observer/monitoring-observer.ts'

export type ObservationLease = Readonly<{ signal: AbortSignal; isCurrent(): boolean }>
export type MaterialSource = Readonly<{ observationId: string; sessionId: string; binding: number; cursor: number; settlementId: string; snapshotRevision: string }>
export type MaterialEnvelope = ProposalRequest & Readonly<{ destination: string; source: MaterialSource; contentHash: string }>
export type MaterialAck = Readonly<{ status: 'received' | 'rejected'; requestId: string; destination: string; contentHash: string; recordId?: string; reason?: string }>
export type MaterialReceiver = (material: MaterialEnvelope, lease: ObservationLease) => Promise<MaterialAck> | MaterialAck
export type SourceDelivery = Readonly<{ observationId: string; cursor: number; kind: string; status: 'processed' | 'deferred'; reason?: string; core?: EventReport }>
export type BridgeReport = Readonly<{ settlementId: string; sessionId: string; cursor: number; status: 'processed' | 'deferred' | 'stale' | 'duplicate'; reason: string; sources: readonly SourceDelivery[] }>
export type BridgeLimits = { maxBatches: number; maxFrames: number; maxSources: number; maxRetained: number; maxMaterialBytes: number; maxReferences: number; maxReferenceBytes: number }
export type BridgeOptions = { enabled?: boolean; goal: string; references: readonly Reference[]; processors: readonly { spec: Processor; grants: Grants; destination: string }[]; receiver: MaterialReceiver; judgeBatch?: JudgeBatchPort; limits?: Partial<BridgeLimits>; coreLimits?: Partial<Limits> }
type Batch = { settlement: ObservationFrame; lease: ObservationLease; version: string; sources: Map<string, MaterialSource> }
const defaults: BridgeLimits = { maxBatches: 32, maxFrames: 512, maxSources: 64, maxRetained: 32, maxMaterialBytes: 65536, maxReferences: 64, maxReferenceBytes: 65536 }
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const copy = <T>(x: T): T => { const v = JSON.parse(JSON.stringify(x)); const freeze = (y: any): any => { if (y && typeof y === 'object') { Object.values(y).forEach(freeze); Object.freeze(y) } return y }; return freeze(v) }
const message = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 240)
const kinds = new Set(['user.input', 'assistant.message', 'tool.result'])
/** Exact wire digest: SHA256(JSON.stringify(envelope without contentHash)), preserving property order. */
export function materialContentHash(material: Omit<MaterialEnvelope, 'contentHash'>): string { return digest(material) }

/** Explicit source-host synthetic integration library. No automatic extension/package activation. */
export class MonitoringObservationBridge {
  readonly limits: Readonly<BridgeLimits>
  private readonly references: readonly Reference[]
  private readonly destinations = new Map<string, string>()
  private readonly core: MonitoringCore
  private readonly seen = new Map<string, { fingerprint: string; result: Promise<BridgeReport> }>()
  private readonly retained: BridgeReport[] = []
  private scanned = 0
  private evicted = 0
  private active?: Batch
  private disposed = false
  constructor(private readonly options: BridgeOptions) {
    this.limits = Object.freeze({ ...defaults, ...options.limits })
    if (Object.values(this.limits).some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('invalid bridge limits')
    if (options.references.length > this.limits.maxReferences || Buffer.byteLength(JSON.stringify(options.references), 'utf8') > this.limits.maxReferenceBytes) throw new Error('reference input limit')
    this.references = copy(options.references)
    this.core = new MonitoringCore({ judgeBatch: options.judgeBatch, limits: options.coreLimits, sink: (request, current, signal) => this.deliver(request, current, signal) })
    for (const { spec, grants, destination } of options.processors) {
      if (!destination || destination.length > 200) throw new Error('invalid destination')
      this.core.registerProcessor(spec, grants); this.destinations.set(spec.id, destination)
    }
  }
  get reports(): readonly BridgeReport[] { return Object.freeze([...this.retained]) }
  getStatus() { return copy({ enabled: this.options.enabled === true, disposed: this.disposed, scannedCursor: this.scanned, batches: this.seen.size, retained: this.retained.length, evicted: this.evicted, core: this.core.getStatus() }) }
  /** Invoke from the observer's diagnostic consumer with its existing bounded frame ring. */
  consume(settlement: ObservationFrame, history: readonly ObservationFrame[], lease: ObservationLease): Promise<BridgeReport | undefined> {
    if (this.options.enabled !== true || settlement.sourceEvent !== 'agent_settled') return Promise.resolve(undefined)
    const fail = (reason: string) => Promise.resolve(this.publish({ settlementId: settlement.id, sessionId: settlement.sessionId, cursor: settlement.cursor, status: 'deferred', reason, sources: [] }))
    if (this.disposed) return fail('bridge disposed')
    if (history.length > this.limits.maxFrames) return fail('frame input limit; not scanned')
    const fingerprint = digest([settlement, history.map(f => [f.id, f.cursor, f.sessionId, f.binding, f.snapshot.revision, f.payload])])
    const prior = this.seen.get(settlement.id)
    if (prior) return prior.fingerprint !== fingerprint ? fail('settlement identity conflict') : prior.result.then(r => copy({ ...r, status: 'duplicate' as const, reason: 'same settlement; no redelivery' }))
    if (this.seen.size >= this.limits.maxBatches) return fail('batch lifetime budget; not scanned')
    const result = this.process(settlement, history, lease)
    this.seen.set(settlement.id, { fingerprint, result })
    return result
  }
  private publish(report: BridgeReport): BridgeReport {
    const fixed = copy(report); this.retained.push(fixed)
    if (this.retained.length > this.limits.maxRetained) { this.retained.shift(); this.evicted++ }
    return fixed
  }
  private current(batch: Batch) { return !this.disposed && this.active === batch && !batch.lease.signal.aborted && batch.lease.isCurrent() }
  private async process(settlement: ObservationFrame, history: readonly ObservationFrame[], lease: ObservationLease): Promise<BridgeReport> {
    const sources: SourceDelivery[] = []
    const report = (status: BridgeReport['status'], reason: string) => this.publish({ settlementId: settlement.id, sessionId: settlement.sessionId, cursor: settlement.cursor, status, reason, sources })
    if (!Number.isSafeInteger(settlement.cursor) || settlement.cursor <= this.scanned) return report('deferred', 'nonmonotonic source cursor; use a new bridge for a new observer')
    const start = this.scanned, window = history.filter(f => f.cursor > start && f.cursor <= settlement.cursor)
    this.scanned = settlement.cursor
    const candidates = window.filter(f => f.sourceEvent === 'message_end' && kinds.has(f.kind))
    const deferAll = (reason: string) => { candidates.slice(0, this.limits.maxSources).filter(f => !sources.some(s => s.observationId === f.id)).forEach(f => sources.push({ observationId: f.id, cursor: f.cursor, kind: f.kind, status: 'deferred', reason })); return report('deferred', reason) }
    if (window.length !== settlement.cursor - start || window.some((f, i) => f.cursor !== start + i + 1) || window.at(-1)?.id !== settlement.id) return deferAll('source cursor gap/order mismatch; unknown omitted sources')
    if (candidates.length > this.limits.maxSources) return deferAll(`source count limit; ${candidates.length} candidates not delivered`)
    if (!settlement.available || !settlement.snapshot.available) return deferAll('settled snapshot unavailable')
    if (lease.signal.aborted || !lease.isCurrent()) return deferAll('settlement lease stale/cancelled')
    if (window.some(f => f.binding === settlement.binding && f.sessionId === settlement.sessionId && (f.payload as any)?.message?.stopReason === 'aborted')) return deferAll('SDK run aborted')
    this.core.stop()
    const version = digest([settlement.id, settlement.snapshot.revision, this.references])
    const batch: Batch = { settlement, lease, version, sources: new Map() }
    this.active = batch
    const onAbort = () => { if (this.active === batch) this.core.stop() }
    lease.signal.addEventListener('abort', onAbort, { once: true })
    try {
      this.core.setContext({ scopeId: digest([settlement.sessionId, settlement.binding]), version, goal: this.options.goal, references: this.references })
      this.core.start()
      const canonical = new Set(settlement.snapshot.canonicalMessages.map(m => JSON.stringify(m)))
      for (const source of candidates) {
        const nativeMessage = (source.payload as any)?.message
        const defer = (reason: string) => sources.push({ observationId: source.id, cursor: source.cursor, kind: source.kind, status: 'deferred', reason })
        if (source.sessionId !== settlement.sessionId || source.binding !== settlement.binding) { defer('source belongs to superseded binding/session'); continue }
        if (!source.available || !nativeMessage) { defer('source payload unavailable'); continue }
        if (!canonical.has(JSON.stringify(nativeMessage))) { defer('source no longer contributes unchanged to current projection'); continue }
        if (!this.current(batch)) { defer('source lease no longer current'); continue }
        const sourceInfo: MaterialSource = copy({ observationId: source.id, sessionId: source.sessionId, binding: source.binding, cursor: source.cursor, settlementId: settlement.id, snapshotRevision: settlement.snapshot.revision })
        batch.sources.set(source.id, sourceInfo)
        const text = typeof nativeMessage.content === 'string' ? nativeMessage.content : Array.isArray(nativeMessage.content) ? nativeMessage.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : ''
        const event: CoreEvent = { id: source.id, kind: source.kind, scopeId: digest([settlement.sessionId, settlement.binding]), contextVersion: version, sequence: source.cursor, payload: copy({ text, message: nativeMessage, source: sourceInfo }) as CoreEvent['payload'] }
        const core = await this.core.acceptEvent(event)
        sources.push({ observationId: source.id, cursor: source.cursor, kind: source.kind, status: core.status === 'processed' ? 'processed' : 'deferred', ...(core.reason ? { reason: core.reason } : {}), core })
      }
      return report(this.current(batch) ? 'processed' : 'stale', this.current(batch) ? 'source scan and core processing complete; inspect individual outcomes' : 'lease superseded; no late delivery counted')
    } catch (error) { return deferAll(message(error)) }
    finally { lease.signal.removeEventListener('abort', onAbort); if (this.active === batch) { this.core.stop(); this.active = undefined } }
  }
  private async deliver(request: ProposalRequest, coreCurrent: () => boolean, signal: AbortSignal): Promise<Receipt> {
    const batch = this.active, source = batch?.sources.get(request.eventId), destination = this.destinations.get(request.processorId)
    const reject = (reason: string): Receipt => ({ requestId: request.requestId, status: 'rejected', reason })
    if (!batch || !source || !destination || request.contextVersion !== batch.version) return reject('no active source-bound destination')
    const isCurrent = () => !signal.aborted && coreCurrent() && this.current(batch)
    if (!isCurrent()) return reject('lease stale before receiver handoff')
    const body = copy({ ...request, destination, source })
    const envelope: MaterialEnvelope = copy({ ...body, contentHash: materialContentHash(body) })
    if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > this.limits.maxMaterialBytes) return reject('material byte limit')
    const ack = await this.options.receiver(envelope, { signal, isCurrent })
    if (!isCurrent()) return reject('lease stale after receiver handoff')
    if (!ack || ack.status !== 'received' || ack.requestId !== request.requestId || ack.destination !== destination || ack.contentHash !== envelope.contentHash || typeof ack.recordId !== 'string' || !ack.recordId || ack.recordId.length > 200) return reject('receiver acknowledgement missing/mismatched/rejected')
    return { requestId: request.requestId, status: 'recorded', recordId: ack.recordId }
  }
  dispose() { this.disposed = true; this.active = undefined; this.core.dispose() }
}
