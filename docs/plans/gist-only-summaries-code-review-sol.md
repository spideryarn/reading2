# NO-SHIP

Line numbers refer to `cc2b67d`.

## Blocking findings

1. Importing a changed extraction strands the retained summary

[`import.ts:1016`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1016) mints a new revision when the block fingerprint changes. `revisionValues` deliberately omits `summary` at [`import.ts:1110`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1110), so that new revision gets `NULL`, then becomes current at [`import.ts:1541`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1541).

The old row is not overwritten, but its summary is stranded on a non-current revision. Every later `beginRevision` copies the current `NULL`. That is the semantic data loss the carry policy was intended to prevent.

Keeping `summary.json` out of both file directions is still right; one-way export is not better. Instead, the importer should carry the existing database column when it creates a replacement revision.

2. The column is still read by broad projections

`REVISION_READ_POLICY.summary = {}` does not make the column unread:

- [`artifacts-pg.ts:255`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:255) performs a bare `.select()` of every revision column for ordinary artefact reads, reached at [`artifacts-pg.ts:573`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:573).
- [`export.ts:367`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/export.ts:367) selects the whole `articleRevisions` table object.

Thus the claims that “nothing reads” the column at [`schema.ts:575`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:575) and [`pg.ts:419`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:419) are false. The projection-policy test only governs `REVISION_PROJECTIONS`; it cannot catch these reads.

3. A visitor can get a silent, empty Summary body

[`visitor.ts:194`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/visitor.ts:194) returns `null` unconditionally.

A valid one-block tree may have its root as a leaf: the validator permits a one-block leaf with no gist at [`tree-invariants.ts:218`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:218). `buildSummaryTree` returns that root, but `SummaryPanel`:

- does not show the unusable-tree message because `root` is non-null;
- hides the root title, missing-summary text and range;
- has no children, hence no `+N` control.

See [`SummaryPanel.tsx:214`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SummaryPanel.tsx:214), [`SummaryPanel.tsx:310`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SummaryPanel.tsx:310), and [`SummaryPanel.tsx:378`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SummaryPanel.tsx:378). The reader gets the heading and Depth pills, but no summary and no explanation.

Provisional heading trees are related: they intentionally have no gists, yet their `provisional` marker has no web consumer.

4. Reader-facing profile copy still promises the removed feature

The surviving tree deliberately does not vary by profile ([`pg.ts:1498`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1498)), but summaries are still named as personalised in:

- [`Metadata.tsx:727`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:727)
- [`ProfilePage.tsx:212`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ProfilePage.tsx:212)
- [`ProfilePanel.tsx:249`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ProfilePanel.tsx:249)

Worse, [`messages.ts:1337`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/messages.ts:1337) says summaries “go out exactly as they are”, although the public payload no longer has a summary artefact.

## Retained column

`$type<unknown>()` is safe. In the installed Drizzle version it is compile-time-only and simply returns the builder unchanged; JSONB still uses its normal serializer.

The production carry path is correct:

- `summary: "carry"`: [`pg-revisions.ts:254`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:254)
- included by `carriedColumns`: [`pg-revisions.ts:298`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:298)
- copied by one `INSERT … SELECT`: [`pg-revisions.ts:608`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:608)
- publication updates only status and derived scalars: [`pg-revisions.ts:1333`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1333)

The test is reachable when Postgres is available: it writes the fixture at [`store-carry-forward.test.ts:448`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-carry-forward.test.ts:448), starts the second revision, then asserts it at [`store-carry-forward.test.ts:522`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-carry-forward.test.ts:522).

It proves structural JSON equality on the draft—not literal byte equality, and not retention after publication. JSONB explicitly does not preserve original bytes or key order. A post-publication assertion should be added.

## Root badge

The root control is sound.

`showsChildren` gives `closed` priority, then uses either Depth or `opened` ([`tree.ts:618`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:618)). Opening the root removes it from `closed` and adds it to `opened`; collapsing calls only `clearOverride`, so the root can never enter `closed`. After collapse at article depth, `+N parts` remains; switching to parts depth shows the parts normally.

I found no state-machine path that leaves an existing root subtree empty and unrecoverable.

## Tests

- `public-network-trace` is not vacuous. Its unique root gist is asserted at [`public-network-trace.test.tsx:574`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-network-trace.test.tsx:574), with no summary artefact available. It proves the intended inversion, though not the empty/provisional cases above.
- One supplement characterization is vacuous: [`supplement.test.ts:422`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/supplement.test.ts:422) derives both sides from the returned `body`. If all body parts disappear, `[]` equals `[]`; the preceding test can still pass because Notes remains.
- `store-revision-columns` proves the policy map is empty, not that every database read omits the column.
- `store-carry-forward` is meaningful but stops its summary assertion before publication.

The three focused UI suites—summary expansion, supplement, and public network tracing—pass in the current shared tree; that does not expose the gaps above.