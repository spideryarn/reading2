I would not ship Stage 1 unchanged. The one-POST logic is sound within one mounted tab, but the buying path still has two genuine dead ends and the tier-drift guard can miss a wrong purchase.

## Ranked findings

1. **P1 — quota refusals can send readers to a page with no action capable of increasing their quota.**

[QuotaNotice.tsx](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/QuotaNotice.tsx:65) routes all three quota codes to `/pricing`, but they do not share one remedy:

- A paid reader at their monthly limit has a non-terminal subscription, so [summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/billing/summary.ts:89) sets `canCheckout: false`. Consequently [PricingPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/PricingPage.tsx:312) renders no plan buttons.
- The page does contain a small “Change plan” link to `/profile`, but `/profile` can only open the Portal—and the live Portal explicitly has subscription updates disabled, as recorded in [billing.md](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/docs/project/billing.md:1132). It cannot perform Reader → Researcher. The reader therefore has no route that adds quota.
- `pay-lapsed` is not necessarily terminal. [hasLapsed](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/store/pg-billing.ts:367) includes `unpaid`, `incomplete`, and unknown non-entitled statuses, while `canCheckout` refuses all non-terminal statuses. For those accounts, [messages.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/messages.ts:2983) now says “resubscribing from the pricing page” even though that page offers no subscription button. That sentence is wrong.

`/pricing` is correct for free accounts and terminal lapsed accounts. It is wrong as a uniform remedy. Either the refusal needs a structured remedy (`subscribe`, `manage-existing`, `wait/reset`), or `/pricing` must provide a real Manage/Change action—and the Portal must actually support plan switching.

2. **P1 — a failed usage read silently removes the entire buying path.**

A signed-in `/pricing` can show actions only after `summary` arrives. When `/api/billing/usage` fails, `summary` remains null, `buyPlan` returns null for every plan, and [PlansForAReader](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/PricingPage.tsx:327) renders neither `billing.error` nor `billing.reload`.

The result is exactly the worried-about page: prices, but nothing useful to press and no explanation. The existing test at [pricing-page-current-plan.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/tests/pricing-page-current-plan.test.tsx:295) currently blesses that state by checking only that prices remain.

This is especially serious because quota refusals now direct readers there. `/profile` already has the appropriate “Couldn’t read your plan — Try again” treatment; `/pricing` needs an equivalent.

3. **P1 — the drift test can stay green while “Get Reader” buys Researcher. Reproduced.**

The two-source seam itself is defensible:

- Marketing pages need immediately available static copy with no fetch.
- `/profile` should continue using live `summary.offers`.

The rewritten guard, however, checks names, IDs, allowances, and prices as independent tokens anywhere in the file. It never binds them into one plan record.

I performed a controlled mutation swapping only the `reader` and `researcher` IDs. The resulting Reader row was:

```ts
{ id: "researcher", name: "Reader", allowance: "20 a month", ... }
```

Every current predicate in [plans-match-tiers.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/tests/plans-match-tiers.test.ts:72) still passed. The same blindness applies to swapping allowances or prices between rows.

That mutation would make the signed-out “Get Reader” press store `researcher`; `useBuyIntent` validates only that `researcher` is somewhere in `summary.offers`, then posts it. This is a real wrong-tier path, not merely weak test style.

Export or otherwise parse the static plan records and compare complete records keyed by tier ID. Then deliberately swap two IDs and require the actual test to fail.

4. **P2 — `useBuyIntent` is once-only, but its expiry and handoff semantics are wrong.**

Within one stable component instance, [useBuyIntent](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/PricingPage.tsx:368) is correct:

| Case | Result |
|---|---|
| StrictMode effect replay | One POST |
| Fresh `billing` identity every render | One POST; `fired` is set before `upgrade` |
| Back from Stripe/full remount | Zero additional POSTs; marker is gone |
| Invalid or unavailable tier | Zero, correctly |
| `canCheckout: false` | Zero, correctly |

The boundary failures are:

- **Slow usage can defeat the TTL. Reproduced.** `takeBuyIntent` validates age at mount and returns only the tier ID. I held `/api/billing/usage` pending, advanced the clock eleven minutes, then resolved it; checkout still posted. The creation time must remain available and be checked again immediately before the POST.
- **A reload/remount between consumption and summary resolution loses a valid purchase.** The marker has been deleted and the only remaining copy is a component ref. The same occurs on A→B account switching: the key correctly prevents B seeing A’s billing summary, but it also destroys the pending intent before B can use it.
- **Two tabs are only once-safe per tab.** If both tabs contain a marker—through two presses or a duplicated tab after storage was written—each can issue one POST. The server explicitly permits concurrent creation of two payable Checkout Sessions.
- **An account switch cannot cancel a checkout already started.** Keying fixes displayed state, but does not abort the asynchronous `apiFetch`, which obtains the current session token. This deserves a focused A→B test.

There is an unavoidable tradeoff between consuming early and surviving remounts. Exact-once across tabs/remounts requires an idempotency mechanism; the simpler product alternative remains highlighting the selected tier after sign-in and requiring one final press.

5. **P2 — production email sign-up does not reliably preserve the intent.**

The continuation works for Google and same-tab password sign-in. Production email sign-up requires confirmation, however, and confirmation links commonly open in another tab. Both `auth-return` and `buy-intent` use tab-scoped `sessionStorage`, so the new tab has neither destination nor tier.

That contradicts the pricing-page promise that “whichever plan you chose above, we will pick it up again once you are in” at [PricingPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/PricingPage.tsx:268). There is no test covering the production confirmation path.

6. **P2 — the no-request guarantee currently holds, but its test does not verify Supabase.**

The implementation is presently clean:

- `SignInControls` has no mount effect.
- `googleSignInAvailable()` runs only after pressing Google.
- The Supabase client is a module singleton already required by `App`/`useSession`; rendering another `SignInControls` does not create another client.
- I mounted signed-out pricing with the real Supabase module, empty browser storage, and a global fetch recorder: zero requests.

But [pricing-page-current-plan.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/tests/pricing-page-current-plan.test.tsx:52) replaces the entire Supabase module. Its `asked === []` assertion catches ordinary component fetches, but cannot catch client initialization, refresh behavior, or a regression inside that module. So it is valid evidence about `PricingPage`’s billing behavior, not about the full Supabase-inclusive guarantee it now claims.

## Verification

- Focused Vitest run: **19 passed, 5 skipped** across the four requested suites. All five skipped assertions were the Postgres-backed parts of `plans-match-tiers.test.ts`; this sandbox could not reach local Postgres.
- TypeScript: **passed**.
- Real-Supabase clean-storage mount: **zero requests**.
- Slow-response TTL defect: **reproduced**.
- Swapped-tier-ID guard blindness: **reproduced**.

The StrictMode loop is fixed. The remaining blockers are the refusal dead ends, silent billing-read failure, and the drift test’s failure to bind an ID to the plan it actually buys.