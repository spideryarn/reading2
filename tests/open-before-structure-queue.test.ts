/**
 * **An import that asked to open early publishes before any model is asked,
 * and a second job then builds the structure** — through the real `enqueue`,
 * the real claim, the real `structure` step and the real publication.
 *
 * Stage 1 of
 * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md.
 * tests/structure-step-headings-first.test.ts holds the step on its own and
 * tests/publication-of-an-awaiting-tree.test.ts the publication on its own.
 * This file is the pieces joined, which is where the earlier attempts at this
 * feature failed: the second job skipped, and the real tree never came.
 *
 * ## What is real and what is not
 *
 * `fetch`, `extract` and `assets` are fakes (the network, a model on a PDF,
 * the publisher's images). `blocks` and **`structure` are the real steps**; the
 * model under `structure` is a counted fake at `streamMessage`, so *no model
 * call* is a number and not an inference. `enqueue`, `retryJob`,
 * `advanceJobWith`, `claimSession` and `publishRevisionIn` are production's.
 *
 * ## Mutations watched red, 2026-10-05
 *
 * | mutation | red |
 * |---|---|
 * | `STEPS.structure.isDone` returns `true` (src/pipeline.ts) | case 1 → `the job that builds the structure skipped it: expected 'skipped' to be 'done'` |
 * | the gate's throw removed from `runStep` (src/jobs.ts) | case 6 → `a step that reads the structure ran on the stand-in` |
 * | `headingsFirst` not carried by `retryJob` | case 4 → `the retry lost the mark` |
 * | `allocation.kind === "minted"` dropped from `enqueue`'s mark | case 3 → `a job on an article already on the shelf was marked` |
 *
 * All four were in place for one run: 5 of 6 red (case 5 with the first, since
 * a step that counts as done is not walked again), case 2 green.
 */
import { createHash, randomUUID } from "node:crypto";

import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Assets } from "../src/assets.js";
import type { JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import { pgReady } from "./helpers/pg-ready.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/** What the structure call "returns". A root alone is a sound answer at any size. */
const MODEL_ANSWER = JSON.stringify({
  root: { title: "A fixture article", gist: "A fixture that says things.", question: "What follows?" },
});
const model = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => {
      model.calls += 1;
      return {
        onText: () => {},
        finalMessage: async () => ({
          content: [{ type: "text", text: MODEL_ANSWER }],
          stop_reason: "end_turn",
          usage: { input_tokens: 7, output_tokens: 11 },
        }),
      };
    },
  };
});

const { closeDb, getDb } = await import("../src/db/client.js");
const { articleRevisions, articles, jobs: jobsTable, readerProfiles } = await import("../src/db/schema.js");
const { loadEnvLocal } = await import("../src/env.js");
const { advanceJobWith, claimSession, enqueue, retryJob, DEADLINE_MARGIN_MS } = await import(
  "../src/jobs.js"
);
const { STRUCTURE_NOT_BUILT } = await import("../src/messages.js");
const { runAsOwner } = await import("../src/owner.js");
const { DEFAULT_INGEST_STEPS, STEPS } = await import("../src/pipeline.js");
const { awaitingStructure } = await import("../src/types.js");

type AdvanceParts = import("../src/jobs.js").AdvanceParts;
type StepRegistry = import("../src/jobs.js").StepRegistry;
type PipelineStep<N extends StepName> = import("../src/pipeline.js").PipelineStep<N>;

loadEnvLocal();

/* Long, because claiming waits on a contended slot rather than failing on it. */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const OWNER_STEM = "0000c93a-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-open-before-structure-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

/** The main-mode jobs, written out again so the test does not read the code's list. */
const MODES: StepName[][] = [
  ["tweets"],
  ["glossary"],
  ["quotes"],
  ["ideas"],
  ["simple"],
  ["crossrefs"],
  ["quotes", "ideas", "skim"],
];

let runLock: HeldRunLock | undefined;

await pgReady({
  suite: "tests/open-before-structure-queue.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
    "spideryarn.reader_profiles",
  ],
});

