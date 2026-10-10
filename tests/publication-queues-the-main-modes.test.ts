/**
 * **An import's first full publication queues the main-mode jobs — and no other
 * publication does.**
 *
 * Stage 1 of
 * docs/plans/261004h-post-import-modes-decided-on-the-server-for-every-import-path.md.
 * Until it, the add page queued these jobs from the browser when its tick box
 * was on, so every import that did not finish on an add page got none. Now
 * `publishRevisionIn` (src/store/pg-revisions.ts) queues them with
 * `enqueueSuccessorIn`, in the transaction that publishes.
 *
 * ## What is held here
 *
 * 1. **Which publication.** A fenced job that is not a reset, and either it
 *    reserved the article's name while the article served nothing and is not a
 *    minimal paper, or this publication is the one that turns a minimal paper
 *    full (*Read this*). Each excluded shape has its own case, built so that
 *    only the clause under test keeps it out.
 * 2. **The opt-out**: `reader_profiles.auto_modes_off_at`, read in the
 *    transaction. No row is on.
 * 3. **The jobs**: the seven requests of src/auto-mode-steps.ts, written out
 *    here a second time so the test does not agree with the code by reading it;
 *    free; carrying the reader's rendered profile; in order, after the labels
 *    job — including a labels holder whose `created_at` is later than the
 *    publication's clock (GPT Sol, F5 of the plan review).
 * 4. **One transaction.** A throw on a later mode successor takes the pointer,
 *    the earlier successors and a settlement written before it down together.
 * 5. **The same work key as a reader's own press**, so that press joins the
 *    queued job rather than adding a second.
 *
 * ## Mutations watched red, 2026-10-04
 *
 * Each is one production line in src/store/pg-revisions.ts,
 * removed.
 *
 * | mutation | red |
 * |---|---|
 * | the opt-out check in `queueMainModesIn` (`if (reader?.autoModesOffAt) return []`) removed | "queues none for a reader who has switched it off" |
 * | the `reservesName && served nothing && not minimal` clause made true | second publication, mode job, minimal paper, and the fixture loader's job |
 * | `fenced.reservesName` alone made true | "queues none under a job that reserved no name" |
 * | `reset === null` made true | "queues none on a reset's publication" |
 * | `notBefore` not passed | "stamps the modes after a labels holder whose clock was ahead" |
 *
 * ## Contention
 *
 * The harness of tests/publication-enqueues-the-labels-successor.test.ts: this
 * file's own owners and slug prefix, swept on the way in and out, under the
 * run lock because several cases claim a job.
 */
import { randomUUID } from "node:crypto";

import { asc, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  ingestEvents,
  jobs as jobsTable,
  readerProfiles,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId, mintUniqueId } from "../src/ids.js";
import { runAsOwner } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import { renderProfile } from "../src/profile.js";
import { hashBlocks } from "../src/source-hash.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/artifacts.js";
import { mintAttempt, workKeyFor } from "../src/store/jobs.js";
import { settleReservation } from "../src/store/pg-billing.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import {
  beginRevision,
  publishRevision,
  publishRevisionIn,
  recordStepRun,
} from "../src/store/pg-revisions.js";
import type { Block, Job, JobReset, JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import { pgReady } from "./helpers/pg-ready.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/**
 * **A way to make one particular `mintId` collide**, for the rollback case.
 *
 * `plan` is consumed one entry per mint: a string is the id to hand out, `null`
 * is "a real one". So `[null, null, null, taken, taken]` lets the labels job
 * and the first two modes through and makes the third mode conflict on both of
 * `enqueueSuccessorIn`'s attempts, which is its throw.
 */
const idControl = vi.hoisted(() => ({ plan: [] as (string | null)[] }));
vi.mock("../src/ids.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ids.js")>();
  return { ...actual, mintId: () => idControl.plan.shift() ?? actual.mintId() };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const OWNER_STEM = "0000a4f7-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
/** A reader who has unticked the box. */
const OPTED_OUT = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
/** A reader with something in "about you", so the profile is not vacuous. */
const PROFILED = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const EVERYONE = [OWNER, OPTED_OUT, PROFILED];
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-auto-modes-pub-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

const LEASE_MS = 60_000;
const ABOUT = "A fixture reader who studies bridges.";
const PURPOSE = "To see whether the modes are written for this.";

/**
 * **The jobs, written out again on purpose**: the single-step ones first, then
 * Skim's. A second copy of src/auto-mode-steps.ts so a change there is a
 * change somebody has to make twice.
 */
const EXPECTED: StepName[][] = [
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

const LABELS_WORK_KEY = workKeyFor(["labels"], new Set());

/* ---------------------------------------------------- is there a database -- */

let runLock: HeldRunLock | undefined;

await pgReady({
  suite: "tests/publication-queues-the-main-modes.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
    "spideryarn.ingest_events",
    "spideryarn.reader_profiles",
  ],
  columns: [{ table: "spideryarn.reader_profiles", column: "auto_modes_off_at" }],
});

runLock = await takeRunLockAndSetUp(
  "tests/publication-queues-the-main-modes.test.ts",
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
    await lockClient.query("delete from spideryarn.reader_profiles where owner_id::text like $1", [
      RUBBLE,
    ]);
    await lockClient.query("delete from auth.users where id::text like $1", [RUBBLE]);
    for (const id of EVERYONE) {
      await seedAuthUser(lockClient, { id, email: `auto-modes-pub-${id}@example.invalid` });
    }
  },
);

