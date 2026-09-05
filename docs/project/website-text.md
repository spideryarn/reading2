# Website text

The words on the pages that are **about Spideryarn** rather than about an article: the landing page,
the features page, the privacy policy, the footer row that joins them, and the one address a reader
writes to. Part of
[reading-view-overview.md](reading-view-overview.md).

Its sibling is [copy.md](copy.md), and the split between them is worth stating once: **copy.md is
what a reader is told when something goes wrong**, in the middle of doing something. This is what a
reader is told when they come looking — a stranger deciding whether to sign in, or somebody who
wants to know what we do with their data. Different reader, different register, different rules.

## The contact address

> The contact address to use anywhere in the site is `hello@spideryarn.com`.
>
> — Greg, 2026-09-02

**One address, spelled in one place**: `CONTACT_EMAIL` in [`src/site-text.ts`](../../src/site-text.ts).
Support, privacy requests, "delete my account" and anything else all land in the same inbox, because
the person reading them is the same person and a `privacy@` alias would imply a department that does
not exist.

Anything that needs it imports it. That includes the browser —
`site-text.js` is on the shared-import allowlist in `tests/client-imports.test.ts`, which it
qualifies for by importing nothing at all. The alternative is a second copy of the address that
survives a domain move, which is exactly the trap
[CLAUDE.md § One source of truth](../../CLAUDE.md) describes.

## The footer

> Add a link in the footer to the Privacy and Features pages on all non-logged-in-pages, and also
> for some of the logged-in pages where it makes sense to do so (e.g. on `/`, but NOT on any
> `/read/*` pages). We'll probably also add a Terms of Service etc later.
>
> — Greg, 2026-09-03

One component, [`SiteFooter.tsx`](../../src/web/SiteFooter.tsx), and its header carries the rest:
the list of links, which pages mount it, and why `/read/*` cannot have one. **A Terms page is one
entry in its `LINKS` array**, which is the whole reason it is a component — it had been written by
hand on the landing and features pages, and those two copies already disagreed about which links
they carried.

**It nearly became two components on the day it became one.** The marketing redesign
([marketing-pages.md](marketing-pages.md)) extracted its own `SiteFooter` into `SiteBits.tsx` in
another worktree the same afternoon, and the two met at a merge. Greg's call, 2026-09-03, was one
component: the general one absorbed the other, and `variant="marketing"` is what carries the
redesign's taller spacing on `/` and `/features`. The provenance sentence stayed with those two
pages as child text, because it is a promise about *them* rather than a fact about the site.

The link for the page you are already on drops itself, decided from `useRoute()` — except on the
two pages `App.tsx` uses as fallbacks, which have to say which page they are, and which is a trap
worth reading the header for. `tests/site-footer.test.tsx` pins the dropping, the contact address,
**and the inventory**: which files mount it, how many times each, and which two declare themselves.
The inventory is there because every other test in the file is satisfied by a component nothing
renders.

## The contact page

[`ContactPage.tsx`](../../src/web/ContactPage.tsx) at `/contact`, since 2026-09-05, because Greg
asked for one:

> Add a /contact page and link to it appropriately. For now it can be really brief. Mostly just
> saying Spideryarn is in beta, but we'd really love your feedback or suggestions. The best way to do
> it is with the Feedback button in the top right. You can also contact us at hello@spideryarn.com.
>
> — Greg, 2026-09-05

Three sentences, in that order, and the order is the content: **the Feedback button is the answer and
the address is the fallback**. That is not only manners — a report filed through the button always
arrives with the address the reader was standing on and, on an article, its slug; tick the box and it
also carries which passages were on screen, the requests the page made and the id Vercel logged them
under ([feedback.md](feedback.md)). An email carries none of that.

**The sentence about the button is hedged, and the hedges were bought at review.** It says *"if you
are signed in"*, because `FeedbackButton` is in the signed-in chrome and this page renders bare to a
stranger; and it says the report *carries that page's address* rather than *"so we can see what you
saw"*, because pressing Feedback here sends `/contact`, and no screenshot goes unless the reader
attaches one. GPT Sol established both as a P1 against the first draft — the page that tells people
how to reach us is the worst place in the app to overclaim.

