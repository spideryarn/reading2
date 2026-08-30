/**
 * **One draft per job, across requests** — and the bug that would have hit every
 * single ingest.
 *
 * `advanceJob` runs exactly one step per HTTP request, which is what lets each
 * step have its own serverless invocation. A runner that called `beginRevision`
 * once per step would, on request 2, mint a fresh revision (it always mints —
 * nothing about a revision's contents may name it), copy from
 * `articles.current_revision_id` (null for a new article, so the draft comes up
 * empty), and point `jobs.draft_revision_id` at it — throwing away the draft
 * request 1 had just written `fetch`'s output into.
 *
 * The symptom would have been *"extract cannot find the raw document"* on every
 * fresh article: a message pointing at stage 2, from a fault in the runner.
 * GPT Sol found it reviewing docs/plans/transactional-stage-runner.md, before
 * anything was built against it.
 *
 * `openOrBeginJobDraft` is the fix, and this is the test that says so. It is
 * **not** the lookback `beginRevision` refuses in its own docstring: that one
 * would carry from "the latest draft for this slug" and could pick up another
 * job's; this reads one named row out of the job that owns it, fenced on the
 * live attempt.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs } from "../src/db/schema.js";
import { mintId } from "../src/ids.js";
import { mintAttempt } from "../src/store/jobs.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { NotTheLiveAttempt, openOrBeginJobDraft } from "../src/store/pg-revisions.js";
import type { JobStep } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";

const SLUG = "test-job-draft";
const OTHER_SLUG = "test-job-draft-other";
/** Deliberately never given an article row by any other case in this file. */
const FRESH_SLUG = "test-job-draft-fresh";

/* ---------------------------------------------------- is there a database -- */

const { reachable } = await pgReady({
  suite: "tests/store-job-draft.test.ts",
  tables: ["spideryarn.article_revisions"],
});

const when = reachable ? describe : describe.skip;

/**
 * **This file starts a job, so it takes the shared run lock.**
 *
 * This file's fixtures are named the same on every run, so a second copy — a
 * peer's `npm test` beside yours — collides with it on `jobs_active_slug` and
 * on the fixture rows themselves. Taken after `pgReady` and only
 * when reachable, because a suite that is about to skip must not sit holding it.
 * tests/helpers/run-lock.ts has the reasoning and the measurements.
 */
const runLock = reachable ? await takeRunLock("tests/store-job-draft.test.ts") : undefined;
afterAll(async () => {
  await runLock?.release();
});

const STEPS: JobStep[] = [{ name: "fetch", label: "Fetching the page", status: "pending" }];

/**
 * A claimed job, the way `advanceJob` leaves one while a step runs.
 *
 * **Retires only what this file made**, which the first version did not: it
 * marked *every* `running` row done, so running beside the parity suite — or
 * against a local database with a genuine ingest in flight — killed that job
 * and took its claimant's fence with it. A test that can destroy the data it is
 * run against is worse than no test. GPT Sol, 2026-08-27.
 *
 * The retirement is needed at all because these cases reuse three fixed slugs,
 * and `jobs_active_slug` refuses a second job in flight on an article that
 * already has one. Until 2026-08-30 the reason was wider — `jobs_only_one_running`
 * made a second `running` row a `23505` however unrelated the two jobs were —
 * but dropping that index does not help a file that keeps coming back to the
 * same slug. It still has to clean up after its own previous job.
 */
const made: string[] = [];

async function claimedJob(slug: string): Promise<{ id: string; attemptId: string }> {
  if (made.length > 0) {
    await getDb()
      .update(jobs)
      .set({ status: "done", attemptId: null, leaseExpiresAt: null, finishedAt: new Date() })
      .where(and(inArray(jobs.id, made), eq(jobs.status, "running")));
  }
  /* A concurrent copy of this file, or a dev server mid-ingest on one of these
     slugs, owns the article as legitimately as we do. Without this wait, losing
     that race surfaces here as a duplicate-key error against whichever case
     inserted second — a failure naming this file for something that was never
     its fault. (It used to be far likelier: until 2026-08-30 any running job
     anywhere collided, not just one on this slug.) */
  return await insertWhenSlotFree(slug, async () => {
    const id = mintId();
    const attemptId = mintAttempt();
    await getDb()
      .insert(jobs)
      .values({
        id,
        ownerId: DEV_OWNER_ID,
        slug,
        steps: STEPS,
        status: "running",
        attemptId,
        leaseExpiresAt: new Date(Date.now() + 600_000),
        workKey: `wk-${id}`,
      });
    // Only once the row exists: `made` drives teardown, and an id that never
    // inserted would have teardown chasing a row that is not there.
    made.push(id);
    return { id, attemptId };
  });
}

