import { expect, test } from 'bun:test'
import { canonicalJsonHash, decodeMonitoringJudgements, effectiveMonitoringStage, monitoringJudgeRequest, prepareMonitoringBindings, type JudgeTask, type MonitoringConfiguration } from '@lazy-harness/monitoring-core'
import { watchModuleFromDeclaration, type BudgetLease } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createRuleSteeringHandlers, createRuleSteeringRegistration, policyReferences, ruleSteeringBinding, ruleSteeringDeclaration, ruleSteeringHandlers, ruleSteeringQuestion, ruleSteeringVerifyQuestion, ruleVerificationTask } from '@lazy-harness/monitoring-module-rule-steering'
import { confirmed, decision, jobs, lease, refs, registry, runtime, trigger, view } from './support.ts'

const handler = (verify = confirmed, max?: number) => createRuleSteeringHandlers(verify, max)['rules.steer.remind']
const run = (h = handler(), t = trigger(), l: BudgetLease = lease(), signal = new AbortController().signal) => h.run({ trigger: t, job: jobs[0], lease: l, signal })

test('public binding, declaration, hashes and empty settings; default/ceiling are observe-only', async () => {
  expect(ruleSteeringBinding.declarationHash).toBe(canonicalJsonHash(ruleSteeringDeclaration))
  expect(ruleSteeringBinding.build({}).id).toBe('rules.steer')
  for (const bad of [null, [], { registryPath: 'implicit' }]) expect(() => ruleSteeringBinding.build(bad)).toThrow()
  expect(createRuleSteeringRegistration().stage).toBe('observe')
  expect(effectiveMonitoringStage(ruleSteeringDeclaration, undefined, '/stage')).toBe('observe')
  expect(() => effectiveMonitoringStage(ruleSteeringDeclaration, 'active', '/stage')).toThrow()
  const watch = watchModuleFromDeclaration('rules.steer', ruleSteeringDeclaration, ruleSteeringBinding.grants, ruleSteeringBinding.destination)
  expect(watch.watchEvents).toEqual(['tool_call', 'message_end']); expect(watch.includeJudgeView).toBe(true)
  expect(ruleSteeringDeclaration.jobs[0].form).toBe('jev-select'); expect(ruleSteeringDeclaration.jobs[0].cost?.caps.judgeCalls).toBe(8)
  expect('verify' in ruleSteeringDeclaration.purpose).toBe(false)
  for (const q of [ruleSteeringQuestion, ruleSteeringVerifyQuestion]) for (const s of [q.instructions, ...Object.values(q.criteria)]) expect(s.length).toBeLessThanOrEqual(200)
  for (const s of [ruleSteeringQuestion.reference.instructions, ...Object.values(ruleSteeringQuestion.reference.criteria)]) expect(s.length).toBeLessThanOrEqual(200)
  const { rt } = runtime({ approved: 8 }); try { expect((await rt.onTrigger(trigger()))[0].reason).toBe('stage:observe') } finally { await rt.idle(); rt.dispose() }
})

test('versioned explicit invented registry preserves scope/exceptions and hashes all deciding text', () => {
  expect(refs).toEqual(policyReferences(registry)); expect(refs[0].content).toContain('Exception: Red glass')
  expect(refs[0].content).toContain('Scope: Lantern assembly'); expect(refs[0].content).toContain('registry toy-workshop v3; rule v2')
  for (const update of [{ ...registry, version: '4' }, { ...registry, policies: [{ ...registry.policies[0], exceptions: ['No exception.'] }] }]) expect(policyReferences(update)[0].version).not.toBe(refs[0].version)
  for (const bad of [undefined, {}, { ...registry, version: '' }, { ...registry, policies: [registry.policies[0], registry.policies[0]] }, { ...registry, extra: true }, { ...registry, policies: [{ ...registry.policies[0], version: '' }] }]) expect(() => policyReferences(bad as typeof registry)).toThrow()
})

