# Offline reference composition

Private workspace `@lazy-harness/monitoring-example-composition`. Copy this structure,
not its toy authority decisions, into a future host composition. See the
[module](../../docs/design/module-contract.md) and
[attachment](../../docs/design/attachment-contract.md) contracts.

## What it composes

`createComposition()` uses all three official registrations: references observe,
rule-steering fixed observe, memory observe. It completes real public-core preflight
before constructing runtime/workers or installing hooks. References uses the versioned
read port (required need and updated declaration hash), never legacy ID-only suppression.
Every external port is in memory: read records, volatile review sink, admitted invented
policy registry/custom validator, scripted judge/verifier, bounded handler worker, memory
original-decision sidecar, catalog and enqueue-only report sink. No new external dependency.
Core bridge needs are recognized by preflight; this fixture does not run the selection
bridge or a judge. The dummy judge binding is never invoked. Opportunities/selected toy
documents and run decisions are hand-scripted, not inferred from text or labels.

`createFauxPi` runs ordered public-shaped hooks. Generations install first, observer next,
`attachPiFrames` last. Actual Pi observer snapshots reach the composition target. Hooks
return undefined; report collection is not delivery or parent injection. Memory owns its
own handler/runtime; the other runtime owns its worker (never shared).

## Run and opt in

```sh
bun install --frozen-lockfile
bun test examples/composition/test hosts/pi/test/read-attestation.test.ts
bun run typecheck
```

```ts
import { createComposition } from '@lazy-harness/monitoring-example-composition'
const composition = createComposition() // observe only
// Use composition.pi.emit(name, event, fauxObservationContext), then await idle().
await composition.close()
const optIn = createComposition({ referencesStage: 'active', memoryStage: 'shadow' })
// References may enqueue reports; memory only prepares private volatile review candidates.
await optIn.close()
```

Tests prove missing required bindings reject before any factory; full fakes succeed;
unsupported capabilities fail; observe has zero worker admissions/reports/source captures/
private candidates; one explicit active/shadow opt-in separates both routes. They exercise
reusable read/review/worker conformance and control/session replacement fences.
`killSwitch: true` sets off where supported; `close()` is the terminal live kill switch
for all modules, including fixed-observe rules. There is no dynamic reactivation API.

## Lifecycle and limits

The example serializes opportunities (64 pending maximum), uses finite worker queues/lifetime and core fake
bounds, and closes the entire composition on control boundaries or replacement sessions.
It clears volatile reports/read/review data and fences queued work. It deliberately does
not carry contents or resume after compaction: construct a new composition after success.
The caller must close/await idle even after a failed or cancelled test.

UNVERIFIED: real SDK attachment beyond existing adapter qualification, source admission,
permissions, selection quality, actual read provenance, real provider/model invocation,
final provider-input delivery, private UI, raw backend termination, performance, restart
persistence and canonical writes. No live attachment, host project records, model calls,
network inference or deployment is performed. The separate lazy-harness thin consumer is
deferred by user decision; this is its copyable offline skeleton, not its implementation.
