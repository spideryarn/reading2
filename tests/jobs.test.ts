/**
 * The ingest queue's decisions — src/jobs.ts, src/pipeline.ts, src/routes.ts.
 *
 * Almost nothing here runs a job. Queuing one fetches somebody's website and
 * spends money at two model endpoints, so what is mostly tested is everything
 * that decides *whether* and *in what order* that happens, plus the request
 * parsing that stands between the browser and the filesystem.
 *
 * The exception is at the bottom: it queues a job whose first step cannot reach
 * the network, and exercises the write path around it. That path is where the
 * only bug that ever reached a running server lived — two overlapping writes
 * for one job, which took the dev server down with an unhandled rejection.
 *
 * See docs/project/ingest-queue.md, and docs/project/testing.md for why the
 * line is drawn here.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  cascadeForce,
  enqueue,
  forceForRetry,
  getJob,
  orderSteps,
  STOPPED,
  sweepStopped,
} from "../src/jobs.js";
import {
  contextPaths,
  DEFAULT_INGEST_STEPS,
  FORCE_ONLY_WHEN_NAMED,
  isStepName,
  STEP_ORDER,
  STEPS,
  stepIsDone,
} from "../src/pipeline.js";
import { parseJobRequest } from "../src/routes.js";
import type { Job, JobStep, StepName } from "../src/types.js";

function step(name: StepName, status: JobStep["status"]): JobStep {
  return { name, label: STEPS[name].label, status };
}

function job(status: Job["status"], steps: JobStep[]): Job {
  return {
    id: "spya-testjb",
    slug: "a-slug",
    steps,
    status,
    createdAt: "2026-08-25T10:00:00.000Z",
  };
}

describe("the pipeline", () => {
  it("has a step for every name in STEP_ORDER, and no others", () => {
    expect(STEP_ORDER).toEqual(Object.keys(STEPS));
  });

  it("names each step in the present tense rather than counting them", () => {
    // The label is what the reader watches. "Extracting the article" says what
    // is slow and what is about to fail; "Step 3 of 5" says neither. See
    // docs/project/ingest-queue.md#naming-the-step-is-the-point.
    for (const name of STEP_ORDER) {
      expect(STEPS[name].label).toMatch(/^[A-Z]\w+ing /);
      expect(STEPS[name].name).toBe(name);
    }
  });

  it("recognises only real step names", () => {
    expect(isStepName("toc")).toBe(true);
    expect(isStepName("summarise")).toBe(false);
    expect(isStepName("")).toBe(false);
    expect(isStepName(null)).toBe(false);
    // Not a step name, but it IS a property of every object.
    expect(isStepName("constructor")).toBe(false);
    expect(isStepName("toString")).toBe(false);
  });

  it("accepts `tweets` as a step name, so the button can ask for one", () => {
    // Missing from STEP_ORDER, this is rejected as a bad name and
    // POST /api/jobs { steps: ["tweets"] } never works — see
    // docs/plans/tweet-thread-page.md#the-one-real-snag-stated-precisely.
    expect(isStepName("tweets")).toBe(true);
    expect(STEP_ORDER).toContain("tweets");
  });

  it("leaves `tweets` out of what a bare add runs", () => {
    // The half of the split that costs money if it's wrong: every article ever
    // added would write a thread nobody asked for. DEFAULT_INGEST_STEPS exists for
    // exactly this, and it must stay a strict subset of the order.
    expect(DEFAULT_INGEST_STEPS).not.toContain("tweets");
    for (const name of DEFAULT_INGEST_STEPS) expect(STEP_ORDER).toContain(name);
  });

  it("sorts `tweets` after the steps it reads", () => {
    // Order is about running, not about forcing — `tweets` is exempt from the
    // force-cascade (below) but it still has to run after the stages whose
    // artefacts it reads, which are `blocks` and `toc`. A name missing from
    // STEP_ORDER sorts to the FRONT, because `indexOf` gives it -1, so
    // `{ steps: ["toc", "tweets"] }` would have written the thread from the
    // previous tree and then replaced that tree.
    expect(orderSteps(["tweets", "toc", "blocks"])).toEqual(["blocks", "toc", "tweets"]);
  });
});

describe("orderSteps", () => {
  it("sorts into pipeline order whatever order they arrived in", () => {
    // The steps are a chain: each consumes what the one before it wrote. Run
    // ["arc", "toc"] as asked and the arc is built from the previous tree,
    // which is then replaced — two successes and an arc describing an article
    // nobody is reading.
    expect(orderSteps(["arc", "toc", "fetch"])).toEqual(["fetch", "toc", "arc"]);
  });

  it("de-duplicates", () => {
    expect(orderSteps(["toc", "toc", "toc"])).toEqual(["toc"]);
  });

  it("leaves an already-ordered list alone", () => {
    expect(orderSteps([...STEP_ORDER])).toEqual(STEP_ORDER);
  });
});

describe("cascadeForce", () => {
  it("forces every step after the first forced one", () => {
    // The bug this exists to prevent: "refresh from source" forces fetch and
    // extract, the three stages after them find their files still on disk and
    // skip, and you get a fresh article under last week's tree — with five
    // green ticks over it. See docs/reusable/silent-success.md.
    expect([...cascadeForce([...STEP_ORDER], new Set(["fetch"]))]).toEqual([
      "fetch",
      "extract",
      "blocks",
      "toc",
      "arc",
    ]);
  });

  it("starts the cascade at the earliest forced step, not the one named last", () => {
    expect([...cascadeForce([...STEP_ORDER], new Set(["arc", "blocks"]))]).toEqual([
      "blocks",
      "toc",
      "arc",
    ]);
  });

  it("forces nothing when nothing was asked for", () => {
    expect([...cascadeForce([...STEP_ORDER], new Set())]).toEqual([]);
  });

  it("cascades within the job's own steps, not the whole pipeline", () => {
    // A job of {toc, arc} that forces toc must force arc, and must not invent
    // a fetch step nobody asked for.
    expect([...cascadeForce(["toc", "arc"], new Set(["toc"]))]).toEqual(["toc", "arc"]);
  });

  it("ignores a forced step the job isn't running", () => {
    expect([...cascadeForce(["toc", "arc"], new Set(["fetch"]))]).toEqual([]);
  });

  it("does not sweep `tweets` in by position", () => {
    // The cascade encodes "each step eats what the one before it wrote", and
    // `tweets` is not in that chain — it reads the blocks and the tree, the
    // same inputs the arc reads, and nothing reads what it writes. Swept in by
    // position, forcing the arc would buy a second model call for a thread
    // whose inputs never moved. See FORCE_ONLY_WHEN_NAMED in src/pipeline.ts.
    expect(FORCE_ONLY_WHEN_NAMED.has("tweets")).toBe(true);
    expect([...cascadeForce([...STEP_ORDER], new Set(["arc"]))]).toEqual(["arc"]);
    expect([...cascadeForce(["toc", "arc", "tweets"], new Set(["toc"]))]).toEqual(["toc", "arc"]);
  });

  it("still forces `tweets` when it is named", () => {
    // Exempt from the cascade is not exempt from `force`. This is the rewrite
    // button: the thread looks current and you want a different one anyway.
    expect([...cascadeForce(["tweets"], new Set(["tweets"]))]).toEqual(["tweets"]);
    expect([...cascadeForce([...STEP_ORDER], new Set(["toc", "tweets"]))]).toEqual([
      "toc",
      "arc",
      "tweets",
    ]);
  });

  it("keeps `arc` in the cascade, because it cannot check itself", () => {
    // The asymmetry is the point, and it is not about branching. `tweets` can
    // leave the cascade because its `isDone` compares a sourceHash and will
    // re-run on its own when the article moves. `arc` has no such check, so
    // its position is the only signal there is that it has gone stale.
    expect(FORCE_ONLY_WHEN_NAMED.has("arc")).toBe(false);
    expect([...cascadeForce([...STEP_ORDER], new Set(["toc"]))]).toEqual(["toc", "arc"]);
  });
});

describe("forceForRetry", () => {
  const forced = (name: StepName, status: JobStep["status"]): JobStep => ({
    ...step(name, status),
    force: true,
  });

  it("forces nothing after an ordinary failure", () => {
    // The steps that succeeded are still good. Skipping them is what Retry is.
    expect(
      forceForRetry([step("fetch", "done"), step("extract", "done"), step("blocks", "error")]),
    ).toEqual([]);
  });

  it("does not make a retry re-do the stages a refresh already redid", () => {
    // A refresh forces all five. Copying those flags across meant Retry
    // re-fetched, re-extracted and re-split an article whose first three
    // stages had just succeeded — and paid for the model call again.
    expect(
      forceForRetry([
        forced("fetch", "done"),
        forced("extract", "done"),
        forced("blocks", "done"),
        forced("toc", "error"),
        forced("arc", "pending"),
      ]),
    ).toEqual(["toc"]);
  });

  it("forces from the front when a forced job failed at its first step", () => {
    expect(forceForRetry([forced("fetch", "error"), forced("extract", "pending")])).toEqual([
      "fetch",
    ]);
  });

  it("forces nothing when every step finished", () => {
    expect(forceForRetry([forced("fetch", "done"), forced("extract", "skipped")])).toEqual([]);
  });
});

describe("what a step counts as done", () => {
  // Mirrors the real split: the data directory and the `output/` HTML are
  // siblings, not nested. `contextPaths` is what the runner actually uses.
  const ctx = {
    ...contextPaths("nothing-here"),
    slug: "nothing-here",
    report: () => {},
    signal: new AbortController().signal,
  };

  it("lists every file a step writes, not just the first", () => {
    // `extract` writes the HTML and meta.json; `toc` writes tree.json and its
    // copy of blocks.json. Checking only one would let a crash between the two
    // writes leave a step reporting itself finished with half its output — and
    // the stage after it would then consume the missing half.
    expect(STEPS.extract.outputs(ctx)).toHaveLength(2);
    expect(STEPS.toc.outputs(ctx)).toHaveLength(2);
    expect(STEPS.extract.outputs(ctx).some((f) => f.endsWith("meta.json"))).toBe(true);
    expect(STEPS.toc.outputs(ctx).some((f) => f.endsWith("blocks.json"))).toBe(true);
  });

  it("checks its own artefact, not the copy a later stage makes", () => {
    // Stage 3 writes beside the HTML; stage 4 copies into data/. Checking the
    // data copy here would mean a finished `blocks` step reporting itself
    // unfinished until `toc` had also run.
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
      expect(await stepIsDone(STEPS[name], ctx)).toBe(false);
    }
  });
});

describe("sweepStopped", () => {
  it("turns a job the server died under into a visible error", () => {
    const j = job("running", [
      step("fetch", "done"),
      step("extract", "done"),
      step("blocks", "running"),
      step("toc", "pending"),
    ]);
    expect(sweepStopped(j)).toBe(true);
    expect(j.status).toBe("error");
    expect(j.error).toBe(STOPPED);
    expect(j.finishedAt).toBeTypeOf("string");
  });

  it("leaves the finished steps finished, so a retry can skip them", () => {
    // This is the half that makes it worth doing at all: the record of which
    // stages succeeded is what turns Retry into "pick up where it stopped"
    // rather than "spend the two model calls again".
    const j = job("running", [
      step("fetch", "done"),
      step("extract", "done"),
      step("blocks", "running"),
      step("toc", "pending"),
    ]);
    sweepStopped(j);
    expect(j.steps.map((s) => s.status)).toEqual(["done", "done", "error", "pending"]);
    expect(j.steps[2]?.error).toBe(STOPPED);
  });

  it("sweeps a job that never started, not just a running one", () => {
    // `queued` is the same orphan: this process has just started and its queue
    // is empty, so nothing on disk can have work coming.
    const j = job("queued", [step("fetch", "pending")]);
    expect(sweepStopped(j)).toBe(true);
    expect(j.status).toBe("error");
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

describe("parseJobRequest", () => {
  it("derives the slug from the URL rather than trusting one", () => {
    const parsed = parseJobRequest({ url: "https://www.noemamag.com/the-mythology-of-conscious-ai/" });
    expect(parsed.slug).toBe("the-mythology-of-conscious-ai");
    expect(parsed.url).toBe("https://www.noemamag.com/the-mythology-of-conscious-ai/");
    expect(parsed.steps).toBeUndefined(); // absent means "all of them"
  });

  it("refuses a slug that could climb out of data/", () => {
    // The slug is joined onto data/ and output/. This is the check that stands
    // between a POST body and the filesystem — see
    // docs/project/ingest-queue.md#the-one-security-check.
    expect(() => parseJobRequest({ slug: "../../.ssh" })).toThrow(/Expected/);
    expect(() => parseJobRequest({ url: "https://x.test/a", slug: "../escape" })).toThrow(
      /not both/,
    );
  });

  it("refuses a url and a slug together", () => {
    // This combination used to point a full refresh at an article you already
    // had, from a request that looked like an ordinary add — and the slug was
    // path-safe, so nothing complained.
    expect(() =>
      parseJobRequest({
        url: "https://a.example/x",
        slug: "an-article-i-already-have",
        force: ["fetch"],
      }),
    ).toThrow(/not both/);
  });

  it("refuses a URL nothing could be made of", () => {
    expect(() => parseJobRequest({ url: "not a url" })).toThrow(/Could not make a slug/);
  });

  it("refuses a body that is neither shape", () => {
    expect(() => parseJobRequest({})).toThrow(/Expected \{ url \} or \{ slug \}/);
    expect(() => parseJobRequest(null)).toThrow(/Expected/);
    expect(() => parseJobRequest({ slug: 42 })).toThrow(/Expected/);
  });

  it("takes steps and force on an article we already have", () => {
    const parsed = parseJobRequest({ slug: "some-article", steps: ["arc"], force: ["arc"] });
    expect(parsed).toEqual({ slug: "some-article", steps: ["arc"], force: ["arc"] });
  });

  it("refuses a step name it doesn't know", () => {
    // Left unchecked this reaches `STEPS[name]` as undefined and fails deep in
    // the runner, where the message is about a property of undefined rather
    // than about the request that caused it.
    expect(() => parseJobRequest({ slug: "a", steps: ["summarise"] })).toThrow(/steps must be/);
    expect(() => parseJobRequest({ slug: "a", steps: "toc" })).toThrow(/steps must be/);
    expect(() => parseJobRequest({ slug: "a", force: ["nope"] })).toThrow(/force must be/);
  });

  it("carries the status a bad request should be reported as", () => {
    // Without this the router's fallback calls it a 500, and a typo in a step
    // name reads as a server fault.
    try {
      parseJobRequest({});
      expect.unreachable();
    } catch (err) {
      expect((err as { status?: number }).status).toBe(400);
    }
  });
});

/* ---------------------------------------------------------------------------
   The one test that runs the queue for real.

   It queues a step that cannot succeed — there is no URL for this slug, so
   `fetch` throws before it reaches the network — which makes it safe: nothing
   is fetched and no model is called. What it exercises is the machinery around
   the step, and specifically the write path, which is where the only bug that
   reached a running server lived.
--------------------------------------------------------------------------- */

