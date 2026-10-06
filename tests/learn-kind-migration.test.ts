/**
 * **The migration that renames the thread kind `remember` to `learn`**, in the
 * rows, the CHECK and the one-per-article index.
 * drizzle/20261006035355_rename_remember_thread_kind_to_learn.sql.
 *
 * Against a real database, because what is being tested is SQL and its order:
 * a CHECK re-added before the rows move fails only where there are rows. The
 * file is run statement by statement exactly as the migrator would, inside a
 * transaction that is always rolled back.
 *
 * The private test database has already run this migration, so each test
 * first puts the schema back to the day before it: the old index, and the old
 * CHECK. Then it seeds the rows that day could hold and replays the file.
 *
 * docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md.
 * The frozen fold migration that created the old index keeps its own test,
 * tests/learn-one-thread-migration.test.ts.
 */
import { readFileSync } from "node:fs";

import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/learn-kind-migration.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.chat_messages"],
  keepPool: true,
  max: 2,
});

afterAll(async () => {
  await pool.end();
});

const MIGRATION = readFileSync(
  new URL("../drizzle/20261006035355_rename_remember_thread_kind_to_learn.sql", import.meta.url),
  "utf8",
);
/* Split exactly where the migrator splits. */
const STATEMENTS = MIGRATION.split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s !== "");

const A = "a0000000-0000-4000-8000-0000001ea4a1"; // a Recall thread, and one of every other kind
const B = "b0000000-0000-4000-8000-0000001ea4a1"; // a Recall thread alone
const C = "c0000000-0000-4000-8000-0000001ea4a1"; // no Recall thread
const RECALL_A = "spya-rcaa02";
const RECALL_B = "spya-rcbb02";
const BLOCK = "spya-bkaa02";

const T0 = "2026-09-01T10:00:00.000Z";
const T1 = "2026-09-02T10:00:00.000Z";

const OTHER_KINDS = ["chat", "candidates", "tutorial", "explore"] as const;

