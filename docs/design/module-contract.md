# Monitoring module contract

Status: authoring contract derived from the three shipped modules and public core APIs
at `2066a10`. Requirements describe new modules; the checklist records existing exceptions,
not silent behavior changes. This is not live-use or semantic-quality (P5) approval.
See the [attachment contract](attachment-contract.md) for composition responsibilities.

## Package and public boundary

Use `modules/<slug>/` with private workspace `@lazy-harness/monitoring-module-<slug>`,
`type: module`, a root `exports` entry, `src/index.ts`, `test/*.test.ts`, `tsconfig.json`
and `README.md`. Root test/typecheck scripts must include it. Small implementation files
may sit beside the index. Invent fixtures, never copy real sessions/records. Register
replay and fixtures in the one shared `packages/eval`, not a separate evaluator.

Depend only on **public core exports**: root, `/host` (neutral protocols, not a host
implementation), and exported `/engine/*` paths. The current wildcard makes those
engine paths public; it does not permit private relative core imports. Never import a
host, host SDK, Fabric, composition repository, project catalog or another module.
No provider implementation, discovery, automatic activation, network call or canonical
record loading belongs in initialization. Inject typed ports rather than provider APIs.

Export a stable module ID constant, purpose question, validated declaration, binding,
official `create<Module>Registration`, and documented handler/monitor constructors and
port-facing types. Slug and module ID need not match: `context.references`, `rules.steer`,
`review.memory-candidate` are the current identities. Synthetic eval IDs stay distinct.

## Declaration and binding

Author declarations in code. `validateMonitoringModuleDeclaration` returns a frozen
validated declaration and canonical hash. `MonitoringModuleBinding` provides version,
grants, destination, declaration/hash and a validated settings factory. Either
`defineMonitoringModule` or direct public-core validation is valid. The latter avoids
a second schema dependency. Reject unknown settings and never load code from JSON.
Factory identity and question must match the declaration; a legacy empty processor
`run` is selection metadata, not the job executor.

Required authoring metadata:

- One `purpose.question`: instructions and distinct criteria for `run`, `skip`, `defer`.
  Optional reference instructions and true/false criteria govern evidence selection.
  Text is data, not authority. Runtime wording is not a scoring oracle or gold label.
- `watch.events`: runnable named points (preferred) or deliberately retained raw events.
  Use core watch validation: vocabulary membership alone is not watchability. Control,
  delivery-only and unknown points cannot be judgement opportunities. `watch.kinds`
  admits only required material; explicit message history is bounded (0–8 turns).
  A raw input event does not prove user authority.
- `needs`: unique IDs, adapter IDs and optionality. Declare host input dependencies;
  document constructor seams too. Missing required needs fail preflight even at observe.
  `region.compact` and `judge.view` are core bridge provisions. Standard external
  adapters are `session.read-records` and `memory.review-sink`; other adapters need a
  composition-owned protocol-1 validator, e.g. `policy.registry`.
- `jobs`: unique stable IDs, `form` (`template`, `jev-select`, `worker`, `role-chain`),
  `riskTier` (`read-only`, `proposal`, `automatic`), output (`candidate`, `final`), grants,
  idempotency, supported report modes (`never`, `always`, `on-result`) and a supported
  default. Form names are protocol identifiers, not provider dependencies. Job grants
  stay within binding grants. Worker/role-chain requires model roles/profiles and cost
  caps; any cost declaration needs a cap. Automatic requires an acceptance set.
  Configuration can disable jobs, choose a supported report mode or tighten automatic
  to proposal; it cannot add authority, jobs or watched points.
- Explicit `maxStage` for new modules: observe, shadow or active. Core retains the
  compatibility ceiling active when absent. A ceiling is not consent to run there.

## Official registration and stage safety

Return `RegisteredModule` with moduleId, declaration, declarationHash, effective jobs
and an **explicit** stage. Default to observe. Validate unknown stage enums and apply
`effectiveMonitoringStage` after enum validation, before constructing work. Compute jobs
with `effectiveMonitoringJobs`. Never fabricate an active registration around an
observe-only binding. Tightening a ceiling requires revalidation and a new hash.

