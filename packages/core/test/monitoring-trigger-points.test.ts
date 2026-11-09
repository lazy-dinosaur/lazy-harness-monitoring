import { describe, expect, test } from 'bun:test'
import Type from 'typebox'
import { defineMonitoringModule, parseMonitoringConfiguration, prepareMonitoringBindings, MonitoringConfigurationError, resolveMonitoringWatch, MONITORING_TRIGGER_POINTS } from '../src/sdk/index.ts'
import { observationEvents, type ObservationFrame, type ObservationSnapshot } from '../src/host/frames.ts'
import { createIndependentSelectionPipelines, createRealtimeSelectionPipeline, type RealtimeWatchModule } from '../src/engine/monitoring-core-realtime-selection.ts'
import { watchModuleFromDeclaration } from '../src/engine/monitoring-engine-runtime.ts'
import { config, fixture, outputFor } from './support/model-fixture.ts'

// task154: named trigger points (WHEN a module checks), configuration narrowing, and independent per-module pipelines.
const question = { instructions: 'Synthetic trigger test', criteria: { run: 'r', skip: 's', defer: 'd' } }
const job = { id: 'deliver', form: 'template', riskTier: 'read-only', report: { supported: ['never', 'always'], default: 'always' }, idempotency: 'per-event', output: 'candidate', grants: { actions: ['monitoring.selected-material'], referenceKinds: ['user-text'] } }
const grants = { actions: ['monitoring.selected-material'], referenceKinds: ['user-text'] }
const define = (events: string[]) => defineMonitoringModule({ version: '1', settingsSchema: Type.Object({}, { additionalProperties: false }), grants, destination: 'sink', declaration: { purpose: { question }, watch: { events, kinds: ['user-text'] }, jobs: [job] }, create: () => ({ id: 'trigger.mod', eventKinds: ['user.input'], referenceKinds: ['user-text'], allowedActions: ['monitoring.selected-material'], run: () => [] }) })
const prepare = (binding: any, watch?: string[]) => prepareMonitoringBindings(parseMonitoringConfiguration({ contractVersion: 1, source: { kind: 'host-events', scope: 'host-supplied-events' }, goal: 'g', receiver: 'r', modules: [{ id: 'trigger.mod', version: '1', ...(watch ? { watch: { events: watch } } : {}) }] }), { modules: { 'trigger.mod': binding }, allowedSourceScopes: ['host-supplied-events'], maxModules: 4 })
const code = (f: () => unknown) => { try { f(); return 'ok' } catch (e) { return e instanceof MonitoringConfigurationError ? (e as any).code : 'other:' + String(e) } }

describe('trigger points (task154, model calls 0)', () => {
  test('every point maps to a hook the observer registers', () => {
    for (const [name, p] of Object.entries(MONITORING_TRIGGER_POINTS)) expect((observationEvents as readonly string[]).includes(p.sourceEvent), name).toBe(true)
  })
  test('conditions are deterministic over the frame payload', () => {
    const w = resolveMonitoringWatch(['user.steer', 'tool.failed'])
    expect(w.sourceEvents).toEqual(['input', 'tool_execution_end']); expect(w.conditional).toBe(true)
    expect(w.matches({ sourceEvent: 'input', payload: { source: 'interactive', text: 'fix', streamingBehavior: 'steer' } })).toBe(true)
    expect(w.matches({ sourceEvent: 'input', payload: { text: 'new request' } })).toBe(false)
    expect(w.matches({ sourceEvent: 'tool_execution_end', payload: { toolCallId: 't', toolName: 'bash', isError: true } })).toBe(true)
    expect(w.matches({ sourceEvent: 'tool_execution_end', payload: { toolCallId: 't', toolName: 'bash', isError: false } })).toBe(false)
    expect(w.matches({ sourceEvent: 'tool_execution_end', payload: null })).toBe(false)
    const p = resolveMonitoringWatch(['user.prompt'])
    expect(p.matches({ sourceEvent: 'input', payload: { source: 'interactive', text: 'request' } })).toBe(true)
    expect(p.matches({ sourceEvent: 'input', payload: { source: 'extension' } })).toBe(false)
    expect(resolveMonitoringWatch(['message_end']).conditional).toBe(false)
    expect(() => resolveMonitoringWatch(['model.before-call'])).toThrow('delivery-only')
    expect(() => resolveMonitoringWatch(['tool.unknown'])).toThrow('unknown trigger point')
  })
  test('declarations accept points and raw hooks, reject unknown or delivery-only points', () => {
    expect(code(() => define(['user.steer', 'turn.end', 'tool_call']))).toBe('ok')
    expect(code(() => define(['user.typo']))).toBe('MODULE_DECLARATION')
    expect(code(() => define(['model.before-call']))).toBe('MODULE_DECLARATION')
  })
  test('configuration may only select a subset of the declared points', () => {
    const b = define(['user.steer', 'turn.end'])
    expect(prepare(b).processors[0].watch).toEqual(['user.steer', 'turn.end'])
    expect(prepare(b, ['turn.end']).processors[0].watch).toEqual(['turn.end'])
    expect(code(() => prepare(b, ['tool.before']))).toBe('WATCH_WIDENED')
    expect(code(() => prepare(b, ['turn.end', 'turn.end']))).toBe('CONFIG_SCHEMA')
  })
  test('the engine resolves points into hooks plus a per-module trigger', () => {
    const b = define(['user.steer', 'turn.end'])
    const m = watchModuleFromDeclaration('trigger.mod', b.declaration as any, grants, 'sink')
    expect(m.watchEvents).toEqual(['input', 'turn_end']); expect(typeof m.trigger).toBe('function')
    expect(watchModuleFromDeclaration('trigger.mod', b.declaration as any, grants, 'sink', { events: ['turn.end'] }).watchEvents).toEqual(['turn_end'])
  })
})

