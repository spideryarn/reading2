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

**And then the tiers moved into the database entirely**, Greg's call the same evening:

> instead of adding them as environment variables, could we add them to the database, so that it's
> easier to modify (e.g. for agents, in UI, etc)

He was offered ids-only, ids-and-quotas, or the whole table, with the costs of each stated, and
took the whole table. So `billing_tiers` and `billing_tier_prices` are the source of truth, Stripe
follows them, and **raising a quota is one `UPDATE`** — no deploy, no Stripe call, no migration.
What that cost is the compile-time tier union and the invariant tests over constants; those moved
into the schema as CHECKs, where they hold for every writer. The currency reasoning and the recipe
are in [billing.md](../project/billing.md#adding-a-tier-or-a-currency).

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

*Last updated 2026-09-03. The date is in the text rather than the heading so that links to this
section survive it being updated — an earlier dated heading broke `billing.md`'s link on the first
edit, which is what `tests/doc-links.test.ts` is for.*

**Verdict: the machinery is finished, and so is the surface.** Settlement and admission were built on
2026-09-03, and the checkout, portal and confirm routes followed the same day. **The round trip has
been run for real**, which is the thing this plan had been deferring since the first stage: a
test-mode Checkout paid with `4242…` through the hosted page, the webhook verified and forwarded by
`stripe listen`, and **`syncSubscriptionFromStripe` executed against the real Stripe for the first
time**, writing `sub_1UBQh9…` / `price_1UBHo5…` / `active` and a period of 2026-09-03 → 2026-10-03
read off the subscription **item**. The same account then admitted an ingest where three successes
would have stopped a free one, and refused the twenty-first with Stripe's own renewal date on it.

`/profile`, the refusal's upgrade link and the two admin columns landed the same evening — see the
*Checkout, portal and the reader-facing UI* and *Admin visibility* stages. The Portal configuration
was read back from Stripe on 2026-09-03 and is right — invoice history, payment method, cancel at
period end, no `subscription_update` while there is one tier to be on — and its login link is now on
(see below). What remains is Greg's review, comp subscriptions and go-live.

**273 tests across 19 files** — every billing suite plus the guards that catch this feature's own
recurring mistakes (`fixture-ids`, `store-transaction-isolation`, `doc-links`) — re-run together on
2026-09-03 after merging `dev`, rather than taken from four separate agents' reports. `npm run
typecheck` clean over all 1,121 files.

**The double-charge question is closed, by deciding not to.** Greg, 2026-09-03: *"we can stop
worrying about this unlikely edge case for now."* The investigation and the three options it ruled
out are in
[billing.md § Subscribing twice](../project/billing.md#subscribing-twice-looked-at-and-deliberately-left-open);
the short version is that Stripe's own setting redirects a Checkout page *as it loads*, so it would
not have closed the two-tab case either, and it depends on an account-wide field on an account that
also bills Greg's consulting customers.

The investigation left one thing behind that is worth keeping: `chooseSubscription`'s anomaly counts
only *entitled* subscriptions, so an `active` beside an `unpaid` is two collectable invoices and
nothing logged. That is the alarm, not the guard, and it is cheap — count over non-terminal statuses,
from the raw Stripe list before unreadable shapes are filtered out (GPT Sol's addition). Not done.

**A caveat on the two guard suites above.** `tests/billing-quota-race.test.ts` asserts that one
transaction *blocks* on another's row lock, so it is sensitive to how loaded the box is: it went red
three times in a fifteen-file run and green in the same fifteen-file run immediately after, and green
in isolation every time. Treat a lone red there as contention until a second run agrees — but never
assume it, because that suite is also the only thing standing between us and unmetered ingests.

Two things the round trip found that no test could:

- **`stripe listen` does not retry.** It forwards once and prints the status. So the webhook's 503
  for an unmapped customer — which is the right answer to a *real* endpoint, where Stripe retries
  for three days — is a delivery lost for good in local testing. It happened here: a peer suite's
  sweep deleted the fixture owner's `billing_accounts` row between the session being created and the
  payment being made, and the mapping had to be put back by hand. Worth knowing before somebody
  concludes the sync is broken.
- **A local fixture owner needs a uuid no test file sweeps.** The round trip's owner was
  `000000cf-…`, which is exactly the stem `tests/billing-checkout.test.ts` deletes by prefix, so a
  peer's `npm test` removed it mid-flight. The suites are right to sweep by prefix; anything
  long-lived just has to live outside every one of those prefixes.

**The lesson from the settlement stage, worth more than the stage.** The plan said "settle in both
branches of `settleIn`". Fable found that a job reaches a terminal state at **five** sites, and GPT
Sol then found **two more** at the exported `JobStore` boundary — `finish` and `releaseStep`, which
have no production callers today but are advertised API, and after which `forget`/`trimFinished` can
delete the only provenance. Three reviewers, three different counts, each one right about what the
one before missed. The general shape: **"wire X into the place that does Y" is a claim about how
many places do Y**, and that number is nearly always larger than the plan's author thinks. Count the
sites before believing the wiring.

Sol's review also killed a comment that had been reasoned into existence rather than observed:
tolerance was said to be what makes a cancel racing a publication settle exactly once. It is not —
the loser of that race never reaches settlement at all, because the job fence stops it first. The
tolerance is still right, for a different reason (a Stop that 500s is worse than a slot nobody gave
back), but the *stated* reason was fiction. Written down because this is the third time on this
feature that a plausible sentence about the code turned out to describe nothing.

**151 billing tests pass, including the Postgres suite** — which spent most of the day skipping and
now runs. The migration is applied locally, `tests/billing-quota-race.test.ts` executes all 13 of
its cases through the real code, and `tests/db-schema.test.ts` is green on all three new foreign
keys.

Two things about that suite are worth keeping, because both nearly cost the guarantee:

- **It skipped for a reason that had nothing to do with the database.** The file never called
  `loadEnvLocal()`, so `pgReady` found no `DATABASE_URL` and reported 13 skipped against a database
  that was up and migrated. A skip is indistinguishable from a deliberate one, which is why it
  survived hours of being looked at; `REQUIRE_POSTGRES=1` is what said so, and is what that flag is
  for.
- **It can fail.** Remove the `for update` from the admission read and *"admits exactly three of
  twenty for a free account"* goes red. The lock is demonstrated to be load-bearing rather than
  asserted to be.

**Reviewed as built** ([review](260902i-stripe-code-review-sol.md)): GPT Sol's verdict on the code
was *"I would not ship the quota path yet"*, and it found six real defects — a release that could
free a slot a job was spending, a settlement that updated without checking, an entitlement read
outside its own lock, a subscription picker that could drop a paying reader to free, a usage count
that defaulted to zero, and a subscription list that fetched one page while claiming to fetch all.
All fixed. It also found **eleven comments that claimed more than the code did**, which is the
finding worth remembering: this file's own rules say a confidently wrong comment is worse than
none, and a dozen had accumulated in a day.



The worktree `stripe-payments` was removed on 2026-09-02 after `npm run worktree:check` passed;
everything below is on `origin/dev`.

**What exists**, all of it on `dev`:

| | |
|---|---|
| Stripe objects | Product, two monthly prices each carrying USD/GBP/EUR through `currency_options`, and a Customer Portal configuration — created in test mode by [`scripts/stripe-setup.ts`](../../scripts/stripe-setup.ts), which reads the `billing_tiers` rows and makes Stripe match them. Idempotent by `lookup_key`. Six real Checkout Sessions were minted by hand, one per price point, to prove all six amounts land. |
| [`src/billing/stripe.ts`](../../src/billing/stripe.ts) | The only place a client is constructed. Pinned API version, mode guards, 10-second timeout. |
| `billing_tiers` + `billing_tier_prices` | **The tiers are database rows, not environment variables** — Greg's call, so they can be changed by an agent or a UI without a deploy. `PaidTier` is therefore no longer a compile-time union. Read through [`src/store/pg-tiers.ts`](../../src/store/pg-tiers.ts) (30-second cache). |
| [`src/billing/tiers.ts`](../../src/billing/tiers.ts) | Pure types and helpers over those rows. `Entitlement` is a discriminated union, so a period start without an end is a state the compiler refuses. |
| [`src/billing/subscription.ts`](../../src/billing/subscription.ts) | Reading a Stripe subscription, where the Basil period-move trap lives. Refuses everything unrecognised, towards free. |
| [`src/billing/webhook.ts`](../../src/billing/webhook.ts) | Verification over the exact bytes, its own raw-body reader, fail-closed on an unset secret, and the route itself at an exact pre-auth path. |
| [`src/billing/sync.ts`](../../src/billing/sync.ts) | Ask Stripe, write it down, under the customer's row lock. **Never executed** — the webhook's tests inject a sync. |
| [`src/store/pg-billing.ts`](../../src/store/pg-billing.ts) | Reserve, settle, count. The lock, and the anchor row created before it. Exercised by the race suite against the real database. |
| schema + 4 migrations | `billing_accounts`, `ingest_events`, `jobs.ingest_event_id` with a composite FK; then `billing_tiers`, `billing_tier_prices` and their seed. Applied locally, not yet on production. |
| `pay-` copy | Three messages, registered in `CODE_KINDS` so none arrives with a Retry button that cannot work. |
| [billing.md](../project/billing.md) | The evergreen doc, under [security-map.md](../project/security-map.md) — including how to add a tier or a currency. |

**What is still unbuilt**: the wiring. `reserveIngest` has no caller in `POST /api/jobs` and
`settleReservation` has none in `settleIn`, so the quota is enforced nowhere yet — everything above
is machinery with tests, waiting to be connected. `syncSubscriptionFromStripe` has likewise never
been executed: the webhook route is tested with an injected sync, and the real one wants a
controlled-interleaving test against two connections before it is trusted.

**One statement in the schema migration is not ours**, and it is written down here so nobody
rediscovers it: `src/db/schema.ts` on `dev` admits `'privacy'` in `feedback_route_kind` and no
migration carried it, so the first `db:generate` since picked it up. Keeping it was deliberate —
trimming would leave the snapshot asserting a constraint the database denies, which is the content
hole that cost this box an hour. The half it does *not* close: `FEEDBACK_ROUTE_KINDS` in
`src/types.ts` still lacks `'privacy'` and there is no such route, so the column now admits a value
the client cannot send. Harmless in that direction; the mirror of it would be a 500 on the endpoint
people use to report 500s. Whoever ships the `/privacy` page should add it to that array in the
same change — and `tests/feedback-store.test.ts` cannot see either half, because it iterates the
`types.ts` list.

**Next**, in order — the first item on the old list (migrate, then run the race suite for real) is
done, and what it found is above:

1. The settlement tests Sol asked for and nobody has written: reserve a slot, attach it to a real
   job, and assert that `done` publishes *and* charges in one commit, that `error` and cancel
   release, that an injected settlement failure rolls back the publication, and that a cancel
   racing a final publication settles exactly once.
2. Settlement, then admission — recut into two stages below, because the settlement tests cannot
   exist until there is something to attach a reservation to. **A job ends at five sites, not the
   two this line used to name**, and `reserveIngest` cannot simply live inside `enqueue()` because
   step re-runs go through it too. Both traps are written out in the stages.
3. Checkout and portal routes — **and the customer→owner mapping must be durable before a
   Checkout Session exists**, not written by the browser's return callback, which is not reliable
   (Sol, and the webhook's "unmapped" case assumes it).
4. `/profile`, browser check, admin columns.
5. Comp subscriptions, then go-live.

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
   on the `gjd-remote push-env` allowlist and in `.env.example`; the `stripe` package, the Stripe
   CLI, `src/billing/stripe.ts`, `scripts/stripe-setup.ts` and the `/api/health` mode check —
   plus, since this was written, the schema, the tier rows, the ledger and the webhook.
   **You need no `STRIPE_PRICE_*` line in `.env.local`**, whatever an older paragraph here or a
   stale shell of yours suggests: price ids are rows in `billing_tier_prices`, and
   `npx tsx scripts/stripe-setup.ts --apply` writes them there.
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

- **Two paid tiers, three currencies** — $10/£8/€9 for 20 ingests a month, $50/£40/€45 for 150.
  Superseded "one paid tier at launch" the same day it was written, and the reason the change was
  cheap is that the tiers are **rows in `billing_tiers`**, not config or a TypeScript union: adding
  a third is an INSERT and a run of `scripts/stripe-setup.ts`. How to do it is in
  [billing.md](../project/billing.md).
- **Free = 3 ingests, lifetime** (not per month). Matches "just to play around"; no period logic
  for free users.
- **A lapsed subscriber is blocked, and the copy says so kindly.** The lifetime free count includes
  everything an owner ever ingested, paid months included, so someone who took 40 articles on a paid
  plan and cancelled is past the free allowance for good. Greg chose this over tier-scoping the free
  count or granting a fresh allowance on cancel, 2026-09-03 — one rule, no new state, and nothing to
  farm by subscribing and cancelling. **They keep every article and reading is unaffected**; only
  adding new ones stops. The consequence to honour in the UI: `/profile` and the refusal must say
  *"your plan has ended — resubscribe to add more"* and must **not** render "40 of 3 used", which
  reads as a bug rather than a policy.
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
- ✅ ~~`STRIPE_PRICE_READER` in `.env.example` and on the `gjd-remote push-env` allowlist~~
  **Undone on 2026-09-02**, and nothing needs the line on any machine: Greg asked for the tiers to
  live in the database so an agent or a UI could change them, so `billing_tiers` and
  `billing_tier_prices` replaced the variables outright.
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
- ✅ `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the deployment.md env table, plus
  `SPIDERYARN_BASE_URL` — which is there to say it **must stay unset in production**, since
  `billingReturnOrigin()` answers `PUBLIC_ORIGIN` before it reads any variable. There is no
  `STRIPE_PRICE_*` row to add — that became a database table on 2026-09-02.

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
- ✅ Manual verification with `stripe listen --api-key … --forward-to
  localhost:5274/api/webhooks/stripe` and a real test-mode Checkout completed by hand, 2026-09-03 —
  see *Where the build stands*. The row was asserted, not the delivery.
- [ ] `npm test`, `npm run typecheck`. Commit.

### Stage: Quota ledger and atomic admission

- ✅ **Backfill: decided — the ledger starts empty** (pre-launch articles are grandfathered and
  never counted). Greg, 2026-09-02:

  > We have no existing real users (probably only me) no production - I'm fine for you to do
  > whatever's simplest for them.
✅ The ledger, the lock and the migrations are **built and on `dev`** — `src/store/pg-billing.ts`,
`billing_accounts`, `ingest_events`, and the nullable `jobs.ingest_event_id` with its composite FK.
What follows is the wiring, recut into two stages on Fable's advice (2026-09-03).

> **Two entries that used to be here were wrong**, and are recorded rather than silently deleted
> because a reader of the git history will meet them: this checklist told an implementer to migrate
> and thread a boolean `counts_as_ingest` column on `jobs`, which is the design *Quota accounting*
> above explicitly rejected in favour of the nullable `jobs.ingest_event_id` that shipped; and it
> pointed `entitlementFor` at a "hardcoded `TIERS` map" that became database rows. Whoever followed
> the checklist literally would have built the rejected thing.

#### ✅ Stage: Settlement — a job's ending settles its reservation

Built 2026-09-03. Dormant, as intended: nothing calls `reserveIngest` yet, every job's
`ingest_event_id` is null, and observable behaviour is unchanged.

`tests/billing-settlement.test.ts` is the evidence — 13 cases against the real database, one per
site plus the tolerance and the strictness. Each site was **watched red** by deleting its own
settlement and running the file: the tail of `settleIn` takes five cases down, the release branch
one, `settleExpired` one, `requestCancel` two, and `ticket.ingestEventId ?? null` in the job's
INSERT takes ten. Making the *release* strict reddens exactly one case, and the failure it prints
is the reader's Stop button answering *"this app asked its database for something it would not
do"* — which is the 500 the tolerance exists to prevent.

The shape chosen for tolerant release: **no options argument and no sibling function** — the
`outcome` already says which it is, and there is no caller that wants a strict release or a
tolerant charge, so a flag would be a parameter with one correct value at every call site.

- [x] **A job ends at FIVE sites, not the two this plan used to name.** Fable found the other
  three, and the miss is reader-hostile rather than exotic:
  1. `settleIn` `done` → **charged**.
  2. `settleIn` `error`/`cancelled` → **released**.
  3. `settleIn`'s release branch that *resolves to* a cancellation (`releaseStepIn`'s
     `case when cancelling`, then `discardAfterCancel`) — inside `settleIn`, but not one of "both
     branches" → **released**.
  4. **`settleExpired`** (`pg-jobs.ts` ~`:773`) — a fenced UPDATE on the pool, no transaction,
     ending every lapsed-lease job at once → **released**.
  5. **`requestCancel`'s `over` branch** (`pg-jobs.ts` ~`:858`) — a queued job, or a running job
     whose claimant is provably gone, straight to `cancelled` in one UPDATE → **released**.

  Sites 4 and 5 are the **Stop button** and **closing the tab**. There is deliberately no expiry on
  a reservation, so a leak counts against its owner forever: two stopped jobs would kill a
  three-slot free account having produced nothing. On a paid account it is worse — `in_flight` in
  `usageSql` has no period filter, so one leak is minus-one on *every* future month.
