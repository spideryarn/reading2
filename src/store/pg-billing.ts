/**
 * The ingest quota: reserving a slot, settling it, and counting what is used.
 *
 * Postgres only — there is no filesystem half and there will not be one. The
 * settlement joins the publish transaction in src/store/pg-session.ts, so quota
 * is enforced on every ingest: there is no second store to leak through, and the
 * boot refusal that used to guard against one went with it.
 * docs/project/billing.md.
 *
 * **It is wired up, as of 2026-09-03.** `settleReservation` is called at every
 * site that ends a job — the two in `settleIn` (src/store/pg-session.ts), the
 * release there that resolves to a cancellation, `settleExpired`,
 * `requestCancel`, and the store's own `finish` and `releaseStep` (all in
 * src/store/pg-jobs.ts). Seven, and the last two were missing until GPT Sol
 * counted them (2026-09-03,
 * docs/plans/260902i-settlement-code-review-sol.md finding 1).
 * `reserveIngest`'s callers are all in
 * **src/billing/admission.ts**, which is where the decision *which requests
 * spend a slot* lives: a URL or an upload at `POST /api/jobs`, and a retry of a
 * job that carried one. A step re-run on an article already on the shelf spends
 * nothing, which is why admission is at the routes rather than inside
 * `enqueue()`. Nothing else in `src/` may call `reserveIngest`.
 *
 * The comments below still describe what each function guarantees *to a correct
 * caller* rather than what the app does with it — an earlier version of this
 * header claimed the whole feature was live when only half of it was, and was
 * wrong (GPT Sol, 2026-09-02).
 *
 * ## The one thing this file exists to get right
 *
 * A script firing twenty concurrent `POST /api/jobs` at a free account with
 * three lifetime ingests must not get twenty through. A plain "count, then
 * decide" cannot stop that: twenty requests all read zero and all pass.
 *
 * So admission is serialised per owner, on the owner's `billing_accounts` row —
 * and **the row is created before it is locked**, which is the part that is easy
 * to get wrong and was got wrong here before, in another table: *"a row lock is
 * taken on rows the statement returns, so a `SELECT … FOR UPDATE` that matches
 * nothing locks nothing"*
 * (docs/postmortems/260901f-a-for-update-that-locks-nothing.md). A free reader
 * has no billing row, so locking one that might not exist would serialise
 * nobody, in exactly the case the boundary is for.
 *
 * Measured on 2026-09-02 with two real connections: the second transaction
 * blocks for as long as the first holds the row, then reads the first's
 * committed value. `tests/billing-quota-race.test.ts` is that measurement, kept.
 *
 * **The entitlement is read under the same lock**, from the row itself, rather
 * than passed in by the caller. Passing it in left a window in which a webhook
 * could cancel a subscription between the caller's read and this lock — and the
 * function would then grant Reader quota to a cancelled account, or refuse a
 * customer who had just paid.
 *
 * ## Why the lock is not held across `enqueue()`
 *
 * The obvious shape — hold the lock, count, create the job, commit — cannot be
 * built and should not be. `enqueueOrGet` (src/store/pg-jobs.ts) is deliberately
 * not a transaction, and holding a transaction open on one pooled connection
 * while `enqueue()` takes a second would deadlock the pool at
 * `DATABASE_POOL_MAX`, which defaults to 5.
 *
 * Instead the **reservation** is what is written under the lock. A later
 * admission counts unsettled reservations as used, so it sees an earlier one
 * whether or not that one has reached `enqueue()` yet. **Nothing that opens its
 * own transaction, and nothing that talks to the network, may be called between
 * the lock and the commit** — that is the rule that keeps the pool argument true.
 *
 * ## The lock order: `billing_accounts` before `articles`, everywhere
 *
 * Since 2026-09-05 usage is a function of `articles.visibility` — a public
 * article costs half (src/billing/points.ts) — and a different request can
 * change that at any moment. `pg-visibility.ts` locks the article; admission
 * locks `billing_accounts`. An unshare committing between the usage read and the
 * reservation would let the reservation commit against stale usage. (It does
 * **not** let two ingests consume one slot; GPT Sol confirmed that separately.)
 *
 * So **every transaction that changes visibility creates the owner's billing
 * anchor if absent, locks that `billing_accounts` row, and only then locks the
 * article** — `lockBillingAccount` below is the shared half. `read committed` is
 * then sufficient and serializable is not needed. A *consistent* order is also
 * what stops this deadlocking, so it is applied everywhere or nowhere: a second
 * writer that took the article first and the billing row second would be the
 * cycle. The publish path is not in this rule and does not need to be — it locks
 * the article and settles a reservation, and takes no `billing_accounts` lock at
 * all, so there is nothing for it to hold in the wrong order.
 */

