/**
 * **The migration that folds Tutorial into Recall**: an article's Tutorial
 * conversation joins its Recall one, every other Tutorial thread becomes a
 * Recall thread, and the kind leaves the CHECK and its index.
 * drizzle/20261020063618_fold_tutorial_into_recall.sql.
 *
 * Against a real database, because what is being tested is SQL and its order.
 * The file is run statement by statement exactly as the migrator would, inside
 * a transaction that is always rolled back.
 *
 * The private test database has already run this migration, so each test first
 * puts the schema back to the day before it — the CHECK allowing `tutorial`,
 * and `chat_threads_one_tutorial` — then seeds what that day could hold.
 *
 * docs/plans/261020m-recall-and-tutorial-become-one-recall.md § Stored data,
 * and § Changed by GPT Sol's plan review (F1, F8). The earlier folds this one
 * copies are tested in tests/learn-one-thread-migration.test.ts and
 * tests/learn-kind-migration.test.ts.
 */
import { readFileSync } from "node:fs";

import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/tutorial-fold-migration.test.ts",
  tables: [
    "spideryarn.chat_threads",
    "spideryarn.chat_messages",
    "spideryarn.chat_mentions",
    "spideryarn.realtime_sessions",
    "spideryarn.comments",
  ],
  keepPool: true,
  max: 2,
});

afterAll(async () => {
  await pool.end();
});

const MIGRATION = readFileSync(
  new URL("../drizzle/20261020063618_fold_tutorial_into_recall.sql", import.meta.url),
  "utf8",
);
/* Split exactly where the migrator splits. */
const STATEMENTS = MIGRATION.split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s !== "");

const A = "a0000000-0000-4000-8000-0000007f01d0"; // Recall and Tutorial both
const B = "b0000000-0000-4000-8000-0000007f01d0"; // Tutorial only
const C = "c0000000-0000-4000-8000-0000007f01d0"; // Recall only, plus a chat twin
const RECALL_A = "spya-rcaa03";
const TUT_A = "spya-tuaa03";
const TUT_B = "spya-tubb03";
const RECALL_C = "spya-rccc03";
/* C has a CHAT thread whose id is A's Tutorial thread's: ids are only unique
   per article, so anything matched on id alone would fold or repoint it. */
const TWIN_C = TUT_A;
const BLOCK = "spya-bkaa03";
const RT_A = "c0000000-0000-4000-8000-0000007f01d1";
const RT_C = "d0000000-0000-4000-8000-0000007f01d1";

const T0 = "2026-09-01T10:00:00.000Z";
const T1 = "2026-09-02T10:00:00.000Z";
const T2 = "2026-09-03T10:00:00.000Z";
const T5 = "2026-09-05T10:00:00.000Z";

interface Msg {
  id: string;
  ordinal: number;
  role: "user" | "assistant";
  pending?: boolean;
}

