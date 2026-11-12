# Compaction-only evaluation — stages 1–2

Approved scope: option A (2026-11-11), offline implementation and synthetic DEV data;
2026-11-12 option A rebuilds only DEV data/generator and related tests/docs, leaving stage-1 tooling unchanged.
**Stage 3 is NOT authorized. No real model/provider/paid calls were made.** Git/GitHub operations
for the branch and PR are separate from inference. No endpoint, credentials, provider SDK,
Fabric dependency, automatic model discovery or real-network CLI mode is included.

## Purpose and method

Measure only task154's purpose-scoped between-region compaction: does it retain each item
needed by the module purpose? This does **not** qualify final monitoring decisions, retrieval,
rule enforcement, memory usefulness, jobs, parent effects or deployment readiness.

Core `engine/region-compaction.ts` exports the pure `buildRegionCompactionTask`,
`regionCompactionCandidates` and `applyRegionCompaction`. The runtime calls these exact helpers:
question instructions/criteria, region references, scope/version hashes and original order/content
are preserved. Non-region material and `[memo]`, `[state]`, `[omitted]` heads stay; <=1 eligible
item skips dispatch; rejected compaction retains the full region. The parity test captures the
runtime's actual JudgeTasks, including scope and version, and compares against the builder.

`packages/eval/src/compaction.ts` accepts core's `JudgeBatchPort` (including an admitted model
router's `judgeBatch`). It builds one task per region; only the compaction is called. The actual
exported question instructions come from `modules/references/src`, `modules/rule-steering/src`
and `modules/memory/src`, not a paraphrased evaluation prompt. No labels parameter is accepted
by evaluation. Labels are joined after selection by the scorer. A test flips labels and checks
that actual core model-host requests remain identical. The closed dataset schema rejects label
fields in reference bodies as well as outer material records.

