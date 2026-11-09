import { freezeMonitoringData } from '../sdk/diagnostics.ts'
import { parseMonitoringJsonData } from '../sdk/schema.ts'

// Host-neutral frame contract (ADR 0062): every host adapter turns its agent events into these frames, in order.
// The event vocabulary is the observed-hook vocabulary; other hosts map their events onto it.
export type ObservationStage = 'canonical_projection' | 'context_conversation_at_hook' | 'context_with_system_at_hook'
export type ObservationSnapshot = Readonly<{ sessionId: string; leafId: string | null; branch: readonly { id: string; parentId: string | null; type: string }[]; canonicalMessages: readonly unknown[]; effectiveSystemPrompt: string | null; observedMessages?: readonly unknown[]; /** Tail mode only: number of oldest messages left out of this snapshot. */ truncatedHead?: number; stage: ObservationStage; canonicalHash: string; revision: string; available: boolean; missing?: string; fullProviderContext: false; omitted: readonly string[] }>
export type ObservationFrame = Readonly<{ id: string; cursor: number; sourceEvent: string; kind: string; sessionId: string; binding: number; epoch: number; payload: unknown; snapshot: ObservationSnapshot; available: boolean }>
export type ObservationOutcome = Readonly<{ frameId?: string; status: 'handled' | 'stale' | 'cancelled' | 'timeout' | 'overflow' | 'unavailable' | 'error'; reason: string }>
const identifier = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const keys = (v: Record<string, unknown>, allowed: readonly string[]) => Object.keys(v).every(k => allowed.includes(k))
const nonnegative = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0

/** Bounded own-data admission shared by coordinator and pipeline. Throws without invoking accessors.
 * Message bodies remain host-normalized JSON; this does not require full provider context. */
export function parseObservationFrame(input: unknown): ObservationFrame {
  // Inspect descriptors recursively before reading fields; copy once so validation and use see the same data.
  const f = parseMonitoringJsonData(input)
  const bad = (): never => { throw new Error('malformed observation frame') }
  if (!record(f) || !keys(f, ['id', 'cursor', 'sourceEvent', 'kind', 'sessionId', 'binding', 'epoch', 'payload', 'snapshot', 'available'])) return bad()
  if (!identifier(f.id) || !identifier(f.kind) || !identifier(f.sessionId) || typeof f.sourceEvent !== 'string' || !(observationEvents as readonly string[]).includes(f.sourceEvent) || !nonnegative(f.cursor) || f.cursor < 1 || !nonnegative(f.binding) || f.binding < 1 || !nonnegative(f.epoch) || typeof f.available !== 'boolean' || !Object.hasOwn(f, 'payload')) return bad()
  const s = f.snapshot
  if (!record(s) || !keys(s, ['sessionId', 'leafId', 'branch', 'canonicalMessages', 'effectiveSystemPrompt', 'observedMessages', 'truncatedHead', 'stage', 'canonicalHash', 'revision', 'available', 'missing', 'fullProviderContext', 'omitted'])) return bad()
  if (s.sessionId !== f.sessionId || !(s.leafId === null || identifier(s.leafId)) || !Array.isArray(s.branch) || !Array.isArray(s.canonicalMessages) || !(s.effectiveSystemPrompt === null || typeof s.effectiveSystemPrompt === 'string') || !['canonical_projection', 'context_conversation_at_hook', 'context_with_system_at_hook'].includes(s.stage as string) || !identifier(s.canonicalHash) || !identifier(s.revision) || typeof s.available !== 'boolean' || s.fullProviderContext !== false || !Array.isArray(s.omitted) || !s.omitted.every(identifier)) return bad()
  if (s.branch.some(b => !record(b) || !keys(b, ['id', 'parentId', 'type']) || !identifier(b.id) || !(b.parentId === null || identifier(b.parentId)) || !identifier(b.type))) return bad()
  if ((Object.hasOwn(s, 'observedMessages') && !Array.isArray(s.observedMessages)) || (Object.hasOwn(s, 'truncatedHead') && !nonnegative(s.truncatedHead)) || (Object.hasOwn(s, 'missing') && !identifier(s.missing))) return bad()
  return freezeMonitoringData(f) as ObservationFrame
}

export const observationEvents = ['session_start', 'session_shutdown', 'session_before_switch', 'session_before_fork', 'session_before_tree', 'session_tree', 'session_before_compact', 'session_compact', 'session_compact_failed', 'input', 'message_start', 'message_update', 'message_end', 'tool_call', 'tool_result', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'context', 'context_with_system', 'turn_start', 'turn_end', 'agent_start', 'agent_end', 'agent_settled', 'model_select', 'thinking_level_select',
  // task154 (Pi 1.5.0 inventory): the remaining agent-behaviour hooks. Notification-only like the rest: undefined keeps
  // input/payload/headers/decisions unchanged. Deliberately NOT registered: `project_trust` (a handler must return a trust
  // decision and runs before any session context), `mcp_servers_change` (handling it makes this extension the MCP
  // connector) and `provider_stream_event` (awaited per raw stream chunk; `message_update` already covers streaming).
  'before_agent_start', 'agent_before_settle', 'user_bash', 'session_info_changed', 'ui_prompt_start', 'ui_prompt_end',
  'before_provider_headers', 'before_provider_request', 'after_provider_response', 'cache_warming_decision', 'resources_discover'] as const
