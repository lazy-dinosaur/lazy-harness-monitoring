# P1 — public API and condition review (issue #1)

## Scope, decision and reproduction

Historical review base: `qualification/p0` at `1d921b2`; P0 boundary correction is `6eae938`, and the original P1 review rebased to `12afe20`. The approved follow-up on `qualification/p1` implements deltas **1, 2, 3, 6, 7, 8, 9, 12** below. Original condition/API/scenario tables and F1–F11 findings are preserved as **historical preimplementation evidence**, including their original line citations and wrong-behavior witnesses; they are not current invariant claims. The Implemented section is authoritative for current behavior and test titles. Deltas 4, 5, 10, 11 remain proposals. Examples and new tests use public package exports; engine export paths include `.ts`. Clean-install/registry packaging remains UNVERIFIED.

**Result:** the four bounded offline scenarios can be composed through public exports. This does NOT qualify actual Pi receipt, semantic accuracy, durable memory, real worker execution or production operation. D1' supersedes the former connector decision: no package here depends on Fabric; core owns an independent worker execution port + reusable fake conformance, and lazy-harness owns EXACT-pinned Fabric implementation and the first bun/Node >=24 probe in issue #1 P7 thin-consumer work, out of repo. D2 remains provisional and unmeasured. Pi declares only `inject-context`.

From the repository root, with the P0-installed dependencies already present:

```sh
bun examples/p1/prepare-local-links.ts
bun test packages/core/test hosts/pi/test/pi-host.test.ts
bunx tsc -p packages/core/tsconfig.json
bunx tsc -p hosts/pi/tsconfig.json
bunx tsc -p examples/p1/tsconfig.json
```

The non-workspace `examples/p1` directory needs three ignored local package-root links. `prepare-local-links.ts` verifies/links the already-present core, Pi and TypeBox packages; it neither installs dependencies nor aliases source entrypoints. TypeScript inherits existing strict/noEmit settings; no existing tsconfig was modified. Initial targeted execution exposed missing example dependency resolution (one import error and compiler diagnostics); adding this explicit offline setup resolved it. There were also two inspection-command mistakes (missing test filename; malformed grep regex), not product failures.

Original P1 review test summary, before the approved implementation (verbatim):

```text
bun test v1.3.14 (0d9b296a)

 223 pass
 0 fail
 1263 expect() calls
Ran 223 tests across 18 files. [654.00ms]
```

Each of the three exact `bunx tsc -p ...` commands above exited 0 with **no output**. Existing P0: 164 tests; added: 38 trigger/config + 12 scenario + 9 API/host = 59 tests. The six pending Pi tests are still excluded. No real model calls: all backends are synchronous scripted return values or a deliberate scripted error. Timings are test-run receipts, not latency benchmarks.

## Evidence abbreviations and status vocabulary

- `S/` = `packages/core/src/sdk/`; `E/` = `packages/core/src/engine/`; `H/` = `packages/core/src/host/`; `P/` = `hosts/pi/src/`.
- `T` = `packages/core/test/p1-trigger-boundaries.test.ts`; `Q` = `packages/core/test/p1-scenarios.test.ts`; `A` = `packages/core/test/p1-api-host.test.ts`. Line numbers refer to these files in this review commit.
- `X/` = `examples/p1/`. A local example import is allowed; all library imports within those examples use public package exports.
- **expressible** = a public API expresses the scoped local behavior, not operational acceptance; **module-owned** = trusted host/module code must implement it; **unsupported** = cannot promise it via the reviewed path; **needs-change** = a demonstrated inconsistency/safety gap. These are different from matrix `verified`, which always names a finite passing assertion.

## Historical condition inventory (before implementation; superseded by Implemented below)

Every row below is reached through root export `MONITORING_TRIGGER_POINTS` / `resolveMonitoringWatch`; `T:9–38,41–51` independently enumerates all **29** points, checks hook mapping, positive payload, wrong hook, raw-hook compatibility and repeated identical predicate calls. `when` is a predicate, NOT payload validation. No predicate means unconditional on the matching raw hook. All points have stateless resolver semantics; exactly-once/event accounting belongs elsewhere.

| Named condition | Raw hook | Current payload predicate | Selection/material consequence and classification |
|---|---|---|---|
| `user.prompt` | `input` | falsy `streamingBehavior`, source not `extension` | expressible; `user-text`; malformed prompt admission needs-change F1 |
| `user.steer` | `input` | `streamingBehavior === 'steer'` | expressible; source exclusion module-owned F2 |
| `user.follow-up` | `input` | `streamingBehavior === 'followUp'` | expressible; source exclusion module-owned F2 |
| `user.extension-input` | `input` | `source === 'extension'` | expressible; overlaps steer/follow-up F2 |
| `user.shell` | `user_bash` | none | expressible predicate; shell body extraction module-owned (`event-meta` is not shell text) |
| `user.message` | `message_end` | `message.role === 'user'` | expressible final role; no body validation F1 |
| `run.start` | `before_agent_start` | none | expressible; needs own admitted material / event-meta / region |
| `run.custom-start` | `before_agent_start` | `messageType === 'custom'` | expressible; overlaps run.start |
| `assistant.stream` | `message_update` | none | expressible speculative `assistant-progress`; no role check F1 |
| `assistant.message` | `message_end` | `message.role === 'assistant'` | expressible final `assistant-text` |
| `extension.message` | `message_end` | `message.role === 'custom'` | expressible predicate; custom body extraction module-owned |
| `tool.before` | `tool_call` | none | expressible tool-meta / explicitly allowed tool-arguments; not synchronous blocking |
| `tool.after` | `tool_result` | none | expressible rich tool-result |
| `tool.end` | `tool_execution_end` | none | expressible terminal predicate; rich tool-result must be correlated |
| `tool.failed` | `tool_execution_end` | `isError === true` | expressible terminal predicate; current event-meta used in D |
| `tool.nested` | `tool_execution_end` | string `parentToolCallId` (even empty) | expressible predicate; module decides whether nested attempts count |
| `turn.start` | `turn_start` | none | expressible; supply event-meta/region when no own body |
| `turn.end` | `turn_end` | none | expressible; between-region/history or event-meta needed |
| `run.end` | `agent_end` | none | expressible predicate; one low-level run, not guaranteed whole-run settle |
| `run.before-settle` | `agent_before_settle` | none | expressible predicate; material still required |
| `run.settled` | `agent_settled` | none | expressible predicate; idle/no-next-context is not delivery |
| `run.aborted` | `agent_settled` | `aborted === true` | needs-change if intended as job trigger: coordinator stops before admission (`E/monitoring-core-realtime.ts:101`) |
| `session.start` | `session_start` | none | unsupported as selection watch; control-event rejection F3 |
| `session.compact` | `session_compact` | none | unsupported as selection watch; generation invalidation F3 |
| `session.tree` | `session_tree` | none | unsupported as selection watch; generation invalidation F3 |
| `model.changed` | `model_select` | none | unsupported as selection watch; generation invalidation F3 |
| `model.thinking-changed` | `thinking_level_select` | none | unsupported as selection watch; generation invalidation F3 |
| `ui.waiting-user` | `ui_prompt_start` | none | expressible predicate; need admitted own material/region |
| `ui.resumed` | `ui_prompt_end` | none | expressible predicate; need admitted own material/region |

