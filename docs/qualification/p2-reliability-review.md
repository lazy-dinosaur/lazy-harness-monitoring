# P2 — core mechanical reliability and failure isolation (issue #1)

## Default stage changed to observe — BREAKING

Omitting a module's run stage now selects `observe`, both in direct runtime registration and SDK configuration composition. Jobs, effects and reports do not run; diagnostic job traces identify `observe`. Consumers relying on the implicit active default must now pass `stage: 'active'` explicitly. Explicit `shadow`/`active` semantics and declaration-level `maxStage` ceilings (including the default active ceiling) are unchanged; configuration still cannot exceed the declared ceiling.

## Implemented fixes

User-approved option A supersedes the three historical findings below. The original review and receipts remain historical evidence, not current behavior. P1 deltas 4, 5, 10 and 11 remain out of scope; R7 persistence is not implemented.

| Finding | Implementation commit | Correct-behavior tests and proof |
|---|---|---|
| P2-F1 | `3f4bee0` — `fix(core): P2-F1 - strictly validate snapshot admission` | Flipped shallow-snapshot witness in `p2-frames.test.ts`; added `p2-admission.test.ts` and three pipeline rejection cases in `p2-selection.test.ts`. Required structure/types, session consistency, unknown fields, nested accessors, valid unavailable shape, copying/freezing and no judgement are covered. |

P2-F2 → `be5668e` — `fix(runtime): P2-F2 - reject malformed worker completions` → flipped unsupported-status witness in `p2-runtime.test.ts`; added 40 cases in `p2-completions.test.ts`. Coverage includes null/undefined/primitives/encoded objects, inherited/extra fields, missing/invalid status, malformed report/effect/output, UTF-8 report bound, cycles/oversized output, nested getters, malformed envelopes, every valid status, missing effect receipt, copy isolation, uncertain-key deduplication, and raw budget reservation retention.

P2-F2 local verification: `bun run test` — 402 pass, 0 fail, 2335 assertions across 30 files. All three typechecks listed below exited 0 without compiler output; the optional test tsconfig remains absent. The first full run exposed four P1 scenario failures because their shared `examples/p1/support.ts` fixture emitted an absent `subjectKey` as `undefined` inside output. A one-line conditional spread now omits that absent optional key, producing valid plain JSON. **Pre-existing fixture changed:** this shared P1 helper only; no P1 scenario assertion was changed or weakened. The passing rerun includes all four previously failing scenarios.

P2-F2 API: no exports added/removed, no type signatures changed. **BREAKING result-data tightening:** worker completions (including the envelope) must be own-data, bounded plain JSON with declared keys and supported discriminants. Optional `output` remains module-owned JSON, not a provider schema; optional `report.text` is bounded to 65536 UTF-8 bytes, `effectId` to 512 nonempty characters. Malformed input becomes `uncertain` / `malformed_worker_result`, no report, no retry; valid `unknown` and missing-effect behavior retain their existing reasons. Raw settlement still owns budget release. The `JobResult` documentation states the data bounds.

P2-F1 local verification: `bun run test` — 362 pass, 0 fail, 2173 assertions across 29 files. `bunx tsc -p packages/core/tsconfig.json`, `bunx tsc -p hosts/pi/tsconfig.json`, and `bunx tsc -p examples/p1/tsconfig.json` each exited 0 without compiler output. `hosts/pi/test/tsconfig.json` does not exist. Initial new pipeline assertions used the wrong fixture property (`requests` instead of `calls`); corrected before this passing full run. No other pre-existing test changed.

Public API: added `parseObservationFrame(input: unknown): ObservationFrame` through the existing `/host` export (implemented in `packages/core/src/host/frames.ts`; no direct frame subpath export). It uses the existing bounded plain-JSON parser and returns a frozen copy. Malformed frames stop coordinator/pipeline as `malformed` (technical admission failure), before preparation, material capture or judgement; valid unavailable snapshots remain observable without preparation. **BREAKING for malformed/untyped adapters:** missing/wrong snapshot fields and undeclared structural keys now reject instead of being prepared. No exported frame type changed.

P2-F3 → `2d2cd4d` — `fix(mailbox): P2-F3 - isolate source lookup failures` → flipped the throwing-source witness in `p2-mailbox.test.ts`, added four cases for first/middle/last fault placement and a failing later dependency. A failed source lookup drops that item, records `source_check_failed` in the existing bounded trace, preserves its seen identity, and continues the healthy items in insertion order. Recovery of the source callback cannot redeliver the dropped item. Healthy later admissions still work subject to the existing seen capacity.

