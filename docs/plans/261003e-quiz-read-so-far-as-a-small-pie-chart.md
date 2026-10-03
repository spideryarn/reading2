# 261003e — Quiz: how much you have read, as a small pie chart

Up: [plans.md](../project/plans.md) · feedback `spya-mafmm6` · Overseer queue `qi-kvr8h559`

Greg, 2026-10-01 (spya-mafmm6):

> In Quiz mode, instead of "about X% of the piece read so far", use a little pie-chart or sparkline,
> with a rich tooltip (see tooltips.md).
>
> And make a note in design.md or similar to prefer little charts/icons/etc rather than text.

## What it is now

`OnlyRead` in `src/web/QuizPanel.tsx` puts a tick-box, **Only what I've read**, and beside it a
grey line of text: `about 40% of the piece read so far` (`readShareLabel` + `shareRead` in
`src/web/read-filter.ts`). The text is said only once the reading levels have loaded; after a failed
load it says the filter is off instead.

## What changes

1. **A new component, `src/web/SharePie.tsx`** — a 14px inline SVG pie: a faint full circle (the
   whole piece) with a filled slice for the share read, starting at twelve o'clock and going
   clockwise. Props: `share` (0–1), `label` (the sentence a screen reader hears and the card's
   first line), `detail` (optional second line of the card). It is `role="img"` with that
   `aria-label`, wrapped in the shared `Tooltip` with `TipNote` content — the same shape as
   `ScoreBars`, and not focusable for the same reason it gives (the label carries the number).
   It is generic so the next "share of a whole" (Skim's progress, a search hit's place) can reuse
   it rather than drawing a second pie.
2. **The geometry is a pure, tested function**, `piePath(share, r)`, so the edges are pinned:
   - `0` (or non-finite) → no slice; the faint circle alone says "none".
   - `1` → a full disc (a single arc cannot draw 360°, so this is a circle, not a path).
   - **The drawn slice never lies by rounding to an extreme**: a share above 0 is drawn at least
     4% so a reader who has read one heading sees *something*; a share below 1 is drawn at most
     96% so "nearly all" never looks like "all". This mirrors `readShareLabel`, which already says
     "under 1%" and "over 99%" rather than 0 or 100.
3. **`OnlyRead` swaps the text for the pie**, placed right after the tick-box label. The card says
   `About 40% of the piece read so far` (from `readShareLabel`, capitalised) and a second line on
   what counts: *counted in words, from the passages that have been on screen long enough to read*.
   The failed-load sentence stays as words — it is a warning, not a quantity.
4. **The design note**, a short section in `docs/project/design-css-overview.md`, beside § Dates:
   *Draw a number rather than print it* — Greg's two quotes (this one and 2026-08-31's, now buried in
   `ScoreBars.tsx`), the rule (a small chart or icon, with the exact figure and its meaning in a rich
   card and an `aria-label`), and the two components to reach for (`ScoreBars`, `SharePie`).
   `quiz.md` § Only what you have read gets its example updated.

## Passed over

- **A sparkline / thin progress bar.** A bar of the piece read is the more literal picture, but in a
  wrapping row beside a label a bar needs a width to mean anything and competes with the row's
  layout on a narrow band; a pie is one fixed square. A bar would also suggest *position* (read up
  to here), and the share is not contiguous — it is words read wherever they are.
- **Keeping the text and adding the pie.** Greg asked for *instead of*.
- **Drawing the per-section map of what you have read** (a strip of the piece, read parts filled).
  More informative, and the spine already draws it; deferred, not needed for this.

## Checks

- `tests/share-pie.test.ts`: `pieSlice` at 0, NaN, 0.001, 0.25 (quarter: ends at three
  o'clock), 0.5, 0.75 (large-arc flag flips past half), 0.999, 1 (full). (As built, after review.)
- `npm test`, `npm run typecheck`, lint on touched files; a browser look at the quiz band.

## After GPT Sol's plan review

[The review](261003e-quiz-read-pie-plan-review-sol.md) found no P0. Taken:

- **P1, the card was unreachable by touch and keyboard.** The pie is now a `<button>` (24px hit
  area round the 14px pie, the extra taken back by a negative margin) driving a *controlled*
  `Tooltip`: a click or tap opens it, focus opens it, Escape or a tap elsewhere closes it, and the
  controlled card ignores a touch's synthesised hover. `tests/share-pie-card.test.tsx`, seen red
  with the click handler removed.
- **P1, the 4%/96% clamp drew a false quantity.** Struck: the slice is the exact share, and the
  card's words carry "under 1%" and "over 99%". ±Infinity are tested.
- **P2, the pie could wrap alone.** The tick-box and the pie are one non-wrapping group.

Passed over: **`conic-gradient` instead of an SVG path.** Fewer lines, but the path is already
written and tested, and it renders crisper at 14px. Also changed after the first browser look
(which ran before the button): the slice is `--ink-soft`, not `--ink-faint` — it read as dim.
