The candidate has the right centre but the wrong switch.

Keep each footnote as a normal, stable-id block. Add an orthogonal `role`, not `kind: "note"`, and do not assume `gistable: false` removes it from the tree or from every model call. It does neither.

## 1. Block or sidecar?

Use blocks for the content and ordinary anchors for the relationships:

```ts
interface Block {
  // existing fields
  role?: "footnote" | "reference"; // absent means ordinary article content
}
```

`role` is better than `kind` because a Notes heading is still a heading, a quoted note is still a quote, and existing code deliberately treats `kind` as structural presentation. See [types.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:23) and [blocks.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:160).

Do not create a `notes[]` sidecar. That would duplicate addressing, comments, citations, sanitisation, storage and rendering.

But `gistable: false` is not “outside the machinery”:

- Every block, including non-gistable media, must have exactly one leaf. [tree-invariants.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:174)
- The root must span the complete `blocks` array. [tree-invariants.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:143)
- Every block must be covered. [tree-invariants.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:257)
- `buildTree` already grows leaves for non-gistable blocks; they merely lack `navLabel`. [toc.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:489)

Therefore:

- “Notes outside the tree” violates the current contract.
- One leaf spanning 40 notes also violates it: a leaf must span exactly one block.
- The right representation is one special internal **supplement node**, with ordinary one-block leaves beneath it.

I would add something like `presentation?: "supplement"` to `TreeNode`. The node covers the complete Notes range, has an authored title such as “Notes”, carries no generated gist, and displays something fixed such as “Notes · 40”. The validator’s “every internal node needs a gist” rule would gain this one explicit exception.

The body tree should be generated from body blocks only. Then mechanically append the supplement node to the root and extend the root’s range. This preserves exact partitioning while ensuring root and section gists cannot accidentally summarise footnotes. Currently the ToC model sees every non-gistable block’s text and must still produce gists for internal nodes covering it. [toc.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:75)

A shallow supplement branch is acceptable: the renderer already repeats a branch’s deepest node across deeper columns. [tree.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:88)

For links, retain anchors as the canonical relationship. After `retargetAnchors`, the marker points at the note block. A derived incoming-link map can provide one or several return actions without a persisted sidecar. Preserve author-supplied backlinks when present.

## 2. Word count and reading time

Your check is correct. Both current counts sum every block:

- Library/card scalar: [library-scalars.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/library-scalars.ts:85)
- Reading-view masthead: [stats.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/stats.ts:32)

Only the words-per-minute formula is shared. [reading-time.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/reading-time.ts:15)

Keep `Block.words` literal and honest. It is useful for ranking, geometry and diagnostics. Introduce one shared derivation:

```ts
articleWordCounts(blocks) => {
  body,
  footnotes,
  references,
  total,
}
```

Use `body` for the library card’s displayed word count and reading time. If useful in the masthead, show `10,100 words · plus 1,300 words of references`; do not quietly turn optional apparatus into reading time.

There is no single “which words count?” seam today. `deriveLibraryScalars` and `articleStats` must call the same new helper, with the persisted `wordCount` defined as body words.

## 3. Searchable, citable, commentable?

Yes to all three, with different policies:

| Consumer | Footnotes |
|---|---|
| Render/address/deep-link | Yes |
| Comments/highlights | Yes; existing validation accepts any real block. [routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:545) |
| Explicit search | Yes, labelled “note”; perhaps demoted, never hidden |
| Chat citation | Yes, with a visible note badge |
| Tree gists/nav labels | No per-note rows and no note-derived gists |
| Ambient similarity/diagram embeddings | No initially |
| Whole-article summaries/ideas | Exclude initially; reconsider substantive notes later |

This requires separating policies. Today `gistable: false` makes a block invisible to library word search and chat’s word-search tool ([library-search.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/library-search.ts:212), [chat-tools.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat-tools.ts:532)), while the full prompt renderers include every block regardless of `gistable`. [article-prompt.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/article-prompt.ts:98)

So the candidate would produce the opposite of the stated policy: notes absent from some searches but present in chat, summaries, arc, glossary, ideas and ToC generation.

Use named predicates such as `isSearchable`, `isBodyEvidence`, and `isEmbeddable`, derived from `role`, rather than asking one Boolean to mean all three.

A chat citation to a note is legitimate provenance: it proves “the author says/cites this in note 7”. It does not prove that the external source cited by that note is true. The UI badge helps preserve that distinction.

## 4. Citation notes versus substantive notes

Do not classify them in v1.

Nothing important needs that decision yet:

- Both remain readable, searchable, citable and commentable.
- Both stay out of tree gists and reading time.
- Explicit chat questions can see both.

Classification would initially change only whether notes feed automatic summaries or embeddings. With no real note corpus, any threshold would be invented and untested. “Contains a verb” is multilingual, brittle and defeated by both terse arguments and long citations.