P2-F3 local verification: targeted mailbox tests — 12 pass, 0 fail, 99 assertions; `bun run test` — 406 pass, 0 fail, 2389 assertions across 30 files. All three typechecks exited 0 without compiler output; the optional test tsconfig remains absent. No pre-existing test changed except the required finding witness.

P2-F3 API: no exports added/removed; `CarryTrace.reason` gains `source_check_failed`. **BREAKING for exhaustive reason consumers / exception-dependent callers:** source callback errors no longer escape `take`; a failed item is dropped rather than left pending, while its deduplication protection remains. No new persistence or delivery capability is claimed.

Capability matrix: unchanged; Pi still declares only `inject-context`, snapshot mode `tail`. No new actions, dependencies, registrations, configuration keys, worker features or persistence capabilities.

### Fix verification receipts

Final source-changing commit: `2d2cd4d93f2e274a4d65fa70efe0342e5edb80e0`. Each finding commit passed `bun run test` and the three existing typechecks before commit; commands and finite counts are recorded above. No dependencies, manifests, lockfile, shared capability matrix, or protected backup were changed. A restricted-literal scan over all changed files returned no matches. No push, GitHub write, paid model call or real provider experiment was performed.

Local `bun run test` summary, verbatim:

```text
 406 pass
 0 fail
 2389 expect() calls
Ran 406 tests across 30 files. [3.16s]
```

A unique detached worktree was created with `git worktree add --detach /tmp/monitoring-p2-clean-<unique> HEAD`. There, `bun install --frozen-lockfile`, `bun run test`, and all existing requested typechecks ran. Receipt, verbatim:

```text
CHECKOUT 2d2cd4d93f2e274a4d65fa70efe0342e5edb80e0
bun install v1.3.14 (0d9b296a)

+ @types/bun@1.4.4
+ typescript@7.0.2

16 packages installed [28.00ms]

 406 pass
 0 fail
 2389 expect() calls
Ran 406 tests across 30 files. [3.09s]
packages/core: exit 0 (no compiler output)
hosts/pi: exit 0 (no compiler output)
examples/p1: exit 0 (no compiler output)
hosts/pi/test/tsconfig.json: absent
checkout status: clean
verification_exit=0 cleanup_exit=0
```

The temporary worktree was removed. The following report-only commit does not change executable code; its final-HEAD recheck is reported separately by the worker. **Remaining UNVERIFIED:** real SDK/provider delivery, external worker hard termination, adversarial proxy behavior, unbounded fault combinations, heap/soak/performance/quality measurements, and all R7 restart durability. The three findings are fixed for the finite tested data/callback fault cases, not a new universal safety or persistence claim. Pi capabilities remain unchanged.

## Scope and gate decision (historical review)

Review base: `qualification/p1` at `50b3263`. Tests/helpers commit: `e956b19a70031b51bdf75cfc3de5e9f7a1c5fdd7` on `qualification/p2`. The subsequent commit adds only this document. No existing source, tests, manifests, lockfiles, configuration, shared qualification index or shared requirements matrix were edited. No push or GitHub write occurred; the issue was read using the requested CLI command. No paid inference, live session data, or business mutation was used. Only the required frozen dependency installation used package downloads.

**Decision: finite offline reliability evidence, NOT unconditional P2 acceptance.** Added 71 tests in four files, bringing the requested regression scope from 244 to 315 tests. Three passing `FINDING:` witnesses assert current limitations, not desired safety invariants. Their proposed changes require approval. D1' remains in force: the worker boundary is module-owned and no optional orchestration dependency was added. D2 acceptance figures remain provisional/unmeasured. Pi capability remains only `inject-context`. P1 deltas 4, 5, 10 and 11 remain unimplemented proposals; this review does not implement them indirectly.

All new library imports use the root package, `/host`, or the existing `/engine/*.ts` export. Local fixtures reuse `examples/p1/support.ts`'s scripted model backend. There are no real provider endpoints in the new tests. Test callbacks are deterministic local functions, not model answers executed as code.

### Evidence vocabulary

