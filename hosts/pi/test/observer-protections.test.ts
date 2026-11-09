import { expect, test } from 'bun:test'
import { createPiObservationExtension, PiMonitoringObserver, type ObservationContext } from '../src/index.ts'
import { deferred } from './support/real-sdk.ts'

function unitContext() {
  const state = { leaf: 'unit-entry', messages: [{ role: 'user', content: 'unit-input', timestamp: 1 }] as any[] }
  const ctx: ObservationContext = { sessionManager: { getSessionId: () => 'unit-session', getLeafId: () => state.leaf,
    getBranch: () => [{ id: state.leaf, parentId: null, type: 'message' }], buildSessionProjection: () => ({ messages: state.messages }) }, getSystemPrompt: () => 'unit-system' }
  return { ctx, state }
}
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

test('observer disabled default registers nothing and allocates no active work', () => {
  const observer = new PiMonitoringObserver(() => undefined); let registrations = 0
  createPiObservationExtension({ observer })({ on() { registrations++ } })
  expect(registrations).toBe(0); expect(observer.frames).toEqual([]); expect(observer.getStatus().active).toBe(false)
})
test('observer snapshots are immutable independent copies and omit thinking, signatures, and images', async () => {
  const { ctx, state } = unitContext(), observer = new PiMonitoringObserver(() => undefined)
  state.messages.push({ role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_THINKING', signature: 'PRIVATE_SIGNATURE' },
    { type: 'image', data: 'PRIVATE_IMAGE', mimeType: 'image/png' }, { type: 'text', text: 'visible', textSignature: 'PRIVATE_SIGNATURE' }] })
  const binding = observer.open(ctx); observer.record(binding, { type: 'message_end', message: state.messages[1] }, ctx)
  const saved = JSON.stringify(observer.frames)
  expect(saved).not.toContain('PRIVATE_'); expect(saved).toContain('bodyOmitted'); expect(saved).toContain('visible')
  expect(Object.isFrozen(observer.frames[0]!.snapshot.canonicalMessages)).toBe(true)
  state.messages[0].content = 'changed'; expect(JSON.stringify(observer.frames)).toBe(saved)
  await observer.idle(); observer.close()
})
test('observer byte limits mark unavailable, never silently truncate to usable context', async () => {
  const { ctx, state } = unitContext(); let consumed = 0
  const observer = new PiMonitoringObserver(() => { consumed++ }, { maxSnapshotBytes: 1024 })
  state.messages[0].content = 'x'.repeat(5000)
  observer.record(observer.open(ctx), { type: 'turn_start' }, ctx); await observer.idle()
  expect(consumed).toBe(0); expect(observer.frames[0]!.available).toBe(false)
  expect(observer.frames[0]!.snapshot.missing).toBe('snapshot-byte-limit')
  expect(JSON.stringify(observer.frames[0]!.snapshot).length).toBeLessThan(1024)
  expect(observer.outcomes[0]!.status).toBe('unavailable'); observer.close()
})
test('observer queue overflow and changed canonical source reject stale results', async () => {
  const { ctx, state } = unitContext(), entered = deferred(), release = deferred()
  const observer = new PiMonitoringObserver(async () => { entered.resolve(); await release.promise }, { maxQueue: 1 })
  try {
    const binding = observer.open(ctx); observer.record(binding, { type: 'turn_start' }, ctx); await entered.promise
    observer.record(binding, { type: 'message_update' }, ctx); observer.record(binding, { type: 'message_update' }, ctx)
    state.leaf = 'new-leaf'; state.messages = [{ role: 'user', content: 'changed' }]
    release.resolve(); await observer.idle()
    expect(observer.outcomes.some(o => o.status === 'overflow')).toBe(true)
    expect(observer.outcomes.filter(o => o.status === 'stale')).toHaveLength(2)
    expect(observer.outcomes.some(o => o.status === 'handled')).toBe(false)
  } finally { release.resolve(); observer.close(); await observer.idle() }
})
test('observer timeout holds physical slot until raw settlement', async () => {
  const { ctx } = unitContext(), entered = deferred(), release = deferred(); let started = 0
  const observer = new PiMonitoringObserver(async () => { if (++started === 1) { entered.resolve(); await release.promise } }, { workerTimeoutMs: 10 })
  try {
    const binding = observer.open(ctx); observer.record(binding, { type: 'turn_start' }, ctx); await entered.promise
    await delay(25); observer.record(binding, { type: 'message_update' }, ctx); await delay(5)
    expect(started).toBe(1); expect(observer.getStatus().active).toBe(true); expect(observer.getStatus().queued).toBe(1)
    release.resolve(); await observer.idle()
    expect(started).toBe(2); expect(observer.outcomes.filter(o => o.status === 'timeout')).toHaveLength(1)
    expect(observer.outcomes.filter(o => o.status === 'handled')).toHaveLength(1)
  } finally { release.resolve(); observer.close(); await observer.idle() }
})
test('observer isolates consumer errors and old close cannot close replacement', async () => {
  const { ctx } = unitContext(), observer = new PiMonitoringObserver(() => { throw new Error('diagnostic-failure') })
  const old = observer.open(ctx), current = observer.open(ctx); observer.close(old)
  observer.record(current, { type: 'turn_start' }, ctx); await observer.idle()
  expect(observer.getStatus().sessionId).toBe('unit-session')
  expect(observer.outcomes.some(o => o.status === 'error' && o.reason === 'diagnostic-failure')).toBe(true); observer.close()
})
test('observer unsupported replacement fails closed and cannot revive old lease', async () => {
  const { ctx } = unitContext(), entered = deferred(), release = deferred(); let current!: () => boolean
  const observer = new PiMonitoringObserver(async (_frame, lease) => { current = lease.isCurrent; entered.resolve(); await release.promise })
  const hooks = new Map<string, any>()
  createPiObservationExtension({ enabled: true, observer })({ on(name, handler) { hooks.set(name, handler) } })
  try {
    hooks.get('session_start')({ type: 'session_start' }, ctx); await entered.promise
    const unsupported = { ...ctx, sessionManager: { ...ctx.sessionManager, buildSessionProjection() { throw new Error('unsupported-projection') } } }
    expect(hooks.get('session_start')({ type: 'session_start' }, unsupported)).toBeUndefined()
    expect(current()).toBe(false); expect(observer.getStatus().sessionId).toBeNull(); expect(observer.getStatus().lastError).toBe('unsupported-projection')
  } finally { release.resolve(); observer.close(); await observer.idle() }
})
test('observer retention exposes both frame and outcome eviction counts', async () => {
  const { ctx } = unitContext(), observer = new PiMonitoringObserver(() => undefined, { maxRetained: 2 })
  const binding = observer.open(ctx)
  for (let i = 0; i < 3; i++) observer.record(binding, { type: 'turn_start' }, ctx)
  await observer.idle()
  expect(observer.frames).toHaveLength(2); expect(observer.outcomes).toHaveLength(2)
  expect(observer.getStatus().observed).toBe(3); expect(observer.getStatus().evicted).toBe(1); expect(observer.getStatus().evictedOutcomes).toBe(1); observer.close()
})
