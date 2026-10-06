/**
 * **A model's tree with a section too long for one labels call is kept.**
 *
 * `generateStructure` takes the bounded headings tree
 * (src/heading-tree.ts § `buildBoundedHeadingTree`) when the whole-document
 * answer would not fit, which tests/stated-limits.test.ts pins. This file is
 * the other way in: the answer fits, the model's tree is sound, and one of its
 * sections is too long for a single labels call.
 *
 * **Every expectation here was reversed on 2026-10-06, and the file keeps its
 * name so the history reads.** From 2026-10-05 such a tree was thrown away for
 * the headings tree (`labels-could-not-ask`), because the labels planner never
 * cut a section and would have thrown `TooLongForOnePass` on it. The planner
 * now cuts that section's *call* into windows (src/labels.ts § `planBatches`),
 * so the tree, its titles and its gists stand. Stage A of
 * docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Block } from "../src/types.js";

/** What the structure call "returns", set per test. */
let modelAnswer = "";
let modelCalls = 0;

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => {
      modelCalls += 1;
      return {
        onText: () => {},
        finalMessage: async () => ({
          content: [{ type: "text", text: modelAnswer }],
          stop_reason: "end_turn",
          usage: { input_tokens: 7, output_tokens: 11 },
        }),
      };
    },
  };
});

const { buildTree, generateStructure, parseWholeDocumentAnswer } = await import("../src/structure.js");
const { LABEL_RETRY_HEADROOM, labelCallBudget, MAX_BATCH, planBatches, unaskableBatches } = await import("../src/labels.js");
const { generatorFor } = await import("../src/models.js");
const { TooLongForOnePass } = await import("../src/token-budget.js");
const { memoryCheckpoints } = await import("./helpers/memory-checkpoints.js");
const { bodyLeafSets, paragraphs, note } = await import("./helpers/bounded-tree.js");

const SLUG = "bounded-fallback";
/** Under the one-answer ceiling (2,889 headingless blocks), so the model is asked. */
const BLOCKS: Block[] = paragraphs(2500);

/** A well-formed answer whose top-level sections hold `sizes` blocks, in order. */
function answer(sizes: number[]): string {
  let at = 0;
  const children = sizes.map((size, i) => {
    const start = BLOCKS[at]!.id;
    at += size;
    return { title: `Section ${i}`, gist: `Section ${i} says one thing.`, question: `Section ${i}: what?`, start };
  });
  if (at !== BLOCKS.length) throw new Error(`sizes add up to ${at}, not ${BLOCKS.length}`);
  return JSON.stringify({
    root: { title: "The piece", gist: "The piece says things.", question: "The piece: what?", children },
  });
}

/**
 * The most blocks one labels call may be asked for, re-draw included, found
 * from the labels step's own arithmetic (src/labels.ts § `LABEL_RETRY_HEADROOM`).
 */
const MOST_IN_ONE_LABELS_CALL = ((): number => {
  for (let n = 1; ; n++) {
    try {
      labelCallBudget(n + 1, LABEL_RETRY_HEADROOM);
    } catch (err) {
      if (err instanceof TooLongForOnePass) return n;
      throw err;
    }
  }
})();

const run = (checkpoints = memoryCheckpoints({ slug: SLUG, articleId: "a-1" })) =>
  generateStructure({ power: "standard", blocks: BLOCKS, slug: SLUG, checkpoints, deepen: false });

beforeEach(() => {
  modelCalls = 0;
});

/** The model's tree, under the model's name, and a plan the labels step can start on. */
function expectModelTreeKept(out: Awaited<ReturnType<typeof run>>, blocks: Block[] = BLOCKS): void {
  expect(out.source).toEqual({ by: "model" });
  expect(out.parts.tree.provisional).toBeUndefined();
  expect(out.parts.tree.generator).toBe(generatorFor("standard"));
  expect(out.model).toBe(generatorFor("standard"));
  expect(unaskableBatches(out.parts.tree, blocks)).toEqual([]);
  for (const batch of planBatches(out.parts.tree, blocks)) {
    expect(() => labelCallBudget(batch.blocks.length, LABEL_RETRY_HEADROOM)).not.toThrow();
  }
}