runLock = await takeRunLockAndSetUp("tests/open-before-structure-queue.test.ts", async (lockClient) => {
  await lockClient.query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
  await lockClient.query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query(
    "update spideryarn.articles set current_revision_id = null where slug like $1",
    [SLUG_RUBBLE],
  );
  await lockClient.query("delete from spideryarn.articles where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("delete from spideryarn.reader_profiles where owner_id::text like $1", [RUBBLE]);
  await lockClient.query("delete from auth.users where id::text like $1", [RUBBLE]);
  await seedAuthUser(lockClient, { id: OWNER, email: `open-before-structure-${OWNER}@example.invalid` });
});

/* -------------------------------------------------------------- the steps -- */

/** A headed article with eight paragraphs: well over the bounded builder's four-block minimum. */
const EXTRACTED_HTML = [
  "<h1>A fixture article</h1>",
  "<h2>The first part</h2>",
  ...[1, 2, 3, 4].map(
    (n) => `<p>Paragraph ${n} of the first part, which says something at enough length to count as prose.</p>`,
  ),
  "<h2>The second part</h2>",
  ...[5, 6, 7, 8].map(
    (n) => `<p>Paragraph ${n} of the second part, which also says something at enough length to count.</p>`,
  ),
].join("\n");

interface Calls {
  fetch: number;
  extract: number;
  glossary: number;
  structure: number;
}
const calls: Calls = { fetch: 0, extract: 0, glossary: 0, structure: 0 };

/** The real `structure` step, counted. */
function countedStructure(): PipelineStep<"structure"> {
  return {
    ...STEPS.structure,
    run(ctx, store, checkpoints) {
      calls.structure += 1;
      return STEPS.structure.run(ctx, store, checkpoints);
    },
  };
}

/** Stage 1 without the network: a manifest naming a document nobody stored. */
function fakeFetch(): PipelineStep<"fetch"> {
  return {
    name: "fetch",
    label: STEPS.fetch.label,
    produces: ["raw"],
    async run(ctx) {
      calls.fetch += 1;
      const sha = createHash("sha256").update(`${ctx.slug}-${randomUUID()}`).digest("hex");
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

/** Stage 2 without Readability's guesswork: the HTML above, and a title. */
function fakeExtract(fail: boolean): PipelineStep<"extract"> {
  return {
    name: "extract",
    label: STEPS.extract.label,
    produces: ["extractedHtml", "meta"],
    async run(ctx) {
      calls.extract += 1;
      if (fail) throw new Error("the fixture's extract gave up on purpose");
      return {
        parts: {
          extractedHtml: EXTRACTED_HTML,
          meta: { slug: ctx.slug, title: "A fixture article" },
        },
        detail: "A fixture article",
      };
    },
  };
}

/** No pictures in the fixture, and no publisher to fetch them from. */
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

/** A step that reads the structure. It must never be reached on a stand-in tree. */
function tripwireGlossary(): PipelineStep<"glossary"> {
  return {
    ...STEPS.glossary,
    async run() {
      calls.glossary += 1;
      throw new Error("a step that reads the structure ran on the stand-in");
    },
  };
}

function partsWith(opts: { failExtract?: boolean; leaseMs?: number } = {}): AdvanceParts {
  const steps: StepRegistry = {
    ...STEPS,
    fetch: fakeFetch(),
    extract: fakeExtract(opts.failExtract === true),
    structure: countedStructure(),
    assets: fakeAssets(),
    glossary: tripwireGlossary(),
  };
  return {
    power: async () => "standard",
    session: claimSession,
    steps,
    ...(opts.leaseMs !== undefined ? { leaseMs: opts.leaseMs } : {}),
  };
}

/** Drive one job to its end, waiting out a contended slot. Counts the claims it took. */
async function drive(id: string, parts: AdvanceParts = partsWith()) {
  let claims = 0;
  for (let n = 1; n <= 120; n++) {
    const advanced = await advanceJobWith(id, parts);
    if (advanced && !advanced.busy) claims += 1;
    if (advanced?.done) return { job: advanced.job, claims };
    if (advanced?.busy) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`job ${id} did not finish in 120 advances`);
}

/* --------------------------------------------------------------- the reads -- */

const db = () => getDb();

async function onTheShelf(slug: string): Promise<{ revisionId: string; tree: Tree }> {
  const [article] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  const id = article?.currentRevisionId;
  if (!id) throw new Error(`${slug} is not on the shelf`);
  const [revision] = await db().select().from(articleRevisions).where(eq(articleRevisions.id, id)).limit(1);
  return { revisionId: id, tree: revision?.tree as Tree };
}

/** The queued jobs on the article, oldest first: the order they are claimed in. */
async function queuedOn(slug: string) {
  const rows = await db()
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.slug, slug))
    .orderBy(asc(jobsTable.createdAt), asc(jobsTable.id));
  return rows.filter((row) => row.status === "queued");
}
const names = (row: { steps: JobStep[] }) => row.steps.map((s) => s.name);
const structureStep = (job: { steps: JobStep[] }) => job.steps.find((s) => s.name === "structure");

/** A new address each time, so no case's paste is another's article. */
const freshUrl = () => `https://example.com/open-before-structure/${randomUUID()}`;

/** A first import that asked to open early, queued and not yet driven. */
const addOpeningEarly = (name: string, url = freshUrl()) =>
  enqueue({ slug: `${SLUG_PREFIX}${name}`, url, openEarly: true, pump: false });

/** The structure job an awaiting publication queued. */
async function structureJobOn(slug: string) {
  const queued = (await queuedOn(slug)).filter((row) => names(row).join() === "structure");
  expect(queued, "the awaiting publication did not queue exactly one structure job").toHaveLength(1);
  return queued[0]!;
}

const mine = (name: string, body: () => Promise<void>) => it(name, () => runAsOwner(OWNER, body));

/* ------------------------------------------------------------------ tests -- */

describe("an import that opens before its structure is built", () => {
  /* `VERCEL`, so `retryJob` (which has no `pump` option) does not start a real
     `fetch`. The same arrangement as tests/reset-and-regenerate.test.ts. */
  let vercel: string | undefined;
  beforeAll(() => {
    vercel = process.env.VERCEL;
    process.env.VERCEL = "1";
  });
  beforeEach(() => {
    model.calls = 0;
    calls.fetch = calls.extract = calls.glossary = calls.structure = 0;
  });

  afterAll(async () => {
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
    await cleanUpThenRelease(
      async () => {
        const database = getDb();
        await database.delete(jobsTable).where(inArray(jobsTable.ownerId, [OWNER]));
        const ours = await database.select({ id: articles.id }).from(articles).where(eq(articles.ownerId, OWNER));
        for (const { id } of ours) {
          await database.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
          await database.delete(articles).where(eq(articles.id, id));
        }
        await database.delete(readerProfiles).where(eq(readerProfiles.ownerId, OWNER));
        await closeDb();
        await runLock?.client.query("delete from auth.users where id = $1", [OWNER]);
      },
      async () => {
        await runLock?.release();
      },
    );
  });

  /* ------------------------------------------------------------------ 1 -- */

  mine("publishes awaiting with no model call, then the successor builds the real tree", async () => {
    const job = await addOpeningEarly("end-to-end");
    expect(names(job)).toEqual(DEFAULT_INGEST_STEPS);
    expect(structureStep(job)?.headingsFirst, "the import's structure step was not marked").toBe(true);

    const imported = await drive(job.id);
    expect(imported.job.status, imported.job.error).toBe("done");
    expect(model.calls, "the import waited on a model before it published").toBe(0);

    const first = await onTheShelf(job.slug);
    expect(awaitingStructure(first.tree), "the import did not publish the stand-in").toBe(true);
    expect((await queuedOn(job.slug)).map(names), "more than the structure job was queued").toEqual([
      ["structure"],
    ]);

    /* The job that builds the real tree. Its draft is a copy of the published
       revision: the stand-in tree, and the import's finished `structure` run. */
    const successor = await structureJobOn(job.slug);
    const built = await drive(successor.id);
    expect(built.job.status, built.job.error).toBe("done");
    expect(
      structureStep(built.job)?.status,
      "the job that builds the structure skipped it",
    ).toBe("done");
    expect(model.calls, "the structure job did not ask the model").toBe(1);

    const second = await onTheShelf(job.slug);
    expect(second.revisionId).not.toBe(first.revisionId);
    expect(awaitingStructure(second.tree), "the article is still showing the stand-in").toBe(false);
    expect(second.tree.provisional).toBeUndefined();
    expect(second.tree.nodes[second.tree.rootId]?.gist).toBe("A fixture that says things.");

    /* And only now the labels, and the modes that read the tree. */
    expect((await queuedOn(job.slug)).map(names)).toEqual([["labels"], ...MODES]);
  });

  /* ------------------------------------------------------------------ 2 -- */

  mine("an import that did not ask is one job, as it was", async () => {
    const job = await enqueue({ slug: `${SLUG_PREFIX}plain`, url: freshUrl(), pump: false });
    expect(structureStep(job)?.headingsFirst).toBeUndefined();

    const imported = await drive(job.id);
    expect(imported.job.status, imported.job.error).toBe("done");
    expect(model.calls).toBe(1);
    expect(awaitingStructure((await onTheShelf(job.slug)).tree)).toBe(false);
    expect((await queuedOn(job.slug)).map(names)).toEqual([["labels"], ...MODES]);
  });

  /* ------------------------------------------------------------------ 3 -- */

  mine("openEarly marks nothing on an article already on the shelf, or on a job that reads the tree", async () => {
    const first = await enqueue({ slug: `${SLUG_PREFIX}adopted`, url: freshUrl(), pump: false });
    await drive(first.id);

    /* Named by its slug: an adoption from the shelf, which mints nothing. */
    const rebuild = await enqueue({
      slug: first.slug,
      steps: [...DEFAULT_INGEST_STEPS],
      force: ["extract"],
      openEarly: true,
      pump: false,
    });
    expect(rebuild.slug).toBe(first.slug);
    expect(
      structureStep(rebuild)?.headingsFirst,
      "a job on an article already on the shelf was marked",
    ).toBeUndefined();

    /* A new address, but a job that goes on to read the structure itself. */
    const withMode = await enqueue({
      slug: `${SLUG_PREFIX}with-mode`,
      url: freshUrl(),
      steps: [...DEFAULT_INGEST_STEPS, "glossary"],
      openEarly: true,
      pump: false,
    });
    expect(
      structureStep(withMode)?.headingsFirst,
      "a job that reads the structure was told to write a stand-in first",
    ).toBeUndefined();
  });

  /* ------------------------------------------------------------------ 4 -- */

  mine("openEarly does not mark a different job adopting a live import's queue slot", async () => {
    const first = await addOpeningEarly("live-adoption");
    expect(structureStep(first)?.headingsFirst).toBe(true);

    // Different forced work must create a second job, rather than return the
    // first one. Nothing has published: allocation must adopt from the queue.
    const adopted = await enqueue({
      slug: first.slug,
      url: first.url!,
      steps: [...DEFAULT_INGEST_STEPS],
      force: ["extract"],
      openEarly: true,
      pump: false,
    });

    expect(adopted.id, "the test joined identical work instead of adopting its slot").not.toBe(first.id);
    expect(adopted.slug, "the test minted another article instead of adopting its slot").toBe(first.slug);
    expect(structureStep(adopted)?.headingsFirst, "a live queue adoption kept the first-import mark").toBeUndefined();
    const [article] = await db().select().from(articles).where(eq(articles.slug, first.slug));
    expect(article?.currentRevisionId ?? null, "the adoption test already had a published article").toBeNull();
  });

  mine("a retry of a failed first import keeps the mark", async () => {
    const job = await addOpeningEarly("retried");
    const failed = await drive(job.id, partsWith({ failExtract: true }));
    expect(failed.job.status).toBe("error");

    const retry = await retryJob(failed.job.id);
    expect(retry?.slug, "the retry is a different article").toBe(job.slug);
    expect(structureStep(retry!)?.headingsFirst, "the retry lost the mark").toBe(true);

    const imported = await drive(retry!.id);
    expect(imported.job.status, imported.job.error).toBe("done");
    expect(model.calls).toBe(0);
    expect(awaitingStructure((await onTheShelf(job.slug)).tree)).toBe(true);
    await structureJobOn(job.slug);
  });

  /* ------------------------------------------------------------------ 5 -- */

  /**
   * A marked, unpublished import retains its completed stand-in when resumed.
   * Otherwise a short claim rebuilds it and hands back before assets forever.
   */
  mine("a handed-back import finishes without rebuilding its stand-in", async () => {
    const job = await addOpeningEarly("handed-back");

    /* 4s of deadline after the margin and every next step wants 5s or more, so
       each of these claims runs one step and puts the job down. Stop once the
       one that ran `structure` has handed back.

       Resume on that same short window: assets must be the first unfinished
       step instead of repeatedly rewriting the unpublished stand-in. */
    const short = partsWith({ leaseMs: DEADLINE_MARGIN_MS + 4_000 });
    for (let n = 1; ; n++) {
      if (n > 60) throw new Error("the short claims never reached structure");
      const advanced = await advanceJobWith(job.id, short);
      if (advanced?.busy) await new Promise((resolve) => setTimeout(resolve, 300));
      if (advanced?.ran !== "structure") continue;
      expect(advanced.done, "the job ended instead of being handed back").toBe(false);
      break;
    }
    expect(calls.structure).toBe(1);

    const imported = await drive(job.id, short);
    expect(calls.structure, "the resumed import rebuilt its completed stand-in").toBe(1);
    expect(imported.job.status, imported.job.error).toBe("done");
    expect(model.calls).toBe(0);
    expect(awaitingStructure((await onTheShelf(job.slug)).tree)).toBe(true);
    expect((await queuedOn(job.slug)).map(names)).toEqual([["structure"]]);
  });

  /* ------------------------------------------------------------------ 6 -- */

  mine("a mode queued before the structure successor is refused instead of reading the stand-in", async () => {
    const job = await addOpeningEarly("earlier-mode");
    const earlierMode = await enqueue({
      slug: job.slug,
      url: job.url!,
      steps: ["glossary"],
      pump: false,
    });
    expect(earlierMode.slug).toBe(job.slug);

    await drive(job.id);
    const successor = await structureJobOn(job.slug);
    const ordered = await queuedOn(job.slug);
    expect(ordered.map((row) => row.id), "the mode did not precede the successor in the actual queue").toEqual([
      earlierMode.id,
      successor.id,
    ]);

    const refused = await drive(earlierMode.id);
    expect(refused.job.failureKind).toBe("blocked");
    expect(refused.job.error).toBe(STRUCTURE_NOT_BUILT.message);
    expect(calls.glossary, "the earlier mode read the stand-in instead of being refused").toBe(0);
    expect((await queuedOn(job.slug)).map((row) => row.id)).toEqual([successor.id]);
  });

  /**
   * The structure job failed, or never ran, and something that reads the tree
   * is asked for. It normally waits behind the structure job; with that job
   * gone it reaches the runner, and is refused there.
   */
  mine("a step that reads the structure is refused on the stand-in, and assets is not", async () => {
    const job = await addOpeningEarly("gated");
    await drive(job.id);
    const successor = await structureJobOn(job.slug);
    /* As if it had failed: off the line, the stand-in still published. */
    await db().update(jobsTable).set({ status: "error" }).where(eq(jobsTable.id, successor.id));

    const glossary = await enqueue({ slug: job.slug, steps: ["glossary"], pump: false });
    const refused = await drive(glossary.id);

    expect(calls.glossary, "a step that reads the structure ran on the stand-in").toBe(0);
    expect(refused.job.status).toBe("error");
    expect(refused.job.failureKind, "the refusal offers a Retry that cannot work").toBe("blocked");
    expect(refused.job.error).toBe(STRUCTURE_NOT_BUILT.message);
    expect(refused.job.steps[0]?.error).toBe(STRUCTURE_NOT_BUILT.message);
    /* The sentence has to carry the way out, since `blocked` offers no button. */
    expect(STRUCTURE_NOT_BUILT.message).toMatch(/Open Structure and build it/);

    /* `assets` reads the blocks alone, and runs. Its publication still carries
       the stand-in, so it asks for the structure job again. */
    const assets = await enqueue({ slug: job.slug, steps: ["assets"], force: ["assets"], pump: false });
    const ran = await drive(assets.id);
    expect(ran.job.status, ran.job.error).toBe("done");
    expect(ran.job.steps[0]?.status).toBe("done");
    expect(awaitingStructure((await onTheShelf(job.slug)).tree)).toBe(true);
    expect((await queuedOn(job.slug)).map(names)).toEqual([["structure"]]);
  });
});
