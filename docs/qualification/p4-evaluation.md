# P4 — shared reproducible evaluation

Scope: issue #1 P4 mechanical qualification only. Integration evidence and the conflict-free 463-test union are in [p4-integration.md](p4-integration.md). No semantic tuning, live activation, external model call, durable effect, provider-input delivery qualification or acceptance threshold approval is claimed.

## Architecture and public boundary

`@lazy-harness/monitoring-eval` exposes one path for every fixture module:

1. `parseModules` / `parseDataset` / `createManifest` admit and fingerprint bounded plain data.
2. `replay` feeds the entire recorded frame sequence, in order, through core's public `createRealtimeSelectionPipeline`. Each module has its own material window, declared trigger selection, model router, grant boundary and runtime. Frames are drained serially before the next frame; this runner is not a concurrent-scheduling simulator.
3. A native-classifier backend returns only validated canned outputs from the input script. Selected packets enter `MonitoringModuleRuntime`, with the public `createInMemoryWorkerPort` and an `ApprovedBudgetGate`. Read-only synthetic workers prepare candidates, never mutate anything. The rule fixture consumes its declared worker-dispatch budget.
4. `score` joins evaluator-only labels/expected trigger tuples to opportunity IDs, including missing opportunities, and computes per-module metrics.
5. `compare` requires identical source dataset identity and split, then explains changed opportunities by trigger, selection, judgement, worker and delivery fingerprints. Optional label input adds error slices.

All core imports use `@lazy-harness/monitoring-core`, `/host` or exported `/engine/*.ts` paths. No core API addition or change was needed for P4. No host adapter import was needed: synthetic host-neutral receipts deliberately do not re-qualify Pi. P2/P3 changes present in this branch are inherited through the merge, not additional P4 API changes. **No P4 breaking core/host change.** New evaluator exports: manifest/dataset/module/label types and parsers, both JSON schemas, `createManifest`, `datasetIdentity`, `replay`, `artifactBytes`, `score`, `confusion`, `quantiles`, `compare` and trace/artifact types. The evaluator package is private and versioned `0.0.0`.

## Manifest: `monitoring-eval-run/v1`

`RunManifest` and `runManifestJsonSchema` are exported from the evaluator. The schema is a JSON-serializable draft 2020-12 object with strict keys, required fields and numeric/string/array bounds; no new validator dependency was added. Runtime validation uses the same schema vocabulary, core's public plain-data admission, and cross-field checks.

| Field | Meaning |
|---|---|
| `runId`, `codeCommit`, `packageVersions` | Identified run, 40-hex source commit, core/eval versions (currently both 0.0.0). CLI records `git rev-parse HEAD`; run from a clean, pinned checkout. It does not attest to an uncommitted working tree. Library callers supply the commit; tests intentionally use a synthetic commit ID. |
| `modules[]` | Module ID, core declaration hash, evaluation declaration hash, question/criteria hash, knob/config hash, explicit model identity. |
| `declarationHash` | Hash of the core declaration, binding grants, evaluation ceilings and private-candidate policy. Core has no general material/model/timeout ceiling declaration, so those ceilings are an explicit evaluator-owned author envelope, NOT invented core fields. |
| `configHash` | Hash of all module configurations, including versioned host references; each module also has its knob hash. |
| `dataset` | Synthetic source ID/version/split (`dev` or `holdout`) and canonical hash over source metadata and frames, excluding outputs and labels. |
| `stubOutputsHash` | Binds the exact model/worker/delivery/cancel script separately from source identity. Changing a script must change the manifest but can still be compared on the same source dataset. |
| `seed`, `clockMode` | Unsigned 32-bit seed and `logical` clock only. No wall timestamps or random UUIDs enter the trace. |
| `limits` | Maximum source frames, retained trace records and retained trace bytes. |
| `contentConsent`, `stubCost` | Explicit body-retention consent (default false); fixed simulated per-judge/per-worker-attempt USD rates, not a provider bill. |
| model fields | Binding ID/version, provider/provider-version and model/model-version. Only the exact built-in synthetic binding is admitted; there is no discovery or network fallback. |

Real inference is nondeterministic, even with a seed. A separately authorized future real-provider runner would need to record the requested and provider-resolved immutable model revisions, provider/API/backend versions, parameters, raw response identities, usage and receipts. The schema reserves explicit version identities; this implementation intentionally rejects non-stub bindings. No unimplemented provider API is assumed. Unknown immutable provider revisions must be recorded as UNVERIFIED, never guessed.

## Trace: `monitoring-eval-trace/v1`

