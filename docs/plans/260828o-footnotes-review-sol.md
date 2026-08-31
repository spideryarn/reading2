# Verdict: REVISE BEFORE IMPLEMENTATION

The measured results retire some of my earlier caution: Gwern’s 34/34 and Wikipedia’s 170/170 marker targets really do resolve through extraction, splitting, retargeting, and block lookup. But “stage 4 is mostly dress” is still wrong. ACX, multi-block notes, Tufte, artifact freshness, and the supplement’s interaction with summaries and the reading geometry require structural work.

## Blocking findings

### 1. The measurements prove two shapes, not the general chain

I reproduced the Gwern and Wikipedia forward-resolution counts. The existing retargeting path does what the plan says: block IDs replace authored target IDs in [src/blocks.ts:660](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:660), and the browser resolver can fall back from a nested authored ID to its containing block in [src/web/internal-links.ts:44](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/internal-links.ts:44).

So my v1 caution was too strong for those two fixtures.

But:

- This is not browser-level “end-to-end”: hover, click, focus, return, touch, and modified-click behavior remain unmeasured.
- The plan’s own new ACX measurement shows all 18 reader-facing links landing on one-digit stub blocks, not note prose ([260828o-footnotes.md:511](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828o-footnotes.md:511)).
- Gwern contains a multi-block note. `ownContent` deliberately removes nested list content when constructing a parent block ([src/blocks.ts:136](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:136)). A marker therefore identifies a landing block, not necessarily the complete note.
- The current hover resolves one block and clips its text ([ProseHoverCard.tsx:111](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/components/ProseHoverCard.tsx:111), [ProseHoverCard.tsx:310](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/components/ProseHoverCard.tsx:310)).

The representation needs a note identity or block range. Otherwise it cannot reliably provide complete previews, plural backlinks, or truthful “40 notes” counts. Counting markers, role-bearing blocks, and distinct notes gives three different numbers.

### 2. `role` is right, but the proposed closed set is not

An orthogonal field is better than another `BlockKind`. But this type:

```ts
role?: "footnote" | "reference";
```

cannot represent the plan’s own statement that acknowledgments and image credits are supplements ([260828o-footnotes.md:144](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828o-footnotes.md:144), [260828o-footnotes.md:248](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828o-footnotes.md:248)).

Do not make it an open string. Unknown values would silently receive inconsistent policy. Use two closed axes:

- Semantic kind: footnote, reference, acknowledgment, credit, appendix.
- Argument treatment: body or supplement.

An appendix is then explicitly classified as body or supplement from its content, rather than being removed merely because its heading says “Appendix”.

A separate note/group ID or range is still needed; semantic role alone does not group multiple blocks into one note.

### 3. Four predicates do not cover the policy

There is a fifth axis: structural/navigation treatment—whether content belongs in the argument tree, a supplement, or navigation labels.

Several consumers are also missing:

- Summaries build text from tree ranges independently of `article-prompt`; a root extended over supplements will still include their text unless `textOf` filters it ([src/summarise.ts:457](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:457)).
- Tweets consume whole-article text and are absent from the proposed evidence list.
- `articleWithIds` is shared by search, explain, and conversation ([src/article-prompt.ts:90](/Users/greg/Dropbox/dev/experim/spideryarn2/src/article-prompt.ts:90)). Filtering there would wrongly hide notes from explicit reader questions.
- Similarity has its own `gistable` filter ([src/similar.ts:198](/Users/greg/Dropbox/dev/experim/spideryarn2/src/similar.ts:198)).
- Postgres search hard-codes `gistable = true`, outside any TypeScript predicate ([src/store/pg-shelf.ts:202](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-shelf.ts:202)).
- Diagram terms and nodes still read structural blocks even if anchor edges are removed ([src/web/graph.ts:322](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/graph.ts:322)).
- Structural statistics count every shallow tree child, so supplements become “parts” or “sections” ([src/library-scalars.ts:73](/Users/greg/Dropbox/dev/experim/spideryarn2/src/library-scalars.ts:73), [src/web/stats.ts:33](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/stats.ts:33)).

