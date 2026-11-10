# P3 — Pi adapter qualification review (issue #1)

## Decision and scope

**Partial qualification; complete P3 exit is still NOT claimed.** Approved F1–F4 fixes now guard late-worker scope and selected-source freshness in the explicit handoff composition, label hook-boundary receipts, and declare only real-SDK-proven events. The five remaining legacy pending files are now migrated; the root test exclusion is removed. This closes pending-protection migration, not the other P3 exit limitations. This is Pi SDK 1.5.0 faux-provider qualification, not live-use acceptance or a shipped turnkey scheduler. See **Implemented fixes** for commits, tests, API compatibility and resolver obligations.

- Starting revision: `50b3263` (`qualification/p1`); working branch: `qualification/p3`.
- SDK: `@earendil-works/pi-coding-agent` **1.5.0**, exact `hosts/pi` devDependency, also `*` peerDependency. No other manifest dependency changes.
- Runtime observed: Bun 1.3.14, Linux x64. No claim for Node, other Bun versions, other SDK versions, TUI, RPC transport, or another host.
- The original review made no runtime-source edits. Approved option-A F1–F4 fixes below change only the required core/Pi contracts, host composition, proving tests and this phase document. P1 proposed deltas 4, 5, 10, 11 and R7 persistence are NOT implemented.
- Acceptance numbers remain provisional. No semantic accuracy, paid inference, live session, or production activation claim.
- SDK README, SDK guide, extension event/context documentation, public declarations, extension example, and faux-provider declarations were inspected. The fixture does not import private SDK paths.

## Reproduction

```sh
bun install --frozen-lockfile
bun run test
bunx tsc -p packages/core/tsconfig.json
bunx tsc -p hosts/pi/tsconfig.json
bunx tsc -p examples/p1/tsconfig.json
bunx tsc -p hosts/pi/test/tsconfig.json
bun hosts/pi/test/hooks-overhead.ts
```

`bun run test` now discovers core, Pi, eval and all three module suites without a pending-path exclusion. `bun run typecheck` runs the eight configured compiler projects, including all restored `monitoring-core*.test.ts` suites and test support in the Pi test project. The standalone overhead program remains a separate, non-threshold benchmark. Earlier receipts below are historical; the pending-migration verification is recorded separately.

## Fixture and execution trace

`hosts/pi/test/support/real-sdk.ts` creates an isolated temporary SDK workspace, in-memory credentials/settings and initial session manager, a network-disabled `ModelRuntime`, and an official `fauxProvider`. It loads real inline extensions through `DefaultResourceLoader`, creates a real `AgentSession`, and calls `bindExtensions`. `AgentSessionRuntime` exercises replacement and shutdown using the SDK's public factory contract. Replacement sessions may persist inside the temporary workspace, which is removed on disposal.

The fixture resolves the SDK's own public `@earendil-works/pi-ai` and `/providers/faux` exports using Bun's import resolver, avoiding a new direct dependency. It uses fixed faux chunks and scripted assistant/tool responses. No fallback to a real provider exists in the fixture. Every SDK test file installs a throwing fetch guard and asserts zero fetch attempts; this is a fetch guard, not an OS network sandbox.

Provider requests are captured **inside the faux response factory**, after actual SDK context processing. This is the exact faux provider transcript input, not the observer snapshot and not an HTTP-wire receipt. Raw hook records are JSON diagnostic copies (preparation objects may contain functions); provider transcript captures use structured copies. Observer callback return values and extension errors are recorded separately. Conformance is checked per binding after real runs.

`hosts/pi/test/support/pipeline.ts` composes public core exports: `defineMonitoringModule`, `watchModuleFromDeclaration`, `createIndependentSelectionPipelines`, `MonitoringModuleRuntime`, `createInMemoryWorkerPort`, and `createParentReportDelivery`. The classifier backend is deterministic test code reused from `examples/p1/support.ts`, not a real inference call. Hooks never await a background classifier or worker. A test-owned `drain()` waits for ready selection offers, checks `offer.isCurrent()`, then explicitly hands selected packets to the runtime. This is a **review composition**, not a newly shipped turnkey host runtime.

The positive trace is:

