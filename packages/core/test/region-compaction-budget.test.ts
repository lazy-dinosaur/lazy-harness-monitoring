import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { compactionSettings, regionCompactionDefaults, planRegionCompaction, regionBytes, buildRegionCompactionTask, applyRegionCompaction, type CompactionDecision } from '../src/engine/region-compaction.ts'
import { RealtimeMaterialWindow, type RealtimeMaterial } from '../src/engine/monitoring-core-realtime-material.ts'
import { decodeMonitoringJudgements, monitoringJudgeRequest } from '../src/sdk/model-adapters.ts'
import type { MonitoringBoundModelProfile } from '../src/sdk/model-schema.ts'
import { frame, question } from './support/p2-fixtures.ts'
const f = { id: 'current', sourceEvent: 'message_end', cursor: 4 }
const item = (id: string, text: string, index: number, extra = {}): RealtimeMaterial => ({ id, text, kind: 'conversation-history', version: 'v', provisional: false, content: JSON.stringify({ text, provisional: false, region: true, regionIndex: index, ...extra }), provenance: { owner: 'observation', observationId: f.id, sessionId: 's', binding: 1, sourceEvent: f.sourceEvent, cursor: f.cursor, step: 0, stage: 'event-hook' } })
const items = [item('a', '[assistant] oldest alpha', 0), item('b', '[assistant] middle bravo', 1), item('c', '[assistant] latest charlie', 2), item('u', '[user] Fix the checkpoint', 3), item('d', '[assistant] I will inspect the ledger', 4)]
const decision = (referenceProbabilities: Record<string, number>): CompactionDecision => ({ mode: 'skip', reason: 'irrelevant to code decision', evidenceRefs: ['unknown'], referenceProbabilities })
const input = (materials = items) => ({ module: { id: 'test.compact', question }, materials, key: 'k', request: 1, dependency: { id: 'w', version: '1' }, frame: f, goal: 'g' })
test('validated defaults and false compatibility', () => {
  expect(compactionSettings(true)).toEqual(regionCompactionDefaults)
  expect(compactionSettings(false)).toEqual(regionCompactionDefaults)
  expect(compactionSettings({ dropBelow: 0, pinNewest: 0, budgetBytes: 1 })).toEqual({ dropBelow: 0, pinNewest: 0, budgetBytes: 1 })
})
for (const invalid of [{ budgetBytes: 0 }, { budgetBytes: 1.5 }, { budgetBytes: NaN }, { pinNewest: -1 }, { pinNewest: 1.5 }, { dropBelow: -0.1 }, { dropBelow: 1.1 }, { dropBelow: NaN }, { unknown: 1 }, null, []]) test(`reject settings ${JSON.stringify(invalid)}`, () => {
  expect(() => compactionSettings(invalid as any)).toThrow()
})
test('UTF-8 content bytes gate exact boundary, preserving original array when skipped', () => {
  const materials = [...items, item('unicode', '[assistant] 한글🙂', 5)], base = planRegionCompaction(materials, { frame: f, settings: { pinNewest: 0 } })
  const policy = { frame: f, settings: { budgetBytes: base.candidateBytes, pinNewest: 0 } }
  expect(base.candidateBytes).toBe(regionBytes(base.units.flatMap(u => u.members)))
  expect(planRegionCompaction(materials, policy).withinBudget).toBe(true)
  expect(applyRegionCompaction(materials, [], policy).materials).toBe(materials)
  expect(planRegionCompaction(materials, { ...policy, settings: { ...policy.settings, budgetBytes: base.candidateBytes - 1 } }).withinBudget).toBe(false)
})
test('pins heads, latest user, newest two, and event-owned non-region items; not whole projection', () => {
  const head = item('head', '[omitted 4 earlier items of this region]', 0), own = { ...item('own', 'current action', 0), kind: 'assistant-text' }
  const plan = planRegionCompaction([head, ...items, own], { frame: f })
  expect([...plan.pins].sort()).toEqual(['d', 'head', 'own', 'u'])
  expect(plan.units.map(u => u.id)).toEqual(['a', 'b', 'c'])
  const task = buildRegionCompactionTask(input([head, ...items, own]))
  expect(task.view.event.payload).toMatchObject({ task: expect.stringContaining('Fix the checkpoint') })
  expect(task.question.reference!.instructions).toContain(question.instructions)
  expect(task.question.reference!.instructions).toContain('Current task:')
  expect(task.view.context.references.map(r => r.id)).toEqual(['a', 'b', 'c'])
})
test('canonical index pins every line of current message, not every item captured by this frame', () => {
  const materials = [...items.slice(0, 3), item('call', '[tool call] read → src/checkpoint.ts', 3), item('text', '[assistant] Inspecting checkpoint', 3)]
  const plan = planRegionCompaction(materials, { frame: { ...f, snapshot: { truncatedHead: 1, canonicalMessages: [{}, {}, {}] } }, settings: { pinNewest: 0 } })
  expect([...plan.pins].sort()).toEqual(['call', 'text'])
  expect(plan.units.map(u => u.id)).toEqual(['a', 'b', 'c'])
})
test('current input beats historical projected user in explicit task', () => {
  const user = { ...item('own', 'Fix CURRENT input', 0), kind: 'user-text' }
  expect(planRegionCompaction([user, ...items], { frame: { ...f, sourceEvent: 'input' } }).task).toContain('Fix CURRENT input')
})
test('tool IDs join interleaved calls and multiple results; pin propagates to full exchange', () => {
  const materials = [item('c1', '[tool call] read → a', 0, { toolCallId: 'one' }), item('c2', '[tool call] read → b', 0, { toolCallId: 'two' }), item('r2', '[tool result:read] ok', 1, { toolCallId: 'two' }), item('r1', '[tool result:read] error', 2, { toolCallId: 'one' }), item('r1b', '[tool result:read] recovered', 3, { toolCallId: 'one' }), ...items.slice(3)]
  const plan = planRegionCompaction(materials, { settings: { pinNewest: 0 } })
  expect(plan.units[0]!.members.map(m => m.id)).toEqual(['c1', 'r1', 'r1b'])
  expect(plan.units[1]!.members.map(m => m.id)).toEqual(['c2', 'r2'])
  const pinned = planRegionCompaction(materials.slice(0, 5), { settings: { pinNewest: 1 } })
  expect([...pinned.pins].sort()).toEqual(['c1', 'r1', 'r1b'])
  const legacy = planRegionCompaction([item('call', '[tool call] read → a', 0), item('result', '[tool result:read] ok', 1)], { settings: { pinNewest: 0 } })
  expect(legacy.units).toHaveLength(1)
})
test('strict dropBelow boundary then least-probable first and older-first ties', () => {
  const budget = regionBytes([items[2]!]), policy = { frame: f, settings: { budgetBytes: budget, pinNewest: 0 } }
  const kept = applyRegionCompaction(items, decision({ a: .19, b: .2, c: .2 }), policy)
  expect(kept.materials.map(m => m.id)).toEqual(['c', 'u', 'd'])
  expect(kept.materials[0]).toBe(items[2])
  const largest = regionBytes(items.slice(0, 3)) - 1
  expect(applyRegionCompaction(items, decision({ a: .21, b: .2, c: .9 }), { frame: f, settings: { budgetBytes: largest, pinNewest: 0 } }).materials.map(m => m.id)).toEqual(['a', 'c', 'u', 'd'])
})
test('tool exchange maps unit probability to all member ids and retains original order', () => {
  const pair = [item('call', '[tool call] read → a', 0), item('result', '[tool result:read] ok', 1)], materials = [...pair, ...items.slice(3)]
  const policy = { settings: { budgetBytes: regionBytes(pair), pinNewest: 0 } }
  // Force a call with one extra candidate, then keep the complete pair at the exact byte boundary.
  const expanded = [items[0]!, ...materials]
  expect(applyRegionCompaction(expanded, decision({ a: .1, call: .2, d: .1 }), policy).materials.map(m => m.id)).toEqual(['call', 'result', 'u'])
})
test('missing/malformed probability rejects, legacy evidence-ref API unchanged', () => {
  for (const p of [{}, { a: NaN, b: .5, c: .5 }, { a: 2, b: .5, c: .5 }]) expect(() => applyRegionCompaction(items, decision(p as Record<string, number>), { frame: f, settings: { budgetBytes: 1, pinNewest: 0 } })).toThrow()
  expect(applyRegionCompaction(items, ['b', 'unknown']).materials).toEqual([items[1]!])
})
test('additive native compaction probabilities do not change threshold evidenceRefs or ordinary decode shape', () => {
  const t = buildRegionCompactionTask(input()), profile = { kind: 'native-classifier', referenceThreshold: .5 } as MonitoringBoundModelProfile
  const raw = { stopReason: 'stop', answers: { decision_0: { type: 'choice', choice: 'skip' }, ref_0_0: { type: 'bool', probability: .2 }, ref_0_1: { type: 'bool', probability: .5 }, ref_0_2: { type: 'bool', probability: .9 } } }
  const d = decodeMonitoringJudgements([t], profile, raw)['test.compact']!
  expect(d.evidenceRefs).toEqual([t.view.eventRef, 'b', 'c'])
  expect(d.referenceProbabilities).toEqual({ a: .2, b: .5, c: .9 })
  const ordinary = { ...t, view: { ...t.view, event: { ...t.view.event, id: 'ordinary' }, eventRef: 'event:ordinary' } }
  expect(decodeMonitoringJudgements([ordinary], profile, raw)['test.compact']).toEqual({ mode: 'skip', reason: t.question.criteria.skip, evidenceRefs: ['event:ordinary', 'b', 'c'] })
  const verify = { ...ordinary, question: { ...ordinary.question, selectReferences: false as const } }
  expect(decodeMonitoringJudgements([verify], profile, { stopReason: 'stop', answers: { decision_0: raw.answers.decision_0 } })['test.compact']).not.toHaveProperty('referenceProbabilities')
  expect((monitoringJudgeRequest([t], 'native-classifier').body as any).state.tasks[0].view.event.payload.task).toContain('Fix the checkpoint')
})
test('real window emits bounded pairing identities and triggers pin for current tool action', () => {
  const window = new RealtimeMaterialWindow({ enabled: true, allowedKinds: ['conversation-history'], historyMode: 'since-last', metaEvents: ['tool_call'] })
  window.enableRegionCompactionUnits()
  const fr = frame(1, 'tool_call'); (fr.payload as any) = { toolCallId: 'call-1' }
  ;(fr.snapshot as any).canonicalMessages = [{ role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } }] }, { role: 'toolResult', toolName: 'read', toolCallId: 'call-1', content: 'ok' }, { role: 'assistant', content: 'next' }]
  window.start({ sessionId: fr.sessionId, binding: fr.binding }); window.capture(fr, 0)
  const materials = window.snapshot(fr.id, ['conversation-history']).materials, plan = planRegionCompaction(materials, { frame: fr, settings: { pinNewest: 0 } })
  const id = createHash('sha256').update(JSON.stringify('call-1')).digest('hex')
  const paired = materials.filter(m => JSON.parse(m.content).toolCallId === id)
  expect(paired).toHaveLength(2); expect(paired.every(m => plan.pins.has(m.id))).toBe(true)
  expect(plan.task).toContain('[tool call] read → a.ts')
  window.dispose()
})
test('non-compacting material windows retain their exact previous tool content shape', () => {
  const window = new RealtimeMaterialWindow({ enabled: true, allowedKinds: ['conversation-history'], historyMode: 'since-last', metaEvents: ['turn_end'] })
  const fr = frame(1, 'turn_end')
  ;(fr.snapshot as any).canonicalMessages = [{ role: 'assistant', content: [{ type: 'toolCall', id: 'private-id', name: 'read', arguments: { path: 'a.ts' } }] }, { role: 'toolResult', toolCallId: 'private-id', toolName: 'read', content: 'ok' }]
  window.start({ sessionId: fr.sessionId, binding: fr.binding }); window.capture(fr, 0)
  const region = window.snapshot(fr.id, ['conversation-history']).materials
  expect(region.filter(m => m.text.startsWith('[tool')).map(m => JSON.parse(m.content))).toEqual([
    { text: '[tool call] read → a.ts', provisional: false, region: true, regionIndex: 0 },
    { text: '[tool result:read] ok', provisional: false, region: true, regionIndex: 1 },
  ])
  window.dispose()
})
