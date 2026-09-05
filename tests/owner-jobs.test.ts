/**
 * **The ingest queue was completely open**, and it was the second half of a pair.
 *
 * GPT Sol reviewed the ownership work on 2026-08-27 and found two blockers that
 * survived it. This file is about the larger one:
 *
 * > `Job` has no owner, and every process uses one global map… Any authenticated
 * > Bob can list Alice's jobs, including slug, URL, upload filename, guidance,
 * > status and errors… fetch one by ID… cancel, retry, advance or delete it.
 * > That permits cross-reader disclosure, denial of service and paid model
 * > operations.
 *
 * The other half was `GET /api/source/:slug`, which read a PDF straight off disk
 * without ever asking whose article it was. Sol put the two together into one
 * sequence, which is why they are worth reading as a pair rather than as two
 * findings:
 *
 * > Combining findings 1 and 2 gives Bob a reliable sequence: list Alice's PDF
 * > job, take its slug, then download its source.
 *
 * The ownership work had gone straight past both, because both were *outside the
 * store*: jobs were JSON under `data/_jobs/` and never touched Postgres, and
 * `sendSource` read the filesystem directly. `ownedSlug()` guards every path
 * from a slug to an article, and neither of these was one.
 *
 * ## Why this suite needed no database, and why that is now the reason it does
 *
 * Its header used to say *"jobs never reach Postgres. The queue is a filesystem
 * directory and an in-memory map, so this runs everywhere `npm test` does"*.
 * That sentence is what
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § B falsifies: `jobs.owner_id` is a real column with a real foreign key into
 * `auth.users`, and every one of the seven refusals below is now a `where
 * owner_id = $1` in `src/store/pg-jobs.ts` rather than a field comparison in a
 * process-local map.
 *
 * **The move made the suite stronger in one specific place.** On the filesystem
 * store, Alice's and Bob's jobs lived in one directory that both readers could
 * read; the isolation was `j.ownerId === owner` applied *after* the load, so a
 * predicate that fell back to "everybody" was still a filter somebody had
 * written. Under Postgres the equivalent mistake — a `list` that forgets its
 * `where` — is one deleted line, and it is deleted from the only place the rows
 * can come out of. The mutation above *is not in Bob's list* is exactly that
 * line, deleted and watched.
 *
 * A `fetch` step on a slug with no source URL fails immediately and offline,
 * which is how a job gets queued here without buying anything.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import {
  advanceJob,
  cancelJob,
  enqueue,
  forgetJob,
  getJob,
  listJobs,
  retryJob,
} from "../src/jobs.js";
import { type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import type { Job } from "../src/types.js";
import { bareArticles } from "./helpers/bare-article.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/** Its own slug, so nothing here collides with another suite's fixtures. */
const SLUG = "test-owner-jobs";

/**
 * **Two readers that really exist.**
 *
 * `jobs.owner_id` carries a foreign key into `auth.users`, so a made-up uuid
 * fails the *insert* rather than the ownership check — which would turn every
 * case below into the same error and prove nothing. Seeded here rather than
 * borrowed from `scripts/setup-local.ts`'s dev pair, because the suite's whole
 * subject is one reader who is not the other, and a fixture that happened to be
 * the environment's own owner would make `outside a request` below tautological.
 *
 * `tests/store-migration-registry.ts` § `OWNER_AUDIT` carries the verdict for
 * both uuids.
 */
const ALICE = "00000000-0000-4000-8000-0000000000a7" as OwnerId;
const BOB = "00000000-0000-4000-8000-0000000000a8" as OwnerId;

await pgReady({
  suite: "tests/owner-jobs.test.ts",
  tables: ["spideryarn.jobs"],
});

/** Do something as a signed-in reader, exactly as `handleApi` does. */
function as<T>(who: OwnerId, fn: () => T): T {
  return runInRequest(() => {
    setRequestOwner(who);
    return fn();
  });
}

