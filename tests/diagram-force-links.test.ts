// @vitest-environment jsdom
/**
 * **The four kinds of line the Force picture grew**, and the arithmetic under
 * each of them.
 *
 * Greg, 2026-08-27: *"Add thick links with an arrow on one end to show the
 * sequence… Add thin links if there's an anchor link between sections… add
 * dotted links between the most similar handful of blocks."*
 *
 * Every test here is for a failure that **draws**. That is the shape of bug
 * this feature is made of: a chain that skips a section is still a chain, an
 * arrow pointing the wrong way up the article is still an arrow, an anchor edge
 * resolved to the wrong block is still a line between two real sections, and a
 * semantic edge given the wrong force strength still settles into a picture. In
 * every one of those cases nothing throws and nothing looks broken.
 *
 * So each of these was run against the broken state before being kept — the
 * habit in docs/reusable/silent-success.md — and the two that turned out to
 * pass either way say so in a comment rather than being left as decoration.
 */
import { describe, expect, it } from "vitest";
import type { Block, BlockId, NodeId, SimilarPair, Tree } from "../src/types.js";
import { buildGraph } from "../src/web/graph.js";
import { layoutDiagram } from "../src/web/diagrams.js";
import { arrowPath, type Sim, type SimLink, strengthOf } from "../src/web/diagram-d3.js";
import { relatedFor } from "../src/web/DiagramPanel.js";
import { buildSummaryTree, type SummaryNode } from "../src/web/tree.js";

function block(id: string, text: string, html?: string): Block {
  return {
    id: `spya-${id}` as BlockId,
    tag: "p",
    kind: "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: html ?? `<p>${text}</p>`,
    gistable: true,
  };
}

/** Enough distinct prose that tf-idf has something to work with and no accidental edges appear. */
const FILLER = [
  "falconry hawking jesses gauntlet quarry stooping austringer merlin",
  "geology basalt sediment tectonic strata outcrop metamorphic granite",
  "baking sourdough hydration levain crumb proving banneton scoring",
  "sailing halyard leeward tacking spinnaker keel bosun rigging",
  "botany xylem phloem stomata chlorophyll germination cotyledon",
  "printing letterpress kerning quoin galley composing furniture",
  "beekeeping brood propolis foundation supers smoker apiary",
  "cartography projection isoline hachure graticule contour datum",
];

interface Shape {
  id: string;
  depth: number;
  parent: string | null;
  children: string[];
  from: number;
  to: number;
}

/** Build a tree of whatever shape a test needs, over `n` filler blocks. */
function make(shapes: Shape[], blocks: Block[]): SummaryNode {
  const nodes: Record<string, unknown> = {};
  for (const s of shapes) {
    nodes[s.id] = {
      id: s.id,
      depth: s.depth,
      parent: s.parent,
      children: s.children,
      range: [blocks[s.from]?.id, blocks[s.to]?.id],
      title: `Section ${s.id}`,
      ...(s.depth < 2 && { gist: `Gist ${s.id}` }),
    };
  }
  const tree = {
    version: "1",
    generator: "t",
    slug: "s",
    rootId: shapes[0]?.id ?? "n1",
    nodes,
  } as unknown as Tree;
  const root = buildSummaryTree(tree, blocks, null);
  if (!root) throw new Error("fixture tree is unusable");
  return root;
}

/**
 * Two parts of two sections each, over eight blocks — one filler topic per
 * block, so nothing here shares vocabulary by accident.
 *
 * ```
 *  n1  root         blocks 0–7
 *  ├ n2 part one    0–3
 *  │ ├ n3           0–1
 *  │ └ n4           2–3
 *  └ n5 part two    4–7
 *    ├ n6           4–5
 *    └ n7           6–7
 * ```
 */
function twoParts(): { root: SummaryNode; blocks: Block[] } {
  const blocks = FILLER.map((t, i) => block(`b${i}`, t));
  const root = make(
    [
      { id: "n1", depth: 0, parent: null, children: ["n2", "n5"], from: 0, to: 7 },
      { id: "n2", depth: 1, parent: "n1", children: ["n3", "n4"], from: 0, to: 3 },
      { id: "n3", depth: 2, parent: "n2", children: [], from: 0, to: 1 },
      { id: "n4", depth: 2, parent: "n2", children: [], from: 2, to: 3 },
      { id: "n5", depth: 1, parent: "n1", children: ["n6", "n7"], from: 4, to: 7 },
      { id: "n6", depth: 2, parent: "n5", children: [], from: 4, to: 5 },
      { id: "n7", depth: 2, parent: "n5", children: [], from: 6, to: 7 },
    ],
    blocks,
  );
  return { root, blocks };
}

