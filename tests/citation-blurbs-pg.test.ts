/**
 * **The notes on cited works, in Postgres: what queues them, and what two real
 * jobs in a row do** — plan 261017h stage 3b
 * (docs/plans/261017h-stage-3-design-citation-blurbs.md § 7 item 9, and the
 * design review's G1, G2 and G3).
 *
 * 1. **The trigger** (item 9): a publication whose job ran `bibliography`, with
 *    a list in the draft, queues exactly one `citation-blurbs` job; the notes
 *    job's own publication queues none (no loop); a publication with no list,
 *    or whose job did not make one, queues none.
 * 2. **A holder bound to an older base** (G3): the queue answers
 *    `boundToOlderBase`, and a replacement scoped to this revision is queued
 *    beside it, so the new list is not left with nothing coming.
 * 3. **Two real jobs, the first partial** (G1, G2): `advanceJobWith`, the
 *    real claim, session, step and publication, with the registries and the
 *    model faked. A registry busy for one work leaves the artefact stamped
 *    `:partial`; the next unforced job is not "done", asks only that work, and
 *    stamps it whole; a third skips with no call.
 *
 * Its own owner and slug prefix, swept on the way in and out, under the run
 * lock because the cases claim jobs.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { LookupResult } from "../src/bibliographic.js";
import { citationBlurbsInputHash } from "../src/citation-blurbs-identity.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { runAsOwner } from "../src/owner.js";
import { citationBlurbsStep, STEPS } from "../src/pipeline.js";
import { mintAttempt, workKeyFor } from "../src/store/jobs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { beginRevision, publishRevision } from "../src/store/pg-revisions.js";
import type { CitationBlurbs, Job, JobStep, OwnerId, StepName } from "../src/types.js";
import { bibliography, cited, fakeModel, registries, WORKS } from "./helpers/citation-blurbs-fakes.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import { pgReady } from "./helpers/pg-ready.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const OWNER_STEM = "0000b1a5-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;
const SLUG_PREFIX = "test-cite-blurbs-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

await pgReady({
  suite: "tests/citation-blurbs-pg.test.ts",
  tables: ["spideryarn.jobs", "spideryarn.articles", "spideryarn.article_revisions", "spideryarn.revision_step_runs"],
  columns: [{ table: "spideryarn.article_revisions", column: "citation_blurbs" }],
});

const runLock: HeldRunLock = await takeRunLockAndSetUp("tests/citation-blurbs-pg.test.ts", async (lockClient) => {
  await lockClient.query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
  await lockClient.query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("update spideryarn.articles set current_revision_id = null where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("delete from spideryarn.articles where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("delete from auth.users where id::text like $1", [RUBBLE]);
  await seedAuthUser(lockClient, { id: OWNER, email: `cite-blurbs-${OWNER}@example.invalid` });
});

/* Imported after the lock, as the harness this copies does: src/jobs.ts takes
   the job store at module scope. */
const { advanceJobWith, claimSession, REQUEUE_BUDGET } = await import("../src/jobs.js");
type AdvanceParts = Parameters<typeof advanceJobWith>[1];

const db = () => getDb();
const SEEDED: ScratchArticle[] = [];
const BLURBS_KEY = workKeyFor(["citation-blurbs"], new Set());

afterAll(async () => {
  await cleanUpThenRelease(
    async () => {
      for (const article of SEEDED) await article.remove().catch(() => {});
      await db().delete(jobsTable).where(eq(jobsTable.ownerId, OWNER));
      const ours = await db().select({ id: articles.id }).from(articles).where(eq(articles.ownerId, OWNER));
      for (const { id } of ours) {
        await db().update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
        await db().delete(articles).where(eq(articles.id, id));
      }
      await closeDb();
      await runLock.client.query("delete from auth.users where id = $1", [OWNER]);
    },
    () => runLock.release(),
  );
});

/* ------------------------------------------------------------- fixtures -- */

const LIST = bibliography([cited("a"), cited("b")]);

/** An article on the shelf, from the corpus, with `LIST` as its Bibliography. */
async function articleWithAList(slug: string): Promise<ScratchArticle> {
  const article = await scratchArticleInPg(slug, {
    ownerId: OWNER,
    mutate: async (dir) => {
      await writeFile(path.join(dir, "citations.json"), JSON.stringify({ ...LIST, slug }));
    },
  });
  SEEDED.push(article);
  return article;
}

async function currentRevisionOf(slug: string): Promise<string> {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  if (!row?.currentRevisionId) throw new Error(`${slug} serves nothing`);
  return row.currentRevisionId;
}

