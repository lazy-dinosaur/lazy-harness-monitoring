import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { RealtimeMonitoringCoordinator, createPiRealtimeTap, type RealtimeOptions, type RealtimePrepared, type RealtimeLease, type RealtimeOffer } from '../src/engine/monitoring-core-realtime.ts'
import { PiMonitoringObserver, observationEvents, type ObservationFrame, type ObservationSnapshot } from '../src/observer/monitoring-observer.ts'
import { createSdkFixture, deferred, sdkEntry } from '../../packages/lazy-harness-pi/tests/support/monitoring-sdk-fixture.ts'

const prepared = (channel: 'context' | 'module' = 'module', payload: any = { marker: 'PREPARED_SYNTHETIC_ONLY' }): RealtimePrepared => ({ channel, payload })
function setup(overrides: Partial<RealtimeOptions> = {}) {
  const host = { permitted: true }, versions = new Map([['fixture-evidence', 'v1']])
  const coordinator = new RealtimeMonitoringCoordinator({ enabled: true, watchEvents: ['tool_result'], isPermitted: () => host.permitted, dependencies: () => [{ id: 'fixture-evidence', version: 'v1' }], sourceVersion: id => versions.get(id), prepare: () => prepared(), ...overrides })
  coordinator.start({ sessionId: 'mechanical-session', binding: 1 })
  let cursor = 0
  const frame = (sourceEvent: string, payload: any = {}, patch: Partial<ObservationFrame> = {}): ObservationFrame => {
    const n = ++cursor
    const snapshot: ObservationSnapshot = { sessionId: 'mechanical-session', leafId: `leaf-${n}`, branch: [], canonicalMessages: [], effectiveSystemPrompt: 'synthetic-only', stage: sourceEvent === 'context' ? 'context_conversation_at_hook' : sourceEvent === 'context_with_system' ? 'context_with_system_at_hook' : 'canonical_projection', canonicalHash: `changing-whole-projection-${n}`, revision: `revision-${n}`, available: true, fullProviderContext: false, omitted: [] }
    return { id: `mechanical-frame:${n}`, cursor: n, sourceEvent, kind: sourceEvent.replaceAll('_', '.'), sessionId: snapshot.sessionId, binding: 1, epoch: n * 10, payload, snapshot, available: true, ...patch }
  }
  return { coordinator, host, versions, frame, emit(sourceEvent: string, payload: any = {}, patch: Partial<ObservationFrame> = {}) { const f = frame(sourceEvent, payload, patch); coordinator.accept(f); return f } }
}
const reasons = (c: RealtimeMonitoringCoordinator) => c.traces.map(x => x.reason)

