/**
 * **What `/profile` is told** — this reader's plan, what they have used, and
 * what they could buy.
 *
 * `GET /api/billing/usage`, and the whole of it. The wire shape is in src/billing-plan.ts
 * (pure, so the browser can have it); this is the server half that reads the
 * row, the tiers and the ledger and decides which arm of `ReaderPlan` the
 * account is in.
 *
 * ## Why it is a route of its own rather than a field on `GET /api/reader`
 *
 * `/api/reader` was the obvious host — it is already *the route about the
 * reader* — and it is the wrong one for two reasons:
 *
 * - **It is fetched on every article page.** `useHasProfile` (src/web/useProfile.ts)
 *   asks it with a `?slug=` from six hooks, so a billing field on it would put a
 *   `billing_accounts` read and an `ingest_events` aggregate on the path of
 *   opening an article, for data only `/profile` draws.
 * - **It answers a different question.** That route is about the reader's own
 *   words — the profile text and the per-article purpose — and this is about
 *   what they may do.
 *
 * It is a **GET**, unlike the three routes in checkout.ts, and the difference is
 * the rule those state: those are POSTs because each *creates a Stripe object*.
 * This creates nothing, touches no network, and only reads our own tables — so a
 * prefetch or a reload of it costs nothing and means nothing.
 *
 * ## It never resyncs from Stripe
 *
 * Admission does, once, when the stored period has run out — because it has to
 * decide something. This does not: a page that reads your plan should not make
 * an outbound call, and the honest answer to *the row and the clock disagree* is
 * `unknown` rather than a number picked from the two available wrong ones. The
 * next ingest, the next webhook, or the return from Checkout all resync it.
 */

import { isAdmin } from "../admin.js";
import { log } from "../log.js";
import type { OwnerId } from "../owner.js";
import {
  accountSnapshot,
  atTheWall,
  entitlementFromRow,
  halfUnitsUsed,
  hasLapsed,
  ingestsUsed,
  sharingWouldMakeRoom,
  usageFor,
} from "../store/pg-billing.js";
import type { BillingRow, Stale } from "../store/pg-billing.js";
import { allTiers } from "../store/pg-tiers.js";
import { STORE } from "../store/live.js";
import { planEndsAt } from "../billing-plan.js";
import type { BillingSummary, Purchase, ReaderPlan, TierOffer } from "../billing-plan.js";
import { budgetFor, privateHeadroom } from "./half-units.js";
import { stripeConfigured } from "./stripe.js";
import { subscriptionState, tiersToOffer } from "./tiers.js";
import type { Entitlement, Standing, TierRow } from "./tiers.js";

const logger = log("http");

/** A row of `billing_tiers`, with only what a pricing card needs on it. */
function toOffer(tier: TierRow): TierOffer {
  return {
    id: tier.id,
    name: tier.productName,
    description: tier.description,
    ingestsPerPeriod: tier.ingestsPerPeriod,
    amounts: tier.amounts,
  };
}

/**
 * **Where this owner stands as far as selling is concerned** — the one place
 * that knows both the row and the entitlement, which is what `Standing` says it
 * takes.
 *
 * Pure and exported so the decision can be tested without a database
 * (tests/billing-tiers.test.ts). It used to be four lines inline, and one of
 * them asked the open-subscription question in its own words — a spelling of
 * `subscriptionState` that could and did disagree with `entitlementFromRow`
 * about the same row. See `subscriptionState` for the row that made them
 * disagree and what it would have charged.
 *
 * The order is the order the answers rule each other out:
 *
 * 1. **Nothing open** — sell them anything on the shelf.
 * 2. **A row that contradicts itself** — `unresolved`, so nothing is sold and
 *    nothing is ranked. Logged at `error`, because the schema forbids the row.
 * 3. Otherwise the entitlement names the tier they are on, and a tier we can
 *    find a row for is the only case with something above it to offer.
 */
