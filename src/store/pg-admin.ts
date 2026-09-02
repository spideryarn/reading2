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
 * 1. **Counts and dates only.** No title, no URL, no filename, no sentence.
 *    How many articles somebody has is a fact about the account; which articles
 *    they are is their reading. docs/project/admin.md § What it deliberately
 *    does not show.
 * 2. **Reached from exactly one route**, `GET /api/admin/users`, behind the
 *    `/api/admin` namespace check in src/routes.ts. There is no other caller,
 *    and a second one should be a second look at whether it is allowed.
 * 3. **The method says so in its name.** `listUsersAcrossOwners`, not
 *    `listUsers` — GPT Sol's suggestion, 2026-08-27, and a good one: the seam
 *    that makes this safe is a route gate somewhere else, so the one thing a
 *    future call site can be given here is a name that argues with it.
 *
 * ## Five queries, not one, and not one per user
 *
 * The counts live in five tables that share nothing but an article. A single
 * statement joining all five would multiply rows — somebody with 3 articles and
 * 4 questions would count 12 of each — and the usual repair, five correlated
 * sub-selects, is a statement nobody can read. A count per user per table is an
 * N+1 that grows with the sign-up list.
 *
 * So: **one grouped aggregate per table, run together, joined in TypeScript by
 * owner id.** Five statements whatever the number of accounts, each hitting an
 * index that already exists — and a sixth thing beside them that is not a
 * statement at all: the account listing, which comes from the Auth service over
 * HTTP (admin-accounts.ts).
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
import { articles, chatThreads, comments, searchRuns, uploads } from "../db/schema.js";
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

/** Everything the merge needs, named so the call site reads as a sentence. */
export interface UserCounts {
  shelf: ShelfTally[];
  uploads: CountRow[];
  questions: CountRow[];
  chats: CountRow[];
  searches: CountRow[];
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

  return people
    /* An account with no address cannot sign in here at all — the gate refuses
       it by name, `[auth-noemail]` in src/auth.ts — so it owns nothing and has
       nothing to show. Dropped rather than drawn as a blank row, and this
       comment is why that is not hiding anything. */
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
      };
    });
}

/* ---------------------------------------------------------- the queries --- */

/**
 * The five statements, as builders rather than as results.
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

export const pgAdminStore: AdminStore = {
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

    const [people, shelf, uploaded, questions, chats, searches, spend] = await Promise.all([
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
    ]);

    return mergeUsers(people, {
      shelf,
      uploads: uploaded,
      questions,
      chats,
      searches,
      spend,
      spendMonth: month.label,
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
