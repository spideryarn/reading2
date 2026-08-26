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
import { ChevronDown, ChevronRight, Network, Share2, Signal } from "lucide-react";
import type { BlockId, NodeId } from "../types.js";
import {
  DIAGRAMS,
  type DiagramKind,
  LINE_STEP,
  type DiagramLayout,
  type DiagramNode,
  layoutDiagram,
  nodeAt,
} from "./diagram.js";
import type { SummaryNode } from "./tree.js";

interface Props {
  /** The tree, numbered and joined to block ranges. Null if the tree is unusable. */
  root: SummaryNode | null;
  kind: DiagramKind;
  onKind(kind: DiagramKind): void;
  /** Where the reader is, as a row index into the article's blocks. */
  atRow: number | null;
  /** Jump the article to a block, exactly as a gist cell does. */
  onJump(id: BlockId): void;
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
};

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

export function DiagramPanel({ root, kind, onKind, atRow, onJump }: Props) {
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
    let raf = 0;
    const run = () => {
      // Through rAF: ResizeObserver fires during layout, and setting state
      // straight from it is how you get "loop completed with undelivered
      // notifications". Same guard the spine uses.
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setBox((prev) => {
          /* **`clientWidth` is the PADDING box, not the content box** — it
             excludes the border and the scrollbar and includes the padding
             (CSSOM View § clientWidth). This scroller has horizontal padding,
             so taking `clientWidth` as the picture's width makes every picture
             exactly the padding wider than the room it has, and
             `overflow-x: hidden` then quietly eats the right-hand edge — the
             tree's paragraph count first, since it is drawn at `w - 6`.
             Subtracting the computed padding rather than the literal `0.5rem`
             means changing the stylesheet cannot reintroduce this. */
          const cs = getComputedStyle(el);
          const pad = Number.parseFloat(cs.paddingLeft) + Number.parseFloat(cs.paddingRight);
          const w = Math.max(0, el.clientWidth - (Number.isFinite(pad) ? pad : 0));
          const h = el.clientHeight;
          return prev && prev.w === w && prev.h === h ? prev : { w, h };
        });
      });
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const layout: DiagramLayout | null = useMemo(() => {
    if (!root || box === null || box.w === 0) return null;
    return layoutDiagram(kind, root, { width: box.w, height: box.h, collapsed });
  }, [root, kind, box, collapsed]);

  /* The node the reader is standing in — the deepest one drawn, which is the
     same rule the summary panel's follow mark uses. Computed from the LAID OUT
     nodes rather than from the tree, so a closed section's mark lands on the
     closed section rather than vanishing. */
  const here = useMemo(() => nodeAt(layout?.nodes ?? [], atRow), [layout, atRow]);

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
        if (node.hasChildren && node.collapsed) toggle(node.id);
        else if (node.hasChildren) step(1); // preorder: the next node IS the first child
        return;
      case "ArrowLeft": {
        e.preventDefault();
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
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: SVG has no tree element
            role="tree"
            aria-label={`${KIND_UI[kind].label} view of the article's structure`}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHasFocus(true)}
            // `focusout` bubbles where `blur` does not, so React's onBlur here
            // fires when focus leaves any node inside. The relatedTarget check
            // keeps it from firing as focus moves BETWEEN two nodes.
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHasFocus(false);
            }}
          >
            {layout.links.map((l) => (
              <path
                key={l.id}
                className={`diag-link diag-d${l.depth}`}
                style={hue(l.part)}
                d={l.d}
                fill="none"
              />
            ))}
            {layout.nodes.map((n, i) => (
              <NodeShape
                key={n.id}
                node={n}
                kind={kind}
                here={n.id === here}
                focused={n.id === picked}
                tabstop={n.id === rovingId}
                setSize={sizeOfLevel(layout.nodes, i)}
                posInSet={positionInLevel(layout.nodes, i)}
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
            {layout.axis && atRow !== null && (
              <line
                className="diag-now"
                x1={0}
                x2={layout.width}
                y1={layout.axis.top + (atRow / layout.axis.rows) * layout.axis.height}
                y2={layout.axis.top + (atRow / layout.axis.rows) * layout.axis.height}
              />
            )}
          </svg>
        )}
      </div>

      <DetailCard node={card} live={shown === here && hover === null} onJump={onJump} />
    </aside>
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

function sizeOfLevel(nodes: readonly DiagramNode[], i: number): number {
  return siblingRun(nodes, i).size;
}

function positionInLevel(nodes: readonly DiagramNode[], i: number): number {
  return siblingRun(nodes, i).pos;
}

/**
 * A part's hue, as the `--cat-rgb` triplet the rest of the app already speaks.
 *
 * The indirection is deliberate and is SearchPanel's: a component picks a
 * *slot*, and the stylesheet owns what that slot looks like. So the eight hues
 * live in styles/colourscales.css, where the reasoning about a near-black ground
 * is (docs/project/colour-scales.md), and this file never names a colour.
 *
 * The root, which is `part === -1`, gets the neutral rather than a ninth hue:
 * it is not one of the parts, it is all of them.
 */
function hue(part: number): React.CSSProperties {
  const slot = part < 0 ? "7" : String(part % PART_HUES);
  return { "--cat-rgb": `var(--cat-${slot}-rgb)` } as React.CSSProperties;
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
    <g
      className={cls}
      style={hue(node.part)}
      role="treeitem"
      // The DOM is flat — every node is a sibling — so the nesting has to be
      // stated rather than inferred from the markup. `aria-level` is 1-based
      // where our depth is 0-based.
      aria-level={node.depth + 1}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      data-diag-id={node.id}
      tabIndex={tabstop ? 0 : -1}
      aria-label={`${label}, ${node.blocks} paragraph${node.blocks === 1 ? "" : "s"}`}
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
function DetailCard({
  node,
  live,
  onJump,
}: {
  node: DiagramNode | null;
  live: boolean;
  onJump(id: BlockId): void;
}) {
  if (!node) {
    return (
      <div className="diag-card empty">
        <p>Point at anything in the picture. Clicking it takes the article there.</p>
      </div>
    );
  }
  return (
    <div className="diag-card" style={hue(node.part)}>
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
      {node.gist && (
        <p className="diag-card-gist" title={node.gist}>
          {node.gist}
        </p>
      )}
    </div>
  );
}
