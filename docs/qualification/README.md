# Qualification review — issue #1, phases P0/P1

Frozen source/test review baseline: **`8901b9432bde05f26ff64427b078974a0b823881`** (`8901b94`). Documentation branch: `qualification/p0`. This directory is an audit and decision package, not source implementation, activation approval, SDK qualification or release readiness.

## Documents

| Document | Purpose |
|---|---|
| [p0-baseline.md](p0-baseline.md) | Observed toolchain/lock/dependencies, complete package exports and symbols, current/excluded tests, package implementation inventory and migration debts |
| [requirements-matrix.md](requirements-matrix.md) | R1–R10 plus every P1–P7 checklist proof obligation: owner, exact symbol/test, evidence/proposed artifact, scoped status |
| [scenarios.md](scenarios.md) | Four review fixtures: references, rule advice, private read-only memory candidate and non-knowledge repeated-test-failure advice; expressibility limits |
| [Memory module design](../design/memory-module.md) | DESIGN ONLY / PROPOSAL: new observe-first, separately approved shadow candidate template; exact evidence, private volatile review sink, no injection/writes, R7/P5 gaps and user decisions |
| [Host input port options](../design/host-input-ports.md) | DESIGN ONLY / PROPOSAL: current declared needs/resolution inventory; Pi vs composition vs split ownership; version-aware AlreadyRead contract and described fake conformance |
| [References module](../../modules/references/README.md) | Approved step-3 migration: public API, host wiring, invented test-protection disposition and scripted real-module replay; semantic quality remains P5, not qualified |
| [acceptance-criteria.draft.md](acceptance-criteria.draft.md) | **PROVISIONALLY ADOPTED FIRST BASELINE (user 2026-11-09)**: metrics/thresholds, denominators, sample sizes, durations, split protocol and stop rules; re-confirm before P5 measurement; not measured |
| [p5-plan.md](p5-plan.md) | P5 plan for user approval: migration prerequisites, cited prior evidence, threshold re-confirmation, sealed dev/holdout protocol, proposed model/budget envelope and explicit decisions; no measurement or activation approval |

## P1 review receipt and next gate

- [p1-api-condition-review.md](p1-api-condition-review.md): original 29-condition review and approved implementation ledger. Deltas **1/2/3/6/7/8/9/12 implemented**; 4/5/10/11 remain proposals. D1' is authoritative.
- [Runnable offline examples](../../examples/p1/README.md): public-export consumers, explicit existing-package link setup (no install), scripted judge/worker outputs.
- Original P1 boundary/scenario/API fixtures were flipped for corrected behavior. Six new follow-up test files cover startup, report identity, lifecycle, retention, receipts and worker-port conformance. Pre-existing helper changes and reasons are listed in the P1 ledger.
- Final exact scoped command: `bun test packages/core/test hosts/pi/test/pi-host.test.ts` → **244 pass / 0 fail, 1515 expect() calls, 244 tests across 24 files**. All three `bunx tsc -p` commands (core, Pi, examples) exited 0 with no output; verbatim summary is in the P1 review.
- This verifies finite offline startup/trigger/lifecycle/retention/receipt/worker-port mechanics, not whole P2/P3 safety closure. Real SDK/physical worker/actual provider-input receipt and D2 metrics remain UNVERIFIED. D1'/D2 remain in force; no live/paid/semantic qualification or cutover approval.

## P0 exit criterion and present gate

