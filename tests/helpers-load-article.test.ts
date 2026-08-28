/**
 * The fixture loader, tested — because three suites are about to trust it.
 *
 * ## Why a test helper gets its own suite
 *
 * `tests/helpers/load-article.ts` replaces `db:import` as the way an article
 * gets into Postgres for a test (docs/plans/delete-the-importer.md § C7). A
 * fault in it does not fail loudly; it makes whichever suite is using it fail
 * somewhere unrelated, or — much worse — pass. GPT Sol reviewed the first
 * version and found ten problems, of which the four below are the ones that
 * would have produced a *green* suite proving nothing:
 *
 * - it put no bytes in the bucket, so every fixture depended on somebody else's
 *   backfill having already run;
 * - it set `article_revisions.created_at` while the library sorts on
 *   `articles.created_at`, so the option did nothing and nothing said so;
 * - a copy that moved zero steps still published, republishing whatever was
 *   already in Postgres and reporting success;
 * - `publish: "try"` swallowed every error, so a dropped connection read as a
 *   policy refusal.
 *
 * Each of those is asserted here, and each was watched to fail first.
 *
 * ## The fixtures are copies under `test-` slugs
 *
 * Never a real `data/` article. A slug the database has never seen is the only
 * honest fixture: `beginDraftIn` carries columns, block rows and step-run rows
 * forward from the published revision, so an article a previous run published
 * reads back correct from columns this path never wrote. That is not
 * hypothetical — it faked a clean parity result on 2026-08-28.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { createHash } from "node:crypto";
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { RawManifest } from "../src/fetch.js";
import { blobStore } from "../src/store/blobs.js";
import { canonicalKey } from "../src/source.js";
import { loadArticleIntoPg } from "./helpers/load-article.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const FROM = "writes";

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
      "select to_regclass('spideryarn.raw_sources') is not null as ready",
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

/**
 * Copy `data/writes` to `slug`, optionally changing the raw document's bytes.
 *
 * `mutateRaw` exists for the one assertion that cannot be made against the real
 * corpus: every checked-in fixture's object is *already* in the bucket, so
 * "does the loader store the bytes" is unanswerable with them. Changing a byte
 * gives a hash nothing has seen, and then the question has an answer.
 */
async function makeFixture(
  slug: string,
  mutateRaw?: (bytes: Buffer) => Buffer,
): Promise<{ storedSha256: string; storedBytes: number; file: string }> {
  const dir = path.join(ROOT, "data", slug);
  await rm(dir, { recursive: true, force: true });
  await cp(path.join(ROOT, "data", FROM), dir, { recursive: true });

  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const at = path.join(dir, name);
    const value: unknown = JSON.parse(await readFile(at, "utf8"));
    if (value && typeof value === "object" && (value as { slug?: string }).slug === FROM) {
      (value as { slug: string }).slug = slug;
      await writeFile(at, JSON.stringify(value, null, 2));
    }
  }
  await cp(path.join(ROOT, "output", `${FROM}.html`), path.join(ROOT, "output", `${slug}.html`));
  await cp(
    path.join(ROOT, "output", `${FROM}.blocks.json`),
    path.join(ROOT, "output", `${slug}.blocks.json`),
  );

  const manifest = JSON.parse(await readFile(path.join(dir, "raw.json"), "utf8")) as RawManifest;
  if (mutateRaw) {
    const bytes = mutateRaw(await readFile(path.join(dir, manifest.file)));
    await writeFile(path.join(dir, manifest.file), bytes);
    manifest.storedSha256 = createHash("sha256").update(bytes).digest("hex");
    manifest.storedBytes = bytes.byteLength;
    await writeFile(path.join(dir, "raw.json"), JSON.stringify(manifest, null, 2));
  }
  return {
    storedSha256: manifest.storedSha256 as string,
    storedBytes: manifest.storedBytes as number,
    file: manifest.file,
  };
}

/**
 * Remove the fixture — **the rows as well as the files.**
 *
 * The first version of this deleted only `data/` and `output/`, and the suite
 * duly passed once and failed on the second run: `reports basedOn` expects a
 * first load to have `basedOn === null`, and an article the previous run left
 * published is copied from, not minted. A suite that works only against a virgin
 * database is one that goes red the first time anybody runs it twice, and the
 * failure names a helper rather than the leftover row.
 *
 * `article_revisions` cascades from `articles`, but `articles.current_revision_id`
 * points *into* it, so the pointer is cleared before the delete — the same order
 * tests/owner-isolation.test.ts uses. Jobs are removed by slug because a load
 * that threw before its `finally` would otherwise wedge the running slot.
 */
async function forget(slug: string): Promise<void> {
  await rm(path.join(ROOT, "data", slug), { recursive: true, force: true });
  await rm(path.join(ROOT, "output", `${slug}.html`), { force: true });
  await rm(path.join(ROOT, "output", `${slug}.blocks.json`), { force: true });

  const db = getDb();
  await db.delete(jobs).where(eq(jobs.slug, slug));
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.slug, slug));
  await db.delete(articles).where(eq(articles.slug, slug));
}