**Shaped like `/privacy`, not like the marketing pages.** The three marketing pages carry `SiteNav`,
a hero and the `--site-*` token scope, which exist to sell something over a long scroll; this is four
sentences, so it takes the policy page's Back link, `h1` and `SiteFooter`.

**Linked from one place**: `LINKS` in [`SiteFooter.tsx`](../../src/web/SiteFooter.tsx), which is
what that array is for. That puts it on all eight pages that carry the row and nowhere under
`/read/`. **The row's `mailto:` stayed** — mildly redundant beside a Contact link, and the redundancy
is the cheaper mistake, since the address is the one thing in the row a stuck reader can act on in
one press. The plan
([260905c](../plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md)) names that as a
judgment call Greg can overrule in one line, along with the decision not to add it to `SiteNav`,
whose top bar was measured tight at the 320px reflow width.

## The privacy policy

It has a doc of its own: **[privacy.md](privacy.md)** — the four decisions Greg
made, what a cross-family review changed, what is still open, and what is pinned
by a test rather than by somebody remembering. The page is
[`/privacy`](../../src/web/PrivacyPage.tsx).

Here because it is site text as well: it renders **signed out**, and the footer
row above links to it from every page that has one. That is the point of it
rather than a detail — the person who most wants to know what we do with an
article is the one deciding whether to hand us one.

## The landing page

[`LandingPage.tsx`](../../src/web/LandingPage.tsx) — the pitch, four screenshots, the **Beta** badge,
and the sign-in controls on the page rather than behind a link. Its own header
carries the decisions; the one worth repeating here is that **a claim on it is checked against the
code, never against a doc about the code** — it said "six diagrams" for a day, having been written
from a doc, when there were four.

**Redesigned 2026-09-03**, at Greg's asking and in the posture he chose — the hero, the pictures and
the visual language are [marketing-pages.md](marketing-pages.md)'s subject, and the plan is
[260903g](../plans/260903g-redesign-the-signed-out-marketing-pages.md). Two things about it belong
here because they are about the *text*: the sign-in panel moved to the foot of the page, with a
`Sign in` link in the top bar jumping to it, so the 2026-08-27 rule that the buttons are on the page
survives; and the copy was **reordered and cut, never rewritten** — the dog-eared-book sentence came
up to sit under the hero, "And deliberately not" came out from between the principles and the
prices, and two sentences that appeared twice each now appear once.

