# 261002b — Greg's three answers of 2026-10-02

Three questions the Overseer put to Greg, each answered *"yes"*, each a small change.

## 1. Q-citations-daily-cap — Citations' all-readers fuse goes from $20 to $50 a day

Citations' *Dig deeper* runs on Opus with a forced web search, about $0.30 a press measured, and
its global daily fuse was sized at 25 presses × the $0.80 worst-case budget = $20. So $20 a day
bought about 25 presses across every reader. The fuse is in code, not an environment variable:
`INVESTIGATE_RATE_POLICY.daily.globalFills` in `src/citation-investigate.ts`, now **62**
(62 × $0.80 = $49.60). The per-reader figures (20 a day, 8 an hour, one at a time) are unchanged.

Test: `tests/citation-investigate.test.ts` pins 62, and checks the ceiling is at most $50 **and**
within one press of it, so a fuse quietly left low fails too. Watched red before the change.

## 2. Q-import-report-details — the report stays private; Dismiss keeps the job record

Greg kept the failed-import *Report this* free of the source URL, file name and error message (a
pasted URL can carry an access token). The report already carried the job id
(`src/web/import-report.ts`), but **Dismiss deleted the job row**, so a report filed and then
dismissed named nothing.

Now Dismiss (`DELETE /api/jobs/:id` → `store.forget`) stamps a new nullable column
`jobs.dismissed_at` instead, and every reader-facing lookup treats a stamped row as absent. To the
reader nothing changes: the card goes, the poll, Retry and Advance 404 as before, and a second
Dismiss answers 404 as a second delete did. The row stays until `trimFinished` retires it with the
other finished jobs (fifty per reader).

**The simpler option passed over:** leave the delete and accept that a dismissed job's id traces
nothing — the slug and timestamps already in the report would still find the article. Rejected
because Greg's answer made the id the way back, and a dismissed failure is exactly the one a reader
reports.

**What else reads `jobs`** (shelf delete, revisions, billing reservations, minimal-paper): every one
of them already handles a terminal row that has not been trimmed, and a dismissed row is just that,
so none needed a change. A dismissed row still holds one of the fifty retention slots, as it would
have had the reader never pressed Dismiss.

No route serves anything new; nothing serves the uploaded file back by job id.

Test: `tests/store-jobs-parity.test.ts` § *keeps the record of a forgotten job* — red against the
delete (the row was gone), green after. Migration `drizzle/20261002100053_job_dismissed_at.sql`,
additive.

## 3. Q-summary-on-add — already built

Summary joined the *Generate the main modes* set in 3a9e040f4 (plan 261002a), with its test in
`tests/auto-modes.test.tsx`. It queues the `simple` step, which writes all three plain-words levels
(Brief, Simple, Fuller), all or none. Only `docs/project/summaries.md` gained a sentence saying so.
