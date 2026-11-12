import { createHash } from 'node:crypto'
import { freezeMonitoringData } from '../sdk/diagnostics.ts'
import { redactSecrets } from './monitoring-core-redaction.ts'
import { parseMonitoringJsonData } from '../sdk/schema.ts'
import { observationEvents, type ObservationFrame } from '../host/frames.ts'
import type { Reference } from './monitoring-core.ts'

export type RealtimeMaterial = Reference & Readonly<{ text: string; provisional: boolean; provenance: Readonly<{ owner: 'observation' | 'host'; observationId: string | null; sessionId: string; binding: number; sourceEvent: string; cursor: number | null; step: number; stage: 'event-hook' | 'partial' | 'final-hook' | 'host-provided' }> }>
export type MaterialWindowLimits = { maxSources: number; maxBytes: number; maxSourceBytes: number; maxFrames: number; maxEvents: number; maxBlocks: number; maxTrace: number }
export type MaterialWindowOptions = Readonly<{ enabled?: boolean; allowedKinds: readonly string[]; toolFields?: Readonly<Record<string, readonly string[]>>; references?: readonly Reference[]; historyTurns?: number; historyMode?: 'blob' | 'message' | 'since-last'; metaEvents?: readonly string[]; limits?: Partial<MaterialWindowLimits>; /** Opt-in: clip an oversize item to maxSourceBytes (marked) instead of failing the window. */ clipOversize?: boolean }>
const defaults: MaterialWindowLimits = { maxSources: 32, maxBytes: 16384, maxSourceBytes: 8192, maxFrames: 256, maxEvents: 2048, maxBlocks: 64, maxTrace: 128 }
const data = <T>(value: T): T => freezeMonitoringData(parseMonitoringJsonData(value) as T)
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const bytes = (value: string) => Buffer.byteLength(value, 'utf8')
const MARK = ' …[clipped]'
/** Clip to at most `max` UTF-8 bytes (with a marker). */
const clipBytes = (s: string, max: number) => { if (bytes(s) <= max) return s; let n = Math.min(s.length, max); while (n > 0 && bytes(s.slice(0, n) + MARK) > max) n = Math.floor(n * 0.9); return s.slice(0, n) + MARK }
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
const resets = new Set(['input', 'session_before_tree', 'session_tree', 'session_before_compact', 'session_compact', 'session_compact_failed', 'model_select', 'thinking_level_select'])
const stops = new Set(['session_shutdown', 'session_before_switch', 'session_before_fork'])

/** task154 between-region line rendering: user/assistant text verbatim (clipped), tool calls as name -> target, tool results
 * as ok/error, harness <system-reminder> blocks removed and marked, extension messages tagged by origin. */
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g
const clipText = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s
const textOf = (content: unknown) => typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n') : ''
function toolTarget(args: any): string {
  if (!args || typeof args !== 'object') return ''
  for (const k of ['path', 'file_path', 'filePath', 'file', 'url', 'pattern', 'command', 'cmd', 'query']) if (typeof args[k] === 'string' && args[k]) return clipText(args[k].replace(/\s+/g, ' '), 120)
  return clipText(Object.keys(args).slice(0, 4).join(','), 60)
}
export function regionLines(m: any): { lines: string[]; files: string[] } {
  const lines: string[] = [], files: string[] = []
  if (m?.role === 'user') {
    const raw = textOf(m.content), stripped = raw.replace(REMINDER, '').trim()
    if (stripped) lines.push(`[user] ${clipText(stripped, 800)}${stripped.length !== raw.trim().length ? ' [harness reminder omitted]' : ''}`)
    else if (raw) lines.push('[harness reminder omitted]')
  } else if (m?.role === 'assistant') {
    const t = textOf(m.content); if (t) lines.push(`[assistant] ${clipText(t, 800)}`)
    if (Array.isArray(m.content)) for (const b of m.content) if (b?.type === 'toolCall') { const target = toolTarget(b.arguments); lines.push(`[tool call] ${b.name}${target ? ' → ' + target : ''}`); for (const k of ['path', 'file_path', 'filePath', 'file']) if (typeof b.arguments?.[k] === 'string') files.push(clipText(b.arguments[k], 160)) }
  } else if (m?.role === 'toolResult') {
    const name = typeof m.toolName === 'string' ? m.toolName : 'tool'
    lines.push(m.isError === true ? `[tool result:${name}] error: ${clipText(textOf(m.content).replace(/\s+/g, ' '), 200)}` : `[tool result:${name}] ok`)
  } else if (m?.role === 'custom') { const t = textOf(m.content); if (t) lines.push(`[extension:${typeof m.customType === 'string' ? m.customType : 'custom'}] ${clipText(t, 400)}`) }
  else if (typeof m?.role === 'string') { const t = textOf(m.content ?? m.summary); if (t) lines.push(`[${m.role}] ${clipText(t, 1500)}`) }
  return { lines, files }
}

