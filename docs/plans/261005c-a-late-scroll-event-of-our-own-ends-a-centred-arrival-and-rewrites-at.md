# A late scroll event of our own ends a centred arrival, and rewrites `?at=`

Queue item `qi-d7pxe8z7`, a bug under Greg's standing rule (2026-10-04: *"if you see bugs, fix them
without asking me"*). Up: [plans.md](../project/plans.md). The area is
[url-state.md § A jump lands centred, and holds the position until you move](../project/url-state.md#a-jump-lands-centred-and-holds-the-position-until-you-move).

## What the reader sees

Click a part or a section in Structure. The prose lands correctly, with the heading in the middle of
the window. A second or so later the address's `?at=` changes to the section *before* the one you
clicked, whose first block is above the window (22 to 1,419 px above, in the report). It stays wrong,
so a reload, a shared link or Back restores the wrong place. Reported from the long-documents work
(`93620b647`) on a 1,025-block article; it is not specific to long articles.

## Background, in plain words

- A deliberate jump lands its block **centred**. Everything that asks "where is the reader" measures
  at a line just under the top bars, and a centred block is *below* that line — so, measured there,
  the reader appears to be in the previous section.
- To stop that, `scroll.ts` keeps an **arrival anchor**: "the reader is standing on this block until
  the page moves". The spy that writes `?at=` answers with the anchor while it holds.
- The anchor is dropped when a `scroll` event arrives. But the glide's own last movement also fires a
  scroll event, a frame or more *after* the glide finishes. To ignore that one, the code keeps a
  **quiet window**: a clock, set when the glide *starts*, to 350 ms (200 ms of travel plus 150).
  Inside the window, an event at the pixel the glide reached is ours; outside it, every scroll event
  is taken to be the reader.

## The cause, measured

The window is a clock standing in for a fact that can be read directly: *did the page move?*
A click on a Structure row also re-renders the reading view, twice (the click, then the `?at=` push
about 50 ms later), and each render holds the main thread. Traced in a browser with temporary logging
in `holdAnchor` and `clearArrivalAnchor` (this worktree, dev build, 1440×900):

```
49-block article, second click
  +0    glide starts; quiet window ends at +350
  +200  first frame runs (a render held the thread for 200 ms)
  +383  last frame; anchor held at scrollY 11742, row top 314.8
  +507  our own scroll event arrives: scrollY 11742 (unchanged), window expired 155 ms ago
        → anchor cleared by onScrollWhileAnchored
  +810  replaceState at=<previous section>          (the 300 ms debounce)
```

The row had not moved a pixel. On the first click of the same run the event arrived at +239, inside
the window, and `?at=` stayed right — so it is a race, lost whenever the renders are slow. A separate
instrumented run (Sonnet, Playwright) found it lost on 8 of 8 moving clicks on the 1,025-block
article, where the scroll event trailed the last `scrollTo` by 745 to 1,243 ms behind long tasks, on
4 of 4 on a 49-block one, and at an iPad width. Its scripts are in the session scratchpad
(`repro-run.ts`); the one this plan's trace came from is quoted above in full.

**Introduced by** `fb21841fb` (2026-09-29, plan 260929a: the anchor and the kept quiet window) and
`30b5eac34` the same day (the review fix that added the same-pixel test, but only *inside* the
clock).

**The class:** *whose scroll was that, decided by a clock* — a time window standing in for a fact
the code could measure. The postmortem is
`docs/postmortems/261005d-whose-scroll-was-that-decided-by-a-clock.md`.

## The fix

**The pixel decides, and the clock goes.** A scroll event that reports the pixel we last moved the
page to is ours, whenever it arrives. An event at any other pixel is the reader (or the browser), and
ends the hold as now.

### Stage 1 — the anchor (`qi-d7pxe8z7` itself)

`onScrollWhileAnchored` drops its clock test: an event with `scrollY` within half a pixel of
`anchorY` returns, at any time; anything else clears the anchor.

Red first, in `tests/scroll-settlement.test.ts` § a centred jump:

1. Glide to `spya-far` centred, settle, then deliver the trailing scroll event **after** the window
   (clock advanced to +1000, pixel unchanged): the anchor must still hold. Red today.
2. The existing "reader scrolling afterwards ends it" assertion dispatches a same-pixel event late and
   expects `null`. That assertion *is* the bug written down; it changes to move the pixel first.
3. One spy-level case in `tests/reading-position.test.ts` is not needed: `positionToWrite` is already
   pinned for both the anchored and unanchored branches, and the defect is upstream of it.

### Stage 2 — the same clock in the bar, and deleting it

`watchBarVisibility § apply` uses the same `quietUntil` to sit out our own scrolling. With a late
event it does not: it reads our jump as the reader's travel and hides (a jump down) or reveals (a
jump up) the controls bar, which is the exact thing `markOurScroll` was written to prevent. Red
first in the same file: a centred glide down, trailing event delivered late, `data-bars` must stay
unset.

