/**
 * **`generateToc` refuses to write a tree that is not a valid tree** —
 * `assertTreeSound` in src/tree-invariants.ts, wired in at src/toc.ts.
 *
 * The invariants existed long before this file. They ran in a CLI a human
 * invokes (src/validate-tree.ts) and in the publish guard, which collects
 * reasons rather than throwing (src/store/pg-revisions.ts) — and on neither of
 * the two paths that actually *write* `tree.json`. So a stage-4 regression was
 * invisible in exactly the workflow most of this repo's testing goes through.
 * GPT Sol's F5, 2026-08-29.
 *
 * **Why this is an integration test and not a unit test of the guard.**
 * `assertTreeSound` throwing on a bad tree is worth about one line; whether
 * `generateToc` *calls* it is the entire finding, and no amount of testing the
 * function proves the call site exists. A static check would not help either —
 * present-and-in-the-right-order passes for a call whose result is discarded, a
 * call inside a branch that never runs, or a call placed after the writes it
 * was meant to prevent. The only thing that settles it is running the stage and
 * looking at the directory afterwards, which is what this does.
 *
 * No network. `streamMessage` is replaced with one that answers the structure
 * call from a canned tree, and `generateLabels` with one that returns an empty
 * label run — the labels are not what is under test, and mocking them is what
 * keeps this to a single fake response instead of the whole batch protocol.
 */
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Block } from "../src/types.js";
import type { TocRun } from "../src/toc.js";

/** The tree the structure model "returns", set per test before the call. */
let modelTree: unknown = null;

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (_task: string, _body: unknown) => ({
      onText: () => {},
      finalMessage: async () => ({
        content: [{ type: "text", text: JSON.stringify(modelTree) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    }),
  };
});

/**
 * A label per structural block, keyed the way `mergeLabels` reads them — by the
 * leaf's **first block id**.
 *
 * Not an empty set, and the control is what proved that: `checkCoverage` runs
 * immediately after the guard and rejects a tree with no labels, so the sound
 * case threw too and "nothing was written" would have held for both tests
 * regardless of the guard. A control that cannot come out green is not a
 * control.
 */
let labelsFor: Record<string, string> = {};

/**
 * How many times the stage paid for labels — the whole of the second guard
 * below.
 *
 * `assertTreeSound` ran only after `mergeLabels`, so a structural mistake the
 * model made in the *structure* call was found after a full label run had been
 * paid for and had succeeded. On job spya-v2f7b3 that happened three times in
 * one ingest. Counting the call is the only way to see it: the outcome —
 * throws, writes nothing — is identical whether the check runs before the
 * labels or after them, which is why the existing tests in this file all passed
 * on the wasteful order. See docs/postmortems/the-article-with-one-heading.md.
 */
let labelCalls = 0;

vi.mock("../src/labels.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/labels.js")>();
  return {
    ...real,
    /* Only the call is faked. `mergeLabels` stays real, so the tree that
       reaches the guard is exactly the tree that would have been written. */
    generateLabels: async () => {
      labelCalls += 1;
      return {
        labels: labelsFor,
        file: {
          version: "test",
          generator: "test",
          slug: "toc-write-guard",
          structureHash: "0000000000000000",
          blocksHash: "0000000000000000",
          model: "test",
          batches: [],
          labels: labelsFor,
          generatedAt: "2026-08-29T00:00:00.000Z",
          elapsedMs: 0,
        },
        batches: 0,
        oversized: 0,
        resumed: 0,
        calls: 0,
        estimatedCacheable: false,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        clearCheckpoint: async () => {},
      };
    },
  };
});

const ROOT = path.resolve(import.meta.dirname, "..");

/** A temp copy of `example/`, never `data/` — see tests/helpers/corpus-lock.ts. */
let DIR: string;
let blocks: Block[];

beforeAll(async () => {
  DIR = await mkdtemp(path.join(tmpdir(), "toc-write-guard-"));
  await cp(path.join(ROOT, "example"), DIR, { recursive: true });
  blocks = JSON.parse(await readFile(path.join(DIR, "blocks.json"), "utf8")).blocks;
  ({ generateToc } = await import("../src/toc.js"));
  const { isStructural } = await import("../src/block-policy.js");
  labelsFor = Object.fromEntries(
    blocks.filter((b) => isStructural(b)).map((b) => [b.id, `Label for ${b.id}`]),
  );
  // The fixture ships a finished article. The stage must be the thing that
  // writes these, or "they are absent afterwards" would prove nothing.
  await rm(path.join(DIR, "tree.json"), { force: true });
  await rm(path.join(DIR, "labels.json"), { force: true });
});

afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
});

/** One node over every block: the smallest tree `buildTree` accepts. */
const wholeArticle = (over: Record<string, unknown> = {}) => ({
  root: {
    title: "The example",
    gist: "One node over the whole piece, which is a shape buildTree accepts.",
    range: [blocks[0]!.id, blocks.at(-1)!.id],
    ...over,
  },
});

/**
 * Imported once in `beforeAll`, not per call. `src/toc.ts` is a big module and
 * vitest transforms it on first import, so importing it *inside* the first
 * test charged that test the compile — which put it over the 5-second default
 * whenever the machine was busy running the rest of the suite in parallel. It
 * failed as a timeout on the **control**, which is the most misleading place
 * for a flake to land: the control going red reads as "the harness is broken",
 * and the four tests it is the control for went on passing.
 */
let generateToc!: typeof import("../src/toc.js")["generateToc"];

async function run(): Promise<{ threw: Error | null; run?: TocRun }> {
  try {
    const result = await generateToc({ blocksPath: path.join(DIR, "blocks.json"), outDir: DIR });
    return { threw: null, run: result };
  } catch (err) {
    return { threw: err as Error };
  }
}

const wrote = async (): Promise<string[]> => {
  const files = await readdir(DIR);
  return files.filter((f) => f === "tree.json" || f === "labels.json").sort();
};

