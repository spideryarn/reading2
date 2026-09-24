# Plan review: 260924c — iPad first tap on the rail shows the card

You are reviewing a **plan**, read-only. Repository: this worktree, base commit `3ddb24dc`
(uncommitted work only). Other agents are editing other files in this tree; ignore them.

## Candidate

- Untracked: `docs/plans/260924c-ipad-first-tap-on-the-rail-shows-the-card.md` (the plan — read it first).
- No code changed yet. Start with `src/web/Spine.tsx` (`bandPress`, the band `onClick` near line 1103,
  the `<aside>` near line 760), `src/web/useHoverCard.ts` (`pointerDown`, `clickPress`, `clicked`,
  `swallowed`, `pointerUp`), `src/web/BlockGutter.tsx` § `onCopy`, `src/web/ShelfEntry.tsx`
  § `fingerPress`, `src/web/Tooltip.tsx` (`mouseOnly`), tests `tests/spine-hover.test.tsx`,
  `tests/spine-tap.test.ts`, `tests/link-tap-escapes.test.tsx`. The reading list does not limit scope.
- Context: `docs/plans/260915b-shelf-actions-reachable-on-touch.md` § "Wider, and not fixed here",
  `docs/plans/260915a-ipad-link-taps-that-escape-the-link-card.md`, `docs/project/touch.md`.

## What to attack

1. Is the diagnosis right — does WebKit bug 282988 (finger click on iOS 18.2+ reports
   `pointerType: "mouse"` while pointerdown says `touch`) make the spine's first tap jump?
2. Is the plan's claim that `useHoverCard.ts` § `clickPress` already handles a mislabelled click —
   for links AND for glossary terms (bare, and inside links) — actually true? Trace it; this is the
   claim I would least like to be wrong about.
3. Is BlockGutter's reading harmless as claimed?
4. Does the proposed `gesturePointerType` + rail-level pointerdown ref get every sequence right: a
   finger tap, a second tap, touch adjustment onto a neighbouring band, a scroll starting on the rail
   (pointercancel), a finger press with no click followed by a keyboard Enter, a real mouse on a
   hybrid device, a pen, React's event delegation and Floating UI's handlers on the band button?
   Is "no timer" safe?
5. Anything simpler or more robust.

## Severity and form

P0 data loss/security/charging/unusable; P1 user-visible wrong behaviour or contract violated;
P2 design/maintainability risk; P3 prose. Refuse only on an established P0/P1 (direct evidence, no
unresolved material inference). Give each finding an ID (F1, F2, ...), a severity, the evidence
(file:line), and a suggested change. End with a one-line verdict.

## My own suspicions (worth less; spend most of the run elsewhere)

- Whether some iOS versions deliver the click to a different element than the pointerdown such that
  the `<aside>` never sees the pointerdown.
- Whether consuming the ref at click could break a double-click / fast second tap.
