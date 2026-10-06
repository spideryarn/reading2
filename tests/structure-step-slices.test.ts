/**
 * **A document too long for one structure answer is asked about in slices**,
 * and gets the headings tree whenever that does not make a sound tree.
 * src/structure-slices.ts, wired in at src/structure.ts § `generateStructure`.
 * docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md
 * § "Stage E, as it will be built".
 *
 * No network: `streamMessage` is a fake that reads each request and answers
 * over exactly the blocks in it (tests/helpers/slice-model.ts). Two checks the
 * slices cannot fail by any answer a slice-sized call can give (the whole-tree
 * invariants and the labels check) are forced through a switch on the real
 * function, so those two tests are about the wiring and say so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessagesBody } from "../src/messages-stream.js";
import type { Block, Tree } from "../src/types.js";
import { askedIds, isRootCall, messageOf, ROOT_ANSWER, ROOT_ONLY, sectionsAnswer, USAGE } from "./helpers/slice-model.js";

interface Call {
  n: number;
  root: boolean;
  ids: string[];
  /** Did the user message begin with the slice note? */
  noted: boolean;
  signal: AbortSignal | undefined;
}
let calls: Call[] = [];
/** What the model does with one call: an answer, a whole message, or a throw. */
let respond: (call: Call) => unknown = () => "";
let forceUnsound = false;
let forceUnaskable = false;

vi.mock("../src/messages-stream.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/messages-stream.js")>()),
  streamMessage: (_task: string, params: MessagesBody, options: { signal?: AbortSignal }) => {
    const call: Call = {
      n: calls.length,
      root: isRootCall(params),
      ids: askedIds(params),
      noted: String(params.messages[0]!.content).startsWith(SLICE_NOTE),
      signal: options.signal,
    };
    calls.push(call);
    return {
      onText: () => {},
      attempts: () => 1,
      finalMessage: async () => {
        const out = await respond(call);
        return typeof out === "string" ? messageOf(out) : out;
      },
    };
  },
}));
vi.mock("../src/tree-invariants.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/tree-invariants.js")>();
  return {
    ...real,
    assertTreeSound: (blocks: Block[], tree: Tree) => {
      if (forceUnsound && blocks.length === N && !tree.provisional) throw new Error("forced: the stitched tree is unsound");
      real.assertTreeSound(blocks, tree);
    },
  };
});
vi.mock("../src/labels.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/labels.js")>();
  return {
    ...real,
    unaskableBatches: (tree: Tree, blocks: Block[]) =>
      forceUnaskable && !tree.provisional ? [{ blocks: [] }] : real.unaskableBatches(tree, blocks),
  };
});

const { generateStructure, wholeDocumentRequest } = await import("../src/structure.js");
const {
  planSlices,
  promotedSections,
  ROOT_CALL_CAP_MS,
  seamsHeld,
  SLICE_CALL_CAP_MS,
  SLICE_CONCURRENCY,
  SLICE_NOTE,
  SLICES_FINISH_RESERVE_MS,
  sliceStarts,
  slicesDeadline,
} = await import("../src/structure-slices.js");
const { buildBoundedHeadingTree } = await import("../src/heading-tree.js");
const { generatorFor } = await import("../src/models.js");
const { checkTree } = await import("../src/tree-invariants.js");
const { memoryCheckpoints } = await import("./helpers/memory-checkpoints.js");
const { block, expectBoundedTree, heading, paragraphs, prose } = await import("./helpers/bounded-tree.js");
const { DENSITIES, plainBlocks } = await import("./helpers/synthetic-blocks.js");

const SLUG = "slices";
const N = 3000;
/** Headingless and past the one-answer ceiling (2,889), so the slices path runs. */
const BLOCKS: Block[] = paragraphs(N);
const INDEX = new Map(BLOCKS.map((b, i) => [b.id, i]));

