/**
 * **The filesystem adapter's own behaviour, taken out of `tests/jobs.test.ts`.**
 *
 * These twelve cases were in that file until 2026-09-04, when stage B of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * moved the queue's tests onto Postgres. They did not move with it, because
 * their **subject** is the filesystem store rather than the queue: a
 * conversion would either have had to keep `jobs.test.ts` able to reach the
 * filesystem adapter — which is the thing being converted away — or delete
 * them, which is the uncovered interval stage G's *"delete a
 * filesystem-adapter suite in the same commit as its subject"* rule exists to
 * prevent. The registry classifies whole files, so one file could not carry
 * both verdicts. Hence two files.
 *
 * ## This file dies in stage G, and it has **two** subjects, not one
 *
 * They die at different moments, so whoever deletes half of it should not
 * delete the other half by accident:
 *
 * - **`sweepStopped`**, **`writes a readable record, still, after all that`**
 *   and **`leaves the marker behind when a step fails`** are about
 *   [`src/store/jobs-fs.ts`](../src/store/jobs-fs.ts) and
 *   [`src/store/artifacts-fs.ts`](../src/store/artifacts-fs.ts): the restart
 *   sweep that has no Postgres counterpart (Postgres has a lease instead —
 *   `settleExpired`), the write-to-a-temp-file-then-rename mechanism, asserted
 *   by the absence of `<id>.json.<pid>.<n>.tmp` afterwards, and the
 *   begun-and-never-finished marker file. **They die in the same commit as
 *   their adapter**, which is stage G's `jobs` group and then `artifacts-fs.ts`.
 * - **`what a step counts as done`** looks like a test of `STEPS[…].outputs`
 *   and is really a test of **`StepContext.dir` and `StepContext.htmlFile`** —
 *   the `step-context-paths` mechanism the store registry names
 *   ([store-migration-registry.ts](store-migration-registry.ts) § the five
 *   mechanisms). Every assertion in it is about a *path*: how many files a step
 *   writes, that `blocks` checks the copy beside the HTML rather than the one
 *   in `data/`, that the stamped HTML is among its outputs. `runStep` computes
 *   `contextPaths(job.slug)` unconditionally under either store, so these
 *   fields outlive `jobs-fs.ts`. **Whoever removes `StepContext.dir` /
 *   `htmlFile` is the one who deletes this block** — not whoever deletes the
 *   filesystem job store. Left un-said, it would stand orphaned after stage G's
 *   `jobs` group and read as coverage of something that no longer exists.
 *
 * The one thing to port rather than drop, when the second of those happens: a
 * step must declare **every** artefact it writes, or a crash between two writes
 * leaves a step reporting itself finished with half its output. In Postgres
 * that claim belongs to `produces`, and `tests/store-artefacts-pg.test.ts` is
 * where it would go.
 *
 * ## What already covers the Postgres side of each, checked rather than assumed
 *
 * Named here so that stage G's *"port or enumerate every surviving assertion"*
 * has somewhere to start rather than a blank page.
 *
 * - `sweepStopped` — `tests/store-jobs-parity.test.ts` § *the Postgres answer to
 *   `sweepStopped`*, which is `settleExpired` over a lapsed lease, plus its
 *   cancelled-rather-than-interrupted case.
 * - the interrupted marker — `tests/store-artefacts-pg.test.ts` covers
 *   `interrupted` both ways round (`revision_step_runs.status = 'running'`), and
 *   separately that a step which ended in `error` is *not* interrupted but is
 *   also not done.
 * - `writeOnce`'s rename — **nothing, and nothing should.** There is no Postgres
 *   equivalent of a temp file; a transaction is what replaces it.
 *
 * **What none of those has is the path through the real runner**, which is what
 * `leaves the marker behind` uniquely gave: a step that threw inside
 * `advanceJob`, rather than a store method called directly. The Postgres shape
 * of that is a draft rolled back and a step run left `error`, and it is
 * `tests/jobs.test.ts` § *running a job* that would have to grow it.
 *
 * ## It stays on the filesystem store, deliberately
 *
 * No `SPIDERYARN_STORE` pin, no lane in `TEST_LANES` — so it runs in the `unit`
 * project, where `DATABASE_URL` is poisoned. That is the point: the code under
 * test here is the filesystem adapter, and a database would only obscure it.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { enqueue, forgetJob, getJob } from "../src/jobs.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { contextPaths, STEP_ORDER, STEPS, stepIsDone } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { fsArtifacts } from "../src/store/artifacts-fs.js";
import { sweepStopped } from "../src/store/jobs-fs.js";
import type { Job, JobStep, StepName } from "../src/types.js";
import { jobFilesOnDisk } from "./helpers/job-files.js";

const ROOT_DATA = path.resolve(import.meta.dirname, "..", "data");
const JOBS_DIR = path.join(ROOT_DATA, "_jobs");

/** A step in whatever state a case needs, for the record-shaped tests below. */
function step(name: StepName, status: JobStep["status"]): JobStep {
  return { name, label: STEPS[name].label, status };
}

