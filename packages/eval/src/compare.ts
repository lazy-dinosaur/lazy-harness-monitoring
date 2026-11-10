import { canonicalJsonHash } from '@lazy-harness/monitoring-core'
import type { RunArtifact, TraceRecord } from './replay.ts'
import { score, verifyArtifact, type Labels } from './score.ts'

export function compare(baseline: RunArtifact, candidate: RunArtifact, labels?: Labels) {
  verifyArtifact(baseline); verifyArtifact(candidate)
  if (canonicalJsonHash(baseline.manifest.dataset) !== canonicalJsonHash(candidate.manifest.dataset)) throw new Error('comparison requires the same versioned dataset and split')
  const before = new Map(baseline.trace.map(r => [r.opportunityId, r])), after = new Map(candidate.trace.map(r => [r.opportunityId, r]))
  const fingerprints = (r: TraceRecord) => ({
    trigger: r.trigger,
    selection: { status: r.selection.status, considered: r.selection.considered.map(m => ({ id: m.id, version: m.version, hash: m.content.hash })), selected: r.selection.selected.map(m => ({ id: m.id, version: m.version, hash: m.content.hash, provenance: m.provenance })) },
    judgement: { mode: r.judgement.mode, raw: r.judgement.raw.map(v => v.hash), inputs: r.judgement.inputs.map(v => v.hash) },
    worker: { dispatched: r.work.dispatched.map(v => v.hash), completion: r.work.completion.map(c => ({ status: c.status, certainty: c.certainty, hash: c.value.hash })), outcomes: r.work.outcomes.map(o => ({ status: o.status, reasonHash: o.reason.hash })), cancellation: r.cancellation },
    delivery: r.report,
  })
  const changed = [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(id => {
    const a = before.get(id), b = after.get(id)
    if (!a || !b) return [{ opportunityId: id, reasons: ['trigger'], before: a ? { proposed: a.proposed, received: a.received } : null, after: b ? { proposed: b.proposed, received: b.received } : null }]
    const fa = fingerprints(a), fb = fingerprints(b)
    const reasons = (Object.keys(fa) as (keyof typeof fa)[]).filter(k => canonicalJsonHash(fa[k]) !== canonicalJsonHash(fb[k]))
    return reasons.length ? [{ opportunityId: id, reasons,
      details: reasons.map(stage => ({ stage, beforeHash: canonicalJsonHash(fa[stage]), afterHash: canonicalJsonHash(fb[stage]) })),
      before: { proposed: a.proposed, received: a.received, judgement: a.judgement.mode, selected: a.selection.selected.map(m => ({ id: m.id, version: m.version })), worker: a.work.completion.map(c => ({ status: c.status, certainty: c.certainty })), receipts: a.report.delivery.map(r => r.kind) },
      after: { proposed: b.proposed, received: b.received, judgement: b.judgement.mode, selected: b.selection.selected.map(m => ({ id: m.id, version: m.version })), worker: b.work.completion.map(c => ({ status: c.status, certainty: c.certainty })), receipts: b.report.delivery.map(r => r.kind) },
    }] : []
  })
  // Only identity keys, hashes, enum reasons, counts and caller-owned slice IDs are exported. Never copy trace bodies.
  return { schemaVersion: 'monitoring-eval-compare/v1', baseline: { runId: baseline.manifest.runId, manifestHash: canonicalJsonHash(baseline.manifest) }, candidate: { runId: candidate.manifest.runId, manifestHash: canonicalJsonHash(candidate.manifest) }, dataset: baseline.manifest.dataset, changed,
    manifestChanges: ['codeCommit', 'packageVersions', 'modules', 'configHash', 'stubOutputsHash', 'seed', 'clockMode', 'limits', 'contentConsent'].filter(k => canonicalJsonHash(baseline.manifest[k as keyof typeof baseline.manifest]) !== canonicalJsonHash(candidate.manifest[k as keyof typeof candidate.manifest])),
    ...(labels ? { errors: { baseline: score(baseline, labels).modules.map(m => ({ moduleId: m.moduleId, errors: m.errors, slices: m.slices })), candidate: score(candidate, labels).modules.map(m => ({ moduleId: m.moduleId, errors: m.errors, slices: m.slices })) } } : {}) }
}
