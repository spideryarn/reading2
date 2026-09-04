/**
 * **Plan and usage** — the half of `/profile` about what you may do, rather than
 * what the model knows about you.
 *
 * Until this landed the wall had no door on it from the browser: the quota
 * refused people and pointed at *"the Upgrade button on your profile page"*,
 * and there was no such button. Everything behind it already existed
 * (docs/project/billing.md); this is the surface.
 *
 * ## Two buttons, and neither of them is a billing UI
 *
 * **Upgrade** posts a tier id and follows the hosted Checkout Session that comes
 * back; **Manage billing** follows a hosted Customer Portal session. Invoices,
 * receipts, changing a card and cancelling are all the Portal's, on purpose —
 * card details never reach this server, which is what keeps us in Stripe's
 * lightest PCI scope. A proposal to draw any of that here is a proposal to take
 * on card-adjacent risk we have declined. Greg, 2026-09-02:
 *
 * > we don't want to process/touch/store sensitive info like card details.
 *
 * ## The prices come off the row, and there is no price on the wire
 *
 * Each card is a row of `billing_tiers` (`TierOffer`), so raising a quota or
 * changing an amount is an `UPDATE` and this page follows without a deploy.
 * **The cards themselves are `PlanCards`, shared with `/pricing`** since the
 * buying moved there on 2026-09-04 — that component is presentational and knows
 * nothing about billing, so this file still owns every decision below and
 * `cardFor` is the whole of what it hands over.
 * Nothing here hardcodes a tier name, a quota or a price, and the POST carries
 * **only the tier id** — a price id from the browser is refused by the route
 * rather than ignored.
 *
 * All three currencies are shown at once rather than one guessed from the
 * locale, because hosted Checkout picks by the customer's location and this page
 * cannot know which they will be charged in. See `describeAmounts` in
 * src/billing-plan.ts.
 *
 * ## What the lapsed case must never say
 *
 * *"40 of 3 used"*. The free allowance is lifetime and includes paid months, so
 * a reader who took forty articles on Reader and cancelled is permanently past
 * it — that is the policy (Greg, 2026-09-03), but written as arithmetic it reads
 * as a bug. `describePlan` holds the words and the `lapsed` arm of the plan union
 * has no `used` field at all, so this component could not print it if it tried.
 *
 * ## And what the cancelled case must always say
 *
 * *When*. A real cancellation on 2026-09-03 produced no sentence here at all —
 * the row's only cancellation signal was a boolean the hosted Portal leaves
 * `false` (docs/project/billing.md § *The first live sale*). The plan now
 * carries one derived `endsAt` date, drawn in the foreground tone rather than
 * the muted one, because a plan that ends on a date is the one thing on this
 * card the reader may not already know.
 */
