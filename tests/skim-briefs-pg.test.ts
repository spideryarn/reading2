/**
 * **Several Skim briefs per article** — the store, the routes and the job, on
 * Postgres, with the model faked at `streamMessage`.
 * docs/plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md
 * (report `spya-xyje0z`), stage 2.
 *
 * 1. **The store**: a round trip through the routes, the twelve-per-article
 *    limit, an idempotent create, and an edit that keeps the route.
 * 2. **Owner-only**: a stranger's article and a brief on another article are
 *    404s on every route.
 * 3. **A brief's job** writes the brief's row and leaves
 *    `article_revisions.skim` exactly as it was, plans from the profile with the
 *    brief in the purpose's place, and leaves a cost row for `skim` on the job.
 * 4. **The queue**: one brief pressed twice is one job, two briefs are two, and
 *    the default is a third.
 * 5. **A brief deleted mid-run** keeps nothing, and the job still ends done.
 * 6. **Freshness**: a changed sentence is a changed profile; changed Quotes are
 *    stale; and a second run over a current route is skipped, not bought.
 *
 * The model is a fake that answers a valid route over the offered quotes and
 * reports each call to the real spend collector, as the gateway does
 * (tests/job-hands-back-for-another-window.test.ts has the pattern).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { MessagesBody } from "../src/messages-stream.js";
import type { Job, Quotes, Skim, SkimBriefSummary, SkimResponse } from "../src/types.js";

const model = vi.hoisted(() => ({
  prompts: [] as string[],
  /** Runs inside the model call, before it answers — for the deleted-mid-run case. */
  during: (async () => {}) as () => Promise<void>,
  answer: "",
}));

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  const { beginSpend, providerCost, recordSpend } = await import("../src/ai-spend.js");
  return {
    ...real,
    streamMessage: (task: string, params: MessagesBody) => {
      model.prompts.push(JSON.stringify(params.messages));
      const callId = beginSpend(task as Parameters<typeof beginSpend>[0], "fixture/model");
      return {
        onText: () => {},
        attempts: () => 1,
        aborted: () => false,
        finalMessage: async () => {
          await model.during();
          recordSpend(
            {
              job: task as Parameters<typeof beginSpend>[0],
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
              inputTokens: 1,
              outputTokens: 1,
              cacheReadTokens: null,
              cacheWriteTokens: null,
              cacheWrite5mTokens: null,
              cacheWrite1hTokens: null,
              reasoningTokens: null,
              webSearches: null,
              serviceTier: null,
              inferenceGeo: null,
              ms: 1,
              outcome: "ok",
            },
            callId,
          );
          return {
            id: "msg_stub",
            type: "message",
            role: "assistant",
            model: "stub",
            content: [{ type: "text", text: model.answer, citations: null }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      };
    },
  };
});

const { closeDb, getDb } = await import("../src/db/client.js");
const { aiCalls, articleRevisions, articles, jobs: jobsTable, skimBriefs } = await import("../src/db/schema.js");
const { loadEnvLocal } = await import("../src/env.js");
const { advanceJobWith, claimSession, enqueue } = await import("../src/jobs.js");
const { EVAL_OWNER_ID, runAsOwner } = await import("../src/owner.js");
const { STEPS } = await import("../src/pipeline.js");
const { hashProfile, renderProfile } = await import("../src/profile.js");
const { readerStore } = await import("../src/store/index.js");
const { parseJobRequest } = await import("../src/routes.js");
const { MAX_PURPOSE_CHARS, SKIM_BRIEFS_MAX } = await import("../src/types.js");
const { acceptAny, AUTHED_HEADERS, TEST_OWNER } = await import("./helpers/authed.js");
const { pgReady } = await import("./helpers/pg-ready.js");
const { scratchArticleInPg } = await import("./helpers/scratch-article.js");
const { cleanUpThenRelease, takeRunLockAndSetUp } = await import("./helpers/lock-lifecycle.js");

type ScratchArticle = import("./helpers/scratch-article.js").ScratchArticle;
type HeldRunLock = import("./helpers/run-lock.js").HeldRunLock;

loadEnvLocal();
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const SUITE = "tests/skim-briefs-pg.test.ts";
const SLUG = "test-skim-briefs";
const OTHER = "test-skim-briefs-other";
const STRANGERS = "test-skim-briefs-strangers";

await pgReady({
  suite: SUITE,
  tables: [
    "spideryarn.skim_briefs",
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.ai_calls",
  ],
  columns: [{ table: "spideryarn.jobs", column: "skim_brief" }],
});

const { handleApi } = await import("../src/routes.js");

let runLock: HeldRunLock | undefined;
let article: ScratchArticle | undefined;
let other: ScratchArticle | undefined;
let strangers: ScratchArticle | undefined;
let quoteIds: string[] = [];
/** The default route as the test leaves it, compared after every brief job. */
let defaultRoute: Skim | null = null;

const BRIEF_A = "spya-sba2ca";
const BRIEF_B = "spya-sbb2cb";
const BRIEF_GONE = "spya-sbg2cg";

async function revisionOf(which: ScratchArticle | undefined): Promise<string> {
  const [row] = await getDb()
    .select({ revisionId: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, which?.articleId ?? ""));
  if (!row?.revisionId) throw new Error(`${which?.slug} has no current revision`);
  return row.revisionId;
}

async function revisionSkim(which: ScratchArticle | undefined): Promise<Skim | null> {
  const [row] = await getDb()
    .select({ skim: articleRevisions.skim })
    .from(articleRevisions)
    .where(eq(articleRevisions.id, await revisionOf(which)));
  return row?.skim ?? null;
}

async function briefRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(skimBriefs)
    .where(and(eq(skimBriefs.articleId, article?.articleId ?? ""), eq(skimBriefs.id, id)));
  return row;
}

