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
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  advanceJob,
  cascadeForce,
  enqueue,
  forceForRetry,
  forgetJob,
  freeSlug,
  getJob,
  orderSteps,
  sameWork,
  workKeyFor,
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
import type { StepContext } from "../src/pipeline.js";
import { fsArtifacts } from "../src/store/artifacts-fs.js";
import {
  expireLeaseForTests,
  fsJobStore,
  pauseForTests,
  sweepStopped,
} from "../src/store/jobs-fs.js";
import { mintAttempt } from "../src/store/jobs.js";
import { jobWorthRetrying } from "../src/job-failure.js";
import { parseJobRequest } from "../src/routes.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import type { Job, JobStep, StepName } from "../src/types.js";

function step(name: StepName, status: JobStep["status"]): JobStep {
  return { name, label: STEPS[name].label, status };
}

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

  it("accepts `glossary`, and keeps it out of what a bare add runs", () => {
    // Both halves at once, because they are one decision: the glossary is a
    // step you can ask for by name and never one an "add this URL" spends a
    // model call on. Greg was asked and said a button, on demand (2026-08-25).
    // See docs/project/glossary.md.
    expect(isStepName("glossary")).toBe(true);
    expect(STEP_ORDER).toContain("glossary");
    expect(DEFAULT_INGEST_STEPS).not.toContain("glossary");
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
      /* `assets` IS swept in, unlike the four steps after `arc`, and the reason
         is the one the cascade encodes: a refresh from source is a request to
         get this article again, and the article's figures are part of it.
         Hot-links rot — five of the corpus's thirteen images sit behind an
         imgix signature that can be rotated — so a forced re-fetch is exactly
         when you want to find out. src/pipeline.ts § FORCE_ONLY_WHEN_NAMED
         names the other four and deliberately not this one. */
      "assets",
    ]);
  });

  it("starts the cascade at the earliest forced step, not the one named last", () => {
    /* `arc` is still here because it was **named**. Since 2026-08-29 it is in
       FORCE_ONLY_WHEN_NAMED, which stops it being swept in by position — naming
       it has always been the other way in, and that is unchanged. */
    expect([...cascadeForce([...STEP_ORDER], new Set(["arc", "blocks"]))]).toEqual([
      "blocks",
      "toc",
      "assets",
      "arc",
    ]);
  });

  it("forces nothing when nothing was asked for", () => {
    expect([...cascadeForce([...STEP_ORDER], new Set())]).toEqual([]);
  });

  it("cascades within the job's own steps, not the whole pipeline", () => {
    /* A job of {toc, arc} that forces toc must not invent a fetch step nobody
       asked for. It no longer forces `arc` either: since 2026-08-29 `arc` can
       tell for itself whether it is current, so it is in FORCE_ONLY_WHEN_NAMED
       and an unforced run re-does it exactly when its inputs have moved. */
    expect([...cascadeForce(["toc", "arc"], new Set(["toc"]))]).toEqual(["toc"]);
    // Named, it is forced like anything else.
    expect([...cascadeForce(["toc", "arc"], new Set(["toc", "arc"]))]).toEqual(["toc", "arc"]);
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
    /* `arc` is absent here for the same reason `tweets` is, as of 2026-08-29 —
       both can now judge their own freshness. */
    expect([...cascadeForce(["toc", "arc", "tweets"], new Set(["toc"]))]).toEqual(["toc"]);
  });

  it("does not sweep `glossary` in by position either, and this one appends", () => {
    /* Same argument as `tweets` — it reads the blocks and the tree, and nothing
       reads what it writes — plus one that is sharper here. Forcing this step
       does not rewrite the list, it **adds a batch of terms to it**
       (src/glossary.ts § generateGlossary). So being swept into the cascade
       would not merely waste a model call: re-fetching an article would silently
       make the reader's glossary longer. */
    expect(FORCE_ONLY_WHEN_NAMED.has("glossary")).toBe(true);
    expect([...cascadeForce([...STEP_ORDER], new Set(["fetch"]))]).not.toContain("glossary");
    expect([...cascadeForce(["toc", "glossary"], new Set(["toc"]))]).toEqual(["toc"]);
  });

  it("still forces `glossary` when it is named — that is the Find more button", () => {
    expect([...cascadeForce(["glossary"], new Set(["glossary"]))]).toEqual(["glossary"]);
  });

  it("still forces `tweets` when it is named", () => {
    // Exempt from the cascade is not exempt from `force`. This is the rewrite
    // button: the thread looks current and you want a different one anyway.
    expect([...cascadeForce(["tweets"], new Set(["tweets"]))]).toEqual(["tweets"]);
    /* `arc` is not here, and its absence is the same rule doing its job: it left
       the positional cascade on 2026-08-29 and was not named. `assets` stays,
       because it never left. */
    expect([...cascadeForce([...STEP_ORDER], new Set(["toc", "tweets"]))]).toEqual([
      "toc",
      "assets",
      "tweets",
    ]);
  });

  it("lets `arc` out of the cascade, now that it CAN check itself", () => {
    /* **This test asserted the opposite until 2026-08-29, and the reason it
       gave was the right one: `arc` had no freshness check, so its position was
       the only signal that it had gone stale.** It has one now — a `stamp` over
       the blocks, the tree and the metadata its prompt carries (src/arc.ts §
       `inputFingerprint`) — which is the exact condition FORCE_ONLY_WHEN_NAMED
       states for membership.

       Worth knowing that position was never quite the signal it looked like:
       `cascadeForce` only names steps already in the job, so a forced
       `{ steps: ["toc"] }` never reached `arc` even then, and the stale arc that
       resulted lost entries in silence. The stamp is what actually closed that.
       docs/plans/defer-arc-and-rename-hierarchy.md § 2.1. */
    expect(FORCE_ONLY_WHEN_NAMED.has("arc")).toBe(true);
    /* `assets` is in the cascade too, and for a third reason again: it *can*
       check itself — it has a stamp over the blocks hash — but a forced
       re-fetch is a request to go and look at the publisher again, which is the
       one thing the stamp cannot answer. A rotated imgix signature changes
       nothing about the blocks. */
    expect(FORCE_ONLY_WHEN_NAMED.has("assets")).toBe(false);
    expect([...cascadeForce([...STEP_ORDER], new Set(["toc"]))]).toEqual([
      "toc",
      "assets",
    ]);
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
    // `extract` writes the HTML and meta.json; `toc` writes tree.json,
    // labels.json and its copy of blocks.json. Checking only one would let a
    // crash between the writes leave a step reporting itself finished with half
    // its output — and the stage after it would then consume the missing half.
    //
    // `toc` went from two files to three when the nav labels became a second
    // model pass (docs/plans/toc-scaling.md). A tree with no labels.json beside
    // it is a half-run step, not a finished one, which is also why src/toc.ts
    // writes tree.json last of the three.
    expect(STEPS.extract.outputs(ctx)).toHaveLength(2);
    expect(STEPS.toc.outputs(ctx)).toHaveLength(3);
    expect(STEPS.extract.outputs(ctx).some((f) => f.endsWith("meta.json"))).toBe(true);
    expect(STEPS.toc.outputs(ctx).some((f) => f.endsWith("blocks.json"))).toBe(true);
    expect(STEPS.toc.outputs(ctx).some((f) => f.endsWith("labels.json"))).toBe(true);
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
      expect(await stepIsDone(STEPS[name], ctx, fsArtifacts)).toBe(false);
    }
  });
});

