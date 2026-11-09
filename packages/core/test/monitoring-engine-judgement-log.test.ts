import { describe, expect, test } from 'bun:test'
import { JudgementLog, judgementEntriesFromExchange } from '../src/engine/monitoring-engine-judgement-log.ts'

const request = { body: { state: { tasks: [
  { processorId: 'rules.steer', view: { event: { id: 'e1' }, context: { references: [{ id: 'm1', kind: 'user-text', content: 'edit now' }, { id: 'p1', kind: 'policy', content: 'read first' }] } } },
  { processorId: 'kb.absorb', view: { event: { id: 'e1' }, context: { references: [{ id: 'm1', kind: 'user-text', content: 'edit now' }] } } },
] } } }
const answers = { decision_0: { type: 'choice', choice: 'run', confidence: 0.91 }, ref_0_0: { type: 'bool', probability: 0.9 }, ref_0_1: { type: 'bool', probability: 0.2 }, decision_1: { type: 'choice', choice: 'skip', confidence: 0.8 }, ref_1_0: { type: 'bool', probability: 0.1 } }

describe('S3 judgement log (engine rule, CPU only)', () => {
  test('one entry per module task with decision, confidence, offered items and selection', () => {
    const rows = judgementEntriesFromExchange(request, answers, { at: 1, sessionId: 's', eventId: 'e1', profile: 'jev', declarationHashes: { 'rules.steer': 'h1' } })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ moduleId: 'rules.steer', declarationHash: 'h1', decision: 'run', confidence: 0.91, offered: [{ id: 'm1', selected: true, text: 'edit now' }, { id: 'p1', selected: false }] })
    expect(rows[1]).toMatchObject({ moduleId: 'kb.absorb', decision: 'skip' }); expect(rows[0]!.inputDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(judgementEntriesFromExchange(request, {}, { at: 1, sessionId: 's', eventId: 'e1' })[0]!.decision).toBe('missing')
  })
  test('retention is bounded by entries and age', () => {
    const log = new JudgementLog({ maxEntries: 2, maxAgeMs: 100, contentConsented: true })
    const rows = judgementEntriesFromExchange(request, answers, { at: 0, sessionId: 's', eventId: 'e1' })
    log.append(rows[0]!, 0); log.append(rows[1]!, 0); log.append({ ...rows[0]!, at: 50 }, 50)
    expect(log.stats).toEqual({ retained: 2, evicted: 1 })
    log.prune(120); expect(log.stats.retained).toBe(1); log.prune(1000); expect(log.stats.retained).toBe(0)
  })
  test('without content consent only ids, kinds, selection and digests are kept', () => {
    const log = new JudgementLog({ maxEntries: 10, maxAgeMs: 1000, contentConsented: false })
    for (const r of judgementEntriesFromExchange(request, answers, { at: 0, sessionId: 's', eventId: 'e1' })) log.append({ ...r, reason: 'secret reason' }, 0)
    const out = log.toJsonl(); expect(out.includes('edit now')).toBe(false); expect(out.includes('secret reason')).toBe(false); expect(out).toContain('"selected":true')
    expect(log.entries({ decision: 'run' })).toHaveLength(1)
  })
  test('invalid options reject', () => { expect(() => new JudgementLog({ maxEntries: 0, maxAgeMs: 1, contentConsented: true })).toThrow() })
})
