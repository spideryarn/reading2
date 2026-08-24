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
import type { Article, BlockId, NodeId } from "../types.js";
import { columnLabel, type Geometry } from "./tree.js";
import type { Layout } from "./layout.js";

interface Props {
  article: Article;
  /** Built once in App, because the reading-position code needs it too. */
  geometry: Geometry;
  /** Visible column depths, coarse to fine. Chosen by layout.ts § fitView. */
  columns: number[];
  /** Explicit pixel widths, one per rendered column. See layout.ts. */
  layout: Layout;
  showText: boolean;
  /** Jump to a block, recording it in the URL. See App § useReadingPosition. */
  onJump(blockId: BlockId): void;
}

export function TableView({
  article,
  geometry,
  columns,
  layout,
  showText,
  onJump,
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
        {layout.widths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((d) => (
            <th
              key={d}
              className={[
                d === pinLeft ? "pin-left" : "",
                d === pinRight ? "pin-right" : "",
              ].filter(Boolean).join(" ")}
            >
              {columnLabel(d, geometry.leafDepth)}
              <span className="depth-tag">L{d}</span>
            </th>
          ))}
          {showText && (
            <th className="pin-right">
              Text<span className="depth-tag">verbatim</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody ref={bodyRef} onMouseLeave={() => setHoveredRow(null)}>
        {blocks.map((block, row) => (
          <tr
            key={block.id}
            data-block={block.id}
            onMouseEnter={() => setHoveredRow(row)}
            className={hoveredRow === row ? "row-active" : undefined}
          >
            {columns.map((depth) => {
              const cell = geometry.cellAt.get(`${depth}:${row}`);
              if (!cell) return null; // covered by a rowSpan above
              const { node } = cell;
              const active = activeChain.has(node.id);
              return (
                <td
                  key={depth}
                  rowSpan={cell.rowSpan}
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
              <td className={`text pin-right ${!block.gistable ? "opaque" : ""}`}>
                <span className="block-id">{block.id}</span>
                <div
                  className="prose"
                  dangerouslySetInnerHTML={{ __html: block.html }}
                />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
