# P0 frozen review baseline

## Scope and receipts

- Issue: [#1](https://github.com/lazy-dinosaur/lazy-harness-monitoring/issues/1), read with `gh issue view 1 --repo lazy-dinosaur/lazy-harness-monitoring`; no GitHub write operations.
- Frozen **source/test review commit**: `8901b9432bde05f26ff64427b078974a0b823881` (`8901b94`). At entry, `main`, `origin/main`, and `HEAD` all resolved to this hash and `git status --short` was empty. This is not the later documentation commit.
- Local branch: `qualification/p0`, created from `main`. No source, test, manifest, lockfile, or dependency changes are part of P0. `backup/pre-publish` was observed and is not to be deleted or pushed.
- Read scope: repository `README.md`, `MIGRATION.md`, root and all six workspace manifests, complete `bun.lock`, all files under `packages/core/src/` and `hosts/pi/src/`, all current and pending test files, and `packages/core/test/support/model-fixture.ts`.
- Claims below distinguish source inspection, currently passing mechanical tests, and **UNVERIFIED** future acceptance. No new SDK, performance, semantic-quality, typecheck, install, or live-session check was run. An initial inventory grep had an invalid regex; it was corrected; it was not a product/test failure.

## Observed toolchain and dependency freeze

| Command | Observed stdout |
|---|---|
| `bun --version` | `1.3.14` |
| `node --version` | `v24.21.0` |
| `bunx tsc --version` | `Version 7.0.2` |
| `sha256sum bun.lock` | `272d202ca2d8e8257e653be0d66e4f2394802ce4d8e4e47969c0d7fab3fd415e  bun.lock` |

Lockfile: repository-root `bun.lock`; `lockfileVersion: 1`, `configVersion: 1` (`bun.lock:2–3`). Versions are lock resolutions, not proof every optional platform binary was installed. No dependency install/upgrade command was run.

| Manifest / package | Declared direct dependencies | Exact resolution in `bun.lock` |
|---|---|---|
| `package.json` / `lazy-harness-monitoring` (workspace root) | dev: `@types/bun: ^1.4.4`, `typescript: ^7.0.2` | `@types/bun@1.4.4`; `typescript@7.0.2` |
| `packages/core/package.json` / `@lazy-harness/monitoring-core` | runtime: `typebox: *` | `typebox@1.4.6` |
| `hosts/pi/package.json` / `@lazy-harness/monitoring-host-pi` | runtime: `@lazy-harness/monitoring-core: workspace:*` | `workspace:packages/core`, manifest version `0.0.0` (not a registry pin) |
| `packages/eval/package.json` / `@lazy-harness/monitoring-eval` | none | workspace only, `0.0.0` |
| `modules/references/package.json` / `@lazy-harness/monitoring-module-references` | none | workspace only, `0.0.0` |
| `modules/rule-steering/package.json` / `@lazy-harness/monitoring-module-rule-steering` | none | workspace only, `0.0.0` |
| `modules/memory/package.json` / `@lazy-harness/monitoring-module-memory` | none | workspace only, `0.0.0` |

No manifest declares peer/optional dependencies. Transitive lock inventory: `bun-types@1.4.4`, `@types/node@26.6.6`, top-level `undici-types@8.12.4`, nested `@types/node/undici-types@8.9.0`. All TypeScript optional binaries below resolve to **7.0.2** (`bun.lock:60–98,104`):

- `@typescript/typescript-aix-ppc64`
- `@typescript/typescript-darwin-arm64`, `@typescript/typescript-darwin-x64`
- `@typescript/typescript-freebsd-arm64`, `@typescript/typescript-freebsd-x64`
- `@typescript/typescript-linux-arm`, `@typescript/typescript-linux-arm64`, `@typescript/typescript-linux-loong64`, `@typescript/typescript-linux-mips64el`, `@typescript/typescript-linux-ppc64`, `@typescript/typescript-linux-riscv64`, `@typescript/typescript-linux-s390x`, `@typescript/typescript-linux-x64`
- `@typescript/typescript-netbsd-arm64`, `@typescript/typescript-netbsd-x64`
- `@typescript/typescript-openbsd-arm64`, `@typescript/typescript-openbsd-x64`
- `@typescript/typescript-sunos-x64`, `@typescript/typescript-win32-arm64`, `@typescript/typescript-win32-x64`

## Host / SDK support scope

- Intended hook inventory targets **Pi 1.5.0**, explicitly in `packages/core/src/sdk/trigger-points.ts:2` and `packages/core/src/host/frames.ts:8`; advertised adapter capability version is the less precise string **`1.5`** at `hosts/pi/src/attach.ts:6`.
- No real Pi SDK version is pinned in any workspace manifest or lockfile. Actual SDK compatibility is **UNVERIFIED**. The structural `ObservationContext` is declared locally (`hosts/pi/src/observer.ts:6–10`), not imported from an installed SDK.
- Current Pi test explicitly uses a **fake Pi extension API**, fake session manager, and scripted model backend (`hosts/pi/test/pi-host.test.ts:7–13,20–23`; `packages/core/test/support/model-fixture.ts:13–20`). It emits only `session_start` and `input`, makes a scripted `skip` decision, and checks frame conformance and one judge task. It does not run a worker or observe actual provider input/report delivery.
- Real-SDK controlled-fixture tests are pending. The pending files contain actual-SDK intent but missing imported fixtures and old paths; their titles are not evidence that those checks currently pass.
- “All host events” is not literal: `packages/core/src/host/frames.ts:8–11` explicitly omits `project_trust`, `mcp_servers_change`, and `provider_stream_event`. Snapshots explicitly say `fullProviderContext: false`; omission/tail/unavailable semantics must be part of the claim, not hidden.

## Implemented vs placeholder packages

Counts are **tracked files at the review commit**, from `git ls-files <package> | wc -l`, including manifests, tsconfig, support and pending tests; not dependency/generated build trees.

| Package directory | Files | Source files | Test files | Only package.json? | Interpretation |
|---|---:|---:|---:|---|---|
| `packages/core` | 47 | 30 | 14 + 1 support | no | implemented portable engine/SDK/contract |
| `hosts/pi` | 13 | 4 | 1 current + 6 pending | no | observer/attach/report delivery implemented; worker/input migration incomplete |
| `packages/eval` | 1 | 0 | 0 | yes | placeholder, no evaluator/replay CLI |
| `modules/references` | 1 | 0 | 0 | yes | placeholder, not a qualified U1 module |
| `modules/rule-steering` | 1 | 0 | 0 | yes | placeholder, not a qualified U6 module |
| `modules/memory` | 1 | 0 | 0 | yes | placeholder, no persistence/activation |

## Package exports (source inventory, not a consumer smoke)

All six workspace packages are private version `0.0.0`. Root `package.json` has no `exports` field.

| Workspace manifest | Complete exports map | Exposure |
|---|---|---|
| `packages/core/package.json:9–13` | `{ ".": "./src/sdk/index.ts", "./host": "./src/host/index.ts", "./engine/*": "./src/engine/*" }` | SDK barrel, host barrel, each engine file below |
| `hosts/pi/package.json:6–8` | `{ ".": "./src/index.ts" }` | observer, attach, report-delivery barrels below |
| `packages/eval/package.json` | absent | no declared subpath API |
| `modules/references/package.json` | absent | no declared subpath API |
| `modules/rule-steering/package.json` | absent | no declared subpath API |
| `modules/memory/package.json` | absent | no declared subpath API |


### Core root `.` symbol groups

All paths below are relative to `packages/core/src/`. `sdk/index.ts:1–11` re-exports these groups. `models.ts:7–8` also re-exports all of `model-schema.ts` and only `monitoringJudgeRequest`, `decodeMonitoringJudgements` from `model-adapters.ts`; `validateMonitoringJudgeTasks` is NOT a root export.

| Source group | Runtime symbols | Type-only symbols |
|---|---|---|
| `sdk/bindings.ts` | `defineMonitoringModule`, `resolveMonitoringBinding`, `prepareMonitoringBindings` | `MonitoringModuleBinding`, `MonitoringLimitCeilings`, `MonitoringHostBindings` |
| `sdk/canonical-json.ts` | `CanonicalJsonError`, `canonicalJson`, `canonicalJsonHash` | — |
| `sdk/conformance.ts` | `verifyMonitoringTrace` | `MonitoringInvocationTrace`, `MonitoringReadTrace`, `MonitoringObservedEffect`, `MonitoringExpectedDelivery`, `MonitoringTraceExpectation`, `MonitoringTrace`, `MonitoringTraceIssue` |
| `sdk/contracts.generated.ts` | `PI_MONITORING_SOURCE_KINDS` | `Json`, `Reference`, `ContextSnapshot`, `CoreEvent`, `Decision`, `JudgeQuestion`, `View`, `JudgeTask`, `JudgeBatchPort`, `Proposal`, `ProposalRequest`, `Receipt`, `ProposalSink`, `Invocation`, `Processor`, `Grants`, `Outcome`, `EventReport`, `Limits`, `ObservationContext`, `ObservationStage`, `ObservationSnapshot`, `ObservationFrame`, `ObservationOutcome`, `ObservationConsumer`, `ObservationLimits`, `ObservationLease`, `MaterialSource`, `MaterialEnvelope`, `MaterialAck`, `MaterialReceiver`, `SourceDelivery`, `BridgeReport`, `BridgeLimits`, `BridgeOptions`, `MonitoringCorePort`, `MonitoringCoreFactory`, `MonitoringBridgePort`, `MonitoringObservationBridgeFactory` |
| `sdk/core.ts` | `createConfiguredMonitoringCore` | `MonitoringCoreHost` |
| `sdk/declaration.ts` | `MONITORING_REPORT_MODES`, `MONITORING_RISK_TIERS`, `MonitoringModuleDeclarationSchema`, `validateMonitoringModuleDeclaration`, `effectiveMonitoringJobs`, `effectiveMonitoringWatch`, `effectiveMonitoringStage` | `MonitoringReportMode`, `MonitoringRiskTier`, `MonitoringJobDeclaration`, `MonitoringModuleDeclaration`, `MonitoringJobOverride`, `MonitoringEffectiveJob`, `MonitoringRunStage` |
| `sdk/diagnostics.ts` | `MonitoringConfigurationError`, `freezeMonitoringData`, `configurationFailure` | `MonitoringDiagnosticCode` |
| `sdk/model-schema.ts` | `MonitoringModelLimitsSchema`, `MonitoringModelConfigurationSchema`, `MonitoringModelError`, `modelFailure`, `modelJson`, `parseMonitoringModelConfiguration`, `monitoringModelConfigurationJsonSchema`, `monitoringModelFingerprint`, `bindMonitoringModels` | `MonitoringModelLimits`, `MonitoringModelConfiguration`, `MonitoringModelRole`, `MonitoringModelKind`, `MonitoringModelDiagnosticCode`, `MonitoringBoundModelProfile`, `MonitoringModelRequest`, `MonitoringModelEstimate`, `MonitoringModelInvocation`, `MonitoringModelBackend`, `MonitoringModelHost` |
| `sdk/models.ts` | `MonitoringModelRouter`, `createMonitoringModelRouter` | `PreparedJudgeGroup`, `PrepareJudgeGroup` |
| `sdk/schema.ts` | `MONITORING_CONFIGURATION_VERSION`, `MONITORING_CONFIGURATION_MAX_BYTES`, `MonitoringConfigurationSchema`, `monitoringConfigurationJsonSchema`, `parseMonitoringJsonData`, `parseMonitoringConfiguration` | `MonitoringReadonly`, `MonitoringConfiguration` |
| `sdk/trigger-points.ts` | `MONITORING_TRIGGER_POINTS`, `MONITORING_DELIVERY_POINTS`, `resolveMonitoringWatch` | `MonitoringTriggerFrame`, `MonitoringTriggerPoint`, `MonitoringResolvedWatch` |
| `sdk/model-adapters.ts` via `sdk/models.ts:8` | `monitoringJudgeRequest`, `decodeMonitoringJudgements` | — |

### Core `./host` symbol groups

| Source group | Runtime symbols | Type-only symbols |
|---|---|---|
| `host/frames.ts` | `observationEvents` | `ObservationStage`, `ObservationSnapshot`, `ObservationFrame`, `ObservationOutcome` |
| `host/contract.ts` | `validateHostCapabilities`, `hostSupportIssues`, `frameSequenceIssues` | `HostAction`, `HostCapabilities`, `MonitoringFrameTarget`, `MonitoringHostAdapter`, `HostSupportIssue` |

### Core `./engine/*` symbol groups

The wildcard substitutes the literal tail into `./src/engine/*`; existing consumers include the `.ts` suffix. These are all current source targets, not stable-release promises. Types duplicated from generated contracts are listed at their own entry too.

| Source group | Runtime symbols | Type-only symbols |
|---|---|---|
| `engine/monitoring-core-context-mailbox.ts` | `ContextCarryMailbox` | `CarryScope`, `CarryDependency`, `CarryItem`, `CarryDelivery`, `CarryTrace`, `CarryOptions` |
| `engine/monitoring-core-input-projection.ts` | `InputProjectionError`, `buildInputProjection` | `ProjectionLimits`, `ProjectionCode`, `ProjectionHost`, `ProjectionBinding`, `SourceMeta`, `ApprovalProjection`, `ProjectedTask`, `RunEligibility`, `InputProjectionBatch` |
| `engine/monitoring-core-observation.ts` | `materialContentHash`, `MonitoringObservationBridge` | `ObservationLease`, `MaterialSource`, `MaterialEnvelope`, `MaterialAck`, `MaterialReceiver`, `SourceDelivery`, `BridgeReport`, `BridgeLimits`, `BridgeOptions` |
| `engine/monitoring-core-realtime-execution.ts` | `RealtimeExecutionConsumer` | `RealtimeExecutionInvocation`, `RealtimeExecutionRecord`, `RealtimeExecutionLimits`, `RealtimeExecutionPorts` |
| `engine/monitoring-core-realtime-material.ts` | `regionLines`, `RealtimeMaterialWindow` | `RealtimeMaterial`, `MaterialWindowLimits`, `MaterialWindowOptions` |
| `engine/monitoring-core-realtime-selection.ts` | `RealtimeSelectionBridge`, `createRealtimeSelectionPipeline`, `createIndependentSelectionPipelines` | `RealtimeWatchModule`, `RealtimeInputProjection`, `RealtimeSelectionPacket`, `RealtimeSelectionLimits`, `RealtimeSelectionOptions` |
| `engine/monitoring-core-realtime.ts` | `RealtimeMonitoringCoordinator` | `RealtimeDependency`, `RealtimeSignal`, `RealtimePrepared`, `RealtimeLease`, `RealtimeCandidate`, `RealtimeOffer`, `RealtimeLimits`, `RealtimeOptions`, `RealtimeTrace` |
| `engine/monitoring-core-redaction.ts` | `redactSecrets` | — |
| `engine/monitoring-core-source-projection.ts` | `MaterialSourceProjectionError`, `captureWindowProjection` | `SourceProjectionCode`, `SourceProjectionModule`, `SourceProjectionOptions`, `WindowProjectionSource` |
| `engine/monitoring-core-trigger.ts` | `SyntheticTriggerRegistry` | `TriggerResult`, `TriggerInvocation`, `TestTriggerHandler`, `TriggerGrants`, `TriggerRecord`, `TriggerLimits` |
| `engine/monitoring-core.ts` | `MonitoringCore` | `Json`, `Reference`, `ContextSnapshot`, `CoreEvent`, `Decision`, `JudgeQuestion`, `View`, `JudgeTask`, `JudgeBatchPort`, `Proposal`, `ProposalRequest`, `Receipt`, `ProposalSink`, `Invocation`, `Processor`, `Grants`, `Outcome`, `EventReport`, `Limits` |
| `engine/monitoring-engine-judgement-log.ts` | `JudgementLog`, `judgementEntriesFromExchange` | `JudgementEntry`, `JudgementLogOptions` |
| `engine/monitoring-engine-runtime.ts` | `ApprovedBudgetGate`, `MemoryIdempotencyStore`, `MonitoringModuleRuntime`, `watchModuleFromDeclaration` | `CostKind`, `EvidenceItem`, `Trigger`, `BudgetLease`, `JobContext`, `JobResult`, `JobHandler`, `Report`, `JobOutcome`, `RegisteredModule`, `IdempotencyStore`, `RuntimeOptions` |
| `engine/monitoring-trace.ts` | `pruneTraces`, `createFileTraceSink` | `MonitoringTraceRow`, `MonitoringTraceSink`, `FileTraceSinkOptions` |


### Pi root `.` symbol groups

`hosts/pi/src/index.ts:1–3` exports all three groups. Source paths in this table are relative to `hosts/pi/src/`.

| Source | Runtime symbols | Type-only symbols |
|---|---|---|
| `observer.ts:1–12,25,45,83,157` | `observationEvents` (re-export), `visibleMessage`, `readObservationSnapshot`, `PiMonitoringObserver`, `createPiObservationExtension` | `ObservationStage`, `ObservationSnapshot`, `ObservationFrame`, `ObservationOutcome` (re-exports); `ObservationContext`, `ObservationConsumer`, `ObservationLimits` |
| `attach.ts:6,10` | `piHostCapabilities`, `attachPiFrames` | — |
| `report-delivery.ts:8–9` | `createParentReportDelivery` | `ParentReportDeliveryOptions` |

Public import resolution outside this workspace, packed/clean-install behavior, declaration compatibility and real SDK typing are **UNVERIFIED**. Existing tests sometimes use package exports but mostly deep repository imports; inventory is not compatibility qualification.

## Executed test receipt

Command run once:

```sh
bun test packages/core/test hosts/pi/test/pi-host.test.ts
```

Verbatim runner header and terminal summary (per-test timing lines omitted):

```text
bun test v1.3.14 (0d9b296a)

 164 pass
 0 fail
 684 expect() calls
Ran 164 tests across 15 files. [441.00ms]
```

This is the bounded invocation above, NOT all repository tests. Root `package.json:11` separately excludes pending files with `--path-ignore-patterns=**/pending-from-core/**`; that script was inspected, not executed. The six pending files were not run. Historical `tsc clean` in `MIGRATION.md` / issue #1 was not rechecked by P0; only the compiler **version** command was run.

### Passing file inventory

`C = packages/core/test/`. Counts include `test.each` expansion, not inner assertion-loop iterations; sum = 162 core + 2 Pi = 164.

| File | Exact describe title(s) | Tests |
|---|---|---:|
| `C/monitoring-core-context-mailbox.test.ts` | late-result carry mailbox (read-only context, synthetic) | 9 |
| `C/monitoring-core-input-projection.test.ts` | free input projection contract and module required-evidence guards; actual existing Core/A seams with mechanical source + scripted native envelopes (not SDK/model acceptance) | 26 |
| `C/monitoring-core-realtime-execution.test.ts` | C1 actual CPU A/B ready result → purpose handlers → independent execution result | 37 |
| `C/monitoring-core-realtime-frame-bound.test.ts` | frame-bounded judgement material (opt-in, CPU only) | 3 |
| `C/monitoring-core-realtime-history.test.ts` | opt-in recent conversation history material (synthetic, CPU only) | 7 |
| `C/monitoring-core-region.test.ts` | between-region input (task154, model calls 0); bridge moves the region after a judgement (task154, model calls 0); purpose-scoped region compaction (task154, model calls 0) | 8 |
| `C/monitoring-core-s2-items.test.ts` | S2 item preparation (synthetic, CPU only) | 6 |
| `C/monitoring-core-source-projection.test.ts` | real Window data to existing projection, not SDK authenticity or semantic accuracy; initial dependencies and existing Core/A seams; synthetic/scripted only | 33 |
| `C/monitoring-declaration.test.ts` | module declaration v2 (S1, additive; model calls 0) | 5 |
| `C/monitoring-engine-judgement-log.test.ts` | S3 judgement log (engine rule, CPU only) | 4 |
| `C/monitoring-engine-runtime.test.ts` | S4 module runtime engine rules (CPU only) | 8 |
| `C/monitoring-host-contract.test.ts` | host adapter contract (ADR 0062) | 3 |
| `C/monitoring-trace-stage.test.ts` | run stages (task154); judgement trace (task154) | 5 |
| `C/monitoring-trigger-points.test.ts` | trigger points (task154, model calls 0); independent per-module pipelines (task154, model calls 0) | 8 |
| `hosts/pi/test/pi-host.test.ts` | Pi host adapter (ADR 0062) | 2 |

`packages/core/test/support/model-fixture.ts` is a helper, no describe/test cases. “Actual CPU” or “real Window” in a title means real local classes/callbacks, not real SDK/model/business effects.

### EXCLUDED: all six `hosts/pi/test/pending-from-core/*`

Counts below are **static expanded intended cases**, not executed pass/skip counts; actual collection remains **UNVERIFIED** because imports are broken. `actual(...)` aliases `describe` or `describe.skip` depending on imported `sdkEntry`. No retirement/restore decision is approved.

| File | Exact describe / actual title(s); intended count | Covers | Why it cannot run now (imports / stale API) | Proposed disposition and reason |
|---|---|---|---|---|
| `monitoring-core.test.ts` | monitoring core contracts; functional reference examples; **22** (including 5 top-level tests) | registration/grants, event identity/order, isolation, physical slots, stale/stop/timeout, reads/receipts/budgets and old scenario replay | `:4` imports `../src/engine/monitoring-core.ts` relative to pending directory; `:5` imports absent `../../.lazy-harness/scripts/monitoring-core-examples.ts`; `:177` reads absent v1 scenario JSON | **replace** old v1 examples with public-boundary v2 fixtures; restore still-relevant core mechanical protections under core ownership, avoiding lost coverage |
| `monitoring-core-observation.test.ts` | P3 mechanical bridge/receipt guards (not actual-SDK proof); P3 ACTUAL SDK settled source→core→independent receiver; **30** = 19 mechanical + 11 SDK | settled source scan, exact body/ack, gaps, freshness, budgets, noncooperative receiver, SDK steer/tree/compact/abort/tail | `:4–8` old engine/observer paths, absent v1 example factories and `../../packages/lazy-harness-pi/tests/support/monitoring-sdk-fixture.ts` | **restore with new imports** and a separately qualified real SDK fixture; retain settlement-bridge scope explicitly, not as proof of next-call report injection |
| `monitoring-core-realtime-selection.test.ts` | B material and scoped selection mechanical qualification; B ACTUAL SDK/faux source and scripted native-classifier composition; **26** = 22 mechanical + 4 SDK | material admission, per-module views, partial/final, routes, revisions/grants, native classifier failures and raw drain | `:4–8` old engine/observer/helper paths, missing SDK fixture; imports `createPiMaterialTap`, and old `pipeline.extension` expectations, neither in current exported pipeline | **replace** tap/extension wiring with `attachPiFrames` and current independent pipelines; restore source-selection assertions and SDK seams rather than invent compatibility shims |
| `monitoring-core-realtime.test.ts` | A realtime mechanical qualification (not semantic model accuracy); A realtime ACTUAL SDK / native faux provider (no live/model qualification); **34** = 30 mechanical + 4 SDK | epochs, generations, cursor gaps, bounded queues/coalescing, cancel/timeout/raw slots, context offers, steer | `:4–6` old paths and absent SDK fixture; imports removed `createPiRealtimeTap` | **replace** obsolete tap fixture with current attach/target boundary; preserve coordinator tests under core and real-SDK cases under hosts/pi |
| `monitoring-core-trigger.test.ts` | P4 mechanical execution target guards (not actual-SDK proof); P4 ACTUAL SDK source→selection→target→controlled effect→execution receipt; **27** = 15 mechanical + 12 SDK | synthetic registry grants/idempotency, receipt identities, lifecycle/raw slots and controlled memory effects | `:4–8` old engine/observer imports, absent v1 example factories and real SDK fixture; registry is explicitly a synthetic test target (`engine/monitoring-core-trigger.ts:19`) | **replace** v1 example composition with v2 runtime/execution public-boundary fixtures; restore distinct registry protections where still used; no blanket retirement |
| `monitoring-observer.test.ts` | Pi observer mechanical protections (not actual-SDK proof); Pi observer ACTUAL SDK / official faux provider acceptance; **16** = 8 mechanical + 8 SDK | snapshot omissions, count/byte bounds, overflow, stale/timeout, context transforms, native identity, branch/compact/shutdown/steer/abort | `:3` imports old `../src/observer/monitoring-observer.ts`; `:4` imports absent `./support/monitoring-sdk-fixture.ts` | **restore with new imports** and real SDK fixture; fake observer checks alone cannot establish native event timing |

Absence cross-check: `git ls-files '*fixture*' '*examples*' '*Tap*'` returned only `packages/core/test/support/model-fixture.ts`. Import targets and removed symbols were read, not execution-probed; no excluded test command was attempted.

## Migration debts and excluded claims

| ID | Debt / excluded claim | Frozen evidence | Owner / next measurable proof |
|---|---|---|---|
| D1 | Pi worker binding, host input ports and real SDK fixture remain migration **2b** | `MIGRATION.md:11`; only observer/attach/report files in `hosts/pi/src/` | hosts/pi / P3: controlled real SDK source → stub worker → next actual model-input receipt |
| D2 | Module migration **3**, evaluator **4**, new memory **5**, thin consumer **6** not done here | `MIGRATION.md:12–15`; four placeholder manifests only | module / eval / P4–P7: public examples, shared replay/scoring, read-only memory gate, approved cutover/rollback |
| D3 | Core public generated contract still declares Pi `sessionManager`, Pi source kinds, and external regeneration paths | `packages/core/src/sdk/contracts.generated.ts:1–4,44–47,103` | core / P1: second synthetic host and generated-contract compatibility decision; no real second-host claim |
| D4 | `hostSupportIssues` is not enforced by startup/composition | repo-wide literal grep found only `README.md:18`, definition `packages/core/src/host/contract.ts:32`, and `packages/core/test/monitoring-host-contract.test.ts:2,13–14`; `sdk/core.ts:7–24`, `sdk/bindings.ts:35–68`, engine selection composition and Pi attach do not call it | core + hosts/pi / P1: unsupported module must be rejected through the actual startup path, not just the utility |
| D5 | Capability declaration overstates action evidence | `hosts/pi/src/attach.ts:6` advertises inject/steer/block; `:10–25` only frame attach; `hosts/pi/src/report-delivery.ts:25–31` implements context injection, no steer/block action port | Follow-up resolution: declaration narrowed to only `inject-context`, with exact-list and missing `block-tool-call` utility assertions in `hosts/pi/test/pi-host.test.ts`; the frozen evidence remains historical. Steer/block executors and real SDK action receipts remain future work. |
| D6 | Restart durability absent by default | `engine/monitoring-engine-runtime.ts:53–56,72` default Map store; `engine/monitoring-core-context-mailbox.ts:16–18` Maps/Set/array, no persistence port | core / P2/P6: restart/crash receipt reconciliation, durable idempotency + carry policy; trace files are not recovery state |
| D7 | Runtime worker limits are not one complete production dispatcher | `engine/monitoring-engine-runtime.ts:56,76–83,103–106`: abort timer but raw handler awaited, no runtime-wide concurrency/queue/lifetime options, no stop/dispose API; coordinator/router/consumer have separate bounds | core + hosts/pi / P2/P3: compose and fault-inject limits, including noncooperative workers; no hard-kill guarantee |
| D8 | Exactly-once parent input is not qualified end to end | mailbox tested independently; `hosts/pi/src/report-delivery.ts:20` adds `++seq` to every put ID; `:25` uses `context_with_system`; SDK trigger delivery metadata says `context` at `sdk/trigger-points.ts:46` | hosts/pi / P1/P3: duplicate report callbacks, registration repetition, stale/session/carry boundaries, actual next provider input; do not confuse next user prompt with next model call |
| D9 | “Bounded memory everywhere” is unproved | mailbox `seen` and log never pruned (`engine/monitoring-core-context-mailbox.ts:17–18,24,30`); runtime `outcomes` grows (`engine/monitoring-engine-runtime.ts:61,74`); delivered history grows (`hosts/pi/src/report-delivery.ts:12,30`) | core + hosts/pi / P2/P6: long-run retention and peak-memory probes; current bounded queue tests do not cover all collections |
| D10 | Trace exists, deterministic evaluation pipeline does not | `engine/monitoring-trace.ts:27–43`; `packages/eval/package.json:1–6` only; `sdk/conformance.ts:84–85` explicitly limits oracle interpretation | eval / P4: versioned manifest, stub replay, score/compare command and independent rerun artifacts |
| D11 | Provenance/redaction boundaries need qualification | observation material redacts at `engine/monitoring-core-realtime-material.ts:120–123`; host `setReference` path `:239–250` does not apply `redactSecrets`; source metadata says host-record is NOT attestation (`engine/monitoring-core-source-projection.ts:76–80`) | core + hosts/pi / P2/P4: source authenticity and admitted-host-reference redaction/consent policy; regex redaction is not a total secret detector |
| D12 | Trigger vocabulary is larger than usable selection surface | lifecycle/control events are rejected as module watch events in `engine/monitoring-core-realtime-selection.ts:23,85`; coordinator returns on generations/context (`engine/monitoring-core-realtime.ts:100–115`); `tool.failed` uses `tool_execution_end`, while rich tool-result body is captured elsewhere (`engine/monitoring-core-realtime-material.ts:151–163`) | core / P1: enumerate named/raw point → admission → material availability with runnable fixtures; no generic condition DSL assumed |
| D13 | Deployment survival is not restart durability | no tmux/resident-host implementation or operating receipt in source/manifests; current APIs are in-session callbacks | D1 (user 2026-11-09): issue #1 P3 adds `hosts/pi-fabric` for R4 spawn/run/stop/wait, queueing/concurrency, EXACT pinned `pi-fabric`, public `pi-fabric/agents` + `pi-fabric/runners` (optional `pi-fabric/jev` judgement); core stays Fabric-free. First probe: bun loads pinned exports despite `engines.node >=24`. Fabric resident host/Jev observation are not an event source or delivery guarantee; persistence is not Fabric's role. hosts/pi / P6: tmux leaning, not final; detach/reattach, restart/failure/kill-switch runbook. RPC daemon remains deferred. |

Engine evidence paths abbreviated above are relative to `packages/core/src/`. Historical evidence files referenced by `MIGRATION.md:17–18` live in another repository and were not used as local acceptance evidence. No prior semantic-accuracy, latency, memory, cost or live-placement acceptance evidence was found in this repository; current CPU test receipts are narrower.
