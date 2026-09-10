/**
 * **A job's ending settles its quota slot — at every site a job can end.**
 *
 * The plan said "`settleReservation` into both branches of `settleIn`"
 * (docs/plans/260902i-stripe-payments-and-subscription-tiers.md § Quota
 * accounting). That undercounts by five. A job ends at seven places:
 *
 * 1. `settleIn`'s `done` ending — **charged**.
 * 2. `settleIn`'s `error` / `cancelled` ending — **released**.
 * 3. `settleIn`'s **release** branch, when `releaseStepIn`'s own `case when
 *    cancelling` ends the job instead of queueing it (src/store/pg-session.ts,
 *    case 4). Inside `settleIn`, and not one of "both branches" — **released**.
 * 4. `settleExpired` — the reader closed the tab and the lease lapsed.
 * 5. `requestCancel`'s terminal branch — Stop on a job no claimant has picked
 *    up, or one whose claimant is provably gone.
 * 6. `pgJobStore.finish` — the store's own ending, on the bare API.
 * 7. `pgJobStore.releaseStep`, when its `case when cancelling` ends the job.
 *
 * Miss 4 and 5 and the ordinary UI leaks slots, in the direction that costs the
 * reader rather than us: an unsettled reservation counts against its owner **for
 * ever**, because there is deliberately no expiry (src/db/schema.ts §
 * `ingest_events`). Two stopped jobs would end a free account, and on a paid one
 * it is worse — `usageSql` counts in-flight with no period filter, so one leak
 * is minus-one every month from then on.
 *
 * **6 and 7 have no caller in `src/`** — the coordinator goes through
 * `pgStoreSession` — so they were a trap rather than a leak, and the trap has
 * teeth: `forget` and `trimFinished` delete terminal jobs, and
 * `jobs.ingest_event_id` is the only record of which slot a job was spending.
 * GPT Sol counted them, 2026-09-03,
 * docs/plans/260902i-settlement-code-review-sol.md finding 1.
 *
 * ## What is asserted, and why it is the ledger row rather than a return value
 *
 * Every case below reads `ingest_events` back. Nothing in the settlement path
 * returns whether it charged, and the two columns are the only account there is:
 * `succeeded_at` set means charged, `released_at` set means given back, and
 * `ingest_events_settled_once` makes "both" a state Postgres refuses.
 *
 * ## The asymmetry these cases are really about
 *
 * The **charge is strict** — `settleReservation` throws unless exactly one row
 * moved, and that throw takes the publication with it, which is *"a charge that
 * cannot land takes the publication back"* below. The **releases are tolerant**:
 * a release that matches nothing is logged, never thrown, because a throw inside
 * `requestCancel` turns the reader's Stop button into a 500.
 *
 * **Tolerant is not the same as silent**, and until 2026-09-03 it was: a release
 * that found the slot already *charged* — a job that ended cancelled and was
 * billed for anyway — logged the same sentence as the harmless already-released
 * case, and a test here asserted exactly that. Two cases below now take those
 * apart, and one of them reads the log.
 *
 * What makes a cancel racing a final publication settle *once* is the job fence
 * — only one of the two transitions ends the job, and the loser's settlement
 * rolls back with it.
 *
 * ## The mutations, watched red on 2026-09-03
 *
 * Each settlement deleted in turn, with this file run against the real database:
 *
 * ```
 * settleIn's tail          5 failed  (charge, rollback, error, cancelled, race-publish)
 * settleIn's release       1 failed  (a release that resolves to a cancellation)
 * settleExpired            1 failed  (the lease lapses)
 * requestCancel            2 failed  (Stop on a queued job, and race-cancel)
 * ticket → column          10 failed
 * ```
 *
 * And making the *release* strict — `outcome === "released"` never taken —
 * reddens exactly one, printing what the reader would have got instead of a
 * stopped job: *"This app asked its database for something it would not do."*
 *
 * The four added on 2026-09-03 were watched red before the code they hold was
 * written: `finish` and `releaseStep` settling nothing, and the already-charged
 * anomaly going unlogged. Two more were falsified afterwards rather than before,
 * because they guard rewrites of working code — releasing only the first of the
 * ids reddens the multi-row sweep, and dropping `for update` from the barrier
 * reddens both real race cases, which is the check that the barrier is a barrier.
 *
 * ## The dev server on this box is a third writer, and two cases are built round it
 *
 * `advanceJobWith` (src/jobs.ts) calls `settleExpired()` **unscoped**, and every
 * `pump` iteration goes through it — so while anybody is running an ingest
 * against this database, somebody else's process is ending every job whose lease
 * has run out, including this file's. Two cases would otherwise be flaky and
 * neither is: the multi-row sweep never lapses a lease at all and passes a `now`
 * an hour ahead instead, and the two-writer race uses two `finish` calls on a
 * live claim rather than Stop against the sweep. Both say so where they are.
 *
 * ## The null case, which was this stage's guard and is now the ordinary one
 *
 * When this file was written nothing called `reserveIngest`, so every real job's
 * `ingest_event_id` was null and the last case — a null reservation settling
 * harmlessly at all five sites — was the guard saying the settlement stage
 * changed nothing observable. Admission landed on 2026-09-03
 * (src/billing/admission.ts), so ingests now carry a slot; the null case stays,
 * because **most jobs still spend nothing**: a step re-run, CLI work, seeding.
 *
 * ## Contention
 *
 * Same shared database as every other suite, so: this file's own owner, its own
 * slug prefix, both swept on the way in and out, and tests/helpers/run-lock.ts
 * because it claims jobs. Copied from tests/pg-session-exact-base.test.ts, which
 * set the pattern.
 *
 * Skips loudly when there is no database; see tests/helpers/pg-ready.ts. Check a
 * change here with `REQUIRE_POSTGRES=1 npx vitest run tests/billing-settlement.test.ts`
 * and read the *count*: tests/billing-quota-race.test.ts reported "13 skipped"
 * against a live database for hours, because a skip looks exactly like a pass.
 */
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const HOISTED = vi.hoisted(() => {
  /* **And the logger has to be able to speak.** Two cases below assert that a
     ledger anomaly is *written down* rather than swallowed, and `level()` in
     src/log.ts reads `LOG_LEVEL` once at that module's load — vitest's
     `NODE_ENV=test` otherwise makes it `silent`, which writes nothing, which
     satisfies every assertion that looks for a string.
     tests/helpers/log-capture.ts § two things a caller has to do. `error`
     rather than `warn`, because that is the level the anomalies are at and
     anything lower would put this suite's ordinary chatter in the run's
     output. */
  const level = process.env.LOG_LEVEL;
  if (level === undefined || level === "silent" || level === "fatal") {
    process.env.LOG_LEVEL = "error";
  }
  return { level };
});

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  billingAccounts,
  blockIdentities,
  ingestEvents,
  jobs as jobsTable,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId, mintUniqueId } from "../src/ids.js";
