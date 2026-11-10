# P5 decision package — issue #1

**DECISION PACKAGE ONLY; every recommendation is a PROPOSAL, not execution authorization.** Review base: `2841e7a75023e6992e7d070ad692c4574e481365`. Complements [PR #7](https://github.com/lazy-dinosaur/lazy-harness-monitoring/pull/7); supersedes nothing. Its plan is cited as **P**, pinned to [`398042c0963d50e5f4b20c5aa560708388abb69b:docs/qualification/p5-plan.md`](https://github.com/lazy-dinosaur/lazy-harness-monitoring/blob/398042c0963d50e5f4b20c5aa560708388abb69b/docs/qualification/p5-plan.md). P is review evidence, not current implementation status.

User-set boundaries (2026-11-09 task instructions): decision #1 is settled (review plan accepted; code separately; modules migrated), #5 is synthetic-only (real sessions require separate consent), #10 is settled (raw results private outside Git, retained 30 days, never committed). None is reopened. No models, real sessions, dependency/source/test changes, contract work or merge belong to this task. `docs/design/*`, `lazy-harness.module.json` and `feat/module-contract` remain untouched/on hold. Decision choices below authorize planning only; later work needs a separate scoped request.

Evidence shorthand (paths relative to repository; line numbers at the review base unless P):

| Key | Read file / locator | Boundary |
|---|---|---|
| C | [acceptance-criteria.draft.md](acceptance-criteria.draft.md):3–21,24–105 | All targets are provisional, not measurements; re-confirm before measurement. |
| R | [references source](../../modules/references/src/index.ts):6–31,45–97; [README](../../modules/references/README.md):7–35,51–57 | Gap filler, host read ledger, deterministic template, explicit stages. |
| U | [rule-steering source](../../modules/rule-steering/src/index.ts):4–46,50–129; [README](../../modules/rule-steering/README.md):7–36 | Admitted versioned policy, current-event question, observe ceiling, per-rule verifier. |
| M | [memory source](../../modules/memory/src/index.ts):7–54,64–146; [input](../../modules/memory/src/input.ts):4–40; [README](../../modules/memory/README.md):5–42 | External typed judgment, exact-span template, volatile private receipt; no model caller. |
| E | [replay](../../packages/eval/src/replay.ts):47–138,175–181; [trace schema](../../packages/eval/src/trace-schema.ts):15–25; [contracts](../../packages/eval/src/contracts.ts):10–39,50–68 | Stub-only logical replay, not physical HTTP/USD/wall measurement. |
| S | [P3 review](p3-pi-adapter-qualification.md):5–34,449–456; [pending migration](pending-pi-protection-migration.md):3–13 | SDK fixture and restored protections, not complete P3 exit. |
| D | [P2 R7 review](p2-reliability-review.md):254–300,387–394 | Conservative opt-in persistence implemented; default in-memory; real-host durability unqualified. |

**Numeric discipline:** cited C/P values below remain provisional; derived future counts, caps, hypothetical rates, schedules and option parameters are explicitly **PROPOSAL**. IDs, dates, code constants, versions and citation line numbers identify evidence, not measured performance. Historical numbers are claims read in P, not independently verified external results. No holdout or run results were produced here.

## #2 — Purpose, catalog and rule authority

**Question:** Which references purpose/catalog and U6 authority should define the synthetic oracle?

| Option | Concrete choice | Pros | Cons |
|---|---|---|---|
| A | Keep U1 broad gap filler with an explicit versioned admitted synthetic catalog and host-owned already-read/compaction state; confirm U6 explicit versioned admitted rules, current event only, visible exceptions and missing-value defer. | Matches R:7–31,69–97 and U:6–24,50–81; reproducible authority and gold. | Host admission, read provenance and source freshness still need proof. |
| B | U1 narrow scoped lookup; retain A's U6 authority. | Smaller usefulness question; comparison wording already exported (R:17–24). | Different candidate/config and independent gold; cannot mix lookup and gap-filler scores. |
| C | Defer semantic qualification; use invented mechanics only until catalog/rule admission policy is named. | No ambiguous authority claim. | Does not unblock semantic labels or model runs. |

**RECOMMENDED A —** confirms the provisional U6 choice and the shipped broad references purpose without importing a real registry.

Unblocks: label policy, synthetic world construction and source/version manifests, not activation. Treat `policy` kind, model confidence, an assistant's claim of approval and a successful tool result as data, not authority (U README:13; M README:9–16). R's raw `input` watch does not prove user-origin filtering (R README:35); host admission must cover it.

User must type: `P5 #2=A` (or `P5 #2=B` / `P5 #2=C`); A also requires `catalog-owner=<name>; rule-admission-owner=<name>; policy-version=<id>` before construction.

## #3 — Quality, trigger and uncertainty gates

**Question:** Should each provisional quality/trigger row be kept, replaced before freeze, or deferred?

| Option | Concrete choice | Pros | Cons |
|---|---|---|---|
| A | Keep the following point-estimate gates with intervals and full denominators; defer optional loop until separately scoped. | Retains C's review baseline without pretending calibration. | These sizes do not establish rare-error reliability; no blanket received-quality pass for observe-only U6. |
| B | Replace point gating with confidence-bound gating (lower bounds for precision/recall, upper for FPR/false discovery); approve revised sizes before data construction. | Stronger uncertainty-aware claim. | Needs a pre-run sample calculation and new budget; cannot reuse A's feasibility assumptions. |
| C | Keep exact mechanics only; defer semantic gates. | Useful offline protection evidence without semantic promises. | No semantic qualification. |

Every value in this ledger is **provisional from C:28–33 and P:88–95**; recommendation A is a PROPOSAL to keep, not a claim it passes. FD = FP/(TP+FP); FPR = FP/(FP+TN).

| Row | Precision / recall | FD / FPR ceilings | Missed / extra deterministic pairs | Rationale and prior evidence in P:73–83 | Keep/replace recommendation |
|---|---|---|---|---|---|
| References | ≥0.95 / ≥0.85 | ≤0.05 / ≤0.05 | 0 / 0 | Parent attention; P U1 synthetic exact sets 95.3% failed historical 97%; real-summary recall 71.4%, gold-contained 52.4% did not qualify. Old denominators/purposes differ. | Keep for synthetic scope; exact material correctness separately reported. |
| U6 rules | ≥0.98 / ≥0.80 | ≤0.02 / ≤0.02 | 0 / 0 | Incorrect correction is disruptive; P U6 holdout false-trigger 4.2%, exact sets 76.2%/78.6%; seeded recall 65.3%, rule accuracy 60.0% failed. | Keep judgment gates; defer useful-reminder receipt acceptance while observe-only. |
| Memory | ≥0.97 / ≥0.75 | ≤0.03 / ≤0.03 | 0 / 0 | Avoid review pollution; P old synthetic recall 100%, false-trigger 0% is a different task; separate pilot joint semantics 9/12 = 75% failed. | Keep; accepted-volatile receipt is not truth, approval or persistence. |
| Optional test-loop | ≥0.95 / ≥0.90 | ≤0.05 / ≤0.05 | 0 / 0 | Avoid nagging useful retries; P reports no corresponding prior acceptance evidence. | Defer optional module; retain these values only as provisional candidate gates. |
| Core mechanics (C:72; P:123) | 1.00 / 1.00 | 0 / 0 | 0 / 0 | Exact offline oracle; existing replay mechanics are not the proposed sized campaign. | Keep. |
| Uncertainty (C:20; P:118) | 95% Wilson precision/recall/FPR intervals; bootstrap quantile intervals | FD also reported with denominator; PROPOSAL use Wilson for FD too | n/a | Reveal finite denominators; P found no directly corresponding interval acceptance evidence. | Keep point gating plus intervals; do not substitute confidence for gold. |

**RECOMMENDED A —** keeps purpose-specific conservative targets while making their lack of calibration and scope limitations explicit.

Unblocks: preregistered scoring and development failure classification. Keep every oracle opportunity, including missing admission/material/receipt and clear-positive technical failures (FN). Undefined denominators are `n/a`; unresolved labels stay separate, never easy negatives. Require independent useful-received scoring and exact document/rule-set diagnostics, not just mode agreement (C:9–21; P:88–95,208). No new exact-set acceptance percentage is proposed; unresolved gold or absent receipt evidence blocks the corresponding claim rather than becoming a pass.

User must type: `P5 #3=A` (or `P5 #3=B; replacement-ledger=<each row, gate, size>` / `P5 #3=C`); row-specific overrides require `row=<id>; keep|replace|defer; value=<if replaced>` before freeze.

## #4 — Resources, samples, coverage and stop quantities

**Question:** Which provisional resource, sample, duration and safety-stop quantities should govern the bounded synthetic campaign?

| Option | Concrete choice | Pros | Cons |
|---|---|---|---|
| A | Keep applicable synthetic rows below; explicitly defer loop/P6 rows and resolve the paid envelope under #6. | Preserves the reviewed fixture baseline with explicit exceptions. | Not a production SLA or proof of operational restart durability. |
| B | Replace named rows with hardware/provider-specific values before freeze. | Can reflect the actual environment. | Needs new rationale, sample/budget fit and user approval, not post-run relaxation. |
| C | Defer resource qualification; mechanics-only design review. | No unfunded benchmark promises. | Cannot claim P5 resource acceptance. |

All quantities in the following tables are **provisional C values reproduced in P:97–134**. A recommends **keep** unless its last column says defer/replace. P's timing/cost analogues are historical record claims only: judge p50/p95 412/478 ms, older worker readiness p95 10.3–11.7 s (P:80); neither calibrates these targets.

| Owner (C:41–45) | End-to-end p50/p95 | Incremental hook p50/p95 | RSS ceiling | USD per 100 oracle opportunities | Rationale / prior evidence / recommendation |
|---|---|---|---|---|---|
| References | 1/4 s | 0.5/2 ms | +32 MiB | 0.50 | Timely template; historical judge timing only, no complete receipt/hook/RSS gate evidence; keep for controlled receipt fixture. |
| U6 | 2/6 s | 0.5/2 ms | +48 MiB | 1.00 | Verifier latency/state allowance; P U6 cost is not normalized acceptance; keep hook/RSS/judge-cost checks, defer reminder end-to-end gate under observe-only. |
| Memory | 3/10 s | 0.5/2 ms | +32 MiB | 0.50 | Less urgent private candidate; no new-module resource acceptance in P; keep for approved shadow/private receipt. |
| Optional loop | 0.5/2 s | 0.5/2 ms | +16 MiB | 0.20 | Small reducer; no corresponding evidence in P; defer. |
| Core + Pi stub | 10/50 ms | 0.5/2 ms | +128 MiB; absolute 512 MiB | 0 actual external spend | Separate offline mechanics from inference; no full-path resource acceptance in P; keep. |

| Quantity (C locator) | Provisional value | Rationale / prior evidence in P | Recommended keep/replace/defer |
|---|---|---|---|
| References samples/coverage (55) | Dev 200; holdout 200 = 80 positive/100 negative/20 unresolved; 2 offline days | Breadth, not rare errors; prior real-summary sample purpose/split differs. | Keep; PROPOSAL same dev mix from P:143. |
| U6 samples/coverage (56) | Dev 250; holdout 250 = 100/125/25; 3 offline days, tool/assistant and finalized/provisional slices | More negative scrutiny; P prior U6 holdout/seeded samples differ. | Keep for judgment scope; PROPOSAL same dev mix from P:143. |
| Memory samples/coverage (57) | Dev 200; holdout 200 = 60/120/20; 3 offline days; repeat/conflict/restart slices | Conservative candidate scope; old memory task is not acceptance. | Keep; PROPOSAL same dev mix from P:145; restart slice tests conservative loss, not persistence. |
| Optional loop (58,62) | Dev/holdout 200/200; holdout 80/100/20; 2 offline days; 3 finalized failures of same normalized command within 10 min, no meaningful source change | Temporal oracle; no corresponding evidence found in P. | Defer incident normalization and module. |
| Shared safety (59) | 1,000 dev + 1,000 fresh fault sequences; 10,000 hook samples; 60 min mixed soak; 10 restart/cleanup cycles | Sized fault/overhead evidence not established by existing tests (P:113). | Keep for synthetic approved recovery semantics; no repeated semantic attempts. |
| Reviewers/RSS cadence (64) | 2 independent reviewers + separate adjudicator; RSS every 1 s plus high-water | Bias control and longitudinal practicality; P historical blind cross-review is precedent, not full adjudication; short peaks can escape cadence. | Keep policy; #7 must name practical roles; inability to supply independence blocks that claim. |
| Safety/privacy/event continuity (73–75) | Stop on 1 duplicate/unauthorized/stale/uncertain-auto-retried effect, 1 leak, or 1 unexplained loss/order gap | Cannot average away harm; no complete P5 acceptance evidence in P. | Keep. |
| Physical ownership (76) | 0 freed slots before settlement; 0 late effects after cancel; admitted queue/retention caps | Logical cancellation is not physical termination; prior mechanical scope only. | Keep. |
| Soak trend (77) | Post-drain growth ≤8 MiB between first/last matched 10 min windows; stay within peak ceilings | Diagnostic, not leak proof; no corresponding measurement found in P. | Keep. |
| Resource stop (78) | First deterministic cap violation; pause after 2 consecutive matched p95-exceeding batches | Hard bounds immediate; avoid noise-driven rerolls; no protocol evidence found in P. | Keep; PROPOSAL fix batch membership before measuring. |
| Drain (79) | 60 s controlled-fixture drain ceiling | Finite stop without false force-kill claim; prior physical ownership contract is not drain-time evidence. | Keep; mark unsettled work incomplete/uncertain. |
| Paid ceiling (80) | USD 10/module, USD 30 combined, 1,000 calls/module, 2 h wall, first reached | Exposure bound, not prior acceptance; P explicitly requests a larger full-U6 call cap. | Replace only through explicit #6 choice; include data creation/labels. |
| P6 pilot only (60,81) | ≥500 triggers and ≥50 labeled positives/module; ≥7 days, hard cap 14; stop admission/new reports within 1 s of kill switch | Variation/rollback; P found no qualifying pilot. | Defer all to P6; no live permission. |

**RECOMMENDED A —** keeps the review baseline only where the proposed stage can actually supply evidence.

Unblocks: a fixture/environment preregistration with hardware/toolchain/SDK/model/config, admitted maximum input sizes and controlled next-call availability. Match enabled-minus-disabled hook samples (not subtraction of independent percentiles), keep censored live wait separate, normalize cost over oracle opportunities including failures, and record RSS/high-water/retained counts (C:16–21; P:105). Offline observation days are coverage/scheduling minima, not paid execution-time extensions; stop failed/insufficient on exhaustion (C:82; P:172–178). #11 governs current R7 semantics, correcting P's historical unsupported-status assumption without changing its gates.

User must type: `P5 #4=A` (or `P5 #4=B; replacement-ledger=<rows with values/environment/rationale>` / `P5 #4=C`); A requires `environment-owner=<name>` before measurement. #3 handles uncertainty policy; #6 handles paid caps.

## #6 — Model identities and recomputed cumulative budget

**Question:** Which pinned model roles and cumulative HTTP/USD/wall ceilings should be reserved, given actual module calls and the U6 observe-only limit?

PROPOSAL model roles, from P:159–163: judge/verifier `openrouter/typesafe/jev-1.14` / typed `typesafe-system-one`; synthetic generator/initial labeler `openai-codex/gpt-6.1-sol`; blind cross-labeler `claude-opus-5-5`; separate adjudicator. These are historical names, **not verified available or immutable identities**. Deterministic workers only; PROPOSAL generative worker calls 0, retries 0, no fallback. Exact provider revisions, conservative token/request bounds, availability, prices, auth attribution and a metered provider runner must be approved separately before calls. OAuth is not free spend. No model discovery/call is performed here.

### Actual call topology and what the evaluator counts

| Module/path | Logical calls per eligible opportunity | Source and consequence |
|---|---|---|
| References | Up to 1 primary classifier invocation when admitted; 0 verifier/generative worker calls | R:27–31,73–97 has a deterministic deliver template; E replay:107–124 records request/answers in one invocation, including reference selections. Missing admission is still an oracle opportunity, not a free denominator deletion. |
| Memory | Module itself 0 judge calls; PROPOSAL external P5 classifier up to 1/opportunity; 0 verifier/generative worker calls | M:20,43–54,127–130 takes a supplied typed mode and copies exact spans. E replay:59–94 bypasses model backend, uses `script.mode`, `judgement.inputs=[]`, `cost.judgeCalls=0`, `verifierCalls=0`, USD 0. Budgeting a future external judge is a PROPOSAL, not an assertion that replay already meters it. |
| U6 observe | Up to 1 primary judgment, 0 verifiers | U:29,45–46 and README:12,33: shipped observe ceiling runs no job/report/verifier. |
| U6 executed reminder job (conditional, not stage permission) | 1 primary + N verifiers, N ≤ 8; worst case 9; 0 generative workers | U:5,33,95–116: reject above cap, subtract per-turn ledger, reserve full pending batch, invoke one verifier task per pending selected rule via `Promise.allSettled`. Task keeps one policy, disables per-item reference questions (U:70–81). No hidden engine-level second judgment. |

E replay:98–105 appends each scripted verifier task/result to `work.verification`; :115–123 appends primary requests to `judgement.inputs` and raw responses to `judgement.raw`. At :181, **`cost.judgeCalls = judgement.inputs.length + work.verification.length`**, **`cost.verifierCalls = work.verification.length`**, `cost.workerCalls = dispatched.length`; USD is a **stub estimate** from judge and worker rates. Trace-schema:15–25 validates the identities/count relationship. Do **not** add `judgeCalls + verifierCalls`: verifiers are already included. A dispatched deterministic template is not a generative HTTP call. Memory's special branch records its prepared worker separately but no model call. A separate future memory judge ledger/accounting integration is required before its paid evaluation; current zeroes cannot support a paid-cost claim.

`contracts.ts:39` rejects non-stub bindings. Existing U6 shadow evaluator is **scripted-only**, adjusts only its ceiling and keeps report `never` ([rule-steering.ts](../../packages/eval/src/rule-steering.ts):5–23). Thus none of the physical budgets below can be executed by simply changing a model name in current eval. Provider metering, memory judgment accounting, monotonic timing, independent semantic/receipt scoring, private artifacts and bounded shard aggregation remain separately approved work (P:50). No contract-dependent work is unblocked here.

### Dataset and arithmetic (all future quantities PROPOSAL)

Use P:143,165–177: references dev/holdout **200/200**, U6 **250/250**, memory **200/200**, optional loop **200/200**, with the class mixes in #4. Initial dev + at most one revised full dev + single holdout yields **600 references**, **750 U6**, **600 memory** evaluation opportunities; optional loop adds **600**. Construction caps per module are **60 generation + 60 cross-label HTTP**, not per-case calls; batch yield is UNVERIFIED, and disagreement adjudication must be human/local or charged inside these caps, never an unmetered third model budget. Quotas must be met before sealing or stop insufficient. Independent worlds/incident groups, not paraphrases split across sets.

PROPOSAL HTTP conversion assumes **one physical attempt per primary/verifier invocation**, no retries, hidden subrequests or automatic extra labeling. Future adapter must prove/meter actual HTTP; provider batching savings are not assumed. At worst every U6 opportunity selects the full cap; do not budget only labeled positives, because false selections also cost calls.

| PROPOSAL allocation | Data HTTP (generation + cross-label) | Evaluation HTTP | Total HTTP | USD ceiling data + eval | Wall ceiling data + eval |
|---|---|---|---|---|---|
| References | 60 + 60 | 600 × 1 = 600 | 720 | 4 + 4 = 8 | 45 + 75 min = 2 h |
| Memory, external judge reserved | 60 + 60 | 600 × 1 = 600 | 720 | 4 + 4 = 8 | 45 + 75 min = 2 h |
| U6 observe-only (A) | 60 + 60 | 750 × 1 = 750 | 870 | 4 + 6 = 10 | 45 + 75 min = 2 h |
| U6 full per-rule reserve (B, instead of A) | 60 + 60 | 750 × (1 + 8) = 6,750 | 6,870 | 4 + 6 = 10 | 45 + 75 min = 2 h |
| Optional loop, separate scope | 60 + 60 | 600 × 1 = 600 | 720 | 2 + 2 = 4 | 45 + 75 min = 2 h |

Dollar/time subcaps above retain P:165–176 allocations; they are **ceilings, not a price quote or measured runtime**. A reduces HTTP from P's full-verifier reserve but conservatively retains its USD/time stop caps. Compared with C:80, A stays below the provisional calls/module cap; B expressly replaces it for U6. Offline shared mechanics adds **PROPOSAL 2 h, HTTP 0, USD 0** (P:175).

| PROPOSAL campaign | Total HTTP | Total USD ceiling | Cumulative module wall ceiling | Including shared mechanics |
|---|---|---|---|---|
| A: three migrated modules, U6 observe | 720 + 870 + 720 = **2,310** | **26** | **6 h** | **8 h** |
| B: three modules, full U6 reserve | 720 + 6,870 + 720 = **8,310** | **26** | **6 h** | **8 h** |
| A + optional loop | **3,030** | **30** | **8 h** | **10 h** |
| B + optional loop (P full envelope) | **9,030** | **30** | **8 h** | **10 h** |

For an explicit **PROPOSAL arithmetic illustration only**, assume all judge/verifier attempts cost **USD 0.0008** and **0.5 s serial wall/attempt**, all construction/label attempts **USD 0.02** and **10 s/attempt**, with no other model calls, waits or retries. These are invented planning rates, not current vendor prices or historical rates. For three modules: data **360 HTTP / USD 7.20 / 60 min**; A evaluation **1,950 HTTP / USD 1.56 / 16.25 min**, total **USD 8.76 / 76.25 min** model time; B evaluation **7,950 HTTP / USD 6.36 / 66.25 min**, total **USD 13.56 / 126.25 min** model time. Each optional loop adds **USD 2.88 / 25 min** at these assumptions. Shared mechanics retains its separate ceiling; human curation and offline day coverage are excluded from model-time illustrations. Actual total USD/wall is **UNVERIFIED** until conservative current-price/input/latency preflight fits every subcap. If not, stop and replace scope/budget before releasing holdout; never call ceiling sums forecasts.

### Options, including cheaper verifier designs (all effects PROPOSAL)

| Option | Concrete choice / estimated HTTP effect | Pros | Cons / separate code required? |
|---|---|---|---|
| A | Reserve observe-only envelope: three-module 2,310 HTTP / USD 26 / 8 h including mechanics; optional loop deferred. | Matches #9; U6 870 total HTTP remains below C's cap. | U6 reminder verification/receipt quality unqualified; metered provider/eval work still separate. No rule-steering algorithm change. |
| B | Reserve full per-rule worst case: three-module 8,310 HTTP / USD 26 / 8 h; U6 6,870 total HTTP. | Preserves all selected-rule verification and P's full budget arithmetic. | Budget alone cannot lift observe ceiling. U6 synthetic verifier execution needs separate scoped permission/runner; production stage changes require separate code approval. No verifier-algorithm change, but full paid path is not currently supported. |
| C | Batch all selected rules into one typed verifier call: U6 ≤750 × 2 = 1,500 eval, 1,620 with data; three-module 3,060 HTTP. | Saves 5,250 HTTP versus B, verifies all selected rules if equivalent. | **Rule-steering code change required**, separately: multi-rule task/result schema, per-rule fail-closed mapping, cost reservation and ledger behavior; new equivalence/quality evidence. Correlated errors/bigger prompts can defeat savings. |
| D | Verify only deterministic top-k, PROPOSAL k=2: U6 ≤750 × 3 = 2,250 eval, 2,370 with data; three-module 3,810 HTTP. | Saves 4,500 HTTP versus B; bounded verification. | **Rule-steering code change required**, separately: selection/ranking and explicit unverified-rule abstention. Drops recall potential; silently truncating current selections is forbidden. Fresh candidate/gold review. |

C/D do not automatically meet the provisional calls/module limit and cannot inherit B's quality claim. At the **same hypothetical rates above**, C's three-module total is **USD 9.36 / 82.5 min** model time and D's **USD 9.96 / 88.75 min**; these estimates exclude new code/curation cost and shared mechanics. Retaining B's USD 26 / 8 h ceiling for either is a **PROPOSAL**, not an asserted realized saving in dollars or wall time; batching changes token/latency economics. Current per-rule fan-out is concurrent inside the handler, so serial illustrations are not measured wall predictions.

**RECOMMENDED A —** replaces P's full-verifier reservation with a stage-consistent initial campaign; choose B explicitly only if reserving dormant verifier headroom is desired.

Unblocks: explicit budget/scope selection and a separately reviewed preflight/runner specification, not paid calls. Every data/eval/module/campaign subcap binds; no transfers, warm-ups, retries, fallback or reset on failure. To make #7's post-freeze generation possible across the offline coverage days, **PROPOSAL replace P:173's contiguous data/evaluation clocks with predeclared finite sub-stages**: dev construction 20 min + post-freeze holdout construction 25 min (45 min total), and initial dev 25 min + revised dev 25 min + holdout 25 min (75 min total). Each sub-stage starts at its first request, never pauses on crash/wait/resume, cannot be reopened, and expires to insufficient evidence; unused time is not transferable. Cumulative HTTP/USD/data/eval/module/campaign caps never reset between sub-stages. Human review/coverage days may separate sub-stages but cannot host background calls; these are ceiling sums, not one continuously running campaign. This clock-policy replacement needs explicit confirmation with #6; if rejected, use #7 B with holdout construction before tuning under P's original data clock or defer execution. First exhausted cap stops new requests; safety failure remains failed, otherwise insufficient evidence. Preserve physical ownership and the #4 drain limit; unknown pricing refuses requests.

User must type: `P5 #6=A; models=proposed-names-pending-preflight; loop=defer; clocks=bounded-substages` (or `P5 #6=B; U6-total-HTTP=6870; verifier-execution=not-authorized` / `P5 #6=C; request-separate-batch-design` / `P5 #6=D; k=2; request-separate-top-k-design`). Exact model revisions/prices and **execution consent** require another explicit request after preflight, not this choice.

## #7 — Labels, adjudication and sealed holdout custody in a solo project

**Question:** How can a solo tuner keep synthetic holdout sources and labels away from tuning without claiming nonexistent independent custody?

| Option | Concrete choice | Pros | Cons |
|---|---|---|---|
| A | After dev tuning freezes, use a separate isolated construction/label run; user is procedural custodian and does not inspect cases; separate blind labeler plus named independent adjudicator; sealed runner opens once. | Practical solo workflow; minimizes advance exposure and needs no shared real data. | Same owner can bypass filesystem controls; not independent human custody. If an independent adjudicator is unavailable, report that limitation and block the full independence claim. |
| B | Recruit a genuinely separate trusted human custodian/adjudicator with holdout-only storage/access; tuner receives aggregate conclusions only. | Stronger actual role/access separation; matches P:149–155 default. | Scheduling/access overhead; cannot assume a volunteer exists. |
| C | User constructs/reviews every case personally, then freezes it as a public-to-tuner diagnostic set. | Simple, useful debugging. | Not a sealed acceptance holdout; fresh unseen evidence still required. |

**RECOMMENDED A —** makes a workable procedural barrier explicit without presenting solo custody as independent curation; use B when a trusted independent person is available.

PROPOSAL procedure, based on P:149–155 and C:88–94:

- User fixes normative usefulness/authority policy and disjoint world/domain/incident groups before construction; related paraphrases/prefixes never cross splits. Public P4 fixtures and tuner-seen worlds are dev only. Finish #8 dev work and freeze candidate/config/question/material/model/threshold/cap identities before the holdout-only run; it must not consume dev errors or tuned runtime question text as its gold definition.
- User selects a private state root **outside every Git worktree and sync/ingestion root**; PROPOSAL restricted owner-only directory/file access (`0700`/`0600`). Separate OS account or encrypted archive whose unlock is withheld from the tuning process strengthens isolation; separate run/conversation alone is not access control. No corpus, labels, raw outputs, receipts or usage journal enter Git. Settled retention is 30 days; choose collection-time owner/start timestamp and deletion action, with no unapproved preservation exception.
- Construction is a distinct bounded run using only approved synthetic recipe/policy. Generator's proposed labels stay private; different-family cross-labeler sees source and fixed policy, not generator labels/candidate outputs. Named separate adjudicator resolves disagreements blind to candidate; unresolved stays unresolved. A solo owner who adjudicates a case has seen it: retire that world group to dev and replace within construction cap before sealing, or stop insufficient. Do not invent independence from two prompts to the same tuned worker.
- Hash **exact bytes with SHA-256** for source shards, labels, split membership, source/rule revisions, label policy and adjudication record; then hash the manifest of those digests. Record only privacy-approved opaque identity/digests and frozen-candidate identity in an authored decision record; hashes do not anonymize sensitive material. No seals exist yet.
- Custodian-controlled runner verifies seals, loads source through a label-free runtime channel and gold only into the scorer. Offline label-permutation/request-identity probe precedes paid permission. Open once for the single frozen run, verify hashes afterward, then return only approved aggregate conclusions. No example/error browsing while tuning; no second run to improve a score. Exposure used to tune retires the entire affected acceptance set, requiring fresh construction and new campaign authorization.

Unblocks: custodian/access/labeling protocol and later synthetic sealing, not generation now. Missing roles, quota shortfall or broken isolation means insufficient evidence, not a weaker unlabeled pass. A's temporal/access separation is a PROPOSAL replacement for P's as-yet-unassigned independent-custodian default; its limitations must accompany any report.

User must type: `P5 #7=A; custodian=<name>; adjudicator=<independent name or unavailable>; private-root=<outside-Git path>; deletion-owner=<name>` (or `P5 #7=B; custodian=<independent name>; adjudicator=<name>; private-root=<path>` / `P5 #7=C; acceptance-holdout=deferred`). A with `unavailable` cannot claim the separate-adjudicator gate is met.

## #8 — Bounded development tuning and failure disposition

**Question:** How much development tuning is allowed before freeze, and what happens if development or holdout fails?

| Option | Concrete choice | Pros | Cons |
|---|---|---|---|
| A | PROPOSAL initial complete dev + at most one revised complete dev, one predeclared factor changed; single holdout only after passing final applicable dev gates (P:171,190–192). | Bounded overfit/spend; fits #6 arithmetic. | A failed final dev ends campaign; improvement may require fresh approval. |
| B | PROPOSAL initial dev only, then freeze if passing. | Cheaper, less adaptation; saves at most 650 evaluation HTTP across three modules under #6 A, or 2,650 under #6 B. | Less diagnosis headroom; unused budget is not transferable. |
| C | Defer tuning and use scripted mechanics only. | No semantic iteration spend. | Does not qualify a semantic candidate. |

**RECOMMENDED A —** retains P's bounded failure-classification process, not open-ended prompt search.

Unblocks: preregistered dev comparison and freeze criteria. Classify event/admission, material, judgment/selection, worker, delivery, labeling and transport/evaluator defects before proposing the one factor. Failed initial dev permits only that bounded revision; failed final dev stops before holdout. Failed holdout stays failed, exhaustion/missing evidence stays insufficient, with no gate waiver, reroll, automatic sampling, budget reset or post-hoc passing slice. Holdout-informed changes retire the affected acceptance set (#7). No new candidate is silently covered by unused caps.

User must type: `P5 #8=A; factor-change=predeclare-before-revision` (or `P5 #8=B` / `P5 #8=C`).

## #9 — Stages, allowed actions and receipt evidence

**Question:** Which stage/action boundaries should apply to each module before any separately approved synthetic measurement?

| Option | Concrete choice | Pros | Cons |
|---|---|---|---|
| A | Confirm U6 observe-only; memory observe then separately approved synthetic shadow/private review; references observe then separately approved synthetic shadow; optional loop deferred. | Matches provisional user direction and U/M ceilings; no parent injection/writes. | Cannot claim U6 verified reminders or reference useful-received parent recall without a separate controlled delivery probe. |
| B | Observe-only for all modules. | Lowest effects risk and cost. | No prepared/private-candidate receipt quality evidence; judgment-only qualification. |
| C | Defer all execution (off); finish design and mechanical review first. | Avoids incomplete runner/receipt assumptions. | No semantic measurement. |

**RECOMMENDED A —** confirms U6 observe-only and memory observe/shadow without smuggling in live activation.

Unblocks: stage-specific fixture/claim matrix, not activation. U:29,45–46 caps the shipped registration at observe. E's existing scripted-only U6 shadow probe (rule-steering.ts:5–23) is mechanical evidence, not permission to widen production or use paid verification. Memory `active` rejects; shadow hands only to a protocol-checked volatile private review sink (M:33–38,102–119). `accepted-volatile` means retained in process, never approved/persisted/viewed/provider-delivered (M README:33–35).

References shadow prepares but withholds reports; its current eval helper explicitly uses active for scripted fixture delivery (R README:29; eval/references.ts:8–14), not an authorization under A. A later separately approved controlled synthetic delivery fixture may observe actual next model input; distinguish prepared, enqueue, hook-boundary and final provider input (S:34; R README:32; U README:27). No live injection, canonical memory write, blocking, steering or auto-fix. A stage choice cannot upgrade absent receipts into successes or waive #3/#4 gates; report only the judgment/preparation/receipt claims that stage supports.

User must type: `P5 #9=A; U6=observe; memory=observe-then-separate-shadow; references=observe-then-separate-shadow; loop=defer` (or `P5 #9=B` / `P5 #9=C`).

## #11 — SDK, migrated protections, restart and placement obligations

**Question:** Which remaining SDK/source/receipt/restart/placement obligations block progression despite migrated modules and mechanical protections?

| Option | Concrete choice | Pros | Cons |
|---|---|---|---|
| A | Keep existing exact SDK fixture and active protection coverage; use a loss-tolerant no-auto-replay P5 restart policy, with real-host durability and placement deferred. | Correct current status; scoped synthetic progress without durability claims. | Durable/live readiness stays blocked; advice may be lost on restart. |
| B | Make operational durability a prerequisite: separately qualify opt-in R7 backend/host/target fencing and receipt reconciliation before semantic execution. | Stronger recovery assurance. | Additional work cannot be inferred from current synthetic conformance or this package. |
| C | Stop at documentation/mechanics; defer SDK/host/restart claims entirely. | No overclaim. | Blocks progression requiring those claims. |

**RECOMMENDED A —** acknowledges implemented R7 and migrated protections while preserving the real-host gate.

Current facts, not new approvals:

- P's placeholder modules, pending-protection debt and unsupported-R7 descriptions are historical. S:5–8,26 and pending-migration:5–13 report the remaining five legacy suites migrated to active protection tests; do not ask the user to restore them again. SDK `@earendil-works/pi-coding-agent` **1.5.0** remains the exact faux-provider fixture. This package neither reruns those suites nor infers real-network delivery from them.
- D:254–280 implements optional module-owned `StatePersistencePort` recovery, queued-work drop, in-flight uncertainty/no replay, unresolved-capacity blocking and receipt separation; default runtime/mailbox stays in memory. D:282–296 describes conservative cost charging, single-writer file backend and finite synthetic conformance, **not** OS-kill/power-loss/multi-process/real-worker acceptance (D:298–300,389–390). Memory review retention remains volatile; its module has no R7 persistence (M README:35).
- Under A, PROPOSAL P5 fixture policy is to drop pending read-only advice/carry across restart, preserve authoritative tombstones/reservations when opted into state, never reissue uncertain work and require fresh binding/grants/source checks before new work. This is a measurement-scope policy, **not** a claim that every current mailbox automatically drops: D:277–279 can restore matching pending carry, revalidates on take, and marks delivery uncertain before exposure. Any configuration/host change needed to implement the chosen drop policy is separate work. Failure to preserve uncertainty/capacity blocks a recovery claim.
- Keep capture-before-dispatch origin/dependency identities, live source-version resolvers, current grants and matching independent receipts. S:449–456 still excludes generic source mapping, complete overhead/resources, real serialization and turnkey scheduler/worker integration. Test-owned handoff is not product registration. D1' in [README](README.md), Confirmed decisions keeps the exact-pinned Fabric worker implementation/consumer probe downstream in lazy-harness, not a dependency or host here.
- Tmux can preserve a still-running process after UI detach, not JavaScript state across crash/reboot, idempotency, grants, cost reservations or target receipts (D:383–385). Defer placement and cutover; no daemon, contract work, provider integration, P6 pilot or P7 promotion is authorized. Contract-dependent obligations remain on hold, not silently satisfied by selecting A.

Unblocks: accurate obligation ownership and conservative restart fixture planning. Keep real provider-input, source freshness, actual worker termination, persistent target fencing and operational crash recovery explicitly **UNVERIFIED** until their separate proofs. This decision package supersedes no earlier record; it cites newer implementation sections rather than treating historical statements as current facts.

User must type: `P5 #11=A; restart=drop-read-only-no-uncertain-replay; operational-durability=unverified; placement=defer` (or `P5 #11=B; request-separate-R7-qualification` / `P5 #11=C`).

## Decision sheet

All recommended choices below are PROPOSALS; named owners and preflight/execution permission remain required. Nothing here reopens settled #1/#5/#10.

| decision | recommended | alternative | user input needed |
|---|---|---|---|
| #2 Purpose/authority | A: gap filler; admitted versioned rules, current event, visible exceptions | B narrow lookup; C defer | `P5 #2=A` + catalog/rule owners and policy version |
| #3 Quality/triggers | A: keep applicable point gates + intervals; defer loop | B interval-bound/new sizes; C mechanics only | `P5 #3=A` or explicit row replacements |
| #4 Resources/samples | A: keep applicable synthetic rows; defer loop/P6; #6 owns paid caps | B replace preregistered rows; C defer | `P5 #4=A` + environment owner |
| #6 Models/budget | A: U6 observe; 2,310 HTTP / USD 26 / 8 h incl. mechanics; no loop | B full 8,310 HTTP reserve; C batch; D top-k | `P5 #6=A` + models/clock acknowledgment; execution separate |
| #7 Holdout custody | A: post-freeze isolated sealed run; explicit solo limitation | B independent human custody; C dev diagnostics only | `P5 #7=A` + custodian/adjudicator/private root/deletion owner |
| #8 Tuning bound | A: initial dev + at most one single-factor revision; one holdout | B initial dev only; C defer | `P5 #8=A` + factor predeclaration |
| #9 Stages | A: U6 observe; memory/references observe then separate synthetic shadow | B all observe; C off | `P5 #9=A` + module stage acknowledgment |
| #11 Obligations | A: retain SDK/protections; conservative drop/no replay; durability/placement unverified | B R7 operational proof first; C defer | `P5 #11=A` + restart/durability/placement acknowledgment |
