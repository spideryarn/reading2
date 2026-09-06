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
 *
 * ## Every number here is a whole article, and none of them is a half-unit
 *
 * A public article costs half (src/billing/half-units.ts), so `used` and `limit`
 * are no longer two ends of one ratio: eight articles, six of them public, is
 * ten half-units against a free budget of six. **No rounding rule fixes that** —
 * `ceil(5/2)` says *"3 of 3 used"* while the wall still admits one, and `floor`
 * says *"2 of 3"* while two and a half are gone.
 *
 * So the wire carries **integer counts that add up** and never a half-unit:
 * `limit` is the allowance the website markets, `used` is how many ingests are
 * counted against it, `sharedHalfPrice` is how many of those are cheap right
 * now, and `atLimit` is the server's own answer to *did the wall refuse* rather
 * than a comparison this file reconstructs. That last one is why there is a
 * fourth field instead of a `used >= limit` here: the wall is in
 * src/store/pg-billing.ts and a second spelling of it on the page is how a page
 * and a route come to disagree about whether somebody may add an article.
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
  | {
      readonly kind: "free";
      readonly limit: number;
      readonly used: number;
      /**
       * How many of `used` are currently public, and therefore counting half.
       *
       * Zero for almost everybody, and the copy says nothing about sharing when
       * it is — a discount nobody has taken is not news.
       */
      readonly sharedHalfPrice: number;
      /** The wall's own answer, not a comparison of the two numbers above. */
      readonly atLimit: boolean;
      /**
       * **Sharing something this account has added would get it back under the
       * wall** — the server's answer, and absent whenever it would not.
       *
       * The page said it unconditionally until 2026-09-05, on the reasoning
       * that any private article is a private article. Two readers it was false
       * for: the one whose charged rows all predate `ingest_events.article_id`,
       * which is every row charged before that day and cannot be cheapened at
       * all; and the one who has unshared their way to twelve half-units
       * against a budget of six, where sharing everything they own still would
       * not do it. It cannot be worked out from `used` and `sharedHalfPrice` —
       * `sharingWouldMakeRoom` in src/store/pg-billing.ts is the query, asked
       * only when `atLimit` is true. GPT Sol, 2026-09-05.
       */
      readonly sharingMakesRoom?: true;
    }
  /**
   * Had a subscription; does not have an entitled one. See the header.
   *
   * `remaining` is a count of **further private articles**, which is exactly the
   * wall's own answer rather than a rounded ratio — `privateHeadroom` in
   * src/billing/half-units.ts says why the division in it is exact.
   */
  | { readonly kind: "lapsed"; readonly limit: number; readonly remaining: number }
  | {
      readonly kind: "paid";
      readonly tierId: string;
      readonly tierName: string;
      readonly limit: number;
      readonly used: number;
      /** As `free`'s. */
      readonly sharedHalfPrice: number;
      /** As `free`'s. */
      readonly atLimit: boolean;
      /** ISO. When the allowance starts again — the renewal, not the ending. */
      readonly periodEnd: string;
      /**
       * ISO, or `null` when nothing is scheduled to end. **One field, not two
       * flags** — see `planEndsAt`.
       */
      readonly endsAt: string | null;
    };

/**
 * **What this reader may buy, and which door a press goes through.**
 *
 * A discriminated union over a **non-empty** list, and it replaced two fields —
 * `offers: TierOffer[]` and `canCheckout: boolean` — on 2026-09-04. The reason
 * is not tidiness: those two could disagree, and on the live account they always
 * did. A paying Reader was sent `canCheckout: false` beside `offers` listing
 * Reader *and* Researcher, so the page had a catalogue it was forbidden to draw
 * a button on, and the reader was drawn nothing at all
 * (docs/project/billing.md § *Reader → Researcher*). One field cannot hold that
 * state: the tiers a reader may buy and the fact that they may buy some are the
 * same fact, said once.
 *
 * **The three routes not taken**, since the alternative was put as a binary:
 *
 * - *Change what `canCheckout` means*, from "has no open subscription" to "has
 *   somewhere to go". Every reader of it — two components, the buy-intent
 *   effect, three test files, and the half-dozen comments and docs that argue
 *   from it — keeps compiling and quietly means something else. A name whose
 *   meaning moves under its readers is the fault this repo keeps writing
 *   postmortems about.
 * - *Add `canUpgrade` beside it.* Two booleans that both answer *may this reader
 *   buy something* is two things to keep in step, and the day they disagree
 *   neither is wrong on its face.
 * - *Filter `offers` and leave `canCheckout` alone.* The list would then be
 *   right and the boolean still false for a Reader, so every call site would
 *   need to know which of the two to believe.
 *
 * Deleting both names is what makes the compiler walk every call site, which is
 * the whole benefit of the change and the reason it is not a rename.
 *
 * **Non-empty on purpose.** `readonly [TierOffer, ...TierOffer[]]` is what makes
 * *"there is something to buy, and here are none of them"* unbuildable — the
 * state a filtered list plus a boolean can always reach. A caller that has
 * narrowed to `checkout` or `switch` may draw its cards without asking whether
 * the list is empty.
 *
 * `Tier` is a parameter so that the decision itself can be made over
 * `TierRow` — the database's shape, which is where the ordering lives
 * (`tiersToOffer`, src/billing/tiers.ts) — and mapped to the wire's `TierOffer`
 * afterwards, rather than the same four arms being written out twice.
 */
