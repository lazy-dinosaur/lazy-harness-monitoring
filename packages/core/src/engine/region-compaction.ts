import { createHash } from 'node:crypto'
import type { JudgeTask, JudgeQuestion } from './monitoring-core.ts'
import type { RealtimeMaterial } from './monitoring-core-realtime-material.ts'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const isRegion = (m: RealtimeMaterial) => { if (m.kind !== 'conversation-history') return false; try { return JSON.parse(m.content)?.region === true } catch { return false } }
const head = (m: RealtimeMaterial) => /^\[(memo|state|omitted)/.test(m.text)
export const regionCompactionCandidates = (materials: readonly RealtimeMaterial[]) => materials.filter(m => isRegion(m) && !head(m))
export type RegionCompactionInput = Readonly<{
  module: { id: string; question: JudgeQuestion }; materials: readonly RealtimeMaterial[]
  key: string; request: number; dependency: { id: string; version: string }
  frame: { id: string; sourceEvent: string; cursor: number }; goal: string
}>
/** Exactly the runtime compaction task; no labels, scoring or provider policy. Caller skips <=1 candidates. */
export function buildRegionCompactionTask(input: RegionCompactionInput): JudgeTask {
  const { module, materials, key, request, dependency, frame, goal } = input
  const region = regionCompactionCandidates(materials)
  const cscope = `compact:${hash([key, request])}`, cversion = hash([dependency, region.map(r => [r.id, r.version])])
  return { processorId: module.id, question: { instructions: `Prepare this monitoring module's input. Its purpose: ${module.question.instructions}`, criteria: { run: 'Some listed item matters for that purpose.', skip: 'No listed item matters for that purpose.', defer: 'Cannot tell.' }, reference: { instructions: `Module purpose: ${module.question.instructions} Is item {id} useful for judging that purpose on the current event? Answer true if it could matter for that purpose; false only if it is clearly unrelated.`, criteria: { true: 'Could matter for this module purpose.', false: 'Clearly unrelated to this module purpose.' } } }, view: { event: { id: `${frame.id}:compact`, kind: frame.sourceEvent, scopeId: cscope, contextVersion: cversion, sequence: frame.cursor, payload: { sourceEvent: frame.sourceEvent } }, eventRef: `event:${frame.id}:compact`, context: { scopeId: cscope, version: cversion, goal, references: region.map(({ id, kind, version, content }) => ({ id, kind, version, content })) } } }
}
/** Preserve verbatim originals/order, non-region material and mandatory head lines. Unknown ids are ignored. */
export function applyRegionCompaction(materials: readonly RealtimeMaterial[], evidenceRefs: readonly string[]) {
  const region = regionCompactionCandidates(materials)
  const keep = new Set(evidenceRefs.filter(id => region.some(r => r.id === id)))
  return { materials: materials.filter(m => !isRegion(m) || head(m) || keep.has(m.id)), compactTexts: region.filter(r => keep.has(r.id)).map(r => r.text) }
}
