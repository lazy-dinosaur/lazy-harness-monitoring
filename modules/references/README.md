# References module

Private workspace package: `@lazy-harness/monitoring-module-references`.
Only dependency: the public exports of `@lazy-harness/monitoring-core`.
No automatic activation, file discovery, registry loading, model implementation or host hooks.

## Purpose and API

`context.references` is a **gap filler**: select every visible project document needed by the current request, then suggest only documents the parent has not read since compaction. Short follow-ups count; plain commands without project facts skip; unclear targets or missing coverage defer. Documents are data, not instructions.

Exports from the package root:

- `REFERENCES_MODULE_ID`: `context.references`.
- `referencesQuestion`: active broad purpose, unchanged from source version `2.1.1`.
- `referencesQuestionNarrow`: comparison-only immediate scoped-lookup question. Not used by the declaration. Extracted verbatim from the old `createContextReferences().question`; the old example processor, classifier adapter, sinks and scenario runner are deliberately **not** dependencies or exports. Those v1 proposal mechanics are replaced by core selection and v2 jobs.
- `referencesDeclaration`: validated/frozen purpose, raw `input` watch, four message-history turns, `user-text`/`conversation-history`/`knowledge`, `session.read-records` and `region.compact` needs, one read-only per-event `deliver` template. Default report is `always`; `never` and `on-result` also supported.
- `referencesBinding`: version `2.1.1`, declaration hash, grants, `parent.context` destination and empty-object-only settings factory. Uses core declaration/JSON validation directly instead of importing the schema library. Its processor is selection metadata; call the job runtime for delivery, not the legacy empty `run` method.
- `createReferencesRegistration(options?)`: official fully formed runtime registration (module ID, validated declaration/hash, effective jobs and **explicit stage**). Defaults to `observe`: no job execution, effects or reports. `ReferencesRegistrationOptions` accepts `stage` (`off`, `observe`, `shadow`, `active`) and an optional tightened declaration `maxStage` (`observe`, `shadow`, `active`). A selected stage above the ceiling, or an unknown stage/ceiling, is rejected. Without a tightened ceiling, the shipped declaration/hash are unchanged and its ceiling is `active`.
- `AlreadyRead`: host callback `(trigger: { sessionId; eventId }) => ReadonlySet<string>`.
- `createReferencesHandlers(alreadyRead?)`: handler map keyed by `context.references.deliver`.
- `referencesHandlers`: stateless fallback map (no read filter).

Delivery quotes only selected `knowledge` evidence, verbatim with ID/version. No documents or all documents already read returns `rejected`, without report. Prepared output has `deliveredIds` and `droppedAlreadyRead`; it is a candidate, never a write/approval.

## Host wiring and ownership

1. Register the binding explicitly and call core `prepareMonitoringBindings` (or configured-core construction) with host capabilities and a scripted or separately authorized judge. Missing `input` support is rejected at startup. The handoff action `monitoring.selected-material` is engine-owned, not a host injection grant.
2. Supply a versioned, host-admitted document catalog and bounded current-request/history material to `createRealtimeSelectionPipeline`; use `watchModuleFromDeclaration` for the bridge. Frame admission belongs to core `parseObservationFrame`/pipeline `accept`, not this template.
3. Consumers **must use `createReferencesRegistration()`** for `MonitoringModuleRuntime.modules`, rather than hand-building a registration with an omitted stage. Delivery requires an explicit **`createReferencesRegistration({ stage: 'active' })` opt-in**. Pass `createReferencesHandlers(hostAlreadyRead)` through core `createHandlerWorkerPort` / `WorkerExecutionPort` with the registration and budget gate. `observe` does not run jobs; `shadow` runs the read-only template but withholds reports. No hidden provider or worker selection exists.
4. Host owns read provenance, session isolation, bounds and reset. Return a read-set snapshot; clear on successful compaction and session replacement. A read ID suppresses every version until reset (legacy semantics). **Prepared, enqueued and hook-delivered are not actual-read observations** and never update the read set here. Without the callback, no deduplication is claimed.
5. Keep each offer's freshness lease/dependencies through work and report delivery. Recheck `offer.isCurrent()` and host permission before enqueue **and at the delivery boundary**; use native source-version resolvers where required by the adapter. Runtime alone does not infer source freshness. Tests demonstrate a host sink dropping late work after document-version or user-intent changes.
6. Report sinks return matching `monitoringReportId(report)` enqueue receipts. Only `enqueued` counts as reported; failed/unknown/mismatched/absent receipts do not. A later delivery acknowledgment is `{ reportId, status: 'delivered', kind: 'hook-boundary', boundary: 'context_with_system' }`, not proof of final provider input. Host owns actual report placement, deduplication and receipts.

The raw `input` watch intentionally preserves the old declaration; it is not an assertion of user-origin filtering or finalized follow-up deduplication. Hosts must admit origins appropriately. No host read ledger, receipt sink or source resolver is silently installed by this package.

## Mechanical protection disposition

Read-only source pin: `396ae1d790bf9a52437180e4342cf17f7774752f`; designated module/example and two test files were clean at inspection. Only module/question code was migrated, never real registries, sessions, evidence or results.

| Source protection | Current test / disposition |
|---|---|
| S7 references binding validates, hashes, bridges with current material/question | `test/references.test.ts`: binding and hash checks; `test/integration.test.ts`: actual scripted bridge |
| S7 U1 selected knowledge quoted verbatim with ID/version; no document rejects/no report | Delivery test plus selected/empty scripted integration |
| U1 question <=200 characters; broad purpose and already-read need declared | Purpose test; narrow comparison text retained separately |
| U1 partial already-read removal; all-read rejection | Host ledger test, including output IDs, isolation and stateless fallback |
| Compaction reset (source callback contract, not an old assertion) | Host-owned reset test and actual `session_compact` fixture callback through the bridge |
| New current-core obligations | Unsupported capability startup, malformed own-data frames/accessors, denied permission, late source/intent reports, matching enqueue and separate synthetic hook receipts |
| S7 U6 policy registry/reminder/turn ledger; U6 reference/verifier/replay suites | **Not ported:** rule-steering/helper work is a separately scoped migration; real policy registry is forbidden fixture data |
| Old example's unrelated candidate/audit/classifier/scenario helpers | **Not ported:** only the narrow question was a references-module dependency; current core supplies the bridge/runtime |

## Offline evaluation and limits

`packages/eval` exports `createReferencesEvalModule(catalog)` and uses `createReferencesRegistration({ stage: 'active' })` and registers the exact shipped declaration/grants under `context.references`. The fixture `packages/eval/fixtures/references.ts` replays the real stateless handler using hand-scripted outputs. P4's `review.references` synthetic declaration remains distinct and its default worker path is unchanged. The registered module may use only its exact engine-owned handoff action; this is not permission for external actions. Evaluator manifests bind declaration, configuration, question, catalog and scripted outputs. Logical latency and stub costs are not measurements of a provider.

Run `bun test modules/references/test packages/eval/test/references.test.ts` and root `bun run test` / `bun run typecheck`. Tests are hand-authored invented mechanical fixtures, not semantic model judgments or P5 gold. The byte-identical replay test checks real template completion contents as well as repeated artifact bytes. No experiment artifacts are stored in Git.

**NOT qualified / UNVERIFIED:** semantic recall, selection accuracy, usefulness and all P5 thresholds; real inference; live host activation; final provider-input delivery; resource/latency/cost ceilings; crash durability; correctness of a consumer's read observation, origin policy, source permission/version resolvers or compaction reducer. Rule-steering, U6 helpers, memory and P4 evaluator migration debts remain separate. Nothing here approves production use.
