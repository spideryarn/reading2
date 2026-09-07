/**
 * **Publishing an article whose paragraph labels are not there yet buys the job
 * that makes them — and buys nothing else.**
 *
 * Stage 2b of docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md.
 * Stage 2a took `labels` out of `DEFAULT_INGEST_STEPS` and out of `hierarchy`,
 * so a freshly ingested article now publishes with
 * `article_revisions.nav_label_status = 'pending'` and shows the reader
 * *"Paragraph labels are still arriving"*. Until this stage nothing anywhere
 * made that stop being true.
 *
 * ## The three things this file is about
 *
 * 1. **Where the enqueue lives.** Inside `publishRevisionIn`
 *    (src/store/pg-revisions.ts), not at its call site in `settleIn` — this file
 *    therefore publishes through the **standalone** `publishRevision`, which is a
 *    caller the pipeline never uses, and the successor still appears. That is the
 *    assertion, not an incidental convenience: *a guard that lives in one caller
 *    is a guard the next caller forgets* (GPT Sol, finding 1 of
 *    docs/plans/260901d-stage3-code-review-sol.md), and `pg-glossary.ts` is
 *    already a second caller.
 *
 * 2. **The P0: the successor must never spend a quota slot**, and it is satisfied
 *    by omission rather than by a guard. The only durable fact that makes a job
 *    chargeable is `jobs.ingest_event_id`, and `settleReservation`'s first line is
 *    `if (!ingestEventId) return`. So *you have to work to charge*, and there are
 *    exactly two ways to do it by accident — route the successor through a
 *    request body carrying a `url`, or copy the parent's `ingestEventId` onto it.
 *    Both have a case below with the route named in its title, because the second
 *    one's natural failure is `jobs_ingest_event_unique` surfacing as *"Too many
 *    articles already called X"*: safe, and completely unintelligible.
 *
 * 3. **A `labels` job that dies says so on the revision it was working from** —
 *    which is the draft's **base**, not the draft, because the draft is thrown
 *    away and the base is what the reader is looking at. And only while that base
 *    is still current, so a failure cannot narrate a publication that overtook it
 *    (GPT Sol, F4 of the design review).
 *
 * ## The seven mutations, watched red on 2026-09-07
 *
 * Each one is the production line the case is about, removed. `→` is the whole
 * of the failure message.
 *
 * | mutation | red |
 * |---|---|
 * | the enqueue in `publishRevisionIn` deleted (the state before this stage) | **8 of 11**; case 1 → `publishing a pending revision queued no labels job: expected [] to have a length of 1 but got +0`. The two survivors are the negative controls, cases 2 and 7, which is right |
 * | the enqueue made unconditional | cases 2 and 2b → `a publication whose labels are already there bought a labels job: expected [ { id: 'spya-uz3bzt', …(23) } ] to have a length of +0 but got 1` |
 * | `=== "pending"` → `!== "ready"` | case 2b alone → `publishing an article whose labels already failed bought the job again: expected [ … ] to have a length of +0 but got 1` |
 * | `onConflictDoNothing` removed | cases 6 and 9 → `duplicate key value violates unique constraint "jobs_active_work"` |
 * | the insert moved from `tx` to `getDb()` | case 7 → `a job survived a publication that rolled back: expected [ { id: 'spya-duwyas', …(23) } ] to have a length of +0 but got 1` |
 * | the successor made to copy the slug's paid job's `ingest_event_id` | cases 4 and 5 → `no successor to inspect: expected undefined to be truthy` — see below |
 * | `markNavLabelsFailedIn` not called | case 8 → `the reader is still told the labels are on their way: expected 'pending' to be 'failed'` |
 * | the base/current comparison in `markNavLabelsFailedIn` deleted | case 9 → `the failure narrated a publication it knew nothing about: expected 'failed' to be 'pending'` |
 *
 * **The sixth is the one worth reading twice, because the symptom is not what
 * the design expected.** The plan predicted that copying the parent's
 * `ingestEventId` would surface as *"Too many articles already called X"* —
 * `jobs_ingest_event_unique` sending `enqueue`'s allocation loop round twenty
 * times. That is true of `enqueue`. `enqueueSuccessorIn` has no loop and an
 * `onConflictDoNothing`, so the insert is **swallowed**: no successor exists at
 * all, nothing is logged, nothing is thrown, and the article says *"Paragraph
 * labels are still arriving"* for ever. Safe, and worse to diagnose than the
 * sentence the plan expected. That is why both accidental-charge cases name
 * their route in the title.
 *
 * ## Contention
 *
 * Same shared database as every other suite, so: this file's own owner and its
 * own slug prefix, both swept on the way in and out, and tests/helpers/run-lock.ts
 * because two of the cases claim a job. Copied from
 * tests/pg-session-exact-base.test.ts, which set the pattern.
 */
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { violatesConstraint } from "../src/store/db-errors.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  ingestEvents,
  jobs as jobsTable,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId, mintUniqueId } from "../src/ids.js";
