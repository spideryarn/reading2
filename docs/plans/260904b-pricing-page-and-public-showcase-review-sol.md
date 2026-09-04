The `/pricing` decision is right, but I would not build the plan unchanged. There are four substantial issues, two of them blockers.

## Ranked findings

1. **P1 — “Public by link” is being widened into “publicly discoverable” without changing consent.**

The existing design explicitly says public articles are unlisted only because Spideryarn publishes no index, and the sharing UI tells owners that “anyone with the link” can read them ([public-read plan](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/docs/plans/260827ai-public-read-only-access.md:591), [sharing confirmation](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/AccessSharing.tsx:325)). `/read/public` changes that promise even though it does not enable search-engine indexing.

Do one of these before exposing the listing:

- Add a separate `listed`/`discoverable` state, default false, and have Greg explicitly list the showcase articles.
- Or decide that every shared article is discoverable, change the sharing confirmation before the listing ships, and obtain fresh consent for existing public rows.

The showcase must also be curated. “First N entries from the public listing” would let any reader’s shared article appear on the official marketing pages. The simplest safe version is a hardcoded ordered set of featured slugs intersected with the live listing; unsharing then removes dead links without allowing arbitrary public content into the showcase.

2. **P1 — The proposed auth continuation does not work through the existing sign-in UI, and `?buy=` alone should not cause a write.**

The plan says this adds “a destination and no mechanism” ([plan](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/docs/plans/260904b-pricing-page-and-public-showcase.md:56)). In fact, `SignInControls` always calls `rememberReturn(location.pathname + location.search)` immediately before OAuth ([SignInControls.tsx](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/SignInControls.tsx:49)). If the pricing CTA first stores `/pricing?buy=reader` and then navigates to the existing login or landing-page form, that form overwrites the intent. The alternative is duplicating the OAuth initiation code, which that component explicitly forbids.

More importantly, `/pricing?buy=researcher` pasted or sent by somebody else would currently be enough to make an authenticated browser POST, create/reuse a Stripe customer, create a Checkout Session, and leave the site. It cannot charge by itself, but it is still an external state change and forced navigation from a GET-shaped address.

Recommended implementation:

- Extract or extend the existing sign-in initiation so it accepts an explicit return destination without overwriting it.
- Store a separate, expiring, read-and-delete buy-intent marker in `sessionStorage`.
- Return to plain `/pricing`, not `/pricing?buy=…`.
- Auto-start only after atomically consuming that same-tab marker and validating it against `summary.canCheckout` and `summary.offers`.
- If you do not want the second marker, highlight the card and require a press. That is safer than treating the query string as consent.

Test exactly one checkout POST under `<StrictMode>`. Consuming the marker synchronously before the POST handles StrictMode and real remounts. On Back from Stripe, the consumed marker and clean URL prevent a replay.

Also note that Stripe’s success and cancellation URLs currently both return to `/profile`, not `/pricing` ([checkout.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/billing/checkout.ts:167)). That is defensible because confirmation and management live there, but the plan should state it.

3. **P1 — `RESERVED` in `src/slug.ts` is not the reservation mechanism this route needs.**

This is a factual error in the plan. `assertSlug` is the looser filesystem/read-state guard; the file explicitly distinguishes it from `isSlug`, which validates HTTP/article slugs ([slug.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/slug.ts:35)). Adding `"public"` to its private `RESERVED` set would not stop:

- `parseRoute` from treating `public` as an article slug;
- the edge public-page handler from treating it as a slug;
- Postgres job/adoption paths from accepting it;
- public or authenticated article endpoints from reading it.

`_jobs` is also not the same class: it reserves a filesystem directory, while `public` reserves a client/edge route.

Add an explicit route-name reservation at the article-address/allocation seam, and special-case `/read/public` before `/read/:slug` in both the client and edge routing. If production already contains that slug, reserving it makes its canonical UI address unreachable; either migrate/redirect it deliberately or choose a non-colliding route such as `/public`.

4. **P2 — Stage 1 has no single owner for billing state, and Stage 2 contradicts its component boundary.**

`CurrentPlan` already owns a `useBilling()` instance ([PricingPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/PricingPage.tsx:202)). If an extracted `PlanChooser` also owns the hook, signed-in `/pricing` will issue two usage requests and hold two independent busy/error/checkout states.

