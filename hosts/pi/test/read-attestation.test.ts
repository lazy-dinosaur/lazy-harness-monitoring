import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { createInMemoryReadRecordPort, evaluateReadRecordSnapshot, syntheticInputPortContext, type InputPortContext, type ReadRecord } from '@lazy-harness/monitoring-core/host'
import { createReadResultAttestor, type MainReadCall, type MainReadResult, type ReadTextFormat } from '@lazy-harness/monitoring-host-pi'

// Invented in-memory source: no project records, filesystem policy or session exports.
function fixture(format: ReadTextFormat = 'pi-read-text-v1', text = 'Toy prism\nAmber glass.') {
  let context: InputPortContext = syntheticInputPortContext(), epoch = 1, bytes: Uint8Array | undefined = Buffer.from(text), admitted = true, serial = 0
  let ledger = createInMemoryReadRecordPort({ context: () => context })
  const records: ReadRecord[] = []
  const producer = createReadResultAttestor({ context: () => context, captureIdentity: () => ({ id: 'toy-capture', epoch }), format: () => format,
    capture: read => read.call.input.path === 'prism.txt' ? bytes : undefined,
    resolveDocument: (_read, hash) => admitted ? { documentId: 'toy-prism', documentVersion: hash, namespace: 'toy', sourceRecordId: 'opaque-prism' } : undefined,
    record: r => { records.push(r); return ledger.record(r) } })
  const call = (input: Partial<MainReadCall['input']> = {}): MainReadCall => ({ toolCallId: `toy-read-${++serial}`, toolName: 'read', input: { path: 'prism.txt', ...input } })
  const result = (c: MainReadCall, body = text, extra: Partial<MainReadResult> = {}): MainReadResult => ({ ...c, isError: false, content: [{ type: 'text', text: body }], ...extra })
  const request = (version: string) => ({ protocolVersion: 1 as const, ...context, available: undefined, sourceEventId: 'toy-query', cursor: 2, documents: [{ documentId: 'toy-prism', documentVersion: version }] })
  // Request envelopes have no availability/watermark fields.
  const req = (version: string) => { const { available: _a, completeThroughCursor: _c, ...r } = request(version); return r }
  return { producer, records, call, result, context: () => context,
    change(c: InputPortContext) { context = c }, format(f: ReadTextFormat) { format = f },
    bump() { epoch++; ledger.close(); ledger = createInMemoryReadRecordPort({ context: () => context }) },
    bytes(b?: string | Uint8Array) { bytes = typeof b === 'string' ? Buffer.from(b) : b }, admit(b: boolean) { admitted = b },
    async lookup(v: string) { const r = req(v); return evaluateReadRecordSnapshot(r, await ledger.port.snapshot(r))[0].status },
    feed(body = text, input: Partial<MainReadCall['input']> = {}, extra: Partial<MainReadResult> = {}) {
      const c = call(input); expect(producer.start(c, 'toy-cwd', 'main-agent')).toBe(true)
      expect(producer.complete(result(c, body, extra), 'toy-cwd', 'main-agent', 2)).toBe(true)
      return records.at(-1)!
    }, close() { producer.close(); ledger.close() } }
}

