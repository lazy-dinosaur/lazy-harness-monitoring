import { describe, expect, test } from 'bun:test'
import { MONITORING_DELIVERY_POINTS, effectiveMonitoringJobs, validateMonitoringModuleDeclaration, prepareMonitoringBindings, parseMonitoringConfiguration } from '@lazy-harness/monitoring-core'
import {
  hostSupportIssues, validateHostCapabilities, frameSequenceIssues,
  type MonitoringHostAdapter, type MonitoringFrameTarget, type ObservationFrame,
} from '@lazy-harness/monitoring-core/host'
import { ApprovedBudgetGate, MonitoringModuleRuntime } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createIndependentSelectionPipelines } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-selection.ts'
import { configuredCoreProbe, generatedContextRequiresSessionManager, generatedFrameAcceptsHostFrame,
  piExports, publicErrors, piDeliveryProbe } from '../../../examples/p1/api-consumer.ts'
import { createScenario, frame, question, scriptedModels } from '../../../examples/p1/support.ts'

// A second host's native vocabulary is deliberately unlike Pi's. No sessionManager,
// SDK observer or extension context is constructed. Only normalized frames cross in.
function secondHost() {
  const capabilities = validateHostCapabilities({ hostId: 'synthetic-other', version: '1',
    events: ['session_start', 'input'], actions: [], snapshot: 'none' })
  let target: MonitoringFrameTarget | undefined, cursor = 0
  const frames: ObservationFrame[] = []
  const adapter: MonitoringHostAdapter = { capabilities,
    attach(next) { target = next; return () => { target = undefined } },
  }
  return { adapter, frames,
    publish(event: 'opened' | 'request', text = '') {
      const f = frame(++cursor, event === 'opened' ? 'session_start' : 'input',
        event === 'opened' ? {} : { source: 'interactive', text })
      frames.push(f); target?.accept(f)
    },
  }
}

