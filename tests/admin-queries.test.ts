/**
 * What the admin page's six statements **mean**, read off the SQL itself.
 *
 * The other two suites cannot see any of this. `mergeUsers` is handed numbers
 * and never learns where they came from; the database test asserts that what
 * comes back is a number and never asks what it counted. So every one of these
 * regressions would have left both of them green — GPT Sol's third finding on
 * the built code, 2026-08-27:
 *
 * > changing `verified` back to any other valid string; grouping children
 * > through their own `owner_id`; swapping which SQL query feeds questions and
 * > chats; counting unpublished article rows.
 *
 * `.toSQL()` builds the statement without running it, so this needs no
 * database and never skips. It is deliberately about **meaning, not text**: the
 * assertions are on the table joined, the column grouped by and the bound
 * parameter, never on whitespace or on Drizzle's choice of alias.
 */
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

import { adminQueries } from "../src/store/pg-admin.js";
import * as schema from "../src/db/schema.js";

/**
 * A Drizzle handle with no connection behind it.
 *
 * `drizzle()` over a client that can never be called: building a statement is
 * pure, and `.toSQL()` never reaches the driver. This is what makes the file a
 * unit test rather than a fourth thing that skips when Docker is off.
 */
const db = drizzle({ client: { query: () => { throw new Error("no database here"); } } as never, schema });

const q = adminQueries(db);

/**
 * The statement, with our own schema prefix taken off.
 *
 * Drizzle qualifies every one of our tables as `"spideryarn"."articles"`, which
 * makes an assertion about a column three quoted segments long and hard to read
 * wrong. `auth.users` keeps its prefix, which is useful: it is the one table
 * here that is not ours, and it should look different.
 */
const sqlOf = (query: { toSQL: () => { sql: string } }): string =>
  query.toSQL().sql.replaceAll('"spideryarn".', "");
const paramsOf = (query: { toSQL: () => { params: unknown[] } }): unknown[] => query.toSQL().params;

/* **There is no accounts query any more**, and that is the point of the move.
   The three assertions that stood here — reads `auth.users`, leaves out the
   deleted, names no credential column — were about a `select()` that could not
   run in production, because `spideryarn_app` has no grants into the `auth`
   schema. The accounts now come from the Auth service's Admin API, and the same
   three intents live in tests/admin-accounts.test.ts, where the third one
   matters more: an API response carries far more than a named column list, so
   the fence had to move from "the table declares six columns" to "the mapping
   keeps six fields". docs/project/admin.md. */

describe("the article counts", () => {
  it("count only what the shelf would show", () => {
    /* The bug this pins: `beginRevision` writes the `articles` row before there
       is anything in it, so a first ingest that failed leaves a slug with no
       current revision — invisible on the shelf and counted here for ever,
       until `onTheShelf()`. Sol found it in the built code. */
    const sql = sqlOf(q.shelf);
    expect(sql).toMatch(/"current_revision_id" is not null/);
    expect(sql).toMatch(/left\("articles"\."slug", 1\) <> '_'/);
  });

  it("tell the shelf from the archive rather than counting the lot twice", () => {
    const sql = sqlOf(q.shelf);
    /* Unqualified inside the select list — Drizzle interpolates a column
       reference differently there than in a `where`. Asserted as it is written
       rather than as it would be tidiest to read. */
    expect(sql).toMatch(/filter \(where "archived_at" is null\)/);
    expect(sql).toMatch(/filter \(where "archived_at" is not null\)/);
  });

  it("group by the owner", () => {
    expect(sqlOf(q.shelf)).toMatch(/group by "articles"\."owner_id"/);
  });
});

describe("the upload count", () => {
  it("counts the uploads that arrived, and only those", () => {
    /* The plan said `'complete'`, which is not one of the five states in
       src/source.ts — and because the column is `text`, that would have
       answered with a convincing zero rather than throwing. The parameter is
       asserted rather than the SQL text, because Drizzle binds it. */
    expect(paramsOf(q.uploads)).toContain("verified");
    expect(sqlOf(q.uploads)).toMatch(/group by "uploads"\."owner_id"/);
  });

  it("is the one count that goes by the row's own owner", () => {
    /* An upload is not about an article — it exists before there is one, and
       may never become one — so there is nothing to attribute it through. That
       makes it the exception to the rule below rather than an oversight. */
    expect(sqlOf(q.uploads)).not.toContain('"articles"');
  });
});