- **PASS**: the finite named assertion passed, with scope described below.
- **FINDING**: a passing assertion of current undesirable or incomplete behavior; not a qualification pass.
- **DESIGN ONLY / UNVERIFIED**: proposed contract or missing proof; not an existing exported API.
- Object-count checks use exposed status getters and collection snapshots, not heap/RSS/GC measurements. Retained protection identities intentionally do not fall to zero after drain.
- `reported: true` is an enqueue receipt, not proof of actual provider-input delivery. Diagnostic judgement traces are not reports or effect receipts.

## Reproduction and receipts

Toolchain actually used: Bun `1.3.14 (0d9b296a)`, TypeScript `7.0.2`. Exact regression command:

```sh
bun test packages/core/test hosts/pi/test/pi-host.test.ts
bunx tsc -p packages/core/tsconfig.json
bunx tsc -p hosts/pi/tsconfig.json
bunx tsc -p examples/p1/tsconfig.json
```

Final local test summary, verbatim:

```text
bun test v1.3.14 (0d9b296a)

 315 pass
 0 fail
 2058 expect() calls
Ran 315 tests across 28 files. [3.35s]
```

Each exact typecheck above exited **0 with no compiler output**. The command wrapper printed these receipts, verbatim:

```text
packages/core: exit 0 (no compiler output)
hosts/pi: exit 0 (no compiler output)
examples/p1: exit 0 (no compiler output)
```

Before the final documentation commit, a unique detached worktree under `/tmp/monitoring-p2-e956b19-*` was created with `git worktree add --detach <path> HEAD`. At that checkout:

```text
CHECKOUT e956b19a70031b51bdf75cfc3de5e9f7a1c5fdd7
bun install v1.3.14 (0d9b296a)

+ @types/bun@1.4.4
+ typescript@7.0.2

16 packages installed [178.00ms]
bun test v1.3.14 (0d9b296a)

 315 pass
 0 fail
 2058 expect() calls
Ran 315 tests across 28 files. [3.11s]
packages/core: exit 0 (no compiler output)
hosts/pi: exit 0 (no compiler output)
examples/p1: exit 0 (no compiler output)
TRACKED STATUS
verification_exit=0 cleanup_exit=0
```

Installation command was exactly `bun install --frozen-lockfile`. Tests and typechecks were the same four commands above. `git diff --exit-code` and tracked status were empty after installation/testing. The detached worktree was removed successfully. This receipt qualifies the tests/helpers commit; the final commit adds only this report, not different executable code. Timings are raw run receipts, NOT benchmarks or D2 measurements. The six pending Pi migration files were not included by this explicit test command.

Development checks also ran `bun test packages/core/test/p2-*.test.ts` (70 pass before the final pending-provider isolation case was added); the final regression includes all 71 new cases. Initial new-fixture errors were corrected: automatic-job fixtures lacked the required synthetic acceptance reference (not a measured acceptance set), and a reference-revision assertion incorrectly expected an unrelated module to be invalidated. No pre-existing assertion was weakened. Malformed grep patterns caused inspection failures, and one interrupted regression was rerun to completion; neither is product evidence.

## Source → test mapping

Paths below are relative to the repository. `F` = `packages/core/test/p2-frames.test.ts`; `R` = `packages/core/test/p2-runtime.test.ts`; `S` = `packages/core/test/p2-selection.test.ts`; `M` = `packages/core/test/p2-mailbox.test.ts`. These aliases always denote the new files at the test commit, not historical P1 tests.

| Current source / public symbol | Responsibility traced before editing | New proving range |
|---|---|---|
| `packages/core/src/engine/monitoring-core-realtime.ts:84–167`, `RealtimeMonitoringCoordinator.accept/takeReady` | Copy/validate JSON, scope/identity/cursor admission; lifecycle generations; offer-time freshness | F:6–71 |
| Same file `:174–211,216–266`, `invalidReason/pump/getStatus` | Permission/source rechecks, raw-active ownership, bounded queues/ready/diagnostics | F:72–111 |
| `packages/core/src/engine/monitoring-core-realtime-material.ts:101–124,243–250,318–321`, `RealtimeMaterialWindow` | Observation provenance, allowed kinds, references, bounded frames and cleanup | S:8–18,20–56,82–105 |
| `packages/core/src/engine/monitoring-core-realtime-selection.ts:136–173,174–281,289–333`, independent pipelines | Guarded model dispatch, grant-scoped material, stale result suppression, independent raw work | S:20–105 |
| `packages/core/src/engine/monitoring-engine-runtime.ts:99–190`, `MonitoringModuleRuntime` | Stage/loop guard, idempotency, budget, result/report processing, error containment | R:7–128 |
| `packages/core/src/engine/runtime-work-queue.ts:23–73`; `packages/core/src/sdk/worker-execution-memory.ts:5–32` | Logical terminal versus raw settlement, global caps, cancellation, never-settling work | R:26–67; F:72–94; S:58–81 |
| `packages/core/src/engine/monitoring-engine-runtime.ts:39–76,80–87` | Budget leases/revoke; protection store capacity distinct from outcome ring | R:26–40,106–120 |
| `packages/core/src/sdk/declaration.ts:83–114`, effective configuration helpers | Watch subset, report subset, risk/stage tightening; frozen job grants | R:68–94 |
| `packages/core/src/engine/monitoring-core-context-mailbox.ts:24–58`, `ContextCarryMailbox` | Age/branch/session/source/carry gate; count/seen/trace bounds; callback failure | M:7–34 |
| `packages/core/test/support/p2-scheduler.ts:1–52`, `p2-fixtures.ts:1–29` | Seeded schedules, virtual timers, deferred physical completion, exported API fixture composition | F:62–83; R:7–51; S:58–81 |

