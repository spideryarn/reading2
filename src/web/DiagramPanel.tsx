/**
 * The Diagram panel — a **mode**, in the band between the spine and the prose.
 *
 * ```
 *  ┌── spine ──┬────── DIAGRAM (this panel) ──────┬──── the article ────┐
 *  │           │  DIAGRAM  force · drift · trail  │                     │
 *  │  ▇▇▇▇▇▇▇  │ ──────────────────────────────── │  Being You opens    │
 *  │  ▇▇▇▇     │        ◯───◯                     │  with a story about │
 *  │  ▇▇▇      │       ╱ ╲ ╱                      │  waking from        │
 *  │  ▇▇▇▇▇▇   │      ◯───◉····◯  ◀── you are here│  anaesthesia…       │
 *  │  ▇▇       │       ╲   ╲                      │                     │
 *  │  ▇▇▇▇     │        ◯───◯                     │  Every paragraph    │
 *  │  ▇▇▇      │                                  │  stays where it was.│
 *  │           │ ──────────────────────────────── │                     │
 *  │           │  1.1 The body as a model   6 ¶   │  Clicking a bubble  │
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
 * on `drift` — whose vertical axis really is the article — a line is drawn
 * across at the exact row. There is a pair of step buttons under the picture
 * that walk the article from here, and the arrow keys do the same inside it.
 * That is the whole reason this is a mode inside the reading view rather than
 * an export.
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChartScatter,
  ChevronDown,
  ChevronUp,
  Info,
  LoaderCircle,
  Network,
  PenLine,
  Route,
  Waypoints,
} from "lucide-react";
import { isBody } from "../block-policy.js";
import type { Block, BlockId, NodeId } from "../types.js";
import {
  DIAGRAMS,
  chainNearness,
  type DiagramKind,
  LINE_STEP,
  type DiagramLayout,
  type DiagramNode,
  type LinkKind,
  nodeAt,
  paragraphStops,
  stepStops,
} from "./diagram.js";
import { layoutDiagram } from "./diagrams.js";
import { type ArticleGraph, buildGraph, wordsBefore } from "./graph.js";
import { useSimilar } from "./useSimilar.js";
import { type UseProjection, useProjection } from "./useProjection.js";
import { RAMP_STEPS, laneTerms, type ScatterAxis, type ScatterHue } from "./scatter.js";
import type { SummaryNode } from "./tree.js";
import { useRenderCount } from "./perf.js";
import { CHAIN_MS, measureRow, stepTarget } from "./keynav.js";
import { activeSectionIndex } from "./position.js";
import { SketchView } from "./SketchView.js";
import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";

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
  /**
   * Where the reader is, as a row index into the article's blocks — **whatever
   * `?at=` holds**, which is usually a section and is not always one: the scroll
   * spy writes the section, and a deliberate jump is allowed to leave the
   * paragraph it aimed at (position.ts § positionToWrite).
   *
   * The fallback rather than the answer since 2026-08-31: on a picture drawn at
   * paragraph resolution the panel measures the row itself (`useReaderRow`),
   * and this is what it uses before the first measurement and on Force, whose
   * nodes are sections anyway.
   */
  atRow: number | null;
  /** Jump the article to a block, exactly as a gist cell does. */
  onJump(id: BlockId): void;
  /**
   * Every block of the article, in order — what the Force picture's graph is
   * built from (src/web/graph.ts), and what the two scatters name their lanes
   * from.
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

/**
 * What each picture is called where the reader meets it, and what it promises.
 *
 * **Three fields rather than one, and the third is the one readers ask for.**
 * `blurb` says what the picture shows; `how` says where it comes from and what
 * it costs. All three spend a model call, and they do not spend it on the same
 * thing: Force's buys the dotted lines onto a picture that is already drawn,
 * while Drift's and Trail's buy the picture itself — see
 * docs/project/diagram.md.
 *
 * Both are rendered in a real hover card (Tooltip.tsx) rather than a `title`
 * attribute. The native tooltip waits about a second, cannot be styled, cannot
 * be read by touch, and truncates at the OS's own idea of a line — for a
 * sentence explaining what a picture *is*, that is close to not being there.
 */
const KIND_UI: Record<DiagramKind, { label: string; icon: typeof Network; blurb: string; how: string }> = {
  /* Force draws the GRAPH, not the tree — sections joined by the words they
     share as well as by where they sit (src/web/graph.ts). Its blurb says what
     it is *for*, because unlike the tree it is not showing the reader something
     they could have worked out from the contents page. */
  force: {
    label: "Force",
    icon: Waypoints,
    blurb:
      "Sections as bubbles, settled by physics: ones that talk about the same things pull together, while down the page stays reading order.",
    how: "The solid lines are free — reading order, containment, and words two sections share. The dotted ones cost one model call, and say the two passages mean something similar.",
  },
  /* The last two draw neither the tree nor the graph: one dot per PARAGRAPH,
     placed by what the paragraph is about (src/web/scatter.ts). They are the
     only two pictures here whose axes came out of a model. */
  drift: {
    label: "Drift",
    icon: ChartScatter,
    blurb:
      "One dot per paragraph: down the page is still the article, sideways is what it is talking about — so a subject the piece returns to is a second cluster far below the first.",
    how: "Costs one model call the first time, which reads every paragraph. Sideways is either one sliding scale or a column per topic — the Sideways control switches between them.",
  },
  trail: {
    label: "Trail",
    icon: Route,
    blurb:
      "The same dots with both axes spent on meaning, joined in reading order — so you can see whether the piece travels through its subject or circles back over it.",
    how: "Shares Drift's model call, so opening one pays for both. This is the only picture here where down the page is not later in the article; colour by Progress if you need that back.",
  },
  /* The odd one out, and the card has to say so before it is pressed: the three
     above are geometry over the article's own tree, and this one is a model's
     drawing. Its `how` leads with the price because it is the only picture here
     that costs two minutes and cannot be redrawn for free. */
  sketch: {
    label: "Sketch",
    icon: PenLine,
    blurb:
      "A model reads the article, works out what shape the argument is — three supports converging, a ladder, a spine with asides — and draws that. The only picture here that is not the same shape for every article.",
    /* **Both promises here were stronger than the artefact.** The picture is
       *checked* for running down the page with the article and for how much of
       it is reachable, but the bar it has to clear is `MIN_FLOW` 0.3 and
       `MIN_LINKED_SHARE` 0.5 (src/sketch-scene.ts) — so "down the page is
       reading order" and "click a box to jump there" were describing the good
       case as the guarantee. ⟨Sol⟩, 2026-08-30. */
    how: "Costs one model call and about two minutes, and is never drawn until you ask. It mostly runs down the page with the article, and nothing is to scale. Boxes that point at a passage jump there when clicked; not all of them do.",
  },
};

/**
 * The pictures that draw a you-are-here line, and therefore the only ones for
 * which the reader's position is an input to layout.
 *
 * **This said `["strata"]` and that was wrong**, which is worth leaving in the
 * file because of how the mistake was made — and `strata` has since been cut,
 * so this set is now exactly the two pictures the mistake left out. `atRow` was
 * grepped for in diagram.ts and diagram-d3.ts, both of which really did ignore
 * it everywhere but `layoutStrata`, and scatter.ts — where `drift` draws its
 * position line and `trail` brightens the chain around the reader — was simply
 * not one of the files looked at. A grep over the wrong set of files reads
 * exactly like a grep that found everything.
 *
 * The failure it would have shipped is the quiet kind: two pictures whose
 * you-are-here line silently stops following you. Nothing throws, nothing
 * looks broken in a screenshot, and `tests/scatter.test.ts` — which does cover
 * both behaviours — passes, because the layout functions were never the thing
 * that changed. Caught by a GPT Sol review of the built code, 2026-08-27.
 *

 * A set rather than an equality test because the next picture to grow a `nowY`
 * has to add itself here, and a `kind === "drift"` buried in a memo is not
 * somewhere anybody would think to look.
 */
const NEEDS_AT_ROW = new Set<DiagramKind>(["drift", "trail"]);

const NEEDS_GRAPH = new Set<DiagramKind>(["force"]);

/**
 * The collapse set, which is empty and stays empty — see `collapsed` in the
 * panel for why, and why it is a constant rather than a deletion.
 *
 * Module-level so it is one object for the life of the page: it is a dependency
 * of the `graph` and `layout` memos, and a fresh `new Set()` per render would
 * make both of them miss on every render — which on Force is a 300-tick physics
 * simulation.
 */
const NOTHING_COLLAPSED: ReadonlySet<NodeId> = new Set();

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

