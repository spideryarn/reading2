/**
 * **Press Start again, and a new glossary arrives.** The reader's sentence,
 * asserted end to end rather than one layer down.
 *
 * `tests/store-glossary-delete-pg.test.ts` proves the store: the column goes
 * null, `revision_step_runs` is left alone, and `hasArtefacts` answers false
 * anyway. GPT Sol's review of
 * docs/plans/260903e-glossary-delete-in-postgres.md said the quiet part about
 * that, and it is right — **`hasArtefacts === false` is a claim about the store,
 * not about the reader.** What the button promises is that the *next ordinary
 * run rebuilds the list*, and nothing asserted that. The chain between the two
 * is four separate mechanisms deep (`has` → `stepIsDone` → the step walk →
 * `publishRevisionIn`), and every one of them is a place the promise could be
 * broken while the store test stayed green.
 *
 * So this file drives the real thing: a real job row, a real claim,
 * `openPgStoreSession`, the real coordinator (`advanceJobWith`), the real step
 * registry, a real Postgres draft, a real publication — and then reads the
 * answer back out of the database on a different connection.
 *
 * ## The three moves, in the order a reader makes them
 *
 * 1. **An unforced run while the list is there does nothing.** The fake step is
 *    not called, and the glossary column still holds the old term. Without this
 *    the test would be vacuous: a coordinator that ran the glossary step
 *    unconditionally would pass move 3 while the feature was broken, because
 *    "the step ran after the delete" is only interesting if it would *not* have
 *    run before it.
 * 2. **The delete**, through `pgGlossaryStore.deleteGlossary` — the same call
 *    `DELETE /api/glossary/:slug` makes.
 * 3. **An unforced run now runs the step and publishes a replacement.** Not
 *    forced, because forcing is the thing `reset` must never do: the glossary
 *    step *appends* (src/glossary.ts), so a forced run would lengthen the list
 *    the reader just asked to be rid of. The request `reset` posts is the same
 *    unforced one move 1 posts, which is why move 1 and move 3 build their job
 *    rows the same way.
 *
 * ## The fake step, and what money has to do with it
 *
 * The real `glossary` step is a model call over the whole article. A test may
 * not spend money, and `tests/setup/no-provider-calls.ts` refuses a provider
 * request anyway — so `run` is replaced with one that returns a hand-built
 * `Glossary` and counts its calls. Everything around it is real: the same
 * `produces: ["glossary"]`, the same write through `pgArtifactsIn`, the same
 * postcondition, the same commit.
 *
 * **It carries no `stamp`, deliberately**, and that is the same choice
 * `fakeTweets` makes in tests/store-pg-session.test.ts for the same reason. The
 * real stamp compares three values a fixture cannot honestly supply — the
 * article's input hash, the prompt version and the model id — and comparing them
 * is not what this file is about. Without a stamp, `stepIsDone`
 * (src/pipeline.ts) reduces to *is the step uninterrupted and does
 * `has("glossary", ["glossary"])` answer yes*, which is **exactly** the question
 * the delete changes the answer to. Staleness has its own tests; this one is
 * about presence.
 *
 * ## What moves 1 and 3 prove that the store test cannot
 *
 * That `revision_step_runs` still saying `glossary: done` after the delete is
 * survivable in the runner and not merely in `hasArtefacts`. The plan calls that
 * out as the trap — a deleted glossary that nothing regenerates would be
 * strictly worse than the 501 it replaced — and this is the trap asked of the
 * coordinator rather than of one function.
 *
 * ## Watched red, 2026-09-03
 *
 * Two mutations, both in this file so that neither touches shipped code:
 *
 * **1. Skip the delete** (move 2 commented out). The step is still current, so
 * the run skips and nothing is republished:
 *
 * ```
 * AssertionError: the unforced run did not run the glossary step, so the delete
 *   bought the reader nothing: expected null to be 'glossary'
 * ```
 *
 * **2. The step writes the list back unchanged** — the fake returning the *old*
 * glossary instead of a new one, which is what a `reset` that quietly appended
 * would look like from the outside:
 *
 * ```
 * AssertionError: the rebuilt glossary is the old list: expected [ 'reticulation' ]
 *   to deeply equal [ 'anastomosis' ]
 * ```
 *
 * The second is why the two glossaries have different terms rather than being
 * two copies of one fixture: the column is non-null in both worlds, and only the
 * term tells them apart.
 *
 * ## Contention
 *
 * One shared local Postgres, so the same discipline as every other suite that
 * runs a job: this file's own owner id and slug prefix, swept on the way in and
 * out, and `tests/helpers/run-lock.ts` because it claims. See
 * tests/pg-session-real-step.test.ts, whose fixture shape this borrows.
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
import { blocksArtefact, runBlocks } from "../src/blocks.js";
import { mintId } from "../src/ids.js";
import { advanceJobWith, type AdvanceParts } from "../src/jobs.js";
import { runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { openPgStoreSession } from "../src/store/pg-session.js";
import { pgGlossaryStore } from "../src/store/pg-glossary.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/revisions.js";
import { STORE } from "../src/store/live.js";
import type { Block, Glossary, JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* Put the flag back straight away — vitest reuses a worker across files, and the
   modules above have already captured it. */
