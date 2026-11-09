import { describe, expect, test } from 'bun:test'
import { ApprovedBudgetGate, MemoryIdempotencyStore, MonitoringModuleRuntime, watchModuleFromDeclaration, type JobHandler, type Report, type Trigger } from '../src/engine/monitoring-engine-runtime.ts'
import { validateMonitoringModuleDeclaration, effectiveMonitoringJobs } from '../src/sdk/declaration.ts'

const grants = { actions: ['rule.notice', 'rule.record', 'kb.absorb'], referenceKinds: ['policy'] }
const q = { instructions: 'rule?', criteria: { run: 'r', skip: 's', defer: 'd' } }
const job = (over: any) => ({ id: 'notify', form: 'template', riskTier: 'proposal', report: { supported: ['never', 'always', 'on-result'], default: 'always' }, idempotency: 'per-event', output: 'candidate', grants: { actions: ['rule.notice'], referenceKinds: [] }, ...over })
function setup(jobs: any[], handlers: Record<string, JobHandler>, overrides?: any[], extra: any = {}) {
  const { declaration, hash } = validateMonitoringModuleDeclaration({ purpose: { question: q }, watch: { events: ['tool_call'], kinds: ['tool-call', 'policy'] }, jobs, ...extra }, grants)
  const eff = effectiveMonitoringJobs(declaration, overrides, '/m')!
  const budget = new ApprovedBudgetGate(), reports: Report[] = [], store = new MemoryIdempotencyStore()
  const rt = new MonitoringModuleRuntime({ modules: [{ moduleId: 'rules.steer', declaration, declarationHash: hash, jobs: eff }], handlers, budget, idempotency: store, report: r => reports.push(r) })
  return { rt, budget, reports, store, declaration }
}
const trig = (over: Partial<Trigger> = {}): Trigger => ({ moduleId: 'rules.steer', eventId: 'e1', sessionId: 's1', evidence: [{ id: 'm1', kind: 'tool-call', version: 'v1', text: 'edit a.ts' }], ...over })
const ok = (status: any, extra: any = {}): JobHandler => ({ run: () => ({ status, ...extra }) })

