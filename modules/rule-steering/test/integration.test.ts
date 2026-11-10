import { expect, test } from 'bun:test'
import { monitoringReportId, type Report, type ReportDeliveryReceipt } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { decision, frame, packets, pipeline, refs, runtime, triggerFor } from './support.ts'

test('strict pipeline/current IDs -> verifier -> worker -> separate matching hook receipt', async () => {
  const p = pipeline(), reports: Report[] = [], receipts: ReportDeliveryReceipt[] = [], seen: string[] = []
  const { rt, budget } = runtime({ stage: 'active', approved: 8, verify: async task => { seen.push(task.view.event.id); expect((task.view.event.payload as { currentReferenceIds: string[] }).currentReferenceIds.length).toBeGreaterThan(0); return decision() }, report: r => { reports.push(r); return { reportId: monitoringReportId(r), status: 'enqueued' } } })
  try {
    p.accept(frame(2)); await p.idle(); expect(p.requests).toHaveLength(1)
    const [offer] = p.coordinator.takeReady('module'), [packet] = packets(offer)
    expect(packet.view).toBeDefined(); expect(offer.isCurrent()).toBe(true)
    const [outcome] = await rt.onTrigger(triggerFor(packet))
    expect(outcome.reported).toBe(true); expect(seen).toEqual(['toy-2', 'toy-2']); expect(budget.usage('rules.steer')?.used.judgeCalls).toBe(2)
    expect(reports[0].text).toContain(refs[0].content); expect(reports[0].text).toContain(`policy:blue-lantern (v${refs[0].version})`)
    expect(receipts).toEqual([]) // enqueue is not delivery
    if (offer.isCurrent()) receipts.push({ reportId: monitoringReportId(reports[0]), status: 'delivered', kind: 'hook-boundary', boundary: 'context_with_system' })
    expect(receipts[0].reportId).toBe(monitoringReportId(reports[0]))
    expect((await rt.onTrigger(triggerFor(packet)))[0].reason).toBe('duplicate:prepared')
  } finally { await rt.idle(); rt.dispose(); await p.close() }
})

for (const change of ['registry-version', 'user-steer'] as const) test(`${change} refuses late verified report at sink`, async () => {
  const p = pipeline(), reports: Report[] = []
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { entered = r })
  try {
    p.accept(frame(2)); await p.idle()
    const [offer] = p.coordinator.takeReady('module'), [packet] = packets(offer)
    const { rt } = runtime({ stage: 'active', approved: 8, verify: async () => { entered(); await gate; return decision() }, report: r => {
      if (!offer.isCurrent()) return { reportId: monitoringReportId(r), status: 'failed' }
      reports.push(r); return { reportId: monitoringReportId(r), status: 'enqueued' }
    } })
    try {
      const pending = rt.onTrigger(triggerFor(packet)); await started
      if (change === 'registry-version') p.window.setReference({ ...refs[0], version: 'new-toy-version', content: 'Toy changed rule.' })
      else { p.advanceIntent(); p.accept(frame(3, 'input', { source: 'interactive', text: 'Switch to toy kites.', streamingBehavior: 'steer' })) }
      expect(offer.isCurrent()).toBe(false); release()
      const [outcome] = await pending
      expect(outcome.status).toBe('prepared'); expect(outcome.reported).toBe(false); expect(outcome.reportReceipt?.status).toBe('failed'); expect(reports).toEqual([])
    } finally { release(); await rt.idle(); rt.dispose() }
  } finally { release(); await p.close() }
})

test('only tool.before and finalized assistant messages are watched, not user/provisional content', async () => {
  const p = pipeline()
  try {
    p.accept(frame(2, 'message_update', { message: { role: 'assistant', content: [{ type: 'text', text: 'partial' }] } }))
    p.accept(frame(3, 'message_end', { message: { role: 'user', content: [{ type: 'text', text: 'user text' }] } }))
    await p.idle(); expect(p.requests).toEqual([])
    p.accept(frame(4, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'final toy action' }] } }))
    await p.idle(); expect(p.requests).toHaveLength(1)
    const [offer] = p.coordinator.takeReady('module'), [packet] = packets(offer)
    const text = JSON.stringify(packet.view); expect(text).toContain('final toy action')
    expect(packet.eventId).toBe('toy-4')
  } finally { await p.close() }
})

for (const malformed of ['unknown-field', 'negative-cursor', 'wrong-session', 'accessor'] as const) test(`malformed ${malformed} is rejected before judging`, async () => {
  const p = pipeline()
  try {
    const bad = structuredClone(frame(2)) as unknown as Record<string, unknown>; let touched = false
    if (malformed === 'unknown-field') bad.extra = true
    if (malformed === 'negative-cursor') bad.cursor = -1
    if (malformed === 'wrong-session') (bad.snapshot as Record<string, unknown>).sessionId = 'other'
    if (malformed === 'accessor') Object.defineProperty(bad, 'payload', { enumerable: true, get() { touched = true; throw Error('not data') } })
    p.accept(bad as unknown as ReturnType<typeof frame>); await p.idle()
    expect(touched).toBe(false); expect(p.requests).toEqual([]); expect(p.coordinator.takeReady('module')).toEqual([]); expect(p.window.getStatus().state).toBe('stopped')
  } finally { await p.close() }
})
