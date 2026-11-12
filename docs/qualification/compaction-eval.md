# Budget-gated, pinned, task-aware compaction (DEV only)

Approved by user, 2026-11-12, option A: implement as one PR. **No real model,
classifier or provider calls are authorized or were made for this redesign.**
Git/GitHub operations, local tests, metadata-only resolution and deterministic
stubs are not inference. Do not merge. Real measurement requires separate approval.

## Motivation and U1 runtime change

Previously every region with >1 eligible item was classified. Keep/drop came from
`evidenceRefs` at profile reference threshold 0.5. Supplied Jev 1.14 DEV results:
original wording retained 42/89 needed items; revision 1 (purpose inlined per item)
retained 89/89 but removed only 41/246 noise items. Needed p50 was 0.84, noise p50
0.71. These are prior observations, **not measurements of this redesign**.

Only single-module pipelines declaring `region.compact` change. The declaration
binding in `monitoring-engine-runtime.ts` still maps the need to `compactRegion:
true`; only U1/references currently declares it. Rule-steering and memory are eval
purposes here, not newly compacting runtime modules. Normal reference decoding,
final judgement, workers, retrieval and memory effects retain their behavior.

## Defaults and configuration

`RealtimeWatchModule.compactRegion` accepts false/absent (disabled), true (defaults),
or `{ budgetBytes?, dropBelow?, pinNewest? }`. Unknown fields, invalid types,
nonfinite numbers, noninteger byte/count limits, budget <1, pin count <0, and
probability outside [0,1] are rejected at module admission.

| Setting | Default | Rationale |
|---|---:|---|
| budgetBytes | **8192** | Half the default total window/region admission limit, `maxBytes: 16384`, in `packages/core/src/engine/monitoring-core-realtime-material.ts:11`. This reserves room for pins/task and reduces repeated judgement input; it is a policy choice, not a measured optimum. |
| dropBelow | **0.2** | Conservative P(needed) floor, separate from normal profile threshold 0.5. |
| pinNewest | **2** | Two newest ordinary region items; tool pin propagation can retain more. |

Budget counts **UTF-8 bytes of original reference content**, summed over non-pinned
region items, not characters/tokens/serialized request size. Total kept bytes can
exceed the budget because pins and non-region material are exempt. The material
window's independent admission limits still apply. Custom window limits do not
silently change the default compaction setting; configure budgetBytes explicitly.

## Single-source runtime/eval policy

`packages/core/src/engine/region-compaction.ts` owns `planRegionCompaction`,
`buildRegionCompactionTask` and `applyRegionCompaction`. Runtime and evaluator use
these exact helpers. Tests compare captured runtime tasks to the builder, and
compare evaluator tasks/selections to that same builder/application.

1. Find conversation-history material with decoded `region: true`.
2. Pin memo/state/omitted heads, latest user, current-event items and newest two
   ordinary region items. Propagate any pin across its complete visible tool unit.
   Pins are always retained verbatim and never sent as candidate references.
3. Group a call and all its visible results as ONE candidate/question. Unit ID is
   the first/call member ID. Map its probability back to all original member IDs.
4. At non-pinned bytes **<= budgetBytes**, keep the region unchanged, make **no
   compaction call**, record `region_within_budget`. The normal module judgement
   can still run; this is not a global inference-disable switch.
5. Otherwise put latest user and triggering action text in the explicit state
   field `view.event.payload.task`. These texts are already redacted/bounded by the
   window. Every unit question keeps revision-1's inlined module purpose and says
   `Current task: see view.event.payload.task in state`. Source text is untrusted data.
6. First drop units only if **P(needed) < dropBelow**; equality stays. If kept
   non-pinned bytes still exceed budget, drop least-probable units first, ties
   oldest-first in stable window order. Budget pressure can drop even confident
   keeps: recall must be reported alongside savings, not assumed.
7. Missing/malformed probabilities or any rejection keep the existing **full-region
   fallback**. A fallback can be over budget and is reported as failure/noncompliance.

Original output order/content/object identity is preserved. Legacy two-argument
`applyRegionCompaction(materials, evidenceRefs)` remains available; runtime/eval
use the policy form, which requires probabilities.

### Current-event identification: capture is not ownership

Region projection stamps historical lines with the capture frame's provenance.
Pinning all matching observationIds would pin the entire region, incorrectly.

- Non-region event-owned items use `provenance.observationId === frame.id`.
- For message_end/turn_end, pin every line whose regionIndex is the newest
  canonical message index: `truncatedHead + canonicalMessages.length - 1`.
  Eval's bounded projection has no full snapshot and uses max visible regionIndex
  for these events. No external/raw history is fetched.
- Tool event `payload.toolCallId` pins the matching projected exchange. The window
  adds, only for admitted compaction-enabled pipelines, a bounded SHA-256 `toolCallId` fact to call/result content, derived from
  canonical call IDs. This supports parallel calls, multiple and nonadjacent
  results without exposing raw IDs. Legacy regions use contiguous rendered pairs.
  Only visible members can be grouped if the window omitted part of an exchange.
