import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { createHash } from 'node:crypto'
import { planRegionCompaction } from '@lazy-harness/monitoring-core/engine/region-compaction.ts'
import { parseRegionDataset, parseRegionLabels, type RegionDataset } from '../../../../packages/eval/src/compaction-dataset.ts'
import { evaluateCompaction, regionTask, scoreCompaction } from '../../../../packages/eval/src/compaction.ts'
import { createMeteredCompactionBinding } from '../../../../packages/eval/src/compaction-meter.ts'
import { MODEL, assertModel, createPiCompactionTransport, estimateRequest, type ClassifierModel, type ItemProbability } from './compaction-transport.ts'

export function parseRunArgs(args: string[]) {
  const values = new Map<string, string>(), flags = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const k = args[i]!
    if (values.has(k) || flags.has(k)) throw Error('duplicate option')
    if (['--resolve-only', '--approve-real-calls'].includes(k)) flags.add(k)
    else if (['--model', '--max-calls', '--max-usd', '--max-wall-min', '--output-dir', '--dataset'].includes(k)) {
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
  if (!['dev', 'long-dev'].includes(dataset)) throw Error('dataset must be dev or long-dev')
  return { dataset, resolveOnly, maxCalls, maxUsd, maxWallMs: maxWallMin * 60000, outputDir: values.get('--output-dir') }
}
export function estimateDataset(dataset: RegionDataset, model: ClassifierModel) {
  const estimates = dataset.regions.filter(r => !planRegionCompaction(r.materials, { frame: r.frame }).withinBudget).map(r => estimateRequest([regionTask(r)], model))
  return { regions: dataset.regions.length, calls: estimates.length, requestBytes: estimates.reduce((n, e) => n + e.bytes, 0), estimatedTokens: estimates.reduce((n, e) => n + e.estimatedTokens, 0), estimatedUsd: estimates.reduce((n, e) => n + e.estimatedTokens * model.cost.input / 1e6, 0), upperTokens: estimates.reduce((n, e) => n + e.upperTokens, 0), upperUsd: estimates.reduce((n, e) => n + e.reservedUsd, 0), perCallMaxUsd: Math.max(1e-9, ...estimates.map(e => e.reservedUsd)) }
}
/** A new private directory only; refuse any Git ancestor, including worktrees and symlink escapes. */
export function privateOutput(requested?: string) {
  let output: string
  const parent = realpathSync(requested ? dirname(requested) : tmpdir())
  for (let p = parent; ; p = dirname(p)) {
    if (existsSync(join(p, '.git'))) throw Error('output must be outside Git')
    if (dirname(p) === p) break
  }
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
export async function run(args: string[]) {
  // Admission happens BEFORE loading the SDK, credentials, or dataset.
  const options = parseRunArgs(args)
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
  const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })
  const model = runtime.getModelOfType('classifier', 'openrouter', 'typesafe/jev-1.14')
  if (!model) throw Error('exact classifier not in SDK registry')
  assertModel(model)
  // listCredentials returns only providerId/type, never reads a key into this application.
  const authConfigured = openRouterCredentialConfigured(await runtime.listCredentials())
  const datasetText = await Bun.file(new URL(`../../../../packages/eval/data/compaction-${options.dataset}/regions.json`, import.meta.url)).text()
  const dataset = parseRegionDataset(JSON.parse(datasetText)), estimate = estimateDataset(dataset, model)
  console.log(JSON.stringify({ provider: model.provider, id: model.id, api: model.api, pricing: model.cost, costUnit: 'USD per million tokens', contextWindow: model.contextWindow, authConfigured: authConfigured ? 'yes' : 'no', estimate }))
  if (options.resolveOnly) return
  if (!authConfigured) throw Error('stored Pi OpenRouter credential (api_key or oauth login) required; no environment fallback')
  if (estimate.calls > options.maxCalls || estimate.upperUsd > options.maxUsd || options.maxWallMs < 45000) throw Error('dataset exceeds approved caps')
  const output = privateOutput(options.outputDir)
  const { save, record } = privateRecords(output)
  save('manifest.json', { schemaVersion: 1, modelId: MODEL, api: model.api, pricing: model.cost, datasetSha256: createHash('sha256').update(datasetText).digest('hex'), estimate, caps: options, startedAt: new Date().toISOString(), limitations: ['local reservations, not invoice-verified cost', 'abort is not remote cancellation', 'DEV compaction only, not monitoring quality'] })
  const probabilities: ItemProbability[] = []
  const transport = createPiCompactionTransport(runtime, model, record, globalThis.fetch, p => { probabilities.push(...p) })
  const binding = createMeteredCompactionBinding(transport, { enabled: true, modelId: MODEL, maxCalls: options.maxCalls, maxUsd: options.maxUsd, maxWallMs: options.maxWallMs, perCallMaxUsd: estimate.perCallMaxUsd, perCallMaxMs: 45000 })
  // Preserve the scorer's full-region fallback; a stopped meter refuses all subsequent dispatches.
  const results = await evaluateCompaction(dataset, async (tasks, signal) => {
    try { return await binding.judgeBatch(tasks, signal) }
    finally { save('meter-receipts.json', binding.receipts()) }
  }, new AbortController().signal, binding.costUsd)
  const labels = parseRegionLabels(await Bun.file(new URL(`../../../../packages/eval/data/compaction-${options.dataset}/labels.json`, import.meta.url)).json(), dataset)
  const report = { backend: MODEL, network: true, complete: results.every(r => !r.failed), meter: binding.status(), ...scoreCompaction(dataset, labels, results) }
  save('item-probabilities.json', probabilities)
  const needed = new Map<string, boolean>(Object.values(labels.labels).flatMap(r => Object.entries(r)))
  Object.assign(report, { diagnosticThresholdSweep: thresholdSweep(probabilities, needed), diagnosticBudgetSweep: await budgetSweep(dataset, labels, probabilities) })
  save('report.json', report)
  console.log(JSON.stringify({ complete: report.complete, calls: binding.status().calls, costUsd: binding.costUsd(), overall: report.overall }))
  if (!report.complete) process.exitCode = 1
}
if (import.meta.main) run(process.argv.slice(2)).catch(() => { console.error('Compaction runner refused or stopped; inspect private receipts if created. No provider error details logged.'); process.exitCode = 1 })
