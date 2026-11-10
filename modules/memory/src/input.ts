import { freezeMonitoringData, parseMonitoringJsonData } from '@lazy-harness/monitoring-core'
import { InputPortContextSchema, validatePortData, type InputPortContext } from '@lazy-harness/monitoring-core/host'

export const MEMORY_KINDS = ['user-text', 'assistant-text', 'conversation-history', 'project-policy', 'prior-candidate'] as const
export type MemoryEvidence = Readonly<{
  id: string; version: string; kind: typeof MEMORY_KINDS[number]; text: string; namespace: string
  sourceEventId: string; eventType: string; cursor: number; actor: 'user' | 'assistant' | 'authority'
  attestationId: string; sourceRecordRevision: string; attribution: 'original-user' | 'approved-record' | 'unresolved'
  permitted: boolean; complete: boolean; start: number; end: number
}>
export type MemoryInput = Readonly<{
  schemaVersion: 'memory-input/v1'; context: InputPortContext; frameId: string; frameCursor: number; snapshotRevision: string
  project: Readonly<{ id: string; applicability: string }>; subjectKey: string; conflict: boolean
  claim: Readonly<{ documentId: string; kind: 'project-fact' | 'decision' | 'constraint' | 'preference'; language: string }>
  evidence: readonly MemoryEvidence[]
}>
const fail = (): never => { throw Error('Malformed memory input') }
function exact(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))) fail()
}
const text = (v: unknown, max = 512): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
/** Host-owned sidecar. A role, kind, or tool success cannot create attribution. Strict plain data only. */
export function parseMemoryInput(input: unknown): MemoryInput {
  const v = parseMonitoringJsonData(input)
  exact(v, ['schemaVersion', 'context', 'frameId', 'frameCursor', 'snapshotRevision', 'project', 'subjectKey', 'conflict', 'claim', 'evidence'])
  if (v.schemaVersion !== 'memory-input/v1' || !text(v.frameId) || !count(v.frameCursor) || !text(v.snapshotRevision) || !text(v.subjectKey) || typeof v.conflict !== 'boolean') fail()
  validatePortData<InputPortContext>(InputPortContextSchema, v.context, 4096)
  exact(v.project, ['id', 'applicability']); if (!text(v.project.id) || !text(v.project.applicability)) fail()
  exact(v.claim, ['documentId', 'kind', 'language'])
  if (!text(v.claim.documentId) || !['project-fact', 'decision', 'constraint', 'preference'].includes(v.claim.kind as string) || !text(v.claim.language)) fail()
  if (!Array.isArray(v.evidence) || v.evidence.length < 1 || v.evidence.length > 8) fail()
  for (const e of v.evidence as unknown[]) {
    exact(e, ['id', 'version', 'kind', 'text', 'namespace', 'sourceEventId', 'eventType', 'cursor', 'actor', 'attestationId', 'sourceRecordRevision', 'attribution', 'permitted', 'complete', 'start', 'end'])
    if (['id', 'version', 'namespace', 'sourceEventId', 'eventType', 'attestationId', 'sourceRecordRevision'].some(k => !text(e[k])) || !MEMORY_KINDS.includes(e.kind as typeof MEMORY_KINDS[number]) || !text(e.text, 8192) || !count(e.cursor) || !count(e.start) || !count(e.end) || e.end <= e.start || e.end > e.text.length || !['user', 'assistant', 'authority'].includes(e.actor as string) || !['original-user', 'approved-record', 'unresolved'].includes(e.attribution as string) || typeof e.permitted !== 'boolean' || typeof e.complete !== 'boolean') fail()
  }
  const evidence = v.evidence as MemoryEvidence[]
  if (new Set(evidence.map(e => e.id)).size !== evidence.length || !evidence.some(e => e.id === (v.claim as MemoryInput['claim']).documentId)) fail()
  return freezeMonitoringData(v) as MemoryInput
}
