# P1 — public API and condition review (issue #1)

## Scope, decision and reproduction

Review base: `qualification/p0` at `1d921b2`; local review branch: `qualification/p1`. This is a **review**, not permission to implement the deltas below. Existing source and tests are unchanged. New examples/tests import core, host and engine symbols through package export maps, never relative `src` paths. Engine paths include `.ts` because the current `./engine/*` export maps literally to `./src/engine/*` (`packages/core/package.json:9–12`). Clean-install/registry packaging remains UNVERIFIED.

**Result:** the four bounded offline scenarios can be composed through public exports. This does NOT qualify startup safety, complete lifecycle semantics, actual Pi receipt, semantic accuracy, durable memory, real worker execution or production operation. Required blockers are recorded rather than silently fixed. D1 stands: exact-pinned future `hosts/pi-fabric`, core Fabric-free, implementation P3. D2 remains provisional and unmeasured. Pi declares only `inject-context`.

From the repository root, with the P0-installed dependencies already present:

```sh
bun examples/p1/prepare-local-links.ts
bun test packages/core/test hosts/pi/test/pi-host.test.ts
bunx tsc -p packages/core/tsconfig.json
bunx tsc -p hosts/pi/tsconfig.json
bunx tsc -p examples/p1/tsconfig.json
```

The non-workspace `examples/p1` directory needs three ignored local package-root links. `prepare-local-links.ts` verifies/links the already-present core, Pi and TypeBox packages; it neither installs dependencies nor aliases source entrypoints. TypeScript inherits existing strict/noEmit settings; no existing tsconfig was modified. Initial targeted execution exposed missing example dependency resolution (one import error and compiler diagnostics); adding this explicit offline setup resolved it. There were also two inspection-command mistakes (missing test filename; malformed grep regex), not product failures.

Final scoped test summary, verbatim (passing case lines omitted here):

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

## Complete condition inventory

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
| B | synchronous prevention of tool execution | unsupported: background advice cannot retroactively block; Pi does not declare block/steer; D1 real worker implementation is P3 | A:55,70 support diagnostic/admission gap |
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
| Judge/model binding, budget | root `createMonitoringModelRouter`, `MonitoringModelBackend`, model config; engine `ApprovedBudgetGate` | X/support.ts:23–58,98–113; Q:43,55 | expressible stubs/profile routing + worker lease; real D1 connector unsupported until P3 |
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

## Findings (current behavior, not fixes)