describe("the three child counts", () => {
  /* Named in the same order as their tables, so a test that passed after the
     queries were swapped would have to be swapped too. */
  const cases = [
    { name: "questions", query: q.questions, table: '"comments"' },
    { name: "chats", query: q.chats, table: '"chat_threads"' },
    { name: "searches", query: q.searches, table: '"search_runs"' },
  ] as const;

  for (const { name, query, table } of cases) {
    /* The join, written out per case rather than assembled from `table`, so
       that the string in the test is the string a reader can compare against
       the SQL by eye. Drizzle names the child's `article_id` first because the
       child is the `from`. */
    const joinedOn = `inner join "articles" on ${table}."article_id" = "articles"."id"`;

    it(`${name} counts its own table and no other's`, () => {
      const sql = sqlOf(query);
      expect(sql).toContain(table);
      // The two it must not be. This is what catches a swap.
      for (const other of cases.filter((c) => c.name !== name)) {
        expect(sql, `${name} must not read ${other.table}`).not.toContain(other.table);
      }
    });

    it(`${name} attributes through the article, not the child row`, () => {
      /* The choice made in src/store/pg-admin.ts's header: nothing enforces
         that a child's `owner_id` equals its article's, and the isolation
         reaches every one of these rows through the article — so the article's
         owner is the authoritative answer. Grouping by the child's own column
         would be the same number until the day it was not.

         **The whole predicate, not the words in it**, and this assertion has
         already been through the correction its sibling records
         (tests/store-block-reads.test.ts § "reaches the article's CURRENT
         revision"). It read `toContain("inner join")` and an unqualified
         `/"current_revision_id" is not null/`, and a join written
         `eq(articles.ownerId, articles.ownerId)` — a tautology on the articles
         table, so every child row pairs with every article and every owner —
         passed all three while attributing everybody's questions to everybody.
         Built and run through `.toSQL()` on 2026-09-03; all three were green.
         So the relationship is pinned rather than the vocabulary. */
      const sql = sqlOf(query);
      expect(sql).toContain(joinedOn);
      expect(sql).toMatch(/group by "articles"\."owner_id"/);
      /* Qualified. Unqualified it would be satisfied by a child table carrying
         a column of that name, and it is the *article's* publication that
         decides whether its questions are counted. */
      expect(sql).toContain('"articles"."current_revision_id" is not null');
      /* No bound parameters at all, which is a claim worth making: `onTheShelf()`
         writes its `'_'` as a literal, so a `$1` appearing here would mean the
         predicate had been rewritten into something this file is not reading. */
      expect(paramsOf(query)).toEqual([]);
    });
  }
});

/**
 * **The half-price split on the admin page reads the same predicate the wall
 * does**, and this file is the only place that can say so.
 *
 * `q.ingests` counts, over two windows, how many of an owner's charged rows are
 * cheap — because a currently-public article costs half a slot, and `12 / 3` on
 * that page would otherwise read as the quota wall having failed. It is a second
 * spelling of `usageSql`'s question, in a different query builder, in a
 * different file. The two coming to disagree about what "public" means is a
 * silent wrong number on one surface and a right one on the other, so they now
 * share one exported fragment — `isPublicPrice` in src/store/pg-billing.ts — and
 * this is what notices if somebody unpicks that.
 *
 * The fallback is the load-bearing half: `ingest_events.article_id` is
 * `on delete set null`, so once an article is deleted the only thing that still
 * knows what it cost is the price frozen onto the ledger row at deletion.
 * Dropping it here — and only here — would leave the wall and the admin page
 * quoting two different usages for one account, with nothing else red.
 */
describe("the ingest ledger's half-price split", () => {
  it("falls back to the price frozen at deletion, in both windows", () => {
    const sql = sqlOf(q.ingests);
    /* Twice, once per window — the same duplication `usageSql` has, which is
       why this asserts a count rather than a presence. */
    const matches = sql.match(
      /coalesce\("articles"\."visibility", "ingest_events"\."article_visibility_at_delete", 'private'\) = 'public'/g,
    );
    expect(matches ?? [], "expected the fallback once for lifetime and once in-period").toHaveLength(
      2,
    );
  });

  it("never asks bare `visibility = 'public'`, which is the drift", () => {
    /* The spelling this replaced. A bare comparison reads `null` for a deleted
       article's rows, which is neither branch, so those rows drop out of the
       shared count and are reported at full price — an account's usage moving
       because it threw something away. */
    expect(sqlOf(q.ingests)).not.toMatch(/(?<!coalesce\()"articles"\."visibility" = 'public'/);
  });

  it("reaches the article over a left join, so an unresolvable row survives", () => {
    /* Inner would drop every pre-`article_id` row out of the count altogether,
       which is the ledger forgetting an ingest. */
    expect(sqlOf(q.ingests)).toContain(
      'left join "articles" on "articles"."id" = "ingest_events"."article_id"',
    );
  });
});
