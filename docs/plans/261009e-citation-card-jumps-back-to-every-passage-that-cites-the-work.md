# The citation card jumps back to every passage that cites the work

Report `spya-tsd470` (#503, SPIDERYARN-READING2-FE), Greg, 2026-10-09, filed from
`arxiv-1706-03762-spya-wyt7j0` in Citations mode:

> When it comes to citations, I often want to be able to jump back from the list of references to
> the places where it's cited. Do we already have this information if Citations mode has been run?
> If so, could we somehow add or annotate (maybe in the Marginalia next to a citation in the
> references section, or with an underline-hover-tooltip) to enable us to jump back to the place
> where it's referenced?

Up: [citations.md](../project/bibliography.md)

## Do we already have it? Yes

Every stored work carries `citedAt`: the body blocks that cite it, in document order
(`CitedWork` in `src/types.ts`) — every one for a citation through notes, at most three for a
direct one (see § Review, finding 1) — plus up to three verified `mentions` (the citing words)
and a verified `reference` (its place in the bibliography). The local corpus has works cited in up
to 20 paragraphs (Antikythera mechanism), and `spider-silk` has 72 works with a marked reference
entry, 20 of them cited in more than one paragraph.

And the reference entry is **already underlined** in the prose (`citeMarks` marks the `reference`
place) and already opens the citation hover card (`CiteCard` in `src/web/ProseHoverCard.tsx`). What
the card says today is only *cited in 7 paragraphs*: the count, and no way to get there.

So no new model call, no new data, no schema change. This is a client change to one card.

## What we build

**The count becomes a row of jumps.** Under the entry, in the card:

```
  Miyashita, Tadashi; … (2004). "Silk feeding as an alternative foraging tactic…"
  ─────────────────────────────────────────────
  cited in 3 paragraphs   1  2  3
```

- Each number is a `BlockRef` (the one block link): a real `<a href>` to `?at=<id>`, its own
  section-and-paragraph preview card on hover, and a plain click that jumps in place with
  `jumpTo` — history pushed, so Back returns to the reference list.
- The jump's aim is `citePassageKey(work.id)`, so where the paragraph holds a marked mention of
  this work the flash lands on **the citing words** (the 2.4 s cite flash), and where it does not
  (a paragraph past the three verified mentions, or one reached through a footnote marker) it
  washes the paragraph. `passageMarks` → `[]` → whole cell is the existing fallback in `flash.ts`.
- **In document order**, numbered 1…N, because the numbers are positions in the article, not
  rank.
- **The paragraph the card was opened from is not a link** — on a body mention it is drawn as the
  number with `aria-current="location"` and a quieter style, since jumping to where you are is a
  no-op. From the reference entry, which is not in `citedAt`, every number is a link.
- **Capped at 20 links**, then *and N more*, so a work cited in 60 paragraphs does not fill the
  card. The count in words stays exact.
- A bibliography-only work keeps *only in the references*, with no numbers.

It applies to every place the card opens (a body mention as well as the reference entry), because
"where else is this cited?" is the same question from a body mention, and one card that behaves
differently by where it was opened is two cards.

**Who sees it**: the owner, as now. The marks and so the card are owner-only by construction
(citations.md § Marked in the prose).

## Passed over

- **A line in Marginalia beside each reference entry** (Greg's first suggestion). The margin's
  Citations note sits beside the *earliest citing* block (marginalia.md § What it shows); adding a
  second placement beside the bibliography would put one note beside every entry of a 70-entry
  reference list, which is the *"second article down the margin"* risk the margin is weighed
  against, and it needs the column open. The card already opens from the entry in every mode. If
  Greg wants the margin version too, it is a new kind in `notes.ts` and a row in `tips.ts`, reusing
  the component built here. Not built, offered in the note.
- **The citing words as the link labels** instead of numbers. We have words for at most three
  places, so the list would mix words and bare paragraphs; and a 20-place work would not fit. The
  `BlockRef` preview card shows the section and the paragraph, which is what a reader choosing
  between them needs.
- **The same row on the Citations band's row.** The row has *first cited*; Greg asked about the
  reference list. Easy to add later with the same component.

## Stages

1. `CitedAtJumps` in `ProseHoverCard.tsx`, the `onJump` prop widened to take an aim, the hovered
   block passed to `CiteCard`, CSS in `prose-hover-card.css`. A test in
   `tests/` that renders the card from a reference entry and from a body mention and checks the
   links, the current block, the cap, and that a press calls `onJump` with the cite key.
2. Browser check on `spider-silk` (reference entry → card → number → lands and flashes; Back).
3. citations.md § Marked in the prose updated; feedback note.

## Review

GPT Sol on the plan (read-only), then on the code (fixes in place).

**Plan review** ([261009e-citation-card-jumps-back-plan-review-sol.md](261009e-citation-card-jumps-back-plan-review-sol.md)),
GO WITH CHANGES. Each finding, and what was done:

1. **`citedAt` is not complete for direct citations.** Right: `placesOf` expands notes to every
   marker, but a work cited directly (an arXiv `[1]`, an author–year) keeps at most
   `MAX_MENTIONS` = 3 mentions. The section above ("Do we already have it?") overclaimed. Done:
   the card says *cited in at least N paragraphs* when a work has three mentions, the
   `CitedWork.citedAt` comment says when it is complete, and `MAX_MENTIONS` moved to
   `src/types.ts` so the client can read it. **Not done, and the real gap for Greg's arXiv
   paper**: finding every direct citation of a work. That is a pipeline change (more mentions per
   work, or a code-side scan for the work's marker such as `[12]` across the body), with its own
   cost and prompt questions. Queued as its own item rather than folded in.
2. **The cap and the current paragraph.** A work cited only in the paragraph you are in now draws
   no numbers (and no *and 1 more*, which the first test run caught); a current paragraph past the
   20th is simply not listed. Both tested.
3. **Keyboard focus moving into the card closed it** (`focusIn` in `useHoverCard.ts` had no
   inside-the-card exception, unlike the pointer path). Fixed there, with a test that was red
   first. This also fixes tabbing to the card's existing title link and *Dig deeper*.
4. **Touch size and names.** Each number has `.prose-card-open`'s padding (~30px tall, for
   everyone; not `.tap-target`, whose 40px boxes would overlap side by side) and a screen-reader
   name, *citing paragraph 2*; the current one has `aria-current="location"`.
5. **The reference entry opens the card only where it is marked** — an HTML bibliography entry
   that was re-found uniquely. A PDF's reference list is not rendered, so a PDF has no entry to
   point at; the card still opens from each body mention there.

**Browser pass** (Sonnet, Playwright, `spider-silk` locally, 1300px and 390px touch): the card
from a reference entry shows the row; hovering a number opens the block-link card without the
citation card flickering; a press closes it, jumps, flashes, and Back returns to the entry; the
current paragraph's number is inert. It found the numbers inheriting `.block-ref`'s half opacity,
so the live links were fainter than the inert one; fixed in `prose-hover-card.css`.

**Code review** ([261009e-citation-card-jumps-back-code-review-sol.md](261009e-citation-card-jumps-back-code-review-sol.md)),
GO, with fixes in place: focus entering the card also cancels a pending pointer close; a
`focusout` leaving the card for somewhere outside it (browser chrome) closes it; the numbers grow
to 40px under `any-pointer: coarse` (the row wraps rather than targets overlapping); names read
*Citing paragraph 2 of 5*; `MAX_MENTIONS` is re-exported from `src/citations.ts`. One change to
its fix, mine: `focusout` keeps a card the pointer is still resting on, because a click on the
card's plain text after focusing one of its buttons sends focus to the body.

**Deferred**: finding every direct citation of a work — queue item `qi-5j4zezve`.
