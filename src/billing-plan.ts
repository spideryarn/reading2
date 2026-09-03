/**
 * **What to tell a reader about their own plan** — the shape `/profile` reads,
 * and the words it puts on the page.
 *
 * Pure: no database, no network, no environment, no React. The server builds a
 * `BillingSummary` in src/billing/summary.ts and `GET /api/billing/usage`
 * answers with it; src/web/BillingSection.tsx draws it. This file is the wire
 * shape both ends agree on, plus the two things that are decisions rather than
 * layout — how a currency amount is written, and what each plan state *says*.
 *
 * ## Why it is here rather than in src/types.ts or in src/billing/
 *
 * The same reason `AdminUser` is in src/admin.ts: `types.ts` is the vocabulary
 * the reading app speaks in — articles, blocks, threads, the shelf — and this is
 * one page's answer, read by one component and one route. It also imports
 * nothing at all, which is what lets the browser have it without dragging a
 * Stripe client or a database pool into the bundle.
 *
 * **And it is flat rather than `src/billing/plan.ts`, because the client may
 * only import a shared module directly under `src/`** — the rule and the list
 * are in tests/client-imports.test.ts, and it is a good rule: the rest of
 * `src/billing/` constructs Stripe clients and opens database transactions, and
 * the one file the browser may have has to be visibly outside that. Written
 * down because the file was in `src/billing/` for an hour and the name looks
 * like a whim without it.
 *
 * ## The lapsed arm carries no `used`, and that is the point
 *
 * The free allowance is **lifetime and includes paid months** (Greg,
 * 2026-09-03), so a reader who took forty articles on Reader and cancelled is
 * permanently past the free three. That is the policy. But rendering it as
 * *"40 of 3 used"* reads as arithmetic going wrong rather than as a rule, and
 * the refusal message has had a third sentence for exactly this since the wall
 * went up (`pay-lapsed`, src/messages.ts).
 *
 * So `lapsed` is its own arm of the union and it has **no `used` field**: the
 * page cannot render the forbidden shape, because the number is not there to
 * render. `remaining` is what it gets instead, and `remaining` can never exceed
 * `limit`. A comment asking the next person not to print it would have been the
 * weaker version of this.
 */

/** One tier a reader may buy right now — a row of `billing_tiers`, trimmed. */
export interface TierOffer {
  readonly id: string;
  /** `Spideryarn Reader` — the product name off the row, never derived here. */
  readonly name: string;
  readonly description: string;
  readonly ingestsPerPeriod: number;
  /** Currency code → amount in that currency's smallest unit. At least one. */
  readonly amounts: Readonly<Record<string, number>>;
}

/**
 * What this reader's allowance is right now.
 *
 * A discriminated union rather than a bag of optionals, for the reason
 * `Entitlement` in tiers.ts is one: the states genuinely differ in what they
 * *have*. A free account has no renewal date, an exempt one has no count, and a
 * lapsed one deliberately has no `used` — see the header.
 *
 * `used` includes reservations still in flight, because that is what the wall
 * counts (`refusalFor` in src/store/pg-billing.ts). A page that counted only
 * settled successes would tell somebody they had a slot left and then watch the
 * server refuse them.
 */
export type ReaderPlan =
  /**
   * Quota is not enforced on this deployment at all — a filesystem store.
   *
   * Not an error and not a plan: docs/project/billing.md § *Billing is a
   * Postgres feature*. It cannot happen in production, where src/store/index.ts
   * refuses to boot on a filesystem store, so this is what a developer sees.
   */
  | { readonly kind: "off" }
  /** An administrator. No slot is ever taken, so there is no count to show. */
  | { readonly kind: "exempt" }
  /**
   * The row says subscribed and its stored period does not contain now.
   *
   * The admission path resyncs from Stripe once and answers 503 if that does not
   * help. **This page does neither**: a read of your own profile should not make
   * an outbound call to Stripe, and guessing in either direction would be a
   * number rather than an answer. It says it does not know.
   */
  | { readonly kind: "unknown" }
  | { readonly kind: "free"; readonly limit: number; readonly used: number }
  /** Had a subscription; does not have an entitled one. See the header. */
  | { readonly kind: "lapsed"; readonly limit: number; readonly remaining: number }
  | {
      readonly kind: "paid";
      readonly tierId: string;
      readonly tierName: string;
      readonly limit: number;
      readonly used: number;
      /** ISO. When the allowance starts again — or when it runs out, if cancelling. */
      readonly periodEnd: string;
      /** Cancelled at the end of the period, so `periodEnd` is an ending. */
      readonly cancelling: boolean;
    };

