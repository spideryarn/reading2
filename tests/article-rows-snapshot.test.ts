/**
 * **`readArticleRows` is one snapshot, and this is the proof.**
 *
 * The walk reads ten tables. Until 2026-09-01 it read them through the pool with
 * `Promise.all` and no transaction, so each statement took its own snapshot and
 * the ten answers could come from ten different committed states. GPT Sol's
 * second code review of docs/plans/260901h-export-article-data.md, finding 2,
 * named the failure that costs a reader data:
 *
 * 1. the `chat_threads` read takes its snapshot;
 * 2. somebody's transaction commits a new thread **and** a message in it;
 * 3. the `chat_messages` read takes its snapshot, and sees that message;
 * 4. `src/store/export-bundle.ts` nests messages under the threads it was given,
 *    the new thread is not one of them, and the message is **dropped in
 *    silence** — from a zip whose README says it holds everything.
 *
 * The same shape mixes before-and-after state across comments, criteria,
 * searches and lookups, in either direction: a row can be counted twice as
 * easily as not at all.
 *
 * ## How this is tested without racing the database
 *
 * A race would be slow, flaky, and would only sometimes be evidence. Instead the
 * interleaving is made **deterministic** and put where it hurts most: the db
 * handle `readArticleRows` reaches for is wrapped so that, inside whatever
 * transaction it opens, the very first statement is a probe — which is what
 * takes the `repeatable read` snapshot — and a second connection then commits a
 * new thread, a message and a comment **before** the walk runs a single one of
 * its own reads. Every row that walk returns therefore comes from before that
 * commit, or the snapshot is not one.
 *
 * The probe also asks the transaction what it actually got, the same way
 * tests/store-session-isolation.test.ts does: `current_setting` is the server
 * describing itself, not a spy repeating what it was told, so it stays true if
 * the pin moves or changes shape.
 *
 * **This is not circular.** The wrapper passes the config through untouched, so
 * the isolation under test is the one src/store/article-rows.ts asks for. At
 * `read committed` — Postgres's default, and what an unpinned transaction would
 * inherit — the walk's reads would each see the concurrent commit and the
 * assertions below would fail.
 *
 * And the wrapper **refuses every read made outside the transaction**, so a
 * future walk that starts one and then quietly reads around it goes red rather
 * than half-green.
 *
 * ## Watched red twice, 2026-09-01
 *
 * Against the pre-Stage-I walk (`Promise.all`, no transaction): *"readArticleRows
 * called db.select() outside its transaction"* — no transaction was ever opened,
 * so the refusal fires before anything else can.
 *
 * Then, with the transaction in place and only the pin changed to
 * `read committed`: `expected [ 'spya-snpt23', 'spya-snpt24' ] to deeply equal
 * [ 'spya-snpt23' ]`. **That second one is the control that matters** — it is
 * what makes this file about the snapshot rather than about a transaction
 * existing, and the first one alone would not have distinguished the two.
 */
import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Db } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TxConfig = Parameters<Db["transaction"]>[1];

/** What the transaction said about itself, and what it was asked for. */
interface Opened {
  readonly level: string;
  readonly readOnly: string;
  readonly config: TxConfig;
}

/**
 * Installed by a test, read by the mocked `getDb` at call time.
 *
 * A module-scoped hook rather than a parameter on `readArticleRows`, because a
 * parameter no production caller passes is a parameter that exists for the test
 * — the same reasoning that kept a store handle off `articleBundle`.
 */
let hook: ((real: Db) => Db) | undefined;

vi.mock("../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/client.js")>();
  return {
    ...actual,
    getDb: () => {
      const real = actual.getDb();
      return hook ? hook(real) : real;
    },
  };
});

const { closeDb, getDb } = await import("../src/db/client.js");
const { readArticleRows } = await import("../src/store/article-rows.js");
type ArticleRows = Awaited<ReturnType<typeof readArticleRows>>;