test('unsupported host capabilities fail at startup; supported named triggers resolve', () => {
  const config: MonitoringConfiguration = { contractVersion: 1, source: { kind: 'host-events', scope: 'host-supplied-events' }, goal: 'Toy rules', receiver: 'toy', judge: 'scripted', modules: [{ id: 'rules.steer', version: ruleSteeringBinding.version, settings: {} }] }
  const host = { modules: { 'rules.steer': ruleSteeringBinding }, judges: { scripted: async () => ({}) }, allowedSourceScopes: ['host-supplied-events'] as const, maxModules: 1, internalActions: ['monitoring.rule-reminder'], capabilities: { hostId: 'toy', version: '1', events: ['tool_call', 'message_end'], actions: [] as const, snapshot: 'full' as const } }
  expect(prepareMonitoringBindings(config, host).processors[0].spec.id).toBe('rules.steer')
  expect(prepareMonitoringBindings(config, host).processors[0].stage).toBe('observe')
  expect(() => prepareMonitoringBindings(config, { ...host, internalActions: [] })).toThrow('unsupported action')
  expect(() => prepareMonitoringBindings(config, { ...host, capabilities: { ...host.capabilities, events: [] } })).toThrow('unsupported event')
})

test('module reference questions override generic selection; verification requests ask only one decision', () => {
  const task: JudgeTask = { processorId: 'rules.steer', question: ruleSteeringQuestion, view: view() }
  const req = monitoringJudgeRequest([task], 'native-classifier').body as { questions: Record<string, { instructions: string; criteria: unknown }> }
  expect(req.questions.ref_0_2.instructions).toContain(`Item ${refs[0].id}:`)
  expect(req.questions.ref_0_2.instructions).toContain('the CURRENT event itself breaks it')
  expect(req.questions.ref_0_2.criteria).toEqual(ruleSteeringQuestion.reference.criteria)
  const { reference: _ignored, ...plain } = ruleSteeringQuestion
  const generic = monitoringJudgeRequest([{ ...task, question: plain }], 'native-classifier').body as typeof req
  expect(generic.questions.ref_0_2.instructions).toContain('needed for this task')
  const verification = ruleVerificationTask(view(), refs[0].id)
  expect(Object.keys((monitoringJudgeRequest([verification], 'native-classifier').body as typeof req).questions)).toEqual(['decision_0'])
  const profile = { kind: 'native-classifier', referenceThreshold: 0.5 } as Parameters<typeof decodeMonitoringJudgements>[1]
  const out = decodeMonitoringJudgements([verification], profile, { stopReason: 'stop', answers: { decision_0: { type: 'choice', choice: 'run', confidence: 1 } } })
  expect(out['rules.steer'].evidenceRefs).toEqual(['event:event-1'])
})

test('verification task keeps exact current IDs/context, one rule only and no per-item questions', () => {
  const v = view(), task = ruleVerificationTask(v, refs[0].id)
  expect(task.question.selectReferences).toBe(false)
  expect(task.view.event.payload).toEqual({ sourceEvent: 'tool_call', currentReferenceIds: ['cur'], verifyReferenceId: refs[0].id })
  expect(task.view.context.references.map(r => r.id)).toEqual(['old', 'cur', refs[0].id])
  expect(task.view.context.references[2].content).toContain('Exception:')
  expect(v.context.references).toHaveLength(4)
  expect(() => ruleVerificationTask({ ...v, eventRef: 'wrong' }, refs[0].id)).toThrow()
  expect(() => ruleVerificationTask(v, 'policy:absent')).toThrow()
})

for (const [current, mode, status] of [
  ['assemble lantern with red glass', 'run', 'prepared'],
  ['festival: assemble lantern with red glass', 'skip', 'rejected'],
  ['assemble lantern with $GLASS', 'defer', 'rejected'],
  ['assemble lantern with blue glass', 'skip', 'rejected'],
] as const) test(`current-only scripted ${mode}: ${current}`, async () => {
  // This oracle is hand-scripted, not a semantic-quality assertion about any model.
  const h = handler(async task => {
    expect(task.question).toMatchObject(ruleSteeringVerifyQuestion)
    expect(task.view.context.references.find(r => r.id === 'cur')?.content).toBe(current)
    expect(task.view.context.references.find(r => r.kind === 'policy')?.content).toContain('Exception:')
    return decision(mode)
  })
  const t = trigger([refs[0]]), result = await run(h, { ...t, view: view([refs[0]], current) })
  expect(result.status).toBe(status)
  if (status === 'prepared') { expect(result.report?.text).toContain(current); expect(result.report?.text).not.toContain('earlier unrelated action') }
  expect(ruleSteeringVerifyQuestion.criteria.defer).toContain('value not shown')
})