/** The whole of `GET /api/billing/usage`. */
export interface BillingSummary {
  readonly plan: ReaderPlan;
  /** What may be bought, cheapest first. Empty on a deployment with no Stripe. */
  readonly offers: readonly TierOffer[];
  /**
   * Whether *Manage billing* can do anything.
   *
   * `POST /api/billing/portal` refuses an owner with no Stripe customer (409,
   * `pay-none`), because there is no billing history to manage. A button that
   * can only produce that refusal is worse than no button, so the page asks
   * first — and it asks the same question the route decides on, which is whether
   * `billing_accounts.stripe_customer_id` is set.
   *
   * **So it turns true when somebody first presses *Upgrade*, not when they
   * pay**, and that follows from the ordering guarantee rather than from
   * anything here: `startCheckout` commits the customer→owner mapping *before*
   * a Checkout Session exists, because a session that could take money before
   * the webhook could find its owner is somebody paying for nothing
   * (src/billing/checkout.ts). Abandon that Checkout and the Portal opens on a
   * customer with no payment method and no invoices — which is empty rather
   * than wrong, and is the honest state of an account that started to subscribe
   * and stopped. Observed in the browser on 2026-09-03 and written down here,
   * because it looks like a bug for exactly as long as it takes to remember the
   * ordering.
   */
  readonly manageable: boolean;
  /**
   * Whether pressing *Upgrade* would actually sell them something.
   *
   * **`startCheckout` refuses while a subscription that is not over exists**,
   * and sends the reader to the Portal instead (src/billing/checkout.ts §
   * *Over is a shorter list than unentitled*). `TERMINAL_STATUSES` is `canceled`
   * and `incomplete_expired` and nothing else — so `unpaid`, `past_due` and
   * `incomplete` are all *unentitled and still not over*, and an account in one
   * of them would be shown tier cards whose only outcome is the Portal.
   *
   * **The page cannot work that out from `plan`**, which is what made this a
   * field rather than a derivation: `lapsed` covers both a `canceled`
   * subscription (sell them a new one) and an `unpaid` one (send them to pay the
   * invoice they have), and `unknown` is a live subscription whose dates we
   * cannot read. GPT Sol, 2026-09-03 — the first version hid the cards only for
   * `paid`, which is the smallest of the four cases that need hiding.
   */
  readonly canCheckout: boolean;
}

/* ------------------------------------------------------------- the words -- */

/** What the page prints for a plan: one line, and a second when there is more. */
export interface PlanCopy {
  readonly headline: string;
  readonly detail: string | null;
}

/**
 * The sentences for each plan state.
 *
 * **Here rather than in the component**, so that the one rule that matters can
 * be tested without a DOM: a lapsed reader is never shown *"40 of 3"*. The type
 * already makes that unbuildable; this is where it is also demonstrated
 * (tests/billing-plan.test.ts).
 *
 * It agrees with `ingestQuotaReached` in src/messages.ts rather than inventing a
 * second wording — that function is what the API says when it refuses, and a
 * page that told a different story about the same rule would be the second
 * source of truth this repo keeps writing postmortems about. What it does not
 * do is *import* those strings: they are refusals, written to be read after
 * something failed, and these are a read-out of a state that is usually fine.
 */