`isBodyProse` is also poorly named: notes are prose. `countsTowardReadingTime` states the policy more accurately.

### 4. The supplement ordering is possible, but not already guaranteed

`buildTree` creates leaves for every block it receives and requires its root to span that exact block array ([src/toc.ts:413](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:413), [src/toc.ts:509](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:509)). The generation path currently sends all blocks to the model, builds that full tree, and then generates labels ([src/toc.ts:625](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:625), [src/toc.ts:703](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:703)).

The proposed order therefore requires an explicit post-builder operation:

1. Build against body blocks.
2. Append supplement nodes and their leaves.
3. Extend the root.
4. Generate labels against the completed tree.

It works only when supplement blocks form terminal contiguous runs. Inline Tufte notes or other interleaved apparatus cannot simply be appended without breaking document-order partitioning. The plan must either canonicalize them into terminal note sections earlier or support supplements inserted in document order.

The two-way gist exception is insufficient. Otherwise a malformed body node could label itself a supplement merely to bypass the existing “internal node must have a gist” rule ([src/tree-invariants.ts:210](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:210)). Validate that a supplement:

- Is a depth-one child of the root.
- Covers one contiguous range.
- Contains only matching role-bearing blocks.
- Contains every such block exactly once.
- Has only leaves beneath it.
- Has no gist and cannot be nested or be the root.

### 5. Fable’s fisheye claim is factually wrong

At deeper columns, shallow branches are expanded into cells by [src/web/tree.ts:72](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:72). `itemsFromCells` excludes continuation cells, not leaf cells ([src/web/context.ts:90](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/context.ts:90)). Note leaves can therefore appear as blank section entries and one can become current.

If leaves are later filtered, `currentIndex` chooses the last preceding body item rather than necessarily returning `-1` ([src/web/context.ts:108](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/context.ts:108)).

The arc also has two separate dependencies: generation includes every root child ([src/arc.ts:106](/Users/greg/Dropbox/dev/experim/spideryarn2/src/arc.ts:106)), while UI numbering assigns every L1 cell an index and total ([src/web/tree.ts:222](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:222)). Both need supplement-aware behavior.

### 6. The stable-ID key is too permissive

Ignoring marker digits, leading note numbers, and backlink controls will preserve IDs across renumbering, but it can also preserve an ID after a citation changes meaning:

- Two otherwise identical paragraphs citing different notes collapse to one key.
- Replacing or reordering citations may retain the old paragraph ID.
- Leading numbers can be genuine note content.
- Markers may be letters, stars, or Roman numerals.

Strip recognized marker/control DOM nodes, not text patterns. Include a stable fingerprint of the targeted note body or relationship. If only numbering changes, carry the ID; if the target or note content changes, mint a new one. The present exact-text key is in [src/blocks.ts:317](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:317), with order-based carry-over in [src/blocks.ts:402](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:402).

## Pipeline and security

Tufte cannot wait until stage 4. `runExtract` already runs Readability and sanitizes its output before `splitIntoBlocks` ([src/extract.ts:278](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:278), [src/extract.ts:121](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:121)). By stage 3, the `<input>`, `<label>`, and identifying class are gone. `stampAuthorAnchors` being before the stage-3 sanitizer ([src/blocks.ts:702](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:702)) is not analogous enough—it still runs too late for Tufte.

Recognize and canonicalize the exact Tufte structure before Readability, then sanitize the generated ordinary marker/note structure normally.

Reading the raw DOM is not itself dangerous. Copying raw attributes or HTML into trusted output is. A malicious article could forge any reserved `data-*` stamp and cause arbitrary body prose to be hidden from summaries or dressed as trusted apparatus. That is primarily a content-integrity/availability failure, potentially worse if UI code later treats the stamp as trusted HTML. Scrub reserved source attributes first, mint only fixed enum values and fresh IDs, use DOM APIs, and pass the rewritten subtree through the normal sanitizer. Do not admit `<label>` or `<input>`.

