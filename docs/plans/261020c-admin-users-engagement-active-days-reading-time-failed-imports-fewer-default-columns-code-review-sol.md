# Code review: `/admin/users` engagement

Reviewed commit `851e8c8bc` against its plan and plan-review decisions.

## Findings

1. **P2 — Reading time rounds away stored fractions while calling the result exact.**
   `ReadingTime` uses `Math.round(user.readingSeconds)` in its detail text, but the reading-time
   route deliberately accepts fractional seconds (for example, `6.5`) and Postgres preserves them.
   The cell can remain minute-sized, but its detail should report the total it was actually handed.

2. **P2 — `useHiddenColumns` makes its setter depend on the keys object's identity.**
   The reusable hook reads two string keys but includes the containing object in `useCallback`'s
   dependencies. An otherwise equivalent object literal therefore creates a new controlled-state
   setter on every render, contrary to this hook's identity guarantee and uncomfortably close to
   the unstable-input half of the shelf render loop. The two current callers happen to pass module
   constants; the generalized hook should depend on the key strings it uses, not require callers
   to preserve an irrelevant object identity.

3. **P2 — The new tests can stay green after several load-bearing regressions.**
   The SQL test does not assert the site-account exclusion and counts shelf predicates without
   tying them to the comments and latest-open branches. The store test exercises the reading
   aggregate only through `mergeUsers`'s fallback zero, so a missing query row or broken numeric
   mapper still passes. The page test says a hidden column is behind the Columns menu but never
   operates that menu, despite the plan's Checks section claiming it does. These need direct
   witnesses: exact source branches and site predicate in generated SQL, a seeded non-zero
   fractional reading total through the real driver, and revealing one default-hidden admin
   column.

4. **P3 — Several comments and one user-facing sentence contradict the implemented contract.**
   `ActivityTally.days30` describes only a lower bound although the query now has the reviewed
   upper bound; `AdminUser.recentImportFailures` still says “how serious” after the plan rejected
   severity; `AdminImportFailure.at` calls the `recorded_at` fallback an ending time; and
   `pg-admin.ts` still describes the pre-engagement number of queries. The failure card's final
   sentence says “The address and the error:” immediately before a command, where the plan says
   “Details:”. The plan also retains one later claim that failures are classified by severity,
   contradicting its own revised design.

## Verification

- `npx vitest run tests/admin-queries.test.ts tests/admin-store.test.ts
  tests/admin-users-merge.test.ts tests/admin-page.test.tsx
  tests/shelf-table-hide-columns.test.tsx`: the four runnable files passed, **94 tests**. The
  shared-services file could not collect because this sandbox refused its loopback Postgres
  connection with `connect EPERM 127.0.0.1:54362`; that is an environment failure, not a skipped or
  failing assertion. Running the same four files without `admin-store.test.ts` passed 94/94.
- `npm run typecheck`: the `tsx` launcher was refused permission to open its IPC socket
  (`listen EPERM /tmp/tsx-1000/14.pipe`) before the typecheck script started. Running that same
  checked-in script without the launcher IPC, `node --import tsx scripts/typecheck.ts`, passed all
  four projects and confirmed all 3,849 TypeScript source files are covered.
- `npx biome lint --max-diagnostics=none` on the nine touched TypeScript/TSX files: passed.
- `git diff --check`: passed.
- `npm test`: could not initialize its database lanes for the same sandbox restriction
  (`connect EPERM 127.0.0.1:54362`; the Docker discovery fallback was also unavailable), so the
  runner stopped in global setup before collecting the full suite.

## Changes made

- Preserved fractional reading seconds in the detail text and added a page-level regression test.
- Made `useHiddenColumns` depend on the two key strings rather than the keys object, and added an
  identity regression test that rebuilds an equivalent object.
- Strengthened the generated-SQL tests to pin all four activity sources, both halves of
  `onTheShelf()`, and the site-account exclusion.
- Extended the live-store fixture with a published scratch article and a non-zero, fractional
  reading-time total, so the real aggregate and timestamp/number mappers—not fallback values—are
  exercised when the shared-services lane can reach Postgres.
- Made the admin-page test actually open Columns, reveal Archived, and verify that choice is stored
  under the admin key.
- Corrected the closed-window, failure-kind, fallback-time and query-count comments; changed the
  failure card's command lead-in to “Details:”; and corrected the plan's leftover “severity” claim.
- Left the query implementation unchanged: its union alias, UTC arithmetic, closed range,
  per-owner windows and cap, shelf predicates, site filter and Drizzle timestamp mappers are
  consistent with the plan. No reader-content field was found on the wire.

## Wider decisions left to Greg

- None introduced by this review. The two choices already named in the plan remain: recording
  `reader_days` would make Active days exact but needs the stated privacy decision, and the
  pointer-only phone access to the rich cell cards remains the explicitly accepted half of plan
  review finding 5. I did not widen either one here.