const JOBS_DIR = path.resolve(import.meta.dirname, "..", "data", "_jobs");
const SLUG = "test-jobs-fixture-no-such-article";

/* Remove only this suite's records. `data/_jobs/` is a real directory a reader
   may have jobs in — the test must not tidy away theirs. */
afterAll(async () => {
  for (const file of await readdir(JOBS_DIR).catch(() => [])) {
    const full = path.join(JOBS_DIR, file);
    const job = JSON.parse(await readFile(full, "utf8")) as { slug?: string };
    if (job.slug === SLUG) await rm(full, { force: true });
  }
});

/** Poll until the job stops moving, or give up. */
async function settle(id: string) {
  for (let i = 0; i < 60; i++) {
    const job = await getJob(id);
    if (job && job.status !== "queued" && job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job never finished");
}

describe("running a job", () => {
  it("hands back the job already working on a slug rather than starting a second", async () => {
    // A double-click on Add. Both requests must land on one job: the second
    // starting a job of its own would run every step against artefacts the
    // first had just written, tick five boxes and charge for two more model
    // calls.
    const [a, b] = await Promise.all([
      enqueue({ slug: SLUG, steps: ["fetch"] }),
      enqueue({ slug: SLUG, steps: ["fetch"] }),
    ]);
    expect(b.id).toBe(a.id);

    const finished = await settle(a.id);
    expect(finished.status).toBe("error");
    // The failure names the article and says what is missing, rather than
    // arriving as a fetch of the string "undefined".
    expect(finished.error).toMatch(/No source URL/);
    expect(finished.steps[0]?.status).toBe("error");
  });

  it("writes a readable record, still, after all that", async () => {
    const job = await enqueue({ slug: SLUG, steps: ["fetch"] });
    await settle(job.id);
    const files = await readdir(JOBS_DIR);
    expect(files).toContain(`${job.id}.json`);
    // No temp file left behind: a stray `.tmp` is a write that never renamed.
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