1. **F1 — malformed payloads can trigger.** `S/trigger-points.ts:13,17–40,67`: optional-chain prompt condition admits null/primitive/empty values; unconditional points ignore payload shape; role-only finals admit missing bodies; exception catch only catches thrown predicates. T:75/83 records current behavior, not the desired “must never trigger” invariant. A valid matching hook is assumed; full malformed frame handling is a different P2 layer.
2. **F2 — overlapping source authority.** `S/trigger-points.ts:14–16`: extension-origin steer/followUp matches both user and extension-input; missing source can match user.prompt. T:64 records this. A's ordinary extension input is excluded but extension-origin steer is not inherently excluded. No security meaning should be inferred from the `user.*` name alone.
3. **F3 — trigger catalog is not a selection support catalog.** `S/declaration.ts:64–69`, `S/trigger-points.ts:57–61` permit raw context/unknown hooks; `E/monitoring-core-realtime-selection.ts:23,85` rejects control/unknown events. Five named control points are also rejected. `E/monitoring-core-realtime.ts:101–115` aborts/invalidates before judging run.aborted/generation/context frames. A:87 demonstrates construction rejection, not every lifecycle path.
4. **F4 — empty subset inconsistency.** `S/declaration.ts:96–102` accepts `[]`; `S/schema.ts:32` requires nonempty data selection; `S/trigger-points.ts:54` rejects it. `watchModuleFromDeclaration` directly resolves the chosen list (`E/monitoring-engine-runtime.ts:128`). T:110 shows public-helper mismatch.
5. **F5 — capability check/composition gap.** `H/contract.ts:1–4,32–39` promises refusal but is just a utility. `S/core.ts:16–20` registers processor specs/grants only; effective jobs/watch/stage metadata from `S/bindings.ts:53–64` is not composed into v2 runtime. Runtime constructor `E/monitoring-engine-runtime.ts:62–69` checks duplicate modules/handlers, not host requirements. A:55/70 passes while documenting unwanted admission. No runtime sandbox enforces arbitrary handler side effects.
6. **F6 — delivery naming and duplicate callback identity.** `S/trigger-points.ts:46` says `context`; `P/report-delivery.ts:25` installs `context_with_system`. `P/report-delivery.ts:20` appends incrementing seq to identical report IDs; A:112 observes two injected fake-hook messages for duplicate callbacks. No actual SDK receipt tested.
7. **F7 — runtime lifecycle/resource gap.** `E/monitoring-engine-runtime.ts:56,71–79,104–107`: each trigger loops jobs serially, but concurrent `onTrigger` calls have no runtime-wide cap/queue/stop/dispose/status/drain. Timeout only aborts a signal while awaiting raw handler. A:152 proves pending work remains unsettled until release, then uncertain. Hard termination of noncooperative work must be a host capability (future D1 connector), not a claim about AbortSignal.
8. **F8 — unbounded retained collections.** `E/monitoring-core-context-mailbox.ts:17–18,24,30` never prunes seen/log; maxItems limits only pending items. `E/monitoring-engine-runtime.ts:54,61,70` retains all idempotency keys/outcomes; budget approvals map (`:24–27`) has no scope removal. `P/report-delivery.ts:12,31,35` retains delivered history indefinitely. A:141 is a finite witness (8 deliveries/16 traces despite pending maxItems 4), not a memory benchmark or infinite-run proof. Not all engine collections are unbounded: selection/coordinator have explicit request/event/trace budgets; do not generalize this finding to them.
9. **F9 — report errors/receipt semantics.** `E/monitoring-engine-runtime.ts:113–120`: optional callback absence still sets reported true; callback throw escapes after idempotency state becomes prepared and before outcome recording. A:126 proves absent callback, escaped exception, empty outcomes and duplicate:prepared retry. Job success, mailbox enqueue, fake-hook mutation and actual model receipt are four different stages.
10. **F10 — generated contracts still Pi-shaped.** `S/contracts.generated.ts:44–48` and `H/frames.ts:1–13`: frame-only consumers work, legacy observer input is not host-neutral; vocabulary/branch/canonical-stage names require normalization. The generation pipeline itself is UNVERIFIED.
11. **F11 — optional provenance coverage/attestation gap.** `E/monitoring-core-source-projection.ts:76–92,147–155` only assigns current actors to user/assistant/tool text/progress, not tool-arguments/tool-meta/event-meta/history; host-record is explicitly not attestation and user approval remains originVerified false/association unresolved. `E/monitoring-core-realtime-material.ts:243–250` admits host reference content without observation-path redaction (`:120–123`). B/D use plain selection with explicit admitted tool fields, not fabricated approval. Approval authenticity and full host-content redaction remain UNVERIFIED; do not loosen approval guards.

## PROPOSED minimal deltas — approval required, none implemented

The following API names are **proposals**, not existing exports. Blocking labels are gate/contract decisions: they do not prohibit writing additional fault fixtures before implementation approval.