Then `apply` asks the pixel alone (`ourScrollY !== null` and within half a pixel → ours; any other
pixel → the reader has taken over, forget `ourScrollY`), and `quietUntil` and `markOurScroll` have no
reader left and are **deleted**, with the three call sites and the `cancel` branch that reset them
(`cancel` keeps clearing `ourScrollY` when the reader takes over). If the red test does not go red —
the bar turns out to be protected some other way — this stage shrinks to a note in the debrief and
the clock stays for the bar.

What the clock gave that the pixel does not, checked rather than assumed:

- *Two moves between two events*: the event reports the latest `scrollY`, which is the latest
  `ourScrollY` (`moveWindow` reads it back after every `scrollTo`, so clamping and rounding are the
  browser's own answer).
- *A reader who returns to the exact pixel later*: one event of theirs is read as ours. For the bar
  that resets `from` and nothing else; for the anchor the page is where the arrival left it, so the
  anchor is true.
- *Nothing expires*: `ourScrollY` lives until an event at another pixel or a `cancel` by the reader.

### Stage 3 — docs, postmortem, browser check

- `url-state.md` § a jump lands centred: the sentence on what ends the hold.
- `scroll.ts` comments that describe the window (`markOurScroll`, `cancel`, `anchor`).
- The postmortem, with what would have caught the class.
- A Sonnet browser check at 1440, 820 and 390: five Structure clicks each, `?at=` unchanged four
  seconds later, the Structure highlight on the clicked row, and the bar not flickering on arrival.
  Also one click with 4× CPU throttle, which lost the race every time before.

## The simpler and the larger options passed over

- **Widen the window, or start it at the glide's end rather than its start.** One number changed, and
  it is still a race: the 1,025-block article trailed by over a second, and 4× throttle by four.
- **Judge the anchor by the row's own place in the viewport** (record its top at arrival; the anchor
  holds while the row is within a pixel of it; no scroll listener). The code-side root-cause proposed
  this, because it also survives the *browser* moving `scrollY` under a row that stays put (scroll
  anchoring after a late layout change above). Not taken: no such shift was observed in any trace, it
  adds a rect read to every `arrivalAnchor()` call (the spy, ↑/↓, the chip, `whereIsBlock`), and for a
  passage it needs the marks' rects as well. If a real case turns up it is a contained change to the
  same three functions.

## Not this plan

The code-side read noted that the Structure band's own highlight samples at 40% of the window
(`useColumnContext.ts`) and never asks the anchor. The browser check in stage 3 looks at the
highlight after the fix; if it is still wrong on landing that is its own finding, reported rather
than folded in.

## Log

- 2026-10-05: reproduced, traced, plan written.
- 2026-10-05: **GPT Sol's plan review: approve with changes**
  ([answer](261005c-a-late-scroll-event-plan-review.md)). One finding, F1 (P1), accepted: with the
  clock gone, the half-pixel tolerance this plan carried over would treat a quarter-pixel movement
  by the reader as "unchanged" for ever — the anchor kept, a hidden bar not revealed. Both guards
  now compare the exact readback (`window.scrollY === ourScrollY`, `=== anchorY`), so wherever
  stages 1 and 2 above say "within half a pixel", read "the same number". Red first: a quarter-pixel
  test failed against the tolerance. It found nothing in the frame ordering, instant moves or
  clamping, and agreed the larger option is not needed.
- 2026-10-05: stages 1 and 2 built. The two late-event tests were red before the fix (anchor `null`;
  `data-bars` `hidden`) and are green; `quietUntil` and `markOurScroll` are deleted. Commit
  `7624d4c46`.
