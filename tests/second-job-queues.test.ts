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
 *
 * ### The mutations for the conversion — 2026-09-04
 *
 * **Mutation.** `tryEnqueue` in src/store/pg-jobs.ts, the re-read classifier
 * with `row.workKey === ticket.workKey` deleted from `mine`. *4 passed (4)* —
 * it STAYED GREEN, and is the origin of the rule that a green mutation is a
 * finding. That branch runs only on an insert conflict; the two cases with a
 * differently-shaped job insert cleanly, and the double-click case, which does
 * conflict, has exactly one other active row for a looser predicate to pick.
 *
 * **Blind to.** How the classification is *reached*. Nothing in this file
 * distinguishes `sameWork` from `created` by anything but the id that comes
 * back, so the whole of `tryEnqueue`'s three-way answer — the slug reservation
 * and the source-address branch below `mine` — is untested here, and so is the
 * retry loop above it. tests/enqueue-owns-the-article.test.ts is where the
 * classification is held.
 *
 * **Mutation.** The other direction, so that the file is known to be able to go
 * red at all: the same insert's `workKey: ticket.workKey` written as `workKey:
 * job.slug`, collapsing every job on one article onto one key. *3 failed | 1
 * passed (4)*, all three on `expected 500 to be 202`.
 *
 * **Blind to.** What that one says is narrow: the three went red as a crash,
 * not on the id assertion each case is about, so it proves this suite runs
 * against the real insert and nothing more. The claim these cases exist for —
 * a *different* second job gets a new id rather than a 409 — lives in
 * `jobs_active_work` in src/db/schema.ts, and no mutation of TypeScript can
 * reach an index.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import type { OwnerId } from "../src/owner.js";
import { mintAttempt } from "../src/store/jobs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { Job } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_SUB } from "./helpers/authed.js";
import { bareArticles, removeBareArticles } from "./helpers/bare-article.js";
import { pgReady } from "./helpers/pg-ready.js";

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

await pgReady({
  suite: "tests/second-job-queues.test.ts",
  tables: ["spideryarn.jobs"],
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
beforeAll(async () => {
  wasVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  /* **The article, before any job names it** — added 2026-09-05, when `enqueue`
     started refusing a bare-slug request for an article the reader does not have
     (src/jobs.ts). Owned by `OWNER`, because that is who `acceptAny`
     authenticates the requests below as, and `articleExists` is owner-scoped.
     The comment above says "the article does not exist"; it does now, and
     nothing this file asserts was about its absence — every case is about
     whether a *second job* on one article queues, collapses or is refused.
     ./helpers/bare-article.ts. */
  await bareArticles([SLUG], OWNER);
}, 60_000);
afterAll(async () => {
  if (wasVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = wasVercel;
  await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
  await removeBareArticles([SLUG], OWNER);
  await closeDb();
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
  await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
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

describe("POST /api/jobs on an article that already has a job", () => {
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
