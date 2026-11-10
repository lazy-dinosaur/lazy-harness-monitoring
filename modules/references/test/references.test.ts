import { describe, expect, test } from 'bun:test'
import { canonicalJsonHash, prepareMonitoringBindings, type MonitoringConfiguration } from '@lazy-harness/monitoring-core'
import { watchModuleFromDeclaration, type Report, type RuntimeOptions } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createReferencesRegistration, createReferencesHandlers, referencesBinding, referencesDeclaration, referencesHandlers, referencesQuestion, referencesQuestionNarrow, REFERENCES_MODULE_ID } from '@lazy-harness/monitoring-module-references'
import { evidence, jobs, runtime, trigger } from './support.ts'

describe('references binding and gap-filler purpose', () => {
  test('public binding validates, hashes and maps onto the selection bridge', () => {
    expect(referencesBinding.declarationHash).toMatch(/^[a-f0-9]{64}$/)
    expect(referencesBinding.declarationHash).toBe(canonicalJsonHash(referencesDeclaration))
    expect(canonicalJsonHash({ ...referencesDeclaration, purpose: { question: referencesQuestionNarrow } })).not.toBe(referencesBinding.declarationHash)
    const watch = watchModuleFromDeclaration(REFERENCES_MODULE_ID, referencesDeclaration, referencesBinding.grants, referencesBinding.destination)
    expect(watch.includeCurrentMaterial).toBe(true)
    expect(watch.compactRegion).toBe(true)
    expect(watch.question).toEqual(referencesQuestion)
    expect(watch.watchEvents).toEqual(['input'])
    expect(referencesBinding.build({}).id).toBe(REFERENCES_MODULE_ID)
    expect(referencesBinding.build({}).question).toEqual(referencesQuestion)
    for (const bad of [null, [], { unknown: true }]) expect(() => referencesBinding.build(bad)).toThrow()
  })
  test('broad question is active, narrow text preserved separately, all texts within 200 chars', () => {
    expect(referencesDeclaration.purpose.question).toEqual(referencesQuestion)
    expect(referencesQuestion.instructions).toContain('Select EVERY visible record')
    expect(referencesQuestion.criteria.skip).toContain('plain command')
    expect(referencesQuestion.criteria.defer).toContain('no visible record covers it')
    expect(referencesQuestionNarrow.instructions).toBe('Should this turn read project evidence now? Judge each current request even if a different idea is postponed. Check whether the visible source bodies can actually support it.')
    expect(referencesQuestionNarrow.criteria.run).toContain('immediate, scoped request')
    for (const q of [referencesQuestion, referencesQuestionNarrow]) for (const text of [q.instructions, ...Object.values(q.criteria)]) expect(text.length).toBeLessThanOrEqual(200)
    expect(referencesDeclaration.needs).toContainEqual({ id: 'already-read', adapter: 'session.read-records' })
  })
  test('unsupported host events are rejected at startup; supported capabilities resolve', () => {
    const config: MonitoringConfiguration = { contractVersion: 1, source: { kind: 'host-events', scope: 'host-supplied-events' }, goal: 'Toy request', receiver: 'toy', judge: 'scripted', modules: [{ id: REFERENCES_MODULE_ID, version: referencesBinding.version, settings: {} }] }
    const host = { modules: { [REFERENCES_MODULE_ID]: referencesBinding }, judges: { scripted: async () => ({}) }, allowedSourceScopes: ['host-supplied-events'] as const, maxModules: 1, capabilities: { hostId: 'toy', version: '1', events: ['input'], actions: [] as const, snapshot: 'full' as const } }
    expect(prepareMonitoringBindings(config, host).processors[0].spec.id).toBe(REFERENCES_MODULE_ID)
    expect(() => prepareMonitoringBindings(config, { ...host, capabilities: { ...host.capabilities, events: [] } })).toThrow('unsupported event: input')
  })
})