/** A running job, as the fence needs to find it, naming `steps`. */
async function runningJob(slug: string, steps: StepName[]) {
  const running = { id: mintId(), attemptId: mintAttempt() };
  await db()
    .insert(jobsTable)
    .values({
      id: running.id,
      ownerId: OWNER,
      slug,
      steps: steps.map((name) => ({ name, label: STEPS[name].label, status: "pending" as const })),
      status: "running",
      attemptId: running.attemptId,
      leaseExpiresAt: new Date(Date.now() + 600_000),
      workKey: `cite-blurbs-fixture-${running.id}`,
      reservesName: false,
    });
  return running;
}

/** Publish a fresh draft of `slug` under a job naming `steps`, as a pipeline's last commit does. */
async function publishUnder(slug: string, steps: StepName[], change?: (revisionId: string) => Promise<void>) {
  const draft = await beginRevision({ slug });
  if (change) await change(draft.revisionId);
  const job = await runningJob(slug, steps);
  const published = await runAsOwner(OWNER, () => publishRevision({ slug, revisionId: draft.revisionId, job }));
  await db().update(jobsTable).set({ status: "done", attemptId: null, leaseExpiresAt: null }).where(eq(jobsTable.id, job.id));
  return { published, job, draft };
}

/** The queued notes jobs on `slug`. */
async function blurbJobs(slug: string) {
  const rows = await db()
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.slug, slug))
    .orderBy(asc(jobsTable.createdAt), asc(jobsTable.id));
  return rows.filter((row) => row.status === "queued" && row.steps.some((s: JobStep) => s.name === "citation-blurbs"));
}

/* ------------------------------------------------------- 1: the trigger -- */

describe("a publication that made a Bibliography queues the notes (item 9)", () => {
  it("queues exactly one free `citation-blurbs` job", () =>
    runAsOwner(OWNER, async () => {
      const slug = `${SLUG_PREFIX}made-${randomUUID().slice(0, 6)}`;
      await articleWithAList(slug);
      const { published } = await publishUnder(slug, ["bibliography"]);
      const queued = await blurbJobs(slug);
      expect(queued.map((row) => row.steps.map((s: JobStep) => s.name))).toEqual([["citation-blurbs"]]);
      expect(queued[0]?.workKey).toBe(BLURBS_KEY);
      expect(queued[0]?.ingestEventId, "a successor must spend no quota").toBeNull();
      expect(published.citationBlurbs).toEqual([{ kind: "queued", jobId: queued[0]?.id }]);
    }));

  it("queues none from the notes job's own publication, so nothing loops", () =>
    runAsOwner(OWNER, async () => {
      const slug = `${SLUG_PREFIX}own-${randomUUID().slice(0, 6)}`;
      await articleWithAList(slug);
      const { published } = await publishUnder(slug, ["citation-blurbs"]);
      expect(published.citationBlurbs).toEqual([]);
      expect(await blurbJobs(slug)).toEqual([]);
      /* And a job that made both has made the notes already. */
      const both = await publishUnder(slug, ["bibliography", "citation-blurbs"]);
      expect(both.published.citationBlurbs).toEqual([]);
    }));

  it("queues none when the draft holds no list, or the job did not make one", () =>
    runAsOwner(OWNER, async () => {
      const slug = `${SLUG_PREFIX}none-${randomUUID().slice(0, 6)}`;
      await articleWithAList(slug);
      const other = await publishUnder(slug, ["tweets"]);
      expect(other.published.citationBlurbs).toEqual([]);
      const emptied = await publishUnder(slug, ["bibliography"], async (revisionId) => {
        await db().update(articleRevisions).set({ bibliography: null }).where(eq(articleRevisions.id, revisionId));
      });
      expect(emptied.published.citationBlurbs).toEqual([]);
      expect(await blurbJobs(slug)).toEqual([]);
    }));
});

/* --------------------------------------------- 2: a holder on an older base -- */

describe("a notes job bound to an older base (G3)", () => {
  it("is reported, and a replacement scoped to this revision is queued", () =>
    runAsOwner(OWNER, async () => {
      const slug = `${SLUG_PREFIX}older-${randomUUID().slice(0, 6)}`;
      await articleWithAList(slug);
      /* A notes job that claimed, opened a draft of today's revision and was
         handed back keeping it. */
      const held = await beginRevision({ slug });
      const holderId = mintId();
      await db()
        .insert(jobsTable)
        .values({
          id: holderId,
          ownerId: OWNER,
          slug,
          steps: [{ name: "citation-blurbs", label: STEPS["citation-blurbs"].label, status: "pending" }],
          status: "queued",
          workKey: BLURBS_KEY,
          reservesName: false,
          draftRevisionId: held.revisionId,
        });

      const { published } = await publishUnder(slug, ["bibliography"]);

      const [first, replacement] = published.citationBlurbs;
      expect(first).toEqual({ kind: "boundToOlderBase", jobId: holderId });
      expect(replacement?.kind).toBe("queued");
      const queued = await blurbJobs(slug);
      expect(queued.map((row) => row.id).sort()).toEqual([holderId, replacement?.jobId].sort());
      const fresh = queued.find((row) => row.id === replacement?.jobId);
      expect(fresh?.workKey, "the replacement collapsed onto the old holder's key").not.toBe(BLURBS_KEY);
      expect(fresh?.draftRevisionId).toBeNull();
    }));
});

