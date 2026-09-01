/**
 * **A draft may only replace the revision it was copied from.**
 *
 * Stage 3 item 4 of docs/plans/260831b-finish-the-database-move.md — GPT Sol's
 * first review of that plan found it, and it was carried forward through five
 * more reviews without being built:
 *
 * > `beginDraftIn` copies whichever revision is current when the lazy draft is
 * > opened. `publishAndFinish` checks article identity but not that the draft
 * > was based on the revision bound for reads. Reads from R1 can therefore be
 * > overlaid onto a draft copied from R2.
 *
 * The shape of it, in the order it happens:
 *
 * 1. The job claims the article and its draft is copied from **R1**.
 * 2. The job runs for minutes — a model call, a fetch, a transcription.
 * 3. Something publishes **R2** in the meantime.
 * 4. The job finishes and publishes its draft. `publishRevisionIn` checks the
 *    revision's article, its status, its blocks and its tree, and **nothing
 *    anywhere asks what the draft was based on** — so the pointer moves back
 *    over R2 and R2's work is gone. Both the job and the publication report
 *    success (docs/reusable/silent-success.md).
 *
 * What can publish in step 3 is worth being exact about, because it decides how
 * likely this is rather than whether it is possible: `jobs_active_slug` allows
 * one active job per article, so it is not usually another job — it is
 * `npm run db:import`, a hand-run `publishRevision`, or the fixture loader. The
 * invariant is absent either way, which is what this file is about.
 *
 * ## What the guard is, and what it is not
 *
 * `refuseIfBaseMoved` (src/store/pg-session.ts) compares the base recorded when
 * the draft was opened against `articles.current_revision_id` read under the
 * article lock a statement before the publication moves it. A mismatch throws
 * `PublishRefused`, and the throw takes the publication, the step completion and
 * the job's ending back with it.
 *
 * It is exact for a draft this claim **minted**, and since 2026-09-01 it is
 * exact for one it **reopened** too — a job handed back between steps — because
 * the draft records what it was copied from in
 * `article_revisions.based_on_revision_id` (drizzle/0047) and the reopen reads
 * that column rather than asking the article what it is serving now. Cases 3 and
 * 4 below are the reopened pair, and case 3 is the race Sol's finding 1 named:
 * the old code recorded *the publication that landed in the gap* as the draft's
 * own base, so the guard compared a number with itself and let R1's copy bury
 * R2. See `DraftBase` in src/store/pg-session.ts.
 *
 * ## The two mutations, watched red on 2026-08-31
 *
 * Both by deleting the `refuseIfBaseMoved` call from `settleIn` in
 * src/store/pg-session.ts — the state before this work:
 *
 * ```
 * AssertionError: promise resolved "{ kind: 'ended', job: { …(8) }, …(1) }" instead of rejecting
 * ```
 *
 * That is the guard's absence. What it *costs* is behind it, and only visible
 * once the rejection assertion is let through — the three soft assertions after
 * it, watched red the same way:
 *
 * ```
 * AssertionError: the job's draft was published over R2:
 *   expected '26c2cb38-…' to be 'a5b7de78-…'
 * AssertionError: R2's work is gone:
 *   expected 'the arc the job wrote' to be 'the arc R2 published'
 * AssertionError: expected 'published' to be 'draft'
 * ```
 *
 * And the positive control below passed under the mutation as well as after the
 * fix, which is what says the guard refuses the race rather than refusing
 * publication.
 *
 * ## The reopened pair, watched red on 2026-09-01
 *
 * Case 3 against the code as it stood — the base read off
 * `articles.current_revision_id` at reopen:
 *
 * ```
 * AssertionError: promise resolved "{ kind: 'ended', job: { …(8) }, …(1) }" instead of rejecting
 * ```
 *
 * Case 4 passed then and passes now, which is the assertion that stops the cheap
 * fix: "reopened drafts fail closed" would satisfy case 3 and break every job of
 * more than one step, because all of them reopen their draft.
 *
 * And the lineage assertion in case 3 was watched red by deleting
 * `based_on_revision_id` from `beginDraftIn`'s insert — the carry-forward trap,
 * where a denylist puts artefacts in a draft nothing in this run wrote:
 *
 * ```
 * AssertionError: the draft does not record the revision it was copied from:
 *   expected null to be 'd8b1…'
 * ```
 *
 * ## Contention
 *
 * Same shared database as every other suite, so: this file's own owner and its
 * own slug prefix, both swept on the way in and out, and
 * tests/helpers/run-lock.ts because it claims a job. Copied from
 * tests/pg-session-real-step.test.ts, which set the pattern.
 */
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/* `SPIDERYARN_STORE=postgres` before a single import is evaluated — src/store/live.ts
   reads the flag once, at first import, and imports are hoisted above ordinary
   statements. The reasoning in full is in tests/store-pg-session.test.ts. */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const before = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return before;
});

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
import { STEPS, contextPaths } from "../src/pipeline.js";
import type { ConvertedProduct, PipelineStep, StepContext } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { mintAttempt } from "../src/store/jobs.js";
import { STORE } from "../src/store/live.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { openPgStoreSession } from "../src/store/pg-session.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/revisions.js";
import type { StoreSession } from "../src/store/session.js";
import type { Arc, Block, Job, JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { type HeldRunLock, takeRunLock } from "./helpers/run-lock.js";

/* Put the flag back straight away — vitest reuses a worker across files, and the
   modules above have already captured it. */
if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

loadEnvLocal();

/* Long, because claiming waits on a contended slot rather than failing on it. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = path.resolve(import.meta.dirname, "..");

/** This file's own person, and its own rubble pattern. See store-pg-session. */
const OWNER_STEM = "000000c5-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-pg-exact-base-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

const LEASE_MS = 60_000;

/** The three arcs, each naming who wrote it. The whole test is which survives. */
const ARC_R1 = "the arc R1 published";
const ARC_R2 = "the arc R2 published";
const ARC_JOB = "the arc the job wrote";

/* ---------------------------------------------------- is there a database -- */

let runLock: HeldRunLock | undefined;

const { reachable } = await pgReady({
  suite: "tests/pg-session-exact-base.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
  ],
});

