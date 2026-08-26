/**
 * The spine — a bird's-eye rail down the far left.
 *
 * It read "always visible" here until 2026-08-26, and that was already only
 * nearly true (outline mode drops it); it is now a `Spine` pill in the controls
 * bar and a `?spine=` parameter, so the reader can put it away in any mode.
 * Whether it is on screen at all, and whether it shows labels or ticks, are
 * both decided in layout.ts § fitView — never here.
 *
 * Greg, 2026-08-25:
 *
 * > I want the left-hand most column to show a bird's eye view. So perhaps the
 * > first and maybe second levels of the table of contents in a fairly
 * > information dense way … but I need a way to see where I am in the whole
 * > article.
 *
 * It is a *proportional* rail, not a list: each L1 gets vertical space in
 * proportion to how much of the document it actually occupies, so the rail is a
 * squashed picture of the article rather than an index of it, and the
 * you-are-here band is a genuine position indicator rather than a decoration.
 * The cost, accepted deliberately: a short part gets a sliver too thin to hold
 * its own label. See granularity-zoom.md#the-spine-a-birds-eye-rail.
 *
 * Why it is not a table column: an overview has to be visible all at once, and
 * consecutive rows of the table are hundreds or thousands of pixels apart, so a
 * column can only ever show you the entry you are standing in. Hence a separate
 * `position: fixed` rail, sized to the viewport.
 *
 * Segments are sized from MEASURED PIXEL HEIGHTS, not from word counts. That
 * matters: in outline mode every row collapses to one line, so a 900-word part
 * and a 100-word part become nearly the same height on screen, and a word-count
 * rail would then point at the wrong place. Measuring means the rail is correct
 * in both modes for free.
 *
 * The detail a sliver cannot hold lives in a hover tooltip on each hit target —
 * the part it belongs to, its gist, what is inside it, how far into the piece it
 * sits. That is the payoff of a proportional rail rather than an apology for it.
 * See BandCard at the bottom of this file, and docs/project/tooltips.md.
 *
 * L2 lives in the rail as tick marks and invisible click targets, never as
 * labels in the band. Labels in the band cannot work: children exactly
 * partition their parent, so the first child's label always starts at exactly
 * the same pixel as its parent's and the two collide. The current L1 and L2 are
 * named in the header strip at the top of the rail instead, where they are
 * legible however thin the band is.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { OutlineEntry } from "./tree.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";

interface Band {
  entry: OutlineEntry;
  /** Offsets in document pixels, relative to the top of the first row. */
  top: number;
  height: number;
  /** For an L2, the title of the L1 it belongs to. */
  // `| undefined` explicitly: bandFor passes the argument through whether or
  // not the caller supplied one, and a top-level band genuinely has no parent.
  parentTitle?: string | undefined;
}

interface Metrics {
  docTop: number;
  docHeight: number;
  l1: Band[];
  l2: Band[];
  /** The clickable/hoverable bands — see `measure`. */
  hits: Band[];
}

/**
 * Read the table's real geometry out of the DOM.
 *
 * Rows are found by query rather than through a ref, because the spine sits
 * outside the table and deliberately knows nothing about it beyond the one
 * contract that already holds everywhere else in this app: every block is
 * addressed by its stable id (docs/project/block-ids.md), and the row carrying
 * a block is `tr[data-block="<id>"]`.
 */
function measure(outline: OutlineEntry[]): Metrics | null {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("tbody tr[data-block]"),
  );
  if (rows.length === 0) return null;

  const sy = window.scrollY;
  const tops = rows.map((r) => r.getBoundingClientRect().top + sy);
  const docTop = tops[0]!;
  const docBottom = rows[rows.length - 1]!.getBoundingClientRect().bottom + sy;
  const docHeight = Math.max(1, docBottom - docTop);

  // The top edge of row `i`, or the very bottom of the table for the row just
  // past the end. Row indices come from the tree, so a tree that disagrees with
  // the blocks array clamps here rather than reading past the end.
  const edge = (row: number) => (row < tops.length ? tops[row]! : docBottom);

  const bandFor = (e: OutlineEntry, parentTitle?: string): Band => ({
    entry: e,
    top: edge(e.startRow) - docTop,
    height: Math.max(0, edge(e.endRow + 1) - edge(e.startRow)),
    parentTitle,
  });

  // L2s are rendered as siblings in the same track rather than nested inside
  // their parent's element, so every band shares one coordinate system and
  // there is no relative-offset arithmetic to get wrong.
  return {
    docTop,
    docHeight,
    l1: outline.map((e) => bandFor(e)),
    l2: outline.flatMap((e) => e.children.map((c) => bandFor(c, e.node.title))),
    // Hit targets must tile the whole rail, or a stretch of the article has no
    // tooltip and nothing to click. L2s partition their parent, so they cover
    // it exactly — *unless* a part has no children at all, and then the part
    // itself stands in for them.
    hits: outline.flatMap((e) =>
      e.children.length > 0
        ? e.children.map((c) => bandFor(c, e.node.title))
        : [bandFor(e)],
    ),
  };
}