export type Purchase<Tier = TierOffer> =
  /**
   * Nothing is on sale to this reader, and nothing needs saying about it.
   *
   * A deployment with no Postgres, a catalogue where no tier has a Stripe price,
   * and — deliberately — an **open subscription that entitles nothing**:
   * `unpaid`, `incomplete`, or a live one whose stored period we cannot read.
   * That last group is today's behaviour kept exactly: they may not start a
   * second Checkout Session, and what they need is the Portal, which
   * `manageable` already offers them.
   */
  | { readonly kind: "none" }
  /**
   * They are on the largest tier sold, so there is nowhere above them.
   *
   * Its own arm rather than `none`, because it is the one case with something
   * to say: a page that draws no button here should say why, and *"nothing on
   * sale"* and *"you are already at the top"* are different sentences.
   */
  | { readonly kind: "top" }
  /** No open subscription: a press opens a hosted Stripe Checkout Session. */
  | { readonly kind: "checkout"; readonly tiers: readonly [Tier, ...Tier[]] }
  /**
   * An open, entitled subscription and something larger to move to: a press
   * opens the hosted Customer **Portal**, not a Checkout Session.
   *
   * `startCheckout` (src/billing/checkout.ts) already forces that and is right
   * to — Reader and Researcher are separate Stripe *Products*, so Stripe cannot
   * schedule a change between their prices and the Portal's `subscription_update`
   * is the mechanism. The kind is on the wire so that the **label** can say so:
   * a button that reads *Upgrade* and lands on somebody else's page, where the
   * plan must be chosen again and confirmed, has told the reader the wrong thing
   * about what pressing it does.
   *
   * **`from` is here because the sentence beside the button is not one
   * sentence.** A switch out of a free trial does something else entirely —
   * `switchingPlan` has the three claims and why each of them is false for a
   * trialling reader — and a page holding only the tiers would have no way to
   * tell. Carrying it on the arm rather than deriving it from `plan` is the same
   * rule as the rest of this union: the server knows the subscription's status
   * and the browser does not.
   */
  | {
      readonly kind: "switch";
      readonly tiers: readonly [Tier, ...Tier[]];
      readonly from: SwitchFrom;
    };

/**
 * **What the subscription being switched *away from* is**, because a switch does
 * two different things and describes itself in two different sentences.
 *
 * Not a boolean: `trialing: false` on a `past_due` subscription would be a true
 * statement that says nothing about what the reader is actually on, and the day
 * a third case turns up — a paused subscription, say — a boolean has to be
 * replaced rather than extended. `switchingPlan` switches on it exhaustively, so
 * adding an arm makes the compiler ask for the words.
 */
export type SwitchFrom =
  /**
   * An ordinary paid period — `active`, or `past_due` and still being dunned.
   * The Portal's `always_invoice` / `billing_cycle_anchor: "unchanged"` pair
   * does what `switchingPlan` says it does.
   */
  | "paid"
  /**
   * A free **trial**. `trialing` is an entitled status (`ENTITLED_STATUSES`,
   * src/billing/tiers.ts) and the Portal is configured `trial_update_behavior:
   * "end_trial"`, so a switch from here ends the trial rather than adjusting a
   * paid month.
   */
  | "trial";

