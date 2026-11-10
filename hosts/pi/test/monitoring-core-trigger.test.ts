import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { SyntheticTriggerRegistry, type TestTriggerHandler, type TriggerInvocation, type TriggerResult } from '@lazy-harness/monitoring-core/engine/monitoring-core-trigger.ts'
import { MonitoringObservationBridge, materialContentHash, type MaterialEnvelope, type ObservationLease } from '@lazy-harness/monitoring-core/engine/monitoring-core-observation.ts'
import { createAuditObserver, createContextReferences, createKnowledgeCandidate } from './support/pending-fixtures.ts'
import { PiMonitoringObserver } from '../src/index.ts'
import { clone, sdkFixture as createSdkFixture } from './support/pending-fixtures.ts'
import { deferred } from './support/real-sdk.ts'
const sdkEntry = import.meta.resolve('@earendil-works/pi-coding-agent')

const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const tick = () => new Promise<void>(r => setTimeout(r, 0))
function material(index = 1): MaterialEnvelope {
  const body = { kind: 'knowledge.candidate', payload: { quote: `synthetic-${index}` }, evidenceRefs: [`event:observation-${index}`], requestId: `mechanical-request-${index}`, processorId: 'knowledge.candidate', eventId: `observation-${index}`, scopeId: 'mechanical-scope', contextVersion: 'mechanical-v1', destination: 'synthetic:knowledge.candidate', source: { observationId: `observation-${index}`, sessionId: 'mechanical-session', binding: 1, cursor: index, settlementId: 'mechanical-settled', snapshotRevision: 'mechanical-revision' } }
  return { ...body, contentHash: materialContentHash(body) }
}
const rehash = (m: MaterialEnvelope) => { const { contentHash: _old, ...body } = m; return { ...body, contentHash: materialContentHash(body) } }
const openLease = () => { const controller = new AbortController(); return { controller, lease: { signal: controller.signal, isCurrent: () => !controller.signal.aborted } } }
const result = (m: MaterialEnvelope, i: TriggerInvocation): TriggerResult => ({ status: 'executed', requestId: m.requestId, contentHash: m.contentHash, executionId: i.executionId, effectId: `effect:${hash(i.executionId)}` })
function register(registry: SyntheticTriggerRegistry, run: TestTriggerHandler['run'] = result) {
  const spec: TestTriggerHandler = { id: 'candidate.test', kind: 'knowledge.candidate', destination: 'synthetic:knowledge.candidate', processorIds: ['knowledge.candidate'], run }
  return { spec, remove: registry.registerHandler(spec, { kinds: [spec.kind], destinations: [spec.destination], processorIds: spec.processorIds }) }
}

