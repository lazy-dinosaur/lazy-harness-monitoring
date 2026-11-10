import { expect, test } from 'bun:test'
import { effectiveMonitoringJobs } from '@lazy-harness/monitoring-core'
import { ApprovedBudgetGate, MonitoringModuleRuntime, monitoringReportId, type RuntimeOptions } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createScenario } from '../../../examples/p1/support.ts'
import { piDeliveryProbe } from '../../../examples/p1/api-consumer.ts'

test('only matching explicit enqueue acceptance reports success; failures never rerun a prepared handler', async () => {
  const c = createScenario({ id: 'review.receipts', events: ['user.prompt'], kinds: ['user-text'] })
  try {
    const sinks: Array<[RuntimeOptions['report'], 'failed' | 'unknown' | 'enqueued']> = [
      [undefined, 'failed'],
      [r => ({ reportId: monitoringReportId(r), status: 'failed' }), 'failed'],
      [r => ({ reportId: monitoringReportId(r), status: 'unknown' }), 'unknown'],
      [() => ({ reportId: 'wrong', status: 'enqueued' }), 'unknown'],
      [(() => undefined) as any, 'unknown'],
      [() => { throw new Error('receiver failed') }, 'unknown'],
      [r => ({ reportId: monitoringReportId(r), status: 'enqueued' }), 'enqueued'],
    ]
    for (const [report, status] of sinks) {
      let calls = 0
      const r = new MonitoringModuleRuntime({ modules: [{ moduleId: 'review.receipts', declaration: c.declaration,
        declarationHash: c.binding.declarationHash!, jobs: effectiveMonitoringJobs(c.declaration, undefined, '/jobs')! }],
        budget: new ApprovedBudgetGate(), report, handlers: { 'review.receipts.prepare': { run() { calls++; return { status: 'prepared', report: { text: 'advice' } } } } } })
      const trigger = { moduleId: 'review.receipts', eventId: 'e', sessionId: 'synthetic-session', evidence: [] }
      const o = (await r.onTrigger(trigger))[0]!
      expect(o.reportReceipt?.status).toBe(status); expect(o.reported).toBe(status === 'enqueued')
      expect((await r.onTrigger(trigger))[0]!.reason).toBe('duplicate:prepared'); expect(calls).toBe(1)
      await r.idle(); r.dispose()
    }
  } finally { await c.close() }
})
test('Pi enqueue and hook delivery are separate matching receipts, with stale/scope refusal', () => {
  const p = piDeliveryProbe()
  const report = { moduleId: 'm', jobId: 'j', eventId: 'e', sessionId: 'synthetic-session', mode: 'on-result' as const, text: 'advice', riskTier: 'read-only' }
  const receipt = p.delivery.enqueue(report)
  expect(receipt).toEqual({ reportId: monitoringReportId(report), status: 'enqueued' })
  expect(p.delivery.deliveryReceipts).toEqual([])
  expect(p.delivery.enqueue(report).status).toBe('failed')
  p.hooks.get('context_with_system')!({ messages: [] }, p.ctx)
  expect(p.delivery.deliveryReceipts).toEqual([{ reportId: receipt.reportId, status: 'delivered', kind: 'hook-boundary', boundary: 'context_with_system' }])
  p.hooks.get('context_with_system')!({ messages: [] }, p.ctx)
  expect(p.delivery.deliveryReceipts).toHaveLength(1)
  expect(p.delivery.enqueue({ ...report, sessionId: 'other' }).status).toBe('failed')
  expect(p.delivery.enqueue({ ...report, eventId: 'stale' }, { dependencies: [{ id: 'source', version: 'old' }] }).status).toBe('enqueued')
  p.hooks.get('context_with_system')!({ messages: [] }, p.ctx)
  expect(p.delivery.deliveryReceipts).toHaveLength(1)
})
