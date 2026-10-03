/**
 * **The rollback keeps a conversation's kind** (plan 261002i, GPT Sol's plan
 * review, P1).
 *
 * `exportArticle` wrote `kind` as a Remember-or-chat ternary, so a Candidates
 * thread came back from a round trip as a chat, and so would a Tutorial one —
 * answered next time with chat's prompt, and listed in Chat, with nothing
 * failing. No fixture in `data/` has either kind, so
 * tests/store-roundtrip.test.ts cannot see it; the rows are made here, as
 * tests/store-export-search-kind.test.ts does for its own column.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, chatThreads } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { exportArticle } from "../src/store/export.js";
import type { ChatThread } from "../src/types.js";
import { seedChatFromFiles } from "./helpers/seed-reader-state.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "store-export-thread-kind-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-00000071a7a1";
const REVISION_ID = "00000000-0000-4000-8000-00000071a7a2";
const DATA_ROOT = path.join(process.cwd(), "data");
const EXPORTED_ARTICLE = path.join(DATA_ROOT, SLUG);

await pgReady({
  suite: "tests/store-export-thread-kind.test.ts",
  tables: ["spideryarn.chat_threads"],
});

describe("db:export and a conversation's kind", () => {
  let out: string;

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
    const at = new Date("2026-10-02T10:00:00.000Z");
    await db.insert(chatThreads).values(
      (["chat", "remember", "candidates", "tutorial", "explore"] as const).map((kind, i) => ({
        articleId: ARTICLE_ID,
        id: `spya-knd${"abcde"[i]}23`,
        ownerId: owner,
        title: kind,
        kind,
        createdAt: at,
        updatedAt: at,
      })),
    );
    out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-thread-kind-"));
    /* `seedChatFromFiles` deliberately reads the repository's `data/` root and
       cannot be pointed at a temp directory. This fixture slug is unique, and
       both hooks remove it, so the export can exercise the real restore helper
       rather than a test-only copy of it. */
    await rm(EXPORTED_ARTICLE, { recursive: true, force: true });
    await exportArticle(SLUG, { dataRoot: DATA_ROOT, outputRoot: path.join(out, "output") });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(chatThreads).where(eq(chatThreads.articleId, ARTICLE_ID));
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
    await db.delete(articleRevisions).where(eq(articleRevisions.id, REVISION_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
    await rm(EXPORTED_ARTICLE, { recursive: true, force: true });
    if (out) await rm(out, { recursive: true, force: true });
  });

  it("writes every kind as itself, Tutorial, Explore and Candidates included", async () => {
    const file = JSON.parse(await readFile(path.join(EXPORTED_ARTICLE, "chat.json"), "utf8")) as {
      threads: ChatThread[];
    };
    expect(Object.fromEntries(file.threads.map((t) => [t.title, t.kind]))).toEqual({
      chat: "chat",
      remember: "remember",
      candidates: "candidates",
      tutorial: "tutorial",
      explore: "explore",
    });
  });

  it("restores every exported kind as itself", async () => {
    const db = getDb();
    await db.delete(chatThreads).where(eq(chatThreads.articleId, ARTICLE_ID));
    expect(await seedChatFromFiles(SLUG)).toEqual({ threads: 5, messages: 0 });
    const restored = await db
      .select({ title: chatThreads.title, kind: chatThreads.kind })
      .from(chatThreads)
      .where(eq(chatThreads.articleId, ARTICLE_ID))
      .orderBy(asc(chatThreads.title));
    expect(restored).toEqual([
      { title: "candidates", kind: "candidates" },
      { title: "chat", kind: "chat" },
      { title: "explore", kind: "explore" },
      { title: "remember", kind: "remember" },
      { title: "tutorial", kind: "tutorial" },
    ]);
  });

  /* Explore's index, from the migration that widened the CHECK for it
     (drizzle/*_explore_thread_kind.sql, plan 261003l). */
  it("enforces one Explore thread per article", async () => {
    const db = getDb();
    const err: unknown = await db
      .insert(chatThreads)
      .values({
        articleId: ARTICLE_ID,
        id: "spya-kndy23",
        ownerId: currentOwnerId(),
        title: "another explore",
        kind: "explore",
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    const cause = (err as { cause?: unknown } | null)?.cause;
    expect(String((cause as { message?: string } | undefined)?.message ?? cause ?? err)).toMatch(
      /chat_threads_one_explore/,
    );
  });

  it("enforces one Tutorial thread per article", async () => {
    const db = getDb();
    const err: unknown = await db
      .insert(chatThreads)
      .values({
        articleId: ARTICLE_ID,
        id: "spya-kndz23",
        ownerId: currentOwnerId(),
        title: "another tutorial",
        kind: "tutorial",
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    /* Drizzle wraps the driver's error as "Failed query: …"; the index name is
       on the cause. */
    const cause = (err as { cause?: unknown } | null)?.cause;
    expect(String((cause as { message?: string } | undefined)?.message ?? cause ?? err)).toMatch(
      /chat_threads_one_tutorial/,
    );
  });
});
