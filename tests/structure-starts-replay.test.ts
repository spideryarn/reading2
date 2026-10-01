import { describe, expect, it } from "vitest";
import type { ModelNode } from "../src/hierarchy.js";
import {
  gateReplayResults,
  rangedAnswerWithoutEnds,
  replayStructureAnswer,
  type ReplayResult,
} from "../evals/paperwork/structure-starts-replay.js";
import type { Block } from "../src/types.js";

const blocks: Block[] = Array.from({ length: 6 }, (_, i) => ({
  id: `spya-r${String(i).padStart(5, "0")}`,
  tag: i === 1 ? "h2" : "p",
  kind: i === 1 ? "heading" : "text",
  ...(i === 1 ? { level: 2 } : {}),
  text: i === 1 ? "Secret authored heading" : `Secret article prose ${i}`,
  words: 3,
  html: "<p>withheld</p>",
  gistable: true,
}));
const id = (i: number) => blocks[i]!.id;

const agreeing: ModelNode = {
  title: "Secret model root",
  range: [id(0), id(5)],
  children: [
    { title: "Secret model first", range: [id(0), id(2)] },
    { title: "Secret model second", range: [id(3), id(5)] },
  ],
};

describe("the starts-only offline replay", () => {
  it("deletes every end without mutating the ranged answer", () => {
    const before = structuredClone(agreeing);
    expect(rangedAnswerWithoutEnds({ root: agreeing })).toEqual({
      root: {
        title: "Secret model root",
        children: [
          { title: "Secret model first", start: id(0) },
          { title: "Secret model second", start: id(3) },
        ],
      },
    });
    expect(agreeing).toEqual(before);
  });

  it("reports an agreeing ranged answer as an identical replay", () => {
    const result = replayStructureAnswer("answer-1", { root: agreeing }, blocks);
    expect(result).toMatchObject({
      label: "answer-1",
      baselineBuildable: true,
      newlyUnbuildable: false,
      additionalDroppedChildren: 0,
      lostAuthoredHeadings: 0,
      identical: true,
      diff: [],
    });
  });

  it("finds the child an end fallback kept and starts-only drops", () => {
    const fallback: ModelNode = {
      title: "Secret root",
      range: [id(0), id(5)],
      children: [
        { title: "Secret preamble", range: [id(0), id(0)] },
        {
          title: "Secret authored part",
          range: [id(0), id(3)],
          sourceHeading: "Secret authored heading",
        },
        { title: "Secret close", range: [id(4), id(5)] },
      ],
    };
    const result = replayStructureAnswer("fallback", { root: fallback }, blocks);
    expect(result.baselineBuildable).toBe(true);
    expect(result.newlyUnbuildable).toBe(false);
    expect(result.additionalDroppedChildren).toBe(1);
    expect(result.lostAuthoredHeadings).toBe(1);
    expect(result.identical).toBe(false);
    expect(result.diff.length).toBeGreaterThan(0);
  });

  it("makes diffs readable without logging article prose or model text", () => {
    const changed: ModelNode = {
      ...agreeing,
      children: [
        { title: "Secret model first", range: [id(0), id(0)] },
        { title: "Secret model collision", range: [id(0), id(2)] },
        { title: "Secret model second", range: [id(3), id(5)] },
      ],
    };
    const result = replayStructureAnswer("private", { root: changed }, blocks);
    const printed = result.diff.join("\n");
    expect(printed).toMatch(/title#[0-9a-f]{10}/);
    expect(printed).toContain("spya-r00000");
    expect(printed).not.toContain("Secret model");
    expect(printed).not.toContain("Secret article");
    expect(printed).not.toContain("Secret authored heading");
  });

  it("applies every aggregate gate, including zero changes below 100 answers", () => {
    expect(gateReplayResults([]).pass).toBe(false);
    const good = replayStructureAnswer("good", { root: agreeing }, blocks);
    expect(gateReplayResults([good])).toEqual({ pass: true, reasons: [] });

    const newlyUnbuildable: ReplayResult = { ...good, newlyUnbuildable: true, identical: null };
    expect(gateReplayResults([newlyUnbuildable]).pass).toBe(false);
    expect(gateReplayResults([{ ...good, additionalDroppedChildren: 1 }]).pass).toBe(false);
    expect(gateReplayResults([{ ...good, lostAuthoredHeadings: 1 }]).pass).toBe(false);
    expect(gateReplayResults([{ ...good, identical: false }]).pass).toBe(false);

    const hundred = Array.from({ length: 100 }, (_, i) => ({
      ...good,
      label: `answer-${i}`,
      identical: i !== 0,
    }));
    expect(gateReplayResults(hundred).pass).toBe(true);
  });
});
