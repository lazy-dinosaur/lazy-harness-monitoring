import { createReferencesRegistration, referencesBinding } from '@lazy-harness/monitoring-module-references'
import type { Reference } from '@lazy-harness/monitoring-core'
import { parseModules, stubBinding, type EvalModule } from './contracts.ts'

/** Opt-in shipped module registration; no alias to P4's review.references synthetic purpose.
 * Replays stateless template delivery. A real host must inject its own AlreadyRead ledger.
 */
export function createReferencesEvalModule(references: readonly Reference[]): EvalModule {
  const registration = createReferencesRegistration({ stage: 'active' })
  const material = { maxSources: 16, maxBytes: 16384, maxSourceBytes: 8192 }
  return parseModules([{
    id: registration.moduleId, declaration: registration.declaration, grants: referencesBinding.grants,
    ceiling: { material, timeoutMs: 2000, models: [stubBinding] },
    knobs: { watchPoints: ['input'], material, historyTurns: 4, question: registration.declaration.purpose.question, model: stubBinding, timeoutMs: 2000, report: 'always', stage: registration.stage },
    privateCandidate: false, references,
  }])[0]
}
