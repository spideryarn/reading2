/**
 * **A structure step whose slices run out of time puts its job down for
 * another lease window, with the answers it bought kept**, and the next window
 * finishes from them. Through the real `enqueue`, claim, walk, `blocks` and
 * `structure` steps, draft and publication, on Postgres.
 *
 * Stage C of
 * docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md
 * § "Plan: the rest of stage 1a". tests/structure-step-another-window.test.ts
 * holds the step on its own; this file is the pieces joined, because the step
 * alone cannot show that the draft is kept, that the next window is not
 * skipped as done, or that the calls reached the ledger.
 *
 * ## What is real and what is not
 *
 * `fetch`, `extract` and `assets` are fakes. The model is a fake at
 * `streamMessage` that answers over exactly the blocks it is shown
 * (tests/helpers/slice-model.ts) **and reports each call to the real spend
 * collector**, as the real gateway does, so a ledger row is a real row.
 *
 * ## How a run is made to run out of time
 *
 * Only `Date` is faked; timers and the database are real. The article is
 * read in three slices. The second one's call waits for the other two to
 * answer, moves the clock on by `JUMP`, and fails. Its second ask then does
 * not fit before the slices' deadline, which is `out-of-time` with two
 * answers saved and one missing.
 *
 * ## Watched red, 2026-10-06
 *
 * Each is one production line changed and then put back. This file was written
 * after the change it tests, so the first row is its red.
 *
 * | change | red |
 * |---|---|
 * | the throw in `generateStructure` never taken (the state before this stage) | cases 1, 2, 3, 5 → `the job finished on the headings tree with two windows still to use: expected true to be false`; `the job ended instead of being put down`; `a job the reader stopped was requeued or failed: expected 'done' to be 'cancelled'`; `expected 'done' to be 'error'` |
 * | the walk's hand-back narrowed back to `ran.outcome === "cancelled" && overran()` (src/jobs.ts) | cases 1, 2 → `the job ended instead of being put down: expected true to be false`; case 3 → `expected 'error' to be 'cancelled'` |
 * | `requeues` compared without its default (`undefined < REQUEUE_BUDGET`) | cases 1, 2, 3, 5: the first window is told there is no other |
 * | the window's flag ignored (`opts.window !== undefined`) | case 6 → `expected 'error' to be 'done'` |
 *
 * Cases 4 and 6 stay green under the first row, and that is right: a moved
 * claim is a lost claim however the step ended, and case 6 is the old
 * behaviour. **Not distinguished by any test:** `!stopped` in `runStep`'s
 * `askedForWindow`. Without it a Stop still ends cancelled, because the
 * store's pause answers `cancelled` for a row that carries the flag.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Assets } from "../src/assets.js";
import type { MessagesBody } from "../src/messages-stream.js";
import type { JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { prose } from "./helpers/bounded-tree.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import { pgReady } from "./helpers/pg-ready.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";
import { askedIds, isRootCall, messageOf, ROOT_ANSWER, sectionsAnswer, USAGE } from "./helpers/slice-model.js";

interface Call {
  root: boolean;
  ids: string[];
}
const model = vi.hoisted(() => ({
  calls: [] as { root: boolean; ids: string[] }[],
  respond: (async () => "") as (call: { root: boolean; ids: string[] }) => Promise<string>,
}));

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  const { beginSpend, providerCost, recordSpend } = await import("../src/ai-spend.js");
  return {
    ...real,
    streamMessage: (_task: string, params: MessagesBody) => {
      const call = { root: isRootCall(params), ids: askedIds(params) };
      model.calls.push(call);
      /* What the real gateway does around a call: src/messages-stream.ts § `record`. */
      const callId = beginSpend("structure", "fixture/model");
      const startedAt = Date.now();
      const settle = (outcome: "ok" | "error"): void =>
        recordSpend(
          {
            job: "structure",
            wire: "messages",
            model: "fixture/model",
            answeredBy: null,
            cost: providerCost(null),
            upstreamCostNanos: null,
            providerAccount: "openrouter",
            generationId: null,
            upstream: null,
            credentialFingerprint: null,
            isByok: null,
            inputTokens: outcome === "ok" ? USAGE.input_tokens : null,
            outputTokens: outcome === "ok" ? USAGE.output_tokens : null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            cacheWrite5mTokens: null,
            cacheWrite1hTokens: null,
            reasoningTokens: null,
            webSearches: null,
            serviceTier: null,
            inferenceGeo: null,
            ms: Date.now() - startedAt,
            outcome,
          },
          callId,
        );
      return {
        onText: () => {},
        attempts: () => 1,
        finalMessage: async () => {
          let answer: string;
          try {
            answer = await model.respond(call);
          } catch (err) {
            settle("error");
            throw err;
          }
          settle("ok");
          return messageOf(answer);
        },
      };
    },
  };
});