/** Wait for a job to stop moving. It fails offline, so this is quick. */
async function settle(id: string): Promise<Job> {
  for (let i = 0; i < 200; i++) {
    const job = await as(ALICE, () => getJob(id));
    if (job && job.status !== "queued" && job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} never settled`);
}

let alicesJob: Job;

/**
 * Rows first, article second.
 *
 * A job row's `draft_revision_id` is a foreign key into the revision the
 * article delete would be trying to cascade away, so the order is not
 * cosmetic — the same order tests/enqueue-owns-the-article.test.ts keeps.
 */
async function cleanUp(): Promise<void> {
  await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
  await getDb().delete(articles).where(eq(articles.slug, SLUG));
}

beforeAll(async () => {
  const db = getDb();
  await seedAuthUser(db, {
    id: ALICE,
    email: "owner-jobs-alice@spideryarn.local",
    onConflictDoNothing: true,
  });
  await seedAuthUser(db, {
    id: BOB,
    email: "owner-jobs-bob@spideryarn.local",
    onConflictDoNothing: true,
  });
  await cleanUp();
  /* **Alice's article, before Alice's job** — added 2026-09-05, when `enqueue`
     started refusing a bare-slug request for an article the reader does not have
     (src/jobs.ts). It has to be hers rather than the environment owner's, or the
     refusal fires on the very line this suite is built around. ./helpers/bare-article.ts. */
  await bareArticles([SLUG], ALICE);
  /* Queued as Alice, inside a request scope — which is the only way a job gets
     an owner, and the thing this suite is really about. */
  alicesJob = await as(ALICE, () => enqueue({ slug: SLUG, steps: ["fetch"] }));
  await settle(alicesJob.id);
}, 60_000);

afterAll(async () => {
  await cleanUp();
  await closeDb();
});

describe("a job Alice queued", () => {
  it("belongs to her", () => {
    expect(alicesJob.ownerId).toBe(ALICE);
  });

  /**
   * **The disclosure.** A job record is not a thin thing: it carries the slug,
   * the source URL, the uploaded filename, the reader's own guidance text and
   * the error message. It was also the index Bob needed before he could start
   * naming other people's slugs at the rest of the API.
   *
   * **Mutation.** `.where(eq(jobs.ownerId, owner))` deleted from
   * `pgJobStore.list` (src/store/pg-jobs.ts), leaving the `select` and its
   * `orderBy` — the one line that is now the whole of the isolation, and a line
   * the filesystem store did not have. Watched on 2026-09-04; the run printed
   * `2 failed | 8 passed (10)`, this case and *gets the environment's own jobs
   * and nobody else's*, both on `expected [ 'spya-dwxmfe' ] to not include
   * 'spya-dwxmfe'`.
   *
   * **Blind to.** `list` alone, and only its owner column. The other six
   * refusals below go through `get`, `cancelJob`, `retryJob`, `advanceJob` and
   * `forgetJob`, each with a `where` of its own that this deletion never
   * reaches, and each of them stayed green. Nor is the ordering touched: two
   * readers is enough to catch a `where` that has gone, and not enough to catch
   * one comparing the wrong column to a value that happens to differ.
   */
  it("is not in Bob's list", async () => {
    const bobs = await as(BOB, () => listJobs());
    expect(bobs.map((j) => j.id)).not.toContain(alicesJob.id);
  });

  it("is still in Alice's", async () => {
    const hers = await as(ALICE, () => listJobs());
    expect(hers.map((j) => j.id)).toContain(alicesJob.id);
  });

  /** `null`, exactly as for an id that does not exist — routes.ts makes it a 404. */
  it("is not readable by Bob, even knowing the id", async () => {
    expect(await as(BOB, () => getJob(alicesJob.id))).toBeNull();
    expect(await as(ALICE, () => getJob(alicesJob.id))).not.toBeNull();
  });

  it("cannot be cancelled by Bob", async () => {
    expect(await as(BOB, () => cancelJob(alicesJob.id))).toBeNull();
  });

  /** The expensive one: retry re-runs the pipeline, on Alice's article, at our cost. */
  it("cannot be retried by Bob", async () => {
    expect(await as(BOB, () => retryJob(alicesJob.id))).toBeNull();
  });

  it("cannot be advanced by Bob", async () => {
    expect(await as(BOB, () => advanceJob(alicesJob.id))).toBeNull();
  });

  it("cannot be deleted by Bob", async () => {
    expect(await as(BOB, () => forgetJob(alicesJob.id))).toBe(false);
    /* And it really is still there — a `false` from a function that deleted it
       anyway would pass the line above. */
    expect(await as(ALICE, () => getJob(alicesJob.id))).not.toBeNull();
  });
});

describe("outside a request", () => {
  /**
   * **The hole that used to be here closed on 2026-08-27, and it closed because
   * the thing it existed for went away.**
   *
   * `listJobs` used to return *everybody's* outside a request, on the grounds
   * that the housekeeping sweep is not a reader and has nobody to answer to: a
   * `prune()` that could only see its own jobs would pick the same doomed
   * records on every pass and delete none, silently, while the queue grew
   * without limit.
   *
   * That reasoning was sound and it was about `prune`. Retention is now
   * `trimFinished(owner, keep)` on the store, called with the *finishing job's*
   * own owner — so the sweep no longer needs to see anybody else's, and there
   * is nothing left that does. The rule is one rule: you get your own.
   *
   * Which is the better shape as well as the smaller one. "Is there a reader to
   * answer to" was a second question the store would have had to be taught, and
   * a store method that answers `undefined` for one caller and everything for
   * another is one forgotten argument away from being the disclosure this file
   * is about.
   */
  it("gets the environment's own jobs and nobody else's", async () => {
    const all = await listJobs();
    expect(all.map((j) => j.id)).not.toContain(alicesJob.id);
  });
});
