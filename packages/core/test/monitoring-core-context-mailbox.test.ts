import { describe, expect, test } from 'bun:test'
import { ContextCarryMailbox, type CarryItem } from '../src/engine/monitoring-core-context-mailbox.ts'

function setup(over: any = {}) {
  const versions = new Map([['doc-a', 'v1']])
  const box = new ContextCarryMailbox({ maxAgeMs: 120000, maxCarryTurns: 1, maxItems: 8, maxTextBytes: 4096, sourceVersion: id => versions.get(id), ...over })
  const item = (id: string, turn: number, createdAt = 0, deps = [{ id: 'doc-a', version: 'v1' }]): CarryItem => ({ id, moduleId: 'context.references', scope: { sessionId: 's1', branchId: 'b1', turn }, createdAt, dependencies: deps, text: `material ${id}` })
  const scope = (turn: number, sessionId = 's1', branchId = 'b1') => ({ sessionId, branchId, turn })
  return { box, versions, item, scope }
}
const reasons = (box: ContextCarryMailbox) => box.traces.map(t => t.reason)

describe('late-result carry mailbox (read-only context, synthetic)', () => {
  test('same-turn later request delivers without label', () => {
    const f = setup(); f.box.put(f.item('m1', 3, 1000), 1000)
    const d = f.box.take(f.scope(3), 5000, false)
    expect(d).toHaveLength(1); expect(d[0].carried).toBe(false); expect(d[0].text).toBe('material m1'); expect(f.box.pending).toBe(0)
  })
  test('carries once to the next turn first request with origin/age label', () => {
    const f = setup(); f.box.put(f.item('m1', 3, 1000), 1000)
    const d = f.box.take(f.scope(4), 31000, true)
    expect(d).toHaveLength(1); expect(d[0].carried).toBe(true); expect(d[0].text.startsWith('[이전 요청(turn 3)에 대해 30초 전')).toBe(true)
  })
  test('next turn but not its first request is dropped (no mid-turn carry)', () => {
    const f = setup(); f.box.put(f.item('m1', 3, 1000), 1000)
    expect(f.box.take(f.scope(4), 20000, false)).toHaveLength(0); expect(reasons(f.box)).toContain('carry_exceeded')
  })
  test('two turns later is dropped as carry_exceeded', () => {
    const f = setup(); f.box.put(f.item('m1', 3, 1000), 1000)
    expect(f.box.take(f.scope(5), 20000, true)).toHaveLength(0); expect(reasons(f.box)).toContain('carry_exceeded')
  })
  test('older than maxAge is dropped even on the next first request', () => {
    const f = setup(); f.box.put(f.item('m1', 3, 0), 0)
    expect(f.box.take(f.scope(4), 120001, true)).toHaveLength(0); expect(reasons(f.box)).toContain('expired_age')
  })
  test('changed source dependency version is never injected (stale)', () => {
    const f = setup(); f.box.put(f.item('m1', 3, 0), 0); f.versions.set('doc-a', 'v2')
    expect(f.box.take(f.scope(3), 1000, false)).toHaveLength(0); expect(reasons(f.box)).toContain('source_changed')
    const g = setup(); g.box.put(g.item('m2', 3, 0), 0); g.versions.delete('doc-a')
    expect(g.box.take(g.scope(4), 1000, true)).toHaveLength(0); expect(reasons(g.box)).toContain('source_changed')
  })
  test('session or branch change drops (wrong scope never injected)', () => {
    for (const s of [['s2', 'b1'], ['s1', 'b2']]) { const f = setup(); f.box.put(f.item('m1', 3, 0), 0); expect(f.box.take(f.scope(3, s[0], s[1]), 1000, false)).toHaveLength(0); expect(reasons(f.box)).toContain('scope_changed') }
  })
  test('never delivered twice and duplicate ids are refused even after delivery', () => {
    const f = setup(); f.box.put(f.item('m1', 3, 0), 0)
    expect(f.box.take(f.scope(3), 1000, false)).toHaveLength(1); expect(f.box.take(f.scope(3), 2000, false)).toHaveLength(0)
    expect(f.box.put(f.item('m1', 3, 0), 3000)).toBe(false); expect(reasons(f.box)).toContain('duplicate')
  })
  test('maxCarryTurns 0 means same turn only; bounds and invalid inputs fail closed', () => {
    const f = setup({ maxCarryTurns: 0 }); f.box.put(f.item('m1', 3, 0), 0); expect(f.box.take(f.scope(4), 1000, true)).toHaveLength(0)
    const g = setup({ maxItems: 1 }); expect(g.box.put(g.item('a', 1), 0)).toBe(true); expect(g.box.put(g.item('b', 1), 0)).toBe(false); expect(reasons(g.box)).toContain('overflow')
    expect(g.box.put({ ...g.item('c', 1), text: '' }, 0)).toBe(false)
    expect(() => new ContextCarryMailbox({ maxAgeMs: 1, maxCarryTurns: 2, maxItems: 1, maxTextBytes: 1, sourceVersion: () => 'x' })).toThrow('invalid carry mailbox options')
  })
})
