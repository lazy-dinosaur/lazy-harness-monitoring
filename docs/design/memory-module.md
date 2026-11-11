# Memory module — private durable-memory candidates, never writes

## Status and evidence boundary

**DESIGN ONLY — for approval.** This is a design for a new module, not an implementation or activation decision. All future behavior, fields, contracts, limits, defaults and recommendations in the PROPOSAL sections are **PROPOSAL**. Source line numbers, phase IDs, version names and decision identifiers are not measurement claims. No code, tests, model calls, dependency changes or experiment artifacts are supplied.

Base: `origin/main` at `8ff99ce1e5013a15627341371334359af8ce4023`, containing the rule-steering merge; no fallback branch was needed. The P5 plan is absent on this base and was read via `git show origin/qualification/p5-plan:docs/qualification/p5-plan.md`, at branch tip `398042c0963d50e5f4b20c5aa560708388abb69b`. Its older references/rules placeholder inventory is not current source truth. No harness evidence, real conversations or actual memory records are copied here.

**User constraints:** D1' forbids module/repository Fabric dependencies; omitted run stage is observe and active requires explicit selection; memory stays observe/shadow with no context injection and no writes until separately approved. Synthetic data only. Experiment results are never committed. Accepting this design does not approve implementation, measurement, calls, persistence or deployment.

## Existing evidence and constraints

