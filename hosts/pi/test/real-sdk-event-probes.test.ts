import { afterAll, beforeAll, expect, test } from 'bun:test'
import { frameSequenceIssues } from '@lazy-harness/monitoring-core/host'
import { piHostCapabilities } from '../src/index.ts'
import { realSdk, fauxApi as ai, deferred } from './support/real-sdk.ts'

let original: typeof fetch, attempts = 0
beforeAll(() => { original = globalThis.fetch; globalThis.fetch = Object.assign(async () => { attempts++; throw new Error('network forbidden') }, original) as typeof fetch })
afterAll(() => { globalThis.fetch = original; expect(attempts).toBe(0) })
function conform(f: Awaited<ReturnType<typeof realSdk>>) {
  for (const binding of new Set(f.observer.frames.map(frame => frame.binding))) expect(frameSequenceIssues(f.observer.frames.filter(frame => frame.binding === binding), piHostCapabilities)).toEqual([])
  expect(f.errors).toEqual([])
  expect(f.returns.every(result => result === undefined)).toBe(true)
}

test('SDK runtime fork emits session_before_fork with native entry identity', async () => {
  const f = await realSdk()
  try {
    f.setSteps([ai.fauxAssistantMessage('answer')]); await f.session.prompt('fork source')
    const user = f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'user')!
    const oldId = f.session.sessionManager.getSessionId()
    expect(await f.runtime.fork(user.id)).toMatchObject({ cancelled: false })
    await f.observer.idle()
    expect(f.raw.find(row => row.event.type === 'session_before_fork')).toMatchObject({ sessionId: oldId, event: { entryId: user.id, position: 'before' } })
    expect(f.observer.frames.some(frame => frame.sourceEvent === 'session_before_fork')).toBe(true)
    expect(f.session.sessionManager.getSessionId()).not.toBe(oldId)
    conform(f)
  } finally { await f.dispose() }
})

test('SDK cancelled manual compaction emits session_compact_failed without a summary request', async () => {
  const f = await realSdk({ extensions: [pi => { pi.on('session_before_compact', () => ({ cancel: true })) }] })
  try {
    f.setSteps([ai.fauxAssistantMessage('first'), ai.fauxAssistantMessage('second')])
    await f.session.prompt('seed padding '.repeat(100)); await f.session.prompt('next padding '.repeat(100))
    const before = f.requests.length
    await expect(f.session.compact()).rejects.toThrow('Compaction cancelled')
    await f.observer.idle()
    expect(f.raw.find(row => row.event.type === 'session_compact_failed')?.event).toMatchObject({ reason: 'manual', aborted: true, willRetry: false })
    expect(f.observer.frames.some(frame => frame.sourceEvent === 'session_compact_failed')).toBe(true)
    expect(f.requests).toHaveLength(before)
    conform(f)
  } finally { await f.dispose() }
})

test('SDK wrapped extension UI emits ui_prompt_start and ui_prompt_end around a real pending selector', async () => {
  const entered = deferred(), release = deferred<string | undefined>()
  const f = await realSdk({ uiSelect: async () => { entered.resolve(); return release.promise }, extensions: [pi => {
    pi.on('input', async (_event, ctx) => { await ctx.ui.select('Synthetic selector', ['continue']); return { action: 'handled' } })
  }] })
  try {
    const prompting = f.session.prompt('open selector'); await entered.promise; await f.observer.idle()
    expect(f.observer.frames.filter(frame => frame.sourceEvent.startsWith('ui_prompt_')).map(frame => frame.sourceEvent)).toEqual(['ui_prompt_start'])
    expect(f.requests).toEqual([])
    release.resolve('continue'); await prompting; await f.observer.idle()
    expect(f.observer.frames.filter(frame => frame.sourceEvent.startsWith('ui_prompt_')).map(frame => frame.sourceEvent)).toEqual(['ui_prompt_start', 'ui_prompt_end'])
    expect(f.raw.filter(row => row.event.type.startsWith('ui_prompt_')).map(row => row.event)).toEqual([
      { type: 'ui_prompt_start', reason: 'ui_prompt', kind: 'select', title: 'Synthetic selector' },
      { type: 'ui_prompt_end', reason: 'ui_prompt', kind: 'select', title: 'Synthetic selector' },
    ])
    conform(f)
  } finally { release.resolve(undefined); await f.dispose() }
})

test('SDK cache scheduler emits cache_warming_decision under faux and stop override sends no refresh', async () => {
  const seen = deferred()
  const f = await realSdk({ warming: true, extensions: [pi => { pi.on('cache_warming_decision', () => { seen.resolve(); return { action: 'stop' } }) }] })
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    f.session.setCacheWarmingMode('idle')
    f.setSteps([ai.fauxAssistantMessage('answer')]); await f.session.prompt('synthetic cache source '.repeat(100))
    await Promise.race([seen.promise, new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('cache decision deadline')), 3500) })])
    await f.observer.idle()
    expect(f.raw.find(row => row.event.type === 'cache_warming_decision')?.event).toMatchObject({ type: 'cache_warming_decision', action: 'warm' })
    expect(f.observer.frames.some(frame => frame.sourceEvent === 'cache_warming_decision')).toBe(true)
    expect(f.requests).toHaveLength(1)
    conform(f)
  } finally { if (deadline) clearTimeout(deadline); await f.dispose() }
}, 10000)

test('SDK direct shell execution and faux transcript do not prove user_bash or before_provider_request', async () => {
  const f = await realSdk()
  try {
    const result = await f.session.executeBash('printf synthetic-shell')
    expect(result.exitCode).toBe(0); expect(result.output).toBe('synthetic-shell')
    f.setSteps([ai.fauxAssistantMessage('answer')]); await f.session.prompt('faux request'); await f.observer.idle()
    expect(f.requests).toHaveLength(1)
    for (const event of ['user_bash', 'before_provider_request']) {
      expect(f.raw.some(row => row.event.type === event)).toBe(false)
      expect(f.observer.frames.some(frame => frame.sourceEvent === event)).toBe(false)
      expect(piHostCapabilities.events).not.toContain(event)
    }
    conform(f)
  } finally { await f.dispose() }
})
