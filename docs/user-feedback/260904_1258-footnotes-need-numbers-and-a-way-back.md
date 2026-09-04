# Footnotes: number them, and give me a way back

**[SPIDERYARN-READING2-14](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-14)** · reported
2026-09-04 12:58 UTC · resolved 2026-09-04 · *shipped*

## What the reader said

> Somehow the footnotes are working okay in that they're being extracted, and I can click on one and
> it shows me the footbar or I can click on it again, and it takes me to the bottom when I'm on an
> iPad. So that's all great. But when I get to the bottom, I want to be able to go back and it
> doesn't show the number at the bottom either. So maybe they should be — if we know that they are
> footnotes and I'm hoping we do, from the post-processing that we do, then we should surround them
> in a box, or otherwise indicate that they are footnotes. But the key thing is at the bottom, they
> should be numbered, and there should be a way back to the point in the article where they come
> from.

"I'm hoping we do" was right, and it is the reason this was a rendering job rather than an
extraction one.

## What the diagnosis found

The data model was **complete**. Read out of the reported article's own public payload — gwern's
*Project Xanadu: Even More Hindsight* — there are 9 notes, each carrying `role: "footnote"`,
`treatment: "supplement"` and a `noteId`; 9 markers labelled `1`…`9`; and 9 back-links, each the
author's own `↩︎`, already stamped `data-spya-note-back`. Nothing had gone down a different path and
nothing needed re-extracting.

Three separate rendering gaps, and they are different from each other:

1. **No number, ever.** A note's body is an `<li>`, and stage 3 gives every block its own table row —
   so the `<ol>` that numbered it is gone, and an orphan `<li>` numbers nothing. There is no CSS
   counter anywhere. (The Tufte numbering that was remembered as covering this is stage 2
   *synthesising marker labels*, which is a different thing.)
2. **No boundary.** A note is `gistable: true` body prose to every rule in `TableView.tsx` — the cell
   never carried `role` or `treatment` at all. The spine and the outline dress a supplement
   differently; the prose column never did.
3. **The back-link worked and could not be seen.** A bare `↩︎` in `--ink-faint` with `0 0.2em` of
   padding, at the end of 126 words, and `data-came-from` was already marking the right one of them —
   with a 1px outline, on a glyph a few pixels wide.

So "it doesn't show the number" and "there should be a way back" were two different bugs wearing the
same coat, and only one of them was missing.

## What shipped

Notes now render as a region: a rule, its own ground, softer ink, a `Notes` heading, and each note
carrying its number. The back-link is a bordered pill, **44×44 on `pointer: coarse`**, and the one
you actually arrived by says *back to your place* in words rather than being the thirteenth identical
arrow.

Two calls worth keeping:

- **The number is the author's own marker text**, not a count. `[5]` stays `[5]`. A count drifts the
  moment one note goes unrecognised, and then the marker and the note disagree — which is a worse
  failure than no number, because it is a confident one.
- **`Bibliography` is deliberately not treated as a notes heading.** gwern's page ends with one
  directly above the notes, which is exactly how this fix would have silently done nothing on the
  very page the report came from.

Also caught in passing: `background-color`, not the `background` shorthand — the shorthand would have
reset the search-hit bar on a note row to `none`.

## Deferred

Margin and sidenotes; a floating "return" button; browser Back restoring scroll position. Recorded in
[links.md](../project/links.md) and the plan's stage 3.
