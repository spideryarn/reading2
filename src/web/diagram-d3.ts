/**
 * **The Force picture**, and what installing D3 actually bought.
 *
 * Greg, 2026-08-27: *"Ok, let's also try some D3 ones. Try a bunch, e.g.
 * force-weighted graphs, creating a richer data structure to lay things out."*
 *
 * The first round surveyed the field and installed nothing — the reasoning is
 * in docs/plans/260826ah-diagram-mode.md. That conclusion was
 * about the *data*, and it is worth restating rather than quietly reversing:
 * with only the tree to draw, `d3-hierarchy.tree()` and `partition()` were the
 * two functions worth having and both were wrong for a 288px band. What changed
 * is not the verdict on those two functions. It is that [graph.ts](./graph.ts)
 * now produces something a tree layout could not have used — weighted edges
 * between sections that are not siblings — and **for a graph there is no
 * hand-rolled alternative worth writing.** Velocity Verlet with Barnes–Hut
 * approximation is a real algorithm, `d3-force` is a good implementation of it,
 * and re-deriving it here would be the actual mistake.
 *
 * So: `d3-force` earns its place outright. `d3-hierarchy` and `d3-shape` were
 * also installed, for the Arc and Cluster pictures — **both of which were cut
 * on 2026-08-27, and both packages went with them.** The verdict on
 * `d3-hierarchy` therefore ends where the first round left it: it was here to
 * be *compared against* the hand-rolled tree, the comparison was run, and the
 * hand-rolled tree won.
 *
 * ## Determinism, which a force layout does not have for free
 *
 * `forceSimulation` is a stateful animation. Left alone it would tick on a timer
 * and settle differently every mount, which in this app is unacceptable twice
 * over: the picture must be the same on reload for the same reason `?diagram=`
 * is in the URL at all (docs/project/url-state.md), and a layout that cannot be
 * reproduced cannot be tested.
 *
 * **d3-force v3 is already deterministic, and that is worth knowing rather than
 * assuming either way.** The `jiggle` that separates two coincident nodes does
 * not call `Math.random()` — since v2 the simulation carries its own linear
 * congruential generator, seeded to 1 and re-seeded whenever a force is
 * initialised (`node_modules/d3-force/src/lcg.js`). Measured here, 2026-08-27:
 * a simulation of eight nodes all placed at the same point makes **zero** calls
 * to `Math.random` and settles identically twice. An earlier draft of this
 * comment claimed the opposite and was wrong.
 *
 * So the two things done here are not what makes it reproducible — they are what
 * makes it *usable*:
 *
 *  - **It is stopped and ticked by hand**, `TICKS` times, inside a pure
 *    function. No timer, no animation, no React state that changes after the
 *    first paint. This is what lets the layout live in a `useMemo` beside the
 *    other five, rather than being the one picture that arrives late.
 *  - **Every node is given a starting position, from the article.** Left
 *    undefined, d3-force places nodes on a phyllotaxis spiral: reproducible, but
 *    centred on nothing, so the simulation spends its early ticks undoing an
 *    arrangement that meant nothing. Starting from where each section actually
 *    sits means the settled picture is the article rearranged rather than a
 *    spiral rearranged, and it converges in far fewer ticks.
 *
 * The determinism test in tests/diagram-graph.test.ts stays regardless. It is
 * cheap, and it is the thing that would catch someone reaching for
 * `.randomSource(Math.random)` — which is a supported call, and would make every
 * reload a different picture.
 *
 * ## Down is still later in the article
 *
 * The one rule the first round would not give up, and a force layout is exactly
 * the thing that throws it away — Luna's warning was that these libraries
 * *"intentionally optimize for relational structure, not stable document
 * order"*. So the simulation is not free in y: `forceY` pulls every node hard
 * towards where it belongs in the article, and only x is really solved for. What
 * the physics is allowed to decide is *sideways* — which sections cluster with
 * which — while the reading order stays legible top to bottom. That is a
 * constrained force layout, and it is the only kind that belongs in this band.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import {
  charsThatFit,
  type DiagramLayout,
  type DiagramNode,
  type DiagramLink,
  type DiagramOptions,
  type LinkKind,
  LABEL_PX,
  wrapText,
} from "./diagram.js";
import type { ArticleGraph, GraphNode } from "./graph.js";

/**
 * How many ticks to run.
 *
 * 300 is d3's own default lifetime (`alphaMin` 0.001 at `alphaDecay` 0.0228
 * reaches it in about 300), so this is "run the simulation to completion",
 * spelled as a number because we are driving it.
 *
 * **It is not free, and an earlier version of this comment said it was.**
 * Measured by GPT Sol, 2026-08-27: about 39ms at 60 sections and 113ms at 150,
 * on top of 25ms and 100ms to build the graph. That is a visible hitch on a long
 * article, not the "under a millisecond" this claimed. It still belongs in a
 * `useMemo` — moving it to state would trade a hitch for a flash of empty
 * picture — but the honest description is "one slow frame when you press Force",
 * and the pair loop in graph.ts is the half worth attacking first.
 */