const fresh = () => memoryCheckpoints({ slug: SLUG, articleId: "a-1" });
const run = (over: Partial<Parameters<typeof generateStructure>[0]> = {}) =>
  generateStructure({
    power: "standard",
    blocks: BLOCKS,
    slug: SLUG,
    articleTitle: "A long piece",
    checkpoints: fresh(),
    ...over,
  });

/** Every slice answered in chapters of a hundred, the root answered properly. */
const answers = (call: Call): string => (call.root ? ROOT_ANSWER : sectionsAnswer(call.ids));
/** A call that never answers until its signal aborts. */
const hang = (call: Call): Promise<never> =>
  new Promise((_, reject) => {
    call.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
const slicesAsked = (): Call[] => calls.filter((c) => !c.root);
const topLevel = (tree: Tree) => tree.nodes[tree.rootId]!.children.map((id) => tree.nodes[id]!);
const fits = (blocks: Block[]): boolean => {
  try {
    wholeDocumentRequest(blocks);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  calls = [];
  respond = answers;
  forceUnsound = false;
  forceUnaskable = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the slice planner", () => {
  const dense = DENSITIES.find((d) => d.name === "dense paper")!;
  const bare = DENSITIES.find((d) => d.name === "headingless prose")!;
  const giant = (subHeadings: boolean): Block[] => [
    heading("The whole book", 1),
    ...Array.from({ length: 3200 }, (_, i) =>
      subHeadings && i % 80 === 0 ? heading(`Story ${i / 80}`, 2) : block(prose(i)),
    ),
  ];
  const shapes: [string, () => Block[], boolean][] = [
    ["a dense paper at 250 pages", () => plainBlocks(Math.round(250 * dense.blocksPerPage), dense).blocks, true],
    ["6,000 headingless blocks", () => plainBlocks(6000, bare).blocks, false],
    ["one giant part with sub-headings", () => giant(true), true],
    ["one giant part with none", () => giant(false), false],
  ];
  for (const [name, make, onHeadings] of shapes) {
    it(`cuts ${name} into slices that fit, tile the body and do not move`, () => {
      const body = make();
      expect(fits(body)).toBe(false);
      const plan = () => planSlices(body, sliceStarts(body, buildBoundedHeadingTree(body, "p", "T").tree), fits)!;
      const slices = plan();
      expect(slices.length).toBeGreaterThanOrEqual(Math.ceil(body.length / 1000));
      expect(slices.every((s) => fits(body.slice(s.lo, s.hi + 1)))).toBe(true);
      expect(slices[0]!.lo).toBe(0);
      expect(slices.at(-1)!.hi).toBe(body.length - 1);
      expect(slices.slice(1).map((s) => s.lo)).toEqual(slices.slice(0, -1).map((s) => s.hi + 1));
      /* Near a thousand each: none under half, none over half as much again. */
      expect(Math.min(...slices.map((s) => s.hi - s.lo + 1))).toBeGreaterThan(500);
      expect(Math.max(...slices.map((s) => s.hi - s.lo + 1))).toBeLessThan(1500);
      if (onHeadings) expect(slices.slice(1).map((s) => body[s.lo]!.kind)).toEqual(slices.slice(1).map(() => "heading"));
      /* No seam one block after a heading, which the final build would move. */
      expect(slices.slice(1).filter((s) => body[s.lo]!.kind !== "heading" && body[s.lo - 1]!.kind === "heading")).toEqual([]);
      expect(plan()).toEqual(slices);
    }, 120_000);
  }

  it("prefers a part start, then an authored section, then a window", () => {
    const body = paragraphs(2000);
    const all = () => true;
    expect(planSlices(body, { parts: [900], authored: [990], windows: [1000] }, all)).toEqual([
      { lo: 0, hi: 899, startsOn: "body-start" },
      { lo: 900, hi: 1999, startsOn: "part" },
    ]);
    expect(planSlices(body, { parts: [400], authored: [990], windows: [1000] }, all)![1]).toEqual(
      { lo: 990, hi: 1999, startsOn: "authored-section" },
    );
    expect(planSlices(body, { parts: [400], authored: [300], windows: [600, 1100] }, all)![1]).toEqual(
      { lo: 1100, hi: 1999, startsOn: "window" },
    );
    /* A slice that does not fit means one more slice, not a refusal. */
    expect(planSlices(body, { parts: [], authored: [], windows: [500, 660, 1000, 1340, 1500] }, (b) => b.length < 900))
      .toHaveLength(3);
    expect(planSlices(body, { parts: [], authored: [], windows: [] }, all)).toBeNull();
  });

  it("moves a cut that falls one block after a heading back onto it", () => {
    const body = paragraphs(2000);
    body[999] = heading("A late heading", 4);
    expect(planSlices(body, { parts: [], authored: [], windows: [1000] }, () => true)![1]!.lo).toBe(999);
  });
});

describe("what a slice may contribute (review F15)", () => {
  const given = BLOCKS.slice(100, 200);
  const section = (lo: number, hi: number) => ({ title: "t", gist: "g", range: [BLOCKS[lo]!.id, BLOCKS[hi]!.id] as [string, string] });
  const root = (children?: ReturnType<typeof section>[]) => ({ ...section(100, 199), ...(children ? { children } : {}) });

  it("is its sections, when they tile exactly the blocks it was given", () => {
    expect(promotedSections(root([section(100, 149), section(150, 199)]), given)).toHaveLength(2);
  });
  it("is nothing when the root has no sections, a gap, or a short end", () => {
    expect(() => promotedSections(root(), given)).toThrow(/no sections/);
    expect(() => promotedSections(root([]), given)).toThrow(/no sections/);
    expect(() => promotedSections(root([section(100, 149), section(151, 199)]), given)).toThrow(/tile/);
    expect(() => promotedSections(root([section(101, 199)]), given)).toThrow(/tile/);
    expect(() => promotedSections(root([section(100, 149), section(150, 198)]), given)).toThrow(/last block/);
    expect(() => promotedSections(root([section(100, 149), section(150, 250)]), given)).toThrow(/tile/);
  });
  it("and the final build must keep every section and start one at every seam", () => {
    const tree = (starts: number[]): Tree => {
      const nodes: Tree["nodes"] = { r: { id: "r", depth: 0, parent: null, children: [], range: ["a", "z"], title: "r" } };
      for (const s of starts) {
        nodes[`n${s}`] = { id: `n${s}`, depth: 1, parent: "r", children: [], range: [`b${s}`, `b${s}`], title: "s" };
        nodes.r!.children.push(`n${s}`);
      }
      return { version: "v", generator: "g", slug: "s", rootId: "r", nodes };
    };
    expect(seamsHeld(tree([0, 5, 9]), 3, ["b5"])).toBe(true);
    expect(seamsHeld(tree([0, 4, 9]), 3, ["b5"]), "a seam moved").toBe(false);
    expect(seamsHeld(tree([0, 5]), 3, ["b5"]), "a section was dropped").toBe(false);
  });
});

describe("the slices path, when the model answers", () => {
  it("returns a finished tree under the model's name, and says how it was made", async () => {
    const out = await run();
    expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 0, reasked: 0, secondPass: 0 });
    expect(checkTree(BLOCKS, out.parts.tree).problems).toEqual([]);
    expect(out.parts.tree.provisional).toBeUndefined();
    expect(out.parts.tree.generator).toBe(generatorFor("standard"));
    expect(out.model).toBe(generatorFor("standard"));
    /* Three slices and the root, each counted, each paid. */
    expect(calls.map((c) => c.root)).toEqual([false, false, false, true]);
    expect(out.wholeDocumentCalls).toBe(4);
    expect(out.wholeDocumentResumed).toBe(false);
    expect([out.inputTokens, out.outputTokens]).toEqual([4 * USAGE.input_tokens, 4 * USAGE.output_tokens]);
    /* The slices tile the body, and each was shown the note. */
    expect(slicesAsked().flatMap((c) => c.ids)).toEqual(BLOCKS.map((b) => b.id));
    /* The root: the article's title, the root call's gist and question. */
    const rootNode = out.parts.tree.nodes[out.parts.tree.rootId]!;
    expect(rootNode.title).toBe("A long piece");
    expect([rootNode.gist, rootNode.question]).toEqual(Object.values(JSON.parse(ROOT_ANSWER)));
    /* Every slice's chapters are the tree's top level, in order, a seam at each slice start. */
    const top = topLevel(out.parts.tree);
    const chapters = slicesAsked().map((c) => JSON.parse(sectionsAnswer(c.ids)).root.children.length as number);
    expect(top).toHaveLength(chapters.reduce((a, b) => a + b, 0));
    for (const c of slicesAsked()) expect(top.some((n) => n.range[0] === c.ids[0])).toBe(true);
    expect([out.repairedRanges, out.droppedChildren]).toEqual([0, 0]);
  });

  it("puts the note ahead of every slice's and refill's blocks, and not ahead of the root's", async () => {
    await run();
    expect(calls.map((c) => c.noted)).toEqual([true, true, true, false]);
    expect(SLICE_NOTE).toMatch(/one stretch of a longer document/);
  });

  it("runs no more than eight slice calls at once", async () => {
    const long = paragraphs(11_000);
    let inFlight = 0;
    let most = 0;
    respond = async (call) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return answers(call);
    };
    const out = await run({ blocks: long });
    expect(out.source).toMatchObject({ by: "slices", slices: 11 });
    expect(most).toBe(SLICE_CONCURRENCY);
  }, 60_000);
});