/* The two readers who have a row. `OWNER` has none, which is the default. */
await getDb()
  .insert(readerProfiles)
  .values([
    { ownerId: OPTED_OUT, autoModesOffAt: new Date("2026-10-04T10:00:00.000Z") },
    { ownerId: PROFILED, profile: ABOUT },
  ]);

/* `enqueue` and `readStepPower` live in src/jobs.ts, which takes the job store
   at module scope; imported after the mocks above are in place. */
const { enqueue, readStepPower } = await import("../src/jobs.js");
const { shelfStore, readerStore } = await import("../src/store/index.js");

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

/** The smallest tree `checkTree` accepts. */
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
        gist: "A fixture built by tests/publication-queues-the-main-modes.test.ts.",
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
  readonly articleId: string;
  readonly revisionId: string;
}

/**
 * A draft with blocks and a tree, complete enough to publish. `pending` labels
 * by default, which is what an import publishes with.
 */
async function fullDraft(
  slug: string,
  navLabelStatus: "pending" | "ready" = "pending",
): Promise<Draft> {
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
      excerpt: "A fixture built by tests/publication-queues-the-main-modes.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-10-04T00:00:00.000Z"),
      stampedHtml: blocks.map((b) => b.html).join("\n"),
      tree: treeFor(slug, blocks),
      navLabelStatus,
    })
    .where(eq(articleRevisions.id, begun.revisionId));
  for (const name of ["fetch", "extract", "blocks"] as StepName[]) {
    await stepRun(begun.revisionId, name);
  }
  await stepRun(begun.revisionId, "structure", hashBlocks(blocks));
  return { slug, articleId: begun.articleId, revisionId: begun.revisionId };
}

/** A minimal paper's draft: no blocks, no tree, its `metadata` step run. */
async function minimalDraft(slug: string): Promise<Draft> {
  const begun = await beginRevision({ slug });
  await db().update(articles).set({ processing: "minimal" }).where(eq(articles.id, begun.articleId));
  await db()
    .update(articleRevisions)
    .set({ title: "A paper nobody has read yet" })
    .where(eq(articleRevisions.id, begun.revisionId));
  await stepRun(begun.revisionId, "metadata");
  return { slug, articleId: begun.articleId, revisionId: begun.revisionId };
}

function stepsOf(names: StepName[]): JobStep[] {
  return names.map((name) => ({ name, label: STEPS[name].label, status: "pending" as const }));
}

interface Running {
  readonly id: string;
  readonly attemptId: string;
}

/**
 * **A running job, as the fence needs to find it** — the row a pipeline claim
 * leaves, written directly so each case can say exactly which facts it has.
 *
 * `reservesName: true` is an import: a new URL, an upload, or a retry of
 * either. `false` is everything else — a mode job, a Rebuild, and the test
 * fixture loader's synthetic job (tests/helpers/load-article.ts).
 */
