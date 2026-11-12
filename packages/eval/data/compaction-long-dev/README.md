# Synthetic LONG DEV — user review required

Rebuilt for PR #22 following the 2026-11-12 option-A review. This is authored
synthetic DEV, not production traces, an independent sample, or a holdout.
Review `regions.json` and the separate `labels.json` before measuring quality.
No model/classifier/provider inference calls were made during this rebuild.
Production implementation, existing DEV, and holdout data are unchanged.

## Reproduce and check (offline)

```sh
bun packages/eval/src/compaction-generate-long-dev.ts
bun test packages/eval/test/compaction-long-dev.test.ts
bun packages/eval/src/compaction-cli.ts --dataset long-dev /tmp/compaction-long-dev-offline.json
```

The generation source is dataset authoring, not runtime implementation. Gold
markers are removed before native `regionLines` rendering; labels never enter
model-visible source bodies, goals, or state. Goals are constant per purpose and
identical to existing DEV. Authoring and tests check speakers, paired read targets,
matching exchange IDs, whole-exchange labels, pins, hint exclusions, reproduction,
byte bounds, and label-independent runtime/evaluation task parity.

## Corpus counts

30 regions, 10 per purpose; **734 items**, 23–27 sources per region. Every region
exceeds the **8192-byte non-pinned budget** and fits the unchanged
**16384-byte / 32-source window**. Individual serialized sources fit 8192 bytes.
Bytes below measure serialized material content, exactly as the runtime does.

| Purpose | Needed | Not-needed | Pinned subset | Needed-index patterns | Non-pinned bytes/region | Total bytes/region |
|---|---:|---:|---:|---:|---:|---:|
| references | 49 | 196 | 20 | 10 | 10351–12609 | 10668–12970 |
| rule-steering | 51 | 193 | 20 | 10 | 10447–12148 | 10845–12412 |
| memory | 53 | 192 | 20 | 9 | 10379–11830 | 10803–12075 |

Pinned items overlap gold totals: newest user request and assistant action, two
per region. Each purpose includes one region with **only pinned gold**. Needed
counts are {2,3,4,6,7} for references and {2,4,6,7} for the other purposes.
All purposes include needed items at start, middle, and end of the non-pinned
history. Across all 30 regions there are **27 distinct needed-index patterns**
(indices are 1-based; repeated patterns are allowed, but at least 20 are required).
Needed **and** noise kinds in every purpose are user, assistant, and tool exchange.
Both gold and noise include short (<=300 characters) and long (>=600) items in
every purpose; role or length alone cannot identify the labels.

## What was fixed

- Replaced the repeated scenario prefix plus observation bank with 30 distinct
  problems: captured voucher cancellation, researcher identity merges, fare-cap
  timing, font licenses, witness promotion, tape recalls, private DNS, sensor
  calibration, sealed bids, cold-chain probes; payroll, webhook signatures,
  appointment claims, irrigation interlocks, release digests, conservation access,
  tournament signatures, donor privacy, permit boundaries, certified artifacts;
  museum accessions, weather retention, cooperative credit, language partners,
  water measurements, historical spellings, clinic allocation, planetarium
  bookings, seed freshness, and rescue callsigns.
- Earlier catalog entries, incident evidence, rules, decisions, confirmations,
  and read attempts have different counts, ordering, positions and spreads.
  No universal item-6/item-12/item-13/item-22 gold template remains.
- Noise mixes user requests/chatter, assistant discussion and report excerpts,
  paired reads of workshop notes/test reports/archived project records, same-topic
  version/scope/owner near misses, and statements from retired prototypes or
  other operational contexts. Long numeric excerpts occur in gold as well as noise.
- Replaced exact-text uniqueness as the sole diversity test with normalized
  near-duplicate checks and explicit count/position/kind/length checks. Regression
  tests deliberately recreate repeated openings, changed counters/suffixes,
  cross-region repetition, fixed gold indices, and assistant-only distributions.

## Near-duplicate metrics and interpretation

Normalization removes role tags, folds case/whitespace, and masks numeric runs.
Two items are near-duplicates when their first sentence matches, or they share
at least a 60-character prefix. Every region must have zero such pairs. Globally,
at most 5% of items may participate in any near-duplicate pair (an affected-item
ratio, **not** a fraction diluted by all possible pairs).

- Within-region near-duplicate pairs: **0**.
- Global affected items: **30/734 = 4.0872%**, below 5%; **435 pairs**.
- All those repeats are the unchanged native successful-read rendering
  `[tool result:read] ok`, once per region. They are not narrative padding.
- Exact rendered texts: **705/734 distinct (96.05%)**. We intentionally do not
  append invented suffixes to native successful-read statuses to inflate uniqueness.

## Limitations / explicit deviation

These remain authored, compositional conversations with deterministic synthetic
bench measurements. Measurement values are illustrative, not calibrated facts;
shared worksheet/report conventions and an unchanged two-item pinned ending
remain. Prefix/sentence checks are a regression guard, not proof of semantic
independence; they do not detect paraphrases or establish representative quality.
Gold is an author judgment about monitoring context, including pending record
access and decisions proposed for independent review, not a claim that an offline
read succeeded or that an assistant proposal is an adopted user decision.

**Long raw tool-result bodies cannot be admitted without changing the existing
projection:** native `regionLines` emits success status only, or a bounded error
summary. This rebuild preserves that implementation and existing quality rule.
Long tool/report excerpts therefore appear as assistant-quoted output (and some
user-provided extracts), with truthful speakers, while actual read exchanges retain
their native status/error rendering. Test *report files* are read; the corpus
does not pretend a `read` tool executed a search or test command. This is a scoped
deviation from the request for long tool-output noise, not hidden runtime changes.

Review sample (outside Git): `/tmp/compaction-long-dev-review.md`, two regions per
purpose, every rendered item with gold label and pinned flag. It includes both a
context-heavy and a pinned-only case in each purpose. Human review must resolve
label disagreements before any model-quality claim; the stub dry run proves only
pipeline and policy behavior. No holdout conclusion follows from LONG DEV.
