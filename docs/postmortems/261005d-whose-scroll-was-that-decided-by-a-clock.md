# Whose scroll was that, decided by a clock

Up: [postmortems.md](../project/postmortems.md). The plan and its evidence:
[261005c](../plans/261005c-a-late-scroll-event-of-our-own-ends-a-centred-arrival-and-rewrites-at.md).

From 2026-09-29 to 2026-10-05, a click on a part or section in Structure landed the prose correctly
and then, about a second later, rewrote `?at=` to the section *before* the one clicked. It did not
correct itself, so a reload, Back or a shared link opened the wrong place. **It reached readers**: it
was in production for six days and happened on most clicks on a long article. Nothing was lost — the
address was wrong, not the data — and it was found by a browser check of unrelated work
(queue item `qi-d7pxe8z7`).

## What happened

A deliberate jump lands its block in the middle of the window. Everything that asks where the reader
is measures at a line under the top bars, where a centred block is not, so `scroll.ts` keeps an
*arrival anchor* — "the reader is on this block until the page moves" — and drops it on the next
`scroll` event. The glide's own last movement fires a scroll event too, so there was a *quiet
window*: 350 ms from the moment the glide **started**, inside which an event at the pixel the glide
reached was ours. Outside it, every scroll event was the reader.

The same click re-renders the reading view, twice. The trace, with temporary logging in
`holdAnchor` and `clearArrivalAnchor`:

```
+0    glide starts; quiet window ends at +350
+200  first frame runs (a render held the thread)
+383  last frame; anchor held at scrollY 11742, row top 314.8
+507  our own scroll event: scrollY 11742, window expired 155 ms ago → anchor cleared
+810  replaceState at=<the previous section>
```

That is a 49-block article on a dev build. On a 1,025-block one the event trailed the last
`scrollTo` by 745 to 1,243 ms, and the race was lost on 8 clicks of 8.

Two investigations ran in parallel and both were partly wrong, which is worth keeping. The code-side
read named the right mechanism at about 60%. The browser one measured the event's lag from the last
`scrollTo`, found three clicks under 350 ms that were still rewritten, and concluded the window could
not be the cause; it had assumed the window opened where the glide ended. It was the temporary log
line printing `quietLeft -155` beside an unchanged pixel that settled it.

## The class: a clock standing in for a fact the code could read

The question was *is this scroll event ours?* The fact that answers it was already in a variable —
the pixel `moveWindow` last reached — and the code asked a clock first and the pixel only inside it.
A duration is a promise about how long something else will take, and here the something else was the
browser's event loop under a React render, which promises nothing.

The mark of the class: **a constant in milliseconds, described in a comment as "a margin" or "a
little either side", guarding a decision about who or what caused an event.** It works on the
author's machine, on a short article, in a unit test with a hand-owned clock, and loses on the
largest input.

Siblings found by grepping `src/web` for the shape:

- **`watchBarVisibility`** used the same window, and with a late event hid the controls bar for a
  jump down (or revealed it for a jump up) — the thing the window was first written to prevent
  (2026-08-27). Red-first test, fixed in the same change.
- **`DiagramPanel.tsx` § `CHAIN_MS`**: "the glide plus a margin" decides that the last ↑/↓ press's
  aim still stands. Same shape, left outside this change. Its timer (`setTimeout`) and the glide's
  frames (`requestAnimationFrame`) are separate callbacks: a blocked thread does not guarantee
  that the glide finishes before the chain expires or the next press runs. Its comment records
  that the handle (`glideTarget()`) was tried first and had its own gap; that does not establish
  the timer's safety either. GPT Sol's code review reproduced it in a controlled test (C3: a glide
  still pending when the chain expires, and a second Next repeats the first target); how often a
  browser gets there is unmeasured. `keynav.ts` keeps the same timer for ↑ / ↓. Reported to the
  Overseer as its own item rather than fixed here.
- **A neighbour of a different class, found by the same browser check:** the row Structure marks as
  current (`useColumnContext`) never asked the anchor at all, so on a long article it marked the
  row before the one clicked from the moment of landing. The report read as one symptom ("`?at=`
  is rewritten and the highlight follows it"); it was two defects that happened to agree. Fixed in
  the same plan, with its own red test.
- **`follow.ts` § `HANDS_OFF_MS`** is a clock, and is *not* this class: its signal is `wheel` and
  `touchmove`, which only a hand fires. Its own comment says so.

## Which commit

`fb21841fb` (2026-09-29, plan 260929a) added the anchor and kept the quiet window open past a
settled glide for it. `30b5eac34`, the same day, was the code review's fix: a reader can scroll
*inside* the window, so the pixel was added — as a second condition under the clock, rather than
instead of it. The review saw that the clock could not tell the two apart and stopped one step short
of asking what the clock was then for.

## Why nothing went red

- **The unit test owned the clock.** `tests/scroll-settlement.test.ts` delivers the glide's trailing
  event at exactly the time the code expects it. The test and the code shared the assumption that the
  event is prompt ([silent-success.md](../reusable/silent-success.md)).
- **One assertion wrote the bug down as the requirement**: it dispatched a scroll event at an
  unchanged pixel, late, and expected the anchor to be gone, under the comment "the reader scrolling,
  afterwards, ends it". A reader who scrolls changes the pixel; the test did not.
- **The browser check of 260929a looked at arrival, not at arrival plus a second.** The landing is
  right. The rewrite comes after the debounce.
- **It is a race**, and on a short article with a production build it is usually won.

## What would have caught it, ranked by ease against value

1. **Deliver our own event late in the test** — one test, clock advanced past any window before the
   event. Done; it also went red on the bar. It fails on the incident as it happened, not on a tidied
   version: same pixel, late.
2. **Delete the clock rather than tune it.** Done: `quietUntil` and `markOurScroll` are gone, so
   there is no number left to be wrong. This is the countermeasure for the class, since the next
   author cannot reuse a window that does not exist.
3. **A browser check of anything that writes the address waits past the debounce** and reads the URL
   again, with CPU throttling on. A habit, for [browser-testing.md](../project/browser-testing.md);
   costs four seconds a check. Used for this fix's own check.
4. A lint rule against `performance.now()` comparisons in `src/web` — rejected. Most uses are
   animation easing, where a clock is the fact. The class is about *attribution*, which a rule
   cannot see.
5. Judging the anchor by the row's place in the viewport instead of by `scrollY` — rejected for now,
   with the reasons in the plan. It would also survive the browser moving `scrollY` under a row that
   stays put, and no trace showed that happening.

## The fix that is right for the long term

The one shipped: a scroll event reporting the pixel we last moved to is ours whenever it arrives, and
one at any other pixel is not. One rule, for the anchor and the bar, with nothing that expires. It
differs from the patch that was available — widen 150 ms, or start the window at the glide's end —
which would have gone green on the new test with a large enough number and lost again on a longer
book.

## The thing I would tell myself

I was not the author, so this is what I would tell whoever is next handed that review finding. When
it said "a reader can scroll inside the window, so compare the pixel", the pixel had just been shown
to be the thing that answers the question. Ask what the clock still decides once the pixel is there.
The answer was: only the cases where it is wrong.
