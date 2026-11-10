import { expect, test } from 'bun:test'
import { artifactBytes, createManifest, createRuleSteeringEvalModule, parseModules, replay } from '@lazy-harness/monitoring-eval'
import { ruleSteeringBinding } from '@lazy-harness/monitoring-module-rule-steering'
import { validateTraceRecord } from '../src/trace-schema.ts'
import { ruleSteeringFixture } from '../fixtures/rule-steering.ts'

const manifestFor = (f: ReturnType<typeof ruleSteeringFixture>, contentConsent = true) => createManifest({ runId: 'toy-rule-proof', codeCommit: 'c'.repeat(40), ...f, seed: 23, contentConsent })

test('real rule module shadow replay is byte-identical, preserves frame order and per-turn dedup', async () => {
  const f = ruleSteeringFixture(), manifest = manifestFor(f)
  const a = await replay(manifest, f.dataset, f.modules), b = await replay(manifest, f.dataset, f.modules)
  expect(artifactBytes(a)).toBe(artifactBytes(b)); a.trace.forEach(r => validateTraceRecord(r, true))
  expect(a.trace.map(r => r.frameId)).toEqual(['rules-2', 'rules-3', 'rules-4', 'rules-5', 'rules-6'])
  const active = a.trace.filter(r => r.cost.judgeCalls)
  expect(active.map(r => r.cost.verifierCalls)).toEqual([2, 0, 2])
  expect(active.map(r => r.cost.judgeCalls)).toEqual([3, 1, 3])
  expect(active.map(r => r.proposed)).toEqual([true, false, true])
  expect(active[0].work.completion[0].value.body).toMatchObject({ status: 'completed', value: { status: 'prepared', output: { confirmedRuleIds: ['policy:glass-0', 'policy:glass-1'] } } })
  expect(active.every(r => !r.received && !r.report.enqueue.length && !r.report.delivery.length)).toBe(true)
  const firstTask = active[0].work.verification[0].task.body as { view: { event: { payload: { currentReferenceIds: string[] } }; context: { references: { id: string; content: string }[] } } }
  expect(firstTask.view.event.payload.currentReferenceIds.length).toBeGreaterThan(0)
  expect(JSON.stringify(firstTask)).not.toContain('red again') // no future frame
  expect(firstTask.view.context.references.some(r => r.id === 'policy:glass-1')).toBe(false)
})

test('default registration observes only; explicit shadow probe cannot become active or alter the binding', async () => {
  expect(createRuleSteeringEvalModule([]).knobs.stage).toBe('observe')
  const f = ruleSteeringFixture('observe'), m = manifestFor(f)
  expect(m.modules[0].coreDeclarationHash).toBe(ruleSteeringBinding.declarationHash!)
  const a = await replay(m, f.dataset, f.modules)
  expect(a.trace.every(r => r.cost.verifierCalls === 0 && !r.work.dispatched.length)).toBe(true)
  const shadow = ruleSteeringFixture().modules
  for (const change of ['stage', 'report', 'cap', 'alias'] as const) {
    const altered = structuredClone(shadow)
    if (change === 'stage') altered[0].knobs.stage = 'active'
    if (change === 'report') altered[0].knobs.report = 'always'
    if (change === 'cap') (altered[0].declaration.jobs[0].cost!.caps as { judgeCalls: number }).judgeCalls = 9
    if (change === 'alias') altered[0].id = 'review.rules'
    expect(() => parseModules(altered)).toThrow()
  }
})

test('verifier trace counts maximum 8 separately and total judge cost 9; consent redacts bodies', async () => {
  const f = ruleSteeringFixture('shadow', 8), a = await replay(manifestFor(f, false), f.dataset, f.modules)
  a.trace.forEach(r => validateTraceRecord(r, false))
  expect(a.trace[1].cost).toMatchObject({ judgeCalls: 9, verifierCalls: 8, workerCalls: 1 })
  expect(a.trace[1].cost.usd).toBeCloseTo(0.011)
  expect(a.trace[1].work.verification).toHaveLength(8)
  expect(a.trace[1].work.verification.every(v => !Object.hasOwn(v.task, 'body') && !Object.hasOwn(v.result, 'body'))).toBe(true)
})

for (const mode of ['skip', 'defer', 'failed', 'missing', 'cancelled'] as const) test(`scripted ${mode} verification fails closed in replay`, async () => {
  const f = structuredClone(ruleSteeringFixture())
  for (const output of f.dataset.outputs) {
    if (mode === 'cancelled') output.cancel = true
    else if (mode === 'missing') delete output.verifications
    else output.verifications!.forEach(v => { v.mode = mode })
  }
  const a = await replay(manifestFor(f), f.dataset, f.modules)
  expect(a.trace.every(r => !r.proposed && !r.received)).toBe(true)
  if (mode !== 'cancelled') expect(a.trace[1].cost.verifierCalls).toBe(2)
})
