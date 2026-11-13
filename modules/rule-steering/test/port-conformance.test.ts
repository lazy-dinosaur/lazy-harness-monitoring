import { expect, test } from 'bun:test'
import { canonicalJsonHash, createHandlerWorkerPort } from '@lazy-harness/monitoring-core'
import { ApprovedBudgetGate, MonitoringModuleRuntime } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createRuleSteeringRegistration, policyReferences, runPolicyRegistryPortConformance, runRuleVerifierPortConformance, type PolicyRegistry, type PolicyRegistryConformanceHarness } from '@lazy-harness/monitoring-module-rule-steering'
import { trigger } from './support.ts'

const registryFake = (): PolicyRegistryConformanceHarness => ({
  validate(port) { try { policyReferences(port as PolicyRegistry); return true } catch { return false } },
  project: port => policyReferences(port as PolicyRegistry),
})

test('public reusable policy-registry suite accepts in-memory data port and rejects broken validation/projection', () => {
  expect(runPolicyRegistryPortConformance(registryFake)).toHaveLength(3)
  expect(() => runPolicyRegistryPortConformance(() => ({ ...registryFake(), validate: () => true }))).toThrow('malformed registry refused')
  expect(() => runPolicyRegistryPortConformance(() => ({ ...registryFake(), project: () => [] }))).toThrow('exact scope/exception projection')
})

test('public reusable verifier suite accepts an in-memory typed responder and rejects unsafe adapters', async () => {
  expect(await runRuleVerifierPortConformance(respond => async (task, signal) => respond(task, signal))).toHaveLength(3)
  await expect(runRuleVerifierPortConformance(() => async () => ({ mode: 'run', reason: 'unsafe fallback', evidenceRefs: [] }))).rejects.toThrow('one dispatch per selected policy')
  await expect(runRuleVerifierPortConformance(respond => async (task, _signal) => respond(task, new AbortController().signal))).rejects.toThrow('one dispatch per selected policy')
})

test('official off registration dispatches no verifier/worker/report', async () => {
  let calls = 0
  const handlers = { 'rules.steer.remind': { run() { calls++; return { status: 'prepared' as const } } } }
  const rt = new MonitoringModuleRuntime({ modules: [createRuleSteeringRegistration({ stage: 'off' })], handlers, workerPort: createHandlerWorkerPort(handlers), budget: new ApprovedBudgetGate(), report: r => { calls++; return { reportId: canonicalJsonHash(r), status: 'enqueued' } } })
  try { expect((await rt.onTrigger(trigger()))[0].reason).toBe('stage:off'); expect(calls).toBe(0) } finally { rt.dispose(); await rt.idle() }
})
