import { describe, expect, test } from 'bun:test'
import { PiMonitoringObserver, createPiObservationExtension, attachPiFrames, piHostCapabilities } from '../src/index.ts'
import { frameSequenceIssues, hostSupportIssues } from '@lazy-harness/monitoring-core/host'
import { createIndependentSelectionPipelines, type RealtimeWatchModule } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-selection.ts'
import { config, fixture, outputFor } from '../../../packages/core/test/support/model-fixture.ts'

// Pi host adapter conformance (ADR 0062), with a fake Pi extension API and no model call.
function fakePi() {
  const handlers = new Map<string, Array<(e: any, ctx: any) => unknown>>()
  return { on(name: string, h: (e: any, ctx: any) => unknown) { handlers.set(name, [...(handlers.get(name) ?? []), h]); return () => handlers.set(name, (handlers.get(name) ?? []).filter(x => x !== h)) }, emit(name: string, e: any, ctx: any) { for (const h of handlers.get(name) ?? []) h({ type: name, ...e }, ctx) } }
}
const messages: any[] = []
const ctx = { sessionManager: { getSessionId: () => 'pi-s', getLeafId: () => 'leaf', getBranch: () => messages.map((_, i) => ({ id: 'e' + i, parentId: i ? 'e' + (i - 1) : null, type: 'message' })), buildSessionProjection: () => ({ messages }) }, getSystemPrompt: () => 'sys' }

describe('Pi host adapter (ADR 0062)', () => {
  test('declares only implemented Pi actions and reports unsupported blocking', () => {
    expect(piHostCapabilities.hostId).toBe('pi'); expect(piHostCapabilities.actions).toEqual(['inject-context'])
    expect(hostSupportIssues(piHostCapabilities, [{ id: 'x', watch: ['tool.before'], actions: ['block-tool-call'] }])).toEqual([{ moduleId: 'x', kind: 'action', name: 'block-tool-call' }])
  })
  test('Pi hooks become conformant frames and reach an independent module pipeline', async () => {
    const pi = fakePi(), observer = new PiMonitoringObserver(() => undefined), f = fixture()
    ;(f.host.backends as any).native = { ...f.host.backends.native, invoke: (request: any, context: any) => { f.calls.push({ request, context }); const out: any = outputFor(request); out.value.answers.decision_0.choice = 'skip'; return out } }
    const module: RealtimeWatchModule = { id: 'pi.mod', watchEvents: ['input'], referenceKinds: ['user-text'], grants: { referenceKinds: ['user-text'], actions: ['monitoring.selected-material'] }, question: { instructions: 'q', criteria: { run: 'r', skip: 's', defer: 'd' } }, destination: 'sink' }
    const set = createIndependentSelectionPipelines({ enabled: true, material: { allowedKinds: ['user-text'] }, selection: { modules: [module], goal: 'g', modelConfig: config(), modelHost: f.host, isPermitted: () => true }, realtimeLimits: { jobTimeoutMs: 10000 } })
    createPiObservationExtension({ enabled: true, observer })(pi)
    const detach = attachPiFrames(pi, observer, set)
    try {
      pi.emit('session_start', { reason: 'startup' }, ctx)
      messages.push({ role: 'user', content: 'check this' }); pi.emit('input', { text: 'check this', source: 'interactive' }, ctx)
      await set.idle(); await observer.idle()
      expect(frameSequenceIssues(observer.frames, piHostCapabilities)).toEqual([])
      expect(f.calls).toHaveLength(1)
      expect(f.calls[0]!.request.body.state.tasks[0].processorId).toBe('pi.mod')
    } finally { detach(); set.dispose(); await set.idle(); observer.close() }
  })
})