const { closeDb, getDb } = await import("../src/db/client.js");
const { aiCalls, articleRevisions, articles, checkpoints, jobs: jobsTable } = await import("../src/db/schema.js");
const { loadEnvLocal } = await import("../src/env.js");
const { advanceJobWith, claimSession, enqueue, getJob, REQUEUE_BUDGET } = await import("../src/jobs.js");
const { INTERRUPTED } = await import("../src/messages.js");
const { runAsOwner } = await import("../src/owner.js");
const { readingDifficultyDeps, STEPS } = await import("../src/pipeline.js");
const { pgJobStore } = await import("../src/store/pg-jobs.js");
const { costStore } = await import("../src/store/ai-calls.js");

type AdvanceParts = import("../src/jobs.js").AdvanceParts;
type StepRegistry = import("../src/jobs.js").StepRegistry;
type PipelineStep<N extends StepName> = import("../src/pipeline.js").PipelineStep<N>;

loadEnvLocal();

/* Long, because claiming waits on a contended slot and the article is 3,000 blocks. */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const OWNER_STEM = "0000c5aa-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;
const SLUG_PREFIX = "test-another-window-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;
const SUITE = "tests/job-hands-back-for-another-window.test.ts";

let runLock: HeldRunLock | undefined;

await pgReady({
  suite: SUITE,
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
    "spideryarn.checkpoints",
    "spideryarn.ai_calls",
  ],
});

