import { afterAll, beforeAll, expect, test } from 'bun:test'
import { ContextCarryMailbox } from '@lazy-harness/monitoring-core/engine/monitoring-core-context-mailbox.ts'
import { createParentReportDelivery } from '../src/index.ts'
import { realSdk, fauxApi as ai } from './support/real-sdk.ts'

let original: typeof fetch, attempts = 0
beforeAll(() => { original = globalThis.fetch; globalThis.fetch = Object.assign(async () => { attempts++; throw new Error('network forbidden') }, original) as typeof fetch })
afterAll(() => { globalThis.fetch = original; expect(attempts).toBe(0) })

test('FINDING: hook-delivered receipt does not prove provider receipt after later context transform', async () => {
  const mailbox = new ContextCarryMailbox({ maxAgeMs: 10000, maxCarryTurns: 1, maxItems: 4, maxTextBytes: 4096, sourceVersion: () => 'v1' })
  const delivery = createParentReportDelivery({ mailbox })
  const f = await realSdk({ extensions: [delivery.extension, pi => {
    pi.on('context_with_system', event => ({ messages: event.messages.filter(message => !JSON.stringify(message).includes('P3_DROPPED_REPORT')) }))
  }] })
  try {
    expect(delivery.enqueue({ moduleId: 'p3', jobId: 'prepare', eventId: 'event', sessionId: f.session.sessionManager.getSessionId(),
      mode: 'on-result', riskTier: 'read-only', text: 'P3_DROPPED_REPORT' }).status).toBe('enqueued')
    f.setSteps([ai.fauxAssistantMessage('answer')]); await f.session.prompt('next')
    expect(f.errors).toEqual([]); expect(delivery.deliveryReceipts).toHaveLength(1)
    expect(JSON.stringify(f.requests)).not.toContain('P3_DROPPED_REPORT')
  } finally { await f.dispose() }
})

test('SDK later context transformer differs from observer position, never advertised as full provider context', async () => {
  const f = await realSdk({ extensions: [pi => { pi.on('context_with_system', event => ({ messages: [...event.messages,
    { role: 'user', content: 'LATER_TRANSFORM', timestamp: 1 }] })) }] })
  try {
    f.setSteps([ai.fauxAssistantMessage('answer')]); await f.session.prompt('input')
    const frame = f.observer.frames.find(frame => frame.sourceEvent === 'context_with_system')!
    expect(frame.snapshot.fullProviderContext).toBe(false)
    expect(JSON.stringify(frame.snapshot.observedMessages)).not.toContain('LATER_TRANSFORM')
    expect(JSON.stringify(f.requests[0])).toContain('LATER_TRANSFORM')
    expect(f.errors).toEqual([])
  } finally { await f.dispose() }
})

test('SDK message-count limit is unavailable while opt-in tail remains bounded and observable', async () => {
  const full = await realSdk({ limits: { maxMessages: 1 } }), tail = await realSdk({ limits: { maxMessages: 1, tailMessages: 1 } })
  try {
    for (const f of [full, tail]) {
      f.setSteps([ai.fauxAssistantMessage('first'), ai.fauxAssistantMessage('second')]); await f.session.prompt('first'); await f.session.prompt('second'); await f.observer.idle()
      expect(f.errors).toEqual([])
    }
    expect(full.observer.outcomes.some(o => o.status === 'unavailable')).toBe(true)
    expect(tail.observer.outcomes.some(o => o.status === 'unavailable')).toBe(false)
    expect(tail.observer.frames.every(frame => frame.available && frame.snapshot.canonicalMessages.length <= 1)).toBe(true)
    expect(tail.observer.frames.some(frame => frame.snapshot.truncatedHead! > 0)).toBe(true)
  } finally { await full.dispose(); await tail.dispose() }
})
