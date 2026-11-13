# lazy-harness monitoring

The monitoring core of lazy-harness, developed as its own monorepo so each part is built, tested and released separately.
TypeScript, Fabric-independent (ADR 0061 in lazy-harness); boundaries stay language-neutral (configuration schema,
`monitoring-trace/v1`, canonical JSON hashing).

## Layers

| Package | Owns |
|---|---|
| `packages/core` | engine + inspection ports: trigger points, per-module independent pipelines, between-region input + memo, purpose-scoped compaction, judgement, job runtime (loop guard, idempotency, budget, uncertain-stop), parent report, run stages, judgement trace |
| `hosts/<agent>` | host adapters owned by the host side, one per agent (`hosts/pi` now; opencode, OMP, Jcode later): turn agent events into ordered frames, deliver reports, implement host input ports, declare capabilities |
| `packages/eval` | ONE shared evaluation tool every module plugs into: replay → judge → score → version compare, oracle check, budgets, dev/holdout |
| `modules/*` | one purpose each (question, trigger points, inputs, jobs) with its own gold set and traces |

The core never imports a host. It defines the **Host Adapter contract** (`packages/core/src/host`): the frame vocabulary
and `ObservationFrame`, `HostCapabilities` (events emitted, actions such as inject-context / steer / block-tool-call,
snapshot depth), `hostSupportIssues` and `frameSequenceIssues`. `prepareMonitoringBindings` / `createConfiguredMonitoringCore` now require `capabilities`, and refuse unsupported effective watches/actions **before any factory or engine is constructed**. Legacy bindings without a v2 declaration need explicit `hostRequirements`; trusted `internalActions` maps module-local actions only, never reserved host actions. Low-level constructors/attach are trusted mechanics, not safe startup. Pipelines take frames through `accept(frame)`.

Modules: `references` (U1), `rule-steering` (U6), `memory` (new). Data (traces, feedback marks, gold sets) is kept per module.

Records (design, decisions, measurements) stay in the lazy-harness repository under `.lazy-harness/`; see `MIGRATION.md`.

## Module composition contract (ADR 0063)

- [Root repository manifest](lazy-harness.module.json): one declaration for core, hosts, eval and all purpose modules.
- [Composition entry](composition.ts): core exports, port adapters, and host/references/rules/memory namespaces.
- [Canonical attachment contract](docs/design/attachment-contract.md): port ownership, integer majors, guarded startup, lifecycle and downstream attach gates.
- [Purpose-module authoring contract](docs/design/module-contract.md): internal modules are not separate repository manifests.
- [Result-format audit](docs/design/result-format-audit.md): WorkerCompletion origin, boundary envelopes and held semantics.
- [Offline composition example](examples/composition/README.md): fake-backed observe-first assembly and tests.
- [Migration status](MIGRATION.md): step 2 complete; records canonical on lazy-harness main via PRs.

`startMonitoringComposition(root, hostMajors, compose)` checks the manifest, entry/conformance
files and supported integer majors before calling `compose`. Import alone does not attach.
Port names are module-local drafts pending SDD §7; manifest semver is not compatibility.
The composition example is offline, not deployment or live-use approval. SDD §6.7 is a
lazy-harness-side attach contract, not a module dependency. No separate contract repo.

## Worker and runtime boundary (D1')

No package here depends on Fabric. Core owns `WorkerExecutionPort<Input, Output>`, exported from
`@lazy-harness/monitoring-core`, with `start`, `begin`, `wait`, `settled`, `cancel`, `stop`, `dispose`,
`idle`, `getStatus` and explicit limits. `createInMemoryWorkerPort` supplies a fake/in-process implementation;
`createHandlerWorkerPort` adapts existing handlers. `runWorkerPortConformance(makePort)` is a reusable,
dependency-free suite (24 checks for the in-memory implementation), not a real-host qualification.
The `lazy-harness` composition repository owns the EXACT-pinned Fabric implementation and bun/Node >=24
probe in issue #1 P7 thin-consumer work, out of repo. The port does not mirror Fabric's API.

