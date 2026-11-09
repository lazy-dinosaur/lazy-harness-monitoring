import { afterAll, beforeAll, expect, test } from 'bun:test'
import { frameSequenceIssues, hostSupportIssues } from '@lazy-harness/monitoring-core/host'
import { attachPiFrames, piHostCapabilities, visibleMessage, createParentReportDelivery } from '../src/index.ts'
import { ContextCarryMailbox } from '@lazy-harness/monitoring-core/engine/monitoring-core-context-mailbox.ts'
import { realSdk, fauxApi as ai, deferred } from './support/real-sdk.ts'

let oldFetch: typeof fetch, fetchAttempts = 0
beforeAll(() => {
  oldFetch = globalThis.fetch
  globalThis.fetch = Object.assign(async () => { fetchAttempts++; throw new Error('P3 forbids network') }, oldFetch) as typeof fetch
})
afterAll(() => { globalThis.fetch = oldFetch; expect(fetchAttempts).toBe(0) })
const stable = (x: unknown) => JSON.stringify(x, (key, value) => key === 'timestamp' ? undefined : value)
function conform(f: Awaited<ReturnType<typeof realSdk>>) {
  expect(f.errors).toEqual([])
  for (const binding of new Set(f.observer.frames.map(frame => frame.binding))) {
    expect(frameSequenceIssues(f.observer.frames.filter(frame => frame.binding === binding), piHostCapabilities)).toEqual([])
  }
  expect(f.observer.frames.map(frame => frame.sourceEvent)).toEqual(f.raw.map(row => row.event.type))
  expect(f.returns.every(value => value === undefined)).toBe(true)
}
function deliveryFixture(options: { maxCarryTurns?: number; maxAgeMs?: number; maxItems?: number; maxTextBytes?: number } = {}) {
  let time = 100, version = 'v1'
  const mailbox = new ContextCarryMailbox({ maxAgeMs: 1000, maxCarryTurns: 1, maxItems: 4, maxTextBytes: 4096,
    ...options, sourceVersion: () => version })
  const delivery = createParentReportDelivery({ mailbox, now: () => time })
  return { mailbox, delivery, advance: () => { time += 1001 }, changeSource: () => { version = 'v2' } }
}
const report = (f: Awaited<ReturnType<typeof realSdk>>, text = 'P3_REPORT_BODY', eventId = 'event') => ({
  moduleId: 'p3', jobId: 'prepare', eventId, sessionId: f.session.sessionManager.getSessionId(),
  mode: 'on-result' as const, riskTier: 'read-only', text,
})

test('SDK text hooks reconcile, are notification-only, and do not change actual provider input', async () => {
  const frames: unknown[] = [], halted: string[] = [], fObserver = new PiMonitoringObserver(() => undefined)
  const f = await realSdk({ observer: fObserver, extensions: [pi => { attachPiFrames(pi as any, fObserver, { accept: frame => { frames.push(frame) }, halt: reason => { halted.push(reason!) } }) }] })
  const baseline = await realSdk({ enabled: false })
  try {
    for (const x of [f, baseline]) { x.setSteps([ai.fauxAssistantMessage('answer')]); await x.session.prompt('synthetic input'); await x.observer.idle() }
    conform(f); expect(baseline.observer.frames).toEqual([])
    expect(stable(f.requests.map(r => r.messages.map(visibleMessage)))).toBe(stable(baseline.requests.map(r => r.messages.map(visibleMessage))))
    expect(f.requests).toHaveLength(1)
    const withSystem = f.observer.frames.find(frame => frame.sourceEvent === 'context_with_system')!
    expect(stable(withSystem.snapshot.observedMessages)).toBe(stable(f.requests[0].messages.map(visibleMessage)))
    expect(withSystem.snapshot.fullProviderContext).toBe(false)
    expect(frames.length).toBe(f.observer.frames.length); expect(halted).toEqual([])
  } finally { await f.dispose(); await baseline.dispose() }
})

import { PiMonitoringObserver } from '../src/index.ts'

