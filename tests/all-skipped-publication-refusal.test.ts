/**
 * **A publication that does not happen with every step skipped must end the job,
 * not hang it.**
 *
 * GPT Sol's finding 2 on stage 3 of
 * docs/plans/260831b-finish-the-database-move.md
 * (docs/plans/260831b-stage3-items3and4-review-sol.md):
 *
 * > A refusal from a last step is caught by `runStep`, after which a second
 * > transaction marks the step/job failed and discards the draft. That path is
 * > sound. But an all-skipped claim reaches `endJob(...done)` directly. If
 * > `pgStoreSession.settleJob` throws `PublishRefused`, `walkClaim` catches only
 * > `StaleAttemptError` and rethrows.
 *
 * What that costs, and every line of it is a consequence of one uncaught throw:
 * the publication rolls back, the job stays `running`, the draft pointer stays
 * held, the browser retries `/advance` until the lease lapses, the local pump
 * stops at once, and the sweep that eventually collects it records a generic
 * interruption rather than the conflict somebody could act on.
 *
 * ## Why this file exists next to two that look like it
 *
 * `tests/pg-session-exact-base.test.ts` drives the same refusal through
 * **`commit`** — the last step ran — and that is the path with a catcher.
 * `tests/store-pg-session.test.ts` case 7 drives the **all-skipped** path but
 * with nothing to refuse it. Neither can see this, and the fixture is most of
 * the work, so this is the two of them crossed: the all-skipped door, refused.
 *
 * ## The sequence
 *
 * 1. R1 is published, with an `arc` that is current — so a job whose only step
 *    is `arc` skips it and never reaches `commit`.
 * 2. The claim opens a draft, copied from R1, and records R1 as its base.
 * 3. **R2 publishes underneath the claim**, exactly as `db:import` or a
 *    hand-run `publishRevision` can. The test does it from the session factory,
 *    which is the moment after the draft is minted and before the walk starts —
 *    the same order production would see, minutes apart instead of milliseconds.
 * 4. The step skips, the walk reaches `endJob(...done)`, and the publication is
 *    refused by `publishRevisionIn`'s lineage check because the base moved.
 *
 * ## The mutation, watched red on 2026-09-01
 *
 * The `catch (err) { if (!(err instanceof PublishRefused)) throw err; … }` around
 * the walk's final `endJob` deleted from `src/jobs.ts`, which is the state this
 * work found:
 *
 * ```
 * × ends the job with the refusal, fails the draft and lets the pointer go
 * PublishRefused: Refusing to publish "test-all-skipped-refusal-moved": this
 *   draft … was copied from revision … (minted), but the article is now serving
 *   … — something else published while this job ran…
 *  ❯ Object.settleJob src/store/pg-session.ts:595:23
 *  ❯ endJob src/jobs.ts:777:19
 *  ❯ walkClaim src/jobs.ts:1496:19
 *  ❯ Module.advanceJobWith src/jobs.ts:1176:10
 * ```
 *
 * The refusal leaves `advanceJobWith` itself, which is the finding: nothing
 * recorded an ending, so the transaction's rollback leaves the job `running`
 * with its draft pointer held (case 3 reads those rows back under the same
 * mutation), and the request the browser is waiting on answers 409 instead of a
 * job card. The positive control below passed under the mutation as well as
 * after the fix, which is what says the catch records a failure rather than
 * failing every all-skipped claim.
 *
 * ## Contention
 *
 * Same shared database as every other suite, so: this file's own owner and its
 * own slug prefix, both swept on the way in and out, and tests/helpers/run-lock.ts
 * because it claims a job. Copied from tests/pg-session-exact-base.test.ts,
 * which set the pattern.
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
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId, mintUniqueId } from "../src/ids.js";
import { jobWorthRetrying } from "../src/job-failure.js";
import { advanceJobWith, type AdvanceParts } from "../src/jobs.js";
import { runAsOwner } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import type { PipelineStep } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { STORAGE_BUSY, STORAGE_FAILED } from "../src/messages.js";
import { openPgStoreSession } from "../src/store/pg-session.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/revisions.js";
import type { JobEndTransition, StoreSession } from "../src/store/session.js";
import type { Arc, Block, Job, JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* Put the flag back straight away — vitest reuses a worker across files, and the
   modules above have already captured it. */

