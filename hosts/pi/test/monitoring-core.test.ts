import { describe, expect, test } from 'bun:test'
import { MonitoringCore, type ContextSnapshot, type CoreEvent, type Decision, type JudgeBatchPort, type Processor, type Proposal } from '@lazy-harness/monitoring-core/engine/monitoring-core.ts'
import { createAuditObserver, createContextReferences, createMemorySink } from './support/pending-fixtures.ts'
const context = (version = 'v1'): ContextSnapshot => ({ scopeId: 'scope', version, goal: 'synthetic test', references: [{ id: 'ref', kind: 'knowledge', version: 'r1', content: 'synthetic evidence' }] })
const event = (sequence = 1, version = 'v1'): CoreEvent => ({ id: `e${sequence}`, kind: 'user.input', scopeId: 'scope', contextVersion: version, sequence, payload: { text: 'synthetic user statement' } })
const question = { instructions: 'Should this module run?', criteria: { run: 'needed', skip: 'not needed', defer: 'uncertain' } }
const judge = (mode: Decision['mode'] = 'run'): JudgeBatchPort => async tasks => Object.fromEntries(tasks.map(t => [t.processorId, { mode, reason: 'fixture replay, not model quality', evidenceRefs: [t.view.eventRef, ...t.view.context.references.map(r => r.id)] }]))
const processor = (id = 'sample.one', run?: Processor['run']): Processor => ({ id, eventKinds: ['user.input'], referenceKinds: [], allowedActions: ['test.propose'], question, run: run ?? (({ view }) => [{ kind: 'test.propose', payload: { eventId: view.event.id }, evidenceRefs: [view.eventRef] }]) })
function setup(options: Partial<ConstructorParameters<typeof MonitoringCore>[0]> = {}) {
  const memory = createMemorySink()
  const core = new MonitoringCore({ sink: memory.sink, judgeBatch: judge(), limits: { timeoutMs: 500 }, ...options })
  core.setContext(context())
  const register = (p: Processor) => core.registerProcessor(p, { actions: p.allowedActions, referenceKinds: p.referenceKinds })
  return { core, memory, register }
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5))

