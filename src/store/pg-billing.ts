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
 * article costs half (src/billing/half-units.ts) — and a different request can
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

import { eq, sql } from "drizzle-orm";

import {
  PRIVATE_INGEST_COST,
  PUBLIC_INGEST_COST,
  articles as inArticles,
  budgetFor,
  halfUnits,
} from "../billing/half-units.js";
import type { Articles, HalfUnits } from "../billing/half-units.js";
import { limitForPeriod } from "../billing/quota-adjustment.js";
import {
  FREE,
  entitlementForTier,
  isEntitledStatus,
  quotaRules,
  tierForPrice,
} from "../billing/tiers.js";
import type { Entitlement, TierRow } from "../billing/tiers.js";
import { getDb } from "../db/client.js";
import { billingAccounts, ingestEvents } from "../db/schema.js";
import { log } from "../log.js";
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
   * Not half-units, and not a half-unit total divided by two. A public ingest
   * costs one and a private one two, so the two numbers are different questions;
   * this is the one a person can say out loud. See src/billing/half-units.ts.
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
   * half-units come from one article. `articlesToShare` below is the query.
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
 * **Three integer counts of rows, and no total.** The total is a half-unit
 * figure, and a surface that wants to show usage wants integers it can add up
 * itself — see src/billing/half-units.ts § *Nothing here divides*. `halfUnitsUsed`
 * and `ingestsUsed` below are the two things anybody actually asks of this.
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
  /** Reservations taken and not yet settled — jobs in flight, at full price. */
  readonly inFlight: number;
}

/**
 * **What this usage costs**, in the currency the wall compares.
 *
 * In flight is full price because nobody yet knows whether the article will be
 * shared — see {@link PRIVATE_INGEST_COST}.
 */
export function halfUnitsUsed(usage: Usage): HalfUnits {
  return halfUnits(
    usage.chargedFullPrice * PRIVATE_INGEST_COST +
      usage.chargedHalfPrice * PUBLIC_INGEST_COST +
      usage.inFlight * PRIVATE_INGEST_COST,
  );
}