describe("a model tree with a section too long for one labels call", () => {
  /* Reversed 2026-10-06: was "is replaced by the bounded headings tree". */
  it("is kept, with the model's titles and gists, and the labels step can plan it", async () => {
    modelAnswer = answer([2200, 300]);
    const out = await run();
    expectModelTreeKept(out);
    /* The tree is not cut: the long section is still one section of 2,200 leaves. */
    expect(bodyLeafSets(out.parts.tree).map((s) => s.leaves)).toEqual([2200, 300]);
    const sections = bodyLeafSets(out.parts.tree).map((s) => s.node);
    expect(sections.map((n) => n.title)).toEqual(["Section 0", "Section 1"]);
    expect(sections.map((n) => n.gist)).toEqual(["Section 0 says one thing.", "Section 1 says one thing."]);
    expect(out.parts.tree.nodes[out.parts.tree.rootId]!.gist).toBe("The piece says things.");
    /* Its calls are: windows of that one section, none over the batch size. */
    const long = planBatches(out.parts.tree, BLOCKS).flatMap((b) => b.sets).filter((s) => s.nodeId === sections[0]!.id);
    expect(long.length).toBeGreaterThan(1);
    expect(Math.max(...long.map((s) => s.blocks.length))).toBeLessThanOrEqual(MAX_BATCH);
    expect(long.reduce((n, s) => n + s.blocks.length, 0)).toBe(2200);
    expect(modelCalls).toBe(1);
    expect(out.wholeDocumentCalls).toBe(1);
    expect([out.inputTokens, out.outputTokens]).toEqual([7, 11]);
  });

  /* Reversed 2026-10-06. */
  it("and again when that answer is resumed from its checkpoint", async () => {
    modelAnswer = answer([2200, 300]);
    const checkpoints = memoryCheckpoints({ slug: SLUG, articleId: "a-1" });
    await run(checkpoints);
    const second = await run(checkpoints);
    expect(modelCalls, "the second run bought the answer again").toBe(1);
    expect(second.wholeDocumentResumed).toBe(true);
    expectModelTreeKept(second);
  });

  /* Reversed 2026-10-06: was "changes path exactly where the labels call would refuse". */
  it("does not change path where one labels call would refuse", async () => {
    expect(MOST_IN_ONE_LABELS_CALL).toBeGreaterThan(1000);
    for (const first of [MOST_IN_ONE_LABELS_CALL, MOST_IN_ONE_LABELS_CALL + 1]) {
      modelAnswer = answer([first, BLOCKS.length - first]);
      expectModelTreeKept(await run());
    }
  });

  it("nor beside a short section, where the planner's floor joins the two (review F1)", async () => {
    for (const sizes of [
      [1, MOST_IN_ONE_LABELS_CALL, BLOCKS.length - MOST_IN_ONE_LABELS_CALL - 1],
      [BLOCKS.length - MOST_IN_ONE_LABELS_CALL - 1, MOST_IN_ONE_LABELS_CALL, 1],
    ]) {
      modelAnswer = answer(sizes);
      const out = await run();
      expectModelTreeKept(out);
      expect(bodyLeafSets(out.parts.tree).map((s) => s.leaves)).toEqual(sizes);
    }
  });
});

describe("an ordinary model tree", () => {
  it("is kept, long sections and all, under the model's name", async () => {
    modelAnswer = answer([1250, 1250]);
    const out = await run();
    expect(out.source).toEqual({ by: "model" });
    expect(out.parts.tree.provisional).toBeUndefined();
    expect(out.parts.tree.generator).toBe(generatorFor("standard"));
    expect(out.model).toBe(generatorFor("standard"));
    expect(bodyLeafSets(out.parts.tree).map((s) => s.leaves)).toEqual([1250, 1250]);
  });

  it("cannot claim opening-words provenance, even if the model sends it", async () => {
    const proposed = JSON.parse(answer([1250, 1250]));
    proposed.root.titleFrom = "opening-words";
    for (const child of proposed.root.children) child.titleFrom = "opening-words";
    modelAnswer = JSON.stringify(proposed);
    const { root } = parseWholeDocumentAnswer(modelAnswer, BLOCKS);
    expect(root).not.toHaveProperty("titleFrom");
    expect(root.children!.every((n) => !("titleFrom" in n))).toBe(true);
    /* Check the builder independently of the parser's field allowlist. */
    Object.assign(root, { titleFrom: "opening-words" });
    for (const child of root.children!) Object.assign(child, { titleFrom: "opening-words" });
    expect(Object.values(buildTree(root, {}, BLOCKS, SLUG).nodes).every((n) => n.titleFrom === undefined)).toBe(true);
    const checkpoints = memoryCheckpoints({ slug: SLUG, articleId: "model-provenance" });
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await run(checkpoints);
      expect(out.source).toEqual({ by: "model" });
      expect(Object.values(out.parts.tree.nodes).every((n) => n.titleFrom === undefined)).toBe(true);
    }
    expect(modelCalls).toBe(1);
  });
});

