/**
 * Outline mode — the whole document as one nested list that never scrolls.
 *
 * The list is built by `outlineProjection` (src/web/outline.ts), which is pure
 * and decides both what is drawn and which row is current. This file does the
 * two things that need a DOM: **choosing which rung fits**, and the keyboard.
 *
 * docs/plans/outline-mode.md has the intent, the ladder, and the reasoning.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BlockId } from "../types.js";
import {
  outlineProjection,
  RUNGS,
  type OutlineRow,
  type Rung,
} from "./outline.js";
import type { ArcCell, SummaryNode } from "./tree.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import type { NodeId, TreeNode } from "../types.js";

interface Props {
  /** The tree, nested and numbered. Null if it is unusable. */
  root: SummaryNode | null;
  supplementOf: ReadonlyMap<NodeId, TreeNode>;
  /** The arc column keyed by start row. Null until `npm run arc` has been run. */
  arcByRow: Map<number, ArcCell> | null;
  /**
   * Where the reader is — `LiveContext.focusRow`, **section-granular**.
   *
   * Worth knowing before you use it for anything finer: both of the page's
   * answers to "where is the reader" stop at the section. `?at=` stores a
   * section's first block (position.ts § sectionDepth), and `focusRow` is
   * `sections[activeSectionIndex(...)].row` (useColumnContext.ts). So no
   * paragraph is ever marked current here — see `PARAGRAPHS_ARE_NEVER_CURRENT`
   * in outline.ts for why that is honesty rather than a missing feature.
   */
  focusRow: number;
  /**
   * False where the band covers the prose instead of sitting beside it — below
   * `MODE_MIN + PROSE_MIN` in layout.ts, which is iPad portrait. Paragraph rows
   * are navigation chrome justified by the prose being visible next to them, so
   * where it is not, they are the substitution principle 1 forbids.
   */
  proseBeside: boolean;
  onJump(id: BlockId): void;
}

