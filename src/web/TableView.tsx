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
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { Article, BlockId, Comment, NodeId } from "../types.js";
import { columnLabel, type ArcCell, type Geometry } from "./tree.js";
import type { Layout } from "./layout.js";
import {
  annotateHtml,
  HUE_STRIPES,
  renderedText,
  resolveMark,
  termMarks,
  type Mark,
  type TermSelection,
} from "./annotate.js";
import { readSelection } from "./selection.js";
import type { Section } from "./position.js";
import { currentIndex, itemsFromCells, levelList, type ContextItem } from "./context.js";
import { ContextPanel } from "./ContextPanel.js";
import { useColumnContext } from "./useColumnContext.js";
import { BlockRange, BlockRef } from "./BlockRef.js";
import { SWIPE_ATTR } from "./swipe.js";

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
  /**
   * The glossary term the reader has selected, or nothing.
   *
   * Absent for every reader who has not opened the glossary, which is why it is
   * optional rather than nullable-and-required: nothing else on this page had
   * to learn about the feature. See GlossaryPanel.tsx for why the prose is
   * marked only while a term is selected.
   */
  term?: TermSelection | null;
  /**
   * The search results' marks, already resolved and grouped by block, and the
   * strongest match in each block for the bar down its left.
   *
   * Passed in rather than computed here — unlike comments and unlike terms —
   * because the *panel* and the *prose* have to agree about which results
   * exist, and the panel is the one that ordered and filtered them. Computing
   * them twice from the same inputs would work until the day one side gained a
   * filter, at which point the list and the highlights would quietly disagree.
   * See search-hits.ts, which produces both from one pass.
   *
   * Optional for the same reason `term` is: nothing else on this page had to
   * learn that search exists.
   */
  hitMarks?: Map<BlockId, Mark[]> | undefined;
  hitStrength?: Map<BlockId, number> | undefined;
  /** The palette slots of every search that matched in each block — `blockHues`. */
  hitHues?: Map<BlockId, number[]> | undefined;
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
  term,
  hitMarks,
  hitStrength,
  hitHues,
  sections,
  layoutKey,
}: Props) {
  const { blocks } = article;
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  /** The panel entry under the pointer, if any — see activeChain below. */
  const [hoveredNode, setHoveredNode] = useState<NodeId | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  /**
   * Column context — see docs/project/column-context.md. In reading mode
   * every gist column is drawn by a ContextPanel laid over it, and the cells
   * underneath draw only their boundaries; the panel's current entry carries
   * everything the cell's sticky box used to. In outline mode the table is
   * the list, so the cells draw themselves as they always did.
   */
  const panels = showText;

  /**
   * Reading mode only: a vertical swipe over a gist column steps one item
   * rather than scrolling (swipe.ts). The panel over the column is the surface
   * a finger usually lands on, but not always — it is a bounded window, so the
   * column above and below it is bare cell — and the two must behave the same,
   * or the stride would depend on how far down the column you happened to
   * touch.
   *
   * **Gated on reading mode, and the gate is the CSS's as much as the hook's.**
   * `touch-action` takes native scrolling away wherever the attribute lands,
   * and outline mode has no prose column — so tagging these cells there would
   * leave the whole viewport unable to scroll continuously at all. The hook is
   * disabled there too, but a disabled hook does not put the scrolling back.
   */
  const swipeable = panels ? { [SWIPE_ATTR]: "" } : {};

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
            step: { index: a.index, total: a.total },
          })),
          starts: entries.map(([row]) => row),
        });
        continue;
      }
      m.set(d, itemsFromCells(geometry.cells[d] ?? [], (row) => blocks[row]?.id));
    }
    return m;
  }, [colKey, geometry, arcCells, blocks]);
  const depths = useMemo(() => [...levels.keys()], [levels]);
  const live = useColumnContext({ sections, depths, enabled: panels, layoutKey });
  // The ancestor path of the hovered row — used to light up the chain across
  // every level at once, which is the whole point of seeing them side by side.
  // The panels carry it too, since they are the levels now (ContextList.tsx).
  // A panel that unmounts fires no mouseleave, so a hover held when the columns
  // change — or when the mode switches to outline, where there are no panels —
  // would win over every row hover for the rest of the session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run triggers
  useEffect(() => setHoveredNode(null), [panels, colKey]);

  const activeChain = useMemo<Set<NodeId>>(() => {
    // A panel entry wins over a row, because pointing at one means leaving the
    // table: `tbody`'s mouseleave clears hoveredRow on the way. The chain is
    // the entry's ancestors, so pointing at a section still lights the part it
    // belongs to and the arc above that — one entry per coarser column, which
    // is what a row hover gives. Its own sections are not lit: a part holds
    // many, and lighting all of them would be a different gesture.
    if (hoveredNode) {
      const chain = new Set<NodeId>();
      for (let id: NodeId | null = hoveredNode; id; id = article.tree.nodes[id]?.parent ?? null) {
        if (chain.has(id)) break; // a cycle would hang the render; the tree should never have one
        chain.add(id);
      }
      return chain;
    }
    return new Set(hoveredRow === null ? [] : geometry.chains[hoveredRow]);
  }, [hoveredNode, hoveredRow, geometry, article.tree.nodes]);
  // The panels' lists, built once per change of position rather than once
  // per render: a row hover re-renders the whole table, and a fresh `entries`
  // array would send every panel back through its layout effect.
  const panelLists = useMemo(() => {
    if (!panels) return new Map<number, ReturnType<typeof levelList>>();
    return new Map(
      [...levels].map(([d, l]) => [
        d,
        levelList(l.items, currentIndex(l.starts, live.focusRow), article.tree.nodes),
      ]),
    );
  }, [panels, levels, live.focusRow, article.tree.nodes]);
  /** The crumb on a landmark's tooltip: the part a section is in, or which part this is. */
  const crumbFor = (item: ContextItem): string | null => {
    const parent = item.node.parent === null ? undefined : article.tree.nodes[item.node.parent];
    if (parent && parent.depth >= 1) return parent.title;
    if (item.step) return "The argument";
    const level = levels.get(item.node.depth);
    // By node, not by identity: a group heading's item is built fresh in
    // levelList and is never the same object as the one in `levels`.
    const n = level ? level.items.findIndex((i) => i.node.id === item.node.id) + 1 : 0;
    return n ? `Part ${n} of ${level!.items.length}` : null;
  };

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

  /**
   * The selected glossary term's occurrences, as marks.
   *
   * A second map rather than entries folded into the one above, because the two
   * change on completely different clocks: comments change when the reader asks
   * a question, and this changes every time they press a different term in the
   * glossary panel. Merging them would recompute every comment's anchor on
   * every term press, for an article's worth of blocks, and comment resolution
   * is the expensive half.
   *
   * Null whenever the glossary mode is closed or nothing is selected, which is
   * almost always — see `termMarks` in annotate.ts.
   */
  const termMarksByBlock = useMemo(() => termMarks(blocks, term ?? null), [blocks, term]);

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
                /* One column lights, and it is the one the aim names. The arc
                   and Parts share a stride — the arc's cells are the parts'
                   cells, tree.ts § the arc — but they are separate rungs on the
                   ← / → ladder, so lighting both would leave the reader unable
                   to see which of the two another → would leave. */
                d === navDepth ? "nav-aim" : "",
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
              /* The arc column. It is tagged with its own depth, not with the
                 parts' — Greg wants ← to run all the way out to the argument
                 (2026-08-26), so L0 is a rung of its own. It still *steps* by
                 part, because its cells are the parts' cells; that borrowing
                 happens once, in navPlan (keynav.ts). */
              if (depth === 0 && arcCells) {
                const arc = arcCells.get(row);
                if (!arc) return null; // covered by a rowSpan above
                return (
                  <td
                    key={depth}
                    rowSpan={arc.rowSpan}
                    data-nav-depth={depth}
                    {...swipeable}
                    className={[
                      "gist arc depth-0",
                      activeChain.has(arc.node.id) ? "active" : "",
                      depth === pinLeft ? "pin-left" : "",
                      depth === pinRight ? "pin-right" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => onJump(arc.node.range[0])}
                  >
                    {/* Under a panel the cell is a boundary and a click target;
                        its content is the panel's current entry. */}
                    {!panels && (
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
                    )}
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
                  {...swipeable}
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
                  {/* A gist cell under a panel draws only its boundary; the
                      panel's current entry carries its content. The leaf
                      column is never under a panel — it has no gist, and
                      context.ts lists nothing for it (granularity-zoom.md#node-shape). */}
                  {!cell.continuation && !(panels && depth !== geometry.leafDepth) && (
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
                          <BlockRange className="range" range={node.range} onJump={onJump} />
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
                // `kind-*` carries the splitter's classification through to CSS —
                // today only `kind-heading`, which gets more space above than
                // below so a heading groups with the section it introduces
                // (styles.css § td.text.kind-heading). Emitted for every kind
                // so the next rule that needs one does not have to change JSX.
                className={`text pin-right kind-${block.kind} ${!block.gistable ? "opaque" : ""}${
                  hitStrength?.has(block.id) ? " has-hit" : ""
                }`}
                /* The bar down the left of a matched paragraph — Greg's call,
                   2026-08-25, so a match is findable while scrolling past at
                   speed. Its intensity is scaled *harder* than the wash by the
                   stylesheet, which is the one piece of the borrowed
                   implementation worth copying verbatim: a wash faint enough to
                   keep text readable is too faint to notice, so the border
                   carries the signal and the fill carries the extent.
                   (docs/project/original-version/highlighting.md) */
                style={
                  hitStrength?.has(block.id)
                    ? ({
                        "--hit-a": hitStrength.get(block.id),
                        /* And which searches matched anywhere in this paragraph,
                           so the bar is divided into their colours — the glance
                           version of the rules under the individual phrases. The
                           slot numbers become hues in styles.css, never here;
                           see annotate.ts for the same seam and why it is kept.

                           Scoped to the paragraph rather than to the phrase on
                           purpose: this is the mark you catch out of the corner
                           of your eye, so it answers "is any of my searches in
                           here" rather than "which of them is in this clause".
                           blockHues() in search-hits.ts. */
                        ...Object.fromEntries(
                          (hitHues?.get(block.id) ?? [])
                            .slice(0, HUE_STRIPES)
                            .map((slot, i) => [`--h${i}`, `var(--cat-${slot}-rgb)`]),
                        ),
                      } as CSSProperties)
                    : undefined
                }
                /* The count the stylesheet keys its gradient off. Absent rather
                   than `0` when a literal search is running, which is the case
                   with no colours at all: `[data-hues]` then never matches and
                   the bar falls back to the one fixed search hue it has always
                   been. */
                data-hues={
                  hitHues?.get(block.id)?.length
                    ? Math.min(hitHues.get(block.id)?.length ?? 0, HUE_STRIPES)
                    : undefined
                }
              >
                <BlockRef className="block-id" id={block.id} onJump={onJump} />
                <div
                  className="prose"
                  dangerouslySetInnerHTML={{
                    /* Both kinds in one call. `annotateHtml` cuts each text
                       node at every mark boundary in one pass, so a comment and
                       a term over the same words produce one <mark> carrying
                       both classes — two nested ones would read as a rendering
                       bug. Concatenating here is what gives it the chance. */
                    __html: annotateHtml(block.html, [
                      ...(marksByBlock.get(block.id) ?? []),
                      ...(termMarksByBlock.get(block.id) ?? []),
                      ...(hitMarks?.get(block.id) ?? []),
                    ]),
                  }}
                />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
    {/* One panel per gist column, laid over it, following the focus line —
        see useColumnContext.ts. */}
    {panels &&
      [...panelLists].map(([d, entries]) => (
        <ContextPanel
          key={d}
          depth={d}
          navDepth={d}
          entries={entries}
          rect={live.rects.get(d) ?? null}
          viewportH={live.viewportH}
          stableH={live.stableH}
          clipLeft={live.clipLeft}
          pinned={d === pinLeft}
          activeChain={activeChain}
          crumbFor={crumbFor}
          onJump={onJump}
          onHoverNode={setHoveredNode}
        />
      ))}
    </>
  );
}
