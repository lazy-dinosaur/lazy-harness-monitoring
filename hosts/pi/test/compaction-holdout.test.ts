import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, symlinkSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseRegionDataset, parseRegionLabels } from '../../../packages/eval/src/compaction-dataset.ts'
import { generateCompactionLongDev } from '../../../packages/eval/src/compaction-generate-long-dev.ts'
import { holdoutHash, prepareHoldout, parseRunArgs, parseHoldoutLabels, run, frozenPolicy } from '../src/eval/compaction-run.ts'
import { MODEL, type ClassifierModel, type ClassifierRuntime } from '../src/eval/compaction-transport.ts'
const model: ClassifierModel = { type: 'classifier', id: 'typesafe/jev-1.14', name: 'Fake', provider: 'openrouter', api: 'typesafe-system-one', baseUrl: 'https://openrouter.ai/api/v1', input: ['text'], contextWindow: 262144, cost: { input: .042, output: 0, cacheRead: 0, cacheWrite: 0 } }
const resolveArgs = ['--resolve-only', '--model', MODEL, '--dataset', 'holdout']
const liveArgs = ['--approve-real-calls', '--model', MODEL, '--dataset', 'holdout', '--max-calls', '120', '--max-usd', '1', '--max-wall-min', '30']
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cmp-seal-test-')), dir = join(root, 'sealed')
  mkdirSync(dir)
  const generated = generateCompactionLongDev()
  const dataset = { ...generated.dataset, split: 'holdout' as const }, labels = { ...generated.labels, split: 'holdout' as const }
  const noiseKind: Record<string, Record<string, string>> = {}
  for (const r of dataset.regions) noiseKind[r.id] = Object.fromEntries(r.materials.filter(m => !labels.labels[r.id]![m.id]).map((m, i) => [m.id, i % 2 ? 'same-topic' : 'filler']))
  const regions = JSON.stringify(dataset), gold = JSON.stringify({ ...labels, noiseKind })
  writeFileSync(join(dir, 'regions.json'), regions); writeFileSync(join(dir, 'labels.json'), gold)
  const sha = holdoutHash(Buffer.from(regions), Buffer.from(gold))
  return { root, dir, dataset, labels, regions, gold, sha, args: ['--holdout-dir', dir, '--expect-sha256', sha], clean: () => rmSync(root, { recursive: true, force: true }) }
}
const noHttp = Object.assign(async () => new Response('{}'), { preconnect() {} }) as unknown as typeof fetch
function fakeRuntime(onCall: () => void = () => {}, fail = false) {
  let calls = 0
  const requests: unknown[] = []
  const runtime: ClassifierRuntime & { getModelOfType(): ClassifierModel; listCredentials(): Promise<{ providerId: string; type: string }[]> } = {
    getModelOfType: () => model,
    listCredentials: async () => [{ providerId: 'openrouter', type: 'oauth' }],
    async classify(m, body, options) {
      calls++; requests.push(structuredClone(body)); onCall()
      if (fail) throw Error('fake failure')
      expect(JSON.stringify(body)).not.toMatch(/noiseKind|same-topic|filler|"labels"/)
      await options!.onPayload!({ model: m.id, ...body }, m)
      await options!.fetch!('https://openrouter.ai/api/v1/systemone', { method: 'POST' })
      return { api: m.api, provider: m.provider, model: m.id, timestamp: 0, stopReason: 'stop', answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, q.type === 'choice' ? { type: 'choice', choice: 'run', confidence: .9, probabilities: { run: .9, skip: .1 } } : { type: 'bool', probability: .1 }])), usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
    },
  }
  return { runtime, calls: () => calls, requests }
}
test('holdout CLI requires seal/path; rejects aliases, missing approval, malformed caps and stray seal options', () => {
  const f = fixture()
  try {
    expect(parseRunArgs([...resolveArgs, ...f.args]).expectSha256).toBe(f.sha)
    for (const args of [resolveArgs, [...resolveArgs, '--holdout-dir', 'relative', '--expect-sha256', f.sha], [...resolveArgs, '--holdout-dir', f.dir, '--expect-sha256', 'bad'], [...liveArgs.slice(1), ...f.args], [...liveArgs, ...f.args, '--max-calls', '121'], ['--resolve-only', '--model', MODEL, ...f.args]]) expect(() => parseRunArgs(args)).toThrow()
  } finally { f.clean() }
})
test('seal is SHA256(raw regions + one LF byte + raw labels); mismatch precedes JSON parsing and opening', () => {
  const f = fixture()
  try {
    expect(f.sha).toBe(createHash('sha256').update(f.regions + '\n' + f.gold).digest('hex'))
    writeFileSync(join(f.dir, 'regions.json'), 'invalid json')
    expect(() => prepareHoldout(f.dir, f.sha, false)).toThrow('sha256 mismatch')
    expect(existsSync(join(f.dir, '.opened'))).toBe(false)
    writeFileSync(join(f.dir, 'regions.json'), f.regions)
    writeFileSync(join(f.dir, 'labels.json'), f.gold + '\n')
    expect(() => prepareHoldout(f.dir, f.sha, false)).toThrow('sha256 mismatch')
  } finally { f.clean() }
})
test('resolve-only estimates without labels even malformed or missing; never opens or creates output', async () => {
  const f = fixture(), fake = fakeRuntime()
  try {
    for (const gold of ['not JSON', undefined]) {
      if (gold === undefined) unlinkSync(join(f.dir, 'labels.json'))
      else writeFileSync(join(f.dir, 'labels.json'), gold)
      await run([...resolveArgs, ...f.args, '--output-dir', join(f.root, 'unused')], async () => fake.runtime, noHttp)
      expect(existsSync(join(f.dir, '.opened'))).toBe(false)
      expect(existsSync(join(f.root, 'unused'))).toBe(false)
    }
    expect(fake.calls()).toBe(0)
  } finally { f.clean() }
})
test('exclusive marker prevents concurrent/second opening and persists without successful classification', () => {
  const f = fixture()
  try {
    const a = prepareHoldout(f.dir, f.sha, false), b = prepareHoldout(f.dir, f.sha, false)
    a.open(join(f.root, 'output'))
    expect(() => b.open(join(f.root, 'other'))).toThrow()
    expect(() => prepareHoldout(f.dir, f.sha, false)).toThrow('already opened')
    expect(statSync(join(f.dir, '.opened')).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(join(f.dir, '.opened'), 'utf8'))).toMatchObject({ outputDir: join(f.root, 'output'), sha256: f.sha })
  } finally { f.clean() }
})
test('outside-Git guard covers .git directory/file, directory symlink and individual input symlinks', () => {
  const f = fixture()
  try {
    const git = join(f.root, 'fake-worktree'); mkdirSync(git); writeFileSync(join(git, '.git'), 'gitdir: elsewhere')
    const inner = join(git, 'sealed'); mkdirSync(inner)
    expect(() => prepareHoldout(inner, f.sha, false)).toThrow('outside Git')
    const link = join(f.root, 'link'); symlinkSync(inner, link)
    expect(() => prepareHoldout(link, f.sha, false)).toThrow('outside Git')
    for (const name of ['regions.json', 'labels.json']) {
      const target = join(git, name); writeFileSync(target, name === 'regions.json' ? f.regions : f.gold)
      unlinkSync(join(f.dir, name)); symlinkSync(target, join(f.dir, name))
      expect(() => prepareHoldout(f.dir, f.sha, false)).toThrow('outside Git')
      unlinkSync(join(f.dir, name)); writeFileSync(join(f.dir, name), name === 'regions.json' ? f.regions : f.gold)
    }
    unlinkSync(join(git, '.git')); mkdirSync(join(git, '.git'))
    expect(() => prepareHoldout(inner, f.sha, false)).toThrow('outside Git')
  } finally { f.clean() }
})
test('metadata is labels-only, sparse, noise-only, and closed schema remains enforced', () => {
  const f = fixture(), r = f.dataset.regions[0]!, m = r.materials.find(m => f.labels.labels[r.id]![m.id])!
  try {
    expect(parseHoldoutLabels(f.labels, f.dataset).noiseKind).toEqual({})
    for (const noiseKind of [[], { unknown: {} }, { [r.id]: { unknown: 'filler' } }, { [r.id]: { [m.id]: 'filler' } }]) expect(() => parseHoldoutLabels({ ...f.labels, noiseKind }, f.dataset)).toThrow()
    expect(() => parseHoldoutLabels({ ...f.labels, extra: true }, f.dataset)).toThrow()
    const d: any = structuredClone(f.dataset); d.regions[0].materials[0].noiseKind = 'filler'
    const text = JSON.stringify(d); writeFileSync(join(f.dir, 'regions.json'), text)
    expect(() => prepareHoldout(f.dir, holdoutHash(Buffer.from(text), Buffer.from(f.gold)), false)).toThrow('material')
  } finally { f.clean() }
})
test('full runner fake-only: holdout split preflight, marker before dispatch, sealed scoring snapshot, noise split private', async () => {
  const f = fixture(), output = join(f.root, 'out')
  const fake = fakeRuntime(() => {
    expect(existsSync(join(f.dir, '.opened'))).toBe(true)
    // Mutations after sealing cannot change the byte snapshot used for scoring.
    writeFileSync(join(f.dir, 'labels.json'), 'not JSON')
  })
  try {
    await run([...liveArgs, ...f.args, '--output-dir', output], async () => fake.runtime, noHttp)
    expect(fake.calls()).toBe(30)
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'))
    expect(report).toMatchObject({ complete: true, holdout: { sha256: f.sha, regionCount: 30, sealVerified: true }, frozenPolicy })
    expect(Object.keys(report.noiseRemovalByKind).sort()).toEqual(['filler', 'same-topic'])
    const counts = Object.values(report.noiseRemovalByKind) as { numerator: number; denominator: number }[]
    expect(counts.reduce((n, c) => n + c.numerator, 0)).toBe(report.overall.noiseRemoval.numerator)
    expect(counts.reduce((n, c) => n + c.denominator, 0)).toBe(report.overall.noiseRemoval.denominator)
    await expect(run([...liveArgs, ...f.args], async () => fake.runtime, noHttp)).rejects.toThrow('already opened')
    expect(fake.calls()).toBe(30)
    for (const name of ['manifest.json', 'report.json', 'item-probabilities.json', 'meter-receipts.json', 'transport-receipts.jsonl']) {
      const contents = readFileSync(join(output, name), 'utf8')
      expect(contents).not.toContain(f.dataset.regions[0]!.materials[0]!.text)
      expect(contents).not.toContain('"questions"')
      expect(statSync(join(output, name)).mode & 0o777).toBe(0o600)
    }
  } finally { f.clean() }
})
test('malformed labels, noiseKind and label split refuse in preflight without marker, output or runtime', async () => {
  const f = fixture(), fake = fakeRuntime()
  let runtimeLoads = 0
  try {
    const r = f.dataset.regions[0]!, id = r.materials[0]!.id
    const badLabels = structuredClone(f.labels); delete badLabels.labels[r.id]![id]
    const diversity = structuredClone(f.labels)
    for (const row of Object.values(diversity.labels)) for (const id of Object.keys(row)) row[id] = true
    const inconsistent = structuredClone(f.labels)
    const tool = r.materials.find(m => JSON.parse(m.content).toolCallId)!
    inconsistent.labels[r.id]![tool.id] = !inconsistent.labels[r.id]![tool.id]
    const cases = [
      ['invalid JSON', undefined],
      [JSON.stringify(badLabels), 'invalid item labels'],
      [JSON.stringify({ ...f.labels, split: 'dev' }), 'invalid labels'],
      [JSON.stringify({ ...f.labels, noiseKind: [] }), 'invalid noiseKind'],
      [JSON.stringify({ ...f.labels, noiseKind: { unknown: {} } }), 'invalid noiseKind region'],
      [JSON.stringify({ ...f.labels, noiseKind: { [r.id]: { [id]: '' } } }), 'invalid noiseKind item'],
      [JSON.stringify(diversity), 'needed position patterns'],
      [JSON.stringify(inconsistent), 'inconsistent tool unit labels'],
    ] as const
    for (const [bad, error] of cases) {
      writeFileSync(join(f.dir, 'labels.json'), bad)
      const sha = holdoutHash(Buffer.from(f.regions), Buffer.from(bad))
      await expect(run([...liveArgs, '--holdout-dir', f.dir, '--expect-sha256', sha, '--output-dir', join(f.root, 'out')], async () => { runtimeLoads++; return fake.runtime }, noHttp)).rejects.toThrow(error)
      expect(existsSync(join(f.dir, '.opened'))).toBe(false)
      expect(existsSync(join(f.root, 'out'))).toBe(false)
    }
    expect(runtimeLoads).toBe(0); expect(fake.calls()).toBe(0)
  } finally { f.clean() }
})
test('split parsing is opt-in and holdout region split mismatch never creates a marker', () => {
  const f = fixture()
  try {
    expect(() => parseRegionDataset(f.dataset)).toThrow('dataset')
    expect(parseRegionDataset(f.dataset, 'holdout')).toEqual(f.dataset)
    expect(() => parseRegionLabels(f.labels, f.dataset)).toThrow('labels')
    expect(parseRegionLabels(f.labels, f.dataset, 'holdout')).toEqual(f.labels)
    const dev = generateCompactionLongDev()
    expect(parseRegionDataset(dev.dataset)).toEqual(dev.dataset)
    expect(parseRegionLabels(dev.labels, dev.dataset)).toEqual(dev.labels)
    expect(() => parseRegionDataset(dev.dataset, 'holdout')).toThrow('dataset')
    expect(() => parseRegionLabels(dev.labels, dev.dataset, 'holdout')).toThrow('labels')
    const regions = JSON.stringify({ ...f.dataset, split: 'dev' })
    writeFileSync(join(f.dir, 'regions.json'), regions)
    expect(() => prepareHoldout(f.dir, holdoutHash(Buffer.from(regions), Buffer.from(f.gold)), false)).toThrow('dataset')
    expect(existsSync(join(f.dir, '.opened'))).toBe(false)
  } finally { f.clean() }
})
test('every holdout request excludes preflight labels and noise metadata', async () => {
  const f = fixture(), fake = fakeRuntime()
  try {
    await run([...liveArgs, ...f.args, '--output-dir', join(f.root, 'out')], async () => fake.runtime, noHttp)
    expect(fake.requests).toHaveLength(f.dataset.regions.length)
    for (const request of fake.requests) {
      const text = JSON.stringify(request)
      expect(text).not.toMatch(/"labels"|"noiseKind"|"split"|same-topic|filler/)
      for (const row of Object.values(f.labels.labels)) expect(text).not.toContain(JSON.stringify(row))
    }
  } finally { f.clean() }
})
test('caps and output guards refuse before opening or classification', async () => {
  const f = fixture(), fake = fakeRuntime()
  try {
    await expect(run([...liveArgs.map(x => x === '120' ? '1' : x), ...f.args], async () => fake.runtime, noHttp)).rejects.toThrow('caps')
    await expect(run([...liveArgs, ...f.args, '--output-dir', join(import.meta.dir, 'forbidden')], async () => fake.runtime, noHttp)).rejects.toThrow('outside Git')
    expect(existsSync(join(f.dir, '.opened'))).toBe(false); expect(fake.calls()).toBe(0)
  } finally { f.clean() }
})
test('transport failure consumes marker and retains full-region fallback; no retry', async () => {
  const f = fixture(), fake = fakeRuntime(undefined, true), oldExit = process.exitCode
  try {
    await run([...liveArgs, ...f.args, '--output-dir', join(f.root, 'out')], async () => fake.runtime, noHttp)
    expect(fake.calls()).toBe(1)
    expect(process.exitCode).toBe(1)
    expect(existsSync(join(f.dir, '.opened'))).toBe(true)
    const report = JSON.parse(readFileSync(join(f.root, 'out', 'report.json'), 'utf8'))
    expect(report.complete).toBe(false); expect(report.overall.neededItemRetention.rate).toBe(1)
  } finally { process.exitCode = oldExit ?? 0; f.clean() }
})
