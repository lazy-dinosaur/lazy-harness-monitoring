import { expect, test } from 'bun:test'
import { createHandlerWorkerPort } from '@lazy-harness/monitoring-core'
import { createInMemoryReviewSinkPort } from '@lazy-harness/monitoring-core/host'
import type { Trigger } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createMemoryHandlers, createMemoryMonitor, createMemoryRegistration, MEMORY_MODULE_ID, prepareMemoryCandidate, type MemoryWorkerPortFactory } from '@lazy-harness/monitoring-module-memory'
import { frame, input } from './support.ts'

const triggerFor = (): Trigger => {
  const s = input()
  return { moduleId: MEMORY_MODULE_ID, sessionId: s.context.scope.sessionId, eventId: s.frameId, subjectKey: prepareMemoryCandidate(s).dedupeKey, evidence: s.evidence.map(e => ({ id: e.id, kind: e.kind, version: e.version, text: e.text })) }
}

test('public memory handler map is pure, immutable, exact-trigger bound and cancellable', async () => {
  const handlers = createMemoryHandlers(input()), handler = handlers[`${MEMORY_MODULE_ID}.prepare-candidate`]
  const job = createMemoryRegistration().jobs[0], signal = new AbortController().signal, trigger = triggerFor()
  expect(Object.isFrozen(handlers) && Object.isFrozen(handler)).toBe(true)
  const result = await handler.run({ trigger, job, signal })
  expect(result).toEqual({ status: 'prepared', output: prepareMemoryCandidate(input()) })
  expect(result.report).toBeUndefined()
  const port = createHandlerWorkerPort(handlers, { maxActive: 1, maxQueued: 0, maxWork: 1 })
  try {
    const ticket = port.begin({ handlerId: `${MEMORY_MODULE_ID}.prepare-candidate`, context: { trigger, job } })
    expect(await port.wait(ticket)).toEqual({ status: 'completed', certainty: 'terminal', value: result })
    await port.settled(ticket)
  } finally { port.dispose(); await port.idle() }
  const predecessor = 'synthetic-predecessor'
  expect((await createMemoryHandlers(input(), predecessor)[`${MEMORY_MODULE_ID}.prepare-candidate`].run({ trigger, job, signal })).output).toEqual(prepareMemoryCandidate(input(), predecessor))
  for (const change of [{ moduleId: 'other' }, { eventId: 'other' }, { sessionId: 'other' }, { subjectKey: 'other' }, { evidence: trigger.evidence.map(e => ({ ...e, version: 'other' })) }]) expect((await handler.run({ trigger: { ...trigger, ...change }, job, signal })).status).toBe('rejected')
  const cancelled = new AbortController(); cancelled.abort()
  expect((await handler.run({ trigger, job, signal: cancelled.signal })).status).toBe('rejected')
  expect(() => createMemoryHandlers({ ...input(), conflict: true })).toThrow('deferred')
})

test('composition injects a fresh bounded port per runtime; runtime disposes each without sharing', async () => {
  const s = input(), sink = createInMemoryReviewSinkPort({ context: () => s.context }), ports: ReturnType<MemoryWorkerPortFactory>[] = []
  const createWorkerPort: MemoryWorkerPortFactory = (handlers, limits) => {
    expect(limits).toEqual({ maxActive: 1, maxQueued: 0, maxWork: 1, timeoutMs: 30000 })
    const port = createHandlerWorkerPort(handlers, limits); ports.push(port); return port
  }
  for (const stage of ['off', 'observe', 'shadow'] as const) {
    const monitor = createMemoryMonitor({ stage, reviewSink: sink.port, createWorkerPort, source: { capture: () => s, isCurrent: () => true } })
    try {
      const r = await monitor.onOpportunity(frame(), 'run')
      expect(r.prepared).toBe(stage === 'shadow')
    } finally { monitor.close(); await monitor.idle() }
  }
  expect(ports).toHaveLength(1)
  expect(ports[0].getStatus()).toMatchObject({ state: 'disposed', admitted: 1, rawActive: 0 })
  const second = createMemoryMonitor({ stage: 'shadow', reviewSink: sink.port, createWorkerPort, source: { capture: () => s, isCurrent: () => true } })
  try { await second.onOpportunity(frame(), 'run'); expect(ports).toHaveLength(2); expect(ports[0]).not.toBe(ports[1]); expect(ports[1].getStatus().state).toBe('disposed') } finally { second.close(); sink.close(); await second.idle() }
})

test('failed injected worker retains protection and never reaches the private sink', async () => {
  const s = input(), sink = createInMemoryReviewSinkPort({ context: () => s.context }); let factories = 0
  const monitor = createMemoryMonitor({ stage: 'shadow', reviewSink: sink.port, source: { capture: () => s, isCurrent: () => true }, createWorkerPort: (_handlers, limits) => { factories++; return createHandlerWorkerPort({ [`${MEMORY_MODULE_ID}.prepare-candidate`]: { run() { throw Error('Synthetic worker failure') } } }, limits) } })
  try {
    expect((await monitor.onOpportunity(frame(), 'run')).prepared).toBe(false)
    expect((await monitor.onOpportunity(frame(), 'run')).reason).toBe('unchanged-duplicate')
    expect(factories).toBe(1); expect(sink.inspect()).toEqual([])
  } finally { monitor.close(); sink.close(); await monitor.idle() }
})

test('close fences late injected worker output and idle retains raw settlement ownership', async () => {
  const s = input(), sink = createInMemoryReviewSinkPort({ context: () => s.context })
  let entered!: () => void, release!: () => void, port!: ReturnType<MemoryWorkerPortFactory>
  const started = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const monitor = createMemoryMonitor({ stage: 'shadow', reviewSink: sink.port, source: { capture: () => s, isCurrent: () => true }, createWorkerPort: (handlers, limits) => {
    const id = `${MEMORY_MODULE_ID}.prepare-candidate`
    port = createHandlerWorkerPort({ [id]: { async run(context) { const output = await handlers[id].run(context); entered(); await gate; return output } } }, limits)
    return port
  } })
  const pending = monitor.onOpportunity(frame(), 'run')
  try {
    await started; monitor.close()
    expect(port.getStatus().rawActive).toBe(1)
    expect(sink.inspect()).toEqual([])
    release()
    expect((await pending).prepared).toBe(false)
    await monitor.idle()
    expect(port.getStatus()).toMatchObject({ state: 'disposed', rawActive: 0 })
    expect(sink.inspect()).toEqual([])
  } finally { release(); monitor.close(); await pending; await monitor.idle(); sink.close() }
})

test('port exceeding memory limits is refused and disposed even when runtime construction fails', async () => {
  const s = input(), sink = createInMemoryReviewSinkPort({ context: () => s.context }); let port: ReturnType<typeof createHandlerWorkerPort> | undefined
  const monitor = createMemoryMonitor({ stage: 'shadow', reviewSink: sink.port, source: { capture: () => s, isCurrent: () => true }, createWorkerPort: handlers => { port = createHandlerWorkerPort(handlers, { maxActive: 2 }); return port } })
  try { expect((await monitor.onOpportunity(frame(), 'run')).prepared).toBe(false); expect(sink.inspect()).toEqual([]); expect(port!.getStatus().state).toBe('disposed') } finally { monitor.close(); sink.close(); await monitor.idle() }
})
