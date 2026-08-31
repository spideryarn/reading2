/**
 * **Does the direct `pgStoreSession` commit path actually work?** — stage 3
 * item 1 of docs/plans/260831b-finish-the-database-move.md, and nothing else.
 *
 * That plan's § *What is proven, and what is only plausible* names one thing as
 * the largest unproven risk in the whole migration:
 *
 * > The direct `pgStoreSession` commit path has never executed in production or
 * > in a real ingest.
 *
 * `tests/store-pg-session.test.ts` already drives `openPgStoreSession` →
 * `pgStoreSession` → `commit` through the real coordinator, and drives it hard —
 * sixteen cases, every one of them watched failing. But every one of them runs a
 * **fake** step: `fakeArc` returns a hand-built `Arc` literal, so what is proved
 * is the coordinator's plumbing, not that a real stage's product survives the
 * trip. Those are different claims, and the flip depends on the second one.
 *
 * So this file asks the second question, once, as literally as it can be asked:
 * the **real `STEPS` registry**, a **real stage** (`blocks` — the only stage
 * that produces two artefacts, needs no model call and no network, and is
 * deterministic), a real job, a real claim, a real Postgres draft, and then the
 * database read back.
 *
 * ## Why `blocks` and not one of the other ten
 *
 * - It costs nothing. Every article-reading stage below it is a paid model call.
 * - It produces **two** parts of different shapes — `blocks` (rows in
 *   `revision_blocks`) and `stampedHtml` (a column) — so it exercises both
 *   halves of `pgArtifactsIn.write`'s mapping rather than one.
 * - It reads through `session.reads` inside its own `run` (`previousBlocksFrom`
 *   and `BLOCKS_INPUT_HTML`), so the read half of the session is on trial too.
 * - `assertProduced` for it reads both parts back **inside the commit's own
 *   transaction**, which on the filesystem is a question that cannot be asked.
 *
 * ## The fixture is deliberately stale, and that is the whole design
 *
 * `blocks` and `stampedHtml` both **carry** into a draft
 * (`REVISION_CARRY_POLICY`), so a `commit` that wrote nothing at all would read
 * the carried copy back, satisfy `assertProduced`, mark the step done and
 * publish — and every naive assertion would pass. That is exactly the failure
 * `tests/store-pg-session.test.ts` case 2 was written for, and it is the failure
 * this repo keeps meeting.
 *
 * So the published fixture is planted with two markers that the real stage
 * cannot reproduce:
 *
 * - `stamped_html` is `STALE_HTML`, prose the article does not contain.
 * - the first block row's `html` is `STALE_BLOCK_HTML` and its `words` is 999.
 *
 * Neither marker is in `hashBlocks` (id and text only) or in `checkTree`, so the
 * publication gate still passes — but both are overwritten by a commit that
 * really writes, and both survive a commit that does not.
 *
 * ## The two mutations, watched red on 2026-08-31
 *
 * **1. `commit` writes nothing** — the `await artifacts.write(...)` line deleted
 * from `commit` in `src/store/pg-session.ts`, which is the plan's own suggestion
 * of "make `commit` a no-op". Seven assertions red, in both halves of the
 * product:
 *
 * ```
 * AssertionError: the commit wrote nothing and the carried stamped HTML was published
 * AssertionError: expected '<p>THE CARRIED STAMPED HTML…' to contain 'id="spya-fcb4jh"'  (×4)
 * AssertionError: the commit wrote nothing and the carried block row survived
 * ```
 *
 * **And the job still reported `done: true`, with a revision published and the
 * pointer cleared.** That is the whole reason the markers exist: every other
 * assertion in this file passed under a commit that wrote nothing at all.
 *
 * **2. `commit` never finishes the step** — `await artifacts.finishStep(...)`
 * deleted: `AssertionError: expected 'running' to be 'done'`. The revision still
 * published, because the publication gate reads the `toc` run row and no other.
 *
 * ## Contention
 *
 * Same shared database as every other suite, so: this file's own owner and its
 * own slug prefix, both swept on the way in and out, and
 * `tests/helpers/run-lock.ts` because it runs a job. See that helper's header.
 */
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { and, eq, inArray, asc } from "drizzle-orm";
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
import { blocksArtefact, runBlocks } from "../src/blocks.js";
import { mintId } from "../src/ids.js";
import { advanceJobWith, type AdvanceParts } from "../src/jobs.js";
import { runAsOwner } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { openPgStoreSession } from "../src/store/pg-session.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/revisions.js";
import { STORE } from "../src/store/live.js";
import type { Block, JobStep, OwnerId, StepName, Tree } from "../src/types.js";
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
const OWNER_STEM = "000000c4-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-pg-real-step-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

