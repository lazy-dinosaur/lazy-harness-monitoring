import { expect, test } from 'bun:test'
import { createInMemoryReadRecordPort, syntheticInputPortContext, syntheticReadRecord, syntheticReadRequest, evaluateReadRecordSnapshot } from '@lazy-harness/monitoring-core/host'
import { createPiInputPortGenerations } from '../src/index.ts'
import { realSdk, fauxApi as ai } from './support/real-sdk.ts'

test('SDK faux lifecycle changes fence read scopes on tree, compaction and session replacement', async () => {
  const generations = createPiInputPortGenerations(), fenced: string[] = []
  const f = await realSdk({ extensions: [generations.extension, pi => {
    for (const event of ['session_before_tree', 'session_before_compact', 'session_before_switch'] as const) pi.on(event as any, () => { if (!generations.current()) fenced.push(event) })
  }] })
  const context = () => { const scope = generations.current(); return scope ? { ...syntheticInputPortContext(), scope } : undefined }
  const reads = createInMemoryReadRecordPort({ context })
  try {
    const start = generations.current()!
    expect(start.sessionId).toBe(f.session.sessionManager.getSessionId())
    expect(reads.record(syntheticReadRecord(context()!))).toBe(true)
    f.setSteps([ai.fauxAssistantMessage('synthetic seed'), ai.fauxAssistantMessage('synthetic branch answer')])
    await f.session.prompt('synthetic seed input')
    await f.session.prompt('synthetic branch input')
    expect(generations.current()).toEqual(start) // Ordinary leaf append is NOT a branch switch.
    const user = f.session.sessionManager.getBranch().find((e: any) => e.type === 'message' && e.message.role === 'user')!
    await f.session.navigateTree(user.id, { summarize: false })
    const tree = generations.current()!
    expect(tree.branchGeneration).toBeGreaterThan(start.branchGeneration)
    expect(tree.branchId).toBe(f.session.sessionManager.getLeafId()!)
    expect(evaluateReadRecordSnapshot(syntheticReadRequest(context()!), await reads.port.snapshot(syntheticReadRequest(context()!)))[0].status).toBe('not-read')
    expect(reads.record(syntheticReadRecord(context()!))).toBe(true)
    f.setSteps([ai.fauxAssistantMessage('synthetic padding one'), ai.fauxAssistantMessage('synthetic padding two')])
    await f.session.prompt('synthetic padding '.repeat(150)); await f.session.prompt('more synthetic padding '.repeat(150))
    f.setSteps([ai.fauxAssistantMessage('SYNTHETIC_PORT_COMPACTION')]); await f.session.compact()
    const compact = generations.current()!
    expect(compact.compactionGeneration).toBeGreaterThan(tree.compactionGeneration)
    expect(evaluateReadRecordSnapshot(syntheticReadRequest(context()!), await reads.port.snapshot(syntheticReadRequest(context()!)))[0].status).toBe('not-read')
    await f.runtime.newSession()
    const replacement = generations.current()!
    expect(replacement.sessionId).not.toBe(compact.sessionId)
    expect(replacement.bindingGeneration).toBeGreaterThan(compact.bindingGeneration)
    expect(reads.record(syntheticReadRecord({ ...syntheticInputPortContext(), scope: compact }))).toBe(false)
    expect(fenced).toEqual(expect.arrayContaining(['session_before_tree', 'session_before_compact', 'session_before_switch']))
    expect(f.errors).toEqual([])
    await f.runtime.dispose(); expect(generations.current()).toBeUndefined()
  } finally { reads.close(); generations.close(); await f.dispose() }
})

test('failed compaction stays unknown and stale extension owners cannot close a new scope', () => {
  const g = createPiInputPortGenerations(), handlers = () => {
    const h = new Map<string, (event: unknown, ctx: any) => void>()
    g.extension({ on(name, handler) { h.set(name, handler) } }); return h
  }
  const old = handlers(), ctx = { sessionManager: { getSessionId: () => 'synthetic', getLeafId: () => null } }
  old.get('session_start')!({}, ctx)
  old.get('session_before_compact')!({}, ctx); expect(g.current()).toBeUndefined()
  old.get('session_compact_failed')!({}, ctx); expect(g.current()).toBeUndefined()
  const next = handlers(); next.get('session_start')!({}, ctx)
  const fresh = g.current()!
  old.get('session_shutdown')!({}, ctx); expect(g.current()).toEqual(fresh)
  g.close(); expect(g.current()).toBeUndefined()
})