/**
 * **Where the reader actually is, in article rows** — measured from the page
 * rather than read off `?at=`.
 *
 * `?at=` names the **section** the reader is in, deliberately and for three
 * good reasons (position.ts § the header), and this panel used it as though it
 * named the paragraph. On a picture whose vertical axis *is* the article that
 * shows: measured on scaling-hypothesis on 2026-08-31, the you-are-here line
 * sat one to three paragraphs behind the reading line and then jumped, rather
 * than following. Greg, the same day: *"if I click up/down to move paragraphs
 * in the text, it doesn't update the position correspondingly in the diagram"*.
 *
 * `measureRow` is **keynav.ts's**, the same one `swipe.ts` uses, for the reason
 * written down there: a finger and a key must not disagree about which item the
 * reader is in. A picture drawn against the article is the third thing that
 * must not disagree, and a fourth idea of the reading line is how three of them
 * end up saying different numbers.
 *
 * **`enabled` is the gate, and Force is the reason for it.** Only the two
 * scatters draw at paragraph resolution; Force's nodes are sections, so a finer
 * row would move its mark at exactly the moments `?at=` already does while
 * re-rendering it on every paragraph crossing — and Force's layout is the
 * 300-tick d3 simulation that was taken off `atRow` on 2026-08-27 for precisely
 * that cost. Off, this installs no listener and the panel pays nothing.
 *
 * One `requestAnimationFrame` per burst of scrolling, which is the shape
 * `useReadingPosition` and `watchBarVisibility` both use. `setRow` with an
 * unchanged number re-renders nothing, so a screenful of scrolling inside one
 * paragraph does no React work at all — but it is **not** free, and an earlier
 * draft of this sentence said "a rect read per frame" and was wrong by a factor
 * of the article's length. `measureRow` reads the rect of *every* row, so it is
 * a few hundred reads per frame on a long article. Nothing writes between them,
 * so there is no layout thrash and the cost is small; it is stated because the
 * cheaper version — the tops are monotonic, so a binary search would do it in
 * nine — is available if it ever shows up in a profile, and because a second
 * private idea of the reading line is a price this app has decided not to pay
 * (keynav.ts § measureRow). ⟨Sol⟩, 2026-08-31.
 *
 * **A reflow is heard through the table, not through a key.** Scrolling is not
 * the only thing that puts a different row under the reading line: a column
 * toggle, the spine going away, a resize, a late image, a font swap all rewrap
 * the article without moving the page one pixel, and a measurement taken before
 * one of them describes a page that no longer exists with nothing downstream
 * able to tell. So a `ResizeObserver` watches the article's own table, which is
 * the element all of those resize.
 *
 * **`useColumnContext` takes a `layoutKey` prop as well as observing, and this
 * deliberately does not.** That key is App.tsx's string of the reader's own
 * choices, and it cannot see a late image or a font swap — which is why that
 * hook needs the observer too, and which makes the observer the load-bearing
 * half. Every reflow the key describes changes the table's box, so the observer
 * already hears them; threading a prop through two components to hear them
 * twice is a part touching another part for nothing. Sol pushed for the key at
 * the plan stage and for the observer on the built code; this keeps the one
 * that subsumes the other. If a reflow ever turns up that moves the rows
 * *inside* a table whose box has not changed, the key is what to add.
 *
 * **This is the mark's row, not the step's.** A press reads the page there and
 * then (`stepFrom` in the panel), because state is at best one frame behind and
 * a button must not step from where the reader was last time the browser
 * painted.
 *
 * **`assume` is how a press moves the mark without waiting to be told.** Every
 * other route into this state is a measurement, and a measurement costs a
 * frame: the press scrolls, the scroll event fires, a frame runs, the row
 * lands. Watched in a browser on 2026-08-31 that showed as a readout a press
 * behind — `9, 10, 10, 12, 12, 14` over six presses of ↓, each of which had in
 * fact moved the article exactly one paragraph — and as the same block reading
 * `9 / 145` when opened directly and `10 / 145` when stepped onto. A press is
 * the one case where the answer is known before the page has moved, because we
 * are the ones moving it. The next measurement overwrites it either way, so an
 * interrupted jump corrects itself rather than leaving a lie on screen.
 */
