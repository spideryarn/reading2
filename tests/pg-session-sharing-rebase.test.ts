/**
 * **Two mode jobs on one article, both published** — stage 1 of
 * docs/plans/260929c-modes-generate-in-parallel-on-one-article.md, end to end
 * through the real claim, the real session and the real publication.
 *
 * Mode jobs that make different columns now claim side by side on one article
 * (`mayOverlap`, src/sharing-steps.ts). Each still writes its own draft, copied
 * from the published revision when it was claimed, so the second to finish
 * finds the article has moved under it. Before this change `publishRevisionIn`
 * refused it — the paid work thrown away — and the queue's line existed to stop
 * that happening. Now the session carries the draft onto the new base first
 * (`rebaseSharingDraftIn`, src/store/pg-revisions.ts) when the data shows it is
 * safe, and refuses exactly as before when it is not.
 *
 * ## What is here
 *
 * 1. **The case the plan is for**: Quotes and Ideas claimed together, neither
 *    told `busy`, both finish, and the article ends up with both. The base
 *    both drafts were copied from was itself published by a real job, so its
 *    run rows carry a non-null `attempt_id` that the drafts' carried rows do
 *    not — the ordinary case a literal run-row comparison would refuse (GPT Sol
 *    F2).
 * 2. **Skim waits** while the Quotes it routes through are being made,
 *    and runs after.
 * 3. **The refusals**, each a publication by something other than a queue job
 *    landing under a live claim, because the queue rule makes them unreachable
 *    for queue jobs and the check is what makes the rebase safe against
 *    everything else (Sol F1): a column the job makes moved, a column it reads
 *    moved, a non-sharing step's run row moved, and a non-sharing column moved
 *    with every run row unchanged.
 * 4. **A positive control for 3**: the same outside publication changing only
 *    another mode's column is carried, not refused.
 *
 * Why a mode job newer than a queued exclusive job still waits is asked of the
 * store directly, in tests/store-jobs-parity.test.ts § mode jobs sharing an
 * article; the pure overlap rule is tests/sharing-steps.test.ts.
 *
 * ## Contention
 *
 * The same shape as tests/pg-session-exact-base.test.ts, which this copies:
 * this file's own owner and slug prefix, swept on the way in and out, and
 * tests/helpers/run-lock.ts because it claims jobs.
 */
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  jobs as jobsTable,
  revisionBlocks,
  revisionStepRuns,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId, mintUniqueId } from "../src/ids.js";
import { runAsOwner } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import type { ConvertedProduct, PipelineStep, StepContext } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { mintAttempt } from "../src/store/jobs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { openPgStoreSession } from "../src/store/pg-session.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/artifacts.js";
import type { ArtifactParts } from "../src/store/artifacts.js";
import type { StoreSession } from "../src/store/session.js";
import type { Arc, Block, JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { expectClaimed } from "./helpers/expect-claimed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = path.resolve(import.meta.dirname, "..");

/** This file's own person, and its own rubble pattern. */
const OWNER_STEM = "0000029c-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-pg-sharing-rebase-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

const LEASE_MS = 60_000;
/** Well above the two or three jobs a case runs; the cap is not under test. */
const CAP = 100;

/* ---------------------------------------------------- is there a database -- */

let runLock: HeldRunLock | undefined;

await pgReady({
  suite: "tests/pg-session-sharing-rebase.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
  ],
});

runLock = await takeRunLockAndSetUp("tests/pg-session-sharing-rebase.test.ts", async (lockClient) => {
  await lockClient.query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
  await lockClient.query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query(
    "update spideryarn.articles set current_revision_id = null where slug like $1",
    [SLUG_RUBBLE],
  );
  await lockClient.query("delete from spideryarn.articles where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("delete from auth.users where id::text like $1", [RUBBLE]);
  await seedAuthUser(lockClient, {
    id: OWNER,
    email: `pg-session-sharing-rebase-${OWNER}@example.invalid`,
  });
});

/* ------------------------------------------------------------- the fixture -- */

const MINTED = new Set<string>();
const db = () => getDb();

function block(id: string, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: `<p id="${id}">${text}</p>`,
    gistable: true,
  };
}

