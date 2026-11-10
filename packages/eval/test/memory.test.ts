import { expect, test } from 'bun:test'
import { artifactBytes, createManifest, createMemoryEvalModule, parseDataset, parseModules, replay, score, verifyArtifact } from '@lazy-harness/monitoring-eval'
import { validateTraceRecord } from '../src/trace-schema.ts'
import { memoryFixture } from '../fixtures/memory.ts'
const manifestFor = (f: ReturnType<typeof memoryFixture>, contentConsent = true) => createManifest({ runId: 'toy-memory-proof', codeCommit: 'd'.repeat(40), modules: f.modules, dataset: f.dataset, seed: 31, contentConsent })

test('real memory module replay byte-identical, private receipts not parent-delivery fiction', async () => {
  const f = memoryFixture(), manifest = manifestFor(f)
  const a = await replay(manifest, f.dataset, f.modules), b = await replay(manifest, f.dataset, f.modules)
  expect(artifactBytes(a)).toBe(artifactBytes(b)); verifyArtifact(a)
  expect(a.trace.map(r => r.frameId)).toEqual(f.dataset.frames.slice(1).map(r => r.id))
  expect(a.trace.filter(r => r.proposed).map(r => r.frameId)).toEqual(['memory-2', 'memory-4', 'memory-9'])
  expect(a.trace.filter(r => r.received).map(r => r.frameId)).toEqual(['memory-2', 'memory-4'])
  expect(a.trace.every(r => !r.report.enqueue.length && !r.report.delivery.length)).toBe(true)
  expect(a.trace.every(r => r.cost.judgeCalls === 0 && r.cost.verifierCalls === 0)).toBe(true)
  const first = a.trace[0].work.completion[0].value.body as { answer: { receipt: { candidateId: string; status: string } }; candidate: { candidateId: string; claim: { text: string } } }
  expect(first.answer.receipt.status).toBe('accepted-volatile'); expect(first.answer.receipt.candidateId).toBe(first.candidate.candidateId)
  expect(first.candidate.claim.text).toBe(f.dataset.outputs[0].memory!.evidence[0].text)
  expect(a.trace[1].work.outcomes[0].reason.body).toBe('unchanged-duplicate')
  const second = a.trace[2].work.completion[0].value.body as { candidate: { predecessorCandidateId: string } }
  expect(second.candidate.predecessorCandidateId).toBe(first.candidate.candidateId)
  const scored = score(a, f.labels).modules[0]
  expect(scored.opportunities).toBe(9); expect(scored.proposal.denominators.labeledPositive).toBe(4)
  expect(scored.errors.some(e => e.opportunityId.endsWith('/memory-10'))).toBe(true)
})
test('observe leaves every opportunity, but no jobs, source preparation, effects or candidate receipts', async () => {
  const f = memoryFixture('observe'), a = await replay(manifestFor(f), f.dataset, f.modules)
  expect(createMemoryEvalModule().knobs.stage).toBe('observe')
  verifyArtifact(a); expect(a.trace).toHaveLength(9)
  expect(a.trace.every(r => !r.work.dispatched.length && !r.proposed && !r.received && !r.work.completion.length)).toBe(true)
})
test('labels are scoring-only and cannot leak into module inputs or alter replay', async () => {
  const f = memoryFixture(), seen: unknown[] = [], manifest = manifestFor(f)
  const a = await replay(manifest, f.dataset, f.modules, request => { seen.push(request) })
  const changed = { ...f.labels, opportunities: f.labels.opportunities.map(o => ({ ...o, slices: ['ORACLE_SENTINEL'], label: 'unresolved' as const })) }
  score(a, changed)
  const b = await replay(manifest, f.dataset, f.modules)
  expect(artifactBytes(a)).toBe(artifactBytes(b)); expect(seen).toEqual([])
  expect(artifactBytes(a)).not.toContain('ORACLE_SENTINEL')
  expect(JSON.stringify(a.trace.map(r => r.input))).not.toContain('"label"')
  expect(() => parseDataset({ ...f.dataset, labels: changed })).toThrow()
})
test('memory registration cannot widen stage, report, grants, destination behavior or use alias', () => {
  for (const mutation of ['stage', 'report', 'grants', 'private', 'alias'] as const) {
    const modules = structuredClone(memoryFixture().modules), m = modules[0]
    if (mutation === 'stage') m.knobs.stage = 'active'
    if (mutation === 'report') m.knobs.report = 'always'
    if (mutation === 'grants') m.grants = { ...m.grants, actions: ['inject-context'] }
    if (mutation === 'private') m.privateCandidate = false
    if (mutation === 'alias') m.id = 'knowledge.candidate'
    expect(() => parseModules(modules)).toThrow()
  }
})
test('no consent strips every candidate/source body while preserving hash-bound receipt mechanics', async () => {
  const f = memoryFixture(), a = await replay(manifestFor(f, false), f.dataset, f.modules)
  a.trace.forEach(r => validateTraceRecord(r, false)); verifyArtifact(a)
  expect(a.trace.filter(r => r.received)).toHaveLength(2)
  expect(artifactBytes(a)).not.toContain('Lantern lids use')
})
for (const fault of ['cancel', 'worker-failure', 'unavailable', 'missing-source', 'unknown-receipt'] as const) test(`memory scripted ${fault} remains in denominator and cannot invent acceptance`, async () => {
  const f = structuredClone(memoryFixture()), o = f.dataset.outputs[0]
  if (fault === 'cancel') o.cancel = true
  if (fault === 'worker-failure') o.worker = 'failed'
  if (fault === 'unavailable') o.memory = { ...o.memory!, context: { ...o.memory!.context, available: false } }
  if (fault === 'missing-source') delete o.memory
  if (fault === 'unknown-receipt') o.delivery = 'no-boundary'
  const a = await replay(manifestFor(f), f.dataset, f.modules)
  expect(a.trace[0].received).toBe(false); expect(score(a, f.labels).modules[0].opportunities).toBe(9)
})