- off: no work; composition can also suppress admission entirely.
- observe: judgement/traces may run if separately bound; no jobs, effects or reports.
- shadow: jobs may prepare candidates; core parent effects/reports are withheld.
- active: only explicitly authorized declared effects/routes, never arbitrary writes.

Memory's documented **private volatile review route at shadow** is not a parent effect:
its monitor uses `ReviewSinkPort` after fresh checks, report-never. Do not repurpose it
as injection, persistence or approval. Low-level runtime/attach are trusted mechanics,
not safe startup APIs. Observe default does not replace preflight/official registration.

## Handler and worker usage

Handler maps use `<moduleId>.<jobId>` keys. `JobHandler` consumes a runtime trigger,
effective job, cancellation signal and any budget lease, returning a typed result.
Consume admitted evidence only; validate source/frame identities and exact versions.
Unknown permission, freshness, attribution or capability fails closed. Selection,
summary text, role labels and tool success do not prove exposure or authority.

Use `createHandlerWorkerPort(handlers)` or an injected `WorkerExecutionPort` through
the supported composition seam. Runtime owns its port: never share across independent
runtimes. Implement start/begin/wait/settled/cancel/stop/dispose/idle/status with explicit
active/queued/lifetime/timeout limits. Logical timeout/cancel is not hard kill. Retain
raw reservations until settlement; ignore late output and do not free capacity merely
because a caller stopped waiting. Provider-backed ports belong in composition.
Memory exports `createMemoryHandlers(input, predecessorCandidateId?)` and accepts
`createWorkerPort(handlers, limits)` in `createMemoryMonitor`. Composition chooses the
implementation; each opportunity runtime exclusively owns/disposes its fresh port and
awaits raw idle. The monitor retains freshness, dedupe and private sink handoff. Do not
construct a second generic executor for its registration metadata.

## Idempotency, dedupe and receipts

Document actual key, scope, capacity, reservation timing, release and uncertainty policy
for per-event, per-subject or module-ledger semantics. Runtime idempotency and overlap
dedupe are different protections. Reserve before async dispatch/handoff. No evicting
LRU/TTL for protection keys, unprotected uncertain retry or implicit persistence.

- References: runtime per-event protection plus host ledger. Versioned read port filters
  exact `(documentId, documentVersion)` full-exposure records in matching scope/source/
  grant; partial/unknown never suppress. Legacy callback is ID-only and suppresses all
  versions until host reset. New consumers should use the versioned port.
- Rules: runtime key hashes session/turn/sorted selected policy IDs; overlap ledger hashes
  session/turn/individual rule ID. Failed/non-run verification releases that reservation;
  prepared reminders remain consumed despite delivery failure. Verifier cap 8; missing
  view/lease/verifier or over-cap input cannot fall back to an unverified reminder.
- Memory: keys include scope/project/normalized subject, exact claim and sorted original
  evidence revision/span identities, not observation ID. Changed supported revisions
  can link a new candidate; mutation/conflict defers. Unknown sink acceptance consumes
  protection. Closed scopes are discarded, never carried. No restart durability.

A synchronous runtime report sink returns `ReportEnqueueReceipt` matching exactly
`monitoringReportId(report)`, with enqueued/failed/unknown status. `reported: true` means
**enqueue accepted**, not delivered/read/provider input. Hook delivery has a separate
`ReportDeliveryReceipt`. Prepared jobs are not rerun to repair receiver failure.
Memory's protocol-1 `ReviewSinkReceipt` matches candidateId and uses accepted-volatile,
refused or unknown. Acceptance means private in-process retention only: not viewed,
approved, durable, canonical, parent-visible or provider-delivered.

## Required tests and README

New module acceptance checks (reusable core suites may supply common coverage):

1. Declaration/settings/hash/public exports and official helper identity.
2. Required-need preflight failure before **any** factory, complete fake binding success,
   unsupported events/actions before construction, including at observe.
3. Observe default/no jobs or reports; ceiling/unknown-stage rejection; shadow withholding;
   explicit active only where permitted; off/host kill switch.
4. Malformed/extra-field/accessor frames without executing getters; denied/stale/unavailable
   source/grants; cancellation, late-output and lifecycle generation fences.
5. Deterministic results, overlap/capacity/uncertainty dedupe, matching/malformed/mismatched
   receipts; no false delivery/read/approval/persistence claims.
