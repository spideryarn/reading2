/**
 * **The migration that folds an article's Remember threads into one, and then
 * makes a second one impossible.** drizzle/20261001143901_remember_one_thread.sql.
 *
 * Against a real database, because what is being tested is SQL: window
 * functions, a primary key that must refuse a collision, a unique index that
 * must refuse a second Remember thread. The file is run statement by statement
 * exactly as the migrator would, inside a transaction that is always rolled
 * back.
 *
 * The private test database is cloned from one that has already run this
 * migration, so the index is dropped first (inside the same transaction) to
 * make room for the duplicates the fold exists for.
 *
 * docs/plans/261001m-remember-is-its-own-single-thread.md § Design 2. The pure
 * rule that keeps new turns out of a second thread is
 * tests/remember-one-thread.test.ts.
 */
import { readFileSync } from "node:fs";

import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/remember-one-thread-migration.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.chat_messages", "spideryarn.realtime_sessions"],
  keepPool: true,
  max: 2,
});

afterAll(async () => {
  await pool?.end();
});

const MIGRATION = readFileSync(
  new URL("../drizzle/20261001143901_remember_one_thread.sql", import.meta.url),
  "utf8",
);
/* Split exactly where the migrator splits. */
const STATEMENTS = MIGRATION.split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s !== "");

const A = "a0000000-0000-4000-8000-00000000f01d"; // three Remember threads
const B = "b0000000-0000-4000-8000-00000000f01d"; // one, plus chats
const KEEP = "spya-keepr0"; // A's earliest Remember thread
const FOLD1 = "spya-fdaaa2"; // A's second
const FOLD2 = "spya-fdbbb3"; // A's third
const SOLO = "spya-sxxx22"; // B's only Remember thread
const BCHAT = "spya-chatt2"; // a chat in B
/* B also has a CHAT thread whose id is FOLD1: ids are only unique per article,
   so anything matched on id alone would fold or repoint it. */
const BTWIN = FOLD1;
const BLOCK = "spya-bkaa02";
const RT_A = "c0000000-0000-4000-8000-00000000f01d";
const RT_B = "d0000000-0000-4000-8000-00000000f01d";

const T0 = "2026-09-01T10:00:00.000Z";
const T1 = "2026-09-02T10:00:00.000Z";
const T2 = "2026-09-03T10:00:00.000Z";

interface Msg {
  id: string;
  ordinal: number;
  role: "user" | "assistant";
  status?: "done" | "error" | "pending";
  stance?: string;
  citations?: unknown;
  error?: string;
  attempt?: boolean;
}

