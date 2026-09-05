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
import { stat } from "node:fs/promises";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

/*
 * **A `vi.hoisted` block stood here until 2026-09-05**, saving
 * `SPIDERYARN_DATA_ROOT` before any import could read it — hoisted because
 * imports are hoisted above every statement in a module, and the filesystem
 * store's data root was read by things this file imports. A
 * `SPIDERYARN_STORE=postgres` assignment had sat in it for the same reason
 * until earlier the same day. Both variables are gone: there is one store, and
 * it has no root to point anywhere.
 */

import { getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  jobs as jobsTable,
  revisionStepRuns,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import {
  DEADLINE_MARGIN_MS,
  REQUEUE_BUDGET,
  advanceJobWith,
  claimSession,
  retryJob,
} from "../src/jobs.js";
import type { AdvanceParts } from "../src/jobs.js";
import type { LabelsFile } from "../src/labels.js";
import { INTERRUPTED, STEP_STOPPED } from "../src/messages.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep, type StepProduct } from "../src/pipeline.js";
import { articleFingerprint, hashBlocks } from "../src/source-hash.js";
import { mintAttempt } from "../src/store/jobs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { pgArticleReader } from "../src/store/pg.js";
import type { ArtifactKind, ArtifactStore } from "../src/store/artifacts.js";
import type { CheckpointStore } from "../src/store/checkpoints.js";
import type { Arc, Block, Job, JobStep, StepName, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";

/* Put the store flag back straight after the imports: vitest reuses a worker
   across files and does not reset `process.env` between them, so leaving it set
   hands the next file a store it did not ask for. Everything above has already
   captured it. */

loadEnvLocal();

await pgReady({
  suite: "tests/claim-session-postgres.test.ts",
  tables: ["spideryarn.jobs", "spideryarn.article_revisions"],
});

/**
 * **This file starts jobs, so it takes the shared run lock.**
 *
 * Its fixtures are named the same on every run, so a second copy — a peer's
 * `npm test` beside yours — collides with it on `jobs_active_slug` and on the
 * fixture rows themselves. Taken after `pgReady` and only when reachable,
 * because a suite about to skip must not sit holding it.
 */
const runLock = await takeRunLock("tests/claim-session-postgres.test.ts");
afterAll(async () => {
  await runLock?.release();
});

/**
 * A slug per case, so one article's **line** of jobs — `claim`'s predecessor
 * rule, src/store/pg-jobs.ts — cannot make one case wait on another's teardown.
 *
 * (This said *"`jobs_active_slug` — one in-flight job per article"* until
 * 2026-09-02, when that index became four narrower ones and an article started
 * holding a queue rather than a single job.)
 */
const SLUGS = {
  ingest: "claim-session-pg-ingest",
  handback: "claim-session-pg-handback",
  late: "claim-session-pg-late-step",
  retry: "claim-session-pg-retry",
  openFailure: "claim-session-pg-open-failure",
  requeue: "claim-session-pg-requeue",
  pause: "claim-session-pg-deadline-pause",
  pauseStop: "claim-session-pg-deadline-pause-stop",
  pauseSpent: "claim-session-pg-deadline-pause-spent",
  pauseLapse: "claim-session-pg-pause-then-lapse",
} as const;

/* ----------------------------------------------- the article is not on disk -- */

/** The repository root, which is where the deleted filesystem store resolved to. */
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * **This claim put the whole article in Postgres and nothing on a disk.**
 *
 * ## What this used to be, and why it could not stay
 *
 * Until 2026-09-05 this was `assertScratchUntouched(root)`: every claim ran
 * inside a `mkdtemp` root pinned by `SPIDERYARN_DATA_ROOT`, and the assertion
 * was that `readdir` of that root came back `[]`. It could not survive stage G
 * of docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * — the variable, the root and `dataRoot()` are all deleted, so there is no
 * directory left to prove empty. `store-migration-registry.ts` said in advance
 * that these eleven assertions are load-bearing and must be **re-expressed
 * rather than dropped**, and this is the re-expression.
 *
 * ## What it asks instead
 *
 * Whether the two places an article's files went — `data/<slug>/` and
 * `output/<slug>.html`, under the repository root — exist at all. They must not.
 * The slugs are this file's own (`SLUGS`), no other suite writes them, and
 * `afterAll` removes rows rather than directories, so a directory that is there
 * is always one this claim made.
 *
 * **It is stronger than the temp root in one direction and weaker in another,
 * and both are worth saying.** Stronger: the old assertion proved only that
 * nothing was written *to the root it had pinned*, so a store that ignored the
 * override could write wherever it liked and stay green. This looks at the
 * repository root, which is where the deleted `dataRoot()` resolved on a laptop
 * and where a reconstructed `path.resolve(import.meta.dirname, "..", "..")` —
 * the exact bug that module was written against — lands. Weaker: a resurrected
 * store rooted somewhere else entirely would escape it. Nothing reads an
 * override any more, so there is no third place for it to be.
 *
 * ## What it does not prove, and the stated scope was wrong about this until 2026-09-01
 *
 * It is not evidence that a real Postgres ingest writes nothing to scratch.
 * Every step below is a fixture with no body, and real stages legitimately
 * wrote checkpoints under the context's directory while that field existed —
 * `hierarchy` took it as its checkpoint directory, and PDF extraction created
 * `pdf-chunks` (src/pdf-read.ts). Nor would it catch a real stage that
 * dual-wrote its artefact to disk while still returning correct `parts`.
 * Catching that wants a deterministic real-stage case through `claimSession`,
 * which is not built. GPT Sol, docs/plans/260901d-stage3-code-review-sol.md
 * finding 4.
 */
async function assertNothingOnDisk(slug: string, what: string): Promise<void> {
  const there = async (where: string): Promise<string | null> => {
    try {
      await stat(where);
      return where;
    } catch {
      return null;
    }
  };
  const written = (
    await Promise.all([
      there(path.join(REPO_ROOT, "data", slug)),
      there(path.join(REPO_ROOT, "output", `${slug}.html`)),
    ])
  ).filter((where): where is string => where !== null);
  expect(written, `${what} wrote the article to a disk`).toEqual([]);
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
 * A step that **never finishes on its own** and comes apart when the signal
 * fires — which is what a model call does, and is the only way to reach
 * `runStep`'s cancelled outcome.
 *
 * A step that merely *ignores* the signal is a different path: it runs to
 * completion, lands in `transitionAfter`, and is ended there. This one is the
 * mid-step overrun the pause is for — `hierarchy` cut off at 380 s on a real
 * 144-page paper, having already paid for its structure call.
 *
 * `before` runs first, so a case can arrange a race — a Stop pressed while the
 * step is in flight — from inside the step rather than from a timer.
 */
function hangingStep(name: StepName, before?: () => Promise<void>): PipelineStep {
  return {
    name,
    label: STEPS[name].label,
    produces: STEPS[name].produces,
    async run(ctx: { signal: AbortSignal }): Promise<StepProduct> {
      await before?.();
      await new Promise<never>((_resolve, reject) => {
        if (ctx.signal.aborted) reject(ctx.signal.reason as Error);
        else ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason as Error), {
          once: true,
        });
      });
      throw new Error(`${name} came back from a promise that only ever rejects`);
    },
  } as unknown as PipelineStep;
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
async function queueJob(
  slug: string,
  names: StepName[],
  force = false,
  createdAt?: string,
): Promise<Job> {
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
    /* **An argument, for the one case that puts two jobs in one article's
       line.** `claim` orders on `(created_at, id)` and `id` is random, so two
       rows written inside one millisecond queue in whichever order their ids
       happened to sort — which would be a test asserting what `mintId` did
       rather than what the rule does. GPT Sol, 2026-09-02. */
    createdAt: createdAt ?? new Date().toISOString(),
  };
  const { job } = await pgJobStore.enqueueOrGet(wanted, { workKey: `claim-session-${wanted.id}`, reservesName: false });
  return job;
}

/**
 * Advance until this job actually gets to run.
 *
 * **It gave each claim a scratch `data/` root of its own until 2026-09-05**, so
 * that the assertion above had a fresh directory to prove empty. There is no
 * root to give any more; `assertNothingOnDisk` is what replaced it.
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
async function advanceUntilItRuns(id: string, parts: AdvanceParts) {
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

/**
 * The `input_hash` each step run on a revision was stamped with — *what this
 * step read*, as the database recorded it.
 *
 * The field the re-extraction case asserts on, and the reason it asserts on
 * this rather than on whether an artefact exists: an artefact written from last
 * week's blocks is present, current-looking and wrong.
 */
async function stepHashesOf(revisionId: string): Promise<Record<string, string>> {
  const rows = await db()
    .select({ name: revisionStepRuns.stepName, hash: revisionStepRuns.inputHash })
    .from(revisionStepRuns)
    .where(eq(revisionStepRuns.revisionId, revisionId));
  return Object.fromEntries(rows.map((r) => [r.name, r.hash]));
}

async function arcTextOf(revisionId: string): Promise<string | null> {
  return ((await revisionRow(revisionId))?.arc as Arc | null)?.entries[0]?.text ?? null;
}

/* ---------------------------------------------------------------- the cases -- */

describe("a claim under Postgres", () => {
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
    /* **There is nothing on a disk to sweep**, and that is the point rather
       than an omission: until 2026-09-05 this took away a `mkdtemp` root per
       claim and put `SPIDERYARN_DATA_ROOT` back. `assertNothingOnDisk` above
       is what says so now. */
  }, 60_000);

  /* ------------------------------------------------------------------ 1 -- */

  it("publishes an ingest through the draft, and writes nothing to a disk", async () => {
    const slug = SLUGS.ingest;
    const { steps, blocks } = articleSteps(slug, "gna", "first ingest");
    const job = await queueJob(slug, INGEST);

    const advanced = await advanceUntilItRuns(job.id, {
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
    await assertNothingOnDisk(slug, "the ingest");
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
  it("publishes a second claim where every step skips, with nothing of it on a disk", async () => {
    const slug = SLUGS.ingest;
    const before = await currentRevisionOf(slug);
    expect(before, "case 1 has to have published before this case runs").not.toBeNull();

    const job = await queueJob(slug, ["hierarchy"]);
    const advanced = await advanceUntilItRuns(job.id, {
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
    await assertNothingOnDisk(slug, "the all-skipped claim");
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
  it("runs a late single step that reads the article from the store, on an instance that never ingested it", async () => {
    const slug = SLUGS.late;
    const { steps, blocks } = articleSteps(slug, "ptv", "the late-step article");
    const ingest = await queueJob(slug, INGEST);
    await advanceUntilItRuns(ingest.id, {
      session: claimSession,
      steps: { ...STEPS, ...steps } as never,
    });
    const published = await currentRevisionOf(slug);
    expect(published).not.toBeNull();

    const ARC = "the arc a late job wrote";
    let sawBlocks = 0;
    const job = await queueJob(slug, ["arc"]);
    const advanced = await advanceUntilItRuns(job.id, {
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
    await assertNothingOnDisk(slug, "the late single-step job");
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
    await advanceUntilItRuns(ingest.id, {
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
    const failed = await advanceUntilItRuns(refresh.id, {
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

    const advanced = await advanceUntilItRuns(retried!.id, {
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
    await assertNothingOnDisk(slug, "the retried refresh");
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

    const advanced = await advanceUntilItRuns(job.id, {
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
    await assertNothingOnDisk(slug, "the released claim");

    /* Tidy: nothing else in this file uses this slug, and a `queued` job holding
       `jobs_active_slug` would make the next run of this file wait for a lease. */
    await db()
      .delete(jobsTable)
      .where(and(eq(jobsTable.id, job.id), eq(jobsTable.status, "queued")));
  }, 120_000);

  /* ------------------------------------------------------------------ 6 -- */

  /**
   * **A session that will not open ends the job, and lets go of the draft the
   * job was already holding.**
   *
   * GPT Sol's finding 2 of docs/plans/260901d-stage3-code-review-sol.md:
   *
   * > The job becomes `running`, the Postgres session is then opened, while the
   * > encompassing `try` starts only later. A connection failure or other error
   * > from `openOrBeginJobDraft` therefore escapes the request; leaves the job
   * > `running` with its attempt and global slot; is not terminalised until a
   * > later advance notices the expired lease; appears as a generic interruption
   * > rather than the real failure.
   *
   * **The flip is what opened it.** Until 2026-09-01 this seam built a decorator
   * over a *filesystem* session, which could not fail during construction; since
   * the flip it is `openOrBeginJobDraft` — two row locks and possibly a minted
   * revision. So it is the same externally visible hang the all-skipped catch
   * was written to remove (tests/all-skipped-publication-refusal.test.ts),
   * reached one transaction earlier, and put there by this stage.
   *
   * ## Why the job holds a draft before the failing claim
   *
   * Because that is the state the fix has to be right about, and the state a
   * plain `store.finish` gets wrong: a job that goes terminal still pointing at
   * a revision is a draft `sweepAbandonedDrafts` spares for ever, since it reads
   * any job row's pointer as ownership. So the case builds it the way production
   * does — case 5's handback, which deliberately leaves the draft for the next
   * claim — and then breaks that next claim's session.
   *
   * ## Why the injected failure is transient rather than permanent
   *
   * Because a permanent one is not recoverable and saying so is the honest
   * answer. Under Postgres the `jobs` row is *in* the database, so a database
   * nothing can reach is one where no ending can be written by this code or any
   * other; the lease is what covers that, and it is the only thing that can.
   * What the fix closes is every failure where the database is reachable and the
   * open was not — a pool timeout, a lost connection, a deadlock — and this
   * injects exactly that: the first open fails, the second is production's own.
   *
   * ## The mutation, watched red on 2026-09-01
   *
   * `src/jobs.ts` put back to `const session = await parts.session(job, attempt);`
   * outside any recovery, which is the state this work found:
   *
   * ```
   * × ends the job when the session will not open, and lets the draft go
   * Error: connect ETIMEDOUT — THE POOL TIMEOUT A DRIVER WOULD HAVE QUOTED
   *  ❯ Object.session tests/claim-session-postgres.test.ts:972:32
   *  ❯ walkClaim src/jobs.ts:1421:31
   *  ❯ runInJob src/job-scope.ts:53:16
   *  ❯ Module.advanceJobWith src/jobs.ts:1342:16
   * ```
   *
   * The failure leaves `advanceJobWith` altogether. The rows it left were read
   * in that same run rather than reasoned about, by catching the throw and
   * printing them:
   *
   * ```
   * {"status":"running","attemptId":"5ad12990-5a3f-477e-b073-033367844279",
   *  "draftRevisionId":"20531bbf-87de-4a0a-8f66-42b23f93a6cb","draftStatus":"draft"}
   * ```
   *
   * That is the hang — the claim still held, the slot still taken, the draft
   * still owned — and it is what the assertions below are against.
   */
  it("ends the job when the session will not open, and lets the draft go", async () => {
    const slug = SLUGS.openFailure;
    const { steps } = articleSteps(slug, "ofa", "the open-failure article");
    const job = await queueJob(slug, INGEST);

    /* The first claim hands the job back mid-ingest, which is what leaves a
       draft pointer on a `queued` job — case 5 is the same arrangement, asserted
       rather than assumed. */
    const released = await advanceUntilItRuns(job.id, {
      session: claimSession,
      steps: { ...STEPS, ...steps } as never,
      leaseMs: DEADLINE_MARGIN_MS + 2_000,
    });
    expect(released?.done).toBe(false);
    const held = (await jobRow(job.id))?.draftRevisionId;
    expect(held, "the released claim was supposed to leave its draft behind").toBeTruthy();

    /**
     * What a pool timeout looks like, and **the marker stands for article
     * content**.
     *
     * `openOrBeginJobDraft` is a free function rather than a guarded store
     * method, so nothing has scrubbed this by the time the coordinator sees it
     * — a raw Drizzle error here carries the failed statement's bound
     * parameters. None of it may reach the job card or the `jobs` row.
     */
    const MARKER = "THE POOL TIMEOUT A DRIVER WOULD HAVE QUOTED";
    let opens = 0;
    const advanced = await advanceUntilItRuns(job.id, {
      session: async (claimed, attempt) => {
        opens += 1;
        if (opens === 1) throw new Error(`connect ETIMEDOUT — ${MARKER}`);
        return await claimSession(claimed, attempt);
      },
      steps: { ...STEPS, ...steps } as never,
    });

    /* The recovery asked for a session of its own, which is the only thing that
       can fail this job's draft. One ask and one recovery ask, no more. */
    expect(opens, "the recovery did not open a session to settle through").toBe(2);

    /* **Immediate and terminal**, which is the whole finding: no waiting for a
       lease, and an answer the browser's loop stops on. */
    expect(advanced?.done, "the job has to be over, in this request").toBe(true);
    expect(advanced?.ran, "no step can have run: the session never opened").toBeNull();
    expect(advanced?.job.status).toBe("error");

    /* The rows, because the answer above is in memory and the next request reads
       these. The pointer being gone is what stops `sweepAbandonedDrafts`
       treating this draft as owned for ever. */
    const row = await jobRow(job.id);
    expect(row?.status, "the job was left running until its lease lapsed").toBe("error");
    expect(row?.attemptId, "the claim was never let go").toBeNull();
    expect(row?.draftRevisionId, "the draft pointer is still held").toBeNull();
    expect(
      (await revisionRow(held!))?.status,
      "the draft was orphaned rather than failed",
    ).toBe("failed");

    /* Nothing was published, and the card says something a person can act on
       without any of what the driver put in its message. */
    expect(await currentRevisionOf(slug)).toBeNull();
    expect(row?.error).toContain("none of this run happened");
    expect(row?.error, "a driver error's parameters reached the jobs row").not.toContain(MARKER);
    expect(advanced?.job.error).not.toContain(MARKER);
    /* Nobody classified this one, so it is worth another go — and the sentence
       says so, which is the pair src/job-failure.ts keeps together. */
    expect(row?.failureKind).toBe("retry");
    expect(row?.error).toContain("Trying again is safe");

    await assertNothingOnDisk(slug, "the claim whose session would not open");
  }, 120_000);

  /* ------------------------------------------------------------------ 6 -- */

  /**
   * **A job queued behind a re-extraction reads the new article, not the old
   * one.**
   *
   * The question the per-article queue has to answer before it is safe to let
   * two jobs share an article —
   * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md
   * § 1k.10. B is queued *while A is still queued*, so B has never seen the
   * article A is about to rewrite; when B finally claims, its draft must be
   * opened from the revision A published rather than from anything B could have
   * captured when it was asked for.
   *
   * **It asserts the stored fingerprint, not the existence of an artefact**, and
   * that distinction is the whole of the test. An `ideas` written from last
   * week's blocks is present, non-null, and current-looking; only the hash the
   * step was stamped with says which article it actually read. The plan's first
   * draft asked whether a file existed, and GPT Sol pointed out that it would
   * have gone green over exactly the fault it was written for.
   *
   * The fixture `ideas` step therefore **computes its own stamp from what it
   * read**, through the store it is handed. A hard-coded hash would be the
   * test writing down the answer.
   */
  it("lets a job queued behind a re-extraction read the new revision", async () => {
    const slug = SLUGS.requeue;

    /* R1 — the article as it was. */
    const before = articleSteps(slug, "rqa", "before the re-extraction");
    const ingest = await queueJob(slug, INGEST);
    await advanceUntilItRuns(ingest.id, {
      session: claimSession,
      steps: { ...STEPS, ...before.steps } as never,
    });
    const r1 = await currentRevisionOf(slug);
    expect(r1, "the fixture ingest published nothing").not.toBeNull();

    /* A rewrites the article; B asks for ideas about it. **B is queued while A
       is still queued**, which is the state a reader produces by pressing
       Refresh and then Ideas. A second apart, so the order is the rule's rather
       than two random ids'. */
    const after = articleSteps(slug, "rqa", "after the re-extraction");
    const stamp = new Date();
    const rewrite = await queueJob(slug, INGEST, true, stamp.toISOString());
    const ideas = await queueJob(
      slug,
      ["ideas"],
      false,
      new Date(stamp.getTime() + 1000).toISOString(),
    );

    /* **B cannot claim while A is ahead of it**, and this is asserted before
       anything runs: neither job is `running`, so the mutex is not what is
       keeping B out — the line is. */
    /* `mintAttempt`, not `mintId`: `jobs.attempt_id` is a uuid column, and a
       `spya-` id only survives here while the refusal short-circuits before the
       UPDATE — so the probe would be green for a reason that has nothing to do
       with the line, and red with a `22P02` the moment it was not. */
    const early = await pgJobStore.claim(ideas.id, DEV_OWNER_ID, mintAttempt(), 60_000, 4);
    expect(early.kind, "the queued job claimed past an older one on its article").toBe("busy");

    await advanceUntilItRuns(rewrite.id, {
      session: claimSession,
      steps: { ...STEPS, ...after.steps } as never,
    });
    const r2 = await currentRevisionOf(slug);
    expect(r2, "the re-extraction published nothing new").not.toBe(r1);

    /* What the `ideas` step read, as it read it. */
    let sawFirstBlockText: string | null = null;
    const advanced = await advanceUntilItRuns(ideas.id, {
      session: claimSession,
      steps: {
        ...STEPS,
        ideas: {
          name: "ideas",
          label: STEPS.ideas.label,
          produces: STEPS.ideas.produces,
          async run(_ctx: unknown, store: ArtifactStore) {
            const file = await store.read(slug, "hierarchy", "blocks");
            const tree = await store.read(slug, "hierarchy", "tree");
            const meta = await store.read(slug, "extract", "meta");
            if (!file?.blocks || !tree) throw new Error("the queued job could not read the article");
            sawFirstBlockText = file.blocks[0]?.text ?? null;
            /* The real `ideas` stamps `inputFingerprint` over exactly these
               three (src/pipeline.ts § `articleInputHash`), so a fixture that
               computes it the same way is stamping what it read rather than
               what the test hoped for. */
            const hash = articleFingerprint(file.blocks, tree, meta ?? null);
            return {
              parts: {
                ideas: {
                  version: "ideas/1",
                  generator: "fixture",
                  slug,
                  sourceHash: hash,
                  ideas: [],
                  generatedAt: new Date().toISOString(),
                  elapsedMs: 0,
                },
              },
              stamp: { inputHash: hash },
              detail: "ideas ran",
            };
          },
        },
      } as never,
    });

    expect(advanced?.job.error).toBeUndefined();
    expect(advanced?.done).toBe(true);
    expect(advanced?.ran).toBe("ideas");

    /* **The reading, first.** The blocks the queued job saw are the rewritten
       ones — asserted on the text, so a failure says which generation it got
       rather than which hash. */
    expect(sawFirstBlockText, "the queued job read the article as it was before the rewrite").toBe(
      after.blocks[0]?.text,
    );

    /* **And the stamp the database kept.** This is the half that cannot be
       satisfied by an artefact merely existing: the fingerprint names the new
       revision's inputs and is not the old one's. */
    const meta = { slug, title: "A fixture article" };
    const expected = articleFingerprint(after.blocks, treeFor(slug, after.blocks), meta as never);
    const stale = articleFingerprint(before.blocks, treeFor(slug, before.blocks), meta as never);
    expect(expected, "the fixture's two generations hash the same — nothing is being tested").not.toBe(
      stale,
    );

    const r3 = await currentRevisionOf(slug);
    expect((await stepHashesOf(r3!)).ideas).toBe(expected);
    expect((await stepHashesOf(r3!)).ideas).not.toBe(stale);
    await assertNothingOnDisk(slug, "the job queued behind a re-extraction");
  }, 180_000);

  /* ------------------------------------------------------------------ 7 -- */

  /**
   * **A claimant that runs out of time *inside* a step puts the job down and
   * keeps its draft — and the next claim resumes on that same draft.**
   *
   * The acceptance case for stage 3 of
   * docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md. Until it,
   * a mid-step overrun ended the job `error` with a Retry button the reader had
   * to press, on a claimant that was alive and could have handed back — measured
   * on a 142-page PDF whose `hierarchy` step needs 658–778 s against a 740 s
   * deadline, and watched happening to `llm-survey` at 380 s.
   *
   * ## Why the draft is the assertion, and not a detail
   *
   * ⟨GPT Sol, finding 2, reproduced⟩ An earlier draft of the plan routed this
   * through `settleExpired`'s requeue, which carries the same budget — but that
   * statement **nulls `draft_revision_id`**, and on a first ingest there is no
   * published revision to copy from, so `blocks` would re-run as a genuine first
   * ingest and mint every block id afresh (src/ids.ts). The structure
   * checkpoint of stage 2 is keyed on those ids, so a lost draft makes it
   * permanently unreachable and every window re-buys the most expensive call in
   * the pipeline.
   *
   * So this asserts the thing directly: the draft pointer survives, and the step
   * that finished before the overrun is still recorded in it — which is what
   * makes the next claim skip rather than re-run.
   *
   * ## The arrangement
   *
   * `extract` finishes at once and `blocks` never finishes at all. The lease
   * leaves an 8 s deadline: enough for the walk to admit `blocks`, whose
   * `STEP_BUDGET_MS` is 5 s, and not enough for it to survive.
   */
  it("hands the job back mid-step when it runs out of time, and resumes on the same draft", async () => {
    const slug = SLUGS.pause;
    const { steps, blocks } = articleSteps(slug, "pza", "the paused article");
    const job = await queueJob(slug, INGEST);

    /* **Which draft the claim was writing into, read while it still is.**
       ⟨GPT Sol⟩ Reading the pointer only *after* the pause proves the row has
       one, not that it has the *same* one: an implementation that replaced the
       draft with a populated clone would satisfy every assertion below,
       publication included. So the id is captured from inside the step that is
       about to be aborted, which is the last moment the original is provably
       the one in use. */
    let inFlightDraft: string | null = null;
    const paused = await advanceUntilItRuns(job.id, {
      session: claimSession,
      steps: {
        ...STEPS,
        ...steps,
        blocks: hangingStep("blocks", async () => {
          inFlightDraft = (await jobRow(job.id))?.draftRevisionId ?? null;
        }),
      } as never,
      /* 8s of deadline after `DEADLINE_MARGIN_MS`: `extract` runs and commits,
         `blocks` is admitted with more than its 5s budget left, and the timer
         fires while it is in flight. */
      leaseMs: DEADLINE_MARGIN_MS + 8_000,
    });

    /* **`done: false`, which is what makes this work with no client change.**
       The browser re-drives a `{done: false, busy: false}` answer immediately
       (src/web/jobEngine.ts) — the same shape the deliberate between-steps
       hand-back has always returned. */
    expect(paused?.done, "the job ended instead of being put down").toBe(false);
    expect(paused?.busy).toBe(false);
    expect(paused?.ran).toBe("blocks");
    expect(paused?.job.status).toBe("queued");
    /* Which window it is on, so the card can say so rather than looking stalled. */
    expect(paused?.job.requeues).toBe(1);
    /* Nothing failed, so nothing on the record may say one did — a `failureKind`
       under a `queued` status is a Retry rule reading a state that is not an
       ending. */
    expect(paused?.job.error).toBeUndefined();
    expect(paused?.job.failureKind).toBeUndefined();

    const row = await jobRow(job.id);
    expect(row?.status).toBe("queued");
    expect(row?.attemptId, "the claim was not let go").toBeNull();
    expect(row?.requeues).toBe(1);
    expect(row?.steps.find((s) => s.name === "blocks")?.status, "a paused job left a step spinning").toBe(
      "pending",
    );

    /* **The whole point of the stage.** */
    const held = row?.draftRevisionId;
    expect(held, "the pause threw the draft away — stage 2's checkpoint is now unreachable").toBeTruthy();
    expect(inFlightDraft, "the step never saw a draft, so the identity below proves nothing").toBeTruthy();
    expect(held, "the pause kept *a* draft, but not the one the claim was writing into").toBe(
      inFlightDraft,
    );
    expect((await revisionRow(held!))?.status).toBe("draft");
    /* **`extract` is `done` in that draft, and `blocks` is honestly still
       `running`.** The second is the marker discipline rather than an oversight:
       `beginStep` brackets a run and only the success path clears it, so a step
       that was aborted mid-way must not read as finished — and `beginStepRun`
       already lets a later attempt reopen a row in this state. Between them they
       are the whole assertion: the finished work survived the pause and the
       unfinished work did not pretend to. */
    expect(
      await stepRunsOf(held!),
      "the step that finished before the overrun was not kept",
    ).toEqual({ extract: "done", blocks: "running" });
    expect(await currentRevisionOf(slug)).toBeNull();
    await assertNothingOnDisk(slug, "the paused claim");

    /* **And the next claim finishes it**, on the draft this one left. `extract`
       is skipped because its artefacts are in that draft — which is exactly what
       a requeue that nulled the pointer would have destroyed.

       **Counted rather than read off the step's status**, and the difference
       matters: `runStep` leaves an already-`done` step saying `done` rather than
       relabelling it `skipped`, so a step that ran a second time and a step that
       skipped are the same word on the record. The only honest question is
       whether the fixture's body was entered. */
    let extractRuns = 0;
    const countedExtract = {
      ...(steps.extract as PipelineStep),
      async run(...args: Parameters<PipelineStep["run"]>) {
        extractRuns += 1;
        return await (steps.extract as PipelineStep).run(...args);
      },
    } as PipelineStep;
    const finished = await advanceUntilItRuns(job.id, {
      session: claimSession,
      steps: { ...STEPS, ...steps, extract: countedExtract } as never,
    });
    expect(finished?.job.error).toBeUndefined();
    expect(finished?.done).toBe(true);
    expect(finished?.job.status).toBe("done");
    /* **`extract` never ran again, which is the resumption itself.**
       `stepIsDone` reads the artefacts through the session, so it can only
       answer yes because they are in the draft this claim adopted. A pause that
       nulled the pointer would have opened an empty draft, run it again, and
       minted new block ids on the way. */
    expect(
      extractRuns,
      "the resumed claim re-ran a step the paused one had already paid for",
    ).toBe(0);
    expect(finished?.ran).toBe("hierarchy");

    /* The published revision **is** the draft the paused claim was writing into,
       so nothing was started again. */
    expect(await currentRevisionOf(slug)).toBe(held);
    const article = await runAsOwner(DEV_OWNER_ID, () => pgArticleReader.loadArticle(slug));
    expect(article.blocks.map((b) => b.id)).toEqual(blocks.map((b) => b.id));
    await assertNothingOnDisk(slug, "the claim that resumed a paused job");
  }, 180_000);

  /* ------------------------------------------------------------------ 8 -- */

  /**
   * **Stop racing the overrun: the reader's stop wins.**
   *
   * ⟨GPT Sol, finding 3⟩ If the pause simply excluded `cancelling` rows and fell
   * through to today's `interruptedEnding`, `finishIn` would clear `cancelling`
   * and keep the ending it was handed — so a job the reader deliberately stopped
   * would end `error`, with a Retry button, saying *"whatever was running it did
   * not come back"*. That is the exact "the app not listening" failure
   * src/messages.ts is written against.
   *
   * The Stop is pressed **from inside the step**, through the store rather than
   * through `cancelJob`, so the flag lands on the row while the claim is live
   * and the abort that follows is the claimant's own deadline. That is the race:
   * both are true at once, and only one of them is the reader's.
   */
  it("ends a job stopped while it was overrunning as cancelled, not as an error", async () => {
    const slug = SLUGS.pauseStop;
    const { steps } = articleSteps(slug, "pzb", "the stopped article");
    const job = await queueJob(slug, INGEST);

    const advanced = await advanceUntilItRuns(job.id, {
      session: claimSession,
      steps: {
        ...STEPS,
        ...steps,
        extract: hangingStep("extract", async () => {
          await runAsOwner(DEV_OWNER_ID, async () => {
            const asked = await pgJobStore.requestCancel(job.id, DEV_OWNER_ID);
            expect(asked?.cancelling, "the Stop never reached the row").toBe(true);
          });
        }),
      } as never,
      leaseMs: DEADLINE_MARGIN_MS + 1_500,
    });

    expect(advanced?.done).toBe(true);
    expect(advanced?.job.status, "a job the reader stopped ended as something else").toBe(
      "cancelled",
    );

    const row = await jobRow(job.id);
    expect(row?.status).toBe("cancelled");
    /* A stop is not a window, so the budget is untouched. */
    expect(row?.requeues).toBe(0);
    expect(row?.failureKind, "a stopped job was given a Retry rule").toBeNull();
    /**
     * **The account, on both surfaces** ⟨GPT Sol, finding 3 on the built stage⟩.
     * Asserting the status alone leaves the corrective lines in `walkClaim`
     * deletable with this case still green — `runStep` has already marked the
     * job cancelled by the time they run, so the status is not evidence for
     * them. What they fix is what the reader is *told*: the card renders
     * `step.error` and the band renders `job.error`, and `runStep` wrote
     * `INTERRUPTED` on the step because it asked which abort fired and got the
     * honest answer for a claimant that had no idea a Stop was also in flight.
     * Neither field may go on saying nobody came back about a thing the reader
     * chose. tests/step-failure-seam.test.ts is where that seam lives.
     */
    const stopped = row?.steps.find((s) => s.name === "extract");
    expect(stopped?.error, "the card blamed the deadline for the reader's own Stop").toBe(
      STEP_STOPPED.message,
    );
    expect(stopped?.error).not.toContain(INTERRUPTED.message);
    expect(row?.error, "the band blamed the deadline for the reader's own Stop").not.toContain(
      INTERRUPTED.message,
    );
    expect(row?.cancelling).toBe(false);
    /* Terminal, so it may not go on holding a pointer — `sweepAbandonedDrafts`
       spares a revision any job row names. */
    expect(row?.draftRevisionId).toBeNull();
    expect(await currentRevisionOf(slug)).toBeNull();
    await assertNothingOnDisk(slug, "the claim the reader stopped");
  }, 120_000);

  /* ------------------------------------------------------------------ 9 -- */

  /**
   * **And it stops.** A step that can never fit in one window would pause,
   * re-claim, spend another window, for ever — buying model calls nobody is
   * waiting for, which is the failure this whole area is about wearing a
   * different hat.
   *
   * `REQUEUE_BUDGET` is the cap and it is **shared** with the lapsed-lease path,
   * so this is three windows in total rather than three cooperative overruns.
   * The third ends the job the way it always did: `INTERRUPTED` and `retry`, so
   * the reader gets the button and the sentence, and a new job with a fresh
   * budget is exactly what pressing it makes.
   */
  it("stops handing back a job that never fits, rather than looping for ever", async () => {
    const slug = SLUGS.pauseSpent;
    const { steps } = articleSteps(slug, "pzc", "the article that never fits");
    const job = await queueJob(slug, INGEST);

    const parts = {
      session: claimSession,
      steps: { ...STEPS, ...steps, extract: hangingStep("extract") } as never,
      leaseMs: DEADLINE_MARGIN_MS + 1_500,
    };

    for (let window = 1; window <= REQUEUE_BUDGET; window++) {
      const advanced = await advanceUntilItRuns(job.id, parts);
      expect(advanced?.done, `window ${window} ended the job instead of pausing`).toBe(false);
      expect((await jobRow(job.id))?.requeues).toBe(window);
    }

    const over = await advanceUntilItRuns(job.id, parts);
    expect(over?.done, "the job went round again past its budget").toBe(true);
    const row = await jobRow(job.id);
    expect(row?.status).toBe("error");
    expect(row?.requeues, "the ending spent another window").toBe(REQUEUE_BUDGET);
    expect(row?.failureKind).toBe("retry");
    expect(row?.error).toBe(INTERRUPTED.message);
    expect(row?.draftRevisionId, "a terminal job kept its draft pointer").toBeNull();
  }, 180_000);

  /* ----------------------------------------------------------------- 10 -- */

  /**
   * **A clean pause, then a lapsed claim, then the finish — and the draft, the
   * block ids and the structure checkpoint survive all three.**
   *
   * ⟨GPT Sol, reviewing the built stage 3, finding 1⟩ `pauseForDeadline` keeps
   * `draft_revision_id`; `settleExpired`'s **requeue** branch still nulled it,
   * and stages 2 and 3 therefore did not compose. The sequence that breaks is
   * ordinary rather than exotic:
   *
   * 1. `hierarchy` overruns and pauses cleanly — window one of three spent;
   * 2. the next claim is deployed over while it is inside `hierarchy`;
   * 3. `settleExpired` requeues it and **throws the draft away**;
   * 4. the third window opens an empty draft, so `blocks` runs as a first
   *    ingest and mints every id afresh (src/ids.ts) — the ids are in the
   *    structure request, so its fingerprint moves and the checkpoint bought in
   *    window two is unreachable;
   * 5. the tree is bought again — ~508 s and ~$2 on the paper this plan is
   *    about — the budget is gone, and the reader gets the Retry button this
   *    whole job exists to remove.
   *
   * ## Why the old rationale for clearing it no longer holds
   *
   * The comment on that branch argued that a draft written by a process which
   * vanished mid-step holds "whatever that process had got to". That predates
   * the transactional stage runner. Artefacts, the postcondition, the step
   * completion, the publication and the job transition now commit **together or
   * not at all** (src/store/pg-session.ts), and the model call is outside that
   * transaction, so a killed claimant leaves either a finished step or no trace
   * of it — never half of one. The step it was inside stays honestly `running`,
   * and `beginStepRun` explicitly allows *a different attempt* to reopen a row
   * in that state (src/store/pg-revisions.ts). A stale claimant that keeps going
   * is refused by `requireLiveJobOwnsDraft`, because `settleExpired` cleared its
   * token. There is nothing half-written left for the pointer to point at.
   *
   * The **terminal** branch still clears it and must: `sweepAbandonedDrafts`
   * spares a revision any job row names, so a job that has ended holding a
   * pointer is a draft nothing will ever publish or reclaim.
   *
   * ## What makes the assertions load-bearing rather than decorative
   *
   * `blocks` here **mints fresh ids on every run**, which is what the real one
   * does when there are no published blocks to copy from — so a lost draft is
   * visible in the article's own ids, not merely in a counter. And the
   * structure checkpoint is keyed on **those ids**, exactly as the real one is
   * keyed on a request that contains them, so "the checkpoint was still there"
   * and "the identity survived" are one fact rather than two hopeful ones.
   */
  it("keeps the draft when a lapsed claim is requeued, so the checkpoint written before it survives", async () => {
    const slug = SLUGS.pauseLapse;
    const job = await queueJob(slug, INGEST);

    /** How many times `blocks` has run, and the ids the last run minted. */
    let blockRuns = 0;
    let minted: Block[] = [];
    /** How many times `hierarchy` failed to find its answer and had to buy one. */
    let structureCalls = 0;

    const extractHtml = "<html><body><p>the article, as fetched</p></body></html>";
    const extract = returningStep("extract", {
      extractedHtml: extractHtml,
      meta: { slug, title: "A fixture article" },
    });

    /* **Fresh ids every run**, as `blocks` mints them on a first ingest. A draft
       that survives is a `blocks` that never runs again; a draft that is thrown
       away is a different article wearing the same slug. */
    const blocksStep = {
      name: "blocks",
      label: STEPS.blocks.label,
      produces: STEPS.blocks.produces,
      async run(): Promise<StepProduct> {
        blockRuns += 1;
        minted = [
          block(mintId(), `The opening paragraph, generation ${blockRuns}.`),
          block(mintId(), `The closing paragraph, generation ${blockRuns}.`),
        ];
        return {
          parts: {
            blocks: { blocks: minted },
            stampedHtml: `<html><body>${minted.map((b) => b.html).join("")}</body></html>`,
          } as never,
          detail: "blocks ran",
        };
      },
    } as unknown as PipelineStep;

    /**
     * `hierarchy`, with stage 2's checkpoint in miniature: read the blocks the
     * draft holds, key the answer on their **ids**, and pay only on a miss.
     *
     * `hang` is the deadline overrun — the checkpoint is written first, because
     * that is the whole shape of the real step: the expensive answer lands, and
     * then the wall clock runs out before the step can finish.
     */
    const hierarchyStep = (hang: boolean) =>
      ({
        name: "hierarchy",
        label: STEPS.hierarchy.label,
        produces: STEPS.hierarchy.produces,
        async run(
          ctx: { signal: AbortSignal },
          store: ArtifactStore,
          checkpoints: CheckpointStore,
        ): Promise<StepProduct> {
          const file = await store.read(slug, "blocks", "blocks");
          const read = file?.blocks as Block[] | undefined;
          if (!read?.length) throw new Error("hierarchy could not read the blocks in its draft");
          /* The key **is** the block identity — lower-case, hyphenated and
             within `CHECKPOINT_KEY_RE` by construction, because a block id is. */
          const key = read.map((b) => b.id).join("-");
          const found = await checkpoints.read<{ tree: string }>(slug, "hierarchy-structure", [key]);
          if (!found.has(key)) {
            structureCalls += 1;
            await checkpoints.write(slug, "hierarchy-structure", key, {
              tree: "as the model gave it",
            });
          }
          if (hang) {
            await new Promise<never>((_resolve, reject) => {
              if (ctx.signal.aborted) reject(ctx.signal.reason as Error);
              else
                ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason as Error), {
                  once: true,
                });
            });
          }
          return {
            parts: {
              tree: treeFor(slug, read),
              labels: labelsFor(slug, read),
              blocks: { blocks: read },
            } as never,
            stamp: { inputHash: hashBlocks(read) },
            detail: "hierarchy ran",
          };
        },
      }) as unknown as PipelineStep;

    /* --- Window 1: `extract` and `blocks` land; `hierarchy` is handed back. --
       30 s of deadline: more than `blocks` needs and far less than
       `STEP_BUDGET_MS.hierarchy`, so the walk puts the claim down between the
       two rather than starting a step it cannot finish. No requeue is spent —
       a between-steps release is free. */
    const first = await advanceUntilItRuns(job.id, {
      session: claimSession,
      steps: { ...STEPS, extract, blocks: blocksStep, hierarchy: hierarchyStep(false) } as never,
      leaseMs: DEADLINE_MARGIN_MS + 30_000,
    });
    expect(first?.done, "window one ended the job").toBe(false);
    expect(blockRuns, "window one did not get as far as minting the blocks").toBe(1);
    const firstIds = minted.map((b) => b.id);
    const draft = (await jobRow(job.id))?.draftRevisionId;
    expect(draft, "window one opened no draft").toBeTruthy();
    expect((await jobRow(job.id))?.requeues ?? 0, "a between-steps release spent a window").toBe(0);

    /* --- Window 2: the clean pause, with the tree already paid for. --------- */
    const paused = await advanceUntilItRuns(job.id, {
      session: claimSession,
      steps: { ...STEPS, extract, blocks: blocksStep, hierarchy: hierarchyStep(true) } as never,
      leaseMs: DEADLINE_MARGIN_MS + 6_000,
    });
    expect(paused?.done, "the overrun ended the job instead of putting it down").toBe(false);
    expect(structureCalls, "the structure answer was not bought in window two").toBe(1);
    expect((await jobRow(job.id))?.requeues).toBe(1);
    expect((await jobRow(job.id))?.draftRevisionId, "the pause dropped the draft").toBe(draft);

    /* --- Window 3: the claim is deployed over, and the lease lapses. -------
       Claimed and then expired on the **database's** clock rather than run with
       a lease short enough to expire between assertions — the same helper shape
       tests/store-jobs-parity.test.ts uses, and for the same reason. */
    const lost = mintAttempt();
    const claimed = await pgJobStore.claim(job.id, DEV_OWNER_ID, lost, 60_000, 4);
    expect(claimed.kind, "the requeued job could not be claimed again").toBe("claimed");
    await db()
      .update(jobsTable)
      .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(jobsTable.id, job.id));
    /* Owner-scoped, because the unscoped sweep is the whole table and this suite
       shares a database with everything else that is running. */
    expect(await pgJobStore.settleExpired(undefined, DEV_OWNER_ID, REQUEUE_BUDGET)).toContainEqual({
      id: job.id,
      status: "queued",
    });

    const swept = await jobRow(job.id);
    expect(swept?.status).toBe("queued");
    expect(swept?.requeues, "the lapse and the pause did not share one counter").toBe(2);
    /* **The finding, in one line.** */
    expect(
      swept?.draftRevisionId,
      "the lapsed claim's requeue threw the draft away — the next window re-mints every " +
        "block id and the structure checkpoint is unreachable",
    ).toBe(draft);

    /* --- Window 4: the finish, on the draft the first three left. ---------- */
    const finished = await advanceUntilItRuns(job.id, {
      session: claimSession,
      steps: { ...STEPS, extract, blocks: blocksStep, hierarchy: hierarchyStep(false) } as never,
    });
    expect(finished?.job.error).toBeUndefined();
    expect(finished?.done).toBe(true);
    expect(finished?.job.status).toBe("done");

    expect(blockRuns, "the resumed claim re-minted the article's ids").toBe(1);
    expect(
      structureCalls,
      "the checkpoint written in window two was not found in window four — the identity it " +
        "is keyed on moved",
    ).toBe(1);
    expect(
      await currentRevisionOf(slug),
      "the published revision is not the draft the three windows shared",
    ).toBe(draft);
    const article = await runAsOwner(DEV_OWNER_ID, () => pgArticleReader.loadArticle(slug));
    expect(article.blocks.map((b) => b.id)).toEqual(firstIds);
    await assertNothingOnDisk(slug, "the claim that finished a paused-then-lapsed job");
  }, 180_000);
});
