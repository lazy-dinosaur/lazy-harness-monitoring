import { afterAll, beforeAll, expect, test } from 'bun:test'
import { pipelineFixture } from './support/pipeline.ts'
import { fauxApi as ai, deferred } from './support/real-sdk.ts'

let original: typeof fetch, attempts = 0
beforeAll(() => { original = globalThis.fetch; globalThis.fetch = Object.assign(async () => { attempts++; throw new Error('network forbidden') }, original) as typeof fetch })
afterAll(() => { globalThis.fetch = original; expect(attempts).toBe(0) })

test('SDK late worker report with old session identity is refused after actual runtime replacement', async () => {
  const entered = deferred(), release = deferred()
  const x = await pipelineFixture({ worker: async () => { entered.resolve(); await release.promise; return { status: 'prepared', report: { text: 'OLD_SESSION_REPORT' } } } })
  try {
    x.f.setSteps([ai.fauxAssistantMessage('first')]); await x.f.session.prompt('old session source')
    const draining = x.drain(); await entered.promise; const oldId = x.f.session.sessionManager.getSessionId()
    await x.f.runtime.newSession(); expect(x.f.session.sessionManager.getSessionId()).not.toBe(oldId)
    release.resolve(); await draining
    expect(x.runtime.outcomes[0]!.reportReceipt?.status).toBe('failed')
    expect(x.runtime.outcomes[0]!.reported).toBe(false)
    x.f.setSteps([ai.fauxAssistantMessage('new')]); await x.f.session.prompt('new session request')
    expect(JSON.stringify(x.f.requests.at(-1))).not.toContain('OLD_SESSION_REPORT')
  } finally { release.resolve(); await x.dispose() }
})

test('FINDING: late worker report after canonical source edit lacks automatic evidence dependencies', async () => {
  const entered = deferred(), release = deferred()
  const x = await pipelineFixture({ worker: async () => { entered.resolve(); await release.promise; return { status: 'prepared', report: { text: 'OLD_SOURCE_REPORT' } } } })
  try {
    x.f.setSteps([ai.fauxAssistantMessage('first')]); await x.f.session.prompt('old source')
    const draining = x.drain(); await entered.promise
    const user = x.f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'user')!
    x.f.session.sessionManager.appendContextEdit(user.id, { content: 'replacement source' }); x.f.session.refreshContext()
    release.resolve(); await draining
    expect(x.runtime.outcomes[0]!.reported).toBe(true)
    x.f.setSteps([ai.fauxAssistantMessage('next')]); await x.f.session.prompt('after source edit')
    expect(JSON.stringify(x.f.requests.at(-1))).not.toContain('old source')
    expect(JSON.stringify(x.f.requests.at(-1))).toContain('OLD_SOURCE_REPORT')
    expect(x.delivery.delivered[0]!.item.dependencies).toEqual([])
  } finally { release.resolve(); await x.dispose() }
})
