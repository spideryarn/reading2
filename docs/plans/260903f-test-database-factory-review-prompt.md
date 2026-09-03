# Review: stage T-B, the private test database factory

You are reviewing **built code**, not a plan. Weight this higher than a plan-stage review: a plan
review cannot find a guard that never fires.

## What this is for

`docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md` deletes the
`SPIDERYARN_STORE` flag and the filesystem store. It absorbed
`docs/plans/260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md` as its stage T.
**Read 260903e § Stage B — it is the spec this code was built against** — and 260903e's own review,
`…-review-sol.md`, whose findings that checklist already folds in.

This stage builds the factory **behind a spike config**. Nothing about the default `npm test`
changes yet; lanes are T-C and activation is T-D. Code that is wrong here should not be able to make
the tree red for anyone else — check that that is actually true.

## The files

- `scripts/db-test-create.ts` — the factory, the lifecycle, the scavenger, and a CLI.
- `tests/db-test-create.test.ts` — its tests.

Both are new and untracked. Everything else in the diff is the plan doc.

## Context you need about this box

- **One local Supabase, shared by every worktree and every other agent.** There is no staging copy.
  A scavenger that drops a live run's database costs somebody else hours of confusing red.
- There are **two** Supabase stacks on this host (this repo's and another project's), on different
  ports.
- There are **no Postgres client binaries on the host** — `pg_dump`/`pg_restore` run via
  `docker exec` into the container.
- `.env.local` is applied **over** `process.env`, which has caused a whole-suite silent failure
  before. `docs/project/database.md` § "`DATABASE_URL=… npm run db:migrate` does not do what it looks
  like" is the accident this file's `Target:` check exists for.

## What I already found, so you don't spend the review on it

I reviewed the diff myself and found one real defect, now fixed — **please check my fix rather than
re-finding the bug**:

`dropTestDatabase` and `createEmptyDatabase` interpolate the database name into a quoted SQL
identifier (`CREATE`/`DROP DATABASE` take no bound parameters) behind a **`startsWith` prefix check
only**. A name of the form `spideryarn_test_a"; …` satisfies the prefix and closes the identifier.
Watched failing: the call came back `DROP DATABASE cannot run inside a transaction block`, i.e. the
string reached the parser as two statements and *Postgres* refused the chain — a protection that
belongs to `DROP DATABASE` being non-transactional, not to this file.

Fixed with `assertMintedName`, which requires the whole minted shape (`parseTestDatabaseName`
accepting it) rather than the prefix. **Tell me if that is the wrong fix**, if it is incomplete (are
there other interpolation sites?), or if refusing legacy names like `spideryarn_test_spike` from
`--drop` is a mistake.

## What I want from you

**Please actually run things — your sandbox allows it, and a finding you reproduced outranks one you
reasoned to.** `npx vitest run tests/db-test-create.test.ts` is the file. The factory itself needs
docker and the local stack; if you cannot reach them, say so plainly rather than inferring results.

Ranked by what I am most worried about:

1. **The scavenger's safety.** It has four fences: the `spideryarn_test_` prefix, an age derived
   from the name, zero sessions in `pg_stat_activity`, and a re-read of the session count between
   the scan and the drop. Plus a 30-minute floor on `olderThanMs` unless the caller names databases
   in `only`. **Can you construct a sequence where a live run's database is dropped?** Consider: a
   run that has created its database but not yet connected; a run between connections; connection
   pooling; a clock skew; `only` bypassing the floor; `pg_stat_activity` visibility for other roles.
2. **Silent success.** Every check in this file should be one that has been watched failing. The
   subagent that built it reported a control for each (dropping `--exit-on-error`, removing the
   session guard, handing the migrator the wrong URL, and so on). **Which checks could still pass
   while doing nothing?** In particular: `archiveProblems`, `baselineProblems`, `assertSameCluster`,
   and the ledger check in `migrateInto`.
3. **Whether the baseline assertion is actually sufficient.** The clone must be the shared database's
   schema *minus* the app schemas, plus whatever the real migrator then creates. 260903e's review
   listed what `pg_dump -s` carries and omits and flagged event triggers as speculative. This code
   retains all six event triggers, on the grounds that they are Supabase DDL watchers whose only
   effect here is a `NOTIFY` nobody listens for. **Is that right?**
4. **A correction the subagent made to 260903e, which I want checked.** 260903e § Stage B says "by
   default a restore continues past errors", implying the exit code is insufficient. The subagent
   found `pg_restore` **does** exit 1 whenever it ignored an error — so the exit code was always
   enough to *detect*, and what `--exit-on-error --single-transaction` actually buys is
   **atomicity**: without them a failed restore leaves a half-populated clone that looks migratable.
   Is that account correct?
5. **Restoring as `supabase_admin` rather than `postgres`** (needed because the dump carries event
   triggers and `postgres` is not superuser on a Supabase stack), while the clone is
   `OWNER postgres` so the migrator can create `spideryarn`. Any consequence of that split?
6. **Anything the stage boundary got wrong** — does this genuinely change nothing for the default
   `npm test`? The new test file *does* run under it (~22s, and it creates and drops short-lived
   databases). Is that acceptable at this stage, or should it be gated until T-D?
7. Anything else you would not ship.

Be concrete about severity, and say which findings you reproduced versus reasoned to. Some of your
findings will be wrong and I will check each one — but tell me which you are confident in.