/**
 * A transaction that holds one row and does nothing until it is told to stop.
 *
 * It hands back the **backend pid** as well as the release, because the two lock
 * tests below have to know that the call under test really is stuck behind this
 * transaction before they probe anything — and `pg_blocking_pids` can only
 * answer that if you can name the blocker. The earlier version of the first test
 * slept 300ms and hoped, which is the kind of wait that passes on a fast laptop
 * for the wrong reason.
 */
async function holdRow(
  lockIt: (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) => Promise<unknown>,
): Promise<{ pid: number; release: () => void; done: Promise<unknown> }> {
  let release!: () => void;
  const holdUntil = new Promise<void>((r) => {
    release = r;
  });
  let settle!: (pid: number) => void;
  const gotPid = new Promise<number>((r) => {
    settle = r;
  });

  const done = getDb().transaction(async (tx) => {
    const row = await tx.execute(sql`select pg_backend_pid() as pid`);
    await lockIt(tx);
    // Only after the lock is held: a pid published earlier would let a waiter
    // start probing before there was anything to block on.
    settle(Number((row.rows[0] as { pid: number | string }).pid));
    await holdUntil;
  });

  return { pid: await gotPid, release, done };
}

/**
 * Wait until some other backend is blocked by `pid` — or say so and fail.
 *
 * `pg_blocking_pids` rather than a count of ungranted locks: vitest runs test
 * files at the same time, so "somebody somewhere is waiting" is a condition
 * another suite can satisfy for us, and a probe that fires early would prove
 * whatever the timing happened to be.
 */
async function waitUntilBlockedBy(pid: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const found = await getDb().execute(
      sql`select count(*)::int as n from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`,
    );
    if (Number((found.rows[0] as { n: number | string }).n) > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`nothing ever queued behind backend ${pid} — the call under test never blocked`);
}

async function cleanUp(slug: string): Promise<void> {
  const db = getDb();
  // By id where we can, so a slug this file never made is never touched.
  if (made.length > 0) await db.delete(jobs).where(inArray(jobs.id, made));
  await db.delete(jobs).where(eq(jobs.slug, slug));
  const [article] = await db.select().from(articles).where(eq(articles.slug, slug)).limit(1);
  if (article) {
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, article.id));
    await db.delete(articleRevisions).where(eq(articleRevisions.articleId, article.id));
    await db.delete(articles).where(eq(articles.id, article.id));
  }
}