import { runAsOwner } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { mintAttempt, workKeyFor } from "../src/store/jobs.js";
import { pgJobStore, ingestProvenanceOf } from "../src/store/pg-jobs.js";
import { openPgStoreSession } from "../src/store/pg-session.js";
import { settleReservation } from "../src/store/pg-billing.js";
import {
  beginRevision,
  publishRevision,
  publishRevisionIn,
  recordStepRun,
} from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/revisions.js";
import type { StoreSession } from "../src/store/session.js";
import type { Block, Job, JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* Long, because claiming waits on a contended slot rather than failing on it. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** This file's own person, and its own rubble pattern. See pg-session-exact-base. */
const OWNER_STEM = "000000d4-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-labels-successor-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

const LEASE_MS = 60_000;

/** What `enqueueSuccessorIn` must mint, computed the way production computes it. */
const SUCCESSOR_WORK_KEY = workKeyFor(["labels"], new Set());

/* ---------------------------------------------------- is there a database -- */

let runLock: HeldRunLock | undefined;

await pgReady({
  suite: "tests/publication-enqueues-the-labels-successor.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
    "spideryarn.ingest_events",
  ],
});

runLock = await takeRunLockAndSetUp(
  "tests/publication-enqueues-the-labels-successor.test.ts",
  async (lockClient) => {
    await lockClient.query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
    await lockClient.query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
    await lockClient.query("delete from spideryarn.ingest_events where owner_id::text like $1", [
      RUBBLE,
    ]);
    await lockClient.query(
      "update spideryarn.articles set current_revision_id = null where slug like $1",
      [SLUG_RUBBLE],
    );
    await lockClient.query("delete from spideryarn.articles where slug like $1", [SLUG_RUBBLE]);
    await lockClient.query("delete from auth.users where id::text like $1", [RUBBLE]);
    await seedAuthUser(lockClient, {
      id: OWNER,
      email: `labels-successor-${OWNER}@example.invalid`,
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

/**
 * The smallest tree `checkTree` accepts — the publication gate runs the real one.
 *
 * **No `navLabel` on the leaves**, which is what a stage-2a `hierarchy` produces:
 * `buildTree` sets the field from the map it is handed and from nothing else, so
 * a structure-only tree carries none (tests/hierarchy-leaves-the-labels.test.ts).
 * `checkTree`'s complaints about labels are editorial and never refuse.
 */
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
        gist: "A fixture built by tests/publication-enqueues-the-labels-successor.test.ts.",
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
  readonly revisionId: string;
  readonly blocks: Block[];
}

/**
 * A draft, complete enough to publish, with its `nav_label_status` set by hand.
 *
 * Set by hand rather than by running `hierarchy`: this file is about what
 * publication does with the column, and driving the real step here would be a
 * paid model call to prove something about the queue.
 */
async function draftReadyToPublish(
  slug: string,
  navLabelStatus: "pending" | "ready" | "failed",
): Promise<Fixture> {
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
      excerpt: "A fixture built by tests/publication-enqueues-the-labels-successor.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-09-07T00:00:00.000Z"),
      stampedHtml: blocks.map((b) => b.html).join("\n"),
      tree: treeFor(slug, blocks),
      navLabelStatus,
    })
    .where(eq(articleRevisions.id, begun.revisionId));

  for (const name of ["fetch", "extract", "blocks"] as StepName[]) {
    await stepRun(begun.revisionId, name);
  }
  /* The one run row that has to carry a real hash: the publication gate compares
     it with `hashBlocks` of the stored blocks and refuses when they differ. */
  await stepRun(begun.revisionId, "hierarchy", hashBlocks(blocks));

  return { slug, articleId: begun.articleId, revisionId: begun.revisionId, blocks };
}

/** A published article whose labels have not been bought yet. */
async function publishPending(slug: string): Promise<Fixture> {
  const fixture = await draftReadyToPublish(slug, "pending");
  await publishRevision({ slug, revisionId: fixture.revisionId });
  return fixture;
}

