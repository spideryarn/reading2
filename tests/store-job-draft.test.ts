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
import { DEV_OWNER_ID } from "../src/owner.js";
import { NotTheLiveAttempt, openOrBeginJobDraft } from "../src/store/pg-revisions.js";
import type { JobStep } from "../src/types.js";

const SLUG = "test-job-draft";
const OTHER_SLUG = "test-job-draft-other";

/* ---------------------------------------------------- is there a database -- */

let reachable = false;
if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.article_revisions') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
  } catch {
    reachable = false;
  }
  await pool.end();
}
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
  const id = mintId();
  made.push(id);
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
  return { id, attemptId };
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
