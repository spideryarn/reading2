/**
 * **An article remembers the address it was asked for, and is told it once** —
 * `articles.asked_url`, written through the real `claimSession`.
 *
 * The column is what lets a short link that ended on a paper find that paper's
 * article on a second paste (tests/find-article.test.ts has the lookup). This
 * file is the other half: that the address actually reaches the row, and that
 * nothing afterwards changes it. Plan
 * docs/plans/261006i-an-article-is-found-by-the-address-it-was-asked-for-and-a-redirect-that-ends-on-a-paper-source-imports-the-paper.md.
 *
 * ## Through `claimSession`, not by calling the writer
 *
 * The line that writes it is `lockOrCreateArticle` (src/store/pg-revisions.ts),
 * and the address is three calls above it, on the job:
 *
 *   claimSession → openPgStoreSession → openOrBeginJobDraft → lockOrCreateArticle
 *
 * A test that handed the writer an address would pass with any of those three
 * hand-offs missing, which is the state production would then be in. So every
 * case here queues a job, claims it, and opens the session production opens.
 * GPT Sol's K5 on the plan.
 *
 * ## Real and fake
 *
 * **Real:** the job store, the claim, `claimSession`, the draft it opens, and
 * the `articles` row read straight back. **Not run:** any step. Opening the
 * session is what creates or finds the article, so nothing has to be fetched or
 * paid for, and each case deletes its claimed, unfinished job as soon as the
 * session has opened.
 *
 * It claims jobs on a shared database, so it takes the run lock
 * (tests/helpers/run-lock.ts).
 */
import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs as jobsTable, uploads } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { claimSession } from "../src/jobs.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import { mintAttempt } from "../src/store/jobs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { Job, JobStep, JobUpload, StepName } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";

loadEnvLocal();

await pgReady({
  suite: "tests/asked-url-claim-session.test.ts",
  tables: ["spideryarn.jobs", "spideryarn.article_revisions"],
  columns: [{ table: "spideryarn.articles", column: "asked_url" }],
});

const runLock = await takeRunLock("tests/asked-url-claim-session.test.ts");
afterAll(async () => {
  await runLock?.release();
});

/** A slug per case, so no case waits in another's line of jobs. */
const SLUGS = {
  born: "asked-url-born-from-a-url-job",
  upload: "asked-url-born-from-an-upload",
  published: "asked-url-published-keeps-its-own",
  publishedNull: "asked-url-published-before-the-column",
  retried: "asked-url-unpublished-row-retried",
  retriedTwice: "asked-url-unpublished-row-already-told",
} as const;

const SHORT_LINK = "https://bit.ly/s1AskedUrlShortLink";
const ANOTHER_LINK = "https://doi.org/10.9999/s1-asked-url-another";
const PAPER = "https://arxiv.org/html/9912.98881";

const UPLOAD_ID = randomUUID();

const db = () => getDb();

/* ----------------------------------------------------------------- the job -- */

/**
 * A `queued` job straight into the Postgres store, the way
 * tests/claim-session-postgres.test.ts does it and for its reason: `enqueue`
 * starts the local pump, which would claim the job before this file could.
 */
