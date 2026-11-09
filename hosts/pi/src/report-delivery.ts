// Parent report delivery: enqueue acceptance is NOT model-input delivery.
// Delivery receipts below describe the context_with_system hook output, not an independently observed provider call.
import { canonicalJsonHash } from '@lazy-harness/monitoring-core'
import { ContextCarryMailbox, type CarryDependency, type CarryDelivery, type CarryScope } from '@lazy-harness/monitoring-core/engine/monitoring-core-context-mailbox.ts'
import { monitoringReportId, type Report, type ReportEnqueueReceipt, type ReportDeliveryReceipt } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'

/** Capture before dispatching asynchronous work; branchId is an adapter-owned navigation generation. */
export type ParentReportOrigin = CarryScope
export type ParentReportEnqueueMeta = Readonly<{ origin?: ParentReportOrigin; originTurn?: number; dependencies?: readonly CarryDependency[] }>
export type ParentReportDeliveryOptions = Readonly<{ mailbox: ContextCarryMailbox; now?: () => number; maxDelivered?: number }>
export function createParentReportDelivery(options: ParentReportDeliveryOptions) {
  const maxDelivered = options.maxDelivered ?? 256
  if (!Number.isSafeInteger(maxDelivered) || maxDelivered < 1) throw new Error('invalid delivered retention')
  let deliveredEvicted = 0
  const now = options.now ?? (() => Date.now())
  let sessionId: string | undefined, turn = 0, branch = 0, firstRequest = true
  const installed = new WeakSet<object>(), delivered: CarryDelivery[] = []
  const scope = (t = turn) => ({ sessionId: sessionId!, branchId: `branch:${branch}`, turn: t })
  const origins = new WeakSet<ParentReportOrigin>()
  const captureOrigin = (): ParentReportOrigin => {
    if (!sessionId) throw new Error('no active session')
    const origin = Object.freeze(scope())
    origins.add(origin)
    return origin
  }
  const enqueue = (report: Report, meta: ParentReportEnqueueMeta = {}): ReportEnqueueReceipt => {
    const reportId = monitoringReportId(report)
    if (!sessionId || report.sessionId !== sessionId) return { reportId, status: 'failed', reason: 'scope_mismatch' }
    const captured = meta.origin
    if (captured && (!origins.has(captured) || captured.sessionId !== sessionId || captured.branchId !== scope().branchId || captured.turn > turn)) return { reportId, status: 'failed', reason: 'scope_mismatch' }
    const origin = captured?.turn ?? meta.originTurn ?? turn
    const dependencies = [...(meta.dependencies ?? [])].sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version))
    const id = canonicalJsonHash([reportId, scope().sessionId, scope().branchId, dependencies])
    const accepted = options.mailbox.put({ id, reportId, moduleId: report.moduleId, scope: scope(origin), createdAt: now(), dependencies,
      text: `[monitor ${report.moduleId}/${report.jobId}] ${report.text}` }, now())
    return Object.freeze({ reportId, status: accepted ? 'enqueued' : 'failed', ...(accepted ? {} : { reason: 'mailbox_refused' }) })
  }
  return Object.freeze({
    currentTurn: () => turn,
    captureOrigin,
    /** Immediate enqueue. Async callers must pass an origin captured before worker dispatch. */
    enqueue,
    /** Compatibility boolean helper. Runtime report sinks must use enqueue's explicit receipt. */
    onReport(report: Report, meta: ParentReportEnqueueMeta = {}): boolean { return enqueue(report, meta).status === 'enqueued' },
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
        // Build the receiver result before recording hook delivery; failures must not report success.
        const result = { messages: [...e.messages, ...out.map(d => ({ role: 'user', content: [{ type: 'text', text: d.text }], timestamp: now() }))] }
        delivered.push(...out)
        if (delivered.length > maxDelivered) { const excess = delivered.length - maxDelivered; delivered.splice(0, excess); deliveredEvicted += excess }
        return result
      })
    },
    getStatus() { return Object.freeze({ deliveredRetained: delivered.length, deliveredEvicted }) },
    get delivered(): readonly CarryDelivery[] { return Object.freeze([...delivered]) },
    get deliveryReceipts(): readonly ReportDeliveryReceipt[] { return Object.freeze(delivered.filter(d => d.item.reportId).map(d => Object.freeze({ reportId: d.item.reportId!, status: 'delivered' as const, boundary: 'context_with_system' as const }))) },
  })
}