describe("generateToc refuses to write an invalid tree", () => {
  /* The control, and it comes first on purpose: without it, "nothing was
     written" is satisfied just as well by a stage that throws for some
     unrelated reason — a bad mock, a missing directory, an env var. This proves
     the same harness does write both files when the tree is sound. */
  it("writes the tree when the model returns a sound one", async () => {
    modelTree = wholeArticle();
    const { threw } = await run();
    expect(threw).toBeNull();
    expect(await wrote()).toEqual(["labels.json", "tree.json"]);
  });

  /**
   * **The vehicle changed on 2026-08-30, and the reason is worth keeping.**
   *
   * These tests used to make an invalid tree by claiming a `sourceHeading` the
   * node does not contain. `buildTree` now drops such a claim instead of
   * letting it through to `checkTree` (src/toc.ts, tests/toc-repairs.test.ts),
   * so that stopped being a way to build an invalid tree at all — and every
   * test here went green for the wrong reason: nothing threw, because nothing
   * was wrong any more.
   *
   * A missing gist replaces it. It is buildable — `buildTree` copies back
   * whatever the model wrote and has no opinion about an absent gist — and
   * invalid, because an internal node without one has nothing to render at its
   * own zoom level (src/tree-invariants.ts § the gist rule). That is the pair
   * this file needs, and unlike `sourceHeading` it is a rule no repair may ever
   * relax: the gist rule is stated in both directions precisely so a pipeline
   * bug that drops a gist cannot be read as a deliberate exception.
   */
  it("throws and writes nothing when an internal node has no gist", async () => {
    await rm(path.join(DIR, "tree.json"), { force: true });
    await rm(path.join(DIR, "labels.json"), { force: true });
    modelTree = wholeArticle({ gist: undefined });
    const { threw } = await run();
    expect(threw).not.toBeNull();
    expect(threw!.message).toContain("is not a valid tree, so it was not written");
    expect(await wrote()).toEqual([]);
  });

  /* The repair, proved at the stage rather than at the function — which is the
     same reason everything else in this file is an integration test. A claim no
     block backs up costs the node its provenance mark and costs the reader
     nothing; before this, four structure calls in four made the same wrong
     claim on one article and it was a guaranteed failure loop for that
     document. docs/research/opening-an-article-before-the-toc.md § 7b. */
  it("writes the tree, minus the claim, when a node claims a heading it does not contain", async () => {
    await rm(path.join(DIR, "tree.json"), { force: true });
    await rm(path.join(DIR, "labels.json"), { force: true });
    modelTree = wholeArticle({ sourceHeading: "A Heading Nobody Wrote" });
    const { threw } = await run();
    expect(threw).toBeNull();
    expect(await wrote()).toEqual(["labels.json", "tree.json"]);
    const written = JSON.parse(await readFile(path.join(DIR, "tree.json"), "utf-8")) as {
      rootId: string;
      nodes: Record<string, { sourceHeading?: string }>;
    };
    expect(written.nodes[written.rootId]!.sourceHeading).toBeUndefined();
  });

  /* The thrown message is written to the log by src/jobs.ts with `errorFields`,
     which keeps `message` and `stack`. Until 2026-08-29 the `sourceHeading`
     problem quoted the author's own heading back, so wiring this guard in would
     have put a line of the article into the logs — which nothing in this repo
     may ever do (docs/project/logging.md). Asserted on the message rather than
     trusted to the comment above it. */
  it("puts no article prose in what it throws", async () => {
    await rm(path.join(DIR, "tree.json"), { force: true });
    await rm(path.join(DIR, "labels.json"), { force: true });
    const heading = blocks.find((b) => b.kind === "heading");
    expect(heading).toBeDefined(); // the fixture must have one for this to test anything
    modelTree = wholeArticle({ gist: undefined });
    const { threw } = await run();
    /* Every block's text, not just the heading's. The original version of this
       test named the one string the one message was known to quote, which
       checks the bug that happened rather than the rule — and the rule is that
       nothing this stage throws may carry a line of the article. */
    for (const b of blocks) {
      if (b.text.trim().length > 0) expect(threw!.message).not.toContain(b.text);
    }
  });

  /* **The control, and it has to come first for the same reason as the one at
     the top of this block.** "The labels were not generated" is satisfied just
     as well by a harness where the mock is never reached at all — a broken
     import, a throw earlier in the stage. This proves the counter moves. */
  it("pays for labels when the structure is sound", async () => {
    await rm(path.join(DIR, "tree.json"), { force: true });
    await rm(path.join(DIR, "labels.json"), { force: true });
    labelCalls = 0;
    modelTree = wholeArticle();
    const { threw } = await run();
    expect(threw).toBeNull();
    expect(labelCalls).toBe(1);
  });

  /* The finding from job spya-v2f7b3. Everything `checkTree` complains about
     here is decided by the *structure* call: the ranges, the tiling, the gists,
     the titles and `sourceHeading`. None of it can change in `generateLabels`,
     because `mergeLabels` touches leaves only and only sets or deletes
     `navLabel` — so the answer is already known before a single label is asked
     for, and asking anyway costs a full batch run per attempt.

     Not merely a saving. Stage 4 is the most expensive step in the pipeline
     (see 38ea362), and this is a whole wasted pass through the second half of
     it on every attempt at an article the structure model keeps getting wrong —
     which is exactly the article this postmortem is about, six times over. */
  /**
   * **The counts have to arrive somewhere a person will see them**, and until
   * this test nothing checked that they did. `buildTree` fills in a report,
   * `generateToc` counts it into `TocRun`, the CLI prints it every run and
   * src/pipeline.ts logs it — four links, of which the tests covered the first.
   * A repair nobody is told about is indistinguishable from the bug it
   * repaired, so the wiring is the feature and not an extra
   * (docs/reusable/silent-success.md). GPT Sol's review, 2026-08-30.
   */
  it("reports what it repaired all the way out to the run stats", async () => {
    await rm(path.join(DIR, "tree.json"), { force: true });
    await rm(path.join(DIR, "labels.json"), { force: true });
    modelTree = wholeArticle({ sourceHeading: "A Heading Nobody Wrote" });
    const { threw, run: stats } = await run();
    expect(threw).toBeNull();
    expect(stats?.droppedHeadings).toBe(1);
  });

  it("reports zero on a run where the model got it right, rather than nothing", async () => {
    // The control. Absent this, the assertion above passes for a field that is
    // hard-wired to the number 1.
    await rm(path.join(DIR, "tree.json"), { force: true });
    await rm(path.join(DIR, "labels.json"), { force: true });
    modelTree = wholeArticle();
    const { run: stats } = await run();
    expect(stats?.droppedHeadings).toBe(0);
    expect(stats?.repairedRanges).toBe(0);
  });

  it("does not pay for labels when the structure call already produced an invalid tree", async () => {
    await rm(path.join(DIR, "tree.json"), { force: true });
    await rm(path.join(DIR, "labels.json"), { force: true });
    labelCalls = 0;
    modelTree = wholeArticle({ gist: undefined });
    const { threw } = await run();
    expect(threw).not.toBeNull();
    expect(labelCalls).toBe(0);
    expect(await wrote()).toEqual([]);
  });
});
