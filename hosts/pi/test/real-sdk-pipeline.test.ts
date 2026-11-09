import { afterAll, beforeAll, expect, test } from 'bun:test'
import { frameSequenceIssues } from '@lazy-harness/monitoring-core/host'
import { piHostCapabilities } from '../src/index.ts'
import { pipelineFixture } from './support/pipeline.ts'
import { fauxApi as ai, deferred } from './support/real-sdk.ts'

let saved: typeof fetch, attempts = 0
beforeAll(() => { saved = globalThis.fetch; globalThis.fetch = Object.assign(async () => { attempts++; throw new Error('network forbidden') }, saved) as typeof fetch })
afterAll(() => { globalThis.fetch = saved; expect(attempts).toBe(0) })

test('SDK hooks → conformant frames → selection → worker port → report → NEXT actual model input once', async () => {
  const x = await pipelineFixture()
  try {
    x.f.setSteps([ai.fauxAssistantMessage('first'), ai.fauxAssistantMessage('second'), ai.fauxAssistantMessage('third')])
    await x.f.session.prompt('SELECTED_EXACT_USER_BODY'); await x.drain()
    expect(frameSequenceIssues(x.f.observer.frames, piHostCapabilities)).toEqual([])
    expect(x.f.errors).toEqual([]); expect(x.calls).toHaveLength(1); expect(x.packets).toHaveLength(1)
    const source = x.f.observer.frames.find(frame => frame.sourceEvent === 'input')!
    expect(x.calls[0]!.context.trigger.eventId).toBe(source.id)
    expect(x.calls[0]!.context.trigger.evidence.map(e => e.text)).toEqual(['SELECTED_EXACT_USER_BODY'])
    expect(x.reports).toHaveLength(1); expect(x.runtime.outcomes[0]!.reportReceipt?.status).toBe('enqueued')
    expect(x.delivery.deliveryReceipts).toEqual([]); expect(JSON.stringify(x.f.requests[0])).not.toContain('P3_PIPELINE_REPORT')
    await x.f.session.prompt('next actual request')
    expect(JSON.stringify(x.f.requests[1])).toContain('P3_PIPELINE_REPORT')
    await x.f.session.prompt('third actual request')
    expect(JSON.stringify(x.f.requests[2])).not.toContain('P3_PIPELINE_REPORT')
    expect(x.delivery.deliveryReceipts).toHaveLength(1)
    expect(x.delivery.deliveryReceipts[0]).toMatchObject({ kind: 'hook-boundary', boundary: 'context_with_system' })
    expect(x.delivery.delivered[0]!.item.reportId).toBe(x.runtime.outcomes[0]!.reportReceipt!.reportId)
    expect(x.delivery.delivered[0]!.item.dependencies).toEqual(x.packets[0]!.materials.map(({ id, version }) => ({ id, version })))
    expect(x.delivery.delivered[0]!.item.dependencies.length).toBeGreaterThan(0)
  } finally { await x.dispose() }
})

for (const mode of ['skip', 'defer'] as const) test(`SDK scripted ${mode} never dispatches worker or injects report`, async () => {
  const x = await pipelineFixture({ mode })
  try {
    x.f.setSteps([ai.fauxAssistantMessage('first'), ai.fauxAssistantMessage('second')])
    await x.f.session.prompt('no dispatch'); await x.drain(); await x.f.session.prompt('next')
    expect(x.calls).toHaveLength(0); expect(x.reports).toEqual([]); expect(JSON.stringify(x.f.requests)).not.toContain('P3_PIPELINE_REPORT')
  } finally { await x.dispose() }
})

for (const transition of ['input', 'tree', 'compact', 'session'] as const) test(`SDK ${transition} change rejects late selection before worker handoff`, async () => {
  const release = deferred(), x = await pipelineFixture({ judgeGate: release.promise })
  try {
    x.f.setSteps([ai.fauxAssistantMessage('seed'), ai.fauxAssistantMessage('answer')])
    await x.f.session.prompt('seed padding '.repeat(100)); await x.f.session.prompt('old evidence padding '.repeat(100))
    if (transition === 'input') { x.f.setSteps([ai.fauxAssistantMessage('new')]); await x.f.session.prompt('new intent') }
    if (transition === 'tree') {
      const user = x.f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'user')!
      await x.f.session.navigateTree(user.id, { summarize: false })
    }
    if (transition === 'compact') { x.f.setSteps([ai.fauxAssistantMessage('summary')]); await x.f.session.compact() }
    if (transition === 'session') await x.f.runtime.newSession()
    release.resolve(); await x.drain()
    // Input allows only the replacement evidence; other transitions invalidate all old work.
    expect(x.calls.every(c => c.context.trigger.evidence.every(e => !e.text.includes('old evidence') && !e.text.includes('seed padding')))).toBe(true)
    if (transition !== 'input') expect(x.calls).toHaveLength(0)
    expect(x.f.errors).toEqual([])
  } finally { release.resolve(); await x.dispose() }
})

test('SDK late worker report retains immutable origin and is refused after tree navigation', async () => {
  const entered = deferred(), release = deferred()
  const x = await pipelineFixture({ worker: async () => { entered.resolve(); await release.promise; return { status: 'prepared', report: { text: 'OLD_BRANCH_REPORT' } } } })
  try {
    x.f.setSteps([ai.fauxAssistantMessage('first')]); await x.f.session.prompt('old branch source')
    const draining = x.drain(); await entered.promise
    const user = x.f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'user')!
    await x.f.session.navigateTree(user.id, { summarize: false })
    release.resolve(); await draining
    expect(x.runtime.outcomes[0]!.reported).toBe(false)
    expect(x.runtime.outcomes[0]!.reportReceipt?.status).toBe('failed')
    x.f.setSteps([ai.fauxAssistantMessage('new branch')]); await x.f.session.prompt('new branch request')
    expect(JSON.stringify(x.f.requests.at(-1))).not.toContain('OLD_BRANCH_REPORT')
    expect(x.delivery.deliveryReceipts).toHaveLength(0)
  } finally { release.resolve(); await x.dispose() }
})