/** The smallest tree `checkTree` accepts — the publication gate runs the real one. */
function treeFor(slug: string, blocks: Block[]): Tree {
  const leaves = blocks.map((b, i) => [`n${i + 1}`, b] as const);
  return {
    version: "toc/1",
    generator: "fixture",
    slug,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: leaves.map(([id]) => id),
        range: [blocks[0]?.id ?? "", blocks[blocks.length - 1]?.id ?? ""],
        title: "A fixture article",
        gist: "A fixture built by tests/pg-session-sharing-rebase.test.ts and nothing else.",
      },
      ...Object.fromEntries(
        leaves.map(([id, b]) => [
          id,
          {
            id,
            depth: 1,
            parent: "n0",
            children: [],
            range: [b.id, b.id],
            title: "A paragraph",
            navLabel: "One paragraph of a fixture article that exists only for this test",
          },
        ]),
      ),
    },
  } as Tree;
}

function arcSaying(slug: string, blocks: Block[], text: string): Arc {
  return {
    version: "arc/1",
    generator: "fixture",
    slug,
    entries: [{ range: [blocks[0]?.id ?? "", blocks[blocks.length - 1]?.id ?? ""], text }],
  };
}

/* The artefacts, as small as the store's shape check accepts (`SHAPE`,
   src/store/artifacts.ts), each saying who wrote it — which is all these
   tests read back. */
const quotesSaying = (who: string) => ({ quotes: [{ id: "q1", text: who }] });
const ideasSaying = (who: string) => ({ ideas: [{ id: "i1", name: who }] });
const skimSaying = (who: string) => ({ stops: [{ quoteId: "q1", note: who }] });

const stepRun = (revisionId: string, name: StepName, inputHash = NO_INPUT_HASH) =>
  recordStepRun({
    revisionId,
    stepName: name,
    inputHash,
    implementationVersion: PIPELINE_RUN,
    promptVersion: null,
    model: null,
    status: "done",
    startedAt: new Date(),
    finishedAt: new Date(),
  });

interface Fixture {
  readonly slug: string;
  readonly blocks: Block[];
  /** Published by a real job, so its `arc` run row carries an `attempt_id`. */
  readonly base: string;
}

/**
 * R1 by hand, then **R_base by a real `arc` job** through claim, session and
 * commit — so the revision the mode jobs start from has a run row whose
 * `attempt_id` is set, which a draft copied from it does not inherit
 * (`STEP_RUN_CARRIED_COLUMNS`). That is Sol's realistic case for F2.
 */
async function articleFromARealJob(slug: string): Promise<Fixture> {
  const blocks = [
    block(mintUniqueId(MINTED), "The opening paragraph of a fixture that exists for one test."),
    block(mintUniqueId(MINTED), "The closing paragraph, which says nothing in particular."),
  ];
  const begun = await beginRevision({ slug });
  await db()
    .insert(blockIdentities)
    .values(blocks.map((b) => ({ articleId: begun.articleId, blockId: b.id })))
    .onConflictDoNothing();
  await db().insert(revisionBlocks).values(
    blocks.map((b, i) => ({
      articleId: begun.articleId,
      revisionId: begun.revisionId,
      blockId: b.id,
      ordinal: i,
      tag: b.tag,
      kind: b.kind,
      level: null,
      text: b.text,
      words: b.words,
      html: b.html,
      gistable: b.gistable,
      note: null,
    })),
  );
  await db()
    .update(articleRevisions)
    .set({
      title: "A fixture article",
      excerpt: "A fixture built by tests/pg-session-sharing-rebase.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-09-29T00:00:00.000Z"),
      stampedHtml: blocks.map((b) => b.html).join("\n"),
      tree: treeFor(slug, blocks),
      arc: arcSaying(slug, blocks, "the arc R1 published"),
    })
    .where(eq(articleRevisions.id, begun.revisionId));
  for (const name of ["fetch", "extract", "blocks"] as StepName[]) await stepRun(begun.revisionId, name);
  await stepRun(begun.revisionId, "structure", hashBlocks(blocks));
  await publishRevision({ slug, revisionId: begun.revisionId });

  const arcJob = await claimWithSession(slug, ["arc"]);
  await finish(arcJob, "arc", { arc: arcSaying(slug, blocks, "the arc a real job wrote") });
  const base = (await currentRevisionOf(slug)) as string;
  expect(base, "the arc job did not publish").not.toBe(begun.revisionId);
  expect(
    (await runRow(base, "arc"))?.attemptId,
    "the base's arc run row should carry the job's attempt — the case a literal comparison refuses",
  ).toBe(arcJob.attempt);
  return { slug, blocks, base };
}