test('SDK tool progress/final pairs preserve native identities and omit thinking bodies', async () => {
  const f = await realSdk()
  try {
    f.setSteps([ai.fauxAssistantMessage([ai.fauxThinking('PRIVATE_THOUGHT'), ai.fauxText('draft'), ai.fauxToolCall('synthetic', { value: 7 }, { id: 'p3-call' })], { stopReason: 'toolUse' }), ai.fauxAssistantMessage('done')])
    await f.session.prompt('use synthetic tool'); await f.observer.idle(); conform(f)
    for (const event of ['tool_execution_start', 'tool_call', 'tool_execution_update', 'tool_result', 'tool_execution_end']) {
      const frame = f.observer.frames.find(frame => frame.sourceEvent === event)!
      expect((frame.payload as any).toolCallId).toBe('p3-call')
    }
    expect(f.observer.frames.filter(frame => frame.kind === 'tool.result')).toHaveLength(1)
    expect(JSON.stringify(f.observer.frames)).not.toContain('PRIVATE_THOUGHT')
    expect(JSON.stringify(f.requests[1])).toContain('synthetic-result:7')
    const final = f.observer.frames.find(frame => frame.kind === 'assistant.message' && JSON.stringify(frame.payload).includes('done'))!
    expect(JSON.stringify(final.snapshot.canonicalMessages)).not.toContain('done')
    for (const frame of f.observer.frames.filter(frame => frame.sourceEvent === 'turn_end')) {
      for (const id of (frame.payload as any).toolResultEntryIds) expect(f.session.sessionManager.getEntry(id)).toBeDefined()
    }
    expect(f.observer.frames.filter(frame => frame.sourceEvent === 'turn_end').every(frame =>
      f.session.sessionManager.getEntry((frame.payload as any).messageEntryId))).toBe(true)
  } finally { await f.dispose() }
})

test('SDK terminal tool error remains an error, not successful material', async () => {
  const f = await realSdk({ toolThrows: true })
  try {
    f.setSteps([ai.fauxAssistantMessage(ai.fauxToolCall('synthetic', { value: 1 }), { stopReason: 'toolUse' }), ai.fauxAssistantMessage('handled')])
    await f.session.prompt('synthetic failure'); await f.observer.idle(); conform(f)
    expect((f.observer.frames.find(frame => frame.kind === 'tool.result')!.payload as any).message.isError).toBe(true)
  } finally { await f.dispose() }
})

for (const behavior of ['steer', 'followUp'] as const) test(`SDK ${behavior} is accepted mid-stream and reaches the next provider request`, async () => {
  const entered = deferred(), release = deferred(), f = await realSdk()
  try {
    f.setSteps([async () => { entered.resolve(); await release.promise; return ai.fauxAssistantMessage('first') }, ai.fauxAssistantMessage('second')])
    const run = f.session.prompt('initial'); await entered.promise
    expect(await f.session[behavior](`queued ${behavior}`)).toBe('queued')
    release.resolve(); await run; await f.observer.idle(); conform(f)
    const inputs = f.observer.frames.filter(frame => frame.sourceEvent === 'input')
    expect(inputs).toHaveLength(2); expect((inputs[1]!.payload as any).streamingBehavior).toBe(behavior)
    expect(JSON.stringify(f.requests[1])).toContain(`queued ${behavior}`)
    expect(f.observer.frames.at(-1)!.sourceEvent).toBe('agent_settled')
  } finally { release.resolve(); await f.dispose() }
})

test('SDK abort exposes terminal aborted state and no automatic next request', async () => {
  const entered = deferred(), f = await realSdk()
  try {
    f.setSteps([async (_context: any, options: any) => {
      entered.resolve(); await new Promise<void>(resolve => {
        if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', () => resolve(), { once: true })
      }); return ai.fauxAssistantMessage('aborted', { stopReason: 'aborted' })
    }])
    const run = f.session.prompt('abort'); await entered.promise; await f.session.abort(); await run; await f.observer.idle(); conform(f)
    expect((f.observer.frames.at(-1)!.payload as any).aborted).toBe(true)
    expect(f.observer.frames.some(frame => frame.sourceEvent === 'message_end' && (frame.payload as any).message?.stopReason === 'aborted')).toBe(true)
    expect(f.requests).toHaveLength(1)
  } finally { await f.dispose() }
})