import { CalendarClock, CreditCard, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { describeAmounts, describePlan } from "../billing-plan.js";
import type { TierOffer } from "../billing-plan.js";
import { PlanCards } from "./PlanCards.js";
import type { PlanCard } from "./PlanCards.js";
import { useBilling } from "./useBilling.js";

export function BillingSection() {
  const billing = useBilling();
  const { summary } = billing;

  if (!summary) {
    return (
      <p className="tw:m-0 tw:text-sm tw:text-muted-foreground" role="status">
        {billing.error ? (
          <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight">
            <TriangleAlert size={12} /> Couldn't read your plan — {billing.error}{" "}
            {/* **Not `className="linky"`, which styled nothing here.** That
                class is scoped in styles.css to `.controls`, `.cmt-dialog` and
                `.chat-dialog` ancestors — "a shape, not a shared class", as it
                says — and this card is in none of them, so the button arrived
                with no underline and nothing to mark it as pressable in the
                middle of a sentence. Same fix as `SettingsSection.tsx` and the
                sharing card, 2026-09-04.

                Two utilities and no more, because the rest is now in the
                button reset: `border-0`, `background-color: transparent`,
                `cursor: pointer` and `font: inherit` all come from
                tailwind.css § the bit of preflight we need. Colour is
                inherited from the `text-highlight` span around it. */}
            <button
              type="button"
              className="tw:p-0 tw:underline tw:underline-offset-2"
              onClick={billing.reload}
            >
              Try again
            </button>
          </span>
        ) : (
          "Loading…"
        )}
      </p>
    );
  }

  const copy = describePlan(summary.plan);
  /* **The one thing on this card the reader may not know**, and the reason the
     detail line is drawn in the foreground tone rather than the muted one. A
     plan that ends on a date is time-sensitive in a way "renews on the 3rd" is
     not: until 2026-09-03 a real cancellation produced no sentence here at all
     (docs/project/billing.md § *The first live sale*), and burying the fix in
     grey small print would be most of the way back to saying nothing.

     **Asked of the plan, not of the words.** `endsAt` is the single derived
     field the wire carries, so this cannot come to disagree with the sentence
     `describePlan` wrote from the same field. */
  const ending = summary.plan.kind === "paid" && summary.plan.endsAt !== null;

  return (
    <div className="tw:flex tw:flex-col tw:gap-4">
      {/* ------------------------------------------------- what you are on -- */}
      <div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-3">
        <div className="tw:min-w-0">
          <p className="tw:m-0 tw:text-sm tw:text-foreground">{copy.headline}</p>
          {copy.detail && (
            <p
              className={
                ending
                  ? "tw:mt-1 tw:mb-0 tw:flex tw:items-start tw:gap-1.5 tw:text-xs tw:text-foreground"
                  : "tw:mt-1 tw:mb-0 tw:text-xs tw:text-muted-foreground"
              }
            >
              {/* Not `TriangleAlert`: a cancellation the reader asked for is not
                  a fault, and nothing here needs fixing. A date wants a
                  calendar. */}
              {ending && <CalendarClock size={13} className="tw:mt-0.5 tw:shrink-0" />}
              <span>{copy.detail}</span>
            </p>
          )}
        </div>
        {/* **Only when the Portal has something to open.** It refuses an owner
            with no Stripe customer (409, `pay-none`), and a button whose only
            possible outcome is that refusal is worse than no button. */}
        {summary.manageable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={billing.busy !== null}
            onClick={billing.manage}
          >
            <CreditCard size={13} />
            {billing.busy?.kind === "manage" ? "Opening…" : "Manage billing"}
          </Button>
        )}
      </div>

      {/* **A refresh that failed, over a plan that is still on screen.** The
          hook leaves `summary` alone when a reload fails, so this says the card
          above may be out of date rather than replacing a true answer with an
          empty one. */}
      {billing.error && (
        <p className="tw:m-0 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-highlight">
          <TriangleAlert size={12} /> This may be out of date — {billing.error}
        </p>
      )}

      <CheckoutReturnNote billing={billing} />

      {/* ------------------------------------------------------ what to buy -- */}
      {/* **`canCheckout`, not `plan.kind !== "paid"`.** The first version asked
          the plan, which hides the cards for a subscriber and shows them to
          three kinds of account whose press of *Upgrade* only ever opens the
          Portal — an `unpaid` or `incomplete` subscription, and a live one whose
          dates we cannot read. `startCheckout` refuses while any *non-terminal*
          subscription exists, and that is a shorter list than unentitled, so the
          server answers the question rather than the page guessing at it. See
          `BillingSummary.canCheckout`; GPT Sol, 2026-09-03. */}
      {summary.canCheckout && summary.offers.length > 0 && (
        <div className="tw:flex tw:flex-col tw:gap-2">
          {/* **The same component `/pricing` draws**, since the buying moved
              there on 2026-09-04 (PlanCards.tsx). One rendering of a plan, two
              pages, and one implementation of the press — which is what makes
              *"the only way to pay is from the /profile page"* untrue without
              copying anything. Greg, 2026-09-04.

              **And the numbers here are still the rows', not the website's
              copy**, which is the property this file has argued for since it was
              written: raising a quota is one `UPDATE` and this page follows
              without a deploy. `cardFor` below is the whole of the difference
              between the two callers. */}
          <PlanCards
            plans={summary.offers.map(cardFor)}
            action={(plan) => {
              /* `plan.id` cannot be null here — every card came from an offer —
                 but the type says it can, and a cast would be a worse way of
                 saying so than a branch that cannot run. */
              const tierId = plan.id;
              if (tierId === null) return null;
              const pressed = billing.busy?.kind === "upgrade" && billing.busy.tierId === tierId;
              return {
                label: pressed ? "Opening Stripe…" : "Upgrade",
                /* Any button on the section is mid-request, so none of them may
                   be pressed. */
                disabled: billing.busy !== null,
                onPress: () => billing.upgrade(tierId),
              };
            }}
          />
          {/* Said once, under the cards, because it is true of all of them and
              because a reader looking at three prices will ask which one they
              pay. */}
          <p className="tw:m-0 tw:text-xs tw:text-ink-faint">
            {/* **No "the button above".** It said that, and a free account that
                has never checked out has no Manage billing button — the Portal
                needs a Stripe customer, and the first Upgrade is what makes one.
                GPT Sol, 2026-09-03. */}
            Stripe charges in the currency for your location, and takes the card details — they
            never reach us. Invoices, changing a card and cancelling all happen in Stripe's own
            billing page, which this page links to once you have a subscription; a cancellation ends
            at the end of the month you have paid for.
          </p>
        </div>
      )}

      {billing.actionError && (
        <p className="tw:m-0 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-highlight">
          <TriangleAlert size={12} /> {billing.actionError}
        </p>
      )}
    </div>
  );
}