1. Real `session_start` and `input` hooks produce ordered immutable frames; `attachPiFrames` hands them to independent core pipelines.
2. `frameSequenceIssues(..., piHostCapabilities)` returns `[]`.
3. Scripted classifier selects the exact user text; the source frame ID matches the worker trigger and selected text is checked independently.
4. The supplied in-memory worker port returns a prepared report; runtime records an explicit enqueue receipt.
5. Receipt list is empty before a request. The report appears in the **next actual faux provider input**, with matching report identity, once.
6. A subsequent actual request lacks the report. Scripted skip/defer perform no worker dispatch and inject nothing.

## End-to-end results and limitations

| Protection | Executable evidence | Result |
|---|---|---|
| Full hook → frames → selection → worker → next-input chain | `real-sdk-pipeline.test.ts`: `SDK hooks → conformant frames → selection → worker port → report → NEXT actual model input once` | Verified, finite scripted path |
| Observer noninterference and exact context-hook projection | `real-sdk.test.ts`: `SDK text hooks reconcile...` | Verified against disabled observer |
| Native progress/final pairs, identities, pre-persist message view, thinking omissions | `real-sdk.test.ts`: `SDK tool progress/final pairs...` and terminal tool-error test | Verified |
| Steer and follow-up inputs | `real-sdk.test.ts`: two `SDK ... is accepted mid-stream...` tests | Verified through next actual input; these are input observations, not implemented steer actions |
| Abort and no automatic next request | `real-sdk.test.ts`: `SDK abort exposes terminal aborted state...` | Verified for foreground SDK run |
| Context edit, tree navigation, custom compaction, model/thinking selection | `real-sdk.test.ts`: `SDK context edits, tree navigation...` | Verified; compaction uses faux summary, no paid call |
| Replacement/shutdown while diagnostic callback is blocked | `real-sdk.test.ts`: `SDK replacement and shutdown...` | Verified; old lease/close cannot affect new binding |
| Late selection invalidated by input/tree/compact/session changes | Four parameterized `real-sdk-pipeline.test.ts` tests | Verified before worker handoff |
| Already-enqueued report stale session/branch/source, age/carry limits | Six `SDK queued report rejected after ... change` tests | Verified; source protection requires caller-supplied dependencies |
| Late worker old-session report | `real-sdk-late-worker.test.ts`: `SDK late worker report with old session identity...` | Refused by session scope |
| Late worker branch/source freshness | `real-sdk-pipeline.test.ts` tree refusal; `real-sdk-late-worker.test.ts` canonical edit refusal and controls | Verified for captured scope and selected canonical user-text dependencies; caller must capture before dispatch and supply a live resolver |
| Max carry one turn, first-request delivery, exactly once | `SDK inject-context delivers...`, zero-carry refusal, duplicate/foreign refusal | Verified for listed cases |
| Item count/text-byte bounds | `SDK carry item/text bounds refuse before injection` | Verified before injection |
| Receipt kind and later extension stripping | `real-sdk-boundaries.test.ts`: `SDK stripped report has hook-boundary receipt only...` | Explicit `kind: hook-boundary`; exactly once at hook output, not provider acknowledgement |

## Pending-test dispositions

All six original files have now been dispositioned. The observer replacement remains documented below. The five remaining files have been migrated into active `hosts/pi/test/monitoring-core*.test.ts` suites: **137 executable tests** against public engine exports and the mandatory real SDK 1.5.0 faux fixture. The complete [protection → disposition → test ledger](pending-pi-protection-migration.md) enumerates all **112 original test-title groups**, including every parameterized variant, narrow v1 API/private-example retirements and their cited current tests. No protection is retired merely because its import moved.

| Original pending file | Disposition → active test | Previously uncovered protections now exercised |
|---|---|---|
| `monitoring-core-observation.test.ts` (277 lines) | Restore at `hosts/pi/test/monitoring-core-observation.test.ts` | Source-count/frame/reference/material-byte limits; all malformed receiver receipt variants; duplicate/conflicting settlements; gaps/order; isolation; lifetime and raw receiver cancellation/timeout accounting; real SDK scope, abort, tail and ring-overflow cases |
| `monitoring-core-realtime-selection.test.ts` (278 lines) | Restore; replace removed Pi material tap with explicit `attachPiFrames` | Module grant/view isolation, profiles/routes, denied accessor reads, explicit argument admission, provisional/final versions, missing-current selection, malformed classifier results, source-window limits, nested raw timeout accounting, cleanup and four real SDK paths |
| `monitoring-core-realtime.test.ts` (249 lines) | Restore; replace removed realtime tap with explicit `attachPiFrames` | Queue coalescing/overflow, raw slots, all lifetime/retention bounds, malformed/accessor frames, dependency/permission rechecks, model/thinking invalidation, no-next-context and stop/detach ownership; four real SDK paths |
| `monitoring-core-trigger.test.ts` (221 lines) | Restore public synthetic registry; not a business executor | Route/grant/body/source/effect receipts; reentrant replay; replacement disposer; uncertain effects; raw handler deadline; concurrency/retention and real SDK controlled-memory-effect cases |
| `monitoring-core.test.ts` (199 lines) | Restore direct public engine guards; replace/retire two private example tests as detailed in ledger | Explicit start/grants; conflicting/ordered events; judgement evidence; isolated errors; physical slots; stale contexts; sink identities; immutable JSON, reference integrity and lifetime/read/queue budgets. Current P1 scenarios replace private fixture spellings; missing answers stay technical uncertainty in current selection |