import { and, eq, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";

import {
  MINIMAL_COST,
  MINIMAL_CREDIT,
  PRIVATE_INGEST_COST,
  PUBLIC_INGEST_COST,
  admitsHighPower,
  admitsIngest,
  admitsMinimal,
  admitsUpgrade,
  articles as inArticles,
  budgetFor,
  minimalHeadroom,
  points,
} from "../billing/points.js";
import type { Articles, Points, UpgradeCredit } from "../billing/points.js";
import { limitForPeriod } from "../billing/quota-adjustment.js";
import {
  FREE,
  FREE_LIFETIME_INGESTS,
  entitlementForTier,
  isEntitledStatus,
  quotaRules,
  tierForPrice,
} from "../billing/tiers.js";
import type { Entitlement, TierRow } from "../billing/tiers.js";
import { getDb } from "../db/client.js";
import { articles as articleRows, billingAccounts, ingestEvents } from "../db/schema.js";
import { log } from "../log.js";
import type { OwnerId } from "../owner.js";
import { ownedSlug } from "./owned-slug.js";
import { allTiers } from "./pg-tiers.js";

const logger = log("store");

/** A slot was taken. The id goes on the job row, in the job's own INSERT. */
export interface Admitted {
  readonly kind: "admitted";
  readonly reservationId: string;
  readonly entitlement: Entitlement;
}

/**
 * One article a refusal may name as worth sharing.
 *
 * **The title and nothing else**, because the only thing that is done with it is
 * to put it in a sentence: an id or a slug would invite a link, and the surface
 * this reaches is a plain-text failure message rendered in four places
 * (`QuotaNotice`). The title is the shelf's own answer — the reader's override,
 * else the extracted one, else the slug — so it is the name they are looking at
 * in their library.
 */
export interface ShareCandidate {
  readonly title: string;
}

/** The account is at its ceiling. Carries what a refusal message needs. */
export interface Refused {
  readonly kind: "refused";
  /**
   * **Ingests counted against the allowance — a whole number of them**, charged
   * plus in flight, whatever each one cost.
   *
   * Not points, and not a points total divided by anything. A public ingest
   * costs 100 and a private one 200, so the two numbers are different questions;
   * this is the one a person can say out loud. See src/billing/points.ts.
   */
  readonly used: number;
  /** The tier's allowance, **in articles** — the number the website markets. */
  readonly limit: Articles;
  /**
   * **The articles this reader could share to make room**, fewest first —
   * absent when sharing every one of them still would not.
   *
   * The offer a refusal can carry: *sharing “this one” would make room*. It is
   * computed by the server and never a constant, which is what stops it being
   * shown to the reader who has already shared everything and to the reader
   * whose charged rows all predate the discount and cannot be cheapened.
   * **Copy cannot rescue a false offer; conditionality has to** (Fable,
   * 2026-09-04).
   *
   * Counted **by article** rather than by ledger row, because a re-added URL owns
   * several charged rows and *"share three articles"* would be false when three
   * rows' worth of points come from one article. `articlesToShare` below is the query.
   *
   * ## Why the articles are named rather than counted
   *
   * It was a count until 2026-09-05, and a count is an offer the reader cannot
   * act on. Three charge-bearing private articles at six-of-six, beside one
   * grandfathered article with no ledger row at all: *sharing one of your
   * articles would make room* is arithmetically right and points at four
   * articles of which only three are the ones meant. Share the wrong one and
   * usage does not move — and **sharing is irreversible in the way that
   * matters**, because it republishes somebody else's article to strangers.
   * Nothing on any screen distinguishes a charge-bearing article from a
   * grandfathered one, so the reader cannot make that choice themselves; the
   * only fix is to say which. GPT Sol found it, 2026-09-05.
   */
  readonly shareToMakeRoom?: readonly [ShareCandidate, ...ShareCandidate[]];
  /** When the allowance resets, for a paid account. Absent means never. */
  readonly resetAt?: Date;
  /**
   * **This account had a subscription and no longer has an entitled one.**
   *
   * Set from the locked row — a `stripe_subscription_id` beside a status the
   * allowlist does not entitle — rather than inferred from `used > limit`, which
   * is the same answer most of the time and a wrong one after somebody edits
   * `billing_tiers.ingests_per_period` downwards.
   *
   * It exists because the free count is **lifetime and includes paid months**
   * (Greg, 2026-09-03), so a reader who took 40 articles on Reader and cancelled
   * is past the free allowance for ever. That is the intended policy, but the
   * refusal that states it as *"all 3 articles a free account can add"* reads as
   * a bug rather than as a policy. `ingestQuotaReached` (src/messages.ts) has a
   * third sentence for exactly this.
   *
   * **Absent rather than `false`** when it does not apply, so the shape a plain
   * free refusal has is the shape it had before this field existed.
   */
  readonly lapsed?: true;
}

/**
 * The account looks paid, but the stored period does not contain now.
 *
 * Neither an admission nor a refusal, because both would be wrong: serving them
 * the free limit falsely blocks somebody who has paid, and serving them the
 * Reader limit against a stale window is an uncapped month. The caller resyncs
 * from Stripe once and asks again; if it comes back `stale` a second time, that
 * is a 503 rather than a guess.
 */
export interface Stale {
  readonly kind: "stale";
  readonly subscriptionId: string | null;
  /**
   * The Stripe customer to resync, because that is what the resync takes.
   *
   * `syncSubscriptionFromStripe` (src/billing/sync.ts) is keyed on the
   * **customer**, not the subscription: it lists every subscription that
   * customer has and applies one written policy to the set. Null means there is
   * nothing to ask about, and the caller has no second guess to make — see
   * `admitIngest` in src/billing/admission.ts, which answers 503.
   */
  readonly customerId: string | null;
}

export type Admission = Admitted | Refused | Stale;

/**
 * What an owner has used, for the wall, `/profile` and `/admin/users`.
 *
 * **Integer counts of rows, and no total.** The total is a points figure, and a
 * surface that wants to show usage wants integers it can add up itself — see
 * src/billing/points.ts § *Nothing here divides for display*. `wallUsed`,
 * `ingestsUsed` and `minimalUsed` below are the three things anybody actually
 * asks of this.
 */
export interface Usage {
  /**
   * Successful ingests inside the current period whose article is **not**
   * currently public — {@link PRIVATE_INGEST_COST} each.
   *
   * A charged row whose `article_id` cannot be resolved is in here too: the
   * `coalesce` in `usageSql` reads an absent article as private, which is the
   * direction that cannot be gamed. Every row charged before 2026-09-05 is one
   * of those and there is no way to backfill them, so **the discount applies to
   * what is added from now on** — an article shared last week does not become
   * cheaper.
   */
  readonly chargedFullPrice: number;
  /**
   * Successful ingests inside the current period whose article **is** currently
   * public — {@link PUBLIC_INGEST_COST} each.
   *
   * Recomputed live from `articles.visibility` on every read rather than
   * credited once, so unsharing puts the cost straight back. That is the whole
   * mechanism: there is nothing to game, and no second kind of ledger row.
   */
  readonly chargedHalfPrice: number;
  /**
   * Ingest reservations taken and not yet settled — jobs in flight, at full
   * price, {@link PRIVATE_INGEST_COST}. A *Read this* on a minimal paper is one
   * of these too, so while it runs the paper costs its minimal 2 plus this 200,
   * which errs on the safe side and falls back once the publication lands.
   */
  readonly inFlightIngest: number;
  /**
   * Minimal reservations taken and not yet settled — {@link MINIMAL_COST} each.
   * Counted apart from `inFlightIngest` because until 2026-10-01 every
   * unsettled row cost full price, and a batch of a thousand papers in flight
   * would have read as a thousand articles.
   */
  readonly inFlightMinimal: number;
  /**
   * **Minimal papers charged inside the current period and not superseded** —
   * {@link MINIMAL_COST} each, whatever the visibility: a minimal article
   * cannot be shared, and its row is frozen `'private'` if it is deleted.
   *
   * A superseded row is one *Read this* paid for in full, by an ingest row that
   * is counted above; counting this one as well would charge the paper 1.01.
   */
  readonly minimalCharged: number;
  /**
   * **High-powered AI upgrades** inside the current period whose article is not
   * currently public — one more article's worth each, {@link PRIVATE_INGEST_COST}.
   *
   * Counted apart from the ingests above because every sentence that says
   * *added* is about ingests: folded into `chargedFullPrice`, one high-powered
   * article would read as two articles added on /profile. The wall adds all
   * the counts (`wallUsed`). GPT Sol, plan review finding 1, 2026-09-30;
   * docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md.
   */
  readonly highPowerFullPrice: number;
  /** The same, for an article that is public right now — {@link PUBLIC_INGEST_COST}. */
  readonly highPowerHalfPrice: number;
}

/**
 * **What this usage costs**, in the currency the wall compares.
 *
 * In flight is full price for an ingest because nobody yet knows whether the
 * article will be shared — see {@link PRIVATE_INGEST_COST} — and 2 for a
 * minimal paper, which is never priced by visibility.
 */
export function wallUsed(usage: Usage): Points {
  return points(
    usage.chargedFullPrice * PRIVATE_INGEST_COST +
      usage.chargedHalfPrice * PUBLIC_INGEST_COST +
      usage.inFlightIngest * PRIVATE_INGEST_COST +
      usage.minimalCharged * MINIMAL_COST +
      usage.inFlightMinimal * MINIMAL_COST +
      usage.highPowerFullPrice * PRIVATE_INGEST_COST +
      usage.highPowerHalfPrice * PUBLIC_INGEST_COST,
  );
}

/**
 * The same usage as a count of **ingests**, which is what a sentence can say.
 * High-powered AI upgrades and minimal papers are not in it — they are not
 * articles added; the wall still counts them, through `wallUsed`.
 */
export function ingestsUsed(usage: Usage): number {
  return usage.chargedFullPrice + usage.chargedHalfPrice + usage.inFlightIngest;
}

/**
 * **Minimal papers counted against the allowance** — charged and unsuperseded,
 * plus in flight. `ReaderPlan.minimal` and `/admin/users`'s column say this, as
 * a plain count: a hundredth is never printed as a fraction of an article.
 */
export function minimalUsed(usage: Usage): number {
  return usage.minimalCharged + usage.inFlightMinimal;
}

/** The columns entitlement is derived from. */
export interface BillingRow {
  readonly status: string | null;
  readonly priceId: string | null;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly stripeSubscriptionId: string | null;
  readonly stripeCustomerId: string | null;
  /**
   * What a mid-period plan change left this account allowed, and which period
   * that number belongs to. Null in the ordinary case, which means *ask the
   * tier* — src/billing/quota-adjustment.ts, and `billing_accounts` in
   * ../db/schema.ts.
   */
  readonly quotaLimitDelta: number | null;
  readonly quotaPeriodStart: Date | null;
  /**
   * **Extra free articles from gift vouchers** — the sum of this owner's
   * claimed, unrevoked `billing_vouchers` rows, in whole articles. Zero for
   * almost everybody.
   *
   * Read by every query that reads the row (`BILLING_COLUMNS`), so the wall,
   * `/profile`, `/pricing` and `/admin/users` all add the same number. It counts
   * **on Free only** — `freeEntitlement` below is where it is added, and no paid
   * return touches it. docs/project/billing.md § *Gift vouchers*.
   */
  readonly voucherArticles: number;
}

/**
 * **The Free entitlement for this row** — the lifetime three, plus whatever gift
 * vouchers the account has claimed and not had revoked.
 *
 * **One function for every Free return in `entitlementFromRow`**, so no branch
 * can come to answer the bare `FREE` while another adds the gift (GPT Sol, plan
 * review F1).
 *
 * **The sum is checked, not trusted.** Postgres hands `sum()` back as a string
 * unless told otherwise, and `3 + "20"` is `"320"` — an allowance of three
 * hundred and twenty articles, silently. The column is cast in SQL and mapped
 * to a number on the way out (`BILLING_COLUMNS`); this is the third guard, and
 * it throws rather than defaulting, for the reason `usageOf` gives: a wrong
 * allowance that looks right is the expensive failure.
 */
export function freeEntitlement(row: BillingRow | undefined): Entitlement {
  const bonus: unknown = row?.voucherArticles ?? 0;
  if (typeof bonus !== "number" || !Number.isSafeInteger(bonus) || bonus < 0) {
    throw new Error(`the gift voucher sum came back as ${String(bonus)}, which is not a count of articles`);
  }
  if (bonus === 0) return FREE;
  return { tier: "free", limit: inArticles(FREE_LIFETIME_INGESTS + bonus) };
}

/**
 * What this row entitles its owner to, or `"stale"`.
 *
 * Pure, so the decision that governs every ingest can be tested without a
 * database. `readerPriceId` is passed rather than read from the environment for
 * the same reason.
 *
 * Order matters: an unentitled status is free whatever the price says, and an
 * unrecognised price is free whatever the status says. Both fail towards free,
 * because the other direction hands out a hundred ingests a month for something
 * nobody costed.
 */
export function entitlementFromRow(
  row: BillingRow | undefined,
  tiers: readonly TierRow[],
  now: Date,
): Entitlement | Stale {
  if (!row || !isEntitledStatus(row.status)) return freeEntitlement(row);

  const tier = tierForPrice(row.priceId, tiers);
  if (!tier) {
    logger.warn(
      { priceId: row.priceId, status: row.status },
      "an entitled subscription is on a price no tier sells — treating as free",
    );
    return freeEntitlement(row);
  }

  const { currentPeriodStart: start, currentPeriodEnd: end } = row;
  /* Half-open, the same rule the usage query counts by. */
  if (!start || !end || now < start || now >= end) {
    return {
      kind: "stale",
      subscriptionId: row.stripeSubscriptionId,
      customerId: row.stripeCustomerId,
    };
  }
  /* **The one place a stored override is read.** A plan change mid-period leaves
     a number here that is neither tier's, because Stripe prorated the price and
     the allowance follows it — src/billing/quota-adjustment.ts. It applies only to
     the period it was computed for, so this is a comparison and not arithmetic:
     admission reads an integer. */
  const { maxAllowance } = quotaRules(tiers);
  const limit = limitForPeriod(
    inArticles(tier.ingestsPerPeriod),
    start,
    /* **The column is a signed count of whole ingests**, so it is named as one
       on the way out of the database — the boundary `articles()` exists for. A
       count in the enforcement unit reaching this argument is what turned a
       stored −117 into ninety-one articles in the design review
       (src/billing/points.ts). */
    {
      delta: row.quotaLimitDelta === null ? null : inArticles(row.quotaLimitDelta),
      periodStart: row.quotaPeriodStart,
    },
    maxAllowance,
  );
  return { ...entitlementForTier(tier, { start, end }), limit };
}

/**
 * The usage half of admission, as SQL, so that the gate and the display ask the
 * same question of the same columns rather than two questions that agree today.
 *
 * **Counts and no total**, because a charged ingest costs 200 points while the
 * article it produced is private and 100 while it is public, a minimal paper 2,
 * and a superseded minimal paper nothing (src/billing/points.ts). The split is
 * done by the database rather than by round trips, and the arithmetic over it
 * is `wallUsed`.
 *
 * **In flight is split by kind**, and the split fails safe: anything unsettled
 * that is not `'minimal'` is counted as an ingest at full price. A
 * `'high_power'` row cannot be unsettled (`ingest_events_high_power_shape`), so
 * in practice that is every ingest and *Read this* reservation.
 *
 * **Live, from `articles.visibility`, on every read** — not a credit granted
 * once at sharing time. Share-then-unshare would otherwise be free slots for
 * ever unless clawed back, which is the ledger growing a second kind of row; and
 * charging half at add time misses the article you decide to share three weeks
 * later, which is most of them. The cost of live recomputation is that `used`
 * stops being monotonic: unsharing raises it, and on the free tier — whose
 * window is `true`, so lifetime — there is no next month to rescue anybody.
 * That is why the unshare warning says the number before it happens.
 *
 * **In-flight has no age limit**, and that is the correction that matters most
 * in this file. See `ingest_events` in src/db/schema.ts: an expiry here is a
 * quota bypass, because held-open jobs are something a caller can arrange.
 *
 * **Every interpolation here is a bind parameter, checked rather than assumed.**
 * Drizzle's `sql` tag turns `${…}` into `$1`, `$2`, `$3`, so the values reach
 * Postgres in the parameter array and never in the statement text. Asked of the
 * builder on 2026-09-02 with `'; drop table spideryarn.ingest_events; --` as the
 * owner id: the SQL came back with placeholders and the hostile text appeared
 * only in `params`. Worth writing down because the period derives from
 * Stripe-controlled data, so "surely it parameterises" is not a thing to be
 * surely about.
 *
 * **Exported only so that claim has a test.** `tests/billing-quota-sql.test.ts`
 * builds this with a hostile owner id and asserts the statement text contains
 * placeholders and not the string — which is what stops somebody "simplifying"
 * it into concatenation later, a change that would look completely ordinary in
 * a diff and be invisible in every other test.
 */
export function usageSql(ownerId: string, entitlement: Entitlement) {
  return sql`
    select
      count(*) filter (where e.kind = 'ingest' and ${chargedIn(entitlement)} and ${IS_PUBLIC} is false)::int as full_price,
      count(*) filter (where e.kind = 'ingest' and ${chargedIn(entitlement)} and ${IS_PUBLIC})::int as half_price,
      count(*) filter (where e.kind <> 'minimal' and e.succeeded_at is null and e.released_at is null)::int as in_flight_ingest,
      count(*) filter (where e.kind = 'minimal' and e.succeeded_at is null and e.released_at is null)::int as in_flight_minimal,
      count(*) filter (where e.kind = 'minimal' and ${chargedIn(entitlement)} and e.superseded_by is null)::int as minimal_charged,
      count(*) filter (where e.kind = 'high_power' and ${chargedIn(entitlement)} and ${IS_PUBLIC} is false)::int as high_power_full_price,
      count(*) filter (where e.kind = 'high_power' and ${chargedIn(entitlement)} and ${IS_PUBLIC})::int as high_power_half_price
    from spideryarn.ingest_events e
    ${VISIBILITY_JOIN}
    where e.owner_id = ${ownerId}::uuid`;
}

/**
 * **What price is this charged row at — one spelling, for every reader of it.**
 *
 * Three terms, and each one is a different question:
 *
 * 1. `articles.visibility` — **is it public right now?** Live, on every read,
 *    which is the whole design: sharing lowers usage and unsharing puts it
 *    straight back.
 * 2. `ingest_events.article_visibility_at_delete` — **what was it when it was
 *    destroyed?** Null while the article exists, so this can never disagree with
 *    the term above; it only answers once there is nothing to ask. Without it
 *    `on delete set null` would reprice a deleted public article's rows from
 *    half to full, and the owner's usage would go up for having thrown something
 *    away. See `ingest_events.article_visibility_at_delete` in ../db/schema.ts.
 * 3. `'private'` — **the row that resolves to nothing at all.** Every row charged
 *    before `article_id` existed, with no way to backfill one. Full price, the
 *    direction that cannot be gamed.
 *
 * **A function rather than three literals, because it is asked in two files.**
 * The usage query and the offer query below shared a constant so they could not
 * come to disagree about what "public" means; the admin page's half-price split
 * (pg-admin.ts) asks the same question in Drizzle's builder, in another file.
 * They had already parted company on paper — that one's comment claimed *"the
 * same `coalesce` reading `usageSql` uses"* over a bare `= 'public'`, which
 * happened to agree and had stopped being a description. The argument for one
 * spelling does not stop at the file boundary, so this is exported and pg-admin
 * imports it. It takes either a raw fragment or a Drizzle column, since the two
 * callers have one each.
 */
export function isPublicPrice(live: SQLWrapper, frozen: SQLWrapper) {
  return sql`coalesce(${live}, ${frozen}, 'private') = 'public'`;
}

/** The join that makes term 1 available, and the two aliases this file uses. */
const VISIBILITY_JOIN = sql`left join spideryarn.articles a on a.id = e.article_id`;
const IS_PUBLIC = isPublicPrice(sql`a.visibility`, sql`e.article_visibility_at_delete`);

/**
 * The `succeeded_at` half of the usage filter — charged, and inside the window.
 *
 * Half-open on the period — `>= start and < end` — so an ingest at the instant a
 * period rolls over is counted once, in the new period, rather than in both or
 * in neither. The free tier's allowance is lifetime, so any success counts.
 */
function chargedIn(entitlement: Entitlement) {
  return entitlement.tier === "paid"
    ? sql`e.succeeded_at >= ${entitlement.periodStart.toISOString()}::timestamptz
          and e.succeeded_at < ${entitlement.periodEnd.toISOString()}::timestamptz`
    : sql`e.succeeded_at is not null`;
}

/**
 * Read the one row an aggregate must produce, or throw.
 *
 * **Never defaults to zero**, which is the whole reason this is a function. A
 * driver shape that changed, a query that returned nothing, a count that came
 * back as something other than a number — every one of those, defaulted, reads
 * as "this account has used nothing" and lets an unlimited number of ingests
 * through. Wrong in the expensive direction, and silent. GPT Sol, 2026-09-02.
 */
function usageOf(result: unknown): Usage {
  const row = rowsOf(result)[0];
  if (!row || typeof row !== "object") {
    throw new Error("the ingest usage query returned no row, which an aggregate cannot do");
  }
  const cell = (name: string): number => {
    const value = Number((row as Record<string, unknown>)[name]);
    /* **Every count stays an integer**, which is the whole reason the discounts
       are expressed in points rather than in fractions of an article: this
       assertion is unchanged, and it is what stops a driver shape that changed
       reading as "this account has used nothing". */
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`the ingest usage query returned ${name}=${String(value)}, which is not a count`);
    }
    return value;
  };
  return {
    chargedFullPrice: cell("full_price"),
    chargedHalfPrice: cell("half_price"),
    inFlightIngest: cell("in_flight_ingest"),
    inFlightMinimal: cell("in_flight_minimal"),
    minimalCharged: cell("minimal_charged"),
    highPowerFullPrice: cell("high_power_full_price"),
    highPowerHalfPrice: cell("high_power_half_price"),
  };
}

