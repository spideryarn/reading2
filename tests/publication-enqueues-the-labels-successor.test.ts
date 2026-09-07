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
 *    docs/plans/260901d-stage3-code-review-sol.md), and the wrapper this file
 *    goes through is already the second one.
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
 *    (GPT Sol, F4 of the design review). **Two ways of dying, and the second is
 *    the likelier one**: the claimant settles its own job, or its lease runs out
 *    and `settleExpired` ends it with nobody inside it. The label pass is the
 *    slowest step in the app, so running out of lease is its ordinary ending, and
 *    until stage 2c that ending wrote nothing anywhere.
 *
 * 4. **Which conflict the successor's insert hit**, asked rather than assumed. A
 *    holder with no draft is the de-duplication and is collapsed onto. A holder
 *    that owns a draft is working from an earlier base and can never finish this
 *    revision, so the publication goes ahead and **says so** — it refused with a
 *    409 for one day, and an ordinary route into that refusal turned out to exist
 *    (case 9). Anything else was not the dedupe at all: the insert is asked once
 *    more with a fresh id, because the holder can leave between the insert and the
 *    read, and only a second conflict with nothing holding it throws.
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
 * | the base/current comparison in `markNavLabelsFailedIn` deleted | case 9b → `the failure narrated a publication it knew nothing about: expected 'failed' to be 'pending'` |
 *
 * ## And the mutations the two reviews added, watched red on 2026-09-07
 *
 * | mutation | red |
 * |---|---|
 * | the marking loop in `settleExpired` deleted (the state before stage 2c) | cases 11 and 12 → `the reader is still told the labels are on their way, and nothing is queued to make them: expected 'pending' to be 'failed'`. Cases 13 and 14 are the negative controls and stay green, which is right |
 * | the `ownerId` argument dropped from `settleExpired`'s call to `markNavLabelsFailedIn` | case 12 **alone** → `the sweep answered for the wrong owner's shelf and marked nothing`. Case 11 stays green, because a reader's own poll sweeps under their own owner — which is exactly what makes this the mistake nothing would report |
 * | the "nothing active holds it" throw made a `return null` | case 16 → `promise resolved "{ …(5) }" instead of rejecting` |
 * | the second insert attempt removed, so one conflict is believed | case 17 → `the retry did not queue the successor this publication needed` |
 * | `boundToOlderBase` folded back into `alreadyQueued` | case 9 → `the publication swallowed a successor that can never finish this revision` |
 * | the step-list filter narrowed back to `status === "running"` | case 15b → `a claimant that died a moment earlier left the sentence up for ever` |
 * | the live-promise check after the settlement removed | case 15e → `the reader was told the labels failed while the job that makes them was still queued` |
 * | the warning branch in `logPublication` deleted | case 9 → `nothing in the log says this revision will never get its labels` |
 * | `lockArticlesInSlugOrder` made to return everything it was handed | case 15d → `a row whose article could not be locked was reported as locked`. **Not** 15c, which cannot tell the two apart and says so in its own comment |
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

import { and, eq, sql } from "drizzle-orm";
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
  lockArticlesInSlugOrder,
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

/**
 * **A way to make `mintId` collide on purpose**, and nothing else.
 *
 * Two cases here are about the conflict that is *not* the de-duplication, and
 * the only one of those reachable today is `jobs_pkey` — which needs the
 * successor to mint an id that is already taken. Waiting for that is not a test.
 *
 * **A queue rather than a switch**, because `enqueueSuccessorIn` gets two
 * attempts with a fresh id each: forcing *one* collision proves the retry lands,
 * forcing *both* proves the throw. Ids are consumed in order and anything not
 * forced is a real one, so every other id in this file is genuine.
 *
 * `vi.hoisted` because `vi.mock`'s factory is lifted above the imports and cannot
 * close over an ordinary `const`.
 */
const idControl = vi.hoisted(() => ({ forced: [] as string[] }));
vi.mock("../src/ids.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ids.js")>();
  return { ...actual, mintId: () => idControl.forced.shift() ?? actual.mintId() };
});

/**
 * **Every `warn` this suite's code emits**, captured.
 *
 * One case needs it: since the 409 came out, a line in the log is the **only**
 * thing that says an article has reached the shelf promising labels nothing will
 * buy. An untested mitigation is not a mitigation — deleting the branch left this
 * suite green until this existed. GPT Sol, G6 of the second stage 2c review.
 *
 * **Mocked rather than read off stdout**, the same shape and the same reason as
 * tests/store-shelf-reads.test.ts: `src/log.ts` is `silent` under `NODE_ENV=test`
 * on purpose, so asserting against the real logger would pass against a logger
 * that emits nothing — the vacuous green this repo keeps a document about
 * (docs/reusable/silent-success.md). `vi.hoisted` for the array because
 * `vi.mock`'s factory is lifted above the imports and would otherwise read it in
 * the temporal dead zone.
 */
const warnings = vi.hoisted(
  () => [] as { fields: Record<string, unknown>; message: string }[],
);
vi.mock("../src/log.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/log.js")>();
  const capture = {
    debug() {},
    info() {},
    warn(fields: Record<string, unknown>, message: string) {
      warnings.push({ fields, message });
    },
    error() {},
    child() {
      return capture;
    },
  };
  return { ...actual, log: () => capture };
});

/* Long, because claiming waits on a contended slot rather than failing on it. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** This file's own person, and its own rubble pattern. See pg-session-exact-base. */
const OWNER_STEM = "000000d4-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
/**
 * **A second real person**, for the one case that needs a job row to belong to
 * somebody who owns no article of that name.
 *
 * A bare uuid will not do: `jobs.owner_id` carries a foreign key to `auth.users`
 * (`jobs_owner_fk`) that is in the database rather than in src/db/schema.ts, so
 * an unseeded owner fails the insert with a `23503` rather than proving anything.
 * Case 12's stranger is different and stays a bare uuid — it is only ever the
 * *ambient* owner, and nothing is written under it.
 */
const STRANGER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
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
    await seedAuthUser(lockClient, {
      id: STRANGER,
      email: `labels-successor-${STRANGER}@example.invalid`,
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
async function queueBehind(
  slug: string,
  names: StepName[],
  /**
   * **When the row says it was asked for**, which decides who claims first.
   *
   * `blockedByAnother` (src/store/pg-jobs.ts) orders the article's line on
   * `(created_at, id)`, so a job that has to claim *ahead* of a successor already
   * queued has to say it was asked for earlier. Default is now, which is behind
   * everything.
   */
  createdAt?: Date,
): Promise<string> {
  const id = mintId();
  await db()
    .insert(jobsTable)
    .values({
      id,
      ownerId: OWNER,
      slug,
      steps: stepsOf(names),
      status: "queued",
      ...(createdAt ? { createdAt } : {}),
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

/**
 * **Claim the successor, start its step, and then walk away** — the shape of the
 * failure this feature is most likely to have.
 *
 * The label pass is the slowest thing in the app (682 s measured against a 740 s
 * claimant deadline), so *the lease ran out* is not an exotic ending for it: it
 * is the ordinary one. A claimant that dies here leaves the row `running`, its
 * step `running`, its draft pointer set, and nobody inside it — which is exactly
 * what `settleExpired` exists to reap.
 *
 * **The step is marked `running` on the `jobs` row rather than only in the
 * session**, because that is what production leaves behind: `runStep`
 * (src/jobs.ts) sets `step.status = "running"` and calls `noteProgress` *before*
 * the model call, so the array on the row is the record of which step a vanished
 * claimant was inside. `session.beginStep` writes `revision_step_runs`, which is
 * a different question.
 *
 * **The lease is written straight to the column**, for the reason
 * tests/list-reconciles-expired.test.ts gives: a lease short enough to expire
 * during a test is short enough to expire between two of the assertions after
 * it, and `clock_timestamp()` is the clock the store compares against.
 */
async function abandonTheSuccessorMidStep(
  slug: string,
  /**
   * **How far the claimant got before it died**, and the default is the easy
   * shape rather than the only one.
   *
   * `"running"` is a claimant that reached the model call. `"pending"` is one
   * that died between `claim` and the `noteProgress` that persists the status —
   * inside `stepIsDone`, say, which runs before that write. Both end the same way
   * and both must mark the revision; the second is the shape the first version of
   * this stage silently skipped. GPT Sol, F4 of the stage 2c review.
   */
  stepStatus: "running" | "pending" = "running",
): Promise<Claimed> {
  const claimed = await claimTheSuccessor(slug);
  if (stepStatus === "running") await claimed.session.beginStep(slug, "labels");
  await db()
    .update(jobsTable)
    .set({
      steps: claimed.steps.map((step) =>
        step.name === "labels" && stepStatus === "running"
          ? { ...step, status: "running" as const, startedAt: new Date().toISOString() }
          : step,
      ),
      leaseExpiresAt: sql`clock_timestamp() - interval '1 second'`,
    })
    .where(eq(jobsTable.id, claimed.jobId));
  return claimed;
}

/**
 * A terminal job on another slug that exists only to own an id.
 *
 * Terminal so that it is not an active holder of anything: the *only* thing wrong
 * with minting this id again is that the primary key is taken.
 */
async function aJobOwningTheId(slug: string): Promise<string> {
  const taken = mintId();
  await db()
    .insert(jobsTable)
    .values({
      id: taken,
      ownerId: OWNER,
      slug,
      steps: stepsOf(["arc"]),
      status: "done",
      workKey: `labels-successor-taken-${taken}`,
    });
  return taken;
}

/** The job row as the sweep left it. */
async function jobRow(id: string) {
  const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, id)).limit(1);
  return row;
}

const mine = (name: string, body: () => Promise<void>) =>
  it(name, () => {
    /* Cleared per case, so one case's line cannot be counted by the next. */
    warnings.length = 0;
    return runAsOwner(OWNER, body);
  });

/* ------------------------------------------------------------------ tests -- */

describe("publication enqueues the free labels successor", () => {
  afterAll(async () => {
    await cleanUpThenRelease(
      async () => {
        const database = getDb();
        await database.delete(jobsTable).where(eq(jobsTable.ownerId, OWNER));
        await database.delete(jobsTable).where(eq(jobsTable.ownerId, STRANGER));
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
        await runLock?.client.query("delete from auth.users where id = any($1)", [
          [OWNER, STRANGER],
        ]);
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
   * **Two publications for one article are one successor.** Without the
   * conflict handling the second publication throws on a unique violation from
   * inside the publication transaction and takes a perfectly good publication
   * down with it.
   *
   * **The collapse is proven rather than assumed**, which is the change F3 of the
   * stage 2b review asked for: the holder is re-read and its state decides. A
   * *queued* successor holding no draft will pick up whatever the article is
   * serving when it finally claims, so collapsing onto it is right — and the
   * assertion that it holds no draft is what separates this case from the one
   * that is refused.
   */
  mine("a second publication collapses onto the queued successor", async () => {
    const slug = `${SLUG_PREFIX}twice`;
    await publishPending(slug);
    expect(await successorsOf(slug)).toHaveLength(1);
    expect(
      (await successorsOf(slug))[0]?.draftRevisionId,
      "the successor already holds a draft, so this is not the case it looks like",
    ).toBeNull();

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
   * **A publication onto a successor that already holds a draft says so, and
   * publishes anyway.**
   *
   * That successor is working from an earlier base. Its own publication will be
   * refused by the base-lineage guard, and `markNavLabelsFailedIn` will refuse
   * the newer revision too, because base ≠ current — so this revision reaches the
   * shelf saying *"Paragraph labels are still arriving"* with nothing queued to
   * make it stop being true. F2 of the stage 2b review.
   *
   * **It threw a 409 for one day, and the throw came back out.** The argument for
   * refusing was that no *ordinary* publication could reach it: the article's FIFO
   * order rule keeps every publisher younger than a successor holding a draft. That
   * argument is false. `blockedByAnother` orders on `(created_at, id)` and sees
   * only **committed** rows, so a job that took an earlier timestamp and became
   * visible later is invisible to the successor's claim — it claims, opens a draft,
   * requeues keeping it, and the now-visible older job publishes straight into the
   * refusal. Cross-instance clock skew is a second road to the same ordering. GPT
   * Sol, F1 of the stage 2c review. Failing a paying reader's publication is worse
   * than the gap, and the gap has never been observed.
   *
   * So the state is **audible rather than closed**: `publishRevisionIn` hands the
   * holder's id back, and `logPublication` warns after the commit. The assertion
   * is on that field, because a log line is not a contract and the field is.
   */
  mine("a publication onto a successor bound to an older base warns and goes ahead", async () => {
    const slug = `${SLUG_PREFIX}overtaking`;
    await publishPending(slug);
    const claimed = await claimTheSuccessor(slug);

    const second = await beginRevision({ slug });
    await db()
      .update(articleRevisions)
      .set({ navLabelStatus: "pending" })
      .where(eq(articleRevisions.id, second.revisionId));

    const published = await publishRevision({ slug, revisionId: second.revisionId });

    expect
      .soft(
        published.successor,
        "the publication swallowed a successor that can never finish this revision",
      )
      .toEqual({ kind: "boundToOlderBase", jobId: claimed.jobId });

    /* **And it was said out loud**, which since the 409 came out is the only
       thing standing between this state and silence. The message is asserted
       loosely and the fields exactly: the wording is prose and will be reworded,
       the job id is the thing an operator acts on. */
    const warned = warnings.filter((line) => line.message.includes("without a labels successor"));
    expect.soft(warned, "nothing in the log says this revision will never get its labels").toHaveLength(1);
    expect.soft(warned[0]?.fields).toMatchObject({
      slug,
      revisionId: second.revisionId,
      holderJobId: claimed.jobId,
    });
    /* The remedy has to name the order, because one command is not enough: an
       unforced re-run de-duplicates onto the holder and dies with it. */
    expect
      .soft(warned[0]?.message, "the warning does not say to wait for the holder")
      .toMatch(/once that job ends/);

    /* The publication went through, and no second job was queued for it. */
    expect.soft(await currentRevisionOf(slug)).toBe(second.revisionId);
    expect.soft(await successorsOf(slug)).toHaveLength(1);
    expect
      .soft(
        await navLabelStatusOf(second.revisionId),
        "the sentence the warning is about is not the one on the revision",
      )
      .toBe("pending");
  });

  /* ------------------------------------------------------------------ 9b -- */

  /**
   * **And if a newer revision does become current, the failure leaves it alone.**
   * GPT Sol, F4 of the design review: the failure is about the revision the job
   * was working from, so once something else is on the shelf, that revision is
   * history and the new one has its own labels story and its own successor.
   *
   * **The pointer is moved directly**, and that is a change from how this case
   * used to be written. It used to publish the second revision through
   * `publishRevision`, which is the route the case above now *refuses* — so
   * building the state that way would be building it through a door this stage
   * closed. The guard is kept anyway, and kept tested: it costs two reads, it is
   * the only thing standing between a stale job and a sentence about a
   * publication it knows nothing about, and `db:import` and any future
   * pointer-mover are outside the refusal above.
   */
  mine("a failed labels job leaves a newer publication alone", async () => {
    const slug = `${SLUG_PREFIX}overtaken`;
    const first = await publishPending(slug);
    const claimed = await claimTheSuccessor(slug);

    const second = await beginRevision({ slug });
    await db()
      .update(articleRevisions)
      .set({ navLabelStatus: "pending", status: "published" })
      .where(eq(articleRevisions.id, second.revisionId));
    await db()
      .update(articles)
      .set({ currentRevisionId: second.revisionId })
      .where(eq(articles.slug, slug));
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

  /* ----------------------------------------------------------------- 11 -- */

  /**
   * **A labels job whose claimant vanished says so on the revision too.**
   *
   * The settlement path in `pgStoreSession.settleIn` is not the only way a
   * `labels` job ends. `settleExpired` (src/store/pg-jobs.ts) ends the job
   * *itself* when the lease lapses and the requeue budget is spent — nobody is
   * inside it, so no session will ever run for that row. Until this case that
   * ending wrote nothing to `nav_label_status`, so the article went on promising
   * labels that nothing anywhere was buying. GPT Sol, F1 of the stage 2b review;
   * it is the likeliest failure this feature has, because the label pass is the
   * slowest step in the app and running out of lease is its ordinary ending.
   *
   * **The reader's own door**, which is the owner-scoped sweep `listJobs` runs.
   */
  mine("a labels job whose lease runs out marks the base revision `failed`", async () => {
    const slug = `${SLUG_PREFIX}expired`;
    const fixture = await publishPending(slug);
    const claimed = await abandonTheSuccessorMidStep(slug);

    expect(await navLabelStatusOf(fixture.revisionId)).toBe("pending");

    /* Budget zero, so this lapse is an ending rather than another window — the
       distinction src/jobs.ts § `REQUEUE_BUDGET` draws, and the only one of the
       two that leaves the article with no successor. */
    const settled = await pgJobStore.settleExpired(undefined, OWNER, 0);
    expect(
      settled.find((row) => row.id === claimed.jobId)?.status,
      "the sweep did not end the abandoned labels job",
    ).toBe("error");

    expect
      .soft(
        await navLabelStatusOf(fixture.revisionId),
        "the reader is still told the labels are on their way, and nothing is queued to make them",
      )
      .toBe("failed");
    /* And the article itself is untouched: a settlement publishes nothing. */
    expect.soft(await currentRevisionOf(slug)).toBe(fixture.revisionId);
  });

  /* ----------------------------------------------------------------- 12 -- */

  /**
   * **And through the door it actually arrives by, which is somebody else's
   * request.**
   *
   * `advanceJobWith` (src/jobs.ts) sweeps **globally and deliberately** — it is
   * the only door that reaches the job of an owner who is not coming back — so
   * the sweep that ends this job usually runs inside *another reader's* request,
   * with that reader in `currentOwnerId()`. Every article read in
   * src/store/pg-revisions.ts goes through `ownedSlug`, whose default owner is
   * the ambient one, so a marker that asked the ambient question here would look
   * up somebody else's shelf, find nothing, and return `null` — a silent nothing
   * that is indistinguishable from "there was nothing to do".
   * docs/reusable/silent-success.md.
   *
   * Not run through `mine`: the whole point is that the person sweeping is not
   * the person who owns the article.
   */
  it("a global sweep run by another reader still marks the article's revision", async () => {
    const slug = `${SLUG_PREFIX}expired-elsewhere`;
    const fixture = await runAsOwner(OWNER, async () => {
      const published = await publishPending(slug);
      await abandonTheSuccessorMidStep(slug);
      return published;
    });

    /* A stranger's poll. No article of their own, no relationship to this one —
       just the reader whose request happens to be the one that sweeps. */
    const stranger = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
    await runAsOwner(stranger, async () => {
      await pgJobStore.settleExpired(undefined, undefined, 0);
    });

    expect(
      await runAsOwner(OWNER, () => navLabelStatusOf(fixture.revisionId)),
      "the sweep answered for the wrong owner's shelf and marked nothing",
    ).toBe("failed");
  });

  /* ----------------------------------------------------------------- 13 -- */

  /**
   * **A requeue is not an ending, and must not say one happened.**
   *
   * With budget left the same lapse puts the row back to `queued` on its own id
   * *keeping its draft*, and the reader sees a card that carries on rather than
   * a failure (src/jobs.ts § `REQUEUE_BUDGET`). Marking the revision `failed`
   * there would tell the reader the labels were lost while the job that is going
   * to make them is still in the queue — and `markNavLabelsFailedIn` only ever
   * writes over `pending`, so nothing would put the sentence back.
   */
  mine("a labels job that is requeued rather than ended leaves the sentence alone", async () => {
    const slug = `${SLUG_PREFIX}requeued`;
    const fixture = await publishPending(slug);
    const claimed = await abandonTheSuccessorMidStep(slug);

    const settled = await pgJobStore.settleExpired(undefined, OWNER, 3);
    expect(
      settled.find((row) => row.id === claimed.jobId)?.status,
      "the sweep ended a job that still had windows left",
    ).toBe("queued");

    expect
      .soft(
        await navLabelStatusOf(fixture.revisionId),
        "a job that is going back into the queue reported its own death",
      )
      .toBe("pending");
    expect
      .soft((await jobRow(claimed.jobId))?.draftRevisionId, "the requeue dropped the draft")
      .toBeTruthy();
  });

  /* ----------------------------------------------------------------- 14 -- */

  /**
   * **Only a job that was buying labels at all.** A job re-running some other
   * step on an article whose labels are still arriving must not mark them
   * failed: the labels successor is a separate row, still sitting in the queue,
   * and the sentence on the revision is true.
   *
   * The question `settleExpired` asks is the job's own **step list** — does it
   * contain `labels` — and this pins that it is read rather than assumed from the
   * fact that a draft was held. It used to ask the narrower question *is the
   * `labels` entry `running`*, which let the case below through; this case is
   * green under both, which is what makes it the control rather than the subject.
   */
  mine("a lapsed job that was never buying labels leaves the sentence alone", async () => {
    const slug = `${SLUG_PREFIX}other-step`;
    const fixture = await publishPending(slug);

    /* An `arc` re-run on the same article, claimed and then abandoned. It is
       queued *behind* the successor, so it is claimed only once the successor is
       out of the way — which is what makes this a second job rather than a
       second claim of the same one. */
    const successor = (await successorsOf(slug))[0];
    expect(successor, "no successor to get out of the way of").toBeTruthy();
    await db().delete(jobsTable).where(eq(jobsTable.id, successor?.id ?? ""));

    const other = await queueBehind(slug, ["arc"]);
    const attempt = mintAttempt();
    await claimWhenSlotFree(other, attempt);
    const session = await openPgStoreSession({ slug, job: { id: other, attemptId: attempt } });
    await session.beginStep(slug, "arc");
    await db()
      .update(jobsTable)
      .set({
        steps: stepsOf(["arc"]).map((step) => ({ ...step, status: "running" as const })),
        leaseExpiresAt: sql`clock_timestamp() - interval '1 second'`,
      })
      .where(eq(jobsTable.id, other));

    const settled = await pgJobStore.settleExpired(undefined, OWNER, 0);
    expect(settled.find((row) => row.id === other)?.status).toBe("error");

    expect(
      await navLabelStatusOf(fixture.revisionId),
      "a job that was never buying labels reported that the labels failed",
    ).toBe("pending");
  });

  /* ----------------------------------------------------------------- 15 -- */

  /**
   * **The ordinary shape still collapses onto the queued successor and says
   * nothing** — the case that would go wrong if the classification above ever
   * came to treat a plain queued holder as a problem.
   *
   * The awkward arrangement, and the reason it is this one: a job **older** than
   * the successor. `blockedByAnother` (src/store/pg-jobs.ts) orders claims on
   * `(created_at, id)`, so an older job claims ahead of the successor, which
   * therefore has never been able to open a draft — and the publication it makes
   * collides with a holder in exactly the state that should collapse silently.
   *
   * This case used to be the proof that the 409 was unreachable from an ordinary
   * ingest. It is **not** that any more, and the reason is worth keeping: the
   * order rule sees only *committed* rows, so a job whose row takes an earlier
   * timestamp and becomes visible later is not ordered against at all. That is
   * what took the 409 back out (case 9). What this case still proves is the half
   * that was always true — the ordinary arrangement dedupes quietly.
   */
  mine("an ordinary publication from an older job still dedupes quietly", async () => {
    const slug = `${SLUG_PREFIX}older-job`;
    const older = await queueBehind(slug, ["arc"]);
    const first = await publishPending(slug);

    const successor = (await successorsOf(slug))[0];
    expect(successor, "no successor was queued").toBeTruthy();
    /* The order rule, in the direction that matters here: the successor is
       younger, so it waits — and therefore never opens a draft. */
    expect(
      (await pgJobStore.claim(successor?.id ?? "", OWNER, mintAttempt(), LEASE_MS, 4)).kind,
      "the successor claimed ahead of a job older than it",
    ).toBe("busy");

    const attempt = mintAttempt();
    await claimWhenSlotFree(older, attempt);

    const second = await beginRevision({ slug });
    await db()
      .update(articleRevisions)
      .set({ navLabelStatus: "pending" })
      .where(eq(articleRevisions.id, second.revisionId));
    await publishRevision({ slug, revisionId: second.revisionId });

    expect.soft(await currentRevisionOf(slug), "the publication was refused").toBe(
      second.revisionId,
    );
    expect
      .soft(await successorsOf(slug), "a second successor was queued for one article")
      .toHaveLength(1);
    expect.soft(await navLabelStatusOf(first.revisionId)).toBe("pending");
  });

  /* ---------------------------------------------------------------- 15b -- */

  /**
   * **A claimant that died before it wrote down which step it was on still marks
   * the revision.** GPT Sol, F4 of the stage 2c review, and this is the case the
   * first version of stage 2c silently skipped.
   *
   * `runStep` (src/jobs.ts) sets `step.status = "running"` and persists it through
   * `noteProgress` *before* the model call — but a claimant can die before that
   * write lands: after `claim`, or inside `stepIsDone`, which runs earlier still.
   * The job then ends `error` with its step array still saying `pending`, and the
   * first version of the sweep required `running` and marked nothing. The article
   * kept *"Paragraph labels are still arriving"* for ever, which is exactly the
   * bug the sweep was added to fix, in a shape one line narrower.
   *
   * The condition is now the **step list**, so this is the same job as case 11
   * with one write missing.
   */
  mine("a labels job that died before its step was marked running still marks", async () => {
    const slug = `${SLUG_PREFIX}died-early`;
    const fixture = await publishPending(slug);
    const claimed = await abandonTheSuccessorMidStep(slug, "pending");

    /* The premise, asserted rather than assumed: the row really does say the
       step never started. Without this the case could pass for the old reason. */
    expect(
      (await jobRow(claimed.jobId))?.steps.map((step) => step.status),
      "the fixture wrote the status this case exists to do without",
    ).toEqual(["pending"]);

    const settled = await pgJobStore.settleExpired(undefined, OWNER, 0);
    expect(settled.find((row) => row.id === claimed.jobId)?.status).toBe("error");

    expect(
      await navLabelStatusOf(fixture.revisionId),
      "a claimant that died a moment earlier left the sentence up for ever",
    ).toBe("failed");
  });

  /* ---------------------------------------------------------------- 15c -- */

  /**
   * **An article this job's owner cannot lock is dropped from the marking set,
   * not marked later.** GPT Sol, F2 of the stage 2c review.
   *
   * `lockArticlesInSlugOrder` takes the lock the sweep needs *before* it touches
   * any job row, which is the whole of the lock order. When it cannot take one it
   * used to say nothing and carry on — and then `markNavLabelsFailedIn` would
   * take that same lock itself, **after** the job rows, which is the inversion the
   * snapshot exists to prevent. So a row it could not lock is now dropped, and
   * the marker is never reached for it.
   *
   * **Two doors, and we were wrong about one of them.** The obvious one is a
   * deleted article — and we told the reviewer it could not happen, on the
   * grounds that deleting an article cascades its revisions away and
   * `jobs.draft_revision_id` is `on delete set null`, so the row leaves the
   * snapshot. That argument does not hold: **the snapshot is materialised into
   * JavaScript before the locks are taken**, so a deletion after that read leaves
   * our copy of the row perfectly intact, and deletion-then-recreation really was
   * a live route under the old code. The other door is an owner mismatch — every
   * article read goes through `ownedSlug`, so a job row carrying an owner the
   * article does not have locks nothing — and it is the one this case builds,
   * because it needs no deletion race to arrange. GPT Sol, G2 of the second stage
   * 2c review.
   *
   * **This case alone cannot tell the two implementations apart**, and saying so
   * matters more than the case does: `markNavLabelsFailedIn` re-takes the lock
   * itself and returns `null` when it cannot get it, so the *revision* ends up
   * `pending` either way. What differs is only whether that second lock attempt
   * happens after the job rows are locked, and lock order is not observable from
   * here. So the case below it tests the contract that actually changed, and this
   * one is the end-to-end assurance that failing closed did not break the sweep:
   * it still ends the job, marks nothing, and throws nothing.
   */
  mine("a lapsed labels job whose article will not lock is settled and not marked", async () => {
    const slug = `${SLUG_PREFIX}unlockable`;
    const fixture = await publishPending(slug);
    const claimed = await abandonTheSuccessorMidStep(slug);

    /* The job row moves to somebody who owns no article of this name. */
    await db()
      .update(jobsTable)
      .set({ ownerId: STRANGER })
      .where(eq(jobsTable.id, claimed.jobId));

    const settled = await pgJobStore.settleExpired(undefined, undefined, 0);
    expect(
      settled.find((row) => row.id === claimed.jobId)?.status,
      "the sweep did not end the job it could not mark",
    ).toBe("error");

    expect
      .soft(
        await navLabelStatusOf(fixture.revisionId),
        "the sweep marked a revision through an article lock it never held",
      )
      .toBe("pending");
  });

  /* ---------------------------------------------------------------- 15e -- */

  /**
   * **A job that merely *contains* `labels` does not own the article's promise**,
   * and must not mark it failed while another job is still queued to keep it.
   * GPT Sol, G1 of the second stage 2c review, and the second time this filter
   * has asked the wrong question.
   *
   * The ordering, exactly as Sol set it out:
   *
   * 1. Job A, `["hierarchy","labels"]`, is asked for while something else is
   *    running on the article.
   * 2. That other job publishes a `pending` revision, which queues successor B,
   *    `["labels"]`.
   * 3. A **predates** B, so A claims first and opens its draft from that revision.
   * 4. A dies inside `hierarchy`.
   * 5. Membership says mark it — but B is still queued to make exactly those
   *    labels, and B then runs and they arrive.
   *
   * A sentence that is wrong and then heals itself is the kind nobody reports and
   * everybody sees, which is why this is the P1 of that review rather than a
   * tidiness note. The fix is to ask whether any other active job on the article
   * still carries `labels`.
   *
   * **Case 14 and case 15b cannot reach this.** 14 deletes the successor before
   * sweeping and 15b abandons the successor itself, so in both the promise really
   * has died with the job.
   */
  mine("a lapsed job does not mark failed while another job still carries the labels", async () => {
    const slug = `${SLUG_PREFIX}promise-elsewhere`;
    const fixture = await publishPending(slug);
    const successor = (await successorsOf(slug))[0];
    expect(successor, "no successor to be the surviving promise").toBeTruthy();

    /* Job A, asked for before the publication that minted B — which is what lets
       it claim ahead of B rather than queue behind it. */
    const older = await queueBehind(slug, ["hierarchy", "labels"], new Date(Date.now() - 60_000));
    const attempt = mintAttempt();
    await claimWhenSlotFree(older, attempt);
    const session = await openPgStoreSession({ slug, job: { id: older, attemptId: attempt } });
    await session.beginStep(slug, "hierarchy");
    await db()
      .update(jobsTable)
      .set({
        steps: stepsOf(["hierarchy", "labels"]).map((step) =>
          step.name === "hierarchy" ? { ...step, status: "running" as const } : step,
        ),
        leaseExpiresAt: sql`clock_timestamp() - interval '1 second'`,
      })
      .where(eq(jobsTable.id, older));

    const settled = await pgJobStore.settleExpired(undefined, OWNER, 0);
    expect(settled.find((row) => row.id === older)?.status).toBe("error");

    expect
      .soft(
        await navLabelStatusOf(fixture.revisionId),
        "the reader was told the labels failed while the job that makes them was still queued",
      )
      .toBe("pending");
    /* And the surviving promise really did survive — otherwise this case would
       be green for the wrong reason. */
    expect
      .soft((await jobRow(successor?.id ?? ""))?.status, "the successor is no longer there to keep it")
      .toBe("queued");
  });

  /* ---------------------------------------------------------------- 15d -- */

  /**
   * **`lockArticlesInSlugOrder` reports what it locked, not what it was asked
   * for** — the contract the fail-closed change is, tested directly because the
   * sweep above cannot express it.
   *
   * The caller uses the answer as its marking set, so a row missing from it is a
   * row `markNavLabelsFailedIn` is never reached for. That is the whole of the
   * fix: the marker takes the article lock itself, and reaching it after the job
   * rows are locked is the job→article order the snapshot exists to prevent —
   * harmless while the article is genuinely absent, a real inversion the moment
   * the slug has been recreated under it. GPT Sol, F2 of the stage 2c review.
   */
  mine("locking articles in slug order answers with the ones it actually locked", async () => {
    const slug = `${SLUG_PREFIX}lock-report`;
    await publishPending(slug);

    const mineRow = { slug, ownerId: OWNER };
    const theirs = { slug, ownerId: STRANGER };

    const locked = await db().transaction(async (tx) => ({
      ours: await lockArticlesInSlugOrder(tx, [mineRow]),
      /* Same article, an owner it does not belong to — every article read goes
         through `ownedSlug`, so this locks nothing. */
      strangers: await lockArticlesInSlugOrder(tx, [theirs]),
    }));

    expect.soft(locked.ours, "the row whose article was locked was dropped").toEqual([mineRow]);
    expect
      .soft(locked.strangers, "a row whose article could not be locked was reported as locked")
      .toEqual([]);
  });

  /* ----------------------------------------------------------------- 16 -- */

  /**
   * **A conflict that is not the de-duplication throws**, rather than being
   * swallowed with the rest. GPT Sol, F3 of the stage 2b review.
   *
   * `on conflict do nothing` covers **every** unique index on the table, and only
   * one of them is the queue's dedupe. Today the unintended one is `jobs_pkey`,
   * which is improbable over a 771-million-value id space; the cost that makes
   * this worth a case is the future, where a unique index somebody adds later
   * would be absorbed in silence — publication committing with no labels job, no
   * complaint, and the article saying *"still arriving"* for ever. That is the
   * same silence the sixth mutation in the header of this file describes, made
   * loud.
   *
   * **The id is forced rather than waited for.** `mintId` is mocked for this file
   * and passes straight through unless a case sets `idControl.forced`, which is
   * the only way to reach a collision on purpose; `tryEnqueue`'s own id-collision
   * throw is the model for both the wording and the `status`.
   */
  mine("a conflict that is not the dedupe throws rather than being swallowed", async () => {
    const slug = `${SLUG_PREFIX}id-collision`;
    const taken = await aJobOwningTheId(`${SLUG_PREFIX}id-collision-elsewhere`);

    const fixture = await draftReadyToPublish(slug, "pending");
    const before = await currentRevisionOf(slug);

    /* **Both attempts**, because one collision is the retry's job and is a
       different case entirely — the one below. */
    idControl.forced = [taken, taken];
    try {
      await expect(
        publishRevision({ slug, revisionId: fixture.revisionId }),
        "the publication committed having queued nothing",
      ).rejects.toThrow(/conflicted with a unique index twice/);
    } finally {
      idControl.forced = [];
    }

    expect.soft(await currentRevisionOf(slug), "the refusal did not roll the publication back").toBe(
      before,
    );
    expect.soft(await successorsOf(slug)).toHaveLength(0);
  });

  /* ----------------------------------------------------------------- 17 -- */

  /**
   * **A conflict with nothing holding it is asked again before it is believed.**
   * GPT Sol, F3 of the stage 2c review.
   *
   * `on conflict do nothing` and the classifying `SELECT` are two statements, and
   * the holder can leave the active set between them — a Stop settles a queued
   * holder in one statement, a sweep ends a lapsed one, and neither needs the
   * article lock this publication holds. Under one attempt that is a 500 thrown
   * over an ordinary de-duplication whose index is now free.
   *
   * The race itself is not schedulable from a test, so the *shape* is built
   * instead, and it is the same shape: a first insert that conflicts with nothing
   * active holding the work, followed by a second that lands. One forced id
   * collision does exactly that, and it is the case the throw above must not
   * swallow.
   */
  mine("a conflict with no holder is retried once before it is believed", async () => {
    const slug = `${SLUG_PREFIX}id-collision-retried`;
    const taken = await aJobOwningTheId(`${SLUG_PREFIX}id-collision-retried-elsewhere`);

    const fixture = await draftReadyToPublish(slug, "pending");

    idControl.forced = [taken];
    try {
      const published = await publishRevision({ slug, revisionId: fixture.revisionId });
      expect(
        published.successor?.kind,
        "the retry did not queue the successor this publication needed",
      ).toBe("queued");
      expect(published.successor?.jobId).not.toBe(taken);
    } finally {
      idControl.forced = [];
    }

    expect.soft(await currentRevisionOf(slug)).toBe(fixture.revisionId);
    expect.soft(await successorsOf(slug)).toHaveLength(1);
  });
});
