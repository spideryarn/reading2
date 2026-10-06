/**
 * **A stored thread kind this code does not know is an error, not a chat.**
 * docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md,
 * stage 0 (GPT Sol's plan review, PR-1).
 *
 * `chat_threads.kind` is `not null` with a CHECK listing the kinds, so a value
 * outside `THREAD_KINDS` can only mean the database is newer or older than the
 * code reading it: a deploy in progress. Until 2026-10-06 both readers turned
 * such a row into `"chat"`. A Retry or Edit of a Recall answer in that window
 * was then answered with Chat's prompt and stored, and an export labelled the
 * conversation a chat, with nothing failing anywhere.
 *
 * Two seams, because there are two readers:
 *
 * - **`threadsFor`** (src/store/pg-chat.ts) reads a real row. The row cannot
 *   exist while the CHECK does, so the CHECK is dropped and the row inserted
 *   inside a transaction that is always rolled back, the pattern of
 *   tests/remember-one-thread-migration.test.ts. The database is shared by the
 *   whole run, so nothing here may commit.
 * - **`exportArticle`** (src/store/export.ts) opens its own snapshot and cannot
 *   be handed that transaction, so the row is changed in hand instead:
 *   `readArticleRows` runs for real and one thread's `kind` is overwritten on
 *   the way back. That is the exact value the export's mapping receives.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, chatThreads } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { exportArticle } from "../src/store/export.js";
import { threadsFor } from "../src/store/pg-chat.js";
import * as types from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

const FUTURE = "kind-from-the-future";

/* Off until the export test turns it on, so every other read in this file sees
   the rows as they are. */
const tamper = vi.hoisted(() => ({ kind: undefined as string | undefined }));

vi.mock("../src/store/article-rows.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/article-rows.js")>();
  return {
    ...real,
    readArticleRows: async (slug: string) => {
      const rows = await real.readArticleRows(slug);
      if (tamper.kind === undefined) return rows;
      return { ...rows, chatThreads: rows.chatThreads.map((t) => ({ ...t, kind: tamper.kind as string })) };
    },
  };
});

loadEnvLocal();

const SLUG = "unknown-stored-thread-kind-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000f07a1";
const REVISION_ID = "00000000-0000-4000-8000-0000000f07a2";
const TX_ARTICLE_ID = "00000000-0000-4000-8000-0000000f07a3";
const DATA_ROOT = path.join(process.cwd(), "data");

await pgReady({
  suite: "tests/unknown-stored-thread-kind.test.ts",
  tables: ["spideryarn.chat_threads"],
});

class RolledBack extends Error {}

describe("storedThreadKind", () => {
  it("passes every kind we know and refuses anything else by name", () => {
    for (const kind of types.THREAD_KINDS) expect(types.storedThreadKind(kind)).toBe(kind);
    expect(() => types.storedThreadKind(FUTURE)).toThrow(types.UnknownStoredThreadKind);
    /* The name is on `stored`, not in the message: the message is the sentence
       a reader is shown with the 409. */
    let thrown: unknown;
    try {
      types.storedThreadKind(FUTURE);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ stored: FUTURE, status: 409 });
  });
});

describe("a stored thread whose kind this code does not know", () => {
  let out: string;
  const at = new Date("2026-10-06T10:00:00.000Z");

  beforeAll(async () => {
    const db = getDb();
    const owner = currentOwnerId();
    await db.insert(articles).values({ id: ARTICLE_ID, ownerId: owner, slug: SLUG }).onConflictDoNothing();
    await db
      .insert(articleRevisions)
      .values({ id: REVISION_ID, articleId: ARTICLE_ID, status: "published" })
      .onConflictDoNothing();
    await db.update(articles).set({ currentRevisionId: REVISION_ID }).where(eq(articles.id, ARTICLE_ID));
    await db.delete(chatThreads).where(eq(chatThreads.articleId, ARTICLE_ID));
    await db.insert(chatThreads).values({
      articleId: ARTICLE_ID,
      id: "spya-fut223",
      ownerId: owner,
      title: "recall",
      kind: "remember",
      createdAt: at,
      updatedAt: at,
    });
    out = await mkdtemp(path.join(tmpdir(), "spideryarn-unknown-thread-kind-"));
    await rm(path.join(DATA_ROOT, SLUG), { recursive: true, force: true });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(chatThreads).where(eq(chatThreads.articleId, ARTICLE_ID));
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
    await db.delete(articleRevisions).where(eq(articleRevisions.id, REVISION_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
    await rm(path.join(DATA_ROOT, SLUG), { recursive: true, force: true });
    if (out) await rm(out, { recursive: true, force: true });
  });

  it("makes the thread read throw, rather than come back as a chat", async () => {
    let read: unknown;
    await getDb()
      .transaction(async (tx) => {
        const owner = currentOwnerId();
        await tx.execute(sql`alter table "spideryarn"."chat_threads" drop constraint "chat_threads_kind"`);
        await tx.insert(articles).values({ id: TX_ARTICLE_ID, ownerId: owner, slug: `${SLUG}-tx` });
        await tx.execute(sql`
          insert into "spideryarn"."chat_threads" (article_id, id, owner_id, title, kind, created_at, updated_at)
          values (${TX_ARTICLE_ID}, 'spya-fut323', ${owner}, 'recall', ${FUTURE}, ${at.toISOString()}, ${at.toISOString()})`);
        /* The control: the row is really there, with the kind nobody knows. */
        const stored = await tx
          .select({ kind: chatThreads.kind })
          .from(chatThreads)
          .where(eq(chatThreads.articleId, TX_ARTICLE_ID));
        expect(stored).toEqual([{ kind: FUTURE }]);
        read = await threadsFor(TX_ARTICLE_ID, tx).then(
          (threads) => ({ returned: threads.map((t) => t.kind) }),
          (err: unknown) => ({ threw: err }),
        );
        throw new RolledBack();
      })
      .catch((err: unknown) => {
        if (!(err instanceof RolledBack)) throw err;
      });
    /* Two assertions so a regression prints what came back (`returned:
       ["chat"]`) rather than only that the class did not match. */
    expect(read).not.toHaveProperty("returned");
    expect(read).toMatchObject({ threw: expect.any(types.UnknownStoredThreadKind) });
    /* Rolled back: the CHECK is still there. */
    const { rows } = await getDb().execute(
      sql`select 1 from pg_constraint where conname = 'chat_threads_kind' and conrelid = 'spideryarn.chat_threads'::regclass`,
    );
    expect(rows).toHaveLength(1);
  });

  it("makes the export fail, rather than label the thread a chat", async () => {
    const run = () => exportArticle(SLUG, { dataRoot: DATA_ROOT, outputRoot: path.join(out, "output") });
    /* The control, and the reason the failure below is about the kind: the same
       export of the same rows, untouched, succeeds. */
    tamper.kind = undefined;
    await run();
    tamper.kind = FUTURE;
    try {
      await expect(run()).rejects.toBeInstanceOf(types.UnknownStoredThreadKind);
    } finally {
      tamper.kind = undefined;
    }
  });
});
