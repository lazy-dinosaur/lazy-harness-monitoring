import { canonicalJson, canonicalJsonHash } from '@lazy-harness/monitoring-core'
import { array, enumeration, hashSchema, idSchema, integer, object, parse } from './schema.ts'
import { parseManifest, type RunManifest } from './contracts.ts'
import type { RunArtifact, TraceRecord } from './replay.ts'
import { validateTraceRecord } from './trace-schema.ts'

export type Labels = { schemaVersion: 'monitoring-eval-labels/v1'; dataset: RunManifest['dataset']; opportunities: { moduleId: string; frameId: string; label: 'positive' | 'negative' | 'unresolved'; slices: string[] }[]; expectedTriggers: { moduleId: string; frameId: string; point: string }[] }
export function parseLabels(input: unknown): Labels {
  const labels = parse<Labels>(object({ schemaVersion: { const: 'monitoring-eval-labels/v1' }, dataset: object({ id: idSchema, version: idSchema, split: enumeration('dev', 'holdout'), hash: hashSchema }), opportunities: array(object({ moduleId: idSchema, frameId: idSchema, label: enumeration('positive', 'negative', 'unresolved'), slices: array(idSchema, 16) }), 4096, 1), expectedTriggers: array(object({ moduleId: idSchema, frameId: idSchema, point: idSchema }), 4096) }), input)
  for (const rows of [labels.opportunities, labels.expectedTriggers]) {
    const keys = rows.map(r => `${r.moduleId}/${r.frameId}${'point' in r ? '/' + r.point : ''}`)
    if (new Set(keys).size !== keys.length) throw new Error('duplicate scoring oracle identity')
  }
  return labels
}
// Artifacts are bounded, hash-bound receipts, not arbitrary executable replay input.
export function verifyArtifact(a: RunArtifact): void {
  parseManifest(a.manifest)
  if (a.traceHash !== canonicalJsonHash(a.trace) || a.retention.dropped !== 0) throw new Error('incomplete or corrupt trace; scoring/comparison refused')
  if (a.retention.bytes !== a.trace.reduce((n, r) => n + Buffer.byteLength(canonicalJson(r)), 0) || a.retention.bytes > a.manifest.limits.maxTraceBytes) throw new Error('trace byte bound mismatch')
  if (!Number.isSafeInteger(a.retention.bytes) || a.retention.bytes < 0 || a.trace.length > a.manifest.limits.maxRecords) throw new Error('invalid trace retention')
  const ids = new Set<string>(), mh = canonicalJsonHash(a.manifest)
  for (const r of a.trace) {
    validateTraceRecord(r, a.manifest.contentConsent)
    if (r.schemaVersion !== 'monitoring-eval-trace/v1' || r.manifestHash !== mh || r.opportunityId !== `${r.moduleId}/${r.frameId}` || ids.has(r.opportunityId) || !a.manifest.modules.some(m => m.id === r.moduleId)) throw new Error('invalid trace identity')
    ids.add(r.opportunityId)
  }
}
const ratio = (n: number, d: number): number | null => d ? n / d : null
export function confusion(rows: { label: 'positive' | 'negative' | 'unresolved'; positive: boolean }[]) {
  let TP = 0, FP = 0, FN = 0, TN = 0, unresolvedRun = 0, unresolvedSilent = 0
  for (const r of rows) {
    if (r.label === 'unresolved') { if (r.positive) unresolvedRun++; else unresolvedSilent++ }
    else if (r.label === 'positive') { if (r.positive) TP++; else FN++ }
    else { if (r.positive) FP++; else TN++ }
  }
  return { TP, FP, FN, TN, unresolvedRun, unresolvedSilent, precision: ratio(TP, TP + FP), recall: ratio(TP, TP + FN), falseDiscoveryFraction: ratio(FP, TP + FP), falsePositiveRate: ratio(FP, FP + TN), denominators: { emittedLabeled: TP + FP, labeledPositive: TP + FN, labeledNegative: FP + TN, resolved: TP + FP + FN + TN } }
}
export function quantiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const q = (p: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null
  return { samples: sorted.length, p50: q(0.5), p95: q(0.95) }
}
export function score(artifact: RunArtifact, input: Labels) {
  verifyArtifact(artifact); const labels = parseLabels(input)
  if (canonicalJsonHash(labels.dataset) !== canonicalJsonHash(artifact.manifest.dataset) || [...labels.opportunities, ...labels.expectedTriggers].some(o => !artifact.manifest.modules.some(m => m.id === o.moduleId))) throw new Error('scoring dataset/module mismatch')
  const byId = new Map(artifact.trace.map(r => [r.opportunityId, r]))
  return { schemaVersion: 'monitoring-eval-score/v1', runId: artifact.manifest.runId, traceHash: artifact.traceHash, labelsHash: canonicalJsonHash(labels), modules: artifact.manifest.modules.map(m => {
    const oracle = labels.opportunities.filter(o => o.moduleId === m.id), observed = artifact.trace.filter(r => r.moduleId === m.id)
    const rows = oracle.map(o => ({ ...o, trace: byId.get(`${o.moduleId}/${o.frameId}`) }))
    const expected = labels.expectedTriggers.filter(o => o.moduleId === m.id).map(o => `${o.moduleId}/${o.frameId}/${o.point}`)
    const actual = observed.flatMap(r => r.trigger.admittedPoints.map(p => `${r.moduleId}/${r.frameId}/${p}`))
    const remaining = [...expected], extra: string[] = []
    for (const key of actual) { const i = remaining.indexOf(key); if (i < 0) extra.push(key); else remaining.splice(i, 1) }
    const emitted = rows.filter(r => r.trace?.proposed), received = rows.filter(r => r.trace?.received)
    const totalUsd = observed.reduce((n, r) => n + r.cost.usd, 0)
    const errors = rows.filter(r => r.label === 'unresolved' || (r.label === 'positive') !== (r.trace?.proposed ?? false) || (r.label === 'positive' && !r.trace?.received)).map(r => ({
      opportunityId: `${r.moduleId}/${r.frameId}`, label: r.label, predicted: r.trace?.proposed ?? false, received: r.trace?.received ?? false, slices: r.slices,
      reason: !r.trace ? 'missing-opportunity' : !r.trace.trigger.admittedPoints.length ? 'trigger' : r.trace.judgement.mode !== 'run' ? 'judgement' : !r.trace.selection.selected.length ? 'selection' : r.trace.proposed && !r.trace.received ? 'delivery' : 'worker',
    }))
    const slices = [...new Set(oracle.flatMap(o => o.slices))].sort().map(slice => ({ slice, ...confusion(rows.filter(r => r.slices.includes(slice)).map(r => ({ label: r.label, positive: r.trace?.proposed ?? false }))) }))
    return { moduleId: m.id, opportunities: oracle.length, observedRecords: observed.length, proposal: confusion(rows.map(r => ({ label: r.label, positive: r.trace?.proposed ?? false }))), received: confusion(rows.map(r => ({ label: r.label, positive: r.trace?.received ?? false }))),
      triggers: { expected: expected.length, actual: actual.length, missed: remaining, extra, outOfScopeRawFrames: observed.filter(r => !r.trigger.matchedPoints.length).length, unavailable: observed.filter(r => r.trigger.unavailable).length },
      receipts: { expectedForProposals: emitted.length, received: received.length, success: ratio(received.length, emitted.length), censored: observed.filter(r => r.report.censored).length, enqueueFailed: observed.flatMap(r => r.report.enqueue).filter(r => r.status !== 'enqueued').length },
      latency: { unit: 'logical-ms', endToEnd: quantiles(observed.flatMap(r => r.latency.endToEnd === null ? [] : [r.latency.endToEnd])), censored: observed.filter(r => r.report.censored).length, stages: Object.fromEntries(['captureToJudge', 'judgeToWorker', 'workerToReady', 'readyToReceipt'].map(k => [k, quantiles(observed.flatMap(r => { const n = r.latency[k as keyof TraceRecord['latency']]; return typeof n === 'number' ? [n] : [] }))])) },
      cost: { kind: 'stub-estimate', totalUsd, opportunityDenominator: oracle.length, usdPer100Opportunities: oracle.length ? totalUsd / oracle.length * 100 : null, judgeCalls: observed.reduce((n, r) => n + r.cost.judgeCalls, 0), verifierCalls: observed.reduce((n, r) => n + r.cost.verifierCalls, 0), workerCalls: observed.reduce((n, r) => n + r.cost.workerCalls, 0) },
      missingOpportunities: rows.filter(r => !r.trace).map(r => `${r.moduleId}/${r.frameId}`), unlabeledProposals: observed.filter(r => r.proposed && !oracle.some(o => o.frameId === r.frameId)).map(r => r.opportunityId), errors, slices }
  }) }
}