describe('official references runtime registration', () => {
  test('default registration is observe: no jobs, effects or reports', async () => {
    const registration = createReferencesRegistration()
    expect(registration.stage).toBe('observe')
    expect(registration.moduleId).toBe(REFERENCES_MODULE_ID)
    expect(registration.declaration).toBe(referencesDeclaration)
    expect(registration.declarationHash).toBe(referencesBinding.declarationHash!)
    expect(registration.jobs).toEqual(jobs)
    expect(Object.isFrozen(registration)).toBe(true)
    let calls = 0
    const reports: Report[] = []
    const rt = runtime(undefined, r => { reports.push(r); return { reportId: canonicalJsonHash(r), status: 'enqueued' } }, {
      'context.references.deliver': { run(context) { calls++; return referencesHandlers['context.references.deliver'].run(context) } },
    })
    try {
      const outcomes = await rt.onTrigger(trigger)
      expect(outcomes).toEqual([{ moduleId: REFERENCES_MODULE_ID, jobId: 'deliver', eventId: trigger.eventId, status: 'skipped', reason: 'stage:observe', reported: false }])
      expect(calls).toBe(0)
      expect(outcomes.every(o => o.effectId === undefined)).toBe(true)
      expect(reports).toEqual([])
    } finally { await rt.idle(); rt.dispose() }
  })
  test('explicit active registration delivers the real template and matching report receipt', async () => {
    const registration = createReferencesRegistration({ stage: 'active' })
    expect(registration.stage).toBe('active')
    expect(registration.declarationHash).toBe(referencesBinding.declarationHash!)
    const reports: Report[] = []
    const rt = runtime({ stage: 'active' }, r => { reports.push(r); return { reportId: canonicalJsonHash(r), status: 'enqueued' } })
    try {
      const [outcome] = await rt.onTrigger({ ...trigger, evidence: [evidence[0]] })
      expect(outcome.status).toBe('prepared')
      expect(outcome.reported).toBe(true)
      expect(reports).toHaveLength(1)
      expect(reports[0].text).toBe('[근거 자료]\n- doc:lantern (v3): Lanterns use blue glass.\nKeep the lid closed.')
      expect(outcome.reportReceipt).toEqual({ reportId: canonicalJsonHash(reports[0]), status: 'enqueued' })
    } finally { await rt.idle(); rt.dispose() }
  })
  test('registration rejects stages above a tightened declaration ceiling and unknown stages', () => {
    for (const maxStage of ['observe', 'shadow'] as const) {
      const registration = createReferencesRegistration({ maxStage })
      expect(registration.stage).toBe('observe')
      expect(registration.declaration.maxStage).toBe(maxStage)
      expect(registration.declarationHash).toBe(canonicalJsonHash(registration.declaration))
      expect(registration.declarationHash).not.toBe(referencesBinding.declarationHash!)
      expect(() => createReferencesRegistration({ maxStage, stage: 'active' })).toThrow('Configuration may only lower the declared run stage')
    }
    expect(() => createReferencesRegistration({ maxStage: 'observe', stage: 'shadow' })).toThrow('Configuration may only lower the declared run stage')
    for (const stage of ['off', 'observe', 'shadow', 'active'] as const) expect(createReferencesRegistration({ stage }).stage).toBe(stage)
    expect(() => createReferencesRegistration({ stage: 'above-active' as 'active' })).toThrow('Unknown references run stage')
    expect(() => createReferencesRegistration({ maxStage: 'above-active' as 'active' })).toThrow('Unknown references declaration ceiling')
    expect(createReferencesRegistration().declaration).toBe(referencesDeclaration)
  })
})
describe('deterministic delivery through handler worker port', () => {
  test('quotes only selected knowledge verbatim with id/version; empty selection rejects', async () => {
    const reports: Report[] = [], rt = runtime({ stage: 'active' }, r => { reports.push(r); return { reportId: canonicalJsonHash(r), status: 'enqueued' } })
    try {
      const selected = { ...trigger, evidence: [{ id: 'current', kind: 'user-text', version: '1', text: 'Lantern question' }, evidence[0]] }
      expect((await rt.onTrigger(selected))[0].status).toBe('prepared')
      expect(reports[0].text).toBe('[근거 자료]\n- doc:lantern (v3): Lanterns use blue glass.\nKeep the lid closed.')
      expect((await rt.onTrigger({ ...selected, eventId: 'request-2', evidence: [selected.evidence[0]] }))[0].status).toBe('rejected')
      expect(reports).toHaveLength(1)
    } finally { await rt.idle(); rt.dispose() }
  })
  test('host ledger is session isolated, drops seen records and compaction reset restores eligibility', async () => {
    const ledgers = new Map([['toy-session', new Set(['doc:lantern'])]])
    const seen = createReferencesHandlers(t => new Set(ledgers.get(t.sessionId) ?? []))['context.references.deliver']
    const run = (sessionId = 'toy-session') => seen.run({ trigger: { ...trigger, sessionId }, job: jobs[0], signal: new AbortController().signal })
    const partial = await run()
    expect(partial.output).toEqual({ deliveredIds: ['doc:kite'], droppedAlreadyRead: ['doc:lantern'] })
    ledgers.get('toy-session')!.add('doc:kite')
    expect((await run()).status).toBe('rejected')
    expect((await run()).output).toEqual({ deliveredIds: [], droppedAlreadyRead: ['doc:lantern', 'doc:kite'] })
    expect((await run('other-toy-session')).status).toBe('prepared')
    // Host session_compact callback owns this reset, not a hidden module singleton.
    ledgers.delete('toy-session')
    expect((await run()).output).toEqual({ deliveredIds: ['doc:lantern', 'doc:kite'], droppedAlreadyRead: [] })
    expect((await referencesHandlers['context.references.deliver'].run({ trigger, job: jobs[0], signal: new AbortController().signal })).status).toBe('prepared')
  })
  test('only matching enqueue receipts count, no retry after a prepared result', async () => {
    const sinks: [RuntimeOptions['report'], 'enqueued' | 'failed' | 'unknown'][] = [
      [undefined, 'failed'], [r => ({ reportId: canonicalJsonHash(r), status: 'failed' }), 'failed'],
      [r => ({ reportId: canonicalJsonHash(r), status: 'unknown' }), 'unknown'],
      [() => ({ reportId: 'mismatch', status: 'enqueued' }), 'unknown'],
      [() => { throw Error('toy receiver failure') }, 'unknown'],
      [r => ({ reportId: canonicalJsonHash(r), status: 'enqueued' }), 'enqueued'],
    ]
    for (const [sink, status] of sinks) {
      const rt = runtime({ stage: 'active' }, sink)
      try {
        const out = (await rt.onTrigger(trigger))[0]
        expect(out.reportReceipt?.status).toBe(status)
        expect(out.reported).toBe(status === 'enqueued')
        expect((await rt.onTrigger(trigger))[0].reason).toBe('duplicate:prepared')
      } finally { await rt.idle(); rt.dispose() }
    }
  })
})
