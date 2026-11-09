// Judgement log (S3, engine rule): every judge decision is recorded for later evaluation and module tuning.
// Bounded retention (entries and age). When the host has not admitted content logging for the monitored data,
// only digests and ids are kept. Materials reaching this log are already redacted by the material window.
import { canonicalJsonHash } from '../sdk/canonical-json.ts'

export type JudgementEntry = Readonly<{ at: number; sessionId: string; eventId: string; moduleId: string; declarationHash?: string; decision: string; confidence?: number; reason?: string; offered: readonly Readonly<{ id: string; kind: string; selected: boolean; text?: string }>[]; inputDigest: string; profile?: string }>
export type JudgementLogOptions = Readonly<{ maxEntries: number; maxAgeMs: number; contentConsented: boolean }>

export class JudgementLog {
  private readonly rows: JudgementEntry[] = []
  private evicted = 0
  constructor(private readonly options: JudgementLogOptions) {
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1 || !Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 1 || typeof options.contentConsented !== 'boolean') throw new Error('invalid judgement log options')
  }
  append(entry: JudgementEntry, now: number) {
    const row: JudgementEntry = this.options.contentConsented ? entry : { ...entry, offered: entry.offered.map(({ text: _t, ...rest }) => rest), reason: undefined }
    this.rows.push(Object.freeze(JSON.parse(JSON.stringify(row))))
    this.prune(now)
  }
  prune(now: number) {
    while (this.rows.length && (this.rows.length > this.options.maxEntries || now - this.rows[0]!.at > this.options.maxAgeMs)) { this.rows.shift(); this.evicted++ }
  }
  entries(filter: Partial<Pick<JudgementEntry, 'moduleId' | 'decision' | 'sessionId'>> = {}) { return Object.freeze(this.rows.filter(r => Object.entries(filter).every(([k, v]) => (r as any)[k] === v))) }
  get stats() { return Object.freeze({ retained: this.rows.length, evicted: this.evicted }) }
  toJsonl() { return this.rows.map(r => JSON.stringify(r)).join('\n') + (this.rows.length ? '\n' : '') }
}

/** Extract one entry per module task from a native-classifier exchange (decision_i choice, ref_i_j bool). */
export function judgementEntriesFromExchange(request: any, answers: Record<string, any>, meta: Readonly<{ at: number; sessionId: string; eventId: string; profile?: string; declarationHashes?: Readonly<Record<string, string>> }>): JudgementEntry[] {
  const tasks: any[] = request?.body?.state?.tasks ?? []
  return tasks.map((task, i) => {
    const d = answers?.[`decision_${i}`]
    const refs: any[] = task?.view?.context?.references ?? []
    return {
      at: meta.at, sessionId: meta.sessionId, eventId: meta.eventId, moduleId: String(task.processorId),
      ...(meta.declarationHashes?.[task.processorId] ? { declarationHash: meta.declarationHashes[task.processorId] } : {}),
      decision: d?.type === 'choice' ? String(d.choice) : 'missing', ...(typeof d?.confidence === 'number' ? { confidence: d.confidence } : {}),
      offered: refs.map((r, j) => ({ id: String(r.id), kind: String(r.kind), selected: typeof answers?.[`ref_${i}_${j}`]?.probability === 'number' && answers[`ref_${i}_${j}`].probability >= 0.5, text: typeof r.content === 'string' ? r.content : undefined })),
      inputDigest: canonicalJsonHash(JSON.parse(JSON.stringify(task.view ?? null))), ...(meta.profile ? { profile: meta.profile } : {}),
    }
  })
}
