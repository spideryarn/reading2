SHIP AFTER MY FIXES

P0: None.

P1 findings:

1. [src/billing/sync.ts:353](/home/greg/code/spideryarn2/.claude/worktrees/fb6t-admin-signup-email/src/billing/sync.ts:353) — upgrade notifications previously put Resend’s 10-second timeout before Checkout confirmation, admission resync, and webhook responses. Added a request-scoped after-response queue in [src/after-response.ts:45](/home/greg/code/spideryarn2/.claude/worktrees/fb6t-admin-signup-email/src/after-response.ts:45). Notifications now start after normal and streaming responses end, while the serverless invocation remains alive.

2. [src/billing/tiers.ts:379](/home/greg/code/spideryarn2/.claude/worktrees/fb6t-admin-signup-email/src/billing/tiers.ts:379) — an `active` subscription with a stale period would incorrectly trigger an upgrade notice despite granting no entitlement. `planUpgrade` now requires a current period, using the sync’s existing `now`.

P2 findings:

1. [src/arrivals.ts:35](/home/greg/code/spideryarn2/.claude/worktrees/fb6t-admin-signup-email/src/arrivals.ts:35) — the process cache was unbounded. It now retains at most 10,000 IDs; eviction only causes a later indexed ledger no-op.

2. [src/email.ts:108](/home/greg/code/spideryarn2/.claude/worktrees/fb6t-admin-signup-email/src/email.ts:108) — Resend error bodies could echo submitted addresses into logs. The body is consumed but discarded; only status and notification label are logged.

3. Tests lacked independent witnesses for response ordering, committed state, stale periods, nullable `auth.users.created_at`, and the Resend network guard. Added those checks in [tests/billing-upgrade-notice.test.ts:214](/home/greg/code/spideryarn2/.claude/worktrees/fb6t-admin-signup-email/tests/billing-upgrade-notice.test.ts:214), [tests/reader-arrivals.test.ts:118](/home/greg/code/spideryarn2/.claude/worktrees/fb6t-admin-signup-email/tests/reader-arrivals.test.ts:118), and [tests/no-provider-calls-guard.test.ts:165](/home/greg/code/spideryarn2/.claude/worktrees/fb6t-admin-signup-email/tests/no-provider-calls-guard.test.ts:165).

The migration itself is sound: it runs as `postgres`, inherits the verified default DML grants for `spideryarn_app`, keeps the Auth FK hand-written, and uses `coalesce(created_at, now())` for null timestamps.

Validation:

- All four TypeScript projects passed.
- Focused unit tests: 39 passed.
- Resend/Stripe provider-guard witness passed.
- Production client and API build passed.
- Scoped lint passed, with four pre-existing complexity advisories in `src/routes.ts`.
- Database-backed focused tests could not run because this sandbox denied access to local Postgres with `EPERM`; no database or remote state was changed.

All fixes remain uncommitted in the working tree.