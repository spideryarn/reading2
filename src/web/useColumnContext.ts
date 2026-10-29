/**
 * **Which section the reader is in**, sampled live at the focus line —
 * Structure's "you are here" (StructureMode.tsx), in both faces. "Section" is
 * whatever list it is handed: Structure hands it its frontier, which goes down
 * to a sub-section where the article has them (position.ts §
 * `structureFrontier`, plan 261029a).
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
 *
 * **`holdMs`: published at most once in that long while the reader scrolls**,
 * since 2026-10-25, for Structure's band only. Every publish there rebuilds and
 * re-measures a fitted list in a `position: fixed` band, and on an iPad that
 * band redrawn several times a second under a moving finger flickered, its
 * sub-mode row included. Greg, spya-m5gxk9: *"It probably only needs to update
 * every second or two … We don't want to use too much CPU. We don't want to
 * distract the reader too much."* A throttle, leading and trailing: the first
 * change after a quiet hold is published at once, so a slow reader sees no lag;
 * later ones wait for the hold to end and the latest is published then, so a
 * fast scroll is followed about once a second and always ends on the right
 * section. **A jump is never held** (an arrival anchor appearing or clearing),
 * nor is a new layout: somebody pressed something and is waiting for it.
 * Inside a hold nothing is read either: the rects are read on a scroll frame
 * outside one, and once when it ends.
 * docs/plans/261025e-structure-on-an-ipad-updates-calmly-and-uses-its-width.md.
 */
import { useEffect, useState } from "react";
import { activeSectionIndex, type Section } from "./position.js";
import { blockRow, rowsForBlockIds } from "./rows.js";
import { arrivalAnchor, subscribeArrivalAnchor } from "./scroll.js";
import { isFoldedAway } from "./fold.js";

/** Where the reader's eye is assumed to be, as a fraction of the viewport. */
const FOCUS_LINE = 0.4;

export interface LiveContext {
  /** The first row of the supplied item under the focus line. */
  focusRow: number;
}

const EMPTY: LiveContext = { focusRow: 0 };

interface Options {
  sections: Section[];
  /** Nothing is measured while this is off. */
  enabled: boolean;
  /** Re-measure when the layout changes — same key as the `?at=` tracker. */
  layoutKey: string;
  /**
   * Publish a scroll's change at most once per this many ms (the header §
   * `holdMs`). Absent: every change at once, as the breadcrumb wants.
   */
  holdMs?: number;
}

export function useColumnContext({ sections, enabled, layoutKey, holdMs = 0 }: Options): LiveContext {
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
    /* The hold (header § `holdMs`): when the last publish was, the timer that
       measures again once the hold is up, and whether an arrival anchor has
       changed since the last measure — heard when it happens, not sampled,
       because a glide can clear one anchor and leave the next before a frame
       runs, and a sampled "was there one" would see no change (GPT Sol, plan
       review of 261025e, finding 2). */
    let publishedAt = Number.NEGATIVE_INFINITY;
    let held = 0;
    let jumpPending = false;

    const measure = () => {
      frame = 0;
      /* **A centred arrival is where the reader is** (scroll.ts § `anchor`),
         and its top sits a little *below* the focus line — a short heading
         lands at about 45% of the window — so the line alone names the section
         before the one just clicked. While the arrival holds, the line is the
         arrived row's own top: the last section starting at or above it is the
         one that contains it. Anchor creation and clearing can happen without
         a scroll or layout change (an already-centred jump, a mode change),
         so the subscription below re-measures on those transitions too. */
      const arrived = arrivalAnchor();
      const arrivedTop = arrived ? blockRow(arrived.id)?.getBoundingClientRect().top : undefined;
      const focusLine = arrivedTop !== undefined ? arrivedTop + 1 : window.innerHeight * FOCUS_LINE;
      const tops = rows.map((el) =>
        el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
      );
      /* A folded section is never the one in focus (fold.ts). The table's
         ResizeObserver below already hears a fold, since it changes the
         table's height. `isFoldedAway`, not `isRowHidden`: the first section
         starts on the masthead's echo, hidden with its section on screen,
         and a section starting on a shut stretch's stub or behind it is on
         screen too, at its stub or its first row after (fold.ts). */
      const active = activeSectionIndex(tops, focusLine, (i) => {
        const s = sections[i];
        return s !== undefined && isFoldedAway(s.blockId);
      });
      const first = sections[0];
      /* A projection may honestly begin after row zero: a malformed stored tree
         renders visibly short, and Structure's frontier omits the root-only
         front matter rather than inventing a section for it. `activeSectionIndex`
         normally clamps above the first entry, which would mark that later part
         while the reader was still in uncovered matter. Row zero is the honest
         focus there; no projected part contains it, so both faces stay unmarked.
         A normal projection starts at zero and keeps the old clamp. */
      const beforePartialProjection =
        active === 0 && first !== undefined && first.row > 0 && (tops[0] ?? Number.POSITIVE_INFINITY) > focusLine;
      const focusRow = beforePartialProjection ? 0 : (sections[active]?.row ?? 0);
      /* A jump starting or ending is somebody pressing something: never held. */
      const jumped = jumpPending;
      jumpPending = false;
      /* This scan supersedes the trailing one whether or not its answer
         changed. In particular, an arrival frame can confirm the same section
         and hit the early return below; leaving `held` armed there would scan
         the same rows again when the old scroll timer expired. */
      if (held) {
        window.clearTimeout(held);
        held = 0;
      }
      if (focusRow === last) return;
      if (!jumped && holding()) {
        hold();
        return;
      }
      last = focusRow;
      publishedAt = performance.now();
      setLive({ focusRow });
    };
    const holding = () => performance.now() < publishedAt + holdMs;
    /* One timer for the rest of the hold; when it fires, measure again rather
       than replay an answer from the middle of it. */
    const hold = () => {
      if (!held) held = window.setTimeout(release, publishedAt + holdMs - performance.now());
    };
    const release = () => {
      held = 0;
      /* An arrival can queue its unheld frame just before this timer wins the
         event-loop race. `measure` clears `frame`, but it cannot cancel that
         callback; without doing so here the callback scans every row again on
         the next paint. The timer has the latest geometry and jumpPending, so
         it is the one measurement to keep. */
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      measure();
    };
    /* **During the hold nothing is read**, not only nothing published: a
       scroll frame inside it arms the one trailing measure and stops there,
       so a fast scroll costs a rect scan about once a second rather than every
       frame (Sol, finding 3). */
    const schedule = () => {
      if (holding()) {
        hold();
        return;
      }
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onArrival = () => {
      jumpPending = true;
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const unsubscribeAnchor = subscribeArrivalAnchor(onArrival);
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
      unsubscribeAnchor();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (held) window.clearTimeout(held);
    };
  }, [sections, enabled, layoutKey, holdMs]);

  return enabled ? live : EMPTY;
}