const NONE: ReadonlySet<NodeId> = new Set();

/** The sequence chain, as ordered pairs of node ids. */
function chain(root: SummaryNode, blocks: Block[], collapsed: ReadonlySet<NodeId> = NONE) {
  return buildGraph(root, blocks, collapsed).edges
    .filter((e) => e.kind === "sequence")
    .map((e) => [e.source, e.target]);
}

describe("the sequence chain", () => {
  it("runs through every drawn section in reading order, across the part boundary", () => {
    const { root, blocks } = twoParts();
    /* **n4 → n6 is the whole point.** The version this replaced joined
       consecutive *siblings*, so it drew n3→n4 and n6→n7 and then n2→n5 at the
       level above — and never once said what follows the last section of part
       one. That is the join a reader cannot work out for themselves. */
    expect(chain(root, blocks)).toEqual([
      ["n3", "n4"],
      ["n4", "n6"],
      ["n6", "n7"],
    ]);
  });

  it("is n − 1 links over n sections, each visited once", () => {
    const { root, blocks } = twoParts();
    const links = chain(root, blocks);
    const visited = new Set(links.flat());
    expect(links).toHaveLength(3);
    expect(visited).toEqual(new Set(["n3", "n4", "n6", "n7"]));
  });

  it("never points backwards up the article", () => {
    const { root, blocks } = twoParts();
    const graph = buildGraph(root, blocks);
    for (const e of graph.edges.filter((x) => x.kind === "sequence")) {
      const from = graph.byId.get(e.source);
      const to = graph.byId.get(e.target);
      /* The arrowhead is drawn at `target`. If a chain edge were ever built the
         other way round, the picture would carry an arrow pointing up the
         article — a confident statement of the opposite of the truth. */
      expect((from?.startRow ?? 0) < (to?.startRow ?? 0)).toBe(true);
    }
  });

  it("shortens rather than breaks when a part is collapsed", () => {
    const { root, blocks } = twoParts();
    /* A collapsed part is a link in the chain in its own right — its sections
       are not drawn, so something has to stand for them, and the part is the
       only honest candidate. The failure this guards is the chain simply
       stopping at the closed part, leaving the second half of the article with
       no reading order at all. */
    expect(chain(root, blocks, new Set(["n5"]))).toEqual([
      ["n3", "n4"],
      ["n4", "n5"],
    ]);
  });

  it("mixes a part that is its own section with parts that are not", () => {
    // n4 is a depth-1 leaf sitting between two parts that have children.
    const blocks = FILLER.map((t, i) => block(`b${i}`, t));
    const root = make(
      [
        { id: "n1", depth: 0, parent: null, children: ["n2", "n4", "n5"], from: 0, to: 7 },
        { id: "n2", depth: 1, parent: "n1", children: ["n3"], from: 0, to: 1 },
        { id: "n3", depth: 2, parent: "n2", children: [], from: 0, to: 1 },
        { id: "n4", depth: 1, parent: "n1", children: [], from: 2, to: 4 },
        { id: "n5", depth: 1, parent: "n1", children: ["n6"], from: 5, to: 7 },
        { id: "n6", depth: 2, parent: "n5", children: [], from: 5, to: 7 },
      ],
      blocks,
    );
    expect(chain(root, blocks)).toEqual([
      ["n3", "n4"],
      ["n4", "n6"],
    ]);
  });

  it("draws no chain at all when the root itself is closed", () => {
    const { root, blocks } = twoParts();
    // Nothing but the root is drawn, and the root is not on the picture. A
    // chain of one node is no chain; a chain including the root would be a line
    // from the article to itself.
    expect(chain(root, blocks, new Set(["n1"]))).toEqual([]);
  });
});

// ---------------------------------------------------------------- anchors

