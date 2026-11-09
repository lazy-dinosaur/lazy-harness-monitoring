import { createHash } from 'node:crypto'
import { materialContentHash, type MaterialAck, type MaterialEnvelope, type MaterialReceiver, type ObservationLease } from './monitoring-core-observation.ts'

export type TriggerResult = Readonly<{ status: 'executed' | 'rejected' | 'unknown'; executionId: string; requestId: string; contentHash: string; effectId?: string; reason?: string }>
export type TriggerInvocation = ObservationLease & Readonly<{ executionId: string }>
export type TestTriggerHandler = Readonly<{ id: string; kind: string; destination: string; processorIds: readonly string[]; run(material: MaterialEnvelope, invocation: TriggerInvocation): Promise<TriggerResult> | TriggerResult }>
export type TriggerGrants = Readonly<{ kinds: readonly string[]; destinations: readonly string[]; processorIds: readonly string[] }>
export type TriggerRecord = Readonly<{ requestId: string; destination: string; contentHash: string; handlerId?: string; executionId?: string; status: 'executed' | 'rejected' | 'failed' | 'cancelled' | 'unverified'; reason: string; effectId?: string }>
export type TriggerLimits = { maxHandlers: number; maxExecutions: number; maxActive: number; maxRetained: number; maxMaterialBytes: number }
type Entry = { spec: TestTriggerHandler; key: string }
type Work = { entry: Entry; material: MaterialEnvelope; lease: ObservationLease; controller: AbortController; epoch: number; executionId: string }
const defaults: TriggerLimits = { maxHandlers: 16, maxExecutions: 64, maxActive: 2, maxRetained: 128, maxMaterialBytes: 65536 }
const name = (x: unknown): x is string => typeof x === 'string' && /^[a-z][a-z0-9._-]{1,79}$/.test(x)
const text = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length > 0 && x.length <= max
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const fixed = <T>(x: T): T => { const v = JSON.parse(JSON.stringify(x)); const freeze = (y: any): any => { if (y && typeof y === 'object') { Object.values(y).forEach(freeze); Object.freeze(y) } return y }; return freeze(v) }
const errorText = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 240)

