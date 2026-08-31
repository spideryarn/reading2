/**
 * Outline mode's projection (src/web/outline.ts): the whole document as one
 * nested list, expanded around the reader.
 *
 * Run against the `example/` fixture for the ordinary shape, and against a
 * hand-built tree for the two cases the fixture cannot produce — a leaf sitting
 * at section level, and a section with more paragraphs than the cap. Per
 * docs/reusable/silent-success.md, a test whose fixture has a title on every
 * node is not testing the blank-row rule at all.
 *
 * The fit itself is a DOM question and is in tests/outline-panel.test.tsx.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Block, NodeId, Tree, TreeNode } from "../src/types.js";
import { buildGeometry, buildSummaryTree } from "../src/web/tree.js";
import {
  outlineProjection,
  PARAGRAPH_CAP,
  RUNGS,
  type Rung,
} from "../src/web/outline.js";

const blocks: Block[] = JSON.parse(readFileSync("example/blocks.json", "utf8")).blocks;
const tree: Tree = JSON.parse(readFileSync("example/tree.json", "utf8"));
const geometry = buildGeometry(tree, blocks);
const root = buildSummaryTree(tree, blocks, geometry.leafDepth);

const project = (rung: Rung, focusRow: number, allowParagraphs = true) =>
  outlineProjection({
    root,
    supplementOf: geometry.supplementOf,
    arcByRow: null,
    focusRow,
    rung,
    allowParagraphs,
  });

/** Every part, at every rung — the invariant the whole mode promises. */
const partIds = (root?.children ?? []).map((p) => p.node.id);

describe("the whole structure is always present", () => {
  it("lists every part at every rung, wherever the reader is", () => {
    expect(partIds.length).toBeGreaterThan(1);
    for (const rung of RUNGS) {
      for (const focusRow of [0, 5, Math.floor(blocks.length / 2), blocks.length - 1]) {
        const drawn = project(rung, focusRow)
          .rows.filter((r) => r.level === 1)
          .map((r) => r.node.id);
        expect(drawn).toEqual(partIds);
      }
    }
  });

  it("draws each part exactly once", () => {
    const drawn = project(5, 10).rows.filter((r) => r.level === 1);
    expect(new Set(drawn.map((r) => r.node.id)).size).toBe(drawn.length);
  });
});

describe("the ladder expands only the branch the reader is in", () => {
  it("draws no sections at rung 1", () => {
    expect(project(1, 10).rows.every((r) => r.level === 1)).toBe(true);
  });

  it("draws the current part's sections and nobody else's at rung 2", () => {
    const { rows } = project(2, 10);
    const current = rows.find((r) => r.level === 1 && r.here);
    expect(current).toBeDefined();
    const sections = rows.filter((r) => r.level === 2);
    expect(sections.length).toBeGreaterThan(0);
    /* Every drawn section is inside the part the reader is in. This is the
       thing `showsChildren` could not express: a whole-level cut-off would
       draw every part's sections. */
    for (const s of sections) {
      expect(s.startRow).toBeGreaterThanOrEqual(current!.startRow);
      expect(s.endRow).toBeLessThanOrEqual(current!.endRow);
    }
  });

  it("gives a sentence to the current section only, at rung 3", () => {
    const withSentence = project(3, 10).rows.filter((r) => r.sentence !== undefined);
    expect(withSentence).toHaveLength(1);
    expect(withSentence[0]!.now).toBe(true);
  });

  it("adds nothing at rung 3 that rung 2 did not already draw", () => {
    /* The sentence is a property of a row, not a new row — so the skeleton is
       unchanged and only one line grows. That is the churn argument in
       docs/plans/outline-mode.md, asserted rather than claimed. */
    expect(project(3, 10).rows.map((r) => r.node.id)).toEqual(
      project(2, 10).rows.map((r) => r.node.id),
    );
  });
});

describe("which row is current", () => {
  it("marks exactly one row `now`, and it is the deepest drawn row containing the reader", () => {
    for (const rung of RUNGS) {
      const { rows, currentId } = project(rung, 12);
      const now = rows.filter((r) => r.now);
      expect(now).toHaveLength(1);
      expect(now[0]!.node.id).toBe(currentId);
      /* The deepest DRAWN row, not the deepest node containing the reader —
         at rung 1 the part is the honest answer. */
      const deepest = Math.max(...rows.filter((r) => r.here).map((r) => r.level));
      expect(now[0]!.level).toBe(deepest);
    }
  });

  it("keeps `here` on the whole ancestor chain, so a part stays lit at every rung", () => {
    const { rows } = project(5, 12);
    const here = rows.filter((r) => r.here);
    expect(here.length).toBeGreaterThan(1);
    expect(here.some((r) => r.level === 1)).toBe(true);
  });

  it("marks rows above the reader as read and rows below as not", () => {
    const { rows } = project(2, blocks.length - 1);
    expect(rows[0]!.before).toBe(true);
    expect(rows.at(-1)!.before).toBe(false);
  });
});

