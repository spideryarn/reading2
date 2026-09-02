# Stripe payments and subscription tiers

## Goal, context

Introduce payments: a freemium model with two paid tiers, processed by Stripe.

| | ingests | USD | GBP | EUR |
|---|---|---|---|---|
| **Free** | 3, lifetime | — | — | — |
| **Reader** | 20 / month | $10 | £8 | €9 |
| **Researcher** | 150 / month | $50 | £40 | €45 |

Reading is never gated. Greg, 2026-09-02:

> To be clear: if a user has hit their quota, they should still be able to read their existing
> and Public-readable articles, just not incur extra spend.

**The Reader quota was 100 until measurement arrived.** The original figure was explicitly a guess.
Greg, 2026-09-02:

> Right now I have no idea of the costs involved for uploading an article … I was thinking
> something like $10 a month allows you to upload 100 articles. In practice, that might actually
> mean that we're working at a loss depending on how much it costs to upload an article, but I'm
> assuming that most people won't max it out.

Then a number came back, and the guess turned out to be off by enough to matter — at ~£1 an
article, 100 ingests for $10 loses about £90 a month per user who uses it. Greg, same day:

> it can cost £1 to fully process an article, so let's say that the $10 plan gets you 20 articles
> (which we can always increase later)

…and a second tier for people who read for a living:

> let's also add a $50 (and appropriate GBP) tier for 150 articles per month