/** Quotes on the scratch article's first three body paragraphs, so the step has something to plan over. */
async function giveQuotes(which: ScratchArticle, n = 3): Promise<string[]> {
  const body = which.blocks.filter((b) => b.kind === "text" && b.text.length > 80).slice(5, 5 + n);
  const ids = body.map((_, i) => `spya-sbq${"abcdefgh"[i]}2c`);
  const quotes: Quotes = {
    version: "quotes/x",
    generator: "fixture",
    slug: which.slug,
    sourceHash: "fixture",
    quotes: body.map((b, i) => ({
      id: ids[i] as string,
      blockId: b.id,
      text: b.text.slice(0, 60),
      importance: 0.9 - i * 0.1,
    })),
    discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
    generatedAt: "",
    elapsedMs: 0,
  } as unknown as Quotes;
  await getDb().update(articleRevisions).set({ quotes, ideas: null }).where(eq(articleRevisions.id, await revisionOf(which)));
  return ids;
}

function routeAnswer(ids: readonly string[]): string {
  return JSON.stringify({
    stops: ids.map((quote, i) => ({ quote, depth: i + 1, cue: "Look for what this passage does." })),
    figures: [],
    intros: { gist: null, more: null, most: null },
  });
}

beforeAll(async () => {
  runLock = await takeRunLockAndSetUp(SUITE, async (client) => {
    await client.query("delete from spideryarn.jobs where slug = any($1)", [[SLUG, OTHER]]);
  });
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  other = await scratchArticleInPg(OTHER, { ownerId: TEST_OWNER });
  strangers = await scratchArticleInPg(STRANGERS, { ownerId: EVAL_OWNER_ID });
  quoteIds = await giveQuotes(article);
  defaultRoute = await revisionSkim(article);
  model.answer = routeAnswer(quoteIds);
});

afterAll(async () => {
  await cleanUpThenRelease(
    async () => {
      await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
      await getDb().delete(jobsTable).where(eq(jobsTable.slug, OTHER));
      await getDb().delete(aiCalls).where(eq(aiCalls.articleSlug, SLUG));
      await article?.remove();
      await other?.remove();
      await strangers?.remove();
    },
    async () => {
      await runLock?.release();
      await closeDb();
    },
  );
});

