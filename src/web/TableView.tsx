/**
 * The tabular granularity view — see tree.ts for the geometry, and
 * docs/project/granularity-zoom.md#the-shape for the intent.
 *
 * One row per block. Columns run coarse (left) to verbatim (right), exactly as
 * described in the brief: "so by scrolling rightwards, you get more detail. By
 * scrolling downwards, you progress through the chronology of the article."
 */
import { useMemo, useRef, useState } from "react";
import type { Article, NodeId } from "../types.js";
import { buildGeometry, columnLabel } from "./tree.js";

interface Props {
  article: Article;
  /** Which gist columns are visible, by depth. */
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

  /** Clicking a gist takes you to the start of its range. */
  const scrollToBlock = (blockId: string) => {
    const row = bodyRef.current?.querySelector(`[data-block="${blockId}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const columns = geometry.columnDepths.filter((d) => visibleDepths.has(d));

  return (
    <table className="zoom">
      <colgroup>
        {columns.map((d) => (
          <col key={d} className={`col-gist col-depth-${d}`} />
        ))}
        {showText && <col className="col-text" />}
      </colgroup>
      <thead>
        <tr>
          {columns.map((d) => (
            <th key={d}>
              {columnLabel(d, geometry.columnDepths)}
              <span className="depth-tag">L{d}</span>
            </th>
          ))}
          {showText && (
            <th>
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
              const active = activeChain.has(cell.node.id);
              return (
                <td
                  key={depth}
                  rowSpan={cell.rowSpan}
                  className={[
                    "gist",
                    active ? "active" : "",
                    cell.continuation ? "continuation" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => scrollToBlock(cell.node.range[0])}
                >
                  {!cell.continuation && (
                    <div className="sticky">
                      <div className="title">
                        {cell.node.title}
                        {cell.node.sourceHeading && <span className="own" title="the author's own heading">§</span>}
                      </div>
                      {cell.node.gist && <p className="gist-text">{cell.node.gist}</p>}
                      <div className="range">
                        {cell.node.range[0]}–{cell.node.range[1]}
                      </div>
                    </div>
                  )}
                </td>
              );
            })}
            {showText && (
              <td className={`text ${block.opaque ? "opaque" : ""}`}>
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
