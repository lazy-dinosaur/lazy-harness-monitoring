import { freezeMonitoringData } from '../sdk/diagnostics.ts'
import { modelJson } from '../sdk/model-schema.ts'
import { observationEvents, type ObservationFrame } from '../host/frames.ts'
import { RealtimeMaterialWindow, type RealtimeMaterial } from './monitoring-core-realtime-material.ts'
import { buildInputProjection, type InputProjectionBatch, type ProjectionBinding, type ProjectionHost, type SourceMeta } from './monitoring-core-input-projection.ts'
import type { JudgeQuestion, JudgeTask, Reference } from './monitoring-core.ts'
import type { RealtimeDependency, RealtimeLease } from './monitoring-core-realtime.ts'

export type SourceProjectionCode = 'INVALID_INPUT' | 'SOURCE_UNAVAILABLE' | 'FRAME_MISMATCH' | 'MODULE_MISMATCH' | 'REFERENCE_MISMATCH' | 'UNKNOWN_ORIGIN' | 'REVISION_COLLISION' | 'LIMIT'
export class MaterialSourceProjectionError extends Error {
  constructor(readonly code: SourceProjectionCode) { super(code); this.name = 'MaterialSourceProjectionError' }
}
export type SourceProjectionModule = Readonly<{
  id: string
  question: JudgeQuestion
  requiredEvidenceRoles: readonly string[]
  roleReferenceIds?: Readonly<Record<string, readonly string[]>>
  approvalCandidateIds?: readonly string[]
}>
export type SourceProjectionOptions = Readonly<{
  window: RealtimeMaterialWindow
  frame: Pick<ObservationFrame, 'id' | 'cursor' | 'sourceEvent' | 'sessionId' | 'binding' | 'available'>
  referenceKinds: readonly string[]
  modules: readonly SourceProjectionModule[]
  evidenceRevision: RealtimeDependency
  contractRevision: RealtimeDependency
}>
export type WindowProjectionSource = Readonly<{
  frameId: string
  host: ProjectionHost
  dependencies: readonly RealtimeDependency[]
  binding(lease: RealtimeLease): ProjectionBinding
  project(tasks: readonly JudgeTask[], lease: RealtimeLease): InputProjectionBatch
}>
type ModuleSnapshot = { id: string; question: JudgeQuestion; requiredEvidenceRoles: string[]; roleReferenceIds: Record<string, string[]>; approvalCandidateIds: string[] }
function fail(code: SourceProjectionCode): never { throw new MaterialSourceProjectionError(code) }
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![null, Object.prototype].includes(Object.getPrototypeOf(v))) return fail('INVALID_INPUT')
  return v as Record<string, unknown>
}
function own(v: unknown, key: string, optional = false): unknown {
  const d = Object.getOwnPropertyDescriptor(record(v), key)
  if (!d) { if (optional) return undefined; return fail('INVALID_INPUT') }
  if (d.get || d.set) return fail('INVALID_INPUT')
  return d.value
}
function text(v: unknown, max = 256): string { if (typeof v !== 'string' || !v || v.length > max) return fail('INVALID_INPUT'); return v }
function integer(v: unknown): number { if (!Number.isSafeInteger(v) || (v as number) < 1) return fail('INVALID_INPUT'); return v as number }
function array(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) return fail('LIMIT')
  const out: unknown[] = []
  for (let i = 0; i < v.length; i++) { const d = Object.getOwnPropertyDescriptor(v, String(i)); if (!d || d.get || d.set) return fail('INVALID_INPUT'); out.push(d.value) }
  return out
}
function ids(v: unknown, max: number): string[] { return [...new Set(array(v, max).map(x => text(x)))].sort() }
function key(v: string): string { if (['__proto__', 'prototype', 'constructor'].includes(v)) return fail('INVALID_INPUT'); return v }
function data<T>(v: T): T { return freezeMonitoringData(JSON.parse(JSON.stringify(modelJson(v))) as T) }
function dependency(v: unknown): RealtimeDependency { return data({ id: text(own(v, 'id')), version: text(own(v, 'version')) }) }
function moduleSnapshot(raw: unknown): ModuleSnapshot {
  const id = text(own(raw, 'id'), 80)
  if (!/^[a-z][a-z0-9._-]{1,79}$/.test(id)) return fail('INVALID_INPUT')
  const q = own(raw, 'question'), criteria = own(q, 'criteria')
  const question = { instructions: text(own(q, 'instructions'), 200), criteria: { run: text(own(criteria, 'run'), 200), skip: text(own(criteria, 'skip'), 200), defer: text(own(criteria, 'defer'), 200) } }
  const requiredEvidenceRoles = ids(own(raw, 'requiredEvidenceRoles'), 16)
  if (!requiredEvidenceRoles.includes('current')) return fail('INVALID_INPUT')
  const bindings = own(raw, 'roleReferenceIds', true) ?? {}, roleReferenceIds: Record<string, string[]> = Object.create(null)
  for (const role of requiredEvidenceRoles) {
    key(role); if (role.length > 80) return fail('INVALID_INPUT')
    if (role !== 'current' && role !== 'approval') roleReferenceIds[role] = ids(own(bindings, role, true) ?? [], 64)
  }
  return data({ id, question, requiredEvidenceRoles, roleReferenceIds, approvalCandidateIds: ids(own(raw, 'approvalCandidateIds', true) ?? [], 64) })
}
function metadata(material: RealtimeMaterial, head: SourceProjectionOptions['frame'], currentIds: readonly string[]): SourceMeta {
  const p = material.provenance
  if (!p || p.sessionId !== head.sessionId || p.binding !== head.binding) return fail('FRAME_MISMATCH')
  if (p.owner === 'host') {
    if (p.observationId !== null || p.sourceEvent !== 'host.reference' || p.stage !== 'host-provided' || material.provisional) return fail('UNKNOWN_ORIGIN')
    // Existing prototype label for a host-supplied reference container, NOT approved-record attestation.
    return data({ sourceKind: 'host-record', actor: 'host-record', stage: 'host-provided', logicalRevision: material.version, observationIds: [], roles: [] })
  }
  if (p.owner !== 'observation' || typeof p.observationId !== 'string' || !p.observationId) return fail('UNKNOWN_ORIGIN')
  let actor: SourceMeta['actor']
  switch (material.kind) {
    case 'user-text': if (!['input', 'message_end'].includes(p.sourceEvent)) return fail('UNKNOWN_ORIGIN'); actor = 'user'; break
    case 'assistant-text': if (p.sourceEvent !== 'message_end') return fail('UNKNOWN_ORIGIN'); actor = 'assistant'; break
    case 'assistant-progress': if (p.sourceEvent !== 'message_update') return fail('UNKNOWN_ORIGIN'); actor = 'assistant'; break
    case 'tool-result': if (!['tool_result', 'message_end'].includes(p.sourceEvent)) return fail('UNKNOWN_ORIGIN'); actor = 'tool'; break
    case 'tool-progress': if (p.sourceEvent !== 'tool_execution_update') return fail('UNKNOWN_ORIGIN'); actor = 'tool'; break
    default: return fail('UNKNOWN_ORIGIN')
  }
  const stage = material.provisional ? 'partial' : p.sourceEvent === 'message_end' ? 'final-hook' : 'event-hook'
  if (p.stage !== stage || material.provisional !== ['assistant-progress', 'tool-progress'].includes(material.kind)) return fail('UNKNOWN_ORIGIN')
  // The retained frame->currentIds association is evidence too, including a known hook/final alias.
  const observationIds = [...new Set([p.observationId, ...(currentIds.includes(material.id) ? [head.id] : [])])].sort()
  return data({ sourceKind: 'observation', actor, stage, logicalRevision: material.version, observationIds, roles: [] })
}

