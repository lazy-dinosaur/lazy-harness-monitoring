import { planRegionCompaction, regionBytes } from '../../core/src/engine/region-compaction.ts'
import { purposes, type RegionDataset, type RegionLabels } from '../src/compaction-dataset.ts'

export const itemKind = (text: string) => text.startsWith('[user]') ? 'user' : text.startsWith('[assistant]') ? 'assistant' : 'tool exchange'
// Ignore role tags, case, whitespace and numbers: changing a suffix/counter is
// not diversity. Do not strip paths: different project records have real meaning.
export const normalize = (text: string) => text.replace(/^\[[^\]]+\]\s*/, '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
export const firstSentence = (text: string) => normalize(text).split(/[.!?](?:\s|$)/)[0]!
export function nearDuplicate(a: string, b: string) {
  const x = normalize(a), y = normalize(b)
  return firstSentence(a) === firstSentence(b) || (x.length >= 60 && y.length >= 60 && x.slice(0, 60) === y.slice(0, 60))
}
export function longDevMetrics(dataset: RegionDataset, labels: RegionLabels) {
  const items = dataset.regions.flatMap(r => r.materials)
  const normalized = items.map(m => normalize(m.text))
  const sentences = items.map(m => firstSentence(m.text))
  const similar = (i: number, j: number) => sentences[i] === sentences[j] || (normalized[i]!.length >= 60 && normalized[j]!.length >= 60 && normalized[i]!.slice(0, 60) === normalized[j]!.slice(0, 60))
  const affected = new Set<number>()
  let globalPairs = 0, localPairs = 0
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (similar(i, j)) {
    globalPairs++; affected.add(i); affected.add(j)
  }
  const patterns = new Set<string>()
  for (const r of dataset.regions) {
    patterns.add(r.materials.flatMap((m, i) => labels.labels[r.id]![m.id] ? [i + 1] : []).join(','))
    for (let i = 0; i < r.materials.length; i++) for (let j = i + 1; j < r.materials.length; j++) if (nearDuplicate(r.materials[i]!.text, r.materials[j]!.text)) localPairs++
  }
  const perPurpose = Object.fromEntries(purposes.map(purpose => {
    const regions = dataset.regions.filter(r => r.purpose === purpose)
    let needed = 0, noise = 0, pinned = 0, pinnedOnly = 0
    const neededKinds = new Set<string>(), noiseKinds = new Set<string>(), indexPatterns = new Set<string>(), counts = new Set<number>()
    const bytes: number[] = [], candidateBytes: number[] = [], sources: number[] = []
    const bands = new Set<string>()
    for (const r of regions) {
      const plan = planRegionCompaction(r.materials, { frame: r.frame })
      bytes.push(regionBytes(r.materials)); candidateBytes.push(plan.candidateBytes); sources.push(r.materials.length)
      pinned += plan.pins.size
      const gold = r.materials.filter(m => labels.labels[r.id]![m.id])
      counts.add(gold.length)
      if (gold.every(m => plan.pins.has(m.id))) pinnedOnly++
      indexPatterns.add(r.materials.flatMap((m, i) => labels.labels[r.id]![m.id] ? [i + 1] : []).join(','))
      for (const [i, m] of r.materials.entries()) {
        if (labels.labels[r.id]![m.id]) {
          needed++; neededKinds.add(itemKind(m.text))
          if (!plan.pins.has(m.id)) bands.add(['start', 'middle', 'end'][Math.min(2, Math.floor(i * 3 / (r.materials.length - 2)))]!)
        } else { noise++; noiseKinds.add(itemKind(m.text)) }
      }
    }
    const range = (a: number[]) => [Math.min(...a), Math.max(...a)]
    return [purpose, { regions: regions.length, needed, noise, pinned, pinnedOnly, neededKinds: [...neededKinds].sort(), noiseKinds: [...noiseKinds].sort(), distinctPatterns: indexPatterns.size, neededCounts: [...counts].sort(), bands: [...bands].sort(), bytes: range(bytes), candidateBytes: range(candidateBytes), sources: range(sources) }]
  }))
  return { items: items.length, uniqueTexts: new Set(items.map(m => m.text)).size, localPairs, globalPairs, nearDuplicateItems: affected.size, globalNearDuplicateRatio: affected.size / items.length, distinctPatterns: patterns.size, perPurpose }
}
export function validateLongDevDiversity(dataset: RegionDataset, labels: RegionLabels) {
  const m = longDevMetrics(dataset, labels)
  if (m.localPairs !== 0) throw Error('near-duplicate items within region')
  if (m.globalNearDuplicateRatio > .05) throw Error('global near-duplicate item ratio exceeds 5%')
  if (m.distinctPatterns < 20) throw Error('needed position patterns below 20')
  for (const p of Object.values(m.perPurpose)) {
    if (p.neededKinds.length < 3) throw Error('needed kinds must include user, assistant, tool exchange')
    if (p.noiseKinds.length < 3) throw Error('noise kinds must include user, assistant, tool exchange')
    if (p.neededCounts.length < 3 || !p.pinnedOnly) throw Error('vary needed counts and include pinned-only cases')
    if (p.bands.length < 3) throw Error('needed positions must span start/middle/end')
  }
  return m
}
