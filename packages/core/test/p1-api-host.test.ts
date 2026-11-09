import { describe, expect, test } from 'bun:test'
import { MONITORING_DELIVERY_POINTS, effectiveMonitoringJobs, validateMonitoringModuleDeclaration } from '@lazy-harness/monitoring-core'
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
  test('unsupported event/action is diagnosed but configured registration and start do NOT reject it', () => {
    const host = secondHost()
    expect(hostSupportIssues(host.adapter.capabilities, [{ id: 'review.unsupported', watch: ['tool.before'], actions: ['block-tool-call'] }])).toEqual([
      { moduleId: 'review.unsupported', kind: 'event', name: 'tool_call' },
      { moduleId: 'review.unsupported', kind: 'action', name: 'block-tool-call' },
    ])
    const core = configuredCoreProbe()
    try {
      expect(core.getStatus().state).toBe('stopped')
      expect(core.getStatus().processors).toEqual(['review.unsupported'])
      core.start(); expect(core.getStatus().state).toBe('running')
      core.stop(); expect(core.getStatus().state).toBe('stopped')
    } finally { core.dispose() }
    expect(core.getStatus().state).toBe('disposed')
  })
  test('v2 runtime + host attach also do NOT enforce unsupported requirements', async () => {
    const host = secondHost()
    const c = createScenario({ id: 'review.unsupported', events: ['tool.before'], kinds: ['tool-meta'] })
    const declaration = { ...c.declaration, jobs: c.declaration.jobs.map(job => ({ ...job,
      grants: { actions: ['block-tool-call'], referenceKinds: ['tool-meta'] } })) }
    const checked = validateMonitoringModuleDeclaration(declaration, { actions: ['block-tool-call'], referenceKinds: ['tool-meta'] })
    const runtime = new MonitoringModuleRuntime({ modules: [{ moduleId: 'review.unsupported', declaration: checked.declaration,
      declarationHash: checked.hash, jobs: effectiveMonitoringJobs(checked.declaration, undefined, '/jobs')! }],
      handlers: { 'review.unsupported.prepare': { run: () => ({ status: 'prepared' }) } }, budget: new ApprovedBudgetGate() })
    const detach = host.adapter.attach(c.set)
    try {
      expect(runtime.outcomes).toEqual([])
      expect(c.set.pipelines[0]!.selection.getStatus().disposed).toBe(false)
      host.publish('opened'); host.publish('request', 'cannot emit tool calls'); await c.drain()
      expect(c.models.calls).toHaveLength(0)
    } finally { detach(); await c.close() }
  })
  test('control/unknown raw watch hooks pass declaration vocabulary but cannot construct selection', () => {
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
  test('Pi delivery uses context_with_system, not public context metadata; duplicate callbacks deliver twice', () => {
    const p = piDeliveryProbe()
    expect(MONITORING_DELIVERY_POINTS['model.before-call'].sourceEvent).toBe('context')
    expect(p.hooks.has('context')).toBe(false)
    expect(p.hooks.has('context_with_system')).toBe(true)
    const report = { moduleId: 'review.api', jobId: 'prepare', eventId: 'e1', sessionId: 'synthetic-session',
      mode: 'on-result' as const, text: 'read-only advice', riskTier: 'read-only' }
    expect(p.delivery.onReport(report)).toBe(true)
    expect(p.delivery.onReport(report)).toBe(true)
    const result = p.hooks.get('context_with_system')!({ messages: [] }, p.ctx) as { messages: unknown[] }
    expect(result.messages).toHaveLength(2) // Fake hook return, NOT actual provider input.
    expect(p.delivery.delivered).toHaveLength(2)
    expect(p.mailbox.pending).toBe(0)
  })
  test('reported is not a receipt: absent callback still reports true; throwing callback rejects after key consumption', async () => {
    const c = createScenario({ id: 'review.receipt', events: ['user.prompt'], kinds: ['user-text'] })
    const options = { modules: [{ moduleId: 'review.receipt', declaration: c.declaration,
      declarationHash: c.binding.declarationHash!, jobs: effectiveMonitoringJobs(c.declaration, undefined, '/jobs')! }],
      budget: new ApprovedBudgetGate(), handlers: { 'review.receipt.prepare': { run: () => ({ status: 'prepared' as const, report: { text: 'advice' } }) } } }
    const trigger = { moduleId: 'review.receipt', eventId: 'e1', sessionId: 'synthetic-session', evidence: [] }
    try {
      const absent = new MonitoringModuleRuntime(options)
      expect((await absent.onTrigger(trigger))[0]!.reported).toBe(true)
      const throwing = new MonitoringModuleRuntime({ ...options, report() { throw new Error('receiver failed') } })
      await expect(throwing.onTrigger(trigger)).rejects.toThrow('receiver failed')
      expect(throwing.outcomes).toHaveLength(0)
      expect((await throwing.onTrigger(trigger))[0]!.reason).toBe('duplicate:prepared')
    } finally { await c.close() }
  })
  test('retained delivery history and mailbox trace exceed pending queue capacity (finite witness)', () => {
    const p = piDeliveryProbe()
    for (let i = 0; i < 8; i++) {
      expect(p.delivery.onReport({ moduleId: 'review.retention', jobId: 'prepare', eventId: `e${i}`,
        sessionId: 'synthetic-session', mode: 'on-result', text: 'advice', riskTier: 'read-only' })).toBe(true)
      p.hooks.get('context_with_system')!({ messages: [] }, p.ctx)
    }
    expect(p.mailbox.pending).toBe(0)
    expect(p.delivery.delivered).toHaveLength(8) // maxItems is 4, only limits pending items.
    expect(p.mailbox.traces).toHaveLength(16)
  })
  test('runtime timeout is cooperative: pending raw handler survives abort until explicitly released', async () => {
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
      expect(settled).toBe(false)
      expect('stop' in runtime).toBe(false)
      expect('dispose' in runtime).toBe(false)
      release()
      expect((await pending)[0]!.status).toBe('uncertain')
    } finally { release(); await pending; await c.close() }
  })
})
