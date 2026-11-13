/** Single in-process composition entry. Importing does not attach hooks or construct an engine. */
export * from './packages/core/src/sdk/index.ts'
export * as host from './packages/core/src/host/index.ts'
export * as references from './modules/references/src/index.ts'
export * as rules from './modules/rule-steering/src/index.ts'
export * as memory from './modules/memory/src/index.ts'
import { MEMORY_SOURCE_PORT_MAJOR, type MemorySource } from './modules/memory/src/index.ts'
import { REPORT_ENQUEUE_PORT_MAJOR } from './packages/core/src/engine/monitoring-engine-runtime.ts'
import { WORKER_EXECUTION_PORT_MAJOR } from './packages/core/src/sdk/worker-execution.ts'
import { JUDGEMENT_MODEL_PORT_MAJOR } from './packages/core/src/sdk/model-schema.ts'
import { READ_RECORD_PORT_MAJOR, REVIEW_SINK_PORT_MAJOR } from './packages/core/src/host/input-ports.ts'
import { STATE_PERSISTENCE_PORT_MAJOR } from './packages/core/src/state/state-persistence.ts'
import { POLICY_REGISTRY_PORT_MAJOR, RULE_VERIFIER_PORT_MAJOR, policyReferences, type PolicyRegistry, type RuleVerifier } from './modules/rule-steering/src/index.ts'
import { capturePortResult, completed, held, portFailure, portValue, type Held, type PortResult } from './packages/core/src/sdk/composition-ports.ts'
import { assertPortMajors, startModuleComposition, type PortMajors, type ModuleManifest } from './packages/core/src/sdk/module-manifest.ts'
import type { Decision } from './packages/core/src/sdk/contracts.generated.ts'
export const MONITORING_PORT_MAJORS = Object.freeze({
  'worker.execution': WORKER_EXECUTION_PORT_MAJOR,
  'judgement.model': JUDGEMENT_MODEL_PORT_MAJOR,
  'session.read-records': READ_RECORD_PORT_MAJOR,
  'memory.review-sink': REVIEW_SINK_PORT_MAJOR,
  'memory.source': MEMORY_SOURCE_PORT_MAJOR,
  'report.enqueue': REPORT_ENQUEUE_PORT_MAJOR,
  'policy.registry': POLICY_REGISTRY_PORT_MAJOR,
  'rule.verifier': RULE_VERIFIER_PORT_MAJOR,
  'state.persistence': STATE_PERSISTENCE_PORT_MAJOR,
})
/** Compare BOTH module support and the host's advertised majors before any factory. Defaults are explicit host choices. */
export function startMonitoringComposition<T>(root: string, hostMajors: PortMajors, compose: (manifest: ModuleManifest) => T): T {
  return startModuleComposition(root, MONITORING_PORT_MAJORS, manifest => {
    assertPortMajors(manifest.requires, hostMajors)
    return compose(manifest)
  })
}
export type CompositionMemorySource = {
  capture(frame: Parameters<MemorySource['capture']>[0]): PortResult<unknown>
  isCurrent(...args: Parameters<MemorySource['isCurrent']>): PortResult<boolean>
}
export function exposeMemorySource(source: MemorySource): CompositionMemorySource {
  return {
    capture(frame) { try { return completed(source.capture(frame)) } catch (error) { return portFailure(error, 'terminal') } },
    isCurrent(...args) { try { return completed(source.isCurrent(...args)) } catch (error) { return portFailure(error, 'terminal') } },
  }
}
export function bindMemorySource(source: CompositionMemorySource): MemorySource {
  return { capture: frame => portValue(source.capture(frame)), isCurrent: (...args) => portValue(source.isCurrent(...args)) }
}
export type CompositionRuleVerifier = (task: Parameters<RuleVerifier>[0], signal: AbortSignal) => Promise<PortResult<Decision | Held<Decision>>>
export function exposeRuleVerifier(verify: RuleVerifier): CompositionRuleVerifier {
  return async (...args) => {
    if (args[1].aborted) return { status: 'cancelled', certainty: 'terminal', reason: 'Rule verification cancelled before dispatch' }
    const result = await capturePortResult(() => verify(...args), 'uncertain')
    if (args[1].aborted) return { status: 'cancelled', certainty: 'uncertain', reason: 'Rule verification cancelled after dispatch' }
    if (result.status !== 'completed') return result
    if (!result.value) return { status: 'failed', certainty: 'terminal', reason: 'Rule verifier returned no judgement' }
    return result.value.mode === 'defer' ? held(result.value.reason, result.value) : completed(result.value)
  }
}
export function bindRuleVerifier(verify: CompositionRuleVerifier): RuleVerifier {
  return async (...args) => { const value = portValue(await verify(...args)); return 'held' in value ? value.detail : value }
}
/** A registry is admitted immutable data, not implicit filesystem discovery. */
export function exposePolicyRegistry(registry: PolicyRegistry): PortResult<PolicyRegistry> {
  try { policyReferences(registry); return completed(registry) } catch (error) { return portFailure(error, 'terminal') }
}
export function bindPolicyRegistry(result: PortResult<PolicyRegistry>): PolicyRegistry {
  const registry = portValue(result); policyReferences(registry); return registry
}