if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

loadEnvLocal();

/* Long, because claiming waits on a contended slot rather than failing on it. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = path.resolve(import.meta.dirname, "..");

/** This file's own person, and its own rubble pattern. See pg-session-real-step. */
const OWNER_STEM = "000000c7-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

/* `test-` prefixed so tests/store-parity.test.ts skips it by name. */
const SLUG_PREFIX = "test-glossary-rebuild-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

/** The term the fixture publishes, and the term the rebuild must replace it with. */
const OLD_TERM = "reticulation";
const NEW_TERM = "anastomosis";

/* ---------------------------------------------------- is there a database -- */

let runLock: HeldRunLock | undefined;

const { reachable } = await pgReady({
  suite: "tests/glossary-delete-then-rebuild.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
  ],
});

if (reachable) {
  runLock = await takeRunLockAndSetUp(
    "tests/glossary-delete-then-rebuild.test.ts",
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
        email: `glossary-rebuild-${OWNER}@example.invalid`,
      });
    },
  );
}

const when = reachable ? describe : describe.skip;

/* ------------------------------------------------------------- the fixture -- */

/** Stage 2's document: a heading and three paragraphs, no ids. */
const EXTRACTED_HTML = [
  "<h1>A fixture article</h1>",
  "<p>The opening paragraph of a fixture that exists to prove one button works.</p>",
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
        gist: "A fixture built by tests/glossary-delete-then-rebuild.test.ts and nothing else.",
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

/**
 * A glossary of exactly one term.
 *
 * `sourceHash` is a real `hashBlocks`, because `whyUnusableAsBaseline`
 * (src/store/artifacts.ts) refuses a glossary whose hash cannot be compared —
 * and a refusal there is `unusable`, which reads back the same as absent and
 * would make move 1 skip for the wrong reason.
 */
function glossaryOf(slug: string, blocks: Block[], term: string): Glossary {
  return {
    version: "glossary/2",
    generator: "fixture",
    slug,
    sourceHash: hashBlocks(blocks),
    profileHash: null,
    /* `blocks` names a block the article really has, because "empty is
       meaningful" (src/types.ts § `GlossaryEntry.blocks`) and a fixture that
       said the term appears nowhere would be describing a different bug. */
    entries: [
      {
        id: mintId(),
        name: term,
        kind: "concept",
        aliases: [],
        blocks: [blocks[0]?.id ?? ""],
      },
    ],
    passes: 1,
    generatedAt: "2026-09-03T00:00:00.000Z",
    elapsedMs: 1,
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
  readonly publishedRevisionId: string;
  readonly blocks: Block[];
}

/**
 * A published article that already has a glossary, and a `revision_step_runs`
 * row saying the step that made it is `done`.
 *
 * Both halves are needed and neither is decoration: `hasArtefacts`
 * (src/store/artifacts-pg.ts) requires the run row **and** the column, so a
 * fixture missing either would make move 1 skip nothing and move 3 prove
 * nothing.
 */
async function publishArticleWithAGlossary(slug: string): Promise<Fixture> {
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
      excerpt: "A fixture built by tests/glossary-delete-then-rebuild.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-09-03T00:00:00.000Z"),
      extractedHtml: EXTRACTED_HTML,
      stampedHtml: seeded.html,
      tree: treeFor(slug, blocks),
      glossary: glossaryOf(slug, blocks, OLD_TERM),
    })
    .where(eq(articleRevisions.id, begun.revisionId));

  for (const name of ["fetch", "extract", "blocks"] as StepName[]) {
    await stepRun(begun.revisionId, name);
  }
  await stepRun(begun.revisionId, "hierarchy", hashBlocks(blocks));
  /* The row that makes the published glossary count as *produced* rather than
     merely present. Without it `hasArtefacts` is false from the start and move
     1 would run the step, which is the opposite of the baseline. */
  await stepRun(begun.revisionId, "glossary", hashBlocks(blocks));

  await publishRevision({ slug, revisionId: begun.revisionId });

  return { slug, publishedRevisionId: begun.revisionId, blocks };
}

