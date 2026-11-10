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

## Module and attachment contracts

- [Module shape, official registration, stage safety and deviation checklist](docs/design/module-contract.md)
- [Host attachment, needs, lifecycle, delivery and deferred consumer handoff](docs/design/attachment-contract.md)
- [Offline three-module reference composition](examples/composition/README.md)

Pi-generic `createReadResultAttestor` is exported by `@lazy-harness/monitoring-host-pi`.
It pairs proven main-agent read calls/results and classifies full/partial/unknown exposure;
capture, document/catalog identity, namespace, permissions and read storage are injected
host interfaces. It installs no hooks and reads no project files. See the attachment
contract for the decision table, hashline terminal-LF limitation and lifecycle fencing.
The lazy-harness thin consumer remains **deferred by user decision**; this repository
provides its contracts and offline template, not live integration or production approval.

## Deviation fixes and compatibility

- References explicitly declares `maxStage: 'active'` for context delivery; default remains
  observe and delivery still needs explicit active opt-in. **BREAKING:** the declaration
  hash changes; regenerate hash-bound replay/config artifacts (binding version stays `2.1.1`).
- Rule registration accepts explicit stage options, default observe; only off/observe fit
  its unchanged observe ceiling. Shadow/active reject. Reusable policy-registry/verifier
  conformance suites are exported. **BREAKING:** registration is now frozen; replace
  mutation-based setup with official options.
- Memory exports `createMemoryHandlers` and accepts an optional `createWorkerPort` factory;
  every opportunity runtime exclusively owns/disposes its fresh port. This is additive;
  source freshness, dedupe and private volatile review handoff remain monitor-owned.

Remaining compatibility restrictions and host duties are recorded in the module checklist.
The attachment document is monitoring implementation notes for the canonical lazy-harness
`module-composition.md` SDD (§6.6), not a competing common contract. Monitoring-internal
purpose modules/Host Adapter/worker details remain canonical here. Executable common
schemas and conformance will live in a future separately pinned contract repository.
No module-root manifest or non-TypeScript stdio transport is implemented by this batch.

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
- [P1 API/condition review and proposed deltas](docs/qualification/p1-api-condition-review.md)
- [Offline public-API examples and reproduction](examples/p1/README.md)

These are scoped review fixtures, not live-use approval or SDK qualification.