`MonitoringModuleRuntime` accepts optional `workerPort`; otherwise it uses the handler adapter.
It owns that port's lifecycle: do not share a port between independently managed runtimes.
For compatibility its worker port starts running by default (this does not activate module jobs). `stop` rejects new work/cancels queued and active logical work;
`start` after stop requires raw idle; `dispose` is permanent. Lifetime accounting does not reset on restart.
Defaults: `maxActive: 4`, `maxQueued: 64`, `maxWork: 1024`, `jobTimeoutMs: 30000`.
Timeout/cancel returns a terminal uncertain outcome and ignores late values, but **cannot hard-kill a promise**.
Raw capacity and budget reservations remain owned until `settled` acknowledges physical completion;
hard termination belongs to the implementation. A failing port with unknown raw state retains reservations.

Diagnostics are bounded: runtime `maxOutcomes` (default 256), mailbox `maxTrace` (256), Pi `maxDelivered` (256),
with eviction counters. Runtime `outcomes` is now a readonly snapshot.
Protection is separate: `MemoryIdempotencyStore(maxKeys = 4096)` and mailbox `maxSeen` (4096) never evict
keys during their instance lifetime, including uncertain keys. Capacity overflow refuses new work/delivery.
There is no automatic protection-key expiry: replace these stores only after the effect/session scope is
closed and reconciled, never as an LRU/TTL optimization. Restart durability remains unsupported by default.
`ApprovedBudgetGate(maxWindows = 1024).revoke(moduleId, jobId?)` explicitly closes a budget window;
its reservations remain until raw settlement. Reapproval cannot replace a live reservation.

## Optional restart state (R7)

**Additive API; no BREAKING change in this batch.** Without `state`, runtime and mailbox remain
in-memory. No host adapter or module is automatically registered for persistence.

Core exports `StatePersistencePort`, `StateBinding`, `StateSnapshot`, `StateLimits`,
`StateCommitReceipt`, `MonitoringStateSession`, `openMonitoringState`, `createMemoryStatePort`,
`runStatePortConformance` and its `StatePortFactory` from `@lazy-harness/monitoring-core`.
The file backend is **only** `createFileStatePort` from `@lazy-harness/monitoring-core/state-file`;
the default export graph does not import the file-storage backend (the manifest loader does use filesystem reads). No dependency was added.

```ts
import { openMonitoringState } from '@lazy-harness/monitoring-core'
import { createFileStatePort } from '@lazy-harness/monitoring-core/state-file'

// Host supplies a trusted existing private directory and authoritative StateBinding:
// bindingId, moduleId, declarationHash, configHash, modelFingerprint, and InputPortScope.
const state = openMonitoringState(createFileStatePort(privateDirectory, binding), binding)
// Pass the SAME recovered session to one module's MonitoringModuleRuntime({ ...options, state })
// and ContextCarryMailbox({ ...carryOptions, state }). Do not also supply idempotency.
// After authoritative delivery acknowledgement (not enqueue acceptance):
// state.acknowledgeDelivery(itemId, authoritativeReceiptId)
```

Opening synchronously validates schema v1 and the complete bounded snapshot, commits recovery and
increments the owner fence before admission. Reopen on host generation changes; do not reuse an old
session. Binding/session/branch/config/declaration/model mismatches fail closed, rather than guessing
migration authority. The host must reacquire current observation, grants, sources and approvals;
persisted metadata is not authorization. Only explicitly consented report/carry text is stored; trigger
text, closures, promises, signals, read-record snapshots and review candidates are not serialized.

- Existing idempotency hashing is unchanged. Terminal outcomes/effect receipts and uncertain keys
  survive diagnostic eviction. `state.view()` exposes the recovered ledger, not runtime `outcomes`.
- Locally queued-but-unstarted work becomes rejected/dropped; **no work is auto-replayed**. Work that
  crossed an external worker boundary becomes uncertain, even if that port had only queued it.
  `WorkerJobRequest.stateAttempt` carries stable key/operation ID and owner fence to that port.
  Recovered unresolved raw attempts block all new dispatch until out-of-band authoritative
  reconciliation; no automatic reconciliation or forced capacity release is supplied.
- Costs retain the full declared per-run caps (including unstarted drops), not just observed spend.
  Current approvals remain required, and a new budget gate/reapproval cannot reset these durable
  charges. This deliberately over-reserves and may exhaust capacity early.
