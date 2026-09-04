/**
 * `/pricing` — what it costs, and, since 2026-09-04, where you buy it.
 *
 * **This page holds no numbers of its own.** It renders the same
 * `<WebsitePlans />` the landing page and the features page do, which is the
 * point: three copies of a price table would be three chances to disagree, and
 * the one that is wrong is always the one the customer read. Greg asked for this
 * page on 2026-09-03 and asked, if possible, that it keep itself up to date.
 *
 * ## How "up to date" is arranged, given the table is hardcoded
 *
 * The numbers in PlanCards.tsx are copy rather than configuration — a deliberate
 * trade so a signed-out page needs no fetch (PlanCards.tsx explains it). A public
 * `/api/tiers` would have undone that trade for a table that changes a few
 * times a year, and would have put a spinner in front of the first thing a
 * stranger wants to know.
 *
 * So the drift is caught rather than designed away: `tests/plans-match-tiers.test.ts`
 * reads `billing_tiers` and fails if this table disagrees with it. Raising a
 * quota is still one `UPDATE` (docs/project/billing.md), and it is still two
 * edits — but the second one can no longer be forgotten quietly, which is the
 * part that actually costs a customer.
 *
 * Reachable signed out, like `/privacy` and `/features`, and rather more so: a
 * price you have to sign up to read is the thing people complain about.
 *
 * ## This page can take money now, and the flow moved rather than being copied
 *
 * Greg, 2026-09-04: *"Right now, the only way to pay is from the /profile page,
 * which is a bit buried and confusing."* So the Upgrade buttons come out of
 * `BillingSection` into the presentational `PlanCards`, which both pages render,
 * and there is still exactly one implementation of the checkout flow
 * (useBilling.ts) — which is what the previous version of this header was right
 * to protect when it refused a *second copy* of it.
 *
 * Three things make it work for a stranger, and none of them is the obvious one.
 * The plan is docs/plans/260904b-pricing-page-and-public-showcase.md and the
 * reasoning is a GPT Sol review of it.
 *
 * - **The page carries its own sign-in panel**, the way the landing page does.
 *   That is the whole continuation mechanism: `SignInControls` calls
 *   `rememberReturn(location.pathname + location.search)` immediately before
 *   OAuth, so a reader who signs in *here* is sent back *here*, with no second
 *   OAuth path and nothing duplicated. The first draft carried the destination
 *   itself and would have been overwritten by whatever page the sign-in happened
 *   on.
 * - **The tier they pressed rides in its own `sessionStorage` marker**, never in
 *   the address (buy-intent.ts says why a query parameter is not consent). That
 *   storage is tab-scoped, so a sign-up finished in a *new* tab — which is what
 *   an emailed confirmation link usually opens — arrives with neither the marker
 *   nor the destination, and the panel's own sentence says so rather than
 *   promising something it cannot do.
 * - **The marker is consumed before the POST, not after it succeeds.** That one
 *   line is what makes a `<StrictMode>` double mount, a real remount and Back
 *   from Stripe all safe, and `tests/pricing-buy-intent.test.tsx` drives the
 *   double mount rather than trusting it.
 *
 * **Stripe still returns to `/profile`.** `successUrl` and `cancelUrl` both
 * point there (src/billing/checkout.ts) and that has not changed: confirming a
 * Checkout Session and managing a subscription both live on `/profile`, and
 * `CheckoutReturnNote` is already there to read the `?checkout=` parameter. So
 * buying starts here and lands there, on purpose.
 *
 * ## Which plan you are on, and why that is a prop rather than a fetch
 *
 * Greg, 2026-09-03, asked the page to "indicate what you're on now". A signed-in
 * reader gets one line saying so, below the table; a signed-out one gets
 * nothing, and — the point — makes no request. `readerId` comes from App.tsx,
 * which already branches on signed-in to decide whether this page wears the
 * corner logo, so the answer is known before the page renders and there is no
 * moment where it has to guess. A `useBilling()` inside an unconditional render
 * would have put a 401 on the path of the one page a stranger is most likely to
 * be sent, for a line that is not for them.
 *
 * **It carries a reader id rather than a boolean, and that is the account
 * switch.** The first version took `signedIn: boolean`, which is enough to
 * decide whether to ask and not enough to say *who asked*: on a direct A→B
 * sign-in the route does not change, so React keeps this element in the same
 * place in the tree, `useBilling`'s one effect never re-runs — it depends only
 * on `attempt` — and B reads A's tier and A's usage count for as long as they
 * stay on the page. The repo has met this before and fixed it the same way, on
 * the shelf: `<Library key={user.id} readerId={user.id} />`, with the reasoning
 * beside it in App.tsx. So this page is keyed on the id too, and the prop is
 * the id, so a rendering that does not know which reader it is drawing cannot
 * be written.
 *
 * **And there is exactly one `useBilling()` on the page**, in `PlansForAReader`,
 * which passes what it holds down to both the cards' buttons and the
 * current-plan line. Two instances would be two `/api/billing/usage` requests
 * and two independent busy and error states, which is how one half of a page
 * comes to disagree with the other half about whether a button is pressed.
 *
 * Styled with Tailwind utilities — docs/project/web-client.md. `tw:` prefix on
 * every class.
 */
