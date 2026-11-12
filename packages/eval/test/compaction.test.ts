import { expect, test } from 'bun:test'
import { generateCompactionDev } from '../src/compaction-generate-dev.ts'
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
    expect(regions.flatMap(r => Object.values(labels.labels[r.id])).filter(Boolean)).toHaveLength(32)
    expect(regions.reduce((n, r) => n + r.materials.length, 0)).toBe(191)
    expect(regions.some(r => r.materials.some(m => m.text.length > 700))).toBe(true)
    expect(regions.some(r => labels.labels[r.id][r.materials[0].id])).toBe(true)
    expect(regions.some(r => labels.labels[r.id][r.materials.at(-1)!.id])).toBe(true)
    expect(regionTask(regions[0]).question.instructions).toContain(compactionQuestions[purpose].instructions)
  }
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
  expect(s.overall.neededItemRetention).toMatchObject({ numerator: 96, denominator: 96, rate: 1 })
  expect(s.overall.noiseRemoval).toMatchObject({ numerator: 477, denominator: 477, rate: 1 })
  expect(s.overall.itemReduction.denominator).toBe(573)
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
