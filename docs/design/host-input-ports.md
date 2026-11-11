# Host input ports — location options and read identity

## Status and evidence boundary

**DESIGN ONLY — for approval.** No port implementation, registration, configuration entry, test, dependency change or activation is supplied here. All future contracts, behavior, limits and recommendations below are **PROPOSAL**, not existing exports. Numbered headings, source line numbers, schema names and phase IDs are identifiers, not measurements.

Source baseline: `origin/main` at `8ff99ce1e5013a15627341371334359af8ce4023`, which contains the rule-steering merge. No fallback to `origin/qualification/m-rules` was needed. Relative source links refer to that baseline.

The P5 plan is absent on this base. It was read with `git show origin/qualification/p5-plan:docs/qualification/p5-plan.md`, from branch tip `398042c0963d50e5f4b20c5aa560708388abb69b`; references to “P5 plan” below mean that version, not a file added here. Its old placeholder inventory for references/rules is historical, superseded by the source below. No external harness evidence or real data is copied.

User constraints for this design: synthetic data only; no model calls or experiment results; no Fabric dependency in any module or other repository package (D1'); omitted stage is observe, active must be explicit. Memory remains observe/shadow, without parent injection or writes until separately approved.

## What is declared and resolved today

The following is the complete inventory of `needs` in the module source on this base. `modules/memory` has only a [manifest](../../modules/memory/package.json), not a declaration. This inventory is not a list of all host services: frames, model bindings, grants, worker execution and report delivery are separate boundaries.

| Module / need ID → adapter | Source evidence | Current consumer and host data needed |
|---|---|---|
| References: `already-read` → `session.read-records` | [references source](../../modules/references/src/index.ts), lines 23–28, 62–80 | `AlreadyRead(trigger)` is injected into `createReferencesHandlers`; it returns a snapshot set of document IDs. The handler subtracts it from selected `knowledge` evidence. The callback contract assigns ledger ownership and compaction/session-reset responsibility to the host; it does not supply a concrete ledger/reset implementation here. Legacy suppression is ID-only: reading one version suppresses all versions until reset. Missing callback means stateless delivery, not admission failure. Needs actual session-scoped read observations, not inferred prepared/enqueued reports. |
| References: `region` → `region.compact` | Same declaration; [runtime mapping](../../packages/core/src/engine/monitoring-engine-runtime.ts), lines 219–227; [selection](../../packages/core/src/engine/monitoring-core-realtime-selection.ts), lines 181–203 | Bridge flag `compactRegion: true`, not a host ledger or Pi compaction hook. In a single-module pipeline with multiple eligible region items, the existing model judge selects verbatim relevant region items before the main judgement. Memo/state/omitted heads stay; a thrown compaction call retains the window region. Needs ordered bounded region material and an admitted judge binding. It can add a judge call; it does not prove a document was read. |
| Rule-steering: `rules` → `policy.registry` | [rule source](../../modules/rule-steering/src/index.ts), lines 26–33, 52–71 | Host supplies an explicitly admitted versioned `PolicyRegistry` to `policyReferences`, then wires resulting `policy` references into material input. Projection validates registry/policy fields and constructs versioned references. There is no default filesystem registry or automatic registry lookup. Data needed: authoritative registry identity/revision, policy identity/revision/body, scope and exceptions, admission permission. |
| Rule-steering: `view` → `judge.view` | Same declaration; [runtime mapping](../../packages/core/src/engine/monitoring-engine-runtime.ts), lines 219–227; [selection](../../packages/core/src/engine/monitoring-core-realtime-selection.ts), lines 97–115; [rule handler](../../modules/rule-steering/src/index.ts), lines 72–111 | Bridge flag `includeJudgeView: true` carries the exact judge view in the selection packet. Composition must forward it as `Trigger.view`; the module validates current-event IDs and selected rule version/content before invoking its injected verifier. Needs the admitted current-event view, source revisions and verifier/budget wiring, not Fabric. |

### Resolution path and gaps (observed source behavior)

- [Declaration schema/validation](../../packages/core/src/sdk/declaration.ts), lines 35–46, 56–80: `needs` is an optional array of symbolic `{id, adapter}` pairs, bounded to 8 entries, with unique need IDs. It does not validate an adapter against an implementation registry or specify freshness, required/optional status or data schemas.
- [Host contract](../../packages/core/src/host/contract.ts), lines 8–39: `HostCapabilities` describes events, actions and snapshot depth. `hostSupportIssues` checks resolved watch events and actions, not needs.
- [Configured preflight](../../packages/core/src/sdk/bindings.ts), lines 26–35, 40–84: `MonitoringHostBindings` supplies modules/judges/scopes/ceilings/capabilities. Preflight checks these and effective jobs/watches/stages before factories. There is no host-input-port registry here. Passing capability preflight is not proof every declared need is bound.
- [Bridge mapping](../../packages/core/src/engine/monitoring-engine-runtime.ts), lines 219–227, recognizes the adapter strings `region.compact` and `judge.view` as flags. It does not resolve `session.read-records` or `policy.registry`. Those remain explicit composition responsibilities via the module APIs above.
- [Pi public entry](../../hosts/pi/src/index.ts) exports observer, frame attach and report delivery. [Observer](../../hosts/pi/src/observer.ts), lines 6–9, 35–76, 105–169, obtains session/leaf/branch/projection, bounds snapshots, invalidates asynchronous diagnostic work and emits frames. [Attach](../../hosts/pi/src/attach.ts), lines 8–35, advertises events plus `inject-context` and forwards current frames. Neither implements `AlreadyRead` or a harness registry reader.
- [Pi report delivery](../../hosts/pi/src/report-delivery.ts), lines 20–42, 54–72, captures scope/source dependencies and distinguishes enqueue from hook-boundary delivery. Neither receipt proves independent provider input or a document read. Do not feed enqueue acceptance into the read ledger.
- [Stage semantics](../../packages/core/src/sdk/declaration.ts), lines 102–114, and [runtime](../../packages/core/src/engine/monitoring-engine-runtime.ts), lines 155–162: omitted stage selects observe; shadow runs read-only jobs and withholds reports. Declared ceilings still constrain selection. A need string itself grants nothing.

## PROPOSAL — where the Pi implementation lives

All options keep modules host-neutral and dependent on public core/module contracts only. “Pi SDK only” below excludes Fabric; existing Node/core utilities are not excluded. D1' is established in [README](../../README.md#worker-and-runtime-boundary-d1) and [qualification decisions](../qualification/README.md#confirmed-decisions-user-2026-11-09).

| Option | Ownership / required data | Pros | Cons / boundary fit |
|---|---|---|---|
| **A — implementation in `hosts/pi` here** | Pi adapter owns session lifecycle and read ledger ingestion/projection. Composition passes explicit document-read records with session, document/version and source event; a truly Pi-native read source could be consumed directly if proven. | Matches README's host-adapter input-port ownership; reusable by Pi consumers; SDK fixture work stays adjacent. | Pi hooks alone do not establish harness document identity or successful reads. Importing `.lazy-harness` loaders or assuming every tool result is a read would couple the adapter to one consumer. Generic callbacks are necessary if the source is harness-owned; otherwise this option drifts into C. No Fabric belongs here. |
| **B — implementation in lazy-harness composition repository** | Composition owns both Pi lifecycle translation and its read-record/catalog/policy sources; modules receive neutral callbacks/material. Needs explicit Pi/session bindings and harness read metadata, not ambient filesystem discovery. | Closest to actual read evidence and consent; can evolve harness-specific provenance without embedding it here; no new repository implementation needed initially. | Duplicates Pi lifecycle logic, weakens reuse by other hosts/consumers, and puts conformance drift downstream. Fits D1' only if modules never import the composition layer or Fabric. Less aligned with README's stated generic Pi-adapter ownership. |
| **C — split ownership (recommended)** | Core owns neutral versioned input-port envelopes, validation and fake-backed conformance. `hosts/pi` owns Pi hook→session/branch/compaction generations and generic projection. Lazy-harness owns admitted read records, catalog/version resolver, policy provenance and consent. Composition explicitly connects them. | One shared safety vocabulary; reusable Pi lifecycle; no harness paths in Pi/core; source-specific authority stays at source. Mirrors the existing neutral worker boundary without mirroring Fabric APIs. | More interfaces and compatibility decisions; startup need checking and provenance sidecars require separately approved implementation. Must distinguish port protocol version from source-document version. No existing resolver can be claimed to do this today. |

**PROPOSAL recommendation:** choose C. Keep the existing `AlreadyRead` API unchanged until a separately approved migration; design the richer port next to host-neutral contracts and provide an explicit legacy adapter. Do not move rule registry loading into core, and do not turn `region.compact` into a Pi session-compaction API. The engine's model input reduction and the host's context reset are different operations.

## PROPOSAL — version-aware read-record port (not an exported API)

### Meaning of a read

A read is a host-attested successful exposure of an admitted document revision to the parent agent at an identified source event. It is not human comprehension, a selected reference, a worker completion, a tool call merely attempted, or enqueue acceptance. The source must describe full versus partial exposure; partial or unknown coverage does not suppress a whole document by default.

**PROPOSAL logical fields:**

| Envelope | Fields and meaning |
|---|---|
| Request | Protocol version; session ID; host binding and branch generation; compaction generation; trigger event ID/cursor; requested document IDs/versions; current source/grant revision; cancellation signal. |
| Read identity | `(sessionId, branchGeneration, compactionGeneration, documentId, documentVersion, sourceEventId)`. A content hash may be the version only if the source explicitly defines it that way. Source event includes host/source identity and cursor; IDs alone are not authority. |
| Record | Read identity; document namespace; source record ID/revision; exposure kind and coverage; host attestation reference; observation time for diagnostics. No document bodies are required by this port. |
| Snapshot | Matching request scope; snapshot revision; `completeThroughCursor`; admitted source/grant revision; immutable bounded records; status `available`, `unavailable` or `stale` and reason. An empty complete snapshot differs from unavailable. |
| Lookup result | Per requested document: `already-read`, `not-read`, or `unknown`, with matching version/source-event references and scope. Unknown never means already-read. |

### Freshness and reset rules

**PROPOSAL:** suppression matches document ID **and version**, within the current session/branch/compaction generation and current admitted grant/source revision. Repeated source events are idempotent; changed bytes under the same event identity are refused. Versions are opaque: no lexical ordering or “latest” inference. A source change makes the old revision insufficient for suppressing a new one.

**PROPOSAL:** freshness is event/revision based, not a guessed time-to-live. A snapshot must be complete through the request's captured cursor and validated again before use. A later invalidation fences an in-flight response; delayed old records cannot repopulate the new generation. Clock age is diagnostic only until a separate time policy is approved.

**PROPOSAL:** successful session compaction resets read suppression even if a summary mentions the document. Before-compaction fences old requests; failed compaction leaves status unknown until current context is revalidated rather than automatically restoring the old set. Session replacement/switch/fork/tree navigation changes scope and starts an empty generation unless an explicit host proof authorizes carry. Shutdown/disposal closes it. These are proposed ledger rules, not behavior guaranteed by the existing observer's epoch invalidation.

**PROPOSAL:** unavailable, incomplete, wrong-session, stale or denied snapshots produce `unknown`. Recommended references policy is to defer delivery pending a trustworthy snapshot in the approved port-enabled composition, not silently invoke the existing stateless fallback. Missing required need binding refuses that composition before factories; this needs new preflight, not a claim about today's capabilities checker. Unknown adapters should also refuse; compatibility/optional needs require explicit declaration policy.

### Legacy compatibility and bounds

Current `AlreadyRead` takes only session/event and returns `ReadonlySet<string>`; it intentionally suppresses all revisions. **PROPOSAL:** retain that legacy policy under an explicitly named compatibility binding, with provenance/version-aware behavior opt-in and separately reviewed. Do not silently narrow a versioned result into an ID-only set without also ensuring it corresponds to the exact selected revisions and current generation. A snapshot set returned to a handler is a copy, not mutable host state.

**PROPOSAL initial bounds:** at most 4,096 read identities and 1 MiB metadata per live scope; at most 32 document lookups per request and one in-flight snapshot request per scope. These are unmeasured design caps, not inherited implementation defaults. Refuse admission on capacity, report incomplete/unknown, and defer dependent work; do not evict protection and pretend completeness. Retain metadata only for the open generation; close/reconcile requests before release. No disk backend or restart-read guarantee in the initial port.

## PROPOSAL — fake-backed conformance descriptions (not written or run)

A reusable core-owned conformance factory would accept a fake read source, fake event clock, scope controller and port factory. It must not import Pi or Fabric. Pi SDK fixture qualification remains a later separate step.

| Synthetic probe | Required assertion |
|---|---|
| Matching read / no read / missing source | Exact revision yields already-read; complete empty yields not-read; unavailable yields unknown, never suppression. |
| Revision change and partial result | Reading an old revision or a bounded excerpt cannot suppress a new revision/full document. No whole-document inference from a tool name. |
| Event replay and mutation | Identical event replays do not add entries; same identity with different bytes is refused. Returning snapshots cannot mutate the backing source. |
| Compaction race | Resolve an old request after before-compact/success; response stays stale. New generation has no inherited read records; failed compact requires explicit revalidation. |
| Session/fork/tree change | Same document/event IDs in different scopes do not collide. Old session updates cannot populate the current scope. |
| Cursor/grant freshness | Incomplete cursor, changed source/grant revision, revoked permission or resolver failure produces unknown and no delivery. |
| Bounds and cancellation | Cap overflow refuses rather than evicts; cancelled/closed requests cannot update state; finite pending request accounting survives delayed settlement. |
| Legacy policy | Explicit legacy binding suppresses all versions until reset; versioned binding does not. Neither claims that prepared/enqueued means read. |
| Negative control | A deliberately broken fake that carries old-generation records or matches IDs without versions must fail the relevant conformance assertion. |

## PROPOSAL — decision list and implementation gate

- **Placement:** approve C, or choose A/B with an explicit owner for lifecycle and source attestation.
- **Read semantics:** default to successful full exposure of the exact revision; who supplies an authoritative exposure receipt for harness reads? Tool success alone is insufficient without source-specific proof.
- **Compatibility:** preserve the public legacy callback; approve the version-aware opt-in and strict unavailable→defer composition policy separately.
- **Reset:** default to no compaction/session/branch carry. Is partial/summary exposure ever eligible, and with what proof?
- **Bounds:** accept or replace the proposed caps; name the host owner of admission/cleanup. Do not infer performance from these caps.
- **Preflight:** approve a neutral required-need registry/validation protocol before adding configuration keys; determine whether optional needs are necessary.
- **Policy data:** keep authoritative registry admission in lazy-harness; specify source revisions and consent outside this repository. No automatic `.lazy-harness` access.
- **Memory sink:** see [memory-module.md](memory-module.md); review candidates need a separate volatile, host-owned sink, not the parent report port or the read ledger.

## UNVERIFIED

The proposed contract, limits, conformance suite, need preflight, version-aware projection, Pi/harness read attestation, actual provider-read semantics and performance are not implemented or qualified. No restart persistence is established; [R7](../qualification/p2-reliability-review.md#r7-restart-durability--design-only-not-an-implemented-api) remains a design. Existing source was inspected, not tested in this task. No live host behavior or semantic accuracy is asserted. No code, tests, model calls, dependency changes, experiment artifacts, push or GitHub writes are part of this design.