/** One bounded current-intent evidence owner. No semantic ranking, session-history authority, filesystem watcher or cross-epoch cache. */
export class RealtimeMaterialWindow {
  readonly limits: Readonly<MaterialWindowLimits>
  private readonly options: MaterialWindowOptions
  private readonly materials = new Map<string, RealtimeMaterial>()
  private readonly base = new Map<string, Reference>()
  private readonly frames = new Map<string, readonly string[]>()
  private readonly records: Array<Readonly<{ frameId: string | null; reason: string }>> = []
  // task154 between-region state (historyMode 'since-last'): survives per-intent resets, cleared with the scope.
  private regionStart?: number
  private compactionUnits = false
  private intentInput = false
  private readonly regionAt = new Map<string, number>()
  private readonly regionIndex = new Map<string, number>()
  private memo: string[] = []
  private readonly files = new Set<string>()
  private state: 'idle' | 'running' | 'stopped' | 'disposed' = 'idle'
  private scope?: { sessionId: string; binding: number }
  private generation = 0
  private cursor = 0
  private observed = 0
  private size = 0
  private gap = false
  private evictedFrames = 0
  private evictedTrace = 0

  constructor(options: MaterialWindowOptions) {
    this.limits = Object.freeze({ ...defaults, ...options.limits })
    if (Object.values(this.limits).some(n => !Number.isSafeInteger(n) || n < 1) || this.limits.maxSourceBytes > this.limits.maxBytes) throw new Error('invalid material window limits')
    if (options.historyTurns !== undefined && (!Number.isSafeInteger(options.historyTurns) || options.historyTurns < 0 || options.historyTurns > 8)) throw new Error('invalid history turn admission')
    if (options.historyMode !== undefined && options.historyMode !== 'blob' && options.historyMode !== 'message' && options.historyMode !== 'since-last') throw new Error('invalid history mode')
    if (!Array.isArray(options.allowedKinds) || !options.allowedKinds.length || options.allowedKinds.length > 32 || new Set(options.allowedKinds).size !== options.allowedKinds.length || options.allowedKinds.some(k => !text(k))) throw new Error('explicit material kinds required')
    const fields = data(options.toolFields ?? {})
    for (const [tool, names] of Object.entries(fields)) if (!text(tool) || !Array.isArray(names) || names.length > 16 || new Set(names).size !== names.length || names.some(n => !text(n))) throw new Error('invalid tool field admission')
    if ((options.metaEvents ?? []).some(e => !(observationEvents as readonly string[]).includes(e))) throw new Error('unknown material meta event')
    this.options = Object.freeze({ ...options, enabled: options.enabled === true, allowedKinds: data([...options.allowedKinds]), toolFields: fields, references: data([...(options.references ?? [])]), metaEvents: data([...(options.metaEvents ?? [])]), limits: this.limits })
    for (const ref of this.options.references!) {
      this.validateReference(ref)
      if (this.base.has(ref.id)) throw new Error('duplicate host reference')
      this.base.set(ref.id, ref)
    }
    if (this.base.size > this.limits.maxSources || [...this.base.values()].reduce((n, r) => n + bytes(r.content), 0) > this.limits.maxBytes) throw new Error('excessive base material')
  }

