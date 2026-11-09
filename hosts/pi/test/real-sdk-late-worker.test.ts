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

test('SDK late worker report is refused after canonical source edit using selected dependencies', async () => {
  const entered = deferred(), release = deferred()
  const x = await pipelineFixture({ worker: async () => { entered.resolve(); await release.promise; return { status: 'prepared', report: { text: 'OLD_SOURCE_REPORT' } } } })
  try {
    x.f.setSteps([ai.fauxAssistantMessage('first')]); await x.f.session.prompt('old source')
    const draining = x.drain(); await entered.promise
    const user = x.f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'user')!
    x.f.session.sessionManager.appendContextEdit(user.id, { content: 'replacement source' }); x.f.session.refreshContext()
    release.resolve(); await draining
    expect(x.runtime.outcomes[0]!.reported).toBe(false)
    expect(x.runtime.outcomes[0]!.reportReceipt?.status).toBe('failed')
    expect(x.mailbox.getStatus().pending).toBe(0)
    x.f.setSteps([ai.fauxAssistantMessage('next')]); await x.f.session.prompt('after source edit')
    expect(JSON.stringify(x.f.requests.at(-1))).not.toContain('old source')
    expect(JSON.stringify(x.f.requests.at(-1))).not.toContain('OLD_SOURCE_REPORT')
    expect(x.delivery.delivered).toEqual([])
  } finally { release.resolve(); await x.dispose() }
})

for (const edit of ['replace', 'omit'] as const) test(`SDK selected source ${edit} after enqueue drops report at hook boundary without refresh`, async () => {
  const x = await pipelineFixture()
  try {
    x.f.setSteps([ai.fauxAssistantMessage('first')]); await x.f.session.prompt('selected source'); await x.drain()
    expect(x.runtime.outcomes[0]!.reported).toBe(true)
    const user = x.f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'user')!
    x.f.session.sessionManager.appendContextEdit(user.id, edit === 'replace' ? { content: 'replaced' } : null)
    x.f.setSteps([ai.fauxAssistantMessage('next')]); await x.f.session.prompt('next')
    expect(JSON.stringify(x.f.requests.at(-1))).not.toContain('P3_PIPELINE_REPORT')
    expect(x.delivery.deliveryReceipts).toEqual([])
    expect(x.mailbox.traces.some(t => t.reason === 'source_changed')).toBe(true)
  } finally { await x.dispose() }
})

test('SDK unrelated canonical edit preserves selected source report', async () => {
  const entered = deferred(), release = deferred()
  const x = await pipelineFixture({ worker: async () => { entered.resolve(); await release.promise; return { status: 'prepared', report: { text: 'UNCHANGED_SOURCE_REPORT' } } } })
  try {
    x.f.setSteps([ai.fauxAssistantMessage('unselected assistant')]); await x.f.session.prompt('selected user')
    const draining = x.drain(); await entered.promise
    const assistant = x.f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'assistant')!
    x.f.session.sessionManager.appendContextEdit(assistant.id, { content: [{ type: 'text', text: 'edited assistant' }] })
    release.resolve(); await draining
    expect(x.runtime.outcomes[0]!.reported).toBe(true)
    x.f.setSteps([ai.fauxAssistantMessage('next')]); await x.f.session.prompt('next')
    expect(JSON.stringify(x.f.requests.at(-1))).toContain('UNCHANGED_SOURCE_REPORT')
    expect(x.delivery.delivered[0]!.item.dependencies).toEqual(x.packets[0]!.materials.map(({ id, version }) => ({ id, version })))
  } finally { release.resolve(); await x.dispose() }
})

test('SDK ambiguous native source binding refuses report rather than assuming a constant version', async () => {
  const x = await pipelineFixture()
  try {
    x.f.setSteps([ai.fauxAssistantMessage('first'), ai.fauxAssistantMessage('second')])
    await x.f.session.prompt('duplicate source'); await x.f.session.prompt('duplicate source'); await x.drain()
    expect(x.calls).toHaveLength(1)
    expect(x.runtime.outcomes[0]!.reported).toBe(false)
    expect(x.delivery.delivered).toEqual([])
    expect(x.mailbox.getStatus().pending).toBe(0)
  } finally { await x.dispose() }
})
