# Excerpts measured in Chrome: a Search list formats only the rows a reader can see

Found in review, not a report. 261009k
([excerpts-keep-maths-and-formatting](261009k-excerpts-keep-maths-and-formatting.md)) made every
excerpt outside the prose draw from its block's markup. Its browser check found that searching BERT
for "the" (588 hits) froze the page for 1–3 s while the list drew, and it had no baseline to say how
much of that freeze was its own. It made each block parse once (4× faster in jsdom) and stopped
there, unmeasured in Chrome. This plan measures it, then removes the part that was its own.

Status: **built**, with GPT Sol's plan review folded in (§ Plan review). Code review: § Code review.

## The measurement

### First pass: two trees

A Sonnet subagent, Playwright against headless system Chrome, 1440×900, no throttling. Two Vite
dev servers on one local database: **current** `dev` at `56adcafa5` and **baseline** `94042d91b`,
the commit before 261009k. Each run opens the article fresh, signs in, then records every
`longtask` from the action until three quiet seconds. Runs alternate current and baseline, so the
load from other agents (a load average of 11–17 throughout) falls on both. These are dev-build
numbers: React's development runtime makes rendering slower than production does.

Search for "the" in BERT, words matcher, 588 hits, 5 runs each, no profiler attached:

| | longest task, median [range] | all long tasks, median | wall time to last row |
|---|---|---|---|
| baseline (strings) | 1,808 ms [1,755–2,126] | 2,822 ms | 3.1 s |
| current (261009k) | 2,596 ms [2,353–3,086] | 3,406 ms | 3.5 s |

Every current run was slower than every baseline run. The page also has 1,245 more DOM nodes,
which are the formatted excerpts. But the two trees differ by 26 commits as well as 261009k, and
the baseline tree failed to load some fonts (its `node_modules` is a symlink outside Vite's
allow-list), so Sol (F1) asked for the comparison to be isolated. It was, below.

The other excerpt lists, 3 runs each with the profiler on for none of them, did not show the
consistent slowdown of the 588-row Search. These are the numbers for opening the mode, not for
scrolling through it:

| mode | rows | current, longest task | baseline, longest task |
|---|---|---|---|
| Search "attention" | 20 hits | 834 ms | 811 ms |
| Quotes | 39 | 1,062 ms | 1,270 ms |
| Ideas | 9 | 1,484 ms | 1,421 ms |
| Glossary, Timeline | no local data (generating them costs money) | — | — |

