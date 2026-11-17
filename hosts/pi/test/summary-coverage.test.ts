import { expect, test } from 'bun:test'
import { PiMonitoringObserver, readObservationSnapshot, type ObservationContext } from '../src/observer.ts'
import { parseObservationFrame } from '../../../packages/core/src/host/frames.ts'
const summary = '# Goal\n' + '🙂'.repeat(3000) + '\n## Progress\n' + 'done '.repeat(3000) + '\n## Next\ncontinue '.repeat(2000)
const messages: any[] = [{ role: 'compactionSummary', summary }, ...Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: `tail ${i} ` + 'x'.repeat(500) }))]
const ctx: ObservationContext = { getSystemPrompt: () => 'system', sessionManager: { getSessionId: () => 's', getLeafId: () => 'leaf', getBranch: () => [], buildSessionProjection: () => ({ messages }) } }
test('long tail carries a separate bounded summary, with explicit omission and provenance', () => {
  const observer = new PiMonitoringObserver(() => {}, { tailMessages: 32 })
  const s = readObservationSnapshot(ctx, 'canonical_projection', undefined, observer.limits)
  expect(s.summaryIncluded).toBe(true); expect(s.summaryOmittedBytes).toBeGreaterThan(0)
  expect(s.compactionSummary?.provenance).toBe('derived-summary')
  expect(s.compactionSummary?.summary).toContain('## Next')
  expect(s.truncatedHead).toBe(29); expect(s.canonicalMessages).toHaveLength(32)
  expect(JSON.stringify(s.canonicalMessages)).toContain('tail 59')
  expect(Buffer.byteLength(JSON.stringify(s))).toBeLessThanOrEqual(65536)
  expect(parseObservationFrame({ id: 'f', cursor: 1, sourceEvent: 'input', kind: 'user.input', sessionId: 's', binding: 1, epoch: 0, payload: {}, snapshot: s, available: true }).snapshot).toEqual(s)
})
test('JSON escaping, UTF-8, prompt, observed messages, hashes and summary share fit the SAME ceiling', () => {
  for (const ceiling of [1024, 2048, 4096, 65536]) {
    const limits = new PiMonitoringObserver(() => {}, { tailMessages: 32, maxSnapshotBytes: ceiling, maxSummaryBytes: 8192 }).limits
    const s = readObservationSnapshot({ ...ctx, getSystemPrompt: () => '"\\\n'.repeat(10000) }, 'canonical_projection', messages, limits)
    expect(s.summaryIncluded).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(s))).toBeLessThanOrEqual(ceiling)
    expect(s.compactionSummary?.summary).not.toContain('�')
  }
})
test('tailMessages zero preserves the original full projection and unavailable behavior', () => {
  const limits = new PiMonitoringObserver(() => {}).limits
  const small = { ...ctx, sessionManager: { ...ctx.sessionManager, buildSessionProjection: () => ({ messages: messages.slice(0, 1).map(m => ({ ...m, summary: 'short' })) }) } }
  const s = readObservationSnapshot(small, 'canonical_projection', undefined, limits)
  expect(s.canonicalMessages).toEqual([{ role: 'compactionSummary', summary: 'short' }]); expect(s.summaryIncluded).toBeUndefined()
  expect(readObservationSnapshot(ctx, 'canonical_projection', undefined, { ...limits, maxSnapshotBytes: 1024 }).available).toBe(false)
})
