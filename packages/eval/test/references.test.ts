import { expect, test } from 'bun:test'
import { artifactBytes, createManifest, parseModules, replay } from '@lazy-harness/monitoring-eval'
import { referencesBinding, referencesQuestion } from '@lazy-harness/monitoring-module-references'
import { referencesFixture } from '../fixtures/references.ts'

test('shipped references module scripted replay is byte-identical and executes the real template', async () => {
  const { modules, dataset } = referencesFixture()
  const manifest = createManifest({ runId: 'toy-references-proof', codeCommit: 'b'.repeat(40), modules, dataset, seed: 17, contentConsent: true })
  expect(manifest.modules[0].coreDeclarationHash).toBe(referencesBinding.declarationHash!)
  expect(modules[0].knobs.question).toEqual(referencesQuestion)
  const a = await replay(manifest, dataset, modules), b = await replay(manifest, dataset, modules)
  expect(artifactBytes(a)).toBe(artifactBytes(b))
  expect(a.trace.map(r => r.proposed)).toEqual([true, false, false])
  expect(a.trace[0].work.completion[0].value.body).toMatchObject({ status: 'completed', value: { status: 'prepared', output: { deliveredIds: ['doc:harbor'], droppedAlreadyRead: [] }, report: { text: '[근거 자료]\n- doc:harbor (v7): Toy harbor lanterns are violet.' } } })
  expect(a.trace[0].report.delivery[0]).toMatchObject({ kind: 'hook-boundary', evidence: 'synthetic' })
  expect(a.trace[2].report.enqueue).toEqual([])
})

test('references registration cannot impersonate a different declaration or widen P4 actions', () => {
  const { modules } = referencesFixture()
  const altered = structuredClone(modules)
  altered[0].declaration = { ...altered[0].declaration, purpose: { question: { instructions: 'Not references', criteria: referencesQuestion.criteria } } }
  expect(() => parseModules(altered)).toThrow('references registration must match')
  const alias = structuredClone(modules); alias[0].id = 'review.references'
  expect(() => parseModules(alias)).toThrow('no actions')
})