A CPU profile of the current Search run put about 130 ms of JavaScript self-time in the excerpt
code itself (`parsed`, DOMPurify's `clone`). It does not assign the rest of the difference. The
1,245 extra DOM nodes, 99 of them MathML, make browser parsing, styling and layout plausible, but do
not measure their share. The bigger, older part of the freeze includes React creating 588 rows:
`jsxDEV`, `createElement` and `setProp` together take about 1.2 s. A small item,
`safe-area.ts § safeAreaInsets`, took 80–90 ms of repeated calls, unrelated to excerpts.

### Second pass: one tree, four variants

One server, one tree (this one), with a temporary switch at the Search row, set per run by
Playwright's `addInitScript`. It chose between the plain string (the code before 261009k), eager
formatting (`dev` today), lazy formatting (the fix), and eager plus `.srch-hit {
content-visibility: auto }` (Sol, F4). Runs alternated across all four, 5 each, load average 13–16.
Long tasks were counted only if they ended after the action (Sol, F2). "Scroll" is a second
scenario: the same search, then the list scrolled from top to bottom in 1.5-screen steps every 50
ms, which is about as fast as a scrollbar drag (F7). After scrolling, the script counts the rows on
screen whose words are still unformatted.

| variant | longest task on opening, median [range] | all long tasks | longest task while scrolling, median [max] | rows on screen formatted after scrolling |
|---|---|---|---|---|
| strings (before 261009k) | 1,787 ms [1,716–2,047] | 2,882 ms | — | 0 / 12 (strings) |
| eager (dev today) | 2,808 ms [2,640–2,891] | 3,852 ms | 0 [51] ms | 12 / 12 |
| **lazy (this fix)** | **1,886 ms [1,628–2,278]** | **2,909 ms** | **0 [111] ms** | **12 / 12** |
| eager + content-visibility | 2,740 ms [2,504–3,083] | 3,702 ms | 0 [0] ms | 12 / 12 |

So it **was a real regression**, and in one tree it is larger than the first pass said: 261009k
added **about 1.0 s** to the longest freeze, which is 57%. The fix takes it back to within about
0.1 s of the strings. The median fast-scroll run had no long task; the recorded maximum was 111 ms.
`content-visibility` saves almost nothing, because the cost is in building the
rows, not in laying out the ones off screen. Ending the temporary switch is part of this commit; none
of it is left in the tree.

All of these numbers come from the dev build. A production build removes React development work but
does not remove the richer DOM or MathML, so the new work may be a larger share of a production
freeze. Production was not measured.

The scripts are kept outside the repo, in the session's scratchpad: the subagent's
`perf/measure.mjs`, and `perf/measure2.mjs`, which adds the variants and the scroll. Each takes
several `URL|variant` targets and alternates between them.

## The fix

**A Search row draws its words as the plain string until the row comes near the screen, and only
then draws the formatted excerpt.** A list of 588 hits shows about fifteen at a time, so the first
draw of the list costs what it did before 261009k. Each row then pays for its formatting as the
reader scrolls to it.

- `src/web/when-seen.ts` § `useSeenOnce(ref, enabled)`: one shared `IntersectionObserver` for the
  whole page. It returns `true` once the element has come within 400px of the screen, and stays
  `true`. It returns `true` at once when there is no `IntersectionObserver` (jsdom, an old browser),
  when the observer throws (Sol, F6), or when `enabled` is false. Every failure therefore draws the
  formatted excerpt, never a row stuck unformatted.
- `Excerpt` / `BlockExcerpt` gain `lazy`. When it is set and the row has not been seen, the
  component draws `words` in a `<span>` and does not call `excerptHtml` at all. Once the row is
  seen, it draws what it draws today.
- `SearchPanel.tsx § Hit` passes `lazy`. Nothing else does: every other site draws tens of
  excerpts at most, or exactly one, and a one-off excerpt in a card or a dialog should not flash as
  a string first.

**What it costs the reader.** A row's words can show as the plain string for a frame or two before
they are formatted. A Search snippet is cut from the text as drawn (`renderedText(block.html)`), so
that string is the formula's symbols run together (`dk`), not TeX source; what the frame lacks is
the italics, the sub- and superscripts and the MathML layout (Sol, F8). The observer is given a
`rootMargin`, plus a `scrollMargin` (the list scrolls inside the band, and a plain `rootMargin` does
not reach past that scroller), so that while scrolling most rows are formatted before they arrive.
`scrollMargin` is recent — WebKit and Firefox (141) added it in 2025, per Sol; an engine without it ignores it, and its
rows format as they come into view rather than just before (Sol, F5). The rows on screen when the
list first draws can still flash.

**A row keeps "seen" while it stays mounted.** Rows are keyed by `Found.key`, the passage, so
React reuses a row across a new query only for the same passage; its changed words re-render
formatted at once. That is right, and it is deliberate (F8).

## Options passed over

- **Cap the rows drawn** — draw the first hundred and add more as the reader scrolls. This would
  also cut the older 1.8 s, which a format-only fix leaves alone. Passed over for now: it changes
  what the list is (its count line, find-in-page within the band, keyboard order), and it is a
  product call on a freeze that predates this regression. Named here so Greg can make that call; it
  is the next step if a common-word search still feels slow in production.
- **Format in idle time** (`requestIdleCallback`, one batch of rows per idle period). Avoids the
  flash for the rows on screen, but it would still format all 588 rows, most of which nobody
  scrolls to. More moving parts for less.
- **Make `excerptHtml` cheaper.** The profile says its own JavaScript is about 130 ms of the extra
  time. The rest is consistent with the browser drawing richer rows (F2: a profile shows where the
  JavaScript went, not that the remainder is all layout), which no change inside the function
  removes.
- **`content-visibility: auto` on the rows** (Sol, F4). One line of CSS, and it keeps find-in-page.
  Measured above: 2,740 ms against eager's 2,808. It skips layout off screen, but not the cost of
  building and parsing the rows.

## Stages

1. **Failing test first** — done. `tests/search-excerpt-lazy.test.tsx` mounts `SearchPanel` with 30
   hits and a fake `IntersectionObserver` that reports nothing. It checks that every row's words are
   there as text, that none is formatted, and, through a spy on `excerptHtml`, that none was even cut
   (F3). Once the observer reports one row, that row and only that one is formatted and cut. On the
   code before this fix it was red: 30 formatted where 0 and 1 were expected. With `lazy` taken back
   out of `Hit` it is red again in three cases, the spy among them.
2. **The fix** — done: `when-seen.ts`, `lazy` on `Excerpt`/`BlockExcerpt`, `Hit` passing it. Two
   more cases cover F6: unmounting the list unwatches every row, and an observer whose constructor
   throws formats every row. The second was red at first, because the module kept the observer it
   had made before the global changed; it now remakes the observer when the constructor differs, and
   records the constructor only once it has succeeded.
3. **Re-measured** — done: § Second pass.
4. **Docs** — done. maths.md § Excerpts outside the prose says which lists are lazy and why. A
   postmortem, since it was a real regression:
   [261009l](../postmortems/261009l-a-freeze-measured-without-a-baseline-is-never-attributed.md).
   It also leads to a rule in performance.md § Comparing a change against `main`: a cost you saw but
   cannot attribute means measuring the commit before, and one tree with a switch is the fairest way
   to do it.

## Plan review

GPT Sol, read-only — [261009r-excerpts-measured-in-chrome-search-list-stall-plan-review-sol.md](261009r-excerpts-measured-in-chrome-search-list-stall-plan-review-sol.md), verdict *proceed
with changes*:

| | Finding | What changed |
|---|---|---|
| F1 | two trees differ by 26 commits and the fonts; not counterbalanced | one tree, a temporary switch, four variants alternating — § Second pass |
| F2 | long tasks not filtered to after the action; "wall time" is the last mutation anywhere; the profile does not prove the rest is layout | filtered by end time; the profile claim softened to "consistent with" |
| F3 | the DOM check alone would pass a row that cut and threw the cut away | a spy on `excerptHtml` |
| F4 | try `content-visibility: auto` first | measured, and it does not help — § Options passed over |
| F5 | `scrollMargin` is recent | named, with what an engine without it does |
| F6 | an observer that throws; unmount cleanup | both handled and tested; StrictMode's double effect is covered by the effect's own cleanup, which deletes the row's entry and unobserves it |
| F7 | measure scrolling, not only opening | the scroll scenario; worst 111 ms |
| F8 | the fallback string is symbols, not TeX; say why "seen" survives a new query | both said under § The fix |

Not taken: F6's other cases. A `display: none` band becoming visible needs no code: the observer
reports a row when it is laid out on screen, and not before. A keyboard-focused row keeps the same
accessible text either way, because the string and the formatted excerpt are the same words. The
hit card's excerpt was never lazy.

## Code review

GPT Sol, fixing inside the stage — [261009r-excerpts-measured-in-chrome-search-list-stall-code-review-sol.md](261009r-excerpts-measured-in-chrome-search-list-stall-code-review-sol.md), verdict
*ship after my fixes*. Each change was read and kept:

- **F1**: `enabled` going false → true could take a formatted row back to its string. `useSeenOnce`
  now records the eager answer for good. Tests were added for it (red first), for StrictMode, for an
  `observe()` that throws, and for a polyfill that calls back synchronously.
- **F2**: claims toned down to the evidence. Scrolling has "a median of no long task, worst 111 ms",
  not "none", and the profile is described as "consistent with". The introducing commit is named in
  the postmortem.
- **F3**: one overclaim in performance.md, corrected to Sol's wording. Sol left it to me because it
  took the doc for a rule doc; it is not one of those.
- **F4**, not changed: the hook follows a stable ref object, not a ref whose element is swapped.
  `BlockExcerpt` never swaps it while waiting, and a new caller that does would need a callback ref.

## Browser check

A Sonnet subagent, Playwright on the box, BERT, after the code review's fixes:

- **Desktop Chrome, 1440×900.** Search "the": 588 rows, 10 on screen in the list's own scroller,
  all 10 formatted, **15 formatted in all** (not 588). Scrolled to the middle and then to the
  bottom: every row on screen was formatted each time, and the total grew to 35 and then 50. At 15%
  scroll, 7 of the 11 rows on screen held `<math>`. There were no `\(` in the list at any point, and
  `.excerpt [id], [href], [data-spya-id]` matched nothing. The hit card, opened from the gutter, is
  formatted. No console errors.
- **iPhone 15, WebKit.** 6 rows on screen, all formatted, 11 in all; at 15% scroll, all 8 rows on
  screen were formatted, 7 of them with maths; no `\(`; the only console line was WebKit's
  `interactive-widget` viewport warning.
- Shots: [desktop](261009r-shot-1-search-the-desktop.png), [iPhone](261009r-shot-2-search-iphone.png).