/* ------------------------------------------------------------ the fake step -- */

interface StepLog {
  calls: number;
}

/**
 * `glossary`, with the model call taken out and nothing else changed.
 *
 * See the file header on why it carries no `stamp`. It writes a **different**
 * term from the one the fixture published, so "the column is non-null" cannot be
 * mistaken for "the list was rebuilt".
 */
function fakeGlossary(slug: string, blocks: Block[], log: StepLog): PipelineStep<"glossary"> {
  return {
    name: "glossary",
    label: STEPS.glossary.label,
    outputs: (ctx) => [path.join(ctx.dir, "glossary.json")],
    produces: ["glossary"],
    async run() {
      log.calls += 1;
      return {
        parts: { glossary: glossaryOf(slug, blocks, NEW_TERM) },
        detail: "1 term",
      };
    },
  };
}

/* ------------------------------------------------------------- the job row -- */

/**
 * **Unforced**, which is the whole point: `reset` posts the same request the
 * "find the terms" button posts, and never a forced one, because forcing the
 * glossary step appends to the list rather than replacing it.
 */
function unforcedGlossaryStep(): JobStep[] {
  return [{ name: "glossary", label: STEPS.glossary.label, status: "pending" }];
}

async function queueGlossaryJob(slug: string): Promise<string> {
  const db = getDb();
  return await insertWhenSlotFree(slug, async () => {
    const id = mintId();
    await db.insert(jobsTable).values({
      id,
      ownerId: OWNER,
      slug,
      steps: unforcedGlossaryStep(),
      status: "queued",
      workKey: `glossary-rebuild-${id}`,
    });
    return id;
  });
}

/** The parts production passes, with the fake over the one paid step. */
function partsWith(step: PipelineStep<"glossary">): AdvanceParts {
  return {
    session: (job, attempt) =>
      openPgStoreSession({ slug: job.slug, job: { id: job.id, attemptId: attempt } }),
    steps: { ...STEPS, glossary: step },
  };
}

/** `advanceJobWith`, waiting out a contended slot. See pg-session-real-step. */
async function advanceWhenSlotFree(id: string, parts: AdvanceParts) {
  for (let n = 1; n <= 40; n++) {
    const advanced = await advanceJobWith(id, parts);
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

async function servingRevisionId(slug: string): Promise<string> {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  const id = row?.currentRevisionId;
  if (!id) throw new Error(`${slug} is serving no revision, so there is nothing to read`);
  return id;
}

async function revisionRow(id: string) {
  const [row] = await db()
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, id))
    .limit(1);
  return row;
}

/** The terms the reader would see, or `null` for a panel with nothing in it. */
async function termsServed(slug: string): Promise<string[] | null> {
  const revision = await revisionRow(await servingRevisionId(slug));
  return revision?.glossary?.entries.map((e) => e.name) ?? null;
}

async function glossaryRunStatus(revisionId: string): Promise<string | undefined> {
  const [row] = await db()
    .select()
    .from(revisionStepRuns)
    .where(
      and(
        eq(revisionStepRuns.revisionId, revisionId),
        eq(revisionStepRuns.stepName, "glossary"),
      ),
    )
    .limit(1);
  return row?.status;
}