6. `runWorkerPortConformance`; plus `runReadRecordPortConformance` and/or
   `runReviewSinkPortConformance` for protocols used. Fake conformance does not qualify a
   real implementation or sandbox trusted callbacks. Custom ports need explicit probes.
7. Shared eval registration of the real module and **byte-identical repeated replay**,
   hash-bound declaration/config/question/material/script; scoring labels separate from
   runtime inputs. No model calls or semantic-quality claim required.

README information: purpose/non-goals; public API; declaration/stages; host bindings and
material/authority ownership; handler/worker path; limits/dedupe/lifetime; receipts/routes;
test commands/eval; compatibility/version changes; explicit UNVERIFIED limitations.
Equivalent grouped headings are fine; missing information is not.

## Checklist and existing deviations

P = present in supported path; D = deviation/compatibility restriction; H = host duty.
Evidence: module `src/index.ts`, README and tests; core `sdk/declaration.ts`,
`sdk/bindings.ts`, `host/input-port-registry.ts`; shared eval tests. This is not a claim
that every negative case lives in a separate per-module test.

| Checklist | References | Rule steering | Memory |
|---|---|---|---|
| Private package / public-core-only imports | P | P | P |
| Purpose/criteria / validated hash / empty settings | P | P | P |
| Runnable watch / bounded kinds/history | D: raw input, not origin-filtered | P: named tool/assistant | P: named finalized/steer |
| Explicit author maxStage | P: explicit active; observe default | P: observe | P: shadow |
| Explicit observe registration helper | P: off/shadow/active options | P: explicit off/observe; shadow/active reject at observe ceiling | P: off/observe/shadow |
| Required external need preflight | D: read optional unless versioned registration | P: custom policy validator H | P: sink required in configured preflight |
| Version-aware suppression | D: legacy ID-only callback retained | Not a read consumer | Not a read consumer |
| Standard worker path | P: returned handlers | P: separate handlers/injected verifier | P: exported handlers + injected per-runtime worker factory |
| Parent report receipt route | P: active only, sink H | D: declared modes, author ceiling intentionally observe only | P: never; private sink only |
| Dedupe/lifecycle authority | Per-event P; ledger reset H | Per-turn P; source freshness H | Per-subject P; source/currentness H |
| Preflight/stage/frame/capability checks | P: module + core | P: module + core | P: module + core |
| Port conformance | P: read + core worker | P: exported policy-registry/verifier suites + core worker | P: core sink/worker + module safety probes |
| Byte-identical shared eval | P: eval/test/references.test.ts | P: eval/test/rule-steering.test.ts | P: eval/test/memory.test.ts |
| README / commentary consistency | P: shipped module ownership + hash compatibility | P: observe default, ceiling-safe stage options + port suites | P: generic Pi attestation vs injected project authority |

Resolved in this batch: explicit references ceiling (active, still opt-in); ceiling-safe
rule registration/off, reusable registry/verifier conformance and default-stage comment;
exported memory handlers/injected worker ownership and README authority wording.
Remaining D rows are intentional compatibility restrictions: references raw input watch,
optional read need/legacy ID-only suppression, and rule-steering's observe-only author
ceiling (declared report modes do not authorize activation). Host duties remain explicit.
Pi-generic read-result attestation belongs in `hosts/pi`; project capture/catalog/admission
stays host-owned. All three READMEs describe compatibility; no published release matrix
or live-use/P5 approval is claimed. References' explicit ceiling changes its hash
(**BREAKING** for hash-bound artifacts); rule registration is now frozen (**BREAKING**
for mutation-based callers). No module policy is widened just to make the table green.

## Versioning and compatibility

Packages are currently private workspace `0.0.0`, not a published stability promise.
Binding versions differ: references/rules `2.1.1`, memory `1.0.0`; preflight demands an
exact requested version match. Track declaration/hash, question, settings, effective jobs/
stage, catalog/source revisions and fixture/trace schema together. Changes to purpose,
watch admission, identity, required needs, reports, ceiling, dedupe or output behavior
need explicit compatibility notes and regeneration of affected replay manifests/artifacts.
Never silently reuse artifacts, widen grants or auto-promote stage during upgrade.
Neutral input ports remain protocol 1; trace compatibility is separately versioned.
Future public release needs an explicit core/host/module matrix and real-host qualification.
