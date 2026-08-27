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
 * The ownership work had gone straight past both, because both are *outside the
 * store*: jobs are JSON under `data/_jobs/` and never touch Postgres, and
 * `sendSource` reads the filesystem directly. `ownedSlug()` guards every path
 * from a slug to an article, and neither of these was one.
 *
 * ## Why this suite needs no database
 *
 * Jobs never reach Postgres. The queue is a filesystem directory and an
 * in-memory map, so this runs everywhere `npm test` does — unlike the Postgres
 * half of tests/owner-isolation.test.ts, which skips without a database. That
 * is worth having for the finding whose consequence is somebody else's model
 * spend.
 *
 * A `fetch` step on a slug with no source URL fails immediately and offline,
 * which is how a job gets queued here without buying anything.
 */
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

const JOBS_DIR = path.resolve(import.meta.dirname, "..", "data", "_jobs");
const ROOT_DATA = path.resolve(import.meta.dirname, "..", "data");

/** Its own slug, so nothing here collides with another suite's fixtures. */
const SLUG = "test-owner-jobs";

const ALICE = "00000000-0000-4000-8000-0000000000a7" as OwnerId;
const BOB = "00000000-0000-4000-8000-0000000000a8" as OwnerId;

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

async function cleanUp(): Promise<void> {
  for (const file of await readdir(JOBS_DIR).catch(() => [])) {
    const full = path.join(JOBS_DIR, file);
    const record = JSON.parse(await readFile(full, "utf8").catch(() => "{}")) as Partial<Job>;
    if (record.slug === SLUG) await rm(full, { force: true });
  }
  await rm(path.join(ROOT_DATA, SLUG), { recursive: true, force: true });
}

beforeAll(async () => {
  await cleanUp();
  /* Queued as Alice, inside a request scope — which is the only way a job gets
     an owner, and the thing this suite is really about. */
  alicesJob = await as(ALICE, () => enqueue({ slug: SLUG, steps: ["fetch"] }));
  await settle(alicesJob.id);
}, 30_000);

afterAll(cleanUp);

describe("a job Alice queued", () => {
  it("belongs to her", () => {
    expect(alicesJob.ownerId).toBe(ALICE);
  });

  /**
   * **The disclosure.** A job record is not a thin thing: it carries the slug,
   * the source URL, the uploaded filename, the reader's own guidance text and
   * the error message. It was also the index Bob needed before he could start
   * naming other people's slugs at the rest of the API.
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
   * records on every pass and delete none, silently, while `data/_jobs/` grew
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
