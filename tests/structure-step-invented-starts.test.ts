/**
 * A whole-document start that is not a block id is recovered, or on the last answer dropped,
 * rather than refusing the whole tree —
 * docs/plans/261019l-structure-recovers-a-start-that-splices-the-line-number-into-the-id.md.
 *
 * The shapes are the ones production and four re-runs of its request produced for a 648-block PDF:
 * the prompt line `[582] spya-xcf0dz <h1>: …` came back as `spya-582xcf0dz`, `spya-582xcf` and
 * `spya-582`, and two answers wrote a start (`"x"`, `spya-76bd1a`) that names nothing at all.
 */
import { describe, expect, it } from "vitest";
import { ExpansionRefused, normaliseExpansion } from "../src/structure-cascade.js";
import type { BuildReport } from "../src/structure.js";
import { splicedLineNumber, type UnresolvedStarts } from "../src/start-ranges.js";
import { droppedStartBudget, modelNodeFromStarts, type StartsOnlyNode } from "../src/structure-starts.js";
import type { Block } from "../src/types.js";

/* Six characters each, distinct, none beginning with a digit — so no split of a spliced
   line number is ambiguous unless a test makes it so (block 1, below). */
const SUFFIXES = Array.from(
  { length: 30 },
  (_, i) => `k${"abcdefghjkmnpqrstvwxyz"[i % 22]}${"mnpqrs"[Math.floor(i / 22)]}x${i % 10}q`,
);

function block(i: number, kind: Block["kind"] = "text", text = `Block ${i}`, suffix = SUFFIXES[i]!): Block {
  return {
    id: `spya-${suffix}`,
    tag: kind === "heading" ? "h2" : "p",
    kind,
    ...(kind === "heading" ? { level: 2 } : {}),
    text,
    words: 2,
    html: `<p>${text}</p>`,
    gistable: true,
  };
}

const blocks = Array.from({ length: 30 }, (_, i) => (i === 12 ? block(i, "heading", "Evidence gaps") : block(i)));
const id = (i: number) => blocks[i]!.id;
const emptyReport = (): BuildReport => ({
  repairs: [],
  droppedChildren: [],
  unresolvedStarts: [],
  rangelessChildren: [],
  droppedHeadings: [],
  collapsedRungs: [],
  droppedQuestions: [],
});

function build(children: StartsOnlyNode[], unresolved: UnresolvedStarts, over: readonly Block[] = blocks) {
  const report = emptyReport();
  const root = modelNodeFromStarts({ root: { title: "Whole", children } }, over, report, unresolved);
  const ranges = root.children?.map((c) => [c.title, ...c.range]);
  const outcomes = report.unresolvedStarts.map((u) => `${u.where}: ${u.outcome}`);
  return { root, ranges, report, outcomes };
}

/** Five non-first starts, so the answer-wide budget (one in ten, at least one) is exactly one. */
const fiveAfter = (second: string): StartsOnlyNode[] => [
  { title: "Opening", start: id(0) },
  { title: "Second", start: second },
  { title: "Two", start: id(15) },
  { title: "Three", start: id(18) },
  { title: "Four", start: id(22) },
  { title: "Five", start: id(26) },
];

describe("a spliced line number resolves to the line it was copied from", () => {
  it.each([
    ["the line number and the whole id", `spya-12${SUFFIXES[12]}`],
    ["the line number and a prefix of the id", `spya-12${SUFFIXES[12]!.slice(0, 3)}`],
    ["the line number alone", "spya-12"],
  ])("%s, even on a first answer", (_, start) => {
    const { ranges, report, outcomes } = build(
      [
        { title: "Opening", start: id(0) },
        { title: "Gaps", start },
        { title: "After", start: id(18) },
      ],
      "recover",
    );
    expect(ranges).toEqual([
      ["Opening", id(0), id(11)],
      ["Gaps", id(12), id(17)],
      ["After", id(18), id(29)],
    ]);
    expect(outcomes).toEqual(["root > child 2: line-number"]);
    expect(report.droppedChildren).toEqual([]);
  });

  it("not when the rest is not that line's id", () => {
    expect(splicedLineNumber(`spya-12${SUFFIXES[13]!.slice(0, 4)}`, blocks, 1, 17)).toBeUndefined();
  });

  it("not when the line falls outside the window between its neighbours", () => {
    expect(splicedLineNumber("spya-12", blocks, 13, 17)).toBeUndefined();
    expect(splicedLineNumber("spya-12", blocks, 1, 11)).toBeUndefined();
    expect(splicedLineNumber("spya-12", blocks, 12, 12)).toBe(12);
  });

  it("not when two splits of the digits both match, even if only one is in the window", () => {
    /* Block 1's id begins "2kam", so `spya-12kam` reads as line 12 + "kam" or as line 1 + "2kam".
       Choosing by the window would pick line 1 when the model meant line 12. ⟨Sol r2, finding 1⟩ */
    const tricky = blocks.map((b, i) => (i === 1 ? block(1, "text", "Block 1", `2${SUFFIXES[12]!.slice(0, 3)}zz`) : b));
    const start = `spya-12${SUFFIXES[12]!.slice(0, 3)}`;
    expect(splicedLineNumber(start, tricky, 1, 11)).toBeUndefined();
    expect(splicedLineNumber(start, tricky, 1, 29)).toBeUndefined();
  });

  it("not a number with a leading zero, read as a shorter line", () => {
    expect(splicedLineNumber("spya-012", blocks, 0, 29)).toBeUndefined();
  });
});

