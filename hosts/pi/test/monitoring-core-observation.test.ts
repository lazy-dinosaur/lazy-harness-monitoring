import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { MonitoringObservationBridge, type BridgeOptions, type MaterialEnvelope, type MaterialReceiver } from '@lazy-harness/monitoring-core/engine/monitoring-core-observation.ts'
import { createAuditObserver, createContextReferences, createKnowledgeCandidate } from './support/pending-fixtures.ts'
import type { JudgeTask, Processor } from '@lazy-harness/monitoring-core/engine/monitoring-core.ts'
import { PiMonitoringObserver, type ObservationFrame, type ObservationSnapshot } from '../src/index.ts'
import { clone, sdkFixture as createSdkFixture } from './support/pending-fixtures.ts'
import { deferred } from './support/real-sdk.ts'
const sdkEntry = import.meta.resolve('@earendil-works/pi-coding-agent')

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const reference = { id: 'synthetic-allowed', kind: 'knowledge', version: 'revision-7', content: 'EXACT_SELECTED_SYNTHETIC_BODY' }
const references = [reference, { id: 'synthetic-not-selected', kind: 'knowledge', version: 'revision-8', content: 'UNSELECTED_BODY_MUST_NOT_DELIVER' }, { id: 'restricted-reference', kind: 'restricted', version: 'revision-9', content: 'RESTRICTED_BODY_MUST_NOT_LEAK' }]
const assistant: Processor = { id: 'assistant.material', eventKinds: ['assistant.message'], referenceKinds: [], allowedActions: ['assistant.material'], run: ({ view }) => [{ kind: 'assistant.material', payload: view.event.payload, evidenceRefs: [view.eventRef] }] }
function setup(overrides: Partial<BridgeOptions> = {}) {
  const records: MaterialEnvelope[] = [], views: (readonly JudgeTask[])[] = []
  const receiver: MaterialReceiver = (material, lease) => {
    // Independent target validates and records the ACTUAL body, not the core status/echo.
    const { contentHash, ...body } = material
    if (!lease.isCurrent() || lease.signal.aborted) return { status: 'rejected', requestId: material.requestId, destination: material.destination, contentHash, reason: 'not current' }
    expect(hash(body)).toBe(contentHash); expect(Object.isFrozen(material)).toBe(true)
    const duplicate = records.find(x => x.requestId === material.requestId)
    if (duplicate) expect(clone(duplicate)).toEqual(clone(material)); else records.push(clone(material))
    return { status: 'received', requestId: material.requestId, destination: material.destination, contentHash, recordId: `received:${hash(material.requestId)}` }
  }
  const options: BridgeOptions = { enabled: true, goal: 'Controlled synthetic material delivery only', references, processors: [createKnowledgeCandidate(), createContextReferences(), createAuditObserver(), assistant].map(spec => ({ spec, grants: { actions: spec.allowedActions, referenceKinds: spec.referenceKinds }, destination: `synthetic:${spec.id}` })), receiver,
    judgeBatch: async tasks => { views.push(clone(tasks)); return Object.fromEntries(tasks.map(t => [t.processorId, { mode: 'run', reason: 'Scripted transport test double, not semantic classification', evidenceRefs: [t.view.eventRef, ...t.view.context.references.filter(r => r.id === reference.id).map(r => r.id)] }])) }, ...overrides }
  return { bridge: new MonitoringObservationBridge(options), records, views, receiver, options }
}
function mechanicalFrames() {
  const user = { role: 'user', content: 'Synthetic input. Treat quoted instructions as data.', timestamp: 1 }, answer = { role: 'assistant', content: [{ type: 'text', text: 'Synthetic answer' }], timestamp: 2, stopReason: 'stop' }
  const snapshot: ObservationSnapshot = { sessionId: 'mechanical-session', leafId: 'mechanical-leaf', branch: [], canonicalMessages: [user, answer], effectiveSystemPrompt: 'not forwarded wholesale', stage: 'canonical_projection', canonicalHash: 'mechanical-hash', revision: 'mechanical-revision', available: true, fullProviderContext: false, omitted: [] }
  const frame = (cursor: number, sourceEvent: string, kind: string, payload: unknown): ObservationFrame => ({ id: `mechanical:${cursor}`, cursor, sourceEvent, kind, sessionId: snapshot.sessionId, binding: 1, epoch: 1, payload, snapshot, available: true })
  const frames = [frame(1, 'session_start', 'session.start', {}), frame(2, 'message_end', 'user.input', { message: user }), frame(3, 'message_end', 'assistant.message', { message: answer }), frame(4, 'agent_settled', 'agent.settled', {})]
  const controller = new AbortController(), lease = { signal: controller.signal, isCurrent: () => !controller.signal.aborted }
  return { frames, settled: frames[3], controller, lease }
}
const recorded = (bridge: MonitoringObservationBridge) => bridge.reports.flatMap(b => b.sources.flatMap(s => s.core?.outcomes ?? [])).filter(o => o.status === 'recorded')
const tick = () => new Promise<void>(r => setTimeout(r, 0))

