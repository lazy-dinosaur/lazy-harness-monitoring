import { expect, test } from 'bun:test'
import { effectiveMonitoringJobs, validateMonitoringModuleDeclaration } from '@lazy-harness/monitoring-core'
import { monitoringReportId, ApprovedBudgetGate, MonitoringModuleRuntime, type JobHandler, type RuntimeOptions } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
function runtime(handler: JobHandler, options: Partial<RuntimeOptions> = {}, costly = false) {
  const { declaration, hash } = validateMonitoringModuleDeclaration({ purpose: { question: { instructions: 'q', criteria: { run: 'r', skip: 's', defer: 'd' } } },
    watch: { events: ['input'], kinds: ['user-text'] }, jobs: [{ id: 'job', form: 'template', riskTier: 'read-only', idempotency: 'per-event', output: 'candidate',
      report: { supported: ['always'], default: 'always' }, grants: { actions: [], referenceKinds: [] },
      ...(costly ? { cost: { models: [{ role: 'worker', profile: 'w' }], caps: { workerDispatches: 1 } } } : {}) }] }, { actions: [], referenceKinds: [] })
  const budget = new ApprovedBudgetGate(); if (costly) budget.approve({ moduleId: 'm', caps: { workerDispatches: 2 }, approvedBy: 'fixture' })
  const reports: unknown[] = []
  const r = new MonitoringModuleRuntime({ modules: [{ moduleId: 'm', declaration, declarationHash: hash, jobs: effectiveMonitoringJobs(declaration, undefined, '/jobs')!, stage: 'active' }],
    budget, handlers: { 'm.job': handler }, report: r => { reports.push(r); return { reportId: monitoringReportId(r), status: 'enqueued' } }, ...options })
  const fire = (eventId: string, signal?: AbortSignal) => r.onTrigger({ moduleId: 'm', sessionId: 's', eventId, evidence: [] }, signal)
  return { r, fire, reports, budget }
}
test('runtime global raw concurrency and queue bound apply across simultaneous triggers', async () => {
  const gate = deferred(); let calls = 0
  const h = runtime({ async run() { calls++; await gate.promise; return { status: 'prepared' } } }, { maxActive: 1, maxQueued: 1 })
  const a = h.fire('a'), b = h.fire('b'), c = await h.fire('c')
  expect(c[0]!.reason).toBe('queue_full'); expect(calls).toBe(1)
  expect(h.r.getStatus()).toMatchObject({ rawActive: 1, queued: 1 })
  gate.resolve(); await Promise.all([a, b]); await h.r.idle()
  expect(calls).toBe(2); expect(h.r.getStatus().rawActive).toBe(0); h.r.dispose()
})
test('logical timeout retains raw slot and budget; late result never reports or double-completes', async () => {
  const gate = deferred(); let calls = 0
  const h = runtime({ async run() { calls++; await gate.promise; return { status: 'prepared', report: { text: 'late' } } } }, { maxActive: 1, maxQueued: 0, jobTimeoutMs: 5 }, true)
  const first = await h.fire('a')
  expect(first[0]).toMatchObject({ status: 'uncertain', reason: 'job_timeout', reported: false })
  expect(h.budget.usage('m')?.reserved.workerDispatches).toBe(1)
  expect((await h.fire('b'))[0]!.reason).toBe('queue_full')
  expect(h.r.getStatus()).toMatchObject({ rawActive: 1, logicalActive: 0 })
  expect(() => { h.r.stop(); h.r.start() }).toThrow('raw work still active')
  gate.resolve(); await h.r.idle(); h.r.start()
  expect(h.budget.usage('m')?.reserved.workerDispatches).toBe(0)
  expect(h.reports).toHaveLength(0); expect(calls).toBe(1)
  expect((await h.fire('a'))[0]!.reason).toBe('duplicate:uncertain')
  expect(h.r.getStatus().completions).toBe(1); h.r.dispose()
})
test('stop cancels active and queued work; dispose is permanent and raw idle waits', async () => {
  const gate = deferred(); let calls = 0
  const h = runtime({ async run() { calls++; await gate.promise; return { status: 'prepared' } } }, { maxActive: 1, maxQueued: 1 })
  const a = h.fire('a'), b = h.fire('b'); h.r.stop()
  expect((await a)[0]!.status).toBe('uncertain'); expect((await b)[0]!.status).toBe('skipped')
  expect((await h.fire('c'))[0]!.reason).toBe('runtime_stopped'); expect(calls).toBe(1)
  gate.resolve(); await h.r.idle(); h.r.start(); h.r.dispose()
  expect((await h.fire('d'))[0]!.reason).toBe('runtime_disposed')
  expect(() => h.r.start()).toThrow('disposed')
})
test('caller cancellation, cooperative abort, and lifetime limits are explicit', async () => {
  const h = runtime({ run({ signal }) { return new Promise(resolve => signal.addEventListener('abort', () => resolve({ status: 'prepared' }), { once: true })) } }, { maxWork: 1 })
  const controller = new AbortController(), a = h.fire('a', controller.signal); controller.abort()
  expect((await a)[0]!.status).toBe('uncertain'); await h.r.idle()
  expect((await h.fire('b'))[0]!.reason).toBe('lifetime_limit')
  h.r.stop(); h.r.start(); expect((await h.fire('c'))[0]!.reason).toBe('lifetime_limit'); h.r.dispose()
})