test('SDK context edits, tree navigation, compaction, model and thinking changes yield current frames', async () => {
  const f = await realSdk()
  try {
    f.setSteps([ai.fauxAssistantMessage('first'), ai.fauxAssistantMessage('second')])
    await f.session.prompt('original')
    const user = f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'user')!
    f.session.sessionManager.appendContextEdit(user.id, { content: 'edited' }); f.session.refreshContext()
    await f.session.prompt('padding '.repeat(150))
    expect(JSON.stringify(f.requests[1])).toContain('edited'); expect(JSON.stringify(f.requests[1])).not.toContain('original')
    await f.session.navigateTree(user.id, { summarize: false })
    const tree = f.observer.frames.findLast(frame => frame.sourceEvent === 'session_tree')!
    expect(tree.snapshot.leafId).toBe(f.session.sessionManager.getLeafId())
    expect(JSON.stringify(tree.snapshot.canonicalMessages)).not.toContain('padding')
    f.setSteps([ai.fauxAssistantMessage('third'), ai.fauxAssistantMessage('fourth')])
    await f.session.prompt('branch padding '.repeat(150)); await f.session.prompt('more padding '.repeat(150))
    f.setSteps([ai.fauxAssistantMessage('P3_COMPACTION_SUMMARY')]); await f.session.compact()
    await f.session.setModel(f.faux.getModel())
    expect(f.observer.frames.some(frame => frame.sourceEvent === 'model_select')).toBe(false)
    await f.session.setModel(f.faux.getModel('alternate')); f.session.setThinkingLevel('low')
    await f.observer.idle(); conform(f)
    for (const event of ['session_before_tree', 'session_tree', 'session_before_compact', 'session_compact']) {
      expect(f.observer.frames.some(frame => frame.sourceEvent === event)).toBe(true)
    }
    const compact = f.observer.frames.find(frame => frame.sourceEvent === 'session_compact')!
    expect(JSON.stringify(compact.snapshot.canonicalMessages)).toContain('P3_COMPACTION_SUMMARY')
    expect(f.observer.frames.some(frame => frame.sourceEvent === 'thinking_level_select')).toBe(true)
    expect(f.observer.frames.some(frame => frame.sourceEvent === 'model_select')).toBe(true)
  } finally { await f.dispose() }
})

test('SDK replacement and shutdown invalidate old diagnostic lease without blocking foreground', async () => {
  const entered = deferred(), release = deferred(); let current!: () => boolean
  const observer = new PiMonitoringObserver(async (_frame, lease) => { if (!current) { current = lease.isCurrent; entered.resolve(); await release.promise } }, { workerTimeoutMs: 10000 })
  const f = await realSdk({ observer })
  try {
    await entered.promise; const oldId = f.session.sessionManager.getSessionId(), oldBinding = observer.frames[0]!.binding
    f.setSteps([ai.fauxAssistantMessage('foreground')]); await f.session.prompt('while observer blocked')
    await f.runtime.newSession(); expect(f.session.sessionManager.getSessionId()).not.toBe(oldId); expect(current()).toBe(false)
    observer.close(oldBinding); expect(observer.getStatus().sessionId).toBe(f.session.sessionManager.getSessionId())
    release.resolve(); await observer.idle(); conform(f)
    expect(f.raw.some(row => row.event.type === 'session_shutdown' && row.sessionId === oldId)).toBe(true)
    expect(f.observer.frames.some(frame => frame.sourceEvent === 'session_before_switch' && frame.sessionId === oldId)).toBe(true)
    await f.runtime.dispose(); await observer.idle()
    expect(observer.frames.at(-1)!.sourceEvent).toBe('session_shutdown')
  } finally { release.resolve(); await f.dispose() }
})

