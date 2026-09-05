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
 * 3. The job settles, and `publishRevisionIn` (src/store/pg-revisions.ts)
 *    resolves the slug through `ownedSlug`, so it lands on the **article that
 *    was already there**.
 * 4. Same owner ⇒ the lock finds that row, and its current revision is moved to
 *    the document just fetched. Every write reports success.
 *
 * Steps 3–4 were `importArticle` until src/store/import.ts was deleted on
 * 2026-09-01, and it was worse: it derived `articleId` from the slug and then
 * deleted and reinserted the article's reader state as well — comments, chat
 * threads, saved searches, glossary lookups.
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
 * ## The upload, which is the case a URL-shaped `articleExists` would lose
 *
 * An uploaded article has **no address**: `article_revisions.final_url` is null,
 * and `urlForSlug` therefore answers `undefined` for a slug that very much
 * exists. Those two answers disagreeing is the whole point of the left join in
 * `ownedArticle` (src/pipeline.ts) — and nothing pinned it here until
 * 2026-09-05, because the claim lived in `tests/pipeline-slug-claim-files.test.ts`
 * and that file went with the store flag in the hinge. A regression deriving
 * `articleExists` from URL presence would have passed everything that was left
 * and treated **every upload as an article nobody owns**, which is step 1 of the
 * sequence at the top of this header. GPT Sol's review of stage F.
 *
 * The files-store half of the pair was `tests/pipeline-slug-claim-files.test.ts`,
 * a separate file because `STORE` was read once at module load; both it and the
 * store it named are gone.
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

/** The uploaded article: a slug and a published revision with **no address**. */
const UPLOAD_SLUG = "test-pipeline-slug-claim-upload";
const UPLOAD_ARTICLE_ID = "00000000-0000-4000-8000-0000000000e9";
const UPLOAD_REVISION_ID = "00000000-0000-4000-8000-0000000000f5";

await pgReady({
  suite: "tests/pipeline-slug-claim.test.ts",
  columns: [{ table: "spideryarn.articles", column: "owner_id" }],
});

describe("a slug that exists only in Postgres", { timeout: 20_000 }, () => {
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

    /* **The upload: published, and with neither URL column set.** `requestedUrl`
       is left out as well as `finalUrl`, because a PDF off somebody's disk was
       never asked for by address either. This is the row shape `acquireUpload`
       leaves behind. */
    await db
      .insert(articles)
      .values({ id: UPLOAD_ARTICLE_ID, ownerId: currentOwnerId(), slug: UPLOAD_SLUG });
    await db.insert(articleRevisions).values({
      id: UPLOAD_REVISION_ID,
      articleId: UPLOAD_ARTICLE_ID,
      status: "published",
      title: "A paper that came off somebody's disk",
      fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await db
      .update(articles)
      .set({ currentRevisionId: UPLOAD_REVISION_ID })
      .where(eq(articles.id, UPLOAD_ARTICLE_ID));
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

  /** The URL `enqueue` puts on a late step's job when the request carries none. */
  it("gives its source URL to urlForSlug", async () => {
    const { urlForSlug } = await import("../src/pipeline.js");
    expect(await urlForSlug(SLUG)).toBe(URL);
  });

  /**
   * **The two answers must disagree, and that is the assertion.**
   *
   * An upload exists and has no address. Asserted as a pair, in one case, because
   * separately either half is satisfied by the wrong implementation: a
   * URL-derived `articleExists` passes *"urlForSlug is undefined"* happily and
   * fails only on the line above it, and only if somebody thought to write it.
   *
   * **Watched red on 2026-09-05** by making `articleExists` derive its answer
   * from the URL — `return (await ownedArticle(slug))?.url != null` — which is
   * exactly the regression this exists to catch, and which every other case in
   * this file survives.
   */
  it("finds an uploaded article that has no URL at all", async () => {
    const { articleExists, urlForSlug } = await import("../src/pipeline.js");
    expect(await articleExists(UPLOAD_SLUG)).toBe(true);
    expect(await urlForSlug(UPLOAD_SLUG)).toBeUndefined();
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
  for (const id of [ARTICLE_ID, UPLOAD_ARTICLE_ID]) {
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
    await db.delete(articleRevisions).where(eq(articleRevisions.articleId, id));
    await db.delete(articles).where(eq(articles.id, id));
  }
}