The existing public `WorkerExecutionPort` and `runWorkerPortConformance` are exercised by the unchanged baseline worker-port tests in the full regression. No new registration, public symbol, configuration key or persistence API was implemented. Constructors in the low-level engine exports are trusted composition mechanics, not substitutes for configured startup preflight.

## Fault matrix

Every row gives the observed result, not an unbounded safety guarantee.

| Case / injected fault | Evidence | Result |
|---|---|---|
| Identical duplicate frame | F:6–17 | PASS: one admission/preparation/offer; exact frame/session/binding/dependency provenance; repeated take empty |
| Same frame ID with changed body | F:18–33 | PASS: `identity_conflict`, stop, late preparation discarded |
| Cursor jump or old cursor with new ID | F:18–33 | PASS: `source_gap`, stop, retained raw work then drain; no silent success |
| Session or binding change during work | F:18–33 | PASS: `scope_changed`, queued/ready invalidation, late result discarded |
| Branch/tree, compact, model, thinking or intent change | F:34–40; S:40–56 | PASS: offered lease revoked; late branch result produces no packet |
| Missing/cross-session/non-JSON snapshot, invalid availability | F:41–48 | PASS: malformed stop before preparation |
| Frame/snapshot explicitly unavailable | F:49–53 | PASS: observed but no preparation; unavailable trace |
| Snapshot contains only session ID and availability | F:54–61 | FINDING P2-F1: coordinator accepts shallow shape and prepares |
| Permission/source revocation interleaved with resolution | F:62–71 | PASS: no stale offer; same seed produces same schedule |
| Permission/source/dependency callback error; throwing prepare; malformed prepared result | F:103–111 | PASS: contained, no ready output, raw-active/queue drain |
| Coordinator timeout at virtual 10ms | F:72–83 | PASS: raw slot stays occupied; next frame waits; only next frame becomes ready |
| Coordinator queue/event/ready bounds | F:84–102 | PASS: explicit overflow/event stop; no ready-byte residue after take/drain |
| Judge throws; malformed classifier output; invalid choice; provider error result | S:20–39 | PASS: faulty module has no packet; healthy peer has exact observation provenance, no policy grant leak |
| Judge returns after permission/reference/branch/halt/dispose | S:40–56 | PASS: stale outputs withheld; unrelated policy-excluded peer remains current on policy-only change |
| Provider virtual timeout | S:58–67 | PASS: raw preparation remains active until stub settles; no late packets |
| Pending noncooperative judge, independent healthy peer | S:68–81 | PASS: peer delivers before fault releases; halt does not pretend raw work settled |
| Disabled selection | S:82–86 | PASS: no provider call/material capture |
| Twenty fresh register/drain/dispose cycles | S:87–105 | PASS: exposed work counts zero; traces ≤4, retained frames ≤3; disposed material sources/bytes/frames zero |
| Multi-module queued contention plus duplicate/worker/receiver/trace faults | R:7–25 | PASS for four seeds: raw-active 1, queue 2 before release; one call/module; healthy receipt enqueued despite peers; no duplicate execution |
| Runtime virtual timeout and revocation | R:26–40 | PASS: uncertain consumed key; raw reservation retained; queue refuses excess; late report suppressed; revoked budget cleared only at raw settlement |
| Caller abort, stop, dispose during active/queued work | R:41–52 | PASS: active uncertain, queued terminal skip, raw-active retained until release; no late report |
| Already-aborted caller | R:53–58 | PASS: no handler invocation; reservation settles without spending |
| Truly never-settling worker | R:59–67 | PASS: dispose logically finishes but raw-active stays 1; finite observation shows idle has not resolved; no hard-kill claim |
| Off/observe/shadow/active; effectful shadow; disabled/missing handler | R:68–82,105–115 | PASS: runtime job/report semantics, no shadow effect handler invocation, disabled job needs no handler, enabled missing handler rejects |
| Configuration grant/watch/risk/report/stage tightening | R:83–94 | PASS: no widening via tested helpers; job grant object frozen |
| Feedback from own report with explicit origin; excessive cross-module depth | R:95–105 | PASS: loop guard skips, one handler call; origin attribution remains caller-owned |
| Sixty-four drained keys / bounded outcomes | R:105–115 | PASS: raw-active/queue zero, outcomes retained 4/evicted 60, keys retained 64; overflow fails closed; old key still duplicate |
| Handler exceeds declared budget | R:116–120 | PASS: uncertain typed budget reason, no report |
| Unsupported worker result status crosses port | R:121–128 | FINDING P2-F2: invalid status retained and reported, duplicate key consumed |
| Mailbox branch/session/source/age/carry invalidation | M:7–16 | PASS: stale material removed; seen identity still rejects repeated put |
| Mailbox age boundary/carry/overflow/seen retention | M:17–27 | PASS: boundary age 10 accepted; one carry/delivery; pending zero, seen 3, traces 3, explicit capacity refusal |
| Mailbox source-version callback throws | M:28–34 | FINDING P2-F3: shared take throws, both modules remain pending; retry after callback recovery drains both |

