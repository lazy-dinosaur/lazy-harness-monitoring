import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { createPiObservationExtension, PiMonitoringObserver, visibleMessage, type ObservationContext } from '../src/observer/monitoring-observer.ts'
import { clone, createSdkFixture, deferred, sdkEntry } from './support/monitoring-sdk-fixture.ts'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
function unitContext() {
  const state = { leaf: 'unit-entry', messages: [{ role: 'user', content: 'unit-input', timestamp: 1 }] as any[] }
  const ctx: ObservationContext = { sessionManager: { getSessionId: () => 'mechanical-unit-session', getLeafId: () => state.leaf, getBranch: () => [{ id: state.leaf, parentId: null, type: 'message' }], buildSessionProjection: () => ({ messages: state.messages }) }, getSystemPrompt: () => 'mechanical-unit-system' }
  return { ctx, state }
}
describe('Pi observer mechanical protections (not actual-SDK proof)', () => {
  test('disabled by default; no registrations, frames or active resources', () => {
    let registrations = 0
    const observer = new PiMonitoringObserver(() => undefined)
    createPiObservationExtension({ observer })({ on: () => registrations++ })
    expect(registrations).toBe(0); expect(observer.getStatus().active).toBe(false); expect(observer.frames).toHaveLength(0)
  })
  test('immutable scoped snapshot and explicit thinking/image/signature omissions', async () => {
    const { ctx, state } = unitContext(), observer = new PiMonitoringObserver(() => undefined)
    state.messages.push({ role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_THINKING', signature: 'PRIVATE_SIGNATURE' }, { type: 'image', data: 'PRIVATE_IMAGE', mimeType: 'image/png' }, { type: 'text', text: 'visible', textSignature: 'PRIVATE_SIGNATURE' }] })
    const binding = observer.open(ctx); observer.record(binding, { type: 'message_end', message: state.messages[1] }, ctx)
    const saved = JSON.stringify(observer.frames)
    expect(saved).not.toContain('PRIVATE_'); expect(saved).toContain('bodyOmitted'); expect(saved).toContain('visible')
    expect(Object.isFrozen(observer.frames[0].snapshot.canonicalMessages)).toBe(true)
    state.messages[0].content = 'changed-after-capture'
    expect(JSON.stringify(observer.frames)).toBe(saved)
    await observer.idle(); observer.close()
  })
  test('oversized content is unavailable, not silently truncated into usable context', async () => {
    const { ctx, state } = unitContext(); let consumed = 0
    const observer = new PiMonitoringObserver(() => consumed++, { maxSnapshotBytes: 1024 })
    state.messages[0].content = 'x'.repeat(5000)
    const b = observer.open(ctx); observer.record(b, { type: 'turn_start' }, ctx)
    await observer.idle()
    expect(consumed).toBe(0); expect(observer.frames[0].available).toBe(false)
    expect(observer.frames[0].snapshot.missing).toBe('snapshot-byte-limit')
    expect(JSON.stringify(observer.frames[0].snapshot).length).toBeLessThan(1024)
    expect(observer.outcomes[0].status).toBe('unavailable'); observer.close()
  })
  test('overflow and changed canonical source are explicit; stale work cannot publish handled', async () => {
    const { ctx, state } = unitContext(), entered = deferred(), release = deferred()
    const observer = new PiMonitoringObserver(async () => { entered.resolve(); await release.promise }, { maxQueue: 1 })
    const b = observer.open(ctx); observer.record(b, { type: 'turn_start' }, ctx); await entered.promise
    observer.record(b, { type: 'message_update' }, ctx); observer.record(b, { type: 'message_update' }, ctx)
    state.leaf = 'unit-new-branch'; state.messages = [{ role: 'user', content: 'new' }]
    release.resolve(); await observer.idle()
    expect(observer.outcomes.some(x => x.status === 'overflow')).toBe(true)
    expect(observer.outcomes.filter(x => x.status === 'stale')).toHaveLength(2)
    expect(observer.outcomes.some(x => x.status === 'handled')).toBe(false); observer.close()
  })
  test('logical timeout preserves physical slot until uncooperative operation settles', async () => {
    const { ctx } = unitContext(), entered = deferred(), release = deferred(); let started = 0
    const observer = new PiMonitoringObserver(async () => { if (++started === 1) { entered.resolve(); await release.promise } }, { workerTimeoutMs: 10 })
    const b = observer.open(ctx); observer.record(b, { type: 'turn_start' }, ctx); await entered.promise
    await sleep(25); observer.record(b, { type: 'message_update' }, ctx); await sleep(5)
    expect(started).toBe(1); expect(observer.getStatus().active).toBe(true); expect(observer.getStatus().queued).toBe(1)
    release.resolve(); await observer.idle()
    expect(started).toBe(2); expect(observer.outcomes.filter(x => x.status === 'timeout')).toHaveLength(1)
    expect(observer.outcomes.filter(x => x.status === 'handled')).toHaveLength(1); observer.close()
  })
  test('consumer errors do not escape foreground handlers; old close cannot close replacement', async () => {
    const { ctx } = unitContext(), observer = new PiMonitoringObserver(() => { throw new Error('diagnostic-failure') })
    const old = observer.open(ctx), current = observer.open(ctx); observer.close(old)
    observer.record(current, { type: 'turn_start' }, ctx); await observer.idle()
    expect(observer.getStatus().sessionId).toBe('mechanical-unit-session')
    expect(observer.outcomes.some(x => x.status === 'error' && x.reason === 'diagnostic-failure')).toBe(true); observer.close(current)
  })
  test('unsupported replacement is fail-closed and does not revive the old lease', async () => {
    const { ctx } = unitContext(), entered = deferred(), release = deferred(); let current!: () => boolean
    const observer = new PiMonitoringObserver(async (_frame, lease) => { current = lease.isCurrent; entered.resolve(); await release.promise })
    const hooks = new Map<string, Function>()
    createPiObservationExtension({ enabled: true, observer })({ on: (name, fn) => hooks.set(name, fn) })
    hooks.get('session_start')!({ type: 'session_start' }, ctx); await entered.promise
    const unsupported = { ...ctx, sessionManager: { ...ctx.sessionManager, buildSessionProjection: () => { throw new Error('unsupported-projection') } } }
    expect(hooks.get('session_start')!({ type: 'session_start' }, unsupported)).toBeUndefined()
    expect(current()).toBe(false); expect(observer.getStatus().sessionId).toBeNull(); expect(observer.getStatus().lastError).toBe('unsupported-projection')
    release.resolve(); await observer.idle(); observer.close()
  })
  test('bounded history exposes observation and outcome eviction counts', async () => {
    const { ctx } = unitContext(), observer = new PiMonitoringObserver(() => undefined, { maxRetained: 2 })
    const b = observer.open(ctx)
    for (let i = 0; i < 3; i++) observer.record(b, { type: 'turn_start' }, ctx)
    await observer.idle()
    expect(observer.frames).toHaveLength(2); expect(observer.outcomes).toHaveLength(2)
    expect(observer.getStatus().observed).toBe(3); expect(observer.getStatus().evicted).toBe(1); expect(observer.getStatus().evictedOutcomes).toBe(1); observer.close()
  })
})

const actual = sdkEntry ? describe : describe.skip
const proofs: any[] = []
let fetchAttempts = 0
actual('Pi observer ACTUAL SDK / official faux provider acceptance', () => {
  let originalFetch: typeof globalThis.fetch
  beforeAll(() => { originalFetch = globalThis.fetch; globalThis.fetch = Object.assign(async () => { fetchAttempts++; throw new Error('unexpected network in synthetic SDK acceptance') }, originalFetch) as typeof fetch })
  afterAll(() => {
    globalThis.fetch = originalFetch
    expect(fetchAttempts).toBe(0)
    if (process.env.PI_MONITORING_REPORT) writeFileSync(process.env.PI_MONITORING_REPORT, JSON.stringify({ schema: 'pi-observer-p0p2/v1', sdkEntry, externalFetchAttempts: fetchAttempts, liveHostActivated: false, actualUserDataCollected: false, classifierQualified: false, proofs }, null, 2) + '\n')
  })
  test('text/context trace matches actual hooks; observation changes neither provider input nor output', async () => {
    const f = await createSdkFixture(), baseline = await createSdkFixture({ enabled: false })
    try {
      for (const x of [f, baseline]) { x.setSteps([x.ai.fauxAssistantMessage('synthetic-answer')]); await x.session.prompt('synthetic-user-input'); await x.observer.idle() }
      const stable = (x: any) => JSON.stringify(x, (k, v) => k === 'timestamp' ? undefined : v)
      expect(stable(f.requests.map(x => x.messages.map(visibleMessage)))).toBe(stable(baseline.requests.map(x => x.messages.map(visibleMessage))))
      expect(baseline.observer.frames).toHaveLength(0)
      const raw = f.raw.slice(f.raw.findIndex(x => x.event.type === 'session_start'))
      expect(f.observer.frames.map(x => x.sourceEvent)).toEqual(raw.map(x => x.event.type))
      expect(f.observer.frames.filter(x => x.kind === 'user.input')).toHaveLength(1)
      expect(f.observer.frames.every(x => x.sessionId === f.session.sessionManager.getSessionId())).toBe(true)
      const withSystem = f.observer.frames.find(x => x.sourceEvent === 'context_with_system')!
      const conversation = f.observer.frames.find(x => x.sourceEvent === 'context')!
      expect(withSystem.snapshot.stage).toBe('context_with_system_at_hook')
      expect((conversation.snapshot.observedMessages as any[]).some(x => x.role === 'system')).toBe(false)
      expect(stable(withSystem.snapshot.observedMessages)).toBe(stable(f.requests[0].messages.map(visibleMessage)))
      expect(withSystem.snapshot.fullProviderContext).toBe(false)
      expect(f.session.messages.at(-1).content[0].text).toBe('synthetic-answer')
      f.assertReconciled(); proofs.push({ case: 'actual-text-context-noninterference', sdkVersion: f.sdkVersion, observations: f.observer.frames.length, rawEvents: raw.length, fauxCalls: f.faux.state.callCount, handlerP95Ms: [...f.handlerMs].sort((a,b) => a-b)[Math.floor(f.handlerMs.length * .95)] })
    } finally { await f.dispose(); await baseline.dispose() }
  }, 20000)
  test('actual stream/thinking/tool updates and finalized native entry identities', async () => {
    const f = await createSdkFixture()
    try {
      f.setSteps([f.ai.fauxAssistantMessage([f.ai.fauxThinking('SYNTHETIC_PRIVATE_THOUGHT'), f.ai.fauxText('draft-text'), f.ai.fauxToolCall('synthetic', { value: 7 }, { id: 'source-tool-7' })], { stopReason: 'toolUse' }), f.ai.fauxAssistantMessage('tool-complete')])
      await f.session.prompt('synthetic-tool-input'); await f.observer.idle()
      const frames = f.observer.frames, finalTool = frames.filter(x => x.kind === 'tool.result')
      expect(finalTool).toHaveLength(1); expect((finalTool[0].payload as any).message.toolCallId).toBe('source-tool-7')
      expect(JSON.stringify(finalTool)).toContain('synthetic-result:7')
      expect(frames.some(x => x.sourceEvent === 'tool_execution_update')).toBe(true)
      expect(frames.some(x => x.sourceEvent === 'message_update')).toBe(true)
      expect(JSON.stringify(frames)).not.toContain('SYNTHETIC_PRIVATE_THOUGHT')
      expect(JSON.stringify(frames)).toContain('bodyOmitted')
      const turns = frames.filter(x => x.sourceEvent === 'turn_end')
      expect(turns.length).toBeGreaterThan(0)
      for (const frame of turns) { const p: any = frame.payload; expect(f.session.sessionManager.getEntry(p.messageEntryId)).toBeDefined(); for (const id of p.toolResultEntryIds) expect(f.session.sessionManager.getEntry(id)).toBeDefined() }
      // SDK explicitly persists AFTER message_end: its payload and canonical history are separate views.
      const finalAssistant = frames.find(x => x.kind === 'assistant.message' && JSON.stringify(x.payload).includes('tool-complete'))!
      expect(JSON.stringify(finalAssistant.snapshot.canonicalMessages)).not.toContain('tool-complete')
      f.assertReconciled(); proofs.push({ case: 'actual-stream-tool-native-ids-prepersist', sdkVersion: f.sdkVersion, fauxCalls: f.faux.state.callCount, finalizedToolResults: finalTool.length, nativeTurnEntries: turns.length })
    } finally { await f.dispose() }
  }, 20000)
  test('actual tool failure stays visible as terminal isError result', async () => {
    const f = await createSdkFixture({ toolThrows: true })
    try {
      f.setSteps([f.ai.fauxAssistantMessage(f.ai.fauxToolCall('synthetic', { value: 1 }, { id: 'source-error-call' }), { stopReason: 'toolUse' }), f.ai.fauxAssistantMessage('error-observed')])
      await f.session.prompt('synthetic-error-input'); await f.observer.idle()
      const result = f.observer.frames.find(x => x.kind === 'tool.result')!
      expect((result.payload as any).message.isError).toBe(true); expect(JSON.stringify(result.payload)).toContain('synthetic-tool-error')
      f.assertReconciled(); proofs.push({ case: 'actual-terminal-tool-error', sdkVersion: f.sdkVersion, nativeToolCallId: (result.payload as any).message.toolCallId })
    } finally { await f.dispose() }
  }, 20000)
  test('later context transformer can differ; hook position never claims final provider payload', async () => {
    const f = await createSdkFixture({ extraFactories: [(pi: any) => pi.on('context_with_system', (event: any) => ({ messages: [...event.messages, { role: 'user', content: 'later-fixture-transform', timestamp: 1 }] }))] })
    try {
      f.setSteps([f.ai.fauxAssistantMessage('transformed-answer')]); await f.session.prompt('before-transform'); await f.observer.idle()
      const frame = f.observer.frames.find(x => x.sourceEvent === 'context_with_system')!
      expect(JSON.stringify(frame.snapshot.observedMessages)).not.toContain('later-fixture-transform')
      expect(JSON.stringify(f.requests[0].messages)).toContain('later-fixture-transform')
      expect(frame.snapshot.fullProviderContext).toBe(false)
      f.assertReconciled(); proofs.push({ case: 'actual-hook-position-not-final-payload', sdkVersion: f.sdkVersion })
    } finally { await f.dispose() }
  }, 20000)
  test('actual context edits, branch navigation and compaction refresh canonical view', async () => {
    const f = await createSdkFixture()
    try {
      f.setSteps([f.ai.fauxAssistantMessage('response-A'), f.ai.fauxAssistantMessage('response-B')])
      await f.session.prompt('original-A')
      const branch = f.session.sessionManager.getBranch(), user = branch.find((e: any) => e.type === 'message' && e.message.role === 'user'), assistant = branch.find((e: any) => e.type === 'message' && e.message.role === 'assistant')
      f.session.sessionManager.appendContextEdit(user.id, { content: 'replacement-A' }); f.session.refreshContext()
      await f.session.prompt('after-edit-B')
      const edited = f.observer.frames.filter(x => x.sourceEvent === 'context_with_system').at(-1)!
      expect(JSON.stringify(edited.snapshot.canonicalMessages)).toContain('replacement-A'); expect(JSON.stringify(edited.snapshot.canonicalMessages)).not.toContain('original-A')
      await f.session.navigateTree(assistant.id, { summarize: false })
      const tree = f.observer.frames.filter(x => x.sourceEvent === 'session_tree').at(-1)!
      expect(tree.snapshot.leafId).toBe(f.session.sessionManager.getLeafId())
      expect(JSON.stringify(tree.snapshot.canonicalMessages)).toContain('original-A'); expect(JSON.stringify(tree.snapshot.canonicalMessages)).not.toContain('after-edit-B')
      expect(tree.snapshot.revision).not.toBe(edited.snapshot.revision)
      f.setSteps([f.ai.fauxAssistantMessage('response-C'), f.ai.fauxAssistantMessage('response-D')])
      await f.session.prompt('branch-C ' + 'synthetic filler '.repeat(50)); await f.session.prompt('branch-D ' + 'synthetic filler '.repeat(50))
      f.setSteps([f.ai.fauxAssistantMessage('SYNTHETIC_COMPACTION_SUMMARY')]); await f.session.compact(); await f.observer.idle()
      const compact = f.observer.frames.filter(x => x.sourceEvent === 'session_compact').at(-1)!
      expect(compact).toBeDefined(); expect(JSON.stringify(compact.snapshot.canonicalMessages)).toContain('SYNTHETIC_COMPACTION_SUMMARY')
      expect(compact.snapshot.leafId).toBe(f.session.sessionManager.getLeafId())
      f.assertReconciled(); proofs.push({ case: 'actual-context-edit-branch-compaction', sdkVersion: f.sdkVersion, compactionEntryId: compact.snapshot.leafId })
    } finally { await f.dispose() }
  }, 20000)
  test('actual replacement/shutdown proceeds while observer is blocked; no old lease affects new session', async () => {
    const entered = deferred(), release = deferred(); let oldCurrent: (() => boolean) | undefined, calls = 0
    const observer = new PiMonitoringObserver(async (_frame, lease) => { if (++calls === 1) { oldCurrent = lease.isCurrent; entered.resolve(); await release.promise } }, { workerTimeoutMs: 5000 })
    const f = await createSdkFixture({ observer, persistentLifecycle: true })
    try {
      await entered.promise; const oldId = f.session.sessionManager.getSessionId(), oldBinding = observer.frames[0].binding
      f.setSteps([f.ai.fauxAssistantMessage('foreground-continues')]); await f.session.prompt('while-observer-blocked')
      expect(observer.getStatus().active).toBe(true); expect(f.session.messages.at(-1).content[0].text).toBe('foreground-continues')
      await f.runtime.newSession(); const newId = f.session.sessionManager.getSessionId()
      expect(newId).not.toBe(oldId); expect(oldCurrent!()).toBe(false); observer.close(oldBinding)
      expect(observer.getStatus().sessionId).toBe(newId)
      expect(f.raw.some(x => x.event.type === 'session_shutdown' && x.sessionId === oldId)).toBe(true)
      release.resolve(); await observer.idle()
      expect(observer.outcomes.some(x => x.status === 'stale')).toBe(true)
      f.assertReconciled(); proofs.push({ case: 'actual-replacement-shutdown-nonblocking', sdkVersion: f.sdkVersion, oldSessionId: oldId, newSessionId: newId })
    } finally { release.resolve(); await f.dispose() }
  }, 20000)
  test('actual queued steer is accepted before final settled boundary', async () => {
    const entered = deferred(), release = deferred(), f = await createSdkFixture()
    try {
      f.setSteps([async () => { entered.resolve(); await release.promise; return f.ai.fauxAssistantMessage('first-response') }, f.ai.fauxAssistantMessage('steered-response')])
      const running = f.session.prompt('initial-input'); await entered.promise
      await f.session.steer('synthetic-steer'); release.resolve(); await running; await f.observer.idle()
      expect(f.observer.frames.filter(x => x.kind === 'user.input')).toHaveLength(2)
      const events = f.raw.map(x => x.event), settled = events.findLastIndex(x => x.type === 'agent_settled'), steered = events.findLastIndex(x => x.type === 'message_end' && JSON.stringify(x.message).includes('steered-response'))
      expect(settled).toBeGreaterThan(steered); expect(steered).toBeGreaterThan(0)
      f.assertReconciled(); proofs.push({ case: 'actual-steer-final-settlement', sdkVersion: f.sdkVersion, fauxCalls: f.faux.state.callCount })
    } finally { release.resolve(); await f.dispose() }
  }, 20000)
  test('actual abort exposes terminal state and invalidates analysis lease', async () => {
    const entered = deferred(), f = await createSdkFixture()
    try {
      f.setSteps([async (_context: any, options: any) => { entered.resolve(); await new Promise<void>(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', () => resolve(), { once: true }) }); return f.ai.fauxAssistantMessage('aborted-partial', { stopReason: 'aborted' }) }])
      const running = f.session.prompt('abort-input'); await entered.promise; await f.session.abort(); await running; await f.observer.idle()
      expect(f.observer.frames.some(x => x.sourceEvent === 'message_end' && (x.payload as any).message?.stopReason === 'aborted')).toBe(true)
      expect(f.observer.frames.some(x => x.sourceEvent === 'agent_settled')).toBe(true)
      f.assertReconciled(); proofs.push({ case: 'actual-abort-terminal-state', sdkVersion: f.sdkVersion })
    } finally { await f.dispose() }
  }, 20000)
})