async function seed(c: PoolClient, opts: { pendingInFolded?: boolean } = {}): Promise<void> {
  const owner = currentOwnerId();
  for (const [id, slug] of [
    [A, "remember-fold-a"],
    [B, "remember-fold-b"],
  ] as const) {
    await c.query("insert into spideryarn.articles (id, owner_id, slug) values ($1, $2, $3)", [
      id,
      owner,
      slug,
    ]);
    await c.query("insert into spideryarn.block_identities (article_id, block_id) values ($1, $2)", [
      id,
      BLOCK,
    ]);
  }
  const thread = (article: string, id: string, kind: string, created: string, updated: string) =>
    c.query(
      `insert into spideryarn.chat_threads (article_id, id, owner_id, title, created_at, updated_at, kind)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [article, id, owner, `title ${id}`, created, updated, kind],
    );
  /* Created out of id order, so "earliest" and "smallest id" disagree. */
  await thread(A, FOLD2, "remember", T2, T2);
  await thread(A, KEEP, "remember", T0, T0);
  await thread(A, FOLD1, "remember", T1, "2026-09-05T10:00:00.000Z");
  await thread(B, SOLO, "remember", T0, T0);
  await thread(B, BCHAT, "chat", T1, T1);
  await thread(B, BTWIN, "chat", T2, T2);

  const msgs = async (article: string, threadId: string, list: Msg[]) => {
    for (const m of list) {
      await c.query(
        `insert into spideryarn.chat_messages
           (article_id, thread_id, id, ordinal, role, text, status, stance, citations, error,
            attempt_id, attempt_started_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          article,
          threadId,
          m.id,
          m.ordinal,
          m.role,
          `text of ${m.id}`,
          m.status ?? "done",
          m.stance ?? null,
          m.citations === undefined ? null : JSON.stringify(m.citations),
          m.error ?? null,
          m.attempt ? "5e0f0000-0000-4000-8000-000000000001" : null,
          m.attempt ? T2 : null,
          T1,
        ],
      );
    }
  };
  /* The keeper has a gap (0, 2): numbering from its count would collide. */
  await msgs(A, KEEP, [
    { id: "spya-kpa002", ordinal: 0, role: "user" },
    { id: "spya-kpb002", ordinal: 2, role: "assistant", stance: "balanced" },
  ]);
  await msgs(A, FOLD1, [
    { id: "spya-faa002", ordinal: 0, role: "user" },
    {
      id: "spya-fab002",
      ordinal: 1,
      role: "assistant",
      stance: "socratic",
      citations: [{ blockId: BLOCK, quote: "a quote" }],
    },
    { id: "spya-fac002", ordinal: 2, role: "user" },
    {
      id: "spya-fad002",
      ordinal: 3,
      role: "assistant",
      status: opts.pendingInFolded ? "pending" : "error",
      ...(opts.pendingInFolded ? {} : { error: "the model gave up" }),
      attempt: opts.pendingInFolded === true,
      stance: "respond",
    },
  ]);
  await msgs(A, FOLD2, [
    { id: "spya-fba002", ordinal: 0, role: "user" },
    { id: "spya-fbb002", ordinal: 1, role: "assistant", stance: "signposts" },
  ]);
  await msgs(B, SOLO, [
    { id: "spya-saa002", ordinal: 0, role: "user" },
    { id: "spya-sab002", ordinal: 1, role: "assistant", stance: "balanced" },
  ]);
  await msgs(B, BCHAT, [
    { id: "spya-caa002", ordinal: 0, role: "user" },
    { id: "spya-cab002", ordinal: 1, role: "assistant" },
  ]);
  await msgs(B, BTWIN, [
    { id: "spya-twa002", ordinal: 0, role: "user" },
    { id: "spya-twb002", ordinal: 1, role: "assistant" },
  ]);

  /* A live session spoken into a folded thread, and its twin in B. */
  for (const [id, article, threadId] of [
    [RT_A, A, FOLD1],
    [RT_B, B, BTWIN],
  ] as const) {
    await c.query(
      `insert into spideryarn.realtime_sessions
         (id, owner_id, article_id, thread_id, model, issued_at, accepts_until)
       values ($1, $2, $3, $4, 'gpt-realtime', $5, $6)`,
      [id, owner, article, threadId, T1, T2],
    );
  }
  /* And a comment pointing at a folded thread, and its twin in B. */
  for (const [id, article, threadId] of [
    ["spya-cmaa02", A, FOLD2],
    ["spya-cmbb02", B, BTWIN],
  ] as const) {
    await c.query(
      `insert into spideryarn.comments (article_id, id, owner_id, block_id, status, thread_id)
       values ($1, $2, $3, $4, 'none', $5)`,
      [article, id, owner, BLOCK, threadId],
    );
  }
}

/** Every message row in the two articles, keyed by id, minus the two columns the fold may change. */
async function messageBodies(c: PoolClient): Promise<Map<string, string>> {
  const { rows } = await c.query<{ id: string; body: string }>(
    `select id, (to_jsonb(m) - 'thread_id' - 'ordinal')::text as body
       from spideryarn.chat_messages m where article_id in ($1, $2)`,
    [A, B],
  );
  return new Map(rows.map((r) => [r.id, r.body]));
}

async function placement(c: PoolClient, article: string): Promise<[string, string, number][]> {
  const { rows } = await c.query<{ thread_id: string; id: string; ordinal: number }>(
    `select thread_id, id, ordinal from spideryarn.chat_messages
      where article_id = $1 order by thread_id, ordinal`,
    [article],
  );
  return rows.map((r) => [r.thread_id, r.id, r.ordinal]);
}

async function snapshot(c: PoolClient): Promise<string> {
  const { rows } = await c.query(
    `select
       (select json_agg(t order by article_id, id) from spideryarn.chat_threads t where article_id in ($1, $2)) as threads,
       (select json_agg(m order by article_id, thread_id, ordinal) from spideryarn.chat_messages m where article_id in ($1, $2)) as messages,
       (select json_agg(r order by id) from spideryarn.realtime_sessions r where article_id in ($1, $2)) as rt,
       (select json_agg(c order by article_id, id) from spideryarn.comments c where article_id in ($1, $2)) as comments`,
    [A, B],
  );
  return JSON.stringify(rows[0]);
}