loadEnvLocal();

/* Long, because claiming waits on a contended slot rather than failing on it. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = path.resolve(import.meta.dirname, "..");

/** This file's own person, and its own rubble pattern. See store-pg-session. */
const OWNER_STEM = "000000c6-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-all-skipped-refusal-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

/**
 * The article content a driver error would have carried into its own message.
 *
 * Not a real title — a string nothing else in the codebase can produce, so that
 * finding it anywhere downstream is unambiguous. See case 3.
 */
const MARKER = "THE ARTICLE TITLE A DRIVER ERROR WOULD HAVE QUOTED";

/** The two arcs, each naming who published it. */
const ARC_R1 = "the arc R1 published";
const ARC_R2 = "the arc R2 published";

/* ---------------------------------------------------- is there a database -- */

let runLock: HeldRunLock | undefined;

await pgReady({
  suite: "tests/all-skipped-publication-refusal.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
  ],
});

/* The sweep runs on the lock's own connection, so it is covered by the key —
   and through `takeRunLockAndSetUp`, so a statement that throws gives the key
   back. This is module scope: no `afterAll` has been registered yet, so
   nothing else would. tests/helpers/lock-lifecycle.ts. */
runLock = await takeRunLockAndSetUp(
  "tests/all-skipped-publication-refusal.test.ts",
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
      email: `all-skipped-refusal-${OWNER}@example.invalid`,
    });
  },
);

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
        gist: "A fixture built by tests/all-skipped-publication-refusal.test.ts and nothing else.",
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

/**
 * R1: a published article whose `arc` is **current**.
 *
 * The `arc` run row is what makes the job's only step skip, and skipping is the
 * whole point — a step that ran would reach `commit`, which is the door this
 * file is not about.
 */
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
      excerpt: "A fixture built by tests/all-skipped-publication-refusal.test.ts.",
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
 * tree and the step runs carry forward exactly as any other publication carries
 * them, and only the arc says who wrote it.
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

/* ---------------------------------------------------------- the fake step -- */

/**
 * An `arc` that **must not run**.
 *
 * The fixture published a current arc, so `stepIsDone` — which for a step with
 * no stamp and no `isDone` reduces to *is the artefact there and is the step not
 * interrupted* — has to answer yes. If it ever answers no, the case is testing
 * the `commit` door instead of the one it is named for, and this says so out
 * loud rather than passing quietly.
 */
function fakeArc(): PipelineStep<"arc"> {
  return {
    name: "arc",
    label: "Reading the shape of the argument",
    outputs: (ctx) => [path.join(ctx.dir, "arc.json")],
    produces: ["arc"],
    async run() {
      throw new Error("the arc step must not run: the fixture published a current one");
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
      workKey: `all-skipped-refusal-${id}`,
    });
    return id;
  });
}

/**
 * `advanceJobWith`, waiting out anybody else who got there first.
 *
 * `busy` with the job still `queued` is contention on the shared database, not
 * an answer about this job. See tests/store-pg-session.test.ts, which explains
 * the distinction this waits on.
 */
async function advanceWhenSlotFree(id: string, parts: AdvanceParts) {
  for (let n = 1; n <= 40; n++) {
    const advanced = await advanceJobWith(id, parts);
    if (!advanced?.busy || advanced.job.status !== "queued") return advanced;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `advancing ${id} answered busy for 20s: something else is already running on this article`,
  );
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

async function revisionRow(revisionId: string) {
  const [row] = await db()
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, revisionId))
    .limit(1);
  return row;
}

async function jobRow(jobId: string) {
  const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  return row;
}

/**
 * One whole claim whose publication throws `thrown`, and the rows it left.
 *
 * The fixture of case 3, taken out of it so that case 4 can run it twice with
 * two different failures and compare the answers. Everything is real except the
 * one settlement: `openPgStoreSession` opens the draft, the `arc` step skips,
 * and the `error` ending the coordinator sends afterwards goes through the real
 * session — so what disposes of the draft is production's statement.
 */
