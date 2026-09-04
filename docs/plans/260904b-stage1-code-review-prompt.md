# Review the built Stage 1 — the buying path

This is the **code review after building**, which this repo weights higher than the plan review,
because a plan-stage review cannot find an effect that fires twice.

The plan is `docs/plans/260904b-pricing-page-and-public-showcase.md`; you reviewed it already and
your findings are in `docs/plans/260904b-pricing-page-and-public-showcase-review-sol.md`. Stage 1
was built against your recommendations. The scoped diff is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/32ac35d1-d07c-4611-81e5-f1113e41b6a9/scratchpad/stage1.diff`
(the diff of `src/` and `tests/`, with the two new files appended in full).

Read at least: `src/web/PricingPage.tsx`, `src/web/buy-intent.ts`, `src/web/PlanCards.tsx`,
`src/web/BillingSection.tsx`, `src/web/QuotaNotice.tsx`, `src/web/useBilling.ts`,
`src/web/auth-return.ts`, `src/web/SignInControls.tsx`, `tests/pricing-buy-intent.test.tsx`,
`tests/pricing-page-current-plan.test.tsx`, `tests/plans-match-tiers.test.ts`.

## Context you need

`Plans.tsx` was renamed to `PlanCards.tsx` (git mv). It now exports a presentational
`PlanCards({plans, action?})` plus `WebsitePlans`, the website-copy wrapper used by `/`, `/features`
and `/pricing`. `/profile` renders `PlanCards` from `summary.offers` instead — deliberately a
different source, so that raising a quota stays one `UPDATE` with no deploy. Two callers, two
sources.

During the build, the obvious spelling of the buy-intent effect (read the marker when it is needed,
delete on success) produced an **unbounded loop of Checkout Sessions** in the StrictMode test,
because `useBilling` returns a fresh object identity each render and a failed press re-ran the
effect. The shipped version consumes the marker on mount and sets `fired.current` before deciding
anything.

## What I want you to attack

1. **`useBuyIntent` in `PricingPage.tsx`.** Two effects and two refs. Convince yourself it fires at
   most one checkout POST, and say what input would make it fire twice, zero times when it should
   fire once, or fire for the wrong tier. Consider: StrictMode double mount, a real remount, Back
   from Stripe, a slow `/api/billing/usage`, an account switch A→B while the page is open (the page
   is keyed on `readerId` by `App.tsx` — is that enough?), two tabs, and a `billing` object whose
   identity changes on every render.
2. **Did the page lose the no-request guarantee?** `tests/pricing-page-current-plan.test.tsx`
   asserts a signed-out `/pricing` asks for **no URLs at all**. A `SignInControls` panel now renders
   on that page. Verify signed-out really still makes zero requests — including anything Supabase's
   client might do on mount — and say whether the existing test would actually catch a regression
   here or whether it passes for the wrong reason now.
3. **`PlanCards` with two sources.** Is "website copy on the marketing pages, `summary.offers` on
   `/profile`" a defensible seam, or does it recreate the drift the repo already guards with
   `tests/plans-match-tiers.test.ts`? Check that test still measures something real after the
   rewrite from markup regexes to data regexes — the repo's rule is that a check which has only ever
   been green is not evidence.
4. **The repointed refusal links.** `QuotaNotice` now sends a quota-refused reader to `/pricing`
   rather than `/profile`, and two sentences in `src/messages.ts` changed to match. Is there any
   refusal state where `/pricing` is the wrong destination — specifically `pay-lapsed`, and an
   account with a non-terminal subscription where `canCheckout` is false and `/pricing` will
   therefore show no buttons at all? That last one worries me: a reader sent to a page with nothing
   to press.
5. **Anything the diff breaks that the tests do not cover.**

Rank by severity, be concrete, and say plainly where the implementation is wrong rather than merely
different from what you would have written. Run a test file yourself — a finding you reproduced
outranks one you reasoned to.