async function request(method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* chunks;
    })(),
    { method, url, headers: { ...AUTHED_HEADERS, "content-type": "application/json" } },
  ) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(s: number) {
      (this as { statusCode: number }).statusCode = s;
    },
    flushHeaders() {},
    on() {},
    write(piece: string) {
      written += piece;
      return true;
    },
    end(piece?: string) {
      if (piece) written += piece;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return { status: (res as unknown as { statusCode: number }).statusCode, body: written ? JSON.parse(written) : null };
}

const create = (slug: string, id: string, brief: string) => request("POST", `/api/skim/${slug}/briefs`, { id, brief });
const list = async (slug: string) => ((await request("GET", `/api/skim/${slug}/briefs`)).body as { briefs: SkimBriefSummary[] }).briefs;

/** Queue a brief's (or the default's) route as the band would, through the route, and drive it to its end. */
async function planThroughTheRoute(skimBrief?: string, force = false): Promise<Job> {
  const posted = await request("POST", "/api/jobs", {
    slug: SLUG,
    steps: ["skim"],
    ...(force ? { force: ["skim"] } : {}),
    ...(skimBrief ? { skimBrief } : {}),
  });
  expect(posted.status, JSON.stringify(posted.body)).toBe(202);
  return drive((posted.body as { id: string }).id);
}

async function drive(id: string): Promise<Job> {
  const parts = { power: async () => "standard" as const, session: claimSession, steps: STEPS };
  for (let n = 1; n <= 60; n++) {
    const advanced = await runAsOwner(TEST_OWNER, () => advanceJobWith(id, parts));
    if (advanced?.done) return advanced.job;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`job ${id} did not finish`);
}

/* ---------------------------------------------------------------- 1. store -- */

describe("the brief store, through its routes", () => {
  it("creates, lists, edits and deletes a brief; an edit keeps the route", async () => {
    const made = await create(SLUG, "spya-sbr2ca", "  The methods only  ");
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ id: "spya-sbr2ca", brief: "The methods only", planned: false, plannedAt: null });
    expect((await list(SLUG)).map((b) => b.id)).toContain("spya-sbr2ca");

    /* The same id and sentence again is the press that landed; another sentence is a 409. */
    expect((await create(SLUG, "spya-sbr2ca", "The methods only")).status).toBe(201);
    expect((await create(SLUG, "spya-sbr2ca", "Something else")).status).toBe(409);

    const edited = await request("PATCH", `/api/skim/${SLUG}/briefs/spya-sbr2ca`, { brief: "The results only" });
    expect(edited.status).toBe(200);
    expect((edited.body as SkimBriefSummary).brief).toBe("The results only");

    expect((await request("DELETE", `/api/skim/${SLUG}/briefs/spya-sbr2ca`)).status).toBe(204);
    expect((await request("DELETE", `/api/skim/${SLUG}/briefs/spya-sbr2ca`)).status).toBe(404);
    expect((await list(SLUG)).map((b) => b.id)).not.toContain("spya-sbr2ca");
  });

  it("refuses an empty, an over-long or a mis-shaped brief", async () => {
    expect((await create(SLUG, "spya-sbe2ca", "   ")).status).toBe(400);
    expect((await create(SLUG, "spya-sbe2ca", "x".repeat(601))).status).toBe(400);
    expect((await create(SLUG, "not-an-id", "fine")).status).toBe(400);
    expect((await request("POST", `/api/skim/${SLUG}/briefs`, { id: "spya-sbe2ca", brief: "x", extra: 1 })).status).toBe(400);
  });

  /* The table's CHECK writes 600 out, since src/db/schema.ts may not import
     src/types.ts; this holds it to `MAX_PURPOSE_CHARS`. */
  it("has a database ceiling that is MAX_PURPOSE_CHARS", async () => {
    const insert = (id: string, brief: string) =>
      getDb().insert(skimBriefs).values({ articleId: other?.articleId ?? "", id, brief });
    await expect(insert("spya-sbx2ca", "x".repeat(MAX_PURPOSE_CHARS + 1))).rejects.toThrow();
    await insert("spya-sbx2cb", "x".repeat(MAX_PURPOSE_CHARS));
    await getDb().delete(skimBriefs).where(eq(skimBriefs.id, "spya-sbx2cb"));
  });

  it(`holds at most ${SKIM_BRIEFS_MAX} per article`, async () => {
    const ids = Array.from({ length: SKIM_BRIEFS_MAX }, (_, i) => `spya-sbm${"abcdefghjkmn"[i]}2c`);
    for (const id of ids) expect((await create(OTHER, id, `Brief ${id}`)).status).toBe(201);
    const over = await create(OTHER, "spya-sbmp2c", "one too many");
    expect(over.status).toBe(409);
    expect(await list(OTHER)).toHaveLength(SKIM_BRIEFS_MAX);
    /* Deleting one makes room. */
    expect((await request("DELETE", `/api/skim/${OTHER}/briefs/${ids[0]}`)).status).toBe(204);
    expect((await create(OTHER, "spya-sbmp2c", "now there is room")).status).toBe(201);
  });
});