describe('A realtime mechanical qualification (not semantic model accuracy)', () => {
  test('default off and tap default off create no handlers/jobs; options are captured', () => {
    const options: RealtimeOptions = { watchEvents: ['tool_result'], isPermitted: () => true, dependencies: () => [{ id: 'd', version: '1' }], sourceVersion: () => '1', prepare: () => prepared() }
    const c = new RealtimeMonitoringCoordinator(options); (options as any).enabled = true
    expect(c.start({ sessionId: 's', binding: 1 })).toBe(false)
    let registered = 0
    const tap = createPiRealtimeTap({ observer: { frames: [] }, coordinator: c })
    tap.extension({ on() { registered++; return () => undefined } })
    expect(registered).toBe(0); expect(c.getStatus().started).toBe(0); expect(c.traces).toHaveLength(0); tap.dispose()
  })
  test.each([0, -1, NaN, Infinity, 2147483648])('invalid timeout %s rejects', timeout => {
    expect(() => setup({ limits: { jobTimeoutMs: timeout } })).toThrow()
  })
  test('context cannot be configured to start preparation; unknown/duplicate event or missing port rejects', () => {
    for (const watchEvents of [['context'], ['context_with_system'], ['invented'], ['tool_result', 'tool_result']]) expect(() => setup({ watchEvents })).toThrow()
    expect(() => setup({ sourceVersion: undefined as any })).toThrow()
  })
  test('dispatch starts before settlement and survives context/with-system and changing diagnostic hashes', async () => {
    const began = deferred<RealtimeLease>(), finish = deferred<RealtimePrepared | undefined>()
    const f = setup({ prepare: (_input, lease) => { began.resolve(lease); return finish.promise } })
    f.emit('tool_result'); const lease = await began.promise
    f.emit('context'); f.emit('context_with_system'); f.emit('context'); f.emit('context_with_system')
    expect(f.coordinator.getStatus().step).toBe(2); expect(lease.signal.aborted).toBe(false); expect(lease.isCurrent()).toBe(true)
    finish.resolve(prepared()); await f.coordinator.idle()
    const [offer] = f.coordinator.takeReady('module')
    expect(offer.candidate.startedStep).toBe(0); expect(offer.candidate.readyStep).toBe(2); expect(offer.isCurrent()).toBe(true)
    const { contentHash, ...body } = offer.candidate
    expect(contentHash).toBe(createHash('sha256').update(JSON.stringify(body)).digest('hex')); expect(Object.isFrozen(offer.candidate.payload)).toBe(true)
    expect(reasons(f.coordinator)).not.toContain('scope_changed'); f.coordinator.dispose(); expect(offer.isCurrent()).toBe(false)
  })
  test('input cancels old intent even when its content is unavailable', async () => {
    const began = deferred<RealtimeLease>(), finish = deferred<RealtimePrepared | undefined>()
    const f = setup({ prepare: (_input, lease) => { began.resolve(lease); return finish.promise } })
    f.emit('tool_result'); const lease = await began.promise
    f.emit('input', { text: 'synthetic new direction' }, { available: false })
    expect(f.coordinator.getStatus().epoch).toBe(1); expect(lease.signal.aborted).toBe(true)
    finish.resolve(prepared()); await f.coordinator.idle(); expect(f.coordinator.takeReady('module')).toHaveLength(0)
    expect(reasons(f.coordinator)).toContain('intent_changed'); f.coordinator.dispose()
  })
  test('cancel before preparation microtask prevents host work from starting', async () => {
    let calls = 0
    const f = setup({ prepare: () => { calls++; return prepared() } })
    f.emit('tool_result'); f.coordinator.stop(); await f.coordinator.idle()
    expect(calls).toBe(0); f.coordinator.dispose()
  })
  test.each(['session_before_tree', 'session_compact', 'model_select', 'thinking_level_select'])('%s invalidates watch generation without rewriting observer contracts', async sourceEvent => {
    const began = deferred<RealtimeLease>(), finish = deferred<RealtimePrepared | undefined>()
    const f = setup({ prepare: (_input, lease) => { began.resolve(lease); return finish.promise } })
    f.emit('tool_result'); const lease = await began.promise; f.emit(sourceEvent)
    expect(lease.isCurrent()).toBe(false); expect(lease.signal.aborted).toBe(true)
    finish.resolve(prepared()); await f.coordinator.idle(); expect(f.coordinator.getStatus().ready).toBe(0); f.coordinator.dispose()
  })
  test.each(['session_shutdown', 'session_before_switch', 'session_before_fork'])('%s stops the scope and cannot reset budgets by restarting', async sourceEvent => {
    const f = setup(); f.emit('tool_result'); await f.coordinator.idle(); f.emit(sourceEvent)
    expect(f.coordinator.getStatus().state).toBe('stopped'); expect(f.coordinator.getStatus().ready).toBe(0)
    expect(() => f.coordinator.start({ sessionId: 's', binding: 2 })).toThrow(); f.coordinator.dispose()
  })
  test('same-epoch source edit discards active or ready preparation', async () => {
    const began = deferred<void>(), finish = deferred<RealtimePrepared | undefined>()
    const f = setup({ prepare: () => { began.resolve(); return finish.promise } }); f.emit('tool_result'); await began.promise
    f.versions.set('fixture-evidence', 'v2'); finish.resolve(prepared()); await f.coordinator.idle()
    expect(f.coordinator.getStatus().epoch).toBe(0); expect(f.coordinator.getStatus().ready).toBe(0); expect(reasons(f.coordinator)).toContain('source_changed'); f.coordinator.dispose()
    const g = setup(); g.emit('tool_result'); await g.coordinator.idle(); g.versions.delete('fixture-evidence')
    expect(g.coordinator.takeReady('module')).toHaveLength(0); expect(reasons(g.coordinator)).toContain('source_changed'); g.coordinator.dispose()
  })
  test('permission revocation is checked again at handoff and after offer', async () => {
    const f = setup(); f.emit('tool_result'); await f.coordinator.idle(); f.host.permitted = false
    expect(f.coordinator.takeReady('module')).toHaveLength(0); expect(reasons(f.coordinator)).toContain('permission_changed'); f.coordinator.dispose()
    const g = setup(); g.emit('tool_result'); await g.coordinator.idle(); const [offer] = g.coordinator.takeReady('module'); g.host.permitted = false
    expect(offer.isCurrent()).toBe(false); g.coordinator.dispose()
  })
  test('missing dependencies, source-check exceptions and denied preparation fail closed', async () => {
    let calls = 0
    for (const overrides of [{ dependencies: () => [] }, { sourceVersion: () => { throw new Error('SECRET_MUST_NOT_LEAK') } }, { isPermitted: () => false }]) {
      const f = setup({ ...overrides, prepare: () => { calls++; return prepared() } }); f.emit('tool_result'); await f.coordinator.idle()
      expect(f.coordinator.getStatus().ready).toBe(0); expect(JSON.stringify(f.coordinator.traces)).not.toContain('SECRET_MUST_NOT_LEAK'); f.coordinator.dispose()
    }
    expect(calls).toBe(0)
  })
  test('additional output dependencies cannot erase initial dependencies or invent fresh versions', async () => {
    const f = setup({ prepare: () => ({ ...prepared(), dependencies: [{ id: 'new-source', version: 'v2' }] }) })
    f.emit('tool_result'); await f.coordinator.idle(); expect(f.coordinator.getStatus().ready).toBe(0); expect(reasons(f.coordinator)).toContain('source_changed'); f.coordinator.dispose()
  })
  test('normal agent settlement allows module preparation to finish; context candidates remain pending', async () => {
    const began = deferred<void>(), finish = deferred<RealtimePrepared | undefined>()
    const f = setup({ prepare: () => { began.resolve(); return finish.promise } }); f.emit('tool_result'); await began.promise; f.emit('agent_settled', { aborted: false })
    finish.resolve(prepared()); await f.coordinator.idle(); expect(f.coordinator.takeReady('module')).toHaveLength(1); f.coordinator.dispose()
    const g = setup({ prepare: () => prepared('context') }); g.emit('tool_result'); await g.coordinator.idle(); expect(g.coordinator.takeReady('context')).toHaveLength(0)
    g.emit('agent_settled'); expect(g.coordinator.getStatus().ready).toBe(1); expect(reasons(g.coordinator)).toContain('no_next_context')
    g.emit('context'); const offers = g.coordinator.takeReady('context'); expect(offers).toHaveLength(1)
    g.emit('context_with_system'); expect(g.coordinator.getStatus().step).toBe(1); expect(g.coordinator.takeReady('context')).toHaveLength(0)
    expect(reasons(g.coordinator)).not.toContain('executed'); g.coordinator.dispose()
  })
  test('unavailable context cannot consume a candidate and does not cancel valid preparation', async () => {
    const f = setup({ prepare: () => prepared('context') }); f.emit('tool_result'); await f.coordinator.idle(); f.emit('context', {}, { available: false }); f.emit('context_with_system')
    expect(f.coordinator.takeReady('context')).toHaveLength(0); expect(f.coordinator.getStatus().ready).toBe(1)
    f.emit('context'); expect(f.coordinator.takeReady('context')).toHaveLength(1); f.coordinator.dispose()
  })
  test('explicit abort clears candidates and source gaps/conflicting identities stop admission', async () => {
    const f = setup(); f.emit('tool_result'); await f.coordinator.idle(); f.emit('agent_settled', { aborted: true })
    expect(f.coordinator.getStatus().state).toBe('stopped'); expect(f.coordinator.takeReady('module')).toHaveLength(0); expect(reasons(f.coordinator)).toContain('aborted')
    const g = setup(); const first = g.emit('tool_result'); await g.coordinator.idle(); g.coordinator.accept(first); expect(g.coordinator.getStatus().started).toBe(1)
    g.coordinator.accept({ ...first, payload: { changed: true } }); expect(reasons(g.coordinator)).toContain('identity_conflict')
    const h = setup(); h.coordinator.accept(h.frame('tool_result', {}, { cursor: 2 })); expect(reasons(h.coordinator)).toContain('source_gap')
    for (const c of [f.coordinator, g.coordinator, h.coordinator]) c.dispose()
  })
  test('foreign session/binding and malformed/accessor frames fail closed without invoking getters', () => {
    for (const patch of [{ sessionId: 'foreign' }, { binding: 2 }]) { const f = setup(); f.coordinator.accept(f.frame('tool_result', {}, patch)); expect(f.coordinator.getStatus().state).toBe('stopped'); f.coordinator.dispose() }
    const f = setup(); const frame = f.frame('tool_result'); let reads = 0
    Object.defineProperty(frame, 'payload', { get() { reads++; return {} }, enumerable: true })
    f.coordinator.accept(frame); expect(reads).toBe(0); expect(reasons(f.coordinator)).toContain('malformed'); f.coordinator.dispose()
  })
  test('timeout retains physical slot until raw work settles; queued work does not overlap it', async () => {
    const began = deferred<void>(), timedOut = deferred<void>(), finish = deferred<RealtimePrepared | undefined>(); let calls = 0
    const f = setup({ limits: { maxActive: 1, jobTimeoutMs: 10 }, prepare: (_input, lease) => { calls++; if (calls === 1) { began.resolve(); lease.signal.addEventListener('abort', () => timedOut.resolve(), { once: true }); return finish.promise } return prepared() } })
    f.emit('tool_result'); await began.promise; f.emit('tool_result'); await timedOut.promise
    expect(calls).toBe(1); expect(f.coordinator.getStatus().active).toBe(1); expect(f.coordinator.getStatus().queued).toBe(1)
    finish.resolve(prepared()); await f.coordinator.idle(); expect(calls).toBe(2); expect(f.coordinator.getStatus().peakActive).toBe(1)
    expect(f.coordinator.takeReady('module')).toHaveLength(1); expect(reasons(f.coordinator)).toContain('timeout'); f.coordinator.dispose()
  })
  test('bounded queue coalesces queued stream updates by source metadata and records overflow', async () => {
    const began = deferred<void>(), finish = deferred<RealtimePrepared | undefined>(); const received: any[] = []
    const f = setup({ watchEvents: ['tool_result', 'tool_execution_update'], limits: { maxActive: 1, maxQueued: 1 }, prepare: input => { received.push(input.frame.payload); if (received.length === 1) { began.resolve(); return finish.promise } return prepared() } })
    f.emit('tool_result'); await began.promise; f.emit('tool_execution_update', { toolCallId: 'synthetic-call', value: 1 }); f.emit('tool_execution_update', { toolCallId: 'synthetic-call', value: 2 }); f.emit('tool_result')
    expect(f.coordinator.getStatus().queued).toBe(1); expect(reasons(f.coordinator)).toContain('coalesced'); expect(reasons(f.coordinator)).toContain('overflow')
    finish.resolve(prepared()); await f.coordinator.idle(); expect(received).toHaveLength(2); expect(received[1].value).toBe(2); f.coordinator.dispose()
  })
  test('lifetime job/event budgets, mailbox size and trace retention stay bounded', async () => {
    const f = setup({ limits: { maxJobs: 1, maxTrace: 3 } }); const first = f.emit('tool_result'); await f.coordinator.idle(); f.emit('tool_result'); await f.coordinator.idle()
    expect(f.coordinator.getStatus().started).toBe(1); expect(reasons(f.coordinator)).toContain('job_budget')
    for (let i = 0; i < 6; i++) f.coordinator.accept(first)
    expect(f.coordinator.traces).toHaveLength(3); expect(f.coordinator.getStatus().traceEvicted).toBeGreaterThan(0); f.coordinator.dispose()
    const g = setup({ limits: { maxEvents: 1 } }); g.emit('tool_result'); await g.coordinator.idle(); g.emit('context'); expect(reasons(g.coordinator)).toContain('event_budget'); g.coordinator.dispose()
    const h = setup({ limits: { maxReady: 1 } }); h.emit('tool_result'); await h.coordinator.idle(); h.emit('tool_result'); await h.coordinator.idle()
    expect(h.coordinator.getStatus().ready).toBe(1); expect(reasons(h.coordinator)).toContain('mailbox_overflow'); h.coordinator.dispose()
    const b = setup({ limits: { maxReadyBytes: 1 } }); b.emit('tool_result'); await b.coordinator.idle(); expect(reasons(b.coordinator)).toContain('mailbox_overflow'); b.coordinator.dispose()
  })
  test('unavailable/oversize signals, malformed outputs and preparation failures never become usable data', async () => {
    const f = setup(); f.emit('tool_result', {}, { available: false }); expect(f.coordinator.getStatus().started).toBe(0); f.coordinator.dispose()
    const g = setup({ limits: { maxFrameBytes: 1 } }); g.emit('tool_result'); expect(g.coordinator.getStatus().started).toBe(0); g.coordinator.dispose()
    for (const prepare of [() => ({ channel: 'invented', payload: {} } as any), () => ({ channel: 'module' } as any), () => { throw new Error('SECRET_ERROR') }]) {
      const h = setup({ prepare }); h.emit('tool_result'); await h.coordinator.idle(); expect(h.coordinator.getStatus().ready).toBe(0); expect(JSON.stringify(h.coordinator.traces)).not.toContain('SECRET_ERROR'); h.coordinator.dispose()
    }
  })
  test('tap validates registration order, fresh frame per hook and owns all unsubscribe attempts', () => {
    const f = setup(), handlers = new Map<string, any>(); let detached = 0
    const tap = createPiRealtimeTap({ enabled: true, observer: { frames: [] }, coordinator: f.coordinator })
    tap.extension({ on(name, handler) { handlers.set(name, handler); return () => { detached++ } } })
    expect(handlers.size).toBe(observationEvents.length); expect(() => tap.extension({ on() {} })).toThrow()
    handlers.get('tool_result')({}, { sessionManager: { getSessionId: () => 'mechanical-session' } })
    expect(reasons(f.coordinator)).toContain('missing_source_frame'); tap.dispose(); tap.dispose(); expect(detached).toBe(observationEvents.length)
    const g = setup(); let attempts = 0
    const broken = createPiRealtimeTap({ enabled: true, observer: { frames: [] }, coordinator: g.coordinator })
    broken.extension({ on() { return () => { attempts++; if (attempts === 1) throw new Error('synthetic') } } })
    expect(() => broken.dispose()).toThrow(); expect(attempts).toBe(observationEvents.length); expect(g.coordinator.getStatus().state).toBe('disposed')
  })
})