The selection consequences not specifically exercised by A/Q are **source-inspection claims**, not new full-pipeline coverage. `H/frames.ts:6–13` defines the core's Pi-shaped hook vocabulary; raw names outside it can resolve but cannot construct selection. A second host must normalize its native hooks and payloads into this vocabulary.

| Other condition/config surface | Exported symbol | Fixture/test | Classification/result |
|---|---|---|---|
| Streaming vs finalized role | `resolveMonitoringWatch` | T:53 | expressible, hook-disjoint, exact role equality; stream is unconditional |
| User vs extension; steer/queued source | same | T:64; Q:23 | module-owned authority filter; extension steer/follow-up overlaps, F2 |
| Malformed null/primitive/object payloads | same | T:75,83 | needs-change F1; exceptions fail closed, weak/unconditional predicates do not |
| Repeated identical input | same | T:45 | module-owned dedup; both calls match, no semantic dedup in resolver |
| Delivery-only `model.before-call` | `MONITORING_DELIVERY_POINTS` | T:41,91; A:112 | unsupported as watch; metadata says `context`, actual Pi hook `context_with_system`, F6 |
| Unknown dotted names | `resolveMonitoringWatch`, `validateMonitoringModuleDeclaration` | T:91,102 | rejected, expressible validation |
| Unknown raw names / raw context | same | T:91,102; A:87 | needs-change F3: resolver/declaration allow, selection rejects |
| OR of raw + named hooks | `resolveMonitoringWatch` | T:91 | expressible but raw bypasses narrower predicates; `conditional` remains true if any predicate exists |
| Literal config subset, duplicate/widen rejection | `effectiveMonitoringWatch` | T:110 | expressible literal subset, not semantic equivalence (`input` cannot replace `user.prompt`) |
| Empty config selection | same | T:110 | needs-change F4: helper accepts `[]`, resolver rejects; data schema requires at least one |
| Job disable/report/risk, stage lowering, job grants | `effectiveMonitoringJobs`, `effectiveMonitoringStage`, `validateMonitoringModuleDeclaration` | T:121 | expressible scoped tightening; no authority widening |
| Declaration uniqueness, named/delivery validation | `validateMonitoringModuleDeclaration` | T:102 | expressible; raw-control admission mismatch F3 |

## Scenario results and exact condition ownership

All examples use `X/support.ts` for scripted profiles, explicit material admission, public binding creation, per-module independent selection, packet freshness check, explicit `onTrigger`, handlers and report callbacks. The processor factory required by `defineMonitoringModule` is separate from the actual v2 job route; no claim it auto-registers jobs. Call `runReferences`, `runRules`, `runMemoryCandidate`, or `runTestLoop` to run the small canned fixture; Q runs those functions. This is source-local trusted composition, not a generic condition DSL.

