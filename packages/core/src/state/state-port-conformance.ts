import { effectiveMonitoringJobs, validateMonitoringModuleDeclaration } from '../sdk/declaration.ts'
import { ApprovedBudgetGate, MonitoringModuleRuntime, monitoringReportId, type JobHandler, type Trigger } from '../engine/monitoring-engine-runtime.ts'
import { ContextCarryMailbox, type CarryItem } from '../engine/monitoring-core-context-mailbox.ts'
import { openMonitoringState, type MonitoringStateSession, type StateBinding, type StateLimits, type StatePersistencePort, type StateSnapshot } from './state-persistence.ts'

/** Same caseId reopens the same backing; different cases must be isolated. Only invented fixture data. */
export type StatePortFactory = (caseId: string, binding: StateBinding, limits?: Partial<StateLimits>) => StatePersistencePort
export async function runStatePortConformance(makePort: StatePortFactory): Promise<Readonly<{ checks: readonly string[] }>> {
  const checks: string[] = []
  const check = (ok: unknown, name: string) => { if (!ok) throw Error(`state-port conformance: ${name}`); checks.push(name) }
  const throws = (f: () => unknown, name: string) => { let failed = false; try { f() } catch { failed = true }; check(failed, name) }
  const rejects = async (p: Promise<unknown>, name: string) => { let failed = false; try { await p } catch { failed = true }; check(failed, name) }
  const bounded = async <T>(p: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('state conformance deadline')), 2000) })]) } finally { clearTimeout(timer) }
  }
  const { declaration, hash } = validateMonitoringModuleDeclaration({ purpose: { question: { instructions: 'Synthetic state mechanics', criteria: { run: 'yes', skip: 'no', defer: 'unknown' } } }, watch: { events: ['tool.after'], kinds: ['tool-result'] }, jobs: [{ id: 'job', form: 'template', riskTier: 'read-only', idempotency: 'per-event', output: 'candidate', report: { supported: ['always'], default: 'always' }, grants: { actions: [], referenceKinds: [] } }] }, { actions: [], referenceKinds: [] })
  const binding: StateBinding = { bindingId: 'synthetic-binding', moduleId: 'fixture', declarationHash: hash, configHash: 'config:v1', modelFingerprint: 'synthetic:none', scope: { sessionId: 'session', branchId: 'branch', bindingGeneration: 1, branchGeneration: 1, compactionGeneration: 1 } }
  const modules = [{ moduleId: 'fixture', declaration, declarationHash: hash, jobs: effectiveMonitoringJobs(declaration, undefined, '/fixture')!, stage: 'active' as const }]
  const trigger = (eventId: string): Trigger => ({ moduleId: 'fixture', sessionId: 'session', eventId, evidence: [] })
  const runtime = (state: MonitoringStateSession, run: JobHandler['run'], report?: (r: Parameters<typeof monitoringReportId>[0]) => ReturnType<NonNullable<ConstructorParameters<typeof MonitoringModuleRuntime>[0]['report']>>) => new MonitoringModuleRuntime({ modules, handlers: { 'fixture.job': { run } }, budget: new ApprovedBudgetGate(), state, maxActive: 1, maxQueued: 1, jobTimeoutMs: 1000, ...(report ? { report } : {}) })
  const item = (id: string): CarryItem => ({ id, reportId: `report:${id}`, moduleId: 'fixture', scope: { sessionId: 'session', branchId: 'branch', turn: 1 }, createdAt: 10, dependencies: [{ id: 'source', version: '1' }], text: 'Synthetic prepared material' })
  const mailbox = (state: MonitoringStateSession, sourceVersion = () => '1') => new ContextCarryMailbox({ state, sourceVersion, maxAgeMs: 100, maxCarryTurns: 1, maxItems: 8, maxTextBytes: 1024 })
  {
    let calls = 0, reports = 0
    let state = openMonitoringState(makePort('restart', binding), binding)
    let r = runtime(state, () => { calls++; return { status: 'prepared' } }, report => { reports++; return { reportId: monitoringReportId(report), status: 'enqueued' } })
    const first = await bounded(r.onTrigger(trigger('one'))); await bounded(r.idle()); r.dispose()
    check(first[0]?.status === 'prepared' && state.view().work[0]?.outcome?.status === 'prepared', 'terminal outcome committed')
    state = openMonitoringState(makePort('restart', binding), binding)
    r = runtime(state, () => { calls++; return { status: 'prepared' } })
    check((await bounded(r.onTrigger(trigger('one'))))[0]?.reason === 'duplicate:prepared' && calls === 1 && reports === 1, 'new runtime suppresses duplicate and report after restart')
    check(state.view().work[0]?.report?.receipt === 'enqueued', 'enqueue receipt survives separately from delivery')
    r.dispose()
  }
  {
    const state = openMonitoringState(makePort('crash', binding), binding)
    let release!: () => void, calls = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    const old = runtime(state, async () => { calls++; await gate; return { status: 'prepared' } })
    // Observe old promises immediately: a superseded owner is expected to reject, not mutate recovery.
    const active = old.onTrigger(trigger('active')).catch(() => undefined)
    const queued = old.onTrigger(trigger('queued')).catch(() => undefined)
    check(state.view().work.map(w => w.status).join(',') === 'started,queued', 'dispatch intent distinguishes local queued work')
    const recovered = openMonitoringState(makePort('crash', binding), binding)
    const r = runtime(recovered, () => { calls++; return { status: 'prepared' } })
    check((await bounded(r.onTrigger(trigger('active'))))[0]?.reason === 'duplicate:uncertain', 'crash mid-execution becomes uncertain and never retried')
    check((await bounded(r.onTrigger(trigger('queued'))))[0]?.reason === 'duplicate:rejected', 'queued unstarted work dropped without replay')
    check((await bounded(r.onTrigger(trigger('new'))))[0]?.reason === 'persistence_unresolved_work', 'unresolved old raw attempt blocks fresh dispatch')
    throws(() => state.assertCurrent(), 'new owner fences old owner')
    release(); await bounded(Promise.all([active, queued])); await bounded(old.idle())
    check(calls === 1 && recovered.view().work[0]?.status === 'uncertain' && !recovered.view().work[0]?.rawSettled, 'late old worker and queued closure cannot overwrite recovered ledger')
    old.dispose(); r.dispose()
  }
  {
    let s = openMonitoringState(makePort('mail', binding), binding), box = mailbox(s)
    check(box.put(item('pending'), 10), 'mailbox enqueue committed')
    s = openMonitoringState(makePort('mail', binding), binding); box = mailbox(s)
    check(box.pending === 1 && box.take(item('pending').scope, 11, true).length === 1 && s.view().mailbox[0]?.status === 'delivery-uncertain', 'mailbox recovers pending and fences delivery before exposure')
    s = openMonitoringState(makePort('mail', binding), binding); box = mailbox(s)
    check(box.take(item('pending').scope, 12, true).length === 0 && !box.put(item('pending'), 12), 'lost delivery receipt never auto-injects twice')
    s.acknowledgeDelivery('pending', 'synthetic-host-receipt')
    s = openMonitoringState(makePort('mail', binding), binding)
    check(s.view().mailbox[0]?.receipt === 'synthetic-host-receipt' && s.view().mailbox[0]?.status === 'delivered', 'delivery acknowledgement survives restart')
    box = mailbox(s); box.put(item('stale'), 12)
    const changed = { ...binding, scope: { ...binding.scope, compactionGeneration: 2 } }
    s = openMonitoringState(makePort('mail', changed), changed); box = mailbox(s)
    check(box.pending === 0 && s.view().mailbox.find(m => m.id === 'stale')?.status === 'dropped' && !box.put(item('stale'), 13), 'stale generation dropped with seen tombstone retained')
  }
  {
    let s = openMonitoringState(makePort('sources', binding), binding)
    mailbox(s).put(item('changed'), 10)
    s = openMonitoringState(makePort('sources', binding), binding)
    check(mailbox(s, () => '2').take(item('changed').scope, 11, true).length === 0 && s.view().mailbox[0]?.status === 'dropped', 'recovered mailbox revalidates source versions')
    mailbox(s).put(item('expired'), 10)
    check(mailbox(s).take(item('expired').scope, 111, true).length === 0, 'recovered mailbox expires stale advice')
    throws(() => openMonitoringState(makePort('sources', binding), { ...binding, configHash: 'changed' }), 'changed authority refuses recovery')
  }
  {
    const p = makePort('validation', binding), s = openMonitoringState(p, binding), snapshot = s.view()
    throws(() => p.commit(snapshot.revision, { ...snapshot, revision: snapshot.revision + 1, schemaVersion: 2 } as unknown as StateSnapshot), 'unknown schema commit rejected')
    throws(() => p.commit(snapshot.revision, { ...snapshot, revision: snapshot.revision + 1, work: [{}] } as unknown as StateSnapshot), 'corrupt state commit rejected')
    throws(() => openMonitoringState({ ...p, read: () => ({ ...snapshot, schemaVersion: 2 }) as unknown as StateSnapshot }, binding), 'unknown stored schema rejected')
    throws(() => openMonitoringState({ ...p, read: () => ({ ...snapshot, mailbox: [{}] }) as unknown as StateSnapshot }, binding), 'corrupt stored state rejected')
    throws(() => p.commit(undefined, { ...snapshot, revision: snapshot.revision + 1 }), 'stale revision CAS rejected')
    check(p.read()?.revision === snapshot.revision, 'invalid commits preserve last good snapshot')
  }
  {
    const p = makePort('bound', binding, { maxMailbox: 1, maxWork: 1 }), s = openMonitoringState(p, binding)
    s.enqueue(item('one'))
    throws(() => s.enqueue(item('two')), 'mailbox bound refuses without tombstone eviction')
    check(openMonitoringState(makePort('bound', binding, { maxMailbox: 1, maxWork: 1 }), binding).view().mailbox.length === 1, 'bounded protection survives refusal and reopen')
    const r = runtime(openMonitoringState(makePort('bound', binding, { maxMailbox: 1, maxWork: 1 }), binding), () => ({ status: 'prepared' }))
    await bounded(r.onTrigger(trigger('one'))); await bounded(r.idle())
    await rejects(r.onTrigger(trigger('two')), 'work bound refuses new dispatch')
    r.dispose()
  }
  {
    const p = makePort('retry', binding), s = openMonitoringState(p, binding), initial = s.view()
    s.enqueue(item('protected'))
    const snapshot = s.view()
    check(p.commit(initial.revision, snapshot).revision === snapshot.revision, 'identical revision and bytes retry returns same receipt')
    throws(() => p.commit(initial.revision, { ...snapshot, fence: snapshot.fence + 1 }), 'changed bytes on same commit revision refused')
    throws(() => p.commit(snapshot.revision, { ...snapshot, revision: snapshot.revision + 1, mailbox: [] }), 'protection tombstones cannot be pruned')
  }
  {
    const p = makePort('cost', binding), s = openMonitoringState(p, binding)
    const work = { key: 'cost:one', moduleId: 'fixture', jobId: 'job', eventId: 'cost-event', stage: 'active' as const, dependencies: [], grantHash: 'grants', cost: { approvalId: 'synthetic-approval', windowKey: 'fixture', caps: { workerDispatches: 1 }, approvedCaps: { workerDispatches: 1 } } }
    s.admit(work); s.put(work.key, 'rejected')
    const recovered = openMonitoringState(makePort('cost', binding), binding)
    throws(() => recovered.admit({ ...work, key: 'cost:two' }), 'restart cannot mint another approved cost window')
    const current = openMonitoringState(makePort('cost', binding), binding)
    check(current.view().work[0]?.cost?.caps.workerDispatches === 1, 'full cost reservation retained even for dropped work')
  }
  {
    const p = makePort('bytes', binding, { maxBytes: 2048 }), s = openMonitoringState(p, binding)
    throws(() => s.enqueue({ ...item('oversize'), text: 'x'.repeat(3000) }), 'snapshot byte capacity refuses oversized replay material')
    check(openMonitoringState(makePort('bytes', binding, { maxBytes: 2048 }), binding).view().mailbox.length === 0, 'byte overflow leaves last committed protection unchanged')
  }
  for (const afterCommit of [false, true]) {
    const id = afterCommit ? 'lost-ack' : 'failed-write', p = makePort(id, binding)
    let armed = false
    const faulty: StatePersistencePort = { ...p, commit(expected, next) { if (!armed) return p.commit(expected, next); if (afterCommit) p.commit(expected, next); throw Error('synthetic unknown write') } }
    const s = openMonitoringState(faulty, binding); armed = true
    let calls = 0
    const r = runtime(s, () => { calls++; return { status: 'prepared' } })
    await rejects(r.onTrigger(trigger('one')), `${id}: admission uncertainty refuses dispatch`)
    throws(() => s.assertCurrent(), `${id}: failed session cannot fall back to empty memory`)
    const recovered = openMonitoringState(makePort(id, binding), binding)
    check(calls === 0 && recovered.view().work.length === (afterCommit ? 1 : 0), `${id}: reopen reconciles committed snapshot`)
    r.dispose()
  }
  return Object.freeze({ checks: Object.freeze(checks) })
}