describe("a first child's start is not asked", () => {
  it("builds, nested too, on a first answer", () => {
    const { ranges, root, outcomes } = build(
      [
        { title: "Opening", start: "spya-76k5k8x" },
        {
          title: "After",
          start: id(18),
          children: [
            { title: "After A", start: "x", sourceHeading: "Evidence gaps" },
            { title: "After B", start: id(24) },
          ],
        },
      ],
      "recover",
    );
    expect(ranges).toEqual([
      ["Opening", id(0), id(17)],
      ["After", id(18), id(29)],
    ]);
    expect(root.children?.[1]?.children?.map((c) => c.range)).toEqual([
      [id(18), id(23)],
      [id(24), id(29)],
    ]);
    expect(outcomes).toEqual([]);
  });

  it("but is still refused by default, as before", () => {
    expect(() => build([{ title: "Opening", start: "spya-zzzzzz" }, { title: "After", start: id(18) }], "refuse")).toThrow(
      'Node range not in blocks.json — at root > child 1: start "spya-zzzzzz"',
    );
  });
});

describe("a later start that names nothing", () => {
  it("refuses a first answer, so the step asks again", () => {
    expect(() => build(fiveAfter("spya-zzzzzz"), "recover")).toThrow(
      'Node range not in blocks.json — at root > child 2: start "spya-zzzzzz"',
    );
  });

  it("is dropped on the last answer, its blocks going to the sibling before it", () => {
    const { ranges, report, outcomes } = build(
      fiveAfter("spya-zzzzzz").map((c, i) =>
        i === 1 ? { ...c, children: [{ title: "Lost A", start: id(9) }, { title: "Lost B", start: id(11) }] } : c,
      ),
      "recover-or-drop",
    );
    expect(ranges).toEqual([
      ["Opening", id(0), id(14)],
      ["Two", id(15), id(17)],
      ["Three", id(18), id(21)],
      ["Four", id(22), id(25)],
      ["Five", id(26), id(29)],
    ]);
    expect(report.droppedChildren).toEqual(["root > child 2"]);
    expect(outcomes).toEqual(["root > child 2: dropped"]);
  });

  it("refuses the last answer past one lost start in ten", () => {
    expect(droppedStartBudget(5)).toBe(1);
    expect(droppedStartBudget(29)).toBe(2);
    const twoLost = fiveAfter("spya-zzzzzz").map((c, i) => (i === 3 ? { ...c, start: "spya-yyyyyy" } : c));
    expect(() => build(twoLost, "recover-or-drop")).toThrow(
      /^Node range not in blocks\.json — at root > child 2: start "spya-zzzzzz" \(2 of 5 starts named no block/,
    );
  });

  it("refuses the last answer when the drop would leave one child covering its parent", () => {
    expect(() =>
      build([{ title: "Opening", start: id(0) }, { title: "Lost", start: "spya-zzzzzz" }], "recover-or-drop"),
    ).toThrow('Node range not in blocks.json — at root > child 2: start "spya-zzzzzz"');
  });
});

describe("the scoped policy is unchanged", () => {
  it.each([
    ["a spliced line number", "spya-12"],
    ["a start that names nothing", "x"],
  ])("still refuses %s", (_, start) => {
    try {
      normaliseExpansion({
        children: [
          { title: "First", start: id(10) },
          { title: "Second", start },
        ],
        parent: [id(10), id(19)],
        blocks,
        where: "root",
        report: emptyReport(),
      });
      throw new Error("normaliseExpansion accepted an invented start");
    } catch (error) {
      expect(error).toBeInstanceOf(ExpansionRefused);
      expect((error as ExpansionRefused).reason).toBe("invented-start");
    }
  });
});
