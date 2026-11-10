import { expect, test } from 'bun:test'
import type { ReviewSinkPort } from '@lazy-harness/monitoring-core/host'
import { frame, harness, input } from './support.ts'

for (const control of ['session_before_compact', 'session_compact', 'session_compact_failed', 'session_before_switch', 'session_before_fork', 'session_before_tree', 'session_tree', 'session_shutdown', 'session_start']) test(`${control} fences a previously open monitor without carry`, async () => {
  const h = harness()
  try {
    await h.monitor.onOpportunity(frame(), 'run')
    expect((await h.monitor.onOpportunity(frame(3, control), 'run')).reason).toBe('scope-control-closed')
    h.sink.close(); await h.monitor.idle()
    expect(h.sink.inspect()).toEqual([]); expect(h.monitor.getStatus()).toMatchObject({ closed: true, keys: 0, bodies: 0 })
    expect((await h.monitor.onOpportunity(frame(4), 'run')).prepared).toBe(false)
  } finally { h.close() }
})
test('initial session_start is control-only and never captures source', async () => {
  const h = harness()
  try { expect((await h.monitor.onOpportunity(frame(1, 'session_start'), 'run')).reason).toBe('not-watched'); expect(h.captures()).toBe(0); expect(h.monitor.getStatus().closed).toBe(false) } finally { h.close() }
})
test('source revocation blocks receipt acceptance and host disposal removes bodies', async () => {
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(r => { entered = r }), gate = new Promise<void>(r => { release = r })
  const port: ReviewSinkPort = { protocolVersion: 1, retention: 'volatile', async enqueue(c) { entered(); await gate; return { protocolVersion: 1, candidateId: c.candidateId, status: 'accepted-volatile' } } }
  const h = harness({ sink: port }), pending = h.monitor.onOpportunity(frame(), 'run')
  await started; h.stale(); release()
  try { const r = await pending; expect(r).toMatchObject({ mode: 'defer', prepared: true }); expect(r.receipt).toBeUndefined(); h.close(); await h.monitor.idle(); expect(h.sink.inspect()).toEqual([]) } finally { h.close() }
})
test('same original revision with changed nonclaim context or attestation defers even if quote is unchanged', async () => {
  for (const change of ['context', 'attestation'] as const) {
    const h = harness(), s = input()
    if (change === 'context') {
      h.set({ ...s, evidence: [{ ...s.evidence[0], text: s.evidence[0].text + ' Context A.' }] })
      await h.monitor.onOpportunity(frame(), 'run')
      const n = input(3); h.set({ ...n, evidence: [{ ...n.evidence[0], text: n.evidence[0].text + ' Context B.' }] })
    } else {
      await h.monitor.onOpportunity(frame(), 'run')
      const n = input(3); h.set({ ...n, evidence: [{ ...n.evidence[0], attestationId: 'different-attestation' }] })
    }
    try { expect((await h.monitor.onOpportunity(frame(3), 'run')).reason).toBe('source-identity-mutation'); expect(h.sink.inspect()).toHaveLength(1) } finally { h.close() }
  }
})
test('combined protection-key cap refuses changed revisions and never evicts a consumed duplicate', async () => {
  const h = harness({ limits: { maxKeys: 2 } })
  try {
    expect((await h.monitor.onOpportunity(frame(), 'run')).prepared).toBe(true)
    h.set(input(3, '2')); expect((await h.monitor.onOpportunity(frame(3), 'run')).reason).toBe('capacity')
    h.set(input(4)); expect((await h.monitor.onOpportunity(frame(4, 'turn_end'), 'run')).reason).toBe('unchanged-duplicate')
    expect(h.sink.inspect()).toHaveLength(1)
  } finally { h.close() }
})
