/**
 * Named monitoring trigger points (task154, Pi 1.5.0): WHEN a module checks. Each point is one observed Pi hook plus a
 * deterministic condition over the observer frame payload; no model is involved in choosing a point. Module declarations
 * name these points in `watch.events` (raw Pi hook names stay accepted for compatibility); configuration data may only
 * select a subset of the declared ones. See `.lazy-harness/planning/monitoring-engine-concept-v2.md` § Stage 3b.
 */
import { observationEvents } from '../host/frames.ts'

export type MonitoringTriggerFrame = Readonly<{ sourceEvent: string; payload: unknown }>
type PointSpec = Readonly<{ sourceEvent: string; summary: string; when?: (payload: any) => boolean }>

const role = (p: any): unknown => p?.message?.role
const userSource = (p: any) => p.source === 'interactive' || p.source === 'rpc'
// Only plain own data is admitted. Never invoke getters while testing a named point.
function plainData(value: unknown, depth = 0): boolean {
  if (depth > 24) return false
  if (value === null || typeof value !== 'object') return ['string', 'number', 'boolean', 'undefined'].includes(typeof value) || value === null
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(d => 'value' in d && plainData(d.value, depth + 1))
}
const body = (v: any) => typeof v === 'string' || (Array.isArray(v) && v.every(b => b && typeof b.type === 'string' && (b.type !== 'text' || typeof b.text === 'string')))
const record = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v)
const id = (v: any) => typeof v === 'string' && v.length > 0
function validNamedPayload(hook: string, p: any): boolean {
  if (!record(p) || !plainData(p) || (p.type !== undefined && p.type !== hook)) return false
  switch (hook) {
    case 'input': return ['interactive', 'rpc', 'extension'].includes(p.source) && typeof p.text === 'string' && (p.streamingBehavior === undefined || ['steer', 'followUp'].includes(p.streamingBehavior))
    case 'user_bash': return typeof p.command === 'string' && userSource(p)
    case 'before_agent_start': return typeof p.prompt === 'string'
    case 'message_update': return p.message?.role === 'assistant' && body(p.message.content)
    case 'message_end': return ['user', 'assistant', 'custom'].includes(p.message?.role) && body(p.message.content)
    case 'tool_call': return id(p.toolCallId) && id(p.toolName) && record(p.input)
    case 'tool_result': return id(p.toolCallId) && id(p.toolName) && body(p.content)
    case 'tool_execution_end': return id(p.toolCallId) && id(p.toolName) && typeof p.isError === 'boolean'
    case 'turn_start': case 'turn_end': return Number.isSafeInteger(p.turnIndex) && p.turnIndex >= 0
    case 'agent_end': return Array.isArray(p.messages)
    case 'agent_settled': return typeof p.aborted === 'boolean'
    case 'session_start': return id(p.reason)
    case 'session_compact': return record(p.compactionEntry)
    case 'session_tree': return id(p.newLeafId)
    case 'model_select': return record(p.model) && id(p.model.id)
    case 'thinking_level_select': return id(p.thinkingLevel)
    default: return p.type === hook
  }
}

export const MONITORING_TRIGGER_POINTS = Object.freeze({
  'user.prompt': { sourceEvent: 'input', summary: 'new user request (typed or RPC)', when: (p: any) => !p?.streamingBehavior && userSource(p) },
  'user.steer': { sourceEvent: 'input', summary: 'user correction while the agent is running', when: (p: any) => p?.streamingBehavior === 'steer' && userSource(p) },
  'user.follow-up': { sourceEvent: 'input', summary: 'user request queued until the run finishes', when: (p: any) => p?.streamingBehavior === 'followUp' && userSource(p) },
  'extension.input': { sourceEvent: 'input', summary: 'user-role input sent by an extension (sendUserMessage)', when: (p: any) => p?.source === 'extension' },
  'user.shell': { sourceEvent: 'user_bash', summary: 'user ! / !! shell command' },
  'user.message': { sourceEvent: 'message_end', summary: 'finalized user message (after skill/template expansion)', when: (p: any) => role(p) === 'user' && userSource(p) },
  'run.start': { sourceEvent: 'before_agent_start', summary: 'a run is about to start' },
  'run.custom-start': { sourceEvent: 'before_agent_start', summary: 'a run started by an extension custom message', when: (p: any) => p?.messageType === 'custom' },
  'assistant.stream': { sourceEvent: 'message_update', summary: 'assistant streaming delta (speculative)' },
  'assistant.message': { sourceEvent: 'message_end', summary: 'finalized assistant message', when: (p: any) => role(p) === 'assistant' },
  'extension.message': { sourceEvent: 'message_end', summary: 'finalized extension custom message (never the user)', when: (p: any) => role(p) === 'custom' },
  'tool.before': { sourceEvent: 'tool_call', summary: 'tool call about to execute (final arguments)' },
  'tool.after': { sourceEvent: 'tool_result', summary: 'tool result before it is finalized' },
  'tool.end': { sourceEvent: 'tool_execution_end', summary: 'every finalized tool call, incl. blocked or invalid ones' },
  'tool.failed': { sourceEvent: 'tool_execution_end', summary: 'a finalized tool call that failed', when: (p: any) => p?.isError === true },
  'tool.nested': { sourceEvent: 'tool_execution_end', summary: 'a tool call made by another tool (not in the transcript)', when: (p: any) => typeof p?.parentToolCallId === 'string' && p.parentToolCallId.length > 0 },
  'turn.start': { sourceEvent: 'turn_start', summary: 'a model turn starts' },
  'turn.end': { sourceEvent: 'turn_end', summary: 'assistant message and all its tool results persisted (default between-region boundary)' },
  'run.end': { sourceEvent: 'agent_end', summary: 'one low-level run ended (more work may follow)' },
  'run.before-settle': { sourceEvent: 'agent_before_settle', summary: 'last actionable moment of the whole run' },
  'run.settled': { sourceEvent: 'agent_settled', summary: 'Pi will not continue automatically' },
  'run.aborted': { sourceEvent: 'agent_settled', summary: 'the run was aborted', when: (p: any) => p?.aborted === true },
  'session.start': { sourceEvent: 'session_start', summary: 'session started, resumed, forked or reloaded' },
  'session.compact': { sourceEvent: 'session_compact', summary: 'conversation compacted' },
  'session.tree': { sourceEvent: 'session_tree', summary: 'tree navigation changed the active branch' },
  'model.changed': { sourceEvent: 'model_select', summary: 'model changed' },
  'model.thinking-changed': { sourceEvent: 'thinking_level_select', summary: 'thinking level changed' },
  'ui.waiting-user': { sourceEvent: 'ui_prompt_start', summary: 'agent waits for a user dialog' },
  'ui.resumed': { sourceEvent: 'ui_prompt_end', summary: 'user dialog closed' },
} satisfies Record<string, PointSpec>)

