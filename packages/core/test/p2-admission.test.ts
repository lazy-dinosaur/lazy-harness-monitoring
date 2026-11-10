import { expect, test } from 'bun:test'
import { parseObservationFrame, type ObservationFrame } from '@lazy-harness/monitoring-core/host'
import { coordinator, frame } from './support/p2-fixtures.ts'

const malformed: Record<string, unknown>[] = [
  { leafId: 1 }, { branch: {} }, { branch: [null] }, { branch: [{ id: 'n', parentId: 1, type: 'message' }] },
  { branch: [{ id: 'n', parentId: null }] }, { canonicalMessages: {} }, { effectiveSystemPrompt: false },
  { stage: 'unsupported' }, { canonicalHash: '' }, { revision: 3 }, { available: 'yes' },
  { fullProviderContext: true }, { omitted: [1] }, { omitted: null }, { observedMessages: {} },
  { truncatedHead: -1 }, { truncatedHead: 0.5 }, { missing: false }, { sessionId: 'other' }, { extra: true },
]
for (const [i, patch] of malformed.entries()) test(`strict snapshot admission rejects malformed field case ${i}`, async () => {
  const c = coordinator(), f = frame(1)
  try {
    c.accept({ ...f, snapshot: { ...f.snapshot, ...patch } } as ObservationFrame); await c.idle()
    expect(c.getStatus()).toMatchObject({ state: 'stopped', observed: 0, started: 0, ready: 0 })
    expect(c.traces.at(-1)?.reason).toBe('malformed')
  } finally { c.dispose() }
})
for (const field of Object.keys(frame(1).snapshot)) test(`strict snapshot admission requires ${field}`, () => {
  const f = structuredClone(frame(1)), snapshot = f.snapshot as Record<string, unknown>
  delete snapshot[field]
  expect(() => parseObservationFrame(f)).toThrow()
})
for (const target of ['frame', 'snapshot', 'branch', 'message', 'omitted'] as const) test(`admission never invokes ${target} getters`, async () => {
  const c = coordinator(), f = structuredClone(frame(1)); let reads = 0
  const getter = { enumerable: true, get() { reads++; throw Error('must not read') } }
  if (target === 'frame') Object.defineProperty(f, 'snapshot', getter)
  if (target === 'snapshot') Object.defineProperty(f.snapshot, 'revision', getter)
  if (target === 'branch') (f.snapshot.branch as object[]).push(Object.defineProperty({}, 'id', getter))
  if (target === 'message') (f.snapshot.canonicalMessages as object[]).push(Object.defineProperty({}, 'content', getter))
  if (target === 'omitted') Object.defineProperty(f.snapshot.omitted, '0', getter)
  try {
    c.accept(f); await c.idle()
    expect(reads).toBe(0); expect(c.getStatus().started).toBe(0)
    expect(c.traces.at(-1)?.reason).toBe('malformed')
  } finally { c.dispose() }
})
for (const stage of ['canonical_projection', 'context_conversation_at_hook', 'context_with_system_at_hook'] as const) test(`valid ${stage} snapshot copies and freezes without requiring provider context`, () => {
  const f = structuredClone(frame(1))
  const input = { ...f, snapshot: { ...f.snapshot, stage, branch: [{ id: 'n', parentId: null, type: 'message' }], observedMessages: [], truncatedHead: 0 } }
  const copy = parseObservationFrame(input)
  expect(copy).toEqual(input); expect(copy).not.toBe(input); expect(Object.isFrozen(copy.snapshot.branch[0])).toBe(true)
  input.snapshot.branch[0]!.id = 'changed'; expect(copy.snapshot.branch[0]!.id).toBe('n')
})
test('valid unavailable snapshot is observed but never prepared', async () => {
  const c = coordinator(), f = frame(1)
  try {
    c.accept({ ...f, available: false, snapshot: { ...f.snapshot, available: false, missing: 'snapshot-byte-limit', leafId: null } }); await c.idle()
    expect(c.getStatus()).toMatchObject({ state: 'running', observed: 1, started: 0, ready: 0 })
    expect(c.traces.at(-1)?.reason).toBe('unavailable')
  } finally { c.dispose() }
})
for (const patch of [{ epoch: -1 }, { epoch: '1' }, { cursor: 0 }, { binding: 0 }]) test(`invalid frame counter ${JSON.stringify(patch)} is rejected`, () => {
  expect(() => parseObservationFrame({ ...frame(1), ...patch })).toThrow()
})
