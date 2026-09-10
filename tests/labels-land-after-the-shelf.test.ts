/**
 * **The two orderings the split exists for, asserted rather than raced.**
 *
 * Stage 3 of docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md.
 * Stages 1, 2a, 2b and 2c took the label pass out of the blocking `hierarchy`
 * step and gave it a free successor job. Every test written for those stages
 * asks about one piece — the registrations, the column, the enqueue, the sweep.
 * **None of them watches an ingest publish and a label run finish in that
 * order**, which is the whole product claim:
 *
 * > A reader who pastes a URL gets a readable article without waiting for the
 * > labels, and the labels arrive afterwards.
 *
 * ## The two properties
 *
 * 1. **An ingest publishes without waiting for the labels.** The revision
 *    reaches the shelf — `articles.current_revision_id` moves and
 *    `pgArticleReader.loadArticle` serves it — while the label executor has not
 *    run at all. Then the executor finishes and the labels land on the article,
 *    with the revision reading `ready`.
 * 2. **Partial output never replaces the tree.** A label run that produces some
 *    batches and then fails leaves the published tree exactly as it was, and
 *    moves the published revision from `pending` to `failed` rather than to a
 *    tree carrying half its labels.
 *
 * ## Deliberately delayed, not slow
 *
 * The executor is a **deferred promise this file resolves**, so the two
 * orderings are asserted rather than raced: between the ingest publishing and
 * the labels landing there is a window the test holds open for as long as it
 * likes, and every read taken inside it is taken at a moment the production
 * code cannot have left. A `setTimeout` would prove the same thing only on a
 * fast machine.
 *
 * `labelGate` below is the seam, and it replaces exactly one function:
 * `generateLabels`, the paid model call. `mergeLabels`, `checkCoverage`,
 * `STEPS.labels.run`, `openPgStoreSession`, `publishRevisionIn` and
 * `writeArtefacts` are all the real ones, so what is under test is the
 * pipeline's own ordering rather than a fixture's.
 *
 * **And the gate refuses by default**, which is what makes property 1 a
 * statement about the ingest rather than about a promise nobody awaited: while
 * the ingest job is running, `generateLabels` is wired to throw *"the ingest ran
 * the labels step"*. Put `labels` into `DEFAULT_INGEST_STEPS` and this file goes
 * red immediately and by name, rather than hanging on a deferred nothing will
 * resolve.
 *
 * ## What is faked, and what that costs the claim
 *
 * The job's step list is `["blocks", "hierarchy"]` rather than the whole of
 * `DEFAULT_INGEST_STEPS`. `fetch` reaches the network and `hierarchy` and
 * `extract`-on-a-PDF are paid model calls, so the fixture stands in for the
 * first two the way tests/pg-session-real-step.test.ts does — the base revision
 * carries `extracted_html` and `fetch`/`extract` receipts — and `hierarchy` is
 * a fake whose product is built from the **real** `buildTree` and
 * `mergeLabels`, so the artefacts it hands the session are the shape
 * `generateHierarchy` really produces (src/hierarchy.ts § `pending`). `blocks`
 * is the real step.
 *
 * What that leaves unproven is nothing this file claims: `fetch` and `extract`
 * have no opinion about labels, and the premise that the ingest's step list
 * excludes `labels` is asserted below off `DEFAULT_INGEST_STEPS` itself.
 *
 * ## Which instrument
 *
 * `npm test`, against the local Postgres — there is no other store
 * (docs/project/database.md). Its own owner and its own slug prefix, swept on
 * the way in and out, and `tests/helpers/run-lock.ts` because it runs jobs.
 *
 * ## Watched red
 *
 * Every mutation is named beside the case it makes fail; see each `it`.
 */
import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { blocksArtefact, runBlocks } from "../src/blocks.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  checkpoints as checkpointRows,
  jobs as jobsTable,
  revisionBlocks,
  revisionStepRuns,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { buildTree, type ModelNode } from "../src/hierarchy.js";