test('native Pi plain text attests exact bytes, CRLF and terminal LF without normalization', () => {
  const f = fixture('pi-read-text-v1', 'Toy\r\nprism.\n')
  const r = f.feed(), hash = createHash('sha256').update('Toy\r\nprism.\n').digest('hex')
  expect(r.documentVersion).toBe(hash); expect(r.sourceRecordRevision).toBe(hash)
  expect(r.sourceRecordId).toBe('opaque-prism'); expect(r.namespace).toBe('toy'); expect(r.scope).toEqual(f.context().scope)
  expect(r.exposure.kind).toBe('full'); expect(r.exposure.attestationId).toMatch(/^tool-result-full-text:[0-9a-f]{64}$/)
  expect(f.feed(undefined, { offset: 1, limit: 100 }).exposure.kind).toBe('full'); f.close()
})
test('numeric subsets prove partial only; invalid/anchor offsets and whole text cannot promote', () => {
  const f = fixture()
  expect(f.feed('Amber glass.', { offset: 2, limit: 1 }).exposure.kind).toBe('partial')
  expect(f.feed('Toy prism', { limit: 1 }).exposure.kind).toBe('partial')
  for (const input of [{ offset: 2, limit: 1 }, { offset: 'abcde' }, { offset: 0 }, { limit: 0 }, { offset: 1.5 }]) expect(f.feed(undefined, input).exposure.kind).toBe('unknown')
  f.close()
})
test('hashline strips only [a-z]{5}│ and preserves spaces, blank rows, CR and nested pipes', () => {
  const f = fixture('pi-hashline-edit-pro-v1', '  Toy│prism\r\n\nAmber glass.  ')
  const body = 'abcde│  Toy│prism\r\nfghij│\nklmno│Amber glass.  '
  expect(f.feed(body).exposure.kind).toBe('full'); expect(f.feed(body, { limit: 3 }).exposure.kind).toBe('full')
  for (const bad of ['1:abcde│Toy', 'ABCDe│Toy', 'abcdef│Toy', 'abcde|Toy', 'abcde│Toy\nAmber']) expect(f.feed(bad).exposure.kind).toBe('unknown')
  f.bytes('Toy prism\n'); expect(f.feed('abcde│Toy prism').exposure.kind).toBe('unknown')
  expect(f.feed('abcde│Toy prism', { limit: 1 }).exposure.kind).toBe('unknown'); f.close()
})
for (const extra of [
  { details: { truncation: { truncated: true } } }, { details: { truncation: { firstLineExceedsLimit: true } } },
  { details: { nextOffset: 2 } }, { details: { metrics: { truncated: true } } }, { details: { metrics: { next_offset: 2 } } },
  { structuredContent: { truncated: true } }, { structuredContent: { nextOffset: 2 } },
  { structuredContent: { blockedByLongLine: true } }, { structuredContent: { hadUtf8DecodeErrors: true } }, { structuredContent: { notices: ['Toy warning'] } },
] as Partial<MainReadResult>[]) test(`continuation metadata is unknown: ${JSON.stringify(extra)}`, () => {
  const f = fixture(); expect(f.feed(undefined, {}, extra).exposure.kind).toBe('unknown'); f.close()
})
test('notices, changed bytes, binary, lossy UTF-8, unknown format and nontext are unknown', () => {
  const f = fixture()
  for (const body of ['Use offset=2 to continue', '[Read truncated; outline]', 'Non-UTF-8 bytes']) { f.bytes(body); expect(f.feed(body).exposure.kind).toBe('unknown') }
  f.bytes('Changed toy prism'); expect(f.feed().exposure.kind).toBe('unknown')
  f.bytes(Buffer.from([0xff, 0x61])); expect(f.feed('\ufffda').exposure.kind).toBe('unknown')
  f.bytes('Toy\0prism'); expect(f.feed('Toy\0prism').exposure.kind).toBe('unknown')
  f.bytes('Toy prism\nAmber glass.'); f.format('unknown'); expect(f.feed().exposure.kind).toBe('unknown'); f.format('pi-read-text-v1')
  for (const content of [[], [{ type: 'image', data: 'toy' }], [{ type: 'text', text: 'Toy' }, { type: 'text', text: 'extra' }]]) expect(f.feed(undefined, {}, { content }).exposure.kind).toBe('unknown')
  f.close()
})
test('no record for unpaired, error, foreign origin/cwd/call, invalid cursor or missing capture/catalog', () => {
  const f = fixture(), c = f.call()
  expect(f.producer.complete(f.result(c), 'toy-cwd', 'main-agent', 2)).toBe(false)
  expect(f.producer.start(c, 'toy-cwd', 'other')).toBe(false)
  expect(f.producer.start({ ...c, toolName: 'other' }, 'toy-cwd', 'main-agent')).toBe(false)
  for (const extra of [{ isError: true }, { isError: undefined }, { is_error: true }, { toolName: 'other' }, { input: { path: 'changed' } }]) {
    const c = f.call(); expect(f.producer.start(c, 'toy-cwd', 'main-agent')).toBe(true)
    expect(f.producer.complete(f.result(c, undefined, extra), 'toy-cwd', 'main-agent', 2)).toBe(false)
  }
  for (const [cwd, origin, cursor] of [['foreign', 'main-agent', 2], ['toy-cwd', 'other', 2], ['toy-cwd', 'main-agent', -1], ['toy-cwd', 'main-agent', 11]] as const) {
    const c = f.call(); f.producer.start(c, 'toy-cwd', 'main-agent'); expect(f.producer.complete(f.result(c), cwd, origin, cursor)).toBe(false)
  }
  for (const missing of ['capture', 'catalog', 'oversize', 'denied-path'] as const) {
    f.bytes(missing === 'capture' ? undefined : missing === 'oversize' ? new Uint8Array(1048577) : 'Toy prism')
    f.admit(missing !== 'catalog'); const c = f.call(missing === 'denied-path' ? { path: '../outside' } : {})
    f.producer.start(c, 'toy-cwd', 'main-agent'); expect(f.producer.complete(f.result(c), 'toy-cwd', 'main-agent', 2)).toBe(false)
  }
  expect(f.records).toEqual([]); f.close()
})
for (const bump of ['session', 'binding', 'branch', 'compaction', 'epoch', 'grant', 'source', 'format', 'unavailable'] as const) test(`${bump} fences pending reads and ledger scope`, async () => {
  const f = fixture(), r = f.feed(), c = f.call(); f.producer.start(c, 'toy-cwd', 'main-agent')
  const ctx = f.context()
  if (bump === 'epoch') f.bump()
  else if (bump === 'format') f.format('unknown')
  else f.change({ ...ctx, ...(bump === 'grant' ? { grantRevision: 'toy-grant-2' } : {}), ...(bump === 'source' ? { sourceRevision: 'toy-source-2' } : {}), ...(bump === 'unavailable' ? { available: false } : {}), scope: { ...ctx.scope,
    ...(bump === 'session' ? { sessionId: 'toy-next' } : {}), ...(bump === 'binding' ? { bindingGeneration: 2 } : {}), ...(bump === 'branch' ? { branchGeneration: 2 } : {}), ...(bump === 'compaction' ? { compactionGeneration: 2 } : {}) } })
  expect(f.producer.complete(f.result(c), 'toy-cwd', 'main-agent', 2)).toBe(false)
  if (bump !== 'format') expect(await f.lookup(r.documentVersion)).not.toBe('already-read')
  f.close()
})
test('only full exact document versions suppress; partial and unknown never do', async () => {
  const f = fixture(), r = f.feed()
  expect(await f.lookup(r.documentVersion)).toBe('already-read')
  expect(await f.lookup('different-version')).toBe('not-read')
  f.change({ ...f.context(), scope: { ...f.context().scope, compactionGeneration: 2 } })
  expect(await f.lookup(r.documentVersion)).toBe('not-read'); f.close()
  const partial = fixture(), p = partial.feed('Amber glass.', { offset: 2, limit: 1 })
  expect(await partial.lookup(p.documentVersion)).toBe('not-read'); partial.close()
  const unknown = fixture('unknown'), u = unknown.feed(); expect(await unknown.lookup(u.documentVersion)).toBe('not-read'); unknown.close()
})
test('replays, duplicate start, overflow and close never forget protection in one generation', () => {
  const f = fixture(), c = f.call(); f.producer.start(c, 'toy-cwd', 'main-agent')
  expect(f.producer.start(c, 'toy-cwd', 'main-agent')).toBe(false)
  expect(f.producer.complete(f.result(c), 'toy-cwd', 'main-agent', 2)).toBe(false)
  for (let i = 1; i < 256; i++) expect(f.producer.start(f.call(), 'toy-cwd', 'main-agent')).toBe(true)
  expect(f.producer.start(f.call(), 'toy-cwd', 'main-agent')).toBe(false)
  expect(f.producer.start(c, 'toy-cwd', 'main-agent')).toBe(false)
  f.bump(); expect(f.producer.start(c, 'toy-cwd', 'main-agent')).toBe(true)
  f.close(); expect(f.producer.complete(f.result(c), 'toy-cwd', 'main-agent', 2)).toBe(false)
  expect(f.producer.start(f.call(), 'toy-cwd', 'main-agent')).toBe(false)
})