async function seed(c: PoolClient): Promise<void> {
  const owner = currentOwnerId();
  for (const [id, slug] of [
    [A, "learn-kind-a"],
    [B, "learn-kind-b"],
    [C, "learn-kind-c"],
  ] as const) {
    await c.query("insert into spideryarn.articles (id, owner_id, slug) values ($1, $2, $3)", [id, owner, slug]);
    await c.query("insert into spideryarn.block_identities (article_id, block_id) values ($1, $2)", [id, BLOCK]);
  }
  const thread = (article: string, id: string, kind: string, title: string) =>
    c.query(
      `insert into spideryarn.chat_threads (article_id, id, owner_id, title, created_at, updated_at, kind)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [article, id, owner, title, T0, T1, kind],
    );
  await thread(A, RECALL_A, "remember", "Remembering");
  await thread(B, RECALL_B, "remember", "what I took from it");
  for (const kind of OTHER_KINDS) {
    await thread(A, `spya-k${"wxyz".charAt(OTHER_KINDS.indexOf(kind))}aaa2`, kind, `a ${kind}`);
    await thread(C, `spya-k${"wxyz".charAt(OTHER_KINDS.indexOf(kind))}ccc2`, kind, `a ${kind}`);
  }
  for (const [article, threadId, prefix] of [
    [A, RECALL_A, "ra"],
    [B, RECALL_B, "rb"],
    [A, "spya-kwaaa2", "ca"],
  ] as const) {
    for (const [ordinal, role] of [
      [0, "user"],
      [1, "assistant"],
    ] as const) {
      await c.query(
        `insert into spideryarn.chat_messages (article_id, thread_id, id, ordinal, role, text, status, created_at)
         values ($1, $2, $3, $4, $5, $6, 'done', $7)`,
        [article, threadId, `spya-${prefix}m${ordinal + 2}22`, ordinal, role, `text ${prefix} ${ordinal}`, T1],
      );
    }
  }
}

/** Every thread row of the three articles, whole, keyed by article and id. */
async function threads(c: PoolClient): Promise<Map<string, Record<string, unknown>>> {
  const { rows } = await c.query<{ key: string; body: Record<string, unknown> }>(
    `select article_id || '/' || id as key, to_jsonb(t) as body
       from spideryarn.chat_threads t where article_id in ($1, $2, $3)`,
    [A, B, C],
  );
  return new Map(rows.map((r) => [r.key, r.body]));
}

/** Every message row of the three articles, whole. */
async function messages(c: PoolClient): Promise<string> {
  const { rows } = await c.query(
    `select json_agg(m order by article_id, thread_id, ordinal) as all
       from spideryarn.chat_messages m where article_id in ($1, $2, $3)`,
    [A, B, C],
  );
  return JSON.stringify(rows[0]);
}

async function indexNames(c: PoolClient): Promise<string[]> {
  const { rows } = await c.query<{ indexname: string }>(
    `select indexname from pg_indexes
      where schemaname = 'spideryarn' and tablename = 'chat_threads' and indexname like 'chat_threads_one_%'
      order by indexname`,
  );
  return rows.map((r) => r.indexname);
}

/** Run `body` in a transaction with the schema as it was the day before, and always roll back. */
async function inRolledBack(body: (c: PoolClient) => Promise<void>): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query('drop index "spideryarn"."chat_threads_one_learn"');
    await c.query('alter table "spideryarn"."chat_threads" drop constraint "chat_threads_kind"');
    /* The lane's database is shared with every other suite in the run, and
       theirs hold `learn` threads the old CHECK would refuse. That day they
       were `remember` rows, so that is what they are in here; the migration
       under test turns them back, and the rollback undoes all of it. Found by
       the full suite: alone, this file had the table to itself and passed. */
    await c.query(`update "spideryarn"."chat_threads" set "kind" = 'remember' where "kind" = 'learn'`);
    await c.query(
      `alter table "spideryarn"."chat_threads" add constraint "chat_threads_kind"
         check ("kind" in ('chat','remember','candidates','tutorial','explore'))`,
    );
    await c.query(
      `create unique index "chat_threads_one_remember" on "spideryarn"."chat_threads"
         using btree ("article_id") where "kind" = 'remember'`,
    );
    await body(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

async function migrate(c: PoolClient): Promise<void> {
  for (const statement of STATEMENTS) await c.query(statement);
}

describe("the kind's rename migration", () => {
  it("is five statements, the data movement between the drops and the re-adds", () => {
    const verbs = STATEMENTS.map((s) => s.replace(/^(?:--.*\n)*/, "").split(" ").slice(0, 2).join(" "));
    expect(verbs).toEqual(["ALTER TABLE", "DROP INDEX", "UPDATE \"spideryarn\".\"chat_threads\"", "CREATE UNIQUE", "ALTER TABLE"]);
    expect(MIGRATION.replace(/^--.*$/gm, "")).not.toMatch(/ALTER INDEX/i);
  });

  it("rewrites `remember` to `learn` and nothing else on the row", async () => {
    await inRolledBack(async (c) => {
      await seed(c);
      const before = await threads(c);
      const messagesBefore = await messages(c);
      /* The control: the seed did put the old word there, twice. */
      expect([...before.values()].filter((t) => t.kind === "remember")).toHaveLength(2);

      await migrate(c);

      const after = await threads(c);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [key, was] of before) {
        const now = after.get(key);
        /* Every column but `kind` is what it was: id, title, both clocks, the
           owner, the anchor and the origin. */
        expect({ ...now, kind: null }, key).toEqual({ ...was, kind: null });
        expect(now?.kind, key).toBe(was.kind === "remember" ? "learn" : was.kind);
      }
      expect(after.get(`${A}/${RECALL_A}`)).toMatchObject({ kind: "learn", title: "Remembering" });
      expect(after.get(`${B}/${RECALL_B}`)).toMatchObject({ kind: "learn", title: "what I took from it" });
      expect([...after.values()].filter((t) => t.kind === "remember")).toEqual([]);
      /* The other kinds, counted so "untouched" is not vacuous. */
      expect([...after.values()].map((t) => t.kind).sort()).toEqual(
        [...OTHER_KINDS, ...OTHER_KINDS, "learn", "learn"].sort(),
      );

      /* The messages stay attached by identity, byte for byte. */
      expect(await messages(c)).toBe(messagesBefore);
    });
  });

  it("replaces the index: the old name is gone, and the new one refuses a second Learn thread", async () => {
    await inRolledBack(async (c) => {
      await seed(c);
      expect(await indexNames(c)).toContain("chat_threads_one_remember");

      await migrate(c);

      const names = await indexNames(c);
      expect(names).toContain("chat_threads_one_learn");
      expect(names).not.toContain("chat_threads_one_remember");
      /* The predicate moved with the name: an index called `learn` that still
         guarded `remember` would be a guard in name only. */
      const { rows } = await c.query<{ indexdef: string }>(
        `select indexdef from pg_indexes where schemaname = 'spideryarn' and indexname = 'chat_threads_one_learn'`,
      );
      expect(rows[0]?.indexdef).toMatch(/UNIQUE/);
      expect(rows[0]?.indexdef).toMatch(/kind = 'learn'/);

      const owner = currentOwnerId();
      /* A second one beside a migrated row. */
      await c.query("savepoint second");
      await expect(
        c.query(
          `insert into spideryarn.chat_threads (article_id, id, owner_id, title, kind)
           values ($1, 'spya-secnd2', $2, 'again', 'learn')`,
          [A, owner],
        ),
      ).rejects.toThrow(/chat_threads_one_learn/);
      await c.query("rollback to savepoint second");
      /* The first one on an article that had none is fine, and so is a chat
         beside a Learn thread. */
      await c.query(
        `insert into spideryarn.chat_threads (article_id, id, owner_id, title, kind)
         values ($1, 'spya-frst22', $2, 'first', 'learn')`,
        [C, owner],
      );
      await c.query(
        `insert into spideryarn.chat_threads (article_id, id, owner_id, title, kind)
         values ($1, 'spya-secnd2', $2, 'a chat', 'chat')`,
        [A, owner],
      );
    });
  });

  it("leaves a CHECK that refuses the old word", async () => {
    await inRolledBack(async (c) => {
      await seed(c);
      await migrate(c);
      await c.query("savepoint old");
      await expect(
        c.query(
          `insert into spideryarn.chat_threads (article_id, id, owner_id, title, kind)
           values ($1, 'spya-prev22', $2, 'old code', 'remember')`,
          [C, currentOwnerId()],
        ),
      ).rejects.toThrow(/chat_threads_kind/);
      await c.query("rollback to savepoint old");
    });
  });
});