import { mintId } from "../src/ids.js";
import { advanceJobWith, type AdvanceParts, type StepRegistry } from "../src/jobs.js";
import { LABELS_PROMPT_VERSION, mergeLabels } from "../src/labels.js";
import type { CompletedLabelsFile, LabelRun, PendingLabelsFile } from "../src/labels.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { runAsOwner } from "../src/owner.js";
import { STEPS, DEFAULT_INGEST_STEPS, type PipelineStep } from "../src/pipeline.js";
import { hashBlocks, structureHash } from "../src/source-hash.js";
import { pgArticleReader } from "../src/store/pg.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { openPgStoreSession } from "../src/store/pg-session.js";
import { workKeyFor } from "../src/store/jobs.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/artifacts.js";
import type { Block, JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import { pgReady } from "./helpers/pg-ready.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/**
 * **The one function this file replaces**, and the only reason it is replaced
 * is that it is the paid model call.
 *
 * `handler` is set by each case. **`undefined` means refuse**, which is not a
 * convenience: it is how "the ingest did not run the labels" is asserted as a
 * fact about the run rather than as an absence somebody remembered to check.
 *
 * `vi.hoisted` because `vi.mock`'s factory is lifted above the imports and
 * cannot close over an ordinary `const`.
 */
const labelGate = vi.hoisted(() => ({
  calls: 0,
  handler: undefined as undefined | ((opts: LabelOpts) => Promise<LabelRun>),
}));

vi.mock("../src/labels.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/labels.js")>();
  return {
    ...actual,
    async generateLabels(opts: LabelOpts): Promise<LabelRun> {
      labelGate.calls += 1;
      if (!labelGate.handler) {
        throw new Error(
          "the label executor ran while this test had forbidden it. Either `labels` is back in " +
            "DEFAULT_INGEST_STEPS, or something other than the successor job is buying labels — " +
            "which is the ordering this file exists to refuse.",
        );
      }
      return await labelGate.handler(opts);
    },
  };
});

/** What `STEPS.labels.run` hands `generateLabels`; only these four are read here. */
interface LabelOpts {
  tree: Tree;
  blocks: Block[];
  slug: string;
  checkpoints: {
    write(slug: string, namespace: "hierarchy-labels", key: string, value: unknown): Promise<void>;
  };
}

loadEnvLocal();

/* Long, because claiming waits on a contended slot rather than failing on it. */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/** This file's own person, and its own rubble pattern. See pg-session-real-step. */
const OWNER_STEM = "000000d7-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-labels-after-shelf-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

/** What `publishRevisionIn` mints for the successor, computed as production does. */
const SUCCESSOR_WORK_KEY = workKeyFor(["labels"], new Set());

/* ---------------------------------------------------- is there a database -- */

let runLock: HeldRunLock | undefined;

await pgReady({
  suite: "tests/labels-land-after-the-shelf.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
    "spideryarn.checkpoints",
  ],
});

runLock = await takeRunLockAndSetUp(
  "tests/labels-land-after-the-shelf.test.ts",
  async (lockClient) => {
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
      email: `labels-after-shelf-${OWNER}@example.invalid`,
    });
  },
);

/* ------------------------------------------------------------- the fixture -- */

/** Stage 2's document, which the real `blocks` step reads back out of the draft. */
const EXTRACTED_HTML = [
  "<h1>A fixture article</h1>",
  "<p>The opening paragraph of a fixture that exists to prove one ordering.</p>",
  "<p>A middle paragraph, which says nothing in particular but says it at length.</p>",
  "<p>The closing paragraph, which ends the fixture and nothing else.</p>",
].join("\n");

/** What the base revision's labels say, so their disappearance is unambiguous. */
const OLD_LABEL = "A LABEL FROM THE PREVIOUS RUN, WHICH THIS INGEST INVALIDATES";

/** What the successor's run writes, so their arrival is unambiguous. */
const NEW_LABEL = "A LABEL THE SUCCESSOR JOB BOUGHT AFTER THE ARTICLE WAS ON THE SHELF";

/**
 * The whole article as one section — the shape `generateHierarchy` hands
 * `buildTree`, minus the model call that chose the sections.
 */
function rootOver(blocks: Block[]): ModelNode {
  return {
    title: "A fixture article",
    gist: "A fixture built by tests/labels-land-after-the-shelf.test.ts and nothing else.",
    range: [blocks[0]?.id ?? "", blocks[blocks.length - 1]?.id ?? ""],
    children: [],
  };
}

/** One label per block, so `checkCoverage` has nothing to complain about. */
const labelsFor = (blocks: Block[], text: string): Record<string, string> =>
  Object.fromEntries(blocks.map((b, i) => [b.id, `${text} (${i + 1})`]));

