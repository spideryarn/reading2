/**
 * **`generateToc` refuses to hand back a tree that is not a valid tree** —
 * `assertTreeSound` in src/tree-invariants.ts, wired in at src/toc.ts.
 *
 * The invariants existed long before this file. They ran in a CLI a human
 * invokes (src/validate-tree.ts) and in the publish guard, which collects
 * reasons rather than throwing (src/store/pg-revisions.ts) — and on neither of
 * the two paths that actually produce a tree. So a stage-4 regression was
 * invisible in exactly the workflow most of this repo's testing goes through.
 * GPT Sol's F5, 2026-08-29.
 *
 * **What "written" means here changed on 2026-08-31, and the file kept its
 * job.** The stage used to write `labels.json`, `blocks.json` and `tree.json`
 * itself, so every test below looked in the directory afterwards. It now
 * returns the three artefacts in one object and its caller stores them
 * (docs/plans/finish-the-database-move.md § Stage 2), so the question "was a
 * bad tree published?" becomes "did a bad tree come back?" — and the assertions
 * moved from `readdir` to the returned `parts`. A throw is still the whole of
 * what stops it: there is no half-way state in which the stage returns a tree
 * and the caller stores only some of it, because `TocArtefacts` requires all
 * three and `run` is not reached at all when the stage throws.
 *
 * **Why this is an integration test and not a unit test of the guard.**
 * `assertTreeSound` throwing on a bad tree is worth about one line; whether
 * `generateToc` *calls* it is the entire finding, and no amount of testing the
 * function proves the call site exists. A static check would not help either —
 * present-and-in-the-right-order passes for a call whose result is discarded, a
 * call inside a branch that never runs, or a call placed after the writes it
 * was meant to prevent. The only thing that settles it is running the stage and
 * looking at what came out of it, which is what this does.
 *
 * No network. `streamMessage` is replaced with one that answers the structure
 * call from a canned tree, and `generateLabels` with one that returns an empty
 * label run — the labels are not what is under test, and mocking them is what
 * keeps this to a single fake response instead of the whole batch protocol.
 */
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
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

/**
 * What `labels.json` claims it was written from — real by default, spoiled by
 * the one test that wants the seam to notice.
 */
let labelsSourceHash = "";

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
          /* **The real hash of the real blocks, and it has to be.** The stage
             takes the input hash it reports off this field and checks it
             against `hashBlocks` of the blocks it is about to return, because
             those are the two values `assertStampAgrees` and
             `reasonsNotToPublish` compare on the way into the store — see
             `TocRun.inputHash` in src/toc.ts. A stub with a made-up hash
             therefore fails the stage, which is what the "different blocks"
             test below deliberately does. */
          sourceHash: labelsSourceHash,
          structureVersion: "test",
          batches: [],
          labels: labelsFor,
          dropped: [],
        },
        batches: 0,
        oversized: 0,
        resumed: 0,
        /* Nothing dropped, which is what a healthy run reports. This stub is not
           typed as a `LabelRun` — nothing here is — so a field added to that
           interface reaches this object as a runtime `undefined` and not as a
           red typecheck. It cost five failures in this file the first time. */
        dropped: [],
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
  const { hashBlocks } = await import("../src/source-hash.js");
  const { blocksArtefact } = await import("../src/blocks.js");
  labelsFor = Object.fromEntries(
    blocks.filter((b) => isStructural(b)).map((b) => [b.id, `Label for ${b.id}`]),
  );
  /* Hashed over the blocks **as the stage returns them** — `blocksArtefact` —
     rather than over the array read off disk. They agree today, because
     `hashBlocks` reads id, text, role and treatment and the artefact rewrites
     only `html`; taking it from the wrong one of the two would make this stub
     assert that agreement rather than the stage. */
  labelsSourceHash = hashBlocks(blocksArtefact(blocks).blocks);
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
    const result = await generateToc({ blocks, slug: "toc-write-guard" });
    return { threw: null, run: result };
  } catch (err) {
    return { threw: err as Error };
  }
}

/**
 * **What the stage handed back, named the way the old assertions were.**
 *
 * The list is the artefact kinds present in `parts`, sorted, so a run that came
 * back with a tree and no labels would read as `["tree"]` — and a run that threw
 * reads as `[]`, which is the same sentence the directory listing used to say.
 * The type makes the first of those unreachable; this is what makes the test say
 * so rather than assume it.
 */
const produced = (r: { run?: TocRun }): string[] =>
  r.run ? Object.keys(r.run.parts).filter((k) => r.run!.parts[k as "tree"] !== undefined).sort() : [];

