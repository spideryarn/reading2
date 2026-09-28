/**
 * **Reset an article, and optionally make its extras again** — stage 1 of
 * docs/plans/260928a-reset-and-regenerate-article.md, asserted through the real
 * claim, the real session, the real draft and the real publication.
 *
 * ## What a reset promises
 *
 * 1. The published revision it produces has **none of the extras** — every
 *    column `RESET_ROLE` calls `extra` is null, and so is every one of those
 *    steps' `revision_step_runs` rows — while **the revision it replaced still
 *    has them all**. Dropped in the draft, never deleted from what was there.
 * 2. **The reader's own data survives**: comments and reading time on a
 *    paragraph whose text did not change keep pointing at a block the new
 *    revision has, under the same id.
 * 3. With `regenerate`, **exactly the extras the article had** are made again,
 *    in `STEP_ORDER` — and **nothing is queued until the reset publishes**. A
 *    reset that fails queues nothing.
 * 4. Each regeneration is the reset's own, even when an identical job is
 *    already queued, or active and holding a draft on the old base (Sol F1).
 * 5. `sketch` claims before `illustrated` whatever their ids (Sol F6).
 * 6. A reset is never collapsed onto a plain re-read that looks the same.
 * 7. Somebody else's slug is a 404 and queues nothing; a retry still resets.
 *
 * ## What is faked, and why that costs no claim
 *
 * `fetch` reaches the network, and `extract`-on-a-PDF and `hierarchy` are paid
 * model calls, so those three and `assets` (which fetches images) are fakes
 * over the real registry, the way tests/labels-land-after-the-shelf.test.ts
 * does it. **`blocks` is the real step**, because it is the one that keeps a
 * paragraph's id across a re-extraction (`previousBlocksFrom`,
 * docs/project/block-ids.md) — the claim in (2). The fake `extract` hands it a
 * document with one paragraph more than the first read found, so the case can
 * see the old ids kept *and* the re-read really having produced new blocks.
 *
 * ## Contention
 *
 * One shared local Postgres: this file's own owner and slug prefix, swept on
 * the way in and out, and tests/helpers/run-lock.ts because it claims.
 *
 * ## Watched red
 *
 * Written before the code, each case watched failing for its own reason; then
 * the two mutations the plan names, recorded beside the cases they turn red.
 */
import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Assets } from "../src/assets.js";
import { blocksArtefact, runBlocks } from "../src/blocks.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  comments as commentsTable,
  jobs as jobsTable,
  rawSources,
  readingTime,
  revisionBlocks,
  revisionStepRuns,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { buildTree, type ModelNode } from "../src/hierarchy.js";
import { mintId } from "../src/ids.js";
import {
  advanceJobWith,
  enqueue,
  enqueueReset,
  retryJob,
  type AdvanceParts,
  type StepRegistry,
} from "../src/jobs.js";
import { mergeLabels, type PendingLabelsFile } from "../src/labels.js";
import { runAsOwner } from "../src/owner.js";
import { DEFAULT_INGEST_STEPS, STEPS, type PipelineStep } from "../src/pipeline.js";
import { RESET_ROLE, extraColumns, extraSteps } from "../src/reset.js";
import { hashBlocks, structureHash } from "../src/source-hash.js";
import { STEP_ORDER } from "../src/step-order.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/artifacts.js";
import { workKeyFor } from "../src/store/jobs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { openPgStoreSession } from "../src/store/pg-session.js";
import type { Block, Job, JobStep, OwnerId, StepName } from "../src/types.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import { pgReady } from "./helpers/pg-ready.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* Long, because claiming waits on a contended slot rather than failing on it. */
vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const OWNER_STEM = "000000e3-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
/** Somebody who owns none of this file's articles. Seeded, because `jobs.owner_id` has an FK. */
const STRANGER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-reset-regenerate-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

const PROFILE = "About the reader: a physicist who reads for the argument.";

/* ---------------------------------------------------- is there a database -- */

let runLock: HeldRunLock | undefined;