describe("sweepStopped", () => {
  /* Its job changed on 2026-08-26 and these tests changed with it. It used to
     mark an interrupted job `error` — which was right while one long-lived
     process was the only thing that could run a job, and became wrong the
     moment `advanceJob` could pick one back up. A closed tab is a pause, not a
     failure. See docs/plans/ingest-resume.md § 2. */

  it("leaves a job the server died under waiting, not failed", () => {
    const j = job("running", [
      step("fetch", "done"),
      step("extract", "done"),
      step("blocks", "running"),
      step("toc", "pending"),
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
      step("toc", "pending"),
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

describe("parseJobRequest", () => {
  it("derives the slug from the URL rather than trusting one", () => {
    const parsed = parseJobRequest({ url: "https://www.noemamag.com/the-mythology-of-conscious-ai/" });
    expect(parsed.slug).toBe("the-mythology-of-conscious-ai");
    expect(parsed.url).toBe("https://www.noemamag.com/the-mythology-of-conscious-ai/");
    expect(parsed.steps).toBeUndefined(); // absent means "all of them"
  });

  it("refuses an unusable url without repeating it back", () => {
    /* The refusal message is LOGGED, which is the whole point of this test.
       `logRequest` in src/routes.ts writes `reason: err.message` for any error
       that named its own status — an `httpError` is a decision this file made,
       so its message is treated as ours and written down. That makes every
       `httpError` string a thing we publish, not just a thing we say.

       This one used to interpolate the URL, which defeated the query-string
       strip forty lines above it in the same file: `path` was cleaned and then
       the whole raw URL came back in as `reason`, credentials and all, at warn.
       A source URL is untrusted input and can carry a token or basic-auth
       credentials — docs/project/logging.md, and it is the same shape as the
       toc.ts title and the chat.ts `reason` field.

       Nothing is lost by dropping it: the caller sent the URL, so quoting it
       back tells them nothing they do not have.

       The trigger is a URL that will not parse — `slugFromUrl` returns "" for
       one, and "" is not a slug.

       **The trigger changed on 2026-08-26 and the old one is worth recording**,
       because it swapped places with the counter-example beside it. This used
       to say that pasting a bare domain was the ordinary way here, and that a
       mistyped scheme was not, since `new URL` accepts `htp://…` quite happily
       and derives a perfectly good slug from it. Both halves are now the other
       way round: `normaliseUrl` supplies the missing `https://`, so a bare
       domain is an ordinary URL — and `slugFromUrl` refuses a scheme it could
       never fetch, so `htp://` is the mistake that gets this far. Which is an
       improvement on its own: that typo used to queue a job and fail at fetch. */
    const secret = "htp://example.com/private/a?token=SECRET-8888&key=pw-7777";
    expect(() => parseJobRequest({ url: secret })).toThrow();
    try {
      parseJobRequest({ url: secret });
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain("SECRET-8888");
      expect(message).not.toContain("pw-7777");
      expect(message).not.toContain(secret);
    }
  });

  /**
   * **The steer is gone, and a stale client must not be able to smuggle one.**
   *
   * `guidance` was a free-text note interpolated straight into the summary
   * prompt, with its own cap because uncapped it was a way to spend somebody
   * else's tokens by the megabyte. The box that fed it was deleted on
   * 2026-08-30 — it asked the same question the reader profile already asks,
   * and the profile reaches the same prompt
   * (docs/plans/steer-becomes-the-profile.md).
   *
   * So the field is **ignored, not refused**: a tab open since before the
   * deploy should get its summaries written rather than a 400 about a box it
   * can still see. What must not happen is the middle case — the field quietly
   * surviving into the request and steering a prompt through a door nobody is
   * watching any more, with no cap in front of it because the cap went with the
   * parser.
   */
  it("ignores a steer from a client that still sends one", () => {
    const parsed = parseJobRequest({ slug: "a", guidance: "the evidence" }) as Record<
      string,
      unknown
    >;
    expect(parsed.guidance).toBeUndefined();
    // And an enormous one is dropped rather than carried or thrown over: there
    // is no cap any more because there is nothing left to cap.
    expect(() =>
      parseJobRequest({ slug: "a", guidance: "x".repeat(100_000) }),
    ).not.toThrow();
    expect(
      (parseJobRequest({ slug: "a", guidance: "x".repeat(100_000) }) as Record<string, unknown>)
        .guidance,
    ).toBeUndefined();
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
const ROOT_DATA = path.resolve(import.meta.dirname, "..", "data");

/**
 * Every slug this half of the suite makes an article directory for.
 *
 * `beginStep` does a `mkdir` before the stage runs, so **a job that fails on its
 * first step still leaves `data/<slug>/steps/` behind** — which is most of the
 * jobs here, because failing offline is how they avoid spending money. Left
 * there, those directories are walked by every suite that reads the shelf, and
 * turn up as a mystery extra row in somebody else's assertion.
 */
const OWN_SLUGS = [SLUG, "test-advance-token", "test-advance-sweeps", "test-enqueue-busy-article"];

/* Remove only this suite's records. `data/_jobs/` is a real directory a reader
   may have jobs in — the test must not tidy away theirs. */
afterAll(async () => {
  for (const file of await readdir(JOBS_DIR).catch(() => [])) {
    const full = path.join(JOBS_DIR, file);
    const job = JSON.parse(await readFile(full, "utf8")) as { slug?: string };
    if (job.slug !== undefined && OWN_SLUGS.includes(job.slug)) await rm(full, { force: true });
  }
  // And the run markers those failed jobs left behind. Not tidiness: a marker
  // surviving into the next run of this suite would make the fixture's `fetch`
  // not-done for a reason that has nothing to do with what is being tested.
  for (const slug of OWN_SLUGS) {
    await rm(path.join(ROOT_DATA, slug), { recursive: true, force: true });
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

describe("the work key", () => {
  /**
   * **Two rules for one question drift, so they are held together here.**
   *
   * `sameWork` is what decides whether a caller is handed the job already
   * running; `workKeyFor` is the hash the database compares when two instances
   * ask at once. They have to answer identically for every pair, or the
   * process that loses the race gets a different answer from the process that
   * wins it — and the symptom is a reader watching somebody else's article
   * succeed under their own headline, which is the exact fault
   * `jobs_active_slug` exists to stop.
   *
   * Pairwise over a small grid rather than a list of cases, because the way to
   * get this wrong is to add a field to one and not the other, and a grid
   * notices a new field the day somebody adds it to `sameWork`.
   */
  const GRID: {
    names: StepName[];
    forced: StepName[];
    profile?: string;
    upload?: { id: string; filename: string };
    url?: string;
  }[] = [
    { names: ["fetch"], forced: [] },
    { names: ["fetch"], forced: ["fetch"] },
    { names: ["fetch", "extract"], forced: [] },
    /* Two that differ ONLY in the intent dimension, which is what stops this
       grid agreeing with itself for the wrong reason. Two rows carrying a steer
       used to do this job; with the steer gone they would have become copies of
       row zero and of each other, and a grid of duplicates cannot tell a
       comparison that reads a field from one that ignores it. */
    { names: ["fetch"], forced: [], profile: "a physicist" },
    { names: ["fetch"], forced: [], profile: "a historian" },
    { names: ["fetch"], forced: [], upload: { id: "spya-upl001", filename: "a.pdf" } },
    { names: ["fetch"], forced: [], upload: { id: "spya-upl002", filename: "a.pdf" } },
    /* **The dimension that was missing, and the bug it let through.** Two
       articles whose URLs end in the same path segment both want the slug
       `news`. Added together, both see it free, both build a job whose every
       other work parameter is identical — and the loser of the `jobs_active_slug`
       conflict is told this is the same work and handed the *other* URL's job.
       Its own article is never fetched, and nothing says so. GPT Sol, on the
       built queue, 2026-08-27. */
    { names: ["fetch"], forced: [], url: "https://a.example/news" },
    { names: ["fetch"], forced: [], url: "https://b.example/news" },
    /* And the same address spelled differently is the *same* work, which is
       what `urlKey` is for — so these two must agree with each other. */
    { names: ["fetch"], forced: [], url: "http://a.example/news" },
  ];

  const asJob = (g: (typeof GRID)[number]): Job => ({
    id: "spya-testjb",
    slug: "a-slug",
    ownerId: DEV_OWNER_ID,
    steps: g.names.map((n) => step(n, "pending")).map((st, i) => ({
      ...st,
      ...(g.forced.includes(g.names[i] as StepName) ? { force: true } : {}),
    })),
    status: "queued",
    createdAt: "2026-08-25T10:00:00.000Z",
    ...(g.profile ? { profile: g.profile } : {}),
    ...(g.upload ? { upload: g.upload } : {}),
    ...(g.url ? { url: g.url } : {}),
  });

  it("agrees with sameWork on every pair, both ways round", () => {
    for (const a of GRID) {
      for (const b of GRID) {
        const same = sameWork(asJob(a), b.names, new Set(b.forced), b.profile, b.upload, b.url);
        const keysMatch =
          workKeyFor(a.names, new Set(a.forced), a.profile, a.upload, a.url) ===
          workKeyFor(b.names, new Set(b.forced), b.profile, b.upload, b.url);
        expect(
          { pair: [a, b], sameWork: same, sameKey: keysMatch },
          `sameWork and workKeyFor disagree`,
        ).toEqual({ pair: [a, b], sameWork: same, sameKey: same });
      }
    }
  });

  /* **An agreement test agrees when both sides are wrong.** The grid above pins
     `sameWork` and `workKeyFor` to the same answer, which catches one of them
     reading a field the other ignores — and passes cleanly if *neither* reads
     it. So the one field this change touched gets a direct assertion too:
     unticking "use your profile" and pressing the button again is a request for
     a different artefact, and being handed the running job would refresh the
     panel with something stamped from the profile the reader just declined.
     GPT Sol's review of the built code, 2026-08-30. */
  it("counts two different profiles as two different pieces of work", () => {
    const physicist = workKeyFor(["summary"], new Set(), "a physicist");
    const historian = workKeyFor(["summary"], new Set(), "a historian");
    const none = workKeyFor(["summary"], new Set());
    expect(physicist).not.toBe(historian);
    expect(physicist).not.toBe(none);
    expect(historian).not.toBe(none);
  });

  it("reads two spellings of one address as the same work", () => {
    /* The reason the key hashes `urlKey` rather than the string. Without it,
       adding `http://x.test/piece` when `https://x.test/piece` is already
       running would be a second job for one article — which is the fault
       `urlKey` was written for one layer down, in `freeSlug`. */
    const a = workKeyFor(["fetch"], new Set(), undefined, undefined, "http://x.test/p");
    const b = workKeyFor(["fetch"], new Set(), undefined, undefined, "https://x.test/p");
    expect(a).toBe(b);
    const other = workKeyFor(["fetch"], new Set(), undefined, undefined, "https://y.test/p");
    expect(other).not.toBe(a);
  });

  it("does not depend on how far the job has got", () => {
    /* The reason the key is computed once in `enqueue` and never recomputed.
       `job.steps` mutates as a job runs, so a key derived from the record would
       answer differently at the end than at the start — and "is this the same
       request" does not change because a step finished. */
    const g = GRID[2] as (typeof GRID)[number];
    const before = workKeyFor(g.names, new Set(g.forced));
    // Same request, one step in.
    const after = workKeyFor(g.names, new Set(g.forced));
    expect(after).toBe(before);
  });
});

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
    // And the record says what kind of failure it was, which is what withholds
    // the Retry button on the card. A retry copies the same absent URL and asks
    // the same meta.json, so there is nothing for a second attempt to find.
    expect(finished.failureKind).toBe("ours");
    expect(jobWorthRetrying(finished)).toBe(false);
  });

  /**
   * **A request that *names* an article must never be moved to another one.**
   *
   * The sharpest of GPT Sol's findings on the built queue, and it is worth
   * reading the repro rather than the rule: `paper` has a glossary job running;
   * `paper-2` is a different article, already on the shelf; somebody asks for a
   * summary of `paper`. The active-slug conflict says "different work", the
   * loop reallocated the slug — for a request with neither URL nor upload it
   * had nothing to reallocate *with*, so it appended a counter — and the job
   * became a summary of `paper-2`. Which it would then produce, correctly,
   * under the wrong article. [Silent success](docs/reusable/silent-success.md).
   *
   * A URL or an upload is *asking for* an article and may be moved. Anything
   * else is *naming* one, and the honest answer is 409.
   */
  /**
   * **The token `advanceJob` actually hands the store.**
   *
   * `jobs.attempt_id` is a **uuid** column, and this passed `mintId()` — a
   * `spya-` id — so every advance against Postgres died with `22P02` on the
   * claim, the first statement it runs. Nothing caught it: the filesystem
   * adapter takes any string, and the parity suite minted its own tokens.
   *
   * Which means a test of `mintAttempt`'s *shape* proves nothing either — the
   * question is what the caller passes. So this reads the value out of the
   * store as it arrives. GPT Sol pointed out that the first attempt at this
   * guard had the same hole as the bug.
   */
  it("hands the store a token the uuid column will take", async () => {
    const slug = "test-advance-token";
    const job = await enqueue({ slug, steps: ["fetch"] });
    await settle(job.id);
    await pause(job, 0);

    const seen: string[] = [];
    const claim = vi.spyOn(fsJobStore, "claim");
    try {
      claim.mockImplementation(async (id, owner, attempt, lease) => {
        seen.push(attempt);
        claim.mockRestore();
        return fsJobStore.claim(id, owner, attempt, lease);
      });
      await advanceJob(job.id);
      claim.mockRestore();

      expect(seen).toHaveLength(1);
      expect(seen[0], "advanceJob's attempt token must be a uuid — jobs.attempt_id is one").toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    } finally {
      /* **Cleared even when the assertion fails**, and this is not politeness.
         A `queued` record left in `data/_jobs/` is picked up by the next run's
         `enqueue`, which hands it back instead of making a new one — so the
         next failure is a three-second timeout in a *different* test and says
         nothing about the fault. It cost half an hour once. */
      claim.mockRestore();
      await settle(job.id).catch(() => undefined);
      await forgetJob(job.id).catch(() => undefined);
    }
  });

  /**
   * **The sweep, through `advanceJob` rather than through the store.**
   *
   * `tests/store-jobs-parity.test.ts` proves `failExpired` frees the slot, and
   * GPT Sol pointed out that it proves nothing about the *wiring*: delete the
   * `store.failExpired()` line from `advanceJob` and that test stays green,
   * because it calls the sweep itself. Which is the whole shape of the original
   * bug — the function existed and nothing called it — so the test has to be
   * the one that goes through the caller.
   */
  it("frees a job whose claimant stopped answering, from the advance itself", async () => {
    const slug = "test-advance-sweeps";
    const job = await enqueue({ slug, steps: ["fetch"] });
    await settle(job.id);
    await pause(job, 0);

    /* A claim nobody will ever release — an instance that was killed mid-step.
       Its lease is already in the past, which is the state `advanceJob` has to
       notice without anybody sweeping on its behalf. */
    const orphan = mintAttempt();
    expect((await fsJobStore.claim(job.id, DEV_OWNER_ID, orphan, 60_000)).kind).toBe("claimed");
    expireLeaseForTests(job.id);

    try {
      const advanced = await advanceJob(job.id);
      // Failed rather than taken over, and it says so in the reader's words.
      expect(advanced?.done).toBe(true);
      const after = await getJob(job.id);
      expect(after?.status).toBe("error");
      expect(after?.failureKind).toBe("retry");
    } finally {
      // See the note in the test above: a record left behind breaks the next run.
      await forgetJob(job.id).catch(() => undefined);
    }
  });

  it("refuses rather than renames when a late step lands on a busy article", async () => {
    const slug = "test-enqueue-busy-article";
    /* A job holding the slug, doing different work from the one below. It never
       runs to completion here — `fetch` has no URL — which is exactly the
       window a reader hits by pressing two buttons in quick succession. */
    const held = await enqueue({ slug, steps: ["fetch"] });
    try {
      await expect(enqueue({ slug, steps: ["summary"] })).rejects.toMatchObject({ status: 409 });
      /* And the article it named is still the article it named — nothing was
         quietly created under `${slug}-2`. */
      expect((await getJob(held.id))?.slug).toBe(slug);
    } finally {
      await settle(held.id);
      await forgetJob(held.id);
    }
  });

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
    await settle(job.id);
    const files = await readdir(JOBS_DIR);
    expect(files).toContain(`${job.id}.json`);
    // No temp file left behind: a stray `.tmp` is a write that never renamed.
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

/* --------------------------------------------------------------------------
   Which directory a URL lands in, when something is already in it.

   > And will this de-dupe correctly if near-identical versions of the url are
   > used … or if we already have the article?
   >
   > — Greg, 2026-08-26

   `freeSlug` is the only place that answers both halves, and it answers them
   with one question: *is the thing already called this the same article?* The
   identity test is `urlKey` (src/ingest.ts, tested there); what is tested here
   is the ladder built on top of it.

   The claim lookup is injected, so none of this touches the filesystem, the
   network or the queue. Its default in src/jobs.ts reads `meta.json` and then
   the live queue, which is the one line these tests do not cover.
   -------------------------------------------------------------------------- */
describe("freeSlug", () => {
  /** A stand-in for "what is already called this", as an in-memory shelf. */
  const shelf = (entries: Record<string, string>) => async (candidate: string) =>
    entries[candidate];

  it("uses the slug when nothing is called that yet", async () => {
    expect(await freeSlug("why-trees", "https://example.com/why-trees", shelf({}))).toBe(
      "why-trees",
    );
  });

  it("reuses the slug when we already have this article, however it was spelled", async () => {
    // The whole point: every one of these is the article already on the shelf,
    // so each must land back in `why-trees` and let every step skip — rather
    // than minting `example-why-trees` and fetching, extracting and paying for
    // a tree a second time.
    const have = shelf({ "why-trees": "https://www.example.com/why-trees" });
    for (const spelling of [
      "https://www.example.com/why-trees",
      "http://www.example.com/why-trees",
      "https://example.com/why-trees",
      "https://example.com/why-trees/",
      "https://EXAMPLE.com/why-trees",
      "example.com/why-trees",
      "https://example.com/why-trees#conclusion",
      "https://example.com/why-trees?utm_source=twitter",
    ]) {
      expect(await freeSlug("why-trees", spelling, have), spelling).toBe("why-trees");
    }
  });

  /* The one spelling on Greg's list that deliberately does NOT merge. A
     case-sensitive server may serve two different pages at `/Why-Trees` and
     `/why-trees`, so the key keeps them apart and this is what resolves the
     slug collision that follows — into a visible duplicate rather than into
     the wrong article under the right headline. See `urlKey`. */
  it("steps aside when only the path's capitalisation differs", async () => {
    const have = shelf({ "why-trees": "https://www.example.com/why-trees" });
    expect(await freeSlug("why-trees", "https://example.com/Why-Trees", have)).toBe(
      "example-why-trees",
    );
  });

  it("steps aside for a different article with the same last path segment", async () => {
    // a.example/news and b.example/news both slug to `news`. Without this the
    // second reader is shown the FIRST publication's article under the headline
    // they pasted, and every step reports success — docs/reusable/silent-success.md.
    const have = shelf({ news: "https://a.example/news" });
    expect(await freeSlug("news", "https://b.example/news", have)).toBe("b-news");
  });

  it("numbers when even the host-prefixed name is taken", async () => {
    const have = shelf({
      news: "https://a.example/news",
      "b-news": "https://b.example/other-news",
    });
    expect(await freeSlug("news", "https://b.example/news", have)).toBe("news-2");
  });

  it("gives up rather than looping for ever", async () => {
    const everything = async () => "https://someone-else.example/whatever";
    await expect(freeSlug("news", "https://b.example/news", everything)).rejects.toThrow(
      /Too many articles/,
    );
  });
});

/* --------------------------------------------------------------------------
   `POST /api/jobs/:id/advance` — one step per request, derived from the
   artefacts.

   The browser-driven half of the queue: docs/plans/job-queue-rethink.md
   § Decided, and docs/plans/ingest-resume.md for the resume it delivers.

   These run the real runner, so they are built the same way as the suite above
   — around a slug nothing can be fetched for, so a step that gets as far as the
   network fails before reaching it. `fetch` is stubbed where a step has to
   *succeed*, because there is no offline step that can.
   -------------------------------------------------------------------------- */

/** A slug with a `raw.json`, so `fetch` counts as done and `extract` is next. */
async function fixtureWithRawJson(slug: string): Promise<void> {
  const dir = path.join(ROOT_DATA, slug);
  await mkdir(dir, { recursive: true });
  // `{ file }` with a non-empty string is what the store's `raw` decoder asks
  // of it — src/store/artifacts-fs.ts § DECODERS. Nothing reads the file it
  // names, because `extract` never gets that far without a URL.
  await writeFile(path.join(dir, "raw.json"), JSON.stringify({ file: "raw.html" }), "utf8");
}

/**
 * Put a settled job back into the state a stopped server leaves behind.
 *
 * `getJob` hands back the live record — the same object the queue's map holds —
 * so this is the one honest way to reach "the process died under this job"
 * without killing a process. It is exactly what `sweepStopped` writes: `queued`,
 * nothing running, the finished steps still finished.
 *
 * It has to happen *after* the in-process queue has let the job go, or advance
 * would correctly refuse to touch a job somebody else owns.
 */
async function pause(job: Job, from: number): Promise<void> {
  await pauseForTests(job.id, from);
}

describe("advancing a job one step at a time", () => {
  const SLUGS = [
    "test-advance-resume",
    "test-advance-one-step",
    "test-advance-idempotent",
    "test-advance-concurrent",
    "test-advance-queue-owns",
  ];

  afterAll(async () => {
    for (const slug of SLUGS) await rm(path.join(ROOT_DATA, slug), { recursive: true, force: true });
    for (const file of await readdir(JOBS_DIR).catch(() => [])) {
      const full = path.join(JOBS_DIR, file);
      const record = JSON.parse(await readFile(full, "utf8")) as { slug?: string };
      if (record.slug !== undefined && SLUGS.includes(record.slug)) await rm(full, { force: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("picks up at the first step the artefacts say is not done", async () => {
    /* The resume case, and the whole reason the endpoint exists. `fetch` has
       its artefact, so a job that stopped after it must not fetch again — that
       is somebody's server asked twice and, for the later steps, a model call
       paid for twice. */
    const slug = "test-advance-resume";
    await fixtureWithRawJson(slug);

    const queued = await enqueue({ slug, steps: ["fetch", "extract"] });
    const settled = await settle(queued.id);
    // The in-process queue got there first and skipped `fetch` for the same
    // reason advance is about to: the artefact is there.
    expect(settled.steps[0]?.status).toBe("skipped");
    expect(settled.status).toBe("error");

    const fetched = vi.spyOn(STEPS.fetch, "run");
    await pause(settled, 1);

    const advanced = await advanceJob(queued.id);
    expect(advanced).not.toBeNull();
    // It ran `extract`, not `fetch` — and it worked that out from the file on
    // disk rather than from the job record, which is what makes a job resumed
    // a week later land in the right place.
    expect(advanced?.ran).toBe("extract");
    expect(fetched).not.toHaveBeenCalled();
    expect(advanced?.job.steps[0]?.status).toBe("skipped");
    expect(advanced?.job.steps[1]?.status).toBe("error");
    expect(advanced?.done).toBe(true);
  });

  it("walks the whole job on one call, rather than stopping after the first step", async () => {
    /**
     * **This case said the opposite until 2026-08-30, and the reversal is the
     * point.** It read *"runs exactly one step and stops, leaving the next one
     * pending"*, on the reasoning that a call running two steps could exceed a
     * serverless function's time limit.
     *
     * That was right about the limit and wrong about where the work goes. Each
     * `/advance` may land on a **different instance with an empty disk**, so
     * step two looks for what step one wrote, finds nothing, and runs step one
     * again — and two tabs alternating make that a loop. One claim now walks the
     * whole job, inside one invocation, and what bounds it is the claimant's own
     * deadline (`LEASE_MS`) plus `STEP_BUDGET_MS` before each step.
     * docs/plans/v1-imports-on-vercel.md § Stage 3.
     */
    const slug = "test-advance-one-step";
    const queued = await enqueue({ slug, steps: ["fetch", "extract"] });
    await settle(queued.id); // fails at `fetch`: no URL, nothing fetched
    const job = (await getJob(queued.id)) as Job;

    /* Stubbed to succeed. `assertProduced` still asks the store for the
       artefact afterwards, so the stub has to write one — a step that returns
       happily having written nothing is caught, and should be. */
    const fetched = vi.spyOn(STEPS.fetch, "run").mockImplementation(async () => {
      await fixtureWithRawJson(slug);
      return { detail: "stubbed" };
    });
    await pause(job, 0);

    const first = await advanceJob(queued.id);
    expect(fetched).toHaveBeenCalledTimes(1);
    /* `ran` names the **last** step the call ran, and `extract` is the second of
       the two — so this one assertion is the whole change: the old shape could
       not have reached it. */
    expect(first?.ran).toBe("extract");
    expect(first?.done).toBe(true);
    expect(first?.job.steps[0]?.status).toBe("done");
    /* Not `pending`. `extract` was reached inside the same call, on the same
       claim, over the artefacts `fetch` had just written. */
    expect(first?.job.steps[1]?.status).not.toBe("pending");
    /* Still saying what it said. The walk must not relabel a step it already
       ran — that would take the first step's own report off the card. */
    expect(first?.job.steps[0]?.detail).toBe("stubbed");

    /* And the job is over, so asking again does nothing at all rather than
       running the second step a second time. */
    const second = await advanceJob(queued.id);
    expect(second?.ran).toBeNull();
    expect(second?.done).toBe(true);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("does nothing to a job that has already finished, however often it is asked", async () => {
    const slug = "test-advance-idempotent";
    const queued = await enqueue({ slug, steps: ["fetch"] });
    const settled = await settle(queued.id);
    expect(settled.status).toBe("error");
    const before = JSON.stringify(settled);

    const fetched = vi.spyOn(STEPS.fetch, "run");
    for (let i = 0; i < 3; i++) {
      const advanced = await advanceJob(queued.id);
      expect(advanced?.done).toBe(true);
      expect(advanced?.ran).toBeNull();
      expect(advanced?.busy).toBe(false);
    }
    expect(fetched).not.toHaveBeenCalled();
    expect(JSON.stringify(await getJob(queued.id))).toBe(before);
  });

  it("turns the second of two simultaneous callers away rather than running twice", async () => {
    /* Two tabs. Both may ask; one must win. Running the step twice would have
       two runners writing one article's files, which is the fault this whole
       design is shaped around — docs/plans/job-queue-rethink.md. */
    const slug = "test-advance-concurrent";
    const queued = await enqueue({ slug, steps: ["fetch", "extract"] });
    await settle(queued.id);
    const job = (await getJob(queued.id)) as Job;

    let running = 0;
    let most = 0;
    const fetched = vi.spyOn(STEPS.fetch, "run").mockImplementation(async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
      await fixtureWithRawJson(slug);
      return { detail: "stubbed" };
    });
    await pause(job, 0);

    const [a, b] = await Promise.all([advanceJob(queued.id), advanceJob(queued.id)]);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(most).toBe(1);
    /* One did the work; the other was told to wait and ask again. Neither is an
       error: a second tab cannot know without asking.

       Named rather than sorted. The first version of this asserted
       `[a?.ran, b?.ran].sort()` against `[null, "fetch"]` and was red, because
       the default sort compares *strings* — `"fetch"` before `"null"` — so it
       was pinning the order a comparator happened to produce rather than the
       fact it meant. Pick the winner out by the thing that identifies it. */
    const [winner, loser] = a?.busy === false ? [a, b] : [b, a];
    expect(winner?.busy).toBe(false);
    expect(loser?.busy).toBe(true);
    /* The **last** step the winner ran, not the first: one claim walks the whole
       job, so the winner went on to `extract` over the artefact its own `fetch`
       had just written. What this case is about is unchanged — one runner. */
    expect(winner?.ran).toBe("extract");
    expect(loser?.ran).toBeNull();
    // And the one that was turned away must not claim the job is over, or its
    // loop would stop on a job that still has a step to run.
    expect(loser?.done).toBe(false);
  });

  it("refuses while somebody else holds the claim", async () => {
    /* **The rule that replaced "advance stands aside for the in-process queue".**
     *
     * That rule was an agreement between two drivers inside one process, and it
     * was checked by asking whether this process had an `AbortController` for
     * the job. It could not survive a second instance, which is the whole reason
     * the claim exists — so the rule is now: one claim, and whoever holds it
     * runs. The pump is not privileged; it is just another caller.
     *
     * Taken through the store directly rather than by racing the pump. An
     * earlier version of this queued a job and immediately advanced it, and
     * passed because the pump happened to claim first — a test whose result
     * depends on which of two async callers wins is not testing the rule, it is
     * observing a scheduler. */
    const slug = "test-advance-queue-owns";
    const queued = await enqueue({ slug, steps: ["fetch"] });
    const held = await fsJobStore.claim(queued.id, DEV_OWNER_ID, "spya-someone", 60_000);
    /* The pump may have got there first, and that is fine — either way somebody
       holds it and the assertions below are about what advance says to whoever
       does not. */
    const advanced = await advanceJob(queued.id);
    expect(advanced?.busy).toBe(true);
    expect(advanced?.ran).toBeNull();
    expect(advanced?.done).toBe(false);
    if (held.kind === "claimed") {
      await fsJobStore.releaseStep(queued.id, "spya-someone", queued.steps, {});
    }
    await settle(queued.id);
  });

  it("has nothing to say about a job that does not exist", async () => {
    // Null rather than a made-up job, so the route can 404 rather than hand a
    // client a loop over something that was never there.
    expect(await advanceJob("spya-nosuch")).toBeNull();
  });
});