test('watermark progress does not reopen replay IDs; absent authority cannot attest', () => {
  const f = fixture(), c = f.call()
  expect(f.producer.start(c, 'toy-cwd', 'main-agent')).toBe(true)
  expect(f.producer.complete(f.result(c), 'toy-cwd', 'main-agent', 2)).toBe(true)
  f.change({ ...f.context(), completeThroughCursor: 20 })
  expect(f.producer.start(c, 'toy-cwd', 'main-agent')).toBe(false)
  f.change({ ...f.context(), available: false })
  expect(f.producer.start(f.call(), 'toy-cwd', 'main-agent')).toBe(false); f.close()
})

for (const fault of ['capture', 'resolve', 'record', 'invalid-document', 'revoked-in-capture'] as const) test(`${fault} fails closed without reopening same-generation protection`, () => {
  let context = syntheticInputPortContext(), recorded = 0, broken = true
  const attestor = createReadResultAttestor({ context: () => context, captureIdentity: () => ({ id: 'toy', epoch: 1 }), format: () => 'pi-read-text-v1',
    capture() { if (broken && fault === 'capture') throw Error('Toy capture failure'); if (broken && fault === 'revoked-in-capture') context = { ...context, grantRevision: 'next-grant' }; return Buffer.from('Toy') },
    resolveDocument() { if (broken && fault === 'resolve') throw Error('Toy resolver failure'); return { documentId: broken && fault === 'invalid-document' ? '' : 'toy', documentVersion: '1', namespace: 'toy', sourceRecordId: 'source' } },
    record() { if (broken && fault === 'record') throw Error('Toy storage failure'); recorded++; return true } })
  const call: MainReadCall = { toolCallId: 'toy-failure', toolName: 'read', input: { path: 'invented.txt' } }
  expect(attestor.start(call, 'toy', 'main-agent')).toBe(true)
  expect(attestor.complete({ ...call, isError: false, content: [{ type: 'text', text: 'Toy' }] }, 'toy', 'main-agent', 2)).toBe(false)
  expect(recorded).toBe(0)
  broken = false
  if (fault !== 'revoked-in-capture') expect(attestor.start({ ...call, toolCallId: 'toy-next' }, 'toy', 'main-agent')).toBe(false)
  context = { ...context, sourceRevision: 'next-source' }
  expect(attestor.start({ ...call, toolCallId: 'toy-fresh' }, 'toy', 'main-agent')).toBe(true)
  attestor.close()
})