export function describePlan(plan: ReaderPlan): PlanCopy {
  switch (plan.kind) {
    case "off":
      return {
        headline: "No plan on this copy of the app",
        detail:
          "This copy is not running against Postgres, so nothing is metered and nothing can be " +
          "bought. You will only ever see this on a development machine.",
      };
    case "exempt":
      return {
        headline: "Administrator — no limit",
        detail: "Adding an article never takes a slot on this account, so there is nothing to count.",
      };
    case "unknown":
      return {
        headline: "We could not confirm your plan just now",
        detail:
          "Your subscription's dates are out of step with Stripe. Reading is unaffected, and this " +
          "usually sorts itself out within a minute — reload the page to look again.",
      };
    case "free":
      return {
        headline: `Free — ${plan.used} of ${plan.limit} articles used`,
        detail:
          plan.used >= plan.limit
            ? "That is the whole free allowance, which is a lifetime one rather than a monthly " +
              "one. Everything you have added stays exactly where it is, and reading is never " +
              "limited — a subscription is what adds more."
            : `The free allowance is ${plan.limit} articles for the lifetime of the account, not ` +
              "per month. Reading is never limited.",
      };
    case "lapsed":
      /* **No `used`, and no ratio wider than the limit.** See the header: this
         is the one rendering the policy would otherwise make look like a bug. */
      return plan.remaining > 0
        ? {
            headline: "Your plan has ended",
            detail:
              `You are back on the free allowance, with ${plan.remaining} of ${plan.limit} ` +
              "left. Everything you added while subscribed is still here, and reading is " +
              "unaffected — resubscribing is what adds more.",
          }
        : {
            headline: "Your plan has ended",
            detail:
              "The free allowance is already spent, so no more articles can be added. Everything " +
              "you have added is still here and reading is unaffected — resubscribing is what " +
              "adds more.",
          };
    case "paid": {
      const when = readableDate(plan.periodEnd);
      return {
        headline: `${plan.tierName} — ${plan.used} of ${plan.limit} articles this month`,
        detail: plan.cancelling
          ? `Cancelled: this plan runs until ${when ?? "the end of the period"}, and then the ` +
            "account goes back to the free allowance. Nothing you have added is affected."
          : `The allowance starts again on ${when ?? "your renewal date"}.`,
      };
    }
  }
}

/**
 * A date a reader would write — `3 October 2026`.
 *
 * **UTC**, so the sentence does not change depending on where the server is
 * standing; the boundary is Stripe's and it is not to the hour anyway. The same
 * rule and the same format `ingestQuotaReached` uses, so the page and the
 * refusal name the same day.
 *
 * `null` for anything unparseable, so a caller writes around it rather than
 * printing `Invalid Date` at somebody.
 */
export function readableDate(iso: string): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * An amount in a currency's smallest unit, written the way a price is written.
 *
 * **How many minor units make a major one is asked of `Intl`, not of a list.**
 * Stripe stores JPY in whole yen and USD in cents, and a hardcoded ÷100 would
 * price a yen tier at a hundredth of itself — a currency nobody has added yet,
 * which is exactly when the wrong constant gets written. `resolvedOptions()`
 * knows, and it stays right when somebody adds a row for a currency this file
 * has never heard of.
 *
 * Trailing zeros are dropped, so `$10` rather than `$10.00`: the tiers are whole
 * units by convention (docs/project/billing.md § *Why three currencies*), and a
 * tier priced at 9.99 still shows both decimals.
 *
 * A code `Intl` refuses falls back to the code and two decimals, which is ugly
 * and readable — rather than throwing inside a render.
 */
export function formatAmount(currency: string, minorUnits: number): string {
  const code = currency.toUpperCase();
  try {
    const money = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    });
    const digits = money.resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(minorUnits / 10 ** digits);
  } catch {
    return `${code} ${(minorUnits / 100).toFixed(2)}`;
  }
}

/**
 * Every price a tier is sold at, in one string — `$10 · £8 · €9`.
 *
 * All of them rather than one, because **Stripe picks the currency by the
 * customer's location at Checkout** (`currency_options`) and this page cannot
 * know which they will be shown. Guessing from the browser's locale would print
 * a number we then do not charge, which is worse than three numbers we do.
 *
 * Sorted by currency code so two readers of the same tier see the same order.
 */
export function describeAmounts(amounts: Readonly<Record<string, number>>): string {
  return Object.keys(amounts)
    .sort()
    .map((currency) => formatAmount(currency, amounts[currency] as number))
    .join(" · ");
}