test('SDK inject-context delivers in NEXT actual input exactly once; duplicate/foreign report refused', async () => {
  const d = deliveryFixture(), f = await realSdk({ extensions: [d.delivery.extension] })
  try {
    const r = report(f)
    expect(d.delivery.enqueue({ ...r, sessionId: 'foreign' }).status).toBe('failed')
    expect(d.delivery.enqueue(r).status).toBe('enqueued'); expect(d.delivery.enqueue(r).status).toBe('failed')
    f.setSteps([ai.fauxAssistantMessage('first'), ai.fauxAssistantMessage('second')])
    await f.session.prompt('next'); await f.session.prompt('later')
    expect(JSON.stringify(f.requests[0])).toContain('P3_REPORT_BODY'); expect(JSON.stringify(f.requests[1])).not.toContain('P3_REPORT_BODY')
    expect(d.delivery.deliveryReceipts).toHaveLength(1); expect(d.delivery.delivered[0]!.carried).toBe(true)
  } finally { await f.dispose() }
})

for (const reason of ['source', 'age', 'carry', 'tree', 'compact', 'session'] as const) test(`SDK queued report rejected after ${reason} change`, async () => {
  const d = deliveryFixture(reason === 'carry' ? { maxCarryTurns: 0 } : {}), f = await realSdk({ extensions: [d.delivery.extension] })
  try {
    f.setSteps([ai.fauxAssistantMessage('seed'), ai.fauxAssistantMessage('seed2')])
    await f.session.prompt('seed padding '.repeat(100)); await f.session.prompt('seed2 padding '.repeat(100))
    const originTurn = d.delivery.currentTurn()
    expect(d.delivery.enqueue(report(f), { originTurn, dependencies: [{ id: 'source', version: 'v1' }] }).status).toBe('enqueued')
    if (reason === 'source') d.changeSource()
    if (reason === 'age') d.advance()
    if (reason === 'tree') {
      const user = f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'user')!
      await f.session.navigateTree(user.id, { summarize: false })
    }
    if (reason === 'compact') { f.setSteps([ai.fauxAssistantMessage('summary')]); await f.session.compact() }
    if (reason === 'session') await f.runtime.newSession()
    f.setSteps([ai.fauxAssistantMessage('next')]); const before = f.requests.length; await f.session.prompt('next')
    expect(JSON.stringify(f.requests[before])).not.toContain('P3_REPORT_BODY')
    expect(d.delivery.deliveryReceipts).toHaveLength(0)
    expect(d.mailbox.traces.some(t => t.reason === ({ source: 'source_changed', age: 'expired_age', carry: 'carry_exceeded', tree: 'scope_changed', compact: 'scope_changed', session: 'scope_changed' } as const)[reason])).toBe(true)
  } finally { await f.dispose() }
})

test('SDK carry item/text bounds refuse before injection', async () => {
  const d = deliveryFixture({ maxItems: 1, maxTextBytes: 80 }), f = await realSdk({ extensions: [d.delivery.extension] })
  try {
    expect(d.delivery.enqueue(report(f, 'x'.repeat(100))).status).toBe('failed')
    expect(d.delivery.enqueue(report(f, 'small', 'one')).status).toBe('enqueued')
    expect(d.delivery.enqueue(report(f, 'overflow', 'two')).status).toBe('failed')
    f.setSteps([ai.fauxAssistantMessage('next')]); await f.session.prompt('next')
    expect(JSON.stringify(f.requests)).toContain('small'); expect(JSON.stringify(f.requests)).not.toContain('overflow')
  } finally { await f.dispose() }
})

test('Pi single declared action excludes steer and block-tool-call', () => {
  expect(piHostCapabilities.actions).toEqual(['inject-context'])
  expect(hostSupportIssues(piHostCapabilities, [{ id: 'p3', watch: ['user.prompt'], actions: ['steer', 'block-tool-call'] }]).map(i => i.name)).toEqual(['steer', 'block-tool-call'])
})
