import { expect, test } from 'bun:test'
import { ContextCarryMailbox, type CarryItem } from '@lazy-harness/monitoring-core/engine/monitoring-core-context-mailbox.ts'
import { ManualClock } from './support/p2-scheduler.ts'
const scope = { sessionId: 'session', branchId: 'branch', turn: 1 }
const item = (id: string, extra: Partial<CarryItem> = {}): CarryItem => ({ id, moduleId: id, scope, createdAt: 0, dependencies: [{ id: 'source', version: '1' }], text: 'read-only synthetic advice', ...extra })
const mailbox = (sourceVersion: (id: string) => string | undefined = () => '1') => new ContextCarryMailbox({ maxAgeMs: 10, maxCarryTurns: 1, maxItems: 2, maxSeen: 3, maxTrace: 3, maxTextBytes: 128, sourceVersion })
for (const reason of ['branch', 'session', 'source', 'age', 'turn', 'not-first'] as const) test(`mailbox rejects stale ${reason} and never redelivers`, () => {
  let version = '1'; const box = mailbox(() => version), clock = new ManualClock()
  expect(box.put(item('one'), clock.now)).toBe(true)
  if (reason === 'source') version = '2'
  const next = { ...scope, ...(reason === 'branch' ? { branchId: 'other' } : {}), ...(reason === 'session' ? { sessionId: 'other' } : {}), ...(reason === 'turn' ? { turn: 3 } : {}), ...(reason === 'not-first' ? { turn: 2 } : {}) }
  clock.now = reason === 'age' ? 11 : 1
  expect(box.take(next, clock.now, reason !== 'not-first')).toEqual([])
  expect(box.pending).toBe(0); expect(box.put(item('one'), clock.now)).toBe(false)
  expect(box.traces.at(-1)?.reason).toBe('duplicate')
})
test('mailbox boundaries, carry once and bounded protection/diagnostic counts after drain', () => {
  const box = mailbox()
  expect(box.put(item('a'), 0)).toBe(true); expect(box.put(item('b'), 0)).toBe(true)
  expect(box.put(item('overflow'), 0)).toBe(false)
  const delivered = box.take({ ...scope, turn: 2 }, 10, true)
  expect(delivered).toHaveLength(2); expect(delivered.every(d => d.carried && d.ageMs === 10)).toBe(true)
  expect(box.take({ ...scope, turn: 2 }, 10, true)).toEqual([])
  expect(box.put(item('c'), 10)).toBe(true); expect(box.take(scope, 10, true)).toHaveLength(1)
  expect(box.put(item('d'), 10)).toBe(false); expect(box.traces.at(-1)?.reason).toBe('seen_capacity')
  expect(box.getStatus()).toMatchObject({ pending: 0, seen: 3, traces: 3 }); expect(box.getStatus().traceEvicted).toBeGreaterThan(0)
})
test('FINDING: throwing sourceVersion interrupts other modules sharing a mailbox', () => {
  let throwing = true
  const box = mailbox(id => { if (id === 'bad' && throwing) throw Error('source fault'); return '1' })
  box.put(item('bad', { dependencies: [{ id: 'bad', version: '1' }] }), 0); box.put(item('good'), 0)
  expect(() => box.take(scope, 1, true)).toThrow('source fault'); expect(box.pending).toBe(2)
  throwing = false; expect(box.take(scope, 1, true).map(d => d.item.id)).toEqual(['bad', 'good'])
})
