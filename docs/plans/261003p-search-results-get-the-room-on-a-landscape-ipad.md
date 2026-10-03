# Search results get the room on a landscape iPad

Up: [plans.md](../project/plans.md) · owner doc: [search.md](../project/search.md)

Report `spya-eqcbay` (SPIDERYARN-READING2-BP), a suggestion from Greg (admin, production row proven
by `feedback-reporter.ts`, exit 0), 2026-10-03 19:17 UTC. Overseer queue item `qi-4zsj3w9g`.

> When I use the search on a landscape iPad, I can hardly see the search results. They're just in a
> tiny little window at the bottom, scrollable window, because of all the stuff above them that is
> taking up space. So there's a few options. One simple one would be to actually just scroll the
> entire column as one. Another would be to reduce the space given to the different other searches
> for their scrollable window. I think most importantly of all, let's remove some of the stuff we
> don't need. So there's something underneath the threshold for prioritize that says nothing is
> hidden by this threshold. We can get rid of that, I think, because the, you know, n of m above
> kind of answers that. And there's also a blurb explaining, you know, what the scoring and the
> visual bars are. Let's rely on tooltips for that, so we can get rid of that as well.
>
> — Greg, 2026-10-03

**Status: built; the browser check and the code review are in § Progress.**

## What is there now, measured

The Search panel (`aside.mode-band.srch`, [`SearchPanel.tsx`](../../src/web/SearchPanel.tsx),
[`search.css`](../../src/web/styles/search.css)) is one flex column. Only the last part, the list of
results, takes what is left. Measured in Chrome with touch on, on the local article
`noema-mythology-of-conscious-ai` with its five saved searches all ticked and 60 results
(screenshots `261003p-shot-before-1180.png`, `261003p-shot-before-1024.png`):

| Part | 1180×740 | 1024×690 |
|---|---|---|
| the whole panel | 644 | 594 |
| the search box (`.srch-box`) | 85 | 85 |
| the saved searches (`.srch-saved-wrap`, capped at 40%) | 258 | 238 |
| count and order buttons (`.srch-sort`) | 36 | 36 |
| the threshold slider (`.srch-gate`), of which the foot line is 17.5 | 79 | 79 |
| the legend (`.srch-legend`), which wraps to three lines at this width | 70 | 70 |
| **the results (`.srch-hits`)** | **116** | **86** |

A result row is 75 to 153 px tall, so not one whole row fits in either window. This is not a
failing-test bug: every part is doing what its rule says. It is a layout that was sized on a tall
desktop window.

## What changes

Three things, in the order Greg ranked them.

1. **The legend goes.** `Legend` and its CSS are deleted. What it said is already in the card behind
   each row's score: pressing the score and bar in a row's left gutter opens *"95 out of 100 — how
   strongly the model thinks this passage matches … the model's own judgement … not a measurement"*
   and *"2% in — how far through the article"* (`HitCard`). The legend existed because a hover card
   is something a touch reader never sees; since 2026-09-12 the gutter is a button of its own, so a
   tap reaches the card. **That has to be shown on a touch screen before this lands** (below).
2. **The foot line goes when nothing is hidden.** The slider row already prints `30 · 60 of 60`.
   The line stays when the threshold *is* hiding something (*"8 passages are hidden by this
   threshold. Drag the slider left to show them."*), because that is the sentence that tells a
   reader why the list is short or empty, and Greg named only the nothing-hidden case.
   In Search only: Glossary, Quotes, Citations, FAQ and Debate keep theirs (question 1 below).
3. **The saved searches are capped at a quarter of the panel, not 40%.** The list already scrolls;
   it just scrolls in a smaller window. The cap is `max(25%, 7.5rem)`: the floor is for a panel
   much shorter than an iPad's, a phone on its side, where a quarter would be one row (plan review
   PR-1). There the list keeps its header and about two rows, which is what 40% gave it.

What that should give, by arithmetic (to be measured after):

| | 1180×740 | 1024×690 |
|---|---|---|
| results now | 116 | 86 |
| after 1 and 2 only | 204 | 174 |
| after 1, 2 and 3 | about 300 | about 264 |

### The option passed over: scroll the whole column as one

Greg offered it as the simple one. It would be one scroller where there are two today (the saved
list and the results each scroll on their own, in CSS only; pressing a result scrolls the article,
not the list). With one scroller the search box and the order buttons scroll away with the results,
or have to be made sticky, and with eight saved searches the first result starts below the fold.
The smaller cap gets the room back with one number changed. If the after-measurement shows it is
not enough, this is the next thing to try, and the note will say so rather than calling it done.

## How it is built

- `SearchPanel.tsx`: delete `Legend` and its call; in `ConfSlider`, render `.srch-gate-note` only
  when `hiddenCount > 0`. `Place`'s `decorative` prop stays (a row's gutter uses it).