if (reachable) {
  runLock = await takeRunLock("tests/pg-session-exact-base.test.ts");
  const lockClient = runLock.client;
  await lockClient.query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
  await lockClient.query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query(
    "update spideryarn.articles set current_revision_id = null where slug like $1",
    [SLUG_RUBBLE],
  );
  await lockClient.query("delete from spideryarn.articles where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("delete from auth.users where id::text like $1", [RUBBLE]);
  await lockClient.query(
    `insert into auth.users
       (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             $2, 'x', now(), now())`,
    [OWNER, `pg-session-exact-base-${OWNER}@example.invalid`],
  );
}

const when = reachable ? describe : describe.skip;

/* ------------------------------------------------------------- the fixture -- */

const MINTED = new Set<string>();

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
        gist: "A fixture built by tests/pg-session-exact-base.test.ts and nothing else.",
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
  readonly articleId: string;
  readonly publishedRevisionId: string;
  readonly blocks: Block[];
}

/** R1: a published article with an arc that says which revision wrote it. */
async function publishR1(slug: string): Promise<Fixture> {
  const blocks = [
    block(mintUniqueId(MINTED), "The opening paragraph of a fixture that exists for one test."),
    block(mintUniqueId(MINTED), "The closing paragraph, which says nothing in particular."),
  ];
  const db = getDb();
  const begun = await beginRevision({ slug });

  await db
    .insert(blockIdentities)
    .values(blocks.map((b) => ({ articleId: begun.articleId, blockId: b.id })))
    .onConflictDoNothing();
  await db.insert(revisionBlocks).values(
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

  await db
    .update(articleRevisions)
    .set({
      title: "A fixture article",
      excerpt: "A fixture built by tests/pg-session-exact-base.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-08-31T00:00:00.000Z"),
      stampedHtml: blocks.map((b) => b.html).join("\n"),
      tree: treeFor(slug, blocks),
      arc: arcSaying(slug, blocks, ARC_R1),
    })
    .where(eq(articleRevisions.id, begun.revisionId));

  for (const name of ["fetch", "extract", "blocks"] as StepName[]) {
    await stepRun(begun.revisionId, name);
  }
  /* The one run row that has to carry a real hash: the publication gate compares
     it with `hashBlocks` of the stored blocks and refuses when they differ. */
  await stepRun(begun.revisionId, "hierarchy", hashBlocks(blocks));
  await stepRun(begun.revisionId, "arc");

  await publishRevision({ slug, revisionId: begun.revisionId });

  return { slug, articleId: begun.articleId, publishedRevisionId: begun.revisionId, blocks };
}

