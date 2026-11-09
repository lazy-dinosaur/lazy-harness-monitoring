# lazy-harness monitoring

The monitoring core of lazy-harness, developed as its own monorepo so each part is built, tested and released separately.
TypeScript, Fabric-independent (ADR 0061 in lazy-harness); boundaries stay language-neutral (configuration schema,
`monitoring-trace/v1`, canonical JSON hashing).

## Layers

| Package | Owns |
|---|---|
| `packages/core` | engine + inspection ports: trigger points, per-module independent pipelines, between-region input + memo, purpose-scoped compaction, judgement, job runtime (loop guard, idempotency, budget, uncertain-stop), parent report, run stages, judgement trace |
| `packages/pi-host` | Pi extension binding: observer hooks, context injection, host input ports (e.g. records already read) |
| `packages/eval` | ONE shared evaluation tool every module plugs into: replay → judge → score → version compare, oracle check, budgets, dev/holdout |
| `modules/*` | one purpose each (question, trigger points, inputs, jobs) with its own gold set and traces |

Modules: `references` (U1), `rule-steering` (U6), `memory` (new). Data (traces, feedback marks, gold sets) is kept per module.

Records (design, decisions, measurements) stay in the lazy-harness repository under `.lazy-harness/`; see `MIGRATION.md`.
