/**
 * **A model's tree the labels step could not ask about is not handed to it.**
 *
 * `generateStructure` takes the bounded headings tree
 * (src/heading-tree.ts § `buildBoundedHeadingTree`) when the whole-document
 * answer would not fit, which tests/stated-limits.test.ts pins. This file is
 * the other way in: the answer fits, the model's tree is sound, and one of its
 * sections is too long for a single labels call. Until 2026-10-05 that tree
 * was stored and the labels step then threw `TooLongForOnePass` on it.
 * Review F2 of
 * docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md.
 *
 * The threshold is the labels step's own refusal (`labelCallBudget`), not its
 * batch size: a paid tree is not thrown away for a seventy-paragraph section.
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

const { generateStructure } = await import("../src/structure.js");
const { BOUNDED_TREE_GENERATOR, BOUNDED_TREE_VERSION } = await import("../src/heading-tree.js");
const { labelCallBudget, planBatches } = await import("../src/labels.js");
const { generatorFor } = await import("../src/models.js");
const { TooLongForOnePass } = await import("../src/token-budget.js");
const { memoryCheckpoints } = await import("./helpers/memory-checkpoints.js");
const { bodyLeafSets, expectBoundedTree, paragraphs, note } = await import("./helpers/bounded-tree.js");

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

/** The most blocks one labels call may be asked for, found from the labels step's own arithmetic. */
const MOST_IN_ONE_LABELS_CALL = ((): number => {
  for (let n = 1; ; n++) {
    try {
      labelCallBudget(n + 1);
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

describe("a model tree with a section the labels step could not ask about", () => {
  it("is replaced by the bounded headings tree, and the run says so", async () => {
    modelAnswer = answer([2200, 300]);
    const out = await run();
    expect(out.source).toEqual({ by: "headings", reason: "labels-could-not-ask" });
    expectBoundedTree(BLOCKS, out.parts.tree);
    /* Not the model's name on a tree no model cut. */
    expect(out.parts.tree.generator).toBe(BOUNDED_TREE_GENERATOR);
    expect(out.model).toBe(BOUNDED_TREE_GENERATOR);
    expect(out.parts.labels.structureVersion).toBe(BOUNDED_TREE_VERSION);
    /* The call was made and paid for, and the run does not pretend otherwise. */
    expect(modelCalls).toBe(1);
    expect(out.wholeDocumentCalls).toBe(1);
    expect([out.inputTokens, out.outputTokens]).toEqual([7, 11]);
  });

  it("and again when that answer is resumed from its checkpoint", async () => {
    modelAnswer = answer([2200, 300]);
    const checkpoints = memoryCheckpoints({ slug: SLUG, articleId: "a-1" });
    await run(checkpoints);
    const second = await run(checkpoints);
    expect(modelCalls, "the second run bought the answer again").toBe(1);
    expect(second.wholeDocumentResumed).toBe(true);
    expect(second.source).toEqual({ by: "headings", reason: "labels-could-not-ask" });
    expectBoundedTree(BLOCKS, second.parts.tree);
  });

  it("changes path exactly where the labels call would refuse", async () => {
    expect(MOST_IN_ONE_LABELS_CALL).toBeGreaterThan(1000);
    modelAnswer = answer([MOST_IN_ONE_LABELS_CALL, BLOCKS.length - MOST_IN_ONE_LABELS_CALL]);
    expect((await run()).source).toEqual({ by: "model" });
    modelAnswer = answer([MOST_IN_ONE_LABELS_CALL + 1, BLOCKS.length - MOST_IN_ONE_LABELS_CALL - 1]);
    expect((await run()).source).toEqual({ by: "headings", reason: "labels-could-not-ask" });
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
      expect(out.source).toEqual(size === 2500
        ? { by: "headings", reason: "labels-could-not-ask" }
        : { by: "model" });
      expect(planBatches(out.parts.tree, blocks).flatMap((batch) => batch.blocks.map((b) => b.id)))
        .toEqual(blocks.slice(0, size).map((b) => b.id));
      if (size === 2500) {
        expectBoundedTree(blocks, out.parts.tree);
        expect([out.inputTokens, out.outputTokens]).toEqual([7, 11]);
      }
      const resumed = await generate();
      expect(resumed.wholeDocumentResumed).toBe(true);
      expect(resumed.source).toEqual(out.source);
      expect(planBatches(resumed.parts.tree, blocks).flatMap((batch) => batch.blocks.map((b) => b.id)))
        .toEqual(blocks.slice(0, size).map((b) => b.id));
      expect(modelCalls).toBe(1);
    });
  }
});


it("replaces an unaskable deepened tree and reports both passes' spend", async () => {
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
  expect(out.source).toEqual({ by: "headings", reason: "labels-could-not-ask" });
  expectBoundedTree(BLOCKS, out.parts.tree);
  expect([out.inputTokens, out.outputTokens, out.cacheReadTokens, out.cacheWriteTokens])
    .toEqual([7 + 13 * expansionCalls, 11 + 17 * expansionCalls, 19 * expansionCalls, 23 * expansionCalls]);
});