| Scenario / consumer | Needed condition or window | Classification, result and exact gap | Passing proof |
|---|---|---|---|
| A `X/references.ts` | prompt / steer / follow-up; exclude extension/final copy | expressible points; module-owned exact-source exclusion for steer/follow-up remains necessary (F2). Example watches input points, not final user copy | Q:8,17,23 |
| A | exact catalog relevance, denied kinds, versioned document | module-owned catalog admission; scripted reference choices exclude unrelated doc; denied kind supply throws. Actual semantic relevance UNVERIFIED | Q:8,35 |
| A | optional turn-end between-region window | expressible via declared history/kinds + since-last material options; not enabled/executed by this minimal example; existing region tests, source `E/monitoring-core-realtime-material.ts:179–205` | UNVERIFIED for A-specific temporal semantics |
| A | report ready after last call, carry/stale/session/branch rules | needs-change end-to-end receipt (F6/F9); no live provider input assertion | A:112 only fake-hook return |
| B `X/rules.ts` | finalized tool arguments, assistant final, steer | expressible points; `toolFields.bash=['command']`, read-only output; approved budget lease consumed before scripted worker | Q:43 |
| B | exact rule conflict / provisional stream defer | module-owned judgement and independent labels; stream not watched, stub choices are not a semantic oracle | Q:55 scripted failure only; semantic correctness UNVERIFIED |
| B | synchronous prevention of tool execution | unsupported: asynchronous advice cannot retroactively block; Pi declares neither block nor steer; D1' real worker implementation belongs to lazy-harness P7 | A:55,70 support diagnostic/admission gap |
| B | optional standard projection of tool-arguments/tool-meta | needs-change F11; plain admitted-material selection works, standard actor switch rejects those current sources | Q:43 bypasses optional projection, no approval claim |
| C `X/memory-candidate.ts` | finalized user/assistant, default observe | expressible; default declaration maxStage observe, zero jobs/output/report | Q:60 |
| C | same-subject dedup, private preparation only | module-owned deterministic subject key; separately opted-in synthetic shadow declaration maxStage shadow, read-only `prepared`, report never; no knowledge-write API invoked | Q:67 |
| C | turn-end region, steer reset, prior candidate catalog | module-owned bounded subject/revision ledger and source supply; not implemented in this minimal fixed-subject example | UNVERIFIED for C's full region/reset/catalog scenario |
| C | authenticated approval, contested evidence, restart persistence | unsupported by window-derived provenance alone F11; not required to prepare a clearly unapproved private candidate. No durable writes or restart guarantee | source review, not a new passing approval fixture |
| D `X/test-loop.ts` | command + terminal failure joined by exact toolCallId | module-owned bounded reducer, exact command string; terminal failure alone lacks rich output, so prior tool-result is admitted | Q:78 |
| D | two distinct failures, duplicate/progress/nested exclusion | module-owned threshold of two is a fixture definition, not D2 acceptance or a DSL; bound eight tracked calls; one report per incident via module-ledger | Q:85,99 |
| D | success / new intent / meaningful change / different command | module-owned; success/input reset, exact command inequality, explicit `reset()` models a host-reported source change. No inference of meaningful edits. Different command does not create a semantic equivalence oracle | Q:99 |
| D | turn-end judgement after final pairs / safe standard provenance | needs-change optional provenance F11; example instead triggers at the second failed end with current event-meta. Turn-end variant UNVERIFIED | Q:78; source projection inspection |

The examples deliberately do not implement every positive/negative/fault proposal in scenarios.md. These missing cases are not passes. They expose the needed boundaries without source changes, real opencode, real worker execution, approval attribution or automatic effects.

## Public API coverage (package-export reachability)

Root means `@lazy-harness/monitoring-core`; host means its `/host` export; engine means its exported `/engine/<file>.ts`. Pi means `@lazy-harness/monitoring-host-pi`. Runtime/public imports are typechecked both transitively from core tests and by the strict example tsconfig.

| API surface | Exported symbol / entry | Fixture/test | Classification / result |
|---|---|---|---|
| Module declaration/registration/settings | root `defineMonitoringModule`, `validateMonitoringModuleDeclaration` | X/support.ts; T:102,121; A:55 | expressible; awkward Processor/v2 split F5 |
| Configured processor engine | root `createConfiguredMonitoringCore`; engine `MonitoringCore` | X/api-consumer.ts:23; A:55 | expressible stopped register/start/stop/dispose; NOT v2 startup |
| Host frames/provenance supply | host `MonitoringHostAdapter`, `ObservationFrame`, `validateHostCapabilities`, `frameSequenceIssues`; engine `RealtimeMaterialWindow.setReference` | A:15,33; Q:8,35 | expressible normalized frame + admitted reference; provenance is not authentication F10/F11 |
| Module and job grants | root `Grants`, declaration validation; engine watch bridge/runtime | T:121; Q:35,43 | expressible declared subset; actual handler is trusted code, not a sandbox or action dispatcher |
| Judge/model binding, budget | root model router/backend, engine approved budget gate | X/support.ts; Q:43,55 | stub/profile routing and worker lease; D1' real implementation is lazy-harness P7, out of repo |
| Handler registration and missing-handler errors | engine `MonitoringModuleRuntime`, `JobHandler`, `effectiveMonitoringJobs` from root | A:96; Q:43 | expressible explicit handler map; no automatic job form executors |
| Selected packet → runtime | engine `takeReady('module')`, `RealtimeSelectionPacket`, `MonitoringModuleRuntime.onTrigger` | X/support.ts:135–147; Q positive cases | module-owned handoff/freshness/subject mapping; F5 |
| Report callback vs receipt | engine `Report`, runtime `report`; Pi `createParentReportDelivery`; engine `ContextCarryMailbox` | A:112,126 | needs-change F6/F9; callbacks/fake hooks are not actual model receipt |
| Start/stop/dispose | root `MonitoringCorePort`; engine pipelines `accept/halt/dispose/idle` | A:33,55 | expressible for processor core/pipeline; runtime lifecycle unsupported F7 |
| Runtime timeout/caller abort | engine `RuntimeOptions.jobTimeoutMs`, `onTrigger` signal | A:152 | needs-change F7; cooperative abort, no hard cancellation or runtime drain API |
| Errors | root `MonitoringConfigurationError`, `MonitoringModelError`; runtime errors/outcomes | T:102,121; A:96,126; Q:55 | expressible imports/config errors; runtime plain errors, callback exception escape and uncertain outcome are inconsistent F9 |
| Status and trace inspection | engine selection/coordinator `getStatus/traces`, runtime `outcomes/trace`; root model router `getStatus` | A:33,96; X/support.ts | expressible local status/trace callbacks; runtime aggregate state/active work unsupported; no new file sink test |
| Pi observer/attach/report exports | Pi `PiMonitoringObserver`, `createPiObservationExtension`, `attachPiFrames`, `piHostCapabilities`, `createParentReportDelivery` | X/api-consumer.ts:10–20; A:96,112; existing pi-host test | expressible exports/fake hooks; real SDK behavior UNVERIFIED |
| Startup capability enforcement | host `hostSupportIssues` | A:55,70 | needs-change F5; not called by startup |

### Second-host compatibility and enforcement evidence