If real use later shows a need, start with an auditable heuristic: citation-shaped and short versus everything else. Do not pay for a model call until you can name examples where the heuristic makes the wrong product decision.

## 5. Where notes live on screen

Use **end section + preview + jump and return**.

That keeps the canonical content where the author put it while making most consultations local:

- Hover/focus: preview the note’s own words.
- Click: jump to its stable block.
- Note: return to the originating block; support multiple origins.
- Touch: click still works when hover does not.

The existing hover path already uses the same resolver as the click and shows the target’s own words. [ProseHoverCard.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ProseHoverCard.tsx:111)

Improve its label from “elsewhere in this article” to “Footnote 7”, based on the target block’s role, and style a marker based on what it targets—not merely because it is inside `<sup>`. Superscripts also represent powers, ordinals and trademarks.

The alternatives:

- Inline expansion disrupts row heights, spine measurements and scroll anchoring, and duplicates notes referenced more than once.
- The shared band makes source content compete with modes and separates it from its marker.
- Hover-only fails touch, keyboard access, deep linking and full reading.

A later pinned note inspector could use the band or a popover, but it should be a second view of the same end-section block, never the only copy.

## 6. Bibliographies and PDF records

A bibliography is the same **structural family** but a different semantic role:

- `role: "reference"`, not `"footnote"`.
- One References supplement node.
- Searchable and commentable.
- Excluded from body reading time, gists, similarity and ordinary summaries.
- No automatic linking from `(Smith, 2001)` in v1; that is citation parsing, not footnote rendering.

Do not merely add `reference` or `footnote` to `RENDERED`.

The current PDF renderer would emit either as an unmarked `<p>` at its record position, immediately erasing the classification. It does not gather an end section. [pdf-read.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:604)

PDF rendering needs to partition body, notes and references, emit marked containers, and add headings where absent.

References have an extra trap: final bibliography pages are deliberately exempted from the transcription gate because current recall is poor. [pdf-read.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:1040) Showing them would therefore publish content the pipeline explicitly permits to be incomplete. Re-evaluate that gate or visibly admit incompleteness before exposing PDF bibliographies.

I think the zero footnote count is more likely genuine absence than systematic misclassification. There are only **three distinct PDFs**, not six: four paths have the identical SHA-256. Ball-lightning’s author-date style naturally leads to a bibliography rather than notes, and the model demonstrably distinguishes `reference` backmatter.

The cheap decisive check is already in the repo: `data/Nagel_Bat.pdf` has visible numbered footnotes on pages 3–5. Run only those pages through the current transcription prompt and assert that records 2–5 are `footnote`. That tests a known positive; examining six zeroes cannot distinguish absence from a dead detector.

## 7. Cheapest genuinely useful slice

One afternoon: support **web-native linked endnotes only**, without claiming the complete data model is done.

- Add real Wikipedia-style and Ghost/Substack-style fixtures that pass through Readability, sanitisation and block splitting.
- Style recognised note-reference anchors.
- Make the hover card say “Footnote”.
- Verify marker → preview → note jump and author backlink → body block.
- Leave PDFs, classification, bibliography exposure and generated backlinks out.
- Do not set all note blocks `gistable: false` until the consumer policies are separated.

That gives readers a useful interaction immediately and forecloses nothing. It also establishes whether Readability preserves the structures before schema and tree work are built on that premise.

## 8. Likely failures

The least obvious and most serious is **renumbering destroying stable IDs**.

`Block.text` includes the text of inline anchors and superscripts. [blocks.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:150) ID carry-over matches tag plus text. [blocks.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:328)

Insert a new note near the beginning and every later marker may change `7 → 8`. That changes:

- The containing body paragraph’s match key.
- The note block’s leading number.
- Possibly its backlink glyph/text.

Unchanged prose and unchanged notes can therefore receive new block IDs, orphaning comments and scroll positions. For recognised footnotes, carry-over keys must ignore marker text, leading note numbers and backlink controls while `Block.text` remains faithful to what is rendered. This needs an explicit renumbering test.

Other high-risk silent successes:

- Readability removes the complete notes container before stage 3; direct `splitIntoBlocks` tests remain green.
- `gistable: false` silently hides notes from literal search while every full-article model prompt still consumes them.
- Filesystem storage carries `role`, but a Postgres import/export/public DTO path drops it.
- An anchor is successfully rewritten but lands on the wrong containing block; `stats.retargeted` still increments.
- A single synthesized backlink loses multiple references to the same note.
- Footnote links and backlinks become diagram structure. The current graph already caps this anticipated starburst ([graph.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/graph.ts:555)); once roles exist, exclude those edges explicitly.
- Tests use invented post-Readability HTML and never contain a known positive footnote. Existing tests prove generic fragment resolution, not the complete note journey. [blocks.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/blocks.test.ts:594)

The mutation test I would require is: remove the supplement leaf or stop role propagation and prove validation/search/count/UI tests go red. A feature tested only against this zero-footnote corpus will report perfect success while doing nothing.

No files were changed.