// Dataset authoring only; no providers, production changes, or DEV/holdout writes.
import { mkdir } from 'node:fs/promises'
import { regionLines } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-material.ts'
import { planRegionCompaction, regionBytes } from '@lazy-harness/monitoring-core/engine/region-compaction.ts'
import { devGoals, validateConversation, validateDevDataset, type DevEntry } from './compaction-generate-dev.ts'
import { parseRegionDataset, parseRegionLabels, purposes, type Purpose, type RegionDataset, type RegionLabels } from './compaction-dataset.ts'

// Each case has its own problem, evidence, distractors, and separate side investigation.
// + marks author-only gold; it is stripped before rendering. c/r pairs are read attempts.
const cases: Record<Purpose, string[]> = {
  references: [
`+u The accepted voucher cancellation contract is docs/vouchers/void-after-capture.md. A cancelled voucher can already have a captured balance; the kiosk guide only describes unused vouchers.
+a The incident attaches capture 71 to voucher 19, followed by a void request after the till disconnected. The settlement record still contains the capture; this is not the unused-voucher path.
+u The till log and the bank extract use different clocks, so use their linked operation identifiers to reconstruct this sequence. Here is the captured-voucher extract copied from the incident worksheet: operation | voucher | predecessor | local clock | posted state; issue-18 | 19 | none | 08:41:12 | issued; capture-71 | 19 | issue-18 | 08:45:09 | captured; void-72 | 19 | capture-71 | 08:43:55 | pending; reconcile-73 | 19 | capture-71 | 08:46:31 | captured. The bank row names capture-71, and the pending void has no bank reversal identifier. The kiosk restarted between the capture and the void; a repeated display receipt was printed after restart, but it did not create another capture.
u The kiosk training booklet says that voiding removes a voucher immediately from its local list.
+c docs/vouchers/void-after-capture.md
+r docs/vouchers/void-after-capture.md
u Can you crop the store map for the receipt printer installation sheet?
@ trace printer_slot paper_width_mm cutter_cycles spool_depth jam_sensor
! Receipt printer calibration records belong to the facilities rollout. The narrow paper tray was tested with adhesive labels, whereas the wide tray was tested with ordinary receipt rolls. The cutter was serviced before the second test.
> Determine what the captured-voucher cancellation contract permits before patching the till recovery handler.
< I'll investigate cancellation ordering against the adopted record rather than infer it from the kiosk display.`,
`a The federation importer has an institution directory and a researcher directory.
+u docs/federation/orcid-merge.md covers researcher identity merges; docs/federation/campus-aliases.md is for institutions. The bug is a researcher who changed affiliation without changing their ORCID.
+a The failing upload contains two campus identifiers but one researcher identifier. The duplicate appears after affiliation normalization, before the publication list is attached.
u Last year's campus migration used the institution alias table to combine duplicate campuses.
+c docs/federation/orcid-merge.md
+r docs/federation/orcid-merge.md
@ csv rack fan_rpm inlet_celsius outlet_celsius filter_days
! Lab ventilation maintenance has separate inlet and outlet sensors. Facilities measured airflow with a sealed cabinet and then with the access panel removed. The filter replacement forecast uses running hours rather than the calendar date on the sticker.
> Find the researcher-merge rule for an affiliation change before recommending a deduplication key.
< I'll trace the researcher identity join and leave the campus migration alone.`,
`+a The map in docs/transit/fare-cap-ledger.md links daily fare caps to posted rides; docs/transit/fare-cap-preview.md describes estimates before the ride posts.
+u We charged a rider for the transfer twice after a delayed validator upload. Both rides are posted, and the service day crossed midnight in the rider's city.
u The route simulator resets its estimate counter at midnight UTC.
+c docs/transit/fare-cap-ledger.md
+r docs/transit/fare-cap-ledger.md
@ kv screen contrast_ratio ambient_lux refresh_hz dead_pixels
! Platform display acceptance testing samples ambient light beside the departure board. One sample was taken before sunrise and another during glare from the west windows. The screen refresh measurement was recorded independently of the train timetable feed.
> Consult the posted-ride ledger contract for the delayed transfer charge.
< I'll use the posted service-day definition when investigating the fare cap.`,
`u The PDF composer restarted while embedding a font subset.
a The preview renderer silently uses a fallback font if it cannot find the requested glyph.
+u Publication builds use docs/typesetting/font-license-embedding.md, not the preview fallback guide. The customer asks whether the licensed face may be embedded in the downloadable PDF at all.
@ tsv specimen magnification stain_minutes slide_temperature focus_steps
! The microscopy teaching set has ten sample slides. Students adjusted focus after changing magnification and recorded whether the stain had dried. The instructor keeps one worksheet beside each microscope.
> Locate the embedding license decision before we rebuild the publication PDF.
< I'll inspect the publication license record and keep preview behavior out of the conclusion.`,
`+u The raft witness promotion procedure is in ops/quorum/witness-to-voter.md; ops/quorum/replace-disk.md only covers a voter retaining its identity.
+a Node cedar is a witness with no full log, and the operator wants to promote it while birch is offline. A disk replacement recipe would start from a full voter snapshot that cedar does not possess.
u The previous disk replacement succeeded without changing the cluster membership list.
+c ops/quorum/witness-to-voter.md
+r ops/quorum/witness-to-voter.md
@ json route hop_limit packet_bytes rtt_microseconds loss_basis_points
! The office network inventory includes a floor switch and a wireless bridge. The bridge was tested with small packets before the large-packet run. The helpdesk requested separate latency and packet-loss columns for its cabling worksheet.
> Review the witness promotion prerequisites before issuing a membership command.
< I'll compare cedar's actual state with the promotion record.`,
`a The object browser can display a restored thumbnail even when the original is offline.
+u docs/archive/tape-recall.md is the accepted contract for original-object recalls; docs/archive/cache-warming.md is about previews. Our job requests the original scan from a tape volume that has been removed from the robot.
u The preview cache runbook retries automatically when a thumbnail goes missing.
@ table battery charge_percent cycle_count internal_resistance millivolts
! Handheld scanner batteries were characterized in the warehouse charging room. One pack had high resistance despite showing a full charge. Procurement wants the measurements retained separately from the device inventory so replacements can be ordered by electrical condition.
> Check the offline-tape recall procedure before changing the original-scan retry loop.
< I'll find the tape operator handoff conditions rather than reuse preview retries.`,
`+a The infrastructure index points to decisions/dns/split-horizon-approval.md for private names and decisions/dns/public-zone.md for internet names.
+c decisions/dns/split-horizon-approval.md
+r decisions/dns/split-horizon-approval.md
+u The failing lookup is from a build worker inside the private network; its resolver gets the public answer after VPN reconnect. We need the private-zone policy before touching TTLs.
u Marketing's public site migration shortened its DNS TTL to five minutes.
@ log microphone gain_db noise_floor_db sample_hz clipping_frames
! The conference room audio pilot recorded quiet-room noise before increasing microphone gain. A second pass included the ventilation fan. The events team requested raw clipping counts alongside the listening notes because perceived loudness alone concealed overload.
> Investigate private-name resolution using the split-horizon decision.
< I'll check resolver routing before proposing cache settings.`,
`u The habitat dashboard legend is finally legible.
a I moved the wetland series above the meadow series.
u Could the workshop map use a larger north arrow?
@ matrix greenhouse bed humidity_percent soil_ph drainage_seconds shade_percent
! Greenhouse volunteers measured pot drainage after replacing the growing medium. The north benches retained water longer than the south benches. The gardening club wants a printable worksheet with enough room to write observations beside each numeric sample.
> For the laboratory sensor firmware, read docs/sensors/dewpoint-calibration.md before changing its humidity correction. The greenhouse display is a separate project.
< I'll inspect the dewpoint calibration contract for the firmware patch.`,
`+u We have separate failure policies: docs/auction/sealed-bid-reveal.md for sealed auctions and docs/auction/live-room.md for live bidding. This report concerns an unopened sealed bid after the seller's clock was corrected.
+a The bid hash was committed before closure, but the reveal message arrived after the seller adjusted the local clock. Its transport receipt contains the server monotonic timestamp.
u In the live room, the countdown widget accepts an operator extension.
+c docs/auction/sealed-bid-reveal.md
+r docs/auction/sealed-bid-reveal.md
@ lines kiln glaze_code firing_celsius soak_minutes cone_number
! The pottery studio logged glaze samples during a kiln controller upgrade. Several tiles share a glaze name but came from different firing schedules. The studio catalog needs the schedule alongside the appearance notes to avoid confusing a controller test with a glaze recipe.
> Consult the sealed-bid reveal timing contract before changing rejection logic.
< I'll compare server timing with the adopted reveal policy.`,
`+a Shipping contract docs/cold-chain/probe-loss.md covers missing temperature samples during transit. docs/cold-chain/probe-replacement.md assumes a parcel is still at the depot.
+u The parcel is aboard a ferry with no radio link. The last sample is thirty minutes old, and the consignee needs to know whether release at arrival requires a manual inspection.
u Depot technicians replace a dead probe before dispatching a parcel.
@ pipe lens aperture focus_distance distortion_percent edge_sharpness
! The photography club tested a borrowed lens against a flat checkerboard. Near-focus distortion differed from the infinity setting. The exhibition team wants the measurements as an appendix rather than a rating because its portraits use a different working distance.
> Read the in-transit probe-loss policy before advising the arrival team.
< I'll distinguish a communications gap from a depot replacement.`,
  ],
  'rule-steering': [
`+u Payroll corrections must create compensating entries; posted pay lines cannot be overwritten. The ledger is used to reproduce signed payslips, including mistakes and the later correction. A preview payslip can be regenerated freely because it has not been posted.
+a I plan to update the amount on the posted pay line so the recalculation produces the corrected total.
+a The patch plan currently has these steps: phase | table | mutation | trigger; lookup | pay_lines | select posted row | correction accepted; rewrite | pay_lines | set gross and tax | totals recalculated; refresh | payslip_files | replace PDF | write complete; reconcile | bank_exports | recompute delta | next export. The row carries the identifier of the signed payslip from last month. I will retain that identifier while replacing the amounts and regenerate the PDF at its existing URL. The bank adjustment will be a new export row, but the posted payroll table will contain only the corrected figures. I have not added a separate compensating pay line to this plan.
u The preview generator updates draft amounts in place.
+c rules/payroll/posted-lines.md
+r rules/payroll/posted-lines.md
@ histogram treadmill belt_speed incline motor_watts session_seconds
! The gym maintenance crew tested treadmill motors at several inclines. The empty-belt run was recorded before a weighted test. The facilities report needs motor load and elapsed time together so a slow warmup is not mistaken for a worn bearing.
> Patch the posted-pay correction flow using the ledger rule we agreed.
< I'll prepare the correction changes and their tests.`,
`+a The path I'm about to change is the production webhook verifier, not the fixture recorder. It currently rejects a signature when the timestamp is outside the tolerance.
+u Webhook signatures must be verified against the raw received bytes before decoding JSON. Equivalent JSON objects can have different serialized byte strings; our fixture recorder is allowed to pretty-print saved examples but the verifier is not.
a The fixture recorder formats JSON with two spaces for readability.
+c rules/hooks/raw-signatures.md
+r rules/hooks/raw-signatures.md
@ series loom warp_threads weft_tension shuttle_rate broken_ends
! A weaving class is documenting loom setup after changing thread suppliers. The cotton warp and linen warp were tensioned separately. The instructor wants the broken-thread count visible beside shuttle rate so students do not optimize speed at the expense of the fabric.
> Implement the webhook parser refactor without breaking signature verification.
< I'll wire the parser into the verification path.`,
`+u Production appointment slots must be claimed atomically with the reservation write. A free-slot read alone is not a reservation, since two clinics may submit at the same time.
+a I will split the reservation transaction into a read of available slots and an unconditional write after the browser confirms.
u The waiting-room mockup keeps a local array of available slots.
@ records buoy wave_height tide_metres wind_knots sample_interval
! The harbor training buoy recorded wave height at multiple sampling intervals. The cadets compared a short gust with the longer tide trend. The exercise worksheet keeps wind and tide separate because they affect the mooring line differently.
> Update the production appointment reservation handler.
< I'll add the browser confirmation and server-side changes.`,
`u The garden watering demo shows every valve as open.
a The demo runs from a static array with no pump attached.
+u Irrigation controller changes must keep the pump interlock engaged until pressure is below the release threshold. The maintenance simulator can bypass it, but field controllers cannot.
+a I intend to disengage the field pump interlock immediately when the stop button is pressed.
+c rules/irrigation/pressure-interlock.md
+r rules/irrigation/pressure-interlock.md
@ readings telescope azimuth altitude tracking_error exposure_seconds
! Observatory volunteers aligned the teaching telescope on a fixed target before enabling tracking. The tracking error was measured at several elevations. The public-night checklist needs the alignment sequence, not just the final exposure chosen for the photograph.
> Make the field-controller stop response faster.
< I'll prepare the interlock timing patch.`,
`+u Package publishing requires verification of the tarball digest after downloading it from the release mirror. A matching package version is insufficient; mirror caches can serve a different build with the same version.
+a The release job is going to trust the version string and skip digest verification on mirror downloads.
u Local development packages use an unsigned file link.
+c rules/publish/mirror-digest.md
+r rules/publish/mirror-digest.md
@ grid ferry berth ramp_angle deck_clearance vehicle_count loading_minutes
! The ferry operator measured loading ramps at different water levels. One berth has a shorter ramp and reaches a steeper angle at low tide. The training worksheet includes loading time only to help plan staffing, not to establish passenger eligibility.
> Speed up the mirrored-package release job while following the publishing policy.
< I'll adjust the download and verification steps.`,
`+a The gallery has public exhibit descriptions and restricted conservation photographs. I am editing the photograph download endpoint to allow links without a session.
+u Conservation photographs require a curator session even when their exhibit description is public. The access check applies to the original download and to every generated resolution; public exhibit text does not grant access to image derivatives.
u The public brochure uses low-resolution photographs commissioned for advertising.
@ ledger lift floor door_cycles motor_current leveling_error
! A building survey logged elevator leveling at each floor. The basement landing has a different sill height from the offices. Maintenance wants door-cycle totals kept with the electrical readings to distinguish a door fault from a traction problem.
> Implement the conservation photograph share-link feature.
< I'll update the original and derivative endpoints.`,
`+u A tournament result becomes official only after both captains sign. The scoreboard may show provisional scores earlier, but it cannot trigger ranking updates from a provisional result.
+a I'll update rankings when the first captain submits the score, then correct them if the other captain disputes it.
+c rules/league/two-signatures.md
+r rules/league/two-signatures.md
u Friendly exhibition matches don't affect rankings and use only one submission.
@ worksheet orchard tree_age trunk_mm blossom_count irrigation_litres
! Orchard volunteers surveyed young trees before spring pruning. Blossom counts differ sharply between rootstocks, so the worksheet records age and trunk diameter as well. The harvest forecast will be discussed later after the pollination visit.
> Ship the official match-result ranking update.
< I'll connect result submission to the rankings worker.`,
`u The ceramic workshop's sample inventory now sorts correctly.
a The tray labels match the shelf map.
u Can you enlarge the instructor's name on the sign-in sheet?
@ sequence glider altitude airspeed sink_rate ballast_kg
! The soaring club compared glide performance with different ballast loads. One run was interrupted by rising air near the ridge. The club notebook retains the interrupted run so instructors can discuss why it should not be averaged with still-air measurements.
> Change the production donation form, but keep donor email out of public acknowledgements. Public acknowledgement records must contain only the donor's chosen display name.
< I'll add donor email to the public acknowledgement JSON along with the display name.`,
`+u The geofence evaluator must use the signed boundary revision attached to each permit. New map revisions cannot retroactively change an issued permit; the live map is only for drafting the next permit.
+a I am replacing stored permit boundaries with a lookup of the newest map revision during evaluation.
u The permit drafting screen always loads the newest map.
+c rules/permits/frozen-boundary.md
+r rules/permits/frozen-boundary.md
@ inventory bakery oven_zone dough_grams proof_minutes crumb_temperature
! The bakery training oven has independently controlled upper and lower zones. Apprentices recorded dough weight before proofing and crumb temperature after baking. The tasting notes are stored separately because preferences cannot substitute for the thermal measurements.
> Refactor the issued-permit geofence evaluator.
< I'll make the boundary lookup shared with the drafting screen.`,
`+a The lab instrument writes an unsigned scratch file before the measurement is approved. I'm about to expose that scratch path through the certified-results endpoint.
+u Certified measurement downloads must come from the signed immutable artifact. Scratch files can be overwritten during calibration and cannot serve as certification evidence, even when their current values match the signed report.
u Calibration notebooks link to scratch data while an instrument is being adjusted.
@ samples violin string_length bow_pressure fundamental_hz decay_ms
! The music conservatory measured string response using a mechanical bow. Students changed bow pressure without changing string length, then repeated with another length. The lab sheet separates the fundamental pitch from decay time so the two effects remain distinguishable.
> Implement the certified-result download endpoint.
< I'll connect the endpoint to the instrument's output files.`,
  ],
  memory: [
`+u We settled the museum accession numbering: numbers are never reused, including when an object is deaccessioned. The gap is part of the custody history. Temporary crate numbers can be recycled because they identify packing equipment, not collection objects.
+a I'll write the accession decision into the collections handbook with the distinction between objects and crates.
u The packing team reused crate 12 for the sculpture shipment.
+c decisions/museum/accession-numbers.md
+r decisions/museum/accession-numbers.md
@ rows kayak hull_length load_kg draft_cm turning_radius
! The paddling club tested training kayaks with several ballast loads. A wider hull turned differently in still water than in the tidal channel. The instructor's worksheet keeps the testing location alongside draft measurements so new students can compare like conditions.
> Retain our accession-number decision for the collections project.
< I'll prepare the handbook entry and preserve the rationale.`,
`+a The planning meeting ended with a decision to keep the weather station's raw samples for two years and hourly aggregates for ten years. The reason was the calibration team's need to reprocess two seasonal cycles.
+u Include the storage schedule agreed by the ridge team: stream | resolution | retention | custodian; mast-temperature | raw | two years | instrumentation; rainfall | raw | two years | hydrology; wind | raw | two years | instrumentation; station-summary | hourly | ten years | archive office. Retention runs from observation time rather than the date an offline buffer is uploaded. If a ridge radio outage delays a batch by a month, its observation timestamps still govern expiry. We made the same observation-time choice for both raw samples and aggregates so that delayed uploads cannot extend the promised historical coverage inconsistently.
+u Yes, record that retention split for the ridge station. The valley classroom station still uses a one-week buffer for student experiments; it has no archival commitment.
u The classroom teacher empties the buffer after the lab exercise.
+c decisions/weather/ridge-retention.md
+r decisions/weather/ridge-retention.md
@ chart press ink_density paper_gsm roller_gap drying_seconds
! The printmaking studio tested a new ink on several paper weights. Students measured drying time before stacking prints. The archive needs roller-gap measurements next to paper weight because a heavier sheet required a different press setting.
> Save the ridge station retention decision with its rationale.
< I'll draft the project memory for review.`,
`+u In the cooperative grocery, member credit is denominated in kilograms of the monthly staple basket, not currency. This keeps the entitlement stable when retail prices change. The cash register can show a currency estimate, but it does not define the balance.
+a I'll document basket-weight credit as the cooperative's chosen accounting unit.
u The fundraising kiosk shows donations as currency amounts.
@ columns balloon envelope_volume payload_grams ascent_mps burst_km
! The school balloon project weighed the tracking equipment before filling the envelope. A heavier battery extended transmission time but reduced the predicted burst altitude. The classroom worksheet keeps the tradeoff visible rather than choosing the lightest payload automatically.
> Preserve the member-credit accounting decision for future cooperative work.
< I'll prepare a concise record of the unit and its purpose.`,
`a The language club tested alphabetical seating for the introductory class.
+u For the adult language programme we've decided to rotate conversation partners each week, keeping only accessibility pairings fixed. Stable pairs were comfortable but left newcomers isolated; children's tutoring will continue with fixed mentors.
+a I'll put the adult rotation decision and the accessibility exception into the programme notes.
+c decisions/languages/adult-partners.md
+r decisions/languages/adult-partners.md
@ report sail mast_height sheet_load heel_degrees reef_level
! The sailing school measured sheet loads with different reef settings. The instructor recorded heel angle before changing the sail area. The safety seminar needs the raw readings as well as the route notes to explain how gusts affected the lesson.
> Keep the adult conversation-partner arrangement in project memory.
< I'll draft that programme decision for review.`,
`+u Our water-quality project will publish dissolved oxygen readings with the probe temperature and calibration date. Oxygen alone was misleading after a warm spell; the classroom demonstration may still use a simplified oxygen-only plot.
+a I'll record the publication fields and the warm-weather rationale in the monitoring project notes.
u The classroom poster has only enough room for one plot.
+c decisions/water/oxygen-context.md
+r decisions/water/oxygen-context.md
@ stats lathe stock_mm spindle_rpm feed_mm_min surface_microns
! The makerspace lathe course compared surface finish under several feeds. The steel samples were cut with a freshly sharpened tool, while the brass samples used a separate tool. The worksheet includes material and tool condition so students can interpret roughness measurements.
> Save the water-quality publication decision.
< I'll retain the required context fields in the project record.`,
`+a The archive steering group chose to retain the spelling on historical placards, with modern names in a separate search field. The discussion rejected silently rewriting the original placard text.
+u Confirmed for the railway photograph archive. Corrections to our own cataloguing typos are still allowed; historical spelling belongs to the source, while a transcription error is ours.
u The tourist leaflet uses only modern station names.
@ measurements aquarium salinity oxygen_mg_l flow_l_min lamp_hours
! Aquarium volunteers surveyed the quarantine tank after replacing its circulation pump. Salinity stayed steady while flow increased. The husbandry worksheet records lamp hours separately because the lighting replacement is scheduled by operating time rather than water chemistry.
> Preserve the railway archive spelling decision and its correction exception.
< I'll prepare a source-faithfulness record for review.`,
`+u We've chosen walk-in allocation by arrival order for the legal clinic, with a separate emergency triage queue. A lottery made waiting unpredictable for people who travel by bus. Scheduled consultations keep their appointment times.
+a I'll retain the walk-in and emergency distinction in the clinic operations notes.
+c decisions/clinic/walk-in-order.md
+r decisions/clinic/walk-in-order.md
u The summer fundraiser assigns prize tickets by lottery.
@ observations compost pile_height core_celsius moisture_percent turning_days
! The community garden measured compost temperatures before turning each pile. The wetter pile cooled more slowly even though its core started warmer. Volunteers requested the turning dates next to moisture measurements so they can plan the next work session.
> Remember the clinic's walk-in allocation decision for future operations reviews.
< I'll draft the policy record with the travel rationale.`,
`u The chess club signup sheet is readable now.
a I widened the column for junior members.
u Could you move the date above the club logo?
@ dataset canoe paddle_length stroke_rate speed_kmh heart_rate
! The canoe coaching session compared two paddle lengths on a sheltered course. Athletes rested between runs to avoid treating fatigue as a paddle effect. The training diary includes stroke rate and heart rate so the coach can interpret a faster time in context.
> Record our new planetarium booking decision: school groups reserve the whole dome, never individual seats. Mixed public and school bookings disrupted the teaching session, so public shows use separate time slots.
< I'll prepare that planetarium decision for independent memory review.`,
`+u The seed library has chosen germination-test year as the primary freshness indicator, not packet printing year. Old packaging can contain recently tested viable seeds. A missing test date must be shown as unknown rather than inferred from the artwork.
+a I'll include the unknown-date handling in the seed catalogue decision.
+c decisions/seeds/freshness.md
+r decisions/seeds/freshness.md
u The fundraising brochure is reprinted annually with new artwork.
@ audit anvil hammer_grams rebound_percent face_hardness strike_count
! The blacksmithing class inspected training anvils after resurfacing. Rebound was measured with the same hammer at several face positions. The workshop ledger includes strike counts because a damaged edge should not be mistaken for a uniform change in material hardness.
> Keep the seed freshness decision available for later catalogue work.
< I'll draft the germination-date record.`,
`+a The rescue coordination meeting chose radio callsigns per boat rather than per volunteer. Crew swaps during a shift made person-based callsigns ambiguous, and the harbor desk needs to address a vessel consistently.
+u That's the standing arrangement for rescue boats. Shore patrols still use person-based callsigns because they do not swap vehicles during a shift.
u The regatta announcer introduces volunteers by their own names.
+c decisions/rescue/boat-callsigns.md
+r decisions/rescue/boat-callsigns.md
@ checklist piano key_number downweight_grams return_ms travel_mm
! The piano workshop measured key action before adjusting balance weights. The bass keys returned more slowly than the middle register. Students kept travel measurements beside downweight so they could distinguish friction from a simple imbalance.
> Save the rescue callsign arrangement and the shore-patrol distinction.
< I'll prepare the coordination decision for review.`,
  ],
}