async function seed(c: PoolClient, opts: { pendingInTutorial?: boolean } = {}): Promise<void> {
  const owner = currentOwnerId();
  for (const [id, slug] of [
    [A, "tutorial-fold-a"],
    [B, "tutorial-fold-b"],
    [C, "tutorial-fold-c"],
  ] as const) {
    await c.query("insert into spideryarn.articles (id, owner_id, slug) values ($1, $2, $3)", [id, owner, slug]);
    await c.query("insert into spideryarn.block_identities (article_id, block_id) values ($1, $2)", [id, BLOCK]);
  }
  const thread = (article: string, id: string, kind: string, created: string, updated: string, gist: string | null) =>
    c.query(
      `insert into spideryarn.chat_threads (article_id, id, owner_id, title, created_at, updated_at, kind, gist, gist_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [article, id, owner, `title ${id}`, created, updated, kind, gist, gist === null ? null : updated],
    );
  /* A's Tutorial thread is the later-touched of the two, so the keeper's clock
     must move; and the Recall thread has a gist, which must be cleared. */
  await thread(A, RECALL_A, "learn", T1, T2, "what Recall was about");
  await thread(A, TUT_A, "tutorial", T0, T5, "what Tutorial was about");
  await thread(B, TUT_B, "tutorial", T0, T1, "a Tutorial gist");
  await thread(C, RECALL_C, "learn", T0, T1, "a Recall gist");
  await thread(C, TWIN_C, "chat", T0, T1, null);

  const msgs = async (article: string, threadId: string, list: Msg[]) => {
    for (const m of list) {
      await c.query(
        `insert into spideryarn.chat_messages
           (article_id, thread_id, id, ordinal, role, text, status, attempt_id, attempt_started_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          article,
          threadId,
          m.id,
          m.ordinal,
          m.role,
          `text of ${m.id}`,
          m.pending ? "pending" : "done",
          m.pending ? "5e0f0000-0000-4000-8000-000000000003" : null,
          m.pending ? T2 : null,
          T1,
        ],
      );
    }
  };
  /* The keeper has a gap (0, 2): numbering from its count would collide. */
  await msgs(A, RECALL_A, [
    { id: "spya-rca003", ordinal: 0, role: "user" },
    { id: "spya-rcb003", ordinal: 2, role: "assistant" },
  ]);
  /* The Tutorial thread was written earlier, but goes after: conversation by
     conversation, never interleaved by timestamp. */
  await msgs(A, TUT_A, [
    { id: "spya-tua003", ordinal: 0, role: "user" },
    { id: "spya-tub003", ordinal: 1, role: "assistant" },
    { id: "spya-tuc003", ordinal: 2, role: "user" },
    { id: "spya-tud003", ordinal: 3, role: "assistant", pending: opts.pendingInTutorial === true },
  ]);
  await msgs(B, TUT_B, [
    { id: "spya-tba003", ordinal: 0, role: "user" },
    { id: "spya-tbb003", ordinal: 1, role: "assistant" },
  ]);
  await msgs(C, RECALL_C, [{ id: "spya-rcc003", ordinal: 0, role: "user" }]);
  await msgs(C, TWIN_C, [{ id: "spya-twa003", ordinal: 0, role: "user" }]);

  /* A live session spoken into A's Tutorial thread, and its twin in C. */
  for (const [id, article, threadId] of [
    [RT_A, A, TUT_A],
    [RT_C, C, TWIN_C],
  ] as const) {
    await c.query(
      `insert into spideryarn.realtime_sessions
         (id, owner_id, article_id, thread_id, model, issued_at, accepts_until)
       values ($1, $2, $3, $4, 'gpt-realtime', $5, $6)`,
      [id, owner, article, threadId, T1, T2],
    );
  }
  /* And a comment pointing at A's Tutorial thread, and its twin in C. */
  for (const [id, article, threadId] of [
    ["spya-cmaa03", A, TUT_A],
    ["spya-cmcc03", C, TWIN_C],
  ] as const) {
    await c.query(
      `insert into spideryarn.comments (article_id, id, owner_id, block_id, status, thread_id)
       values ($1, $2, $3, $4, 'none', $5)`,
      [article, id, owner, BLOCK, threadId],
    );
  }
}