const TICKS = 300;

/**
 * The least vertical room each node gets before the picture starts to scroll.
 *
 * With `fy` pinning the vertical axis (see `layoutForce`), reading order is
 * guaranteed at any density — so what this buys is not correctness but **room
 * for `forceCollide` to work in**. Bubbles can only separate sideways now, and a
 * band is only 340px wide, so if the rows are thinner than a bubble the picture
 * is a column of overlapping circles.
 *
 * Swept against four real articles, 2026-08-27, counting overlapping pairs:
 *
 * | row | constitution (57) | noema (26) | phrenology (49) | height of the longest |
 * |---|---|---|---|---|
 * | 16 | 3 | 0 | 45 | 912px |
 * | 24 | 0 | 0 | 21 | 1368px |
 * | **32** | **0** | **0** | **15** | **1824px** |
 * | 40 | 0 | 0 | 3 | 2280px |
 *
 * 32 is where two of the three go clean and the longest picture is about three
 * viewports — past that the scroll costs more than the last few overlaps are
 * worth. The phrenology column is the honest residual: a scanned Victorian
 * pamphlet whose sections run from two words to eight hundred, so a dozen
 * bubbles genuinely belong at nearly the same height and 340px is not enough
 * room to put them side by side. `arc` is the picture for that article.
 */
const MIN_ROW_FOR_FORCE = 32;

/**
 * A node inside the simulation. Exported for `arrowPath`, which is exported so
 * its geometry can be tested against overlapping and coincident circles
 * directly — the cases a whole-layout test can only reach by accident, and
 * which a force simulation is under no obligation to produce.
 */
export interface Sim extends SimulationNodeDatum {
  n: GraphNode;
  r: number;
}

/**
 * A link that carries the edge it came from.
 *
 * Declared rather than cast: `forceLink` rewrites `source` and `target` in place
 * from ids to node objects, so the datum is genuinely a different shape before
 * and after — and reaching for `as` at each callback is how you end up reading a
 * field that the rewrite moved.
 */
export interface SimLink extends SimulationLinkDatum<Sim> {
  source: Sim;
  target: Sim;
  e: ArticleGraph["edges"][number];
}

/** A node's radius: area proportional to words, so a section twice as long looks twice as big. */
function radius(words: number, maxWords: number): number {
  const t = maxWords > 0 ? words / maxWords : 0;
  return 4 + Math.sqrt(t) * 13;
}

/**
 * **Force** — the article's sections as a weighted graph, settled by physics,
 * with the vertical axis held to reading order.
 *
 * What it shows that the trees cannot: two sections that talk about the same
 * things pull together even when they are in different parts. A piece whose
 * argument keeps returning to one idea looks different here from one that moves
 * through its topics and never comes back, and neither the table of contents nor
 * any of the three tree pictures can show you that.
 */
