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
 * ## Six queries, not one, and not one per user
 *
 * The counts live in five tables that share nothing but an article. A single
 * statement joining all five would multiply rows — somebody with 3 articles and
 * 4 questions would count 12 of each — and the usual repair, five correlated
 * sub-selects, is a statement nobody can read. A count per user per table is an
 * N+1 that grows with the sign-up list.
 *
 * So: **one grouped aggregate per table, run together, joined in TypeScript by
 * owner id.** Six statements whatever the number of accounts, each hitting an
 * index that already exists.
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

import { count, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { getDb } from "../db/client.js";
import { authUsers } from "../db/auth-users.js";
import { articles, chatThreads, comments, searchRuns, uploads } from "../db/schema.js";
import type { AdminUser } from "../admin.js";
import type { OwnerId } from "../types.js";
import type { AdminStore } from "./contracts.js";
import { onTheShelf } from "./pg.js";

/* ------------------------------------------------------- the pure half --- */

/** One `auth.users` row, as much of it as this page reads. */
export interface AccountRow {
  id: string;
  email: string | null;
  createdAt: Date | null;
  lastSignInAt: Date | null;
  emailConfirmedAt: Date | null;
  meta: unknown;
}

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
}

/** Turn `[{owner, n}]` into something the merge can look up. */
function tally(rows: CountRow[]): Map<string, number> {
  return new Map(rows.map((r) => [r.owner, r.n]));
}

/**
 * Which providers Supabase says an account signs in with.
 *
 * The column is JSONB written by GoTrue, so it is well-formed but not typed —
 * and it is read here rather than trusted: an unexpected shape gives an empty
 * list, never a crash and never `[object Object]` in a table cell. A page that
 * exists to look at accounts must not be takeable down by one odd row.
 */
export function providersOf(meta: unknown): string[] {
  if (!meta || typeof meta !== "object") return [];
  const raw = (meta as { providers?: unknown }).providers;
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === "string");
  const one = (meta as { provider?: unknown }).provider;
  return typeof one === "string" ? [one] : [];
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
        providers: providersOf(p.meta),
        articles: mine?.live ?? 0,
        archived: mine?.archived ?? 0,
        uploads: uploaded.get(p.id) ?? 0,
        questions: questions.get(p.id) ?? 0,
        chats: chats.get(p.id) ?? 0,
        searches: searches.get(p.id) ?? 0,
        opens: mine?.opens ?? 0,
        ...optional("lastReadAt", iso(mine?.lastReadAt ?? null)),
      };
    });
}

/* ---------------------------------------------------------- the queries --- */

/**
 * The six statements, as builders rather than as results.
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
    /** Every account that could sign in. */
    people: db
      .select({
        id: authUsers.id,
        email: authUsers.email,
        createdAt: authUsers.createdAt,
        lastSignInAt: authUsers.lastSignInAt,
        emailConfirmedAt: authUsers.emailConfirmedAt,
        meta: authUsers.rawAppMetaData,
      })
      .from(authUsers)
      /* Soft-deleted accounts are not accounts. The row survives a deletion in
         Supabase's own schema; showing it would make the list quietly wrong in
         the direction nobody thinks to check. */
      .where(isNull(authUsers.deletedAt)),

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

export const pgAdminStore: AdminStore = {
  async listUsersAcrossOwners(): Promise<AdminUser[]> {
    const q = adminQueries(getDb());

    /* All six at once. They touch six tables and none depends on another's
       answer, so the wall-clock cost is one round trip rather than six. The
       pool is sized 5 by default (src/db/client.ts), so six queries queue one
       deep — which is fine, and is a reason not to lengthen this list without
       thinking about it. */
    const [people, shelf, uploaded, questions, chats, searches] = await Promise.all([
      q.people,
      q.shelf,
      q.uploads,
      q.questions,
      q.chats,
      q.searches,
    ]);

    return mergeUsers(people, { shelf, uploads: uploaded, questions, chats, searches });
  },
};
