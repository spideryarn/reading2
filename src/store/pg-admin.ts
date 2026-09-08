/**
 * Every account, with the size of what it has made — the one query in this
 * repo that deliberately does not filter by owner.
 *
 * Everything else under `src/store/` answers *"what does this reader have"*,
 * and [pg.ts](pg.ts)'s `ownedSlug()` is the predicate that makes that true —
 * see docs/project/auth.md § Whose data is it. This file answers *"who are the
 * readers"*, which cannot be asked with an owner filter on it, so the rules it
 * obeys instead are:
 *
 * 1. **Counts, dates, and what the account may do.** No title, no URL, no
 *    filename, no sentence. How many articles somebody has is a fact about the
 *    account, and so is which plan they are on; *which* articles they are is
 *    their reading. docs/project/admin.md § What it deliberately does not show.
 * 2. **Reached from exactly one route**, `GET /api/admin/users`, behind the
 *    `/api/admin` namespace check in src/routes.ts. There is no other caller,
 *    and a second one should be a second look at whether it is allowed.
 * 3. **The method says so in its name.** `listUsersAcrossOwners`, not
 *    `listUsers` — GPT Sol's suggestion, 2026-08-27, and a good one: the seam
 *    that makes this safe is a route gate somewhere else, so the one thing a
 *    future call site can be given here is a name that argues with it.
 *
 * ## One query per table, not one query and not one per user
 *
 * The counts live in tables that share nothing but an article. A single
 * statement joining them all would multiply rows — somebody with 3 articles and
 * 4 questions would count 12 of each — and the usual repair, a correlated
 * sub-select each, is a statement nobody can read. A count per user per table is
 * an N+1 that grows with the sign-up list.
 *
 * So: **one grouped aggregate per table, run together, joined in TypeScript by
 * owner id.** A fixed number of statements whatever the number of accounts, each
 * hitting an index that already exists — and beside them the account listing,
 * which is not a statement at all but an HTTP call to the Auth service
 * (admin-accounts.ts).
 *
 * **Seven aggregates and two plain reads as of 2026-09-03**, against a pool of
 * five (src/db/client.ts): the five article-shaped ones, spend, the ingest
 * ledger, every `billing_accounts` row, and the (cached) tier table. Still one
 * round trip's worth of waiting rather than several, on a page one person opens
 * a few times a day — but it is the point at which adding another stops being
 * free. docs/project/admin.md § Where the numbers come from.
 *
 * The file is in three parts for one reason — so that each of them can be
 * checked by something: `mergeUsers` is pure and takes two owners' worth of
 * fixtures (tests/admin-users-merge.test.ts), `adminQueries` returns builders
 * whose `.toSQL()` pins what they *mean* (tests/admin-queries.test.ts), and the
 * store itself is run against a real database for what the driver actually
 * returns (tests/admin-store.test.ts). None of those three could have caught
 * what the other two catch.
 *
 * ## Whose comment is it: through the article, not through the child row
 *
 * Comments, chat threads and searches all carry an `owner_id` of their own, and
 * this file **does not use it**. It groups them through
 * `articles.owner_id` instead, one join each.
 *
 * That is a deliberate choice between two answers that are the same number
 * unless something is wrong. The child column has never been read by anything —
 * docs/project/auth.md § What is still shared calls it "written, never read" —
 * and nothing in the database enforces that a child's owner equals its
 * article's. The isolation reaches every one of these rows *through the
 * article*, so the article's owner is the authoritative answer to "whose is
 * this", and a count that disagreed with the isolation would be a number
 * describing a world the reader cannot see. GPT Sol raised the ambiguity,
 * 2026-08-27, and asked for the choice to be made rather than left; this is the
 * choice, and it also leaves that sentence in auth.md true.
 */

