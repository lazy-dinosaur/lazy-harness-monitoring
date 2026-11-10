import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemoryWorkerPort, createMemoryStatePort, openMonitoringState, runStatePortConformance, statePartitionId, type MemoryStateBacking, type StateBinding, type StatePersistencePort, type StateSnapshot, type WorkerJobRequest } from '@lazy-harness/monitoring-core'
import { createFileStatePort } from '@lazy-harness/monitoring-core/state-file'
import { ContextCarryMailbox } from '../src/engine/monitoring-core-context-mailbox.ts'
import { moduleSpec, runtime } from './support/p2-fixtures.ts'

const binding = (costly = false, riskTier = 'read-only'): StateBinding => ({ bindingId: 'fixture-binding', moduleId: 'm', declarationHash: moduleSpec('m', 'active', costly, riskTier).declarationHash, configHash: 'synthetic-config', modelFingerprint: 'synthetic-model', scope: { sessionId: 'session', branchId: 'branch', bindingGeneration: 1, branchGeneration: 1, compactionGeneration: 1 } })
const mailItem = { id: 'item', reportId: 'report', moduleId: 'm', scope: { sessionId: 'session', branchId: 'branch', turn: 1 }, createdAt: 10, dependencies: [], text: 'Synthetic only' }
const box = (state: ReturnType<typeof openMonitoringState>) => new ContextCarryMailbox({ state, maxAgeMs: 100, maxCarryTurns: 1, maxItems: 2, maxTextBytes: 100, sourceVersion: () => '1' })
const memoryFactory = () => {
  const backings = new Map<string, MemoryStateBacking>()
  return (id: string, _binding: StateBinding, limits?: Parameters<typeof createMemoryStatePort>[1]) => {
    if (!backings.has(id)) backings.set(id, {})
    return createMemoryStatePort(backings.get(id)!, limits)
  }
}