The pending directory is empty and removed; root `test` no longer has a pending-path ignore, and `hosts/pi/test/tsconfig.json` explicitly includes all five restored suites. No runtime source change or new dependency was needed. No new current defect / `FINDING:` was exposed by this batch. Removed tap-wrapper double-registration/error-propagation behavior and private-example output spellings are explicitly retired, not silently weakened. Other P3 limitations remain open.


### Complete observer replacement map

| Original protection | New active test (prefix; all under `hosts/pi/test`) |
|---|---|
| Disabled default, no registrations/resources | `observer-protections.test.ts`: `observer disabled default...` |
| Immutable scoped copies; thinking/image/signature omissions | `observer snapshots are immutable...` |
| Oversized snapshot explicit unavailable | `observer byte limits mark unavailable...` |
| Queue overflow and stale canonical source | `observer queue overflow and changed canonical source...` |
| Logical timeout retains raw physical slot | `observer timeout holds physical slot...` |
| Consumer error isolation and old close | `observer isolates consumer errors...` |
| Unsupported replacement fails closed, old lease dead | `observer unsupported replacement fails closed...` |
| Frame/outcome bounded ring and eviction counters | `observer retention exposes both frame and outcome eviction counts` |
| Actual hook reconciliation and provider noninterference | `real-sdk.test.ts`: `SDK text hooks reconcile...` |
| Streaming thinking/tools, native entries, pre-persist view | `SDK tool progress/final pairs...` |
| Tool error preserved | `SDK terminal tool error remains an error...` |
| Later transform is not observer's provider proof | `real-sdk-boundaries.test.ts`: `SDK later context transformer differs...` |
| Edits, branch view, compaction projection | `SDK context edits, tree navigation...` |
| Replacement/shutdown foreground nonblocking, old binding close | `SDK replacement and shutdown invalidate old diagnostic lease...` |
| Queued steer accepted before final settlement | `SDK steer is accepted mid-stream...` |
| Abort terminal message and final settled boundary | `SDK abort exposes terminal aborted state...` |

## Supported-capability / version matrix

Scope: **Pi SDK 1.5.0 only; observation support**, not semantic usefulness or actionable interception. `V` below means the event was emitted by the real SDK and observed as a conformant, notification-only frame in the named test. The common negative evidence for **every** qualified event is `real-sdk-capabilities.test.ts`: `negative event inventory: disabled observer registers none of the entire declared vocabulary` and `negative attach order...` (unit controls, explicitly not a second real host). Normal-run negatives also include the actual SDK `handled input causes no provider request or run hooks` test. No untested event is promoted merely because it appears in `observationEvents`.

Additional pending-migration evidence (no capability declaration changes): `monitoring-core-realtime-selection.test.ts` proves admitted native progress while a real SDK tool is gated, assistant final material, tool-result context crossing and native steer; `monitoring-core-realtime.test.ts` proves pre-settlement dispatch, context handoff without injection and steer invalidation. `monitoring-core-observation.test.ts` / `monitoring-core-trigger.test.ts` add settled-source and controlled-memory-target boundary coverage. These strengthen the existing tool/input/context/settlement rows only; they do not promote unproven hooks, effects or host versions.

Evidence keys:
- **I**: `real-sdk-capabilities.test.ts`, `SDK capability inventory: every qualified run event...` (asserts each listed event).
- **L**: `real-sdk.test.ts`, `SDK replacement and shutdown...` (actual new-session replacement and runtime disposal).
- **T**: `real-sdk.test.ts`, `SDK context edits, tree navigation, compaction, model and thinking changes...`.
- **D**: `real-sdk.test.ts`, report delivery and six stale/limit refusals; full path in `real-sdk-pipeline.test.ts`.
- **E**: `real-sdk-event-probes.test.ts`, actual runtime fork, cancelled manual compaction, SDK-wrapped pending selector, and SDK cache scheduler with synthetic faux cache metadata. No direct synthetic event emits are used.

