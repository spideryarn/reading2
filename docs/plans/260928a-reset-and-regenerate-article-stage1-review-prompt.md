# Code review, stage 1: reset an article (plan 260928a)

You are the reviewer **and fixer** for this stage. Repo root is the current directory (a worktree).
Candidate: commit `8dd40eb9` on top of `e4f7129f`. Diff: `git diff e4f7129f 8dd40eb9`. Changed
paths: `git diff --name-only e4f7129f 8dd40eb9` (start with `src/store/pg-revisions.ts`,
`src/store/pg-successor.ts`, `src/reset.ts`, `src/jobs.ts`, `src/store/jobs.ts`, `src/routes.ts`,
`tests/reset-and-regenerate.test.ts`; that list does not limit scope). The spec is
`docs/plans/260928a-reset-and-regenerate-article.md`; the two plan reviews beside it
(`-review-sol.md`, `-review-sol-r2.md`) are your own earlier findings F1–F7.

## What to do
1. An independent attack on the code. Does it do what the plan says? Can a reset lose or detach
   reader data beyond what the plan names? Can it charge a billing slot? Can the regeneration be
   lost, duplicated, run before the reset, or run out of order? Does anything change behaviour for
   jobs that are not resets (work keys, the labels successor, `fenceJob` callers, `publicJob`)?
   Is the route owner-scoped and does it leak the profile?
2. **A narrow check of two fixes whose final form you have not seen**: F1 (reset-scoped successor
   work key, including the `boundToOlderBase` case) and F6 (explicit increasing `created_at` via
   `after`). Is `now() + i µs` sound against the claim order in `src/store/pg-jobs.ts`, including
   against jobs inserted by other transactions?
3. **Fix what is inside this stage**, narrowly and red-first: write or adjust a test that fails,
   then fix. **Report, do not fix**, anything wider. Do not commit. Do not touch the database.

Your sandbox has no network, so Postgres-backed tests cannot run there. I ran them; the raw output
of the stage's gate run is `docs/plans/260928a-reset-and-regenerate-article-stage1-tests.log`
(8 files, 497 tests, exit 0; `npm run typecheck` exit 0). Tests that need nothing outside the
tree (e.g. `tests/jobs.test.ts` hashing tests, `tests/authenticated-api-route-contract.test.ts`)
you may run yourself with `npx vitest run <file>`. If a fix of yours needs a Postgres test, write
it and tell me to run it.

Severity: P0 data loss/security/charging/unusable; P1 user-visible wrong behaviour or contract
violated; P2 design risk; P3 prose. Refuse only on an established P0/P1 with file:line evidence.
IDs: continue from F8. For each finding say whether you fixed it (and which files) or are
reporting it. End with a verdict.

## My own suspicions (worth less; spend most of the run elsewhere)
- `fenceJob` now uses `returning`; is it called anywhere where the extra column read matters, or
  where `rowCount` semantics differed?
- `dropExtrasIn` uses `extraColumns()` column names in a drizzle `.set()` — are those the TS
  property names drizzle expects, or SQL names?
- A reset whose draft is swept/abandoned then retried: does the retry's new draft copy from the
  current revision (with extras) and drop them again?
