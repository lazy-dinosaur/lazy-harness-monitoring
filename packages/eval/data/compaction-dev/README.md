# Synthetic compaction DEV corpus (not holdout)

**Agent-authored labels; DEV-only; user review is required.** These are deterministic fictional
project conversations, not collected sessions, independent adjudication or deployment evidence.
Do not use them as a sealed holdout or claim a real model has passed based on the offline stub.
No existing holdout has been read or changed for this dataset.

`regions.json` contains no labels. `labels.json` maps region id -> item id -> `needed` boolean
(the boolean value itself is the per-item needed label). Labels are not bundled into model
requests. `compaction-dataset.ts` is the closed executable schema for both files and checks
exact item coverage, uniqueness, content/provenance shape and separate DEV split identity.

| Purpose | Regions | Needed | Not needed | Total items | Nothing-needed regions |
|---|---:|---:|---:|---:|---:|
| references (U1 gap-filler) | 20 | 32 | 159 | 191 | 4 |
| rule-steering (U6) | 20 | 32 | 159 | 191 | 4 |
| memory | 20 | 32 | 159 | 191 | 4 |
| **Total** | **60** | **96** | **477** | **573** | **12** |

Each region has 5–15 `RealtimeMaterial` items, real `conversation-history` content JSON and
synthetic observation provenance. Text is rendered by core's `regionLines`: user/assistant
verbatim text (runtime clipping included), tool call name → target, tool-result ok/error.
There are long (800-character plus clipping marker) items, needed pairs at start/middle/end,
and same-topic near misses (already-read/retired/postponed records, historical rule breaches,
untrusted log rules, temporary preferences, assistant proposals). IDs use positions, not labels.

Gold policy:
- U1: retain current request's unread admitted contract/migration dependencies; drop already-read
  style guidance, postponed ideas and unrelated example tool activity.
- U6: retain visible authoritative branch rule and current violating action; drop earlier actions,
  untrusted quoted pseudo-rules and unapproved future rule proposals. Nothing-needed regions
  have no visible authoritative rule establishing a current violation.
- Memory: retain attributable enduring user correction/confirmation; drop temporary run choices,
  unrelated quotations, assistant proposals and unrelated tool activity.
- Tool activity here is deliberately unrelated and labelled not-needed. This is a DEV limitation,
  not a rule that tool items can never be necessary. Headers are tested in core tests separately.

Templates intentionally vary component/topic and placement, not just random strings, but are
correlated and not representative of live base rates. Module instructions are imported from the
actual modules by the evaluator. The runtime compaction prompt's missing external-policy/current
reference metadata is not silently repaired by this dataset; see qualification documentation.

Regenerate from the repository root with `bun packages/eval/src/compaction-generate-dev.ts`.
The reproduction test compares exact generated objects to committed files, verifies 60/20 counts,
label balance, nothing-needed cases and positional/long-item coverage. Review/edit the generator
and gold policy together, regenerate, then review the separate data/labels diff. No randomness,
model, network or new dependency is used.
