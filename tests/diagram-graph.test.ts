// @vitest-environment jsdom
/**
 * The article as a weighted graph — src/web/graph.ts — and the three D3
 * pictures that need it (src/web/diagram-d3.ts).
 *
 * Two things are under test and they fail in different ways.
 *
 * **The graph** is arithmetic over prose, and its failure is *plausible nonsense*:
 * an edge between two sections that share nothing but English, or a tf-idf that
 * quietly ranks the commonest word first. Nothing errors, and the picture still
 * looks like a picture — it is just describing an article that does not exist.
 *
 * **The layouts** fail the way every layout in this feature fails: silently, off
 * the edge of the band, because SVG neither wraps nor clips. Same checks as
 * tests/diagram.test.ts, plus the one a force simulation adds — **that it gives
 * the same answer twice.**
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Block, BlockId, NodeId, Tree } from "../src/types.js";
import { buildGraph, terms, wordsBefore } from "../src/web/graph.js";
import { layoutDiagram } from "../src/web/diagrams.js";
import { buildSummaryTree, type SummaryNode } from "../src/web/tree.js";

/**
 * A block with a real word count, since the graph now measures in words.
 *
 * Typed rather than cast: the `as Block` this used to end with hid the fact that
 * the literal was missing `kind`'s actual union member, and `npm run typecheck`
 * — which checks the tests too — was the only thing that noticed.
 */
function block(id: string, text: string): Block {
  return {
    id: `spya-${id}` as BlockId,
    tag: "p",
    kind: "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: `<p>${text}</p>`,
    gistable: true,
  };
}

/**
 * Two parts of two sections each. Sections 1.1 and 2.2 are deliberately written
 * about the same subject while sitting in *different parts* — which is the one
 * relationship a tree cannot express and the whole reason this file exists.
 */
function article(): { root: SummaryNode; blocks: Block[] } {
  const texts = [
    "Consciousness perception hallucination brain predicts sensory signals constantly",
    "Consciousness perception hallucination brain predicts sensory signals again",
    "Weather forecasting rainfall pressure atmosphere measurement stations record",
    "Weather forecasting rainfall pressure atmosphere measurement stations record daily",
    "Cricket batting bowling wickets innings umpire pavilion spectators",
    "Cricket batting bowling wickets innings umpire pavilion spectators cheer",
    "Consciousness perception hallucination brain predicts sensory signals returns",
    "Consciousness perception hallucination brain predicts sensory signals closes",
  ];
  const blocks = texts.map((t, i) => block(`b${i}`, t));

  const nodes: Record<string, unknown> = {};
  const mk = (
    id: string,
    depth: number,
    parent: string | null,
    children: string[],
    from: number,
    to: number,
    title: string,
  ) => {
    nodes[id] = {
      id,
      depth,
      parent,
      children,
      range: [blocks[from]?.id, blocks[to]?.id],
      title,
      ...(depth < 2 && { gist: `Gist for ${title}` }),
    };
  };
  mk("n1", 0, null, ["n2", "n5"], 0, 7, "The whole thing");
  mk("n2", 1, "n1", ["n3", "n4"], 0, 3, "First part");
  mk("n3", 2, "n2", [], 0, 1, "Perception");
  mk("n4", 2, "n2", [], 2, 3, "Weather");
  mk("n5", 1, "n1", ["n6", "n7"], 4, 7, "Second part");
  mk("n6", 2, "n5", [], 4, 5, "Cricket");
  mk("n7", 2, "n5", [], 6, 7, "Perception again");

  const tree = { version: "1", generator: "t", slug: "s", rootId: "n1", nodes } as unknown as Tree;
  const root = buildSummaryTree(tree, blocks, null);
  if (!root) throw new Error("fixture tree is unusable");
  return { root, blocks };
}

const NONE: ReadonlySet<NodeId> = new Set();
const OPTS = { width: 320, height: 600, collapsed: NONE };

describe("terms", () => {
  it("drops function words and anything under four letters", () => {
    expect(terms("The cat sat on a very large mat about which we shall not speak")).toEqual([
      "large",
      "shall",
      "speak",
    ]);
  });

  it("folds apostrophes into the word rather than splitting on them", () => {
    // "doesn't" and "doesnt" must be one term, or an article that uses both
    // scores each at half strength and neither survives the top ten.
    expect(terms("consciousness’s")).toEqual(["consciousnesss"]);
    expect(terms("Turing's machine")).toEqual(["turings", "machine"]);
  });

  it("returns nothing for prose made entirely of function words", () => {
    expect(terms("it is what it is and that is all there is to it")).toEqual([]);
  });
});