/** Prose the article does not contain, so its survival is unambiguous. */
const STALE_HTML = "<p>THE CARRIED STAMPED HTML, WHICH IS STALE</p>";
const STALE_BLOCK_HTML = "<p>THE CARRIED BLOCK HTML, WHICH IS STALE</p>";
const STALE_WORDS = 999;

/* ---------------------------------------------------- is there a database -- */

let runLock: HeldRunLock | undefined;

const { reachable } = await pgReady({
  suite: "tests/pg-session-real-step.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
  ],
});

if (reachable) {
  runLock = await takeRunLock("tests/pg-session-real-step.test.ts");
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
    [OWNER, `pg-session-real-step-${OWNER}@example.invalid`],
  );
}

const when = reachable ? describe : describe.skip;

/* ------------------------------------------------------------- the fixture -- */

/**
 * Stage 2's document: three paragraphs, **no ids**, which is what
 * `extracted_html` holds in Postgres and what `BLOCKS_INPUT_HTML` names.
 */
const EXTRACTED_HTML = [
  "<h1>A fixture article</h1>",
  "<p>The opening paragraph of a fixture that exists to prove one commit path.</p>",
  "<p>A middle paragraph, which says nothing in particular but says it at length.</p>",
  "<p>The closing paragraph, which ends the fixture and nothing else.</p>",
].join("\n");

/** The smallest tree `checkTree` accepts: a root over one leaf per block. */
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
        gist: "A fixture built by tests/pg-session-real-step.test.ts and nothing else.",
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
  /** What the **real** stage produces from `EXTRACTED_HTML`, ids and all. */
  readonly blocks: Block[];
  readonly stampedHtml: string;
}

/**
 * A published article whose blocks are real and whose `stamped_html` is a lie.
 *
 * Seeded through the real `runBlocks` so that the ids, the text and the
 * `hashBlocks` the publication gate compares are all the ones the job under test
 * will produce again — and then two fields are replaced with markers that the
 * real stage cannot reproduce. See the file header on why.
 */
async function publishStaleArticle(slug: string): Promise<Fixture> {
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
      /* The first row carries the markers. Not `text` and not `id`: those two
         are what `hashBlocks` is made of, and changing either would make the
         publication gate refuse for a reason that has nothing to do with this
         test. */
      words: i === 0 ? STALE_WORDS : b.words,
      html: i === 0 ? STALE_BLOCK_HTML : b.html,
      gistable: b.gistable,
      note: null,
    })),
  );

  await db
    .update(articleRevisions)
    .set({
      title: "A fixture article",
      excerpt: "A fixture built by tests/pg-session-real-step.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-08-31T00:00:00.000Z"),
      /* Stage 2's document, which the stage under test reads back out of the
         draft as `BLOCKS_INPUT_HTML`. */
      extractedHtml: EXTRACTED_HTML,
      /* Stage 3's document — the marker. */
      stampedHtml: STALE_HTML,
      tree: treeFor(slug, blocks),
    })
    .where(eq(articleRevisions.id, begun.revisionId));

  for (const name of ["fetch", "extract", "blocks"] as StepName[]) {
    await stepRun(begun.revisionId, name);
  }
  await stepRun(begun.revisionId, "toc", hashBlocks(blocks));

  await publishRevision({ slug, revisionId: begun.revisionId });

  return {
    slug,
    articleId: begun.articleId,
    publishedRevisionId: begun.revisionId,
    blocks,
    stampedHtml: seeded.html,
  };
}

/* ------------------------------------------------------------- the job row -- */

function stepsOf(names: StepName[], force: boolean): JobStep[] {
  return names.map((name) => ({
    name,
    label: STEPS[name].label,
    status: "pending" as const,
    ...(force ? { force: true } : {}),
  }));
}

async function queueJob(slug: string, names: StepName[], force: boolean): Promise<string> {
  const db = getDb();
  return await insertWhenSlotFree(slug, async () => {
    const id = mintId();
    await db.insert(jobsTable).values({
      id,
      ownerId: OWNER,
      slug,
      steps: stepsOf(names, force),
      status: "queued",
      workKey: `pg-real-step-${id}`,
    });
    return id;
  });
}

/**
 * The parts production will pass after the flip, minus the flip: the **real**
 * step registry, and a session opened by `openPgStoreSession`.
 */
const realParts: AdvanceParts = {
  session: (job, attempt) =>
    openPgStoreSession({ slug: job.slug, job: { id: job.id, attemptId: attempt } }),
  steps: STEPS,
};

