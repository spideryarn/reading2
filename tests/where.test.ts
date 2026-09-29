/**
 * **Where am I in the article** — src/web/where.ts, the fisheye of the outline
 * that Trajectory's rows and the spine's band cards share (plan 260929f § 3).
 */
import { describe, expect, it } from "vitest";
import type { BlockId, NodeId, Tree, TreeNode } from "../src/types.js";
import { type WhereRow, type WhereShape, whereForBlock, whereRows } from "../src/web/where.js";

interface N {
  id: string;
  children: N[];
}
const shape: WhereShape<N> = { id: (n) => n.id, title: (n) => n.id.toUpperCase(), sections: (n) => n.children };
const node = (id: string, children: N[] = []): N => ({ id, children });

/** Titles, indented two spaces a level, and "…n" for a more-row, "*" on the path, ">" for here. */
const drawn = (rows: WhereRow[]) =>
  rows.map((r) =>
    r.kind === "more"
      ? `${"  ".repeat(r.depth)}…${r.count}`
      : `${"  ".repeat(r.depth)}${r.here ? ">" : r.onPath ? "*" : ""}${r.title}`,
  );

describe("the fisheye", () => {
  it("draws every top-level section when there are few, and the path down, marking where you are", () => {
    const top = [node("intro"), node("results", [node("r1"), node("r2"), node("r3")]), node("end")];
    expect(drawn(whereRows(top, ["results", "r2"], shape))).toEqual([
      "INTRO",
      "*RESULTS",
      "  R1",
      "  >R2",
      "  R3",
      "END",
    ]);
  });

  it("keeps only the near neighbours of a long level, and says how many it left out", () => {
    const top = Array.from({ length: 12 }, (_, i) => node(`s${i}`));
    expect(drawn(whereRows(top, ["s6"], shape))).toEqual(["…4", "S4", "S5", ">S6", "S7", "S8", "…3"]);
    /* At the start, nothing before. */
    expect(drawn(whereRows(top, ["s0"], shape))).toEqual([">S0", "S1", "S2", "…9"]);
  });

  it("does not expand a section that is not on the path", () => {
    const top = [node("a", [node("a1")]), node("b", [node("b1")])];
    expect(drawn(whereRows(top, ["b", "b1"], shape))).toEqual(["A", "*B", "  >B1"]);
  });

  it("stops where the path leaves the outline, and draws nothing for no outline", () => {
    const top = [node("a"), node("b")];
    expect(drawn(whereRows(top, ["gone"], shape))).toEqual(["A", "B"]);
    expect(whereRows([], ["a"], shape)).toEqual([]);
  });
});

describe("from the stored tree", () => {
  /* Blocks b0…b5. root → [Intro (b0–b1), Results (b2–b5) → [R1 (b2–b3), R2 (b4–b5)]], each with paragraph leaves. */
  const leaf = (id: string, parent: string, b: string): TreeNode =>
    ({ id: id as NodeId, depth: 3, parent: parent as NodeId, children: [], range: [b as BlockId, b as BlockId], title: "" }) as TreeNode;
  const sec = (id: string, parent: string, children: string[], lo: string, hi: string, title: string, depth: number): TreeNode =>
    ({ id: id as NodeId, depth, parent: parent as NodeId, children: children as NodeId[], range: [lo as BlockId, hi as BlockId], title }) as TreeNode;
  const nodes: TreeNode[] = [
    sec("root", "", ["intro", "results"], "b0", "b5", "Whole", 0),
    sec("intro", "root", ["p0", "p1"], "b0", "b1", "Introduction", 1),
    leaf("p0", "intro", "b0"),
    leaf("p1", "intro", "b1"),
    sec("results", "root", ["r1", "r2"], "b2", "b5", "Results", 1),
    sec("r1", "results", ["p2", "p3"], "b2", "b3", "Rich clubs", 2),
    leaf("p2", "r1", "b2"),
    leaf("p3", "r1", "b3"),
    sec("r2", "results", ["p4", "p5"], "b4", "b5", "Synergy", 2),
    leaf("p4", "r2", "b4"),
    leaf("p5", "r2", "b5"),
  ];
  const tree = { rootId: "root", nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) } as unknown as Tree;
  const index = new Map(["b0", "b1", "b2", "b3", "b4", "b5"].map((b, i) => [b, i]));

  it("places a block in its section, without paragraph rows", () => {
    expect(drawn(whereForBlock(tree, index, "b4"))).toEqual(["Introduction", "*Results", "  Rich clubs", "  >Synergy"]);
    expect(drawn(whereForBlock(tree, index, "b0"))).toEqual([">Introduction", "Results"]);
  });

  it("draws nothing for a block the tree does not cover, or a flat tree", () => {
    expect(whereForBlock(tree, index, "b9")).toEqual([]);
    const flat = {
      rootId: "root",
      nodes: { root: sec("root", "", ["p0"], "b0", "b0", "Whole", 0), p0: leaf("p0", "root", "b0") },
    } as unknown as Tree;
    expect(whereForBlock(flat, index, "b0")).toEqual([]);
  });
});