1. **Payload validation and source separation — blocks P2/P3 safety qualification.** Problem: F1/F2. Smallest change: add per-hook plain payload shape guards before named predicates (including required source/body/status fields), make user steer/follow-up explicitly exclude extension source; decide treatment of legacy missing-source callers. Keep raw-hook compatibility explicitly documented as trusted or validate raw payloads at host admission. Files: `S/trigger-points.ts`, host normalization and new tests. Impact: malformed/ambiguous events stop matching; raw compatibility may require versioned opt-in. Proof: current T malformed/overlap findings change to false, valid hook cases still pass; cover inherited/accessor/missing fields. Risk: old SDK events without source/final-body fields need actual pinned-SDK evidence before tightening.
2. **Fail-closed startup support — blocks P2/P3.** Problem: F5 unsupported requirements silently admitted. Smallest change: require `capabilities: HostCapabilities` on safe configured-host composition; run `validateHostCapabilities` and `hostSupportIssues` in `prepareMonitoringBindings` before factories/core start/host attach, using effective watch names and explicit job action requirements (exclude engine-owned selected-material bridge action). Throw structured `MonitoringConfigurationError` code proposed `HOST_UNSUPPORTED`, containing bounded module/kind/name issues, admit nothing on any unsupported requirement. The safe v2 composition in delta 5 must use the same check before construction. Files: `S/{bindings,core,diagnostics}.ts`, `H/contract.ts`, composition tests/Pi caller. Impact: mandatory host capability port is a breaking safe-start boundary; low-level constructors remain trusted mechanics, clearly not qualified startup. Proof: A:55/70 become explicit refusal before factories, handlers, hooks or model calls, plus supported Pi inject-context positive. Risk: arbitrary string job grants are not all host actions; reject unknown external actions or require an explicit core-internal/host action mapping, never silently drop them.
3. **Separate watchable vs lifecycle/delivery vocabulary — blocks P2 contract closure; P3 if it advertises these watches.** Problem: F3. Smallest change: expose watch-support classification and reject nonwatchable selections at safe startup with exact diagnostics, preserving lifecycle frames for invalidation/observation only. Do not make control hooks asynchronously execute jobs as an incidental fix. Files: `S/{trigger-points,declaration}.ts`, selection admission, docs. Impact: previously accepted-but-unusable declarations fail earlier; a future lifecycle-job design is separately approved. Proof: every named/raw row has an explicit admission/rejection test including aborted runs. Risk: semantic changes if consumers relied on names as observational markers rather than runnable watches.
4. **Unify empty-watch behavior — nonblocking with nonempty configuration.** Problem: F4. Smallest change: reject empty selected watch in `effectiveMonitoringWatch`, matching current schema; use stage off to disable. Files: `S/declaration.ts`, new boundary tests/docs. Impact: direct-helper callers using [] must use off instead. Proof: helper/schema/resolver all reject [] consistently and off yields no work. Risk: choosing [] as disable instead would require coordinated schema/pipeline changes; do not silently choose both semantics.
5. **Explicit v2 composition helper — P3 integration prerequisite; not a blocker for manually composed P2 fixtures.** Problem: F5's two registration paths. Smallest change: add an opt-in exported safe v2 builder accepting validated declarations/effective jobs/watch/stage, host grants/capabilities, models, handlers, report sink and adapter. Reuse existing selection/runtime; check delta 2, own packet-to-trigger/session/subject mapping and cleanup; do not change legacy processor builder into a hidden worker launcher. Files: new core host-neutral composition file/root export, Pi caller, fixtures. Impact: additive API, legacy builder remains processor-only. Proof: the four examples can omit duplicated Processor scaffolding; refusal and cleanup tests precede start. Risk: helper must not manufacture grants, budgets, authenticated provenance or worker implementations; D1 still lives in P3 host connector.
6. **Authoritative delivery name and stable report identity — blocks P3 receipt qualification.** Problem: F6. Smallest change: align `model.before-call` metadata to actual `context_with_system`; use stable module/job/event/dependency/scope identity instead of seq, and reject duplicate callbacks within the bounded delivery scope. Files: `S/trigger-points.ts`, `P/report-delivery.ts`, mailbox tests/new Pi fixtures. Impact: metadata hook changes for consumers; duplicate report callbacks cease being independent messages. Proof: A:112 becomes one fake-hook message, then real pinned-SDK next-input test proves exactly one receipt/stale carry rejection. Risk: legitimate multiple revisions for one event need explicit revision identity; do not collapse distinct results.
7. **Runtime-wide lifecycle/concurrency and raw accounting — blocks P2/P3.** Problem: F7. Smallest change: add finite maxActive/maxQueued, stopped/disposed state, stop/dispose/idle/status ports, controller tracking and rejection after stop; retain raw noncooperative slots/reservations until settled, mark logical timeout uncertain without dispatching replacement work into occupied capacity. Core cannot hard-kill arbitrary promises; future exact-pinned D1 connector owns explicit worker stop/wait/termination receipts. Files: `E/monitoring-engine-runtime.ts`, runtime fixtures, later `hosts/pi-fabric`. Impact: new finite defaults may reject excess work; explicit restart lifecycle policy needed. Proof: A:152 plus two concurrent triggers, stop/dispose, cooperative and noncooperative handlers, late output with no report, bounded raw capacity. Risk: naive Promise.race releases capacity early or retries uncertain effects; avoid it.
8. **Bound retention without reopening idempotency — blocks P2 long-run/P3 active use.** Problem: F8. Smallest change: bound outcome/trace/delivered diagnostic rings with eviction counters; make idempotency/seen retention scope-owned and capacity fail-closed, clear only at an explicit closed scope or use host-supplied durable store; add budget-scope revoke/close. Files: runtime, context mailbox, Pi delivery, new bounded-retention tests. Impact: complete diagnostic history moves to an explicit sink; callers cannot assume infinite delivered arrays. Proof: finite soak exceeds capacities with stable retained counts, duplicate/uncertain keys never execute again in a live scope, overflow refuses safely. Risk: TTL/LRU eviction of live uncertain keys re-enables effects; never propose that as an innocent memory optimization.
9. **Report enqueue/receipt/error contract — blocks P2/P3 receipt claims.** Problem: F9. Smallest change: replace optional void success inference with explicit sink enqueue accepted/rejected/unknown receipt; absent sink is not reported; contain sink exceptions and record a report-failed/unknown outcome without rerunning the already-prepared job. Host delivery reports actual next-input receipt separately, with stable ID from delta 6. Files: runtime Report/JobOutcome/RuntimeOptions, Pi delivery callback, fixtures. Impact: report callback type migration; preserve job idempotency independently from delivery retry policy. Proof: A:126 absent/throwing/duplicate cases, stale scope, rejected enqueue and actual SDK receipt. Risk: auto-retrying an uncertain receiver can duplicate injection; retry requires an idempotent sink receipt protocol.
10. **Separate legacy Pi observer types from frame contract — nonblocking for P2/P3 frame-only composition.** Problem: F10. Smallest change: designate `ObservationContext` as legacy Pi-shaped observer input, re-export from Pi with deprecation guidance; make host frames the authoritative neutral type and restore a local generator source-of-truth before regeneration. Files: generated-contract source/generator (location must first be decided), core/Pi exports/docs. Impact: preserve old type alias for compatibility; no claim that renaming sessionManager alone makes Pi observer portable. Proof: A second-host frame consumer compiles without Pi context; old Pi consumers continue compiling; deterministic regeneration check. Risk: duplicate generated/frame definitions drift or break external structural consumers.
11. **Tool-source metadata and authenticated authority port — nonblocking for read-only P2/P3 advice; blocks any authenticated-approval/persistence claim.** Problem: F11. Smallest change: explicitly map admitted tool-arguments/meta/event-meta to correct non-authoritative actor stages and IDs, or export a documented projection adapter extension; do not classify them as user approval. Host-supplied approval association/consent must have an independently versioned, authenticated port; keep unresolved fail-closed by default. Apply documented host-reference redaction policy before supply, not kind-name attestation. Files: source/input projection contracts and fixtures, host material supplier docs. Impact: additive projection support, no expansion of approval authority; full approval design requires user decision. Proof: B/D through optional projection with exact tool identity; forged assistant/host approval rejected, real approved source revision invalidation. Risk: broad kind allowlists or inferred provenance would weaken the existing safety guard.