describe('R7 state persistence (synthetic, no provider IO)', () => {
  test('memory backing passes reusable runtime/restart/crash conformance', async () => {
    const result = await runStatePortConformance(memoryFactory())
    expect(result.checks.length).toBeGreaterThanOrEqual(30)
  })
  test('file backing passes the SAME conformance across fresh port instances', async () => {
    const root = mkdtempSync(join(tmpdir(), 'monitoring-state-'))
    try {
      const result = await runStatePortConformance((id, b, limits) => {
        const path = join(root, id); mkdirSync(path, { recursive: true })
        return createFileStatePort(path, b, limits)
      })
      expect(result.checks.length).toBeGreaterThanOrEqual(30)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  test('conformance rejects a deliberately forgetful backend', async () => {
    const factory = memoryFactory(), opens = new Map<string, number>()
    await expect(runStatePortConformance((id, b, limits) => {
      const n = opens.get(id) ?? 0; opens.set(id, n + 1)
      return n ? createMemoryStatePort({}, limits) : factory(id, b, limits)
    })).rejects.toThrow('state-port conformance')
  })
  test.each(['not-json', 'unknown-envelope', 'unknown-schema', 'checksum', 'missing', 'oversized'])('file corruption is fail-closed: %s', fault => {
    const root = mkdtempSync(join(tmpdir(), 'monitoring-corrupt-')), b = binding()
    try {
      const p = createFileStatePort(root, b); openMonitoringState(p, b)
      const directory = join(root, statePartitionId(b)), path = join(directory, 'state.json')
      const raw = readFileSync(path, 'utf8'), e = JSON.parse(raw)
      if (fault === 'not-json') writeFileSync(path, '{')
      if (fault === 'unknown-envelope') writeFileSync(path, JSON.stringify({ ...e, format: 'monitoring-state/v9' }))
      if (fault === 'unknown-schema') writeFileSync(path, JSON.stringify({ ...e, state: { ...e.state, schemaVersion: 9 } }))
      if (fault === 'checksum') writeFileSync(path, raw.replace('synthetic-config', 'modified-config'))
      if (fault === 'missing') unlinkSync(path)
      if (fault === 'oversized') writeFileSync(path, ' '.repeat(p.limits.maxBytes + 257))
      expect(() => openMonitoringState(createFileStatePort(root, b), b)).toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  test('file commit receipt, private permissions, hashed partition and fixed-size temp cleanup', () => {
    const root = mkdtempSync(join(tmpdir(), 'monitoring-layout-')), b = binding()
    try {
      const p = createFileStatePort(root, b), s = openMonitoringState(p, b), current = s.view()
      expect(p.commit(current.revision, { ...current, revision: current.revision + 1 })).toEqual({ revision: current.revision + 1, durability: 'fsync' })
      const name = statePartitionId(b), directory = join(root, name)
      expect(name).toMatch(/^[a-f0-9]{64}$/)
      expect(readdirSync(root)).toEqual([name]); expect(readdirSync(directory)).toEqual(['state.json'])
      expect(statSync(directory).mode & 0o777).toBe(0o700)
      expect(statSync(join(directory, 'state.json')).mode & 0o777).toBe(0o600)
      expect(statSync(join(directory, 'state.json')).size).toBeLessThan(p.limits.maxBytes + 256)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  test('memory stored corruption and unknown version reject startup', () => {
    for (const json of ['{', '{"schemaVersion":9}', '{"schemaVersion":1}']) expect(() => openMonitoringState(createMemoryStatePort({ json }), binding())).toThrow()
  })
  test('whole-snapshot byte cap refuses without removing old keys', () => {
    const backing: MemoryStateBacking = {}, p = createMemoryStatePort(backing, { maxBytes: 2048 }), s = openMonitoringState(p, binding())
    const before = backing.json
    expect(() => s.enqueue({ ...mailItem, text: 'x'.repeat(3000) })).toThrow()
    expect(backing.json).toBe(before)
    expect(openMonitoringState(createMemoryStatePort(backing, { maxBytes: 2048 }), binding()).view().mailbox).toHaveLength(0)
  })
  test('persistent costs use full caps, including across reapproval/restart', async () => {
    const backing: MemoryStateBacking = {}, b = binding(true)
    let state = openMonitoringState(createMemoryStatePort(backing), b), calls = 0
    const handler = { run: () => { calls++; return { status: 'prepared' as const } } }
    let f = runtime(handler, { state }, true)
    await f.fire('one'); await f.r.idle(); f.r.dispose()
    state = openMonitoringState(createMemoryStatePort(backing), b)
    f = runtime(handler, { state }, true)
    await f.fire('two'); await f.r.idle()
    // Current approval has two dispatches; a new gate must not mint two MORE dispatches.
    f.budget.approve({ moduleId: 'm', caps: { workerDispatches: 2 }, approvedBy: 'synthetic-renewal' })
    await expect(f.fire('three')).rejects.toThrow('durable budget exhausted')
    expect(calls).toBe(2)
    expect(openMonitoringState(createMemoryStatePort(backing), b).view().work.map(w => w.cost?.caps.workerDispatches)).toEqual([1, 1])
    f.r.dispose()
  })
  test('uncertain ledger survives real handler failure and cannot be retried', async () => {
    const backing: MemoryStateBacking = {}, b = binding()
    let calls = 0, state = openMonitoringState(createMemoryStatePort(backing), b)
    let f = runtime({ run: () => { calls++; throw Error('synthetic failure') } }, { state })
    expect((await f.fire('one'))[0]?.status).toBe('uncertain'); await f.r.idle(); f.r.dispose()
    state = openMonitoringState(createMemoryStatePort(backing), b)
    f = runtime({ run: () => { calls++; return { status: 'prepared' } } }, { state })
    expect((await f.fire('one'))[0]?.reason).toBe('duplicate:uncertain'); expect(calls).toBe(1)
    expect(state.view().work[0]?.operationId).toBe(`attempt:${state.view().work[0]?.key}`)
    f.r.dispose()
  })
  test('dispatch write failure cannot call a local handler', async () => {
    const p = createMemoryStatePort(), b = binding(); let calls = 0
    const faulty: StatePersistencePort = { ...p, commit(expected, next) { if (next.work.some(w => w.status === 'started')) throw Error('synthetic dispatch crash'); return p.commit(expected, next) } }
    const f = runtime({ run: () => { calls++; return { status: 'prepared' } } }, { state: openMonitoringState(faulty, b) })
    await expect(f.fire('one')).rejects.toThrow(); await f.r.idle()
    expect(calls).toBe(0); expect(openMonitoringState(p, b).view().work[0]?.status).toBe('rejected')
    f.r.dispose()
  })
  test('result write failure leaves effect uncertain; effect receipt persists on healthy completion', async () => {
    const p = createMemoryStatePort(), b = binding(false, 'automatic'); let calls = 0
    const faulty: StatePersistencePort = { ...p, commit(expected, next) { if (next.work.some(w => w.status === 'executed')) throw Error('synthetic result crash'); return p.commit(expected, next) } }
    const module = moduleSpec('m', 'active', false, 'automatic')
    const f = runtime({ run: () => { calls++; return { status: 'executed', effectId: 'synthetic-effect' } } }, { modules: [module], state: openMonitoringState(faulty, b) })
    await expect(f.fire('one')).rejects.toThrow(); await f.r.idle()
    const recovered = openMonitoringState(p, b)
    expect(recovered.view().work[0]?.status).toBe('uncertain'); expect(calls).toBe(1)
    f.r.dispose()
    const blocked = runtime({ run: () => { calls++; return { status: 'executed', effectId: 'must-not-execute' } } }, { modules: [module], state: recovered })
    expect((await blocked.fire('two'))[0]?.reason).toBe('persistence_unresolved_work'); expect(calls).toBe(1); blocked.r.dispose()
    // Independent healthy fixture, not deletion/reopening of the unresolved production partition.
    const healthyBinding = { ...b, bindingId: 'healthy-synthetic-binding' }, healthy = openMonitoringState(createMemoryStatePort(), healthyBinding)
    const clean = runtime({ run: () => ({ status: 'executed', effectId: 'synthetic-effect-2' }) }, { modules: [module], state: healthy })
    await clean.fire('two'); await clean.r.idle()
    expect(healthy.view().work[0]?.outcome?.effectId).toBe('synthetic-effect-2'); clean.r.dispose()
  })
  test('receiver accepted but lost ack is never re-enqueued after restart', async () => {
    const p = createMemoryStatePort(), b = binding(); let reports = 0
    const f = runtime({ run: () => ({ status: 'prepared' }) }, { state: openMonitoringState(p, b), report: () => { reports++; throw Error('synthetic lost ack') } })
    await f.fire('one'); await f.r.idle(); f.r.dispose()
    const s = openMonitoringState(p, b), next = runtime({ run: () => ({ status: 'prepared' }) }, { state: s, report: () => { reports++; throw Error('must not run') } })
    expect((await next.fire('one'))[0]?.reason).toBe('duplicate:prepared')
    expect(s.view().work[0]?.report?.receipt).toBe('unknown'); expect(reports).toBe(1); next.r.dispose()
  })
  test('lost delivery-intent commit acknowledgement withholds text and never reinjects', () => {
    const p = createMemoryStatePort(), b = binding()
    const faulty: StatePersistencePort = { ...p, commit(expected, next) { const r = p.commit(expected, next); if (next.mailbox.some(m => m.status === 'delivery-uncertain')) throw Error('synthetic lost ack'); return r } }
    const old = box(openMonitoringState(faulty, b)); old.put(mailItem, 10)
    expect(() => old.take(mailItem.scope, 11, true)).toThrow()
    const s = openMonitoringState(p, b), recovered = box(s)
    expect(recovered.take(mailItem.scope, 12, true)).toHaveLength(0)
    expect(recovered.put(mailItem, 12)).toBe(false)
    expect(s.view().mailbox[0]?.status).toBe('delivery-uncertain')
  })
  test.each(['bindingGeneration', 'branchGeneration', 'compactionGeneration'] as const)('each host generation drops pending mail: %s', generation => {
    const p = createMemoryStatePort(), b = binding(), old = openMonitoringState(p, b)
    box(old).put(mailItem, 10)
    const changed = { ...b, scope: { ...b.scope, [generation]: 2 } }, recovered = openMonitoringState(p, changed)
    expect(box(recovered).pending).toBe(0); expect(recovered.view().mailbox[0]?.status).toBe('dropped')
    expect(box(recovered).put(mailItem, 11)).toBe(false)
  })
  test('external accepted tickets are uncertain even if the worker had not physically started', async () => {
    const p = createMemoryStatePort(), b = binding(), old = openMonitoringState(p, b)
    let release!: () => void, calls = 0, targetFence = old.view().fence
    const gate = new Promise<void>(resolve => { release = resolve })
    const workerPort = createInMemoryWorkerPort<WorkerJobRequest, { status: 'prepared' | 'rejected' }>(async request => {
      expect(request.stateAttempt?.operationId).toBe(`attempt:${request.stateAttempt?.key}`)
      // Synthetic TARGET enforces the fence; core alone cannot stop an old external side effect.
      if (request.stateAttempt?.fence !== targetFence) return { status: 'rejected' }
      calls++; await gate; return { status: 'prepared' }
    }, { maxActive: 1, maxQueued: 1, timeoutMs: 1000 })
    const f = runtime({ run: () => { throw Error('external port owns execution') } }, { state: old, workerPort })
    const first = f.fire('one').catch(() => undefined), queued = f.fire('two').catch(() => undefined)
    expect(old.view().work.map(w => w.status)).toEqual(['started', 'started'])
    const recovered = openMonitoringState(p, b); targetFence = recovered.view().fence
    const next = runtime({ run: () => { calls++; return { status: 'prepared' } } }, { state: recovered })
    expect((await next.fire('one'))[0]?.reason).toBe('duplicate:uncertain')
    expect((await next.fire('two'))[0]?.reason).toBe('duplicate:uncertain')
    release(); await Promise.all([first, queued]); await f.r.idle()
    expect(calls).toBe(1); expect(recovered.view().work.every(w => w.status === 'uncertain')).toBe(true)
    f.r.dispose(); next.r.dispose()
  })
  test('terminal effect receipt survives a crash before report intent; handler is not replayed', async () => {
    const p = createMemoryStatePort(), b = binding(false, 'automatic'), module = moduleSpec('m', 'active', false, 'automatic')
    let calls = 0, reports = 0
    const faulty: StatePersistencePort = { ...p, commit(expected, next) { if (next.work.some(w => w.report)) throw Error('synthetic pre-enqueue crash'); return p.commit(expected, next) } }
    const f = runtime({ run: () => { calls++; return { status: 'executed', effectId: 'synthetic-final-effect' } } }, { modules: [module], state: openMonitoringState(faulty, b), report: () => { reports++; throw Error('must not enqueue') } })
    await expect(f.fire('one')).rejects.toThrow(); await f.r.idle()
    const s = openMonitoringState(p, b)
    expect(s.view().work[0]?.outcome?.effectId).toBe('synthetic-final-effect')
    const next = runtime({ run: () => { calls++; return { status: 'executed', effectId: 'must-not-execute' } } }, { modules: [module], state: s })
    expect((await next.fire('one'))[0]?.reason).toBe('duplicate:executed'); expect(calls).toBe(1); expect(reports).toBe(0)
    f.r.dispose(); next.r.dispose()
  })
  test('scope mismatch, stale owner, accessor state and incompatible runtime fail closed', async () => {
    const p = createMemoryStatePort(), b = binding(), s = openMonitoringState(p, b)
    expect(() => runtime({ run: () => ({ status: 'prepared' }) }, { state: s, modules: [moduleSpec('other')] })).toThrow('invalid runtime state binding')
    const f = runtime({ run: () => ({ status: 'prepared' }) }, { state: s })
    await expect(f.fire('wrong-session', undefined, { sessionId: 'other' })).rejects.toThrow('scope mismatch')
    openMonitoringState(p, b)
    await expect(f.fire('old-owner')).rejects.toThrow('stale state owner')
    let getters = 0
    expect(() => openMonitoringState({ ...p, read: () => ({ get schemaVersion() { getters++; return 1 } }) as StateSnapshot }, b)).toThrow()
    expect(getters).toBe(0); f.r.dispose()
  })
})