/** What this owner has used against the entitlement they currently hold. */
export async function usageFor(ownerId: string, entitlement: Entitlement): Promise<Usage> {
  return usageOf(await getDb().execute(usageSql(ownerId, entitlement)));
}

/**
 * The columns the two questions below are decided from. One list, one shape.
 *
 * **`voucherArticles` is a correlated subquery, not a column**, so that every
 * read of the row carries the gift voucher bonus and none can forget it. Cast
 * to `int` in SQL **and** mapped to a number here, because a bare `sum()` is a
 * `bigint` and arrives as a string (GPT Sol, plan review F1) — `freeEntitlement`
 * then refuses anything that is not a non-negative safe integer.
 *
 * **Never read in the statement that takes the lock.** Under `read committed`
 * a subquery in a `FOR UPDATE` select answers from the snapshot taken *before*
 * the wait for the lock, so a revoke that committed while this request waited
 * would not be seen. `lockBillingAccount` locks first and reads these in a
 * second statement (F2).
 */
const BILLING_COLUMNS = {
  status: billingAccounts.status,
  priceId: billingAccounts.priceId,
  currentPeriodStart: billingAccounts.currentPeriodStart,
  currentPeriodEnd: billingAccounts.currentPeriodEnd,
  stripeSubscriptionId: billingAccounts.stripeSubscriptionId,
  stripeCustomerId: billingAccounts.stripeCustomerId,
  quotaLimitDelta: billingAccounts.quotaLimitDelta,
  quotaPeriodStart: billingAccounts.quotaPeriodStart,
  voucherArticles: sql<number>`(
    select coalesce(sum(v.articles), 0)::int
      from spideryarn.billing_vouchers v
     where v.claimed_by = ${billingAccounts.ownerId}
       and v.revoked_at is null)`.mapWith(Number),
} as const;

/**
 * The refusal this usage makes against this entitlement, or null for room left.
 *
 * **In-flight counts as used**, which is the whole burst defence: a reservation
 * nobody has settled is a slot somebody is spending.
 *
 * ## The rule is `admitsIngest`, and it was `<` in half-units
 *
 * `used < budget` in half-units was not the old rule doubled. `used < limit`
 * never let anybody exceed the limit **only because a reservation cost exactly
 * one**; at two, five-of-six admits an ingest that settles at seven. The plan
 * said the doubling was a no-op and GPT Sol showed it was not (2026-09-04).
 *
 * **That half-article overdraft is accepted knowingly**, because Greg's own
 * sentence settles it: he said a free account can make six public articles, and
 * the money-safe `used + 200 <= budget` delivers five. What is accepted is half
 * an article, once — a reader at five may add a sixth and is then refused
 * everything until they are back under. **It cannot repeat and it cannot
 * compound**: at seven they are refused, and sharing the new article returns
 * them to six, which is still refused. `tests/billing-points.test.ts` pins both
 * halves, because the second is what an add-then-unshare cycle would attack.
 *
 * In points it is `used + 200 <= budget + 100` (`admitsIngest`,
 * src/billing/points.ts), which is the same rule while `used` is a multiple of
 * 100 and the right one once minimal papers put it anywhere else.
 *
 * Shared by the two callers that ask the same question of the same columns —
 * `reserveIngest` under the lock, which then takes a slot, and
 * `ingestEligibility` without one, which takes nothing — so that the wall and
 * the sign on it cannot drift into two rules.
 */