`A:15–53` implements a synthetic second adapter with native `opened`/`request` events normalized to `session_start`/`input`, `snapshot: 'none'` (empty available snapshots), monotonic cursor, detach, halt and dispose. It produces one real selection packet with a scripted classifier and no Pi `sessionManager`. This verifies frame-boundary portability only, **not real opencode compatibility** or full-provider-context capture. No SDK contract was invented.

`S/contracts.generated.ts:44–48` still exports `ObservationContext.sessionManager` with `getSessionId/getLeafId/getBranch/buildSessionProjection`, plus `getSystemPrompt`. `X/api-consumer.ts:17–19` typechecks that this property is required and that dedicated host frames remain structurally compatible with generated frames. The legacy generated context is not needed by the frame pipeline; a non-Pi host using that observer input must emulate Pi shape or use the frame adapter instead. Generated provenance comments (`:1–4`) still point at a generator/source layout outside this repository. Do not hand-edit generated output or claim regeneration works here.

Executed source scan:

```sh
rg -n 'hostSupportIssues' packages/core/src hosts/pi/src
```

Only result: `packages/core/src/host/contract.ts:32:export function hostSupportIssues(...)`. No startup/composition caller exists in those source trees. A:55 diagnoses missing `tool_call` and `block-tool-call`, then constructs/registers/starts configured core successfully. A:70 validates a matching v2 declaration/grants/hash with unsupported block requirement and constructs runtime plus selection and attaches the unsupported second host; no classifier calls occur for its irrelevant input. These are **negative safety findings**, not enforcement passes. The utilities do not infer action requirements from arbitrary trusted code. README's previous refusal wording was stronger than implementation; the index now links this limitation.

## Historical findings (preimplementation behavior, not current guarantees)

1. **F1 — malformed payloads can trigger.** `S/trigger-points.ts:13,17–40,67`: optional-chain prompt condition admits null/primitive/empty values; unconditional points ignore payload shape; role-only finals admit missing bodies; exception catch only catches thrown predicates. T:75/83 records current behavior, not the desired “must never trigger” invariant. A valid matching hook is assumed; full malformed frame handling is a different P2 layer.
2. **F2 — overlapping source authority.** `S/trigger-points.ts:14–16`: extension-origin steer/followUp matches both user and extension-input; missing source can match user.prompt. T:64 records this. A's ordinary extension input is excluded but extension-origin steer is not inherently excluded. No security meaning should be inferred from the `user.*` name alone.
3. **F3 — trigger catalog is not a selection support catalog.** `S/declaration.ts:64–69`, `S/trigger-points.ts:57–61` permit raw context/unknown hooks; `E/monitoring-core-realtime-selection.ts:23,85` rejects control/unknown events. Five named control points are also rejected. `E/monitoring-core-realtime.ts:101–115` aborts/invalidates before judging run.aborted/generation/context frames. A:87 demonstrates construction rejection, not every lifecycle path.
4. **F4 — empty subset inconsistency.** `S/declaration.ts:96–102` accepts `[]`; `S/schema.ts:32` requires nonempty data selection; `S/trigger-points.ts:54` rejects it. `watchModuleFromDeclaration` directly resolves the chosen list (`E/monitoring-engine-runtime.ts:128`). T:110 shows public-helper mismatch.
5. **F5 — capability check/composition gap.** `H/contract.ts:1–4,32–39` promises refusal but is just a utility. `S/core.ts:16–20` registers processor specs/grants only; effective jobs/watch/stage metadata from `S/bindings.ts:53–64` is not composed into v2 runtime. Runtime constructor `E/monitoring-engine-runtime.ts:62–69` checks duplicate modules/handlers, not host requirements. A:55/70 passes while documenting unwanted admission. No runtime sandbox enforces arbitrary handler side effects.
6. **F6 — delivery naming and duplicate callback identity.** `S/trigger-points.ts:46` says `context`; `P/report-delivery.ts:25` installs `context_with_system`. `P/report-delivery.ts:20` appends incrementing seq to identical report IDs; A:112 observes two injected fake-hook messages for duplicate callbacks. No actual SDK receipt tested.
7. **F7 — runtime lifecycle/resource gap (review baseline).** Each trigger loops jobs serially without runtime-wide cap/queue/stop/dispose/drain. Timeout only signals abort while awaiting raw work. A:152 records the baseline. Under D1', hard termination belongs to the worker port implementation (lazy-harness P7 for Fabric), never to AbortSignal or a core promise.
8. **F8 — unbounded retained collections.** `E/monitoring-core-context-mailbox.ts:17–18,24,30` never prunes seen/log; maxItems limits only pending items. `E/monitoring-engine-runtime.ts:54,61,70` retains all idempotency keys/outcomes; budget approvals map (`:24–27`) has no scope removal. `P/report-delivery.ts:12,31,35` retains delivered history indefinitely. A:141 is a finite witness (8 deliveries/16 traces despite pending maxItems 4), not a memory benchmark or infinite-run proof. Not all engine collections are unbounded: selection/coordinator have explicit request/event/trace budgets; do not generalize this finding to them.
9. **F9 — report errors/receipt semantics.** `E/monitoring-engine-runtime.ts:113–120`: optional callback absence still sets reported true; callback throw escapes after idempotency state becomes prepared and before outcome recording. A:126 proves absent callback, escaped exception, empty outcomes and duplicate:prepared retry. Job success, mailbox enqueue, fake-hook mutation and actual model receipt are four different stages.
10. **F10 — generated contracts still Pi-shaped.** `S/contracts.generated.ts:44–48` and `H/frames.ts:1–13`: frame-only consumers work, legacy observer input is not host-neutral; vocabulary/branch/canonical-stage names require normalization. The generation pipeline itself is UNVERIFIED.
11. **F11 — optional provenance coverage/attestation gap.** `E/monitoring-core-source-projection.ts:76–92,147–155` only assigns current actors to user/assistant/tool text/progress, not tool-arguments/tool-meta/event-meta/history; host-record is explicitly not attestation and user approval remains originVerified false/association unresolved. `E/monitoring-core-realtime-material.ts:243–250` admits host reference content without observation-path redaction (`:120–123`). B/D use plain selection with explicit admitted tool fields, not fabricated approval. Approval authenticity and full host-content redaction remain UNVERIFIED; do not loosen approval guards.

