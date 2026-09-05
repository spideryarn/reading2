/**
 * **Does the Retry button reach the checkpoints the failed attempt paid for?**
 *
 * `tests/checkpoints-durable-resume.test.ts` proves that *given one article*,
 * two jobs share their chunks — and it establishes that by constructing both
 * attempts with the **same `articleId`, by hand** (its `storeFor(id = articleId)`
 * at ~215, used by both halves of every case). That is the right test for the
 * store and it assumes away the only question this file asks:
 *
 * > when a reader presses Retry, is attempt 2 on the same article as attempt 1?
 *
 * Because a checkpoint is addressed by the article and nothing else
 * (`src/store/checkpoints.ts` § *A checkpoint is addressed by the article and
 * the question, never by the revision*, and `CheckpointArticleRef`), and because
 * the store a stage is handed is built as
 * `createPgCheckpointStore({ slug: ref.slug, articleId: ref.articleId })` from
 * the claim's own draft (`src/store/pg-session.ts` ~597), **the article is a
 * pure function of the job's slug**: `openPgStoreSession` → `openOrBeginJobDraft`
 * → `lockOrCreateArticle(tx, slug)`. So "same slug" and "same checkpoints" are
 * one sentence, and both are asserted below — the slug, and then a real
 * write-then-read through the real `CheckpointStore` for the two attempts.
 *
 * ## Why this goes through `enqueue`/`retryJob` and not a hand-built id
 *
 * Retry is `retryJob` → `enqueue` (`src/jobs.ts`), and until 2026-09-03 `enqueue`
 * **allocated the slug afresh** on every call, with nothing in that path told
 * which article the previous attempt had been on:
 *
 * - an **upload** took `{ kind: "minted", slug: slugWithShortId(request.slug) }`
 *   unconditionally — there was no branch that could adopt;
 * - a **url** went through `freeSlug`, which adopts only what `slugForUrlKey`
 *   (the shelf: an article with a *published* revision) or
 *   `inFlightSlugForUrlKey` finds — and the latter skips every job that is not
 *   `queued` or `running`, so the failed first attempt was invisible.
 *
 * A first ingest that failed has published nothing, so there was no shelf row to
 * adopt, and its job row is `error`, so there was no in-flight row to adopt.
 * Both attempts therefore got different articles and attempt 2 could not see a
 * single chunk attempt 1 had paid for.
 *
 * `slugForRetry` (`src/jobs.ts`) is the repair: the same three branches, with a
 * retry's *mint* keeping the failed attempt's own name instead of generating a
 * new one. The two cases below are what it had to turn green; the three after
 * them are the controls that were green already; and the two after those are the
 * race the repair could have opened — an adoption reserves nothing — held shut.
 *
 * ## Postgres, and only Postgres
 *
 * `checkpoints` is a Postgres table and `createPgCheckpointStore` is the only
 * implementation. The slug allocation under test is store-agnostic code in
 * `src/jobs.ts`, but the article identity it decides is only expressible here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq, like, sql } from "drizzle-orm";

import { getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  checkpoints as checkpointsTable,
  jobs as jobsTable,
  uploads as uploadsTable,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { urlKey } from "../src/ingest.js";
import { enqueue, getJob, retryJob } from "../src/jobs.js";
import { INTERRUPTED } from "../src/messages.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { createPgCheckpointStore } from "../src/store/checkpoints-pg.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { lockOrCreateArticle } from "../src/store/pg-revisions.js";
import { mintAttempt } from "../src/store/jobs.js";
import type { Job } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";
import { scratchArticleInPg } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/retry-keeps-the-checkpoints.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs", "spideryarn.checkpoints"],
});
/**
 * **One suite at a time may hold a running job**, and this file holds several in
 * turn: every case claims a job in order to fail it. The concurrency cap is
 * counted across the whole `spideryarn.jobs` table, so a peer suite with a
 * `running` row makes `claim` here answer `busy` — which shows up as
 * *the fixture job could not be claimed, so it cannot be failed*, on whichever
 * case happens to run while the peer is inside its own. Watched twice in one
 * full-suite run on 2026-09-03, green on the same cases run alone.
 * tests/helpers/run-lock.ts has the whole argument.
 */
const runLock = await takeRunLock("tests/retry-keeps-the-checkpoints.test.ts");

const OWNER = DEV_OWNER_ID;

/** One stem per file, so the sweep at the end can find every row it made. */
const STEM = "test-retry-keeps-checkpoints";

