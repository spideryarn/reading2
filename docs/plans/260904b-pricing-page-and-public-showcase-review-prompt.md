# Review this plan before it is built

You are reviewing a plan for the Spideryarn repo (a reading app: TypeScript + ESM, hand-rolled
client router, Postgres via drizzle, Stripe billing live with real paying customers since
2026-09-03). Read the plan at `docs/plans/260904b-pricing-page-and-public-showcase.md`.

Please also read, at least:

- `src/web/PricingPage.tsx`, `src/web/Plans.tsx`, `src/web/BillingSection.tsx`, `src/web/useBilling.ts`
- `src/web/auth-return.ts`, `src/web/router.ts` (parseRoute and the href constants)
- `src/public/route-names.ts`, `src/public/routes.ts`, `src/store/public-slug.ts`,
  `src/store/public-reader.ts`
- `src/slug.ts`, `tests/owner-isolation.test.ts`, `tests/pricing-page-current-plan.test.tsx`
- `docs/project/billing.md`, `docs/project/marketing-pages.md`, `docs/project/security-map.md`

## What I most want your judgment on

1. **The `/pricing`-is-the-buying-page decision.** The user suggested a separate `/buy` page; I
   argued for putting the payment action on `/pricing` instead, because a second page listing the
   same plans would be a fourth copy of the price table. Is that the right call? Is there a reason a
   distinct `/buy` would be better that I have missed (analytics, ad landing pages, being able to
   link "buy" without re-showing prices, SEO)?

2. **Buy-intent through sign-in.** Signed-out reader presses "Get Reader" →
   `rememberReturn("/pricing?buy=reader")` → Google → land on `/pricing?buy=reader` → strip the
   param via `history.replaceState` → call `upgrade("reader")`, which POSTs `/api/billing/checkout`
   and `location.assign`es to Stripe. Attack the security and the failure modes of this
   specifically. Is auto-starting a paid checkout after an auth redirect defensible? What happens on
   a double mount in React StrictMode, on a back button from Stripe, on a stale sessionStorage
   value, on a tier id the reader may not buy, or if `?buy=` is simply pasted into the address bar
   by someone else? Should it instead land with the card highlighted and require a press?

3. **The slugless public route.** Every entry in `PUBLIC_ROUTE_NAMES` is `/api/public/<name>/<slug>`
   by construction, and three sweeps walk that inventory. I propose generalising `publicRoute()` to
   admit a slugless listing route. Read `src/public/routes.ts`'s docstring about "the closed room"
   and tell me whether that generalisation weakens it, and what the sweeps would stop covering. Is
   my stated fallback (render the list in the existing SSR `/read/:slug` shell path, ship no new
   endpoint) actually better?

4. **The new ownerless listing query.** `publicSlug()` is deliberately single-slug and lives alone
   so the public leaf cannot import `currentOwnerId`. A listing query is a second ownerless
   predicate. What is the safest shape for it, and what exactly should
   `tests/owner-isolation.test.ts`'s static guard be taught, such that it does not become a hole the
   next person widens? Note the guard currently greps `src/store/` for `eq(articles.slug, …)` — a
   listing query has no slug at all, so it may pass that guard while being the more dangerous thing.
   That worries me. Is there a check that would actually catch a bad listing query?

5. **Reserving the slug `public`.** Is `RESERVED` in `src/slug.ts` sufficient, given the client
   router, the edge `decidePublicPage`, and articles that may already exist with that slug? What
   breaks for an existing article if we reserve a name it is using?

6. **Stage boundaries.** Is stage 1 genuinely shippable alone? Is stage 3 too big? Anything in stage
   2 that will turn out to depend on stage 3 or vice versa?

7. **Anything the plan asserts that is not true of the code.** I checked the three "Where this
   starts" facts myself, but check them again — this repo has a habit of plans written from docs
   rather than from code, and one of its own rules is that a claim is checked against the code.

Be concrete and rank your findings by severity. Where you think I am wrong, say so plainly and say
what to do instead. Feel free to run a test file — a finding you reproduced outranks one you
reasoned to.
