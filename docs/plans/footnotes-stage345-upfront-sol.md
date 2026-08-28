Verdict: 4 is wrong; 3, 5, 6, 7, 9 and 11 need adjustment. The rest are sound with small safeguards.

1. Fine. There is no drop line. Canonicalisation runs before Readability at [src/extract.ts:285](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:285), and the later sanitizer does not forbid these attributes at [src/sanitize-policy.ts:158](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sanitize-policy.ts:158). Stage 3 sanitizes again at [src/blocks.ts:684](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:684), then serializes the surviving DOM at [src/blocks.ts:799](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:799) and overwrites `article.html` at [src/blocks.ts:921](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:921). The full chain is explicitly exercised at [tests/notes-canonical.test.ts:61](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/notes-canonical.test.ts:61) and the four attributes are asserted after sanitisation at [tests/notes-canonical.test.ts:807](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/notes-canonical.test.ts:807).

2. Fine. Ship the five-member union. A stored role should mean “this revision explicitly classifies this content as X”, not “the current recognizer can produce X.” Narrowing it now makes the future widening a database/check-constraint migration. Add runtime validation on import as well as a database `CHECK`; today import ultimately trusts the typed JSON and inserts its fields directly at [src/store/import.ts:581](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:581).

3. Keep `gistable`, but not “exactly as it is.” Its current contract literally says it decides whether the ToC writes a row at [src/types.ts:39](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:39); that becomes false once a prose footnote remains `gistable:true` but `isStructural:false`.

I would keep it as the splitter’s intrinsic “this block has independently describable prose” fact, because `describeBlock` knows things such as duplicate pull-quotes that cannot be reconstructed from `kind`. But make `block-policy.ts` its only business-policy consumer and migrate direct reads in `toc.ts`, `labels.ts`, vectors and search to named predicates. In particular, do not mechanically define every predicate as `gistable && treatment !== "supplement"`:

- `isSearchable`: retain `gistable`; do not exclude supplements.
- `isBodyEvidence`: exclude supplements, but do not accidentally remove code/media that automatic prompts currently see without deciding that separately.
- `isEmbeddable` and `isStructural`: `gistable && body`.
- `countsTowardReadingTime`: body, regardless of `gistable`.

Cost: the `labels.ts`/`toc.ts`/`tree-invariants.ts` churn still has to happen, but the database field and projections remain.

4. Choose (c): leave this SQL filtering only on `gistable`. It is library full-text search, not a shelf scalar, at [src/store/pg-shelf.ts:183](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-shelf.ts:183). Adding `treatment <> 'supplement'` would directly contradict “notes are searchable.”

Option (a) is technically possible: blocks are one row each, not a JSON document—see [src/db/schema.ts:660](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:660). It is simply the wrong policy. Option (b) adds a redundant stored fact. Add a SQL-level parity test showing a `gistable:true`, `treatment:supplement` note remains searchable.

5. The compatibility goal is sound, but omission alone is insufficient. `hashBlocks` is not currently JSON serialization; it constructs a fixed `id + tab + text` string at [src/source-hash.ts:47](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source-hash.ts:47).

Use an explicit compatibility branch:

- If every block has nullish `role` and `treatment`, run the exact legacy algorithm.
- Otherwise use a versioned, framed representation containing `id`, `text`, `role` and `treatment`.
- Normalize Postgres `null` and filesystem `undefined` identically.

Update every narrow fingerprint query, including [src/store/pg.ts:636](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:636), [src/store/pg-searches.ts:139](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-searches.ts:139), and [src/store/import.ts:453](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:453). Otherwise a second import can compare a full new hash with an old two-column hash and continually create revisions.

Give `structureHash` the same legacy branch when no supplement node exists. I found no separate competing block-fingerprint implementation; the larger hole is orchestration: `toc` deliberately has no freshness stamp and explains why at [src/pipeline.ts:1083](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1083), while `arc` has none at all at [src/pipeline.ts:1159](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1159). Correct hashes do not make those stages rerun.

6. Do not handle the shelf separately. Its Postgres fallback deliberately fetches word counts and calls `deriveLibraryScalars` to avoid a second sum at [src/store/pg.ts:1029](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1029). Extend that query to return the blocks’ treatment/role—probably a small ordered JSON aggregate—and call the shared `articleWordCounts`.

The third visible reading-time statement is the extracted HTML’s Readability estimate at [src/extract.ts:121](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:121). Decide whether it is deliberately debug-only or must agree.

Also fix the quieter numerator users: tweets, ideas and glossary choose output sizes from all block words at [src/tweets.ts:448](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tweets.ts:448), [src/ideas.ts:766](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:766), and [src/glossary.ts:1114](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:1114). If their prompts exclude notes but their requested output sizes include them, the policy is still braided.

