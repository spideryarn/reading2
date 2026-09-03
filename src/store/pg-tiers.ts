/**
 * Reading and writing what we sell.
 *
 * `billing_tiers` and `billing_tier_prices` are the source of truth for tiers
 * since 2026-09-02 (src/db/schema.ts § billing), so this is the only place that
 * knows how the two tables join. Everything downstream takes `TierRow[]`.
 *
 * ## It is read on the ingest path, so it is cached
 *
 * Every admission needs to know which price sells which tier. Tiers change
 * roughly never and an ingest happens every time somebody adds an article, so
 * reading two tables per admission would be a query nobody needs. The cache is
 * deliberately dumb — a whole-table snapshot with a short life, invalidated
 * outright by anything that writes.
 *
 * **The staleness is bounded and the failure direction is safe.** A tier edited
 * by hand takes up to `CACHE_MS` to be honoured; in the meantime an owner is
 * metered on the previous numbers. Nobody is *granted* anything they should not
 * have, because a price id that does not resolve falls to the free tier.
 */

import { eq } from "drizzle-orm";

import type { TierRow } from "../billing/tiers.js";
import { getDb } from "../db/client.js";
import { billingTierPrices, billingTiers } from "../db/schema.js";

/**
 * How long a read of the tier table is reused.
 *
 * Thirty seconds: long enough that a burst of ingests costs one query, short
 * enough that somebody who has just edited a row and reloaded a page sees it
 * without being told to restart anything. There is no invalidation across
 * processes, and at this scale there does not need to be.
 */
const CACHE_MS = 30_000;

let cached: { at: number; tiers: readonly TierRow[] } | null = null;

/** Anything in this process that writes a tier calls this. Tests use it too. */
export function forgetCachedTiers(): void {
  cached = null;
}

/** The tier table, joined to its prices. Cached; see the header. */
export async function allTiers(): Promise<readonly TierRow[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.tiers;
  const tiers = await readTiers();
  cached = { at: Date.now(), tiers };
  return tiers;
}

/** The same read, uncached, for the paths that must not see a stale row. */
export async function readTiers(): Promise<readonly TierRow[]> {
  const db = getDb();
  const [rows, prices] = await Promise.all([
    db.select().from(billingTiers),
    db.select().from(billingTierPrices),
  ]);

  /* Two statements and a join in memory rather than one statement with a left
     join and a group-by. The table is a handful of rows, and the shape that
     comes back is the shape callers want rather than something to un-flatten. */
  const byTier = new Map<string, Record<string, number>>();
  for (const price of prices) {
    const amounts = byTier.get(price.tierId) ?? {};
    amounts[price.currency] = price.unitAmount;
    byTier.set(price.tierId, amounts);
  }

  return rows
    .map((row) => ({
      id: row.id,
      productName: row.productName,
      description: row.description,
      ingestsPerPeriod: row.ingestsPerPeriod,
      lookupKey: row.lookupKey,
      stripePriceId: row.stripePriceId,
      livemode: row.livemode,
      active: row.active,
      sortOrder: row.sortOrder,
      amounts: byTier.get(row.id) ?? {},
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/**
 * Record the Stripe price a tier is now sold at.
 *
 * Called by `scripts/stripe-setup.ts` after it creates or replaces a price, so
 * that nobody ever pastes an id into an environment file. `livemode` travels
 * with it, because a price id means nothing without knowing which side of
 * Stripe's divide it came from.
 */
export async function recordTierPrice(
  tierId: string,
  stripePriceId: string,
  livemode: boolean,
): Promise<void> {
  await getDb()
    .update(billingTiers)
    .set({ stripePriceId, livemode, updatedAt: new Date() })
    .where(eq(billingTiers.id, tierId));
  forgetCachedTiers();
}
