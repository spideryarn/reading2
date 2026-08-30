# Review prompt — the BUILT code for stage 1, several articles at once

You reviewed the plan earlier today (`docs/plans/several-articles-at-once-review-sol.md`) and opened
with *"STOP — do not build this plan as written"*, with four blockers. **All four were checked against
the code and all four were right.** The plan was recut into two stages in response; this review is of
**stage 1 only, as built**. Read-only.

Weight this review higher than the plan one: a plan-stage review reads prose, and this is the half
where the bugs actually are.

## What stage 1 is

Replace the global "at most one running job in the whole table" with a configurable cap.

- `jobs_only_one_running` — a unique index on the constant `(true)` where `status = 'running'` — is
  **dropped** (`drizzle/0032_jobs_concurrency_cap.sql`, applied locally).
- The cap is `SPIDERYARN_JOB_CONCURRENCY`, default 3, read at call time by `jobConcurrency()` in
  `src/jobs.ts` and passed into `claim` the way `leaseMs` already is.
- Postgres `claim` now opens a transaction, takes `SELECT 1 FROM queue_state WHERE id = 1 FOR UPDATE`,
  counts `running` rows excluding this one, and refuses over the cap — otherwise it runs the same
  fenced `UPDATE` as before, now in `claimIn`.
- The filesystem adapter does the same thing with `runningCount()`.

**Stage 2 — turning the per-article 409 into a queue — is NOT in this diff.** Its two tests are
present and `it.skip`ped, because it must not ship before late steps read the published store
(your blocker 1, which another session owns).

## What to read

The scoped diff is at `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/b14ffddc-8d95-48c2-8911-bb86d164d109/scratchpad/stage1.diff`.
Read it first, then the files around it: `src/store/pg-jobs.ts`, `src/store/jobs-fs.ts`,
`src/store/jobs.ts`, `src/jobs.ts`, `src/db/schema.ts`, `drizzle/0032_jobs_concurrency_cap.sql`,
`drizzle/0001_auth_fks_and_guards.sql` (the `queue_state` seed and delete trigger),
`tests/store-jobs-parity.test.ts`, `tests/db-schema.test.ts`, `src/db/client.ts`.

## Lead with anything that means this must not be committed

Then everything else by severity. Specific worries, but do not let them limit you:

1. **Is the counted cap actually exact?** Every transition into `running` must take the `queue_state`
   lock for the count to mean anything. Trace every path that can set `status = 'running'` in the
   whole repo — including migrations, fixtures, test helpers, the importer, and any raw SQL — and say
   which ones bypass the lock and whether that matters.
2. **The transaction is new here.** `claim` used to be one statement on the pool. It now holds a
   transaction, and `poolMax()` defaults to 5 with the pooler limit shared across instances
   (`src/db/client.ts`). Under N concurrent claims plus reader traffic, can this deadlock, starve, or
   exhaust the pool? Is `FOR UPDATE` on one singleton row a queue that behaves badly under load?
   Is there a lock-ordering hazard against the article/job lock order that `src/store/pg-session.ts`
   and `src/store/publish-session.ts` insist on?
3. **What did dropping the index cost that the count does not replace?** I have written down that the
   database no longer enforces this at all and that one test stands in for it. Is that test enough,
   and is there a cheap database-level backstop I have dismissed too quickly?
4. **The excluded-self count** (`jobs.id <> $id`) exists so that re-claiming a running job is reported
   as "another request is inside this job" rather than as the cap. Is that correct in every case, or
   does it let something through?
5. **The filesystem adapter.** It is the local default. `runningCount` scans an in-memory index and
   `claim` has no `await` between the check and the mutation — is that still true after my change,
   and is the fs and Postgres behaviour genuinely the same where the parity suite claims it is?
6. **Did I break the lease/sweep story?** `failExpired` is unchanged, but it now runs in a world where
   several jobs can be running. Check `advanceJobWith`'s sweep-then-claim order against N > 1.
7. **The tests.** Are the two rewritten cases (`refuses a claim that would put the machine over its
   cap`, and the schema case now asserting two running rows are *allowed*) pinning the right thing?
   I watched the cap case red on both adapters against a `claim` that ignored `maxRunning`. What else
   should be red-tested that is not? In particular, is there a test that would pass while the lock is
   silently not being taken?

Be concrete, cite `file:line`, and if you think something I wrote in a comment is false, say which.