| Event/action (removed declarations explicitly marked) | SDK 1.5.0 | Positive test | Negative evidence / limit |
|---|---|---|---|
| `session_start` | V | I | Default-off/attach-order controls |
| `session_shutdown` | V | L | Old diagnostic lease is invalidated |
| `session_before_switch` | V, replacement trace | L | Default-off/attach-order controls; no resume-file claim |
| `session_before_fork` | V | E: native entry fork via `AgentSessionRuntime.fork` | Old session identity and new session replacement asserted |
| `session_before_tree` | V, transition trace | T | Queued-report/late-selection tree refusals |
| `session_tree` | V | T | Queued-report and captured late-worker tree refusals |
| `session_before_compact` | V, compaction trace | T | Late-selection invalidation |
| `session_compact` | V | T | Queued-report compact refusal |
| `session_compact_failed` | V, manual cancellation | E | Aborted/manual flags, no summary request; other failure modes UNVERIFIED |
| `input` | V | I, steer/follow-up tests | Actual handled input; skip/defer |
| `message_start` | V | I | Actual handled input suppresses run |
| `message_update` | V | I | Actual handled input suppresses run |
| `message_end` | V | I | Actual handled input suppresses run; terminal error distinct |
| `tool_call` | V | I | Actual handled input suppresses run; no blocking action declared |
| `tool_result` | V | I | Error result remains error |
| `tool_execution_start` | V | I | Actual handled input suppresses run |
| `tool_execution_update` | V | I | Observer omits raw progress body; admitted material is separate |
| `tool_execution_end` | V | I | Error pair preserves identity |
| `context` | V | I | Handled input: no model request |
| `context_with_system` | V | I, D | Explicit hook-boundary receipt; later transformer can strip output |
| `turn_start` | V | I | Actual handled input suppresses run |
| `turn_end` | V | I, native-entry test | Actual handled input suppresses run |
| `agent_start` | V | I | Actual handled input suppresses run |
| `agent_end` | V | I | Not treated as final SDK settlement |
| `agent_settled` | V | I, abort test | Abort flag preserved; no automatic next request |
| `model_select` | V | T | Same-model selection emits no event; different faux model does |
| `thinking_level_select` | V | T | Default-off/attach-order controls |
| `before_agent_start` | V | I | Observer does not alter prompt |
| `agent_before_settle` | V | I | Observer returns undefined, no continuation |
| `user_bash` — REMOVED from declaration | Not proven | E negative: real `executeBash` does not emit this hook | TUI/RPC shell dispatch remains UNVERIFIED; observer may still record it |
| `session_info_changed` | V | I | Observer returns undefined |
| `ui_prompt_start` | V, SDK-wrapped selector | E | Pending selector observed before release; no physical TUI claim |
| `ui_prompt_end` | V, SDK-wrapped selector | E | Start/end ordering and handled-input no-provider control; no physical TUI claim |
| `before_provider_headers` | V, faux only | I | No real HTTP/credential assertion |
| `before_provider_request` — REMOVED from declaration | Not proven | E negative: actual faux request has no serialized-payload hook | Official faux stream invokes response callbacks but not a payload callback; real provider serialization remains UNVERIFIED |
| `after_provider_response` | V, faux only | I | No real HTTP response assertion |
| `cache_warming_decision` | V, synthetic faux cache metadata | E | Real SDK scheduler; 11-second synthetic TTL, fake prices, stop override, one actual faux request and no refresh; real provider economics UNVERIFIED |
| `resources_discover` | V | I | Observer does not supply resources |
| `inject-context` (only declared action) | V, scoped | D and full pipeline chain | Foreign/duplicate/source/branch/session/age/carry/count/text refusal; later transformer may drop output |

`steer` and `block-tool-call` are **not declared actions**. `Pi single declared action excludes steer and block-tool-call` proves support checking refuses them. Observing user steering does not implement either action. F4 removes `user_bash` and `before_provider_request` from `piHostCapabilities.events` (**BREAKING** for modules requiring those declarations). The exact 36-event proven set is asserted in `real-sdk-capabilities.test.ts`; the observer/attachment may still record the larger diagnostic vocabulary. No actions were added: `inject-context` remains the only declared action.