/** Run `body` in a transaction with the index out of the way, and always roll back. */
async function inRolledBack(body: (c: PoolClient) => Promise<void>): Promise<void> {
  const c = await pool!.connect();
  try {
    await c.query("begin");
    await c.query('drop index if exists "spideryarn"."chat_threads_one_remember"');
    await body(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

async function migrate(c: PoolClient): Promise<void> {
  for (const statement of STATEMENTS) await c.query(statement);
}

describe("the fold migration", () => {
  it("folds an article's Remember threads into its earliest, losing nothing", async () => {
    await inRolledBack(async (c) => {
      await seed(c);
      const before = await messageBodies(c);
      const bBefore = await placement(c, B);

      await migrate(c);

      /* Every row is still there, byte for byte, bar thread_id and ordinal. */
      expect(await messageBodies(c)).toEqual(before);

      /* A: one Remember thread, the earliest, holding everything in order —
         its own turns, then FOLD1's (created next), then FOLD2's. Numbering
         starts after the keeper's max ordinal (2), not its count. */
      expect(await placement(c, A)).toEqual([
        [KEEP, "spya-kpa002", 0],
        [KEEP, "spya-kpb002", 2],
        [KEEP, "spya-faa002", 3],
        [KEEP, "spya-fab002", 4],
        [KEEP, "spya-fac002", 5],
        [KEEP, "spya-fad002", 6],
        [KEEP, "spya-fba002", 7],
        [KEEP, "spya-fbb002", 8],
      ]);
      const { rows: aThreads } = await c.query(
        "select id, title, created_at, updated_at from spideryarn.chat_threads where article_id = $1",
        [A],
      );
      expect(aThreads).toHaveLength(1);
      expect(aThreads[0].id).toBe(KEEP);
      expect(aThreads[0].title).toBe(`title ${KEEP}`);
      expect(aThreads[0].created_at.toISOString()).toBe(T0);
      /* The group's latest clock, which was FOLD1's. */
      expect(aThreads[0].updated_at.toISOString()).toBe("2026-09-05T10:00:00.000Z");

      /* B: one Remember thread already, and chats — nothing moves, including
         the chat whose id is the same as a thread folded away in A. */
      expect(await placement(c, B)).toEqual(bBefore);
      const { rows: bThreads } = await c.query(
        "select id from spideryarn.chat_threads where article_id = $1 order by id",
        [B],
      );
      expect(bThreads.map((r) => r.id)).toEqual([BCHAT, BTWIN, SOLO].sort());

      /* The pointers follow in A, and only in A. */
      const { rows: rt } = await c.query(
        "select id, thread_id from spideryarn.realtime_sessions where id in ($1, $2) order by id",
        [RT_A, RT_B],
      );
      expect(rt).toEqual([
        { id: RT_A, thread_id: KEEP },
        { id: RT_B, thread_id: BTWIN },
      ]);
      const { rows: cm } = await c.query(
        "select article_id, thread_id from spideryarn.comments where article_id in ($1, $2) order by article_id",
        [A, B],
      );
      expect(cm).toEqual([
        { article_id: A, thread_id: KEEP },
        { article_id: B, thread_id: BTWIN },
      ]);

      /* And a second Remember thread is now refused by the index. */
      await c.query("savepoint second");
      await expect(
        c.query(
          `insert into spideryarn.chat_threads (article_id, id, owner_id, title, kind)
           values ($1, 'spya-secnd2', $2, 'again', 'remember')`,
          [B, currentOwnerId()],
        ),
      ).rejects.toThrow(/chat_threads_one_remember/);
      await c.query("rollback to savepoint second");
      /* A chat beside it is still fine. */
      await c.query(
        `insert into spideryarn.chat_threads (article_id, id, owner_id, title, kind)
         values ($1, 'spya-secnd2', $2, 'a chat', 'chat')`,
        [B, currentOwnerId()],
      );
    });
  });

  it("refuses, changing nothing, when a thread to be folded has an answer in flight", async () => {
    await inRolledBack(async (c) => {
      await seed(c, { pendingInFolded: true });
      const before = await snapshot(c);

      await c.query("savepoint fold");
      await expect(migrate(c)).rejects.toThrow(/answer still in flight/);
      await c.query("rollback to savepoint fold");

      expect(await snapshot(c)).toBe(before);
    });
  });

  it("fails rather than dropping a message whose id the keeper already has", async () => {
    await inRolledBack(async (c) => {
      await seed(c);
      /* A thread of A, created last, holding a message whose id the keeper
         already uses. `on conflict do nothing` would quietly lose it. */
      await c.query(
        `insert into spideryarn.chat_threads (article_id, id, owner_id, title, created_at, updated_at, kind)
         values ($1, 'spya-fdccc4', $2, 't', $3, $3, 'remember')`,
        [A, currentOwnerId(), "2026-09-04T10:00:00.000Z"],
      );
      await c.query(
        `insert into spideryarn.chat_messages (article_id, thread_id, id, ordinal, role, text, status)
         values ($1, 'spya-fdccc4', 'spya-kpa002', 0, 'user', 'dup', 'done')`,
        [A],
      );
      await c.query("savepoint fold");
      await expect(migrate(c)).rejects.toThrow(/chat_messages_pkey|duplicate key/);
      await c.query("rollback to savepoint fold");
    });
  });
});