/**
 * The cases `example/` cannot produce. Built by hand rather than copied from a
 * real article so the emit-condition is exercised directly — see
 * docs/reusable/silent-success.md on a corpus that cannot report what it lacks.
 */
function handTree(sections: { title: string; navLabel?: string; paras: number }[]): {
  tree: Tree;
  blocks: Block[];
} {
  const nodes: Record<NodeId, TreeNode> = {};
  const blocks: Block[] = [];
  const id = (n: number) => `spya-b${String(n).padStart(4, "0")}`;
  let b = 0;
  const sectionIds: NodeId[] = [];

  for (const [i, spec] of sections.entries()) {
    const first = b;
    const leafIds: NodeId[] = [];
    for (let p = 0; p < Math.max(1, spec.paras); p++) {
      blocks.push({
        id: id(b),
        tag: "p",
        kind: "text",
        text: `${b}`,
        words: 1,
        html: `<p>${b}</p>`,
        gistable: true,
      });
      if (spec.paras > 0) {
        const leaf = `n-leaf-${i}-${p}`;
        nodes[leaf] = {
          id: leaf,
          depth: 3,
          parent: `n-sec-${i}`,
          children: [],
          range: [id(b), id(b)],
          title: "",
          navLabel: `paragraph ${p}`,
        };
        leafIds.push(leaf);
      }
      b++;
    }
    const sec = `n-sec-${i}`;
    nodes[sec] = {
      id: sec,
      depth: 2,
      parent: "n-part",
      children: leafIds,
      range: [id(first), id(b - 1)],
      title: spec.title,
      ...(spec.navLabel !== undefined && { navLabel: spec.navLabel }),
      ...(spec.paras > 0 && { gist: `gist of ${spec.title || "untitled"}` }),
    };
    sectionIds.push(sec);
  }

  nodes["n-part"] = {
    id: "n-part",
    depth: 1,
    parent: "n-root",
    children: sectionIds,
    range: [id(0), id(b - 1)],
    title: "The only part",
    gist: "the part's gist",
  };
  nodes["n-root"] = {
    id: "n-root",
    depth: 0,
    parent: null,
    children: ["n-part"],
    range: [id(0), id(b - 1)],
    title: "Root",
    gist: "the root's gist",
  };
  return {
    tree: { version: "1", generator: "test", slug: "t", rootId: "n-root", nodes },
    blocks,
  };
}

const projectHand = (
  spec: Parameters<typeof handTree>[0],
  rung: Rung,
  focusRow: number,
  allowParagraphs = true,
) => {
  const { tree, blocks } = handTree(spec);
  const g = buildGeometry(tree, blocks);
  return outlineProjection({
    root: buildSummaryTree(tree, blocks, g.leafDepth),
    supplementOf: g.supplementOf,
    arcByRow: null,
    focusRow,
    rung,
    allowParagraphs,
  });
};

describe("a leaf sitting at section level", () => {
  /* revistes-ub-30977 has two of these: sections by depth, leaves by shape,
     with an empty title. One has a navLabel and one has nothing at all. */
  const spec = [
    { title: "A real section", paras: 2 },
    { title: "", navLabel: "Lyn McCredden teaches Australian Literature", paras: 0 },
    { title: "", paras: 0 },
  ];

  it("falls back to the navLabel rather than drawing a blank row", () => {
    const { rows } = projectHand(spec, 2, 0);
    const texts = rows.filter((r) => r.level === 2).map((r) => r.text);
    expect(texts).toContain("Lyn McCredden teaches Australian Literature");
  });

  it("drops a node with no text of any kind, rather than drawing an empty line", () => {
    const { rows } = projectHand(spec, 2, 0);
    expect(rows.every((r) => r.text.trim().length > 0)).toBe(true);
    /* Three sections in, two drawn out — the untitled, unlabelled one is gone
       rather than present and blank. */
    expect(rows.filter((r) => r.level === 2)).toHaveLength(2);
  });
});