describe('P1 public API and second-host review', () => {
  test('synthetic second host emits conformant frames and drives selection without Pi context', async () => {
    const host = secondHost(), models = scriptedModels()
    const set = createIndependentSelectionPipelines({ enabled: true, material: { allowedKinds: ['user-text'] },
      selection: { modules: [{ id: 'review.second-host', watchEvents: ['input'], referenceKinds: ['user-text'],
        grants: { actions: ['monitoring.selected-material'], referenceKinds: ['user-text'] }, question,
        destination: 'receipt', includeCurrentMaterial: true }],
      goal: 'second host probe', modelConfig: models.config, modelHost: models.host, isPermitted: () => true } })
    const detach = host.adapter.attach(set)
    try {
      host.publish('opened'); host.publish('request', 'synthetic request'); await set.idle()
      expect(frameSequenceIssues(host.frames, host.adapter.capabilities)).toEqual([])
      expect(models.calls).toHaveLength(1)
      expect(set.pipelines[0]!.coordinator.takeReady('module')).toHaveLength(1)
      expect(generatedFrameAcceptsHostFrame(host.frames[0]!)).toBe(host.frames[0]!)
      expect(generatedContextRequiresSessionManager).toBe(true)
      detach(); host.publish('request', 'after detach'); await set.idle()
      expect(models.calls).toHaveLength(1)
      set.halt('stopped')
      expect(set.pipelines[0]!.coordinator.getStatus().state).toBe('stopped')
    } finally { detach(); set.dispose(); await set.idle() }
    expect(set.pipelines[0]!.selection.getStatus().disposed).toBe(true)
  })
  test('unsupported event/action refuses configured startup before factories or engine construction', () => {
    const host = secondHost(), counters = { factories: 0, engines: 0 }
    expect(() => configuredCoreProbe(host.adapter.capabilities as any, counters)).toThrow('review.unsupported unsupported event: tool_call')
    expect(counters).toEqual({ factories: 0, engines: 0 })
    expect(() => configuredCoreProbe({ ...host.adapter.capabilities, events: ['tool_call'] } as any, counters)).toThrow('review.unsupported unsupported action: block-tool-call')
    expect(counters).toEqual({ factories: 0, engines: 0 })
  })
  test('declared v2 requirements are refused by shared binding preflight before factories and attach', async () => {
    const host = secondHost(), c = createScenario({ id: 'review.unsupported', events: ['tool.before'], kinds: ['tool-meta'] })
    let factories = 0
    try {
      const declaration = { ...c.declaration, jobs: c.declaration.jobs.map(job => ({ ...job,
        grants: { actions: ['block-tool-call'], referenceKinds: ['tool-meta'] } })) }
      const checked = validateMonitoringModuleDeclaration(declaration, { actions: ['block-tool-call'], referenceKinds: ['tool-meta'] })
      const config = parseMonitoringConfiguration({ contractVersion: 1, source: { kind: 'host-events', scope: 'host-supplied-events' }, goal: 'g', receiver: 'r', modules: [{ id: 'review.unsupported', version: '1', settings: {} }] })
      expect(() => prepareMonitoringBindings(config, { modules: { 'review.unsupported': { ...c.binding,
        declaration: checked.declaration, build() { factories++; throw new Error('must not run') } } },
        capabilities: host.adapter.capabilities, allowedSourceScopes: ['host-supplied-events'], maxModules: 1 })).toThrow('review.unsupported unsupported')
      expect(factories).toBe(0)
      expect(c.models.calls).toHaveLength(0)
    } finally { await c.close() }
  })
  test('control/unknown raw watch hooks are rejected by low-level selection as well as declaration', () => {
    const models = scriptedModels()
    for (const event of ['session_start', 'session_compact', 'session_tree', 'model_select', 'thinking_level_select', 'context', 'context_with_system', 'unknown_hook']) {
      expect(() => createIndependentSelectionPipelines({ enabled: true, material: { allowedKinds: ['event-meta'] },
        selection: { modules: [{ id: 'review.control', watchEvents: [event], referenceKinds: ['event-meta'],
          grants: { actions: ['monitoring.selected-material'], referenceKinds: ['event-meta'] }, question, destination: 'receipt' }],
          goal: 'control probe', modelConfig: models.config, modelHost: models.host, isPermitted: () => true } })).toThrow()
    }
  })
  test('missing v2 handler rejects construction, while status/trace ports remain inspectable', async () => {
    const c = createScenario({ id: 'review.api', events: ['user.prompt'], kinds: ['user-text'] })
    try {
      expect(() => new MonitoringModuleRuntime({ modules: [{ moduleId: 'review.api', declaration: c.declaration,
        declarationHash: c.binding.declarationHash!, jobs: effectiveMonitoringJobs(c.declaration, undefined, '/jobs')! }],
        handlers: {}, budget: new ApprovedBudgetGate() })).toThrow('missing job handler')
      await c.emit('input', { source: 'interactive', text: 'request' })
      expect(c.trace.some(row => row.type === 'judgement')).toBe(true)
      expect(c.trace.some(row => row.type === 'job')).toBe(true)
      expect(c.set.pipelines[0]!.selection.traces.length).toBeGreaterThan(0)
      expect(c.set.pipelines[0]!.selection.getStatus().requests).toBe(1)
      expect(publicErrors.MonitoringConfigurationError.name).toBe('MonitoringConfigurationError')
      expect(publicErrors.MonitoringModelError.name).toBe('MonitoringModelError')
      expect(Object.values(piExports).every(value => value !== undefined)).toBe(true)
    } finally { await c.close() }
  })
  test('Pi metadata names context_with_system; duplicate report callbacks deliver once', () => {
    const p = piDeliveryProbe()
    expect(MONITORING_DELIVERY_POINTS['model.before-call'].sourceEvent).toBe('context_with_system')
    expect(p.hooks.has('context')).toBe(false)
    expect(p.hooks.has('context_with_system')).toBe(true)
    const report = { moduleId: 'review.api', jobId: 'prepare', eventId: 'e1', sessionId: 'synthetic-session',
      mode: 'on-result' as const, text: 'read-only advice', riskTier: 'read-only' }
    expect(p.delivery.onReport(report)).toBe(true)
    expect(p.delivery.onReport({ ...report })).toBe(false)
    const result = p.hooks.get('context_with_system')!({ messages: [] }, p.ctx) as { messages: unknown[] }
    expect(result.messages).toHaveLength(1) // Fake hook return, NOT actual provider input.
    expect(p.delivery.delivered).toHaveLength(1)
    expect(p.mailbox.pending).toBe(0)
  })
  test('absent/throwing receiver records failed/unknown receipt without rerunning prepared jobs', async () => {
    const c = createScenario({ id: 'review.receipt', events: ['user.prompt'], kinds: ['user-text'] })
    const options = { modules: [{ moduleId: 'review.receipt', declaration: c.declaration,
      declarationHash: c.binding.declarationHash!, jobs: effectiveMonitoringJobs(c.declaration, undefined, '/jobs')! }],
      budget: new ApprovedBudgetGate(), handlers: { 'review.receipt.prepare': { run: () => ({ status: 'prepared' as const, report: { text: 'advice' } }) } } }
    const trigger = { moduleId: 'review.receipt', eventId: 'e1', sessionId: 'synthetic-session', evidence: [] }
    try {
      const absent = new MonitoringModuleRuntime(options)
      expect((await absent.onTrigger(trigger))[0]).toMatchObject({ reported: false, reason: 'report_failed', reportReceipt: { status: 'failed', reason: 'receiver_absent' } })
      const throwing = new MonitoringModuleRuntime({ ...options, report() { throw new Error('receiver failed') } })
      expect((await throwing.onTrigger(trigger))[0]).toMatchObject({ status: 'prepared', reported: false, reason: 'report_unknown', reportReceipt: { status: 'unknown', reason: 'receiver_exception' } })
      expect(throwing.outcomes).toHaveLength(1)
      expect((await throwing.onTrigger(trigger))[0]!.reason).toBe('duplicate:prepared')
    } finally { await c.close() }
  })
  test('delivery diagnostics are bounded independently of live mailbox dedup keys', () => {
    const p = piDeliveryProbe({ maxDelivered: 3, maxTrace: 4 })
    for (let i = 0; i < 8; i++) {
      expect(p.delivery.onReport({ moduleId: 'review.retention', jobId: 'prepare', eventId: `e${i}`,
        sessionId: 'synthetic-session', mode: 'on-result', text: 'advice', riskTier: 'read-only' })).toBe(true)
      p.hooks.get('context_with_system')!({ messages: [] }, p.ctx)
    }
    expect(p.mailbox.pending).toBe(0)
    expect(p.delivery.delivered).toHaveLength(3)
    expect(p.mailbox.traces).toHaveLength(4)
    expect(p.delivery.getStatus().deliveredEvicted).toBe(5)
    expect(p.mailbox.getStatus()).toMatchObject({ seen: 8, traceEvicted: 12 })
  })
  test('runtime timeout is terminal while raw handler remains accounted until explicitly released', async () => {
    const c = createScenario({ id: 'review.timeout', events: ['user.prompt'], kinds: ['user-text'] })
    let release!: () => void, aborted!: Promise<void>
    const raw = new Promise<void>(resolve => { release = resolve })
    const runtime = new MonitoringModuleRuntime({ jobTimeoutMs: 5,
      modules: [{ moduleId: 'review.timeout', declaration: c.declaration, declarationHash: c.binding.declarationHash!,
        jobs: effectiveMonitoringJobs(c.declaration, undefined, '/jobs')! }], budget: new ApprovedBudgetGate(),
      handlers: { 'review.timeout.prepare': { async run({ signal }) {
        aborted = new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
        await raw; return { status: 'prepared' }
      } } } })
    let settled = false
    const pending = runtime.onTrigger({ moduleId: 'review.timeout', sessionId: 'synthetic-session', eventId: 'timeout-event', evidence: [] })
      .then(result => { settled = true; return result })
    try {
      await aborted
      expect((await pending)[0]!.status).toBe('uncertain')
      expect(settled).toBe(true)
      expect(runtime.getStatus()).toMatchObject({ rawActive: 1, logicalActive: 0 })
      let idle = false; const drain = runtime.idle().then(() => { idle = true })
      await Promise.resolve(); expect(idle).toBe(false)
      release(); await drain
      expect(runtime.getStatus().rawActive).toBe(0)
      expect(runtime.outcomes).toHaveLength(1)
    } finally { release(); runtime.dispose(); await pending; await runtime.idle(); await c.close() }
  })
})