import { useEffect, useRef } from "react";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { describePlan } from "../billing-plan.js";
import type { BillingSummary } from "../billing-plan.js";
import { Link } from "./Link.js";
import { WebsitePlans } from "./PlanCards.js";
import type { PlanCard, PlanCardAction } from "./PlanCards.js";
import { SignInControls } from "./SignInControls.js";
import { H2 } from "./SiteBits.js";
import { SiteFooter } from "./SiteFooter.js";
import { buyIntentIsFresh, rememberBuyIntent, takeBuyIntent } from "./buy-intent.js";
import type { BuyIntent } from "./buy-intent.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { useBilling } from "./useBilling.js";
import type { UseBilling } from "./useBilling.js";

/** Where a *Get Reader* press sends a stranger, and where the panel itself is. */
const SIGN_IN_ID = "sign-in";

export function PricingPage({ readerId }: { readerId: string | null }) {
  useDocumentTitle(pageTitle({ kind: "pricing" }));

  return (
    <main className="tw:mx-auto tw:max-w-3xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:pb-24 tw:font-sans tw:text-[0.95rem] tw:leading-relaxed tw:text-muted-foreground">
      <Link
        href="/"
        className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
      >
        <ArrowLeft size={13} />
        Back
      </Link>

      <H2>Plans</H2>
      {/* **Keyed here as well as in App.tsx, and this is the one that counts.**
          App.tsx keys the page on the account for the same reason it keys the
          shelf, but a guarantee that lives only in the caller is one edit away
          from being gone, and nothing in this file would notice. Keying the
          signed-in half on the reader whose plan it is makes the page safe on
          its own terms: a `readerId` change cannot leave the previous reader's
          summary — or their half-pressed Upgrade button — mounted, whatever the
          caller does. */}
      {readerId === null ? <PlansForAStranger /> : <PlansForAReader key={readerId} />}

      {/* **What a reader is actually buying**, said once and plainly. The quota
          rule is the plan's (docs/project/billing.md § What we sell); the
          currency sentence is a fact about the Stripe prices, which carry all
          three and let hosted Checkout pick — docs/project/billing.md § Why
          three currencies rather than one. */}
      <H2>How it works</H2>
      <p className="tw:mt-4">
        You are charged in your own currency — the price you see on the payment page is the price
        that leaves your account, tax included. Nothing is added on top.
      </p>
      <p className="tw:mt-4">
        A month's allowance is articles <em>added</em>, and it resets on the day you subscribed.
        Everything you do with an article afterwards — the glossary, the summaries, the questions,
        chat — is included, however many times you come back to it.
      </p>
      {/* **The free three, said out loud, including the part that surprises
          people.** The table says "3, for life" and the sentence under it
          explains what counts, but neither says that *for life* means what it
          says: the count does not reset, and it does not pause while you are
          subscribed. So somebody who takes forty articles on Reader and
          cancels is past the free allowance permanently — the policy Greg chose
          on 2026-09-03 (docs/project/billing.md § *Reading is never gated*),
          and the reason `pay-lapsed` in src/messages.ts needs a third sentence.
          A rule a reader meets for the first time in a refusal reads as a bug;
          here it is a term of sale, which is the right place for it.

          The numbers are `PlanCards`' to state and this paragraph deliberately
          repeats none of them — a "3" here would be a fourth copy, outside
          what tests/plans-match-tiers.test.ts reads. Nor does it repeat
          *reading is never gated*, which the plans have just said three inches
          above; saying it twice on one page reads as a page that doubts it.

          **It does not say "every article you have ever added", which would be
          false.** The ledger started empty when billing launched and articles
          added before that were grandfathered rather than backfilled
          (docs/plans/260902i-stripe-payments-and-subscription-tiers.md), so an
          account older than the ledger has additions that do not count. GPT
          Sol caught that as a false absolute on a sales page, which is the
          right way to read it: the sentence now states the rule going forwards,
          which is both true and the part that can surprise somebody. */}
      <p className="tw:mt-4">
        The free allowance is for the lifetime of the account rather than per month, so it does not
        reset. Articles added while you are subscribed count towards it too, so cancelling does not
        hand back a fresh allowance — though whatever you have added stays yours either way.
      </p>
      {/* **This sentence used to say "from the same page you subscribed on",
          and this change is what made that false.** Subscribing moved here on
          2026-09-04; cancelling did not move at all, and could not — it happens
          in Stripe's own hosted billing page, which only `/profile` links to,
          because that link needs a Stripe customer to open and this page has no
          idea whether you have one. Fixed in the change that broke it rather
          than left for somebody to notice: a sales page that is wrong about
          cancelling is the worst sentence on the site to be wrong. */}
      <p className="tw:mt-4">
        Cancel whenever you like, from{" "}
        <Link href="/profile" className="tw:text-highlight">
          your profile
        </Link>
        , which opens Stripe's own billing page. You keep the month you have paid for, and nothing
        you have added is taken away.
      </p>

      {/* **The shared row, not a hand-written one.** The first draft of this
          page copied the features page's footer, which is exactly the
          duplication SiteFooter.tsx was extracted to stop — and it says so: a
          Terms page should be one entry in its `LINKS`, not an edit to every
          page. No `here` is needed, because `/pricing` parses to its own route
          and the row can drop its own link by itself. */}
      <SiteFooter />
    </main>
  );
}

