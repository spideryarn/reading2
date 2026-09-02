# Code review: stage 1, the per-article job queue

You are reviewing **built code**, not a plan. Repository root is this working directory (a git
worktree of Spideryarn, branch `worktree-article-job-queue`). Read-only: do not edit anything.

**Weight this higher than the plan review you gave the same day.** A plan-stage review reads prose
and can only catch what the prose says; this is the half where the bugs are.

## What to read

The change is one commit, `540927f`, 74 files. Get the scoped diff with:

```
git show 540927f --stat
git show 540927f -- src/db/schema.ts drizzle/0052_per_article_job_queue.sql
git show 540927f -- src/store/jobs.ts src/store/pg-jobs.ts src/store/jobs-fs.ts
git show 540927f -- src/jobs.ts src/routes.ts src/job-state.ts
git show 540927f -- src/web/
git show 540927f -- tests/
```

Then the plan it was built from, and your own review of it:

- `docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md` —
  **stage 1 only**; stage 2 is not built and is not in scope.
- `docs/plans/260902e-...-review-sol.md` — your review of the plan. Four blockers. Check each one
  actually landed in code rather than only in prose.

## What the change does

`jobs_active_slug` (unique on `(owner_id, slug)` where `status in ('queued','running')`) did three
jobs at once. It becomes four partial unique indexes plus a non-unique scan index and a check
constraint; the per-article rule moves from enqueue time to claim time as a predecessor rule; and
the 409 and everything that rendered it is deleted.

Specifics worth checking hard:

1. **`hasPredecessor`** (`src/store/pg-jobs.ts`) and **`aheadOf`** (`src/store/jobs-fs.ts`) — do
   they agree? The Postgres one reads the row's own `(created_at, id)` inside the statement, on the
   grounds that a round trip through a JS `Date` rounds microseconds down and would let a job
   overtake a predecessor it shares a millisecond with. Is that right, and is the filesystem string
   comparison of `createdAt` equivalent given every writer is `new Date().toISOString()`?
2. **Is the predecessor check in the right place inside `claim`?** It sits after the counted cap,
   inside the `queue_state` `for update nowait` transaction. Can a claim now succeed where two jobs
   end up `running` on one slug, or where a job is refused for ever?
3. **`tryEnqueue`'s re-read** — it classifies from the data rather than the constraint name, and
   the three matching predicates are meant to be *exactly* the ones the indexes carry (owner scope,
   `cancelling` in or out, global vs owner-scoped). Do any of them disagree with their index? Can an
   insert conflict and then have the re-read find nothing that explains it, in a case the retry
   cannot fix?
4. **`enqueue`'s repair loop** (`src/jobs.ts`). Four outcomes; `sourceTaken` adopts the holder's
   slug *as an adoption* so the ticket changes, `nameTaken` re-mints. The old
   `if (next === slug) throw` guard was deleted on the grounds that every repair now changes the
   question. **Can this loop spin, or exit having created a second article for one address?**
5. **The ownership check.** It refuses a slug-named request only when the slug *exists and is
   somebody else's* (`!articleExists(slug) && slugIsTaken(slug)`), Postgres only, 404. The plan said
   "requires the caller to own the article"; this is narrower, and the narrowing is recorded in the
   plan's status block. Is the narrower rule sound — in particular, can a job still be enqueued that
   permanently blocks an article's line for a reader who cannot see or stop it?
6. **The migration.** It refuses to run while any job is `queued` or `running`, and has two other
   preflights. Is draining actually sufficient to give `reserves_name` and `url_key` a meaning for
   pre-existing rows? Is anything about `DROP INDEX` + five `CREATE INDEX` unsafe here — locking,
   ordering, or a window where neither the old nor the new guarantee holds?
7. **What the deletions took with them.** `JobConflict`, `ARTICLE_IS_BUSY`,
   `WORKING_ON_THIS_ARTICLE`, `structuredDetail`, `blockingJob`, `StepJob.blocking`, the blocker
   band, `activeForSlug`, and two test files. Is anything now unreachable-but-present, or reachable
   with no handler? `HttpError.details` was kept as a generic mechanism with nothing populating it.
8. **`useStepJob`'s job memo** now takes the running match, else the oldest queued. And
   `jobForSlug` became `jobForUpload`, matching `job.upload.id`. Are those the right rows, and does
   the upload one still find a *terminal* ingest after a page reload?
9. **The tests.** Which of the new ones would pass while the feature was broken? In your plan review
   you named four shapes that would have gone green falsely and they were rewritten — check the
   rewrites actually test what they claim. `tests/helpers/running-slot.ts` was rewritten to look
   before it inserts rather than catch a constraint name; `tests/running-slot.test.ts` gained a
   real-database half beside its mocked one. Is the mocked half still proving anything?

## Known and deliberate

- `npm test` is not a reliable gate in this repo at the moment — it swings between 5 and 20 red
  files on an unchanged tree, and another session is fixing that
  (`docs/plans/260902c-make-the-test-suite-pass-reliably.md`). Do not read a red full run as
  evidence about this change without checking the file against the diff.
- No reason field on `Advanced`: the client is not told *why* a job is waiting. Greg chose "just
  show them as waiting"; the claim logs the reason server-side.
- No sweep for abandoned queued rows, and no `last_seen_at` — you refused it twice and the plan
  takes your side.
- Stage 2 (modes auto-running on click) is not built. Findings about it belong in the next review.

## Ground rules

Be concrete, name files and lines, and say NO-SHIP if it deserves it. Where you disagree with a
decision Greg has made — serial within an article, no queue positions, no dot — say so once and
then review within it. **Rank your findings**, and say for each whether it is a bug you can
demonstrate or a risk you are inferring.
