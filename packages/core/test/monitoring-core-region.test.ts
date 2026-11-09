import { describe, expect, test } from 'bun:test'
import { RealtimeMaterialWindow, regionLines } from '../src/engine/monitoring-core-realtime-material.ts'
import { createIndependentSelectionPipelines, type RealtimeWatchModule } from '../src/engine/monitoring-core-realtime-selection.ts'
import { type ObservationFrame, type ObservationSnapshot } from '../src/host/frames.ts'
import { config, fixture, outputFor } from './support/model-fixture.ts'

// task154: per-module between-region input (everything since the module's last judged point), memo and state.
const user = (t: string) => ({ role: 'user', content: t })
const said = (t: string, calls: any[] = []) => ({ role: 'assistant', content: [{ type: 'text', text: t }, ...calls.map((c, i) => ({ type: 'toolCall', id: `c${i}`, name: c.name, arguments: c.args }))] })
const result = (name: string, ok = true, t = 'out') => ({ role: 'toolResult', toolName: name, isError: !ok, content: [{ type: 'text', text: t }] })
let cursor = 0
const frame = (event: string, messages: unknown[], payload: any = {}): ObservationFrame => {
  const n = ++cursor
  const snapshot: ObservationSnapshot = { sessionId: 's', leafId: `leaf-${n}`, branch: [], canonicalMessages: messages, effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: `h-${n}`, revision: `r-${n}`, available: true, fullProviderContext: false, omitted: [] }
  return { id: `frame:${n}`, cursor: n, sourceEvent: event, kind: event, sessionId: 's', binding: 1, epoch: n, payload, snapshot, available: true }
}
const windowFor = (limits: any = {}) => { cursor = 0; const w = new RealtimeMaterialWindow({ enabled: true, allowedKinds: ['user-text', 'conversation-history'], historyMode: 'since-last', metaEvents: ['turn_end'], limits }); w.start({ sessionId: 's', binding: 1 }); return w }
const texts = (w: RealtimeMaterialWindow, f: ObservationFrame) => w.snapshot(f.id, ['conversation-history']).materials.map(m => m.text)

describe('between-region input (task154, model calls 0)', () => {
  test('lines: verbatim text, tool calls as name -> target, results as ok/error, harness reminders removed', () => {
    expect(regionLines(said('reading', [{ name: 'read', args: { path: 'src/a.ts' } }])).lines).toEqual(['[assistant] reading', '[tool call] read → src/a.ts'])
    expect(regionLines(result('bash', false, 'boom')).lines).toEqual(['[tool result:bash] error: boom'])
    expect(regionLines(result('read')).lines).toEqual(['[tool result:read] ok'])
    expect(regionLines(user('fix it\n<system-reminder>READ RECORDS</system-reminder>')).lines).toEqual(['[user] fix it [harness reminder omitted]'])
    expect(regionLines({ role: 'custom', customType: 'rule-steer', content: 'note' }).lines).toEqual(['[extension:rule-steer] note'])
  })
  test('a judged region is not repeated; the next input is only what happened since', () => {
    const w = windowFor(), m1 = [user('build x'), said('ok', [{ name: 'read', args: { path: 'a.ts' } }]), result('read')]
    const f1 = frame('turn_end', m1)
    w.capture(f1, 1)
    expect(texts(w, f1)).toEqual(['[state] files touched: a.ts', '[user] build x', '[assistant] ok', '[tool call] read → a.ts', '[tool result:read] ok'])
    expect(w.snapshot(f1.id, ['conversation-history']).currentIds.length).toBeGreaterThan(0)
    w.markJudged(f1.id, ['[user] build x'])
    const f2 = frame('turn_end', [...m1, said('done')])
    w.capture(f2, 2)
    expect(texts(w, f2)).toEqual(['[memo] [user] build x', '[state] files touched: a.ts', '[assistant] done'])
  })
  test('a failed judgement keeps the region start, so the same span is seen again', () => {
    const w = windowFor(), m1 = [user('first')]
    const f1 = frame('turn_end', m1); w.capture(f1, 1); w.markJudged(f1.id)
    const f2 = frame('turn_end', [...m1, said('second')]); w.capture(f2, 2) // judged frame failed: no markJudged
    const f3 = frame('turn_end', [...m1, said('second'), said('third')]); w.capture(f3, 3)
    expect(texts(w, f3)).toEqual(['[assistant] second', '[assistant] third'])
  })
  test('an over-budget region keeps the newest items and marks what was left out', () => {
    const w = windowFor({ maxBytes: 1024, maxSourceBytes: 512 }), msgs = Array.from({ length: 30 }, (_, i) => said(`step ${i} ` + 'x'.repeat(40)))
    const f = frame('turn_end', msgs); w.capture(f, 1)
    const t = texts(w, f)
    expect(t[0]).toMatch(/^\[omitted \d+ earlier items of this region\]$/)
    expect(t.at(-1)).toContain('step 29')
    expect(w.getStatus().available).toBe(true)
  })
  test('the finalized user message does not re-add the input words or invalidate an in-flight judgement', () => {
    cursor = 0; const w = new RealtimeMaterialWindow({ enabled: true, allowedKinds: ['user-text', 'conversation-history'], historyMode: 'since-last', metaEvents: ['input'], limits: { maxBytes: 2048, maxSourceBytes: 1024 } }); w.start({ sessionId: 's', binding: 1 })
    const f1 = frame('input', [user('a'), said('b')], { text: 'do x' }); w.capture(f1, 1)
    const before = w.snapshot(f1.id, ['user-text', 'conversation-history']).materials.map(m => [m.id, w.sourceVersion(m.id)])
    w.capture(frame('message_end', [user('a'), said('b')], { message: { role: 'user', content: 'do x\n<system-reminder>' + 'R'.repeat(1500) + '</system-reminder>' } }), 2)
    expect(w.getStatus().available).toBe(true)
    for (const [id, v] of before) expect(w.sourceVersion(id!)).toBe(v)
  })
  test('compaction restarts the region from the summary head', () => {
    const w = windowFor(), f1 = frame('turn_end', [user('a'), said('b')]); w.capture(f1, 1); w.markJudged(f1.id)
    w.capture(frame('session_compact', [{ role: 'compactionSummary', summary: 'earlier work: a, b' }]), 2)
    const f3 = frame('turn_end', [{ role: 'compactionSummary', summary: 'earlier work: a, b' }, user('c')]); w.capture(f3, 3)
    expect(texts(w, f3)).toEqual(['[compactionSummary] earlier work: a, b', '[user] c'])
  })
})

