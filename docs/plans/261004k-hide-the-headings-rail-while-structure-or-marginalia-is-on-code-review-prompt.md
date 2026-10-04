You are reviewing one small stage of work in the Spideryarn repo (this worktree), and you may fix
what you find inside it.

The plan: docs/plans/261004k-hide-the-headings-rail-while-structure-or-marginalia-is-on.md
Your own plan review: docs/plans/261004k-hide-the-headings-rail-while-structure-or-marginalia-is-on-plan-review-sol.md

The change is the last commit on this branch (`git show HEAD`, `git diff HEAD~1 HEAD`):
- src/web/reader/Reader.tsx: `showCrumbs` gains `mode !== "structure"` and `!marginRoom`;
  `marginRoom` moved up from where it was declared.
- tests/headings-crumbs-wiring.test.tsx: five new cases under "steps aside for Structure and for
  Marginalia's head".
- docs/project/experimental-features.md, docs/project/marginalia.md: one sentence each.

Evidence, raw:
- Before the Reader.tsx change, the new tests: 3 failed (both Structure cases and wide Marginalia),
  the Summary control and the narrow-Marginalia case passed.
- After: `npx vitest run tests/headings-crumbs-wiring.test.tsx` 12 passed; `npm run typecheck` all
  four projects ✓.
- A browser table is in the plan § What landed.

Run `npx vitest run tests/headings-crumbs-wiring.test.tsx` yourself (jsdom, nothing outside the
tree). Do not run the full suite.

Rules for fixes: fix what is inside this stage, narrowly, red-first where it is a behaviour. Report,
do not fix, anything wider you noticed. Do not write any sentence attributed to Greg, and do not
add or alter a blockquote of his words. Do not commit.

What I most want checked:
1. Is every use of `marginRoom` between its old and new declaration sites still correct (it is now
   declared hundreds of lines earlier; anything shadowing it, or reading it before `fit`)?
2. Does any other code assume a bar exists whenever `experimental.on` (scroll.ts, crumbs.css,
   narrow-window.css, tooltips, keyboard, the mode herald, tests elsewhere that open
   `?mode=structure` or `?margin=1` with the switch on and expect `.controls`)?
3. Can the new tests go red for the right reason? In particular the wide-Marginalia case mutates
   the shared `TREE` fixture's `n1.range` inside try/finally: is that safe for the other cases?
4. Are the two doc sentences accurate against the code?
5. Is my conclusion right that nothing needs a queue entry: the empty-head gap, the contained
   failure and the alias one-frame flash are named in the plan as known and left?

Give findings as P0/P1/P2, each with an ID and file:line evidence, say for each whether you fixed
it, and end with one line: `VERDICT: approve`, `VERDICT: approve with changes`, or `VERDICT: rework`.
