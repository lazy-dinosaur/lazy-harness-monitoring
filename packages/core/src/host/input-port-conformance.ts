import { evaluateReadRecordSnapshot, type InputPortContext, type ReadRecord, type ReadRecordPort, type ReadRecordRequest, type ReviewCandidate, type ReviewSinkPort } from './input-ports.ts'

const assert = (yes: unknown, name: string): void => { if (!yes) throw Error(`Input-port conformance: ${name}`) }
export const syntheticInputPortContext = (): InputPortContext => ({ scope: { sessionId: 'synthetic-session', bindingGeneration: 1, branchId: 'synthetic-branch', branchGeneration: 1, compactionGeneration: 0 }, sourceRevision: 'source-1', grantRevision: 'grant-1', completeThroughCursor: 10, available: true })
export const syntheticReadRecord = (c = syntheticInputPortContext()): ReadRecord => ({ protocolVersion: 1, scope: c.scope, documentId: 'synthetic-doc', documentVersion: 'v1', namespace: 'synthetic', sourceRecordId: 'record-1', sourceRecordRevision: 'r1', sourceEventId: 'read-event', cursor: 2, sourceRevision: c.sourceRevision, grantRevision: c.grantRevision, exposure: { kind: 'full', attestationId: 'synthetic-exposure-receipt' } })
export const syntheticReadRequest = (c = syntheticInputPortContext()): ReadRecordRequest => ({ protocolVersion: 1, scope: c.scope, sourceEventId: 'trigger-event', cursor: 10, sourceRevision: c.sourceRevision, grantRevision: c.grantRevision, documents: [{ documentId: 'synthetic-doc', documentVersion: 'v1' }] })
export const syntheticReviewCandidate = (c = syntheticInputPortContext()): ReviewCandidate => ({ schemaVersion: 'memory-candidate/v1', candidateId: 'candidate-1', scope: c.scope, sourceRevision: c.sourceRevision, grantRevision: c.grantRevision, subjectKey: 'synthetic-project/lantern', dedupeKey: 'synthetic-key-1', status: 'review-only', notApproved: true, notWritten: true, claim: { kind: 'project-fact', text: 'The synthetic lantern uses blue glass.', language: 'en' }, evidenceRefs: [{ documentId: 'synthetic-doc', documentVersion: 'v1', sourceEventId: 'read-event', sourceRevision: c.sourceRevision, grantRevision: c.grantRevision, attestationId: 'synthetic-exposure-receipt', span: '0:37' }] })
export interface ReadRecordConformanceHarness {
  port: ReadRecordPort
  record(record: ReadRecord): boolean
  close(): void
}
export type ReadRecordConformanceFactory = (context: () => InputPortContext | undefined, options: { maxItems: number; maxBytes: number; beforeSnapshot?: () => Promise<void> }) => ReadRecordConformanceHarness
/** Throws on any failed synthetic probe; reusable without a test-runner dependency. */
export async function runReadRecordPortConformance(factory: ReadRecordConformanceFactory): Promise<readonly string[]> {
  const passed: string[] = []
  let c: InputPortContext | undefined = syntheticInputPortContext()
  const make = (options: { maxItems?: number; maxBytes?: number; beforeSnapshot?: () => Promise<void> } = {}) => factory(() => c, { maxItems: 4096, maxBytes: 1048576, ...options })
  const h = make(), r = syntheticReadRequest(c), record = syntheticReadRecord(c)
  const lookup = async (request = r) => { const s = await h.port.snapshot(request); return evaluateReadRecordSnapshot(request, s)[0].status }
  try {
    assert(await lookup() === 'not-read', 'complete empty snapshot')
    assert(h.record(record), 'record admitted')
    assert(h.record(record), 'idempotent replay')
    assert(!h.record({ ...record, exposure: { ...record.exposure, kind: 'partial' } }), 'mutation refused')
    assert(await lookup() === 'already-read', 'full exact revision')
    assert(await lookup({ ...r, documents: [{ ...r.documents[0], documentVersion: 'v2' }] }) === 'not-read', 'version isolation')
    passed.push('exact-version/replay/mutation')
    const s = await h.port.snapshot(r)
    assert(Object.isFrozen(s) && Object.isFrozen(s.records) && Object.isFrozen(s.records[0]), 'immutable snapshot')
    for (const field of ['compactionGeneration', 'branchGeneration', 'bindingGeneration'] as const) {
      c = { ...c!, scope: { ...c!.scope, [field]: c!.scope[field] + 1 } }
      assert(!h.port.isCurrent(r, s), `${field} fences old response`)
      assert(!h.record(record), `${field} refuses late ingestion`)
      assert(await lookup(syntheticReadRequest(c)) === 'not-read', `${field} no carry`)
    }
    c = { ...c!, scope: { ...c!.scope, sessionId: 'synthetic-other-session' } }
    assert(await lookup(syntheticReadRequest(c)) === 'not-read', 'session no carry')
    passed.push('scope-fencing/no-carry/immutable')
    for (const change of [{ available: false }, { completeThroughCursor: 1 }, { sourceRevision: 'source-2' }, { grantRevision: 'grant-2' }]) {
      c = { ...syntheticInputPortContext(), ...change }
      assert(await lookup() === 'unknown', 'unavailable/incomplete/source/grant freshness')
    }
    c = syntheticInputPortContext()
    const ctrl = new AbortController(); ctrl.abort()
    assert(await lookup({ ...r, signal: ctrl.signal }) === 'unknown', 'cancellation')
    c = undefined; assert(await lookup() === 'unknown', 'closed generation')
    passed.push('freshness/cancellation/unavailable')
  } finally { h.close() }
  c = syntheticInputPortContext()
  const partial = make()
  try { assert(partial.record({ ...record, exposure: { ...record.exposure, kind: 'partial' } }), 'partial admitted'); assert(evaluateReadRecordSnapshot(r, await partial.port.snapshot(r))[0].status === 'not-read', 'partial cannot suppress') } finally { partial.close() }
  const capped = make({ maxItems: 1 })
  try {
    assert(capped.record(record), 'capacity first')
    assert(!capped.record({ ...record, sourceEventId: 'second-event' }), 'capacity refuses')
    assert(evaluateReadRecordSnapshot(r, await capped.port.snapshot(r))[0].status === 'unknown', 'overflow never pretends complete')
  } finally { capped.close() }
  const byteCapped = make({ maxBytes: 1 })
  try { assert(!byteCapped.record(record), 'byte cap refuses') } finally { byteCapped.close() }
  passed.push('partial/count-and-byte-bounds')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), delayed = make({ beforeSnapshot: () => gate })
  try {
    const pending = delayed.port.snapshot(r)
    assert((await delayed.port.snapshot(r)).status !== 'available', 'single in-flight request')
    c = { ...c!, scope: { ...c!.scope, compactionGeneration: c!.scope.compactionGeneration + 1 } }
    release()
    assert((await pending).status !== 'available', 'late compaction response fenced')
    delayed.close(); assert((await delayed.port.snapshot(syntheticReadRequest(c))).status !== 'available', 'closed port')
  } finally { release(); delayed.close() }
  passed.push('delayed-race/single-flight/close')
  return Object.freeze(passed)
}
export interface ReviewSinkConformanceHarness { port: ReviewSinkPort; inspect(): readonly ReviewCandidate[]; close(): void }
export type ReviewSinkConformanceFactory = (context: () => InputPortContext | undefined, options: { maxItems: number; maxBytes: number }) => ReviewSinkConformanceHarness
export async function runReviewSinkPortConformance(factory: ReviewSinkConformanceFactory): Promise<readonly string[]> {
  let c: InputPortContext | undefined = syntheticInputPortContext()
  const candidate = syntheticReviewCandidate(c), h = factory(() => c, { maxItems: 1, maxBytes: 1048576 })
  try {
    assert(h.port.retention === 'volatile', 'volatile only')
    const receipt = await h.port.enqueue(candidate)
    assert(receipt.protocolVersion === 1 && receipt.candidateId === candidate.candidateId && receipt.status === 'accepted-volatile', 'matching volatile receipt')
    assert(JSON.stringify(await h.port.enqueue(candidate)) === JSON.stringify(receipt), 'stable replay receipt')
    assert((await h.port.enqueue({ ...candidate, claim: { ...candidate.claim, text: 'Changed synthetic claim.' } })).status === 'refused', 'mutation refused')
    assert((await h.port.enqueue({ ...candidate, candidateId: 'candidate-2', dedupeKey: 'key-2' })).status === 'refused', 'count bound')
    assert(Object.isFrozen(h.inspect()) && Object.isFrozen(h.inspect()[0].claim), 'immutable review')
    for (const field of ['compactionGeneration', 'branchGeneration', 'bindingGeneration'] as const) {
      c = { ...c!, scope: { ...c!.scope, [field]: c!.scope[field] + 1 } }
      assert(h.inspect().length === 0, 'scope clears volatile bodies')
      assert((await h.port.enqueue(candidate)).status === 'refused', 'late candidate refused')
      assert((await h.port.enqueue(syntheticReviewCandidate(c))).status === 'accepted-volatile', 'new scope admission')
    }
    c = { ...c!, scope: { ...c!.scope, sessionId: 'synthetic-replacement' } }
    assert(h.inspect().length === 0, 'session reset')
    c = undefined; assert((await h.port.enqueue(candidate)).status === 'refused', 'closed scope')
    c = syntheticInputPortContext()
    const ctrl = new AbortController(); ctrl.abort()
    assert((await h.port.enqueue(candidate, ctrl.signal)).status === 'refused', 'cancelled sink')
    c = { ...c, grantRevision: 'grant-2' }; assert((await h.port.enqueue(candidate)).status === 'refused', 'revoked grant')
    h.close(); assert((await h.port.enqueue(syntheticReviewCandidate(c))).status === 'refused', 'disposed sink')
  } finally { h.close() }
  c = syntheticInputPortContext()
  const bytes = factory(() => c, { maxItems: 128, maxBytes: 1 })
  try { assert((await bytes.port.enqueue(candidate)).status === 'refused', 'byte bound') } finally { bytes.close() }
  return Object.freeze(['volatile/receipt/replay/mutation', 'scope-fencing/no-carry/immutable', 'count-and-byte-bounds/cancel/grant/close'])
}
