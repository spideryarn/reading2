# Review: Stage C — the permanent-delete store method and its route

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently`, branch
`worktree-delete-article-permanently`. TypeScript + ESM, Postgres via Drizzle (schema `spideryarn`),
React web client. **Code review of implemented work.** You reviewed the plan behind it on
2026-09-06 and refused it; this is the third round on this job.

**Number every new finding from `F20` upward.** F1–F6 are yours from the plan round. A separate
review of Stage B is running concurrently and owns F7–F19. Reuse an ID only for the same finding.

## The candidate

**Live pre-commit — nothing is committed.** `git diff <sha>...HEAD` returns nothing here and that
looks exactly like a change with no diff. Read the working tree with `git diff -- <paths>`.

Scoped paths, modified:
`src/store/contracts.ts`, `src/store/pg-shelf.ts`, `src/routes.ts`, `src/store/jobs.ts`,
`src/store/pg-jobs.ts`, `src/jobs.ts`, `tests/owner-isolation.test.ts`,
`tests/store-shelf-pg.test.ts`, `tests/store-slug-guard.test.ts`,
`tests/store-migration-registry.ts`, `docs/project/library.md`,
`docs/plans/260906h-delete-an-article-permanently.md`

Untracked, **and therefore invisible to any pathspec**:
`tests/article-delete-pg.test.ts`

**Not in scope, and do not review it:** an uncommitted Stage B sits in the same tree —
`src/db/schema.ts`, `src/store/pg-billing.ts`, `src/store/pg-admin.ts`, `drizzle/*`,
`tests/billing-*.test.ts`, `tests/admin-queries.test.ts`, `tests/db-schema.test.ts`. Another review
has those. Read them if they inform you; do not report findings against them.

Start with `src/store/pg-shelf.ts` § `destroy` and `src/store/pg-jobs.ts`.

## What it is meant to do

`ShelfStore.destroy(slug)` plus `DELETE /api/library/:slug`. No UI — that is Stage D. This is the
first irreversible act on a reader's own data in this product, against one production database with
real paying readers and no staging copy.

Invariants:

1. **A reader can only ever destroy their own article.** Authorisation is a SQL `where` clause
   (`ownedSlug`), never a route check. A non-owner gets 404, never 403.
2. **Nothing may destroy or corrupt a different reader's data.**
3. **Deleting must not change what anyone is charged**, in either direction — including by leaking a
   quota reservation that can never be released.
4. **A delete that reports success must have happened**, and must stay happened.

## What you can and cannot run

Tree is read-only; `/tmp` and the node_modules caches are writable. **No network, not even
loopback**, so Postgres is unreachable and every test here needs it. Do not spend the run on it.

I ran them:
`npx vitest run tests/article-delete-pg.test.ts tests/owner-isolation.test.ts tests/store-shelf-pg.test.ts tests/store-slug-guard.test.ts`
→ **4 files, 100 tests, all passing.** Full `npm run check` EXIT=0.

## Attack it

Independently, before my questions below.

**The invariant to break is the fourth: find an ordering in which the delete reports success and the
article, or a job that will recreate it, still exists.** Then the third: find a sequence that strands
a billing reservation.

The single statement `delete from articles where …` relies entirely on FK cascades. A spike measured
that it works and that deleting children by hand first fails with `23503` because the constraints are
`NOT DEFERRABLE`. Attack the cascade itself: a table that should cascade and does not, a `set null`
that strands something, a row that survives and later collides with a re-add.

For each finding: an ID from **F20** up, a severity (P0/P1/P2/P3), **established** or **reasoned**,
then (a) the input or mutation I can run that shows it fails, and (b) the smallest change that closes
it. A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1, and name what established it.

## Previous findings

| ID | Finding, verbatim | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F3 | deleting a missed active job permanently leaks its billing reservation | **fixed here** | `liveJobsForQuery` refuses on a broad predicate — any `queued`/`running` job for owner+slug, regardless of draft pointer or lease age. No active job is ever deleted |
| F4 | enqueue can race the check and resurrect a deleted article | **fixed here** | Every enqueue now locks the owner-scoped article row inside its own insert transaction; `requiresArticle` refuses on absence for the `{slug, steps}` shape |
| F1, F5 | blob deletion | deferred to Stage E | Greg chose to build a catalogue. Not in this candidate |
| F6 | cache invalidation | Stage D | Not in this candidate |

Treat both fixes as unreviewed code by someone else.

## Three things I already know, so you need not find them

Stated so you spend the run elsewhere — and because each is a place I would rather be told I am
still wrong.

1. **The plan said `lockBillingAccount` first; that was wrong and is changed.** It *creates* the
   billing row, so a request about to be refused wrote one on its way out — and for an owner id with
   no `auth.users` row that surfaced as `23503` wearing a **500** instead of a 404. `destroy` now
   does an **unlocked** `SELECT` through `ownedSlug` to refuse early, then `lockBillingAccount`, then
   the locked re-read that actually authorises. The claim is that a plain `SELECT` takes no row lock
   and so sits outside the `billing_accounts`→`articles` order and cannot be half of a cycle. **Say
   if that reasoning is wrong**, or if the early read introduces a TOCTOU I have talked myself out of.
2. **The F4 barrier test does not discriminate.** Removing the enqueue lock leaves it green — the
   pre-fix failure needs a delete to commit between an enqueue's preflight and its insert, and
   nothing in the harness can hold an enqueue open across that gap. The test that *was* watched red
   is the sequential *refuses with a 404 once the article has gone*. Say whether that is an adequate
   guard for F4 or whether the race is effectively untested.
3. **Dropping the owner clause from the `DELETE` statement turns only a static guard red**, no
   behavioural test — because the locked re-read refuses a non-owner before the statement is
   reached. Two independently sufficient layers, and no behavioural test can see the second. Say if
   that is fine or if one of the layers should go.

## My own suspicions — read last

Already my doubts, so confirming them is worth less than anything you find yourself.

- `requiresArticle: !request.url && !request.upload`. A **retry** of a re-run job carries `old.url`
  filled in from the article at enqueue time, so `requiresArticle` is false for it and the F4
  refusal does not cover it. I think that is a real hole; say how big.
- The `uploads` row is deliberately **left in place** rather than deleted, because deleting it
  destroys the only durable mapping to the staging object and Stage E is not built. So a deleted
  article leaves a live `uploads` row whose `slug` names nothing. `/add/upload/<id>` will now
  redirect to a 404. Is leaving it the right call, and is there a hazard in the dangling row itself?
- `tryEnqueue` was two statements on the pool and is now one transaction, so two enqueues on the same
  existing article serialise on the article lock. Say if that is a throughput or deadlock problem in
  the ingest path.
- `destroy` returns `{ destroyed: slug }` and throws `notFound` when `rowCount !== 1`. Is there a
  state where the row is gone and the caller is told it was not?
- Terminal (`done`/`error`) jobs are deliberately kept and have their `article_id` nulled by the
  cascade. A spike measured that a *non-terminal* leftover job blocks a re-add with
  `23505 … jobs_reserved_slug`. Confirm terminal rows really are inert against that index.

Do not change any file.