/** Every message row in the three articles, keyed by id, minus the two columns the fold may change. */
async function messageBodies(c: PoolClient): Promise<Map<string, string>> {
  const { rows } = await c.query<{ id: string; body: string }>(
    `select id, (to_jsonb(m) - 'thread_id' - 'ordinal')::text as body
       from spideryarn.chat_messages m where article_id in ($1, $2, $3)`,
    [A, B, C],
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

/** Every thread row of the three articles, whole, keyed by article and id. */
async function threads(c: PoolClient): Promise<Map<string, Record<string, unknown>>> {
  const { rows } = await c.query<{ key: string; body: Record<string, unknown> }>(
    `select article_id || '/' || id as key, to_jsonb(t) as body
       from spideryarn.chat_threads t where article_id in ($1, $2, $3)`,
    [A, B, C],
  );
  return new Map(rows.map((r) => [r.key, r.body]));
}

async function snapshot(c: PoolClient): Promise<string> {
  const { rows } = await c.query(
    `select
       (select json_agg(t order by article_id, id) from spideryarn.chat_threads t where article_id in ($1, $2, $3)) as threads,
       (select json_agg(m order by article_id, thread_id, ordinal) from spideryarn.chat_messages m where article_id in ($1, $2, $3)) as messages,
       (select json_agg(cm order by article_id, message_id) from spideryarn.chat_mentions cm where article_id in ($1, $2, $3)) as mentions,
       (select json_agg(r order by id) from spideryarn.realtime_sessions r where article_id in ($1, $2, $3)) as rt,
       (select json_agg(c order by article_id, id) from spideryarn.comments c where article_id in ($1, $2, $3)) as comments`,
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
    await c.query('alter table "spideryarn"."chat_threads" drop constraint "chat_threads_kind"');
    await c.query(
      `alter table "spideryarn"."chat_threads" add constraint "chat_threads_kind"
         check ("kind" in ('chat','learn','candidates','tutorial','explore','guide'))`,
    );
    await c.query(
      `create unique index "chat_threads_one_tutorial" on "spideryarn"."chat_threads"
         using btree ("article_id") where "kind" = 'tutorial'`,
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

describe("the Tutorial fold migration", () => {
  it("folds an article's Tutorial thread into its Recall thread, losing nothing", async () => {
    await inRolledBack(async (c) => {
      await seed(c);
      const before = await messageBodies(c);
      const threadsBefore = await threads(c);
      const cBefore = await placement(c, C);

      await migrate(c);

      /* Every row is still there, byte for byte, bar thread_id and ordinal. */
      expect(await messageBodies(c)).toEqual(before);

      /* A: one thread, the Recall one, its own turns then Tutorial's in their
         order, numbered from the keeper's max ordinal (2), not its count. */
      expect(await placement(c, A)).toEqual([
        [RECALL_A, "spya-rca003", 0],
        [RECALL_A, "spya-rcb003", 2],
        [RECALL_A, "spya-tua003", 3],
        [RECALL_A, "spya-tub003", 4],
        [RECALL_A, "spya-tuc003", 5],
        [RECALL_A, "spya-tud003", 6],
      ]);
      const after = await threads(c);
      expect([...after.keys()].filter((k) => k.startsWith(A))).toEqual([`${A}/${RECALL_A}`]);
      const keeper = after.get(`${A}/${RECALL_A}`);
      const keeperBefore = threadsBefore.get(`${A}/${RECALL_A}`);
      /* F8: the later clock of the two (Tutorial's), and no gist, since the
         transcript it summarised has grown. Everything else is the keeper's. */
      expect(keeper?.updated_at).toBe(threadsBefore.get(`${A}/${TUT_A}`)?.updated_at);
      expect(keeper?.gist).toBeNull();
      expect(keeper?.gist_at).toBeNull();
      expect({ ...keeper, updated_at: null, gist: null, gist_at: null }).toEqual({
        ...keeperBefore,
        updated_at: null,
        gist: null,
        gist_at: null,
      });

      /* C: Recall alone and a chat twin — nothing moves. */
      expect(await placement(c, C)).toEqual(cBefore);
      expect(after.get(`${C}/${RECALL_C}`)).toEqual(threadsBefore.get(`${C}/${RECALL_C}`));
      expect(after.get(`${C}/${TWIN_C}`)).toEqual(threadsBefore.get(`${C}/${TWIN_C}`));

      /* The pointers follow in A, and only in A. */
      const { rows: rt } = await c.query(
        "select id, thread_id from spideryarn.realtime_sessions where id in ($1, $2) order by id",
        [RT_A, RT_C],
      );
      expect(rt).toEqual([
        { id: RT_A, thread_id: RECALL_A },
        { id: RT_C, thread_id: TWIN_C },
      ]);
      const { rows: cm } = await c.query(
        "select article_id, thread_id from spideryarn.comments where article_id in ($1, $2) order by article_id",
        [A, C],
      );
      expect(cm).toEqual([
        { article_id: A, thread_id: RECALL_A },
        { article_id: C, thread_id: TWIN_C },
      ]);
    });
  });

  it("renames a Tutorial-only thread to `learn`, keeping everything else", async () => {
    await inRolledBack(async (c) => {
      await seed(c);
      const before = await threads(c);
      const placed = await placement(c, B);
      /* The control: the seed did put the old word there. */
      expect(before.get(`${B}/${TUT_B}`)?.kind).toBe("tutorial");

      await migrate(c);

      const now = (await threads(c)).get(`${B}/${TUT_B}`);
      expect(now?.kind).toBe("learn");
      /* Id, title, both clocks, the gist: all as they were. */
      expect({ ...now, kind: null }).toEqual({ ...before.get(`${B}/${TUT_B}`), kind: null });
      expect(now?.gist).toBe("a Tutorial gist");
      expect(await placement(c, B)).toEqual(placed);
    });
  });

  it("refuses, changing nothing, when the Tutorial thread has an answer in flight", async () => {
    await inRolledBack(async (c) => {
      await seed(c, { pendingInTutorial: true });
      const before = await snapshot(c);

      await c.query("savepoint fold");
      await expect(migrate(c)).rejects.toThrow(/answer still in flight/);
      await c.query("rollback to savepoint fold");

      expect(await snapshot(c)).toBe(before);
    });
  });

  it("refuses, changing nothing, when a message to be moved has an @-mention (F1)", async () => {
    await inRolledBack(async (c) => {
      await seed(c);
      await c.query(
        `insert into spideryarn.chat_mentions (article_id, thread_id, message_id, position, title)
         values ($1, $2, 'spya-tua003', 0, 'another piece')`,
        [A, TUT_A],
      );
      const before = await snapshot(c);

      await c.query("savepoint fold");
      await expect(migrate(c)).rejects.toThrow(/spya-tua003.*@-mention/);
      await c.query("rollback to savepoint fold");

      expect(await snapshot(c)).toBe(before);
    });
  });

  /* Code review F1: deleting the folded row would lose a title the reader
     typed. Production had none renamed; if one appears, a person decides. */
  it("refuses, changing nothing, when the Tutorial thread to be folded was renamed by the reader", async () => {
    await inRolledBack(async (c) => {
      await seed(c);
      await c.query(
        `update spideryarn.chat_threads set title = 'my own name', renamed_at = now()
         where article_id = $1 and id = $2`,
        [A, TUT_A],
      );
      const before = await snapshot(c);

      await c.query("savepoint fold");
      await expect(migrate(c)).rejects.toThrow(/renamed/);
      await c.query("rollback to savepoint fold");

      expect(await snapshot(c)).toBe(before);
    });
  });

  it("refuses, changing nothing, when the two threads contain the same message id (F8)", async () => {
    await inRolledBack(async (c) => {
      await seed(c);
      /* Message ids are unique within a thread, not across an article, so this
         is valid before the fold but would collide in the keeper. */
      await c.query(
        `update spideryarn.chat_messages set id = 'spya-rca003'
          where article_id = $1 and thread_id = $2 and id = 'spya-tua003'`,
        [A, TUT_A],
      );
      const before = await snapshot(c);

      await c.query("savepoint fold");
      await expect(migrate(c)).rejects.toThrow(/chat_messages_pkey|duplicate key/);
      await c.query("rollback to savepoint fold");

      expect(await snapshot(c)).toBe(before);
    });
  });

  it("leaves no Tutorial index, and a CHECK that refuses the old word", async () => {
    await inRolledBack(async (c) => {
      await seed(c);
      expect(await indexNames(c)).toContain("chat_threads_one_tutorial");

      await migrate(c);

      const names = await indexNames(c);
      expect(names).not.toContain("chat_threads_one_tutorial");
      expect(names).toContain("chat_threads_one_learn");
      const { rows } = await c.query<{ n: string }>(
        "select count(*) as n from spideryarn.chat_threads where kind = 'tutorial'",
      );
      expect(Number(rows[0]?.n)).toBe(0);

      await c.query("savepoint old");
      await expect(
        c.query(
          `insert into spideryarn.chat_threads (article_id, id, owner_id, title, kind)
           values ($1, 'spya-prev33', $2, 'old code', 'tutorial')`,
          [C, currentOwnerId()],
        ),
      ).rejects.toThrow(/chat_threads_kind/);
      await c.query("rollback to savepoint old");
      /* And the kinds that remain are still allowed. */
      await c.query(
        `insert into spideryarn.chat_threads (article_id, id, owner_id, title, kind)
         values ($1, 'spya-xpre33', $2, 'explore', 'explore')`,
        [C, currentOwnerId()],
      );
    });
  });
});
