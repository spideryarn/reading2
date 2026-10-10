# Migration review: the Reception expand migration (261009w)

Read-only. Review **one SQL migration**, before it reaches production; the Overseer holds deploys
carrying expand migrations until a dedicated review exists. Candidate: commit `9ac4332ae`,
`drizzle/20261010063350_reception_expand.sql` (+ `drizzle/meta/20261010063350_snapshot.json`).

It follows `20261010030345_bibliography_expand.sql`, `20261010030425_stale_notice_dismissals.sql` and
`20261010044614_stale_notice_bibliography.sql` in the journal, and **redefines the Stage 2 trigger
functions** (`article_revisions_mirror_renamed`, `step_name_partner`). Your review of those three is
`docs/plans/261009w-migration-review-sol.md` — same questions, same context (drizzle applies all
pending migrations in one transaction; the pre-rename code runs against the migrated database for
some minutes; plan `docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md` § The
database and § The migration review).

New in this one: `ALTER TABLE debate_claim_checks RENAME TO sources_claim_checks` keeping its
constraint and index names; `CREATE VIEW debate_claim_checks AS SELECT * FROM sources_claim_checks`
for the old code, with a DO block copying the table's grants onto the view; the rate-bucket CHECK
widened; chat-origin CHECKs for the new values `reception` (a lens) and `sources-claims` (a claim);
drizzle-generated drop/re-add of the claim-check constraints removed by hand (see its header).

**Production sizes**, read today read-only: `article_revisions` 530 rows, 82 with `debate` (242 KB),
2 with `debate_claims` (4 KB); `revision_step_runs` 5,476 rows, 175 named
`citations`/`debate`/`debate-claims`; `chat_threads` 64; `debate_claim_checks` 0 rows.

## Questions, each answered with evidence

1. Every statement on production data: can any fail, and what is left if it does?
2. **The view**: will the pre-rename store's statements (`git show 9ac4332ae^:src/store/pg-debate-claim-checks.ts`)
   work through it — INSERT … RETURNING, UPDATE, SELECT, the one-pending partial unique index
   violation being reported to the old code under `debate_claim_checks_one_pending`, defaults
   (`id`, timestamps) applied through the view, and the grants (the app role `spideryarn_app`;
   docs/project/database.md § the roles, default privileges)? Does `SELECT *` freeze the view's
   column list, and is that a problem until the contract drops it?
3. The redefined trigger functions: still correct for the Stage 2 pair, and for the two new pairs;
   anything lost by `CREATE OR REPLACE` / the recreated trigger (the `UPDATE OF` list)?
4. The hand-removed drizzle statements: is the snapshot now consistent with the database such that
   the next `drizzle-kit generate` (by anyone) will not re-emit or drop something? (Builder reports
   `db:generate -- --allow-empty` says no changes and `db:chain` is clean.)
5. Locks and duration at production size; interaction with the earlier three in one transaction.
6. Rollback: what breaks if the deploy is rolled back after this runs, and a down-migration outline.

## Severity and output

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

First line: `SAFE TO APPLY`, `SAFE TO APPLY AFTER CHANGES`, or `DO NOT APPLY`. Findings M1, M2, …
with evidence and the concrete change. Then a short paragraph Greg could read: what this migration
does to production, how long, what could go wrong.