## Incremental synchronous hook overhead observations

Command: `bun hosts/pi/test/hooks-overhead.ts`. **100 paired repetitions**, five warmup repetitions discarded; each repetition is an actual faux tool turn plus final response. Alternating enabled/disabled order; fixed faux chunks; enabled observer uses `tailMessages=2`. Each registered synchronous observer callback is timed until its return, with no awaited work in that interval. A matched registered no-op callback is the disabled control. Samples are paired by event occurrence; p50/p95 are nearest-rank quantiles of enabled-minus-disabled durations, not differences of two independently computed quantiles. Hook dispatch machinery, fixture raw capture, core selection, attach/report callbacks and provider serialization are outside this measurement. These latter costs remain UNVERIFIED, not silently included.

| Hook | Samples per side | Increment p50 ms | Increment p95 ms |
|---|---:|---:|---:|
| after_provider_response | 200 | 0.1660 | 0.3883 |
| agent_before_settle | 100 | 0.1897 | 0.3312 |
| agent_end | 100 | 0.2372 | 0.4239 |
| agent_settled | 100 | 0.2003 | 0.4444 |
| agent_start | 100 | 0.1921 | 0.3915 |
| before_agent_start | 100 | 0.2030 | 0.3916 |
| before_provider_headers | 200 | 0.2045 | 0.3661 |
| context | 200 | 0.2725 | 0.4712 |
| context_with_system | 200 | 0.2290 | 0.4442 |
| input | 100 | 0.2972 | 0.7052 |
| message_end | 400 | 0.1797 | 0.4574 |
| message_start | 400 | 0.2016 | 0.4519 |
| message_update | 600 | 0.2201 | 2.8139 |
| tool_call | 100 | 0.2054 | 0.4694 |
| tool_execution_end | 100 | 0.1843 | 0.3959 |
| tool_execution_start | 100 | 0.2023 | 0.4491 |
| tool_execution_update | 100 | 0.1860 | 0.3901 |
| tool_result | 100 | 0.1843 | 0.3455 |
| turn_end | 200 | 0.2094 | 0.4066 |
| turn_start | 200 | 0.1890 | 0.3817 |

Separately observed enabled **prompt-plus-observer-idle wall** p50 **43.4076 ms**, p95 **70.1224 ms**; includes synchronous work and SDK/faux streaming, and is not asynchronous-only latency or a real model latency. Zero fetch attempts. Startup/shutdown/tree/compaction/UI/unsupported hooks lack N=100 overhead samples. Machine variability, growing session projection, GC and ring eviction are not controlled; no acceptance threshold is inferred.

## Implemented fixes

Changes below are approved option-A fixes; historical findings/proposals below describe the pre-fix review. P1 deltas 4, 5, 10, 11 and R7 persistence remain out of scope.

| Finding | Commit (subject uniquely identifies commit) | Tests / API |
|---|---|---|
| F1 | `c3e4e61` — `fix(pi): F1 - retain late-worker origin scope` | Flipped tree-navigation finding into refusal; same-branch full-path control and immutable/foreign origin probe. Added `ParentReportOrigin`, `ParentReportEnqueueMeta`, `captureOrigin()` and optional enqueue origin metadata. Capture before async dispatch; direct enqueue remains immediate-only. No core runtime change. |
| F2 | `c84b0df` — `fix(pi): F2 - guard selected source dependencies` | Flipped canonical-source finding to refusal; full-path dependency identity assertion; SDK post-enqueue replace/omit, unrelated-edit and ambiguous-source controls; four resolver/immutability unit probes in `report-origin.test.ts`. `captureOrigin(dependencies)` copies/freezes selected IDs/versions; new optional `sourceVersion` option must be the mailbox's live resolver. A missing, throwing or mismatched resolver refuses captured dependencies before enqueue. Mailbox rechecks at hook boundary. |
| F3 | `80493a2` — `fix(pi): F3 - label hook-boundary delivery receipts` | Flipped later-strip finding to exact `kind: 'hook-boundary'` assertion and two-request `[1, 0]` hook consumption proof; provider captures remain empty of stripped material. Positive full pipeline asserts receipt kind separately from actual faux input. **BREAKING for receipt producers:** exported `ReportDeliveryReceipt` now requires `kind: 'hook-boundary'`; existing `status` and `boundary` stay unchanged. No added/removed exports. |
| F4 | `fix(pi): F4 - declare only SDK-proven events` | Added real-SDK fork, cancelled-compaction, UI start/end and cache-scheduler probes; actual shell/faux request negatives justify removing two unproven declarations. Added exact declared-list assertion. No `FINDING:` capability test existed to flip. Added F2 unit test to the test tsconfig include list so it is also compiler-checked. No unrelated existing test changes. |

