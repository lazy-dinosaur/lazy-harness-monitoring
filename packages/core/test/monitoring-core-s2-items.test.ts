import { describe, expect, test } from 'bun:test'
import { RealtimeMaterialWindow } from '../src/engine/monitoring-core-realtime-material.ts'
import { redactSecrets } from '../src/engine/monitoring-core-redaction.ts'
import type { ObservationFrame, ObservationSnapshot } from '../src/host/frames.ts'

const user = (text: string) => ({ role: 'user', content: [{ type: 'text', text }] })
const assistant = (text: string, call?: any) => ({ role: 'assistant', content: [{ type: 'text', text }, ...(call ? [{ type: 'toolCall', id: 'c1', ...call }] : [])] })
const toolResult = (text: string) => ({ role: 'toolResult', toolCallId: 'c1', toolName: 'bash', content: [{ type: 'text', text }] })
function setup(opts: any = {}, kinds = ['user-text', 'conversation-history', 'tool-result']) {
  const window = new RealtimeMaterialWindow({ enabled: true, allowedKinds: kinds, historyTurns: 3, ...opts })
  window.start({ sessionId: 's2', binding: 1 })
  let cursor = 0
  const feed = (sourceEvent: string, payload: any, canonicalMessages: unknown[] = []): ObservationFrame => {
    const n = ++cursor
    const snapshot: ObservationSnapshot = { sessionId: 's2', leafId: 'l' + n, branch: [], canonicalMessages, effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: 'h' + n, revision: 'r' + n, available: true, fullProviderContext: false, omitted: [] }
    const frame: ObservationFrame = { id: 's2-frame:' + n, cursor: n, sourceEvent, kind: sourceEvent.replaceAll('_', '.'), sessionId: 's2', binding: 1, epoch: n, payload, snapshot, available: true } as any
    window.capture(frame, 1); return frame
  }
  return { window, feed }
}
const prior = [user('배포 전에 테스트 돌려줘'), assistant('실행할게요', { name: 'bash', arguments: { command: 'bun test' } }), toolResult('3 pass 0 fail'), assistant('통과했어요'), user('좋아'), assistant('네')]
// Assemble synthetic fixtures at runtime so source/history contain no credential-shaped values.
const SECRETS = [
  ['sk', 'proj', 'a'.repeat(32)].join('-'),
  ['gh', 'p_'].join('') + 'a'.repeat(36),
  ['AK', 'IA'].join('') + 'A'.repeat(16),
  ['xox', 'b'].join('') + '-' + '1'.repeat(10) + '-' + 'a'.repeat(10),
  [['ey', 'J'].join('') + 'a'.repeat(17), ['ey', 'J'].join('') + 'b'.repeat(24), 'c'.repeat(20)].join('.'),
  [['-----', 'BEGIN', ' RSA ', 'PRIVATE', ' KEY', '-----'].join(''), ['MII', 'Eabc'].join(''), ['-----', 'END', ' RSA ', 'PRIVATE', ' KEY', '-----'].join('')].join('\n'),
]
const BEARER = 'a'.repeat(30), PASSWORD = 'hunter2'.repeat(2), API_KEY = ['q1w2e3', 'r4t5y6'].join('')

describe('S2 item preparation (synthetic, CPU only)', () => {
  test('message mode yields one material per prior message line, ordered, newest kept, current input excluded', () => {
    const f = setup({ historyMode: 'message' }); const frame = f.feed('input', { text: '그거 배포해도 돼?' }, prior)
    const snap = f.window.snapshot(frame.id, ['conversation-history'])
    const rows = snap.materials.map((m: any) => [JSON.parse(m.content).historyIndex, m.text]).sort((a: any, b: any) => a[0] - b[0])
    expect(rows.map(r => r[1])).toEqual(['[user] 배포 전에 테스트 돌려줘', '[assistant] 실행할게요', '[tool call] bash({"command":"bun test"})', '[tool result:bash] 3 pass 0 fail', '[assistant] 통과했어요', '[user] 좋아', '[assistant] 네'])
    expect(new Set(snap.materials.map((m: any) => m.id)).size).toBe(7)
    expect(snap.materials.every((m: any) => snap.currentIds.includes(m.id) && m.provenance.observationId === frame.id)).toBe(true)
    expect(snap.materials.some((m: any) => m.text.includes('그거 배포해도'))).toBe(false)
  })
  test('message mode respects source-count and byte budgets by dropping the OLDEST lines (no window failure)', () => {
    const f = setup({ historyMode: 'message', limits: { maxSources: 4, maxBytes: 16384, maxSourceBytes: 8192 } }); const frame = f.feed('input', { text: 'x' }, prior)
    const snap = f.window.snapshot(frame.id, ['conversation-history'])
    expect(snap.available).toBe(true)
    expect(snap.materials.map((m: any) => JSON.parse(m.content).historyIndex).sort()).toEqual([4, 5, 6])
    expect(f.window.getStatus().available).toBe(true)
  })
  test('blob mode (default) is unchanged: one history material', () => {
    const f = setup(); const frame = f.feed('input', { text: 'x' }, prior)
    expect(f.window.snapshot(frame.id, ['conversation-history']).materials).toHaveLength(1)
  })
  test('secrets are redacted in user text, history lines and tool results before they become material', () => {
    const f = setup({ historyMode: 'message' })
    const leaky = [user(`키는 ${SECRETS[0]} 야`), assistant('ok', { name: 'bash', arguments: { command: `export GITHUB_TOKEN=${SECRETS[1]}` } }), toolResult(`aws ${SECRETS[2]} slack ${SECRETS[3]} jwt ${SECRETS[4]}\n${SECRETS[5]}`)]
    const frame = f.feed('input', { text: `Authorization: Bearer ${BEARER} password=${PASSWORD} 그리고 api_key: "${API_KEY}"` }, leaky)
    f.feed('tool_result', { toolCallId: 'c9', toolName: 'bash', content: [{ type: 'text', text: `found ${SECRETS[0]}` }] })
    const all = f.window.snapshot(frame.id, ['user-text', 'conversation-history', 'tool-result']).materials
    const blob = JSON.stringify(all)
    for (const s of [...SECRETS.map(x => x.split('\n')[0]), BEARER, PASSWORD, API_KEY, SECRETS[5]!.split('\n')[1]!]) expect(blob.includes(s)).toBe(false)
    expect(blob).toContain('[REDACTED:sk-key]'); expect(blob).toContain('[REDACTED:github-token]'); expect(blob).toContain('Bearer [REDACTED:bearer]'); expect(blob).toContain('password=[REDACTED:assignment]')
  })
  test('redaction leaves ordinary text untouched and is deterministic', () => {
    const plain = 'bun test 통과, commit 4feaf0d, sha256 9c3b8f92, 파일 a/b.ts, token 개수 12'
    expect(redactSecrets(plain)).toBe(plain)
    expect(redactSecrets(`x ${SECRETS[0]}`)).toBe(redactSecrets(`x ${SECRETS[0]}`))
  })
  test('invalid history mode is rejected', () => {
    expect(() => new RealtimeMaterialWindow({ enabled: true, allowedKinds: ['conversation-history'], historyMode: 'lines' as any })).toThrow('invalid history mode')
  })
})
