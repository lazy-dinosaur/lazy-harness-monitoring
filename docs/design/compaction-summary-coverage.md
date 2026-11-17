# Bounded observer and material compaction summaries

## Observer contract

In opt-in tail mode, the latest active `compactionSummary` is a separate snapshot
`compactionSummary: { role, summary, provenance: 'derived-summary' }` item. It is not
inserted into `canonicalMessages` or `observedMessages`. Those remain the newest
native tail after the summary. `truncatedHead` is the native index of the first kept
canonical message (so includes the separately represented summary). `summaryIncluded`
and `summaryOmittedBytes` explicitly report representation and omitted original UTF-8
bytes. No summary means false/0. Full mode (`tailMessages: 0`) is unchanged.

The default summary text share is min(8192, floor(maxSnapshotBytes / 3)) bytes;
`ObservationLimits.maxSummaryBytes` configures the upper share. The default total
ceiling remains 65536 bytes, including JSON escaping, metadata and both 64-byte
hash strings. An oversize prompt is omitted, then oldest tail items are removed
one at a time. If even the summary and metadata cannot fit, its share is reduced.
Unrepresentable identity metadata fails closed rather than exceeding the ceiling.
The canonical hash includes the separate summary and omission count.

## Material contract

`regionLines` explicitly renders `[summary]` with a 4096-byte summary text cap.
Truncation preserves Markdown section headers first, then round-robin body prefixes
by Unicode code point, with line separators so headers stay recognizable. It appends
`[summary omitted N bytes]`, counting original UTF-8 bytes, not formatting/marker bytes.
If even all headers do not fit, a deterministic header prefix is retained.

In since-last windows the summary is admitted separately from newest-first region
trimming, never as the judged frame's own item, never as a region compaction unit.
Its provenance owner and content provenance are `derived-summary`. It survives
observation tail-item filtering, but remains subject to the judged frame cursor.
It is untrusted historical context, not an instruction or authoritative fresh fact.

The 16384-byte default material ceiling includes catalog references and serialized
material content. After catalog/own-item admission, reserve 512 bytes of headroom;
the summary text cap is min(4096, floor(min(maxSourceBytes, remaining - 512) / 2)).
Shrink further until its serialized JSON fits that remaining room. Admit only if at
least 64 text bytes and sufficient source slots remain. Remaining room then goes to
the newest region items and omission metadata. A summary never triggers material_limit
by itself: with no room it is omitted. Normal own-item/catalog limits still apply.
No model calls or host compactor ownership changes occur in snapshot/rendering code.