describe("generateToc refuses to hand back an invalid tree", () => {
  /* The control, and it comes first on purpose: without it, "nothing came back"
     is satisfied just as well by a stage that throws for some unrelated reason —
     a bad mock, a missing fixture, an env var. This proves the same harness
     produces the whole set when the tree is sound. */
  it("returns all three artefacts when the model returns a sound tree", async () => {
    modelTree = wholeArticle();
    const result = await run();
    expect(result.threw).toBeNull();
    expect(produced(result)).toEqual(["blocks", "labels", "tree"]);
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
  it("throws and returns nothing when an internal node has no gist", async () => {
    modelTree = wholeArticle({ gist: undefined });
    const result = await run();
    expect(result.threw).not.toBeNull();
    expect(result.threw!.message).toContain("is not a valid tree, so it was not written");
    expect(produced(result)).toEqual([]);
  });

  /* The repair, proved at the stage rather than at the function — which is the
     same reason everything else in this file is an integration test. A claim no
     block backs up costs the node its provenance mark and costs the reader
     nothing; before this, four structure calls in four made the same wrong
     claim on one article and it was a guaranteed failure loop for that
     document. docs/research/opening-an-article-before-the-toc.md § 7b. */
  it("returns the tree, minus the claim, when a node claims a heading it does not contain", async () => {
    modelTree = wholeArticle({ sourceHeading: "A Heading Nobody Wrote" });
    const result = await run();
    expect(result.threw).toBeNull();
    expect(produced(result)).toEqual(["blocks", "labels", "tree"]);
    const tree = result.run!.parts.tree;
    expect(tree.nodes[tree.rootId]!.sourceHeading).toBeUndefined();
  });

  /**
   * **The evidence for revisiting `MAX_REPAIRED_BOUNDARIES`, on the one run
   * where it is not otherwise collectable.**
   *
   * The bound's own comment says what would justify raising it is a measured
   * distribution, and it used to point at the pipeline log for that. The log
   * only ever sees a run that returned: when the bound fires, `buildTree`
   * throws, `generateToc` never returns, and the repair figures for the answer
   * that was actually refused go nowhere. So the numbers go in the error, and
   * this is the test that they do — an assertion about the log would have been
   * green while the interesting case was invisible. GPT Sol, finding 7.
   *
   * Two independent slipped boundaries: child 2 starts one late, and so does
   * child 3. The first is mended, the second is past the bound.
   */
  it("says what it had already mended when it refuses a second slipped boundary", async () => {
    const section = (title: string, from: number, to: number) => ({
      title,
      gist: `A stretch of the piece, from ${from} to ${to}.`,
      range: [blocks[from]!.id, blocks[to]!.id],
    });
    modelTree = {
      root: {
        title: "The example",
        gist: "Three parts, two of which start a block late.",
        range: [blocks[0]!.id, blocks.at(-1)!.id],
        children: [
          section("First", 0, 0),
          // Skips block 1 — the slip that gets mended.
          section("Second", 2, 3),
          // Skips block 4 — a second, independent slip, and past the bound.
          section("Third", 5, blocks.length - 1),
        ],
      },
    };
    const result = await run();
    expect(result.threw).not.toBeNull();
    expect(result.threw!.message).toMatch(/mended 1 boundary/);
    expect(result.threw!.message).toMatch(/moving 1 block/);
    expect(result.threw!.message).toContain("MAX_REPAIRED_BOUNDARIES");
    expect(produced(result)).toEqual([]);
  });

  /* The thrown message is written to the log by src/jobs.ts with `errorFields`,
     which keeps `message` and `stack`. Until 2026-08-29 the `sourceHeading`
     problem quoted the author's own heading back, so wiring this guard in would
     have put a line of the article into the logs — which nothing in this repo
     may ever do (docs/project/logging.md). Asserted on the message rather than
     trusted to the comment above it. */
  it("puts no article prose in what it throws", async () => {
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
    modelTree = wholeArticle({ sourceHeading: "A Heading Nobody Wrote" });
    const { threw, run: stats } = await run();
    expect(threw).toBeNull();
    expect(stats?.droppedHeadings).toBe(1);
  });

  it("reports zero on a run where the model got it right, rather than nothing", async () => {
    // The control. Absent this, the assertion above passes for a field that is
    // hard-wired to the number 1.
    modelTree = wholeArticle();
    const { run: stats } = await run();
    expect(stats?.droppedHeadings).toBe(0);
    expect(stats?.repairedRanges).toBe(0);
  });

  it("does not pay for labels when the structure call already produced an invalid tree", async () => {
    labelCalls = 0;
    modelTree = wholeArticle({ gist: undefined });
    const result = await run();
    expect(result.threw).not.toBeNull();
    expect(labelCalls).toBe(0);
    expect(produced(result)).toEqual([]);
  });

  /**
   * **The set has to be about one article, and the type cannot say that.**
   *
   * `TocArtefacts` makes "a tree and no labels" unsayable. What it cannot make
   * unsayable is a tree returned beside a `labels.json` written from *different
   * blocks* — which is not hypothetical bookkeeping: `TocRun.inputHash` is read
   * off that file and is the value the store compares against the blocks it is
   * storing (`assertStampAgrees`), and the publish guard compares the same two
   * (`reasonsNotToPublish`). Disagreeing quietly means every article becomes
   * unpublishable, from runs that all reported success.
   *
   * The label pass is mocked here, so this is the one place that state can be
   * made at all — and it is exactly the state a future change to what
   * `generateLabels` is handed (the body alone, say) would create for real.
   */
  it("throws when the labels were written against different blocks", async () => {
    const good = labelsSourceHash;
    labelsSourceHash = "deadbeefdeadbeef";
    try {
      modelTree = wholeArticle();
      const result = await run();
      expect(result.threw).not.toBeNull();
      expect(result.threw!.message).toContain("different blocks");
      expect(produced(result)).toEqual([]);
    } finally {
      labelsSourceHash = good;
    }
  });
});
