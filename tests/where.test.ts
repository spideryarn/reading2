/**
 * **Where am I in the article** — src/web/where.ts, the fisheye of the outline
 * that Skim's rows and the spine's band cards share (plan 260929f § 3).
 */
import { describe, expect, it } from "vitest";
import type { BlockId, NodeId, Tree, TreeNode } from "../src/types.js";
import type { OutlineEntry } from "../src/web/tree.js";
import {
  SPINE_LIMITS,
  type WhereRow,
  type WhereShape,
  whereForBand,
  whereForBlock,
  whereRows,
} from "../src/web/where.js";

interface N {
  id: string;
  children: N[];
}
const shape: WhereShape<N> = {
  id: (n) => n.id,
  title: (n) => n.id.toUpperCase(),
  voice: () => "ai",
  sections: (n) => n.children,
};
const node = (id: string, children: N[] = []): N => ({ id, children });

/** Titles, indented two spaces a level, and "…n" for a more-row, "*" on the path, ">" for here. */
const drawn = (rows: WhereRow[]) =>
  rows.map((r) =>
    r.kind === "more"
      ? `${"  ".repeat(r.depth)}…${r.count}`
      : `${"  ".repeat(r.depth)}${r.here ? ">" : r.onPath ? "*" : ""}${r.title}${r.of ? ` (${r.of.index + 1}/${r.of.total})` : ""}`,
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

describe("the spine's shorter version (plan 261003d)", () => {
  it("keeps one neighbour either side and counts on the row instead of adding more-rows", () => {
    const top = Array.from({ length: 8 }, (_, i) => node(`s${i}`, i === 5 ? [node("a"), node("b")] : []));
    expect(drawn(whereRows(top, ["s5", "b"], shape, SPINE_LIMITS))).toEqual([
      "S4",
      "*S5 (6/8)",
      "  A",
      "  >B",
      "S6",
    ]);
    /* At the very start, only a next neighbour. */
    expect(drawn(whereRows(top, ["s0"], shape, SPINE_LIMITS))).toEqual([">S0 (1/8)", "S1"]);
  });

  it("draws a level of three whole, with no count", () => {
    const top = [node("a"), node("b"), node("c")];
    expect(drawn(whereRows(top, ["b"], shape, SPINE_LIMITS))).toEqual(["A", ">B", "C"]);
  });

  it("never draws more than three rows a level", () => {
    const wide = (p: string) => Array.from({ length: 20 }, (_, i) => node(`${p}${i}`));
    const top = wide("t").map((n, i) => (i === 10 ? node(n.id, wide("c")) : n));
    for (const path of [["t0"], ["t10", "c0"], ["t10", "c10"], ["t10", "c19"], ["t19"]]) {
      const rows = whereRows(top, path, shape, SPINE_LIMITS);
      expect(rows.every((r) => r.kind === "node")).toBe(true);
      for (const depth of [0, 1]) expect(rows.filter((r) => r.depth === depth).length).toBeLessThanOrEqual(3);
    }
  });

  it("leaves Skim's limits as they were", () => {
    const top = Array.from({ length: 12 }, (_, i) => node(`s${i}`));
    expect(whereRows(top, ["s6"], shape).some((r) => r.kind === "node" && r.of)).toBe(false);
  });
});

describe("from the spine's outline", () => {
  const entry = (id: string, o: { title?: string; navLabel?: string } = {}, children: OutlineEntry[] = []): OutlineEntry => ({
    node: { id, depth: children.length ? 1 : 2, parent: "root", children: [], range: [`${id}-a`, `${id}-b`], title: o.title ?? "", ...(o.navLabel ? { navLabel: o.navLabel } : {}) } as unknown as TreeNode,
    startRow: 0,
    endRow: 0,
    words: 0,
    children,
  });
  const leaf = (id: string) => ({ ...entry(id, { navLabel: `para ${id}` }), node: { ...entry(id).node, depth: 3, navLabel: `para ${id}` } as TreeNode });
  const OUTLINE: OutlineEntry[] = [
    entry("p1", { title: "Part one" }, [
      entry("s1", { title: "First" }, []),
      entry("s2", { navLabel: "Only a nav label" }),
      entry("s3"),
      entry("s4"),
    ]),
    entry("p2", { title: "Part two" }),
  ];
  /* p1's sections are given leaf children, as the real outline's are. */
  OUTLINE[0]!.children[0]!.children = [leaf("k1"), leaf("k2")];

  it("finds a section by its own id, and stops there", () => {
    expect(drawn(whereForBand(OUTLINE, "s1"))).toEqual(["*Part one", "  >First (1/4)", "  Only a nav label", "Part two"]);
  });

  it("finds a part standing in for its own children", () => {
    expect(drawn(whereForBand(OUTLINE, "p2"))).toEqual(["Part one", ">Part two"]);
  });

  it("names two untitled siblings by their place, differently", () => {
    expect(drawn(whereForBand(OUTLINE, "s4"))).toEqual([
      "*Part one",
      "  Section 3 of 4",
      "  >Section 4 of 4 (4/4)",
      "Part two",
    ]);
  });

  it("says a nav label is the model's and a stand-in is ours", () => {
    const rows = whereForBand(OUTLINE, "s3").filter((r) => r.kind === "node");
    expect(rows.map((r) => r.kind === "node" && `${r.title}:${r.voice}`)).toEqual(
      expect.arrayContaining(["Only a nav label:ai", "Section 3 of 4:ui"]),
    );
  });

  it("gives an untitled top-level band the same visible fallback", () => {
    expect(drawn(whereForBand([entry("blank")], "blank"))).toEqual([">Untitled section"]);
  });

  it("draws nothing for an id it does not have", () => {
    expect(whereForBand(OUTLINE, "gone")).toEqual([]);
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

  it("says whose words each title is: a kept heading the author's, a written one the model's", () => {
    const voiced = {
      ...tree,
      nodes: {
        ...tree.nodes,
        // The author's "Results" kept as the title, and a heading the model rewrote.
        results: { ...tree.nodes.results, sourceHeading: "Results" },
        r1: { ...tree.nodes.r1, sourceHeading: "3.1 Clubs" },
      },
    } as unknown as Tree;
    const voices = whereForBlock(voiced, index, "b4").map((r) => (r.kind === "node" ? `${r.title}:${r.voice}` : ""));
    expect(voices).toEqual(["Introduction:ai", "Results:author", "Rich clubs:ai", "Synergy:ai"]);
  });

  it("draws an untitled section in our words, not the model's", () => {
    const untitled = { ...tree, nodes: { ...tree.nodes, intro: { ...tree.nodes.intro, title: " " } } } as unknown as Tree;
    const first = whereForBlock(untitled, index, "b0")[0];
    expect(first?.kind === "node" && [first.title, first.voice]).toEqual(["Untitled section", "ui"]);
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