Then Stage 2 says `Plans` itself becomes the cards “each carrying the CTA,” although Stage 1 assigned the cards and CTA to `PlanChooser` ([plan](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/docs/plans/260904b-pricing-page-and-public-showcase.md:123)). As written, Stage 1 temporarily renders the static plan table and a second set of dynamic offer cards, while Stage 2 has to undo that structure.

Decide the final seam in Stage 1:

- A signed-in pricing child owns one `useBilling()` instance.
- It passes billing state to the current-plan line and action slots.
- `Plans`/`PlanCards` remains presentational and accepts per-tier actions.
- `/`, `/features`, `/pricing`, and `/profile` reuse those cards without duplicating the checkout machinery.

Stage 1 also makes the existing sentence “Cancel … from the same page you subscribed on” false, because subscription moves to `/pricing` while management remains on `/profile` ([PricingPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/PricingPage.tsx:136)).

5. **P2 — The listing query needs a stronger contract than “visibility is public.”**

Use a closed query function, not a reusable generic ownerless predicate. It should:

- select an explicit public-card projection;
- require `visibility = 'public'`;
- join only the current revision;
- require the same readability bar as `loadArticle`/`loadHead`: a tree and at least one real block;
- use a deterministic order;
- have a bound or cursor, rather than an unbounded anonymous response.

Otherwise a damaged or half-published public revision can appear as a card whose destination immediately 404s.

For the guard, do not add the file to the existing `eq(articles.slug, …)` exemptions—that guard asks a different question. Add a separate “ownerless enumeration” section that:

- inventories `.from(articles)` queries reachable from the public import graph;
- permits exactly the named listing builder;
- asserts its generated SQL contains the public/discoverable predicate and no owner predicate;
- asserts the exact selected columns;
- integration-tests two owners with private, shared-unlisted, listed-readable, and listed-unreadable rows;
- changes visibility/listing state and proves the route response changes.

The generated-SQL test must target the actual exported builder used by the route. The repo already documents why testing a nearby query is insufficient ([public-reader.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/store/public-reader.ts:337)).

6. **P2 — Generalising the public route inventory is preferable to the SSR fallback.**

A slugless route does not weaken the closed room if represented as a discriminated union:

- `{ kind: "slug"; path(slug); read(slug) }`
- `{ kind: "collection"; path(); read() }`

Keep method enforcement, Postgres enforcement, dispatch, and `send` shared and exhaustive.

The existing sweeps need deliberate changes:

- method and HEAD sweeps should exercise both route kinds;
- malformed-slug tests should run only for slug routes;
- the zero-spend sweep should exercise the collection route once plus its empty/private cases;
- the client-path test should call the collection loader and confirm its exact path is in the inventory.

The SSR fallback is worse: `src/public/page.ts` explicitly says it must not become a second renderer ([public page](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/public/page.ts:12)). Serve the SPA shell for `/read/public`; fetch its data through the closed public JSON namespace.

7. **P3 — Docs are delayed past the stages that make them false.**

Billing/website copy belongs in Stage 1 or 2; sharing/library/security docs and sharing consent belong in Stage 3. Deferring all documentation to Stage 4 means the supposedly independently shippable stages leave authoritative docs and customer copy wrong.

## Direct answers

- **`/pricing` vs `/buy`:** Keep `/pricing`. Analytics can use CTA events, source fields and UTM parameters; ads can link to a tier anchor; SEO does not benefit from a second thin transactional page. The “fourth copy” argument is technically overstated—a `/buy` page could reuse `Plans`—but the product decision is still correct.
- **Auto-start after auth:** Defensible only when tied to a consumed same-tab intent marker. A bare `?buy=` should highlight, not POST.
- **Public route:** Generalise the inventory with a discriminated route type. Do not SSR-render the list.
- **Ownerless query:** Closed projection + fixed predicate + readable-revision constraint + generated-SQL and real-DB tests.
- **Reserved slug:** `src/slug.ts` is insufficient. Existing `/read/public` content loses its UI address unless migrated or redirected.
- **Stages:** Stage 1 can ship alone after the billing-state/auth/copy corrections. Split Stage 3 into data/API security and client route/UI; it is too large once discoverability consent is handled properly.
- **Starting facts:** The three “Where this starts” observations are true of the current code. The false assertions are the claimed slug-reservation mechanism, the claim that auth needs no new mechanism, and the implied same-page Stripe return.

Focused tests passed: 70 passed, 12 Postgres-dependent tests skipped because the sandbox could not reach local Postgres.