if (process.env.PI_MONITORING_REQUIRE_SDK === '1' && !sdkEntry) throw new Error('A-stage qualification requires an explicit actual SDK entry; skipped SDK cases are not a pass')
const actual = sdkEntry ? describe : describe.skip
const sdkProofs: any[] = []
actual('A realtime ACTUAL SDK / native faux provider (no live/model qualification)', () => {
  let originalFetch: typeof globalThis.fetch, fetchAttempts = 0
  beforeAll(() => { originalFetch = globalThis.fetch; globalThis.fetch = Object.assign(async () => { fetchAttempts++; throw new Error('network forbidden in A SDK qualification') }, originalFetch) as typeof fetch })
  afterAll(() => {
    globalThis.fetch = originalFetch; expect(fetchAttempts).toBe(0)
    if (process.env.PI_MONITORING_REQUIRE_SDK === '1') expect(sdkProofs).toHaveLength(4)
    if (process.env.PI_MONITORING_REALTIME_REPORT) writeFileSync(process.env.PI_MONITORING_REALTIME_REPORT, JSON.stringify({ schemaVersion: 'monitoring-realtime-A/v1', sdkEntry, externalFetchAttempts: fetchAttempts, actualUserData: false, liveActivation: false, realModelCalls: 0, mainAgentInjected: false, proofs: sdkProofs }, null, 2) + '\n')
  })
  const make = (prepare: RealtimeOptions['prepare'], watchEvents: string[], extraFactories: any[] = []) => {
    const observer = new PiMonitoringObserver(() => undefined)
    const coordinator = new RealtimeMonitoringCoordinator({ enabled: true, watchEvents, isPermitted: () => true, dependencies: () => [{ id: 'synthetic-dependency', version: 'v1' }], sourceVersion: id => id === 'synthetic-dependency' ? 'v1' : undefined, prepare, limits: { jobTimeoutMs: 10000 } })
    const tap = createPiRealtimeTap({ enabled: true, observer, coordinator })
    return { observer, coordinator, tap, fixture: () => createSdkFixture({ observer, extraFactories: [tap.extension, ...extraFactories] }) }
  }
  test('streaming tool progress dispatches before settled and late module preparation survives normal completion', async () => {
    const began = deferred<RealtimeLease>(), finish = deferred<RealtimePrepared | undefined>()
    const x = make((input, lease) => { expect(input.frame.sourceEvent).toBe('tool_execution_update'); began.resolve(lease); return finish.promise }, ['tool_execution_update'])
    const f = await x.fixture()
    try {
      f.setSteps([f.ai.fauxAssistantMessage([f.ai.fauxToolCall('synthetic', { value: 7 })], { stopReason: 'toolUse' }), f.ai.fauxAssistantMessage('synthetic final')])
      const run = f.session.prompt('synthetic tool progress'); const lease = await began.promise
      expect(f.raw.some(r => r.event.type === 'agent_settled')).toBe(false)
      await run; expect(lease.isCurrent()).toBe(true); expect(lease.signal.aborted).toBe(false); expect(x.coordinator.getStatus().active).toBe(1)
      finish.resolve(prepared('module', { source: 'synthetic-progress-event' })); await x.coordinator.idle(); f.assertReconciled()
      const [offer] = x.coordinator.takeReady('module'); expect(offer.candidate.payload).toEqual({ source: 'synthetic-progress-event' }); expect(offer.isCurrent()).toBe(true)
      sdkProofs.push({ kind: 'stream-before-settled/late-module', sdkVersion: f.sdkVersion, events: f.raw.length, sourceEvents: f.observer.frames.map(r => r.sourceEvent), step: x.coordinator.getStatus().step, preparedSource: offer.candidate.sourceEvent })
    } finally { finish.resolve(undefined); await f.dispose(); x.tap.dispose(); await x.coordinator.idle() }
  })
  test('tool-result preparation survives the next real SDK context and whole-projection changes', async () => {
    const began = deferred<RealtimeLease>(), finish = deferred<RealtimePrepared | undefined>()
    const x = make((_input, lease) => { began.resolve(lease); return finish.promise }, ['tool_result']); const f = await x.fixture()
    try {
      f.setSteps([f.ai.fauxAssistantMessage([f.ai.fauxToolCall('synthetic', { value: 11 })], { stopReason: 'toolUse' }), f.ai.fauxAssistantMessage('after tool')])
      const run = f.session.prompt('synthetic result'); const lease = await began.promise; await run
      const contexts = f.raw.filter(r => r.event.type === 'context').length
      expect(contexts).toBe(2); expect(x.coordinator.getStatus().step).toBe(contexts); expect(lease.isCurrent()).toBe(true)
      finish.resolve(prepared()); await x.coordinator.idle(); expect(x.coordinator.takeReady('module')).toHaveLength(1); f.assertReconciled()
      sdkProofs.push({ kind: 'cross-context-step', sdkVersion: f.sdkVersion, contexts, pairedWithSystem: f.raw.filter(r => r.event.type === 'context_with_system').length, startedBeforeSettlement: true })
    } finally { finish.resolve(undefined); await f.dispose(); x.tap.dispose(); await x.coordinator.idle() }
  })
  test('prepared context handoff occurs at the next context without automatic injection or duplicate offers', async () => {
    const toolGate = deferred<void>(), began = deferred<void>(); const offers: RealtimeOffer[] = []; const reads: any[] = []
    let coordinator!: RealtimeMonitoringCoordinator
    const consume = (pi: any) => { for (const name of ['context', 'context_with_system']) pi.on(name, () => { const batch = coordinator.takeReady('context'); reads.push({ name, step: coordinator.getStatus().step, count: batch.length }); offers.push(...batch); return undefined }) }
    const x = make(() => { began.resolve(); return prepared('context') }, ['tool_execution_start'], [consume]); coordinator = x.coordinator
    const f = await createSdkFixture({ observer: x.observer, toolDelay: toolGate.promise, extraFactories: [x.tap.extension, consume] })
    try {
      f.setSteps([f.ai.fauxAssistantMessage([f.ai.fauxToolCall('synthetic', { value: 3 })], { stopReason: 'toolUse' }), f.ai.fauxAssistantMessage('after handoff')])
      const run = f.session.prompt('synthetic handoff'); await began.promise; await x.coordinator.idle(); expect(x.coordinator.getStatus().ready).toBe(1)
      toolGate.resolve(); await run; expect(offers).toHaveLength(1); expect(reads.find(r => r.count === 1)).toEqual({ name: 'context', step: 2, count: 1 })
      expect(offers[0].candidate.payload).toEqual({ marker: 'PREPARED_SYNTHETIC_ONLY' }); expect(JSON.stringify(f.requests)).not.toContain('PREPARED_SYNTHETIC_ONLY'); f.assertReconciled()
      sdkProofs.push({ kind: 'ready-context-handoff/no-injection', sdkVersion: f.sdkVersion, reads, offers: offers.length, providerRequests: f.requests.length })
    } finally { toolGate.resolve(); await f.dispose(); x.tap.dispose(); await x.coordinator.idle() }
  })
  test('actual streaming user steer advances intent and invalidates old work without waiting for it', async () => {
    const modelBegan = deferred<void>(), modelGate = deferred<void>(), workerBegan = deferred<RealtimeLease>(), workerGate = deferred<RealtimePrepared | undefined>(); let jobs = 0
    const x = make((_input, lease) => { jobs++; if (jobs === 1) { workerBegan.resolve(lease); return workerGate.promise } return undefined }, ['input']); const f = await x.fixture()
    try {
      f.setSteps([async () => { modelBegan.resolve(); await modelGate.promise; return f.ai.fauxAssistantMessage('old response') }, f.ai.fauxAssistantMessage('new response')])
      const run = f.session.prompt('synthetic original intent'); const lease = await workerBegan.promise; await modelBegan.promise
      await f.session.steer('synthetic new intent'); expect(lease.signal.aborted).toBe(true); expect(x.coordinator.getStatus().epoch).toBe(2)
      modelGate.resolve(); await run; workerGate.resolve(prepared()); await x.coordinator.idle(); expect(x.coordinator.takeReady('module')).toHaveLength(0); f.assertReconciled()
      expect(reasons(x.coordinator)).toContain('intent_changed'); sdkProofs.push({ kind: 'native-input-steer', sdkVersion: f.sdkVersion, inputs: f.raw.filter(r => r.event.type === 'input').length, epoch: x.coordinator.getStatus().epoch, staleReady: x.coordinator.getStatus().ready })
    } finally { modelGate.resolve(); workerGate.resolve(undefined); await f.dispose(); x.tap.dispose(); await x.coordinator.idle() }
  })
})