/** `advanceJobWith`, waiting out a contended slot. See store-pg-session. */
async function advanceWhenSlotFree(id: string) {
  for (let n = 1; n <= 40; n++) {
    const advanced = await advanceJobWith(id, realParts);
    if (!advanced?.busy || advanced.job.status !== "queued") return advanced;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `advancing ${id} answered busy for 20s: something else is already running on this ` +
      "article, or the concurrency cap is full.",
  );
}

/* --------------------------------------------------------------- the reads -- */

const db = () => getDb();

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

async function blockRows(revisionId: string) {
  return await db()
    .select()
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.ordinal));
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

/* ------------------------------------------------------------------ tests -- */

when("a real pipeline stage committing through pgStoreSession", () => {
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

  /**
   * **The one this file exists for.**
   *
   * A forced `{ steps: ["blocks"] }` job — which is what a re-run of stage 3 is —
   * driven by the real coordinator over the real `STEPS` registry, on a session
   * built by `openPgStoreSession`. Everything asserted below is read back out of
   * Postgres afterwards, on a different connection from the one that wrote it.
   */
  mine("writes both its artefacts, finishes the step and publishes", async () => {
    expect(STORE, "the vi.hoisted flag did not reach src/store/live.ts").toBe("postgres");

    const slug = `${SLUG_PREFIX}commit`;
    const fixture = await publishStaleArticle(slug);
    /* The fixture has to be a real article, or the rest of this proves nothing
       about a real stage. Three paragraphs and a heading. */
    expect(fixture.blocks.length).toBeGreaterThanOrEqual(3);

    const jobId = await queueJob(slug, ["blocks"], true);
    const advanced = await advanceWhenSlotFree(jobId);

    /* The coordinator ran the real stage and ended the job. */
    expect(advanced?.ran).toBe("blocks");
    expect(advanced?.done).toBe(true);
    expect(advanced?.job.status).toBe("done");

    /* A new revision is serving the article. */
    const published = (await articleRow(slug))?.currentRevisionId;
    expect(published).toBeTruthy();
    expect(published).not.toBe(fixture.publishedRevisionId);
    const revision = await revisionRow(published as string);
    expect(revision?.status).toBe("published");

    /* **Part one of the product: `stampedHtml`.** The marker is what makes this
       a real assertion — `stamped_html` carries into the draft, so a commit that
       wrote nothing would publish `STALE_HTML` and every other line here would
       still pass. */
    /* `soft`, on this and on the two block-row markers below, so that **one**
       mutation shows all three going red rather than only whichever comes
       first. The two artefacts are written by different statements against
       different tables, and a mutation that dropped one of them would otherwise
       be reported as though it had dropped both. */
    expect
      .soft(revision?.stampedHtml, "the commit wrote nothing and the carried stamped HTML was published")
      .not.toBe(STALE_HTML);
    expect.soft(revision?.stampedHtml).toBe(fixture.stampedHtml);
    /* And it is genuinely stage 3's output rather than stage 2's: every block's
       id is in it, which is the whole reason stage 3 rewrites the document. */
    for (const b of fixture.blocks) expect.soft(revision?.stampedHtml).toContain(`id="${b.id}"`);

    /* **Part two: the blocks**, rows in a different table, written by the same
       transaction. Same marker argument — the first row is the planted one. */
    const rows = await blockRows(published as string);
    /* The ids are the fixture's, in order — so the baseline came back out of the
       draft through `session.reads` and stage 3 carried it, which is the
       contract this whole migration is about (docs/project/block-ids.md). */
    expect(rows.map((r) => r.blockId)).toEqual(fixture.blocks.map((b) => b.id));
    expect(rows.map((r) => r.text)).toEqual(fixture.blocks.map((b) => b.text));
    expect
      .soft(rows[0]?.html, "the commit wrote nothing and the carried block row survived")
      .not.toBe(STALE_BLOCK_HTML);
    expect
      .soft(rows[0]?.words, "the commit wrote nothing and the carried block row survived")
      .not.toBe(STALE_WORDS);
    expect(rows[0]?.html).toBe(fixture.blocks[0]?.html);
    expect(rows[0]?.words).toBe(fixture.blocks[0]?.words);

    /* The step run was finished by this attempt, in the same transaction. */
    const run = await runRow(published as string, "blocks");
    expect(run?.status).toBe("done");

    /* And the job let go of its draft on the way past — `sweepAbandonedDrafts`
       reads any job's pointer as ownership. */
    const [job] = await db().select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
    expect(job?.draftRevisionId).toBeNull();
  });
});