/**
 * One offer, as a `PlanCard`.
 *
 * The whole of what this page adds to the shared cards, and every line of it is
 * a decision that was made once already:
 *
 * **The allowance comes from `ingestsPerPeriod`, never from the prose**, and
 * this was briefly the other way round. Rendering only `description` read better
 * on today's rows, because every seeded description opens with the allowance —
 * and it is *wrong*: `ingests_per_period` and `description` are two columns, and
 * billing.md's own recipe for raising a quota is one `UPDATE` of the first. Do
 * that and the wall grants 50 while this card advertises the 20 still sitting in
 * the sentence. GPT Sol, 2026-09-03. So the number is structured and
 * authoritative, and the description is the row's own words beside it. On the
 * seeded rows that reads the allowance twice, which is redundant rather than
 * wrong — and the two saying *different* numbers is a visible symptom rather
 * than a silent lie, which is the trade taken deliberately. A description should
 * not restate the allowance; billing.md § *Adding a tier or a currency* says so,
 * and the seeded ones predate that line.
 *
 * **All three currencies at once** rather than one guessed from the locale,
 * because hosted Checkout picks by the customer's location and this page cannot
 * know which they will be charged in. `describeAmounts`, src/billing-plan.ts.
 *
 * **The plan word, not the product name.** `Spideryarn Reader` is what the row
 * calls it and `Reader` is what the website calls it; the two pages now sit a
 * click apart, so they say the same word.
 */
function cardFor(offer: TierOffer): PlanCard {
  return {
    id: offer.id,
    name: offer.name.replace(/^Spideryarn /, ""),
    allowance: `${offer.ingestsPerPeriod} a month`,
    price: `${describeAmounts(offer.amounts)} a month`,
    note: offer.description,
  };
}

/**
 * What happened on the way back from Stripe.
 *
 * Four states and none of them is an alarm. **None of them claims a
 * subscription exists**, and both halves of that took a correction.
 *
 * `unconfirmed` does not say a payment was taken: the reader arrived from
 * Stripe, so it *usually* was — but the confirmation failing is exactly the case
 * where we do not know. It might be a session that was never paid for, or one
 * that is not theirs, or Stripe having a bad minute.
 *
 * And `confirmed` said *"your subscription is set up"*, which was worse, because
 * it read as certainty. `confirmCheckout` proves only that the Session belongs
 * to this reader and then returns whatever the sync found — which may be `null`,
 * `incomplete`, or a status that entitles nothing. So an abandoned Session of
 * one's own, pasted back into the address bar, produced a congratulation. GPT
 * Sol, 2026-09-03. It now says what actually happened — we asked Stripe — and
 * leaves the substantive claim to the plan card above, which has just been
 * re-read and is the only thing that knows.
 */
function CheckoutReturnNote({ billing }: { billing: ReturnType<typeof useBilling> }) {
  const { checkout } = billing;
  if (checkout.kind === "none") return null;

  const words =
    checkout.kind === "cancelled"
      ? "That checkout was cancelled, and nothing has been charged."
      : checkout.kind === "checking"
        ? "Checking with Stripe…"
        : checkout.kind === "confirmed"
          ? "Thank you — we've checked that with Stripe, and your plan above is up to date."
          : "We couldn't check that with Stripe from here. If the payment went through, the plan " +
            `above will catch up within a few seconds — reload to look again. (${checkout.why})`;

  return (
    <p className="tw:m-0 tw:rounded-md tw:border tw:border-border tw:bg-background tw:px-3 tw:py-2 tw:text-xs tw:text-muted-foreground">
      {words}
    </p>
  );
}
