/**
 * Column context — the live half. Which item each gist column is *in* right
 * now, and where the columns are on screen. See context.ts for the pure half
 * and docs/project/column-context.md for the design.
 *
 * One rAF sampler, reads only. There are already three scroll consumers on
 * this page (the `?at=` tracker, the spine, the glide in scroll.ts), and
 * GPT's review of the plan warned that a fourth one which interleaved rect
 * reads with style writes would force layout on every frame. So: every rect
 * is read, and then — only if something changed — one state update. (A
 * progress hairline that wrote a custom property per frame lived here for an
 * afternoon; Greg found it distracting and it went, 2026-08-25.)
 *
 * The line everything here is measured against is the **focus line**, 40%
 * down the viewport — where the reader is actually looking, per the fisheye
 * sketch in granularity-zoom.md. Not the sticky line `?at=` uses: a panel
 * that centred the item under the header would describe a section the eye
 * had already left.
 */
import { useEffect, useState } from "react";
import { activeSectionIndex, type Section } from "./position.js";

/** Where the reader's eye is assumed to be, as a fraction of the viewport. */
export const FOCUS_LINE = 0.4;

export interface ColumnRect {
  left: number;
  width: number;
  /**
   * The header row's bottom edge on screen — where a panel over this column
   * must start. Not a constant: the controls bar and header are sticky, so
   * near the top of the page they sit *below* the masthead, and a panel fixed
   * at their eventual height would paint over the masthead and hide its own
   * first entry behind the bars.
   */
  top: number;
}

export interface LiveContext {
  /** The row under the focus line. */
  focusRow: number;
  /** Screen position of each gist column's header, keyed by depth. */
  rects: Map<number, ColumnRect>;
  /**
   * The right edge of the pinned left column. A panel is `position: fixed` at
   * its column's measured x, so when the page is scrolled right and a middle
   * column slides *under* the pinned one, its panel would keep painting on top
   * of it — the cells go under, the panel does not. Panels clip themselves to
   * the right of this, which is what the cells underneath already do.
   */
  clipLeft: number;
  /**
   * The viewport height, so a height-only resize reaches React: the panels
   * centre and clamp against it, and without it here a taller window left
   * them holding the old 40% line until the next section boundary.
   */
  viewportH: number;
}

const EMPTY: LiveContext = { focusRow: 0, rects: new Map(), viewportH: 0, clipLeft: 0 };

interface Options {
  sections: Section[];
  /** The gist depths on screen, for finding their headers. */
  depths: number[];
  /** Nothing is measured while every mode is off. */
  enabled: boolean;
  /** Re-measure when the columns change — same key as the `?at=` tracker. */
  layoutKey: string;
}

export function useColumnContext({
  sections,
  depths,
  enabled,
  layoutKey,
}: Options): LiveContext {
  const [live, setLive] = useState<LiveContext>(EMPTY);

  // `layoutKey` is a re-run trigger, not a value the effect reads: the columns
  // changed, so the row elements it holds are stale. Same as useReadingPosition.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger
  useEffect(() => {
    if (!enabled) return;
    const rows = sections.map((s) =>
      document.querySelector<HTMLElement>(`tr[data-block="${CSS.escape(s.blockId)}"]`),
    );
    const heads = new Map(
      depths.map((d) => [d, document.querySelector<HTMLElement>(`thead th[data-col="${d}"]`)]),
    );
    const pin = document.querySelector<HTMLElement>("thead th.pin-left");
    const table = document.querySelector<HTMLElement>("table.zoom");
    let last: LiveContext = EMPTY;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const focusLine = window.innerHeight * FOCUS_LINE;
      const tops = rows.map((el) =>
        el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
      );
      const focusRow = sections[activeSectionIndex(tops, focusLine)]?.row ?? 0;

      const rects = new Map<number, ColumnRect>();
      for (const [d, th] of heads) {
        if (!th) continue;
        const r = th.getBoundingClientRect();
        rects.set(d, { left: r.left, width: r.width, top: r.bottom });
      }
      const viewportH = window.innerHeight;
      const clipLeft = pin?.getBoundingClientRect().right ?? 0;

      const same =
        focusRow === last.focusRow &&
        viewportH === last.viewportH &&
        clipLeft === last.clipLeft &&
        rects.size === last.rects.size &&
        [...rects].every(([d, r]) => {
          const o = last.rects.get(d);
          return o && o.left === r.left && o.width === r.width && o.top === r.top;
        });
      if (same) return;
      last = { focusRow, rects, viewportH, clipLeft };
      setLive(last);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Scroll and resize are not the only ways the answer changes. A late image
    // or a font swap reflows the table under a still page: the focus line then
    // sits in a different section and nothing tells us, so the panels keep
    // naming the old one until the reader happens to scroll. Watching the table
    // itself catches that, and catches a column width change too — which moves
    // every panel and used to need a window resize to be noticed.
    const ro = table ? new ResizeObserver(schedule) : null;
    if (table && ro) ro.observe(table);
    measure();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections, depths, enabled, layoutKey]);

  return enabled ? live : EMPTY;
}
