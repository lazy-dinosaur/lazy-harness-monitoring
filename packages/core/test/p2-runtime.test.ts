import { expect, test } from 'bun:test'
import { effectiveMonitoringJobs, effectiveMonitoringStage, effectiveMonitoringWatch, createInMemoryWorkerPort } from '@lazy-harness/monitoring-core'
import { MemoryIdempotencyStore, monitoringReportId, type JobResult, type WorkerJobRequest } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { moduleSpec, runtime } from './support/p2-fixtures.ts'
import { deferred, flush, ManualClock, P2_SEEDS, SeededScheduler } from './support/p2-scheduler.ts'

for (const seed of P2_SEEDS) test(`seed ${seed}: competing duplicate, worker throw, receiver throw and healthy module stay isolated`, async () => {
  const scheduler = new SeededScheduler(seed), gate = deferred(), calls: string[] = [], store = new MemoryIdempotencyStore(8)
  const h = runtime({ run() { throw Error('unused') } }, { modules: [moduleSpec('bad'), moduleSpec('sink'), moduleSpec('good')], idempotency: store, maxActive: 1, maxQueued: 8,
    handlers: { 'bad.job': { async run() { calls.push('bad'); await gate.promise; throw Error('worker fault') } },
      'sink.job': { async run() { calls.push('sink'); await gate.promise; return { status: 'prepared' } } }, 'good.job': { async run() { calls.push('good'); await gate.promise; return { status: 'prepared' } } } },
    report(r) { if (r.moduleId === 'sink') throw Error('receiver fault'); return { reportId: monitoringReportId(r), status: 'enqueued' } }, trace() { throw Error('trace fault') } })
  try {
    const pending: ReturnType<typeof h.fire>[] = []
    await scheduler.run(['bad', 'sink', 'good', 'good'].map(moduleId => ({ name: moduleId, run() { pending.push(h.fire('same', undefined, { moduleId })) } })))
    expect(h.r.getStatus()).toMatchObject({ rawActive: 1, queued: 2, started: 1 })
    gate.resolve()
    const outcomes = (await Promise.all(pending)).flat(); await h.r.idle()
    expect(calls.sort()).toEqual(['bad', 'good', 'sink'])
    expect(outcomes.find(o => o.moduleId === 'bad')?.status).toBe('uncertain')
    expect(outcomes.find(o => o.moduleId === 'sink')?.reportReceipt?.reason).toBe('receiver_exception')
    expect(outcomes.filter(o => o.moduleId === 'good').map(o => o.reason).sort()).toEqual(['duplicate:started', 'ok'])
    expect(store.getStatus().keys).toBe(3); expect(h.r.getStatus()).toMatchObject({ rawActive: 0, queued: 0, admitted: 3, completions: 3 })
  } finally { gate.resolve(); h.r.dispose(); await h.r.idle() }
})
test('virtual timeout preserves raw reservation; no retry, no late report or budget widening', async () => {
  const clock = new ManualClock(), restore = clock.install(), gate = deferred(); let calls = 0
  const h = runtime({ async run({ lease }) { calls++; lease!.consume('workerDispatches', 1); await gate.promise; return { status: 'prepared', report: { text: 'late' } } } }, { maxActive: 1, maxQueued: 0, jobTimeoutMs: 10 }, true)
  try {
    const pending = h.fire('a'); await clock.advance(9); expect(h.r.getStatus().logicalActive).toBe(1)
    await clock.advance(1); expect((await pending)[0]).toMatchObject({ status: 'uncertain', reason: 'job_timeout', reported: false })
    expect(h.r.getStatus()).toMatchObject({ rawActive: 1, logicalActive: 0 })
    expect(h.budget.usage('m')).toMatchObject({ caps: { workerDispatches: 2 }, reserved: { workerDispatches: 1 } })
    expect((await h.fire('a'))[0]!.reason).toBe('duplicate:uncertain')
    expect((await h.fire('b'))[0]!.reason).toBe('queue_full')
    h.budget.revoke('m'); expect((await h.fire('c'))[0]!.reason).toBe('budget_revoked')
    gate.resolve(); await h.r.idle(); expect(h.budget.getStatus().windows).toBe(0)
    expect(h.reports).toEqual([]); expect(calls).toBe(1); expect(h.r.getStatus().completions).toBe(1); expect(clock.pending).toBe(0)
  } finally { gate.resolve(); h.r.dispose(); await h.r.idle(); restore() }
})
for (const action of ['caller', 'stop', 'dispose'] as const) test(`${action} cancels active and queued work; late results cannot report`, async () => {
  const gate = deferred(), abort = new AbortController(); let calls = 0
  const h = runtime({ async run() { calls++; await gate.promise; return { status: 'prepared' } } }, { maxActive: 1, maxQueued: 1 })
  try {
    const a = h.fire('a', abort.signal), b = h.fire('b', abort.signal)
    if (action === 'caller') abort.abort(); else h.r[action]()
    expect((await a)[0]!.status).toBe('uncertain'); expect((await b)[0]!.status).toBe('skipped')
    expect(h.r.getStatus()).toMatchObject({ rawActive: 1, queued: 0, logicalActive: 0 })
    gate.resolve(); await h.r.idle(); expect(calls).toBe(1); expect(h.reports).toEqual([])
    expect(h.r.getStatus()).toMatchObject({ rawActive: 0, completions: 2 })
  } finally { gate.resolve(); h.r.dispose(); await h.r.idle() }
})
test('already-aborted caller never starts raw work or spends budget', async () => {
  const abort = new AbortController(); abort.abort(); let calls = 0
  const h = runtime({ run() { calls++; return { status: 'prepared' } } }, {}, true)
  try { expect((await h.fire('a', abort.signal))[0]!.reason).toBe('caller_aborted'); await h.r.idle(); expect(calls).toBe(0); expect(h.budget.usage('m')?.reserved.workerDispatches).toBe(0) }
  finally { h.r.dispose() }
})
test('never-settling work remains accounted after dispose; idle does not pretend to drain', async () => {
  const h = runtime({ run: () => new Promise<JobResult>(() => {}) }, { maxActive: 1, maxQueued: 0 })
  const pending = h.fire('never'); h.r.dispose()
  expect((await pending)[0]!.status).toBe('uncertain')
  let idle = false; void h.r.idle().then(() => { idle = true }); await flush()
  expect(idle).toBe(false); expect(h.r.getStatus()).toMatchObject({ state: 'disposed', rawActive: 1, queued: 0, logicalActive: 0 })
  expect(() => h.r.start()).toThrow('disposed')
  // No physical settlement exists. Do not await idle or claim physical cancellation.
})
for (const [stage, calls, reports] of [['off', 0, 0], ['observe', 0, 0], ['shadow', 1, 0], ['active', 1, 1]] as const) test(`${stage} stage job/report semantics`, async () => {
  let count = 0
  const h = runtime({ run() { count++; return { status: 'prepared' } } }, { modules: [moduleSpec('m', stage)] })
  try { await h.fire('a'); await h.r.idle(); expect(count).toBe(calls); expect(h.reports).toHaveLength(reports) }
  finally { h.r.dispose() }
})
test('shadow does not invoke effectful jobs; disabled jobs need no handlers', async () => {
  const spec = moduleSpec('m', 'shadow', false, 'automatic'); let count = 0
  const h = runtime({ run() { count++; return { status: 'executed', effectId: 'effect' } } }, { modules: [spec] })
  try { expect((await h.fire('a'))[0]!.reason).toBe('stage:shadow-effects-withheld'); expect(count).toBe(0) }
  finally { h.r.dispose() }
  const disabled = { ...spec, stage: 'active' as const, jobs: effectiveMonitoringJobs(spec.declaration, [{ id: 'job', enabled: false }], '/jobs')! }
  const d = runtime({ run: () => ({ status: 'prepared' }) }, { modules: [disabled], handlers: {} })
  try { expect((await d.fire('a'))[0]!.reason).toBe('job_disabled') } finally { d.r.dispose() }
})
test('configuration only tightens watches, stage, risk and reports; job grants remain frozen', () => {
  const spec = moduleSpec('m', 'active', false, 'automatic'), declaration = spec.declaration
  const jobs = effectiveMonitoringJobs(declaration, [{ id: 'job', riskTier: 'proposal', report: 'never' }], '/jobs')!
  expect(jobs[0]!.riskTier).toBe('proposal'); expect(jobs[0]!.declared.grants).toEqual({ actions: [], referenceKinds: [] })
  expect(Object.isFrozen(jobs[0]!.declared.grants)).toBe(true)
  expect(effectiveMonitoringWatch(declaration, ['tool.after'], '/watch')).toEqual(['tool.after'])
  expect(() => effectiveMonitoringWatch(declaration, ['input'], '/watch')).toThrow()
  expect(() => effectiveMonitoringJobs(moduleSpec().declaration, [{ id: 'job', riskTier: 'automatic' }], '/jobs')).toThrow()
  expect(() => effectiveMonitoringJobs(declaration, [{ id: 'job', report: 'on-result' }], '/jobs')).toThrow()
  expect(effectiveMonitoringStage({ ...declaration, maxStage: 'shadow' }, 'observe', '/stage')).toBe('observe')
  expect(() => effectiveMonitoringStage({ ...declaration, maxStage: 'observe' }, 'active', '/stage')).toThrow()
})
test('own report origin and excessive cross-module depth cannot create a feedback loop', async () => {
  let calls = 0; const h = runtime({ run() { calls++; return { status: 'prepared' } } })
  try {
    await h.fire('a'); expect(h.reports).toHaveLength(1)
    for (const origin of [{ moduleId: 'm', jobId: 'job', depth: 0 }, { moduleId: 'other', jobId: 'job', depth: 1 }]) {
      expect((await h.fire('feedback', undefined, { origin }))[0]!.reason).toBe('loop_guard')
    }
    expect(calls).toBe(1)
  } finally { h.r.dispose(); await h.r.idle() }
})
test('bounded outcomes and identity counts after 64 drained jobs; missing handler rejects registration', async () => {
  const store = new MemoryIdempotencyStore(64), h = runtime({ run: () => ({ status: 'prepared' }) }, { maxOutcomes: 4, idempotency: store })
  try {
    for (let i = 0; i < 64; i++) await h.fire(`e:${i}`)
    await h.r.idle(); expect(h.r.getStatus()).toMatchObject({ rawActive: 0, queued: 0, outcomesRetained: 4, outcomesEvicted: 60 })
    expect(store.getStatus()).toEqual({ keys: 64, maxKeys: 64 })
    expect((await h.fire('overflow'))[0]!.reason).toBe('idempotency_capacity')
    expect((await h.fire('e:0'))[0]!.reason).toBe('duplicate:prepared')
  } finally { h.r.dispose() }
  expect(() => runtime({ run: () => ({ status: 'prepared' }) }, { handlers: {} })).toThrow('missing job handler')
})
test('budget per-run and kind ceilings cannot widen in handler code', async () => {
  const h = runtime({ run({ lease }) { lease!.consume('workerDispatches', 2); return { status: 'prepared' } } }, {}, true)
  try { expect((await h.fire('a'))[0]).toMatchObject({ status: 'uncertain', reason: 'budget_per_run_exceeded:workerDispatches' }); await h.r.idle(); expect(h.reports).toEqual([]) }
  finally { h.r.dispose() }
})
test('FINDING: untyped worker result with unsupported status reaches outcome and report', async () => {
  const port = createInMemoryWorkerPort<WorkerJobRequest, JobResult>(() => ({ status: 'invalid-status', report: { text: 'invalid result' } }) as unknown as JobResult)
  const h = runtime({ run: () => ({ status: 'prepared' }) }, { workerPort: port })
  try {
    expect((await h.fire('a'))[0]).toMatchObject({ status: 'invalid-status', reported: true })
    expect(h.reports).toHaveLength(1); expect((await h.fire('a'))[0]!.reason).toBe('duplicate:invalid-status')
  } finally { h.r.dispose(); await h.r.idle() }
})