export function layoutForce(graph: ArticleGraph, opts: DiagramOptions): DiagramLayout {
  const drawn = graph.nodes.filter((n) => n.depth > 0);
  if (drawn.length === 0) {
    return { width: opts.width, height: Math.max(opts.height, 420), nodes: [], links: [], axis: null, nowY: null };
  }
  /* **The height has to follow the node count, not the viewport.** With sixty
     nodes a viewport-height picture is comfortable; GPT Sol's 150-leaf probe
     found 182 overlapping bubbles and 34 places where the physics had pushed a
     later section above an earlier one — because `forceY` cannot hold an order
     it has no room to hold, and `forceCollide` wins when the rows it is given
     are thinner than the circles. Giving each node a minimum vertical share
     makes the picture scroll instead, which is the bargain every picture in
     this band eventually makes: a map you scroll is worse than one you do not,
     and a map with unclickable parts is broken.
     Sol confirmed 5 and 60 leaves were geometrically fine; this is about
     density, not about the forces. */
  const height = Math.max(opts.height, 420, drawn.length * MIN_ROW_FOR_FORCE);
  const maxWords = Math.max(1, ...drawn.map((n) => n.words));
  const rows = Math.max(1, graph.wordsBefore.length - 1);
  const pad = 26;

  /** Where a node belongs vertically: its middle, in words rather than rows. */
  const homeY = (n: GraphNode) => {
    const a = graph.wordsBefore[n.startRow] ?? 0;
    const b = graph.wordsBefore[Math.min(n.endRow + 1, rows)] ?? a;
    const mid = graph.totalWords > 0 ? (a + b) / 2 / graph.totalWords : 0;
    return pad + mid * (height - pad * 2);
  };

  const sims: Sim[] = drawn.map((n) => ({
    n,
    r: radius(n.words, maxWords),
    // Started from the article rather than from d3's phyllotaxis spiral — see
    // the file header. The x offset is a stable function of the node's own
    // position, so the starting spread means something and no two nodes begin
    // exactly on top of one another.
    x: opts.width / 2 + ((n.startRow % 7) - 3) * (opts.width / 26),
    y: homeY(n),
    /* **`fy`, not a force.** `forceY` was a strong *preference* for reading
       order, and a preference is not a guarantee: measured on the real
       constitution it left **16 of 57 sections drawn above a section that comes
       before them**, because `forceCollide` wins wherever the rows get thin.
       An out-of-order node is not a cosmetic flaw here — down-the-page-is-later
       is the one property that separates this from every graph library the
       first round rejected.
       `fy` pins the axis outright, so the simulation solves for x alone and
       collision is resolved sideways, where there is room. It is also what makes
       the claim in this file's header literally true rather than nearly true. */
    fy: homeY(n),
  }));
  const index = new Map(sims.map((s) => [s.n.id, s]));

  const links: SimLink[] = graph.edges
    .filter((e) => index.has(e.source) && index.has(e.target))
    .map((e) => ({
      source: index.get(e.source) as Sim,
      target: index.get(e.target) as Sim,
      e,
    }));

  const sim = forceSimulation(sims)
    .force(
      "link",
      forceLink<Sim, SimLink>(links)
        // A parent edge is structure and should hold tight; a vocabulary edge is
        // a hint and should only lean. Distance scales the other way from
        // strength on purpose — related sections sit closer AND pull harder.
        .distance((l) => DISTANCE[l.e.kind])
        .strength(strengthOf),
    )
    /* Charge and centring were both too timid in the first version: measured in
       a browser on a 323px picture, every bubble sat between x=141 and x=188 —
       a 47px ribbon down the middle of a column three times that wide. Since x
       is the ONLY axis the physics is allowed to decide, a picture that does not
       use it is a picture that has nothing to say. Repulsion up, pull to centre
       down. */
    .force("charge", forceManyBody<Sim>().strength((d) => -70 - d.r * 9))
    .force("collide", forceCollide<Sim>((d) => d.r + 2.5).strength(0.9))
    .force("x", forceX<Sim>(opts.width / 2).strength(0.022))
    /* No `forceY`. The y axis is not solved for at all — every node carries `fy`
       (see above), so d3 rewrites `y` from it on every tick and a force pulling
       towards the same value would be doing nothing but arithmetic. */
    .stop();
  for (let i = 0; i < TICKS; i++) sim.tick();

  /* **Clamp once, then use the clamped value everywhere.** The first version
     clamped inside the node loop and left the links reading `s.x`/`s.y` — so on
     a crowded picture a bubble sat at the edge while its connector carried on to
     where the simulation had put it, off the side of the band. 129 of them, in
     Sol's 150-leaf probe. Writing the clamp back onto the datum means there is
     only one position and nothing can read the other one. */
  for (const s of sims) {
    s.x = Math.min(opts.width - s.r - 1, Math.max(s.r + 1, s.x ?? opts.width / 2));
    // y is pinned by `fy`, so this only keeps the first and last bubbles from
    // hanging over the ends of the picture.
    s.y = Math.min(height - s.r - 1, Math.max(s.r + 1, s.y ?? 0));
  }

  const out: DiagramNode[] = sims.map((s) => {
    const r = s.r;
    const cx = s.x ?? opts.width / 2;
    const cy = s.y ?? 0;
    return {
      id: s.n.id,
      blockId: s.n.blockId,
      depth: s.n.depth,
      number: s.n.number,
      title: s.n.title,
      ...(s.n.gist !== undefined && { gist: s.n.gist }),
      blocks: s.n.blocks,
      startRow: s.n.startRow,
      endRow: s.n.endRow,
      part: s.n.part,
      x: cx - r,
      y: cy - r,
      w: r * 2,
      h: r * 2,
      labelX: cx,
      labelY: cy + 3.5,
      anchor: "middle",
      /* Only the number goes inside the bubble. A title would need a bubble the
         width of a title, and then the picture is a stack of boxes rather than a
         graph — the full name is a hover away in the footer card, which is the
         same bargain every small target in this band makes. */
      lines: r >= 9 ? wrapText(s.n.number, charsThatFit(r * 1.9, LABEL_PX.force?.[s.n.depth] ?? 10), 1) : [],
      titleLines: 1,
      hasChildren: false,
      collapsed: false,
    };
  });

  /* **Paint order, which is not the order the edges were built in.**
     The two sparse kinds go last. An anchor edge is the only line in this
     picture that somebody *meant*, and there are usually fewer than five of
     them in a whole article; a semantic edge is the only one that cost money.
     Either of them drawn underneath the thick sequence chain is the same as not
     drawn at all, and would look like the feature had failed rather than like
     the paint order was wrong. */
  const ORDER: Record<string, number> = { parent: 0, sequence: 1, vocabulary: 2, anchor: 3, semantic: 4 };
  const drawnLinks: DiagramLink[] = links
    .slice()
    .sort((a, b) => (ORDER[a.e.kind] ?? 0) - (ORDER[b.e.kind] ?? 0))
    /* **A branch rather than a conditional spread, because `DiagramLink` is a
       union on `kind` now.** The spread form — one object literal with
       `kind: l.e.kind` and `...(kind === "sequence" ? { from, to } : {})` —
       cannot be checked against it: TypeScript sees a `kind` of all five
       literals beside an optional `from`, which is exactly the half-formed
       chain link the union exists to forbid. Narrowing first and returning one
       shape or the other is what makes the endpoints a fact about the kind
       instead of a hopeful pair of optional fields. */
    .map((l, i): DiagramLink => {
      const base = {
        id: `f${i}-${l.e.source}-${l.e.target}`,
        part: l.e.kind === "vocabulary" || l.e.kind === "semantic" ? -1 : (l.source.n.part ?? -1),
        /* Kept honest rather than kept as a kind: this really is the depth of
           the node the line hangs off. The stylesheet now reads `kind`. */
        depth: l.source.n.depth,
      };
      /* Endpoints only on the chain, because `chainNearness` (diagram.ts) is
         the only reader of them and it walks the chain. Emitting them on all
         five kinds would invite the vocabulary mesh into that walk, where every
         node is a hop from every other and the ramp would come out flat. */
      if (l.e.kind === "sequence") {
        return {
          ...base,
          d: arrowPath(l.source, l.target),
          kind: "sequence",
          arrow: true,
          from: l.source.n.id,
          to: l.target.n.id,
        };
      }
      return { ...base, d: straight(l.source, l.target), kind: l.e.kind };
    });

  return { width: opts.width, height, nodes: out, links: drawnLinks, axis: null, nowY: null };
}

