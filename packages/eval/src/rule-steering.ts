import { canonicalJsonHash, type Reference } from '@lazy-harness/monitoring-core'
import { ruleSteeringBinding, ruleSteeringDeclaration, RULE_STEERING_MODULE_ID } from '@lazy-harness/monitoring-module-rule-steering'
import { parseModules, stubBinding, type EvalModule } from './contracts.ts'

/** Only the explicit offline shadow probe may widen the observe ceiling, never to active.
 * All other declaration fields and grants must match the shipped module exactly.
 */
export function isRuleSteeringEvalRegistration(m: EvalModule): boolean {
  const shadow = m.knobs.stage === 'shadow'
  return m.id === RULE_STEERING_MODULE_ID && !m.privateCandidate && m.knobs.report === 'never'
    && canonicalJsonHash(m.grants) === canonicalJsonHash(ruleSteeringBinding.grants)
    && canonicalJsonHash(m.declaration) === canonicalJsonHash(shadow ? { ...ruleSteeringDeclaration, maxStage: 'shadow' } : ruleSteeringDeclaration)
}
/** Scripted only. Default observes; explicit shadow runs the real verifier/template job but cannot report. */
export function createRuleSteeringEvalModule(references: readonly Reference[], stage: 'observe' | 'shadow' = 'observe'): EvalModule {
  const material = { maxSources: 16, maxBytes: 16384, maxSourceBytes: 8192 }
  return parseModules([{
    id: RULE_STEERING_MODULE_ID, declaration: stage === 'shadow' ? { ...ruleSteeringDeclaration, maxStage: 'shadow' } : ruleSteeringDeclaration, grants: ruleSteeringBinding.grants,
    ceiling: { material, timeoutMs: 2000, models: [stubBinding] },
    knobs: { watchPoints: ['tool.before', 'assistant.message'], material, historyTurns: 2, question: ruleSteeringDeclaration.purpose.question, model: stubBinding, timeoutMs: 2000, report: 'never', stage },
    privateCandidate: false, references,
  }])[0]
}
