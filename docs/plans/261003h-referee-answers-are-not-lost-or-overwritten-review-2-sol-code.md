- **CR-1 — P1 — FIXED.** The superseded fallback could send a newer revision’s claims into a tab displaying the original prose, leaving citations unresolvable. [routes.ts:4914](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-6a-referee-answers/src/routes.ts:4914) now requires matching fingerprints before returning a terminal row; otherwise it sends `CLAIMS_SUPERSEDED` with no claims. Split the regression coverage into same-revision handoff and different-revision reload cases in [referee-routes-postgres.test.ts:304](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-6a-referee-answers/tests/referee-routes-postgres.test.ts:304). The original test’s different hash and empty claims concealed this defect.

- **CR-2 — P2 — REPORTING, nonblocking client follow-up.** [ClaimsPanel.tsx:404](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-6a-referee-answers/src/web/ClaimsPanel.tsx:404) offers “Try again” beside the reload instruction. Clicking it starts another paid run and supersedes the newer pending run. This follows the accepted replacement policy, but offers competing recovery actions. Left untouched as requested.

- **CR-3 — P3 — REPORTING, outside stage.** [pg.ts:382](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-6a-referee-answers/src/store/pg.ts:382) still lists Claims among four stores holding the article lock.

No further shape mismatch found in callers, exports, bundles, admin or cost paths. The atomic Claims upsert needs no replacement article mutex. The fallback `load()` is guarded; its rejection remains contained after headers are sent.

Validation: the real-handler reproduction failed before CR-1’s fix and passed afterward; 21 Search unit tests and the complete typecheck passed. Scoped lint reported existing complexity notices only. PostgreSQL regressions remain yours to run. No commits; only the two files above changed.

READY WITH THESE FIXES