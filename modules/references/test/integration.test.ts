import { expect, test } from 'bun:test'
import { monitoringReportId, type Report, type ReportDeliveryReceipt } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import type { RealtimeSelectionPacket } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-selection.ts'
import { createReferencesHandlers, referencesHandlers } from '@lazy-harness/monitoring-module-references'
import { catalog, frame, pipeline, runtime } from './support.ts'

const packets = (offer: { candidate: { payload: unknown } }) => (offer.candidate.payload as { packets: RealtimeSelectionPacket[] }).packets
const triggerFor = (p: RealtimeSelectionPacket) => ({ moduleId: p.moduleId, eventId: p.eventId, sessionId: 'toy-session', evidence: p.materials.map(r => ({ id: r.id, kind: r.kind, version: r.version, text: r.text })) })

test('scripted selection bridges the current request to exact documents and separate hook receipts', async () => {
  const p = pipeline(), enqueued: Report[] = [], receipts: ReportDeliveryReceipt[] = []
  const rt = runtime({ stage: 'active' }, r => { enqueued.push(r); return { reportId: monitoringReportId(r), status: 'enqueued' } })
  try {
    p.accept(frame(2)); await p.idle()
    expect(p.requests).toHaveLength(1)
    expect(JSON.stringify(p.requests[0].body)).toContain('How should I build the lantern?')
    const [offer] = p.coordinator.takeReady('module')
    expect(offer.isCurrent()).toBe(true)
    const [packet] = packets(offer)
    expect(packet.materials.filter(m => m.kind === 'knowledge').map(m => m.id)).toEqual(['doc:lantern'])
    expect((await rt.onTrigger(triggerFor(packet)))[0].reported).toBe(true)
    expect(enqueued[0].text).toBe('[근거 자료]\n- doc:lantern (v3): Lanterns use blue glass.\nKeep the lid closed.')
    expect(receipts).toEqual([]) // enqueued is not delivered
    // Invented host boundary; no Pi SDK or final-provider-input assertion.
    if (offer.isCurrent()) for (const report of enqueued.splice(0)) receipts.push({ reportId: monitoringReportId(report), status: 'delivered', kind: 'hook-boundary', boundary: 'context_with_system' })
    expect(receipts).toHaveLength(1)
    expect(receipts[0].kind).toBe('hook-boundary')
    expect(enqueued).toEqual([])
  } finally { await rt.idle(); rt.dispose(); await p.close() }
})

for (const mode of ['skip', 'defer'] as const) test(`scripted ${mode} makes no handoff`, async () => {
  const p = pipeline({ mode })
  try { p.accept(frame(2)); await p.idle(); expect(p.requests).toHaveLength(1); expect(p.coordinator.takeReady('module')).toEqual([]) } finally { await p.close() }
})

test('empty document selection never causes fallback to the catalog', async () => {
  const p = pipeline({ select: false }), reports: Report[] = [], rt = runtime({ stage: 'active' }, r => { reports.push(r); return { reportId: monitoringReportId(r), status: 'enqueued' } })
  try {
    p.accept(frame(2)); await p.idle()
    const offers = p.coordinator.takeReady('module')
    expect(offers).toHaveLength(1)
    for (const offer of offers) for (const packet of packets(offer)) expect((await rt.onTrigger(triggerFor(packet)))[0].status).toBe('rejected')
    expect(reports).toEqual([])
  } finally { await rt.idle(); rt.dispose(); await p.close() }
})

test('denied source permission prevents judging and delivery', async () => {
  const p = pipeline({ permitted: () => false })
  try { p.accept(frame(2)); await p.idle(); expect(p.requests).toEqual([]); expect(p.coordinator.takeReady('module')).toEqual([]) } finally { await p.close() }
})

for (const change of ['document-version', 'new-request'] as const) test(`${change} drops a report prepared by a late worker`, async () => {
  const p = pipeline(), reports: Report[] = []
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(r => { release = r }), entered = new Promise<void>(r => { started = r })
  try {
    p.accept(frame(2)); await p.idle()
    const [offer] = p.coordinator.takeReady('module'), [packet] = packets(offer)
    const rt = runtime({ stage: 'active' }, r => {
      if (!offer.isCurrent()) return { reportId: monitoringReportId(r), status: 'failed', reason: 'stale_source' }
      reports.push(r); return { reportId: monitoringReportId(r), status: 'enqueued' }
    }, { 'context.references.deliver': { async run(context) { started(); await gate; return referencesHandlers['context.references.deliver'].run(context) } } })
    try {
      const pending = rt.onTrigger(triggerFor(packet)); await entered
      if (change === 'document-version') p.window.setReference({ ...catalog[0], version: '4', content: 'Lanterns now use green glass.' })
      else p.accept(frame(3, 'input', 'Build a kite instead.'))
      expect(offer.isCurrent()).toBe(false)
      release()
      const [outcome] = await pending
      expect(outcome.status).toBe('prepared'); expect(outcome.reported).toBe(false)
      expect(outcome.reportReceipt?.status).toBe('failed'); expect(reports).toEqual([])
    } finally { release(); await rt.idle(); rt.dispose() }
  } finally { release(); await p.close() }
})

test('host compaction callback clears read state before the next references delivery', async () => {
  const p = pipeline(), read = new Set(['doc:lantern']), reports: Report[] = []
  const rt = runtime({ stage: 'active' }, r => { reports.push(r); return { reportId: monitoringReportId(r), status: 'enqueued' } }, createReferencesHandlers(() => new Set(read)))
  // Host-owned reducer. The module does not listen to hooks or infer reads from reports.
  const accept = (f: ReturnType<typeof frame>) => { if (f.sourceEvent === 'session_compact') read.clear(); p.accept(f) }
  try {
    accept(frame(2)); await p.idle()
    const before = p.coordinator.takeReady('module')
    expect(before).toHaveLength(1)
    expect((await rt.onTrigger(triggerFor(packets(before[0])[0])))[0].status).toBe('rejected')
    expect(reports).toEqual([])
    accept(frame(3, 'session_compact'))
    accept(frame(4)); await p.idle()
    const after = p.coordinator.takeReady('module')
    expect(after).toHaveLength(1)
    expect((await rt.onTrigger(triggerFor(packets(after[0])[0])))[0].reported).toBe(true)
    expect(reports).toHaveLength(1)
    expect(read.size).toBe(0) // delivery must not invent an actual read
  } finally { await rt.idle(); rt.dispose(); await p.close() }
})

for (const malformed of ['unknown-field', 'negative-cursor', 'wrong-session', 'accessor'] as const) test(`strict admission rejects ${malformed} without a judge`, async () => {
  const p = pipeline()
  try {
    const bad = structuredClone(frame(2)) as unknown as Record<string, unknown>
    let touched = false
    if (malformed === 'unknown-field') bad.extra = true
    if (malformed === 'negative-cursor') bad.cursor = -1
    if (malformed === 'wrong-session') (bad.snapshot as Record<string, unknown>).sessionId = 'other'
    if (malformed === 'accessor') Object.defineProperty(bad, 'payload', { enumerable: true, get() { touched = true; throw Error('must not execute') } })
    p.accept(bad as unknown as ReturnType<typeof frame>); await p.idle()
    expect(touched).toBe(false); expect(p.requests).toEqual([])
    expect(p.coordinator.takeReady('module')).toEqual([])
    expect(p.window.getStatus().state).toBe('stopped')
  } finally { await p.close() }
})
