import { expect, test } from 'bun:test'
import { canonicalJsonHash, prepareMonitoringBindings, type MonitoringConfiguration } from '@lazy-harness/monitoring-core'
import { validateReviewCandidate, type ReviewSinkPort } from '@lazy-harness/monitoring-core/host'
import { ApprovedBudgetGate, MonitoringModuleRuntime } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createMemoryMonitor, createMemoryRegistration, memoryBinding, memoryDeclaration, MEMORY_MODULE_ID, parseMemoryInput, prepareMemoryCandidate } from '@lazy-harness/monitoring-module-memory'
import { frame, harness, input } from './support.ts'

function preflight(sink?: ReviewSinkPort, events = ['message_end', 'turn_end', 'input']) {
  const config: MonitoringConfiguration = { contractVersion: 1, source: { kind: 'host-events', scope: 'host-supplied-events' }, goal: 'Invented', receiver: 'toy', judge: 'scripted', modules: [{ id: MEMORY_MODULE_ID, version: memoryBinding.version, settings: {} }] }
  return prepareMonitoringBindings(config, { modules: { [MEMORY_MODULE_ID]: memoryBinding }, allowedSourceScopes: ['host-supplied-events'], maxModules: 1, capabilities: { hostId: 'toy', version: '1', events, actions: [], snapshot: 'full' }, judges: { scripted: async () => ({}) }, ...(sink ? { inputPorts: { [MEMORY_MODULE_ID]: { 'review-sink': { adapter: 'memory.review-sink', protocolVersion: 1, port: sink } } } } : {}) })
}
test('public binding/registration defaults observe, ceiling shadow, no costs/actions or report route', () => {
  expect(createMemoryRegistration().stage).toBe('observe')
  expect(memoryDeclaration.maxStage).toBe('shadow')
  expect(memoryDeclaration.watch.events).toEqual(['user.message', 'assistant.message', 'turn.end', 'user.steer'])
  expect(memoryDeclaration.jobs[0]).toMatchObject({ form: 'template', riskTier: 'read-only', idempotency: 'per-subject', report: { supported: ['never'], default: 'never' }, grants: { actions: [] } })
  expect(memoryDeclaration.jobs[0].cost).toBeUndefined()
  expect(memoryBinding.declarationHash).toBe(canonicalJsonHash(memoryDeclaration))
  expect(() => createMemoryRegistration({ stage: 'active' })).toThrow('active')
  expect(() => createMemoryRegistration({ stage: 'shadow' })).toThrow('required input port')
  expect(() => createMemoryRegistration({ stage: 'shadow', reviewSink: { protocolVersion: 2 } as unknown as ReviewSinkPort })).toThrow()
  expect(() => preflight()).toThrow('required input port')
  const h = harness()
  try { expect(preflight(h.sink.port).processors[0].stage).toBe('observe'); expect(() => preflight(h.sink.port, ['input'])).toThrow('unsupported event') } finally { h.close() }
})
test('observe does not capture source, dispatch jobs, reserve keys, or prepare/deliver candidates', async () => {
  const h = harness({ stage: 'observe' })
  try { expect(await h.monitor.onOpportunity(frame(), 'run')).toEqual({ mode: 'run', reason: 'stage:observe', prepared: false }); expect(h.captures()).toBe(0); expect(h.sink.inspect()).toEqual([]); expect(h.monitor.getStatus()).toMatchObject({ keys: 0, bodies: 0 }) } finally { h.close() }
})
test('shadow exact-span candidate is immutable, scoped, unapproved and accepted only in private fake sink', async () => {
  const h = harness()
  try {
    const r = await h.monitor.onOpportunity(frame(), 'run')
    expect(r).toMatchObject({ mode: 'run', prepared: true, receipt: { status: 'accepted-volatile' } })
    const [c] = h.sink.inspect()
    expect(validateReviewCandidate(c)).toEqual(c)
    expect(c.claim.text).toBe(input().evidence[0].text)
    expect(c).toMatchObject({ status: 'review-only', notApproved: true, notWritten: true, project: input().project, scope: input().context.scope, provenanceState: 'checked', contested: false, missingEvidence: [] })
    expect(c.evidenceRefs[0]).toMatchObject({ documentVersion: '1', sourceEventId: 'original-decision', attestationId: 'toy-attestation', span: 'utf16:0:28', actor: 'user', role: 'supporting' })
    expect(Object.isFrozen(c.claim)).toBe(true)
    expect('confidence' in c).toBe(false)
    expect(r.receipt?.candidateId).toBe(c.candidateId)
  } finally { h.close() }
})
test('runtime observe never invokes handler; shadow never invokes parent even for a supplied report', async () => {
  for (const stage of ['observe', 'shadow'] as const) {
    const h = harness(), reports: unknown[] = []; let calls = 0
    const rt = new MonitoringModuleRuntime({ modules: [createMemoryRegistration({ stage, reviewSink: h.sink.port })], budget: new ApprovedBudgetGate(), handlers: { [`${MEMORY_MODULE_ID}.prepare-candidate`]: { async run() { calls++; return { status: 'prepared', report: { text: 'Not for parent' } } } } }, report(r) { reports.push(r); throw Error('must never report') } })
    try { await rt.onTrigger({ moduleId: MEMORY_MODULE_ID, eventId: 'toy', sessionId: 'toy-memory', subjectKey: 'toy-revision', evidence: [] }); expect(calls).toBe(stage === 'observe' ? 0 : 1); expect(reports).toEqual([]); expect(rt.outcomes.every(o => !o.reported)).toBe(true) } finally { rt.dispose(); await rt.idle(); h.close() }
  }
})
test('unchanged finalized/turn-end duplicate suppresses; changed revision links predecessor, conflict defers', async () => {
  const h = harness()
  try {
    await h.monitor.onOpportunity(frame(), 'run')
    const [first] = h.sink.inspect()
    h.set(input(3)); expect(await h.monitor.onOpportunity(frame(3, 'turn_end'), 'run')).toMatchObject({ mode: 'skip', reason: 'unchanged-duplicate' })
    h.set(input(4, '2', 'Lantern lids use green glass.'))
    expect((await h.monitor.onOpportunity(frame(4), 'run')).prepared).toBe(true)
    const second = h.sink.inspect()[1]
    expect(second.candidateId).not.toBe(first.candidateId); expect(second.predecessorCandidateId).toBe(first.candidateId)
    h.set({ ...input(5, '3'), conflict: true })
    expect((await h.monitor.onOpportunity(frame(5), 'run')).mode).toBe('defer'); expect(h.sink.inspect()).toHaveLength(2)
  } finally { h.close() }
})
test('changed bytes under the same source version cannot become a linked candidate', async () => {
  const h = harness()
  try { await h.monitor.onOpportunity(frame(), 'run'); h.set(input(3, '1', 'Lantern lids use gold glass.')); expect(await h.monitor.onOpportunity(frame(3), 'run')).toMatchObject({ mode: 'defer', reason: 'source-identity-mutation' }); expect(h.sink.inspect()).toHaveLength(1) } finally { h.close() }
})
for (const mode of ['skip', 'defer'] as const) test(`typed ${mode} never captures or prepares`, async () => {
  const h = harness(); try { expect((await h.monitor.onOpportunity(frame(), mode)).mode).toBe(mode); expect(h.captures()).toBe(0); expect(h.sink.inspect()).toEqual([]) } finally { h.close() }
})
for (const bad of ['unresolved', 'assistant-only', 'partial', 'denied', 'prior-candidate', 'conflict', 'unavailable', 'future-cursor'] as const) test(`${bad} evidence defers despite run judgement`, async () => {
  const h = harness(), s = structuredClone(input()), e = s.evidence[0] as { -readonly [K in keyof typeof s.evidence[number]]: typeof s.evidence[number][K] }
  if (bad === 'unresolved') e.attribution = 'unresolved'
  if (bad === 'assistant-only') e.actor = 'assistant'
  if (bad === 'partial') e.complete = false
  if (bad === 'denied') e.permitted = false
  if (bad === 'prior-candidate') e.kind = 'prior-candidate'
  if (bad === 'conflict') (s as { conflict: boolean }).conflict = true
  if (bad === 'unavailable') (s.context as { available: boolean }).available = false
  if (bad === 'future-cursor') e.cursor = 99
  h.set(s)
  try { expect((await h.monitor.onOpportunity(frame(), 'run')).mode).toBe('defer'); expect(h.sink.inspect()).toEqual([]); expect(h.monitor.getStatus().keys).toBe(0) } finally { h.close() }
})
test('trusted approved-record is explicit authority, not a policy kind alone', () => {
  const s = input(), e = { ...s.evidence[0], actor: 'authority' as const, kind: 'project-policy' as const, attribution: 'approved-record' as const }
  expect(prepareMemoryCandidate({ ...s, evidence: [e] }).claim.text).toBe(e.text)
  expect(() => prepareMemoryCandidate({ ...s, evidence: [{ ...e, attribution: 'unresolved' }] })).toThrow()
})
for (const field of ['frameId', 'frameCursor', 'snapshotRevision', 'sessionId', 'bindingGeneration'] as const) test(`wrong ${field} sidecar defers`, async () => {
  const h = harness(), s = structuredClone(input())
  if (field === 'sessionId') (s.context.scope as { sessionId: string }).sessionId = 'other'
  else if (field === 'bindingGeneration') (s.context.scope as { bindingGeneration: number }).bindingGeneration = 9
  else if (field === 'frameCursor') (s as { frameCursor: number }).frameCursor = 9
  else (s as unknown as Record<string, unknown>)[field] = 'other'
  h.set(s); try { expect((await h.monitor.onOpportunity(frame(), 'run')).reason).toBe('frame-source-mismatch'); expect(h.sink.inspect()).toEqual([]) } finally { h.close() }
})
for (const mutation of ['extra', 'span', 'missing-subject', 'duplicate', 'accessor'] as const) test(`strict sidecar rejects ${mutation}`, () => {
  const s = structuredClone(input()) as unknown as Record<string, unknown>; let touched = false
  if (mutation === 'extra') s.extra = true
  if (mutation === 'span') (s.evidence as Record<string, unknown>[])[0].end = 999
  if (mutation === 'missing-subject') delete s.subjectKey
  if (mutation === 'duplicate') (s.evidence as unknown[]).push(structuredClone((s.evidence as unknown[])[0]))
  if (mutation === 'accessor') Object.defineProperty(s, 'subjectKey', { enumerable: true, get() { touched = true; throw Error('must not execute') } })
  expect(() => parseMemoryInput(s)).toThrow(); expect(touched).toBe(false)
})
for (const mutation of ['unknown-field', 'negative-cursor', 'wrong-session', 'accessor'] as const) test(`malformed ${mutation} frame rejected before source access`, async () => {
  const h = harness(), f = structuredClone(frame()) as unknown as Record<string, unknown>; let touched = false
  if (mutation === 'unknown-field') f.extra = true
  if (mutation === 'negative-cursor') f.cursor = -1
  if (mutation === 'wrong-session') (f.snapshot as Record<string, unknown>).sessionId = 'other'
  if (mutation === 'accessor') Object.defineProperty(f, 'payload', { enumerable: true, get() { touched = true; throw Error('must not execute') } })
  try { expect((await h.monitor.onOpportunity(f, 'run')).reason).toBe('malformed-frame-or-judgement'); expect(touched).toBe(false); expect(h.captures()).toBe(0) } finally { h.close() }
})
test('pure worker exact span cannot paraphrase or retain unselected context', () => {
  const s = input(), text = 'Context. Lantern lids use blue glass. Tail.'
  const c = prepareMemoryCandidate({ ...s, evidence: [{ ...s.evidence[0], text, start: 9, end: 37 }] })
  expect(c.claim.text).toBe('Lantern lids use blue glass.'); expect(JSON.stringify(c)).not.toContain('Tail.')
  expect(() => validateReviewCandidate({ ...c, confidence: 1 })).toThrow()
})
