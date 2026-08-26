/**
 * An article whose `data/` directory has gone must be able to leave Postgres too.
 *
 * `npm run db:import` adds and updates and has never removed: `importArticle`
 * reconciles only the slug it is handed, and nothing visits a slug that is no
 * longer there. So a deleted article went on being listed and served, and one
 * of them — `labels-checkpoint-check`, left behind by somebody's checkpoint run
 * — is the confirmed cause of the parity suite failing in full runs and passing
 * alone for an afternoon (tests/store-parity.test.ts says so at length).
 *
 * ## Why the rule is a pure function
 *
 * Pruning deletes an article and everything under it, including the reader's
 * questions. The dangerous version of this is not "it prunes too little", it is
 * "`data/` was momentarily unreadable and it pruned everything" — so the
 * decision is `orphanSlugs()`, which takes two lists and returns a third, and
 * can be tested with no database and no filesystem at all. The database half
 * below then proves the second, independent check: a candidate is only really
 * gone if `stat` on its directory says ENOENT.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts. The
 * pure tests do not skip, because they need nothing.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, comments as commentsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { findOrphans, importArticle, orphanSlugs, pruneOrphans } from "../src/store/import.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "_test-import-prune";
const DIR = path.join(ROOT, "data", SLUG);
const BLOCK_ID = "spya-prn222";
const COMMENT_ID = "spya-prn333";

describe("deciding what counts as gone", () => {
  it("names a slug the database has and the disk does not", () => {
    expect(orphanSlugs(["kept", "vanished"], ["kept"])).toEqual(["vanished"]);
  });

  it("refuses to prune when the disk looks empty", () => {
    /* An empty `data/` is far more likely a wrong working directory, an
       unmounted volume or a half-finished checkout than every article having
       been deleted — and the difference is unrecoverable. Loud, not quiet:
       returning `[]` here would be safe today and would silently stop pruning
       for ever the day the scan breaks. */
    expect(() => orphanSlugs(["kept"], [])).toThrow(/refusing to prune/);
  });

  it("says nothing when the database is empty, even with an empty disk", () => {
    // Nothing to lose, so nothing to refuse. This is the ordinary state of a
    // fresh machine and it must not be an error.
    expect(orphanSlugs([], [])).toEqual([]);
  });
});

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
    const probe = await pool.query("select to_regclass('spideryarn.articles') is not null as ready");
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

when("pruning an article whose directory has gone", () => {
  let articleId = "";

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
    /* A comment, so the count the CLI prints before deleting is proved to be a
       real count rather than a zero nobody would notice was wrong. */
    await write("comments.json", {
      comments: [
        {
          id: COMMENT_ID,
          blockId: BLOCK_ID,
          quote: "a paragraph",
          start: 0,
          createdAt: "2026-08-01T00:00:00.000Z",
          status: "done",
          answer: "an answer",
        },
      ],
    });
    const result = await importArticle(SLUG);
    articleId = result.articleId;
  }, 30_000);

  afterAll(async () => {
    const db = getDb();
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));
    const id = rows[0]?.id;
    if (id) {
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
      await db.delete(articles).where(eq(articles.id, id));
    }
    await closeDb();
    await rm(DIR, { recursive: true, force: true });
  });

  it("does not call an article an orphan while its directory is there", async () => {
    /* `importableSlugs` skips `_`-prefixed directories, so this fixture is a
       CANDIDATE on the first check and must be saved by the second — which is
       exactly the property the two checks exist for. An article half-written by
       a pipeline that is still running looks the same way. */
    const orphans = await findOrphans();
    expect(orphans.map((o) => o.slug)).not.toContain(SLUG);
  }, 30_000);

  it("does not call it an orphan when only its artefacts have gone", async () => {
    /* The directory is there and `blocks.json` is not. That is a re-extraction
       part-way through, or a stage that failed, and it is emphatically not
       "the reader deleted this article". */
    await rm(path.join(DIR, "blocks.json"), { force: true });
    const orphans = await findOrphans();
    expect(orphans.map((o) => o.slug)).not.toContain(SLUG);
  }, 30_000);

  it("finds it, counts what it holds, and removes it once the directory is gone", async () => {
    await rm(DIR, { recursive: true, force: true });

    const orphans = await findOrphans();
    const mine = orphans.find((o) => o.slug === SLUG);
    expect(mine).toBeDefined();
    expect(mine?.articleId).toBe(articleId);
    // The count is what a person reads before agreeing to lose it.
    expect(mine?.comments).toBe(1);

    /* Only ours. `findOrphans` may legitimately name a real orphan sitting in
       this developer's database, and a test is not the place to delete it. */
    const removed = await pruneOrphans([mine!]);
    expect(removed.map((o) => o.slug)).toEqual([SLUG]);

    const db = getDb();
    const left = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));
    expect(left).toEqual([]);
    // The cascade really ran; the row did not simply lose its pointer.
    const orphanedComments = await db
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(eq(commentsTable.articleId, articleId));
    expect(orphanedComments).toEqual([]);
  }, 30_000);
});
