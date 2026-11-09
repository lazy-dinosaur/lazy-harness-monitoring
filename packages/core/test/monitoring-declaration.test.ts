import { describe, expect, test } from 'bun:test'
import Type from 'typebox'
import { defineMonitoringModule, parseMonitoringConfiguration, prepareMonitoringBindings, MonitoringConfigurationError } from '@lazy-harness/monitoring-core'

const question = { instructions: 'Does the agent break a working rule?', criteria: { run: 'A rule is broken now.', skip: 'No rule is involved.', defer: 'Unclear.' } }
const base = (jobs: any[], extra: any = {}) => ({ purpose: { question }, watch: { events: ['tool_call'], kinds: ['tool-call', 'policy'], history: { turns: 2, granularity: 'message' } }, needs: [{ id: 'rules', adapter: 'policy.source' }], jobs, ...extra })
const job = (over: any = {}) => ({ id: 'notify', form: 'template', riskTier: 'proposal', report: { supported: ['never', 'always', 'on-result'], default: 'always' }, idempotency: 'per-event', output: 'candidate', grants: { actions: ['rule.notice'], referenceKinds: ['policy'] }, ...over })
const grants = { actions: ['rule.notice', 'rule.block'], referenceKinds: ['policy'] }
const define = (declaration?: any) => defineMonitoringModule({ version: '1', settingsSchema: Type.Object({}, { additionalProperties: false }), grants, destination: 'rule.local', ...(declaration === undefined ? {} : { declaration }), create: () => ({ id: 'rules.steer', eventKinds: ['tool.call'], referenceKinds: ['policy'], allowedActions: ['rule.notice'], run: () => [] }) })
const config = (jobs?: any[]) => parseMonitoringConfiguration({ contractVersion: 1, source: { kind: 'host-events', scope: 'host-supplied-events' }, goal: 'g', receiver: 'r', modules: [{ id: 'rules.steer', version: '1', ...(jobs ? { jobs } : {}) }] })
const prepare = (binding: any, jobs?: any[]) => prepareMonitoringBindings(config(jobs), { modules: { 'rules.steer': binding }, allowedSourceScopes: ['host-supplied-events'], maxModules: 4 })
const code = (f: () => unknown) => { try { f(); return 'ok' } catch (e) { return e instanceof MonitoringConfigurationError ? (e as any).code : 'other:' + String(e) } }

describe('module declaration v2 (S1, additive; model calls 0)', () => {
  test('v1 modules without a declaration behave exactly as before (no jobs in the result)', () => {
    const p = prepare(define())
    expect(p.processors[0]).not.toHaveProperty('jobs'); expect(define()).not.toHaveProperty('declaration')
  })
  test('a valid declaration is frozen, hashed canonically and yields effective jobs with defaults', () => {
    const b = define(base([job()]))
    expect(Object.isFrozen(b.declaration)).toBe(true); expect(b.declarationHash).toMatch(/^[0-9a-f]{64}$/)
    expect(define(base([job()])).declarationHash).toBe(b.declarationHash)
    const p = prepare(b)
    expect(p.processors[0].jobs).toEqual([expect.objectContaining({ id: 'notify', enabled: true, report: 'always', riskTier: 'proposal' })])
    expect(p.processors[0].declarationHash).toBe(b.declarationHash)
  })
  test('declaration validation fails closed', () => {
    expect(code(() => define(base([job(), job()])))).toBe('MODULE_DECLARATION')
    expect(code(() => define(base([job({ report: { supported: ['never'], default: 'always' } })])))).toBe('MODULE_DECLARATION')
    expect(code(() => define(base([job({ form: 'worker' })])))).toBe('MODULE_DECLARATION')
    expect(code(() => define(base([job({ form: 'worker', cost: { models: [{ role: 'worker', profile: 'luna' }], caps: {} } })])))).toBe('MODULE_DECLARATION')
    expect(code(() => define(base([job({ form: 'worker', cost: { models: [{ role: 'worker', profile: 'luna' }], caps: { workerDispatches: 3 } } })])))).toBe('ok')
    expect(code(() => define(base([job({ riskTier: 'automatic' })])))).toBe('MODULE_DECLARATION')
    expect(code(() => define(base([job({ riskTier: 'automatic' })], { acceptance: { setRef: 'fixtures/rules-acceptance.json' } })))).toBe('ok')
    expect(code(() => define(base([job({ grants: { actions: ['other.action'], referenceKinds: [] } })])))).toBe('MODULE_DECLARATION')
    expect(code(() => define(base([job()], { unknownField: 1 })))).toBe('MODULE_DECLARATION')
    expect(code(() => define({ ...base([job()]), watch: { events: ['tool_call', 'tool_call'], kinds: ['policy'] } }))).toBe('MODULE_DECLARATION')
  })
  test('configuration data may disable, choose a supported report mode or tighten automatic to proposal only', () => {
    const b = define(base([job(), job({ id: 'block', riskTier: 'automatic', report: { supported: ['never', 'always'], default: 'never' }, grants: { actions: ['rule.block'], referenceKinds: [] } })], { acceptance: { setRef: 'fixtures/rules-acceptance.json' } }))
    const p = prepare(b, [{ id: 'notify', report: 'on-result' }, { id: 'block', enabled: false, riskTier: 'proposal' }])
    expect(p.processors[0].jobs).toEqual([expect.objectContaining({ id: 'notify', enabled: true, report: 'on-result', riskTier: 'proposal' }), expect.objectContaining({ id: 'block', enabled: false, report: 'never', riskTier: 'proposal' })])
    expect(code(() => prepare(b, [{ id: 'block', report: 'on-result' }]))).toBe('JOB_REPORT_UNSUPPORTED')
    expect(code(() => prepare(b, [{ id: 'notify', riskTier: 'automatic' }]))).toBe('JOB_RISK_LOOSENED')
    expect(code(() => prepare(b, [{ id: 'notify', riskTier: 'read-only' }]))).toBe('JOB_RISK_LOOSENED')
    expect(code(() => prepare(b, [{ id: 'missing' }]))).toBe('JOB_UNKNOWN')
    expect(code(() => prepare(b, [{ id: 'notify' }, { id: 'notify' }]))).toBe('CONFIG_SCHEMA')
    expect(code(() => prepare(define(), [{ id: 'notify' }]))).toBe('JOB_OVERRIDE_WITHOUT_DECLARATION')
  })
  test('configuration schema rejects unknown override fields (data cannot add targets or grants)', () => {
    expect(code(() => config([{ id: 'notify', grants: { actions: ['x'] } }]))).toBe('CONFIG_SCHEMA')
    expect(code(() => config([{ id: 'notify', report: 'sometimes' }]))).toBe('CONFIG_SCHEMA')
  })
})
