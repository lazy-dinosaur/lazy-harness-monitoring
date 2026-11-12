import { expect, test } from 'bun:test'
import { generateCompactionDev, validateDevDataset, validateConversation, forbiddenHints, devGoals, type DevEntry } from '../src/compaction-generate-dev.ts'
import { parseRegionDataset, parseRegionLabels, purposes } from '../src/compaction-dataset.ts'
import { evaluateCompaction, scoreCompaction, wilson, regionTask, deterministicCompactionStub, compactionQuestions } from '../src/compaction.ts'
import { createMonitoringModelRouter } from '@lazy-harness/monitoring-core'
import { scriptedModels } from '../../../examples/p1/support.ts'
const { dataset, labels } = generateCompactionDev()
test('committed dev schema and deterministic reproduction: 60 regions; 20/purpose; 5-15 real-shaped items', async () => {
  expect(parseRegionDataset(await Bun.file(new URL('../data/compaction-dev/regions.json', import.meta.url)).json())).toEqual(dataset)
  expect(parseRegionLabels(await Bun.file(new URL('../data/compaction-dev/labels.json', import.meta.url)).json(), dataset)).toEqual(labels)
  expect(dataset.regions).toHaveLength(60)
  for (const purpose of purposes) {
    const regions = dataset.regions.filter(r => r.purpose === purpose)
    expect(regions).toHaveLength(20)
    expect(regions.filter(r => !Object.values(labels.labels[r.id]).some(Boolean))).toHaveLength(4)
    const counts = { references: [36, 113], 'rule-steering': [33, 107], memory: [20, 115] }[purpose]
    expect(regions.flatMap(r => Object.values(labels.labels[r.id])).filter(Boolean)).toHaveLength(counts[0])
    expect(regions.reduce((n, r) => n + r.materials.length, 0)).toBe(counts[1])
    expect(new Set(regions.map(r => r.goal))).toEqual(new Set([devGoals[purpose]]))
    expect(new Set(regions.map(r => r.materials.length)).size).toBeGreaterThan(2)
    expect(regions.some(r => r.materials.slice(1, -1).some(m => labels.labels[r.id][m.id]))).toBe(true)
    expect(regions.some(r => r.materials.some(m => m.text.length > 700))).toBe(true)
    expect(regions.some(r => labels.labels[r.id][r.materials[0].id])).toBe(true)
    expect(regions.some(r => labels.labels[r.id][r.materials.at(-1)!.id])).toBe(true)
    expect(regionTask(regions[0]).question.instructions).toContain(compactionQuestions[purpose].instructions)
  }
})
test('DEV text quality: no hints/region duplicates; global uniqueness >=95%; realistic roles and event context', () => {
  expect(() => validateDevDataset(dataset)).not.toThrow()
  const texts = dataset.regions.flatMap(r => r.materials.map(m => m.text))
  expect(new Set(texts).size).toBe(327)
  expect(new Set(texts).size / texts.length).toBeGreaterThanOrEqual(.95)
  for (const r of dataset.regions) {
    expect(new Set(r.materials.map(m => m.text)).size).toBe(r.materials.length)
    expect(r.frame.sourceEvent).toBe('message_end')
    expect(r.goal).not.toMatch(/Current (request|action|event)|already read|docs\//i)
    for (const m of r.materials) expect(m.text).toMatch(/^\[(user|assistant|tool call|tool result:read)\] /)
    if (Object.values(labels.labels[r.id]).some(Boolean)) {
      expect(r.materials.at(-1)!.text).toStartWith(r.purpose === 'rule-steering' ? '[assistant]' : '[user]')
      expect(labels.labels[r.id][r.materials.at(-1)!.id]).toBe(true)
    }
  }
})
for (const hint of forbiddenHints) test(`DEV rejects answer hint: ${hint}`, () => {
  const d = structuredClone(dataset); d.regions[0].materials[0] = { ...d.regions[0].materials[0], text: `[user] ${hint}` }
  expect(() => validateDevDataset(d)).toThrow('forbidden answer hint')
})
for (const defect of ['duplicate', 'global-repetition', 'changing-goal', 'orphan-result', 'missing-result', 'interleaved-result'] as const) test(`DEV rejects ${defect}`, () => {
  const d = structuredClone(dataset), items = d.regions[0].materials
  if (defect === 'duplicate') items[1] = { ...items[1], text: items[0].text }
  if (defect === 'global-repetition') for (const r of d.regions) r.materials = r.materials.map((m, i) => ({ ...m, text: `[user] Common message ${i}` }))
  if (defect === 'changing-goal') d.regions[0].goal += ' Current request: fix cache.'
  if (defect === 'orphan-result') items[0] = { ...items[0], text: '[tool result:read] ok' }
  if (defect === 'missing-result') items[items.length - 1] = { ...items.at(-1)!, text: '[tool call] read → docs/cache.md' }
  if (defect === 'interleaved-result') items[0] = { ...items[0], text: '[tool call] read → docs/config.md' }
  expect(() => validateDevDataset(d)).toThrow()
})
test('authoring checks read call/result target identity before core discards result bodies', () => {
  const call: DevEntry = { kind: 'c', text: 'docs/contract.md', needed: false }
  const result: DevEntry = { kind: 'r', text: 'docs/contract.md', needed: false }
  expect(() => validateConversation([call, result])).not.toThrow()
  expect(() => validateConversation([call, { ...result, text: 'docs/draft.md' }])).toThrow('target')
  expect(() => validateConversation([result, call])).toThrow()
  expect(() => validateConversation([call, call, result])).toThrow()
  expect(() => validateConversation([call])).toThrow()
  expect(() => validateConversation([call, { kind: 'u', text: 'Continue.', needed: false }, result])).toThrow()
})
for (const corruption of ['extra-label', 'content-label', 'duplicate-id', 'bad-region', 'bad-provenance'] as const) test(`schema rejects ${corruption}`, () => {
  const d: any = structuredClone(dataset), m = d.regions[0].materials[0]
  if (corruption === 'extra-label') (m as any).needed = true
  if (corruption === 'content-label') m.content = JSON.stringify({ ...JSON.parse(m.content), needed: true })
  if (corruption === 'duplicate-id') d.regions[0].materials[1].id = m.id
  if (corruption === 'bad-region') m.content = '{}'
  if (corruption === 'bad-provenance') (m.provenance as any).stage = 'bad'
  expect(() => parseRegionDataset(d)).toThrow()
})
test('labels require exact region/item coverage and boolean values', () => {
  const l = structuredClone(labels); delete l.labels[dataset.regions[0].id]
  expect(() => parseRegionLabels(l, dataset)).toThrow()
  const bad = structuredClone(labels); (bad.labels[dataset.regions[0].id] as any)[dataset.regions[0].materials[0].id] = 'yes'
  expect(() => parseRegionLabels(bad, dataset)).toThrow()
})
test('label isolation through actual core model-host adapter: flip gold, wire unchanged', async () => {
  const models = scriptedModels(), router = createMonitoringModelRouter(models.config, models.host)
  try {
    const d = { ...dataset, regions: dataset.regions.slice(0, 1) }
    const first = await evaluateCompaction(d, router.judgeBatch)
    const wire = structuredClone(models.calls)
    const flipped = structuredClone(labels); for (const values of Object.values(flipped.labels)) for (const id of Object.keys(values)) values[id] = !values[id]
    scoreCompaction(d, flipped, first)
    await evaluateCompaction(d, router.judgeBatch)
    expect(models.calls.slice(1)).toEqual(wire)
    expect(JSON.stringify(wire)).not.toContain('needed"')
    expect(JSON.stringify(wire)).not.toContain('labels"')
    expect(JSON.stringify(wire)).not.toContain('provenance')
  } finally { router.dispose(); await router.idle() }
})
test('perfect selection scoring and explicit denominators', async () => {
  const rows = await evaluateCompaction(dataset, async tasks => Object.fromEntries(tasks.map(t => [t.processorId, { mode: 'run', reason: 'oracle offline test', evidenceRefs: t.view.context.references.filter(r => Object.values(labels.labels).some(l => l[r.id])).map(r => r.id) }])))
  const s = scoreCompaction(dataset, labels, rows)
  expect(s.overall.neededItemRetention).toMatchObject({ numerator: 89, denominator: 89, rate: 1 })
  expect(s.overall.noiseRemoval).toMatchObject({ numerator: 246, denominator: 246, rate: 1 })
  expect(s.overall.itemReduction.denominator).toBe(335)
  expect(s.overall.allDropped).toMatchObject({ numerator: 12, denominator: 60 })
  expect(s.overall.failureFallback.rate).toBe(0)
  expect(s.overall.costUsd).toBe(0)
  expect(s.overall.provisionalRetentionPass).toBe(true)
  expect(s.overall.latencyMs.denominator).toBe(60)
})
test('failure retains full region, all-dropped is distinct, and empty recall is undefined', async () => {
  const d = { ...dataset, regions: dataset.regions.slice(0, 1) }
  const failed = await evaluateCompaction(d, async () => { throw Error('fake failure') })
  const s = scoreCompaction(d, labels, failed).overall
  expect(failed[0].keptIds).toHaveLength(d.regions[0].materials.length)
  expect(s.failureFallback.rate).toBe(1); expect(s.itemReduction.rate).toBe(0)
  expect(s.neededItemRetention.rate).toBeNull(); expect(s.neededItemRetention.ci95).toBeNull()
  const empty = await evaluateCompaction(d, async tasks => ({ [tasks[0].processorId]: { mode: 'skip', reason: 'none', evidenceRefs: [] } }))
  expect(scoreCompaction(d, labels, empty).overall.allDropped.rate).toBe(1)
})
test('Wilson known case and scorer rejects incomplete/duplicate results', async () => {
  const ci = wilson(95, 100).ci95!
  expect(ci[0]).toBeCloseTo(.88825, 4); expect(ci[1]).toBeCloseTo(.97846, 4)
  const rows = await evaluateCompaction(dataset, deterministicCompactionStub)
  expect(() => scoreCompaction(dataset, labels, rows.slice(1))).toThrow()
  expect(() => scoreCompaction(dataset, labels, [rows[0], ...rows.slice(0, -1)])).toThrow()
})
