import type { InputPortScope, InputPortGenerationProvider } from '@lazy-harness/monitoring-core/host'

export interface PiInputPortContext {
  sessionManager: { getSessionId(): string; getLeafId(): string | null }
}
/** Pi lifecycle ONLY: no inference of reads from tool results, messages or reports. */
export function createPiInputPortGenerations() {
  let scope: InputPortScope | undefined, binding = 0, branch = 0, compaction = 0, valid = false
  let serial = 0, activeOwner = 0, closed = false
  const current: InputPortGenerationProvider = () => valid && scope ? Object.freeze({ ...scope }) : undefined
  const extension = (pi: { on(event: any, handler: any): unknown }): void => {
    const owner = ++serial
    pi.on('session_start', (_event: unknown, ctx: PiInputPortContext) => {
      if (closed) return
      activeOwner = owner; binding++; branch++; compaction++; valid = true
      scope = Object.freeze({ sessionId: ctx.sessionManager.getSessionId(), bindingGeneration: binding, branchId: ctx.sessionManager.getLeafId() ?? 'root', branchGeneration: branch, compactionGeneration: compaction })
    })
    for (const name of ['session_before_switch', 'session_before_fork', 'session_before_tree', 'session_tree', 'session_before_compact', 'session_compact', 'session_compact_failed', 'session_shutdown']) {
      pi.on(name, (_event: unknown, ctx: PiInputPortContext) => {
        if (closed || owner !== activeOwner || scope?.sessionId !== ctx.sessionManager.getSessionId()) return
        if (name === 'session_shutdown') { valid = false; scope = undefined; binding++; return }
        if (name === 'session_before_compact' || name === 'session_compact' || name === 'session_compact_failed') compaction++
        else branch++
        valid = name === 'session_tree' || name === 'session_compact'
        scope = Object.freeze({ ...scope, branchId: ctx.sessionManager.getLeafId() ?? 'root', branchGeneration: branch, compactionGeneration: compaction })
        // Failure/before hooks stay fenced. A success, new branch or session must establish fresh context.
      })
    }
  }
  return Object.freeze({ current, extension, close() { closed = true; valid = false; scope = undefined; binding++ } })
}
