/**
 * **The 409 has to name the job it is talking about.**
 *
 * `POST /api/jobs {slug, steps}` on an article that already has an active job
 * is refused, and until 2026-09-01 the whole of the refusal was one sentence:
 * *"That article already has a job running. Wait for it, or stop it first."* It
 * named no job, offered no way to reach one, and said **running** about a job
 * that may be sitting in `queued` with nothing driving it. So the reader was
 * told to stop something they could not see.
 *
 * Two things are pinned here, and the second is the one that was structurally
 * missing rather than merely absent:
 *
 * 1. The sentence no longer claims the blocker is running.
 * 2. The body carries the blocking job itself, through the generic error
 *    handler in src/routes.ts — which emitted `{ error }` and nothing else, so
 *    *no* structured field could have left the server.
 *
 * **And it is stripped exactly as `GET /api/jobs` strips it.** That is the
 * whole security argument for widening the error shape: the 409 can carry
 * nothing the same reader would not have been handed by their next poll a
 * second later. `jobs_active_slug` is `(owner_id, slug)` — src/db/schema.ts, and
 * the filesystem adapter filters on `ownerId` the same way — so the blocking row
 * is always the requester's own.
 *
 * docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md § Stage 6.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, expect, it } from "vitest";

import { forgetJob } from "../src/jobs.js";
import { ARTICLE_IS_BUSY } from "../src/job-state.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { fsJobStore } from "../src/store/jobs-fs.js";
import type { Job } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_SUB } from "./helpers/authed.js";

const { handleApi } = await import("../src/routes.js");

const OWNER = TEST_SUB as OwnerId;
const SLUG = "test-blocking-job-409";

/** Job ids this test seeded, removed in `afterEach` whatever happened. */
const seeded: string[] = [];

/**
 * A job holding the slug, put in the store directly rather than through
 * `enqueue`.
 *
 * `enqueue` ends in `pump`, which would start running the thing — so the
 * blocker would be racing the assertion. What matters here is only that the
 * slug is held by an **active** job doing different work.
 */
async function hold(status: Job["status"]): Promise<Job> {
  const wanted: Job = {
    id: `spya-blk${status.slice(0, 3)}`,
    ownerId: OWNER,
    slug: SLUG,
    status: "queued",
    createdAt: new Date().toISOString(),
    steps: [
      {
        name: "hierarchy",
        label: "Building the hierarchy",
        status: status === "running" ? "running" : "pending",
        ...(status === "running" ? { startedAt: new Date().toISOString() } : {}),
      },
    ],
  };
  const { job } = await fsJobStore.enqueueOrGet(wanted, `blocking-409-${wanted.id}`);
  seeded.push(job.id);
  if (status === "running") await fsJobStore.claim(job.id, OWNER, "attempt-409", 600_000, 4);
  return job;
}

afterEach(async () => {
  for (const id of seeded.splice(0)) {
    await runAsOwner(OWNER, () => forgetJob(id)).catch(() => undefined);
  }
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

/** Drive `handleApi` with a fake request/response pair. */
async function post(body: unknown): Promise<Reply> {
  const payload = Buffer.from(JSON.stringify(body));
  const req = Object.assign(
    (async function* () {
      yield payload;
    })(),
    { method: "POST", url: "/api/jobs", headers: AUTHED_HEADERS },
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
    setHeader() {},
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

it("names the job that is in the way, and does not call a queued one running", async () => {
  const held = await hold("queued");

  const reply = await post({ slug: SLUG, steps: ["glossary"], useProfile: false });

  expect(reply.status).toBe(409);
  expect(reply.body.error).toBe(ARTICLE_IS_BUSY);
  /* The word the old sentence used about a job that may be doing nothing at
     all. `displayJob` on the client says which of the two it really is. */
  expect(String(reply.body.error)).not.toMatch(/running/i);

  const blocking = reply.body.blocking as Job | undefined;
  expect(blocking?.id, "the 409 carried no blocking job").toBe(held.id);
  expect(blocking?.slug).toBe(SLUG);
  expect(blocking?.status).toBe("queued");
  expect(blocking?.steps.map((s) => s.name)).toEqual(["hierarchy"]);
});

it("strips the blocking job exactly as the poll would", async () => {
  await hold("running");

  const reply = await post({ slug: SLUG, steps: ["glossary"], useProfile: false });

  expect(reply.status).toBe(409);
  const blocking = reply.body.blocking as Record<string, unknown> | undefined;
  expect(blocking, "the 409 carried no blocking job").toBeDefined();
  /* `publicJob` in src/routes.ts, and the same call the list uses — so this is
     one narrowing function rather than a second one that can drift. */
  expect(blocking).not.toHaveProperty("ownerId");
  expect(blocking).not.toHaveProperty("profile");
  expect(blocking?.status).toBe("running");
});
