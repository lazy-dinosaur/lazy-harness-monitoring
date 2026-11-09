import { expect, test } from 'bun:test'
import Type from 'typebox'
import { createConfiguredMonitoringCore, defineMonitoringModule } from '@lazy-harness/monitoring-core'
import { MonitoringCore } from '@lazy-harness/monitoring-core/engine/monitoring-core.ts'
import { piExports } from '../../../examples/p1/api-consumer.ts'
const { piHostCapabilities } = piExports

function probe(action = 'inject-context', badSecond = false, internalActions: string[] = []) {
  const calls = { factories: 0, engines: 0 }
  const binding = (id: string, action: string) => defineMonitoringModule({ version: '1', settingsSchema: Type.Object({}),
    grants: { actions: [action], referenceKinds: [] }, destination: 'r', hostRequirements: { events: ['input'], actions: [action] },
    create() { calls.factories++; return { id, eventKinds: ['input'], referenceKinds: [], allowedActions: [action], run: () => [] } } })
  const modules = { first: binding('first', action), ...(badSecond ? { second: binding('second', 'steer') } : {}) }
  const host = { capabilities: piHostCapabilities, internalActions, modules, allowedSourceScopes: ['host-supplied-events'] as const,
    maxModules: 4, receivers: { r: (r: any) => ({ requestId: r.requestId, status: 'recorded' as const }) },
    contextIdentity: { scopeId: 's', version: '1' }, createCore(options: any) { calls.engines++; return new MonitoringCore(options) } }
  const run = () => createConfiguredMonitoringCore({ contractVersion: 1, source: { kind: 'host-events', scope: 'host-supplied-events' },
    goal: 'g', receiver: 'r', modules: Object.keys(modules).map(id => ({ id, version: '1', settings: {} })) }, host)
  return { run, calls, host }
}
test('Pi supported inject-context starts; no silently dropped module', () => {
  const p = probe(), core = p.run()
  expect(p.calls).toEqual({ factories: 1, engines: 1 })
  core.start(); expect(core.getStatus().processors).toEqual(['first']); core.dispose()
})
test('one unsupported module prevents every factory and engine', () => {
  const p = probe('inject-context', true)
  expect(p.run).toThrow('second unsupported action: steer')
  expect(p.calls).toEqual({ factories: 0, engines: 0 })
})
test('unknown external actions fail closed; explicit local mapping is allowed', () => {
  const p = probe('local.notice')
  expect(p.run).toThrow('first unsupported action: local.notice')
  expect(p.calls.factories).toBe(0)
  const local = probe('local.notice', false, ['local.notice']), core = local.run(); core.dispose()
  expect(local.calls.factories).toBe(1)
  expect(probe('steer', false, ['steer']).run).toThrow('unsupported action: steer')
})
test('missing or invalid host capabilities fail before factories', () => {
  for (const capabilities of [undefined, { ...piHostCapabilities, actions: ['unknown'] }]) {
    const p = probe(); (p.host as any).capabilities = capabilities
    expect(p.run).toThrow('Invalid or missing host capabilities')
    expect(p.calls).toEqual({ factories: 0, engines: 0 })
  }
})
