// Parent report delivery (S6). Wires runtime reports (jobs whose report mode is always/on-result) into the main
// agent's model input through the existing ContextCarryMailbox policy: same turn if another request follows,
// otherwise once at the next turn's first request with an origin/age label; scope or source changes drop it.
// Turn boundaries come from `input` events; a tree/branch change starts a new branch scope. No text classification.
import { canonicalJsonHash } from '@lazy-harness/monitoring-core'
import { ContextCarryMailbox, type CarryDependency, type CarryDelivery } from '@lazy-harness/monitoring-core/engine/monitoring-core-context-mailbox.ts'
import type { Report } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'

export type ParentReportDeliveryOptions = Readonly<{ mailbox: ContextCarryMailbox; now?: () => number }>
export function createParentReportDelivery(options: ParentReportDeliveryOptions) {
  const now = options.now ?? (() => Date.now())
  let sessionId: string | undefined, turn = 0, branch = 0, firstRequest = true
  const installed = new WeakSet<object>()
  const delivered: CarryDelivery[] = []
  const scope = (t = turn) => ({ sessionId: sessionId!, branchId: `branch:${branch}`, turn: t })
  return Object.freeze({
    /** Current turn number; capture it when a trigger is created so a late report keeps its origin turn. */
    currentTurn: () => turn,
    onReport(report: Report, meta: Readonly<{ originTurn?: number; dependencies?: readonly CarryDependency[] }> = {}): boolean {
      if (!sessionId || report.sessionId !== sessionId) return false
      const origin = meta.originTurn ?? turn
      const dependencies = [...(meta.dependencies ?? [])].sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version))
      // Receipt identity is content + event + session/branch + source revisions, not callback order/arrival turn.
      const id = canonicalJsonHash([report, scope().sessionId, scope().branchId, dependencies])
      return options.mailbox.put({ id, moduleId: report.moduleId, scope: scope(origin), createdAt: now(), dependencies: meta.dependencies ?? [], text: `[monitor ${report.moduleId}/${report.jobId}] ${report.text}` }, now())
    },
    extension(pi: { on(name: string, handler: (event: any, ctx: any) => unknown): unknown }) {
      if (installed.has(pi)) return
      installed.add(pi)
      pi.on('session_start', (_e, ctx) => { sessionId = ctx.sessionManager.getSessionId(); branch++; turn = 0; firstRequest = true })
      pi.on('input', (_e, ctx) => { sessionId ??= ctx.sessionManager.getSessionId(); turn++; firstRequest = true; return undefined })
      for (const name of ['session_tree', 'session_compact']) pi.on(name, () => { branch++ })
      pi.on('context_with_system', (e, ctx) => {
        if (!sessionId || ctx.sessionManager.getSessionId() !== sessionId) return undefined
        const out = options.mailbox.take(scope(), now(), firstRequest)
        firstRequest = false
        if (!out.length) return undefined
        delivered.push(...out)
        return { messages: [...e.messages, ...out.map(d => ({ role: 'user', content: [{ type: 'text', text: d.text }], timestamp: Date.now() }))] }
      })
    },
    get delivered(): readonly CarryDelivery[] { return Object.freeze([...delivered]) },
  })
}
