/**
 * The exporter must never write one article's rows into another's directory.
 *
 * ## Why this needs a test of its own
 *
 * tests/store-roundtrip.test.ts exports one article at a time and compares it
 * against its own files, so it cannot see a query that pulls in a *second*
 * article's rows — the extra rows would have to belong to an article the round
 * trip is also looking at, and even then they would land in the right file by
 * luck. Isolation is a different question from fidelity and it needs its own
 * fixture: two articles, deliberately colliding.
 *
 * ## What collides, and why it is normal rather than perverse
 *
 * Chat thread ids follow the same rule as block ids (docs/project/block-ids.md):
 * `spya-xxxxxx`, minted at random, unique only WITHIN an article. The primary
 * key on `chat_threads` is `(article_id, id)` for exactly that reason. So two
 * articles holding a thread called `spya-th0002` is not a corrupted database —
 * it is what the id scheme says will happen, roughly as often as birthdays
 * collide, and every query that touches one has to carry the article with it.
 *
 * The exporter filtered messages on `thread_id` alone. GPT Sol found it in
 * review on 2026-08-26; docs/plans/postgres-storage-review-sol.md. The symptom
 * would have been a rollback file containing a conversation from a different
 * article — one reader's private text under someone else's piece — with nothing
 * anywhere reporting it.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, chatMessages, chatThreads } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { exportArticle } from "../src/store/export.js";

loadEnvLocal();

/** The same thread id in both articles. That is the whole fixture. */
const THREAD_ID = "spya-th0002";

const A = {
  slug: "store-export-isolation-a",
  id: "00000000-0000-4000-8000-0000000000e1",
  revision: "00000000-0000-4000-8000-0000000000e3",
  text: "the message that belongs to article A",
} as const;
const B = {
  slug: "store-export-isolation-b",
  id: "00000000-0000-4000-8000-0000000000e2",
  revision: "00000000-0000-4000-8000-0000000000e4",
  text: "the message that belongs to article B",
} as const;

let reachable = false;

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  let why = "";
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.chat_messages') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) why = "the spideryarn schema is not there — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
  if (!reachable) {
    console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
  }
}

const when = reachable ? describe : describe.skip;

when("the exporter's article isolation", () => {
  let out: string;

  beforeAll(async () => {
    const db = getDb();
    const owner = currentOwnerId();
    for (const article of [A, B]) {
      await db
        .insert(articles)
        .values({ id: article.id, ownerId: owner, slug: article.slug })
        .onConflictDoNothing();
      await db
        .insert(articleRevisions)
        .values({ id: article.revision, articleId: article.id, status: "published" })
        .onConflictDoNothing();
      await db
        .update(articles)
        .set({ currentRevisionId: article.revision })
        .where(eq(articles.id, article.id));
      await db
        .insert(chatThreads)
        .values({ articleId: article.id, id: THREAD_ID, ownerId: owner, title: "a thread" })
        .onConflictDoNothing();
      await db
        .insert(chatMessages)
        .values({
          articleId: article.id,
          threadId: THREAD_ID,
          id: "spya-msg002",
          ordinal: 0,
          role: "user",
          text: article.text,
          status: "done",
        })
        .onConflictDoNothing();
    }
    out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-isolation-"));
  });

  afterAll(async () => {
    const db = getDb();
    for (const article of [A, B]) {
      // Messages and threads cascade from the article, but the pointer has to
      // be dropped first or the revision cannot go.
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, article.id));
      await db.delete(articleRevisions).where(eq(articleRevisions.id, article.revision));
      await db.delete(articles).where(eq(articles.id, article.id));
    }
    await closeDb();
    if (out) await rm(out, { recursive: true, force: true });
  });

  it("exports only the article's own chat messages, when two articles share a thread id", async () => {
    await exportArticle(A.slug, { dataRoot: out, outputRoot: path.join(out, "output") });
    const chat = JSON.parse(await readFile(path.join(out, A.slug, "chat.json"), "utf8")) as {
      threads: { id: string; messages: { text: string }[] }[];
    };

    expect(chat.threads).toHaveLength(1);
    const texts = chat.threads[0]?.messages.map((m) => m.text);
    // The assertion that matters is the ABSENCE. Asserting only that A's text
    // is present passes just as happily with both articles' messages in the
    // file — which is the bug this exists for.
    expect(texts).toEqual([A.text]);
    expect(texts).not.toContain(B.text);
  });
});
