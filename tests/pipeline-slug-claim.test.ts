/**
 * **Who already owns this slug — asked of the store that actually holds the
 * articles.**
 *
 * `articleExists` and `urlForSlug` (src/pipeline.ts) answered by reading
 * `data/<slug>/meta.json`, catching every error and returning "nothing here".
 * On Vercel `data/` is empty on every fresh invocation, so both said **no
 * article exists, for every slug**, and the consequence is not a wasted fetch:
 *
 * 1. `freeSlug` (src/jobs.ts) believes the slug is unclaimed and hands it out.
 * 2. The pipeline runs, and is paid for.
 * 3. `importArticle` derives `articleId = derivedUuid("article", slug)`, which
 *    resolves to the **article that was already there**.
 * 4. Same owner ⇒ the owner check passes, and the import replaces that article
 *    and deletes-then-reinserts its reader state — comments, chat threads,
 *    saved searches, glossary lookups. Every write reports success.
 *
 * That is silent data loss, and this file is the test for it: with the Postgres
 * store live and **no `data/<slug>/` directory anywhere**, both functions must
 * still find the article. The temp `SPIDERYARN_DATA_ROOT` below is what makes
 * that claim honest — without it a passing test could be reading a real
 * directory in the repository and proving nothing.
 *
 * ## The owner-scoped half
 *
 * Both reads are the *current owner's* articles only, deliberately, and the
 * last two tests here pin that. A global `urlForSlug` would hand the caller
 * **another owner's source URL** while resolving a collision. See the comment
 * on `articleExists` in src/pipeline.ts for what that leaves open.
 *
 * The files-store half of the same pair is tests/pipeline-slug-claim-files.test.ts,
 * and it has to be a separate file: `STORE` is read once at module load
 * (src/store/live.ts), so one module cannot see both stores.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * **Postgres, and set before anything imports src/pipeline.ts.**
 *
 * `STORE` is a module-load constant, so a `beforeAll` here would be read after
 * the branch it is meant to choose. Every import of the code under test below
 * is therefore dynamic.
 */
process.env.SPIDERYARN_STORE = "postgres";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId, type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/** Owns nothing at all, which is the strongest form of "not yours". */
const OUTSIDER = "00000000-0000-4000-8000-0000000000b3" as OwnerId;

const SLUG = "test-pipeline-slug-claim";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000e7";
const REVISION_ID = "00000000-0000-4000-8000-0000000000e8";
const URL = "https://example.test/pipeline-slug-claim";

const { reachable } = await pgReady({
  suite: "tests/pipeline-slug-claim.test.ts",
  columns: [{ table: "spideryarn.articles", column: "owner_id" }],
});

const when = reachable ? describe : describe.skip;

when("a slug that exists only in Postgres", { timeout: 20_000 }, () => {
  let scratch = "";
  let before: string | undefined;

  beforeAll(async () => {
    /* An empty tree, so `data/<slug>/` cannot exist for any slug. If these
       tests pass, they passed because Postgres answered. */
    scratch = await mkdtemp(path.join(tmpdir(), "spya-slug-claim-"));
    before = process.env.SPIDERYARN_DATA_ROOT;
    process.env.SPIDERYARN_DATA_ROOT = scratch;

    await clean();
    const db = getDb();
    await db.insert(articles).values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG });
    await db.insert(articleRevisions).values({
      id: REVISION_ID,
      articleId: ARTICLE_ID,
      status: "published",
      title: "An article the filesystem has never heard of",
      requestedUrl: URL,
      finalUrl: URL,
      fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await db
      .update(articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(articles.id, ARTICLE_ID));
  });

  afterAll(async () => {
    await clean();
    await closeDb();
    if (before === undefined) delete process.env.SPIDERYARN_DATA_ROOT;
    else process.env.SPIDERYARN_DATA_ROOT = before;
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  /**
   * The control for every assertion below: if this directory existed, a green
   * `articleExists` would tell us nothing about which store answered.
   */
  it("really has no directory on disk", async () => {
    await expect(stat(path.join(scratch, "data", SLUG))).rejects.toMatchObject({ code: "ENOENT" });
  });

  /** **The production condition.** Red before this change, on every slug. */
  it("is found by articleExists", async () => {
    const { articleExists } = await import("../src/pipeline.js");
    expect(await articleExists(SLUG)).toBe(true);
  });

  /** And this is the one `freeSlug` asks, through `onShelfOrInFlight`. */
  it("gives its source URL to urlForSlug", async () => {
    const { urlForSlug } = await import("../src/pipeline.js");
    expect(await urlForSlug(SLUG)).toBe(URL);
  });

  /** A slug nobody has, so "true" cannot be the answer to everything. */
  it("but an unknown slug is still absent", async () => {
    const { articleExists, urlForSlug } = await import("../src/pipeline.js");
    expect(await articleExists("test-pipeline-slug-claim-nobody-has-this")).toBe(false);
    expect(await urlForSlug("test-pipeline-slug-claim-nobody-has-this")).toBeUndefined();
  });

  /**
   * **Owner-scoped, and this is the test that pins it.**
   *
   * A stranger must not learn that the slug is taken, and above all must not be
   * handed the URL of the article that took it. Anyone widening these reads to
   * a global lookup has to come through here.
   */
  it("is not another owner's article", async () => {
    const { articleExists } = await import("../src/pipeline.js");
    const theirs = await runInRequest(async () => {
      setRequestOwner(OUTSIDER);
      return articleExists(SLUG);
    });
    expect(theirs).toBe(false);
  });

  it("and does not give another owner its URL", async () => {
    const { urlForSlug } = await import("../src/pipeline.js");
    const theirs = await runInRequest(async () => {
      setRequestOwner(OUTSIDER);
      return urlForSlug(SLUG);
    });
    expect(theirs).toBeUndefined();
  });
});

async function clean() {
  const db = getDb();
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, ARTICLE_ID));
  await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
}
