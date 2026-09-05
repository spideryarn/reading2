/**
 * The reader-state seeder, tested — because it writes rows nothing else can.
 *
 * `tests/helpers/seed-reader-state.ts` puts a reader's comments, chat, searches,
 * lookups and shelf state into Postgres from the files, for the three suites
 * that used to get all of it from `db:import`
 * (docs/plans/260827aa-delete-the-importer.md § C7). It writes columns directly, and
 * says so: `pgShelfStore.patch` cannot set `opens` to 874 or archive with last
 * week's date, and `pgCommentStore.create` makes a current unanswered comment
 * when half the corpus's are answered.
 *
 * ## What this file is actually for
 *
 * One thing in that helper has **no fixture to exercise it**, and a review
 * found it rather than a red test:
 *
 * > A comment may be anchored to a block the current revision no longer has.
 * > That is the whole design (docs/project/block-ids.md) — the paragraph can go,
 * > the reader's mark stays — and `comments_identity_fk` therefore needs an
 * > identity that writing the blocks does not mint.
 *
 * Every `comments.json` in `data/` happens to anchor to blocks that are still
 * there, so the seeder passed with the minting missing. It passed for a second
 * reason too, and it is the same one that has caught this repo out all week:
 * identities are never deleted, so every fixture's anchors already had one from
 * an earlier `db:import`. GPT Sol, 2026-08-28.
 *
 * So the fixture here is built with the awkward comment in it deliberately, on
 * a slug the database has never seen.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, blockIdentities, comments as commentsTable, jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { loadArticleIntoPg } from "./helpers/load-article.js";
import { FIXTURE_ROOT, requireFixture } from "./helpers/require-fixture.js";
import { seedCommentsFromFiles, seedShelfFromFiles } from "./helpers/seed-reader-state.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
/** The smallest complete article in the corpus; copied, never used in place. */
const FROM = "writes";
/**
 * The clone's **source** is the committed corpus; its **destination** is the
 * working `data/`.
 *
 * `FROM` used to be read out of `path.join(ROOT, "data", FROM)`, which is a
 * developer's own gitignored working copy — absent on a fresh clone, different
 * on every machine. docs/plans/260901b-committed-fixture-corpus.md.
 *
 * The destination stays on `ROOT` and is passed to `loadArticleIntoPg` as
 * `root`, because that now defaults to the corpus and the scratch article must
 * not be written into a tracked fixture directory.
 */
requireFixture(FROM, [
  "raw.json",
  "raw.html",
  "meta.json",
  "blocks.json",
  "tree.json",
  "labels.json",
  "output.html",
  "output.blocks.json",
]);

/** A block id that is not in `writes`'s text, and never was. */
const VANISHED = "spya-zzzzzz";

await pgReady({
  suite: "tests/helpers-seed-reader-state.test.ts",
  tables: ["spideryarn.revision_blocks"],
});

/**
 * **This file starts a job, so it takes the shared run lock.**
 *
 * This file's fixtures are named the same on every run, so a second copy — a
 * peer's `npm test` beside yours — collides with it on `jobs_active_slug` and
 * on the fixture rows themselves. Taken after `pgReady` and only
 * when reachable, because a suite that is about to skip must not sit holding it.
 * tests/helpers/run-lock.ts has the reasoning and the measurements.
 */
const runLock = await takeRunLock("tests/helpers-seed-reader-state.test.ts");
afterAll(async () => {
  await runLock?.release();
});

/** A copy of `writes` under `slug`, with `comments.json` replaced. */
async function makeFixture(slug: string, comments: unknown[]): Promise<void> {
  const dir = path.join(ROOT, "data", slug);
  await rm(dir, { recursive: true, force: true });
  await cp(path.join(FIXTURE_ROOT, "data", FROM), dir, { recursive: true });

  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const at = path.join(dir, name);
    const value: unknown = JSON.parse(await readFile(at, "utf8"));
    if (value && typeof value === "object" && (value as { slug?: string }).slug === FROM) {
      (value as { slug: string }).slug = slug;
      await writeFile(at, JSON.stringify(value, null, 2));
    }
  }
  /* `output/` is gitignored, so a fresh clone has no such directory and the
     copy would fail on it rather than on the file. */
  await mkdir(path.join(ROOT, "output"), { recursive: true });
  for (const ext of [".html", ".blocks.json"]) {
    await cp(
      path.join(FIXTURE_ROOT, "output", `${FROM}${ext}`),
      path.join(ROOT, "output", `${slug}${ext}`),
    );
  }
  await writeFile(path.join(dir, "comments.json"), JSON.stringify({ comments }, null, 2));
}

/** Files and rows, so the suite can be run twice. */
async function forget(slug: string): Promise<void> {
  await rm(path.join(ROOT, "data", slug), { recursive: true, force: true });
  for (const ext of [".html", ".blocks.json"]) {
    await rm(path.join(ROOT, "output", `${slug}${ext}`), { force: true });
  }
  const db = getDb();
  await db.delete(jobs).where(eq(jobs.slug, slug));
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.slug, slug));
  await db.delete(articles).where(eq(articles.slug, slug));
}

