/**
 * Default secret redaction for observed agent text (engine rule: always on, not a module option).
 * Replaces secret-shaped substrings with `[REDACTED:<kind>]` before material can reach a judge or worker.
 * Deterministic and conservative: it targets well-known credential shapes and explicit key=value assignments;
 * it is not a guarantee that every secret is caught.
 */
const rules: ReadonlyArray<readonly [string, RegExp]> = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['bearer', /\b(Bearer)\s+[A-Za-z0-9._~+\/-]{16,}=*/g],
  ['sk-key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['assignment', /\b((?:api[_-]?key|secret|token|password|passwd|access[_-]?key|client[_-]?secret)\s*[:=]\s*)(["']?)[^\s"',;]{8,}\2/gi],
]
export function redactSecrets(text: string): string {
  let out = text
  for (const [kind, re] of rules) out = out.replace(re, (...m: string[]) => kind === 'bearer' ? `${m[1]} [REDACTED:${kind}]` : kind === 'assignment' ? `${m[1]}[REDACTED:${kind}]` : `[REDACTED:${kind}]`)
  return out
}