function refusalFor(
  entitlement: Entitlement,
  usage: Usage,
  row: BillingRow | undefined,
): Refused | null {
  if (admitsIngest(wallUsed(usage), budgetFor(entitlement.limit))) return null;
  /* Read off the row rather than inferred from `used > limit`; see `lapsed`. */
  const lapsed = hasLapsed(row);
  return {
    kind: "refused",
    used: ingestsUsed(usage),
    limit: entitlement.limit,
    ...(entitlement.tier === "paid" ? { resetAt: entitlement.periodEnd } : {}),
    ...(lapsed ? { lapsed: true as const } : {}),
  };
}

/**
 * **Is there a subscription on this row that entitles nothing?**
 *
 * A `stripe_subscription_id` beside a status the allowlist does not entitle —
 * read off the row rather than inferred from `used > limit`, which is the same
 * answer most of the time and a wrong one the day somebody lowers a tier's
 * `ingests_per_period`.
 *
 * **It is not quite "had a subscription and lost it"**, which is what this said
 * and what the refusal copy it chooses implies: `incomplete` is a subscription
 * whose *first* payment never succeeded, so nobody has ever paid, and it lands
 * here too (GPT Sol, 2026-09-03). Kept as it is, because the copy it selects —
 * "your plan has ended, and resubscribing is what adds more" — is the right
 * thing to say to somebody whose subscription is not working either way, and the
 * alternative is a fourth `pay-` message for a state Stripe expires in 24 hours.
 * Written down rather than fixed.
 *
 * Exported so the wall and the page ask it the same way: `refusalFor` below
 * chooses the `pay-lapsed` refusal with it, and `readBillingSummary`
 * (src/billing/summary.ts) chooses `/profile`'s "your plan has ended" with it.
 * Two spellings of this rule would be two answers to *is my plan over*, on the
 * same screen a minute apart.
 */
export function hasLapsed(row: BillingRow | undefined): boolean {
  return Boolean(row?.stripeSubscriptionId) && !isEntitledStatus(row?.status ?? null);
}

/** Room for another ingest, without taking any. See `ingestEligibility`. */
export interface Eligible {
  readonly kind: "eligible";
}

export type Eligibility = Eligible | Refused | Stale;

/**
 * **Would an ingest be admitted right now?** Asks, and takes nothing.
 *
 * For `POST /api/uploads`, which mints a place to put a file: an account at its
 * ceiling should be told at the door rather than after transferring 11 MB. It
 * reserves nothing and locks nothing, so two of these can both say "eligible"
 * for one remaining slot — which is correct, because **this is not the gate**.
 * `reserveIngest` at `POST /api/jobs` is, and it is serialised.
 *
 * A missing row is the free tier, exactly as it is under the lock: this reads
 * the anchor row rather than creating one, because a question should not write.
 */
export async function ingestEligibility(
  ownerId: string,
  tiers?: readonly TierRow[],
): Promise<Eligibility> {
  const sold = tiers ?? (await allTiers());
  const [row] = await getDb()
    .select(BILLING_COLUMNS)
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerId, ownerId))
    .limit(1);

  const entitlement = entitlementFromRow(row, sold, new Date());
  if ("kind" in entitlement) return entitlement; // stale
  const usage = await usageFor(ownerId, entitlement);
  const refused = refusalFor(entitlement, usage, row);
  if (!refused) return { kind: "eligible" };
  /* The same offer the locked path carries, so the door and the wall say the
     same thing to somebody about to transfer 11 MB. Unlocked, like everything
     else here: this is not the gate, and a number that moves between the two is
     a number that was going to move anyway. */
  const shareToMakeRoom = await articlesToShare(getDb(), ownerId, entitlement, usage);
  return shareToMakeRoom === undefined ? refused : { ...refused, shareToMakeRoom };
}

/**
 * The billing row as a page needs it: the entitlement columns, plus the one
 * fact entitlement does not care about.
 *
 * `cancelAtPeriodEnd` and `cancelAt` are not part of `BillingRow` because
 * entitlement is not decided by either — a subscription scheduled to end is
 * still `active` and still entitled until the period runs out. They matter to
 * the *reader*, who is owed the difference between "starts again on the 3rd"
 * and "runs out on the 3rd", so they travel beside the row rather than inside
 * it.
 *
 * **Two fields, one answer.** They are two raw Stripe facts and neither implies
 * the other (src/billing/subscription.ts). Nothing downstream may interpret
 * them separately: `planEndsAt` in src/billing-plan.ts is the single place the
 * pair becomes a date, and it is that date the browser is given.
 */
export interface AccountSnapshot extends BillingRow {
  readonly cancelAtPeriodEnd: boolean;
  readonly cancelAt: Date | null;
}

/**
 * Read one owner's billing row, creating nothing.
 *
 * For the surfaces that only *ask* — `/profile` and `/admin/users`. It takes no
 * lock and inserts no anchor, on the same reasoning as `ingestEligibility`: a
 * question should not write, and a missing row is the free tier exactly as it is
 * under the lock.
 */
export async function accountSnapshot(ownerId: string): Promise<AccountSnapshot | undefined> {
  const [row] = await getDb()
    .select({
      ...BILLING_COLUMNS,
      cancelAtPeriodEnd: billingAccounts.cancelAtPeriodEnd,
      cancelAt: billingAccounts.cancelAt,
    })
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerId, ownerId))
    .limit(1);
  return row;
}

/**
 * Every billing row there is — the one read here that is not owner-scoped.
 *
 * `/admin/users` needs one row per account and there is no owner to filter by,
 * which is the same exemption `src/store/pg-admin.ts` documents at length for
 * the five count queries. It is called from there and nowhere else; a second
 * caller should be a second look at whether it is allowed.
 */
export async function allAccountSnapshots(): Promise<Map<string, AccountSnapshot>> {
  const rows = await getDb()
    .select({
      ownerId: billingAccounts.ownerId,
      ...BILLING_COLUMNS,
      cancelAtPeriodEnd: billingAccounts.cancelAtPeriodEnd,
      cancelAt: billingAccounts.cancelAt,
    })
    .from(billingAccounts);
  return new Map(rows.map(({ ownerId, ...row }) => [ownerId, row]));
}

/**
 * Take a slot for a new ingest, or refuse.
 *
 * One transaction, one connection, nothing else called from inside it. The
 * returned `reservationId` must be handed to `enqueue()` so that it lands in the
 * job's own INSERT — see `jobs.ingest_event_id`. If it never reaches a job,
 * `releaseReservation` gives it back.
 *
 * @param tiers what we sell, from `billing_tiers`. Defaults to the cached read;
 * an empty list means no tier has a Stripe price yet, so nobody is entitled and
 * everybody gets the free allowance — the right behaviour for a deployment
 * where the setup script has not been run.
 * @param slug the intended slug, stored as a diagnostic only — it is mutable,
 * so it is never this row's identity.
 */
/**
 * **The fewest articles this owner could share to get back under the wall**, or
 * `undefined` when sharing every one of them still would not.
 *
 * Grouped by `article_id` and taken largest group first, which is what makes the
 * answer *fewest*: a re-added URL owns several charged rows and sharing that one
 * article frees all of them at once, so counting rows would promise
 * *"share three articles"* to somebody for whom one would do — and, the other way
 * round, would be false when three rows' worth of points come from one article.
 * GPT Sol, 2026-09-04.
 *
 * **Weighted by kind, and minimal papers left out** (Opus's review of 261001m).
 * An ingest or a High-powered AI row frees {@link PUBLIC_INGEST_COST} when its
 * article is shared — 200 becomes 100. A minimal row frees nothing, because it
 * is never priced by visibility, and an article with only a minimal row is not
 * offered at all: sharing one is refused anyway, and the offer must never name
 * a PDF nobody has read. The stop condition is `admitsIngest`, the wall's own
 * predicate, so the offer answers exactly the question the refusal asked.
 *
 * **Inside the caller's transaction and under the same lock**, so the number a
 * refusal states was true of the same instant the refusal was decided. It opens
 * no transaction of its own and touches no network, which is the rule the locked
 * section is held to.
 *
 * Rows whose article cannot be resolved are absent by construction — an inner
 * join — which is right: there is nothing about them a reader could share.
 *
 * **It returns the articles and not how many**, which is the difference between
 * an offer and a nudge towards publishing the wrong thing — see
 * `Refused.shareToMakeRoom`. The title is `coalesce(title_override, the current
 * revision's title, slug)`, the same expression the shelf reads by
 * (`pg-shelf.ts`), so the name in the sentence is the name in the library. The
 * revision join is a `left` one: an article whose ingest never published has no
 * current revision and still counts against the allowance.
 *
 * **Ordered by slug after the group size**, so that two articles with the same
 * number of charged rows come out in the same order twice running. Without it
 * the sentence a reader is shown could name a different article on a reload.
 */
