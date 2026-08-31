/**
 * **A late step must read the article from the store, not from `ctx.dir`.**
 *
 * The production failure of 2026-08-30, reproduced. Three single-step jobs —
 * one `tweets` and two `arc`, against articles that were already published —
 * died two seconds after they were queued with
 *
 *     ENOENT: no such file or directory, open
 *     '/tmp/spideryarn/<owner>/spya-bpcjus/data/nagel-bat/blocks.json'
 *
 * Why there is nothing at that path, and why nothing put it there. On a
 * deployed instance `dataRoot()` is `/tmp/spideryarn/<owner>/<job>/`
 * (src/store/data-root.ts) — scoped to **one job**, deliberately, so that a
 * failed job's half-built artefacts cannot be served as the next job's. A job
 * created as `{ slug, steps: ["tweets"] }` has exactly one step in it, so
 * `fetch`, `extract`, `blocks` and `hierarchy` never run and never write. The
 * article's blocks are in Postgres, where the ingest that made them published
 * them. The scratch directory is empty and always will be.
 *
 * The stage then reads `path.join(opts.dir, "blocks.json")` off that empty
 * directory. It works on a laptop for one reason only: `dataRoot()` there is the
 * repository root, so `data/<slug>/blocks.json` is a file the last ingest left
 * lying about.
 *
 * ## What the split looks like
 *
 * The step interface already hands `run` an `ArtifactReads` — `blocks` is the
 * one stage that uses it — and `stamp` uses it too. So today one half of every
 * late step asks the store whether its artefact is current and the other half
 * reads a path. This file is that split written down: the store is given the
 * article, `ctx.dir` is not, and the step is asked to run.
 *
 * The model is stubbed, so the real `generateTweets`/`generateArc` run end to
 * end; nothing here reaches the network.
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { partsOf } from "../src/arc.js";
import { STEPS } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import type { ArtifactReads } from "../src/store/artifacts.js";

/* ------------------------------------------------------- the stubbed model -- */

/** What the next call answers. One entry per call the test expects. */
const answers: string[] = [];

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => {
      const text = answers.shift();
      if (text === undefined) throw new Error("the stub ran out of scripted answers");
      const message = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        aborted: () => false,
        finalMessage: () => Promise.resolve(message),
      };
    },
  };
});

/* --------------------------------------------------------------- the fixture -- */

const REPO = path.resolve(import.meta.dirname, "..");
const SLUG = "nagel-bat";

/** Where the article is: a copy of `example/`, standing in for Postgres. */
let published = "";
/** Where the job is: the empty job-scoped scratch a cold instance hands it. */
let scratch = "";

/**
 * The store the run phase gets — rooted at the published copy, **not** at the
 * job's directory. That is the whole point: the store can see the article and
 * the directory cannot, which is exactly the deployed shape.
 */
let store: ArtifactReads;

beforeAll(async () => {
  published = await mkdtemp(path.join(tmpdir(), "spya-published-"));
  scratch = await mkdtemp(path.join(tmpdir(), "spya-scratch-"));
  await cp(path.join(REPO, "example"), path.join(published, "data", SLUG), { recursive: true });
  store = createFsArtifactStore((slug) => ({
    dir: path.join(published, "data", slug),
    htmlFile: path.join(published, "output", `${slug}.html`),
  })) as ArtifactReads;
});