describe('monitoring core contracts', () => {
  test('is explicit-start, grant-limited and rejects duplicate registration', async () => {
    const { core, register } = setup()
    expect((await core.acceptEvent(event())).status).toBe('stopped')
    expect(() => core.registerProcessor(processor(), { actions: [], referenceKinds: [] })).toThrow('grants')
    register(processor()); expect(() => register(processor())).toThrow('duplicate')
    core.start(); expect((await core.acceptEvent(event())).outcomes[0]?.status).toBe('recorded'); core.dispose()
  })
  test('deduplicates identical inputs and rejects identity conflicts/out-of-order events', async () => {
    let calls = 0
    const { core, memory, register } = setup({ judgeBatch: async tasks => { calls++; return judge()(tasks, new AbortController().signal) } })
    register(processor()); core.start()
    await core.acceptEvent(event(2))
    expect((await core.acceptEvent(event(2))).status).toBe('duplicate')
    expect((await core.acceptEvent({ ...event(2), payload: { text: 'changed' } })).status).toBe('rejected')
    expect((await core.acceptEvent(event(1))).status).toBe('stale')
    expect(calls).toBe(1); expect(memory.records.size).toBe(1); core.dispose()
  })
  test('skip and defer do not call handlers or sinks', async () => {
    for (const mode of ['skip', 'defer'] as const) {
      const { core, memory, register } = setup({ judgeBatch: judge(mode) })
      register(processor()); core.start()
      const report = await core.acceptEvent(event())
      expect(report.outcomes[0]?.status).toBe(mode === 'skip' ? 'skipped' : 'deferred')
      expect(memory.records.size).toBe(0); expect(core.getStatus().used.executions).toBe(0); core.dispose()
    }
  })
  test('missing or fabricated judgement evidence is deferred, never treated as no work', async () => {
    for (const port of [async () => ({}), async () => ({ 'sample.one': { mode: 'run', reason: 'bad', evidenceRefs: ['invented'] } })] as JudgeBatchPort[]) {
      const { core, memory, register } = setup({ judgeBatch: port }); register(processor()); core.start()
      expect((await core.acceptEvent(event())).outcomes[0]?.status).toBe('deferred')
      expect(memory.records.size).toBe(0); core.dispose()
    }
  })
  test('a third observer registers without changing core logic and runs despite judge failure', async () => {
    const { core, memory, register } = setup({ judgeBatch: async () => { throw new Error('judge down') } })
    register(processor()); register(createAuditObserver()); core.start()
    const report = await core.acceptEvent(event())
    expect(report.outcomes.find(o => o.processorId === 'sample.one')?.status).toBe('deferred')
    expect(report.outcomes.find(o => o.processorId === 'audit.observation')?.status).toBe('recorded')
    expect(memory.records.size).toBe(1); core.dispose()
  })
  test('isolates one handler failure from another module', async () => {
    const { core, memory, register } = setup()
    register(processor('sample.fail', () => { throw new Error('broken module') })); register(processor('sample.ok')); core.start()
    const statuses = (await core.acceptEvent(event())).outcomes.map(o => o.status)
    expect(statuses).toEqual(['failed', 'recorded']); expect(memory.records.size).toBe(1); core.dispose()
  })
  test('enforces physical concurrency across module execution', async () => {
    let active = 0, peak = 0
    const { core, register } = setup({ limits: { maxConcurrent: 2, timeoutMs: 500 } })
    for (let i = 0; i < 4; i++) register(processor(`sample.p${i}`, async () => { active++; peak = Math.max(peak, active); await tick(); active--; return [] }))
    core.start(); await core.acceptEvent(event()); expect(peak).toBe(2); expect(core.getStatus().active).toBe(0); core.dispose()
  })
  test('context changes discard a late result without recording it', async () => {
    let release!: () => void, entered!: () => void
    const ready = new Promise<void>(r => entered = r), wait = new Promise<void>(r => release = r)
    const { core, memory, register } = setup()
    register(processor('sample.late', async ({ view }) => { entered(); await wait; return [{ kind: 'test.propose', payload: null, evidenceRefs: [view.eventRef] }] }))
    core.start(); const pending = core.acceptEvent(event()); await ready; core.setContext(context('v2')); release()
    expect((await pending).outcomes[0]?.status).toBe('stale'); expect(memory.records.size).toBe(0)
    expect(() => core.setContext({ ...context('v2'), goal: 'changed without version' })).toThrow('version'); core.dispose()
  })
  test('stop and unregister prevent late proposal delivery', async () => {
    for (const action of ['stop', 'unregister'] as const) {
      let release!: () => void, entered!: () => void
      const ready = new Promise<void>(r => entered = r), wait = new Promise<void>(r => release = r)
      const { core, memory, register } = setup()
      register(processor('sample.late', async ({ view }) => { entered(); await wait; return [{ kind: 'test.propose', payload: null, evidenceRefs: [view.eventRef] }] }))
      core.start(); const pending = core.acceptEvent(event()); await ready
      if (action === 'stop') core.stop(); else core.unregisterProcessor('sample.late')
      release(); expect(['cancelled', 'stale']).toContain((await pending).outcomes[0]?.status); expect(memory.records.size).toBe(0); core.dispose()
    }
  })
  test('time-bounds logical work but keeps the slot until an ignored abort actually settles', async () => {
    let release!: () => void
    const wait = new Promise<void>(r => release = r)
    const { core, register } = setup({ limits: { maxConcurrent: 1, timeoutMs: 20 } })
    register(processor('sample.hang', async () => { await wait; return [] })); core.start()
    const report = await core.acceptEvent(event()); expect(report.outcomes[0]?.status).toBe('failed'); expect(core.getStatus().active).toBe(1)
    release(); await tick(); expect(core.getStatus().active).toBe(0); core.dispose()
  })
  test('a receipt must identify the actual request and recorded proposal', async () => {
    const { core, register } = setup({ sink: async () => ({ requestId: 'invented', status: 'recorded', recordId: 'x' }) })
    register(processor()); core.start(); expect((await core.acceptEvent(event())).outcomes[0]?.status).toBe('unverified'); core.dispose()
  })
  test('validates all proposal grants before delivering any proposal', async () => {
    const { core, memory, register } = setup()
    register(processor('sample.bad', ({ view }) => [{ kind: 'test.propose', payload: null, evidenceRefs: [view.eventRef] }, { kind: 'not.granted', payload: null, evidenceRefs: [view.eventRef] }]))
    core.start(); expect((await core.acceptEvent(event())).outcomes[0]?.status).toBe('failed'); expect(memory.records.size).toBe(0); core.dispose()
  })
  test('requires granted reads and rejects changed source versions', async () => {
    const { core, memory, register } = setup({ readReference: async ref => ({ ...ref, version: 'wrong' }) })
    register(createContextReferences()); core.start(); expect((await core.acceptEvent(event())).outcomes[0]?.status).toBe('failed'); expect(memory.records.size).toBe(0); core.dispose()
  })
  test('does not reset judgement budgets on stop/start', async () => {
    const { core, register } = setup({ limits: { maxJudgeBatches: 1, timeoutMs: 500 } })
    register(processor()); core.start(); await core.acceptEvent(event()); core.stop(); core.start()
    expect((await core.acceptEvent(event(2))).outcomes[0]?.status).toBe('deferred'); expect(core.getStatus().used.judgeBatches).toBe(1); core.dispose()
  })
  test('keeps views immutable and protects event identity from module output', async () => {
    const { core, register } = setup()
    register(processor('sample.mutate', ({ view }) => { (view.event.payload as any).text = 'mutated'; return [] }))
    core.start(); expect((await core.acceptEvent(event())).outcomes[0]?.status).toBe('failed'); core.dispose()
  })
})