/** The tiers a `Purchase` is offering, or none — the list, without the door. */
export function purchasableTiers<Tier>(purchase: Purchase<Tier>): readonly Tier[] {
  return purchase.kind === "checkout" || purchase.kind === "switch" ? purchase.tiers : [];
}

/**
 * **Is this really a `Purchase`?** — asked of the body, because the type is a
 * claim about a value nothing has checked.
 *
 * `readJson<BillingSummary>` is `JSON.parse(text) as T` and no more
 * (src/web/lib/api.ts), so every guarantee above — the discriminant, and the
 * non-empty tuple in particular — holds only as far as the server is the version
 * this bundle was built against. During a deploy it is not: a browser holding
 * yesterday's client gets today's `/api/billing/usage`, and the other way round
 * for the minutes a rollback takes. A body carrying the `canCheckout`/`offers`
 * pair this union replaced on 2026-09-04 has no `purchase` at all, and
 * `summary.purchase.kind` on `undefined` throws inside a render — which takes
 * the whole billing area down rather than showing the plan it did receive.
 * GPT Sol, 2026-09-04.
 *
 * **A guard, not a schema library.** It checks exactly what the type promises
 * and the wire cannot keep: that the discriminant is one of the four, that the
 * two arms carrying tiers carry at least one, and that a `switch` says which
 * kind it is. The tiers themselves are not walked — a card missing its `amounts`
 * renders badly, and rendering badly is not the failure this exists for.
 *
 * `from` is in the list rather than defaulted because defaulting it is the bug:
 * a `switch` arriving without one from a server that predates it would be shown
 * the paid sentence, which is the false-copy defect this same review found. A
 * plan card with a line saying it may be out of date is the better failure.
 *
 * The caller throws on `false`, so an unrecognised body lands in the billing
 * read's existing error path: the plan already on screen stays, with a line
 * saying it may be out of date (src/web/useBilling.ts).
 */
export function isPurchase(value: unknown): value is Purchase {
  if (typeof value !== "object" || value === null) return false;
  const { kind, tiers, from } = value as { kind?: unknown; tiers?: unknown; from?: unknown };
  if (kind === "none" || kind === "top") return true;
  if (kind !== "checkout" && kind !== "switch") return false;
  if (!Array.isArray(tiers) || tiers.length === 0) return false;
  return kind === "checkout" || from === "paid" || from === "trial";
}

/** The whole of `GET /api/billing/usage`. */
export interface BillingSummary {
  readonly plan: ReaderPlan;
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
   * What may be bought, cheapest first, and which door a press goes through.
   *
   * **The page cannot work this out from `plan`**, which is what makes it a
   * field rather than a derivation: `lapsed` covers both a `canceled`
   * subscription (sell them a new one) and an `unpaid` one (send them to pay the
   * invoice they have), and `unknown` is a live subscription whose dates we
   * cannot read. GPT Sol, 2026-09-03. Nor from `offers`, which is why that list
   * is inside the union rather than beside it — see `Purchase`.
   */
  readonly purchase: Purchase;
}

/* -------------------------------------------------- when the plan ends -- */

/**
 * **When this subscription ends, from the two facts Stripe keeps about it.**
 *
 * Stripe says *cancel at period end* in two unrelated ways, and which one you
 * get depends on how the reader cancelled:
 *
 * - through the hosted **Customer Portal**: `cancel_at` is a timestamp and
 *   `cancel_at_period_end` stays **`false`**;
 * - through the **API**: `cancel_at_period_end` goes `true`, and `cancel_at`
 *   may be null.
 *
 * Reading only the boolean is why a real cancellation on 2026-09-03 was never
 * shown to the reader who made it — docs/project/billing.md § *The first live
 * sale*. Both raw facts are therefore stored, and this is the **only** place
 * they become an answer:
 *
 *     endsAt = cancelAt ?? (cancelAtPeriodEnd ? currentPeriodEnd : null)
 *
 * **One derived value reaches the browser, never two flags.** Two
 * independently-interpreted cancellation fields on the wire is how a page and a
 * route come to disagree about whether somebody is cancelling — and it would be
 * the same class of bug again, one field quietly meaning less than it looks.
 * GPT Sol, 2026-09-03.
 *
 * `cancelAt` wins where both are set, because it is a date and the boolean is
 * only a claim about one. It is also not always the period end: Stripe permits
 * an ending scheduled for any future moment, and the date is the thing the
 * reader is owed either way.
 *
 * Pure and dateless in its inputs' provenance, so it is testable without a
 * database — tests/billing-plan.test.ts.
 */