/**
 * A tree, built the way the pipeline builds one.
 *
 * `buildTree` then `mergeLabels`, both real, because the invariant both writers
 * of the column keep is `tree === mergeLabels(structure, labels.labels)` — a
 * hand-built literal would satisfy the publication gate while quietly not being
 * that (src/hierarchy.ts § `parts`).
 */
function treeFor(slug: string, blocks: Block[], labels: Record<string, string>): Tree {
  return mergeLabels(buildTree(rootOver(blocks), labels, blocks, slug), labels);
}

/** Every leaf's `navLabel`, in document order, with an absent one as `""`. */
const leafLabels = (tree: Tree): string[] =>
  Object.values(tree.nodes)
    .filter((n) => n.children.length === 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((n) => n.navLabel ?? "");

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
  readonly baseRevisionId: string;
  readonly blocks: Block[];
}

/**
 * A published, fully-labelled article — the state an ingest arrives at.
 *
 * Labelled rather than bare, so that "this ingest published a tree with no
 * labels on it" is a change the assertions can see rather than a fixture that
 * never had any. It carries a `labels` receipt for the same reason: the
 * pending manifest's **deletion** of that receipt (src/store/artifacts-pg.ts)
 * is what stops the successor's step skipping, and a fixture with no receipt
 * would pass whether the deletion happened or not.
 */
async function publishLabelledArticle(slug: string): Promise<Fixture> {
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

  await db
    .update(articleRevisions)
    .set({
      title: "A fixture article",
      excerpt: "A fixture built by tests/labels-land-after-the-shelf.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-09-07T00:00:00.000Z"),
      extractedHtml: EXTRACTED_HTML,
      stampedHtml: seeded.html,
      tree: treeFor(slug, blocks, labelsFor(blocks, OLD_LABEL)),
      navLabelStatus: "ready",
    })
    .where(eq(articleRevisions.id, begun.revisionId));

  for (const name of ["fetch", "extract"] as StepName[]) {
    await stepRun(begun.revisionId, name);
  }
  /* The two run rows that carry a real hash: the publication gate compares
     `hierarchy.input_hash` with `hashBlocks` of the stored blocks and refuses
     when they differ, and the `labels` row is the receipt whose deletion this
     fixture is here to make visible. */
  await stepRun(begun.revisionId, "blocks", hashBlocks(blocks));
  await stepRun(begun.revisionId, "hierarchy", hashBlocks(blocks));
  await stepRun(begun.revisionId, "labels", hashBlocks(blocks));

  await publishRevision({ slug, revisionId: begun.revisionId });

  return { slug, articleId: begun.articleId, baseRevisionId: begun.revisionId, blocks };
}

/* -------------------------------------------------------------- the steps -- */

/**
 * `hierarchy` without the structure call: a tree over the blocks the real step
 * would have read, and the **empty** manifest src/hierarchy.ts writes beside it.
 *
 * Every field is computed by the same function production computes it with, so
 * what the session is handed is a `PendingLabelsFile` rather than something
 * shaped like one — `batches: null` above all, since that single field is what
 * `writeArtefacts` reads as *set `nav_label_status` to `pending` and delete the
 * labels receipt*.
 */
function fakeHierarchy(): PipelineStep<"hierarchy"> {
  return {
    name: "hierarchy",
    label: STEPS.hierarchy.label,
    produces: ["tree", "labels", "blocks"],
    async run(ctx, store) {
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
        detail: "1 section over 4 blocks",
      };
    },
  };
}

/** The registry the jobs are driven with: the real steps, with one fake over them. */
const REGISTRY: StepRegistry = { ...STEPS, hierarchy: fakeHierarchy() };

const PARTS: AdvanceParts = {
  session: (job, attempt) =>
    openPgStoreSession({ slug: job.slug, job: { id: job.id, attemptId: attempt } }),
  steps: REGISTRY,
};

/**
 * A `LabelRun` over every block — what a complete pass returns.
 *
 * `version` and `generator` are the real constants rather than fixture strings:
 * `assertStampAgrees` compares them against what `STEPS.labels.stamp` computes,
 * so anything else is refused at the write and the case would fail for a reason
 * that has nothing to do with the ordering.
 */
