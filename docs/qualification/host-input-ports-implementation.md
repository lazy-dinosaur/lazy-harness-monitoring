# Host input ports — implementation qualification

## Scope and ownership

Implemented on `feat/host-input-ports`, based on `origin/main` at
`8ff99ce1e5013a15627341371334359af8ce4023`. The approved split-ownership C design
was read from `origin/design/memory-and-host-ports:docs/design/host-input-ports.md`
and `origin/design/memory-and-host-ports:docs/design/memory-module.md`.
This branch does not copy or revise those design-only documents.

- Core owns neutral versioned envelopes, validation, need preflight, reusable
  synthetic conformance and in-memory fakes.
- `hosts/pi` owns lifecycle generations only. It reads public session/leaf identity
  from hooks; it does not interpret tool success as document exposure.
- The consuming host owns authoritative read records/exposure receipts,
  document catalog/version resolution, policy registry validation/admission, and
  the private memory review UI/sink. None of those real sources is implemented here.

No external dependencies, source discovery, live data, generative worker,
parent injection, canonical memory write, disk review storage or memory-module
activation is introduced. Omitted stage stays observe; active remains explicit.
The future memory module must start observe-only with ceiling shadow; this port
alone does not register it or authorize preparation.

## Public API

All port contracts are exported from `@lazy-harness/monitoring-core/host`:

- `InputPortScope`, `InputPortGenerationProvider`, `InputPortContext`;
  scope includes session ID, binding generation, branch anchor ID/generation,
  compaction generation. Undefined provider scope fences all work.
- `ReadRecordPort`, `ReadRecordRequest`, `ReadRecordSnapshot`, `ReadRecord`,
  `ReadDocument`, `ReadRecordLookup`; protocol version is **1**, independent of
  opaque document/source/grant revision strings.
- `validateReadRecordRequest`, `validateReadRecord`,
  `validateReadRecordSnapshot`, `evaluateReadRecordSnapshot`.
  Evaluation is pure; consumers must additionally call `port.isCurrent` directly
  before using results. A snapshot's `available` status alone is not freshness.
- `ReviewCandidate`, `ReviewSinkPort`, `ReviewSinkReceipt`,
  `validateReviewCandidate`, `validateReviewSinkReceipt`. Candidate schema is `memory-candidate/v1`, review-only,
  explicitly not approved/not written. Evidence refs and exact claim text are
  supplied and attested by the host, not generated or independently authenticated
  by these schemas. This is a minimal neutral envelope, not the entire future
  memory module's provenance/eligibility/preparation schema.
- `HostInputPortBindings`, `HostInputPortRegistry`, `HostInputPortDefinition`,
  `HostInputPortBinding`, `standardHostInputPorts`, `validateRequiredInputPorts`.
- `createInMemoryReadRecordPort`, `createInMemoryReviewSinkPort`;
  `runReadRecordPortConformance`, `runReviewSinkPortConformance` and their harness
  factory types. Synthetic context/record/request/candidate builders are exported
  solely for fake-backed conformance, not production evidence.

`MonitoringHostBindings.inputPorts` maps **module ID → need ID → binding**.
Each binding names the exact adapter, protocol version and explicit port object.
`inputPortRegistry` admits host-defined adapters using a protocol version and
validator. Standard read/review adapters cannot be overridden by host validators.
A validator accepting a policy object is the host's responsibility; core does not
load or authenticate policy data. `region.compact` and `judge.view` are supplied
internally by the existing engine bridge flags, not lifecycle input ports.

Example using only a fake:

```ts
const fake = createInMemoryReadRecordPort({ context: syntheticInputPortContext })
const inputPorts = {
  'toy.module': {
    reads: { adapter: 'session.read-records', protocolVersion: 1 as const, port: fake.port },
  },
}
```

## BREAKING — required needs now checked before factories

Needs default to **required**. The additive declaration field `optional: true`
explicitly preserves an optional need. Missing required ports, unknown adapters,
wrong adapter/version or invalid port objects throw `MonitoringConfigurationError`
with code `BINDING_MISSING` and a message naming module, need and adapter.
All enabled configured module entries are validated before **any** factory runs,
including when stage is observe/off. Modules declaring no needs are unchanged.
Low-level runtime constructors remain trusted mechanics, not configured preflight.

Affected shipped modules:

| Module | Need | Decision |
| --- | --- | --- |
| `context.references` | `already-read` → `session.read-records` | Explicitly **optional** in default binding, preserving legacy stateless behavior. Version-aware official registration makes it required in its returned declaration and validates its supplied port. |
| `rules.steer` | `rules` → `policy.registry` | **Required**; configured users must supply both an admitted registry descriptor/validator and a matching explicit port. This is BREAKING even in observe. Existing synthetic tests bind a fake, not a real policy source. |
| references/rules | `region.compact` / `judge.view` | Engine-owned, automatically satisfied by existing bridge implementation. |