- [x] **The charge is strict, the releases are tolerant.** Strict at site 1: `settleReservation`
  throws on anything but exactly one row, rolling back the publication — publish-without-charge is
  a free ingest, charge-without-publish a phantom debit. Tolerant at 2–5: zero rows logged, never
  thrown, because a thrown ledger anomaly inside `requestCancel` turns a reader's Stop into a 500 —
  and tolerance is what makes a cancel racing a final publication settle exactly once.
- [x] **`releaseReservation` is the wrong tool at sites 4 and 5.** Its
  `and not exists (select 1 from jobs where ingest_event_id = …)` guard exists to stop a slot being
  freed while a job still spends it, which means it refuses precisely where the job row exists and
  is ending. Those sites take the `settleReservation` path in tolerant mode.
- [x] `ingestEventId` rides on **`EnqueueTicket`, not on `Job`** — `Job` is serialised to the
  browser by `publicJob()`, and a ledger id has no business there. `settleIn` reads the column
  itself with one `select` inside the transaction it already has.
- [x] Tests first, against real Postgres: charge-in-one-commit; an injected settlement failure
  rolls the publication back; release at each of sites 2–5; cancel racing publication settles once;
  and a null `ingest_event_id` settles harmlessly at all five — the guard that this stage changed
  nothing observable.
