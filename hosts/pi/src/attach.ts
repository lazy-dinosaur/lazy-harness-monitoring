// Pi host adapter (ADR 0062): the Pi-specific side. The observer extension records every Pi hook as a frame; this hands
// each new frame to the core target in order and fails the target closed when the frame sequence is lost.
import { observationEvents, validateHostCapabilities, type HostCapabilities, type MonitoringFrameTarget } from '@lazy-harness/monitoring-core/host'
import type { ObservationContext, PiMonitoringObserver } from './observer.ts'

// SDK 1.5.0 real-fixture proven set, not the observer's larger diagnostic vocabulary.
// Add steer/block-tool-call only when an executor exists.
export const piHostCapabilities: HostCapabilities = validateHostCapabilities({ hostId: 'pi', version: '1.5', events: [
  'session_start', 'session_shutdown', 'session_before_switch', 'session_before_fork', 'session_before_tree', 'session_tree',
  'session_before_compact', 'session_compact', 'session_compact_failed', 'input', 'message_start', 'message_update', 'message_end',
  'tool_call', 'tool_result', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'context', 'context_with_system',
  'turn_start', 'turn_end', 'agent_start', 'agent_end', 'agent_settled', 'model_select', 'thinking_level_select',
  'before_agent_start', 'agent_before_settle', 'session_info_changed', 'ui_prompt_start', 'ui_prompt_end',
  'before_provider_headers', 'after_provider_response', 'cache_warming_decision', 'resources_discover',
], actions: ['inject-context'], snapshot: 'tail' })

type PiOn = { on(name: string, handler: (event: any, ctx: ObservationContext) => undefined): unknown }
/** Install AFTER the observer extension. Notification-only: returns undefined from every hook. */
export function attachPiFrames(pi: PiOn, observer: Pick<PiMonitoringObserver, 'frames'>, target: MonitoringFrameTarget): () => void {
  const off: Array<() => void> = []; let last = 0
  for (const name of observationEvents) {
    const unsubscribe = pi.on(name, (event, ctx) => {
      try {
        const frame = observer.frames.at(-1)
        if (!frame || frame.cursor <= last || frame.sourceEvent !== name || frame.sessionId !== ctx.sessionManager.getSessionId()) { target.halt?.('missing_source_frame'); return undefined }
        last = frame.cursor
        target.accept(frame, name === 'tool_execution_update' ? () => event.partialResult : undefined)
      } catch { target.halt?.('missing_source_frame') }
      return undefined
    })
    if (typeof unsubscribe === 'function') off.push(unsubscribe as () => void)
  }
  return () => { for (const u of off.splice(0)) { try { u() } catch { /* every handle attempted */ } } }
}