/** The same usage as a count of **ingests**, which is what a sentence can say. */
export function ingestsUsed(usage: Usage): number {
  return usage.chargedFullPrice + usage.chargedHalfPrice + usage.inFlight;
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
  if (!row || !isEntitledStatus(row.status)) return FREE;

  const tier = tierForPrice(row.priceId, tiers);
  if (!tier) {
    logger.warn(
      { priceId: row.priceId, status: row.status },
      "an entitled subscription is on a price no tier sells — treating as free",
    );
    return FREE;
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
       half-unit reaching this argument is what turned a stored −117 into
       ninety-one articles in the design review (src/billing/half-units.ts). */
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
 * **Three counts and no total**, because a charged ingest costs 2 half-units
 * while the article it produced is private and 1 while it is public
 * (src/billing/half-units.ts). The split is done by the database rather than by
 * two round trips, and the arithmetic over it is `halfUnitsUsed`.
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
      count(*) filter (where ${chargedIn(entitlement)} and ${IS_PUBLIC} is false)::int as full_price,
      count(*) filter (where ${chargedIn(entitlement)} and ${IS_PUBLIC})::int as half_price,
      count(*) filter (where e.succeeded_at is null and e.released_at is null)::int as in_flight
    from spideryarn.ingest_events e
    ${VISIBILITY_JOIN}
    where e.owner_id = ${ownerId}::uuid`;
}

/**
 * **Is the article this row was charged for public right now?**
 *
 * A `left join` and a `coalesce`, because there is nothing to backfill: a row
 * charged before the `article_id` column existed has no article to resolve, and
 * neither does one whose article has been deleted. Both read as **private**, so
 * an unresolvable row is charged full price — the direction that cannot be
 * gamed. See `ingest_events.article_id` in ../db/schema.ts.
 *
 * Two constants rather than two spellings, so the usage query and the offer
 * query below cannot come to disagree about what "public" means.
 */
const VISIBILITY_JOIN = sql`left join spideryarn.articles a on a.id = e.article_id`;
const IS_PUBLIC = sql`coalesce(a.visibility, 'private') = 'public'`;

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
    /* **Every count stays an integer**, which is the whole reason the discount
       is expressed in half-units rather than in fractions of an article: this
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
    inFlight: cell("in_flight"),
  };
}

/** What this owner has used against the entitlement they currently hold. */
export async function usageFor(ownerId: string, entitlement: Entitlement): Promise<Usage> {
  return usageOf(await getDb().execute(usageSql(ownerId, entitlement)));
}

/** The columns the two questions below are decided from. One list, one shape. */
const BILLING_COLUMNS = {
  status: billingAccounts.status,
  priceId: billingAccounts.priceId,
  currentPeriodStart: billingAccounts.currentPeriodStart,
  currentPeriodEnd: billingAccounts.currentPeriodEnd,
  stripeSubscriptionId: billingAccounts.stripeSubscriptionId,
  stripeCustomerId: billingAccounts.stripeCustomerId,
  quotaLimitDelta: billingAccounts.quotaLimitDelta,
  quotaPeriodStart: billingAccounts.quotaPeriodStart,
} as const;

/**
 * The refusal this usage makes against this entitlement, or null for room left.
 *
 * **In-flight counts as used**, which is the whole burst defence: a reservation
 * nobody has settled is a slot somebody is spending.
 *
 * ## The comparison is `<`, and that is not the old rule doubled
 *
 * It reads like it: `used < limit` became `halfUnitsUsed < limit * 2`. It is
 * not. `used < limit` never let anybody exceed the limit **only because a
 * reservation cost exactly one**; at two, five-of-six admits an ingest that
 * settles at seven. The plan said the doubling was a no-op and GPT Sol showed it
 * was not (2026-09-04).
 *
 * **The half-unit overdraft is accepted knowingly**, because Greg's own sentence
 * settles it: he said a free account can make six public articles, and the
 * money-safe `used + 2 <= budget` delivers five. What is accepted is one
 * half-unit, once — a reader at five may add a sixth article and is then refused
 * everything until they are back under. **It cannot repeat and it cannot
 * compound**: at seven they are refused, and sharing the new article returns
 * them to six, which is still refused. `tests/billing-half-units.test.ts` pins
 * both halves, because the second is what an add-then-unshare cycle would attack.
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
  if (!atTheWall(entitlement, usage)) return null;
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
 * **Has this usage reached the wall?** The comparison itself, exported so the
 * gate and the page cannot come to spell it differently.
 *
 * `refusalFor` decides *what to say*; `readBillingSummary` (../billing/summary.ts)
 * needs the same yes-or-no to fill in `ReaderPlan.atLimit`, and a page that
 * reconstructed it from `used` and `limit` would be a second opinion about
 * whether somebody may add an article — which those two numbers can no longer
 * answer anyway, now that a public ingest costs half what a private one does.
 * The same reasoning as `hasLapsed` below.
 */
export function atTheWall(entitlement: Entitlement, usage: Usage): boolean {
  return halfUnitsUsed(usage) >= budgetFor(entitlement.limit);
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
 * round, would be false when three half-units come from one article. GPT Sol,
 * 2026-09-04.
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
  const used = halfUnitsUsed(usage);
  const rows = rowsOf(
    await tx.execute(sql`
      select count(*)::int as charged_rows,
             a.slug as slug,
             coalesce(a.title_override, r.title, a.slug) as title
        from spideryarn.ingest_events e
        join spideryarn.articles a on a.id = e.article_id
        left join spideryarn.article_revisions r on r.id = a.current_revision_id
       where e.owner_id = ${ownerId}::uuid
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
    /* One half-unit per charged row: the row goes from 2 to 1. */
    const chargedRows = Number(cells.charged_rows);
    if (!Number.isInteger(chargedRows) || chargedRows <= 0) continue;
    /* The coalesce cannot return null and a slug is never empty, so this is a
       guard against a shape that changed rather than against the data. */
    const title = String(cells.title ?? "").trim() || String(cells.slug ?? "").trim();
    if (!title) continue;
    freed += chargedRows;
    const candidate: ShareCandidate = { title };
    if (head === undefined) head = candidate;
    else rest.push(candidate);
    if (used - freed < budget) return [head, ...rest];
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
 * it from the three usage counts, so it is this query or it is a sentence that
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

  const [row] = await tx
    .select(BILLING_COLUMNS)
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerId, ownerId))
    .for("update")
    .limit(1);
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
     article is charged full price for ever, silently. See `Settlement`. */
  const result = await tx.execute(
    sql`update spideryarn.ingest_events
           set succeeded_at = now(), article_id = ${outcome.articleId}::uuid
         where id = ${ingestEventId}::uuid
           and succeeded_at is null and released_at is null
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