/* ------------------------------------------------------------ 2. owner-only -- */

describe("owner-only", () => {
  it("answers 404 for a stranger's article on every brief route", async () => {
    await getDb().insert(skimBriefs).values({ articleId: strangers?.articleId ?? "", id: "spya-sbs2ca", brief: "theirs" });
    const at = `/api/skim/${STRANGERS}/briefs`;
    expect((await request("GET", at)).status).toBe(404);
    expect((await request("POST", at, { id: "spya-sbs2cb", brief: "mine" })).status).toBe(404);
    expect((await request("GET", `${at}/spya-sbs2ca`)).status).toBe(404);
    expect((await request("PATCH", `${at}/spya-sbs2ca`, { brief: "mine" })).status).toBe(404);
    expect((await request("DELETE", `${at}/spya-sbs2ca`)).status).toBe(404);
    expect((await request("POST", `${at}/spya-sbs2ca/profile-notice-dismissal`, { generatedAt: "x" })).status).toBe(404);
    const job = await request("POST", "/api/jobs", { slug: STRANGERS, steps: ["skim"], skimBrief: "spya-sbs2ca" });
    expect(job.status).toBe(404);
    const [row] = await getDb().select().from(skimBriefs).where(eq(skimBriefs.id, "spya-sbs2ca"));
    expect(row?.brief).toBe("theirs");
  });

  it("answers 404 for a brief that is on another of the reader's articles", async () => {
    expect((await create(SLUG, "spya-sbz2ca", "on this one")).status).toBe(201);
    expect((await request("GET", `/api/skim/${OTHER}/briefs/spya-sbz2ca`)).status).toBe(404);
    expect((await request("PATCH", `/api/skim/${OTHER}/briefs/spya-sbz2ca`, { brief: "x" })).status).toBe(404);
    expect((await request("DELETE", `/api/skim/${OTHER}/briefs/spya-sbz2ca`)).status).toBe(404);
    const job = await request("POST", "/api/jobs", { slug: OTHER, steps: ["skim"], skimBrief: "spya-sbz2ca" });
    expect(job.status).toBe(404);
  });

  it("refuses skimBrief beside any step but Skim's own", () => {
    expect(parseJobRequest({ slug: SLUG, steps: ["quotes", "ideas", "skim"], skimBrief: BRIEF_A }).skimBrief).toBe(BRIEF_A);
    expect(() => parseJobRequest({ slug: SLUG, steps: ["skim", "glossary"], skimBrief: BRIEF_A })).toThrow(/skimBrief/);
    expect(() => parseJobRequest({ slug: SLUG, steps: ["quotes"], skimBrief: BRIEF_A })).toThrow(/skimBrief/);
    expect(() => parseJobRequest({ slug: SLUG, skimBrief: BRIEF_A })).toThrow(/skimBrief/);
    expect(() => parseJobRequest({ slug: SLUG, steps: ["skim"], skimBrief: "nope" })).toThrow(/skimBrief/);
  });
});

