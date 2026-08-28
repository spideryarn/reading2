/**
 * A conversation tied to a passage — docs/plans/chat-as-gateway.md.
 *
 * Three legal anchor shapes and one that must not exist:
 *
 *   absent                    an ordinary chat
 *   { blockId }               started from a paragraph's chat button
 *   { blockId, quote, start } started from a selection
 *   { blockId, quote }        ← the fourth. Not an error anybody sees: a mark
 *                               drawn a few characters to the left of the words
 *                               it belongs to, which reads as a styling glitch.
 *
 * The pure half runs anywhere. The stored half needs Postgres, and skips
 * loudly when there is none — see tests/db-schema.test.ts for why a quiet skip
 * is worse than a failure.
 *
 * Two mutations were run against this file to check the assertions can fail at
 * all, since a test that has never been red is not evidence:
 *
 *  - move `withTurn`'s anchor spread from the new-thread branch onto the
 *    returned thread, and both "does not re-anchor" tests fail;
 *  - drop the `blockIdentities` insert from the chat seeder, and "survives an
 *    export and an import" fails on the foreign key, taking the whole
 *    transaction with it.
 *
 * **And one that did not**, recorded because the obvious reading of the code is
 * wrong: naming the anchor columns in `upsertThread`'s `onConflictDoUpdate` set
 * changes nothing, because `withTurn` spreads the existing thread and hands the
 * anchor straight back. `upsertThread` has exactly one caller. Keeping those
 * columns out of the `set` is defensive rather than load-bearing today, and
 * "keeps the anchor when a second question arrives" is guarding `withTurn`'s
 * spread rather than the conflict clause it looks like it is guarding.
 */

import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { withTurn } from "../src/chat.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articles, blockIdentities, chatThreads } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { exportArticle } from "../src/store/export.js";
import { loadArticleIntoPg } from "./helpers/load-article.js";
import { seedChatFromFiles } from "./helpers/seed-reader-state.js";
import { pgChatStore } from "../src/store/pg-chat.js";
import type { ChatAnchor, ChatThread } from "../src/types.js";

loadEnvLocal();

const SLUG = "chat-anchor-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000f1";
/* Every character in the id alphabet, which excludes `i`, `l`, `o` and `1`.
   `withTurn` silently mints a replacement for anything `isSpideryarnId` does
   not like, which makes a typo here look like a store bug. */
const THREAD = "spya-anchr2";
const BLOCK = "spya-k3m9qt";
const OTHER_BLOCK = "spya-p7w2xz";
const ROOT = path.resolve(import.meta.dirname, "..");

const SELECTION: ChatAnchor = { blockId: BLOCK, quote: "qualia realism", start: 4 };
const WHOLE_BLOCK: ChatAnchor = { blockId: BLOCK };

/**
 * The smallest article in `data/` that the fixture loader will accept.
 *
 * Smallest so the copy is cheap; real so the import does not fail on something
 * unrelated to what is being tested. `_`-prefixed is the queue's, `test-`-
 * prefixed is another test's scratch directory.
 */
async function smallestLoadableArticle(): Promise<string | null> {
  const entries = await readdir(path.join(ROOT, "data"), { withFileTypes: true });
  const found: { slug: string; size: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith("test-")) continue;
    const files = await readdir(path.join(ROOT, "data", entry.name)).catch(() => [] as string[]);
    if (!files.includes("blocks.json") || !files.includes("tree.json")) continue;
    /* **Three more conditions than "it has blocks", and each one is a way the
       copy below fails for a reason that is nothing to do with anchors.**

       `output/<slug>.html` is the other half of the `extract` step, and
       `copyArtefacts` refuses a step whose products are only half present. A
       `labels.json` with no `sourceHash` predates stage 4 recording one, and
       the publication gate correctly refuses such an article — `constitution`
       is that article, and it is the smallest one here. `db:import` accepted
       both, which is what made them invisible. */
    const outputs = await Promise.all(
      outputPairs(entry.name, entry.name).map(([file]) => stat(file).catch(() => null)),
    );
    if (outputs.some((found) => !found)) continue;
    if (!files.includes("labels.json")) continue;
    const labels = JSON.parse(
      await readFile(path.join(ROOT, "data", entry.name, "labels.json"), "utf8"),
    ) as { sourceHash?: string };
    if (!labels.sourceHash) continue;

    const blocks = await readFile(path.join(ROOT, "data", entry.name, "blocks.json"), "utf8");
    found.push({ slug: entry.name, size: blocks.length });
  }
  found.sort((a, b) => a.size - b.size);
  return found[0]?.slug ?? null;
}