| Evidence | Established fact / design constraint |
|---|---|
| [MIGRATION.md](../../MIGRATION.md), step 5; [memory manifest](../../modules/memory/package.json) | Memory is a **new** `modules/memory` module, observe/shadow first. On this base the package is a manifest-only placeholder, not a registered runtime implementation. |
| [Scenario C](../qualification/scenarios.md#c--reviewmemory-candidate-read-only-memory-review), lines 41–51 | Review fixture: enduring project fact/rule, exact evidence, independent review; deterministic template, read-only candidate, per-subject key, report never; distinguish detection from approval and persistence. Observe has judge/trace only; shadow can prepare privately. These are scenario proposals, not shipped memory behavior. |
| P5 plan, “Module protocol”, memory row, and migration batch D (lines 51, 66) | Proposed maximum observe/shadow, fail closed on unverified approval, private receipt, no knowledge writes or parent injection. Observe alone cannot establish prepared-candidate receipt quality. |
| [Declaration](../../packages/core/src/sdk/declaration.ts), lines 17–46, 102–114 | Template/read-only/candidate/per-subject/report-never vocabulary exists. Omitted stage is observe; config can lower, not raise, the author's ceiling. Cost caps in this schema must be positive; a literal zero cap is not how to declare a no-model template. |
| [Runtime](../../packages/core/src/engine/monitoring-engine-runtime.ts), lines 17–22, 155–204 | `Trigger.evidence` has id/kind/version/text, not complete provenance or branch metadata. Observe skips jobs; shadow runs read-only jobs and withholds reports. Subject key is host-supplied. Runtime outcomes do not carry `JobResult.output`. |
| [Source projection](../../packages/core/src/engine/monitoring-core-source-projection.ts), lines 141–156; scenario C | Current Window approval projection explicitly yields `originVerified: false`, `association: 'unresolved'`. Having original user text is not an authenticated approval. Do not weaken this guard to obtain a run. |
| [Pi observer](../../hosts/pi/src/observer.ts), lines 6–9, 45–76, 105–169; [host contract](../../packages/core/src/host/contract.ts), lines 8–20 | Host provides bounded snapshots and ordered frames with session identity; host capabilities describe events/actions/snapshot depth, not memory approval or persistence. Snapshot text/role is insufficient authority. |
| [R7 design](../qualification/p2-reliability-review.md#r7-restart-durability--design-only-not-an-implemented-api), lines 254–340 | Runtime/idempotency/budget/mailbox state is process memory; persistence port/recovery/fencing are proposed, not implemented. Diagnostic retention is not protection or restart durability. |
| [Evaluation contracts](../../packages/eval/src/contracts.ts), lines 16–43; [replay](../../packages/eval/src/replay.ts), lines 118–142; [score](../../packages/eval/src/score.ts), lines 7–14, 30–67 | Evaluator admits the built-in stub binding, has a private-candidate flag and synthetic receipt path, and labels positive/negative/unresolved opportunities separately from replay input. This does not qualify a real memory module, useful candidate content, independent sink receipt or real timing. |
| [README D1'](../../README.md#worker-and-runtime-boundary-d1) | Core owns neutral worker execution/conformance; lazy-harness composition owns the exact-pinned Fabric implementation outside this repository. Fabric is not memory storage or a provenance source. |

## PROPOSAL — purpose and non-goals

Observe agent events to **PROPOSE potentially durable project memory candidates** for later independent human/host review. “Durable” describes the intended lifetime of a claim, not storage performed by this module. Candidate detection, host-attested source authority, human acceptance and canonical record persistence are distinct decisions.

Do not write files, databases, knowledge graphs, policy registries or canonical records; do not inject into parent context, steer, block tools, execute advice, approve a claim, or auto-promote candidates. A user saying “remember this” is evidence to review, not authorization for the module to write. A later approval workflow belongs to the host and requires its own gate.

**PROPOSAL module identity:** `review.memory-candidate` as the initial explicit evaluation/runtime mapping, subject to user approval. The manifest package name already exists; no public memory symbol, exported declaration, registration helper, configuration key or eval registration is added by this document. Do not silently merge historical `knowledge.candidate` labels with this new purpose.

## PROPOSAL — trigger and material protocol

| Point | Role in the proposed module |
|---|---|
| `user.message` | Judge finalized expanded user content only when the host proves the original user source and decision attribution. Primary opportunity for a durable decision/fact. |
| `assistant.message` | Inspect finalized claims for possible review needs, but never treat assistant assertions, quoted approval or summaries as approval evidence. Assistant-only durable claims defer. |
| `turn.end` | Reconcile the bounded completed region when evidence was distributed across messages. Repeated same-subject observations must not create another candidate. |
| `user.steer` | Reset pending intent; re-evaluate or invalidate affected candidates against new attributable evidence. No automatic rewrite of an already reviewed record. |
| Session/branch/compaction lifecycle | Host control input fences old in-flight work, drops stale unprepared candidates and opens a new scope. Not a module judgement watch. No implicit carry across a summary. |

The named point mapping and watchability distinction exist in [trigger-points.ts](../../packages/core/src/sdk/trigger-points.ts), lines 47–102. `model.before-call`/`context_with_system` is delivery-only; session compaction/tree/start are control-only, not runnable watches. **PROPOSAL:** watch only the first four named points above; ingest control frames through host lifecycle wiring. If provenance is unavailable at `user.message`, defer; do not replace it with a raw-hook predicate to bypass admission.

**PROPOSAL admitted kinds and grants:**

- `user-text`, `assistant-text`, bounded `conversation-history`: exact visible bodies with source event/revision and actor provenance. No hidden thinking, provider headers, images or arbitrary raw tool details.
- Optional `project-policy`: explicitly admitted versioned host policy material, with authority scope/provenance; kind names do not attest approval.
- Optional `prior-candidate`: host-projected bounded metadata/exact excerpts for dedupe or conflicts. Status is explicitly unapproved; it cannot support a claim's truth or approval. Initial default is local deterministic dedupe without feeding candidate bodies into the judge.
- Binding/job grants admit only the kinds actually required. Use core's `monitoring.selected-material` handoff if needed by approved composition; grant no `inject-context`, `steer`, `block-tool-call`, knowledge-write or arbitrary SDK/network capability. A new need name is not an implicit grant.
- Proposed host inputs: an admitted provenance/approval lookup and a subject/scope key builder. Proposed output: a volatile candidate-review sink. Their names and schemas need approval; they are not current `needs` adapters. Follow [split port ownership](host-input-ports.md), not harness filesystem imports in the module.

**PROPOSAL:** capture identity, revision, permission and provenance at selection, and revalidate at preparation and sink acceptance. Denied, missing, changed or unattributable material cannot be repaired by the judge. The current `EvidenceItem` loses richer metadata; retain an immutable host-owned sidecar keyed by exact material ID/version and trigger/scope, or separately approve a neutral envelope extension. Never infer provenance from `kind`, role, body wording or `Trigger.eventId` alone.

## PROPOSAL — judgement and deterministic gates

**Primary question:** “Does this current event establish a new, attributable, potentially enduring project fact or decision worth independent memory review, supported by exact admitted evidence, rather than a transient request, duplicate or speculative assistant claim?”

| Decision | Explicit criteria |
|---|---|
| **Run** | A bounded claim is useful beyond the current turn, has exact source support and known project scope, is not an unchanged duplicate, and has host-attested original decision attribution or trusted approved-record evidence. Run only proposes review; it does not establish universal truth or permission to persist. |
| **Skip** | Acknowledgement, transient status/test output, general public knowledge, fleeting instruction, unsupported need to store anything, or exact unchanged duplicate with an already pending review candidate. A clear absence of durable material is skip, not defer. |
| **Defer** | Plausibly lasting claim but partial/conflicting evidence, unclear scope/subject, assistant-only support, unresolved source association, missing permission/revision, or unverified alleged approval. Emit a bounded diagnostic reason, not a candidate. A conflict can be shown later as contested review material only if its provenance is independently established and the policy is separately approved. |

**PROPOSAL deterministic preconditions:** permission, scope, source-version match, host approval/attribution eligibility, complete evidence span, bounds and dedupe are checked outside the semantic judgement. A `run` answer cannot override them. Required-role rejection in the current projection is a blocked/deferred opportunity, not a reason to remove the evidence guard. Do not promise run-capable approved-decision detection with today's unresolved Window projection.

**PROPOSAL reference selection question:** “Is this exact source span necessary to support or contest this candidate at the current revision?” Keep only directly supporting/contesting material, not all recent messages. It remains a typed data judgement, not generated text. Confidence is never a success oracle or substitute for a grant. No judgement or model call is authorized by this design.

## PROPOSAL — worker, stage ceiling and output destination

**PROPOSAL worker:** deterministic `prepare-candidate` template; `riskTier: read-only`, `output: candidate`, `idempotency: per-subject`, supported/default report **never**. It copies validated source spans and metadata into the candidate envelope and returns `prepared`; it does not invent a summary, generalize a quote or call a generative worker. **PROPOSAL: 0 generative calls**, no embedding/SDK/network calls in preparation, no retry or model fallback. Any future typed judge calls require an independently approved profile/cumulative budget; zero generative worker calls does not mean zero judge cost.

The core cost schema does not accept zero caps ([declaration](../../packages/core/src/sdk/declaration.ts), lines 21–34). **PROPOSAL:** omit job model-cost declarations for the deterministic no-model template; enforce absence of worker model/network bindings through composition and later negative probes. Do not encode a fictitious zero-valued cost cap or borrow another module's approved budget. Do not request `region.compact` initially: it can add a judge call and may remove evidence needed for attribution.

**PROPOSAL initial author ceiling and registration:** `maxStage: observe`, stage omitted or explicitly observe. Observe performs judgement/trace only; no candidate preparation or receipt-quality claim. After separate approval, an authored ceiling revision may permit explicit shadow; the permanent design ceiling remains shadow, never active. Shadow is read-only preparation with all parent reports withheld. Choosing active cannot enable this design, even explicitly; it requires an entirely separate design/approval. No `proposal` risk tier for this template: current shadow skips non-read-only jobs.

**PROPOSAL destination:** host-owned **volatile** review queue/port outside parent context and automatic knowledge ingestion. No disk/DB/file writes, network export, canonical record changes, report mailbox or `createParentReportDelivery` connection. Initial default without an approved sink binding is observe-only; approved shadow refuses preparation when the sink is unavailable. “Sink” does not silently authorize persistence.

**PROPOSAL sink protocol:** accept a validated immutable candidate with scope, source revisions and idempotency identity; return a matching candidate ID and `accepted-volatile`, `refused` or `unknown` receipt. Repeated identical identity/bytes yields the same receipt; changed bytes under that identity refuses. Acceptance means retained for private review in this process, not viewed, approved, persisted or delivered to a provider. Host can inspect via a separate read-only UI; never an agent message. Approval/withdrawal decisions remain host-owned and are not written by this module.

**Implementation gap:** runtime does not retain `JobResult.output` in `JobOutcome`, and shadow withholding a report is not a candidate delivery API ([runtime](../../packages/core/src/engine/monitoring-engine-runtime.ts), lines 192–215). **PROPOSAL:** approve separate host composition that observes a validated worker completion and hands its candidate output to the private sink while preserving runtime cancellation/freshness. Do not use report text as a covert side channel or call a storage callback inside a supposedly read-only template. A fake worker completion capture can demonstrate the interface later; neither it nor an in-memory UI proves durability. A core output-observation port, if needed, is a separate API change.

## PROPOSAL — candidate envelope (not a storage schema)

All fields below are proposed and must be strict, bounded plain data; unknown fields and malformed source references refuse preparation. Schema-version identifiers are proposed protocol names, not current exports.

| Field | Meaning / invariant |
|---|---|
| `schemaVersion`, `candidateId` | Proposed `memory-candidate/v1`; stable deterministic candidate identity over scope, subject, claim revision and evidence identities. |
| `status`, `notApproved`, `notWritten` | Explicit review-only status; not-approved/not-written markers cannot be converted into authorization by a downstream consumer. |
| `claim` | Kind (`project-fact`, `decision`, `constraint`, `preference`), exact bounded source text/span, and language. A quoted proposal must stay a proposal. No generated paraphrase or unsupported permanence. |
| `evidenceRefs` | Material/source ID and namespace, document or message revision, immutable span locator and span/content hash, source event ID/type/cursor, session/binding, actor and attestation reference, admission/grant revision, captured source revision. Supporting versus contesting role explicit. Hashes are integrity aids, not anonymization or authority. |
| `scope` | Host-provided project identity and intended applicability, session, branch/compaction generation; optional narrower component/task scope. No global/personal cross-project scope by default. |
| `subjectKey`, `dedupeKey` | Host-normalized scoped subject and exact revision identity; see bounds below. No semantic equivalence assertion from a hash. |
| `provenanceState`, `contested`, `missingEvidence` | Explicit checked/unresolved source state, known competing references and bounded reason codes. Run candidates require the selected eligibility checks; unknown attribution cannot be marked verified by the judge. |
| `confidence` | Optional diagnostic judgement/rubric value with origin and scale definition, or absent. Default absent. It is NOT calibrated truth, user approval, acceptance gold, or an auto-write threshold. |
| `preparation` | Trigger ID, module/declaration/question/config fingerprints, source snapshot revision, stage, template version and captured scope generation. |
| `reviewReceipt` | Separate host-owned acceptance status/identity, not populated by the module as a self-asserted successful delivery. |

**PROPOSAL validation:** every claim span must match admitted source bytes at the captured revision. Evidence provenance/attestation must be reacquirable and current before acceptance. If truncation removes the claim or its deciding context, defer rather than manufacture a complete candidate. A deletion or revocation invalidates eligibility; raw bodies cannot remain in a hidden archive.

## PROPOSAL — dedupe, retention and boundedness

**PROPOSAL subject identity:** host deterministically normalizes an explicit project/topic key; absent or ambiguous key means defer, not an inferred model key. Use the revision-aware `dedupeKey` below as `Trigger.subjectKey`, not the logical topic alone: encode session/branch/compaction generation plus exact claim/evidence revision so changed supported decisions are not suppressed by a prior candidate on the same topic. This is necessary because current per-subject hashing uses module/declaration/job/material but does not independently add session/branch ([runtime](../../packages/core/src/engine/monitoring-engine-runtime.ts), lines 166–174).

**PROPOSAL dedupe identity:** canonical hash of protocol version, project/scope generation, normalized subject, exact claim-span hash and sorted evidence ID/version/span identities. Repeated user/finalized-message/turn-end copies map to the same identity only when the host resolves them to the same original source ID/revision/span; keep each observation event as provenance, not as the sole dedupe discriminator. That original-source association must be deterministic and attested; if it is missing, defer rather than infer equivalence from similar text. Changed claim or deciding evidence creates a new revision linked to its predecessor; do not suppress a contradiction merely because the subject matches. No cross-session semantic dedupe without a separately admitted host index.

**PROPOSAL initial caps (not measured):** at most 1 candidate per admitted opportunity; 2 KiB claim text, 8 evidence refs, 16 KiB serialized candidate; 128 pending candidate bodies and 1 MiB total body bytes per open scope; 4,096 dedupe/protection keys and 1 MiB key metadata per scope; 1 active preparation and 16 queued preparations. Both count and byte caps apply. Host input-window sizes need their own admitted ceilings; these output limits do not bound observer snapshots by implication.

**PROPOSAL retention:** volatile bodies live only in the current open session/branch scope; invalidate on source revocation/compaction/scope closure and discard at process exit. No timer-based disk retention or automatic export. No real-data retention is approved. If a future approved evaluation needs artifacts, use a private outside-Git sink with an independently approved deletion policy; never commit experiment outputs, labels, model responses, traces or result tables.

**PROPOSAL pressure policy:** refuse new preparation on either count/byte cap, with a bounded reason; never evict a live dedupe/uncertain key to create room. Body disposal is not permission to reopen its key. Reserve dedupe identity before sink handoff; unknown acceptance stays consumed and requires host reconciliation, not automatic retry. Close/reconcile in-flight work before releasing scope protection. A lost volatile candidate is permitted loss under this initial contract, not evidence of durable retention. Stale late completions cannot resurrect a closed scope.

## PROPOSAL — R7 persistence interaction

This module proposes lasting information; it does **not** implement R7. Initial operation explicitly excludes restart-safe candidates, exactly-once review and durable dedupe. After restart, do not restore from trace text, treat a lost sink receipt as rejection, renew a budget or automatically replay unknown work.

If persistence is separately approved, align with the [R7 design](../qualification/p2-reliability-review.md#r7-restart-durability--design-only-not-an-implemented-api): versioned module/scope partitions; owner fencing; atomic protection/work/budget transitions before dispatch; stable commit/receipt identities; unknown-ack reconciliation; current source/grant/stage intersection on recovery. Persisted authority cannot enlarge current permissions. Candidate body retention and canonical knowledge storage remain separate approvals; an engine checkpoint is not a knowledge record.

**PROPOSAL future crash cases:** admission-before-dispatch, preparation-before-private-handoff, acceptance-before-receipt, lost receipt, stale worker after rebind, revoked source during recovery, schema mismatch and capacity exhaustion. A fake durable backing can check the recovery state machine but not fsync/disk durability. Unresolved keys/reservations survive diagnostic pruning; current sources must be reacquired or work dropped. Default now is lost volatile work with no automatic resume, not a claim that restart safety is solved by avoiding writes.

## PROPOSAL — evaluation opportunities, labels and receipts for P5

Use the shared eval package, not a memory-only parallel runner. Today's [replay](../../packages/eval/src/replay.ts), lines 126–141, derives private-candidate delivery from scripted `delivery` plus a prepared outcome. **That is synthetic mechanical evidence, not observation of a real sink or independent validation of claim usefulness.** Current replay also supplies event IDs as subject keys (lines 118–120); real scoped subject/dedupe behavior requires approved extension. Current parser permits the stub binding only ([contracts](../../packages/eval/src/contracts.ts), lines 16–43).

**PROPOSAL opportunity unit:** one independently enumerated `(moduleId, eligible finalized frame)` at the approved watch points, whether or not runtime admits it. Multi-frame chains remain linked by subject/incident. The first adequately supported durable claim is a positive opportunity; unchanged repeated finalization/turn-end copies are duplicate negatives under a predeclared ordering rule. A changed decision can be a new positive; an unresolved contradiction is unresolved. Keep every missed admission, denied-source case, cancellation and technical failure in its oracle row; do not score only dispatched jobs.

**PROPOSAL independent labels:**

- **Positive:** human-policy-defined durable, attributable, scoped, nonduplicate claim with complete admissible support; specify expected claim span, evidence versions and scope. Not “the agent mentioned it” or “the model was confident.”
- **Negative:** transient status/request, general knowledge, unchanged duplicate, or clearly no durable claim. Denied/untrusted material cannot be a positive candidate; distinguish privacy/admission safety labels from semantic uncertainty.
- **Unresolved:** insufficient/conflicting/unattributable support under the approved policy. Keep defer/blocked/incorrect-run counts separate; do not quietly turn unresolved into negatives for precision.

**PROPOSAL measurements after separate approval:** judge run/skip/defer correctness in observe; exact claim/evidence/version/scope validity and accepted-volatile receipt in shadow. A positive judgement is not a prepared candidate, and prepared is not received. Define useful-received true positive only when both the independent content oracle and matching current-scope sink receipt agree. Positive technical/missing failures remain false negatives in the applicable candidate/received denominator, with failure slices. Report false-positive rate over labeled negatives separately from false-discovery fraction over emitted resolved candidates, plus duplicates, stale/denied attempts, unresolved outputs and abstentions.

The existing [score](../../packages/eval/src/score.ts), lines 30–67, has proposal/received confusion and missing-opportunity accounting; **PROPOSAL** extend it with judgement-only reporting and content/real-private-receipt validation rather than calling today's scripted prepared output a semantic pass. Preserve label-free runtime material and separate scoring labels. Describe conformance for exact-quote mutation, missing provenance, changed versions, duplicate chains, conflict, capacity, delayed cancellation and a deliberately broken sink that misreports receipt identity. These are planned checks, not tests written or run here.

**PROPOSAL P5 protocol:** invented synthetic sources only, separate dev/holdout incident worlds, blinded independent labels/adjudication, sealed custodian-owned holdout and separately approved measurement/budget envelope. Follow the P5 plan's decision gate; re-confirm the acceptance draft before measurement. This design adopts no new quality, latency, cost, sample-size or duration target and transfers no historical memory result. Confidence is never gold. Raw experiment artifacts stay private outside Git; author only privacy-reviewed design/decision narratives in repository records.

## PROPOSAL — risks and mitigations

| Risk | Proposed mitigation / stop condition |
|---|---|
| Privacy and secret retention | Explicit source grants and consent before admission, metadata/minimal exact excerpts, byte bounds, volatile-only sink, revocation invalidation, no provider transmission without a separate gate. Any witnessed leak stops the relevant workflow; hashes do not anonymize. |
| Memory pollution / authority laundering | Exact quotes, no generated durable assertions, host-attested attribution, defer assistant-only approval/conflicts, human review separate from canonical acceptance; no write route. |
| Feedback loops | Never ingest memory queue output as user authority; prior-candidate metadata used only for dedupe/conflict. Set module origin metadata and preserve core loop guard ([runtime](../../packages/core/src/engine/monitoring-engine-runtime.ts), lines 164–165); origin assignment is host-owned, not inferred from text. |
| Stale evidence / branch races | Capture and revalidate source revisions/scope; fence compaction/navigation/cancellation; refuse stale late completions and sink receipts. |
| Duplicate inflation / queue pressure | Scoped revision-aware keys, reserve before handoff, fixed count/byte bounds, refusal rather than protection eviction, no unknown retry. |
| False durability expectations | UI labels “unapproved, volatile, not written”; lost work after restart is explicit. R7 and persistent review storage remain separate gates. |
| Evaluation leakage / confidence misuse | Independent policy labels, label-free judge input, isolated holdout, negative/fault probes; no confidence-based acceptance or committed experiment data. |

## PROPOSAL — decisions requested (recommended defaults)

- **Purpose/authority:** accept project-scoped candidate review only; default require host-attested attribution or trusted approved-record evidence. Who supplies that attestation? Until answered, unresolved cases defer and run-capable approval detection remains blocked.
- **Stages:** author ceiling observe initially; require separate authored change and explicit shadow selection for private preparation. Permanent ceiling shadow; no active/injection/write permission.
- **Worker:** deterministic exact-span template, **PROPOSAL 0 generative calls**; approve any future typed judge profile/budget separately. No automatic summarizer or embeddings.
- **Sink/owner:** choose split port ownership as in [host-input-ports.md](host-input-ports.md); name the private review UI owner. Default volatile-only, no binding means observe-only. Is volatile loss acceptable? If not, stop for a separate persistence approval rather than quietly add storage.
- **Keys/conflicts:** host builds scoped deterministic subject keys; unchanged duplicate suppresses, changed supported revision gets a linked candidate, unresolved conflict defers. Is a contested candidate workflow desired later?
- **Caps/retention:** approve or replace the proposed counts/bytes; default refusal on pressure and scope-lifetime bodies, no protection-key expiry. No real sessions or outside-Git artifact retention implied.
- **P5 oracle:** choose independent reviewer/custodian and normative durability/usefulness policy; approve judgement-only and useful-received metrics separately. Re-confirm all acceptance quantities before measurement; synthetic qualification cannot establish natural-world usefulness.
- **Later persistence:** defer R7 backend/recovery and canonical write workflows. A host reviewer accepting a candidate must not automatically call a knowledge writer through this module.

## UNVERIFIED / not claimed

No module API, export, registration, need binding, configuration entry, provenance sidecar, approval attestation, output-observation port, sink, conformance test or measurement was implemented. No semantic accuracy, calibrated confidence, natural-session usefulness, provider receipt, resource envelope, privacy guarantee, durable candidate retention or R7 restart safety is established. Source descriptions are inspection claims only; no tests were run. No code, model calls, dependencies, real data, experiment results, push or GitHub writes. This commit requests approval for design choices only.