## Delta design ledger — approved subset implemented below; other deltas remain PROPOSED

The original minimal designs are retained for review. The user approved implementation of 1/2/3/6/7/8/9/12; those are now implemented as scoped below. 4/5/10/11 remain PROPOSED and were not implemented. Blocking labels are gate/contract decisions, not proof of operational acceptance.

1. **Payload validation and source separation — blocks P2/P3 safety qualification.** Problem: F1/F2. Smallest change: add per-hook plain payload shape guards before named predicates (including required source/body/status fields), make user steer/follow-up explicitly exclude extension source; decide treatment of legacy missing-source callers. Keep raw-hook compatibility explicitly documented as trusted or validate raw payloads at host admission. Files: `S/trigger-points.ts`, host normalization and new tests. Impact: malformed/ambiguous events stop matching; raw compatibility may require versioned opt-in. Proof: current T malformed/overlap findings change to false, valid hook cases still pass; cover inherited/accessor/missing fields. Risk: old SDK events without source/final-body fields need actual pinned-SDK evidence before tightening.
2. **Fail-closed startup support — blocks P2/P3.** Problem: F5 unsupported requirements silently admitted. Smallest change: require `capabilities: HostCapabilities` on safe configured-host composition; run `validateHostCapabilities` and `hostSupportIssues` in `prepareMonitoringBindings` before factories/core start/host attach, using effective watch names and explicit job action requirements (exclude engine-owned selected-material bridge action). Throw structured `MonitoringConfigurationError` code proposed `HOST_UNSUPPORTED`, containing bounded module/kind/name issues, admit nothing on any unsupported requirement. The safe v2 composition in delta 5 must use the same check before construction. Files: `S/{bindings,core,diagnostics}.ts`, `H/contract.ts`, composition tests/Pi caller. Impact: mandatory host capability port is a breaking safe-start boundary; low-level constructors remain trusted mechanics, clearly not qualified startup. Proof: A:55/70 become explicit refusal before factories, handlers, hooks or model calls, plus supported Pi inject-context positive. Risk: arbitrary string job grants are not all host actions; reject unknown external actions or require an explicit core-internal/host action mapping, never silently drop them.
3. **Separate watchable vs lifecycle/delivery vocabulary — blocks P2 contract closure; P3 if it advertises these watches.** Problem: F3. Smallest change: expose watch-support classification and reject nonwatchable selections at safe startup with exact diagnostics, preserving lifecycle frames for invalidation/observation only. Do not make control hooks asynchronously execute jobs as an incidental fix. Files: `S/{trigger-points,declaration}.ts`, selection admission, docs. Impact: previously accepted-but-unusable declarations fail earlier; a future lifecycle-job design is separately approved. Proof: every named/raw row has an explicit admission/rejection test including aborted runs. Risk: semantic changes if consumers relied on names as observational markers rather than runnable watches.
4. **Unify empty-watch behavior — nonblocking with nonempty configuration.** Problem: F4. Smallest change: reject empty selected watch in `effectiveMonitoringWatch`, matching current schema; use stage off to disable. Files: `S/declaration.ts`, new boundary tests/docs. Impact: direct-helper callers using [] must use off instead. Proof: helper/schema/resolver all reject [] consistently and off yields no work. Risk: choosing [] as disable instead would require coordinated schema/pipeline changes; do not silently choose both semantics.
5. **Explicit v2 composition helper — P3 integration prerequisite; not a blocker for manually composed P2 fixtures.** Problem: F5's two paths. Smallest change: opt-in safe builder reusing selection/runtime with host grants/capabilities/models/handlers/report sink, packet mapping and cleanup, sharing delta 2 checks. Files: new composition/root export, Pi caller, fixtures. Compatibility: additive; legacy remains processor-only. Proof: four examples omit duplicated scaffolding with refusal/cleanup before start. Risk: cannot manufacture grants/budgets/provenance/workers; D1' implementation remains lazy-harness P7, out of repo. This delta remains a proposal, not part of this implementation batch.
6. **Authoritative delivery name and stable report identity — blocks P3 receipt qualification.** Problem: F6. Smallest change: align `model.before-call` metadata to actual `context_with_system`; use stable module/job/event/dependency/scope identity instead of seq, and reject duplicate callbacks within the bounded delivery scope. Files: `S/trigger-points.ts`, `P/report-delivery.ts`, mailbox tests/new Pi fixtures. Impact: metadata hook changes for consumers; duplicate report callbacks cease being independent messages. Proof: A:112 becomes one fake-hook message, then real pinned-SDK next-input test proves exactly one receipt/stale carry rejection. Risk: legitimate multiple revisions for one event need explicit revision identity; do not collapse distinct results.
7. **Runtime-wide lifecycle/concurrency and raw accounting — blocks P2/P3.** Problem: F7. Smallest change: finite maxActive/maxQueued, start/stop/dispose/idle/status, controller tracking, refusal after stop; retain raw noncooperative slots/reservations until settled while logical timeout is terminal/uncertain and late output ignored. Core cannot hard-kill promises; D1' worker port implementation owns termination. Files: `E/monitoring-engine-runtime.ts`, runtime fixtures; real Fabric implementation is lazy-harness P7, out of repo. Compatibility: finite defaults and explicit restart policy. Proof: concurrent triggers, bounded queue/raw capacity, stop/dispose, cooperative/noncooperative work and no late reports. Risk: releasing slots on logical timeout or retrying uncertain effects is unsafe.
8. **Bound retention without reopening idempotency — blocks P2 long-run/P3 active use.** Problem: F8. Smallest change: bound outcome/trace/delivered diagnostic rings with eviction counters; make idempotency/seen retention scope-owned and capacity fail-closed, clear only at an explicit closed scope or use host-supplied durable store; add budget-scope revoke/close. Files: runtime, context mailbox, Pi delivery, new bounded-retention tests. Impact: complete diagnostic history moves to an explicit sink; callers cannot assume infinite delivered arrays. Proof: finite soak exceeds capacities with stable retained counts, duplicate/uncertain keys never execute again in a live scope, overflow refuses safely. Risk: TTL/LRU eviction of live uncertain keys re-enables effects; never propose that as an innocent memory optimization.
9. **Report enqueue/receipt/error contract — blocks P2/P3 receipt claims.** Problem: F9. Smallest change: replace optional void success inference with explicit sink enqueue accepted/rejected/unknown receipt; absent sink is not reported; contain sink exceptions and record a report-failed/unknown outcome without rerunning the already-prepared job. Host delivery reports actual next-input receipt separately, with stable ID from delta 6. Files: runtime Report/JobOutcome/RuntimeOptions, Pi delivery callback, fixtures. Impact: report callback type migration; preserve job idempotency independently from delivery retry policy. Proof: A:126 absent/throwing/duplicate cases, stale scope, rejected enqueue and actual SDK receipt. Risk: auto-retrying an uncertain receiver can duplicate injection; retry requires an idempotent sink receipt protocol.
10. **Separate legacy Pi observer types from frame contract — nonblocking for P2/P3 frame-only composition.** Problem: F10. Smallest change: designate `ObservationContext` as legacy Pi-shaped observer input, re-export from Pi with deprecation guidance; make host frames the authoritative neutral type and restore a local generator source-of-truth before regeneration. Files: generated-contract source/generator (location must first be decided), core/Pi exports/docs. Impact: preserve old type alias for compatibility; no claim that renaming sessionManager alone makes Pi observer portable. Proof: A second-host frame consumer compiles without Pi context; old Pi consumers continue compiling; deterministic regeneration check. Risk: duplicate generated/frame definitions drift or break external structural consumers.
11. **Tool-source metadata and authenticated authority port — nonblocking for read-only P2/P3 advice; blocks authenticated-approval/persistence claims.** Problem: F11. Smallest change: non-authoritative tool-arguments/meta/event-meta actor adapter with exact IDs plus authenticated versioned approval association and consent port; host-reference redaction policy. Files: projection contracts/tests, host material docs. Compatibility: additive, unresolved approval stays fail-closed. Proof: optional B/D projection with exact identity, forged approval refused and source revision invalidation. Risk: broad allowlists or inferred provenance weaken safety. Remains a proposal.