await pgReady({
  suite: "tests/reset-and-regenerate.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
    "spideryarn.comments",
    "spideryarn.reading_time",
  ],
  columns: [{ table: "spideryarn.jobs", column: "reset" }],
});

runLock = await takeRunLockAndSetUp("tests/reset-and-regenerate.test.ts", async (lockClient) => {
  await lockClient.query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
  await lockClient.query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query(
    "update spideryarn.articles set current_revision_id = null where slug like $1",
    [SLUG_RUBBLE],
  );
  await lockClient.query("delete from spideryarn.articles where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("delete from auth.users where id::text like $1", [RUBBLE]);
  for (const id of [OWNER, STRANGER]) {
    await seedAuthUser(lockClient, { id, email: `reset-regenerate-${id}@example.invalid` });
  }
});

/* ------------------------------------------------------------- the fixture -- */

const PARAGRAPHS = [
  "The opening paragraph of a fixture that exists to prove a reset keeps what it should.",
  "A middle paragraph a reader has commented on, whose text the re-read does not change.",
  "The closing paragraph, which says nothing in particular and says it briefly.",
];
/** What the re-read finds that the first read did not: a paragraph with no id yet. */
const ADDED = "A paragraph the re-read finds that the first read missed, so it gets a new id.";

const htmlOf = (paragraphs: string[]) =>
  ["<h1>A fixture article</h1>", ...paragraphs.map((p) => `<p>${p}</p>`)].join("\n");

const EXTRACTED_HTML = htmlOf(PARAGRAPHS);
const RE_EXTRACTED_HTML = htmlOf([...PARAGRAPHS, ADDED]);

function rootOver(blocks: Block[]): ModelNode {
  return {
    title: "A fixture article",
    gist: "A fixture built by tests/reset-and-regenerate.test.ts and nothing else.",
    range: [blocks[0]?.id ?? "", blocks[blocks.length - 1]?.id ?? ""],
    children: [],
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

/**
 * A stand-in artefact for an extra. **Nothing reads its shape** — the reset
 * reads only whether the column is null — so a marker is all it needs to be,
 * and a distinct one per step lets a case see which survived where.
 */
const marker = (step: StepName) => ({ fixture: `the ${step} this article had before the reset` });

interface Fixture {
  readonly slug: string;
  readonly articleId: string;
  readonly revisionId: string;
  readonly blocks: Block[];
}

/**
 * A published article carrying the named extras — each as a non-null column
 * **and** a `done` run row, which is what "has it" means to `hasArtefacts`.
 */
async function publishWithExtras(slug: string, extras: StepName[]): Promise<Fixture> {
  const seeded = runBlocks({ slug, extractedHtml: EXTRACTED_HTML, previous: undefined });
  const blocks = blocksArtefact(seeded.blocks).blocks;
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
      level: b.level ?? null,
      text: b.text,
      words: b.words,
      html: b.html,
      gistable: b.gistable,
      note: null,
    })),
  );

  /* **A stored document, as far as `fetch`'s skip check can see.** The reset
     re-reads the copy we have; `fetch` is done, and the fake below throws if it
     is ever asked to run. The `raw_sources` row is what the revision's pointer
     has to name; no bytes are needed, because `extract` is a fake too. */
  const sha = createHash("sha256").update(`${slug}-${randomUUID()}`).digest("hex");
  await db.insert(rawSources).values({
    sha256: sha,
    kind: "html",
    bytes: EXTRACTED_HTML.length,
    contentType: "text/html",
    verifiedAt: new Date(),
  });

  const columns = Object.fromEntries(
    extraColumns()
      .filter(({ step }) => extras.includes(step))
      .map(({ step, column }) => [column, marker(step)]),
  );
  await db
    .update(articleRevisions)
    .set({
      title: "A fixture article",
      excerpt: "A fixture built by tests/reset-and-regenerate.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-09-28T00:00:00.000Z"),
      extractedHtml: EXTRACTED_HTML,
      stampedHtml: seeded.html,
      tree: mergeLabels(buildTree(rootOver(blocks), {}, blocks, slug), {}),
      navLabelStatus: "ready",
      requestedUrl: `https://example.com/${slug}`,
      rawContentType: "text/html",
      rawEncoding: "utf-8",
      rawByteCount: EXTRACTED_HTML.length,
      rawSourceSha256: sha,
      rawSourceKind: "html",
      ...columns,
    })
    .where(eq(articleRevisions.id, begun.revisionId));

  for (const name of ["fetch", "extract"] as StepName[]) await stepRun(begun.revisionId, name);
  await stepRun(begun.revisionId, "blocks", hashBlocks(blocks));
  await stepRun(begun.revisionId, "hierarchy", hashBlocks(blocks));
  for (const name of extras) await stepRun(begun.revisionId, name, hashBlocks(blocks));

  await publishRevision({ slug, revisionId: begun.revisionId });
  return { slug, articleId: begun.articleId, revisionId: begun.revisionId, blocks };
}

