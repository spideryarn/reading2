Code review of commit 1d051ef43 in this worktree (`git show 1d051ef43`), which adds a "date" order to
Citations mode, per the plan docs/plans/261002j-citations-sort-by-publication-year.md (and your own plan
review beside it, -plan-review-sol.md).

Files: src/web/CitationsPanel.tsx (publicationYear, effectiveOrder, orderWorks, orderOptions),
src/web/params.ts (CITE_ORDERS), tests/citations-panel.test.tsx (describe "the date order"),
docs/project/citations.md, docs/project/url-state.md.

Look for correctness bugs, anything that reads CITE_ORDERS / CiteOrder elsewhere and now misbehaves
(grep the repo), visitor vs owner differences, docs that now say something false (e.g. a count of
orders), and tests that could not go red. You may FIX what you find inside this scope (edit files;
do not commit, do not touch git state). Run `npx vitest run tests/citations-panel.test.tsx` and
`npm run typecheck` after any edit. Report anything wider for me to decide.

Reply: numbered findings with severity (P0-P3), file:line, what you changed (or "not changed, why"),
then the test/typecheck results. Also say plainly whether the change does what the report asked:
"In Citations mode, add a `sort` option for publication-date."