const SLUG = "article-rows-snapshot-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-00000000e5b0";
const REVISION_ID = "00000000-0000-4000-8000-00000000e5b1";
const THREAD_BEFORE = "spya-snpt23";
const MESSAGE_BEFORE = "spya-snpm23";
/** Committed while the walk is mid-snapshot. Nothing it returns may name these. */
const THREAD_DURING = "spya-snpt24";
const MESSAGE_DURING = "spya-snpm24";
const COMMENT_DURING = "spya-snpc24";
const BLOCK_ID = "spya-snpb23";

await pgReady({
  suite: "tests/article-rows-snapshot.test.ts",
  tables: ["spideryarn.chat_messages", "spideryarn.chat_threads", "spideryarn.comments"],
});
/**
 * The same handle, with a probe as the first statement of every transaction and
 * a refusal on every read made outside one.
 *
 * The probe reads a real table as well as the two settings, so the snapshot is
 * taken on something a concurrent writer can move — `current_setting` alone
 * would be a thinner claim about when the snapshot is acquired.
 */
function interleaving(real: Db, opened: Opened[], interleave: () => Promise<void>): Db {
  return new Proxy(real, {
    get(target, prop, receiver): unknown {
      if (prop === "transaction") {
        return (body: (tx: Tx) => Promise<unknown>, config: TxConfig) =>
          target.transaction(async (tx) => {
            const probe = await tx.execute<{ level: string; ro: string; n: number }>(
              sql`select current_setting('transaction_isolation') as level,
                         current_setting('transaction_read_only') as ro,
                         (select count(*) from spideryarn.chat_messages
                           where article_id = ${ARTICLE_ID}) as n`,
            );
            const row = probe.rows[0];
            opened.push({
              level: row?.level ?? "(the database would not say)",
              readOnly: row?.ro ?? "(the database would not say)",
              config,
            });
            await interleave();
            return body(tx);
          }, config);
      }
      if (prop === "select" || prop === "insert" || prop === "update" || prop === "delete") {
        return () => {
          throw new Error(
            `readArticleRows called db.${String(prop)}() outside its transaction, so that ` +
              "statement takes a snapshot of its own and the walk is not one consistent read",
          );
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as Db;
}

describe("readArticleRows reads one article as one snapshot", () => {
  beforeAll(async () => {
    const db = getDb();
    const owner = currentOwnerId();
    await db
      .insert(schema.articles)
      .values({ id: ARTICLE_ID, ownerId: owner, slug: SLUG })
      .onConflictDoNothing();
    await db
      .insert(schema.articleRevisions)
      .values({ id: REVISION_ID, articleId: ARTICLE_ID, status: "published" })
      .onConflictDoNothing();
    await db
      .update(schema.articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(schema.articles.id, ARTICLE_ID));
    /* Before the block: `revision_blocks_identity_fk` refuses a block whose id
       was never minted. docs/project/block-ids.md. */
    await db
      .insert(schema.blockIdentities)
      .values({ articleId: ARTICLE_ID, blockId: BLOCK_ID })
      .onConflictDoNothing();
    await db
      .insert(schema.revisionBlocks)
      .values({
        articleId: ARTICLE_ID,
        revisionId: REVISION_ID,
        blockId: BLOCK_ID,
        ordinal: 0,
        tag: "p",
        kind: "text",
        text: "a paragraph that was here all along",
        words: 7,
        html: "<p>a paragraph that was here all along</p>",
        gistable: true,
      })
      .onConflictDoNothing();
    await db
      .insert(schema.chatThreads)
      .values({
        articleId: ARTICLE_ID,
        id: THREAD_BEFORE,
        ownerId: owner,
        title: "the thread that was already there",
        kind: "chat",
      })
      .onConflictDoNothing();
    await db
      .insert(schema.chatMessages)
      .values({
        articleId: ARTICLE_ID,
        threadId: THREAD_BEFORE,
        id: MESSAGE_BEFORE,
        ordinal: 0,
        role: "user",
        text: "asked before the walk started",
        status: "done",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    hook = undefined;
    const db = getDb();
    await db.delete(schema.chatMessages).where(eq(schema.chatMessages.articleId, ARTICLE_ID));
    await db.delete(schema.chatThreads).where(eq(schema.chatThreads.articleId, ARTICLE_ID));
    await db.delete(schema.comments).where(eq(schema.comments.articleId, ARTICLE_ID));
    await db.delete(schema.revisionBlocks).where(eq(schema.revisionBlocks.articleId, ARTICLE_ID));
    await db
      .delete(schema.blockIdentities)
      .where(eq(schema.blockIdentities.articleId, ARTICLE_ID));
    await db
      .update(schema.articles)
      .set({ currentRevisionId: null })
      .where(eq(schema.articles.id, ARTICLE_ID));
    await db.delete(schema.articleRevisions).where(eq(schema.articleRevisions.id, REVISION_ID));
    await db.delete(schema.articles).where(eq(schema.articles.id, ARTICLE_ID));
    await closeDb();
  });

  it("does not see a thread, message or comment committed while it runs", async () => {
    const real = getDb();
    const owner = currentOwnerId();
    const opened: Opened[] = [];
    let interleaved = 0;

    /* On a second connection out of the same pool — the walk is holding one of
       its own, and a write down that one would be the walk's own write rather
       than somebody else's. */
    const commitDuringTheWalk = async () => {
      interleaved += 1;
      await real.insert(schema.chatThreads).values({
        articleId: ARTICLE_ID,
        id: THREAD_DURING,
        ownerId: owner,
        title: "opened while the export was reading",
        kind: "chat",
      });
      await real.insert(schema.chatMessages).values({
        articleId: ARTICLE_ID,
        threadId: THREAD_DURING,
        id: MESSAGE_DURING,
        ordinal: 0,
        role: "user",
        text: "asked while the export was reading",
        status: "done",
      });
      await real.insert(schema.comments).values({
        articleId: ARTICLE_ID,
        id: COMMENT_DURING,
        ownerId: owner,
        blockId: BLOCK_ID,
        quote: "a stretch of prose",
        start: 0,
        body: "noted while the export was reading",
        status: "none",
      });
    };

    hook = (db) => interleaving(db, opened, commitDuringTheWalk);
    let rows: ArticleRows;
    try {
      rows = await readArticleRows(SLUG);
    } finally {
      hook = undefined;
    }

    /* The rig, asserted first. Without these the assertions below would pass on
       a walk that opened no transaction at all, because the concurrent commit
       is what the transaction hook triggers — no transaction, no interleaving,
       nothing to fail to see. */
    expect(opened.length, "the walk opens exactly one transaction").toBe(1);
    expect(interleaved, "the concurrent write really ran, mid-walk").toBe(1);

    expect(rows.chatThreads.map((t) => t.id)).toEqual([THREAD_BEFORE]);
    expect(rows.chatMessages.map((m) => m.id)).toEqual([MESSAGE_BEFORE]);
    expect(rows.comments.map((c) => c.id)).toEqual([]);

    /* And the rows really are there afterwards — an assertion that the fixture
       committed, so "the walk did not see them" is about the snapshot rather
       than about a write that never happened. */
    const after = await real
      .select({ id: schema.chatMessages.id })
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.articleId, ARTICLE_ID),
          eq(schema.chatMessages.id, MESSAGE_DURING),
        ),
      );
    expect(after.map((r) => r.id)).toEqual([MESSAGE_DURING]);
  }, 60_000);

  it("asks for repeatable read, and the transaction confirms it got it", async () => {
    const opened: Opened[] = [];
    hook = (db) => interleaving(db, opened, async () => {});
    try {
      await readArticleRows(SLUG);
    } finally {
      hook = undefined;
    }

    expect(opened.length).toBe(1);
    /* Asked of the server, not of the options object — this stays true if the
       pin moves, changes shape, or arrives from somewhere else. */
    expect(opened[0]?.level, "the walk's transaction, asked what level it got").toBe(
      "repeatable read",
    );
    expect(opened[0]?.readOnly, "and whether it may write anything").toBe("on");
  }, 60_000);

  it("throws ArticleNotFound for a stranger's slug, from inside the transaction", async () => {
    /* The transaction has to roll back cleanly on the not-found path; a throw
       out of a transaction body that left the connection un-released would show
       up here as a hang rather than as an error. */
    const missing = `no-such-article-${randomUUID()}`;
    await expect(readArticleRows(missing)).rejects.toThrow(missing);
  }, 60_000);
});
