import { expect, test } from 'bun:test'
import { createInMemoryReadRecordPort, syntheticInputPortContext, syntheticReadRecord, type InputPortContext } from '@lazy-harness/monitoring-core/host'
import { createReferencesRegistration } from '@lazy-harness/monitoring-module-references'
import { ApprovedBudgetGate, MonitoringModuleRuntime, type Trigger, type Report } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createHandlerWorkerPort } from '@lazy-harness/monitoring-core'

const trigger: Trigger = { moduleId: 'context.references', sessionId: 'synthetic-session', eventId: 'trigger-event', evidence: [{ id: 'synthetic-doc', kind: 'knowledge', version: 'v1', text: 'Synthetic lantern evidence.' }] }
function setup(beforeSnapshot?: () => Promise<void>) {
  let context: InputPortContext = syntheticInputPortContext()
  const fake = createInMemoryReadRecordPort({ context: () => context, beforeSnapshot })
  const registration = createReferencesRegistration({ stage: 'active', readRecords: { port: fake.port, request(t, signal) { return { protocolVersion: 1, scope: context.scope, sourceEventId: t.eventId, cursor: 10, sourceRevision: context.sourceRevision, grantRevision: context.grantRevision, documents: t.evidence.filter(e => e.kind === 'knowledge').map(e => ({ documentId: e.id, documentVersion: e.version })), signal } } } })
  const run = (t = trigger) => registration.handlers['context.references.deliver'].run({ trigger: t, job: registration.jobs[0], signal: new AbortController().signal })
  return { fake, registration, run, change(next: InputPortContext) { context = next } }
}
test('official registration accepts either legacy callback or exact-version read records; default unchanged', async () => {
  const x = setup()
  expect(x.fake.record(syntheticReadRecord())).toBe(true)
  expect((await x.run()).status).toBe('rejected')
  expect((await x.run({ ...trigger, evidence: [{ ...trigger.evidence[0], version: 'v2' }] })).status).toBe('prepared')
  const legacy = createReferencesRegistration({ alreadyRead: () => new Set(['synthetic-doc']) })
  expect(legacy.stage).toBe('observe')
  const job = legacy.jobs[0], signal = new AbortController().signal
  expect((await legacy.handlers['context.references.deliver'].run({ trigger: { ...trigger, evidence: [{ ...trigger.evidence[0], version: 'v2' }] }, job, signal })).status).toBe('rejected')
  expect((await createReferencesRegistration().handlers['context.references.deliver'].run({ trigger, job, signal })).status).toBe('prepared')
  expect(() => createReferencesRegistration({ alreadyRead: () => new Set(), readRecords: { port: x.fake.port, request: () => { throw Error('unused') } } })).toThrow('OR')
  x.fake.close()
})
test('unavailable and incomplete versioned snapshots defer with no stateless fallback', async () => {
  const x = setup()
  for (const change of [{ available: false }, { completeThroughCursor: 1 }, { grantRevision: 'grant-2', available: false }]) {
    x.change({ ...syntheticInputPortContext(), ...change })
    const result = await x.run(); expect(result.status).toBe('rejected'); expect(result.report).toBeUndefined()
  }
  x.fake.close()
})
test('compaction/session/branch resets allow delivery again and reject late reads', async () => {
  const x = setup(), old = syntheticReadRecord()
  expect(x.fake.record(old)).toBe(true)
  for (const scope of [{ ...old.scope, compactionGeneration: 1 }, { ...old.scope, branchGeneration: 2 }, { ...old.scope, bindingGeneration: 2 }]) {
    x.change({ ...syntheticInputPortContext(), scope })
    expect((await x.run()).status).toBe('prepared')
    expect(x.fake.record(old)).toBe(false)
  }
  x.fake.close()
})
test('delayed versioned response after compaction produces no report', async () => {
  let release!: () => void
  const gate = new Promise<void>(r => { release = r }), x = setup(() => gate)
  const pending = x.run()
  x.change({ ...syntheticInputPortContext(), scope: { ...syntheticInputPortContext().scope, compactionGeneration: 1 } })
  release(); const result = await pending
  expect(result.status).toBe('rejected'); expect(result.report).toBeUndefined(); x.fake.close()
})
test('official versioned registration and its handlers run through neutral worker port', async () => {
  const x = setup(), reports: Report[] = []
  const budget = new ApprovedBudgetGate() // Deterministic references job declares no model cost.
  const runtime = new MonitoringModuleRuntime({ modules: [x.registration], handlers: x.registration.handlers, workerPort: createHandlerWorkerPort(x.registration.handlers), budget, report(r) { reports.push(r); return { reportId: 'synthetic-receipt', status: 'enqueued' } } })
  try { expect((await runtime.onTrigger(trigger))[0].status).toBe('prepared'); expect(reports).toHaveLength(1) } finally { await runtime.idle(); runtime.dispose(); x.fake.close() }
})
