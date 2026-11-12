import { mkdir } from 'node:fs/promises'
import { regionLines } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-material.ts'
import { planRegionCompaction, regionBytes } from '@lazy-harness/monitoring-core/engine/region-compaction.ts'
import { devGoals, validateConversation, validateDevDataset, type DevEntry } from './compaction-generate-dev.ts'
import { parseRegionDataset, parseRegionLabels, purposes, type Purpose, type RegionDataset, type RegionLabels } from './compaction-dataset.ts'

/** Agent-authored compositional LONG DEV, not production traces. Review before any quality measurement.
 * The scenario bank and observation bank deliberately exercise repeated workflow structure with unique
 * concrete context. This is a synthetic distribution limitation, not independent natural conversations. */
const scenarios: Record<Purpose, string[]> = {
  references: [
    'The invoice export service writes a manifest before uploading CSV partitions. A retry after a partial upload left two manifests pointing at different partition lists; accounting wants a recoverable export rather than an empty successful download.',
    'The search index importer accepts both a tenant alias and an immutable tenant identifier. A restored staging snapshot still contains an alias from an earlier rename, while production workers now resolve the immutable identifier first.',
    'A mobile sync client queues edits during a subway ride. On reconnection the server reports a stale checkpoint, and the client has already displayed an optimistic success badge for two edits that have not reached the shared document.',
    'The warehouse planner assigns reserved stock before emitting a pick ticket. An overnight correction moved cartons between bins without updating the reservation revision, so the ticket names a bin that no longer contains those cartons.',
    'The calendar bridge translates recurring meetings into provider exceptions. A daylight-saving transition changes one occurrence, and deleting that occurrence must not erase the remaining series or resurrect an earlier cancellation.',
    'A deployment controller waits for a quorum of healthy replicas before shifting traffic. The readiness probe succeeds on an old replica while the new image is still warming its cache, making the rollout dashboard briefly show a misleading green state.',
    'The tax report worker groups adjustments by settlement date. Two regions close their ledgers in different time zones, and a late adjustment arrives after one regional cutoff but before the consolidated report is signed.',
    'An image pipeline stores originals and generated previews in separate buckets. A cleanup task removed an original still referenced by a preview job, leaving the gallery responsive while future resize requests fail for that asset.',
    'The notification broker batches receipts for several channels. Email delivery can settle before the push provider responds, and retrying the entire batch currently creates another email even when the first receipt is durable.',
    'A credential rotation coordinator updates readers before revoking an old credential. One worker reconnects from a suspended node and uses its cached revision, so the rotation must distinguish stale readers from new authentication failures.',
  ],
  'rule-steering': [
    'The payments team is changing the settlement retry loop. A fixture simulates the bank accepting a transfer but timing out before returning its receipt; the same transfer identifier is present in the retry ledger and in the bank reconciliation feed.',
    'A storage migration adds a checksum column to an archive table. Existing rows have no checksum, and the backfill worker shares a queue with uploads whose checksums are calculated before their metadata transaction commits.',
    'The account recovery endpoint issues short-lived links. A customer can request several links from different devices, and opening an earlier link after completing recovery must not reopen an already consumed challenge.',
    'The build runner resolves signed plugin bundles from a mirror. A slow mirror may return an earlier bundle with the same display name, while the signature record includes the digest of the exact approved artifact.',
    'The support dashboard renders customer-submitted diagnostic excerpts. Some excerpts include angle brackets and multiline commands, and an operator may copy a snippet into a ticket without first expanding the collapsed attachment.',
    'A queue consumer checkpoints a stream after processing a batch. The acknowledgement channel can be delayed independently of the database transaction, so a restarted consumer may see records whose effects are already committed.',
    'The report API exposes tenant-scoped aggregates through a shared cache. Two tenants can use identical query parameters, and an operations script warms both caches with the same service account during a release rehearsal.',
    'A device enrollment service records the hardware key before issuing a certificate. An interrupted enrollment can leave a pending row that belongs to an expired challenge but still has the same hardware identifier as the next attempt.',
    'The release assistant proposes schema changes for a production database. An index creation is expected to take several minutes on the largest table, and the application continues accepting writes throughout the maintenance window.',
    'A file transfer gateway resumes uploads from a byte offset. The client may reconnect through another gateway process, and the offset acknowledgement must refer to bytes that are durable in the shared object store rather than in process memory.',
  ],
  memory: [
    'The user is organizing an incident review for a subscription service. The customer timeline is written for support staff, while the engineering appendix includes retry identifiers and a chronology of operator interventions during recovery.',
    'The user is designing a workflow for translating product announcements. Regional reviewers edit separate drafts, and the release coordinator needs to distinguish approved terminology from suggestions left in unresolved review comments.',
    'The user is preparing monthly capacity forecasts for a data platform. Analysts receive both measured usage and a projected peak, and finance compares the assumptions against the previous quarter before approving another reservation.',
    'The user is reviewing an accessibility pass on a scheduling interface. Keyboard navigation, screen reader labels and visual contrast have separate owners, and the product review keeps a ledger of accepted changes and remaining experiments.',
    'The user is planning a migration from a shared repository to component repositories. Release tags and support branches must remain traceable across the move, while developers continue landing small fixes during the transition.',
    'The user is coordinating an on-call handoff across time zones. The incoming engineer needs a short operational summary, and a separate incident notebook holds longer investigation threads and commands that were tried without changing production.',
    'The user is writing design reviews for a public API. Client teams want runnable examples and stable error codes, while internal reviewers also need to see the compatibility tradeoffs that led to a proposed response shape.',
    'The user is organizing a documentation refresh for an analytics product. Screenshots age faster than the underlying concepts, and reviewers are splitting durable explanations from release-specific walkthroughs and temporary launch notes.',
    'The user is preparing a security review of a partner integration. The review includes a trust-boundary diagram, a permission inventory and a list of open questions that must be resolved by the partner before deployment.',
    'The user is evaluating a new test strategy for a command-line client. Unit fixtures cover parsing, integration tests exercise process boundaries, and the release checklist includes a small set of manual checks on supported operating systems.',
  ],
}
// Varied operational observations, rendered as ordinary assistant messages, never labels or answers.
const observations = [
  'I reconstructed the sequence from the staging trace rather than sorting the log by wall time. The first worker recorded a request revision before the second worker opened its transaction. Their timestamps overlap because the hosts were drifting slightly, but the revision links still establish which write the downstream observer consumed. I added both local times to the worksheet so the operational team can correlate its own logs without treating those times as the ordering authority.',
  'The reproduction starts with a clean tenant and a single pending job. I pause the worker immediately after the durable write, disconnect its acknowledgement channel, and then let another worker acquire the lease. The second worker reads the stored revision and logs the previous attempt identifier before it proceeds. This produces a small, repeatable trace that can be inspected without importing a production database or copying customer payloads into the test suite.',
  'The dashboard and the database disagree for a short interval during the rehearsal. The dashboard samples the last completed poll, while the database already contains the newer row. Refreshing the page hides the interval but does not explain it. I captured the poll cursor alongside the row revision and kept the screenshot separate from the transaction trace, so a reviewer can tell which observation came from which surface when reading the incident chronology.',
  'I compared the command-line output with the structured trace. The command shows one concise status per attempt, whereas the trace includes each lease acquisition and each retry delay. A retry that never acquired a lease therefore appears only in the detailed view. The support worksheet now has separate columns for attempts submitted and attempts admitted, which should make it easier to explain a gap without assuming that the command silently lost a request.',
  'The test environment uses a deliberately small connection pool. Under that constraint a slow reader holds a connection long enough for the next writer to queue, exposing an ordering assumption that was invisible on my workstation. I repeated the sequence with a larger pool and kept both traces. The functional result is the same, but the wait appears at a different boundary, which is useful when deciding whether a metric should measure execution or admission delay.',
  'I saved the original fixture next to a version with the optional field omitted. Both fixtures reach the same handler, but the omitted field takes the compatibility path before validation. The response summaries look similar because the renderer does not show the selected branch. I added the branch name to the local debugging worksheet and checked the stored record directly rather than relying on a screenshot of the response summary to distinguish the two cases.',
  'The nightly rehearsal ran across a simulated restart. Before stopping the process I recorded the queue cursor, active lease and last durable receipt. After restarting I inspected those same three values before sending another request. The queue still held an unacknowledged item, but the receipt already described its completed write. I attached the before-and-after snapshots to the review so the team can discuss recovery without reconstructing it from a live terminal.',
  'I separated the operator commands from the application events in the investigation notes. One operator command changes the logging level; another merely reads the current status. Neither command is evidence that a business transaction completed. The application trace supplies that evidence through its stored receipt. Keeping the two timelines side by side makes it possible to explain why a status inspection appears between the request and its eventual completion event.',
  'The load generator alternates short and long requests instead of submitting a uniform batch. This exposes whether a slow request delays only its own result or blocks unrelated work sharing the same queue. I recorded queue residence time and execution time separately, then compared the distributions with the serial baseline. The tail grows during admission in this rehearsal, while the handler duration remains close to the baseline observed before the larger payloads arrived.',
  'I checked the cleanup job against an intentionally interrupted run. The temporary record survives the interruption, and the next cleanup pass discovers it through the same index used by the normal completion path. The pass logs the record revision before deletion so the review can distinguish an expired temporary object from a newer replacement. I kept the deletion trace and the replacement trace in separate sections rather than merging their similar-looking identifiers.',
  'The local fixture includes an older configuration revision and a newly published revision. One worker starts before publication and another starts afterward. Each worker reports the revision it actually loaded, not merely the revision currently displayed in the configuration console. This matters when reading the rollout timeline: a console screenshot taken after publication cannot establish which settings a worker used several seconds earlier when it accepted its first request.',
  'I inspected the monitoring output with the exporter disabled and then enabled. With exporting disabled the handler still records its durable receipt, but the dashboard remains blank. With exporting enabled the dashboard eventually catches up from its last acknowledged cursor. The comparison keeps application completion separate from observability delivery, avoiding a misleading interpretation in which a missing chart point would imply that the underlying operation never happened.',
  'The replay fixture deliberately changes the order in which the two network responses arrive. The requests retain their original identifiers, and the stored receipt links each response to the corresponding attempt. The user interface renders completion order, while the diagnostic view renders submission order. Both views are useful, but neither should be copied into the investigation as if it were a transaction dependency graph without checking the recorded links first.',
  'I ran the compatibility check against the oldest supported client and the current client. The older client omits an optional capability field and receives the legacy response envelope; the newer client advertises the capability and receives the expanded envelope. Both still carry the same stable operation identifier. The fixture assertions compare the durable effect and the envelope independently, so a formatting change does not hide a change in the operation itself.',
  'The rehearsal includes a maintenance pause while requests remain queued. I recorded the last admitted request before the pause and the first admitted request afterward. Requests submitted during the pause retain their submission times but acquire no lease until admission resumes. The operational summary lists the pause interval explicitly, and the detailed worksheet shows queue residence separately from handler execution so the maintenance delay is not attributed to slow application code.',
  'I compared a fresh read with a cached read immediately after the write. The fresh read sees the new revision while the cached read still reports its earlier refresh cursor. A second cached read after refresh agrees with the database. I preserved all three observations in the notebook, including the refresh cursor, because keeping only the final successful read would erase the interval that prompted the investigation and make the original report difficult to reproduce.',
  'The review bundle contains a minimal fixture, a step-by-step reproduction and the raw local event trace. The fixture excludes customer data and uses stable synthetic identifiers. The reproduction names each pause point so another engineer can repeat the timing without guessing when to stop a worker. The trace retains failed attempts as well as successful ones, allowing the reviewer to see whether the final state was reached directly or only after recovery handled an interrupted attempt.',
  'I examined the final acknowledgement separately from the initial acceptance response. Acceptance confirms that the request entered the queue; acknowledgement confirms that the durable result can be read back by its operation identifier. The current console groups both under one status label, so the investigation notes include the underlying event names. That distinction also explains why a client can legitimately wait after receiving an acceptance response without submitting another operation.',
]
const rules = [
  'A settlement retry must reuse the original transfer identifier.', 'Backfills must commit in bounded batches and retain a restart cursor.',
  'Recovery challenges are single-use even when an older link is opened later.', 'Plugin verification must check the approved digest, not its display name.',
  'Render diagnostic excerpts as escaped text rather than executable markup.', 'Checkpoint only after the corresponding durable effects commit.',
  'Include tenant identity in every aggregate cache key.', 'A certificate may be issued only for the active enrollment challenge.',
  'Production index changes must use the online migration path.', 'A resume offset may acknowledge only durably stored bytes.',
]
const preferences = [
  'For incident reviews, put the customer impact before the engineering timeline.', 'Keep approved terminology in a glossary that is separate from unresolved translation suggestions.',
  'Show measured usage and forecast assumptions in separate columns in my capacity reports.', 'For interface reviews, include keyboard behavior alongside the visual examples.',
  'Keep support branch ancestry visible when presenting repository migration plans.', 'Start my on-call handoff with the immediate operational risks and next checks.',
  'For API reviews, lead with a runnable example before discussing compatibility tradeoffs.', 'Keep durable documentation concepts separate from release-specific walkthroughs.',
  'In partner security reviews, show the trust boundaries before listing individual permissions.', 'Distinguish automated test coverage from manual release checks in my client test plans.',
]
export function generateCompactionLongDev() {
  const dataset: RegionDataset = { schemaVersion: 1, split: 'dev', regions: [] }, labels: RegionLabels = { schemaVersion: 1, split: 'dev', labels: {} }
  for (const purpose of purposes) for (const [i, scenario] of scenarios[purpose].entries()) {
    const id = `long-${purpose}-${String(i + 1).padStart(2, '0')}`, path = `docs/${purpose}/workflow-${i + 1}.md`
    const entries: DevEntry[] = [{ kind: 'u', text: `Let's investigate this workflow. ${scenario}`, needed: false }]
    for (const [j, observation] of observations.slice(0, 16).entries()) {
      // Concrete scenario context is part of each long observation, not a repeated padding string.
      entries.push({ kind: 'a', text: `${scenario} ${observation}`, needed: false })
      if (j === 3) {
        entries.push({ kind: 'u', text: purpose === 'references' ? `The repository catalog lists ${path} as the operational contract for this workflow; the archived walkthrough is in archive/workflow-${i + 1}.md.` : purpose === 'rule-steering' ? `Use this rule for the implementation: ${rules[i]}` : `For this work and future reviews of this kind: ${preferences[i]}`, needed: true })
      }
      if (j === 8) {
        entries.push({ kind: 'c', text: path, needed: purpose === 'references' }, { kind: 'r', text: path, needed: purpose === 'references' })
      }
      if (j === 12) entries.push({ kind: 'a', text: purpose === 'references' ? `I will change the workflow handler after checking the operational contract for case ${i + 1}.` : purpose === 'rule-steering' ? `My proposed shortcut for case ${i + 1} is to reuse the existing fast path and add a follow-up validation after returning the acceptance response.` : `I can reorganize review ${i + 1} around the order you described and move the longer trace into its appendix.`, needed: purpose === 'rule-steering' })
    }
    entries.push({ kind: 'u', text: purpose === 'references' ? `Continue with workflow ${i + 1}; check the contract before editing the handler.` : purpose === 'rule-steering' ? `Implement the recovery path for workflow ${i + 1} with the rule we discussed.` : `Use that review structure for case ${i + 1}, and save my preference for the next review as well.`, needed: true })
    entries.push({ kind: 'a', text: `I am preparing the patch and the verification notes for ${purpose} workflow ${i + 1}.`, needed: purpose !== 'references' })
    validateConversation(entries)
    const materials = entries.map((e, j) => {
      const message = e.kind === 'c' ? { role: 'assistant', content: [{ type: 'toolCall', id: `${id}:read`, name: 'read', arguments: { path: e.text } }] } : e.kind === 'r' ? { role: 'toolResult', toolCallId: `${id}:read`, toolName: 'read', isError: true, content: `Snapshot for ${path} expired while the checkout was being refreshed; retry the read against the current revision.` } : { role: e.kind === 'u' ? 'user' : 'assistant', content: e.text }
      const text = regionLines(message).lines[0]!
      return { id: `${id}:item-${j + 1}`, kind: 'conversation-history', version: 'long-dev-v1', text, content: JSON.stringify({ text, provisional: false, region: true, regionIndex: j, ...(['c', 'r'].includes(e.kind) ? { toolCallId: `${id}:read` } : {}) }), provisional: false,
        provenance: { owner: 'observation' as const, observationId: `frame-${id}`, sessionId: 'synthetic-long-dev', binding: 1, sourceEvent: 'message_end', cursor: i + 1, step: 0, stage: 'event-hook' as const } }
    })
    dataset.regions.push({ id, purpose, goal: devGoals[purpose], frame: { id: `frame-${id}`, sourceEvent: 'message_end', cursor: i + 1 }, materials })
    labels.labels[id] = Object.fromEntries(materials.map((m, j) => [m.id, entries[j]!.needed]))
  }
  parseRegionDataset(dataset); parseRegionLabels(labels, dataset); validateDevDataset(dataset)
  for (const r of dataset.regions) {
    if (planRegionCompaction(r.materials, { frame: r.frame }).withinBudget || regionBytes(r.materials) > 16384) throw Error('long DEV must exceed compaction budget but fit the default material window')
  }
  return { dataset, labels }
}
if (import.meta.main) {
  const dir = new URL('../data/compaction-long-dev/', import.meta.url), { dataset, labels } = generateCompactionLongDev()
  await mkdir(dir, { recursive: true })
  await Bun.write(new URL('regions.json', dir), JSON.stringify(dataset, null, 2) + '\n')
  await Bun.write(new URL('labels.json', dir), JSON.stringify(labels, null, 2) + '\n')
  console.log('Wrote 30 agent-authored LONG DEV regions; user review required; no model calls.')
}
