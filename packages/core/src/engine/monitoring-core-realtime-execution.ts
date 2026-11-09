import { createHash } from 'node:crypto'
import { freezeMonitoringData } from '../sdk/diagnostics.ts'
import { parseMonitoringJsonData } from '../sdk/schema.ts'
import type { RealtimeCandidate, RealtimeOffer } from './monitoring-core-realtime.ts'
import type { RealtimeSelectionPacket } from './monitoring-core-realtime-selection.ts'
import type { TriggerInvocation, TriggerResult } from './monitoring-core-trigger.ts'

export type RealtimeExecutionInvocation = TriggerInvocation & Readonly<{ contentHash: string; offerId: string }>
export type RealtimeExecutionRecord = Readonly<{ offerId: string; moduleId: string; destination: string; requestId: string; contentHash: string; executionId?: string; effectId?: string; status: 'executed' | 'rejected' | 'unverified' | 'failed' | 'cancelled'; reason: string; duplicate?: boolean }>
export type RealtimeExecutionLimits = Readonly<{ maxExecutions: number; maxActive: number; maxRecords: number; maxBytes: number; maxPackets: number }>
export type RealtimeExecutionPorts = Readonly<{
  /** Existing Host target-registry revision; change it on replacement/unregister. */
  readRevision(): string
  isPermitted(packet: RealtimeSelectionPacket): boolean
  execute(packet: RealtimeSelectionPacket, invocation: RealtimeExecutionInvocation): TriggerResult | Promise<TriggerResult>
}>
type Work = { candidate: RealtimeCandidate; packet: RealtimeSelectionPacket; sourceCurrent(): boolean; parent?: AbortSignal; controller: AbortController; revision: string; fingerprint: string; contentHash: string; executionId: string; revoked: boolean; promise: Promise<RealtimeExecutionRecord> }
const defaults: RealtimeExecutionLimits = { maxExecutions: 64, maxActive: 2, maxRecords: 128, maxBytes: 65536, maxPackets: 8 }
const data = <T>(v: T): T => freezeMonitoringData(parseMonitoringJsonData(v) as T)
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const text = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const count = (v: unknown, min = 0) => Number.isSafeInteger(v) && Number(v) >= min
const packet = (v: any): v is RealtimeSelectionPacket => !!v && ['moduleId', 'destination', 'requestId', 'eventId', 'scopeId', 'profileId', 'profileFingerprint'].every(k => text(v[k])) && (v.projectionVersion === undefined || text(v.projectionVersion)) && Array.isArray(v.evidenceRefs) && v.evidenceRefs.length <= 64 && v.evidenceRefs.every((r: unknown) => text(r)) && Array.isArray(v.materials) && v.materials.length > 0 && v.materials.length <= 64 && new Set(v.materials.map((m: any) => m?.id)).size === v.materials.length && v.materials.every((m: any) => m && text(m.id) && text(m.kind) && text(m.version) && typeof m.content === 'string' && typeof m.text === 'string' && typeof m.provisional === 'boolean' && m.provenance && ['observation', 'host'].includes(m.provenance.owner))

/** Opt-in C1 execution seam, not another worker/route registry or source authenticator.
 * Preserve the actual realtime packet: never invent a settled MaterialEnvelope.
 * Ports are trusted Host code; semantic input/effect validation remains with each target.
 * Receipt verification is not independent proof of a real external business commit. */