export function standingFor(
  row: BillingRow | undefined,
  tiers: readonly TierRow[],
  entitlement: Entitlement | Stale,
  ownerId: OwnerId,
): Standing {
  const state = subscriptionState(row);
  if (state.kind === "sellable") return { kind: "unsubscribed" };
  if (state.kind === "contradictory") {
    logger.error(
      { ownerId, why: state.why },
      "this billing row contradicts itself, so nothing is offered for sale beside it",
    );
    return { kind: "unresolved" };
  }

  const stale = "kind" in entitlement;
  /* **The row, not `entitlement.limit`**: a mid-period plan change leaves a
     prorated override in that number, and ranking it would offer a Researcher a
     switch to Researcher. A tier that has vanished from the table between the
     entitlement and this line is `unresolved` too — nothing to rank against
     beats guessing.

     **And an open subscription whose entitlement is free** (`unpaid`,
     `incomplete`) or whose period we cannot read is `unresolved` as well, which
     is exactly what `canCheckout: false` did for those accounts before this was
     tier-aware. See `Standing`. */
  const on = stale || entitlement.tier !== "paid" ? undefined : tiers.find((t) => t.id === entitlement.tierId);
  if (!on) return { kind: "unresolved" };
  /* **What the switch is out of**, read from the raw status here because this is
     where the row is — see `switchingPlan` (../billing-plan.ts) for the three
     claims that are false out of a trial. `trialing` is the only entitled status
     that is not a paid period: `active` and `past_due` are both months somebody
     has been invoiced for. */
  return { kind: "subscribed", on, from: row?.status === "trialing" ? "trial" : "paid" };
}

/**
 * This owner's plan, usage and options.
 *
 * The order of the answers below is the order they rule each other out, and it
 * is not arbitrary:
 *
 * 1. **No Postgres, no quota at all** — `off`. Nothing else would mean anything,
 *    because there is no ledger to count (docs/project/billing.md § *Billing is
 *    a Postgres feature*).
 * 2. **An administrator** — `exempt`, via `isAdmin`: the same hardcoded pair of
 *    uuids the wall uses, so this page and the wall cannot disagree about who is
 *    exempt. They still get the offers and the Portal button, because being
 *    exempt from the *quota* is not being unable to buy or to look at a
 *    subscription they already have.
 * 3. **The stored period does not contain now** — `unknown`. See the header.
 * 4. Otherwise the entitlement decides, and `hasLapsed` separates a reader who
 *    has never subscribed from one whose plan is over.
 */