describe('bridge moves the region after a judgement (task154, model calls 0)', () => {
  test('the second judge request carries only the new span', async () => {
    const f = fixture()
    ;(f.host.backends as any).native = { ...f.host.backends.native, invoke: (request: any, context: any) => { f.calls.push({ request, context }); const out: any = outputFor(request); request.body.state.tasks.forEach((t: any, i: number) => { out.value.answers[`decision_${i}`].choice = 'skip' }); return out } }
    const module: RealtimeWatchModule = { id: 'region.mod', watchEvents: ['turn_end'], referenceKinds: ['conversation-history'], grants: { referenceKinds: ['conversation-history'], actions: ['monitoring.selected-material'] }, question: { instructions: 'q', criteria: { run: 'r', skip: 's', defer: 'd' } }, destination: 'sink' }
    const set = createIndependentSelectionPipelines({ enabled: true, material: { allowedKinds: ['conversation-history'], historyMode: 'since-last' }, selection: { modules: [module], goal: 'g', modelConfig: config(), modelHost: f.host, isPermitted: () => true }, realtimeLimits: { jobTimeoutMs: 10000 } })
    const p = set.pipelines[0]!; p.window.start({ sessionId: 's', binding: 1 }); p.coordinator.start({ sessionId: 's', binding: 1 })
    cursor = 0
    const feed = async (fr: ObservationFrame) => { p.window.capture(fr, p.coordinator.getStatus().step); p.coordinator.accept(fr); await set.idle() }
    const seen = (n: number) => (f.calls[n]!.request.body as any).state.tasks[0].view.context.references.map((r: any) => JSON.parse(r.content).text)
    try {
      const m1 = [user('plan the change'), said('reading')]
      await feed(frame('turn_end', m1))
      await feed(frame('turn_end', [...m1, said('edited the file')]))
      expect(f.calls).toHaveLength(2)
      expect(seen(0)).toEqual(['[user] plan the change', '[assistant] reading'])
      expect(seen(1)).toEqual(['[assistant] edited the file'])
    } finally { set.dispose(); await set.idle() }
  })
})

describe('purpose-scoped region compaction (task154, model calls 0)', () => {
  test('Jev keeps only the region items the module purpose needs before the judgement', async () => {
    const f = fixture()
    ;(f.host.backends as any).native = { ...f.host.backends.native, invoke: (request: any, context: any) => {
      f.calls.push({ request, context }); const out: any = outputFor(request), task = request.body.state.tasks[0]
      const compact = String(task.view.event.id).endsWith(':compact')
      task.view.context.references.forEach((r: any, j: number) => { out.value.answers[`ref_0_${j}`].probability = compact ? (JSON.parse(r.content).text.includes('relevant') ? 0.95 : 0.05) : 0.05 })
      out.value.answers.decision_0.choice = compact ? 'run' : 'skip'; return out } }
    const module: RealtimeWatchModule = { id: 'compact.mod', watchEvents: ['turn_end'], referenceKinds: ['conversation-history'], grants: { referenceKinds: ['conversation-history'], actions: ['monitoring.selected-material'] }, question: { instructions: 'Detect relevant work', criteria: { run: 'r', skip: 's', defer: 'd' } }, destination: 'sink', compactRegion: true }
    const set = createIndependentSelectionPipelines({ enabled: true, material: { allowedKinds: ['conversation-history'], historyMode: 'since-last' }, selection: { modules: [module], goal: 'g', modelConfig: config(), modelHost: f.host, isPermitted: () => true }, realtimeLimits: { jobTimeoutMs: 10000 } })
    const p = set.pipelines[0]!; p.window.start({ sessionId: 's', binding: 1 }); p.coordinator.start({ sessionId: 's', binding: 1 })
    cursor = 0
    try {
      const fr = frame('turn_end', [user('noise one'), said('the relevant step'), said('noise two')])
      p.window.capture(fr, p.coordinator.getStatus().step); p.coordinator.accept(fr); await set.idle()
      expect(f.calls).toHaveLength(2)
      const judged = (f.calls[1]!.request.body as any).state.tasks[0].view.context.references.map((r: any) => JSON.parse(r.content).text)
      expect(judged).toEqual(['[assistant] the relevant step'])
      expect(p.window.regionStatus.memo).toEqual(['[assistant] the relevant step'])
    } finally { set.dispose(); await set.idle() }
  })
})