runLock = await takeRunLockAndSetUp(SUITE, async (lockClient) => {
  await lockClient.query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
  await lockClient.query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("update spideryarn.articles set current_revision_id = null where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("delete from spideryarn.articles where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("delete from spideryarn.ai_calls where owner_id::text like $1", [RUBBLE]);
  await lockClient.query("delete from auth.users where id::text like $1", [RUBBLE]);
  await seedAuthUser(lockClient, { id: OWNER, email: `another-window-${OWNER}@example.invalid` });
});

/* -------------------------------------------------------------- the steps -- */

/** Headingless and past the one-answer ceiling (2,889 blocks), so the slices path runs, in three slices. */
const PARAGRAPHS = 3000;
const EXTRACTED_HTML = Array.from({ length: PARAGRAPHS }, (_, n) => `<p>${prose(n)}.</p>`).join("\n");
const TITLE = "A fixture too long for one answer";

function fakeFetch(): PipelineStep<"fetch"> {
  return {
    name: "fetch",
    label: STEPS.fetch.label,
    produces: ["raw"],
    async run(ctx) {
      const sha = randomUUID().replaceAll("-", "").padEnd(64, "0");
      const url = ctx.url ?? `https://example.com/${ctx.slug}`;
      return {
        parts: {
          raw: {
            kind: "html",
            file: "raw.html",
            origin: "url",
            requestedUrl: url,
            url,
            contentType: "text/html",
            encoding: "utf-8",
            bytes: EXTRACTED_HTML.length,
            sha256: sha,
            storedSha256: sha,
            storedBytes: EXTRACTED_HTML.length,
            fetchedAt: new Date().toISOString(),
          },
        },
        detail: "fetched",
      };
    },
  };
}

function fakeExtract(): PipelineStep<"extract"> {
  return {
    name: "extract",
    label: STEPS.extract.label,
    produces: ["extractedHtml", "meta"],
    async run(ctx) {
      return { parts: { extractedHtml: EXTRACTED_HTML, meta: { slug: ctx.slug, title: TITLE } }, detail: TITLE };
    },
  };
}

function fakeAssets(): PipelineStep<"assets"> {
  return {
    name: "assets",
    label: STEPS.assets.label,
    produces: ["assets"],
    async run() {
      const assets: Assets = {
        version: "assets/2",
        sourceHash: "a fixture with no figures",
        fetchedAt: new Date().toISOString(),
        entries: [],
      };
      return { parts: { assets }, detail: "no figures" };
    },
  };
}

/** The `window` each structure run was handed, and the detail each finished one returned. */
const structureRuns: { window: unknown; detail?: string }[] = [];

function parts(): AdvanceParts {
  const steps: StepRegistry = {
    ...STEPS,
    fetch: fakeFetch(),
    extract: fakeExtract(),
    assets: fakeAssets(),
    structure: {
      ...STEPS.structure,
      async run(ctx, store, saved) {
        const entry: { window: unknown; detail?: string } = { window: ctx.window };
        structureRuns.push(entry);
        const product = await STEPS.structure.run(ctx, store, saved);
        entry.detail = product.detail;
        return product;
      },
    },
  };
  return { power: async () => "standard", session: claimSession, steps };
}

/** One advance that claims, waiting out a contended slot. */
async function advance(id: string) {
  for (let n = 1; n <= 40; n++) {
    const advanced = await advanceJobWith(id, parts());
    if (!advanced?.busy) return advanced;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`job ${id} was never claimable`);
}

/** Advance until the job ends. */
async function drive(id: string) {
  for (let n = 1; n <= 20; n++) {
    const advanced = await advance(id);
    if (advanced?.done) return advanced.job;
  }
  throw new Error(`job ${id} did not finish in 20 claims`);
}

/* ------------------------------------------------------------- the model -- */

const answers = async (call: Call): Promise<string> => (call.root ? ROOT_ANSWER : sectionsAnswer(call.ids));

/**
 * Past the slack a default lease leaves a slice's second ask (370 s: the
 * 700 s step budget, less the 30 s finish reserve, a 240 s slice cap and the
 * 60 s root cap), and short of a whole window.
 */
const JUMP = 400_000;

/**
 * The second slice's call fails once the other two have answered, with the
 * clock moved on so that its second ask no longer fits. `during` runs just
 * before, for the cases where something else happens to the job meanwhile.
 */
function runOutOfTimeOnTheSecondSlice(during: () => Promise<void> = async () => {}): void {
  let slicesStarted = 0;
  let othersAnswered = 0;
  let release = (): void => {};
  const bothAnswered = new Promise<void>((resolve) => (release = resolve));
  model.respond = async (call) => {
    if (call.root) throw new Error("the root was asked for although a slice was missing");
    const mine = slicesStarted++;
    if (mine !== 1) {
      const answer = sectionsAnswer(call.ids);
      if (++othersAnswered === 2) release();
      return answer;
    }
    await bothAnswered;
    /* Let the other two read their answers on the unmoved clock. */
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await during();
    vi.setSystemTime(Date.now() + JUMP);
    throw new Error("the second slice's call did not come back");
  };
}

/* --------------------------------------------------------------- the reads -- */

const db = () => getDb();

async function jobRow(id: string) {
  const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, id)).limit(1);
  if (!row) throw new Error(`no job ${id}`);
  return row;
}

/** What is published for the article: `null` on a first import that has not finished. */
async function published(slug: string): Promise<{ revisionId: string; tree: Tree } | null> {
  const [article] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  const id = article?.currentRevisionId;
  if (!id) return null;
  const [revision] = await db().select().from(articleRevisions).where(eq(articleRevisions.id, id)).limit(1);
  return { revisionId: id, tree: revision?.tree as Tree };
}