describe("the paragraph rung", () => {
  const small = [{ title: "Short section", paras: 3 }];
  const big = [{ title: "Long section", paras: PARAGRAPH_CAP + 1 }];

  it("draws the current section's paragraphs at rung 5", () => {
    const { rows } = projectHand(small, 5, 0);
    expect(rows.filter((r) => r.level === 3)).toHaveLength(3);
  });

  it("draws none at all when the section has more than the cap, rather than truncating", () => {
    const { rows } = projectHand(big, 5, 0);
    expect(rows.filter((r) => r.level === 3)).toHaveLength(0);
  });

  it("never marks a paragraph as the row the reader is in", () => {
    /* Both answers to "where is the reader" are section-granular, so marking
       the deepest containing row would light the section's FIRST paragraph
       every time. The mark stops at the section instead. */
    const { rows, currentId } = projectHand(small, 5, 1);
    expect(rows.filter((r) => r.level === 3)).toHaveLength(3);
    expect(rows.some((r) => r.level === 3 && (r.now || r.here))).toBe(false);
    const now = rows.find((r) => r.now);
    expect(now?.level).toBe(2);
    expect(currentId).toBe(now?.node.id);
  });

  it("draws none on a narrow window, where the band covers the prose", () => {
    /* The navLabel fallback is only defensible while the prose is visible. */
    const { rows } = projectHand(small, 5, 0, false);
    expect(rows.filter((r) => r.level === 3)).toHaveLength(0);
  });
});

describe("the apparatus", () => {
  /* The footnotes get one node in the structure so a reader can jump to them,
     with an authored title and deliberately no gist. Sol's review of the built
     code noted no Outline fixture contained one, so removing the handling
     entirely would have left every test green. */
  function withSupplement(focusRow = 0) {
    const { tree, blocks } = handTree([{ title: "A real section", paras: 2 }]);
    /* **The apparatus is given real children.** Without them "never expands it"
       is vacuous — a node with no children cannot expand however the code
       behaves, so the test passes on code that would happily expand it. Found
       by mutating the guard away and watching the suite stay green. */
    const noteIds: string[] = [];
    for (let n = 0; n < 3; n++) {
      const bid = `spya-b999${n}`;
      blocks.push({
        id: bid,
        tag: "p",
        kind: "text",
        text: `note ${n}`,
        words: 2,
        html: `<p>note ${n}</p>`,
        gistable: true,
      });
      tree.nodes[`n-note-${n}`] = {
        id: `n-note-${n}`,
        depth: 2,
        parent: "n-notes",
        children: [],
        range: [bid, bid],
        title: "",
        navLabel: `note ${n}`,
      };
      noteIds.push(`n-note-${n}`);
    }
    const notesBlock = `spya-b999${noteIds.length - 1}`;
    tree.nodes["n-notes"] = {
      id: "n-notes",
      depth: 1,
      parent: "n-root",
      children: noteIds,
      range: [`spya-b9990`, notesBlock],
      title: "Notes",
      treatment: "supplement",
    };
    tree.nodes["n-root"]!.children = [...tree.nodes["n-root"]!.children, "n-notes"];
    tree.nodes["n-root"]!.range = [tree.nodes["n-root"]!.range[0], notesBlock];
    const g = buildGeometry(tree, blocks);
    return outlineProjection({
      root: buildSummaryTree(tree, blocks, g.leafDepth),
      supplementOf: g.supplementOf,
      arcByRow: null,
      focusRow,
      rung: 5,
      allowParagraphs: true,
    });
  }

  it("shows the apparatus as a row, so a reader can reach the notes", () => {
    const notes = withSupplement().rows.find((r) => r.node.id === "n-notes");
    expect(notes).toBeDefined();
    expect(notes!.text).toBe("Notes");
    expect(notes!.supplement).toBe(true);
  });

  it("gives it no number, so it is not read as one more part of the argument", () => {
    /* The same rule buildArcColumn keeps with its `3 / 9` step marker: the
       apparatus is in the structure and outside the numbering. */
    const rows = withSupplement().rows;
    const notes = rows.find((r) => r.node.id === "n-notes")!;
    expect(notes.number).toBe("");
    /* And the parts of the argument keep theirs. */
    const part = rows.find((r) => r.level === 1 && !r.supplement)!;
    expect(part.number).not.toBe("");
  });

  it("never expands it, even when the reader is inside the notes", () => {
    /* **The reader has to be INSIDE it for this to test anything.** With the
       focus anywhere else, `!isCurrent` already stops the expansion and the
       supplement guard is dead code the test cannot see — which is exactly how
       this assertion passed while the guard was mutated away. The article has
       two blocks and the notes three, so row 3 is inside the notes. */
    const inside = withSupplement(3);
    const notes = inside.rows.find((r) => r.node.id === "n-notes")!;
    expect(notes.here, "the fixture must put the reader inside the notes").toBe(true);
    expect(inside.rows.some((r) => r.node.id.startsWith("n-note-"))).toBe(false);

    /* And from outside it, still nothing. */
    expect(withSupplement(0).rows.some((r) => r.node.id.startsWith("n-note-"))).toBe(false);
  });
});

describe("monotonicity", () => {
  it("never draws fewer rows at a higher rung", () => {
    for (const focusRow of [0, 8, 20]) {
      let last = -1;
      for (const rung of RUNGS) {
        const n = project(rung, focusRow).rows.length;
        expect(n).toBeGreaterThanOrEqual(last);
        last = n;
      }
    }
  });
});