/** Points where a module may DELIVER but never be triggered (the engine forbids watching the context hooks). */
export const MONITORING_DELIVERY_POINTS = Object.freeze({
  'model.before-call': { sourceEvent: 'context_with_system', summary: 'inject pending reports before each model call (carry mailbox)' },
} satisfies Record<string, PointSpec>)

export type MonitoringTriggerPoint = keyof typeof MONITORING_TRIGGER_POINTS
export type MonitoringResolvedWatch = Readonly<{ sourceEvents: readonly string[]; conditional: boolean; matches(frame: MonitoringTriggerFrame): boolean }>

export type MonitoringWatchSupport = 'watchable' | 'delivery-only' | 'control-only' | 'unknown'
const controlHooks = new Set(['session_start', 'session_shutdown', 'session_before_switch', 'session_before_fork', 'session_before_tree', 'session_tree', 'session_before_compact', 'session_compact', 'session_compact_failed', 'model_select', 'thinking_level_select'])
/** Resolver predicates are also useful for observation; not every catalog point is a runnable watch. */
export function monitoringWatchSupport(name: string): MonitoringWatchSupport {
  if (Object.hasOwn(MONITORING_DELIVERY_POINTS, name) || ['context', 'context_with_system'].includes(name)) return 'delivery-only'
  const spec = (MONITORING_TRIGGER_POINTS as Record<string, PointSpec>)[name]
  const hook = Object.hasOwn(MONITORING_TRIGGER_POINTS, name) ? spec!.sourceEvent : name
  if (name === 'run.aborted' || controlHooks.has(hook)) return 'control-only'
  return (observationEvents as readonly string[]).includes(hook) ? 'watchable' : 'unknown'
}
export function assertMonitoringWatchable(events: readonly string[]): void {
  for (const name of events) {
    const support = monitoringWatchSupport(name)
    if (support !== 'watchable') throw new Error(`${support} watch cannot be judged: ${name}`)
  }
}

/** Resolve declared watch names (trigger points or raw hook names) into hooks + a deterministic frame predicate. */
export function resolveMonitoringWatch(events: readonly string[]): MonitoringResolvedWatch {
  if (!Array.isArray(events) || !events.length) throw new Error('watch events required')
  const specs: PointSpec[] = events.map(name => {
    if (Object.hasOwn(MONITORING_DELIVERY_POINTS, name)) throw new Error(`delivery-only point cannot be watched: ${name}`)
    if (Object.hasOwn(MONITORING_TRIGGER_POINTS, name)) { const s = (MONITORING_TRIGGER_POINTS as Record<string, PointSpec>)[name]!; return { ...s, when: p => validNamedPayload(s.sourceEvent, p) && (!s.when || s.when(p)) } }
    if (name.includes('.')) throw new Error(`unknown trigger point: ${name}`)
    return { sourceEvent: name, summary: 'raw hook' }
  })
  const sourceEvents = Object.freeze([...new Set(specs.map(s => s.sourceEvent))])
  const conditional = specs.some(s => s.when !== undefined)
  return Object.freeze({ sourceEvents, conditional, matches(frame: MonitoringTriggerFrame): boolean {
    for (const s of specs) {
      if (s.sourceEvent !== frame.sourceEvent) continue
      try { if (!s.when || s.when(frame.payload)) return true } catch { /* A malformed payload never triggers. */ }
    }
    return false
  } })
}