/**
 * The two files stage 2 and stage 3 leave in `output/`, renamed for a clone.
 *
 * `extract` produces `meta` and `extractedHtml`; `blocks` produces `blocks`.
 * The filesystem store keeps the second of each in `output/` rather than in the
 * article's own directory, so copying `data/<slug>/` alone leaves both steps
 * half-present — and `copyArtefacts` refuses a half-step outright rather than
 * recording one that did not finish. `db:import` read whichever of them
 * happened to be there, which is why this never came up before.
 */
function outputPairs(source: string, slug: string): [string, string][] {
  return [".html", ".blocks.json"].map((ext) => [
    path.join(ROOT, "output", `${source}${ext}`),
    path.join(ROOT, "output", `${slug}${ext}`),
  ]);
}

/** A clock the test drives, one second per call. */
function clockFrom(iso: string, stepMs = 1000): () => string {
  const start = Date.parse(iso);
  let n = 0;
  return () => new Date(start + stepMs * n++).toISOString();
}

describe("withTurn and the anchor", () => {
  const at = "2026-08-26T00:00:00.000Z";

  it("puts the anchor on a thread it creates", () => {
    const { thread } = withTurn([], { threadId: THREAD, question: "what?", anchor: SELECTION }, at);
    expect(thread.anchor).toEqual(SELECTION);
  });

  it("carries a block-only anchor, which is what the paragraph button sends", () => {
    const { thread } = withTurn(
      [],
      { threadId: THREAD, question: "what?", anchor: WHOLE_BLOCK },
      at,
    );
    expect(thread.anchor).toEqual(WHOLE_BLOCK);
    // The union's other arm. `quote` must be absent, not undefined.
    expect("quote" in (thread.anchor ?? {})).toBe(false);
  });

  it("leaves no `anchor` key at all on an ordinary chat", () => {
    const { thread } = withTurn([], { threadId: THREAD, question: "what?" }, at);
    /* `toEqual` would pass for `anchor: undefined` too. The absent-versus-
       undefined difference is the whole reason the two stores can disagree
       while every other assertion is green — see tests/store-roundtrip.test.ts. */
    expect("anchor" in thread).toBe(false);
  });

  it("does not re-anchor a thread that already exists", () => {
    const first = withTurn([], { threadId: THREAD, question: "what?", anchor: SELECTION }, at);
    const second = withTurn(
      first.threads,
      { threadId: THREAD, question: "and now?", anchor: { blockId: OTHER_BLOCK } },
      "2026-08-26T00:01:00.000Z",
    );
    /* The anchor draws a mark in the prose. A thread that re-anchored itself
       would move its mark to a paragraph the reader is not looking at, and
       nothing anywhere would disagree with it. */
    expect(second.thread.anchor).toEqual(SELECTION);
    expect(second.thread.messages).toHaveLength(4);
  });

  it("does not grow an anchor on a thread that never had one", () => {
    const first = withTurn([], { threadId: THREAD, question: "what?" }, at);
    const second = withTurn(
      first.threads,
      { threadId: THREAD, question: "and now?", anchor: SELECTION },
      "2026-08-26T00:01:00.000Z",
    );
    expect("anchor" in second.thread).toBe(false);
  });
});

/* ------------------------------------------------------------- postgres -- */

let reachable = false;

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 10_000,
  });
  let why = "";
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.chat_threads') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) why = "the spideryarn schema is not there — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
  if (!reachable) console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
}

const when = reachable ? describe : describe.skip;