async function runningJob(
  owner: OwnerId,
  slug: string,
  shape: {
    reservesName: boolean;
    steps?: StepName[];
    reset?: JobReset;
    ingestEventId?: string | undefined;
  },
): Promise<Running> {
  const running = { id: mintId(), attemptId: mintAttempt() };
  await db()
    .insert(jobsTable)
    .values({
      id: running.id,
      ownerId: owner,
      slug,
      steps: stepsOf(shape.steps ?? ["fetch", "extract", "blocks", "structure", "assets"]),
      status: "running",
      attemptId: running.attemptId,
      leaseExpiresAt: new Date(Date.now() + 600_000),
      workKey: `auto-modes-pub-fixture-${running.id}`,
      reservesName: shape.reservesName,
      ...(shape.reset ? { reset: shape.reset } : {}),
      ...(shape.ingestEventId ? { ingestEventId: shape.ingestEventId } : {}),
    });
  return running;
}

/** What `settleIn` does to the job after its publication: it is over. */
async function endJob(id: string): Promise<void> {
  await db()
    .update(jobsTable)
    .set({ status: "done", attemptId: null, leaseExpiresAt: null })
    .where(eq(jobsTable.id, id));
}

/** Publish `draft` under `job`, then end the job, as a pipeline's last commit does. */
async function publishUnder(draft: Draft, job: Running) {
  const published = await publishRevision({ slug: draft.slug, revisionId: draft.revisionId, job });
  await endJob(job.id);
  return published;
}

/* --------------------------------------------------------------- the reads -- */

/** Every job on the article except `not`, in the order the line claims them. */
async function lineOf(slug: string, not: string[] = []) {
  const rows = await db()
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.slug, slug))
    .orderBy(asc(jobsTable.createdAt), asc(jobsTable.id));
  return rows.filter((row) => !not.includes(row.id));
}

const names = (row: { steps: JobStep[] }) => row.steps.map((s) => s.name);

/** The queued jobs that are not the labels successor: the modes, if any. */
async function modesOf(slug: string, not: string[] = []) {
  return (await lineOf(slug, not)).filter(
    (row) => row.status === "queued" && row.workKey !== LABELS_WORK_KEY,
  );
}

async function currentRevisionOf(slug: string): Promise<string | null> {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row?.currentRevisionId ?? null;
}

const as = (owner: OwnerId, name: string, body: () => Promise<void>) =>
  it(name, () => runAsOwner(owner, body));
const mine = (name: string, body: () => Promise<void>) => as(OWNER, name, body);

/* ------------------------------------------------------------------ tests -- */