/** One comment, anchored wherever the caller says. */
function comment(id: string, blockId: string) {
  return {
    id,
    blockId,
    quote: "a passage that has since gone",
    start: 0,
    createdAt: "2026-08-26T00:00:00.000Z",
    status: "none",
  };
}

describe("the reader-state seeder", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("seeds a comment anchored to a block this revision does not have", async () => {
    const slug = "test-seed-vanished-anchor";
    await forget(slug);
    await makeFixture(slug, [comment("spya-cmtaaa", VANISHED)]);
    try {
      const loaded = await loadArticleIntoPg(slug, { root: ROOT });
      // A load that carried a previous revision forward would bring its
      // identities with it, and this test would prove nothing.
      expect(loaded.basedOn).toBeNull();

      const db = getDb();
      const [article] = await db
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.slug, slug));
      if (!article) throw new Error("the load created no article row");

      /* The precondition, asserted rather than assumed: writing the blocks
         minted identities for the blocks that are IN this revision, and this is
         not one of them. Without this line the test passes for an article whose
         text happens to contain the anchor, and the seeder's own minting is
         never exercised. */
      const before = await db
        .select({ blockId: blockIdentities.blockId })
        .from(blockIdentities)
        .where(and(eq(blockIdentities.articleId, article.id), eq(blockIdentities.blockId, VANISHED)));
      expect(before, `${VANISHED} is somehow already a block of this article`).toEqual([]);

      const seeded = await seedCommentsFromFiles(slug);
      expect(seeded).toEqual({ inserted: 1, unanchored: [] });

      const rows = await db
        .select({ id: commentsTable.id, blockId: commentsTable.blockId })
        .from(commentsTable)
        .where(eq(commentsTable.articleId, article.id));
      expect(rows).toEqual([{ id: "spya-cmtaaa", blockId: VANISHED }]);
    } finally {
      await forget(slug);
    }
  });

  it("replaces the comments rather than adding to them, and does not lose them on the way", async () => {
    /* The second half of the same finding. The seeder deletes before it
       inserts, so an insert that fails on the foreign key leaves the article
       with **no** comments — worse than the write not happening. Seeding twice
       is how that shows up: the first call sets them, and a broken second call
       would clear them and throw. */
    const slug = "test-seed-replaces";
    await forget(slug);
    await makeFixture(slug, [comment("spya-cmtaaa", VANISHED), comment("spya-cmtbbb", VANISHED)]);
    try {
      await loadArticleIntoPg(slug, { root: ROOT });
      const db = getDb();
      const [article] = await db
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.slug, slug));
      if (!article) throw new Error("the load created no article row");

      expect((await seedCommentsFromFiles(slug)).inserted).toBe(2);
      expect((await seedCommentsFromFiles(slug)).inserted).toBe(2);

      const rows = await db
        .select({ id: commentsTable.id })
        .from(commentsTable)
        .where(eq(commentsTable.articleId, article.id));
      expect(rows.map((r) => r.id).sort()).toEqual(["spya-cmtaaa", "spya-cmtbbb"]);
    } finally {
      await forget(slug);
    }
  });

  it("writes the shelf state the live store cannot express", async () => {
    /* `pgShelfStore.patch` archives with `now()` and cannot set `opens`. The
       corpus has an article opened 409 times; a seeder that quietly wrote `1`
       and today's date would leave every library comparison passing against
       state that is not the state on disk. */
    const slug = "test-seed-shelf";
    await forget(slug);
    await makeFixture(slug, []);
    await writeFile(
      path.join(ROOT, "data", slug, "shelf.json"),
      JSON.stringify(
        {
          archivedAt: "2019-07-04T09:30:00.000Z",
          opens: 874,
          lastOpenedAt: "2019-07-05T09:30:00.000Z",
          purpose: "because I keep arguing about it",
        },
        null,
        2,
      ),
    );
    try {
      await loadArticleIntoPg(slug, { root: ROOT });
      const written = await seedShelfFromFiles(slug);
      expect(written.opens).toBe(874);
      expect(written.archivedAt?.toISOString()).toBe("2019-07-04T09:30:00.000Z");
      expect(written.purpose).toBe("because I keep arguing about it");

      const db = getDb();
      const [row] = await db
        .select({
          opens: articles.opens,
          archivedAt: articles.archivedAt,
          lastOpenedAt: articles.lastOpenedAt,
          purpose: articles.purpose,
        })
        .from(articles)
        .where(eq(articles.slug, slug));
      expect(row?.opens).toBe(874);
      expect(row?.archivedAt?.toISOString()).toBe("2019-07-04T09:30:00.000Z");
      expect(row?.lastOpenedAt?.toISOString()).toBe("2019-07-05T09:30:00.000Z");
      expect(row?.purpose).toBe("because I keep arguing about it");
    } finally {
      await forget(slug);
    }
  });

  it("refuses to seed an article that has not been loaded", async () => {
    /* Reader state hangs off an article row, and seeding before loading is the
       ordinary mistake. Without the check it is an update that matches nothing
       — a silent no-op, which is the failure this repo keeps meeting
       (docs/reusable/silent-success.md). */
    await expect(seedShelfFromFiles("test-seed-never-loaded")).rejects.toThrow(
      /seed reader state AFTER loadArticleIntoPg/,
    );
  });
});
