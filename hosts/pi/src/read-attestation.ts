// Ported from lazy-harness b2c4ec3:
// packages/lazy-harness-pi/extensions/lazy-harness/monitoring/read-attestation.ts
// Project capture, catalog, namespace and record-path policy are injected, not imported.
import { createHash } from 'node:crypto'
import { InputPortContextSchema, validatePortData, validateReadRecord, type InputPortContext, type ReadRecord } from '@lazy-harness/monitoring-core/host'

/** Owner-selected serialization of the main-agent read tool, never sniffed from text. */
export type ReadTextFormat = 'pi-read-text-v1' | 'pi-hashline-edit-pro-v1' | 'unknown'
export type MainReadCall = Readonly<{
  toolCallId: string; toolName: string
  input: Readonly<{ path: string; offset?: number | string; limit?: number; anchors?: boolean }>
}>
export type MainReadResult = MainReadCall & Readonly<{
  isError?: boolean; is_error?: boolean; content: unknown; details?: unknown; structuredContent?: unknown
}>
/** Opaque host capture authority, not a filesystem root or document identity. */
export type ReadCaptureIdentity = Readonly<{ id: string; epoch: number }>
export type ReadAttestationDocument = Readonly<{
  documentId: string; documentVersion: string; namespace: string; sourceRecordId: string
}>
export type ReadAttestationCapture = Readonly<{ call: MainReadCall; cwd: string; identity: ReadCaptureIdentity }>
export type ReadResultAttestorOptions = Readonly<{
  context(): InputPortContext | undefined
  captureIdentity(): ReadCaptureIdentity | undefined
  format(): ReadTextFormat
  /** Trusted main-agent provenance is the caller's responsibility. Paths/permissions,
   * symlinks, containment, stable snapshots and capture freshness belong here.
   * Return undefined on uncertainty; never return cached receipt hashes as bytes. */
  capture(read: ReadAttestationCapture): Uint8Array | undefined
  /** Resolve only an admitted exact document version for these runtime bytes.
   * Namespace, document and source-record naming are entirely host policy. */
  resolveDocument(read: ReadAttestationCapture, sha256: string): ReadAttestationDocument | undefined
  /** Synchronous admission receipt, not delivery or evidence of parent understanding. */
  record(record: ReadRecord): boolean
}>
type Pending = ReadAttestationCapture & Readonly<{ callHash: string; context: InputPortContext; format: ReadTextFormat }>
const MAX_BYTES = 1024 * 1024, MAX_CALLS = 256
const digest = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex')
const callDigest = (c: MainReadCall) => digest(JSON.stringify([c.toolCallId, c.toolName, c.input]))
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const notice = /\[(?:Showing lines |\d+ more lines in file\.|Line \d+ is |Read truncated;)|Use offset=|content not shown|Non-UTF-8 bytes/
function bodyOf(text: string, format: ReadTextFormat): string | undefined {
  if (format === 'pi-read-text-v1') return text
  if (format !== 'pi-hashline-edit-pro-v1') return
  // HASH_CLASS = [a-z]{5}; fmtRow = anchor + U+2502 + text. No EOL repair.
  const rows = text.split('\n')
  if (!rows.every(row => /^[a-z]{5}│/.test(row))) return
  return rows.map(row => row.slice(6)).join('\n')
}
function classification(call: MainReadCall, result: MainReadResult, bytes: Buffer, format: ReadTextFormat) {
  const content = result.content
  if (!Array.isArray(content) || content.length !== 1 || !object(content[0]) || content[0].type !== 'text' || typeof content[0].text !== 'string') return { kind: 'unknown' as const }
  const text = content[0].text
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES * 2) return { kind: 'unknown' as const }
  const details = object(result.details) ? result.details : {}
  const metrics = object(details.metrics) ? details.metrics : {}
  const truncation = object(details.truncation) ? details.truncation : {}
  const structured = object(result.structuredContent) ? result.structuredContent : {}
  if (notice.test(text) || truncation.truncated === true || truncation.firstLineExceedsLimit === true ||
      metrics.truncated === true || details.nextOffset != null || metrics.next_offset != null ||
      structured.truncated === true || structured.nextOffset != null || structured.blockedByLongLine === true ||
      structured.hadUtf8DecodeErrors === true || (Array.isArray(structured.notices) && structured.notices.length)) return { kind: 'unknown' as const }
  const body = bodyOf(text, format)
  if (body === undefined) return { kind: 'unknown' as const }
  const bodyBytes = Buffer.from(body, 'utf8'), bodyHash = digest(bodyBytes), fileHash = digest(bytes)
  const file = bytes.toString('utf8')
  if (!Buffer.from(file, 'utf8').equals(bytes) || file.includes('\0')) return { kind: 'unknown' as const, bodyHash }
  const keysKnown = Object.keys(call.input).every(k => ['path', 'offset', 'limit', 'anchors'].includes(k))
  const offset = call.input.offset ?? 1, limit = call.input.limit
  const valid = keysKnown && Number.isSafeInteger(offset) && Number(offset) >= 1 && (limit === undefined || (Number.isSafeInteger(limit) && limit >= 1))
  if (!valid || format === 'unknown') return { kind: 'unknown' as const, bodyHash }
  const lines = file.split('\n')
  // Hashline omits the terminal empty row; plain Pi counts it. Never invent LF.
  if (format === 'pi-hashline-edit-pro-v1' && file.endsWith('\n')) lines.pop()
  const whole = offset === 1 && (limit === undefined || limit >= lines.length)
  if (whole && bodyHash === fileHash && bodyBytes.equals(bytes)) return { kind: 'full' as const, bodyHash }
  const start = Number(offset) - 1, selected = lines.slice(start, limit === undefined ? undefined : start + limit).join('\n')
  if (!whole && bodyBytes.length > 0 && body === selected) return { kind: 'partial' as const, bodyHash }
  return { kind: 'unknown' as const, bodyHash }
}

