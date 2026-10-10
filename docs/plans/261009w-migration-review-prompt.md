# Migration review: the Bibliography expand migrations (261009w)

Read-only. You are reviewing **two SQL migrations and nothing else**, before they reach production.
The Overseer (which deploys) holds the deploy until this review exists. Candidate: the tree at
commit `6b0b64f78` (on `dev`):

- `drizzle/20261010030345_bibliography_expand.sql`
- `drizzle/20261010044614_stale_notice_bibliography.sql`

They apply after `drizzle/20261010030425_stale_notice_dismissals.sql` (another session's, which
creates `stale_notice_dismissals`) in this journal order: 030345, 030425, 044614
(`drizzle/meta/_journal.json`). `npm run deploy` applies pending migrations to production through
`scripts/db-migrate.ts` (drizzle's node-postgres migrator — check whether it wraps all pending
migrations in one transaction: `node_modules/drizzle-orm/pg-core/dialect.cjs`, `PgDialect.migrate`),
then pushes and waits for Vercel; so for some minutes the **pre-rename code** runs against the
migrated database, and the new code after. Context: `docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md`
§ The database and § After GPT Sol's plan review (expand now, contract later), and your earlier
Stage 2 review `docs/plans/261009w-stage-2-code-review-sol.md`.

**Production sizes**, read by me read-only today: `article_revisions` 530 rows (100 MB total
relation), 91 with `citations` non-null totalling 888 KB of jsonb; `revision_step_runs` 5,476 rows
(976 kB), 175 named `citations`/`debate`/`debate-claims`; `chat_threads` 64; `stale_notice_dismissals`
does not exist yet on production.

## Questions, each answered with evidence

1. **Correctness of every statement** on production data: the CHECK drop/re-add pairs (could any
   existing row fail a re-added CHECK?), the `ADD COLUMN`, the backfill `UPDATE … SET bibliography =
   citations`, the step-run copy `INSERT … ON CONFLICT DO NOTHING`, the two trigger functions and
   triggers, the postcondition `DO` block. Can any of it fail on production, and if it fails, what
   state is left (one transaction, or partial)?
2. **The triggers that DELETE and INSERT `revision_step_runs` rows** (`revision_step_runs_mirror_renamed`):
   can they delete a row that should survive, loop, deadlock in ordinary use, violate a constraint
   or FK (`revision_step_runs` is referenced by anything?), or behave differently under the pre-rename
   code's statements (`git show 745d62743^1:src/store/pg-revisions.ts` is not the pre-rename code;
   use `git show 68d9ed837^:src/store/pg-revisions.ts` and `…:src/store/artifacts-pg.ts`) than under
   the new code's? Is `SECURITY`/`search_path` right, and will the app role (`spideryarn_app`, see
   docs/project/database.md § the roles) be able to fire them (trigger functions run as the invoking
   role unless SECURITY DEFINER: does the app role have INSERT/DELETE on `revision_step_runs`)?
3. **The `article_revisions` trigger** (`BEFORE INSERT OR UPDATE OF citations, bibliography`): any
   write path that bypasses it or that it breaks (e.g. an UPDATE of other columns only; the draft
   copy `INSERT … SELECT`; `COPY`)?
4. **Locks and duration at production size**: what lock each statement takes, for how long, and what
   a reader would see meanwhile.
5. **Independence**: can `20261010044614_stale_notice_bibliography.sql` be applied without
   `20261010030345_bibliography_expand.sql` (or its triggers) in place? Is there any ordering hazard
   between the three?
6. **Reversibility**: if the deploy is rolled back to pre-rename code after the migrations ran, what
   breaks, and what would a down-migration look like?

## Severity and output

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

First line: `SAFE TO APPLY`, `SAFE TO APPLY AFTER CHANGES`, or `DO NOT APPLY`. Then findings M1,
M2, … with evidence and the concrete change. Then a short paragraph a non-engineer (Greg) could read:
what these migrations do to production, how long, and what could go wrong.
