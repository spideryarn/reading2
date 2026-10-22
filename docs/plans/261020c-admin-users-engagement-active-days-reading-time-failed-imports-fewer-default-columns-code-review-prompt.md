You are reviewing code in the Spideryarn repo (this worktree), and you may fix what you find. Read the
plan docs/plans/261020c-admin-users-engagement-active-days-reading-time-failed-imports-fewer-default-columns.md
(including its Reviews section, which records which of your plan-review findings were taken and why
one was half-taken), then the diff: `git show 851e8c8bc` (one commit on top of b6e5f0269).

Files: src/store/pg-admin.ts (activitySources, adminQueries.activity/reading/failures, mergeUsers),
src/admin.ts (AdminUser engagement fields, failureKindLabel, formatReadingTime, AdminImportFailure),
src/web/admin-columns.tsx (ActiveDays, ReadingTime, ImportFailures, startsHidden), src/web/AdminPage.tsx
(useHiddenColumns, ColumnsMenu), src/web/shelf-hidden-columns.ts (the hook now takes keys), and the tests
tests/admin-queries.test.ts, tests/admin-store.test.ts, tests/admin-users-merge.test.ts,
tests/admin-page.test.tsx, tests/shelf-table-hide-columns.test.tsx.

Look for: SQL that means something other than the comment says (the union's column naming, the UTC
date arithmetic, the closed 30-day window, the window functions and cap, onTheShelf on each branch, the
site-account filter); drizzle mappers (mapWith on max/coalesce of timestamps — do they return real Dates
and ISO strings through the driver?); anything on the wire that names what a reader read (slug, URL,
filename, error sentence); the hidden-columns refactor changing the shelf's behaviour; the useHiddenColumns
setter's dependency on `keys` identity; render loops (docs/postmortems/260827e-shelf-render-loop.md);
screen-reader text making table cells or sorting worse; tests that would pass on broken code; stale or
wrong comments and docs (docs/project/admin.md § Engagement).

Write your findings first to
docs/plans/261020c-admin-users-engagement-active-days-reading-time-failed-imports-fewer-default-columns-code-review-sol.md
as numbered items with severity (P0-P3). Then fix what is clearly right inside these files, and list at the
end of that file exactly what you changed and anything wider you left for me to decide. Run
`npx vitest run tests/admin-queries.test.ts tests/admin-store.test.ts tests/admin-users-merge.test.ts
tests/admin-page.test.tsx tests/shelf-table-hide-columns.test.tsx` and `npm run typecheck` after your
fixes and report the results. Do not commit.
