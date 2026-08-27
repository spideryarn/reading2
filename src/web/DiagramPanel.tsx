/**
 * The Diagram panel — a **mode**, in the band between the spine and the prose.
 *
 * ```
 *  ┌── spine ──┬────── DIAGRAM (this panel) ──────┬──── the article ────┐
 *  │           │  DIAGRAM   strata · tree · map   │                     │
 *  │  ▇▇▇▇▇▇▇  │ ──────────────────────────────── │  Being You opens    │
 *  │  ▇▇▇▇     │ ▐ ▌█ 1  Waking up                │  with a story about │
 *  │  ▇▇▇      │ ▐ ▌█                             │  waking from        │
 *  │  ▇▇▇▇▇▇   │ ▐ ▌█ 1.1 The body as a model     │  anaesthesia…       │
 *  │  ▇▇       │ ▐▶▌█ ◀── you are here            │                     │
 *  │  ▇▇▇▇     │ ▐ ▌█ 2  The hard problem         │  Every paragraph    │
 *  │  ▇▇▇      │ ▐ ▌█                             │  stays where it was.│
 *  │           │ ──────────────────────────────── │                     │
 *  │           │  1.1 The body as a model   6 ¶   │  Clicking a band    │
 *  │           │  Perception is a controlled…     │  scrolls it here.   │
 *  └───────────┴──────────────────────────────────┴─────────────────────┘
 * ```
 *
 * The geometry is not in this file. Every number is computed by pure functions
 * in [diagram.ts](./diagram.ts), which is also where the survey of the twenty
 * libraries we did not install is written down. This file is the shell, the
 * interaction and the paint.
 *
 * ## Three things it does that a picture of a tree does not have to
 *
 * **It says where you are.** The node the reader is standing in is marked, and
 * on `strata` — the one picture whose vertical axis really is the article — a
 * line is drawn across at the exact row. That is the whole reason this is a
 * mode inside the reading view rather than an export.
 *
 * **It is clickable all the way down.** Every node is a real focusable element
 * with a name, and Enter jumps the article to it — the same `onJump` a gist
 * cell, a spine segment and an arrow key already use. Nothing here is a picture
 * of a link; they are links.
 *
 * **It never leaves a label only truncated.** SVG will not wrap text and will
 * not clip it either, so labels are cut to fit (diagram.ts § wrapText). The
 * footer card under the picture always holds the full title, the gist and the
 * paragraph count for whatever the pointer or the keyboard is on, so the cut is
 * a rendering decision rather than a loss of information.
 *
 * ## The footer card, rather than a floating tooltip
 *
 * This panel has hover targets 6px tall. A floating card over a 6px band covers
 * its neighbours, and the neighbours are the thing you are comparing it against
 * — which is the entire point of a picture that is to scale. So the detail goes
 * in a fixed strip at the bottom, where it cannot cover anything and where the
 * reader's eye does not have to chase it. That is the one place this deliberately
 * differs from the spine, whose bands have the same problem and solved it with a
 * hover card (docs/project/tooltips.md); the spine is 1.5rem wide and has nowhere
 * to put a strip.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChartScatter,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Network,
  Route,
  Share2,
  Signal,
  Spline,
  Waypoints,
} from "lucide-react";
import type { Block, BlockId, NodeId } from "../types.js";
import {
  DIAGRAMS,
  type DiagramKind,
  LINE_STEP,
  type DiagramLayout,
  type DiagramNode,
  type LinkKind,
  nodeAt,
} from "./diagram.js";
import { layoutDiagram } from "./diagrams.js";
import { type ArticleGraph, buildGraph, wordsBefore } from "./graph.js";
import { useSimilar } from "./useSimilar.js";
import { type UseProjection, useProjection } from "./useProjection.js";
import { RAMP_STEPS, laneTerms, type ScatterAxis, type ScatterHue } from "./scatter.js";
import type { SummaryNode } from "./tree.js";
import { useRenderCount } from "./perf.js";

interface Props {
  /**
   * Which article. Used for exactly one thing — asking the server for the
   * embedding model's view of it (`useSimilar`), which only the Force picture
   * wants. Everything else this panel draws comes from `root` and `blocks`.
   */
  slug: string;
  /** The tree, numbered and joined to block ranges. Null if the tree is unusable. */
  root: SummaryNode | null;
  kind: DiagramKind;
  onKind(kind: DiagramKind): void;
  /** Where the reader is, as a row index into the article's blocks. */
  atRow: number | null;
  /** Jump the article to a block, exactly as a gist cell does. */
  onJump(id: BlockId): void;
  /**
   * Every block of the article, in order — what the graph pictures are built
   * from (src/web/graph.ts), and what lets `strata` be to scale in words.
   *
   * The whole array rather than a derived summary, because the graph needs the
   * prose to count terms over and the word counts are already on it. It is the
   * same array `Reader` already holds, so this costs a reference.
   */
  blocks: readonly Block[];
  /** What sideways means on Drift. `?dx=` — see params.ts § diagramAxisParam. */
  axis: ScatterAxis;
  onAxis(axis: ScatterAxis): void;
  /** What a dot's colour means on both scatters. `?dhue=`. */
  hue: ScatterHue;
  onHue(hue: ScatterHue): void;
}

/** What each picture is called where the reader meets it, and what it promises. */
const KIND_UI: Record<DiagramKind, { label: string; icon: typeof Signal; blurb: string }> = {
  strata: {
    label: "Strata",
    icon: Signal,
    blurb: "To scale — how tall a section is here is how much of the article it is",
  },
  tree: {
    label: "Tree",
    icon: Network,
    blurb: "The outline as a branching tree, every name legible, sizes not to scale",
  },
  mindmap: {
    label: "Mindmap",
    icon: Share2,
    blurb: "A trunk down the middle with the parts hanging off it, still in reading order",
  },
  /* The three below draw the GRAPH, not the tree — sections joined by the words
     they share as well as by where they sit (src/web/graph.ts). Their blurbs say
     what each one is *for*, because unlike the first three they are not showing
     the reader something they could have worked out from the contents page. */
  arc: {
    label: "Arc",
    icon: Spline,
    blurb:
      "Every section on one line in reading order, with an arc wherever two of them are about the same things — a long arc is the piece doubling back",
  },
  force: {
    label: "Force",
    icon: Waypoints,
    blurb:
      "The same relationships settled by physics: sections that share vocabulary pull together, while down the page stays reading order",
  },
  cluster: {
    label: "Cluster",
    icon: GitBranch,
    blurb: "The tidy dendrogram d3-hierarchy draws — every section at the same depth, evenly spaced",
  },
  /* The last two draw neither the tree nor the graph: one dot per PARAGRAPH,
     placed by what the paragraph is about (src/web/scatter.ts). They are the
     only two pictures here whose axes came out of a model. */
  drift: {
    label: "Drift",
    icon: ChartScatter,
    blurb:
      "One dot per paragraph: down the page is still the article, sideways is what it is talking about — so a subject the piece returns to is a second cluster far below the first",
  },
  trail: {
    label: "Trail",
    icon: Route,
    blurb:
      "The same dots with both axes spent on meaning, joined in reading order — so you can see whether the piece travels through its subject or circles back over it",
  },
};