F4 final local verification (verbatim summary from `bun run test`):

```text
 301 pass
 0 fail
 1927 expect() calls
Ran 301 tests across 33 files. [5.09s]
```

All four compilers were run after the F4 changes (verbatim wrapper summaries; compiler output was empty):

```text
packages/core tsc: exit 0 (no diagnostics)
hosts/pi tsc: exit 0 (no diagnostics)
examples/p1 tsc: exit 0 (no diagnostics)
hosts/pi/test tsc: exit 0 (no diagnostics)
```

A hook-boundary receipt acknowledges only the adapter's returned `context_with_system` messages. It is not provider-observed, wire delivery, or persistence; no provider-observed receipt API is implemented. Later extensions may remove the material, and the adapter does not retry an already consumed item. Exactly-once applies at the hook boundary. Independently captured faux transcripts are separate qualification evidence.

F3 local verification: `bun run test` — 295 pass, 0 fail, 1885 assertions, 32 files; all four tsc commands exited 0 with no diagnostics. Pre-existing `packages/core/test/p1-report-receipts.test.ts` exact expected object minimally gains `kind: 'hook-boundary'` because the receipt shape intentionally changed. The existing positive pipeline test gains a kind assertion.

The test-owned composition binds selected user-text material IDs to unique native projection entries; the resolver reads `buildSessionProjection().entries` on every check and compares the actual projected source contribution. Ambiguous/unavailable bindings fail closed. This fixture proves canonical user-text edits, not a shipped generic native-source mapper for all material kinds. Production callers must supply equally live source ownership. No constant-version source resolver is used in this composition.

F2 local verification: `bun run test` — 295 pass, 0 fail, 1881 assertions, 32 files; all four tsc commands exited 0 with no diagnostics. The existing positive pipeline test gained exact dependency assertions; no unrelated pre-existing test changed.

F1 local verification: `bun run test` — 287 pass, 0 fail, 1842 assertions, 31 files. All four reproduction tsc commands exited 0 with no diagnostics. No unrelated pre-existing test changed.

## Historical findings and proposed minimal deltas

### F1 — Late worker result loses branch origin

- **Problem:** `real-sdk-pipeline.test.ts`, `FINDING: late worker report after tree change...` finishes a worker after actual tree navigation. The default sink enqueues the report against the current branch and the next provider input receives old-branch advice. Pre-worker selection checks and already-enqueued mailbox invalidation do not protect this interval.
- **Smallest proposed change:** capture immutable host origin scope at worker handoff, require that scope on enqueue and reject when it no longer matches; do not infer origin from enqueue-time state. Thread an additive scope/lease through the test-owned composition/public report-delivery boundary rather than adding a host-specific rule to core selection.
- **Files to review on approval:** `hosts/pi/src/report-delivery.ts`, host composition caller, and only if required the core trigger/report metadata contract in `packages/core/src/engine/monitoring-engine-runtime.ts`.
- **Compatibility:** optional metadata alone preserves old behavior but cannot qualify unconditional freshness; requiring it for qualified delivery is an intentional opt-in/validation compatibility decision. Related P1 delta 5 is still unapproved.
- **Proving test:** keep the existing FINDING test; after approval add a separate expected-refusal test with the origin-bearing path, plus a same-branch positive control.
- **Risk/blocker:** branch numbering is adapter-local; avoid accepting fabricated branch IDs or invalidating legitimate same-turn work. Blocks P3 complete stale-result qualification and P5/P6 live use; revisit P7 integration.

### F2 — Late worker reports have no automatic source dependencies