Issue [#1](https://github.com/lazy-dinosaur/lazy-harness-monitoring/issues/1), read using `gh issue view 1 --repo lazy-dinosaur/lazy-harness-monitoring`, states:

> Deliverable: frozen review inventory, scenario/acceptance matrix and a list of excluded claims. Exit: every intended claim has an owner and measurable proof path.

The inventory, scenarios and proof-path matrix are supplied here. `verified` is limited to currently passing test behavior; whole requirements with remaining evidence are `gap`/`unsupported`, and future probes/artifacts are identified as proposed. **D2 (user-confirmed 2026-11-09): acceptance numbers are provisionally adopted as the first baseline so P1 can start; the user must re-confirm them before any P5 measurement. They are not measured results.** Remaining decisions below stay open; this is not an assertion that all acceptance discussions are closed.

Original P0 baseline observed bounded test command: `bun test packages/core/test hosts/pi/test/pi-host.test.ts` → **164 pass / 0 fail, 684 expect() calls, 164 tests across 15 files**. Exact receipt is in the baseline. At that frozen baseline, no typecheck, real SDK test, semantic benchmark, package consumer/install smoke, live session, paid inference, tmux drill or full-repository suite was run. Six pending test files were inspected, not run. Real-SDK tests remain pending.

Decision follow-up verification: `bun test packages/core/test hosts/pi/test/pi-host.test.ts` → **164 pass / 0 fail, 685 expect() calls, 164 tests across 15 files**. Test count unchanged; one missing-action assertion added. `bunx tsc -p packages/core/tsconfig.json` and `bunx tsc -p hosts/pi/tsconfig.json` both exited successfully with no diagnostics, using the existing local compiler. These are mechanical checks, not P5 measurements, real-SDK qualification or connector implementation evidence.

## Confirmed decisions (user 2026-11-09)

- **D1' — module-owned worker boundary (option A, user confirmed 2026-11-07; meaning confirmed between sessions 2026-11-09):** no package in this repository depends on `pi-fabric`. Core owns an independent worker execution port (run/start, wait, cancel/stop, timeout, concurrency/lifetime limits and terminal/uncertain outcomes), plus reusable fake-backed conformance tests; its shape must not mirror Fabric. The former `hosts/pi-fabric` plan is superseded: there will be no such package here. The `lazy-harness` composition repository implements the port with EXACT-pinned `pi-fabric` and owns the first bun/Node >=24 export-loading probe in issue #1 P7 thin-consumer work, not P3 here. Fabric resident host/Jev observation are not an event source or delivery guarantee. Session persistence is separate; tmux remains provisional and RPC daemon deferred.
- **D2 — Provisional thresholds:** the acceptance document's numbers are the first baseline for P1, not measured results; user re-confirmation is mandatory before any P5 measurement.

## Decisions pending from the user

- **Acceptance thresholds / measurement protocol:** re-confirm or replace the provisionally adopted per-module/core quality/resource/cost numbers, denominators, sample sizes/durations/stop rules before P5; confirm oracle/adjudication and dev/holdout separation. No prior local production-quality/performance acceptance evidence was found.
- **Pending-test dispositions:** individually approve restore/replace/retire for all six files; baseline recommendations are proposals only, with stale imports/fixtures/removed tap APIs explained.
- **P1 scenario/API scope:** decide asynchronous advice vs synchronous blocking, trigger/control-event support, approved provenance, restart durability and parent delivery semantics before minimal compatibility changes.
- **Pi SDK/capabilities:** select/pin actual SDK fixture/version; Pi now declares only implemented `inject-context`. Steer/block-tool-call executors remain future work. Decide how startup must reject unsupported modules.
- **Placement:** leaning toward running **Pi inside tmux** so the in-session adapter continues if the terminal closes; **not final**. Approve placement/drills/runbook separately, and do not confuse detach survival with restart durability.
- **Data/budget/activation:** decide consent, retention, approved data sources, provider/model/call/USD/time envelope, kill switch and rollback owner before any later live shadow pilot or active read-only report. Memory remains read-only/observe until its own gate; no automatic knowledge writes or business mutations.
- **Cutover/release:** qualification and explicit thin-consumer cutover approval with rollback are future gates; no publishing/release/push authorization.

## Scope discipline

The original P0 deliverables were these five Markdown files; the frozen source/test baseline stays fixed. This decision follow-up also narrows `hosts/pi/src/attach.ts` capabilities and updates `hosts/pi/test/pi-host.test.ts`, with bounded tests/typechecks only. No push, no GitHub issue edits/comments/closure, no dependency installation/upgrades. `backup/pre-publish` is retained and must never be pushed. Historical acceptance records in lazy-harness are external and UNVERIFIED here; passing fake/CPU tests are not a substitute.