/** The three that need the graph rather than the tree. */
/**
 * The pictures that draw a you-are-here line, and therefore the only ones for
 * which the reader's position is an input to layout.
 *
 * **This said `["strata"]` and that was wrong**, which is worth leaving in the
 * file because of how the mistake was made: `atRow` was grepped for in
 * diagram.ts and diagram-d3.ts, both of which really do ignore it everywhere
 * but `layoutStrata`, and scatter.ts — where `drift` draws its position line
 * (scatter.ts:430) and `trail` brightens the chain around the reader
 * (scatter.ts:556) — was simply not one of the files looked at. A grep over the
 * wrong set of files reads exactly like a grep that found everything.
 *
 * The failure it would have shipped is the quiet kind: two pictures whose
 * you-are-here line silently stops following you. Nothing throws, nothing
 * looks broken in a screenshot, and `tests/scatter.test.ts` — which does cover
 * both behaviours — passes, because the layout functions were never the thing
 * that changed. Caught by a GPT Sol review of the built code, 2026-08-27.
 *
 * `drift` and `trail` also fall back to `layoutStrata` while their projection
 * is still loading (diagrams.ts:52-60), so they would have lost the line in the
 * fallback too.
 *
 * A set rather than an equality test because the next picture to grow a `nowY`
 * has to add itself here, and a `kind === "strata"` buried in a memo is not
 * somewhere anybody would think to look.
 */
const NEEDS_AT_ROW = new Set<DiagramKind>(["strata", "drift", "trail"]);

const NEEDS_GRAPH = new Set<DiagramKind>(["arc", "force", "cluster"]);

/**
 * The two that need the server's projection of the article, and are a **flat
 * list of paragraphs** rather than a tree.
 *
 * That second half is not a detail. The rest of this panel is a `role="tree"`
 * of `treeitem`s with levels, sibling counts and Left/Right meaning close and
 * open — a contract these two cannot honour, because 276 paragraphs are not a
 * hierarchy and there is nothing to open. So they get a listbox, Left/Right
 * mean the same as Up/Down, and no node claims a level. GPT Sol's finding,
 * 2026-08-27: inheriting the tree contract would have been a role describing a
 * widget the code does not implement, which is the same mistake this panel
 * already made once with one tab stop per node.
 */
const NEEDS_POINTS = new Set<DiagramKind>(["drift", "trail"]);

/**
 * One row of the footer card's evidence list.
 *
 * `kind` is here because the three kinds of relationship do not have the same
 * *sort* of evidence, and rendering them the same way would flatten the ladder
 * graph.ts § EdgeKind sets out. A vocabulary edge shows the words that earned
 * it, an anchor edge shows the author's own link text, and a semantic edge
 * shows a number — because a number is honestly all it has.
 */
interface Related {
  kind: LinkKind;
  number: string;
  title: string;
  shared: string[];
  /** `anchor` only: the author's link text. */
  label?: string;
  /** `semantic` only: the cosine. */
  score?: number;
  /**
   * `semantic` only: the opening of one of the two passages that earned the
   * line.
   *
   * **The whole point of the round before this one was that evidence computed
   * and not shown is worse than none** — the vocabulary edges' shared terms
   * were in the data from the start and nothing displayed them, which made the
   * curves look more authoritative than they were. The passage ids were then
   * added to a semantic edge, documented as "so the card can name them", and
   * the card threw them away. Same mistake, one round later; GPT Sol found it
   * both times.
   */
  quote?: string;
}

/**
 * What the footer card says about the node it is describing: which other
 * sections it is joined to, and **what earned each line**.
 *
 * A function rather than an inline memo so it can be tested. That is not a
 * stylistic preference — the two findings this feature has had from GPT Sol,
 * one per round, were both *evidence computed and then not shown*: the
 * vocabulary edges' shared terms first, then the semantic edges' passage ids.
 * Both were live in code nothing could reach without rendering React, and both
 * survived a full test suite. The third time should be caught here.
 */
export function relatedFor(
  graph: ArticleGraph | null,
  shown: NodeId | null,
  blocks: readonly Block[],
): Related[] {
    if (!graph || !shown) return [];
    /* All three *earned* kinds, not just vocabulary. `parent` and `sequence`
       are already told by the picture — containment by the lines to the parent
       bubble, reading order by the vertical axis — so listing them here would
       be repeating what the reader can see. These three are the ones whose
       evidence is off-screen. */
    const kinds = new Set(["vocabulary", "anchor", "semantic"]);
    return graph.edges
      .filter((e) => kinds.has(e.kind) && (e.source === shown || e.target === shown))
      /* The author's own cross-reference first, whatever its weight — it is the
         only one of the three that is a fact rather than a measure, and a
         measured 0.4 outranking it would be the ladder in graph.ts § EdgeKind
         drawn upside down. */
      .sort((a, b) => rank(a.kind) - rank(b.kind) || b.weight - a.weight)
      .slice(0, 4)
      .map((e) => {
        const other = graph.byId.get(e.source === shown ? e.target : e.source);
        /* The passage at the *other* end — the one the reader is not standing
           in — since the card is already telling them about the section they
           are on. */
        const at = e.passages?.[e.source === shown ? 1 : 0];
        const text = at ? blocks.find((b) => b.id === at)?.text : undefined;
        return {
          kind: e.kind,
          number: other?.number ?? "",
          title: other?.title ?? "",
          shared: e.shared ?? [],
          ...(e.label ? { label: e.label } : {}),
          ...(e.kind === "semantic" ? { score: e.weight } : {}),
          ...(text ? { quote: text.slice(0, 90) } : {}),
        };
      });
}

/**
 * Sort order for the card's evidence list — the fact before the two measures.
 *
 * **The primary key, because `weight` is not comparable across kinds.** An
 * anchor's weight is a count of links; a vocabulary or semantic weight is a
 * cosine. Sorting the three by weight alone happens to give the same answer
 * today only because a count starts at 1 and a cosine cannot reach it.
 */
function rank(kind: LinkKind): number {
  return kind === "anchor" ? 0 : kind === "vocabulary" ? 1 : 2;
}

/**
 * Eight categorical hues, one per part, reused round the article.
 *
 * The same wheel the saved searches use (docs/project/colour-scales.md) rather
 * than a second one — a reader who has learnt that green is a search colour
 * should not have to learn that it is also part 3. What is different here is
 * that the hue is **positional**, so it carries no meaning beyond "these bands
 * belong to the same part", which is exactly what the eye needs to group a
 * column of sections without reading any of them.
 */
const PART_HUES = 8;

