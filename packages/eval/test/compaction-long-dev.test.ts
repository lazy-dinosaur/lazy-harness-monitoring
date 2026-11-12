import { expect, test } from 'bun:test'
import { generateCompactionLongDev } from '../src/compaction-generate-long-dev.ts'
import { validateDevDataset, devGoals } from '../src/compaction-generate-dev.ts'
import { parseRegionDataset, parseRegionLabels, purposes } from '../src/compaction-dataset.ts'
import { evaluateCompaction, regionTask, compactionQuestions, deterministicCompactionStub, scoreCompaction } from '../src/compaction.ts'
import { buildRegionCompactionTask, applyRegionCompaction, planRegionCompaction, regionBytes } from '../../core/src/engine/region-compaction.ts'
import { budgetSweep, estimateDataset, parseRunArgs } from '../../../hosts/pi/src/eval/compaction-run.ts'
import { MODEL, type ClassifierModel } from '../../../hosts/pi/src/eval/compaction-transport.ts'
import { validateLongDevDiversity, nearDuplicate, longDevMetrics } from './compaction-long-dev-quality.ts'
const { dataset, labels } = generateCompactionLongDev()
test('LONG DEV near-duplicate, position, count and role diversity', () => {
  const m = validateLongDevDiversity(dataset, labels)
  expect(m.localPairs).toBe(0)
  expect(m.globalNearDuplicateRatio).toBeLessThanOrEqual(.05)
  expect(m.distinctPatterns).toBeGreaterThanOrEqual(20)
})
test('near-duplicate guard rejects repeated sentences and 60-character prefixes despite unique suffixes', () => {
  const oldOpening = 'The invoice export service writes a manifest before uploading CSV partitions.'
  expect(nearDuplicate(`[assistant] ${oldOpening} Trace one.`, `[user] ${oldOpening} Trace two.`)).toBe(true)
  const prefix = 'A deliberately long observation without punctuation that occupies more than sixty characters'
  expect(nearDuplicate(`${prefix} finishes here.`, `${prefix} finishes elsewhere.`)).toBe(true)
  expect(nearDuplicate('Batch 12 has observations. Alpha.', 'Batch 99 has observations. Beta.')).toBe(true)
  const broken = structuredClone(dataset)
  broken.regions[0]!.materials[1] = { ...broken.regions[0]!.materials[1]!, text: `${broken.regions[0]!.materials[0]!.text} Different suffix.` }
  expect(() => validateLongDevDiversity(broken, labels)).toThrow('near-duplicate items within region')
})
test('global near-duplicate bound catches repeated prefixes across otherwise diverse regions', () => {
  const broken = structuredClone(dataset)
  for (const [i, r] of broken.regions.entries()) for (const [j, m] of r.materials.slice(0, 2).entries()) {
    r.materials[j] = { ...m, text: `${j ? 'Second' : 'First'} repeated cross-region observation with a sufficiently long common prefix for the audit ${i} ${m.id}` }
  }
  expect(longDevMetrics(broken, labels).globalNearDuplicateRatio).toBeGreaterThan(.05)
  expect(() => validateLongDevDiversity(broken, labels)).toThrow('global near-duplicate item ratio exceeds 5%')
})
test('position guard catches the original shared gold-index template', () => {
  const fixed = structuredClone(labels)
  for (const r of dataset.regions) for (const [i, m] of r.materials.entries()) fixed.labels[r.id]![m.id] = [5, 11, 12, 21].includes(i)
  expect(() => validateLongDevDiversity(dataset, fixed)).toThrow('needed position patterns below 20')
})
test('role guards reject assistant-only gold and assistant-only noise', () => {
  const assistantGold = structuredClone(labels)
  for (const r of dataset.regions) for (const m of r.materials) if (!m.text.startsWith('[assistant]')) assistantGold.labels[r.id]![m.id] = false
  // Restrict this assertion to role counts: a collapsed position distribution may fail first.
  expect(longDevMetrics(dataset, assistantGold).perPurpose.references!.neededKinds).toEqual(['assistant'])
  expect(() => validateLongDevDiversity(dataset, assistantGold)).toThrow()
  const assistantNoise = structuredClone(labels)
  for (const r of dataset.regions) for (const m of r.materials) assistantNoise.labels[r.id]![m.id] = !m.text.startsWith('[assistant]')
  expect(longDevMetrics(dataset, assistantNoise).perPurpose.memory!.noiseKinds).toEqual(['assistant'])
  expect(() => validateLongDevDiversity(dataset, assistantNoise)).toThrow()
})
test('short/long shapes overlap gold and noise in every purpose', () => {
  for (const purpose of purposes) {
    const regions = dataset.regions.filter(r => r.purpose === purpose)
    const gold = regions.flatMap(r => r.materials.filter(m => labels.labels[r.id]![m.id]))
    const noise = regions.flatMap(r => r.materials.filter(m => !labels.labels[r.id]![m.id]))
    for (const group of [gold, noise]) {
      expect(group.some(m => m.text.length >= 600)).toBe(true)
      expect(group.some(m => m.text.length <= 300)).toBe(true)
    }
  }
})
test('every rendered exchange has adjacent matching IDs and one gold label for the whole unit', () => {
  for (const r of dataset.regions) for (const [i, m] of r.materials.entries()) {
    if (!m.text.startsWith('[tool call]')) continue
    const next = r.materials[i + 1]!
    expect(next.text.startsWith('[tool result:read]')).toBe(true)
    expect(JSON.parse(m.content).toolCallId).toBe(JSON.parse(next.content).toolCallId)
    expect(labels.labels[r.id]![m.id]).toBe(labels.labels[r.id]![next.id])
  }
})
test('LONG DEV committed reproduction, separate labels, same quality checks and window bounds', async () => {
  expect(parseRegionDataset(await Bun.file(new URL('../data/compaction-long-dev/regions.json', import.meta.url)).json())).toEqual(dataset)
  expect(parseRegionLabels(await Bun.file(new URL('../data/compaction-long-dev/labels.json', import.meta.url)).json(), dataset)).toEqual(labels)
  expect(() => validateDevDataset(dataset)).not.toThrow()
  expect(dataset.regions).toHaveLength(30)
  const texts = dataset.regions.flatMap(r => r.materials.map(m => m.text))
  expect(new Set(texts).size / texts.length).toBeGreaterThanOrEqual(.95)
  for (const purpose of purposes) {
    const regions = dataset.regions.filter(r => r.purpose === purpose)
    expect(regions).toHaveLength(10)
    expect(new Set(regions.map(r => r.goal))).toEqual(new Set([devGoals[purpose]]))
    for (const r of regions) {
      const plan = planRegionCompaction(r.materials, { frame: r.frame })
      expect(plan.candidateBytes).toBeGreaterThan(8192)
      expect(regionBytes(r.materials)).toBeLessThanOrEqual(16384)
      expect(r.materials.length).toBeLessThanOrEqual(32)
      expect(plan.pins.size).toBe(2)
      expect(r.materials.every(m => Buffer.byteLength(m.content) <= 8192)).toBe(true)
      expect(r.materials.every(m => /^\[(user|assistant|tool call|tool result:read)\] /.test(m.text))).toBe(true)
      expect(plan.units.some(u => u.members.length === 2)).toBe(true)
    }
  }
})
test('runtime builder/apply and eval are exact single-source parity, including units and pins', async () => {
  const r = dataset.regions[0]!, pure = buildRegionCompactionTask({ module: { id: r.purpose, question: compactionQuestions[r.purpose] }, materials: r.materials, key: r.id, request: 1, dependency: { id: `window:${r.id}`, version: 'dev-v1' }, frame: r.frame, goal: r.goal })
  expect(regionTask(r)).toEqual(pure)
  let calls = 0
  const rows = await evaluateCompaction({ ...dataset, regions: [r] }, async tasks => {
    calls++; expect(tasks).toEqual([pure]); return deterministicCompactionStub(tasks, new AbortController().signal)
  })
  const decision = (await deterministicCompactionStub([pure], new AbortController().signal))[r.purpose]!
  expect(rows[0]!.keptIds).toEqual(applyRegionCompaction(r.materials, decision, { frame: r.frame }).materials.map(m => m.id))
  expect(calls).toBe(1)
  expect(rows[0]).toMatchObject({ pinnedCount: 2, skipped: false, failed: false, budgetCompliant: true })
})
test('LONG DEV offline stub calls 30 times, whole exchanges and pins retained, budget compliance reported', async () => {
  let calls = 0
  const rows = await evaluateCompaction(dataset, async (tasks, signal) => { calls++; return deterministicCompactionStub(tasks, signal) })
  expect(calls).toBe(30)
  for (const [i, row] of rows.entries()) {
    const plan = planRegionCompaction(dataset.regions[i]!.materials, { frame: dataset.regions[i]!.frame })
    expect(row.keptBytes).toBeLessThanOrEqual(8192)
    expect([...plan.pins].every(id => row.keptIds.includes(id))).toBe(true)
    for (const u of plan.units) expect(new Set(u.members.map(m => row.keptIds.includes(m.id))).size).toBe(1)
  }
  const score = scoreCompaction(dataset, labels, rows).overall
  expect(score.budgetCompliance).toMatchObject({ numerator: 30, denominator: 30 })
  expect(score.pinnedCount).toBe(60); expect(score.withinBudgetSkips).toBe(0)
})
test('missing probability and thrown classifier both fall back to full LONG DEV, not a partial selection', async () => {
  for (const judge of [async () => { throw Error('offline failure') }, async () => ({ references: { mode: 'skip' as const, reason: 'no probabilities', evidenceRefs: [] } })]) {
    const rows = await evaluateCompaction({ ...dataset, regions: dataset.regions.slice(0, 1) }, judge)
    expect(rows[0]!.failed).toBe(true); expect(rows[0]!.budgetCompliant).toBe(false)
    expect(rows[0]!.keptIds).toEqual(dataset.regions[0]!.materials.map(m => m.id))
  }
})
test('dropBelow offline sweep replays full policy; no provider required; labels never affect task', async () => {
  const probabilities = dataset.regions.flatMap(r => regionTask(r).view.context.references.map((ref, i) => ({ processorId: r.purpose, id: ref.id, probability: i % 3 ? .25 : .1 })))
  const sweep = await budgetSweep(dataset, labels, probabilities)
  expect(sweep.map(s => s.dropBelow)).toEqual([.1, .2, .3, .4, .5])
  expect(sweep.every(s => s.budgetCompliance.numerator === 30 && s.pinnedCount === 60)).toBe(true)
  const before = dataset.regions.map(r => regionTask(r))
  const flipped = structuredClone(labels)
  for (const row of Object.values(flipped.labels)) for (const id of Object.keys(row)) row[id] = !row[id]
  await budgetSweep(dataset, flipped, probabilities)
  expect(dataset.regions.map(r => regionTask(r))).toEqual(before)
})
test('dataset selection is closed; estimates count gated calls only for each corpus', () => {
  const model = { type: 'classifier', id: 'typesafe/jev-1.14', provider: 'openrouter', api: 'typesafe-system-one', baseUrl: 'https://openrouter.ai/api/v1', contextWindow: 262144, cost: { input: .042, output: 0, cacheRead: 0, cacheWrite: 0 } } as ClassifierModel
  const args = ['--resolve-only', '--model', MODEL]
  expect(parseRunArgs([...args, '--dataset', 'long-dev']).dataset).toBe('long-dev')
  expect(parseRunArgs(args).dataset).toBe('dev')
  expect(() => parseRunArgs([...args, '--dataset', 'holdout'])).toThrow()
  expect(() => parseRunArgs([...args, '--dataset', 'dev', '--dataset', 'long-dev'])).toThrow()
  expect(estimateDataset(dataset, model).calls).toBe(30)
  const e = estimateDataset(dataset, model)
  expect(e.upperUsd).toBeLessThan(1); expect(e.calls).toBeLessThanOrEqual(120)
})
