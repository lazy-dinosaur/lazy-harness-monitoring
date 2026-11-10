# Remaining Pi protection migration — issue #1

Baseline: `05270a1` (R7 included), branch `feat/pending-pi-tests`.

All five original files (1,224 lines) were read in full before editing. They are now active as `hosts/pi/test/monitoring-core*.test.ts`, imported through the existing public `@lazy-harness/monitoring-core/engine/*` subpath exports and Pi `src/index.ts`. The table below enumerates every original test-title protection group, including every loop/`test.each` variant. Unless explicitly identified below, no assertion was dropped or relaxed. Additional strict typing asserts native entries exist, and SDK proof-count checks are unconditional.

The four SDK-bearing suites use `hosts/pi/test/support/real-sdk.ts` via `support/pending-fixtures.ts`; SDK resolution is mandatory, never a describe-skip fallback. SDK 1.5.0 is the existing exact dev dependency. All sessions use its official faux provider, disabled network model runtime and throwing fetch guards. Scripted classifier backends are in-memory functions, not inference. The only shared fixture change is an optional tool gate, so selection can be observed before a real SDK tool settles. No runtime source, dependency, lockfile, contract, capability declaration or other worktree was changed by this migration.

## Disposition rules

- **Restore** means the same executable guard against the existing public export, not a claim that a synthetic handler is a shipped business module. The recreated candidate/reference/audit processors and independent in-memory sink are test-owned probes; actual engine decisions, checked reads, budgets, receipts and lease behavior are under test.
- **Replace** identifies a removed Pi-specific tap or private example API. Equivalent protections run through current `attachPiFrames` and host-neutral targets; retired *sub-assertions* are listed explicitly, not silently weakened.
- **Retire** is limited to obsolete private-example output spellings/counts or absent v1 tap API behavior, with cited current tests. It does not retire safety properties on age or filename.
- No new current runtime defect was exposed: there are no new `FINDING:` tests or proposed runtime deltas in this batch. Existing P3 findings/limitations remain historical or open as already recorded; this migration does not close them.


## monitoring-core-observation.test.ts

| Original protection (test title; parameterized variants included) | Disposition | Active evidence / retirement reason |
|---|---|---|
| disabled by default; no processing or receipt | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| selected content/versions and channel views match independent receiver | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| scripted ${mode} never sends semantic proposals | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| wrong receiver ${bad} cannot count as recorded | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| duplicate settlement has no repeat effects; conflicting reuse is visible | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| gapped/reordered bounded history is explicit deferred, never silent partial context | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| projection edit/superseded binding are deferred rather than replayed in new context | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| unavailable settlement and source-count/material-byte budgets do not leak partial data | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| cancelled/uncooperative receiver retains core physical slot and has no late recorded ack | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| one module failure leaves other receiver results intact | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| lifetime budget and disposal are explicit; counters do not reset | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| reference/frame limits are bounded before copying or accepting input | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| logical receiver timeout is not a delivery and preserves physical concurrency | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| real pre-persist source survives stale diagnostic jobs and exact selected material is received | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| real tool streams/error are each routed once with native source links | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| real queued steer inputs remain distinct and ordered through final settlement | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| real receiver mismatch is not recorded even though target physically observed material | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| real bounded ring overflow is visible defer with zero partial delivery | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| real session replacement cancels old receiver without blocking new foreground work | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| real ${transition} invalidates in-flight target and refreshes next batch | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| real unavailable snapshots cannot become apparently usable material | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| opt-in tail snapshots keep long sessions observable with a bounded newest-message window (task150) | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |
| real SDK abort defers the settled run rather than delivering aborted work | Restore | `hosts/pi/test/monitoring-core-observation.test.ts`: same test title and all original assertions, using public engine exports. |

## monitoring-core-realtime-selection.test.ts

