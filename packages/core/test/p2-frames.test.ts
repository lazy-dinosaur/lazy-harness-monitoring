import { expect, test } from 'bun:test'
import type { ObservationFrame } from '@lazy-harness/monitoring-core/host'
import { coordinator, frame } from './support/p2-fixtures.ts'
import { deferred, flush, ManualClock, P2_SEEDS, SeededScheduler } from './support/p2-scheduler.ts'

test('identical duplicate frame is accounted once; ready provenance remains exact', async () => {
  const c = coordinator(), f = frame(1)
  try {
    c.accept(f); c.accept(f); await c.idle()
    expect(c.getStatus()).toMatchObject({ observed: 1, admitted: 1, started: 1, ready: 1 })
    const offers = c.takeReady('module')
    expect(offers).toHaveLength(1)
    expect(offers[0]!.candidate).toMatchObject({ frameId: f.id, sessionId: 'session', binding: 1, dependencies: [{ id: 'source', version: '1' }] })
    expect(offers[0]!.isCurrent()).toBe(true); expect(c.takeReady('module')).toEqual([])
    expect(c.traces.some(t => t.reason === 'duplicate')).toBe(true)
  } finally { c.dispose() }
})
for (const [name, next, reason] of [
  ['identity conflict', frame(1, 'tool_result', { payload: { changed: true } }), 'identity_conflict'],
  ['cursor gap', frame(3), 'source_gap'],
  ['out of order new identity', frame(1, 'tool_result', { id: 'old' }), 'source_gap'],
  ['session change', frame(2, 'tool_result', { sessionId: 'other', snapshot: { ...frame(2).snapshot, sessionId: 'other' } }), 'scope_changed'],
  ['binding change', frame(2, 'tool_result', { binding: 2 }), 'scope_changed'],
] as const) test(`${name} stops admission and revokes in-flight work`, async () => {
  const gate = deferred(), c = coordinator({ prepare: async () => { await gate.promise; return { channel: 'module', payload: {} } } })
  try {
    c.accept(frame(1)); await flush(); expect(c.getStatus().active).toBe(1)
    c.accept(next); expect(c.getStatus()).toMatchObject({ state: 'stopped', active: 1 })
    expect(c.traces.some(t => t.reason === reason)).toBe(true)
    gate.resolve(); await c.idle(); expect(c.takeReady('module')).toEqual([])
    expect(c.getStatus()).toMatchObject({ active: 0, queued: 0, ready: 0 })
  } finally { gate.resolve(); c.dispose(); await c.idle() }
})
for (const event of ['session_tree', 'session_compact', 'model_select', 'thinking_level_select', 'input']) {
  test(`${event} invalidates a previously offered lease`, async () => {
    const c = coordinator()
    try { c.accept(frame(1)); await c.idle(); const offer = c.takeReady('module')[0]!; c.accept(frame(2, event)); expect(offer.isCurrent()).toBe(false); expect(c.getStatus().ready).toBe(0) }
    finally { c.dispose() }
  })
}
for (const [name, bad] of [
  ['absent snapshot', { snapshot: null }], ['cross-session snapshot', { snapshot: { ...frame(1).snapshot, sessionId: 'other' } }],
  ['invalid availability', { available: 'yes' }], ['non-JSON snapshot', { snapshot: { ...frame(1).snapshot, revision: undefined } }],
] as const) test(`malformed frame: ${name} fails closed`, async () => {
  const c = coordinator()
  try { c.accept({ ...frame(1), ...bad } as unknown as ObservationFrame); await c.idle(); expect(c.getStatus().state).toBe('stopped'); expect(c.traces.at(-1)?.reason).toBe('malformed'); expect(c.getStatus().started).toBe(0) }
  finally { c.dispose() }
})
for (const outer of [false, true]) test(`unavailable ${outer ? 'snapshot' : 'frame'} never prepares`, async () => {
  const c = coordinator()
  try { c.accept(frame(1, 'tool_result', outer ? { snapshot: { ...frame(1).snapshot, available: false } } : { available: false })); await c.idle(); expect(c.getStatus()).toMatchObject({ observed: 1, started: 0, ready: 0 }); expect(c.traces.at(-1)?.reason).toBe('unavailable') }
  finally { c.dispose() }
})
test('coordinator rejects snapshots missing required internals', async () => {
  const c = coordinator()
  try {
    const malformed = { sessionId: 'session', available: true }
    c.accept(frame(1, 'tool_result', { snapshot: malformed as ObservationFrame['snapshot'] })); await c.idle()
    expect(c.getStatus()).toMatchObject({ state: 'stopped', observed: 0, started: 0, ready: 0 })
    expect(c.traces.at(-1)?.reason).toBe('malformed')
  } finally { c.dispose() }
})
for (const seed of P2_SEEDS) test(`seed ${seed}: source/permission revocation and completion cannot publish stale work`, async () => {
  let version = '1', allowed = true
  const gate = deferred(), scheduler = new SeededScheduler(seed)
  const c = coordinator({ sourceVersion: () => version, isPermitted: () => allowed, prepare: async () => { await gate.promise; return { channel: 'module', payload: {} } } })
  try {
    c.accept(frame(1)); await flush()
    await scheduler.run([{ name: 'source', run() { version = '2' } }, { name: 'revoke', run() { allowed = false } }, { name: 'resolve', run() { gate.resolve() } }])
    await c.idle(); expect(c.takeReady('module')).toEqual([]); expect(c.getStatus().active).toBe(0)
    expect(scheduler.trace).toEqual(new SeededScheduler(seed).order(['source', 'revoke', 'resolve']))
  } finally { gate.resolve(); c.dispose(); await c.idle() }
})
test('virtual timeout retains coordinator raw slot until settlement and suppresses late result', async () => {
  const clock = new ManualClock(), restore = clock.install(), gate = deferred()
  const c = coordinator({ prepare: async () => { await gate.promise; return { channel: 'module', payload: {} } }, limits: { maxActive: 1, jobTimeoutMs: 10 } })
  try {
    c.accept(frame(1)); await flush(); await clock.advance(9); expect(c.traces.some(t => t.reason === 'timeout')).toBe(false)
    await clock.advance(1); expect(c.traces.some(t => t.reason === 'timeout')).toBe(true)
    c.accept(frame(2)); await flush(); expect(c.getStatus()).toMatchObject({ active: 1, queued: 1, started: 1 })
    gate.resolve(); await c.idle(); expect(c.takeReady('module')).toHaveLength(1)
    expect(c.traces.filter(t => t.reason === 'ready').map(t => t.frameId)).toEqual(['frame:2'])
  } finally { gate.resolve(); c.dispose(); await c.idle(); restore() }
})
test('coordinator queue/event bounds stop safely and drain to zero exposed work objects', async () => {
  const gate = deferred(), c = coordinator({ prepare: async () => { await gate.promise; return { channel: 'module', payload: {} } }, limits: { maxActive: 1, maxQueued: 1, maxEvents: 3, maxTrace: 3 } })
  try {
    c.accept(frame(1)); await flush(); c.accept(frame(2)); c.accept(frame(3))
    expect(c.getStatus()).toMatchObject({ observed: 3, active: 1, queued: 1, started: 1 })
    expect(c.traces.some(t => t.reason === 'overflow')).toBe(true)
    c.accept(frame(4)); expect(c.getStatus()).toMatchObject({ state: 'stopped', observed: 3, active: 1, queued: 0 })
    gate.resolve(); await c.idle(); expect(c.getStatus()).toMatchObject({ active: 0, queued: 0, ready: 0, readyBytes: 0 })
    expect(c.traces.length).toBeLessThanOrEqual(3)
  } finally { gate.resolve(); c.dispose(); await c.idle() }
})
test('ready mailbox count ceiling refuses excess candidates without hidden retention', async () => {
  const c = coordinator({ limits: { maxReady: 1 } })
  try {
    c.accept(frame(1)); await c.idle(); c.accept(frame(2)); await c.idle()
    expect(c.getStatus().ready).toBe(1); expect(c.traces.some(t => t.reason === 'mailbox_overflow')).toBe(true)
    expect(c.takeReady('module')).toHaveLength(1); expect(c.getStatus().readyBytes).toBe(0)
  } finally { c.dispose() }
})
for (const kind of ['permission', 'source', 'dependencies', 'prepare', 'result'] as const) test(`coordinator ${kind} fault is contained`, async () => {
  const c = coordinator({ ...(kind === 'permission' ? { isPermitted: () => { throw Error('fault') } } : {}),
    ...(kind === 'source' ? { sourceVersion: () => { throw Error('fault') } } : {}),
    ...(kind === 'dependencies' ? { dependencies: () => [] } : {}),
    ...(kind === 'prepare' ? { prepare: () => { throw Error('fault') } } : {}),
    ...(kind === 'result' ? { prepare: () => ({ channel: 'wrong', payload: {} }) as never } : {}) })
  try { c.accept(frame(1)); await c.idle(); expect(c.takeReady('module')).toEqual([]); expect(c.getStatus()).toMatchObject({ state: 'running', active: 0, queued: 0 }); expect(c.traces.length).toBeGreaterThan(0) }
  finally { c.dispose() }
})
