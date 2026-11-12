import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { createHash } from 'node:crypto'
import { planRegionCompaction } from '@lazy-harness/monitoring-core/engine/region-compaction.ts'
import { parseRegionDataset, parseRegionLabels, type RegionDataset } from '../../../../packages/eval/src/compaction-dataset.ts'
import { validateDevDataset } from '../../../../packages/eval/src/compaction-generate-dev.ts'
import { validateLongDevDiversity } from '../../../../packages/eval/test/compaction-long-dev-quality.ts'
import { evaluateCompaction, regionTask, scoreCompaction, wilson, type CompactionResult } from '../../../../packages/eval/src/compaction.ts'
import { createMeteredCompactionBinding } from '../../../../packages/eval/src/compaction-meter.ts'
import { MODEL, assertModel, createPiCompactionTransport, estimateRequest, type ClassifierModel, type ClassifierRuntime, type ItemProbability } from './compaction-transport.ts'

export function parseRunArgs(args: string[]) {
  const values = new Map<string, string>(), flags = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const k = args[i]!
    if (values.has(k) || flags.has(k)) throw Error('duplicate option')
    if (['--resolve-only', '--approve-real-calls'].includes(k)) flags.add(k)
    else if (['--model', '--max-calls', '--max-usd', '--max-wall-min', '--output-dir', '--dataset', '--holdout-dir', '--expect-sha256'].includes(k)) {
      const v = args[++i]
      if (!v || v.startsWith('--')) throw Error('missing option value')
      values.set(k, v)
    } else throw Error('unknown option')
  }
  if (values.get('--model') !== MODEL) throw Error('explicit exact --model openrouter/typesafe/jev-1.14 required')
  const resolveOnly = flags.has('--resolve-only')
  if (resolveOnly && flags.has('--approve-real-calls')) throw Error('resolve-only cannot approve calls')
  const maxCalls = Number(values.get('--max-calls')), maxUsd = Number(values.get('--max-usd')), maxWallMin = Number(values.get('--max-wall-min'))
  if (!resolveOnly || ['--max-calls', '--max-usd', '--max-wall-min'].some(k => values.has(k))) {
    if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 120 || !Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 1 || !Number.isFinite(maxWallMin) || maxWallMin <= 0 || maxWallMin > 30) throw Error('explicit caps required: calls <=120, USD <=1, minutes <=30')
  }
  if (!resolveOnly && !flags.has('--approve-real-calls')) throw Error('separate user approval and --approve-real-calls required')
  const dataset = values.get('--dataset') ?? 'dev'
  if (!['dev', 'long-dev', 'holdout'].includes(dataset)) throw Error('dataset must be dev, long-dev or holdout')
  const holdoutDir = values.get('--holdout-dir'), expectSha256 = values.get('--expect-sha256')
  if (dataset === 'holdout') {
    if (!holdoutDir || !isAbsolute(holdoutDir) || !expectSha256 || !/^[a-fA-F0-9]{64}$/.test(expectSha256)) throw Error('holdout requires absolute --holdout-dir and --expect-sha256 hex')
  } else if (holdoutDir !== undefined || expectSha256 !== undefined) throw Error('holdout options require --dataset holdout')
  return { dataset, holdoutDir, expectSha256: expectSha256?.toLowerCase(), resolveOnly, maxCalls, maxUsd, maxWallMs: maxWallMin * 60000, outputDir: values.get('--output-dir') }
}
export function estimateDataset(dataset: RegionDataset, model: ClassifierModel) {
  const estimates = dataset.regions.filter(r => !planRegionCompaction(r.materials, { frame: r.frame }).withinBudget).map(r => estimateRequest([regionTask(r)], model))
  return { regions: dataset.regions.length, calls: estimates.length, requestBytes: estimates.reduce((n, e) => n + e.bytes, 0), estimatedTokens: estimates.reduce((n, e) => n + e.estimatedTokens, 0), estimatedUsd: estimates.reduce((n, e) => n + e.estimatedTokens * model.cost.input / 1e6, 0), upperTokens: estimates.reduce((n, e) => n + e.upperTokens, 0), upperUsd: estimates.reduce((n, e) => n + e.reservedUsd, 0), perCallMaxUsd: Math.max(1e-9, ...estimates.map(e => e.reservedUsd)) }
}
/** Reused for inputs and outputs; resolve symlinks before inspecting Git ancestors. */
export function outsideGit(path: string) {
  const resolved = realpathSync(path)
  for (let p = resolved; ; p = dirname(p)) {
    if (existsSync(join(p, '.git'))) throw Error('path must be outside Git')
    if (dirname(p) === p) break
  }
  return resolved
}
/** A new private directory only; refuse any Git ancestor, including worktrees and symlink escapes. */
export function privateOutput(requested?: string) {
  let output: string
  const parent = outsideGit(requested ? dirname(requested) : tmpdir())
  if (!requested) output = mkdtempSync(join(parent, 'compaction-measurement-'))
  else {
    if (!isAbsolute(requested) || existsSync(requested)) throw Error('output must be a new absolute directory')
    mkdirSync(requested, { mode: 0o700 }); output = realpathSync(requested)
  }
  chmodSync(output, 0o700)
  return output
}
export function privateRecords(output: string) {
  return {
    save(name: 'manifest.json' | 'meter-receipts.json' | 'report.json' | 'item-probabilities.json', value: unknown) {
      writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    },
    record(receipt: import('./compaction-transport.ts').TransportReceipt) {
      appendFileSync(join(output, 'transport-receipts.jsonl'), JSON.stringify(receipt) + '\n', { mode: 0o600 })
    },
  }
}
/** Stored Pi OpenRouter credential: an API key or the oauth credential from `/login openrouter` (refreshed by
 * Pi auth storage). Environment variables are never a fallback. Only provider/type metadata is inspected. */