/** A job record, made rather than queued — `sweepStopped` only reads one. */
function job(status: Job["status"], steps: JobStep[]): Job {
  return {
    id: "spya-testjb",
    slug: "a-slug",
    ownerId: DEV_OWNER_ID,
    steps,
    status,
    createdAt: "2026-08-25T10:00:00.000Z",
  };
}

/**
 * Its own slug, no longer shared with `tests/jobs.test.ts`.
 *
 * That file used one slug for six cases; this one is the only case left that
 * queues anything, so it gets a name nothing else writes under — which also
 * means the two files can run in the same worker without one's `afterAll`
 * tidying the other's records away mid-test.
 */
const SLUG = "test-jobs-fs-adapter-no-such-article";

/* Remove only this file's records. `data/_jobs/` is a real directory a reader
   may have jobs in — the test must not tidy away theirs. */
afterAll(async () => {
  for (const { path: full, record } of await jobFilesOnDisk()) {
    if (record.slug === SLUG) await rm(full, { force: true });
  }
  /* And the run marker the failed job left behind. Not tidiness: `beginStep`
     does a `mkdir` before the stage runs, so a job that fails on its first step
     still leaves `data/<slug>/steps/` behind, and a marker surviving into the
     next run would make the fixture's `fetch` not-done for a reason that has
     nothing to do with what is being tested. */
  await rm(path.join(ROOT_DATA, SLUG), { recursive: true, force: true });
});