interface Props {
  outline: OutlineEntry[];
  /** Changes whenever the table's layout could have changed, forcing a re-measure. */
  layoutKey: string;
  /** Collapsed to a tick-only rail, with no room for labels. */
  narrow: boolean;
  onJump(blockId: string): void;
}

/** Where in the viewport we consider the reader to be reading. */
const READING_LINE = 0.35;

export function Spine({ outline, layoutKey, narrow, onJump }: Props) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [viewportH, setViewportH] = useState(() => window.innerHeight);

  // ---- measurement -------------------------------------------------------
  // `layoutKey` is a re-run trigger, not a value this effect reads — that is
  // the whole point of the prop (see its doc comment above). Biome sees it
  // unused in the body and its autofix DELETES it from the deps, which stops
  // the spine re-measuring when the table's layout changes. Don't apply it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger
  useLayoutEffect(() => {
    let raf = 0;
    const run = () => {
      // Debounced through rAF: ResizeObserver fires during layout, and setting
      // state synchronously from it is how you get the "loop completed with
      // undelivered notifications" warning.
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setMetrics(measure(outline));
        setViewportH(window.innerHeight);
      });
    };
    run();

    const ro = new ResizeObserver(run);
    ro.observe(document.body);
    window.addEventListener("resize", run);
    // Webfonts land after first paint and change every row height with them.
    document.fonts?.ready.then(run).catch(() => {});

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", run);
      cancelAnimationFrame(raf);
    };
  }, [outline, layoutKey]);

  // ---- scroll position ---------------------------------------------------
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScrollY(window.scrollY);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const docHeight = metrics?.docHeight ?? 1;
  const pct = useCallback(
    (v: number) => `${(v / docHeight) * 100}%`,
    [docHeight],
  );

  /** The bands the reading line currently falls in. */
  const here = useMemo(() => {
    if (!metrics) return { l1: null as Band | null, l2: null as Band | null };
    const pos = scrollY + viewportH * READING_LINE - metrics.docTop;
    const inBand = (b: Band) => pos >= b.top && pos < b.top + b.height;
    // Past the end of the last band (a short document, or the footer) we stay
    // on the last part rather than showing nothing.
    const last = metrics.l1[metrics.l1.length - 1] ?? null;
    return {
      l1: metrics.l1.find(inBand) ?? (pos >= 0 ? last : metrics.l1[0] ?? null),
      l2: metrics.l2.find(inBand) ?? null,
    };
  }, [metrics, scrollY, viewportH]);

  if (!metrics || metrics.l1.length === 0) {
    // Tagged for the keyboard even while it is empty: the rail occupies its
    // width from the first paint but only measures on the next frame, and a
    // rail that quietly meant "sections" for that frame would be a level that
    // changed under the pointer without the pointer moving.
    return <aside className="spine" aria-hidden="true" data-nav-depth={1} />;
  }

  return (
    <aside
      className={`spine${narrow ? " narrow" : ""}`}
      aria-label="Article outline"
      /* The whole rail is one keyboard-navigation zone, meaning L1: it draws
         parts as bands and names the current one in the header strip, so ↑ / ↓
         over it step part by part. Its click targets are L2 — finer than its
         bands, because a 1px tick is unhittable — but that is a pointing
         concession, not what the rail is *about*. See keynav.ts. */
      data-nav-depth={1}
    >
      {/* Where you are, spelled out. The bands below can be one pixel tall;
          this never is. */}
      {!narrow && (
        <div className="spine-here">
          <div className="spine-here-part">{here.l1?.entry.node.title ?? "—"}</div>
          {here.l2 && <div className="spine-here-sub">{here.l2.entry.node.title}</div>}
        </div>
      )}

      <div className="spine-track">
        {metrics.l1.map((b) => {
          const active = b.entry.node.id === here.l1?.entry.node.id;
          return (
            <div
              key={b.entry.node.id}
              className={`spine-part${active ? " active" : ""}`}
              style={{ top: pct(b.top), height: pct(b.height) }}
            >
              <span className="spine-label">{b.entry.node.title}</span>
            </div>
          );
        })}

        {/* Subdivision is always drawn, so the shape of the article is visible
            even where there is no room for a word of it. */}
        {metrics.l2.map((b) => (
          <div
            key={`tick-${b.entry.node.id}`}
            className="spine-tick"
            style={{ top: pct(b.top) }}
          />
        ))}

        {/* Transparent hit targets, one per L2, laid over the parts. Clicking
            the rail therefore lands on the finest level the rail knows about,
            which is more precise than the part it sits in, and a 1px tick is
            not something anyone can hit.

            They are also where the detail lives. The rail is proportional, so
            most bands are too thin for a label and the thinnest are too thin
            for anything — the tooltip is the only place a two-pixel section can
            say what it is. Grouped, so that once one is open, running the
            pointer down the rail reads the article's sections one after another
            with no re-wait: the rail becomes scrubbable. */}
        <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
          {metrics.hits.map((b) => (
            <Tooltip
              key={`hit-${b.entry.node.id}`}
              placement="right"
              className="tip-band"
              content={
                <BandCard
                  band={b}
                  position={Math.round((b.top / docHeight) * 100)}
                />
              }
            >
              <button
                type="button"
                className="spine-hit"
                style={{ top: pct(b.top), height: pct(b.height) }}
                /* The tooltip is the button's *description*, not its name —
                   useRole wires it up as aria-describedby — so the name still
                   has to be said here, or a screen reader reads fifty
                   identically anonymous buttons. */
                aria-label={
                  b.parentTitle
                    ? `${b.parentTitle} › ${b.entry.node.title}`
                    : b.entry.node.title
                }
                onClick={() => onJump(b.entry.node.range[0])}
              />
            </Tooltip>
          ))}
        </TooltipGroup>

        {/* The viewport band: how much of the article is on screen right now,
            and where. This is the "where am I" the whole rail exists for. */}
        <div
          className="spine-viewport"
          style={{ top: pct(scrollY - metrics.docTop), height: pct(viewportH) }}
        />
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------- the card ----
   What a band says when you hover it.

   The rail is proportional by design, which means most bands cannot hold their
   own label and the shortest sections are a couple of pixels tall. Everything
   the rail has to leave out is here: which part this section belongs to, what
   it says, what it subdivides into, and where it sits in the whole piece.

   navLabel appears here and only because this is navigation chrome — the spine
   is one of the two places the node shape sanctions it (granularity-zoom.md
   #node-shape). It is never a fallback for a missing gist in the reading view. */

/** Beyond this many sub-sections the list stops being scannable at a glance. */
const MAX_CHILDREN = 5;

function BandCard({ band, position }: { band: Band; position: number }) {
  const { node, words, children } = band.entry;
  return (
    <>
      {band.parentTitle && <div className="tip-crumb">{band.parentTitle}</div>}
      <div className="tip-title">
        {node.title}
        {node.sourceHeading && <span className="tip-own">§</span>}
      </div>
      {node.gist ? (
        <p className="tip-gist">{node.gist}</p>
      ) : node.navLabel ? (
        <p className="tip-gist tip-navlabel">{node.navLabel}</p>
      ) : null}
      {children.length > 0 && (
        <ul className="tip-kids">
          {children.slice(0, MAX_CHILDREN).map((c) => (
            <li key={c.node.id}>{c.node.title}</li>
          ))}
          {children.length > MAX_CHILDREN && (
            <li className="tip-more">
              + {children.length - MAX_CHILDREN} more
            </li>
          )}
        </ul>
      )}
      <div className="tip-foot">
        <span>{words.toLocaleString()} words</span>
        <span>{position}% in</span>
      </div>
    </>
  );
}
