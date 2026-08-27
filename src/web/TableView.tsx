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
import type { Article, BlockId, Comment, NodeId, TreeNode } from "../types.js";
import { useRenderCount } from "./perf.js";
import { columnLabel, type ArcCell, type Geometry } from "./tree.js";
import type { Layout } from "./layout.js";
import {
  annotateHtml,
  BAR_HUES,
  renderedText,
  resolveMark,
  termMarks,
  type Mark,
  type TermSelection,
} from "./annotate.js";
import { readSelection } from "./selection.js";
import { internalTarget } from "./internal-links.js";
import type { Section } from "./position.js";
import { currentIndex, itemsFromCells, levelList, type ContextItem } from "./context.js";
import { ContextPanel } from "./ContextPanel.js";
import { useColumnContext } from "./useColumnContext.js";
import { BlockRange, BlockRef } from "./BlockRef.js";
import { MessageSquare } from "lucide-react";
import { SWIPE_ATTR } from "./swipe.js";
import type { AnchoredThread } from "./useChatAnchors.js";

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
   * Conversations anchored to a selection, so the prose can mark them.
   *
   * Summaries rather than threads, and that is the point: chat's real state
   * changes on every streamed token, and holding it here would re-render — and
   * re-`annotateHtml` — every paragraph of the article while one answer
   * arrives. See useChatAnchors.ts.
   */
  chats: AnchoredThread[];
  /** How many conversations each block has, marked or not. Drives the gutter button. */
  chatCounts: Map<string, number>;
  /** The conversation the floating panel is open on, so its mark can say so. */
  openChat: string | null;
  /** A chat mark was clicked. */
  onOpenChat(id: string): void;
  /** The reader pressed the chat button beside a paragraph. */
  onChatAbout(blockId: BlockId): void;
  /**
   * Every glossary term this article has, so every one can be underlined.
   *
   * **A list since 2026-08-26, and it used to be the one the reader had
   * pressed.** The prose now carries the whole glossary in every mode — Greg's
   * call, and the reasoning is on `termMarks` in annotate.ts. The pressed one
   * is still distinguishable: it arrives with `open` set, which becomes
   * `mark.term[data-term-open]`.
   *
   * Optional, so an article with no glossary and every test that renders this
   * table without one go on working unchanged.
   */
  terms?: readonly TermSelection[] | undefined;
  /**
   * The term the reader has pressed in the glossary band, of the many drawn.
   *
   * **Its own prop rather than an `open` flag inside `terms`**, so that pressing
   * one does not invalidate the scan. `terms` is the input to a regex pass over
   * every block that has a term in it; the pressed id only decides one
   * attribute on marks that pass has already found. Keeping them apart is the
   * difference between a press costing a re-annotate and costing a full rescan
   * — 44–135ms on a long article with a big glossary, measured by a GPT Sol
   * review, 2026-08-26.
   */
  openTerm?: string | null | undefined;
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
  chats,
  chatCounts,
  openChat,
  onOpenChat,
  onChatAbout,
  terms,
  openTerm,
  hitMarks,
  hitStrength,
  hitHues,
  sections,
  layoutKey,
}: Props) {
  useRenderCount("TableView");
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
   *
   * **And there must be a column for a panel to be laid over.** `showText`
   * alone was enough for as long as reading mode always had at least one gist
   * column; since 2026-08-27 it can have none (layout.ts § gistsThatFit), and
   * on that path `ColumnPanels` mounted with an empty depth set and
   * `useColumnContext` went on measuring every section row on every scroll to
   * decide which entry of nothing to highlight. Pure waste, and it landed on
   * the narrow window least able to afford it — performance.md is specifically
   * about this hook's geometry work. Found by GPT Sol, 2026-08-27.
   */
  const panels = showText && columns.length > 0;

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
  /* Indexed once. The loop below used to do `blocks.find` per comment, which is
     O(comments x blocks) plus a DOM parse each time — and folding every anchored
     conversation into the same pass would have multiplied a cost that was
     already the expensive half of this memo. */
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);

  const marksByBlock = useMemo(() => {
    const byBlock = new Map<BlockId, Mark[]>();
    const push = (blockId: BlockId, mark: Mark) => {
      const list = byBlock.get(blockId) ?? [];
      list.push(mark);
      byBlock.set(blockId, list);
    };
    for (const c of comments) {
      const block = byId.get(c.blockId);
      if (!block) continue;
      const found = resolveMark(renderedText(block.html), c);
      if (!found) continue;
      push(c.blockId, { id: c.id, ...found, open: c.id === openComment });
    }
    /* Chats and comments share one map rather than living in two, because they
       are resolved the same way against the same prose and change on the same
       clock — a reader asking a question. The glossary's marks are a second map
       precisely because they change on a different one. */
    for (const t of chats) {
      const block = byId.get(t.anchor.blockId);
      if (!block) continue;
      const found = resolveMark(renderedText(block.html), t.anchor);
      if (!found) continue;
      push(t.anchor.blockId, { id: t.id, ...found, kind: "chat", open: t.id === openChat });
    }
    return byBlock;
  }, [comments, chats, byId, openComment, openChat]);

  /**
   * Every glossary term's occurrences, as marks.
   *
   * A second map rather than entries folded into the one above, because the two
   * change on completely different clocks: comments change when the reader asks
   * a question, and this changes every time they press a different term in the
   * glossary panel. Merging them would recompute every comment's anchor on
   * every term press, for an article's worth of blocks, and comment resolution
   * is the expensive half.
   *
   * Empty whenever the article has no glossary — see `termMarks` in
   * annotate.ts, which also says why this is the whole list now rather than the
   * one entry the reader pressed.
   */
  const termMarksByBlock = useMemo(() => termMarks(blocks, terms ?? []), [blocks, terms]);

  /**
   * The verbatim column's HTML, annotated once per change rather than once per
   * render.
   *
   * **This memo is a fix, not a tidy-up.** `annotateHtml` was called inline in
   * the JSX below, so it ran for every block on every render of this component
   * — and this component re-renders on things as cheap as the pointer crossing
   * from one row to the next (`hoveredRow`). That was survivable while it had a
   * fast path that mattered: a block with no marks returns its html unparsed,
   * and before 2026-08-26 the only marked blocks were the handful carrying a
   * comment or a search hit.
   *
   * Underlining every glossary term took that fast path away. Every block
   * containing any term now parses its own HTML, builds a TreeWalker over it
   * and re-serialises — on every hover of every row. Memoising here puts the
   * cost back where it belongs: once when the marks actually change.
   *
   * `openComment` and `openChat` are absent from the dependencies because they
   * are already folded into `marksByBlock`; adding them would recompute twice
   * for one change. `openTerm` is present precisely because it is *not* folded
   * into `termMarksByBlock` — see the prop.
   *
   * The nearby `Props` docstring on `chats` was already worried about exactly
   * this ("re-`annotateHtml` every paragraph of the article while one answer
   * arrives"); this is the line that makes that worry unnecessary.
   */
  const proseHtml = useMemo(() => {
    const byBlock = new Map<BlockId, string>();
    for (const block of blocks) {
      /* Both kinds in one call. `annotateHtml` cuts each text node at every
         mark boundary in one pass, so a comment and a term over the same words
         produce one <mark> carrying both classes — two nested ones would read
         as a rendering bug. Concatenating here is what gives it the chance. */
      const found = termMarksByBlock.get(block.id) ?? [];
      const marks = [
        ...(marksByBlock.get(block.id) ?? []),
        /* The pressed term's `open`, applied here rather than carried through
           the scan — see the `openTerm` prop. A plain `.map` over marks that
           have already been found, so a press costs no regex and no reparse of
           anything except the blocks it actually appears in. */
        ...(openTerm
          ? found.map((m) => (m.id === openTerm ? { ...m, open: true } : m))
          : found),
        ...(hitMarks?.get(block.id) ?? []),
      ];
      /* The unmarked majority never reaches the parser at all. `annotateHtml`
         has this test too; doing it here as well is what keeps an unmarked
         block out of the Map's churn as well as out of the parse. */
      if (marks.length > 0) byBlock.set(block.id, annotateHtml(block.html, marks));
    }
    return byBlock;
  }, [blocks, marksByBlock, termMarksByBlock, hitMarks, openTerm]);

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
      /* `only-prose` — the article is the only column there is, so the table
         head is a label for the whole screen. It reads `Text verbatim` above
         a column of the author's paragraphs, which says nothing that looking
         at them does not, and it costs 40px of a 390px landscape viewport
         where a third of the height is already bars. So the stylesheet drops
         it (§ a narrow window).

         The condition is `no gist columns AND the prose is on`, not
         `one column`: a single *gist* column still has to say which level it
         is, and in outline mode that is the only place saying so. Reached
         three ways — a phone in reading mode, and either width of mode band,
         where the head has been equally redundant beside a chat panel on a
         laptop all along.

         `stickyOffset()` needs no telling: it measures `thead th` rather than
         reading `--head-h`, and a `display: none` head measures zero. That is
         the second time this week that "measure it, don't agree a number with
         another file" has paid for itself — scroll.ts says why. */
      className={`zoom ${showText ? "reading" : "outline"}${overflowing ? " overflowing" : ""}${
        columns.length === 0 && showText ? " only-prose" : ""
      }`}
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
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click being handled
          is always on a real <a> inside the prose, and pressing Enter on a
          focused link fires a click that bubbles to exactly this handler. A
          keydown listener here would run the jump twice. */}
      <tbody
        ref={bodyRef}
        onMouseLeave={() => setHoveredRow(null)}
        /* Both handlers below are delegated, not per-block: the prose is
           injected HTML, so its <mark> and <a> elements are not React's and
           cannot carry React handlers. */
        /* An internal link — the article pointing at one of its own sections.

           Left to the browser, this would jump the target under the sticky bars
           and leave `?at=` claiming the reader never moved. See
           internal-links.ts, which also says why the href already reads
           `#spya-…` by the time it gets here. */
        onClick={(e) => {
          // A modified click is the reader asking for a new tab or window, and
          // that works: the href is a real fragment, and main.tsx turns an
          // arriving `#spya-…` into `?at=` before React mounts. Taking it over
          // would break the one case where the browser's own answer is right.
          if (e.defaultPrevented || e.button !== 0) return;
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          const link = (e.target as Element).closest?.("a[href]");
          if (!link) return;
          /* A drag that ended inside a link is a selection, and the mouse-up
             handler below has already turned it into a question. Stopping the
             click is not optional here: merely declining to jump would leave the
             browser to follow the fragment natively, which throws the reader
             away from the passage they just chose. */
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed && selection.anchorNode &&
              link.contains(selection.anchorNode)) {
            e.preventDefault();
            return;
          }
          /* A link asking for its own tab gets one. `target` is article-supplied
             and the sanitiser keeps it — and the keywords are ASCII
             case-insensitive, so `_SELF` is `_self`. */
          const to = link.getAttribute("target")?.toLowerCase();
          if (to && to !== "_self") return;
          const blockId = internalTarget(e.target as Element, document);
          if (!blockId) return; // not ours to handle — an outbound link, or a dead fragment
          e.preventDefault();
          onJump(blockId);
        }}
        onMouseUp={(e) => {
          // A real selection wins over the mark it happens to end in. Checking
          // the mark first meant that selecting a phrase *inside* an existing
          // comment's words silently reopened that comment instead of asking a
          // new question — and asking about a narrower part of something you
          // already asked about is a completely ordinary thing to want.
          const anchor = readSelection(window.getSelection());
          if (anchor) return onSelect(anchor);
          /* A link inside a commented passage is a link. `annotateHtml` puts
             the <mark> *inside* the <a>, so without this a click on one would
             open the comment on mouseup and then jump on click — two answers to
             one click, in that order. Following the link is the one the reader
             asked for. */
          if ((e.target as Element).closest?.("a[href]")) return;
          /* **Chat first.** One `<mark>` can carry both classes — a reader can
             have asked about a sentence they had already had explained — and
             only one of them can win a click. The chat is the living artefact;
             comments have been closed to new arrivals since 2026-08-26, so the
             overlap is always an older explanation. The comment does not become
             unreachable: the Dock's drawer lists every one and opens it. It
             loses a shortcut. See annotate.ts § MarkKind. */
          const chatMark = (e.target as Element).closest?.("mark.chat");
          const chatId = chatMark?.getAttribute("data-chat")?.split(" ")[0];
          if (chatId) return onOpenChat(chatId);
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
                        /* `BAR_HUES`, not `HUE_STRIPES`. The two caps
                           are different because the two marks have different
                           amounts of room, and conflating them was throwing
                           away provenance for no reason: the stripes under a
                           phrase share the few pixels of leading below one line
                           of text, but this bar runs the whole height of the
                           paragraph — dozens of pixels — so it can show every
                           hue the palette has and never needs to drop one. */
                        ...Object.fromEntries(
                          (hitHues?.get(block.id) ?? [])
                            .slice(0, BAR_HUES)
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
                    ? Math.min(hitHues.get(block.id)?.length ?? 0, BAR_HUES)
                    : undefined
                }
              >
                <BlockRef className="block-id" id={block.id} onJump={onJump} />
                {/* A door into chat beside every paragraph — Greg, 2026-08-26:
                    "a Chat button next to each paragraph … perhaps underneath
                    the block-id". Anchored to the block rather than to a
                    selection, which is the other half of what an anchor can be.

                    Hidden until the row is hovered, and never `display: none`:
                    that would take it out of the tab order and hand a keyboard
                    reader nothing. `pointer-events` goes with the opacity in
                    styles.css, or the gutter grows an invisible target that
                    eats clicks meant for the id above it. */}
                <button
                  type="button"
                  className={`block-chat${chatCounts.get(block.id) ? " has" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChatAbout(block.id);
                  }}
                  title={
                    chatCounts.get(block.id)
                      ? `Chat about this paragraph (${chatCounts.get(block.id)} already)`
                      : "Chat about this paragraph"
                  }
                  aria-label="Chat about this paragraph"
                >
                  <MessageSquare size={12} aria-hidden="true" />
                  {/* Every conversation anchored to this block, selections
                      included — counting only the whole-block ones would make
                      the number disagree with the marks sitting beside it. */}
                  {!!chatCounts.get(block.id) && (
                    <span className="block-chat-n">{chatCounts.get(block.id)}</span>
                  )}
                </button>
                <div
                  className="prose"
                  /* Looked up, not computed — see `proseHtml` above. A block
                     with no marks is absent from the map and renders its own
                     html untouched. */
                  dangerouslySetInnerHTML={{ __html: proseHtml.get(block.id) ?? block.html }}
                />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
    {/* One panel per gist column, laid over it, following the focus line —
        see useColumnContext.ts. */}
    {panels && (
      <ColumnPanels
        sections={sections}
        depths={depths}
        layoutKey={layoutKey}
        levels={levels}
        nodes={article.tree.nodes}
        pinLeft={pinLeft}
        activeChain={activeChain}
        crumbFor={crumbFor}
        onJump={onJump}
        onHoverNode={setHoveredNode}
      />
    )}
    </>
  );
}

/* ---------------------------------------------------- the gist panels ------

   **This exists to keep a scroll out of the table's renderer.**

   `useColumnContext` samples geometry on every animation frame of a scroll and
   calls `setLive` whenever the answer changes — which, near the masthead where
   the header is still sticking, is most frames. While that hook was called by
   `TableView`, each of those was a re-render of `TableView`: the whole
   block-by-column map, several hundred rows of it, to move three overlays a few
   pixels. GPT Sol found this, and it is much the largest thing a scroll used to
   cost here.

   Owning the hook one level down changes nothing about what is drawn. The
   panels re-render per frame exactly as before; the table no longer does.

   The traffic that still goes upward is deliberate and rare: hovering a panel
   entry calls `onHoverNode`, and the chain it lights crosses every column, so
   that one *must* re-render the table. A hover is a gesture; a scroll is sixty
   frames a second. */
interface ColumnPanelsProps {
  sections: Section[];
  depths: number[];
  layoutKey: string;
  levels: Map<number, { items: ContextItem[]; starts: number[] }>;
  nodes: Record<NodeId, TreeNode>;
  pinLeft: number | undefined;
  activeChain: Set<NodeId>;
  crumbFor: (item: ContextItem) => string | null;
  onJump: (blockId: BlockId) => void;
  onHoverNode: (id: NodeId | null) => void;
}

function ColumnPanels({
  sections,
  depths,
  layoutKey,
  levels,
  nodes,
  pinLeft,
  activeChain,
  crumbFor,
  onJump,
  onHoverNode,
}: ColumnPanelsProps) {
  useRenderCount("ColumnPanels");
  const live = useColumnContext({ sections, depths, enabled: true, layoutKey });
  /* Built once per change of *position* rather than once per render: a fresh
     `entries` array would send every panel back through its layout effect. */
  const panelLists = useMemo(
    () =>
      new Map(
        [...levels].map(([d, l]) => [
          d,
          levelList(l.items, currentIndex(l.starts, live.focusRow), nodes),
        ]),
      ),
    [levels, live.focusRow, nodes],
  );
  return (
    <>
      {[...panelLists].map(([d, entries]) => (
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
          onHoverNode={onHoverNode}
        />
      ))}
    </>
  );
}