/* -------------------------------------------------------------- the steps -- */

interface Calls {
  fetch: number;
  extract: number;
}

/** Refuses outright: a reset re-reads the copy we stored and never fetches. */
function fakeFetch(calls: Calls): PipelineStep<"fetch"> {
  return {
    name: "fetch",
    label: STEPS.fetch.label,
    produces: ["raw"],
    async run() {
      calls.fetch += 1;
      throw new Error("the reset fetched the page again");
    },
  };
}

/** The stored document read again — with one paragraph more than last time. */
function fakeExtract(calls: Calls): PipelineStep<"extract"> {
  return {
    name: "extract",
    label: STEPS.extract.label,
    produces: ["extractedHtml"],
    async run() {
      calls.extract += 1;
      return { parts: { extractedHtml: RE_EXTRACTED_HTML }, detail: "re-read" };
    },
  };
}

/** `hierarchy` without the model call — tests/labels-land-after-the-shelf.test.ts's fake. */
function fakeHierarchy(fail = false): PipelineStep<"hierarchy"> {
  return {
    name: "hierarchy",
    label: STEPS.hierarchy.label,
    produces: ["tree", "labels", "blocks"],
    async run(ctx, store) {
      if (fail) throw new Error("the fixture's hierarchy gave up on purpose");
      const file = await store.read(ctx.slug, "blocks", "blocks");
      if (!file?.blocks) throw new Error(`no blocks for ${ctx.slug}`);
      const structure = mergeLabels(buildTree(rootOver(file.blocks), {}, file.blocks, ctx.slug), {});
      const labels: PendingLabelsFile = {
        slug: ctx.slug,
        sourceHash: hashBlocks(file.blocks),
        structureHash: structureHash(structure),
        structureVersion: structure.version,
        labels: {},
        batches: null,
      };
      return {
        parts: { tree: structure, labels, blocks: blocksArtefact(file.blocks) },
        stamp: { inputHash: labels.sourceHash },
        detail: "1 section",
      };
    },
  };
}

/** No pictures in the fixture, and no publisher to fetch them from. */
function fakeAssets(): PipelineStep<"assets"> {
  return {
    name: "assets",
    label: STEPS.assets.label,
    produces: ["assets"],
    async run() {
      const assets: Assets = {
        version: "assets/2",
        sourceHash: "a fixture with no figures",
        fetchedAt: new Date().toISOString(),
        entries: [],
      };
      return { parts: { assets }, detail: "no figures" };
    },
  };
}

function partsFor(calls: Calls, opts: { failHierarchy?: boolean } = {}): AdvanceParts {
  const steps: StepRegistry = {
    ...STEPS,
    fetch: fakeFetch(calls),
    extract: fakeExtract(calls),
    hierarchy: fakeHierarchy(opts.failHierarchy),
    assets: fakeAssets(),
  };
  return {
    session: (job, attempt) =>
      openPgStoreSession({ slug: job.slug, job: { id: job.id, attemptId: attempt } }),
    steps,
  };
}

