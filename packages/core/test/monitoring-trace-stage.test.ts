import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Type from 'typebox'
import { defineMonitoringModule, parseMonitoringConfiguration, prepareMonitoringBindings, MonitoringConfigurationError } from '../src/sdk/index.ts'
import { ApprovedBudgetGate, MemoryIdempotencyStore, MonitoringModuleRuntime, type JobHandler, type Report, type Trigger } from '../src/engine/monitoring-engine-runtime.ts'
import { validateMonitoringModuleDeclaration, effectiveMonitoringJobs } from '../src/sdk/declaration.ts'
import { createFileTraceSink, pruneTraces } from '../src/engine/monitoring-trace.ts'
import { createIndependentSelectionPipelines, type RealtimeWatchModule } from '../src/engine/monitoring-core-realtime-selection.ts'
import { type ObservationFrame, type ObservationSnapshot } from '../src/host/frames.ts'
import { config, fixture, outputFor } from './support/model-fixture.ts'

// task154 step 1 of the use-time tuning loop: run stages and the judgement trace (model calls 0).
const q = { instructions: 'q?', criteria: { run: 'r', skip: 's', defer: 'd' } }
const grants = { actions: ['monitoring.selected-material', 'rule.notice'], referenceKinds: ['user-text'] }
const job = (over: any = {}) => ({ id: 'deliver', form: 'template', riskTier: 'read-only', report: { supported: ['never', 'always'], default: 'always' }, idempotency: 'per-event', output: 'candidate', grants: { actions: ['monitoring.selected-material'], referenceKinds: ['user-text'] }, ...over })
const code = (f: () => unknown) => { try { f(); return 'ok' } catch (e) { return e instanceof MonitoringConfigurationError ? (e as any).code : 'other:' + String(e) } }

describe('run stages (task154)', () => {
  const define = (extra: any = {}) => defineMonitoringModule({ version: '1', settingsSchema: Type.Object({}, { additionalProperties: false }), grants, destination: 'sink', declaration: { purpose: { question: q }, watch: { events: ['input'], kinds: ['user-text'] }, jobs: [job()], ...extra }, create: () => ({ id: 'stage.mod', eventKinds: ['user.input'], referenceKinds: ['user-text'], allowedActions: ['monitoring.selected-material'], run: () => [] }) })
  const prepare = (b: any, stage?: string) => prepareMonitoringBindings(parseMonitoringConfiguration({ contractVersion: 1, source: { kind: 'host-events', scope: 'host-supplied-events' }, goal: 'g', receiver: 'r', modules: [{ id: 'stage.mod', version: '1', ...(stage ? { stage } : {}) }] }), { modules: { 'stage.mod': b }, allowedSourceScopes: ['host-supplied-events'], maxModules: 4, capabilities: { hostId: 'fixture', version: '1', events: ['input', 'turn_end', 'tool_call'], actions: ['inject-context'], snapshot: 'none' }, internalActions: ['rule.notice', 'rule.block'] })
  test('configuration may only lower the declared highest stage', () => {
    expect((prepare(define()).processors[0] as any).stage).toBe('active')
    expect((prepare(define({ maxStage: 'shadow' })).processors[0] as any).stage).toBe('shadow')
    expect((prepare(define({ maxStage: 'shadow' }), 'observe').processors[0] as any).stage).toBe('observe')
    expect(code(() => prepare(define({ maxStage: 'shadow' }), 'active'))).toBe('STAGE_RAISED')
  })
  const runtime = (stage: any, jobs: any[], handlers: Record<string, JobHandler>, rows: any[], reports: Report[]) => {
    const { declaration, hash } = validateMonitoringModuleDeclaration({ purpose: { question: q }, watch: { events: ['input'], kinds: ['user-text'] }, jobs }, grants)
    return new MonitoringModuleRuntime({ modules: [{ moduleId: 'stage.mod', declaration, declarationHash: hash, jobs: effectiveMonitoringJobs(declaration, undefined, '/m')!, stage }], handlers, budget: new ApprovedBudgetGate(), idempotency: new MemoryIdempotencyStore(), report: r => reports.push(r), trace: r => rows.push(r) })
  }
  const trig: Trigger = { moduleId: 'stage.mod', eventId: 'e1', sessionId: 's1', evidence: [{ id: 'm1', kind: 'user-text', version: 'v1', text: 'x' }] }
  test('observe never runs jobs; shadow runs read-only jobs and withholds reports; active reports', async () => {
    let calls = 0; const h = { 'stage.mod.deliver': { run: () => { calls++; return { status: 'prepared' as const, report: { text: 'reminder' } } } } }
    for (const [stage, expectCalls, expectReports, reason] of [['observe', 0, 0, 'stage:observe'], ['shadow', 1, 0, 'stage:shadow-report-withheld'], ['active', 1, 1, 'ok']] as const) {
      calls = 0; const rows: any[] = [], reports: Report[] = []
      const o = await runtime(stage, [job()], h, rows, reports).onTrigger(trig)
      expect(calls).toBe(expectCalls); expect(reports).toHaveLength(expectReports); expect(o[0]!.reason).toBe(reason)
      expect(rows).toEqual([expect.objectContaining({ type: 'job', moduleId: 'stage.mod', stage, reason })])
      if (stage === 'shadow') expect((o[0] as any).withheldReport).toBe('reminder')
    }
  })
  test('shadow skips jobs that could cause effects', async () => {
    let calls = 0; const rows: any[] = []
    const o = await runtime('shadow', [job({ id: 'notify', riskTier: 'proposal', grants: { actions: ['rule.notice'], referenceKinds: [] } })], { 'stage.mod.notify': { run: () => { calls++; return { status: 'proposed' as const } } } }, rows, []).onTrigger(trig)
    expect(calls).toBe(0); expect(o[0]!.reason).toBe('stage:shadow-effects-withheld')
  })
})

