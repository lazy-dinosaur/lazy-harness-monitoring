# lazy-harness monitoring

The monitoring core of lazy-harness, developed as its own monorepo so each part is built, tested and released separately.
TypeScript, Fabric-independent (ADR 0061 in lazy-harness); boundaries stay language-neutral (configuration schema,
`monitoring-trace/v1`, canonical JSON hashing).

## Layers

| Package | Owns |
|---|---|
| `packages/core` | engine + inspection ports: trigger points, per-module independent pipelines, between-region input + memo, purpose-scoped compaction, judgement, job runtime (loop guard, idempotency, budget, uncertain-stop), parent report, run stages, judgement trace |
| `hosts/<agent>` | host adapters owned by the host side, one per agent (`hosts/pi` now; opencode, OMP, Jcode later): turn agent events into ordered frames, deliver reports, implement host input ports, declare capabilities |
| `packages/eval` | ONE shared evaluation tool every module plugs into: replay → judge → score → version compare, oracle check, budgets, dev/holdout |
| `modules/*` | one purpose each (question, trigger points, inputs, jobs) with its own gold set and traces |

The core never imports a host. It defines the **Host Adapter contract** (`packages/core/src/host`): the frame vocabulary
and `ObservationFrame`, `HostCapabilities` (events emitted, actions such as inject-context / steer / block-tool-call,
snapshot depth), `hostSupportIssues` (reports unsupported trigger points/actions; current startup does not enforce
refusal — see the P1 review) and `frameSequenceIssues` (conformance every adapter passes). Pipelines take frames through `accept(frame)`.

Modules: `references` (U1), `rule-steering` (U6), `memory` (new). Data (traces, feedback marks, gold sets) is kept per module.

Records (design, decisions, measurements) stay in the lazy-harness repository under `.lazy-harness/`; see `MIGRATION.md`.

## Qualification reviews

- [Qualification index (issue #1, P0/P1)](docs/qualification/README.md)
- [P1 API/condition review and proposed deltas](docs/qualification/p1-api-condition-review.md)
- [Offline public-API examples and reproduction](examples/p1/README.md)

These are scoped review fixtures, not live-use approval or SDK qualification.
