## Findings

1. **P1 — `past_due` still grants paid entitlement, contrary to the stated contract.**  
   [`ENTITLED_STATUSES`](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/billing/tiers.ts:95) includes `"past_due"`. That grants Reader/Researcher quota during `past_due`, although the review contract says both `past_due` and `unpaid` are unentitled. The new test titled “leaves … in neither list” only checks `isTerminalStatus`; it never checks the entitlement list, and therefore passes while its own claim is false: [billing-checkout.test.ts:309](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/tests/billing-checkout.test.ts:309).  
   `TERMINAL_STATUSES = ["canceled", "incomplete_expired"]` is otherwise the right shape: `past_due`, `unpaid`, and `incomplete` should remain nonterminal even when unentitled.

2. **P1 — concurrent checkout calls create multiple payable subscription sessions.**  
   The subscription check at [checkout.ts:418](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/billing/checkout.ts:418) and session creation at [checkout.ts:438](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/billing/checkout.ts:438) have no lock, reservation, persisted open-session record, or request idempotency spanning them. Two requests can both observe no subscription and create two sessions for the winning customer. Both can subsequently be completed, charging the reader twice.

   The concurrency test actually enshrines this: it requires both calls to return `kind: "checkout"` and observes two created sessions at [billing-checkout.test.ts:425](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/tests/billing-checkout.test.ts:425). Mapping both sessions to one customer protects webhook ownership; it does not prevent two subscriptions.

   Consequently this comment is false:

   > “the worst case a double-click can reach is that orphan”

   — [checkout.ts:45](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/billing/checkout.ts:45)

   Stripe has an optional Dashboard setting specifically for limiting customers to one subscription, but the repository neither configures nor verifies it, so it is not a code-level guarantee. [Stripe documents that disabling that setting permits multiple subscriptions.](https://docs.stripe.com/payments/checkout/limit-subscriptions)

   The later anomaly handling is not a substitute: it logs and picks one subscription while both invoices remain. It also defines “live” as *entitled* at [subscription.ts:192](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/billing/subscription.ts:192), so an `active + unpaid` pair is not even reported as a multiple-live anomaly. A newer canceled subscription can also be stored while an older unpaid one remains collectible, after which checkout sees the terminal row and can sell yet another subscription.

3. **P1 — the tier cache can sell a retired tier or an obsolete price.**  
   `tierToSell` reads through the 30-second `allTiers()` cache at [checkout.ts:251](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/billing/checkout.ts:251). The cache returns its old snapshot at [pg-tiers.ts:46](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-tiers.ts:46).

   Therefore:

   - Setting `active = false` can still produce a Checkout Session for up to 30 seconds.
   - Replacing `stripe_price_id` can still produce a session for the old, deliberately unarchived price.
   - `recordTierPrice()` invalidates only the setup script’s process; it cannot invalidate already-running web instances.

   The stale decision is not bounded to 30 seconds: Stripe Checkout Sessions remain usable for up to 24 hours by default, and a completed subscription then remains on the old price. [Stripe’s API reference documents that expiry window.](https://docs.stripe.com/api/checkout/sessions/create)

   The retired-tier test clears the cache after inserting its fixture, so it cannot catch this interleaving: [billing-checkout.test.ts:516](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/tests/billing-checkout.test.ts:516). The cache comment claiming “the failure direction is safe” is no longer true now that checkout consumes it: [pg-tiers.ts:16](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-tiers.ts:16).

4. **P2 — Stripe failures are reported inconsistently and sometimes expose provider text.**  
   [`orBillingUnavailable`](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/billing/checkout.ts:185) catches only locally-created `StripeConfigError`s.

   - Network, authentication, rate-limit, deleted-customer, and invalid-price failures from checkout or portal bubble out as 500.
   - The dispatcher returns the Stripe exception’s message verbatim at [routes.ts:5873](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/routes.ts:5873).
   - The same failures during session retrieval are instead rewritten as “No such checkout session”/404 at [checkout.ts:529](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/billing/checkout.ts:529), preventing fault capture and falsely blaming the identifier.
   - A prefix-valid but revoked/wrong Stripe key demonstrates both paths: checkout/portal return raw 500; confirm returns fabricated 404.

5. **P2 — an active but unprovisioned tier is misclassified as a bad request.**  
   [checkout.ts:257](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/billing/checkout.ts:257) combines “unknown tier”, “retired tier”, and “active tier missing its Stripe price/mode” into one 400. The first two are request refusals; the third is deployment/configuration failure and should be a 503-style `BILLING_NOT_AVAILABLE`. The comment claiming callers have nothing different to do does not make those failures equivalent operationally.

6. **P3 — the anonymous-route test still does not test “no session.”**  
   `postAnonymously` omits the verifier, but `drive` always attaches `Authorization: Bearer test-token` at [billing-checkout.test.ts:864](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/tests/billing-checkout.test.ts:864). The test at line 787 exercises an invalid token through the real verifier, not the missing-authorization branch. Removing the `[auth-none]` path could leave this test green.

   Likewise, “takes … the owner from the gate” directly passes `OWNER` into `startCheckout` at [billing-checkout.test.ts:357](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/tests/billing-checkout.test.ts:357); it proves parameter propagation, not positive route-to-auth identity binding.

7. **P3 — two remaining comments overclaim.**

   - “All three create a Stripe object” is false: confirm retrieves a Session and synchronizes state; it creates no Stripe object — [routes.ts:6253](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/routes.ts:6253).
   - “refusing anything that is not a tier id” is false: currency and arbitrary unknown fields are accepted/ignored — [checkout.ts:203](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/billing/checkout.ts:203).
   - “the response cannot be used to tell” is stronger than implemented. Status and body are uniform, but timing is not normalized: nonexistent sessions follow Stripe’s error path while another owner’s valid session follows retrieval-plus-comparison. I would not call that a practical cross-reader leak given the identifier requirement, but the comment should claim only uniform status/body.

The important pieces that are sound: the customer mapping is committed before session creation; the conditional claim correctly adopts the winning customer; database uniqueness prevents two owners sharing a mapped customer; `confirmCheckout` checks both owner-bearing fields before syncing; request-controlled prices are not forwarded; and production return URLs are fixed rather than derived from request headers.