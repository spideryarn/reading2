/**
 * A re-import makes Postgres MATCH the files — including what they no longer have.
 *
 * Every reader-state insert in src/store/import.ts is `on conflict do nothing`,
 * which is right for a row that is already identical and silently wrong for one
 * the reader has deleted. Without a matching delete the database only ever
 * grows, and it did: `data/writes/comments.json` held two comments while
 * Postgres held three, because one had been deleted through the app after an
 * earlier import. tests/store-parity.test.ts went red for that on 2026-08-26,
 * which is the parity test doing its job — but only by luck of somebody having
 * deleted a comment. This asserts it on purpose.
 *
 * GPT Sol named the cause in review the same morning:
 * docs/plans/postgres-storage-review-sol.md.
 *
 * ## The fixture is `_`-prefixed, deliberately
 *
 * `data/_test-import-convergence/` is skipped by both other database suites —
 * `importableSlugs` in src/store/import.ts skips `_` because of `data/_jobs/`,
 * and tests/store-parity.test.ts's own scan skips it too. Vitest runs files
 * concurrently, so a fixture article they COULD see is a fixture article that
 * makes them flaky. An underscore is a valid slug character (`/^[\w.-]+$/`), so
 * `importArticle` still takes it when named explicitly.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  comments as commentsTable,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { fsArticleReader } from "../src/store/fs.js";
import { importArticle } from "../src/store/import.js";
import { pgArticleReader } from "../src/store/pg.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "_test-import-convergence";
const DIR = path.join(ROOT, "data", SLUG);
const BLOCK_ID = "spya-cnv222";
/** In the file, so it must survive. */
const KEPT = "spya-cnv333";
/** In the database only, so it must go. */
const STRAY = "spya-cnv444";

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
    const probe = await pool.query("select to_regclass('spideryarn.comments') is not null as ready");
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