/** A block whose html carries one link to `href`. */
function linking(id: string, href: string, text: string): Block {
  return block(
    id,
    `${FILLER[0]} see also`,
    `<p>${FILLER[0]} see <a href="${href}">${text}</a></p>`,
  );
}

function anchors(root: SummaryNode, blocks: Block[]) {
  return buildGraph(root, blocks).edges.filter((e) => e.kind === "anchor");
}

describe("anchor edges", () => {
  it("joins the two sections an internal link runs between, and keeps the author's words", () => {
    const { blocks } = twoParts();
    blocks[0] = linking("b0", `#${blocks[6]?.id}`, "how we think about corrigibility");
    const { root } = { root: twoParts().root };
    const found = anchors(root, blocks);
    expect(found).toHaveLength(1);
    expect(found[0]?.source).toBe("n3");
    expect(found[0]?.target).toBe("n7");
    expect(found[0]?.label).toBe("how we think about corrigibility");
  });

  it("resolves a fragment that is not a block id, to the block containing it", () => {
    const { root, blocks } = twoParts();
    // An `id` on something smaller than a block survives stage 3 untouched, and
    // is still a real destination in the document.
    blocks[6] = block("b6", FILLER[6] ?? "", `<p><span id="footnote-4">${FILLER[6]}</span></p>`);
    blocks[0] = linking("b0", "#footnote-4", "note 4");
    expect(anchors(root, blocks).map((e) => [e.source, e.target])).toEqual([["n3", "n7"]]);
  });

  it("prefers an id anywhere in the document over an <a name> earlier in it", () => {
    const { root, blocks } = twoParts();
    /* The HTML spec resolves ids before names, and so does stage 3. The version
       of the index that indexed each block's ids AND names together, block by
       block, would answer n4 here — a line to a real section, drawn confidently,
       to a different place from where clicking the link actually lands. */
    blocks[2] = block("b2", FILLER[2] ?? "", `<p><a name="target"></a>${FILLER[2]}</p>`);
    blocks[6] = block("b6", FILLER[6] ?? "", `<p><span id="target">${FILLER[6]}</span></p>`);
    blocks[0] = linking("b0", "#target", "over there");
    expect(anchors(root, blocks).map((e) => e.target)).toEqual(["n7"]);
  });

  it("keeps the first of two duplicate ids, as querySelector would", () => {
    const { root, blocks } = twoParts();
    blocks[2] = block("b2", FILLER[2] ?? "", `<p><span id="dup">${FILLER[2]}</span></p>`);
    blocks[6] = block("b6", FILLER[6] ?? "", `<p><span id="dup">${FILLER[6]}</span></p>`);
    blocks[0] = linking("b0", "#dup", "the duplicate");
    expect(anchors(root, blocks).map((e) => e.target)).toEqual(["n4"]);
  });

  it("finds a link whose earlier attribute contains a > character", () => {
    /* **The counterexample that ended the regex version.** The HTML serialiser
       escapes `&`, `<` and `"` inside an attribute value and has no reason to
       escape `>`, so `title="1 > 0"` is valid serialised output — and a
       `<a\b[^>]*href=…>` pattern stops at that `>` and finds no link at all.
       Silent: one edge simply never appears. GPT Sol, 2026-08-27. */
    const { root, blocks } = twoParts();
    const target = blocks[6]?.id;
    blocks[0] = block(
      "b0",
      FILLER[0] ?? "",
      `<p><a title="1 > 0" href="#${target}">why 1 &gt; 0</a></p>`,
    );
    expect(anchors(root, blocks).map((e) => [e.source, e.target])).toEqual([["n3", "n7"]]);
  });

  it("shows the link text as characters, not as HTML entities", () => {
    /* The other half of the same finding: stripping tags off raw HTML left
       `A &amp; B` to be printed at a reader as those literal characters. */
    const { root, blocks } = twoParts();
    blocks[0] = block(
      "b0",
      FILLER[0] ?? "",
      `<p><a href="#${blocks[6]?.id}">Rock <em>&amp;</em> roll</a></p>`,
    );
    expect(anchors(root, blocks)[0]?.label).toBe("Rock & roll");
  });

  it("decodes a percent-encoded fragment", () => {
    const { root, blocks } = twoParts();
    blocks[6] = block("b6", FILLER[6] ?? "", `<p><span id="a b">${FILLER[6]}</span></p>`);
    blocks[0] = linking("b0", "#a%20b", "spaced");
    expect(anchors(root, blocks)).toHaveLength(1);
  });

  it("needs a DOM, and the environment supplies one", () => {
    /* **A guard against measuring the fallback.** `parseBlocks` returns null
       where there is no `DOMParser` and the anchor edges are then silently
       absent — which, on a corpus where six of seven articles genuinely have
       none, is indistinguishable from the correct answer. Running the graph
       over the real constitution in a Node script reported 0 edges where there
       are 5, and looked exactly like a broken rewrite.

       The environment directive at the top of this file is what supplies one.
       Measured with it removed: 12 tests fail — so most of this block is safe
       either way. What it protects is the **negatives**, like "draws nothing
       for a fragment the document does not answer to", which pass perfectly
       well by finding nothing at all. Those are the ones that would go quiet.

       **Do not write that directive's name in prose.** Vitest scans the file
       for it, so an earlier draft of this very comment mentioned it by name and
       silently became a second copy of it — which is how I found out that
       deleting the real one at the top changed nothing. A comment that
       accidentally *is* the configuration it describes. */
    expect(typeof DOMParser).toBe("function");
  });

  it("draws nothing for a fragment the document does not answer to", () => {
    const { root, blocks } = twoParts();
    /* **The important negative.** Inventing a destination is worse than the
       dead link — internal-links.ts refuses the same case for the same reason.
       A `Map.get` returning undefined and read as row 0 would draw a line to
       the first section of the article: plausible-looking, and false.

       **The link is in block 6, not block 0, and that is the test.** With it in
       block 0 the broken version resolves both ends to n3 and the self-link
       guard silently drops the edge — so the assertion held with the check
       deleted, and proved nothing. From block 6 the falsehood has somewhere to
       go: an n7 → n3 line. */
    blocks[6] = linking("b6", "#nothing-here", "broken");
    expect(anchors(root, blocks)).toEqual([]);
  });

  it("ignores a bare # and a malformed percent escape", () => {
    const { root, blocks } = twoParts();
    blocks[0] = block(
      "b0",
      FILLER[0] ?? "",
      `<p><a href="#">top</a> and <a href="#%">broken</a></p>`,
    );
    expect(anchors(root, blocks)).toEqual([]);
  });

  it("drops a link that lands in the section it started from", () => {
    const { root, blocks } = twoParts();
    // Blocks 0 and 1 are both inside n3. A section linking to itself is a
    // footnote marker, not a structure.
    blocks[0] = linking("b0", `#${blocks[1]?.id}`, "just below");
    expect(anchors(root, blocks)).toEqual([]);
  });

  it("counts several links between one pair as one edge", () => {
    const { root, blocks } = twoParts();
    blocks[0] = linking("b0", `#${blocks[6]?.id}`, "first");
    blocks[1] = linking("b1", `#${blocks[7]?.id}`, "second");
    const found = anchors(root, blocks);
    expect(found).toHaveLength(1);
    expect(found[0]?.weight).toBe(2);
  });

  it("refuses to let one section collect more than three of them", () => {
    /* The endnotes case: every section links into one bibliography, and the
       picture becomes a star that is perfectly true and says nothing. Six
       sections all pointing at n7 must not produce six lines on n7. */
    const blocks = FILLER.map((t, i) => block(`b${i}`, t));
    const shapes: Shape[] = [
      { id: "n1", depth: 0, parent: null, children: [], from: 0, to: 7 },
    ];
    const kids: string[] = [];
    for (let i = 0; i < 8; i++) {
      shapes.push({ id: `s${i}`, depth: 1, parent: "n1", children: [], from: i, to: i });
      kids.push(`s${i}`);
    }
    shapes[0] = { id: "n1", depth: 0, parent: null, children: kids, from: 0, to: 7 };
    for (let i = 0; i < 7; i++) {
      blocks[i] = linking(`b${i}`, `#${blocks[7]?.id}`, "see the notes");
    }
    const root = make(shapes, blocks);
    const found = anchors(root, blocks);
    const onNotes = found.filter((e) => e.source === "s7" || e.target === "s7");
    expect(onNotes.length).toBeLessThanOrEqual(3);
  });
});