7. Keep `Block.text` unchanged. The separation is available, but asymmetrically. New candidates still have their DOM element immediately before carry-over at [src/blocks.ts:736](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:736); `Candidate` then throws that away and retains only tag/text/HTML at [src/blocks.ts:365](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:365). Previous blocks have only serialized HTML.

I would compute a note-aware key from DOM/HTML on both sides: strip only stamped marker/control nodes and append the ordered `data-spya-note-ref` identities. The noteId already fingerprints the target prose at [src/notes.ts:612](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:612).

The expensive wrinkle is migration compatibility. You need two key families:

- canonical previous ↔ canonical new: strong note-aware key; never fall back to raw marker text after a target mismatch;
- pre-stage-2 previous ↔ canonical new: one-time legacy exact/folded bridge.

Otherwise target replacement keeps the old block id, or the first post-stage-2 run remints the corpus. Cost: parsing previous block HTML and maintaining dual carry-over buckets.

8. The construction is safe, with one ordering correction. Root ranges are not re-derived after `buildTree`; `mergeLabels` preserves internal nodes at [src/labels.ts:992](/Users/greg/Dropbox/dev/experim/spideryarn2/src/labels.ts:992). There is also no later gist-composition pass: composition is an instruction to the ToC model at [src/toc.ts:105](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:105), and `buildTree` merely copies the returned gist at [src/toc.ts:442](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:442).

Append the supplement after the body model result but before `generateLabels`. Labels record `structureHash(opts.tree)` at [src/labels.ts:1466](/Users/greg/Dropbox/dev/experim/spideryarn2/src/labels.ts:1466); appending afterwards makes `labels.json` stale at birth. Pass the full tree and blocks into labels, with batching and coverage changed to `isStructural`, then run the expanded full-tree validator.

9. The desired reader state is right; implementing it only in `itemsFromCells` is wrong. `itemsFromCells` drives visible context at [src/web/context.ts:90](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/context.ts:90), but keyboard navigation independently uses raw cells at [src/web/keynav.ts:152](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/keynav.ts:152), saved reading sections use them at [src/web/position.ts:68](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/position.ts:68), and the arc numbers every depth-one cell—including the supplement—at [src/web/tree.ts:222](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:222).

Create one shared “navigable items at depth” projection. It should collapse every cell under a supplement to one item anchored at the supplement’s first block. Use it for context, keyboard movement, saved position and arc numbering. That preserves the anchor invariant; changing only the visible list breaks it.

10. Use both. Trust the attribute for note identity/range, but require authoritative resolution to a `role:"footnote"` block whose `noteId` matches it. Precompute those maps once, so the extra check is effectively free.

The hostile-page argument is valid: all four reserved attributes are scrubbed before recognition at [src/notes.ts:157](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:157), including templates at [src/notes.ts:341](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:341). The role check protects against importer, projection and pipeline bugs. Reuse `internalTarget`, which already gives hover and click one resolution rule at [src/web/internal-links.ts:44](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/internal-links.ts:44).

11. The order 3 → 4 → 5 is right. Stage 3 must nevertheless expose the types stage 5 needs:

- Persist and project `noteId`, not merely role and treatment.
- Add all three fields to `PublicBlock`, its query and DTO; these are explicit allow-lists at [src/public-types.ts:86](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public-types.ts:86), [src/store/public-reader.ts:266](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/public-reader.ts:266), and [src/public/dto.ts:101](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:101).
- Add the supplement marker to `publicTree`; optional node fields are deliberately silently dropped at [src/public/dto.ts:124](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:124).

I would also name the tree field `treatment:"supplement"`, not `role`, so `role` does not mean semantic content on blocks and structural exclusion on nodes.

The most likely late and expensive failure is Decision 5’s pipeline invalidation. A perfect new hash can coexist with `toc` and `arc` still reporting “done”; the existing comment documents exactly how rebuilt ranges then make arc and summary entries silently disappear at [src/pipeline.ts:1091](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1091). Fresh-run tests pass, the output remains plausible, and fixing it means runtime cascade invalidation plus regenerating paid artefacts.

One further stage-5 trap: the current hover preview is one clipped plain-text block at [src/web/ProseHoverCard.tsx:366](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ProseHoverCard.tsx:366). A whole-range HTML preview cannot simply inject stored block HTML: that duplicates block ids, and its links sit outside TableView’s delegated click handler at [src/web/TableView.tsx:470](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/TableView.tsx:470). Build a preview fragment that strips or namespaces ids and owns internal-link delegation.