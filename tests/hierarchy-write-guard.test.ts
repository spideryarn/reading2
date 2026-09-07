/**
 * **`generateHierarchy` refuses to hand back a tree that is not a valid tree** —
 * `assertTreeSound` in src/tree-invariants.ts, wired in at src/hierarchy.ts.
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
 * (docs/plans/260831b-finish-the-database-move.md § Stage 2), so the question "was a
 * bad tree published?" becomes "did a bad tree come back?" — and the assertions
 * moved from `readdir` to the returned `parts`. A throw is still the whole of
 * what stops it: there is no half-way state in which the stage returns a tree
 * and the caller stores only some of it, because `HierarchyArtefacts` requires all
 * three and `run` is not reached at all when the stage throws.
 *
 * **Why this is an integration test and not a unit test of the guard.**
 * `assertTreeSound` throwing on a bad tree is worth about one line; whether
 * `generateHierarchy` *calls* it is the entire finding, and no amount of testing the
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
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Block } from "../src/types.js";
import type { HierarchyRun } from "../src/hierarchy.js";

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
 * on the wasteful order. See docs/postmortems/260830a-the-article-with-one-heading.md.
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
             `HierarchyRun.inputHash` in src/hierarchy.ts. A stub with a made-up hash
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
  ({ generateHierarchy } = await import("../src/hierarchy.js"));
  const { isStructural } = await import("../src/block-policy.js");
  ({ hashBlocks, structureHash } = await import("../src/source-hash.js"));
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
 * Imported once in `beforeAll`, not per call. `src/hierarchy.ts` is a big module and
 * vitest transforms it on first import, so importing it *inside* the first
 * test charged that test the compile — which put it over the 5-second default
 * whenever the machine was busy running the rest of the suite in parallel. It
 * failed as a timeout on the **control**, which is the most misleading place
 * for a flake to land: the control going red reads as "the harness is broken",
 * and the four tests it is the control for went on passing.
 */
let generateHierarchy!: typeof import("../src/hierarchy.js")["generateHierarchy"];
/* Hoisted out of `beforeAll`, where it was a local, so the case at the foot of
   this file can ask the same question of the returned artefacts that the stage
   asks of them internally. */
let hashBlocks!: typeof import("../src/source-hash.js")["hashBlocks"];
/* Beside `hashBlocks` and for the identical reason: the case at the foot of this
   file asks whether the manifest's structure hash describes the tree that came
   back with it. */
let structureHash!: typeof import("../src/source-hash.js")["structureHash"];

