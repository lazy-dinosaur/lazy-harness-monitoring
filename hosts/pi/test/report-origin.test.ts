import { expect, test } from 'bun:test'
import { ContextCarryMailbox } from '@lazy-harness/monitoring-core/engine/monitoring-core-context-mailbox.ts'
import { createParentReportDelivery } from '../src/index.ts'

for (const mode of ['missing', 'throws', 'changed', 'current'] as const) test(`captured dependencies are immutable and ${mode} resolver fails closed unless current`, () => {
  const sourceVersion = mode === 'missing' ? undefined : (_id: string) => { if (mode === 'throws') throw new Error('unavailable'); return mode === 'current' ? 'v1' : 'v2' }
  const mailbox = new ContextCarryMailbox({ maxAgeMs: 10000, maxCarryTurns: 1, maxItems: 4, maxTextBytes: 4096, sourceVersion: sourceVersion ?? (() => undefined) })
  const delivery = createParentReportDelivery({ mailbox, ...(sourceVersion ? { sourceVersion } : {}) })
  const hooks = new Map<string, (event: any, ctx: any) => unknown>()
  delivery.extension({ on: (name, handler) => { hooks.set(name, handler) } })
  hooks.get('session_start')!({}, { sessionManager: { getSessionId: () => 'session' } })
  const dependencies = [{ id: 'selected-material', version: 'v1' }]
  const origin = delivery.captureOrigin(dependencies)
  dependencies[0]!.version = 'v2'; dependencies.length = 0
  expect(origin.dependencies).toEqual([{ id: 'selected-material', version: 'v1' }])
  expect(Object.isFrozen(origin.dependencies)).toBe(true)
  expect(Object.isFrozen(origin.dependencies[0])).toBe(true)
  const receipt = delivery.enqueue({ moduleId: 'test', jobId: 'prepare', eventId: 'event', sessionId: 'session', mode: 'on-result', riskTier: 'read-only', text: 'report' }, { origin })
  expect(receipt.status).toBe(mode === 'current' ? 'enqueued' : 'failed')
  expect(mailbox.getStatus().pending).toBe(mode === 'current' ? 1 : 0)
})
