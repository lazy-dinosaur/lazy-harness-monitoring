import { createHash } from 'node:crypto'

/**
 * Canonical JSON serialization shared by every monitoring hash (JS side; Python twin: .lazy-harness/scripts/canonical_json.py).
 * Rules: plain JSON data only; object keys sorted by UTF-16 code units (NOT JS insertion/integer-like order);
 * no whitespace; numbers finite and within the safe-integer range when integral, -0 -> 0, ECMAScript Number
 * formatting; strings escaped like JSON.stringify; lone surrogates, undefined, functions, symbols, bigint,
 * non-plain objects and cycles reject. Output is UTF-8 hashed with SHA-256.
 */
export class CanonicalJsonError extends Error { constructor(readonly code: string) { super(code); this.name = 'CanonicalJsonError' } }
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
function str(s: string): string { if (loneSurrogate.test(s)) throw new CanonicalJsonError('LONE_SURROGATE'); return JSON.stringify(s) }
function num(n: number): string {
  if (!Number.isFinite(n)) throw new CanonicalJsonError('NONFINITE_NUMBER')
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) throw new CanonicalJsonError('UNSAFE_INTEGER')
  return Object.is(n, -0) ? '0' : String(n)
}
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>()
  const walk = (v: unknown, depth: number): string => {
    if (depth > 64) throw new CanonicalJsonError('TOO_DEEP')
    if (v === null) return 'null'
    if (v === true) return 'true'
    if (v === false) return 'false'
    if (typeof v === 'number') return num(v)
    if (typeof v === 'string') return str(v)
    if (typeof v !== 'object') throw new CanonicalJsonError('NON_JSON_VALUE')
    if (seen.has(v)) throw new CanonicalJsonError('CYCLE')
    seen.add(v)
    try {
      if (Array.isArray(v)) {
        if (Object.keys(v).length !== v.length) throw new CanonicalJsonError('SPARSE_ARRAY')
        return '[' + v.map(x => walk(x, depth + 1)).join(',') + ']'
      }
      const proto = Object.getPrototypeOf(v)
      if (proto !== Object.prototype && proto !== null) throw new CanonicalJsonError('NON_PLAIN_OBJECT')
      if (Object.getOwnPropertySymbols(v).length) throw new CanonicalJsonError('SYMBOL_KEY')
      const keys = Object.keys(v).sort()
      return '{' + keys.map(k => { const d = Object.getOwnPropertyDescriptor(v, k)!; if (d.get || d.set) throw new CanonicalJsonError('ACCESSOR'); return str(k) + ':' + walk(d.value, depth + 1) }).join(',') + '}'
    } finally { seen.delete(v) }
  }
  return walk(value, 0)
}
export function canonicalJsonHash(value: unknown): string { return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex') }
