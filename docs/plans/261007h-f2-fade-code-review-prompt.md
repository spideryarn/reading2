# Code review: 261007h F2 follow-up (Learn's padding; a fade where a bar has more)

**Candidate:** commit `2a7eacc0a` in worktree `/var/tmp/spideryarn-worktrees/fbrgq3f6-design-consistency`.
`git show 2a7eacc0a --stat`. Start with `src/web/useRevealChosen.ts`, `src/web/styles/mode-band.css`
(the fade rule and the part-switcher comment), `src/web/styles/quiz.css` (Learn's container query),
`tests/reveal-chosen-more.test.tsx`. Nobody else is editing the tree; a full `npm test` may be
running — do not start another.

**Why:** a designer's before/after review of F2 (plan
`docs/plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md`
§ What landed, F2) found Learn's bar padded 4px a side at every width, and, at 390 on touch, a part
wholly off the end of a bar with no cue (overlay scrollbars hide the thin scrollbar from your F2
review's K4). Your earlier caution: a permanent fade can cover a whole chip or its focus ring.

## What to do

You may write. Fix inside this commit's scope, narrowly and red-first; report anything wider. Do
not commit. Findings to the answer file first, then fixes, then update it.

1. `useRevealChosen`: the new passive scroll listener, `markMore`, `revealButton` (focus reveal) and
   the 1.25rem stop short of an edge — any loop (reveal → scroll → mark → resize?), leak on
   unmount, wrong mark at sub-pixel scroll positions or zoom, RTL, a bar that becomes fitting after
   a resize (marks removed?). Does OrderGroup still behave as before where nothing overflows?
2. The mask: only while there is more; never at 1440; does it ever cover the focus ring of a
   focused part or make the chosen part unreadable? Browsers without `mask-image` (prefixed?).
3. Learn's `@container learn-head (max-width: 19rem)`: is `.band-head:has(> .learn-submode)` a
   safe container (container-type `inline-size` changes sizing of its own box — any layout change
   at other widths)? Browsers without container queries fall back to what?
4. Run `npx vitest run tests/reveal-chosen-more.test.tsx tests/order-group.test.tsx tests/learn-submode-four-chips.test.ts tests/part-switchers-share-one-bar.test.ts tests/arrows-belong-to-the-article.test.tsx tests/skim-panel.test.tsx`.

## Severity

P0 data loss / security / charging / broadly unusable · P1 user-visible wrong behaviour or a
contract violated · P2 design or maintainability risk · P3 prose. IDs `N1`, `N2`, …. Refuse only
on an established P0 or P1.

End with `VERDICT: ready` / `VERDICT: ready with these fixes` / `VERDICT: not ready`, and a list of
files you changed.