/** Drive one job to its end, waiting out a contended slot. */
async function drive(id: string, parts: AdvanceParts) {
  for (let n = 1; n <= 80; n++) {
    const advanced = await advanceJobWith(id, parts);
    if (advanced?.done) return advanced;
    if (advanced?.busy) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`job ${id} did not finish in 80 advances`);
}

/* --------------------------------------------------------------- the reads -- */

const db = () => getDb();

async function currentRevisionOf(slug: string): Promise<string | null> {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row?.currentRevisionId ?? null;
}

async function revision(id: string) {
  const [row] = await db()
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, id))
    .limit(1);
  if (!row) throw new Error(`no revision ${id}`);
  return row;
}

async function runsOn(revisionId: string): Promise<string[]> {
  const rows = await db()
    .select({ step: revisionStepRuns.stepName })
    .from(revisionStepRuns)
    .where(eq(revisionStepRuns.revisionId, revisionId));
  return rows.map((r) => r.step).sort();
}

async function blockIdsOf(revisionId: string): Promise<string[]> {
  const rows = await db()
    .select({ id: revisionBlocks.blockId })
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.ordinal));
  return rows.map((r) => r.id);
}

/** Every job on this article other than `except`, oldest first — the claim order. */
async function othersOn(slug: string, except: string[]) {
  return await db()
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.slug, slug), except.length ? notIn(except) : undefined))
    .orderBy(asc(jobsTable.createdAt), asc(jobsTable.id));
}
const notIn = (ids: string[]) =>
  ids.length === 1 ? ne(jobsTable.id, ids[0] ?? "") : and(...ids.map((id) => ne(jobsTable.id, id)));

/** The jobs a reset's publication queued to make its extras again. */
const regenerationsOf = async (slug: string, resetId: string) =>
  (await othersOn(slug, [resetId])).filter((j) => j.steps[0]?.name !== "labels");

const mine = (name: string, body: () => Promise<void>) => it(name, () => runAsOwner(OWNER, body));

/* ------------------------------------------------------------------ tests -- */

describe("RESET_ROLE", () => {
  it("calls every import step an import, labels a successor, and the rest extras", () => {
    for (const step of DEFAULT_INGEST_STEPS) expect(RESET_ROLE[step], step).toBe("import");
    expect(RESET_ROLE.labels).toBe("successor");
    expect(extraSteps()).toEqual(
      STEP_ORDER.filter((s) => !DEFAULT_INGEST_STEPS.includes(s) && s !== "labels"),
    );
    expect(extraSteps()).toHaveLength(12);
  });

  it("finds every extra's column in STORAGE, one whole column each", () => {
    expect(extraColumns().map((c) => c.step)).toEqual(extraSteps());
  });
});

