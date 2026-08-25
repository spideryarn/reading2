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
import { useMemo, useRef, useState } from "react";
import type { Article, BlockId, Comment, NodeId } from "../types.js";
import { columnLabel, type ArcCell, type Geometry } from "./tree.js";
import type { Layout } from "./layout.js";
import { annotateHtml, renderedText, resolveMark, type Mark } from "./annotate.js";
import { readSelection } from "./selection.js";

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
}: Props) {
  const { blocks } = article;
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

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
                    className={[
                      "gist arc depth-0",
                      activeChain.has(arc.node.id) ? "active" : "",
                      depth === pinLeft ? "pin-left" : "",
                      depth === pinRight ? "pin-right" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => onJump(arc.node.range[0])}
                  >
                    <div className="sticky">
                      <div className="arc-step">
                        {arc.index} <span className="of">/ {arc.total}</span>
                      </div>
                      {/* No fallback if the sentence is missing: an empty cell
                          is a failure the reader can see, and borrowing the
                          part's own gist here would quietly turn this column
                          back into a copy of the next one. */}
                      <p className="gist-text">{arc.text}</p>
                    </div>
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
                  ].filter(Boolean).join(" ")}
                  onClick={() => onJump(node.range[0])}
                >
                  {!cell.continuation && (
                    <div className="sticky">
                      {node.gist ? (
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
                        </>
                      ) : (
                        // A leaf: navigation chrome only, and only in outline mode.
                        <div className="nav-label">{node.navLabel ?? node.title}</div>
                      )}
                    </div>
                  )}
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
  );
}
