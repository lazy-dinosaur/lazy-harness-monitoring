import Type, { type Static } from 'typebox'
import { InputPortScopeSchema, sameInputPortScope, validatePortData } from '../host/input-ports.ts'
import { canonicalJsonHash } from '../sdk/canonical-json.ts'
import type { CarryItem } from '../engine/monitoring-core-context-mailbox.ts'
import type { JobOutcome, Report, ReportEnqueueReceipt } from '../engine/monitoring-engine-runtime.ts'

const strict = { additionalProperties: false } as const
const text = () => Type.String({ minLength: 1, maxLength: 512 })
const count = () => Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const caps = Type.Object(Object.fromEntries(['judgeCalls', 'workerDispatches', 'sdkCalls', 'embeddingCalls', 'usd'].map(k => [k, Type.Optional(Type.Number({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))])), strict)
const BindingSchema = Type.Object({ bindingId: text(), moduleId: text(), declarationHash: text(), configHash: text(), modelFingerprint: text(), scope: InputPortScopeSchema }, strict)
export type StateBinding = Readonly<Static<typeof BindingSchema>>
const OutcomeSchema = Type.Object({ moduleId: text(), jobId: text(), eventId: text(), key: Type.Optional(text()), status: Type.Union([Type.Literal('executed'), Type.Literal('proposed'), Type.Literal('prepared'), Type.Literal('rejected'), Type.Literal('uncertain'), Type.Literal('skipped')]), reason: text(), effectId: Type.Optional(text()), reported: Type.Boolean(), reportReceipt: Type.Optional(Type.Object({ reportId: text(), status: Type.Union([Type.Literal('enqueued'), Type.Literal('failed'), Type.Literal('unknown')]), reason: Type.Optional(text()) }, strict)) }, strict)
const ReportSchema = Type.Object({ moduleId: text(), jobId: text(), eventId: text(), sessionId: text(), mode: Type.Union([Type.Literal('always'), Type.Literal('on-result')]), text: Type.String({ maxLength: 65536 }), riskTier: text() }, strict)
const WorkSchema = Type.Object({ key: text(), moduleId: text(), jobId: text(), eventId: text(), ordinal: count(), fence: count(), operationId: text(), status: Type.Union([Type.Literal('queued'), Type.Literal('started'), Type.Literal('executed'), Type.Literal('proposed'), Type.Literal('prepared'), Type.Literal('rejected'), Type.Literal('uncertain')]), rawSettled: Type.Boolean(), stage: Type.Union([Type.Literal('active'), Type.Literal('shadow')]), dependencies: Type.Array(Type.Object({ id: text(), version: text() }, strict), { maxItems: 4096 }), grantHash: text(), cost: Type.Optional(Type.Object({ approvalId: text(), windowKey: text(), caps, approvedCaps: caps }, strict)), outcome: Type.Optional(OutcomeSchema), report: Type.Optional(Type.Object({ id: text(), body: ReportSchema, receipt: Type.Union([Type.Literal('unknown'), Type.Literal('enqueued'), Type.Literal('failed')]) }, strict)) }, strict)
const ItemSchema = Type.Object({ id: text(), reportId: Type.Optional(text()), moduleId: text(), scope: Type.Object({ sessionId: text(), branchId: text(), turn: count() }, strict), createdAt: Type.Number(), dependencies: Type.Array(Type.Object({ id: text(), version: text() }, strict), { maxItems: 4096 }), text: Type.String({ minLength: 1, maxLength: 65536 }) }, strict)
const MailSchema = Type.Object({ id: text(), fence: count(), generation: InputPortScopeSchema, status: Type.Union([Type.Literal('queued'), Type.Literal('delivery-uncertain'), Type.Literal('delivered'), Type.Literal('dropped')]), item: Type.Optional(ItemSchema), receipt: Type.Optional(text()) }, strict)
const SnapshotSchema = Type.Object({ schemaVersion: Type.Literal(1), binding: BindingSchema, revision: count(), fence: count(), work: Type.Array(WorkSchema, { maxItems: 4096 }), mailbox: Type.Array(MailSchema, { maxItems: 4096 }) }, strict)
export type StateSnapshot = Readonly<Static<typeof SnapshotSchema>>
export type StateWork = StateSnapshot['work'][number]
export type StateMail = StateSnapshot['mailbox'][number]
export type StateLimits = Readonly<{ maxWork: number; maxMailbox: number; maxBytes: number }>
export const DEFAULT_STATE_LIMITS: StateLimits = Object.freeze({ maxWork: 4096, maxMailbox: 4096, maxBytes: 4194304 })
export function stateLimits(input: Partial<StateLimits> = {}): StateLimits {
  const limits = { ...DEFAULT_STATE_LIMITS, ...input }
  if (Object.entries(limits).some(([key, value]) => !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_STATE_LIMITS[key as keyof StateLimits])) throw Error('invalid state limits')
  return Object.freeze(limits)
}
export function validateStateSnapshot(value: unknown, limits: StateLimits = DEFAULT_STATE_LIMITS): StateSnapshot {
  const s = validatePortData<StateSnapshot>(SnapshotSchema, value, limits.maxBytes)
  if (s.work.length > limits.maxWork || s.mailbox.length > limits.maxMailbox || new Set(s.work.map(w => w.key)).size !== s.work.length || new Set(s.mailbox.map(m => m.id)).size !== s.mailbox.length) throw Error('state capacity or duplicate identity')
  if (s.work.some((w, i) => w.moduleId !== s.binding.moduleId || w.ordinal !== i || w.fence > s.fence || (w.status === 'queued' && !w.rawSettled) || (w.outcome && (w.outcome.key !== w.key || w.outcome.status !== w.status || w.outcome.moduleId !== w.moduleId || w.outcome.jobId !== w.jobId || w.outcome.eventId !== w.eventId))) || s.mailbox.some(m => m.fence > s.fence || (m.status === 'queued' && (!m.item || m.item.id !== m.id || m.item.moduleId !== s.binding.moduleId)))) throw Error('inconsistent state')
  if (s.work.some(w => w.operationId !== `attempt:${w.key}` || (!['queued', 'started'].includes(w.status) && !w.outcome) || (w.status === 'executed' && !w.outcome?.effectId)) || s.mailbox.some(m => (m.status !== 'queued' && m.item !== undefined) || (m.receipt !== undefined && m.status !== 'delivered'))) throw Error('missing or inconsistent recovery evidence')
  return s
}
/** Shared backend guard: snapshots may grow protection, never silently prune it.
 * Revision plus exact bytes identify a retry; changed bytes at that revision conflict. */
export function validateStateCommit(current: StateSnapshot | undefined, expectedRevision: number | undefined, next: StateSnapshot): 'new' | 'replay' {
  if (current && current.revision === next.revision && expectedRevision === next.revision - 1 && canonicalJsonHash(current) === canonicalJsonHash(next)) return 'replay'
  if (current?.revision !== expectedRevision || next.revision !== (expectedRevision ?? 0) + 1) throw Error('state revision conflict')
  if (current) {
    if (canonicalJsonHash(identity(current.binding)) !== canonicalJsonHash(identity(next.binding)) || ![current.fence, current.fence + 1].includes(next.fence)) throw Error('state binding or fence conflict')
    if (current.work.some((w, i) => next.work[i]?.key !== w.key) || current.mailbox.some((m, i) => next.mailbox[i]?.id !== m.id)) throw Error('protection cannot be removed')
    for (let i = 0; i < current.work.length; i++) {
      const old = current.work[i]!, w = next.work[i]!
      const metadata = ({ status, rawSettled, outcome, report, ...rest }: StateWork) => rest
      if (old.outcome?.effectId && w.outcome?.effectId !== old.outcome.effectId) throw Error('effect receipt cannot be rewritten')
      if (old.report && (!w.report || old.report.id !== w.report.id || canonicalJsonHash(old.report.body) !== canonicalJsonHash(w.report.body) || (old.report.receipt !== 'unknown' && old.report.receipt !== w.report.receipt))) throw Error('report evidence cannot be rewritten')
      if (canonicalJsonHash(metadata(old)) !== canonicalJsonHash(metadata(w)) || (!['queued', 'started'].includes(old.status) && old.status !== w.status) || (old.rawSettled && !w.rawSettled && old.status !== 'queued')) throw Error('work protection cannot be rewritten')
    }
    for (let i = 0; i < current.mailbox.length; i++) {
      const old = current.mailbox[i]!, m = next.mailbox[i]!
      if ((old.status === 'queued' && m.status === 'queued' && canonicalJsonHash(old.item) !== canonicalJsonHash(m.item)) || (old.receipt && old.receipt !== m.receipt)) throw Error('mailbox evidence cannot be rewritten')
      if ((old.status !== 'queued' && m.status === 'queued') || (old.status === 'delivered' && m.status !== 'delivered') || (old.status === 'dropped' && m.status !== 'dropped') || old.fence !== m.fence || canonicalJsonHash(old.generation) !== canonicalJsonHash(m.generation)) throw Error('mailbox protection cannot be reopened')
    }
  }
  return 'new'
}
export type StateCommitReceipt = Readonly<{ revision: number; durability: 'volatile' | 'fsync' }>
/** Synchronous atomic bounded snapshot CAS. A thrown write is UNKNOWN, never rollback evidence.
 * One serial writer per partition; cross-process locking is not part of this port.
 * Backends must reject corruption, never synthesize empty state after an IO failure. */
export interface StatePersistencePort {
  readonly schemaVersion: 1
  readonly limits: StateLimits
  read(): StateSnapshot | undefined
  commit(expectedRevision: number | undefined, next: StateSnapshot): StateCommitReceipt
}
export type MemoryStateBacking = { json?: string }
/** Fake durable backing survives new port instances; not disk durability. Public backing enables fault injection. */
export function createMemoryStatePort(backing: MemoryStateBacking = {}, input: Partial<StateLimits> = {}): StatePersistencePort {
  const limits = stateLimits(input)
  return Object.freeze({ schemaVersion: 1 as const, limits,
    read() { return backing.json === undefined ? undefined : validateStateSnapshot(JSON.parse(backing.json), limits) },
    commit(expectedRevision: number | undefined, next: StateSnapshot) {
      const current = this.read(), copy = validateStateSnapshot(next, limits)
      validateStateCommit(current, expectedRevision, copy)
      backing.json = JSON.stringify(copy)
      return Object.freeze({ revision: copy.revision, durability: 'volatile' as const })
    },
  })
}
const identity = (b: StateBinding) => ({ ...b, scope: { sessionId: b.scope.sessionId, branchId: b.scope.branchId } })
/** Stable partition name; no raw host identifiers become filesystem paths. */
export const statePartitionId = (b: StateBinding): string => canonicalJsonHash([b.bindingId, b.moduleId, b.scope.sessionId, b.scope.branchId])

export class MonitoringStateSession {
  private snapshot: StateSnapshot
  private failed = false
  readonly binding: StateBinding
  constructor(private readonly port: StatePersistencePort, binding: StateBinding) {
    if (port.schemaVersion !== 1) throw Error('unknown state port version')
    stateLimits(port.limits)
    this.binding = validatePortData<StateBinding>(BindingSchema, binding)
    const old = port.read()
    const current = old && validateStateSnapshot(old, port.limits)
    if (current && canonicalJsonHash(identity(current.binding)) !== canonicalJsonHash(identity(this.binding))) throw Error('state binding/config mismatch; reconciliation required')
    const fence = (current?.fence ?? 0) + 1
    const work = (current?.work ?? []).map(w => {
      if (w.status !== 'started' && w.status !== 'queued') return w
      const status = w.status === 'started' ? 'uncertain' as const : 'rejected' as const
      return { ...w, status, outcome: { moduleId: w.moduleId, jobId: w.jobId, eventId: w.eventId, key: w.key, status, reason: status === 'uncertain' ? 'restart_inflight_uncertain' : 'restart_unstarted_dropped', reported: false } }
    })
    const mailbox = (current?.mailbox ?? []).map(m => m.status === 'queued' && !sameInputPortScope(m.generation, this.binding.scope) ? { ...m, status: 'dropped' as const, item: undefined } : m)
    this.snapshot = validateStateSnapshot(JSON.parse(JSON.stringify({ schemaVersion: 1, binding: this.binding, revision: (current?.revision ?? 0) + 1, fence, work, mailbox })), port.limits)
    const receipt = port.commit(current?.revision, this.snapshot)
    if (receipt.revision !== this.snapshot.revision || !['volatile', 'fsync'].includes(receipt.durability)) throw Error('invalid state commit receipt')
  }
  assertCurrent(): void {
    if (this.failed) throw Error('state session failed; reopen and reconcile')
    try {
      const current = this.port.read()
      if (!current || current.fence !== this.snapshot.fence || current.revision !== this.snapshot.revision || canonicalJsonHash(validateStateSnapshot(current, this.port.limits)) !== canonicalJsonHash(this.snapshot)) throw Error('stale state owner')
    } catch (error) { this.failed = true; throw error }
  }
  view(): StateSnapshot { this.assertCurrent(); return this.snapshot }
  private change(edit: (draft: Static<typeof SnapshotSchema>) => void): void {
    this.assertCurrent()
    try {
      const draft = JSON.parse(JSON.stringify(this.snapshot)) as Static<typeof SnapshotSchema>
      edit(draft); draft.revision++
      const next = validateStateSnapshot(draft, this.port.limits)
      const receipt = this.port.commit(this.snapshot.revision, next)
      if (receipt.revision !== next.revision || !['volatile', 'fsync'].includes(receipt.durability)) throw Error('invalid state commit receipt')
      this.snapshot = next
    } catch (error) { this.failed = true; throw error }
  }
  get(key: string): string | undefined { return this.view().work.find(w => w.key === key)?.status }
  /** Unresolved raw attempts fence ALL new work, not just duplicates. No guessed capacity release. */
  hasUnresolvedWork(): boolean { return this.view().work.some(w => !w.rawSettled) }
  admit(input: Omit<StateWork, 'ordinal' | 'fence' | 'operationId' | 'status' | 'rawSettled' | 'outcome' | 'report'>): void {
    this.change(s => {
      if (s.work.some(w => w.key === input.key)) throw Error('duplicate durable key')
      if (input.cost) for (const [kind, amount] of Object.entries(input.cost.caps)) {
        const prior = s.work.reduce((n, w) => n + (w.cost?.caps[kind] ?? 0), 0)
        if (prior + amount! > (input.cost.approvedCaps[kind] ?? 0)) throw Error('durable budget exhausted')
      }
      s.work.push({ ...input, ordinal: s.work.length, fence: s.fence, operationId: `attempt:${input.key}`, status: 'queued', rawSettled: true })
    })
  }
  private update(key: string, edit: (w: StateWork) => void): void { this.change(s => { const w = s.work.find(w => w.key === key); if (!w) throw Error('unknown durable key'); edit(w) }) }
  dispatch(key: string): void { this.update(key, w => { if (w.status !== 'queued') throw Error('attempt already dispatched'); w.status = 'started'; w.rawSettled = false }) }
  settle(key: string): void { this.update(key, w => { if (w.fence !== this.snapshot.fence) throw Error('recovered raw attempt requires authoritative reconciliation'); w.rawSettled = true }) }
  put(key: string, state: string): void {
    this.update(key, w => {
      if (!['executed', 'proposed', 'prepared', 'rejected', 'uncertain'].includes(state) || !['started', 'queued'].includes(w.status)) throw Error('invalid durable outcome transition')
      w.status = state as StateWork['status']
      w.outcome = { moduleId: w.moduleId, jobId: w.jobId, eventId: w.eventId, key, status: state as JobOutcome['status'], reason: 'terminal_without_detail', reported: false }
    })
  }
  finish(outcome: JobOutcome): void {
    if (!outcome.key || outcome.status === 'skipped') return
    // Shadow-only diagnostic fields are deliberately not durable replay input.
    const { moduleId, jobId, eventId, key, status, reason, effectId, reported, reportReceipt } = outcome
    const clean = JSON.parse(JSON.stringify({ moduleId, jobId, eventId, key, status, reason, effectId, reported, reportReceipt })) as JobOutcome
    this.update(key, w => {
      if (!['started', 'queued', clean.status].includes(w.status)) throw Error('terminal outcome cannot be reopened')
      w.status = clean.status as StateWork['status']; w.outcome = clean
    })
  }
  reportIntent(key: string, report: Report): void { this.update(key, w => { w.report = { id: canonicalJsonHash(report), body: report, receipt: 'unknown' } }) }
  reportReceipt(key: string, receipt: ReportEnqueueReceipt): void { this.update(key, w => { if (!w.report || w.report.id !== receipt.reportId) throw Error('report identity mismatch'); w.report.receipt = receipt.status }) }
  enqueue(item: CarryItem): void {
    this.change(s => { if (s.mailbox.some(m => m.id === item.id)) throw Error('duplicate durable mailbox id'); s.mailbox.push({ id: item.id, fence: s.fence, generation: this.binding.scope, status: 'queued', item: JSON.parse(JSON.stringify(item)) }) })
  }
  mailState(id: string, status: StateMail['status'], receipt?: string): void {
    this.change(s => {
      const m = s.mailbox.find(m => m.id === id)
      if (!m || (status === 'delivered' ? m.status !== 'delivery-uncertain' : m.status !== 'queued')) throw Error('invalid mailbox transition')
      m.status = status
      if (receipt) m.receipt = receipt
      if (status !== 'queued') delete m.item
    })
  }
  acknowledgeDelivery(id: string, receiptId: string): void { if (!receiptId) throw Error('missing delivery receipt'); this.mailState(id, 'delivered', receiptId) }
}

export const openMonitoringState = (port: StatePersistencePort, binding: StateBinding): MonitoringStateSession => new MonitoringStateSession(port, binding)
