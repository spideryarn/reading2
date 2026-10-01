# Trajectory's rows show the quote's own words

**Status:** building, 2026-09-28. From a reader report,
[SPIDERYARN-READING2-48](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-48) (overseer
queue `qi-q6ragxe5`). Builds on [260928a](260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md);
the mode's doc is [trajectory.md](../project/skim.md).

> When including Quotes in Trajectory mode, include summarised and/or truncated version (with tooltip
> for full version) of the quote itself in the left-hand column, not just the double-quotes symbol
>
> — Greg, 2026-09-28, via the Feedback button, on `arxiv-2508-spya-wrzxkg` at `depth=3`

## What he was looking at

Each row of the Trajectory band says only **where** the stop is — its section path, `Results ›
Robustness` — and, when a row sits in the same section as the row above, it draws a ditto mark, `〃`,
instead of repeating the path. At *Most* on a paper, many consecutive stops share a section, so most
rows read `3  〃`. The ditto mark looks exactly like a double quote. So the band is a column of
numbers and quote-marks, and nothing in it says **what** the stop is: the words are only in the
prose, one stop at a time.

## What we will build

1. **Every row shows the quote's words**, under its section path, in quotation marks and cut short
   on a word boundary with `…` — about 100 characters, which is two lines at the band's width. The
   words are the Quote's stored `text`, the article's own characters (types.ts § `Quote.text`), so
   nothing new is generated.
2. **A cut-short row has a tooltip with the whole quote**, through the shared `Tooltip`
   (Floating UI, [tooltips.md](../project/tooltips.md)) — on hover, and on keyboard focus, since the
   row is a button. A row whose quote fits has no tooltip: it would repeat what is on the row.
3. **The current row shows the whole quote, and has no tooltip.** It is the stop you are on, its
   row already grows a cue and the stop card, and this is also what answers touch: an iPad has no
   hover, but tapping a row makes it current, and the current row is never cut short.
4. **The ditto mark goes.** A row in the same section as the one above draws no section line at all
   (the path stays in the row for a screen reader, as the `sr-only` span does today). With words on
   every row the `〃` would sit beside a quotation and read as one — the same confusion that
   produced this report.

Shape of a row, before and after:

```
before                               after
 4  Results › Robustness    ──●──     4  Results › Robustness      ──●──
 5  〃                      ─●───        “Across all five datasets the
 6  〃                      ───●─        effect held within 2%…”
                                      5  “We then removed the rich-club
                                         nodes and repeated…”      ─●───
```

## What is not built, and why

- **A model-written summary of each quote.** Greg said *"summarised and/or truncated"*. A summary
  is a new model call per route (or per quote), a stored field, a prompt version and a staleness
  rule — a pipeline change for a list that is meant to be scanned. And a quote is already the short
  form of its passage: summarising it replaces the author's words with ours, which is the thing
  [vision.md](../project/vision.md) says we do not do, and which Quotes mode itself refuses
  (types.ts: *"The list a reader scans is the author's prose and nothing else"*). The route's
  existing **cue** already says what to look for at a stop, on the current row. **Deferred**: if the
  truncation turns out not to be enough on long quotes, the next step is to let the route call return
  a short label per stop (it already returns a cue), not a second pipeline step.
- **A CSS `line-clamp` instead of a character cut.** It would fill the width exactly, but the code
  cannot then tell whether a row was cut, so every row would need the tooltip whether or not it
  added anything. The character cut is testable and decides the tooltip.

## Where the code changes

- `src/web/modes/trajectory/TrajectoryMode.tsx` — `TrajectoryRow` gains `words: string | null`, the
  quote's text (`null` for a row whose quote has gone).
- `src/web/TrajectoryPanel.tsx` — draws the words, cut with the shared `snippet` from
  `src/web/citations.ts` (whitespace folded, word boundary, bounded with no spaces), the tooltip on
  a cut non-current row, and no ditto.
- `src/web/styles/trajectory.css` — the words' style: the prose's quote style, a touch smaller than
  the section path, muted on a *seen* row like the rest of it.
- Tests: a row test that a long quote is cut and gets a tooltip, a short one is whole with none, the
  current row is whole with none, and a repeated section draws no `〃`.
- [trajectory.md](../project/skim.md) — a line under *What shipped*.

## What the plan review changed

GPT Sol, read-only, 2026-09-28. All three findings were taken:

- **The row's button must never be remounted.** Wrapping it in `<Tooltip>` only while cut would
  swap the element as the row becomes current and drop a keyboard user's focus to `<body>`. So every
  row is wrapped, and the shared `Tooltip` gained `enabled` — `false` keeps the wrapper and opens
  nothing, and turning it off closes a card and tells a controlling parent so, or the card would pop
  back up the next time the row was enabled. The rows' tooltips are **controlled** (one open at a
  time, panel state), which also makes them mouse-only (`mouseOnly` in `Tooltip.tsx`), so a tap's
  synthetic hover on an iPad cannot flash one. Both have a test that was seen red first.
- **A quote can be 1,200 characters**, so the card is wider than the shared 22rem (30rem, bounded by
  the window) and breaks an unbroken token.
- **The rows share a `TooltipGroup`**, as Structure's do, so running down the list at *Most* opens
  each card without the cold delay.

The review also asked that the choice be described as taking the *truncated* branch of Greg's
"summarised and/or truncated", not as redefining "summarised" — which is how it now reads above.

## Checks

`npm test` (the trajectory files), `npm run typecheck`, lint on the touched files; a browser look
at a local paper at *Most* on a wide and a narrow window.