import { count, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { getDb } from "../db/client.js";
import {
  articles,
  billingAccounts,
  chatThreads,
  comments,
  ingestEvents,
  searchRuns,
  uploads,
} from "../db/schema.js";
import { FREE_LIFETIME_INGESTS, tierForPrice } from "../billing/tiers.js";
import type { TierRow } from "../billing/tiers.js";
import { allAccountSnapshots, entitlementFromRow, isPublicPrice } from "./pg-billing.js";
import type { AccountSnapshot } from "./pg-billing.js";
import { allTiers } from "./pg-tiers.js";
import type { AccountRow } from "./account-row.js";
import { gotruePages, listAccounts } from "./admin-accounts.js";
import {
  type OwnerSpend,
  currentUtcMonth,
  productSpendByOwner,
} from "./ai-calls-spend-pg.js";
import type { AdminUser } from "../admin.js";
import type { OwnerId } from "../types.js";
import type { AdminStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { projectMismatch } from "./blobs.js";
import {
  listFeedbackAcrossOwners,
  readFeedbackAcrossOwners,
  readFeedbackScreenshotAcrossOwners,
} from "./pg-admin-feedback.js";
import { onTheShelf } from "./pg.js";

/* ------------------------------------------------------- the pure half --- */

/** One `auth.users` row, as much of it as this page reads. */
export type { AccountRow } from "./account-row.js";

/** The four article-shaped numbers, per owner. */
export interface ShelfTally {
  owner: string;
  live: number;
  archived: number;
  opens: number;
  lastReadAt: Date | null;
}

/** `[{ owner, n }]` from a `group by owner_id` — one number per owner. */
export interface CountRow {
  owner: string;
  n: number;
}

/**
 * The three ingest numbers, per owner.
 *
 * **Both windows come back, and the merge picks one**, because which one is
 * right depends on the entitlement and the entitlement is decided in TypeScript
 * — `entitlementFromRow`, the same function the wall decides with. Asking SQL
 * to work out which allowance somebody is on would be a second implementation
 * of that rule, living in a string, disagreeing with the first one quietly.
 */
export interface IngestTally {
  owner: string;
  /** Successful ingests ever — what the free allowance is measured over. */
  lifetime: number;
  /** Successful ingests inside the row's stored billing period, if it has one. */
  inPeriod: number;
  /** Reservations taken and not settled. Counted as used, as the wall does. */
  inFlight: number;
  /** How many of `lifetime` are currently public, and so cost half a slot. */
  lifetimeShared: number;
  /** How many of `inPeriod` are. Never includes `inFlight` — see `planFacts`. */
  inPeriodShared: number;
}

/** Everything the merge needs, named so the call site reads as a sentence. */
export interface UserCounts {
  shelf: ShelfTally[];
  uploads: CountRow[];
  questions: CountRow[];
  chats: CountRow[];
  searches: CountRow[];
  ingests: IngestTally[];
  /**
   * One `billing_accounts` row per owner that has one. Absent is the free tier.
   *
   * The only read in this file that is not a count, and the exemption is the
   * header's: there is no owner to filter by. It comes from
   * `allAccountSnapshots` in pg-billing.ts rather than from a query written
   * here, so the columns entitlement is decided from are named once.
   */
  accounts: Map<string, AccountSnapshot>;
  /** What we sell, so a tier's quota is read from its row and never guessed. */
  tiers: readonly TierRow[];
  /**
   * **Money, and the only entry here that is not a count of the reader's own
   * things.** Keyed by owner id like the rest; absent means the account made no
   * model calls in the period, which `mergeUsers` draws as zero calls rather
   * than as zero dollars — see `AdminUser.spendCalls`.
   *
   * It comes from a sixth grouped aggregate rather than from the five above,
   * because `ai_calls` shares nothing with them but an owner id: joining it in
   * would multiply rows exactly as the header describes.
   */
  spend: Map<string, OwnerSpend>;
  /** `YYYY-MM` (UTC) — the period `spend` covers, stated rather than implied. */
  spendMonth: string;
}

/** Turn `[{owner, n}]` into something the merge can look up. */
function tally(rows: CountRow[]): Map<string, number> {
  return new Map(rows.map((r) => [r.owner, r.n]));
}

/**
 * What one account is entitled to and how much of it is spent.
 *
 * **Picked out of `AdminUser` rather than restated**, so the window's three
 * values are declared once — a fourth added there and not here would be a type
 * error at the spread rather than a silent narrowing.
 */
type PlanFacts = Pick<
  AdminUser,
  "plan" | "ingests" | "ingestsShared" | "ingestLimit" | "ingestWindow"
> &
  Partial<Pick<AdminUser, "planStatus">>;

/**
 * The billing three lines of one row.
 *
 * **`entitlementFromRow` decides, not this function** — it is the same call the
 * wall makes under its lock (`reserveIngest`), so a row this page draws as
 * *Reader, 4 of 20* is a row that would be admitted, and a row it draws as free
 * is one that would be refused at three. Two opinions about entitlement, one of
 * them on an administrator's screen while the other decides what a reader may
 * do, is the disagreement this reuse exists to prevent.
 *
 * **A stale period is shown as the lifetime count**, and it is the one case
 * worth explaining. `entitlementFromRow` answers `stale` when the row says
 * subscribed and its stored period does not contain now — so there is no
 * current period to count inside, and `inPeriod` would be a count over a window
 * that has closed. The tier's limit is still the right scale, because that is
 * what they are paying for, and the raw `status` sits beside it in its own
 * column, which is the tell. `/profile` says *"we could not confirm your plan"*
 * for the same row (src/billing-plan.ts); an administrator gets the numbers
 * instead, because they are the person who would act on them.
 *
 * **Nothing here is excused for an administrator.** The exemption is `isAdmin`'s
 * and the page draws it, for the reason `AdminUser` gives: those two uuids are
 * already in the browser bundle and a second copy of the question is a second
 * answer waiting to differ.
 *
 * ## The count and the row are two observations, not one
 *
 * `inPeriod` is computed in SQL against `billing_accounts` inside the ledger
 * aggregate, and `account` comes from `allAccountSnapshots()` — a **separate
 * statement**, issued concurrently. A webhook rolling a subscription's period
 * between the two would let this label the old period's count as the new one.
 * GPT Sol, 2026-09-03.
 *
 * Not fixed, and the reason is proportion rather than difficulty: the window is
 * the few milliseconds between two statements in one `Promise.all`, the loser is
 * an administrator's read-only page that is reloaded by hand, and the wrong
 * answer is a count for the month that has just ended shown against the month
 * that has just begun. The fix — returning the boundaries with the aggregate and
 * checking they match, or putting nine reads in one snapshot — is real work
 * against a number nobody acts on within the second. Written down because a
 * *future* caller of this arithmetic might not be a page somebody is looking at.
 */
function planFacts(
  account: AccountSnapshot | undefined,
  tiers: readonly TierRow[],
  counts: IngestTally | undefined,
  now: Date,
): PlanFacts {
  const status = account?.status ?? undefined;
  const inFlight = counts?.inFlight ?? 0;
  const lifetime = (counts?.lifetime ?? 0) + inFlight;
  const inPeriod = (counts?.inPeriod ?? 0) + inFlight;
  /* **Not `+ inFlight`**, unlike the two above: an unsettled reservation is
     charged full price, because nobody yet knows whether the article will be
     shared. src/billing/half-units.ts. */
  const lifetimeShared = counts?.lifetimeShared ?? 0;
  const inPeriodShared = counts?.inPeriodShared ?? 0;

  const entitlement = entitlementFromRow(account, tiers, now);

  if ("kind" in entitlement) {
    /* Stale — see the docstring. The price still names the tier, and a price no
       tier sells falls to the free numbers, which is the same direction
       `entitlementFromRow` fails in. */
    const tier = tierForPrice(account?.priceId, tiers);
    return {
      plan: tier?.id ?? "free",
      ...(status === undefined ? {} : { planStatus: status }),
      ingests: lifetime,
      ingestsShared: lifetimeShared,
      ingestLimit: tier?.ingestsPerPeriod ?? FREE_LIFETIME_INGESTS,
      /* **Its own window, not `lifetime`.** The count and the limit are measured
         over different spans here and only the cell can say so — see
         `AdminUser.ingestWindow`. */
      ingestWindow: "stale",
    };
  }

  return entitlement.tier === "paid"
    ? {
        plan: entitlement.tierId,
        ...(status === undefined ? {} : { planStatus: status }),
        ingests: inPeriod,
        ingestsShared: inPeriodShared,
        ingestLimit: entitlement.limit,
        ingestWindow: "period",
      }
    : {
        plan: "free",
        ...(status === undefined ? {} : { planStatus: status }),
        ingests: lifetime,
        ingestsShared: lifetimeShared,
        ingestLimit: entitlement.limit,
        ingestWindow: "lifetime",
      };
}


/** ISO, or nothing at all — the wire shape leaves a missing date out. */
function iso(at: Date | null | undefined): string | undefined {
  return at ? at.toISOString() : undefined;
}

/**
 * `{ key: value }` when there is a value, `{}` when there is not.
 *
 * `exactOptionalPropertyTypes` is on (docs/project/typechecking.md), so
 * `lastSignInAt: undefined` is not the same as leaving it out — and leaving it
 * out is what puts a shorter object on the wire.
 */
function optional<K extends string>(
  key: K,
  value: string | undefined,
): Record<K, string> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

/**
 * Join the accounts to their counts. **The whole of the arithmetic**, and the
 * only part of this file that can be tested without a database.
 *
 * Two rules it exists to keep, and both are the kind that go wrong silently:
 *
 * - **An owner with no rows in a table gets `0`, never a missing field.** A
 *   `group by` returns nothing at all for an owner with nothing to count, so
 *   every lookup here has a `?? 0` behind it.
 * - **Nobody gets anybody else's numbers.** Keyed by owner id in every case,
 *   which is what makes the five separate queries safe to merge.
 */
export function mergeUsers(people: AccountRow[], counts: UserCounts): AdminUser[] {
  const uploaded = tally(counts.uploads);
  const questions = tally(counts.questions);
  const chats = tally(counts.chats);
  const searches = tally(counts.searches);
  const shelf = new Map(counts.shelf.map((r) => [r.owner, r]));
  const spend = counts.spend;
  const ingests = new Map(counts.ingests.map((r) => [r.owner, r]));
  /* One clock for the whole merge, so two rows cannot be decided either side of
     a period boundary — the same reason `spendMonth` is settled before any
     query runs in `listUsersAcrossOwners`. */
  const now = new Date();

  return people
    /* An account with no address cannot sign in here — the gate refuses it by
       name, `[auth-noemail]` in src/auth.ts — and this table is led by the
       address, so such a row would be a blank first column rather than a fact.
       Dropped for that reason and no other.

       **Not because it owns nothing.** That is what this comment used to say
       and it does not follow: the project is shared with an older app, so an
       account this app will not admit may still belong to a person and have
       rows against its id, and they are dropped here silently. GPT Sol,
       2026-09-03. Left as it is, because what to show for an account nobody can
       sign in as is a product question rather than a bug —
       docs/plans/260903c-admin-users-count-disagrees-with-rows.md § Reviews. */
    .filter((p): p is AccountRow & { email: string } => typeof p.email === "string" && p.email !== "")
    .map((p): AdminUser => {
      const mine = shelf.get(p.id);
      return {
        id: p.id as OwnerId,
        email: p.email,
        /* `created_at` is nullable in Supabase's schema even though every real
           row has one. The epoch would sort as 1970 and read as a fact; an
           empty string cannot be parsed, and `timeAgo` draws that as "—". */
        createdAt: iso(p.createdAt) ?? "",
        ...optional("lastSignInAt", iso(p.lastSignInAt)),
        ...optional("emailConfirmedAt", iso(p.emailConfirmedAt)),
        providers: p.providers,
        articles: mine?.live ?? 0,
        archived: mine?.archived ?? 0,
        uploads: uploaded.get(p.id) ?? 0,
        questions: questions.get(p.id) ?? 0,
        chats: chats.get(p.id) ?? 0,
        searches: searches.get(p.id) ?? 0,
        opens: mine?.opens ?? 0,
        ...optional("lastReadAt", iso(mine?.lastReadAt ?? null)),
        /* `?? 0` on all three, for the reason stated above about every other
           lookup here: a `group by` returns nothing at all for an owner with
           nothing to count, and a missing field on a page whose content is
           numbers is indistinguishable from a zero that means something. */
        spendNanos: spend.get(p.id)?.nanos ?? 0,
        spendCalls: spend.get(p.id)?.calls ?? 0,
        spendUnpricedCalls: spend.get(p.id)?.unpricedCalls ?? 0,
        spendMonth: counts.spendMonth,
        ...planFacts(counts.accounts.get(p.id), counts.tiers, ingests.get(p.id), now),
      };
    });
}

/* ---------------------------------------------------------- the queries --- */

/**
 * The statements, as builders rather than as results.
 *
 * Pulled out so that **what they mean** can be asserted without a database:
 * `tests/admin-queries.test.ts` reads `.toSQL()` off each one and pins the
 * things a shape test cannot see — that uploads are filtered to `verified`,
 * that the three child counts group through `articles.owner_id` rather than
 * their own, and that the article count uses the shelf's own eligibility rule.
 *
 * That gap was GPT Sol's third finding on the built code, 2026-08-27, and it
 * was fair: every one of those could have been changed back and the runtime
 * shape test would have stayed green.
 */
export function adminQueries(db: Db) {
  return {
    /* One statement for all four article-shaped numbers, because they come from
       one table and `filter (where …)` is what Postgres has for exactly this.

       **`onTheShelf()` is the load-bearing part**, and it was missing at first.
       `beginRevision` writes the `articles` row before there is anything in it,
       so a first ingest that fails leaves a row with no current revision — one
       the shelf never shows and this counted for ever. The predicate is
       src/store/pg.ts's, the same one `listArticles` uses, so a count of the
       shelf and the shelf cannot disagree about what an article is. Sol, again.

       **`.mapWith` on every number, and it is not decoration.** A `sql`
       fragment carries a TypeScript type and no runtime conversion, so what the
       driver hands back is whatever the driver hands back: `count()` is
       `bigint` and `sum()` is `numeric`, both of which arrive as *strings* so
       that precision cannot be lost, and Drizzle leaves timestamps as strings
       too because its column mappers normally do that job. So `sql<number>` was
       a claim about a string that would sort 10 below 9 in the browser, and
       `sql<Date>` was a claim about `"2026-08-27 16:19:31.779+00"`, which is
       not even ISO. `mapWith(articles.lastOpenedAt)` reuses the *column's own*
       mapper rather than a second parse written here. */
    shelf: db
      .select({
        owner: articles.ownerId,
        live: sql<number>`count(*) filter (where ${articles.archivedAt} is null)`.mapWith(Number),
        archived: sql<number>`count(*) filter (where ${articles.archivedAt} is not null)`.mapWith(
          Number,
        ),
        opens: sql<number>`coalesce(sum(${articles.opens}), 0)`.mapWith(Number),
        lastReadAt: sql<Date | null>`max(${articles.lastOpenedAt})`.mapWith(articles.lastOpenedAt),
      })
      .from(articles)
      .where(onTheShelf())
      .groupBy(articles.ownerId),

    /* Only the uploads that arrived. A grant minted and abandoned is not an
       upload, and counting it would say somebody uploaded a file they never
       sent. `verified` is the terminal success in src/source.ts — `pending` and
       `claimed` are mid-flight, `rejected` and `expired` never made it. **Not
       `"complete"`**, which is not one of the five and which, the column being
       `text`, would have answered with a convincing zero rather than throwing:
       Sol caught that in the plan, where it was written down as the query. */
    uploads: db
      .select({ owner: uploads.ownerId, n: count() })
      .from(uploads)
      .where(eq(uploads.status, "verified"))
      .groupBy(uploads.ownerId),

    /* The next three group through `articles.owner_id` rather than the child
       row's own — see the header for why that is the authoritative answer
       rather than the convenient one. An inner join, so a child row whose
       article has been deleted counts for nobody, which is right: there is
       nothing left for it to be about. And `onTheShelf()` again, so a question
       asked about an article that never published does not inflate a number
       beside a shelf that does not show it. */
    questions: db
      .select({ owner: articles.ownerId, n: count() })
      .from(comments)
      .innerJoin(articles, eq(comments.articleId, articles.id))
      .where(onTheShelf())
      .groupBy(articles.ownerId),

    chats: db
      .select({ owner: articles.ownerId, n: count() })
      .from(chatThreads)
      .innerJoin(articles, eq(chatThreads.articleId, articles.id))
      .where(onTheShelf())
      .groupBy(articles.ownerId),

    searches: db
      .select({ owner: articles.ownerId, n: count() })
      .from(searchRuns)
      .innerJoin(articles, eq(searchRuns.articleId, articles.id))
      .where(onTheShelf())
      .groupBy(articles.ownerId),

    /* **The quota ledger, and it groups by its own `owner_id`** — unlike the
       three above, which reach an owner through the article. There is nothing to
       reach through: an `ingest_events` row is a slot, not a document, and it
       exists before the article does and outlives one that is deleted. That is
       the whole reason it is the abuse boundary rather than a count of articles
       (docs/project/billing.md § *The quota*).

       **Left join, not inner**, because most owners have no `billing_accounts`
       row at all — a free reader never gets one until they check out or hit the
       wall — and an inner join would silently report every free account as
       having ingested nothing.

       The period predicate is the same half-open `>= start and < end` that
       `usageSql` counts by, so an ingest at the instant a period rolls over is
       counted once here and once there, in the same period. `mapWith(Number)`
       on every one, for the reason the shelf query gives: `count()` comes back
       from the driver as a string. */
    ingests: db
      .select({
        owner: ingestEvents.ownerId,
        lifetime:
          sql<number>`count(*) filter (where ${ingestEvents.succeededAt} is not null)`.mapWith(
            Number,
          ),
        inPeriod: sql<number>`count(*) filter (
            where ${ingestEvents.succeededAt} is not null
              and ${billingAccounts.currentPeriodStart} is not null
              and ${billingAccounts.currentPeriodEnd} is not null
              and ${ingestEvents.succeededAt} >= ${billingAccounts.currentPeriodStart}
              and ${ingestEvents.succeededAt} < ${billingAccounts.currentPeriodEnd})`.mapWith(
          Number,
        ),
        inFlight: sql<number>`count(*) filter (
            where ${ingestEvents.succeededAt} is null
              and ${ingestEvents.releasedAt} is null)`.mapWith(Number),
        /* **How many of the counted rows are cheap right now**, over each of the
           two windows above — because a currently-public article costs half a
           slot (src/billing/half-units.ts) and `12 / 3` on this page would
           otherwise read as the wall having failed. The *count* goes on the wire
           and the arithmetic happens in the browser, which is the same rule
           ../billing-plan.ts states: integer counts that add up, and no
           half-unit divided for display.

           The join is `left` and the predicate is `isPublicPrice`, **imported
           from pg-billing.ts rather than spelled again here** — this is the same
           question the quota wall asks, in a different query builder in a
           different file, and the two coming to disagree about what "public"
           means is a wrong number on one page and a right one on the other with
           nothing red. It has three terms: the live column, then the price
           frozen onto the ledger row when its article was deleted, then
           `'private'` for a row that resolves to nothing — so a row whose
           article predates the column falls to full price, and a row whose
           article was destroyed keeps whatever it cost. In flight is not counted
           here for the same reason it is not discounted there: nobody knows yet.
           tests/admin-queries.test.ts § the ingest ledger's half-price split. */
        lifetimeShared: sql<number>`count(*) filter (
            where ${ingestEvents.succeededAt} is not null
              and ${isPublicPrice(articles.visibility, ingestEvents.articleVisibilityAtDelete)})`.mapWith(
          Number,
        ),
        inPeriodShared: sql<number>`count(*) filter (
            where ${ingestEvents.succeededAt} is not null
              and ${billingAccounts.currentPeriodStart} is not null
              and ${billingAccounts.currentPeriodEnd} is not null
              and ${ingestEvents.succeededAt} >= ${billingAccounts.currentPeriodStart}
              and ${ingestEvents.succeededAt} < ${billingAccounts.currentPeriodEnd}
              and ${isPublicPrice(articles.visibility, ingestEvents.articleVisibilityAtDelete)})`.mapWith(
          Number,
        ),
      })
      .from(ingestEvents)
      .leftJoin(billingAccounts, eq(billingAccounts.ownerId, ingestEvents.ownerId))
      .leftJoin(articles, eq(articles.id, ingestEvents.articleId))
      .groupBy(ingestEvents.ownerId),
  };
}

/* ------------------------------------------------------------ the store --- */

/**
 * Where the accounts come from, and the one thing that must be true of it.
 *
 * **The Auth project and the database must be the same project.** They are
 * chosen by two independent environment variables, and nothing else compares
 * them: point `SUPABASE_URL` at one project while `DATABASE_URL` names another
 * and this page lists the accounts of one and the articles of the other, giving
 * every person a row of zeros. Nothing errors. `projectMismatch` in blobs.ts is
 * the same check for the same reason on the Storage pair, and this reuses it
 * rather than growing a second opinion about what a project ref is.
 */
function accountSource(): ReturnType<typeof gotruePages> {
  const url = process.env.SUPABASE_URL?.trim();
  /* `.trim()` on both, and empty is not configured: a `.env` line left as
     `SUPABASE_SERVICE_ROLE_KEY=` gives a string that authenticates nothing. */
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "the admin page needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: the accounts live in " +
        "the Auth service, not in a table this server can read. See src/store/admin-accounts.ts.",
    );
  }
  const mismatch = projectMismatch(process.env.DATABASE_URL, url);
  if (mismatch) throw new Error(`the admin page would mix two projects: ${mismatch}`);
  return gotruePages(url, key);
}