const mod = (id: string, trigger?: RealtimeWatchModule['trigger']): RealtimeWatchModule => ({ id, watchEvents: ['input'], referenceKinds: ['user-text'], grants: { referenceKinds: ['user-text'], actions: ['monitoring.selected-material'] }, question, destination: 'sink:' + id, ...(trigger ? { trigger } : {}) })
const steerOnly = resolveMonitoringWatch(['user.steer']).matches
function harness(modules: RealtimeWatchModule[], fail?: string) {
  const f = fixture()
  ;(f.host.backends as any).native = { ...f.host.backends.native, invoke: (request: any, context: any) => { f.calls.push({ request, context }); const ids = request.body.state.tasks.map((t: any) => t.processorId); if (fail && ids.includes(fail)) throw new Error('module judge failure'); const out: any = outputFor(request); request.body.state.tasks.forEach((t: any, i: number) => { out.value.answers[`decision_${i}`].choice = 'run'; t.view.context.references.forEach((_r: any, j: number) => { out.value.answers[`ref_${i}_${j}`].probability = 0.95 }) }); return out } }
  const set = createIndependentSelectionPipelines({ enabled: true, material: { allowedKinds: ['user-text'] }, selection: { modules, goal: 'Independent trigger proof', modelConfig: config(), modelHost: f.host, isPermitted: () => true }, realtimeLimits: { jobTimeoutMs: 10000 } })
  for (const p of set.pipelines) { p.window.start({ sessionId: 's', binding: 1 }); p.coordinator.start({ sessionId: 's', binding: 1 }) }
  let cursor = 0
  const feed = async (payload: any) => {
    const n = ++cursor
    const snapshot: ObservationSnapshot = { sessionId: 's', leafId: `leaf-${n}`, branch: [], canonicalMessages: [], effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: `h-${n}`, revision: `r-${n}`, available: true, fullProviderContext: false, omitted: [] }
    const frame: ObservationFrame = { id: `frame:${n}`, cursor: n, sourceEvent: 'input', kind: 'input', sessionId: 's', binding: 1, epoch: n, payload, snapshot, available: true }
    for (const p of set.pipelines) { p.window.capture(frame, p.coordinator.getStatus().step); p.coordinator.accept(frame) }
    await set.idle()
  }
  const judged = () => f.calls.flatMap(c => (c.request.body as any).state.tasks.map((t: any) => t.processorId))
  const ready = (id: string) => set.byModule[id]!.coordinator.takeReady('module').length
  return { set, feed, judged, ready }
}

describe('independent per-module pipelines (task154, model calls 0)', () => {
  test('a batched bridge refuses conditional modules', () => {
    const f = fixture()
    expect(() => createRealtimeSelectionPipeline({ enabled: true, material: { allowedKinds: ['user-text'] }, selection: { modules: [mod('a.mod', steerOnly), mod('b.mod')], goal: 'g', modelConfig: config(), modelHost: f.host, isPermitted: () => true } })).toThrow('independent per-module pipelines')
  })
  test('each module triggers on its own point and sends its own judge request', async () => {
    const h = harness([mod('steer.mod', steerOnly), mod('all.mod')])
    try {
      await h.feed({ text: 'plain request', source: 'interactive' })
      expect(h.judged()).toEqual(['all.mod'])
      await h.feed({ text: 'stop and fix the test first', source: 'interactive', streamingBehavior: 'steer' })
      expect(h.judged().sort()).toEqual(['all.mod', 'all.mod', 'steer.mod'])
    } finally { h.set.dispose(); await h.set.idle() }
  })
  test('one module failing does not change another module outcome', async () => {
    const h = harness([mod('broken.mod'), mod('healthy.mod')], 'broken.mod')
    try {
      await h.feed({ text: 'a request', source: 'interactive' })
      expect(h.ready('healthy.mod')).toBe(1); expect(h.ready('broken.mod')).toBe(0)
    } finally { h.set.dispose(); await h.set.idle() }
  })
})