describe("a reset, through the real claim and publication", () => {
  /* **`VERCEL`, so `enqueue` does not start driving what it queues** — `pump`
     returns at once when it is set (src/jobs.ts). `retryJob` has no `pump`
     option, and without this its retry would run a real `fetch`. The same
     arrangement as tests/retry-keeps-the-checkpoints.test.ts. */
  let vercel: string | undefined;
  beforeAll(() => {
    vercel = process.env.VERCEL;
    process.env.VERCEL = "1";
  });

  afterAll(async () => {
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
    await cleanUpThenRelease(
      async () => {
        const database = getDb();
        await database.delete(jobsTable).where(inArray(jobsTable.ownerId, [OWNER, STRANGER]));
        const ours = await database
          .select({ id: articles.id })
          .from(articles)
          .where(eq(articles.ownerId, OWNER));
        for (const { id } of ours) {
          await database.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
          await database.delete(articles).where(eq(articles.id, id));
        }
        await closeDb();
        await runLock?.client.query("delete from auth.users where id::text like $1", [RUBBLE]);
      },
      async () => {
        await runLock?.release();
      },
    );
  });

  /**
   * **The one this feature is for.** Mutation: the null-out in
   * `openOrBeginJobDraft` removed → this case goes red on the extras still
   * being on the published reset.
   */
  mine("drops the extras from the new revision, keeps them on the old, and keeps the reader's data", async () => {
    const slug = `${SLUG_PREFIX}main`;
    /* Handed over out of STEP_ORDER, so "in STEP_ORDER" is something the code did. */
    const before = await publishWithExtras(slug, ["quotes", "glossary", "arc"]);
    const kept = before.blocks[1];
    if (!kept) throw new Error("the fixture has too few blocks");

    /* The reader's own data, on the paragraph the re-read leaves alone. */
    await db().insert(commentsTable).values({
      id: mintId(),
      articleId: before.articleId,
      ownerId: OWNER,
      blockId: kept.id,
      quote: "middle paragraph",
      start: 2,
      body: "A note the reset must not lose.",
      status: "none",
    });
    await db().insert(readingTime).values({ articleId: before.articleId, blockId: kept.id, seconds: 42 });

    const { job, regenerate } = await enqueueReset({
      slug,
      regenerate: true,
      profile: PROFILE,
      pump: false,
    });
    expect(regenerate, "not exactly the extras present, in STEP_ORDER").toEqual([
      "arc",
      "glossary",
      "quotes",
    ]);
    expect(job.reset).toEqual({ regenerate: ["arc", "glossary", "quotes"], profile: PROFILE });
    expect(job.steps.map((s) => s.name)).toEqual(DEFAULT_INGEST_STEPS);
    expect(job.steps.find((s) => s.name === "extract")?.force).toBe(true);
    expect(job.steps.find((s) => s.name === "fetch")?.force).toBeFalsy();

    /* **Nothing else is queued until the reset publishes.** */
    expect(await othersOn(slug, [job.id]), "something was queued before the reset published").toEqual([]);

    const calls: Calls = { fetch: 0, extract: 0 };
    const finished = await drive(job.id, partsFor(calls));
    expect(finished.job.status, finished.job.error).toBe("done");
    expect(calls.extract, "the reset did not re-read the article").toBe(1);
    expect(calls.fetch, "the reset fetched the page again").toBe(0);

    const after = await currentRevisionOf(slug);
    expect(after).not.toBe(before.revisionId);
    if (!after) throw new Error("no revision is current");

    /* 1. The extras are gone from the reset, columns and run rows both… */
    const published = await revision(after);
    for (const step of ["arc", "glossary", "quotes"] as const) {
      expect(published[step], `${step} rode along onto the reset`).toBeNull();
    }
    const runs = await runsOn(after);
    for (const step of ["arc", "glossary", "quotes"]) {
      expect(runs, `${step}'s run row rode along onto the reset`).not.toContain(step);
    }
    /* …and still on the revision it replaced. */
    const old = await revision(before.revisionId);
    expect(old.arc).toEqual(marker("arc"));
    expect(old.glossary).toEqual(marker("glossary"));
    expect(old.quotes).toEqual(marker("quotes"));
    expect(await runsOn(before.revisionId)).toEqual(
      expect.arrayContaining(["arc", "glossary", "quotes"]),
    );

    /* 2. The reader's data: an unchanged paragraph keeps its id, so the comment
       and the reading time still name a block the article has. */
    const ids = await blockIdsOf(after);
    expect(ids, "the unchanged paragraph came back under a new id").toContain(kept.id);
    for (const b of before.blocks) expect(ids, `${b.id} did not survive the re-read`).toContain(b.id);
    /* And the re-read really produced different blocks: the new paragraph is
       there under an id nobody had before, so this is not a copy published back. */
    expect(ids).toHaveLength(before.blocks.length + 1);
    const [comment] = await db()
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.articleId, before.articleId));
    expect(comment?.blockId).toBe(kept.id);
    const [seconds] = await db()
      .select()
      .from(readingTime)
      .where(eq(readingTime.articleId, before.articleId));
    expect(seconds).toMatchObject({ blockId: kept.id, seconds: 42 });

    /* 3. One job per extra, carrying the profile, in STEP_ORDER, each after the
       labels successor, and none of them a reset. */
    const queued = await regenerationsOf(slug, job.id);
    expect(queued.map((j) => j.steps.map((s) => s.name))).toEqual([["arc"], ["glossary"], ["quotes"]]);
    for (const j of queued) {
      expect(j.status).toBe("queued");
      expect(j.profile).toBe(PROFILE);
      expect(j.reset).toBeNull();
      expect(j.steps[0]?.force).toBeFalsy();
      expect(j.ingestEventId).toBeNull();
    }
    const times = queued.map((j) => j.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  mine("with regenerate false, records an empty list and queues no extras", async () => {
    const slug = `${SLUG_PREFIX}no-regenerate`;
    await publishWithExtras(slug, ["quotes"]);
    const { job, regenerate } = await enqueueReset({ slug, regenerate: false, pump: false });
    expect(regenerate).toEqual([]);
    expect(job.reset).toEqual({ regenerate: [] });

    const finished = await drive(job.id, partsFor({ fetch: 0, extract: 0 }));
    expect(finished.job.status, finished.job.error).toBe("done");
    const after = await currentRevisionOf(slug);
    if (!after) throw new Error("no revision is current");
    expect((await revision(after)).quotes).toBeNull();
    expect(await regenerationsOf(slug, job.id)).toEqual([]);
  });

  mine("a reset that fails queues nothing and leaves the article as it was", async () => {
    const slug = `${SLUG_PREFIX}fails`;
    const before = await publishWithExtras(slug, ["quotes", "glossary"]);
    const { job } = await enqueueReset({ slug, regenerate: true, profile: PROFILE, pump: false });

    const finished = await drive(job.id, partsFor({ fetch: 0, extract: 0 }, { failHierarchy: true }));
    expect(finished.job.status).toBe("error");
    expect(await currentRevisionOf(slug)).toBe(before.revisionId);
    expect((await revision(before.revisionId)).quotes).toEqual(marker("quotes"));
    expect(await othersOn(slug, [job.id]), "a failed reset queued something").toEqual([]);
  });

  /**
   * A reset's successors are minted at publication time. If a second reset is
   * already queued, those successors otherwise sit behind it: the second reset
   * publishes, then the first one's successors recreate extras the later press
   * asked to leave absent. One active reset per article closes that crossing.
   */
  mine("refuses a conflicting reset while one is active", async () => {
    const slug = `${SLUG_PREFIX}single-flight`;
    await publishWithExtras(slug, ["quotes"]);
    const first = await enqueueReset({
      slug,
      regenerate: true,
      profile: PROFILE,
      pump: false,
    });

    await expect(
      enqueueReset({ slug, regenerate: false, pump: false }),
    ).rejects.toMatchObject({ status: 409 });

    const active = await db()
      .select()
      .from(jobsTable)
      .where(and(eq(jobsTable.slug, slug), inArray(jobsTable.status, ["queued", "running"])));
    expect(active.map((row) => row.id)).toEqual([first.job.id]);
    expect(active[0]?.reset).toEqual({ regenerate: ["quotes"], profile: PROFILE });
  });

  /**
   * The active-reset key closes the ordinary overlap, but an enqueue can have
   * made its in-memory `createdAt` and then wait for the article lock while the
   * earlier reset publishes and becomes terminal. Once the lock opens the key
   * is free. Its INSERT-time database timestamp must keep the new reset behind
   * the jobs the other transaction committed while it waited.
   */
  mine("timestamps a reset after jobs committed while its insert waited", async () => {
    const slug = `${SLUG_PREFIX}insert-time`;
    await publishWithExtras(slug, ["quotes"]);

    let releaseLock: (() => void) | undefined;
    let sayLocked: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      sayLocked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blockerId = mintId();
    const holder = db().transaction(async (tx) => {
      await tx
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.slug, slug))
        .for("update");
      sayLocked?.();
      await released;
      const [blocker] = await tx
        .insert(jobsTable)
        .values({
          id: blockerId,
          ownerId: OWNER,
          slug,
          steps: [{ name: "quotes", label: STEPS.quotes.label, status: "pending" }],
          status: "queued",
          workKey: workKeyFor(["quotes"], new Set(), "insert-time blocker"),
        })
        .returning({ createdAt: jobsTable.createdAt });
      if (!blocker) throw new Error("the blocker job was not inserted");
      return blocker;
    });

    await locked;
    const resetPlan = { regenerate: [] };
    const wanted: Job = {
      id: mintId(),
      ownerId: OWNER,
      slug,
      steps: [{ name: "extract", label: STEPS.extract.label, status: "pending", force: true }],
      status: "queued",
      /* Deliberately stale: this is the timestamp made before waiting for the
         article lock. The adapter must replace it for a reset. */
      createdAt: "2000-01-01T00:00:00.000Z",
      reset: resetPlan,
    };
    const enqueued = pgJobStore.enqueueOrGet(wanted, {
      workKey: workKeyFor(["extract"], new Set(["extract"]), undefined, undefined, undefined, {
        reset: resetPlan,
      }),
      reservesName: false,
      requiresArticle: true,
    });
    releaseLock?.();

    const [blocker, outcome] = await Promise.all([holder, enqueued]);
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw new Error(`the reset was ${outcome.kind}`);
    expect(new Date(outcome.job.createdAt).getTime()).toBeGreaterThan(blocker.createdAt.getTime());
  });

  /**
   * **Sol F1, the queued half.** An identical `quotes` job — the key an
   * unscoped successor would mint — is already in the active set when the
   * reset publishes. The reset still ends with a post-reset `quotes` job of its
   * own. Mutation: the reset scope taken out of the successor's key → red.
   */
  mine("does not collapse a regeneration onto an identical job already queued", async () => {
    const slug = `${SLUG_PREFIX}f1-queued`;
    await publishWithExtras(slug, ["quotes"]);
    const { job } = await enqueueReset({ slug, regenerate: true, profile: PROFILE, pump: false });
    const holder = mintId();
    await db()
      .insert(jobsTable)
      .values({
        id: holder,
        ownerId: OWNER,
        slug,
        steps: [{ name: "quotes", label: STEPS.quotes.label, status: "pending" }],
        status: "queued",
        profile: PROFILE,
        /* After the reset in the line, so the reset can claim; before its
           publication, which is when the successor is queued. */
        createdAt: new Date(Date.now() + 60_000),
        workKey: workKeyFor(["quotes"], new Set(), PROFILE),
      });

    const finished = await drive(job.id, partsFor({ fetch: 0, extract: 0 }));
    expect(finished.job.status, finished.job.error).toBe("done");

    const ours = (await regenerationsOf(slug, job.id)).filter((j) => j.id !== holder);
    expect(ours.map((j) => j.steps[0]?.name), "the reset queued no quotes job of its own").toEqual([
      "quotes",
    ]);
  });

  /**
   * **Sol F1, the round-2 half: a holder bound to the old base.** Active, with
   * a draft copied from the revision the reset replaces — so it can never
   * publish over the reset. Mutation: scope out of the key → red.
   */
  mine("does not collapse a regeneration onto a job holding a draft on the old base", async () => {
    const slug = `${SLUG_PREFIX}f1-bound`;
    await publishWithExtras(slug, ["quotes"]);
    const { job } = await enqueueReset({ slug, regenerate: true, profile: PROFILE, pump: false });
    const oldDraft = await beginRevision({ slug });
    const holder = mintId();
    await db()
      .insert(jobsTable)
      .values({
        id: holder,
        ownerId: OWNER,
        slug,
        steps: [{ name: "quotes", label: STEPS.quotes.label, status: "pending" }],
        status: "queued",
        profile: PROFILE,
        createdAt: new Date(Date.now() + 60_000),
        draftRevisionId: oldDraft.revisionId,
        workKey: workKeyFor(["quotes"], new Set(), PROFILE),
      });

    const finished = await drive(job.id, partsFor({ fetch: 0, extract: 0 }));
    expect(finished.job.status, finished.job.error).toBe("done");

    const ours = (await regenerationsOf(slug, job.id)).filter((j) => j.id !== holder);
    expect(ours.map((j) => j.steps[0]?.name), "the regeneration was lost to a holder that can never publish").toEqual([
      "quotes",
    ]);
    expect(ours[0]?.draftRevisionId ?? null).toBeNull();
  });

  /**
   * **Sol F6.** Both queued in one transaction, where `now()` is one instant, so
   * only an explicit `created_at` keeps `sketch` ahead of `illustrated` in the
   * claim order `(created_at, id)`. The ids are then rewritten to sort the wrong
   * way round, which is the case a random id hits half the time.
   * Mutation: the explicit `created_at` removed → red.
   */
  mine("queues sketch ahead of illustrated even when their ids sort the other way", async () => {
    const slug = `${SLUG_PREFIX}f6`;
    await publishWithExtras(slug, ["sketch", "illustrated"]);
    const { job } = await enqueueReset({ slug, regenerate: true, pump: false });
    expect(job.reset?.regenerate).toEqual(["sketch", "illustrated"]);

    const finished = await drive(job.id, partsFor({ fetch: 0, extract: 0 }));
    expect(finished.job.status, finished.job.error).toBe("done");

    const queued = await regenerationsOf(slug, job.id);
    const sketch = queued.find((j) => j.steps[0]?.name === "sketch");
    const illustrated = queued.find((j) => j.steps[0]?.name === "illustrated");
    if (!sketch || !illustrated) throw new Error("the two regenerations were not queued");
    const [low, high] = [mintId(), mintId()].sort();
    await db().update(jobsTable).set({ id: high ?? "" }).where(eq(jobsTable.id, sketch.id));
    await db().update(jobsTable).set({ id: low ?? "" }).where(eq(jobsTable.id, illustrated.id));

    const order = (await regenerationsOf(slug, job.id)).map((j) => j.steps[0]?.name);
    expect(order, "illustrated would claim before the sketch it paints").toEqual(["sketch", "illustrated"]);
  });

  mine("is never collapsed onto a queued plain re-read that looks the same", async () => {
    const slug = `${SLUG_PREFIX}not-a-reread`;
    await publishWithExtras(slug, ["quotes"]);
    const reread = await enqueue({
      slug,
      steps: DEFAULT_INGEST_STEPS,
      force: ["extract"],
      pump: false,
    });
    const { job } = await enqueueReset({ slug, regenerate: false, pump: false });
    expect(job.id, "the reset was handed the plain re-read").not.toBe(reread.id);
    expect(job.reset).toEqual({ regenerate: [] });
  });

  it("answers another owner's slug with a 404 and queues nothing", async () => {
    const slug = `${SLUG_PREFIX}not-yours`;
    await runAsOwner(OWNER, () => publishWithExtras(slug, ["quotes"]));
    await expect(
      runAsOwner(STRANGER, () => enqueueReset({ slug, regenerate: true, pump: false })),
    ).rejects.toMatchObject({ status: 404 });
    const theirs = await db().select().from(jobsTable).where(eq(jobsTable.ownerId, STRANGER));
    expect(theirs).toEqual([]);
  });

  mine("carries the reset through a retry", async () => {
    const slug = `${SLUG_PREFIX}retry`;
    await publishWithExtras(slug, ["quotes", "glossary"]);
    const { job } = await enqueueReset({ slug, regenerate: true, profile: PROFILE, pump: false });
    await db()
      .update(jobsTable)
      .set({ status: "error", error: "a failure the fixture made up", finishedAt: new Date() })
      .where(eq(jobsTable.id, job.id));

    const retried = await retryJob(job.id);
    expect(retried?.id).not.toBe(job.id);
    expect(retried?.reset, "the retry is a plain re-read, and would publish the extras back").toEqual({
      regenerate: ["glossary", "quotes"],
      profile: PROFILE,
    });
    expect(retried?.steps.find((s: JobStep) => s.name === "extract")?.force).toBe(true);
  });
});