- [x] `npm test`, `npm run typecheck`, `tests/store-jobs-parity.test.ts` green. Commit.

#### ✅ Stage: Admission — the wall goes up

Built 2026-09-03, and **the quota is now live**: a free account is held to three lifetime ingests.
`src/billing/admission.ts` is the whole of the decision, and the only caller of `reserveIngest`.

`tests/billing-admission.test.ts` is the evidence — 14 cases against the real database, driving
`handleApi` so the status code and the body are the route's. Every one of them counts
`ingest_events` around a real request, because a count is the only thing that can tell a route that
reserved from one that did not. Thirteen mutations were each watched red, one at a time:

| mutation | red |
|---|---|
| the `{url}` branch stops admitting | 5 cases |
| a `{slug}` re-run admits too | 2 |
| the release in `withIngestSlot`'s `finally` removed | 2 (dedup, and the resync case that counts it back) |
| retry drops the slot on the floor | 1 |
| retry always reserves | 1 |
| `queueAnUpload` drops the slot | 1 |
| `lapsed` never set on a refusal | 1 |
| no resync on `stale` | 2 |
| the `STORE !== "postgres"` guard removed | 1, in `tests/billing-admission-files.test.ts` |
| the uploads door left open | 1 |
| the admin exemption removed (either half) | 1 |
| the `pay-lapsed` branch removed | 3, in `tests/messages.test.ts` |