/**
 * R2: somebody else's publication, landing while the job holds its draft.
 *
 * Through the real `beginRevision` and `publishRevision`, so the blocks, the
 * tree and the step runs are carried forward exactly as any other publication
 * carries them, and only the arc says who wrote it. That matters: R2 has to be a
 * revision the guard could plausibly refuse to bury, not a hand-made row.
 */
async function publishR2(fixture: Fixture): Promise<string> {
  const begun = await beginRevision({ slug: fixture.slug });
  await getDb()
    .update(articleRevisions)
    .set({ arc: arcSaying(fixture.slug, fixture.blocks, ARC_R2) })
    .where(eq(articleRevisions.id, begun.revisionId));
  await publishRevision({ slug: fixture.slug, revisionId: begun.revisionId });
  return begun.revisionId;
}

/* ------------------------------------------------------------- the fake step -- */

/**
 * A **converted** `arc` that writes nothing and returns the artefact.
 *
 * The same stand-in tests/store-pg-session.test.ts uses, and for the same
 * reason: a real stage here would be a paid model call to prove something about
 * the publication rather than about the stage.
 */
function fakeArc(): PipelineStep<"arc"> {
  return {
    name: "arc",
    label: "Reading the shape of the argument",
    outputs: (ctx) => [path.join(ctx.dir, "arc.json")],
    produces: ["arc"],
    async run() {
      return { detail: "one entry" } as ConvertedProduct;
    },
  };
}

/* ------------------------------------------------------------- the job row -- */

function stepsOf(names: StepName[]): JobStep[] {
  return names.map((name) => ({ name, label: STEPS[name].label, status: "pending" as const }));
}

async function queueJob(slug: string, names: StepName[]): Promise<string> {
  const db = getDb();
  return await insertWhenSlotFree(slug, async () => {
    const id = mintId();
    await db.insert(jobsTable).values({
      id,
      ownerId: OWNER,
      slug,
      steps: stepsOf(names),
      status: "queued",
      workKey: `pg-exact-base-${id}`,
    });
    return id;
  });
}

