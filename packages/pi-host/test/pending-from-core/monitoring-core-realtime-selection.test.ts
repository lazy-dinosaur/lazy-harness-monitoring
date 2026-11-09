import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { RealtimeMaterialWindow, createPiMaterialTap } from '../src/engine/monitoring-core-realtime-material.ts'
import { RealtimeSelectionBridge, createRealtimeSelectionPipeline, type RealtimeWatchModule } from '../src/engine/monitoring-core-realtime-selection.ts'
import { PiMonitoringObserver, observationEvents, type ObservationFrame, type ObservationSnapshot } from '../src/observer/monitoring-observer.ts'
import { config, profile, fixture, outputFor } from './support/model-fixture.ts'
import { createSdkFixture, deferred, sdkEntry } from '../../packages/lazy-harness-pi/tests/support/monitoring-sdk-fixture.ts'

const module = (id = 'watch.alpha', kinds = ['tool-result', 'policy'], events = ['tool_result']): RealtimeWatchModule => ({ id, watchEvents: events, referenceKinds: kinds, grants: { referenceKinds: kinds, actions: ['monitoring.selected-material'] }, question: { instructions: 'Synthetic scoped source selection, not a real semantic benchmark', criteria: { run: 'Needs current admitted material', skip: 'No requested work', defer: 'Unresolved meaning' } }, destination: `sink:${id}` })
const refs = [{ id: 'policy.allowed', kind: 'policy', version: 'p1', content: 'ALLOWED_POLICY' }, { id: 'policy.unselected', kind: 'policy', version: 'p2', content: 'UNSELECTED_POLICY' }, { id: 'private.ref', kind: 'restricted', version: 'p3', content: 'PRIVATE_REFERENCE' }]
const allKinds = ['user-text', 'assistant-text', 'assistant-progress', 'tool-result', 'tool-progress', 'tool-meta', 'tool-arguments', 'event-meta', 'policy', 'restricted']
const result = (text = 'CURRENT_RESULT', id = 'synthetic-call') => ({ toolCallId: id, toolName: 'synthetic', isError: false, content: [{ type: 'text', text }] })
function setup(options: { modules?: readonly RealtimeWatchModule[]; material?: any; selectionLimits?: any; realtimeLimits?: any; modelConfig?: any; response?: (request: any, context: any) => any } = {}) {
  const f = fixture(), permitted = new Map<string, boolean>(); const observer = new PiMonitoringObserver(() => undefined)
  ;(f.host.backends as any).native = { ...f.host.backends.native, invoke: (request: any, context: any) => { f.calls.push({ request, context }); return options.response ? options.response(request, context) : outputFor(request) } }
  const modules = options.modules ?? [module()]
  for (const m of modules) permitted.set(m.id, true)
  const pipeline = createRealtimeSelectionPipeline({ enabled: true, observer, material: { allowedKinds: allKinds, toolFields: { synthetic: ['value'] }, references: refs, ...options.material }, selection: { modules, goal: 'Controlled source/material proof', modelConfig: options.modelConfig ?? config(), modelHost: f.host, isPermitted: id => permitted.get(id) === true, limits: options.selectionLimits }, realtimeLimits: { jobTimeoutMs: 10000, ...options.realtimeLimits } })
  pipeline.window.start({ sessionId: 'mechanical-session', binding: 1 }); pipeline.coordinator.start({ sessionId: 'mechanical-session', binding: 1 })
  let cursor = 0
  const frame = (event: string, payload: any = {}, patch: Partial<ObservationFrame> = {}): ObservationFrame => {
    const n = ++cursor
    const snapshot: ObservationSnapshot = { sessionId: 'mechanical-session', leafId: `leaf-${n}`, branch: [], canonicalMessages: [{ role: 'user', content: 'PRIVATE_CANONICAL_SNAPSHOT' }], effectiveSystemPrompt: 'PRIVATE_SYSTEM_PROMPT', stage: 'canonical_projection', canonicalHash: `hash-${n}`, revision: `revision-${n}`, available: true, fullProviderContext: false, omitted: [] }
    return { id: `frame:${n}`, cursor: n, sourceEvent: event, kind: event.replaceAll('_', '.'), sessionId: 'mechanical-session', binding: 1, epoch: n, payload, snapshot, available: true, ...patch }
  }
  return { ...f, observer, pipeline, permitted, frame, feed(event: string, payload: any = {}, progress?: unknown, patch: Partial<ObservationFrame> = {}) { const value = frame(event, payload, patch); pipeline.window.capture(value, pipeline.coordinator.getStatus().step, () => progress); pipeline.coordinator.accept(value); return value } }
}
const packets = (f: ReturnType<typeof setup>) => f.pipeline.coordinator.takeReady('module').flatMap(offer => (offer.candidate.payload as any).packets)
const choose = (request: any, selected: (task: any, ref: any) => boolean, modes: Record<string, string> = {}) => {
  const response = outputFor(request) as any
  ;(request.body as any).state.tasks.forEach((task: any, i: number) => { response.value.answers[`decision_${i}`].choice = modes[task.processorId] ?? 'run'; task.view.context.references.forEach((ref: any, j: number) => { response.value.answers[`ref_${i}_${j}`].probability = selected(task, ref) ? 0.95 : 0.05 }) })
  return response
}