async function queueJob(slug: string, origin: { url: string } | { upload: JobUpload }): Promise<Job> {
  const names: StepName[] = ["extract", "blocks", "structure"];
  const wanted: Job = {
    id: mintId(),
    ownerId: DEV_OWNER_ID,
    slug,
    ...origin,
    steps: names.map((name): JobStep => ({ name, label: STEPS[name].label, status: "pending" })),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await pgJobStore.enqueueOrGet(wanted, {
    workKey: `asked-url-${wanted.id}`,
    reservesName: false,
  });
  return job;
}

/**
 * Claim the job and open production's session over it — the two calls
 * `advanceJobWith` makes before it runs a step, and nothing after them.
 *
 * **The job handed to `claimSession` is the one `claim` read back from the
 * row**, not the object this file queued, so an address that was never stored
 * on the job cannot reach the article by way of the test.
 */
async function claimAndOpen(queued: Job): Promise<void> {
  const attempt = mintAttempt();
  let outcome = await pgJobStore.claim(queued.id, DEV_OWNER_ID, attempt, 60_000, 4);
  /* `busy` is somebody else holding the counted cap across the whole table. */
  for (let tries = 1; outcome.kind !== "claimed" && tries <= 40; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    outcome = await pgJobStore.claim(queued.id, DEV_OWNER_ID, attempt, 60_000, 4);
  }
  if (outcome.kind !== "claimed") throw new Error(`job ${queued.id} was never claimed: ${outcome.kind}`);
  const claimed = outcome.job;
  try {
    await runAsOwner(DEV_OWNER_ID, () => claimSession(claimed, attempt));
  } finally {
    /* The job is `running` and will never be finished, and the cap on running
       jobs is counted across the whole table: left there, the fifth case would
       be told `busy` by the first four. */
    await db().delete(jobsTable).where(eq(jobsTable.id, claimed.id));
  }
}

/* ------------------------------------------------------------- the article -- */

/** An article row that exists already, published or not, as a past job left it. */
async function seedArticle(
  slug: string,
  opts: { askedUrl: string | null; published: boolean },
): Promise<void> {
  const id = randomUUID();
  await db()
    .insert(articles)
    .values({ id, ownerId: DEV_OWNER_ID, slug, shortId: mintId(), askedUrl: opts.askedUrl });
  if (!opts.published) return;
  const revision = randomUUID();
  await db().insert(articleRevisions).values({
    id: revision,
    articleId: id,
    status: "published",
    title: "A paper that is already on the shelf",
    requestedUrl: PAPER,
    finalUrl: PAPER,
    fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  await db().update(articles).set({ currentRevisionId: revision }).where(eq(articles.id, id));
}

async function articleRow(slug: string) {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row;
}

/** Jobs first, then articles: a job's draft pointer blocks the revision's delete. */
async function sweep(): Promise<void> {
  const slugs = Object.values(SLUGS);
  await db().delete(jobsTable).where(inArray(jobsTable.slug, slugs));
  for (const slug of slugs) {
    const row = await articleRow(slug);
    if (!row) continue;
    await db().update(articles).set({ currentRevisionId: null }).where(eq(articles.id, row.id));
    await db().delete(articles).where(eq(articles.id, row.id));
  }
  await db().delete(uploads).where(eq(uploads.id, UPLOAD_ID));
}

describe("the address an article was asked for", { timeout: 60_000 }, () => {
  beforeAll(sweep, 60_000);
  afterAll(async () => {
    await sweep();
    await closeDb();
  }, 60_000);

  it("is the job's own address on the row a URL job creates", async () => {
    expect(await articleRow(SLUGS.born), "the fixture is not a first ingest").toBeUndefined();

    await claimAndOpen(await queueJob(SLUGS.born, { url: SHORT_LINK }));

    const row = await articleRow(SLUGS.born);
    expect(row, "the claim created no article").toBeDefined();
    expect(row?.askedUrl).toBe(SHORT_LINK);
  });

  /** An upload was not asked for by any address, and null is how the row says so. */
  it("is null on the row an upload creates", async () => {
    await db().insert(uploads).values({
      id: UPLOAD_ID,
      ownerId: DEV_OWNER_ID,
      filename: "paper.pdf",
      claimedBytes: 1_024,
      claimedSha256: "0".repeat(64),
      status: "pending",
      grantExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await claimAndOpen(
      await queueJob(SLUGS.upload, { upload: { id: UPLOAD_ID, filename: "paper.pdf" } }),
    );

    const row = await articleRow(SLUGS.upload);
    expect(row, "the claim created no article").toBeDefined();
    expect(row?.askedUrl).toBeNull();
  });

  /**
   * **Written once.** A second job on a published article is a refresh or a
   * late step, and its address is the article's `final_url`, not what the
   * reader pasted. If it could overwrite the column, the short link would stop
   * finding the article after the first refresh.
   */
  it("is left alone by a later job on a published article, whatever that job's address", async () => {
    await seedArticle(SLUGS.published, { askedUrl: SHORT_LINK, published: true });

    await claimAndOpen(await queueJob(SLUGS.published, { url: PAPER }));

    expect((await articleRow(SLUGS.published))?.askedUrl).toBe(SHORT_LINK);
  });

  /**
   * **And a published article from before the column stays null.** Its job's
   * address is the paper's own, by way of `urlForSlug`, so filling the null in
   * would record an address nobody pasted.
   */
  it("is left null by a later job on an article published before the column existed", async () => {
    await seedArticle(SLUGS.publishedNull, { askedUrl: null, published: true });

    await claimAndOpen(await queueJob(SLUGS.publishedNull, { url: PAPER }));

    expect((await articleRow(SLUGS.publishedNull))?.askedUrl).toBeNull();
  });

  /**
   * **The one time an existing row is told.** A failed import from before the
   * column left a row with nothing published and no address. Retry copies the
   * failed job's address and keeps the slug, so the row is found rather than
   * created, and without this the paper would publish with a null and the next
   * paste of the same link would import it again. GPT Sol's K1 on the plan.
   */
  it("is given to an unpublished row that has none, by the job that retries it", async () => {
    await seedArticle(SLUGS.retried, { askedUrl: null, published: false });

    await claimAndOpen(await queueJob(SLUGS.retried, { url: SHORT_LINK }));

    expect((await articleRow(SLUGS.retried))?.askedUrl).toBe(SHORT_LINK);
  });

  /** Unpublished is not a licence to overwrite: the first address told is the one kept. */
  it("is not replaced on an unpublished row that already has one", async () => {
    await seedArticle(SLUGS.retriedTwice, { askedUrl: SHORT_LINK, published: false });

    await claimAndOpen(await queueJob(SLUGS.retriedTwice, { url: ANOTHER_LINK }));

    expect((await articleRow(SLUGS.retriedTwice))?.askedUrl).toBe(SHORT_LINK);
  });
});