/**
 * The plans, for somebody who is not signed in — with buttons that work.
 *
 * **A press stores the tier and moves the reader down to the sign-in panel**,
 * and that is the whole of the buy path for a stranger: sign in here, come back
 * here (`rememberReturn` captured `/pricing` on the way out), and
 * `PlansForAReader` finds the marker and opens Stripe.
 *
 * There is no request on this path, which is not an accident and is asserted:
 * `tests/pricing-page-current-plan.test.tsx` records **every** URL the
 * signed-out page asks for and requires the list to be empty. A CTA that asked
 * the server what the tiers were would break that, and would put a spinner in
 * front of the first thing a stranger came here to read.
 */
function PlansForAStranger() {
  const wantPlan = (plan: PlanCard): PlanCardAction | null => {
    /* Pulled out of the property so the closure below closes over a `const`
       string rather than over `plan.id`, which TypeScript will not keep narrowed
       across a function boundary. */
    const tierId = plan.id;
    if (tierId === null) return null;
    return {
      /* "Get Reader", not "Sign in to get Reader": the sign-in is a step on the
         way and not the thing they want, and the panel it scrolls to says
         plainly what it is. */
      label: `Get ${plan.name}`,
      disabled: false,
      onPress: () => {
        rememberBuyIntent(tierId);
        /* Both optional: jsdom has no `scrollIntoView`, and a page that threw
           on a button press would be a worse failure than a page that jumped
           without animating. The anchor is a real element either way, so a
           reader who has scripting trouble still has the panel below them. */
        document.getElementById(SIGN_IN_ID)?.scrollIntoView?.({
          behavior: "smooth",
          block: "center",
        });
      },
    };
  };

  return (
    <>
      <WebsitePlans action={wantPlan} />

      {/* The landing page's panel, at the foot of this page's plans rather than
          the foot of the page: this is the only thing a stranger who pressed a
          button is now looking for. LandingPage.tsx § sign in.

          **Ordinary utilities, not `site-panel`.** The `--site-*` tokens are
          declared on `.site`, which this page does not carry — it is a bare
          `<main>` with a Back link rather than one of the marketing pages — so
          `site-panel` here would draw a transparent border over no fill and
          look like a class somebody forgot to define. Stage 2 of the plan moves
          the whole page onto the site shell, and this can become `site-panel`
          in the same breath. */}
      <section
        id={SIGN_IN_ID}
        className="tw:mt-8 tw:scroll-mt-20 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-6"
      >
        <p className="tw:mb-5 tw:text-sm">
          {/* [tissue] Both halves, as on the landing page: the same controls
              create an account and return to one. The third sentence is what
              makes the button above make sense — it says where the press went.

              **And it promises the tab rather than the account**, which is a
              correction rather than a hedge. It read *"whichever plan you chose
              above, we will pick it up again once you are in"*, and that is
              false for the one sign-up route that does not finish where it
              started: an email confirmation link commonly opens a **new tab**,
              and both `auth-return` and `buy-intent` are `sessionStorage`, which
              is tab-scoped and does not travel. GPT Sol, stage 1 review, finding
              5. The remedy is a press of a button that is already on the screen
              they land on, so the honest sentence costs the reader nothing —
              whereas cross-tab storage would put a purchase intent somewhere it
              outlives the tab that consented to it, which is exactly what
              buy-intent.ts refused to do with the URL. */}
          Start with three articles free. Already have an account? Sign in — your shelf is where you
          left it. The plan you chose above is picked up when you come back to this tab; if a
          confirmation link opens a new one, just press it again there.
        </p>
        <SignInControls />
      </section>
    </>
  );
}