describe("a root-only model tree beside a supplement", () => {
  for (const size of [1, 2, 3, 4, 2500]) {
    it(`plans a ${size}-block body without losing it beside the notes`, async () => {
      const blocks = [...paragraphs(size), note(0), { ...note(1), role: "reference" as const },
        { ...note(2), role: "credit" as const }];
      modelAnswer = JSON.stringify({
        root: { title: "The piece", gist: "The piece says things.", question: "What follows?" },
      });
      const checkpoints = memoryCheckpoints({ slug: SLUG, articleId: "root-only" });
      const generate = () => generateStructure({
        power: "standard", blocks, slug: SLUG, checkpoints, deepen: false,
      });
      const out = await generate();
      /* Reversed 2026-10-06 for 2,500: its one leaf set is windowed, not refused. */
      expect(out.source).toEqual({ by: "model" });
      expect(unaskableBatches(out.parts.tree, blocks)).toEqual([]);
      expect(planBatches(out.parts.tree, blocks).flatMap((batch) => batch.blocks.map((b) => b.id)))
        .toEqual(blocks.slice(0, size).map((b) => b.id));
      const resumed = await generate();
      expect(resumed.wholeDocumentResumed).toBe(true);
      expect(resumed.source).toEqual(out.source);
      expect(planBatches(resumed.parts.tree, blocks).flatMap((batch) => batch.blocks.map((b) => b.id)))
        .toEqual(blocks.slice(0, size).map((b) => b.id));
      expect(modelCalls).toBe(1);
    });
  }
});


/* Reversed 2026-10-06: was "replaces an unaskable deepened tree". */
it("keeps a deepened tree with a section too long for one labels call, and reports both passes' spend", async () => {
  modelAnswer = answer([2200, 300]);
  let expansionCalls = 0;
  const out = await generateStructure({
    power: "standard", blocks: BLOCKS, slug: SLUG,
    checkpoints: memoryCheckpoints({ slug: SLUG, articleId: "deepened" }), deepen: true,
    expansionExecutor: async (request) => {
      expansionCalls++;
      const sections = request.own.split(/^SECTION /m).filter((s) => s.trim() !== "");
      return {
        text: JSON.stringify({ sections: sections.map((section, i) => {
          const ids = [...section.matchAll(/spya-[a-z0-9]{6}/g)].map((m) => m[0]);
          const first = BLOCKS.findIndex((b) => b.id === ids[0]);
          const last = BLOCKS.findIndex((b) => b.id === ids.at(-1));
          return {
            section: i + 1,
            children: [first, last - 99].map((at, k) => ({
              start: BLOCKS[at]!.id, title: `Split ${i} ${k}`,
              gist: `This split makes a claim of its own.`, verdict: "finished",
            })),
          };
        }) }),
        usage: { inputTokens: 13, outputTokens: 17, cacheReadTokens: 19, cacheWriteTokens: 23 },
      };
    },
  });
  expect(expansionCalls).toBeGreaterThan(0);
  expect(out.deepenFailed).toBe(false);
  expect(out.deepen?.expanded).toBeGreaterThan(0);
  expect(out.source).toEqual({ by: "model" });
  expect(out.parts.tree.provisional).toBeUndefined();
  /* The fixture still holds what the old fallback fired on. */
  expect(Math.max(...bodyLeafSets(out.parts.tree).map((s) => s.leaves))).toBeGreaterThan(MOST_IN_ONE_LABELS_CALL);
  expect(unaskableBatches(out.parts.tree, BLOCKS)).toEqual([]);
  expect([out.inputTokens, out.outputTokens, out.cacheReadTokens, out.cacheWriteTokens])
    .toEqual([7 + 13 * expansionCalls, 11 + 17 * expansionCalls, 19 * expansionCalls, 23 * expansionCalls]);
});
