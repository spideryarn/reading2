## Verdict

**1. Cody’s silence was by design, not a runtime bug. High confidence.**

- The app inserts only `owner_id`; PostgreSQL supplies `first_seen_at = now()` ([arrivals.ts:56](/home/greg/code/spideryarn2/src/arrivals.ts:56), [migration:5](/home/greg/code/spideryarn2/drizzle/20260930144303_reader_arrivals.sql:5)).
- The backfill explicitly copies `auth.users.created_at` ([migration:28](/home/greg/code/spideryarn2/drizzle/20260930144303_reader_arrivals.sql:28)).
- Cody’s app insertion could not predate his `last_sign_in_at`, approximately 377 ms after `created_at`. Therefore a value exactly equal to `created_at`, to the microsecond, is effectively conclusive evidence of the backfill—not `recordArrival`.
- The earlier `0930g` deploy shipped `4afd1829` and applied only `crossrefs` and `article_high_power_since` ([log:38](/home/greg/code/spideryarn2/logs/tmux-jobs/deploy-0930g-1547-3092414.log:38)). Git confirms `reader_arrivals` was introduced later in `aca27e7a`, which is not an ancestor of `4afd1829`.
- `0930h` explicitly found and applied `reader_arrivals` before pushing `e3074a82` ([log:33](/home/greg/code/spideryarn2/logs/tmux-jobs/deploy-0930h-1847-439990.log:33)). Cody existed before that deploy even began.
- `0930i` then found nothing pending ([log:33](/home/greg/code/spideryarn2/logs/tmux-jobs/deploy-0930i-1945-899308.log:33)).

Thus the migration saw Cody, backfilled him, and every later request correctly found “already arrived.”

The narrower claim “no sign-up email has ever been sent in production” is true for all accounts currently present. Strictly, current tables cannot rule out a post-deploy account that was subsequently deleted, because the arrival row cascades on deletion. Resend/audit logs would be needed to prove the absolute statement.

## Post-deploy failure paths

**Normal Google sign-in is covered.** Once a session appears, the app-wide job engine starts ([App.tsx:83](/home/greg/code/spideryarn2/src/web/App.tsx:83), [useJobs.ts:209](/home/greg/code/spideryarn2/src/web/useJobs.ts:209)) and immediately requests `GET /api/jobs` ([jobEngine.ts:765](/home/greg/code/spideryarn2/src/web/jobEngine.ts:765), [jobEngine.ts:840](/home/greg/code/spideryarn2/src/web/jobEngine.ts:840)). That is a recognized authenticated route ([routes.ts:9196](/home/greg/code/spideryarn2/src/routes.ts:9196)). A normal completed callback therefore does not depend on visiting the shelf.

Concrete ways a later account could still produce no received mail:

- **No authenticated API request completes:** unconfirmed email signup; Google callback closed immediately; offline/network failure; or JavaScript failure before the job request.
- **Only an unsuccessful request reaches the server:** `noteArrival` runs only after an authenticated handler successfully returns and `dispatchAuthRoute` says true ([routes.ts:9791](/home/greg/code/spideryarn2/src/routes.ts:9791)). A throwing handler, unknown route, forbidden non-admin `/api/admin/*`, or public endpoint does not count.
- **Most important bug:** the ledger row is committed before mailing ([arrivals.ts:87](/home/greg/code/spideryarn2/src/arrivals.ts:87)). `sendEmail` returns `failed` or `skipped` rather than throwing ([email.ts:110](/home/greg/code/spideryarn2/src/email.ts:110)), but `noteArrival` ignores that result and retains both the database row and memory-cache entry ([arrivals.ts:96](/home/greg/code/spideryarn2/src/arrivals.ts:96)). A transient Resend failure therefore suppresses every retry permanently.
- **Accepted is not delivered:** a Resend 2xx logs “sent,” but mail can subsequently bounce, be filtered, or fail in the `hello@` forwarder. The default destination is `hello@spideryarn.com`, unless `SPIDERYARN_ADMIN_EMAIL` overrides it ([email.ts:153](/home/greg/code/spideryarn2/src/email.ts:153)).
- **Crash window:** termination after inserting the ledger row but before/during sending also loses the notification permanently.

`VERCEL_ENV` is not suspicious: production plus the present key passes `whyNotSend` ([email.ts:96](/home/greg/code/spideryarn2/src/email.ts:96)). The after-response plumbing also looks sound: its `finally` drains and awaits all tasks ([after-response.ts:45](/home/greg/code/spideryarn2/src/after-response.ts:45)), and the Vercel handler awaits `handleApi` ([vercel.ts:349](/home/greg/code/spideryarn2/src/vercel.ts:349)).

## Cheapest improvements first

1. **Run one deliberate production smoke email and verify “delivered” in Resend**, including the `hello@` forwarding path. The code path has not yet received a real production exercise.
2. **Stop treating `failed`/`skipped` as announced.** At minimum, release the ledger claim and memory entry so another request retries.
3. **For crash safety, separate “first seen” from “announced”:** add `announced_at`/attempt state and retry unfinished rows. The current row conflates those two facts.
4. **Move arrival scheduling to immediately after successful authentication**, rather than after a recognized handler succeeds. Then a verified stale/404/broken request still records a genuine arrival.
5. Only if delivery certainty matters, add Resend delivery/bounce webhooks; HTTP acceptance alone cannot establish inbox receipt.

No files were changed.