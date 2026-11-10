import { referencesBinding, referencesDeclaration, REFERENCES_MODULE_ID } from '@lazy-harness/monitoring-module-references'
import type { Reference } from '@lazy-harness/monitoring-core'
import { parseModules, stubBinding, type EvalModule } from './contracts.ts'

/** Opt-in shipped module registration; no alias to P4's review.references synthetic purpose.
 * Replays stateless template delivery. A real host must inject its own AlreadyRead ledger.
 */
export function createReferencesEvalModule(references: readonly Reference[]): EvalModule {
  const material = { maxSources: 16, maxBytes: 16384, maxSourceBytes: 8192 }
  return parseModules([{
    id: REFERENCES_MODULE_ID, declaration: referencesDeclaration, grants: referencesBinding.grants,
    ceiling: { material, timeoutMs: 2000, models: [stubBinding] },
    knobs: { watchPoints: ['input'], material, historyTurns: 4, question: referencesDeclaration.purpose.question, model: stubBinding, timeoutMs: 2000, report: 'always', stage: 'active' },
    privateCandidate: false, references,
  }])[0]
}
