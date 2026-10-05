Review the code built from a plan, and fix what you find inside its scope. Report anything wider
rather than fixing it.

The plan: docs/plans/261005j-draft-sweep-deletes-and-the-count-mode-goes.md (its § Results says what
was built and what the plan review asked for).

The change is the uncommitted work in this tree. See it with `git status --short` and
`git diff HEAD`; one file is new and untracked: scripts/draft-sweep-backlog.ts. The files:

- src/store/pg-revisions.ts — the sweep always deletes; `DraftSweepMode` and
  `STEP_START_DRAFT_SWEEP` are gone
- scripts/draft-sweep-backlog.ts — NEW. Whole-library one-off: dry run by default inside a read-only
  transaction, `--delete` to do it, `--prod` to read `.env.prod`
- scripts/draft-sweep-inventory.ts — stops importing the mode
- tests/draft-sweep-on-step-start.test.ts — the mode is gone, plus new cases
- docs/project/cron-scheduler.md — status

This matters more than usual: on the next deploy the sweep deletes rows in production on every job's
first step, and the backlog script is about to be run with `--prod --delete` against real readers'
data (103 revisions across 35 articles on today's dry run). There is one production database and no
staging copy.

Look hardest at:
1. Can `sweepAbandonedDrafts`, as it now stands, delete a revision that is published, current,
   named by any job, or younger than six hours — including under a concurrent publish or claim?
   Did removing the mode change any path other than "count returns early"?
2. scripts/draft-sweep-backlog.ts: can the dry run write? Can `--delete` delete anything the dry run
   did not prove? Is `deleteDraftBacklog`'s loop guaranteed to terminate, and does it hold any lock
   across articles? Is anything in it wrong over a transaction pooler (no session state, no `SET`,
   no named prepared statement)? Is the target selection (`--prod` vs `.env.local`, shell
   `DATABASE_URL` ignored) what the comments say? Does it print anything it should not (slugs,
   titles, text, a password)?
3. `proveUnprotected`: is it really independent of `abandonedDraftCondition`, and are its counts
   right (the `base_of_a_survivor` subquery in particular)?
4. The tests: is there a case that would stay green if the thing it names were broken? Mutate and
   see where you can — run them with
   `npx vitest run tests/draft-sweep-on-step-start.test.ts` (needs the local Postgres; if the sandbox
   cannot reach it, say so rather than reporting a red run as a finding).
5. Anything that still names the removed mode or the old "only counts" behaviour, in code, comments
   or docs outside docs/plans/ (old plans are history and stay as they are).

Do not run scripts/draft-sweep-backlog.ts with `--prod` or `--delete`. Do not run `npm run deploy`.
Do not commit. Do not attribute any words to Greg that are not already quoted in the files.

Answer with: what you changed (file by file), findings ranked P0–P3 with file and line, what you
checked and found nothing in, and a one-line verdict: safe to run against production / not yet.