`TraceRecord` and `traceRecordJsonSchema` describe one module/frame opportunity. Every source frame other than session-start bootstrap frames has a record for every configured module, even if unwatched, off, unavailable, skipped, deferred, cancelled or failed. Source frames are unique-ID records; duplicate delivery/interleaving qualification remains in P2, not this serial runner.

| Group | Recorded evidence |
|---|---|
| identity | Manifest hash, module/frame/opportunity IDs, source event, frame index; manifest resolves declaration/question/config/model identity. |
| input/provenance | Redacted input/snapshot identity; session/binding/epoch/cursor; snapshot revision and canonical-hash identity. |
| trigger | Named point matches, actual judgement admissions, unavailable flag. Admission means observed judge attempt/judgement trace, not just a matching raw hook. |
| selection | Terminal core selection statuses plus considered and selected material IDs/kinds/versions, exact provenance and content hashes. Considered items are those in the actual model request, resolved from the serial window. |
| judgement | Model-input and raw native-output hashes (or redacted bodies with consent); normalized run/skip/defer/none mode. Confidence is not the scoring oracle. |
| work | Dispatched request identity, actual in-memory completion status/certainty/value identity, runtime outcome/reason identity. Prepared read-only work is a candidate, not an actual effect. |
| report | Actual runtime enqueue status/report ID; separate synthetic boundary or private-review delivery receipt with `kind`; censored/no-boundary flag. |
| cancellation | Requested flag and actual cancellation/refusal observation. Pre-abort is `refused/terminal/caller_aborted`; it is not invented as a started cancellation. |
| latency | Seeded logical capture→judge→worker→ready→receipt intervals, end-to-end only when received; no-boundary cases remain censored. |
| cost | Attempt counts and `stub-estimate` USD; attempted port dispatch includes refusal, and even template handlers use the same port. This is neither actual token usage nor spend. |

Reporting fixtures emit `kind: hook-boundary`, `boundary: context_with_system`, **`evidence: synthetic`**. This is a stub observation only, not the actual SDK hook or next provider input. Private memory candidates emit `kind: private-candidate`, also synthetic; they never enqueue a parent report or write knowledge. A successful enqueue without the scripted boundary is not delivery success. Worker failure/cancel has no delivery receipt. Real SDK delivery evidence remains owned by P3.

### Privacy and retention

The existing core `redactSecrets` is reused recursively for trace content, including explicit-consent bodies, and for synthetic host reference bodies before they reach the model. Core redacts observed material independently. Default artifacts contain only IDs/hashes and bounded enum/identity metadata. Raw judgement, full snapshot/input, dispatched work and completion bodies require `contentConsent: true` (`--content-consent` in CLI). Hashes are not anonymization or approval to publish sensitive metadata; redaction is conservative pattern matching, not a guarantee of detecting every secret.

The runner has no implicit file sink or background retention daemon. Per-run retention is a record/byte-bounded in-memory FIFO; evictions increment `retention.dropped`. Returned artifacts carry the exact retained-byte count and canonical trace hash. Scoring/comparison refuse any evicted/corrupt trace rather than silently shrinking denominators. Imported rows are schema/identity/byte/consent validated. CLI writes only to stdout; the operator owns deletion/retention of explicitly saved files. Bounds are not a process RSS guarantee. Core JSON admission also limits each admitted dataset/module/label document or trace row to 131072 serialized bytes and 16384 nodes, stricter than the outer CLI's 2 MB file guard; large corpora must be separately versioned shards. At most 512 frames, eight modules, 4096 output scripts and 4096 retained records are admitted; trace bytes cap is at most 2 MB. This is a finite offline runner, not restart storage.

## Scoring protocol

Definitions follow [acceptance-criteria.draft.md](acceptance-criteria.draft.md), not a universal success threshold:

- Positive means an independently supplied label warrants a useful allowed candidate. In these mechanical fixtures the emitted-positive signal is an actually `prepared` runtime outcome; the scorer does **not** adjudicate factual correctness or exact-source usefulness by itself. Such semantic correctness must be represented by independently curated opportunity labels/oracles before P5; these canned outputs prove only plumbing.
- Proposal TP/FP/FN/TN join **all labeled opportunities**, not dispatched jobs. Clear positive skip/defer/error/unavailable/missing records count as FN. Received TP/FP/FN/TN are separate: absent expected receipt counts as received FN. For private memory, the receipt is private review, never parent injection.
- Precision = TP/(TP+FP); false-discovery fraction = FP/(TP+FP); recall = TP/(TP+FN); FPR = FP/(FP+TN). Each matrix publishes emitted-labeled, labeled-positive, labeled-negative and resolved denominators. Zero denominator is JSON `null` (n/a), not 1. Unresolved run/silent counts are separate, not easy negatives. Unlabeled proposals and missing opportunities are explicit lists.
- Expected `(module, frame, point)` tuples are an evaluator-only input. Count missed tuples and actual extras independently from semantic labels. Raw unwatched frames and unavailable records are separate counters. All oracle opportunities remain in quality/cost denominators even when not admitted.
- Receipt success = actually received / prepared proposals in the oracle set; enqueue failures and censored proposals are separate. Errors include delivery misses and module/slice confusion matrices; no bodies are copied into score output.
- Latency uses nearest-rank p50/p95 over observed receipts only, always with sample and censored counts; stage quantiles are separate. These are seeded **logical-ms**, NOT measured CPU/host/model latency and NOT evidence for P0 latency/overhead/memory gates. No missing-boundary latency is passed as zero.
- Cost per 100 opportunities = all module stub-estimated attempt USD / independently enumerated oracle opportunities ×100, including missed positives and technical failures. Both attempt totals and the opportunity denominator are explicit. No actual provider usage is claimed.