describe("a slice whose answer is a root and nothing else (review F15)", () => {
  const middleOnly = (times: number) => {
    let left = times;
    respond = (call) => {
      if (!call.root && INDEX.get(call.ids[0]!)! > 0 && INDEX.get(call.ids.at(-1)!)! < N - 1 && left-- > 0) return ROOT_ONLY;
      return answers(call);
    };
  };

  it("is asked for once more, and the second answer is used", async () => {
    middleOnly(1);
    const out = await run();
    expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 0, reasked: 1, secondPass: 0 });
    expect(out.wholeDocumentCalls).toBe(5);
    expect(checkTree(BLOCKS, out.parts.tree).problems).toEqual([]);
  });

  it("twice, is asked for once more after the other slices, and that answer is used", async () => {
    middleOnly(2);
    const out = await run();
    expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 0, reasked: 1, secondPass: 1 });
    expect(out.wholeDocumentCalls).toBe(6);
    expect(checkTree(BLOCKS, out.parts.tree).problems).toEqual([]);
  });

  it("three times, gives the headings tree, with no neighbour stretched over it", async () => {
    middleOnly(3);
    const out = await run();
    expect(out.source).toEqual({ by: "headings", reason: "answer-too-long", slicesFailed: "slice-failed" });
    expectBoundedTree(BLOCKS, out.parts.tree);
    /* Two good slices and the middle one three times were paid for; the root was never asked. */
    expect(calls.filter((c) => c.root)).toHaveLength(0);
    expect(out.wholeDocumentCalls).toBe(5);
    expect([out.inputTokens, out.outputTokens]).toEqual([5 * USAGE.input_tokens, 5 * USAGE.output_tokens]);
  });
});