/**
 * How far apart the link force would like each kind of pair to sit.
 *
 * Exhaustive over `LinkKind` — a `Record` rather than a chain of `if`s, so
 * adding a sixth kind is a compile error here rather than a sixth kind silently
 * inheriting whatever the last `return` happened to be. That is exactly how the
 * first draft of this change went wrong; see `strengthOf`.
 */
const DISTANCE: Record<LinkKind, number> = {
  parent: 26,
  sequence: 54,
  // Shorter than the two measured kinds: the author put these two sections next
  // to each other in their head, so the picture may as well.
  anchor: 44,
  vocabulary: 54,
  semantic: 54,
};

/**
 * How hard each kind pulls — and the one number here that is a bug fix rather
 * than a taste.
 *
 * **The two similarity measures are not on the same scale, and nothing says so
 * anywhere else.** A tf-idf cosine between two sections of one article runs
 * about 0.12 to 0.5, because the vectors are sparse and share few terms. An
 * *embedding* cosine between any two passages of the same article runs about
 * 0.6 to 0.9 — everything is somewhat like everything, and the corpus mean was
 * measured at ~0.18 for the models that survived the eval and 0.39 for the one
 * that did not (evals/results/embedding-retrieval-2026-08-26.md).
 *
 * So the obvious thing — let `semantic` fall through to the vocabulary formula,
 * since both are "how alike are these" — is wrong, and wrong in the direction
 * that ruins the experiment. `0.12 + 0.85 × 0.5` is 0.55: as strong as
 * containment. Ten semantic edges at that strength would not *add* to the
 * picture's shape, they would *become* it, and the answer to "what do
 * embeddings do to the shape" would be an artefact of a fallthrough. That is
 * what the first draft of this file did. GPT Sol caught it in review before it
 * ran, 2026-08-27.
 *
 * `semantic` is therefore given its own rule, rescaled from the range it
 * actually occupies, and deliberately kept at or below the vocabulary edges it
 * is being compared against: this picture is meant to *show* the difference
 * between the two measures, and it cannot do that if one of them is also
 * setting the stage the other is judged on.
 */
