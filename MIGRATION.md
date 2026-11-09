# Migration from lazy-harness

Source: the lazy-harness repository branch `work/monitoring-engine-v2` (commit `18bd0c8`). Records stay there: `.lazy-harness/planning/monitoring-engine-concept-v2.md` (concept),
`.lazy-harness/planning/monitoring-core-live-integration-plan.md` (execution log),
`.lazy-harness/spec/platform/monitoring-core.md` and `pi-monitoring-observation.md` (contracts),
`.lazy-harness/tests/monitoring-*.md` (acceptance), ADR 0061 / 0062.

Order (each step keeps its own tests green before the next):

1. **done** (`packages/core`: 30 source files from the v2 engine closure, 13 test files / 159 tests green, `tsc` clean; tests that need the real Pi SDK fixture or v1 examples wait in `packages/pi-host/test/pending-from-core/`) `packages/core` — `packages/lazy-harness-pi/monitoring/*` (public SDK, schema, declaration, trigger points, canonical JSON, models) and the engine scripts `.lazy-harness/scripts/monitoring-core*.ts`, `monitoring-engine-*.ts`, `monitoring-trace.ts`, redaction; tests `tests/lazy-harness/monitoring-core*.test.ts`, `monitoring-engine-*`, `monitoring-trigger-points`, `monitoring-trace-stage`, `canonical-json-parity`, package monitoring tests.
2. `packages/pi-host` — `packages/lazy-harness-pi/extensions/lazy-harness/monitoring-observer.ts` (+ monitoring extension wiring), Pi worker adapters, SDK fixtures.
3. `modules/references`, `modules/rule-steering` — `monitoring-module-references.ts`, `monitoring-module-rule-steering.ts`, U6 question/gold helpers.
4. `packages/eval` — replay/label/seed/measure runners (`monitoring-session-*`, `monitoring-u1-*`, `monitoring-u6-*`, `monitoring-e2e-*`, `monitoring-region-stats`, `monitoring-retrieval-poc`, quality/model-comparison), merged into one shared tool.
5. `modules/memory` — new module, observe/shadow first.
6. lazy-harness keeps a thin consumer only.

Evidence files (`.lazy-harness/evidence/monitoring-core/**`, 155) stay in lazy-harness; only fixtures needed by moved tests
are copied.