12. **Module-owned worker execution port + fake-backed conformance — blocks P3. IMPLEMENTED below (original proposal retained).** Problem: D1' requires a host-independent worker boundary instead of an in-repo Fabric connector. Smallest change: export `WorkerExecutionPort`, a handler adapter/fake in-memory implementation and a reusable `runWorkerPortConformance(makePort)` suite; dispatch existing runtime handlers only through the port. Files: new core worker contract/implementation/conformance, root exports, runtime and tests. Compatibility: existing handlers work through the adapter; no Fabric dependency, import or mirrored API; lazy-harness P7 owns EXACT-pinned Fabric implementation and bun/Node >=24 check. Proving test: fake-backed timeout/cancel/global concurrency/lifetime/terminal/uncertain/no-double-completion plus existing runtime tests. Risk: logical terminal does not prove physical termination; raw work remains accounted until implementation receipt/settlement.

## Implemented

All eight approved deltas are committed separately. `S/`, `E/`, `H/`, `P/` retain the path aliases above; test paths in this table are under `packages/core/test/`. This is finite offline mechanical evidence, not P2/P3/P5 acceptance.

| Delta | Commit | Implementation files | Proving tests added/flipped |
|---|---|---|---|
| 1 | `a23df16` | `S/trigger-points.ts`; example `memory-candidate.ts` | `p1-trigger-boundaries.test.ts`: malformed named payloads false, explicit user source, extension/source isolation, no getter invocation, valid positive bodies; `monitoring-trigger-points.test.ts`: valid payload fixtures; `p1-scenarios.test.ts`: explicit source on shadow user-final fixture |
| 2 | `ef54c86` | `S/bindings.ts`, `S/diagnostics.ts`, `H/contract.ts`; example `api-consumer.ts` | `p1-api-host.test.ts`: unsupported configured/v2 preflight refuses; new `p1-startup.test.ts`: supported Pi inject-context, zero factories/engines on any unsupported module, unknown action rejection, explicit local mapping, missing/invalid capability rejection |
| 3 | `d0b3aa4` | `S/trigger-points.ts`, `S/declaration.ts`, `S/bindings.ts`, `E/monitoring-engine-runtime.ts`, `E/monitoring-core-realtime-selection.ts` | `p1-trigger-boundaries.test.ts`: every named/raw catalog row explicitly admitted/rejected, including run.aborted; `p1-api-host.test.ts`: low-level selection refusal retained |
| 6 | `9129f10` | `S/trigger-points.ts`, `P/report-delivery.ts` | `p1-api-host.test.ts`: metadata equals context_with_system, duplicate callbacks produce one fake-hook message; new `p1-delivery-identity.test.ts`: repeated/later hooks, content revisions, dependency ordering/staleness, repeated registration |
| 7 | `dae011e` | `E/monitoring-engine-runtime.ts`, new `E/runtime-work-queue.ts` | `p1-api-host.test.ts`: timeout settles logically before raw release; new `p1-runtime-lifecycle.test.ts`: global concurrency/queue refusal, raw budget reservation after timeout, no late report, stop/dispose/restart, caller cancellation, lifetime cap |
| 8 | `134ee05` | `E/monitoring-engine-runtime.ts`, `E/monitoring-core-context-mailbox.ts`, `P/report-delivery.ts`; example `api-consumer.ts` | `p1-api-host.test.ts`: diagnostic bounds/counters instead of unbounded witness; new `p1-retention.test.ts`: 100 distinct keys with ring eviction, uncertain/prepared duplicate protection, capacity refusal, bounded seen/delivered diagnostics, reservation-safe budget revoke |
| 9 | `6403618` | `E/monitoring-engine-runtime.ts`, `E/monitoring-core-context-mailbox.ts`, `P/report-delivery.ts`; example `support.ts` | `p1-api-host.test.ts`: absent/throwing sink yields failed/unknown receipt and duplicate:prepared; new `p1-report-receipts.test.ts`: absent/failed/unknown/mismatched/void/throwing/accepted receivers, no handler rerun, separate Pi enqueue/hook-delivery receipts and stale/scope cases |
| 12 | `c800fbe` | new `S/worker-execution.ts`, `S/worker-execution-memory.ts`, `S/worker-execution-conformance.ts`; `S/index.ts`, `E/runtime-work-queue.ts`, `E/monitoring-engine-runtime.ts` | new `worker-execution-port.test.ts`: public-entry conformance against in-memory port, deliberately broken fake rejected, supplied port dispatch bypasses local handler, ceiling refusal, foreign/forged tickets; all earlier runtime tests now exercise the handler-to-port adapter |