- [x] **The retry route is a second front door.** `POST /api/jobs/:id/retry` → `retryJob` →
  `enqueue()` never passes through the `POST /api/jobs` handler, so a check bolted onto that
  handler alone leaves a failed job retryable free, forever. Both routes reserve.
- [x] **But admission cannot simply live inside `enqueue()`**, which is the tempting single choke
  point: `enqueue()` also serves *step re-runs* on existing articles, which must stay free. Only
  the route knows which shape it has. New-ingest shapes only — `{url}` and `{uploadId}`; a
  `{slug}`-only body is a re-run.
- [x] Retry reserves **only if the old job carried a non-null `ingest_event_id`** — `Job.url`
  cannot say, since re-runs recover URLs too, which is why the provenance column exists. The read is
  `ingestProvenanceOf` in `src/store/pg-jobs.ts`: narrow, owner-scoped, and deliberately *not* on
  `Job` (serialised to the browser) or on the `JobStore` interface (shared with the filesystem
  adapter, where quota does not exist).
- [x] Release on every path where a reservation is taken and no job results. **Not enumerated** —
  `withIngestSlot` releases on every path, including the successful one, and
  `releaseReservation`'s `not exists (select 1 from jobs where ingest_event_id = …)` decides. That
  guard asks the question of committed rows; the enumerating version would have to be right about
  `enqueue`'s four outcomes *and* about a throw over an INSERT that committed and lost its reply.
  Costs one indexed UPDATE per ingest.
- [x] Non-reserving eligibility check in `POST /api/uploads`. Enforced only under
  `SPIDERYARN_STORE=postgres` — see *Billing is a Postgres feature*.
- [x] **The administrator is never blocked**, via the existing `isAdmin()` — a hardcoded list of two
  uuids, which is what makes the exemption safe. **No slot is taken at all** rather than taken and
  forgiven, so an admin's jobs carry a null `ingest_event_id` like a re-run and the exemption stays
  out of the counting path. Otherwise Greg is capped at three lifetime articles on his own
  production instance, and comp subscriptions are a post-go-live stage.
