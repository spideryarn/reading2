/**
 * **A quiz job posted by the reading view carries this article's reading goal.**
 *
 * SPIDERYARN-READING2-6Q: the quiz is written with the owner's reason for
 * reading when there is one. The stage reads it off the job
 * (tests/quiz-step-registration.test.ts § the reader's reason), and this asks
 * the other half — that `POST /api/jobs {slug, steps: ["quiz"]}`, which is what
 * both `ensure` and *Write them again* send, resolves `articles.purpose` and
 * freezes it on the job row. Nothing asked that of any step before: the route
 * code is step-agnostic, and a regression in it would leave every profiled mode
 * quietly unprofiled. GPT Sol's plan review, finding 1.
 *
 * docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "../src/db/client.js";
import { articles, jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/quiz-job-carries-the-reading-goal.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs"],
});

const { handleApi } = await import("../src/routes.js");

const SLUG = "test-quiz-job-carries-the-reading-goal";
/** A word that could not reach the job from anywhere but this article's purpose. */
const PURPOSE = "I want to understand their ornithopter methods.";

async function post(url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = Object.assign(
    (async function* () {
      yield Buffer.from(JSON.stringify(body));
    })(),
    { method: "POST", url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let status = 0;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(code: number) {
      status = code;
    },
    flushHeaders() {},
    on() {},
    once() {},
    removeListener() {},
    write(chunk: unknown) {
      text += String(chunk);
      return true;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) text += String(chunk);
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function profileOfJob(id: string): Promise<string | null> {
  const [row] = await getDb().select({ profile: jobsTable.profile }).from(jobsTable).where(eq(jobsTable.id, id));
  if (!row) throw new Error(`no job row ${id}`);
  return row.profile;
}

let scratch: ScratchArticle | undefined;
let vercel: string | undefined;

beforeAll(async () => {
  /* `VERCEL`, so `enqueue` does not start driving the quiz it queues — which
     would be a real model call. tests/enqueue-owns-the-article.test.ts. */
  vercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  scratch = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  await getDb().update(articles).set({ purpose: PURPOSE }).where(eq(articles.slug, SLUG));
}, 120_000);

afterAll(async () => {
  if (vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = vercel;
  await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
  await scratch?.remove();
});

describe("POST /api/jobs for a quiz", () => {
  it("freezes this article's reason for reading onto the job", async () => {
    const reply = await post("/api/jobs", { slug: SLUG, steps: ["quiz"] });
    expect(reply.status).toBe(202);
    const profile = await profileOfJob(String(reply.body.id));
    expect(profile).toContain(`Why they are reading this piece: ${PURPOSE}`);
  });

  it("does too for Write them again, which is forced", async () => {
    const reply = await post("/api/jobs", { slug: SLUG, steps: ["quiz"], force: ["quiz"] });
    expect(reply.status).toBe(202);
    expect(await profileOfJob(String(reply.body.id))).toContain(PURPOSE);
  });

  it("carries none when the client declines it — the control", async () => {
    /* Without this the cases above would pass on a route that wrote the
       purpose onto every job whatever it was asked. */
    const reply = await post("/api/jobs", { slug: SLUG, steps: ["quiz"], force: ["quiz"], useProfile: false });
    expect(reply.status).toBe(202);
    expect(await profileOfJob(String(reply.body.id))).toBeNull();
  });
});

/* **A shared step's job carries no profile at all** — plan 261001m, GPT Sol's
   finding 7. The runner would strip it anyway (src/jobs.ts §
   `stepContextFor`), but a profile on the row is still in the work key, so
   every edit to the profile would defeat dedup on a job it cannot change, and
   the row would hold private text for nothing. The quiz cases above are the
   control: the same article, the same purpose, and there it does arrive. */
describe("POST /api/jobs for a shared step", () => {
  it("attaches no profile to a shared job with no personal step in it", async () => {
    const reply = await post("/api/jobs", { slug: SLUG, steps: ["quotes"], force: ["quotes"] });
    expect(reply.status).toBe(202);
    expect(await profileOfJob(String(reply.body.id))).toBeNull();
  });

  /* **A glossary request grows the owner's for-you marks** — plan 261001m,
     GPT Sol's finding 6: expanded before enqueue, so the job row, its work
     key and its order all have the step, and the profile rides with it. This
     article has a purpose, so the owner has a profile. */
  it("adds the glossary's for-you marks, and the profile, when the owner has one", async () => {
    const reply = await post("/api/jobs", { slug: SLUG, steps: ["glossary"], force: ["glossary"] });
    expect(reply.status).toBe(202);
    const steps = (reply.body.steps as { name: string }[]).map((s) => s.name);
    expect(steps).toEqual(["glossary", "glossaryForYou"]);
    expect(await profileOfJob(String(reply.body.id))).toContain(PURPOSE);
  });

  it("adds nothing when the client declines the profile — the control", async () => {
    const reply = await post("/api/jobs", {
      slug: SLUG,
      steps: ["glossary"],
      force: ["glossary"],
      useProfile: false,
    });
    expect(reply.status).toBe(202);
    expect((reply.body.steps as { name: string }[]).map((s) => s.name)).toEqual(["glossary"]);
    expect(await profileOfJob(String(reply.body.id))).toBeNull();
  });

  it("attaches it when a personal step rides in the same job", async () => {
    const reply = await post("/api/jobs", { slug: SLUG, steps: ["glossary", "quiz"], force: ["quiz"] });
    expect(reply.status).toBe(202);
    expect(await profileOfJob(String(reply.body.id))).toContain(PURPOSE);
  });
});