function completeRun(opts: LabelOpts, text: string): LabelRun {
  const labels = labelsFor(opts.blocks, text);
  const file: CompletedLabelsFile = {
    slug: opts.slug,
    sourceHash: hashBlocks(opts.blocks),
    structureHash: structureHash(opts.tree),
    structureVersion: opts.tree.version,
    labels,
    version: LABELS_PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    batches: [
      {
        blocks: opts.blocks.map((b) => b.id),
        setStarts: [0],
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        ms: 0,
      },
    ],
  };
  return {
    labels,
    file,
    batches: 1,
    oversized: 0,
    dropped: [],
    resumed: 0,
    calls: 1,
    estimatedCacheable: false,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    elapsedMs: 0,
  };
}

/* --------------------------------------------------------------- the jobs -- */

const db = () => getDb();

function stepsOf(names: StepName[]): JobStep[] {
  return names.map((name) => ({
    name,
    label: STEPS[name].label,
    status: "pending" as const,
    force: true,
  }));
}

/**
 * **The ingest's own step list, minus the three that reach the network**, and
 * derived rather than written out so that this file is inside the claim it is
 * making. Put `labels` back into `DEFAULT_INGEST_STEPS` and the job under test
 * gets it, the gate refuses it by name, and the premise case above goes red as
 * well — which is the mutation this whole file is written against.
 */
const INGEST_STEPS: StepName[] = DEFAULT_INGEST_STEPS.filter(
  (name) => name !== "fetch" && name !== "extract" && name !== "assets",
);

async function queueIngest(slug: string): Promise<string> {
  return await insertWhenSlotFree(slug, async () => {
    const id = mintId();
    await db().insert(jobsTable).values({
      id,
      ownerId: OWNER,
      slug,
      steps: stepsOf(INGEST_STEPS),
      status: "queued",
      workKey: `labels-after-shelf-${id}`,
    });
    return id;
  });
}

/** `advanceJobWith`, waiting out a contended slot. See pg-session-real-step. */
async function advanceWhenSlotFree(id: string) {
  for (let n = 1; n <= 60; n++) {
    const advanced = await advanceJobWith(id, PARTS);
    if (!advanced?.busy || advanced.job.status !== "queued") return advanced;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`advancing ${id} answered busy for 30s: the concurrency cap is full.`);
}

async function successorOf(slug: string) {
  const [row] = await db()
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.slug, slug), eq(jobsTable.workKey, SUCCESSOR_WORK_KEY)))
    .limit(1);
  return row;
}

/* --------------------------------------------------------------- the reads -- */

async function articleRow(slug: string) {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
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

/** The revision the shelf is pointing at, whatever it is. */
async function onTheShelf(slug: string) {
  const article = await articleRow(slug);
  const id = article?.currentRevisionId;
  if (!id) throw new Error(`${slug} is not on the shelf`);
  return { id, revision: await revisionRow(id) };
}

async function runRow(revisionId: string, step: StepName) {
  const [row] = await db()
    .select()
    .from(revisionStepRuns)
    .where(and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, step)))
    .limit(1);
  return row;
}

async function checkpointsFor(articleId: string) {
  return await db()
    .select()
    .from(checkpointRows)
    .where(
      and(eq(checkpointRows.articleId, articleId), eq(checkpointRows.namespace, "hierarchy-labels")),
    )
    .orderBy(asc(checkpointRows.key));
}

const mine = (name: string, body: () => Promise<void>) => it(name, () => runAsOwner(OWNER, body));

/* ------------------------------------------------------------------ tests -- */