// --------------------------------------------------------------- semantic

/** The graph's semantic edges as `[source, target]`, given some similar pairs. */
function semantic(root: SummaryNode, blocks: Block[], pairs: SimilarPair[]) {
  return buildGraph(root, blocks, NONE, pairs).edges
    .filter((e) => e.kind === "semantic")
    .map((e) => [e.source, e.target]);
}

describe("semantic edges", () => {
  it("maps a pair of blocks to the two sections holding them", () => {
    const { root, blocks } = twoParts();
    const pairs: SimilarPair[] = [
      { a: blocks[0]?.id ?? "", b: blocks[6]?.id ?? "", score: 0.82 },
    ];
    expect(semantic(root, blocks, pairs)).toEqual([["n3", "n7"]]);
  });

  it("drops a pair whose blocks are in one section", () => {
    const { root, blocks } = twoParts();
    const pairs: SimilarPair[] = [
      { a: blocks[0]?.id ?? "", b: blocks[1]?.id ?? "", score: 0.9 },
    ];
    expect(semantic(root, blocks, pairs)).toEqual([]);
  });

  it("drops a pair whose sections the reading-order chain already joins", () => {
    /* **The finding the server's block-adjacency guard cannot make.** Blocks 1
       and 2 are three rows apart at block level and sail past `|i − j| ≤ 1`, but
       they sit in n3 and n4 — which are consecutive sections, already joined by
       the thick arrow. A dotted line there restates the loudest thing in the
       picture and spends one of ten slots doing it. */
    const { root, blocks } = twoParts();
    const pairs: SimilarPair[] = [
      { a: blocks[1]?.id ?? "", b: blocks[2]?.id ?? "", score: 0.95 },
    ];
    expect(semantic(root, blocks, pairs)).toEqual([]);
  });

  it("keeps the best-scoring pair when several point at the same two sections", () => {
    const { root, blocks } = twoParts();
    const pairs: SimilarPair[] = [
      { a: blocks[0]?.id ?? "", b: blocks[6]?.id ?? "", score: 0.7 },
      { a: blocks[1]?.id ?? "", b: blocks[7]?.id ?? "", score: 0.88 },
    ];
    const edges = buildGraph(root, blocks, NONE, pairs).edges.filter((e) => e.kind === "semantic");
    expect(edges).toHaveLength(1);
    expect(edges[0]?.weight).toBeCloseTo(0.88);
    // The passages that actually earned it ride along, so the card can name
    // them rather than asking the reader to trust a dotted line.
    expect(edges[0]?.passages).toEqual([blocks[1]?.id, blocks[7]?.id]);
  });

  it("ignores a pair naming a block the article no longer has", () => {
    const { root, blocks } = twoParts();
    const pairs: SimilarPair[] = [{ a: "spya-gone", b: blocks[6]?.id ?? "", score: 0.9 }];
    expect(semantic(root, blocks, pairs)).toEqual([]);
  });

  it("changes where the bubbles sit, not just how many lines there are", () => {
    /* **Sol's test, and the one that decides whether the experiment happened.**
       Greg asked to see what embeddings do to the *shape* of the picture. If
       the pairs arrived and were only painted, the answer would be "nothing" —
       and the picture would look exactly as though it had worked. This asserts
       the simulation actually ran with them. */
    const { root, blocks } = twoParts();
    const opts = { width: 320, height: 600, collapsed: NONE };
    const before = layoutDiagram("force", root, opts, buildGraph(root, blocks));
    const after = layoutDiagram(
      "force",
      root,
      opts,
      buildGraph(root, blocks, NONE, [
        { a: blocks[0]?.id ?? "", b: blocks[6]?.id ?? "", score: 0.95 },
      ]),
    );
    const xOf = (l: typeof before, id: string) => l.nodes.find((n) => n.id === id)?.x ?? 0;
    expect(xOf(after, "n3")).not.toBeCloseTo(xOf(before, "n3"));
  });
});

