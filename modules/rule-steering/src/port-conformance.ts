import { canonicalJsonHash, freezeMonitoringData, type Decision, type View } from '@lazy-harness/monitoring-core'
import type { BudgetLease, Trigger } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createRuleSteeringHandlers, createRuleSteeringRegistration, policyReferences, RULE_STEERING_MODULE_ID, type PolicyRegistry, type PolicyReference, type RuleVerifier } from './index.ts'

const assert = (yes: unknown, name: string): void => { if (!yes) throw Error(`Rule-port conformance: ${name}`) }
const registry = (): PolicyRegistry => ({ id: 'synthetic-registry', version: '1', policies: [
  { id: 'blue-glass', version: '1', title: 'Use blue glass.', scope: 'Lantern assembly.', exceptions: ['Festival permits red.'] },
  { id: 'two-ribbons', version: '1', title: 'Use two ribbons.' },
] })

/** The protocol-1 registry port is admitted data, not a loader. Adapt the host validator/projection here. */
export interface PolicyRegistryConformanceHarness {
  validate(port: unknown): boolean
  project(port: unknown): readonly PolicyReference[]
}
export type PolicyRegistryConformanceFactory = () => PolicyRegistryConformanceHarness
/** Synthetic shape/version/projection probes only; cannot prove host authority or sandbox callbacks. */
export function runPolicyRegistryPortConformance(factory: PolicyRegistryConformanceFactory): readonly string[] {
  const h = factory(), r = freezeMonitoringData(registry()), before = canonicalJsonHash(r), refs = policyReferences(r)
  assert(h.validate(r) === true, 'valid admitted registry')
  assert(canonicalJsonHash(h.project(r)) === canonicalJsonHash(refs), 'exact scope/exception projection')
  assert(canonicalJsonHash(h.project(r)) === canonicalJsonHash(refs) && canonicalJsonHash(r) === before, 'deterministic/nonmutating')
  for (const changed of [
    { ...r, id: 'other-registry' }, { ...r, version: '2' },
    ...[{ version: '2' }, { title: 'Use green glass.' }, { scope: 'Kites only.' }, { exceptions: ['No exception.'] }].map(change => ({ ...r, policies: [{ ...r.policies[0], ...change }] })),
  ]) assert(h.project(changed)[0].version !== refs[0].version, 'all deciding identity/text is versioned')
  let getters = 0
  const accessor = { ...r, get policies() { getters++; return r.policies } }
  for (const bad of [undefined, {}, { ...r, version: '' }, { ...r, extra: true }, { ...r, policies: [r.policies[0], r.policies[0]] }, { ...r, policies: [{ ...r.policies[0], version: '' }] }, { ...r, policies: Array.from({ length: 65 }, (_, i) => ({ ...r.policies[0], id: `rule-${i}` })) }, accessor]) {
    assert(h.validate(bad) === false, 'malformed registry refused')
    let rejected = false
    try { h.project(bad) } catch { rejected = true }
    assert(rejected, 'malformed projection refused')
  }
  assert(getters === 0, 'accessors never executed')
  return Object.freeze(['registry/exact-projection/determinism', 'registry/versioned-identities-and-text', 'registry/malformed/bounds/accessors'])
}

/** Wrap the injected scripted responder using the same adapter path as the real verifier, never a model. */
export type RuleVerifierConformanceFactory = (respond: RuleVerifier) => RuleVerifier
/** Exercises the custom verifier through the real handler, not a promoted official registration. */
export async function runRuleVerifierPortConformance(factory: RuleVerifierConformanceFactory): Promise<readonly string[]> {
  const policies = policyReferences(registry())
  const view: View = { eventRef: 'event:synthetic-event', event: { id: 'synthetic-event', kind: 'tool_call', sequence: 1, scopeId: 'synthetic-scope', contextVersion: '1', payload: { currentReferenceIds: ['current'] } }, context: { scopeId: 'synthetic-scope', version: '1', goal: 'Synthetic probe only', references: [{ id: 'current', kind: 'tool-arguments', version: '1', content: 'Assemble a lantern.' }, ...policies] } }
  const trigger: Trigger = { moduleId: RULE_STEERING_MODULE_ID, sessionId: 'synthetic-session', eventId: view.event.id, turn: 1, view, evidence: view.context.references.map(r => ({ id: r.id, version: r.version, kind: r.kind, text: r.content })) }
  const job = createRuleSteeringRegistration().jobs[0]
  const lease = (): BudgetLease => { let remaining = 8; return { remaining: () => remaining, consume(_kind, n) { if (n > remaining) throw Error('synthetic budget'); remaining -= n } } }
  const decision = (mode: Decision['mode']): Decision => ({ mode, reason: 'Synthetic response', evidenceRefs: [] })
  for (const mode of ['run', 'skip', 'defer', 'undefined', 'throw'] as const) {
    const controller = new AbortController(), seen: string[] = []
    const verify = factory(async (task, signal) => {
      assert(signal === controller.signal, 'cancellation signal identity')
      assert(Object.isFrozen(task) && Object.isFrozen(task.view.context.references), 'immutable verification task')
      const payload = task.view.event.payload as { verifyReferenceId: string; currentReferenceIds: string[] }
      const target = task.view.context.references.filter(r => r.kind === 'policy')
      assert(target.length === 1 && target[0].id === payload.verifyReferenceId, 'exactly one target policy')
      assert(target[0].content === policies.find(p => p.id === target[0].id)?.content && target[0].version === policies.find(p => p.id === target[0].id)?.version, 'exact policy bytes/version')
      assert(payload.currentReferenceIds[0] === 'current' && task.question.selectReferences === false && task.view.event.id === trigger.eventId, 'current event identity/no recursive selection')
      seen.push(target[0].id)
      if (mode === 'throw') throw Error('Synthetic failure')
      return mode === 'undefined' ? undefined : decision(mode)
    })
    const handler = createRuleSteeringHandlers(verify)[`${RULE_STEERING_MODULE_ID}.remind`]
    const outcome = await handler.run({ trigger, job, signal: controller.signal, lease: lease() })
    assert(seen.length === 2 && new Set(seen).size === 2, 'one dispatch per selected policy')
    assert(outcome.status === (mode === 'run' ? 'prepared' : 'rejected'), `fail-closed ${mode}`)
    if (mode !== 'run') assert(!outcome.report, 'no unverified report')
  }
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  const controller = new AbortController()
  const handler = createRuleSteeringHandlers(factory(async () => { entered(); await gate; return decision('run') }))[`${RULE_STEERING_MODULE_ID}.remind`]
  const pending = handler.run({ trigger, job, signal: controller.signal, lease: lease() })
  try {
    assert(await Promise.race([started.then(() => true), Promise.resolve(pending).then(() => false)]), 'delayed responder dispatched')
    controller.abort(); release()
    assert((await pending).status === 'rejected', 'cancelled late success cannot prepare')
  } finally { controller.abort(); release(); await pending }
  let calls = 0
  const cancelled = new AbortController(); cancelled.abort()
  const inert = createRuleSteeringHandlers(factory(async () => { calls++; return decision('run') }))[`${RULE_STEERING_MODULE_ID}.remind`]
  assert((await inert.run({ trigger, job, signal: cancelled.signal, lease: lease() })).status === 'rejected' && calls === 0, 'pre-cancelled never dispatches')
  return Object.freeze(['verifier/task-identity/immutable/signal', 'verifier/run/skip/defer/undefined/failure', 'verifier/cancel-before-and-after-dispatch'])
}