/** P4 explicit source-host TEST target. Start is required; no production hook or executor. */
export class SyntheticTriggerRegistry {
  readonly limits: Readonly<TriggerLimits>
  private running = false
  private disposed = false
  private epoch = 0
  private used = 0
  private evicted = 0
  private readonly routes = new Map<string, Entry>()
  private readonly ids = new Map<string, Entry>()
  private readonly active = new Map<string, Work>()
  private readonly seen = new Map<string, { fingerprint: string; entry: Entry; epoch: number; result: Promise<MaterialAck> }>()
  private readonly retained: TriggerRecord[] = []
  constructor(limits: Partial<TriggerLimits> = {}) {
    this.limits = Object.freeze({ ...defaults, ...limits })
    if (Object.values(this.limits).some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('invalid trigger limits')
  }
  get records(): readonly TriggerRecord[] { return Object.freeze([...this.retained]) }
  getStatus() { return fixed({ state: this.disposed ? 'disposed' : this.running ? 'running' : 'stopped', handlers: [...this.ids.keys()], active: this.active.size, used: this.used, retained: this.retained.length, evicted: this.evicted }) }
  registerHandler(spec: TestTriggerHandler, grants: TriggerGrants): () => void {
    if (this.disposed || !name(spec.id) || !name(spec.kind) || !text(spec.destination) || !spec.processorIds.length || spec.processorIds.length > 16 || spec.processorIds.some(id => !name(id)) || typeof spec.run !== 'function') throw new Error('invalid trigger declaration')
    if (!grants.kinds.includes(spec.kind) || !grants.destinations.includes(spec.destination) || spec.processorIds.some(id => !grants.processorIds.includes(id))) throw new Error('trigger exceeds host grants')
    const key = JSON.stringify([spec.kind, spec.destination])
    if (this.routes.has(key) || this.ids.has(spec.id) || this.ids.size >= this.limits.maxHandlers) throw new Error('duplicate route/id or handler budget')
    const { run, ...metadata } = spec, entry: Entry = { key, spec: Object.freeze({ ...fixed(metadata), run }) }
    this.routes.set(key, entry); this.ids.set(spec.id, entry)
    return () => { if (this.ids.get(spec.id) === entry) this.unregisterHandler(spec.id) }
  }
  unregisterHandler(id: string): boolean {
    const entry = this.ids.get(id)
    if (!entry) return false
    this.ids.delete(id); this.routes.delete(entry.key)
    for (const work of this.active.values()) if (work.entry === entry) work.controller.abort('handler unregistered')
    return true
  }
  start() { if (this.disposed) throw new Error('trigger disposed'); if (!this.running) { this.running = true; this.epoch++ } }
  stop() { this.running = false; this.epoch++; for (const work of this.active.values()) work.controller.abort('trigger stopped') }
  dispose() { this.stop(); this.disposed = true; this.routes.clear(); this.ids.clear() }
  private append(record: TriggerRecord) { this.retained.push(fixed(record)); if (this.retained.length > this.limits.maxRetained) { this.retained.shift(); this.evicted++ } }
  private deny(material: Partial<MaterialEnvelope> | undefined, reason: string): MaterialAck {
    const identity = { requestId: typeof material?.requestId === 'string' ? material.requestId : '', destination: typeof material?.destination === 'string' ? material.destination : '', contentHash: typeof material?.contentHash === 'string' ? material.contentHash : '' }
    this.append({ ...identity, status: 'rejected', reason }); return fixed({ ...identity, status: 'rejected', reason })
  }
  private inputCurrent(lease: ObservationLease) { try { return !lease.signal.aborted && lease.isCurrent() } catch { return false } }
  private current(work: Work) { return this.running && !this.disposed && work.epoch === this.epoch && this.routes.get(work.entry.key) === work.entry && !work.controller.signal.aborted && this.inputCurrent(work.lease) }
  /** A receiver invocation never releases its physical caller slot before the raw handler settles. */
  readonly receive: MaterialReceiver = (input, lease) => {
    const reject = (reason: string) => Promise.resolve(this.deny(input, reason))
    if (!this.running || this.disposed) return reject(this.disposed ? 'trigger disposed' : 'trigger stopped')
    let material: MaterialEnvelope
    try {
      if (Buffer.byteLength(JSON.stringify(input), 'utf8') > this.limits.maxMaterialBytes) return reject('trigger material byte limit')
      material = fixed(input)
      if (!text(material.requestId, 4096) || !text(material.eventId) || !name(material.processorId) || !name(material.kind) || !text(material.destination) || !text(material.scopeId) || !text(material.contextVersion) || !/^[a-f0-9]{64}$/.test(material.contentHash)) return reject('invalid material identity')
      if (!material.source || material.source.observationId !== material.eventId || !text(material.source.sessionId) || !text(material.source.settlementId) || !text(material.source.snapshotRevision) || !Number.isSafeInteger(material.source.binding) || material.source.binding < 1 || !Number.isSafeInteger(material.source.cursor) || material.source.cursor < 1) return reject('invalid material source link')
      const { contentHash, ...body } = material
      if (materialContentHash(body) !== contentHash) return reject('material digest mismatch')
    } catch (e) { return reject(`invalid material: ${errorText(e)}`) }
    const entry = this.routes.get(JSON.stringify([material.kind, material.destination]))
    if (!entry || !entry.spec.processorIds.includes(material.processorId)) return reject('no granted exact handler route')
    if (!this.inputCurrent(lease)) return reject('source lease stale/cancelled')
    const fingerprint = hash(material), prior = this.seen.get(material.requestId)
    if (prior) {
      if (prior.fingerprint !== fingerprint) return reject('trigger request identity conflict')
      if (prior.entry !== entry || prior.epoch !== this.epoch) return reject('trigger handler binding/epoch changed')
      return prior.result.then(ack => this.inputCurrent(lease) && this.running && this.routes.get(entry.key) === entry && prior.epoch === this.epoch ? ack : this.deny(material, 'duplicate result no longer current'))
    }
    if (this.used >= this.limits.maxExecutions) return reject('trigger lifetime execution budget')
    if (this.active.size >= this.limits.maxActive) return reject('trigger active limit; no hidden queue')
    this.used++
    const executionId = `execution:${hash([entry.spec.id, material.requestId, material.contentHash, this.epoch])}`
    const work: Work = { entry, material, lease, controller: new AbortController(), epoch: this.epoch, executionId }
    this.active.set(executionId, work)
    // Reserve identity BEFORE invoking trusted code, including synchronous reentrant callbacks.
    const result = Promise.resolve().then(() => this.execute(work))
    this.seen.set(material.requestId, { fingerprint, entry, epoch: this.epoch, result })
    return result
  }
  private async execute(work: Work): Promise<MaterialAck> {
    const { material, entry, executionId } = work
    const onAbort = () => work.controller.abort('source cancelled')
    work.lease.signal.addEventListener('abort', onAbort, { once: true })
    const finish = (status: TriggerRecord['status'], reason: string, effectId?: string): MaterialAck => {
      this.append({ requestId: material.requestId, destination: material.destination, contentHash: material.contentHash, handlerId: entry.spec.id, executionId, status, reason, ...(effectId ? { effectId } : {}) })
      return fixed({ requestId: material.requestId, destination: material.destination, contentHash: material.contentHash, status: status === 'executed' ? 'received' : 'rejected', ...(status === 'executed' ? { recordId: executionId } : {}), reason })
    }
    try {
      if (!this.current(work)) return finish('cancelled', 'not current before handler')
      const result = await entry.spec.run(material, { executionId, signal: work.controller.signal, isCurrent: () => this.current(work) })
      if (!this.current(work)) return finish('cancelled', 'late handler result; no verified execution receipt')
      if (!result || result.executionId !== executionId || result.requestId !== material.requestId || result.contentHash !== material.contentHash || !['executed', 'rejected', 'unknown'].includes(result.status)) return finish('unverified', 'missing/mismatched execution result')
      if (result.status !== 'executed') return finish(result.status === 'unknown' ? 'unverified' : 'rejected', errorText(result.reason ?? result.status))
      if (!text(result.effectId)) return finish('unverified', 'executed result lacks effect identity')
      return finish('executed', 'controlled handler result verified; not a business-state claim', result.effectId)
    } catch (e) { return finish(work.controller.signal.aborted ? 'cancelled' : 'failed', errorText(e)) }
    finally { work.lease.signal.removeEventListener('abort', onAbort); this.active.delete(executionId) }
  }
}
