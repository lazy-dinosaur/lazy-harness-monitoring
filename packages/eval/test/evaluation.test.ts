import { describe, expect, test } from 'bun:test'
import { canonicalJson, canonicalJsonHash, type MonitoringModelRequest } from '@lazy-harness/monitoring-core'
import { artifactBytes, compare, confusion, createManifest, datasetIdentity, parseDataset, parseLabels, parseManifest, parseModules, quantiles, replay, score, traceRecordJsonSchema, runManifestJsonSchema, type EvalModule, type ReplayDataset, type RunArtifact } from '@lazy-harness/monitoring-eval'
import { main } from '../src/cli.ts'

const root = new URL('../fixtures/', import.meta.url)
const modules = parseModules(await Bun.file(new URL('modules.json', root)).json())
const dev = parseDataset(await Bun.file(new URL('dev.json', root)).json())
const holdout = parseDataset(await Bun.file(new URL('holdout.json', root)).json())
const labels = parseLabels(await Bun.file(new URL('dev.labels.json', root)).json())
const gold = parseLabels(await Bun.file(new URL('holdout.labels.json', root)).json())
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T
const copy = <T>(v: T): Mutable<T> => JSON.parse(JSON.stringify(v))
const manifestFor = (dataset = dev, config = modules, consent = false) => createManifest({ runId: 'synthetic-test', codeCommit: 'a'.repeat(40), dataset, modules: config, seed: 42, contentConsent: consent })
async function run(dataset = dev, config = modules, consent = false) { return replay(manifestFor(dataset, config, consent), dataset, config) }
const baseline = await run()
const reseal = (a: RunArtifact) => { a.traceHash = canonicalJsonHash(a.trace); a.retention.bytes = a.trace.reduce((n, r) => n + Buffer.byteLength(canonicalJson(r)), 0); return a }

describe('versioned identities and shared replay', () => {
  test('public evaluator exports JSON schemas, types and one path for all four modules', () => {
    expect(runManifestJsonSchema.$id).toBe('urn:monitoring-eval:run:v1')
    expect(traceRecordJsonSchema.$id).toBe('urn:monitoring-eval:trace:v1')
    expect(parseManifest(baseline.manifest)).toEqual(baseline.manifest)
    expect(baseline.trace).toHaveLength(36)
    expect(baseline.trace.filter(r => r.proposed).map(r => r.moduleId).sort()).toEqual(modules.map(m => m.id).sort())
    expect(baseline.trace.filter(r => r.judgement.raw.length)).toHaveLength(9)
    expect(baseline.trace.flatMap(r => r.work.completion).every(c => c.status === 'completed' && c.certainty === 'terminal')).toBe(true)
  })
  test('same manifest, seed and inputs yield byte-identical artifacts repeatedly', async () => {
    const a = await run(), b = await run()
    expect(artifactBytes(a)).toBe(artifactBytes(baseline))
    expect(artifactBytes(b)).toBe(artifactBytes(a))
  })
  test('seed changes logical latency; not a wall-clock benchmark', async () => {
    const m = copy(manifestFor()); m.seed = 43
    const a = await replay(m, dev, modules)
    expect(a.trace.map(r => r.latency)).not.toEqual(baseline.trace.map(r => r.latency))
    expect(a.trace.map(r => r.proposed)).toEqual(baseline.trace.map(r => r.proposed))
  })
  test('binds source versions, criteria, configuration, output script and model versions', async () => {
    for (const change of ['source', 'question', 'model', 'outputs'] as const) {
      const d = copy(dev), c = copy(modules)
      if (change === 'source') d.frames[1].snapshot.revision = 'changed'
      if (change === 'question') c[0].knobs.question.criteria.run = 'Changed synthetic criterion.'
      if (change === 'model') c[0].knobs.model.version = '2'
      if (change === 'outputs') d.outputs[0].mode = 'skip'
      await expect(replay(manifestFor(), d, c)).rejects.toThrow()
    }
    expect(baseline.manifest.modules.every(m => m.declarationHash.length === 64 && m.questionHash.length === 64 && m.configHash.length === 64)).toBe(true)
  })
  test('manifest schema rejects unknown fields, versions, real clock and invalid limits', () => {
    for (const patch of [{ schemaVersion: 'v2' }, { clockMode: 'wall' }, { seed: -1 }, { contentConsent: 'yes' }, { undeclared: true }, { limits: { maxRecords: 0, maxTraceBytes: 256, maxFrames: 512 } }]) expect(() => parseManifest({ ...baseline.manifest, ...patch })).toThrow()
  })
  test('only synthetic bounded datasets; malformed frames and duplicate scripts fail closed', () => {
    expect(() => parseDataset({ ...dev, synthetic: false })).toThrow()
    const a = copy(dev); a.frames[1].snapshot.available = 'yes' as any
    expect(() => parseDataset(a)).toThrow()
    expect(() => parseDataset({ ...dev, frames: [...dev.frames, dev.frames[1]] })).toThrow()
    expect(() => parseDataset({ ...dev, outputs: [...dev.outputs, dev.outputs[0]] })).toThrow()
  })
  test('disjoint synthetic dev/holdout source and frame identities, separate labels', async () => {
    expect(datasetIdentity(dev)).toEqual(labels.dataset)
    expect(datasetIdentity(holdout)).toEqual(gold.dataset)
    expect(new Set(dev.frames.map(f => f.id).filter(id => holdout.frames.some(f => f.id === id))).size).toBe(0)
    const a = await run(holdout)
    expect(score(a, gold).modules.every(m => m.proposal.TP === 1)).toBe(true)
    expect(() => compare(baseline, a)).toThrow('same versioned dataset')
  })
})