### Verification receipts

For each delta commit the exact scoped command `bun test packages/core/test hosts/pi/test/pi-host.test.ts` passed, followed by both `bunx tsc -p packages/core/tsconfig.json` and `bunx tsc -p hosts/pi/tsconfig.json` exiting 0 with no output. Last passing counts at those commits:

| Delta | pass / fail | expect calls | files |
|---|---|---|---|
| 1 | 223 / 0 | 1295 | 18 |
| 2 | 227 / 0 | 1305 | 19 |
| 3 | 228 / 0 | 1403 | 19 |
| 6 | 231 / 0 | 1418 | 20 |
| 7 | 235 / 0 | 1444 | 21 |
| 8 | 238 / 0 | 1468 | 22 |
| 9 | 240 / 0 | 1504 | 23 |
| 12 | 244 / 0 | 1515 | 24 |

Final exact test summary, verbatim (passing case lines omitted):

```text
bun test v1.3.14 (0d9b296a)

 244 pass
 0 fail
 1515 expect() calls
Ran 244 tests across 24 files. [1.53s]
```

Final `bunx tsc -p packages/core/tsconfig.json`, `bunx tsc -p hosts/pi/tsconfig.json`, and `bunx tsc -p examples/p1/tsconfig.json`: **each exited 0 with no output**. The examples continue to import library APIs only through public exports. A direct public-entry Bun probe (from `packages/core`) ran `runWorkerPortConformance(createInMemoryWorkerPort)` and returned:

```json
{"conformanceChecks":24,"handlerAdapter":"function","watch":{"prompt":"watchable","aborted":"control-only","delivery":"delivery-only","unknown":"unknown"}}
```

Failures during implementation were inspected and corrected before committing: missing-source positive scenario fixtures after delta 1; delta 2 string-Set typing and unavailable direct Pi alias in a core test (changed to existing public-export probe); delta 7 generic error conversion losing the typed budget-overrun reason (preserved without changing the assertion); delta 9 test expected-status typing. Passing counts above are not claims that no intermediate failures occurred.

### Changes to pre-existing tests (relative to the original P1 review)

- `monitoring-trigger-points.test.ts`: add required source/text/tool identity to valid payloads and explicit host capabilities/internal action mapping. Assertions otherwise unchanged.
- `monitoring-declaration.test.ts`: explicit legacy `hostRequirements`, host capabilities and module-local action mapping in the setup helper; no behavioral assertion changed.
- `monitoring-trace-stage.test.ts`: explicit host capabilities/local action mapping and receipt-returning report sink; no behavioral assertion changed.
- `monitoring-engine-runtime.test.ts`: receipt-returning sink plus helper import only; all existing assertions preserved, including budget-overrun reason.
- Original P1 fixtures were intentionally flipped: `p1-trigger-boundaries.test.ts` no longer accepts malformed/ambiguous named payloads or unusable declarations, and `extension.input` replaces `user.extension-input`; `p1-api-host.test.ts` replaces unsafe CURRENT witnesses with the corrected startup/delivery/timeout/retention/receipt assertions; `p1-scenarios.test.ts` adds explicit source to its valid shadow user-final fixture. No scenario assertion was weakened.
- No pending Pi test was restored, run or retired. No generated contract was edited.

### Current compatibility and limits

Added root exports: `MonitoringWatchSupport`, `monitoringWatchSupport`, `assertMonitoringWatchable`; `WorkerExecutionLimits`, `WorkerCompletion`, `WorkerTicket`, `WorkerExecutionStatus`, `WorkerExecutionPort`, `WorkerOperation`, `WorkerPortFactory`, `createInMemoryWorkerPort`, `runWorkerPortConformance`, `createHandlerWorkerPort`, `WorkerJobRequest`. The port names/shapes are module-owned, not Fabric aliases. The engine wildcard also makes the new `RuntimeWorkQueue`, `WorkLimits`, `WorkResult` mechanics reachable; consumers should use the root worker port contract. No top-level export was removed; the removed named trigger key changes the `MonitoringTriggerPoint` union. Host `hostSupportIssues` accepts arbitrary string action requirements so unknown actions can be diagnosed; `validateHostCapabilities` rejects unknown advertised actions. Additional changed contracts are `CarryItem.reportId`, `CarryOptions.maxTrace/maxSeen`, `CarryTrace`'s `seen_capacity` reason, mailbox/delivery status getters, `ParentReportDeliveryOptions.maxDelivered`, the bounded idempotency/budget constructors, and budget `revoke/getStatus`.