describe('B material and scoped selection mechanical qualification', () => {
  test('default-off composition does not install hooks or invoke models', () => {
    const f = fixture(), observer = new PiMonitoringObserver(() => undefined)
    const p = createRealtimeSelectionPipeline({ observer, material: { allowedKinds: ['tool-result'] }, selection: { modules: [module('watch.alpha', ['tool-result'])], modelConfig: config(), modelHost: f.host, goal: 'Synthetic', isPermitted: () => true } })
    let registrations = 0; p.extension({ on() { registrations++; return () => undefined } })
    expect(registrations).toBe(0); expect(f.calls).toHaveLength(0); expect(p.coordinator.getStatus().state).toBe('idle'); p.dispose()
  })
  test('same-frame material namespaces keep raw user/assistant text independent of event-meta', async () => {
    const f = setup({ modules: [module('watch.input', ['user-text', 'event-meta'], ['input'])], material: { references: [] } })
    try {
      const frame = f.feed('input', { text: 'NAMESPACE_BODY' }); await f.pipeline.idle()
      const snapshot = f.pipeline.window.snapshot(frame.id, ['user-text', 'event-meta'])
      expect(snapshot.materials.map(r => r.kind).sort()).toEqual(['event-meta', 'user-text']); expect(new Set(snapshot.currentIds).size).toBe(2)
      const out = packets(f); expect(out).toHaveLength(1); expect(out[0].materials.map((r: any) => r.kind).sort()).toEqual(['event-meta', 'user-text'])
    } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('separate native profile routes isolate technical failure and recheck selected module grants', async () => {
    const modules = [module('watch.alpha'), module('watch.beta')]
    const f = setup({ modules, modelConfig: config({ profiles: [profile(), profile('other.native', { backend: 'native', model: 'classifier-A' })], judgeProfiles: { 'watch.alpha': 'native', 'watch.beta': 'other.native' } }), response: (request, ctx) => { if (ctx.profile.id === 'native') throw new Error('synthetic technical failure'); return outputFor(request) } })
    try {
      f.feed('tool_result', result()); await f.pipeline.idle(); const [offer] = f.pipeline.coordinator.takeReady('module'), out = (offer.candidate.payload as any).packets
      expect(out.map((p: any) => p.moduleId)).toEqual(['watch.beta']); expect(out[0].profileId).toBe('other.native'); expect(f.pipeline.selection.traces.some(t => t.moduleId === 'watch.alpha' && t.status === 'deferred' && t.mode === undefined)).toBe(true)
      f.permitted.set('watch.beta', false); expect(f.permitted.get('watch.alpha')).toBe(true); expect(offer.isCurrent()).toBe(false)
    } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('two module views are isolated and only independently selected exact bodies reach the mailbox', async () => {
    const modules = [module('watch.alpha', ['tool-result', 'policy']), module('watch.beta', ['tool-result', 'assistant-text'])]
    const f = setup({ modules, response: request => choose(request, (task, ref) => ref.kind === 'tool-result' || task.processorId === 'watch.alpha' && ref.id === 'policy.allowed' || task.processorId === 'watch.beta' && ref.kind === 'assistant-text') })
    try {
      f.feed('input', { text: 'PRIVATE_UNGRANTED_USER' }); f.feed('message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'ASSISTANT_CONTEXT' }] } }); f.feed('tool_result', result())
      await f.pipeline.idle(); expect(f.calls).toHaveLength(1)
      const tasks = (f.calls[0].request.body as any).state.tasks
      expect(tasks).toHaveLength(2); expect(tasks[0].view.context.references.every((r: any) => ['tool-result', 'policy'].includes(r.kind))).toBe(true)
      expect(tasks[1].view.context.references.every((r: any) => ['tool-result', 'assistant-text'].includes(r.kind))).toBe(true)
      for (const task of tasks) expect(task.view.event.payload).toEqual({ sourceEvent: 'tool_result' })
      const input = JSON.stringify(tasks)
      for (const secret of ['PRIVATE_REFERENCE', 'PRIVATE_UNGRANTED_USER', 'PRIVATE_SYSTEM_PROMPT', 'PRIVATE_CANONICAL_SNAPSHOT']) expect(input).not.toContain(secret)
      const out = packets(f); expect(out).toHaveLength(2)
      expect(out.find((p: any) => p.moduleId === 'watch.alpha').materials.map((r: any) => r.text).sort()).toEqual(['ALLOWED_POLICY', 'CURRENT_RESULT'])
      expect(out.find((p: any) => p.moduleId === 'watch.beta').materials.map((r: any) => r.text).sort()).toEqual(['ASSISTANT_CONTEXT', 'CURRENT_RESULT'])
      expect(JSON.stringify(out)).not.toContain('UNSELECTED_POLICY'); expect(JSON.stringify(out)).not.toContain('PRIVATE_REFERENCE')
      for (const packet of out) { expect(packet.profileId).toBe('native'); expect(packet.profileFingerprint).toHaveLength(64); expect(packet.materials.some((r: any) => r.provenance.observationId === packet.eventId)).toBe(true) }
    } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('tool progress reads only explicitly admitted text, labels provisional and invalidates at final result', async () => {
    const f = setup({ modules: [module('watch.progress', ['tool-progress'], ['tool_execution_update'])], material: { allowedKinds: ['tool-progress'], references: [] } })
    let privateReads = 0; const image: any = { type: 'image' }; Object.defineProperty(image, 'data', { get() { privateReads++; return 'PRIVATE_IMAGE_BYTES' } })
    try {
      f.feed('tool_execution_update', { toolCallId: 'p', toolName: 'synthetic' }, { content: [{ type: 'text', text: 'EXACT_PARTIAL' }, image, { type: 'thinking', thinking: 'PRIVATE_THOUGHT' }], details: { secret: 'PRIVATE_DETAILS' } })
      await f.pipeline.idle(); const [offer] = f.pipeline.coordinator.takeReady('module'), packet = (offer.candidate.payload as any).packets[0]
      expect(packet.materials[0].text).toBe('EXACT_PARTIAL'); expect(packet.materials[0].provisional).toBe(true); expect(JSON.parse(packet.materials[0].content).provisional).toBe(true)
      expect(privateReads).toBe(0); expect(JSON.stringify(f.calls)).not.toContain('PRIVATE_THOUGHT'); expect(JSON.stringify(packet)).not.toContain('PRIVATE_DETAILS')
      f.feed('tool_result', result('FINAL', 'p')); expect(offer.isCurrent()).toBe(false)
    } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('denied progress fields are not read; missing current material cannot fall back to raw event or snapshot', async () => {
    const f = setup({ modules: [module('watch.progress', ['policy'], ['tool_execution_update'])], material: { allowedKinds: ['policy'], references: [refs[0]] } })
    let reads = 0
    try {
      const frame = f.frame('tool_execution_update', { toolCallId: 'p', input: { secret: 'PRIVATE_EVENT_PAYLOAD' } })
      f.pipeline.window.capture(frame, 0, () => { reads++; return { content: [{ type: 'text', text: 'DENIED_PROGRESS' }] } }); f.pipeline.coordinator.accept(frame)
      await f.pipeline.idle(); expect(reads).toBe(0); expect(f.calls).toHaveLength(0); expect(packets(f)).toHaveLength(0)
      expect(f.pipeline.selection.traces.some(t => t.status === 'material_unavailable')).toBe(true)
    } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('tool argument projection uses explicit field admission, never the whole input', async () => {
    const f = setup({ modules: [module('watch.args', ['tool-arguments'], ['tool_call'])], material: { allowedKinds: ['tool-arguments'], references: [], toolFields: { synthetic: ['value'] } } })
    try {
      f.feed('tool_call', { toolCallId: 't', toolName: 'synthetic', input: { value: 7, secret: 'PRIVATE_ARGUMENT', body: 'PRIVATE_WRITE_BODY' } })
      await f.pipeline.idle(); const [packet] = packets(f)
      expect(packet.materials[0].text).toBe('{"value":7}'); expect(JSON.stringify(f.calls)).not.toContain('PRIVATE_ARGUMENT'); expect(JSON.stringify(f.calls)).not.toContain('PRIVATE_WRITE_BODY')
    } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('assistant partial source is independent of full snapshots and superseded by final message', async () => {
    const f = setup({ modules: [module('watch.assistant', ['assistant-progress'], ['message_update'])], material: { allowedKinds: ['assistant-progress', 'assistant-text'], references: [] } })
    try {
      f.feed('context'); f.feed('message_update', { message: { role: 'assistant', content: [{ type: 'text', text: 'ACCUMULATED_PARTIAL' }, { type: 'thinking', available: true, bodyOmitted: true }] } })
      await f.pipeline.idle(); const [offer] = f.pipeline.coordinator.takeReady('module'); expect((offer.candidate.payload as any).packets[0].materials[0].text).toBe('ACCUMULATED_PARTIAL')
      f.feed('message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'FINAL_ASSISTANT' }] } }); expect(offer.isCurrent()).toBe(false)
    } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('identical finalized tool copies preserve dependency versions and context steps never trim sources', async () => {
    const f = setup()
    try {
      const frame = f.feed('tool_result', result()); const before = f.pipeline.window.snapshot(frame.id, ['tool-result']).materials[0]
      f.feed('message_end', { message: { role: 'toolResult', ...result() } }); f.feed('context'); f.feed('context_with_system')
      const current = f.pipeline.window.sourceVersion(before.id)
      expect(current).toBe(before.version); await f.pipeline.idle(); expect(packets(f)).toHaveLength(1); expect(f.pipeline.coordinator.getStatus().step).toBe(1)
    } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('same-version changed host content rejects; new version invalidates ready selected material', async () => {
    const f = setup()
    try {
      f.feed('tool_result', result()); await f.pipeline.idle(); f.pipeline.window.setReference({ ...refs[0], version: 'p4', content: 'CHANGED_POLICY' })
      expect(packets(f)).toHaveLength(0)
      expect(() => f.pipeline.window.setReference({ ...refs[0], version: 'p4', content: 'CONFLICT' })).toThrow(); expect(f.pipeline.window.getStatus().available).toBe(false)
    } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('permission revocation after readiness or after offer invalidates the entire prepared batch', async () => {
    const f = setup()
    try { f.feed('tool_result', result()); await f.pipeline.idle(); f.permitted.set('watch.alpha', false); expect(packets(f)).toHaveLength(0) } finally { f.pipeline.dispose(); await f.pipeline.idle() }
    const g = setup()
    try { g.feed('tool_result', result()); await g.pipeline.idle(); const [offer] = g.pipeline.coordinator.takeReady('module'); g.permitted.set('watch.alpha', false); expect(offer.isCurrent()).toBe(false) } finally { g.pipeline.dispose(); await g.pipeline.idle() }
  })
  test.each(['skip', 'defer'])('semantic %s remains distinct from a missing technical reply', async mode => {
    const f = setup({ response: request => outputFor(request, mode) })
    try { f.feed('tool_result', result()); await f.pipeline.idle(); expect(packets(f)).toHaveLength(0); expect(f.pipeline.selection.traces.some(t => t.mode === mode)).toBe(true) } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('malformed native replies are technical/deferred without a fabricated semantic decision', async () => {
    const f = setup({ response: () => ({ value: { stopReason: 'stop', answers: {} } }) })
    try { f.feed('tool_result', result()); await f.pipeline.idle(); expect(packets(f)).toHaveLength(0); expect(f.pipeline.selection.getStatus().models.failureCount).toBeGreaterThan(0); expect(f.pipeline.selection.traces.some(t => t.status === 'deferred' && t.mode === undefined)).toBe(true) } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('run with no selected current reference cannot produce a usable packet', async () => {
    const f = setup({ response: request => choose(request, (_task, ref) => ref.kind === 'policy') })
    try { f.feed('tool_result', result()); await f.pipeline.idle(); expect(packets(f)).toHaveLength(0); expect(f.pipeline.selection.traces.some(t => t.status === 'no_selected_current_material')).toBe(true) } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('worker/JSON judge, missing route, ungranted source kinds and unknown watch contracts reject', () => {
    const variants = [
      () => setup({ modelConfig: config({ profiles: [profile('json')], defaultJudgeProfile: 'json' }) }),
      () => setup({ modelConfig: config({ profiles: [profile('worker')], defaultJudgeProfile: 'worker' }) }),
      () => setup({ modelConfig: config({ defaultJudgeProfile: undefined }) }),
      () => setup({ modules: [{ ...module(), referenceKinds: ['restricted'], grants: { referenceKinds: ['policy'], actions: ['monitoring.selected-material'] } }] }),
      () => setup({ modules: [module('watch.alpha', ['tool-result'], ['context'])] }),
    ]
    for (const create of variants) expect(create).toThrow()
  })
  test('classifier profile identity is admitted by role/protocol, not a product-name whitelist', async () => {
    const f = setup({ modelConfig: config({ profiles: [profile('other.decision', { backend: 'native', model: 'classifier-A' })], defaultJudgeProfile: 'other.decision' }) })
    try { f.feed('tool_result', result()); await f.pipeline.idle(); expect(packets(f)[0].profileId).toBe('other.decision') } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('limits/gaps are explicit unavailable states, never silently truncated useful text', async () => {
    const f = setup({ material: { references: [], limits: { maxSources: 1 } } })
    try { f.feed('input', { text: 'one source' }); f.feed('tool_result', result()); await f.pipeline.idle(); expect(f.pipeline.window.getStatus().available).toBe(false); expect(f.calls).toHaveLength(0); expect(packets(f)).toHaveLength(0) } finally { f.pipeline.dispose(); await f.pipeline.idle() }
    const g = setup({ material: { references: [], limits: { maxSourceBytes: 32, maxBytes: 64 } } })
    try { g.feed('tool_result', result('x'.repeat(100))); await g.pipeline.idle(); expect(g.calls).toHaveLength(0); expect(g.pipeline.window.traces.some(t => t.reason === 'material_unavailable')).toBe(true) } finally { g.pipeline.dispose(); await g.pipeline.idle() }
  })
  test('host-owned explicit intent change clears the window with A without resetting lifetime budgets', async () => {
    const f = setup({ modules: [module('watch.alpha', ['user-text', 'tool-result'])] })
    try {
      f.feed('input', { text: 'EXPLICIT_OLD_INTENT' }); f.feed('tool_result', result('FIRST')); await f.pipeline.idle(); const [old] = f.pipeline.coordinator.takeReady('module')
      const requests = f.pipeline.selection.getStatus().requests; f.pipeline.advanceIntent(); expect(old.isCurrent()).toBe(false)
      f.feed('tool_result', result('AFTER_EXPLICIT', 'next')); await f.pipeline.idle()
      expect(JSON.stringify(f.calls.at(-1)!.request)).not.toContain('EXPLICIT_OLD_INTENT'); expect(packets(f)).toHaveLength(1); expect(f.pipeline.selection.getStatus().requests).toBe(requests + 1)
    } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('new intent clears transient material instead of forming a cross-epoch cache', async () => {
    const f = setup({ modules: [module('watch.alpha', ['user-text'], ['input'])] })
    try {
      f.feed('input', { text: 'OLD_INTENT_TEXT' }); await f.pipeline.idle(); f.pipeline.coordinator.takeReady('module')
      f.feed('input', { text: 'NEW_INTENT_TEXT' }); await f.pipeline.idle()
      const last = JSON.stringify(f.calls.at(-1)!.request); expect(last).not.toContain('OLD_INTENT_TEXT'); expect(last).toContain('NEW_INTENT_TEXT'); expect(packets(f)).toHaveLength(1)
    } finally { f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('nested model timeout never hides raw physical work from the A slot', async () => {
    const began = deferred<void>(), release = deferred<void>(); let signal!: AbortSignal
    const f = setup({ selectionLimits: { coreTimeoutMs: 5 }, realtimeLimits: { maxActive: 1 }, response: async (request, context) => { signal = context.signal; began.resolve(); await release.promise; return outputFor(request) } })
    try {
      f.feed('tool_result', result()); await began.promise
      await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }) })
      expect(f.pipeline.coordinator.getStatus().active).toBe(1); expect(f.pipeline.selection.getStatus().models.profiles[0].active).toBe(1)
      release.resolve(); await f.pipeline.idle(); expect(packets(f)).toHaveLength(0); expect(f.pipeline.coordinator.getStatus().active).toBe(0)
    } finally { release.resolve(); f.pipeline.dispose(); await f.pipeline.idle() }
  })
  test('source-window scope/control and tap order are explicit and bounded', () => {
    const f = setup({ material: { references: [], limits: { maxFrames: 1, maxTrace: 1 } } })
    try {
      f.feed('context'); const old = f.feed('message_end', { message: { role: 'assistant', content: 'material' } }); f.feed('context')
      expect(f.pipeline.window.getStatus().retainedFrames).toBe(1); expect(f.pipeline.window.snapshot(old.id, ['assistant-text']).available).toBe(false)
      f.feed('session_before_tree'); expect(f.pipeline.window.getStatus().sources).toBe(0)
    } finally { f.pipeline.dispose() }
    const w = new RealtimeMaterialWindow({ enabled: true, allowedKinds: ['tool-progress'] }); const handlers = new Map<string, any>(); let detached = 0
    const tap = createPiMaterialTap({ enabled: true, observer: { frames: [] }, window: w, step: () => 0 })
    tap.extension({ on(name, handler) { handlers.set(name, handler); return () => { detached++ } } })
    handlers.get('session_start')({}, { sessionManager: { getSessionId: () => 's' } }); expect(w.getStatus().state).toBe('stopped'); tap.dispose(); tap.dispose(); expect(detached).toBe(observationEvents.length)
  })
})

if (process.env.PI_MONITORING_REQUIRE_SDK === '1' && !sdkEntry) throw new Error('B qualification requires an actual installed SDK; skipped cases do not qualify')
const actual = sdkEntry ? describe : describe.skip
const sdkProofs: any[] = []
actual('B ACTUAL SDK/faux source and scripted native-classifier composition', () => {
  let originalFetch: typeof globalThis.fetch, fetchAttempts = 0
  beforeAll(() => { originalFetch = globalThis.fetch; globalThis.fetch = Object.assign(async () => { fetchAttempts++; throw new Error('B qualification forbids external fetch') }, originalFetch) as typeof fetch })
  afterAll(() => {
    globalThis.fetch = originalFetch; expect(fetchAttempts).toBe(0)
    if (process.env.PI_MONITORING_REQUIRE_SDK === '1') expect(sdkProofs).toHaveLength(4)
    if (process.env.PI_MONITORING_SELECTION_REPORT) writeFileSync(process.env.PI_MONITORING_SELECTION_REPORT, JSON.stringify({ schemaVersion: 'monitoring-realtime-B/v1', sdkEntry, externalFetchAttempts: fetchAttempts, realModelCalls: 0, scriptedClassifierOnly: true, actualUserData: false, liveActivation: false, mainAgentInjected: false, semanticAccuracyMeasured: false, proofs: sdkProofs }, null, 2) + '\n')
  })
  const make = (modules: readonly RealtimeWatchModule[], options: { response?: (request: any, context: any) => any; toolDelay?: Promise<void>; realtimeLimits?: any } = {}) => {
    const model = fixture(), observer = new PiMonitoringObserver(() => undefined)
    ;(model.host.backends as any).native = { ...model.host.backends.native, invoke: (request: any, context: any) => { model.calls.push({ request, context }); return options.response ? options.response(request, context) : outputFor(request) } }
    const pipeline = createRealtimeSelectionPipeline({ enabled: true, observer, material: { allowedKinds: allKinds, toolFields: { synthetic: ['value'] }, references: refs }, selection: { modules, modelConfig: config(), modelHost: model.host, goal: 'Synthetic actual-SDK material proof', isPermitted: () => true }, realtimeLimits: { jobTimeoutMs: 10000, ...options.realtimeLimits } })
    return { model, observer, pipeline, async fixture() { return createSdkFixture({ observer, toolDelay: options.toolDelay, extraFactories: [pipeline.extension] }) } }
  }
  test('native tool progress text is captured separately from unchanged observer and selected while tool is running', async () => {
    const toolGate = deferred<void>(), called = deferred<void>()
    const x = make([module('watch.progress', ['tool-progress', 'user-text'], ['tool_execution_update'])], { toolDelay: toolGate.promise, response: request => { called.resolve(); return choose(request, (_task, ref) => ref.kind === 'tool-progress') } }); const f = await x.fixture()
    try {
      f.setSteps([f.ai.fauxAssistantMessage(f.ai.fauxToolCall('synthetic', { value: 7 }), { stopReason: 'toolUse' }), f.ai.fauxAssistantMessage('done')])
      const run = f.session.prompt('synthetic progress'); await called.promise; await x.pipeline.idle()
      expect(f.raw.some(r => r.event.type === 'agent_settled')).toBe(false)
      const [offer] = x.pipeline.coordinator.takeReady('module'), packet = (offer.candidate.payload as any).packets[0]
      expect(packet.materials.map((m: any) => m.text)).toEqual(['synthetic-progress']); expect(packet.materials[0].provisional).toBe(true)
      expect(JSON.stringify(x.observer.frames.find(r => r.sourceEvent === 'tool_execution_update')!.payload)).not.toContain('synthetic-progress')
      toolGate.resolve(); await run; expect(offer.isCurrent()).toBe(false); f.assertReconciled()
      sdkProofs.push({ kind: 'admitted-native-partial-text', sdkVersion: f.sdkVersion, selectedText: packet.materials[0].text, sourceEvent: packet.materials[0].provenance.sourceEvent, observerContractPreserved: true, staleAfterFinal: !offer.isCurrent() })
    } finally { toolGate.resolve(); await f.dispose(); x.pipeline.dispose(); await x.pipeline.idle() }
  })
  test('assistant final content reaches a non-user watch without whole-context or provider injection', async () => {
    const x = make([module('watch.assistant', ['assistant-text'], ['message_end'])], { response: request => choose(request, (_task, ref) => ref.kind === 'assistant-text') }); const f = await x.fixture()
    try {
      f.setSteps([f.ai.fauxAssistantMessage('EXACT_ASSISTANT_RESULT')]); await f.session.prompt('synthetic user'); await x.pipeline.idle()
      const offers = x.pipeline.coordinator.takeReady('module'), out = offers.flatMap(o => (o.candidate.payload as any).packets)
      expect(out).toHaveLength(1); expect(out[0].materials.map((m: any) => m.text)).toEqual(['EXACT_ASSISTANT_RESULT'])
      expect(JSON.stringify(x.model.calls)).not.toContain('Synthetic SDK fixture. No real data or external actions.'); expect(JSON.stringify(f.requests)).not.toContain('monitoring.selected-material-batch'); f.assertReconciled()
      sdkProofs.push({ kind: 'assistant-not-user-only', sdkVersion: f.sdkVersion, selected: out[0].materials[0].text, classifierRequests: x.model.calls.length, injected: false })
    } finally { await f.dispose(); x.pipeline.dispose(); await x.pipeline.idle() }
  })
  test('real tool-result selection crosses next context and identical finalized copies without false staleness', async () => {
    const began = deferred<void>(), release = deferred<void>()
    const x = make([module('watch.tool', ['tool-result'], ['tool_result'])], { response: async request => { began.resolve(); await release.promise; return choose(request, (_task, ref) => ref.kind === 'tool-result') } }); const f = await x.fixture()
    try {
      f.setSteps([f.ai.fauxAssistantMessage(f.ai.fauxToolCall('synthetic', { value: 19 }), { stopReason: 'toolUse' }), f.ai.fauxAssistantMessage('after result')])
      const run = f.session.prompt('synthetic tool result'); await began.promise; await run
      expect(x.pipeline.coordinator.getStatus().step).toBe(2); expect(x.pipeline.coordinator.getStatus().active).toBe(1)
      release.resolve(); await x.pipeline.idle(); const [offer] = x.pipeline.coordinator.takeReady('module'), packet = (offer.candidate.payload as any).packets[0]
      expect(packet.materials.map((m: any) => m.text)).toEqual(['synthetic-result:19']); expect(packet.materials[0].provisional).toBe(false); f.assertReconciled()
      sdkProofs.push({ kind: 'tool-result-context-crossing', sdkVersion: f.sdkVersion, contexts: f.raw.filter(r => r.event.type === 'context').length, selected: packet.materials[0].text, nativeSourceEvent: packet.materials[0].provenance.sourceEvent })
    } finally { release.resolve(); await f.dispose(); x.pipeline.dispose(); await x.pipeline.idle() }
  })
  test('native steer replaces transient context and cancels old classifier work without blocking foreground', async () => {
    const mainBegan = deferred<void>(), mainGate = deferred<void>(), judgeBegan = deferred<void>(), judgeGate = deferred<void>(); let calls = 0
    const x = make([module('watch.input', ['user-text'], ['input'])], { realtimeLimits: { maxActive: 1 }, response: async request => { calls++; if (calls === 1) { judgeBegan.resolve(); await judgeGate.promise; return outputFor(request) } return outputFor(request, 'skip') } }); const f = await x.fixture()
    try {
      f.setSteps([async () => { mainBegan.resolve(); await mainGate.promise; return f.ai.fauxAssistantMessage('old response') }, f.ai.fauxAssistantMessage('new response')])
      const run = f.session.prompt('OLD_NATIVE_INTENT'); await mainBegan.promise; await judgeBegan.promise
      await f.session.steer('NEW_NATIVE_INTENT'); mainGate.resolve(); await run
      expect(x.pipeline.coordinator.getStatus().active).toBe(1); judgeGate.resolve(); await x.pipeline.idle()
      expect(x.pipeline.coordinator.takeReady('module')).toHaveLength(0); expect(JSON.stringify(x.model.calls.at(-1)!.request)).not.toContain('OLD_NATIVE_INTENT'); expect(x.pipeline.coordinator.getStatus().epoch).toBe(2); f.assertReconciled()
      sdkProofs.push({ kind: 'native-steer-and-raw-join', sdkVersion: f.sdkVersion, inputs: f.raw.filter(r => r.event.type === 'input').length, scriptedClassifierRequests: calls, stalePackets: x.pipeline.coordinator.getStatus().ready, realModelCalls: 0 })
    } finally { mainGate.resolve(); judgeGate.resolve(); await f.dispose(); x.pipeline.dispose(); await x.pipeline.idle() }
  })
})