describe("a top-level section that came back undivided", () => {
  /** The first slice's first chapter is `size` blocks with nothing under it. */
  const undivided = (size: number, refill: (call: Call) => unknown) => {
    respond = (call) => {
      if (call.root) return ROOT_ANSWER;
      if (call.ids.length === size) return refill(call);
      if (INDEX.get(call.ids[0]!) !== 0) return answers(call);
      const answer = JSON.parse(sectionsAnswer(call.ids.slice(size)));
      answer.root.children.unshift({ title: "Undivided", gist: "It says one long thing.", question: "It — why?", start: call.ids[0] });
      return JSON.stringify(answer);
    };
  };
  const refills = (size: number): Call[] => calls.filter((c) => c.ids.length === size);

  it("over sixty blocks is asked for once as a slice of its own, and its sections replace it", async () => {
    undivided(130, (call) => sectionsAnswer(call.ids, 50));
    const out = await run();
    expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 1, reasked: 0, secondPass: 0 });
    expect(refills(130)).toHaveLength(1);
    expect(out.wholeDocumentCalls).toBe(5);
    const top = topLevel(out.parts.tree);
    expect(top.some((n) => n.title === "Undivided")).toBe(false);
    expect(top.slice(0, 2).map((n) => INDEX.get(n.range[1])! - INDEX.get(n.range[0])! + 1)).toEqual([50, 80]);
    expect(checkTree(BLOCKS, out.parts.tree).problems).toEqual([]);
  });

  it("of sixty or fewer is left alone", async () => {
    undivided(60, () => {
      throw new Error("a small section was refilled");
    });
    const out = await run();
    expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 0, reasked: 0, secondPass: 0 });
    expect(out.wholeDocumentCalls).toBe(4);
  });

  /* Until 261005j stage 1a a started refill that failed gave the headings tree
     (261005a's review finding F28). It is an optional call, and now cannot. */
  it("is kept when a started refill fails or contributes no section", async () => {
    for (const refill of [
      () => {
        throw new Error("the refill call failed");
      },
      () => ROOT_ONLY,
    ]) {
      calls = [];
      undivided(130, refill);
      const out = await run();
      expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 0, reasked: 0, secondPass: 0 });
      expect(refills(130), "a refill is asked for once, never re-asked").toHaveLength(1);
      expect(topLevel(out.parts.tree)[0]!.title).toBe("Undivided");
      expect(checkTree(BLOCKS, out.parts.tree).problems).toEqual([]);
      expect(calls.filter((c) => c.root)).toHaveLength(1);
      expect(out.wholeDocumentCalls).toBe(5);
    }
  });

  it("is kept when the refill returns one valid section, including the same giant section", async () => {
    undivided(130, (call) => sectionsAnswer(call.ids, 500, true));
    const out = await run();
    expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 0, reasked: 0, secondPass: 0 });
    expect(topLevel(out.parts.tree)[0]!.title).toBe("Undivided");
    expect(refills(130)).toHaveLength(1);
  });

  it("is not refilled a second time when the refill is itself undivided", async () => {
    undivided(200, (call) => sectionsAnswer(call.ids, 100, true));
    const out = await run();
    expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 1, reasked: 0, secondPass: 0 });
    expect(calls.filter((c) => !c.root && c.ids.length <= 200)).toHaveLength(1);
  });
});