- 2026-10-05: **GPT Sol's code review of `7624d4c46`: approve with changes**
  ([answer](261005c-a-late-scroll-event-code-review.md)). No runtime finding in the change. It ran
  the seven test files (107 passed), put a clock and a tolerance back into each guard in turn and
  saw all four mutations caught, and fixed two prose findings itself: C1, two comments that still
  described a destination measured once (`scroll.ts`, `tests/mobile-chrome.test.ts`) and one that
  named the window expiring; C2, the postmortem's claim that Diagram's chain timer and the glide
  "stay in step", which nothing guarantees. Both read and kept. **C3 (P1, wider, not fixed):** it
  reproduced, in a controlled test, the Diagram ↑ / ↓ chain timer expiring while a glide is still
  pending, so a second Next repeats the first target. Same class, different feature, frequency in a
  browser unmeasured; `keynav.ts` has the same timer. Not folded in — it is a change to how stepping
  chains in two files, not to this fix — and reported to the Overseer as its own item.
- 2026-10-05: **the browser check** (Sonnet, Playwright, against `7624d4c46`). `?at=` four seconds
  after a Structure click, with no `replaceState` after the push:

  | width | article | kept |
  |---|---|---|
  | 1440×900 | 1,025 blocks | 7 of 7 |
  | 1440×900, 4× CPU, 8 s wait | 1,025 blocks | 3 of 3 |
  | 1440×900 | 49 blocks | 4 of 4 |
  | 820×1180 (the list) | 1,025 blocks | 4 of 4 |
  | 390×844 (the band steps aside) | 1,025 blocks | 3 of 3 |

  A real wheel of 3,000 px ends the hold and `?at=` follows; a wheel up reveals the bar; the bar's
  attribute did not change on a jump down or up; a reload lands the section top-aligned. **Its first
  run lost two clicks**, with the row off-centre. That run overlapped the code reviewer saving
  `scroll.ts` (06:12:52) under the same dev server, and a hot reload replaces the module that holds
  the anchor. Re-run by me on a still tree with a cold server and an emptied Vite cache: 6 of 6,
  twice. Believed to be the reload; not proved beyond that.
- 2026-10-05: **the other half of the report was a second defect, and "Not this plan" above was
  wrong to leave it.** The check found Structure marking the row *before* the clicked one on the
  long article, from the moment of landing and still at four seconds (click "3 Notation", "2
  Preface" is marked). That is the "highlighted row follows it to the previous section" of the queue
  item, and it never read `?at=`: `useColumnContext` measures at 40% of the window and a short
  centred heading sits at about 45%. Fixed the way every other position reader is: while a centred
  arrival holds, the line is the arrived row's own top. Red first in
  `tests/structure-focus-row.test.tsx` (`'0'` where `'5'` was expected). In a browser afterwards, six
  clicks on the long article: the marked part is the clicked one at 500 ms and at 4 s, and `?at=`
  held all six. Commit `93ba3980c`.
- 2026-10-05: **GPT Sol's second, narrow review, of `93ba3980c`: approve with changes**
  ([answer](261005c-a-late-scroll-event-code-review-2.md)), and the last round. D1 (P1), fixed by
  it and kept: the highlight fix read the anchor but only re-measured on a scroll, so a jump to a
  block that is *already centred* — which leaves an anchor and moves nothing — kept the old row
  marked, and so did the hold ending without a scroll. `scroll.ts` now tells subscribers when the
  anchor is set or cleared (`subscribeArrivalAnchor`) and the hook schedules its usual frame. Two
  tests, red first. A side effect worth having: the mark no longer waits for a late scroll event.
  D2 (P3): the `url-state.md` clause put Structure's 40% line in a sentence about the line under the
  bars; reworded. Its diff was read, and grepped for attributed quotations: none.
- 2026-10-05: **gates.** `npm run typecheck` green. `npm test`, full: 1,609 files passed, 6 failed.
  Four are the fresh-worktree ones that want `npm run build` and `npm run build:fleet`
  (`cold-start-lazy-imports`, `pdf-bundle-trace`, `fleet-decisions-route`, `fleet-reports-route`),
  `fleet-composed-access` is the same missing `tools/fleet/web/dist` (its error is `ENOENT …
  dist/assets`), and the sixth was `structure-focus-row` caught while the reviewer had written D1's
  tests and not yet its fix. Re-run on the settled tree with the seven other scroll, bar and
  doc-link files: 8 files, 111 tests, green. Browser, after D1: six clicks of six again.

## Where this ended

**Finished.** `?at=` holds after a Structure click and the row clicked is the one marked, at
desktop, iPad and phone widths. Left for somebody else, and reported: the ↑ / ↓ chain timer in
`DiagramPanel.tsx` and `keynav.ts` (review finding C3), which is the same class in another feature.
