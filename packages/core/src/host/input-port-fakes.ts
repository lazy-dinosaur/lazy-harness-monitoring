import { canonicalJsonHash } from '../sdk/canonical-json.ts'
import { freezeMonitoringData } from '../sdk/diagnostics.ts'
import { InputPortContextSchema, sameInputPortScope, validatePortData, validateReadRecord, validateReadRecordRequest, validateReadRecordSnapshot, validateReviewCandidate, type InputPortContext, type ReadRecord, type ReadRecordPort, type ReadRecordRequest, type ReadRecordSnapshot, type ReviewCandidate, type ReviewSinkPort, type ReviewSinkReceipt } from './input-ports.ts'

export type InputPortFakeOptions = Readonly<{ context: () => InputPortContext | undefined; maxItems?: number; maxBytes?: number }>
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
function bounds(o: InputPortFakeOptions, items: number) {
  const maxItems = o.maxItems ?? items, maxBytes = o.maxBytes ?? 1048576
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > items || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) throw Error('Invalid input-port bounds')
  return { maxItems, maxBytes }
}
function contextReader(o: InputPortFakeOptions, reset: () => void) {
  let key: string | undefined
  return () => {
    const raw = o.context(), c = raw ? validatePortData<InputPortContext>(InputPortContextSchema, raw) : undefined
    const next = c ? canonicalJsonHash([c.scope, c.sourceRevision, c.grantRevision, c.available]) : undefined
    if (key !== next) { reset(); key = next }
    return c
  }
}
const matches = (c: InputPortContext | undefined, r: { scope: ReadRecord['scope']; sourceRevision: string; grantRevision: string }) => !!c && c.available && sameInputPortScope(c.scope, r.scope) && c.sourceRevision === r.sourceRevision && c.grantRevision === r.grantRevision
/** Synthetic metadata source only. Caller must supply exposure attestation; tool success is never inferred. */
export function createInMemoryReadRecordPort(options: InputPortFakeOptions & { beforeSnapshot?: () => Promise<void> }) {
  const limits = bounds(options, 4096), records = new Map<string, ReadRecord>()
  let used = 0, revision = 0, incomplete = false, pending = false, closed = false
  const current = contextReader(options, () => { records.clear(); used = 0; incomplete = false; revision++ })
  const port: ReadRecordPort = Object.freeze({ protocolVersion: 1,
    async snapshot(input: ReadRecordRequest) {
      const r = validateReadRecordRequest(input), c = current(), captured = revision
      const busy = pending
      const make = (status: ReadRecordSnapshot['status']) => validateReadRecordSnapshot({ protocolVersion: 1, scope: r.scope, sourceRevision: r.sourceRevision, grantRevision: r.grantRevision, snapshotRevision: String(captured), completeThroughCursor: c?.completeThroughCursor ?? 0, status, records: status === 'available' ? [...records.values()] : [] })
      if (busy || closed || r.signal?.aborted || incomplete || !matches(c, r)) return make('unavailable')
      pending = true
      try {
        await options.beforeSnapshot?.()
        const now = current()
        if (closed || r.signal?.aborted || !matches(now, r) || captured !== revision) return make('stale')
        return make(!incomplete && c!.completeThroughCursor >= r.cursor ? 'available' : 'unavailable')
      } finally { pending = false }
    },
    isCurrent(r: ReadRecordRequest, s: ReadRecordSnapshot) {
      const c = current()
      return !closed && !incomplete && !r.signal?.aborted && matches(c, r) && s.snapshotRevision === String(revision) && c!.completeThroughCursor >= r.cursor
    },
  })
  return Object.freeze({ port,
    record(input: ReadRecord): boolean {
      const r = validateReadRecord(input), c = current()
      if (closed || !matches(c, r) || incomplete || r.cursor > c!.completeThroughCursor) return false
      const key = canonicalJsonHash([r.scope, r.documentId, r.documentVersion, r.sourceEventId]), old = records.get(key)
      if (old) return canonicalJsonHash(old) === canonicalJsonHash(r)
      const size = bytes(r)
      if (records.size >= limits.maxItems || used + size > limits.maxBytes) { incomplete = true; revision++; return false }
      records.set(key, r); used += size; revision++; return true
    },
    close() { closed = true; records.clear(); used = 0; revision++ },
  })
}
/** Volatile private review, never connected to parent delivery or a read ledger. No I/O. */
export function createInMemoryReviewSinkPort(options: InputPortFakeOptions) {
  const limits = bounds(options, 128), entries = new Map<string, { candidate: ReviewCandidate; receipt: ReviewSinkReceipt; hash: string }>()
  let used = 0, closed = false
  const current = contextReader(options, () => { entries.clear(); used = 0 })
  const port: ReviewSinkPort = Object.freeze({ protocolVersion: 1, retention: 'volatile',
    async enqueue(input: ReviewCandidate, signal?: AbortSignal): Promise<ReviewSinkReceipt> {
      const c = validateReviewCandidate(input), context = current()
      const refuse = (reason: string): ReviewSinkReceipt => Object.freeze({ protocolVersion: 1, candidateId: c.candidateId, status: 'refused', reason })
      if (closed || signal?.aborted || !matches(context, c)) return refuse('scope-source-grant-unavailable')
      const old = entries.get(c.dedupeKey), hash = canonicalJsonHash(c)
      if (old) return old.hash === hash ? old.receipt : refuse('identity-mutation')
      if ([...entries.values()].some(x => x.candidate.candidateId === c.candidateId)) return refuse('candidate-id-reused')
      const size = bytes(c)
      if (entries.size >= limits.maxItems || used + size > limits.maxBytes) return refuse('capacity')
      const receipt: ReviewSinkReceipt = Object.freeze({ protocolVersion: 1, candidateId: c.candidateId, status: 'accepted-volatile' })
      entries.set(c.dedupeKey, { candidate: c, receipt, hash }); used += size
      return receipt
    },
  })
  return Object.freeze({ port,
    inspect(): readonly ReviewCandidate[] { current(); return freezeMonitoringData([...entries.values()].map(x => x.candidate)) },
    close() { closed = true; entries.clear(); used = 0 },
  })
}