async function articlesToShare(
  tx: HasExecute,
  ownerId: string,
  entitlement: Entitlement,
  usage: Usage,
): Promise<readonly [ShareCandidate, ...ShareCandidate[]] | undefined> {
  const budget = budgetFor(entitlement.limit);
  const used = wallUsed(usage);
  const rows = rowsOf(
    await tx.execute(sql`
      select count(*)::int as charged_rows,
             a.slug as slug,
             coalesce(a.title_override, r.title, a.slug) as title
        from spideryarn.ingest_events e
        join spideryarn.articles a on a.id = e.article_id
        left join spideryarn.article_revisions r on r.id = a.current_revision_id
       where e.owner_id = ${ownerId}::uuid
         and e.kind in ('ingest', 'high_power')
         and ${chargedIn(entitlement)}
         and not (${IS_PUBLIC})
       group by e.article_id, a.slug, a.title_override, r.title
       order by count(*) desc, a.slug asc`),
  );

  let freed = 0;
  /* The head is held apart from the tail so that the return is a non-empty
     tuple without a cast — the type says *at least one*, and `undefined` is the
     only way to say none. */
  let head: ShareCandidate | undefined;
  const rest: ShareCandidate[] = [];
  for (const row of rows) {
    const cells = row as Record<string, unknown>;
    /* Each charged row goes from 200 to 100 when its article is shared. */
    const chargedRows = Number(cells.charged_rows);
    if (!Number.isInteger(chargedRows) || chargedRows <= 0) continue;
    /* The coalesce cannot return null and a slug is never empty, so this is a
       guard against a shape that changed rather than against the data. */
    const title = String(cells.title ?? "").trim() || String(cells.slug ?? "").trim();
    if (!title) continue;
    freed += chargedRows * (PRIVATE_INGEST_COST - PUBLIC_INGEST_COST);
    const candidate: ShareCandidate = { title };
    if (head === undefined) head = candidate;
    else rest.push(candidate);
    if (admitsIngest(points(used - freed), budget)) return [head, ...rest];
  }
  return undefined;
}

/**
 * **Would sharing anything make room?** — the wall's own question, asked by the
 * page that offers sharing before a refusal has happened.
 *
 * `/profile` used to say *"sharing more makes room"* whenever any private
 * article existed, which is false for the reader whose charged rows all predate
 * the discount — that is every row charged before 2026-09-05 — and false again
 * for the reader who has unshared their way past the wall, where sharing every
 * article they own would still not get them under it. There is no way to answer
 * it from the usage counts, so it is this query or it is a sentence that
 * cannot be believed. **Asked only at the wall**, which is the only place the
 * page says it.
 */
export async function sharingWouldMakeRoom(
  ownerId: string,
  entitlement: Entitlement,
  usage: Usage,
): Promise<boolean> {
  return (await articlesToShare(getDb(), ownerId, entitlement, usage)) !== undefined;
}

/**
 * **The owner's billing row, created if absent, locked, and returned.**
 *
 * The two lines this whole file is about, in one place because a second caller
 * arrived: `pg-visibility.ts` takes this lock before it touches an article, so
 * that an unshare cannot commit between an admission's usage read and its
 * reservation. See § *The lock order* in the header.
 *
 * **`insert … on conflict do nothing` first, and it is not defensive tidying.**
 * A free reader has no billing row, and a `FOR UPDATE` that matches nothing
 * locks nothing (docs/postmortems/260901f-a-for-update-that-locks-nothing.md),
 * so locking a row that might not exist would serialise nobody *in exactly the
 * case the boundary is for*. `do nothing` rather than `do update` because there
 * is nothing to change — the row's existence is the whole point, and an update
 * would touch `updated_at` on every ingest for no reason.
 */
export async function lockBillingAccount(
  tx: Pick<ReturnType<typeof getDb>, "insert" | "select">,
  ownerId: string,
): Promise<BillingRow> {
  await tx
    .insert(billingAccounts)
    .values({ ownerId })
    .onConflictDoNothing({ target: billingAccounts.ownerId });

  const [locked] = await tx
    .select({ ownerId: billingAccounts.ownerId })
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerId, ownerId))
    .for("update")
    .limit(1);
  /* **And the row read again, in a statement of its own, after the lock is
     held.** At `read committed` each statement takes a fresh snapshot, so this
     one sees everything committed before the lock was granted — including a
     voucher revoked or shrunk by src/store/pg-vouchers.ts, which takes this
     same lock to do it. Read in the locking statement, the voucher subquery
     would answer from the snapshot taken *before* the wait, and a revoke racing
     an admission could be admitted past (GPT Sol, plan review F2). */
  const [row] = locked
    ? await tx.select(BILLING_COLUMNS).from(billingAccounts).where(eq(billingAccounts.ownerId, ownerId)).limit(1)
    : [];
  if (!row) {
    /* Unreachable — the insert above guarantees a row and this transaction
       holds it. Loud rather than silent, because the only way here is the
       failure this whole file is about. */
    throw new Error(`billing_accounts row for ${ownerId} vanished under its own lock`);
  }
  return row;
}

export async function reserveIngest(
  ownerId: string,
  slug?: string,
  tiers?: readonly TierRow[],
): Promise<Admission> {
  /* Read before the transaction opens, never inside it: this is a second query
     and the rule for the locked section is that nothing else runs in it. */
  const sold = tiers ?? (await allTiers());
  return await getDb().transaction(
    async (tx) => {
      /* The anchor, created and then locked — see `lockBillingAccount`. Every
         other admission for this owner waits here, and so does every visibility
         change, which is what stops an unshare landing between the count below
         and the reservation. The entitlement comes from *this* read, inside the
         lock, so a webhook cannot change it underneath the count either. */
      const row = await lockBillingAccount(tx, ownerId);

      const entitlement = entitlementFromRow(row, sold, new Date());
      if ("kind" in entitlement) return entitlement; // stale

      const usage = usageOf(await tx.execute(usageSql(ownerId, entitlement)));
      const refused = refusalFor(entitlement, usage, row);
      if (refused) {
        /* Only on the way out, so an ordinary admission pays nothing for it. */
        const shareToMakeRoom = await articlesToShare(tx, ownerId, entitlement, usage);
        return shareToMakeRoom === undefined ? refused : { ...refused, shareToMakeRoom };
      }

      const [reservation] = await tx
        .insert(ingestEvents)
        .values({ ownerId, ...(slug ? { slug } : {}) })
        .returning({ id: ingestEvents.id });
      if (!reservation) throw new Error("reserving an ingest slot returned no row");
      return { kind: "admitted", reservationId: reservation.id, entitlement } satisfies Admitted;
    },
    /* Pinned rather than inherited. `on conflict do nothing` is only an escape
       from a concurrent writer at `read committed`; at `repeatable read` it
       raises 40001 at the insert, and nothing in src/ retries that
       (docs/postmortems/260901f-…). Every other transaction in the store is
       pinned for the same reason. */
    { isolationLevel: "read committed" },
  );
}

/* ------------------------------------------------------ minimal papers -- */

/**
 * The transaction handle a locked admission runs in — what `inLock` is given.
 * Drizzle's own type, named so a caller can write a callback against it.
 */
export type BillingTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * **Work a caller needs done under the same billing lock as a minimal
 * reservation, in the same transaction.** Stage 3 of plan 261001m is the
 * caller: the duplicate check (*is this paper already on your shelf?*) and the
 * claim of the upload, so that two tabs dropping one folder produce one paper.
 *
 * - It runs **after** the quota check and **after** the reservation row is
 *   written, so `reservationId` is the row it may link to. For the
 *   administrator, who reserves nothing, `reservationId` is null and the
 *   callback still runs under the owner's billing lock (`runUnderBillingLock`).
 * - **To decline, throw.** The throw rolls back the whole transaction — the
 *   reservation and anything the callback wrote — and propagates out of
 *   `reserveMinimal` unchanged, so a route can throw its own 409.
 * - It is inside the locked section, so the rule there is its rule too:
 *   **nothing that opens its own transaction and nothing that touches the
 *   network.** Use `tx` and only `tx`.
 * - A quota refusal happens before it runs, so a paper that is both a duplicate
 *   and over the allowance is told about the allowance. A caller that wants the
 *   duplicate answer first can ask an unlocked question before admission.
 */
export type InLock = (
  tx: BillingTx,
  context: { readonly reservationId: string | null; readonly ownerId: string },
) => Promise<void>;

/** A minimal paper does not fit. Carries what `minimalQuotaReached` says. */
export interface MinimalRefused {
  readonly kind: "refused";
  /**
   * **How many more minimal papers would be admitted** — `minimalHeadroom`,
   * exact. Zero for the reservation that was refused (it did not fit), and the
   * number a batch's door can say before it starts.
   */
  readonly fits: number;
  /** The allowance, in articles, for the sentence. */
  readonly limit: Articles;
  /** When a paid allowance starts again. Absent for Free, which is lifetime. */
  readonly resetAt?: Date;
}

export type MinimalAdmission = Admitted | MinimalRefused | Stale;

/**
 * **Take a slot for a minimal paper, or refuse** — the same shape as
 * `reserveIngest`, at 2 points rather than 200.
 *
 * Insert-then-lock the billing row, read usage with every unsettled reservation
 * under that lock, decide with `admitsMinimal` (`used + 2 <= budget`: no
 * overdraft, so a batch of a thousand never steps past the wall), and write a
 * `kind = 'minimal'` reservation. Nothing that touches the network runs inside;
 * see the header. Then `inLock`, if given, in the same transaction.
 */
export async function reserveMinimal(
  ownerId: string,
  options: { readonly slug?: string; readonly tiers?: readonly TierRow[]; readonly inLock?: InLock } = {},
): Promise<MinimalAdmission> {
  const sold = options.tiers ?? (await allTiers());
  return await getDb().transaction(
    async (tx): Promise<MinimalAdmission> => {
      const row = await lockBillingAccount(tx, ownerId);
      const entitlement = entitlementFromRow(row, sold, new Date());
      if ("kind" in entitlement) return entitlement; // stale

      const usage = usageOf(await tx.execute(usageSql(ownerId, entitlement)));
      const used = wallUsed(usage);
      const budget = budgetFor(entitlement.limit);
      if (!admitsMinimal(used, budget)) {
        return {
          kind: "refused",
          fits: minimalHeadroom(used, budget),
          limit: entitlement.limit,
          ...(entitlement.tier === "paid" ? { resetAt: entitlement.periodEnd } : {}),
        };
      }

      const [reservation] = await tx
        .insert(ingestEvents)
        .values({ ownerId, kind: "minimal", ...(options.slug ? { slug: options.slug } : {}) })
        .returning({ id: ingestEvents.id });
      if (!reservation) throw new Error("reserving a minimal paper returned no row");
      if (options.inLock) await options.inLock(tx, { reservationId: reservation.id, ownerId });
      return { kind: "admitted", reservationId: reservation.id, entitlement } satisfies Admitted;
    },
    /* Pinned, for the reason `reserveIngest` gives. */
    { isolationLevel: "read committed" },
  );
}

