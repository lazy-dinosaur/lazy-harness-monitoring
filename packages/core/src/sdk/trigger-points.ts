/**
 * Named monitoring trigger points (task154, Pi 1.5.0): WHEN a module checks. Each point is one observed Pi hook plus a
 * deterministic condition over the observer frame payload; no model is involved in choosing a point. Module declarations
 * name these points in `watch.events` (raw Pi hook names stay accepted for compatibility); configuration data may only
 * select a subset of the declared ones. See `.lazy-harness/planning/monitoring-engine-concept-v2.md` § Stage 3b.
 */
export type MonitoringTriggerFrame = Readonly<{ sourceEvent: string; payload: unknown }>
type PointSpec = Readonly<{ sourceEvent: string; summary: string; when?: (payload: any) => boolean }>

const role = (p: any): unknown => p?.message?.role

export const MONITORING_TRIGGER_POINTS = Object.freeze({
  'user.prompt': { sourceEvent: 'input', summary: 'new user request (typed or RPC)', when: (p: any) => !p?.streamingBehavior && p?.source !== 'extension' },
  'user.steer': { sourceEvent: 'input', summary: 'user correction while the agent is running', when: (p: any) => p?.streamingBehavior === 'steer' },
  'user.follow-up': { sourceEvent: 'input', summary: 'user request queued until the run finishes', when: (p: any) => p?.streamingBehavior === 'followUp' },
  'user.extension-input': { sourceEvent: 'input', summary: 'user-role input sent by an extension (sendUserMessage)', when: (p: any) => p?.source === 'extension' },
  'user.shell': { sourceEvent: 'user_bash', summary: 'user ! / !! shell command' },
  'user.message': { sourceEvent: 'message_end', summary: 'finalized user message (after skill/template expansion)', when: (p: any) => role(p) === 'user' },
  'run.start': { sourceEvent: 'before_agent_start', summary: 'a run is about to start' },
  'run.custom-start': { sourceEvent: 'before_agent_start', summary: 'a run started by an extension custom message', when: (p: any) => p?.messageType === 'custom' },
  'assistant.stream': { sourceEvent: 'message_update', summary: 'assistant streaming delta (speculative)' },
  'assistant.message': { sourceEvent: 'message_end', summary: 'finalized assistant message', when: (p: any) => role(p) === 'assistant' },
  'extension.message': { sourceEvent: 'message_end', summary: 'finalized extension custom message (never the user)', when: (p: any) => role(p) === 'custom' },
  'tool.before': { sourceEvent: 'tool_call', summary: 'tool call about to execute (final arguments)' },
  'tool.after': { sourceEvent: 'tool_result', summary: 'tool result before it is finalized' },
  'tool.end': { sourceEvent: 'tool_execution_end', summary: 'every finalized tool call, incl. blocked or invalid ones' },
  'tool.failed': { sourceEvent: 'tool_execution_end', summary: 'a finalized tool call that failed', when: (p: any) => p?.isError === true },
  'tool.nested': { sourceEvent: 'tool_execution_end', summary: 'a tool call made by another tool (not in the transcript)', when: (p: any) => typeof p?.parentToolCallId === 'string' },
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
  'model.before-call': { sourceEvent: 'context', summary: 'inject pending reports before each model call (carry mailbox)' },
} satisfies Record<string, PointSpec>)

export type MonitoringTriggerPoint = keyof typeof MONITORING_TRIGGER_POINTS
export type MonitoringResolvedWatch = Readonly<{ sourceEvents: readonly string[]; conditional: boolean; matches(frame: MonitoringTriggerFrame): boolean }>

/** Resolve declared watch names (trigger points or raw hook names) into hooks + a deterministic frame predicate. */
export function resolveMonitoringWatch(events: readonly string[]): MonitoringResolvedWatch {
  if (!Array.isArray(events) || !events.length) throw new Error('watch events required')
  const specs: PointSpec[] = events.map(name => {
    if (Object.hasOwn(MONITORING_DELIVERY_POINTS, name)) throw new Error(`delivery-only point cannot be watched: ${name}`)
    if (Object.hasOwn(MONITORING_TRIGGER_POINTS, name)) return (MONITORING_TRIGGER_POINTS as Record<string, PointSpec>)[name]!
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
