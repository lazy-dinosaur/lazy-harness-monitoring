# P1 offline public-API examples

These are review fixtures for issue #1, not production modules or activation approval.
They import library symbols only through package exports; local imports share fixture code.
No real models, subprocess workers, knowledge writes or external network calls are used.

| Scenario | Exported fixture function | Canned runner |
|---|---|---|
| Reference assistance | `referenceAssistance` in `references.ts` | `runReferences` |
| Read-only rule advice | `ruleCorrection` in `rules.ts` | `runRules` |
| Private memory candidate | `memoryCandidate` in `memory-candidate.ts` | `runMemoryCandidate` |
| Repeated failing test advice | `repeatedTestFailure` in `test-loop.ts` | `runTestLoop` |

`support.ts` makes declarations, explicit grants, scripted native-classifier/worker bindings,
selection pipelines and job handlers, and manually forwards current selected packets into the
runtime. Reports are callback receipts, NOT proof of receipt in actual next model input.
Default memory mode is observe. Its separately opted-in synthetic shadow declaration prepares
an unapproved/unwritten candidate with report never; it is not an escalation of configuration.
The test-loop reducer is bounded fixture code, not a generic condition DSL or meaningful-edit oracle.
`api-consumer.ts` also verifies public Pi exports, legacy generated types and configured processor API.

## Run from repository root, no installs

```sh
bun examples/p1/prepare-local-links.ts
bun test packages/core/test/p1-trigger-boundaries.test.ts packages/core/test/p1-scenarios.test.ts packages/core/test/p1-api-host.test.ts
bunx tsc -p examples/p1/tsconfig.json
```

Dependencies must already be installed as in P0. Examples are not a workspace: the preparation
script creates three ignored `node_modules` symlinks to already-present **package roots**
(core, Pi, TypeBox). It checks existing targets and does not download/install, edit manifests/locks,
or bypass export maps with source aliases. Core test compilation transitively checks the examples;
the new tsconfig also includes them directly and inherits unchanged strict/noEmit settings.

The scripted decision can be `run`, `skip` or `defer`; the rule worker can deliberately fail.
See `packages/core/test/p1-scenarios.test.ts` for actual invocations and negative assertions.
The second adapter lives in `packages/core/test/p1-api-host.test.ts`; it uses no Pi context.

Read [the P1 review](../../docs/qualification/p1-api-condition-review.md) for exact coverage,
source citations, UNVERIFIED optional scenarios and proposed blockers. No source fixes are included.