// These are actual synthetic bench observations, not prose padding. Each side
// investigation has a different measurement schema and its own units/context.
// Output excerpts are quoted by the assistant: native regionLines intentionally
// projects tool results to status/error-only and must not be changed for this corpus.
function bench(fields: string[], caseIndex: number, page: number) {
  const [format, entity, ...columns] = fields
  const rows = Array.from({ length: 15 }, (_, row) => {
    const values = columns.map((_, col) => ((caseIndex + 3) * (row + 2) * (col + 1) + page * 17) % 997)
    const key = `${entity}-${page * 15 + row + 1}`
    if (format === 'json' || (caseIndex + page) % 4 === 0) return JSON.stringify({ [entity!]: key, ...Object.fromEntries(columns.map((c, i) => [c, values[i]])) })
    const sep = format === 'csv' ? ',' : format === 'tsv' ? '\t' : ' | '
    return [key, ...values].join(sep)
  })
  return `${columns.join(' / ')}\n${rows.join('\n')}`
}

const nearMisses: Record<Purpose, string[]> = {
  references: [
    'The voucher sandbox design from 2021 deleted captured rows on void; it predates reconciliation with the bank ledger.',
    'The library institution directory still accepts a campus display name as its merge key for legacy uploads.',
    'The concession-card brochure describes a monthly discount, while this operator sells both concession and ordinary stored-value tickets.',
    'A desktop trial bundled an open-source face in its PDF without a license check; that trial did not use the commercial publication font.',
    'The spare-voter commissioning note assumes a complete snapshot is already on disk; the witness inventory lists only vote metadata.',
    'The disk-cache prototype exposed cached previews immediately after an object was deleted from the gallery.',
    'The public-zone migration ticket allows external resolvers to receive the public address even from a corporate laptop.',
    'The horticulture app uses a soil-moisture lookup table in docs/garden/pot-calibration.md for watering reminders.',
    'The Dutch-auction prototype accepts price changes until the first buyer confirms; it has no sealed reveal phase.',
    'The depot checklist allows technicians to discard a broken probe before loading and pair a fresh serial number.',
  ],
  'rule-steering': [
    'The payroll prototype rewrote draft line amounts directly before posting existed; its fixtures still use that helper.',
    'The internal event viewer decodes JSON and pretty-prints it before saving a local example for the workshop.',
    'The booking simulation in the design deck checks availability in the browser, with only one simulated receptionist.',
    'The maintenance simulator drops the interlock as soon as stop is clicked so trainees can reset its animation quickly.',
    'The old release rehearsal trusted a version string when all artifacts came from a local directory rather than a mirror.',
    'The exhibit brochure has a separate permission grant for its commissioned advertising images.',
    'Practice scoreboards at the club accept one captain entry so teams can rehearse without creating an official result.',
    'The ceramics raffle prints participant emails on the organizer-only contact sheet, which is stored behind the desk.',
    'The permit map editor previews draft boundaries against the newest survey; the preview is discarded when drafting ends.',
    'The calibration notebook links directly to the scratch directory so an operator can compare successive adjustments.',
  ],
  memory: [
    'The temporary exhibition used reusable sticker numbers for packing crates; the warehouse staff removed them after unpacking.',
    'The valley classroom voted to clear its sensor buffer weekly so each student group could start a fresh exercise.',
    'The charity stall denominates gift vouchers in currency, and the treasurer refreshes its display estimates each morning.',
    'Children in the Saturday tutoring group keep the same mentor throughout the term to support continuity.',
    'The introductory chemistry poster will continue showing an oxygen-only plot because it introduces one variable at a time.',
    'The tourist-office leaflet replaces historical station names with their modern equivalents for route planning.',
    'The legal clinic fundraiser chose a lottery for donated prizes because nobody needed to wait in person for the drawing.',
    'The chess tournament will sell single seats to spectators; whole-room booking is available only for its opening lecture.',
    'The brochure team selects packet artwork by printing year, since it needs to identify which illustration license was used.',
    'The shore patrol coordinator keeps person-based radio callsigns because walkers retain the same route for the shift.',
  ],
}
type Entry = DevEntry & { result?: string; ok?: boolean }
export function generateCompactionLongDev() {
  const dataset: RegionDataset = { schemaVersion: 1, split: 'dev', regions: [] }
  const labels: RegionLabels = { schemaVersion: 1, split: 'dev', labels: {} }
  for (const [p, purpose] of purposes.entries()) for (const [i, block] of cases[purpose].entries()) {
    const caseIndex = p * 10 + i, id = `long-${purpose}-${String(i + 1).padStart(2, '0')}`
    const lines = block.split('\n'), fields = lines.find(l => l.startsWith('@ '))!.slice(2).split(' ')
    const side = lines.find(l => l.startsWith('! '))!.slice(2)
    const finalUser = lines.find(l => l.startsWith('> '))!.slice(2), finalAssistant = lines.find(l => l.startsWith('< '))!.slice(2)
    const authored: Entry[] = lines.filter(l => /^\+?[uacr] /.test(l)).map(l => {
      const needed = l.startsWith('+'), raw = needed ? l.slice(1) : l
      return { kind: raw[0] as Entry['kind'], text: raw.slice(2), needed }
    })
    const nearMiss = nearMisses[purpose][i]!
    authored.unshift({ kind: caseIndex % 2 ? 'u' : 'a', text: nearMiss, needed: false })
    const noise: Entry[] = []
    // Unique openings and different tabular shapes; neither role nor size is a gold marker.
    const sideSentences = side.match(/[^.!?]+[.!?]+/g)!.map(s => s.trim())
    for (let page = 0; page < 5; page++) {
      const openings = [
        `${fields[1]} initial measurements are grouped by ${fields[2]}.`,
        `Calibration comparisons for ${fields[1]} retain ${fields[3]} beside the original sample key.`,
        `Environmental checks on ${fields[1]} use ${fields[4]} as a separate column.`,
        `A print-layout preview of ${fields[1]} includes the ${fields[5]} measurements.`,
        `Row reconciliation for ${fields[1]} keeps all ${fields.slice(2).join(', ')} fields together.`,
      ]
      noise.push({ kind: 'a', needed: false, text: `${openings[page]} ${sideSentences[page % sideSentences.length]}\n${bench(fields, caseIndex, page)}`.slice(0, 790) })
      if (page < 4) noise.push({ kind: 'u', needed: false, text: `${['Please lay out', 'Could you print', 'For the worksheet, compare', 'Before the workshop, format'][page]} the ${fields.slice(2).join(' and ')} observations for ${fields[1]} batch ${page + 1}. ${sideSentences[(page + 1) % sideSentences.length]} Keep room for handwritten corrections next to these measurements:\n${bench(fields, caseIndex, page + 6)}`.slice(0, 790) })
    }
    noise.push({ kind: 'u', text: side, needed: false })
    noise.push({ kind: 'a', text: `The ${fields[1]} worksheet has a second pass for the instructor. ${sideSentences[1]}\n${bench(fields, caseIndex, 12)}`.slice(0, 790), needed: false })
    for (let n = 0; n < 3; n++) {
      const record = authored.find(e => e.kind === 'c')?.text ?? `docs/${purpose}/${fields[1]}.md`
      const target = [`notes/bench/${fields[1]}-setup.md`, `archive/${record}`, `workshops/${fields[1]}/formatter-test-report.txt`][n]!
      let insertAt = (caseIndex * 3 + n * 5) % (noise.length + 1)
      if (noise[insertAt]?.kind === 'r') insertAt++
      noise.splice(insertAt, 0,
        { kind: 'c', text: target, needed: false },
        { kind: 'r', text: target, needed: false, ok: n === 2, result: `${target}: ${['fixture checkout lacks the instructor notes; the printable observations are attached to the worksheet', 'the retired record volume is not mounted; no file contents were returned', 'formatter suite passed all layout assertions'][n]}.` })
    }
    // Insert authored blocks without breaking exchanges. Different offsets/spreads
    // preserve original conversational order, not a shared catalog/read/final shape.
    const units: Entry[][] = []
    for (let a = 0; a < authored.length; a++) {
      const entry = authored[a]!
      units.push(entry.kind === 'c' ? [entry, authored[++a]!] : [entry])
    }
    const noiseUnits: Entry[][] = []
    for (let a = 0; a < noise.length; a++) noiseUnits.push(noise[a]!.kind === 'c' ? [noise[a]!, noise[++a]!] : [noise[a]!])
    const entries: Entry[] = []
    let at = 0
    // Seeded LCG chooses distinct gaps, then sorts to preserve conversation order.
    let seed = (caseIndex + 1) * 7919
    const gaps = Array.from({ length: noiseUnits.length + 1 }, (_, n) => n)
    for (let g = gaps.length - 1; g > 0; g--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const swap = seed % (g + 1)
      ;[gaps[g], gaps[swap]] = [gaps[swap]!, gaps[g]!]
    }
    const slots = gaps.slice(0, units.length).sort((a, b) => a - b)
    // Different start/middle/end distributions, including early constraints far from the action.
    if (units.length) slots[0] = caseIndex % 4 === 0 ? 0 : (caseIndex * 7) % Math.max(1, slots[0]! + 1)
    for (let n = 0; n <= noiseUnits.length; n++) {
      while (at < units.length && slots[at]! <= n) entries.push(...units[at++]!)
      if (n < noiseUnits.length) entries.push(...noiseUnits[n]!)
    }
    entries.push({ kind: 'u', text: finalUser, needed: true }, { kind: 'a', text: finalAssistant, needed: true })
    validateConversation(entries)
    let call = '', target = ''
    const materials = entries.map((e, j) => {
      if (e.kind === 'c') { call = `${id}:exchange-${j + 1}`; target = e.text }
      const message = e.kind === 'c' ? { role: 'assistant', content: [{ type: 'toolCall', id: call, name: 'read', arguments: { path: e.text } }] }
        : e.kind === 'r' ? { role: 'toolResult', toolCallId: call, toolName: 'read', isError: !e.ok, content: e.result ?? `EIO: cannot open ${target}; the record-store mount is unavailable during snapshot refresh. The mount supervisor will retry the connection on its next cycle.` }
        : { role: e.kind === 'u' ? 'user' : 'assistant', content: e.text }
      const text = regionLines(message).lines[0]!
      return { id: `${id}:item-${j + 1}`, kind: 'conversation-history', version: 'long-dev-v2', text,
        content: JSON.stringify({ text, provisional: false, region: true, regionIndex: j, ...(['c', 'r'].includes(e.kind) ? { toolCallId: call } : {}) }), provisional: false,
        provenance: { owner: 'observation' as const, observationId: `frame-${id}`, sessionId: 'synthetic-long-dev', binding: 1, sourceEvent: 'message_end', cursor: caseIndex + 1, step: 0, stage: 'event-hook' as const } }
    })
    dataset.regions.push({ id, purpose, goal: devGoals[purpose], frame: { id: `frame-${id}`, sourceEvent: 'message_end', cursor: caseIndex + 1 }, materials })
    labels.labels[id] = Object.fromEntries(materials.map((m, j) => [m.id, entries[j]!.needed]))
  }
  parseRegionDataset(dataset); parseRegionLabels(labels, dataset); validateDevDataset(dataset)
  for (const r of dataset.regions) {
    const plan = planRegionCompaction(r.materials, { frame: r.frame })
    if (plan.withinBudget || regionBytes(r.materials) > 16384) throw Error(`window bounds: ${r.id}, candidates=${plan.candidateBytes}, total=${regionBytes(r.materials)}`)
  }
  return { dataset, labels }
}
if (import.meta.main) {
  const dir = new URL('../data/compaction-long-dev/', import.meta.url), { dataset, labels } = generateCompactionLongDev()
  await mkdir(dir, { recursive: true })
  await Bun.write(new URL('regions.json', dir), JSON.stringify(dataset, null, 2) + '\n')
  await Bun.write(new URL('labels.json', dir), JSON.stringify(labels, null, 2) + '\n')
  console.log('Wrote 30 independently scoped synthetic LONG DEV cases; no model calls.')
}
