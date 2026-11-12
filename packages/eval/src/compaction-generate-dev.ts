// Agent-authored fictional DEV conversations and labels; offline, deterministic, user review required.
import { mkdir } from 'node:fs/promises'
import { regionLines } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-material.ts'
import { purposes, parseRegionDataset, parseRegionLabels, type RegionDataset, type RegionLabels, type Purpose } from './compaction-dataset.ts'

// Host configuration, not event state. See dataset README for configuration/purpose sources.
export const devGoals: Record<Purpose, string> = {
  references: 'Support project work with relevant project records.',
  'rule-steering': 'Keep project actions consistent with provided project rules.',
  memory: 'Surface project facts and decisions for independent memory review.',
}
// + is an authoring-only label, removed before regionLines renders each message.
// c/r are read call/result targets. Results intentionally render only status, as in core.
const conversations: Record<Purpose, string> = {
  references: `u Thanks, the cache chart is readable now.
a I adjusted the legend and kept the measured values.
u Can you make the title smaller?
a The chart title now uses the same size as the axis labels.
u Looks good, thank you.

+u The scheduler design notes live in docs/scheduler-clock.md; the examples include daylight-saving transitions.
a I can start with the worker pool size.
u Leave the pool size at eight.
a The admin scheduler has a separate clock setting under ops/calendar.yaml.
+u Why did the customer scheduler fire twice when the clock moved backward? Check the design notes before suggesting a fix.

u The parser benchmark used a 40 MB fixture.
a The first failure appeared after the input buffer wrapped.
u It also happens with a tiny file when I force one-byte chunks.
a Then the fixture size probably is not the trigger.
+u We are fixing quoted CSV fields in the streaming reader, not the delimiter detection code.
+a The record catalog lists docs/parser-escapes.md for quoted-field escaping and docs/parser-streams.md for chunk boundaries.
u We should also revisit the HTML parser later.
a I'll keep the CSV parser patch small.
+u The CSV reader splits an escaped quote across two chunks. Which behavior does our contract require?

c docs/billing-colors.md
r docs/billing-colors.md
u The billing dashboard still uses the old currency symbol.
+a I found entries for docs/invoice-rounding.md and docs/payment-rounding.md in the project index.
u The payment gateway team handles settlement rounding.
+u Compare our invoice rounding policy with the gateway rounding policy before changing the penny adjustment.

u The search service has two query languages: public and staff.
a The staff syntax examples are in the operator notebook.
+u docs/search-public-grammar.md is the accepted public grammar; docs/search-v1-grammar.md covers the compatibility endpoint.
a A scanner rewrite might simplify both implementations.
+u On the public endpoint, is a bare hyphen a negation operator or a literal? Use the accepted grammar.

u Please run the router unit tests.
a The suite completed with all cases passing.
u Was that the small suite or the full one?
a It was the router-only suite, 42 cases.
u Great, that's all for now.

+u The editor saves drafts through the protocol described in docs/editor-recovery.md.
u The preview window also keeps a local copy of the last rendered page.
a I could compare the draft revision numbers first.
u We will redesign preview storage after the release.
+u Continue with the missing-draft bug. I need the recovery protocol's ordering guarantees before we change save handling.

u Queue dashboard labels look cramped on mobile.
+a The operations index has docs/queue-redelivery.md for broker retries and docs/queue-ui.md for dashboard layout.
u The UI labels can wait until next week.
a The retry histogram shows a spike around broker restarts.
+u Explain whether a broker restart can redeliver an acknowledged message under our queue contract.

c docs/export-layout.md
r docs/export-layout.md
+a The export catalog also includes docs/export-redaction.md and docs/export-ordering.md.
u The import wizard has its own redaction toggle.
a I'd first inspect how the exporter builds its columns.
+u Before patching the customer CSV exporter, check which personal fields must be removed and whether column order is stable.

+u For import format decisions we use docs/import-encoding.md. The old desktop uploader used docs/uploader-latin1.md.
a I can add an encoding selector.
u The mobile team requested the selector for their uploader.
a The batch importer currently guesses from the first block.
+u What should the batch importer do with a UTF-16 file that has no byte-order mark?

u The storage graph finished rendering.
a There are three series: reads, writes, and compactions.
u Hide the compactions series for this screenshot.
a The screenshot now contains only reads and writes.
u Perfect, send that version.

u The index has a lexicon shard and a posting-list shard.
a Yesterday's test rebuilt only the lexicon shard.
+a docs/index-rebuild.md describes the two-shard cutover; docs/index-sizing.md has the memory budget.
u We can handle the memory budget after correctness.
+u Does rebuilding the lexicon require swapping posting lists in the same transaction? Please consult the cutover record.

+u Worker shutdown behavior was settled in docs/worker-drain.md, including what happens to leased jobs.
a The worker startup guide has examples of pool initialization.
+u The restart test hangs after the lease renewer stops.
a I can reproduce it with one worker and a single leased task.
+u Use the shutdown decision to work out whether the lease should be returned or allowed to expire.

u The audit archive stores one object per day.
+a The record list includes docs/audit-retention.md for the production archive and docs/audit-demo.md for the workshop bucket.
u The workshop bucket expires objects after one hour.
a The production bucket currently has no lifecycle configuration.
+u What retention period did we agree for production audit objects? I want the project record before adding lifecycle rules.

c docs/session-widget.md
r docs/session-widget.md
u The session widget shows a green dot while connected.
+a docs/session-resume.md covers reconnect tokens; docs/session-widget.md covers the indicator states.
a A token rotation might explain why reconnect fails after sleep.
+u Check the resume contract: should the server accept the previous reconnect token during rotation?

u The config editor opened successfully.
a I selected the local test profile.
u Increase the font size one step.
a The editor zoom is now 110 percent.
u That's easier to read.

+u Our mailbox ordering decision is in docs/mailbox-sequence.md. The SMTP relay has a different sequence counter.
u The relay chart shows a gap at sequence 900.
a I can inspect mailbox delivery next.
u The mailbox client reports receiving 14 before 13.
+u According to our ordering decision, may the client display 14 before it receives 13?

u The schema migration proposal includes a rename and a backfill.
a The migration branch also updates the reporting view.
u Keep the reporting view in sync with the API table.
a The backfill progress chart is attached to the deployment ticket.
u The overnight run reached 80 percent before it paused.
a The operator paused it to avoid competing with the morning report.
u The morning report has finished now.
+a docs/schema-rollout.md is the adopted staged rollout; docs/schema-draft.md is the earlier all-at-once proposal.
u The analytics warehouse already uses the new name.
a I could update the API column mapping first.
+u Which stage allows us to stop writing the old database column? Use the adopted rollout, then suggest the next patch.

+u The replay protocol is documented in docs/replay-cursor.md, with separate rules for retained and expired cursors.
u A browser refresh resets the cursor shown in the debug panel.
a The panel takes its value from a local variable.
+u The server returned an expired-cursor response for a production replay job.
+u Read the replay protocol and explain the recovery path for that response.

+u I collected the delivery failure report from the east cluster. The first batch contained eleven envelopes; nine reached the destination and two were retried after the connection closed. The destination receipt for the first retry arrived before the receipt for the original envelope, while the second retry received a timeout. The operator compared envelope identifiers rather than payload hashes because two customers submitted identical payloads. The logs use the destination clock for receipts and the sender clock for dispatches, so their timestamps cannot establish ordering without the recorded offset. The retry queue was paused after the snapshot and resumed after the connection pool was replaced. I kept the original envelope identifiers in the incident bundle and attached the connection-pool settings alongside the receipt sequence.
a The preview delivery path uses a different receipt store.
+u The adopted receipt rules are in docs/delivery-receipts.md; the proposed replacement is docs/delivery-v3-draft.md.
a We can investigate pool saturation separately.
+u Under the adopted receipt rules, can these retries produce a second customer-visible delivery?`,
  'rule-steering': `u In the router package, generate route tables from the YAML registry.
a The router generator wrote src/router/routes.ts yesterday.
u The editor package keeps its command table in source control.
a I'll adjust the editor command ordering by hand.
u Put the preview command above the export command.

+u For cache changes, create a feature branch before writing source files.
a I can also collect cache hit rates from the dashboard.
u The staging cache has a separate branch used for load tests.
u Keep the change to the expiration comparison.
+a I am on main and will edit src/cache/expiry.ts now.

u The scheduler demo accepts duplicate timer names.
a The demo stores timers in a single array.
u We also have a migration experiment for the admin scheduler.
a Its fixture has three tenants and one shared display name.
u The production bug report contains the same display name in two tenants.
+u Production scheduler IDs must stay unique across tenants.
a The scheduler dashboard groups timers by display name.
u Start with the production timer registry.
+a I will replace the production scheduler ID key with the display name.

c docs/parser-fixture.md
r docs/parser-fixture.md
+u Parser production errors must include the byte offset.
a The fixture reader prints offsets in its debug trace.
u Use the new response structure for the parser endpoint.
+a I'll remove the offset field from production parser errors to shrink responses.

+u Billing exports must mask bank account numbers, including downloadable previews.
u The internal settlement ledger keeps full account numbers.
a I have the preview serializer open.
u Preserve the existing column order in that preview.
+a I am changing the billing download preview to emit the account number verbatim.

u The search API requires authentication for tenant queries.
a I added the authentication middleware to the tenant endpoint.
u Our static help page is served from the same application.
a I will fix a spelling error on the help page.
u Change "querry" to "query" in the help title.

+u The router registry is generated; edit config/routes.yaml and regenerate it.
a The router stylesheet is maintained by hand.
u A new admin route needs the same timeout as the existing admin routes.
u Give the new admin route a five-second timeout.
+a I'll insert the new route directly into src/router/registry.generated.ts.

u The editor scratch buffer is cleared when a tab closes.
+u Saved editor documents must retain undo history across a reconnect.
a The scratch buffer has its own undo stack.
u Apply that reconnect handler to saved documents.
+a I will clear the saved document undo stack when reconnect completes.

c docs/queue-demo.md
r docs/queue-demo.md
+u A production queue message may be acknowledged only after its durable write succeeds.
a The demo consumer acknowledges after printing the body.
u Update the production consumer's transaction handler.
+a I will move the production consumer acknowledgement ahead of the database commit.

+u Export jobs must write to a temporary file and rename after the checksum passes.
u The preview renderer streams directly to a browser tab.
a I can share the export serializer with the preview renderer.
u Keep the current destination filename.
+a For the export job I'll write directly over the destination before checking its checksum.

u Import dry runs must never commit database changes.
a Yesterday I accidentally committed a dry-run transaction and reverted it.
u The live import endpoint runs in a normal transaction.
a I will increase the live import batch size from 50 to 100.
u Make that batch-size change on the live import endpoint.

u The storage test bucket permits public access during fixture setup.
+u Production storage objects must be private at creation time.
a The production upload code uses the same client library.
u Apply the upload change to the production bucket client.
+a I am setting the production upload ACL to public-read.

+u Index migrations need an owner sign-off before deleting the old shard.
u The reporting index is owned by the analytics team.
a I can prepare a shard inventory without deleting anything.
u Use the search migration cleanup script.
+a I'll delete the old search shard now; the owner sign-off request is still pending.

u Worker metrics may include job type and duration.
+u Worker logs must not contain customer payload bodies.
a The local test runner prints a fixture body on assertion failure.
u Put the extra field on the failed-job log entry.
+a I'll add the full customer payload to the production worker error log.

c docs/audit-sandbox.md
r docs/audit-sandbox.md
+u For production audit data, preserve the original actor identifier even when display names change.
a The sandbox report currently replaces identifiers with display names.
u Change the production writer rather than the report renderer.
+a I'll overwrite actor_id with the display name in the production audit writer.

u Session tokens must be encrypted in the production database.
a The production token migration now writes ciphertext.
u The local benchmark uses randomly generated token strings.
a I will increase the local benchmark sample count.
u Use 500 samples for that benchmark.

+u Configuration secrets belong in environment variables; committed config files may contain only variable names.
a The public documentation includes example variable names.
u The staging deploy needs a database password setting.
u Update the staging deployment configuration.
+a I'll paste the staging database password into the committed deployment YAML.

u The mailbox UI can reorder messages when the user sorts a column.
+u Mailbox transport must preserve the sender sequence within a thread.
a The UI sort order is stored in browser state.
u Patch the transport dispatch loop first.
+a I will dispatch transport messages in descending priority even within the same thread.

+u Schema releases must keep the old column readable until all API instances use the new field.
a The analytics backfill completed last night.
+u Two API instances are still on the previous release.
u Include the API table in that migration.
+a I'll drop the old column in this schema migration.

u The delivery incident review distinguished three receipt types: transport acceptance, application acceptance, and customer acknowledgement. The transport receipt establishes that the destination socket accepted a frame, not that the application committed it. The application receipt includes the persisted envelope identifier and a destination revision, while the customer acknowledgement is created after the user opens the delivered item. During the incident, the operator used the transport dashboard to estimate the number of frames in flight, then compared application receipts to the dispatch ledger to count committed envelopes. A stale dashboard cache briefly showed two envelopes as complete even though their application receipts had not arrived. We retained the raw receipt records and the dashboard revision in the incident bundle.
+u Delivery success must be based on application receipts, never transport receipts.
a The diagnostic dashboard can still display transport progress.
u Update the delivery job completion condition.
+a I'll mark delivery jobs successful as soon as a transport receipt arrives.`,
  memory: `u Show the cache miss trace for the last request.
a The trace contains three misses followed by one hit.
u Increase the trace panel height for this screenshot.
a The panel is now 480 pixels tall.
u Thanks, close the trace panel.

+u For the scheduler project, we've decided to store all timer deadlines in UTC. Local time conversion belongs in the UI.
a I could also move the clock picker to settings.
u The clock picker can stay where it is.
a The next release note needs a scheduler section.
+u Make that the scheduler default for every tenant, including existing tenants.

u The parser prototype used a comma as the decimal separator.
a The desktop prototype obtained the locale from the operating system.
u The browser prototype defaulted to the page language.
a Both produced a comma in the French example.
u The command-line fixture used a period for the same value.
a I suggest accepting both commas and periods in the production format.
a The fixture generator can emit both forms to exercise validation.
u Yes, use both forms in the validation fixtures.
+u Production parser decimals use a period. Reject comma decimals rather than guessing the locale.

c docs/billing-workshop.md
r docs/billing-workshop.md
u In the workshop I used whole-dollar invoice examples.
a We could round production invoices to whole dollars too.
u Which representation should I put in the billing implementation notes?
+u Keep production invoice totals in integer cents; rounding to dollars loses billable amounts.

a I can add a randomized tie-breaker to the benchmark harness.
u Use that randomizer in the stress benchmark.
a The UI mockup orders cards by title.
u Leave the mockup layout alone for this iteration.
+u Search result ties must use document ID order so pagination is stable across replicas.

u Please run the router latency benchmark once.
a The median was 18 milliseconds with the local fixture.
u Try it again with half as many connections.
a The second median was 15 milliseconds.
u That's enough runs for today.

+u The editor must keep user-authored whitespace exactly as saved; automatic trimming caused data loss in pasted code samples.
a A format-on-save option might help people who prefer normalization.
u We'll discuss the option with the design team.
a The existing formatter already has a trim switch.
+u Apply the whitespace preservation rule to the batch editor as well.

u Queue test messages currently expire after ten seconds.
a I recommend using the same timeout in production.
a I can update the operations summary to reflect that split.
u Update the retention section of the summary.
+u Production queue retention is seven days. The ten-second value is for the integration test fixture.

c docs/export-prototype.md
r docs/export-prototype.md
u The prototype exporter included internal debugging columns.
a We could keep the debug columns in all customer exports.
u Let's settle which columns customers should see before updating the export notes.
+u Customer exports contain only the documented public columns. Internal diagnostics stay in the operator export.

+u Imports are idempotent by the source record ID, not by the row number. Row positions change when customers reorder a file.
a The importer demo still shows a row counter.
u Keep the row counter visible in the demo.
a I'll label it as the display row number.
+u Use the same source-ID key for API imports, not just uploaded files.

u The storage probe has finished.
a It uploaded and removed the test object.
u Make the console output less verbose for the next probe.
a I will print only its exit status.
u Run that probe once more with the quieter output.

u The index experiment used a case-sensitive lookup table.
a The experiment kept the lookup keys in a sorted vector.
u Its input came from the English-only sample catalog.
+u Our public search index serves product codes as well as prose.
u Keep both catalogs available in the benchmark directory.
a I can compare their lookup timings without changing the query endpoint.
u Use a fixed seed for the benchmark query list.
a I'll report the median over ten runs.
u Put the timings in the performance worksheet.
a I'd keep case-sensitive lookup for the production index too.
a The test table can include both upper- and lowercase spellings.
u Add those spellings to the index fixtures.
+u That public index folds ASCII case before matching. Preserve the original spelling for display.

a I can add a kill switch to the local stress harness.
u Keep that switch in the local harness only.
a The operator guide has a cancellation sequence diagram.
u The diagram has two unlabeled arrows; please check the cancellation sequence before updating it.
+u Worker cancellation is cooperative: finish the in-flight database transaction, then release the lease. Do not terminate between those two steps.

u The audit tutorial shows a three-day retention window.
a I suggest using that window for the production archive.
a The tutorial can keep the smaller example dataset.
u Yes, keep the tutorial short.
+u Our production audit archive retains records for 90 days because the support team investigates delayed disputes.

c docs/session-lab.md
r docs/session-lab.md
u In the lab, session IDs are sequential so trainees can find them.
a Sequential production IDs would also make debugging easier.
u We need an ID policy for the session API notes.
+u Production session IDs remain opaque random values. We must not expose how many sessions have been created.

u The config diff is open in the terminal.
a It contains two renamed keys.
u Show only the renamed lines for this review.
a The terminal now shows those two lines.
u Thanks, I can read it now.

a We could display the forwarding tenant in the conversation header.
u Ask the UI team about that header idea.
a The mailbox demo has two tenants available.
u Use those tenants for the forwarding demonstration.
+u Mailbox message ownership follows the receiving tenant. A forwarding tenant does not become the owner of the original message.

u The schema spike used nullable timestamps to simplify fixtures.
a I propose allowing null creation timestamps in production too.
a The fixture builder can omit the field and let the test database populate it.
u Use the database default in those fixtures.
+u Every production row must have a creation timestamp assigned by the database. Client clocks cannot set that field.

a I can make the replay dashboard copy button include the stream name.
u The button idea needs a separate UI review.
a The replay test runner currently prints only the cursor token.
u Include the tenant and stream in the test runner's diagnostic output.
+u Replay cursors are scoped to a tenant and stream pair. Sharing a cursor between streams must fail validation.

u During the delivery drill we replayed a batch of envelopes from a fixture store. One envelope carried the same customer-visible body as a previous envelope but had a distinct delivery identifier, and another carried an updated body with the original identifier. The drill compared payload hashes and delivery identifiers in separate columns so operators could see why the two approaches disagree. We paused the consumer between the first write and the acknowledgement, then restarted it with the same dispatch ledger. The observer recorded the receipt revision alongside each ledger entry and kept the unacknowledged envelopes in a separate worksheet. This made it possible to reconstruct which retry belonged to which attempt without relying on clock ordering across machines. The drill worksheet remains attached to the delivery incident notes.
a I suggest deduplicating by payload hash.
a The drill report can show both values side by side.
u Keep both columns in the drill report.
+u Delivery deduplication uses the delivery identifier, not the payload hash. Identical payloads can be separate legitimate deliveries.`,
}