/* --------------------------------------------------------------- 3–6. jobs -- */

describe("a brief's route, planned by a job", () => {
  it("writes the brief's row, planned for the brief in place of the purpose, and not the revision's column", async () => {
    await getDb().update(articles).set({ purpose: "the article's own purpose" }).where(eq(articles.id, article?.articleId ?? ""));
    expect((await create(SLUG, BRIEF_A, "Only the statistics")).status).toBe(201);
    model.prompts.length = 0;
    const job = await planThroughTheRoute(BRIEF_A);
    expect(job.status).toBe("done");
    expect(job.skimBrief).toBe(BRIEF_A);
    const polled = await request("GET", `/api/jobs/${job.id}`);
    expect(polled.status).toBe(200);
    expect("skimBrief" in (polled.body as object), "the brief id reached the wire").toBe(false);

    const row = await briefRow(BRIEF_A);
    expect(row?.skim?.stops.map((s) => s.quoteId)).toEqual(quoteIds);
    expect(row?.plannedAt).toBeInstanceOf(Date);
    const profile = renderProfile({ profile: await runAsOwner(TEST_OWNER, () => readerStore.readProfile()), purpose: "Only the statistics" });
    expect(row?.skim?.profileHash).toBe(profile ? hashProfile(profile) : null);
    expect(model.prompts.join("\n")).toContain("Only the statistics");
    expect(model.prompts.join("\n")).not.toContain("the article's own purpose");

    /* The default's route is exactly as it was. */
    expect(await revisionSkim(article)).toEqual(defaultRoute);

    /* And the call is on the ledger, against this job's skim step. */
    const calls = await getDb().select().from(aiCalls).where(eq(aiCalls.jobId, job.id));
    expect(calls.map((c) => [c.purpose, c.stepName])).toEqual([["skim", "skim"]]);

    /* The read answers it the way the default's is answered. */
    const got = await request("GET", `/api/skim/${SLUG}/briefs/${BRIEF_A}`);
    expect(got.status).toBe(200);
    const body = got.body as SkimResponse;
    expect(body).toMatchObject({ stale: false, outdated: false, profileChanged: false, profileNoticeDismissed: false });
    expect((await list(SLUG)).find((b) => b.id === BRIEF_A)?.planned).toBe(true);
  });

  it("skips a second press over a route that is still current, and buys nothing", async () => {
    const before = await briefRow(BRIEF_A);
    model.prompts.length = 0;
    const job = await planThroughTheRoute(BRIEF_A);
    expect(job.status).toBe("done");
    expect(job.steps.find((s) => s.name === "skim")?.status).toBe("skipped");
    expect(model.prompts).toHaveLength(0);
    expect((await briefRow(BRIEF_A))?.skim).toEqual(before?.skim);
  });

  it("calls a route planned for an earlier sentence profile-changed, and the dismissal holds for it", async () => {
    const edited = await request("PATCH", `/api/skim/${SLUG}/briefs/${BRIEF_A}`, { brief: "Only the figures" });
    expect(edited.status).toBe(200);
    const read = (await request("GET", `/api/skim/${SLUG}/briefs/${BRIEF_A}`)).body as SkimResponse;
    expect(read.profileChanged).toBe(true);
    expect(read.stale).toBe(false);
    expect(read.profileNoticeDismissed).toBe(false);

    const at = `/api/skim/${SLUG}/briefs/${BRIEF_A}/profile-notice-dismissal`;
    expect((await request("POST", at, { generatedAt: "an older route" })).status).toBe(409);
    expect((await request("POST", at, { generatedAt: read.skim.generatedAt })).status).toBe(204);
    expect(((await request("GET", `/api/skim/${SLUG}/briefs/${BRIEF_A}`)).body as SkimResponse).profileNoticeDismissed).toBe(true);
    /* The default's notice is its own, and untouched. */
    const [art] = await getDb()
      .select({ key: articles.skimProfileNoticeDismissedFor })
      .from(articles)
      .where(eq(articles.id, article?.articleId ?? ""));
    expect(art?.key ?? null).toBeNull();
  });

  it("calls a brief's route stale once the Quotes change, and an unplanned brief is not made yet", async () => {
    const quotes = await getDb()
      .select({ quotes: articleRevisions.quotes })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, await revisionOf(article)));
    const planned = quoteIds;
    quoteIds = await giveQuotes(article as ScratchArticle, 2);
    try {
      expect(((await request("GET", `/api/skim/${SLUG}/briefs/${BRIEF_A}`)).body as SkimResponse).stale).toBe(true);
    } finally {
      await getDb()
        .update(articleRevisions)
        .set({ quotes: quotes[0]?.quotes ?? null })
        .where(eq(articleRevisions.id, await revisionOf(article)));
      quoteIds = planned;
    }
    expect(((await request("GET", `/api/skim/${SLUG}/briefs/${BRIEF_A}`)).body as SkimResponse).stale).toBe(false);

    expect((await create(SLUG, BRIEF_B, "How it compares")).status).toBe(201);
    expect(await request("GET", `/api/skim/${SLUG}/briefs/${BRIEF_B}`)).toEqual({ status: 200, body: null });
  });

  it("is one job for one brief pressed twice, and two for two briefs, and neither is the default's", async () => {
    const queue = (skimBrief?: string) =>
      runAsOwner(TEST_OWNER, () =>
        enqueue({ slug: SLUG, steps: ["skim"], force: ["skim"], pump: false, ...(skimBrief ? { skimBrief, profile: "p" } : { profile: "p" }) }),
      );
    const a1 = await queue(BRIEF_A);
    const a2 = await queue(BRIEF_A);
    const b = await queue(BRIEF_B);
    const plain = await queue();
    expect(a2.id).toBe(a1.id);
    expect(new Set([a1.id, b.id, plain.id]).size).toBe(3);
    const stored = await getDb().select({ id: jobsTable.id, brief: jobsTable.skimBrief }).from(jobsTable).where(eq(jobsTable.slug, SLUG));
    expect(stored.find((j) => j.id === a1.id)?.brief).toBe(BRIEF_A);
    expect(stored.find((j) => j.id === plain.id)?.brief).toBeNull();
    /* Cleared so the jobs below are not queued behind these. */
    await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
  });

  it("keeps nothing for a brief deleted while its route was being planned, and still ends done", async () => {
    expect((await create(SLUG, BRIEF_GONE, "Soon to go")).status).toBe(201);
    model.during = async () => {
      await getDb().delete(skimBriefs).where(and(eq(skimBriefs.articleId, article?.articleId ?? ""), eq(skimBriefs.id, BRIEF_GONE)));
    };
    try {
      const job = await planThroughTheRoute(BRIEF_GONE);
      expect(job.status).toBe("done");
      expect(job.steps.find((s) => s.name === "skim")?.detail).toMatch(/deleted/);
    } finally {
      model.during = async () => {};
    }
    expect(await briefRow(BRIEF_GONE)).toBeUndefined();
    expect(await revisionSkim(article)).toEqual(defaultRoute);
  });

  it("leaves the default's job writing the revision's column, exactly as before", async () => {
    const job = await planThroughTheRoute(undefined, true);
    expect(job.status).toBe("done");
    const now = await revisionSkim(article);
    expect(now?.stops.map((s) => s.quoteId)).toEqual(quoteIds);
    defaultRoute = now;
    /* And the brief's route is untouched by it. */
    expect((await briefRow(BRIEF_A))?.skim?.stops.map((s) => s.quoteId)).toEqual(quoteIds);
  });
});