when("re-importing an article", () => {
  beforeAll(async () => {
    await mkdir(DIR, { recursive: true });
    const write = (name: string, value: unknown) =>
      writeFile(path.join(DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

    await write("meta.json", { slug: SLUG, title: "A fixture", fetchedAt: "2026-08-01T00:00:00Z" });
    await write("blocks.json", {
      blocks: [
        {
          id: BLOCK_ID,
          tag: "p",
          kind: "text",
          text: "a paragraph",
          words: 2,
          html: `<p id="${BLOCK_ID}">a paragraph</p>`,
          gistable: true,
        },
      ],
    });
    await write("tree.json", {
      version: "toc/1",
      generator: "fixture",
      slug: SLUG,
      rootId: "n0001",
      nodes: {
        n0001: {
          id: "n0001",
          depth: 0,
          parent: null,
          children: [],
          range: [BLOCK_ID, BLOCK_ID],
          title: "A fixture",
          gist: "A fixture article that exists only for this test.",
        },
      },
    });
    await write("comments.json", {
      comments: [
        {
          id: KEPT,
          blockId: BLOCK_ID,
          quote: "a paragraph",
          start: 0,
          createdAt: "2026-08-01T00:00:00.000Z",
          status: "done",
          answer: "an answer",
        },
      ],
    });
    await importArticle(SLUG);
  }, 30_000);

  afterAll(async () => {
    const db = getDb();
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));
    const id = rows[0]?.id;
    if (id) {
      // The pointer has to let go before the revision can cascade away.
      /* One delete, and let the cascades do the rest. Removing the rows by
         hand in the wrong order fails on `comments_identity_fk` and then on
         `revision_blocks_identity_fk`: neither is `on delete cascade`, on
         purpose, so that an identity cannot be dropped while something still
         points at it. Deleting the article cascades everything below it and
         works out the order itself. */
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
      await db.delete(articles).where(eq(articles.id, id));
    }
    await closeDb();
    await rm(DIR, { recursive: true, force: true });
  });

  it("removes a comment the files no longer have, and keeps the one they do", async () => {
    const db = getDb();
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));
    const articleId = rows[0]?.id;
    expect(articleId).toBeDefined();

    // Stand in for a comment that was imported once and later deleted through
    // the app. The file is the truth; this row is what the truth has dropped.
    await db.insert(commentsTable).values({
      articleId: articleId!,
      id: STRAY,
      ownerId: currentOwnerId(),
      blockId: BLOCK_ID,
      quote: "a paragraph",
      start: 0,
      status: "done",
    });

    await importArticle(SLUG);

    const after = await db
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(eq(commentsTable.articleId, articleId!));
    const ids = after.map((r) => r.id).sort();
    // Both halves matter. Asserting only that the stray is gone passes just as
    // well if the import wiped everything.
    expect(ids).toEqual([KEPT]);
  }, 30_000);

  it("updates the scalars in step with the tree it publishes", async () => {
    /**
     * **The invariant the shelf now depends on**, and it is not immutability.
     *
     * Since 2026-08-28 `listArticles` prints `word_count`, `block_count`,
     * `part_count`, `section_count` and `root_gist` instead of recomputing them
     * from every block row and the whole tree of every article. That is only
     * safe because every writer sets those columns **in the same transaction**
     * as the blocks and tree they describe.
     *
     * The importer is the writer that makes "immutable once published" false:
     * when the text has not changed it reuses the current published revision
     * and updates it in place. GPT Sol's second finding on
     * docs/plans/library-read-latency.md — the plan claimed nothing ever
     * touches a published revision, and the tool this migration runs on does.
     *
     * So: same ids, same text, different `words` and a different tree. The
     * importer must take the update-in-place path (same revision id) and the
     * five columns must describe what is now there. Red if `...scalars` is ever
     * dropped from the update while `tree` stays in it — at which point the
     * shelf would print last week's blurb and word count for ever, with nothing
     * to say so.
     */
    const db = getDb();
    const before = await db
      .select({ id: articles.currentRevisionId })
      .from(articles)
      .where(eq(articles.slug, SLUG));

    const write = (name: string, value: unknown) =>
      writeFile(path.join(DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

    /* Same id and same text — that is what sends the importer down the
       update-in-place branch — and a different word count. */
    await write("blocks.json", {
      blocks: [
        {
          id: BLOCK_ID,
          tag: "p",
          kind: "text",
          text: "a paragraph",
          words: 99,
          html: `<p id="${BLOCK_ID}">a paragraph</p>`,
          gistable: true,
        },
      ],
    });
    await write("tree.json", {
      version: "toc/1",
      generator: "fixture",
      slug: SLUG,
      rootId: "n0001",
      nodes: {
        n0001: {
          id: "n0001",
          depth: 0,
          parent: null,
          children: ["n0002"],
          range: [BLOCK_ID, BLOCK_ID],
          title: "A fixture",
          gist: "A blurb the second import wrote.",
        },
        n0002: {
          id: "n0002",
          depth: 1,
          parent: "n0001",
          children: ["n0003"],
          range: [BLOCK_ID, BLOCK_ID],
          title: "Part one",
        },
        /* A depth-2 node, so `section_count` moves too. Without it this test
           asserted four of the five while claiming all five — GPT Sol's third
           finding on the built code, and the kind of gap that leaves one column
           unwritten by a future importer with nothing to say so. */
        n0003: {
          id: "n0003",
          depth: 2,
          parent: "n0002",
          children: [],
          range: [BLOCK_ID, BLOCK_ID],
          title: "Section one",
        },
      },
    });
    await importArticle(SLUG);

    const after = await db
      .select({
        id: articles.currentRevisionId,
        wordCount: articleRevisions.wordCount,
        blockCount: articleRevisions.blockCount,
        partCount: articleRevisions.partCount,
        sectionCount: articleRevisions.sectionCount,
        rootGist: articleRevisions.rootGist,
      })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .where(eq(articles.slug, SLUG));

    /* The same revision, updated — not a new one. If this ever mints instead,
       the test above it is no longer testing what it says. */
    expect(after[0]?.id).toBe(before[0]?.id);
    expect({
      words: after[0]?.wordCount,
      blocks: after[0]?.blockCount,
      parts: after[0]?.partCount,
      sections: after[0]?.sectionCount,
      gist: after[0]?.rootGist,
    }).toEqual({
      words: 99,
      blocks: 1,
      parts: 1,
      sections: 1,
      gist: "A blurb the second import wrote.",
    });
  }, 30_000);

  it("stays out of the library, in BOTH stores", async () => {
    /* `_`-prefixed directories are not articles — `data/_jobs/` is the ingest
       queue's — and src/api.ts has skipped the prefix since it was written.
       src/store/pg.ts had no equivalent, so the two libraries disagreed about
       any slug starting with an underscore. Nothing found it until this
       fixture existed, and then it showed up as tests/store-parity.test.ts
       failing in a full run and passing alone: the least useful kind of red,
       for a real reason.

       Asserted in both stores rather than just the new one, so that "they
       agree" cannot be satisfied by both of them listing it. */
    const [fromFiles, fromPg] = await Promise.all([
      fsArticleReader.listArticles(),
      pgArticleReader.listArticles(),
    ]);
    expect(fromPg.map((e) => e.slug)).not.toContain(SLUG);
    expect(fromFiles.map((e) => e.slug)).not.toContain(SLUG);
    // Not vacuous: both stores must be listing something.
    expect(fromPg.length).toBeGreaterThan(0);
    expect(fromFiles.length).toBeGreaterThan(0);
  });

  it("keeps the block identity even when its comment goes", async () => {
    /* Identities are never deleted — that is the rule the comment anchor rests
       on (docs/project/block-ids.md), and a cleanup that "tidied" them away
       would take the reader's questions about dropped paragraphs with it. */
    const db = getDb();
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));
    const identities = await db
      .select({ blockId: blockIdentities.blockId })
      .from(blockIdentities)
      .where(eq(blockIdentities.articleId, rows[0]!.id));
    expect(identities.map((i) => i.blockId)).toContain(BLOCK_ID);
  });
});
