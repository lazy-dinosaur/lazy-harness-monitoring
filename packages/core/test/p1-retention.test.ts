import { expect, test } from 'bun:test'
import { effectiveMonitoringJobs, validateMonitoringModuleDeclaration } from '@lazy-harness/monitoring-core'
import { ApprovedBudgetGate, MemoryIdempotencyStore, MonitoringModuleRuntime } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { piDeliveryProbe } from '../../../examples/p1/api-consumer.ts'

test('finite retention exercise evicts diagnostics but never reopens uncertain or prepared keys; overflow refuses', async () => {
  const { declaration, hash } = validateMonitoringModuleDeclaration({ purpose: { question: { instructions: 'q', criteria: { run: 'r', skip: 's', defer: 'd' } } },
    watch: { events: ['input'], kinds: ['user-text'] }, jobs: [{ id: 'job', form: 'template', riskTier: 'read-only', idempotency: 'per-event', output: 'candidate',
      report: { supported: ['never'], default: 'never' }, grants: { actions: [], referenceKinds: [] } }] }, { actions: [], referenceKinds: [] })
  let calls = 0; const store = new MemoryIdempotencyStore(100)
  const r = new MonitoringModuleRuntime({ modules: [{ moduleId: 'm', declaration, declarationHash: hash, jobs: effectiveMonitoringJobs(declaration, undefined, '/jobs')!, stage: 'active' }],
    budget: new ApprovedBudgetGate(), idempotency: store, maxOutcomes: 8,
    handlers: { 'm.job': { run: () => { calls++; return { status: calls === 1 ? 'unknown' : 'prepared' } } } } })
  const fire = (eventId: string) => r.onTrigger({ moduleId: 'm', eventId, sessionId: 's', evidence: [] })
  for (let i = 0; i < 100; i++) await fire(`e${i}`)
  expect(r.outcomes).toHaveLength(8); expect(r.getStatus().outcomesEvicted).toBe(92)
  expect((await fire('e0'))[0]!.reason).toBe('duplicate:uncertain')
  expect((await fire('e1'))[0]!.reason).toBe('duplicate:prepared')
  expect((await fire('overflow'))[0]!.reason).toBe('idempotency_capacity')
  expect(calls).toBe(100); expect(store.getStatus().keys).toBe(100)
  await r.idle(); r.dispose()
})
test('mailbox seen-key capacity fails closed after diagnostic eviction, without duplicate delivery', () => {
  const p = piDeliveryProbe({ maxSeen: 3, maxTrace: 2, maxDelivered: 1 })
  const report = { moduleId: 'm', jobId: 'j', eventId: 'e0', sessionId: 'synthetic-session', mode: 'on-result' as const, text: 'advice', riskTier: 'read-only' }
  for (let i = 0; i < 3; i++) {
    expect(p.delivery.onReport({ ...report, eventId: `e${i}` })).toBe(true)
    p.hooks.get('context_with_system')!({ messages: [] }, p.ctx)
  }
  expect(p.delivery.onReport(report)).toBe(false)
  expect(p.mailbox.traces.at(-1)?.reason).toBe('duplicate')
  expect(p.delivery.onReport({ ...report, eventId: 'e3' })).toBe(false)
  expect(p.mailbox.traces.at(-1)?.reason).toBe('seen_capacity')
  expect(p.mailbox.getStatus()).toMatchObject({ pending: 0, seen: 3, traces: 2 })
  expect(p.delivery.getStatus()).toEqual({ deliveredRetained: 1, deliveredEvicted: 2 })
})
test('budget approval capacity, explicit revocation and live reservation protection have separate lifetimes', () => {
  const budget = new ApprovedBudgetGate(1)
  budget.approve({ moduleId: 'm', caps: { workerDispatches: 2 }, approvedBy: 'fixture' })
  const lease = budget.reserve('m', 'j', { workerDispatches: 1 }).lease!
  expect(() => budget.approve({ moduleId: 'other', caps: { workerDispatches: 1 }, approvedBy: 'fixture' })).toThrow('capacity')
  expect(() => budget.approve({ moduleId: 'm', caps: { workerDispatches: 4 }, approvedBy: 'fixture' })).toThrow('live reservations')
  budget.revoke('m'); expect(budget.reserve('m', 'j', { workerDispatches: 1 }).reason).toBe('budget_revoked')
  expect(budget.getStatus().windows).toBe(1)
  lease.settle(); expect(budget.getStatus().windows).toBe(0)
  budget.approve({ moduleId: 'other', caps: { workerDispatches: 1 }, approvedBy: 'fixture' })
  expect(budget.getStatus().windows).toBe(1)
})