async function run(): Promise<{ threw: Error | null; run?: HierarchyRun }> {
  try {
    const result = await generateHierarchy({ blocks, slug: "toc-write-guard", checkpoints: nullCheckpointStore() });
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
const produced = (r: { run?: HierarchyRun }): string[] =>
  r.run ? Object.keys(r.run.parts).filter((k) => r.run!.parts[k as "tree"] !== undefined).sort() : [];

describe("generateHierarchy refuses to hand back an invalid tree", () => {
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
   * letting it through to `checkTree` (src/hierarchy.ts, tests/hierarchy-repairs.test.ts),
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
     document. docs/research/260830a-opening-an-article-before-the-toc.md § 7b. */
  it("returns the tree, minus the claim, when a node claims a heading it does not contain", async () => {
    modelTree = wholeArticle({ sourceHeading: "A Heading Nobody Wrote" });
    const result = await run();
    expect(result.threw).toBeNull();
    expect(produced(result)).toEqual(["blocks", "labels", "tree"]);
    const tree = result.run!.parts.tree;
    expect(tree.nodes[tree.rootId]!.sourceHeading).toBeUndefined();
  });

  /**
   * **The repair figures on the one run where the log cannot carry them.**
   *
   * They reach `HierarchyRun`, the CLI and the pipeline log on every run that
   * *returns*. When `buildTree` throws, `generateHierarchy` never returns and what it
   * had already mended for that answer goes nowhere — the monitoring path goes
   * dark exactly when somebody would look at it. So the numbers go in the
   * error, and this is the test that they do. An assertion about the log would
   * have been green while the interesting case was invisible. GPT Sol, finding 7.
   *
   * No tiling fault reaches this path any more, so the fixture mends a boundary
   * at depth one and then fails deeper down on **a block id the article does not
   * contain** — a fault in what the model *said* rather than in how its sections
   * line up, and one `planChildRanges` deliberately has no say in.
   *
   * **Two other faults have been tried here and both stopped throwing**, which
   * is worth recording because the pattern is the point. A root stopping short
   * of the article went first, on 2026-09-04: the root is now clamped to the
   * article's ends like every other range is derived. A child's range running
   * backwards went the same day, for the same reason one level down — the
   * derivation never believed an end. What is left is the model naming a block
   * that does not exist, which is not a boundary claim at all.
   */
  it("says what it had already mended when it refuses for another reason", async () => {
    const section = (title: string, from: number, to: number) => ({
      title,
      gist: `A stretch of the piece, from ${from} to ${to}.`,
      range: [blocks[from]!.id, blocks[to]!.id],
    });
    const last = blocks.length - 1;
    modelTree = {
      root: {
        title: "The example",
        gist: "Two parts, and an invented block id inside the second one.",
        range: [blocks[0]!.id, blocks[last]!.id],
        children: [
          section("First", 0, 0),
          // Skips block 1 — the slip that gets mended before anything descends.
          {
            ...section("Second", 2, last),
            children: [
              section("Opening", 2, 2),
              // An id no block carries, and therefore unplannable:
              // `planChildRanges` leaves this sibling set alone so the precise
              // message survives instead of being buried by a tree built as
              // though the child had never been proposed.
              {
                title: "Invented",
                gist: "A stretch of the piece that does not exist.",
                range: ["spya-zzzzzz", blocks[last]!.id],
              },
            ],
          },
        ],
      },
    };
    const result = await run();
    expect(result.threw).not.toBeNull();
    expect(result.threw!.message).toMatch(/not in blocks\.json/);
    expect(result.threw!.message).toMatch(/mended 1 boundary/);
    expect(result.threw!.message).toMatch(/moving 1 block/);
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

  /**
   * **This asserted the opposite until 2026-09-06, and it was the control for
   * the case below.** It read *"pays for labels when the structure is sound"*,
   * with a comment saying the control had to come first because *"the labels
   * were not generated" is satisfied just as well by a harness where the mock is
   * never reached at all*.
   *
   * That control has stopped being available, because the thing it controlled
   * for is now **true by construction**: the label pass left `generateHierarchy`
   * with docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md, so this
   * function never reaches `generateLabels` on any path at all.
   *
   * **So read the case below as vacuous, and this one as what replaced it.**
   * "Does not pay for labels when the tree is invalid" is now a special case of
   * "does not pay for labels", and the saving it protected is structural rather
   * than guarded. The live version of that guard is
   * `tests/labels-step-registration.test.ts`, which pins `labels` out of
   * `DEFAULT_INGEST_STEPS`, and the store rule in
   * `tests/labels-receipt-invalidation.test.ts`.
   */
  it("buys no labels at all, however sound the structure is", async () => {
    labelCalls = 0;
    modelTree = wholeArticle();
    const { threw } = await run();
    expect(threw).toBeNull();
    expect(labelCalls).toBe(0);
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
   * `generateHierarchy` counts it into `HierarchyRun`, the CLI prints it every run and
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

  /* **Vacuous on the label half since 2026-09-06 — see the case above.** The
     `labelCalls` line cannot fail any more, because this function has no path to
     `generateLabels`. Kept rather than deleted because the *other* two
     assertions are not vacuous: an invalid tree still throws, and it still
     stores nothing, which is the finding from job spya-v2f7b3 that this block
     exists for. */
  it("stores nothing when the structure call already produced an invalid tree", async () => {
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
   * `HierarchyArtefacts` makes "a tree and no labels" unsayable. What it cannot make
   * unsayable is a tree returned beside a `labels.json` written from *different
   * blocks* — which is not hypothetical bookkeeping: `HierarchyRun.inputHash` is read
   * off that file and is the value the store compares against the blocks it is
   * storing (`assertStampAgrees`), and the publish guard compares the same two
   * (`reasonsNotToPublish`). Disagreeing quietly means every article becomes
   * unpublishable, from runs that all reported success.
   *
   * **The negative can no longer be provoked from here, and saying so is the
   * point.** Until 2026-09-06 the mocked label pass supplied `sourceHash`, so
   * setting it to a wrong value forced the guard to fire and this case asserted
   * the throw. `generateHierarchy` now writes that field itself — it is
   * `hashBlocks(blocks)` on the argument, computed a few lines from
   * `hashBlocks(parts.blocks.blocks)` on what is returned — so nothing this file
   * can reach makes the two disagree.
   *
   * The guard is still live and still worth having: the two arrays are equal
   * only because `blocksArtefact` maps one to one and rewrites `html` alone,
   * which `hashBlocks` does not read, and either half of that could move. What
   * has changed is that provoking it now means mocking `hashBlocks` itself,
   * which would be a test of the mock. So this asserts the property in the
   * direction that is still reachable — the hash the run reports is the one on
   * the artefact, and it describes the blocks actually handed back — and the
   * failing direction is named here rather than pretended at.
   * docs/reusable/silent-success.md, applied to a test rather than to code.
   */
  it("reports a hash that is read off the manifest and describes the blocks it returns", async () => {
    modelTree = wholeArticle();
    const result = await run();
    expect(result.threw).toBeNull();
    expect(result.run?.inputHash).toBe(result.run?.parts.labels.sourceHash);
    expect(result.run?.inputHash).toBe(hashBlocks(result.run!.parts.blocks.blocks));
  });

  /**
   * **And the manifest's `structureHash` describes the tree it comes back
   * beside** — one of the two claims `writeArtefacts` began refusing writes over
   * on 2026-09-07 (GPT Sol's F2 on stage 2a). This is that writer, driven, rather
   * than the reduction of it: the stage computes the hash off `structure` and
   * returns `mergeLabels(structure, {})`, and only the stage knows whether those
   * two are still the same tree by the time they are handed over together.
   *
   * The other writer is the `labels` step, whose two halves are pinned where
   * they are: `generateLabels` stamps `structureHash(opts.tree)`
   * (tests/labels-batching.test.ts § *records the manifest that lets a stale
   * complete set be spotted*), and `mergeLabels` leaves that hash alone (same
   * file, § `mergeLabels`).
   */
  it("reports a structureHash that describes the tree it returns", async () => {
    modelTree = wholeArticle();
    const result = await run();
    expect(result.threw).toBeNull();
    expect(result.run?.parts.labels.structureHash).toBe(structureHash(result.run!.parts.tree));
  });
});