export function planEndsAt(cancellation: {
  readonly cancelAt: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodEnd: Date | null;
}): Date | null {
  if (cancellation.cancelAt) return cancellation.cancelAt;
  return cancellation.cancelAtPeriodEnd ? cancellation.currentPeriodEnd : null;
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
/**
 * *"One of them is public"* / *"Five of them are public"* — a count and the verb
 * that agrees with it.
 *
 * Small enough to inline twice and not small enough to get right twice: the
 * singular is the half a copy-paste loses.
 */
function sharedClause(shared: number): string {
  return shared === 1 ? "One of them is public" : `${shared} of them are public`;
}

/**
 * **Is `used of limit` still a ratio?**
 *
 * It is one only while every counted ingest costs a whole article's worth *and*
 * there are no more of them than the allowance sells. The second half is the one
 * that was missing until 2026-09-05: unshare six public articles on a free
 * account and `sharedHalfPrice` goes back to zero while `used` stays at six, so
 * the page printed *"6 of 3 articles used"* — the exact rendering this file's
 * header forbids, arrived at from the other direction. GPT Sol found it.
 */
function isRatio(plan: { used: number; limit: number; sharedHalfPrice: number }): boolean {
  return plan.sharedHalfPrice === 0 && plan.used <= plan.limit;
}

/**
 * **More articles than the allowance sells, and none of them public now.**
 *
 * The mechanism rather than the history: we know the discount is what let them
 * be added, and we do not know from these three numbers which ones were public
 * when. Nothing here divides — see the header.
 */
function nonePublicNow(limit: number): string {
  return (
    `A public article counts as half an article, which is how more than ${limit} can be added. ` +
    "None of them is public now, so each counts in full. "
  );
}

/**
 * What the count and the allowance mean when they are not a ratio — the shared
 * clause, plus the *"that is how they fit"* half **only when they do fit**.
 *
 * They stop fitting the moment somebody unshares: five articles with one still
 * public is nine half-units against a budget of six, and *"that is how 5 fit an
 * allowance of 3"* is then a sentence about arithmetic that did not happen.
 */
function howTheyStand(plan: { used: number; limit: number; sharedHalfPrice: number }): string {
  if (plan.sharedHalfPrice === 0) return nonePublicNow(plan.limit);
  /* The same `× 2` `/admin/users` does, and for the same reason: the enforcement
     budget is in half-units, the page is handed integer counts, and neither end
     has a better claim on the multiplication than the other. */
  const fits = plan.used * 2 - plan.sharedHalfPrice <= plan.limit * 2;
  return (
    `${sharedClause(plan.sharedHalfPrice)}, which counts as half an article each` +
    (fits ? ` — that is how ${plan.used} fit an allowance of ${plan.limit}. ` : ". ")
  );
}

/**
 * The free account's two shapes, lifted out of `describePlan` so that the switch
 * stays a switch — this is the only arm with three decisions in it.
 */
function freeCopy(plan: Extract<ReaderPlan, { kind: "free" }>): PlanCopy {
  /* **The way out of a spent allowance, and it is conditional.** Offering
     sharing to somebody who has already shared everything — or whose rows all
     predate the discount, or who is so far over that sharing everything would
     not do it — is the false offer `ingestQuotaReached`'s conditional sentence
     exists to avoid, one surface along. The server answers it; this file must
     not guess (`sharingMakesRoom`). */
  const wayOut = plan.sharingMakesRoom
    ? "Sharing more of what you have added makes room, and so does a subscription. "
    : "A subscription is what adds more. ";
  /* **Two headlines, because one ratio cannot be true of both accounts.** While
     `used` and `limit` are the two ends of one ratio this is the sentence it has
     always been. Once they are not — six public articles inside an allowance of
     three, or six unshared ones outside it — the second form states the count
     and the allowance as two facts rather than as a fraction that would read as
     arithmetic going wrong. Neither form divides anything: see the header. */
  if (isRatio(plan)) {
    return {
      headline: `Free — ${plan.used} of ${plan.limit} articles used`,
      detail: plan.atLimit
        ? "That is the whole free allowance, which is a lifetime one rather than a monthly " +
          `one. ${wayOut}Everything you have added stays exactly where it is, and reading ` +
          "is never limited."
        : `The free allowance is ${plan.limit} articles for the lifetime of the account, ` +
          "not per month. Reading is never limited.",
    };
  }
  return {
    headline: `Free — ${plan.used} articles added, on an allowance of ${plan.limit}`,
    detail:
      howTheyStand(plan) +
      (plan.atLimit
        ? "The allowance is a lifetime one rather than a monthly one, and it is spent. " +
          wayOut +
          "Everything you have added stays where it is, and reading is never limited."
        : "The allowance is for the lifetime of the account rather than per month. " +
          "Reading is never limited."),
  };
}

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
      return freeCopy(plan);
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
      /* **The ending, when there is one, and the renewal otherwise** — two
         different dates asked of two different fields, so a plan that ends
         before its period does cannot be described as renewing. */
      const ends = plan.endsAt === null ? null : readableDate(plan.endsAt);
      /* The same two shapes as `free`, and for the same reason — including the
         account that unshared everything, whose forty against an allowance of
         twenty is not a ratio either. */
      const shared = isRatio(plan)
        ? ""
        : plan.sharedHalfPrice === 0
          ? nonePublicNow(plan.limit)
          : `${sharedClause(plan.sharedHalfPrice)}, which counts as half an article each. `;
      return {
        headline: isRatio(plan)
          ? `${plan.tierName} — ${plan.used} of ${plan.limit} articles this month`
          : `${plan.tierName} — ${plan.used} articles this month, on an allowance of ${plan.limit}`,
        detail:
          shared +
          (plan.endsAt !== null
            ? /* **Says the date, and then says what does not change.** The
                 promise this product makes is that reading what you have
                 already added is never gated (docs/project/vision.md), so the
                 sentence a cancelling reader most needs is the second one. */
              `Your plan ends on ${ends ?? "the end of the period"}, and the account then goes ` +
              "back to the free allowance. Everything you have added stays where it is, and " +
              "reading is never limited."
            : `The allowance starts again on ${readableDate(plan.periodEnd) ?? "your renewal date"}.`),
      };
    }
  }
}

