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
 * ## 288px is not a size a diagram fits in, and zooming inside it does not help
 *
 * The canvas is 760 units and the band is 288–400px, so scaled to fit, 12-unit
 * text lands at about 5px. The band shows the **shape**, which is what this
 * diagram is for and which survives being small; the words do not, so hovering
 * or focusing anything puts the full text in the card underneath.
 *
 * The first version's answer to the words was a Fit/Read toggle that redrew the
 * picture at its natural 760 units *inside the same column*. Greg, 2026-08-30:
 *
 * > Right now it just zooms in, but the column is narrow.
 *
 * Which is the whole objection. Reading a diagram through a 288px slot by
 * scrolling it in two directions is worse than not reading it: you lose the
 * shape, which was the one thing the small version had, and you gain words you
 * have to reassemble from four screenfuls. A picture of a whole argument wants
 * the whole window.
 *
 * So **Enlarge**, and it is a real modal — the same `<dialog>` `showModal()`
 * that [`Lightbox.tsx`](./Lightbox.tsx) uses for a figure in the article, for
 * the four reasons that file sets out at length: Escape closes it, the
 * background goes `inert`, focus is trapped and restored, and it paints in the
 * top layer without joining the z-index budget. Inside, the picture is drawn to
 * the window's width rather than to 760, so the text arrives at 17–20px — and
 * the shape is still whole, because nothing about the layout changed, only its
 * scale.
 *
 * **Widening the column was the other option Greg offered and it is worse.**
 * The band's width is the output of a negotiation in `layout.ts` between the
 * rail, the band and `PROSE_MIN`, and a band that grew to fit a diagram would
 * take that width from the article — which is the thing the reader is here to
 * read, and which every other rule in that file protects first. A modal takes
 * the width from nothing: the article is exactly where it was when you close it.
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
 *
 * **And `opens` is a shortcut, not the way in.** The bar lists every scene, so
 * a reader reaches all of them whether the model wired a node to them or not —
 * which on four of the first six real drawings it did not, three of those with
 * no `opens` anywhere. Depending on it would have meant paying for two pictures
 * per article that nobody could ever see.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, LoaderCircle, Maximize2, Minimize2, PenLine } from "lucide-react";