/**
 * Somebody other than a queue job publishes, while a claim is live: a
 * standalone draft off the current revision with `change` applied to it.
 */
async function publishFromOutside(slug: string, change: (revisionId: string) => Promise<void>): Promise<string> {
  const begun = await beginRevision({ slug });
  await change(begun.revisionId);
  await publishRevision({ slug, revisionId: begun.revisionId });
  return begun.revisionId;
}

/* ------------------------------------------------------------- the steps -- */

/** A converted step that writes nothing itself — the store writes its parts. */
function fakeStep<S extends StepName>(name: S): PipelineStep<S> {
  return {
    name,
    label: STEPS[name].label,
    produces: [name],
    async run() {
      return { detail: "fixture" } as ConvertedProduct;
    },
  } as unknown as PipelineStep<S>;
}

/* ------------------------------------------------------------- the jobs -- */

function stepsOf(names: StepName[]): JobStep[] {
  return names.map((name) => ({ name, label: STEPS[name].label, status: "pending" as const }));
}

async function queueJob(slug: string, names: StepName[]): Promise<string> {
  const id = mintId();
  await db().insert(jobsTable).values({
    id,
    ownerId: OWNER,
    slug,
    steps: stepsOf(names),
    status: "queued",
    workKey: `pg-sharing-rebase-${id}`,
  });
  return id;
}

interface Claimed {
  readonly jobId: string;
  readonly attempt: string;
  readonly session: StoreSession;
  readonly steps: JobStep[];
}

/**
 * Claim a queued job **once**, and fail if it is refused — the point of most
 * cases here is that the claim is *not* told to wait.
 */
async function claimNow(slug: string, jobId: string): Promise<Claimed> {
  const attempt = mintAttempt();
  const job = expectClaimed(await pgJobStore.claim(jobId, OWNER, attempt, LEASE_MS, CAP), jobId);
  const session = await openPgStoreSession({ slug, job: { id: jobId, attemptId: attempt } });
  return { jobId, attempt, session, steps: job.steps };
}

/** Queue and claim, waiting out an unrelated line first (the fixture's own jobs). */
async function claimWithSession(slug: string, names: StepName[]): Promise<Claimed> {
  const jobId = await insertWhenSlotFree(slug, () => queueJob(slug, names));
  return claimNow(slug, jobId);
}

function contextFor(slug: string): StepContext {
  return { slug, report: () => {}, signal: new AbortController().signal, cacheArticle: false, power: "standard" };
}

/** Run the job's one step to a `done` ending — the last commit of a walk. */
async function finish(claimed: Claimed, step: StepName, parts: unknown) {
  const slug = (await jobSlug(claimed.jobId)) as string;
  await claimed.session.beginStep(slug, step);
  return claimed.session.commit(
    contextFor(slug),
    fakeStep(step),
    claimed.attempt,
    { detail: "fixture", parts: parts as ArtifactParts },
    {
      kind: "end",
      jobId: claimed.jobId,
      attempt: claimed.attempt,
      ending: { status: "done", steps: claimed.steps },
    },
  );
}

/* --------------------------------------------------------------- the reads -- */

async function jobSlug(jobId: string): Promise<string | null> {
  const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  return row?.slug ?? null;
}

async function jobRow(jobId: string) {
  const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  return row;
}

async function currentRevisionOf(slug: string): Promise<string | null> {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row?.currentRevisionId ?? null;
}

async function revision(id: string) {
  const [row] = await db().select().from(articleRevisions).where(eq(articleRevisions.id, id)).limit(1);
  return row;
}

async function runRow(revisionId: string, step: StepName) {
  const [row] = await db()
    .select()
    .from(revisionStepRuns)
    .where(and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, step)))
    .limit(1);
  return row;
}

const mine = (name: string, body: () => Promise<void>) => it(name, () => runAsOwner(OWNER, body));

/** A moved-base refusal, and only that one: the transient kind, in its own words. */
const REFUSED_AS_MOVED = {
  name: "PublishRefused",
  status: 409,
  reasons: [expect.stringMatching(/something else published while this draft was being written/)],
};

/* ------------------------------------------------------------------ tests -- */