function useReaderRow(enabled: boolean): [number | null, (row: number) => void] {
  const [row, setRow] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      /* Back to `?at=` rather than the last row measured before the toggle:
         a stale number is worse than a coarse one, because nothing later can
         tell it is stale. */
      setRow(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      setRow(measureRow());
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    /* The article's own table, which is the element every row lives in — found
       through a row rather than by a class, because that is the selector
       `measureRow` itself uses and the two must be looking at the same table.
       `ResizeObserver` is absent in some test DOMs, hence the guard. */
    const table = document.querySelector("tbody tr[data-block]")?.closest("table") ?? null;
    const ro = table && typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (table && ro) ro.observe(table);
    /* The first measurement of all: arriving at a picture is not a scroll, and
       the mark has to be right before the reader touches anything. */
    measure();
    return () => {
      window.removeEventListener("scroll", schedule);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  /* Gated on `enabled` so a press on a picture reading `?at=` does not set state
     nothing will read — the return below would throw the value away, and the
     render would happen anyway. */
  const assume = useCallback(
    (next: number) => {
      if (enabled) setRow(next);
    },
    [enabled],
  );
  return [enabled ? row : null, assume];
}

export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks, axis, onAxis, hue, onHue }: Props) {
  useRenderCount("DiagramPanel");
  /**
   * **Nothing is collapsed, and nothing can be.**
   *
   * This was a `useState` set of the nodes the reader had closed, and the only
   * two ways into it were the chevron on a Tree row and the ← / → keys. Tree was
   * cut on 2026-08-30, and Force — the one picture left that draws a hierarchy —
   * hands every node `hasChildren: false` (diagram-d3.ts § the bubbles), which
   * both key branches require. So the set could never gain a member, and a
   * `useState` nothing can set is state in name only.
   *
   * **Kept as a constant rather than deleted**, because `walk`, `buildGraph`
   * and `DiagramOptions` all take it and all still honour it — the capability is
   * theirs, and it is the panel that has nothing to drive it with. Giving them
   * back a real set is one `useState` away for whichever picture grows a way to
   * fold something.
   *
   * ⟨Sol⟩ found the claim that ← and → still fold on Force, which was written
   * here in the same change that made it false. Believing a comment about a
   * field two modules away is how it got written; `hasChildren: false` is one
   * grep and settles it.
   */
  const collapsed = NOTHING_COLLAPSED;
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

  /**
   * **All three are dropped when the picture changes, because all three name a
   * node that no longer exists.**
   *
   * Every one of them is cleared by an event on the SVG — pointer-leave, blur —
   * and a picture that is *removed* fires neither. Pressing Sketch takes the
   * whole subtree away (§ Sketch replaces everything below the chips) and so
   * does the browser's Back button, so the pointer can leave a node by having
   * the node deleted underneath it. What was left behind was not cosmetic:
   * `hovering.current` is `hover !== null`, and the follow-scroll effect below
   * does nothing while it is true — so one hovered dot, one press of Sketch, and
   * the picture silently stops keeping up with the reader for the rest of the
   * session. ⟨Sol⟩, 2026-08-30, reviewing the callback-ref fix; the same class
   * of bug one variable over.
   *
   * `rovingId` already repairs the *tab stop* against the drawn nodes, which is
   * why this was survivable at all — but it repairs a derived value, and
   * `picked` reads the raw `roving`.
   */
  /* **`kind` is a trigger, not a value this reads**, which is the one thing a
     linter objects to here — `useExhaustiveDependencies` calls it an unnecessary
     dependency and offers to remove it, and taking that fix would leave an
     effect that runs once and clears nothing on any later press. The same shape,
     and the same reason, as the `attempt` counter in useProjection.ts. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above — `kind` is the trigger, and the offered fix silently disables this
  useEffect(() => {
    setHover(null);
    setRoving(null);
    setHasFocus(false);
  }, [kind]);

  const scroller = useRef<HTMLDivElement | null>(null);

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
  /**
   * **A callback ref, because the element it measures is not always there.**
   *
   * This was a `useLayoutEffect` with `[]` deps reading `scroller.current`, and
   * that is only correct while the scroller is in the *first* render. Sketch
   * arrived on 2026-08-30 and replaces everything below the chips, this element
   * included — so a panel whose first render was a Sketch measured a `null`
   * ref, returned early, and with empty deps never ran again. Pressing Drift or
   * Trail afterwards left `box` at `null` for good, which is the `diag-measuring`
   * branch: an empty `<div>`, no spinner, no words, and a strip above it
   * cheerfully reporting a projection that had landed. Reproduced on production
   * the same day; `tests/diagram-panel-hover.test.tsx` § switching away from
   * Sketch holds it.
   *
   * A callback ref fires **when the element mounts, whenever that turns out to
   * be** — so the observer is attached to the element that exists rather than to
   * the one that existed at mount. The measure stays synchronous inside it for
   * the reason below, and the whole teardown moves in here with it.
   *
   * **It returns a cleanup rather than waiting to be called with `null`.** Both
   * work today; only one of them is the contract. React documents the
   * null-on-detach call as backward compatibility it intends to remove, and a
   * ref that returns a cleanup is never called with `null` at all — so the
   * observer's release is tied to *this* attachment rather than to a second
   * invocation we would be relying on. ⟨Sol⟩, 2026-08-30. (`SketchView.tsx`'s
   * two callback refs still take the older shape; that is its file to change.)
   *
   * `useCallback` with `[]` is load-bearing: a new function identity on every
   * render would make React detach and reattach the ref each time, which is a
   * disconnect and a fresh `ResizeObserver` per render.
   */
  const attachScroller = useCallback((el: HTMLDivElement | null) => {
    /* Unreachable while the cleanup below is returned — React calls a ref with
       `null` only when it was given nothing to clean up. Handled rather than
       asserted, because which of the two shapes React uses is React's decision
       and not one this component should fall over. */
    if (!el) return;
    scroller.current = el;

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

    /* **The first measure is synchronous, and that is the whole point of doing
       it here rather than on a frame.** It used to go through
       `requestAnimationFrame` like the resize path below, and rAF DOES NOT RUN
       IN A BACKGROUND TAB —
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
      /* Only if it is still ours. A cleanup runs after the *replacement* ref
         has been attached in some orders, and clearing unconditionally would
         blank a `scroller.current` that already points at the live element —
         which is the follow-scroll effect's only way to find the picture. */
      if (scroller.current === el) scroller.current = null;
    };
  }, []);

  /**
   * **Is there an article to draw at all?**
   *
   * Both paid hooks below are gated on this as well as on their picture, and
   * that became necessary the moment Force stopped being a picture you had to
   * ask for. `tree` was the default until 2026-08-30 and cost nothing, so an
   * article with an unusable tree opened this mode, printed "no usable tree"
   * and bought nothing. With Force as the default the same article would POST
   * for embeddings — spending money on a picture the panel is *at that moment*
   * telling the reader it cannot draw. ⟨Sol⟩, 2026-08-30.
   *
   * A gate on the input rather than on the message: the branch that prints the
   * sentence is 600 lines below, and a hook's `enabled` argument is the only
   * place a fetch can be prevented rather than wasted.
   */
  const drawable = root !== null;

  /* **Built only when a graph picture is on.** Counting terms over a whole
     article is cheap — a few milliseconds for sixty sections — but it is not
     free, and two of the three pictures never look at it. Same reasoning that
     keeps `DiagramBand` from fetching anything: a reader on a scatter should
     not pay for the graph. */
  const wantsGraph = NEEDS_GRAPH.has(kind);
  /* **Only Force, and only Force.** This is the one thing the panel asks the
     server for, it costs a model call the first time, and it is the only fetch
     in the reading view a reader can start without pressing something that says
     what it will do. So the gate is narrow on purpose: `force`, which is the
     picture Greg asked to put the dotted lines on, and nothing else. See
     useSimilar.ts. */
  const similar = useSimilar(slug, drawable && kind === "force");
  const graph = useMemo(
    () => (root && wantsGraph ? buildGraph(root, blocks, collapsed, similar.pairs) : null),
    // `wantsGraph`, NOT `kind`: there were three graph pictures when this was
    // written, and stepping between them did not change the graph — keying on
    // `kind` rebuilt the whole term index on every one of those presses, 100ms
    // of main thread on a 150-section article for a result byte-identical to
    // the one just thrown away. GPT Sol's finding, 2026-08-27. Only Force is
    // left, so the two now coincide; the boolean stays because it says what the
    // dependency actually is.
    //
    // `similar.pairs` is a *stable* array — the hook hands back the same one
    // until a new answer lands — so this rebuilds exactly twice per article:
    // once immediately without the embeddings, once when they arrive.
    [root, wantsGraph, blocks, collapsed, similar.pairs],
  );

  /* **The two scatters, and only those two.** Same narrow gate as `similar`
     above and for the same reason: this costs a model call the first time, and
     pressing a toggle is not a purchase decision. **A whole one, not a share**:
     this said the server pooled the vectors between the two endpoints so Force
     paid for them once, which is what `src/article-vectors.ts` exists for and
     is not wired up — `similar.ts` still embeds the article itself, so a cold
     Force → Drift buys them twice. ⟨Sol⟩, 2026-08-30. See useProjection.ts. */
  const wantsPoints = NEEDS_POINTS.has(kind);
  const projection = useProjection(slug, drawable && wantsPoints);

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

  /* **Whether a scatter has anything to draw yet**, which is exactly the
     condition `layoutDiagram` returns null on. Since 2026-08-30 no picture
     stands in for another, so this and `layout !== null` say the same thing for
     the two scatters — both are kept because this one is also what the strip
     and the legend below are gated on, and those render outside the scroller
     where there is no layout to ask. */
  const drawingPoints = wantsPoints && projection.points.length > 0;
  const flat = drawingPoints;
  const ramp = drawingPoints && hue === "progress";

  /**
   * **Where the reader is, for everything this panel draws** — the mark, the
   * you-are-here line and the readout.
   *
   * Measured on a picture made of paragraphs, and `?at=` on every other — see
   * `useReaderRow`. `atRow` is also the fallback for the moment before the
   * first measurement and for a reader who has not scrolled at all.
   *
   * **A press does not use this**, and that is deliberate rather than an
   * oversight: `stepFrom` measures the page there and then, or takes the row
   * its own last press aimed at. State is a frame behind and a chain is not
   * state at all.
   */
  const [measuredRow, assumeRow] = useReaderRow(drawingPoints);
  const readerRow = measuredRow ?? atRow;

  /**
   * **Where the reader is, and where the mark goes, are two answers** — and on
   * the two scatters they part company inside the apparatus.
   *
   * Both pictures plot the argument and nothing else, and both already say so:
   * `bodyRowOf` asks the *block* rather than the range, so a reader three
   * endnotes deep gets `nowY: null` and no line (scatter.ts). But a dot's range
   * is stretched to tile the article, and a note stranded in the middle of the
   * body falls inside one — so `nodeAt` would happily light that dot, brighten
   * Trail's chain around it, put its card up as "you are here" and count it in
   * the readout, all while the line the same picture draws had honestly
   * withheld itself. Two parts of one picture disagreeing about whether the
   * reader is in it. ⟨Sol⟩, 2026-08-31.
   *
   * So the mark takes the same predicate the line already used, and the ladder
   * keeps the raw row: a press should step from where the reader physically is,
   * even when that is somewhere the picture cannot draw them.
   */
  const inApparatus =
    drawingPoints && readerRow !== null && !isBody(blocks[readerRow] ?? {});
  const markRow = inApparatus ? null : readerRow;

  /* The three most distinctive words in each topic, for the lane legend.
     Computed here rather than on the server: it reuses `terms()`, which is the
     app's one idea of what a distinctive word is, and it costs one pass over
     text the browser is already holding. */
  const lanes = useMemo(
    () => (wantsPoints && projection.k > 0 ? laneTerms(projection.points, blocks, projection.k) : []),
    [wantsPoints, projection.points, projection.k, blocks],
  );

  /* Words per block, as a prefix sum. Nothing draws a to-scale axis since
     `strata` was cut, so no picture reads this today — it is still computed
     because it is one pass over an array we already hold, and because
     `DiagramOptions.wordsBefore` is how any future axis would mean words
     rather than blocks. */
  const words = useMemo(() => wordsBefore(blocks), [blocks]);

  /* `force` returns `nowY: null` and never reads `atRow`, so for it this was a
     dependency nobody looked at — and `atRow` changes every time the reader
     scrolls into a new section.

     That made scrolling with Force open re-run the whole layout, which is a
     300-tick d3 simulation measured at 39ms on a 60-section article and 113ms
     at 150, to produce a picture identical to the one just discarded: a hitch
     per section, all the way down a long article. Force is also the expensive
     layout, so excluding it is where the whole saving is.

     `drift` and `trail` keep it — see `NEEDS_AT_ROW` above, and note that the
     first version of this left both of them out. GPT Sol's finding,
     2026-08-27.

     **The saving got bigger on 2026-08-31**, when `readerRow` started being
     measured per paragraph rather than read off `?at=` per section: excluding
     Force here is now what keeps the simulation off a value that changes a
     dozen times a screen. It is also why `useReaderRow` is gated rather than
     always on — Force is not merely uninterested in the finer row, it must not
     be handed it. */
  const followsReader = NEEDS_AT_ROW.has(kind) ? markRow : null;
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

  /**
   * **`drawnKind` was here, and its removal is the point of this change.**
   *
   * A picture with no data used to be handed `layoutTree`, so the toggle that
   * was pressed and the picture on screen were two different things, and every
   * branch in this file had to remember which one it wanted. Twice it did not:
   * the SVG's class and `NodeShape`'s branch both read `kind`, so the fallback
   * came out as Tree geometry wearing Drift's stylesheet —
   * `.diag-drift .diag-box { fill: transparent; stroke: none }` erased every
   * row and no `.diag-drift .diag-label` font size exists, so the labels
   * painted at the browser default. A picture that said "the picture below is
   * the Tree instead" and then drew a broken one, with nothing thrown and
   * nothing logged. GPT Sol found it on the built code on 2026-08-27, and it
   * had been live in the round before that too, with `strata` in Tree's place.
   *
   * `layoutDiagram` returns null instead now (diagrams.ts), the scroller shows
   * a spinner or the error, and `kind` is the only answer to "which picture is
   * this" — so the class of bug has nowhere left to live.
   */

  /* The node the reader is standing in — the deepest one drawn, which is the
     same rule the summary panel's follow mark uses. Computed from the LAID OUT
     nodes rather than from the tree, so a closed section's mark lands on the
     closed section rather than vanishing. */
  const here = useMemo(() => nodeAt(layout?.nodes ?? [], markRow), [layout, markRow]);

  /**
   * **The sequence chain, graded by how far each line is from the reader.**
   *
   * Greg, 2026-08-30: *"making the connections directly either side of the
   * current node most prominent. Then a bit fainter for the ones at one remove,
   * then a bit fainter for the ones at two removes, etc etc."*
   *
   * Here rather than in either layout, and centred on `here` rather than on
   * `shown`. `here` is where the reader is *standing*; `shown` follows the
   * pointer, and a chain that re-centres itself under the mouse would stop
   * being a position readout the moment you tried to read anything else with
   * it. The one place in this panel where hover deliberately changes nothing.
   *
   * Memoised on the layout and on `here`, which between them are the only two
   * inputs — so scrolling within one section costs nothing, and crossing into
   * the next costs one walk of the chain.
   */
  const nearness = useMemo(() => chainNearness(layout?.links ?? [], here), [layout, here]);

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

  /* The article's block → row index, which the step ladder needs to turn a
     node's `blockId` into a position. One pass over an array already held, and
     memoised on it, so it costs nothing per press. */
  const rowOf = useMemo(() => new Map(blocks.map((b, i) => [b.id, i])), [blocks]);

  /**
   * The ladder the ↑ / ↓ buttons walk — **and which ladder depends on what the
   * picture is made of.**
   *
   * A picture of sections steps by the rows it draws (`stepStops`); a picture
   * of paragraphs steps by the article's paragraphs (`paragraphStops`), because
   * a short paragraph gets no dot and is still somewhere the reader is
   * standing. Both files' headers carry the reasoning; the switch is here
   * because `drawingPoints` is the panel's own word for "this picture is made
   * of paragraphs", and it is the same flag `unit` reads below — so the label
   * and the ladder cannot come apart.
   */
  const stops = useMemo(
    () =>
      drawingPoints
        ? paragraphStops(blocks, layout?.nodes ?? [])
        : stepStops(layout?.nodes ?? [], rowOf),
    [drawingPoints, blocks, layout, rowOf],
  );
  const starts = useMemo(() => stops.map((s) => s.row), [stops]);

  /* Where in that ladder the reader is standing, 1-based, for the readout
     between the two buttons. The same arithmetic the reading-position code
     uses, over rows rather than pixels.

     **Zero means "not on the ladder at all"**, which the readout draws as "—".
     That is the apparatus, and it is a fact worth stating rather than rounding
     to the nearest paragraph of the argument — the same answer the you-are-here
     line gives by not being drawn. Not knowing yet is a different thing and
     still falls back to the first rung: the reader is somewhere, we just have
     not measured. */
  const rowForRung = readerRow ?? starts[0] ?? 0;
  const rung =
    starts.length === 0 || inApparatus ? 0 : activeSectionIndex(starts, rowForRung) + 1;
  /**
   * What one press moves by, in the reader's own words — **read off what is
   * drawn rather than off which toggle is pressed.**
   *
   * "Section" was hardcoded for everything that was not a scatter, which is
   * wrong twice: an article with no sub-sections, or one whose parts the reader
   * has folded away, steps by **part** while the button still says section.
   * A label that is confidently wrong about the unit is worse than no label,
   * because the readout beside it is a count of exactly that unit. GPT Sol's
   * finding, 2026-08-27.
   */
  const deepest = (layout?.nodes ?? []).reduce((d, n) => Math.max(d, n.depth), 0);
  const unit = drawingPoints ? "paragraph" : deepest >= 2 ? "section" : "part";

  /**
   * **The row a press steps from** — the page, measured now, except while our
   * own last press is still landing, when it is where that press was going.
   *
   * Two rules, and both of them are keynav.ts's rather than a second opinion:
   *
   * **Measured at press time, not read out of `readerRow`.** That value is
   * React state a frame behind the world at best, and a button that steps from
   * where the reader was when the browser last painted is the bug this whole
   * change is fixing, in miniature. A press is a discrete event; it can afford
   * one measurement.
   *
   * **And chained, because scrolling is animated.** `scrollToBlock` glides for
   * `SCROLL_MS`, firing exactly the scroll events a hand would, so a second
   * press mid-flight measures a row half way between two rungs and lands short
   * — two presses, one rung of movement. So the row the last press *aimed at*
   * stands for `CHAIN_MS`, which is the glide plus a margin, and after any real
   * pause the world is measured afresh.
   *
   * **A timer rather than `glideTarget()`, which was the first attempt.** The
   * glide clears its own handle in the same tick as its final `scrollTo`
   * (scroll.ts § tick), so between that and the scroll event it causes there is
   * a gap where nothing is in flight and the measurement is still mid-air. A
   * press in the gap steps from the wrong row, rarely and invisibly. ⟨Sol⟩,
   * 2026-08-31. The timer has no gap, and `CHAIN_MS` is already the constant
   * for exactly this.
   *
   * The reader taking the page back drops it, on the same two events
   * `scroll.ts`'s own `bail` listens for. **Not `pointerdown`**, which keynav
   * can afford to include and this cannot: here the press *is* a pointerdown,
   * so dropping on it would clear the chain a moment before every click that
   * sets one.
   */
  const chain = useRef<number | null>(null);
  const chainTimer = useRef(0);
  useEffect(() => {
    /**
     * **Anything the reader does that is not another press of these buttons
     * ends the chain** — and the exception, rather than the rule, is what took
     * two goes to get right.
     *
     * The first version dropped on `wheel` and `touchstart` unconditionally.
     * ⟨Sol⟩, 2026-08-31: on an iPad every tap *is* a `touchstart`, so the
     * second tap of a rapid pair cleared the chain a moment before the `click`
     * that wanted it — reintroducing the race on the one device these buttons
     * were built for, while the test passed because `button.click()` fires no
     * touch. The rule is therefore about *where* the gesture landed, not which
     * gesture it was, and with that in hand the list can be the wide one:
     * a scrollbar drag and PageDown fire neither `wheel` nor `touchstart`, and
     * both leave the reader somewhere the last press knows nothing about.
     *
     * It also covers every jump out of this panel that is not a step — a click
     * on a dot, the footer card, the picture's own arrow keys — because each
     * of them begins with a pointer or a key outside this bar. One rule rather
     * than a wrapper round `onJump` as well, which was the first attempt and is
     * the version that goes stale the next time something new can jump.
     */
    const drop = (e: Event) => {
      if ((e.target as Element | null)?.closest?.(".diag-step")) return;
      chain.current = null;
      window.clearTimeout(chainTimer.current);
    };
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      window.addEventListener(type, drop, { passive: true });
    }
    return () => {
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
        window.removeEventListener(type, drop);
      }
      window.clearTimeout(chainTimer.current);
    };
  }, []);
  const stepFrom = (): number => chain.current ?? measureRow();

  /**
   * One step through the article, and the picture follows because it is drawn
   * from the same row.
   *
   * `stepTarget` is **keynav.ts's**, not a second copy of the rule: ↓ is always
   * the next item, and ↑ part-way into an item goes to the top of the item you
   * are in before it steps back. That is the track-skip rule from every music
   * player (docs/project/keyboard.md), and having these buttons disagree with
   * the arrow keys about what ↑ means would be worse than not having them.
   */
  const stepTo = (dir: -1 | 1) => {
    const row = stepTarget(starts, stepFrom(), dir);
    if (row === null) return;
    /* The stop carries its own block, rather than this asking `nodeAt` again.
       Two lookups of the same fact is how they come to disagree — and on a
       scatter they did: the ladder's row and the block that row jumps to are
       different numbers there (diagram.ts § stepStops). */
    const stop = stops.find((s) => s.row === row);
    if (!stop) return;
    setRoving(stop.id);
    /* The mark moves now rather than a frame later, when the scroll this is
       about to start gets measured — see `assume` in `useReaderRow`. */
    assumeRow(row);
    chain.current = row;
    window.clearTimeout(chainTimer.current);
    chainTimer.current = window.setTimeout(() => {
      chain.current = null;
    }, CHAIN_MS);
    onJump(stop.blockId);
  };
  /**
   * Whether that press would go anywhere, for the greyed-out look.
   *
   * **The chain first, exactly as `stepFrom` does**, and then the last measured
   * row rather than a fresh measurement: this runs on every render, and
   * `measureRow` reads a rect per row of the article.
   *
   * The chain is the half that matters, and leaving it out was a bug ⟨Sol⟩
   * found: it does not clear when the scroll-derived state catches up, it
   * clears on a timer, so a Previous that had just stepped off the first rung
   * went on announcing itself unavailable while working, and a Next that had
   * just landed on the last rung went on looking live while doing nothing —
   * for as long as the reader kept pressing. Reading a ref in render is
   * ordinarily how you get a value nothing re-renders for; here the press that
   * writes it also calls `setRoving`, so a render always follows.
   */
  const canStep = (dir: -1 | 1) =>
    starts.length > 0 && stepTarget(starts, chain.current ?? rowForRung, dir) !== null;

  /* The pointer's position, mirrored into a ref so the follow-scroll below can
     read it without re-running every time the pointer leaves the picture. */
  const hovering = useRef(false);
  hovering.current = hover !== null;

  /**
   * **The picture scrolls to keep up with the reader.**
   *
   * Without this the mark moves and the row it is on can be two screens up
   * inside `.diag-scroll`, which on a long `tree` is the whole picture doing
   * nothing while the article moves. Same idea as the summary panel following
   * the reader (docs/project/summaries.md), and the same two rules: it keys on
   * the *target* rather than on scroll events, so it never has to ask whether a
   * scroll was ours or theirs, and it does nothing while the pointer is in the
   * picture — a reader comparing two bands must not have one of them slide out
   * from under the pointer.
   *
   * It also does nothing when the row is already comfortably in view, which is
   * most presses. Nudging a row that is fine is how a panel ends up in a slow
   * permanent drift.
   *
   * `hovering` is a **ref** rather than a dependency on purpose: reading it at
   * fire time is what keeps `hover` out of the dependency list, and `hover` in
   * the list would re-run this every time the pointer left the picture — which
   * is exactly the scroll this is trying not to do.
   */
  useEffect(() => {
    if (here === null || hovering.current) return;
    const el = scroller.current;
    /* **The line where there is one, the node where there is not**, and on
       Drift that is the difference between following the reader and following
       the nearest dot. Drift's `nowY` moves with every paragraph; `here` moves
       only when a *dot* changes, and a long run of paragraphs too short to
       place is one dot. Keying the scroll on the node alone let the line — the
       thing the reader is actually watching — walk off the bottom of the
       scroller while the picture sat still. ⟨Sol⟩, 2026-08-31.

       The other two pictures have no line, and there the node is the mark, so
       the same two lines of code do the right thing for all three. */
    const nowY = layout?.nowY ?? null;
    const g =
      (nowY === null ? null : el?.querySelector<SVGLineElement>("line.diag-now")) ??
      el?.querySelector<SVGGElement>(`[data-diag-id="${here}"]`);
    if (!el || !g) return;
    const box = g.getBoundingClientRect();
    const view = el.getBoundingClientRect();
    const margin = 12;
    if (box.top >= view.top + margin && box.bottom <= view.bottom - margin) return;
    const top = el.scrollTop + (box.top - view.top) - (view.height - box.height) / 2;
    /* **`scrollTo` is not everywhere, and its absence throws.** The DOM this
       renders into under test has `scrollTop` and no `scrollTo` at all, and an
       unguarded call took the whole panel down inside a passive effect — five
       red tests for a scroll nobody was asserting. Assigning `scrollTop` is the
       older API and is universal; it just jumps rather than glides, which is
       the right thing to lose. */
    if (typeof el.scrollTo === "function") el.scrollTo({ top, behavior: "smooth" });
    else el.scrollTop = top;
    /* `layout` rather than `layout.nowY`, because the element this reads is
       drawn by the render `layout` produced — depending on the number alone
       would let a fresh picture keep an old scroll position. */
  }, [here, layout]);

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
   *
   * **↑ and ↓ move the article as well as the tabstop**, which is not what the
   * tree pattern says and is what Greg asked for: *"make sure the up/down
   * buttons work, so that we can use the keyboard to move up/down blocks in the
   * text and also follow the progression in the diagram"* (2026-08-27). The
   * pattern's own answer is that arrows move focus and Enter activates, and
   * that is right for a file tree, where activating means opening something
   * you cannot undo. Here activating means scrolling — the cheapest, most
   * reversible thing this app does — so following focus costs nothing and turns
   * the picture into something you can read the article *with* rather than
   * something you read and then leave. It is the documented follow-focus
   * variant, and the pattern the gist columns beside this panel already use.
   *
   * ← and → do **not** follow, on the two pictures where they mean open and
   * close: folding a part away is a statement about the picture and should not
   * move the reader out of the paragraph they are in. On the two scatters,
   * where sideways is just another word for a step, they do.
   */
  const onKeyNav = (e: React.KeyboardEvent, node: DiagramNode) => {
    const i = nodes.findIndex((n) => n.id === node.id);
    /** Move the tabstop only — for the sideways keys, which mean structure. */
    const step = (d: number) => rove(nodes[Math.min(nodes.length - 1, Math.max(0, i + d))]?.id ?? null);
    /**
     * Move the tabstop and take the article with it.
     *
     * **The keypress is what stops the two from fighting.** `onJump` scrolls
     * the prose, which moves `?at=`, which moves `here` — and the window-level
     * ↑ / ↓ handler in keynav.ts would *also* have stepped the article, by a
     * section, at the same time as this steps it by a node. Two different
     * distances from one press. The `preventDefault()` at each call site is
     * what keynav now checks for; see its `defaultPrevented` guard.
     *
     * **It only jumps when the jump would go somewhere**, and that guard is
     * not a micro-optimisation. Arrowing moves by *node*, which is what a tree
     * widget must do — a reader has to be able to reach a part and its first
     * section separately, and those two begin on the same block. `jumpTo`
     * (App.tsx) **pushes a history entry**, so without this, three presses at
     * the top of a tree cost three presses of Back and move the article
     * nowhere. Found by GPT Sol in review of the built code, 2026-08-27.
     *
     * The buttons under the picture are the control that never does nothing:
     * they step by distinct row rather than by node, which is exactly this
     * problem solved the other way (diagram.ts § stepStops).
     */
    const follow = (d: number) => {
      const next = nodes[Math.min(nodes.length - 1, Math.max(0, i + d))];
      if (!next) return;
      rove(next.id);
      if (next.blockId !== node.blockId) onJump(next.blockId);
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        follow(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        follow(-1);
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
        // the same step as down — which is what a listbox promises, and it
        // follows the reader for the same reason down does.
        if (flat) follow(1);
        // preorder: the next node IS the first child. The branch that opened a
        // closed parent was here and went with the collapse set above — nothing
        // in this mode can close one any more.
        else if (node.hasChildren) step(1);
        return;
      case "ArrowLeft": {
        e.preventDefault();
        if (flat) {
          follow(-1);
          return;
        }
        // Walk back to the nearest shallower node — the parent, in preorder.
        // Closing an open parent was the branch above this one; see `collapsed`.
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
      <div className="band-head">
        <Network size={14} className="band-head-icon" />
        <h2>Diagram</h2>
        {/* **The scatter's caveat lives in this row, and the reason is that this
            row cannot wrap.** It was four lines of prose above the picture until
            2026-08-30 — Greg: *"It uses up valuable vertical real estate. Hide it
            behind a tooltip or warning icon or something."*

            It went onto the controls strip first, and that was wrong twice over
            in a way worth writing down, because two of us checked it and both
            checked the wrong thing. `.diag-opts` wraps, and **an auto margin
            right-aligns an item on the line it lands on without stopping it
            starting a new one** — so the first version's "costs no height" was
            false. Nesting the chips in an inner box fixed *which* item wrapped
            and not *whether* a line was spent, because the binding constraint is
            **total intrinsic width**, not alignment: at the ideal band width
            Drift's two chip groups and this icon do not fit on one line, so one
            of them wraps whatever the alignment rules say.

            This row is `display: flex` with no `flex-wrap`, so it cannot wrap at
            all — items shrink instead — and `h2 { flex: 1 }` already pushes a
            third child to the right. The claim is now a property of the markup
            rather than a measurement that happened to hold at the two widths
            somebody looked at.

            **And that is the part to keep.** Both checks that missed it
            confirmed the *absence of the old wording* rather than the truth of
            the new: one measured Drift at its narrowest (where the chips already
            wrap, so the icon rides free) and Trail at its widest (one chip group,
            so it fits), and never the combination that costs a line. Found by a
            browser sweep, 2026-08-31. */}
        {drawingPoints && projection.status === "ready" && (
          <ScatterNote projection={projection} />
        )}
      </div>

      {/* One tab stop, arrows inside — the radio pattern, and the same shape
          Dock.tsx's mode switcher already has. Three tab stops was the version
          this had first, and it is a role describing a widget the code does not
          implement. Found by GPT Sol, 2026-08-26.

          **Each button carries a hover card rather than a `title`**, on Greg's
          ask: *"add tooltips when hovering over each Diagram button to explain
          how it works"* (2026-08-27). The card says two things — what the
          picture shows, and where it comes from — because three of these four
          spend a model call the first time they are drawn, and a row of chips
          where one press is free and the next one bills you should say so
          before the press rather than after it. `TooltipGroup` makes the
          neighbours open instantly once one is open, so reading along the row
          is one gesture rather than four waits. */}
      <div className="diag-kinds" role="radiogroup" aria-label="Which diagram">
        <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
          {DIAGRAMS.map((k) => {
            const ui = KIND_UI[k];
            const Icon = ui.icon;
            return (
              <Tooltip
                key={k}
                placement="bottom"
                /* The card is wider than a chip, and the leftmost chips sit
                   near the window's edge — without this the card is thrown
                   onto the cross axis and lands on top of the chips beside it,
                   which are exactly the ones the reader is reading along
                   towards. Found in a browser, 2026-08-27; Tooltip.tsx
                   § keepSide has the measurement. */
                keepSide
                className="tip-soon"
                content={<ControlTip head={ui.label} what={ui.blurb} how={ui.how} />}
              >
                {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern, and the same call Dock.tsx and SearchPanel.tsx already make — a real <input type="radio"> cannot carry an icon beside its label, and styling one to match means hiding the input and faking every state it already had */}
                <button
                  type="button"
                  role="radio"
                  aria-checked={k === kind}
                  /* **Every chip its own tab stop, and no arrow keys** — the
                     roving tabindex and its arrow handler went on 2026-08-31.
                     The arrows belong to the article on this page (↑ / ↓ step
                     it, ← / → choose the stride: keyboard.md), and this handler
                     called `preventDefault` inside a group that also
                     `stopPropagation`s, so all four went dead while a chip had
                     focus. Greg met it as a bug.

                     It matters more here than in the bottom bar, and that is
                     the reason this one is written up rather than just deleted:
                     the third chip is the **sketch**, and selecting it now
                     starts a job on its own (docs/plans/260831ai-…) — 121–194
                     seconds and about $0.20. An arrow press must not be able to
                     buy that. Dock.tsx § DockModes has the full reasoning and
                     the cost of the tab stops;
                     tests/arrows-belong-to-the-article.test.tsx holds it. */
                  tabIndex={0}
                  className={`diag-kind${k === kind ? " on" : ""}`}
                  onClick={() => onKind(k)}
                  data-diag-kind={k}
                >
                  <Icon size={12} />
                  {ui.label}
                </button>
              </Tooltip>
            );
          })}
        </TooltipGroup>
      </div>

      {/* **Sketch replaces everything below the chips, rather than adding a
          branch to each of them.** The three pictures above are one
          `DiagramLayout` and every control under here is about it — the axis
          chips, the step bar, the footer card, the roving tabstop. A Sketch has
          none of those things and has its own. Splitting once, here, is what
          keeps the other three unbraided; src/web/SketchView.tsx says the rest.

          The hooks above still run and cost nothing: `useSimilar` and
          `useProjection` are already gated on the kind that wants them, so
          pressing Sketch spends no money on the pictures the reader is not
          looking at. */}
      {kind === "sketch" ? (
        <SketchView slug={slug} blocks={blocks} atRow={atRow} onJump={onJump} />
      ) : (
        <>

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
                {
                  value: "lanes",
                  label: "Lanes",
                  blurb:
                    "One column per topic the model found, left to right by where the article gets to each. A subject the piece returns to is a second stack of dots in the same column, a long way further down.",
                  /* **Not “how central it is to its topic”**, which is what this
                     card said first and is a sentence `laneX` was rewritten to
                     stop being true: sideways inside a lane is the paragraph's
                     own first component, on the same scale Spread shows across
                     the whole band, so the two modes are two readings of one
                     number. ⟨Sol⟩ caught the falsehood coming back, having
                     caught it once in scatter.ts in August — the geometry looks
                     identical either way, which is exactly why a card about it
                     has to be checked against the code rather than the picture. */
                  how: "Inside a lane, sideways is the same number Spread uses, scaled to that lane — so the two are two readings of one measurement rather than two different pictures. The number of lanes comes from the article's length and is capped at eight, which is a fact about a 300px band rather than about the article.",
                },
                {
                  value: "spread",
                  label: "Spread",
                  blurb:
                    "Every paragraph on one sliding scale — the single biggest axis of variation in the article.",
                  how: "Honest about degree where Lanes is honest about grouping. Nothing more to buy: both are arithmetic over the same model call.",
                },
              ]}
            />
          )}
          <Choice
            label="Colour"
            value={hue}
            onChange={onHue}
            options={[
              {
                value: "section",
                label: "Section",
                blurb:
                  "The same eight hues the rest of the app uses, one per part of the article, reused round it.",
                how: "Positional, and it means nothing beyond it: the hue says these dots belong together, so the eye can group them without reading anything.",
              },
              {
                value: "progress",
                label: "Progress",
                blurb: "Dark at the start of the article, bright at the end.",
                how: "The one setting that answers “does this piece travel through its subject or circle back over it?” without following the chain — which on a long article is a web you cannot trace.",
              },
              {
                value: "topic",
                label: "Topic",
                blurb: "The model’s own grouping — one hue per topic, the same one the Lanes columns use.",
                how: "The way to see the grouping on Trail, which has no lanes to show it in. The words each topic was named after are in the legend under Drift.",
              },
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
            /* **A card, because one word is not a name.** The chip shows the
                lane's top word and the other two are the difference between a
                label a reader can argue with and one they have to take on
                trust — which is the whole reason the legend exists. A `title`
                held them and was unreachable on the device this band is
                narrowest on. */
            <Tooltip
              // The lane index IS the identity here — lane 3 is lane 3 whatever
              // words it happens to hold this time.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={i}
              placement="bottom"
              keepSide
              className="tip-soon"
              content={
                <ControlTip
                  head={`Column ${i + 1} of ${lanes.length}`}
                  what={
                    words.length > 0
                      ? `The paragraphs in this column are the ones about: ${words.join(", ")}.`
                      : "Nothing distinguishes this column's paragraphs from the rest — it is a group the arithmetic found and cannot name."
                  }
                  /* **“Unless nothing is left” is load-bearing.** A word in every
                     column scores zero and drops out — and when *every* word in
                     a column does, `laneTerms` falls back to raw frequency
                     rather than showing an empty chip, so the commonest word
                     really can appear. A card that promised otherwise would be
                     wrong on exactly the short single-subject article where the
                     legend is least useful. ⟨Sol⟩, 2026-08-30. */
                  how="The words are the ones most distinctive to this column rather than commonest in it, so a word that is everywhere in the article scores zero and drops out — unless nothing is left, in which case the commonest word stands rather than an empty chip. Columns run left to right by where the article gets to each topic."
                />
              }
            >
              {/* **A tab stop, for the same reason the step readout has one.**
                  `Tooltip`'s keyboard route is focus, and a plain `<li>` cannot
                  take it — so the two words the chip is too narrow to show were
                  reachable by pointer only, which is the failure the `title`
                  attribute already had here. ⟨Sol⟩, 2026-08-30. */}
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: see above — the tab stop exists so the card naming this column is reachable by keyboard */}
              <li className="diag-lane" tabIndex={0} style={hue === "topic" ? slotStyle(i) : undefined}>
                {words[0] ?? "—"}
              </li>
            </Tooltip>
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
      {kind === "force" && similar.status !== "idle" && (
        <p className="diag-note" role="status">
          {/* **The spinner, in the strip rather than over the picture.** Greg,
              2026-08-30: *"Make sure the diagrams in Diagram mode show loading
              spinners if they're generating."* Force is four fifths drawn while
              this call is in flight, so a spinner across it would say the wrong
              thing about what is missing — but a line of 10.5px grey that only
              changes its *words* when the answer lands does not read as work in
              progress either, it reads as a caption. Size 11 to sit on this
              strip's own line rather than doubling its height. */}
          {similar.status === "loading" && (
            <>
              <LoaderCircle className="cmt-spinner" size={11} aria-hidden="true" />
              Reading the article for related passages…
            </>
          )}
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
          {/* **The server's own words, for the reason the projection strip
              above gives.** This said "Could not reach the embedding model" for
              every failure, including the one that was actually happening for
              the whole of this feature's life in production — an account not
              allowed to use the model, which no amount of reaching would have
              fixed. It also threw away a bracketed code the reader could quote.
              ⟨Sol⟩, 2026-08-28. */}
          {similar.status === "error" && (
            <>
              {`There are no dotted lines, and the rest of the picture is unaffected. ${similar.error ?? "The reason did not come back."}`}{" "}
              {/* **A verb to go with the reason.** The fetch runs once from an
                  effect, so without this the reader has the failure on screen
                  and nothing to do about it — the only way back is to leave the
                  mode and come in again, which nothing says. Greg, 2026-08-30:
                  *"And/or a button to trigger generation if needed."* */}
              <TryAgain
                onClick={similar.retry}
                what="the dotted lines"
                how="One embedding call, and the picture you can already see is unaffected either way — the four other kinds of line never needed the server."
              />
            </>
          )}
        </p>
      )}

      <div className="diag-scroll" ref={attachScroller}>
        {root === null ? (
          <p className="diag-quiet">
            This article has no usable tree, so there is nothing to draw. Run <code>npm run hierarchy</code>{" "}
            for it and the picture appears.
          </p>
        ) : box === null || box.w === 0 ? (
          /* Before the first measure there is no width, and a diagram laid out
             against a guessed width would be visibly wrong for one frame. An
             empty box for one frame is the cheaper mistake — and it is a
             *different* thing from waiting for data, which is the branch below,
             which is why the two are told apart here rather than both falling
             out of `layout === null`. One frame of spinner would flash. */
          <div className="diag-measuring" aria-hidden="true" />
        ) : layout === null ? (
          /**
           * **Nothing to draw yet — a spinner or the reason, never another
           * picture.** Greg, 2026-08-30: *"just show a loading spinner or
           * error"*.
           *
           * Only the two scatters can reach this: Force needs no fetch to
           * draw. **And it is the only voice while it is on screen** — the
           * `.diag-note` strip above now says only what a *drawn* picture is,
           * so a reader is never told the same thing twice in two registers.
           *
           * `projection` is handed over **only when it is the thing being
           * waited for**. "Force cannot reach this" is a fact about today's
           * code, not a property of it — and the failure it would license is
           * the quiet kind: a picture that never asked for a projection,
           * telling the reader it is reading the article paragraph by
           * paragraph. A null here cannot say that.
           */
          <Waiting projection={wantsPoints ? projection : null} />
        ) : layout.nodes.length === 0 ? (
          /**
           * **A layout can arrive with nothing in it, and an empty `<svg>` says
           * nothing at all.**
           *
           * `layoutForce` returns a real layout with zero nodes when the graph
           * holds only its root — an article whose contents page is a single
           * entry, which is a shape the store really does hold. This branch did
           * not need to exist while `tree` was the default, because the Tree
           * drew that root as a row; Force draws only `depth > 0`, so making it
           * the default turned a thin picture into a blank band with a working
           * scrollbar and no explanation. ⟨Sol⟩, 2026-08-30.
           *
           * Separate from `Waiting` because it is not a wait: nothing is coming.
           * The reason is the article's own shape, so the sentence says that
           * rather than offering hope or a command to run.
           */
          <p className="diag-wait">
            There is nothing to place: this article has no sections inside it, so the picture has no
            bubbles to draw.
          </p>
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
               tree where it is a tree.** Force draws nested sections and
               honours the whole tree contract — levels, sibling counts,
               Left/Right meaning close and open; the two scatters draw 276
               paragraphs with no nesting and nothing to open, so claiming
               `tree` there would describe a widget this code does not
               implement. GPT Sol's finding, 2026-08-27. */
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
                   this must not change what they draw.

                   `diag-near-*` is the third, and only the sequence chain ever
                   gets one — see `nearness` above. It is absent, rather than set
                   to its faintest step, on every line the ramp does not reach
                   and on every line at all when the reader is nowhere; the
                   stylesheet's job is then to make the ramp's last step land on
                   what an unclassed chain already looks like. */
                className={`diag-link diag-d${l.depth}${l.kind ? ` diag-link-${l.kind}` : ""}${
                  nearness.has(l.id) ? ` diag-near-${nearness.get(l.id)}` : ""
                }`}
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

      {/* **↑ / ↓ as real buttons, big enough for a thumb.**
          Greg, 2026-08-27: *"add big up/down buttons for touch devices (e.g.
          iPad)"*. On a keyboard the arrows already do this — inside the picture
          they step a node and take the article with them, and anywhere else
          keynav.ts steps a section. On an iPad there are no arrows, and the
          panel's own hit targets are 6px tall, so the only way to walk the
          article from here was to hit dots one at a time.

          Under the picture rather than over it, for the reason the whole
          footer card is there: this band is a column of small things being
          compared against each other, and a floating control covers the
          neighbours that are the point of the comparison.

          The readout in the middle is not decoration — it is what says which
          unit a press moves by, which is the one thing that changes between
          pictures (a section on Tree and Force, a paragraph on the two
          scatters) and the one thing a pair of arrows cannot show.

          **The two buttons carry no hover card, and that is a removal.** They
          had one each, and Greg, 2026-08-31: *"the tooltip isn't that helpful
          and gets in the way, so get rid of them for the big Up/Down
          buttons"*. It gets in the way literally: the card opens upwards over
          the bottom of the picture, which is the part of the picture a reader
          reaching for these buttons is looking at. And what it said — that ↓
          moves on one paragraph — is what a downward chevron above a readout
          saying `12 / 47` already says. The readout keeps its card, because
          the one thing that is genuinely not guessable is what a press moves
          *by*, and that is the sentence the readout's card carries. */}
      <div className="diag-step">
        {/* **`aria-disabled`, not `disabled`.** At the ends of the article one
            of these does nothing, and it stays focusable rather than dropping
            out of the tab order between presses — a keyboard reader stepping
            to the last paragraph should not have focus vanish from under them.
            It keeps its greyed look, announces itself as unavailable, and the
            press does nothing: `stepTo` already returns when `stepTarget`
            gives no row, and `canStep` asks `stepTarget` the same question from
            the same place, so the button was never doing anything at the ends
            anyway. (The two can still differ by a frame outside a chain, where
            one measures the page and the other reads the last measurement —
            see `canStep`.)

            The original reason was stronger and is gone with the hover card —
            a `disabled` button fires no mouse events, so the sentence saying
            *why* it was dead was unreachable by the reader asking. Said
            plainly rather than left in place, because a comment that still
            claims a card exists is how the next person concludes one is
            missing. */}
        <button
          type="button"
          className="diag-step-btn"
          onClick={() => stepTo(-1)}
          aria-disabled={!canStep(-1)}
          aria-label={`Previous ${unit}`}
        >
          <ChevronUp size={22} />
        </button>
        {/* `aria-live` off: this changes on every scroll, and a screen reader
            announcing "12 of 47" continuously while the reader moves down the
            page is noise over the prose they are actually reading. The buttons
            say what they do, and the card below says where you have landed. */}
        <Tooltip
          placement="top"
          keepSide
          className="tip-soon"
          content={
            <ControlTip
              head="Where you are"
              what={
                rung === 0 && inApparatus
                  ? "You are in the notes, which neither scatter draws — so there is no paragraph of the argument to be standing in."
                  : starts.length > 0
                  ? /* **"the ↑ and ↓ buttons walk", not "the picture draws".**
                       They were the same number until 2026-08-31 and are not on
                       the two scatters any more, where the ladder is the
                       article's paragraphs and the dots are only the ones long
                       enough to place (diagram.ts § paragraphStops). The strip
                       above the picture is where the reader is told how many
                       were left out; this sentence must not quietly claim to be
                       that count as well. */
                    `The ${unit} you are standing in, out of ${starts.length} the ↑ and ↓ buttons walk.`
                  : "There is nothing to step through in this picture yet."
              }
              how={`The unit is read off what is actually drawn rather than off which picture is lit — so it says ${unit} here, and would say something else on a picture made of different rows.`}
            />
          }
        >
          {/* **A tab stop, because the card on it is otherwise unreachable.**
              This is the one place that says what a press of the arrows moves
              *by* — a section here, a paragraph on the two scatters — and the
              number beside it is a count of exactly that unit. A card on an
              element nothing can focus is a card a keyboard reader cannot open,
              which is the same failure the `title` attribute had for touch. So
              the readout takes a tab stop it does not need for its own sake. */}
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: see above — the tab stop exists so the hover card on this readout is reachable by keyboard, which is the whole point of it not being a `title` */}
          <span className="diag-step-at" tabIndex={0}>
            {rung > 0 ? `${rung} / ${starts.length}` : "—"}
          </span>
        </Tooltip>
        <button
          type="button"
          className="diag-step-btn"
          onClick={() => stepTo(1)}
          aria-disabled={!canStep(1)}
          aria-label={`Next ${unit}`}
        >
          <ChevronDown size={22} />
        </button>
      </div>

      <DetailCard
        node={card}
        ramp={ramp}
        live={shown === here && hover === null}
        onJump={onJump}
        related={related}
      />
        </>
      )}
    </aside>
  );
}