const mine = (name: string, body: () => Promise<void>) => it(name, () => runAsOwner(OWNER, body));

/* ------------------------------------------------------------------ tests -- */

when("Start again, through the real claim and session path", () => {
  afterEach(async () => {
    if (!reachable) return;
    await db()
      .delete(jobsTable)
      .where(and(eq(jobsTable.ownerId, OWNER), inArray(jobsTable.status, ["queued", "running"])));
  });

  afterAll(async () => {
    if (!reachable) return;
    await cleanUpThenRelease(
      async () => {
        const database = getDb();
        await database.delete(jobsTable).where(eq(jobsTable.ownerId, OWNER));
        const ours = await database
          .select({ id: articles.id, slug: articles.slug })
          .from(articles)
          .where(eq(articles.ownerId, OWNER));
        for (const { id, slug } of ours) {
          await database
            .update(articles)
            .set({ currentRevisionId: null })
            .where(eq(articles.id, id));
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

  /**
   * **The one this file exists for**, and it is one test rather than three
   * because the three moves are one sentence: the run before the delete is the
   * control for the run after it, and splitting them would leave each half
   * proving nothing on its own.
   */
  mine("deletes the list, and the next ordinary run publishes a new one", async () => {
    expect(STORE, "the vi.hoisted flag did not reach src/store/live.ts").toBe("postgres");

    const slug = `${SLUG_PREFIX}reset`;
    const fixture = await publishArticleWithAGlossary(slug);
    const log: StepLog = { calls: 0 };
    const parts = partsWith(fakeGlossary(slug, fixture.blocks, log));

    /* The fixture is a real article, or the rest of this proves nothing. */
    expect(fixture.blocks.length).toBeGreaterThanOrEqual(3);
    expect(await termsServed(slug), "the fixture published no glossary").toEqual([OLD_TERM]);

    /* ---- move 1: an unforced run while the list is there does nothing ---- */

    const before = await advanceWhenSlotFree(await queueGlossaryJob(slug), parts);
    expect(before?.done).toBe(true);
    expect(
      before?.ran,
      "the unforced run rebuilt a glossary that was already there, so move 3 proves nothing",
    ).toBeNull();
    expect(log.calls, "the glossary step ran while its artefact was current").toBe(0);
    expect(await termsServed(slug)).toEqual([OLD_TERM]);

    /* The revision the reader is being served *now* — move 1 published the
       draft it copied (the all-skipped case in src/store/pg-session.ts), so the
       pointer has moved and the fixture's own id is no longer the live one. */
    const beforeDelete = await servingRevisionId(slug);

    /* ---- move 2: the reader presses Start again, and the DELETE lands ---- */

    expect(await pgGlossaryStore.deleteGlossary(slug)).toEqual({ deleted: true });
    expect((await revisionRow(beforeDelete))?.glossary, "the column was not nulled").toBeNull();
    /* The run row is untouched on purpose and still says the step finished —
       the trap the plan names. Everything below is that trap surviving contact
       with the coordinator rather than with `hasArtefacts` alone. */
    expect(await glossaryRunStatus(beforeDelete)).toBe("done");

    /* ---- move 3: the next ordinary run rebuilds it ---- */

    const after = await advanceWhenSlotFree(await queueGlossaryJob(slug), parts);
    expect(
      after?.ran,
      "the unforced run did not run the glossary step, so the delete bought the reader nothing",
    ).toBe("glossary");
    expect(after?.done).toBe(true);
    expect(after?.job.status).toBe("done");
    expect(log.calls).toBe(1);

    /* A **new** revision is serving the article, and it holds the new list. */
    const afterRun = await servingRevisionId(slug);
    expect(afterRun, "the article is still serving the revision the delete emptied").not.toBe(
      beforeDelete,
    );
    expect((await revisionRow(afterRun))?.status).toBe("published");
    expect(await termsServed(slug), "the rebuilt glossary is the old list").toEqual([NEW_TERM]);

    /* And the job let go of its draft on the way past — `sweepAbandonedDrafts`
       reads any job's pointer as ownership. */
    const [job] = await db()
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, after?.job.id ?? ""))
      .limit(1);
    expect(job?.draftRevisionId).toBeNull();
  });
});