- [x] Reader-facing refusal copy per [copy.md](../project/copy.md), via `ingestQuotaReached` — and
  a **third** sentence, `pay-lapsed`, for the lapsed subscriber, per Greg's decision above. It is
  chosen from `Refused.lapsed`, set inside the lock from the row (a subscription id beside a status
  the allowlist does not entitle) rather than from `used > limit`, which is the same answer most of
  the time and wrong the day somebody lowers a tier's `ingests_per_period`. **402**, not 429: 429
  implies waiting fixes it, which is false for a lifetime allowance.
- [x] The `stale → resync once → 503` path, which makes admission the **first real caller** of
  `syncSubscriptionFromStripe`. Test it with an injected sync here; the checkout stage exercises the
  real one. Admission can therefore touch the network — outside the lock, which `reserveIngest`'s
  structure already guarantees. Three cases: the resync fixes the period and the retry admits;
  Stripe throws, 503; the resync changes nothing and it is **not asked twice**, 503. `Stale` grew a
  `customerId`, because the sync is keyed on the customer rather than the subscription.
- [x] Known and accepted: with exactly one slot left, a double-click on Add reserves twice and the
  second is refused before dedup would have collapsed it onto the first job. Fixing it means
  inserting before reserving, which is the bypass. A refusal on a request that would have been a
  no-op, at the last slot, on a double-click.
- [x] `npm test`, `npm run typecheck`. Commit.

### Stage: Checkout, portal, and the reader-facing UI

Built 2026-09-03, bar the `/profile` surface. `src/billing/checkout.ts` holds all three routes;
`tests/billing-checkout.test.ts` is 58 cases against the real database, and every one of the
mutations below was watched red one at a time
(`REQUIRE_POSTGRES=1 npx vitest run tests/billing-checkout.test.ts`):

| mutation | red |
|---|---|
| the claim's `and stripe_customer_id is null` removed | 1 — the concurrency case |
| `claimCustomer` returns without writing the row | 2 — the ordering case and the concurrency case |
| the `hasOpenSubscription` redirect removed | 5 |
| `client_reference_id` dropped from the confirm check | 1 |
| the session's customer dropped from the confirm check | 1 |
| `assertLivemode` on the tier's price removed | 1 |
| `assertLivemode` on the Checkout Session removed | 1 |
| `assertLivemode` on the portal session removed | 1 |
| the forbidden-key list in `parseCheckoutRequest` emptied | 7 |
| `active` dropped from `tierToSell` | 1 |
| the account read moved below the session retrieve in confirm | 1 |
| `past_due`/`unpaid` added to `TERMINAL_STATUSES` | 2 |
| `tierToSell` back on the cached `allTiers()` | 1 |
| the Stripe-failure branch of `orBillingUnavailable` removed | 3 |
| the confirm route's "only a 404 means no such session" removed | 1 |
| the unprovisioned-tier 503 turned back into a 400 | 1 |

**Reviewed as built** by GPT Sol ([prompt](260902i-checkout-code-review-prompt.md),
[review](260902i-checkout-code-review-sol.md)) — handed the two new files in full plus a diff of
everything they touched, rather than prose about them. Seven findings, all checked, and the four
worth recording:

- **The 30-second tier cache was on the selling path** (P1, and the one real bug). `tierToSell` read
  `allTiers()`, so retiring a tier or replacing its price could still mint a Session for up to half a
  minute — **and the damage is not bounded by that half minute**, because a Checkout Session stays
  payable for about a day and the subscription then bills on the old price for as long as it lasts.
  `recordTierPrice` clears only the setup script's own process, so a running web instance never hears
  about the change at all. Fixed: `readTiers()`, uncached. Checkout happens a handful of times a day;
  admission, which runs on every ingest, keeps the cache.
- **Every Stripe SDK failure escaped as a 500 with Stripe's own sentence in the body** (P2). Two
  rules at once: [copy.md](../project/copy.md)'s *never the provider's words*, and a status claiming
  our arithmetic was wrong when it was not. Now 502 with `BILLING_UNREACHABLE` (`[pay-down]`, the one
  `pay-` code that is `retry`), and the confirm route's catch no longer answers *no such checkout
  session* to a timeout — only a genuine 404 from Stripe means that. A fault of **ours** still leaves
  a 500 with its stack, because relabelling our bugs as Stripe's would be tidier and wrong.
- **The double-click comment was still overclaiming**, in a way the plan itself invited. It said the
  worst case is the orphaned customer; the worst case is **two payable Sessions and two
  subscriptions**, because nothing spans the subscription check and `sessions.create`. That is the
  accepted risk this plan already recorded under *Stripe state* — but the comment did not say so, and
  a reader would have concluded it was impossible. Sol also found the hole in the net behind it:
  `chooseSubscription` counts only *entitled* subscriptions as live, so an `active` beside an
  `unpaid` is two real invoices and no anomaly logged. Written down, not fixed.
- **An active tier with no Stripe price answered 400.** That is a deployment nobody has run
  `scripts/stripe-setup.ts` against, and telling the reader they asked for something that does not
  exist sends them hunting a mistake they did not make. Now 503.

It also found two **tests** that were passing for the wrong reason — see below — and one prompt error
of mine: I told it `past_due` is unentitled. It is not, deliberately, and the test comment I had
written said the same wrong thing.