afterAll(async () => {
  await rm(published, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

/** A step context whose directory is empty, as a cold instance's always is. */
function coldContext(): StepContext {
  return {
    slug: SLUG,
    dir: path.join(scratch, "data", SLUG),
    htmlFile: path.join(scratch, "output", `${SLUG}.html`),
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

describe("a single-step job on an instance that never ingested the article", () => {
  it("the store holds the blocks the step needs", async () => {
    /* If this ever fails the rest of the file proves nothing — it would be
       testing an absent article rather than an unreachable one. */
    const file = await store.read(SLUG, "hierarchy", "blocks");
    expect(file?.blocks.length).toBeGreaterThan(0);
  });

  /**
   * **These two were pinned to the defect until 2026-08-31, and now they are
   * pinned to the fix.**
   *
   * They read `.rejects.toThrow(/ENOENT.*blocks\.json/)` for one day — the bug
   * itself, asserted, so that a known-red gate did not train several agents
   * sharing this tree to read past `npm test`. Stage 2a of
   * docs/plans/260831b-finish-the-database-move.md changed what the stage reads: every
   * article-reading stage now takes an `Article` read from the store
   * (src/article-input.ts) rather than opening `blocks.json` off `ctx.dir`.
   *
   * **What these prove, and — more important — what they do not.** The store
   * here is rooted at a published copy while `ctx.dir` is an empty temporary
   * directory. So a stage that still read the directory cannot pass by luck,
   * and a stage that reads the store cannot fail by luck. That asymmetry is the
   * entire fixture, and `coldContext()` must never be given a directory with an
   * article in it.
   *
   * **But production does not yet hand the step a store like this one.**
   * src/jobs.ts still builds `fsStoreSession({ artifacts: fsArtifacts })`, and
   * on a deployment that store is rooted at the same job-scoped `/tmp` the
   * directory is. So the production failure of 2026-08-30 is still there; it
   * now arrives as *"No blocks or tree … run the hierarchy step first"* rather than
   * as an `ENOENT` from three layers down. **These tests are the stage being
   * ready for a store that can see the article, not evidence that one exists.**
   * The line that makes it exist is the `pgStoreSession` swap in stage 3, and
   * this file is what will say it worked.
   *
   * The two stages here are the two that failed in production. The other five
   * — `glossary`, `ideas`, `quotes`, `sketch` and `assets` — took the identical
   * change; tests/pipeline-artifact-store.test.ts is what holds all of them to
   * the artefacts they declare.
   */
  it("tweets reads the article from the store, not from its empty directory", async () => {
    answers.push(JSON.stringify({ tweets: ["A post about the article.", "And a second one."] }));
    await expect(STEPS.tweets.run(coldContext(), store)).resolves.toMatchObject({
      detail: expect.stringContaining("posts"),
      parts: { tweets: expect.objectContaining({ tweets: expect.any(Array) }) },
    });
  });

  it("arc reads the article from the store, not from its empty directory", async () => {
    /* **One sentence per part, counted from the tree the store holds**, because
       `buildArc` refuses a length mismatch rather than zipping as far as it can
       — every sentence after a missing one would land against the wrong part
       and still read plausibly. Hard-coding a count here would make this test
       fail the day the fixture's tree changed, for a reason that has nothing to
       do with what it is about. */
    const tree = await store.read(SLUG, "hierarchy", "tree");
    if (!tree) throw new Error("the fixture has no tree");
    const sentences = partsOf(tree).map((_, i) => `Part ${i + 1} says something.`);
    answers.push(JSON.stringify({ arc: sentences }));
    await expect(STEPS.arc.run(coldContext(), store)).resolves.toMatchObject({
      parts: { arc: expect.objectContaining({ entries: expect.any(Array) }) },
    });
  });

  /**
   * **The negative control, and without it the two above prove much less.**
   *
   * Both of them pass whenever the stage can reach the article *somehow*. This
   * one asserts the other half: with the store empty as well, the stage fails —
   * so the two above are reading the store rather than finding the article by
   * some route this fixture did not intend. It also pins the failure to a
   * refusal with a sentence in it rather than the `ENOENT` that used to arrive
   * from three layers down.
   */
  it("and refuses in its own words when the store has no article either", async () => {
    const empty = createFsArtifactStore((slug) => ({
      dir: path.join(scratch, "data", slug),
      htmlFile: path.join(scratch, "output", `${slug}.html`),
    })) as ArtifactReads;
    await expect(STEPS.arc.run(coldContext(), empty)).rejects.toThrow(/run the hierarchy step first/);
  });
});