  /** Enabled only by an admitted compaction bridge; other modules keep their previous material shape. */
  enableRegionCompactionUnits(): void { this.compactionUnits = true }
  accepts(kind: string): boolean { return this.options.allowedKinds.includes(kind) }
  start(scope: { sessionId: string; binding: number; afterCursor?: number }): boolean {
    if (!this.options.enabled) return false
    if (this.state !== 'idle' || !text(scope.sessionId) || !Number.isSafeInteger(scope.binding) || scope.binding < 1 || !Number.isSafeInteger(scope.afterCursor ?? 0) || (scope.afterCursor ?? 0) < 0) throw new Error('invalid material scope')
    this.scope = data({ sessionId: scope.sessionId, binding: scope.binding }); this.cursor = scope.afterCursor ?? 0; this.clearRegion()
    this.state = 'running'; this.reset()
    return true
  }

  /** Called after observer capture, before the realtime job tap. readProgress is lazy so denied fields are never read here. */
  capture(frame: ObservationFrame, step: number, readProgress?: () => unknown): void {
    if (this.state !== 'running') return
    if (frame.sessionId !== this.scope!.sessionId || frame.binding !== this.scope!.binding) { this.stop(); return }
    if (frame.cursor <= this.cursor) { this.note(frame.id, 'duplicate_or_old_frame'); return }
    if (frame.cursor !== this.cursor + 1) { this.fail(frame.id, 'source_gap'); return }
    this.cursor = frame.cursor
    if (++this.observed > this.limits.maxEvents) { this.fail(frame.id, 'event_budget'); this.stop(); return }
    if (stops.has(frame.sourceEvent) || (frame.payload as any)?.aborted === true || (frame.payload as any)?.message?.stopReason === 'aborted') { this.stop(); return }
    if (resets.has(frame.sourceEvent)) this.reset()
    // A compaction or tree move rebuilds the projection; the next region starts again from its (summary) head.
    if (frame.sourceEvent === 'session_compact' || frame.sourceEvent === 'session_tree') this.regionStart = undefined
    const ids: string[] = []
    const remember = () => {
      this.frames.set(frame.id, Object.freeze(ids))
      if (this.frames.size > this.limits.maxFrames) { this.frames.delete(this.frames.keys().next().value!); this.evictedFrames++ }
    }
    if (!frame.available || !frame.snapshot.available) { this.fail(frame.id, 'source_unavailable'); remember(); return }
    const p = frame.payload as any
    const add = (kind: string, key: string, value: string | undefined, provisional = false, facts: Record<string, unknown> = {}) => {
      if (!this.accepts(kind) || value === undefined || value.length === 0) return
      // Engine rule (not optional): secret-shaped values are replaced before any material can reach a judge/worker.
      value = redactSecrets(value)
      if (this.options.clipOversize === true) { const overhead = bytes(JSON.stringify({ text: '', provisional, ...facts })) + 16; value = clipBytes(value, Math.max(64, this.limits.maxSourceBytes - overhead)) }
      const id = `material:${hash([this.scope, kind, key])}`
      const content = JSON.stringify({ text: value, provisional, ...facts })
      const entry: RealtimeMaterial = { id, kind, version: hash([id, kind, content, provisional]), content, text: value, provisional, provenance: { owner: 'observation', observationId: frame.id, sessionId: frame.sessionId, binding: frame.binding, sourceEvent: frame.sourceEvent, cursor: frame.cursor, step, stage: provisional ? 'partial' : frame.sourceEvent === 'message_end' ? 'final-hook' : 'event-hook' } }
      if (this.put(entry, frame.id)) ids.push(id)
    }
    try {
      if (frame.sourceEvent === 'input' && this.accepts('user-text')) { add('user-text', frame.id, typeof p?.text === 'string' ? p.text : undefined); this.intentInput = true }
      if (frame.sourceEvent === 'input' && (this.options.historyTurns ?? 0) > 0 && this.accepts('conversation-history')) {
        const lines = this.historyLines(frame.snapshot.canonicalMessages)
        if (this.options.historyMode === 'message') {
          // One material per prior message line so a judge can select only what it needs; newest first within the window budgets.
          const room = Math.max(0, this.limits.maxSources - this.materials.size)
          let budget = this.limits.maxBytes - this.size
          const keep: Array<[number, string]> = []
          for (let i = lines.length - 1; i >= 0 && keep.length < room; i--) { const n = bytes(JSON.stringify({ text: lines[i], provisional: false, historyIndex: i })); if (n > this.limits.maxSourceBytes || n > budget) break; budget -= n; keep.unshift([i, lines[i]]) }
          for (const [i, line] of keep) add('conversation-history', `conversation-history:${frame.id}:${i}`, line, false, { historyIndex: i })
        } else {
          while (lines.length && bytes(lines.join('\n')) > this.limits.maxSourceBytes) lines.shift()
          add('conversation-history', `conversation-history:${frame.id}`, lines.length ? lines.join('\n') : undefined)
        }
      }
      if (frame.sourceEvent === 'message_update' && this.accepts('assistant-progress')) add('assistant-progress', `assistant-progress:${step}`, this.extractText(p?.message?.content), true)
      if (frame.sourceEvent === 'message_end') {
        const message = p?.message
        // task154: in since-last mode the input hook already admitted this intent's user words; the finalized user message
        // (often longer: skill expansion, harness reminders) must not be added again — a late extra item could exceed the
        // budget and invalidate the judgement that is still in flight for the input (source_changed, silent drop).
        if (message?.role === 'user' && this.accepts('user-text') && !(this.options.historyMode === 'since-last' && this.intentInput)) add('user-text', frame.id, this.extractText(message.content))
        if (message?.role === 'assistant') {
          this.removeLogical('assistant-progress', `assistant-progress:${step}`)
          if (this.accepts('assistant-text')) add('assistant-text', frame.id, this.extractText(message.content))
        }
      }
      const resultMessage = frame.sourceEvent === 'message_end' && p?.message?.role === 'toolResult' ? p.message : undefined
      if (frame.sourceEvent === 'tool_result' || resultMessage) {
        const result = resultMessage ?? p, callId = result?.toolCallId
        if (typeof callId === 'string') this.removeLogical('tool-progress', `tool-progress:${callId}`)
        if (this.accepts('tool-result')) add('tool-result', `tool-result:${callId ?? frame.id}`, this.extractText(result?.content), false, this.toolFacts(result))
      }
      if (frame.sourceEvent === 'tool_execution_update' && this.accepts('tool-progress')) {
        const result = readProgress?.() as any
        add('tool-progress', `tool-progress:${typeof p?.toolCallId === 'string' ? p.toolCallId : frame.id}`, this.extractText(result?.content), true, this.toolFacts(p))
      }
      if (frame.sourceEvent === 'tool_call') {
        const facts = this.toolFacts(p)
        if (this.accepts('tool-meta')) add('tool-meta', `tool-meta:${p?.toolCallId ?? frame.id}`, JSON.stringify(facts))
        if (this.accepts('tool-arguments')) {
          const names = Object.prototype.hasOwnProperty.call(this.options.toolFields, p?.toolName) ? this.options.toolFields![p.toolName] : [], projected: Record<string, unknown> = {}
          for (const name of names) { const d = p?.input && Object.getOwnPropertyDescriptor(p.input, name); if (d) { if (d.get || d.set) throw new Error(); projected[name] = d.value } }
          if (Object.keys(projected).length) add('tool-arguments', `tool-arguments:${p?.toolCallId ?? frame.id}`, JSON.stringify(data(projected)), false, facts)
        }
      }
      if (this.accepts('event-meta') && this.options.metaEvents!.includes(frame.sourceEvent)) add('event-meta', frame.id, JSON.stringify({ sourceEvent: frame.sourceEvent, ...this.toolFacts(p), ...(typeof p?.aborted === 'boolean' ? { aborted: p.aborted } : {}) }))
      if (this.options.historyMode === 'since-last' && this.accepts('conversation-history') && this.options.metaEvents!.includes(frame.sourceEvent)) {
        // task154: everything since THIS module's last judged point (one window per module in independent pipelines),
        // newest first within the remaining budget; memo + deterministic state first; omitted items are marked.
        const msgs = frame.snapshot.canonicalMessages as readonly any[], base = frame.snapshot.truncatedHead ?? 0, total = base + msgs.length
        this.regionAt.set(frame.id, total); if (this.regionAt.size > this.limits.maxFrames) this.regionAt.delete(this.regionAt.keys().next().value!)
        const start = this.regionStart ?? 0
        for (const [id, i] of [...this.regionIndex]) if (i < start) { const ref = this.materials.get(id); if (ref) { this.materials.delete(id); this.size -= bytes(ref.content) } this.regionIndex.delete(id) }
        for (let k = 0; k < 6; k++) this.removeLogical('conversation-history', `region-head:${k}`)
        this.removeLogical('conversation-history', 'region-omitted')
        const region: Array<[number, string, number, string?]> = []
        for (let i = Math.max(start, base); i < total; i++) {
          const message = msgs[i - base], r = regionLines(message)
          const calls = Array.isArray(message?.content) ? message.content.filter((b: any) => b?.type === 'toolCall') : []
          let call = 0
          r.files.forEach(f => this.files.add(f))
          r.lines.forEach((l, k) => {
            const id = l.startsWith('[tool call]') ? calls[call++]?.id : message?.role === 'toolResult' ? message.toolCallId : undefined
            region.push([i, l, k, this.compactionUnits && typeof id === 'string' ? hash(id) : undefined])
          })
        }
        while (this.files.size > 20) this.files.delete(this.files.values().next().value!)
        const head = [...this.memo.map(t => `[memo] ${t}`), ...(this.files.size ? [`[state] files touched: ${clipText([...this.files].join(', '), 600)}`] : [])]
        const size = (t: string, toolCallId?: string) => bytes(JSON.stringify({ text: t, provisional: false, region: true, regionIndex: 0, ...(toolCallId ? { toolCallId } : {}) })) + 24
        let budget = this.limits.maxBytes - this.size - head.reduce((n, t) => n + size(t), 0) - 160, room = this.limits.maxSources - this.materials.size - head.length - 1
        const keep: Array<[number, string, number, string?]> = []
        for (let j = region.length - 1; j >= 0 && keep.length < room; j--) { const n = size(region[j]![1], region[j]![3]); if (n > this.limits.maxSourceBytes || n > budget) break; budget -= n; keep.unshift(region[j]!) }
        const omitted = region.length - keep.length + Math.max(0, base - start)
        const before = ids.length
        head.forEach((t, k) => add('conversation-history', `region-head:${k}`, t, false, { region: true }))
        if (omitted > 0) add('conversation-history', 'region-omitted', `[omitted ${omitted} earlier items of this region]`, false, { region: true })
        for (const [i, t, k, toolCallId] of keep) { const key = `region:${i}:${k}`; add('conversation-history', key, t, false, { region: true, regionIndex: i, ...(toolCallId ? { toolCallId } : {}) }); this.regionIndex.set(`material:${hash([this.scope, 'conversation-history', key])}`, i) }
        const regionIds = ids.splice(before)
        // A frame with no own item (for example turn_end) is judged on its region; otherwise the region is context only.
        if (!ids.length) ids.push(...regionIds)
      }
    } catch { this.fail(frame.id, 'material_unavailable') }
    remember()
  }

