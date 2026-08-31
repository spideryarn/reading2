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
 * `fetch`, `extract`, `blocks` and `toc` never run and never write. The
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
    const file = await store.read(SLUG, "toc", "blocks");
    expect(file?.blocks.length).toBeGreaterThan(0);
  });

  it("tweets runs from the store rather than the job's empty directory", async () => {
    answers.push(JSON.stringify({ tweets: ["A post about the article.", "And a second one."] }));
    await expect(STEPS.tweets.run(coldContext(), store)).resolves.toMatchObject({
      detail: expect.stringContaining("posts"),
    });
  });

  it("arc runs from the store rather than the job's empty directory", async () => {
    answers.push(
      JSON.stringify({
        entries: [{ partId: "part-1", sentence: "The piece opens by asking what it is like." }],
      }),
    );
    await expect(STEPS.arc.run(coldContext(), store)).resolves.toBeTruthy();
  });
});
