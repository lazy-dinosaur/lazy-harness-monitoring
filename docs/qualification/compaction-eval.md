# Compaction-only evaluation — stages 1–2 and stage-3 preparation

Approved scope: option A (2026-11-11), offline implementation and synthetic DEV data;
2026-11-12 option A rebuilds only DEV data/generator and related tests/docs, leaving stage-1 tooling unchanged.
**Stage-3 preparation only is approved (option A, 2026-11-12). Real execution is NOT approved.
No real model/classifier/provider calls were made.** Git/GitHub operations are separate from
inference. The offline evaluator remains provider-free; the opt-in Pi-host runner below is
separate and uses only the existing SDK development dependency. No new dependency is needed.

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

## Stage-3 preparation: Pi-host transport and runner (no calls made)

`hosts/pi/src/eval/compaction-transport.ts` implements the injected transport, leaving core and
`packages/eval` Pi-free. It uses the SDK 1.5.0 `ModelRuntime.classify` path, not a guessed HTTP
protocol: core `monitoringJudgeRequest(tasks, 'native-classifier')` -> SDK classify -> core
`decodeMonitoringJudgements` (reference threshold 0.5). The SDK translates bool to wire noul.
Frozen reference: composition commit `b725afa`, `.lazy-harness/scripts/monitoring-retrieval-poc.ts`
(`createMeteredRequest` / `openMeteredClient`) and `monitoring-u6-evaluate.ts` (session runtime).
The new transport injects fetch through the SDK option; it does not replace global fetch.

### SDK findings (1.5.0, dependency-relative paths)

Paths below are relative to the installed `@earendil-works/pi-ai` package unless noted.

- `dist/models.js:672–691`, especially 685–688: catalog input/output/cache prices are divided
  by **1,000,000** and multiplied by token usage. Thus registry input `0.042` means
  **USD 0.042 per million input tokens**, not per request or per token.
- `dist/types.d.ts:506–515`: `ClassifierResult.usage` is optional and is token usage priced at
  catalog rates, when reported by the service. `dist/api/classifier-shared.js:79–98` converts
  service `input_tokens`/`output_tokens` into Usage with cache counts zero and calculates cost.
  The host recomputes USD from validated counts and registry pricing, ignoring `usage.cost`.
  Missing/invalid/over-bound counts or malformed answers => uncertain, retain reservation,
  permanently stop further dispatch. This is **not invoice-verified cost**. SDK parsing can
  normalize malformed token fields to zero; the host requires positive input usage.
- `dist/api/classifier-shared.js:36–74`: `postClassifierRequest` uses injected `options.fetch`,
  with `maxRetries: options.maxRetries ?? 2` (line 68). The host explicitly supplies
  `maxRetries: 0`, `maxRetryDelayMs: 1`; guarded fetch permits only one prepared POST to the
  exact SDK endpoint and uses `redirect: 'error'`. There is no host retry/resume/fanout.
  `dist/api/system-one-shared.js:111–154` makes one call to that helper and decodes answers.
- Coding-agent `dist/core/model-runtime.js:80–119`: `create` with `modelsPath: null`,
  `allowModelNetwork: false`, `refreshOnCreate: false` uses static models and does not refresh
  catalogs. `classify` at 561–573 prepares SDK auth then delegates to the provider.
- `dist/auth/types.d.ts:33–38,63–67`: `listCredentials` returns non-secret provider/type metadata
  and must not execute credential commands. Resolve-only uses this, not key retrieval or an
  authenticated availability probe. Real mode requires a stored Pi OpenRouter credential (`api_key`, or the
  `oauth` credential written by `/login openrouter`; Pi auth storage refreshes it);
  it blanks the ambient `OPENROUTER_API_KEY` option and does not accept CLI/env key overrides,
  custom model files, aliases or alternate endpoints. Application code never reads/logs keys.

### Admission, estimates and private records

The runner refuses unknown/duplicate flags. Real mode requires **all** of:
`--approve-real-calls`, exact `--model openrouter/typesafe/jev-1.14`, and explicit positive
`--max-calls --max-usd --max-wall-min` within **120 / 1 / 30**. The approval flag is a mechanical
interlock, not a substitute for later user approval. Dataset preflight must fit the caps.
Per-call time is 45 seconds; per-call USD is the maximum conservative DEV request reservation.
Serial lifetime accounting is the PR #18 meter; any uncertainty stops admission for the run.
Subsequent rows retain full-region fallback and the report is marked incomplete (exit status 1).
No automatic retry or resume is supported.

The point token estimate is `ceil(UTF-8 request bytes / 4)` per region (heuristic, not a measured
classifier tokenizer count). The reservation uses **one token per UTF-8 byte + 4,096 framing
tokens**; SDK wire payload size is checked before fetch against that bound. Output pricing must
be zero, cache pricing/counts must be zero, tiered/unknown pricing is rejected, and the bound
must fit the registry context window. Actual usage exceeding the bound stops the run. These
are conservative **local** reservations, not a proven provider-side billing limit.

A single authorized resolve-only inspection (zero classify calls) reported:

```json
{"provider":"openrouter","id":"typesafe/jev-1.14","api":"typesafe-system-one","pricing":{"input":0.042,"output":0,"cacheRead":0,"cacheWrite":0},"costUnit":"USD per million tokens","contextWindow":262144,"authConfigured":"no","estimate":{"regions":60,"calls":60,"requestBytes":245773,"estimatedTokens":61466,"estimatedUsd":0.0025815720000000003,"upperTokens":491533,"upperUsd":0.020644409000000002,"perCallMaxUsd":0.000500724}}
```

