import { expect, test } from 'bun:test'
import { createMemoryMonitor, prepareMemoryCandidate, type MemoryLimits } from '@lazy-harness/monitoring-module-memory'
import type { ReviewCandidate, ReviewSinkPort } from '@lazy-harness/monitoring-core/host'
import { frame, harness, input } from './support.ts'

for (const bound of ['maxClaimBytes', 'maxEvidence', 'maxCandidateBytes', 'maxBodies', 'maxBodyBytes', 'maxKeys', 'maxKeyBytes'] as const) test(`${bound} refuses without evicting protections`, async () => {
  const limits: Partial<MemoryLimits> = { [bound]: 1 }, h = harness({ limits })
  try {
    if (bound === 'maxBodies' || bound === 'maxEvidence') {
      expect((await h.monitor.onOpportunity(frame(), 'run')).prepared).toBe(true)
      const s = input(3, '2'); h.set(bound === 'maxEvidence' ? { ...s, evidence: [...s.evidence, { ...s.evidence[0], id: 'other' }] } : s)
    }
    expect((await h.monitor.onOpportunity(frame(bound === 'maxBodies' || bound === 'maxEvidence' ? 3 : 2), 'run')).reason).toBe('capacity')
    expect(h.sink.inspect()).toHaveLength(bound === 'maxBodies' || bound === 'maxEvidence' ? 1 : 0)
  } finally { h.close() }
})
test('UTF-8 claim/candidate caps and invalid limits refuse, not truncate', () => {
  const s = input(), text = '界'.repeat(700)
  expect(() => prepareMemoryCandidate({ ...s, evidence: [{ ...s.evidence[0], text, end: text.length }] })).toThrow()
  expect(() => harness({ limits: { maxBodies: 129 } })).toThrow('Invalid memory bound')
  expect(() => harness({ limits: { maxBodies: 0 } })).toThrow('Invalid memory bound')
})
for (const status of ['accepted-volatile', 'refused', 'unknown', 'wrong-id', 'malformed', 'throws'] as const) test(`sink ${status} receipt semantics and no automatic retry`, async () => {
  let calls = 0
  const port: ReviewSinkPort = { protocolVersion: 1, retention: 'volatile', async enqueue(c) {
    calls++; if (status === 'throws') throw Error('invented lost receipt')
    return { protocolVersion: status === 'malformed' ? 2 : 1, candidateId: status === 'wrong-id' ? 'wrong' : c.candidateId, status: ['accepted-volatile', 'refused', 'unknown'].includes(status) ? status : 'accepted-volatile' } as Awaited<ReturnType<ReviewSinkPort['enqueue']>>
  } }
  const h = harness({ sink: port })
  try {
    const r = await h.monitor.onOpportunity(frame(), 'run')
    expect(r.prepared).toBe(true)
    expect(String(r.receipt?.status)).toBe(['accepted-volatile', 'refused', 'unknown'].includes(status) ? status : 'unknown')
    h.set(input(3)); expect((await h.monitor.onOpportunity(frame(3, 'turn_end'), 'run')).reason).toBe('unchanged-duplicate'); expect(calls).toBe(1)
  } finally { h.close() }
})
test('fake sink identical receipt is idempotent, mutated identity refuses; accepted is not approved/persisted', async () => {
  const h = harness(), c = prepareMemoryCandidate(input())
  try {
    const a = await h.sink.port.enqueue(c), b = await h.sink.port.enqueue(c)
    expect(a).toEqual(b); expect(a.status).toBe('accepted-volatile')
    expect((await h.sink.port.enqueue({ ...c, claim: { ...c.claim, text: 'invented mutation' } })).status).toBe('refused')
    expect(h.sink.inspect()).toEqual([c]); expect(c.notApproved && c.notWritten).toBe(true)
  } finally { h.close() }
})
test('source freshness rechecked after preparation before sink handoff', async () => {
  let checks = 0, delivered = 0
  const port: ReviewSinkPort = { protocolVersion: 1, retention: 'volatile', async enqueue(c) { delivered++; return { protocolVersion: 1, candidateId: c.candidateId, status: 'accepted-volatile' } } }
  const monitor = createMemoryMonitor({ stage: 'shadow', reviewSink: port, source: { capture: () => input(), isCurrent: () => ++checks === 1 } })
  try { expect(await monitor.onOpportunity(frame(), 'run')).toMatchObject({ mode: 'defer', reason: 'completion-stale', prepared: false }); expect(delivered).toBe(0) } finally { monitor.close() }
})
test('lost sink acknowledgement times out unknown and consumes key; late result cannot trigger a retry', async () => {
  let release!: (r: Awaited<ReturnType<ReviewSinkPort['enqueue']>>) => void, candidate: ReviewCandidate | undefined, calls = 0
  const gate = new Promise<Awaited<ReturnType<ReviewSinkPort['enqueue']>>>(r => { release = r })
  const h = harness({ sinkTimeoutMs: 5, sink: { protocolVersion: 1, retention: 'volatile', enqueue(c) { calls++; candidate = c; return gate } } })
  try {
    expect(await h.monitor.onOpportunity(frame(), 'run')).toMatchObject({ mode: 'defer', reason: 'receipt-stale-or-unknown', prepared: true })
    release({ protocolVersion: 1, candidateId: candidate!.candidateId, status: 'accepted-volatile' })
    h.set(input(3)); expect((await h.monitor.onOpportunity(frame(3), 'run')).reason).toBe('unchanged-duplicate'); expect(calls).toBe(1)
  } finally { h.close() }
})
test('one active plus bounded queued opportunities; close fences stale late acceptance', async () => {
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(r => { entered = r }), gate = new Promise<void>(r => { release = r })
  const h = harness({ limits: { maxQueued: 1 }, sink: { protocolVersion: 1, retention: 'volatile', async enqueue(c, signal) { entered(); await gate; return { protocolVersion: 1, candidateId: c.candidateId, status: signal?.aborted ? 'refused' : 'accepted-volatile' } } } })
  const a = h.monitor.onOpportunity(frame(), 'run'); await started
  const b = h.monitor.onOpportunity(frame(3), 'run')
  expect(await h.monitor.onOpportunity(frame(4), 'run')).toMatchObject({ mode: 'defer', reason: 'queue-capacity' })
  h.close(); release()
  expect((await a).receipt).toBeUndefined(); expect((await b).mode).toBe('defer')
  expect((await h.monitor.onOpportunity(frame(5), 'run')).reason).toBe('closed')
})
for (const generation of ['session', 'branch', 'compaction'] as const) test(`${generation} scope cannot carry candidates/dedupe`, async () => {
  const h = harness()
  try {
    await h.monitor.onOpportunity(frame(), 'run')
    const s = input(3)
    const scope = { ...s.context.scope, ...(generation === 'session' ? { sessionId: 'other' } : generation === 'branch' ? { branchGeneration: 1 } : { compactionGeneration: 1 }) }
    h.set({ ...s, context: { ...s.context, scope } })
    expect((await h.monitor.onOpportunity(frame(3), 'run')).prepared).toBe(false)
    // A newly composed scope starts empty; old data never enters its sink.
    h.sink.close(); expect(h.sink.inspect()).toEqual([])
  } finally { h.close() }
})
test('steering fences prior in-flight intent but keeps protection keys', async () => {
  let entered!: () => void, release!: () => void
  const start = new Promise<void>(r => { entered = r }), gate = new Promise<void>(r => { release = r })
  const h = harness({ sink: { protocolVersion: 1, retention: 'volatile', async enqueue(c) { entered(); await gate; return { protocolVersion: 1, candidateId: c.candidateId, status: 'accepted-volatile' } } } })
  const pending = h.monitor.onOpportunity(frame(), 'run'); await start
  const steer = h.monitor.onOpportunity(frame(3, 'input'), 'defer'); release()
  try { expect((await pending).receipt).toBeUndefined(); expect((await steer).mode).toBe('defer'); expect(h.monitor.getStatus().keys).toBe(1) } finally { h.close() }
})
