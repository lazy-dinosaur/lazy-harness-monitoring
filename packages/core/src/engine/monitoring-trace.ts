// task154 judgement trace (monitoring-trace/v1): the core's inspection port for use-time tuning, debugging and dogfooding.
// Rows arrive from the selection bridge (`judgement`/`selection`), the coordinator (`delivery`) and the module runtime
// (`job`). The file sink keeps data PER MODULE under a git-ignored private folder: one JSONL per module per day, bodies
// in a separate content store keyed by hash, bounded by age and size. Tracing never changes engine outcomes.
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export type MonitoringTraceRow = Readonly<Record<string, unknown> & { type: string }>
export type MonitoringTraceSink = (row: MonitoringTraceRow) => void
export type FileTraceSinkOptions = Readonly<{ maxAgeDays?: number; maxBytesPerModuleDay?: number; now?: () => number }>
const safe = (s: unknown) => typeof s === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(s) ? s : '_engine'
const hash = (s: string) => createHash('sha256').update(s).digest('hex')

/** Delete per-module trace files older than maxAgeDays (by the date in the file name) and unreferenced content files. */
export function pruneTraces(dir: string, maxAgeDays: number, now = Date.now()): number {
  if (!existsSync(dir)) return 0
  let removed = 0; const cutoff = now - maxAgeDays * 86400000
  for (const module of readdirSync(dir)) {
    const md = join(dir, module); if (!statSync(md).isDirectory()) continue
    for (const f of readdirSync(md)) { const m = /^traces-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f); if (m && Date.parse(m[1]! + 'T00:00:00Z') < cutoff) { rmSync(join(md, f)); removed++ } }
    const cd = join(md, 'content'); if (existsSync(cd)) for (const f of readdirSync(cd)) if (statSync(join(cd, f)).mtimeMs < cutoff) { rmSync(join(cd, f)); removed++ }
  }
  return removed
}

export function createFileTraceSink(dir: string, options: FileTraceSinkOptions = {}) {
  const now = options.now ?? Date.now, maxBytes = options.maxBytesPerModuleDay ?? 8 * 1024 * 1024
  mkdirSync(dir, { recursive: true }); pruneTraces(dir, options.maxAgeDays ?? 14, now())
  const stats = { written: 0, dropped: 0, errors: 0 }
  const sink: MonitoringTraceSink = row => {
    try {
      const module = safe((row as any).moduleId ?? (row as any).moduleIds?.[0]), md = join(dir, module), file = join(md, `traces-${new Date(now()).toISOString().slice(0, 10)}.jsonl`)
      mkdirSync(md, { recursive: true })
      if (existsSync(file) && statSync(file).size > maxBytes) { stats.dropped++; return }
      const { bodies, ...rest } = row as any, refs: Array<{ id: string; sha256: string }> = []
      if (Array.isArray(bodies)) { const cd = join(md, 'content'); mkdirSync(cd, { recursive: true }); for (const b of bodies) { const text = String(b?.text ?? ''), h = hash(text), p = join(cd, `${h}.json`); if (!existsSync(p)) writeFileSync(p, JSON.stringify({ text })); refs.push({ id: String(b?.id), sha256: h }) } }
      appendFileSync(file, JSON.stringify({ schema: 'monitoring-trace/v1', at: new Date(now()).toISOString(), ...rest, ...(refs.length ? { bodies: refs } : {}) }) + '\n')
      stats.written++
    } catch { stats.errors++ }
  }
  return Object.freeze({ sink, stats })
}