/** Inactive feed seam: never forward nested-agent summaries or enqueue receipts.
 * False means no record admitted, not proof of non-exposure. Close is terminal.
 * Ledger implementations must independently fence the same context/identity changes. */
export function createReadResultAttestor(options: ReadResultAttestorOptions) {
  const pending = new Map<string, Pending>(), seen = new Set<string>()
  let generation = '', closed = false, exhausted = false
  const reset = () => { pending.clear(); seen.clear(); exhausted = false }
  function current() {
    const raw = options.context(), identity = options.captureIdentity(), format = options.format()
    const context = raw ? validatePortData<InputPortContext>(InputPortContextSchema, raw) : undefined
    const key = JSON.stringify([context?.scope, context?.sourceRevision, context?.grantRevision, context?.available, identity, format])
    if (key !== generation) { reset(); generation = key }
    return { context, identity, format, key }
  }
  function start(call: MainReadCall, cwd: string, origin: 'main-agent' | 'other'): boolean {
    try {
      const { context, identity, format } = current()
      if (closed || exhausted || origin !== 'main-agent' || !context?.available || !identity ||
          call.toolName !== 'read' || !call.toolCallId || call.toolCallId.length > 512 ||
          !identity.id || !Number.isSafeInteger(identity.epoch) || identity.epoch < 0 || typeof call.input?.path !== 'string') return false
      if (seen.has(call.toolCallId)) { pending.delete(call.toolCallId); return false }
      if (seen.size === MAX_CALLS) { pending.clear(); exhausted = true; return false }
      seen.add(call.toolCallId)
      // Freeze a copy so mutation cannot rewrite the admitted call or authority.
      const copied: MainReadCall = Object.freeze({ toolCallId: call.toolCallId, toolName: call.toolName, input: Object.freeze({ ...call.input }) })
      pending.set(call.toolCallId, Object.freeze({ call: copied, callHash: callDigest(copied), cwd, identity: Object.freeze({ ...identity }), context, format }))
      return true
    } catch { pending.clear(); exhausted = true; return false }
  }
  function complete(result: MainReadResult, cwd: string, origin: 'main-agent' | 'other', cursor: number): boolean {
    try {
      const { context, identity, key } = current(), p = pending.get(result.toolCallId)
      pending.delete(result.toolCallId)
      if (closed || exhausted || !p || !context?.available || !identity || origin !== 'main-agent' ||
          (result.isError !== false && result.is_error !== false) || result.isError === true || result.is_error === true ||
          p.cwd !== cwd || p.callHash !== callDigest(result) || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > context.completeThroughCursor) return false
      const captured = options.capture(p)
      if (!(captured instanceof Uint8Array) || captured.byteLength > MAX_BYTES) return false
      const bytes = Buffer.from(captured), fileHash = digest(bytes), document = options.resolveDocument(p, fileHash)
      if (!document) return false
      const exposure = classification(p.call, result, bytes, p.format)
      const attestationId = 'tool-result-full-text:' + digest(JSON.stringify([p.callHash, p.identity, p.context, p.format, cursor, document, fileHash, exposure]))
      const record = validateReadRecord({ protocolVersion: 1, scope: p.context.scope,
        documentId: document.documentId, documentVersion: document.documentVersion,
        namespace: document.namespace, sourceRecordId: document.sourceRecordId,
        sourceRecordRevision: fileHash, sourceEventId: result.toolCallId, cursor,
        sourceRevision: p.context.sourceRevision, grantRevision: p.context.grantRevision,
        exposure: { kind: exposure.kind, attestationId } })
      // Trusted synchronous callbacks may revoke authority; never admit across that fence.
      const final = current()
      if (final.key !== key || closed || !final.context || cursor > final.context.completeThroughCursor) return false
      return options.record(record) === true
    } catch { pending.clear(); exhausted = true; return false }
  }
  return Object.freeze({ start, complete, close() { closed = true; reset() } })
}