export const openRouterCredentialConfigured = (credentials: readonly { providerId: string; type: string }[]) =>
  credentials.some(c => c.providerId === 'openrouter' && (c.type === 'api_key' || c.type === 'oauth'))
/** Diagnostic only (never the pass verdict): retention/noise removal recomputed offline from recorded per-item
 * probabilities at other thresholds. Unlabelled ids are ignored. */
export function thresholdSweep(items: readonly { id: string; probability: number }[], needed: ReadonlyMap<string, boolean>, thresholds = [0.1, 0.2, 0.3, 0.4, 0.5]) {
  return thresholds.map(threshold => {
    let keptNeeded = 0, totalNeeded = 0, droppedNoise = 0, totalNoise = 0
    for (const it of items) {
      const n = needed.get(it.id); if (n === undefined) continue
      const kept = it.probability >= threshold
      if (n) { totalNeeded++; if (kept) keptNeeded++ } else { totalNoise++; if (!kept) droppedNoise++ }
    }
    return { threshold, dropBelow: threshold, neededItemRetention: { numerator: keptNeeded, denominator: totalNeeded }, noiseRemoval: { numerator: droppedNoise, denominator: totalNoise } }
  })
}
/** Full offline policy sweep: units, pins, budget pressure and no-call regions match runtime. */
export async function budgetSweep(dataset: RegionDataset, labels: import('../../../../packages/eval/src/compaction-dataset.ts').RegionLabels, items: readonly ItemProbability[]) {
  const probabilities = Object.fromEntries(items.map(it => [it.id, it.probability]))
  return Promise.all([0.1, 0.2, 0.3, 0.4, 0.5].map(async dropBelow => {
    const rows = await evaluateCompaction(dataset, async tasks => Object.fromEntries(tasks.map(t => [t.processorId, { mode: 'run', reason: 'offline recorded probability replay', evidenceRefs: [], referenceProbabilities: probabilities }])), new AbortController().signal, () => 0, { dropBelow })
    return { dropBelow, ...scoreCompaction(dataset, labels, rows).overall }
  }))
}
export const frozenPolicy = Object.freeze({ budgetBytes: 8192, dropBelow: 0.2, pinNewest: 2 })
/** Exact raw bytes, no UTF-8 normalization or JSON reserialization. */
export const holdoutHash = (regions: Uint8Array, labels: Uint8Array) => createHash('sha256').update(regions).update('\n').update(labels).digest('hex')
export function prepareHoldout(dir: string, expected: string, resolveOnly: boolean) {
  if (!isAbsolute(dir)) throw Error('absolute holdout directory required')
  const root = outsideGit(dir), marker = join(root, '.opened')
  if (existsSync(marker)) throw Error('holdout already opened')
  const regions = readFileSync(outsideGit(join(root, 'regions.json')))
  // Resolve-only deliberately cannot verify the combined seal: it never reads labels.
  const sealedLabels = resolveOnly ? undefined : readFileSync(outsideGit(join(root, 'labels.json')))
  const sha256 = sealedLabels ? holdoutHash(regions, sealedLabels) : undefined
  if (sha256 !== undefined && sha256 !== expected.toLowerCase()) throw Error('holdout sha256 mismatch')
  const dataset = parseRegionDataset(JSON.parse(regions.toString('utf8')))
  if (!dataset.regions.length) throw Error('empty holdout')
  validateDevDataset(dataset)
  for (const r of dataset.regions) {
    if (r.materials.reduce((n, m) => n + Buffer.byteLength(m.content), 0) > 16384 || r.materials.some(m => Buffer.byteLength(m.content) > 8192)) throw Error('holdout exceeds LONG DEV window bounds')
  }
  return { dataset, identity: { sha256: sha256 ?? expected.toLowerCase(), regionCount: dataset.regions.length, sealVerified: !resolveOnly },
    open(output: string) {
      if (resolveOnly) throw Error('resolve-only cannot open holdout')
      // Exclusive creation is the admission lock. Never remove on failure, abort or crash.
      writeFileSync(marker, JSON.stringify({ openedAt: new Date().toISOString(), outputDir: output, sha256 }) + '\n', { flag: 'wx', mode: 0o600 })
    },
    loadLabels() {
      if (!sealedLabels) throw Error('resolve-only cannot load labels')
      const parsed = parseHoldoutLabels(JSON.parse(sealedLabels.toString('utf8')), dataset)
      validateLongDevDiversity(dataset, parsed.labels)
      for (const r of dataset.regions) for (const unit of planRegionCompaction(r.materials, { frame: r.frame }).units) {
        if (new Set(unit.members.map(m => parsed.labels.labels[r.id]![m.id])).size > 1) throw Error('inconsistent tool unit labels')
      }
      return parsed
    } }
}
/** Optional labels-only metadata: noiseKind[regionId][itemId] = nonempty kind. */
export function parseHoldoutLabels(value: unknown, dataset: RegionDataset) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid holdout labels')
  const { noiseKind, ...gold } = value as Record<string, unknown>
  const goldLabels = parseRegionLabels(gold, dataset)
  const kinds: Record<string, Record<string, string>> = Object.create(null)
  if (noiseKind !== undefined) {
    if (!noiseKind || typeof noiseKind !== 'object' || Array.isArray(noiseKind)) throw Error('invalid noiseKind')
    for (const [regionId, row] of Object.entries(noiseKind)) {
      if (!Object.hasOwn(goldLabels.labels, regionId) || !row || typeof row !== 'object' || Array.isArray(row)) throw Error('invalid noiseKind region')
      kinds[regionId] = Object.create(null)
      for (const [id, kind] of Object.entries(row)) {
        if (!Object.hasOwn(goldLabels.labels[regionId]!, id) || goldLabels.labels[regionId]![id] !== false || typeof kind !== 'string' || !kind.trim()) throw Error('invalid noiseKind item')
        Object.defineProperty(kinds[regionId], id, { value: kind, enumerable: true })
      }
    }
  }
  return { labels: goldLabels, noiseKind: kinds }
}
export function noiseRemovalByKind(labels: ReturnType<typeof parseHoldoutLabels>, results: CompactionResult[]) {
  const counts = new Map<string, { removed: number; total: number }>()
  for (const r of results) for (const [id, needed] of Object.entries(labels.labels.labels[r.regionId]!)) {
    if (needed) continue
    const kind = labels.noiseKind[r.regionId]?.[id] ?? 'unspecified', count = counts.get(kind) ?? { removed: 0, total: 0 }
    count.total++; if (!r.keptIds.includes(id)) count.removed++
    counts.set(kind, count)
  }
  return Object.fromEntries([...counts].map(([kind, c]) => [kind, wilson(c.removed, c.total)]))
}
type RunnerRuntime = ClassifierRuntime & { getModelOfType(type: 'classifier', provider: string, id: string): ClassifierModel | undefined; listCredentials(): Promise<readonly { providerId: string; type: string }[]> }
export async function run(args: string[], makeRuntime?: () => Promise<RunnerRuntime>, http = globalThis.fetch) {
  // Admission happens BEFORE loading the SDK, credentials, or dataset.
  const options = parseRunArgs(args)
  const holdout = options.dataset === 'holdout' ? prepareHoldout(options.holdoutDir!, options.expectSha256!, options.resolveOnly) : undefined
  const runtime: RunnerRuntime = makeRuntime ? await makeRuntime() : await (await import('@earendil-works/pi-coding-agent')).ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })
  const model = runtime.getModelOfType('classifier', 'openrouter', 'typesafe/jev-1.14')
  if (!model) throw Error('exact classifier not in SDK registry')
  assertModel(model)
  // listCredentials returns only providerId/type, never reads a key into this application.
  const authConfigured = openRouterCredentialConfigured(await runtime.listCredentials())
  const datasetText = holdout ? undefined : await Bun.file(new URL(`../../../../packages/eval/data/compaction-${options.dataset}/regions.json`, import.meta.url)).text()
  const dataset = holdout?.dataset ?? parseRegionDataset(JSON.parse(datasetText!)), estimate = estimateDataset(dataset, model)
  console.log(JSON.stringify({ provider: model.provider, id: model.id, api: model.api, pricing: model.cost, costUnit: 'USD per million tokens', contextWindow: model.contextWindow, authConfigured: authConfigured ? 'yes' : 'no', estimate, holdout: holdout?.identity, frozenPolicy }))
  if (options.resolveOnly) return
  if (!authConfigured) throw Error('stored Pi OpenRouter credential (api_key or oauth login) required; no environment fallback')
  if (estimate.calls > options.maxCalls || estimate.upperUsd > options.maxUsd || options.maxWallMs < 45000) throw Error('dataset exceeds approved caps')
  const output = privateOutput(options.outputDir)
  holdout?.open(output)
  const { save, record } = privateRecords(output)
  save('manifest.json', { schemaVersion: 1, modelId: MODEL, api: model.api, pricing: model.cost, datasetSha256: holdout?.identity.sha256 ?? createHash('sha256').update(datasetText!).digest('hex'), holdout: holdout?.identity, frozenPolicy, estimate, caps: options, startedAt: new Date().toISOString(), limitations: ['local reservations, not invoice-verified cost', 'abort is not remote cancellation', 'compaction only, not monitoring quality', 'author and operator are agents under the same user; not independent qualification'] })
  const probabilities: ItemProbability[] = []
  const transport = createPiCompactionTransport(runtime, model, record, http, p => { probabilities.push(...p) })
  const binding = createMeteredCompactionBinding(transport, { enabled: true, modelId: MODEL, maxCalls: options.maxCalls, maxUsd: options.maxUsd, maxWallMs: options.maxWallMs, perCallMaxUsd: estimate.perCallMaxUsd, perCallMaxMs: 45000 })
  // Preserve the scorer's full-region fallback; a stopped meter refuses all subsequent dispatches.
  const results = await evaluateCompaction(dataset, async (tasks, signal) => {
    try { return await binding.judgeBatch(tasks, signal) }
    finally { save('meter-receipts.json', binding.receipts()) }
  }, new AbortController().signal, binding.costUsd)
  const holdoutLabels = holdout?.loadLabels()
  const labels = holdoutLabels?.labels ?? parseRegionLabels(await Bun.file(new URL(`../../../../packages/eval/data/compaction-${options.dataset}/labels.json`, import.meta.url)).json(), dataset)
  const report = { holdout: holdout?.identity, frozenPolicy, noiseRemovalByKind: holdoutLabels ? noiseRemovalByKind(holdoutLabels, results) : undefined, backend: MODEL, network: true, complete: results.every(r => !r.failed), meter: binding.status(), ...scoreCompaction(dataset, labels, results) }
  save('item-probabilities.json', probabilities)
  const needed = new Map<string, boolean>(Object.values(labels.labels).flatMap(r => Object.entries(r)))
  Object.assign(report, { diagnosticThresholdSweep: thresholdSweep(probabilities, needed), diagnosticBudgetSweep: await budgetSweep(dataset, labels, probabilities) })
  save('report.json', report)
  console.log(JSON.stringify({ complete: report.complete, calls: binding.status().calls, costUsd: binding.costUsd(), overall: report.overall }))
  if (!report.complete) process.exitCode = 1
}
if (import.meta.main) run(process.argv.slice(2)).catch(() => { console.error('Compaction runner refused or stopped; inspect private receipts if created. No provider error details logged.'); process.exitCode = 1 })