/**
 * Run `inLock` under the owner's billing lock **without reserving anything** —
 * the administrator's path through `withMinimalSlot`, so the duplicate check
 * and the claim are serialised for them too. The anchor row is created if
 * absent, as every lock here does; it costs nothing and counts nothing.
 */
export async function runUnderBillingLock(ownerId: string, inLock: InLock): Promise<void> {
  await getDb().transaction(
    async (tx) => {
      await lockBillingAccount(tx, ownerId);
      await inLock(tx, { reservationId: null, ownerId });
    },
    { isolationLevel: "read committed" },
  );
}

/* ------------------------------------------------ Read this on a paper -- */

/**
 * What *Read this* on a minimal paper came to. See `reserveUpgrade`.
 *
 * `refused` is the ingest wall's own refusal, sharing offer and all — *Read
 * this* is an ingest at the wall, crediting what the paper already paid.
 */
export type UpgradeAdmission =
  | Admitted
  | Refused
  | Stale
  /** Not this owner's article, no such article, or no live minimal charge to upgrade. */
  | { readonly kind: "not-found" }
  /** A *Read this* on this article is already in flight; one at a time. */
  | { readonly kind: "in-flight" };

/**
 * **Find this article's one live minimal charge, and say whether it is inside
 * the window `used` counts.** A live row is charged and not yet superseded. No
 * row means this is not a minimal paper that can be upgraded; more than one is
 * a broken ledger and fails closed. The one row earns 2 points of credit only
 * when it is in-window (Opus's review: the credit is this paper's own row, not
 * a constant).
 */
async function upgradeCredit(
  tx: HasExecute,
  ownerId: string,
  articleId: string,
  entitlement: Entitlement,
): Promise<UpgradeCredit | undefined> {
  const rows = rowsOf(
    await tx.execute(sql`
      select (${chargedIn(entitlement)}) as credited
        from spideryarn.ingest_events e
       where e.owner_id = ${ownerId}::uuid
         and e.article_id = ${articleId}::uuid
         and e.kind = 'minimal'
         and e.succeeded_at is not null
         and e.superseded_by is null
       limit 2`),
  );
  if (rows.length === 0) return undefined;
  if (rows.length > 1) {
    throw new Error(
      `article ${articleId} has ${rows.length} live minimal charges; one paper has one, so Read this is refused`,
    );
  }
  return rows[0]?.credited === true ? MINIMAL_CREDIT : 0;
}

/** Postgres's `unique_violation`, on the one index this insert can meet. */
function isOneUpgradeViolation(err: unknown): boolean {
  const e = err as { code?: unknown; constraint?: unknown; cause?: { code?: unknown; constraint?: unknown } };
  const code = e?.code ?? e?.cause?.code;
  const constraint = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && constraint === "ingest_events_one_upgrade_in_flight";
}

/**
 * **Take a slot for *Read this* on a minimal paper, or refuse** — the ingest
 * wall, crediting what the paper already paid.
 *
 * Under the billing lock, then the article `for update` — the house lock order:
 *
 * 1. the article must be this owner's;
 * 2. **one at a time**: an unsettled `'ingest'` row already bound to this
 *    article refuses (`in-flight`), so two presses cannot both take the credit;
 *    `ingest_events_one_upgrade_in_flight` is the backstop;
 * 3. there must be exactly one charged, unsuperseded minimal row for this
 *    paper; its credit is 2 iff it is in-window (`upgradeCredit`), else 0;
 * 4. `admitsUpgrade(used, budget, credit)`: `used + (200 − credit) <= budget + 100`;
 * 5. an ordinary `kind = 'ingest'` row is written **with `article_id` set at
 *    birth** — which is what makes it a *Read this* reservation rather than an
 *    ordinary one, for retry and for settlement (Sol's plan review, P1).
 *
 * The settlement that charges it must supersede the minimal row in the same
 * transaction — `supersedeMinimal`, which Stage 3 wires into the publication.
 */
export async function reserveUpgrade(
  ownerId: string,
  articleId: string,
  tiers?: readonly TierRow[],
): Promise<UpgradeAdmission> {
  const sold = tiers ?? (await allTiers());
  const db = getDb();
  /* **Is there anything here to charge for?** Unlocked and before any write, as
     in `switchOnHighPower`: the next step creates the caller's billing anchor,
     and a stranger's article id should be a 404 without minting one. */
  const [present] = await db
    .select({ id: articleRows.id })
    .from(articleRows)
    .where(and(eq(articleRows.id, articleId), eq(articleRows.ownerId, ownerId)))
    .limit(1);
  if (!present) return { kind: "not-found" };

  try {
    return await db.transaction(
      async (tx): Promise<UpgradeAdmission> => {
        const row = await lockBillingAccount(tx, ownerId);
        const [article] = await tx
          .select({ id: articleRows.id, slug: articleRows.slug })
          .from(articleRows)
          .where(and(eq(articleRows.id, articleId), eq(articleRows.ownerId, ownerId)))
          .for("update")
          .limit(1);
        if (!article) return { kind: "not-found" };

        const entitlement = entitlementFromRow(row, sold, new Date());
        if ("kind" in entitlement) return entitlement; // stale

        const busy = rowsOf(
          await tx.execute(sql`
            select 1 from spideryarn.ingest_events
             where article_id = ${articleId}::uuid and kind = 'ingest'
               and succeeded_at is null and released_at is null
             limit 1`),
        );
        if (busy.length > 0) return { kind: "in-flight" };

        const usage = usageOf(await tx.execute(usageSql(ownerId, entitlement)));
        const credit = await upgradeCredit(tx, ownerId, articleId, entitlement);
        if (credit === undefined) return { kind: "not-found" };
        if (!admitsUpgrade(wallUsed(usage), budgetFor(entitlement.limit), credit)) {
          const lapsed = hasLapsed(row);
          const refused: Refused = {
            kind: "refused",
            used: ingestsUsed(usage),
            limit: entitlement.limit,
            ...(entitlement.tier === "paid" ? { resetAt: entitlement.periodEnd } : {}),
            ...(lapsed ? { lapsed: true as const } : {}),
          };
          const shareToMakeRoom = await articlesToShare(tx, ownerId, entitlement, usage);
          return shareToMakeRoom === undefined ? refused : { ...refused, shareToMakeRoom };
        }

        const [reservation] = await tx
          .insert(ingestEvents)
          .values({ ownerId, kind: "ingest", articleId, slug: article.slug })
          .returning({ id: ingestEvents.id });
        if (!reservation) throw new Error("reserving Read this returned no row");
        return { kind: "admitted", reservationId: reservation.id, entitlement } satisfies Admitted;
      },
      { isolationLevel: "read committed" },
    );
  } catch (err) {
    /* Unreachable while the check above runs under the owner's lock — every
       writer of an ingest row for this owner waits on it — and kept so the
       backstop answers in the same words if it is ever the thing that fires. */
    if (isOneUpgradeViolation(err)) return { kind: "in-flight" };
    throw err;
  }
}

/**
 * **What a reservation was, for a retry to take the same kind again.**
 *
 * `minimal` — a minimal paper; `upgrade` — *Read this*, an `'ingest'` row that
 * named its article from birth and has not been charged; `ingest` — everything
 * else. An ordinary ingest names an article only in the statement that charges
 * it, so an uncharged `'ingest'` row with an article is a *Read this* and
 * nothing else. Undefined when the row is not this owner's or is not there.
 */
export type ReservationShape =
  | { readonly kind: "ingest" }
  | { readonly kind: "minimal" }
  | { readonly kind: "upgrade"; readonly articleId: string };

export async function reservationShapeOf(
  ingestEventId: string,
  ownerId: string,
): Promise<ReservationShape | undefined> {
  const [row] = await getDb()
    .select({
      kind: ingestEvents.kind,
      articleId: ingestEvents.articleId,
      succeededAt: ingestEvents.succeededAt,
    })
    .from(ingestEvents)
    .where(and(eq(ingestEvents.id, ingestEventId), eq(ingestEvents.ownerId, ownerId)))
    .limit(1);
  if (!row) return undefined;
  if (row.kind === "minimal") return { kind: "minimal" };
  if (row.kind === "ingest" && row.articleId !== null && row.succeededAt === null) {
    return { kind: "upgrade", articleId: row.articleId };
  }
  return { kind: "ingest" };
}

/**
 * **Mark this article's minimal paper as paid for by `ingestEventId`** — the
 * write that makes a paper total exactly one ingest.
 *
 * For Stage 3's settlement, **inside the publication transaction that charges
 * `ingestEventId`**, after `settleReservation(tx, ingestEventId, succeeded)`
 * and in the same `tx`. It stamps `superseded_by` on the article's charged,
 * unsuperseded minimal row and returns how many it stamped: 1 normally, 0 when
 * the article has no such row (an article that was never minimal, or already
 * superseded). **More than one throws**, and the throw takes the publication
 * with it — one paper has one minimal row, and two would mean the ledger has
 * charged a paper twice.
 *
 * Whether 0 is an error is the caller's to decide: plan 261001m says a
 * target-bound settlement that supersedes nothing rolls back. The database
 * holds the rest — `ingest_events_superseded_shape` (only a charged minimal
 * row) and the trigger `ingest_events_superseded_by_ingest` (the payer is a
 * charged ingest of the same owner and article), so calling this before the
 * ingest is charged raises 23514.
 */
export async function supersedeMinimal(
  tx: HasExecute,
  articleId: string,
  ingestEventId: string,
): Promise<number> {
  const stamped = rowsOf(
    await tx.execute(sql`
      update spideryarn.ingest_events
         set superseded_by = ${ingestEventId}::uuid
       where article_id = ${articleId}::uuid
         and kind = 'minimal'
         and succeeded_at is not null
         and superseded_by is null
      returning id`),
  ).length;
  if (stamped > 1) {
    throw new Error(
      `article ${articleId} has ${stamped} charged minimal rows; one paper has one, so this ` +
        "publication is refused rather than superseding them all",
    );
  }
  return stamped;
}

