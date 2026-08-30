/**
 * The CLI importer must not walk over a job that is still working.
 *
 * `importArticle` replaces the base revision and every piece of reader state
 * anchored to the article; `pruneOrphans` deletes the article outright. Both are
 * safe when nothing else is touching that slug, and neither asked. A queued or
 * running job for the same owner and slug owns a draft revision and is about to
 * write to it, so an import underneath it swaps the base out from under work in
 * flight, and a `--prune` cascade takes the article the job is building.
 *
 * GPT Sol raised it against the D1b design, 2026-08-29:
 *
 * > both operations should lock the article, then refuse any queued/running job
 * > for that owner and slug before changing revisions or reader state.
 *
 * The order in that sentence is the whole guard. Checking the jobs table first
 * and locking afterwards leaves the window the check exists to close — a job can
 * be enqueued in the gap — so the lock has to come first, and both have to be in
 * the transaction that does the writing.
 *
 * The two ends behave differently on purpose. `importArticle` is handed one
 * slug, so refusing is the only answer it can give: it throws. `pruneOrphans`
 * is handed a list, and one busy article must not stop the other nine from
 * being removed, so it skips that one and says so — the same shape as the
 * directory-came-back check just above it.
 *
 * Skips loudly when there is no database — see tests/helpers/pg-ready.ts.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articles, jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { mintAttempt } from "../src/store/jobs.js";
import { findOrphans, importArticle, pruneOrphans } from "../src/store/import.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";
import type { JobStep } from "../src/types.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");

/** The article the jobs in this file are about. */
const SLUG = "_test-import-active-job";
/** A second one, so "skipped the busy orphan" is distinguishable from "did nothing". */
const OTHER = "_test-import-active-job-other";
const SLUGS = [SLUG, OTHER];

/**
 * A second real `auth.users` row, because `jobs.owner_id` is a foreign key onto
 * it — an invented uuid would fail on the constraint rather than on the guard,
 * which would pass the "different owner" case for the wrong reason.
 */
const OTHER_OWNER = ADMIN_USER_ID_LOCAL;

const STEPS: JobStep[] = [{ name: "fetch", label: "Fetching the page", status: "pending" }];

const { reachable } = await pgReady({
  suite: "tests/store-import-active-job.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs"],
});

const when = reachable ? describe : describe.skip;

/**
 * **This file starts a job, so it takes the shared run lock.**
 *
 * `jobs_only_one_running` allows one `running` row in the whole table, and this
 * file's fixtures are named the same on every run, so a second copy — a peer's
 * `npm test` beside yours — collides on both. Taken after `pgReady` and only
 * when reachable, because a suite that is about to skip must not sit holding it.
 * tests/helpers/run-lock.ts has the reasoning and the measurements.
 */
const runLock = reachable ? await takeRunLock("tests/store-import-active-job.test.ts") : undefined;
afterAll(async () => {
  await runLock?.release();
});

/* --------------------------------------------------------------- fixtures -- */

/** Ids this file inserted, so teardown never touches a job it did not make. */
const made: string[] = [];

function dirFor(slug: string): string {
  return path.join(ROOT, "data", slug);
}

/** The smallest directory `importArticle` will accept: blocks, tree, meta. */
async function writeFixture(slug: string): Promise<void> {
  const dir = dirFor(slug);
  await mkdir(dir, { recursive: true });
  const blockId = "spya-aj0022";
  const write = (name: string, value: unknown) =>
    writeFile(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await write("meta.json", { slug, title: "A fixture", fetchedAt: "2026-08-01T00:00:00Z" });
  await write("blocks.json", {
    blocks: [
      {
        id: blockId,
        tag: "p",
        kind: "text",
        text: "a paragraph",
        words: 2,
        html: `<p id="${blockId}">a paragraph</p>`,
        gistable: true,
      },
    ],
  });
  await write("tree.json", {
    version: "toc/1",
    generator: "fixture",
    slug,
    rootId: "n0001",
    nodes: {
      n0001: {
        id: "n0001",
        depth: 0,
        parent: null,
        children: [],
        range: [blockId, blockId],
        title: "A fixture",
        gist: "A fixture article that exists only for this test.",
      },
    },
  });
}

async function queuedJob(slug: string, owner: string = DEV_OWNER_ID): Promise<string> {
  const id = mintId();
  await getDb()
    .insert(jobs)
    .values({ id, ownerId: owner, slug, steps: STEPS, status: "queued", workKey: `wk-${id}` });
  made.push(id);
  return id;
}

/**
 * A claimed job, the way `advanceJob` leaves one while a step runs.
 *
 * Through `insertWhenSlotFree` because `jobs_only_one_running` is unique on the
 * constant `(true)` — one running row in the whole table — so a neighbouring
 * suite or a real ingest on this laptop is a claimant as legitimate as we are.
 */
async function runningJob(slug: string): Promise<string> {
  return await insertWhenSlotFree(slug, async () => {
    const id = mintId();
    await getDb()
      .insert(jobs)
      .values({
        id,
        ownerId: DEV_OWNER_ID,
        slug,
        steps: STEPS,
        status: "running",
        attemptId: mintAttempt(),
        leaseExpiresAt: new Date(Date.now() + 600_000),
        workKey: `wk-${id}`,
      });
    made.push(id);
    return id;
  });
}

/** Retire a job so the next case is not refused by `jobs_active_slug`. */
async function finish(id: string, status: "done" | "error"): Promise<void> {
  await getDb()
    .update(jobs)
    .set({ status, attemptId: null, leaseExpiresAt: null, finishedAt: new Date() })
    .where(eq(jobs.id, id));
}

async function clearJobs(): Promise<void> {
  if (made.length) await getDb().delete(jobs).where(inArray(jobs.id, made));
  made.length = 0;
}

/** Only our own rows, by slug: a real article in this database is not ours. */
async function clearArticles(): Promise<void> {
  const db = getDb();
  const rows = await db.select({ id: articles.id }).from(articles).where(inArray(articles.slug, SLUGS));
  for (const row of rows) {
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, row.id));
    await db.delete(articles).where(eq(articles.id, row.id));
  }
}