/* ------------------------------------------- moving between paid plans -- */

/**
 * **What pressing a *Switch plan* button actually does**, said before it is
 * pressed rather than discovered on somebody else's page.
 *
 * A subscriber's press does not open a Checkout page: `startCheckout` returns
 * the hosted **Customer Portal** to anybody holding an open subscription, and is
 * right to — Reader and Researcher are separate Stripe *Products*, so the
 * Portal's `subscription_update` is the mechanism and there is no checkout to
 * send them to (docs/project/billing.md § *Reader → Researcher*). The plan is
 * then chosen and confirmed **there**, which is a step the button cannot skip,
 * so the sentence beside it says so. This is the same habit as *"Manage billing"*
 * naming Stripe: the limit of the thing, out loud.
 *
 * **Every clause is a field somebody set on purpose**, and all three are checked
 * by `stripe:check` on every run (`portalDrift`, scripts/stripe-setup.ts):
 * `proration_behavior: "always_invoice"` is the invoice, `billing_cycle_anchor:
 * "unchanged"` is the unmoved renewal, and the allowance clause is
 * `nextQuotaAdjustment` — which prorates, so *"the larger allowance starts now"*
 * would have been false. Upgrading on day 27 of 30 takes a Reader to 33, not to
 * 150.
 *
 * One function, shared by `/pricing` and `/profile`, because two tellings of one
 * mechanism is how two pages come to describe it differently.
 *
 * ## Every one of those three clauses is false out of a trial
 *
 * GPT Sol, 2026-09-04, reviewing this file. `trialing` is an entitled status
 * (`ENTITLED_STATUSES`, src/billing/tiers.ts), so a trialling reader reaches the
 * `switch` arm — and the Portal is configured `trial_update_behavior:
 * "end_trial"`, which means the press does not adjust a paid month at all:
 *
 * - **"invoices the difference"** — there is no difference to invoice. Nothing
 *   has been paid, so the trial ends and the new plan is billed in full.
 * - **"your renewal date does not move"** — the trial period ends at the moment
 *   of the switch instead of at the trial's end, so the current period does
 *   move. `billing_cycle_anchor: "unchanged"` governs the *price* change; it does
 *   not keep a trial running.
 * - **"added for the part of the month that is left"** — precisely backwards.
 *   Because the incoming period start is no longer the stored one,
 *   `nextQuotaAdjustment` (src/billing/quota-adjustment.ts) takes its
 *   *"a different period is not a plan change"* branch and writes **no** delta,
 *   so the reader gets the whole of the new allowance. Pinned by
 *   tests/billing-quota-adjustment.test.ts so the sentence below cannot quietly
 *   stop being true.
 *
 * **We do not sell trials** — nothing in scripts/stripe-setup.ts and nothing in
 * the Checkout Session creates one — so this is a state that should not occur
 * and is not prevented. Two ways to make it honest, and the one not taken:
 *
 * - *Refuse the `switch` arm to a trialling reader* and leave them the Portal.
 *   It removes a capability from a state we did not intend to create, on the
 *   strength of copy rather than of anything about the account: the switch
 *   itself is fine, it is the sentence that was wrong. It would also leave the
 *   reader with the Portal's own switch menu and no warning at all, which is
 *   worse than the wrong warning it replaced.
 * - **Say what actually happens**, which is this. The words below are only the
 *   claims that hold whatever Stripe does with the anchor, and the trial arm
 *   ends by pointing at the confirmation screen — where the amount and the dates
 *   are shown by somebody who knows them exactly. Greg's call, 2026-09-04.
 */
