# Pricing that you can act on, and a shelf of public articles

Greg, 2026-09-04:

> Right now, the only way to pay is from the /profile page, which is a bit buried and confusing.
> Can we at least link to this from the Pricing page, and anywhere else appropriate, to make it
> easier for users? And take screenshots of the pricing page & table, and make it more attractive
> (e.g. with Sonnet web research on best practices for pricing pages) - same for the pricing page
> elsewhere e.g. in Features (ideally reusing the same machinery). And make it a bit clearer how the
> pricing/benefits works (maybe in tooltips). And create a /read/public/ page that lists
> Public-readable pages (reusing some of the article-listing machinery from Homepage), and pick a
> few of those to link to from various places to showcase what Spideryarn is capable of.

Four jobs, and they are not one job: a **buying path**, a **pricing page worth reading**, a
**public shelf**, and the **showcase links** that hang off it.

**This plan was rewritten after a GPT Sol review**
([the review](260904b-pricing-page-and-public-showcase-review-sol.md)) found three P1s, two of them
factual errors in the first draft. What changed, and why, is in
[§ What the review changed](#what-the-review-changed) — read that before the stages, because two of
the mechanisms named there are not the obvious ones.

## Where this starts

Three facts, checked in the code rather than in a doc about it, and re-checked by the review.

- **`/pricing` cannot take money.** It renders `Plans` (a hardcoded three-row `<table>`) and one line
  saying which plan you are on, whose only action is a text link to `/profile`
  ([`PricingPage.tsx:233`](../../src/web/PricingPage.tsx)). Every Upgrade button in the app lives in
  `BillingSection` on `/profile` and nowhere else. The file argues for that on purpose — *"a second
  Upgrade button here would be a second copy of that flow to keep right"* — and that reasoning is
  sound about **copying** the flow and is what this plan replaces with **moving** it.
- **`/pricing` is not one of the marketing pages, visually.** `LandingPage` and `FeaturesPage` open
  with `className="site"` and `<SiteNav />`; `/pricing` is a bare `<main class="tw:max-w-3xl">` with
  a `← Back` link. So the `--site-*` tokens are not even in scope there: `site-panel`,
  `site-cta-ghost` and `site-frame` would render with transparent borders and no fill on that page.
  Confirmed in the browser, 2026-09-04: `/pricing` has no nav at all, and its content column starts
  at x=360 where `/` and `/features` start at x=168 — the same table, in a column that does not line
  up with the rest of the site.
- **There is no listing of public articles anywhere, and its absence is a recorded decision.**
  `PUBLIC_ROUTE_NAMES` has exactly one entry (`article`), `publicSlug()` is single-slug-only by
  design, and `library.md` says the shelf's Shared badge is *"a badge, not a filter … there is
  deliberately no way to sort or narrow the shelf by this until there is enough shared material"*.

The research behind the redesign is in [§ What the research said](#what-the-research-said).

## Decisions taken before building

**`/pricing` is the buying page. There is no `/buy`.** Greg raised one — *"maybe we should actually
move the payment action out of /profile e.g. into its own /buy page, so then we could link to that
from various places"* — and the goal behind it is right: one address you can link to that starts the
purchase, and that works for a stranger. `/pricing` already **is** that address: it is in `SiteNav`,
in `SiteFooter`'s `LINKS`, and linked from the landing page. A second page listing the same three
plans would be another copy of the price table to keep in step, and the copy that goes stale is
always the one the customer read. Sol agreed with the decision while calling the "fourth copy"
argument overstated — a `/buy` page *could* reuse `Plans` — and named the real reasons it is still
right: analytics wants CTA events and UTM parameters rather than a URL, ads can link to a tier
anchor, and SEO gains nothing from a second thin transactional page.

**The flow moves, it is not copied.** The tier cards and the `upgrade(tierId)` call come out of
`BillingSection` into presentational cards plus one owner of the billing state, which **both**
`/pricing` and `/profile` render. `/profile` loses nothing, `/pricing` gains the button, and there is
still exactly one copy of the checkout flow — the thing `PricingPage`'s header was right to protect.

**Buy-intent rides in its own `sessionStorage` marker, and never in the URL.** See
[§ What the review changed](#2-the-url-cannot-be-the-consent-and-the-first-mechanism-did-not-work).

**Stripe still returns to `/profile`.** `successUrl` and `cancelUrl` both point there
([`src/billing/checkout.ts:167`](../../src/billing/checkout.ts)), and that stays: confirmation
(`POST /api/billing/confirm`) and management both live on `/profile`, and `CheckoutReturnNote` is
already there to read the `?checkout=` parameter. Written down because a reader of this plan will
otherwise assume the round trip ends where it started.

## What the review changed

### 1. Listing every public article changes a promise, so the promise changes first

`SHARING_ON` ([`src/messages.ts:2207`](../../src/messages.ts)) tells an owner *"Anyone with the link
can read this, without signing in."* That is a promise about **reachability by link**, not about
**discoverability**, and `library.md` records the matching decision that the shelf gets *a badge, not
a filter*. A public index changes what an owner agreed to.

Sol offered three ways out; **Greg chose the third on 2026-09-04: list every public article, and
change the promise.** So two things are load-bearing and neither may slip:

- **The sharing copy changes before the listing ships, not after.** `SHARING_ON`, the confirmation
  dialogue (`SHARING_CONFIRM_TITLE` and its body) and `SHARING_CANNOT_UNRING` must say that a shared
  article may be listed publicly. Shipping the listing first would retroactively publish material
  people shared under a narrower promise. This is a gate, not a task ordering preference.
- **Before deploying, count the public articles that are not Greg's.** This box reaches only the
  local Supabase, where there are currently **zero** public articles. If production holds public
  articles owned by somebody else, they were shared under the old sentence, and Greg decides per
  article whether to notify, unshare or leave — before the index is live, not after. The plan cannot
  make that call and does not.

### 2. The URL cannot be the consent, and the first mechanism did not work

Two separate faults in the first draft, both confirmed by reading the code.

**It would have been overwritten.** `SignInControls` calls
`rememberReturn(location.pathname + location.search)` immediately before OAuth
([`SignInControls.tsx:49`](../../src/web/SignInControls.tsx)). Storing `/pricing?buy=reader` and
then navigating to a sign-in page means that page overwrites the intent with its own address. The
plan's claim that this added *"a destination and no mechanism"* was simply wrong.

**And a query parameter is not consent.** `/pricing?buy=researcher`, pasted or sent by somebody
else, would have been enough to make an authenticated browser POST `/api/billing/checkout`, create
or reuse a Stripe customer, open a Checkout Session and leave the site. It cannot charge by itself,
but it is an external state change and a forced navigation off our origin, triggered by a
GET-shaped address.

**So the mechanism is:**

- The pricing page carries its own sign-in panel, the way the landing page does. A signed-out reader
  pressing *Get Reader* therefore signs in **on `/pricing`**, and `SignInControls`' existing
  `remember()` captures `/pricing` naturally — no second OAuth path, and nothing duplicated. This
  also fixes the browser check's loudest complaint, that the page has no call to action at all.
- The tier rides in a **separate, expiring, read-and-delete `sessionStorage` marker**, alongside
  `spideryarn:auth-return` and following its three rules. Never in the address bar.
- On return, the marker is **consumed synchronously before the POST**, and only then validated
  against `summary.canCheckout` and `summary.offers`. A tier the reader may not buy is ignored
  silently — the cards are on screen either way.
- **Test one POST under `<StrictMode>`.** Consuming before posting is what makes a double mount, a
  real remount and Back-from-Stripe all safe; a test that never saw two mounts proves none of it.

### 3. `RESERVED` in `src/slug.ts` is the wrong gate — a factual error in the first draft

Verified: `isSlug` ([`src/ingest.ts:404`](../../src/ingest.ts)) is a bare regex —
`/^[a-z0-9][a-z0-9-]*$/` plus a length cap — and **does not consult `RESERVED` at all**. `RESERVED`
belongs to `assertSlug` in [`src/slug.ts`](../../src/slug.ts), a different function guarding the
filesystem/read-state path, and `_jobs` is in it because `data/_jobs/` is a directory. `parseRoute`
and the edge both ask `isSlug`. So adding `"public"` to `RESERVED` would have changed nothing about
routing, while looking exactly like it had.

**What actually has to happen:** `/read/public` is matched **before** `/read/:slug`, in both
`parseRoute` and the edge's `decidePublicPage`, and the name is refused at the article-address
allocation seam so no new article can take it. If production already has an article with that slug,
reserving the name makes its canonical address unreachable — so that check comes first, and if it
finds one, the honest answers are a deliberate redirect or a non-colliding route such as `/public`.
Locally: no article uses `public`, `pricing` or `buy`.

### 4. One owner of the billing state, and one seam decided up front

`CurrentPlan` already owns a `useBilling()` instance
([`PricingPage.tsx:202`](../../src/web/PricingPage.tsx)). A `PlanChooser` that owned a second one
would put two usage requests and two independent busy/error/checkout states on one page. And the
first draft had stage 1 add dynamic offer cards *beside* the static table, then stage 2 undo that —
building a structure in order to remove it.

So the seam is decided now, in stage 1, and stage 2 only restyles it:

- **`PlanCards` is presentational.** It takes the three plans and an optional per-tier action, and
  knows nothing about billing. `/`, `/features`, `/pricing` and `/profile` all render it.
- **One signed-in child of `/pricing` owns one `useBilling()`**, and passes state down to both the
  current-plan line and the card actions.

Stage 1 also makes an existing sentence false — *"Cancel whenever you like, from the same page you
subscribed on"* ([`PricingPage.tsx:136`](../../src/web/PricingPage.tsx)) — because subscribing moves
to `/pricing` while managing stays on `/profile`. It is fixed in the stage that breaks it.

### 5. The listing query is a closed query, not a reusable predicate

`publicSlug()`'s own header states the rule: the worst version of public reading is one widened
owner predicate. A listing is a **second** ownerless query, so it gets the same discipline and a
tighter contract than *"visibility is public"*. It must: select an explicit public-card projection;
require `visibility = 'public'`; join only the current revision; **require the same readability bar
as `loadArticle`/`loadHead`** — a tree and at least one real block; order deterministically; and be
bounded or cursored rather than an unbounded anonymous response. Without the readability bar a
damaged or half-published revision appears as a card whose destination immediately 404s.

**And the existing guard would not catch a bad one.** `tests/owner-isolation.test.ts` greps
`src/store/` for `eq(articles.slug, …)`; a listing query has no slug in it, so it sails past while
being the more dangerous thing. That is the worry the review was asked about and it was right. The
guard gains a **separate ownerless-enumeration section**: inventory `.from(articles)` queries
reachable from the public import graph, permit exactly the named listing builder, assert its
*generated SQL* contains the public predicate and no owner predicate, assert the exact selected
columns, and integration-test two owners across private / public-readable / public-but-unreadable
rows — then change visibility and prove the route's answer changes. The generated-SQL assertion must
target the exported builder the route actually calls;
[`public-reader.ts:337`](../../src/store/public-reader.ts) already records why testing a nearby query
is not enough.

### 6. A slugless public route, as a discriminated union — and not SSR

Every entry in `PUBLIC_ROUTE_NAMES` is `/api/public/<name>/<slug>` by construction. Generalising it
does **not** weaken the closed room provided the route type is a discriminated union —
`{ kind: "slug"; path(slug); read(slug) }` | `{ kind: "collection"; path(); read() }` — with method
enforcement, Postgres enforcement, dispatch and `send` staying shared and exhaustive. The three
sweeps then need deliberate updating rather than inheriting: method and HEAD sweeps exercise both
kinds, malformed-slug tests run only for slug routes, the zero-spend sweep covers the collection
route plus its empty and private cases, and the client path test calls the collection loader and
checks its exact path is in the inventory.

The first draft's fallback — render the list in the SSR shell — is **worse**, and is dropped:
[`src/public/page.ts:12`](../../src/public/page.ts) says outright it must not become a second
renderer. `/read/public` serves the SPA shell and fetches through the closed JSON namespace.

### 7. Docs move into the stage that makes them false

Deferring every doc to a final stage means the "independently shippable" stages ship with
authoritative docs and customer copy wrong. Billing and website-text go with stages 1–2; sharing,
library and security-map go with stage 3.

## What the research said

Web research on pricing-page practice (2025–26), applied only where it fits a three-tier indie
product.

- **Cards, not a table**, three across, price and CTA above the fold. A comparison table below the
  cards earns its place once the cards cannot show the difference; with three tiers ours does not
  need one yet — **so it is not built**.
- **Highlight one tier, and make it Reader, not Researcher.** A filled or elevated card beats a
  subtle badge, and the tier to highlight is the step up from Free. Pushing a stranger at the £40
  tier reads as pushing, on a product that sells careful reading.
- **Explain the unit inline, never in a tooltip.** The biggest legibility gap: "20 articles a month"
  is a number without a scale. A concrete translation goes *on the card*. This also settles Greg's
  *"maybe in tooltips"*: **if a number needs explaining to be usable, the explanation is not tooltip
  material.** Tooltips take the fine print behind it, and must have a tap/focus trigger — a
  hover-only tooltip is invisible on a touchscreen and to a keyboard. `Tooltip.tsx` is Floating UI
  and handles focus; the touch case gets checked, not assumed.
- **"No card required" under Free, "cancel any time" under the paid ones**, at the point of decision.
- **An FAQ under the cards**, answering the ambiguity a metered unit creates. Greg approved
  agent-written copy on 2026-09-04; new sentences still carry `[tissue]` markers per
  [positioning.md § Whose words](../project/positioning.md#whose-words), so a later dictation pass
  can find them.
- **Not applicable, deliberately not built:** the monthly/annual toggle (there is no annual price)
  and a currency switcher (hosted Checkout picks the currency from the customer's location — which
  is why each Stripe price carries all three, [billing.md](../project/billing.md)).

## Stages

### Stage 1 — you can pay from the page that shows the prices

- Extract presentational `PlanCards` from `Plans` + `BillingSection`'s `Offer`; one `useBilling()`
  owner on `/pricing`; `/profile` renders the same cards. `BillingSection` keeps the plan headline,
  *Manage billing* and `CheckoutReturnNote`.
- A sign-in panel on `/pricing`, so signed-out CTAs sign in on this page and `remember()` works.
- The buy-intent marker: store, consume-before-post, validate against `canCheckout` + `offers`.
- Repoint links that mean *buy* at `/pricing`; leave links that mean *manage* at `/profile`.
- Fix the now-false "cancel from the same page you subscribed on" sentence; update
  `website-text.md` and `billing.md` in this stage.
- **Done:** signed out, *Get Reader* ends at Stripe Checkout after one Google sign-in, in a real
  browser. Signed in, it goes straight there. One POST under `<StrictMode>`.
  `tests/pricing-page-current-plan.test.tsx` still green — **including its assertion that a
  signed-out page makes no requests at all**, which the new panel and CTAs must not break.

### Stage 2 — the pricing page, rebuilt

- `/pricing` joins the marketing pages: `className="site"`, `SiteNav` (a third `here` value),
  `SiteFooter variant="marketing"`.
- `PlanCards` restyled on `site-panel`, Reader elevated, concrete allowance translation, CTA, trust
  line. One component, so `/` and `/features` get it too — Greg's *"reusing the same machinery"*.
  `tests/plans-match-tiers.test.ts` updated in step or it measures the old shape.
- Tooltips on fine print only; checked on touch and by keyboard.
- FAQ; the four `How it works` paragraphs folded in rather than sitting above it twice.
- **Screenshots** at 1440 and 390, one viewport at a time — a full-page capture of these pages lies
  twice ([marketing-pages.md](../project/marketing-pages.md)), and the before-shots already hit it.
- **Done:** three pages agree, no dead `site-*` classes, `tests/landing-assets.test.ts` and
  `tests/site-footer.test.tsx` green.

### Stage 3a — the data and the API, with the consent change

- The sharing copy changes **first** (§1). Then: the closed listing query (§5), the guard's new
  ownerless-enumeration section, the discriminated public route (§6).
- Local fixture articles made public through the real endpoint, so there is something to develop
  against — there are zero public articles locally.
- **Done:** a private article can never appear in the listing, proven by a two-owner test that was
  red first; the generated-SQL assertion is in place; sharing copy tells the truth.

### Stage 3b — `/read/public`

- `/read/public` matched before `/read/:slug` in the client **and** the edge (§3), after the
  production slug check.
- `PublicLibraryEntry`: a separate DTO, not a widened `LibraryEntry`. No `opens`, `lastOpenedAt`,
  `comments`, `titleOverridden`, `archivedAt`, `fixture`.
- The card: `ShelfCard`'s owner verbs become optional capabilities (the callback *is* the
  capability), or a smaller public card on the same tokens — whichever leaves fewer parts touching.
- Docs: `library.md`, `security-map.md`, a doc for the page under its entry point.
- **Done:** signed out, the page lists public articles and every card opens.

### Stage 4 — the showcase, and the reviews

- Greg flips the showcase articles public in the production UI (his content, his consent, and it
  keeps the `article_visibility_changes` rights row honest — a raw SQL flip would not).
- Showcase links driven by the listing, so an unshared article leaves no dead link.
- **Pre-deploy gate:** the count of non-Greg public rows in production (§1).

### Stage 5 — a public article counts half

Added mid-run. Greg, 2026-09-04:

> please also change how we price Public-readable articles - they are half-price, i.e. they only
> count as a half-article against the user's article-quota (e.g. free users can make 6 Public
> articles, $10 users can make twice as many if Public, etc etc). … The intention is to incentivise
> people to make articles Public, because then more people benefit from them.

**This is a change to money logic on a ledger that has already taken real payments**, so it does not
get folded into another stage. It also sits naturally after stage 3, because the incentive and the
listing are the same argument: sharing is worth something to us, so it is worth something to the
reader.

**The crux is that the two events are far apart in time.** A slot is spent when an article is
*added*; sharing happens later, or never. So "half price" needs a mechanism, and the three
candidates differ mostly in how they fail:

- **Recompute live** — usage is `private + public/2`, derived from current visibility every time it
  is asked. Nothing to game; unsharing simply puts the usage back. The cost is that a reader can
  become *over* quota by unsharing, and then be refused their next add.
- **A credit** — sharing refunds half a slot, once. Easy to say; share-then-unshare is free slots
  for ever unless it is clawed back, which is the ledger growing a second kind of row.
- **Half at add-time only** — cheapest, and misses the article you decide to share three weeks
  later, which is most of them.

**Halves do not go in the ledger.** Whichever mechanism wins, the arithmetic stays integer by
counting in half-units — a private article costs 2, a public one costs 1, and a 20-article tier has
a budget of 40. Same rule, no floats anywhere near money, and no `0.5 + 0.5 !== 1`.

**The ethical question is real and is not the engineering's to settle.** Sharing already asks the
owner to tick a box confirming they have the right to. Attaching a quota reward to that tick-box pays
people to say yes, and stage 3 is simultaneously widening what sharing *means* from "reachable by
link" to "listed publicly". Both dials move the same way at once. Fable was asked for a straight
answer on whether that is a genuine problem; whatever it says goes in the log here, and if it is a
problem the answer is a product decision for Greg, not a mitigation an agent picks.

**Done looks like:** one authoritative place computes the cost of an article, every surface that
states a number agrees with it, and a test proves that sharing and unsharing move the count in both
directions. The trawl (see the log) is what says which surfaces those are.

#### What the mechanics turned out to be — and the two things that decide the design

The ledger was read before any of this was designed, and it does not support the obvious
implementation. Three findings, each checked in the code:

**1. There is no way to get from a charged ledger row to the article it produced.** `ingest_events`
has six columns and none identifies an article ([`schema.ts:4102`](../../src/db/schema.ts)). Its
`slug` is documented as *diagnostic only*, and it is worse than mutable — it is the pre-allocation
stem for a URL add and **null** for an upload, so for every article minted since 2026-08-31 it does
not even equal `articles.slug`. The only other path, `ingest_events → jobs.ingest_event_id →
jobs.slug → articles.slug`, fails at both hops: **jobs are hard-deleted** by the reader
(`DELETE /api/jobs/:id`) and by a retention sweep that runs after *every* job ending, and the second
hop is a name the schema explicitly refuses to treat as identity. So "is this article public right
now?" is not a question today's usage query can ask.

**The fix is one column**: `article_id uuid references articles(id) on delete set null` on
`ingest_events`, written by `settleReservation` at charge time. `ref.articleId` is already in scope
on the line above the settlement, already cross-checked against the locked article row, and costs one
extra bound parameter — no new read. **`ai_calls` is the exact precedent**, carrying `article_id` +
`article_slug` + a `job_id` held as *text rather than a foreign key* with the reasoning already
written down: *"a billing row must not be deletable by housekeeping."* Only the charging site needs
it; the other six settlement sites all release, and a released row needs no article.

**2. Existing rows cannot be backfilled, so the discount starts from the day it ships.** For a
charged row whose job has been swept there is nothing left to join on, and where the job survives the
match is on a slug — the identity claim the schema disclaims. So the query uses a `left join` with
`coalesce(visibility, 'private')`: **an unresolvable row is charged full price**, which fails in the
direction that cannot be gamed. The user-visible consequence is real and should be said out loud
rather than discovered: *an article you shared last week does not become cheaper; the discount
applies to what you add from now on.* Grandfathered articles are unaffected either way — they have no
ledger row at all, so they already cost nothing.

**3. `used` stops being monotonic, and on the free tier that reaches back across all time.** The free
allowance has no period clause — `usageSql`'s free arm is literally `sql\`true\`` — so unsharing does
not merely raise this month's usage, it raises the lifetime figure. This is the sharp edge of live
recomputation and it is why Fable's warning-at-unshare is a gate rather than a nicety: on a lifetime
allowance there is no next month to rescue anybody. The unshare confirmation must say what it will
cost before it happens.

And one arithmetic consequence to accept knowingly: cardinality is **N charged rows : 1 article**. A
re-added URL adopts the shelf's article and charges again, so sharing that article later halves
*both* rows. That is defensible — they did pay for two ingests — but it means "public costs half" is
a statement about ingests, not about articles, and the copy should not promise otherwise.

**The shape, then:** every ingest costs **2** half-units, a currently-public one costs **1**, a
tier's budget is `limit * 2`, and the wall compares half-units to half-units. `usageOf`'s
`Number.isInteger` assertion — which exists to stop a silent "used nothing" — keeps working
untouched, which is the argument for half-units rather than fractions, and not a stylistic
preference.

## What this deliberately does not do

- No annual billing, no currency switcher, no comparison table.
- No `/buy` route.
- No search indexing. `robots.txt` is `Disallow: /`, and Cluster D of
  [260902j](260902j-public-read-only-access-audit-and-improvements.md) — public articles still
  hot-link images to the publisher — is **not** fixed here. A page that gathers public articles
  together makes that pre-existing gap easier to notice; naming it is in scope, fixing it is not.
- No rate limit beyond what the namespace has. Cluster C and S4 of that plan are still open.

## Log

- **2026-09-04, stage 1 built.** `PlanCards` is the presentational component (`src/web/Plans.tsx`
  renamed to `src/web/PlanCards.tsx`, since the numbers moved into it as data); `/`, `/features` and
  `/pricing` render `WebsitePlans`, the copy plus its footnote, and `/profile` renders `PlanCards`
  directly with cards built from `summary.offers` — the two sources are deliberate, so `/profile`
  keeps the property that raising a quota is one `UPDATE` and no deploy. One `useBilling()` on
  `/pricing`, in the signed-in half. The sign-in panel is plain utilities rather than `site-panel`,
  because `/pricing` is not a `.site` page until stage 2. Three things worth knowing for the stages
  after this one:
  - **The naive buy-intent does not merely double-post, it loops.** Reading the marker where it is
    needed, rather than on mount, times the double-mount test out: `useBilling` returns a fresh
    object on every render, the effect watching it re-runs when a failed press clears `busy`, and a
    marker still in storage posts again. Consuming on mount is what makes it one request.
  - **`<StrictMode>` will eat the marker if the consuming effect assigns unconditionally.** The
    second pass reads `null` over the first pass's answer, on the same instance. Guarded, and the
    guard is the reason the test drives `<StrictMode>` rather than asserting about it.
  - **Stage 2 has an anchor collision to resolve.** `SiteNav`'s *Sign in* link is `#sign-in` on the
    landing page and `/#sign-in` everywhere else; `/pricing` now has its own `#sign-in` panel, so
    when the page joins the nav that link should stay on the page it is on rather than jumping to
    the landing page.
- **2026-09-04, the refusal copy moved with the link.** `ingestQuotaReached`'s free and lapsed
  sentences named *"the Upgrade button on your profile page"*, and `QuotaNotice` now draws a link
  beside them; prose and button have to name the same page. `/profile` still has the same
  buttons — it is simply no longer where we send everybody.
- **2026-09-04, stage 1 code-reviewed by GPT Sol and fixed before committing**
  ([the review](260904b-stage1-code-review-sol.md)). Six findings, three of them P1, two of them
  reproduced by the reviewer:
  - **The refusal link is now chosen per code, not uniformly.** `pay-free` → `/pricing`;
    `pay-limit` and `pay-lapsed` → `/profile`, because `canCheckout` is false for a working
    subscription at its ceiling *and* for the `unpaid`/`incomplete` half of `hasLapsed`, so
    `/pricing` drew those readers no button at all. The `pay-lapsed` sentence, which promised
    *"resubscribing from the pricing page"*, was false for that half and now names `/profile`.
    `quotaRefusalCode` returns a `QuotaCode` union so `QuotaNotice`'s `switch` cannot miss a
    fourth refusal. Table in [billing.md](../project/billing.md).
  - **A failed billing read no longer removes the buying path silently.** `/pricing` draws
    `/profile`'s own *"Couldn't read your plan — Try again"* where the plan line would be: with no
    summary there are no buttons either, so the page was prices and nothing to press.
  - **The drift guard compares whole rows keyed by tier id.** Sol swapped the `reader` and
    `researcher` ids — a real wrong-tier purchase, since the id is all a checkout carries — and
    every predicate stayed green, because they were independent substring searches over the file's
    source. It imports `WEBSITE_PLANS` now; the same swap was re-run and goes red on the name.
  - **The buy-intent TTL is re-checked immediately before the POST.** Sol held
    `/api/billing/usage` pending for eleven minutes and watched an expired marker open Stripe.
    `takeBuyIntent` returns the creation time with the tier, and the test drives the same
    reproduction.
  - **The sign-in panel promises the tab rather than the account**, since an emailed confirmation
    link usually opens a new one and both markers are `sessionStorage`.
  - **Two residual limits are written down rather than fixed** (buy-intent.ts): a remount between
    consumption and the summary landing loses a valid press, and two tabs are once-safe *each*.
    Exact-once needs an idempotency key on the checkout route, and the worst case is a refund.

- **2026-09-04, plan reviewed by GPT Sol and rewritten.** Three P1s: the consent change above; the
  auth-continuation mechanism, which did not work and used the URL as consent; and the slug
  reservation, which named a function that has nothing to do with routing. Greg chose to list every
  public article and change the sharing promise. The review is
  [here](260904b-pricing-page-and-public-showcase-review-sol.md); its 70 focused tests passed, with
  12 Postgres-dependent ones skipped for lack of a database in its sandbox.
- **2026-09-04, checked against the local database**: no article uses the slug `public`, `pricing` or
  `buy`, and there are **zero** public articles locally. The production check is still outstanding
  and gates stage 3b.
- **2026-09-04, browser check of the three pages before any change** — the before-screenshots and
  what they showed are in [§ Where this starts](#where-this-starts).
- **2026-09-04** — plan written. Greg answered three questions up front: he will flip the showcase
  articles himself in the production UI; agent-written pricing copy is approved; and the payment
  action should be linkable from anywhere, which is what made `/pricing`-as-the-buying-page the shape
  rather than a button bolted beside a link.
