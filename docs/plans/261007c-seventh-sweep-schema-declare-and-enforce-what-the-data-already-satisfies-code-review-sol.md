**Verdict: ship with these fixes applied**, after production preflight and with bounded migration lock waits. No P0 defect found.

- **C1 — P1, conditional locking risk; reasoned, not fixed in code.** `CREATE INDEX` takes `SHARE` on `revision_blocks`, blocking writes until the entire chain commits. A long transaction on a later table can prolong that block while its `ACCESS EXCLUSIVE` lock waits. The runner supplies no lock timeout. I corrected the plan’s lock description; bound waits on the migration connection before applying. Production duration was not measured here.
- **C2 — P2, typecheck failure; reproduced and fixed.** The new index inventory accessed `name` and `indexConfig` without narrowing Drizzle’s partial union. Three compiler errors resulted. Added an explicit configuration guard; typechecking now passes.
- **C3 — P2, money tests admit wrong CHECKs; reasoned with offline mutation probes and fixed.** Removing `cost_source = 'provider'` from the BYOK CHECK would pass the original new tests. Several invalid computed/unpriced money combinations were also uncovered. Added both missing BYOK refusals and the complete source × money-presence matrix.
- **C4 — P3, inaccurate comments; reasoned and fixed.** Corrected the input fingerprint description, historical absence inferred from current counts, creation-date wording tied to a calendar date instead of migration installation, and `claimsOmitted` descriptions that incorrectly included failed runs.
- **C5 — P3, overstated test discovery; reasoned and fixed.** `database.md` claimed all three checks derive from declarations. The money cases explicitly name their rules. Corrected the description.
- **C6 — P3, unnecessary stage-7 prerequisite; reasoned and fixed.** The plan implied adding the scalars CHECK requires removing the defensive fallback. Both can coexist, but its tests need a different boundary for legacy data. Stopping remains appropriate; a weaker CHECK would enforce a different invariant.

The seven SQL files are sound against the **recorded** production catalog. A missing or renamed duplicate index makes stage 5 fail deliberately; `IF EXISTS` would conceal drift. Failure rolls back all seven migrations and their ledger rows. Stage 2 scans under `ACCESS EXCLUSIVE`; its DROP/ADD exposes no unenforced window.

All seven timestamps clear `origin/dev`’s watermark. A later-landed migration below an already-applied watermark is refused by the migration preflight; `db:chain` alone does not detect that problem.

Stage 4 correctly adds the nullable column without a default, then installs `now()`. All snapshots have the intended deltas. Historical DDL matches the final **44 explicit indexes and 226 CHECKs**. Stages 6/6b execute no DDL; keeping 6b separate is sound. Generation reports no diff.

Current writers satisfy both Referee CHECKs, and no application caller casts past `ClaimsFinish`. There is no current bundle importer. A future verbatim restoration of legacy violating rows would be refused; that compatibility work is outside this stage.

Files changed:

- [Schema comments](/var/tmp/spideryarn-worktrees/sweep7-schema/src/db/schema.ts)
- [Claims-store comment](/var/tmp/spideryarn-worktrees/sweep7-schema/src/store/pg-referee-claims.ts)
- [Schema tests](/var/tmp/spideryarn-worktrees/sweep7-schema/tests/db-schema.test.ts)
- [Database documentation](/var/tmp/spideryarn-worktrees/sweep7-schema/docs/project/database.md)
- [Stage plan](/var/tmp/spideryarn-worktrees/sweep7-schema/docs/plans/261007c-seventh-sweep-schema-declare-and-enforce-what-the-data-already-satisfies.md)

Ran: the five selected offline test files (**79 passed**), the typecheck runner (**passed**), lint on the three touched TypeScript files (**passed**), `db:chain`, generation with `--allow-empty`, predicate mutation probes, snapshot/DDL comparisons, and `git diff --check`. Database tests were not run. No commits made.

**No migration SQL, snapshot, or journal changed. The shared local database needs no reapplication or ledger repair.**

Separately, run this **[complete production preflight SQL](/tmp/sweep7-schema-production-preflight.sql)** immediately before applying, using the migration credential through the session connection. It runs inside `BEGIN READ ONLY … ROLLBACK` and contains:

- Exact timestamp/hash checks for all 153 previously applied migrations.
- The seven pending timestamps and absence checks for new objects.
- Both constraint violation counts.
- Full definitions and validity checks for nine existing indexes and seven constraints.
- Duplicate-index equivalence, including collations and operator classes.
- Ownership, active-lock, long-transaction and prepared-transaction checks.

Every query labelled `VIOLATIONS` must return **zero rows**. Both Referee violation counts and the non-array claims count must be zero. Inspect lock results and use finite lock and statement timeouts on the **migration connection**; the read-only sample cannot prevent a subsequent lock race.