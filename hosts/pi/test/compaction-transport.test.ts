import { describe, test, expect } from 'bun:test'
import { statSync, rmSync, mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MODEL, assertModel, assertOpenRouterJevOnly, createPiCompactionTransport, decodingProfile, estimateRequest, requestBody, type ClassifierModel, type ClassifierRuntime, type TransportReceipt } from '../src/eval/compaction-transport.ts'
import { parseRunArgs, estimateDataset, privateOutput, privateRecords, run, openRouterCredentialConfigured } from '../src/eval/compaction-run.ts'
import { parseRegionDataset, parseRegionLabels } from '../../../packages/eval/src/compaction-dataset.ts'
import { regionTask, evaluateCompaction, scoreCompaction } from '../../../packages/eval/src/compaction.ts'
import { createMeteredCompactionBinding } from '../../../packages/eval/src/compaction-meter.ts'
import { monitoringJudgeRequest, decodeMonitoringJudgements } from '../../../packages/core/src/sdk/model-adapters.ts'
const dataset = parseRegionDataset(await Bun.file(new URL('../../../packages/eval/data/compaction-dev/regions.json', import.meta.url)).json())
const labels = parseRegionLabels(await Bun.file(new URL('../../../packages/eval/data/compaction-dev/labels.json', import.meta.url)).json(), dataset)
const model: ClassifierModel = { type: 'classifier', id: 'typesafe/jev-1.14', name: 'Fake', provider: 'openrouter', api: 'typesafe-system-one', baseUrl: 'https://openrouter.ai/api/v1', input: ['text'], contextWindow: 262144, cost: { input: .042, output: 0, cacheRead: 0, cacheWrite: 0 } }
const tasks = [regionTask(dataset.regions[0]!)]
const invokeInput = () => ({ modelId: MODEL, tasks, signal: new AbortController().signal, maxUsd: .01, deadlineMs: performance.now() + 5000 })
const args = ['--approve-real-calls', '--model', MODEL, '--max-calls', '120', '--max-usd', '1', '--max-wall-min', '30']
function fixture(mode = 'ok') {
  const requests: unknown[] = [], options: any[] = [], receipts: TransportReceipt[] = [], http: RequestInit[] = []
  const fakeHttp = Object.assign(async (_url: any, init: any) => { http.push(init); return new Response('{}') }, { preconnect() {} }) as unknown as typeof fetch
  const runtime: ClassifierRuntime = { async classify(m, body, o) {
    requests.push(structuredClone(body)); options.push(o)
    await o!.onPayload!({ model: m.id, ...body }, m)
    if (mode === 'oversize') await o!.onPayload!({ pad: 'x'.repeat(1000000) }, m)
    await o!.fetch!('https://openrouter.ai/api/v1/systemone', { method: 'POST' })
    if (mode === 'retry') await o!.fetch!('https://openrouter.ai/api/v1/systemone', { method: 'POST' })
    if (mode === 'throw') throw Error('synthetic failure')
    return { api: m.api, provider: m.provider, model: m.id, timestamp: 0, stopReason: mode === 'error' ? 'error' : 'stop', answers: Object.fromEntries(Object.entries(body.questions).map(([k, q]) => [k, q.type === 'choice' ? { type: 'choice', choice: 'run', confidence: .9, probabilities: { run: .9, skip: .1 } } : { type: 'bool', probability: .8 }])), ...(mode === 'missing' ? {} : { usage: { input: mode === 'excess' ? 1000000 : 100, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: mode === 'excess' ? 1000000 : 100, cost: { input: 999, output: 0, cacheRead: 0, cacheWrite: 0, total: 999 } } }) }
  } }
  const transport = createPiCompactionTransport(runtime, model, r => receipts.push({ ...r }), fakeHttp)
  return { transport, requests, options, receipts, http }
}
describe('Pi compaction transport: fake runtime and HTTP only', () => {
  test('core native request and decoding parity, catalog usage pricing, safe receipt', async () => {
    const f = fixture(), input = invokeInput(), result = await f.transport.invoke(input)
    expect(f.requests[0]).toEqual(monitoringJudgeRequest(tasks, 'native-classifier').body)
    expect(result.decisions).toEqual(decodeMonitoringJudgements(tasks, decodingProfile, { stopReason: 'stop', answers: Object.fromEntries(Object.keys((f.requests[0] as any).questions).map(k => [k, k.startsWith('decision_') ? { type: 'choice', choice: 'run', confidence: .9 } : { type: 'bool', probability: .8 }])) }))
    expect(result.costUsd).toBeCloseTo(100 * .042 / 1e6, 12)
    expect(f.options[0].maxRetries).toBe(0)
    expect(f.options[0].env).toEqual({ OPENROUTER_API_KEY: '' })
    expect(f.http).toHaveLength(1); expect(f.http[0]!.redirect).toBe('error')
    expect(f.receipts[0]).toMatchObject({ phase: 'reserved', status: 'uncertain', httpAttempts: 0 })
    expect(f.receipts[1]).toMatchObject({ phase: 'settled', status: 'ok', httpAttempts: 1, inputTokens: 100, outputTokens: 0, modelId: MODEL })
    expect(f.receipts[0]!.requestSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(f.receipts)).not.toContain('questions')
    expect(JSON.stringify(f.receipts)).not.toContain(dataset.regions[0]!.goal)
  })
  for (const mode of ['missing', 'throw', 'error', 'retry', 'oversize', 'excess']) test(`${mode}: uncertain receipt, no retry and permanent stop`, async () => {
    const f = fixture(mode)
    await expect(f.transport.invoke(invokeInput())).rejects.toThrow()
    await expect(f.transport.invoke(invokeInput())).rejects.toThrow('stopped')
    expect(f.requests).toHaveLength(1); expect(f.http.length).toBeLessThanOrEqual(1)
    expect(f.receipts).toHaveLength(2); expect(f.receipts[1]!.status).toBe('uncertain')
    expect(f.receipts[0]!.costUsd).toBe(f.receipts[0]!.reservedUsd)
  })
  test('refuses insufficient reservation, expired deadline and wrong model before classify', async () => {
    const f = fixture()
    for (const changed of [{ maxUsd: 1e-12 }, { deadlineMs: 0 }, { modelId: 'latest' }]) await expect(f.transport.invoke({ ...invokeInput(), ...changed })).rejects.toThrow()
    expect(f.requests).toHaveLength(0)
  })
  test('missing usage stops meter after one call, keeps reservation and scores fallback', async () => {
    const f = fixture('missing'), estimate = estimateDataset(dataset, model)
    const meter = createMeteredCompactionBinding(f.transport, { enabled: true, modelId: MODEL, maxCalls: 120, maxUsd: 1, maxWallMs: 1800000, perCallMaxUsd: estimate.perCallMaxUsd, perCallMaxMs: 45000 })
    const results = await evaluateCompaction(dataset, meter.judgeBatch, undefined, meter.costUsd)
    expect(f.requests).toHaveLength(1); expect(meter.status().stopped).toBe(true)
    expect(meter.receipts()).toHaveLength(1); expect(meter.receipts()[0]!.status).toBe('uncertain')
    expect(meter.costUsd()).toBeGreaterThan(0)
    expect(scoreCompaction(dataset, labels, results).overall.neededItemRetention.rate).toBe(1)
    expect(results.every(r => r.failed)).toBe(true)
  })
  test('all DEV requests are core-only and independent of gold labels', () => {
    const before = dataset.regions.map(r => requestBody([regionTask(r)]))
    const flipped = structuredClone(labels)
    for (const row of Object.values(flipped.labels)) for (const k of Object.keys(row)) row[k] = !row[k]
    scoreCompaction(dataset, flipped, dataset.regions.map(r => ({ regionId: r.id, purpose: r.purpose, keptIds: r.materials.map(m => m.id), skipped: false, failed: false, costUsd: 0, latencyMs: 0 })))
    expect(dataset.regions.map(r => requestBody([regionTask(r)]))).toEqual(before)
    expect(JSON.stringify(before)).not.toMatch(/"labels"|"needed"\s*:/)
    expect(before).toEqual(dataset.regions.map(r => monitoringJudgeRequest([regionTask(r)], 'native-classifier').body))
  })
  test('bytes/token estimates and context/pricing refusal', () => {
    const e = estimateRequest(tasks, model)
    expect(e.upperTokens).toBe(e.bytes + 4096)
    expect(e.reservedUsd).toBeGreaterThanOrEqual(e.upperTokens * .042 / 1e6)
    expect(estimateDataset(dataset, model).calls).toBe(60)
    expect(() => estimateRequest(tasks, { ...model, contextWindow: 1 })).toThrow()
    expect(() => estimateRequest(tasks, { ...model, cost: { ...model.cost, output: 1 } })).toThrow()
  })
})
describe('runner admission and private receipts', () => {
  test('real admission needs exact model, approval, and explicit bounded caps', async () => {
    expect(parseRunArgs(args).resolveOnly).toBe(false)
    for (const invalid of [[], args.slice(1), ['--model', MODEL, '--approve-real-calls'], args.map(x => x === MODEL ? 'openrouter/typesafe/jev-latest' : x), args.map(x => x === '120' ? '121' : x), args.map(x => x === '1' ? '1.01' : x), args.map(x => x === '30' ? '31' : x), [...args, '--max-usd', '1'], [...args, '--oops'], [...args, '--resolve-only']]) {
      expect(() => parseRunArgs(invalid)).toThrow()
    }
    // This path refuses before SDK import; no model/runtime is created.
    await expect(run([])).rejects.toThrow()
  })
  test('OpenRouter is Jev-only: other models and aliases are refused before any request', () => {
    for (const id of ['~liquid/d1-latest', '~typesafe/jev-latest', 'baseten/joey-1', 'typesafe/jev-1.14-preview', 'openai/gpt-4o']) {
      expect(() => assertOpenRouterJevOnly({ provider: 'openrouter', id })).toThrow('OpenRouter is used only for pinned TypeSafe Jev models')
      expect(() => assertModel({ ...model, id })).toThrow()
    }
    expect(() => assertOpenRouterJevOnly({ provider: 'openrouter', id: 'typesafe/jev-1.14' })).not.toThrow()
    expect(() => assertOpenRouterJevOnly({ provider: 'openrouter', id: 'typesafe/jev-1.13' })).not.toThrow()
    expect(() => assertModel(model)).not.toThrow()
    expect(() => assertModel({ ...model, id: 'typesafe/jev-1.13' })).toThrow('exact classifier/API/endpoint required')
  })
  test('stored OpenRouter api_key or oauth credential is accepted; other providers/types are not', () => {
    expect(openRouterCredentialConfigured([{ providerId: 'openrouter', type: 'oauth' }])).toBe(true)
    expect(openRouterCredentialConfigured([{ providerId: 'openrouter', type: 'api_key' }])).toBe(true)
    expect(openRouterCredentialConfigured([])).toBe(false)
    expect(openRouterCredentialConfigured([{ providerId: 'typesafe', type: 'api_key' }, { providerId: 'openai', type: 'oauth' }])).toBe(false)
    expect(openRouterCredentialConfigured([{ providerId: 'openrouter', type: 'env' }])).toBe(false)
  })
  test('resolve-only is explicit and cannot imply approval', () => {
    expect(parseRunArgs(['--resolve-only', '--model', MODEL]).resolveOnly).toBe(true)
    expect(() => parseRunArgs(['--resolve-only'])).toThrow()
  })
  test('private new output outside Git; no overwrite or worktree output', () => {
    const parent = mkdtempSync(join(tmpdir(), 'cmp-test-'))
    try {
      const dir = privateOutput(join(parent, 'run'))
      expect(statSync(dir).mode & 0o777).toBe(0o700)
      const records = privateRecords(dir)
      const receipt: TransportReceipt = { call: 1, phase: 'reserved', modelId: MODEL, requestSha256: 'a'.repeat(64), requestBytes: 10, upperTokens: 4106, reservedUsd: .001, costUsd: .001, httpAttempts: 0, latencyMs: 0, status: 'uncertain' }
      records.record(receipt); records.record({ ...receipt, phase: 'settled', status: 'ok' })
      records.save('manifest.json', { modelId: MODEL }); records.save('meter-receipts.json', []); records.save('report.json', { complete: true })
      expect(readFileSync(join(dir, 'transport-receipts.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s).phase)).toEqual(['reserved', 'settled'])
      for (const name of ['transport-receipts.jsonl', 'manifest.json', 'meter-receipts.json', 'report.json']) expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600)
      expect(() => privateOutput(dir)).toThrow()
      expect(() => privateOutput(join(process.cwd(), 'forbidden-eval-output'))).toThrow()
      expect(existsSync(join(process.cwd(), 'forbidden-eval-output'))).toBe(false)
    } finally { rmSync(parent, { recursive: true, force: true }) }
  })
  test('runner source records only hashes/metadata before labels are loaded', () => {
    const source = readFileSync(new URL('../src/eval/compaction-run.ts', import.meta.url), 'utf8')
    expect(source.indexOf('const labels =')).toBeGreaterThan(source.indexOf('const results = await evaluateCompaction'))
    expect(source).toContain("'transport-receipts.jsonl'")
    expect(source).toContain("'meter-receipts.json'")
    expect(source).toContain("'report.json'")
  })
})