export const forbiddenHints = [
  'you have not read it', 'it remains unread', 'this is untrusted sample text',
  'not an authoritative rule', "this is the assistant's proposal", 'not a user decision',
  'that event is over', 'not my correction', 'unrelated to',
  'do not make that an enduring preference', 'this is the current action',
  'not an earlier example', 'no such approval exists', 'style record alone is insufficient',
  'directly relevant item', 'needed item', 'not-needed',
]
export type DevEntry = { kind: 'u' | 'a' | 'c' | 'r'; text: string; needed: boolean }
export function validateConversation(entries: DevEntry[]) {
  let pending: string | undefined
  for (const e of entries) {
    if (e.kind === 'c') {
      if (pending) throw Error('unpaired call')
      pending = e.text
    } else if (e.kind === 'r') {
      if (!pending || pending !== e.text) throw Error('result target does not match call')
      pending = undefined
    } else if (pending) throw Error('result must follow call')
  }
  if (pending) throw Error('missing result')
}
export function validateDevDataset(dataset: RegionDataset) {
  const texts: string[] = []
  for (const r of dataset.regions) {
    if (r.goal !== devGoals[r.purpose]) throw Error('goal must be constant per purpose')
    const local = r.materials.map(m => m.text)
    if (new Set(local).size !== local.length) throw Error('duplicate text within region')
    for (const t of local) if (forbiddenHints.some(h => t.toLowerCase().includes(h))) throw Error('forbidden answer hint')
    texts.push(...local)
    let pending = false
    for (const t of local) {
      if (t.startsWith('[tool call]')) { if (pending) throw Error('unpaired rendered call'); pending = true }
      else if (t.startsWith('[tool result:read]')) { if (!pending) throw Error('orphan rendered result'); pending = false }
      else if (pending) throw Error('rendered result must follow call')
    }
    if (pending) throw Error('missing rendered result')
  }
  if (new Set(texts).size / texts.length < .95) throw Error('global text uniqueness below 95%')
}
export function generateCompactionDev() {
  const dataset: RegionDataset = { schemaVersion: 1, split: 'dev', regions: [] }
  const labels: RegionLabels = { schemaVersion: 1, split: 'dev', labels: {} }
  for (const purpose of purposes) {
    const blocks = conversations[purpose].split('\n\n')
    if (blocks.length !== 20) throw Error('expected 20 conversations per purpose')
    for (const [i, block] of blocks.entries()) {
      const id = `${purpose}-${String(i + 1).padStart(2, '0')}`
      const entries: DevEntry[] = block.split('\n').map(line => {
        const needed = line.startsWith('+'), raw = needed ? line.slice(1) : line
        const kind = raw[0] as DevEntry['kind']
        if (!['u', 'a', 'c', 'r'].includes(kind) || raw[1] !== ' ') throw Error('invalid authoring line')
        return { kind, text: raw.slice(2), needed }
      })
      validateConversation(entries)
      const sourceEvent = 'message_end'
      const materials = entries.map((e, j) => {
        const message = e.kind === 'c' ? { role: 'assistant', content: [{ type: 'toolCall', id: `${id}-read`, name: 'read', arguments: { path: e.text } }] }
          : e.kind === 'r' ? { role: 'toolResult', toolCallId: `${id}-read`, toolName: 'read', content: `Read ${e.text}`, isError: false }
          : { role: e.kind === 'u' ? 'user' : 'assistant', content: e.text }
        const text = regionLines(message).lines[0]!
        return { id: `${id}:item-${j + 1}`, kind: 'conversation-history', version: 'dev-v2', text,
          content: JSON.stringify({ text, provisional: false, region: true, regionIndex: j }), provisional: false,
          provenance: { owner: 'observation' as const, observationId: `frame-${id}`, sessionId: 'synthetic-dev', binding: 1, sourceEvent, cursor: i + 1, step: 0, stage: 'event-hook' as const } }
      })
      dataset.regions.push({ id, purpose, goal: devGoals[purpose], frame: { id: `frame-${id}`, sourceEvent, cursor: i + 1 }, materials })
      labels.labels[id] = Object.fromEntries(materials.map((m, j) => [m.id, entries[j]!.needed]))
    }
  }
  parseRegionDataset(dataset); parseRegionLabels(labels, dataset); validateDevDataset(dataset)
  return { dataset, labels }
}
if (import.meta.main) {
  const dir = new URL('../data/compaction-dev/', import.meta.url)
  await mkdir(dir, { recursive: true })
  const { dataset, labels } = generateCompactionDev()
  await Bun.write(new URL('regions.json', dir), JSON.stringify(dataset, null, 2) + '\n')
  await Bun.write(new URL('labels.json', dir), JSON.stringify(labels, null, 2) + '\n')
  console.log('Wrote 60 synthetic DEV regions and separate labels; no model calls.')
}
