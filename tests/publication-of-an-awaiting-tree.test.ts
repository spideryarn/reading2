/**
 * **An article that opened early publishes a stand-in tree, and that
 * publication buys the job that builds the real one — and nothing else until
 * the real one lands.**
 *
 * Stage 1 of
 * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md.
 * The stand-in is `tree.provisional === "awaiting-structure"`
 * (src/types.ts § `awaitingStructure`). `publishRevisionIn`
 * (src/store/pg-revisions.ts) reads it:
 *
 * 1. **Awaiting** → exactly one free `["structure"]` job. No `labels` job (they
 *    would label an outline about to be thrown away) and no main-mode job (they
 *    read the tree).
 * 2. **The publication that replaces an awaiting tree with a real one** → the
 *    `labels` job and the main modes, once, as an import's first publication
 *    queues them today. The reader's `auto_modes_off_at` is read at *this*
 *    publication.
 * 3. **Everything else is as it was**: an import that did not open early, and
 *    any later publication over a real tree.
 *
 * Real Postgres, at the primitive, beside
 * tests/publication-queues-the-main-modes.test.ts, whose fixture this copies.
 *
 * ## The mutation watched red, 2026-10-05
 *
 * One, and it is the state before this stage: in `publishRevisionIn`,
 * `awaiting` and `replacesAStandIn` both forced to `false`. **5 of 7 red**;
 * cases 3 and 4 are the controls and stay green, which is right.
 *
 * - case 1 → `an awaiting publication did not queue exactly the structure job:
 *   expected [ [ 'labels' ], [ 'tweets' ], …(7) ] to deeply equal [ [ 'structure' ] ]`
 * - case 7 → `expected [] to deeply equal [ 'queued', 'queued', 'queued', …(5) ]`
 *
 * The two clauses were not mutated one at a time.
 */
import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  jobs as jobsTable,
  readerProfiles,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId, mintUniqueId } from "../src/ids.js";
import { runAsOwner } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/artifacts.js";
import { mintAttempt } from "../src/store/jobs.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import type { Block, JobReset, JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import { pgReady } from "./helpers/pg-ready.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const OWNER_STEM = "0000b61e-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
/** A reader who has switched the main modes off. */
const OPTED_OUT = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const EVERYONE = [OWNER, OPTED_OUT];
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-awaiting-tree-pub-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

/** The main-mode jobs, written out again so the test does not read the code's list. */
const MODES: StepName[][] = [
  ["tweets"],
  ["glossary"],
  ["quotes"],
  ["ideas"],
  ["simple"],
  /* Sources' Bibliography, queued since 2026-10-09 (plan 261009l § On import). */
  ["bibliography"],
  ["crossrefs"],
  ["quotes", "ideas", "skim"],
];

let runLock: HeldRunLock | undefined;

await pgReady({
  suite: "tests/publication-of-an-awaiting-tree.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
    "spideryarn.reader_profiles",
  ],
  columns: [{ table: "spideryarn.reader_profiles", column: "auto_modes_off_at" }],
});

runLock = await takeRunLockAndSetUp(
  "tests/publication-of-an-awaiting-tree.test.ts",
  async (lockClient) => {
    await lockClient.query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
    await lockClient.query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
    await lockClient.query(
      "update spideryarn.articles set current_revision_id = null where slug like $1",
      [SLUG_RUBBLE],
    );
    await lockClient.query("delete from spideryarn.articles where slug like $1", [SLUG_RUBBLE]);
    await lockClient.query("delete from spideryarn.reader_profiles where owner_id::text like $1", [
      RUBBLE,
    ]);
    await lockClient.query("delete from auth.users where id::text like $1", [RUBBLE]);
    for (const id of EVERYONE) {
      await seedAuthUser(lockClient, { id, email: `awaiting-tree-pub-${id}@example.invalid` });
    }
  },
);

await getDb()
  .insert(readerProfiles)
  .values([{ ownerId: OPTED_OUT, autoModesOffAt: new Date("2026-10-05T10:00:00.000Z") }]);

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

/**
 * The smallest tree `checkTree` accepts. `awaiting` makes it the stand-in: the
 * flag, and no gist on the root, which is what a headings tree has.
 */
function treeFor(slug: string, blocks: Block[], awaiting: boolean): Tree {
  const leaves = blocks.map((b, i) => [`n${i + 1}`, b] as const);
  return {
    version: "toc/1",
    generator: "fixture",
    slug,
    rootId: "n0",
    ...(awaiting ? { provisional: "awaiting-structure" as const } : {}),
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: leaves.map(([id]) => id),
        range: [blocks[0]?.id ?? "", blocks[blocks.length - 1]?.id ?? ""],
        title: "A fixture article",
        ...(awaiting ? {} : { gist: "A fixture built by tests/publication-of-an-awaiting-tree.test.ts." }),
      },
      ...Object.fromEntries(
        leaves.map(([id, b]) => [
          id,
          { id, depth: 1, parent: "n0", children: [], range: [b.id, b.id], title: "A paragraph" },
        ]),
      ),
    },
  } as Tree;
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

