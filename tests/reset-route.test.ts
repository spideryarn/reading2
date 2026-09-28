/**
 * **`POST /api/article/:slug/reset`** — the thin route over `enqueueReset`
 * (src/jobs.ts). Stage 1 of docs/plans/260928a-reset-and-regenerate-article.md.
 *
 * What the route itself decides, and so what this file asserts:
 *
 * - the body is `{ regenerate: boolean }` and nothing else — anything else is
 *   a 400 before anything is read;
 * - a slug the reader does not own is a 404 and queues nothing;
 * - the answer is a 202 with the reset job's id and the extras it will make
 *   again, which are the extras the current revision has, in `STEP_ORDER`;
 * - the job is the import again (`DEFAULT_INGEST_STEPS`, `extract` forced) and
 *   spends no quota slot.
 *
 * What a reset *does* is tests/reset-and-regenerate.test.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { EVAL_OWNER_ID } from "../src/owner.js";
import { DEFAULT_INGEST_STEPS } from "../src/pipeline.js";
import { extraColumns } from "../src/reset.js";
import type { ResetResponse, StepName } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const STEM = "test-reset-route";
const SLUG = `${STEM}-mine`;
const STRANGERS = `${STEM}-strangers`;

await pgReady({
  suite: "tests/reset-route.test.ts",
  tables: ["spideryarn.jobs", "spideryarn.article_revisions"],
  columns: [{ table: "spideryarn.jobs", column: "reset" }],
});

const { handleApi } = await import("../src/routes.js");

let mine: ScratchArticle | undefined;
let strangers: ScratchArticle | undefined;
let vercel: string | undefined;

beforeAll(async () => {
  /* **`VERCEL`, so `enqueue` does not start driving what it queues** — the
     reset would otherwise run for real in this process. src/jobs.ts § `pump`. */
  vercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  await getDb().delete(jobsTable).where(like(jobsTable.slug, `${STEM}%`));
  mine = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  strangers = await scratchArticleInPg(STRANGERS, { ownerId: EVAL_OWNER_ID });
  /* Two extras on the revision whatever the corpus article happens to carry,
     so "the extras it has" is never the empty list by accident. Handed over
     out of STEP_ORDER. */
  await getDb()
    .update(articleRevisions)
    .set({ quotes: { fixture: "quotes" } as never, arc: { fixture: "arc" } as never })
    .where(
      eq(
        articleRevisions.id,
        sql`(select ${articles.currentRevisionId} from ${articles} where ${articles.slug} = ${SLUG})`,
      ),
    );
}, 120_000);

afterAll(async () => {
  if (vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = vercel;
  await getDb().delete(jobsTable).where(like(jobsTable.slug, `${STEM}%`));
  await mine?.remove();
  await strangers?.remove();
  await closeDb();
});

async function post(slug: string, raw: string): Promise<{ status: number; body: unknown }> {
  const req = Object.assign(
    (async function* () {
      if (raw) yield Buffer.from(raw);
    })(),
    { method: "POST", url: `/api/article/${slug}/reset`, headers: AUTHED_HEADERS },
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
  return {
    status: (res as unknown as { statusCode: number }).statusCode,
    body: written ? JSON.parse(written) : null,
  };
}

/** The extras the current revision holds, read straight off the columns. */
async function extrasOn(slug: string): Promise<StepName[]> {
  const [row] = await getDb()
    .select({ revision: articleRevisions })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(eq(articles.slug, slug))
    .limit(1);
  if (!row) throw new Error(`no revision for ${slug}`);
  return extraColumns()
    .filter(({ column }) => row.revision[column] !== null)
    .map(({ step }) => step);
}

const jobsOn = (slug: string) =>
  getDb().select().from(jobsTable).where(eq(jobsTable.slug, slug));

describe("POST /api/article/:slug/reset", () => {
  it("queues one reset job and answers with its id and the extras it will make again", async () => {
    const expected = await extrasOn(SLUG);
    expect(expected).toEqual(expect.arrayContaining(["arc", "quotes"]));

    const reply = await post(SLUG, JSON.stringify({ regenerate: true }));
    expect(reply.status).toBe(202);
    const body = reply.body as ResetResponse;
    expect(body.regenerate).toEqual(expected);

    const [job] = await getDb().select().from(jobsTable).where(eq(jobsTable.id, body.jobId));
    expect(job?.ownerId).toBe(TEST_OWNER);
    expect(job?.reset?.regenerate).toEqual(expected);
    expect(job?.steps.map((s) => s.name)).toEqual(DEFAULT_INGEST_STEPS);
    expect(job?.steps.find((s) => s.name === "extract")?.force).toBe(true);
    /* A re-run of an article on the shelf: no quota slot. */
    expect(job?.ingestEventId).toBeNull();
    expect(await jobsOn(SLUG)).toHaveLength(1);
  });

  it("records an empty list when the extras are not to be made again", async () => {
    await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
    const reply = await post(SLUG, JSON.stringify({ regenerate: false }));
    expect(reply.status).toBe(202);
    expect((reply.body as ResetResponse).regenerate).toEqual([]);
    const [job] = await jobsOn(SLUG);
    expect(job?.reset?.regenerate).toEqual([]);
  });

  it("answers somebody else's article with a 404 and queues nothing", async () => {
    const reply = await post(STRANGERS, JSON.stringify({ regenerate: true }));
    expect(reply.status).toBe(404);
    expect(await jobsOn(STRANGERS)).toEqual([]);
  });

  it.each([
    ["no body at all", ""],
    ["a missing regenerate", JSON.stringify({})],
    ["a string for regenerate", JSON.stringify({ regenerate: "yes" })],
    ["a field it does not take", JSON.stringify({ regenerate: true, steps: ["quotes"] })],
    ["an array", JSON.stringify([true])],
  ])("refuses %s with a 400 and queues nothing", async (_what, raw) => {
    await getDb()
      .delete(jobsTable)
      .where(and(eq(jobsTable.slug, SLUG)));
    const reply = await post(SLUG, raw);
    expect(reply.status).toBe(400);
    expect(await jobsOn(SLUG)).toEqual([]);
  });
});