when("importing over a job that is still working", () => {
  beforeAll(async () => {
    await getDb().delete(jobs).where(inArray(jobs.slug, SLUGS));
    await clearArticles();
    for (const slug of SLUGS) await writeFixture(slug);
  }, 30_000);

  afterAll(async () => {
    await clearJobs();
    await getDb().delete(jobs).where(inArray(jobs.slug, SLUGS));
    await clearArticles();
    await closeDb();
    for (const slug of SLUGS) await rm(dirFor(slug), { recursive: true, force: true });
  });

  /* Retired in a `finally`, always. `jobs_active_slug` allows one active row per
     (owner, slug), so a case that leaves its job behind on a failed assertion
     takes down every case after it with a duplicate-key error naming the wrong
     test — which is what the first run of this file did. */
  it("refuses while a queued job holds that slug", async () => {
    const id = await queuedJob(SLUG);
    try {
      await expect(importArticle(SLUG)).rejects.toThrow(/queued or running job/);
    } finally {
      await finish(id, "done");
    }
  }, 30_000);

  it("refuses while a running job holds that slug", async () => {
    const id = await runningJob(SLUG);
    try {
      await expect(importArticle(SLUG)).rejects.toThrow(/queued or running job/);
    } finally {
      await finish(id, "done");
    }
  }, 30_000);

  it("imports when the active job is somebody else's", async () => {
    /* The guard is per owner, like every other query from a slug to an article.
       A second reader's ingest of the same slug must not stop this owner
       importing their own copy — and `jobs_active_slug` is on (owner, slug), so
       this row is as legitimate as ours. */
    const id = await queuedJob(SLUG, OTHER_OWNER);
    try {
      const result = await importArticle(SLUG);
      expect(result.slug).toBe(SLUG);
    } finally {
      await finish(id, "done");
    }
  }, 30_000);

  it("imports when every job for that slug has finished", async () => {
    /* Both terminal statuses, because "not active" has to mean the whole of the
       complement and not just the one the fix happened to be written against. */
    await finish(await queuedJob(SLUG), "done");
    await finish(await queuedJob(SLUG), "error");
    const result = await importArticle(SLUG);
    expect(result.slug).toBe(SLUG);
  }, 30_000);

  it("skips the busy orphan and prunes the rest of the list", async () => {
    /* Last, because it deletes the article rows the cases above rely on.

       Two orphans and one job: a run that aborted on the busy one would leave
       both rows behind, and a run that ignored the job would delete both. Only
       skipping shows up as exactly one of them going. */
    await importArticle(SLUG);
    await importArticle(OTHER);
    for (const slug of SLUGS) await rm(dirFor(slug), { recursive: true, force: true });
    await queuedJob(SLUG);

    const orphans = (await findOrphans()).filter((o) => SLUGS.includes(o.slug));
    expect(orphans.map((o) => o.slug).sort(), "the scan should have named both").toEqual(
      [...SLUGS].sort(),
    );

    const removed = await pruneOrphans(orphans);
    expect(removed.map((o) => o.slug)).toEqual([OTHER]);

    const left = await getDb()
      .select({ slug: articles.slug })
      .from(articles)
      .where(inArray(articles.slug, SLUGS));
    expect(left.map((r) => r.slug)).toEqual([SLUG]);
  }, 60_000);
});
