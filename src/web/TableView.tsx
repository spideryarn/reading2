/**
 * The tabular granularity view — see tree.ts for the geometry, and
 * docs/project/granularity-zoom.md#the-tabular-view for the intent.
 *
 * One row per block. Columns run coarse (left) to verbatim (right), exactly as
 * described in the brief: "so by scrolling rightwards, you get more detail. By
 * scrolling downwards, you progress through the chronology of the article."
 *
 * Two modes, one table:
 *  - Reading mode (text column on) — gists beside the real prose.
 *  - Outline mode (text column off) — rows collapse to their natural height and
 *    the same table becomes a compact, whole-article table of contents. The
 *    leaf column appears only here, carrying navLabels. That is the one place
 *    navLabels belong: navigation chrome, never shown in place of prose that
 *    could be displayed (granularity-zoom.md#node-shape).
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryState } from "nuqs";
import type { Article, BlockId, Comment, NodeId } from "../types.js";
import { columnLabel, type ArcCell, type Geometry } from "./tree.js";
import type { Layout } from "./layout.js";
import { annotateHtml, renderedText, resolveMark, type Mark } from "./annotate.js";
import { readSelection } from "./selection.js";
import type { Section } from "./position.js";
import {
  currentIndex,
  isPanel,
  itemsFromCells,
  levelList,
  neighbours,
  siblingList,
  type ContextItem,
} from "./context.js";
import { ContextList } from "./ContextList.js";
import { ContextPanel } from "./ContextPanel.js";
import { useColumnContext } from "./useColumnContext.js";
import { ctxParam, progParam } from "./params.js";

interface Props {
  article: Article;
  /** Built once in App, because the reading-position code needs it too. */
  geometry: Geometry;
  /** Visible column depths, coarse to fine. Chosen by layout.ts § fitView. */
  columns: number[];
  /** Explicit pixel widths, one per rendered column. See layout.ts. */
  layout: Layout;
  showText: boolean;
  /**
   * The depth ↑ / ↓ are currently aimed at, so the column can say so. Chosen by
   * where the pointer is — see keynav.ts, and the `data-nav-depth` tags below.
   */
  navDepth: number;
  /**
   * What the L0 column renders: one sentence per part on where the argument
   * stands there. Null when `arc.json` hasn't been generated, and then L0 falls
   * back to the root node exactly as it used to. See tree.js § the arc.
   */
  arcCells: Map<number, ArcCell> | null;
  /** Jump to a block, recording it in the URL. See App § useReadingPosition. */
  onJump(blockId: BlockId): void;
  /** Every stored comment for this article — see docs/project/comments.md. */
  comments: Comment[];
  /** The comment whose dialog is open, so its mark can say so. */
  openComment: string | null;
  /** A usable selection was made in the verbatim column. */
  onSelect(anchor: ReturnType<typeof readSelection>): void;
  /** An existing mark was clicked. */
  onOpenComment(id: string): void;
  /** The sections, for the live "which cell am I in" — see useColumnContext.ts. */
  sections: Section[];
  /** Same key as the `?at=` tracker: re-measure when the columns change. */
  layoutKey: string;
}

