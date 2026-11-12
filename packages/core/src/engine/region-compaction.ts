import { createHash } from 'node:crypto'
import type { Decision, JudgeTask, JudgeQuestion } from './monitoring-core.ts'
import type { RealtimeMaterial } from './monitoring-core-realtime-material.ts'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const body = (m: RealtimeMaterial): any => { try { return JSON.parse(m.content) } catch { return {} } }
const isRegion = (m: RealtimeMaterial) => m.kind === 'conversation-history' && body(m).region === true
const head = (m: RealtimeMaterial) => /^\[(memo|state|omitted)/.test(m.text)
export const regionCompactionCandidates = (materials: readonly RealtimeMaterial[]) => materials.filter(m => isRegion(m) && !head(m))
export type RegionCompactionSettings = Readonly<{ budgetBytes?: number; dropBelow?: number; pinNewest?: number }>
// Half the default window maxBytes (monitoring-core-realtime-material.ts:11: 16384).
export const regionCompactionDefaults = Object.freeze({ budgetBytes: 8192, dropBelow: 0.2, pinNewest: 2 })
export function compactionSettings(setting: boolean | RegionCompactionSettings = true) {
  if (typeof setting !== 'boolean' && (!setting || typeof setting !== 'object' || Array.isArray(setting) || Object.keys(setting).some(k => !['budgetBytes', 'dropBelow', 'pinNewest'].includes(k)))) throw Error('invalid region compaction settings')
  const s = { ...regionCompactionDefaults, ...(typeof setting === 'object' ? setting : {}) }
  if (!Number.isSafeInteger(s.budgetBytes) || s.budgetBytes < 1 || !Number.isFinite(s.dropBelow) || s.dropBelow < 0 || s.dropBelow > 1 || !Number.isSafeInteger(s.pinNewest) || s.pinNewest < 0) throw Error('invalid region compaction settings')
  return s
}
export type CompactionFrame = { id: string; sourceEvent: string; cursor: number; payload?: unknown; snapshot?: { canonicalMessages: readonly unknown[]; truncatedHead?: number } }
export type CompactionPolicy = { frame?: CompactionFrame; settings?: boolean | RegionCompactionSettings }
export type CompactionUnit = { id: string; members: RealtimeMaterial[]; bytes: number; order: number }
export const regionBytes = (materials: readonly RealtimeMaterial[]) => materials.reduce((n, m) => n + Buffer.byteLength(m.content, 'utf8'), 0)
/** Oldest-first window order is the stable tie-break. A pin propagates to its whole tool exchange. */
export function planRegionCompaction(materials: readonly RealtimeMaterial[], policy: CompactionPolicy = {}) {
  const settings = compactionSettings(policy.settings), region = regionCompactionCandidates(materials)
  const pins = new Set(materials.filter(m => isRegion(m) && head(m)).map(m => m.id))
  const reverse = [...materials].reverse()
  const latestUser = reverse.find(m => m.kind === 'user-text' && m.provenance.observationId === policy.frame?.id) ?? reverse.find(m => m.kind === 'user-text' || m.text.startsWith('[user]'))
  if (latestUser) pins.add(latestUser.id)
  region.slice(Math.max(0, region.length - settings.pinNewest)).forEach(m => pins.add(m.id))
  const f = policy.frame, currentIds = new Set<string>()
  const current = (m: RealtimeMaterial) => { pins.add(m.id); currentIds.add(m.id) }
  // Projection provenance identifies capture, NOT historical ownership. Only non-region items use it.
  if (f) {
    materials.filter(m => !isRegion(m) && m.provenance.observationId === f.id).forEach(current)
    const toolCallId = (f.payload as { toolCallId?: unknown } | null)?.toolCallId
    if (typeof toolCallId === 'string') region.filter(m => body(m).toolCallId === hash(toolCallId)).forEach(current)
    // message_end/turn_end refer to the newest canonical message. Eval's bounded projection uses max regionIndex.
    if (['message_end', 'turn_end'].includes(f.sourceEvent)) {
      const index = f.snapshot ? (f.snapshot.truncatedHead ?? 0) + f.snapshot.canonicalMessages.length - 1 : Math.max(-1, ...region.map(m => body(m).regionIndex ?? -1))
      region.filter(m => body(m).regionIndex === index).forEach(current)
    }
  }
  const units: CompactionUnit[] = [], calls = new Map<string, CompactionUnit>()
  let pending: CompactionUnit | undefined
  for (const [order, m] of region.entries()) {
    const c = body(m), call = m.text.startsWith('[tool call]'), result = m.text.startsWith('[tool result:')
    const callId = typeof c.toolCallId === 'string' ? c.toolCallId : undefined
    let unit = result ? (callId ? calls.get(callId) : pending) : undefined
    if (!unit) { unit = { id: m.id, members: [], bytes: 0, order }; units.push(unit) }
    unit.members.push(m); unit.bytes += regionBytes([m])
    if (call) { pending = unit; if (callId) calls.set(callId, unit) }
    else if (!result) pending = undefined
  }
  for (const u of units) if (u.members.some(m => pins.has(m.id))) u.members.forEach(m => pins.add(m.id))
  const candidates = units.filter(u => !u.members.some(m => pins.has(m.id)))
  const candidateBytes = candidates.reduce((n, u) => n + u.bytes, 0)
  const task = [...new Set([latestUser?.text, ...materials.filter(m => currentIds.has(m.id) && !head(m)).map(m => m.text)].filter((t): t is string => !!t))].join('\n')
  return { settings, pins, units: candidates, candidateBytes, withinBudget: candidateBytes <= settings.budgetBytes, task }
}
export type RegionCompactionInput = Readonly<{
  module: { id: string; question: JudgeQuestion; compactRegion?: boolean | RegionCompactionSettings }; materials: readonly RealtimeMaterial[]
  key: string; request: number; dependency: { id: string; version: string }
  frame: CompactionFrame; goal: string
}>
/** Single task source for runtime and eval. Caller gates on plan.withinBudget, not item count. */
export function buildRegionCompactionTask(input: RegionCompactionInput): JudgeTask {
  const { module, materials, key, request, dependency, frame, goal } = input
  const plan = planRegionCompaction(materials, { frame, settings: module.compactRegion })
  const references = plan.units.map(u => ({ id: u.id, kind: 'conversation-history', version: hash(u.members.map(m => m.version)), content: u.members.length === 1 ? u.members[0]!.content : JSON.stringify({ text: u.members.map(m => m.text).join('\n'), members: u.members.map(({ id, content }) => ({ id, content })) }) }))
  const cscope = `compact:${hash([key, request])}`, cversion = hash([dependency, references, plan.settings, plan.task])
  return { processorId: module.id, question: { instructions: `Prepare this monitoring module's input. Its purpose: ${module.question.instructions}`, criteria: { run: 'Some listed unit matters for that purpose.', skip: 'No listed unit matters for that purpose.', defer: 'Cannot tell.' }, reference: { instructions: `Module purpose: ${module.question.instructions} Current task: see view.event.payload.task in state. Is unit {id} useful for judging that purpose on the current event? Answer true if it could matter for that purpose; false only if it is clearly unrelated. A tool exchange is one unit.`, criteria: { true: 'Could matter for this module purpose and current task.', false: 'Clearly unrelated to this module purpose and current task.' } } }, view: { event: { id: `${frame.id}:compact`, kind: frame.sourceEvent, scopeId: cscope, contextVersion: cversion, sequence: frame.cursor, payload: { sourceEvent: frame.sourceEvent, task: plan.task } }, eventRef: `event:${frame.id}:compact`, context: { scopeId: cscope, version: cversion, goal, references } } }
}
export type CompactionDecision = Decision & { referenceProbabilities?: Readonly<Record<string, number>> }
/** Two-argument evidence-ref application is retained for legacy callers. Policy application requires probabilities. */
export function applyRegionCompaction(materials: readonly RealtimeMaterial[], decision: readonly string[] | CompactionDecision, policy?: CompactionPolicy) {
  if (!policy) {
    const refs = Array.isArray(decision) ? decision : (decision as CompactionDecision).evidenceRefs
    const keep = new Set(refs)
    return { materials: materials.filter(m => !isRegion(m) || head(m) || keep.has(m.id)), compactTexts: regionCompactionCandidates(materials).filter(m => keep.has(m.id)).map(m => m.text) }
  }
  const plan = planRegionCompaction(materials, policy)
  if (plan.withinBudget) return { materials, compactTexts: [] }
  const probabilities = (decision as CompactionDecision).referenceProbabilities
  if (!probabilities || plan.units.some(u => !Number.isFinite(probabilities[u.id]) || probabilities[u.id]! < 0 || probabilities[u.id]! > 1)) throw Error('missing compaction probabilities')
  const keep = new Set(plan.units.filter(u => probabilities[u.id]! >= plan.settings.dropBelow).map(u => u.id))
  let keptBytes = plan.units.filter(u => keep.has(u.id)).reduce((n, u) => n + u.bytes, 0)
  for (const u of [...plan.units].sort((a, b) => probabilities[a.id]! - probabilities[b.id]! || a.order - b.order)) {
    if (keptBytes <= plan.settings.budgetBytes) break
    if (keep.delete(u.id)) keptBytes -= u.bytes
  }
  const keptIds = new Set([...plan.pins, ...plan.units.filter(u => keep.has(u.id)).flatMap(u => u.members.map(m => m.id))])
  return { materials: materials.filter(m => !isRegion(m) || keptIds.has(m.id)), compactTexts: regionCompactionCandidates(materials).filter(m => keptIds.has(m.id)).map(m => m.text) }
}
