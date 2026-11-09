import { describe, expect, test } from 'bun:test'
import { frameSequenceIssues, hostSupportIssues, validateHostCapabilities } from '../src/host/index.ts'
import type { ObservationFrame } from '../src/host/frames.ts'

const caps = validateHostCapabilities({ hostId: 'test', version: '1', events: ['input', 'turn_end', 'message_end'], actions: ['inject-context'], snapshot: 'tail' })
const frame = (cursor: number, sourceEvent = 'input', sessionId = 's'): ObservationFrame => ({ id: `f${cursor}`, cursor, sourceEvent, kind: sourceEvent, sessionId, binding: 1, epoch: 1, payload: {}, available: true, snapshot: { sessionId, leafId: null, branch: [], canonicalMessages: [], effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: 'h', revision: 'r', available: true, fullProviderContext: false, omitted: [] } })

describe('host adapter contract (ADR 0062)', () => {
  test('capabilities must stay inside the core event vocabulary', () => {
    expect(() => validateHostCapabilities({ hostId: 'x', version: '1', events: ['opencode.session.idle'], actions: [], snapshot: 'none' })).toThrow('outside the core vocabulary')
  })
  test('modules needing an unsupported trigger point or action are reported, not silently dropped', () => {
    expect(hostSupportIssues(caps, [{ id: 'a.mod', watch: ['user.prompt', 'turn.end'] }])).toEqual([])
    expect(hostSupportIssues(caps, [{ id: 'b.mod', watch: ['tool.before'], actions: ['block-tool-call'] }])).toEqual([{ moduleId: 'b.mod', kind: 'event', name: 'tool_call' }, { moduleId: 'b.mod', kind: 'action', name: 'block-tool-call' }])
  })
  test('frame sequence conformance: ordered cursor, declared events, one session', () => {
    expect(frameSequenceIssues([frame(1), frame(2, 'turn_end')], caps)).toEqual([])
    expect(frameSequenceIssues([frame(1), frame(3), frame(4, 'tool_call'), frame(5, 'input', 'other')], caps).length).toBe(3)
  })
})