**Two of those tests were wrong before they were right, and both were the same mistake in different
clothes.** The "no session" route case passed a 400 through as a 401 because
`post(path, {}, undefined)` takes the *default* parameter — there is no way to spell "no verifier" as
an argument to a function whose parameter has a default, so it is a separate function now. And
"refuses a Checkout Session that comes back in the wrong mode" reddened nothing when its assertion
was deleted, because `claimCustomer`'s own `assertLivemode` caught the fake's live customer first;
the case now gives the owner a customer already, so the session's check is the only thing standing.
Both were found by falsifying, not by reading — [silent-success.md](../reusable/silent-success.md).

**And a third that falsifying could not have found**, because it was green for a reason a mutation of
the *implementation* would not disturb: the "no session" case dropped the verifier but kept sending
`Authorization: Bearer test-token`, so it exercised `requireUser`'s *invalid token* branch rather
than its *no header* branch. Both are 401, so the assertion could not tell them apart, and deleting
`[auth-none]` would have left it green. GPT Sol read it. The lesson is the pair: mutation testing
finds assertions that are too weak for the code they point at, and a second reader finds assertions
pointing at the wrong code.

- [x] Tests first: checkout route refuses when a non-terminal subscription exists (redirects to
  portal); a double-click creates at most one customer mapping (the conditional UPDATE, not a
  lock — and the two requests are really concurrent, held at a barrier until both have read the
  row); authenticated success callback cannot sync another owner's session; live/test mode
  mismatch refused.
- [x] `POST /api/billing/checkout` and `POST /api/billing/portal` as ordinary authenticated
  routes. **The order of operations is the whole guarantee** — the committed owner→customer row
  must exist before any Checkout Session naming that customer exists, so the webhook can never see
  `unmapped` for a customer of ours:
  1. `requireUser` → ownerId.
  2. `insert billing_accounts (owner_id) on conflict do nothing` — the same anchor admission uses.
  3. Read it back. A set `stripe_customer_id` is reused; a non-terminal subscription redirects to
     the portal instead.
  4. `customers.create({ metadata: { owner_id } })`, then
     `update … set stripe_customer_id = $cus where owner_id = $owner and stripe_customer_id is null`.
     **Zero rows means a concurrent request won**: re-read, use the winner's customer, abandon ours.
     The orphaned Stripe customer is the accepted cost of not taking a lock.
  5. *Only now* `checkout.sessions.create({ customer, client_reference_id: ownerId, … })`.

  **The ordering is asserted where it is observable**: the test reads `billing_accounts` from
  *inside* `checkout.sessions.create`, because reading it afterwards proves only that the row exists
  and the webhook's problem is whether it existed first.
- [x] **Always pass `customer` explicitly; never let Checkout's `customer_creation` mint one.** A
  Stripe-minted customer is unmapped by construction until a callback runs — which is exactly the
  unreliable return-path design being forbidden. After this, the only `unmapped` events left are
  `stripe trigger` fixtures and genuinely foreign customers, which is what that branch is for.
- [x] Success-page return path: authenticated, session-id-only, ownership-proved, then sync.
  `POST /api/billing/confirm`, and it checks **both** `client_reference_id` and the session's
  customer against the committed mapping — either alone is enough for somebody who can influence the
  other. Every refusal is the same 404 with the same words, so the reply cannot answer *did that
  person subscribe?*.
- [x] **Terminal is a shorter list than unentitled**, and this was not spelled out in the plan.
  `TERMINAL_STATUSES` is `canceled` and `incomplete_expired`; `past_due` and `unpaid` are *not*
  entitled but are still subscriptions Stripe holds and may still collect on, so selling beside one
  charges the reader twice.
- [x] `/profile`: current plan, usage this period, Upgrade / Manage-billing buttons. Built
  2026-09-03 — [`BillingSection.tsx`](../../src/web/BillingSection.tsx) over
  [`useBilling.ts`](../../src/web/useBilling.ts), reading a new `GET /api/billing/usage`
  ([`src/billing/summary.ts`](../../src/billing/summary.ts)) whose wire shape and words are in the
  pure [`src/billing-plan.ts`](../../src/billing-plan.ts). See below for what the shape decides.
- [x] The at-quota refusal in the ingest UI surfaces the upgrade path.
  [`QuotaNotice.tsx`](../../src/web/QuotaNotice.tsx), on three surfaces.
- [ ] Confirm the API-created Portal configuration covers the full self-serve set: invoice/
  billing history, payment-method update, cancel at period end.
- [x] Browser check via a Sonnet subagent ([browser-control.md](../project/browser-control.md)),
  2026-09-03 — Playwright against system Chrome on the box. **It found a real bug that every unit
  test in the change had missed**, which is the thing worth keeping from it: see below. Also
  confirmed *"Free — 3 of 3 articles used"*, both tier cards with all three currencies, a real
  test-mode `checkout.stripe.com` page naming *Spideryarn Reader* at €9.00/month, a real
  `billing.stripe.com` Portal, and *"Administrator — no limit"* with no count on the seeded admin.
  **The seeded dev account is an admin and so quota-exempt**, so a throwaway non-admin reader had to
  be made on the local stack to see the wall at all, and was deleted afterwards — worth knowing
  before the next person tries to check this.
- [ ] Not checked in a browser: paying with `4242…` end to end, and a cancelled subscription
  reverting to free limits. The card page was reached and read, not filled in.
- [ ] Stop & review with Greg.

#### The bug the browser found, and why nothing else could

`/add/<url>` rendered `queue.error` for a failed POST. That is **engine state shared with the
poller**, and `act`'s own `finally` starts the poll that clears it — so the quota's 402, and the
link to `/profile` that this whole stage exists to provide, were replaced by the generic *"It didn't
get as far as the queue"* before a reader could see them. The refusal names an Upgrade button and
the page meant to hand them that button showed nothing.

