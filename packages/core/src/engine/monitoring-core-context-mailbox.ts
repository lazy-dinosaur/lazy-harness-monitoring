// Opt-in late-result mailbox for READ-ONLY context material (task140). Source-local; no hooks, timers or network.
// Policy: deliver at the next eligible main request in the same turn; otherwise carry ONCE to the next turn's first
// request with an origin/age label, only if scope and source dependency versions are unchanged and age <= maxAgeMs.
// Relevance to the new request is left to the main model: this owner never classifies user text.
export type CarryScope = Readonly<{ sessionId: string; branchId: string; turn: number }>
export type CarryDependency = Readonly<{ id: string; version: string }>
export type CarryItem = Readonly<{ id: string; moduleId: string; scope: CarryScope; createdAt: number; dependencies: readonly CarryDependency[]; text: string }>
export type CarryDelivery = Readonly<{ item: CarryItem; carried: boolean; ageMs: number; text: string }>
export type CarryTrace = Readonly<{ at: number; id: string; reason: 'queued' | 'delivered_same_turn' | 'delivered_carried' | 'scope_changed' | 'expired_age' | 'carry_exceeded' | 'source_changed' | 'duplicate' | 'overflow' | 'invalid' | 'seen_capacity' }>
export type CarryOptions = Readonly<{ maxAgeMs: number; maxCarryTurns: number; maxItems: number; maxTextBytes: number; maxTrace?: number; maxSeen?: number; sourceVersion(id: string): string | undefined }>

const text = (v: unknown, max = 512): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const scopeOk = (s: any): s is CarryScope => !!s && text(s.sessionId) && text(s.branchId) && Number.isSafeInteger(s.turn) && s.turn >= 0

export class ContextCarryMailbox {
  private readonly items = new Map<string, CarryItem>()
  private readonly seen = new Set<string>()
  private readonly log: CarryTrace[] = []
  private traceEvicted = 0
  private readonly options: CarryOptions
  constructor(options: CarryOptions) {
    if (!options || !Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 1 || !Number.isSafeInteger(options.maxCarryTurns) || options.maxCarryTurns < 0 || options.maxCarryTurns > 1 || !Number.isSafeInteger(options.maxItems) || options.maxItems < 1 || !Number.isSafeInteger(options.maxTextBytes) || options.maxTextBytes < 1 || typeof options.sourceVersion !== 'function') throw new Error('invalid carry mailbox options')
    if ([options.maxTrace ?? 256, options.maxSeen ?? 4096].some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('invalid carry retention bounds')
    this.options = Object.freeze({ ...options })
  }
  private note(at: number, id: string, reason: CarryTrace['reason']) { this.log.push(Object.freeze({ at, id, reason })); if (this.log.length > (this.options.maxTrace ?? 256)) { this.log.shift(); this.traceEvicted++ } }
  /** Queue prepared read-only material. A duplicate id is never queued twice, even after delivery. */
  put(item: CarryItem, now: number): boolean {
    if (!item || !text(item.id) || !text(item.moduleId) || !scopeOk(item.scope) || !Number.isFinite(item.createdAt) || !Array.isArray(item.dependencies) || item.dependencies.some(d => !d || !text(d.id) || !text(d.version)) || typeof item.text !== 'string' || !item.text || Buffer.byteLength(item.text, 'utf8') > this.options.maxTextBytes) { this.note(now, String(item?.id ?? ''), 'invalid'); return false }
    if (this.seen.has(item.id)) { this.note(now, item.id, 'duplicate'); return false }
    // Seen identities protect the whole mailbox lifetime, even after diagnostic eviction/delivery.
    if (this.seen.size >= (this.options.maxSeen ?? 4096)) { this.note(now, item.id, 'seen_capacity'); return false }
    if (this.items.size >= this.options.maxItems) { this.note(now, item.id, 'overflow'); return false }
    this.seen.add(item.id); this.items.set(item.id, Object.freeze({ ...item, scope: Object.freeze({ ...item.scope }), dependencies: Object.freeze(item.dependencies.map(d => Object.freeze({ ...d }))) })); this.note(now, item.id, 'queued'); return true
  }
  /** Called at a main request (context hook). Returns material to append now; drops ineligible items with a reason. */
  take(scope: CarryScope, now: number, firstRequestOfTurn: boolean): readonly CarryDelivery[] {
    if (!scopeOk(scope)) throw new Error('invalid carry scope')
    const out: CarryDelivery[] = []
    for (const [id, item] of this.items) {
      const drop = (reason: CarryTrace['reason']) => { this.items.delete(id); this.note(now, id, reason) }
      if (item.scope.sessionId !== scope.sessionId || item.scope.branchId !== scope.branchId || scope.turn < item.scope.turn) { drop('scope_changed'); continue }
      const ageMs = now - item.createdAt
      if (ageMs > this.options.maxAgeMs) { drop('expired_age'); continue }
      if (item.dependencies.some(d => this.options.sourceVersion(d.id) !== d.version)) { drop('source_changed'); continue }
      const gap = scope.turn - item.scope.turn
      if (gap > this.options.maxCarryTurns || (gap === 1 && !firstRequestOfTurn)) { drop('carry_exceeded'); continue }
      const carried = gap === 1
      const label = carried ? `[이전 요청(turn ${item.scope.turn})에 대해 ${Math.round(ageMs / 1000)}초 전에 준비된 자료 — 현재 요청과 관련 없으면 무시]\n` : ''
      this.items.delete(id); this.note(now, id, carried ? 'delivered_carried' : 'delivered_same_turn')
      out.push(Object.freeze({ item, carried, ageMs, text: label + item.text }))
    }
    return Object.freeze(out)
  }
  getStatus() { return Object.freeze({ pending: this.items.size, seen: this.seen.size, traces: this.log.length, traceEvicted: this.traceEvicted }) }
  get pending(): number { return this.items.size }
  get traces(): readonly CarryTrace[] { return Object.freeze([...this.log]) }
}
