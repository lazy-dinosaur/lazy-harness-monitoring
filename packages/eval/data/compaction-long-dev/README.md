# Synthetic LONG DEV — user review required

Agent-authored compositional DEV fixture, not production traces or a holdout.
Review both regions.json and the separate labels.json before measuring quality.
No real model/classifier/provider calls were made.

Generate: `bun packages/eval/src/compaction-generate-long-dev.ts`.
Validate: `bun test packages/eval/test/compaction-long-dev.test.ts`.
Offline: `bun packages/eval/src/compaction-cli.ts --dataset long-dev /tmp/long-dev-offline.json`.

30 regions, 10/purpose, 23 items each; 690/690 distinct rendered texts. All exceed
the default 8192-byte non-pinned compaction budget and fit the 16384-byte/32-source
material window. Core regionLines renders correct speakers and status/error-only
results. Authoring checks call/result target pairing before rendering. Tests reuse
the existing DEV hint/duplicate/uniqueness/constant-goal/conversation checks.
Gold labels never enter model-visible state or source bodies.

| Purpose | Needed | Not-needed | Pinned subset | Non-pinned bytes/region | Total bytes/region |
|---|---:|---:|---:|---:|---:|
| references | 40 | 190 | 20 | 13402–13929 | 13695–14222 |
| rule-steering | 40 | 190 | 20 | 13299–13901 | 13593–14195 |
| memory | 30 | 200 | 20 | 13382–13809 | 13688–14115 |

Pins overlap gold totals. Final user request and assistant action are pinned;
earlier catalog/rule/preference context must survive selection. Failed reads do
not imply the document was read. Per-purpose goals are fixed, shared with DEV.

**Limitations:** concrete scenario bank composed with authored operational
observations; unique text still shares investigative structure and phrasing.
Most bulk is assistant narration. This is not semantic independence or proof of
representativeness. User review must resolve gold disagreements before any quality
claim. Existing DEV data and holdout files are not rewritten.