import { runAsOwner } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import type { ConvertedProduct, PipelineStep, StepContext } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { mintAttempt } from "../src/store/jobs.js";
import { reserveIngest } from "../src/store/pg-billing.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { openPgStoreSession } from "../src/store/pg-session.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/artifacts.js";
import type { StoreSession } from "../src/store/session.js";
import type { Arc, Block, Job, JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* Put both flags back straight away — vitest reuses a worker across files, and
   the modules above have already captured them. */
if (HOISTED.level === undefined) delete process.env.LOG_LEVEL;
else process.env.LOG_LEVEL = HOISTED.level;

/**
 * **Before `pgReady`, or this whole file skips for the wrong reason.** `pgReady`
 * reads `DATABASE_URL` from the environment and vitest does not load
 * `.env.local` on its own — the omission that made the quota race suite report
 * 13 skipped against a database that was up and migrated.
 */
loadEnvLocal();

/* Long, because claiming waits on a contended slot rather than failing on it. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = path.resolve(import.meta.dirname, "..");

/** This file's own person, and its own rubble pattern. See store-pg-session. */
const OWNER_STEM = "000000c8-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-billing-settle-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

const LEASE_MS = 60_000;

/**
 * **No tier sells anything, so every admission is the free one.**
 *
 * Passed rather than left to `allTiers()`, which reads `billing_tiers` — a table
 * a peer suite or a hand-typed `UPDATE` can change. What this file needs of
 * `reserveIngest` is a real reservation row, not a particular allowance.
 */
const NO_TIERS = [] as const;

/* ---------------------------------------------------- is there a database -- */

let runLock: HeldRunLock | undefined;

/**
 * `keepPool` because the two race cases at the foot of this file need a
 * **third** connection — one that holds the job row while two real callers queue
 * behind it. It cannot come out of Drizzle's pool: `getDb()` is what those two
 * callers are drawing their own transactions from, and a held connection there
 * is one fewer for them. tests/billing-quota-race.test.ts does the same.
 */
const { pool } = await pgReady({
  suite: "tests/billing-settlement.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.ingest_events",
    "spideryarn.billing_accounts",
  ],
  keepPool: true,
  max: 4,
});

runLock = await takeRunLockAndSetUp("tests/billing-settlement.test.ts", async (lockClient) => {
  /* Jobs before ingest events: `jobs_ingest_event_fk` points that way, so the
     other order is a foreign key violation rather than a clean sweep. */
  await lockClient.query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
  await lockClient.query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("delete from spideryarn.ingest_events where owner_id::text like $1", [
    RUBBLE,
  ]);
  await lockClient.query("delete from spideryarn.billing_accounts where owner_id::text like $1", [
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
    email: `billing-settlement-${OWNER}@example.invalid`,
  });
});

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
        gist: "A fixture built by tests/billing-settlement.test.ts and nothing else.",
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
  readonly publishedRevisionId: string;
  readonly blocks: Block[];
}

/**
 * A published article, so that a claim's draft is a **publishable** copy of it.
 *
 * Every `done` case below settles through `settleJob` with nothing having run —
 * case 5 of src/store/pg-session.ts, the all-skipped claim — and that door
 * publishes the carry-forward draft. So the publication is real: the gate reads
 * blocks, tree, and the `hierarchy` run row's stamp, and a fixture missing any
 * of them fails at the last statement of the settlement rather than here.
 */
async function publishArticle(slug: string): Promise<Fixture> {
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
      excerpt: "A fixture built by tests/billing-settlement.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-09-02T00:00:00.000Z"),
      stampedHtml: blocks.map((b) => b.html).join("\n"),
      tree: treeFor(slug, blocks),
      arc: arcSaying(slug, blocks, "the arc the fixture published"),
    })
    .where(eq(articleRevisions.id, begun.revisionId));

  for (const name of ["fetch", "extract", "blocks"] as StepName[]) await stepRun(begun.revisionId, name);
  /* The one run row that has to carry a real hash: the publication gate compares
     it with `hashBlocks` of the stored blocks and refuses when they differ. */
  await stepRun(begun.revisionId, "hierarchy", hashBlocks(blocks));
  await stepRun(begun.revisionId, "arc");

  await publishRevision({ slug, revisionId: begun.revisionId });
  return { slug, publishedRevisionId: begun.revisionId, blocks };
}

/**
 * A **converted** `arc` that writes nothing and returns the artefact — the same
 * stand-in tests/pg-session-exact-base.test.ts uses, and for the same reason: a
 * real stage here would be a paid model call to prove something about the
 * settlement rather than about the stage.
 */
function fakeArc(): PipelineStep<"arc"> {
  return {
    name: "arc",
    label: "Reading the shape of the argument",
    produces: ["arc"],
    async run() {
      return { detail: "one entry" } as ConvertedProduct;
    },
  };
}