describe('judgement trace (task154)', () => {
  test('file sink keeps data per module, bodies by hash, and prunes by age', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lh-trace-')); let t = Date.parse('2026-11-08T10:00:00Z')
    try {
      const { sink, stats } = createFileTraceSink(dir, { now: () => t })
      sink({ type: 'judgement', moduleIds: ['a.mod'], frameId: 'f1', bodies: [{ id: 'm1', text: 'PRIVATE TEXT' }] })
      sink({ type: 'job', moduleId: 'b.mod', reason: 'ok' })
      expect(stats.written).toBe(2); expect(readdirSync(dir).sort()).toEqual(['a.mod', 'b.mod'])
      const line = JSON.parse(readFileSync(join(dir, 'a.mod', 'traces-2026-11-08.jsonl'), 'utf8').trim())
      expect(line.schema).toBe('monitoring-trace/v1'); expect(JSON.stringify(line)).not.toContain('PRIVATE TEXT'); expect(line.bodies[0].sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(readFileSync(join(dir, 'a.mod', 'content', line.bodies[0].sha256 + '.json'), 'utf8')).toContain('PRIVATE TEXT')
      t = Date.parse('2026-12-01T10:00:00Z'); expect(pruneTraces(dir, 14, t)).toBeGreaterThan(0)
      expect(existsSync(join(dir, 'a.mod', 'traces-2026-11-08.jsonl'))).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  test('the pipeline traces what the judge saw, the decision and the delivery outcome', async () => {
    const f = fixture(), rows: any[] = []
    ;(f.host.backends as any).native = { ...f.host.backends.native, invoke: (request: any, context: any) => { f.calls.push({ request, context }); const out: any = outputFor(request); out.value.answers.decision_0.choice = 'run'; request.body.state.tasks[0].view.context.references.forEach((_r: any, j: number) => { out.value.answers[`ref_0_${j}`].probability = 0.95 }); return out } }
    const module: RealtimeWatchModule = { id: 'trace.mod', watchEvents: ['input'], referenceKinds: ['user-text'], grants: { referenceKinds: ['user-text'], actions: ['monitoring.selected-material'] }, question: q, destination: 'sink' }
    const set = createIndependentSelectionPipelines({ enabled: true, material: { allowedKinds: ['user-text'] }, selection: { modules: [module], goal: 'g', modelConfig: config(), modelHost: f.host, isPermitted: () => true, trace: r => rows.push(r) }, realtimeLimits: { jobTimeoutMs: 10000 } })
    const p = set.pipelines[0]!; p.window.start({ sessionId: 's', binding: 1 }); p.coordinator.start({ sessionId: 's', binding: 1 })
    const snapshot: ObservationSnapshot = { sessionId: 's', leafId: 'l1', branch: [], canonicalMessages: [], effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: 'h1', revision: 'r1', available: true, fullProviderContext: false, omitted: [] }
    const frame: ObservationFrame = { id: 'frame:1', cursor: 1, sourceEvent: 'input', kind: 'input', sessionId: 's', binding: 1, epoch: 1, payload: { text: 'please check' }, snapshot, available: true }
    try {
      p.window.capture(frame, 1); p.coordinator.accept(frame); await set.idle(); p.coordinator.takeReady('module')
      const judged = rows.find(r => r.type === 'judgement')
      expect(judged).toEqual(expect.objectContaining({ frameId: 'frame:1', moduleIds: ['trace.mod'] }))
      expect(judged.outcomes[0].mode).toBe('run'); expect(judged.input.materials[0].kind).toBe('user-text'); expect(judged.bodies[0].text).toBe('please check')
      expect(rows.filter(r => r.type === 'delivery').map(r => r.reason)).toEqual(expect.arrayContaining(['ready', 'offered']))
    } finally { set.dispose(); await set.idle() }
  })
})
