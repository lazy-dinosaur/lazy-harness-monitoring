import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { JudgeTask } from '@lazy-harness/monitoring-core'
import { RealtimeSelectionBridge } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-selection.ts'
import { RealtimeMaterialWindow } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-material.ts'
import { buildRegionCompactionTask, applyRegionCompaction, regionCompactionCandidates } from '@lazy-harness/monitoring-core/engine/region-compaction.ts'
import { scriptedModels } from '../../../examples/p1/support.ts'
import { frame, question } from './support/p2-fixtures.ts'
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
test('per-item compaction question carries the module purpose (single-factor revision 1)', () => {
  const t = buildRegionCompactionTask({ module: { id: 'm', question: { ...question, instructions: 'PURPOSE-XYZ' } }, materials: [], key: 'k', request: 1, dependency: { id: 'd', version: '1' }, frame: { id: 'f', sourceEvent: 'turn_end', cursor: 1 }, goal: 'g' })
  expect(t.question.reference!.instructions).toContain('Module purpose: PURPOSE-XYZ')
  expect(t.question.reference!.instructions).not.toContain('Keep only directly relevant')
})
for (const mode of ['keep', 'fail', 'single'] as const) test(`runtime compaction equals pure builder; ${mode}`, async () => {
  const models = scriptedModels(), window = new RealtimeMaterialWindow({ enabled: true, allowedKinds: ['conversation-history'], historyMode: 'since-last', metaEvents: ['turn_end'] })
  const module = { id: 'test.compact', compactRegion: { budgetBytes: 1, pinNewest: 0 }, watchEvents: ['turn_end'], referenceKinds: ['conversation-history'], grants: { actions: ['monitoring.selected-material'], referenceKinds: ['conversation-history'] }, question, destination: 'test' }
  const bridge = new RealtimeSelectionBridge({ enabled: true, window, modules: [module], modelConfig: models.config, modelHost: models.host, goal: 'test', isPermitted: () => true })
  const f = frame(1, 'turn_end'); (f.snapshot as any).canonicalMessages = [{ role: 'user', content: 'Need project evidence' }, ...(mode === 'single' ? [] : [{ role: 'assistant', content: 'Unrelated noise' }, { role: 'assistant', content: 'Current action' }])]
  window.start({ sessionId: f.sessionId, binding: f.binding }); window.capture(f, 0)
  const snapshot = window.snapshot(f.id, ['conversation-history'])
  const input = { frame: f, epoch: 1, step: 0, generation: 1 }, tasks: JudgeTask[] = []
  const router = (bridge as any).models, original = router.judgeBatch
  router.judgeBatch = async (batch: JudgeTask[], signal: AbortSignal) => { tasks.push(...batch); if (mode === 'fail' && batch[0]?.view.event.id.endsWith(':compact')) throw Error('fake failure'); return original(batch, signal) }
  try {
    await bridge.prepare(input, { signal: new AbortController().signal, isCurrent: () => true }); await bridge.idle()
    const compact = tasks.filter(t => t.view.event.id.endsWith(':compact'))
    if (mode === 'single') {
      expect(compact).toHaveLength(0)
      expect(bridge.traces.some(r => r.status === 'region_within_budget')).toBe(true)
    }
    else {
      expect(compact).toEqual([buildRegionCompactionTask({ module, materials: snapshot.materials, key: hash([f.sessionId, f.binding, 1, 1, f.id]), request: 1, dependency: snapshot.dependency, frame: f, goal: 'test' })])
      expect(bridge.traces.some(r => r.status === (mode === 'fail' ? 'region_compaction_failed' : 'region_compacted'))).toBe(true)
      if (mode === 'fail') expect(tasks.find(t => !t.view.event.id.endsWith(':compact'))!.view.context.references).toEqual(snapshot.materials.map(({ id, kind, version, content }) => ({ id, kind, version, content })))
    }
    const head = { ...snapshot.materials[0]!, id: 'head', text: '[memo] keep me' }, nonRegion = { ...head, id: 'other', kind: 'user-text' }
    expect(regionCompactionCandidates([head, nonRegion])).toEqual([])
    const applied = applyRegionCompaction([...snapshot.materials, head, nonRegion], ['unknown', snapshot.materials[0]!.id])
    expect(applied.materials).toEqual([snapshot.materials[0]!, head, nonRegion])
    expect(applied.materials[0]).toBe(snapshot.materials[0])
  } finally { bridge.dispose(); window.dispose(); await bridge.idle() }
})