/**
 * What switching an article to High-powered AI came to. See `switchOnHighPower`.
 */
export type HighPowerSwitch =
  /** On. `charged` says whether this call wrote the upgrade row. */
  | { readonly kind: "on"; readonly highPowerSince: Date; readonly charged: boolean }
  /** Not this owner's article, or no such article. The route's 404. */
  | { readonly kind: "not-found" }
  /**
   * Too little allowance left for the upgrade to fit whole. Nothing written.
   * `publicNow` is the price's reason, for the sentence (`highPowerNoRoom`).
   */
  | {
      readonly kind: "no-room";
      readonly publicNow: boolean;
      readonly entitlement: Entitlement;
    }
  | Stale;

/**
 * **Switch one article to High-powered AI, charging for it once** —
 * docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md.
 *
 * Greg, 2026-09-30: *"it should double the processing cost per-article"*. So the
 * switch writes one more charged `ingest_events` row for the article, of `kind`
 * `'high_power'`, priced exactly like an ingest of it — 200 points while the
 * article is private, 100 while it is public, recomputed live and frozen on delete
 * by the same rules and the same trigger. With the ingest, a private article
 * costs two articles and a public one costs one.
 *
 * **Once per article, for ever.** Switching off refunds nothing — the Opus calls
 * were spent — and switching on again charges nothing: the row is looked for
 * under the lock, and `ingest_events_high_power_once` refuses a second one. That
 * is what closes *switch on, run everything on Opus, switch off*.
 *
 * **Charged in the period it happens in**, by its own `succeeded_at`, whatever
 * the age of the article. Multiplying the ingest's row would have charged a
 * three-month-old article's upgrade to three months ago (GPT Sol, 260930f F3).
 *
 * **It must fit whole: `admitsHighPower`, `used + cost <= budget`.** Not the
 * ingest wall's `admitsIngest`, whose half-article of overdraft exists so a free account can
 * make six public articles; an upgrade is a second charge for something already
 * had, and gets no overdraft.
 *
 * ## One transaction, in the house lock order
 *
 * `billing_accounts` first (`lockBillingAccount`), then the article `for update`
 * — the order `pg-visibility.ts` and admission take, so an unshare cannot land
 * between the price read and the charge, and two switch-ons serialise here: the
 * second finds the first's row and charges nothing. Admitting, charging and
 * setting `high_power_since` commit together or not at all. Nothing that opens
 * its own transaction or touches the network runs inside it; a `stale` answer
 * goes back to the caller, which resyncs from Stripe after this has committed.
 *
 * The administrator never comes here — `chargeAndSwitchOnHighPower` in
 * src/billing/admission.ts sends them to the uncharged store method, as ingests
 * do.
 */
export async function switchOnHighPower(
  ownerId: OwnerId,
  slug: string,
  tiers?: readonly TierRow[],
): Promise<HighPowerSwitch> {
  const sold = tiers ?? (await allTiers());
  const db = getDb();
  /* **Is there anything here to change?** Unlocked and before any write, as in
     `pg-visibility.ts`: the next step creates the caller's billing anchor, and
     a stranger's slug should be a 404 without minting one. The locked read
     below is the real ownership check. */
  const [present] = await db
    .select({ id: articleRows.id })
    .from(articleRows)
    .where(ownedSlug(slug, ownerId))
    .limit(1);
  if (!present) return { kind: "not-found" };

  return await db.transaction(
    async (tx): Promise<HighPowerSwitch> => {
      const row = await lockBillingAccount(tx, ownerId);
      const [article] = await tx
        .select({
          id: articleRows.id,
          slug: articleRows.slug,
          visibility: articleRows.visibility,
          highPowerSince: articleRows.highPowerSince,
        })
        .from(articleRows)
        .where(ownedSlug(slug, ownerId))
        .for("update")
        .limit(1);
      if (!article) return { kind: "not-found" };

      /* One post-lock database instant decides both which Stripe period is live
         and where the charge lands. A JavaScript clock read here paired with
         `now()` below had a boundary hole: after waiting on either lock, it
         could admit against the new period while PostgreSQL's
         transaction-start `now()` wrote the row just before that period. */
      const clock = await tx.execute<{ charged_at: unknown }>(sql`
        select statement_timestamp() as charged_at`);
      /* The raw driver hands a timestamptz back as text, not a Date — parsed
         here, and refused if it is not a time, rather than bound as a string
         the columns would have to reinterpret. */
      const raw = clock.rows[0]?.charged_at;
      const chargedAt = raw instanceof Date ? raw : new Date(String(raw));
      if (raw == null || Number.isNaN(chargedAt.getTime())) {
        throw new Error(`reading the High-powered AI charge time returned ${String(raw)}`);
      }
      const entitlement = entitlementFromRow(row, sold, chargedAt);
      if ("kind" in entitlement) return entitlement; // stale

      const [already] = await tx
        .select({ id: ingestEvents.id })
        .from(ingestEvents)
        .where(and(eq(ingestEvents.kind, "high_power"), eq(ingestEvents.articleId, article.id)))
        .limit(1);

      if (!already) {
        const publicNow = article.visibility === "public";
        const cost = publicNow ? PUBLIC_INGEST_COST : PRIVATE_INGEST_COST;
        const usage = usageOf(await tx.execute(usageSql(ownerId, entitlement)));
        if (!admitsHighPower(wallUsed(usage), budgetFor(entitlement.limit), cost)) {
          return { kind: "no-room", publicNow, entitlement };
        }
        /* The same database timestamp in both columns: the shape check wants
           `reserved_at = succeeded_at`, and it must also be the timestamp that
           selected the entitlement above. */
        await tx.execute(sql`
          insert into spideryarn.ingest_events
            (owner_id, kind, reserved_at, succeeded_at, article_id, slug)
          values (${ownerId}::uuid, 'high_power', ${chargedAt}, ${chargedAt},
                  ${article.id}::uuid, ${article.slug})`);
      }

      if (article.highPowerSince) {
        return { kind: "on", highPowerSince: article.highPowerSince, charged: !already };
      }
      const [updated] = await tx
        .update(articleRows)
        /* `updated_at` with it: the reader changed this article's settings.
           Only on this branch — the early return above is a repeat of a switch
           already made, and moves no clock. */
        .set({ highPowerSince: chargedAt, updatedAt: chargedAt })
        .where(eq(articleRows.id, article.id))
        .returning({ highPowerSince: articleRows.highPowerSince });
      if (!updated?.highPowerSince) {
        throw new Error(`switching ${slug} to High-powered AI wrote no row under its own lock`);
      }
      return { kind: "on", highPowerSince: updated.highPowerSince, charged: !already };
    },
    /* Pinned, for the reason `reserveIngest` gives. */
    { isolationLevel: "read committed" },
  );
}

/**
 * Give back a slot **only if no job is spending it**.
 *
 * For the paths that reserved and then could not enqueue: `enqueue()` threw, or
 * it deduplicated this request onto an existing job carrying its own
 * reservation.
 *
 * **The `not exists` is load-bearing and an earlier version did not have it.**
 * The comment then said an `enqueue()` throw proves no job exists. It does not:
 * an INSERT can commit and the response be lost, and the caller sees a throw
 * over a job that is now running. Releasing there would let that job publish
 * against a released reservation — `settleReservation` would match nothing and
 * the ingest would be free. GPT Sol, 2026-09-02.
 *
 * **Releasing by *job* must never come through here**, and the `not exists` is
 * also what stops it: at the two sites that end a job nobody is inside —
 * `settleExpired` and `requestCancel`'s terminal branch — the job row exists, so
 * this would refuse. Those go through `settleReservation` in the same
 * transaction as the transition that ended the job, which is what stops a
 * `/cancel` losing a race with the publication it was trying to stop.
 *
 * ## The precondition the `not exists` rests on, and what breaks if it goes
 *
 * **Only the request that reserved may call this, and only after its own
 * `enqueue()` has returned.** That is what makes one unlocked statement enough,
 * and it is worth writing down because it is not visible from here.
 *
 * GPT Sol raised the interleaving this guard cannot see (2026-09-03,
 * docs/plans/260902i-settlement-code-review-sol.md finding 2): T1 inserts a job
 * naming reservation R and has not committed; T2 releases R, cannot see T1's
 * row, and sets `released_at`; T1 then commits, because the foreign key asks
 * only that R exist and not that it be unsettled. The job runs and can never
 * publish, because the strict charge finds a released reservation.
 *
 * It is unreachable by construction rather than by locking. A reservation has
 * exactly one actor — the request that took it — and that request does reserve,
 * enqueue, and only then release, strictly in sequence on one call stack. There
 * is no second transaction to interleave with, so T1 and T2 above cannot both
 * exist. Written down rather than fixed, deliberately: the fix would be a
 * trigger or a lock-and-insert primitive, and neither is worth building for a
 * state nothing can reach.
 *
 * **So if that precondition ever stops holding** — a sweeper that releases
 * reservations by age, a retry path that releases somebody else's, an
 * `enqueue()` moved onto its own connection and awaited elsewhere — the race
 * becomes real and this guard is not enough on its own.
 *
 * @returns whether the slot was actually given back.
 */
export async function releaseReservation(reservationId: string): Promise<boolean> {
  /* `now()` rather than `new Date()`: the constraint that terminal timestamps
     may not precede `reserved_at` is checked by Postgres against Postgres's
     clock, and a serverless host running a few seconds behind would violate it
     and leak the slot for ever. */
  const result = await getDb().execute(sql`
    update spideryarn.ingest_events
       set released_at = now()
     where id = ${reservationId}::uuid
       and succeeded_at is null
       and released_at is null
       and not exists (
         select 1 from spideryarn.jobs where ingest_event_id = ${reservationId}::uuid
       )
    returning id`);
  return rowsOf(result).length === 1;
}