/**
 * The plans, for somebody signed in — and the only `useBilling()` on the page.
 *
 * It owns the state and hands it out: the cards get an action per tier, the line
 * below gets the summary. The alternative — a chooser with a hook of its own
 * beside a current-plan line with another — was rejected in the plan before it
 * was built, because two instances are two `/api/billing/usage` requests and two
 * independent `busy` states on one page.
 */
function PlansForAReader() {
  const billing = useBilling();
  const { summary } = billing;

  useBuyIntent(billing);

  /**
   * What may be bought, asked of the **server's** answer rather than of the plan.
   *
   * `canCheckout`, not `plan.kind !== "paid"`: the first version of `/profile`
   * asked the plan, which hides the cards from a subscriber and shows them to
   * three kinds of account whose press only ever opens the Portal — an `unpaid`
   * or `incomplete` subscription, and a live one whose dates we cannot read.
   * `startCheckout` refuses while any *non-terminal* subscription exists, and
   * that is a shorter list than unentitled, so the server answers the question
   * rather than the page guessing at it. BillingSection.tsx carries the same
   * comment because it is the same rule. GPT Sol, 2026-09-03.
   *
   * And the tier has to be in `offers`, which is what keeps this honest when the
   * copy in PlanCards.tsx and the rows in `billing_tiers` disagree: a plan
   * nobody sells gets no button rather than a button that 400s.
   */
  const buyPlan = (plan: PlanCard): PlanCardAction | null => {
    const tierId = plan.id;
    if (tierId === null || !summary || !summary.canCheckout) return null;
    if (!summary.offers.some((offer) => offer.id === tierId)) return null;
    const pressed = billing.busy?.kind === "upgrade" && billing.busy.tierId === tierId;
    return {
      label: pressed ? "Opening Stripe…" : `Get ${plan.name}`,
      /* Every button off while any one of them is mid-request: two Checkout
         Sessions is two Stripe customers' worth of confusion for a reader who
         double-clicked. */
      disabled: billing.busy !== null,
      onPress: () => billing.upgrade(tierId),
    };
  };

  return (
    <>
      <WebsitePlans action={buyPlan} />
      {/* **The plan, or the reason there is no plan on screen — never neither.**
          Until the read lands there are no buttons, because `buyPlan` needs
          `offers` and `canCheckout` to know what may be pressed; so a read that
          *failed* left a signed-in reader looking at prices with nothing to
          press and nothing said, which is precisely the page this feature was
          built to stop existing. GPT Sol found it in the stage 1 review
          (docs/plans/260904b-stage1-code-review-sol.md, finding 2), and it
          matters more now that quota refusals send people here.

          `/profile` has said this properly since it was written; the words are
          `BillingSection`'s, deliberately, for the same reason `CurrentPlan`
          borrows `describePlan`'s. Not a shared component: the two sit in
          different layouts, and this one has to say nothing at all while the
          first read is still in flight — `/profile` says "Loading…" because the
          card is the page, whereas here the prices are already on screen and a
          spinner under them would be the second thing this page refuses to
          make a stranger wait for. */}
      {summary ? (
        <CurrentPlan summary={summary} />
      ) : (
        billing.error && (
          <p className="tw:mt-4 tw:m-0 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-highlight">
            <TriangleAlert size={12} /> Couldn't read your plan — {billing.error}{" "}
            {/* **Not `className="linky"`, which styles nothing here.** That class
                is scoped in styles.css to `.controls`, `.cmt-dialog` and
                `.chat-dialog` ancestors, and this page is in none of them, so the
                button arrived as bare text with nothing to mark it pressable —
                which is worse here than anywhere, because this sentence is the
                only way back from a failed billing read. Copied from
                `BillingSection.tsx`'s identical fix rather than re-derived; the
                sentence is the same sentence and `tests/linky-is-scoped.test.ts`
                is what caught this one, on the merge that brought that test in. */}
            <button
              type="button"
              className="tw:p-0 tw:underline tw:underline-offset-2"
              onClick={billing.reload}
            >
              Try again
            </button>
          </p>
        )
      )}
      {/* A press that failed, said where the press was. `/profile` says the same
          thing about its own buttons; this is not a shared component because the
          two sit in different layouts and the sentence is the server's. */}
      {billing.actionError && (
        <p className="tw:mt-4 tw:m-0 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-highlight">
          <TriangleAlert size={12} /> {billing.actionError}
        </p>
      )}
    </>
  );
}

