import { expect, test } from 'bun:test'
import { prepareMonitoringBindings, type MonitoringConfiguration, type MonitoringModuleBinding } from '@lazy-harness/monitoring-core'
import { createInMemoryReadRecordPort, createInMemoryReviewSinkPort, runReadRecordPortConformance, runReviewSinkPortConformance, syntheticInputPortContext, syntheticReadRecord, syntheticReadRequest, syntheticReviewCandidate, validateReadRecord, validateReadRecordSnapshot, validateReadRecordRequest, validateReviewCandidate, validateReviewSinkReceipt, evaluateReadRecordSnapshot, validateRequiredInputPorts, type HostInputPortBindings, type ReadRecordConformanceFactory, type ReviewSinkConformanceFactory } from '@lazy-harness/monitoring-core/host'
const reads: ReadRecordConformanceFactory = (context, options) => createInMemoryReadRecordPort({ context, ...options })
const reviews: ReviewSinkConformanceFactory = (context, options) => createInMemoryReviewSinkPort({ context, ...options })
test('read-record reusable conformance against in-memory fake', async () => { expect(await runReadRecordPortConformance(reads)).toHaveLength(5) })
test('review-sink reusable conformance against in-memory fake', async () => { expect(await runReviewSinkPortConformance(reviews)).toHaveLength(3) })
test('negative control: ID-only broken read source fails version conformance', async () => {
  const broken: ReadRecordConformanceFactory = (context, options) => {
    const h = reads(context, options)
    return { ...h, port: { ...h.port, async snapshot(r) { const s = await h.port.snapshot(r); return { ...s, records: s.records.map(x => ({ ...x, documentVersion: r.documents[0].documentVersion })) } } } }
  }
  await expect(runReadRecordPortConformance(broken)).rejects.toThrow('version isolation')
})
test('negative control: broken receipt identity fails sink conformance', async () => {
  const broken: ReviewSinkConformanceFactory = (context, options) => { const h = reviews(context, options); return { ...h, port: { ...h.port, async enqueue(c) { return { ...await h.port.enqueue(c), candidateId: 'wrong-candidate' } } } } }
  await expect(runReviewSinkPortConformance(broken)).rejects.toThrow('matching volatile receipt')
})
test('strict port validation refuses malformed, extra-field and accessor data without executing getters', () => {
  expect(() => validateReadRecord({ ...syntheticReadRecord(), extra: true })).toThrow()
  expect(() => validateReadRecord({ ...syntheticReadRecord(), exposure: { kind: 'full' } })).toThrow()
  expect(() => validateReadRecordRequest({ ...syntheticReadRequest(), documents: Array.from({ length: 33 }, () => syntheticReadRequest().documents[0]) })).toThrow()
  expect(() => validateReviewCandidate({ ...syntheticReviewCandidate(), notApproved: false })).toThrow()
  expect(() => validateReviewCandidate({ ...syntheticReviewCandidate(), claim: { ...syntheticReviewCandidate().claim, text: '界'.repeat(1000) } })).toThrow()
  let touched = false
  const bad = { ...syntheticReadRecord() }
  Object.defineProperty(bad, 'sourceEventId', { enumerable: true, get() { touched = true; return 'bad' } })
  expect(() => validateReadRecord(bad)).toThrow(); expect(touched).toBe(false)
})
test('mixed-scope or source snapshots never advertise not-read or suppress', async () => {
  const c = syntheticInputPortContext(), h = reads(() => c, { maxItems: 4096, maxBytes: 1048576 })
  const r = syntheticReadRequest(), snapshot = await h.port.snapshot(r)
  for (const record of [{ ...syntheticReadRecord(), scope: { ...c.scope, sessionId: 'foreign' } }, { ...syntheticReadRecord(), sourceRevision: 'foreign' }]) {
    expect(evaluateReadRecordSnapshot(r, { ...snapshot, records: [record] })[0].status).toBe('unknown')
  }
  h.close()
})
test('receipt and request validators reject mismatches and accessors', () => {
  expect(() => validateReviewSinkReceipt({ protocolVersion: 1, candidateId: 'wrong', status: 'accepted-volatile' }, 'expected')).toThrow('identity mismatch')
  expect(() => validateReviewSinkReceipt({ protocolVersion: 2, candidateId: 'expected', status: 'accepted-volatile' })).toThrow()
  let touched = false
  const request = syntheticReadRequest()
  Object.defineProperty(request, 'cursor', { enumerable: true, get() { touched = true; return 10 } })
  expect(() => validateReadRecordRequest(request)).toThrow(); expect(touched).toBe(false)
})
test('negative control: a broken carrying source fails no-carry conformance', async () => {
  const broken: ReadRecordConformanceFactory = (context, options) => {
    const h = reads(context, options)
    let record: ReturnType<typeof syntheticReadRecord> | undefined
    return { ...h, record(r) { const ok = h.record(r); if (ok) record = r; return ok }, port: { ...h.port, async snapshot(r) {
      const s = await h.port.snapshot(r)
      return record && s.status === 'available' ? validateReadRecordSnapshot({ ...s, records: [{ ...record, scope: r.scope }] }) : s
    } } }
  }
  await expect(runReadRecordPortConformance(broken)).rejects.toThrow('no carry')
})
test('required need registry rejects missing, unknown, mismatched, invalid and inherited bindings', () => {
  const needs = [{ id: 'read', adapter: 'session.read-records' }]
  const port = createInMemoryReadRecordPort({ context: syntheticInputPortContext }).port
  const good: HostInputPortBindings = { toy: { read: { adapter: 'session.read-records', protocolVersion: 1, port } } }
  expect(() => validateRequiredInputPorts('toy', needs, good)).not.toThrow()
  expect(() => validateRequiredInputPorts('toy', needs)).toThrow('Module toy need read (session.read-records)')
  expect(() => validateRequiredInputPorts('toy', needs, { toy: { read: { ...good.toy.read, adapter: 'memory.review-sink' } } })).toThrow('mismatch')
  expect(() => validateRequiredInputPorts('toy', needs, { toy: { read: { ...good.toy.read, port: {} } } })).toThrow('invalid')
  expect(() => validateRequiredInputPorts('toy', needs, Object.create(good))).toThrow('missing')
  expect(() => validateRequiredInputPorts('toy', [{ id: 'unknown', adapter: 'unknown.adapter' }])).toThrow('unknown adapter')
  expect(() => validateRequiredInputPorts('toy', [{ ...needs[0], optional: true }])).not.toThrow()
  expect(() => validateRequiredInputPorts('toy', undefined)).not.toThrow()
  expect(() => validateRequiredInputPorts('toy', [{ id: 'region', adapter: 'region.compact' }, { id: 'view', adapter: 'judge.view' }])).not.toThrow()
})
test('all configured needs are checked before ANY factory; modules without needs remain compatible', () => {
  let factories = 0
  const binding = (id: string, needs?: { id: string; adapter: string }[]): MonitoringModuleBinding => ({ version: '1', grants: { actions: [], referenceKinds: [] }, destination: 'toy', declaration: { purpose: { question: { instructions: 'Synthetic', criteria: { run: 'yes', skip: 'no', defer: 'unknown' } } }, watch: { events: ['input'], kinds: ['synthetic'] }, needs, jobs: [] }, build() { factories++; return { id, eventKinds: ['input'], referenceKinds: [], allowedActions: [], run: () => [] } } })
  const config: MonitoringConfiguration = { contractVersion: 1, source: { kind: 'host-events', scope: 'host-supplied-events' }, goal: 'Synthetic', receiver: 'toy', modules: [{ id: 'first', version: '1', settings: {} }, { id: 'second', version: '1', settings: {} }] }
  const host = { modules: { first: binding('first'), second: binding('second', [{ id: 'read', adapter: 'session.read-records' }]) }, allowedSourceScopes: ['host-supplied-events'] as const, maxModules: 2, capabilities: { hostId: 'synthetic', version: '1', events: ['input'], actions: [] as const, snapshot: 'full' as const } }
  expect(() => prepareMonitoringBindings(config, host)).toThrow('Module second need read'); expect(factories).toBe(0)
  const port = createInMemoryReadRecordPort({ context: syntheticInputPortContext }).port
  expect(prepareMonitoringBindings(config, { ...host, inputPorts: { second: { read: { adapter: 'session.read-records', protocolVersion: 1, port } } } }).processors).toHaveLength(2)
  expect(factories).toBe(2)
})