| Original protection (test title; parameterized variants included) | Disposition | Active evidence / retirement reason |
|---|---|---|
| default-off composition does not install hooks or invoke models | Replace | Same title in `monitoring-core-realtime-selection.test.ts`: v2 has no extension registration method, explicitly asserted; default disabled composition remains idle and makes zero classifier calls. Disabled host registration is also covered by `observer-protections.test.ts`: `observer disabled default...`. |
| same-frame material namespaces keep raw user/assistant text independent of event-meta | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| separate native profile routes isolate technical failure and recheck selected module grants | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| two module views are isolated and only independently selected exact bodies reach the mailbox | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| tool progress reads only explicitly admitted text, labels provisional and invalidates at final result | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| denied progress fields are not read; missing current material cannot fall back to raw event or snapshot | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| tool argument projection uses explicit field admission, never the whole input | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| assistant partial source is independent of full snapshots and superseded by final message | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| identical finalized tool copies preserve dependency versions and context steps never trim sources | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| same-version changed host content rejects; new version invalidates ready selected material | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| permission revocation after readiness or after offer invalidates the entire prepared batch | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| semantic %s remains distinct from a missing technical reply | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| malformed native replies are technical/deferred without a fabricated semantic decision | Restore + strengthen | `monitoring-core-realtime-selection.test.ts`: `classifier state excludes oracle labels; missing native answers are technical uncertainty`; same zero-packet, router-failure and absent-semantic-mode assertions, plus explicit no `expected` label in model-facing state. |
| run with no selected current reference cannot produce a usable packet | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| worker/JSON judge, missing route, ungranted source kinds and unknown watch contracts reject | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| classifier profile identity is admitted by role/protocol, not a product-name whitelist | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| limits/gaps are explicit unavailable states, never silently truncated useful text | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| host-owned explicit intent change clears the window with A without resetting lifetime budgets | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| new intent clears transient material instead of forming a cross-epoch cache | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| nested model timeout never hides raw physical work from the A slot | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| source-window scope/control and tap order are explicit and bounded | Replace | `monitoring-core-realtime-selection.test.ts`: `source-window scope/control and explicit attachment are bounded` preserves frame eviction, unavailable old snapshot, tree clearing, missing initial frame stopping the window and exactly-once unsubscribe count through `attachPiFrames`. |
| native tool progress text is captured separately from unchanged observer and selected while tool is running | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| assistant final content reaches a non-user watch without whole-context or provider injection | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| real tool-result selection crosses next context and identical finalized copies without false staleness | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |
| native steer replaces transient context and cancels old classifier work without blocking foreground | Restore | `hosts/pi/test/monitoring-core-realtime-selection.test.ts`: same test title and all original assertions, using public engine exports. |

## monitoring-core-realtime.test.ts

| Original protection (test title; parameterized variants included) | Disposition | Active evidence / retirement reason |
|---|---|---|
| default off and tap default off create no handlers/jobs; options are captured | Restore + retire v1 tap API | `monitoring-core-realtime.test.ts`: `default off creates no jobs; options are captured` preserves option capture/start/counters. `monitoring-core-realtime-selection.test.ts`: `default-off composition...` asserts no extension API, no classifier calls and idle state. Retire calling the removed default-off tap: v2 core never registers Pi hooks; host explicitly calls `attachPiFrames`. Disabled host registration remains in `observer-protections.test.ts`: `observer disabled default...`. |
| invalid timeout %s rejects | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| context cannot be configured to start preparation; unknown/duplicate event or missing port rejects | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| dispatch starts before settlement and survives context/with-system and changing diagnostic hashes | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| input cancels old intent even when its content is unavailable | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| cancel before preparation microtask prevents host work from starting | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| %s invalidates watch generation without rewriting observer contracts | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| %s stops the scope and cannot reset budgets by restarting | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| same-epoch source edit discards active or ready preparation | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| permission revocation is checked again at handoff and after offer | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| missing dependencies, source-check exceptions and denied preparation fail closed | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| additional output dependencies cannot erase initial dependencies or invent fresh versions | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| normal agent settlement allows module preparation to finish; context candidates remain pending | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| unavailable context cannot consume a candidate and does not cancel valid preparation | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| explicit abort clears candidates and source gaps/conflicting identities stop admission | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| foreign session/binding and malformed/accessor frames fail closed without invoking getters | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| timeout retains physical slot until raw work settles; queued work does not overlap it | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| bounded queue coalesces queued stream updates by source metadata and records overflow | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| lifetime job/event budgets, mailbox size and trace retention stay bounded | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| unavailable/oversize signals, malformed outputs and preparation failures never become usable data | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| tap validates registration order, fresh frame per hook and owns all unsubscribe attempts | Replace + retire v1 tap API | `monitoring-core-realtime.test.ts`: `attachPiFrames fails closed without a fresh frame and attempts every unsubscribe once` checks all hook registrations, missing-source stop, idempotent cleanup and all unsubscribe attempts even after one throws. Retire second tap-extension registration throwing and tap-dispose throwing/disposing the coordinator: that wrapper no longer exists. Current attach intentionally swallows unsubscribe errors and returns only a detach function; test explicitly disposes the target. Actual ordered/fresh delivery is additionally asserted by every restored SDK suite's reconciliation. |
| streaming tool progress dispatches before settled and late module preparation survives normal completion | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| tool-result preparation survives the next real SDK context and whole-projection changes | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| prepared context handoff occurs at the next context without automatic injection or duplicate offers | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |
| actual streaming user steer advances intent and invalidates old work without waiting for it | Restore | `hosts/pi/test/monitoring-core-realtime.test.ts`: same test title and all original assertions, using public engine exports. |

## monitoring-core-trigger.test.ts