Changed public contracts: `MonitoringHostBindings.capabilities` is mandatory; legacy bindings need explicit `hostRequirements` at configured startup. `internalActions` is an explicit trusted mapping for module-local actions, not an override for reserved host actions. `HOST_UNSUPPORTED` is a new diagnostic code. Unknown external actions fail closed. The full safe v2 builder (delta 5) is still absent; low-level runtime/attach remain trusted composition mechanics, and must not be presented as independently enforced startup.

`user.extension-input` is removed and replaced with `extension.input` (no accepting legacy alias), so no extension input matches `user.*`. Named hooks require plain own-data shape guards and explicit user authority; `user.message` also needs explicit user source. Raw predicates retain trusted compatibility and are not validators. `resolveMonitoringWatch` can still inspect observational predicates, but declaration, binding/runtime/watch mapping and selection admission reject unjudgeable watches (run.aborted included). Empty-subset inconsistency (delta 4) remains unchanged.

Runtime adds optional `workerPort`, lifecycle and status, `maxActive`/`maxQueued`/`maxWork`/`maxOutcomes`; outcomes are readonly snapshots. Defaults: active 4, queue 64, lifetime admissions 1024, timeout 30000ms, outcomes 256. Injected limits cannot exceed explicitly requested ceilings; runtime owns the supplied port lifecycle. Restart requires raw idle and never resets lifetime counts. Timeout/cancel is logically terminal/uncertain, never permission to release a raw slot early, retry an uncertain effect or accept a late report. The port implementation owns hard termination; the in-memory adapter cannot hard-kill promises. A contract-violating port with unknown raw state retains budget reservations.

Memory protection is separate from diagnostic retention: idempotency keys default max 4096, mailbox seen keys default max 4096, both instance-lifetime with **no automatic expiry or eviction**. Capacity fails closed. Replace only after an explicitly closed/reconciled effect/session scope; discarding live stores is unsafe. Diagnostics default 256 each (runtime outcomes, mailbox trace, Pi delivered), with eviction counters. Budget windows default max 1024; explicit `revoke` prevents further reservations and retains live reservations until physical settlement. These finite exercises do not measure RSS/GC or qualify long-run resource performance.

Engine export adds `ReportEnqueueReceipt`, `ReportDeliveryReceipt`, `monitoringReportId`; `JobOutcome.reportReceipt` and a synchronous receipt-returning `RuntimeOptions.report` replace void inference. `reported: true` means a matching receiver accepted enqueue, NOT actual model-input delivery. Missing/throwing/void/mismatched receivers cannot set it. Prepared-job idempotency is independent of delivery: receiver failure does not rerun a handler. Pi adds `enqueue` and separate `deliveryReceipts`; boolean `onReport` remains compatible. Its delivered receipt is for the `context_with_system` hook result only, not a pinned-SDK provider receipt. Stable content/scope/dependency IDs dedupe repeated reports; content/revision changes remain distinct.

### Current scope audit

Executed tracked manifest/lock and core/Pi source scans for the Fabric package name: **0 matches**. The direct public-entry probe above confirms the new root exports and 24 conformance checks. `git diff --name-only 12afe20` restricted to manifests/locks/tsconfigs returned no paths; the approved implementation changed none of them. `git diff --check` passed. A finite pattern scan over changed files from the P0 baseline (including working-tree documentation) found **0 matches** for private home/user paths, email addresses, common provider/cloud/private-key tokens, bearer tokens and JWT-shaped literals; this is not a universal secret detector. The required recursive connector-path grep returns only the qualification index sentence explicitly marking the old plan superseded. No push, GitHub operation, dependency install/upgrade, or protected backup edit was performed.

### Historical scope and privacy audits (original P1 review only)

`git diff --check` passed. Tracked baseline comparison under `packages/core/src`, `hosts/pi/src` and existing test paths was empty; additions are new P1 test files only. Every changed/new file was scanned for private absolute home paths, the prohibited local username, email addresses, common provider/cloud/private-key token shapes, credential assignments, bearer tokens and JWT-shaped literals: **0 matches**. This is a finite pattern scan, not a universal secret-detector guarantee. Import audit found no library deep-source imports; only package exports and local fixture/example sharing. No manifest/lockfile or existing tsconfig changed.

## Remaining UNVERIFIED / gate handoff

- Real Pi SDK version/hook behavior, actual next provider-input receipt, registration repetition/cleanup in an SDK host, and all six pending migration tests remain P3.
- D1': core port/handler adapter and 24-check fake conformance are implemented here; EXACT-pinned Fabric implementation and first bun/Node >=24 probe remain lazy-harness P7 thin-consumer work, out of repo. No real Fabric execution is qualified.
- Complete P2 fault matrix, real host/worker contention, physical termination, durable/restart semantics, RSS/GC/long-run latency/cost and operational kill switch remain UNVERIFIED. Finite in-memory bounds and logical timeout are verified only in the named tests. Actual Pi payload normalization under the stricter named guards needs a pinned SDK fixture; missing source never implies user authority.
- Semantic relevance/rule correctness/memory quality/test-failure equivalence, independent labels, thresholds and all D2/P5 metrics remain UNVERIFIED. No live session/data collection/paid inference/automatic writes were used or authorized.
- Scenario-specific optional turn-end/region, revision-changing in-flight judgement, next-prompt carry and authenticated approval cases not explicitly cited as passing remain UNVERIFIED. Synthetic host portability is not real opencode support.
- No push, GitHub write, dependency install/upgrade or modification of `backup/pre-publish`. Source/tests changed only as listed in the implementation ledger; manifests, lockfile and existing tsconfigs were not changed by the approved follow-up.
