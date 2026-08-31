# Stage 3b: the block-id carry-over key

This is the last stage of the footnotes plan and the one you called the highest-priority
follow-up: *"Adding or renumbering notes during re-extraction can remint passage and note block
ids, orphaning comments and saved positions."* The six earlier reviews of this lane each found a
real blocker, so please assume there is a seventh rather than confirming this.

The scoped diff is `docs/plans/260829g-footnotes-stage3b.diff` (209 lines, `src/blocks.ts` only). The
tests are `tests/note-carry-over.test.ts` (16 of them). The spec being implemented is
`docs/plans/260828o-footnotes.md` § "The trap that would cost the most", which is your own revision of an
earlier, too-permissive design.

## The bug

`extractText` walks `textContent`, so a marker's digits are part of `Block.text`, and the carry-over
key is `x:${tag}:${text}`. Insert one footnote near the top, every later marker shifts `7 → 8`, and
the containing paragraph's key changes though its prose did not. It is re-minted on re-ingest and
every comment anchored to it is orphaned.

## What was built

A shared `withoutNoteControls(text, html)` used by **both** `exactKey` and `foldedKey`. It removes
every element carrying `data-spya-note-ref` / `data-spya-note-back`, re-extracts the text, and
prepends a fingerprint `n[<noteId>,…]` of the notes the block cites, in document order, plus the
block's own `data-spya-note` id first when the block *is* a note body. It reads from `html`, so both
sides of the match — stored `Block`s and this run's candidates — compute it identically. A block
whose html carries none of the three attributes returns its text untouched and an empty fingerprint,
so its key is byte-for-byte what it was before.

## The question I most want answered

**`mintNoteId` is `sha256(note text).slice(0,10)`** (`src/notes.ts`). So folding the note id into the
citing paragraph's key means that **editing a footnote re-mints the id of every paragraph that cites
it** — and those paragraphs' own prose did not change. A typo fix in note 7 orphans the comments and
saved positions on the passage citing note 7.

The plan says "if the target or the note's content changed, mint a new one", and that sentence is
yours. But it bundles two different things: *which note this paragraph cites*, which is a real change
of meaning, and *what that note happens to say today*, which is not a change to this paragraph at
all. Is the content-sensitivity intended, and is it worth its cost? If it is not, is there a note
identity that survives an edit to the note's own words without losing the "citation repointed
elsewhere" detection the design exists for? I can see no stable candidate that is not circular, which
is why I am asking rather than changing it.

## The migration, which changed the design after the brief

An article ingested **before** stage 2's canonicaliser has no stamps in its stored html, so its
blocks key the old way while this run's candidates key the new way and nothing matches. Measured
through the real pipeline (previous = Readability with the notes pass off, current = the same page
with it on): `wiki_transformer` re-mints **206 of 356**, gwern 55 of 184, acx 35 of 96, tufte 10 of
68 — every footnote paragraph and every note block, orphaned on one re-ingest. A committed stage-2
test, *"turning the pass on keeps every note's block id"*, already forbade this and went red.

So pass one gained a **second lookup**: a candidate that finds nothing under the new key retries
under `legacyKey`, the old whole-text key. The safety argument is directional, and I would like you
to attack it: a *stamped* previous block is bucketed under a key naming the notes it cites, which no
legacy key can spell, so the fallback can only ever reach a previous block carrying no stamp at all.
Two canonicalised runs therefore never see it, which is what keeps a repointed citation minting —
and pointing the fallback at a bucket built over *all* previous blocks reddens exactly that test.

Is that argument sound? Specifically: can a legacy key ever collide with a new-style key; can the
fallback resurrect an id that the new key deliberately minted; and does the second lookup interact
with the "each previous id is consumed once" rule in a way that lets two candidates claim one id, or
lets a candidate consume an id that a later, better-matching candidate needed?

## Also please check

1. **The no-op guarantee.** A no-op re-ingest of a real article now carries everything:
   `wiki_transformer` 356 of 356, `acx_footnotes` 96 of 96, `gwern` 183 of 184 (the one is an `<hr>`,
   which has neither text nor a `src` and re-mints however the key is built — a known pre-existing
   limit). Is the "block with no stamps keys byte-for-byte as before" claim airtight?
2. **`JSDOM.fragment(html).firstElementChild`.** A block whose stored html has more than one
   top-level element, or leading text, or is not an element at all. What does the key become, and
   does it still agree across the two sides?
3. **The gate** `html.includes(REF_ATTR) || …` before parsing. Cheap, but is it exactly equivalent to
   what the parse would have found — could an attribute name appear in the *text* of a block and send
   it down the parsing path with no stamps to find, or the reverse?
4. **Ordering and collisions.** Two paragraphs citing the same notes in a different order; a block
   citing the same note twice; a `data-spya-note-ref` whose value is a page's own text rather than a
   minted id.
5. Anything else. Seventh time lucky.