Goals are now fixed host configuration strings, identical across each purpose's 20 regions.
Current requests/actions, record catalogs and completed reads appear only in region items.
The [dataset README](../../packages/eval/data/compaction-dev/README.md#fixed-host-configuration-goals)
records each exact string and its configuration/purpose sources. These are authored realistic
DEV goals, not production defaults supplied by the module bindings.

**Known runtime prompt limitation:** compaction supplies module instructions, event metadata,
goal and region only; it does not add external policy references, `currentReferenceIds`, read
ledger contents or memory source attestations. The dataset does not repair or augment that
prompt. Tool results use core's real status-only rendering. It tests region-context relevance,
not final U1/U6/memory accuracy. Fictional, agent-authored conversations and labels are DEV-only
and require user review. Their correlations/base rates must not be generalized to production.

### Parent-review rebuild (2026-11-12)

The e293b87 dataset leaked answers in explanatory tails, repeated noise lines and topic-swapped
templates, mismatched speakers/tool pairs, and put event-specific information in `goal`. The
rebuild uses natural same-topic near misses, varied wording/length/structure, coherent long
incident narratives and correctly attributed user decisions versus assistant proposals.
Latest user turns/assistant action statements establish the current `message_end` event.
Checks cover forbidden hints, in-region duplicates, >=95% global uniqueness, fixed goals and
call/result order plus target identity (before core discards result bodies). Separate labels,
closed schemas, deterministic regeneration and label-isolation tests remain in place.
The six-region user review sample is `/tmp/compaction-dev-review.md` (outside Git).

## Offline reproduction

From the repository root (Bun, frozen lockfile):

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
bun packages/eval/src/compaction-cli.ts /tmp/compaction-report.json
```

The sibling CLI is **stub-only**, with zero cost and no network-capable binding. It selects
alternating item positions, not semantic relevance. Its report is explicitly marked
`deterministic-stub-NOT-model-quality`; passing/failing that report says nothing about a model.
The optional positional argument is a report destination, not a provider/model selector.

Regenerate only these DEV files (never a holdout) with:

```sh
bun packages/eval/src/compaction-generate-dev.ts
```

The dataset has 60 regions (20/purpose), 5–13 items/region within the 5–15 bounds, 335 items
total: 89 needed and 246 not-needed; 12 nothing-needed regions and 327/335 unique texts (97.61%). See the [dataset README](../../packages/eval/data/compaction-dev/README.md).
The generator and gold are local dev artifacts; neither is passed to a model.

## Metrics and denominators

Report micro-averages overall and separately per purpose. Each rate carries its numerator and
denominator. Zero denominator => null rate and null interval, never a fabricated perfect score.

| Metric | Numerator / denominator |
|---|---|
| **Needed-item retention (recall; PRIMARY)** | needed items kept / all needed items |
| Noise removal | not-needed items removed / all not-needed items |
| Item size reduction | items removed / all input items |
| Byte size reduction | UTF-8 bytes of reference `content` removed / all input reference-content bytes |
| All-dropped | regions with no kept items / evaluated regions (including fallback/skips) |
| Failure/fallback | rejected compaction calls / attempted compaction calls (skips excluded) |
| Latency p50/p95 | nearest-rank percentiles of monotonic elapsed milliseconds, one observation per attempted region call, including failures |
| Cost | sum of per-region cost deltas, USD; failed/unknown requests retain reserved maximum |

Wilson two-sided 95% intervals (z=1.959963984540054) accompany binary/item rates, as in P5
decision #3. Byte reduction is a weighted size ratio, **not** independent Bernoulli trials:
its interval is explicitly null, not a misleading per-byte Wilson claim. Item Wilson intervals
also assume independence which synthetic items/regions do not establish. No model-quality
confidence claim is made from this DEV corpus. Latency and cost have no Wilson interval.

**Provisional pass line:** needed-item retention >=95%, evaluated as the point estimate,
not the lower confidence bound. **User must confirm** the threshold and decision rule before
stage 3. Report noise/size savings alongside retention; all-kept fallback can have perfect
recall while providing no compaction. Report failures separately so fallback cannot hide them.

## Stage 1–2 verification

- `bun test`: **876 passed, 0 failed**, 5,605 assertions across 63 files (25 added DEV-quality tests).
- `bun run typecheck`: all **8** configured TypeScript project checks passed.
- Offline dry run wrote `/tmp/cmpeval-dry-run.json`: 60 region rows, USD 0, network false.
  Alternating-position stub retained 66/89 needed items; this is a mechanics check, not model evidence.
- `git diff --check` passed. Finite pattern scans of changed sources, tests, docs and DEV data
  found no private home paths, email addresses, common provider/cloud/private-key tokens,
  bearer tokens or JWT-shaped secrets. This is not a universal secret detector.
- No manifest/lockfile changes or `pi-fabric` manifest dependency; no holdout files changed.

## Disabled metered binding seam

`createMeteredCompactionBinding` in `compaction-meter.ts` is opt-in only (`enabled: true`),
requires an exact explicit `modelId` (no default), and accepts only an injected transport.
It bounds lifetime calls, reserved USD and monotonic wall time **before every dispatch**.
Each call reserves its declared maximum USD and full per-call time within the remaining
run budget; calls are serial. USD uses conservative integer nano-dollar accounting.
Known actual costs release unused reservation. Failure/unknown billing retains the entire
reservation, stops further dispatch, and records an uncertain receipt. No retries.
Timeout aborts the signal, permanently stops admission and retains the physical slot until
raw settlement; late completion cannot trigger more calls. Receipts contain exact model id,
monotonic latency, cost/reservation and status. No raw source bodies, credentials or error
messages are emitted by the meter.

When using the seam, inject `binding.judgeBatch` into `evaluateCompaction` and pass
`binding.costUsd` as its cost callback. Persist `binding.receipts()` alongside the score.
The default evaluator cost callback is only appropriate for the zero-cost offline stub.

**Proposed stage-3 sub-cap:** Jev <=120 calls / USD 1 / 30 minutes, contained within the
P5 ceiling of 2,310 HTTP requests / USD 26 / 8 hours. The seam refuses configurations above
these sub-caps. A logical `invoke` must be exactly one physical provider request: no hidden
retries, redirects or internal fanout. Reserve any auxiliary activity within the larger P5
budget; no unused capacity from one cap can override another. These are proposals, not a
spending approval. Local fake-transport tests exercise opt-in, explicit identity, preflight
call/USD/wall caps, concurrency refusal, latency/cost, abort, timeout, unknown billing and
invalid receipts.

### Exact remaining stage-3 gap (not implemented or run)

1. Obtain explicit stage-3 user approval, reviewed DEV labels, final retention decision rule,
   dataset/version freeze, repetitions and caps (including per-call ceilings).
2. Supply a reviewed **real Jev transport** implementing `MeteredTransport`, backed by the
   core model-host/native-classifier protocol. The repo provides adapter/model-host abstractions,
   not a confirmed Jev HTTP endpoint/auth/billing binding. Read-only inspection of the composition
   checkout found neither the suggested old `monitoring-retrieval-poc.ts` nor its monitoring
   directory, so no protocol/endpoint was guessed.
3. Confirm endpoint and credential source out of band; provide credentials host-side only,
   never in source, dataset, report, logs or Git. No credentials were fetched or tested here.
4. User supplies the **exact provider/model id** and pricing. No default or guessed id exists.
5. Prove provider-side maximum billing and physical deadline enforcement (or an external
   kill/budget boundary) before enabling. An AbortSignal cannot guarantee remote cancellation,
   and an injected transport can violate its declared cost: this seam detects violations but
   cannot undo remote charges. Without those guarantees real execution must remain disabled.
   Confirm no hidden HTTP retries/fanout, decode native typed answers through core adapters,
   and qualify cost receipt/unknown-settlement accounting with the approved transport.

No stage-3 CLI is exposed. No sealed holdout file is read or changed by this harness. The
shared checkout, other worktrees, composition repository and unrelated PRs are unchanged.