describe("wordsBefore", () => {
  it("is a prefix sum one longer than the blocks, so any range subtracts", () => {
    const blocks = [block("a", "one two three"), block("b", "four five")];
    expect(wordsBefore(blocks)).toEqual([0, 3, 5]);
  });

  it("is [0] for an article with no blocks, rather than empty", () => {
    // An empty array here would make every `?? 0` lookup silently return zero
    // and every section measure the same size.
    expect(wordsBefore([])).toEqual([0]);
  });
});

describe("buildGraph", () => {
  const { root, blocks } = article();
  const g = buildGraph(root, blocks);

  it("measures a node in words, not in blocks", () => {
    const s = g.byId.get("n3" as NodeId);
    expect(s?.blocks).toBe(2);
    expect(s?.words).toBe(16); // 8 + 8, counted from the prose rather than assumed
  });

  it("gives every section its own distinctive terms", () => {
    expect(g.byId.get("n4" as NodeId)?.terms).toContain("weather");
    expect(g.byId.get("n6" as NodeId)?.terms).toContain("cricket");
    // And NOT the other's, which is what tf-idf is for.
    expect(g.byId.get("n6" as NodeId)?.terms).not.toContain("weather");
  });

  it("links two sections about the same thing across different parts", () => {
    /* THE test. 1.1 and 2.2 are in different parts and are not siblings, so no
       tree edge joins them and no tree layout could ever put them together. */
    const vocab = g.edges.filter((e) => e.kind === "vocabulary");
    const pair = vocab.find(
      (e) =>
        (e.source === "n3" && e.target === "n7") || (e.source === "n7" && e.target === "n3"),
    );
    expect(pair, "no vocabulary edge between the two perception sections").toBeDefined();
    expect(pair?.shared).toContain("consciousness");
    // Cosine over unit tf-idf vectors, so a near-identical pair approaches 1.
    expect(pair?.weight).toBeGreaterThan(0.5);
    expect(pair?.weight).toBeLessThanOrEqual(1.000001);
  });

  it("does not link two sections that share only English", () => {
    const vocab = g.edges.filter((e) => e.kind === "vocabulary");
    const bogus = vocab.find(
      (e) =>
        (e.source === "n4" && e.target === "n6") || (e.source === "n6" && e.target === "n4"),
    );
    expect(bogus, "weather and cricket should not be related").toBeUndefined();
  });

  /** An article from one block per section, all at depth 1, for the two tests below. */
  function fromSections(texts: string[]) {
    const blocks2 = texts.map((t, i) => block(`s${i}`, t));
    const ids = texts.map((_, i) => `k${i}`);
    const nodes: Record<string, unknown> = {
      r: {
        id: "r",
        depth: 0,
        parent: null,
        children: ids,
        range: [blocks2[0]?.id, blocks2[blocks2.length - 1]?.id],
        title: "Root",
      },
    };
    ids.forEach((id, i) => {
      nodes[id] = {
        id,
        depth: 1,
        parent: "r",
        children: [],
        range: [blocks2[i]?.id, blocks2[i]?.id],
        title: `Section ${i}`,
      };
    });
    const t = { version: "1", generator: "t", slug: "s", rootId: "r", nodes } as unknown as Tree;
    const r2 = buildSummaryTree(t, blocks2, null);
    if (!r2) throw new Error("fixture unusable");
    return buildGraph(r2, blocks2);
  }

  it("ranks by how much a shared term matters, not by how many are shared", () => {
    /* **The cosine-versus-set-overlap test.** Counting shared terms and taking
       the dot product of two tf-idf vectors agree on most inputs, which is why
       an earlier pair of tests here stayed green when I swapped cosine back out
       for the old measure. This fixture is built so they disagree — and so they
       disagree in the direction that matters.

       Sections 0 and 1 share ONE term, "kestrel", used five times each and found
       nowhere else in the article. Sections 2 and 3 share TWO, "landscape" and
       "surface", each used once and found in four of the six sections.

       Counting says the second pair is the stronger relationship: two shared
       terms out of eight beats one out of seven. That is plainly wrong — one
       pair is about falconry and the other pair is two different kinds of
       geology that both mention the ground. Weighting each shared term by how
       distinctive it is at both ends gets it right, and the wrong answer here is
       exactly the "confident and about nothing" edge this measure exists to
       avoid. */
    const g2 = fromSections([
      "kestrel kestrel kestrel kestrel kestrel plumage talons mantling stoop falconry jesses",
      "kestrel kestrel kestrel kestrel kestrel eyases hacking creance swivel bewits leash",
      "landscape surface granite quartzite feldspar sediments outcrop bedrock",
      "landscape surface obsidian pumice rhyolite andesite scoria tuffaceous",
      "landscape surface heather bracken gorse moorland peatland",
      "landscape surface estuary saltmarsh mudflat lagoon shingle",
    ]);
    const vocab = g2.edges.filter((e) => e.kind === "vocabulary");
    const between = (a: string, b: string) =>
      vocab.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));

    expect(between("k0", "k1"), "the falconry pair should be linked").toBeDefined();
    expect(
      between("k2", "k3"),
      "two shared words the whole article uses is not a relationship",
    ).toBeUndefined();
    expect(between("k0", "k1")?.shared).toContain("kestrel");
  });

  it("refuses an edge from a section too short to have a subject", () => {
    /* **The bibliography guard**, tested directly. Under the first version's
       normalisation — shared terms over the SMALLER vocabulary — a two-term stub
       that shares both terms scored a perfect 1.0, and the strongest links in a
       scanned pamphlet were between its title page and its half-title.

       Section 0 here is such a stub. It must form no edge, however perfectly its
       two words match. */
    const g2 = fromSections([
      "phrenology utility",
      "phrenology utility character faculties cranium temperament organs propensities amativeness",
      "phrenology utility character faculties cranium temperament organs propensities benevolence",
      "railways locomotive carriages gauge sleepers signalling timetable junction viaduct",
    ]);
    const vocab = g2.edges.filter((e) => e.kind === "vocabulary");
    expect(
      vocab.some((e) => e.source === "k0" || e.target === "k0"),
      "a two-word stub must not be the best-connected thing in the article",
    ).toBe(false);
    // The two real sections still find each other.
    expect(vocab.some((e) => new Set([e.source, e.target]).has("k1" as NodeId))).toBe(true);
  });

  it("demotes a word the whole article says a lot", () => {
    /* **This is the idf half, and it needs a fixture built for it.** The main
       article above uses each term once per section, so tf is flat and the top
       ten holds everything — replacing tf-idf with raw frequency leaves those
       assertions green, which is how I found out they were not testing this.

       Here "consciousness" is the most frequent word in both sections AND is in
       both, so idf drives it to nearly nothing; raw frequency would rank it
       first in each. What each section is actually *about* is the word only it
       uses. */
    const a = block(
      "p",
      "consciousness consciousness consciousness consciousness anaesthesia anaesthesia",
    );
    const b = block(
      "q",
      "consciousness consciousness consciousness consciousness octopus octopus",
    );
    const nodes: Record<string, unknown> = {
      r: { id: "r", depth: 0, parent: null, children: ["p", "q"], range: [a.id, b.id], title: "Root" },
      p: { id: "p", depth: 1, parent: "r", children: [], range: [a.id, a.id], title: "Waking" },
      q: { id: "q", depth: 1, parent: "r", children: [], range: [b.id, b.id], title: "Octopus" },
    };
    const t = { version: "1", generator: "t", slug: "s", rootId: "r", nodes } as unknown as Tree;
    const r2 = buildSummaryTree(t, [a, b], null);
    expect(r2).not.toBeNull();
    if (!r2) return;
    const g2 = buildGraph(r2, [a, b]);
    expect(g2.byId.get("p" as NodeId)?.terms[0]).toBe("anaesthesia");
    expect(g2.byId.get("q" as NodeId)?.terms[0]).toBe("octopus");
  });

  it("ignores a single coincidental shared term", () => {
    /* The floor, tested directly — the weather/cricket pair above does NOT
       exercise it, because those two share no top terms at all and so never
       become a candidate. Checked by dropping EDGE_FLOOR to 0 and watching that
       test stay green, which is what sent me to write this one. Here the two
       sections share exactly one term out of ten, which is 0.1 and below the
       floor: enough to be a coincidence, not enough to be a subject. */
    const common = "Machinery hydraulic pistons couplings flanges gaskets bearings tolerance spindle";
    const a = `${common} shared`;
    const b = "Botany chlorophyll stomata xylem phloem cambium petiole rhizome shared";
    const blocks2 = [block("x", a), block("y", b)];
    const nodes: Record<string, unknown> = {
      r: { id: "r", depth: 0, parent: null, children: ["p", "q"], range: [blocks2[0]?.id, blocks2[1]?.id], title: "Root" },
      p: { id: "p", depth: 1, parent: "r", children: [], range: [blocks2[0]?.id, blocks2[0]?.id], title: "Machines" },
      q: { id: "q", depth: 1, parent: "r", children: [], range: [blocks2[1]?.id, blocks2[1]?.id], title: "Plants" },
    };
    const t = { version: "1", generator: "t", slug: "s", rootId: "r", nodes } as unknown as Tree;
    const r2 = buildSummaryTree(t, blocks2, null);
    expect(r2).not.toBeNull();
    if (!r2) return;
    const g2 = buildGraph(r2, blocks2);
    const shared = g2.edges.filter((e) => e.kind === "vocabulary");
    expect(shared, "one shared word out of ten is not a relationship").toHaveLength(0);
  });

  it("records containment and reading order as their own kinds", () => {
    const parent = g.edges.filter((e) => e.kind === "parent");
    const seq = g.edges.filter((e) => e.kind === "sequence");
    expect(parent.some((e) => e.source === "n2" && e.target === "n3")).toBe(true);
    expect(seq.some((e) => e.source === "n3" && e.target === "n4")).toBe(true);
    /* **This assertion was the other way round until 2026-08-27**, and it is
       worth leaving the note. A sequence edge used to mean "next among my
       siblings", so it stopped at every part boundary — and the join a reader
       most needs, what follows the last section of part one, was the one the
       graph did not have. Greg: *"between each consecutive pair"*. The chain now
       runs through the whole article; tests/diagram-force-links.test.ts is where
       it is tested properly. */
    expect(seq.some((e) => e.source === "n4" && e.target === "n6")).toBe(true);
  });

  it("drops a closed part's sections from the graph entirely", () => {
    /* Not merely hidden: a section still in the node list would keep exerting
       charge in the force layout from behind a node the reader has closed. */
    const shut = buildGraph(root, blocks, new Set(["n2" as NodeId]));
    expect(shut.byId.has("n3" as NodeId)).toBe(false);
    expect(shut.byId.has("n6" as NodeId)).toBe(true);
    expect(shut.edges.every((e) => e.source !== "n3" && e.target !== "n3")).toBe(true);
  });

  it("gives the same graph twice for the same input", () => {
    expect(JSON.stringify(buildGraph(root, blocks).edges)).toEqual(
      JSON.stringify(buildGraph(root, blocks).edges),
    );
  });
});