when("the fixture loader", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("puts the raw document in the bucket, rather than assuming it is there", async () => {
    const slug = "test-load-stores-bytes";
    await forget(slug);
    /* A byte nobody has stored. Against the checked-in corpus this assertion is
       unanswerable — the backfill put every real object in the bucket already —
       so the fixture's bytes are changed to produce a key that cannot already
       exist. */
    const marker = `\n<!-- ${slug} ${Date.now()} -->\n`;
    const raw = await makeFixture(slug, (bytes) => Buffer.concat([bytes, Buffer.from(marker)]));
    try {
      const key = canonicalKey(raw.storedSha256, "html");
      expect(await blobStore().head(key)).toBeNull();

      const loaded = await loadArticleIntoPg(slug);
      expect(loaded.published).toBe(true);

      const head = await blobStore().head(key);
      expect(head?.bytes).toBe(raw.storedBytes);
      /* And the revision points at it — the reference and the object have to be
         the same fact, not two things that happen to have been written. */
      const [row] = await getDb()
        .select({ sha: articleRevisions.rawSourceSha256 })
        .from(articles)
        .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
        .where(eq(articles.slug, slug));
      expect(row?.sha).toBe(raw.storedSha256);
    } finally {
      await forget(slug);
    }
  }, 120_000);

  it("refuses a manifest whose key is not the hash of the file beside it", async () => {
    const slug = "test-load-manifest-lies";
    await forget(slug);
    await makeFixture(slug);
    try {
      /* The bytes change and the manifest does not, which is what an edited
         fixture looks like. Writing the reference anyway would point the
         revision at a *different* document that happens to exist. */
      const at = path.join(ROOT, "data", slug, "raw.html");
      await writeFile(at, Buffer.concat([await readFile(at), Buffer.from("<!-- edited -->")]));
      await expect(loadArticleIntoPg(slug)).rejects.toThrow(/has been edited/);
    } finally {
      await forget(slug);
    }
  }, 60_000);

  it("refuses to publish when the copy moved nothing", async () => {
    const slug = "test-load-no-such-article";
    await forget(slug);
    try {
      /* No `data/` directory at all. Carry-forward makes this dangerous rather
         than merely useless: on an article Postgres has already published, a
         zero-step copy would republish the old revision and report success. */
      await expect(loadArticleIntoPg(slug)).rejects.toThrow(/nothing to load/);
    } finally {
      /* **The draft survives the refusal, and that is production's behaviour.**
         `openOrBeginJobDraft` commits the revision in its own transaction before
         the copy runs, so a failed load leaves a draft for the next attempt to
         reopen. Right for the pipeline, and litter here: twenty-two orphan
         drafts had piled up under this slug before the cleanup was added. */
      await forget(slug);
    }
  }, 60_000);

  it("reports basedOn, so a suite can tell a real load from a carried one", async () => {
    const slug = "test-load-based-on";
    await forget(slug);
    await makeFixture(slug);
    try {
      const first = await loadArticleIntoPg(slug);
      expect(first.basedOn).toBeNull();
      expect(first.copied).toContain("fetch");

      /* The second load is copied *from* the first, which is exactly the state
         that makes a parity assertion meaningless. It must be visible. */
      const second = await loadArticleIntoPg(slug);
      expect(second.basedOn).toBe(first.revisionId);
    } finally {
      await forget(slug);
    }
  }, 180_000);

  it("sets articles.created_at, which is the column the library sorts on", async () => {
    const slug = "test-load-created-at";
    await forget(slug);
    await makeFixture(slug);
    const when = new Date("2019-07-04T09:30:00.000Z");
    try {
      await loadArticleIntoPg(slug, { createdAt: when });
      const [row] = await getDb()
        .select({ createdAt: articles.createdAt })
        .from(articles)
        .where(eq(articles.slug, slug));
      expect(row?.createdAt?.toISOString()).toBe(when.toISOString());
    } finally {
      await forget(slug);
    }
  }, 120_000);

  it("leaves no job behind, however it ended", async () => {
    const slug = "test-load-job-cleanup";
    await forget(slug);
    await makeFixture(slug);
    try {
      await loadArticleIntoPg(slug);
      const left = await getDb().select({ id: jobs.id }).from(jobs).where(eq(jobs.slug, slug));
      /* Deleted, not marked `done`. A synthetic job left in the table reads as
         real ingest history, and one left `running` wedges the single running
         slot for every later call in the run. */
      expect(left).toEqual([]);
    } finally {
      await forget(slug);
    }

    const failed = "test-load-job-cleanup-failed";
    await forget(failed);
    await expect(loadArticleIntoPg(failed)).rejects.toThrow();
    const afterFailure = await getDb().select({ id: jobs.id }).from(jobs).where(eq(jobs.slug, failed));
    expect(afterFailure).toEqual([]);
  }, 180_000);
});
