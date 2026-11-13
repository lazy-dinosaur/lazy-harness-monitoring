# Composition result-format audit (ADR 0063 / SDD §6.3)

Scope: root manifest `requires` at main base `92eaa7e` plus this alignment. `WorkerCompletion`
is the origin and the **only** common result vocabulary; `PortResult<T>` is a type alias.
Success: `{status: 'completed', certainty: 'terminal', value}`. Failure:
`{status: 'failed'|'timed-out'|'cancelled'|'refused', certainty: 'terminal'|'uncertain', reason}`.
A deliberate HOLD is `{status:'completed', certainty:'terminal', value:{held:true, reason, detail}}`.
HOLD is not failure, a sixth status, permission or an automatic retry request.

## Required-port audit and boundary conversion

All listed majors are 1, exported beside their contracts. Names are **module-local drafts**
until lazy-harness SDD §7 defines common names. Canonical types/adapters are exported from
`composition.ts`; core-owned adapters also come from the core package root.

| Required port / native API | Native result before alignment | Composition result / conversion | Failure and held meaning |
|---|---|---|---|
| worker.execution / WorkerExecutionPort.wait | WorkerCompletion<T> | Already compliant; no conversion | Logical final outcome immutable; uncertain timeout/cancel is never automatically retried. settled() separately acknowledges raw settlement. |
| judgement.model / MonitoringModelBackend.invoke | `{value: unknown}` or throw/reject | CompositionModelBackend; exposeModelBackend/bindModelBackend wrap/unwrap common result | Throws are conservatively failed/uncertain (a host call may have occurred); explicit PortResultError preserves host status/certainty. Inner model value is unchanged. |
| judgement.model / JudgeBatchPort | `Record<string, Decision>` or throw | CompositionJudgeBatchPort; exposeJudgeBatchPort/bindJudgeBatchPort | Direct judgement throws are conservatively failed/uncertain (the callback may have dispatched a model); decision defer is a nested judgement, not itself a module HOLD. Missing answers never become skip. Model-router diagnostics/fallback remain unchanged. |
| session.read-records / snapshot, isCurrent | ReadRecordSnapshot (available/unavailable/stale), boolean; throw | CompositionReadRecordPort; exposeReadRecordPort/bindReadRecordPort | Inspection success wraps the snapshot/boolean as completed/terminal, including a truthful unavailable/stale observation. Exceptions are failed/terminal. Unknown/partial exposure never suppresses. |
| memory.review-sink / enqueue | accepted-volatile/refused/unknown ReviewSinkReceipt | CompositionReviewSinkPort; exposeReviewSinkPort/bindReviewSinkPort | accepted-volatile → completed/terminal/value; refused → refused/terminal/reason; unknown or throw → failed/uncertain/reason. Binding back preserves refused/unknown receipts for legacy protection, never accepted. |
| memory.source / capture, isCurrent | unknown sidecar, boolean; throw | CompositionMemorySource; exposeMemorySource/bindMemorySource | Completed/terminal wraps captured input/currentness; throw → failed/terminal. Monitor still parses exact source identity, provenance, spans, grants and freshness. No authority inferred by wrapping. |
| report.enqueue / runtime report callback | enqueued/failed/unknown ReportEnqueueReceipt | CompositionReportPort; exposeReportPort/bindReportPort | enqueued → completed/terminal/value; failed → failed/terminal; unknown, mismatched identity or throw → failed/uncertain. Binding back returns matching failed/unknown receipts. Not actual delivery/read. |
| policy.registry / admitted PolicyRegistry + policyReferences | Validated data / projected references, or throw | PortResult<PolicyRegistry>; exposePolicyRegistry/bindPolicyRegistry validates then wraps/unwraps | Invalid registry → failed/terminal, not an empty policy set. No implicit filesystem loader. |
| rule.verifier / RuleVerifier | Decision or undefined; throw/reject | CompositionRuleVerifier; exposeRuleVerifier/bindRuleVerifier | Decision run/skip → completed/terminal/value. Deliberate defer → completed/terminal/value.held=true with original decision in detail. Missing judgement → failed/terminal; thrown verification → failed/uncertain. Pre-cancel → cancelled/terminal without dispatch; post-dispatch cancel → cancelled/uncertain, late answer discarded. Explicit host uncertainty is preserved. Bind restores defer for the internal fail-closed handler. |
| state.persistence / read, commit | StateSnapshot or undefined; StateCommitReceipt; throw | CompositionStatePort; exposeStatePort/bindStatePort | read success (including no prior state) and commit receipt → completed/terminal/value; read exception → failed/terminal; commit exception → failed/uncertain (write may have happened). No rollback/retry inference. |

`expose*` means adapt a native/local implementation to the common composition API;
`bind*` means consume a common-result implementation through existing internal APIs.
A downstream host implements the common API directly, or uses these adapters for a native
implementation. Neither low-level constructor APIs nor existing fixtures are silently changed.
`default` implementations from the manifest use the same adaptation where necessary.

## Other surfaces audited (not independent required service results)

| Surface | Disposition |
|---|---|
| Worker start/begin/cancel/stop/dispose/idle/getStatus/settled | Lifecycle/admission/ticket/status controls, not operation completion; unchanged. wait is the completion boundary. |
| Backend estimate, capabilities, limits, grant/source metadata, validator predicates | Trusted local admission/control calculations. Not remote operations or model answers; unchanged. ProtocolVersion/schemaVersion 1 remain distinct from source/document/model release versions. |
| Exposure evidence and read-result attestor start/complete | Evidence is ReadRecord.exposure plus original MemorySource sidecars, not a second independent port. The inactive Pi feed returns local admission booleans; its full/partial/unknown classification is data, not operation completion. |
| ObservationFrame, catalog/current region/reference data | Caller-supplied operation inputs, not host service results. region.compact and judge.view are engine flags. Selection and budget-gated compaction share judgement.model; no new transport/provider. |
| Internal JobResult/JobOutcome and MemoryResult (run/skip/defer) | Internal domain/feature results. Retained unchanged; not extra requires ports. WorkerCompletion wraps jobs at the external worker boundary. No wholesale internal rewrite or change to R7 schemas. |
| ReportDeliveryReceipt / host context hook output | Host hook-boundary observation, downstream of report.enqueue; never provider-input or read proof. No new host delivery protocol is invented in alignment. |
| Core ProposalSink/MaterialReceiver/readReference, trace callbacks | Trusted local engine plumbing/input projection behind the module's operation boundary, not independent manifest services; unchanged. |

## Finality, fallback and verification

No adapter retries. Typed PortResultError preserves explicit terminal/uncertain timeout,
cancel and refusal; generic errors are sanitized instead of leaking host detail. A host that
can prove pre-dispatch refusal should return refused/terminal directly. Network/model hosts
must return uncertainty conservatively, honor cancellation, finalize only once and retain raw
capacity until settlement. Adapters do not hard-kill work, invent a deadline or reconnect.

Failure does not authorize a job. Compaction failure retains the bounded original region;
missing model answers remain unavailable; rule failure never prepares a reminder. The existing
rule overlap reservation can be released after failed read-only verification; that is not an
automatic adapter/model retry. Uncertain effectful worker/sink/state/report operations retain
existing protections. HOLD retry decisions belong to the caller/user.

`packages/core/test/composition-ports.test.ts` checks common vocabulary, HOLD, failures,
no retry/late overwrite, read/review conformance round-trips, full state conformance, a fake
model router, and rule verifier conformance. The offline composition exercises read, sink,
registry, verifier and worker paths; no live host/model/provider qualification is claimed.