/** FREE source-local conversion only. Window owns admission/identity/body versions; Core owns
 * grants/reads; the existing projection owns request encoding/required-evidence checks; A owns
 * currentness and raw work. The caller MUST install ALL returned dependencies before dispatch
 * and resolve body/scope versions via Window plus the two genuine host revision owners.
 * No metadata watcher, authority store, record lookup, model/SDK call or new lifecycle is created.
 * Constructed Frames test admitted-data conversion, not native SDK authenticity.
 */
export function captureWindowProjection(options: SourceProjectionOptions): WindowProjectionSource {
  const window = own(options, 'window')
  if (!(window instanceof RealtimeMaterialWindow)) return fail('INVALID_INPUT')
  const input = own(options, 'frame')
  const head = data({ id: text(own(input, 'id'), 200), cursor: integer(own(input, 'cursor')), sourceEvent: text(own(input, 'sourceEvent'), 200), sessionId: text(own(input, 'sessionId'), 200), binding: integer(own(input, 'binding')), available: own(input, 'available') === true })
  if (!head.available || !(observationEvents as readonly string[]).includes(head.sourceEvent)) return fail('FRAME_MISMATCH')
  const kinds = ids(own(options, 'referenceKinds'), 32), modules = array(own(options, 'modules'), 8).map(moduleSnapshot)
  if (!kinds.length || !modules.length || new Set(modules.map(m => m.id)).size !== modules.length) return fail('INVALID_INPUT')
  if (Buffer.byteLength(JSON.stringify(modules), 'utf8') > 65536) return fail('LIMIT')
  const status = window.getStatus()
  if (status.state !== 'running' || !status.available) return fail('SOURCE_UNAVAILABLE')
  if (!status.scope || status.scope.sessionId !== head.sessionId || status.scope.binding !== head.binding) return fail('FRAME_MISMATCH')
  const snapshot = window.snapshot(head.id, kinds)
  if (!snapshot.available || !Object.isFrozen(snapshot) || !Object.isFrozen(snapshot.materials)) return fail('SOURCE_UNAVAILABLE')
  if (snapshot.materials.length > 32) return fail('LIMIT')
  // Retain the already-owned frozen snapshot; never recopy/rehash a whole diagnostic Frame.
  const byId = new Map(snapshot.materials.map(r => [r.id, r]))
  if (byId.size !== snapshot.materials.length) return fail('INVALID_INPUT')
  const evidenceRevision = dependency(own(options, 'evidenceRevision')), contractRevision = dependency(own(options, 'contractRevision'))
  const dependencies = data([dependency(snapshot.dependency), ...snapshot.materials.map(r => dependency(r)), evidenceRevision, contractRevision])
  if (new Set(dependencies.map(d => d.id)).size !== dependencies.length) return fail('REVISION_COLLISION')
  const catalogue = new Map(modules.map(m => [m.id, m]))
  function moduleFor(task: JudgeTask): ModuleSnapshot {
    const module = catalogue.get(task.processorId), event = task.view.event
    if (!module || event.id !== head.id || event.kind !== head.sourceEvent || event.sequence !== head.cursor || task.view.eventRef !== `event:${head.id}`) return fail('MODULE_MISMATCH')
    if (task.question.instructions !== module.question.instructions || (['run', 'skip', 'defer'] as const).some(k => task.question.criteria[k] !== module.question.criteria[k])) return fail('MODULE_MISMATCH')
    return module
  }
  function referenceFor(task: JudgeTask, id: string): RealtimeMaterial {
    moduleFor(task)
    const visible = task.view.context.references.find(r => r.id === id)
    if (!visible) return fail('REFERENCE_MISMATCH')
    const source = byId.get(id)
    if (!source || source.kind !== visible.kind || source.version !== visible.version || source.content !== visible.content) return fail('REFERENCE_MISMATCH')
    return source
  }
  const host: ProjectionHost = Object.freeze({
    evidenceRevision, contractRevision,
    contract(task) { const module = moduleFor(task); return data({ revision: contractRevision.version, requiredEvidenceRoles: module.requiredEvidenceRoles }) },
    current(task) { moduleFor(task); return data({ observationId: head.id, sourceEvent: head.sourceEvent, referenceIds: snapshot.currentIds.filter(id => task.view.context.references.some(r => r.id === id)) }) },
    source(task, id) { return metadata(referenceFor(task, id), head, snapshot.currentIds) },
    roleReferences(task, role) { const module = moduleFor(task); return data((module.roleReferenceIds[role] ?? []).filter(id => task.view.context.references.some(r => r.id === id))) },
    approval(task) {
      const module = moduleFor(task), candidates = module.approvalCandidateIds.filter(id => task.view.context.references.some(r => r.id === id)), items: Record<string, unknown> = Object.create(null), referenceIds: string[] = []
      for (const id of candidates) {
        const source = referenceFor(task, id), meta = metadata(source, head, snapshot.currentIds)
        if (meta.sourceKind !== 'observation' || meta.actor !== 'user') continue
        referenceIds.push(id)
        // Body availability/role is not semantic approval, attribution or native-source attestation.
        items[key(id)] = { kind: 'original-user-approval', referenceVersion: source.version, originVerified: false, association: 'unresolved' }
      }
      return data({ status: referenceIds.length ? 'unresolved' : 'missing', referenceIds, items })
    },
  })
  const binding = (lease: RealtimeLease): ProjectionBinding => Object.freeze({ capturedDependencies: dependencies, lease })
  return Object.freeze({ frameId: head.id, host, dependencies, binding, project: (tasks: readonly JudgeTask[], lease: RealtimeLease): InputProjectionBatch => buildInputProjection(tasks, host, binding(lease)) })
}