export function switchingPlan(from: SwitchFrom): string {
  const opens =
    "Changing plan happens on Stripe's own billing page: this opens it, and you choose the " +
    "plan and confirm it there. ";
  switch (from) {
    case "paid":
      return (
        opens +
        "Stripe invoices the difference straight away, your renewal date does not move, and " +
        "the larger allowance is added for the part of the month that is left."
      );
    case "trial":
      /* **Only claims that survive whatever Stripe does with the anchor.** The
         trial ending, the full invoice and the un-prorated allowance all follow
         from `end_trial` and from the period start moving; the exact new dates
         do not, and are Stripe's to show rather than ours to promise. */
      return (
        opens +
        "Switching ends your free trial: Stripe bills you for the new plan straight away " +
        "rather than invoicing a difference, your billing period restarts from that moment, " +
        "and you get the whole of the new allowance rather than a part-month share. Stripe " +
        "shows the amount and the dates before you confirm."
      );
  }
}

/**
 * There is nothing above them to move to — the sentence that stops the top tier
 * reading as a page that forgot to draw its buttons.
 *
 * **A sentence rather than an empty gap**, which is what a filtered offer list
 * leaves behind: on the largest tier every card is one they may not buy, so
 * without this a Researcher gets prices, no button, and no reason given.
 *
 * `tierName` is `ReaderPlan`'s own `tierName` — the product name off the row, so
 * it says the same word as the headline above it — and `null` is the
 * administrator, who can hold a subscription while their plan reads *exempt* and
 * therefore has no tier name to print.
 */
export function noHigherPlan(tierName: string | null): string {
  return tierName === null
    ? "You are on the largest plan we sell, so there is nothing above it to move to."
    : `${tierName} is the largest plan we sell, so there is nothing above it to move to.`;
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
  return readableDay(new Date(at));
}

/**
 * The same day, for a caller that already holds a `Date`.
 *
 * **This is the format itself, and it is deliberately the only copy of it.** The
 * sentence above — *"the same rule and the same format `ingestQuotaReached`
 * uses, so the page and the refusal name the same day"* — was, until 2026-09-06,
 * the entire mechanism keeping that true: `ingestQuotaReached` in
 * src/messages.ts had its own `toLocaleDateString("en-GB", …)` with the same
 * four options written out again, and each was tested separately against a
 * hardcoded string, so neither test could ever have noticed the other changing.
 * A reader refused an ingest and then opening /profile would have been shown two
 * spellings of one date. Two sweeps recorded the pair before it was closed —
 * docs/plans/260906h-improve-the-codebase-fourth-sweep.md § T1.5.
 *
 * `Date` rather than an ISO string because that is what the quota carries, and
 * routing it through `readableDate` would mean `toISOString()` on a value that
 * might not be a valid date — which throws, where the old inline call merely
 * printed `Invalid Date`. Trading a wrong word for an exception is not a fix, so
 * the two entry points differ in what they accept and agree on everything else.
 */
export function readableDay(at: Date): string {
  return at.toLocaleDateString("en-GB", {
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
