# Code review: 261009r — a Search list formats only the rows a reader can see

You are reviewing CODE in this worktree, and you may fix what you find **inside this change**
(src/web/when-seen.ts, src/web/Excerpt.tsx, the `lazy` on SearchPanel.tsx § Hit,
tests/search-excerpt-lazy.test.tsx, and the docs this change touches). Report anything wider for me
to decide rather than fixing it. Do not commit; do not run git commands that change the index or
the working tree beyond editing files.

Read first:

- docs/plans/261009r-excerpts-measured-in-chrome-search-list-stall.md (the plan, with the measurements and your plan review folded in)
- docs/plans/261009r-excerpts-measured-in-chrome-search-list-stall-plan-review-sol.md (your plan review)
- docs/plans/261009r-excerpts-measured-in-chrome-search-list-stall-code-review.diff (tracked changes) plus the new files: src/web/when-seen.ts, tests/search-excerpt-lazy.test.tsx, docs/postmortems/261009l-a-freeze-measured-without-a-baseline-is-never-attributed.md
- src/web/excerpt-html.ts and src/web/reveal-once.ts for context

Check in particular:

1. `useSeenOnce`: the effect's lifecycle (StrictMode mount–unmount–mount, a ref whose element
   changes, unmount before intersection, the shared observer outliving every row), the
   `madeWith` remake, the try/catch fallback, and whether `seen || !watch` is right when `enabled`
   flips from false to true or back.
2. `BlockExcerpt`: hooks are called unconditionally, the `useMemo` deps, and whether the waiting
   `<span>` (no class) and the formatted output differ in a way that matters to layout, selection, or
   tests elsewhere (grep for `.srch-hit-quote` and `.excerpt` in tests and styles).
3. Whether the measurements and claims in the plan, postmortem, maths.md and performance.md are
   supported by what was measured. Point out any overclaim.
4. Anything that would make a reader see an unformatted row stuck forever (e.g. a row inside a
   container that never intersects, a band hidden by `display:none` then shown).

Gates you can run: `npx vitest run tests/search-excerpt-lazy.test.tsx tests/search-hit-card-on-the-score.test.tsx tests/quick-search-panel.test.tsx tests/excerpt-html.test.ts`, `npm run typecheck`.

Write findings (F1, F2, …) with severity, what you changed for each (or why not), then a verdict:
ship / ship after my fixes / do not ship.
