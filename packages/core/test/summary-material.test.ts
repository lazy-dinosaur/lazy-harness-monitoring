import { expect, test } from 'bun:test'
import { boundedSummary } from '../src/engine/compaction-summary.ts'
import { regionLines } from '../src/engine/monitoring-core-realtime-material.ts'
import { createIndependentSelectionPipelines, type RealtimeWatchModule } from '../src/engine/monitoring-core-realtime-selection.ts'
import { config, fixture } from './support/model-fixture.ts'
import type { ObservationFrame } from '../src/host/frames.ts'
const summary = '# Goal\n' + '🙂'.repeat(2000) + '\n## Progress\n' + 'complete '.repeat(1500) + '\n## Next\n' + 'test '.repeat(1000)
test('section-aware truncation is deterministic, UTF-8 bounded, preserves headers and each section start', () => {
  const a = boundedSummary(summary, 800)
  expect(a).toEqual(boundedSummary(summary, 800)); expect(Buffer.byteLength(a.text)).toBeLessThanOrEqual(800)
  expect(a.text).toContain('# Goal\n🙂'); expect(a.text).toContain('\n## Progress\ncomplete'); expect(a.text).toContain('\n## Next\ntest')
  expect(a.text).toContain(`[summary omitted ${a.omittedBytes} bytes]`); expect(a.text).not.toContain('�')
  expect(regionLines({ role: 'compactionSummary', summary }).lines[0]).toStartWith('[summary] ')
})
test('9.8 KiB catalog plus long summary judges within 16 KiB; summary remains context, outside region and own items', async () => {
  const f = fixture()
  const module: RealtimeWatchModule = { id: 'summary.mod', watchEvents: ['input'], referenceKinds: ['knowledge', 'user-text', 'conversation-history'], grants: { referenceKinds: ['knowledge', 'user-text', 'conversation-history'], actions: ['monitoring.selected-material'] }, question: { instructions: 'q', criteria: { run: 'r', skip: 's', defer: 'd' } }, destination: 'sink' }
  const set = createIndependentSelectionPipelines({ enabled: true, material: { allowedKinds: module.referenceKinds, references: [0, 1].map(i => ({ id: `catalog:${i}`, kind: 'knowledge', version: 'v', content: 'r'.repeat(5000) })), historyMode: 'since-last' }, selection: { modules: [module], goal: 'g', modelConfig: config(), modelHost: f.host, isPermitted: () => true }, realtimeLimits: { jobTimeoutMs: 10000 } })
  const p = set.pipelines[0]!
  p.window.start({ sessionId: 's', binding: 1 }); p.coordinator.start({ sessionId: 's', binding: 1 })
  const frame: ObservationFrame = { id: 'f:1', cursor: 1, sourceEvent: 'input', kind: 'user.input', sessionId: 's', binding: 1, epoch: 0, available: true, payload: { text: 'next request' }, snapshot: { sessionId: 's', leafId: 'leaf', branch: [], canonicalMessages: Array.from({ length: 60 }, (_, i) => ({ role: 'assistant', content: `recent ${i} ` + 'x'.repeat(700) })), compactionSummary: { role: 'compactionSummary', summary, provenance: 'derived-summary' }, summaryIncluded: true, summaryOmittedBytes: 0, truncatedHead: 23, effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: 'h', revision: 'r', available: true, fullProviderContext: false, omitted: [] } }
  try {
    p.window.capture(frame, 0); p.coordinator.accept(frame); await set.idle()
    expect(p.window.traces.some(t => t.reason === 'material_limit')).toBe(false)
    expect(p.window.getStatus().bytes).toBeLessThanOrEqual(16384)
    expect(f.calls).toHaveLength(1)
    const snap = p.window.snapshot(frame.id, module.referenceKinds, { tailItems: 0 })
    const s = snap.materials.find(m => m.provenance.owner === 'derived-summary')!
    expect(s.text).toContain('[summary]'); expect(s.text).toContain('summary omitted')
    expect(snap.currentIds).not.toContain(s.id)
    expect(JSON.parse(s.content).region).toBeUndefined()
    expect(JSON.stringify(f.calls[0]!.request)).toContain('[summary]')
  } finally { set.dispose(); await set.idle() }
})
