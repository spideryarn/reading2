/**
 * **The Sketch picture, in the band** — docs/project/diagram.md § Sketch.
 *
 * Its own component rather than a fourth branch of `DiagramPanel`, and that is
 * the one structural decision here. The other three pictures are a
 * `DiagramLayout` — a flat list of nodes and links over the article's tree —
 * and every piece of that panel is about them: the roving tabstop over
 * `layout.nodes`, the step bar over `stepStops`, the footer card over a
 * `SummaryNode`. A Sketch is none of those things. It is a *scene*, possibly
 * one of several, with its own coordinate space and its own idea of what a node
 * is. Threading it through `layoutDiagram` would mean four call sites each
 * asking "but is it the sketch?", which is the braiding CLAUDE.md's *prefer
 * simple over easy* is about. The chip row, the shell and the heading stay
 * shared; the picture is separate.
 *
 * ## Two sizes, because 288px is not a size a diagram fits in
 *
 * The canvas is 760 units and the band is 288–400px, so scaled to fit, 12-unit
 * text lands at about 5px. That is not a bug to solve, it is the band being
 * narrow, and the two things a reader wants are genuinely different:
 *
 *  - **Fit** shows the *shape* — which is what this whole diagram is for, and
 *    it survives being small. The words do not, so hovering or focusing
 *    anything puts its full text in the card underneath.
 *  - **Read** draws it at its own size and lets the band scroll both ways.
 *
 * One button, two states, and no third thing to learn.
 *
 * ## What clicking does
 *
 * A node may carry a `block` (jump the article there), an `opens` (zoom into
 * another scene), or both. **`opens` wins**, because the picture's own gesture
 * is "go deeper" and a click that sometimes zoomed and sometimes scrolled the
 * article would be a control the reader cannot predict. The jump is still
 * offered — from the card, where it is labelled — so it is available and never
 * a surprise. GPT Sol flagged the ambiguity, 2026-08-30; this is the resolution
 * and it is a guess until somebody uses it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, LoaderCircle, Maximize2, Minimize2, PenLine } from "lucide-react";
import { paintScene, type Painted, type PaintedNode, type Prim } from "../sketch-paint.js";
import type { SketchNode } from "../sketch-scene.js";
import type { Block, BlockId } from "../types.js";
import { JobProgress } from "./JobProgress.js";
import { useSketch } from "./useSketch.js";
import { UseProfile } from "./WrittenForYou.js";

/** One drawing primitive as an element. Nothing here knows a colour. */
function Shape({ p }: { p: Prim }) {
  const style = p.tone === undefined ? undefined : ({ "--cat-rgb": `var(--cat-${p.tone}-rgb)` } as React.CSSProperties);
  switch (p.t) {
    case "rect":
      return <rect className={p.cls} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.rx} style={style} />;
    case "ellipse":
      return <ellipse className={p.cls} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} style={style} />;
    case "poly":
      return <polygon className={p.cls} points={p.points} style={style} />;
    case "path":
      return <path className={p.cls} d={p.d} style={style} />;
    case "text":
      return (
        <text className={p.cls} x={p.x} y={p.y} fontSize={p.px} textAnchor={p.anchor} style={style}>
          {p.text}
        </text>
      );
  }
}

/**
 * The card under the picture — what the hovered node says, at a size it can be
 * read at.
 *
 * **Fixed height**, like the other pictures' card and for the same reason: a
 * card that grew with its text would resize the picture above it every time the
 * pointer crossed a box.
 */
function SketchCard({
  node,
  caption,
  onJump,
}: {
  node: SketchNode | null;
  caption: string;
  onJump(id: BlockId): void;
}) {
  if (!node) {
    return (
      <div className="sk-card empty">
        <p className="sk-card-caption">{caption}</p>
      </div>
    );
  }
  return (
    <div className="sk-card" style={node.tone === undefined ? undefined : ({ "--cat-rgb": `var(--cat-${node.tone}-rgb)` } as React.CSSProperties)}>
      <p className="sk-card-title">{node.text}</p>
      {node.sub && <p className="sk-card-sub">{node.sub}</p>}
      {node.detail && (
        <p className="sk-card-detail" title={node.detail}>
          {node.detail}
        </p>
      )}
      {node.block && (
        <button type="button" className="sk-card-jump" onClick={() => onJump(node.block as BlockId)}>
          Go to this passage
        </button>
      )}
    </div>
  );
}

