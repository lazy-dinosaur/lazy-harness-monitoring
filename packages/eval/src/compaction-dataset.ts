import type { RealtimeMaterial } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-material.ts'
export const purposes = ['references', 'rule-steering', 'memory'] as const
export type Purpose = typeof purposes[number]
export type Region = { id: string; purpose: Purpose; goal: string; frame: { id: string; sourceEvent: string; cursor: number }; materials: RealtimeMaterial[] }
export type RegionDataset = { schemaVersion: 1; split: 'dev' | 'holdout'; regions: Region[] }
export type RegionLabels = { schemaVersion: 1; split: 'dev' | 'holdout'; labels: Record<string, Record<string, boolean>> }
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x)
const exact = (x: Record<string, any>, keys: string[]) => Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k))
const text = (x: unknown): x is string => typeof x === 'string' && x.length > 0
/** Closed data schema: rejects extra fields (including labels) at every model-visible layer. */
export function parseRegionDataset(value: unknown, expectedSplit: 'dev' | 'holdout' = 'dev'): RegionDataset {
  if (!object(value) || !exact(value, ['schemaVersion', 'split', 'regions']) || value.schemaVersion !== 1 || value.split !== expectedSplit || !Array.isArray(value.regions)) throw Error('invalid compaction dataset')
  const ids = new Set<string>()
  for (const r of value.regions) {
    if (!object(r) || !exact(r, ['id', 'purpose', 'goal', 'frame', 'materials']) || !text(r.id) || ids.has(r.id) || !purposes.includes(r.purpose) || !text(r.goal) || !object(r.frame) || !exact(r.frame, ['id', 'sourceEvent', 'cursor']) || !text(r.frame.id) || !text(r.frame.sourceEvent) || !Number.isSafeInteger(r.frame.cursor) || r.frame.cursor < 1 || !Array.isArray(r.materials) || r.materials.length < 5 || r.materials.length > 32) throw Error('invalid region')
    ids.add(r.id); const items = new Set<string>()
    for (const m of r.materials) {
      if (!object(m) || !exact(m, ['id', 'kind', 'version', 'content', 'text', 'provisional', 'provenance']) || !text(m.id) || items.has(m.id) || m.kind !== 'conversation-history' || !text(m.version) || !text(m.content) || !text(m.text) || m.provisional !== false || !object(m.provenance)) throw Error('invalid region material')
      items.add(m.id)
      const c = JSON.parse(m.content), p = m.provenance
      if (!object(c) || !exact(c, ['text', 'provisional', 'region', 'regionIndex', ...(Object.hasOwn(c, 'toolCallId') ? ['toolCallId'] : [])]) || (Object.hasOwn(c, 'toolCallId') && !text(c.toolCallId)) || c.text !== m.text || c.region !== true || c.provisional !== false || !Number.isSafeInteger(c.regionIndex) || c.regionIndex < 0 || !exact(p, ['owner', 'observationId', 'sessionId', 'binding', 'sourceEvent', 'cursor', 'step', 'stage']) || p.owner !== 'observation' || !text(p.observationId) || !text(p.sessionId) || p.binding !== 1 || !text(p.sourceEvent) || !Number.isSafeInteger(p.cursor) || p.cursor < 1 || !Number.isSafeInteger(p.step) || p.step < 0 || p.stage !== 'event-hook') throw Error('invalid region content/provenance')
    }
  }
  return value as RegionDataset
}
export function parseRegionLabels(value: unknown, dataset: RegionDataset, expectedSplit: 'dev' | 'holdout' = 'dev'): RegionLabels {
  if (!object(value) || !exact(value, ['schemaVersion', 'split', 'labels']) || value.schemaVersion !== 1 || value.split !== expectedSplit || !object(value.labels) || !exact(value.labels, dataset.regions.map(r => r.id))) throw Error('invalid labels')
  for (const r of dataset.regions) {
    const labels = value.labels[r.id]
    if (!object(labels) || !exact(labels, r.materials.map(m => m.id)) || Object.values(labels).some(v => typeof v !== 'boolean')) throw Error('invalid item labels')
  }
  return value as RegionLabels
}