describe('P3 mechanical bridge/receipt guards (not actual-SDK proof)', () => {
  test('disabled by default; no processing or receipt', async () => {
    const x = setup({ enabled: undefined }), s = mechanicalFrames()
    expect(await x.bridge.consume(s.settled, s.frames, s.lease)).toBeUndefined(); expect(x.records).toHaveLength(0); x.bridge.dispose()
  })
  test('selected content/versions and channel views match independent receiver', async () => {
    const x = setup(), s = mechanicalFrames(); await x.bridge.consume(s.settled, s.frames, s.lease)
    expect(x.records).toHaveLength(4)
    const material = x.records.find(m => m.processorId === 'context.references')!
    expect((material.payload as any).references).toEqual([{ id: reference.id, version: reference.version, content: reference.content }])
    expect(material.source.observationId).toBe(s.frames[1].id); expect(material.source.snapshotRevision).toBe(s.settled.snapshot.revision)
    expect(JSON.stringify(x.records)).not.toContain('UNSELECTED_BODY_MUST_NOT_DELIVER'); expect(JSON.stringify(x.records)).not.toContain('RESTRICTED_BODY_MUST_NOT_LEAK')
    expect(JSON.stringify(x.views)).not.toContain('RESTRICTED_BODY_MUST_NOT_LEAK')
    expect(JSON.stringify(x.records)).not.toContain('not forwarded wholesale')
    const candidate = x.records.find(m => m.processorId === 'knowledge.candidate')!
    expect(candidate.evidenceRefs).toEqual([`event:${s.frames[1].id}`]); expect((candidate.payload as any).quote).toBe((s.frames[1].payload as any).message.content)
    expect(Object.isFrozen(x.bridge.reports[0].sources)).toBe(true); x.bridge.dispose()
  })
  for (const mode of ['skip', 'defer'] as const) test(`scripted ${mode} never sends semantic proposals`, async () => {
    const x = setup({ judgeBatch: async tasks => Object.fromEntries(tasks.map(t => [t.processorId, { mode, reason: 'Scripted mode only', evidenceRefs: [t.view.eventRef] }])) }), s = mechanicalFrames()
    await x.bridge.consume(s.settled, s.frames, s.lease)
    expect(x.records.map(m => m.processorId).sort()).toEqual(['assistant.material', 'audit.observation'])
    expect(x.bridge.reports[0].sources[0].core?.outcomes.filter(o => o.status === (mode === 'skip' ? 'skipped' : 'deferred'))).toHaveLength(2); x.bridge.dispose()
  })
  for (const bad of ['requestId', 'destination', 'contentHash', 'recordId', 'rejected', 'missing'] as const) test(`wrong receiver ${bad} cannot count as recorded`, async () => {
    let attempts = 0
    const x = setup({ receiver: m => { attempts++; if (bad === 'missing') return undefined as any; return { status: bad === 'rejected' ? 'rejected' : 'received', requestId: bad === 'requestId' ? 'wrong' : m.requestId, destination: bad === 'destination' ? 'wrong' : m.destination, contentHash: bad === 'contentHash' ? 'wrong' : m.contentHash, ...(bad !== 'recordId' ? { recordId: 'actual-target-record' } : {}) } } }), s = mechanicalFrames()
    await x.bridge.consume(s.settled, s.frames, s.lease)
    expect(attempts).toBe(4); expect(recorded(x.bridge)).toHaveLength(0)
    expect(x.bridge.reports[0].sources.flatMap(s => s.core?.outcomes ?? []).every(o => o.status === 'unverified')).toBe(true); x.bridge.dispose()
  })
  test('duplicate settlement has no repeat effects; conflicting reuse is visible', async () => {
    const x = setup(), s = mechanicalFrames(); await x.bridge.consume(s.settled, s.frames, s.lease)
    expect((await x.bridge.consume(s.settled, s.frames, s.lease))?.status).toBe('duplicate'); expect(x.records).toHaveLength(4)
    const conflict = { ...s.settled, payload: { changed: true } }
    expect((await x.bridge.consume(conflict, [...s.frames.slice(0, -1), conflict], s.lease))?.reason).toContain('identity conflict'); expect(x.records).toHaveLength(4); x.bridge.dispose()
  })
  test('gapped/reordered bounded history is explicit deferred, never silent partial context', async () => {
    for (const history of [mechanicalFrames().frames.slice(1), [mechanicalFrames().frames[1], mechanicalFrames().frames[0], ...mechanicalFrames().frames.slice(2)]]) {
      const x = setup(), s = mechanicalFrames(), r = await x.bridge.consume(s.settled, history, s.lease)
      expect(r?.status).toBe('deferred'); expect(r?.reason).toContain('gap/order'); expect(x.records).toHaveLength(0); x.bridge.dispose()
    }
  })
  test('projection edit/superseded binding are deferred rather than replayed in new context', async () => {
    for (const change of ['projection', 'binding'] as const) {
      const x = setup(), s = mechanicalFrames()
      if (change === 'projection') s.frames[3] = { ...s.settled, snapshot: { ...s.settled.snapshot, canonicalMessages: [s.settled.snapshot.canonicalMessages[1]] } }
      else s.frames[1] = { ...s.frames[1], binding: 2 }
      const r = await x.bridge.consume(s.frames[3], s.frames, s.lease)
      expect(r?.sources[0].status).toBe('deferred'); expect(x.records.map(m => m.processorId)).toEqual(['assistant.material']); x.bridge.dispose()
    }
  })
  test('unavailable settlement and source-count/material-byte budgets do not leak partial data', async () => {
    for (const variant of ['unavailable', 'source-limit', 'material-limit'] as const) {
      let calls = 0
      const x = setup({ receiver: m => { calls++; return { status: 'received', requestId: m.requestId, destination: m.destination, contentHash: m.contentHash, recordId: 'record' } }, limits: variant === 'source-limit' ? { maxSources: 1 } : variant === 'material-limit' ? { maxMaterialBytes: 1 } : {} }), s = mechanicalFrames()
      if (variant === 'unavailable') s.frames[3] = { ...s.settled, available: false }
      await x.bridge.consume(s.frames[3], s.frames, s.lease); expect(calls).toBe(0); expect(recorded(x.bridge)).toHaveLength(0); x.bridge.dispose()
    }
  })
  test('cancelled/uncooperative receiver retains core physical slot and has no late recorded ack', async () => {
    const entered = deferred(), release = deferred()
    const x = setup({ receiver: async m => { entered.resolve(); await release.promise; return { status: 'received', requestId: m.requestId, destination: m.destination, contentHash: m.contentHash, recordId: 'too-late' } }, coreLimits: { maxConcurrent: 1 } }), s = mechanicalFrames()
    const pending = x.bridge.consume(s.settled, s.frames, s.lease); await entered.promise; s.controller.abort('superseded'); await pending
    expect(x.bridge.getStatus().core.active).toBe(1); expect(recorded(x.bridge)).toHaveLength(0)
    release.resolve(); await tick(); expect(x.bridge.getStatus().core.active).toBe(0); expect(recorded(x.bridge)).toHaveLength(0); x.bridge.dispose()
  })
  test('one module failure leaves other receiver results intact', async () => {
    const initial = setup(), s = mechanicalFrames()
    const failing: Processor = { id: 'failing.module', eventKinds: ['user.input'], referenceKinds: [], allowedActions: [], run: () => { throw new Error('synthetic-module-error') } }
    const x = setup({ processors: [...initial.options.processors, { spec: failing, grants: { referenceKinds: [], actions: [] }, destination: 'synthetic:failed' }] }); initial.bridge.dispose()
    await x.bridge.consume(s.settled, s.frames, s.lease); expect(x.records).toHaveLength(4)
    expect(x.bridge.reports[0].sources[0].core?.outcomes.find(o => o.processorId === failing.id)?.status).toBe('failed'); x.bridge.dispose()
  })
  test('lifetime budget and disposal are explicit; counters do not reset', async () => {
    const x = setup({ limits: { maxBatches: 1 } }), s = mechanicalFrames(); await x.bridge.consume(s.settled, s.frames, s.lease)
    const next = { ...s.settled, id: 'next-settlement', cursor: 5 }
    expect((await x.bridge.consume(next, [...s.frames, next], s.lease))?.reason).toContain('lifetime budget')
    x.bridge.dispose(); expect((await x.bridge.consume(next, [...s.frames, next], s.lease))?.reason).toBe('bridge disposed')
  })
  test('reference/frame limits are bounded before copying or accepting input', async () => {
    expect(() => setup({ limits: { maxReferences: 1 } })).toThrow('reference input limit')
    expect(() => setup({ limits: { maxReferenceBytes: 1 } })).toThrow('reference input limit')
    expect(() => setup({ limits: { maxFrames: 0 } })).toThrow('invalid bridge limits')
    const x = setup({ limits: { maxFrames: 1 } }), s = mechanicalFrames()
    expect((await x.bridge.consume(s.settled, s.frames, s.lease))?.reason).toBe('frame input limit; not scanned'); expect(x.bridge.getStatus().scannedCursor).toBe(0); x.bridge.dispose()
  })
  test('logical receiver timeout is not a delivery and preserves physical concurrency', async () => {
    const entered = deferred(), release = deferred()
    const x = setup({ coreLimits: { timeoutMs: 10, maxConcurrent: 1 }, receiver: async m => { entered.resolve(); await release.promise; return { status: 'received', requestId: m.requestId, destination: m.destination, contentHash: m.contentHash, recordId: 'late-timeout' } } }), s = mechanicalFrames()
    const result = x.bridge.consume(s.settled, s.frames, s.lease); await entered.promise; await result
    expect(recorded(x.bridge)).toHaveLength(0); expect(x.bridge.getStatus().core.active).toBe(1)
    release.resolve(); await tick(); expect(x.bridge.getStatus().core.active).toBe(0); expect(recorded(x.bridge)).toHaveLength(0); x.bridge.dispose()
  })
})

