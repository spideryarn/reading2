/**
 * **The flip: `claimSession` picks the Postgres session, and a job published
 * through it puts an article on the reader's shelf.**
 *
 * This is the acceptance test for stage 3 item 6 of
 * docs/plans/260831b-finish-the-database-move.md. Until 2026-09-01 the same seam
 * held a decorator — `publishingSession` wrapped the filesystem session and, at
 * the end of a `done` job, copied the files the stages had written into a draft
 * and published that. Every step now returns its product, so the copy has
 * nothing to do and the files are not written at all: a claim writes straight
 * into its own draft revision. This file was that decorator's acceptance test
 * (`tests/jobs-publish-finalizer.test.ts`) and is now the flip's.
 *
 * ## The thing that makes it evidence: a fresh, empty scratch root per claim
 *
 * A laptop cannot normally show a store fault at all, because `dataRoot()` is
 * the repository root and every path accidentally works — the second claim finds
 * the first claim's files exactly where it left them, and a session that
 * published nothing looks the same as one that published everything. So every
 * claim below is given **its own empty temporary root**, the way a deployment
 * gives each job a fresh `/tmp/spideryarn/<owner>/<job>`, and the roots are
 * asserted to be **still empty afterwards**. Nothing on a disk can be doing the
 * work, and nothing on a disk can be hiding a failure to do it. GPT Sol,
 * docs/plans/260901d-flip-readiness-sol.md § 6, which is also where the claim
 * that this is *stronger* than an ordinary laptop ingest comes from.
 *
 * The trick is borrowed rather than invented:
 * `tests/acquire-extract-blocks-end-to-end.test.ts` already swaps
 * `SPIDERYARN_DATA_ROOT` per test, and `dataRoot()` reads it at the moment a
 * path is wanted rather than at module load, so it can move between claims.
 *
 * ## What is real here and what is not
 *
 * **Real:** `claimSession` — production's own session factory, and the line the
 * flip changed; the whole of the coordinator's walk; the Postgres job store with
 * its claim, its fence and its counted running slot; `openPgStoreSession`,
 * `pgStoreSession` and the publication inside its transaction; `retryJob` and
 * `forceForRetry`; and the Postgres article reader at the far end.
 *
 * **Fake:** the bodies of the pipeline steps, and only those. The thirteen real
 * ones fetch web pages and call models. They return `parts` and let the session
 * write them, which is exactly what the real stages do — that is the whole
 * precondition of the flip (`LEGACY_UNCONVERTED_STEPS` is empty,
 * src/pipeline.ts). A real stage committing through a real `pgStoreSession` is
 * `tests/pg-session-real-step.test.ts`; what that file cannot show is the
 * *selection*, because it injects `openPgStoreSession` itself. This file is the
 * other half.
 *
 * ## The mutation, watched red on 2026-09-01
 *
 * The decorator put back — `publishingSession(fsStoreSession({ artifacts:
 * pipelineStore, jobs: store }), …)` in `claimSession`, with
 * `src/store/publish-session.ts` restored from `HEAD`. Five of the six cases go
 * red, and the readings are the ones the run printed rather than the ones this
 * comment predicted:
 *
 * ```
 * × publishes an ingest …      the ingest wrote to its scratch root:
 *                              expected [ 'data', 'output' ] to deeply equal []
 * × publishes a second claim … expected 'No blocks for "claim-session-pg-ingest…'
 *                              to be undefined
 * × runs a late single step …  the late step could not read the article it is
 *                              describing: expected +0 to be 2
 * × re-forces a failed forced … the claim did not open a draft: expected '' to be truthy
 * × publishes nothing when the claim is handed back mid-job:
 *                              a released claim keeps its draft for the next one:
 *                              expected null to be truthy
 * ```
 *
 * The first is the whole flip in one line: the decorator's session wrote the
 * article to a disk. The rest follow from the empty roots — a later claim's
 * scratch has none of the earlier claim's files, so the copy has nothing to
 * move, the step has nothing to read, and no draft is opened until a
 * publication that never comes.
 *
 * ## Contention
 *
 * Same shared database as every other suite, and this file starts jobs: its own
 * slugs, swept on the way in and out, and tests/helpers/run-lock.ts.
 *
 * Skips loudly when there is no database; see tests/helpers/pg-ready.ts.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres` before **any** import.
 *
 * `vi.hoisted` and not a plain statement. `src/store/live.ts` reads the flag
 * once, the first time anything imports it, and imports are hoisted above every
 * statement in a module — so an ordinary assignment would run after the imports
 * below had settled the answer to `files`, and this whole file would exercise
 * the filesystem session and pass for the wrong reason.
 *
 * The data root is **not** hoisted, because it is not one value here: every
 * claim gets its own, and `withFreshScratch` below is what sets it.
 */