export class RealtimeExecutionConsumer {
  readonly limits: RealtimeExecutionLimits
  private state: 'idle' | 'running' | 'stopped' | 'disposed' = 'idle'
  private used = 0
  private evicted = 0
  private readonly active = new Set<Work>()
  private readonly seen = new Map<string, Work>()
  private readonly history: RealtimeExecutionRecord[] = []
  private readonly ports: RealtimeExecutionPorts
  constructor(private readonly enabled: boolean, ports: RealtimeExecutionPorts, limits: Partial<RealtimeExecutionLimits> = {}) {
    this.limits = Object.freeze({ ...defaults, ...limits })
    if (Object.values(this.limits).some(n => !Number.isSafeInteger(n) || n < 1) || ['readRevision', 'isPermitted', 'execute'].some(k => typeof (ports as any)?.[k] !== 'function')) throw Error('INVALID_EXECUTION_CONFIG')
    this.ports = Object.freeze({ readRevision: ports.readRevision.bind(ports), isPermitted: ports.isPermitted.bind(ports), execute: ports.execute.bind(ports) })
  }
  start() { if (this.enabled !== true || this.state !== 'idle') return false; this.state = 'running'; return true }
  stop() { if (this.state === 'disposed') return; this.state = 'stopped'; for (const w of this.active) { w.revoked = true; w.controller.abort('consumer stopped') } }
  dispose() { this.stop(); this.state = 'disposed' }
  getStatus() { return Object.freeze({ state: this.state, used: this.used, active: this.active.size, retained: this.history.length, evicted: this.evicted }) }
  get records(): readonly RealtimeExecutionRecord[] { return data(this.history) }
  private record(row: RealtimeExecutionRecord) { const r = data(row); this.history.push(r); if (this.history.length > this.limits.maxRecords) { this.history.shift(); this.evicted++ } return r }
  private deny(reason: string, candidate?: RealtimeCandidate, p?: RealtimeSelectionPacket, status: RealtimeExecutionRecord['status'] = 'rejected') { return this.record({ offerId: candidate?.id ?? '', moduleId: p?.moduleId ?? '', destination: p?.destination ?? '', requestId: p?.requestId ?? '', contentHash: '', status, reason }) }
  private current(w: Work) {
    if (w.revoked) return false
    let ok = false
    try { ok = this.state === 'running' && !w.controller.signal.aborted && !w.parent?.aborted && w.sourceCurrent() === true && this.ports.readRevision() === w.revision && this.ports.isPermitted(w.packet) === true } catch { /* private Host errors are not result text */ }
    if (!ok) { w.revoked = true; w.controller.abort('execution no longer current') }
    return ok
  }
  async consume(offer: RealtimeOffer, signal?: AbortSignal): Promise<readonly RealtimeExecutionRecord[]> {
    if (this.state !== 'running') return [this.deny('NOT_RUNNING')]
    let c: RealtimeCandidate, rows: unknown[], sourceCurrent: () => boolean
    try {
      const get = Object.getOwnPropertyDescriptor(offer, 'isCurrent'), raw = Object.getOwnPropertyDescriptor(offer, 'candidate')
      if (!get || get.get || get.set || typeof get.value !== 'function' || !raw || raw.get || raw.set) throw Error()
      sourceCurrent = get.value.bind(offer); c = data(raw.value)
      if (Buffer.byteLength(JSON.stringify(c)) > this.limits.maxBytes) throw Error()
      const { contentHash, ...body } = c
      if (c.channel !== 'module' || !text(c.id) || !text(c.frameId) || !text(c.sourceEvent) || !text(c.sessionId) || !count(c.binding, 1) || !count(c.epoch) || !count(c.generation) || !count(c.startedStep) || !count(c.readyStep) || typeof c.preparedAt !== 'number' || !Number.isFinite(c.preparedAt) || !Array.isArray(c.dependencies) || !c.dependencies.length || contentHash !== hash(body)) throw Error()
      const b = c.payload as any
      if (!b || b.kind !== 'monitoring.selected-material-batch' || b.eventId !== c.frameId || b.epoch !== c.epoch || b.generation !== c.generation || !Array.isArray(b.packets) || !b.packets.length || b.packets.length > this.limits.maxPackets) throw Error()
      rows = b.packets
    } catch { return [this.deny('INVALID_OFFER')] }
    return Object.freeze(await Promise.all(rows.map(p => {
      if (!packet(p) || p.eventId !== c.frameId) return Promise.resolve(this.deny('INVALID_PACKET', c))
      return this.dispatch(c, p, sourceCurrent, signal)
    })))
  }
  private dispatch(candidate: RealtimeCandidate, p: RealtimeSelectionPacket, sourceCurrent: () => boolean, parent?: AbortSignal): Promise<RealtimeExecutionRecord> {
    let revision: string
    try {
      revision = this.ports.readRevision()
      if (!text(revision) || this.state !== 'running' || parent?.aborted || sourceCurrent() !== true || this.ports.isPermitted(p) !== true) return Promise.resolve(this.deny('NOT_ADMITTED_OR_CURRENT', candidate, p))
    } catch { return Promise.resolve(this.deny('HOST_ADMISSION_ERROR', candidate, p)) }
    const contentHash = hash(p), fingerprint = hash([candidate.id, candidate.frameId, candidate.sessionId, candidate.binding, candidate.epoch, candidate.generation, p, revision])
    const prior = this.seen.get(p.requestId)
    if (prior) {
      if (prior.fingerprint !== fingerprint) return Promise.resolve(this.deny('IDENTITY_CONFLICT', candidate, p))
      return prior.promise.then(r => {
        // A duplicate has its own observation lease; cancelling it must neither
        // revive its receipt nor cancel the original physical execution.
        let fresh = false
        try { fresh = this.state === 'running' && !parent?.aborted && sourceCurrent() === true && this.ports.readRevision() === revision && this.ports.isPermitted(p) === true } catch { /* fail closed */ }
        return fresh && this.current(prior) ? this.record({ ...r, duplicate: true }) : this.deny('DUPLICATE_NO_LONGER_CURRENT', candidate, p, 'cancelled')
      })
    }
    if (this.used >= this.limits.maxExecutions) return Promise.resolve(this.deny('EXECUTION_LIMIT', candidate, p))
    if (this.active.size >= this.limits.maxActive) return Promise.resolve(this.deny('ACTIVE_LIMIT', candidate, p))
    const executionId = 'c1-execution:' + hash([++this.used, fingerprint])
    const w: Work = { candidate, packet: p, sourceCurrent, parent, controller: new AbortController(), revision, fingerprint, contentHash, executionId, revoked: false, promise: undefined as unknown as Promise<RealtimeExecutionRecord> }
    // Reserve identity and physical capacity BEFORE any execution callback or reentry.
    this.active.add(w); this.seen.set(p.requestId, w)
    w.promise = Promise.resolve().then(() => this.execute(w))
    return w.promise
  }
  private async execute(w: Work): Promise<RealtimeExecutionRecord> {
    const onAbort = () => { w.revoked = true; w.controller.abort('caller cancelled') }
    w.parent?.addEventListener('abort', onAbort, { once: true })
    const finish = (status: RealtimeExecutionRecord['status'], reason: string, effectId?: string) => this.record({ offerId: w.candidate.id, moduleId: w.packet.moduleId, destination: w.packet.destination, requestId: w.packet.requestId, contentHash: w.contentHash, executionId: w.executionId, status, reason, ...(effectId ? { effectId } : {}) })
    try {
      if (!this.current(w)) return finish('cancelled', 'NOT_CURRENT_BEFORE_EXECUTION')
      // No candidate/batch/other-module bodies or whole-batch digests cross this port.
      const raw = await this.ports.execute(w.packet, Object.freeze({ executionId: w.executionId, contentHash: w.contentHash, offerId: w.candidate.id, signal: w.controller.signal, isCurrent: () => this.current(w) }))
      if (!this.current(w)) return finish('cancelled', 'LATE_RESULT')
      let r: TriggerResult
      try { r = data(raw) } catch { return finish('unverified', 'INVALID_RESULT') }
      if (!r || r.executionId !== w.executionId || r.requestId !== w.packet.requestId || r.contentHash !== w.contentHash || !['executed', 'rejected', 'unknown'].includes(r.status)) return finish('unverified', 'RESULT_IDENTITY_MISMATCH')
      if (r.status !== 'executed') return finish(r.status === 'unknown' ? 'unverified' : 'rejected', r.status === 'unknown' ? 'TARGET_UNKNOWN' : 'TARGET_REJECTED')
      if (!text(r.effectId)) return finish('unverified', 'MISSING_EFFECT_ID')
      return finish('executed', 'CONTROLLED_EXECUTION_RECEIPT', r.effectId)
    } catch { return finish(this.current(w) ? 'failed' : 'cancelled', 'TARGET_FAILED') }
    finally { w.parent?.removeEventListener('abort', onAbort); this.active.delete(w) }
  }
  /** Observing idle never forces/cancels raw work. Abort cancels this wait only. */
  async idle(signal?: AbortSignal): Promise<void> {
    while (this.active.size) {
      if (signal?.aborted) throw Error('IDLE_WAIT_ABORTED')
      const wait = Promise.allSettled([...this.active].map(w => w.promise))
      if (!signal) { await wait; continue }
      await new Promise<void>((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort); reject(Error('IDLE_WAIT_ABORTED')) }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) { abort(); return }
        void wait.then(() => { signal.removeEventListener('abort', abort); resolve() })
      })
    }
  }
}
