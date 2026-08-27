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

describe("the accounts query", () => {
  it("reads auth.users, and leaves out the deleted", () => {
    const sql = sqlOf(q.people);
    expect(sql).toContain('"auth"."users"');
    expect(sql).toMatch(/"deleted_at" is null/);
  });

  it("asks for the email confirmation, not the one that also answers for a phone", () => {
    /* `confirmed_at` is Supabase's backwards-compatibility column and means
       "email *or* phone". The page prints "email unconfirmed" beneath an email
       address, so the wrong column labels a phone-confirmed account the
       opposite of the truth. Sol, 2026-08-27. */
    const sql = sqlOf(q.people);
    expect(sql).toContain('"email_confirmed_at"');
    expect(sql).not.toMatch(/"confirmed_at"(?!\w)/);
  });

  it("selects nothing that could be a credential", () => {
    /* `select()` returns what it names. The table declares no password or token
       column (tests/auth-users-fence.test.ts pins that); this is the second
       half — that the one query which touches it names only what it needs. */
    const sql = sqlOf(q.people);
    for (const secret of ["password", "token", "phone"]) {
      expect(sql, secret).not.toContain(secret);
    }
  });
});

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
         would be the same number until the day it was not. */
      const sql = sqlOf(query);
      expect(sql).toMatch(/group by "articles"\."owner_id"/);
      expect(sql).toContain("inner join");
      expect(sql).toMatch(/"current_revision_id" is not null/);
    });
  }
});