describe("a failure gives the headings tree, and says what was spent", () => {
  it("waits for every slice already started, and keeps their answers, before returning", async () => {
    const checkpoints = fresh();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let returned = false;
    respond = async (call) => {
      if (INDEX.get(call.ids[0]!) === 0) return ROOT_ONLY;
      await gate;
      return answers(call);
    };
    const going = run({ checkpoints }).then((out) => {
      returned = true;
      return out;
    });
    /* The first slice has failed twice by now; its two peers are still out, and
       its one further ask waits for them. */
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(4);
    expect(returned, "returned while two paid calls were still running").toBe(false);
    expect(checkpoints.entries.size).toBe(0);
    release();
    const out = await going;
    expect(out.source).toEqual({ by: "headings", reason: "answer-too-long", slicesFailed: "slice-failed" });
    expectBoundedTree(BLOCKS, out.parts.tree);
    expect(checkpoints.entries.size, "the two good answers were not kept").toBe(2);
    expect(out.wholeDocumentCalls).toBe(5);
    expect([out.inputTokens, out.outputTokens]).toEqual([5 * USAGE.input_tokens, 5 * USAGE.output_tokens]);
  });

  it("a slice that fails does not stop the others, and is asked for once more", async () => {
    const long = paragraphs(11_000);
    respond = async (call) => {
      if (call.n === 0) throw new Error("the first slice's call failed");
      await new Promise((r) => setTimeout(r, 5));
      return answers(call);
    };
    const out = await run({ blocks: long });
    expect(out.source).toEqual({ by: "slices", slices: 11, refilled: 0, reasked: 0, secondPass: 1 });
    /* Eleven slices, the first one again, and the root. */
    expect(calls).toHaveLength(13);
    expect(out.wholeDocumentCalls).toBe(13);
  }, 60_000);

  it("starts nothing new after a slice has failed in both passes", async () => {
    const long = paragraphs(11_000);
    respond = async (call) => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error(`call ${call.n} failed`);
    };
    const out = await run({ blocks: long });
    expect(out.source).toMatchObject({ by: "headings", slicesFailed: "slice-failed" });
    /* All eleven in the first pass; in the second, the eight in flight when the first of them failed. */
    expect(calls).toHaveLength(11 + SLICE_CONCURRENCY);
    expect(out.wholeDocumentCalls).toBe(11 + SLICE_CONCURRENCY);
    expect(out.inputTokens).toBe(0);
  }, 60_000);

  it("a slice that is refused or cut short is paid for, and read in two halves", async () => {
    for (const stop of ["refusal", "max_tokens"]) {
      calls = [];
      respond = (call) => (call.n === 1 ? messageOf(sectionsAnswer(call.ids), stop) : answers(call));
      const out = await run();
      expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 0, reasked: 0, secondPass: 0 });
      /* Three slices, the refused one's two halves, and the root. */
      expect(calls.map((c) => c.root)).toEqual([false, false, false, false, false, true]);
      expect(calls[3]!.ids.concat(calls[4]!.ids)).toEqual(calls[1]!.ids);
      expect(out.wholeDocumentCalls).toBe(6);
      expect(out.inputTokens).toBe(6 * USAGE.input_tokens);
      expect(checkTree(BLOCKS, out.parts.tree).problems).toEqual([]);
      expect(topLevel(out.parts.tree).some((n) => n.range[0] === calls[4]!.ids[0])).toBe(true);
    }
  });

  it("when the root call fails", async () => {
    respond = (call) => {
      if (call.root) throw new Error("the root call failed");
      return answers(call);
    };
    const out = await run();
    expect(out.source).toEqual({ by: "headings", reason: "answer-too-long", slicesFailed: "root-call-failed" });
    expectBoundedTree(BLOCKS, out.parts.tree);
    expect(out.wholeDocumentCalls).toBe(4);
    expect(out.inputTokens).toBe(3 * USAGE.input_tokens);
  });

  it("when the root answer fails its gate twice", async () => {
    for (const bad of [
      { gist: "  ", question: "Topic — why?" },
      { gist: Array.from({ length: 41 }, () => "word").join(" "), question: "Topic — why?" },
      { gist: "The pieces share one worry." },
      { gist: "The pieces share one worry.", question: "The pieces share one worry?" },
    ]) {
      calls = [];
      respond = (call) => (call.root ? JSON.stringify(bad) : answers(call));
      const out = await run();
      expect(out.source, JSON.stringify(bad)).toMatchObject({ by: "headings", slicesFailed: "root-call-failed" });
      expect(calls.filter((c) => c.root)).toHaveLength(2);
      expect(out.wholeDocumentCalls).toBe(5);
    }
  });

  it("when the stitched tree is not sound (forced: wiring only)", async () => {
    forceUnsound = true;
    const out = await run();
    expect(out.source).toEqual({ by: "headings", reason: "answer-too-long", slicesFailed: "tree-unsound" });
    expectBoundedTree(BLOCKS, out.parts.tree);
    expect(out.wholeDocumentCalls).toBe(4);
    expect(out.outputTokens).toBe(4 * USAGE.output_tokens);
  });

});