export function OutlinePanel({
  root,
  supplementOf,
  arcByRow,
  focusRow,
  proseBeside,
  onJump,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [rung, setRung] = useState<Rung>(1);

  /**
   * Every candidate, always built. Cheap — a few hundred objects — and building
   * all five is what lets the fit be *measured* rather than estimated.
   */
  const candidates = useMemo(
    () =>
      RUNGS.map((r) =>
        outlineProjection({
          root,
          supplementOf,
          arcByRow,
          focusRow,
          rung: r,
          allowParagraphs: proseBeside,
        }),
      ),
    [root, supplementOf, arcByRow, focusRow, proseBeside],
  );

  /**
   * **Measure, do not estimate.** The precedent in column-context.md estimated
   * a line budget from character counts and recorded GPT's dissent; the trade
   * inverts here and Sol's review of this plan said so. There it was five
   * hidden renders for each of three panels and a bad guess left a column
   * slightly blank. Here it is five for one panel, and a bad guess pushes rows
   * off a panel that cannot be scrolled. An estimator's own `data-outline-rung`
   * can only ever prove what the estimator chose — the silent-success pattern
   * exactly (docs/reusable/silent-success.md).
   *
   * No measure-resize-measure loop: the hidden candidates do not depend on
   * `rung`, so choosing one never changes what is being measured.
   */
  useLayoutEffect(() => {
    const measure = () => {
      const panel = panelRef.current;
      const box = measureRef.current;
      if (!panel || !box) return;
      const avail = panel.clientHeight;
      /* Nothing to measure against yet — a band with no laid-out height would
         make every candidate "not fit" and pin the rung at 1 for ever. Leave
         it alone and wait for the observer. */
      if (avail <= 0) return;
      let best: Rung = 1;
      for (const child of Array.from(box.children)) {
        const r = Number((child as HTMLElement).dataset.rung) as Rung;
        if ((child as HTMLElement).scrollHeight <= avail && r > best) best = r;
      }
      setRung(best);
    };
    measure();

    const ro = new ResizeObserver(measure);
    /* Two observers' worth of reasons, both learned by column-context.md: the
       panel, because the window can change height without a scroll; and the
       measuring box, because a font swap changes every row's height with
       nothing else on the page moving and no prop reporting it. */
    if (panelRef.current) ro.observe(panelRef.current);
    if (measureRef.current) ro.observe(measureRef.current);
    /* `fonts.ready` as well as the observer: a swap that leaves the box's total
       height identical while redistributing it would get past the observer. */
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [candidates]);

  const chosen = candidates[rung - 1] ?? candidates[0];
  const rows = chosen?.rows ?? [];

  /* Roving focus over one tab stop — the pattern Diagram mode already uses
     (docs/project/diagram.md § Interaction) rather than a second invention.
     A row per tab stop would put forty stops in front of the prose; no stops
     at all would make the whole of a mode unreachable, which is what the first
     draft of the plan got wrong. */
  const [focused, setFocused] = useState(0);
  useEffect(() => {
    const now = rows.findIndex((r) => r.now);
    if (now >= 0) setFocused(now);
  }, [rows]);

  const jump = useCallback(
    (row: OutlineRow | undefined) => {
      if (row) onJump(row.blockId);
    },
    [onJump],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    const step = (to: number) => {
      e.preventDefault();
      const i = Math.max(0, Math.min(rows.length - 1, to));
      setFocused(i);
      jump(rows[i]);
    };
    switch (e.key) {
      case "ArrowDown":
        return step(focused + 1);
      case "ArrowUp":
        return step(focused - 1);
      case "Home":
        return step(0);
      case "End":
        return step(rows.length - 1);
      case "Enter":
      case " ":
        e.preventDefault();
        return jump(rows[focused]);
    }
  };

  const rowId = (r: OutlineRow) => `outln-${r.node.id}`;

  return (
    <aside
      className="mode-band outln"
      aria-label="Outline"
      ref={panelRef}
      /* Evidence about the decision, never about the fit — a browser session
         can read which rung was chosen. The fit itself is asserted on the DOM
         in tests/outline-panel.test.tsx. */
      data-outline-rung={rung}
    >
      <TooltipGroup delay={{ open: 150, close: 90 }} timeoutMs={400}>
        <ol
          className="outln-list"
          role="tree"
          aria-label="The article's structure"
          tabIndex={0}
          aria-activedescendant={rows[focused] ? rowId(rows[focused]!) : undefined}
          onKeyDown={onKeyDown}
        >
          {rows.map((row, i) => (
            <Row
              key={row.node.id}
              row={row}
              id={rowId(row)}
              focused={i === focused}
              onJump={() => jump(row)}
            />
          ))}
        </ol>
      </TooltipGroup>

      {/* The candidates, measured and never seen. `aria-hidden` and out of the
          tab order, so a screen reader meets the list once.

          **Same element, same classes, same width as the real list** — an
          `<ol class="outln-list">` of `<li class="outln-row …">`, because a
          measurement of different markup is a measurement of something else.
          That is the whole point of measuring rather than estimating, and it
          would be quietly undone by a measuring copy that merely looked alike. */}
      <div className="outln-measure" aria-hidden="true" ref={measureRef}>
        {candidates.map((c) => (
          <ol className="outln-list" key={c.rung} data-rung={c.rung}>
            {c.rows.map((row) => (
              <li key={row.node.id} className={rowClass(row, false)}>
                <RowBody row={row} />
              </li>
            ))}
          </ol>
        ))}
      </div>
    </aside>
  );
}

/**
 * One row.
 *
 * **The tooltip is uncontrolled, and that is load-bearing.** The spine's cards
 * stopped working for a day because fifty triggers were made controlled off one
 * shared piece of state: `useDelayGroup` closes every *other* member the moment
 * one opens, and `useHover` schedules a departing trigger's close without
 * checking whether it is still the open one. Both are correct against a tooltip
 * that owns its own state. docs/postmortems/spine-hover-cards.md.
 */
function Row({
  row,
  id,
  focused,
  onJump,
}: {
  row: OutlineRow;
  id: string;
  focused: boolean;
  onJump(): void;
}) {
  return (
    <Tooltip
      placement="right"
      keepSide
      content={
        <div className="outln-card">
          <div className="outln-card-crumb">{row.number}</div>
          <div className="outln-card-title">{row.text}</div>
          {row.node.gist ? <p className="outln-card-gist">{row.node.gist}</p> : null}
        </div>
      }
    >
      <li
        id={id}
        role="treeitem"
        aria-level={row.level}
        aria-current={row.now ? "location" : undefined}
        aria-selected={focused}
        className={rowClass(row, focused)}
        onClick={onJump}
      >
        <RowBody row={row} />
      </li>
    </Tooltip>
  );
}

/**
 * A row's classes, written once so the visible list and the measured candidates
 * cannot drift. If these two ever disagree the panel measures one thing and
 * draws another, and nothing errors.
 */
function rowClass(row: OutlineRow, focused: boolean): string {
  return [
    "outln-row",
    `lvl-${row.level}`,
    `tier-${row.tier}`,
    row.here ? "here" : "",
    row.now ? "now" : "",
    row.before ? "read" : "",
    row.supplement ? "supplement" : "",
    focused ? "focused" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The row's content, shared with the hidden candidates so both measure alike. */
function RowBody({ row }: { row: OutlineRow }) {
  return (
    <>
      <span className="outln-num">{row.number}</span>
      <span className="outln-text">{row.text}</span>
      {row.arc ? <p className="outln-arc">{row.arc}</p> : null}
      {row.sentence ? <p className="outln-gist">{row.sentence}</p> : null}
    </>
  );
}
