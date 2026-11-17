const bytes = (s: string) => Buffer.byteLength(s, 'utf8')
/** Deterministic UTF-8 prefix, never split a code point. */
export function utf8Prefix(s: string, max: number): string {
  let out = '', used = 0
  for (const c of s) { const n = bytes(c); if (used + n > max) break; out += c; used += n }
  return out
}
/** Derived context, not instructions. Preserve Markdown headers first, then fairly
 * share body bytes among sections. Omission counts original bytes, not markers. */
export function boundedSummary(source: string, maxBytes: number, alreadyOmitted = 0): { text: string; omittedBytes: number } {
  maxBytes = Math.max(0, Math.floor(maxBytes))
  const total = bytes(source)
  if (total <= maxBytes && alreadyOmitted === 0) return { text: source, omittedBytes: 0 }
  const sections = source.split(/(?=^#{1,6}[^\S\n]+\S)/m).filter(Boolean).map(s => {
    const m = /^(#{1,6}[^\S\n]+[^\n]*\n?)/.exec(s)
    return { header: m?.[0] ?? '', body: s.slice(m?.[0].length ?? 0) }
  })
  const markerReserve = bytes(`\n[summary omitted ${total + alreadyOmitted} bytes]`)
  if (markerReserve > maxBytes) return { text: '', omittedBytes: total + alreadyOmitted }
  const budget = maxBytes - markerReserve
  const headers = sections.reduce((n, s) => n + bytes(s.header), 0)
  let body = '', retained = 0
  // Reserve separators to keep every retained header at the start of a line.
  if (headers + Math.max(0, sections.length - 1) > budget) {
    body = utf8Prefix(sections.map(s => s.header).join(''), budget); retained = bytes(body)
  } else {
    const bodies = sections.map(() => ''), points = sections.map(s => Array.from(s.body)), at = sections.map(() => 0)
    let left = budget - headers - Math.max(0, sections.length - 1)
    while (left > 0) {
      let changed = false
      for (let i = 0; i < sections.length; i++) {
        const c = points[i]![at[i]!]
        if (c !== undefined && bytes(c) <= left) { bodies[i] += c; at[i]!++; left -= bytes(c); changed = true }
      }
      if (!changed) break
    }
    retained = headers + bodies.reduce((n, s) => n + bytes(s), 0)
    body = sections.map((s, i) => s.header + bodies[i]).join('\n')
  }
  const omittedBytes = total - retained + alreadyOmitted
  return { text: body + `\n[summary omitted ${omittedBytes} bytes]`, omittedBytes }
}