test('rejects silently coerced JSON payloads before any proposal is delivered', async () => {
  const { core, memory, register } = setup()
  register(processor('sample.invalid', ({ view }) => [{ kind: 'test.propose', payload: undefined as any, evidenceRefs: [view.eventRef] }]))
  core.start()
  expect((await core.acceptEvent(event())).outcomes[0]?.status).toBe('failed')
  expect(memory.records.size).toBe(0)
  await expect(core.acceptEvent({ ...event(2), payload: NaN })).rejects.toThrow('JSON')
  core.dispose()
})
test('rejects changed source contents even if a reader reuses the version', async () => {
  const { core, memory, register } = setup({ readReference: async ref => ({ ...ref, content: 'changed without version' }) })
  register(createContextReferences()); core.start()
  expect((await core.acceptEvent(event())).outcomes[0]?.status).toBe('failed')
  expect(memory.records.size).toBe(0); core.dispose()
})

test('core capacity: event and execution limits are checked before extra work', async () => {
  const { core, memory, register } = setup({ limits: { maxEvents: 1, maxExecutions: 1, timeoutMs: 500 } })
  register(processor('sample.first')); register(processor('sample.second')); core.start()
  const report = await core.acceptEvent(event())
  expect(report.outcomes.filter(o => o.status === 'recorded')).toHaveLength(1)
  expect(report.outcomes.filter(o => o.status === 'failed')).toHaveLength(1)
  expect(memory.records.size).toBe(1)
  expect((await core.acceptEvent(event(2))).status).toBe('rejected')
  expect((await core.acceptEvent(event())).status).toBe('duplicate')
  core.dispose()
})
test('core capacity: reference reads are bounded before further port access', async () => {
  const { core, memory, register } = setup({ limits: { maxReads: 1, timeoutMs: 500 } })
  register({ ...processor('sample.read'), referenceKinds: ['knowledge'], run: async ({ readReference }) => { await readReference('ref'); await readReference('ref'); return [] } })
  core.start(); const report = await core.acceptEvent(event())
  expect(report.outcomes[0]?.status).toBe('failed')
  expect(report.outcomes[0]?.reason).toContain('read budget')
  expect(memory.records.size).toBe(0); core.dispose()
})
test('core capacity: queue overflow and queued deadlines do not release a hung physical slot', async () => {
  let release!: () => void
  const wait = new Promise<void>(r => release = r)
  const { core, register } = setup({ limits: { maxConcurrent: 1, maxQueued: 1, timeoutMs: 20 } })
  register(processor('sample.hung', async () => { await wait; return [] }))
  register(processor('sample.queued')); register(processor('sample.overflow')); core.start()
  const report = await core.acceptEvent(event())
  expect(report.outcomes.every(o => o.status === 'failed')).toBe(true)
  expect(report.outcomes.some(o => o.reason === 'queue limit')).toBe(true)
  expect(core.getStatus().queued).toBe(0)
  expect(core.getStatus().active).toBe(1)
  release(); await tick(); expect(core.getStatus().active).toBe(0); core.dispose()
})