/** 16 lower-case hex, which is what both real callers mint — `CHECKPOINT_KEY_RE`. */
const KEY = "0123456789abcdef";

let vercel: string | undefined;

/** Upload rows this file made, so the sweep can take them away again. */
const uploadIds: string[] = [];

/**
 * **A real `uploads` row**, because `jobs.upload_id` is a foreign key into it
 * (src/db/schema.ts ~1766) and a made-up uuid fails the insert rather than
 * reaching the allocation under test. `verified`, since the two CHECKs on that
 * status want a hash and a byte count.
 */
async function anUpload(filename: string): Promise<{ id: string; filename: string }> {
  const id = crypto.randomUUID();
  await getDb()
    .insert(uploadsTable)
    .values({
      id,
      ownerId: OWNER,
      filename,
      claimedBytes: 1024,
      claimedSha256: "a".repeat(64),
      status: "verified",
      grantExpiresAt: new Date(Date.now() + 60 * 60_000),
      sha256: "a".repeat(64),
      bytes: 1024,
    });
  uploadIds.push(id);
  return { id, filename };
}

beforeAll(async () => {
  /* **`VERCEL`, so `enqueue` does not start driving what it queues** — `pump`
     returns immediately when it is set (src/jobs.ts). Without it both attempts
     run a real `fetch` step against an address that does not exist, racing every
     assertion below. Read when `pump` is called, so `beforeAll` is early enough. */
  vercel = process.env.VERCEL;
  process.env.VERCEL = "1";
}, 60_000);