const HOISTED = vi.hoisted(() => {
  const previousStore = process.env.SPIDERYARN_STORE;
  const previousRoot = process.env.SPIDERYARN_DATA_ROOT;
  process.env.SPIDERYARN_STORE = "postgres";
  return { previousStore, previousRoot };
});

import { getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  jobs as jobsTable,
  revisionStepRuns,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { DEADLINE_MARGIN_MS, advanceJobWith, claimSession, retryJob } from "../src/jobs.js";
import type { AdvanceParts } from "../src/jobs.js";
import type { LabelsFile } from "../src/labels.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep, type StepProduct } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { DATA_ROOT_ENV } from "../src/store/data-root.js";
import { STORE } from "../src/store/live.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { pgArticleReader } from "../src/store/pg.js";
import type { ArtifactKind, ArtifactStore } from "../src/store/artifacts.js";
import type { Arc, Block, Job, JobStep, StepName, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";

/* Put the store flag back straight after the imports: vitest reuses a worker
   across files and does not reset `process.env` between them, so leaving it set
   hands the next file a store it did not ask for. Everything above has already
   captured it. */
if (HOISTED.previousStore === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = HOISTED.previousStore;

loadEnvLocal();

const { reachable } = await pgReady({
  suite: "tests/claim-session-postgres.test.ts",
  tables: ["spideryarn.jobs", "spideryarn.article_revisions"],
});

const when = reachable ? describe : describe.skip;

/**
 * **This file starts jobs, so it takes the shared run lock.**
 *
 * Its fixtures are named the same on every run, so a second copy — a peer's
 * `npm test` beside yours — collides with it on `jobs_active_slug` and on the
 * fixture rows themselves. Taken after `pgReady` and only when reachable,
 * because a suite about to skip must not sit holding it.
 */
const runLock = reachable ? await takeRunLock("tests/claim-session-postgres.test.ts") : undefined;
afterAll(async () => {
  await runLock?.release();
});

/**
 * A slug per case, so `jobs_active_slug` — one in-flight job per article —
 * cannot make one case wait on another's teardown.
 */
const SLUGS = {
  ingest: "claim-session-pg-ingest",
  handback: "claim-session-pg-handback",
  late: "claim-session-pg-late-step",
  retry: "claim-session-pg-retry",
} as const;

/* ------------------------------------------------------- the scratch roots -- */

/** Every root this file made, kept so `afterAll` can take them away. */
const ROOTS: string[] = [];

/**
 * Run `body` with a **brand-new empty** `data/` root, and hand the root back.
 *
 * The root is deliberately *not* removed here: the caller asserts it is still
 * empty, which is the whole point of the arrangement, and an assertion against a
 * directory that has been deleted proves nothing.
 */
async function withFreshScratch<T>(body: () => Promise<T>): Promise<{ result: T; root: string }> {
  const before = process.env[DATA_ROOT_ENV];
  const root = await mkdtemp(path.join(tmpdir(), "spya-claim-session-"));
  ROOTS.push(root);
  process.env[DATA_ROOT_ENV] = root;
  try {
    return { result: await body(), root };
  } finally {
    if (before === undefined) delete process.env[DATA_ROOT_ENV];
    else process.env[DATA_ROOT_ENV] = before;
  }
}

/**
 * **Nothing was written to a disk**, which under Postgres is the claim rather
 * than a tidiness check.
 *
 * `dataRoot()` is consulted for `ctx.dir` and `ctx.htmlFile` on every step of
 * every job, and nothing on the job path creates a directory — so a claim that
 * publishes through its draft leaves this root exactly as `mkdtemp` made it. A
 * claim that went through the filesystem session leaves the whole article here.
 */
async function assertScratchUntouched(root: string, what: string): Promise<void> {
  expect(await readdir(root), `${what} wrote to its scratch root`).toEqual([]);
}

/* -------------------------------------------------------------- the article -- */

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

/**
 * Two blocks is the smallest article a tree can be checked against.
 *
 * **The ids have to be real ones**, and `block_identities_id_format` is what
 * says so: six characters of `src/ids.ts`'s alphabet after `spya-`, the first a
 * letter, and neither `i`, `l`, `o` nor `1` is in it. Getting this wrong fails
 * at the very last statement of the commit, a long way from the fixture that
 * caused it.
 */
function blocksFor(seed: string, generation: string): Block[] {
  return [
    block(`spya-${seed}aa2`, `The opening paragraph, ${generation}.`),
    block(`spya-${seed}aa3`, `The closing paragraph, ${generation}.`),
  ];
}

/** One root over one leaf per block — the smallest shape `checkTree` accepts. */
function treeFor(slug: string, blocks: Block[]): Tree {
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
        children: blocks.map((_, i) => `n${i + 1}`),
        range: [blocks[0]!.id, blocks[blocks.length - 1]!.id],
        title: "A fixture article",
        gist: "A fixture built by tests/claim-session-postgres.test.ts and nothing else.",
      },
      ...Object.fromEntries(
        blocks.map((b, i) => [
          `n${i + 1}`,
          {
            id: `n${i + 1}`,
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

/**
 * `labels.json`, and its `sourceHash` is the load-bearing field.
 *
 * `STAMP_SOURCE` maps the `hierarchy` step's stamp to the `labels` artefact, and
 * `reasonsNotToPublish` refuses a revision whose `hierarchy` run row was stamped
 * against different blocks — so this hash is what carries *"this tree was built
 * from these blocks"* all the way to the publication gate.
 */
function labelsFor(slug: string, blocks: Block[]): LabelsFile {
  return {
    version: "labels/1",
    generator: "fixture",
    slug,
    sourceHash: hashBlocks(blocks),
    structureHash: "fixture-structure",
    structureVersion: "toc/1",
    labels: Object.fromEntries(blocks.map((b) => [b.id, "A paragraph"])),
    batches: null,
  };
}

/* --------------------------------------------------------------- the steps -- */

/**
 * A step that **returns** its artefacts and lets the session write them, which
 * is what all thirteen real steps do.
 *
 * It wrote them itself and returned a bare detail until 2026-08-31, which
 * matched the stages while they were unconverted; `checkProduct` refuses that
 * shape now, which is how the pipeline's own conversion is enforced.
 */
function returningStep(
  name: StepName,
  parts: Partial<Record<ArtifactKind, unknown>>,
  options: {
    /**
     * What went in, hashed — the field the *publication gate* reads.
     *
     * Not optional decoration: `reasonsNotToPublish` refuses a revision whose
     * `hierarchy` run row was stamped against blocks other than the ones stored,
     * and an unstamped run reads as "built from something else". The real
     * `hierarchy` returns `stamp: { inputHash: run.inputHash }` for exactly this
     * (src/pipeline.ts), and a fixture without it fails at the very last
     * statement of the walk with *"the tree was built from different blocks"* —
     * which is the gate working, and was the first thing this file found.
     */
    readonly inputHash?: string;
    readonly body?: (store: ArtifactStore) => Promise<void> | void;
  } = {},
): PipelineStep {
  return {
    name,
    label: STEPS[name].label,
    outputs: () => [],
    produces: STEPS[name].produces,
    async run(_ctx, store): Promise<StepProduct> {
      await options.body?.(store as ArtifactStore);
      return {
        parts: parts as never,
        ...(options.inputHash !== undefined && { stamp: { inputHash: options.inputHash } }),
        detail: `${name} ran`,
      };
    },
  } as PipelineStep;
}

/**
 * The three steps that make a publishable article, over one set of blocks.
 *
 * **`extract` is in here for a reason.** `blocks` writes `stampedHtml`, and the
 * revision's `extracted_html` has to come from somewhere or the article is half
 * a thing; every real ingest runs both (`DEFAULT_INGEST_STEPS`). `fetch` is
 * deliberately left out — it needs a stored object behind a reference, which is
 * a blob store and a different test.
 */
function articleSteps(
  slug: string,
  seed: string,
  generation: string,
): { steps: Partial<Record<StepName, PipelineStep>>; blocks: Block[] } {
  const blocks = blocksFor(seed, generation);
  const html = `<html><body>${blocks.map((b) => b.html).join("")}</body></html>`;
  return {
    blocks,
    steps: {
      extract: returningStep("extract", {
        extractedHtml: html,
        meta: { slug, title: "A fixture article" },
      }),
      blocks: returningStep("blocks", { blocks: { blocks }, stampedHtml: html }),
      hierarchy: returningStep(
        "hierarchy",
        { tree: treeFor(slug, blocks), labels: labelsFor(slug, blocks), blocks: { blocks } },
        { inputHash: hashBlocks(blocks) },
      ),
    },
  };
}

/** The steps a fixture ingest runs, in pipeline order. */
const INGEST: StepName[] = ["extract", "blocks", "hierarchy"];

/* ----------------------------------------------------------------- the job -- */

/**
 * A `queued` job straight into the Postgres store — **not** `enqueue`, which
 * starts the local pump and would be a second driver racing the one thing under
 * test. The one case that must go through `enqueue` is the retry, and it says so.
 */
async function queueJob(slug: string, names: StepName[], force = false): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: DEV_OWNER_ID,
    slug,
    steps: names.map(
      (name): JobStep => ({
        name,
        label: STEPS[name].label,
        status: "pending",
        ...(force && { force: true }),
      }),
    ),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await pgJobStore.enqueueOrGet(wanted, `claim-session-${wanted.id}`);
  return job;
}

/**
 * Advance until this job actually gets to run, in a scratch root of its own.
 *
 * `claim` answers `busy` rather than throwing whenever somebody else is ahead —
 * another job already in flight on this article, or the counted concurrency cap
 * already met across the whole database. An unguarded call would assert against
 * a job that never ran.
 *
 * **A `busy` on a job that is already terminal is a failure, not a wait**, and
 * that clause is here because of the decorator this file's flip removed. Under
 * it, an all-skipped claim spent a round trip: the decorator recorded the ending
 * itself and the coordinator's own settlement was then refused as a stale
 * attempt, so the first advance answered `{"busy":true,"done":false,
 * "status":"error"}` and only the *second* saw a finished job. A loop that
 * simply retried `busy` would swallow that, and swallowing it is how the round
 * trip survived unnoticed for a day. Waiting for somebody else's slot is a job
 * that is still `queued`; being told `busy` about a job that is over is not.
 */
async function advanceInFreshScratch(id: string, parts: AdvanceParts) {
  return await withFreshScratch(async () => {
    for (let attempt = 1; attempt <= 40; attempt++) {
      const advanced = await runAsOwner(DEV_OWNER_ID, () => advanceJobWith(id, parts));
      if (!advanced?.busy) return advanced;
      expect(
        advanced.job.status,
        "told `busy` about a job that has already ended — somebody settled it behind the walk",
      ).not.toMatch(/^(done|error|cancelled)$/);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      `job ${id} never got to run in 20s: either this article already has a job, the ` +
        "concurrency cap is full, or a row is wedged `running` and waiting will not clear it.",
    );
  });
}

/* ---------------------------------------------------------------- the reads -- */

const db = () => getDb();

/** What Postgres says the reader would be shown right now. */
async function currentRevisionOf(slug: string): Promise<string | null> {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row?.currentRevisionId ?? null;
}

async function jobRow(id: string) {
  const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, id)).limit(1);
  return row;
}

async function revisionRow(id: string) {
  const [row] = await db()
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, id))
    .limit(1);
  return row;
}

/** The step-run rows a revision carries, as `{ step: status }`. */
async function stepRunsOf(revisionId: string): Promise<Record<string, string>> {
  const rows = await db()
    .select({ name: revisionStepRuns.stepName, status: revisionStepRuns.status })
    .from(revisionStepRuns)
    .where(eq(revisionStepRuns.revisionId, revisionId));
  return Object.fromEntries(rows.map((r) => [r.name, r.status]));
}

async function arcTextOf(revisionId: string): Promise<string | null> {
  return ((await revisionRow(revisionId))?.arc as Arc | null)?.entries[0]?.text ?? null;
}

/* ---------------------------------------------------------------- the cases -- */

describe("the store this file is talking to", () => {
  it("is the Postgres one", () => {
    /* Without this, a flag that failed to take looks exactly like the flip
       working: the filesystem session answers every call happily and the job
       ends `done`, which is what most of the cases below assert. */
    expect(STORE).toBe("postgres");
  });
});

when("a claim under Postgres", () => {
  /**
   * **Jobs first and by slug, articles second.** A job row carries
   * `draft_revision_id`, and that foreign key blocks deleting the revision the
   * article delete is trying to cascade away. By slug rather than by the ids
   * this run minted, because a run that died part-way — a mutation under test,
   * an agent interrupted — leaves rows whose ids this process never saw, and the
   * next run would inherit the wedge.
   */
  afterAll(async () => {
    const database = getDb();
    const slugs = Object.values(SLUGS);
    for (const slug of slugs) await database.delete(jobsTable).where(eq(jobsTable.slug, slug));
    for (const slug of slugs) {
      const [row] = await database
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.slug, slug))
        .limit(1);
      if (!row) continue;
      await database.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, row.id));
      await database.delete(articles).where(eq(articles.id, row.id));
    }
    for (const root of ROOTS) await rm(root, { recursive: true, force: true });
    if (HOISTED.previousRoot === undefined) delete process.env[DATA_ROOT_ENV];
    else process.env[DATA_ROOT_ENV] = HOISTED.previousRoot;
  }, 60_000);

  /* ------------------------------------------------------------------ 1 -- */

  it("publishes an ingest through the draft, and writes nothing to a disk", async () => {
    const slug = SLUGS.ingest;
    const { steps, blocks } = articleSteps(slug, "gna", "first ingest");
    const job = await queueJob(slug, INGEST);

    const { result: advanced, root } = await advanceInFreshScratch(job.id, {
      session: claimSession,
      steps: { ...STEPS, ...steps } as never,
    });

    /* The message first, so a failure here reads as the reason rather than as
       "expected error to be done". */
    expect(advanced?.job.error).toBeUndefined();
    expect(advanced?.done).toBe(true);
    expect(advanced?.job.status).toBe("done");

    /* **The pointer moved**, which is the sentence the whole stage is for. */
    const current = await currentRevisionOf(slug);
    expect(current).not.toBeNull();
    /* And it is a revision that was **published**, not a draft the pointer was
       aimed at. Two different facts, and only one of them is the pointer. */
    expect((await revisionRow(current!))?.status).toBe("published");

    /* Every step of the walk left a finished run row on that revision — the rows
       `stepIsDone` reads on the next claim, and the ones the publication gate
       asks about. */
    expect(await stepRunsOf(current!)).toEqual({ extract: "done", blocks: "done", hierarchy: "done" });

    /* Read it back the way a reader does, through the Postgres reader rather
       than by re-querying the columns the write just set. `loadArticle` refuses
       a revision with no tree or no blocks, so this is the publication gate
       asked from the other side. */
    const article = await runAsOwner(DEV_OWNER_ID, () => pgArticleReader.loadArticle(slug));
    expect(article.blocks.map((b) => b.text)).toEqual(blocks.map((b) => b.text));
    expect(article.tree.rootId).toBe("n0");

    /* And it is on the shelf, which is a different set of conditions from
       `loadArticle` and the one a reader meets first. */
    const shelf = await runAsOwner(DEV_OWNER_ID, () => pgArticleReader.listArticles());
    expect(shelf.map((entry) => entry.slug)).toContain(slug);

    /* The job row itself, not the object the coordinator returned: the finish is
       inside the publication's transaction, so a `done` in memory and a `done`
       in the database are separate claims. And nothing is left pointing at a
       draft for `sweepAbandonedDrafts` to spare for ever. */
    expect((await jobRow(job.id))?.status).toBe("done");
    expect((await jobRow(job.id))?.draftRevisionId).toBeNull();

    /* **And the whole article went into Postgres and nowhere else.** */
    await assertScratchUntouched(root, "the ingest");
  }, 120_000);

  /* ------------------------------------------------------------------ 2 -- */

  /**
   * **A second claim on the same article, in a scratch root that has never seen
   * it, where every step skips.**
   *
   * This is the door the walk takes when a job is re-added for an article
   * already on the shelf: nothing runs, `commit` is never called, and the ending
   * goes through `settleJob`. Under Postgres that door publishes the draft this
   * claim opened — a carry-forward copy of the published revision — which is why
   * the article survives it rather than being republished as an empty one.
   *
   * The empty scratch root is what makes it evidence: the decorator would have
   * had nothing to copy here and would have refused the publication outright.
   */
  it("publishes a second claim where every step skips, from an empty scratch root", async () => {
    const slug = SLUGS.ingest;
    const before = await currentRevisionOf(slug);
    expect(before, "case 1 has to have published before this case runs").not.toBeNull();

    const job = await queueJob(slug, ["hierarchy"]);
    const { result: advanced, root } = await advanceInFreshScratch(job.id, {
      session: claimSession,
      /* The real registry, unfaked: every one of these must skip, and a step
         that ran would fetch or call a model, which is a loud failure rather
         than a quiet pass. */
      steps: STEPS,
    });

    expect(advanced?.job.error).toBeUndefined();
    expect(advanced?.done, "the job has to be over, in this request").toBe(true);
    expect(advanced?.ran, "nothing ran: every step skipped").toBeNull();
    expect(advanced?.job.status).toBe("done");

    /* **A new published revision, and the reader's article is intact.** The
       draft was opened when the claim started and is published when it ends, so
       the pointer moves even though nothing ran — and what it moves to carries
       the earlier revision's blocks and tree forward. */
    const after = await currentRevisionOf(slug);
    expect(after).not.toBe(before);
    expect((await revisionRow(after!))?.status).toBe("published");
    const article = await runAsOwner(DEV_OWNER_ID, () => pgArticleReader.loadArticle(slug));
    expect(article.blocks).toHaveLength(2);
    expect(article.tree.rootId).toBe("n0");

    expect((await jobRow(job.id))?.status).toBe("done");
    expect((await jobRow(job.id))?.draftRevisionId).toBeNull();
    await assertScratchUntouched(root, "the all-skipped claim");
  }, 120_000);

  /* ------------------------------------------------------------------ 3 -- */

  /**
   * **A late single-step job on an instance that never ingested the article.**
   *
   * This is the case that was broken on the day the queue first worked on
   * Vercel: opening an article starts an `arc` job, which gets its own job id
   * and therefore its own empty scratch, and could not see what the ingest wrote
   * (docs/project/ingest-queue.md). The fake `arc` below reads the blocks
   * through the store it is handed — which is `session.reads`, so under Postgres
   * it is the draft — and refuses to invent an answer if they are not there.
   */
  it("runs a late single step that reads the article from the store, not from its empty root", async () => {
    const slug = SLUGS.late;
    const { steps, blocks } = articleSteps(slug, "ptv", "the late-step article");
    const ingest = await queueJob(slug, INGEST);
    await advanceInFreshScratch(ingest.id, {
      session: claimSession,
      steps: { ...STEPS, ...steps } as never,
    });
    const published = await currentRevisionOf(slug);
    expect(published).not.toBeNull();

    const ARC = "the arc a late job wrote";
    let sawBlocks = 0;
    const job = await queueJob(slug, ["arc"]);
    const { result: advanced, root } = await advanceInFreshScratch(job.id, {
      session: claimSession,
      steps: {
        ...STEPS,
        arc: returningStep(
          "arc",
          {
            arc: {
              version: "arc/1",
              generator: "fixture",
              slug,
              entries: [{ range: [blocks[0]!.id, blocks[1]!.id], text: ARC }],
            },
          },
          {
            body: async (store) => {
              /* **The read is the assertion.** The scratch root is empty, so
                 the only place these can come from is the draft this claim
                 opened — and a step that could not read them would have to
                 invent an arc over block ids it never saw. */
              const read = await store.read(slug, "blocks", "blocks");
              sawBlocks = read?.blocks.length ?? 0;
            },
          },
        ),
      } as never,
    });

    expect(sawBlocks, "the late step could not read the article it is describing").toBe(2);
    expect(advanced?.job.error).toBeUndefined();
    expect(advanced?.done).toBe(true);
    expect(advanced?.ran).toBe("arc");
    expect(advanced?.job.status).toBe("done");

    const after = await currentRevisionOf(slug);
    expect(after).not.toBe(published);
    expect(await arcTextOf(after!)).toBe(ARC);
    /* The new revision carries the ingest's step runs forward as well as its
       own, which is what lets the *next* claim skip them. */
    expect(await stepRunsOf(after!)).toMatchObject({
      extract: "done",
      blocks: "done",
      hierarchy: "done",
      arc: "done",
    });
    expect((await jobRow(job.id))?.draftRevisionId).toBeNull();
    await assertScratchUntouched(root, "the late single-step job");
  }, 120_000);

  /* ------------------------------------------------------------------ 4 -- */

  /**
   * **A forced refresh that fails, followed through `retryJob` to a published
   * article.**
   *
   * The fourth fault of docs/plans/260831b-finish-the-database-move.md, end to
   * end and through production's own selection. The shape:
   *
   * 1. R1 is published.
   * 2. A forced job rewrites `extract` and `blocks` into a draft and dies at
   *    `hierarchy`. The draft is discarded, so that work is gone.
   * 3. Retry must therefore re-force **everything the refresh forced**, not only
   *    the step that did not finish — because the retry's new draft is copied
   *    from R1, so a `blocks` that "already finished" would skip and `hierarchy`
   *    would run over last week's article, reporting success.
   *
   * `tests/retry-after-a-failed-refresh.test.ts` proves `forceForRetry`'s
   * arithmetic and says in its own header that it does not prove the Postgres
   * consequence. This is that consequence: the article a reader opens afterwards
   * is the *refreshed* one.
   */
  it("re-forces a failed forced refresh through retryJob, and the refresh lands", async () => {
    const slug = SLUGS.retry;

    const first = articleSteps(slug, "rfa", "before the refresh");
    const ingest = await queueJob(slug, INGEST);
    await advanceInFreshScratch(ingest.id, {
      session: claimSession,
      steps: { ...STEPS, ...first.steps } as never,
    });
    const r1 = await currentRevisionOf(slug);
    expect(r1).not.toBeNull();

    /* The refresh: the same three steps, all forced, with new text — and a
       `hierarchy` that throws. */
    const second = articleSteps(slug, "rfa", "after the refresh");
    const refresh = await queueJob(slug, INGEST, true);
    let draftId = "";
    const { result: failed } = await advanceInFreshScratch(refresh.id, {
      session: async (job, attempt) => {
        const session = await claimSession(job, attempt);
        draftId = (await jobRow(job.id))?.draftRevisionId ?? "";
        expect(draftId, "the claim did not open a draft").toBeTruthy();
        return session;
      },
      steps: {
        ...STEPS,
        ...second.steps,
        hierarchy: {
          ...second.steps.hierarchy!,
          run: () => {
            throw new Error("the fixture hierarchy step refuses to run");
          },
        },
      } as never,
    });

    expect(failed?.job.status).toBe("error");
    /* The reader is where they were, the draft that held the half-done refresh
       is failed, and the pointer is gone — which is exactly why the retry has to
       start over rather than trust what "finished". */
    expect(await currentRevisionOf(slug)).toBe(r1);
    expect((await revisionRow(draftId))?.status).toBe("failed");
    expect((await jobRow(refresh.id))?.draftRevisionId).toBeNull();

    /**
     * `retryJob`, the real one — the endpoint's own function, including the
     * refusal that now guards it and `forceForRetry`.
     *
     * **`VERCEL` is set across this one call**, and only to stop `enqueue`
     * starting the local pump. The pump drives the job with the *real* step
     * registry, which fetches web pages and calls models; on a deployment it is
     * never started for exactly the reason it is unwanted here — nothing can
     * outlive the invocation — and the browser drives instead, which is what the
     * advance below is standing in for.
     */
    const previousVercel = process.env.VERCEL;
    process.env.VERCEL = "1";
    let retried: Job | null;
    try {
      retried = await runAsOwner(DEV_OWNER_ID, () => retryJob(refresh.id));
    } finally {
      if (previousVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previousVercel;
    }

    expect(retried, "retryJob refused a job that plainly failed").not.toBeNull();
    /* **All three forced again**, not just the one that did not finish. */
    expect(retried!.steps.filter((s) => s.force).map((s) => s.name).sort()).toEqual(
      [...INGEST].sort(),
    );

    const { result: advanced, root } = await advanceInFreshScratch(retried!.id, {
      session: claimSession,
      steps: { ...STEPS, ...second.steps } as never,
    });

    expect(advanced?.job.error).toBeUndefined();
    expect(advanced?.job.status).toBe("done");

    /* **And the refresh is what a reader opens.** This is the assertion the
       fourth fault is about: with the old `forceForRetry`, `extract` and
       `blocks` would have skipped against R1's carried-forward artefacts and the
       article here would still say "before the refresh", under a row of green
       ticks. */
    const r2 = await currentRevisionOf(slug);
    expect(r2).not.toBe(r1);
    const article = await runAsOwner(DEV_OWNER_ID, () => pgArticleReader.loadArticle(slug));
    expect(article.blocks.map((b) => b.text)).toEqual(second.blocks.map((b) => b.text));
    expect(article.blocks[0]?.text).toContain("after the refresh");

    expect((await jobRow(retried!.id))?.status).toBe("done");
    expect((await jobRow(retried!.id))?.draftRevisionId).toBeNull();
    await assertScratchUntouched(root, "the retried refresh");
  }, 180_000);

  /* ------------------------------------------------------------------ 5 -- */

  /**
   * **A claim handed back mid-job publishes nothing.**
   *
   * `transitionAfter`'s budget branch: the claimant is close enough to its own
   * deadline that starting the next step would mean being killed inside it, so
   * it puts the job down and the next request picks it up. The claim it proves
   * is the plan's own — **publish once everything has run**, never a half
   * ingested article.
   *
   * **What changed at the flip, and it is worth saying rather than quietly
   * fixing:** the decorator opened its draft lazily, at the moment of
   * publication, so a released claim left no article row and no revision at all.
   * `pgStoreSession` opens the draft when the claim starts, deliberately — that
   * is what lets the *next* claim adopt this one's work — so there is a draft
   * here, and what must not exist is a **published** revision.
   */
  it("publishes nothing when the claim is handed back mid-job", async () => {
    const slug = SLUGS.handback;
    const { steps } = articleSteps(slug, "hbk", "the handback article");
    const job = await queueJob(slug, INGEST);

    const { result: advanced, root } = await advanceInFreshScratch(job.id, {
      session: claimSession,
      steps: { ...STEPS, ...steps } as never,
      /* 22s leaves a 2s deadline after `DEADLINE_MARGIN_MS`, and `blocks` needs
         5s of budget — so `extract` runs, the walk hands back, and the
         self-abort timer never gets near firing. */
      leaseMs: DEADLINE_MARGIN_MS + 2_000,
    });

    expect(advanced?.done).toBe(false);
    expect(advanced?.ran).toBe("extract");
    const row = await jobRow(job.id);
    expect(row?.status).toBe("queued");
    expect(row?.attemptId).toBeNull();

    /* **Nothing is on the shelf**, which is the assertion. The draft exists and
       still belongs to this job, waiting for the next claim. */
    expect(await currentRevisionOf(slug)).toBeNull();
    expect(row?.draftRevisionId, "a released claim keeps its draft for the next one").toBeTruthy();
    expect((await revisionRow(row!.draftRevisionId!))?.status).toBe("draft");
    /* And the one step that ran wrote its run row into that draft, which is what
       the next claim reads to decide to skip it. */
    expect(await stepRunsOf(row!.draftRevisionId!)).toEqual({ extract: "done" });
    await assertScratchUntouched(root, "the released claim");

    /* Tidy: nothing else in this file uses this slug, and a `queued` job holding
       `jobs_active_slug` would make the next run of this file wait for a lease. */
    await db()
      .delete(jobsTable)
      .where(and(eq(jobsTable.id, job.id), eq(jobsTable.status, "queued")));
  }, 120_000);
});
