I would not ship this unchanged. I found five substantive correctness issues.

## Findings

1. **[P1] Offer cards can disagree with the quota the wall enforces.**  
   [BillingSection.tsx](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/web/BillingSection.tsx:186) renders only `offer.description`, although the authoritative allowance is `offer.ingestsPerPeriod`. The documented one-statement change:

   ```sql
   update billing_tiers set ingests_per_period = 50 where id = 'reader';
   ```

   leaves the seeded description saying “20 articles a month.” The wall grants 50 while `/profile` advertises 20. Either render the structured allowance and remove it from descriptions, or make quota plus description one atomic update rather than claiming quota changes require one field.

2. **[P1] `/admin/users` deliberately renders the forbidden lapsed ratio.**  
   [pg-admin.ts](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-admin.ts:253) gives a lapsed account its lifetime count and the free limit; [admin-columns.tsx](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/web/admin-columns.tsx:206) consequently renders `40 / 3`. The test explicitly requires that result at [billing-admin-plan.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/tests/billing-admin-plan.test.ts:224). That is the exact presentation the settled rule says must never appear. The admin wire needs a lapsed/remaining or unavailable arm too, rather than four fields capable of constructing the prohibited ratio.

3. **[P1] Checkout confirmation claims success without confirming an active subscription.**  
   [useBilling.ts](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/web/useBilling.ts:134) discards the returned `status` and marks every successful confirm request `confirmed`; [BillingSection.tsx](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/web/BillingSection.tsx:225) then says “your subscription is set up.” But `confirmCheckout` proves only that the Session belongs to this reader and then returns whatever sync found—including `null`, `incomplete`, or another unentitled status. An owner-matching abandoned Session placed in the URL can therefore produce a false success message. The banner should depend on an entitled result, or say only that Checkout was checked and let the refreshed plan state make the substantive claim.

4. **[P2] The admin period count and account snapshot are not one coherent observation.**  
   The aggregate derives `inPeriod` using `billing_accounts` at [pg-admin.ts](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-admin.ts:470), while `allAccountSnapshots()` runs as a separate concurrent statement at [pg-admin.ts](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-admin.ts:536). If a webhook rolls the period between those statements, `planFacts` can label the old period’s count as the new current period. Sharing `entitlementFromRow` does not prevent that—the two inputs came from different snapshots. Return the period boundaries with the aggregate and verify they match, or make these reads under one consistent transaction snapshot.

5. **[P2] Stale and other open subscriptions show Upgrade buttons that only open the Portal.**  
   [BillingSection.tsx](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/web/BillingSection.tsx:63) hides offers only for `paid`. Thus `unknown`, and “lapsed” statuses such as `unpaid` or `incomplete`, show Upgrade cards even though [startCheckout](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/billing/checkout.ts:509) redirects every non-terminal subscription to the Portal. This recreates the exact redundant/mislabelled buttons the `sellsTo` comment says it avoids. The summary needs a server-derived `canCheckout`/open-subscription fact; `manageable` alone cannot distinguish cancelled accounts from recoverable open subscriptions.

## Smaller misleading output

- [pg-admin.ts](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-admin.ts:231) renders stale usage as a lifetime count against a monthly tier limit. `61 / 20, lifetime` has no meaningful scale, and raw status `active` does not tell the administrator that the period is stale.
- [admin-columns.tsx](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/web/admin-columns.tsx:206) calls the total “successful ingests,” although it includes unsettled reservations.
- [BillingSection.tsx](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/web/BillingSection.tsx:145) says the Stripe billing page is reached from “the button above,” but a new free account has no Manage billing button.

## Comments that overclaim

- [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/routes.ts:6257): `confirm` does not create a Stripe object; it retrieves one and writes synced state locally. `usage` also reads four underlying tables, not two.
- [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/routes.ts:7236): says the browser uses `kind` to explain why Upgrade became Portal; the client ignores `kind` and explains nothing.
- [pg-billing.ts](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/store/pg-billing.ts:317): `hasLapsed` claims the account had and lost entitlement, but it is also true for `incomplete`, whose first payment never succeeded.
- [QuotaNotice.tsx](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/src/web/QuotaNotice.tsx:11): says three surfaces, but there are four distinct render sites now, including retry refusal on `JobCard`.
- [billing-usage-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/stripe-wiring/tests/billing-usage-route.test.ts:262): says filtering on `stripePriceId` guarantees offer amounts exist; those are independent rows and the filter does not check them.

I found no cross-owner exposure or browser-controlled price path. The AddPage, upload, and job-retry refusal snapshots preserve the quota message correctly; I found no second instance of the fixed polling race.

Verification: the four non-Postgres suites passed, 39 tests total. The Postgres suite could not run in this review sandbox because connecting to `127.0.0.1:54362` was denied (`EPERM`), so I relied on the supplied real-Postgres evidence for that portion.