The core declaration fixture's historical custom `policy.source` adapter now also
binds an explicit fake and validator. Custom modules with previously unchecked
needs must bind them or explicitly declare the need optional. Unknown adapter IDs
are rejected even for optional needs; a known optional adapter may be absent.

## Read behavior, freshness and bounds

Records name session/binding/branch/compaction, document ID **and version**, source
event/cursor, source record ID/revision, namespace, admitted source/grant revision,
and an exposure kind plus attestation ID. Full successful exposure of the exact
revision alone can suppress. Partial/unknown exposure never suppresses a whole
document. Tool completion, worker preparation, enqueue and delivery receipts are
not read evidence. Record replay is idempotent; changing bytes under the same
scope/document/version/source-event identity, including exposure kind, refuses.

Empty complete snapshots yield not-read. Unavailable, incomplete, revoked,
wrong-scope or stale snapshots yield unknown; references' opt-in path rejects/
defers delivery instead of silently using its stateless fallback. Snapshot records
are immutable copies. Cancellation, current source/grant revision and captured
cursor are checked. A late scope change fences in-flight snapshots and ingestion.
No TTL or lexical version ordering is invented.

Read fake ceilings: 4,096 identities, 1 MiB record metadata, 32 requested revisions,
one in-flight snapshot. Tests may lower count/byte limits. Overflow refuses and
marks the scope incomplete rather than evicting protection or pretending empty.
The snapshot envelope also has a 1 MiB serialized bound; at the envelope boundary,
validation may refuse rather than advertise completeness.

Review fake ceilings: 128 candidates, 1 MiB serialized bodies, 16 KiB per candidate,
2 KiB UTF-8 claim, 8 evidence refs. Identical dedupe identity/bytes returns the same
matching `accepted-volatile` receipt; mutation, capacity, cancellation, stale scope
or source/grant mismatch refuses. Candidate IDs cannot be reused under another
key. There is no dequeue or body-disposal API, so retained keys are bounded by the
128-body cap, stricter than the design's separate 4,096-key ceiling. No eviction,
persistence, automatic retry, parent-report or read-ledger connection exists.
Acceptance means volatile retention, not viewed/approved/written/provider-read.
`unknown` is reserved for host implementations with uncertain acceptance.

Both fakes lazily clear data on the next operation after a scope/source/grant or
availability change, and clear immediately on explicit close. They retain no
cross-scope index. Hosts must supply monotonic generations and close fakes at
scope disposal if immediate release is required; these fakes do not subscribe to
host events themselves. Production source authority and UI lifetime remain host
responsibilities.

## Pi lifecycle and references integration

`@lazy-harness/monitoring-host-pi` exports `createPiInputPortGenerations` and
`PiInputPortContext`. Install its `extension`; consult `current()` from host port
context providers. Before switch/fork/tree/compaction fences the scope. Tree and
successful compaction establish fresh bumped generations. Failed compaction stays
unknown until a successful context transition; there is no automatic ledger
restore or failed-operation revalidation API. Session replacement bumps binding
identity; shutdown and explicit close fence it. Old extension owners cannot close
new sessions. Normal message leaf appends are not branch navigation and do not
reset suppression. Branch ID is a navigation anchor, not a changing event cursor.
Explicit close is permanent for that helper.

`createReferencesRegistration({ alreadyRead })` returns handlers preserving
ID-only legacy suppression. `createReferencesRegistration({ readRecords: { port,
request } })` returns version-aware handlers; the host builds the request from
captured lifecycle/cursor/source/grant context. Supplying both refuses. Registration
returns `handlers` for explicit runtime/worker composition; callers must use those
handlers rather than the old stateless singleton. The existing
`createReferencesHandlers(callback)` and `referencesHandlers` APIs remain.
Neither callback nor richer port is populated by preparing a report.

## Qualification and limits

Tests: `packages/core/test/host-input-ports.test.ts`,
`hosts/pi/test/real-sdk-input-ports.test.ts`,
`modules/references/test/read-record-port.test.ts`, plus updated declaration,
references and rule-steering startup tests. They use invented material, the
existing real SDK's in-process faux provider and no live provider/network source.
Reusable conformance includes exact-version isolation, immutable snapshots,
replay/mutation, incomplete cursor, source/grant freshness, partial coverage,
generation resets, cancellation, byte/count caps, delayed compaction response,
single-flight accounting, volatile receipts and disposal. Broken ID-only sources
carrying old-generation records and mismatched sink receipts are negative controls.

Execution summaries belong in the worker's final report, not committed experiment
artifacts. These are mechanical synthetic checks, not semantic evaluation results.

**UNVERIFIED:** real exposure attestation, real policy/catalog adapters, host UI,
production source/grant revocation subscriptions, failed-compaction revalidation,
complete future memory eligibility/provenance schema, memory worker/output
observation wiring, live provider input, usefulness, performance and restart/disk
durability. No push or GitHub writes are part of this implementation.