- **Problem:** `real-sdk-late-worker.test.ts`, `FINDING: late worker report after canonical source edit...` demonstrates an actual context edit while a worker is blocked. The next provider input has the replacement source but also receives the old-source report; delivered dependency list is empty.
- **Smallest proposed change:** preserve exact selected evidence dependency IDs/versions and their live resolver through host handoff into `enqueue` metadata, with a guard before publication; refuse when dependency information is required but unavailable. Mailbox already rejects supplied stale dependencies, so do not add a generic condition DSL or redesign it.
- **Files to review on approval:** host composition caller, `hosts/pi/src/report-delivery.ts`; core runtime metadata only if needed for a public carrier.
- **Compatibility:** additive propagation can serve existing callers; qualifying source freshness may require a stricter delivery mode. Source IDs must resolve to actual current host material, not a constant test version.
- **Proving test:** preserve current FINDING test; add an origin/dependency-aware refusal probe alongside the existing queued-source refusal and unchanged-source positive input.
- **Risk/blocker:** canonical edits and provisional/final source IDs must not be confused. Blocks P3 stale-source exit and P5/P6; overlaps, does not implement, the unapproved P1 lifecycle proposal.

### F3 — Hook receipt is not a final provider receipt

- **Problem:** `real-sdk-boundaries.test.ts`, `FINDING: hook-delivered receipt does not prove provider receipt...` registers a later context transformer that drops the report. Delivery list says hook-delivered; actual faux input lacks it. This matches the source comment and receipt boundary, rather than contradicting a promised provider acknowledgement.
- **Smallest proposed change:** none to current receipt semantics. Require a final host-owned provider-input capture/check in qualification or consumer diagnostics; label hook receipt explicitly in integration documentation. Any new provider-acknowledged receipt would be a separate contract approval, not a rename of existing success.
- **Files if approved:** consumer qualification/diagnostics and Pi report-delivery documentation; SDK-bound integration only if adding a final capture API is separately approved.
- **Compatibility:** retain existing `boundary: context_with_system`; do not promote it to wire delivery.
- **Proving test:** current FINDING plus positive no-later-transform full path already run.
- **Risk/blocker:** extension ordering outside adapter control; blocks P7 claims of unconditional provider receipt, not the scoped positive P3 trace.

### F4 — Declared vocabulary exceeds this qualification

- **Problem:** seven capability rows above lack real positive evidence; no source capability list was silently narrowed.
- **Proposal:** either add isolated real SDK tests for each event, or obtain approval to narrow the qualified capability set; keep unsupported rows explicit meanwhile.
- **Files:** additional `hosts/pi/test` fixtures; `hosts/pi/src/attach.ts` only with separate approval if changing declared events.
- **Compatibility/risk:** narrowing declarations may reject modules that currently start; fake emits alone would not prove SDK lifecycle behavior.
- **Proving test/blocker:** event-specific positive/negative SDK cases; blocks full P3 capability exit and P7 version claims.

## Dependency / lock review

`bun.lock` adds **121 package records** (including nested duplicate-resolution records), with no old package-record removals/updates; the workspace entry gains only the approved exact devDependency and wildcard peer. Diff: **248 added / 0 removed lock lines**. Initial add reported 240 packages installed; that is not the number of new lock records. Platform/runtime installation counts may differ. The SDK pulls provider SDKs transitively; no such provider is invoked by these tests.

Added lock keys (versions/integrities are in `bun.lock`):

```text
@anthropic-ai/sdk
@aws-sdk/client-bedrock-runtime
@aws-sdk/core
@aws-sdk/credential-provider-env
@aws-sdk/credential-provider-http
@aws-sdk/credential-provider-ini
@aws-sdk/credential-provider-login
@aws-sdk/credential-provider-node
@aws-sdk/credential-provider-process
@aws-sdk/credential-provider-sso
@aws-sdk/credential-provider-web-identity
@aws-sdk/eventstream-handler-node
@aws-sdk/middleware-eventstream
@aws-sdk/middleware-websocket
@aws-sdk/nested-clients
@aws-sdk/signature-v4-multi-region
@aws-sdk/token-providers
@aws-sdk/types
@aws-sdk/xml-builder
@aws/lambda-invoke-store
@babel/runtime
@earendil-works/pi-agent-core
@earendil-works/pi-ai
@earendil-works/pi-codemode
@earendil-works/pi-coding-agent
@earendil-works/pi-mcp
@earendil-works/pi-schema
@earendil-works/pi-telemetry
@earendil-works/pi-tui
@google/genai
@isaacs/nonrecursive-glob-match
@protobufjs/aspromise
@protobufjs/base64
@protobufjs/codegen
@protobufjs/eventemitter
@protobufjs/fetch
@protobufjs/float
@protobufjs/path
@protobufjs/pool
@protobufjs/utf8
@silvia-odwyer/photon-node
@smithy/core
@smithy/credential-provider-imds
@smithy/fetch-http-handler
@smithy/node-http-handler
@smithy/signature-v4
@smithy/types
@stablelib/base64
@types/retry
agent-base
balanced-match
base64-js
bignumber.js
bowser
brace-expansion
buffer-equal-constant-time
chalk
cross-spawn
data-uri-to-buffer
debug
diff
ecdsa-sig-formatter
extend
fast-sha256
fetch-blob
formdata-polyfill
gaxios
gcp-metadata
get-east-asian-width
google-auth-library
google-logging-utils
graceful-fs
grok-mermaid
highlight.js
hosted-git-info
http-proxy-agent
https-proxy-agent
ignore
isexe
jiti
json-bigint
json-schema-to-ts
jwa
jws
long
lru-cache
marked
marked-cjk-friendly
minimatch
ms
node-domexception
node-fetch
openai
p-retry
partial-json
path-key
proper-lockfile
protobufjs
proxy-agent-negotiate
quickjs-wasi
retry
safe-buffer
semver
shebang-command
shebang-regex
signal-exit
standardwebhooks
ts-algebra
tslib
undici
web-streams-polyfill
which
ws
yaml
@aws-sdk/credential-provider-http/@smithy/node-http-handler
@aws-sdk/credential-provider-sso/@aws-sdk/token-providers
@aws-sdk/nested-clients/@smithy/node-http-handler
@earendil-works/pi-coding-agent/typebox
gaxios/https-proxy-agent
p-retry/retry
gaxios/https-proxy-agent/agent-base
```