describe('P4 mechanical execution target guards (not actual-SDK proof)', () => {
  test('default stopped; no action until explicit start', async () => {
    let calls = 0
    const r = new SyntheticTriggerRegistry(); register(r, (m, i) => { calls++; return result(m, i) })
    expect((await r.receive(material(), openLease().lease)).status).toBe('rejected'); expect(calls).toBe(0)
    r.start(); expect((await r.receive(material(), openLease().lease)).status).toBe('received'); expect(calls).toBe(1); r.dispose()
  })
  test('registration cannot widen kind/destination/processor grants or duplicate route', () => {
    const r = new SyntheticTriggerRegistry(), { spec } = register(r)
    for (const grant of [{ kinds: [], destinations: [spec.destination], processorIds: spec.processorIds }, { kinds: [spec.kind], destinations: [], processorIds: spec.processorIds }, { kinds: [spec.kind], destinations: [spec.destination], processorIds: [] }]) expect(() => r.registerHandler({ ...spec, id: 'wider.test' }, grant)).toThrow('exceeds host grants')
    expect(() => register(r)).toThrow('duplicate route'); r.dispose()
  })
  test('tampered body, wrong processor and false source link cannot execute', async () => {
    let calls = 0
    const r = new SyntheticTriggerRegistry(); register(r, (m, i) => { calls++; return result(m, i) }); r.start()
    const original = material()
    for (const m of [{ ...original, payload: { quote: 'tampered' } }, rehash({ ...original, processorId: 'unauthorized.module' }), rehash({ ...original, source: { ...original.source, observationId: 'wrong-source' } })]) expect((await r.receive(m, openLease().lease)).status).toBe('rejected')
    expect(calls).toBe(0); r.dispose()
  })
  for (const bad of ['executionId', 'requestId', 'contentHash', 'effectId', 'unknown', 'rejected', 'missing'] as const) test(`execution ${bad} is not manufactured into successful action`, async () => {
    const r = new SyntheticTriggerRegistry(); register(r, (m, i) => { const ack: any = { ...result(m, i) }; if (bad === 'missing') return undefined as any; if (bad === 'effectId') delete ack.effectId; else if (bad === 'unknown' || bad === 'rejected') ack.status = bad; else ack[bad] = 'wrong'; return ack }); r.start()
    expect((await r.receive(material(), openLease().lease)).status).toBe('rejected'); expect(r.records.some(x => x.status === 'executed')).toBe(false); r.dispose()
  })
  test('concurrent duplicate and reentrant replay invoke trusted handler only once', async () => {
    const r = new SyntheticTriggerRegistry(), entered = deferred(), release = deferred(), lease = openLease().lease; let calls = 0, replay: Promise<any> | undefined
    register(r, async (m, i) => { calls++; replay = Promise.resolve(r.receive(m, lease)); entered.resolve(); await release.promise; return result(m, i) }); r.start()
    const first = r.receive(material(), lease); await entered.promise; const duplicate = r.receive(material(), lease)
    expect((await r.receive(rehash({ ...material(), payload: { changed: true } }), lease)).reason).toContain('identity conflict')
    release.resolve(); expect((await first).status).toBe('received'); expect((await duplicate).status).toBe('received'); expect((await replay!).status).toBe('received'); expect(calls).toBe(1); expect(r.getStatus().used).toBe(1); r.dispose()
  })
  test('unregister invalidates in-flight work and old disposer cannot remove replacement', async () => {
    const r = new SyntheticTriggerRegistry(), entered = deferred(), release = deferred(); let invocation!: TriggerInvocation
    const old = register(r, async (m, i) => { invocation = i; entered.resolve(); await release.promise; return result(m, i) }); r.start()
    const pending = r.receive(material(), openLease().lease); await entered.promise; old.remove(); register(r); old.remove()
    expect(r.getStatus().handlers).toEqual(['candidate.test']); expect(invocation.isCurrent()).toBe(false); expect(invocation.signal.aborted).toBe(true); expect(r.getStatus().active).toBe(1)
    release.resolve(); expect((await pending).status).toBe('rejected'); expect(r.records.some(x => x.status === 'executed')).toBe(false)
    expect((await r.receive(material(), openLease().lease)).reason).toContain('binding/epoch changed'); r.dispose()
  })
  test('stop/start does not reset idempotency or lifetime budgets', async () => {
    const r = new SyntheticTriggerRegistry({ maxExecutions: 1 }); register(r); r.start(); await r.receive(material(), openLease().lease); r.stop(); r.start()
    expect((await r.receive(material(), openLease().lease)).status).toBe('rejected'); expect((await r.receive(material(2), openLease().lease)).reason).toContain('lifetime execution budget'); expect(r.getStatus().used).toBe(1); r.dispose()
  })
  test('active/input/handler limits reject without an unbounded target queue', async () => {
    const r = new SyntheticTriggerRegistry({ maxActive: 1, maxHandlers: 1 }), entered = deferred(), release = deferred()
    register(r, async (m, i) => { entered.resolve(); await release.promise; return result(m, i) }); r.start()
    const first = r.receive(material(), openLease().lease); await entered.promise
    expect((await r.receive(material(2), openLease().lease)).reason).toContain('active limit'); expect(r.getStatus().active).toBe(1)
    release.resolve(); await first; r.dispose()
    const tiny = new SyntheticTriggerRegistry({ maxMaterialBytes: 1 }); register(tiny); tiny.start(); expect((await tiny.receive(material(), openLease().lease)).reason).toContain('byte limit'); expect(tiny.getStatus().used).toBe(0); tiny.dispose()
    expect(() => new SyntheticTriggerRegistry({ maxActive: 0 })).toThrow('invalid trigger limits')
  })
  test('handler exception is visible and bounded execution records expose evictions', async () => {
    const failing = new SyntheticTriggerRegistry(); register(failing, () => { throw new Error('synthetic-handler-error') }); failing.start()
    expect((await failing.receive(material(), openLease().lease)).status).toBe('rejected'); expect(failing.records[0].status).toBe('failed'); failing.dispose()
    const r = new SyntheticTriggerRegistry({ maxRetained: 2 }); register(r); r.start(); for (let i = 1; i <= 3; i++) await r.receive(material(i), openLease().lease)
    expect(r.records).toHaveLength(2); expect(r.getStatus().evicted).toBe(1); expect(Object.isFrozen(r.records[0])).toBe(true); r.dispose()
    expect((await r.receive(material(4), openLease().lease)).reason).toBe('trigger disposed')
  })
})

