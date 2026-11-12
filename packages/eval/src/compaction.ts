import type { JudgeBatchPort } from '@lazy-harness/monitoring-core'
import { buildRegionCompactionTask, applyRegionCompaction, regionCompactionCandidates } from '@lazy-harness/monitoring-core/engine/region-compaction.ts'
import { referencesQuestion } from '@lazy-harness/monitoring-module-references'
import { ruleSteeringQuestion } from '@lazy-harness/monitoring-module-rule-steering'
import { memoryQuestion } from '@lazy-harness/monitoring-module-memory'
import { parseRegionDataset, purposes, type Purpose, type Region, type RegionDataset, type RegionLabels } from './compaction-dataset.ts'
export const compactionQuestions = { references: referencesQuestion, 'rule-steering': ruleSteeringQuestion, memory: memoryQuestion }
export function regionTask(r: Region) {
  return buildRegionCompactionTask({ module: { id: r.purpose, question: compactionQuestions[r.purpose] }, materials: r.materials, key: r.id, request: 1, dependency: { id: `window:${r.id}`, version: 'dev-v1' }, frame: r.frame, goal: r.goal })
}
export type CompactionResult = { regionId: string; purpose: Purpose; keptIds: string[]; failed: boolean; skipped: boolean; latencyMs: number; costUsd: number }
/** Same JudgeBatchPort as core/router.judgeBatch. Labels are not accepted here. */
export async function evaluateCompaction(dataset: RegionDataset, judgeBatch: JudgeBatchPort, signal = new AbortController().signal, cost = () => 0): Promise<CompactionResult[]> {
  parseRegionDataset(dataset)
  const rows: CompactionResult[] = []
  for (const r of dataset.regions) {
    signal.throwIfAborted()
    const start = performance.now(), before = cost(), skipped = regionCompactionCandidates(r.materials).length <= 1
    let kept = r.materials, failed = false
    if (!skipped) try {
      const out = await judgeBatch([regionTask(r)], signal)
      kept = applyRegionCompaction(r.materials, out[r.purpose]?.evidenceRefs ?? []).materials
    } catch { failed = true } // Runtime failure fallback: full region, not an empty selection.
    rows.push({ regionId: r.id, purpose: r.purpose, keptIds: kept.map(m => m.id), failed, skipped, latencyMs: performance.now() - start, costUsd: cost() - before })
  }
  return rows
}
export function wilson(numerator: number, denominator: number) {
  if (!denominator) return { numerator, denominator, rate: null, ci95: null }
  const z = 1.959963984540054, p = numerator / denominator, z2 = z * z, d = 1 + z2 / denominator
  const center = (p + z2 / (2 * denominator)) / d, half = z * Math.sqrt(p * (1 - p) / denominator + z2 / (4 * denominator ** 2)) / d
  return { numerator, denominator, rate: p, ci95: [Math.max(0, center - half), Math.min(1, center + half)] }
}
const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1]! : null
/** Micro-averages; UTF-8 bytes of content (actual reference body). Wilson intervals assume item independence, not cluster independence. */
export function scoreCompaction(dataset: RegionDataset, labels: RegionLabels, results: CompactionResult[]) {
  if (results.length !== dataset.regions.length || new Set(results.map(r => r.regionId)).size !== results.length) throw Error('one result per region required')
  const group = (purpose?: Purpose) => {
    const regions = dataset.regions.filter(r => !purpose || r.purpose === purpose)
    let needed = 0, retained = 0, noise = 0, removedNoise = 0, items = 0, removedItems = 0, bytes = 0, removedBytes = 0, dropped = 0
    const rows = regions.map(r => {
      const row = results.find(v => v.regionId === r.id)
      if (!row || row.purpose !== r.purpose || row.keptIds.some(id => !r.materials.some(m => m.id === id)) || new Set(row.keptIds).size !== row.keptIds.length) throw Error('invalid result identity')
      if (!row.keptIds.length) dropped++
      for (const m of r.materials) {
        const keep = row.keptIds.includes(m.id), size = Buffer.byteLength(m.content, 'utf8')
        items++; bytes += size
        if (!keep) { removedItems++; removedBytes += size }
        if (labels.labels[r.id]![m.id]) { needed++; if (keep) retained++ } else { noise++; if (!keep) removedNoise++ }
      }
      return row
    })
    const recall = wilson(retained, needed), called = rows.filter(r => !r.skipped)
    return { regions: regions.length, neededItemRetention: recall, noiseRemoval: wilson(removedNoise, noise), itemReduction: wilson(removedItems, items), byteReduction: { numerator: removedBytes, denominator: bytes, rate: bytes ? removedBytes / bytes : null, ci95: null, note: 'Byte weights are not independent Bernoulli trials; no Wilson interval.' }, allDropped: wilson(dropped, rows.length), failureFallback: wilson(rows.filter(r => r.failed).length, called.length), skipped: rows.filter(r => r.skipped).length, latencyMs: { denominator: called.length, p50: percentile(called.map(r => r.latencyMs), .5), p95: percentile(called.map(r => r.latencyMs), .95) }, costUsd: rows.reduce((s, r) => s + r.costUsd, 0), provisionalRetentionPass: recall.rate === null ? null : recall.rate >= .95 }
  }
  return { schemaVersion: 1, measurement: 'compaction-only', provisionalPassLine: 'needed-item retention >=95%; user confirmation required; point estimate, not CI lower bound', overall: group(), byPurpose: Object.fromEntries(purposes.map(p => [p, group(p)])), results }
}
/** Mechanical smoke test only: alternating references, independent of meaning and gold labels. */
export const deterministicCompactionStub: JudgeBatchPort = async tasks => Object.fromEntries(tasks.map(t => [t.processorId, { mode: 'run', reason: 'offline deterministic stub', evidenceRefs: t.view.context.references.filter((_, i) => i % 2 === 0).map(r => r.id) }]))