/**
 * Finish a purchase that was interrupted by a sign-in.
 *
 * Two effects, and the order of the two is the design.
 *
 * **The first consumes the marker on mount, before anything is known** — before
 * the summary lands, and therefore before any POST can possibly be sent. That
 * is what the review asked for and it is not the obvious spelling: the obvious
 * one reads the marker at the moment it is needed, once the summary is in, and
 * deletes it when the checkout succeeds. The deletion is the guard, not the
 * `fired` ref below: `<StrictMode>`'s second mount, a real remount, and a reader
 * pressing Back from Stripe onto this page all run this effect again, and all of
 * them find an empty slot. A read-then-delete-on-success would open a second
 * Checkout Session for every one of those.
 *
 * **The second fires once the summary is in, and only if the reader may
 * actually buy that tier.** A tier that is not on sale, or an account that may
 * not check out, is ignored **silently**: the cards are on screen either way, so
 * there is nothing to explain and nobody to explain it to — the reader did not
 * ask for this page to say anything, they asked to buy something a minute ago.
 *
 * `fired` is belt and braces for the case the deletion cannot cover: this effect
 * re-runs whenever `billing` changes identity, which is every render, so without
 * it a marker held in a ref would be spent more than once within the one mount.
 *
 * **And the age is asked twice, because the two effects are not one moment.**
 * The ref holds the whole intent rather than the tier id, and the second effect
 * re-checks `buyIntentIsFresh` immediately before the POST. Age checked only at
 * the read is age unchecked: GPT Sol held `/api/billing/usage` pending for
 * eleven minutes, resolved it, and watched a ten-minute marker open Stripe
 * (docs/plans/260904b-stage1-code-review-sol.md, finding 4). Nothing bounds the
 * gap between mount and the summary landing — a slow network, a laptop asleep on
 * this page, a request that hangs — and the whole point of the window is that
 * a purchase belongs to the minute somebody asked for it.
 *
 * What this is **not** is exact-once. buy-intent.ts § What consuming on mount
 * does not give you names the two gaps that remain, and why neither is being
 * closed today.
 */
