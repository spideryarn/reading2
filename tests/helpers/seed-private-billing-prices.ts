/**
 * Give a **private** test database something to sell.
 *
 * ## What breaks without it
 *
 * `20260902181004_seed_billing_tiers.sql` creates `reader` and `researcher`,
 * both active, both with `stripe_price_id` **NULL** — deliberately, because
 * nothing in a migration talks to Stripe. The id is written later by
 * `npx tsx scripts/stripe-setup.ts --apply`, against whichever database that
 * command was pointed at, and a freshly cloned one has never had it run.
 *
 * `offerableTiers` filters on `stripePriceId !== null`
 * ([`src/billing/tiers.ts`](../../src/billing/tiers.ts)), so a clone offers
 * nothing at all, and three suites go red for a reason that has nothing to do
 * with what they test:
 *
 * - `tests/billing-checkout.test.ts` and `tests/billing-usage-route.test.ts`
 *   throw `billing_tiers has no active 'reader' row with a stripe_price_id`
 *   from their own helper — deliberately a throw rather than a skip;
 * - `tests/plans-match-tiers.test.ts` fails as *"the table advertises 'Reader'
 *   and no active tier sells it"*.
 *
 * ## The trap, and why the fence is what it is
 *
 * The first version of this recommendation, in
 * docs/plans/260903f… § T-C, was **unsafe**, and GPT Sol found two certain
 * defects in it. Both are why this file looks the way it does.
 *
 * **Null is not evidence of a private database.** It is the *legitimate* state
 * on any machine where nobody has run `stripe-setup --apply` — a fresh clone of
 * the repo, or the Mac. A backfill conditioned on nullness would fire against
 * the shared `postgres` and persist a Stripe price id that does not exist into a
 * developer's own database. So the fence is a **positive proof of privateness**:
 * `current_database()` is asked, and it must both equal the name the caller says
 * it minted and satisfy `assertMintedName` — the factory's own whole-shape check
 * — before a single row is written. Nullness decides *which rows*, never
 * *whether*.
 *
 * **`reader` is not the only tier.** Filling it alone leaves `researcher`
 * active with a null price, and `plans-match-tiers` requires every paid row the
 * page advertises to be offerable — a fix that turns three failures into one and
 * looks like progress. So the rows are chosen by the predicate `offerableTiers`
 * actually applies (active, no price id) rather than by a list of tier ids
 * somebody typed, and a third tier added tomorrow arrives here for free.
 *
 * ## Why a placeholder preserves what the suites claim
 *
 * None of the three asserts anything about a price id's *value*.
 * `plans-match-tiers` compares the website's copy against the `amounts` the
 * migration seeded; the other two only need the route to have something to sell,
 * and `billing-checkout` reads the id back out of the same table to compare
 * against what the route resolved. A value that is obviously not a Stripe id is
 * therefore free, and it is the right kind of value: anybody who finds
 * `price_local_test_reader` in a database can see immediately what put it there.
 */
import type { QueryResult, QueryResultRow } from "pg";

import { assertMintedName } from "../../scripts/db-test-create.js";

/**
 * A `pg` `Client` or `Pool`. Narrower than `seed-auth-user.ts`'s `PgQueryable`
 * because this file reads rows back and wants them typed; wider than `Client`
 * because nothing here needs a session.
 */
export interface Queryable {
  query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

/** The one shape written here. Unmistakably not Stripe's. */
export const LOCAL_TEST_PRICE_PREFIX = "price_local_test_";

/**
 * Fill in a fake Stripe price for every active tier that has none.
 *
 * @param target   a connection to the private database
 * @param database the name the factory minted, which `current_database()` must
 *                 agree with. Not a formality: it is the whole fence.
 * @returns the tier ids written, so a caller can say what it did
 */
export async function seedPrivateBillingPrices(
  target: Queryable,
  database: string,
): Promise<string[]> {
  assertMintedName(database, "backfill billing prices into");

  const here = await target.query<{ db: string }>("select current_database() as db");
  const reached = here.rows[0]?.db;
  if (reached !== database) {
    throw new Error(
      `refusing to write placeholder Stripe price ids: this connection is inside ` +
        `${reached ?? "(nothing)"}, and only ${database} was proved to be a factory-minted ` +
        "test database. See the header — a fake price id in a real database is the failure " +
        "this fence exists for.",
    );
  }

  /* **`livemode` as well as the price id, and the route is why.**
     `resolveSellableTier` refuses on `!tier.stripePriceId || tier.livemode ===
     null` and answers the same 503 either way, so filling one and not the other
     leaves sixteen cases failing with a message about Stripe not being
     configured — which is what happened on the first full run, and reads as a
     missing key rather than a half-filled row. `false` because a test-mode
     price is what a placeholder is; `scripts/stripe-setup.ts` writes the real
     pair on a real deployment. */
  const written = await target.query<{ id: string }>(
    `update spideryarn.billing_tiers
        set stripe_price_id = coalesce(stripe_price_id, $1 || id),
            livemode = coalesce(livemode, false)
      where active and (stripe_price_id is null or livemode is null)
      returning id`,
    [LOCAL_TEST_PRICE_PREFIX],
  );
  return written.rows.map((r) => r.id);
}