export function TableView({
  article,
  geometry,
  columns,
  layout,
  showText,
  navDepth,
  arcCells,
  onJump,
  comments,
  openComment,
  onSelect,
  onOpenComment,
  sections,
  layoutKey,
}: Props) {
  const { blocks } = article;
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  /**
   * Column context — see docs/project/column-context.md. Read here as well as
   * in ContextControls so the wiring stays out of App; nuqs keeps them in step.
   */
  const [ctx] = useQueryState("ctx", ctxParam);
  const [progress] = useQueryState("prog", progParam);
  const ctxOn = ctx !== "off" || progress;

  // The items of each gist column, in document order, with the row each one
  // starts on. The arc column's items carry the sentence and a step marker
  // instead of a title. `text` is the empty string when the arc has no
  // sentence for a part — never undefined, which would let the renderer fall
  // back to the part's gist and quietly turn the column into a copy of L1.
  const colKey = columns.join(",");
  const levels = useMemo(() => {
    const m = new Map<number, { items: ContextItem[]; starts: number[] }>();
    // `filter(Boolean)` before `Number`: an empty column set splits to [""],
    // and Number("") is 0, which would conjure an arc level out of nothing.
    for (const d of colKey.split(",").filter(Boolean).map(Number)) {
      if (d === geometry.leafDepth) continue; // leaves have no gist to list
      if (d === 0 && arcCells) {
        const entries = [...arcCells.entries()].sort((a, b) => a[0] - b[0]);
        m.set(0, {
          items: entries.map(([, a]) => ({
            node: a.node,
            blockId: a.node.range[0],
            text: a.text ?? "",
            step: `${a.index} / ${a.total}`,
          })),
          starts: entries.map(([row]) => row),
        });
        continue;
      }
      m.set(d, itemsFromCells(geometry.cells[d] ?? [], (row) => blocks[row]?.id));
    }
    return m;
  }, [colKey, geometry, arcCells, blocks]);
  const starts = useMemo(
    () => new Map([...levels].map(([d, l]) => [d, l.starts])),
    [levels],
  );
  const live = useColumnContext({
    sections,
    starts,
    enabled: ctxOn,
    layoutKey,
    wantRects: isPanel(ctx),
    wantProgress: progress,
    // The hairline measures against whichever line chose the item it sits
    // under. Centred picks its item on the focus line, so its fraction must be
    // the focus line's too — measured against the sticky line it would show
    // the previous item's fraction under the current title (GPT's review).
    progressLine: ctx === "centred" ? "focus" : "sticky",
  });
  // Which item each column is in. The in-cell modes and the hairline follow
  // the sticky line; the centred panel follows the focus line. Two lines, two
  // maps — see useColumnContext.ts for why they are not the same thing.
  const curOf = (d: number, row: number) => {
    const l = levels.get(d);
    return l ? currentIndex(l.starts, row) : -1;
  };
  // The panels' lists, built once per change of position rather than once
  // per render: a row hover re-renders the whole table, and a fresh `entries`
  // array would send every panel back through its layout effect.
  const panelLists = useMemo(() => {
    if (!isPanel(ctx)) return new Map<number, ReturnType<typeof levelList>>();
    const row = ctx === "centred" ? live.focusRow : live.row;
    return new Map(
      [...levels].map(([d, l]) => [
        d,
        levelList(l.items, currentIndex(l.starts, row), article.tree.nodes),
      ]),
    );
  }, [ctx, levels, live.row, live.focusRow, article.tree.nodes]);
  const isCurrentCell = (d: number, startRow: number) =>
    ctxOn && (levels.get(d)?.starts[curOf(d, live.row)] ?? -1) === startRow;
  const hairline = (d: number) =>
    progress ? (
      <div className="ctx-progress">
        <div
          className="ctx-progress-fill"
          style={{ width: `calc(var(--ctx-progress-${d}, 0) * 100%)` }}
        />
      </div>
    ) : null;
  /** The in-cell context for the current cell of column `d`, or null for plain. */
  const inCell = (d: number, startRow: number, plain: ReactNode) => {
    const l = levels.get(d);
    if (!l || !isCurrentCell(d, startRow)) return plain;
    const i = curOf(d, live.row);
    if (ctx === "siblings") {
      return (
        <ContextList
          entries={siblingList(l.items, i, article.tree.nodes)}
          onJump={onJump}
          progress={progress}
          depth={d}
        />
      );
    }
    if (ctx === "neighbours") {
      const { prev } = neighbours(l.items, i);
      return (
        <>
          {prev && (
            <div
              className="ctx-prev"
              onClick={(e) => {
                e.stopPropagation();
                onJump(prev.blockId);
              }}
            >
              ↑ {prev.step ?? prev.node.title}
            </div>
          )}
          {plain}
          {hairline(d)}
        </>
      );
    }
    return (
      <>
        {plain}
        {hairline(d)}
      </>
    );
  };
  /** Neighbours mode's bottom-pinned "next", outside the sticky box. See styles.css. */
  const nextFill = (d: number, startRow: number) => {
    const l = levels.get(d);
    if (ctx !== "neighbours" || !l || !isCurrentCell(d, startRow)) return null;
    const { next } = neighbours(l.items, curOf(d, live.row));
    if (!next) return null;
    return (
      <div className="cell-fill">
        <div
          className="ctx-next"
          onClick={(e) => {
            e.stopPropagation();
            onJump(next.blockId);
          }}
        >
          ↓ {next.step ?? next.node.title}
        </div>
      </div>
    );
  };

  // The ancestor path of the hovered row — used to light up the chain across
  // every level at once, which is the whole point of seeing them side by side.
  const activeChain = useMemo<Set<NodeId>>(
    () => new Set(hoveredRow === null ? [] : geometry.chains[hoveredRow]),
    [hoveredRow, geometry],
  );

  /**
   * Comments, resolved against the prose they were made on and grouped by block.
   *
   * Resolution can fail — the paragraph was edited and the quote is gone — and
   * then the comment simply draws no mark. It is still in the list and still
   * openable; what it must never do is underline whatever text now happens to
   * sit at that offset. See annotate.ts § Why the offsets are DOM offsets.
   */
  const marksByBlock = useMemo(() => {
    const byBlock = new Map<BlockId, Mark[]>();
    for (const c of comments) {
      const block = blocks.find((b) => b.id === c.blockId);
      if (!block) continue;
      const found = resolveMark(renderedText(block.html), c);
      if (!found) continue;
      const list = byBlock.get(c.blockId) ?? [];
      list.push({ id: c.id, ...found, open: c.id === openComment });
      byBlock.set(c.blockId, list);
    }
    return byBlock;
  }, [comments, blocks, openComment]);

  // Whether the end columns need to read as a layer depends on whether the
  // table actually outruns the window — which App knows exactly, because it
  // chose the width. Not a viewport breakpoint: the column count changes with
  // the mode as well as with the window.
  const { overflowing } = layout;

  // With a deep tree the columns can outrun the viewport, so the page scrolls
  // horizontally and the two ends pin: the coarsest column on the left keeps
  // the big picture, the prose on the right stays readable, and the middle
  // levels scroll between them.
  const pinLeft = columns[0];
  const pinRight = showText ? "text" : columns[columns.length - 1];

  return (
    <>
    <table
      className={`zoom ${showText ? "reading" : "outline"}${overflowing ? " overflowing" : ""}`}
      style={{ width: layout.tableW }}
    >
      <colgroup>
        {/* The index is the column's identity here — <col> is positional by
            definition, and these never reorder. */}
        {layout.widths.map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: <col> is positional
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((d) => (
            <th
              key={d}
              data-nav-depth={d}
              data-col={d}
              className={[
                d === pinLeft ? "pin-left" : "",
                d === pinRight ? "pin-right" : "",
                /* The arc column steps by part, so at depth 1 BOTH headers
                   light. Lighting only Parts would put the aim indicator on the
                   column next to the one the pointer is in, which reads as a
                   bug; lighting only the arc would hide that the two share a
                   stride. They do, by construction — tree.ts § the arc. */
                d === navDepth || (d === 0 && !!arcCells && navDepth === 1)
                  ? "nav-aim"
                  : "",
              ].filter(Boolean).join(" ")}
            >
              {columnLabel(d, geometry.leafDepth, d === 0 && !!arcCells)}
              <span className="depth-tag">L{d}</span>
            </th>
          ))}
          {showText && (
            /* The prose column is the finest granularity there is, so the
               arrows mean the same thing over it as over the leaf column: one
               paragraph at a time. Leaves are 1:1 with blocks (src/toc.ts). */
            <th
              data-nav-depth={geometry.leafDepth}
              className={`pin-right${navDepth === geometry.leafDepth ? " nav-aim" : ""}`}
            >
              Text<span className="depth-tag">verbatim</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody
        ref={bodyRef}
        onMouseLeave={() => setHoveredRow(null)}
        /* Delegated, not per-block: the prose is injected HTML, so the <mark>
           elements are not React's and cannot carry React handlers. */
        onMouseUp={(e) => {
          // A real selection wins over the mark it happens to end in. Checking
          // the mark first meant that selecting a phrase *inside* an existing
          // comment's words silently reopened that comment instead of asking a
          // new question — and asking about a narrower part of something you
          // already asked about is a completely ordinary thing to want.
          const anchor = readSelection(window.getSelection());
          if (anchor) return onSelect(anchor);
          const mark = (e.target as Element).closest?.("mark.cmt");
          const first = mark?.getAttribute("data-comment")?.split(" ")[0];
          if (first) onOpenComment(first);
        }}
      >
        {blocks.map((block, row) => (
          <tr
            key={block.id}
            data-block={block.id}
            onMouseEnter={() => setHoveredRow(row)}
            className={hoveredRow === row ? "row-active" : undefined}
          >
            {columns.map((depth) => {
              /* The arc column. Its cells are the parts', so it is tagged
                 `data-nav-depth={1}` — the arrows over it step part to part,
                 which is what its boundaries actually mean. */
              if (depth === 0 && arcCells) {
                const arc = arcCells.get(row);
                if (!arc) return null; // covered by a rowSpan above
                return (
                  <td
                    key={depth}
                    rowSpan={arc.rowSpan}
                    data-nav-depth={1}
                    data-cell={`0:${row}`}
                    className={[
                      "gist arc depth-0",
                      activeChain.has(arc.node.id) ? "active" : "",
                      depth === pinLeft ? "pin-left" : "",
                      depth === pinRight ? "pin-right" : "",
                      ctx === "neighbours" ? "has-fill" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => onJump(arc.node.range[0])}
                  >
                    <div className="sticky">
                      {inCell(
                        0,
                        row,
                        <>
                          <div className="arc-step">
                            {arc.index} <span className="of">/ {arc.total}</span>
                          </div>
                          {/* No fallback if the sentence is missing: an empty cell
                              is a failure the reader can see, and borrowing the
                              part's own gist here would quietly turn this column
                              back into a copy of the next one. */}
                          <p className="gist-text">{arc.text}</p>
                        </>,
                      )}
                    </div>
                    {nextFill(0, row)}
                  </td>
                );
              }
              const cell = geometry.cellAt.get(`${depth}:${row}`);
              if (!cell) return null; // covered by a rowSpan above
              const { node } = cell;
              const active = activeChain.has(node.id);
              return (
                <td
                  key={depth}
                  rowSpan={cell.rowSpan}
                  data-nav-depth={depth}
                  data-cell={`${depth}:${row}`}
                  className={[
                    "gist",
                    // On the <td>, NOT the <col>: custom properties inherit
                    // through the DOM tree, and a <col> is not an ancestor of a
                    // cell. Only background/border/width/visibility cross from
                    // column to cell, by a special table mechanism that has
                    // nothing to do with inheritance — so `--tint` set on the
                    // <col> resolves on an element that nothing reads it from.
                    `depth-${depth}`,
                    active ? "active" : "",
                    cell.continuation ? "continuation" : "",
                    depth === geometry.leafDepth ? "leaf" : "",
                    depth === pinLeft ? "pin-left" : "",
                    depth === pinRight ? "pin-right" : "",
                    ctx === "neighbours" && depth !== geometry.leafDepth ? "has-fill" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => onJump(node.range[0])}
                >
                  {!cell.continuation && (
                    <div className="sticky">
                      {node.gist ? (
                        /* Context only ever wraps a cell that HAS a gist. A
                           leaf has none, and context.ts lists nothing for the
                           leaf column, so the navLabel branch below is never
                           touched by any mode (granularity-zoom.md#node-shape). */
                        inCell(
                          depth,
                          row,
                          <>
                            <div className="title">
                              {node.title}
                              {node.sourceHeading && (
                                <span className="own" title="the author's own heading">§</span>
                              )}
                            </div>
                            <p className="gist-text">{node.gist}</p>
                            <div className="range">
                              {node.range[0]}–{node.range[1]}
                            </div>
                          </>,
                        )
                      ) : (
                        // A leaf: navigation chrome only, and only in outline mode.
                        <div className="nav-label">{node.navLabel ?? node.title}</div>
                      )}
                    </div>
                  )}
                  {!cell.continuation && depth !== geometry.leafDepth && nextFill(depth, row)}
                </td>
              );
            })}
            {showText && (
              <td
                data-nav-depth={geometry.leafDepth}
                className={`text pin-right ${!block.gistable ? "opaque" : ""}`}
              >
                <span className="block-id">{block.id}</span>
                <div
                  className="prose"
                  dangerouslySetInnerHTML={{
                    __html: annotateHtml(block.html, marksByBlock.get(block.id) ?? []),
                  }}
                />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
    {/* The hoisted modes: one panel per gist column, laid over it. The
        centred panel follows the focus line, the top-anchored one the sticky
        line — see useColumnContext.ts. */}
    {isPanel(ctx) &&
      [...panelLists].map(([d, entries]) => (
        <ContextPanel
          key={d}
          depth={d}
          navDepth={d === 0 && arcCells ? 1 : d}
          entries={entries}
          anchor={ctx === "centred" ? "centre" : "top"}
          rect={live.rects.get(d) ?? null}
          viewportH={live.viewportH}
          progress={progress}
          onJump={onJump}
        />
      ))}
    </>
  );
}