Gold labels and expected-trigger lists live in separate `*.labels.json` files. Neither the replay API nor its strict dataset/config schemas accept a label file/field. The label-isolation test flips labels/slices, observes all actual native model requests, proves identical model inputs and byte-identical replay artifacts, then proves scores change. Workers receive only admitted evidence and job data, not oracle labels.

## Knobs and restart semantics

The author configuration is validated/frozen before replay; there is no hot mutation API. A change requires a new manifest and a new pipeline/runtime (restart). An in-flight mutation test changes the caller's config during a model callback: the active replay remains byte-identical; reusing its manifest with the changed configuration is rejected.

| Knob | Enforcement |
|---|---|
| Watch points | Public `effectiveMonitoringWatch`: subset of core declaration only. |
| Material sources/total/source bytes | Positive bounded integers within the evaluator author ceiling; per-source ≤ total; public window enforces actual limits. |
| History turns | ≤ core declared history turns and ≤8; history is message-granular. |
| Question/criteria | Published question shape/length validated through core declaration validation; changed values get a new question/config hash. Authority does not come from question text. |
| Model binding | Exact author-allowlisted and built-in synthetic versioned binding only; no real-model fallback. |
| Timeout | ≤ evaluator declaration ceiling and bounded native/core worker deadlines. Logical recorded intervals are separate from these safety deadlines. |
| Report mode | Public `effectiveMonitoringJobs`: only declared supported modes; private candidate only `never`. |
| Stage | Public `effectiveMonitoringStage`: can only lower the author's maximum. Private memory fixture cannot become active. |
| Grants/risk/effects | Not tuning fields. Unknown knob keys reject. Evaluator accepts only one read-only job/module, no action grants; host reference kinds stay within declared grants. |

Tests cover widening each budget dimension, watch, history, model, timeout, report, stage and attempted grant injection. No configuration edit grants authority by changing instructions. Editing the author declaration/ceilings itself is a code-review event and changes its hash, not a knob override.

## Reproduction commands

Run from the repository root at a clean `qualification/p4` commit with the pinned lockfile and Bun 1.3.14. Shell redirection is intentional and outputs should remain outside tracked source. These commands use only synthetic fixtures and the local stub backend:

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
# typecheck routes all five configs: core, Pi, P1 examples, Pi tests, eval.

bun packages/eval/src/cli.ts run packages/eval/fixtures/dev.json packages/eval/fixtures/modules.json p4-dev 42 > /tmp/p4-dev-a.json
bun packages/eval/src/cli.ts run packages/eval/fixtures/dev.json packages/eval/fixtures/modules.json p4-dev 42 > /tmp/p4-dev-b.json
cmp /tmp/p4-dev-a.json /tmp/p4-dev-b.json
bun packages/eval/src/cli.ts score /tmp/p4-dev-a.json packages/eval/fixtures/dev.labels.json > /tmp/p4-dev-score.json
bun packages/eval/src/cli.ts compare /tmp/p4-dev-a.json /tmp/p4-dev-b.json packages/eval/fixtures/dev.labels.json > /tmp/p4-dev-compare.json