afterAll(async () => {
  if (vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = vercel;
  const db = getDb();
  /* Jobs first: a job row's `draft_revision_id` is a foreign key into the
     revision an article delete would be cascading away. */
  await db.delete(jobsTable).where(like(jobsTable.slug, `${STEM}%`));
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(like(articles.slug, `${STEM}%`));
  for (const { id } of rows) {
    await db.execute(
      sql`update ${articles} set current_revision_id = null where id = ${id}::uuid`,
    );
    await db.delete(checkpointsTable).where(eq(checkpointsTable.articleId, id));
    await db.delete(articles).where(eq(articles.id, id));
  }
  for (const id of uploadIds) await db.delete(uploadsTable).where(eq(uploadsTable.id, id));
  await runLock?.release();
});

/**
 * **The article a claim on this slug would work in** — the same call the session
 * makes, rather than an `insert` of our own.
 *
 * `openPgStoreSession` → `openOrBeginJobDraft` → `lockOrCreateArticle(tx, slug)`
 * (src/store/pg-revisions.ts ~480) is where `ref.articleId` comes from, and
 * `pgStoreSession` binds the checkpoint store to exactly that
 * (src/store/pg-session.ts ~597). So this is the article identity the checkpoint
 * store *would be handed* for a job on this slug.
 */
async function articleForSlug(slug: string): Promise<string> {
  return await runAsOwner(OWNER, async () =>
    getDb().transaction(async (tx) => (await lockOrCreateArticle(tx, slug)).id),
  );
}

/**
 * End a queued job the way a lapsed lease ends one: `error`, carrying
 * `INTERRUPTED` — which is what `settleExpired` writes (src/store/pg-jobs.ts
 * ~896) and what a mid-step deadline abort writes through `interruptedEnding`
 * (src/jobs.ts ~1150). It is also the ending `jobWorthRetrying` says Retry is
 * for, so the button the reader presses is really offered on this row.
 *
 * Through `claim` and `finish` rather than an `UPDATE` of our own, because both
 * writes are fenced on the attempt token and a hand-rolled row could be one the
 * queue would never produce.
 */
async function failIt(job: Job): Promise<Job> {
  const attempt = mintAttempt();
  const claimed = await pgJobStore.claim(job.id, OWNER, attempt, 60_000, 4);
  expect(claimed.kind, "the fixture job could not be claimed, so it cannot be failed").toBe(
    "claimed",
  );
  return await pgJobStore.finish(job.id, attempt, {
    status: "error",
    steps: job.steps,
    error: INTERRUPTED.message,
    failureKind: INTERRUPTED.kind,
  });
}

/**
 * The whole of a case: queue a first ingest, fail it, press Retry, and ask
 * whether attempt 2 can read what attempt 1 wrote.
 *
 * The checkpoint write and read are the real store, built exactly as a session
 * builds one — a fresh instance per attempt, bound to that attempt's article,
 * with nowhere to put a job id, because the production constructor has nowhere
 * to put one either.
 */
async function twoAttempts(request: Parameters<typeof enqueue>[0]): Promise<{
  first: Job;
  second: Job;
  firstArticle: string;
  secondArticle: string;
  served: boolean;
}> {
  const first = await runAsOwner(OWNER, () => enqueue(request));
  await failIt(first);
  const failed = await runAsOwner(OWNER, () => getJob(first.id));
  expect(failed?.status, "the first attempt has to have failed for the case to mean anything").toBe(
    "error",
  );

  const retried = await runAsOwner(OWNER, () => retryJob(first.id));
  if (!retried) throw new Error("retryJob refused the failed job");

  const firstArticle = await articleForSlug(first.slug);
  const secondArticle = await articleForSlug(retried.slug);

  /* Attempt 1 finishes a chunk and banks it. */
  await createPgCheckpointStore({ slug: first.slug, articleId: firstArticle }).write(
    first.slug,
    "pdf-chunk",
    KEY,
    { records: [{ page: 1, text: "attempt one paid for this" }] },
  );

  /* Attempt 2 asks for it, the way `runPdfExtract` asks before buying. */
  const found = await createPgCheckpointStore({
    slug: retried.slug,
    articleId: secondArticle,
  }).read(retried.slug, "pdf-chunk", [KEY]);

  return { first, second: retried, firstArticle, secondArticle, served: found.has(KEY) };
}

describe("Retry, and the checkpoints the failed attempt paid for", () => {
  /**
   * **An upload.** `enqueue` mints unconditionally for one — there is no branch
   * in `src/jobs.ts` ~2350 that could adopt — so this is the case with no way to
   * come out right, and it is the case a hundred-page PDF arrives through.
   */
  it("an upload's retry lands on the article the first attempt paid for", async () => {
    const { first, second, firstArticle, secondArticle, served } = await twoAttempts({
      slug: `${STEM}-upload`,
      upload: await anUpload("a-long-book.pdf"),
      steps: ["fetch", "extract"],
    });

    /* **Soft, all three**, so one run shows the whole chain rather than only its
       first link: the slug moved, therefore the article moved, therefore the
       chunk was not served. The last one is the money. */
    expect.soft(
      served,
      "attempt 2 was not served the chunk attempt 1 paid for, so every chunk is bought again",
    ).toBe(true);
    expect.soft(secondArticle, "the two attempts are keyed on different articles").toBe(
      firstArticle,
    );
    expect.soft(
      second.slug,
      "Retry on a failed upload put attempt 2 on a different article, so it cannot see attempt 1's chunks",
    ).toBe(first.slug);
  }, 60_000);

  /**
   * **A URL whose first ingest failed.** `freeSlug` can adopt, and here it
   * cannot: nothing is on the shelf (a failed first ingest published no
   * revision) and `inFlightSlugForUrlKey` skips a job that is not `queued` or
   * `running` (`src/jobs.ts` ~2777).
   */
  it("a failed first URL ingest's retry lands on the article the first attempt paid for", async () => {
    const url = `https://retry-keeps-checkpoints.test/${mintId()}.pdf`;
    const { first, second, firstArticle, secondArticle, served } = await twoAttempts({
      slug: `${STEM}-url`,
      url,
      steps: ["fetch", "extract"],
    });

    expect.soft(
      served,
      "attempt 2 was not served the chunk attempt 1 paid for, so every chunk is bought again",
    ).toBe(true);
    expect.soft(secondArticle, "the two attempts are keyed on different articles").toBe(
      firstArticle,
    );
    expect.soft(
      second.slug,
      "Retry on a failed URL ingest put attempt 2 on a different article, so it cannot see attempt 1's chunks",
    ).toBe(first.slug);
  }, 60_000);

  /* ------------------------------------------------------- and the controls -- */

  /**
   * **The green half: a retry that names a slug keeps its article.**
   *
   * This is the third shape of `EnqueueRequest` — neither a URL nor an upload,
   * which is a late-stage re-run on an article already on the shelf — and
   * `enqueue` allocates `{ kind: "adopted", slug: request.slug }` for it
   * (`src/jobs.ts` ~2352). So `retryJob`, which passes `slug: old.slug`, lands
   * back on the same article and the checkpoints are reachable.
   *
   * **It is also the control that makes the two red cases mean something.** The
   * write-then-read below is the same code, the same namespace and the same key
   * as theirs; if this went red too, they would be red because the checkpoint
   * store is broken rather than because Retry moved the article.
   */
  it("a slug-named re-run's retry keeps the article, so the checkpoints are reachable", async () => {
    const slug = `${STEM}-named`;
    /* The article has to exist, because `enqueue` refuses a slug-named request
       for an article that is not this reader's (`src/jobs.ts` ~2329). */
    const article = await articleForSlug(slug);

    const first = await runAsOwner(OWNER, () => enqueue({ slug, steps: ["ideas"] }));
    await failIt(first);
    const retried = await runAsOwner(OWNER, () => retryJob(first.id));
    if (!retried) throw new Error("retryJob refused the failed job");

    expect(retried.slug, "a slug-named retry moved to a different article").toBe(slug);

    await createPgCheckpointStore({ slug, articleId: article }).write(slug, "pdf-chunk", KEY, {
      records: [{ page: 1, text: "attempt one paid for this" }],
    });
    const found = await createPgCheckpointStore({
      slug: retried.slug,
      articleId: await articleForSlug(retried.slug),
    }).read(retried.slug, "pdf-chunk", [KEY]);
    expect(
      found.has(KEY),
      "the checkpoint store cannot serve one attempt's work to the next even on one article — " +
        "so the two red cases above are not about Retry",
    ).toBe(true);
  }, 60_000);

  /**
   * **A step that is released between steps and re-claimed later keeps its
   * article**, which is the other path a long PDF takes and the one that does
   * work.
   *
   * `transitionAfter`'s `{ kind: "release" }` branch (`src/jobs.ts` ~1940) hands
   * the *same job row* back to the queue: `releaseStepIn`
   * (`src/store/pg-jobs.ts` ~1240) sets the status, the token, the lease and the
   * steps, and never touches `slug`. So the next pump claims the same row, opens
   * a session on the same slug, and `lockOrCreateArticle` finds the same article.
   * A checkpoint written under the first claim is therefore served to the second.
   */
  it("a release between steps keeps the article, so a later claim resumes", async () => {
    const slug = `${STEM}-released`;
    const article = await articleForSlug(slug);
    const job = await runAsOwner(OWNER, () => enqueue({ slug, steps: ["ideas"] }));

    const first = mintAttempt();
    expect((await pgJobStore.claim(job.id, OWNER, first, 60_000, 4)).kind).toBe("claimed");
    await createPgCheckpointStore({ slug, articleId: article }).write(slug, "pdf-chunk", KEY, {
      records: [{ page: 1, text: "the first claim paid for this" }],
    });
    const released = await pgJobStore.releaseStep(job.id, first, job.steps, {});

    /* Back in the queue, on the same name — which is the whole of why this path
       resumes and Retry does not. */
    expect(released.status).toBe("queued");
    expect(released.slug, "a release moved the job to a different article").toBe(slug);

    const second = mintAttempt();
    expect((await pgJobStore.claim(job.id, OWNER, second, 60_000, 4)).kind).toBe("claimed");
    const reclaimed = await runAsOwner(OWNER, () => getJob(job.id));
    const found = await createPgCheckpointStore({
      slug: reclaimed?.slug ?? "",
      articleId: await articleForSlug(reclaimed?.slug ?? ""),
    }).read(reclaimed?.slug ?? "", "pdf-chunk", [KEY]);
    expect(
      found.has(KEY),
      "the re-claimed job could not see what the released claim paid for",
    ).toBe(true);

    /* Put it down again, so nothing is left holding a lease on this slug. */
    await pgJobStore.finish(job.id, second, {
      status: "error",
      steps: job.steps,
      error: INTERRUPTED.message,
      failureKind: INTERRUPTED.kind,
    });
  }, 60_000);

  /**
   * **An address already on the shelf is adopted, whatever name the request
   * asks for** — so a refresh or a re-run of a *published* article keeps its
   * article and its checkpoints.
   *
   * This is `freeSlug`'s working half: `slugForUrlKey`
   * (`src/store/find-article.ts` ~103) matches the reader's published revisions
   * by `urlKey` and `freeSlug` returns `{ kind: "adopted", slug: held }`. The
   * request below names `${STEM}-nothing-like-it` and comes back on the shelf's
   * slug, which is what the failed-first-ingest case cannot do: there is no
   * published revision to match.
   */
  it("a re-run of an address already on the shelf adopts the shelf's article", async () => {
    const slug = `${STEM}-shelf`;
    const scratch = await scratchArticleInPg(slug, { ownerId: OWNER });
    try {
      const [revision] = await getDb()
        .select({ finalUrl: articleRevisions.finalUrl })
        .from(articleRevisions)
        .innerJoin(articles, eq(articles.currentRevisionId, articleRevisions.id))
        .where(eq(articles.id, scratch.articleId));
      const url = revision?.finalUrl;
      if (!url) throw new Error("the shelf fixture has no published URL to adopt");

      const job = await runAsOwner(OWNER, () =>
        enqueue({ slug: `${STEM}-nothing-like-it`, url, steps: ["extract"], force: ["extract"] }),
      );
      expect(
        job.slug,
        "a re-run of a published address minted a second article instead of adopting the shelf's",
      ).toBe(slug);
      expect(await articleForSlug(job.slug)).toBe(scratch.articleId);
    } finally {
      await getDb().delete(jobsTable).where(like(jobsTable.slug, `${STEM}%`));
      await scratch.remove();
    }
  }, 120_000);

  /* ------------------------------------------------- and the trap it opens -- */

  /**
   * **One article for one address, still — with a retry queued on it.**
   *
   * This is the case that could have made the fix worse than the bug. An
   * `adopted` allocation reserves nothing, so it sits outside
   * `jobs_active_source`; had the retry adopted the old name, a fresh paste of
   * the same URL in the same instant would have found nothing holding it, minted,
   * and given the reader **two articles for one address** — the exact race the
   * `sourceTaken` comment (`src/jobs.ts`) describes.
   *
   * `slugForRetry` answers it twice over, and this asserts the first half: a
   * paste that *can* see the queued retry adopts it, through
   * `inFlightSlugForUrlKey`, which matches on the address rather than on the
   * name. The request below asks for a name nothing like the retry's and comes
   * back on the retry's slug and the retry's article.
   */
  it("a fresh paste of the same address, while a retry is queued, lands on the retry's article", async () => {
    const url = `https://retry-keeps-checkpoints.test/${mintId()}.pdf`;
    const first = await runAsOwner(OWNER, () =>
      enqueue({ slug: `${STEM}-race`, url, steps: ["fetch", "extract"] }),
    );
    await failIt(first);
    const retried = await runAsOwner(OWNER, () => retryJob(first.id));
    if (!retried) throw new Error("retryJob refused the failed job");
    expect(retried.status, "the retry has to be in the queue for this to be the race").toBe(
      "queued",
    );

    const pasted = await runAsOwner(OWNER, () =>
      enqueue({ slug: `${STEM}-race-nothing-like-it`, url, steps: ["fetch", "extract"] }),
    );
    expect(
      pasted.slug,
      "a paste of an address a queued retry is holding minted a second article for it",
    ).toBe(retried.slug);
    expect(await articleForSlug(pasted.slug)).toBe(await articleForSlug(retried.slug));
  }, 60_000);

  /**
   * **And the same race the other way round: a live ingest already has the
   * address when Retry is pressed.** The retry is *handed that job* and inserts
   * no row of its own.
   *
   * This is `handBackToARetry` (`src/jobs.ts`) on the real store, and it is what
   * replaced the repair that adopted the holder's slug and inserted anyway —
   * which left the address with an active row reserving nothing the moment the
   * holder ended. GPT Sol, reviewing the built stage 3, finding 1; the
   * interleaving itself is `tests/one-article-for-one-address.test.ts` § *and a
   * retry's two*, where it can be forced.
   *
   * **The reader does not reach attempt 1's checkpoints here, and did not
   * before either**: the holder is building a *different* article for this
   * address, and the old repair adopted that same slug. What changed is only
   * that there is now one active job rather than two.
   */
  it("a retry whose address a live job already holds is handed that job", async () => {
    const url = `https://retry-keeps-checkpoints.test/${mintId()}.pdf`;
    const first = await runAsOwner(OWNER, () =>
      enqueue({ slug: `${STEM}-handback`, url, steps: ["fetch", "extract"] }),
    );
    await failIt(first);

    /* A fresh paste of the same address while attempt 1 sits terminal. Nothing
       holds the address — the shelf has no revision and the failed row is not
       active — so this mints its own name and reserves it. */
    const holder = await runAsOwner(OWNER, () =>
      /* `hierarchy` alongside `blocks` because `enqueue` refuses the pair apart
         (`unrunnableStepPlan`); the steps are incidental here — this job is
         never run — and only have to differ from attempt 1's. */
      enqueue({
        slug: `${STEM}-handback-live`,
        url,
        steps: ["fetch", "extract", "blocks", "hierarchy"],
      }),
    );
    expect(holder.slug, "the paste should have minted a name of its own").not.toBe(first.slug);

    const retried = await runAsOwner(OWNER, () => retryJob(first.id));
    if (!retried) throw new Error("retryJob refused the failed job");
    expect(
      retried.id,
      "the retry inserted a second active row for an address something already holds",
    ).toBe(holder.id);
  }, 60_000);

  /**
   * **And the half that catches the paste which cannot see it** — the instant
   * between one request's lookup and the other's insert, which no lookup can
   * close and `jobs_active_source` exists to.
   *
   * Asserted at the index rather than through `enqueue`, because `enqueue` would
   * take the easy door: `inFlightSlugForUrlKey` sees the queued retry, so the
   * case above never reaches the insert at all. Here the ticket is handed
   * straight to the store, exactly as a racing paste's would be after its own
   * lookup came back empty — `reservesName: true` and this address's `urlKey` —
   * and the answer has to be `sourceTaken` **naming the retry**.
   *
   * Which is what proves the retry *reserved*. Had it adopted, its row would be
   * outside `jobs_active_source`, this insert would have succeeded, and the
   * reader would own two articles for one address and have paid for both.
   */
  it("the queued retry reserves its address, so a paste that cannot see it is refused", async () => {
    const url = `https://retry-keeps-checkpoints.test/${mintId()}.pdf`;
    const first = await runAsOwner(OWNER, () =>
      enqueue({ slug: `${STEM}-reserved`, url, steps: ["fetch", "extract"] }),
    );
    await failIt(first);
    const retried = await runAsOwner(OWNER, () => retryJob(first.id));
    if (!retried) throw new Error("retryJob refused the failed job");

    const blind: Job = {
      id: mintId(),
      ownerId: OWNER,
      slug: `${STEM}-reserved-blind-spya-zzzzzz`,
      url,
      steps: retried.steps.map((s) => ({ ...s })),
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    const outcome = await pgJobStore.enqueueOrGet(blind, {
      /* A different piece of work, so `sameWork` cannot answer this and the
         address index has to. */
      workKey: `blind-${mintId()}`,
      reservesName: true,
      urlKey: urlKey(url),
    });

    expect(
      outcome.kind,
      "the retry's row is outside jobs_active_source, so a racing paste would have minted a second article",
    ).toBe("sourceTaken");
    if (outcome.kind !== "sourceTaken") return;
    expect(outcome.job.id, "the refusal named a job that is not the retry").toBe(retried.id);
    /* And the repair `enqueue` would make from here is an adoption of that
       slug — which is the retry's, which is the first attempt's. */
    expect(outcome.job.slug).toBe(first.slug);
  }, 60_000);

  /**
   * **`hierarchy-labels` is fixed by the same change, and is asserted rather
   * than reasoned about.**
   *
   * Both namespaces are defeated identically — by one line, the
   * `createPgCheckpointStore({ slug, articleId })` every session builds
   * (`src/store/pg-session.ts`) — so an argument that the fix reaches both is
   * sound and is still an argument. This is the measurement. Same shape as the
   * upload case above, one word different.
   */
  it("a retry reaches the hierarchy-labels checkpoints too, not only the PDF chunks", async () => {
    const upload = await anUpload("a-long-book-with-a-tree.pdf");
    const first = await runAsOwner(OWNER, () =>
      enqueue({ slug: `${STEM}-labels`, upload, steps: ["fetch", "extract"] }),
    );
    await failIt(first);
    const retried = await runAsOwner(OWNER, () => retryJob(first.id));
    if (!retried) throw new Error("retryJob refused the failed job");

    await createPgCheckpointStore({
      slug: first.slug,
      articleId: await articleForSlug(first.slug),
    }).write(first.slug, "hierarchy-labels", KEY, { records: [{ id: "spya-k3m9qt", label: "one" }] });

    const found = await createPgCheckpointStore({
      slug: retried.slug,
      articleId: await articleForSlug(retried.slug),
    }).read(retried.slug, "hierarchy-labels", [KEY]);
    expect(
      found.has(KEY),
      "attempt 2 could not see the labels attempt 1 paid for",
    ).toBe(true);
  }, 60_000);
});