/** The context `runStep` would have built. */
function contextFor(slug: string): StepContext {
  return {
    slug,
    report: () => {},
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/* ------------------------------------------------------------- the job row -- */

function stepsOf(names: StepName[]): JobStep[] {
  return names.map((name) => ({ name, label: STEPS[name].label, status: "pending" as const }));
}

/**
 * A slot, taken the way admission will take it.
 *
 * Through the real `reserveIngest` rather than a hand-written INSERT, so that
 * the id these cases settle is one the admission path actually mints, and so
 * that `ingest_event_id` reaching the job's INSERT is exercised end to end. One
 * per case, and `afterEach` empties the ledger, so the free allowance is never
 * the thing under test.
 */
async function reserveSlot(slug: string): Promise<string> {
  const admission = await reserveIngest(OWNER, slug, NO_TIERS);
  if (admission.kind !== "admitted") {
    throw new Error(`reserving a slot for ${slug} answered ${admission.kind}`);
  }
  return admission.reservationId;
}

/**
 * A queued job, **through `enqueueOrGet`**, carrying the slot on its ticket.
 *
 * Not a hand-written INSERT: the ticket field and the column it lands in are
 * half of what this stage added, and a fixture that wrote the column itself
 * would prove the settlement over a link nothing in `src/` had made.
 */
async function queueJob(slug: string, names: StepName[], reservationId?: string): Promise<Job> {
  return await insertWhenSlotFree(slug, async () => {
    const id = mintId();
    const outcome = await pgJobStore.enqueueOrGet(
      {
        id,
        ownerId: OWNER,
        slug,
        steps: stepsOf(names),
        status: "queued",
        createdAt: new Date().toISOString(),
      },
      {
        workKey: `billing-settlement-${id}`,
        reservesName: false,
        ...(reservationId !== undefined && { ingestEventId: reservationId }),
      },
    );
    if (outcome.kind !== "created") {
      throw new Error(`enqueueing ${id} for ${slug} answered ${outcome.kind}`);
    }
    return outcome.job;
  });
}

/** Claim it, waiting out anybody else who got there first. See store-pg-session. */
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

/** A claim with a session over its draft, which is what `settleIn` runs inside. */
async function claimWithSession(slug: string, names: StepName[], reservationId?: string): Promise<Claimed> {
  const job = await queueJob(slug, names, reservationId);
  const attempt = mintAttempt();
  const claimed = await claimWhenSlotFree(job.id, attempt);
  const session = await openPgStoreSession({ slug, job: { id: job.id, attemptId: attempt } });
  return { jobId: job.id, attempt, session, steps: claimed.steps };
}

/* --------------------------------------------------------------- the reads -- */

const db = () => getDb();

async function currentRevisionOf(slug: string): Promise<string | null> {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row?.currentRevisionId ?? null;
}

async function jobRow(id: string) {
  const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, id)).limit(1);
  return row;
}

/**
 * **The ledger row, as two facts rather than a verdict.**
 *
 * `charged` and `released` rather than the timestamps, because that is what
 * every assertion here is about and `ingest_events_settled_once` guarantees at
 * most one of them is true. Reading the pair also catches the failure a single
 * `expect(succeededAt).not.toBeNull()` would miss: settled the *other* way.
 */
async function ledger(id: string): Promise<{ charged: boolean; released: boolean }> {
  const [row] = await db().select().from(ingestEvents).where(eq(ingestEvents.id, id)).limit(1);
  if (!row) throw new Error(`no ingest_events row for ${id}`);
  return { charged: row.succeededAt !== null, released: row.releasedAt !== null };
}

/** Nothing left in flight, which is the whole of what a leak looks like. */
const UNSETTLED = { charged: false, released: false };
const CHARGED = { charged: true, released: false };
const RELEASED = { charged: false, released: true };

/** Force this claim's lease into the past, without touching anything else. */
async function lapseLease(jobId: string): Promise<void> {
  await db().execute(
    sql`update spideryarn.jobs set lease_expires_at = now() - interval '1 minute' where id = ${jobId}`,
  );
}

const mine = (name: string, body: () => Promise<void>) => it(name, () => runAsOwner(OWNER, body));

/* -------------------------------------------------------------- the barrier -- */

/** What a raced call did, without either outcome escaping as a rejection. */
type Settled<T> = { readonly ok: T } | { readonly err: unknown };

const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(
    (ok) => ({ ok }),
    (err: unknown) => ({ err }),
  );

/**
 * **Two real writers, both actually blocked on the job row, then let go at
 * once.**
 *
 * A third connection takes `select … for update` on the job and holds it. Both
 * callers are started against a row they cannot have, and the case *asserts*
 * that neither has answered — which is the part a sequential test cannot do and
 * the reason the two cases below exist. The hold is then committed and both are
 * allowed to run.
 *
 * What that buys, in the words of GPT Sol's finding 4
 * (docs/plans/260902i-settlement-code-review-sol.md): the second writer really
 * does block on the job row; its `WHERE` predicate really is re-evaluated after
 * the first commits, at `read committed`; no settlement happens while one is
 * waiting; and the lock order — `jobs` then `ingest_events`, in both — completes
 * without deadlocking. **Which of the two wins is left genuinely undecided**, so
 * the cases assert an invariant rather than an outcome: exactly one of them ends
 * the job, and the ledger settles exactly once.
 *
 * Both outcomes are captured rather than awaited, because a rejection with no
 * handler attached during the 500ms hold is an `unhandledRejection` and vitest
 * fails the file for it — which would be a real failure reported as the wrong
 * one.
 *
 * **A `select … for update` rather than an `UPDATE`**, and the difference bit
 * once: an `UPDATE` waits only on rows matching its predicate *in its own
 * snapshot*, so a barrier that changed the row into one the writers were looking
 * for would be invisible to them until it committed, and they would sail past
 * the assertion below. A `select … for update` on the primary key locks the row
 * whatever it says.
 */