export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks, axis, onAxis, hue, onHue }: Props) {
  useRenderCount("DiagramPanel");
  /* Which nodes the reader has closed. Deliberately NOT in the URL: `?cols=`
     and `?rung=` are about how much of the article you are looking at, and a
     link carrying them tells the recipient something. A set of node ids tells
     them nothing — node ids are positional and a re-run of `npm run toc`
     renumbers them (src/web/tree.ts), so a pasted link would open the wrong
     sections on an article that had been re-ingested. That is the same rule
     block-ids.md states for ranges, applied to a control. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<NodeId>>(() => new Set());
  /**
   * What the *pointer* is on. Cleared when it leaves the picture.
   *
   * Held apart from the keyboard's focus below, because the two answer different
   * questions and one variable made the card lie both ways: leaving the picture
   * with the pointer cleared it while a node was still genuinely focused, and
   * tabbing away never cleared it at all, so the card kept describing a node
   * nothing was on. Found by GPT Sol, 2026-08-26.
   */
  const [hover, setHover] = useState<NodeId | null>(null);
  /**
   * Which node the keyboard is on — **the roving tabstop**, and it exists
   * whether or not the picture has focus.
   *
   * A `role="tree"` promises the reader one tab stop and arrow keys inside it
   * (W3C APG, Tree View). Every node being a tab stop is the version this had
   * first, and on a forty-section article that is forty presses of Tab to get
   * past the panel — a role that describes a widget the code does not implement.
   */
  const [roving, setRoving] = useState<NodeId | null>(null);
  /** Whether focus is genuinely inside the picture, so the card can say so. */
  const [hasFocus, setHasFocus] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  /* **The picture is laid out against a measured box, not a computed one.**
     The band's width is decided by `fitMode` in layout.ts and could be threaded
     down — but its *inner* width is that minus padding and minus whatever the
     scrollbar takes, and a scrollbar appearing is itself a consequence of the
     height we choose. Measuring the element closes that loop; arithmetic
     reopens it, and gets it wrong by 15px on the platforms with a classic
     scrollbar.

     `null` until the first measure, which is one frame with an empty box —
     see the `diag-measuring` branch for why that is the cheaper mistake. */
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;

    /**
     * The scroller's inner width and height.
     *
     * **`clientWidth` is the PADDING box, not the content box** — it excludes
     * the border and the scrollbar and *includes* the padding (CSSOM View §
     * clientWidth). This scroller has horizontal padding, so taking
     * `clientWidth` as the picture's width makes every picture exactly the
     * padding wider than the room it has, and `overflow-x: hidden` then quietly
     * eats the right-hand edge — the tree's paragraph count first, since it is
     * drawn at `w - 6`. Subtracting the *computed* padding rather than the
     * literal `0.5rem` means changing the stylesheet cannot reintroduce it.
     */
    const measure = () => {
      const cs = getComputedStyle(el);
      const pad = Number.parseFloat(cs.paddingLeft) + Number.parseFloat(cs.paddingRight);
      return {
        w: Math.max(0, el.clientWidth - (Number.isFinite(pad) ? pad : 0)),
        h: el.clientHeight,
      };
    };
    const store = (next: { w: number; h: number }) =>
      setBox((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));

    /* **The first measure is synchronous, and that is the whole point of this
       being a layout effect.** It used to go through `requestAnimationFrame`
       like the resize path below, and rAF DOES NOT RUN IN A BACKGROUND TAB —
       so a panel first rendered in a tab that was never focused stayed on its
       "measuring" placeholder forever, with correctly-sized elements and a
       clean console. It is a blank picture that reports nothing wrong, which is
       exactly the shape docs/reusable/silent-success.md is about, and it is one
       of the failure modes docs/project/browser-testing.md warns a browser
       agent to expect. Measuring here also removes the one blank frame. */
    store(measure());

    let raf = 0;
    const ro = new ResizeObserver(() => {
      /* The resize path keeps the frame, and needs to: ResizeObserver fires
         *during* layout, and setting state straight from it is how you get
         "loop completed with undelivered notifications". Same guard the spine
         uses. A resize implies a visible tab, so the background-tab problem
         above cannot reach this half. */
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        store(measure());
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  /* **Built only when a graph picture is on.** Counting terms over a whole
     article is cheap — a few milliseconds for sixty sections — but it is not
     free, and three of the six pictures never look at it. Same reasoning that
     keeps `DiagramBand` from fetching anything: a reader who never leaves
     `strata` should not pay for the other three. */
  const wantsGraph = NEEDS_GRAPH.has(kind);
  /* **Only Force, and only Force.** This is the one thing the panel asks the
     server for, it costs a model call the first time, and it is the only fetch
     in the reading view a reader can start without pressing something that says
     what it will do. So the gate is narrow on purpose: not "a graph picture" —
     `force`, which is the picture Greg asked to put the dotted lines on. See
     useSimilar.ts. */
  const similar = useSimilar(slug, kind === "force");
  const graph = useMemo(
    () => (root && wantsGraph ? buildGraph(root, blocks, collapsed, similar.pairs) : null),
    // `wantsGraph`, NOT `kind`: stepping between Arc, Force and Cluster does not
    // change the graph, and keying on `kind` rebuilt the whole term index on
    // every one of those presses. On a 150-section article that is 100ms of
    // main thread for a result byte-identical to the one just thrown away.
    // GPT Sol's finding, 2026-08-27.
    //
    // `similar.pairs` is a *stable* array — the hook hands back the same one
    // until a new answer lands — so this rebuilds exactly twice per article:
    // once immediately without the embeddings, once when they arrive.
    [root, wantsGraph, blocks, collapsed, similar.pairs],
  );

  /* **The two scatters, and only those two.** Same narrow gate as `similar`
     above and for the same reason: this costs a model call the first time, and
     pressing a toggle is not a purchase decision. The server shares the vectors
     between the two endpoints, so a reader who has already opened Force pays
     only for the arithmetic here. See useProjection.ts. */
  const wantsPoints = NEEDS_POINTS.has(kind);
  const projection = useProjection(slug, wantsPoints);

  /* The picture's second data source, assembled only when a picture wants it.
     `axis` and `hue` are in here because they change where a dot goes and which
     palette slot it takes — both are geometry, decided by the layout. */
  const scatter = useMemo(
    () =>
      wantsPoints
        ? { blocks, input: { points: projection.points, k: projection.k, axis, hue } }
        : null,
    [wantsPoints, blocks, projection.points, projection.k, axis, hue],
  );

  /* **What is actually drawn**, which is not the same as which toggle is
     pressed: until the projection lands, `layoutDiagram` falls back to `strata`
     (see diagrams.ts). Deriving the role, the palette and the strip from the
     *picture on screen* rather than from `kind` is what stops the panel telling
     a screen reader it is showing a list of paragraphs while it is showing a
     column of sections. */
  const drawingPoints = wantsPoints && projection.points.length > 0;
  const flat = drawingPoints;
  const ramp = drawingPoints && hue === "progress";

  /* The three most distinctive words in each topic, for the lane legend.
     Computed here rather than on the server: it reuses `terms()`, which is the
     app's one idea of what a distinctive word is, and it costs one pass over
     text the browser is already holding. */
  const lanes = useMemo(
    () => (wantsPoints && projection.k > 0 ? laneTerms(projection.points, blocks, projection.k) : []),
    [wantsPoints, projection.points, projection.k, blocks],
  );

  /* `strata` is to scale in WORDS. Computed here rather than taken from `graph`,
     which is null unless a graph picture is on: the prefix sum is one pass over
     an array we already hold, where the graph builds a whole term index. */
  const words = useMemo(() => wordsBefore(blocks), [blocks]);

  /* `arc`, `force` and `cluster` return `nowY: null` and never read `atRow`, so
     for those three it was a dependency nobody looked at — and `atRow` changes
     every time the reader scrolls into a new section.

     That made scrolling with Force open re-run the whole layout, which is a
     300-tick d3 simulation measured at 39ms on a 60-section article and 113ms
     at 150, to produce a picture identical to the one just discarded: a hitch
     per section, all the way down a long article. Those three are also the
     expensive layouts, so excluding exactly them is where the whole saving is.

     `strata`, `drift` and `trail` keep it — see `NEEDS_AT_ROW` above, and note
     that the first version of this left two of them out. GPT Sol's finding,
     2026-08-27. */
  const followsReader = NEEDS_AT_ROW.has(kind) ? atRow : null;
  const layout: DiagramLayout | null = useMemo(() => {
    if (!root || box === null || box.w === 0) return null;
    return layoutDiagram(
      kind,
      root,
      { width: box.w, height: box.h, collapsed, atRow: followsReader, wordsBefore: words },
      graph,
      scatter,
    );
  }, [root, kind, box, collapsed, words, graph, scatter, followsReader]);

  /* The node the reader is standing in — the deepest one drawn, which is the
     same rule the summary panel's follow mark uses. Computed from the LAID OUT
     nodes rather than from the tree, so a closed section's mark lands on the
     closed section rather than vanishing. */
  const here = useMemo(() => nodeAt(layout?.nodes ?? [], atRow), [layout, atRow]);

  /* `aria-setsize` / `aria-posinset` for every node, computed once per layout
     rather than twice per node per render — the walk is O(n) each and there are
     sixty of them. */
  const runs = useMemo(() => siblingRuns(layout?.nodes ?? []), [layout]);

  /* What the reader is *pointing at*, whether with the pointer or the keyboard.
     Kept apart from `shown` below: this drives the `.on` highlight, and folding
     `here` into it would put the hover highlight and the you-are-here ring on
     the same node whenever nothing was hovered, which reads as a stuck pointer. */
  const picked = hover ?? (hasFocus ? roving : null);
  /* What the card describes, in order of how deliberate it is: the pointer beats
     the keyboard beats where the reader happens to be standing. */
  const shown = picked ?? here;
  const card = layout?.nodes.find((n) => n.id === shown) ?? null;

  /* The tabstop, defaulting to the first node and repaired whenever the picture
     changes under it — switching kind, closing a subtree, or a fresh article can
     all remove the node the tabstop was on, and a tabstop pointing at a node
     that is not drawn is a panel Tab cannot get into at all. */
  const nodes = layout?.nodes ?? [];
  const rovingId =
    roving !== null && nodes.some((n) => n.id === roving) ? roving : (nodes[0]?.id ?? null);

  /**
   * What the graph says about the node the card is describing: which other
   * sections it shares vocabulary with, and **which words earned each link**.
   *
   * Shown because the alternative is dishonest. These edges are a lexical
   * heuristic — term overlap, not an understanding of the argument — and a
   * curve drawn between two sections with no way to ask *why* looks exactly as
   * authoritative as one the model had reasoned about. `graph.ts` computed the
   * evidence from the start and nothing displayed it; GPT Sol's finding,
   * 2026-08-27. The words are the difference between a claim and a showing.
   */
  const related = useMemo(() => relatedFor(graph, shown, blocks), [graph, shown, blocks]);

  /** How many dotted lines the picture ended up with. See the status strip. */
  const drawnSemantic = useMemo(
    () => (graph?.edges ?? []).filter((e) => e.kind === "semantic").length,
    [graph],
  );

  const toggle = (id: NodeId) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** Move the tabstop, and move real focus with it. */
  const rove = (id: NodeId | null) => {
    if (id === null) return;
    setRoving(id);
    // The DOM node is keyed by its id, so it can be found without a ref map.
    scroller.current?.querySelector<SVGGElement>(`[data-diag-id="${id}"]`)?.focus();
  };

  /**
   * The tree pattern's key map, over the picture's own drawn order.
   *
   * Preorder is exactly what a flattened tree widget wants, and `layout.nodes`
   * is already in it — so Up and Down are one step in an array rather than a
   * traversal. Left and Right are the tree-specific half: on an open parent
   * Left closes it, otherwise it goes *to* the parent; Right opens a closed
   * parent, otherwise it steps into the first child.
   */
  const onKeyNav = (e: React.KeyboardEvent, node: DiagramNode) => {
    const i = nodes.findIndex((n) => n.id === node.id);
    const step = (d: number) => rove(nodes[Math.min(nodes.length - 1, Math.max(0, i + d))]?.id ?? null);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        step(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        step(-1);
        return;
      case "Home":
        e.preventDefault();
        rove(nodes[0]?.id ?? null);
        return;
      case "End":
        e.preventDefault();
        rove(nodes[nodes.length - 1]?.id ?? null);
        return;
      case "ArrowRight":
        e.preventDefault();
        // On a flat list of paragraphs there is nothing to open, so sideways is
        // the same step as down — which is what a listbox promises.
        if (flat) step(1);
        else if (node.hasChildren && node.collapsed) toggle(node.id);
        else if (node.hasChildren) step(1); // preorder: the next node IS the first child
        return;
      case "ArrowLeft": {
        e.preventDefault();
        if (flat) {
          step(-1);
          return;
        }
        if (node.hasChildren && !node.collapsed) {
          toggle(node.id);
          return;
        }
        // Walk back to the nearest shallower node — the parent, in preorder.
        for (let j = i - 1; j >= 0; j--) {
          const cand = nodes[j];
          if (cand && cand.depth < node.depth) {
            rove(cand.id);
            return;
          }
        }
        return;
      }
      case "Enter":
      case " ":
        e.preventDefault();
        onJump(node.blockId);
        return;
      default:
    }
  };

  return (
    <aside className="mode-band diag" aria-label="Diagram">
      <div className="diag-head">
        <Network size={14} className="diag-head-icon" />
        <h2>Diagram</h2>
      </div>

      {/* One tab stop, arrows inside — the radio pattern, and the same shape
          Dock.tsx's mode switcher already has. Three tab stops was the version
          this had first, and it is a role describing a widget the code does not
          implement. Found by GPT Sol, 2026-08-26. */}
      <div className="diag-kinds" role="radiogroup" aria-label="Which diagram">
        {DIAGRAMS.map((k, i) => {
          const ui = KIND_UI[k];
          const Icon = ui.icon;
          return (
            /* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern, and the same call Dock.tsx and SearchPanel.tsx already make — a real <input type="radio"> cannot carry an icon beside its label, and styling one to match means hiding the input and faking every state it already had */
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={k === kind}
              tabIndex={k === kind ? 0 : -1}
              className={`diag-kind${k === kind ? " on" : ""}`}
              title={ui.blurb}
              onClick={() => onKind(k)}
              onKeyDown={(e) => {
                const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (d === 0) return;
                e.preventDefault();
                // Wraps, as the radio pattern specifies.
                const next = DIAGRAMS[(i + d + DIAGRAMS.length) % DIAGRAMS.length];
                if (next) {
                  onKind(next);
                  // The newly-checked button is the new tab stop, so focus has
                  // to follow it or the next arrow press goes nowhere.
                  (e.currentTarget.parentElement?.children[
                    (i + d + DIAGRAMS.length) % DIAGRAMS.length
                  ] as HTMLElement | undefined)?.focus();
                }
              }}
            >
              <Icon size={12} />
              {ui.label}
            </button>
          );
        })}
      </div>

      {/* The two things a scatter lets the reader change, and neither is a
          different picture — which is why they are a second row of quieter
          chips rather than more of the row above, and why they are `replace` in
          the URL where `?diagram=` is `push` (params.ts).

          *Sideways* is hidden on Trail rather than disabled: Trail spends both
          axes on components, so the control has nothing to do there, and a
          control that is visibly present and inert is worse than one that is
          not there. */}
      {wantsPoints && (
        <div className="diag-opts">
          {kind === "drift" && (
            <Choice
              label="Sideways"
              value={axis}
              onChange={onAxis}
              options={[
                { value: "lanes", label: "Lanes", blurb: "One column per topic the model found" },
                {
                  value: "spread",
                  label: "Spread",
                  blurb: "One sliding scale — the single biggest axis of variation in the article",
                },
              ]}
            />
          )}
          <Choice
            label="Colour"
            value={hue}
            onChange={onHue}
            options={[
              { value: "section", label: "Section", blurb: "The same eight hues the other pictures use" },
              {
                value: "progress",
                label: "Progress",
                blurb: "Dark at the start of the article, bright at the end",
              },
              { value: "topic", label: "Topic", blurb: "The model's own grouping" },
            ]}
          />
        </div>
      )}

      {/* **The legend, and it is not decoration.** A lane a reader cannot name
          is a lane they have to take on trust, and the words are what make it
          arguable with — the same rule the vocabulary edges follow, and the
          most important thing docs/project/diagram.md records about them. */}
      {drawingPoints && axis === "lanes" && kind === "drift" && lanes.length > 0 && (
        <ul
          className="diag-lanes"
          aria-label="What each column is about"
          /* The grid needs to know how many columns to make, and only this
             component knows — see § drift and trail in styles.css for why the
             legend is a grid rather than a wrapping row. */
          style={{ "--lanes": lanes.length } as React.CSSProperties}
        >
          {lanes.map((words, i) => (
            <li
              // The lane index IS the identity here — lane 3 is lane 3 whatever
              // words it happens to hold this time.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={i}
              className="diag-lane"
              style={hue === "topic" ? slotStyle(i) : undefined}
              title={
                words.length > 0
                  ? `Column ${i + 1}: ${words.join(" · ")}`
                  : `Column ${i + 1}: no distinctive words`
              }
            >
              {words[0] ?? "—"}
            </li>
          ))}
        </ul>
      )}

      {/* **Beside the picture, never over it.** The Force picture is complete
          the moment it is drawn — four of its five kinds of line are free — and
          the embeddings only add the fifth. A spinner across a diagram that is
          already four fifths there would say the wrong thing about what is
          missing, so the one line of status lives here, in the chrome.

          The error branch is not decoration either: without it a failed request
          would leave a picture that quietly draws four kinds where five were
          promised, and nothing on screen would be wrong. */}
      {/* What the two scatters have to say out loud, and the reason it is not
          in a tooltip. Two components out of 1,024 throw away most of what the
          model saw, so a scatter plot that does not say so is the
          silent-success shape with a picture on it — and the number alone is
          worse than useless to a reader who does not know what "variance"
          means. So it is one sentence in ordinary words, and it says the thing
          a percentage cannot: **the projection can only ever pull dots
          together, never push them apart.** GPT Sol's finding, 2026-08-27. */}
      {wantsPoints && projection.status !== "idle" && (
        <p className="diag-note" role="status">
          {projection.status === "loading" && "Reading the article paragraph by paragraph…"}
          {projection.status === "ready" && kept(projection)}
          {/* **The server's own words, not a guess at them.** The route now
              tells a provider outage apart from a bug of ours and says which;
              a fixed sentence here would have reported an authentication
              failure, a network drop and a broken deploy as the embedding model
              being down. GPT Sol's finding, 2026-08-27. */}
          {projection.status === "error" &&
            `${projection.error ?? "Could not place these paragraphs, and the reason did not come back."} The picture below is Strata instead.`}
        </p>
      )}

      {kind === "force" && similar.status !== "idle" && (
        <p className="diag-note" role="status">
          {similar.status === "loading" && "Reading the article for related passages…"}
          {/* **Counted from the lines actually drawn, not from the pairs that
              came back.** Those are different numbers: the client drops pairs
              whose passages sit in one section, and pairs whose sections the
              reading-order chain already joins. Reporting the pairs would say
              "28 passages embedded" over a picture with no dotted lines on it —
              true about the request, and wrong about the page. */}
          {similar.status === "ready" &&
            (drawnSemantic > 0
              ? `${drawnSemantic} dotted ${drawnSemantic === 1 ? "link" : "links"} from ${similar.blocks} passages · ${similar.model}`
              : `${similar.blocks} passages embedded, and nothing came back that the picture does not already say`)}
          {similar.status === "error" &&
            "Could not reach the embedding model, so there are no dotted lines. The rest of the picture is unaffected."}
        </p>
      )}

      <div className="diag-scroll" ref={scroller}>
        {root === null ? (
          <p className="diag-quiet">
            This article has no usable tree, so there is nothing to draw. Run <code>npm run toc</code>{" "}
            for it and the picture appears.
          </p>
        ) : layout === null ? (
          /* Before the first measure there is no width, and a diagram laid out
             against a guessed width would be visibly wrong for one frame. An
             empty box for one frame is the cheaper mistake. */
          <div className="diag-measuring" aria-hidden="true" />
        ) : (
          <svg
            className={`diag-svg diag-${kind}`}
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            /* SVG has no `ul`, no `li` and no `button`, so every role in this
               picture is written out rather than inherited from an element. The
               alternative is a <foreignObject> per node, which buys real HTML at
               the price of a layout box per node in a picture that can hold a
               hundred of them. */
            /* **A listbox where the picture is a flat list of paragraphs, a
               tree where it is a tree.** The six tree and graph pictures draw
               nested sections and honour the whole tree contract; the two
               scatters draw 276 paragraphs with no nesting and nothing to open,
               so claiming `tree` there would describe a widget this code does
               not implement. GPT Sol's finding, 2026-08-27. */
            /* No `biome-ignore` here any more, and that is a consequence of the
               role being a variable: the rule that needed suppressing fires on a
               *literal* role, so a computed one is invisible to it. Left as a
               note rather than a stale suppression, which Biome flags in its own
               right. */
            role={flat ? "listbox" : "tree"}
            aria-label={
              flat
                ? `${KIND_UI[kind].label} view — one dot per paragraph, placed by what it is about`
                : `${KIND_UI[kind].label} view of the article's structure`
            }
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHasFocus(true)}
            // `focusout` bubbles where `blur` does not, so React's onBlur here
            // fires when focus leaves any node inside. The relatedTarget check
            // keeps it from firing as focus moves BETWEEN two nodes.
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHasFocus(false);
            }}
          >
            {/* The arrowhead, defined once and referenced by every sequence
                line. `orient="auto"` turns it to face along the line;
                `markerUnits="strokeWidth"` scales it with the chain so a
                thicker line does not grow a proportionally smaller head.

                **Its fill is in the stylesheet, not here, and not
                `context-stroke`.** That keyword would make the head take the
                colour of the path using it, which is the tidy answer and is
                supported everywhere this app runs — but a `fill` presentation
                attribute the browser cannot parse falls back to *black*, and a
                black arrowhead on a near-black page is an arrow that is simply
                not there. One token shared with `.diag-link-sequence` cannot
                fail that way. See styles.css § diagram mode. */}
            <defs>
              <marker
                id="diag-arrow"
                viewBox="0 0 6 6"
                /* The tip, in the marker's own coordinates. This point is
                   placed exactly on the path's last point, which is what makes
                   `HEAD_GAP` in diagram-d3.ts mean what it says. */
                refX="6"
                refY="3"
                /* **`userSpaceOnUse`, not the default.** The default is
                   `strokeWidth`, which scales the head with the line — so the
                   geometry `arrowPath` computes — "the tip lands HEAD_GAP px outside the
                   target circle" — would only be true at stroke-width 1, and
                   changing the sequence line's weight in the stylesheet would
                   silently move every arrowhead. Fixed units keep the
                   arithmetic and the CSS independent of each other. */
                markerUnits="userSpaceOnUse"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path className="diag-arrowhead" d="M 0 0.6 L 6 3 L 0 5.4 z" />
              </marker>
            </defs>
            {layout.links.map((l) => (
              <path
                key={l.id}
                /* `kind` where the picture has kinds, `depth` where it does not.
                   Both classes are emitted rather than one, because the three
                   tree pictures' stylesheets are written against `diag-d*` and
                   this must not change what they draw. */
                className={`diag-link diag-d${l.depth}${l.kind ? ` diag-link-${l.kind}` : ""}`}
                style={slotStyle(l.part)}
                d={l.d}
                fill="none"
                {...(l.arrow ? { markerEnd: "url(#diag-arrow)" } : {})}
              />
            ))}
            {layout.nodes.map((n, i) => (
              <NodeShape
                key={n.id}
                node={n}
                kind={kind}
                flat={flat}
                ramp={ramp}
                here={n.id === here}
                focused={n.id === picked}
                tabstop={n.id === rovingId}
                setSize={runs[i]?.size ?? 1}
                posInSet={runs[i]?.pos ?? 1}
                onJump={onJump}
                onHover={setHover}
                onRove={setRoving}
                onKeyNav={onKeyNav}
                onToggle={toggle}
              />
            ))}
            {/* You-are-here, as a line rather than a highlight — only on the
                picture whose y really is the article. On the other two the same
                fact is carried by the marked node, because a line across a
                diagram whose vertical axis is "whatever fits" would be a
                confident statement about a position that does not exist. */}
            {layout.nowY !== null && (
              <line
                className="diag-now"
                x1={0}
                x2={layout.width}
                y1={layout.nowY}
                y2={layout.nowY}
              />
            )}
          </svg>
        )}
      </div>

      <DetailCard
        node={card}
        ramp={ramp}
        live={shown === here && hover === null}
        onJump={onJump}
        related={related}
      />
    </aside>
  );
}