when("the draft a job owns", () => {
  beforeAll(async () => {
    await cleanUp(SLUG);
    await cleanUp(OTHER_SLUG);
    await cleanUp(FRESH_SLUG);
  });

  afterAll(async () => {
    await cleanUp(SLUG);
    await cleanUp(OTHER_SLUG);
    await cleanUp(FRESH_SLUG);
    await closeDb();
  });

  it("is minted once and reopened after that, however many requests there are", async () => {
    const job = await claimedJob(SLUG);

    const first = await openOrBeginJobDraft({ slug: SLUG, job });
    expect(first.created).toBe(true);

    /* Request 2. A different HTTP request, the same job, the same attempt —
       which is what a claim held for one step and re-taken for the next looks
       like from here. Before this function existed, this line minted a second
       revision and the first one's work was orphaned. */
    const second = await openOrBeginJobDraft({ slug: SLUG, job });
    expect(second.created).toBe(false);
    expect(second.revisionId).toBe(first.revisionId);
    expect(second.articleId).toBe(first.articleId);

    // And the job still points at the one draft, rather than at a newer one.
    const [row] = await getDb()
      .select({ draft: jobs.draftRevisionId })
      .from(jobs)
      .where(eq(jobs.id, job.id))
      .limit(1);
    expect(row?.draft).toBe(first.revisionId);

    // Exactly one draft exists for this article, which is the fact underneath.
    const drafts = await getDb()
      .select({ id: articleRevisions.id })
      .from(articleRevisions)
      .where(
        and(
          eq(articleRevisions.articleId, first.articleId),
          eq(articleRevisions.status, "draft"),
        ),
      );
    expect(drafts).toHaveLength(1);
  });

  /**
   * **Two calls at once, carrying the same live token.**
   *
   * The sequential test above passed against a version of this function that
   * only *fenced* on the attempt, and GPT Sol pointed out what that misses:
   * both calls read `draft_revision_id = null`, the **article** lock serialises
   * them, and the second then mints R2 holding its stale null — so the job ends
   * up pointing at R2 with R1 orphaned. Which is the bug the function exists to
   * prevent, one level in.
   *
   * `for update` on the job row is what closes it, taken *before* the article
   * lock so every caller takes the two in the same order. An ordinary
   * `/advance` cannot reach this — only one request can hold the claim — but a
   * primitive whose contract says "one draft" has to mean it whoever calls.
   */
  /**
   * **Article lock before job lock**, which since 2026-08-29 is the one order
   * this whole file keeps — and the probe that can tell is the same one that
   * used to assert the opposite.
   *
   * ## What changed, and why the assertion flipped
   *
   * `openOrBeginJobDraft` used to take `for update` on the job row *first*, and
   * this test asserted that it did. That was safe on facts nobody could check
   * from here: `publishRevision` and `failRevision` take article-then-job, so
   * the file contradicted itself, and only caller sequencing kept the cycle from
   * closing. D1b needs one transaction that opens a draft *and* publishes it,
   * so the order became an invariant instead of an argument.
   * docs/plans/delete-the-importer-d1b-design-sol.md.
   *
   * The race the old order closed is still closed, by the article lock instead:
   * two callers both read `draft_revision_id = null`, both mint, and the second
   * repoints the job leaving the first draft orphaned. The second caller now
   * queues on the *article* row from before it looks at the job at all, so it
   * cannot be holding a stale null when it decides.
   *
   * ## The two obvious tests that cannot tell the orders apart
   *
   * Both were written for the old order, both were watched, and both were green
   * against the broken code — [silent success](../docs/reusable/silent-success.md),
   * twice in a row on the same fix. Firing two calls with `Promise.all` and
   * asserting one draft: the two transactions do not interleave at the point
   * that matters. Holding the *job* row and showing the call blocks: it blocks
   * either way, because `fenceJob`'s `UPDATE` needs that row at the end of the
   * call regardless of what was locked at the start.
   *
   * **What does.** Hold the **article** row from somewhere else. Then ask a
   * third connection for the job row `for update nowait`. Under the new order
   * the call is stuck on the article and has not gone near the job, so that
   * succeeds. Under the old order the call took the job row on its way to the
   * article, and it is refused (`55P03`) — which is how this test goes red
   * against the code as it stood the day before.
   */
  it("takes the article lock before it touches the job row", async () => {
    const job = await claimedJob(SLUG);
    const db = getDb();
    const [article] = await db.select().from(articles).where(eq(articles.slug, SLUG)).limit(1);
    expect(article, "the earlier tests should have made this article").toBeTruthy();
    const articleId = (article as { id: string }).id;

    // Somebody else holds the article. Our call will queue behind this.
    const holder = await holdRow((tx) =>
      tx.select({ id: articles.id }).from(articles).where(eq(articles.id, articleId)).for("update"),
    );

    const call = openOrBeginJobDraft({ slug: SLUG, job });
    await waitUntilBlockedBy(holder.pid);

    let jobRowWasFree = false;
    try {
      await db.transaction(async (tx) => {
        await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.id, job.id))
          .for("update", { noWait: true });
        jobRowWasFree = true;
      });
    } catch {
      // 55P03 lock_not_available — the old order's answer, and now a failure.
    }

    holder.release();
    await holder.done;
    await call;

    expect(
      jobRowWasFree,
      "openOrBeginJobDraft took the job row before the article — the old order",
    ).toBe(true);
  });

  /**
   * **A row that does not exist cannot be locked**, which is why the article is
   * created here rather than merely locked.
   *
   * This is the hole the reorder opens if it is done in the obvious way, and it
   * is worth spelling out because the obvious way looks complete. `lockArticle`
   * takes nothing on a first ingest — there is no row yet — so two callers would
   * be serialised by the job row again, and the loser would come out of that
   * wait carrying "there is no article" from *before* the winner committed. It
   * would then find a draft pointer naming a real revision, decide the pointer
   * was unusable, and mint a second draft: the orphan this function exists to
   * prevent, arriving through the fix for it. So the top of the transaction
   * calls `lockOrCreateArticle`.
   *
   * Proved from outside the call. Hold the **job** row, so the call gets past
   * the article and stops there. Then have a third connection try to insert that
   * same slug with a short `lock_timeout`. An uncommitted insert is invisible to
   * a `select`, so `for update nowait` cannot see it — but a second insert of
   * the same unique slug waits on the first one's speculative token, and the
   * timeout is what turns that wait into an answer. With a plain `lockArticle`
   * at the top there is nothing to wait for and the insert goes straight in.
   */
  it("creates and holds the article row for a slug it has never seen", async () => {
    const job = await claimedJob(FRESH_SLUG);
    const db = getDb();
    const before = await db.select().from(articles).where(eq(articles.slug, FRESH_SLUG));
    expect(before, "FRESH_SLUG must start with no article row").toHaveLength(0);

    // The job row this time, so the call gets past the article and stops here.
    const holder = await holdRow((tx) =>
      tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, job.id)).for("update"),
    );

    const call = openOrBeginJobDraft({ slug: FRESH_SLUG, job });
    await waitUntilBlockedBy(holder.pid);

    class Rollback extends Error {}
    let articleWasFree = false;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '1s'`);
        await tx.insert(articles).values({ ownerId: DEV_OWNER_ID, slug: FRESH_SLUG });
        articleWasFree = true;
        // Never kept: the point is whether the insert was possible, not to make
        // a row the call under test is about to make itself.
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) {
        // 55P03 lock_not_available — the call is holding the row it created.
      }
    }

    holder.release();
    await holder.done;
    const opened = await call;

    expect(
      articleWasFree,
      "openOrBeginJobDraft reached the job row without creating the article",
    ).toBe(false);
    expect(opened.created, "and it still mints the first draft").toBe(true);
  });

  it("mints one draft when two callers ask together", async () => {
    const job = await claimedJob(SLUG);
    /* **The delta, not the total.** Earlier tests in this file leave their own
       drafts on this article, and asserting "one draft exists" would be
       measuring those rather than this race — a test that fails for a true
       reason it is not about is worse than no test. */
    const draftsNow = async (articleId: string) =>
      (
        await getDb()
          .select({ id: articleRevisions.id })
          .from(articleRevisions)
          .where(
            and(eq(articleRevisions.articleId, articleId), eq(articleRevisions.status, "draft")),
          )
      ).length;

    const [a, b] = await Promise.all([
      openOrBeginJobDraft({ slug: SLUG, job }),
      openOrBeginJobDraft({ slug: SLUG, job }),
    ]);

    expect(a.revisionId).toBe(b.revisionId);
    // Exactly one of them did the minting; the other reopened.
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);

    // A third call adds nothing, which is the same fact from a settled state.
    const before = await draftsNow(a.articleId);
    const third = await openOrBeginJobDraft({ slug: SLUG, job });
    expect(third.created).toBe(false);
    expect(third.revisionId).toBe(a.revisionId);
    expect(await draftsNow(a.articleId)).toBe(before);

    // And the job points at the one that exists.
    const [row] = await getDb()
      .select({ draft: jobs.draftRevisionId })
      .from(jobs)
      .where(eq(jobs.id, job.id))
      .limit(1);
    expect(row?.draft).toBe(a.revisionId);
  });

  it("refuses a live token carrying somebody else's slug", async () => {
    /* The one unusable-pointer case that is **not** recoverable. Null, swept and
       non-draft all fall back to minting, because none is anybody's fault. A
       live token with the wrong slug means a caller has mixed two jobs up, and
       minting would repoint a perfectly good job at an article it has nothing
       to do with — the same class of fault as `enqueue` renaming a slug out
       from under a request. GPT Sol, 2026-08-27. */
    const job = await claimedJob(SLUG);
    await expect(openOrBeginJobDraft({ slug: OTHER_SLUG, job })).rejects.toBeInstanceOf(
      NotTheLiveAttempt,
    );
  });

  it("refuses a claimant that no longer holds the job", async () => {
    /* Fenced on the live attempt, and read inside the transaction that may
       mint. An unfenced read would let a claimant whose lease has lapsed reopen
       a draft it no longer owns and write a step into it. */
    const job = await claimedJob(OTHER_SLUG);
    await openOrBeginJobDraft({ slug: OTHER_SLUG, job });

    await getDb().update(jobs).set({ status: "error" }).where(eq(jobs.id, job.id));
    await expect(openOrBeginJobDraft({ slug: OTHER_SLUG, job })).rejects.toBeInstanceOf(
      NotTheLiveAttempt,
    );
  });

  it("mints again when the draft it recorded has gone", async () => {
    /* Four ways the pointer is not usable and all four fall back to minting:
       none is the caller's fault and every one is a state the database reaches.
       This is the sharpest — the revision was swept or cascaded away, and the
       job still names it. */
    const job = await claimedJob(SLUG);
    const first = await openOrBeginJobDraft({ slug: SLUG, job });

    await getDb()
      .update(articleRevisions)
      .set({ status: "failed" })
      .where(eq(articleRevisions.id, first.revisionId));

    const again = await openOrBeginJobDraft({ slug: SLUG, job });
    expect(again.created).toBe(true);
    expect(again.revisionId).not.toBe(first.revisionId);
  });
});