  /** Opt-in recent-turn context from the input hook's canonical projection (prior turns only), oldest first. */
  private historyLines(messages: readonly unknown[]): string[] {
    const turns = this.options.historyTurns ?? 0, lines: string[] = []
    const clip = (s: string) => s.length > 800 ? s.slice(0, 800) + '…' : s
    const textOf = (content: unknown) => typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n') : ''
    let users = 0
    for (let i = messages.length - 1; i >= 0 && users < turns; i--) {
      const m: any = messages[i]
      if (m?.role === 'user') { users++; const t = textOf(m.content); if (t) lines.unshift(`[user] ${clip(t)}`) }
      else if (m?.role === 'assistant') {
        const calls = Array.isArray(m.content) ? m.content.filter((b: any) => b?.type === 'toolCall').map((b: any) => `[tool call] ${b.name}(${clip(JSON.stringify(b.arguments ?? {}))})`) : []
        const t = textOf(m.content); lines.unshift(...(t ? [`[assistant] ${clip(t)}`] : []), ...calls)
      } else if (m?.role === 'toolResult') { const t = textOf(m.content); if (t) lines.unshift(`[tool result${typeof m.toolName === 'string' ? ':' + m.toolName : ''}] ${clip(t)}`) }
    }
    return lines
  }
  private toolFacts(value: any): Record<string, unknown> {
    return { ...(typeof value?.toolName === 'string' ? { toolName: value.toolName } : {}), ...(typeof value?.isError === 'boolean' ? { isError: value.isError } : {}) }
  }
  private extractText(value: unknown): string | undefined {
    if (typeof value === 'string' && this.options.clipOversize === true) return value
    if (Array.isArray(value) && this.options.clipOversize === true) { const t = value.slice(0, this.limits.maxBlocks).filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n'); return t.length ? t : undefined }
    if (typeof value === 'string') { if (value.length > this.limits.maxSourceBytes || bytes(value) > this.limits.maxSourceBytes) throw new Error(); return value }
    if (!Array.isArray(value)) return undefined
    if (value.length > this.limits.maxBlocks) throw new Error()
    const result: string[] = []; let size = 0
    for (const block of value) if (block?.type === 'text') {
      if (typeof block.text !== 'string' || block.text.length > this.limits.maxSourceBytes || (size += bytes(block.text) + (result.length ? 1 : 0)) > this.limits.maxSourceBytes) throw new Error()
      result.push(block.text)
    }
    return result.length ? result.join('\n') : undefined
  }
  private validateReference(ref: Reference) {
    if (!ref || !text(ref.id) || ref.id.startsWith('event:') || ref.id.startsWith('material:') || ref.id.startsWith('window:') || !text(ref.kind) || !this.accepts(ref.kind) || !text(ref.version) || typeof ref.content !== 'string' || ref.content.length > this.limits.maxSourceBytes || bytes(ref.content) > this.limits.maxSourceBytes) throw new Error('invalid admitted host reference')
  }
  setReference(input: Reference): void {
    const ref = data(input); this.validateReference(ref)
    const old = this.materials.get(ref.id)
    if (old && old.version === ref.version && old.content !== ref.content) { this.fail(null, 'reference_version_conflict'); throw new Error('reference version conflict') }
    if (this.state !== 'running') throw new Error('material scope is not running')
    const entry: RealtimeMaterial = { ...ref, text: ref.content, provisional: false, provenance: { owner: 'host', observationId: null, sessionId: this.scope!.sessionId, binding: this.scope!.binding, sourceEvent: 'host.reference', cursor: null, step: 0, stage: 'host-provided' } }
    if (!this.put(entry, null)) throw new Error('host reference limit')
    this.base.set(ref.id, ref)
  }
  private put(input: RealtimeMaterial, frameId: string | null): boolean {
    const old = this.materials.get(input.id), size = bytes(input.content), total = this.size - (old ? bytes(old.content) : 0) + size
    if (size > this.limits.maxSourceBytes || !old && this.materials.size >= this.limits.maxSources || total > this.limits.maxBytes) {
      if (old) { this.materials.delete(old.id); this.size -= bytes(old.content) }
      this.fail(frameId, 'material_limit'); return false
    }
    this.materials.set(input.id, data(input)); this.size = total; return true
  }
  private removeLogical(kind: string, key: string) {
    const id = `material:${hash([this.scope, kind, key])}`, ref = this.materials.get(id)
    if (ref) { this.materials.delete(id); this.size -= bytes(ref.content) }
  }
  private reset() {
    this.generation++; this.gap = false; this.materials.clear(); this.frames.clear(); this.size = 0; this.intentInput = false
    for (const ref of this.base.values()) this.setReference(ref)
  }
  private fail(frameId: string | null, reason: string) { if (!this.gap) this.generation++; this.gap = true; this.note(frameId, reason) }
  private note(frameId: string | null, reason: string) { this.records.push(Object.freeze({ frameId, reason })); if (this.records.length > this.limits.maxTrace) { this.records.shift(); this.evictedTrace++ } }
  get scopeDependency(): Readonly<{ id: string; version: string }> {
    return Object.freeze({ id: `window:${hash(this.scope ?? null)}`, version: hash([this.state, this.scope, this.generation, this.gap]) })
  }
  sourceVersion(id: string): string | undefined { return id === this.scopeDependency.id ? this.scopeDependency.version : this.state === 'running' ? this.materials.get(id)?.version : undefined }
  snapshot(frameId: string, kinds: readonly string[], options?: Readonly<{ boundToFrame?: boolean; dedupe?: boolean; tailItems?: number }>) {
    const available = this.state === 'running' && !this.gap && this.frames.has(frameId)
    const own = available ? this.frames.get(frameId) ?? [] : []
    let materials = available ? [...this.materials.values()].filter(r => kinds.includes(r.kind) && !this.staleRegion(r.id)) : []
    if (available && options?.boundToFrame === true) {
      // A lagging judgement must not see events observed after the judged frame (for example the result of the very
      // tool call being judged). Host-provided references (cursor null) are not timeline events and stay visible.
      const bound = Math.max(...own.map(id => this.materials.get(id)?.provenance.cursor ?? -Infinity))
      if (Number.isFinite(bound)) materials = materials.filter(r => r.provenance.cursor === null || r.provenance.cursor <= bound)
    }
    if (options?.dedupe === true) {
      // The same text may be observed by two source events (for example input and the user message_end). Keep the
      // judged frame's own items and the first copy of any other item.
      const key = (r: RealtimeMaterial) => `${r.kind}\u0000${r.text}`
      const seen = new Set(materials.filter(r => own.includes(r.id)).map(key))
      materials = materials.filter(r => { if (own.includes(r.id)) return true; const k = key(r); if (seen.has(k)) return false; seen.add(k); return true })
    }
    if (options?.tailItems !== undefined && options.tailItems >= 0) {
      // Keep host references, the judged frame's own items and only the newest `tailItems` other observation items, so a
      // long turn keeps a bounded judge view.
      const others = materials.filter(r => r.provenance.owner === 'observation' && !own.includes(r.id)), keepOthers = new Set(others.slice(Math.max(0, others.length - options.tailItems)).map(r => r.id))
      materials = materials.filter(r => r.provenance.owner !== 'observation' || own.includes(r.id) || keepOthers.has(r.id))
    }
    return data({ available, materials, currentIds: available ? own.filter(id => materials.some(r => r.id === id)) : [], dependency: this.scopeDependency })
  }
  read(ref: Reference): Reference {
    const current = this.materials.get(ref.id)
    if (this.state !== 'running' || this.gap || !current || current.version !== ref.version || current.content !== ref.content || current.kind !== ref.kind) throw new Error('material source is no longer current')
    return data({ id: current.id, kind: current.kind, version: current.version, content: current.content })
  }
  /** task154: called by the selection bridge after THIS window's module was judged (any decision). Moves the region start
   * to the judged frame and keeps up to 4 short selected originals as the module memo. A failed judgement never calls
   * it, so that region is seen again. */
  markJudged(frameId: string, selected: readonly string[] = []): void {
    if (this.options.historyMode !== 'since-last' || this.state !== 'running') return
    const at = this.regionAt.get(frameId); if (at === undefined) return
    this.regionStart = Math.max(this.regionStart ?? 0, at)
    for (const t of selected) { const s = clipText(String(t).replace(/^\[(memo|state)\] /, ''), 400); if (s && !this.memo.includes(s)) this.memo.push(s) }
    while (this.memo.length > 4 || bytes(this.memo.join('\n')) > 1600) this.memo.shift()
  }
  get regionStatus() { return Object.freeze({ start: this.regionStart ?? null, memo: Object.freeze([...this.memo]), files: Object.freeze([...this.files]) }) }
  private staleRegion(id: string): boolean { const i = this.regionIndex.get(id); return i !== undefined && i < (this.regionStart ?? 0) }
  private clearRegion() { this.regionStart = undefined; this.regionAt.clear(); this.regionIndex.clear(); this.memo = []; this.files.clear() }
  get traces() { return Object.freeze([...this.records]) }
  getStatus() { return data({ state: this.state, enabled: this.options.enabled === true, scope: this.scope ?? null, observed: this.observed, cursor: this.cursor, sources: this.materials.size, bytes: this.size, retainedFrames: this.frames.size, evictedFrames: this.evictedFrames, evictedTrace: this.evictedTrace, generation: this.generation, available: this.state === 'running' && !this.gap }) }
  advanceIntent(): void { if (this.state === 'running') this.reset() }
  stop(): void { if (this.state === 'disposed') return; this.state = 'stopped'; this.generation++; this.materials.clear(); this.frames.clear(); this.size = 0; this.clearRegion() }
  dispose(): void { this.stop(); this.state = 'disposed' }
}
