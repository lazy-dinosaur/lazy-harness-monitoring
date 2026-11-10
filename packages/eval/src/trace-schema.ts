import { canonicalJson, canonicalJsonHash } from '@lazy-harness/monitoring-core'
import { array, enumeration, hashSchema, idSchema, integer, object, parse, type Schema } from './schema.ts'
import type { TraceRecord } from './replay.ts'

const content = object({ hash: hashSchema, bytes: integer(0, 2_000_000), body: {} }, ['body'])
const bool: Schema = { type: 'boolean' }
const latency: Schema = { anyOf: [{ type: 'null' }, integer(0, 100000)] }
const material = object({ id: idSchema, kind: idSchema, version: idSchema, provenance: object({ owner: enumeration('host', 'observation'), observationId: { anyOf: [{ type: 'null' }, idSchema] }, sessionId: idSchema, binding: integer(1, Number.MAX_SAFE_INTEGER), sourceEvent: { anyOf: [{ const: '' }, idSchema] }, cursor: { anyOf: [{ type: 'null' }, integer(1, Number.MAX_SAFE_INTEGER)] }, step: integer(0, Number.MAX_SAFE_INTEGER), stage: enumeration('event-hook', 'partial', 'final-hook', 'host-provided') }), content })
const receipt = object({ reportId: hashSchema, status: { const: 'delivered' }, kind: enumeration('hook-boundary', 'private-candidate'), boundary: { const: 'context_with_system' }, evidence: { const: 'synthetic' } }, ['boundary'])
export const traceRecordJsonSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:monitoring-eval:trace:v1', ...object({
  schemaVersion: { const: 'monitoring-eval-trace/v1' }, manifestHash: hashSchema, opportunityId: { type: 'string', pattern: '^[a-zA-Z0-9._:-]+/[a-zA-Z0-9._:-]+$' }, frameIndex: integer(0, 511), moduleId: idSchema, frameId: idSchema, sourceEvent: idSchema,
  input: content, provenance: object({ sessionId: idSchema, binding: integer(1, Number.MAX_SAFE_INTEGER), epoch: integer(0, Number.MAX_SAFE_INTEGER), cursor: integer(1, Number.MAX_SAFE_INTEGER), snapshotRevision: idSchema, canonicalHash: hashSchema }),
  trigger: object({ matchedPoints: array(idSchema, 32), admittedPoints: array(idSchema, 32), unavailable: bool }),
  selection: object({ status: array(idSchema, 32), considered: array(material, 32), selected: array(material, 32) }),
  judgement: object({ mode: enumeration('run', 'skip', 'defer', 'none'), inputs: array(content, 8), raw: array(content, 8) }),
  work: object({ verification: array(object({ task: content, result: content }), 8), dispatched: array(content, 16), completion: array(object({ status: enumeration('completed', 'failed', 'timed-out', 'cancelled', 'refused'), certainty: enumeration('terminal', 'uncertain'), value: content }), 16), outcomes: array(object({ status: enumeration('executed', 'proposed', 'prepared', 'rejected', 'uncertain', 'skipped'), reason: content }), 16) }),
  report: object({ enqueue: array(object({ reportId: hashSchema, status: enumeration('enqueued', 'failed', 'unknown') }), 16), delivery: array(receipt, 16), censored: bool }),
  cancellation: object({ requested: bool, observed: bool }), proposed: bool, received: bool,
  latency: object({ unit: { const: 'logical-ms' }, captureToJudge: latency, judgeToWorker: latency, workerToReady: latency, readyToReceipt: latency, endToEnd: latency }),
  cost: object({ kind: { const: 'stub-estimate' }, judgeCalls: integer(0, 16), verifierCalls: integer(0, 8), workerCalls: integer(0, 16), usd: { type: 'number', minimum: 0, maximum: 32 } }),
}) }
export function validateTraceRecord(input: TraceRecord, consent: boolean): void {
  // Validate each bounded row before trusting identity or content fields.
  const r = parse<TraceRecord>(traceRecordJsonSchema, input)
  if (r.cost.verifierCalls !== r.work.verification.length || r.cost.judgeCalls !== r.judgement.inputs.length + r.cost.verifierCalls) throw new Error('judge/verifier call accounting mismatch')
  for (const [key, value] of Object.entries(r.latency)) if (key !== 'unit' && value !== null && (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100000)) throw new Error('invalid logical latency')
  for (const m of r.selection.selected) {
    const p = m.provenance as { observationId: unknown; sourceEvent: unknown; cursor: unknown }
    if (p.observationId !== null) parse(idSchema, p.observationId)
    if (p.sourceEvent !== '') parse(idSchema, p.sourceEvent)
    if (p.cursor !== null) parse(integer(1, Number.MAX_SAFE_INTEGER), p.cursor)
  }
  for (const receipt of r.report.delivery) if ((receipt.kind === 'hook-boundary') !== ('boundary' in receipt)) throw new Error('invalid receipt kind/boundary')
  const identities = [r.input, ...r.selection.considered.map(m => m.content), ...r.selection.selected.map(m => m.content), ...r.judgement.inputs, ...r.judgement.raw, ...r.work.verification.flatMap(v => [v.task, v.result]), ...r.work.dispatched, ...r.work.completion.map(c => c.value), ...r.work.outcomes.map(o => o.reason)]
  for (const c of identities) {
    if (!consent && Object.hasOwn(c, 'body')) throw new Error('body without explicit consent')
    if (Object.hasOwn(c, 'body') && (canonicalJsonHash(c.body) !== c.hash || Buffer.byteLength(canonicalJson(c.body)) !== c.bytes)) throw new Error('content identity mismatch')
  }
}
