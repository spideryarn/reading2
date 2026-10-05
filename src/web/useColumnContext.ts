/**
 * **Which section the reader is in**, sampled live at the focus line —
 * Structure's "you are here" (StructureMode.tsx), in both faces.
 *
 * The name is the gist columns': this was the live half of column context,
 * which also measured where each gist column sat on screen so a fisheye panel
 * could be laid over it (docs/project/column-context.md). The columns went with
 * the Hierarchy mode on 2026-09-29
 * (docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md), and the
 * rects, the pinned-column clip and the viewport heights went with them; the
 * focus row is what outlived them.
 *
 * One rAF sampler, reads only. There are already three scroll consumers on
 * this page (the `?at=` tracker, the spine, the glide in scroll.ts), and
 * GPT's review of the plan warned that a fourth one which interleaved rect
 * reads with style writes would force layout on every frame. So: every rect
 * is read, and then — only if something changed — one state update.
 *
 * The line everything here is measured against is the **focus line**, 40%
 * down the viewport — where the reader is actually looking, per the fisheye
 * sketch in granularity-zoom.md. Not the sticky line `?at=` uses: a view that
 * marked the item under the header would describe a section the eye had
 * already left.
 */
import { useEffect, useState } from "react";
import { activeSectionIndex, type Section } from "./position.js";
import { blockRow, rowsForBlockIds } from "./rows.js";
import { arrivalAnchor } from "./scroll.js";
import { isFolded } from "./fold.js";

/** Where the reader's eye is assumed to be, as a fraction of the viewport. */
const FOCUS_LINE = 0.4;

export interface LiveContext {
  /** The row under the focus line — a section's first row, never finer. */
  focusRow: number;
}

const EMPTY: LiveContext = { focusRow: 0 };

interface Options {
  sections: Section[];
  /** Nothing is measured while this is off. */
  enabled: boolean;
  /** Re-measure when the layout changes — same key as the `?at=` tracker. */
  layoutKey: string;
}

export function useColumnContext({ sections, enabled, layoutKey }: Options): LiveContext {
  const [live, setLive] = useState<LiveContext>(EMPTY);

  // `layoutKey` is a re-run trigger, not a value the effect reads: the layout
  // changed, so the row elements it holds are stale. Same as useReadingPosition.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger
  useEffect(() => {
    if (!enabled) return;
    /* One pass over the table, not one document scan per section — see
       rows.ts, and the measurements in
       docs/plans/260905d-mode-switching-is-sluggish-on-a-very-long-article.md. */
    const rows = rowsForBlockIds(sections.map((s) => s.blockId));
    const table = document.querySelector<HTMLElement>("table.zoom");
    /* `live` may still name a later section from the preceding effect. The
       first measurement of each fresh row set must therefore publish even
       when its answer is row zero; seeding this with zero would mistake that
       answer for an unchanged measurement and leave the stale row selected. */
    let last: number | null = null;
    let frame = 0;

    const measure = () => {
      frame = 0;
      /* **A centred arrival is where the reader is** (scroll.ts § `anchor`),
         and its top sits a little *below* the focus line — a short heading
         lands at about 45% of the window — so the line alone names the section
         before the one just clicked. While the arrival holds, the line is the
         arrived row's own top: the last section starting at or above it is the
         one that contains it. No listener of its own: the reader scrolling
         or the layout changing ends the hold and re-runs this. A mode change
         ends it without either, and the arrived section then stays marked
         until the next scroll — the page has not moved, so it is still true. */
      const arrived = arrivalAnchor();
      const arrivedTop = arrived ? blockRow(arrived.id)?.getBoundingClientRect().top : undefined;
      const focusLine = arrivedTop !== undefined ? arrivedTop + 1 : window.innerHeight * FOCUS_LINE;
      const tops = rows.map((el) =>
        el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
      );
      /* A folded section is never the one in focus (fold.ts). The table's
         ResizeObserver below already hears a fold, since it changes the
         table's height. */
      const focusRow =
        sections[
          activeSectionIndex(tops, focusLine, (i) => {
            const s = sections[i];
            return s !== undefined && isFolded(s.blockId);
          })
        ]?.row ?? 0;
      if (focusRow === last) return;
      last = focusRow;
      setLive({ focusRow });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Scroll and resize are not the only ways the answer changes. A late image
    // or a font swap reflows the table under a still page: the focus line then
    // sits in a different section and nothing tells us, so the view keeps
    // naming the old one until the reader happens to scroll. Watching the table
    // itself catches that.
    const ro = table ? new ResizeObserver(schedule) : null;
    if (table && ro) ro.observe(table);
    measure();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections, enabled, layoutKey]);

  return enabled ? live : EMPTY;
}
