# Code review: Search results get the room on a landscape iPad (261003p)

You are the reviewer and the fixer. Sandbox is workspace-write, in this worktree only.

**Candidate (committed).** Exactly one commit, `d85598ac2`. See it with `git show d85598ac2 --stat`
and `git show d85598ac2 -- <path>`. Do not use a merge-base range: this branch has merged `dev`.
Changed paths:

- `src/web/SearchPanel.tsx` (the `Legend` component and its call deleted; `ConfSlider` prints
  `.srch-gate-note` only when `hiddenCount > 0`)
- `src/web/styles/search.css` (`.srch-legend*`, `.srch-swatches` deleted; `.srch-saved-wrap`
  `max-height: max(25%, 7.5rem)`, was `40%`)
- `src/web/Tooltip.tsx` (`byTouch`: a controlled card drops a `hover` close when the last press on
  its trigger was a finger or a pen)
- `tests/search-results-get-the-room.test.tsx` (new), `tests/search-hit-card-on-the-score.test.tsx`,
  `tests/glossary-band-wiring.test.ts`, `tests/mode-surface-changes-no-markup.test.tsx`
- `docs/project/search.md`, `docs/project/tooltips.md`
- `docs/plans/261003p-search-results-get-the-room-on-a-landscape-ipad.md` (the plan: read it first;
  it has the product owner's words, the measurements, and your own plan review's findings PR-1 to
  PR-6 with what was done about each)

Start there; it does not limit scope. In particular read every caller of `Tooltip` that passes
`open=`/`onOpenChange=` (the controlled ones): `grep -rn "onOpenChange" src/web`. The `Tooltip`
change reaches all of them, not only Search: the spine's reveal-then-commit (`Spine.tsx`,
`docs/project/touch.md`), the band's (i) (`BandAbout.tsx`), the quotes row's (i), Referee's
*How to read this*, and any other.

**What the product owner asked for** is quoted at the top of the plan. He decides the product: the
legend and the nothing-hidden line going are not up for review. Whether the code does what the plan
says, and breaks nothing else, is.

**Independent pass first.** Attack it:

- Is each claim in the changed docs and comments true of the code as committed?
- `Tooltip.tsx § byTouch`: is there a controlled card anywhere that now fails to close when it
  should, or a sequence (touch then mouse on a hybrid device, a pen, a keyboard-opened card, a
  trigger that is replaced while open, a disabled trigger) where the ref is stale and the wrong
  thing happens? Does chaining `onPointerDown` through `getReferenceProps` double-call or drop the
  child's own handler? Does it interfere with Floating UI's own `onPointerDown` in `useHover`?
- The CSS: does `max(25%, 7.5rem)` do anything unintended where the panel is a different shape
  (`src/web/styles/narrow-window.css`, a visitor's read-only panel, an empty saved list)?
- Did deleting `Legend` leave anything dangling (an unused import, a CSS rule, a doc or comment
  that still says there is a legend)?
- Are the tests able to fail? Each new arm was seen red before the change except the two that pin
  kept behaviour.

**Run tests yourself** where they need nothing outside the tree (these are jsdom, no network):
`npx vitest run tests/search-results-get-the-room.test.tsx tests/search-hit-card-on-the-score.test.tsx tests/glossary-band-wiring.test.ts tests/mode-surface-changes-no-markup.test.tsx`.
Anything touching Postgres or a local service you cannot run; say what you skipped rather than
assuming it passes. I ran, green: those four files, `npm run typecheck`, and
`npx vitest run tests/tooltip tests/spine tests/band-about tests/referee tests/quotes` (61 files,
1032 tests). The full suite is running separately.

**Evidence you cannot reproduce, handed over as measured** (Chrome with touch on, Playwright, the
plan's § Progress has the tables): before the `Tooltip` change a tap on `button.srch-gutter` gave
`pointerdown 33, touchstart 34, pointerleave 102, mousedown 115, focus 115, click 117,
aria-expanded=true 208, mouseleave 220, aria-expanded=false 230` (ms); the band's (i), which passes
`interactive`, stayed open under the same taps. WebKit with touch was not available, so nothing is
known about Safari on a real iPad.

**Fix what you find inside this change**, narrowly, with a failing test first where it is
behaviour. **Report, do not fix,** anything wider you notice. Do not commit; leave your edits in
the working tree and list every file you touched.

**Severity (by consequence):** P0 data loss, exploitable security, incorrect charging, service
broadly unusable. P1 user-visible wrong behaviour, or an authoritative contract violated. P2 design
or maintainability risk with no wrong behaviour today. P3 non-behavioural prose or comment defect.
Refuse only on an *established* P0 or P1 (direct evidence, no unresolved material inference).
Number findings `CR-1`, `CR-2`, … (the plan review used `PR-`).

**My own suspicions, last, and worth less than your pass:**

- `byTouch` is set on `pointerdown` and never cleared except by the next `pointerdown`. A card
  opened by a tap, then a real mouse hovering in and out of the same trigger with no press: the
  hover-close is dropped until the mouse presses. Is that reachable enough to matter, and is there
  a smaller rule (clear it when the card closes) that is better?
- The conclusion itself: *"a tap now holds the card open, so removing the legend loses nothing on a
  touch screen."* Is that sound given what was and was not measured?

End with one line: `VERDICT: land`, `VERDICT: land with the fixes I made`, or `VERDICT: refuse`,
then the findings by ID and the list of files you changed.