### Important ownership limits

Selection freshness is verified before publish and when taking offers. Runtime triggers do not carry the selection lease or a branch/revision resolver: manual composition must preserve freshness and propagate cancellation into `onTrigger`. The absent safe v2 composition remains P1 delta 5, not implemented here. These tests do not prove that an arbitrary consumer cannot hand a stale trigger to the runtime or that an arbitrary trusted handler cannot mutate a business system. Shared runtime limits can deliberately block unrelated queued modules behind a noncooperative raw worker; independent selection pipelines do not establish runtime fairness or hard termination. Do not release occupied slots to manufacture availability.

Stage assertions cover the runtime boundary: off/observe invoke no jobs, shadow invokes only read-only jobs and withholds enqueue, active allows enqueue. Disabled pipeline coverage proves no judge work. Correct composition of stage-specific judgement/observation and a real host remains UNVERIFIED, not inferred from runtime skips. Feedback protection assumes honest `origin`; an unlabelled externally injected report is not automatically recognized by text. Authenticated provenance, raw-payload normalization and P1 delta 11 remain separate.

## Determinism and seeds

`SeededScheduler` uses a fixed 32-bit LCG and Fisher–Yates shuffle. Fixed microtask flush counts expose scheduled callbacks without elapsed-time sleeps. Deferred gates hold actual workers so contention exists before release. `ManualClock` replaces only timeout/clearTimeout during each owning test, restores them in `finally`, and advances to exact due deadlines. The mailbox takes explicit `now`. Real `performance.now()` diagnostic timestamps and suite timings are deliberately NOT deterministic assertions. These tests must not be opted into concurrent execution while the global timer replacement is installed.

A direct Bun import probe printed the following permutations from the committed helper:

| Seed (decimal / hex) | Freshness schedule | Contention arrival schedule |
|---|---|---|
| 1 / `0x1` | resolve → revoke → source | sink → good → good → bad |
| 42 / `0x2a` | resolve → source → revoke | bad → good → good → sink |
| 24301 / `0x5eed` | resolve → revoke → source | good → good → sink → bad |
| 12648430 / `0xc0ffee` | revoke → resolve → source | good → good → bad → sink |

Seeds intentionally have a repeated freshness permutation; four seeds are not exhaustive schedule coverage. Reproduce with the exact full test command or `bun test packages/core/test/p2-*.test.ts`; test names contain decimal seeds. Source revocation after ready is still checked at offer time. Failures retain deterministic assertions rather than probabilistic reruns.

## Findings and PROPOSED minimal deltas — approval required

### P2-F1 — shallow snapshot validation