**Rewritten 2026-09-03 in Greg's words.** The words come from an interview
([260902k-spideryarn-reading-interview-guide.md](../research/260902k-spideryarn-reading-interview-guide.md))
and from his dated quotes in the feature docs, and every sentence in the file carries a comment
saying which — or `[tissue]`, for the few connecting lines an agent wrote. The rule and the reason
are in [positioning.md § Whose words](positioning.md#whose-words).

**Beta copy, and the strip is gone.** The copy reads as if the product is in beta and paid, which
is what Greg asked for on 2026-09-02 (*"we should write the copy as if we're in Beta and taking
payments"*). Until 2026-09-03 that ran ahead of the product, so the page carried an honest strip —
`BetaLine` in the file, plus `OpensShortly` under the plans — saying sign-up had not opened, with a
`mailto:` to the contact address, and the primary button was that mailto.

**Stripe went live on 2026-09-03 and sign-up opened to anyone**, so Greg had both deleted. The
primary button is now `Start reading`, jumping to the sign-in panel at the foot of the page; the
ghost button beside it goes to `/pricing`, and `Pricing` joined the top bar on both marketing pages
(`SiteNav` in [`SiteBits.tsx`](../../src/web/SiteBits.tsx)) at his asking, so a price is one click
from anywhere on the site. None of the pitch copy had to change, which was the point of writing it
forward.

## The features page

[`FeaturesPage.tsx`](../../src/web/FeaturesPage.tsx) at `/features`, since 2026-09-03: every mode
with a screenshot and a sentence of intent, then the plans. Reachable signed out, like the privacy
policy and for the same reason. The three plans are rendered by
[`PlanCards.tsx`](../../src/web/PlanCards.tsx)'s `WebsitePlans` on all three pages, and **the numbers
there are copy, not configuration** — the source of truth is the
`billing_tiers` table ([billing.md](billing.md)), and a quota changed there has to be changed here
by hand. The cards here carry no buttons — no action is passed on either marketing page — so since
2026-09-04 both of them put the same link under the plans, pointing at the page that can take the
press. The screenshots, their sizes and how they were made are in
[`src/web/shots.ts`](../../src/web/shots.ts), which `tests/landing-assets.test.ts` checks against
the bytes on disk — and what makes one of them *good*, which is a separate question the site had
been getting wrong, is [marketing-pages.md](marketing-pages.md).

Regrouped the same day: it was fourteen full-width screenshots stacked vertically, and each group
now leads with one or two landscape shots and follows with three portraits across or plain tiles.

The plan for both pages, with the simpler options passed over, is
[260902k-website-copy-homepage-and-features.md](../plans/260902k-website-copy-homepage-and-features.md).

## The pricing page

[`PricingPage.tsx`](../../src/web/PricingPage.tsx) at `/pricing`, since 2026-09-03, because Greg
asked for an address you can send somebody who asks what it costs. Linked from the landing page
twice — under the plans and in the footer — and reachable signed out, more obviously than the
other two: a price you have to sign up to read is the thing people complain about.

**It holds no numbers of its own.** It renders the same `PlanCards` component as the other two
pages, and adds only what a card cannot say — which since 2026-09-04 is an **FAQ** rather than four
unlabelled paragraphs headed *How it works*.

### It is one of the marketing pages, since 2026-09-04

It was not, and that was a defect rather than a style: `/` and `/features` open with
`className="site"` and `SiteNav`, while this was a bare `<main class="max-w-3xl">` with a *← Back*
link and no navigation. Measured in the browser that day, its content column started at **x=360**
where the other two start at **x=168** — the same three plans in a column that did not line up with
the rest of the site. And because the `--site-*` custom properties are declared on `.site`, the whole
visual language was simply unavailable here: a `site-panel` would have drawn a transparent border
over no fill.

So it now carries the same shell — `.site`, `SiteNav here="pricing"`, a hero with the glow and a real
`h1` (it had none, and its outline began at level two), a `sr-only` *Plans* `h2` so the outline does
not jump from the `h1` to the cards' `h3`s, and `SiteFooter variant="marketing"`. **The nav's
*Sign in* link stays on this page** rather than jumping to `/#sign-in` the way it does from
`/features`, and that is load-bearing rather than tidy: the buy path for a stranger is *press here,
sign in here, come back here*, because `SignInControls` remembers the address it was standing on.

**And it is drawn only for a stranger**, since the stage 2 code review. `/features` and `/pricing`
are both mounted signed in as well, and there neither spelling of that link goes anywhere: on
`/pricing` the panel lives in the signed-out half of the page, and `/` is the shelf. `SiteNav` takes
a `signedIn` prop with no default so that a new caller has to answer;
[`tests/site-nav-sign-in.test.tsx`](../../tests/site-nav-sign-in.test.tsx) mounts both pages both
ways.

### The FAQ, and whose sentences are in it

Seven questions in two columns under the cards, folding in all four *How it works* paragraphs —
what you are charged in, what a month's allowance counts and when it resets, that the free allowance
is a lifetime one, and how cancelling works. Those four are **moved word for word**;
[marketing-pages.md § The copy is not yours to write](marketing-pages.md#the-copy-is-not-yours-to-write)
permits a restructure to move a sentence and not to rewrite one. The other three answers — what
counts as an article, what happens at your limit, whether unused articles roll over — are
agent-written, approved by Greg on 2026-09-04, and each carries a `[tissue]` marker in a source
comment so a later dictation pass can find them
([positioning.md § Whose words](positioning.md#whose-words)).

**One of the four is no longer word for word, and the exception is worth knowing.** *"You are
charged in your own currency"* was checked against the Stripe prices in the stage 2 code review and
is false outside USD, GBP and EUR — those are the only currencies a tier carries, and hosted Checkout
can only pick one the price has. The rule that a claim is checked against the code outranks the rule
that Greg's sentence is not rewritten, because the second rule is about *voice* and this was about
*fact*; the page now names the three currencies. The tax-inclusive half of his sentence is supported
and is untouched. Three other sentences moved for the same reason, and the plan's log
([260904b](../plans/260904b-pricing-page-and-public-showcase.md#log)) lists all four.

**Three of those answers were checked against the admission path rather than against a doc about
it**, because they are the kind that is easy to state backwards. A slot is reserved only where the
request carries a URL or an upload, and settled only on a `done` ending — so a failed fetch costs
nothing, pasting the same URL again costs a second article even though every step then skips, and
re-running something already on your shelf is free. And **the answer about reaching your limit offered a
subscriber no upgrade until 2026-09-04**, because there was not one: the Portal could not switch
between two Products, and then the gate on every plan button asked whether an open subscription
existed rather than whether this tier was somewhere to go. Both were fixed that day, so the answer
now names the larger plan — and says *for the part of the month that is left*, because a mid-period
switch prorates the allowance rather than granting it whole
([billing.md](billing.md#reader-researcher-open-at-stripe-and-open-in-our-own-ui)).

### The one tooltip, and what it is not for

The research behind the redesign gave a rule that settles Greg's *"maybe in tooltips"*: **if a number
needs explaining to be usable, the explanation is not tooltip material.** So the allowance's
translation — *About one on every weekday* — is printed on the card, and what goes behind a hover is
the fine print somebody only reads once they are already suspicious: what counts as an article, and
what a second paste or a refresh costs. It hangs off the phrase *A successfully added article* in the
footnote under the cards, and its trigger is a `<button>` so that it opens on **tap and on focus** as
well as on hover — a hover-only tooltip is invisible on a touchscreen, which for a sentence about
money is close to not being there.

**And since 2026-09-04 it is the page you buy on.** Greg: *"Right now, the only way to pay is from
the /profile page, which is a bit buried and confusing."* So the Upgrade buttons moved out of
`BillingSection` into `PlanCards`, which both pages render — the flow **moved**, it was not copied,
and there is still one implementation of checkout in `useBilling.ts`. Three things make that work
for a stranger, and none of them is the obvious one:

- **The page carries its own sign-in panel**, the same `SignInControls` the landing page has. That
  *is* the continuation mechanism: `SignInControls` remembers the current address immediately before
  OAuth, so a reader who signs in here is sent back here, with no second OAuth path.
- **The tier they pressed rides in its own expiring `sessionStorage` marker**
  ([`src/web/buy-intent.ts`](../../src/web/buy-intent.ts)), never in the URL. `/pricing?buy=reader`
  would have been an address that makes an authenticated browser open a Stripe Checkout Session and
  leave our origin, which is not a thing a link should be able to do.
- **The marker is consumed before the POST**, not when the checkout succeeds. That is what makes a
  double mount, a real remount and Back-from-Stripe all safe;
  [`tests/pricing-buy-intent.test.tsx`](../../tests/pricing-buy-intent.test.tsx) drives
  `<StrictMode>` rather than trusting it, and against the obvious spelling it does not merely
  double-post — it loops.

**Buying starts here and lands on `/profile`**: Stripe's `successUrl` and `cancelUrl` both point
there, because confirming a session and managing a subscription live there. So the sentence that
said *"cancel … from the same page you subscribed on"* stopped being true the moment this shipped,
and was fixed in the same change: cancelling happens in Stripe's hosted billing page, which only
`/profile` can open.

**The free paragraph deliberately stops short of "every article you have ever added."** That would
be false: the ingest ledger started empty when billing launched and pre-launch articles were
grandfathered rather than backfilled, so an account older than the ledger has additions that do not
count against it. What it says instead is the rule going forwards — articles added while subscribed
count too, so cancelling hands back no fresh allowance — which is true, and is the half that
surprises somebody. GPT Sol caught the absolute as a false statement on a sales page, 2026-09-03.

**A signed-in reader is told which plan they are on**, in one line below the cards, and a signed-out
one is told nothing and — the part that matters — causes no request. Greg, 2026-09-03:

> It should show the two pricing options, and explain the 3 free articles, and indicate what you're
> on now, and ideally always be up to date if we change the pricing details.

The words are `describePlan`'s, from [`src/billing-plan.ts`](../../src/billing-plan.ts) — the same
function `/profile` renders, rather than a second wording of the same state, so the rule that a
lapsed reader is never shown *"40 of 3 used"* comes along rather than needing to be remembered
twice. It still carries a link to `/profile` labelled *Change plan*, and that is deliberate now that
the buying is on this page: an invoice, a card and a cancellation are all Stripe's hosted Portal,
which `/profile` is the only page able to open. Buying is the buttons above it; managing is the link.

**One `useBilling()` on the page, and that was decided before it was built.** The signed-in half owns
the hook and passes what it holds to both the buttons and this line. Two instances would be two
`/api/billing/usage` reads and two independent busy and error states, which is how one half of a page
comes to disagree with the other about whether a button is pressed.

**It prints the headline, and the `detail` sentence in three states only.** Those are the states
where the headline alone does not answer the question Greg asked: `lapsed`, whose *"Your plan has
ended"* names what ended rather than what you are on and collapses "two free slots left" and "none
left" into one sentence; a `paid` plan that is **cancelling**, which is word-for-word a renewing one
because the end date lives only in `detail`; and `unknown`, where `detail` is what says reading is
unaffected and to reload. `free` and a renewing `paid` keep the headline alone, because the cards
just above explains them. Dropping `detail` everywhere was the first version, and GPT Sol was right
that it failed *"indicate what you're on now"* in the state where a reader most needs the answer.

**Whether to fetch is a `readerId` prop from `App.tsx`, not a question the page asks**, and it is an
id rather than a boolean **because of the account switch**. A boolean says whether to ask and not
who asked: on a direct A→B sign-in the route does not change, so React keeps the element in place,
`useBilling`'s one effect never re-runs, and B reads A's tier and usage. That is the same stale-frame
bug the shelf carries `<Library key={user.id}>` for, and it was the first version of this page —
found in review, not in production. The line is now keyed on the reader **inside `PricingPage`** as
well as by `App.tsx`, deliberately: a guarantee that lives only in the caller is one edit away from
gone, with nothing in the page to notice.

Two halves of this a screenshot cannot check, both in
[`tests/pricing-page-current-plan.test.tsx`](../../tests/pricing-page-current-plan.test.tsx). It
records **every** URL the page asks for and asserts the list is empty when signed out — not that no
sentence appeared, which passes just as well if the request is made and the answer discarded, and
not merely that no *billing* URL was asked, which would pass if the plan moved behind another route.
And it drives the account switch by changing only the prop, with no `key` of its own, so a test that
would go on passing after somebody deleted the key is not what is standing there.

**And the second copy of the numbers has a guard.** The trade in `PlanCards.tsx` — copy rather than
configuration, so a signed-out page needs no fetch — is still the right one, and it still means a
quota raised with one `UPDATE` leaves the website saying the old number.
[`tests/plans-match-tiers.test.ts`](../../tests/plans-match-tiers.test.ts) reads `billing_tiers` and
fails when the table disagrees, naming the tier and the file. Since 2026-09-04 it also checks the
**tier ids**, because those are what a checkout POST carries and a wrong one draws no button at all
rather than a broken one — a silent failure with nothing to report. It reads the source rather than
rendering it, so it can miss a stale row but never invent one — the right way round for a check
nobody watches. A public tiers endpoint was the obvious alternative and was passed over: it would
undo the no-fetch trade, and put a spinner in front of the first thing a stranger wants to know.