describe('privacy, consent and retention', () => {
  test('default trace contains hashes/ids, versions and provenance, never source bodies', () => {
    const bytes = artifactBytes(baseline)
    expect(bytes).not.toContain('show the inspect API')
    expect(bytes).not.toContain('inspect-only review')
    expect(bytes).not.toContain('"body"')
    const material = baseline.trace.find(r => r.moduleId === 'review.references' && r.proposed)!.selection.selected
    expect(material.some(m => m.kind === 'reference-doc' && m.version === 'synthetic-v1')).toBe(true)
    expect(material.every(m => m.content.hash.length === 64 && m.provenance)).toBe(true)
  })
  test('explicit consent stores redacted bodies, also redacts host material before model', async () => {
    const d = copy(dev), c = copy(modules)
    const secret = ['pass', 'word', '=', 'synthetic-private-value'].join('')
    ;(d.frames[1].payload as any).text += ' ' + secret
    c[0].references[0].content += ' ' + secret
    const calls: MonitoringModelRequest[] = []
    const a = await replay(manifestFor(d, c, true), d, c, r => calls.push(r))
    expect(artifactBytes(a)).toContain('"body"')
    expect(artifactBytes(a)).toContain('[REDACTED:assignment]')
    expect(artifactBytes(a)).not.toContain('synthetic-private-value')
    expect(JSON.stringify(calls)).not.toContain('synthetic-private-value')
    expect(score(a, { ...labels, dataset: a.manifest.dataset }).modules).toHaveLength(4)
  })
  test('record retention evicts explicitly and incomplete scoring/compare is refused', async () => {
    const m = copy(manifestFor()); m.limits.maxRecords = 2
    const a = await replay(m, dev, modules)
    expect(a.trace).toHaveLength(2); expect(a.retention.dropped).toBe(34)
    expect(() => score(a, labels)).toThrow('incomplete')
    expect(() => compare(a, baseline)).toThrow('incomplete')
  })
  test('byte retention including consent bodies never exceeds hard cap', async () => {
    const m = copy(manifestFor(dev, modules, true)); m.limits.maxTraceBytes = 256
    const a = await replay(m, dev, modules)
    expect(a.retention.bytes).toBeLessThanOrEqual(256)
    expect(a.retention.dropped).toBe(36)
  })
  test('tampered imported content, hashes, receipt kinds and unauthorized bodies are rejected', () => {
    const a = copy(baseline); a.trace[0].proposed = !a.trace[0].proposed
    expect(() => score(a, labels)).toThrow('corrupt')
    const b = copy(baseline); b.trace[0].input.body = 'not-consented'
    expect(() => score(reseal(b), labels)).toThrow('consent')
    const c = copy(baseline); (c.trace.find(r => r.received)!.report.delivery[0] as any).kind = 'provider-input'
    expect(() => compare(reseal(c), baseline)).toThrow()
  })
})

