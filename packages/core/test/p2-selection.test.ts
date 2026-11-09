import { expect, test } from 'bun:test'
import type { MonitoringModelBackend } from '@lazy-harness/monitoring-core'
import { createIndependentSelectionPipelines, type RealtimeSelectionPacket } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-selection.ts'
import { scriptedModels } from '../../../examples/p1/support.ts'
import { frame, question } from './support/p2-fixtures.ts'
import { deferred, flush, ManualClock } from './support/p2-scheduler.ts'

function setup(invoke?: MonitoringModelBackend['invoke'], enabled = true) {
  const models = scriptedModels(), allowed = new Set(['bad', 'good'])
  if (invoke) models.host.backends.judge = { ...models.host.backends.judge, invoke }
  const set = createIndependentSelectionPipelines({ enabled, material: { allowedKinds: ['tool-result', 'policy'],
    references: [{ id: 'policy', kind: 'policy', version: '1', content: 'synthetic restricted material' }], limits: { maxFrames: 3, maxTrace: 4 } },
    selection: { modules: ['bad', 'good'].map(id => ({ id, watchEvents: ['tool_result'], destination: id, question,
      referenceKinds: id === 'bad' ? ['tool-result', 'policy'] : ['tool-result'], grants: { actions: ['monitoring.selected-material'], referenceKinds: id === 'bad' ? ['tool-result', 'policy'] : ['tool-result'] }, includeCurrentMaterial: true })),
      modelConfig: models.config, modelHost: models.host, goal: 'P2 isolation', isPermitted: id => allowed.has(id), limits: { maxTrace: 4 } },
    realtimeLimits: { maxTrace: 4, jobTimeoutMs: 10000 } })
  set.accept(frame(1, 'session_start'))
  return { set, models, allowed, packets(id: string) { return set.byModule[id]!.coordinator.takeReady('module').flatMap(o => (o.candidate.payload as unknown as { packets: RealtimeSelectionPacket[] }).packets) } }
}
for (const mode of ['throw', 'malformed', 'invalid-choice', 'provider-error'] as const) test(`judge ${mode} is isolated to its module and grants never widen`, async () => {
  const base = scriptedModels().host.backends.judge
  const h = setup(async (request, context) => {
    const id = (request.body as any).state.tasks[0].processorId
    if (id === 'bad') {
      if (mode === 'throw') throw Error('provider fault')
      if (mode === 'malformed') return { value: 'not a classifier object' }
      if (mode === 'provider-error') return { value: { stopReason: 'error', errorMessage: 'fixture failure' } }
      return { value: { stopReason: 'stop', answers: { decision_0: { type: 'choice', choice: 'invalid', confidence: 1 } } } }
    }
    return base.invoke(request, context)
  })
  try {
    h.set.accept(frame(2)); await h.set.idle(); expect(h.packets('bad')).toEqual([])
    const good = h.packets('good'); expect(good).toHaveLength(1)
    expect(good[0]!.materials.every(m => m.kind === 'tool-result')).toBe(true)
    expect(good[0]!.materials[0]!.provenance).toMatchObject({ owner: 'observation', observationId: 'frame:2', sessionId: 'session', binding: 1, cursor: 2, sourceEvent: 'tool_result' })
    for (const p of h.set.pipelines) expect(p.selection.getStatus().active).toBe(0)
  } finally { h.set.dispose(); await h.set.idle() }
})
for (const invalidation of ['permission', 'reference', 'branch', 'halt', 'dispose'] as const) test(`late judge after ${invalidation} only publishes still-current dependencies`, async () => {
  const gate = deferred(), base = scriptedModels().host.backends.judge
  const h = setup(async (request, context) => { await gate.promise; return base.invoke(request, context) })
  try {
    h.set.accept(frame(2)); await flush(64)
    expect(h.set.pipelines.every(p => p.coordinator.getStatus().active === 1)).toBe(true)
    if (invalidation === 'permission') h.allowed.clear()
    if (invalidation === 'reference') for (const p of h.set.pipelines) p.window.setReference({ id: 'policy', kind: 'policy', version: '2', content: 'changed policy' })
    if (invalidation === 'branch') h.set.accept(frame(3, 'session_tree'))
    if (invalidation === 'halt') h.set.halt()
    if (invalidation === 'dispose') h.set.dispose()
    gate.resolve(); await h.set.idle()
    expect(h.packets('bad')).toEqual([])
    // The good module never received policy: changing it must not revoke unrelated work.
    expect(h.packets('good')).toHaveLength(invalidation === 'reference' ? 1 : 0)
    for (const p of h.set.pipelines) expect(p.coordinator.getStatus()).toMatchObject({ active: 0, queued: 0, ready: 0 })
  } finally { gate.resolve(); h.set.dispose(); await h.set.idle() }
})
test('virtual provider timeout cannot free raw preparation or publish late packets', async () => {
  const clock = new ManualClock(), restore = clock.install(), gate = deferred(), base = scriptedModels().host.backends.judge
  const h = setup(async (request, context) => { await gate.promise; return base.invoke(request, context) })
  try {
    h.set.accept(frame(2)); await flush(64); await clock.advance(1000)
    expect(h.set.pipelines.every(p => p.coordinator.getStatus().active === 1)).toBe(true)
    gate.resolve(); await h.set.idle(); expect(h.packets('bad')).toEqual([]); expect(h.packets('good')).toEqual([])
    expect(clock.pending).toBe(0)
  } finally { gate.resolve(); h.set.dispose(); await h.set.idle(); restore() }
})
test('noncooperative pending judge in one independent pipeline cannot hold healthy peer delivery', async () => {
  const gate = deferred(), base = scriptedModels().host.backends.judge
  const h = setup(async (request, context) => {
    if ((request.body as any).state.tasks[0].processorId === 'bad') await gate.promise
    return base.invoke(request, context)
  })
  try {
    h.set.accept(frame(2)); await flush(128)
    expect(h.packets('good')).toHaveLength(1); expect(h.packets('bad')).toEqual([])
    expect(h.set.byModule.bad!.coordinator.getStatus().active).toBe(1)
    h.set.halt(); expect(h.set.byModule.bad!.coordinator.getStatus().active).toBe(1)
    gate.resolve(); await h.set.idle(); expect(h.packets('bad')).toEqual([])
  } finally { gate.resolve(); h.set.dispose(); await h.set.idle() }
})
test('disabled selection performs no provider work or material capture', async () => {
  const h = setup(undefined, false)
  try { h.set.accept(frame(2)); await h.set.idle(); expect(h.models.calls).toEqual([]); expect(h.set.pipelines.every(p => p.window.getStatus().sources === 0 && p.coordinator.getStatus().started === 0)).toBe(true) }
  finally { h.set.dispose(); await h.set.idle() }
})
test('20 register/drain/dispose cycles leave zero exposed active objects and bounded diagnostics', async () => {
  for (let cycle = 0; cycle < 20; cycle++) {
    const h = setup()
    try {
      for (let n = 2; n <= 8; n++) {
        h.set.accept(frame(n)); await h.set.idle(); h.packets('bad'); h.packets('good')
      }
      for (const p of h.set.pipelines) {
        expect(p.coordinator.getStatus()).toMatchObject({ active: 0, queued: 0, ready: 0, readyBytes: 0 })
        expect(p.coordinator.traces.length).toBeLessThanOrEqual(4); expect(p.selection.traces.length).toBeLessThanOrEqual(4)
        expect(p.window.getStatus().retainedFrames).toBeLessThanOrEqual(3)
      }
    } finally { h.set.dispose(); await h.set.idle() }
    for (const p of h.set.pipelines) {
      expect(p.window.getStatus()).toMatchObject({ sources: 0, bytes: 0, retainedFrames: 0, state: 'disposed' })
      expect(p.selection.getStatus()).toMatchObject({ active: 0, disposed: true })
    }
  }
})