describe("mode jobs sharing an article", () => {
  afterEach(async () => {
    await db()
      .delete(jobsTable)
      .where(and(eq(jobsTable.ownerId, OWNER), inArray(jobsTable.status, ["queued", "running"])));
  });

  afterAll(async () => {
    await cleanUpThenRelease(
      async () => {
        const database = getDb();
        await database.delete(jobsTable).where(eq(jobsTable.ownerId, OWNER));
        const ours = await database
          .select({ id: articles.id, slug: articles.slug })
          .from(articles)
          .where(eq(articles.ownerId, OWNER));
        for (const { id, slug } of ours) {
          await database.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
          await database.delete(articles).where(eq(articles.id, id));
          await rm(path.join(ROOT, "data", slug), { recursive: true, force: true });
        }
        await closeDb();
        await runLock?.client.query("delete from auth.users where id = $1", [OWNER]);
      },
      async () => {
        await runLock?.release();
      },
    );
  });

  /* ------------------------------------------------------------------ 1 -- */

  mine("claims Quotes and Ideas together, and publishes both", async () => {
    const slug = `${SLUG_PREFIX}both`;
    const { base } = await articleFromARealJob(slug);

    const quotesId = await queueJob(slug, ["quotes"]);
    const ideasId = await queueJob(slug, ["ideas"]);
    /* Neither is told to wait — `claimNow` fails on `busy`. */
    const quotes = await claimNow(slug, quotesId);
    const ideas = await claimNow(slug, ideasId);

    const quotesDraft = (await jobRow(quotesId))?.draftRevisionId as string;
    const ideasDraft = (await jobRow(ideasId))?.draftRevisionId as string;
    expect((await revision(quotesDraft))?.basedOnRevisionId).toBe(base);
    expect((await revision(ideasDraft))?.basedOnRevisionId).toBe(base);

    /* Quotes finishes first and publishes over its own base, as always. */
    expect((await finish(quotes, "quotes", { quotes: quotesSaying("the quotes job") })).kind).toBe("ended");
    const afterQuotes = await currentRevisionOf(slug);
    expect(afterQuotes).toBe(quotesDraft);

    /* Ideas finishes second, over a base that has moved. It must publish, not
       be refused. */
    expect((await finish(ideas, "ideas", { ideas: ideasSaying("the ideas job") })).kind).toBe("ended");

    const published = (await currentRevisionOf(slug)) as string;
    expect(published, "Ideas was published in its old draft, over Quotes").not.toBe(ideasDraft);
    expect(published).not.toBe(quotesDraft);
    const row = await revision(published);
    expect.soft(row?.basedOnRevisionId, "the rebased draft was not copied from Quotes' publication").toBe(
      afterQuotes,
    );
    expect.soft(row?.quotes, "Quotes' publication was buried").toEqual(quotesSaying("the quotes job"));
    expect.soft(row?.ideas, "Ideas' work was lost").toEqual(ideasSaying("the ideas job"));
    expect.soft((row?.arc as Arc | null)?.entries[0]?.text).toBe("the arc a real job wrote");

    /* The run rows travelled with the columns, the job's own claim included. */
    expect.soft((await runRow(published, "ideas"))?.status).toBe("done");
    expect.soft((await runRow(published, "ideas"))?.attemptId).toBe(ideas.attempt);
    expect.soft((await runRow(published, "quotes"))?.status).toBe("done");

    /* The draft Ideas ran in is abandoned, and both jobs are over and hold nothing. */
    expect((await revision(ideasDraft))?.status).toBe("failed");
    for (const id of [quotesId, ideasId]) {
      const job = await jobRow(id);
      expect(job?.status).toBe("done");
      expect(job?.draftRevisionId).toBeNull();
    }
  });

  /* ------------------------------------------------------------------ 2 -- */

  mine("keeps Skim waiting while its Quotes are being made, then runs it", async () => {
    const slug = `${SLUG_PREFIX}skim`;
    await articleFromARealJob(slug);

    const quotesId = await queueJob(slug, ["quotes"]);
    const skimId = await queueJob(slug, ["skim"]);
    const quotes = await claimNow(slug, quotesId);

    const waiting = await pgJobStore.claim(skimId, OWNER, mintAttempt(), LEASE_MS, CAP);
    expect(waiting.kind).toBe("busy");
    expect(waiting.kind === "busy" && waiting.why).toMatch(/ahead of it/);

    await finish(quotes, "quotes", { quotes: quotesSaying("the quotes job") });
    const skim = await claimNow(slug, skimId);
    expect((await finish(skim, "skim", { skim: skimSaying("the route") })).kind).toBe("ended");

    const row = await revision((await currentRevisionOf(slug)) as string);
    expect(row?.quotes).toEqual(quotesSaying("the quotes job"));
    expect(row?.skim).toEqual(skimSaying("the route"));
  });

  /* ------------------------------------------------------------------ 3 -- */

  mine("refuses when the column the job makes moved underneath it", async () => {
    const slug = `${SLUG_PREFIX}own-column`;
    await articleFromARealJob(slug);
    const quotes = await claimWithSession(slug, ["quotes"]);

    const outside = await publishFromOutside(slug, async (id) => {
      await db().update(articleRevisions).set({ quotes: quotesSaying("somebody else") as never }).where(
        eq(articleRevisions.id, id),
      );
    });

    await expect(finish(quotes, "quotes", { quotes: quotesSaying("the quotes job") })).rejects.toMatchObject(
      REFUSED_AS_MOVED,
    );
    expect(await currentRevisionOf(slug)).toBe(outside);
    expect((await revision(outside))?.quotes).toEqual(quotesSaying("somebody else"));
  });

  mine("refuses when a column the job reads moved underneath it", async () => {
    const slug = `${SLUG_PREFIX}read-column`;
    await articleFromARealJob(slug);
    const skim = await claimWithSession(slug, ["skim"]);

    const outside = await publishFromOutside(slug, async (id) => {
      await db().update(articleRevisions).set({ ideas: ideasSaying("new ideas") as never }).where(
        eq(articleRevisions.id, id),
      );
    });

    await expect(finish(skim, "skim", { skim: skimSaying("the route") })).rejects.toMatchObject(
      REFUSED_AS_MOVED,
    );
    expect(await currentRevisionOf(slug)).toBe(outside);
  });

  mine("refuses when a non-sharing step's run row moved, though no column did", async () => {
    const slug = `${SLUG_PREFIX}run-row`;
    await articleFromARealJob(slug);
    const quotes = await claimWithSession(slug, ["quotes"]);

    const outside = await publishFromOutside(slug, async (id) => {
      /* `extract` re-ran against something else — its row says so, and no
         column this test looks at moved. */
      await stepRun(id, "extract", "a-different-input");
    });

    await expect(finish(quotes, "quotes", { quotes: quotesSaying("the quotes job") })).rejects.toMatchObject(
      REFUSED_AS_MOVED,
    );
    expect(await currentRevisionOf(slug)).toBe(outside);
  });

  mine("refuses when a non-sharing column moved, though every run row is the same", async () => {
    const slug = `${SLUG_PREFIX}column`;
    await articleFromARealJob(slug);
    const quotes = await claimWithSession(slug, ["quotes"]);

    const outside = await publishFromOutside(slug, async (id) => {
      await db().update(articleRevisions).set({ publishedAt: "2026-01-01" }).where(eq(articleRevisions.id, id));
    });

    await expect(finish(quotes, "quotes", { quotes: quotesSaying("the quotes job") })).rejects.toMatchObject(
      REFUSED_AS_MOVED,
    );
    expect(await currentRevisionOf(slug)).toBe(outside);
    expect((await revision(outside))?.publishedAt).toBe("2026-01-01");
  });

  /* ------------------------------------------------------------------ 4 -- */

  /**
   * **The positive control for the four above.** A rebase that refused every
   * moved base would pass all of them; this one moves only another mode's
   * column, from outside the queue, and the job's work is carried onto it.
   */
  mine("carries the job onto an outside publication that changed only another mode's column", async () => {
    const slug = `${SLUG_PREFIX}other-column`;
    await articleFromARealJob(slug);
    const quotes = await claimWithSession(slug, ["quotes"]);

    const outside = await publishFromOutside(slug, async (id) => {
      await db().update(articleRevisions).set({ ideas: ideasSaying("somebody's ideas") as never }).where(
        eq(articleRevisions.id, id),
      );
    });

    expect((await finish(quotes, "quotes", { quotes: quotesSaying("the quotes job") })).kind).toBe("ended");
    const published = (await currentRevisionOf(slug)) as string;
    expect(published).not.toBe(outside);
    const row = await revision(published);
    expect(row?.basedOnRevisionId).toBe(outside);
    expect(row?.ideas).toEqual(ideasSaying("somebody's ideas"));
    expect(row?.quotes).toEqual(quotesSaying("the quotes job"));
  });
});