describe('labels are scoring-only and denominators include failures', () => {
  test('changing gold labels changes scores but cannot change model inputs or replay bytes', async () => {
    const callsA: MonitoringModelRequest[] = [], callsB: MonitoringModelRequest[] = []
    const a = await replay(manifestFor(), dev, modules, r => callsA.push(r))
    const flipped = copy(labels); flipped.opportunities.forEach(o => { o.label = o.label === 'positive' ? 'negative' : 'positive'; o.slices = ['gold-only-canary'] })
    const b = await replay(manifestFor(), dev, modules, r => callsB.push(r))
    expect(canonicalJson(callsA)).toBe(canonicalJson(callsB))
    expect(canonicalJson(callsA)).not.toContain('gold-only-canary')
    expect(artifactBytes(a)).toBe(artifactBytes(b))
    expect(score(a, labels)).not.toEqual(score(b, flipped))
    expect(() => parseDataset({ ...dev, labels: flipped })).toThrow()
  })
  test('precision, recall, FDF and FPR have different explicit denominators; n/a is null', () => {
    const matrix = confusion([{ label: 'positive', positive: true }, { label: 'positive', positive: false }, { label: 'negative', positive: true }, ...Array.from({ length: 3 }, () => ({ label: 'negative' as const, positive: false })), { label: 'unresolved', positive: true }])
    expect(matrix).toMatchObject({ TP: 1, FP: 1, FN: 1, TN: 3, precision: 0.5, recall: 0.5, falseDiscoveryFraction: 0.5, falsePositiveRate: 0.25, unresolvedRun: 1, denominators: { emittedLabeled: 2, labeledPositive: 2, labeledNegative: 4, resolved: 6 } })
    expect(confusion([]).precision).toBeNull(); expect(confusion([]).recall).toBeNull()
    expect(quantiles([5, 1, 2, 4, 3])).toEqual({ samples: 5, p50: 3, p95: 5 })
    expect(quantiles([]).p95).toBeNull()
  })
  test('per-module scoring counts expected pairs, receipts, costs and unresolved cases', () => {
    const s = score(baseline, labels)
    expect(s.modules.every(m => m.proposal.TP === 1 && m.proposal.FP === 0 && m.proposal.FN === 0 && m.triggers.extra.length === 0 && m.triggers.missed.length === 0)).toBe(true)
    expect(s.modules.every(m => m.receipts.success === 1 && m.cost.opportunityDenominator === 9 && m.latency.endToEnd.samples === 1)).toBe(true)
    expect(s.modules.find(m => m.moduleId === 'review.references')!.proposal.unresolvedSilent).toBe(1)
    expect(baseline.trace.find(r => r.moduleId === 'review.memory-candidate' && r.received)!.report.delivery[0].kind).toBe('private-candidate')
    expect(baseline.trace.find(r => r.moduleId === 'review.references' && r.received)!.report.delivery[0]).toMatchObject({ kind: 'hook-boundary', evidence: 'synthetic' })
  })
  test('technical failure/defer/skip on clear positive is FN, never removed', async () => {
    for (const variant of ['failed', 'defer', 'skip', 'unselected'] as const) {
      const d = copy(dev)
      if (variant === 'failed') d.outputs[0].worker = 'failed'
      else if (variant === 'unselected') d.outputs[0].select = false
      else d.outputs[0].mode = variant
      const a = await run(d), s = score(a, labels).modules.find(m => m.moduleId === 'review.references')!
      // Core always retains this frame's own material; reference deselection alone is not a technical failure.
      expect(s.proposal.FN).toBe(variant === 'unselected' ? 0 : 1); expect(s.opportunities).toBe(9)
      expect(s.cost.usdPer100Opportunities).toBeGreaterThan(0)
    }
  })
  test('missed trigger from stage off does not shrink the denominator', async () => {
    const c = copy(modules); c[0].knobs.stage = 'off'
    const s = score(await run(dev, c), labels).modules[0]
    expect(s.proposal.FN).toBe(1); expect(s.triggers.missed).toHaveLength(2)
    expect(s.cost.opportunityDenominator).toBe(9)
  })
  test('extra and missing trigger oracle accounting is independent of semantic labels', () => {
    const l = copy(labels); l.expectedTriggers.shift(); l.expectedTriggers.push({ moduleId: 'review.references', frameId: 'missing-frame', point: 'user.prompt' })
    l.opportunities.push({ moduleId: 'review.references', frameId: 'missing-frame', label: 'positive', slices: ['missing'] })
    const s = score(baseline, l).modules[0]
    expect(s.triggers.extra).toHaveLength(1); expect(s.triggers.missed).toHaveLength(1)
    expect(s.proposal.FN).toBe(1); expect(s.missingOpportunities).toEqual(['review.references/missing-frame'])
  })
  test('enqueue without boundary is censored, not delivery; received recall is lower', async () => {
    const d = copy(dev); d.outputs[0].delivery = 'no-boundary'
    const s = score(await run(d), labels).modules[0]
    expect(s.proposal.TP).toBe(1); expect(s.received.FN).toBe(1)
    expect(s.receipts).toMatchObject({ expectedForProposals: 1, received: 0, success: 0, censored: 1 })
    expect(s.latency.endToEnd.samples).toBe(0)
  })
  test('failed receiver records failure independently from worker success', async () => {
    const d = copy(dev); d.outputs[0].delivery = 'failed'
    const s = score(await run(d), labels).modules[0]
    expect(s.proposal.TP).toBe(1); expect(s.receipts.enqueueFailed).toBe(1)
    expect(s.received.recall).toBe(0)
  })
  test('cancellation records request, terminal completion and no receipt', async () => {
    const d = copy(dev); d.outputs[0].cancel = true
    const a = await run(d), r = a.trace.find(r => r.opportunityId === 'review.references/dev-reference-need')!
    expect(r.cancellation).toEqual({ requested: true, observed: true })
    expect(r.work.completion[0]).toMatchObject({ status: 'refused', certainty: 'terminal' })
    expect(r.received).toBe(false); expect(score(a, labels).modules[0].proposal.FN).toBe(1)
  })
  test('labels reject split mismatch, duplicate identities and unknown module', () => {
    expect(() => score(baseline, gold)).toThrow('mismatch')
    expect(() => parseLabels({ ...labels, opportunities: [...labels.opportunities, labels.opportunities[0]] })).toThrow('duplicate')
    const l = copy(labels); l.opportunities[0].moduleId = 'unknown'
    expect(() => score(baseline, l)).toThrow('mismatch')
  })
})

