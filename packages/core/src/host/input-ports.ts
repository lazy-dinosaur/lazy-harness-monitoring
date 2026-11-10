import Type, { type Static, type TSchema } from 'typebox'
import Value from 'typebox/value'
import { freezeMonitoringData } from '../sdk/diagnostics.ts'

const strict = { additionalProperties: false } as const
const text = () => Type.String({ minLength: 1, maxLength: 512 })
const count = () => Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
export const InputPortScopeSchema = Type.Object({ sessionId: text(), bindingGeneration: count(), branchId: text(), branchGeneration: count(), compactionGeneration: count() }, strict)
export type InputPortScope = Readonly<Static<typeof InputPortScopeSchema>>
/** Undefined scope fences before-hooks, failed compaction and disposal. No implicit carry. */
export type InputPortGenerationProvider = () => InputPortScope | undefined
export const InputPortContextSchema = Type.Object({ scope: InputPortScopeSchema, sourceRevision: text(), grantRevision: text(), completeThroughCursor: count(), available: Type.Boolean() }, strict)
export type InputPortContext = Readonly<Static<typeof InputPortContextSchema>>
export const ReadDocumentSchema = Type.Object({ documentId: text(), documentVersion: text() }, strict)
export type ReadDocument = Readonly<Static<typeof ReadDocumentSchema>>
export const ReadRecordSchema = Type.Object({ protocolVersion: Type.Literal(1), scope: InputPortScopeSchema,
  documentId: text(), documentVersion: text(), namespace: text(), sourceRecordId: text(), sourceRecordRevision: text(),
  sourceEventId: text(), cursor: count(), sourceRevision: text(), grantRevision: text(),
  exposure: Type.Object({ kind: Type.Union([Type.Literal('full'), Type.Literal('partial'), Type.Literal('unknown')]), attestationId: text() }, strict),
}, strict)
export type ReadRecord = Readonly<Static<typeof ReadRecordSchema>>
const RequestSchema = Type.Object({ protocolVersion: Type.Literal(1), scope: InputPortScopeSchema, sourceEventId: text(), cursor: count(), sourceRevision: text(), grantRevision: text(), documents: Type.Array(ReadDocumentSchema, { maxItems: 32 }) }, strict)
export type ReadRecordRequest = Readonly<Static<typeof RequestSchema>> & { readonly signal?: AbortSignal }
const SnapshotSchema = Type.Object({ protocolVersion: Type.Literal(1), scope: InputPortScopeSchema, sourceRevision: text(), grantRevision: text(),
  snapshotRevision: text(), completeThroughCursor: count(), status: Type.Union([Type.Literal('available'), Type.Literal('unavailable'), Type.Literal('stale')]),
  records: Type.Array(ReadRecordSchema, { maxItems: 4096 }),
}, strict)
export type ReadRecordSnapshot = Readonly<Static<typeof SnapshotSchema>>
export interface ReadRecordPort {
  readonly protocolVersion: 1
  snapshot(request: ReadRecordRequest): Promise<ReadRecordSnapshot>
  /** Revalidate captured scope, source, grant and snapshot revision immediately before use. */
  isCurrent(request: ReadRecordRequest, snapshot: ReadRecordSnapshot): boolean
}
export type ReadRecordLookup = Readonly<{ documentId: string; documentVersion: string; status: 'already-read' | 'not-read' | 'unknown'; sourceEventIds: readonly string[] }>
export const sameInputPortScope = (a: InputPortScope, b: InputPortScope) => a.sessionId === b.sessionId && a.bindingGeneration === b.bindingGeneration && a.branchId === b.branchId && a.branchGeneration === b.branchGeneration && a.compactionGeneration === b.compactionGeneration
export function validatePortData<T>(schema: TSchema, value: unknown, maxBytes = 1048576): T {
  // Refuse accessors/non-plain data before reading fields; independently bounded from configuration.
  let nodes = 0
  const seen = new Set<object>()
  const check = (v: unknown, depth: number): void => {
    if (++nodes > 262144 || depth > 16) throw Error('Input-port data bound')
    if (v === null || typeof v === 'boolean') return
    if (typeof v === 'string') { if (v.length > maxBytes) throw Error('Input-port string bound'); return }
    if (typeof v === 'number' && Number.isFinite(v)) return
    if (!v || typeof v !== 'object' || seen.has(v) || (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))) throw Error('Input-port data must be plain JSON')
    seen.add(v)
    if (Array.isArray(v) && Object.keys(v).length !== v.length) throw Error('Sparse input-port array')
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') continue
      const d = Object.getOwnPropertyDescriptor(v, key)!
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !d.enumerable || d.get || d.set) throw Error('Input-port data must be plain JSON')
      check(d.value, depth + 1)
    }
    seen.delete(v)
  }
  check(value, 0)
  const copy: unknown = JSON.parse(JSON.stringify(value))
  if (!Value.Check(schema, copy) || new TextEncoder().encode(JSON.stringify(copy)).length > maxBytes) throw Error('Invalid or oversized input-port data')
  return freezeMonitoringData(copy) as T
}
export function validateReadRecordRequest(request: ReadRecordRequest): ReadRecordRequest {
  if (!request || typeof request !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(request))) throw Error('Invalid read-record request')
  const descriptors = Object.getOwnPropertyDescriptors(request)
  const data: Record<string, unknown> = {}
  let signal: AbortSignal | undefined
  for (const key of Reflect.ownKeys(request)) {
    if (typeof key !== 'string') throw Error('Invalid read-record request field')
    const d = descriptors[key]
    if (!d.enumerable || d.get || d.set || ['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('Invalid read-record request field')
    if (key === 'signal') signal = d.value
    else data[key] = d.value
  }
  const copy = validatePortData<ReadRecordRequest>(RequestSchema, data)
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw Error('Invalid input-port cancellation signal')
  return Object.freeze({ ...copy, ...(signal ? { signal } : {}) })
}
export const validateReadRecord = (value: unknown) => validatePortData<ReadRecord>(ReadRecordSchema, value)
export const validateReadRecordSnapshot = (value: unknown) => validatePortData<ReadRecordSnapshot>(SnapshotSchema, value)
export function evaluateReadRecordSnapshot(request: ReadRecordRequest, snapshot: ReadRecordSnapshot): readonly ReadRecordLookup[] {
  const r = validateReadRecordRequest(request), s = validateReadRecordSnapshot(snapshot)
  const fresh = !r.signal?.aborted && s.status === 'available' && sameInputPortScope(r.scope, s.scope) && r.sourceRevision === s.sourceRevision && r.grantRevision === s.grantRevision && s.completeThroughCursor >= r.cursor && s.records.every(x => sameInputPortScope(x.scope, s.scope) && x.sourceRevision === s.sourceRevision && x.grantRevision === s.grantRevision && x.cursor <= s.completeThroughCursor)
  return freezeMonitoringData(r.documents.map(d => {
    const records = fresh ? s.records.filter(x => sameInputPortScope(x.scope, r.scope) && x.sourceRevision === r.sourceRevision && x.grantRevision === r.grantRevision && x.cursor <= r.cursor && x.documentId === d.documentId && x.documentVersion === d.documentVersion && x.exposure.kind === 'full') : []
    return { ...d, status: fresh ? records.length ? 'already-read' as const : 'not-read' as const : 'unknown' as const, sourceEventIds: records.map(x => x.sourceEventId) }
  }))
}

/** Neutral review envelope, not canonical memory storage or authorization. Exact spans only. */
export const ReviewCandidateSchema = Type.Object({ schemaVersion: Type.Literal('memory-candidate/v1'), candidateId: text(), scope: InputPortScopeSchema,
  sourceRevision: text(), grantRevision: text(), subjectKey: text(), dedupeKey: text(), status: Type.Literal('review-only'), notApproved: Type.Literal(true), notWritten: Type.Literal(true),
  claim: Type.Object({ kind: Type.Union([Type.Literal('project-fact'), Type.Literal('decision'), Type.Literal('constraint'), Type.Literal('preference')]), text: Type.String({ minLength: 1, maxLength: 2048 }), language: text() }, strict),
  project: Type.Optional(Type.Object({ id: text(), applicability: text() }, strict)),
  predecessorCandidateId: Type.Optional(text()), provenanceState: Type.Optional(Type.Literal('checked')), contested: Type.Optional(Type.Literal(false)), missingEvidence: Type.Optional(Type.Array(text(), { maxItems: 0 })),
  preparation: Type.Optional(Type.Object({ triggerId: text(), declarationHash: text(), questionHash: text(), configHash: text(), snapshotRevision: text(), stage: Type.Literal('shadow'), templateVersion: text() }, strict)),
  evidenceRefs: Type.Array(Type.Object({ documentId: text(), documentVersion: text(), sourceEventId: text(), sourceRevision: text(), grantRevision: text(), attestationId: text(), span: text(), namespace: Type.Optional(text()), actor: Type.Optional(text()), eventType: Type.Optional(text()), cursor: Type.Optional(count()), sourceRecordRevision: Type.Optional(text()), spanHash: Type.Optional(text()), role: Type.Optional(Type.Literal('supporting')) }, strict), { minItems: 1, maxItems: 8 }),
}, strict)
export type ReviewCandidate = Readonly<Static<typeof ReviewCandidateSchema>>
export type ReviewSinkReceipt = Readonly<{ protocolVersion: 1; candidateId: string; status: 'accepted-volatile' | 'refused' | 'unknown'; reason?: string }>
const ReviewSinkReceiptSchema = Type.Object({ protocolVersion: Type.Literal(1), candidateId: text(), status: Type.Union([Type.Literal('accepted-volatile'), Type.Literal('refused'), Type.Literal('unknown')]), reason: Type.Optional(text()) }, strict)
export function validateReviewSinkReceipt(value: unknown, expectedCandidateId?: string): ReviewSinkReceipt {
  const receipt = validatePortData<ReviewSinkReceipt>(ReviewSinkReceiptSchema, value, 4096)
  if (expectedCandidateId !== undefined && receipt.candidateId !== expectedCandidateId) throw Error('Review sink receipt identity mismatch')
  return receipt
}
export interface ReviewSinkPort {
  readonly protocolVersion: 1
  readonly retention: 'volatile'
  enqueue(candidate: ReviewCandidate, signal?: AbortSignal): Promise<ReviewSinkReceipt>
}
export function validateReviewCandidate(value: unknown): ReviewCandidate {
  const c = validatePortData<ReviewCandidate>(ReviewCandidateSchema, value, 16384)
  if (new TextEncoder().encode(c.claim.text).length > 2048 || c.evidenceRefs.some(e => e.sourceRevision !== c.sourceRevision || e.grantRevision !== c.grantRevision)) throw Error('Invalid review evidence or claim bound')
  return c
}

// Public schemas are immutable, just like the copied envelopes they validate.
for (const schema of [InputPortScopeSchema, InputPortContextSchema, ReadDocumentSchema, ReadRecordSchema, RequestSchema, SnapshotSchema, ReviewCandidateSchema, ReviewSinkReceiptSchema]) freezeMonitoringData(schema)
