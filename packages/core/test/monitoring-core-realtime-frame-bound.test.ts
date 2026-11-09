import { describe, expect, test } from 'bun:test'
import { RealtimeMaterialWindow } from '../src/engine/monitoring-core-realtime-material.ts'
import type { ObservationFrame, ObservationSnapshot } from '../src/host/frames.ts'

const kinds = ['user-text', 'assistant-text']
function setup() {
  const window = new RealtimeMaterialWindow({ enabled: true, allowedKinds: kinds })
  window.start({ sessionId: 'bound-fixture', binding: 1 })
  let cursor = 0
  const feed = (sourceEvent: string, payload: any): ObservationFrame => {
    const n = ++cursor
    const snapshot: ObservationSnapshot = { sessionId: 'bound-fixture', leafId: 'leaf:' + n, branch: [], canonicalMessages: [], effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: 'h:' + n, revision: 'r:' + n, available: true, fullProviderContext: false, omitted: [] }
    const frame: ObservationFrame = { id: 'bound-frame:' + n, cursor: n, sourceEvent, kind: sourceEvent.replaceAll('_', '.'), sessionId: 'bound-fixture', binding: 1, epoch: 1, payload, snapshot, available: true } as any
    window.capture(frame, 1); return frame
  }
  const msg = (role: string, text: string) => feed('message_end', { message: { role, content: [{ type: 'text', text }] } })
  // One turn: the input event and the user message_end both carry the same user text; then two assistant messages.
  const input = feed('input', { text: 'hello' }), user = msg('user', 'hello'), first = msg('assistant', 'first reply'), later = msg('assistant', 'later reply')
  return { window, input, user, first, later }
}
const texts = (s: any) => s.materials.map((m: any) => m.text)

describe('frame-bounded judgement material (opt-in, CPU only)', () => {
  test('default snapshot keeps every current material, including later events and repeats (existing behaviour)', () => {
    const f = setup()
    expect(texts(f.window.snapshot(f.first.id, kinds))).toEqual(['hello', 'hello', 'first reply', 'later reply'])
    f.window.dispose()
  })
  test('boundToFrame hides material observed after the judged frame', () => {
    const f = setup()
    const s = f.window.snapshot(f.first.id, kinds, { boundToFrame: true })
    expect(texts(s)).toEqual(['hello', 'hello', 'first reply'])
    expect(s.currentIds).toHaveLength(1)
    f.window.dispose()
  })
  test('dedupe keeps the judged frame item and the first copy of other repeats', () => {
    const f = setup()
    const s = f.window.snapshot(f.user.id, kinds, { boundToFrame: true, dedupe: true })
    expect(texts(s)).toEqual(['hello'])
    expect(s.materials[0].id).toBe(s.currentIds[0])
    expect(texts(f.window.snapshot(f.later.id, kinds, { boundToFrame: true, dedupe: true }))).toEqual(['hello', 'first reply', 'later reply'])
    f.window.dispose()
  })
})