import {
  anchorTransform,
  type Box,
  paintScene,
  type Painted,
  type PaintedNode,
  peekViewport,
  type Prim,
  zoomAnchor,
  type ZoomAnchor,
} from "../sketch-paint.js";
import { CANVAS_W, type SketchNode } from "../sketch-scene.js";
import type { Block, BlockId } from "../types.js";
import { JobProgress } from "./JobProgress.js";
import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";
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

  /**
   * Which scene is open — `null` is the overview.
   *
   * **A flat choice rather than a stack, and that is a correction.** It was a
   * breadcrumb trail, on the assumption that the reader arrives at a zoom by
   * pressing a node that `opens` it. Then four of six real drawings turned out
   * to have scenes **no node opens at all**, three of them with no `opens`
   * anywhere — so the model had paid to draw two extra pictures the reader
   * could never reach, and a trail is a way back from somewhere you cannot get
   * to. The scene list below is the way in, `opens` is a shortcut to it, and
   * the picture no longer depends on the model having wired one.
   */
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);
  const [useProfile, setUseProfile] = useState(true);
  const svg = useRef<SVGSVGElement>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);

  /**
   * **Which region is showing a ghost of what is inside it**, by its index in
   * `painted.regions` — a region has no id of its own, and the list is
   * recomputed whole every time the scene changes, so an index cannot come to
   * mean a different region while it is being held.
   *
   * Hover *and* focus, because the keyboard reader has no pointer and the peek
   * is the only thing that says what a part contains before you go into it.
   */
  const [peek, setPeek] = useState<number | null>(null);

  /**
   * **The zoom, in three refs and a counter**, docs/plans/260830ap-sketch-zoomable-subsections.md.
   *
   * `anchor` is the box the reader pressed to get where they are, kept so that
   * going back can be the exact reverse of going in rather than another
   * animation that happens to point the other way. `pending` is what the next
   * entrance should run, written by the press and read by the layout effect.
   * `nav` is what tells the effect a navigation happened at all — keying it on
   * the scene would replay the last zoom whenever the artefact reloaded
   * underneath, which is a picture leaping about for no reason a reader can see.
   */
  const anchor = useRef<ZoomAnchor | null>(null);
  const pending = useRef<{ a: ZoomAnchor | null; dir: "in" | "out" } | null>(null);
  const stage = useRef<SVGGElement | null>(null);
  const scroll = useRef<HTMLDivElement | null>(null);
  /**
   * **The entrance in flight, so that anything can stop it.**
   *
   * Living only in the layout effect's closure, it was cancelled when the next
   * navigation replaced it and at no other time — so a reload of the artefact
   * mid-flight left the reused `<g>` wearing the old scene's transform while
   * its contents changed underneath, and Enlarge or Close, which unmounts the
   * whole picture body and mounts it again in the dialog, detached the animated
   * node with its animation still attached to it. ⟨Sol⟩, 2026-08-30.
   */
  const running = useRef<Animation | null>(null);
  /**
   * Where the picture was scrolled to when the press happened, and how many
   * pixels a canvas unit was worth then. Both are read before the swap and used
   * after it, to keep the entrance starting where the reader's finger was
   * rather than where the box would be if nothing were scrolled.
   */
  const scrolledAt = useRef<{ top: number; unit: number } | null>(null);
  /** Focus the picture after the next navigation — see `goTo`'s callers. */
  const takeFocus = useRef(false);

  /**
   * The group everything is drawn into, and the one thing the zoom moves.
   *
   * A callback ref rather than a plain one, so that the element *leaving* is an
   * event: Enlarge and Close unmount this whole body and mount it again inside
   * the `<dialog>`, and an animation still attached to the node that went away
   * is one nothing can reach. `attachDialog` below is a callback ref for the
   * neighbouring reason, and its comment has the longer version.
   */
  const attachStage = useCallback((el: SVGGElement | null) => {
    if (el !== stage.current) {
      running.current?.cancel();
      running.current = null;
    }
    stage.current = el;
  }, []);
  const [nav, setNav] = useState(0);

  /**
   * Whether *we* are the ones closing it.
   *
   * `close()` fires the same `close` event Escape does, so without this our own
   * "shut the overlay" comes straight back as a second close. Lightbox.tsx
   * carries the same guard and the same reasoning.
   */
  const closingOurselves = useRef(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (full && !d.open) {
      closingOurselves.current = false;
      d.showModal();
    } else if (!full && d.open) {
      closingOurselves.current = true;
      d.close();
    }
  }, [full]);

  /**
   * **Escape has to put `full` back, and it is the one path here I could not
   * verify.**
   *
   * The dialog closing without React hearing about it is the worst state this
   * component can be in: the overlay gone, `full` still true, the band saying
   * "the picture is full screen" while nothing is, and the only copy of the
   * picture inside a closed dialog. Invisible, unreachable, no error anywhere,
   * from the most ordinary gesture there is. So it gets two listeners rather
   * than one — `cancel`, which Escape fires first, and `close`, which follows.
   * `setFull(false)` twice is free; missing it once is not.
   *
   * **What the browser pass could and could not establish**, because the
   * distinction matters more than the fix. The Close button and the backdrop
   * click were both driven and both work. Escape was not: a synthetic Escape
   * never reached the top-layer dialog at all, and the obvious proxy —
   * calling `close()` from the console — turned out to be a bad one, because
   * in that context a bare `<dialog>` with a plain listener does not fire
   * `close` either. That control is what stopped an hour of "React's `onClose`
   * is broken", which is what the symptom looked like and is not what the
   * evidence supports. So: Escape rests on `<dialog>`'s own behaviour plus
   * these two listeners, and it has not been seen to work.
   *
   * **Attached by a callback ref, not by `useEffect(…, [])`**, and that part was
   * a real bug. This component returns early for `loading`, `none` and `error`,
   * so on the first render there is no `<dialog>` in the tree — an effect with
   * empty deps ran once, found `ref.current` null, returned, and never ran
   * again, because `[]` says never again. A ref rendered behind an early return
   * is a listener that is never attached. A callback ref fires when the element
   * mounts, whenever that turns out to be.
   */
  const onClosed = useCallback(() => {
    if (closingOurselves.current) return;
    setFull(false);
  }, []);

  const attachDialog = useCallback(
    (el: HTMLDialogElement | null) => {
      const was = dialog.current;
      if (was) {
        was.removeEventListener("close", onClosed);
        was.removeEventListener("cancel", onClosed);
      }
      dialog.current = el;
      if (el) {
        el.addEventListener("close", onClosed);
        /* Escape's own event, and it fires *before* `close`. Not prevented —
           the reader means to leave, and the point of listening to both is that
           either one alone is enough. */
        el.addEventListener("cancel", onClosed);
      }
    },
    [onClosed],
  );

  /**
   * A prefix for the options' DOM ids, so `aria-activedescendant` has something
   * to name.
   *
   * **`useId`, not the node's own id.** A scene's node ids are the model's
   * strings — `"a"`, `"hub"`, `"start"` — and two Sketch panels on one page
   * would mint the same DOM id twice, which makes `aria-activedescendant`
   * ambiguous and silently resolve to whichever came first. The preview page
   * already puts three on screen at once.
   */
  const uid = useId();

  /* A new picture is a new set of scene ids, so a trail into the old one points
     at nothing. Reset rather than carry: a breadcrumb naming a scene that no
     longer exists would show the overview while claiming to be somewhere else. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the identity of the sketch is what invalidates the open scene, not any field of it
  useEffect(() => {
    setOpen(null);
    setFocused(0);
    setPeek(null);
    /* And the way back out of a scene that no longer exists. Left standing, it
       would run the next Back as a zoom out of a box from the previous
       drawing. */
    anchor.current = null;
    pending.current = null;
    /* And a zoom half-played into a picture that has just been replaced. The
       `<g>` is reused across the change, so an entrance left running would go
       on scaling the new scene out of the old one's region. */
    running.current?.cancel();
    running.current = null;
  }, [sketch]);

  const scene = useMemo(() => {
    if (!sketch) return null;
    return (open && sketch.scenes.find((s) => s.id === open)) || sketch.scenes[0] || null;
  }, [sketch, open]);

  const painted: Painted | null = useMemo(() => (scene ? paintScene(scene) : null), [scene]);

  /**
   * **Go to a scene, and remember where you came from.**
   *
   * The order in here is the load-bearing part: the scene is swapped
   * **synchronously**, and the animation is arranged afterwards. Animating and
   * then swapping would put the whole navigation behind a callback that can
   * fail to arrive — `Element.animate` missing, the element unmounted
   * mid-flight, a `finished` promise that never settles because the tab went to
   * the background — and a reader who presses a region's name and lands nowhere
   * has met the same failure this feature was built to fix, one layer down.
   * docs/reusable/silent-success.md.
   *
   * `from` is the box that was pressed, in canvas units, or `null`. **Arriving
   * with no anchor is a normal case, not an error**: pressing a chip in the
   * scene row means "show me that part", not "zoom into this box", and it gets
   * a plain fade. The anchor is dropped on any move that is not a press on the
   * picture itself, so Back can never zoom out to a box the reader never
   * pressed.
   */
  const goTo = useCallback(
    (next: string | null, from: Box | null) => {
      /* Measured *before* the swap, while the outgoing scene is still the one
         on screen — see the layout effect for what it is for. */
      scrolledAt.current = scroll.current
        ? {
            top: scroll.current.scrollTop,
            /* **The rendered box, not `clientWidth`.** `clientWidth` is defined
               on HTML elements and is a browser courtesy on an `<svg>`; the
               rect is what SVG actually guarantees. The `<svg>` itself is never
               inside the transform the entrance animates — that is on a `<g>`
               beneath it — so this cannot pick up a scale mid-flight. */
            unit: (svg.current?.getBoundingClientRect().width ?? 0) / CANVAS_W,
          }
        : null;
      setOpen(next);
      setFocused(0);
      setPeek(null);
      if (next === null) {
        pending.current = { a: anchor.current, dir: "out" };
        anchor.current = null;
      } else {
        /* **Anchored only from the overview.** A box measured inside one detail
           scene means nothing in another, and Back always lands on the
           overview — so an anchor carried across a detail-to-detail move would
           zoom out to a rectangle from a picture the reader is no longer in.
           ⟨Sol⟩, 2026-08-30. Every other move is a plain fade, which is what
           the scene row's chips have always been. */
        const target = open === null && from ? sketch?.scenes.find((sc) => sc.id === next) : null;
        const a = target && from ? zoomAnchor(from, target.height) : null;
        anchor.current = a;
        pending.current = { a, dir: "in" };
      }
      setNav((n) => n + 1);
    },
    [open, sketch],
  );

  /**
   * **The entrance.** Runs after the DOM already holds the new scene, so there
   * is no frame of it sitting untransformed before the animation starts —
   * which is the whole reason this is a layout effect and not an effect.
   *
   * Everything in here is allowed to decline. `Element.animate` is not a
   * function under jsdom, so every test in this repo takes the early return and
   * the scene is simply *there*; a reader who has asked for less motion gets
   * the same. That is the point: the navigation already happened in `goTo`.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the navigation counter is the trigger; the anchor it should run is read from a ref, on purpose, so that a reload of the artefact cannot replay the last zoom
  useLayoutEffect(() => {
    if (nav === 0) return;
    const g = stage.current;
    const p = pending.current;
    if (!g || !p || typeof g.animate !== "function") return;
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    /* **The box was measured in a scrolled picture, and the new one may not be
       scrolled the same way.** The overview is 1150 units tall in a band under
       400px, so it is nearly always scrolled somewhere; the scene it opens is
       shorter, and the browser silently clamps `scrollTop` to what the new
       picture can offer. Left alone, the entrance would start from where the
       region *would* have been if nothing were scrolled, which is not where the
       reader pressed. So the anchor is shifted by whatever the scroll actually
       did, converted back into canvas units.

       Both measurements have to be real for the correction to be: a container
       with no width — jsdom, a display:none ancestor — gives a unit of zero and
       a shift of infinity, so it declines instead. ⟨Sol⟩, 2026-08-30. */
    const was = scrolledAt.current;
    scrolledAt.current = null;
    let shiftY = 0;
    if (p.a && was && was.unit > 0 && scroll.current) {
      const dy = (scroll.current.scrollTop - was.top) / was.unit;
      if (Number.isFinite(dy)) shiftY = dy;
    }
    /* No anchor is a plain fade with a touch of scale — enough to say "this is
       a different picture" without claiming it came from somewhere.

       **The shift goes to `anchorTransform`, not into the anchor.** Folding it
       into `ty` first was right for "in" and badly wrong for "out", where the
       inverse then put it through the magnification and flipped its sign — a
       +250-unit correction arriving as −900, and the overview entering from far
       above the region it was pulling out of. That function's own comment has
       the arithmetic. ⟨Sol⟩, 2026-08-30. */
    const from = p.a ? anchorTransform(p.a, p.dir, shiftY) : "scale(0.96)";
    running.current?.cancel();
    const run = g.animate(
      [
        { transform: from, opacity: 0.35 },
        { transform: "none", opacity: 1 },
      ],
      /* `fill: "none"`, so the element is back to its own untouched transform
         the moment this ends and there is nothing to clean up. A `forwards`
         fill would leave the picture wearing the last keyframe, which is
         identity today and would silently become a trap the first time the
         keyframes changed. */
      { duration: 280, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", fill: "none" },
    );
    running.current = run;
    return () => {
      run.cancel();
      if (running.current === run) running.current = null;
    };
  }, [nav]);

  /**
   * **Where focus goes when the thing holding it is gone.**
   *
   * A region's name is a `button` inside the picture, and pressing it opens the
   * scene that name refers to — which is a scene with no such region in it, so
   * the element with focus unmounts and focus falls to `<body>`. A keyboard
   * reader is then nowhere, with no announcement of where they arrived.
   * ⟨Sol⟩, 2026-08-30.
   *
   * So focus moves to the picture itself, which is the listbox and the one tab
   * stop the scene has. Its `aria-label` is the scene's own title and caption,
   * so being focused *is* the announcement — no live region, and nothing said
   * twice.
   *
   * Only when a control that is about to disappear asked for it. Pressing a
   * chip in the scene row must not steal focus off the row: the reader is
   * arrowing along it, and the row survives the change.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the navigation counter is the trigger; whether to take focus is a decision the press already made
  useLayoutEffect(() => {
    if (!takeFocus.current) return;
    takeFocus.current = false;
    svg.current?.focus();
  }, [nav]);

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
    if (!painted || atRow === null || open !== null) return null;
    const index = new Map(blockOrder.map((id, i) => [id, i]));
    let best: { id: string; row: number } | null = null;
    for (const n of painted.nodes) {
      const row = n.node.block ? index.get(n.node.block) : undefined;
      if (row === undefined || row > atRow) continue;
      if (!best || row > best.row) best = { id: n.node.id, row };
    }
    return best?.id ?? null;
  }, [painted, atRow, blockOrder, open]);

  /**
   * **A ghost of what is inside the region being hovered**, or `null`.
   *
   * The overview already says a region opens something — the stack behind its
   * panel and the mark beside its name. This says *what*: the scene's own nodes
   * and edges, scaled into the region's own box.
   *
   * **It is the real scene, painted by the one painter**, dropped into a nested
   * SVG viewport that scales and clips it — not a simplified redraw. See
   * `peekViewport` for what that is worth and what the simplified version threw
   * away. `null` whenever there is no room, which leaves the region alone
   * rather than dropping a bare scrim on it.
   */
  const peeked = useMemo(() => {
    if (peek === null || !painted || !sketch) return null;
    const r = painted.regions[peek];
    if (!r?.region.opens) return null;
    const target = sketch.scenes.find((sc) => sc.id === r.region.opens);
    if (!target) return null;
    const area = peekViewport(r.region, target.height, painted.height);
    if (!area) return null;
    return { ...area, target, art: paintScene(target) };
  }, [peek, painted, sketch]);

  const shown = hover ?? (painted?.nodes[focused]?.node.id ?? null);
  const card = painted?.nodes.find((n) => n.node.id === shown)?.node ?? null;

  const activate = useCallback(
    (n: PaintedNode) => {
      /* `opens` wins — see the header. The node's own box is the anchor, so the
         scene grows out of the shape that was pressed. */
      if (n.node.opens) {
        goTo(n.node.opens, n.hit);
        return;
      }
      if (n.node.block) onJump(n.node.block);
    },
    [goTo, onJump],
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
      } else if (e.key === "Escape" && open !== null && !full) {
        /* **Only when the overlay is closed.** Inside a modal, Escape belongs to
           the dialog — a reader pressing it expects the overlay to go, and
           swallowing it to pop a scene instead would leave them pressing Escape
           twice with the first press appearing to do nothing. */
        e.preventDefault();
        goTo(null, null);
      }
    },
    [painted, focused, activate, goTo, open, full],
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
            blocking={view.blocking}
            stalled={view.stalled}
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

  /**
   * **One body, rendered in whichever container is open.**
   *
   * Not two instances: the focused node, the hovered node and the open scene
   * are one piece of state, and a second copy of the picture would keep a
   * second copy of all three — so closing the overlay would put the reader back
   * where they were before they opened it rather than where they got to inside
   * it.
   */
  const body = (
    <>
      <div className="sk-bar">
        {open !== null && (
          /* **Up, and it is not the same control as the scene row.** The row
             says which parts there are and lets you go to any of them; this
             says "out of the one I am in", which is what a reader who arrived
             by pressing a region's name is looking for — they pressed a thing
             inside the overview and the way out is back, not a list. Escape
             does the same, when the overlay is not the thing Escape belongs to. */
          <Tooltip
            placement="bottom"
            keepSide
            className="tip-soon"
            content={
              <ControlTip
                head="Back"
                what="Out of the part you are inside, to the whole picture."
                how="Escape does the same, except while the picture is full screen — there Escape belongs to the overlay, and taking it would leave you pressing it twice with the first press seeming to do nothing."
              />
            }
          >
            <button
              type="button"
              className="sk-up"
              onClick={() => {
                /* This button is only rendered while a zoom is open, so pressing
                   it unmounts the thing that has focus — same hole the region
                   labels had, same fix. ⟨Sol⟩, 2026-08-30. */
                takeFocus.current = true;
                goTo(null, null);
              }}
            >
              <ChevronLeft size={13} /> Back
            </button>
          </Tooltip>
        )}
        {sketch.scenes.length > 1 ? (
          /* **The scenes as a row, not a breadcrumb.** A breadcrumb only tells
             you where you have been, which is no use when the model has drawn
             two pictures and wired nothing to reach them. This says how many
             there are and gets you to any of them, and it keeps working when
             `opens` is missing — which it is, on four of the six real drawings
             so far. One tab stop and arrows, like every other switcher here —
             and that last clause was **false for three days**: the roving
             `tabIndex` was here from the start and the arrow handler was never
             written, so a keyboard reader could reach the selected scene and
             not one of the others. A comment describing a widget the code has
             not implemented is the same mistake `DiagramPanel` made with its
             tree role, and it is worse here because the roving tabstop makes it
             look deliberate. ⟨Sol⟩, 2026-08-30. */
          // biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern, and the same call DiagramPanel's kind switcher makes
          <div className="sk-scenes" role="radiogroup" aria-label="Which part of the picture">
            <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
            {sketch.scenes.map((sc, i) => {
              const on = i === 0 ? open === null : open === sc.id;
              return (
                <Tooltip
                  key={sc.id}
                  placement="bottom"
                  keepSide
                  className="tip-soon"
                  content={
                    <ControlTip
                      head={i === 0 ? sketch.title : sc.title}
                      what={sc.caption ?? sketch.caption}
                      how={
                        i === 0
                          ? "The whole argument at once. The other pictures here are parts of it drawn larger, and this is where the you-are-here ring lives — marking a spot inside a part while you are reading somewhere else would be a confident lie about where you are."
                          : "One part of the argument, drawn at its own size. Some boxes in the overview open straight into it; this row is the way in that does not depend on the model having wired one."
                      }
                    />
                  }
                >
                  {/* biome-ignore lint/a11y/useSemanticElements: see above */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    /* **A tab stop each, and no arrow keys.** The roving
                       tabindex and its arrow handler went on 2026-08-31 with
                       the other four switchers in this app. On this page the
                       arrows belong to the article — ↑ / ↓ step it and ← / →
                       choose the stride (docs/project/keyboard.md) — and every
                       one of these handlers called `stopPropagation` to win
                       that collision, so all four keys died wherever one of
                       these held focus. Greg met it as a bug and asked for the
                       behaviour removed. Dock.tsx § the mode switch has the
                       full reasoning and what the extra tab stops cost;
                       tests/arrows-belong-to-the-article.test.tsx sweeps for a
                       sixth one coming back. */
                    tabIndex={0}
                    className={`sk-scene${on ? " on" : ""}`}
                    data-sk-scene={sc.id}
                    onClick={() => goTo(i === 0 ? null : sc.id, null)}
                  >
                    {i === 0 ? sketch.title : sc.title}
                  </button>
                </Tooltip>
              );
            })}
            </TooltipGroup>
          </div>
        ) : (
          <span className="sk-title" title={sketch.caption}>
            {sketch.title}
          </span>
        )}
        <Tooltip
          placement="bottom"
          keepSide
          className="tip-soon"
          content={
            <ControlTip
              head={full ? "Close" : "Enlarge"}
              what={
                full
                  ? "Put the picture back in the band beside the article."
                  : "The same picture at its own size, filling the window."
              }
              how="The canvas is 760 units wide and the band is under 400 pixels, so in the band the text lands at about five pixels: what survives there is the shape, and the card below is where the words are. Nothing about the picture changes between the two except its scale."
            />
          }
        >
          <button type="button" className="sk-zoom" onClick={() => setFull((v) => !v)}>
            {full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {full ? "Close" : "Enlarge"}
          </button>
        </Tooltip>
      </div>

      {/* **A redraw the reader did not start is still a redraw.** `useStepJob`
          reads the queue rather than remembering a click, precisely so a run
          started from the CLI, the shelf or another tab shows up — and this was
          the surface that then did nothing with the answer, so the picture
          changed under the reader two minutes later with nothing having said it
          was going to. Greg, 2026-08-30: *"Make sure the diagrams in Diagram
          mode show loading spinners if they're generating."*

          Not `JobProgress`: that row carries a Stop button and, with no job, the
          Draw button — and offering a $0.20 redraw beside a picture that is
          already there is a product decision this is not. This says what is
          happening and nothing else. The step's own label, off the server, so
          the words are the words the shelf shows for the same run. */}
      {view.job && (
        <p className="sk-busy" role="status">
          <LoaderCircle className="cmt-spinner" size={12} aria-hidden="true" />
          {view.job.status === "queued"
            ? "Waiting for the queue…"
            : (view.job.steps.find((s) => s.name === "sketch")?.label ?? "Drawing…")}
        </p>
      )}

      {/* **And the spinner going away is not the same as the work succeeding.**
          A redraw that came back failed left the picture standing and said
          nothing, which reads as a completed run that changed nothing — after
          two minutes and $0.20. The server's own words, per copy.md. ⟨Sol⟩. */}
      {!view.job && view.failed && <p className="sk-failed">{view.failed}</p>}

      {notes.length > 0 && <p className="sk-note">{notes.join(" ")}</p>}

      <div className="sk-scroll" ref={scroll}>
        {/* biome-ignore lint/a11y/useSemanticElements: SVG has no listbox element; the roles are written out for the same reason scatter.ts's are — the DOM is flat and nothing in the markup says this is the third of twelve */}
        <svg
          ref={svg}
          className="sk-svg"
          viewBox={`0 0 ${painted.width} ${painted.height}`}
          /* **Always the container's width.** In the band that is 288–400px and
             the shape is what survives; in the overlay it is most of the window
             and the same layout arrives at 17–20px text. Nothing about the
             picture changes between them except its scale, which is the whole
             point of a `viewBox`. */
          width="100%"
          preserveAspectRatio="xMidYMin meet"
          role="listbox"
          /* **The listbox owns one tab stop and moves a roving marker over its
             options**, so the *selection* has to be announced by name — without
             this a screen reader hears the listbox once and nothing at all as
             the reader arrows through it. `aria-selected` is the visual half and
             was all this had; a browser pass caught the other half, 2026-08-30.
             `OutlinePanel.tsx` makes the same call for the same reason. */
          aria-activedescendant={
            painted.nodes[focused] ? `${uid}-${painted.nodes[focused].node.id}` : undefined
          }
          aria-label={`${scene.title}. ${scene.caption ?? sketch.caption}`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          <title>{scene.caption ?? sketch.caption}</title>
          {/* **Everything that is drawn hangs off one group, so the zoom has a
              single thing to move.** The `<title>` stays outside it: it is what
              the accessibility tree reads, not something on the canvas, and an
              animation has no business touching it. */}
          <g ref={attachStage} className="sk-stage">
          {/* biome-ignore lint/suspicious/noArrayIndexKey: a drawing primitive has no identity of its own — `paintScene` is a pure function of the scene, so the whole list is replaced together whenever the scene changes and an index cannot come to mean a different thing. Minting ids would be inventing identity to satisfy a rule about preserving it. */}
          {painted.behind.map((p, i) => (
            <Shape key={`b${i}`} p={p} />
          ))}
          {/* biome-ignore lint/suspicious/noArrayIndexKey: see above */}
          {painted.links.map((p, i) => (
            <Shape key={`l${i}`} p={p} />
          ))}

          {/* **A region's NAME is a way into the part it names.** The overview
              has already said these boxes are one movement of the piece, and a
              zoom scene is that movement drawn larger — so the name is the most
              natural handle there is, and a reader pressing it is pointing at
              exactly the thing they want more of. Greg asked for it by example:
              *"click on the subsection (e.g. 'Why we're tempted to see it')"*.

              Only the words, never the panel: a region is a large area lying
              behind the nodes, and making all of it pressable would put a second
              meaning on every pixel between the boxes. */}
          {painted.regions.map((r, i) =>
            r.region.opens && r.hit ? (
              /* biome-ignore lint/a11y/useKeyWithClickEvents: reached by Tab and activated by Enter as a real `button` role with its own tabIndex — unlike the nodes, which share the picture's single tab stop because there are thirty of them */
              <g
                key={`${r.region.label}-${r.region.x}-${r.region.y}`}
                className="sk-region-open"
                role="button"
                tabIndex={0}
                aria-label={`Open ${r.region.label}`}
                onClick={(e) => {
                  /* The picture is one tab stop and this is another inside it,
                     so the press must not also reach the listbox behind. */
                  e.stopPropagation();
                  takeFocus.current = true;
                  goTo(r.region.opens as string, r.region);
                }}
                onKeyDown={(e) => {
                  /* **The arrows are swallowed here too, and that is a fix.**
                     This group is focusable and sits inside the listbox, so
                     an arrow pressed on a region's name bubbled to the
                     picture's own handler and walked the roving marker over
                     nodes the reader could not see moving — the selection
                     changing while focus was somewhere else entirely.
                     ⟨Sol⟩, 2026-08-30. */
                  if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
                    /* **Both, and `stopPropagation` alone was half a fix.** It
                       stopped the arrows walking the listbox's marker behind
                       this group, and left the browser's own default — which on
                       a focused element inside a scrollable box is to scroll
                       `.sk-scroll`, or the page. So the selection no longer
                       moved and the picture did instead. ⟨Sol⟩, 2026-08-30. */
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                  }
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  e.stopPropagation();
                  takeFocus.current = true;
                  goTo(r.region.opens as string, r.region);
                }}
                onMouseEnter={() => setPeek(i)}
                onMouseLeave={() => setPeek((was) => (was === i ? null : was))}
                onFocus={() => setPeek(i)}
                onBlur={() => setPeek((was) => (was === i ? null : was))}
              >
                {r.label.map((p, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: see the note on `behind` above
                  <Shape key={`rl${i}`} p={p} />
                ))}
                <rect className="sk-hit" x={r.hit.x} y={r.hit.y} width={r.hit.w} height={r.hit.h} />
              </g>
            ) : null,
          )}

          {painted.nodes.map((n, i) => (
            /* biome-ignore lint/a11y/useKeyWithClickEvents: the whole picture is one tab stop with its own key handler above — a handler per node is the tab-stop-per-node mistake DiagramPanel already made once */
            /* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: SVG has no element that carries `option` natively, and the roles are written out for the reason scatter.ts's are — the DOM is flat, so nothing in the markup says this is the third of twelve */
            <g
              key={n.node.id}
              id={`${uid}-${n.node.id}`}
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
              {/* biome-ignore lint/suspicious/noArrayIndexKey: see the note on `behind` above */}
              {n.prims.map((p, j) => (
                <Shape key={`p${j}`} p={p} />
              ))}
              {/* An invisible hit rectangle over the whole box, so a `bare` node
                  and the gaps inside a diamond are as clickable as a filled
                  rect. Last, so it is on top of the node's own paint. */}
              <rect className="sk-hit" x={n.hit.x} y={n.hit.y} width={n.hit.w} height={n.hit.h} />
            </g>
          ))}
          {/* biome-ignore lint/suspicious/noArrayIndexKey: see the note on `behind` above */}
          {painted.front.map((p, i) => (
            <Shape key={`f${i}`} p={p} />
          ))}

          {/* **Last, so it is over everything it veils** — the region's own
              boxes are still underneath and have to recede, or the ghost is
              drawn into a thicket. `aria-hidden` and, in the stylesheet,
              `pointer-events: none`: it is a picture of a picture, it has
              nothing to say to a screen reader that the scene row does not say
              better, and a scrim that could be hovered would fight the label
              that summoned it and flicker. */}
          {peeked && (
            <g className="sk-peek" aria-hidden="true">
              {/* The scrim starts below the region's own name — the name is the
                  control that summoned this, and veiling it would hide the one
                  thing the reader is pointing at — and it may reach further
                  DOWN than the region does, because a landscape region cannot
                  hold a portrait scene at any useful size. `peekViewport` has
                  the measurements. */}
              <rect
                className="sk-peek-scrim"
                x={peeked.scrim.x}
                y={peeked.scrim.y}
                width={peeked.scrim.w}
                height={peeked.scrim.h}
                rx={8}
              />
              {/* **A nested viewport, so the browser does the fitting and the
                  clipping.** `meet` is a uniform scale — stretching each axis
                  to fill a short wide band would turn a funnel into a rank,
                  which is a different argument from the one the model drew —
                  and an inner `<svg>` clips what will not fit rather than
                  letting it spill over the region's neighbours. */}
              <svg
                x={peeked.port.x}
                y={peeked.port.y}
                width={peeked.port.w}
                height={peeked.port.h}
                viewBox={`0 0 ${CANVAS_W} ${peeked.art.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {/* biome-ignore lint/suspicious/noArrayIndexKey: see the note on `behind` above */}
                {peeked.art.behind.map((p, i) => (
                  <Shape key={`kb${i}`} p={p} />
                ))}
                {/* biome-ignore lint/suspicious/noArrayIndexKey: see above */}
                {peeked.art.links.map((p, i) => (
                  <Shape key={`kl${i}`} p={p} />
                ))}
                {peeked.art.nodes.map((n) => (
                  <g key={n.node.id} className="sk-node">
                    {/* biome-ignore lint/suspicious/noArrayIndexKey: see above */}
                    {n.prims.map((p, j) => (
                      <Shape key={`kp${j}`} p={p} />
                    ))}
                  </g>
                ))}
                {/* biome-ignore lint/suspicious/noArrayIndexKey: see above */}
                {peeked.art.front.map((p, i) => (
                  <Shape key={`kf${i}`} p={p} />
                ))}
                {/* **And the labels of any region inside that opens something.**
                    `paintScene` keeps those out of `front` because the panel
                    draws them inside a pressable group of its own — which the
                    peek has no reason to build, and so they were the one piece
                    of non-text paint the ghost was dropping. It is the corner
                    mark that matters here: without this, a part with parts of
                    its own previewed as one that had none. ⟨Sol⟩, 2026-08-30. */}
                {peeked.art.regions.map((r) =>
                  r.region.opens ? (
                    <g key={`kr-${r.region.x}-${r.region.y}`}>
                      {/* biome-ignore lint/suspicious/noArrayIndexKey: see above */}
                      {r.label.map((p, i) => (
                        <Shape key={`krl${i}`} p={p} />
                      ))}
                    </g>
                  ) : null,
                )}
              </svg>
            </g>
          )}
          </g>
        </svg>
      </div>

      <SketchCard node={card} caption={scene.caption ?? sketch.caption} onJump={onJump} />
    </>
  );

  return (
    <div className={`sk${full ? " away" : ""}`}>
      {full ? (
        <p className="sk-elsewhere">
          The picture is full screen.{" "}
          <button type="button" className="sk-card-jump" onClick={() => setFull(false)}>
            Bring it back
          </button>
        </p>
      ) : (
        body
      )}

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click handled here is the backdrop, whose keyboard equivalent is Escape — which `<dialog>` implements itself. Lightbox.tsx makes the same call and carries the reasoning. */}
      <dialog
        ref={attachDialog}
        className="sk-full"
        aria-label={`${sketch.title}, full screen`}
        /* Light dismiss. The dialog box fills the viewport and the panel sits
           inside it, so "the target is the dialog itself" means the press landed
           outside the panel — including on the `::backdrop` underneath. */
        onClick={(e) => {
          if (e.target === dialog.current) setFull(false);
        }}
      >
        {/* Mounted only while open, so the picture's state lives in exactly one
            place and the overlay cannot hold a stale copy of it. */}
        {full && <div className="sk sk-in-full">{body}</div>}
      </dialog>
    </div>
  );
}