// ----------------------------------------------------------------- paint

describe("what the force picture draws", () => {
  it("names the kind of every line, on every picture", () => {
    /* `DiagramLink.kind` is required precisely so this cannot regress into a
       line that forgot to say what it claims — but a required field with a
       `?? "parent"` somewhere would satisfy the compiler and not this. */
    const { root, blocks } = twoParts();
    const opts = { width: 320, height: 600, collapsed: NONE };
    const graph = buildGraph(root, blocks);
    for (const kind of ["tree", "force"] as const) {
      for (const l of layoutDiagram(kind, root, opts, graph).links) {
        expect(l.kind, `${kind} link ${l.id}`).toBeTruthy();
      }
    }
  });

  it("puts an arrow on the sequence chain and on nothing else", () => {
    const { root, blocks } = twoParts();
    const layout = layoutDiagram(
      "force",
      root,
      { width: 320, height: 600, collapsed: NONE },
      buildGraph(root, blocks),
    );
    for (const l of layout.links) {
      expect(Boolean(l.arrow), `${l.kind} ${l.id}`).toBe(l.kind === "sequence");
    }
  });

  it("draws the sequence lines from circle edge to circle edge, never centre to centre", () => {
    /* **The arrowhead is painted at the path's last point.** Centre to centre
       puts it inside a filled circle, where it is invisible — the line still
       draws, and the feature reads as "the arrows did not work". So every
       sequence line must stop short of both bubbles. */
    const { root, blocks } = twoParts();
    const layout = layoutDiagram(
      "force",
      root,
      { width: 320, height: 600, collapsed: NONE },
      buildGraph(root, blocks),
    );
    const at = (id: string) => {
      const n = layout.nodes.find((x) => x.id === id);
      return n ? { x: n.x + n.w / 2, y: n.y + n.h / 2, r: n.w / 2 } : null;
    };
    const seq = layout.links.filter((l) => l.kind === "sequence" && l.d !== "M 0 0");
    expect(seq.length).toBeGreaterThan(0);
    for (const l of seq) {
      const m = /^M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)$/.exec(l.d);
      expect(m, l.d).not.toBeNull();
      const [, x1, y1, x2, y2] = (m ?? []).map(Number);
      const ids = /^f\d+-(\S+?)-(\S+)$/.exec(l.id);
      const from = at(ids?.[1] ?? "");
      const to = at(ids?.[2] ?? "");
      if (!from || !to) continue;
      // The start is outside the source circle and the end outside the target.
      expect(Math.hypot((x1 ?? 0) - from.x, (y1 ?? 0) - from.y)).toBeGreaterThanOrEqual(from.r);
      expect(Math.hypot((x2 ?? 0) - to.x, (y2 ?? 0) - to.y)).toBeGreaterThanOrEqual(to.r);
    }
  });

  it("paints the two sparse kinds last, so a thick line cannot bury them", () => {
    /* **This needs a fixture with vocabulary edges in it**, and the first
       version did not have one: every filler topic was distinct, so there were
       no vocabulary edges, `lastIndexOf("vocabulary")` was −1, and the
       assertion held whatever the paint order was. Watched pass with the sort
       removed, which is what sent me back to the fixture. */
    const blocks = FILLER.map((t, i) => block(`b${i}`, t));
    // n3 (blocks 0–1) and n7 (blocks 6–7) now talk about the same thing, so a
    // vocabulary edge exists to be painted under.
    blocks[6] = block("b6", `${FILLER[0]} again`);
    blocks[7] = block("b7", `${FILLER[0]} once more`);
    blocks[0] = linking("b0", `#${blocks[6]?.id}`, "over there");
    const root = twoParts().root;
    const graph = buildGraph(root, blocks, NONE, [
      { a: blocks[2]?.id ?? "", b: blocks[7]?.id ?? "", score: 0.9 },
    ]);
    expect(graph.edges.some((e) => e.kind === "vocabulary")).toBe(true);

    const layout = layoutDiagram("force", root, { width: 320, height: 600, collapsed: NONE }, graph);
    const kinds = layout.links.map((l) => l.kind);
    const lastCheap = Math.max(
      kinds.lastIndexOf("parent"),
      kinds.lastIndexOf("sequence"),
      kinds.lastIndexOf("vocabulary"),
    );
    expect(kinds.indexOf("anchor")).toBeGreaterThan(lastCheap);
    expect(kinds.indexOf("semantic")).toBeGreaterThan(lastCheap);
  });
});