- Problem: coordinator admission checks JSON, matching snapshot session and boolean availability, but not the required snapshot structure. A typed host can be correct while untyped/replayed input violates the contract; F:54–61 proves that the low-level coordinator can prepare this malformed input. It does not prove exposure of an actual host secret or invalid business effect.
- Smallest proposed change: a side-effect-free own-data snapshot/frame validator at the module-owned admission boundary, reused by pipeline and coordinator; validate required branch/message arrays, revision/hash/stage, availability and declared omissions without invoking getters. Unavailable snapshots still have an explicit legal shape. Keep payload semantic guards separate.
- Files: `packages/core/src/host/frames.ts`, `packages/core/src/engine/monitoring-core-realtime.ts`, pipeline admission if needed, F.
- Compatibility: malformed untyped adapters/replays now fail closed; valid exported frame shapes unchanged. Do not silently require full provider context.
- Proving test after approval: flip the `FINDING:` to no preparation/malformed stop, cover valid unavailable snapshots and accessors, run host normalization fixtures.
- Risk/blocker: validation drift between generated and host contracts; blocks P3 claims for arbitrary malformed-frame admission and P6 untrusted-replay use. Normalized trusted fixtures remain scoped evidence.

### P2-F2 — unchecked worker result shape

- Problem: `JobResult` is only a static type at the injected worker boundary; runtime reads `status` without a runtime allowlist. R:121–128 returns an unsupported status and observes `reported: true` plus `duplicate:invalid-status`.
- Smallest proposed change: validate/copy the completed value before setting its result state or report construction. Require own-data object, legal status, bounded report text, valid optional effect receipt/output; malformed completion becomes uncertain, consumes the key, and never enqueues. Keep raw settlement independent of logical validation.
- Files: `packages/core/src/engine/monitoring-engine-runtime.ts`, R; reuse existing JSON validation rather than a provider-specific schema.
- Compatibility: valid typed handlers unchanged; malformed/untyped implementations become uncertain instead of leaking invalid outcome variants. Unknown outputs never auto-retry.
- Proving test after approval: flip the witness to uncertain/no report/duplicate:uncertain; add null, primitive, getter, oversized text and missing-effect variants.
- Risk/blocker: overly narrow output schema could reject legitimate module-owned output; blocks P3 worker-port input validation claims and P6 active use with externally supplied workers.

### P2-F3 — shared mailbox callback fault isolation

- Problem: `take` calls `sourceVersion` without containing exceptions; one bad source prevents later unrelated pending modules from being checked. M:28–34 proves the shared drain throws, with two pending items.
- Smallest proposed change: catch source lookup errors per item, withhold/quarantine that item's delivery with a bounded explicit `source_check_failed` diagnostic, then continue other items. Specify whether the item is dropped or remains pending without resetting seen protection; never deliver on unknown freshness.
- Files: `packages/core/src/engine/monitoring-core-context-mailbox.ts`, M; Pi source callback tests in the owning later phase.
- Compatibility: callers no longer receive this callback exception from `take`; failure diagnostic gains a reason. Healthy item order remains stable, no duplicate-key eviction.
- Proving test after approval: the same callback throw must withhold bad and deliver good, no thrown drain, no later duplicate delivery.
- Risk/blocker: drop policy may lose useful advice; retain policy can consume capacity. Blocks P3 shared-mailbox fault-isolation claims and P6 robust delivery under source-store faults.

None of these deltas, nor P1 deltas 4/5/10/11, were implemented. There is no approved implementation hidden in a helper or new fixture.

## R7 restart durability — DESIGN ONLY, not an implemented API

### Current state and required ownership

`MemoryIdempotencyStore`, `ApprovedBudgetGate`, runtime queue entries/outcomes, coordinator ready state and `ContextCarryMailbox` items/seen/log are process memory today. `WorkerExecutionPort` can distinguish logical completion from physical settlement, but an in-memory promise, ticket or AbortSignal is not restart evidence. Recreating an engine/store loses protection; reconstructing only diagnostic history does not restore it.

Propose an optional **module-owned persistence port** with per-module, explicitly versioned scope partitions. The core owns the contract and recovery state machine; a host supplies a backend. No SDK-specific task, terminal-session or orchestration API is assumed. Like the worker port, it needs bounded limits, explicit lifecycle/status, typed receipts, fake conformance and separate acknowledgement from actual durability. Below is a proposed shape, not a list of current exports:

```ts
// PROPOSED ONLY: names and semantics require approval before implementation.
type DurableScope = Readonly<{
  id: string; moduleId: string; sessionId: string; branchId: string;
  declarationHash: string; configHash: string; modelFingerprint: string;
}>
type DurableRecord = Readonly<{
  id: string; schemaVersion: number;
  kind: 'key' | 'work' | 'effect' | 'report' | 'budget' | 'scope';
  bodyJson: string; contentHash: string;
}>
type CommitReceipt = Readonly<{
  commitId: string; revision?: number;
  status: 'durable' | 'conflict' | 'refused' | 'unknown';
}>
interface MonitoringPersistencePort {
  readonly limits: Readonly<{
    maxScopes: number; maxRecords: number; maxBytes: number;
    maxBatchBytes: number; maxPendingIo: number;
  }>
  start(): void;
  // Atomically claim ownership; fence increases on every new owner/recovery.
  open(scope: DurableScope): Promise<Readonly<{
    fence: number; revision: number; status: 'owned' | 'refused';
  }>>;
  read(scopeId: string, after: number, limit: number): Promise<Readonly<{
    revision: number; records: readonly DurableRecord[]; next?: number;
  }>>;
  commit(input: Readonly<{
    scopeId: string; fence: number; expectedRevision: number;
    commitId: string; records: readonly DurableRecord[];
  }>): Promise<CommitReceipt>;
  stop(): void;
  dispose(): void;
  idle(): Promise<void>;
  getStatus(): Readonly<{
    state: 'running' | 'stopped' | 'disposed'; pendingIo: number;
    retainedRecords: number; retainedBytes: number;
  }>;
}
```

`bodyJson` is NOT arbitrary trusted replay input: each record kind needs its own versioned strict schema and byte bounds, hashes and scope/fence association, validated at recovery. `read` must yield a coherent paginated snapshot at one revision or explicitly refuse concurrent change. `commit` atomically appends the whole transition across key/work/effect/report/budget records, with compare-and-swap and idempotent commit ID. Reusing an ID with changed bytes refuses; the same ID/bytes returns the original receipt. Only `durable` authorizes progressing to external dispatch. Backend crash or lost ack is `unknown`, never interpreted as rollback. The backend must specify fsync/transaction durability, corruption detection, schema migration and single-writer fencing. `stop/dispose` stop new IO, not erase stored protection or imply pending IO physically stopped.

### What must survive

| State | Durable minimum / recovery constraint |
|---|---|
| Idempotency protection | Exact existing key plus scope/config association and started/prepared/executed/rejected/uncertain state; no automatic TTL/LRU reopening; uncertain tombstones survive diagnostic pruning |
| Work queue | Stable work ID/key, bounded admission ordinal, grant/stage/config/model fingerprints, dependency revisions, approved cost reservation, dispatch-attempt/receipt identity and fencing; never serialize closures/signals |
| Uncertain-effect ledger | Intent-before-dispatch, target/worker operation identity, terminal or uncertain status, immutable evidence/effect receipts and reconciliation decision; a missing result is not a failed effect |
| Report mailbox | Stable report ID, source work/key, session/branch/turn scope, dependencies, creation/expiry data, enqueue state and separate input-delivery receipt; seen tombstones also survive |
| Budget and ownership | Approved caps/approval identity, spent totals and outstanding reservations, scope closure and owner fence; restart must not mint another budget window or free unknown reservations |
| Observation boundary | Last committed sequence/binding and freshness metadata; resnapshot/rebind explicitly after restart. Never pretend process-local cursor/epoch alone authenticates current branch |

Caller must supply authoritative branch/scope/version facts; current `Trigger` has no branch field. The design must not silently change current idempotency hashing or infer approval. Add a versioned envelope/migration decision and host-side scope validation. Persist only admitted, consented bounded material when replay truly requires it; by default keep hashes/IDs/versions and reacquire current sources. If sources cannot be reacquired, fail closed/drop unstarted advisory work rather than dispatch from guessed evidence.

### Crash points and reconciliation

