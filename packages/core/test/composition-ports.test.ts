import { expect, test } from 'bun:test'
import { bindReadRecordPort, exposeReadRecordPort, bindReviewSinkPort, exposeReviewSinkPort, bindStatePort, exposeStatePort, bindModelBackend, exposeModelBackend, completed, held, portValue, PortResultError, capturePortResult, bindReportPort, exposeReportPort, bindJudgeBatchPort, exposeJudgeBatchPort, createMemoryStatePort, runStatePortConformance, type MemoryStateBacking } from '../src/sdk/index.ts'
import { createInMemoryReadRecordPort, createInMemoryReviewSinkPort, runReadRecordPortConformance, runReviewSinkPortConformance, syntheticReadRequest, syntheticReviewCandidate } from '../src/host/index.ts'
import { bindRuleVerifier, exposeRuleVerifier, bindPolicyRegistry, exposePolicyRegistry, bindMemorySource, exposeMemorySource, rules } from '../../../composition.ts'
import { fixture, config, task } from './support/model-fixture.ts'
import { monitoringReportId } from '../src/engine/monitoring-engine-runtime.ts'
import { createMonitoringModelRouter } from '../src/sdk/models.ts'

test('WorkerCompletion is the common success, failure and deliberate held vocabulary', () => {
  expect(completed(42)).toEqual({ status: 'completed', certainty: 'terminal', value: 42 })
  expect(held('No placement yet', { trace: 'synthetic' })).toEqual({ status: 'completed', certainty: 'terminal', value: { held: true, reason: 'No placement yet', detail: { trace: 'synthetic' } } })
  for (const status of ['failed', 'timed-out', 'cancelled', 'refused'] as const) for (const certainty of ['terminal', 'uncertain'] as const) {
    expect(() => portValue({ status, certainty, reason: 'Synthetic failure' })).toThrow(PortResultError)
  }
  expect(() => portValue({ status: 'completed', certainty: 'uncertain', value: 1 } as never)).toThrow('Invalid port result envelope')
})
test('read snapshot and freshness adapters preserve fake-backed conformance and scope fences', async () => {
  const checks = await runReadRecordPortConformance((context, options) => {
    const h = createInMemoryReadRecordPort({ context, ...options }); return { ...h, port: bindReadRecordPort(exposeReadRecordPort(h.port)) }
  })
  expect(checks).toHaveLength(5)
})
test('review sink adapters preserve conformance; unknown/refused never become accepted', async () => {
  const checks = await runReviewSinkPortConformance((context, options) => {
    const h = createInMemoryReviewSinkPort({ context, ...options }); return { ...h, port: bindReviewSinkPort(exposeReviewSinkPort(h.port)) }
  })
  expect(checks).toHaveLength(3)
  for (const status of ['refused', 'unknown'] as const) {
    const p = exposeReviewSinkPort({ protocolVersion: 1, retention: 'volatile', async enqueue(c) { return { protocolVersion: 1, candidateId: c.candidateId, status, reason: 'Synthetic refusal' } } })
    expect(await p.enqueue(syntheticReviewCandidate())).toMatchObject({ status: status === 'refused' ? 'refused' : 'failed', certainty: status === 'refused' ? 'terminal' : 'uncertain' })
    expect((await bindReviewSinkPort(p).enqueue(syntheticReviewCandidate())).status).toBe(status)
  }
})
test('state adapters preserve restart/CAS/mailbox/budget conformance', async () => {
  const backings = new Map<string, MemoryStateBacking>()
  const result = await runStatePortConformance((id, _binding, limits) => {
    const backing = backings.get(id) ?? {}; backings.set(id, backing)
    return bindStatePort(exposeStatePort(createMemoryStatePort(backing, limits)))
  })
  expect(result.checks.length).toBeGreaterThan(20)
})
test('read failure is explicit and state write failure is uncertain, never retried', async () => {
  let calls = 0
  const fail = () => { calls++; throw Error('Private host detail') }
  const read = exposeReadRecordPort({ protocolVersion: 1, snapshot: async () => fail(), isCurrent: fail })
  expect(await read.snapshot(syntheticReadRequest())).toEqual({ status: 'failed', certainty: 'terminal', reason: 'Host port operation failed' })
  expect(read.isCurrent(syntheticReadRequest(), {} as never).status).toBe('failed')
  const state = exposeStatePort({ ...createMemoryStatePort(), commit: fail })
  expect(state.commit(undefined, {} as never)).toEqual({ status: 'failed', certainty: 'uncertain', reason: 'Host port operation failed' })
  expect(calls).toBe(3)
})
test('model envelope round-trip preserves selection/classifier output and reservations with a fake only', async () => {
  const f = fixture()
  const host = { ...f.host, backends: Object.fromEntries(Object.entries(f.host.backends).map(([id, p]) => [id, bindModelBackend(exposeModelBackend(p))])) }
  const router = createMonitoringModelRouter(config(), host)
  try { expect((await router.judgeBatch([task()], new AbortController().signal))['consumer.tests'].mode).toBe('run'); expect(f.calls).toHaveLength(1) } finally { router.dispose(); await router.idle() }
})
test('rule verifier HOLD, no judgement, exceptions and cancellation remain fail-closed through boundary', async () => {
  expect(await rules.runRuleVerifierPortConformance(respond => bindRuleVerifier(exposeRuleVerifier(respond)))).toHaveLength(3)
  const signal = new AbortController().signal
  const result = await exposeRuleVerifier(async () => ({ mode: 'defer', reason: 'Wait for authority', evidenceRefs: [] }))(task(), signal)
  expect(result).toMatchObject({ status: 'completed', certainty: 'terminal', value: { held: true, reason: 'Wait for authority' } })
  expect(await exposeRuleVerifier(async () => undefined)(task(), signal)).toMatchObject({ status: 'failed', certainty: 'terminal' })
})
test('policy registry validates at boundary; failure is not an empty policy list', () => {
  const registry = { id: 'synthetic', version: '1', policies: [{ id: 'one', version: '1', title: 'Use amber glass.' }] }
  expect(bindPolicyRegistry(exposePolicyRegistry(registry))).toEqual(registry)
  expect(exposePolicyRegistry({ ...registry, version: '' })).toMatchObject({ status: 'failed', certainty: 'terminal' })
})
test('memory source capture/currentness is a common-result boundary with no authority inference', () => {
  const source = { capture: () => ({ invented: true }), isCurrent: () => false }
  const port = exposeMemorySource(source), native = bindMemorySource(port)
  expect(port.capture({} as never)).toEqual(completed({ invented: true }))
  expect(native.capture({} as never)).toEqual({ invented: true })
  expect(native.isCurrent({} as never, {} as never)).toBe(false)
  expect(exposeMemorySource({ ...source, capture() { throw Error('Private details') } }).capture({} as never)).toMatchObject({ status: 'failed', certainty: 'terminal' })
})
test('report enqueue envelope preserves matching receipts and unknown acceptance protection', () => {
  const report = { moduleId: 'synthetic', jobId: 'job', eventId: 'event', sessionId: 'session', mode: 'always' as const, text: 'Invented report', riskTier: 'read-only' }
  for (const status of ['enqueued', 'failed', 'unknown'] as const) {
    const native = bindReportPort(exposeReportPort(r => ({ reportId: monitoringReportId(r), status })))
    expect(native(report).status).toBe(status)
    // An unrelated receipt can never prove successful enqueue.
    expect(bindReportPort(exposeReportPort(() => ({ reportId: 'unrelated', status })))(report).status).toBe('unknown')
  }
  const common = exposeReportPort(() => { throw Error('Private host detail') })
  expect(common(report)).toEqual({ status: 'failed', certainty: 'uncertain', reason: 'Host port operation failed' })
})
test('direct judge common boundary preserves fake answers and distinguishes exceptions from no answers', async () => {
  const signal = new AbortController().signal
  const port = exposeJudgeBatchPort(async () => ({ synthetic: { mode: 'skip', reason: 'Invented decision', evidenceRefs: [] } }))
  expect((await bindJudgeBatchPort(port)([task()], signal)).synthetic.mode).toBe('skip')
  expect(await exposeJudgeBatchPort(async () => { throw Error('Private') })([task()], signal)).toEqual({ status: 'failed', certainty: 'uncertain', reason: 'Host port operation failed' })
})
test('verifier pre-cancellation never dispatches and post-dispatch cancellation discards a late answer', async () => {
  let calls = 0, finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const verify = exposeRuleVerifier(async () => { calls++; await gate; return { mode: 'run', reason: 'Late', evidenceRefs: [] } })
  const pre = new AbortController(); pre.abort()
  expect(await verify(task(), pre.signal)).toMatchObject({ status: 'cancelled', certainty: 'terminal' }); expect(calls).toBe(0)
  const after = new AbortController(), pending = verify(task(), after.signal)
  after.abort(); finish()
  expect(await pending).toMatchObject({ status: 'cancelled', certainty: 'uncertain' }); expect(calls).toBe(1)
})
test('uncertain timeout/cancel/refusal stays explicit with one dispatch, no retry and no late overwrite', async () => {
  for (const status of ['timed-out', 'cancelled', 'refused'] as const) {
    let calls = 0
    const failure = { status, certainty: 'uncertain' as const, reason: 'Synthetic host outcome' }
    const result = await capturePortResult(() => { calls++; throw new PortResultError(failure) }, 'terminal')
    expect(result).toEqual(failure); expect(calls).toBe(1)
  }
  let finish!: (v: number) => void, calls = 0
  const raw = new Promise<number>(r => { finish = r })
  const failure = { status: 'timed-out' as const, certainty: 'uncertain' as const, reason: 'Synthetic host deadline' }
  const result = await capturePortResult(async () => { calls++; void raw; throw new PortResultError(failure) }, 'terminal')
  finish(7); await raw; expect(result).toEqual(failure); expect(calls).toBe(1)
})
