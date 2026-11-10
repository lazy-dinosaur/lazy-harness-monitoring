import { createHandlerWorkerPort, type Decision, type MonitoringModelBackend, type MonitoringModelRequest, type View } from '@lazy-harness/monitoring-core'
import { parseObservationFrame } from '@lazy-harness/monitoring-core/host'
import { createRealtimeSelectionPipeline, type RealtimeSelectionPacket } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-selection.ts'
import { ApprovedBudgetGate, MonitoringModuleRuntime, watchModuleFromDeclaration, type BudgetLease, type JobHandler, type RuntimeOptions, type Trigger } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createRuleSteeringHandlers, createRuleSteeringRegistration, policyReferences, ruleSteeringBinding, ruleSteeringDeclaration, type PolicyRegistry, type RuleVerifier } from '@lazy-harness/monitoring-module-rule-steering'

// Invented authoritative toy registry, never derived from external policy data.
export const registry: PolicyRegistry = { id: 'toy-workshop', version: '3', policies: [
  { id: 'blue-lantern', version: '2', title: 'Use blue glass for lanterns.', scope: 'Lantern assembly only.', exceptions: ['Red glass is allowed when the current request explicitly says festival.'] },
  { id: 'two-ribbons', version: '1', title: 'Attach two ribbons to a kite.', summary: 'The ribbon count must be visible.' },
] }
export const refs = policyReferences(registry)
export const decision = (mode: Decision['mode'] = 'run'): Decision => ({ mode, reason: 'scripted only', evidenceRefs: [] })
export const confirmed: RuleVerifier = async () => decision()
export function view(selected = refs, current = 'assemble lantern with red glass', eventId = 'event-1'): View {
  return { eventRef: `event:${eventId}`, event: { id: eventId, kind: 'tool_call', scopeId: 'toy-scope', contextVersion: '1', sequence: 1, payload: { sourceEvent: 'tool_call', currentReferenceIds: ['cur'] } }, context: { scopeId: 'toy-scope', version: '1', goal: 'Toy workshop only', references: [
    { id: 'old', kind: 'assistant-text', version: '1', content: 'earlier unrelated action' }, { id: 'cur', kind: 'tool-arguments', version: '1', content: current }, ...selected,
  ] } }
}
export function trigger(selected = refs, turn: number | undefined = 1, sessionId = 'toy-session'): Trigger {
  const v = view(selected)
  return { moduleId: 'rules.steer', eventId: v.event.id, sessionId, turn, view: v, evidence: v.context.references.filter(r => r.id !== 'old').map(r => ({ id: r.id, kind: r.kind, version: r.version, text: r.content })) }
}
export function lease(cap = 8): BudgetLease & { used(): number } {
  let used = 0
  return { consume(_k, n) { if (used + n > cap) throw Error('toy budget'); used += n }, remaining: () => cap - used, used: () => used }
}
export const jobs = createRuleSteeringRegistration().jobs
export function runtime(options: { verify?: RuleVerifier; report?: RuntimeOptions['report']; stage?: 'observe' | 'shadow' | 'active'; approved?: number; handlers?: Readonly<Record<string, JobHandler>> } = {}) {
  const handlers = options.handlers ?? createRuleSteeringHandlers(options.verify ?? confirmed), budget = new ApprovedBudgetGate()
  if (options.approved) budget.approve({ moduleId: 'rules.steer', caps: { judgeCalls: options.approved }, approvedBy: 'invented-test' })
  // Trusted mechanical probes explicitly opt into worker execution; production registration remains observe-only.
  const rt = new MonitoringModuleRuntime({ modules: [{ ...createRuleSteeringRegistration(), ...(options.stage ? { stage: options.stage } : {}) }], handlers, workerPort: createHandlerWorkerPort(handlers), budget, report: options.report })
  return { rt, budget }
}
export function frame(n: number, sourceEvent = 'tool_call', payload?: unknown) {
  return parseObservationFrame({ id: `toy-${n}`, cursor: n, sourceEvent, kind: sourceEvent, sessionId: 'toy-session', binding: 1, epoch: 1,
    payload: payload ?? (sourceEvent === 'tool_call' ? { toolCallId: `call-${n}`, toolName: 'bash', input: { command: 'assemble lantern red' } } : { reason: 'toy' }), available: true,
    snapshot: { sessionId: 'toy-session', leafId: null, branch: [], canonicalMessages: [], effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: `toy-hash-${n}`, revision: `toy-revision-${n}`, available: true, fullProviderContext: false, omitted: [] } })
}
export const packets = (offer: { candidate: { payload: unknown } }) => (offer.candidate.payload as { packets: RealtimeSelectionPacket[] }).packets
export const triggerFor = (p: RealtimeSelectionPacket): Trigger => ({ moduleId: p.moduleId, eventId: p.eventId, sessionId: 'toy-session', turn: 1, view: p.view, evidence: p.materials.map(r => ({ id: r.id, kind: r.kind, version: r.version, text: r.text })) })
export function pipeline() {
  const requests: MonitoringModelRequest[] = []
  const backend: MonitoringModelBackend = { version: '1', provider: 'scripted', model: 'toy-classifier', kind: 'native-classifier', roles: ['judge'], parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
    ceilings: { maxCalls: 20, maxConcurrent: 1, maxQueued: 1, timeoutMs: 2000, maxInputBytes: 131072, maxOutputBytes: 65536, maxOutputTokens: 128, maxReservedTokens: 10000, maxReservedUsd: 1 }, estimate: () => ({ maxInputTokens: 1, maxEstimatedUsd: 0 }),
    invoke(request) {
      requests.push(request)
      const tasks = (request.body as unknown as { state: { tasks: { view: View }[] } }).state.tasks, answers: Record<string, unknown> = {}
      tasks.forEach((t, i) => { answers[`decision_${i}`] = { type: 'choice', choice: 'run', confidence: 1 }; t.view.context.references.forEach((r, j) => { answers[`ref_${i}_${j}`] = { type: 'bool', probability: r.kind === 'policy' ? 1 : 0 } }) })
      return { value: { stopReason: 'stop', answers } }
    },
  }
  const watch = watchModuleFromDeclaration('rules.steer', ruleSteeringDeclaration, ruleSteeringBinding.grants, ruleSteeringBinding.destination)
  const p = createRealtimeSelectionPipeline({ enabled: true, material: { allowedKinds: ruleSteeringDeclaration.watch.kinds, references: refs, historyTurns: 2, historyMode: 'message', toolFields: { bash: ['command'] } }, selection: { modules: [watch], frameBoundedMaterial: true, currentInPayload: true, modelConfig: { modelConfigVersion: 1, defaultJudgeProfile: 'toy', profiles: [{ id: 'toy', backend: 'toy', backendVersion: '1', provider: 'scripted', model: 'toy-classifier', role: 'judge' }] }, modelHost: { backends: { toy: backend }, maxProfiles: 1, maxTotalConcurrent: 1 }, goal: 'Invented rule probe', isPermitted: () => true } })
  p.accept(frame(1, 'session_start'))
  return { ...p, requests, async close() { p.dispose(); await p.idle() } }
}