interface Draft {
  readonly slug: string;
  readonly revisionId: string;
  readonly blocks: Block[];
}

/** An import's draft, complete enough to publish: `pending` labels, as an import has. */
async function importDraft(slug: string, awaiting: boolean): Promise<Draft> {
  const blocks = [
    block(mintUniqueId(MINTED), "The opening paragraph of a fixture that exists for one test."),
    block(mintUniqueId(MINTED), "The closing paragraph, which says nothing in particular."),
  ];
  const begun = await beginRevision({ slug });
  await db()
    .insert(blockIdentities)
    .values(blocks.map((b) => ({ articleId: begun.articleId, blockId: b.id })))
    .onConflictDoNothing();
  await db()
    .insert(revisionBlocks)
    .values(
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
      excerpt: "A fixture built by tests/publication-of-an-awaiting-tree.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-10-05T00:00:00.000Z"),
      stampedHtml: blocks.map((b) => b.html).join("\n"),
      tree: treeFor(slug, blocks, awaiting),
      navLabelStatus: "pending",
    })
    .where(eq(articleRevisions.id, begun.revisionId));
  for (const name of ["fetch", "extract", "blocks"] as StepName[]) {
    await stepRun(begun.revisionId, name);
  }
  await stepRun(begun.revisionId, "structure", hashBlocks(blocks));
  return { slug, revisionId: begun.revisionId, blocks };
}

/**
 * The next draft of an article, copied from what it serves, with its tree
 * replaced or left alone — what a `structure` job, or any other, publishes.
 */
async function nextDraft(from: Draft, tree: "real" | "carried"): Promise<Draft> {
  const begun = await beginRevision({ slug: from.slug });
  if (tree === "real") {
    await db()
      .update(articleRevisions)
      .set({ tree: treeFor(from.slug, from.blocks, false), navLabelStatus: "pending" })
      .where(eq(articleRevisions.id, begun.revisionId));
  }
  return { slug: from.slug, revisionId: begun.revisionId, blocks: from.blocks };
}

interface Running {
  readonly id: string;
  readonly attemptId: string;
}

/** A running job as the fence needs to find it. `reservesName: true` is an import. */
async function runningJob(
  owner: OwnerId,
  slug: string,
  shape: { reservesName: boolean; steps: StepName[]; reset?: JobReset },
): Promise<Running> {
  const running = { id: mintId(), attemptId: mintAttempt() };
  const steps: JobStep[] = shape.steps.map((name) => ({
    name,
    label: STEPS[name].label,
    status: "pending" as const,
  }));
  await db()
    .insert(jobsTable)
    .values({
      id: running.id,
      ownerId: owner,
      slug,
      steps,
      status: "running",
      attemptId: running.attemptId,
      leaseExpiresAt: new Date(Date.now() + 600_000),
      workKey: `awaiting-tree-pub-fixture-${running.id}`,
      reservesName: shape.reservesName,
      ...(shape.reset ? { reset: shape.reset } : {}),
    });
  return running;
}

const IMPORT: StepName[] = ["fetch", "extract", "blocks", "structure", "assets"];

/** Publish `draft` under `job`, then end the job, as a pipeline's last commit does. */
async function publishUnder(draft: Draft, job: Running) {
  const published = await publishRevision({ slug: draft.slug, revisionId: draft.revisionId, job });
  await db()
    .update(jobsTable)
    .set({ status: "done", attemptId: null, leaseExpiresAt: null })
    .where(eq(jobsTable.id, job.id));
  return published;
}

/** The step lists of every queued job on the article, in the order the line claims them. */
async function queuedOn(slug: string): Promise<StepName[][]> {
  const rows = await db()
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.slug, slug))
    .orderBy(asc(jobsTable.createdAt), asc(jobsTable.id));
  return rows.filter((row) => row.status === "queued").map((row) => row.steps.map((s) => s.name));
}

/** An article that opened early: its import's publication, awaiting. */
async function openedEarly(owner: OwnerId, slug: string) {
  const draft = await importDraft(slug, true);
  const job = await runningJob(owner, slug, { reservesName: true, steps: IMPORT });
  const published = await publishUnder(draft, job);
  return { draft, published };
}

