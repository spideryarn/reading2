Code review of commit e630f17a (the diff is in docs/plans/261001i-search-reliability-code-review.diff; `git diff origin/dev...HEAD` shows the same thing plus docs).

The plan is docs/plans/261001i-search-pending-rows-survive-the-trim-and-the-duplicate-guard-follows-a-renamed-run.md. It includes your plan review (docs/plans/261001i-search-reliability-plan-review-sol.md) and what was done about each finding. Check those claims against the code.

Changed: src/store/pg-searches.ts (the trim skips pending rows), src/searches.ts (withRun's trimRuns), src/routes.ts § search (searching.delete moved to the outer finally), src/web/useSearch.ts (the in-flight registry, `follow` on a renamed begin, running/isRunning, onRenamed, remove frees the question), src/web/modes/search/SearchMode.tsx (SearchBand uses the hook's registry; renameActive swaps ?runs=). Tests: tests/store-searches-pg.test.ts, tests/searches.test.ts, tests/use-search.test.ts, tests/search-parallel-finds.test.tsx.

Look especially for:
- any path where a request's in-flight entry is never removed (a wedged question), or removed for the wrong request (the `owner` symbol), including StrictMode double effects, a slug change, and remove() during a stream;
- `follow` ordering: the tombstone branch returns before renamed.current; whether a row deleted in the gap is still correctly handled when `done` arrives and when the stream ends silently;
- recolourLater being assigned during render; any stale-closure hazard;
- the trim's SQL and whether `ne(status, 'pending')` inside the DELETE behaves under READ COMMITTED with a concurrent finish;
- whether the moved searching.delete can now leak a key (an exception path that skips the outer finally);
- tests that cannot go red, or that pass for the wrong reason;
- the claims in the plan's "Plan review ... what was done" section and in docs/project/search.md.

You may fix what you find inside this change (workspace-write). Run the focused suites after any fix: `npx vitest run tests/store-searches-pg.test.ts tests/searches.test.ts tests/use-search.test.ts tests/search-parallel-finds.test.tsx` and `npm run typecheck`. Do not commit. Report: findings ranked P0-P3 with file:line, what you changed and why, anything wider for me to decide, and a verdict. Check the conclusion, not only the steps.
