/**
 * The fourth level's measures (plan 261029a § Stage 2): production's run counts
 * in src/structure-depth.ts and the eval's split, opening and recall counts in
 * evals/structure-fourth-level/score.ts, on trees built by production's
 * `buildTree` from hand-written answers over headed blocks.
 */
import { describe, expect, it } from "vitest";
import { scoreTree } from "../evals/structure-fourth-level/score.js";
import { buildTree, type ModelNode } from "../src/structure.js";
import { depthCounts } from "../src/structure-depth.js";
import type { Block, BlockId } from "../src/types.js";

const SPEC: readonly (string | number)[] = [
  // part 1
  "h2:A", 1, 1,
  "h2:B", 1, "h3:B.1", 1, 1, "h3:B.2", 1, 1,
  // part 2
  "h2:C", 1, 1, "h2:D", 1,
  "h2:E", 1, 1, 1, 1, 1, 1,
  "h2:F", 1, "h3:F.1", 1, "h3:F.2", 1,
];

const id = (i: number) => `spya-t${String(i).padStart(5, "0")}` as BlockId;
const blocks: Block[] = SPEC.map((s, i) => {
  const heading = typeof s === "string" ? /^h(\d):(.*)$/.exec(s) : null;
  return heading
    ? { id: id(i), tag: `h${heading[1]}`, kind: "heading", level: Number(heading[1]), text: heading[2]!, words: 1, html: "", gistable: false }
    : { id: id(i), tag: "p", kind: "text", text: `Paragraph ${i}.`, words: 2, html: "", gistable: true };
});
const at = (text: string) => blocks.findIndex((b) => b.text === text);
const gist = "A made-up sentence about this node.";
const node = (title: string, lo: number, hi: number, children?: ModelNode[]): ModelNode => ({
  title,
  gist,
  range: [id(lo), id(hi)],
  ...(children ? { children } : {}),
});

/** B: an opening of its own, then the author's two sub-sections. C swallows the h2 D.
    E: divided at a join the model chose, in a 7-block section. F: the author's
    sub-headings, not divided. */
function answer(bFirstSubEndsAfterB1 = false): ModelNode {
  const b = at("B");
  const b1 = at("B.1");
  const b2 = at("B.2");
  const e = at("E");
  const bSubs = bFirstSubEndsAfterB1
    ? [node("B opening and B.1", b, b2 - 1), node("B.2", b2, at("C") - 1)]
    : [node("Opening", b, b1 - 1), node("B.1", b1, b2 - 1), node("B.2", b2, at("C") - 1)];
  return node("Root", 0, blocks.length - 1, [
    node("Part 1", 0, at("C") - 1, [node("A", 0, b - 1), node("B", b, at("C") - 1, bSubs)]),
    node("Part 2", at("C"), blocks.length - 1, [
      node("C", at("C"), e - 1),
      node("E", e, at("F") - 1, [node("E first", e, e + 3), node("E second", e + 4, at("F") - 1)]),
      node("F", at("F"), blocks.length - 1),
    ]),
  ]);
}

describe("the fourth level's measures", () => {
  it("counts sub-sections, the sections holding them, and the one swallowed heading", () => {
    const tree = buildTree(answer(), {}, blocks, "t");
    expect(depthCounts(tree, blocks)).toEqual({ subsections: 5, deepenedSections: 2, swallowedHeadings: 1 });
  });

  it("does not call a heading that starts its own node swallowed, however coarse its parent's", () => {
    const flat = node("Root", 0, blocks.length - 1, [
      node("Part 1", 0, at("C") - 1, [node("A", 0, at("B") - 1), node("B", at("B"), at("C") - 1)]),
      node("Part 2", at("C"), blocks.length - 1, [
        node("C", at("C"), at("D") - 1),
        node("D", at("D"), at("E") - 1),
        node("E", at("E"), at("F") - 1),
        node("F", at("F"), blocks.length - 1),
      ]),
    ]);
    expect(depthCounts(buildTree(flat, {}, blocks, "t"), blocks).swallowedHeadings).toBe(0);
  });

  it("separates heading splits from invented ones, and finds the short invented split and the undivided headed section", () => {
    const s = scoreTree(buildTree(answer(), {}, blocks, "t"), blocks);
    expect(s).toMatchObject({
      sections: 5,
      headingSplits: 2,
      inventedSplits: 1,
      shortInventedSplits: 1,
      headedSections: 2,
      undividedHeadedSections: 1,
      singleSubsection: 0,
      openings: { own: 1, folded: 0, none: 0 },
    });
  });

  it("tells an opening folded into the first sub-section from one of its own", () => {
    const s = scoreTree(buildTree(answer(true), {}, blocks, "t"), blocks);
    expect(s.openings).toEqual({ own: 0, folded: 1, none: 0 });
    expect(s.headingSplits).toBe(1);
  });
});
