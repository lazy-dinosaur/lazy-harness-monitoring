# Synthetic evaluation fixtures — not session data

Every body, snapshot, session, document, rule, tool-call ID, output and label here is invented for offline mechanical tests. No actual project session/transcript or provider response was imported.

- `modules.json`: four read-only review declarations plus explicit evaluation ceilings and knobs. References and rules have versioned synthetic host material. Memory permits only observe/shadow and never reports to the parent. The loop example has no knowledge material.
- `dev.json` / `holdout.json`: each has an initial session frame and nine non-initial frames, with disjoint IDs and body variants. Native classifier outputs are scripts, NOT ground truth or live model calls.
- `dev.labels.json` / `holdout.labels.json`: evaluator-only lists of 36 independently enumerated module/frame opportunities and nine eligible module/point/frame trigger tuples per split. Dev includes one unresolved reference case. These files are never accepted as replay input.

The labels and outputs were authored as tiny mechanical fixtures, not blinded human adjudication. “Holdout” tests split identity plumbing; it is published, has been inspected, and is **not** an independent frozen P5 acceptance set. All four scenario patterns share the same replay, runtime, scoring and comparison functions. The stub loop response stands in for a module's future command-correlation/repetition logic; it is not a shipped temporal detector. Likewise these declarations do not implement the production reference/rule/memory modules.

Changing a source frame requires a new source dataset hash in its label file. Changing only a stub output changes `stubOutputsHash`, not source dataset identity, allowing an explainable same-source comparison. Neither script contains a scoring-label field. Do not tune production quality or infer semantic acceptance from these canned outcomes.