export async function readBillingSummary(ownerId: OwnerId): Promise<BillingSummary> {
  if (STORE !== "postgres") {
    return { plan: { kind: "off" }, manageable: false, purchase: { kind: "none" } };
  }

  /* Cached for thirty seconds, which is right here for the same reason it is
     right for admission and wrong for `tierToSell`: this is a read-out, not a
     sale. Nothing chargeable is minted from it. */
  const tiers = await allTiers();
  const row = await accountSnapshot(ownerId);
  /* The same question `openPortal` decides on — see `BillingSummary.manageable`. */
  const manageable = Boolean(row?.stripeCustomerId);

  /* **Computed before the administrator branch, and it is pure**, so moving it
     up costs nothing: `entitlementFromRow` reads the row we already have.
     An exempt reader still buys and manages like anybody else — being outside
     the quota is not being unable to hold a subscription — so their standing
     has to be worked out the same way. */
  const entitlement = entitlementFromRow(row, tiers, new Date());
  const stale = "kind" in entitlement;
  /* **The same question `startCheckout` decides on, asked of the same
     function.** It used to be a boolean written out here in its own words, and a
     row it disagreed with `entitlementFromRow` about would have sold a paying
     Reader a second Reader subscription — `subscriptionState` (./tiers.ts) has
     the row and the reasoning. */
  const standing = standingFor(row, tiers, entitlement, ownerId);
  /* **Nothing is on sale when Stripe is not configured**, and this is before
     `tiersToOffer` rather than after it: the tiers can be perfectly good rows in
     Postgres while `STRIPE_SECRET_KEY` is missing or in the wrong mode, and every
     button drawn from them would end in the 503 `orBillingUnavailable` answers
     (./checkout.ts). A card with a price and a button that cannot work is worse
     than no card. GPT Sol, 2026-09-04.

     **`manageable` is deliberately left alone.** It answers a different
     question — *is there billing history to look at* — and turning it off here
     would hide the Portal link from somebody whose subscription is real and
     whose deployment is merely misconfigured. Both buttons fail the same way
     today; only one of them is an offer to sell something. */
  const choice = stripeConfigured()
    ? tiersToOffer(tiers, standing)
    : ({ kind: "none" } satisfies Purchase<TierRow>);
  /* The rows become the wire's trimmed shape here and nowhere else. The tuple is
     rebuilt by hand rather than `.map`ped, because `map` returns an array and
     the non-empty guarantee is the point of the type. */
  const offered = (rows: readonly [TierRow, ...TierRow[]]): readonly [TierOffer, ...TierOffer[]] => [
    toOffer(rows[0]),
    ...rows.slice(1).map(toOffer),
  ];
  const purchase: Purchase =
    choice.kind === "switch"
      ? { kind: "switch", tiers: offered(choice.tiers), from: choice.from }
      : choice.kind === "checkout"
        ? { kind: "checkout", tiers: offered(choice.tiers) }
        : choice;

  const summary = (plan: ReaderPlan): BillingSummary => ({ plan, manageable, purchase });

  if (isAdmin(ownerId)) return summary({ kind: "exempt" });

  if (stale) return summary({ kind: "unknown" });

  const usage = await usageFor(ownerId, entitlement);
  /* **In-flight counts as used**, because it counts at the wall (`refusalFor` in
     src/store/pg-billing.ts). A page that showed only settled successes would
     say a slot was free and then watch the server refuse it.

     **Three integers and no half-units**, which is the rule ../billing-plan.ts
     states at length: `used` is a count of ingests, `sharedHalfPrice` is how
     many of them are cheap right now, and whether the wall would refuse is asked
     of the wall rather than reconstructed from the pair. */
  const used = ingestsUsed(usage);
  const counted = {
    used,
    sharedHalfPrice: usage.chargedHalfPrice,
    atLimit: atTheWall(entitlement, usage),
  };

  if (entitlement.tier === "paid") {
    /* The tier's own product name, or its id if the row has gone. `tierForPrice`
       matched it a moment ago, so the fallback is for a tier deleted between
       these two lines — unreachable, and an id on screen beats an empty
       heading. */
    const name = standing.kind === "subscribed" ? standing.on.productName : entitlement.tierId;
    return summary({
      kind: "paid",
      tierId: entitlement.tierId,
      tierName: name,
      limit: entitlement.limit,
      ...counted,
      periodEnd: entitlement.periodEnd.toISOString(),
      /* **Derived once, here, and sent as a date rather than as the two flags
         it came from** — `planEndsAt` says why. A cancellation through the
         hosted Portal leaves `cancel_at_period_end` false, so the row's boolean
         on its own said nothing was ending while Stripe had already scheduled
         it: docs/project/billing.md § *The first live sale*. */
      endsAt:
        planEndsAt({
          cancelAt: row?.cancelAt ?? null,
          cancelAtPeriodEnd: row?.cancelAtPeriodEnd === true,
          currentPeriodEnd: entitlement.periodEnd,
        })?.toISOString() ?? null,
    });
  }

  if (hasLapsed(row)) {
    /* **No `used` on this arm**, so the page cannot print "40 of 3" — see
       src/billing-plan.ts. `remaining` is clamped at zero rather than going negative, which
       is the same number said the way round that stays true. */
    return summary({
      kind: "lapsed",
      limit: entitlement.limit,
      /* **Further private articles, which is the wall's own answer** rather than
         `limit - used`: the two are no longer two ends of one ratio now that a
         public ingest costs half. `privateHeadroom` argues that its division is
         exact, and it can never exceed the limit, which is what this arm of the
         union exists to guarantee. */
      remaining: privateHeadroom(halfUnitsUsed(usage), budgetFor(entitlement.limit)),
    });
  }

  /* **Asked of the ledger, and only at the wall.** The free arm's copy offers
     sharing as a way out, and whether that is true cannot be worked out from the
     three counts above — a charged row that predates `ingest_events.article_id`
     cannot be cheapened at all, and an account that has unshared everything is
     past the point where sharing everything would help. One grouped aggregate,
     for the readers who are being refused and nobody else. See
     `sharingWouldMakeRoom` (../store/pg-billing.ts). */
  const sharingMakesRoom =
    counted.atLimit && (await sharingWouldMakeRoom(ownerId, entitlement, usage));
  return summary({
    kind: "free",
    limit: entitlement.limit,
    ...counted,
    ...(sharingMakesRoom ? { sharingMakesRoom: true as const } : {}),
  });
}
