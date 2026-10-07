**Verdict: do not ship yet.** The input-preservation fixes are applied, but C2 remains. Nothing was committed.

- **C1 — P0; reproduced; fixed.** Input: add at the ceiling, then reload or leave Referee mode. The refused criterion’s text and configuration vanished. Ceiling-refused drafts now survive remounts and reloads in this tab’s session storage, keyed by reader and article. Acceptance or explicit deletion removes them; late responses cannot resurrect discarded drafts. Regression tests in [use-criteria-refusals.test.tsx](/var/tmp/spideryarn-worktrees/sweep7-criteria-trim-keeps-commented/tests/use-criteria-refusals.test.tsx) pass. Closing the tab or unavailable browser storage remains a preservation limit.

- **C2 — P1; reasoned; not fixed.** Input: an inherited list of **201 criteria**. The former trim spared pending rows, so this state was reachable; finishing those rows never trimmed them. The refusal falsely says the article has 200, and deleting one still leaves no room. Added a [Postgres characterization test](/var/tmp/spideryarn-worktrees/sweep7-criteria-trim-keeps-commented/tests/referee-routes-postgres.test.ts:699), **unrun**. The sentence remains unchanged as instructed.

- **C3 — P2; reasoned; not fixed.** Input: all 200 criteria have comments placed on them. “Delete one” omits the necessary step of clearing placements; every direct delete refuses. The existing commented-delete cases cover that underlying behavior, but were **unrun here**. The sentence is unchanged.

- **C4 — P2; reasoned; not fixed, as requested.** Input: more than 24 criteria sent to Mirror. It selects the **oldest 24**, ordered by `(createdAt, id)`, including pending and failed criteria. The panel reports how many were omitted, but does not disclose which 24 it chose. Existing Mirror UI tests pass.

- **C5 — P3; reasoned; fixed.** The new comments/docs claimed every counted row was visible and deletable while also describing hidden rows. Corrected those claims and the stale test comment saying SQL trimming remained. Current constraints prevent unreadable configurations through supported writes; raw counting remains unchanged. Both owner quotes match the supplied wording exactly.

The writer audit found no supported insert bypassing `begin`’s article lock and no add-triggered deletion. Resets and orphan sweeps update rows; export preserves them; public reading adds no writer. Explicit whole-article deletion still cascades criteria. Hidden rows require data outside current constraints; such rows would count without appearing, but no supported-write path produces them.

A genuine failed-row retry—matching id, text and current `error` status—resets before the ceiling check. Retry on a refused draft re-sends the add and receives the same refusal until room exists. It never reaches the paid criterion call while refused, and restoration makes no automatic POST.

The concurrent-add test can pass a lockless implementation if scheduling serializes requests. The new ceiling cases could also pass counting `existing.length` instead of raw rows because their fixtures are readable. The lock and sole supported insert path provide the ordering argument.

Files changed:

- [useCriteria.ts](/var/tmp/spideryarn-worktrees/sweep7-criteria-trim-keeps-commented/src/web/useCriteria.ts), new [criterion-refusal-drafts.ts](/var/tmp/spideryarn-worktrees/sweep7-criteria-trim-keeps-commented/src/web/criterion-refusal-drafts.ts), and the hook regression tests.
- [pg-referee-criteria.ts](/var/tmp/spideryarn-worktrees/sweep7-criteria-trim-keeps-commented/src/store/pg-referee-criteria.ts) and [referee-criteria-store.test.ts](/var/tmp/spideryarn-worktrees/sweep7-criteria-trim-keeps-commented/tests/referee-criteria-store.test.ts): comments only; plus the Postgres characterization test.
- [referee-mode.md](/var/tmp/spideryarn-worktrees/sweep7-criteria-trim-keeps-commented/docs/project/referee-mode.md), the [plan](/var/tmp/spideryarn-worktrees/sweep7-criteria-trim-keeps-commented/docs/plans/261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead.md), and a new [postmortem](/var/tmp/spideryarn-worktrees/sweep7-criteria-trim-keeps-commented/docs/postmortems/261007f-a-refused-row-on-screen-is-not-a-saved-draft.md).

Verification:

- Initial preservation reproduction: **3 failed, 15 passed**. Two late-deletion regressions each failed before their guards.
- Final unit/UI selection: **16 files, 262 passed, 0 failed**; includes **20 hook tests** and **224 Referee UI tests**.
- Documentation rerun: **18 passed**.
- Typecheck: **4 projects passed; all 3,374 source files covered**. Used the underlying script after the npm launcher hit sandbox IPC restrictions.
- Lint: **6 files; 0 errors, 0 warnings, 1 complexity advisory**. Whitespace check passed.
- Removed refusal references: **0 in source, tests and project docs**; historical plans retain their record. No remaining test asserts criterion drop-oldest.
- Postgres assertions: **0 run**. One mixed selection stopped during database setup; this is not a test failure. No `npm test`.