const actual = describe
const proofs: any[] = []
let fetchAttempts = 0
actual('P4 ACTUAL SDK source→selection→target→controlled effect→execution receipt', () => {
  let oldFetch: typeof fetch
  beforeAll(() => { oldFetch = globalThis.fetch; globalThis.fetch = Object.assign(async () => { fetchAttempts++; throw new Error('external fetch forbidden in synthetic P4') }, oldFetch) as typeof fetch })
  afterAll(() => { globalThis.fetch = oldFetch; expect(fetchAttempts).toBe(0); if (process.env.PI_MONITORING_P4_REPORT) writeFileSync(process.env.PI_MONITORING_P4_REPORT, JSON.stringify({ schema: 'monitoring-p4-synthetic/v1', sdkEntry, fetchAttempts, liveHostActivated: false, realTranscriptCollected: false, businessStateWritten: false, semanticClassifierQualified: false, proofs }, null, 2) + '\n') })
  type Effect = { effectId: string; executionId: string; material: MaterialEnvelope; value: any }
  async function fixture(options: { mode?: 'run' | 'skip' | 'defer'; third?: boolean; persistentLifecycle?: boolean; beforeEffect?: (m: MaterialEnvelope, i: TriggerInvocation) => Promise<void>; failingProcessor?: string; badResultProcessor?: string; coreTimeoutMs?: number } = {}) {
    const effects = new Map<string, Effect>(), handoffs: MaterialEnvelope[] = [], registry = new SyntheticTriggerRegistry()
    const processors = [createKnowledgeCandidate(), createContextReferences(), ...(options.third ? [createAuditObserver()] : [])]
    // Each explicit test handler owns a different in-memory result shape. No feature branches in registry/core/bridge.
    const producers: Record<string, (m: MaterialEnvelope) => any> = { 'knowledge.candidate': m => ({ candidateQuote: (m.payload as any).quote }), 'context.references': m => ({ selectedReferences: (m.payload as any).references }), 'audit.observation': m => ({ observedEventId: (m.payload as any).eventId }) }
    for (const p of processors) {
      const handler: TestTriggerHandler = { id: `test.${p.id}`, kind: p.allowedActions[0], destination: `synthetic:${p.id}`, processorIds: [p.id], async run(m, i) {
        expect(Object.isFrozen(m)).toBe(true)
        await options.beforeEffect?.(m, i)
        if (!i.isCurrent() || i.signal.aborted) return { ...result(m, i), status: 'rejected', reason: 'cancelled before effect' }
        if (options.failingProcessor === p.id) throw new Error('controlled-handler-failure')
        const ack = result(m, i), value = producers[p.id](m)
        // No await between final guard and synchronous TEST commit. No DB, injection, files or shell effects.
        effects.set(ack.effectId!, { effectId: ack.effectId!, executionId: i.executionId, material: clone(m), value: clone(value) })
        return options.badResultProcessor === p.id ? { ...ack, contentHash: 'wrong-action-hash' } : ack
      } }
      registry.registerHandler(handler, { kinds: p.allowedActions, destinations: [handler.destination], processorIds: [p.id] })
    }
    registry.start()
    const ref = { id: 'controlled-reference', kind: 'knowledge', version: 'controlled-v3', content: 'P4_EXACT_SELECTED_BODY' }
    const bridge = new MonitoringObservationBridge({ enabled: true, goal: 'P4 controlled in-memory effect proof', references: [ref, { id: 'excluded-reference', kind: 'restricted', version: 'secret-v1', content: 'P4_EXCLUDED_BODY' }], processors: processors.map(spec => ({ spec, grants: { referenceKinds: spec.referenceKinds, actions: spec.allowedActions }, destination: `synthetic:${spec.id}` })), receiver: (m, lease) => { handoffs.push(clone(m)); return registry.receive(m, lease) }, judgeBatch: async tasks => Object.fromEntries(tasks.map(t => [t.processorId, { mode: options.mode ?? 'run', reason: 'Scripted P4 transport/effect test only', evidenceRefs: [t.view.eventRef, ...t.view.context.references.map(r => r.id)] }])), coreLimits: { maxConcurrent: 2, timeoutMs: options.coreTimeoutMs ?? 3000 } })
    const observer: PiMonitoringObserver = new PiMonitoringObserver((frame, lease) => bridge.consume(frame, observer.frames, lease), { workerTimeoutMs: 5000 })
    const f = await createSdkFixture({ observer })
    return { f, bridge, registry, handoffs, effects, ref, async dispose() { await f.dispose(); bridge.dispose(); registry.dispose() } }
  }
  function reconcile(x: Awaited<ReturnType<typeof fixture>>) {
    x.f.assertReconciled()
    const sourceFrames = x.f.observer.frames.filter(f => f.sourceEvent === 'message_end' && ['user.input', 'assistant.message', 'tool.result'].includes(f.kind))
    expect(x.bridge.reports.flatMap(b => b.sources.map(s => s.observationId))).toEqual(sourceFrames.map(f => f.id))
    for (const effect of x.effects.values()) {
      const m = effect.material, source = sourceFrames.find(f => f.id === m.source.observationId)!
      expect(source).toBeDefined(); expect(source.sessionId).toBe(m.source.sessionId); expect(source.cursor).toBe(m.source.cursor)
      expect(x.handoffs.some(h => h.requestId === m.requestId && h.contentHash === m.contentHash)).toBe(true)
      if (m.processorId === 'knowledge.candidate') expect(effect.value.candidateQuote).toBe((source.payload as any).message.content[0].text)
      if (m.processorId === 'context.references') expect(effect.value.selectedReferences).toEqual([{ id: x.ref.id, version: x.ref.version, content: x.ref.content }])
    }
    const executed = x.registry.records.filter(r => r.status === 'executed')
    for (const record of executed) {
      const effect = x.effects.get(record.effectId!)!
      expect(effect).toBeDefined(); expect(effect.executionId).toBe(record.executionId!); expect(effect.material.requestId).toBe(record.requestId); expect(effect.material.contentHash).toBe(record.contentHash)
    }
    const coreReceipts = x.bridge.reports.flatMap(b => b.sources.flatMap(s => s.core?.outcomes.flatMap(o => o.receipts.filter(r => r.status === 'recorded')) ?? []))
    for (const ack of coreReceipts) expect(executed.some(e => e.executionId === ack.recordId && e.requestId === ack.requestId)).toBe(true)
    expect(JSON.stringify([...x.effects.values()])).not.toContain('P4_EXCLUDED_BODY')
  }
  for (const mode of ['run', 'skip', 'defer'] as const) test(`real scripted ${mode} reconciles source, two modules and actual memory effects`, async () => {
    const x = await fixture({ mode })
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage('synthetic-P4-answer')]); await x.f.session.prompt('synthetic-P4-input'); await x.f.observer.idle(); reconcile(x)
      expect(x.effects.size).toBe(mode === 'run' ? 2 : 0); expect(x.registry.records.filter(r => r.status === 'executed')).toHaveLength(mode === 'run' ? 2 : 0)
      proofs.push({ case: `actual-two-modules-${mode}`, sdkVersion: x.f.sdkVersion, targetHandoffs: x.handoffs.length, actualEffects: x.effects.size, verifiedExecutions: x.registry.records.filter(r => r.status === 'executed').length })
    } finally { await x.dispose() }
  }, 20000)
  test('real third registered module handles canonical tool result without core feature branches', async () => {
    const x = await fixture({ third: true })
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage(x.f.ai.fauxToolCall('synthetic', { value: 9 }, { id: 'p4-native-tool' }), { stopReason: 'toolUse' }), x.f.ai.fauxAssistantMessage('tool-done')]); await x.f.session.prompt('third-module-input'); await x.f.observer.idle(); reconcile(x)
      expect(x.effects.size).toBe(4); expect(x.registry.getStatus().handlers).toHaveLength(3)
      const tool = x.f.observer.frames.find(f => f.kind === 'tool.result')!
      expect((tool.payload as any).message.toolCallId).toBe('p4-native-tool'); expect([...x.effects.values()].filter(e => e.material.source.observationId === tool.id)).toHaveLength(1)
      proofs.push({ case: 'actual-third-module-native-tool-trigger', sdkVersion: x.f.sdkVersion, handlers: 3, actualEffects: x.effects.size })
    } finally { await x.dispose() }
  }, 20000)
  test('real end-to-end replay has no duplicate effects or repeated handler executions', async () => {
    const x = await fixture()
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage('replay-answer')]); await x.f.session.prompt('replay-input'); await x.f.observer.idle()
      const settled = x.f.observer.frames.findLast(f => f.sourceEvent === 'agent_settled')!, before = x.registry.getStatus().used
      expect((await x.bridge.consume(settled, x.f.observer.frames, openLease().lease))?.status).toBe('duplicate')
      expect(x.registry.getStatus().used).toBe(before); expect(x.effects.size).toBe(2); reconcile(x)
      proofs.push({ case: 'actual-source-replay-one-effect-each', sdkVersion: x.f.sdkVersion, handlerInvocations: before, actualEffects: x.effects.size })
    } finally { await x.dispose() }
  }, 20000)
  test('real handler failure is isolated from another module effect', async () => {
    const x = await fixture({ failingProcessor: 'knowledge.candidate' })
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage('failure-answer')]); await x.f.session.prompt('failure-input'); await x.f.observer.idle(); reconcile(x)
      expect(x.effects.size).toBe(1); expect(x.registry.records.filter(r => r.status === 'executed')).toHaveLength(1); expect(x.registry.records.filter(r => r.status === 'failed')).toHaveLength(1)
      proofs.push({ case: 'actual-handler-failure-isolation', sdkVersion: x.f.sdkVersion, actualEffects: 1, failedExecutions: 1 })
    } finally { await x.dispose() }
  }, 20000)
  test('real physical effect with mismatched result is not falsely acknowledged as executed', async () => {
    const x = await fixture({ badResultProcessor: 'knowledge.candidate' })
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage('mismatch-answer')]); await x.f.session.prompt('mismatch-input'); await x.f.observer.idle(); reconcile(x)
      expect(x.effects.size).toBe(2); expect(x.registry.records.filter(r => r.status === 'executed')).toHaveLength(1); expect(x.registry.records.filter(r => r.status === 'unverified')).toHaveLength(1)
      proofs.push({ case: 'actual-effect-vs-unverified-execution-result', sdkVersion: x.f.sdkVersion, actualEffects: 2, verifiedExecutions: 1, unverified: 1 })
    } finally { await x.dispose() }
  }, 20000)
  for (const transition of ['session', 'tree', 'compact'] as const) test(`real ${transition} invalidates blocked test commits, then new scope succeeds`, async () => {
    const entered = deferred(), release = deferred(); let block = false
    const x = await fixture({ persistentLifecycle: transition === 'session', beforeEffect: async () => { if (block) { entered.resolve(); await release.promise } } })
    try {
      if (transition === 'compact') { x.f.setSteps([x.f.ai.fauxAssistantMessage('seed-answer')]); await x.f.session.prompt('seed-input'); await x.f.observer.idle() }
      const baselineEffects = new Set(x.effects.keys())
      block = true
      x.f.setSteps([x.f.ai.fauxAssistantMessage('old-scope-answer')]); await x.f.session.prompt('old-scope-input ' + 'padding '.repeat(80)); await entered.promise
      const oldCursor = x.bridge.getStatus().scannedCursor
      if (transition === 'session') await x.f.runtime.newSession()
      else if (transition === 'tree') { const user = x.f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'user'); expect(user).toBeDefined(); await x.f.session.navigateTree(user!.id, { summarize: false }) }
      else { x.f.setSteps([x.f.ai.fauxAssistantMessage('P4_COMPACTION')]); await x.f.session.compact() }
      release.resolve(); await x.f.observer.idle(); expect(x.effects.size).toBe(baselineEffects.size)
      block = false
      x.f.setSteps([x.f.ai.fauxAssistantMessage('new-scope-answer')]); await x.f.session.prompt('new-scope-input'); await x.f.observer.idle()
      const newEffects = [...x.effects.values()].filter(e => !baselineEffects.has(e.effectId))
      expect(newEffects).toHaveLength(2); expect(newEffects.every(e => e.material.source.cursor > oldCursor)).toBe(true)
      reconcile(x); expect(x.registry.records.some(r => r.status === 'cancelled')).toBe(true)
      proofs.push({ case: `actual-${transition}-stale-test-commit`, sdkVersion: x.f.sdkVersion, oldEffects: 0, newEffects: newEffects.length })
    } finally { release.resolve(); await x.dispose() }
  }, 20000)
  test('real core deadline keeps physical test-handler slots until raw settlement', async () => {
    const entered = deferred(), release = deferred()
    const x = await fixture({ coreTimeoutMs: 20, beforeEffect: async () => { entered.resolve(); await release.promise } })
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage('deadline-answer')]); await x.f.session.prompt('deadline-input'); await entered.promise; await x.f.observer.idle()
      expect(x.effects.size).toBe(0); expect(x.registry.getStatus().active).toBeGreaterThan(0); expect(x.bridge.getStatus().core.active).toBeGreaterThan(0)
      release.resolve(); await tick(); expect(x.registry.getStatus().active).toBe(0); expect(x.bridge.getStatus().core.active).toBe(0); expect(x.effects.size).toBe(0)
      proofs.push({ case: 'actual-deadline-physical-handler-slot', sdkVersion: x.f.sdkVersion, actualEffects: 0, lateVerified: x.registry.records.filter(r => r.status === 'executed').length })
    } finally { release.resolve(); await x.dispose() }
  }, 20000)
  test('real SDK abort cannot trigger aborted test work', async () => {
    const entered = deferred(), x = await fixture()
    try {
      x.f.setSteps([async (_c: any, options: any) => { entered.resolve(); await new Promise<void>(r => { if (options.signal.aborted) r(); else options.signal.addEventListener('abort', () => r(), { once: true }) }); return x.f.ai.fauxAssistantMessage('aborted-P4-answer', { stopReason: 'aborted' }) }])
      const running = x.f.session.prompt('aborted-P4-input'); await entered.promise; await x.f.session.abort(); await running; await x.f.observer.idle(); reconcile(x)
      expect(x.effects.size).toBe(0); expect(x.registry.getStatus().used).toBe(0)
      proofs.push({ case: 'actual-abort-no-handler-work', sdkVersion: x.f.sdkVersion, actualEffects: 0, handlerInvocations: 0 })
    } finally { await x.dispose() }
  }, 20000)
})
