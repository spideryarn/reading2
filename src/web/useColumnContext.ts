/**
 * Column context — the live half. Which item each gist column is *in* right
 * now, where the columns are on screen, and how far through the current item
 * the reader is. See context.ts for the pure half and
 * docs/project/column-context.md for the design.
 *
 * One rAF sampler, reads before writes. There are already three scroll
 * consumers on this page (the `?at=` tracker, the spine, the glide in
 * scroll.ts), and GPT's review of the plan warned that a fourth one which
 * interleaved rect reads with style writes would force layout on every frame,
 * exactly at the moment the sticky cells hand over. So: every rect is read
 * first, then the one imperative write, then — only if a *row* changed — a
 * state update. Progress never touches React state: it changes every frame
 * while scrolling and is written straight to a custom property,
 * `--ctx-progress-<depth>` on the root element, that the hairline reads.
 *
 * Two lines, named separately, because they are not the same thing:
 *
 *  - `row` is under the **sticky line**, `stickyOffset() + 1` — the same line
 *    `?at=` is measured against, and the moment the table's own sticky cells
 *    hand over. The in-cell modes use it so the list changes exactly when the
 *    cell it lives in does.
 *  - `focusRow` is under the **focus line**, 40% down the viewport — where the
 *    reader is actually looking, per the fisheye sketch in granularity-zoom.md.
 *    The centred panel uses it: a panel that centred the item at the top edge
 *    would describe a section the eye had already left.
 */
import { useEffect, useState } from "react";
import { activeSectionIndex, type Section } from "./position.js";
import { stickyOffset } from "./scroll.js";
import { currentIndex } from "./context.js";

/** Where the reader's eye is assumed to be, as a fraction of the viewport. */
export const FOCUS_LINE = 0.4;

export interface ColumnRect {
  left: number;
  width: number;
}

export interface LiveContext {
  row: number;
  focusRow: number;
  /** Screen position of each gist column's header, keyed by depth. */
  rects: Map<number, ColumnRect>;
  /**
   * The viewport height, so a height-only resize reaches React: the panels
   * centre and clamp against it, and without it here a taller window left
   * them holding the old 40% line until the next section boundary.
   */
  viewportH: number;
}

const EMPTY: LiveContext = { row: 0, focusRow: 0, rects: new Map(), viewportH: 0 };

interface Options {
  sections: Section[];
  /** Item start rows per gist depth, for finding the current cell. */
  starts: Map<number, number[]>;
  /** Nothing is measured while every mode is off. */
  enabled: boolean;
  /** Re-measure when the columns change — same key as the `?at=` tracker. */
  layoutKey: string;
  wantRects: boolean;
  wantProgress: boolean;
  /** Which line the hairline measures from — the one that chose the item under it. */
  progressLine: "sticky" | "focus";
}

export function useColumnContext({
  sections,
  starts,
  enabled,
  layoutKey,
  wantRects,
  wantProgress,
  progressLine,
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
      [...starts.keys()].map((d) => [
        d,
        document.querySelector<HTMLElement>(`thead th[data-col="${d}"]`),
      ]),
    );
    const root = document.documentElement;
    let last: LiveContext = EMPTY;
    let frame = 0;

    const measure = () => {
      frame = 0;
      // ---- reads ----
      const line = stickyOffset() + 1;
      const focusLine = window.innerHeight * FOCUS_LINE;
      const tops = rows.map((el) =>
        el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
      );
      const row = sections[activeSectionIndex(tops, line)]?.row ?? 0;
      const focusRow = sections[activeSectionIndex(tops, focusLine)]?.row ?? 0;

      const rects = new Map<number, ColumnRect>();
      if (wantRects) {
        for (const [d, th] of heads) {
          if (!th) continue;
          const r = th.getBoundingClientRect();
          rects.set(d, { left: r.left, width: r.width });
        }
      }

      const progress = new Map<number, number>();
      if (wantProgress) {
        const [pRow, pLine] = progressLine === "focus" ? [focusRow, focusLine] : [row, line];
        for (const [d, s] of starts) {
          const start = s[currentIndex(s, pRow)];
          if (start === undefined) continue;
          const td = document.querySelector<HTMLElement>(`td[data-cell="${d}:${start}"]`);
          if (!td) continue;
          const r = td.getBoundingClientRect();
          progress.set(d, r.height > 0 ? Math.min(1, Math.max(0, (pLine - r.top) / r.height)) : 0);
        }
      }
      const viewportH = window.innerHeight;

      // ---- writes ----
      for (const [d, p] of progress) root.style.setProperty(`--ctx-progress-${d}`, p.toFixed(3));

      const same =
        row === last.row &&
        focusRow === last.focusRow &&
        viewportH === last.viewportH &&
        rects.size === last.rects.size &&
        [...rects].every(([d, r]) => {
          const o = last.rects.get(d);
          return o && o.left === r.left && o.width === r.width;
        });
      if (same) return;
      last = { row, focusRow, rects, viewportH };
      setLive(last);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      for (const d of starts.keys()) root.style.removeProperty(`--ctx-progress-${d}`);
    };
  }, [sections, starts, enabled, layoutKey, wantRects, wantProgress, progressLine]);

  return enabled ? live : EMPTY;
}