**Raising a quota later is one line** in `PAID_TIERS` — no Stripe object, no migration. Being
generous later is cheap; being generous now is the expensive mistake to unwind. The currency
reasoning, and the recipe for adding a tier, are in
[billing.md](../project/billing.md#adding-a-tier-or-a-currency).

Cost-tracking and cost-estimating are **out of scope** — other agents are working on those. This
plan is the billing machinery: Stripe integration, a billing-account record per owner, and quota
enforcement at the ingest choke points.

**Status (2026-09-02)**: reviewed three times before building — GPT Sol on the plan (verdict:
rework — [review](260902i-stripe-payments-and-subscription-tiers-review-sol.md)), **Fable against
the code**, and then **Sol again on the quota mechanism alone**
([review](260902i-quota-admission-design-review-sol.md),
[prompt](260902i-quota-admission-design-review-prompt.md)) — that last one found a quota bypass and
three lifecycle races in the design Fable's review had produced, and its findings are in *Quota
accounting* below. Each round was cheap and each found something the one before could not; the
pattern is worth copying rather than the specific findings. Sol's hardening was sound but written in
mechanisms this repo does not use, and one of its rules could not be implemented as stated. Both
sets of findings are folded in below and marked where they landed. Every product question is
decided — nothing is waiting on Greg. The first stage is built (✅); the build is in the worktree
`stripe-payments`.

**What Fable changed, in one place so it is not scattered:**

1. **Postgres advisory locks → `select … for update` row locks.** This repo has no advisory locks
   in production code; its cross-instance serialisation idiom is a row lock, and the worked example
   is `src/store/pg-jobs.ts` (~`:445`) taking `for update nowait` on the `queue_state` singleton.
   Same guarantee, house mechanism, none of the pool/connection-pinning traps that
   `tests/helpers/run-lock.ts` exists to document.
2. **"Admit and insert the job in the same transaction" cannot be built.** The insert is
   `enqueueOrGet` (`src/store/pg-jobs.ts` ~`:362`), which is deliberately **not** a transaction —
   it is a bounded retry loop of two pooled statements around `on conflict do nothing`, reached
   only after `enqueue()`'s own slug loop, and it has a filesystem twin pinned by
   `tests/store-jobs-parity.test.ts`. Admission therefore happens **at the route**, serialised per
   owner by `for update` on that owner's `billing_accounts` row, held across the count and the
   `enqueue()` call. Verified rather than taken on trust.
3. **The ledger is not optional, and the reason is stronger than the plan said.** Jobs are
   *reader-deletable* — `DELETE /api/jobs/:id` → `forgetJob` — so any count derived from job rows
   is erasable by the person being counted. The ledger is the abuse boundary.
4. **Two pieces of Checkout hardening dropped as over-built** — see the Checkout stage.
5. **The files-store hole**, which neither earlier review saw: see *Billing is a Postgres feature*
   below. It was the one unplanned thing that would have cost an afternoon.

### Where the build stands

*Last updated 2026-09-02 17:45. The date is in the text rather than the heading so that links to
this section survive it being updated — an earlier dated heading broke `billing.md`'s link on the
first edit, which is what `tests/doc-links.test.ts` is for.*

**Verdict: important work left.** Everything that can be built without the database is built,
reviewed twice and committed. What remains is the half a reader can see — admission wired into
the ingest route, settlement wired into the publish transaction, the checkout and portal routes,
and `/profile` — plus the Postgres suite, which has never actually run.

**98 billing tests pass; the Postgres suite skips** — a real vitest skip, not a false pass. That
skip is the single biggest weakness in this work and it should not be talked around: the
concurrency guarantee has been measured with a standalone two-connection spike, but
`tests/billing-quota-race.test.ts` has not once executed against the real code. Nothing here goes
near real money until it has.

**Reviewed as built** ([review](260902i-stripe-code-review-sol.md)): GPT Sol's verdict on the code
was *"I would not ship the quota path yet"*, and it found six real defects — a release that could
free a slot a job was spending, a settlement that updated without checking, an entitlement read
outside its own lock, a subscription picker that could drop a paying reader to free, a usage count
that defaulted to zero, and a subscription list that fetched one page while claiming to fetch all.
All fixed. It also found **eleven comments that claimed more than the code did**, which is the
finding worth remembering: this file's own rules say a confidently wrong comment is worse than
none, and a dozen had accumulated in a day.



Worktree `stripe-payments`, branch `worktree-stripe-payments`.

**What exists**, all of it on `dev` or about to be:

| | |
|---|---|
| Stripe objects | Product, $10/mo price, Customer Portal configuration, created in test mode by [`scripts/stripe-setup.ts`](../../scripts/stripe-setup.ts) and idempotent by `lookup_key`. A Checkout Session and a Portal session were both minted by hand to prove the account works end to end. |
| [`src/billing/stripe.ts`](../../src/billing/stripe.ts) | The only place a client is constructed. Pinned API version, mode guards, 10-second timeout. |
| [`src/billing/tiers.ts`](../../src/billing/tiers.ts) | What each tier allows. `Entitlement` is a discriminated union, so a period start without an end is a state the compiler refuses. |
| [`src/billing/subscription.ts`](../../src/billing/subscription.ts) | Reading a Stripe subscription, where the Basil period-move trap lives. Refuses everything unrecognised, towards free. |
| [`src/billing/webhook.ts`](../../src/billing/webhook.ts) | Verification over the exact bytes, its own raw-body reader, fail-closed on an unset secret, and the route itself at an exact pre-auth path. |
| [`src/billing/sync.ts`](../../src/billing/sync.ts) | Ask Stripe, write it down, under the customer's row lock. **Never executed.** |
| [`src/store/pg-billing.ts`](../../src/store/pg-billing.ts) | Reserve, settle, count. The lock, and the anchor row created before it. **Never executed against a database.** |
| schema + 2 migrations | `billing_accounts`, `ingest_events`, `jobs.ingest_event_id` with a composite FK. **Generated, never applied.** |
| `pay-` copy | Three messages, registered in `CODE_KINDS` so none arrives with a Retry button that cannot work. |
| [billing.md](../project/billing.md) | The evergreen doc, under [security-map.md](../project/security-map.md). |

**What has never run**: `tests/billing-quota-race.test.ts` and the foreign-key assertions in
`tests/db-schema.test.ts`. Both wait on the migration, which waits on an unrelated session's
unpushed migrations in the shared local database — the third time today that has blocked somebody
([the pattern is worth a plan of its own](#the-coordination-problem-this-work-kept-hitting)).
**Next**, in order:

1. `npm run db:migrate`, then **run `tests/billing-quota-race.test.ts`** — the first time the
   mechanism is exercised through the real code rather than the standalone spike. Do not skip
   past this because the spike passed; they are different things.
2. The settlement tests Sol asked for and nobody has written: reserve a slot, attach it to a real
   job, and assert that `done` publishes *and* charges in one commit, that `error` and cancel
   release, that an injected settlement failure rolls back the publication, and that a cancel
   racing a final publication settles exactly once.
3. `reserveIngest` into `POST /api/jobs`; `settleReservation` into both branches of `settleIn`;
   `ingestEventId` threaded through `EnqueueRequest` → `enqueue()` → the job INSERT. Retries go
   through admission like anything else.
4. Checkout and portal routes — **and the customer→owner mapping must be durable before a
   Checkout Session exists**, not written by the browser's return callback, which is not reliable
   (Sol, and the webhook's "unmapped" case assumes it).
5. `/profile`, browser check, admin columns.
6. Comp subscriptions, then go-live.

### The coordination problem this work kept hitting

Not part of this plan, and worth someone's attention. Three separate sessions blocked
`npm run db:migrate` for everybody today by applying a migration to the shared local Postgres and
not pushing it — the guard fails closed on a ledger row belonging to no migration in the journal,
which is correct and which nobody can clear but the owner. Add the forked snapshot chain that
arrived the same afternoon and roughly two hours went on it across four sessions.

The rule that would have prevented all of it is one line — *push a migration in the same breath as
applying it* — and there is nowhere in the docs that says so. The deeper fix is a database per
worktree, which [worktrees.md](../project/worktrees.md) shows is harder than it looks because of
the `auth.users` foreign keys, and which
[260902c](260902c-concurrent-migrations-across-worktrees.md) already owns.

## Picking this up

For an agent starting fresh, with no other context than this doc:

1. Read [AGENTS.md](../../AGENTS.md) — especially *Working in a tree several agents share* and
   *Before you call it finished*. This is a multi-stage build: use a worktree
   (`claude --worktree stripe-payments`, then `npm run worktree:setup`), run it the
   [engineering-manager.md](../reusable/engineering-manager.md) way, commit each stage, land with
   `git push origin HEAD:dev`.
2. **What already exists** (first stage, all ✅ below): a Stripe account (Greg's, test mode) with
   the product, price and portal configuration created; `STRIPE_SECRET_KEY` and
   `STRIPE_PRICE_READER` on the `gjd-remote push-env` allowlist and in `.env.example`; the
   `stripe` package, the Stripe CLI, `src/billing/stripe.ts`, `scripts/stripe-setup.ts` and the
   `/api/health` mode check. **What does not**: any of the database schema, the webhook, the
   quota, the routes or the UI.
   **One thing to check before your first run**: `STRIPE_PRICE_READER` was added to the
   *worktree's* `.env.local`. If yours does not have it, run
   `npx tsx scripts/stripe-setup.ts` — it is idempotent and prints the line.
3. **The stages below are in build order** — start with the unfinished items of the first stage
   (Stripe CLI, product/price/portal via API), then the thin end-to-end round trip. Tests first
   in every stage, watched red before the fix ([AGENTS.md](../../AGENTS.md)); reader-visible
   work runs `SPIDERYARN_STORE=postgres`.
4. The **decisions in this doc are settled** — with Greg for the product, via review for the
   engineering. Do not relitigate them; if implementation contradicts one (e.g. a Stripe API
   shape has moved again), stop and say so rather than quietly diverging.
5. When the code is built, send the **diff** back to GPT Sol
   ([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)) — the second review is
   required and weighted higher than the plan review. Then update this doc's checkboxes and the
   evergreen docs named in the admin/docs stage.

## References

- [auth.md](../project/auth.md) — identity is Supabase Auth; every row's owner is a `uuid` into
  `auth.users`. There is no local users table; `reader_profiles`
  ([`src/db/schema.ts`](../../src/db/schema.ts), keyed by `ownerId` as PK) is the existing
  per-owner singleton a `billing_accounts` table parallels.
- [`src/routes.ts`](../../src/routes.ts) — the hand-written dispatcher. `POST /api/jobs`
  (~`:6589`) is the ingest admission point (both URL and PDF-upload shapes); `POST /api/uploads`
  (~`:6573`) mints PDF staging uploads and gets a non-reserving eligibility check. The
  public-routes namespace (`src/public/routes.ts`, dispatched before the auth gate) is
  **read-only by construction**, so the Stripe webhook is an **exact-route** pre-auth match, not a
  namespace.
- [`src/jobs.ts`](../../src/jobs.ts) `enqueue()` — also reached by CLI/scripts and by *re-runs* of
  single pipeline steps on existing articles; those must not spend quota. `Job.url` cannot carry
  "this is a new ingest" (re-runs recover the URL too), hence the durable `counts_as_ingest`
  provenance below.
- [`src/store/pg-session.ts`](../../src/store/pg-session.ts) (~`:444`) — the transaction that
  publishes a revision and finishes a job; the ingest-success ledger insert joins it.
- [`src/store/pg-admin.ts`](../../src/store/pg-admin.ts) — per-owner `count(*)` machinery.
  [admin.md](../project/admin.md), [`src/admin.ts`](../../src/admin.ts),
  [`src/web/admin-columns.tsx`](../../src/web/admin-columns.tsx) — where plan/status/usage columns
  go.
- [`src/ai-spend.ts`](../../src/ai-spend.ts) + `ai_calls` ledger — the existing per-owner spend
  substrate; adjacent, not touched by this plan.

- [deployment.md](../project/deployment.md) — env-var table (~`:559`), `NODEJS_HELPERS=0` (raw
  bodies, which Stripe signature verification needs), `/api/health`.
- [t3dotgg/stripe-recommendations](https://github.com/t3dotgg/stripe-recommendations) — the
  sync-function pattern adopted (and hardened, per the review) below. Stripe docs:
  [Checkout](https://docs.stripe.com/payments/checkout/how-checkout-works) ·
  [Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal) ·
  [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) ·
  [webhook signatures](https://docs.stripe.com/webhooks/signature) ·
  [Basil changelog: subscription period fields moved to items](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end) ·
  [idempotency](https://docs.stripe.com/api/idempotent_requests) ·
  [CLI webhook testing](https://docs.stripe.com/cli/intro_webhooks).

### Note from the cost-tracking plan, 2026-09-02

Left here by the agent on
[260902g-cost-tracking-that-can-set-a-price.md](260902g-cost-tracking-that-can-set-a-price.md), so
these are not discovered in a merge. That plan owns the ledger's integrity, metering live
conversation, and the spend reporting. **Three things bear on this one:**

- **`ai_calls` is COGS attribution, not a customer billing ledger** — GPT Sol's framing, and worth
  keeping. A fixed subscription invoice reconciles against Stripe subscription state; do not derive
  an invoice from model calls. Your quota unit (successful new ingests) is the right shape for
  exactly this reason.
- **We both want columns in
  [`src/web/admin-columns.tsx`](../../src/web/admin-columns.tsx).** That plan's Stage 3 adds a
  per-owner spend column (current UTC month, with a visible partial/unpriced marker). Yours adds
  plan/status/usage. **This plan owns that file** — the spend column will be added last and will
  follow whatever shape you land, or be dropped if it would collide. Say if you would rather it
  waited entirely.
- **A per-owner spend aggregate is being built** (`GROUP BY owner_id` over an arbitrary half-open
  `[start, end)`, because billing periods are not calendar months). If you later want cost beside
  quota, use that rather than writing a second one — and note the trap it exists to avoid:
  `upstream_inference_nanos` is populated on non-BYOK rows too, so a naive `SUM` of the money
  columns roughly doubles the answer. Until that stage lands, the only correct summing lives in
  `totalRows()` ([`src/store/ai-calls.ts`](../../src/store/ai-calls.ts)).

**And one product finding, offered rather than pressed.** Measurement so far says an article's cost
is not fixed at upload: `DEFAULT_INGEST_STEPS` is five steps of which only `hierarchy` pays
(~$0.05–0.36 depending on length), while arc, glossary, quotes, ideas, timeline, quiz and sketch are
reader-triggered, as are chat, explain, search, quiz-marking, referee and dictation. **Live
conversation is in a different economic class again** — roughly $0.06–$0.46 a *minute*, so one
20-minute session can cost more than twenty article uploads, and it is currently unmetered. An
ingest quota does not bound any of that. Sol's suggestion, for whenever tiers are set: price the
text-reading subscription from base upload plus engaged-text p95, and treat **voice** as a separate
allowance or a beta feature, with ingests kept as an abuse boundary rather than the economic model.
Numbers to price against are coming from
[260902g-estimate-article-ingestion-and-mode-generation-costs.md](260902g-estimate-article-ingestion-and-mode-generation-costs.md).

## Principles, key decisions

Product decisions agreed with Greg 2026-09-02; engineering hardening from the Sol review, checked
before adoption.

### Product

- **One paid tier at launch.** Simpler option taken; a second tier waits until someone wants it.
  The tier→quota map is app config keyed by Stripe price id, so adding one later is a config row,
  a price in Stripe, and portal configuration — not a schema change.
- **Free = 3 ingests, lifetime** (not per month). Matches "just to play around"; no period logic
  for free users.
- **Quota unit: successful new ingests** (URL or PDF). Re-running pipeline stages on an existing
  article is free. Deleting or archiving an article does not refund the slot.
- **At the limit: hard block with an upgrade prompt.** Refusal carries clear copy
  ([copy.md](../project/copy.md)) — upgrade link for free users, reset date for paid. No overage,
  no grace band in v1. **Reading is never blocked** (Greg's quote above).
- **Hosted Stripe Checkout + hosted Customer Portal; we never touch card data.** The entire
  custom billing UI is two redirect buttons. Billing/invoice history, receipts, payment-method
  changes and cancellation are all the Stripe-hosted Portal's job, not ours; the portal is
  configured for end-of-period cancellation so nobody loses access they've paid for. Card details
  never reach our servers — we store only opaque Stripe ids — which keeps us in Stripe's lightest
  PCI scope (SAQ-A). **Checkout is card-only in v1**, so no asynchronous payment-method events
  exist. Greg, 2026-09-02:

  > make sure we have all the machinery we might need (ideally making as much use of Stripe as
  > possible rather than building ourselves) for people to see their billing history, change
  > payment methods, cancel subscriptions, etc etc. And we want to minimise our infosec risk,
  > i.e. we don't want to process/touch/store sensitive info like card details.
- **Set up via API, not by hand, wherever Stripe allows.** Product, price, Customer Portal
  configuration and the production webhook endpoint are all creatable through the Stripe API with
  the secret key, so the agent does those; Greg's manual surface is the account itself, the keys,
  and the few dashboard-only settings (customer email receipts, dispute auto-cancellation,
  dunning, live-mode activation).
- **Refunds/disputes/dunning, v1 policy**: refunds are manual and must be paired with a
  cancellation when access should end; Stripe's automatic subscription-cancellation on dispute is
  enabled; dunning is configured so `past_due` eventually becomes `canceled`/`unpaid` (which are
  not entitled) rather than cycling forever.
- **Known hole, accepted for v1**: chat, comments, quizzes and search spend AI money and are not
  gated, so a free user with 3 articles can still incur unbounded spend. Deliberately deferred
  until the cost-tracking work lands; the natural future choke point is the AI gateway
  ([ai-gateway.md](../project/ai-gateway.md)).

### Billing is a Postgres feature, and says so out loud

The store flag still has a `files` setting, it is still the default in `src/store/index.ts`, and
`tests/store-jobs-parity.test.ts` exercises both halves. Quota does not work there: the ledger
insert joins the *Postgres* publish transaction (`pg-session.ts` ~`:444`), which has no filesystem
counterpart, and admission counts Postgres job rows.

**So quota is enforced when `SPIDERYARN_STORE=postgres`, and not otherwise** — one implementation,
no second code path, and no pretending. The two alternatives are worse: writing a filesystem ledger
is the two-implementations-of-one-count trap this plan already rejected once, and refusing every
ingest in files mode would break every default-configured laptop and most of the suite for a
feature it is not testing.

**And the hole this leaves cannot exist in production**: `src/store/index.ts` throws at *import*
when a filesystem store is live in production, so the app does not start rather than serving
unmetered ingests. Locally it is visible — `/api/health` already warns that
`SPIDERYARN_STORE is '…'`, and CLAUDE.md has told every agent to run `postgres` since the move
began. Documented in `docs/project/billing.md` rather than left to be discovered.

### Quota accounting (reworked per Sol P1.1, P1.7, P2.5, then Fable)

- **An unconditional append-only `ingest_events` ledger** is the source of truth for "successful
  ingests": immutable id, `owner_id`, unique successful job identity, `succeeded_at`
  (`default now()`), `article_id` (`on delete set null`) plus a diagnostic slug snapshot. A
  mutable slug is never its identity. One ledger, every environment — soft-archive is today's
  deletion story but hard deletes exist in maintenance/tests, and one mechanism beats two
  conditional ones.
- **The reservation is written first and settled last.** A row is inserted at admission
  (`reserved_at`), and gets exactly one of `succeeded_at` or `released_at` when the job ends. So
  the ledger is both the record of what was charged *and* the mechanism that stops a burst: an
  unsettled reservation counts against its owner, so a second concurrent request sees the first
  one whether or not it has reached `enqueue()` yet.
- **Provenance is `jobs.ingest_event_id`, written by the job's own INSERT.** No boolean on the
  job, and no `job_id` on the ledger. Sol's third review, 2026-09-02, showed the reverse
  direction — reserve, enqueue, then `update … set job_id` — is broken three ways: a job that
  *published before* the follow-up update was never charged (the local pump starts immediately,
  and an all-cached job finishes in milliseconds); a crash in that gap left a runnable job nobody
  paid for; and two duplicate Adds that `enqueueOrGet` deduplicates into one job pointed two
  reservations at it, so one publication settled both. Writing the id in the job's own INSERT is
  atomic without needing a transaction, which is what makes it fit `enqueueOrGet` as it is.
  `jobs_ingest_event_unique` (partial, on non-null) makes "one job per slot" a constraint rather
  than an intention. A **null** id means "spends no quota": CLI work, a step re-run, seeding —
  they settle nothing, and there was never a flag to forget.
- **Settlement joins the transaction that ends the job** — `settleIn()` in `pg-session.ts`
  (~`:423`–`:471`), *both* branches, not just `done`. Sol's finding: releasing from anywhere else
  loses a race the code deliberately allows. A Stop during the last step may still finish as
  `done`; if `/cancel` released the reservation from outside, the publication would then find it
  released and charge nothing. Success and release in the same transaction as the terminal
  transition means whichever one wins the job fence is the one whose settlement lands.
- **Admission is serialised per owner at the route**, not inside the job store: `insert … on
  conflict do nothing` the owner's `billing_accounts` row, `for update` it, count, insert the
  reservation, commit — then call `enqueue()` outside. **The anchor row is created before it is
  locked**, because a free reader has no billing row and
  [a `for update` that matches nothing locks nothing](../postmortems/260901f-a-for-update-that-locks-nothing.md)
  — which would leave the boundary decorative in exactly the case it exists for. Measured with two
  real connections on 2026-09-02: the second transaction blocks for as long as the first holds the
  row, then reads its committed value. `tests/billing-quota-race.test.ts` keeps that measurement.
  This replaces Sol's own earlier "insert the job in the same transaction", which `enqueueOrGet`
  cannot honour, and which would deadlock the pool at `DATABASE_POOL_MAX` (5) anyway.
- **Nothing that opens its own transaction or touches the network may be called between the lock
  and the commit.** That is the rule that keeps the pool argument true, and it is the one a later
  change is most likely to break.
- **An unsettled reservation never expires**, and an earlier draft of this plan gave it six hours.
  Sol showed that was a plain bypass, not a safety valve: hold 100 jobs queued for six hours,
  reserve 100 more, and 200 can succeed in one period — repeatable in cohorts, and *easier* the
  more contended the queue is. So a leaked reservation costs its owner one slot for ever, which is
  a support conversation; the bypass would have cost unbounded model spend. A reconciliation that
  frees only reservations *provably* without a job is possible later, because `ingest_event_id`
  makes "without a job" a query rather than a guess.
- **Retry is an ordinary admission.** `POST /api/jobs/:id/retry` mints a *fresh* reservation, and
  the failed attempt's was released when it failed — so a failure costs nothing and the eventual
  success costs exactly one. No lineage column, no reactivating a released row. An earlier draft
  exempted retries entirely; Sol was right that a retry which can incur spend must go through the
  gate.

**Known limit, stated rather than solved**: because a failure releases its slot, a caller who can
reliably make expensive ingests *fail* can repeat for ever. That is true of every design we
considered — the quota counts successes because that is the product rule — and the answer when it
matters is a daily attempt cap, not a change here.
- **Period arithmetic is half-open on database time**: `succeeded_at >= start AND < end`. If the
  stored period does not contain `now`, resync from Stripe once synchronously; if there is still
  no current period (or Stripe is down), **fail closed with 503** rather than allow spend — a
  stale period must become neither an unlimited window nor a false block on a valid renewal.
- **`POST /api/uploads` gets a non-reserving eligibility check** so an at-quota account cannot
  mint staging uploads repeatedly; the authoritative admission stays at `POST /api/jobs`.

### Stripe state (reworked per Sol P1.2, P1.3, P1.6, P2.2)

- **One `billing_accounts` row per owner, retained after cancellation**: `owner_id` PK,
  `stripe_customer_id` (unique), `stripe_subscription_id` (unique, nullable), `price_id`, raw
  Stripe `status` as **text** (entitlement derived from an exact allowlist, so an unknown future
  status fails to free rather than breaking an enum), `current_period_start/end`,
  `cancel_at_period_end`, `livemode`, `last_synced_at`, timestamps; check `period_start <
  period_end`.
- **Entitled statuses: `active`, `trialing`, `past_due`**; anything else (or no row) is free
  tier. We never delete articles on downgrade.
- **Billing period comes from the subscription item, not the subscription** — Stripe's Basil
  release (2025-03-31) removed `current_period_start/end` from the Subscription object. The plan
  pins an exact API version in `src/billing/stripe.ts`; sync validates exactly one supported
  recurring item at quantity one, and any unknown price/quantity/item combination **fails closed
  to free**, logged, rather than accidentally receiving Reader quota.
- **`syncSubscriptionFromStripe(customerId)` is serialized per customer** by `select … for
  update` on that customer's `billing_accounts` row, held across the **Stripe fetch and the
  write** — fetch-then-overwrite without it lets a slow handler commit stale state after a newer
  one (restoring a cancelled subscription, or reverting a renewal). A row lock rather than an
  advisory lock because that is what this repo already does
  (`src/store/pg-jobs.ts` ~`:445`); the guarantee is Sol's, the mechanism is the house's.
  It lists all the customer's subscriptions and applies a
  deterministic written policy: zero → free (customer mapping retained); one supported → current;
  multiple entitled → anomaly, logged and surfaced, never silently picked from. A late deletion
  event for a replaced subscription resyncs and retains the replacement.
- **Webhook event set (state-oriented)**: `checkout.session.completed`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`. All trigger the same sync; payloads are never trusted for
  state. `invoice.payment_failed` dropped — `past_due` is entitled and status transitions arrive
  via `subscription.updated`.
- **The handler awaits durable sync and returns 2xx only when state is synchronized**; Stripe or
  database failure returns 5xx so Stripe retries. Replays re-run the (idempotent) sync — "no-op"
  means same resulting state, not zero work.
- **Customer creation reuses the mapped customer**, and the unique `stripe_customer_id` plus an
  on-conflict re-read is the whole mechanism — *no lock*. Sol asked for serialisation here and
  Fable was right that it buys nothing: the worst case a double-click can reach is an orphaned
  Stripe customer with no subscription, which costs nothing and is invisible. Checkout is still
  refused (redirected to the Portal) when a non-terminal subscription exists.
  **Reusing an open Checkout Session is dropped too** — it needs stored session state and expiry
  handling to defend against a double-click whose real worst case (two subscriptions) the
  multiple-entitled anomaly policy above already catches, and abandoned sessions expire by
  themselves.

### Security invariants (per Sol P1.4, P1.5, P2.6)

- **Exact pre-auth route `POST /api/webhooks/stripe`** inside the existing `try`, before
  `requireUser()` — not a namespace; sibling paths stay unavailable. The handler: reads a
  size-capped raw `Buffer` once and hands those exact bytes to the SDK (parse-then-re-encode
  breaks signatures); requires both signature header and configured secret, failing **closed**
  when unconfigured; verifies before parsing; allowlists event types; **never calls
  `currentOwnerId()`** (there is no request owner in webhook scope); builds any URLs server-side.
- **The database customer→owner mapping is authoritative.** `client_reference_id`/metadata carry
  the owner uuid as redundant recovery/assertion data only — a webhook never overwrites an
  existing mapping from metadata, and no billing route ever accepts an owner or customer id from
  the browser. The checkout-success callback is authenticated, accepts only a Checkout Session
  id, retrieves it from Stripe, and proves the session's customer maps to the current user before
  syncing.
- **Live/test mode cannot silently cross.** Production refuses a non-live secret key;
  non-production refuses live keys; `event.livemode`, retrieved objects, and the configured price
  must agree; a release check retrieves the configured price and validates active + recurring
  monthly + expected amount/currency/mode. A prod deploy on `sk_test_…` would otherwise grant
  entitlement for test-card purchases while `/api/health` stayed green — the classic
  [silent success](../reusable/silent-success.md).
- **Dev-account exemption is scoped to verified local environment identity**, not a bare uuid
  match that would also fire in production; admin exemption uses the existing server-side
  `isAdmin()`.

### Simpler options passed over

Payment Links (no clean owner-id passthrough or redirect control); polling Stripe on request
instead of webhooks (failures/cancellations wouldn't propagate); counting articles *held* rather
than ingests (a storage cap, incoherent with monthly reset); calendar-month quota (a second clock
disagreeing with billing); conditional article-counting instead of the unconditional ledger (two
implementations of "lifetime count"); async-payment-method Checkout (event surface for nothing we
need); a webhook queue or event-dedupe table (Stripe's retries + idempotent sync suffice at this
scale — revisit only if observability shows a need). And the ones we chose *because* simpler:
exact webhook route over a namespace; hosted surfaces over any owned billing UI.

## Stages & actions

### Stage: Stripe account and environment plumbing (Greg + agent)

- ✅ **Greg (manual, test mode)**: Stripe account created; `STRIPE_SECRET_KEY` in `.env.local`
  on the box and the laptop (2026-09-02).
- ✅ `STRIPE_SECRET_KEY` added to the `gjd-remote push-env` allowlist
  ([`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts)) so future boxes inherit it —
  with a shape-based refusal of any **live**-mode Stripe secret (`sk_live_`/`rk_live_`), under
  any variable name, mirroring the Supabase-JWT check. `STRIPE_WEBHOOK_SECRET` deliberately NOT
  allowlisted: locally it is minted per machine by `stripe listen`, like the admin password.
  Tests in [`tests/gjd-remote-env.test.ts`](../../tests/gjd-remote-env.test.ts), red first.
  `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` documented in `.env.example`.
- [ ] **Greg (dashboard-only, optional now)**: Settings → Customer emails — receipts for
  successful payments, notifications for failed ones. Billing → Subscriptions: enable automatic
  subscription cancellation on dispute; review dunning/retry schedule so `past_due` terminates.
- ✅ Stripe CLI 1.50.8 installed at `~/.local/bin/stripe` (GitHub release tarball; `--api-key`
  mode, no interactive login). **Not on the box's `PATH` by default** — call it by full path, or
  add `~/.local/bin` to `PATH`, which is a change to the file that builds the next box and so is
  Greg's call ([hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md)).
- ✅ [`scripts/stripe-setup.ts`](../../scripts/stripe-setup.ts) creates the product, the $10/mo
  price and the Customer Portal configuration through the API, and is **idempotent by
  `lookup_key`** rather than by product name — a name is a label a human may edit, and re-running
  against a name match is how you end up with two $10 prices and two cohorts of customers on
  different ones. It **refuses** rather than adopts a lookup key already pointing at a different
  amount, because Stripe prices are immutable and "change the price" is really "create a price and
  move the variable". Run against the test key on 2026-09-02:
  `prod_VBcD7vMsjj575p`, `price_1UBEzHLZ0dGTJEEPKUKntx4k`, `bpc_1UBEzILZ0dGTJEEPDr4NVd5q`;
  re-running found them rather than minting more.
  **Currency note for Greg**: the Stripe account is GB with a GBP default, and the price is USD
  $10 as specified. A GB account charging USD is ordinary, and a GBP price would be a different
  number rather than a translation — say if you would rather sell in pounds.
- ✅ `STRIPE_PRICE_READER` in `.env.example`, on the `gjd-remote push-env` allowlist (not a
  secret — it is in the Checkout URL every customer sees), and in the worktree's `.env.local`.
  **The primary checkout and the laptop still need the line** — see the hand-off note at the end
  of this stage.
- ✅ `stripe@22.6.1` (`--save-exact`); [`src/billing/stripe.ts`](../../src/billing/stripe.ts) is
  the one place that constructs a client, pins `STRIPE_API_VERSION = "2026-08-26.dahlia"` — the
  version the installed SDK's own types were generated from, which is the only version whose types
  are not lying — and enforces the mode rules. `tests/billing-stripe.test.ts` fails if the pin and
  the SDK drift apart, and separately asserts that `current_period_start` is still on
  `SubscriptionItems.d.ts` and not on the subscription, by reading the shipped declarations rather
  than by trusting a type.
- ✅ `/api/health` reports both variables and **warns when the key's mode is wrong**, which needed
  a small fix to `checkEnv` in [`src/vercel-health.ts`](../../src/vercel-health.ts): a `valid`
  clause used to be checked only when a `breaks` clause was also set. Stripe is the first entry
  where *absence* is fine and *presence of the wrong thing* is catastrophic, so `valid` is now
  checked independently. A second defect the tests caught: the first version built the warning's
  wording from `expectedLivemode()` inside a module-level constant, freezing it at import — it
  detected the fault correctly and then told a production operator to install a test key. The
  message now names both directions and is evaluated nowhere.
- [ ] `STRIPE_SECRET_KEY` / `STRIPE_PRICE_READER` in the deployment.md env table (goes with the
  routes, in the checkout stage, so the table describes something that exists).

### How Stripe is tested — the house patterns, named once

Fable's finding: the patterns exist and the plan did not name them, so each stage would have
reinvented one.

- **Inject the client, never mock the module.** The seam is a constructor/parameter argument, the
  way `AdvanceParts` and `fetchDocument` already work here.
- **Sign webhook payloads offline** with the SDK's `generateTestHeaderString`. No network, real
  signatures, and the "parsed and re-encoded fails" test becomes trivial.
- **Add `api.stripe.com` to the test-time network backstop**
  ([`tests/setup/provider-guard.ts`](../../tests/setup/provider-guard.ts)), so no test can reach
  Stripe for real with the key that is sitting in `.env.local`. **Not** by adding it to
  `PROVIDER_HOSTS` in `src/spend-declarations.ts`: that list means *inference spend*, it drives
  the undeclared-spend capability scan, and a Stripe host in it would demand a spend declaration
  from every billing file. A second, small list in the guard keeps both meanings honest.

### Stage: Thin end-to-end round trip (front-loaded risk, per Sol P3)

One real Checkout → signed webhook → database row, before any quota or UI work. Note
`stripe trigger checkout.session.completed` creates an unrelated fixture customer and can
"verify" delivery while correctly writing nothing — the round trip must assert the **row**, not
the delivery.

- [ ] Tests first: valid signature over exact bytes writes the expected owner row; same payload
  parsed-and-re-encoded fails; missing secret/header, oversized body, wrong method, sibling
  `/api/webhooks/*` path all refused; signed event with unknown mapping / Stripe failure / DB
  failure does **not** return 200.
- [ ] Drizzle migration: `billing_accounts` as specified above. The `owner_id` foreign key into
  `auth.users` is **not** declared in `src/db/schema.ts` — no table's is; it goes in a
  hand-written `npm run db:generate -- --custom` migration, and `tests/db-schema.test.ts` checks
  `pg_constraint` directly, so getting this wrong turns that guard into a trap
  (`schema.ts` ~`:29`).
- [ ] `syncSubscriptionFromStripe` serialised by `for update` on the customer's row;
  controlled-interleaving test proving stale state cannot land after fresher state; replay test
  (same logical state, no duplicates).
- [ ] Exact-route webhook handler as specified in the security invariants.
- [ ] Manual verification with `stripe listen --api-key … --forward-to
  localhost:PORT/api/webhooks/stripe` and a real test-mode Checkout completed by hand.
- [ ] `npm test`, `npm run typecheck`. Commit.

### Stage: Quota ledger and atomic admission

- ✅ **Backfill: decided — the ledger starts empty** (pre-launch articles are grandfathered and
  never counted). Greg, 2026-09-02:

  > We have no existing real users (probably only me) no production - I'm fine for you to do
  > whatever's simplest for them.
- [ ] Tests first: free owner blocked on 4th ingest; paid owner blocked on 101st in-period;
  **concurrent admissions** — launch more than the remaining allowance, prove no more than the
  allowance is admitted; step re-run never counts or blocks; failed/cancelled ingest frees its
  reservation and creates no event; successful retry of a failed ingest counts once; duplicate
  completion counts once; archive and hard delete leave the count unchanged; exact period
  boundaries (half-open); delayed-renewal (stale stored period → resync → 503 when Stripe
  unavailable); admin owner never blocked; dev exemption inert outside local; blocked response
  carries machine-readable reason + upgrade/reset info.
- [ ] Migration: `ingest_events` ledger + `counts_as_ingest` on jobs (same `--custom` FK rule as
  above).
- [ ] `counts_as_ingest` threaded through `EnqueueRequest` → `enqueue()` → the job row, and
  copied from the old job by `retryJob`.
- [ ] Ledger insert inside the publish/finish transaction — the `done` branch of `settleIn()`
  (`pg-session.ts` ~`:423`).
- [ ] `entitlementFor(ownerId)` → `{ tier, limit, periodStart?, periodEnd? }` from
  `billing_accounts` + the hardcoded `TIERS` map; unknown price → free, logged.
- [ ] Serialised admission in `POST /api/jobs` (new-ingest shapes only — `{url}` and `{uploadId}`;
  a `{slug}`-only body is a step re-run and is free); non-reserving eligibility check in
  `POST /api/uploads`. Enforced only under `SPIDERYARN_STORE=postgres` — see *Billing is a
  Postgres feature*.
- [ ] Reader-facing refusal copy per [copy.md](../project/copy.md).
- [ ] `npm test`, `npm run typecheck`. Commit.

### Stage: Checkout, portal, and the reader-facing UI

- [ ] Tests first: checkout route refuses when a non-terminal subscription exists (redirects to
  portal); a double-click creates at most one customer mapping (the unique constraint, not a
  lock); authenticated success callback cannot sync another owner's session; live/test mode
  mismatch refused.
- [ ] `POST /api/billing/checkout` and `POST /api/billing/portal` as ordinary authenticated
  routes, per the customer-creation protocol above.
- [ ] Success-page return path: authenticated, session-id-only, ownership-proved, then sync.
- [ ] `/profile`: current plan, usage this period ("N of 100"), Upgrade / Manage-billing buttons.
- [ ] The at-quota refusal in the ingest UI surfaces the upgrade path.
- [ ] Confirm the API-created Portal configuration covers the full self-serve set: invoice/
  billing history, payment-method update, cancel at period end.
- [ ] Browser check via a Sonnet subagent ([browser-control.md](../project/browser-control.md)):
  free account hits the wall at 3; checkout round-trip in test mode with card `4242…`; portal
  round-trip (history, payment method, cancel); cancelled sub reverts to free limits without
  touching existing articles.
- [ ] Stop & review with Greg.

### Stage: Admin visibility + docs

- [ ] `/admin/users`: plan, status, ingests this period — one field on `AdminUser`, one column,
  one per-owner statement in `pg-admin.ts`.
- [ ] New evergreen doc `docs/project/billing.md` (owner: proposed under
  [security-map.md](../project/security-map.md), beside admin.md — **confirm owner with Greg**);
  update auth.md / deployment.md / architecture.md cross-links; `tests/doc-links.test.ts` green.
- [ ] Final health check: `npm test`, `npm run typecheck`, `npm run check`, lint on touched
  files.
- [ ] Test consolidation pass (subagent).

### Stage: Comp subscriptions (later — after go-live is stable)

Greg, 2026-09-02:

> it would be nice (as a later stage) for me to be able to give users a free 1-month (e.g. for
> journalists) and/or lifetime subscription (for me, QA, close friends, etc).

- [ ] **App-side comp, not Stripe coupons**: two nullable columns on `billing_accounts` —
  `comp_until` (timestamptz; a far-future/`infinity` value or a separate lifetime flag for
  lifetime) — granted from `/admin/users` (or a small script). `entitlementFor` treats an active
  comp as Reader-tier quota; comp and a real subscription can coexist (take the better).
  *Simpler option passed over: Stripe 100%-off promotion codes or trials — Stripe-native, but
  they force the recipient through Checkout and (usually) a card form, which is exactly wrong for
  a journalist you're trying to give frictionless access.*
- [ ] Comp status visible on `/admin/users` and on the user's own `/profile`.
- [ ] Tests: comp grants Reader quota; expiry reverts to free without touching articles; comp
  plus subscription takes the better of the two.

### Stage: Go-live (when we ship this)

- [ ] **Greg (manual)**: activate live mode — business verification and a payout bank account;
  Stripe requires the account holder.
- [ ] **Greg (manual)**: set live `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_READER` in Vercel env (production) — no Vercel credential exists on this box.
- [ ] Agent, via API with the live key: recreate product/price/portal config; create the
  production webhook endpoint at `https://<prod-host>/api/webhooks/stripe` subscribed to the four
  events; hand Greg the signing secret for the Vercel step.
- [ ] Release check: retrieve and validate the configured live price (active, recurring monthly,
  amount/currency, livemode).

### ✅ Stage: External critique of the plan

- ✅ Pre-critique version committed (6a94889); prompt at
  [260902i-…-review-prompt.md](260902i-stripe-payments-and-subscription-tiers-review-prompt.md).
- ✅ GPT Sol review returned (exit 0, non-empty answer):
  [260902i-…-review-sol.md](260902i-stripe-payments-and-subscription-tiers-review-sol.md).
  **Verdict: rework.** All seven P1s and the P2s checked and folded into this revision; the
  backfill question (P2.1) escalated to Greg in the ledger stage.
- ✅ **Fable review of the reworked plan against the code**, 2026-09-02 — the one that found the
  unbuildable rule, the wrong locking idiom and the files-store hole. Its findings are the status
  note at the top; each was verified in the code before adoption rather than taken on trust.
  **Worth keeping as a lesson**: Sol's review was right about every *risk* and wrong about two
  *mechanisms*, because a plan-stage reviewer with no repository in front of it cannot know that
  `enqueueOrGet` is not a transaction. A second review from something that reads the code is not
  the same review again.
- [ ] After implementation: second Sol review of the code diff — weighted higher than this one
  (a plan review cannot find the bug that doesn't exist yet).

## Appendix

### Research summary (2026-09-02, web + repo exploration by subagents)

- Hosted Checkout + Customer Portal is where current (2025–26) solo-dev guidance converges;
  embedded Checkout/Elements buys only a non-redirect UX at real integration cost.
- The canonical failure mode is event-payload-driven webhook handlers ("split brain" when events
  arrive out of order); the fetch-fresh-and-overwrite sync function collapses ~250 event shapes
  into one code path — **but needs per-customer serialization** (Sol P1.2) to be actually safe.
- Webhook must see the **raw** body (signature verification) and run on the Node runtime — both
  already true of our single Vercel function (`NODEJS_HELPERS=0`).
- Stripe CLI test loop: `stripe listen --api-key … --forward-to …`; the CLI's `whsec_…` is
  distinct from the dashboard one used in prod; `stripe trigger` fixtures don't touch our
  mappings, so assertions must be on rows, not deliveries.
- Repo has **zero** existing payments code; nearest neighbours are the `ai_calls` per-owner spend
  ledger and the per-owner counting in `pg-admin.ts`.

### Deferred / out of scope

- Second paid tier; annual pricing; Stripe Tax / VAT registration (far below UK threshold; price
  VAT-inclusive; revisit before revenue is real); Stripe Entitlements API; gating chat/comments/
  quiz/search spend (waits for cost-tracking; future choke point is the AI gateway); overage or
  grace bands; metered billing; async payment methods; webhook queue/event-dedupe machinery;
  pricing/marketing page beyond `/profile`.