describe('S4 module runtime engine rules (CPU only)', () => {
  test('template job runs, report mode always delivers one report, outcome recorded', async () => {
    const f = setup([job({})], { 'rules.steer.notify': ok('proposed', { report: { text: '규칙 X 위반' } }) })
    const o = await f.rt.onTrigger(trig())
    expect(o).toEqual([expect.objectContaining({ status: 'proposed', reported: true })]); expect(f.reports.map(r => r.text)).toEqual(['규칙 X 위반'])
  })
  test('report modes: never stays silent; on-result reports only when the job returns a report', async () => {
    const f = setup([job({}), job({ id: 'record', report: { supported: ['never', 'on-result'], default: 'on-result' }, grants: { actions: ['rule.record'], referenceKinds: [] } })], { 'rules.steer.notify': ok('proposed', { report: { text: 'x' } }), 'rules.steer.record': ok('proposed') }, [{ id: 'notify', report: 'never' }])
    await f.rt.onTrigger(trig()); expect(f.reports).toHaveLength(0)
  })
  test('idempotency: the same event never runs a job twice; per-subject requires a subject key; module-ledger uses the handler key', async () => {
    let runs = 0
    const f = setup([job({}), job({ id: 'subj', idempotency: 'per-subject', grants: { actions: ['rule.notice'], referenceKinds: [] } }), job({ id: 'ledger', idempotency: 'module-ledger', grants: { actions: ['rule.record'], referenceKinds: [] } })], { 'rules.steer.notify': { run: () => { runs++; return { status: 'proposed' } } }, 'rules.steer.subj': ok('proposed'), 'rules.steer.ledger': { run: () => ({ status: 'proposed' }), idempotencyKey: t => `epoch-1:${t.eventId}` } })
    const first = await f.rt.onTrigger(trig()); const again = await f.rt.onTrigger(trig())
    expect(runs).toBe(1); expect(first.map(o => o.status)).toEqual(['proposed', 'skipped', 'proposed']); expect(first[1]!.reason).toBe('idempotency_key_missing:per-subject')
    expect(again.map(o => o.reason)).toEqual(['duplicate:proposed', 'idempotency_key_missing:per-subject', 'duplicate:proposed'])
  })
  test('loop guard: events produced by the same module never re-trigger it; depth bound for others', async () => {
    let runs = 0; const f = setup([job({})], { 'rules.steer.notify': { run: () => { runs++; return { status: 'proposed' } } } })
    expect((await f.rt.onTrigger(trig({ eventId: 'e2', origin: { moduleId: 'rules.steer', jobId: 'notify', depth: 0 } })))[0]!.reason).toBe('loop_guard')
    expect((await f.rt.onTrigger(trig({ eventId: 'e3', origin: { moduleId: 'other', jobId: 'j', depth: 1 } })))[0]!.reason).toBe('loop_guard')
    expect((await f.rt.onTrigger(trig({ eventId: 'e4', origin: { moduleId: 'other', jobId: 'j', depth: 0 } })))[0]!.status).toBe('proposed')
    expect(runs).toBe(1)
  })
  test('budget gate: a cost-declaring job never starts without approval; caps are reserved per run and enforced', async () => {
    let runs = 0
    const worker = job({ id: 'absorb', form: 'worker', riskTier: 'proposal', report: { supported: ['never'], default: 'never' }, grants: { actions: ['kb.absorb'], referenceKinds: [] }, cost: { models: [{ role: 'worker', profile: 'luna' }], caps: { workerDispatches: 2 } } })
    const f = setup([worker], { 'rules.steer.absorb': { run: ({ lease }) => { runs++; lease!.consume('workerDispatches', 1); return { status: 'proposed' } } } })
    expect((await f.rt.onTrigger(trig()))[0]!.reason).toBe('budget_not_approved'); expect(runs).toBe(0)
    f.budget.approve({ moduleId: 'rules.steer', caps: { workerDispatches: 2 }, approvedBy: 'user:test' })
    expect((await f.rt.onTrigger(trig({ eventId: 'e2' })))[0]!.status).toBe('proposed')
    expect(f.budget.usage('rules.steer')!.used.workerDispatches).toBe(1)
    expect((await f.rt.onTrigger(trig({ eventId: 'e3' })))[0]!.reason).toBe('budget_exhausted:workerDispatches')
    const g = setup([worker], { 'rules.steer.absorb': { run: ({ lease }) => { lease!.consume('workerDispatches', 3); return { status: 'proposed' } } } })
    g.budget.approve({ moduleId: 'rules.steer', caps: { workerDispatches: 10 }, approvedBy: 'user:test' })
    const o = (await g.rt.onTrigger(trig()))[0]!; expect(o.status).toBe('uncertain'); expect(o.reason).toBe('budget_per_run_exceeded:workerDispatches')
  })
  test('uncertain effect is terminal and never retried (throw, unknown, missing receipt)', async () => {
    let calls = 0
    const f = setup([job({ riskTier: 'automatic', grants: { actions: ['rule.notice'], referenceKinds: [] } })], { 'rules.steer.notify': { run: () => { calls++; if (calls === 1) throw new Error('network'); return { status: 'executed', effectId: 'fx' } } } }, undefined, { acceptance: { setRef: 'a.json' } })
    expect((await f.rt.onTrigger(trig()))[0]!.status).toBe('uncertain'); expect((await f.rt.onTrigger(trig()))[0]!.reason).toBe('duplicate:uncertain'); expect(calls).toBe(1)
    const g = setup([job({ riskTier: 'automatic', grants: { actions: ['rule.notice'], referenceKinds: [] } })], { 'rules.steer.notify': ok('executed') }, undefined, { acceptance: { setRef: 'a.json' } })
    expect((await g.rt.onTrigger(trig()))[0]!.reason).toBe('missing_effect_receipt')
    const h = setup([job({})], { 'rules.steer.notify': ok('unknown') }); expect((await h.rt.onTrigger(trig()))[0]!.status).toBe('uncertain')
  })
  test('risk tiers: proposal jobs cannot execute effects; read-only jobs cannot execute or propose; data tightening applies', async () => {
    expect((await setup([job({})], { 'rules.steer.notify': ok('executed', { effectId: 'fx' }) }).rt.onTrigger(trig()))[0]!.reason).toBe('tier_violation:proposal_executed')
    expect((await setup([job({ riskTier: 'read-only' })], { 'rules.steer.notify': ok('proposed') }).rt.onTrigger(trig()))[0]!.reason).toBe('tier_violation:read_only_proposed')
    expect((await setup([job({ riskTier: 'read-only' })], { 'rules.steer.notify': ok('prepared') }).rt.onTrigger(trig()))[0]!.status).toBe('prepared')
    const auto = job({ riskTier: 'automatic', grants: { actions: ['rule.notice'], referenceKinds: [] } })
    expect((await setup([auto], { 'rules.steer.notify': ok('executed', { effectId: 'fx' }) }, [{ id: 'notify', riskTier: 'proposal' }], { acceptance: { setRef: 'a.json' } }).rt.onTrigger(trig()))[0]!.reason).toBe('tier_violation:proposal_executed')
  })
  test('disabled jobs are skipped; missing handlers for enabled jobs fail at construction; declaration maps to a watch module', async () => {
    const f = setup([job({})], {}, [{ id: 'notify', enabled: false }])
    expect((await f.rt.onTrigger(trig()))[0]!.reason).toBe('job_disabled')
    expect(() => setup([job({})], {})).toThrow('missing job handler')
    const w = watchModuleFromDeclaration('rules.steer', f.declaration, grants, 'rules.local')
    expect(w).toMatchObject({ id: 'rules.steer', watchEvents: ['tool_call'], referenceKinds: ['tool-call', 'policy'], includeCurrentMaterial: true, question: q })
  })
})