test('multi-rule verifier confirms each alone, failed/undefined/skip/defer outputs drop closed', async () => {
  const seen: JudgeTask[] = [], l = lease()
  const result = await run(handler(async t => { seen.push(t); if ((t.view.event.payload as { verifyReferenceId: string }).verifyReferenceId === refs[1].id) throw Error('stub failed'); return decision() }), trigger(), l)
  expect(result.status).toBe('prepared'); expect(result.output).toEqual({ confirmedRuleIds: [refs[0].id] }); expect(l.used()).toBe(2)
  expect(seen).toHaveLength(2); expect(seen.every(t => t.view.context.references.filter(r => r.kind === 'policy').length === 1)).toBe(true)
  for (const value of [undefined, decision('skip'), decision('defer')]) expect((await run(handler(async () => value))).status).toBe('rejected')
})

test('eight selected rules cost eight calls; nine selected rules explicitly fail without truncation or calls', async () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ ...refs[0], id: `policy:toy-${i}` })); let calls = 0
  const verify = async () => { calls++; return decision() }
  const l = lease(); expect((await run(handler(verify), trigger(many.slice(0, 8)), l)).status).toBe('prepared'); expect(calls).toBe(8); expect(l.used()).toBe(8)
  const result = await run(handler(verify), trigger(many)); expect(result).toMatchObject({ status: 'rejected', output: { reason: 'verifier_cap_exceeded' } }); expect(calls).toBe(8)
})

test('per-session/turn/rule ledger handles overlapping selections and bounded saturation', async () => {
  const h = handler()
  expect((await run(h, trigger([refs[0]]))).status).toBe('prepared')
  expect((await run(h)).output).toEqual({ confirmedRuleIds: [refs[1].id] })
  expect((await run(h)).output).toMatchObject({ reason: 'duplicate_rules' })
  expect((await run(h, trigger(refs, 2))).status).toBe('prepared')
  expect((await run(h, trigger(refs, 1, 'other-toy-session'))).status).toBe('prepared')
  const bounded = handler(confirmed, 1)
  expect((await run(bounded, trigger([refs[0]]))).status).toBe('prepared')
  expect((await run(bounded, trigger([refs[1]]))).output).toMatchObject({ reason: 'rule_ledger_capacity' })
})

test('in-flight overlap cannot remind the same rule twice; cancellation drops late success', async () => {
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { entered = r })
  const controller = new AbortController(), h = handler(async () => { entered(); await gate; return decision() })
  const pending = run(h, trigger([refs[0]]), lease(), controller.signal); await started
  expect((await run(h, trigger([refs[0]]))).output).toMatchObject({ reason: 'duplicate_rules' })
  controller.abort(); release(); expect((await pending).output).toMatchObject({ reason: 'verification_cancelled' })
})

test('missing turn/view/verifier/budget and selected-source mismatch all fail closed', async () => {
  const t = trigger()
  expect((await run(handler(), { ...t, turn: undefined })).output).toMatchObject({ reason: 'turn_missing' })
  expect((await run(handler(), { ...t, view: undefined })).status).toBe('rejected')
  expect((await run(ruleSteeringHandlers['rules.steer.remind'])).status).toBe('rejected')
  expect((await handler().run({ trigger: t, job: jobs[0], signal: new AbortController().signal })).status).toBe('rejected')
  expect((await run(handler(), { ...t, evidence: t.evidence.map(e => e.kind === 'policy' ? { ...e, version: 'tampered' } : e) })).output).toMatchObject({ reason: 'invalid_judge_view' })
  const { rt } = runtime({ stage: 'shadow', approved: 8 }); try { expect((await rt.onTrigger({ ...t, turn: undefined }))[0].reason).toBe('idempotency_key_missing:module-ledger') } finally { await rt.idle(); rt.dispose() }
})

test('budget preflight fails before any calls; runtime approval requires full declared cap', async () => {
  let calls = 0
  const h = handler(async () => { calls++; return decision() })
  expect((await run(h, trigger(), lease(1))).output).toMatchObject({ reason: 'verifier_budget_exhausted' }); expect(calls).toBe(0)
  const badLease = { consume() { throw Error('revoked'); }, remaining: () => 8 }
  expect((await run(h, trigger(), badLease)).status).toBe('rejected'); expect(calls).toBe(0)
  for (const approved of [undefined, 7]) {
    const { rt } = runtime({ stage: 'shadow', approved, verify: async () => { calls++; return decision() } })
    try { expect((await rt.onTrigger(trigger()))[0].reason).toBe(approved ? 'budget_exhausted:judgeCalls' : 'budget_not_approved') } finally { await rt.idle(); rt.dispose() }
  }
  expect(calls).toBe(0)
})