function useBuyIntent(billing: UseBilling): void {
  const wanted = useRef<BuyIntent | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    /* Read-and-delete, at the earliest moment there is a browser to read from.
       No dependency array entries: one mount, one attempt.

       **The `if` is not defensive tidiness — without it `<StrictMode>` breaks
       the feature.** React runs a mount effect, its cleanup, and then the effect
       again, on the *same* instance: a bare assignment takes the marker on the
       first run and then writes the second run's `null` over it, so the reader
       who pressed *Get Reader* comes back from Google to nothing at all. Found
       by the double-mount test rather than in a browser, which is the reason
       that test drives `<StrictMode>` instead of asserting about it. */
    const found = takeBuyIntent();
    if (found !== null) wanted.current = found;
  }, []);

  useEffect(() => {
    if (fired.current) return;
    const intent = wanted.current;
    if (intent === null) return;
    const { summary } = billing;
    /* Not yet — the summary is what says whether this is allowed, and "don't
       know yet" is not "no". The effect runs again when it lands. */
    if (!summary) return;

    /* Spent, whatever happens next: an intent we have looked at and refused must
       not be reconsidered on the next render. */
    fired.current = true;
    wanted.current = null;

    /* **Asked here, and not only where it was read.** However long the summary
       took, the window is measured to this line — the moment something is
       actually bought. See the header. */
    if (!buyIntentIsFresh(intent)) return;
    if (!summary.canCheckout) return;
    if (!summary.offers.some((offer) => offer.id === intent.tierId)) return;
    billing.upgrade(intent.tierId);
  }, [billing]);
}