async function racedOnJobRow<A, B>(
  jobId: string,
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[Settled<A>, Settled<B>]> {
  if (!pool) throw new Error("this case needs the kept pool; see pgReady above");
  const holder = await pool.connect();
  try {
    await holder.query("begin isolation level read committed");
    await holder.query("select 1 from spideryarn.jobs where id = $1 for update", [jobId]);

    const answered = [false, false];
    const a = settle(first()).then((r) => {
      answered[0] = true;
      return r;
    });
    const b = settle(second()).then((r) => {
      answered[1] = true;
      return r;
    });

    /* Long enough that a writer which was never going to block has finished.
       The assertion is the point of the helper: without it this is two calls in
       a row wearing a `Promise.all`. */
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(answered, "a writer answered while the job row was held by somebody else").toEqual([
      false,
      false,
    ]);

    await holder.query("commit");
    return await Promise.all([a, b]);
  } finally {
    holder.release();
  }
}

/** The value a raced call returned, or its exception rethrown here where it reads. */
function answerOf<T>(settled: Settled<T>, what: string): T {
  if ("err" in settled) throw new Error(`${what} threw: ${String(settled.err)}`);
  return settled.ok;
}

/* ------------------------------------------------------------------ tests -- */

describe("a job's ending settles its quota slot", () => {
  afterEach(async () => {
    /* Jobs first: the composite foreign key from `jobs.ingest_event_id` is what
       stops the ledger rows going while a job still names one. */
    await db().delete(jobsTable).where(eq(jobsTable.ownerId, OWNER));
    await db().delete(ingestEvents).where(eq(ingestEvents.ownerId, OWNER));
    await db().delete(billingAccounts).where(eq(billingAccounts.ownerId, OWNER));
  });

  afterAll(async () => {
    await cleanUpThenRelease(
      async () => {
        const database = getDb();
        await database.delete(jobsTable).where(eq(jobsTable.ownerId, OWNER));
        await database.delete(ingestEvents).where(eq(ingestEvents.ownerId, OWNER));
        await database.delete(billingAccounts).where(eq(billingAccounts.ownerId, OWNER));
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
        await pool?.end();
        await runLock?.client.query("delete from auth.users where id = $1", [OWNER]);
      },
      async () => {
        await runLock?.release();
      },
    );
  });

  /* -------------------------------------------------------- the link itself -- */

  mine("writes the slot onto the job in the job's own INSERT", async () => {
    const slug = `${SLUG_PREFIX}link`;
    const reservation = await reserveSlot(slug);
    const job = await queueJob(slug, ["arc"], reservation);

    /* The row, not the object handed back: the column is what every settlement
       below reads, and `Job` deliberately does not carry it. */
    expect((await jobRow(job.id))?.ingestEventId).toBe(reservation);
    /* And nothing has been settled by merely creating the job. */
    expect(await ledger(reservation)).toEqual(UNSETTLED);
  });

  /* ------------------------------------------------------------ site 1 -- */

  mine("charges the slot in the same commit that publishes the article", async () => {
    const slug = `${SLUG_PREFIX}charge`;
    const fixture = await publishArticle(slug);
    const reservation = await reserveSlot(slug);
    const claimed = await claimWithSession(slug, ["arc"], reservation);

    const settled = await claimed.session.settleJob({
      kind: "end",
      jobId: claimed.jobId,
      attempt: claimed.attempt,
      ending: { status: "done", steps: claimed.steps },
    });

    expect(settled.kind).toBe("ended");
    /* The publication happened — a new revision is what the reader is served. */
    const published = await currentRevisionOf(slug);
    expect(published).not.toBe(fixture.publishedRevisionId);
    expect(published).not.toBeNull();
    /* And the charge landed with it, rather than beside it. */
    expect(await ledger(reservation)).toEqual(CHARGED);
  });

  /**
   * **The strictness of the charge, shown by taking the charge away.**
   *
   * The reservation is released out from under the job first, which is exactly
   * the anomaly `settleReservation` refuses to commit over: the update matches
   * no row. Done by moving a real column rather than by mocking the function,
   * because a mocked throw would prove the `try` and not the SQL — and the SQL
   * is where the "already settled" condition lives.
   *
   * What must not happen is the article going out unpaid for.
   */
  mine("rolls the publication back when the charge cannot land", async () => {
    const slug = `${SLUG_PREFIX}rollback`;
    const fixture = await publishArticle(slug);
    const reservation = await reserveSlot(slug);
    const claimed = await claimWithSession(slug, ["arc"], reservation);

    await db()
      .update(ingestEvents)
      .set({ releasedAt: new Date() })
      .where(eq(ingestEvents.id, reservation));

    await expect(
      claimed.session.settleJob({
        kind: "end",
        jobId: claimed.jobId,
        attempt: claimed.attempt,
        ending: { status: "done", steps: claimed.steps },
      }),
      "an unchargeable publication was committed anyway",
    ).rejects.toThrow();

    /* **Nothing published**, and the job did not end either — the whole
       transaction went back, so the next advance settles it again. */
    expect(await currentRevisionOf(slug)).toBe(fixture.publishedRevisionId);
    expect((await jobRow(claimed.jobId))?.status).toBe("running");
    /* And it was not charged on the way past, which is the other direction of
       getting this wrong: a debit for an article nobody got. */
    expect(await ledger(reservation)).toEqual(RELEASED);
  });

  /* ------------------------------------------------------------ site 2 -- */

  mine("gives the slot back when the job ends in error", async () => {
    const slug = `${SLUG_PREFIX}failed`;
    const fixture = await publishArticle(slug);
    const reservation = await reserveSlot(slug);
    const claimed = await claimWithSession(slug, ["arc"], reservation);

    const settled = await claimed.session.settleJob({
      kind: "end",
      jobId: claimed.jobId,
      attempt: claimed.attempt,
      ending: { status: "error", steps: claimed.steps, error: "the fixture stage refused to run" },
    });

    expect(settled.kind).toBe("ended");
    expect(await ledger(reservation)).toEqual(RELEASED);
    /* A failure is free, which is the product rule — and nothing was published. */
    expect(await currentRevisionOf(slug)).toBe(fixture.publishedRevisionId);
  });

  mine("gives the slot back when the job ends cancelled", async () => {
    const slug = `${SLUG_PREFIX}cancelled`;
    await publishArticle(slug);
    const reservation = await reserveSlot(slug);
    const claimed = await claimWithSession(slug, ["arc"], reservation);

    await claimed.session.settleJob({
      kind: "end",
      jobId: claimed.jobId,
      attempt: claimed.attempt,
      ending: { status: "cancelled", steps: claimed.steps },
    });

    expect(await ledger(reservation)).toEqual(RELEASED);
  });

  /* ------------------------------------------------------------ site 3 -- */

  /**
   * **The release that is really an ending** — case 4 of src/store/pg-session.ts,
   * and the one "both branches of `settleIn`" misses.
   *
   * The claimant asks to hand the job back between steps; `releaseStepIn`'s own
   * `case when cancelling` sees the Stop that landed while the step ran and ends
   * the job instead. Nothing in the `end` branch runs for this, so a settlement
   * written only there leaks the slot on every Stop pressed during a step.
   */
  mine("gives the slot back when a release resolves to a cancellation", async () => {
    const slug = `${SLUG_PREFIX}stopped-midstep`;
    const fixture = await publishArticle(slug);
    const reservation = await reserveSlot(slug);
    const claimed = await claimWithSession(slug, ["arc"], reservation);

    /* Stop, landing while the step runs. Set directly rather than through
       `requestCancel` so that this case is about the *release* and not about
       site 5 — a live lease means `requestCancel` writes exactly this flag. */
    await db()
      .update(jobsTable)
      .set({ cancelling: true })
      .where(eq(jobsTable.id, claimed.jobId));

    await claimed.session.beginStep(slug, "arc");
    const settled = await claimed.session.commit(
      contextFor(slug),
      fakeArc(),
      claimed.attempt,
      { detail: "one entry", parts: { arc: arcSaying(slug, fixture.blocks, "the arc the job wrote") } },
      { kind: "release", jobId: claimed.jobId, attempt: claimed.attempt, steps: claimed.steps, fields: {} },
    );

    /* The settlement that *happened*, not the one asked for — the release came
       back as an ending, which is the branch under test. */
    expect(settled.kind).toBe("ended");
    expect((await jobRow(claimed.jobId))?.status).toBe("cancelled");
    expect(await ledger(reservation)).toEqual(RELEASED);
  });

  /* ------------------------------------------------------------ site 4 -- */

  /**
   * **The reader closed the tab.** No claimant will ever come back, so no
   * session runs and `settleIn` never sees this job — the sweep is the only
   * thing that can give the slot back.
   */
  mine("gives the slot back when the lease lapses", async () => {
    const slug = `${SLUG_PREFIX}expired`;
    const reservation = await reserveSlot(slug);
    const job = await queueJob(slug, ["arc"], reservation);
    const attempt = mintAttempt();
    await claimWhenSlotFree(job.id, attempt);
    await lapseLease(job.id);

    /* Owner-scoped, so a peer suite's expired job is not this file's to end. */
    const settled = await pgJobStore.settleExpired(undefined, OWNER);

    expect(settled).toContainEqual({ id: job.id, status: "error" });
    expect(await ledger(reservation)).toEqual(RELEASED);
  });

  /**
   * **More than one at a time**, which is what the sweep's settlement is
   * actually shaped for.
   *
   * `settleExpired` used to issue one settlement statement per settled job while
   * holding every one of their row locks; it is one set-based `UPDATE` now, and
   * that rewrite is invisible to a case that only ever expires a single job. The
   * cap on how many rows one sweep can return is `SPIDERYARN_JOB_CONCURRENCY`,
   * which takes any positive integer — so "occasionally one" was never a
   * property of the code. GPT Sol, 2026-09-03, finding 5.
   *
   * Three, because that is the whole free lifetime allowance and therefore the
   * most this file can reserve in one case.
   *
   * **The leases are never actually lapsed**, and that is what makes this case
   * deterministic on a shared database. `settleExpired` has a global, unscoped
   * caller — `advanceJobWith` (src/jobs.ts), which every `pump` iteration goes
   * through — so a dev server on this same box ends *anybody's* job the moment
   * its lease runs out, and three jobs sitting expired while the test gets round
   * to sweeping them is an invitation. Passing a `now` an hour ahead instead
   * asks the sweep to settle jobs whose leases are still live by the wall clock:
   * this case sees all three, and nothing outside it can. That argument is what
   * the parameter is for — src/store/pg-jobs.ts § "Database time, unless a test
   * says otherwise".
   */
  mine("gives every slot back when several leases lapse at once", async () => {
    const reservations: string[] = [];
    const ids: string[] = [];
    for (const suffix of ["expired-a", "expired-b", "expired-c"]) {
      const slug = `${SLUG_PREFIX}${suffix}`;
      const reservation = await reserveSlot(slug);
      const job = await queueJob(slug, ["arc"], reservation);
      await claimWhenSlotFree(job.id, mintAttempt());
      reservations.push(reservation);
      ids.push(job.id);
    }

    const anHourFromNow = new Date(Date.now() + 3_600_000);
    const settled = await pgJobStore.settleExpired(anHourFromNow, OWNER);

    expect(settled.map((row) => row.id).sort()).toEqual([...ids].sort());
    for (const reservation of reservations) {
      expect(await ledger(reservation), `${reservation} was left in flight`).toEqual(RELEASED);
    }
  });

  /* ------------------------------------------------------------ site 5 -- */

  /**
   * **Stop, before anything picked the job up.** One `UPDATE` takes it straight
   * to `cancelled`, and this is the commonest way a slot leaks: a reader who
   * changes their mind twice would have spent two of three lifetime ingests on
   * nothing.
   */
  mine("gives the slot back when Stop ends a queued job", async () => {
    const slug = `${SLUG_PREFIX}stopped-queued`;
    const reservation = await reserveSlot(slug);
    const job = await queueJob(slug, ["arc"], reservation);

    const stopped = await pgJobStore.requestCancel(job.id, OWNER);

    expect(stopped?.status).toBe("cancelled");
    expect(await ledger(reservation)).toEqual(RELEASED);
  });

  /**
   * **The asking branch settles nothing**, and that is the half a release
   * written into `requestCancel` unconditionally would get wrong: the claimant
   * is still inside the job, and its own ending is what settles.
   */
  mine("settles nothing when Stop only asks a live claimant", async () => {
    const slug = `${SLUG_PREFIX}stopped-live`;
    await publishArticle(slug);
    const reservation = await reserveSlot(slug);
    const claimed = await claimWithSession(slug, ["arc"], reservation);

    const asked = await pgJobStore.requestCancel(claimed.jobId, OWNER);

    expect(asked?.status, "a live claim was cancelled out from under its claimant").toBe("running");
    expect(asked?.cancelling).toBe(true);
    expect(await ledger(reservation)).toEqual(UNSETTLED);
  });

  /**
   * **A release with nothing to release is a log, not a 500** — the tolerant
   * half of the asymmetry, and the reason it is not simply symmetrical with the
   * charge.
   *
   * This is the ordinary shape of it: the slot has already been given back, so
   * the release matches no row and there is nothing wrong. Idempotent, quiet,
   * and the job still ends.
   */
  mine("still ends the job when the slot was already released", async () => {
    const slug = `${SLUG_PREFIX}already-released`;
    const reservation = await reserveSlot(slug);
    const job = await queueJob(slug, ["arc"], reservation);
    await db()
      .update(ingestEvents)
      .set({ releasedAt: new Date() })
      .where(eq(ingestEvents.id, reservation));

    let stopped: Job | undefined;
    const said = await logLinesWhile(async () => {
      stopped = await pgJobStore.requestCancel(job.id, OWNER);
    });

    expect(stopped?.status, "a ledger anomaly turned the reader's Stop into a failure").toBe(
      "cancelled",
    );
    expect(await ledger(reservation)).toEqual(RELEASED);
    /* **And it said nothing about it**, which is the half that keeps the loud
       case below meaning something: a warning on every idempotent release is a
       warning nobody reads. Weak on its own — an empty capture satisfies it —
       and that is exactly what the next case rules out, with the same capture
       and the same level. */
    expect(said, "an ordinary idempotent release was reported as an anomaly").not.toContain(
      reservation,
    );
  });

  /**
   * **A slot that is already *charged* under a job that ended cancelled is a
   * contradiction, and it must not be silent.**
   *
   * The ledger rule is that a job ending other than successfully releases its
   * slot; a `succeeded_at` here means somebody has been billed for an article
   * they did not get, and until 2026-09-03 the release path treated it exactly
   * like the harmless already-released case above. GPT Sol, finding 3 — and the
   * test that stood here **asserted the silence**, which is how the bug had a
   * test defending it.
   *
   * It still must not throw. The reader pressed Stop, and a ledger anomaly they
   * did not cause and cannot fix would leave the job un-ended behind a 500. So:
   * loud, and harmless.
   */
  mine("says so loudly when an ending job's slot has already been charged", async () => {
    const slug = `${SLUG_PREFIX}already-charged`;
    const reservation = await reserveSlot(slug);
    const job = await queueJob(slug, ["arc"], reservation);
    await db()
      .update(ingestEvents)
      .set({ succeededAt: new Date() })
      .where(eq(ingestEvents.id, reservation));

    let stopped: Job | undefined;
    const said = await logLinesWhile(async () => {
      stopped = await pgJobStore.requestCancel(job.id, OWNER);
    });

    expect(stopped?.status, "a ledger anomaly turned the reader's Stop into a failure").toBe(
      "cancelled",
    );
    /* And it did not undo the settlement it found, which the `where` clause on
       both statements is what guarantees. */
    expect(await ledger(reservation)).toEqual(CHARGED);

    /* **The capture caught something**, first — every other way this could go
       wrong (the level left at `silent`, a path that stopped logging, a future
       pino writing some other way) produces an empty string, and an empty
       string satisfies every `toContain` you can write back to front.
       tests/helpers/log-capture.ts. */
    expect(said, "the log capture caught nothing at all").not.toBe("");
    expect(said).toContain('"level":"error"');
    expect(said).toContain(reservation);
    expect(said).toContain("already charged");
  });

  /* ---------------------------------- sites 6 and 7: the store's own endings -- */

  /**
   * **`pgJobStore.finish` ends a job too**, and for a while it was the one
   * terminal transition that settled nothing.
   *
   * No caller in `src/` takes this route — the coordinator goes through
   * `pgStoreSession` — so this was a trap rather than a leak. But it is the
   * advertised `JobStore` API, and the trap has teeth: `forget` deletes a
   * terminal job, and `jobs.ingest_event_id` is the *only* record of which slot
   * that job was spending. Delete it over an unsettled reservation and the slot
   * counts against its owner for ever with nothing left to say why. GPT Sol,
   * 2026-09-03, finding 1.
   *
   * So the `forget` is part of the case rather than tidying-up: it is the second
   * half of the failure being ruled out.
   */
  mine("gives the slot back when `finish` ends the job on the store itself", async () => {
    const slug = `${SLUG_PREFIX}store-finish`;
    const reservation = await reserveSlot(slug);
    const job = await queueJob(slug, ["arc"], reservation);
    const attempt = mintAttempt();
    const claimed = await claimWhenSlotFree(job.id, attempt);

    const ended = await pgJobStore.finish(job.id, attempt, {
      status: "error",
      steps: claimed.steps,
      error: "ended through the store rather than through a session",
    });

    expect(ended.status).toBe("error");
    expect(await ledger(reservation)).toEqual(RELEASED);

    /* And now the provenance can go, because there is nothing left to trace. */
    expect(await pgJobStore.forget(job.id, OWNER)).toBe(true);
    expect(await ledger(reservation), "forgetting the job stranded its slot").toEqual(RELEASED);
  });

  /**
   * **A `done` through the raw store releases rather than charges**, and that is
   * a decision rather than an oversight.
   *
   * `finish` moves the job row and nothing else: no publication, no revision,
   * nothing the reader receives. Charging for that would be a debit for an
   * article nobody got, and the strict charge would take the transition down
   * with it the moment the slot had already been settled. The only path that may
   * charge is the one that publishes in the same transaction — `settleIn`.
   */
  mine("releases rather than charges when `finish` ends a job `done`", async () => {
    const slug = `${SLUG_PREFIX}store-finish-done`;
    const reservation = await reserveSlot(slug);
    const job = await queueJob(slug, ["arc"], reservation);
    const attempt = mintAttempt();
    const claimed = await claimWhenSlotFree(job.id, attempt);

    await pgJobStore.finish(job.id, attempt, { status: "done", steps: claimed.steps });

    expect(await ledger(reservation)).toEqual(RELEASED);
  });

  /**
   * **`pgJobStore.releaseStep` is terminal too, but only sometimes** — its own
   * `case when cancelling` decides, exactly as it does inside `settleIn`. So the
   * settlement has to follow the status the statement chose rather than the name
   * of the method that was called.
   */
  mine("gives the slot back when `releaseStep` resolves to a cancellation", async () => {
    const slug = `${SLUG_PREFIX}store-release-cancel`;
    const reservation = await reserveSlot(slug);
    const job = await queueJob(slug, ["arc"], reservation);
    const attempt = mintAttempt();
    const claimed = await claimWhenSlotFree(job.id, attempt);
    await db().update(jobsTable).set({ cancelling: true }).where(eq(jobsTable.id, job.id));

    const after = await pgJobStore.releaseStep(job.id, attempt, claimed.steps, {});

    expect(after.status).toBe("cancelled");
    expect(await ledger(reservation)).toEqual(RELEASED);
  });

  /**
   * The other half, and the one a settlement written unconditionally would get
   * wrong: an ordinary release hands the job back to the queue, which is not an
   * ending, and the slot is still being spent.
   */
  mine("settles nothing when `releaseStep` hands the job back to the queue", async () => {
    const slug = `${SLUG_PREFIX}store-release-queued`;
    const reservation = await reserveSlot(slug);
    const job = await queueJob(slug, ["arc"], reservation);
    const attempt = mintAttempt();
    const claimed = await claimWhenSlotFree(job.id, attempt);

    const after = await pgJobStore.releaseStep(job.id, attempt, claimed.steps, {});

    expect(after.status).toBe("queued");
    expect(await ledger(reservation)).toEqual(UNSETTLED);
  });

  /* ---------------------------- a cancel and a publication, one after another -- */

  /**
   * **Two states, taken in turn — and deliberately not a race.**
   *
   * An earlier version of this comment said "both directions of the race,
   * deterministically", and GPT Sol was right that it claimed more than the code
   * does (2026-09-03, finding 4). These two cases complete the first transition
   * and *then* start the second, so what they hold is that each **pre-existing
   * state** is handled correctly. Nothing here blocks on anything.
   *
   * That is not a gap papered over: a cancel and a publication contending over a
   * *running* job have no race to lose, because which of them ends the job is
   * decided by the lease rather than by arrival order. With a live lease
   * `requestCancel` can only ask; with a lapsed one the claimant's fence refuses
   * it whatever the ordering. The two cases below are those two states, and they
   * are the whole of that pair. The genuinely order-decided contentions are two
   * writers that can *both* end the job, and those are the two real
   * two-connection cases at the foot of this file.
   *
   * The publication winning is the ordinary shape: Stop arrives during the last
   * step, the claimant is alive, so `requestCancel` only asks — and the job
   * still finishes `done` (`finishIn` deliberately does not un-finish it,
   * src/store/pg-jobs.ts). A release from outside that transition would have
   * freed a slot the publication then charged nothing for.
   */
  mine("charges exactly once when a Stop loses to the publication", async () => {
    const slug = `${SLUG_PREFIX}race-publish`;
    await publishArticle(slug);
    const reservation = await reserveSlot(slug);
    const claimed = await claimWithSession(slug, ["arc"], reservation);

    await pgJobStore.requestCancel(claimed.jobId, OWNER);
    await claimed.session.settleJob({
      kind: "end",
      jobId: claimed.jobId,
      attempt: claimed.attempt,
      ending: { status: "done", steps: claimed.steps },
    });

    expect((await jobRow(claimed.jobId))?.status).toBe("done");
    expect(await ledger(reservation)).toEqual(CHARGED);
  });

  /**
   * The other direction: the claimant's lease has lapsed, so `requestCancel`
   * ends the job itself and releases — and the claimant's own settlement is then
   * refused by the fence and charges nothing. One settlement, the other way up.
   */
  mine("releases exactly once when the Stop beats a stale claimant", async () => {
    const slug = `${SLUG_PREFIX}race-cancel`;
    const fixture = await publishArticle(slug);
    const reservation = await reserveSlot(slug);
    const claimed = await claimWithSession(slug, ["arc"], reservation);

    /* The claimant is provably gone by the time Stop arrives. */
    await lapseLease(claimed.jobId);
    const stopped = await pgJobStore.requestCancel(claimed.jobId, OWNER);
    expect(stopped?.status).toBe("cancelled");

    /* And the stale claimant then tries to publish anyway. */
    await expect(
      claimed.session.settleJob({
        kind: "end",
        jobId: claimed.jobId,
        attempt: claimed.attempt,
        ending: { status: "done", steps: claimed.steps },
      }),
      "a claimant whose lease had lapsed published and charged",
    ).rejects.toThrow();

    expect(await currentRevisionOf(slug)).toBe(fixture.publishedRevisionId);
    expect(await ledger(reservation)).toEqual(RELEASED);
  });

  /* ----------------------------------------------- two writers, really at once -- */

  /**
   * **Two Stops on one queued job, both blocked on its row, then let go.**
   *
   * Both of these transitions *can* end the job — that is what makes this a race
   * rather than a pair of states — so which one does is decided by arrival order
   * and by nothing else. What must hold either way is that the ledger settles
   * exactly once: the loser's `WHERE` finds no `ACTIVE` row when it is
   * re-evaluated after the winner commits, so it returns `undefined` and never
   * reaches settlement at all.
   *
   * The reader's second Stop is the everyday version of this — a disabled button
   * that was clicked twice, or two tabs open on the same shelf.
   */
  mine("ends a queued job once when two Stops arrive together", async () => {
    const slug = `${SLUG_PREFIX}race-two-stops`;
    const reservation = await reserveSlot(slug);
    const job = await queueJob(slug, ["arc"], reservation);

    const [first, second] = await racedOnJobRow(
      job.id,
      () => pgJobStore.requestCancel(job.id, OWNER),
      () => pgJobStore.requestCancel(job.id, OWNER),
    );

    const answers = [
      answerOf(first, "the first Stop"),
      answerOf(second, "the second Stop"),
    ];
    expect(
      answers.filter((answer) => answer?.status === "cancelled"),
      "both Stops believed they were the one that ended the job",
    ).toHaveLength(1);
    expect(
      answers.filter((answer) => answer === undefined),
      "neither Stop was told it had lost",
    ).toHaveLength(1);
    expect((await jobRow(job.id))?.status).toBe("cancelled");
    expect(await ledger(reservation)).toEqual(RELEASED);
  });

  /**
   * **Two `finish` calls on one live claim, at the same instant** — the store's
   * own terminal path, site 6, under contention.
   *
   * The fence is what decides: `finishIn` clears `attempt_id`, so the loser's
   * `WHERE` no longer matches and it raises `StaleAttemptError` **above** its
   * own settlement. That is the same argument the file makes about a claimant
   * that lost to a Stop, and this is where it is actually watched happening
   * rather than reasoned about.
   *
   * It is also the lock-order case: both take `jobs` and then `ingest_events`,
   * and two writers taking two tables in the same order cannot deadlock. If they
   * ever stopped agreeing on that order this would hang rather than fail, which
   * is what the suite's 60-second timeout is for.
   *
   * **Why not Stop against the expiry sweep**, which is the other pair that can
   * both end a job: it needs a lapsed lease, and a lapsed lease on this database
   * is anybody's. `advanceJobWith` (src/jobs.ts) sweeps *unscoped*, and every
   * `pump` iteration on a dev server goes through it — so a third writer nobody
   * asked for joins the race and either of the two answers this case could
   * assert stops being true. Measured, not guessed: that pairing failed here
   * exactly that way. Two `finish` calls keep a live lease throughout, so no
   * sweep can see the row at all.
   */
  mine("ends a claimed job once when two `finish` calls arrive together", async () => {
    const slug = `${SLUG_PREFIX}race-finish`;
    const reservation = await reserveSlot(slug);
    const job = await queueJob(slug, ["arc"], reservation);
    const attempt = mintAttempt();
    const claimed = await claimWhenSlotFree(job.id, attempt);
    const ending = {
      status: "error" as const,
      steps: claimed.steps,
      error: "two endings, one job",
    };

    const [first, second] = await racedOnJobRow(
      job.id,
      () => pgJobStore.finish(job.id, attempt, ending),
      () => pgJobStore.finish(job.id, attempt, ending),
    );

    const won = [first, second].filter((outcome) => "ok" in outcome);
    const lost = [first, second].filter((outcome) => "err" in outcome);
    expect(won, "both endings landed, so the fence let two writers end one job").toHaveLength(1);
    expect(lost, "neither ending was refused, so nothing was fenced").toHaveLength(1);
    expect(String((lost[0] as { err: unknown }).err)).toContain("StaleAttemptError");

    expect((await jobRow(job.id))?.status).toBe("error");
    /* Once — the loser never reached its settlement, which is the point. */
    expect(await ledger(reservation)).toEqual(RELEASED);
  });

  /* ------------------------------------------------- the regression guard -- */

  /**
   * **Most jobs have a null `ingest_event_id`** — a step re-run, CLI work,
   * seeding — and only a new ingest carries one (src/billing/admission.ts). So
   * all seven settlements must be no-ops over a null, and this is the case that
   * said the settlement stage changed nothing a reader could see and now says
   * that pressing a mode button still does not.
   *
   * All seven sites in one case, deliberately: what is being asserted is a
   * property of the *set* — that no ending anywhere throws or writes a ledger
   * row — and seven cases each proving a seventh of it would let one be deleted
   * without the sentence changing.
   */
  mine("settles a job that is spending no slot, at every site, without complaint", async () => {
    /* Site 1 — a `done` publishes as usual. */
    const doneSlug = `${SLUG_PREFIX}free-done`;
    const doneFixture = await publishArticle(doneSlug);
    const doneClaim = await claimWithSession(doneSlug, ["arc"]);
    await doneClaim.session.settleJob({
      kind: "end",
      jobId: doneClaim.jobId,
      attempt: doneClaim.attempt,
      ending: { status: "done", steps: doneClaim.steps },
    });
    expect(await currentRevisionOf(doneSlug)).not.toBe(doneFixture.publishedRevisionId);

    /* Site 2 — an `error` ends as usual. */
    const errorSlug = `${SLUG_PREFIX}free-error`;
    await publishArticle(errorSlug);
    const errorClaim = await claimWithSession(errorSlug, ["arc"]);
    await errorClaim.session.settleJob({
      kind: "end",
      jobId: errorClaim.jobId,
      attempt: errorClaim.attempt,
      ending: { status: "error", steps: errorClaim.steps, error: "no reservation here" },
    });
    expect((await jobRow(errorClaim.jobId))?.status).toBe("error");

    /* Site 3 — a release that resolves to a cancellation. */
    const stopSlug = `${SLUG_PREFIX}free-midstep`;
    const stopFixture = await publishArticle(stopSlug);
    const stopClaim = await claimWithSession(stopSlug, ["arc"]);
    await db().update(jobsTable).set({ cancelling: true }).where(eq(jobsTable.id, stopClaim.jobId));
    await stopClaim.session.beginStep(stopSlug, "arc");
    await stopClaim.session.commit(
      contextFor(stopSlug),
      fakeArc(),
      stopClaim.attempt,
      { detail: "one entry", parts: { arc: arcSaying(stopSlug, stopFixture.blocks, "no slot") } },
      { kind: "release", jobId: stopClaim.jobId, attempt: stopClaim.attempt, steps: stopClaim.steps, fields: {} },
    );
    expect((await jobRow(stopClaim.jobId))?.status).toBe("cancelled");

    /* Site 4 — a lapsed lease. */
    const expiredSlug = `${SLUG_PREFIX}free-expired`;
    const expired = await queueJob(expiredSlug, ["arc"]);
    await claimWhenSlotFree(expired.id, mintAttempt());
    await lapseLease(expired.id);
    expect(await pgJobStore.settleExpired(undefined, OWNER)).toContainEqual({
      id: expired.id,
      status: "error",
    });

    /* Site 5 — Stop on a queued job. */
    const queuedSlug = `${SLUG_PREFIX}free-queued`;
    const queued = await queueJob(queuedSlug, ["arc"]);
    expect((await pgJobStore.requestCancel(queued.id, OWNER))?.status).toBe("cancelled");

    /* Site 6 — the store's own `finish`. */
    const finishSlug = `${SLUG_PREFIX}free-finish`;
    const finished = await queueJob(finishSlug, ["arc"]);
    const finishAttempt = mintAttempt();
    const finishClaim = await claimWhenSlotFree(finished.id, finishAttempt);
    expect(
      (await pgJobStore.finish(finished.id, finishAttempt, { status: "error", steps: finishClaim.steps })).status,
    ).toBe("error");

    /* Site 7 — the store's own `releaseStep`, ending the job. */
    const releaseSlug = `${SLUG_PREFIX}free-release`;
    const released = await queueJob(releaseSlug, ["arc"]);
    const releaseAttempt = mintAttempt();
    const releaseClaim = await claimWhenSlotFree(released.id, releaseAttempt);
    await db().update(jobsTable).set({ cancelling: true }).where(eq(jobsTable.id, released.id));
    expect((await pgJobStore.releaseStep(released.id, releaseAttempt, releaseClaim.steps, {})).status).toBe(
      "cancelled",
    );

    /* **And the ledger is untouched.** Not "no row was settled" — no row was
       written at all, which is the difference between a job that spends no
       quota and one that spends a slot and gets it back. */
    const rows = await db().select().from(ingestEvents).where(eq(ingestEvents.ownerId, OWNER));
    expect(rows, "a job with no reservation wrote to the ingest ledger").toEqual([]);
  });
});