/** Claim it, waiting out anybody else who got there first. See store-pg-session. */
async function claimWhenSlotFree(id: string, attempt: string): Promise<Job> {
  for (let n = 1; n <= 40; n++) {
    const outcome = await pgJobStore.claim(id, OWNER, attempt, LEASE_MS, 4);
    if (outcome.kind === "claimed") return outcome.job;
    if (outcome.kind !== "busy") {
      throw new Error(`claiming ${id} answered ${outcome.kind}, which this fixture cannot use`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`could not claim ${id} in 20s: something else is running on this article`);
}

interface Claimed {
  readonly jobId: string;
  readonly attempt: string;
  readonly session: StoreSession;
  readonly steps: JobStep[];
}

/**
 * A claim with a session over its draft — and the draft is **minted here**,
 * inside `openPgStoreSession`, which is what makes the base exact.
 */
async function claimWithSession(slug: string, names: StepName[]): Promise<Claimed> {
  const jobId = await queueJob(slug, names);
  const attempt = mintAttempt();
  const job = await claimWhenSlotFree(jobId, attempt);
  const session = await openPgStoreSession({ slug, job: { id: jobId, attemptId: attempt } });
  return { jobId, attempt, session, steps: job.steps };
}

/**
 * The **second** claim on a job that already has a draft — the reopen.
 *
 * The shape a walk of more than one step always takes: request 1 mints the
 * draft and hands the claim back, request 2 claims again and
 * `openOrBeginJobDraft` finds the draft the job still points at.
 */
async function reopenWithSession(slug: string, jobId: string): Promise<Claimed> {
  const attempt = mintAttempt();
  const job = await claimWhenSlotFree(jobId, attempt);
  const session = await openPgStoreSession({ slug, job: { id: jobId, attemptId: attempt } });
  return { jobId, attempt, session, steps: job.steps };
}

/** The context `runStep` would have built. */
function contextFor(slug: string): StepContext {
  const { dir, htmlFile } = contextPaths(slug);
  return {
    slug,
    dir,
    htmlFile,
    report: () => {},
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/* --------------------------------------------------------------- the reads -- */

const db = () => getDb();

async function currentRevisionOf(slug: string): Promise<string | null> {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row?.currentRevisionId ?? null;
}

async function arcTextOf(revisionId: string): Promise<string | null> {
  const [row] = await db()
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, revisionId))
    .limit(1);
  return (row?.arc as Arc | null)?.entries[0]?.text ?? null;
}

async function runRow(revisionId: string, step: StepName) {
  const [row] = await db()
    .select()
    .from(revisionStepRuns)
    .where(and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, step)))
    .limit(1);
  return row;
}

/** What a revision says it was copied from — the column, not an inference. */
async function basedOnOf(revisionId: string): Promise<string | null> {
  const [row] = await db()
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, revisionId))
    .limit(1);
  return row?.basedOnRevisionId ?? null;
}

async function draftOf(jobId: string): Promise<string | null> {
  const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  return row?.draftRevisionId ?? null;
}

const mine = (name: string, body: () => Promise<void>) => it(name, () => runAsOwner(OWNER, body));

/* ------------------------------------------------------------------ tests -- */