/* --------------------------------------------------------------- the reads -- */

const db = () => getDb();

async function successorsOf(slug: string) {
  return await db()
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.slug, slug), eq(jobsTable.workKey, SUCCESSOR_WORK_KEY)));
}

async function navLabelStatusOf(revisionId: string): Promise<string | null> {
  const [row] = await db()
    .select({ status: articleRevisions.navLabelStatus })
    .from(articleRevisions)
    .where(eq(articleRevisions.id, revisionId))
    .limit(1);
  return row?.status ?? null;
}

async function currentRevisionOf(slug: string): Promise<string | null> {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row?.currentRevisionId ?? null;
}

/* -------------------------------------------------------------- a claim -- */

function stepsOf(names: StepName[]): JobStep[] {
  return names.map((name) => ({ name, label: STEPS[name].label, status: "pending" as const }));
}

/**
 * Queue a job **behind** whatever this article already has.
 *
 * Deliberately **not** through `insertWhenSlotFree`: that helper waits for the
 * article's line to be empty, and the whole subject of this file is a job that
 * puts something in that line. Every slug here carries this file's own prefix
 * and is swept on the way in and out, so there is no peer to collide with.
 */
async function queueBehind(slug: string, names: StepName[]): Promise<string> {
  const id = mintId();
  await db()
    .insert(jobsTable)
    .values({
      id,
      ownerId: OWNER,
      slug,
      steps: stepsOf(names),
      status: "queued",
      /* Not `SUCCESSOR_WORK_KEY`: this stands in for some other request, and
         giving it the successor's key would make it collide with the very rows
         the enqueue cases count. */
      workKey: `labels-successor-fixture-${id}`,
    });
  return id;
}

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
 * Claim **the successor the publication queued**, and open its session.
 *
 * The real thing rather than a stand-in: the two failure cases are about what a
 * `labels` job's death does to the article it was working on, and a hand-made
 * job would prove it about a row production never creates.
 */
async function claimTheSuccessor(slug: string): Promise<Claimed> {
  const successor = (await successorsOf(slug))[0];
  if (!successor) throw new Error(`no successor was queued for ${slug}`);
  const attempt = mintAttempt();
  const job = await claimWhenSlotFree(successor.id, attempt);
  const session = await openPgStoreSession({
    slug,
    job: { id: successor.id, attemptId: attempt },
  });
  return { jobId: successor.id, attempt, session, steps: job.steps };
}

const mine = (name: string, body: () => Promise<void>) => it(name, () => runAsOwner(OWNER, body));

/* ------------------------------------------------------------------ tests -- */