async function failThePublication(
  suffix: string,
  thrown: Error,
): Promise<{
  readonly advanced: Awaited<ReturnType<typeof advanceWhenSlotFree>>;
  readonly row: Awaited<ReturnType<typeof jobRow>>;
  readonly draftId: string;
}> {
  const slug = `${SLUG_PREFIX}${suffix}`;
  await publishR1(slug);
  const jobId = await queueJob(slug, ["arc"]);

  let draftId = "";
  const advanced = await advanceWhenSlotFree(jobId, {
    session: async (job, attempt) => {
      const real = await openPgStoreSession({
        slug: job.slug,
        job: { id: job.id, attemptId: attempt },
      });
      draftId = (await jobRow(job.id))?.draftRevisionId ?? "";
      expect(draftId, "the claim did not open a draft").toBeTruthy();
      return {
        ...real,
        settleJob: async (transition: JobEndTransition) => {
          if (transition.ending.status !== "done") return await real.settleJob(transition);
          throw thrown;
        },
      } satisfies StoreSession;
    },
    steps: { ...STEPS, arc: fakeArc() },
  });

  expect(advanced?.done, "the job has to be over, in this request").toBe(true);
  return { advanced, row: await jobRow(jobId), draftId };
}

const mine = (name: string, body: () => Promise<void>) => it(name, () => runAsOwner(OWNER, body));

/* ------------------------------------------------------------------ tests -- */

