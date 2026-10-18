/**
 * **`article_revisions.matter`, through the database** — plan 261018a, Stage 2,
 * review F2. Two seams, each with the case that would go green over a bug:
 *
 * - **The owner's article read** (`loadArticle`, src/store/pg.ts) hands the
 *   reading view the stored stretches only when they are about the blocks it
 *   is serving — and withholds a value carried over changed blocks, copied
 *   from elsewhere, or malformed, so the reading view falls back to its rule.
 * - **The publication** (`publishRevisionIn`, src/store/pg-revisions.ts)
 *   queues the free `matter` successor when the publishing job cut the blocks
 *   and the stored value is not about them — and not for a job that did not
 *   cut them (a mode job, the test loader), nor when it is already settled.
 *
 * tests/matter-step.test.ts is the static half.
 */
import { randomUUID } from "node:crypto";

import { and, eq, ne } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { matterInputHash } from "../src/matter.js";
import { MATTER_GENERATOR, MATTER_PROMPT_VERSION } from "../src/matter-step.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import { mintAttempt } from "../src/store/jobs.js";
import { beginRevision, publishRevision } from "../src/store/pg-revisions.js";
import { loadArticle } from "../src/store/index.js";
import type { Block, JobStep, Matter, StepName } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/matter-step-pg.test.ts",
  columns: [{ table: "spideryarn.article_revisions", column: "matter" }],
});

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-matter-step-${RUN}`;

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  /* Asserted, not assumed: every case below is about the blocks. */
  expect(article.blocks.length).toBeGreaterThan(10);
}, 60_000);

afterEach(async () => {
  await getDb().delete(jobs).where(eq(jobs.slug, SLUG));
});

afterAll(async () => {
  await getDb().delete(jobs).where(eq(jobs.slug, SLUG));
  await article?.remove();
  await closeDb();
});

const asOwner = <T>(fn: () => Promise<T>) => runAsOwner(DEV_OWNER_ID, fn);

async function currentRevisionId(): Promise<string> {
  const [row] = await getDb().select({ id: articles.currentRevisionId }).from(articles).where(eq(articles.slug, SLUG)).limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  return row.id;
}

async function setMatter(revisionId: string, value: unknown): Promise<void> {
  await getDb()
    .update(articleRevisions)
    .set({ matter: value as Matter })
    .where(eq(articleRevisions.id, revisionId));
}

function valid(blocks: readonly Block[]): Matter {
  const n = blocks.length;
  return {
    status: "ok",
    version: MATTER_PROMPT_VERSION,
    generator: MATTER_GENERATOR,
    sourceHash: matterInputHash(blocks),
    stretches: [{ from: blocks[n - 3]!.id, to: blocks[n - 1]!.id, kinds: ["references"] }],
  };
}

describe("the owner's article read", () => {
  it("is absent when nothing has been stored, so the reading view uses its rule", async () => {
    await setMatter(await currentRevisionId(), null);
    const read = await asOwner(() => loadArticle(SLUG));
    expect("matter" in read).toBe(false);
  });

  it("hands on the stretches when they are about these blocks", async () => {
    const read0 = await asOwner(() => loadArticle(SLUG));
    const value = valid(read0.blocks);
    await setMatter(await currentRevisionId(), value);
    const read = await asOwner(() => loadArticle(SLUG));
    expect(read.matter).toEqual(value.status === "ok" ? value.stretches : null);
  });

  it("withholds a value whose sourceHash is not these blocks' — carried over changed blocks, or copied", async () => {
    const read0 = await asOwner(() => loadArticle(SLUG));
    const edited = read0.blocks.map((b, i) => (i === 2 ? { ...b, text: `${b.text} Changed.` } : b));
    await setMatter(await currentRevisionId(), valid(edited));
    const read = await asOwner(() => loadArticle(SLUG));
    expect(read.matter).toBeUndefined();
  });

  it("withholds a value from an older safety rule even when its blocks still match", async () => {
    const read0 = await asOwner(() => loadArticle(SLUG));
    await setMatter(await currentRevisionId(), { ...valid(read0.blocks), version: "matter/1" });
    expect((await asOwner(() => loadArticle(SLUG))).matter).toBeUndefined();
  });

  it("withholds a malformed value and a backwards range even with the right hash", async () => {
    const read0 = await asOwner(() => loadArticle(SLUG));
    const blocks = read0.blocks;
    const id = await currentRevisionId();
    const backwards = { ...valid(blocks), stretches: [{ from: blocks[5]!.id, to: blocks[1]!.id, kinds: ["abstract"] }] };
    await setMatter(id, backwards);
    expect((await asOwner(() => loadArticle(SLUG))).matter).toBeUndefined();
    await setMatter(id, { status: "ok", sourceHash: matterInputHash(blocks), stretches: [] });
    expect((await asOwner(() => loadArticle(SLUG))).matter).toBeUndefined();
    await setMatter(id, { status: "unavailable", version: MATTER_PROMPT_VERSION, sourceHash: matterInputHash(blocks), reason: "step-failed" });
    expect((await asOwner(() => loadArticle(SLUG))).matter).toBeUndefined();
  });
});

describe("the publication queues the step", () => {
  /** A running job that has done `names`, owning a draft off the current revision. */
  async function draftUnderJob(names: StepName[]): Promise<{ job: { id: string; attemptId: string }; revisionId: string }> {
    const job = { id: mintId(), attemptId: mintAttempt() };
    const steps: JobStep[] = names.map((name) => ({ name, label: STEPS[name].label, status: "done" }));
    await getDb()
      .insert(jobs)
      .values({
        id: job.id,
        ownerId: DEV_OWNER_ID,
        slug: SLUG,
        steps,
        status: "running",
        attemptId: job.attemptId,
        leaseExpiresAt: new Date(Date.now() + 600_000),
        workKey: `matter-step-fixture-${job.id}`,
      });
    const begun = await asOwner(() => beginRevision({ slug: SLUG, job }));
    return { job, revisionId: begun.revisionId };
  }

  async function matterJobs(except: string) {
    const rows = await getDb()
      .select()
      .from(jobs)
      .where(and(eq(jobs.slug, SLUG), ne(jobs.id, except)));
    return rows.filter((j) => j.steps.length === 1 && j.steps[0]?.name === "matter");
  }

  it("queues it when the job cut the blocks and nothing stored is about them", async () => {
    await setMatter(await currentRevisionId(), null);
    const { job, revisionId } = await draftUnderJob(["extract", "blocks"]);
    const published = await asOwner(() => publishRevision({ slug: SLUG, revisionId, job }));
    expect(published.matterSuccessor?.kind).toBe("queued");
    const queued = await matterJobs(job.id);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe("queued");
    expect(queued[0]?.ingestEventId, "a successor must not charge").toBeNull();
  });

  it("does not queue it for a job that did not cut the blocks", async () => {
    await setMatter(await currentRevisionId(), null);
    const { job, revisionId } = await draftUnderJob(["arc"]);
    const published = await asOwner(() => publishRevision({ slug: SLUG, revisionId, job }));
    expect(published.matterSuccessor).toBeNull();
    expect(await matterJobs(job.id)).toEqual([]);
  });

  it("does not queue it when the stored value is already about these blocks", async () => {
    const read = await asOwner(() => loadArticle(SLUG));
    await setMatter(await currentRevisionId(), valid(read.blocks));
    const { job, revisionId } = await draftUnderJob(["extract", "blocks"]);
    const published = await asOwner(() => publishRevision({ slug: SLUG, revisionId, job }));
    expect(published.matterSuccessor).toBeNull();
    expect(await matterJobs(job.id)).toEqual([]);
  });

  it("queues it when the stored value is about these blocks but belongs to an older safety rule", async () => {
    const read = await asOwner(() => loadArticle(SLUG));
    await setMatter(await currentRevisionId(), { ...valid(read.blocks), version: "matter/1" });
    const { job, revisionId } = await draftUnderJob(["extract", "blocks"]);
    const published = await asOwner(() => publishRevision({ slug: SLUG, revisionId, job }));
    expect(published.matterSuccessor?.kind).toBe("queued");
    expect(await matterJobs(job.id)).toHaveLength(1);
  });
});