describe("an ingest that publishes before its labels are bought", () => {
  afterAll(async () => {
    await cleanUpThenRelease(
      async () => {
        const database = getDb();
        await database.delete(jobsTable).where(eq(jobsTable.ownerId, OWNER));
        const ours = await database
          .select({ id: articles.id })
          .from(articles)
          .where(eq(articles.ownerId, OWNER));
        for (const { id } of ours) {
          await database.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
          await database.delete(articles).where(eq(articles.id, id));
        }
        await closeDb();
        /* On the lock's own connection, so the person is taken away while this
           file still owns the slot rather than in the gap after letting go. */
        await runLock?.client.query("delete from auth.users where id = $1", [OWNER]);
      },
      async () => {
        await runLock?.release();
      },
    );
  });

  /**
   * **The premise**, and without it the case below could pass over a pipeline
   * that had never had a labels step at all. Stated here rather than borrowed
   * from tests/labels-step-registration.test.ts because it is what makes this
   * file's fixture — a job of `["blocks", "hierarchy"]` — an *ingest* rather
   * than an arbitrary two-step job.
   */
  it("runs a step list that does not include the labels", () => {
    expect(DEFAULT_INGEST_STEPS).not.toContain("labels");
    expect(DEFAULT_INGEST_STEPS).toContain("hierarchy");
    /* And the list the job below actually gets, so the two cannot drift. */
    expect(INGEST_STEPS).toEqual(["blocks", "hierarchy"]);
  });

  /**
   * **Property 1**, both halves, in one case because they are one ordering and
   * splitting them would mean publishing twice.
   *
   * Watched red four ways, each a one-line mutation of production code, and
   * each red is quoted as it actually came out:
   *
   * - `writeArtefacts` (src/store/artifacts-pg.ts): `const unrun = false` in
   *   place of `parts.labels.batches === null` — the ingest publishes `ready`
   *   over a tree with no labels in it. `expected 'ready' to be 'pending'`.
   * - `writeArtefacts` again: the `if (unrun)` receipt deletion disabled —
   *   `expected { …(10) } to be undefined` at the `labels` run row. That is the
   *   assertion that stops the second half of this case being vacuous: with the
   *   carried receipt still there the successor's step would **skip**, and every
   *   later assertion would pass over a run that never happened.
   * - `DEFAULT_INGEST_STEPS` (src/pipeline.ts) with `"labels"` added: the
   *   premise case red by name, and this one red at
   *   `expected 'error' to be 'done'` — the gate refuses the executor inside the
   *   ingest, so the job ends rather than hanging on a deferred nothing will
   *   resolve.
   * - `publishRevisionIn` (src/store/pg-revisions.ts): the `draft.navLabelStatus
   *   === "pending"` enqueue deleted — `no labels successor was queued`, which
   *   is the whole of what makes the pending sentence temporary.
   *
   * **The one assertion with no mutation behind it** is the read taken inside
   * the held-open window (`the shelf moved while the labels were still being
   * bought`). Nothing can make that red without inventing a second writer:
   * `STEPS.labels.run` returns its artefacts and the session publishes the
   * draft, so between the executor being entered and the executor returning
   * there is no code that could move the pointer. It is here because a claim
   * that is true by construction is still worth stating where a future change
   * would have to break it.
   */
  mine("publishes to the shelf while the label executor has not run", async () => {
    const slug = `${SLUG_PREFIX}${mintId()}`;
    const fixture = await publishLabelledArticle(slug);

    /* **The premise**: the article on the shelf right now has a label on every
       leaf. Without this, "the ingest published a tree with no labels" would be
       true of a fixture that never had any, and the case would prove nothing. */
    expect((await pgArticleReader.loadArticle(slug)).navLabelStatus).toBe("ready");
    expect(leafLabels((await onTheShelf(slug)).revision?.tree as Tree)).toEqual([
      `${OLD_LABEL} (1)`,
      `${OLD_LABEL} (2)`,
      `${OLD_LABEL} (3)`,
      `${OLD_LABEL} (4)`,
    ]);

    /* Nothing may buy labels during the ingest. */
    labelGate.handler = undefined;
    labelGate.calls = 0;

    const advanced = await advanceWhenSlotFree(await queueIngest(slug));
    expect(advanced?.done, "the ingest job did not finish").toBe(true);
    expect(advanced?.job.status).toBe("done");

    /* --- it reached the shelf, and it is a different revision --- */
    const shelf = await onTheShelf(slug);
    expect(shelf.id).not.toBe(fixture.baseRevisionId);

    /* --- and the labels are not on it --- */
    expect(labelGate.calls, "the ingest bought labels").toBe(0);
    expect(shelf.revision?.navLabelStatus).toBe("pending");
    expect(leafLabels(shelf.revision?.tree as Tree)).toEqual(["", "", "", ""]);
    /* The receipt the pending manifest deletes. Without this the successor's
       step would skip and the second half of this case would pass vacuously. */
    expect(await runRow(shelf.id, "labels")).toBeUndefined();

    /* --- the reader can be served, which is the actual product claim --- */
    const served = await pgArticleReader.loadArticle(slug);
    expect(served.navLabelStatus).toBe("pending");
    expect(served.blocks).toHaveLength(fixture.blocks.length);
    expect(served.blocks.map((b) => b.text)).toEqual(fixture.blocks.map((b) => b.text));

    /* --- and something is queued to make the sentence stop being true --- */
    const successor = await successorOf(slug);
    expect(successor, "no labels successor was queued").toBeDefined();
    expect(successor?.status).toBe("queued");
    expect(successor?.ingestEventId, "the free successor took a quota slot").toBeNull();

    /* ================= the delayed executor, held open ================= */

    let entered!: () => void;
    const hasEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: (run: LabelRun) => void;
    const held = new Promise<LabelRun>((resolve) => {
      release = resolve;
    });
    let seen: LabelOpts | undefined;

    labelGate.handler = async (opts) => {
      seen = opts;
      entered();
      return await held;
    };

    /* Not awaited: the point is the window between these two lines. */
    const running = advanceWhenSlotFree(successor?.id as string);
    await hasEntered;

    /* --- while it is still running, the shelf is unmoved and readable --- */
    const during = await onTheShelf(slug);
    expect(during.id, "the shelf moved while the labels were still being bought").toBe(shelf.id);
    expect(during.revision?.navLabelStatus).toBe("pending");
    expect(leafLabels(during.revision?.tree as Tree)).toEqual(["", "", "", ""]);
    expect((await pgArticleReader.loadArticle(slug)).navLabelStatus).toBe("pending");

    /* --- now let it finish --- */
    release(completeRun(seen as LabelOpts, NEW_LABEL));
    const finished = await running;
    expect(finished?.done, "the labels job did not finish").toBe(true);
    expect(finished?.job.status).toBe("done");

    /* --- and the labels are on the article --- */
    const after = await onTheShelf(slug);
    expect(after.id, "the labels run published nothing").not.toBe(shelf.id);
    expect(after.revision?.navLabelStatus).toBe("ready");
    expect(leafLabels(after.revision?.tree as Tree)).toEqual([
      `${NEW_LABEL} (1)`,
      `${NEW_LABEL} (2)`,
      `${NEW_LABEL} (3)`,
      `${NEW_LABEL} (4)`,
    ]);
    const readable = await pgArticleReader.loadArticle(slug);
    expect(readable.navLabelStatus).toBe("ready");
    expect(readable.blocks.map((b) => b.text)).toEqual(fixture.blocks.map((b) => b.text));
  });

  /**
   * **Property 2.** The executor writes a real checkpoint — durable, in
   * `spideryarn.checkpoints`, exactly where a half-finished run's paid batches
   * live — and then throws.
   *
   * The checkpoint is asserted **before** the tree is, and that ordering is the
   * whole design of the case: without it, "the published tree is unchanged"
   * would pass just as well over a run that did nothing at all, which is the
   * vacuous green docs/reusable/silent-success.md is about.
   *
   * **Watched red** by deleting the `markNavLabelsFailedIn` call from
   * `pg-session.ts`'s failure arm: `expected 'pending' to be 'failed'`, with the
   * article left promising labels nothing is going to buy.
   *
   * The two assertions about the tree — that the shelf did not move and that
   * the stored tree is byte-for-byte what it was — have no mutation of their
   * own here, because a run that **throws** returns nothing for `run()` to
   * write and the tree is safe by the shape of the code. The reachable hazard
   * is a run that *returns* short, and that is the case below, where both of
   * these assertions were watched red.
   */
  mine("leaves the published tree untouched when a part-finished run fails", async () => {
    const slug = `${SLUG_PREFIX}${mintId()}`;
    await publishLabelledArticle(slug);

    labelGate.handler = undefined;
    labelGate.calls = 0;
    const advanced = await advanceWhenSlotFree(await queueIngest(slug));
    expect(advanced?.done).toBe(true);

    const shelf = await onTheShelf(slug);
    expect(shelf.revision?.navLabelStatus).toBe("pending");
    const publishedTree = shelf.revision?.tree as Tree;
    expect(leafLabels(publishedTree)).toEqual(["", "", "", ""]);

    const article = await articleRow(slug);
    expect(await checkpointsFor(article?.id as string)).toHaveLength(0);

    /* Some batches, then a failure — the shape the property is about. */
    labelGate.handler = async (opts) => {
      await opts.checkpoints.write(opts.slug, "hierarchy-labels", "0123456789abcdef", {
        labels: labelsFor(opts.blocks.slice(0, 2), NEW_LABEL),
      });
      throw new Error("the model went away half way through the run");
    };

    const successor = await successorOf(slug);
    const finished = await advanceWhenSlotFree(successor?.id as string);
    expect(finished?.job.status, "the failed labels job did not end as an error").toBe("error");

    /* --- the premise: work really did happen and really was kept --- */
    const kept = await checkpointsFor(article?.id as string);
    expect(kept, "no batch was checkpointed, so this case proves nothing").toHaveLength(1);

    /* --- and none of it reached the tree --- */
    const after = await onTheShelf(slug);
    expect(after.id, "a part-finished labels run published a revision").toBe(shelf.id);
    expect(
      leafLabels(after.revision?.tree as Tree),
      "the published tree kept some of a failed run's labels",
    ).toEqual(["", "", "", ""]);
    expect(after.revision?.tree).toEqual(publishedTree);

    /* --- and the reader is told, rather than left waiting --- */
    expect(after.revision?.navLabelStatus).toBe("failed");
    expect((await pgArticleReader.loadArticle(slug)).navLabelStatus).toBe("failed");
  });

  /**
   * **The other shape of partial output, and the reachable one.**
   *
   * The case above is a run that *threw*, and a run that throws returns nothing
   * for `run()` to write — so the tree is safe by the shape of the code rather
   * than by a check. The dangerous shape is a run that **returns** with some of
   * the article labelled and the rest not: `mergeLabels` has replacement
   * semantics (src/labels.ts:1360), so that map does not merge with what is
   * there, it *becomes* the tree.
   *
   * What stops it is one line — `checkCoverage(parts.labels.labels, parts.tree,
   * file.blocks)` in `STEPS.labels.run`, moved there from `generateHierarchy` by
   * stage 2 — and the hazard tests/hierarchy-leaves-the-labels.test.ts names is
   * that removing it from **both** steps leaves no symptom at all. That file
   * pins where the call lives by reading the source; this one pins what happens
   * when it fires, over the real store.
   *
   * Two of four blocks is 50%, well under `COVERAGE_FLOOR` (0.95). Inside the
   * floor is a different question with a different answer — a batch is allowed
   * to leave a paragraph or two bare, and that tree publishes `ready` — so this
   * case is deliberately far outside it rather than at the boundary.
   *
   * **Watched red** by deleting the `checkCoverage` line from
   * `STEPS.labels.run`: `a half-labelled run was accepted: expected 'done' to
   * be 'error'`, and — with that first assertion taken out so the rest could be
   * reached — `a half-labelled run published a revision`. So the mutation
   * really does put half a run's labels on the shelf, rather than failing
   * earlier for some other reason.
   */
  mine("refuses a run that comes back with half the article labelled", async () => {
    const slug = `${SLUG_PREFIX}${mintId()}`;
    await publishLabelledArticle(slug);

    labelGate.handler = undefined;
    labelGate.calls = 0;
    expect((await advanceWhenSlotFree(await queueIngest(slug)))?.done).toBe(true);

    const shelf = await onTheShelf(slug);
    expect(shelf.revision?.navLabelStatus).toBe("pending");
    const publishedTree = shelf.revision?.tree as Tree;

    /* A complete run, then half its answer taken away — so what reaches the
       step is a real `LabelRun` that is short, rather than a fixture that could
       never have been produced. */
    labelGate.handler = async (opts) => {
      const full = completeRun(opts, NEW_LABEL);
      const half = labelsFor(opts.blocks.slice(0, 2), NEW_LABEL);
      return { ...full, labels: half, file: { ...full.file, labels: half } };
    };

    const successor = await successorOf(slug);
    const finished = await advanceWhenSlotFree(successor?.id as string);
    expect(finished?.job.status, "a half-labelled run was accepted").toBe("error");

    const after = await onTheShelf(slug);
    expect(after.id, "a half-labelled run published a revision").toBe(shelf.id);
    expect(
      leafLabels(after.revision?.tree as Tree),
      "half a run's labels replaced the published tree",
    ).toEqual(["", "", "", ""]);
    expect(after.revision?.tree).toEqual(publishedTree);
    expect(after.revision?.navLabelStatus).toBe("failed");
  });
});