export function strengthOf(l: SimLink): number {
  switch (l.e.kind) {
    case "parent":
      return 0.55;
    /* **A thick line is a rendering decision, not a physical one.** The
       sequence chain is now drawn as the boldest thing in the picture (Greg,
       2026-08-27), and the tempting next move is to make it pull as hard as it
       looks. It must not: every node is pinned in y, so a strong sequence force
       can only act sideways, and what it would do there is drag the whole
       picture back into a column — undoing the one axis this layout is allowed
       to solve for. */
    case "sequence":
      return 0.08;
    /* A fact about the document rather than a guess, so it pulls harder than
       either measured kind — but not as hard as containment, because an author
       linking two sections does not make them one section.
       **0.42 rather than 0.35, and a test moved it.** The comment above said
       "harder than either measured kind" while the number did not: a vocabulary
       edge at cosine 0.5 — which is about as high as tf-idf goes between two
       sections of one article — comes out at 0.37 and quietly out-pulled this.
       0.42 clears the whole of that range. */
    case "anchor":
      return 0.42;
    case "vocabulary":
      return 0.12 + l.e.weight * 0.5;
    case "semantic":
      /* 0.6 → 0, 0.9 → 0.30. Below 0.6 an embedding cosine is not saying
         anything about one article's own passages, and the floor at 0 means
         such an edge is drawn without being allowed to move anything. */
      return Math.max(0, Math.min(0.3, (l.e.weight - 0.6) * 1.0));
  }
}

/** Centre to centre. Every kind but `sequence` draws this. */
function straight(a: Sim, b: Sim): string {
  return `M ${a.x ?? 0} ${a.y ?? 0} L ${b.x ?? 0} ${b.y ?? 0}`;
}

/**
 * Room left for the arrowhead beyond the target circle's edge, in px.
 *
 * The marker is 6px long and `orient="auto"`, so its tip lands here and its
 * tail sits back along the line. 5 puts the tip just clear of the target's
 * stroke rather than touching it, which reads as an arrow arriving rather than
 * as one embedded in the bubble.
 */
const HEAD_GAP = 5;

/**
 * A sequence line, shortened at both ends so the arrowhead is visible.
 *
 * **This is the one piece of arithmetic in the change that can silently look
 * fine.** `marker-end` puts the arrowhead at the path's last point, and a line
 * drawn centre-to-centre ends *inside* the target bubble — where the arrowhead
 * is painted underneath a filled circle and simply is not there. Nothing errors,
 * the line still draws, and the feature reads as "the arrows did not work".
 *
 * So both ends are pulled back to the circles' edges: `r + 1` at the tail so the
 * line starts just outside the source, `r + HEAD_GAP` at the head so the tip
 * lands just outside the target.
 *
 * **When the two bubbles overlap** — which `forceCollide` allows at the density
 * where rows get thin — the two trims together exceed the distance between the
 * centres, and the naive version of this returns a line pointing *backwards*: a
 * short arrow aimed up the article, which is exactly the falsehood the arrow was
 * added to prevent. There is no honest short line to draw between two circles
 * that are inside each other, so nothing is drawn at all (`M 0 0` with zero
 * length paints nothing and takes no marker).
 */
export function arrowPath(a: Sim, b: Sim): string {
  const ax = a.x ?? 0;
  const ay = a.y ?? 0;
  const bx = b.x ?? 0;
  const by = b.y ?? 0;
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  const trimA = a.r + 1;
  const trimB = b.r + HEAD_GAP;
  // Overlapping, or coincident. See the note above: a backwards arrow is worse
  // than a missing one.
  if (dist <= trimA + trimB) return "M 0 0";
  const ux = dx / dist;
  const uy = dy / dist;
  return `M ${ax + ux * trimA} ${ay + uy * trimA} L ${bx - ux * trimB} ${by - uy * trimB}`;
}