- Latest-user/newest-item pins apply independently. Event-owned input user text
  takes precedence over historical projected user text in the explicit task.

### Additive decoding, unchanged normal threshold

`decodeMonitoringJudgements` adds optional `referenceProbabilities` keyed by
reference/unit ID for native tasks whose event ID ends in `:compact`. It includes
all validated probabilities, even below the profile threshold. Existing mode,
reason, confidence and threshold-derived evidenceRefs do not change. Ordinary
native tasks, selection-disabled tasks and structured decoding retain their old
shape. An adapter-local additive return type avoids modifying generated canonical
contracts. Tests prove ordinary exact decode equality and the unchanged 0.5
reference selection while making probability 0.2 available to compaction code.

## Prior-art principles (sources, not dependencies)

- [LiteLLM TypeSafe](https://github.com/BerriAI/litellm/blob/main/litellm/proxy/guardrails/guardrail_hooks/typesafe/typesafe.py):
  last user as explicit task, deterministic system/latest-exchange protection,
  conservative 0.2 relevance floor, whole tool exchanges.
- [jev-compactor engine](https://github.com/edwardyen724-g/jev-compactor/blob/main/packages/jev-compactor/src/engine.ts),
  [prepass](https://github.com/edwardyen724-g/jev-compactor/blob/main/packages/jev-compactor/src/prepass.ts),
  [decision policy](https://github.com/edwardyen724-g/jev-compactor/blob/main/packages/jev-compactor/src/decide.ts),
  [skeleton](https://github.com/edwardyen724-g/jev-compactor/blob/main/packages/jev-compactor/src/skeleton.ts):
  goal in state, code pins/dedupe, whole skeleton, P(drop)>=0.7, least-certain
  keeps under budget pressure, no classification below budget.
- The supplied extractive-history review similarly favors budgeted ranking over
  independent binary deletion. This implementation does not add global dedupe,
  goal-path pinning or a whole skeleton. Those are prior-art differences, not
  claimed features; existing window deduplication is unchanged. No new dependency.

## DEV corpora, labels and limitations

`--dataset dev|long-dev` is a closed runner choice; omission remains dev for
compatibility. No arbitrary dataset path or holdout selector is accepted.

Existing DEV is unchanged: 60 regions, 20/purpose, 335 items, 89 needed/246 noise.
All 60 now skip compaction with defaults. New LONG DEV has 30 regions, 10/purpose,
23 items/region, **690/690 unique rendered texts**. Each exceeds 8192 non-pinned
bytes but fits the default 16384-byte, 32-source window. The parser now permits up
to 32 items (previously 15) and an optional toolCallId; old files remain valid.

Both corpora use fixed per-purpose goals, core regionLines rendering, correct
speakers, paired calls/results and the same forbidden-answer-hint, no-local-duplicate
and >=95% global uniqueness checks. Gold lives in a separate closed-schema labels
file, never in task/state/reference content. Read errors do not imply successful reads.

**Agent-authored, DEV-only, user review required.** LONG DEV composes a concrete
scenario bank with varied operational observations, reusing investigative phrasing.
Text uniqueness is not semantic diversity or independence. Most bulk is assistant
investigation narration. Passing schema tests cannot establish gold correctness,
representativeness or production confidence. See the LONG DEV README for review.

Gold totals include pins; pinned is a subset, not a third disjoint label class.
Byte ranges are per region, against the 8192-byte non-pinned budget.

| Purpose | Needed | Not-needed | Pinned | Non-pinned bytes | Total bytes |
|---|---:|---:|---:|---:|---:|
| references | 40 | 190 | 20 | 13402–13929 | 13695–14222 |
| rule-steering | 40 | 190 | 20 | 13299–13901 | 13593–14195 |
| memory | 30 | 200 | 20 | 13382–13809 | 13688–14115 |

Regenerate only LONG DEV: `bun packages/eval/src/compaction-generate-long-dev.ts`.
Existing DEV generator/data and all holdout files are untouched.

## Evaluation metrics and offline sweeps

`evaluateCompaction` accepts core JudgeBatchPort, not labels; gold joins afterward
in `scoreCompaction`. Existing overall/by-purpose metrics remain: needed recall,
noise removal, item/byte reduction, all-dropped, failure fallback, latency p50/p95
and USD. Binary rates have numerator/denominator and Wilson 95% intervals; empty
denominators have null rate/interval. Byte weights have no Wilson interval.
Synthetic clustered items do not establish independence or a confidence claim.

Added per-row pinnedCount, candidateBytes, keptBytes (non-pinned), budgetBytes,
budgetCompliant and skipped; aggregate pinnedCount, withinBudgetSkips and
budgetCompliance (compliant/evaluated regions). Skips contribute no call or
call-latency sample. Failures keep full input and count as attempted calls.

Private item-probabilities.json logs unit IDs/probabilities, never source text.
Legacy diagnosticThresholdSweep remains a candidate-only probability diagnostic,
now named dropBelow as well; it excludes pins/no-call regions and ignores budget.
**diagnosticBudgetSweep** replays the full shared policy over dropBelow 0.1–0.5,
including units, pins, budget pressure and skips, mapping units to item labels.
Neither sweep is a quality verdict. Provisional DEV recall target remains >=95%
by point estimate, pending user confirmation; all-kept skip/fallback alone cannot
qualify useful compaction.

## Safe reproduction: zero inference

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun packages/eval/src/compaction-cli.ts --dataset dev /tmp/compaction-dev-offline.json
bun packages/eval/src/compaction-cli.ts --dataset long-dev /tmp/compaction-long-offline.json
bun hosts/pi/src/eval/compaction-run.ts --resolve-only --dataset dev --model openrouter/typesafe/jev-1.14
bun hosts/pi/src/eval/compaction-run.ts --resolve-only --dataset long-dev --model openrouter/typesafe/jev-1.14
```

Offline CLI is provider-free, deterministic-stub-NOT-model-quality, network false,
USD 0. Resolve-only uses static SDK registry with network refresh disabled and
provider/type credential metadata only: no key retrieval, credential command,
provider probe or classify. Reports stay outside Git.

Resolved locally at USD 0.042/million input tokens, output/cache zero:

| Dataset | Regions | Calls | Request bytes | Point tokens | Point USD | Upper tokens | Upper USD | Max/call USD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| dev | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| long-dev | 30 | 30 | 987434 | 246869 | 0.010368498 | 1110314 | 0.046633201 | 0.001568281 |

Estimates, not observed costs. Point tokens = ceil(request UTF-8 bytes/4);
reservation = one token per byte +4096 framing tokens per call. Wire size and
reported usage must fit the bound and registry context window. Zero-call runs use
a minimal positive internal meter-constructor sentinel, not a charge/reservation.

## Real runner guards (preserved)

Real mode requires **separate user approval**, --approve-real-calls, exact
--model openrouter/typesafe/jev-1.14 and explicit positive --max-calls/--max-usd/
--max-wall-min within **120 / USD 1 / 30 minutes**. Unknown/duplicate flags,
aliases, unsupported prices, other endpoints/models and unaffordable data are
refused. OpenRouter is pinned TypeSafe Jev only, no other OpenRouter models.
Stored Pi OpenRouter api_key/oauth login only; no CLI/env key overrides/custom
model files. Application code never reads/logs keys.

Transport uses existing SDK classify and core request/decode, zero retries, one
prepared POST to the exact endpoint, no redirects/fanout, serial admission,
45-second per-call deadline and integer nano-dollar reservations. Invalid/missing
usage, identity, settlement or cost stops admission and retains reservation. Abort
is not proof of remote cancellation. No automatic retry/resume. Registry estimates
are not invoice-verified costs or a provider-side billing guarantee.

New private output outside Git (including worktree/symlink guards): directory 0700,
files 0600. Manifest includes dataset choice/hash, model, estimates and caps;
reserved/settled transport receipts precede/follow classify, with meter receipts,
probabilities and score. No raw prompts/answers/headers/credentials/provider errors.
Gold loads after evaluation. Incomplete run reports failure and exits nonzero.

## Verification for this implementation (no real calls)

- Full `bun test`: **925 passed, 0 failed**, 6686 assertions, 66 test files.
- `bun run typecheck`: all **8** configured TypeScript project checks passed.
- Both datasets resolved through --resolve-only; both deterministic offline CLI
  runs completed with USD 0 and network false. LONG DEV stub mechanics meet the
  non-pinned budget in all 30 regions; these are not model-quality measurements.
- Changed-line privacy scan and diff whitespace checks passed; no added private
  home paths, common secret/token patterns or unrelated orchestration dependency.
  Pattern scanning is not a universal secret detector.
- No lockfile, existing DEV data/generator or holdout changes. No merge performed.

## Measurement plan — not approved by this PR

1. User reviews LONG DEV text/gold/limitations and confirms recall/budget criteria.
   Freeze code and dataset hashes.
2. Obtain **separate explicit approval for one LONG DEV run**, including model,
   repetition, dataset, call/USD/wall caps and new private output directory.
   Inspect recall by purpose, pin contribution, budget ranking losses, compliance,
   noise/byte savings, failures, probabilities and offline sweeps.
3. Tune on DEV only if separately authorized; never inspect or modify a holdout.
4. Obtain **another separate approval for a sealed holdout run** after freeze.
   This PR intentionally adds no holdout selector; sealed access tooling must be
   reviewed under that later approval. DEV scores are not holdout evidence.
5. No measurement, test result or this implementation approval permits merging or
   deployment. Existing holdouts and other evaluation worktrees remain untouched.