const structureStep = (job: { steps: JobStep[] }) => job.steps.find((s) => s.name === "structure");
const ledger = async (jobId: string) => (await costStore.forJob(jobId)).rows;
const slices = () => model.calls.filter((c) => !c.root);
const roots = () => model.calls.filter((c) => c.root);

const freshUrl = () => `https://example.com/another-window/${randomUUID()}`;
const firstImport = (name: string) => enqueue({ slug: `${SLUG_PREFIX}${name}`, url: freshUrl(), pump: false });

/** The job is back in the queue, one requeue spent, and says nothing about a failure. */
function expectHandedBack(advanced: Awaited<ReturnType<typeof advance>>, requeues: number): void {
  expect(advanced?.done, "the job ended instead of being put down").toBe(false);
  expect(advanced?.busy).toBe(false);
  expect(advanced?.job.status).toBe("queued");
  expect(advanced?.job.requeues).toBe(requeues);
  const step = structureStep(advanced!.job);
  expect(step?.status, "a job waiting its turn is showing a failed step").toBe("pending");
  expect(step?.error, "a job waiting its turn is carrying an ending's sentence").toBeUndefined();
  expect(advanced?.job.error).toBeUndefined();
  expect(advanced?.job.failureKind).toBeUndefined();
}

/** The article cases 2 to 6 work over: published with a real tree before any of them runs. */
let shelved: { slug: string };
let articleId: string;

/**
 * A forced `structure` job on the shelved article, with nothing saved for it
 * to start from, and what was published when it was queued.
 */
async function forcedStructureJob() {
  const before = await published(shelved.slug);
  if (!before) throw new Error("the fixture article is not published");
  await db().delete(checkpoints).where(eq(checkpoints.articleId, articleId));
  /* A publication queues the labels job and the modes, and they are ahead in the article's line. */
  await db().delete(jobsTable).where(eq(jobsTable.slug, shelved.slug));
  const job = await enqueue({ slug: shelved.slug, steps: ["structure"], force: ["structure"], pump: false });
  return { job, before };
}

const mine = (name: string, body: () => Promise<void>) => it(name, () => runAsOwner(OWNER, body));

/* ------------------------------------------------------------------ tests -- */