// -------------------------------------------------------------- geometry

/** A bubble at (x, y) with radius r — the only part of a `Sim` `arrowPath` reads. */
function bubble(x: number, y: number, r: number): Sim {
  return { x, y, r, n: { id: "n" } as unknown as Sim["n"] };
}

/** Where a path string ends up, as numbers. */
function ends(d: string): { x1: number; y1: number; x2: number; y2: number } | null {
  const m = /^M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)$/.exec(d);
  if (!m) return null;
  const [, a, b, c, e] = m.map(Number);
  return { x1: a ?? 0, y1: b ?? 0, x2: c ?? 0, y2: e ?? 0 };
}

describe("arrowPath", () => {
  /* Tested directly rather than through a layout. The interesting cases are
     circles overlapping and circles coincident, and a force simulation is under
     no obligation to produce either — the first version of this reached for a
     narrow, short picture, got no overlaps at all, and passed with the overlap
     guard deleted. GPT Sol asked for exactly these four cases; they are only
     reachable with the helper exported. */

  it("stops at both circles' edges when they are well apart", () => {
    // 100px apart, radii 10 and 20. Trims are r+1 and r+HEAD_GAP(5).
    const d = ends(arrowPath(bubble(0, 0, 10), bubble(0, 100, 20)));
    expect(d?.y1).toBeCloseTo(11);
    expect(d?.y2).toBeCloseTo(75);
  });

  it("points from the earlier bubble to the later one", () => {
    const d = ends(arrowPath(bubble(0, 10, 6), bubble(0, 90, 6)));
    expect((d?.y2 ?? 0) > (d?.y1 ?? 0)).toBe(true);
  });

  it("draws nothing when the circles touch too closely for a head to fit", () => {
    // Centres 30 apart, radii 12 each: 30 < (12+1) + (12+5). There is no honest
    // short line here, and the naive trim returns one pointing BACKWARDS.
    expect(arrowPath(bubble(0, 0, 12), bubble(0, 30, 12))).toBe("M 0 0");
  });

  it("draws nothing when one circle is inside the other", () => {
    expect(arrowPath(bubble(0, 0, 20), bubble(0, 5, 18))).toBe("M 0 0");
  });

  it("draws nothing for two bubbles at exactly the same point", () => {
    // Direction is undefined at distance zero — dividing by it gives NaN, and a
    // path full of NaN renders as nothing while every assertion about "is there
    // a line" still says yes.
    expect(arrowPath(bubble(40, 40, 8), bubble(40, 40, 8))).toBe("M 0 0");
  });

  it("never emits a segment shorter than nothing", () => {
    // A sweep across the whole overlap boundary. The failure being guarded is
    // silent: a signed length that goes negative flips the line, and
    // `orient="auto"` then aims the arrowhead back up the article.
    for (let gap = 0; gap < 80; gap += 0.5) {
      const d = ends(arrowPath(bubble(0, 0, 12), bubble(0, gap, 12)));
      if (!d) continue;
      expect(d.y2 - d.y1, `gap ${gap}`).toBeGreaterThan(0);
    }
  });
});