const rawPgAdminStore: AdminStore = {
  async listUsersAcrossOwners(): Promise<AdminUser[]> {
    const q = adminQueries(getDb());

    /* All six at once — five grouped aggregates and one HTTP listing. They
       depend on none of each other, so the wall-clock cost is one round trip
       rather than six. Five of them are queries and the pool is sized 5
       (src/db/client.ts), so they no longer queue one deep as they did when the
       accounts were a query too.

       **The accounts are asked of the Auth service over HTTP**, not of the
       database: `auth.users` is Supabase's and `spideryarn_app` has no grants
       into it. admin-accounts.ts has the why. */
    /* **The period is decided once, here, before anything is asked.** Reading
       the clock inside the query and again for the label would let a run that
       straddles midnight on the 1st report September's money under an August
       heading — a one-second-a-month bug that nothing would ever reproduce. */
    const month = currentUtcMonth();

    const [people, shelf, uploaded, questions, chats, searches, spend, ingests, accounts, tiers] =
      await Promise.all([
        listAccounts(accountSource()),
        q.shelf,
        q.uploads,
        q.questions,
        q.chats,
        q.searches,
        /* The sixth aggregate, and the pool is sized 5 (src/db/client.ts), so one
           of the six now waits for a connection. Measured against the alternative
           — a second round trip after the first five — that is still one wall
           clock's worth of latency rather than two, and this is an admin page a
           single person opens. */
        productSpendByOwner(month.since, month.until),
        /* Three more since 2026-09-03, for the plan column, and the paragraph
           above is now about nine things queueing five deep rather than six
           queueing one. That is still one round trip's worth of waiting rather
           than several, on a page one person opens a few times a day — but it is
           the point at which "add another aggregate" stops being free, and the
           next column should read `allTiers`'s cache or join something that is
           already here rather than making it ten. */
        q.ingests,
        allAccountSnapshots(),
        /* Cached for thirty seconds, so on a page being reloaded this is usually
           not a query at all. */
        allTiers(),
      ]);

    return mergeUsers(people, {
      shelf,
      uploads: uploaded,
      questions,
      chats,
      searches,
      spend,
      spendMonth: month.label,
      ingests,
      accounts,
      tiers,
    });
  },

  /* **The other cross-owner reader, and it lives in its own file.** Everything
     above this line returns counts and dates and says so at length;
     pg-admin-feedback.ts returns a reader's own sentences, under a different
     rule and a different argument. Composed here rather than written here so
     that neither header has to be hedged. */
  listFeedbackAcrossOwners,
  readFeedbackAcrossOwners,
  readFeedbackScreenshotAcrossOwners,
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgAdminStore: AdminStore = guardDbStore("admin", rawPgAdminStore);