- Pending mailbox items recover only at the same host generations, then revalidate scope, source,
  age and carry turn at `take`. Delivery intent is committed **before** exposing text; missing ack
  remains delivery-uncertain and is never injected again automatically. Seen tombstones survive.
  Report intent/enqueue receipts are separate from delivery receipts; reports are never auto-reenqueued.
  Advice can be lost at crash boundaries. Exactly-once external delivery is **not** claimed.
- Synchronous IO errors/unknown commits poison the session: reopen/read/reconcile, never fall back
  to empty memory. Identical revision+bytes commit retries are idempotent; changed bytes conflict.
  Bounds default to 4096 work keys, 4096 mailbox identities and 4 MiB per snapshot; smaller limits
  are allowed. Exhaustion refuses, never evicts protection. No TTL, compaction or partition deletion API.

The file reference uses one SHA-256-named directory per binding/module/session/branch, strict versioned
JSON plus checksum, a fixed temp file, file fsync, atomic rename and directory fsync. Missing state in
an existing partition is ambiguous and refused. Unsupported fsync fails closed; no durability downgrade.
Use **one serial writer on a trusted local filesystem**. No cross-process lock/consensus, encryption,
backup/restore, automatic migration, global directory-count bound, real process-kill or power-loss
qualification is supplied. The host owns root-directory/partition lifecycle and storage consent.
The read-record/review-sink ports remain unchanged; review retention is still volatile.
See [R7 rules and remaining limits](docs/qualification/p2-reliability-review.md#r7-restart-durability--implemented-conservative-v1).

## Trigger and report compatibility changes

- **BREAKING — Default stage changed to observe:** an omitted module run stage now selects `observe`
  in the runtime and SDK composition: no jobs, effects or reports. Consumers relying on implicit active
  execution must pass `stage: 'active'` explicitly. Explicit `shadow`/`active` behavior and declaration
  `maxStage` ceilings are unchanged; configuration cannot raise the stage above the declared ceiling.

- Named points require plain own-data payloads with the hook's required fields. Input points require explicit
  `interactive`/`rpc` user source plus text. Missing source is not user authority. Raw predicates remain a
  trusted compatibility escape hatch, **not** payload validation.
- `user.extension-input` was removed in favor of `extension.input`: extension-origin input must not match any
  `user.*` point. `user.message` also requires explicit user source. Hosts must supply proven source metadata,
  not infer it from a user role. Real pinned-SDK normalization remains UNVERIFIED.
- `monitoringWatchSupport` / `assertMonitoringWatchable` distinguish runnable watches from control-only,
  delivery-only and unknown vocabulary. Declarations/composition reject unjudgeable watches, including
  `run.aborted`. `resolveMonitoringWatch` may still inspect observational predicates; that is not admission.
- `model.before-call` metadata now names `context_with_system`.
- Runtime `report` is a synchronous receipt-returning sink: `ReportEnqueueReceipt` has matching `reportId`
  (`monitoringReportId(report)`) and status `enqueued`, `failed` or `unknown`. These types/helper are on the
  public `engine/monitoring-engine-runtime.ts` export. Absent/throwing/invalid sinks never set `reported: true`.
  `reported` means **enqueue accepted**, not delivered. Prepared jobs are not rerun on receiver failure.
- Pi `createParentReportDelivery().enqueue` supplies that receipt contract; pass `report: delivery.enqueue`.
  The old boolean `onReport` helper remains for compatibility. `deliveryReceipts` are separate `delivered`
  receipts for the hook result, not independently observed actual provider input. Stable content/scope/source
  identities prevent duplicate callbacks from creating another message; changed content/revisions remain distinct.

## Qualification reviews

- [Qualification index (issue #1, P0/P1)](docs/qualification/README.md)
- [Compaction-only evaluation: stages 1–2, offline DEV](docs/qualification/compaction-eval.md)
- [P1 API/condition review and proposed deltas](docs/qualification/p1-api-condition-review.md)
- [Offline public-API examples and reproduction](examples/p1/README.md)

These are scoped review fixtures, not live-use approval or SDK qualification.