| Original protection (test title; parameterized variants included) | Disposition | Active evidence / retirement reason |
|---|---|---|
| default stopped; no action until explicit start | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| registration cannot widen kind/destination/processor grants or duplicate route | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| tampered body, wrong processor and false source link cannot execute | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| execution ${bad} is not manufactured into successful action | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| concurrent duplicate and reentrant replay invoke trusted handler only once | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| unregister invalidates in-flight work and old disposer cannot remove replacement | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| stop/start does not reset idempotency or lifetime budgets | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| active/input/handler limits reject without an unbounded target queue | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| handler exception is visible and bounded execution records expose evictions | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| real scripted ${mode} reconciles source, two modules and actual memory effects | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| real third registered module handles canonical tool result without core feature branches | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| real end-to-end replay has no duplicate effects or repeated handler executions | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| real handler failure is isolated from another module effect | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| real physical effect with mismatched result is not falsely acknowledged as executed | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| real ${transition} invalidates blocked test commits, then new scope succeeds | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| real core deadline keeps physical test-handler slots until raw settlement | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |
| real SDK abort cannot trigger aborted test work | Restore | `hosts/pi/test/monitoring-core-trigger.test.ts`: same test title and all original assertions, using public engine exports. |

## monitoring-core.test.ts

| Original protection (test title; parameterized variants included) | Disposition | Active evidence / retirement reason |
|---|---|---|
| is explicit-start, grant-limited and rejects duplicate registration | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| deduplicates identical inputs and rejects identity conflicts/out-of-order events | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| skip and defer do not call handlers or sinks | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| missing or fabricated judgement evidence is deferred, never treated as no work | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| a third observer registers without changing core logic and runs despite judge failure | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| isolates one handler failure from another module | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| enforces physical concurrency across module execution | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| context changes discard a late result without recording it | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| stop and unregister prevent late proposal delivery | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| time-bounds logical work but keeps the slot until an ignored abort actually settles | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| a receipt must identify the actual request and recorded proposal | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| validates all proposal grants before delivering any proposal | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| requires granted reads and rejects changed source versions | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| does not reset judgement budgets on stop/start | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| keeps views immutable and protects event identity from module output | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| rejects silently coerced JSON payloads before any proposal is delivered | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| rejects changed source contents even if a reader reuses the version | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| core capacity: event and execution limits are checked before extra work | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| core capacity: reference reads are bounded before further port access | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| core capacity: queue overflow and queued deadlines do not release a hung physical slot | Restore | `hosts/pi/test/monitoring-core.test.ts`: same test title and all original assertions, using public engine exports. |
| replays needed, unneeded and ambiguous cases through the same core (not a model-accuracy claim) | Retire private scenario spellings; replace protections | The absent private v1 scenario runner's exact three output-kind counts, fixture text and team-rule ID are not a v2 example API. `packages/core/test/p1-scenarios.test.ts`: `A exact reference selection excludes unrelated catalog entries`, `A scripted %s yields no job/report`, `C separately opted-in shadow prepares one private candidate per subject; no parent injection` verify current declared example outputs/selection. Restored `monitoring-core-observation.test.ts`: `selected content/versions and channel views match independent receiver` checks exact source quote/reference body/version and excludes unrelated/restricted content; `monitoring-core.test.ts`: `a third observer registers...` checks independent unconditional audit execution. No semantic classifier accuracy claim. |
| does not expose gold labels in classifier state and treats missing answers as uncertainty | Replace; retire v1 fabricated defer | `monitoring-core-realtime-selection.test.ts`: `classifier state excludes oracle labels; missing native answers are technical uncertainty` checks actual public selection state, zero packets, technical failure and undefined semantic mode. Private `createClassifierJudge` no longer exists; its conversion of missing replies into semantic defer is obsolete. The new test asserts no fabricated decision, while restored `monitoring-core.test.ts`: `missing or fabricated judgement evidence is deferred, never treated as no work` preserves the lower-level core guard. |

## Findings, deltas and evidence boundaries

No new runtime findings or runtime changes. Removed tap-wrapper lifecycle/error behavior is an intentional API retirement, not a hidden failing safety assertion. Scoped leases, raw physical-slot retention, replay, grants, source/reference integrity, receiver/effect receipt validation, every original budget group and module isolation are exercised by the active suites above. Logical cancellation is not proof that an external physical effect was undone; the synthetic registry tests distinguish actual in-memory effects from verified receipts, including mismatched-result uncertainty.

The evidence remains **SDK 1.5.0 faux-provider / finite synthetic composition only**. No new event/action capability is declared. No live model, business effect, paid inference, turnkey scheduler, cross-version/platform guarantee or contract acceptance is claimed. See the P3 document for prior findings and remaining UNVERIFIED scope.