// --------------------------------------------------------------- physics

/** A link of one kind and weight, which is all `strengthOf` reads. */
function link(kind: SimLink["e"]["kind"], weight: number): SimLink {
  return { e: { kind, weight, source: "a", target: "b" } } as unknown as SimLink;
}

describe("what each kind of line is allowed to do to the picture", () => {
  it("keeps an embedding edge from out-pulling the vocabulary edges it is drawn beside", () => {
    /* **The scale bug, and it is invisible on screen.** A tf-idf cosine between
       two sections of one article runs about 0.12–0.5; an embedding cosine
       between any two passages of the same article runs 0.6–0.9. Letting
       `semantic` fall through to the vocabulary formula — which is the obvious
       thing, since both are "how alike are these" — gives a 0.85 pair a
       strength of 0.55, as strong as containment. The picture still draws, and
       the answer to "what do embeddings do to the shape" becomes an artefact of
       a fallthrough. GPT Sol caught this before it ran. */
    const strongestVocabulary = strengthOf(link("vocabulary", 0.5));
    expect(strengthOf(link("semantic", 0.95))).toBeLessThanOrEqual(strongestVocabulary);
    expect(strengthOf(link("semantic", 0.95))).toBeLessThan(strengthOf(link("parent", 1)));
  });

  it("ignores an embedding edge that is only as alike as any two passages are", () => {
    // Below 0.6 the number says nothing about one article's own passages, so
    // the line may be drawn but must not move anything.
    expect(strengthOf(link("semantic", 0.55))).toBe(0);
  });

  it("keeps the sequence chain weak however thick it is drawn", () => {
    /* Every node is pinned in y, so a strong sequence force can only act
       sideways — and what it does there is drag the picture back into a column,
       undoing the one axis this layout solves for. */
    expect(strengthOf(link("sequence", 1))).toBeLessThan(strengthOf(link("vocabulary", 0.12)));
  });

  it("lets the author's own cross-reference pull harder than either measure", () => {
    expect(strengthOf(link("anchor", 1))).toBeGreaterThan(strengthOf(link("vocabulary", 0.5)));
    expect(strengthOf(link("anchor", 1))).toBeLessThan(strengthOf(link("parent", 1)));
  });
});

