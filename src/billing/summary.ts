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
import type { OwnerId } from "../owner.js";
import { accountSnapshot, entitlementFromRow, hasLapsed, usageFor } from "../store/pg-billing.js";
import { allTiers } from "../store/pg-tiers.js";
import { STORE } from "../store/live.js";
import { planEndsAt } from "../billing-plan.js";
import type { BillingSummary, Purchase, ReaderPlan, TierOffer } from "../billing-plan.js";
import { isTerminalStatus, tiersToOffer } from "./tiers.js";
import type { Standing, TierRow } from "./tiers.js";

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
  /* **The same question `startCheckout` decides on**: `hasOpenSubscription`
     there is a subscription id with a status that is not *terminal*, which is a
     shorter list than unentitled. */
  const open = Boolean(row?.stripeSubscriptionId && !isTerminalStatus(row.status));

  /* **Computed before the administrator branch, and it is pure**, so moving it
     up costs nothing: `entitlementFromRow` reads the row we already have.
     An exempt reader still buys and manages like anybody else — being outside
     the quota is not being unable to hold a subscription — so their standing
     has to be worked out the same way. */
  const entitlement = entitlementFromRow(row, tiers, new Date());
  const stale = "kind" in entitlement;
  /* **Three states, and the middle one is the only one that names a tier.** An
     open subscription whose entitlement is free (`unpaid`, `incomplete`) or
     whose period we cannot read is `unresolved` — nothing is sold beside it,
     which is exactly what `canCheckout: false` did for those accounts before
     this was tier-aware. See `Standing`.

     **The row, not `entitlement.limit`**: a mid-period plan change leaves a
     prorated override in that number, and ranking it would offer a Researcher a
     switch to Researcher. A tier that has vanished from the table between the
     entitlement and this line is `unresolved` too — nothing to rank against
     beats guessing. */
  const on = stale || entitlement.tier !== "paid" ? undefined : tiers.find((t) => t.id === entitlement.tierId);
  const standing: Standing = !open
    ? { kind: "unsubscribed" }
    : on
      ? { kind: "subscribed", on }
      : { kind: "unresolved" };
  const choice = tiersToOffer(tiers, standing);
  /* The rows become the wire's trimmed shape here and nowhere else. The tuple is
     rebuilt by hand rather than `.map`ped, because `map` returns an array and
     the non-empty guarantee is the point of the type. */
  const purchase: Purchase =
    choice.kind === "checkout" || choice.kind === "switch"
      ? { kind: choice.kind, tiers: [toOffer(choice.tiers[0]), ...choice.tiers.slice(1).map(toOffer)] }
      : choice;

  const summary = (plan: ReaderPlan): BillingSummary => ({ plan, manageable, purchase });

  if (isAdmin(ownerId)) return summary({ kind: "exempt" });

  if (stale) return summary({ kind: "unknown" });

  const usage = await usageFor(ownerId, entitlement);
  /* **In-flight counts as used**, because it counts at the wall (`refusalFor` in
     src/store/pg-billing.ts). A page that showed only settled successes would
     say a slot was free and then watch the server refuse it. */
  const used = usage.used + usage.inFlight;

  if (entitlement.tier === "paid") {
    /* The tier's own product name, or its id if the row has gone. `tierForPrice`
       matched it a moment ago, so the fallback is for a tier deleted between
       these two lines — unreachable, and an id on screen beats an empty
       heading. */
    const name = on?.productName ?? entitlement.tierId;
    return summary({
      kind: "paid",
      tierId: entitlement.tierId,
      tierName: name,
      limit: entitlement.limit,
      used,
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
      remaining: Math.max(0, entitlement.limit - used),
    });
  }

  return summary({ kind: "free", limit: entitlement.limit, used });
}
