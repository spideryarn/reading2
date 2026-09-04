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

- **The sharing copy changes.** `SHARING_ON`, the confirmation dialogue (`SHARING_CONFIRM_TITLE` and
  its body) and `SHARING_CANNOT_UNRING` say that a shared article may be listed publicly.

#### What the sharing copy has to sit against, settled 2026-09-04

The neighbouring worktree landed its half first and handed over the exact text, so this is written
down rather than remembered. Three constraints on the sentences this plan still owes:

- **`PrivacyPage.tsx` § "Who can see your shelf" already says *"The sharing card lists exactly what
  will go out before you turn it on."*** That is a promise about *our* dialog, made on their page. So
  the confirm body may keep enumeration to one clause — but the inventory underneath it has to
  actually be complete, or that sentence is false.
- **Do not promise conversations either way round.** Their paragraph says *"Your chat conversations
  are not shared"* deliberately: the old sentence was *"Your notes, your comments and your
  conversations are not shared"*, two thirds of it stopped being true, and naming the surviving third
  is what stops a reader guessing which. So our copy must not say notes stay private, and must not
  imply chat is shared.
- **One sentence on that page is left for us**, untouched on purpose: the section opens *"Your
  articles and notes are yours. Another reader signed into Spideryarn cannot see them."* A public
  index makes that need a caveat, and it is ours to add in the stage that builds the index — not
  before, because the page must not describe a listing that does not exist.

Also worth knowing when writing the inventory: `comments` is hand-written prose in `ALWAYS_SHARED`
because it has no mode; timeline and diagram appear automatically through the `MODES` sweep. Saved
searches are **not** in the inventory yet — that row arrives with the stage that builds them, because
a row promising them today would be false.

**And that is the argument for the confirm body enumerating nothing at all.** Saved searches *are*
going to be shared, one stage from now. Any sentence in the dialog that lists what goes out is a
sentence that becomes wrong the day that row lands, and nobody will think to re-read a confirmation
dialog when adding an artefact. The inventory is derived and cannot go stale; prose beside it can.
So the body points at the inventory and the inventory does the listing — which is also what makes
their page's *"lists exactly what will go out"* stay true without anybody maintaining it.

**Placement, from the same handover:** the caveat belongs *inside* their "anyone with the link can
read it without signing in" sentence rather than after it. Two sentences — reachable by link, then
also listed — read as a correction; one reads as a single fact.

**And `SHARING_ON` is not one sentence in one place**, which is the thing to check before editing it.
It is the sharing card's line, the shelf badge's hover text (`SHARING_BADGE`), and half of the
masthead's mark (`SHARING_MARK_PUBLIC` is built from it, deliberately, so the three cannot drift into
near-misses of one sentence — the dock and the band came apart exactly that way). So the new wording
has to work as a **card line, a badge tooltip and a link label at once**, which rules out anything
long.

The clause it loses is *"with the link"*, and losing it is the point: reaching the article is no
longer conditional on having been sent one. Draft, to be checked against the three surfaces rather
than admired in a plan — *"Anyone can read this without signing in, and it's listed publicly."*

### And then it stopped being a gate, for a reason about today rather than about the design

The first version of this section made two things load-bearing: that the copy ship *before* the
listing, and that somebody count the public rows in production that are not Greg's. Both existed to
protect owners who shared under a narrower promise.

Meanwhile a second worktree (`260904c-more-modes-on-a-shared-link`) was widening the same promise
from the other side: a visitor to a shared article would also get the owner's **comments, chat
transcripts and saved searches**. Its agent flagged the same retroactive-consent problem
independently, and the two changes together are different in kind from either alone — an article
shared in July under *"anyone with the link can read this"* would become listed *and* carry the
reader's own questions about it, with the owner pressing nothing.

Put to Greg as one decision, 2026-09-04:

> There are no users yet, only me. So no risk. Do what's simplest.

So: **both changes apply retroactively to every public article, with no grandfathering flag, no
old-versus-new consent distinction, and no notice.** The pre-deploy count is dropped with them.

**The reason is a fact about today, not a judgement that the exposure does not matter**, and that
distinction is the whole reason this section survives rather than being deleted. It rests on there
being one account holder. The moment there is a second, the question returns — so the dialog copy
still has to say plainly what a shared link now carries, which is cheap and worth doing properly for
an audience of one. Written down so that a later reader does not mistake *"we decided this was
fine"* for *"we decided this did not apply to anybody yet"*.

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

## Where this stands, 2026-09-04 evening

**Important work left.** Three of six stages are on `dev` and the tree is green; what remains
includes a promise the code has already broken.

| Stage | State |
|---|---|
| 1 — buying from `/pricing` | **on `dev`** (`275a6230`, `fd081a15`) |
| 2 — the pricing page rebuilt | **on `dev`** (`07412b79`) |
| 3a — the listing's data and API | **on `dev`** (`80573d0c`, `1ef8ba6b`) |
| 3b — `/read/public` itself | **built**, uncommitted — see the log |
| 4 — showcase links, takedown route, byline | not started |
| 4b — the upgrade path | **built**, uncommitted — see the log |
| 5 — a public article counts half | not started; needs a migration |

**The one thing that is worse than not-yet-built.** Stage 3a shipped the listing's API while
`src/messages.ts` was fenced by a neighbouring session, so `SHARING_ON` still tells an owner *"Anyone
with the link can read this"* when the code now makes public articles enumerable. Nothing is exposed
that Greg did not agree to expose — he is the only account holder — but **the app is saying something
untrue**, and `PrivacyPage` now promises *"The sharing card lists exactly what will go out before you
turn it on"* on top of it. This is the next thing to do, and it is small: the constants are agreed to
be ours, and the wording is drafted in §1 above.

