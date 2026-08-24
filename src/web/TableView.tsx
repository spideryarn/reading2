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
import { useEffect, useMemo, useRef, useState } from "react";
import type { Article, NodeId } from "../types.js";
import { buildGeometry, columnLabel } from "./tree.js";

interface Props {
  article: Article;
  /** Which columns are visible, by depth. */
  visibleDepths: Set<number>;
  showText: boolean;
}

export function TableView({ article, visibleDepths, showText }: Props) {
  const { blocks, tree } = article;
  const geometry = useMemo(() => buildGeometry(tree, blocks), [tree, blocks]);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  // The ancestor path of the hovered row — used to light up the chain across
  // every level at once, which is the whole point of seeing them side by side.
  const activeChain = useMemo<Set<NodeId>>(
    () => new Set(hoveredRow === null ? [] : geometry.chains[hoveredRow]),
    [hoveredRow, geometry],
  );

  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const row = bodyRef.current?.querySelector<HTMLElement>(
      `[data-block="${CSS.escape(id)}"]`,
    );
    if (!row) return;
    // Explicit and clamped rather than scrollIntoView(): the row sits inside a
    // cell that may span dozens of rows, and we want the row's own top, offset
    // to clear the two sticky bars above it.
    const STICKY_H = 88; // .controls + thead
    const top = row.getBoundingClientRect().top + window.scrollY - STICKY_H;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.max(0, Math.min(top, max)) });
  }, []);

  /** Clicking a gist takes you to the start of its range. */
  const scrollToBlock = (blockId: string) => {
    bodyRef.current
      ?.querySelector(`[data-block="${CSS.escape(blockId)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const columns = geometry.columnDepths.filter((d) => visibleDepths.has(d));

  // With a deep tree the columns can outrun the viewport, so the page scrolls
  // horizontally and the two ends pin: the coarsest column on the left keeps
  // the big picture, the prose on the right stays readable, and the middle
  // levels scroll between them.
  const pinLeft = columns[0];
  const pinRight = showText ? "text" : columns[columns.length - 1];

  return (
    <table className={`zoom ${showText ? "reading" : "outline"}`}>
      <colgroup>
        {columns.map((d) => (
          <col
            key={d}
            className={`col-gist col-depth-${d}${d === geometry.leafDepth ? " col-leaf" : ""}`}
          />
        ))}
        {showText && <col className="col-text" />}
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
                    active ? "active" : "",
                    cell.continuation ? "continuation" : "",
                    depth === geometry.leafDepth ? "leaf" : "",
                    depth === pinLeft ? "pin-left" : "",
                    depth === pinRight ? "pin-right" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => scrollToBlock(node.range[0])}
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