bun packages/eval/src/cli.ts run packages/eval/fixtures/holdout.json packages/eval/fixtures/modules.json p4-holdout 42 > /tmp/p4-holdout.json
bun packages/eval/src/cli.ts score /tmp/p4-holdout.json packages/eval/fixtures/holdout.labels.json > /tmp/p4-holdout-score.json
```

`run` accepts optional trailing `--content-consent`; default is no bodies. It fingerprints source and output script, validates the full manifest against both, then emits a canonical JSON run artifact. `score` and `compare` consume those artifacts without invoking any model. To compare a candidate, author one bounded config change (e.g. lower a report mode/stage or edit criteria), freeze it in a new JSON file, run on the **same** source dataset with a distinct run ID, then compare. Source/version/split mismatch fails. Stage fingerprints plus selected ID/versions, judgement mode, worker certainty and receipt kinds explain changes; comparisons never copy bodies, even from consented traces. Script differences are identified explicitly in `stubOutputsHash`. CLI error output intentionally omits arbitrary input/exception text.

To export the JSON schemas without adding dependencies, resolve the package from its own workspace (the monorepo root does not depend on eval; a root-level bare import probe failed and these commands were corrected):

```sh
(cd packages/eval && bun -e 'import {runManifestJsonSchema} from "@lazy-harness/monitoring-eval"; console.log(JSON.stringify(runManifestJsonSchema,null,2))')
(cd packages/eval && bun -e 'import {traceRecordJsonSchema} from "@lazy-harness/monitoring-eval"; console.log(JSON.stringify(traceRecordJsonSchema,null,2))')
```

## Executed evidence and findings

- Initial P2/P3 integration: 463 pass / 0 fail, 39 files; all four pre-eval typechecks green. No conflicts and no dropped tests.
- P4 suite: 44 new tests (507 total), covering manifests, exact replay bytes, holdout identity, labels-only scoring, redaction/consent, both retention caps, receipt/cancellation certainty, denominators, missing/extra opportunities, all knob widening cases, in-flight snapshot isolation and all five comparison reason categories.
- Full local check executed: `bun install --frozen-lockfile`, `bun run test`, `bun run typecheck` all exit 0. Test summary: **507 pass, 0 fail, 2941 expect() calls, 40 files**.
- Both tiny splits produce four prepared candidates: one per module. Expected admissions: 2 references, 2 rules, 2 memory, 3 loop. Three synthetic hook receipts plus one private candidate receipt; no real parent delivery or writes. Fixture positives are intentionally scripted, not semantic quality results.
- Core's `includeCurrentMaterial` keeps current-frame material even when the stub deselects other references. Deselection is visible in selection diffs but is not automatically a technical failure or proof of semantic usefulness.
- Pre-dispatch abort produces a terminal refusal, not a started cancellation. Uncertain worker failure remains accounted for without receipt/retry. Replay validates the actual completion category rather than inventing one.

### Verification receipts

Code/fixture commit tested: `2b8e760` (subsequent receipt update is documentation-only). Both local and fresh detached-worktree runs executed the frozen install, full root suite and all five configs via `bun run typecheck`; every command exited 0. The fresh worktree was removed after verification. The workspace lock change adds only the existing core workspace edge; no external dependency was added.

Local test summary (verbatim):

```text
 507 pass
 0 fail
 2941 expect() calls
Ran 507 tests across 40 files. [9.51s]
```

Fresh-checkout install/test summary (verbatim):

```text
bun install v1.3.14 (0d9b296a)

+ @types/bun@1.4.4
+ typescript@7.0.2

256 packages installed [465.00ms]
 507 pass
 0 fail
 2941 expect() calls
Ran 507 tests across 40 files. [9.63s]
```

Both typecheck invocations emitted this command and exited 0:

```text
$ tsc -p packages/core/tsconfig.json && tsc -p hosts/pi/tsconfig.json && tsc -p examples/p1/tsconfig.json && tsc -p hosts/pi/test/tsconfig.json && tsc -p packages/eval/tsconfig.json
```

Direct CLI run/score/compare commands above were executed (including both splits); their compact receipt was:

```text
CLI dev repeat: byte-identical (cmp exit 0)
dev: modules=4; TP=4; FP=0; FN=0; received=4
holdout: modules=4; TP=4; FP=0; FN=0; received=4
identical compare: changed=0
```

These are canned mechanical counts only. A full changed-file scan, including inherited P2 additions relative to P3, found **0 matches** for personal home paths, the local account name, email patterns, credential shapes and the prohibited integration-package name. The first scan's email regex falsely matched workspace lock entries; literal-dot matching corrected it. Exit handling was also corrected to distinguish grep's no-match from an error. No source was altered to hide a true finding. `git diff --check` passed. No push or GitHub write, paid call or real session data was used.

## Limits / UNVERIFIED

Real inference, real sessions, semantic accuracy, independent blinded labels, untouched P5 holdout, confidence intervals, actual paid usage, production module migration/activation, real Pi/provider delivery, real latency/overhead/RSS, soak/interleaving breadth, restart durability and live shadow acceptance are **UNVERIFIED / out of this P4 implementation**. The published tiny holdout has been inspected and must not be reused as independent acceptance. No P0 numeric gate is declared passed. A future real-provider/host path requires separate approval, versions and receipts; this offline runner makes no such call and has no network/provider client dependency.
