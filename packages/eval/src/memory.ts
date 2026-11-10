import { canonicalJsonHash } from '@lazy-harness/monitoring-core'
import { memoryBinding, memoryDeclaration, MEMORY_MODULE_ID } from '@lazy-harness/monitoring-module-memory'
import { parseModules, stubBinding, type EvalModule } from './contracts.ts'

export function isMemoryEvalRegistration(m: EvalModule): boolean {
  return m.id === MEMORY_MODULE_ID && m.privateCandidate && m.knobs.report === 'never'
    && canonicalJsonHash(m.grants) === canonicalJsonHash(memoryBinding.grants)
    && canonicalJsonHash(m.declaration) === memoryBinding.declarationHash && !m.references.length
    && canonicalJsonHash(m.knobs.question) === canonicalJsonHash(memoryDeclaration.purpose.question)
}
/** Scripted typed decisions only; explicit sidecar evidence, never oracle labels, reaches the module. */
export function createMemoryEvalModule(stage: 'observe' | 'shadow' = 'observe'): EvalModule {
  const material = { maxSources: 8, maxBytes: 16384, maxSourceBytes: 8192 }
  return parseModules([{
    id: MEMORY_MODULE_ID, declaration: memoryDeclaration, grants: memoryBinding.grants,
    ceiling: { material, timeoutMs: 2000, models: [stubBinding] },
    knobs: { watchPoints: [...memoryDeclaration.watch.events], material, historyTurns: 2, question: memoryDeclaration.purpose.question, model: stubBinding, timeoutMs: 2000, report: 'never', stage },
    privateCandidate: true, references: [],
  }])[0]
}