/* ------------------------------------------- 3: two real jobs, then a third -- */

/** Advance until the job is over, the way the pump would. Bounded. */
async function walkToTheEnd(id: string, parts: AdvanceParts): Promise<Job> {
  for (let n = 0; n < 2 + REQUEUE_BUDGET * 2; n++) {
    await runAsOwner(OWNER, () => advanceJobWith(id, parts));
    const [row] = await db().select({ status: jobsTable.status }).from(jobsTable).where(eq(jobsTable.id, id));
    if (row && row.status !== "queued" && row.status !== "running") break;
  }
  const job = await runAsOwner(OWNER, () => pgJobStore.get(id, OWNER));
  if (!job) throw new Error("the job has gone");
  return job;
}

/** One unforced `citation-blurbs` job, run to its end with these registries. */
async function runNotesJob(slug: string, lookups: Partial<Record<string, LookupResult>>) {
  const reg = registries(lookups);
  const model = fakeModel(WORKS);
  /* The real clock: the claim's deadline is `Date.now()`'s, and the fakes'
     fixed morning would be past it, so every call would be over the deadline. */
  reg.d.now = Date.now;
  model.deps.now = Date.now;
  const parts: AdvanceParts = {
    power: async () => "standard",
    session: (job: Job, attempt: string) => claimSession(job, attempt),
    steps: {
      ...STEPS,
      "citation-blurbs": citationBlurbsStep(async () => ({ evidence: reg.d, model: model.deps })),
    } as AdvanceParts["steps"],
  };
  const wanted: Job = {
    id: mintId(),
    ownerId: OWNER,
    slug,
    steps: [{ name: "citation-blurbs", label: STEPS["citation-blurbs"].label, status: "pending" }],
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await runAsOwner(OWNER, () =>
    pgJobStore.enqueueOrGet(wanted, { workKey: `cite-blurbs-run-${wanted.id}`, reservesName: false }),
  );
  const ended = await walkToTheEnd(job.id, parts);
  const [row] = await db()
    .select({ blurbs: articleRevisions.citationBlurbs })
    .from(articleRevisions)
    .where(eq(articleRevisions.id, await currentRevisionOf(slug)));
  return { ended, asked: reg.asked, model, blurbs: (row?.blurbs ?? null) as CitationBlurbs | null };
}

describe("two real jobs, the first partial (G1, G2)", () => {
  it("leaves the first partial, completes on the second, and skips the third with no call", async () => {
    const slug = `${SLUG_PREFIX}jobs-${randomUUID().slice(0, 6)}`;
    await articleWithAList(slug);
    const whole = citationBlurbsInputHash(LIST.citations);

    const busy = { "doi:10.1234/b": { kind: "unavailable", why: "cooling-down" } as LookupResult };
    const first = await runNotesJob(slug, busy);
    expect(first.ended.status, first.ended.error).toBe("done");
    expect(first.ended.steps[0]?.status).toBe("done");
    expect(first.blurbs?.sourceHash, JSON.stringify(first.blurbs?.counts)).toBe(`${whole}:partial`);
    expect(first.blurbs?.entries.a?.state).toBe("blurb");
    expect(first.blurbs?.entries.b).toBeUndefined();

    const second = await runNotesJob(slug, {});
    expect(second.ended.steps[0]?.status, "a partial run must not read as done").toBe("done");
    expect(second.asked).toEqual(["doi:10.1234/b"]);
    expect(second.blurbs?.sourceHash).toBe(whole);
    expect(second.blurbs?.entries.b?.state).toBe("blurb");
    expect(second.blurbs?.entries.a).toEqual(first.blurbs?.entries.a);

    const third = await runNotesJob(slug, {});
    expect(third.ended.steps[0]?.status, "a finished run must read as done (G1)").toBe("skipped");
    expect(third.asked).toEqual([]);
    expect(third.model.writes).toHaveLength(0);
    expect(third.model.checks).toHaveLength(0);
  });
});
