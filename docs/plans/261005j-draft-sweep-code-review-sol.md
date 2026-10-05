Fixed the scoped findings. Changes remain uncommitted; no production, deletion-script, or deployment commands were run.

Findings, ranked; links point to the corrected locations:

- **P1 — deletion escaped the proven set.** [draft-sweep-backlog.ts:238](/home/greg/code/spideryarn2/.claude/worktrees/draft-sweep-delete/scripts/draft-sweep-backlog.ts:238) accepted article IDs and selected revisions afresh. It now deletes only exact surveyed IDs.
- **P1 — lineage proof covered the whole survey, rather than the actual batch.** [draft-sweep-backlog.ts:269](/home/greg/code/spideryarn2/.claude/worktrees/draft-sweep-delete/scripts/draft-sweep-backlog.ts:269) could delete a base while its surveyed child survived a skipped lock or awaited another batch. Each locked, eligible batch now receives an independent proof before deletion.
- **P1 — shell targeting remained possible.** [draft-sweep-backlog.ts:286](/home/greg/code/spideryarn2/.claude/worktrees/draft-sweep-delete/scripts/draft-sweep-backlog.ts:286) could inherit `DATABASE_URL` when `.env.local` was missing or pinned. It now reads the named file directly and prints its provenance.
- **P2 — the read-only test missed the survey.** [draft-sweep-on-step-start.test.ts:633](/home/greg/code/spideryarn2/.claude/worktrees/draft-sweep-delete/tests/draft-sweep-on-step-start.test.ts:633) tested a separate transaction. It now injects a write into the survey’s actual transaction and requires PostgreSQL’s read-only rejection.
- **P3 — stale documentation.** Corrected the remaining “only counts” signpost and claims that production deletion and backlog clearance had already happened.

File-by-file changes:

- `scripts/draft-sweep-backlog.ts`: exact IDs, finite batches, locked batch proofs, direct file targeting, and CLI error/argument redaction.
- `src/store/pg-revisions.ts`: optional revision allowlist; an empty list selects nothing. Corrected the caller comment.
- `tests/draft-sweep-on-step-start.test.ts`: added changing-candidate, lineage, allowlist, and independent-count cases; repaired the read-only test.
- `tests/draft-sweep-backlog-safety.test.ts` **new**: seven database-free tests for transaction settings, targeting, refusal, and bounded attempts.
- `scripts/draft-sweep-inventory.ts`: corrected deletion-status wording.
- `docs/project/cron-scheduler.md`: corrected deploy and backlog status.
- `docs/project/ingest-queue.md`: removed the stale counting claim.
- [Postmortem](/home/greg/code/spideryarn2/.claude/worktrees/draft-sweep-delete/docs/postmortems/261005i-a-proven-list-does-not-prove-a-fresh-query.md): recorded the proof/action mismatch and its cause.

Found no defect in the sweep’s published, current, job-owned, or six-hour protections, including concurrent publish/claim locking. Mode removal preserved the other paths. The independent proof’s counts are correct for the supplied set; `EXISTS` counts each base once. Transactions hold no locks across articles and use no `SET`, session-dependent state, or named prepared statements. No wider finding needs action.

Verification: **23 unit/doc-link tests passed**, typechecking passed via `node --import tsx scripts/typecheck.ts`, touched-file lint passed, and three mutations failed as intended: writable survey, shell targeting, and bypassed batch proof. The focused PostgreSQL suite and `npm test` were blocked before execution by sandbox `EPERM` on local Postgres/Docker; database regressions remain unverified.

**Verdict: not yet — run the PostgreSQL regression suite successfully before production deletion.**