// ------------------------------------------------------------ the card

describe("what the footer card is told about a line", () => {
  /* **The recurring failure in this feature, twice now.** Round one computed
     the words behind every vocabulary edge and showed none of them; round two
     put the passage ids on every semantic edge, documented them as "so the card
     can name them", and threw them away in the panel. Both times a full suite
     passed. A line the reader cannot interrogate looks exactly as
     authoritative as one that is right, which is why this is not a cosmetic
     test. */

  it("names the passage behind a dotted line, not only its score", () => {
    const { root, blocks } = twoParts();
    const graph = buildGraph(root, blocks, NONE, [
      { a: blocks[0]?.id ?? "", b: blocks[6]?.id ?? "", score: 0.87 },
    ]);
    const rows = relatedFor(graph, "n3", blocks);
    const semantic = rows.find((r) => r.kind === "semantic");
    expect(semantic?.score).toBeCloseTo(0.87);
    // The passage at the OTHER end — the card is already about n3.
    expect(semantic?.quote).toContain((FILLER[6] ?? "").slice(0, 20));
  });

  it("quotes the author's own words behind a cross-reference", () => {
    const { root, blocks } = twoParts();
    blocks[0] = linking("b0", `#${blocks[6]?.id}`, "how we think about corrigibility");
    const rows = relatedFor(buildGraph(root, blocks), "n3", blocks);
    expect(rows.find((r) => r.kind === "anchor")?.label).toBe(
      "how we think about corrigibility",
    );
  });

  it("puts the author's cross-reference above either measured kind", () => {
    /* The ladder in graph.ts § EdgeKind, drawn the right way up: a fact before
       two guesses, whatever their weights say.

       **This passes with the `rank()` key removed, and is kept anyway.** An
       anchor edge's `weight` is a *count of links* and starts at 1, while a
       vocabulary or semantic weight is a cosine that cannot reach 1 — so a
       weight-only sort happens to give the same order today. That is a
       coincidence between two fields that measure different things, not a
       property, and comparing them numerically is meaningless in the first
       place. What this pins is the contract; `rank()` is what makes it
       intentional. Recorded rather than quietly kept —
       docs/reusable/silent-success.md. */
    const blocks = FILLER.map((t, i) => block(`b${i}`, t));
    blocks[6] = block("b6", `${FILLER[0]} again`);
    blocks[7] = block("b7", `${FILLER[0]} once more`);
    blocks[0] = linking("b0", `#${blocks[6]?.id}`, "over there");
    const root = twoParts().root;
    const rows = relatedFor(
      buildGraph(root, blocks, NONE, [
        { a: blocks[1]?.id ?? "", b: blocks[7]?.id ?? "", score: 0.95 },
      ]),
      "n3",
      blocks,
    );
    expect(rows[0]?.kind).toBe("anchor");
    expect(rows.map((r) => r.kind)).toContain("vocabulary");
  });

  it("says nothing about containment or reading order", () => {
    // Both are already told by the picture — the parent line and the vertical
    // axis. Repeating them in the card would spend rows on what is visible.
    const { root, blocks } = twoParts();
    const kinds = relatedFor(buildGraph(root, blocks), "n3", blocks).map((r) => r.kind);
    expect(kinds).not.toContain("parent");
    expect(kinds).not.toContain("sequence");
  });
});