**This repo had already met it three times** — the three artefact hooks in August, then the thread
page — and `tests/refused-job-reason-survives.test.tsx` exists for exactly it, with a header
predicting that *"the way this breaks is by somebody reintroducing a private `queue.error` read"*.
The add page was the fifth copy and nobody had gone back for it. The fix is `queue.lastFailure()`,
snapshotted right after the await, and it is now on the add page and on a job card's refused Retry
(which is the quota's second front door). Three cases were added to that file, each watched red.

**The general shape, since this is the second time this plan has recorded one:** *"wire X into the
place that does Y" is a claim about how many places do Y* — the settlement stage learnt it about job
endings, and the surface stage has just learnt it about failure rendering. And the narrower lesson:
a unit test that renders a failure is testing a frame; only a test that holds the poll, or a browser,
is testing what a person sees.

#### Reviewed as built, 2026-09-03

GPT Sol on the surface ([prompt](260902i-profile-surface-code-review-prompt.md),
[review](260902i-profile-surface-code-review-sol.md)) — verdict *"I would not ship this
unchanged"*, five substantive findings and five overclaiming comments. Four of the five were real
and are fixed:

- **The offer card advertised the allowance out of the tier's *description*.** I had removed the
  structured `ingestsPerPeriod` from it an hour earlier because it read the number twice on the
  seeded rows — and that made this document's own *"raising a quota is one `UPDATE`"* into a lie:
  raise it to 50 and the wall grants 50 while `/profile` goes on saying the 20 still sitting in the
  sentence. The number is structured again; billing.md's *add a tier* recipe now says a description
  must not restate it. **The lesson is the shape**: I removed a duplicate and kept the wrong copy —
  the one that is prose and drifts, rather than the one that is a column and cannot.
- **The Checkout return said *"your subscription is set up"* on any successful confirm.**
  `confirmCheckout` proves only that the Session is this reader's and returns whatever the sync
  found — `null`, `incomplete`, anything — so one's own abandoned Session, pasted back into the
  address bar, produced a congratulation. It now says we asked Stripe and leaves the claim to the
  plan card, which has just been re-read.
- **Upgrade was offered where it could only open the Portal.** The page hid the tier cards for
  `paid` only; `startCheckout` refuses while *any non-terminal* subscription exists, which also
  catches `unpaid`, `incomplete` and a live subscription whose dates we cannot read. The server now
  answers it as `canCheckout`, decided by the same `isTerminalStatus` the checkout route uses.
- **A stale subscription's admin cell showed a lifetime count against a monthly limit**, unlabelled.
  `ingestWindow` has a third value now and the cell says so.

Two were **not** changed, and the reasoning is recorded where it belongs rather than left as a
silent overrule:

- **`/admin/users` really does draw `40 / 3` for a lapsed account**, which Sol called a P1 breach of
  the rule above. Greg's rule is about **what a reader is told about themselves**; this page is the
  administrator reading a support email, and forty against three is exactly the fact that makes it
  make sense. Written out on `Ingests` in admin-columns.tsx.
- **The admin period count and the billing row are two concurrent statements**, so a webhook rolling
  a period between them could mislabel a count. True, and the window is milliseconds on a read-only
  page reloaded by hand. Documented on `planFacts` rather than fixed.

All five overclaiming comments were real and are corrected — including one this stage *made* false:
`POST /api/billing/checkout`'s docstring said the browser uses the reply's `kind` to explain an
Upgrade that became a Portal, and the client this stage wrote ignores it.

#### What the `/profile` surface decided, and the two things worth keeping

**The usage endpoint is a route of its own, not a field on `GET /api/reader`.** That route was the
obvious host and is the wrong one: `useHasProfile` fetches it from every article page, so a billing
field would put a `billing_accounts` read and an `ingest_events` aggregate on the path of *opening
an article*, for data only `/profile` draws. It is also the one billing route that is a **GET** —
the other three are POSTs because each creates a Stripe object, and this creates nothing.

**The lapsed rendering is enforced by the type, not by a comment.** Greg's decision meant the page
must never print *"40 of 3 used"*, and the obvious implementation is a `free` arm with a flag and a
note asking the next person not to print the number. Instead `lapsed` is its own arm of `ReaderPlan`
**with no `used` field**, so the forbidden shape is not on the wire for the page to render. The test
(`tests/billing-plan.test.ts`) covers the half a type cannot: that the words chosen do not
reconstruct the ratio from the numbers that *are* there, and that they make the same three promises
`pay-lapsed` makes.

**Two things found by building it, both small and both the same shape** — a second copy of one fact:

- The offer card read `{ingestsPerPeriod} articles a month. {description}`, which on the real rows
  renders *"20 articles a month. 20 articles a month. …"*: the allowance is already the first
  sentence of every description, because that is what this doc's own *add a tier* recipe writes. The
  doubling was the visible symptom of a structured copy sitting beside the prose.
- `src/billing-plan.ts` is flat rather than `src/billing/plan.ts` because
  `tests/client-imports.test.ts` only lets the browser import a shared module directly under `src/`
  — a good rule, since the rest of `src/billing/` builds Stripe clients and opens transactions.

### Stage: Admin visibility + docs

- [x] `/admin/users`: plan, status, ingests this period. **The estimate was wrong and it is worth
  recording:** the plan said "one field on `AdminUser`, one column, one per-owner statement in
  `pg-admin.ts`", and it is **four fields, two columns and three reads**. A plan with no usage
  figure does not answer the operational question; a usage figure with no limit has no scale; and
  the limit is a database row somebody may raise at any time, so it cannot be a constant in the
  browser. The reads are the ledger aggregate, every `billing_accounts` row, and the (cached) tier
  table — because **which window to count over depends on the entitlement**, and the entitlement is
  decided by `entitlementFromRow`, the same function the wall decides with. Asking SQL instead would
  have been a second implementation of that rule, in a string, free to disagree quietly.
  Nine things now wait on a pool of five ([admin.md](../project/admin.md#where-the-numbers-come-from)).
- [x] New evergreen doc `docs/project/billing.md`, under
  [security-map.md](../project/security-map.md) beside admin.md; `tests/doc-links.test.ts` green.
  Updated with *What a reader sees* and *What `/admin/users` shows*, and admin.md with
  *The plan and ingest columns*.
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

**This stage has said two wrong things about activation; here is the third answer, and why.** It
first said business verification and a payout bank account. That was then wrong, because the account
in question was `acct_1GHoSxLZ0dGTJEEP`, which has billed Greg's consulting work for years and reads
`charges_enabled`, `payouts_enabled` and `details_submitted` all true. It is wrong again now, and in
the other direction: Spideryarn moved to **its own account** on 2026-09-03
([billing.md](../project/billing.md#spideryarn-has-its-own-stripe-account)), and a new account
inherits no activation — Stripe is explicit that it "doesn't inherit any special status" from an
existing one. So verification *is* required, on `acct_1UBW3NLv4piDbwcb`, and it is Greg's to do.

The lesson is not about Stripe. Both wrong versions were written confidently from a true reading of
*an* account, and neither said which. An account id in the sentence would have made the staleness
visible the moment the account changed.

What is genuinely empty in live, and does not cross from the sandbox: products, prices, the portal
configuration, webhook endpoints, the business name, branding, and every dashboard toggle.

**The live run happens on Greg's Mac, and nowhere else.** Confirmed 2026-09-03: only the Mac can
reach the production database, and the setup script has to write the live price ids *into* it. The
shared box is barred from a live key twice over —
[`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) refuses to carry one and
[`src/billing/stripe.ts`](../../src/billing/stripe.ts) refuses to build a client from one outside a
production deployment. So an agent on the box cannot do this step; it can only read the output back.

- [ ] **Greg (manual)**: activate `acct_1UBW3NLv4piDbwcb` — company details, directors, ID, and a
  payout bank account. Usually near-instant, occasionally 1–3 days for extra ownership checks.
- [ ] **Greg (manual)**: set the live account's **public details** and **branding** — they do not
  cross from the sandbox. `stripe:check` fails the business name if it still looks like an internal
  nickname, because that string prints on the page a customer types their card into.
- [ ] **Greg (manual)**: create a live secret key at
  [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) — note the live URL has **no
  `/test/` segment**, which is how you tell the modes apart. Stripe shows a live secret **once**;
  after that it can only be rotated.
- ✅ **On the Mac**: `npm run stripe:setup -- --prod --apply`. Both tiers' price ids are on the
  production rows and the Customer Portal configuration was created and confirmed as the account
  default. `--prod` takes the account and the database from `.env.prod` together — naming either on
  the command line does not work, because `loadEnvLocal()` puts `.env.local` back over the top, and
  the database half of that would have written live price ids to the laptop while printing success
  ([scripts/stripe-target.ts](../../scripts/stripe-target.ts)).
- ✅ **On the Mac**: `npm run stripe:check -- --prod` — all green on `acct_1UBW3NLv4piDbwcb`.
- ✅ **Greg (manual)**: the production webhook endpoint, subscribed to the four events. `stripe:check`
  fails live when nothing is listening, so its green covers this.
- ✅ **Greg (manual)**: live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on Vercel Production.
  **The account and the deployment are two places**, and `stripe:check` only sees the first: on
  2026-09-03 `vercel env ls production` held neither, so live Checkout would have answered 503 with
  every check green.
- ✅ The name question is answered by the account split — the Checkout page says *Spideryarn* and the
  statement will read `SPIDERYARN`, not `GREG DETRE CONSULTING`.
- [ ] **Branding on the live account** — logo and icon. A `⚠` rather than a `✗`, so a green
  `stripe:check` does not mean it is done; Checkout, the Portal, invoices and receipts all use it.
- [ ] **Release check, and it is the only thing left that can still surprise us**: buy one
  subscription on production with a **real card**, confirm the amount charged equals the amount
  advertised, that the entitlement arrives, and what the statement descriptor reads — then cancel it.
  Everything else has only ever been exercised in test mode.

**Unverified, and worth one look before trusting it.** Greg opted the account into a
"next-generation portal experience" on the Billing → Customer portal settings page (2026-09-03). Web
research found no mention of it in Stripe's documentation or changelog at all, so nobody can say
whether it changes how API-created `billing_portal.configurations` or `billingPortal.sessions.create`
behave. Open the Portal from `/profile` on production once and look, rather than assuming.

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
- ✅ After implementation: second Sol review of the code diff — weighted higher than this one
  (a plan review cannot find the bug that doesn't exist yet). Three rounds now, one per stage:
  [settlement](260902i-settlement-code-review-sol.md), [checkout](260902i-checkout-code-review-sol.md),
  [the surface](260902i-profile-surface-code-review-sol.md).
  **A note for whoever sends the next one**: the prompt goes to `codex` as a single argv string, and
  Linux caps one of those at 128 KB — a prompt over that dies with `spawn E2BIG` and
  `scripts/run-codex.ts` exits **0** having written no answer file, which is exactly the shape
  [silent-success.md](../reusable/silent-success.md) is about. Check the answer file exists, not the
  exit code.

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
