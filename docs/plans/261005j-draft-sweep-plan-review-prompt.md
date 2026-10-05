Review a plan before it is built. Read-only: change nothing.

The plan: docs/plans/261005j-draft-sweep-deletes-and-the-count-mode-goes.md

It switches an existing, tested sweep from counting abandoned draft revisions to deleting them
(Greg approved on 2026-10-04), removes the count mode, and adds a one-off script that clears the
existing backlog in production (75 rows, 29 articles), default dry run.

Read, as evidence rather than taking the plan's word:
- src/store/pg-revisions.ts: `abandonedDraftCondition`, `sweepAbandonedDrafts`, `sweepOnStepStart`,
  `openOrBeginJobDraft` (the caller, minting branch), and every writer that sets a revision's status
  or `based_on_revision_id`, or moves `articles.current_revision_id`
- src/db/schema.ts: everything that references `article_revisions`, by foreign key or by a bare
  revision-id column with no key
- tests/draft-sweep-on-step-start.test.ts
- scripts/draft-sweep-inventory.ts
- docs/project/cron-scheduler.md, docs/project/database.md (§ Which host: production is reached
  through the transaction pooler, as the app's role)

Questions, most important first:
1. Is there any row a reader's article depends on, now or after a later publish/undo/reset, that the
   four-part condition would delete? Look for a path that leaves a revision `draft` or `failed`,
   older than six hours, named by no job, and still needed: a long-running job that lost its
   pointer, a reset or undo that keeps an old revision to return to, bulk import, an eval or script
   that mints revisions without a job, anything that reads a failed revision as evidence later.
2. Is the plan's table of what goes with a deleted revision complete and right? Any table or storage
   object keyed on a revision id without a foreign key?
3. The backlog script calls `sweepAbandonedDrafts` in a loop per article from outside the app, over
   the transaction pooler, taking the article row `for update` first. Is anything in that unsafe or
   wrong on a transaction pooler (savepoints are not used by the script; explicit transactions are)?
   Is the lock order consistent with the app's (article, then job)?
4. Is the dry run's proof (an independent second query showing zero candidates are published,
   current, job-named or somebody's base) the right check, or does it share an assumption with the
   predicate so that both could be wrong together?
5. Anything simpler that does the same job.

Answer with findings ranked P0–P3, each with the file and line that shows it, and a one-line verdict
at the end: build as written / build with changes / do not build. Say plainly where you checked and
found nothing.