describe("publication enqueues the free labels successor", () => {
  afterAll(async () => {
    await cleanUpThenRelease(
      async () => {
        const database = getDb();
        await database.delete(jobsTable).where(eq(jobsTable.ownerId, OWNER));
        await database.delete(ingestEvents).where(eq(ingestEvents.ownerId, OWNER));
        const ours = await database
          .select({ id: articles.id })
          .from(articles)
          .where(eq(articles.ownerId, OWNER));
        for (const { id } of ours) {
          await database
            .update(articles)
            .set({ currentRevisionId: null })
            .where(eq(articles.id, id));
          await database.delete(articles).where(eq(articles.id, id));
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

  mine("a revision that publishes `pending` queues exactly one successor", async () => {
    const slug = `${SLUG_PREFIX}pending`;
    const fixture = await publishPending(slug);

    const queued = await successorsOf(slug);
    expect(queued, "publishing a pending revision queued no labels job").toHaveLength(1);
    const successor = queued[0];
    expect(successor?.status).toBe("queued");
    expect(successor?.ownerId).toBe(OWNER);
    expect(successor?.steps.map((s) => s.name)).toEqual(["labels"]);
    /* And the article really did reach the shelf saying so, which is the state
       the successor exists to end. */
    expect(await currentRevisionOf(slug)).toBe(fixture.revisionId);
    expect(await navLabelStatusOf(fixture.revisionId)).toBe("pending");
  });

  /* ------------------------------------------------------------------ 2 -- */

  /**
   * **The negative control, and it is not decoration.** An enqueue that fired on
   * every publication would pass case 1 and buy a job for every article in the
   * app that already has its labels.
   */
  mine("a revision that publishes `ready` queues none", async () => {
    const slug = `${SLUG_PREFIX}ready`;
    const fixture = await draftReadyToPublish(slug, "ready");
    await publishRevision({ slug, revisionId: fixture.revisionId });

    expect(await navLabelStatusOf(fixture.revisionId)).toBe("ready");
    expect(
      await successorsOf(slug),
      "a publication whose labels are already there bought a labels job",
    ).toHaveLength(0);
  });

  /* ----------------------------------------------------------------- 2b -- */

  /**
   * **`=== "pending"` rather than `!== "ready"`**, which is a decision and not a
   * spelling. A revision whose labels were tried and lost carries `failed`, and
   * a publication of it must not silently buy the same job again — re-running
   * them is a step re-run the reader asks for. Without this case the two
   * spellings are indistinguishable and the comment saying which one it is has
   * nothing behind it.
   */
  mine("a revision that publishes `failed` queues none either", async () => {
    const slug = `${SLUG_PREFIX}failed`;
    const fixture = await draftReadyToPublish(slug, "failed");
    await publishRevision({ slug, revisionId: fixture.revisionId });

    expect(await navLabelStatusOf(fixture.revisionId)).toBe("failed");
    expect(
      await successorsOf(slug),
      "publishing an article whose labels already failed bought the job again",
    ).toHaveLength(0);
  });

  /* ------------------------------------------------------------------ 3 -- */

  mine("the successor's shape is the free one, field by field", async () => {
    const slug = `${SLUG_PREFIX}shape`;
    await publishPending(slug);
    const successor = (await successorsOf(slug))[0];

    expect(successor, "no successor to inspect").toBeTruthy();
    /* `soft`, so one wrong field does not hide the other five. */
    expect.soft(successor?.ingestEventId, "the successor carries a quota slot").toBeNull();
    expect.soft(successor?.profile, "the successor carries a profile").toBeNull();
    expect.soft(successor?.reservesName, "the successor reserves the name").toBe(false);
    expect.soft(successor?.urlKey, "the successor carries a url key").toBeNull();
    expect.soft(successor?.url, "the successor carries a url").toBeNull();
    expect
      .soft(successor?.workKey, "the successor's work key is not `workKeyFor(['labels'], ∅)`")
      .toBe(SUCCESSOR_WORK_KEY);
  });

  /* ------------------------------------------------------------------ 4 -- */

  /**
   * **Accidental charge, route 1: routing the successor through a body carrying a
   * `url`.** That is the ternary at src/routes.ts — `request.url === undefined`
   * takes the free arm, anything else goes through `withIngestSlot` — and it is
   * the only place in the app where free and paid are told apart.
   *
   * The successor never passes a route, so what this asserts is the durable
   * consequence: no `ingest_event_id`, so `settleReservation` returns on its
   * first line and the reader's slot is untouched by a successful successor. The
   * reservation below is settled *through the successor's own provenance*, which
   * is exactly what `settleIn` does when a job ends `done`.
   */
  mine(
    "accidental charge, route 1 — a successor routed through a body with a `url` would spend a slot",
    async () => {
      const slug = `${SLUG_PREFIX}charge-url`;

      /* The parent ingest, as the route would have left it: a reservation the
         reader has paid for, on a job that carries it. Nothing the successor
         does should move that row. */
      const [reservation] = await db()
        .insert(ingestEvents)
        .values({ ownerId: OWNER, slug })
        .returning();
      expect(reservation?.succeededAt, "the fixture reservation is already settled").toBeNull();
      const parentId = mintId();
      await db()
        .insert(jobsTable)
        .values({
          id: parentId,
          ownerId: OWNER,
          slug,
          url: `https://example.com/${slug}`,
          steps: stepsOf(["hierarchy"]),
          status: "done",
          workKey: `labels-successor-parent-${parentId}`,
          reservesName: true,
          ingestEventId: reservation?.id,
        });

      const fixture = await publishPending(slug);
      const successor = (await successorsOf(slug))[0];
      expect(successor, "no successor to inspect").toBeTruthy();
      /* The route's own discriminator, on the row: a successor that had been
         asked for through a body carrying an address would look like the parent
         above. It carries none, so it can never take the paid arm. */
      expect.soft(successor?.url, "the successor carries an address, like a new ingest").toBeNull();

      const provenance = await ingestProvenanceOf(successor?.id ?? "", OWNER);
      expect(
        provenance?.ingestEventId,
        "the successor has provenance, so ending it `done` would charge",
      ).toBeNull();

      /* The whole of the P0, exercised rather than reasoned about: this is the
         line `settleIn` runs when a job ends `done`, handed what the successor
         actually carries. */
      await db().transaction(async (tx) => {
        await settleReservation(tx, provenance?.ingestEventId, {
          kind: "succeeded",
          articleId: fixture.articleId,
        });
      });

      const [after] = await db()
        .select()
        .from(ingestEvents)
        .where(eq(ingestEvents.id, reservation?.id ?? ""));
      expect
        .soft(after?.succeededAt, "the successor settling `done` charged the reader")
        .toBeNull();
      expect.soft(after?.releasedAt, "the successor settling `done` released a slot").toBeNull();
    },
  );

  /* ------------------------------------------------------------------ 5 -- */

  /**
   * **Accidental charge, route 2: copying the parent's `ingestEventId` onto the
   * successor.** `jobs_ingest_event_unique` refuses it — but it surfaces to the
   * reader as *"Too many articles already called X"* after twenty allocation
   * passes, which is safe and completely unintelligible. So this case names the
   * route in its title and proves both halves: the successor carries none, and
   * the copy is what the database refuses.
   */
  mine(
    "accidental charge, route 2 — a successor carrying the parent's `ingest_event_id` is refused by `jobs_ingest_event_unique`",
    async () => {
      const slug = `${SLUG_PREFIX}charge-copy`;

      const [reservation] = await db()
        .insert(ingestEvents)
        .values({ ownerId: OWNER, slug })
        .returning();
      const eventId = reservation?.id as string;

      /* The paid parent: the job the reader's slot actually bought. */
      const parentId = mintId();
      await db()
        .insert(jobsTable)
        .values({
          id: parentId,
          ownerId: OWNER,
          slug,
          steps: stepsOf(["hierarchy"]),
          status: "done",
          workKey: `labels-successor-parent-${parentId}`,
          reservesName: true,
          ingestEventId: eventId,
        });

      await publishPending(slug);
      const successor = (await successorsOf(slug))[0];
      expect(successor, "no successor to inspect").toBeTruthy();
      expect(
        successor?.ingestEventId,
        "the successor copied the parent's quota slot",
      ).toBeNull();

      /* And what it would look like if it had: not a message about billing.
         `violatesConstraint` rather than `toMatchObject`, because drizzle wraps
         the driver error and the constraint name is one link down the chain —
         reading it at the top level misses, which is the same mistake
         src/store/db-errors.ts exists to stop the production code making. */
      const copied = await db()
        .insert(jobsTable)
        .values({
          id: mintId(),
          ownerId: OWNER,
          slug,
          steps: stepsOf(["labels"]),
          status: "queued",
          workKey: `labels-successor-copy-${mintId()}`,
          ingestEventId: eventId,
        })
        .then(() => null)
        .catch((err: unknown) => err);
      expect(
        copied !== null && violatesConstraint(copied, "jobs_ingest_event_unique"),
        "two jobs may share one quota slot",
      ).toBe(true);
    },
  );

  /* ------------------------------------------------------------------ 6 -- */

  /**
   * **Two publications for one article are one successor**, which is what
   * `onConflictDoNothing` against `jobs_active_work` buys. Without it the second
   * publication throws on a unique violation from inside the publication
   * transaction and takes a perfectly good publication down with it.
   */
  mine("a second publication collapses onto the queued successor", async () => {
    const slug = `${SLUG_PREFIX}twice`;
    await publishPending(slug);
    expect(await successorsOf(slug)).toHaveLength(1);

    /* A second revision of the same article, also published pending. */
    const second = await beginRevision({ slug });
    await db()
      .update(articleRevisions)
      .set({ navLabelStatus: "pending" })
      .where(eq(articleRevisions.id, second.revisionId));
    await publishRevision({ slug, revisionId: second.revisionId });

    expect(await currentRevisionOf(slug)).toBe(second.revisionId);
    expect(
      await successorsOf(slug),
      "the second publication queued a second labels job for the same article",
    ).toHaveLength(1);
  });

  /* ------------------------------------------------------------------ 7 -- */

  /**
   * **The successor and the publication are one transaction.** This is the whole
   * reason `enqueueSuccessorIn` inserts on the caller's `tx` rather than reusing
   * `enqueueOrGet`, which opens its own pooled connection: a publication that
   * rolled back after a pooled insert would leave a job queued for a revision
   * nobody is serving.
   */
  mine("a publication that rolls back leaves no successor behind", async () => {
    const slug = `${SLUG_PREFIX}rollback`;
    const fixture = await draftReadyToPublish(slug, "pending");
    const before = await currentRevisionOf(slug);

    await expect(
      db().transaction(async (tx) => {
        await publishRevisionIn(tx, { slug, revisionId: fixture.revisionId });
        throw new Error("the caller's transaction failed after the publication");
      }),
    ).rejects.toThrow("the caller's transaction failed after the publication");

    expect
      .soft(await currentRevisionOf(slug), "the rollback did not take the publication with it")
      .toBe(before);
    expect
      .soft(await successorsOf(slug), "a job survived a publication that rolled back")
      .toHaveLength(0);
  });

  /* ------------------------------------------------------------------ 8 -- */

  /**
   * **A `labels` job that fails says so on the revision it was based on.**
   *
   * The draft the job was writing is thrown away by `failRevisionIn`; the
   * revision wearing *"Paragraph labels are still arriving"* is its **base**, and
   * that is the one a reader is looking at. Without this the sentence stays up
   * for ever, because nothing on the server reaps a queued job and nothing else
   * writes `failed`.
   */
  mine("a failed labels job marks the base revision `failed`", async () => {
    const slug = `${SLUG_PREFIX}fail`;
    const fixture = await publishPending(slug);
    const claimed = await claimTheSuccessor(slug);

    expect(await navLabelStatusOf(fixture.revisionId)).toBe("pending");
    await claimed.session.beginStep(slug, "labels");
    await claimed.session.settleJob({
      kind: "end",
      jobId: claimed.jobId,
      attempt: claimed.attempt,
      ending: { status: "error", steps: claimed.steps, error: "the label pass gave up" },
    });

    expect(
      await navLabelStatusOf(fixture.revisionId),
      "the reader is still told the labels are on their way",
    ).toBe("failed");
    /* And the article is unchanged otherwise: a failure publishes nothing. */
    expect(await currentRevisionOf(slug)).toBe(fixture.revisionId);
  });

  /* ------------------------------------------------------------------ 9 -- */

  /**
   * **And it does not overwrite a publication that overtook it.** GPT Sol, F4:
   * the failure is about the revision the job was working from, so once
   * something else has published, that revision is history and the new one has
   * its own labels story and its own successor.
   */
  mine("a failed labels job leaves a newer publication alone", async () => {
    const slug = `${SLUG_PREFIX}overtaken`;
    const first = await publishPending(slug);
    const claimed = await claimTheSuccessor(slug);

    /* Something else publishes while the job holds its draft. */
    const second = await beginRevision({ slug });
    await db()
      .update(articleRevisions)
      .set({ navLabelStatus: "pending" })
      .where(eq(articleRevisions.id, second.revisionId));
    await publishRevision({ slug, revisionId: second.revisionId });
    expect(await currentRevisionOf(slug)).toBe(second.revisionId);

    await claimed.session.beginStep(slug, "labels");
    await claimed.session.settleJob({
      kind: "end",
      jobId: claimed.jobId,
      attempt: claimed.attempt,
      ending: { status: "error", steps: claimed.steps, error: "the label pass gave up" },
    });

    expect
      .soft(
        await navLabelStatusOf(second.revisionId),
        "the failure narrated a publication it knew nothing about",
      )
      .toBe("pending");
    expect
      .soft(await navLabelStatusOf(first.revisionId), "the base it was working from did not learn")
      .toBe("pending");
  });

  /* ----------------------------------------------------------------- 10 -- */

  /**
   * **Per-slug FIFO still protects the ordering, and this adds no locking.**
   * `blockedByAnother` (src/store/pg-jobs.ts) orders claims on `(created_at,
   * id)`, so a job queued behind the successor answers `busy` until the labels
   * finish. Confirmed rather than assumed, because the successor is the first
   * job in this app to be created by something other than a request.
   */
  mine("a job queued behind the successor waits its turn", async () => {
    const slug = `${SLUG_PREFIX}fifo`;
    await publishPending(slug);
    const successor = (await successorsOf(slug))[0];
    expect(successor, "no successor to queue behind").toBeTruthy();

    const later = await queueBehind(slug, ["arc"]);
    const outcome = await pgJobStore.claim(later, OWNER, mintAttempt(), LEASE_MS, 4);
    expect(
      outcome.kind,
      "a job queued after the successor claimed ahead of it",
    ).toBe("busy");
  });
});
