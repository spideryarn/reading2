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

vi.mock("../src/labels.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/labels.js")>();
  return {
    ...real,
    /* Only the call is faked. `mergeLabels` stays real, so the tree that
       reaches the guard is exactly the tree that would have been written. */
    generateLabels: async () => ({
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
    }),
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

async function run(): Promise<{ threw: Error | null }> {
  const { generateToc } = await import("../src/toc.js");
  try {
    await generateToc({ blocksPath: path.join(DIR, "blocks.json"), outDir: DIR });
    return { threw: null };
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

  it("throws and writes nothing when a node claims a heading it does not contain", async () => {
    await rm(path.join(DIR, "tree.json"), { force: true });
    await rm(path.join(DIR, "labels.json"), { force: true });
    /* Buildable and invalid, which is the pair that matters: `buildTree` has no
       opinion about `sourceHeading`, and `checkTree` requires the claimed
       heading to be a heading block inside the node's own range. */
    modelTree = wholeArticle({ sourceHeading: "A Heading Nobody Wrote" });
    const { threw } = await run();
    expect(threw).not.toBeNull();
    expect(threw!.message).toContain("is not a valid tree, so it was not written");
    expect(await wrote()).toEqual([]);
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
    modelTree = wholeArticle({ sourceHeading: "A Heading Nobody Wrote" });
    const { threw } = await run();
    expect(threw!.message).not.toContain("A Heading Nobody Wrote");
    expect(threw!.message).not.toContain(heading!.text);
  });
});
