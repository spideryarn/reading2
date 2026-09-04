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
 *
 * ## The store, since 2026-09-04
 *
 * It used to hold the article with `fsJobStore` and tidy up with
 * `forgetForTests`, so the queue it drove was a directory and a process-local
 * map. Every sentence above is now enforced by SQL instead — `jobs_active_work`
 * is what collapses the double-click, and `claim`'s *no older active row for
 * this slug* is what makes the accepted job wait its turn rather than being
 * refused. Stage B of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres` before **any** import.
 *
 * `src/jobs.ts` picks its store **once, at module load** — `const store:
 * JobStore = STORE === "postgres" ? pgJobStore : fsJobStore` — and imports are
 * hoisted above every statement in a module, so a plain assignment here would
 * leave the route below on the filesystem queue with nothing saying so. The
 * same trap at greater length in tests/enqueue-owns-the-article.test.ts.
 */
const HOISTED = vi.hoisted(() => {
  const previousStore = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return { previousStore };
});

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import type { OwnerId } from "../src/owner.js";
import { mintAttempt } from "../src/store/jobs.js";
import { STORE } from "../src/store/live.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { Job } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_SUB } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";

/* Put the flag back straight after the imports: vitest reuses a worker across
   files and does not reset `process.env` between them. */
if (HOISTED.previousStore === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = HOISTED.previousStore;

loadEnvLocal();

const { handleApi } = await import("../src/routes.js");

/**
 * The signed-in reader `acceptAny` below authenticates as, and a row the
 * private lane already seeds (tests/helpers/seed-local-accounts.ts) — which it
 * has to be, because `jobs.owner_id` carries a foreign key into `auth.users`
 * and a made-up uuid would fail the *insert* rather than anything under test.
 */
const OWNER = TEST_SUB as OwnerId;
const SLUG = "test-second-job-queues";

const { reachable } = await pgReady({
  suite: "tests/second-job-queues.test.ts",
  tables: ["spideryarn.jobs"],
});

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    /* Not gated on `reachable`: a control that disappears when the database is
       missing disappears exactly when it matters. A flag that failed to take is
       invisible otherwise — the filesystem queue answers every call here
       happily, and none of the indexes the cases below are about would be
       consulted at all. */
    expect(STORE).toBe("postgres");
  });
});


/**
 * **`VERCEL`, so `enqueue` does not start driving what it queues.**
 *
 * `pump` returns immediately when it is set (src/jobs.ts). The filesystem
 * version could let it run — the article does not exist, so the ingest failed
 * offline in milliseconds — but under Postgres a pumped job claims a row this
 * file is about to make assertions on, and the race is one nobody would enjoy
 * reading a failure of. The route's own answer is what this file is for, and
 * `pump` is called after it is decided.
 */
let wasVercel: string | undefined;
beforeAll(() => {
  wasVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
});
afterAll(async () => {
  if (wasVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = wasVercel;
  if (reachable) await closeDb();
});

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
    /* **`mintId()`, not a hand-written `spya-2ndrun`.** `jobs_id_format` checks
       every id against `ID_PATTERN` (src/ids.ts), whose body must start with a
       letter — so the mnemonic ids this file used under the filesystem store,
       which validated nothing, are refused by the insert. */
    id: mintId(),
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
  const { job } = await pgJobStore.enqueueOrGet(wanted, {
    workKey: `second-job-${wanted.id}`,
    reservesName: false,
  });
  /* A real attempt token, because `jobs.attempt_id` is a `uuid` column: the
     filesystem store took the string `attempt-2nd` and Postgres will not. */
  if (status === "running") await pgJobStore.claim(job.id, OWNER, mintAttempt(), 600_000, 4);
  return job;
}

/**
 * **Deleted, not dismissed, and the difference cost half an hour.**
 *
 * `forgetJob` is the reader's Dismiss and refuses a job that is still queued or
 * running — which is every job this file makes. On the filesystem store the
 * records therefore survived in `data/_jobs/`, the *next* run loaded them at
 * start-up, and `enqueueOrGet` correctly answered `sameWork` to a request
 * identical to one it had already seen. Every assertion still passed, against a
 * job left behind by the previous run rather than the one this run made: the
 * exact shape of docs/reusable/silent-success.md, found only because a
 * deliberate mutation failed to turn this file red.
 *
 * The private lane mints a database per run, so that particular leak cannot
 * cross runs any more — but it can still cross *cases* inside one, and
 * `jobs_active_work` is precisely what would answer `sameWork` if it did. So
 * the rows go, by slug rather than by id: a case that failed part-way through
 * leaves rows no list of ids in this file has ever seen.
 */
afterEach(async () => {
  if (reachable) await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
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

when("POST /api/jobs on an article that already has a job", () => {
  it("accepts Ideas while a glossary job is running on the same article", async () => {
    const held = await hold("running");

    const reply = await post({ slug: SLUG, steps: ["ideas"], useProfile: false });

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
    expect(first.status, `refused with: ${String(first.body.error)}`).toBe(202);

    const second = await post({ slug: SLUG, steps: ["ideas"], useProfile: false });
    expect(second.status).toBe(202);
    expect(second.body.id, "an identical request bought a second job").toBe(first.body.id);
  });
});