describe("an import's first full publication queues the main modes", () => {
  afterAll(async () => {
    await cleanUpThenRelease(
      async () => {
        const database = getDb();
        for (const owner of EVERYONE) {
          await database.delete(jobsTable).where(eq(jobsTable.ownerId, owner));
          await database.delete(ingestEvents).where(eq(ingestEvents.ownerId, owner));
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

  mine("queues exactly the listed jobs, after the labels job, each free", async () => {
    const slug = `${SLUG_PREFIX}first`;
    const draft = await fullDraft(slug);
    /* A paying reader's import: it carries a reservation, which no successor
       may inherit. */
    const [reservation] = await db().insert(ingestEvents).values({ ownerId: OWNER, slug }).returning();
    const job = await runningJob(OWNER, slug, { reservesName: true, ingestEventId: reservation?.id });

    const published = await publishUnder(draft, job);

    const line = await lineOf(slug, [job.id]);
    expect(line.map(names), "the line is not labels, then the modes in order").toEqual([
      ["labels"],
      ...EXPECTED,
    ]);
    expect(published.successor?.kind).toBe("queued");
    expect(published.autoModes.map((outcome) => outcome.kind)).toEqual(EXPECTED.map(() => "queued"));
    expect(published.autoModes.map((outcome) => outcome.jobId)).toEqual(line.slice(1).map((row) => row.id));

    for (const row of line.slice(1)) {
      const what = names(row).join("+");
      expect.soft(row.status, what).toBe("queued");
      expect.soft(row.ownerId, what).toBe(OWNER);
      expect.soft(row.ingestEventId, `${what} carries a quota slot`).toBeNull();
      expect.soft(row.reservesName, `${what} reserves the name`).toBe(false);
      expect.soft(row.urlKey, `${what} carries a url key`).toBeNull();
      expect.soft(row.url, `${what} carries a url`).toBeNull();
      expect.soft(row.reset, `${what} is a reset`).toBeNull();
      /* This reader has no "about you" and the article no purpose, so there
         is no profile — and the key is the bare one a reader's press has. */
      expect.soft(row.profile, `${what} carries a profile nobody wrote`).toBeNull();
      expect.soft(row.workKey, what).toBe(workKeyFor(names(row) as StepName[], new Set()));
    }
    /* Strictly after the labels job, and strictly in order: a tie would leave
       the order to the random id. */
    const stamps = line.map((row) => row.createdAt.getTime());
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    const exact = await db().execute<{ distinct_stamps: number }>(sql`
      select count(distinct created_at)::int as distinct_stamps
        from spideryarn.jobs where slug = ${slug} and id <> ${job.id}`);
    expect(exact.rows[0]?.distinct_stamps, "two successors share a created_at").toBe(EXPECTED.length + 1);
  });

  /* ------------------------------------------------------------------ 2 -- */

  as(PROFILED, "gives each job the reader's profile as it stands at publication", async () => {
    const slug = `${SLUG_PREFIX}profile`;
    const draft = await fullDraft(slug);
    await db().update(articles).set({ purpose: PURPOSE }).where(eq(articles.id, draft.articleId));
    const job = await runningJob(PROFILED, slug, { reservesName: true });

    await publishUnder(draft, job);

    const rendered = renderProfile({ profile: ABOUT, purpose: PURPOSE });
    expect(rendered).toContain(ABOUT);
    const modes = await modesOf(slug, [job.id]);
    expect(modes.map(names)).toEqual(EXPECTED);
    for (const row of modes) {
      expect.soft(row.profile, names(row).join("+")).toBe(rendered);
      expect
        .soft(row.workKey, names(row).join("+"))
        .toBe(workKeyFor(names(row) as StepName[], new Set(), rendered ?? undefined));
    }
    /* The labels job takes no profile, and must not start carrying one. */
    const labels = (await lineOf(slug, [job.id])).find((row) => row.workKey === LABELS_WORK_KEY);
    expect(labels?.profile ?? null).toBeNull();
  });

  /* ------------------------------------------------------------------ 3 -- */

  as(OPTED_OUT, "queues none for a reader who has switched it off", async () => {
    const slug = `${SLUG_PREFIX}opted-out`;
    const draft = await fullDraft(slug);
    const job = await runningJob(OPTED_OUT, slug, { reservesName: true });

    const published = await publishUnder(draft, job);

    expect(published.autoModes).toEqual([]);
    expect((await modesOf(slug, [job.id])).map(names), "an opted-out reader got modes").toEqual([]);
    /* The labels job is not part of the choice. */
    expect((await lineOf(slug, [job.id])).map(names)).toEqual([["labels"]]);
  });

  /* ------------------------------------------------------------------ 4 -- */

  /**
   * Rebuild, and a re-add that re-extracts: the article is already serving
   * something. The job reserves the name here so that *served nothing* is the
   * only clause keeping it out.
   */
  mine("queues none on a second publication", async () => {
    const slug = `${SLUG_PREFIX}second`;
    const first = await fullDraft(slug, "ready");
    await publishRevision({ slug, revisionId: first.revisionId });
    expect(await modesOf(slug)).toEqual([]);

    const second = await beginRevision({ slug });
    const job = await runningJob(OWNER, slug, { reservesName: true });
    const published = await publishUnder({ slug, articleId: second.articleId, revisionId: second.revisionId }, job);

    expect(await currentRevisionOf(slug)).toBe(second.revisionId);
    expect(published.autoModes).toEqual([]);
    expect((await modesOf(slug, [job.id])).map(names), "a Rebuild queued the modes").toEqual([]);
  });

  /* ------------------------------------------------------------------ 5 -- */

  /**
   * Start again has its own `regenerate` list. Built on an article that serves
   * nothing, under a job that reserves the name, so that *not a reset* is the
   * only clause keeping it out.
   */
  mine("queues none on a reset's publication", async () => {
    const slug = `${SLUG_PREFIX}reset`;
    const draft = await fullDraft(slug, "ready");
    const job = await runningJob(OWNER, slug, { reservesName: true, reset: { regenerate: ["glossary"] } });

    const published = await publishUnder(draft, job);

    expect(published.autoModes).toEqual([]);
    /* Its own regeneration, scoped to the reset, and nothing else. */
    expect(published.regenerated.map((outcome) => outcome.kind)).toEqual(["queued"]);
    expect((await modesOf(slug, [job.id])).map(names)).toEqual([["glossary"]]);
  });

  /* ------------------------------------------------------------------ 6 -- */

  mine("queues none on a mode job's publication", async () => {
    const slug = `${SLUG_PREFIX}mode-job`;
    const first = await fullDraft(slug, "ready");
    await publishRevision({ slug, revisionId: first.revisionId });

    const second = await beginRevision({ slug });
    const job = await runningJob(OWNER, slug, { reservesName: false, steps: ["glossary"] });
    const published = await publishUnder({ slug, articleId: second.articleId, revisionId: second.revisionId }, job);

    expect(published.autoModes).toEqual([]);
    expect((await modesOf(slug, [job.id])).map(names)).toEqual([]);
  });

  /* ------------------------------------------------------------------ 7 -- */

  /** Title, authors and abstract only: there is nothing for a mode to read. */
  mine("queues none for a minimal paper", async () => {
    const slug = `${SLUG_PREFIX}minimal`;
    const draft = await minimalDraft(slug);
    const job = await runningJob(OWNER, slug, { reservesName: true, steps: ["fetch", "metadata"] });

    const published = await publishUnder(draft, job);

    expect(await currentRevisionOf(slug)).toBe(draft.revisionId);
    expect(published.autoModes).toEqual([]);
    expect((await lineOf(slug, [job.id])).map(names), "a minimal paper queued something").toEqual([]);
  });

  /* ------------------------------------------------------------------ 8 -- */

  /** A script or `publishRevision` on its own: no job, so no import. */
  mine("queues none on a publication with no job", async () => {
    const slug = `${SLUG_PREFIX}job-less`;
    const draft = await fullDraft(slug);

    const published = await publishRevision({ slug, revisionId: draft.revisionId });

    expect(published.autoModes).toEqual([]);
    expect((await lineOf(slug)).map(names)).toEqual([["labels"]]);
  });

  /* ------------------------------------------------------------------ 9 -- */

  /**
   * **The test fixture loader's shape** (tests/helpers/load-article.ts §
   * `withRunningJob`): a synthetic running job that reserves no name,
   * publishing an article's first revision. GPT Sol's F1: a trigger on
   * `opts.job` alone let it in, and seven undriven jobs then blocked the next
   * test's exclusive steps. Also the shape of a job that adopted its slug from
   * another live job.
   */
  mine("queues none under a job that reserved no name", async () => {
    const slug = `${SLUG_PREFIX}fixture-loader`;
    const draft = await fullDraft(slug);
    const job = await runningJob(OWNER, slug, { reservesName: false });

    const published = await publishUnder(draft, job);

    expect(published.autoModes).toEqual([]);
    expect((await modesOf(slug, [job.id])).map(names), "the fixture loader's job queued the modes").toEqual([]);
  });

  /* ----------------------------------------------------------------- 10 -- */

  /**
   * *Read this*: the publication that lands a tree on a minimal paper. The job
   * reserves no name here, so `upgradedFromMinimal` is the only clause letting
   * it in.
   */
  mine("queues them when Read this turns a minimal paper full", async () => {
    const slug = `${SLUG_PREFIX}read-this`;
    const minimal = await minimalDraft(slug);
    await publishRevision({ slug, revisionId: minimal.revisionId });
    expect((await lineOf(slug)).map(names)).toEqual([]);

    const full = await fullDraft(slug);
    /* Paid for, which `requirePaidUpgrade` asks of the job's own reservation. */
    const [reservation] = await db()
      .insert(ingestEvents)
      .values({ ownerId: OWNER, slug, articleId: full.articleId })
      .returning();
    const job = await runningJob(OWNER, slug, { reservesName: false, ingestEventId: reservation?.id });

    const published = await publishUnder(full, job);

    expect(published.upgradedFromMinimal).toBe(true);
    expect((await modesOf(slug, [job.id])).map(names), "Read this queued no modes").toEqual(EXPECTED);
  });

  /* ----------------------------------------------------------------- 11 -- */

  /**
   * Retry on the shelf's job card: a new job, which reserves the name again,
   * over an article row the failed attempt left serving nothing. With no
   * reservation, which is also the administrator's import: an administrator
   * reserves nothing anywhere, so `ingest_event_id` cannot be the test.
   */
  mine("queues them for a retried import, and for one that carries no reservation", async () => {
    const slug = `${SLUG_PREFIX}retried`;
    /* The first attempt: a draft that never published, under a job that ended in error. */
    const abandoned = await beginRevision({ slug });
    const failed = await runningJob(OWNER, slug, { reservesName: true });
    await db()
      .update(jobsTable)
      .set({ status: "error", attemptId: null, leaseExpiresAt: null, error: "the first attempt failed" })
      .where(eq(jobsTable.id, failed.id));
    await db().update(articleRevisions).set({ status: "failed" }).where(eq(articleRevisions.id, abandoned.revisionId));
    expect(await currentRevisionOf(slug)).toBeNull();

    const draft = await fullDraft(slug);
    const retry = await runningJob(OWNER, slug, { reservesName: true });
    await publishUnder(draft, retry);

    expect((await modesOf(slug, [failed.id, retry.id])).map(names), "a retried import queued no modes").toEqual(
      EXPECTED,
    );
  });

  /* ----------------------------------------------------------------- 12 -- */

  /**
   * **One transaction.** The third mode's insert conflicts on both attempts
   * (a forced id collision), which is `enqueueSuccessorIn`'s throw — and the
   * pointer, the labels job, the two modes already inserted and a settlement
   * written earlier in the same transaction all go with it.
   */
  mine("rolls everything back when a later mode successor throws", async () => {
    const slug = `${SLUG_PREFIX}rollback`;
    const taken = mintId();
    await db()
      .insert(jobsTable)
      .values({
        id: taken,
        ownerId: OWNER,
        slug: `${SLUG_PREFIX}rollback-elsewhere`,
        steps: stepsOf(["arc"]),
        status: "done",
        workKey: `auto-modes-pub-taken-${taken}`,
      });
    const draft = await fullDraft(slug);
    const [reservation] = await db().insert(ingestEvents).values({ ownerId: OWNER, slug }).returning();
    const job = await runningJob(OWNER, slug, { reservesName: true, ingestEventId: reservation?.id });
    const before = await currentRevisionOf(slug);

    /* labels, mode 1, mode 2 real; mode 3 collides twice. */
    idControl.plan = [null, null, null, taken, taken];
    try {
      await expect(
        db().transaction(async (tx) => {
          await settleReservation(tx, reservation?.id, { kind: "succeeded", articleId: draft.articleId });
          await publishRevisionIn(tx, { slug, revisionId: draft.revisionId, job });
        }),
        "the publication committed with some of its modes missing",
      ).rejects.toThrow(/conflicted with a unique index twice/);
    } finally {
      idControl.plan = [];
    }

    expect.soft(await currentRevisionOf(slug), "the pointer moved").toBe(before);
    expect.soft((await lineOf(slug, [job.id])).map(names), "earlier successors survived").toEqual([]);
    const [after] = await db().select().from(ingestEvents).where(eq(ingestEvents.id, reservation?.id ?? ""));
    expect.soft(after?.succeededAt, "the settlement survived").toBeNull();
  });

  /* ----------------------------------------------------------------- 13 -- */

  /**
   * **A labels job already queued, stamped by a clock ahead of the database's.**
   * The labels successor collapses onto it without touching its `created_at`,
   * so modes stamped from this transaction's `now()` would sort *before* it
   * and could claim first. `notBefore` stamps them from the later of the two.
   * GPT Sol, F5 of the plan review.
   */
  mine("stamps the modes after a labels holder whose clock was ahead", async () => {
    const slug = `${SLUG_PREFIX}holder-ahead`;
    const draft = await fullDraft(slug);
    const holder = mintId();
    const ahead = new Date(Date.now() + 3_600_000);
    await db()
      .insert(jobsTable)
      .values({
        id: holder,
        ownerId: OWNER,
        slug,
        steps: stepsOf(["labels"]),
        status: "queued",
        createdAt: ahead,
        workKey: LABELS_WORK_KEY,
      });
    const job = await runningJob(OWNER, slug, { reservesName: true });

    const published = await publishUnder(draft, job);

    expect(published.successor).toEqual({ kind: "alreadyQueued", jobId: holder });
    const line = await lineOf(slug, [job.id]);
    expect(line.map(names), "a mode sorts ahead of the labels job").toEqual([["labels"], ...EXPECTED]);
    expect(line[0]?.id).toBe(holder);
  });

  mine("moves an identical mode queued during import behind labels without duplicating it", async () => {
    const slug = `${SLUG_PREFIX}mode-holder-before-labels`;
    const draft = await fullDraft(slug);
    const job = await runningJob(OWNER, slug, { reservesName: true });
    const holder = mintId();
    await db().insert(jobsTable).values({
      id: holder,
      ownerId: OWNER,
      slug,
      steps: stepsOf(["quotes"]),
      status: "queued",
      createdAt: new Date(Date.now() - 60_000),
      workKey: workKeyFor(["quotes"], new Set()),
    });

    const published = await publishUnder(draft, job);
    const line = await lineOf(slug, [job.id]);
    expect(line.map(names), "the old holder overtook labels or changed the modes' order").toEqual([
      ["labels"], ...EXPECTED,
    ]);
    expect(line.find((row) => names(row).join() === "quotes")?.id).toBe(holder);
    expect(published.autoModes).toContainEqual({ kind: "alreadyQueued", jobId: holder });
    const blocked = await pgJobStore.claim(holder, OWNER, mintAttempt(), LEASE_MS, 4);
    expect(blocked.kind, "Quotes claimed before labels ended").toBe("busy");
  });

  /* ----------------------------------------------------------------- 14 -- */

  /**
   * **What High-powered AI is still promised** (the plan's § High-powered AI):
   * no mode starts until the labels job ahead of it has ended, and each step
   * reads the article's power as it starts. So a switch committed while labels
   * ran is the power the mode runs on.
   */
  mine("a mode waits behind labels, and then reads a power switched on meanwhile", async () => {
    const slug = `${SLUG_PREFIX}power`;
    const draft = await fullDraft(slug);
    const job = await runningJob(OWNER, slug, { reservesName: true });
    await publishUnder(draft, job);

    const line = await lineOf(slug, [job.id]);
    const labels = line[0];
    const mode = line[1];
    expect(names(labels ?? { steps: [] })).toEqual(["labels"]);
    if (!labels || !mode) throw new Error("the publication queued nothing to test");

    const blocked = await pgJobStore.claim(mode.id, OWNER, mintAttempt(), LEASE_MS, 4);
    expect(blocked.kind, "a mode claimed while the labels job was still ahead of it").toBe("busy");

    const asJob = { id: mode.id, ownerId: OWNER, slug, steps: mode.steps, status: "queued", createdAt: "" } as Job;
    expect(await readStepPower(asJob)).toBe("standard");
    await db().update(articles).set({ highPowerSince: new Date() }).where(eq(articles.id, draft.articleId));
    await endJob(labels.id);

    const claimed = await pgJobStore.claim(mode.id, OWNER, mintAttempt(), LEASE_MS, 4);
    expect(claimed.kind).toBe("claimed");
    expect(await readStepPower(asJob), "the mode would run on the standard model").toBe("high");
  });

  /* ----------------------------------------------------------------- 15 -- */

  /**
   * **The reader's own press joins the queued job.** Through the real
   * `enqueue`, with the profile resolved the way `POST /api/jobs` resolves it
   * (`resolveProfile`, src/routes.ts: the reader store and the shelf). A
   * different key here would be a second job, and for Ideas a second paid run.
   */
  as(PROFILED, "a reader's identical press joins the queued job", async () => {
    const slug = `${SLUG_PREFIX}same-key`;
    const draft = await fullDraft(slug);
    await db().update(articles).set({ purpose: PURPOSE }).where(eq(articles.id, draft.articleId));
    const job = await runningJob(PROFILED, slug, { reservesName: true });
    await publishUnder(draft, job);
    const queued = await modesOf(slug, [job.id]);

    const profile = renderProfile({
      profile: await readerStore.readProfile(),
      purpose: (await shelfStore.read(slug)).purpose ?? null,
    });
    expect(profile, "the fixture reader has no profile to resolve").not.toBeNull();

    const was = process.env.VERCEL;
    process.env.VERCEL = "1"; // so `enqueue` starts no pump
    try {
      for (const steps of [["glossary"], ["quotes", "ideas", "skim"]] as StepName[][]) {
        const pressed = await enqueue({ slug, steps, ...(profile ? { profile } : {}) });
        const holder = queued.find((row) => names(row).join() === steps.join());
        expect(pressed.id, `${steps.join("+")}: the press made a second job`).toBe(holder?.id);
      }
    } finally {
      if (was === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = was;
    }
    expect((await modesOf(slug, [job.id])).map(names)).toEqual(EXPECTED);
  });
});