/**
 * **What stands where the picture will be, when there is no picture yet.**
 *
 * Greg, 2026-08-30:
 *
 * > if while loading and/or if there's an error with one of the others (e.g.
 * > with semantic embeddings), it falls back to Tree - instead, just show a
 * > loading spinner or error.
 *
 * Only Drift and Trail can get here: Force draws four of its five kinds of line
 * without asking the server anything. Three states, and they are three
 * different sentences rather than one with a code appended —
 *
 *  - **loading** — the spinner, plus what the wait is *for*. A bare spinner in
 *    a 288px band says "something", and a reader who has just pressed a chip
 *    that costs a model call is owed the sentence.
 *  - **ready with nothing to place** — an article of one long paragraph, or all
 *    headings, comes back successful and empty. That is not an error and must
 *    not be dressed as one.
 *  - **error** — the consequence first, then the server's own words, which end
 *    in a bracketed code the reader can quote (docs/project/copy.md). A fixed
 *    sentence here would report an authentication failure, a network drop and a
 *    broken deploy as the same thing, which is what this said before 2026-08-28.
 *
 * One `role="status"`, and only one: while this is on screen the `.diag-note`
 * strip above says nothing, so a screen reader hears the wait once.
 */
function Waiting({ projection }: { projection: UseProjection | null }) {
  /* No projection is being waited for, so there is nothing this can say about
     why. Unreachable today — see the call site — and deliberately a real
     sentence rather than a `throw` or a blank, because the one thing a reader
     must never get here is an empty band with no explanation. */
  if (projection === null) return <p className="diag-wait">This picture has nothing to draw yet.</p>;
  if (projection.status === "error") {
    return (
      /* **A column, and the sentence gets its own element.** `.diag-wait` is a
         centred flex row — right for a spinner beside six words, wrong here: the
         reason is the server's own and runs to three lines in a 288px band, and
         a row would stand the button beside it and squeeze both. `wide` turns
         the axis rather than letting the text wrap around the button. */
      <div className="diag-wait wide" role="status">
        <span>
          Could not place these paragraphs.{" "}
          {projection.error ?? "The reason did not come back."}
        </span>
        {/* Unlike Force, this failure leaves the band with nothing in it at all,
            so the button is the only thing on screen the reader can press. */}
        <TryAgain
          onClick={projection.retry}
          what="this picture"
          how="One embedding call, which reads every paragraph. Drift and Trail share the answer, so paying here pays for both."
        />
      </div>
    );
  }
  /* Ready, and no dots came back at all: an article of one long paragraph, or
     one that is all headings. **Not "fewer than two"** — that is `kept`'s guard,
     which is a different threshold about a picture that did draw. This branch is
     `points.length === 0`, so the honest number is none. */
  if (projection.status === "ready") {
    return (
      <p className="diag-wait" role="status">
        Nothing here to place: a paragraph needs a dozen words before the model can say what it is
        about, and none of this article's do.
      </p>
    );
  }
  return (
    <p className="diag-wait" role="status">
      <LoaderCircle className="cmt-spinner" size={14} aria-hidden="true" />
      Reading the article paragraph by paragraph…
    </p>
  );
}

