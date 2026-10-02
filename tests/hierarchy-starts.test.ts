import { describe, expect, it } from "vitest";
import { ExpansionRefused, normaliseExpansion } from "../src/hierarchy-cascade.js";
import { buildTree, type BuildReport, type ModelNode } from "../src/hierarchy.js";
import {
  modelNodeFromStarts,
  type StartsOnlyStructureAnswer,
} from "../src/hierarchy-starts.js";
import type { Block } from "../src/types.js";

function block(i: number, kind: Block["kind"] = "text", text = `Block ${i}`): Block {
  const id = `spya-t${String(i).padStart(5, "0")}`;
  return {
    id,
    tag: kind === "heading" ? "h2" : "p",
    kind,
    ...(kind === "heading" ? { level: 2 } : {}),
    text,
    words: 2,
    html: `<p>${text}</p>`,
    gistable: true,
  };
}

const blocks = Array.from({ length: 10 }, (_, i) => block(i));
const id = (i: number) => blocks[i]!.id;
const emptyReport = (): BuildReport => ({
  repairs: [],
  droppedChildren: [],
  rangelessChildren: [],
  droppedHeadings: [],
  collapsedRungs: [],
  droppedQuestions: [],
});

describe("modelNodeFromStarts", () => {
  it("derives nested ends from the next sibling start and the parent end", () => {
    const answer: StartsOnlyStructureAnswer = {
      root: {
        title: "Whole",
        children: [
          {
            title: "First",
            start: id(0),
            children: [
              { title: "First A", start: id(0) },
              { title: "First B", start: id(2) },
            ],
          },
          { title: "Second", start: id(5) },
        ],
      },
    };
    expect(modelNodeFromStarts(answer, blocks)).toEqual({
      title: "Whole",
      range: [id(0), id(9)],
      children: [
        {
          title: "First",
          range: [id(0), id(4)],
          children: [
            { title: "First A", range: [id(0), id(1)] },
            { title: "First B", range: [id(2), id(4)] },
          ],
        },
        { title: "Second", range: [id(5), id(9)] },
      ],
    });
  });

  it("clamps a first start outside its parent, then pins it to the parent start", () => {
    const report = emptyReport();
    const answer: StartsOnlyStructureAnswer = {
      root: {
        title: "Whole",
        children: [
          {
            title: "First",
            start: id(0),
            children: [
              { title: "Outside first", start: id(8) },
              { title: "Inside later", start: id(2) },
            ],
          },
          { title: "Second", start: id(4) },
        ],
      },
    };
    const converted = modelNodeFromStarts(answer, blocks, report);
    expect(converted.children?.[0]?.children?.map((child) => child.range)).toEqual([
      [id(0), id(1)],
      [id(2), id(3)],
    ]);
    expect(report.repairs).toContainEqual({
      where: "root > child 1 > child 1",
      kind: "gap",
      at: 0,
      size: 8,
    });
  });

  it("clamps a later start outside its parent", () => {
    const report = emptyReport();
    const answer: StartsOnlyStructureAnswer = {
      root: {
        title: "Whole",
        children: [
          {
            title: "First",
            start: id(0),
            children: [
              { title: "Inside first", start: id(0) },
              { title: "Outside later", start: id(8) },
            ],
          },
          { title: "Second", start: id(4) },
        ],
      },
    };
    const converted = modelNodeFromStarts(answer, blocks, report);
    expect(converted.children?.[0]?.children?.map((child) => child.range)).toEqual([
      [id(0), id(2)],
      [id(3), id(3)],
    ]);
    expect(report.repairs).toContainEqual({
      where: "root > child 1 > child 2",
      kind: "gap",
      at: 3,
      size: 5,
    });
  });

  it("drops duplicate and non-increasing starts without renumbering their paths", () => {
    const report = emptyReport();
    const answer: StartsOnlyStructureAnswer = {
      root: {
        title: "Whole",
        children: [
          { title: "Kept 1", start: id(0) },
          { title: "Duplicate", start: id(0) },
          { title: "Kept 2", start: id(4) },
          { title: "Backwards", start: id(2) },
          { title: "Kept 3", start: id(7) },
        ],
      },
    };
    const converted = modelNodeFromStarts(answer, blocks, report);
    expect(converted.children?.map((child) => child.title)).toEqual(["Kept 1", "Kept 2", "Kept 3"]);
    expect(converted.children?.map((child) => child.range)).toEqual([
      [id(0), id(3)],
      [id(4), id(6)],
      [id(7), id(9)],
    ]);
    expect(report.droppedChildren).toEqual(["root > child 2", "root > child 4"]);
  });

  it("snaps a start back onto the authored heading it names", () => {
    const headed = blocks.map((entry, i) =>
      i === 3 ? block(i, "heading", "Authored section") : entry,
    );
    const report = emptyReport();
    const converted = modelNodeFromStarts(
      {
        root: {
          title: "Whole",
          children: [
            { title: "Opening", start: id(0) },
            { title: "Authored section", start: id(4), sourceHeading: "Authored section" },
          ],
        },
      },
      headed,
      report,
    );
    expect(converted.children?.[1]?.range).toEqual([id(3), id(9)]);
    expect(report.repairs).toContainEqual({
      where: "root > child 2",
      kind: "heading",
      at: 3,
      size: 1,
    });
  });

  it("allows a one-child set for buildTree to collapse", () => {
    const report = emptyReport();
    const converted = modelNodeFromStarts(
      { root: { title: "Whole", children: [{ title: "Restated", start: id(0) }] } },
      blocks,
      report,
    );
    expect(converted.children).toHaveLength(1);
    buildTree(converted, {}, blocks, "one-child", report);
    expect(report.collapsedRungs).toEqual(["root > child 1"]);
  });

  it("allows a proposed set that collapses to one after drops", () => {
    const report = emptyReport();
    const converted = modelNodeFromStarts(
      {
        root: {
          title: "Whole",
          children: [
            { title: "Kept", start: id(0) },
            { title: "Duplicate", start: id(0) },
            { title: "Backwards", start: id(0) },
          ],
        },
      },
      blocks,
      report,
    );
    expect(converted.children?.map((child) => child.title)).toEqual(["Kept"]);
    expect(report.droppedChildren).toEqual(["root > child 2", "root > child 3"]);
    buildTree(converted, {}, blocks, "collapsed-to-one", report);
    expect(report.collapsedRungs).toEqual(["root > child 1"]);
  });

  it("derives the root from the body bounds, regardless of the first child's start", () => {
    const converted = modelNodeFromStarts(
      { root: { title: "Whole", children: [{ title: "Only", start: id(5) }] } },
      blocks.slice(2, 8),
    );
    expect(converted.range).toEqual([id(2), id(7)]);
    expect(converted.children?.[0]?.range).toEqual([id(2), id(7)]);
  });

  it("does not mutate the starts-only answer", () => {
    const answer: StartsOnlyStructureAnswer = {
      root: {
        title: "Whole",
        children: [
          { title: "First", start: id(1) },
          { title: "Second", start: id(5) },
        ],
      },
    };
    const before = structuredClone(answer);
    modelNodeFromStarts(answer, blocks);
    expect(answer).toEqual(before);
  });

  it("refuses an invented start with today's message", () => {
    expect(() =>
      modelNodeFromStarts(
        { root: { title: "Whole", children: [{ title: "Lost", start: "spya-zzzzzz" }] } },
        blocks,
      ),
    ).toThrow('Node range not in blocks.json — at root > child 1: start "spya-zzzzzz"');
  });

  it("builds the same tree as an agreeing ranged answer", () => {
    const starts: StartsOnlyStructureAnswer = {
      root: {
        title: "Whole",
        gist: "The whole article.",
        children: [
          { title: "First", gist: "The opening.", start: id(0) },
          { title: "Second", gist: "The close.", start: id(5) },
        ],
      },
    };
    const ranged: ModelNode = {
      title: "Whole",
      gist: "The whole article.",
      range: [id(0), id(9)],
      children: [
        { title: "First", gist: "The opening.", range: [id(0), id(4)] },
        { title: "Second", gist: "The close.", range: [id(5), id(9)] },
      ],
    };
    expect(buildTree(modelNodeFromStarts(starts, blocks), {}, blocks, "same")).toEqual(
      buildTree(ranged, {}, blocks, "same"),
    );
  });
});

describe("the scoped policy keeps normaliseExpansion's refusal order", () => {
  it.each([
    ["invented-start", "spya-zzzzzz"],
    ["outside-parent", id(9)],
  ] as const)("refuses %s before treating one child as no expansion", (reason, start) => {
    try {
      normaliseExpansion({
        children: [{ title: "Only", start }],
        parent: [id(2), id(7)],
        blocks,
        where: "root",
        report: emptyReport(),
      });
      throw new Error("normaliseExpansion accepted one child");
    } catch (error) {
      expect(error).toBeInstanceOf(ExpansionRefused);
      expect((error as ExpansionRefused).reason).toBe(reason);
    }
  });
});
