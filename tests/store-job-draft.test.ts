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
import { and, eq, inArray } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs } from "../src/db/schema.js";
import { mintId } from "../src/ids.js";
import { mintAttempt } from "../src/store/jobs.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { NotTheLiveAttempt, openOrBeginJobDraft } from "../src/store/pg-revisions.js";
import type { JobStep } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

const SLUG = "test-job-draft";
const OTHER_SLUG = "test-job-draft-other";

/* ---------------------------------------------------- is there a database -- */

const { reachable } = await pgReady({
  suite: "tests/store-job-draft.test.ts",
  tables: ["spideryarn.article_revisions"],
});

const when = reachable ? describe : describe.skip;

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
 * The retirement is needed at all because `jobs_only_one_running` is a *global*
 * partial unique index: a second `running` row is a `23505` however unrelated
 * the two jobs are. That is the index doing its job, and it means a file that
 * wants a running job has to clean up after its own previous one.
 */
const made: string[] = [];

async function claimedJob(slug: string): Promise<{ id: string; attemptId: string }> {
  if (made.length > 0) {
    await getDb()
      .update(jobs)
      .set({ status: "done", attemptId: null, leaseExpiresAt: null, finishedAt: new Date() })
      .where(and(inArray(jobs.id, made), eq(jobs.status, "running")));
  }
  /* The running slot is global (`jobs_only_one_running` is unique on `(true)`),
     so a concurrent suite or a dev server mid-ingest owns it as legitimately as
     we do. Without this wait, losing that race surfaced here as a duplicate-key
     error against whichever case inserted second — a failure naming this file
     for something that was never its fault. */
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
  });

  afterAll(async () => {
    await cleanUp(SLUG);
    await cleanUp(OTHER_SLUG);
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
   * **The job row is held while we wait for the article lock**, which is the
   * window the race actually lives in — and two more obvious tests do not prove
   * it, which is why this one looks like this.
   *
   * The race: two callers both read `draft_revision_id = null`, both then queue
   * on `lockArticle`, the first mints R1 and commits, and the second — still
   * holding its stale null — mints R2 and repoints the job. Fencing on the
   * attempt does not help; both tokens are live.
   *
   * **What does not prove it.** Firing two calls with `Promise.all` and
   * asserting one draft: passes with `for update` deleted, because the two
   * transactions do not interleave at the point that matters. Holding the *job*
   * row and showing the call blocks: also passes with it deleted, because
   * `fenceJob`'s `UPDATE` at the end of the call blocks on that row regardless.
   * Both were written, both were watched, and both were green against the
   * broken code — [silent success](../docs/reusable/silent-success.md), twice in
   * a row, on the same fix.
   *
   * **What does.** Hold the **article** row from somewhere else, so the call is
   * stuck inside `lockArticle` and has not reached `fenceJob`. Then ask a third
   * connection for the job row `for update nowait`. If the call took the lock,
   * that is refused (`55P03`); if it did not, it succeeds — and that success is
   * precisely the gap two callers slip through.
   */
  it("holds the job row while it waits for the article lock", async () => {
    const job = await claimedJob(SLUG);
    const db = getDb();
    const [article] = await db.select().from(articles).where(eq(articles.slug, SLUG)).limit(1);
    expect(article, "the earlier tests should have made this article").toBeTruthy();

    let release!: () => void;
    const holdUntil = new Promise<void>((r) => {
      release = r;
    });
    // Somebody else holds the article. Our call will queue behind this.
    const holder = db.transaction(async (tx) => {
      await tx
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.id, (article as { id: string }).id))
        .for("update");
      await holdUntil;
    });
    await new Promise((r) => setTimeout(r, 100));

    const call = openOrBeginJobDraft({ slug: SLUG, job });
    await new Promise((r) => setTimeout(r, 300));

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
      // 55P03 lock_not_available — which is the answer we want.
    }

    release();
    await holder;
    await call;

    expect(jobRowWasFree, "openOrBeginJobDraft left the job row unlocked").toBe(false);
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
