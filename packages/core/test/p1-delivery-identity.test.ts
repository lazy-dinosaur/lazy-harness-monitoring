import { expect, test } from 'bun:test'
import { piDeliveryProbe } from '../../../examples/p1/api-consumer.ts'
const report = { moduleId: 'review.ids', jobId: 'prepare', eventId: 'e', sessionId: 'synthetic-session', mode: 'on-result' as const, text: 'advice', riskTier: 'read-only' }
test('stable report content IDs survive repeated hooks and later input boundaries; revisions remain distinct', () => {
  const p = piDeliveryProbe(), hook = p.hooks.get('context_with_system')!
  expect(p.delivery.onReport(report)).toBe(true)
  expect((hook({ messages: [] }, p.ctx) as any).messages).toHaveLength(1)
  expect(hook({ messages: [] }, p.ctx)).toBeUndefined()
  p.hooks.get('input')!({}, p.ctx)
  expect(p.delivery.onReport({ ...report })).toBe(false)
  expect(p.delivery.onReport({ ...report, text: 'revised advice' })).toBe(true)
  expect((hook({ messages: [] }, p.ctx) as any).messages).toHaveLength(1)
  expect(new Set(p.delivery.delivered.map(d => d.item.id)).size).toBe(2)
})
test('dependency ordering is not a new report; changed source and session are refused', () => {
  const p = piDeliveryProbe(), dependencies = [{ id: 'a', version: 'r1' }, { id: 'b', version: 'r1' }]
  expect(p.delivery.onReport(report, { dependencies })).toBe(true)
  expect(p.delivery.onReport(report, { dependencies: [...dependencies].reverse() })).toBe(false)
  expect(p.delivery.onReport({ ...report, sessionId: 'other' })).toBe(false)
  p.hooks.get('context_with_system')!({ messages: [] }, p.ctx)
  expect(p.delivery.onReport({ ...report, text: 'stale' }, { dependencies: [{ id: 'a', version: 'old' }] })).toBe(true)
  expect(p.hooks.get('context_with_system')!({ messages: [] }, p.ctx)).toBeUndefined()
  expect(p.mailbox.traces.at(-1)?.reason).toBe('source_changed')
})
test('installing delivery repeatedly on the same hook registry is idempotent', () => {
  const p = piDeliveryProbe(), counts = new Map<string, number>()
  const registry = { on(name: string) { counts.set(name, (counts.get(name) ?? 0) + 1) } }
  p.delivery.extension(registry); p.delivery.extension(registry)
  expect(counts.get('context_with_system')).toBe(1)
  expect(counts.get('input')).toBe(1)
})