/**
 * **How a job ended, and — when it succeeded — what it produced.**
 *
 * A discriminated union rather than a string plus an optional article id, and
 * that is the single most valuable guard in this change (GPT Sol rated it above
 * every other finding, 2026-09-04). A currently-public article costs half, which
 * the usage query can only know by resolving `ingest_events.article_id`; an
 * *optional* argument would let a future settlement site omit the link and
 * charge that reader's public article full price for ever, with nothing red and
 * nothing logged. Legacy rows make a `NOT NULL` constraint impossible, so the
 * type is the only guard available — and it works because there is no way to
 * spell a successful settlement without the id.
 *
 * `articleId` is in scope at the one site that charges: `settleIn` in
 * ./pg-session.ts already holds `ref.articleId`, already cross-checked against
 * the locked article row by `lockArticleFor`. The other six settlement sites all
 * release, and a released row needs no article.
 */
export type Settlement =
  | { readonly kind: "succeeded"; readonly articleId: string }
  | { readonly kind: "released" };

/** The one value the six releasing sites pass. A constant so they cannot differ. */
export const RELEASED: Settlement = { kind: "released" };

/**
 * The transaction handle the caller is already inside.
 *
 * **This type enforces nothing**, and saying so is the point: `getDb()` also has
 * an `execute`, so `settleReservation(getDb(), …)` type-checks and would be
 * wrong. An earlier version of this was called `SettlementTx`, which implied a
 * guarantee it could not give (GPT Sol, 2026-09-02). What actually enforces the
 * rule is where the one correct caller lives — inside `settleIn`'s transaction
 * — and the row assertion below, which turns a misuse into a throw rather than
 * a silent no-op.
 */
export interface HasExecute {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

/**
 * Settle a job's reservation **inside the transaction that ends the job**.
 *
 * This is the guarantee the whole design rests on: the charge commits with the
 * revision it is charging for, and the release commits with the failure it is
 * excusing. There is no window in which an ingest has succeeded and not been
 * counted, none in which a failure has been charged, and no way for a cancel
 * racing a publication to leave the two disagreeing — whichever transition wins
 * the job fence is the one whose settlement lands, because they are the same
 * transaction.
 *
 * **The charge is strict and the release is tolerant**, and the split is carried
 * by the `outcome` rather than by a second argument — there is no caller that
 * wants a strict release or a tolerant charge, so a flag would be a parameter
 * with one correct value at every call site and one more thing to get wrong.
 *
 * **`"succeeded"` throws when it does not match exactly one row**, and taking
 * the whole transaction down with it is the intended behaviour. Zero rows means
 * the reservation is missing, already charged, or already released — and
 * committing a publication over that would be the free ingest this file exists
 * to prevent. The earlier version updated and did not look, so the "atomic
 * charge" it claimed was not one.
 *
 * **`"released"` logs and returns**, because a release runs on the paths that
 * end a job the reader did not get: a Stop, a lapsed lease, a failed step. A
 * throw there turns the Stop button into a 500 and leaves the job un-ended,
 * which is strictly worse than a slot nobody gave back.
 *
 * **Tolerance is not what makes a cancel racing a publication settle once** —
 * an earlier version of this comment said it was, and GPT Sol showed it does not
 * even arise (2026-09-03, docs/plans/260902i-settlement-code-review-sol.md).
 * The loser of that race never reaches settlement at all: a `requestCancel` that
 * lost matches no `ACTIVE` row and returns before settling, and a claimant that
 * lost raises `StaleAttemptError` out of `finishIn` above its own settlement.
 * The job fence does the whole job; tolerance covers the different case of a
 * reservation that really was settled already.
 *
 * A **null** `ingestEventId` settles nothing and is not an error: pipeline work
 * from the CLI, a re-run of one step, seeding. The caller passes what the job
 * carries and does not have to know which kind it has — which is what lets the
 * seven sites that end a job call this unconditionally.
 */
export async function settleReservation(
  tx: HasExecute,
  ingestEventId: string | null | undefined,
  outcome: Settlement,
): Promise<void> {
  if (!ingestEventId) return;
  if (outcome.kind === "released") return await releaseReservations(tx, [ingestEventId]);

  /* **`succeeded_at` and `article_id` in the same statement.** Two updates would
     be two chances for the second not to happen — and a charged row with no
     article is charged full price for ever, silently. See `Settlement`.

     **A *Read this* reservation already names its article** (`reserveUpgrade`),
     and it may only settle onto that one: a row bound to paper A charged for a
     publication of B would leave A's credit taken and B's paper unpaid. So the
     match also asks the existing link to be absent or the same, and a mismatch
     is the strict charge's throw. */
  const result = await tx.execute(
    sql`update spideryarn.ingest_events
           set succeeded_at = now(), article_id = ${outcome.articleId}::uuid
         where id = ${ingestEventId}::uuid
           and succeeded_at is null and released_at is null
           and (article_id is null or article_id = ${outcome.articleId}::uuid)
       returning id`,
  );
  if (rowsOf(result).length === 1) return;
  throw new Error(
    `ingest reservation ${ingestEventId} could not be settled as succeeded — it is missing or ` +
      "already settled, and committing over that would give away an ingest",
  );
}

/**
 * Release these reservations in one statement, and **say which would not move**.
 *
 * The set-based form of the tolerant half of `settleReservation`, and the only
 * one there is — the single-id case delegates here, so the rule about what a
 * zero-row release means is written once. `settleExpired` (src/store/pg-jobs.ts)
 * is the caller with more than one: it used to issue a statement per settled job
 * while holding every one of their row locks for the rest of the transaction,
 * and the comment justifying that said "usually none, occasionally one" —
 * untrue, because `SPIDERYARN_JOB_CONCURRENCY` takes any positive integer. GPT
 * Sol, 2026-09-03, finding 5.
 *
 * Nulls and duplicates are dropped rather than refused, so a caller can hand it
 * a column straight off a `RETURNING` without filtering first.
 *
 * ## Zero rows is four different things and only one of them is fine
 *
 * Until 2026-09-03 this logged one sentence for all four, which is what GPT Sol
 * called out (finding 3) and what a test in tests/billing-settlement.test.ts was
 * *asserting*:
 *
 * - **already released** — ordinary and idempotent. Two Stops, a sweep behind a
 *   cancel, a retried request. Nothing is wrong and nothing is said above debug.
 * - **already succeeded** — a contradiction. The job ended other than
 *   successfully and the slot is charged anyway, so somebody has been billed for
 *   an article they did not get. `error`, with the ids.
 * - **the row is gone** — a reservation a job still names cannot be deleted
 *   (`jobs_ingest_event_fk`), so this means the ledger has lost a row. `error`.
 * - **neither timestamp set** — impossible: the `UPDATE` re-evaluates its
 *   predicate after waiting on any concurrent writer, so a row it did not match
 *   has one of them. `error`, because an impossible state that is real is worth
 *   more than a tidy `switch`.
 *
 * **None of them throws**, and that is the whole reason the release is not
 * symmetrical with the charge: this runs on the paths that end a job the reader
 * did not get — a Stop, a lapsed lease, a failed step — and a throw there turns
 * the Stop button into a 500 and leaves the job un-ended, which is strictly
 * worse than a slot nobody gave back.
 */
export async function releaseReservations(
  tx: HasExecute,
  ingestEventIds: readonly (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(ingestEventIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;

  /* `now()` rather than `new Date()`, for the reason `releaseReservation` gives:
     the constraint that terminal timestamps may not precede `reserved_at` is
     checked against Postgres's clock. */
  const result = await tx.execute(sql`
    update spideryarn.ingest_events set released_at = now()
     where id in (${uuidList(ids)})
       and succeeded_at is null and released_at is null
    returning id`);
  const moved = new Set(rowsOf(result).map((row) => String(row.id)));
  const missed = ids.filter((id) => !moved.has(id));
  if (missed.length > 0) await reportUnreleased(tx, missed);
}

/** Ids as a bound-parameter list, never as text spliced into the statement. */
function uuidList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

/** The rows a raw `execute` came back with. Empty rather than a throw. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/**
 * Look at the reservations a release did not move, and log each for what it is.
 *
 * A second statement, after the update and in the same transaction, so it sees
 * exactly the rows that update declined. See `releaseReservations` for the four
 * cases and why only the first is quiet.
 */
async function reportUnreleased(tx: HasExecute, ids: readonly string[]): Promise<void> {
  const result = await tx.execute(sql`
    select id,
           succeeded_at is not null as charged,
           released_at is not null as released
      from spideryarn.ingest_events
     where id in (${uuidList(ids)})`);
  const seen = new Map(
    rowsOf(result).map((row) => [
      String(row.id),
      { charged: row.charged === true, released: row.released === true },
    ]),
  );

  for (const ingestEventId of ids) {
    const row = seen.get(ingestEventId);
    if (!row) {
      logger.error(
        { ingestEventId },
        "an ending job's ingest reservation is not in the ledger at all, so the slot cannot be " +
          "given back and nothing records what it was spent on",
      );
    } else if (row.charged) {
      logger.error(
        { ingestEventId },
        "an ending job's ingest reservation is already charged, so an ingest that did not " +
          "succeed has been billed for — released nothing",
      );
    } else if (row.released) {
      /* The ordinary one. Debug, because a line per idempotent release is a line
         nobody reads and it would bury the two above it. */
      logger.debug(
        { ingestEventId },
        "an ending job's ingest reservation was already released, so nothing was released again",
      );
    } else {
      logger.error(
        { ingestEventId },
        "an ending job's ingest reservation refused to release and is neither charged nor " +
          "released, which at read committed should not be reachable",
      );
    }
  }
}

/** Log a refusal where the reason is still in hand. Never the reader's prose. */
export function noteRefusal(ownerId: string, refused: Refused): void {
  logger.info(
    { ownerId, used: refused.used, limit: refused.limit },
    "ingest refused: the account is at its quota",
  );
}
