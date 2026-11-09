# Qualification review — issue #1, phase P0

Frozen source/test review baseline: **`8901b9432bde05f26ff64427b078974a0b823881`** (`8901b94`). Documentation branch: `qualification/p0`. This directory is an audit and decision package, not source implementation, activation approval, SDK qualification or release readiness.

## Documents

| Document | Purpose |
|---|---|
| [p0-baseline.md](p0-baseline.md) | Observed toolchain/lock/dependencies, complete package exports and symbols, current/excluded tests, package implementation inventory and migration debts |
| [requirements-matrix.md](requirements-matrix.md) | R1–R10 plus every P1–P7 checklist proof obligation: owner, exact symbol/test, evidence/proposed artifact, scoped status |
| [scenarios.md](scenarios.md) | Four review fixtures: references, rule advice, private read-only memory candidate and non-knowledge repeated-test-failure advice; expressibility limits |
| [acceptance-criteria.draft.md](acceptance-criteria.draft.md) | **DRAFT FOR USER DECISION**: purpose-specific proposed metrics/thresholds, denominators, sample sizes, durations, split protocol and stop rules |

## P0 exit criterion and present gate

Issue [#1](https://github.com/lazy-dinosaur/lazy-harness-monitoring/issues/1), read using `gh issue view 1 --repo lazy-dinosaur/lazy-harness-monitoring`, states:

> Deliverable: frozen review inventory, scenario/acceptance matrix and a list of excluded claims. Exit: every intended claim has an owner and measurable proof path.

The inventory, scenarios and proof-path matrix are supplied here. `verified` is limited to currently passing test behavior; whole requirements with remaining evidence are `gap`/`unsupported`, and future probes/artifacts are identified as proposed. **Acceptance values are not agreed** and P1 implementation/measurement must not infer that approval. User decisions below remain open; P0 is a review package submitted for decision, not an assertion that all acceptance discussions are closed.

Observed bounded test command: `bun test packages/core/test hosts/pi/test/pi-host.test.ts` → **164 pass / 0 fail, 684 expect() calls, 164 tests across 15 files**. Exact receipt is in the baseline. No typecheck, real SDK test, semantic benchmark, package consumer/install smoke, live session, paid inference, tmux drill or full-repository suite was run. Six pending test files were inspected, not run. Real-SDK tests remain pending.

## Decisions pending from the user

- **Acceptance thresholds:** approve/replace every proposed per-module/core quality/resource/cost number, denominators, sample/duration/stop rules, oracle/adjudication and dev/holdout separation. No prior local production-quality/performance acceptance evidence was found.
- **Pending-test dispositions:** individually approve restore/replace/retire for all six files; baseline recommendations are proposals only, with stale imports/fixtures/removed tap APIs explained.
- **P1 scenario/API scope:** decide asynchronous advice vs synchronous blocking, trigger/control-event support, approved provenance, restart durability and parent delivery semantics before minimal compatibility changes.
- **Pi SDK/capabilities:** select/pin actual SDK fixture/version and supported actions; declared steer/block is not implemented/qualified action support. Decide how startup must reject unsupported modules.
- **Fabric dependency placement:** explicitly **deferred until after P1**; core runtime remains independent. Fabric resident host / RPC daemon are deferred options, not current implementation commitments.
- **Placement:** leaning toward running **Pi inside tmux** so the in-session adapter continues if the terminal closes; **not final**. Approve placement/drills/runbook separately, and do not confuse detach survival with restart durability.
- **Data/budget/activation:** decide consent, retention, approved data sources, provider/model/call/USD/time envelope, kill switch and rollback owner before any later live shadow pilot or active read-only report. Memory remains read-only/observe until its own gate; no automatic knowledge writes or business mutations.
- **Cutover/release:** qualification and explicit thin-consumer cutover approval with rollback are future gates; no publishing/release/push authorization.

## Scope discipline

Only these five Markdown files are deliverables. Baseline source/test commit stays fixed even when this directory is committed later. No push, no GitHub issue edits/comments/closure, no source/test changes, no dependency installation/upgrades. `backup/pre-publish` is retained and must never be pushed. Historical acceptance records in lazy-harness are external and UNVERIFIED here; passing fake/CPU tests are not a substitute.
