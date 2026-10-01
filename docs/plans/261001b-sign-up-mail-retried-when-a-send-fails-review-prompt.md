Read-only plan review. Do not edit files.

Review docs/plans/261001b-sign-up-mail-retried-when-a-send-fails.md against src/arrivals.ts,
src/email.ts, src/after-response.ts, the call site in src/routes.ts (noteArrival), and
tests/reader-arrivals.test.ts.

Is the proposed fix (release the ledger claim — delete the row this request inserted and forget the
cache entry — when the announcement result is failed, thrown, or skipped for a reason other than
"not production") correct and the simplest right thing? Look especially for: races between instances
when releasing (could the delete remove a row another instance just re-inserted? duplicate mails?),
a release that itself fails, the cache, whether the "skipped" rule is right, and the per-request
retry cost. Prioritised findings, P0/P1/P2, concise.
