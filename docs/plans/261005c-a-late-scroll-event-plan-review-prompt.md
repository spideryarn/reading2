# Plan review: 261005c — a late scroll event of our own ends a centred arrival

You are reviewing a **plan**, read-only. Do not edit any file.

## The candidate

- Base: `93620b647` (origin/dev). The plan is untracked:
  `docs/plans/261005c-a-late-scroll-event-of-our-own-ends-a-centred-arrival-and-rewrites-at.md`.
- No code has changed yet. The code it proposes to change: `src/web/scroll.ts` (`markOurScroll`,
  `quietUntil`, `ourScrollY`, `moveWindow`, `cancel`, `glide`, `scrollToTop`, `holdAnchor`,
  `onScrollWhileAnchored`, `watchBarVisibility § apply`). Its readers:
  `src/web/reader/useReadingPosition.ts`, `src/web/position.ts § positionToWrite`,
  `src/web/keynav.ts`. Tests: `tests/scroll-settlement.test.ts`, `tests/scroll-glide.test.ts`,
  `tests/bar-visibility.test.ts`, `tests/mobile-chrome.test.ts`. This list is where to start, not a
  limit.
- Doc: `docs/project/url-state.md` § "A jump lands centred, and holds the position until you move".

## What to do

Make your own pass first. Is the diagnosis right, and is "the pixel decides, and the clock is
deleted" correct for every caller of the things it touches? Try to construct a sequence of events —
glide frames, `scrollTo`, scroll events (which a browser dispatches at most once per frame, before
animation-frame callbacks, reporting the current `scrollY`), wheel/touch, instant moves
(`behavior: "auto"`, reduced motion), `scrollToTop`, a second jump starting mid-glide, a jump whose
destination is the pixel the page is already at, browser clamping at the end of the page, fractional
`scrollY` on a high-DPI screen — in which the proposed rule gives a wrong answer the current code
does not, for (a) the arrival anchor and (b) the controls bar hiding and revealing. You may run
`npx vitest run tests/scroll-settlement.test.ts tests/bar-visibility.test.ts` (they need nothing
outside the tree).

Severity, by consequence: **P0** data loss, security, charging, service unusable · **P1**
user-visible wrong behaviour or an authoritative contract violated · **P2** design or
maintainability risk with no wrong behaviour today · **P3** prose. Give every finding an id
(`F1`, `F2`, …), the severity, the evidence (file:line, or a test you ran), and what you would do
instead. End with a verdict line: `VERDICT: approve` / `approve with changes` / `rework`, which
takes at least one P0 or P1 to be anything but approve.

## My own suspicions (already mine; worth less than yours — spend most of the run elsewhere)

- Whether deleting the clock for the bar (stage 2) loses a protection during the glide's *middle*
  frames, where the bar's own animation frame may run before or after the glide's tick.
- Whether a never-expiring `ourScrollY` can mis-attribute a reader's scroll in a way that matters.
- Whether the larger option passed over (judging the anchor by the row's viewport position) should
  have been taken instead.
