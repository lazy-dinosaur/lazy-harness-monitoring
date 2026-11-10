import { expect, test } from 'bun:test'
import { createInMemoryWorkerPort, runWorkerPortConformance, type WorkerPortFactory, type WorkerExecutionPort, type WorkerJobRequest, effectiveMonitoringJobs } from '@lazy-harness/monitoring-core'
import { MonitoringModuleRuntime, ApprovedBudgetGate, type JobResult } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createScenario } from '../../../examples/p1/support.ts'

test('public in-memory worker port passes reusable timeout/cancel/concurrency/lifetime conformance', async () => {
  const result = await runWorkerPortConformance(createInMemoryWorkerPort)
  expect(result.checks.length).toBeGreaterThanOrEqual(20)
  expect(result.checks).toContain('late result cannot double-complete timeout')
})
test('reusable worker conformance detects a fake that ignores cancellation', async () => {
  const broken: WorkerPortFactory = (operation, limits) => ({ ...createInMemoryWorkerPort(operation, limits), cancel() {} })
  await expect(runWorkerPortConformance(broken)).rejects.toThrow('conformance')
})
test('runtime dispatches through supplied worker port, not its legacy handler, and honors receipts', async () => {
  const c = createScenario({ id: 'review.port', events: ['user.prompt'], kinds: ['user-text'] })
  let calls = 0, legacyCalls = 0
  const port: WorkerExecutionPort<WorkerJobRequest, JobResult> = createInMemoryWorkerPort(request => {
    calls++; expect(request.handlerId).toBe('review.port.prepare')
    expect(request.context.trigger.eventId).toBe('e')
    return { status: 'prepared' }
  })
  const modules = [{ moduleId: 'review.port', declaration: c.declaration, declarationHash: c.binding.declarationHash!, jobs: effectiveMonitoringJobs(c.declaration, undefined, '/jobs')! }]
  const r = new MonitoringModuleRuntime({ modules, budget: new ApprovedBudgetGate(), workerPort: port,
    handlers: { 'review.port.prepare': { run() { legacyCalls++; throw new Error('legacy must not run') } } } })
  try {
    expect((await r.onTrigger({ moduleId: 'review.port', sessionId: 's', eventId: 'e', evidence: [] }))[0]!.status).toBe('prepared')
    await r.idle(); expect(calls).toBe(1); expect(legacyCalls).toBe(0)
    expect(() => new MonitoringModuleRuntime({ modules, budget: new ApprovedBudgetGate(), handlers: {}, workerPort: port, maxActive: 1 })).toThrow('exceeds runtime limits')
  } finally { r.dispose(); await r.idle(); await c.close() }
})
test('in-memory worker tickets cannot be reused across ports or forged', async () => {
  const a = createInMemoryWorkerPort((n: number) => n), b = createInMemoryWorkerPort((n: number) => n)
  const t = a.begin(1)
  expect(() => b.wait(t)).toThrow('foreign worker ticket')
  expect(() => a.cancel({ id: t.id })).toThrow('foreign worker ticket')
  await a.wait(t); await a.idle(); a.dispose(); b.dispose()
})