/**
 * One row of the second control strip — a radiogroup of small chips.
 *
 * The same one-tab-stop-plus-arrows shape as the kind switcher above it and as
 * `Dock.tsx`, written once here because there are now two of them. It is a
 * `<button role="radio">` rather than a real `<input type="radio">` for the
 * reason the kind switcher already gives: a real radio cannot carry this
 * styling without hiding the input and faking every state it had.
 */
function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange(next: T): void;
  options: { value: T; label: string; blurb: string }[];
}) {
  return (
    /* The caption sits OUTSIDE the radiogroup. A `<span>` among the radios is a
       child of a role that does not want one, and it would also make the
       group's children off-by-one from its options — which is exactly the sort
       of index the focus move below has to get right. */
    <div className="diag-opt">
      <span className="diag-opt-label">{label}</span>
      <div className="diag-opt-set" role="radiogroup" aria-label={label}>
        {options.map((o, i) => (
        /* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern — see the kind switcher above */
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={`diag-opt-btn${o.value === value ? " on" : ""}`}
          title={o.blurb}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const d =
              e.key === "ArrowRight" || e.key === "ArrowDown"
                ? 1
                : e.key === "ArrowLeft" || e.key === "ArrowUp"
                  ? -1
                  : 0;
            if (d === 0) return;
            e.preventDefault();
            // Wraps, as the radio pattern specifies.
            const at = (i + d + options.length) % options.length;
            const next = options[at];
            if (!next) return;
            onChange(next.value);
            /* **And focus follows.** The newly-checked radio is the new tab
               stop, so leaving focus behind means the next arrow press runs the
               *old* button's handler and steps from the same place — you can
               reach the neighbour and never anything past it. Tab then also
               lands back inside the group instead of leaving it. The kind
               switcher above already does this; this one did not until GPT Sol
               read it, and the failure is one press away from looking fine. */
            (e.currentTarget.parentElement?.children[at] as HTMLElement | undefined)?.focus();
          }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * What the strip says once the projection has landed, in ordinary words.
 *
 * Three things, and the third is the one a percentage cannot say on its own:
 * how many paragraphs are drawn, how many are not, and that **squashing 1,024
 * dimensions into two can only ever pull dots together — never push them
 * apart.** So two dots far apart really are far apart, and two dots on top of
 * one another may differ entirely in something this threw away.
 *
 * The two components are reported as **one** figure rather than two. Their
 * individual sizes move around when the top two are close, while the plane they
 * span does not, so quoting them separately would be quoting the least stable
 * half of the answer. GPT Sol's finding, 2026-08-27.
 */
function kept(p: UseProjection): string {
  /* **Nothing to draw is its own sentence.** An article of one long paragraph,
     or one that is all headings, comes back ready and empty — and the general
     wording below would tell the reader what percentage of the differences this
     flat view keeps, of a view that is not there. GPT Sol's finding,
     2026-08-27. */
  if (p.blocks < 2) {
    return "Not enough prose here to place — a paragraph needs a dozen words before the model can say what it is about. The picture below is Strata instead.";
  }
  const held = Math.round((p.variance[0] + p.variance[1]) * 100);
  const short = p.skipped.tooShort + p.skipped.nonProse;
  const missing = short > 0 ? `, ${short} too short or not prose to place` : "";
  const capped = p.skipped.capped > 0 ? `, ${p.skipped.capped} past the limit` : "";
  const by = p.model ? ` Placed by ${p.model}.` : "";
  return `${p.blocks} paragraphs${missing}${capped}. This flat view keeps about ${held}% of the differences the model found, so dots far apart really are far apart — dots close together may still differ in what was left out.${by}`;
}

/**
 * `aria-setsize` and `aria-posinset` for a flat DOM that is really a tree.
 *
 * A `role="treeitem"` inside a nested `<ul>` gets both for free. These are `<g>`
 * elements side by side inside one `<svg>`, so nothing in the markup says that
 * node 7 is the second of three sections inside part 2 — it has to be stated.
 * Both are read off the drawn order, which is preorder: a node's siblings are
 * the nodes of equal depth around it, bounded in each direction by the first
 * shallower node.
 */
function siblingRun(nodes: readonly DiagramNode[], i: number): { size: number; pos: number } {
  const self = nodes[i];
  if (!self) return { size: 1, pos: 1 };
  let size = 0;
  let pos = 0;
  for (let j = i; j >= 0; j--) {
    const n = nodes[j];
    if (!n || n.depth < self.depth) break;
    if (n.depth === self.depth) {
      size++;
      pos++;
    }
  }
  for (let j = i + 1; j < nodes.length; j++) {
    const n = nodes[j];
    if (!n || n.depth < self.depth) break;
    if (n.depth === self.depth) size++;
  }
  return { size, pos };
}

/** `siblingRun` for every node in one pass, so a render is not O(n²). */
export function siblingRuns(nodes: readonly DiagramNode[]): { size: number; pos: number }[] {
  return nodes.map((_, i) => siblingRun(nodes, i));
}

/**
 * A palette *slot*, as the `--cat-rgb` triplet the rest of the app already
 * speaks. Its companion `rampStyle` below is the same idea over the sequential
 * ramp, for the one thing that is ordered rather than categorical.
 *
 * The indirection is deliberate and is SearchPanel's: a component picks a
 * *slot*, and the stylesheet owns what that slot looks like. So the eight hues
 * live in styles/colourscales.css, where the reasoning about a near-black ground
 * is (docs/project/colour-scales.md), and this file never names a colour.
 *
 * The root, which is `part === -1`, gets the neutral rather than a ninth hue:
 * it is not one of the parts, it is all of them.
 */
function slotStyle(part: number): React.CSSProperties {
  const slot = part < 0 ? "7" : String(part % PART_HUES);
  return { "--cat-rgb": `var(--cat-${slot}-rgb)` } as React.CSSProperties;
}

/**
 * A step of the **sequential** ramp, for the one thing in this panel that is
 * ordered rather than categorical: how far through the article a paragraph is.
 *
 * Viridis rather than the heat ramp, and that is the repo's own rule rather
 * than a preference — docs/project/colour-scales.md says inferno is the
 * blackbody ramp and belongs to quantities with *temperature* in them, and that
 * viridis is wanted "the moment something needs a sequential ramp with no
 * temperature in it". Reading position is exactly that. GPT Sol pointed out
 * that the first draft reached for inferno out of what was already there.
 *
 * It also happens to be the ramp with no unusable end on a near-black page: the
 * darkest viridis stop is comfortably above `--page`, where `--heat-0` and
 * `--heat-1` are not, so there is no "start at step 2" caveat to get wrong —
 * and the first draft of this got wrong anyway, by keeping inferno's offset
 * after the ramp had changed and quietly never drawing the two darkest stops.
 *
 * `scatter.ts` decides the step; this file only says which ramp the number
 * indexes into. Same split as `slotStyle` — a component picks a slot, the
 * stylesheet owns what it looks like.
 */
function rampStyle(step: number): React.CSSProperties {
  const at = Math.max(0, Math.min(RAMP_STEPS - 1, step));
  return { "--cat-rgb": `var(--vir-${at}-rgb)` } as React.CSSProperties;
}

/**
 * One node: its shape, its label, and its two clickable jobs.
 *
 * **The whole node is the jump and the chevron is the toggle**, which is the
 * arrangement every file tree uses and the one readers already know. It matters
 * more here than in a file tree, because the shapes are small: a node that
 * toggled on its own body would make "I wanted to go there" and "I wanted to
 * fold that away" the same gesture at the same pixel.
 *
 * `<g role="treeitem" tabIndex>` rather than an HTML button: SVG has no button,
 * and a `foreignObject` per node would cost a layout box per node in a picture
 * that can have a hundred of them. The role, the label, `aria-expanded` and the
 * key handling are what a button would have given us, written out.
 */
function NodeShape({
  node,
  kind,
  flat,
  ramp,
  here,
  focused,
  tabstop,
  setSize,
  posInSet,
  onJump,
  onHover,
  onRove,
  onKeyNav,
  onToggle,
}: {
  node: DiagramNode;
  kind: DiagramKind;
  /** A flat list of paragraphs rather than a tree — see `NEEDS_POINTS`. */
  flat: boolean;
  /** Colour by the sequential ramp rather than by the categorical wheel. */
  ramp: boolean;
  here: boolean;
  focused: boolean;
  /** The one node in the picture that Tab reaches. See `roving` in the panel. */
  tabstop: boolean;
  setSize: number;
  posInSet: number;
  onJump(id: BlockId): void;
  onHover(id: NodeId | null): void;
  onRove(id: NodeId): void;
  onKeyNav(e: React.KeyboardEvent, node: DiagramNode): void;
  onToggle(id: NodeId): void;
}) {
  const titles = node.titleLines;
  const step = LINE_STEP[kind];
  const label = node.number ? `${node.number} ${node.title}` : node.title;
  const cls = [
    "diag-node",
    `diag-d${node.depth}`,
    here ? "here" : "",
    focused ? "on" : "",
    node.collapsed ? "closed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    /* biome-ignore lint/a11y/useAriaPropsSupportedByRole: `aria-setsize` and `aria-posinset` are supported by BOTH roles this can take — `treeitem` and `option` — but the role is computed, so the rule cannot see which one and assumes neither */
    /* biome-ignore lint/a11y/noStaticElementInteractions: same cause — this element HAS an interactive role, computed rather than literal; SVG has no <button> and a <foreignObject> per node would cost a layout box in a picture that holds hundreds */
    <g
      className={cls}
      style={ramp ? rampStyle(node.part) : slotStyle(node.part)}
      role={flat ? "option" : "treeitem"}
      // The DOM is flat — every node is a sibling — so the nesting has to be
      // stated rather than inferred from the markup. `aria-level` is 1-based
      // where our depth is 0-based, and an option has no level to state.
      {...(!flat && { "aria-level": node.depth + 1 })}
      /* **`aria-selected` is where the keyboard is, and nothing else.** A
         single-select listbox may have one selected option; folding the
         reader's scroll position in makes two, and folding *hover* in makes
         pointing at a dot an act of selection. Where the reader is standing is
         carried by the label, which says which paragraph of how many. GPT Sol's
         finding, 2026-08-27. */
      {...(flat && { "aria-selected": focused })}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      data-diag-id={node.id}
      tabIndex={tabstop ? 0 : -1}
      /* **`node.label` where the picture spends position on something colour is
         also carrying.** A scatter dot's topic and its place in the article are
         in its position and its hue and nowhere else, and colour-scales.md is
         emphatic that colour is never allowed to be the only carrier. The six
         other pictures have nothing extra to say and fall through to the
         default. */
      aria-label={node.label ?? `${label}, ${node.blocks} paragraph${node.blocks === 1 ? "" : "s"}`}
      {...(node.hasChildren && { "aria-expanded": !node.collapsed })}
      onPointerEnter={() => onHover(node.id)}
      onFocus={() => onRove(node.id)}
      onClick={() => onJump(node.blockId)}
      onKeyDown={(e) => onKeyNav(e, node)}
    >
      {kind === "tree" ? (
        <>
          <rect className="diag-row" x={node.x} y={node.y} width={node.w} height={node.h} rx={3} />
          <circle className="diag-dot" cx={node.labelX - 9} cy={node.y + 7.5} r={3.5} />
        </>
      ) : kind === "force" ? (
        /* A bubble, and the box IS the circle here rather than a row around it —
           in a force layout the shape's position is the whole of the
           information, so a rectangular hit target would sit over its
           neighbours. */
        <circle
          className="diag-box"
          cx={node.x + node.w / 2}
          cy={node.y + node.h / 2}
          r={node.w / 2}
        />
      ) : (
        <rect
          className="diag-box"
          x={node.x}
          y={node.y}
          width={node.w}
          height={node.h}
          rx={kind === "mindmap" ? Math.min(9, node.h / 2) : node.depth === 2 ? 2 : 1}
        />
      )}
      {/* A mindmap twig is a dot on its part's sub-spine, and the dot sits on
          the far side of the label from the text — which is the side `anchor`
          already names, so the geometry does not have to carry it twice. */}
      {kind === "mindmap" && node.depth === 2 && (
        <circle
          className="diag-dot"
          cx={node.anchor === "start" ? node.labelX - 7 : node.labelX + 7}
          cy={node.y + node.h / 2}
          r={3}
        />
      )}
      {/* `arc` and `cluster` put the node on a spine and the hit target across
          the whole row, so the mark is carried separately — see `dot` in
          diagram.ts for why those are not the same rectangle. */}
      {node.dot && (
        <circle className="diag-dot" cx={node.dot.x} cy={node.dot.y} r={node.dot.r} />
      )}

      <text
        className="diag-label"
        x={node.labelX}
        y={node.labelY}
        textAnchor={node.anchor}
        {...(node.rotated && {
          transform: `rotate(-90 ${node.labelX} ${node.labelY})`,
        })}
      >
        {node.lines.map((line, i) => (
          <tspan
            // Index keys: these are wrapped fragments of one string with no
            // identity of their own, and they are replaced wholesale whenever
            // the string or the width changes.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={i}
            className={kind === "tree" && i >= titles ? "diag-gist" : undefined}
            x={node.labelX}
            // The step for a line is the step for the half of the label it is
            // in, and the layout reserved the row's height with exactly these
            // two numbers. Advancing by anything else is the bug LINE_STEP
            // exists to stop.
            {...(i > 0 && { dy: i >= titles ? step.gist : step.title })}
          >
            {line}
          </tspan>
        ))}
      </text>

      {/* The paragraph count, on the pictures that have room for it. The answer
          to "how much am I not seeing" — which `strata` answers with the height
          of the band itself and therefore does not need in text. */}
      {kind === "tree" && (
        <text className="diag-count" x={node.w - 6} y={node.y + 11} textAnchor="end">
          {node.blocks}
        </text>
      )}

      {node.hasChildren && kind === "tree" && (
        // biome-ignore lint/a11y/useSemanticElements: SVG has no <button> — see the <svg> above
        <g
          className="diag-twist"
          role="button"
          tabIndex={-1}
          aria-label={node.collapsed ? `Open ${label}` : `Close ${label}`}
          onClick={(e) => {
            // Or the row's own handler jumps the article at the same time.
            e.stopPropagation();
            onToggle(node.id);
          }}
        >
          <rect x={node.labelX - 21} y={node.y} width={14} height={15} fill="transparent" />
          {node.collapsed ? (
            <ChevronRight x={node.labelX - 20} y={node.y + 2} size={11} />
          ) : (
            <ChevronDown x={node.labelX - 20} y={node.y + 2} size={11} />
          )}
        </g>
      )}
    </g>
  );
}

/**
 * The strip under the picture: whatever the pointer is on, in full.
 *
 * With nothing hovered it shows the node the reader is standing in, and says so
 * — an unlabelled card that changed on its own as you scrolled would read as a
 * stale hover rather than as a position.
 */
/**
 * What to write beside a related section, given what kind of line joins them.
 *
 * Each kind says the thing it actually knows, and no kind borrows another's
 * voice. The anchor row is in quotation marks because the words are the
 * author's; the semantic row carries a bare number because a cosine is not a
 * sentence and dressing it as one ("closely related") would be putting our
 * confidence on a model's arithmetic.
 */
function evidence(r: Related): string {
  if (r.kind === "anchor") return r.label ? `“${r.label}”` : "linked by the author";
  if (r.kind === "semantic") {
    /* The passage first, the number second. A cosine on its own asks the reader
       to trust it; a line of the actual prose lets them judge it, which is the
       only thing that makes a dotted line worth drawing. */
    return r.quote ? `“${r.quote}…” · ${(r.score ?? 0).toFixed(2)}` : `similar meaning · ${(r.score ?? 0).toFixed(2)}`;
  }
  return r.shared.slice(0, 4).join(" · ");
}

function DetailCard({
  node,
  ramp,
  live,
  onJump,
  related,
}: {
  node: DiagramNode | null;
  ramp: boolean;
  live: boolean;
  onJump(id: BlockId): void;
  /** The graph pictures only: what this section is joined to, and what earned each line. */
  related: Related[];
}) {
  if (!node) {
    return (
      <div className="diag-card empty">
        <p>Point at anything in the picture. Clicking it takes the article there.</p>
      </div>
    );
  }
  return (
    <div className="diag-card" style={ramp ? rampStyle(node.part) : slotStyle(node.part)}>
      <div className="diag-card-head">
        {live && <span className="diag-card-live">you are here</span>}
        <button
          type="button"
          className="diag-card-title"
          // The last resort for a title so long that even the card clamps it.
          title={node.title}
          onClick={() => onJump(node.blockId)}
        >
          {node.number && <span className="diag-card-num">{node.number}</span>}
          {node.title}
        </button>
        <span className="diag-card-count">
          {node.blocks} ¶
        </span>
      </div>
      {node.gist && related.length === 0 && (
        <p className="diag-card-gist" title={node.gist}>
          {node.gist}
        </p>
      )}
      {/* The gist gives way to the evidence when there is evidence: on a graph
          picture the question the reader has is "why is that line there", and
          the gist is one press away on any of the other three. */}
      {related.length > 0 && (
        <ul className="diag-card-links">
          {related.map((r) => (
            <li key={`${r.kind}-${r.number}-${r.title}`} className={`diag-card-link-${r.kind}`}>
              <span className="diag-card-linknum" title={r.title}>
                {r.number}
              </span>
              <span className="diag-card-linkterms">{evidence(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