/**
 * **The second try**, shown beside a failure and nowhere else.
 *
 * Both fetches in this panel run once from an effect, and until 2026-08-30 a
 * reader whose request failed had the server's reason on screen and no verb
 * anywhere — the way back was to leave the mode and come in again, which nothing
 * said. Greg: *"And/or a button to trigger generation if needed."*
 *
 * A plain `<button>` rather than shadcn's, because both places it lands are a
 * sentence of 10.5–12.5px chrome and a real button in the middle of a sentence
 * changes the line height around it. It is inline text with a little padding
 * around it — and that padding is worth about 23px of height in the band and
 * less in the strip, which is under WCAG 2.2's 24px minimum and a long way under
 * Apple's 44. Said plainly rather than described as "hittable on touch", which
 * is what this claimed (⟨Sol⟩, 2026-08-30): the honest version is that it is a
 * link-sized target in a line of chrome, and the step bar below is what this
 * panel offers a thumb.
 *
 * `what` goes in the accessible name, never in the visible label. Not because
 * two of these can be on screen together — they cannot, and it is worth saying
 * so rather than implying otherwise: `similar` is gated on Force and
 * `projection` on the two scatters, so the picture on screen decides which
 * failure exists. It is that **"Try again" on its own names nothing**, and a
 * reader arriving at this button by Tab, out of the two sentences of chrome
 * around it, gets "button, Try again" and no object.
 */
