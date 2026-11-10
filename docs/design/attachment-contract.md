# Monitoring implementation notes for the lazy-harness module composition contract

This document explains how lazy-harness-monitoring implements the common connection
contract; it does **not** define that common contract. Its canonical meaning is the
lazy-harness SDD [module-composition.md](https://github.com/lazy-dinosaur/lazy-harness/blob/main/.lazy-harness/spec/platform/module-composition.md),
including the scope decision in **§6.6** (user-confirmed 2026-11-09). That SDD revision
may not be on `origin/main` yet; a temporarily unavailable link does not transfer authority
to this document. Monitoring-internal Host Adapter and worker details, and the
[purpose-module contract](module-contract.md) for this repository's `modules/*`, remain
canonical here. See the [offline composition](../../examples/composition/README.md);
this is not a deployed extension or a claim of complete common-contract conformance.

## Mapping to the canonical SDD and remaining gaps

| SDD concern | Monitoring implementation / status |
|---|---|
| Composition-owned assembly (§1–3) | `prepareMonitoringBindings` checks needs, settings, jobs/grants, exact binding versions and capabilities before any factory. Judge/verifier/input ports are injected; missing/failed verification rejects rather than becoming a negative semantic answer. Monitoring-specific preflight details are below. |
| Agent host code (§2) | `hosts/pi` implements frames, capability declarations, lifecycle generations, report delivery and generic read attestation here. Project capture/catalog/authority remains injected by composition. |
| Lifecycle and admission safety | Monitoring's generations fence stale scope/source/grants; official stage helpers default observe and honor ceilings/off. Kill switch/disposal stops admission and cancels pending intent. These are monitoring-internal mechanisms supporting the SDD separation, not new common protocol fields. |
| Result form (§6.3) | `WorkerExecutionPort.wait` returns the common status/certainty `WorkerCompletion` form; `settled` separately acknowledges raw settlement. Uncertain work is not retried and late values cannot replace terminal output. Other native APIs (e.g. read/review receipts and judge decisions) remain distinct; common boundary wrapping/schema alignment is not claimed complete. |
| Routes and effect ownership | Parent enqueue/hook receipts and private volatile review receipts remain separate monitoring-internal routes. Neither proves actual read, approval or durable storage. Composition owns authorized delivery/UI. |
| Fabric location (§1–2) | Only lazy-harness `packages/lazy-harness-pi` will implement the Fabric adapter, matching D1′. No Fabric implementation/dependency is supplied here; fake worker and custom-port conformance are monitoring-internal suites. |
| TypeScript language boundary (§4, §6.2) | Monitoring is imported in-process. JSON-RPC 2.0 stdio applies to `runtime: process`, so a JSON-RPC server is not needed for this TS module repository. |
| Git submodule pinning (§5) | The intended lazy-harness consumer pins this module repository at an exact git submodule commit. This offline example does not install or update a consuming submodule. |
| Root declaration (§6.1) — gap | No `lazy-harness.module.json` (`lazy-harness-module/v1`) exists yet. Internal purpose-module declarations do not substitute for that repository-root manifest. Not implemented in this batch. |
| Integer major versions (§6.4) — gap | Monitoring currently checks exact binding-version strings and protocol-1 input ports. That is not the common manifest/message/port major-version negotiation; alignment awaits the executable contract. |
| Executable common contract (§6.6) — future | A separate contract repository (working name `lazy-harness-contract`, **not created yet**) will own declaration/RPC/result-format JSON Schemas and the shared TS/Python conformance kit. lazy-harness and every module repository will pin the same commit as a git submodule. No contract submodule or schema is added here. |

The SDD owns meaning; future executable forms must follow it, not redefine it. The
monitoring suites below verify internal mechanics, not the future common conformance kit.

## Monitoring ownership and attachment sequence

Composition owns module selection, data sources, capabilities, stages, grants, budgets,
worker implementation, report routes and review UI. Modules never attach/discover
themselves. Core never imports a host. Pi adapter does not own project identity/authority.

1. Select exact binding versions, source scope, module limits, validated settings,
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
repository** (`lazy-harness/packages/lazy-harness-pi`), exact-pinned with its own
runtime/version probe and approval; none is here.
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
- Separately authorized judge/verifier/profile/budget wiring, exact-pinned Fabric-backed
  worker port, raw settlement/termination handling and runtime compatibility probe.
- Consumer-specific port conformance, Pi lifecycle/origin/format fixtures, fresh-worktree
  install/tests/typecheck and real-host qualification. Fake success here proves none of
  the consumer's production, authority, semantic-quality or durability guarantees.
