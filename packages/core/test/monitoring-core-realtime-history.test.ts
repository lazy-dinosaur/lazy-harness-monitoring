import { describe, expect, test } from 'bun:test'
import { RealtimeMaterialWindow } from '../src/engine/monitoring-core-realtime-material.ts'
import type { ObservationFrame, ObservationSnapshot } from '../src/host/frames.ts'

const user = (text: string) => ({ role: 'user', content: [{ type: 'text', text }] })
const assistant = (text: string, call?: { name: string; arguments: any }) => ({ role: 'assistant', content: [{ type: 'text', text }, ...(call ? [{ type: 'toolCall', id: 'c1', ...call }] : [])] })
const toolResult = (text: string) => ({ role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: [{ type: 'text', text }] })
function setup(historyTurns?: number, kinds = ['user-text', 'conversation-history'], limits: any = {}) {
  const window = new RealtimeMaterialWindow({ enabled: true, allowedKinds: kinds, ...(historyTurns === undefined ? {} : { historyTurns }), limits })
  window.start({ sessionId: 'history-fixture', binding: 1 })
  let cursor = 0
  const feed = (sourceEvent: string, payload: any, canonicalMessages: unknown[] = []): ObservationFrame => {
    const n = ++cursor
    const snapshot: ObservationSnapshot = { sessionId: 'history-fixture', leafId: 'leaf:' + n, branch: [], canonicalMessages, effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: 'h:' + n, revision: 'r:' + n, available: true, fullProviderContext: false, omitted: [] }
    const frame: ObservationFrame = { id: 'history-frame:' + n, cursor: n, sourceEvent, kind: sourceEvent.replaceAll('_', '.'), sessionId: 'history-fixture', binding: 1, epoch: n, payload, snapshot, available: true } as any
    window.capture(frame, 1); return frame
  }
  const history = (frame: ObservationFrame) => window.snapshot(frame.id, ['conversation-history'])
  return { window, feed, history }
}
const prior = [user('로그 포맷을 바꿀지 고민 중이야'), assistant('어떤 포맷을 생각하세요?', { name: 'read', arguments: { path: 'docs/log.md' } }), toolResult('현재 로그 포맷 문서: JSON lines'), assistant('현재는 JSON lines입니다.'), user('알겠어'), assistant('네.')]

describe('opt-in recent conversation history material (synthetic, CPU only)', () => {
  test('default and historyTurns 0 add no history material (existing behaviour)', () => {
    for (const turns of [undefined, 0]) { const f = setup(turns); const frame = f.feed('input', { text: '그걸로 확정하자' }, prior); expect(f.history(frame).materials).toHaveLength(0); f.window.dispose() }
  })
  test('kind must be admitted even when turns are configured', () => {
    const f = setup(3, ['user-text']); const frame = f.feed('input', { text: '그걸로 확정하자' }, prior)
    expect(f.window.snapshot(frame.id, ['user-text', 'conversation-history']).materials.map(m => m.kind)).toEqual(['user-text']); f.window.dispose()
  })
  test('carries prior user/assistant/tool lines in order, provenance is the input frame, current input excluded', () => {
    const f = setup(2); const frame = f.feed('input', { text: '그걸로 확정하자' }, prior)
    const snap = f.history(frame); expect(snap.available).toBe(true); expect(snap.materials).toHaveLength(1)
    const m: any = snap.materials[0]
    expect(m.text.split('\n')).toEqual(['[user] 로그 포맷을 바꿀지 고민 중이야', '[assistant] 어떤 포맷을 생각하세요?', '[tool call] read({"path":"docs/log.md"})', '[tool result:read] 현재 로그 포맷 문서: JSON lines', '[assistant] 현재는 JSON lines입니다.', '[user] 알겠어', '[assistant] 네.'])
    expect(m.text.includes('그걸로 확정하자')).toBe(false)
    expect(m.provenance).toMatchObject({ owner: 'observation', observationId: frame.id, sourceEvent: 'input' })
    expect(snap.currentIds).toContain(m.id); f.window.dispose()
  })
  test('turn limit keeps only the most recent N user turns', () => {
    const f = setup(1); const frame = f.feed('input', { text: 'x' }, prior)
    expect((f.history(frame).materials[0] as any).text.split('\n')).toEqual(['[user] 알겠어', '[assistant] 네.']); f.window.dispose()
  })
  test('byte bound drops oldest lines first; empty history adds nothing', () => {
    const long = Array.from({ length: 6 }, (_, i) => [user(`u${i} ` + '가'.repeat(300)), assistant(`a${i}`)]).flat()
    const f = setup(8, ['user-text', 'conversation-history'], { maxSourceBytes: 2000, maxBytes: 16384 }); const frame = f.feed('input', { text: 'x' }, long)
    const text: string = (f.history(frame).materials[0] as any).text
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(2000); expect(text.endsWith('[assistant] a5')).toBe(true); expect(text.includes('u0 ')).toBe(false)
    const g = setup(3); const empty = g.feed('input', { text: 'first' }, []); expect(g.history(empty).materials).toHaveLength(0)
    f.window.dispose(); g.window.dispose()
  })
  test('each new input replaces the previous history material (reset per intent)', () => {
    const f = setup(2); const a = f.feed('input', { text: 'one' }, prior.slice(0, 2)); const first = (f.history(a).materials[0] as any).id
    const b = f.feed('input', { text: 'two' }, prior); const snap = f.window.snapshot(b.id, ['conversation-history'])
    expect(snap.materials).toHaveLength(1); expect((snap.materials[0] as any).id).not.toBe(first); expect(f.window.sourceVersion(first)).toBeUndefined(); f.window.dispose()
  })
  test('invalid turn admission is rejected', () => {
    for (const historyTurns of [-1, 9, 1.5]) expect(() => new RealtimeMaterialWindow({ enabled: true, allowedKinds: ['conversation-history'], historyTurns })).toThrow('invalid history turn admission')
  })
})
