# Key — P04: the Citations band's header row overflows a 375px phone

Lesson (261001e): **measure which element is past the edge before believing the report**, fix the
wrap rule in CSS, pin it with a real-Chrome test plus a control. Below 700px the band covers the
prose (`src/web/layout.ts` § `bandCoversProse`).

## Docs it must read
- MUST `docs/project/narrow-windows.md` § "Narrow windows: wrap, do not shrink" (a row of things
  whose widths you do not control must wrap; what cannot reflow scrolls in its own box; the console
  check `scrollWidth - clientWidth` must be 0), § "The reading view's narrow window, which is a
  different problem", § "What a control owes a finger" (do not shrink targets to fit).
- MUST `docs/plans/261001e-masthead-facts-line-overflows-a-phone.md` — the method (injection
  table), the class ("inline items made `nowrap` individually leave no wrap opportunity"), the test.
- MUST `docs/project/browser-testing.md` § "A phone-width window does not exist, so use an iframe"
  and `docs/project/browser-control.md` (Playwright on the box).
- USEFUL `docs/project/design-css-overview.md` § "Which mechanism owns what" and § "The stylesheets,
  in load order"; `docs/project/citations.md` § "The orders, and the bar"; `docs/project/icons.md`
  (icon + tooltip for a crowded row: `docs/plans/260930h-tweets-band-fits-ipad-and-copy-buttons-become-icons.md`).

## Existing code it must reuse
- `src/web/ModeSurface.tsx` § `head` → `.band-head`; `src/web/styles/mode-band.css` § `.band-head`
  (deliberately **no `flex-wrap`**; its children shrink — `min-width: 0` on the flexible item).
- `src/web/styles/glossary.css` § `.gloss-sort`, `.gloss-sort-group`, `.gloss-sort-trail` — the
  shared, already-wrapping order row Citations borrows (`CitationsPanel.tsx` § the sort bar,
  § `BarSlider` using `.gloss-gate-row`). Trap: a Citations-only copy of these rules, or a media query
  where the shared row should wrap for every mode that uses it (Glossary, FAQ, Debate).
- `tests/masthead-facts-wrap-in-chrome.test.tsx` (after `tests/mark-sign-in-chrome.test.ts`) — the
  real-Chrome pattern: render the real component, inline the real stylesheets, assert
  `scrollWidth <= 375`, plus a control proving the fixture still overflows with the old rule.

## Code files it would edit
`src/web/styles/citations.css`, or shared `glossary.css` / `mode-band.css` (whoever owns the rule),
maybe `src/web/CitationsPanel.tsx`; a new `tests/citations-head-wraps-in-chrome.test.tsx`.

## Project rules that apply
- Reproduce with a failing test first, watched red (CLAUDE.md); jsdom cannot measure layout, so the
  test runs in Chrome (`docs/project/browser-testing.md`).
- Browser sweep in a Sonnet subagent, conclusions not page dumps; kill only its own server PID.
- Plan doc, GPT Sol plan and code reviews; lint touched files. Shared CSS is checked in every mode using it.

## Traps
- The culprit may not be the header: 261001f blamed figures, and it was the masthead's facts line
  (261001e). Find it by injection (`display:none` on suspects), not by reading.
- `nowrap` on each item plus no whitespace between them makes the whole run unbreakable;
  `inline-block` gives wrap points and keeps items whole (261001e § The fix).
- `.band-head` cannot gain a line, so wrapping there needs a different home (`diagram-drift.css`
  comment); `overflow-x: clip` hides the symptom and the next overflow (261001e § passed over).
- A fallback font can make a run fit and the test pass falsely; keep the control (261001e § Test).
  And do not trade target size for width (narrow-windows.md § "What a control owes a finger").