| Crash boundary | Required recovery |
|---|---|
| Before durable admission/key+budget reservation | No authorized dispatch; absent work is safe to drop. Unknown commit acknowledgement requires read/reconcile by commit ID first |
| Admission committed, before dispatch intent | Reload pending work; reacquire grants, stage, source revisions, scope and budget approval; only read-only explicitly restartable work may resume automatically |
| Dispatch intent committed, before worker acknowledgement | Mark ambiguous attempt uncertain; query existing worker/target receipt identity if supported; do not create a new effect attempt |
| Worker completed/effect occurred, before result commit | Same uncertain rule: target receipt reconciliation, not handler replay; retain raw reservation until physical/authoritative reconciliation |
| Result committed, before report enqueue | Reconstruct only report intent; never rerun handler. Enqueue with same report ID through an idempotent sink, else withhold |
| Enqueue accepted, before next-input delivery ack | Recover pending/unknown mailbox state, validate branch/source/age; duplicate-safe host mailbox required. Without durable host dedup/receipt protocol, do not promise exactly-once delivery |
| Delivered externally, before durable delivery receipt | Delivery uncertain, do not inject again automatically; reconcile host receipt or explicitly accept loss. Hook mutation alone cannot resolve this |
| Restart with old raw worker still alive | Fence old owner; reserve its cost/capacity as unresolved until authoritative terminal receipt. Core fence cannot undo an external effect; target must reject stale fencing token or reconcile |

Read-only deterministic preparation can be recomputed only under a declared policy and current revisions; effectful/unknown work is never automatically retried. Persisted stage/grants/costs are ceilings, not authority: intersect with current configuration/approvals; tightened config can cancel recovered work but cannot enlarge prior authority. Missing/corrupt/incompatible records stop that scope and require reconciliation. Recovery finishes scanning protection state before admitting new triggers; an unavailable store disables active dispatch rather than falling back silently to empty memory.

Safe to drop: bounded diagnostic rings/traces, obsolete cached projections, unstarted read-only work whose scope/source/expiry is no longer valid, and fully acknowledged expired report bodies. Do NOT drop uncertain keys/effects, unresolved reservations, pending report identity or live scope tombstones to meet a memory cap. Capacity should refuse new work; explicit reconciled scope closure may compact bodies into bounded durable tombstones, with retention/deletion policy approved separately. A scope cannot be called safely closed while an unfenced external worker might still act.

### Fake-backed conformance proposal

Future `runPersistencePortConformance(makePort)` would accept a factory that reopens the same fake durable backing across fresh port instances (like the existing worker factory pattern, not its wire API). Simulated process death discards every engine object and uncommitted fake buffer; only committed backing survives. Crash each boundary above, also fail before/after commit ack, duplicate/changed commit IDs, competing owner fences, paginated reads, corruption/schema mismatch, capacity exhaustion, source/config tightening, receiver unknown and unresolved worker completion. Assert no new effect dispatch, report duplication or budget increase; count pending IO/reservations and verify no recovery reopens uncertain keys. Run a deliberately broken backend that forgets a protection key and require conformance failure. Then separately test a real storage backend across OS process termination; fake conformance is necessary, not proof of disk/fsync durability.

**R7 remains UNVERIFIED and blocks P6 restart-safe operation and P7 durable-readiness claims** unless restart safety is explicitly excluded from the release contract. No port, fake backend, migration or recovery implementation was added in P2.

### What tmux covers (terminal multiplexer)

tmux can keep a child process/terminal alive after UI detach; it may help reconnect and observe the same still-running worker. It does not persist JavaScript maps/promises, protect against host/process restart or reboot, make a provider call idempotent, authenticate current grants, recover budget reservations, or establish whether an external effect/report already happened. Surviving UI detach is not R7 restart durability. No multiplexer or process-restart experiment was run here.

## Remaining UNVERIFIED / handoff

- Real Pi SDK hooks, actual next provider-input receipt, real worker implementation/hard termination, host payload normalization, and pending Pi tests remain P3 or the D1' downstream implementation owner.
- R7 implementation, durable backend/process-kill conformance, crash recovery, cross-process fencing, distributed exactly-once claims and terminal multiplexer behavior.
- Arbitrary untyped frame/worker/source-store faults covered by the three findings; their fixes require approval. Full malformed-frame schema validation and all crash/fault combinations are not claimed.
- Automatic freshness propagation after selection-to-runtime handoff, full stage-aware composition and origin attribution remain caller-owned pending approved composition work. No claim of a sandbox, runtime fairness or origin authentication.
- Heap/RSS/GC leakage, indefinite soak, real host/worker contention, latency percentiles, hook overhead, cost/semantic quality, thresholds and all D2/P5 acceptance measurements.
- Real model/network behavior, private session data and provider spend were not exercised. No source or protected backup changes, shared-doc edits, publish, push or GitHub write occurred.