/* **Reversed 2026-10-06.** This was the last "falls back" case: with
   `unaskableBatches` forced to answer "one", the stitched tree was thrown away
   (`slicesFailed: "labels-could-not-ask"`). The labels planner now cuts such a
   section's call into windows, so the structure step no longer asks, and the
   same forcing must change nothing. Stage A of plan 261005j. */
it("the stitched tree is kept whatever `unaskableBatches` would say of it (forced: wiring only)", async () => {
  forceUnaskable = true;
  const out = await run();
  expect(out.source).toMatchObject({ by: "slices" });
  expect(out.parts.tree.provisional).toBeUndefined();
});

describe("checkpoints (review F18)", () => {
  it("a second run on the same blocks asks for nothing", async () => {
    const checkpoints = fresh();
    let refilled = false;
    respond = (call) => {
      if (call.root) return ROOT_ANSWER;
      if (call.ids.length === 130) return sectionsAnswer(call.ids, 50);
      if (INDEX.get(call.ids[0]!) !== 0) return answers(call);
      refilled = true;
      const answer = JSON.parse(sectionsAnswer(call.ids.slice(130)));
      answer.root.children.unshift({ title: "Undivided", gist: "It says one long thing.", question: "It — why?", start: call.ids[0] });
      return JSON.stringify(answer);
    };
    const first = await run({ checkpoints });
    expect(refilled).toBe(true);
    expect(first.source).toMatchObject({ by: "slices", refilled: 1 });
    /* Three slices, one refill and the root, each under a key of its own. */
    expect(checkpoints.entries.size).toBe(5);
    calls = [];
    const second = await run({ checkpoints });
    expect(calls, "the second run bought something again").toHaveLength(0);
    expect(second.source).toEqual(first.source);
    expect(second.wholeDocumentResumed).toBe(true);
    expect([second.wholeDocumentCalls, second.inputTokens, second.outputTokens]).toEqual([0, 0, 0]);
    expect(second.parts.tree).toEqual(first.parts.tree);
  });

  it("a run after one slice failed buys only that slice, and the root", async () => {
    const checkpoints = fresh();
    respond = (call) => (!call.root && INDEX.get(call.ids[0]!) === 0 ? ROOT_ONLY : answers(call));
    expect((await run({ checkpoints })).source).toMatchObject({ by: "headings" });
    calls = [];
    respond = answers;
    const out = await run({ checkpoints });
    expect(out.source).toMatchObject({ by: "slices" });
    expect(calls.map((c) => (c.root ? "root" : INDEX.get(c.ids[0]!)))).toEqual([0, "root"]);
    expect(out.wholeDocumentCalls).toBe(2);
    expect(out.wholeDocumentResumed).toBe(false);
  });

  it("a stored slice answer that no longer passes is bought again and replaced", async () => {
    const checkpoints = fresh();
    await run({ checkpoints });
    const [key, json] = [...checkpoints.entries].find(([, v]) => v.includes(BLOCKS[1500]!.id))!;
    checkpoints.entries.set(key, JSON.stringify({ ...JSON.parse(json), answer: ROOT_ONLY }));
    calls = [];
    const out = await run({ checkpoints });
    expect(out.source).toMatchObject({ by: "slices" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ids).toContain(BLOCKS[1500]!.id);
    expect(checkpoints.entries.get(key)).toContain(BLOCKS[1500]!.id);
  });
});

describe("the deadline (review F16)", () => {
  const T0 = 1_800_000_000_000;
  /** The least a step may have left for one slice call and the root call after it. */
  const JUST_ENOUGH = SLICES_FINISH_RESERVE_MS + SLICE_CALL_CAP_MS + ROOT_CALL_CAP_MS;

  it("is the earlier of the step's budget and the queue's deadline, less the reserve", () => {
    expect(slicesDeadline(100, 700_000, 100 + 740_000)).toBe(100 + 700_000 - SLICES_FINISH_RESERVE_MS);
    expect(slicesDeadline(100, 700_000, 100 + 90_000)).toBe(100 + 90_000 - SLICES_FINISH_RESERVE_MS);
    expect(slicesDeadline(100, undefined, 500_000)).toBe(500_000 - SLICES_FINISH_RESERVE_MS);
    expect(slicesDeadline(100)).toBe(Infinity);
  });

  it("starts no call it could not finish in time, and returns the headings tree", async () => {
    vi.useFakeTimers({ now: T0 });
    for (const over of [{ stepBudgetMs: JUST_ENOUGH - 1 }, { deadlineAt: T0 + JUST_ENOUGH - 1 }]) {
      calls = [];
      const out = await run(over);
      expect(out.source).toEqual({ by: "headings", reason: "answer-too-long", slicesFailed: "out-of-time" });
      expect(calls).toHaveLength(0);
      expect(out.wholeDocumentCalls).toBe(0);
      expectBoundedTree(BLOCKS, out.parts.tree);
    }
    /* One millisecond more and the calls are admitted. */
    calls = [];
    expect((await run({ stepBudgetMs: JUST_ENOUGH })).source).toMatchObject({ by: "slices" });
  });

  it("aborts a call that outruns its cap with a signal of its own, waits, and returns the headings tree in time", async () => {
    vi.useFakeTimers({ now: T0 });
    const stop = new AbortController();
    const deadlineAt = T0 + 740_000;
    respond = (call) => (call.n === 1 ? hang(call) : answers(call));
    let out: Awaited<ReturnType<typeof run>> | undefined;
    const going = run({ stepBudgetMs: 700_000, deadlineAt, signal: stop.signal }).then((o) => (out = o));
    await vi.advanceTimersByTimeAsync(SLICE_CALL_CAP_MS - 1);
    expect(out, "returned before the hanging call was settled").toBeUndefined();
    expect(calls[1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await going;
    expect(out!.source).toEqual({ by: "headings", reason: "answer-too-long", slicesFailed: "out-of-time" });
    expectBoundedTree(BLOCKS, out!.parts.tree);
    /* Its own signal, not the queue's: the queue's would end the job as interrupted. */
    expect(calls[1]!.signal).not.toBe(stop.signal);
    expect(calls[1]!.signal!.aborted).toBe(true);
    expect(stop.signal.aborted).toBe(false);
    expect(Date.now()).toBeLessThan(deadlineAt);
    /* All three calls count; the aborted one has no usage to read. */
    expect(out!.wholeDocumentCalls).toBe(3);
  });

  it("skips a refill there is no time for, and still finishes the tree", async () => {
    vi.useFakeTimers({ now: T0 });
    respond = async (call) => {
      if (call.root) return ROOT_ANSWER;
      if (call.ids.length === 130) throw new Error("a refill was started with no time for it");
      /* Each slice takes a second, which is what leaves the refill short. */
      await new Promise((r) => setTimeout(r, 1000));
      if (INDEX.get(call.ids[0]!) !== 0) return answers(call);
      const answer = JSON.parse(sectionsAnswer(call.ids.slice(130)));
      answer.root.children.unshift({ title: "Undivided", gist: "It says one long thing.", question: "It — why?", start: call.ids[0] });
      return JSON.stringify(answer);
    };
    const going = run({ stepBudgetMs: JUST_ENOUGH });
    await vi.advanceTimersByTimeAsync(1000);
    const out = await going;
    expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 0, reasked: 0, secondPass: 0 });
    expect(topLevel(out.parts.tree)[0]!.title).toBe("Undivided");
  });

  it("a reader's Stop is a cancellation, not the headings tree", async () => {
    const stop = new AbortController();
    respond = (call) => (call.n === 1 ? hang(call) : answers(call));
    const going = run({ signal: stop.signal });
    await new Promise((r) => setTimeout(r, 20));
    stop.abort();
    await expect(going).rejects.toThrow();
    expect(calls.filter((c) => c.root)).toHaveLength(0);
  });
});