/** Poll until the job stops moving, or give up. */
async function settle(id: string): Promise<Job> {
  for (let i = 0; i < 60; i++) {
    const job = await getJob(id);
    if (job && job.status !== "queued" && job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job never finished");
}

describe("what a step counts as done", () => {
  // Mirrors the real split: the data directory and the `output/` HTML are
  // siblings, not nested. `contextPaths` is what the runner actually uses.
  /* Annotated rather than inferred, so that the next required field added to
     StepContext lands as one error here — at the thing that is actually
     incomplete — instead of as nine identical errors at the call sites. That
     is how `cacheArticle` arrived: nine copies of the same complaint, none of
     them next to the object that was missing it. */
  const ctx: StepContext = {
    ...contextPaths("nothing-here"),
    slug: "nothing-here",
    report: () => {},
    signal: new AbortController().signal,
    // Nothing here sends the article anywhere, so there is no prefix to pay for.
    cacheArticle: false,
  };

  it("lists every file a step writes, not just the first", () => {
    // `extract` writes the HTML and meta.json; `hierarchy` writes tree.json,
    // labels.json and its copy of blocks.json. Checking only one would let a
    // crash between the writes leave a step reporting itself finished with half
    // its output — and the stage after it would then consume the missing half.
    //
    // `hierarchy` went from two files to three when the nav labels became a second
    // model pass (docs/plans/260826h-toc-scaling.md). A tree with no labels.json beside
    // it is a half-run step, not a finished one, which is also why src/hierarchy.ts
    // writes tree.json last of the three.
    expect(STEPS.extract.outputs(ctx)).toHaveLength(2);
    expect(STEPS.hierarchy.outputs(ctx)).toHaveLength(3);
    expect(STEPS.extract.outputs(ctx).some((f) => f.endsWith("meta.json"))).toBe(true);
    expect(STEPS.hierarchy.outputs(ctx).some((f) => f.endsWith("blocks.json"))).toBe(true);
    expect(STEPS.hierarchy.outputs(ctx).some((f) => f.endsWith("labels.json"))).toBe(true);
  });

  it("checks its own artefact, not the copy a later stage makes", () => {
    // Stage 3 writes beside the HTML; stage 4 copies into data/. Checking the
    // data copy here would mean a finished `blocks` step reporting itself
    // unfinished until `hierarchy` had also run.
    expect(STEPS.blocks.outputs(ctx)).toContain(ctx.htmlFile.replace(/\.html$/, ".blocks.json"));
    expect(STEPS.blocks.outputs(ctx).some((f) => f.startsWith(ctx.dir))).toBe(false);
  });

  it("counts the HTML among what `blocks` writes, because it writes the ids into it", () => {
    // Stage 3 stamps the ids back into the HTML — that is what makes
    // `#spya-k3m9qt` an anchor with no JavaScript. Listing only the JSON would
    // let a blocks-only job find its JSON, skip, and leave the HTML without
    // the ids the JSON claims are in it.
    expect(STEPS.blocks.outputs(ctx)).toContain(ctx.htmlFile);
  });

  it("is not done when none of its files are there", async () => {
    for (const name of STEP_ORDER) {
      expect(await stepIsDone(STEPS[name], ctx, fsArtifacts)).toBe(false);
    }
  });
});

describe("the record the filesystem queue leaves behind", () => {
  /**
   * The job queued here cannot succeed — there is no URL for this slug, so
   * `fetch` throws before it reaches the network — which makes it safe: nothing
   * is fetched and no model is called. What it exercises is `writeOnce`'s
   * temp-file-and-rename, which is where the only bug that ever reached a
   * running server lived: two overlapping writes for one job, which took the
   * dev server down with an unhandled rejection.
   */
  /**
   * The marker, through the real runner rather than through the store on its
   * own.
   *
   * A step that threw did not finish, and the next run must re-run it rather
   * than believe whatever half of its output landed. `fetch` here fails for a
   * reason that has nothing to do with the marker — the fixture has no source
   * URL — which is what makes it a fair test of the failure path.
   */
  it("leaves the marker behind when a step fails, so the step is not done", async () => {
    const job = await enqueue({ slug: SLUG, steps: ["fetch"] });
    expect((await settle(job.id)).status).toBe("error");
    expect(await fsArtifacts.interrupted(SLUG, "fetch")).toBe(true);

    // And it is what `stepIsDone` reads, not merely a file sitting there.
    const at = contextPaths(SLUG);
    const ctx = { ...at, slug: SLUG, report: () => undefined, signal: new AbortController().signal, cacheArticle: false };
    expect(await stepIsDone(STEPS.fetch, ctx, fsArtifacts)).toBe(false);

    /* Removed with `rm`, not with `finishStep`. The marker belongs to the
       runner's attempt and the test never saw that token — which is the point
       of the token, and is also why a test that leaves one behind has to clean
       up by hand. A stray marker here would make the *next* run of this suite
       start from a slug whose `fetch` is already not-done for the wrong
       reason. */
    await rm(path.join(ROOT_DATA, SLUG, "steps"), { recursive: true, force: true });
    expect(await fsArtifacts.interrupted(SLUG, "fetch")).toBe(false);
    // Cleared again in `afterAll` as well as here: every job this suite runs
    // fails, so every one of them leaves a marker, not only this test's.
  });

  it("writes a readable record, still, after all that", async () => {
    const job = await enqueue({ slug: SLUG, steps: ["fetch"] });
    try {
      await settle(job.id);
      const files = await readdir(JOBS_DIR);
      expect(files).toContain(`${job.id}.json`);
      /* No temp file left behind: a stray `.tmp` is a write that never renamed.
         **This job's own**, rather than every `.tmp` in the directory, because
         `data/_jobs/` is shared with every other suite in the run and several of
         them are writing to it from other workers at this moment — a write in
         flight elsewhere is not a write that failed here, and asserting over the
         whole directory made this red at random (seen 2026-09-01, on a temp file
         belonging to tests/retry-is-only-for-a-failed-job.test.ts). The name is
         `<id>.json.<pid>.<n>.tmp`, so the prefix is the job.

         **And waited for rather than read once**, which is the half the prefix
         did not fix. `settle` above polls `getJob`, and terminal status lands in
         the live map *before* its `persist` completes — `forgetJob` in
         src/jobs.ts says so, and builds its own tombstone around the same gap. So
         a single `readdir` here can catch this job's own write mid-rename and
         call it a leak. Under load it did (2026-09-01). A bounded wait is the
         honest reading: the file must be gone soon, not instantly. */
      const strays = async () =>
        (await readdir(JOBS_DIR)).filter((f) => f.startsWith(job.id) && f.endsWith(".tmp"));
      for (let i = 0; i < 40 && (await strays()).length; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(await strays()).toEqual([]);
    } finally {
      await forgetJob(job.id).catch(() => undefined);
    }
  });
});

describe("sweepStopped", () => {
  /* Its job changed on 2026-08-26 and these tests changed with it. It used to
     mark an interrupted job `error` — which was right while one long-lived
     process was the only thing that could run a job, and became wrong the
     moment `advanceJob` could pick one back up. A closed tab is a pause, not a
     failure. See docs/plans/260826s-ingest-resume.md § 2. */

  it("leaves a job the server died under waiting, not failed", () => {
    const j = job("running", [
      step("fetch", "done"),
      step("extract", "done"),
      step("blocks", "running"),
      step("hierarchy", "pending"),
    ]);
    expect(sweepStopped(j)).toBe(true);
    expect(j.status).toBe("queued");
    // No error, and nothing saying it ended — because it has not.
    expect(j.error).toBeUndefined();
    expect(j.finishedAt).toBeUndefined();
  });

  it("puts the interrupted step back to pending, so resuming runs it again", () => {
    // It did not fail; it did not happen. `error` on that row put a red line
    // and a Retry button in front of a reader whose ingest was fine.
    const j = job("running", [
      step("fetch", "done"),
      step("extract", "done"),
      step("blocks", "running"),
      step("hierarchy", "pending"),
    ]);
    sweepStopped(j);
    expect(j.steps.map((s) => s.status)).toEqual(["done", "done", "pending", "pending"]);
    expect(j.steps[2]?.error).toBeUndefined();
  });

  it("leaves the finished steps finished, so resuming skips them", () => {
    // The half that makes it worth doing at all — though the record is a
    // convenience here rather than the authority. What actually decides is
    // `stepIsDone` over the artefacts; see `advanceJob`.
    const j = job("running", [step("fetch", "done"), step("extract", "running")]);
    sweepStopped(j);
    expect(j.steps[0]?.status).toBe("done");
  });

  it("says nothing changed about a job that was already merely queued", () => {
    // `queued` is already the right answer for it, so there is nothing to write.
    const j = job("queued", [step("fetch", "pending")]);
    expect(sweepStopped(j)).toBe(false);
    expect(j.status).toBe("queued");
  });

  it("finishes the cancel the dead process never delivered", () => {
    /* Stop had been pressed and the abort had not landed. Nothing is going to
       deliver it now, and resuming a job somebody stopped would be the one
       interruption they actually noticed. */
    const j: Job = { ...job("running", [step("fetch", "running")]), cancelling: true };
    expect(sweepStopped(j)).toBe(true);
    expect(j.status).toBe("cancelled");
    expect(j.cancelling).toBeUndefined();
    expect(j.finishedAt).toBeTypeOf("string");
  });

  it("leaves a job that already finished exactly as it was", () => {
    for (const status of ["done", "error", "cancelled"] as const) {
      const j = job(status, [step("fetch", "done")]);
      const before = JSON.stringify(j);
      expect(sweepStopped(j)).toBe(false);
      expect(JSON.stringify(j)).toBe(before);
    }
  });
});