**What each remaining stage costs, honestly.** 3b is the cheapest — the route parses, both sides
answer 404 deliberately, and it needs a page reusing the shelf's card with the owner verbs off.
Stage 5 is the expensive one and the only one touching money: a migration adding `article_id` to
`ingest_events`, a weighted `SUM` replacing a `COUNT`, and a warning at the unshare moment that is a
gate rather than a nicety, because the free tier's window is lifetime and there is no next month to
rescue anybody who unshares themselves over the wall.

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

### Stage 3c — the copy stage 3a owed, paid late

**This runs first, before 3b**, because it is the one item where the app is saying something that is
not true rather than merely missing a feature. `src/messages.ts` was fenced by a neighbouring session
when 3a landed, so the listing shipped and the promise did not change with it.

- `SHARING_ON` stops promising reachability-by-link only. Its two dependants
  (`SHARING_MARK_PUBLIC`, and the shelf badge's hover) inherit whatever it becomes, so length is a
  constraint and not a preference — check the masthead mark and the badge, not just the card.
- `sharingConfirmBody` gains the listing, and still enumerates nothing (§1): the inventory does the
  listing, prose beside it goes stale the day saved searches land.
- `PrivacyPage.tsx` § *Who can see your shelf* — the caveat goes **inside** the "anyone with the
  link" sentence, not after it, per the neighbouring worktree's handover.
- **Done:** no surface tells an owner that sharing is link-only, and the four constants still read as
  one voice rather than four near-misses.

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
- **Which articles to flip is a content decision with a technical constraint.** As of `8f752885` a
  visitor's Diagram shows the **Sketch**, and `sketch` is not in `DEFAULT_INGEST_STEPS` — so most
  articles have never had one drawn and their Diagram mode tells a stranger *"Nobody has drawn this
  one yet."* A showcase article whose headline mode is empty is a showcase that argues against us.
  The flag is on the wire as `PublicArtefacts.sketch`, so this can be checked rather than guessed.
  The listing card does **not** carry artefact flags and should not start: a card advertising what a
  piece has is a second projection to keep in step with the reader.

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

#### The banner, added 2026-09-04

Greg, after the mechanics above were worked out:

> Perhaps we could also add a banner for free users who have hit their 3-article quota, e.g. along
> the lines of *"If you are willing to make some of these articles Public-readable, then they only
> count as half-an-article towards your 3-article quota"* or something like that, but better-worded
> and more fully explained. Use your judgment about copy and placement, with input from Fable if
> needed, then consider it approved.

**It cannot ship before the rule it describes**, so it is part of this stage and not a separate one.
A banner offering a discount the code does not give is the same class of fault as stage 3c's.

**The shape is already in the tree, and it is not a banner.** `src/web/QuotaNotice.tsx` renders every
ingest refusal in four places from one component, and already chooses a different remedy per
refusal code with no `default` arm. So this is a second thing that component can say, not a new
surface — which also means it inherits the four placements for free rather than three of them
forgetting it.

**Fable answered on 2026-09-04, and the answer changed the shape of it. It is not a banner.**

`QuotaNotice` stays untouched. The offer is **one conditional sentence inside the server's own
refusal**, appended by `ingestQuotaReached` — which means all four placements inherit it rather than
three of them forgetting it, and there is still one link per refusal, which is that component's own
rule. A standalone banner component is cut.

- **`pay-free` and `pay-limit` get it. `pay-lapsed` does not**, and the reason is arithmetic rather
  than tone: the lifetime count includes the paid months, so a lapsed reader with forty charged rows
  is eighty half-units against a budget of six and cannot share their way under the wall. The offer
  would be false for almost everybody who saw it, and they already have a real remedy.
- **It is conditional on a number the server computed**, never unconditional. The same usage query
  can count the charged rows that resolve to a currently-private article, so the sentence appears
  only when sharing would actually make room — which is what stops it being shown to the reader who
  has already shared everything, and to the reader whose rows all predate the discount and cannot be
  cheapened at all. **Copy cannot rescue a false offer; conditionality has to.**
- **The number is computed, never written into the prose.** No surface says "6 public articles" as a
  literal.

**And two rules about where money may appear, which are the answer to the ethical question.** Fable's
verdict is that the worry is real, small, and fixable by placement rather than by delay:

- **Money never appears inside the sharing confirmation.** The rights tick-box is not a rights
  *check* — it moves responsibility onto the owner, and the platform's actual protection is that plus
  the takedown route. A discount printed beside it makes the inducement ours and weakens exactly
  that.
- **Unsharing is never harder than sharing.** This is the sharper half, and it inverts what the
  mechanics section assumed: the unshare warning is a *statement of consequence*, not a gate with a
  tick-box, because a cost attached to taking something down is a cost attached to acting on a
  complaint. It says the number, says that reading is never limited, and asks for no confirmation
  beyond the one already there.
- **Ordering, and it is the order already planned:** the widened meaning of public must be in
  `SHARING_ON` and the confirmation *before* the discount ships, never after. Stage 3c, then 5.

#### The one question in it that turned out not to need Greg — settled by reading the wall

Fable's first point was that *"6 public articles"* might be false: under a wall of
`used + cost <= budget`, a free account at five shared articles is refused its sixth, because the new
article is private at add time and costs 2. Two readings of the wall, two different promises, and it
looked like a product call.

It is not: the existing rule is `used + inFlight < limit`
([`pg-billing.ts` § `refusalFor`](../../src/store/pg-billing.ts)), and doubling both sides gives
`usedHalves + inFlightHalves < limit * 2`. So the half-unit version is the **unchanged** comparison,
not a new choice — and under it Greg's sentence is literally true: five shared is `5 < 6`, the sixth
add is admitted, and at six shared `6 < 6` is false. The reader can sit one article over the line
between adding and sharing, which is the same slack the rule has always had.

Written down because the arithmetic is not obvious from either sentence, and the next person to read
`refusalFor` will wonder whether the `<` was considered.

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

### Stage 4b — the upgrade path, which turned out to be mostly built

Added 2026-09-04 because stage 5's offer needs somewhere a paying subscriber can act on. Greg:

> it should go to $10/month subscribers when they're at their quota limit too. And also, it should
> provide a direct link to the /buy page as an alternative!

**The question I put to Greg was based on a stale doc, and the answer is cheaper than the question
implied.** [billing.md § A paying Reader cannot become a Researcher](../project/billing.md) describes
a closed loop — Portal `subscription_update` disabled, `startCheckout` sending subscribers there
anyway — and every step of it was fixed by
[260903i](260903i-fix-the-upgrade-path-and-the-cancellation-telling.md) on 2026-09-04. That plan's
log records `stripe:setup --prod --apply` moving the Portal fields and `stripe:check --prod` going
from five blocking problems to none. `scripts/stripe-setup.ts` § `SUBSCRIPTION_UPDATE` sets
`default_allowed_updates: ["price"]`, `billing_cycle_anchor: "unchanged"` and
`proration_behavior: "always_invoice"`; `ensurePortalConfiguration` now reconciles an existing
configuration rather than returning early. **So the Stripe half is open and no live configuration
needs touching.**

**The dead end moved into our own UI, and that is what this stage is.**
`canCheckout` ([`summary.ts`](../../src/billing/summary.ts)) is
`!(row?.stripeSubscriptionId && !isTerminalStatus(row.status))` — a boolean meaning *has no open
subscription*, not *has nowhere to go*. Every render site gates on it
([`BillingSection.tsx`](../../src/web/BillingSection.tsx),
[`PricingPage.tsx`](../../src/web/PricingPage.tsx)), so a Reader sees no button on either page while
the Portal behind them would take the switch.

- **What changes:** `canCheckout` becomes tier-aware, or gains a sibling that is — true when a
  *higher* tier exists to move to. The button for an existing subscriber opens the Portal rather than
  a Checkout Session, because `startCheckout` already forces that and is right to: Reader and
  Researcher are separate Stripe **Products**, so a scheduled change between their prices is not
  available and the Portal's `subscription_update` is the mechanism. A direct `subscriptions.update()`
  was considered by 260903i and not built.
- **Three docs argue from the fact that stopped being true**, and one is a comment written on
  2026-09-04 by this plan's own stage 2: billing.md's warning block, `PricingPage.tsx`'s *"the hosted
  Portal cannot switch tiers either"*, and `QuotaNotice.tsx`'s header, whose third reason for sending
  `pay-limit` to `/profile` is now false. All three are corrected in this stage. The routing itself
  is decided here rather than there.
- **The allowance side needs nothing.** `quota-adjustment.ts` already computes
  `floor(limit + (allowance(new) − allowance(old)) × fractionRemaining)`, keyed on
  `(subscriptionId, periodStart)`. Its `delta` is **a signed count of whole ingests** — read that
  twice before stage 5, which is where doubling it would grant ninety-one articles to somebody
  entitled to thirty-three.
- **What has never actually happened:** 260903i's own log says no real Reader → Researcher event has
  ever reached `nextQuotaAdjustment`. The upgrade was impossible until minutes before that plan
  ended, so the delta arithmetic is proven by unit tests and by nothing else. Worth knowing before
  we invite people down it.
- **`PlanCards` no longer rescues a jumbled list.** As of `e8d75ac6` it draws the plans in the order
  it is handed them and promotes nothing — `tw:order-first` was removed because below `lg` the grid
  collapses to one column and the raised card jumped the queue, so a phone read *$10 / No charge /
  $50*. Both callers pass cheapest-first today. **If `canCheckout` starts filtering offers per tier,
  whatever survives must stay in ascending price order**, because nothing downstream will fix it.
- **Done:** a signed-in Reader at `/pricing` is offered Researcher and reaches something that takes
  the money; the three stale arguments are gone; `stripe:check` still passes.

### What GPT Sol found in stage 5's design, 2026-09-04

Reviewed before anything was built, which is the point of reviewing a plan. **Three P1s, four P2s, no
P0s**, and the verdict on the mechanism was that live recomputation stands. The full answer is
`sol-stage5-answer.md` in the session scratchpad; what changes the design:

**P1 — the `quotaLimitDelta` unit trap, and it is the one that would have cost real money.** Sol ran
`tests/billing-quota-adjustment.test.ts` and confirmed the stored contract: Researcher `150` plus a
stored delta of `-117` means an allowance of `33`. If stage 5 doubles the tier *before*
`limitForPeriod`, that same row yields `300 - 117 = 183` half-units where the right answer is
`(150 - 117) * 2 = 66` — a budget of ninety-one articles instead of thirty-three. **So every tier,
delta, proration and clamp stays in article units, `limitForPeriod` is called unchanged, and
`budgetHalfUnits = articleLimit * 2` is derived only at the admission seam.** The two units get
different names so one cannot be passed where the other belongs. No stored delta is migrated.

**P1 — excluding `pay-lapsed` was wrong as a class.** Fable's reasoning was an example, not a rule:
a Reader who added three private articles and then lapsed is at six half-units against a free budget
of six, and sharing one of them makes room. So **all three refusal codes get the same conditional
treatment** and the exclusion list disappears — conditionality does the work, which is what it was
for. `pay-lapsed`'s existing sentence also stops claiming that resubscribing is the only remedy.

**P1 — "the unchanged wall" was my mistake, and it introduces a bounded overdraft.** `used < limit`
is equivalent to `used + 1 <= limit` only because every reservation costs exactly one today. Once a
reservation costs two, `5 < 6` admits an ingest that settles at seven. So it is **not** the same rule
doubled, and I said in chat that it was.

The decision is to **take the overdraft, knowingly**, because Greg's own sentence settles it: he said
a free account can make six public articles, and `U + 2 <= B` delivers five. What is being accepted is
one half-unit, once: a reader at five half-units may add a sixth article, and is then refused
everything until they are back under. It cannot repeat and it cannot compound — at seven they are
refused, and sharing the new article returns them to six, which is still refused. **Tests have to pin
both halves**: that the overdraft never exceeds one half-unit, and that no add-then-unshare cycle
gets a second one.

**P2 — the offer counts rows and speaks about articles.** A re-added URL owns several charged rows,
so "share three articles" can be false when three half-units are available from one article. Savings
are aggregated by `article_id` within the entitlement window, and the number of *articles* is derived
from those groups.

**P2 — visibility is written outside the billing lock.** `pg-visibility.ts` locks the article;
admission locks `billing_accounts`. An unshare committing between the usage read and the reservation
lets a reservation commit against stale usage. Sol confirms this does **not** let two ingests consume
one slot. The fix is a lock *order*, applied everywhere: **`billing_accounts` before `articles`**,
and `read committed` is then sufficient — serializable is not needed.

**P2 — no rounding rule makes the reader-facing counts correct.** `ceil(5/2)` says "3 of 3 used"
while the wall still admits one; `floor` says "2 of 3" while two and a half are gone. So **half-units
are never divided for display**: the marketed limit stays in articles, the enforcement budget is a
separately named field, and any surface that must show usage gets integer counts it can add up
itself. The surfaces that drift otherwise are `describePlan` (both `/profile` and `/pricing`),
`ingestQuotaReached`'s "all N articles", the lapsed `remaining = limit - used`, `/admin/users` —
which has its own aggregate and does not go through `usageSql` — and the plan cards' habit lines.

**P2 — my claim about the `ai_calls` precedent was half wrong.** `ai_calls.article_id` *is* a real FK
with `on delete set null`; the text-not-FK reasoning applies only to `job_id`, which is about
disposable jobs. So the FK is fine. The real consequence is different: deleting a public article
turns each of its ledger rows back into full price, so **deletion silently raises usage**. There is no
article-deletion path in the app today, so this is a policy to write down rather than a defect: if
one is ever built it takes the same billing lock and says the same thing the unshare warning says.

**And the guard worth more than any of them:** `settleReservation` takes a *discriminated successful
outcome carrying `articleId`*, and writes `succeeded_at` and `article_id` in the same update. An
optional argument would let a future caller omit the link and charge a public article full price for
ever, silently. Legacy rows rule out a `NOT NULL` constraint, so the type is the only guard available.

## What this deliberately does not do

- No annual billing, no currency switcher, no comparison table.
- No `/buy` route.
- No search indexing. `robots.txt` is `Disallow: /`, and Cluster D of
  [260902j](260902j-public-read-only-access-audit-and-improvements.md) — public articles still
  hot-link images to the publisher — is **not** fixed here. A page that gathers public articles
  together makes that pre-existing gap easier to notice; naming it is in scope, fixing it is not.
- No rate limit beyond what the namespace has. Cluster C and S4 of that plan are still open.

## Log

- **2026-09-04, stage 4b built** — the gate is tier-aware, and a paying Reader is offered
  Researcher on both pages. Seven things worth knowing:
  - **`canCheckout` did not change meaning and did not gain a sibling; it and `offers` were
    replaced by one field.** The question was put as a binary and the third answer is better than
    either: `summary.purchase` is a discriminated union — `checkout` | `switch` over a **non-empty**
    tuple of tiers, `top`, `none` — so the list a page draws and the fact that it may draw one are
    the same fact. The state the live account was actually in, `canCheckout: false` beside an
    `offers` array of both tiers, is now unbuildable; and deleting both names is what made the
    compiler walk every call site, which a rename would not have.
  - **Higher is `ingests_per_period`.** Not `sort_order`, which `choiceRules` already says out loud
    is a display column nothing constrains to ascend with what a tier sells; not price, because a
    tier carries three currencies and nothing makes them agree about which of two is dearer. The
    allowance is what `nextQuotaAdjustment` measures a plan change by and what
    `tests/billing-tiers.test.ts` pins as ascending with price. **A tie is not higher** — an equal
    allowance is a button that takes money and changes nothing — and the reader's own tier is
    excluded by name as well, which is redundant against a strict `>` and cheap.
  - **The trap in it is `Entitlement.limit`, and the type is the guard.** That number carries the
    prorated override a mid-period switch leaves behind, so a Researcher who moved up on day 27 is
    entitled to 33 against a tier that sells 150 — rank *that* and they are offered Researcher.
    `Standing` therefore takes a `TierRow` rather than a number, and a `@ts-expect-error` in the
    tests goes red at `npm run typecheck` if the parameter is ever widened.
  - **The button says what the press does.** *Switch to Researcher* on `/pricing`, *Switch plan*
    (with an accessible name carrying the tier) on `/profile`, over one shared sentence,
    `SWITCHING_PLAN`: the press opens the hosted Portal, the plan is chosen and confirmed there,
    Stripe invoices the difference at once, the renewal date does not move, and the allowance is
    added *for the part of the month that is left*. Every clause is a field `stripe:check` verifies
    on every run, and the last one exists because `nextQuotaAdjustment` prorates — *"the larger
    allowance starts now"* would have been false.
  - **A Researcher gets a sentence rather than a gap** (`noHigherPlan`), which is why `top` is its
    own arm and not `none`: a page that draws no button should say why, and *"nothing on sale"* and
    *"you are already at the top"* are different answers.
  - **`stripe:check` would catch the Portal being shut again, and no check was added.** Verified by
    reading rather than by running: `checkPortal` calls `portalDrift` → `planSwitchDrift`, which
    fails blocking on `subscription_update.enabled === false`, on `default_allowed_updates` not
    being exactly `[price]`, and on the anchor, proration, trial behaviour and product list. The
    one path where `enabled: false` is *not* reported is a catalogue that is not `complete()` — and
    that run still exits non-zero, because `checkPortal` emits a blocking `✗` per unpriced tier
    first. The live-day failure (a complete catalogue, switching off, a clean run) cannot recur.
  - **Red first, each one, by mutating the mechanism and putting the text back.** The filter
    removed → the pure cases and the route's Reader/Researcher cases went red (`['reader',
    'researcher']` where `['researcher']` was wanted, `switch` where `top` was); the door forced to
    `checkout` → the switch case red; the `top` sentence removed from `/pricing` → the Researcher
    case red; both verbs forced back to *Get*/*Upgrade* → both label cases red; `PlanCards` handed a
    reversed list → the ordering case red. The client tests do **not** go red for the filter, and
    that is honest rather than a gap: they feed a summary straight in, so the filter is the route
    suite's and the pure suite's to hold.
  - **Left alone deliberately:** `startCheckout`'s Portal branch, every `QuotaNotice` destination,
    and `ingestQuotaReached`'s `pay-limit` sentence — which could now name the larger plan, and is
    Greg's to decide with stage 5's offer.

- **2026-09-04, stage 3b built** — the page, and both 404s flipped. Six things worth knowing:
  - **The card is its own component, and the rejected option is written at the top of the file it
    was rejected for.** `ShelfCard` takes the whole `useShelf` hook — rename, archive, undo,
    `apiFetch` — so making its owner verbs optional capabilities would have meant a union entry type
    and six optional branches in one component, of which a stranger exercises one arm and the owner
    the other. It would also have put an owner-scoped hook in the import graph of a page mounted for
    people with no account. `PublicCard` is forty lines. What is genuinely shared is shared for
    real: `readHref`, so the two shelves cannot disagree about where an article lives.
  - **`SiteNav` yes, `SiteFooter` no**, and the second half looks like an inconsistency and is
    Greg's own rule. `PublicChrome` was the other candidate for the chrome and does not fit at
    all — it is *article* chrome, a chip in the reading view's controls bar and a notice under a
    masthead, and there is no document here. The footer is out because *"NOT on any `/read/*`
    pages"* is about the path, which is the reading `SiteFooter.tsx` already records having been
    talked out of once and called rationalising for it.
  - **The bar's *Sign in* was choosing its destination by naming the pages that lack a panel**, so
    a fourth page joining it would have drawn a bare `#sign-in` naming nothing. It names the two
    that *have* one now (`/` and `/pricing`), and `tests/site-nav-sign-in.test.tsx` grew the
    `/read/public` case — watched failing on exactly that, then green.
  - **The page-level test is an inventory rather than an absence, and that is the whole design of
    it.** `tests/owner-isolation.test.ts` already proves the query cannot return a private article,
    seven mutations deep; repeating that against the DOM would be a test that went green the day
    somebody swapped the loader for `useShelf`, provided the fixture happened to hold nothing
    private. So `tests/public-shelf-page.test.tsx` records the page's whole conversation with the
    server — one request, `/api/public/library`, `credentials: "omit"`, no header, no call into the
    auth module, and the same request signed in as signed out — because **a page can leak a private
    article in exactly one way, by asking for one.**
  - **A retry driven by a counter is a dependency the effect never reads**, and biome offers an
    unsafe autofix that removes it — leaving a retry button that silently stops retrying. It is one
    stable function called by both the mount effect and the button instead, with the two limits that
    buys (a response after unmount; two presses racing) written down rather than engineered away.
  - **The lede claimed something the `where` clause does not guarantee — twice, and the second one
    is the interesting half.** Caught first by re-reading the copy against the query rather than
    against the intent: it ended *"an article that is not listed here is one nobody has shared"*,
    false three ways, because a shared article that is archived, or whose current revision has no
    readable blocks, or that falls past the row cap, is shared and absent. The fix opened *"Every
    article somebody using Spideryarn has made public"* — **the identical claim read from the other
    end**, because the fix had been aimed at the sentence rather than at the claim, and the review
    below caught it standing. It now opens with a bare plural, which quantifies nothing. The rule
    that came out of it, written at the section head in `src/messages.ts`: **say what the page
    holds, never how much of the world it holds.**
  - **Browser-checked signed out at 1440 and 390**, one viewport at a time, against the five public
    articles seeded locally by `scripts/share-local-articles.ts`: five cards, every one opening its
    article readable and signed out, no horizontal scroll at 390, zero console errors, and the only
    request in a 305-line network log touching our API was `/api/public/library`.
  - Docs: `docs/project/public-shelf.md` is new and owned by `reading-view-overview.md`;
    `library.md` § The Shared badge reconciles *a badge, not a filter* against a page that filters
    (they are two shelves, and the owner's did not change); `security-map.md` gains the page as a
    public surface, with the argument for the inventory-shaped guard.

- **2026-09-04, GPT Sol reviewed stage 3b's code.** **No P0, one P1, three P2s, and its verdict on
  the question that matters was that it found no path exposing a private article or owner-scoped
  data to a stranger.** Three of the four are fixed; the P1 is written down rather than built, and
  the reason is that the thing it asks for does not exist yet.
  - **P2, and a real bug: the page could show two states at once.** `shelf` and `failed` were
    independent flags, each set by one branch of one promise and neither clearing the other — so
    two overlapping reads, one failing and one succeeding, drew the error paragraph above the list
    of cards. **And that is the production configuration rather than an edge case**: `main.tsx`
    mounts inside `<StrictMode>`, so in development every effect runs mount → cleanup → mount and
    this page issues two requests before either answers. Now one discriminated
    `loading | loaded | failed`, which makes the combination unrepresentable, plus a generation ref
    so a superseded read cannot land last. **Watched failing in both orderings** before the fix —
    the test drives `<StrictMode>` and asserts exactly one of the three states is on screen, rather
    than which one wins, because which read lands last is not something this page promises.
  - **P2, the copy** — see the bullet above; the second completeness claim was Sol's find.
  - **P2, an asynchronous failure announced to nobody.** The failure paragraph now carries
    `role="alert"`, because it arrives a second or two after the page has been read out and nothing
    else would say it. The half not fixed is written at the element: pressing Retry unmounts the
    paragraph, so focus falls to the body, and refocusing automatically would yank focus on the
    *first* failure out of wherever the reader actually was — worse than the thing it fixes.
  - **P1, and it is a gap in the guard rather than a defect in the page.** The request inventory
    mounts `PublicLibraryPage`, and production mounts `App`, which initialises a session and starts
    the job service before it reaches this branch — so the test would stay green if an `App` arm
    later wrapped this page in something owner-scoped. Sol's remedy was to extend "the existing
    full-`App` network-trace harness", and **there is no such harness**: nothing in `tests/`
    renders `<App />` at all, so this is a new suite with a session, a router and a job service to
    stand up rather than an assertion to add. Not built here. It is a real next guard and belongs
    with whatever first needs `<App />` mounted; until then the claim in the test and in
    `security-map.md` is scoped to *the page's* conversation, which is what it says.

- **2026-09-04, GPT Sol reviewed stage 3a's code and all four findings are fixed.** The review is
  [260904b-stage3a-code-review-sol.md](260904b-stage3a-code-review-sol.md); it found **no
  private-article disclosure path**, so every one of these is hardening. What is worth carrying
  forward:
  - **The guard did not cover the whole path a stranger runs, which is the one that mattered.** Its
    import graph roots at `src/public/routes.ts` and `src/public/page.ts` — but a request executes
    `serveApi`'s pre-auth dispatch or `serve` in src/vercel.ts *first*, so a query added there would
    be publicly reachable and invisible. Sol offered extraction-into-a-module or assertions over the
    transports; **the extraction is worse and the reasoning is written at the test**: the two
    transports' anonymous regions are different code and not shareable, moving vercel's would either
    put transport concerns inside `src/public/` or pull `src/owner.ts` into the closed graph
    `tests/public-imports.test.ts` keeps it out of, and it would leave a residue needing the same
    assertion anyway. So: the region is cut out of each transport by parsing, and it is the whole
    dispatcher **minus the hand-off call** rather than the prefix above the gate — the `catch` and
    `finally` run for a stranger too. What makes it not a second stale list of roots is that the
    transports are *derived*: `publicEntryImporters()` asks the repo who imports a public entry, and
    the guard asserts the answer.
  - **Two more defects in the same guard, both real.** It recognised only `.from(articles)` — an
    alias, a relational query or raw SQL walked past — so it parses now
    ([tests/helpers/article-queries.ts](../../tests/helpers/article-queries.ts)), following
    `tests/fixture-ids.test.ts`'s conclusion the same week: *parse them all*. And its SQL assertion
    proved only that `visibility` and `"public"` appeared *somewhere*; it now cuts the `where` out of
    the statement, reads the `$n` the comparison binds, and looks that slot up in the parameters.
  - **A row cap is not a byte cap.** Nothing bounds a title or an `<h1>` and a fetched document may
    be 32 MB, so one enormous public heading made an anonymous request allocate and serialise it.
    Every text column is now `left()`-capped **in the SQL** — truncating in JS is after the bytes
    have crossed — and a fixture with 5,000-character title, gist, site name and `<h1>` measures it.
    The seven-column guard had to learn to split on commas at paren depth zero, which its own
    comment had predicted would be needed the first time an expression held one.
  - **`limit` bounded rows and not work**, so `articles_public_listing` is a partial index on
    `(public_at desc nulls last, slug) where visibility = 'public'` —
    `drizzle/20260904175802_articles_public_listing.sql`, generated from the schema and applied
    locally (`Target: postgresql://postgres@127.0.0.1:54362/postgres`). `explain` shows the planner
    reaching for it.
  - **Two claims had no test and one comment was stronger than its code.** The 200/201 boundary is
    now a case that fills the shelf to exactly the cap and then adds one — exact because this file
    runs in the private lane and owns its database. And the listing's `<h1>` fallback is compared
    against `loadHead` on a fixture with an `<h2>` before the `<h1>` and a second `<h1>` after it,
    so losing `level = 1` or losing `order by ordinal` makes the two disagree; the docstring that
    claimed they were checked together is now true.
  - **And the full suite found a fifth thing, which Sol's review did not.**
    `tests/store-guarded.test.ts` asks the question from the other end — *every*
    `export const pgX` under `src/store/` is `guardDbStore`-wrapped or declared as an exception —
    and `pgPublicLibraryReader` was neither. It is now an exception with the reason
    `pgPublicReader` gives beside it: the closed room keeps its own `scrubbed` because
    `guardDbStore` drags `src/chat.ts` into an import graph
    tests/public-imports.test.ts exists to keep small. Worth noticing that the guard written
    *for this shape of miss* is what caught it, an adapter it had never heard of.
  - **Red first, every one.** Watched failing on 2026-09-04: an aliased `.from()` planted in
    `src/public/routes.ts`; an ownerless `select … from articles` planted in `serveApi`'s
    public-namespace branch, and again in `serve`'s `catch`; a `pg-admin` import used pre-auth; a
    third module importing a public entry; the visibility clause moved from the `where` into the
    projection; `left()` dropped from `root_gist` and from `title`; `level = 1` changed to `2`;
    `>` changed to `>=`; and `PUBLIC_LIBRARY_LIMIT + 1` changed to `PUBLIC_LIBRARY_LIMIT`. Each was
    reverted by editing the text back.

- **2026-09-04, stage 3a built** — the data and the API, without the sharing copy (`src/messages.ts`
  was being held by another session, so §1's copy change is still outstanding and is the one part of
  the stage that did not land). Eight things worth knowing:
  - **The listing is `GET /api/public/library`**, a `publicCollection` entry in the inventory, and
    `PublicRouteName` is now a discriminated union — `{kind:"slug"; path(slug)}` |
    `{kind:"collection"; path()}`. `pathOf(route, slug)` lives in the leaf so all three sweeps and
    the client's path test ask the question the same way rather than each writing its own ternary.
    `servePublicApi` switches on `kind` with a `never` arm, and `requirePostgres()` stays *inside*
    each arm: hoisting it above the switch would make a malformed slug a 501 on a filesystem
    machine and a 400 elsewhere.
  - **`RESERVED` in src/slug.ts really was the wrong gate**, as §3 says — and so, it turned out, was
    `isSlug`. That function is asked at every *read*, so refusing `public` there would refuse it on
    the way out too and a row that somehow held the name could never be repaired. The reservation is
    a second function, `isReservedSlug`, enforced at `lockOrCreateArticle` — the one line in the
    repo that brings an article address into existence, and the one a client can reach directly
    through `POST /api/jobs`'s adopted branch. **After the lock attempt, before the insert**, so an
    article that already holds the name goes on working; what is refused is *taking* it.
  - **The `/read/public` branch is in both routers and they are tested together.**
    `tests/reserved-article-address.test.ts` reads `parseRoute`, `decidePublicPage` and
    `lockOrCreateArticle` against one constant in one run, because the failure this guards is
    *disagreement* and three assertions in three suites each pass while the trio drifts. Both
    answer 404 today — there is no page yet — and stage 3b flips both to 200 in two lines.
  - **The guard's new ownerless-enumeration section was watched failing seven ways** before it was
    believed: the visibility clause deleted; an owner clause added; an owner column added to the
    projection; a non-owner column added to the projection; the `limit` and the tiebreak removed;
    the readability bar removed; the query moved out of its own function; and a second
    `.from(articles)` added to `src/public/routes.ts`. The behavioural half went red three more
    ways — no visibility clause, an owner filter that excluded the second account, and no
    readability bar.
  - **Two owners, and the second one is the whole point.** With one owner a listing that had
    acquired `eq(articles.ownerId, currentOwnerId())` would still pass every case, because the only
    rows in the fixture would be that owner's. `seedAuthUser` makes a real `auth.users` row, and
    `articles.owner_id` references that table.
  - **The import-graph walker moved to `tests/helpers/import-graph.ts`**, unchanged, because the new
    guard needs the same walk `tests/public-imports.test.ts` makes. Two copies would be two sets of
    rules about what counts as an import — the drift both guards exist to catch, one level up.
  - **The fixture ids collided with three other files and are minted per run now.**
    `tests/fixture-ids.test.ts` caught it; its header says why the remedy is `randomUUID()` rather
    than picking unused constants (a fixed id also collides with itself when one file runs in two
    processes, which no static guard can see), and why every *unique* column has to be minted, not
    only the primary key — so the slugs carry the run's suffix and `short_id` is minted too.
  - **The new suite needed two manifest entries, not one.** `TEST_LANES` for the private Postgres
    lane, and a `STORE_MIGRATION` entry because the stored witness predates the file — measured with
    `store-migration-witness.ts --files` (*ran, touched nothing*), recorded as `static-only` because
    `--files` writes no JSON.

- **2026-09-04, what the neighbouring worktree settled, and what it costs this plan.**
  `260904c-more-modes-on-a-shared-link` is widening a shared link from the other side, and two of its
  findings land on this plan rather than only on its own.
  - **Chat is not shareable, and the reason is not a missing allowlist entry.** A stored chat answer
    can quote the owner's *other private articles*, because `search_library` and
    `read_library_passage` range over the whole shelf — so the disclosure sits in the prose of
    `chat_messages.text`, the one column the feature cannot exist without. Stripping every
    surrounding field leaves *"In your other piece on X, the author argues…"* untouched. Written up
    in [chat-tools.md](../project/chat-tools.md); the consequence here is that **the sharing copy
    must not promise conversations**.
  - **`PrivacyPage.tsx`'s "Who can see your shelf" paragraph is wanted by both plans**, and is being
    edited sequentially rather than split: that worktree takes the whole paragraph first, adding
    nothing about listing, and the listing clause is added here afterwards — because the page must
    not claim a public index before there is one. Two sessions editing one paragraph is a merge
    conflict inside a sentence.
  - Its stage order is timeline, diagram, comments, saved searches — chat dropped.
- **2026-09-04, a subagent deleted three untracked files it did not create** — `.tmp-smoke.mts`,
  `privacy-1280.png`, `privacy-390.png` — while tidying its own scratch files out of the worktree
  root. Copies survive in the shared primary checkout, dated 2026-09-02 and 09-03, so nothing is
  known to be lost; they were **not** copied back, because a file that cannot be confirmed identical
  is worse in a shared tree than a gap. The cause is a brief that said *keep your files out of the
  repo root* without saying *delete nothing you did not write*, and every brief since says the
  second thing. [version-control.md](../project/version-control.md) already forbids the git commands
  that throw work away; `rm` is the hole in that rule.
- **2026-09-04, stage 2 built.** `/pricing` joined the marketing pages (`.site`, `SiteNav`, hero,
  `SiteFooter variant="marketing"`), the table became variant B's cards, and the four *How it works*
  paragraphs are folded into a seven-question FAQ. Six things worth knowing:
  - **The design was spiked before it was argued about.** Three variants on a throwaway page,
    looked at side by side and at a real 390px viewport in an iframe; B won and the spike was
    deleted. Cheaper than a discussion, and the file is gone, which is what a spike is for.
  - **`site-panel` needed to leave `.site`, and the fix is one selector.** `/profile` draws the
    same cards from the billing rows and is not a marketing page, so the `--site-*` properties are
    now declared on `.plan-cards` as well. The failure this avoids is silent: transparent border,
    no fill, no error.
  - **The drift guard's records changed shape and the binding was re-checked.** `allowance` carries
    the noun now (`20 articles a month` — `20 a month` said nothing on a card with no columns) and
    the price is a headline plus a fainter line of the other currencies, so the guard reads both.
    Sol's swapped-id mutation was re-run: it still goes red, on the name.
  - **`/profile` declines the headline currency, and that one is not cosmetic.** It cannot know
    which of three Checkout will pick, so it puts all of them in `price` and the card sizes the
    figure smaller because `alt` is unset. Three currencies at 2.1rem in a 230px column is an
    overflow.

    **It declined `recommended` too, and that was wrong** — corrected after the stage 2 review
    below. The reasoning written here on the day was *its reader has already chosen*, which is
    backwards for the state those cards actually render in: the whole block is behind
    `canCheckout`, so anybody looking at it is free or lapsed and is choosing between the two paid
    tiers right now. The recommendation is now attached to **whether somebody is choosing**, not to
    which page they are on.
  - **Three FAQ answers were checked against the admission path, not against a doc.** A failed
    fetch costs nothing; pasting the same URL again costs a second article even though every step
    then skips; a re-run against a slug you already own is free. And the *what happens at my limit*
    answer offers a subscriber no upgrade, because there is not one — `canCheckout` is false while
    a subscription is live and the Portal cannot switch tiers.
  - **The screenshots, and what they measured.** Signed out, one viewport at a time, headless
    system Chrome: `/pricing` at 1440 in three screens and at 390 in five, plus the plans block on
    `/` and `/features` at both widths. The captures were session scratch and were not kept; what
    they settled is written down instead, because a picture in a directory nobody will open is not
    evidence:
    - The `h1` content column starts at **x=168** on all three pages. It was x=360 on `/pricing`,
      which is the defect this stage was for, and the number is the whole of what "joins the
      family" means.
    - The raised card reads at a glance: `rgba(255,255,255,0.05)` on `rgba(255,255,255,0.16)`
      against `0.027`/`0.1` for its neighbours.
    - **No horizontal scroll at 390**, and zero console errors on any of the eight screens.
    - **A trap worth the ten minutes it cost**, now in
      [marketing-pages.md](../project/marketing-pages.md#screenshotting-the-pages-themselves-for-review):
      `locator.screenshot()` clips to the bounding box, and the raised card is lifted out of its own
      by a negative margin — so an element shot of it arrives with RECOMMENDED sliced off and looks
      like a broken design.
- **2026-09-04, stage 2 code-reviewed by GPT Sol and fixed before committing**
  ([the review](260904b-stage2-code-review-sol.md)). One P1, four P2s, two documentation gaps:
  - **The top bar's *Sign in* now knows who is reading it.** `SiteNav` chose its destination from
    `here` alone, but `/features` and `/pricing` are mounted signed in too — where `#sign-in` names
    nothing on `/pricing` (the anchor is inside `PlansForAStranger`) and `/#sign-in` lands on the
    shelf. Two dead links, of which the `/features` one predates this stage. `signedIn` is a
    required prop with no default, so a new caller has to answer the question;
    `tests/site-nav-sign-in.test.tsx` mounts both pages both ways and was red on both signed-in
    cases first.
  - **Four sentences said more than the code guarantees.** *"You are charged in your own currency"*
    → the three currencies a tier actually carries; *"until your allowance starts again"* → a plan
    that is *ending* falls back to the lifetime free allowance, which counts the articles added
    while subscribed (`usageSql`, src/store/pg-billing.ts), so there is no fresh allowance for
    somebody already past three; *"You pay for the articles you add"* → a fixed monthly price with
    a capped allowance, since nothing here is metered; *"a paywall … costs you nothing"* → *a
    paywall that leaves no readable article*, because what the code refuses is an extraction that
    produced no blocks, and a soft paywall that yields prose ends `done` and is charged. The same
    currency overstatement was on `/profile` and is fixed in the same breath.
  - **The recommendation follows the choice, not the route.** `WebsitePlans` took `recommend`, a
    boolean each caller answers: `/` always (only strangers reach it), `/features` when signed out,
    `/pricing` for a stranger, and for a signed-in reader only when `canCheckout` *and* the tier is
    in `offers` — so a Researcher no longer sees the downgrade they cannot buy labelled
    Recommended. `/profile` now recommends, for the reason in the corrected bullet above.
    `WEBSITE_PLANS` is `as const satisfies`, so `RECOMMENDED_TIER` is checked against the ids that
    exist; a runtime throw would have been wrong, because a tier legitimately absent from one
    reader's offers is the normal case.
  - **`/pricing` has an `h2` again**, `sr-only`, because the plan titles are `h3` and the page went
    `h1` → `h3`. The other three callers each supply one of their own.
  - **`/profile`'s three Upgrade buttons have three names.** `PlanCardAction.ariaLabel` carries
    *Upgrade to Reader* / *Upgrade to Researcher*; the visible word stays short because the long
    form wraps in a 210px card, and it is contained in the accessible name, which is what WCAG's
    Label in Name asks.
  - **The `.plan-cards` token change stays** — Sol checked the leak and found none — but three
    comments describing a two-page world were false and are not any more: styles.css § the site,
    `SiteFooter.tsx`'s page count, and marketing-pages.md.
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