/**
 * *You are on Free — 1 of 3 articles used.* One line, for a signed-in reader.
 *
 * **The words are `describePlan`'s**, not this file's. It is the same sentence
 * `/profile` shows, from src/billing-plan.ts, because a page that phrased the
 * same state differently would be the second source of truth this repo keeps
 * writing postmortems about — and the `lapsed` arm's rule (never *"40 of 3"*)
 * comes along for free rather than needing to be remembered here.
 *
 * **The headline, plus `detail` in the three states where the headline alone
 * does not answer the question Greg asked.** Dropping `detail` everywhere was
 * the first version and it failed *"indicate what you're on now"* in the one
 * state where a reader most needs the answer — GPT Sol, 2026-09-03:
 *
 * - `lapsed` says *"Your plan has ended"*, which names what **ended** rather
 *   than what they are on. Both "two free slots left" and "the free allowance
 *   is spent" collapse into that one sentence, and they are different answers.
 * - `paid` **while cancelling** is word-for-word a renewing subscription: the
 *   cancellation and the date it stops live only in `detail`. Hiding that is
 *   the same failure `/profile` already has open as a live bug in
 *   docs/project/billing.md, and this page should not add a second place it is
 *   not said.
 * - `unknown` says we could not confirm it, and `detail` is what says reading
 *   is unaffected and to reload — a state with no way out of it is worse than
 *   the sentence being long.
 *
 * The other three keep the headline alone: `free` and a renewing `paid` are
 * explained by the table six inches above, and `exempt` and `off` are
 * self-contained. Two explanations of one rule read as a page that is not sure.
 *
 * **And the headline is printed as it stands, with no sentence built around
 * it.** The obvious framing — *"You are on {headline}"* — works for the two
 * states anybody thinks of and is broken English in the other four: *"You are
 * on We could not confirm your plan just now"*, *"You are on Your plan has
 * ended"*. `describePlan` returns six headlines in three grammatical shapes, so
 * the only safe thing to add around one is nothing. `/profile` prints it bare
 * for the same reason.
 *
 * **Nothing at all until the read lands, and this line never guesses.**
 * `summary` is `null` for "don't know yet", and the caller draws no plan line
 * at all — a plan this page cannot confirm is better left unsaid than invented,
 * and this line is an orientation rather than a gate: nothing a reader may do
 * depends on it, and since 2026-09-04 the *buying* does not either, because the
 * buttons above are drawn from `offers` rather than from this line.
 *
 * **A read that failed is a different thing from a read that has not landed,
 * though, and the caller now says so.** Silence was the whole of it until the
 * stage 1 review, and it was wrong: with no summary there are no buttons
 * either, so the reader got prices, nothing to press, and no explanation. The
 * caller draws `/profile`'s own "Couldn't read your plan — Try again" in this
 * slot instead. Silence remains right for *this component*, which has one job
 * and no way to fix anything.
 *
 * **It takes the summary rather than fetching one.** It owned a `useBilling()`
 * of its own until the buttons arrived above it, and a second instance would be
 * a second `/api/billing/usage` request and a second, disagreeing, `busy` state
 * on the same page.
 */
function CurrentPlan({ summary }: { summary: BillingSummary }) {
  const plan = summary.plan;
  const copy = describePlan(plan);
  /* The three states from the header, named as a condition rather than left to
     a reader of the JSX to infer. A `switch` would be the exhaustive form, but
     this is one boolean about presentation and not a fork in what the page
     does. */
  /* `endsAt !== null` rather than a `cancelling` boolean: the boolean was
     computed from `cancel_at_period_end`, which the hosted Portal never sets, so
     this branch was unreachable in production and the page stayed silent about a
     plan that was ending. src/billing-plan.ts § `planEndsAt`. */
  const needsDetail =
    plan.kind === "lapsed" ||
    plan.kind === "unknown" ||
    (plan.kind === "paid" && plan.endsAt !== null);

  return (
    /* **No `role="status"`.** This is passive page content that happens to
       arrive late, not feedback to something the reader did — and the page
       already has a polite live region announcing the title (page-title.ts), so
       a second one would announce twice in an order that depends on which
       request lands first. A live region mounted with its text already in it is
       also the pattern this repo has found screen readers unreliable about.
       Left in document order, where a reader meets it on the way down the page.
       GPT Sol, 2026-09-03. */
    <p className="tw:mt-4 tw:text-sm tw:text-foreground">
      <strong className="tw:font-medium">{copy.headline}</strong>
      {" · "}
      {/* **`/profile`, and it stays `/profile` now that the buying moved here.**
          Changing a plan is not one thing: buying is the buttons above, and
          everything else — an invoice, a card, a cancellation — is Stripe's
          hosted Portal, which `/profile` is the only page that can open (it
          needs a Stripe customer, and this page does not know whether there is
          one). So the link that means *manage* still points where managing
          happens. docs/plans/260904b § Repoint links. */}
      <Link href="/profile" className="tw:text-highlight">
        Change plan
      </Link>
      {needsDetail && copy.detail && (
        <span className="tw:mt-1 tw:block tw:text-xs tw:text-muted-foreground">{copy.detail}</span>
      )}
    </p>
  );
}
