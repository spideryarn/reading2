# Code review, round 2 (narrow): the CR-1 fix in Tooltip.tsx (261003p)

Read-only in effect: fix only if you find an established P0 or P1 in the scope below; otherwise
report. Discovery on the rest of the change is closed.

**Candidate (committed).** Commit `1ef091766` (`git show 1ef091766 -- src/web/Tooltip.tsx
tests/search-hit-card-on-the-score.test.tsx tests/band-about.test.tsx docs/project/tooltips.md`).
The `Tooltip.tsx`, test and tooltips.md changes in it were written by the round-one reviewer (a GPT
Sol run), so they are **unreviewed code by someone else**: treat them as you would anyone's. Round
one is `docs/plans/261003p-search-results-room-code-review-sol.md`; the plan is
`docs/plans/261003p-search-results-get-the-room-on-a-landscape-ipad.md`.

**The statement to check, at its true strength:** *"For a controlled `Tooltip`, a close whose reason
is `hover` is dropped only while the card that is open was opened after a touch or pen
`pointerdown` on its trigger and no real mouse has since entered or left the trigger or entered the
card. Every other close (Escape, outside press, the parent, focus leaving) is unaffected, and
uncontrolled tooltips are unaffected."* Is that statement accurate of the code? Name a concrete
event sequence if not.

Also: do the new `onPointerEnter`/`onPointerLeave`/`onPointerCancel` handlers passed through
`getReferenceProps` and `getFloatingProps` compose with Floating UI's own handlers and the child's
(called once each, none dropped)? Does the `useEffect` on `open` clear the flag at a moment that
could lose a tap (the flag is set on `pointerdown` while the card is still closed, and the click
that opens it comes after)?

Run `npx vitest run tests/search-hit-card-on-the-score.test.tsx tests/band-about.test.tsx`.

Measured after this commit, Chrome with touch on, which you cannot run: a tap holds the gutter card
open at 500ms and 2s (`pointerdown, touchstart, pointerleave, mousedown, focus, click,
aria-expanded=true, mouseleave`, no close); it closes on a tap in the prose, Escape, and a tap on
another row's gutter; a real mouse moved on and off after a tap closes it; mouse-only hover and
click behave as before; the band's (i) and the spine's reveal-then-commit are unchanged.

Severity by consequence: P0 data loss, security, charging, broadly unusable; P1 user-visible wrong
behaviour or a contract violated; P2 design risk; P3 prose. Continue the IDs from `CR-3`.

End with one line: `VERDICT: land`, `VERDICT: land with the fixes I made`, or `VERDICT: refuse`,
then findings by ID and any files you changed.