## Verification receipts

Local full intended suite, before candidate commit:

```text
286 pass
0 fail
1834 expect() calls
Ran 286 tests across 30 files. [4.30s]
```

Compiler commands shown above were run; summaries printed by the command wrapper:

```text
core tsc: exit 0 (no diagnostics)
Pi tsc: exit 0 (no diagnostics)
P1 examples tsc: exit 0 (no diagnostics)
P3 tests tsc: exit 0 (no diagnostics)
```

### Detached clean-checkout verification

Verified candidate **`4e6f085d5cd20e949022e53e98ec0e20b4116072`** before the final evidence-only commit. Ran `git worktree add --detach /tmp/monitoring-p3-clean-<unique> HEAD`, then the frozen install, full intended root script and all four compiler commands inside that new checkout. The checkout had no pre-existing node_modules. The worktree was removed after completion; `git status --short` there printed nothing after the checks. The final follow-up changes only this receipt document.

Frozen install summary (verbatim):

```text
bun install v1.3.14 (0d9b296a)

+ @types/bun@1.4.4
+ typescript@7.0.2

256 packages installed [982.00ms]
```

Clean-checkout test summary (verbatim):

```text
 286 pass
 0 fail
 1834 expect() calls
Ran 286 tests across 30 files. [3.74s]
```

Clean-checkout compiler wrapper summaries (verbatim; compiler stdout itself was empty):

```text
core tsc: exit 0 (no diagnostics)
Pi tsc: exit 0 (no diagnostics)
P1 examples tsc: exit 0 (no diagnostics)
P3 tests tsc: exit 0 (no diagnostics)
```

All commands exited zero. No lockfile changes were needed by the frozen install. No GitHub writes, push, live model invocation or runtime source edits were part of this verification.

## Remaining UNVERIFIED / unsupported

- Pending-protection migration is complete as described above; this does not close the remaining limitations below.
- Unconditional freshness for unscoped async callers or arbitrary material kinds: async callers must capture origin/dependencies before dispatch and use a live native-source resolver. The tested composition binds unique canonical user-text entries; it fails closed for ambiguous bindings. No generic native-source mapper or turnkey runtime is shipped.
- TUI/RPC `user_bash` and real provider serialization remain UNVERIFIED and undeclared. Physical TUI UI, non-cancellation compaction failures and real provider cache economics remain UNVERIFIED. Selector and synthetic-faux cache-scheduler lifecycle are now proven.
- Complete synchronous attach/report/core overhead, N-repeated lifecycle overhead, async-only latency, memory and semantic/cost acceptance.
- A shipped turnkey Pi scheduler/worker integration; explicit test-owned handoff is not product registration.
- Cross-version/platform compatibility, crash/restart durability, effectful module acceptance, paid/live models and production use.
- No push or GitHub writes were performed. No dependencies were added by F1–F4. No paid model calls or R7 persistence implementation. Earlier verification receipts above are historical; each fix's local results are recorded in Implemented fixes, with final clean-checkout results reported separately.