## Stage independence

Stages 2 and 3 are not independently shippable as written:

- Stage 2 says note roles affect evidence consumers, but the full tree still contains notes until stage 3.
- If stage 2 instead builds the tree from body-only blocks, current full-block coverage fails until supplement construction exists.
- Tufte classification must occur before either.
- Stage 3 also depends on summary filtering, arc generation, fisheye geometry, structural stats, diagram behavior, labels, and public DTO propagation—not only validator and step-count changes.
- Public DTO construction currently enumerates block and node fields, so new roles will be dropped unless both schemas are changed ([src/public/dto.ts:101](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:101), [src/public/dto.ts:134](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:134)).

There is also a missing cache dependency. `hashBlocks` hashes only ID and text, and `structureHash` omits node role ([src/source-hash.ts:47](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source-hash.ts:47), [src/source-hash.ts:81](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source-hash.ts:81)). Reclassifying unchanged text can therefore leave old summaries, ideas, glossary, tweets, vectors, and similarity artifacts reporting themselves current. Role/policy must participate in the relevant fingerprints, or every affected artifact needs an explicit recipe-version dependency.

## PDF third option

Use a per-page facsimile fallback:

- Show verified transcribed references where the gate passes.
- For failed bibliography pages, show cropped/rasterized original PDF pages in the supplement.
- Optionally attach uncertain OCR text for search, clearly marked as such.

That neither loosens the gate nor silently publishes an incomplete transcription. The pixels remain authoritative. A simpler variant is an explicit “References could not be verified” supplement linking directly to the original pages.

## What the measurements still did not test

They did not test:

- Complete note grouping or previews.
- Distinct-note counts and reused citations.
- Browser hover/jump/back/focus/touch behavior.
- Classification precision and false positives.
- Tufte survival before Readability.
- Postgres/public/export/import propagation.
- Prompt exclusion for every automatic model consumer.
- Cache invalidation after role-only changes.
- Tree, fisheye, arc, diagram, and statistics behavior.
- PDF completeness provenance.
- Stable-ID behavior when targets change rather than merely renumber.

## Failure-mode test audit

The existing list identifies real risks, but two items are theatre unless strengthened:

- Removing the supplement and observing generic tree validation fail mostly retests the old coverage invariant. Mutate each new supplement semantic separately.
- Store parity over today’s zero-role corpus proves nothing and may skip entirely without Postgres. Import a synthetic role-bearing article and add a non-skipping projection/DTO test.
- Fixture hashes prove fixture bytes, not footnote behavior.
- “A predicate returning true for everything” is not a test until each policy has a negative sentinel.

The minimum missing tests are:

- Real Gwern, Wikipedia, and ACX extraction asserting exact note prose/ranges—not retarget counts.
- Multi-block note grouping, reused markers, truthful counts, and complete preview.
- Negative fixtures for normal superscripts and ordinary numbered prose.
- A unique note-only token absent from ToC/arc/summary/ideas/glossary/tweets, but present in explicit search/chat.
- Supplement semantic mutations, root-summary exclusion, compact arc numbering, and no blank fisheye rows.
- Role-bearing Postgres, public DTO, export, and import round trips.
- Role-only changes invalidating every affected artifact.
- Stable-ID tests for insertion, target replacement, duplicate stripped keys, and legitimate leading numbers.
- Pre-Readability Tufte canonicalization plus forged-stamp attacks.
- Browser tests for plural backlinks, focus restoration, touch, and modified clicks.
- PDF positive detection and visibly incomplete per-page fallback.

The plan has the right broad direction, but implementation should not start from its present stage boundaries. The representation/grouping, early canonicalization, policy fingerprints, and supplement invariants need to be designed into stages 2–3 first.