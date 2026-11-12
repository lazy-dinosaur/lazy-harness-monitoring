# Synthetic compaction DEV corpus (not holdout)

**Agent-authored conversations and labels; DEV-only; user review is required.** These fictional
sessions are not independent adjudication, a sealed holdout, or deployment evidence. The offline
stub is a mechanics check, not a semantic-quality measurement. No holdout was read or changed.

`regions.json` contains no labels. `labels.json` maps region ID → item ID → needed boolean.
Labels are joined only after selection. The unchanged `compaction-dataset.ts` closed schema
checks material/content/provenance shape, ID uniqueness, split identity and exact label coverage.
The generator's additional DEV checks reject hints, duplicate region texts, global uniqueness
below 95%, changing goals and broken read call/result sequences. Authoring-time validation checks
matching targets before rendering; the actual core renderer removes successful result bodies.

| Purpose | Regions | Needed | Not needed | Total items | Nothing-needed regions |
|---|---:|---:|---:|---:|---:|
| references (U1 gap-filler) | 20 | 36 | 77 | 113 | 4 |
| rule-steering (U6) | 20 | 33 | 74 | 107 | 4 |
| memory | 20 | 20 | 95 | 115 | 4 |
| **Total** | **60** | **89** | **246** | **335** | **12** |

There are **327 unique rendered texts / 335 = 97.61%**, no duplicate text inside any region,
and 5–13 items per region (within the 5–15 schema bounds). The only repeated rendered text is
`[tool result:read] ok`: nine successful reads share the status line required by core rendering.
Each read has its own target and a following matching result. There are needed items at the
start, middle and end for every purpose, and three long incident narratives with distinct
facts/structure rather than repeated filler. Normal core 800-character clipping still applies.
All frames use `message_end`: the latest item is the current user turn or assistant action
statement, including rule-steering's proposed action. These are not fabricated `tool_call`
frames with only a user request standing in for the current tool invocation.

## Fixed host configuration goals

Goals are **synthetic configuration choices**, not quotations of an existing production binding.
`modules/*/src/index.ts` exports purpose questions, not per-module goal defaults. In core,
`RealtimeSelectionOptions.goal` is supplied by the host (`packages/core/src/engine/monitoring-core-realtime-selection.ts:22`),
passed unchanged into compaction (`:191`), and shared when independent pipelines are created
(`:319`). The example host uses the fixed `Offline P1 review` (`examples/p1/support.ts:129`);
the Pi fixture similarly uses `Synthetic P3 pipeline qualification`
(`hosts/pi/test/support/pipeline.ts:28`). The module test hosts use toy configuration strings
(`modules/references/test/support.ts:40`, `modules/rule-steering/test/support.ts:55`), not current events.

The DEV host choices are declared in `packages/eval/src/compaction-generate-dev.ts:7–10`:

| Purpose | Fixed goal (identical across its 20 regions) | Purpose source |
|---|---|---|
| references | `Support project work with relevant project records.` | `modules/references/src/index.ts:9–13` |
| rule-steering | `Keep project actions consistent with provided project rules.` | `modules/rule-steering/src/index.ts:7–11` |
| memory | `Surface project facts and decisions for independent memory review.` | `modules/memory/src/index.ts:9–13` |

Current requests, action statements, record catalogs, decisions, historical context and completed
reads appear **only in region items**, rendered through the actual core `regionLines` function.
The compaction task receives instructions, this fixed goal, source-event metadata and region
items; it does not receive hidden document contents, a read ledger, policy-kind references,
`currentReferenceIds` or memory source attestations. Successful reads render as status only;
no result body is smuggled into the dataset. We do not claim final U1/U6/memory qualification.

## Gold policy and review cautions

- References: preserve the latest project-evidence request plus catalog/dependency/context items
  needed to identify its records and scope. Same-domain UI, prototype, draft, admin or other-file
  activity can be dropped when the current request does not rely on it. A completed read alone
  is not evidence of a missing source; read bodies are not available in this prompt.
- Rule-steering: preserve the provided rule, the latest assistant action statement, and exception
  or rollout context needed to assess that action. Demo/sandbox rules, historical failures and
  different-target actions are near misses. These conversations test relevance, not authority
  attestation or the later policy-kind/current-reference judgement.
- Memory: preserve the new user decision/correction and antecedents needed to resolve its scope.
  Assistant suggestions, prototype choices, local test changes and momentary display requests
  are near misses. A few final decisions extend an earlier rule to another target; both pieces
  are needed. User roles alone do not establish the runtime attestations required for persistence.
- Nothing-needed regions end in acknowledgements or transient operational/display requests.
  Their earlier topic matches do not create a current purpose-specific need.

Labels are conservative agent judgements, not objective truth. Review the full context, not
just isolated sentences. Some real operational observations may still be useful to a monitoring
module despite these labels; user review may change gold. The corpus remains small, authored,
correlated and biased toward clear decisions. Do not generalize its rates to live traffic.

## Rebuild after parent review (2026-11-12, option A)

This rebuild replaces e293b87's relevance-annotating tails, repeated noise templates, mislabeled
speakers and inconsistent tool events. It also removes event-specific requests/actions/read
state from `goal`. Near misses now distinguish actual files, owners, environments, time or
rules in ordinary conversation instead of explaining why they should be discarded. Wording,
lengths and structures vary across regions; long text is a coherent narrative, not filler.
Stage-1 evaluator, schema, scoring, metering and core/module behavior remain unchanged.

Regenerate with `bun packages/eval/src/compaction-generate-dev.ts`. Tests compare exact generated
objects to the committed data, check counts, schema, label isolation, hint phrases, uniqueness,
goal constancy, role/event shape, positional/long-item coverage and call/result pairing, including
negative cases. No randomness, model, network or dependency addition is involved.

A six-region review sample (two per purpose, all items and labels) is prepared separately at
`/tmp/compaction-dev-review.md`. The generator is the reproducible source; the sample is a local
review artifact, not part of the model input or an additional dataset split.
