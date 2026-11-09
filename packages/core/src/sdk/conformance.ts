import type { ContextSnapshot, CoreEvent, EventReport, JudgeTask, ProposalRequest, Receipt, Reference, View } from './contracts.generated.ts'
export type MonitoringInvocationTrace = Readonly<{ processorId: string; view: View }>
export type MonitoringReadTrace = Readonly<{ processorId: string; eventId: string; scopeId: string; contextVersion: string; reference: Reference }>
export type MonitoringObservedEffect = Readonly<{ requestId: string; recordId: string; proposal: ProposalRequest }>
export type MonitoringExpectedDelivery = Pick<ProposalRequest, 'eventId' | 'processorId' | 'scopeId' | 'contextVersion' | 'kind' | 'payload'> & Readonly<{ evidenceRefs?: readonly string[] }>
export type MonitoringTraceExpectation = Readonly<{
  contexts: readonly ContextSnapshot[]; events: readonly CoreEvent[]
  permissions: Readonly<Record<string, { eventKinds: readonly string[]; referenceKinds: readonly string[]; actions: readonly string[] }>>
  deliveries: readonly MonitoringExpectedDelivery[]
  invocations?: readonly { eventId: string; processorId: string; scopeId: string; contextVersion: string }[]
  judgeTaskCount?: number; support: 'supported' | 'unsupported'
}>
export type MonitoringTrace = Readonly<{
  events: readonly CoreEvent[]; reports: readonly EventReport[]; attempts: readonly ProposalRequest[]; receipts: readonly Receipt[]
  effects: readonly MonitoringObservedEffect[]; invocations: readonly MonitoringInvocationTrace[]; judgeTasks: readonly JudgeTask[]; reads: readonly MonitoringReadTrace[]; physicalPending: number
}>
export type MonitoringTraceIssue = Readonly<{ code: string; path: string; category: 'core-contract' | 'module-output' | 'host-effect' | 'trace-oracle' }>
function stable(x: unknown, depth = 0): string {
  if (depth > 32) throw new Error('depth')
  if (Array.isArray(x)) return '[' + x.map(v => stable(v, depth + 1)).join(',') + ']'
  if (x && typeof x === 'object') {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(x))) throw new Error('not JSON')
    return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + stable((x as Record<string, unknown>)[k], depth + 1)).join(',') + '}'
  }
  if (x === undefined || typeof x === 'function' || typeof x === 'symbol' || typeof x === 'bigint' || typeof x === 'number' && !Number.isFinite(x)) throw new Error('not JSON')
  return JSON.stringify(x)
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b)
const key = (x: { eventId?: string; id?: string; scopeId: string; contextVersion?: string; version?: string; processorId?: string }) => JSON.stringify([x.scopeId, x.contextVersion ?? x.version, x.eventId ?? x.id, x.processorId])
const matches = (a: ProposalRequest, b: MonitoringExpectedDelivery) => a.eventId === b.eventId && a.processorId === b.processorId && a.scopeId === b.scopeId && a.contextVersion === b.contextVersion && a.kind === b.kind && same(a.payload, b.payload) && (!b.evidenceRefs || same([...a.evidenceRefs].sort(), [...b.evidenceRefs].sort()))
/** Pure oracle; physical effects are observed proposal-recording projections, not business-state claims. */
export function verifyMonitoringTrace(expected: MonitoringTraceExpectation, trace: MonitoringTrace) {
  const issues: MonitoringTraceIssue[] = []
  const issue = (code: string, path: string, category: MonitoringTraceIssue['category'] = 'core-contract') => issues.push({ code, path, category })
  let accepted: ProposalRequest[] = [], unacceptedAcknowledgements = 0
  try {
    const arrays = [expected.contexts, expected.events, expected.deliveries, trace.events, trace.reports, trace.attempts, trace.receipts, trace.effects, trace.invocations, trace.judgeTasks, trace.reads]
    if (arrays.some(x => !Array.isArray(x) || x.length > 4096) || !Number.isSafeInteger(trace.physicalPending) || trace.physicalPending < 0 || !['supported', 'unsupported'].includes(expected.support)) throw new Error('shape')
    if (!same(expected.events, trace.events)) issue('SOURCE_SEQUENCE', '/events')
    if (expected.judgeTaskCount !== undefined && trace.judgeTasks.length !== expected.judgeTaskCount) issue('JUDGE_TASK_COUNT', '/judgeTasks')
    if (expected.invocations && !same(expected.invocations.map(key).sort(), trace.invocations.map(x => key({ ...x.view.event, eventId: x.view.event.id, processorId: x.processorId })).sort())) issue('INVOCATION_SET', '/invocations')
    const contextFor = (x: { scopeId: string; contextVersion?: string; version?: string }) => expected.contexts.find(c => c.scopeId === x.scopeId && c.version === (x.contextVersion ?? x.version))
    const sourceFor = (x: { scopeId: string; contextVersion: string; eventId: string }) => trace.events.find(e => e.id === x.eventId && e.scopeId === x.scopeId && e.contextVersion === x.contextVersion)
    for (const [i, call] of [...trace.invocations, ...trace.judgeTasks].entries()) {
      const view = call.view, rule = expected.permissions[call.processorId], event = sourceFor({ ...view.event, eventId: view.event.id }), ctx = contextFor(view.context)
      if (!event || !same(event, view.event) || view.eventRef !== `event:${view.event.id}` || !ctx || ctx.goal !== view.context.goal) issue('VIEW_SOURCE', `/views/${i}`)
      if (!rule || !rule.eventKinds.includes(view.event.kind)) issue('EVENT_SCOPE', `/views/${i}`)
      if (ctx && rule && !same(view.context.references, ctx.references.filter(r => rule.referenceKinds.includes(r.kind)))) issue('REFERENCE_SCOPE', `/views/${i}`)
    }
    for (const [i, read] of trace.reads.entries()) {
      const ref = contextFor(read)?.references.find(r => r.id === read.reference.id), rule = expected.permissions[read.processorId]
      if (!ref || !same(ref, read.reference) || !rule?.referenceKinds.includes(ref.kind)) issue('READ_MISMATCH', `/reads/${i}`)
    }
    const recorded = trace.reports.flatMap(r => r.outcomes.flatMap(o => o.receipts.filter(a => a.status === 'recorded').map(a => ({ ...a, processorId: o.processorId, eventId: r.eventId }))))
    for (const [i, ack] of recorded.entries()) {
      if (!trace.attempts.some(a => a.requestId === ack.requestId && a.processorId === ack.processorId && a.eventId === ack.eventId) || !trace.receipts.some(r => r.status === 'recorded' && r.requestId === ack.requestId && r.recordId === ack.recordId)) issue('PHANTOM_RECEIPT', `/reports/receipts/${i}`)
    }
    const used = new Set<string>()
    for (const [i, request] of trace.attempts.entries()) {
      if (used.has(request.requestId)) issue('DUPLICATE_REQUEST', `/attempts/${i}`)
      used.add(request.requestId)
      const coreAck = recorded.find(r => r.requestId === request.requestId), ack = trace.receipts.find(r => r.requestId === request.requestId && r.status === 'recorded')
      if (!coreAck || !ack || coreAck.recordId !== ack.recordId) { if (ack) unacceptedAcknowledgements++; continue }
      accepted.push(request)
      if (!sourceFor(request) || !contextFor(request) || typeof request.requestId !== 'string' || !request.requestId || typeof coreAck.recordId !== 'string' || !coreAck.recordId || coreAck.recordId.length > 200) issue('DELIVERY_SOURCE', `/attempts/${i}`)
      if (!expected.permissions[request.processorId]?.actions.includes(request.kind)) issue('ACTION_SCOPE', `/attempts/${i}`)
      if (!request.evidenceRefs.length || request.evidenceRefs.some(id => id !== `event:${request.eventId}` && !trace.reads.some(r => r.processorId === request.processorId && r.eventId === request.eventId && r.scopeId === request.scopeId && r.contextVersion === request.contextVersion && r.reference.id === id))) issue('READ_EVIDENCE', `/attempts/${i}`)
      if (!trace.effects.some(e => e.requestId === request.requestId && e.recordId === coreAck.recordId && same(e.proposal, request))) issue('UNOBSERVED_EFFECT', `/attempts/${i}`, 'host-effect')
    }
    const remaining = [...accepted]
    for (const [i, wanted] of expected.deliveries.entries()) {
      const index = remaining.findIndex(a => matches(a, wanted))
      if (index < 0) issue('EXPECTED_DELIVERY_MISSING', `/deliveries/${i}`, 'module-output'); else remaining.splice(index, 1)
    }
    if (remaining.length) issue('UNEXPECTED_DELIVERY', '/deliveries', 'module-output')
    const effects = [...trace.effects]
    for (const [i, wanted] of expected.deliveries.entries()) {
      const index = effects.findIndex(e => e.requestId === e.proposal.requestId && matches(e.proposal, wanted))
      if (index < 0) issue('EXPECTED_EFFECT_MISSING', `/effects/${i}`, 'host-effect'); else effects.splice(index, 1)
    }
    if (effects.length) issue('UNEXPECTED_EFFECT', '/effects', 'host-effect')
  } catch { issue('TRACE_SHAPE', '/', 'trace-oracle') }
  const contractPassed = issues.length === 0, complete = trace.physicalPending === 0, supported = expected.support === 'supported'
  return { passed: contractPassed && complete && supported, contractPassed, complete, supported, issues, accepted: accepted.length, unacceptedAcknowledgements,
    interpretation: 'Observed proposal recording/oracle agreement only; no production accuracy, business acceptance, source-authenticity or hard-cancellation guarantee.' }
}