interface Props {
  slug: string;
  blocks: readonly Block[];
  /** Where the reader is, as a row index into `blocks`, or `null`. */
  atRow: number | null;
  onJump(id: BlockId): void;
}

export function SketchView({ slug, blocks, atRow, onJump }: Props) {
  const blockOrder = useMemo(() => blocks.map((b) => b.id), [blocks]);
  const view = useSketch(slug, blockOrder);
  const { sketch } = view;

  /** The scenes the reader has opened, deepest last. `[]` is the overview. */
  const [trail, setTrail] = useState<string[]>([]);
  const [big, setBig] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);
  const [useProfile, setUseProfile] = useState(true);
  const svg = useRef<SVGSVGElement>(null);

  /* A new picture is a new set of scene ids, so a trail into the old one points
     at nothing. Reset rather than carry: a breadcrumb naming a scene that no
     longer exists would show the overview while claiming to be somewhere else. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the identity of the sketch is what invalidates the trail, not any field of it
  useEffect(() => {
    setTrail([]);
    setFocused(0);
  }, [sketch]);

  const scene = useMemo(() => {
    if (!sketch) return null;
    const wanted = trail[trail.length - 1];
    return (wanted && sketch.scenes.find((s) => s.id === wanted)) || sketch.scenes[0] || null;
  }, [sketch, trail]);

  const painted: Painted | null = useMemo(() => (scene ? paintScene(scene) : null), [scene]);

  /**
   * **The node the reader is standing in**, or `null`.
   *
   * The nearest node *at or above* the reader's row, which is the same rule
   * every other picture here uses: a node answers for the article from itself
   * until the next one. Only on the overview — a zoom scene draws one part, and
   * marking a position inside it when the reader is elsewhere would be a
   * confident lie about where they are.
   */
  const here = useMemo(() => {
    if (!painted || atRow === null || trail.length > 0) return null;
    const index = new Map(blockOrder.map((id, i) => [id, i]));
    let best: { id: string; row: number } | null = null;
    for (const n of painted.nodes) {
      const row = n.node.block ? index.get(n.node.block) : undefined;
      if (row === undefined || row > atRow) continue;
      if (!best || row > best.row) best = { id: n.node.id, row };
    }
    return best?.id ?? null;
  }, [painted, atRow, blockOrder, trail.length]);

  const shown = hover ?? (painted?.nodes[focused]?.node.id ?? null);
  const card = painted?.nodes.find((n) => n.node.id === shown)?.node ?? null;

  const activate = useCallback(
    (n: PaintedNode) => {
      /* `opens` wins — see the header. */
      if (n.node.opens) {
        setTrail((t) => [...t, n.node.opens as string]);
        setFocused(0);
        return;
      }
      if (n.node.block) onJump(n.node.block);
    },
    [onJump],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (!painted || painted.nodes.length === 0) return;
      const n = painted.nodes.length;
      const step = (d: number) => {
        e.preventDefault();
        setFocused((i) => Math.max(0, Math.min(n - 1, i + d)));
      };
      if (e.key === "ArrowDown" || e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") step(-1);
      else if (e.key === "Home") {
        e.preventDefault();
        setFocused(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setFocused(n - 1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const target = painted.nodes[focused];
        if (target) activate(target);
      } else if (e.key === "Escape" && trail.length > 0) {
        e.preventDefault();
        setTrail((t) => t.slice(0, -1));
      }
    },
    [painted, focused, activate, trail.length],
  );

  if (view.status === "loading") {
    return (
      <div className="sk-wait" role="status">
        <LoaderCircle className="cmt-spinner" size={14} aria-hidden="true" /> Looking for a picture…
      </div>
    );
  }

  if (view.status === "none" || view.status === "error") {
    return (
      <div className="sk-empty">
        <p>
          {view.status === "error"
            ? (view.error ?? "Could not ask for this picture.")
            : "Nobody has drawn this one yet."}
        </p>
        {/* **What it costs, before the press rather than after it** — the same
            rule the chips' hover cards follow, and it matters more here than
            anywhere: this is a two-minute wait, and a reader who presses a
            button and then watches a spinner for two minutes with no idea why
            is owed the sentence. */}
        <p className="sk-empty-why">
          A model reads the whole article, works out what shape the argument is, and draws that. It
          is the slowest thing here — about two minutes — and it costs a model call, so it is never
          drawn until you ask.
        </p>
        <div className="sk-run">
          <UseProfile
            checked={useProfile}
            onChange={setUseProfile}
            hasProfile={view.hasProfile}
            slug={slug}
            disabled={view.job !== null}
          />
          <JobProgress
            job={view.job}
            failed={view.failed}
            onRun={() => view.draw(useProfile)}
            onCancel={view.cancel}
            label="Draw the argument"
            step="sketch"
            icon={<PenLine size={13} />}
            runningLabel="Drawing…"
          />
        </div>
      </div>
    );
  }

  if (!sketch || !scene || !painted) return null;

  const notes: string[] = [];
  if (view.stale) {
    notes.push(
      "The article has changed since this was drawn. The shape is still a fair account of the argument; some boxes may no longer lead anywhere.",
    );
  }
  if (view.faults.length > 0) {
    const lost = view.faults.filter((f) => f.what.includes("not in this article")).length;
    if (lost > 0) notes.push(`${lost} of its boxes point at passages this article no longer has.`);
  }
  if (view.profileChanged) notes.push("It was drawn for a reader profile you have since changed.");

  return (
    <div className="sk">
      <div className="sk-bar">
        {trail.length > 0 ? (
          <button
            type="button"
            className="sk-crumb"
            onClick={() => setTrail((t) => t.slice(0, -1))}
            aria-label="Back to the overview"
          >
            <ChevronLeft size={13} /> {sketch.scenes[0]?.title || "Overview"}
          </button>
        ) : (
          <span className="sk-title" title={sketch.caption}>
            {sketch.title}
          </span>
        )}
        <button
          type="button"
          className="sk-zoom"
          onClick={() => setBig((v) => !v)}
          aria-pressed={big}
          title={big ? "Fit the whole picture in the band" : "Draw it at full size and scroll"}
        >
          {big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          {big ? "Fit" : "Read"}
        </button>
      </div>

      {notes.length > 0 && <p className="sk-note">{notes.join(" ")}</p>}

      <div className={`sk-scroll${big ? " big" : ""}`}>
        {/* biome-ignore lint/a11y/useSemanticElements: SVG has no listbox element; the roles are written out for the same reason scatter.ts's are — the DOM is flat and nothing in the markup says this is the third of twelve */}
        <svg
          ref={svg}
          className="sk-svg"
          viewBox={`0 0 ${painted.width} ${painted.height}`}
          width={big ? painted.width : "100%"}
          height={big ? painted.height : undefined}
          preserveAspectRatio="xMidYMin meet"
          role="listbox"
          aria-label={`${scene.title}. ${scene.caption ?? sketch.caption}`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          <title>{scene.caption ?? sketch.caption}</title>
          {painted.behind.map((p, i) => (
            <Shape key={`b${i}`} p={p} />
          ))}
          {painted.links.map((p, i) => (
            <Shape key={`l${i}`} p={p} />
          ))}
          {painted.nodes.map((n, i) => (
            /* biome-ignore lint/a11y/useKeyWithClickEvents: the whole picture is one tab stop with its own key handler above — a handler per node is the tab-stop-per-node mistake DiagramPanel already made once */
            <g
              key={n.node.id}
              className={`sk-node${n.node.opens ? " opens" : ""}${n.node.block ? " links" : ""}${
                here === n.node.id ? " on" : ""
              }${focused === i && shown === n.node.id ? " focus" : ""}`}
              role="option"
              aria-selected={focused === i}
              aria-label={[n.node.text, n.node.sub, n.node.detail].filter(Boolean).join(". ")}
              onClick={() => {
                setFocused(i);
                activate(n);
              }}
              onMouseEnter={() => setHover(n.node.id)}
              onMouseLeave={() => setHover(null)}
            >
              {n.prims.map((p, j) => (
                <Shape key={`p${j}`} p={p} />
              ))}
              {/* An invisible hit rectangle over the whole box, so a `bare` node
                  and the gaps inside a diamond are as clickable as a filled
                  rect. Last, so it is on top of the node's own paint. */}
              <rect className="sk-hit" x={n.hit.x} y={n.hit.y} width={n.hit.w} height={n.hit.h} />
            </g>
          ))}
          {painted.front.map((p, i) => (
            <Shape key={`f${i}`} p={p} />
          ))}
        </svg>
      </div>

      <SketchCard node={card} caption={scene.caption ?? sketch.caption} onJump={onJump} />
    </div>
  );
}