describe("a claim where every step skips and the publication does not happen", () => {
  afterEach(async () => {
    await db()
      .delete(jobsTable)
      .where(and(eq(jobsTable.ownerId, OWNER), inArray(jobsTable.status, ["queued", "running"])));
  });

  afterAll(async () => {
    /* Release last, and whatever the cleanup did: one failed statement used to
       skip it, leaving the key held until the worker exited and every peer
       suite waiting on it. tests/helpers/lock-lifecycle.ts. */
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
        /* On the lock's own connection, so the person is taken away while this
           file still owns the slot rather than in the gap after letting go. */
        await runLock?.client.query("delete from auth.users where id = $1", [OWNER]);
      },
      async () => {
        await runLock?.release();
      },
    );
  });

  /* ------------------------------------------------------------------ 1 -- */

  /**
   * **The one this file exists for**, and every assertion is one of the
   * consequences Sol listed.
   */
  mine("ends the job with the refusal, fails the draft and lets the pointer go", async () => {
    const slug = `${SLUG_PREFIX}moved`;
    const fixture = await publishR1(slug);
    const jobId = await queueJob(slug, ["arc"]);

    /* Empty strings rather than `null`, and that is the compiler's doing: these
       are assigned inside the session factory, which the checker cannot see
       into, so it narrows them to `null` at every read below and refuses the
       cast. `toBeTruthy` is what actually holds them to a value. */
    let draftId = "";
    let r2 = "";
    const parts: AdvanceParts = {
      /* **The session factory is where the race is staged**, because it is the
         one moment between the draft being minted — `openPgStoreSession` does
         that, and records R1 as its base — and the walk beginning. In production
         the two are minutes apart and `db:import` lands in between; here they
         are milliseconds apart and this does. */
      session: async (job, attempt) => {
        const session = await openPgStoreSession({
          slug: job.slug,
          job: { id: job.id, attemptId: attempt },
        });
        draftId = (await jobRow(job.id))?.draftRevisionId ?? "";
        expect(draftId, "the claim did not open a draft").toBeTruthy();
        r2 = await publishR2(fixture);
        return session;
      },
      steps: { ...STEPS, arc: fakeArc() },
    };

    const advanced = await advanceWhenSlotFree(jobId, parts);

    /* **Immediate and terminal**, which is the whole finding: no waiting for a
       lease, and an answer the browser's loop stops on. */
    expect(advanced?.done, "the job has to be over, in this request").toBe(true);
    expect(advanced?.ran, "nothing ran: every step skipped").toBeNull();
    expect(advanced?.job.status).toBe("error");
    /* **The publication sentence, not the refusal's own words.** This asserted
       `/Refusing to publish/` until 2026-09-03, on the reasoning that the
       refusal's message is ours and therefore the better thing to show. It is
       ours and it is developer copy: the reasons name block hashes and end with
       *"re-run hierarchy"*, addressed to somebody who cannot run anything. It
       was the last raw diagnostic on a reader-facing field after the stage 2
       seam closed (docs/project/copy.md § The seam between the two audiences),
       and the reasons are on the log line now.

       What this still has to prove is that the ending is *this* door's and not
       a generic interruption, which is what the original assertion was really
       protecting — so it matches `COULD_NOT_PUBLISH`'s own words rather than
       merely being non-empty. */
    expect(
      advanced?.job.error,
      "the reader gets the publication failure, not a generic interruption",
    ).toMatch(/putting the finished article on your shelf/);
    expect(
      advanced?.job.error,
      "the refusal's internal reasons reached the reader",
    ).not.toMatch(/Refusing to publish|re-run hierarchy/);

    /* The row, because the answer above is in memory and the next request reads
       this. `draft_revision_id` cleared is what stops `sweepAbandonedDrafts`
       treating this draft as owned for ever. */
    const row = await jobRow(jobId);
    expect(row?.status, "the job was left running until its lease lapsed").toBe("error");
    expect(row?.error).toMatch(/putting the finished article on your shelf/);
    /* The persisted half, said separately: the band renders `job.error` off the
       row on the next request, so a leak that only reached the row would be
       invisible to the in-memory assertion above. */
    expect(row?.error).not.toMatch(/Refusing to publish|re-run hierarchy/);
    expect(row?.draftRevisionId, "the draft pointer is still held").toBeNull();

    /* The draft is disposed of the same way a last-step refusal disposes of it:
       failed, not left as a draft for the sweeper to age out. */
    expect((await revisionRow(draftId))?.status).toBe("failed");

    /* **And the reader has a button.** Said here because the two fixes of
       2026-08-31 have to hold together: `retryJob` now refuses anything that is
       not `error` or `cancelled`, so a job left `running` by the fault above
       would have no Retry either. Ending it is what gives it one back. */
    expect(jobWorthRetrying(advanced?.job as Job)).toBe(true);

    /* And the publication this refused to bury is still the article. */
    expect(await currentRevisionOf(slug)).toBe(r2);
    expect(await arcTextOf(r2), "R2's work is gone").toBe(ARC_R2);
    expect(fixture.publishedRevisionId).not.toBe(r2);
  });

  /* ------------------------------------------------------------------ 2 -- */

  /**
   * **The positive control.** The same job, with nothing published underneath
   * it: every step still skips, and the claim publishes its draft and finishes
   * `done`. A "fix" that ended every all-skipped claim in an error would pass
   * case 1 and break the commonest ingest there is — a job re-added for an
   * article already on the shelf.
   */
  mine("publishes and finishes as usual when nothing moved underneath it", async () => {
    const slug = `${SLUG_PREFIX}unmoved`;
    await publishR1(slug);
    const jobId = await queueJob(slug, ["arc"]);

    const advanced = await advanceWhenSlotFree(jobId, {
      session: async (job, attempt) =>
        await openPgStoreSession({ slug: job.slug, job: { id: job.id, attemptId: attempt } }),
      steps: { ...STEPS, arc: fakeArc() },
    });

    expect(advanced?.done).toBe(true);
    expect(advanced?.ran).toBeNull();
    expect(advanced?.job.status).toBe("done");
    const row = await jobRow(jobId);
    expect(row?.status).toBe("done");
    expect(row?.draftRevisionId).toBeNull();
    expect(await arcTextOf((await currentRevisionOf(slug)) as string)).toBe(ARC_R1);
  });

  /* ------------------------------------------------------------------ 3 -- */

  /**
   * **Anything else that stops the publication ends the job too**, and the
   * reader is told nothing a database said.
   *
   * The first case is a refusal, which is *our* sentence and safe to show. This
   * is the other half of the same door: a transaction that failed for a reason
   * of its own — the connection went, a constraint fired, a bug threw. GPT Sol
   * asked for it on 2026-09-01, because catching only `PublishRefused` would be
   * right today and a **regression at the flip**: `publishingSession`, the
   * decorator `pgStoreSession` replaces, terminalises the job for every non-stale
   * failure here, so the narrow version would quietly hand back the hang it was
   * written to remove.
   *
   * And the hang would now be worse than it was, because `retryJob` was
   * restricted the same day: a job stuck `running` is neither `error` nor
   * `cancelled`, so there is no Retry button either. The two fixes are
   * individually right and jointly unhelpful unless this one is wide.
   *
   * **The thrown message is a driver error's shape on purpose.** Drizzle builds
   * one out of the failed statement and its bound parameters — for `finishIn`
   * that is the job's `steps` and the article's **title** — so the marker below
   * stands for article content, and the assertion is that none of it reaches the
   * job card or the `jobs` row. A guarded store would already have scrubbed this
   * (src/store/db-errors.ts) and the coordinator deliberately does not rely on
   * that: the session seam takes an unguarded filesystem session too.
   *
   * ## The mutation, watched red on 2026-09-01
   *
   * `if (err instanceof StaleAttemptError) throw err;` put back as
   * `if (!(err instanceof PublishRefused)) throw err;`, which is the narrow
   * version this case exists for:
   *
   * ```
   * × ends the job when the publication fails for a reason of its own
   * Error: Failed query: update "spideryarn"."jobs" … params: THE ARTICLE TITLE…
   *  ❯ endJob src/jobs.ts:777:33
   *  ❯ walkClaim src/jobs.ts:1531:21
   *  ❯ Module.advanceJobWith src/jobs.ts:1196:10
   * ```
   *
   * It leaves `advanceJobWith` altogether. The rows it leaves behind were read
   * in that same run rather than reasoned about — `{"status":"running",
   * "draftRevisionId":"1a7c9c8d-…","draftStatus":"draft"}` — which is the hang,
   * and it is what the three assertions below are against.
   */
  mine("ends the job when the publication fails for a reason of its own", async () => {
    const slug = `${SLUG_PREFIX}broke`;
    const fixture = await publishR1(slug);
    const jobId = await queueJob(slug, ["arc"]);

    let draftId = "";
    const advanced = await advanceWhenSlotFree(jobId, {
      session: async (job, attempt) => {
        const real = await openPgStoreSession({
          slug: job.slug,
          job: { id: job.id, attemptId: attempt },
        });
        draftId = (await jobRow(job.id))?.draftRevisionId ?? "";
        expect(draftId, "the claim did not open a draft").toBeTruthy();
        return {
          ...real,
          /* The publication transaction failing and rolling back: nothing is
             published, the draft is still a draft, the pointer is still held.
             The `error` ending the recovery sends is the real session's, which
             is what fails the draft and lets the pointer go. */
          settleJob: async (transition: JobEndTransition) => {
            if (transition.ending.status !== "done") return await real.settleJob(transition);
            throw new Error(`Failed query: update "spideryarn"."jobs" … params: ${MARKER}`);
          },
        } satisfies StoreSession;
      },
      steps: { ...STEPS, arc: fakeArc() },
    });

    expect(advanced?.done, "the job has to be over, in this request").toBe(true);
    expect(advanced?.job.status).toBe("error");
    expect(advanced?.job.failureKind, "another go is the right move after this one").toBe("retry");

    const row = await jobRow(jobId);
    expect(row?.status, "the job was left running until its lease lapsed").toBe("error");
    expect(row?.draftRevisionId, "the draft pointer is still held").toBeNull();
    expect((await revisionRow(draftId))?.status).toBe("failed");
    expect(await currentRevisionOf(slug)).toBe(fixture.publishedRevisionId);

    /* **The sanitising, said twice.** The card gets a sentence somebody can act
       on, and the thing the driver put in its message gets no further than the
       `catch` that swallowed it. */
    expect(row?.error).toMatch(/putting the finished article on your shelf/);
    expect(row?.error, "a database error's parameters reached the jobs row").not.toContain(MARKER);
    expect(advanced?.job.error).not.toContain(MARKER);
  });

  /* ------------------------------------------------------------------ 4 -- */

  /**
   * **A permanent database failure must not be recorded as a retryable one**,
   * and the two halves of that are the field and the sentence.
   *
   * GPT Sol's finding 3 of docs/plans/260901d-stage3-code-review-sol.md:
   *
   * > `jobs.ts:1578` labels every non-`PublishRefused` error `"retry"`. That
   * > overwrites the distinction already made by the database boundary:
   * > transient `STORAGE_BUSY` is `"retry"`; permanent `STORAGE_FAILED` is
   * > `"bug"` and explicitly says retrying will not help.
   *
   * `guardDbStore` has already done the classifying by the time the coordinator
   * sees the failure — it scrubs a transient SQLSTATE to `STORAGE_BUSY` and
   * everything else to `STORAGE_FAILED`, both of which carry their kind in a
   * trailing `[db-*]` code that `failureKindOf` reads (src/store/db-errors.ts,
   * src/messages.ts). Hard-coding `"retry"` threw that away one layer up, so a
   * constraint violation reached the reader as a Retry button under the words
   * *"Trying again is safe"*, on a job that could only fail identically.
   *
   * **Both, in one case, asserting they differ.** One of them alone can be made
   * to pass by a constant: a version that labels everything `"bug"` passes the
   * `STORAGE_FAILED` half and is just as wrong. What has to be true is that the
   * two inputs come out different, so the case runs both and compares.
   *
   * ## The mutation, watched red on 2026-09-01
   *
   * `recordFailureKind(job, failureKindOf(err) ?? "retry")` in
   * `endAsStorageFailure` put back as the hard-coded
   * `err instanceof PublishRefused ? failureKindOf(err) : "retry"`, and the
   * sentence back to one unconditional string:
   *
   * ```
   * × keeps the kind the database boundary gave a failed publication
   * AssertionError: a permanent database failure was recorded as retryable:
   *   expected 'retry' to be 'bug' // Object.is equality
   * ```
   *
   * and, with the kind restored and only the sentence hard-coded back to one
   * unconditional string:
   *
   * ```
   * AssertionError: the card promised a safe retry under a failure that cannot
   *   come out differently: expected 'Everything ran, but putting the finis…'
   *   not to contain 'Trying again is safe'
   * ```
   *
   * Two mutations rather than one, because the field and the sentence are two
   * halves of the same lie and either can be fixed without the other.
   */
  mine("keeps the kind the database boundary gave a failed publication", async () => {
    /* The two failures exactly as `guardDbStore` builds them: the scrubbed
       sentence, `StoreFailure` as the name, and nothing else — because nothing
       else survives that seam, and the kind has to be readable from what does.
       See `scrubDbError` in src/store/db-errors.ts. */
    const storeFailure = (message: string): Error =>
      Object.assign(new Error(message), { name: "StoreFailure" });

    const busy = await failThePublication("busy", storeFailure(STORAGE_BUSY.message));
    const failed = await failThePublication("failed", storeFailure(STORAGE_FAILED.message));

    /* **They differ**, which is the finding. A version that hard-codes either
       answer passes one line below and fails this one. */
    expect(
      busy.row?.failureKind,
      "a database that was briefly unreachable is worth another go",
    ).toBe("retry");
    expect(
      failed.row?.failureKind,
      "a permanent database failure was recorded as retryable",
    ).toBe("bug");
    expect(busy.row?.failureKind).not.toBe(failed.row?.failureKind);

    /* And the button follows the field, which is the reader's half of it. */
    expect(jobWorthRetrying(busy.advanced?.job as Job)).toBe(true);
    expect(jobWorthRetrying(failed.advanced?.job as Job)).toBe(false);

    /* **The sentence, and it is the half a field alone would not fix.** The
       card is where the reader meets this, and it promised a safe retry
       unconditionally. */
    expect(busy.row?.error).toContain("Trying again is safe");
    expect(
      failed.row?.error,
      "the card promised a safe retry under a failure that cannot come out differently",
    ).not.toContain("Trying again is safe");
    expect(failed.row?.error).toContain("Trying again will not help");

    /* Both are still terminal with the draft disposed of — the fix to the kind
       must not cost the fix to the hang. */
    for (const { row, draftId } of [busy, failed]) {
      expect(row?.status).toBe("error");
      expect(row?.draftRevisionId).toBeNull();
      expect((await revisionRow(draftId))?.status).toBe("failed");
    }
  });
});
