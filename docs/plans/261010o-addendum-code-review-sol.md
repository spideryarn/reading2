Implemented one fix; no P0s remain.

- **C1 — P1 — fixed** — [scripts/feedback-unswept.ts:497](/var/tmp/spideryarn-worktrees/fbsaz0yw-addendum/scripts/feedback-unswept.ts:497): parent report IDs are owner-scoped, but the sweep matched queue sessions by ID alone. A collision could send an admin’s addendum to another reader’s session. The query now detects parent-ID ambiguity, suppresses the unsafe `dispatchedTo`, and directs the sweep to queue using the globally unique report number. Added a red-then-green regression and updated the runbook.
- **C2 — P2 — reported, wider** — [pg-feedback.ts:130](/var/tmp/spideryarn-worktrees/fbsaz0yw-addendum/src/store/pg-feedback.ts:130): compiled endings remain keyed only by owner-scoped report ID. A cross-owner collision can classify both reports with one note’s status, including refusing an addendum as closed. Fixing this requires widening the existing endings format, not this feature.

The suspected paths checked out:

- Pill changes do not lose recorded words: the per-report keeper retains interrupted audio for recovery, while drafts and the reload hold remain keyed by report.
- The default window includes recent addenda on old reports via `a.created_at >= $1 OR f.created_at >= $1`.
- Both browser/server deployment directions degrade safely.
- The reply-box refactor preserves its previous behavior.

Checks:

- 429 specified unit tests passed.
- Typecheck passed via `node --import tsx scripts/typecheck.ts`; the npm wrapper itself hit the sandbox’s `tsx` IPC `EPERM`.
- Direct Biome lint passed on both changed TypeScript files.
- PostgreSQL-backed tests were not runnable. C1’s new correlated parent-count SQL still needs a local PostgreSQL smoke test.

VERDICT: APPROVE-WITH-FIXES