describe('bounded tuning and explainable comparisons', () => {
  const cases: [string, (m: EvalModule) => void][] = [
    ['watch', m => { m.knobs.watchPoints.push('tool.before') }],
    ['material bytes', m => { m.knobs.material.maxBytes++ }],
    ['material sources', m => { m.knobs.material.maxSources++ }],
    ['source bytes', m => { m.knobs.material.maxSourceBytes++ }],
    ['history', m => { m.knobs.historyTurns = 3 }],
    ['timeout', m => { m.knobs.timeoutMs++ }],
    ['model', m => { m.knobs.model.model = 'real-provider' }],
    ['report', m => { m.knobs.report = 'always' }],
    ['stage', m => { m.declaration = { ...m.declaration, maxStage: 'observe' }; m.knobs.stage = 'active' }],
    ['grants', m => { (m.knobs as any).grants = { actions: ['write'] } }],
    ['effectful declaration', m => { m.grants = { ...m.grants, actions: [...m.grants.actions, 'write'] } }],
  ]
  for (const [name, change] of cases) test(`knob ${name} cannot widen author authority`, () => {
    const c = copy(modules); change(c[0]); expect(() => parseModules(c)).toThrow()
  })
  test('private memory cannot raise stage or report', () => {
    const c = copy(modules); c[2].knobs.stage = 'active'; expect(() => parseModules(c)).toThrow()
    c[2].knobs.stage = 'shadow'; c[2].knobs.report = 'on-result'; expect(() => parseModules(c)).toThrow()
  })
  test('question/criteria and tightened budgets are versioned, not live in-flight mutation', async () => {
    const c = copy(modules); c[0].knobs.question.criteria.run = 'Changed synthetic criterion.'; c[0].knobs.material.maxBytes = 12000
    const a = await run(dev, c), diff = compare(baseline, a, labels)
    expect(a.manifest.modules[0].declarationHash).toBe(baseline.manifest.modules[0].declarationHash)
    expect(a.manifest.modules[0].questionHash).not.toBe(baseline.manifest.modules[0].questionHash)
    expect(diff.manifestChanges).toContain('configHash')
    expect(diff.changed.some(c => c.reasons.includes('judgement'))).toBe(true)
    expect(Object.isFrozen(parseModules(c)[0].knobs)).toBe(true)
  })
  for (const [reason, change] of [
    ['trigger', (d: ReplayDataset, c: EvalModule[]) => { c[0].knobs.stage = 'off' }],
    ['selection', (d: ReplayDataset) => { d.outputs[0].select = false }],
    ['judgement', (d: ReplayDataset) => { d.outputs[0].mode = 'skip' }],
    ['worker', (d: ReplayDataset) => { d.outputs[0].worker = 'failed' }],
    ['delivery', (d: ReplayDataset) => { d.outputs[0].delivery = 'no-boundary' }],
  ] as const) test(`comparison explains ${reason} changes without bodies`, async () => {
    const d = copy(dev), c = copy(modules); change(d, c)
    const a = await run(d, c), diff = compare(baseline, a, labels)
    expect(diff.changed.find(r => r.opportunityId === 'review.references/dev-reference-need')!.reasons).toContain(reason)
    expect(JSON.stringify(diff)).not.toContain('show the inspect API')
    expect(diff.errors!.candidate.find(m => m.moduleId === 'review.references')!.slices.length).toBeGreaterThan(0)
  })
  test('even consented traces never copy bodies into comparison', async () => {
    const a = await run(dev, modules, true), d = copy(dev); d.outputs[0].worker = 'failed'
    const diff = compare(a, await run(d, modules, true), labels)
    expect(JSON.stringify(diff)).not.toContain('"body"')
    expect(JSON.stringify(diff)).not.toContain('inspect-only review')
  })
})

test('missing script is a replay admission error, not an invented negative', async () => {
  const d = copy(dev); d.outputs.shift()
  await expect(run(d)).rejects.toThrow('missing deterministic model output')
})

test('in-flight configuration uses a frozen snapshot; changes require a new replay', async () => {
  const c = copy(modules), manifest = manifestFor(dev, c)
  let changed = false
  const a = await replay(manifest, dev, c, () => { if (!changed) { c[0].knobs.stage = 'off'; changed = true } })
  expect(changed).toBe(true)
  expect(artifactBytes(a)).toBe(artifactBytes(baseline))
  await expect(replay(manifest, dev, c)).rejects.toThrow('manifest')
})

test('CLI run, score, compare share library path and deterministic bytes', async () => {
  const args = ['run', new URL('dev.json', root).pathname, new URL('modules.json', root).pathname, 'cli-proof', '42']
  const a = await main(args), b = await main(args)
  expect(a).toBe(b)
  const artifact = JSON.parse(a) as RunArtifact
  expect(score(artifact, labels).modules).toHaveLength(4)
  await expect(main(['unknown'])).rejects.toThrow()
})
