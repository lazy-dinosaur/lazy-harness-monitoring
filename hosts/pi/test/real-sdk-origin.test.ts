import { afterAll, beforeAll, expect, test } from 'bun:test'
import { pipelineFixture } from './support/pipeline.ts'
import { fauxApi as ai, deferred } from './support/real-sdk.ts'

let original: typeof fetch, attempts = 0
beforeAll(() => { original = globalThis.fetch; globalThis.fetch = Object.assign(async () => { attempts++; throw new Error('network forbidden') }, original) as typeof fetch })
afterAll(() => { globalThis.fetch = original; expect(attempts).toBe(0) })

test('SDK delayed same-branch worker report is accepted once with captured origin', async () => {
  const entered = deferred(), release = deferred()
  const x = await pipelineFixture({ worker: async () => { entered.resolve(); await release.promise; return { status: 'prepared', report: { text: 'SAME_BRANCH_REPORT' } } } })
  try {
    x.f.setSteps([ai.fauxAssistantMessage('first')]); await x.f.session.prompt('source')
    const draining = x.drain(); await entered.promise
    const origin = x.delivery.captureOrigin()
    expect(Object.isFrozen(origin)).toBe(true)
    const r = { moduleId: 'p3', jobId: 'prepare', eventId: 'foreign', sessionId: origin.sessionId, mode: 'on-result' as const, riskTier: 'read-only', text: 'FORGED_ORIGIN' }
    expect(x.delivery.enqueue(r, { origin: { ...origin } })).toMatchObject({ status: 'failed', reason: 'scope_mismatch' })
    release.resolve(); await draining
    expect(x.runtime.outcomes[0]!.reported).toBe(true)
    x.f.setSteps([ai.fauxAssistantMessage('next'), ai.fauxAssistantMessage('last')])
    await x.f.session.prompt('next'); await x.f.session.prompt('last')
    expect(JSON.stringify(x.f.requests[1])).toContain('SAME_BRANCH_REPORT')
    expect(JSON.stringify(x.f.requests[2])).not.toContain('SAME_BRANCH_REPORT')
    expect(JSON.stringify(x.f.requests)).not.toContain('FORGED_ORIGIN')
    expect(x.delivery.deliveryReceipts).toHaveLength(1)
  } finally { release.resolve(); await x.dispose() }
})
