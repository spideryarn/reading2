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
 * ## Two of its three blocks are gone, and the hinge is why
 *
 * **The two that drove the real runner died on 2026-09-05**, in the hinge that
 * deleted `SPIDERYARN_STORE`
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § F) — and not because their subject went. Their subject is still here. What
 * went is the only route to it: they called `enqueue` and `getJob`, and
 * `src/jobs.ts` reached the filesystem queue **because the flag was unset**. It
 * binds `pgJobStore` now, so both cases asked a database that the unit lane
 * poisons, and no amount of moving them reaches `fsJobStore` again.
 *
 * They are enumerated rather than merely deleted, which is stage G's rule
 * arriving early:
 *
 * - **`leaves the marker behind when a step fails`** — a step that threw inside
 *   `advanceJob` leaves `beginStep`'s marker, and `stepIsDone` reads it and
 *   answers *not done*. `tests/store-artefacts-pg.test.ts` covers `interrupted`
 *   both ways round on `revision_step_runs.status`; **what nothing covers is the
 *   path through the real runner**, and the Postgres shape of that — a draft
 *   rolled back and a step run left `error` — is `tests/jobs.test.ts` § *running
 *   a job* to grow.
 * - **`writes a readable record, still, after all that`** — `writeOnce`'s
 *   temp-file-then-rename, asserted by the absence of `<id>.json.<pid>.<n>.tmp`.
 *   **Nothing covers this and nothing should**: there is no Postgres equivalent
 *   of a temp file; a transaction is what replaces it. It dies with
 *   `src/store/jobs-fs.ts` in stage G either way, and it died here first.
 *
 * - **`sweepStopped`** is about [`src/store/jobs-fs.ts`](../src/store/jobs-fs.ts)
 *   — the restart sweep that has no Postgres counterpart (Postgres has a lease
 *   instead, `settleExpired`). It survives, because it calls the function
 *   directly with a hand-made record and never goes near a store. **It dies in
 *   the same commit as its adapter**, which is stage G's `jobs` group.
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
 * ## It needs no database, and that is now true by construction
 *
 * Nothing left in it reaches a store: `sweepStopped` is handed a record, and the
 * `outputs` block is arithmetic over two path strings. It runs in the `unit`
 * project, where `DATABASE_URL` is poisoned, and stays there.
 */
import { describe, expect, it } from "vitest";

import { DEV_OWNER_ID } from "../src/owner.js";
import { contextPaths, STEP_ORDER, STEPS, stepIsDone } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { fsArtifacts } from "../src/store/artifacts-fs.js";
import { sweepStopped } from "../src/store/jobs-fs.js";
import type { Job, JobStep, StepName } from "../src/types.js";

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