when("the anchor, stored", () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(articles)
      // No `currentRevisionId`, so the library cannot see it. Same trick as
      // tests/store-chat-pg.test.ts.
      .values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG })
      .onConflictDoNothing();
    /* The identities have to exist before anything can anchor to them —
       `chat_threads_anchor_identity_fk` is the same shape and the same
       unforgiving as `comments_identity_fk`. */
    await db
      .insert(blockIdentities)
      .values([
        { articleId: ARTICLE_ID, blockId: BLOCK },
        { articleId: ARTICLE_ID, blockId: OTHER_BLOCK },
      ])
      .onConflictDoNothing();
  });

  afterEach(async () => {
    await getDb().delete(chatThreads).where(eq(chatThreads.articleId, ARTICLE_ID));
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(chatThreads).where(eq(chatThreads.articleId, ARTICLE_ID));
    await db.delete(blockIdentities).where(eq(blockIdentities.articleId, ARTICLE_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
  });

  async function reload(): Promise<ChatThread | undefined> {
    return (await pgChatStore.load(SLUG)).find((t) => t.id === THREAD);
  }

  it("round-trips a selection anchor through the three columns", async () => {
    await pgChatStore.begin(
      SLUG,
      { threadId: THREAD, question: "what does this mean?", anchor: SELECTION },
      clockFrom("2026-08-26T00:00:00.000Z"),
    );
    expect((await reload())?.anchor).toEqual(SELECTION);

    // And the columns really are three, rather than one JSON blob that happens
    // to read back the same way.
    const [row] = await getDb()
      .select({
        blockId: chatThreads.anchorBlockId,
        quote: chatThreads.anchorQuote,
        start: chatThreads.anchorStart,
      })
      .from(chatThreads)
      .where(and(eq(chatThreads.articleId, ARTICLE_ID), eq(chatThreads.id, THREAD)));
    expect(row).toEqual({ blockId: BLOCK, quote: "qualia realism", start: 4 });
  });

  it("round-trips a block-only anchor without inventing a quote", async () => {
    await pgChatStore.begin(
      SLUG,
      { threadId: THREAD, question: "tell me about this paragraph", anchor: WHOLE_BLOCK },
      clockFrom("2026-08-26T00:00:00.000Z"),
    );
    const thread = await reload();
    expect(thread?.anchor).toEqual(WHOLE_BLOCK);
    expect("quote" in (thread?.anchor ?? {})).toBe(false);
  });

  it("leaves no `anchor` key on an unanchored thread", async () => {
    await pgChatStore.begin(
      SLUG,
      { threadId: THREAD, question: "just chatting" },
      clockFrom("2026-08-26T00:00:00.000Z"),
    );
    const thread = await reload();
    /* Not `toBeUndefined`. The filesystem store omits the key, and
       tests/store-roundtrip.test.ts compares the two — `anchor: undefined` here
       and no key there is exactly the mismatch that comparison exists to find,
       and exactly the one `toEqual` cannot see. */
    expect(thread && "anchor" in thread).toBe(false);
  });

  it("keeps the anchor when a second question arrives", async () => {
    const clock = clockFrom("2026-08-26T00:00:00.000Z");
    await pgChatStore.begin(
      SLUG,
      { threadId: THREAD, question: "what does this mean?", anchor: SELECTION },
      clock,
    );
    /* What this actually guards is `withTurn` spreading `...base`, which is
       what carries the stored anchor into the thread written back. Lose that
       and the reader's second message silently unmarks the paragraph they
       asked about. It is NOT a test of `upsertThread`'s conflict clause — see
       the header. */
    await pgChatStore.begin(SLUG, { threadId: THREAD, question: "and Dennett?" }, clock);
    expect((await reload())?.anchor).toEqual(SELECTION);
  });

  /**
   * The seam Sol found, and the reason it is worth a test of its own: export
   * and import both build a thread from named fields, so a new field is
   * dropped by *doing nothing*. `tools` went missing from an export exactly
   * this way once already.
   *
   * **Built by copying a real article** rather than by hand. A hand-written
   * `blocks.json` and `tree.json` is not enough — `deriveLibraryScalars` and
   * the revision insert want a good deal more than that, and two attempts at a
   * minimal fixture failed on things that had nothing to do with anchors. The
   * `test-` prefix is the established convention for a scratch article; the
   * roundtrip and parity suites both skip directories named that way.
   *
   * The anchored block is deliberately **not** one of the article's blocks.
   * That is the case that matters: an archive taken before a re-extraction,
   * restored after one. Import has to mint the identity itself, or
   * `chat_threads_anchor_identity_fk` rejects the insert and takes the whole
   * transaction with it — a restore that fails outright rather than a mark that
   * quietly goes missing.
   */
  it("survives an export and an import, for a block this revision no longer has", async () => {
    /* **Loud, not a silent return.** This used to `return` when nothing in
       `data/` was copyable, which reads as a pass. The selector now asks for
       four things rather than two — see its own note — so "nothing qualifies"
       became a great deal more likely at exactly the moment it became a great
       deal less obvious. */
    const source = await smallestLoadableArticle();
    if (!source) {
      throw new Error(
        "no article in data/ can be cloned for this test: it needs blocks.json, tree.json, " +
          "a labels.json with a sourceHash, and both output/<slug>.html and " +
          "output/<slug>.blocks.json. Run the pipeline over something.",
      );
    }

    const slug = "test-anchor-roundtrip";
    const dir = path.join(ROOT, "data", slug);
    const outputs = outputPairs(source, slug).map(([, to]) => to);
    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-anchor-"));
    try {
      await rm(dir, { recursive: true, force: true });
      await cp(path.join(ROOT, "data", source), dir, { recursive: true });
      /* **The article's own name, rewritten inside every file it appears in.**
         The filesystem artefact store decodes `meta.json` by checking the
         `slug` field matches the directory, so a straight copy reads back as an
         article that is not there — and `copyArtefacts` then finds nothing to
         copy and the load refuses. */
      for (const name of await readdir(dir)) {
        if (!name.endsWith(".json")) continue;
        const at = path.join(dir, name);
        const text = await readFile(at, "utf8");
        await writeFile(at, text.replaceAll(`"${source}"`, `"${slug}"`));
      }
      /* `extract` produces `meta` AND `extractedHtml`, and the filesystem store
         keeps the second one in `output/<slug>.html`. Copying only `data/`
         leaves the step half-present, and `copyArtefacts` refuses a half-step
         outright rather than recording one that did not finish. `db:import`
         read the file if it happened to be there and imported the article
         without it if it was not, which is the difference this whole exercise
         is about. */
      for (const [from, to] of outputPairs(source, slug)) {
        const text = await readFile(from, "utf8");
        await writeFile(to, text.replaceAll(`"${source}"`, `"${slug}"`));
      }
      await writeFile(
        path.join(dir, "chat.json"),
        `${JSON.stringify(
          {
            threads: [
              {
                id: THREAD,
                title: "About a paragraph that has gone",
                createdAt: "2026-08-26T00:00:00.000Z",
                updatedAt: "2026-08-26T00:00:01.000Z",
                anchor: SELECTION,
                messages: [
                  {
                    id: "spya-msgaaa",
                    role: "user",
                    text: "what does this mean?",
                    createdAt: "2026-08-26T00:00:00.000Z",
                    status: "done",
                  },
                  {
                    id: "spya-msgbbb",
                    role: "assistant",
                    text: "It means this.",
                    createdAt: "2026-08-26T00:00:01.000Z",
                    status: "done",
                  },
                ],
              },
            ],
          },
          null,
          2,
        )}\n`,
      );

      /* The artefacts through the production write path, the conversation
         seeded beside them — `db:import` did both and is being deleted
         (docs/plans/delete-the-importer.md § C7). Only the chat is needed here:
         seeding state this test never looks at would be slower and no more
         honest. */
      await loadArticleIntoPg(slug);
      await seedChatFromFiles(slug);
      await exportArticle(slug, {
        dataRoot: path.join(out, "data"),
        outputRoot: path.join(out, "output"),
      });

      const returned = JSON.parse(
        await readFile(path.join(out, "data", slug, "chat.json"), "utf8"),
      ) as { threads: ChatThread[] };
      expect(returned.threads.find((t) => t.id === THREAD)?.anchor).toEqual(SELECTION);
    } finally {
      await rm(out, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
      for (const file of outputs) await rm(file, { force: true });
      const db = getDb();
      const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, slug));
      for (const row of rows) await db.delete(articles).where(eq(articles.id, row.id));
    }
  });

  it("refuses an anchor naming a block this article has never had", async () => {
    await expect(
      pgChatStore.begin(
        SLUG,
        { threadId: THREAD, question: "what?", anchor: { blockId: "spya-zzzzzz" } },
        clockFrom("2026-08-26T00:00:00.000Z"),
      ),
    ).rejects.toThrow();
  });
});