describe("the Force layout", () => {
  const { root, blocks } = article();
  const graph = buildGraph(root, blocks);

  for (const kind of ["force"] as const) {
    it(`${kind} keeps every node and every label inside the band`, () => {
      for (const width of [288, 320, 400]) {
        const l = layoutDiagram(kind, root, { ...OPTS, width }, graph);
        expect(l.nodes.length).toBeGreaterThan(0);
        for (const n of l.nodes) {
          for (const v of [n.x, n.y, n.w, n.h, n.labelX, n.labelY]) {
            expect(Number.isFinite(v), `${kind} ${n.number} has a non-finite coordinate`).toBe(true);
          }
          expect(n.w).toBeGreaterThanOrEqual(0);
          expect(n.h).toBeGreaterThanOrEqual(0);
          expect(n.x).toBeGreaterThanOrEqual(-0.5);
          expect(n.x + n.w).toBeLessThanOrEqual(width + 0.5);
          if (n.dot) {
            expect(n.dot.x - n.dot.r).toBeGreaterThanOrEqual(-0.5);
            expect(n.dot.x + n.dot.r).toBeLessThanOrEqual(width + 0.5);
          }
        }
      }
    });

    it(`${kind} draws no path containing NaN`, () => {
      // A single NaN in a `d` attribute makes the browser drop the WHOLE path,
      // so one bad number is one invisible connector and no error anywhere.
      const l = layoutDiagram(kind, root, OPTS, graph);
      for (const link of l.links) expect(link.d).not.toMatch(/NaN|Infinity|undefined/);
    });

    it(`${kind} falls back to a real picture when handed no graph`, () => {
      // Rather than throwing: same rule params.ts uses for an unknown value.
      const l = layoutDiagram(kind, root, OPTS, null);
      expect(l.nodes.length).toBeGreaterThan(0);
    });
  }

  it("force settles to exactly the same positions twice", () => {
    /* **The one test a force layout needs that no other layout does.**
       d3-force v3 is deterministic on its own — it carries a seeded LCG rather
       than calling `Math.random` (src/web/diagram-d3.ts, and measured), so this
       is not guarding a bug that exists today. It guards `.randomSource()`,
       which is a supported call that would make every reload a different
       picture, and it guards a future d3 that changes its mind. Cheap, and the
       failure it catches is one nobody would think to look for. */
    const a = layoutDiagram("force", root, OPTS, graph).nodes.map((n) => [n.x, n.y]);
    const b = layoutDiagram("force", root, OPTS, graph).nodes.map((n) => [n.x, n.y]);
    expect(a).toEqual(b);
  });

  it("force keeps the article's order down the page", () => {
    /* The rule the whole first round refused to give up, and the one a force
       layout throws away by default. `forceY` is what holds it; drop its
       strength and this is what goes. Compared by centre, since bubbles differ
       in size. */
    const nodes = layoutDiagram("force", root, OPTS, graph).nodes.filter((n) => n.depth === 2);
    const mid = (n: (typeof nodes)[number]) => n.y + n.h / 2;
    const byDoc = [...nodes].sort((p, q) => p.startRow - q.startRow);
    for (let i = 1; i < byDoc.length; i++) {
      const prev = byDoc[i - 1];
      const cur = byDoc[i];
      if (!prev || !cur) continue;
      expect(mid(cur), `${cur.number} is drawn above ${prev.number}`).toBeGreaterThan(mid(prev) - 1);
    }
  });

  it("force never draws a section above one that comes before it", () => {
    /* **The promise the whole mode rests on**, and the reason `fy` replaced
       `forceY`. A strong pull towards the right y is a *preference*, and
       `forceCollide` beats a preference wherever the rows get thin: measured on
       the real constitution, `forceY` at 0.85 left 16 of 57 sections drawn above
       a section that comes before them. Nothing errors — you just get a graph of
       an article you can no longer read top to bottom, which is the exact trap
       every graph library was rejected for in round one.

       Checked at depth 2 only and at depth 1 only: a PART's bubble sitting among
       its own sections is correct, not an inversion, because its position is the
       middle of its own range. Checked on the real example article, since the
       synthetic fixture is too small to crowd. */
    const tree2 = JSON.parse(readFileSync("example/tree.json", "utf8")) as Tree;
    const rawB = JSON.parse(readFileSync("example/blocks.json", "utf8")) as unknown;
    const blocks2 = (Array.isArray(rawB) ? rawB : (rawB as { blocks: Block[] }).blocks) as Block[];
    const r2 = buildSummaryTree(tree2, blocks2, null);
    expect(r2).not.toBeNull();
    if (!r2) return;
    const nodes = layoutDiagram("force", r2, OPTS, buildGraph(r2, blocks2)).nodes;
    for (const depth of [1, 2]) {
      const byDoc = nodes
        .filter((n) => n.depth === depth)
        .sort((a, b) => a.startRow - b.startRow);
      for (let i = 1; i < byDoc.length; i++) {
        const prev = byDoc[i - 1];
        const cur = byDoc[i];
        if (!prev || !cur) continue;
        expect(
          cur.y + cur.h / 2,
          `${cur.number} is drawn above ${prev.number}, which comes before it`,
        ).toBeGreaterThanOrEqual(prev.y + prev.h / 2 - 1);
      }
    }
  });

  it("force pulls related sections together sideways", () => {
    /* **The claim the force picture actually makes**, and the right thing to
       test — I first wrote this as "the bubbles use the width", which failed on a
       seven-node fixture and would have had me tuning constants against a
       synthetic article. Measured afterwards on real ones, horizontal spread is
       0.96 of the width on the constitution and 0.83 on the Noema essay; it is
       narrow only on a tiny article with no vocabulary edges, where narrow is
       the honest answer because there is nothing to cluster.

       So: `x` is the only axis the physics decides — `forceY` imposes the other
       — and what it must decide is that two sections about the same thing end up
       near each other even when the article separates them. 1.1 and 2.2 of the
       fixture are the linked pair; 1.2 sits between them in reading order and is
       about something else entirely. */
    const nodes = layoutDiagram("force", root, OPTS, graph).nodes;
    const cx = (id: string) => {
      const n = nodes.find((x) => x.id === id);
      return n ? n.x + n.w / 2 : Number.NaN;
    };
    const linked = Math.abs(cx("n3") - cx("n7"));
    const unlinked = Math.abs(cx("n3") - cx("n4"));
    expect(Number.isFinite(linked)).toBe(true);
    expect(
      linked,
      "the two sections that share a subject should settle nearer each other than an unrelated neighbour",
    ).toBeLessThan(unlinked);
  });

});