describe("slices out of time, in a job the queue can give another window", () => {
  let vercel: string | undefined;
  const rate = readingDifficultyDeps.rate;
  beforeAll(async () => {
    /* `VERCEL`, so nothing here starts a real pump: tests/reset-and-regenerate.test.ts. */
    vercel = process.env.VERCEL;
    process.env.VERCEL = "1";
    /* The real `blocks` step rates a piece this long with a model of its own. Not here. */
    readingDifficultyDeps.rate = async () => ({ kind: "unrated", why: "refused" });

    /* The article cases 2 to 6 work over: imported whole, in one window, with nothing going wrong. */
    await runAsOwner(OWNER, async () => {
      model.respond = answers;
      const job = await drive((await firstImport("shelved")).id);
      expect(job.status, job.error).toBe("done");
      const now = await published(job.slug);
      expect(now?.tree.provisional, "the fixture article was not published with a real tree").toBeUndefined();
      shelved = { slug: job.slug };
      const [article] = await db().select().from(articles).where(eq(articles.slug, job.slug)).limit(1);
      articleId = article!.id;
    });
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    model.calls.length = 0;
    model.respond = answers;
    structureRuns.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
    readingDifficultyDeps.rate = rate;
    await cleanUpThenRelease(
      async () => {
        const database = getDb();
        await database.delete(jobsTable).where(inArray(jobsTable.ownerId, [OWNER]));
        await database.delete(aiCalls).where(eq(aiCalls.ownerId, OWNER));
        const ours = await database.select({ id: articles.id }).from(articles).where(eq(articles.ownerId, OWNER));
        for (const { id } of ours) {
          await database.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
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

  mine("a first import is put down with its answers and its draft kept, and the next window finishes from them", async () => {
    const job = await firstImport("first");
    expect(job.requeues, "the fixture did not start with `requeues` absent").toBeUndefined();
    runOutOfTimeOnTheSecondSlice();

    const first = await advance(job.id);
    expect(structureRuns.map((r) => r.window)).toEqual([{ number: 1, anotherAvailable: true }]);
    expect(
      structureRuns[0]!.detail?.includes("from its headings") ?? false,
      "the job finished on the headings tree with two windows still to use",
    ).toBe(false);
    expectHandedBack(first, 1);
    expect(slices(), "the fixture did not buy three slices").toHaveLength(3);
    expect(roots()).toHaveLength(0);
    const missing = slices()[1]!.ids;

    /* What was persisted, not only what this call answered. */
    const stored = await getJob(job.id);
    expect(stored?.status).toBe("queued");
    expect(stored?.requeues).toBe(1);
    expect(structureStep(stored!)?.status).toBe("pending");
    expect(structureStep(stored!)?.error).toBeUndefined();
    expect(stored?.steps.filter((s) => s.status === "done").map((s) => s.name)).toEqual(["fetch", "extract", "blocks"]);
    const paused = await jobRow(job.id);
    expect(paused.draftRevisionId, "the pause threw the draft away").not.toBeNull();
    expect(await published(job.slug), "a first import published something while it was put down").toBeNull();

    /* The calls made are in the ledger, the failed one included. */
    const spent = await ledger(job.id);
    expect(spent, "the window's calls did not reach the ledger").toHaveLength(3);
    expect(spent.map((r) => r.stepName)).toEqual(["structure", "structure", "structure"]);
    expect(spent.map((r) => r.outcome).sort()).toEqual(["error", "ok", "ok"]);

    /* The second window. */
    model.calls.length = 0;
    model.respond = answers;
    const second = await advance(job.id);
    expect(second?.done, second?.job.error).toBe(true);
    expect(second?.job.status, second?.job.error).toBe("done");
    expect(structureRuns.map((r) => r.window)).toEqual([
      { number: 1, anotherAvailable: true },
      { number: 2, anotherAvailable: true },
    ]);
    expect(structureStep(second!.job)?.status, "the second window skipped the step as already done").toBe("done");
    expect(slices().map((c) => c.ids), "a slice already bought was bought again").toEqual([missing]);
    expect(roots()).toHaveLength(1);
    expect(structureRuns[1]!.detail).toContain("read in 3 parts");
    expect(await ledger(job.id)).toHaveLength(5);

    /* The draft the first window wrote into is the revision that was published. */
    const now = await published(job.slug);
    expect(now?.revisionId, "the second window worked in a different draft").toBe(paused.draftRevisionId);
    expect(now?.tree.provisional).toBeUndefined();
    expect(now?.tree.nodes[now.tree.rootId]?.gist).toBe(JSON.parse(ROOT_ANSWER).gist);
  });

  /* ------------------------------------------------------------------ 2 -- */

  mine("over an article already published with a real tree, the published tree is untouched while the job is put down", async () => {
    const { job, before } = await forcedStructureJob();
    expect(before.tree.provisional, "the fixture article does not have a real tree").toBeUndefined();
    runOutOfTimeOnTheSecondSlice();

    const first = await advance(job.id);
    expectHandedBack(first, 1);
    const paused = await jobRow(job.id);
    expect(paused.draftRevisionId).not.toBeNull();
    expect(paused.draftRevisionId).not.toBe(before.revisionId);
    expect(await published(job.slug), "the hand-back changed what the reader is looking at").toEqual(before);
    expect(await ledger(job.id)).toHaveLength(3);
    const missing = slices()[1]!.ids;

    model.calls.length = 0;
    model.respond = answers;
    const done = await advance(job.id);
    expect(done?.job.status, done?.job.error).toBe("done");
    /* The copied draft holds the published revision's finished `structure` run; it must not count as done. */
    expect(structureStep(done!.job)?.status, "the second window skipped the step as already done").toBe("done");
    expect(slices().map((c) => c.ids)).toEqual([missing]);
    const now = await published(job.slug);
    expect(now?.revisionId).toBe(paused.draftRevisionId);
    expect(now?.tree.provisional).toBeUndefined();
  });

  /* ------------------------------------------------------------------ 3 -- */

  mine("a Stop pressed while the slices ran is a cancellation, not another window", async () => {
    const { job, before } = await forcedStructureJob();
    /* The flag alone, as a Stop on another instance leaves it: no local abort. */
    runOutOfTimeOnTheSecondSlice(async () => {
      await pgJobStore.requestCancel(job.id, OWNER);
    });

    const ended = await advance(job.id);
    expect(ended?.done).toBe(true);
    expect(ended?.job.status, "a job the reader stopped was requeued or failed").toBe("cancelled");
    expect(ended?.job.requeues ?? 0).toBe(0);
    expect(structureStep(ended!.job)?.error).not.toContain("jb-gone");
    expect(await published(job.slug)).toEqual(before);
  });

  /* ------------------------------------------------------------------ 4 -- */

  mine("a claim that moved while the slices ran writes nothing: the lost-claim path", async () => {
    const { job, before } = await forcedStructureJob();
    runOutOfTimeOnTheSecondSlice(async () => {
      await db().update(jobsTable).set({ attemptId: randomUUID() }).where(eq(jobsTable.id, job.id));
    });

    /* Not `advance`: `busy` is the answer here, and that helper waits it out. */
    const lost = await advanceJobWith(job.id, parts());
    expect(structureRuns, "the claim was never taken, so nothing was lost").toHaveLength(1);
    expect(lost, "a claimant that no longer owns the job reported an ending").toMatchObject({
      busy: true,
      done: false,
      ran: null,
    });
    const row = await jobRow(job.id);
    expect(row.status, "the former claimant moved a row it no longer owns").toBe("running");
    expect(row.requeues).toBe(0);
    expect(await published(job.slug)).toEqual(before);
    /* Nobody holds that claim; take the row away so the next case can queue its own. */
    await db().delete(jobsTable).where(eq(jobsTable.id, job.id));
  });

  /* ------------------------------------------------------------------ 5 -- */

  mine("a budget spent between the step starting and the pause ends as an interruption, not on the headings tree", async () => {
    const { job, before } = await forcedStructureJob();
    runOutOfTimeOnTheSecondSlice(async () => {
      await db().update(jobsTable).set({ requeues: REQUEUE_BUDGET }).where(eq(jobsTable.id, job.id));
    });

    const ended = await advance(job.id);
    expect(structureRuns.map((r) => r.window)).toEqual([{ number: 1, anotherAvailable: true }]);
    expect(ended?.done).toBe(true);
    expect(ended?.job.status).toBe("error");
    expect(ended?.job.error).toBe(INTERRUPTED.message);
    expect(ended?.job.failureKind).toBe(INTERRUPTED.kind);
    expect(structureStep(ended!.job)?.error).toBe(INTERRUPTED.message);
    expect(await published(job.slug), "a refused pause published something").toEqual(before);
  });

  /* ------------------------------------------------------------------ 6 -- */

  mine("with the budget already spent, the step finishes on the headings tree, as it did", async () => {
    const { job } = await forcedStructureJob();
    await db().update(jobsTable).set({ requeues: REQUEUE_BUDGET }).where(eq(jobsTable.id, job.id));
    runOutOfTimeOnTheSecondSlice();

    const ended = await advance(job.id);
    expect(structureRuns.map((r) => r.window)).toEqual([{ number: REQUEUE_BUDGET + 1, anotherAvailable: false }]);
    expect(ended?.done).toBe(true);
    expect(ended?.job.status, ended?.job.error).toBe("done");
    expect(ended?.job.requeues).toBe(REQUEUE_BUDGET);
    expect(structureRuns[0]!.detail).toContain("from its headings (too long for one answer; there was not time to read it in parts)");
    expect((await published(job.slug))?.tree.provisional).toBe("headings");
  });
});
