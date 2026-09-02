# Review request: Stripe payments plan

You are reviewing a **plan document before anything is built**:
`docs/plans/260902i-stripe-payments-and-subscription-tiers.md`. Read it in full first.

Context to ground yourself in (read as much as you need):

- `AGENTS.md` — project rules; note "prefer boring", "simpler first", and that identity is
  Supabase Auth with no local users table.
- `docs/project/auth.md` — how `requireUser()` / `setRequestOwner()` / `currentOwnerId()` work.
- `src/routes.ts` — the hand-written dispatcher; `POST /api/jobs` (~line 6589) is the proposed
  quota choke point; the public-routes namespace dispatch (~line 5418) is where the plan proposes
  to add a pre-auth `/api/webhooks/stripe` namespace; `src/public/routes.ts` shows why the
  existing public table (read-only by construction) can't host a webhook.
- `src/jobs.ts` `enqueue()` (~line 1962) — why enforcement is in the route, not here (re-runs of
  single steps on existing articles must not spend quota).
- `src/db/schema.ts` — `reader_profiles` (per-owner singleton precedent), `articles`, `uploads`,
  `ai_calls`.
- `docs/project/deployment.md` — Vercel single-function deployment, `NODEJS_HELPERS=0` raw bodies.

The product decisions (one paid tier, 3 lifetime free ingests, successful-ingest quota unit, hard
block, reading never gated) are **already made by Greg — do not relitigate them**. Review the
plan's *engineering*:

1. **Correctness of the Stripe design.** The four-webhooks → one `syncSubscriptionFromStripe`
   pattern; lazy customer creation with owner uuid in `client_reference_id`/metadata; entitled
   statuses `active`/`trialing`/`past_due`; billing-period quota anchor. What breaks? Ordering,
   retries, duplicate customers for one owner, subscription replaced vs updated, checkout
   abandoned, refunds/disputes, clock issues around period boundaries?
2. **Security.** The webhook is unauthenticated-by-signature in a new pre-auth namespace — what
   must the plan pin down so this doesn't widen the attack surface? Any quota-bypass path the
   choke-point choice leaves open (CLI/scripts call `enqueue()` directly — is that acceptable as
   dev-only)? Anything about trusting `client_reference_id` round-trips?
3. **Schema.** Is the `subscriptions` table shape right? The plan defers "hard delete vs archive"
   for quota counting to implementation — is the proposed append-only `ingest_events` ledger the
   right fallback, and should it just be built unconditionally?
4. **Sequencing and testability.** Are the stages ordered to front-load risk? What's missing from
   the test lists — especially tests that would catch silent-success failures (webhook 200s while
   writing nothing; sync function that reads test-mode Stripe in prod; signature check that
   passes because the body was re-encoded)?
5. **Simpler alternatives the plan should have named but didn't**, and any place the plan is more
   complex than the requirement.

Be concrete: name files/sections of the plan and say what to change. Rank findings by severity
(P1 blocking, P2 should-fix, P3 nice). End with a one-line verdict: approve / approve-with-changes
/ rework.