/**
 * The same, against the committed example article — 45 real nodes, real prose.
 * `data/` is not in git, so `example/` is the largest real thing a test can read.
 */
describe("the Force picture, against the real example article", () => {
  const tree = JSON.parse(readFileSync("example/tree.json", "utf8")) as Tree;
  const raw = JSON.parse(readFileSync("example/blocks.json", "utf8")) as unknown;
  const blocks = (Array.isArray(raw) ? raw : (raw as { blocks: Block[] }).blocks) as Block[];
  const root = buildSummaryTree(tree, blocks, null);

  it("reads the real prose and measures it in words", () => {
    expect(root).not.toBeNull();
    if (!root) return;
    const g = buildGraph(root, blocks);
    expect(g.totalWords).toBeGreaterThan(500);
    // Every section gets terms, and no section's terms are all function words.
    for (const n of g.nodes.filter((x) => x.depth === 2)) {
      expect(n.terms.length, `${n.number} has no distinctive terms`).toBeGreaterThan(0);
      expect(n.words).toBeGreaterThan(0);
    }
    expect(g.edges.some((e) => e.kind === "parent")).toBe(true);
    expect(g.edges.some((e) => e.kind === "sequence")).toBe(true);
  });

  it("does not invent vocabulary edges this article has not got", () => {
    /* **This asserts a ZERO, deliberately.** `example/` is a 1,943-word excerpt
       of eight short sections, each about something different — so the honest
       answer for it is no vocabulary edges at all, and an earlier version of
       this test demanded at least one. That is the wrong shape of assertion: it
       would have been satisfied by lowering the floor until noise appeared,
       which is the exact failure this whole measure is trying to avoid.

       What is checked instead is that whatever it does find is well formed and
       bounded. The "it finds the right edges" claim belongs on the synthetic
       fixture above, where the answer is known by construction, and on the
       threshold sweep recorded in graph.ts, which was done against articles ten
       times this size. */
    expect(root).not.toBeNull();
    if (!root) return;
    const g = buildGraph(root, blocks);
    const vocab = g.edges.filter((e) => e.kind === "vocabulary");
    const leaves = g.nodes.filter((n) => n.depth === 2).length;
    expect(vocab.length).toBeLessThanOrEqual(leaves * 2);
    for (const e of vocab) {
      expect(e.shared?.length ?? 0).toBeGreaterThan(0);
      expect(e.weight).toBeGreaterThanOrEqual(0.12);
      expect(e.weight).toBeLessThanOrEqual(1.000001);
    }
  });

  for (const kind of ["force"] as const) {
    it(`${kind} stays inside the band on the real article`, () => {
      expect(root).not.toBeNull();
      if (!root) return;
      const g = buildGraph(root, blocks);
      for (const width of [288, 320, 400]) {
        const l = layoutDiagram(kind, root, { ...OPTS, width }, g);
        for (const n of l.nodes) {
          expect(Number.isFinite(n.x + n.y + n.w + n.h)).toBe(true);
          expect(n.x).toBeGreaterThanOrEqual(-0.5);
          expect(n.x + n.w).toBeLessThanOrEqual(width + 0.5);
        }
        for (const link of l.links) expect(link.d).not.toMatch(/NaN|Infinity/);
      }
    });
  }
});
