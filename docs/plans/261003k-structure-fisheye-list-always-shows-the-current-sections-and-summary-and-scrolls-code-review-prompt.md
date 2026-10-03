# Code review: 261003k, Structure's fisheye list keeps the current sections and summary, and scrolls

You are reviewing the code built from a plan, in a worktree, with `--sandbox workspace-write`.
**Fix what you find inside this change's scope**: `src/web/OutlinePanel.tsx`,
`src/web/outline.ts`, `src/web/styles/outline-mode.css`, `tests/outline-panel.test.tsx`,
`tests/mode-surface-changes-no-markup.test.tsx` § `OUTLINE`, the Structure paragraph in
`src/web/help/help-modes.tsx`, `docs/project/structure.md`, and the plan. Each fix red-first, with
the test that reproduces it. Report anything wider for me to decide rather than fixing it. Do not
commit and do not touch git state. A browser check is running separately against this worktree's
dev server, so do not start or stop a dev server.

Read first:

- `docs/plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md`,
  the plan, revised after your plan review (§ GPT Sol's plan review says what was taken and what
  was deferred, and why)
- `docs/plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls-plan-review-sol.md`
- `docs/plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls-code-review.diff`,
  the scoped diff (commit `d31a1e6a7`, less the plan files)

You can run `npx vitest run tests/outline-panel.test.tsx` and the other single test files, and
`npm run typecheck`.

What I would look hardest at:

1. The fit in `measure` (`FLOOR`, `best`, `scroll`). Is there any state in which the visible list
   overflows the band without `data-outline-scroll="1"`, or scrolls when rung 3 fits? Any
   measure → setState → re-measure loop now that `scrolls` changes the visible list's box (flex,
   padding-bottom, a classic scrollbar's width) but not the hidden copies'?
2. The follow effect, now shared by Expanded and the fisheye at its floor. The block-in-view
   branch (`if (!expanded)`), the clamp on "a third down", and the dependency list. Does it run
   when it should (a new section, a new part, `scroll` turning on) and only then? Is Expanded's
   behaviour unchanged apart from the F2 fix?
3. Home/End's reveal in `step`. `ownerDocument.getElementById` rather than a query inside the
   list: is that safe (the hidden copies carry no ids)?
4. The removed clamp: anything left that reads `.clamp`, `data-outline-clamp` or `listClass`?
5. The stylesheet rule `.mode-band.outln[data-outline-scroll="1"] > .outln-list`: is the list a
   direct child of the band in every case (`ModeSurface`, `TooltipGroup`)? Does Expanded still
   scroll through it? `overscroll-behavior: contain` is new: any harm?
6. The tests: can each new one go red? Mutate and see. jsdom does no layout, so say which claims
   remain for the browser.
7. The comments and docs I changed: is any sentence now false? In particular the ones that used to
   say the list never scrolls, and `outline.ts`'s rung table.

Give findings as P0/P1/P2 with file:line references, say which you fixed and which you left for
me, and end with a one-line verdict.