/** Take the structure successor off the line, as its own run ending does. */
async function endQueuedStructure(slug: string): Promise<void> {
  const rows = await db().select().from(jobsTable).where(eq(jobsTable.slug, slug));
  for (const row of rows) {
    if (row.status !== "queued") continue;
    if (row.steps.map((s) => s.name).join() !== "structure") continue;
    await db().update(jobsTable).set({ status: "done" }).where(eq(jobsTable.id, row.id));
  }
}

const as = (owner: OwnerId, name: string, body: () => Promise<void>) =>
  it(name, () => runAsOwner(owner, body));
const mine = (name: string, body: () => Promise<void>) => as(OWNER, name, body);

/* ------------------------------------------------------------------ tests -- */

describe("publishing a tree that is awaiting its structure", () => {
  afterAll(async () => {
    await cleanUpThenRelease(
      async () => {
        const database = getDb();
        for (const owner of EVERYONE) {
          await database.delete(jobsTable).where(eq(jobsTable.ownerId, owner));
          const ours = await database
            .select({ id: articles.id })
            .from(articles)
            .where(eq(articles.ownerId, owner));
          for (const { id } of ours) {
            await database.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
            await database.delete(articles).where(eq(articles.id, id));
          }
          await database.delete(readerProfiles).where(eq(readerProfiles.ownerId, owner));
        }
        await closeDb();
        await runLock?.client.query("delete from auth.users where id = any($1)", [EVERYONE]);
      },
      async () => {
        await runLock?.release();
      },
    );
  });

  /* ------------------------------------------------------------------ 1 -- */

  mine("the first publication queues one structure job, and no labels or mode job", async () => {
    const slug = `${SLUG_PREFIX}first`;

    const { published } = await openedEarly(OWNER, slug);

    expect(await queuedOn(slug), "an awaiting publication did not queue exactly the structure job").toEqual([
      ["structure"],
    ]);
    expect(published.structureSuccessor?.kind, "the result does not say the structure job was queued").toBe(
      "queued",
    );
    expect(published.successor, "labels were bought for an outline about to be replaced").toBeNull();
    expect(published.autoModes, "the modes were queued against a stand-in tree").toEqual([]);

    const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, published.structureSuccessor!.jobId));
    expect.soft(row?.ingestEventId, "the structure job carries a quota slot").toBeNull();
    expect.soft(row?.reservesName, "the structure job reserves the name").toBe(false);
    expect.soft(row?.ownerId).toBe(OWNER);
  });

  /* ------------------------------------------------------------------ 2 -- */

  mine("the publication that replaces it queues labels and the modes, once", async () => {
    const slug = `${SLUG_PREFIX}replaced`;
    const { draft } = await openedEarly(OWNER, slug);
    await endQueuedStructure(slug);

    const real = await nextDraft(draft, "real");
    const job = await runningJob(OWNER, slug, { reservesName: false, steps: ["structure"] });
    const published = await publishUnder(real, job);

    expect(await queuedOn(slug), "the real tree's publication did not queue labels then the modes").toEqual([
      ["labels"],
      ...MODES,
    ]);
    expect(published.structureSuccessor, "a real tree queued another structure job").toBeNull();
    expect(published.successor?.kind).toBe("queued");
    expect(published.autoModes.map((o) => o.kind)).toEqual(MODES.map(() => "queued"));

    /* And only that publication: the next one, over a real tree, queues nothing
       new. A mode job's is the ordinary next one. */
    const later = await nextDraft(real, "carried");
    const mode = await runningJob(OWNER, slug, { reservesName: false, steps: ["arc"] });
    const again = await publishUnder(later, mode);
    expect(again.autoModes, "the modes were queued a second time").toEqual([]);
    expect(await queuedOn(slug)).toEqual([["labels"], ...MODES]);
  });

  /* ------------------------------------------------------------------ 3 -- */

  mine("an import that did not open early publishes exactly as before", async () => {
    const slug = `${SLUG_PREFIX}plain`;
    const draft = await importDraft(slug, false);
    const job = await runningJob(OWNER, slug, { reservesName: true, steps: IMPORT });

    const published = await publishUnder(draft, job);

    expect(await queuedOn(slug)).toEqual([["labels"], ...MODES]);
    expect(published.structureSuccessor ?? null).toBeNull();
  });

  /* ------------------------------------------------------------------ 4 -- */

  as(OPTED_OUT, "the reader's switch is read at the publication of the real tree", async () => {
    const slug = `${SLUG_PREFIX}opted-out`;
    const { draft } = await openedEarly(OPTED_OUT, slug);
    await endQueuedStructure(slug);

    const real = await nextDraft(draft, "real");
    const job = await runningJob(OPTED_OUT, slug, { reservesName: false, steps: ["structure"] });
    const published = await publishUnder(real, job);

    expect(await queuedOn(slug), "a reader who switched the modes off got them, or lost the labels").toEqual([
      ["labels"],
    ]);
    expect(published.autoModes).toEqual([]);
  });

  /* ------------------------------------------------------------------ 5 -- */

  /**
   * A job that publishes with the stand-in still in place — `assets` re-run, or
   * a standalone `fetch` — asks for the structure job again and collapses onto
   * the one already queued. It must not be taken for the tree's arrival.
   */
  mine("a later publication still awaiting joins the queued structure job", async () => {
    const slug = `${SLUG_PREFIX}still-awaiting`;
    const { draft, published: first } = await openedEarly(OWNER, slug);

    const carried = await nextDraft(draft, "carried");
    const job = await runningJob(OWNER, slug, { reservesName: false, steps: ["assets"] });
    const published = await publishUnder(carried, job);

    expect(published.structureSuccessor).toEqual({
      kind: "alreadyQueued",
      jobId: first.structureSuccessor?.jobId,
    });
    expect(published.autoModes).toEqual([]);
    expect(await queuedOn(slug)).toEqual([["structure"]]);
  });

  /* ------------------------------------------------------------------ 6 -- */

  mine("a structure holder bound to an older draft is reported, and a later publication can replace it once terminal", async () => {
    const slug = `${SLUG_PREFIX}older-holder`;
    const { draft, published: first } = await openedEarly(OWNER, slug);
    const holderId = first.structureSuccessor!.jobId;
    const heldDraft = await nextDraft(draft, "real");
    await db()
      .update(jobsTable)
      .set({ draftRevisionId: heldDraft.revisionId })
      .where(eq(jobsTable.id, holderId));

    // A publisher whose earlier timestamp arrived late can go before this
    // handed-back holder. Its awaiting revision now has a newer base.
    const carried = await nextDraft(draft, "carried");
    const assets = await runningJob(OWNER, slug, { reservesName: false, steps: ["assets"] });
    const published = await publishUnder(carried, assets);

    expect(published.structureSuccessor).toEqual({ kind: "boundToOlderBase", jobId: holderId });
    expect(published.autoModes).toEqual([]);
    expect(published.successor).toBeNull();
    expect(await queuedOn(slug)).toEqual([["structure"]]);
    await expect(
      publishRevision({ slug, revisionId: heldDraft.revisionId }),
      "the old holder's draft could publish over the newer stand-in",
    ).rejects.toMatchObject({ name: "PublishRefused", status: 409, failureKind: "retry" });

    // The outcome is not automatic recovery. Once that holder leaves the
    // active set, another awaiting publication must buy a fresh successor.
    await db().update(jobsTable).set({ status: "error" }).where(eq(jobsTable.id, holderId));
    const later = await nextDraft(carried, "carried");
    const anotherAssets = await runningJob(OWNER, slug, { reservesName: false, steps: ["assets"] });
    const recovered = await publishUnder(later, anotherAssets);
    expect(recovered.structureSuccessor?.kind).toBe("queued");
    expect(recovered.structureSuccessor?.jobId).not.toBe(holderId);
    expect(recovered.autoModes).toEqual([]);
    expect(await queuedOn(slug)).toEqual([["structure"]]);
  });

  /** A reset has its own `regenerate` list, here empty; it never queues the modes. */
  mine("a reset that replaces the stand-in queues labels and not the modes", async () => {
    const slug = `${SLUG_PREFIX}reset`;
    const { draft } = await openedEarly(OWNER, slug);
    await endQueuedStructure(slug);

    const real = await nextDraft(draft, "real");
    const job = await runningJob(OWNER, slug, {
      reservesName: false,
      steps: IMPORT,
      reset: { regenerate: [] },
    });
    const published = await publishUnder(real, job);

    expect(published.autoModes).toEqual([]);
    expect(await queuedOn(slug)).toEqual([["labels"]]);
  });

  /* ------------------------------------------------------------------ 7 -- */

  /**
   * The way back after the structure job failed: the reader builds it from the
   * Structure band, or presses Rebuild. Either is a job that reserved no name
   * on an article that already serves something — only the awaiting tree it
   * replaces lets the modes in.
   */
  mine("a Rebuild that replaces the stand-in queues the modes too", async () => {
    const slug = `${SLUG_PREFIX}rebuild`;
    const { draft } = await openedEarly(OWNER, slug);
    await endQueuedStructure(slug);

    const real = await nextDraft(draft, "real");
    const job = await runningJob(OWNER, slug, { reservesName: false, steps: IMPORT });
    const published = await publishUnder(real, job);

    expect(published.autoModes.map((o) => o.kind)).toEqual(MODES.map(() => "queued"));
    expect(await queuedOn(slug)).toEqual([["labels"], ...MODES]);
  });
});
