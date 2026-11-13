# Canonical lazy-harness-monitoring connection contract

This document is **the canonical connection contract for lazy-harness-monitoring**. It
follows the short common rules in lazy-harness SDD
[module-composition.md §6.6](https://github.com/lazy-dinosaur/lazy-harness/blob/main/.lazy-harness/spec/platform/module-composition.md)
and merged ADR 0063 on lazy-harness `main`. Each module
repository defines and exports its **own** connection contract: port types, fakes and
conformance tests. The separate contract repository is cancelled; this contract is not
deferred to another repository. The SDD holds only the common rules, not monitoring's
port definitions or conformance suites.

lazy-harness installs this module repository as an exact-pinned git submodule, imports
its public contract and implements the ports with Fabric in
`lazy-harness/packages/lazy-harness-pi`. Fabric never belongs in module repositories
(D1′). Non-TypeScript modules ship an RPC server plus a TypeScript client; monitoring
is a TypeScript in-process module. The [purpose-module contract](module-contract.md)
separately governs monitoring-internal `modules/*`. The
[offline composition](../../examples/composition/README.md) is a reference, not a deployed
extension, live-use approval or a claim that every common-rule gap is closed.

## Common-rule checklist (SDD §6.6)

| Common rule | Monitoring status / evidence |
|---|---|
| No Fabric in modules — **satisfied** | D1′: no package here depends on Fabric; core exports the module-owned `WorkerExecutionPort`, fakes and reusable conformance. Only lazy-harness implements the Fabric adapter. See [Worker and runtime boundary (D1′)](../../README.md#worker-and-runtime-boundary-d1). |
| Root declaration file — **implemented** | Root `lazy-harness.module.json` covers the entire repository. `composition.ts` is the single TS export path. Core exports typed validation/loading and guarded startup; root-manifest/path/version tests run offline. |
| JSON-RPC 2.0 over stdio — **not applicable** | Monitoring is TypeScript and imported in-process (`runtime: inprocess-ts`). Process modules use JSON-RPC 2.0 over stdio and ship an RPC server plus a TS client; no process transport is needed here. |
| Common status/certainty result — **boundary adapters** | `PortResult<T>` aliases `WorkerCompletion<T>`. Required ports use envelope adapters at composition, not an internal rewrite. HOLD is completed/terminal with value.held=true. See the [complete result audit](result-format-audit.md). |
| Integer major versions — **implemented** | Each declared port exports an integer v1 constant. `MONITORING_PORT_MAJORS` collects them. Guarded startup rejects unknown/missing/unsupported majors before any composition callback or factory. Package/binding versions remain separate. |

## Root manifest and port-major contract (SDD §§6.1, 6.4)

The root manifest has all eight required fields: `schema`, `id`, semver `version`,
`runtime`, `entry`, `requires`, `test`, `conformance`; optional `provides` and `records`
are present too. `entry: composition.ts` exports core APIs and port adapters plus `host`,
`references`, `rules`, `memory` namespaces. It does not install hooks or construct an engine.
`conformance` is a repository-relative list of reusable suite source paths. Loading verifies
entry and every suite is an existing file inside the repository (including symlink containment).
`records` points into lazy-harness, not this repository; it is not checked as a local path.
`test: bun test` includes the offline composition and all current-main suites.

**All port names are module-local drafts.** SDD §7 has not defined common v1 names/shapes.
Do not treat `judgement.model` or any other name here as a cross-module standard.

| Manifest port | Major constant (all 1) | Implementation / source responsibility |
|---|---|---|
| worker.execution | WORKER_EXECUTION_PORT_MAJOR | Runtime-owned worker. Optional local in-process default is explicit, not a hosted worker. |
| judgement.model | JUDGEMENT_MODEL_PORT_MAJOR | Model backend (judge/classifier or structured model), or direct JudgeBatchPort. Used by selection AND budget-gated region.compact. No network default. |
| session.read-records | READ_RECORD_PORT_MAJOR | Versioned snapshot/currentness, including host-attested exposure evidence. |
| memory.review-sink | REVIEW_SINK_PORT_MAJOR | Private volatile review acceptance; never canonical storage. |
| memory.source | MEMORY_SOURCE_PORT_MAJOR | Original-source sidecars, exposure provenance and currentness; a constructor seam, not a needs-registry adapter. |
| report.enqueue | REPORT_ENQUEUE_PORT_MAJOR | Matching parent enqueue receipt; distinct from hook delivery or reading. |
| policy.registry | POLICY_REGISTRY_PORT_MAJOR | Explicit admitted versioned policy data and validator/projection. |
| rule.verifier | RULE_VERIFIER_PORT_MAJOR | Per-policy typed judgement. May be implemented using the same admitted model as judgement.model. |
| state.persistence | STATE_PERSISTENCE_PORT_MAJOR | Opt-in synchronous CAS; optional local volatile default, not a durability promise. |

`requires` inventories the full composition capability surface, not activation consent.
Guarded repository composition requires majors for all declared capabilities, including chosen
local defaults; capabilities may be unused at observe or without persistence. Individual legacy
constructors still permit stateless references, in-memory state and absent judges. A host must
choose implementations explicitly; the `default` path is documentation, never auto-imported.
The manifest/major check does not prove a callback is truthful or auto-wire its implementation.
Run normal binding/capability preflight and reusable conformance too.

Exposure evidence is inside `ReadRecord.exposure` and the `MemorySource` sidecar, not a
second independent port. `region.compact`/`judge.view` are engine flags, not external
services. Frames/catalog/material are operation inputs; capabilities/grants, estimates,
trace callbacks and validators are trusted local control/configuration, not independent
manifest service ports. No implicit source discovery or authority inference is added.

Use `expose*` adapters when starting from existing local fakes/native APIs, and `bind*`
adapters for envelope-returning host implementations consumed by legacy internals. Worker
`wait` needs no adapter. Failures remain explicit; no adapter retries uncertain results.
Model fallback is unchanged: missing/failed judgement does not authorize work; compaction
failure retains the bounded uncompressed region. Explicit scripted/main decisions remain possible.

## Exported connection contract surface

- **Port types and preflight:** `@lazy-harness/monitoring-core` exports
  `WorkerExecutionPort`, `WorkerCompletion`, limits and binding/declaration helpers,
  including `prepareMonitoringBindings` / `createConfiguredMonitoringCore`.
  `@lazy-harness/monitoring-core/host` exports `ObservationFrame`, `HostCapabilities`,
  `ReadRecordPort`, `ReviewSinkPort` and their scope/context/request/receipt types.
  The rule-steering package exports `PolicyRegistry` and `RuleVerifier` seams.
- **Fakes/adapters:** core exports `createInMemoryWorkerPort` and
  `createHandlerWorkerPort`; core `/host` exports `createInMemoryReadRecordPort` and
  `createInMemoryReviewSinkPort`. These do not implement Fabric or call a model.
- **Conformance suites:** core exports `runWorkerPortConformance`; core `/host` exports
  `runReadRecordPortConformance` and `runReviewSinkPortConformance`;
  core also exports `runStatePortConformance`;
  `@lazy-harness/monitoring-module-rule-steering` exports
  `runPolicyRegistryPortConformance` and `runRuleVerifierPortConformance`. Consumers
  run these against their implementations; passing a fake does not qualify a real host.
- **Reference composition:** `examples/composition` exports `createComposition` and
  `createFauxPi`, wiring the three purpose modules via public APIs with invented fixtures,
  preflight, explicit stages, lifecycle fencing and separate delivery routes.
- **Pi read attestation:** `@lazy-harness/monitoring-host-pi` exports
  `createReadResultAttestor` and its public types listed
  [below](#pi-read-result-exposure-attestation). It is an inactive, injected feed seam,
  not hook installation, project discovery or authority inference.

The contract below specifies monitoring's assembly, input ownership, lifecycle, stages,
worker outcomes and receipt semantics. Composition-owned project authority and the
deferred live consumer remain explicit; the suites verify this module-owned contract.

## Monitoring ownership and attachment sequence

Composition owns module selection, data sources, capabilities, stages, grants, budgets,
worker implementation, report routes and review UI. Modules never attach/discover
themselves. Core never imports a host. Pi adapter does not own project identity/authority.

1. Call `startMonitoringComposition(root, hostMajors, compose)` from `composition.ts`. It loads
   and validates the manifest and paths, checks module-supported and host-advertised majors
   before invoking `compose`. Then select exact binding versions, source scope, module limits, validated settings,
   author declarations/hashes and explicit effective stages.
2. Construct bounded input ports. Bind by module ID **and need ID**, adapter ID and
   `protocolVersion: 1`; register validators for nonstandard adapters.
3. Supply truthful `HostCapabilities` and explicit judge/profile/budget bindings if used.
4. Run `prepareMonitoringBindings` or `createConfiguredMonitoringCore`. All modules'
   versions/needs/watch/jobs/grants/capabilities must pass before **any** factory runs.
5. Only then construct supported runtimes/owned workers, sources and delivery routes;
   install lifecycle fences, observer, then frame attachment, in that order.
6. Admit ordered validated frames and current material. Shutdown stops admission, fences/
   cancels pending work, closes sinks/attestors, disposes runtimes and awaits raw idle.

`attachPiFrames` and low-level runtime alone are trusted mechanics, not preflight.
Metadata binding does not automatically wire handler callbacks: pass the same bound port
to documented constructors/request builders. Use `createMemoryMonitor`, not a second
executor for memory metadata. Its exported `createMemoryHandlers` map and injected
`createWorkerPort(handlers, limits)` let composition select the implementation while each
opportunity runtime owns a fresh port's lifecycle; source freshness/dedupe/private handoff
remain in the monitor. Shape validation is not conformance or a callback sandbox.

## Required needs, capabilities and host-owned sources

Unknown/mismatched/invalid/inherited required bindings fail. Optional permits absence,
not an unknown adapter. `region.compact` / `judge.view` are engine bridge provisions,
not external Pi ports; supply their actual bounded bridge inputs correctly.

| Need/seam | Required composition provision |
|---|---|
| references already-read / session.read-records | Protocol-1 snapshot/currentness port and versioned request builder for exact selected IDs/versions. Use the official versioned registration and its rehashed required need. |
| references region / region.compact | Core bounded region/history/compaction bridge; host still invalidates read ledger. |
| rules rules / policy.registry | Explicit authoritative admitted versioned registry, protocol-1 custom validator, format conversion/allowlisting. policyReferences only projects it. |
| rules view / judge.view | Core bounded current-event view with matching selected policy bytes/versions and current IDs. Any future permitted worker path needs typed verifier plus approved cap/lease. |
| memory review-sink / memory.review-sink | Protocol-1 volatile ReviewSinkPort, matching receipts, atomic freshness/grant checks at acceptance; not parent delivery or canonical storage. |
| memory source constructor seam | MemorySource.capture/isCurrent, strict MemoryInput sidecars, exact original spans/revisions, attribution, project/subject/conflict and permissions. Not an additional registry need. |

Host owns bounded admitted catalog/document versions, material permissions, source/grant
revision resolvers, complete-through cursor, read records **and exposure evidence**,
policy registry and memory sidecars. No implicit scan, record path convention or kind-based
authority. Real-file capture must verify containment/symlinks/stable bytes and permissions;
a restored hash or old capture receipt is not a fresh byte snapshot.

Capabilities enumerate implemented events/actions/snapshot depth and version. Use
`piHostCapabilities` only for its supported adapter surface, not any arbitrary Pi version.
It declares inject-context, not steer/block-tool-call. Unsupported effective watches/
actions reject before factories even at observe. `monitoring.selected-material` is
engine-owned. `monitoring.rule-reminder` can be an explicit module-local internalActions
handoff, never a whitelist for reserved host actions or promotion of the observe ceiling.

## Pi lifecycle generations

Install `createPiInputPortGenerations().extension` before sources use `current()`.
It begins unavailable; session_start establishes a new binding/branch/compaction scope.
Scope fields: sessionId, bindingGeneration, branchId, branchGeneration,
compactionGeneration. Revisions, grants, cursor and availability remain host assertions.
A counter alone attests no material. Before switch/fork/tree/compaction, failed compaction
and shutdown fence scope. Successful session_tree/session_compact establish new
generations, not carry permission. Shutdown/close leaves no available scope. Old extension
owners are fenced from publishing into the current binding.
Every ledger/source/sink reacquires scope/revisions/grants/watermark before admission
and use of asynchronous results/receipts. Replacing a capture identity must also fence
storage even when input scope fields did not change.

Install `createPiObservationExtension` before `attachPiFrames`; each notification must
have its matching source frame. Attach checks cursor/event/session order and halts on
missing frames. Strict parsing additionally rejects malformed data. Observer snapshots
are bounded projections, not guaranteed complete provider input. Hooks remain notification-
only unless a separately authorized delivery route owns their return. Preserve proven
interactive/rpc source; role labels alone do not prove user origin. Extension input is
not user authority.

On branch/session replacement or compaction: invalidate pending attestation, stop old
jobs, clear volatile read/review bodies and close the old memory monitor/sink. Recreate
fresh current-scope instances only after success. Never relabel old records, keys,
offers, candidates or reports into a new scope. The example conservatively closes the
entire composition at control boundaries; a real host may recreate it, not carry contents.
Failed boundaries stay unavailable until explicitly re-established.

## Stage selection and kill switch

Trusted composition chooses explicit stages, default **observe**, using official helpers
and preflight with validated enums and author ceilings. References permits explicit active;
memory permits shadow, never active; rule-steering permits off/observe at its observe ceiling.
The kill switch stops new admission and fences/cancels pending work, not just hiding
messages or mutating future config. Use off where supported and/or dispose the current
composition. All three official helpers support off; live kill still needs admission
gating/disposal and cancellation of pending work.
Uncertain physical completion stays protected until settlement; off cannot forget effects.
Observe means no jobs/private candidates/reports/writes/injection. Shadow withholds core
parent effects/reports; only memory's explicit private volatile review route is allowed.
Active never authorizes unlisted actions or canonical writes.

## Worker implementation and failure handling

Implement public `WorkerExecutionPort<Input, Output>`, not provider API shapes inside
modules. Runtime owns its instance. Bound active/queued/lifetime admissions, timeouts,
output and budgets. `wait` is logical; `settled` is physical/raw. Stop refuses new work
and cancels logical work; restart requires raw idle; dispose is terminal. In-memory
promise timeout cannot force termination. Run reusable conformance and backend-specific
raw-termination probes. A Fabric-backed implementation belongs in the **composition
repository** (`lazy-harness/packages/lazy-harness-pi`), with its own
runtime/version check strategy and approval, determined in the separate attach PR; none is here.
The template uses in-memory/handler fakes only, with no model/provider call.

Malformed frames, unsupported capability, absent/denied/stale scope/material/grants,
invalid receipts, exceptions, timeout, capacity and stale completion fail closed. Trace
bounded reasons, not unbounded private bodies. Never turn unknown into not-read, retry
uncertain work with fresh keys, evict protection to regain capacity, or equate preparation
with acceptance. Trusted callbacks must implement atomic freshness/cancellation themselves.
Sequence loss halts admission pending explicit reconciliation/replacement.

## Separate report and private-review routes

Parent report sinks synchronously return matching `ReportEnqueueReceipt`. Pi
`createParentReportDelivery().enqueue` can implement this; async dispatch must capture
origin/source dependencies before work and revalidate at enqueue/delivery. Never bind a
late result opportunistically to the new current branch/turn. Real composition must fence
before/failed transitions too; a helper alone is not a complete lifecycle policy.
Its context_with_system hook returns appended messages and separate hook-boundary
`ReportDeliveryReceipt`: proof of hook output only, not final provider input or a read.

Private `ReviewSinkPort.enqueue` retains current-scope volatile bodies only, with matching
accepted-volatile/refused/unknown receipts. Honor cancellation/freshness atomically.
Unknown acceptance consumes module protection. Never connect this sink to automatic
ingestion, persistence, parent context, read ledger or approval. Separate persistence/UI
review authorization needs a later contract. The example's report array is enqueue-only,
cleared on close, with no context-injection hook or actual provider delivery.

## Pi read-result exposure attestation

`@lazy-harness/monitoring-host-pi` exports `createReadResultAttestor`, `ReadTextFormat`,
`MainReadCall`, `MainReadResult`, `ReadCaptureIdentity`, `ReadAttestationCapture`,
`ReadAttestationDocument`, `ReadResultAttestorOptions`. Source commit `b2c4ec3` is in the
file header. This is an **inactive feed seam**, not hook installation or file discovery.
`start(call, cwd, origin)` captures authority; `complete(result, cwd, origin, cursor)`
returns whether record storage admitted a neutral core ReadRecord; `close()` is terminal.
Caller provides normalized cwd and proven main-agent provenance, never Reader summaries,
nested-agent results, prepared reports or provider enqueue receipts.

Injected interfaces: context(), opaque captureIdentity() (id/epoch), owner-selected format(),
capture(read) for stable current bytes, resolveDocument(read, sha256) for admitted
exact documentId/version/namespace/sourceRecordId, and synchronous record(record).
Capture rejects forbidden paths/escapes, symlinks/races, missing files and uncertainty.
Resolver binds those exact bytes to an admitted catalog version (not necessarily the hash
itself). Storage independently fences scope/source/grant **and capture identity** changes;
close/replace it if identity is not represented in its context. Attestor cannot clear an
external ledger or enforce trusted callback policy.

| Result | Decision |
|---|---|
| Paired explicit successful main-agent read, one native Pi plain-text block, valid whole numeric range, exact current UTF-8 bytes | full |
| Same with supported hashline rows stripped by exactly five lowercase letters plus │, exact remaining bytes | full |
| Valid numeric subset with exact nonempty selected lines | partial; never suppression |
| Known bytes/document but malformed/multiple/nontext content, unknown format/options/range, notice/truncation/continuation, lossy UTF-8, NUL or changed bytes | unknown; never suppression |
| Missing pair, replay/overflow, foreign origin/cwd/call, error/absent explicit success, unavailable authority, invalid cursor, missing bounded capture/admitted document, revoked generation or closed | no record |

Hashline `[a-z]{5}│` stripping preserves whitespace, CR, blank rows and nested pipes.
Renderer omits terminal empty row: files ending in LF cannot gain full exposure by
inventing missing LF. Native plain text attests terminal LF only if included exactly.
Owner selects format; never infer it from text. Notice-looking file text conservatively
stays unknown. Capture bound 1 MiB, text bound 2 MiB, 256 calls/generation; overflow
fences that generation instead of forgetting replay keys. Callback failures fence it too.
Scope/source/grant/availability/capture identity/format changes clear pending/seen IDs;
watermark progress alone does not reset replay protection. Full exact document/version
in a fresh matching scope alone suppresses references. No record is not proof of no exposure.
IDs bind call/context/identity/format/cursor/document/bytes/classification: local evidence
identities, not cryptographic host authority.

Removed from the port: project identity/catalog matching rules, fixed namespace/record
paths, CaptureEvidence, project evidence-kind wrappers and direct root-bound filesystem
capture. Their safety policy is delegated to injected host interfaces, not inferred from
receipts or replaced with a generic permissive allowlist.

## Deferred lazy-harness handoff: monitoring integration work

SDD §6.7 is **lazy-harness-side only**, not a module dependency or a new module port.
Its six pre-attach gates remain downstream: availability refusal, execution-message overhead
measurement, code/input limits with file references, adopted transport protections/conformance,
long-running completion receipt validation, and runtime/approval condition checks. No adapter,
submodule update, old-copy cleanup or live attach is included in this alignment PR.


Migration step 6 thin consumer is **deferred by user decision**. Under the canonical
SDD, connecting these monitoring APIs will need the following integration work; this list
is not a replacement common contract. The offline template supplies no real authority:

- Module/version/config selection, truthful capability preflight, observe-first stages,
  real live kill switch and lifecycle owner.
- Pi main-agent read call/result provenance feed and verified owner-selected format;
  stable permission/containment/race-safe byte capture, opaque identity/epoch, project
  catalog/version resolution and generation-fenced neutral read-record storage.
- Admitted catalog/permissions/source/grant/watermark resolvers and compaction/branch
  invalidation; authoritative versioned policy-registry adapter/validator.
- Memory original-source sidecars, attribution/project/subject/conflict association,
  currentness rechecks and cancellation-safe volatile sink/private review UI, without
  canonical writes or approval inference. Persistence needs separate approval.
- Parent report route with captured origin/dependencies, matching enqueue and separate
  hook receipts, dedupe and before/failed-transition fencing; no false read inference.
- Separately authorized judge/verifier/profile/budget wiring, runtime-checked Fabric-backed
  worker port, raw settlement/termination handling and runtime compatibility probe.
- Consumer-specific port conformance, Pi lifecycle/origin/format fixtures, fresh-worktree
  install/tests/typecheck and real-host qualification. Fake success here proves none of
  the consumer's production, authority, semantic-quality or durability guarantees.
