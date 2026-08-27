/**
 * **What only happens when `data/_jobs/` is read back**, which is once per
 * process and therefore easy to lose.
 *
 * Two behaviours live in the loader and nowhere else, and both were found
 * missing by GPT Sol reviewing the queue's move behind `JobStore` on
 * 2026-08-27. Neither fails loudly:
 *
 * - **A job written before jobs had owners** gets stamped with this
 *   installation's owner. Without it, every read and list filters on an exact
 *   `ownerId` and the record is invisible to everybody. There were 34 such
 *   files in this repo's `data/_jobs/` at the time.
 * - **A job's work key comes back with it.** Without it an active job that
 *   survived a restart cannot recognise its own repeat request, so an identical
 *   enqueue is told this is *different* work — and for a URL, whose slug cannot
 *   legitimately be reallocated, that ends in a 409 for a request that should
 *   have been handed the running job.
 *
 * Both are checked by writing a file and reloading, which is the only honest
 * way to exercise a function that runs at cold start.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { environmentOwnerId } from "../src/owner.js";
import { fsJobStore, reloadForTests } from "../src/store/jobs-fs.js";
import type { Job, JobStep } from "../src/types.js";

const JOBS_DIR = path.resolve(import.meta.dirname, "..", "data", "_jobs");

/** Its own ids, so nothing here collides with another suite's records. */
const LEGACY = "spya-fsload1";
const KEYED = "spya-fsload2";

const steps: JobStep[] = [{ name: "fetch", label: "Fetching the page", status: "done" }];

function record(id: string): Omit<Job, "ownerId"> {
  return {
    id,
    slug: `test-fsload-${id}`,
    steps,
    status: "done",
    createdAt: "2026-08-01T10:00:00.000Z",
    finishedAt: "2026-08-01T10:01:00.000Z",
  };
}

beforeAll(async () => {
  await mkdir(JOBS_DIR, { recursive: true });
  // No `ownerId` at all — exactly the shape on disk from before 2026-08-27.
  await writeFile(
    path.join(JOBS_DIR, `${LEGACY}.json`),
    `${JSON.stringify(record(LEGACY), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(JOBS_DIR, `${KEYED}.json`),
    /* `queued`, not `done`: the case this is about is a job that was **active**
       when the process stopped, which is the only kind whose key anybody asks
       about. A terminal job holds no slug and would never be offered one. */
    `${JSON.stringify({ ...record(KEYED), status: "queued", finishedAt: undefined, ownerId: environmentOwnerId(), workKey: "k-abc" }, null, 2)}\n`,
    "utf8",
  );
  await reloadForTests();
});

afterAll(async () => {
  await rm(path.join(JOBS_DIR, `${LEGACY}.json`), { force: true });
  await rm(path.join(JOBS_DIR, `${KEYED}.json`), { force: true });
  await rm(path.join(JOBS_DIR, "spya-fsload3.json"), { force: true });
  await reloadForTests();
});

describe("reading the job directory back", () => {
  it("gives an ownerless record to this installation rather than to nobody", async () => {
    const job = await fsJobStore.get(LEGACY, environmentOwnerId());
    expect(job?.id).toBe(LEGACY);
    expect(job?.ownerId).toBe(environmentOwnerId());
    // And it is in the list, which is what the homepage reads.
    expect((await fsJobStore.list(environmentOwnerId())).map((j) => j.id)).toContain(LEGACY);
  });

  it("brings a job's work key back with it", async () => {
    /* Asked the way `enqueue` asks: offer a job for the same slug carrying the
       same key, and the store should say "already doing this" rather than
       "different work". Before the key was persisted this answered `false`, and
       `enqueue` had no way to make progress from there. */
    const same = await fsJobStore.enqueueOrGet(
      { ...record("spya-fsload3"), ownerId: environmentOwnerId(), slug: `test-fsload-${KEYED}` },
      "k-abc",
    );
    expect(same.created).toBe(false);
    expect(same.sameWork).toBe(true);
    expect(same.job.id).toBe(KEYED);
  });

  it("writes the key back out beside the job, not inside it", async () => {
    /* `workKey` must not be on `Job` — `publicJob` would have to strip it, and
       it is derived from the request rather than from the record. So it rides
       as a sibling key in the same document, which is what makes it land in the
       same atomic rename. */
    const on = JSON.parse(await readFile(path.join(JOBS_DIR, `${KEYED}.json`), "utf8")) as {
      workKey?: string;
      id: string;
    };
    expect(on.workKey).toBe("k-abc");
    const job = await fsJobStore.get(KEYED, environmentOwnerId());
    expect(job && "workKey" in job).toBe(false);
  });
});