const actual = describe
const proofs: any[] = []
let networkAttempts = 0
actual('P3 ACTUAL SDK settled source→core→independent receiver', () => {
  let oldFetch: typeof fetch
  beforeAll(() => { oldFetch = globalThis.fetch; globalThis.fetch = Object.assign(async () => { networkAttempts++; throw new Error('network forbidden in synthetic P3') }, oldFetch) as typeof fetch })
  afterAll(() => { globalThis.fetch = oldFetch; expect(networkAttempts).toBe(0); if (process.env.PI_MONITORING_P3_REPORT) writeFileSync(process.env.PI_MONITORING_P3_REPORT, JSON.stringify({ schema: 'monitoring-p3-synthetic/v1', sdkEntry, networkAttempts, liveHostActivated: false, realTranscriptCollected: false, semanticClassifierQualified: false, proofs }, null, 2) + '\n') })
  async function fixture(overrides: Partial<BridgeOptions> = {}, sdkOptions: { persistentLifecycle?: boolean; toolThrows?: boolean } = {}, observerLimits: any = {}) {
    const x = setup(overrides)
    const observer: PiMonitoringObserver = new PiMonitoringObserver((frame, lease) => x.bridge.consume(frame, observer.frames, lease), { workerTimeoutMs: 5000, ...observerLimits })
    const f = await createSdkFixture({ observer, toolThrows: sdkOptions.toolThrows })
    return { ...x, f, async dispose() { await f.dispose(); x.bridge.dispose() } }
  }
  function assertSources(x: Awaited<ReturnType<typeof fixture>>) {
    x.f.assertReconciled()
    const sources = x.f.observer.frames.filter(f => f.sourceEvent === 'message_end' && ['user.input', 'assistant.message', 'tool.result'].includes(f.kind))
    const reports = x.bridge.reports.flatMap(b => b.sources)
    expect(reports.map(r => r.observationId)).toEqual(sources.map(s => s.id))
    for (const received of x.records) {
      const source = sources.find(f => f.id === received.source.observationId)!
      expect(source).toBeDefined(); expect(received.source.cursor).toBe(source.cursor); expect(received.source.sessionId).toBe(source.sessionId)
      if (received.processorId === 'knowledge.candidate') {
        const content = (source.payload as any).message.content
        expect((received.payload as any).quote).toBe(typeof content === 'string' ? content : content.map((b: any) => b.text).join('\n'))
      }
      if (received.processorId === 'context.references') expect((received.payload as any).references).toEqual([{ id: reference.id, version: reference.version, content: reference.content }])
    }
    expect(JSON.stringify(x.records)).not.toContain('UNSELECTED_BODY_MUST_NOT_DELIVER'); expect(JSON.stringify(x.records)).not.toContain('RESTRICTED_BODY_MUST_NOT_LEAK')
  }
  test('real pre-persist source survives stale diagnostic jobs and exact selected material is received', async () => {
    const x = await fixture()
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage('actual-synthetic-answer')]); await x.f.session.prompt('actual-synthetic-user'); await x.f.observer.idle()
      assertSources(x); expect(x.records).toHaveLength(4); expect(recorded(x.bridge)).toHaveLength(4)
      expect(x.bridge.reports[0].sources.every(s => s.status === 'processed')).toBe(true)
      expect(x.f.observer.outcomes.some(o => o.status === 'stale' || o.status === 'cancelled')).toBe(true)
      proofs.push({ case: 'actual-source-selection-target-body', sdkVersion: x.f.sdkVersion, sourceCount: x.bridge.reports[0].sources.length, received: x.records.length })
    } finally { await x.dispose() }
  }, 20000)
  test('real tool streams/error are each routed once with native source links', async () => {
    const x = await fixture({}, { toolThrows: true })
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage(x.f.ai.fauxToolCall('synthetic', { value: 3 }, { id: 'actual-p3-tool' }), { stopReason: 'toolUse' }), x.f.ai.fauxAssistantMessage('error-handled')])
      await x.f.session.prompt('synthetic-tool-request'); await x.f.observer.idle(); assertSources(x)
      const toolSources = x.bridge.reports.flatMap(b => b.sources).filter(s => s.kind === 'tool.result')
      expect(toolSources).toHaveLength(1)
      const actualSource = x.f.observer.frames.find(f => f.id === toolSources[0].observationId)!
      expect((actualSource.payload as any).message.toolCallId).toBe('actual-p3-tool'); expect((actualSource.payload as any).message.isError).toBe(true)
      expect(x.records.filter(m => m.source.observationId === actualSource.id)).toHaveLength(1)
      proofs.push({ case: 'actual-tool-error-one-canonical-delivery', sdkVersion: x.f.sdkVersion, nativeToolCallId: 'actual-p3-tool', received: x.records.length })
    } finally { await x.dispose() }
  }, 20000)
  test('real queued steer inputs remain distinct and ordered through final settlement', async () => {
    const entered = deferred(), release = deferred(), x = await fixture()
    try {
      x.f.setSteps([async () => { entered.resolve(); await release.promise; return x.f.ai.fauxAssistantMessage('first-answer') }, x.f.ai.fauxAssistantMessage('steered-answer')])
      const running = x.f.session.prompt('first-source'); await entered.promise; await x.f.session.steer('second-source'); release.resolve(); await running; await x.f.observer.idle()
      assertSources(x)
      const quotes = x.records.filter(m => m.processorId === 'knowledge.candidate').map(m => (m.payload as any).quote)
      expect(quotes).toEqual(['first-source', 'second-source'])
      proofs.push({ case: 'actual-steer-source-order', sdkVersion: x.f.sdkVersion, quotes, received: x.records.length })
    } finally { release.resolve(); await x.dispose() }
  }, 20000)
  test('real receiver mismatch is not recorded even though target physically observed material', async () => {
    const observed: MaterialEnvelope[] = []
    const x = await fixture({ receiver: m => { observed.push(clone(m)); return { status: 'received', requestId: m.requestId, destination: m.destination, contentHash: 'incorrect-target-hash', recordId: 'target-saw-body' } } })
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage('ack-case')]); await x.f.session.prompt('ack-input'); await x.f.observer.idle(); assertSources(x)
      expect(observed).toHaveLength(4); expect(recorded(x.bridge)).toHaveLength(0)
      proofs.push({ case: 'actual-target-ack-mismatch-unverified', sdkVersion: x.f.sdkVersion, attemptedReceipts: observed.length, recorded: 0 })
    } finally { await x.dispose() }
  }, 20000)
  test('real bounded ring overflow is visible defer with zero partial delivery', async () => {
    const x = await fixture({}, {}, { maxRetained: 4 })
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage('ring-many-stream-chunks')]); await x.f.session.prompt('ring-input'); await x.f.observer.idle()
      expect(x.f.observer.getStatus().evicted).toBeGreaterThan(0); expect(x.bridge.reports[0].reason).toContain('gap/order'); expect(x.records).toHaveLength(0)
      proofs.push({ case: 'actual-ring-gap-deferred', sdkVersion: x.f.sdkVersion, evicted: x.f.observer.getStatus().evicted, received: 0 })
    } finally { await x.dispose() }
  }, 20000)
  test('real session replacement cancels old receiver without blocking new foreground work', async () => {
    const entered = deferred(), release = deferred(); let calls = 0
    const base = setup()
    const x = await fixture({ coreLimits: { maxConcurrent: 1 }, receiver: async (m, lease) => { if (++calls === 1) { entered.resolve(); await release.promise } return base.receiver(m, lease) } }, {})
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage('old-answer')]); await x.f.session.prompt('old-input'); await entered.promise
      const oldId = x.f.session.sessionManager.getSessionId(); await x.f.runtime.newSession()
      x.f.setSteps([x.f.ai.fauxAssistantMessage('new-answer')]); await x.f.session.prompt('new-input')
      expect(x.f.session.messages.at(-1)).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'new-answer' }] })
      release.resolve(); await x.f.observer.idle()
      expect(base.records.length).toBeGreaterThan(0); expect(base.records.every(m => m.source.sessionId !== oldId)).toBe(true)
      expect(x.bridge.reports.some(b => b.status === 'stale')).toBe(true); x.f.assertReconciled()
      proofs.push({ case: 'actual-replacement-stale-receiver-foreground', sdkVersion: x.f.sdkVersion, oldReceipts: 0, newReceipts: base.records.length })
    } finally { release.resolve(); await x.dispose(); base.bridge.dispose() }
  }, 20000)
  for (const transition of ['tree', 'compact'] as const) test(`real ${transition} invalidates in-flight target and refreshes next batch`, async () => {
    const entered = deferred(), release = deferred(); let block = false, blocked = false
    const base = setup(), x = await fixture({ receiver: async (m, lease) => { if (block && !blocked) { blocked = true; entered.resolve(); await release.promise } return base.receiver(m, lease) } })
    try {
      if (transition === 'compact') { x.f.setSteps([x.f.ai.fauxAssistantMessage('compaction-seed-answer')]); await x.f.session.prompt('compaction-seed-input'); await x.f.observer.idle(); base.records.length = 0 }
      block = true
      x.f.setSteps([x.f.ai.fauxAssistantMessage('before-transition-answer')]); await x.f.session.prompt('before-transition-input ' + 'synthetic padding '.repeat(80)); await entered.promise
      const oldSettlement = x.bridge.getStatus().scannedCursor
      if (transition === 'tree') {
        const user = x.f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'user')
        expect(user).toBeDefined(); await x.f.session.navigateTree(user!.id, { summarize: false })
      } else { x.f.setSteps([x.f.ai.fauxAssistantMessage('P3_SYNTHETIC_COMPACTION')]); await x.f.session.compact() }
      release.resolve(); await x.f.observer.idle(); expect(base.records).toHaveLength(0)
      x.f.setSteps([x.f.ai.fauxAssistantMessage('after-transition-answer')]); await x.f.session.prompt('after-transition-input'); await x.f.observer.idle()
      expect(base.records.length).toBeGreaterThan(0); expect(base.records.every(m => m.source.cursor > oldSettlement)).toBe(true); x.f.assertReconciled()
      proofs.push({ case: `actual-${transition}-inflight-lease`, sdkVersion: x.f.sdkVersion, oldReceipts: 0, newReceipts: base.records.length })
    } finally { release.resolve(); await x.dispose(); base.bridge.dispose() }
  }, 20000)
  test('real unavailable snapshots cannot become apparently usable material', async () => {
    const x = await fixture({}, {}, { maxMessages: 1 })
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage('unavailable-answer')]); await x.f.session.prompt('unavailable-input'); await x.f.observer.idle()
      expect(x.f.observer.outcomes.some(o => o.status === 'unavailable')).toBe(true); expect(x.records).toHaveLength(0); expect(recorded(x.bridge)).toHaveLength(0)
      proofs.push({ case: 'actual-unavailable-source-no-delivery', sdkVersion: x.f.sdkVersion, visibleObserverOmissions: x.f.observer.outcomes.filter(o => o.status === 'unavailable').length, received: 0 })
    } finally { await x.dispose() }
  }, 20000)
  test('opt-in tail snapshots keep long sessions observable with a bounded newest-message window (task150)', async () => {
    const x = await fixture({}, {}, { maxMessages: 1, tailMessages: 1 })
    try {
      x.f.setSteps([x.f.ai.fauxAssistantMessage('tail-answer')]); await x.f.session.prompt('tail-input'); await x.f.observer.idle()
      expect(x.f.observer.outcomes.some(o => o.status === 'unavailable')).toBe(false)
      const frames = x.f.observer.frames.filter((f: any) => f.snapshot.canonicalMessages.length > 0)
      expect(frames.length).toBeGreaterThan(0)
      for (const f of x.f.observer.frames as any[]) { expect(f.snapshot.available).toBe(true); expect(f.snapshot.canonicalMessages.length).toBeLessThanOrEqual(1); expect(Number.isSafeInteger(f.snapshot.truncatedHead)).toBe(true) }
      expect((x.f.observer.frames as any[]).some(f => f.snapshot.truncatedHead > 0)).toBe(true)
    } finally { await x.dispose() }
  }, 20000)
  test('real SDK abort defers the settled run rather than delivering aborted work', async () => {
    const entered = deferred(), x = await fixture()
    try {
      x.f.setSteps([async (_c: any, options: any) => { entered.resolve(); await new Promise<void>(r => { if (options.signal.aborted) r(); else options.signal.addEventListener('abort', () => r(), { once: true }) }); return x.f.ai.fauxAssistantMessage('aborted-output', { stopReason: 'aborted' }) }])
      const running = x.f.session.prompt('aborted-input'); await entered.promise; await x.f.session.abort(); await running; await x.f.observer.idle(); assertSources(x)
      expect(x.bridge.reports[0].reason).toBe('SDK run aborted'); expect(x.records).toHaveLength(0)
      proofs.push({ case: 'actual-abort-deferred', sdkVersion: x.f.sdkVersion, received: 0 })
    } finally { await x.dispose() }
  }, 20000)
})
