/**
 * **A second, different job on one article is accepted, not refused.**
 *
 * The end-to-end shape of the per-article queue, through the real route:
 *
 * > I got `Spideryarn is already busy with this article. Wait for that to
 * > finish, or stop it and ask again.` when I tried to run Ideas while Glossary
 * > was already running. Can we always and by default append to existing
 * > per-article queue, so that we can run as much as we like, and it simply
 * > takes longer?
 * >
 * > — Greg, 2026-09-02
 *
 * `POST /api/jobs {slug, steps:["ideas"]}` while a glossary job holds the
 * article answers **202 with a different job id**. That sentence, and the whole
 * of `JobConflict`, `ARTICLE_IS_BUSY` and the blocking-job payload beside it,
 * are gone —
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md
 * § 1g.
 *
 * This file replaces `tests/blocking-job-409.test.ts`, which pinned the refusal
 * and the job it named. Its request/response harness is kept verbatim, because
 * the thing worth keeping from it is that the assertion goes through
 * `handleApi` rather than through `enqueue`: the status code and the body are
 * the route's, and a store-level test cannot see either.
 *
 * **Watched red on 2026-09-02**, against the tree before this stage: both cases
 * answered `409` with *"Spideryarn is already busy with this article…"*.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, expect, it } from "vitest";

import type { OwnerId } from "../src/owner.js";
import { forgetForTests, fsJobStore } from "../src/store/jobs-fs.js";
import type { Job } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_SUB } from "./helpers/authed.js";

const { handleApi } = await import("../src/routes.js");

const OWNER = TEST_SUB as OwnerId;
const SLUG = "test-second-job-queues";

/** Job ids this test seeded, removed in `afterEach` whatever happened. */
const seeded: string[] = [];

/**
 * A glossary job holding the article, put in the store directly rather than
 * through `enqueue`.
 *
 * `enqueue` ends in `pump`, which would start running the thing — so the holder
 * would be racing the assertion. What matters here is only that the article has
 * an **active** job doing work that is not the request's.
 *
 * `reservesName: false`, because this job *names* an article rather than
 * claiming a name — which is exactly what a mode button sends, and what makes
 * several of them able to queue behind one another.
 */
async function hold(status: Job["status"]): Promise<Job> {
  const wanted: Job = {
    id: `spya-2nd${status.slice(0, 3)}`,
    ownerId: OWNER,
    slug: SLUG,
    status: "queued",
    createdAt: new Date().toISOString(),
    steps: [
      {
        name: "glossary",
        label: "Finding the terms",
        status: status === "running" ? "running" : "pending",
        ...(status === "running" ? { startedAt: new Date().toISOString() } : {}),
      },
    ],
  };
  const { job } = await fsJobStore.enqueueOrGet(wanted, {
    workKey: `second-job-${wanted.id}`,
    reservesName: false,
  });
  seeded.push(job.id);
  if (status === "running") await fsJobStore.claim(job.id, OWNER, "attempt-2nd", 600_000, 4);
  return job;
}

/**
 * **`forgetForTests`, not `forgetJob`, and the difference cost half an hour.**
 *
 * `forgetJob` is the reader's Dismiss and refuses a job that is still queued or
 * running — which is every job this file makes. So the records survived in
 * `data/_jobs/`, the *next* run of this file loaded them at start-up, and
 * `enqueueOrGet` correctly answered `sameWork` to a request identical to one it
 * had already seen. Every assertion still passed, against a job left behind by
 * the previous run rather than the one this run made: the exact shape of
 * docs/reusable/silent-success.md, found only because a deliberate mutation
 * failed to turn this file red.
 */
afterEach(async () => {
  await forgetForTests(seeded.splice(0));
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

it("accepts Ideas while a glossary job is running on the same article", async () => {
  const held = await hold("running");

  const reply = await post({ slug: SLUG, steps: ["ideas"], useProfile: false });
  /* Recorded before the assertions, not after: a record left behind by a failed
     case is loaded by the next run and answered with `sameWork`, which is how a
     mutation to `enqueue` first failed to redden this file at all. */
  if (typeof reply.body.id === "string") seeded.push(reply.body.id);

  /* 202, because the work has been accepted and has not been done. */
  expect(reply.status, `refused with: ${String(reply.body.error)}`).toBe(202);
  expect(reply.body.id, "the second request was handed the first job").not.toBe(held.id);
  expect(reply.body.slug, "the request named an article and must not be moved off it").toBe(SLUG);
  /* Queued, not running: the article's line is enforced at the claim, so the
     row goes in and waits its turn — src/store/jobs.ts § `claim`. */
  expect(reply.body.status).toBe("queued");
  expect((reply.body.steps as { name: string }[]).map((s) => s.name)).toEqual(["ideas"]);
  /* Nothing structured beside the sentence any more, because there is no
     sentence — `structuredDetail` went with the refusal. */
  expect(reply.body).not.toHaveProperty("blocking");
});

it("accepts it while the first job is merely queued, too", async () => {
  /* The state that reads as *Waiting to continue.*, which is what the reader
     sees on a job left behind by a dev-server restart. It held the article
     exactly as hard as a running one under the old index, and refusing here was
     the sharper half of Greg's complaint: nothing was even happening. */
  const held = await hold("queued");

  const reply = await post({ slug: SLUG, steps: ["ideas"], useProfile: false });
  if (typeof reply.body.id === "string") seeded.push(reply.body.id);

  expect(reply.status, `refused with: ${String(reply.body.error)}`).toBe(202);
  expect(reply.body.id).not.toBe(held.id);
  expect(reply.body.status).toBe("queued");
});

it("still collapses a double-click onto one job", async () => {
  /* The other half of the rule, and the one that keeps a second model call from
     being the price of an impatient finger. Two *identical* requests are one
     piece of work — `jobs_active_work` in src/db/schema.ts — so this must hand
     back the same id where the case above hands back a new one. */
  const first = await post({ slug: SLUG, steps: ["ideas"], useProfile: false });
  if (typeof first.body.id === "string") seeded.push(first.body.id);
  expect(first.status, `refused with: ${String(first.body.error)}`).toBe(202);

  const second = await post({ slug: SLUG, steps: ["ideas"], useProfile: false });
  expect(second.status).toBe(202);
  expect(second.body.id, "an identical request bought a second job").toBe(first.body.id);
});