## Scope and privacy audits

`git diff --check` passed. Tracked baseline comparison under `packages/core/src`, `hosts/pi/src` and existing test paths was empty; additions are new P1 test files only. Every changed/new file was scanned for private absolute home paths, the prohibited local username, email addresses, common provider/cloud/private-key token shapes, credential assignments, bearer tokens and JWT-shaped literals: **0 matches**. This is a finite pattern scan, not a universal secret-detector guarantee. Import audit found no library deep-source imports; only package exports and local fixture/example sharing. No manifest/lockfile or existing tsconfig changed.

## Remaining UNVERIFIED / gate handoff

- Real Pi SDK version/hook behavior, actual next provider-input receipt, registration repetition/cleanup in an SDK host, and all six pending migration tests remain P3.
- Future `hosts/pi-fabric` exact pin/export loading under bun, worker spawn/run/stop/wait and enforced global concurrency remain P3; no Fabric dependency or implementation was added.
- Complete P2 fault matrix, runtime-wide contention bounds, durable/restart semantics, long-run retained memory/latency/cost and operational kill switch are not qualified by this finite review.
- Semantic relevance/rule correctness/memory quality/test-failure equivalence, independent labels, thresholds and all D2/P5 metrics remain UNVERIFIED. No live session/data collection/paid inference/automatic writes were used or authorized.
- Scenario-specific optional turn-end/region, revision-changing in-flight judgement, next-prompt carry and authenticated approval cases not explicitly cited as passing remain UNVERIFIED. Synthetic host portability is not real opencode support.
- No push, no GitHub writes, no dependency install/upgrade, no changes to existing source or existing tests, and no modification of `backup/pre-publish`.