All 60 regions have >1 candidate, so one repetition estimates **60 calls**, **61,466 tokens**,
**USD 0.002581572**; conservative totals are **491,533 tokens / USD 0.020644409**. These are not
observed inference costs. The meter reserves the largest per-call amount (USD 0.000500724)
on each admission and releases unused reservation only on validated success.
`authConfigured: no` meant no stored API-key metadata at that time; the only stored OpenRouter
credential was an `oauth` login, which is now accepted (see the OpenRouter Jev-only rule below).
It does not disclose, test, or imply anything about credentials in another runtime.

Output defaults to a new private directory under the OS temporary directory (normally `/tmp`),
mode 0700; explicit `--output-dir` must be new, absolute, outside Git, and have an existing
parent. Files use mode 0600. Stdout contains only model metadata, estimates and scored aggregates,
never per-call data or provider errors. Records:

- `manifest.json`: exact identity/API/pricing, DEV dataset SHA-256, estimate, caps, start time,
  limitations. No credentials or source bodies.
- `transport-receipts.jsonl`: call number, request SHA-256/size, token bound, reserved/actual USD,
  reported input/output counts when validated, physical attempt count, latency and status.
  A `reserved` event is persisted before classify; a `settled` event closes it. A reservation
  without settlement after process death remains uncertain: do not automatically resume.
- `meter-receipts.json`: PR #18 call receipts, conservatively charged/reserved USD and uncertainty.
- `report.json`: PR #18 scorer (all metrics, denominators, purpose groups and region result rows),
  completion status and final meter state. Gold labels are loaded **after** evaluation, never
  supplied to transport. Raw prompts/answers/headers/error messages/keys are not recorded.

### Commands (from repository root)

Safe metadata-only command (does not need spending approval; already run once for preparation):

```sh
bun hosts/pi/src/eval/compaction-run.ts --resolve-only --model openrouter/typesafe/jev-1.14
```

**DO NOT RUN the following until separately approved by the user**, with reviewed DEV labels,
final retention rule, dataset/code freeze and one repetition confirmed. Configure the stored Pi
OpenRouter credential through Pi's normal login flow out of band; never put a key in the command.
Use a new output directory each time:

```sh
bun hosts/pi/src/eval/compaction-run.ts \
  --approve-real-calls --model openrouter/typesafe/jev-1.14 \
  --max-calls 120 --max-usd 1 --max-wall-min 30 \
  --output-dir /tmp/compaction-stage3-approved-run
```

### Single-factor revision 1: per-item question carries the module purpose (user-confirmed 2026-11-12)

First real run (jev-1.14, 60 calls, USD 0.004): needed-item retention 42/89 = 47.2%, provisional pass failed
(references 6/36, rule-steering 28/33, memory 8/20; 20 regions with needed items dropped everything).
Code review found the per-item keep question said "this module purpose" without the purpose text (it was only
in the decision question) and pushed narrow selection ("Keep only directly relevant items"). Keep/drop is
probability >= 0.5 per item, independent of the decision answer. The ONE changed factor is the per-item
question text in `packages/core/src/engine/region-compaction.ts` (purpose inlined; true if it could matter,
false only if clearly unrelated). Threshold 0.5, model, data and scorer are unchanged. This also changes the
runtime prompt of modules declaring `region.compact` (U1). Diagnostic addition: per-item probabilities are
saved by id to the private `item-probabilities.json`, and the report adds `diagnosticThresholdSweep`
(0.3-0.7) computed offline; the sweep is never the pass verdict.
### OpenRouter Jev-only rule (user-confirmed 2026-11-12)

The OpenRouter route is used **only for TypeSafe Jev**; no other model is called through OpenRouter.
`assertOpenRouterJevOnly` refuses any OpenRouter model other than a pinned `typesafe/jev-<major>.<minor>`
(`~typesafe/jev-latest` and other aliases are refused) before any request is built, and `assertModel`
further pins this runner to `openrouter/typesafe/jev-1.14`. The stored credential may be an `api_key` or
the `oauth` credential from `/login openrouter`; environment variables remain refused.

### Remaining execution gate and non-claims

The seam's strong provider-side billing/physical-deadline contract is **not proven by this
adapter**. AbortSignal/SDK timeout bounds local waiting and stops new dispatches, but does not
prove remote cancellation or undo a charge. Neither registry pricing nor reported token usage
is an invoice. Before enabling, the user must separately approve execution and resolve the
provider-side/external budget-boundary requirement (or explicitly approve these limitations).
Preparation does not claim model accuracy, production monitoring quality or deployment readiness.
Fake-runtime/HTTP tests cover core parity, labels isolation, flags/caps, retry refusal,
uncertain usage, fallback and receipts. No sealed holdout was read or changed. No shared
checkout, other worktree, composition source or unrelated PR was modified.

### Preparation verification

- Full `bun test`: **891 passed, 0 failed**, **5,705 assertions** across **64 files**.
  Includes 15 new fake-runtime/HTTP-only tests; no external inference in tests.
- `bun run typecheck`: all **8** configured TypeScript projects passed.
- One resolve-only run; **zero real classify/model/provider calls**.
- Manifest and lockfile unchanged; no holdout or shared source changes.
- `git diff --check` and added-line privacy scan passed (private home paths, common secret
  patterns and unwanted harness dependencies). This finite scan is not a universal detector.
