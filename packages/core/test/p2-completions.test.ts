import { expect, test } from 'bun:test'
import { createInMemoryWorkerPort } from '@lazy-harness/monitoring-core'
import type { JobResult, WorkerJobRequest } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { moduleSpec, runtime } from './support/p2-fixtures.ts'
import { deferred } from './support/p2-scheduler.ts'

const badResults: [string, () => unknown][] = [
  ['undefined', () => undefined], ['null', () => null], ['primitive', () => 'prepared'], ['encoded object', () => '{"status":"prepared"}'],
  ['array', () => [{ status: 'prepared' }]], ['missing status', () => ({})],
  ['invalid status type', () => ({ status: 1 })], ['inherited status', () => Object.create({ status: 'prepared' })],
  ['extra field', () => ({ status: 'prepared', extra: true })], ['null report', () => ({ status: 'prepared', report: null })],
  ['missing report text', () => ({ status: 'prepared', report: {} })], ['numeric report text', () => ({ status: 'prepared', report: { text: 1 } })],
  ['oversized UTF-8 report', () => ({ status: 'prepared', report: { text: '界'.repeat(21846) } })],
  ['numeric effect', () => ({ status: 'executed', effectId: 1 })], ['empty effect', () => ({ status: 'executed', effectId: '' })],
  ['oversized effect', () => ({ status: 'executed', effectId: 'x'.repeat(513) })],
  ['non-JSON output', () => ({ status: 'prepared', output: { callback() {} } })],
  ['non-finite output', () => ({ status: 'prepared', output: NaN })],
  ['oversized output', () => ({ status: 'prepared', output: 'x'.repeat(300000) })],
  ['cyclic output', () => { const output: any = {}; output.self = output; return { status: 'prepared', output } }],
]
for (const [name, make] of badResults) test(`malformed worker result ${name} never reports or retries`, async () => {
  let calls = 0
  const port = createInMemoryWorkerPort<WorkerJobRequest, JobResult>(() => { calls++; return make() as JobResult })
  const h = runtime({ run: () => ({ status: 'prepared' }) }, { workerPort: port, modules: [moduleSpec('m', 'active', false, 'automatic')] })
  try {
    expect((await h.fire('bad'))[0]).toMatchObject({ status: 'uncertain', reason: 'malformed_worker_result', reported: false })
    expect(h.reports).toEqual([]); expect((await h.fire('bad'))[0]!.reason).toBe('duplicate:uncertain'); expect(calls).toBe(1)
    await h.r.idle(); expect(h.r.getStatus().rawActive).toBe(0)
  } finally { h.r.dispose(); await h.r.idle() }
})
for (const target of ['status', 'report', 'text', 'effectId', 'output'] as const) test(`worker result ${target} accessor is never invoked`, async () => {
  let reads = 0
  const result: any = { status: 'prepared' }, getter = { enumerable: true, get() { reads++; throw Error('must not read') } }
  if (target === 'text') result.report = Object.defineProperty({}, 'text', getter)
  else Object.defineProperty(result, target, getter)
  const h = runtime({ run: () => result })
  try {
    expect((await h.fire('bad'))[0]).toMatchObject({ status: 'uncertain', reason: 'malformed_worker_result', reported: false })
    expect(reads).toBe(0); expect(h.reports).toEqual([]); expect((await h.fire('bad'))[0]!.reason).toBe('duplicate:uncertain')
  } finally { h.r.dispose(); await h.r.idle() }
})
const envelopes: [string, () => unknown][] = [
  ['null', () => null], ['bad status', () => ({ status: 'invalid' })],
  ['bad certainty', () => ({ status: 'completed', certainty: 'uncertain', value: { status: 'prepared' } })],
  ['absent reason', () => ({ status: 'refused', certainty: 'terminal' })],
  ['status getter', () => Object.defineProperty({}, 'status', { enumerable: true, get() { throw Error('must not read') } })],
]
for (const [name, make] of envelopes) test(`malformed completion envelope ${name} fails closed`, async () => {
  const base = createInMemoryWorkerPort<WorkerJobRequest, JobResult>(() => ({ status: 'prepared' }))
  const h = runtime({ run: () => ({ status: 'prepared' }) }, { workerPort: { ...base, wait: async () => make() as never } })
  try {
    expect((await h.fire('bad'))[0]).toMatchObject({ status: 'uncertain', reason: 'malformed_worker_result', reported: false })
    expect(h.reports).toEqual([]); expect((await h.fire('bad'))[0]!.reason).toBe('duplicate:uncertain')
  } finally { h.r.dispose(); await h.r.idle() }
})
for (const status of ['executed', 'proposed', 'prepared', 'rejected', 'unknown'] as const) test(`valid ${status} result preserves status policy`, async () => {
  const result = { status, ...(status === 'executed' ? { effectId: 'effect' } : {}), report: { text: 'x'.repeat(65536) }, output: { moduleOwned: [null, true, 1, { text: 'value' }] } }
  const h = runtime({ run: () => result }, { modules: [moduleSpec('m', 'active', false, 'automatic')] })
  try {
    expect((await h.fire('valid'))[0]).toMatchObject({ status: status === 'unknown' ? 'uncertain' : status, reported: !['unknown', 'rejected'].includes(status) })
    expect(h.reports.length).toBe(['unknown', 'rejected'].includes(status) ? 0 : 1)
  } finally { h.r.dispose(); await h.r.idle() }
})
test('executed result without effect receipt remains uncertain and cannot retry', async () => {
  const h = runtime({ run: () => ({ status: 'executed' }) }, { modules: [moduleSpec('m', 'active', false, 'automatic')] })
  try {
    expect((await h.fire('missing'))[0]).toMatchObject({ status: 'uncertain', reason: 'missing_effect_receipt', reported: false })
    expect(h.reports).toEqual([]); expect((await h.fire('missing'))[0]!.reason).toBe('duplicate:uncertain')
  } finally { h.r.dispose(); await h.r.idle() }
})
for (const field of ['status', 'value'] as const) test(`completion envelope ${field} getter is never invoked`, async () => {
  let reads = 0
  const envelope = Object.defineProperty({ status: 'completed', certainty: 'terminal' }, field, { enumerable: true, get() { reads++; return { status: 'prepared' } } })
  const base = createInMemoryWorkerPort<WorkerJobRequest, JobResult>(() => ({ status: 'prepared' }))
  const h = runtime({ run: () => ({ status: 'prepared' }) }, { workerPort: { ...base, wait: async () => envelope as never } })
  try {
    expect((await h.fire('bad'))[0]).toMatchObject({ status: 'uncertain', reported: false }); expect(reads).toBe(0); expect(h.reports).toEqual([])
  } finally { h.r.dispose(); await h.r.idle() }
})
test('outcome and report use a completion copy, not a mutable worker object', async () => {
  const result = { status: 'executed' as const, effectId: 'original', report: { text: 'original' } }
  const h = runtime({ run: () => result }, { modules: [moduleSpec('m', 'active', false, 'automatic')], report(report) {
    result.effectId = 'changed'; result.report.text = 'changed'
    expect(report.text).toBe('original')
    return { reportId: 'not-an-acknowledgement', status: 'failed' }
  } })
  try { expect((await h.fire('copy'))[0]).toMatchObject({ status: 'executed', effectId: 'original', reported: false }) }
  finally { h.r.dispose(); await h.r.idle() }
})
test('malformed logical completion does not release raw budget reservation', async () => {
  const gate = deferred(), base = createInMemoryWorkerPort<WorkerJobRequest, JobResult>(async () => { await gate.promise; return { status: 'prepared' } })
  const h = runtime({ run: () => ({ status: 'prepared' }) }, { workerPort: { ...base, wait: async () => ({ status: 'completed', certainty: 'terminal', value: null as never }) } }, true)
  try {
    expect((await h.fire('bad'))[0]!.status).toBe('uncertain')
    expect(h.budget.usage('m')!.reserved.workerDispatches).toBe(1); expect(h.r.getStatus().rawActive).toBe(1)
    expect(h.reports).toEqual([]); gate.resolve(); await h.r.idle()
    expect(h.budget.usage('m')!.reserved.workerDispatches).toBe(0); expect(h.r.getStatus().rawActive).toBe(0)
  } finally { gate.resolve(); h.r.dispose(); await h.r.idle() }
})