- `search.css`: delete the `.srch-legend*` and `.srch-swatches` rules; `max-height: max(25%, 7.5rem)`
  on `.srch-saved-wrap`, and its comment.
- `threshold.ts § hiddenNote` is not changed: the other panels still print the zero sentence.
- Tests, red first:
  - a render test of the panel: with nothing hidden there is no `.srch-gate-note`; with some hidden
    there is, and it carries the sentence; there is no `.srch-legend`.
  - `tests/glossary-band-wiring.test.ts` pins `<p className="srch-gate-note">{note}</p>`
    unconditionally for Search; it changes to say Search prints it only when something is hidden,
    and Glossary and Quotes stay unconditional.
  - `tests/mode-surface-changes-no-markup.test.tsx` lists `p.srch-legend` among the band's
    children; it comes out.
  - a CSS check that `.srch-saved-wrap` is capped at 25% (the project's existing stylesheet tests
    are the model).
- Docs: [search.md](../project/search.md) — the ASCII picture's legend line, § *And a legend*, and
  the *3 of 11* bullet under *The four ways a filter lies*. [help-page.md](../project/help-page.md)
  if `/help` mentions the legend.
- Browser, in a subagent, same recipe as the before-measurement: the table above re-measured at both
  sizes, screenshots, and **a real touch tap on a row's gutter opening the card**. The
  before-run's `touchscreen.tap` did not open it and a synthetic click did; whether that is the
  harness or the app is not known yet. If a touch tap really does not open the card, that is a bug
  that removing the legend would expose, and it is fixed in this work (failing test first) or the
  legend stays.

## Questions for Greg (none blocks this)

1. **The same line in the other panels.** Glossary, Quotes, Citations, FAQ and Debate print the
   same *"Nothing is hidden by this threshold."* under their sliders, from one shared sentence, and
   each also shows *n of m*. Your reason applies to them equally. This plan leaves them alone
   because the report was about Search. Say the word and it is a one-line change for all of them.
2. **The line when something *is* hidden.** Kept here. *n of m* arguably answers that too; dropping
   it would save another 17 px most of the time.

## Progress

- 2026-10-03: prior-work check clean (no plan, note, commit or other session on this report);
  before-measurement taken; plan written.
- 2026-10-03: GPT Sol's plan review
  ([answer](261003p-search-results-room-plan-review-sol.md)): approve with changes, no P0 or P1.
  PR-1 (25% is one row on a phone on its side): taken, the cap has a `7.5rem` floor and the browser
  check measures a phone. PR-2 (nothing scrolls a pressed result inside the list): right, the
  passed-over section is corrected. PR-3 (the tap needs real evidence): the browser check tests a
  tap against a control, the band's (i). PR-4 (all-hidden and words-mode arms): both are in
  `tests/search-results-get-the-room.test.tsx`. PR-5 (more of search.md, stale comments): done.
  PR-6 (the note's margin, about 4 px more): noted, the table says "about".
- 2026-10-03: built. `tests/search-results-get-the-room.test.tsx` was red on three arms first (the
  zero-hidden line, the legend, the cap) and green on the two that pin what is kept.
- 2026-10-03: the browser check, after (Chrome with touch on, same article and searches;
  screenshots `261003p-shot-after-1180.png`, `-1024.png`, `-phone-landscape.png`):

  | | 1180×740 | 1024×690 | 1440×900, mouse |
  |---|---|---|---|
  | results before | 116 | 86 | not measured |
  | **results after** | **305** | **268** | 436 |
  | saved searches before → after | 258 → 161 | 238 → 149 | → 204 |
  | whole result rows on screen, before → after | 0 → 2 | 0 → 1 | 3 |

  With the threshold hiding some (`?conf=90`, *33 of 60*) the foot line is back, as designed, and
  the results are 265 at 1180×740.
- **A phone on its side (844×390) is not fixed by this, and was not made worse.** The panel is
  294px tall, its fixed parts take about 234, and the results are 9.6px. Forcing the old 40% cap
  back gave the same numbers, so the cap is not what binds there. It is its own queue entry,
  `qi-ddddtaqm`, as a proposal.
- **The tap found a bug.** In Chrome with touch on, a tap on a row's score opened the card and a
  `mouseleave` synthesised about 100ms after the click shut it 20ms later, on every tap method
  tried, with the band's (i) as a control that stayed open. So on a touch screen the card could not
  be read, and with the legend gone nothing would have explained the number. Fixed in
  [`Tooltip.tsx`](../../src/web/Tooltip.tsx): a controlled card ignores a hover-close when the last
  press on its trigger was a finger or a pen. Red first, in
  `tests/search-hit-card-on-the-score.test.tsx`. **What is not known:** whether Safari on a real
  iPad sends that `mouseleave`. No machine here runs WebKit with touch, so this was reproduced in
  Chrome only. The fix is safe either way; Greg tapping a score on his iPad is the real check.