function TryAgain({ onClick, what, how }: { onClick(): void; what: string; how: string }) {
  return (
    <Tooltip placement="top" keepSide className="tip-soon" content={<ControlTip head="Try again" what={`Ask the server for ${what} a second time.`} how={how} />}>
      <button type="button" className="diag-again" onClick={onClick} aria-label={`Try ${what} again`}>
        Try again
      </button>
    </Tooltip>
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
  options: { value: T; label: string; blurb: string; how: string }[];
}) {
  return (
    /* The caption sits OUTSIDE the radiogroup. A `<span>` among the radios is a
       child of a role that does not want one, and it would also make the
       group's children off-by-one from its options — which is exactly the sort
       of index the focus move below has to get right. */
    <div className="diag-opt">
      <span className="diag-opt-label">{label}</span>
      {/* **Hover cards, not `title` attributes** — see `ControlTip`. These are
          the chips that decide what an axis *means*, which is the one thing a
          reader cannot recover by pressing them and looking: two arrangements
          of the same dots both look like arrangements of dots. Grouped, so
          reading along the row is one gesture. */}
      <div className="diag-opt-set" role="radiogroup" aria-label={label}>
        <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {options.map((o) => (
        <Tooltip
          key={o.value}
          placement="bottom"
          /* Same finding as the kind chips': the card is wider than a chip and
             these sit near the band's left edge, so without this the card is
             thrown sideways onto the neighbours the reader is reading towards.
             Tooltip.tsx § keepSide. */
          keepSide
          className="tip-soon"
          content={<ControlTip head={o.label} what={o.blurb} how={o.how} />}
        >
        {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern — see the kind switcher above */}
        <button
          type="button"
          role="radio"
          aria-checked={o.value === value}
          /* **A tab stop each, and no arrow keys** — the roving tabindex and
             its arrow handler went on 2026-08-31 with the four other switchers
             in this app. The kind chips above carry the reasoning; Dock.tsx
             § the mode switch carries all of it. Short version: on this page
             the arrows belong to the article, and every one of these handlers
             called `stopPropagation` to take them. */
          tabIndex={0}
          className={`diag-opt-btn${o.value === value ? " on" : ""}`}
          onClick={() => onChange(o.value)}
          data-diag-opt={o.value}
          >
            {o.label}
          </button>
        </Tooltip>
        ))}
        </TooltipGroup>
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
function kept(p: UseProjection): { what: string; how: string } {
  /* **A picture too thin to describe.** The *empty* case no longer reaches
     here — no dots means no picture, and `Waiting` says so where the picture is
     missing. What is left is the article that placed exactly **one** paragraph:
     there is a dot, so this renders, and the general wording below would report
     what percentage of the differences a flat view keeps of a view with nothing
     to be different from. GPT Sol's finding, 2026-08-27, and the reason the
     threshold is 2 rather than 1. */
  if (p.blocks < 2) {
    return {
      what: "Not enough prose here to place — a paragraph needs a dozen words before the model can say what it is about.",
      how: "There is a dot, and one dot has nothing to be far from, so nothing here says how far apart two paragraphs are.",
    };
  }
  const held = Math.round((p.variance[0] + p.variance[1]) * 100);
  const short = p.skipped.tooShort + p.skipped.nonProse;
  const missing = short > 0 ? `, ${short} too short or not prose to place` : "";
  const capped = p.skipped.capped > 0 ? `, ${p.skipped.capped} past the limit` : "";
  const by = p.model ? ` Placed by ${p.model}.` : "";
  /* **Three sentences, because it is three claims.** The first version ran them
     together with a dash and a "so", which made the asymmetry — the only real
     content here — the tail of a sentence about a percentage. Fable's rewrite,
     2026-08-27, and it is better: how many dots, how flat the view is, and then
     the two halves of what flatness costs, each given its own full stop.

     **The split into two is where the card's two paragraphs come from**, and it
     is the split `ControlTip` already asks for everywhere else in this panel:
     what it is, then the thing a reader could not have worked out by looking.
     How many dots there are is the first; what a flat view costs is the second,
     and it is the whole reason any of this is on screen. */
  return {
    what: `${p.blocks} paragraphs${missing}${capped}.`,
    how: `This is a flattened view — it keeps about ${held}% of the differences the model saw. Far-apart dots really do differ. Close-together dots may not: their differences may be in what the flattening dropped.${by}`,
  };
}

/**
 * **The picture's own caveat, as an icon on the heading row.**
 *
 * It was four lines of prose above the picture until 2026-08-30. Greg:
 *
 * > It uses up valuable vertical real estate. Hide it behind a tooltip or
 * > warning icon or something.
 *
 * It is rendered in `.band-head` rather than on the controls strip, and **why**
 * is at the call site: that row cannot wrap, and the strip can.
 *
 * Two things it keeps, because a hover card on its own would drop both.
 *
 * **A `role="status"`, still.** The strip announced itself when the projection
 * landed, and that announcement is the only way a reader who cannot see the
 * picture learns that a fifth of the article is not in it. A tooltip is reached
 * by pointing or by Tab, so it announces nothing. The sentence is therefore
 * still in the DOM and still live — it is only invisible, which is what
 * `.sr-only` is for.
 *
 * **And the counts are in the button's name**, not just in the card. "Info" or
 * "About this picture" would make the one hard number — how many paragraphs are
 * missing — reachable only by opening something, and a control whose label is a
 * noun is a control a screen reader cannot skim.
 *
 * `Info` rather than a warning triangle: paragraphs going unplaced is the
 * ordinary case (headings and one-line list items are not embedded — see
 * src/article-vectors.ts), and an alarm on the ordinary case is an alarm nobody
 * reads by the second article.
 */
function ScatterNote({ projection }: { projection: UseProjection }) {
  const { what, how } = kept(projection);
  return (
    <>
      <Tooltip
        placement="bottom"
        /* Same finding as the chips beside it: the card is far wider than this
           icon and the icon sits at the right-hand end of a 400px band, so
           without this the card is thrown sideways onto the controls the reader
           just came from. Tooltip.tsx § keepSide. */
        keepSide
        className="tip-soon"
        content={<ControlTip head="What is drawn" what={what} how={how} />}
      >
        <button type="button" className="diag-about" aria-label={`About this picture: ${what}`}>
          <Info size={13} aria-hidden="true" />
        </button>
      </Tooltip>
      {/* The whole sentence, spoken once when the projection lands — the job the
          visible strip used to do. Not `aria-label` on the button above: that is
          heard on focus, and this has to be heard on arrival. */}
      <p className="sr-only" role="status">{`${what} ${how}`}</p>
    </>
  );
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
         emphatic that colour is never allowed to be the only carrier. Force has
         nothing extra to say and falls through to the default. */
      aria-label={node.label ?? `${label}, ${node.blocks} paragraph${node.blocks === 1 ? "" : "s"}`}
      {...(node.hasChildren && { "aria-expanded": !node.collapsed })}
      onPointerEnter={() => onHover(node.id)}
      onFocus={() => onRove(node.id)}
      onClick={() => onJump(node.blockId)}
      onKeyDown={(e) => onKeyNav(e, node)}
    >
      {kind === "force" ? (
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
          rx={node.depth === 2 ? 2 : 1}
        />
      )}
      {/* The two scatters put a 3px dot inside a hit rectangle big enough to
          press with a finger, so the mark is carried separately — see `dot` in
          diagram.ts for why those are not the same rectangle. */}
      {node.dot && (
        <circle className="diag-dot" cx={node.dot.x} cy={node.dot.y} r={node.dot.r} />
      )}

      <text
        className="diag-label"
        x={node.labelX}
        y={node.labelY}
        textAnchor={node.anchor}
      >
        {node.lines.map((line, i) => (
          <tspan
            // Index keys: these are wrapped fragments of one string with no
            // identity of their own, and they are replaced wholesale whenever
            // the string or the width changes.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={i}
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

      {/* **The chevron was here, and it went with the Tree.** It was the only
          pointer-driven way to fold a part away, and it only ever existed on
          the Tree's rows — a 14px hit target beside a 7px dot is not something
          a force bubble has room for. Folding is still in the picture on Force,
          on ← and →, which is where the tree-view pattern puts it; the paragraph
          count that sat at the end of a Tree row is in the footer card, where it
          always also was. */}
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