when("publishing a draft whose base has moved", () => {
  afterEach(async () => {
    if (!reachable) return;
    await db()
      .delete(jobsTable)
      .where(and(eq(jobsTable.ownerId, OWNER), inArray(jobsTable.status, ["queued", "running"])));
  });

  afterAll(async () => {
    if (!reachable) return;
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
    if (runLock) {
      await runLock.client.query("delete from auth.users where id = $1", [OWNER]);
      await runLock.release();
    }
  });

  /* ------------------------------------------------------------------ 1 -- */

  /**
   * **The one this file exists for.** A publication lands between the draft
   * being copied and the job finishing, and the job must not bury it.
   */
  mine("refuses, and leaves the other publication serving the article", async () => {
    expect(STORE, "the vi.hoisted flag did not reach src/store/live.ts").toBe("postgres");

    const slug = `${SLUG_PREFIX}moved`;
    const fixture = await publishR1(slug);
    const claimed = await claimWithSession(slug, ["arc"]);
    const draft = await draftOf(claimed.jobId);

    /* The state the case rests on, asserted rather than assumed: the draft was
       minted from R1, and R1 is what the article serves. */
    expect(draft, "the claim did not open a draft").toBeTruthy();
    expect(await currentRevisionOf(slug)).toBe(fixture.publishedRevisionId);

    /* Step 3: somebody else publishes while the job holds its claim. */
    const r2 = await publishR2(fixture);
    expect(await currentRevisionOf(slug)).toBe(r2);

    await claimed.session.beginStep(slug, "arc");
    await expect(
      claimed.session.commit(
        contextFor(slug),
        fakeArc(),
        claimed.attempt,
        { detail: "one entry", parts: { arc: arcSaying(slug, fixture.blocks, ARC_JOB) } },
        {
          kind: "end",
          jobId: claimed.jobId,
          attempt: claimed.attempt,
          ending: { status: "done", steps: claimed.steps },
        },
      ),
      "the commit published a draft copied from a revision that is no longer current",
    ).rejects.toMatchObject({ name: "PublishRefused", status: 409 });

    /* **What the refusal is for.** R2 is still the article, and its arc is still
       R2's — these are the assertions that say what the missing guard costs.

       `soft`, so that one mutation shows both rather than only whichever comes
       first: "the pointer moved" and "the work is gone" are different facts and
       a fix could plausibly get one of them right. */
    expect
      .soft(await currentRevisionOf(slug), "the job's draft was published over R2")
      .toBe(r2);
    expect
      .soft(await arcTextOf(await currentRevisionOf(slug) as string), "R2's work is gone")
      .toBe(ARC_R2);

    /* And the whole transaction went back: the draft is still a draft, the job
       still holds it, and the step it began is `running` again for the failure
       settlement that follows. */
    const draftId = draft as string;
    const [row] = await db()
      .select()
      .from(articleRevisions)
      .where(eq(articleRevisions.id, draftId))
      .limit(1);
    expect(row?.status).toBe("draft");
    expect(await draftOf(claimed.jobId)).toBe(draftId);
    expect((await runRow(draftId, "arc"))?.status).toBe("running");
  });

  /* ------------------------------------------------------------------ 2 -- */

  /**
   * **The positive control, and it is not decoration.**
   *
   * A guard that refused every publication would pass case 1 and break every
   * ingest in the app. This is the same job with nothing published underneath
   * it: the draft's base is still current, so it publishes, and the arc the job
   * wrote is the arc the reader gets.
   */
  mine("publishes as usual when nothing moved underneath it", async () => {
    const slug = `${SLUG_PREFIX}unmoved`;
    const fixture = await publishR1(slug);
    const claimed = await claimWithSession(slug, ["arc"]);

    await claimed.session.beginStep(slug, "arc");
    const settled = await claimed.session.commit(
      contextFor(slug),
      fakeArc(),
      claimed.attempt,
      { detail: "one entry", parts: { arc: arcSaying(slug, fixture.blocks, ARC_JOB) } },
      {
        kind: "end",
        jobId: claimed.jobId,
        attempt: claimed.attempt,
        ending: { status: "done", steps: claimed.steps },
      },
    );

    expect(settled.kind).toBe("ended");
    const published = await currentRevisionOf(slug);
    expect(published).not.toBe(fixture.publishedRevisionId);
    expect(await arcTextOf(published as string)).toBe(ARC_JOB);
    expect(await draftOf(claimed.jobId)).toBeNull();
  });

  /* ------------------------------------------------------------------ 3 -- */

  /**
   * **The same race, one claim later — the reopened draft.**
   *
   * A walk is one HTTP request per step, so a job that runs two steps hands its
   * claim back in between and the *next* request reopens the draft it already
   * owns (`openOrBeginJobDraft`). Until 2026-09-01 the base for that draft was
   * `articles.current_revision_id` read at reopen, which is the very number the
   * publication is about to compare itself against — so a publication landing
   * in the gap was recorded as the draft's own lineage and the guard waved it
   * through. GPT Sol, finding 1 of
   * docs/plans/260831b-stage3-items3and4-review-sol.md.
   */
  mine("refuses a reopened draft whose base moved between the two claims", async () => {
    const slug = `${SLUG_PREFIX}reopened-moved`;
    const fixture = await publishR1(slug);

    /* 1. The first claim mints D from R1. */
    const first = await claimWithSession(slug, ["arc"]);
    const draftId = await draftOf(first.jobId);
    expect(draftId, "the first claim did not open a draft").toBeTruthy();

    /* **The lineage is on the row, and only this mint could have put it there.**
       `REVISION_CARRY_POLICY` is a denylist, so an artefact can appear in a
       draft without this run writing it — but not this value: R1 is the
       article's first revision and its own `based_on_revision_id` is null, so a
       carried column would read null here rather than R1. */
    expect(
      await basedOnOf(draftId as string),
      "the draft does not record the revision it was copied from",
    ).toBe(fixture.publishedRevisionId);

    /* 2. The claim is handed back with the draft still on the job — the
       ordinary end of a request in the middle of a walk, not a failure. */
    await pgJobStore.releaseStep(first.jobId, first.attempt, first.steps, {});
    expect(await draftOf(first.jobId), "releasing the claim let go of the draft").toBe(draftId);

    /* 3. R2 publishes while nobody holds the job. */
    const r2 = await publishR2(fixture);
    expect(await currentRevisionOf(slug)).toBe(r2);

    /* 4. The next claim reopens D. It is still the copy of R1. */
    const second = await reopenWithSession(slug, first.jobId);
    expect(
      await draftOf(first.jobId),
      "the second claim minted a fresh draft instead of reopening this job's own",
    ).toBe(draftId);

    await second.session.beginStep(slug, "arc");
    await expect(
      second.session.commit(
        contextFor(slug),
        fakeArc(),
        second.attempt,
        { detail: "one entry", parts: { arc: arcSaying(slug, fixture.blocks, ARC_JOB) } },
        {
          kind: "end",
          jobId: second.jobId,
          attempt: second.attempt,
          ending: { status: "done", steps: second.steps },
        },
      ),
      "a reopened draft copied from R1 published over R2",
    ).rejects.toMatchObject({ name: "PublishRefused", status: 409 });

    /* What the refusal is for, in the same two soft assertions case 1 uses. */
    expect.soft(await currentRevisionOf(slug), "the job's draft was published over R2").toBe(r2);
    expect
      .soft(await arcTextOf((await currentRevisionOf(slug)) as string), "R2's work is gone")
      .toBe(ARC_R2);

    const [row] = await db()
      .select()
      .from(articleRevisions)
      .where(eq(articleRevisions.id, draftId as string))
      .limit(1);
    expect(row?.status).toBe("draft");
    expect(await draftOf(first.jobId)).toBe(draftId);
  });

  /* ------------------------------------------------------------------ 4 -- */

  /**
   * **The positive control for the reopened case, and it is the one that stops
   * the cheap fix.**
   *
   * "Reopened drafts fail closed" would pass case 3 and break every ingest in
   * the app, because *every* job of more than one step reopens its draft. This
   * is the same sequence with nothing published in the gap: the draft still
   * knows it was copied from R1, R1 is still what the article serves, and it
   * publishes.
   */
  mine("publishes a reopened draft when nothing moved underneath it", async () => {
    const slug = `${SLUG_PREFIX}reopened-unmoved`;
    const fixture = await publishR1(slug);

    const first = await claimWithSession(slug, ["arc"]);
    const draftId = await draftOf(first.jobId);
    await pgJobStore.releaseStep(first.jobId, first.attempt, first.steps, {});

    const second = await reopenWithSession(slug, first.jobId);
    expect(await draftOf(first.jobId)).toBe(draftId);
    expect(
      await basedOnOf(draftId as string),
      "the reopened draft lost the lineage its mint recorded",
    ).toBe(fixture.publishedRevisionId);

    await second.session.beginStep(slug, "arc");
    const settled = await second.session.commit(
      contextFor(slug),
      fakeArc(),
      second.attempt,
      { detail: "one entry", parts: { arc: arcSaying(slug, fixture.blocks, ARC_JOB) } },
      {
        kind: "end",
        jobId: second.jobId,
        attempt: second.attempt,
        ending: { status: "done", steps: second.steps },
      },
    );

    expect(settled.kind).toBe("ended");
    expect(await currentRevisionOf(slug), "the reopened draft is what got published").toBe(draftId);
    expect(await arcTextOf(draftId as string)).toBe(ARC_JOB);
    expect(await draftOf(first.jobId)).toBeNull();
  });
});
