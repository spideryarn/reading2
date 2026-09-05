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
import {
  memo,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Article, BlockId, Comment, NodeId, TreeNode } from "../types.js";
import { useRenderCount } from "./perf.js";
import { columnLabel, type Geometry } from "./tree.js";
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
import {
  markReturnPath,
  noteMarkerAt,
  noteStartAt,
  type NoteIndex,
  type NoteMarker,
  type NoteReturn,
  type NoteStart,
} from "./notes-view.js";
import type { Section } from "./position.js";
import { currentIndex, itemsFromCells, levelList, type ContextItem } from "./context.js";
import { ContextPanel } from "./ContextPanel.js";
import { useColumnContext } from "./useColumnContext.js";
import { BlockRange } from "./BlockRef.js";
import { BlockGutter } from "./BlockGutter.js";
import { commentsByBlock } from "./comment-nav.js";
import { SWIPE_ATTR } from "./swipe.js";
import type { AnchoredThread } from "./useChatAnchors.js";
import { Lightbox } from "./Lightbox.js";
import {
  addZoomHandles,
  figureFor,
  ZOOM_BTN_CLASS,
  ZOOM_WRAP_CLASS,
  zoomTargetOf,
  type ZoomedFigure,
} from "./zoomable.js";

/**
 * How long the live region stays empty between two announcements.
 *
 * Long enough for a screen reader to observe the clear as its own mutation,
 * short enough that a copy still feels acknowledged. It is a gap, not a delay
 * the reader waits on — the tick has already appeared.
 */
const ANNOUNCE_GAP_MS = 60;

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
  /* **No `arcCells` here since 2026-09-05.** The L0 column drew the arc — one
     sentence per part, with a `3 / 7` step marker and a loading tint while the
     stage was still running — and Greg took the column out: "let's get rid of
     the 'Arg' button and functionality altogether". The arc itself is alive and
     well; App.tsx hands it to `OutlinePanel` instead
     (docs/plans/260905d-declutter-the-reading-view-top-bars.md § Decisions 5). */
  /** Jump to a block, recording it in the URL. See App § useReadingPosition. */
  onJump(blockId: BlockId): void;
  /**
   * The article's footnotes — src/web/notes-view.ts. Absent for every view that
   * has none to speak of, and then a marker click is an ordinary internal link.
   */
  notes?: NoteIndex | undefined;
  /**
   * The passage the reader left when they followed a marker, so the note they
   * land in can say which of its back-links is theirs.
   *
   * One Wikipedia note in this corpus is marked thirteen times and carries
   * thirteen back-links, side by side and identical apart from where they point.
   * Without this the return journey is a guess with twelve wrong answers.
   */
  noteReturn?: NoteReturn | null | undefined;
  /** A marker was followed: go to the note, and remember the way back. */
  onFollowNote?: ((from: BlockId | null, marker: NoteMarker) => void) | undefined;
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
  /**
   * The reader pressed the chat button beside a paragraph — **and passing
   * nothing is how the gutter is told there is no such button.**
   *
   * Optional because opening a conversation costs a model call, which a visitor
   * cannot buy. BlockGutter.tsx has the reasoning; it is `onRenamed`'s pattern
   * on Masthead.tsx, and the `| undefined` there is why this one is written out
   * too rather than as the `?(…)` shorthand.
   */
  onChatAbout?: ((blockId: BlockId) => void) | undefined;
  /**
   * The reader pressed "?" beside a paragraph — the same capability as
   * `onChatAbout`, passed the same way and absent for a visitor for the same
   * reason. BlockGutter.tsx has the argument for why it is its own callback
   * rather than a flag on that one.
   */
  onHelp?: ((blockId: BlockId) => void) | undefined;
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
  /**
   * This page's address with `at` dropped — `"/read/x?cols=0,2"`. What the 551
   * block permalinks in the gutter and the gist cells are built from.
   *
   * **It is a prop rather than a read of `location` because this component is
   * `memo`ised.** `blockHref` used to read the address bar during render,
   * which was sound only while every URL change re-rendered this tree; a memo
   * retires that. Being a *string* is what makes it work: a render caused only
   * by `?at=` produces an equal one, so the memo still holds, and any other
   * parameter produces a different one and correctly does not.
   *
   * **Pathname included, not just the query.** The first version carried only
   * the query, and `blockHref` still read `location.pathname` — so a write
   * that changed only the path left every permalink on the old spelling. GPT
   * Sol reproduced it, 2026-09-04.
   *
   * Self-maintaining, which an audit of the 35 parameters in params.ts would
   * not have been — the thirty-sixth is covered too. BlockRef.tsx § `blockHref`.
   */
  linkBase: string;
}

/**
 * **Memoised** — one of two in `src/web`; `Spine` is the other.
 *
 * `useReadingPosition` writes `?at=` to the address as sections pass the
 * reading line — a deliberate feature (docs/project/url-state.md) — and that
 * re-renders `Reader` **87–88 times during one scroll** of a 551-block article,
 * measured 2026-09-04. None of this table's 29 props depends on `at`, so every
 * one of those renders reconciled 551 rows, ~2,200 cells, `thead`, `colgroup`,
 * `ColumnPanels` and `Lightbox` to produce the same tree.
 *
 * The default shallow comparison is deliberate, and a custom `areEqual` here
 * would be a bug rather than an optimisation: the tempting one compares
 * `article.blocks` or a block id, and that freezes the prose — a new comment, a
 * pressed glossary term and a search would all stop updating it, silently. The
 * props are made stable instead, which is checkable; App § "TableView's four
 * callbacks" is the other half of this change.
 *
 * **What this retires:** `blockHref` read `location.search` during render on the
 * grounds that any URL change re-rendered this whole tree. It no longer does.
 * That is what `linkBase` is for — see `Props.linkBase`, and do not reintroduce
 * a render-time read of `location`, or of any other global, in this subtree
 * without giving it the same treatment.
 *
 * Verify with `?perf=1`: `useRenderCount("TableView")` counts *body*
 * executions, so a skipped render is not counted, and `measure-cpu.ts --scroll`
 * prints the tally. **Zero renders is not on its own evidence of correctness** —
 * a memo that never updates reads zero too. Pair it with the browser check that
 * a comment, a glossary press and a search still change the prose.
 *
 * See docs/plans/260904a-more-scroll-cpu-wins.md.
 */
export const TableView = memo(TableViewInner);

function TableViewInner({
  article,
  geometry,
  columns,
  layout,
  showText,
  navDepth,
  onJump,
  notes,
  noteReturn,
  onFollowNote,
  comments,
  openComment,
  onSelect,
  onOpenComment,
  chats,
  chatCounts,
  openChat,
  onOpenChat,
  onChatAbout,
  onHelp,
  terms,
  openTerm,
  hitMarks,
  hitStrength,
  hitHues,
  sections,
  layoutKey,
  linkBase,
}: Props) {
  useRenderCount("TableView");
  const { blocks } = article;
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  /** The panel entry under the pointer, if any — see activeChain below. */
  const [hoveredNode, setHoveredNode] = useState<NodeId | null>(null);
  /**
   * The figure the reader asked to see larger, or null. A *copy* of the html
   * rather than the node itself, because the node belongs to injected markup
   * that React replaces wholesale on the next re-annotation — holding a
   * reference would leave the overlay pointing at a detached element, which is
   * the bug useHoverCard.ts records having had twice.
   */
  const [zoomed, setZoomed] = useState<ZoomedFigure | null>(null);
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

  /* The items of each gist column, in document order, with the row each one
     starts on. Every column is now built the same way; until 2026-09-05 depth 0
     was a special case that read the arc's cells instead, carrying a sentence
     and a `3 / 7` marker where the others carry a title. `ContextItem` carried
     a `text` and a `step` for it, and lost both the same day — context.ts. */
  const colKey = columns.join(",");
  const levels = useMemo(() => {
    const m = new Map<number, { items: ContextItem[]; starts: number[] }>();
    // `filter(Boolean)` before `Number`: an empty column set splits to [""],
    // and Number("") is 0, which would conjure a level out of nothing.
    for (const d of colKey.split(",").filter(Boolean).map(Number)) {
      if (d === geometry.leafDepth) continue; // leaves have no gist to list
      m.set(
        d,
        itemsFromCells(geometry.cells[d] ?? [], (row) => blocks[row]?.id, geometry.supplementOf),
      );
    }
    return m;
  }, [colKey, geometry, blocks]);
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
    // belongs to and whatever is coarser than that — one entry per coarser
    // column, which is what a row hover gives. Its own sections are not lit:
    // a part holds many, and lighting all of them would be a different gesture.
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

  /**
   * Every comment grouped onto its block, for the gutter's marker.
   *
   * **A separate memo from `marksByBlock`, and the dependency list is the whole
   * reason.** That one takes `openComment` and `openChat`, so it is rebuilt —
   * along with an article's worth of anchor resolution — every time the reader
   * opens or closes a dialog. This is rebuilt only when the comments themselves
   * change, which is when the reader writes or deletes one. Same split, and the
   * same argument, as `termMarksByBlock` below.
   *
   * It also asks a different question. `marksByBlock` asks *where in the prose
   * do these words sit*, which has no answer once the article has been
   * re-extracted past them; this asks *which block is this comment on*, which
   * always has one. See comment-nav.ts § commentsByBlock.
   */
  const cmtsByBlock = useMemo(() => commentsByBlock(comments, blocks), [comments, blocks]);

  /**
   * One live region for the whole table, written through a ref.
   *
   * Through a ref rather than through state because state here re-renders the
   * table — this file is largely comments about that cost — and a copy
   * confirmation has no business re-annotating an article's worth of prose.
   *
   * `role="status"` carries an implicit `aria-live="polite"`, and
   * `aria-atomic` makes each message be read whole rather than diffed.
   *
   * The message carries the short id, so two different blocks read differently.
   * The same block twice is handled by the clear-then-write below. Latest result
   * wins; queueing announcements would be a mechanism for a case nobody has.
   */
  const liveRef = useRef<HTMLSpanElement>(null);
  const announce = useCallback((said: string) => {
    const region = liveRef.current;
    if (!region) return;
    /* **Cleared first, and the message put back in a later task.** Writing the
       same string twice is not a DOM mutation, so copying the same block twice
       announced once and then went silent — the reader presses it again because
       they are not sure it worked, and gets nothing, which is the reading of
       "it did not work". Clearing makes each message a change the assistive
       technology can see. GPT Sol found it, 2026-08-31. */
    region.textContent = "";
    setTimeout(() => {
      if (liveRef.current) liveRef.current.textContent = said;
    }, ANNOUNCE_GAP_MS);
  }, []);

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
   * Last render's `{ __html }` objects, so an unchanged block can be handed
   * back the one React has already seen — see `proseHtml` below for why that
   * is the whole point.
   *
   * A cache keyed on value equality, which is what makes writing to it during
   * render safe: every reuse is an object whose `__html` is `===` the string
   * we just computed, so a double-invoked or abandoned render can only ever
   * hand back something identical. Nothing reads it for correctness.
   */
  const proseCache = useRef<Map<BlockId, { __html: string }>>(new Map());

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
   *
   * ## Why this holds `{ __html }` objects rather than strings
   *
   * **React does not compare the html. It compares the object.** Its update
   * path decides a prop changed with `!==` on the value
   * (`react-dom` § `updateProperties`), and for `dangerouslySetInnerHTML` that
   * value is the `{ __html: … }` wrapper — so a fresh object literal in the
   * JSX is *always* "changed", and `setProp` then runs
   * `domElement.innerHTML = …` **unconditionally**, with no test against what
   * is already there. Writing the identical string still tears the paragraph's
   * DOM down and rebuilds it.
   *
   * Measured on a 551-block article, 2026-09-03: a plain scroll re-rendered
   * `TableView` 34 times and rewrote **18,734** prose subtrees — 34 × 551,
   * every block every time, every one of them byte-identical. That churn, not
   * React's own reconciliation, was the largest single cost of scrolling, and
   * it is what put layout and style recalculation above script in a production
   * build. performance.md § What scrolling actually cost.
   *
   * So the memo hands out the *same object* for a block whose html has not
   * changed, and React skips it entirely. Two consequences worth keeping:
   *
   * - **Every block gets an entry**, not just the marked minority. An entry
   *   missing here would fall back to a literal in the JSX and quietly get the
   *   old behaviour back for that block.
   * - **Entries survive a recompute.** When one comment arrives, this memo
   *   re-runs for all 551 blocks, but only the blocks whose html actually
   *   changed get new objects — so a streaming answer rewrites the paragraphs
   *   it touches instead of the article.
   */
  const proseHtml = useMemo(() => {
    const was = proseCache.current;
    const byBlock = new Map<BlockId, { __html: string }>();
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
         block out of the parse. */
      const marked = marks.length > 0 ? annotateHtml(block.html, marks) : block.html;
      /* The enlarge buttons go on LAST, and `addZoomHandles` returns its input
         unchanged when there is no figure in it, so a paragraph of plain prose
         costs one regex. See zoomable.ts § the four load-bearing things, the
         third of which is this ordering.

         **The Map used to hold only the blocks whose html differed from
         `block.html`, and now holds every block** — the entry *is* the identity
         React compares, so a block without one would fall back to a literal and
         get the old, expensive behaviour. GPT Sol caught this comment still
         claiming the old shape, 2026-09-03. */
      const withHandles = addZoomHandles(marked);
      /* **Every block, and the same object when the html has not changed.**
         Both halves of that are load-bearing; see the docstring above. */
      const had = was.get(block.id);
      byBlock.set(
        block.id,
        had && had.__html === withHandles ? had : { __html: withHandles },
      );
    }
    proseCache.current = byBlock;
    return byBlock;
  }, [blocks, marksByBlock, termMarksByBlock, hitMarks, openTerm]);

  /**
   * **Apparatus, dressed as apparatus** — which block starts a note, what the
   * author numbered it, and where the region begins.
   *
   * A footnote is body prose to every other rule in this column: same face,
   * same measure, same ink, `gistable` like any paragraph. So a reader who
   * followed a marker to the foot of a gwern piece landed among nine unnumbered
   * paragraphs with nothing to say what they were (SPIDERYARN-READING2-14). The
   * spine and the outline had dressed a supplement differently since the day
   * notes landed; this is the prose column catching up.
   *
   * Memoised rather than looked up per row for the reason `proseHtml` above is:
   * this component re-renders on a pointer crossing from one row to the next,
   * and the answer changes only when the article does.
   */
  const noteStarts = useMemo(() => {
    const out = new Map<BlockId, NoteStart>();
    if (!notes) return out;
    for (const block of blocks) {
      const start = noteStartAt(notes, block.id);
      if (start) out.set(block.id, start);
    }
    return out;
  }, [blocks, notes]);

  /**
   * The back-link that leads to where the reader came from, marked.
   *
   * Written onto the injected html rather than through `annotateHtml`, and the
   * reason is cost: a note's back-links are already in the prose, so this is one
   * attribute on one anchor, where the annotation path would re-parse and
   * re-serialise every block carrying a mark for a piece of transient state. It
   * re-runs when the prose is re-annotated, because React replaces those nodes
   * wholesale and a stale mark leaves with the node it was on — the same
   * property `TAP_ATTR` relies on in useHoverCard.ts.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: proseHtml is a deliberate re-run trigger
  useEffect(() => markReturnPath(bodyRef.current ?? document, noteReturn ?? null), [
    noteReturn,
    proseHtml,
  ]);

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
                /* One column lights, and it is the one the aim names. */
                d === navDepth ? "nav-aim" : "",
              ].filter(Boolean).join(" ")}
            >
              {columnLabel(d, geometry.leafDepth)}
              <span className="depth-tag">L{d}</span>
            </th>
          ))}
          {showText && (
            /* The prose column is the finest granularity there is, so the
               arrows mean the same thing over it as over the leaf column: one
               paragraph at a time. Leaves are 1:1 with blocks (src/hierarchy.ts). */
            <th
              data-nav-depth={geometry.leafDepth}
              className={`text pin-right${navDepth === geometry.leafDepth ? " nav-aim" : ""}`}
            >
              {/* **Two spans, and neither is decoration.** The prose below is
                  centred in its cell (styles.css § text), so a heading left at
                  the cell's edge names a column whose text starts 180px to its
                  right — the masthead had the same defect and was fixed the same
                  way. `.th-measure` is the box that does the moving: it carries
                  the article's font *purely so that `65ch` means there what it
                  means in the prose*, and `.th-name` puts the head's own type
                  back. They have to be two elements because one element cannot
                  both resolve a `ch` in the reading face and be set in the
                  chrome's. The other headers are untouched — they sit over
                  columns that are not centred and are right as they are.
                  styles.css § the header over the article's column. */}
              <span className="th-measure">
                <span className="th-name">
                  Text<span className="depth-tag">verbatim</span>
                </span>
              </span>
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
          /* Enlarge, before anything else looks at this press.
             Ahead of the link test on purpose: a picture inside a link gets
             both a button and a link, and pressing the *button* has to mean the
             button. The link keeps the picture itself — see below. */
          const target = e.target as Element;
          /* `button.zoom-btn`, not `.zoom-btn`. The sanitiser strips both of our
             class names from article markup (src/sanitize-policy.ts), so a
             forged one cannot reach here — but naming the tag as well means the
             handler does not depend on that being true, and `<button>` is
             itself forbidden in article HTML. Two independent reasons this can
             only ever be ours. GPT Sol, 2026-08-28. */
          const zoomButton = target.closest?.(`.prose button.${ZOOM_BTN_CLASS}`);
          if (zoomButton) {
            e.preventDefault();
            const figure = zoomTargetOf(zoomButton);
            if (figure) setZoomed(figureFor(figure));
            return;
          }
          const link = (e.target as Element).closest?.("a[href]");
          /* A picture is its own button. There is nothing to select inside an
             `<img>`, so a plain click on one is unambiguous — which is why this
             is offered for pictures and not for tables or code, where a click is
             someone starting a selection.

             A picture inside a link is left to the link: following it is what
             the author wrote, and the ⤢ beside it is still there for the reader
             who wanted the other thing.

             What is enlarged is the WRAPPER'S element, not the node under the
             pointer — they are the same thing for a loose `<img>` and different
             for one inside a `<picture>` or a `<figure>`, and enlarging the
             `<img>` out of a `<picture>` would show the fallback file rather
             than the one the reader is looking at. */
          if (!link && target.closest?.(`.prose .${ZOOM_WRAP_CLASS} :is(img, svg)`)) {
            const figure = zoomTargetOf(target);
            if (figure) {
              e.preventDefault();
              setZoomed(figureFor(figure));
              return;
            }
          }
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
          /* A link asking for its own tab gets one, and the browser does it
             natively — which is what keeps a middle click, a ⌘-click and a
             long-press "Open in New Tab" behaving exactly as they do anywhere
             else.

             **The `target` is ours, never the article's.** DOMPurify drops an
             author's `target` (measured 2026-09-04), and the pass that runs
             straight after it at ingress writes `_blank` onto every link that
             leaves the app — src/web/external-links.ts, and
             SPIDERYARN-READING2-10. This test is still
             written against the attribute rather than against the href, because
             the attribute is the thing that decides what the browser will do.
             The keywords are ASCII case-insensitive, so `_SELF` is `_self`. */
          const to = link.getAttribute("target")?.toLowerCase();
          if (to && to !== "_self") return;
          const blockId = internalTarget(e.target as Element, document);
          if (!blockId) return; // not ours to handle — an outbound link, or a dead fragment
          e.preventDefault();
          /* A footnote marker is an internal link with one extra thing to
             remember: which passage the reader left. Recognised by the shared
             rule rather than by the attribute alone — notes-view.ts. */
          const note = notes && onFollowNote ? noteMarkerAt(link, document, notes) : null;
          if (note && onFollowNote) {
            const from = link.closest("tr[data-block]")?.getAttribute("data-block") ?? null;
            return onFollowNote(from, note);
          }
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
          /* **One `<mark>` can carry both classes, and which one wins a click
             changed on 2026-08-28.**

             The old rule was chat first, and it was right for the reason it
             gave: comments had been closed to new arrivals since 2026-08-26, so
             an overlap was always an older explanation sitting under a living
             conversation. Both halves of that stopped being true when a comment
             became the reader's own free mark — and worse, **every "Save & ask"
             now creates this overlap deliberately**, so the old rule would hide
             the reader's own note behind the chat it started, every time. GPT
             Sol's review of docs/plans/260828a-comments-and-bookmarks.md, finding 7.

             So the comment wins when it is *this* conversation's comment — the
             two are linked, the reader made them in one gesture, and the note
             is the thing they wrote. The chat is one button away inside the
             dialog. An overlap with an *unrelated* chat keeps the old
             preference, because there the conversation really is the more
             recent thing and the note has its own mark elsewhere.
             See annotate.ts § MarkKind. */
          /* **Every id on the mark, not just the first of each list.** These
             attributes are space-separated because one `<mark>` can stand for
             several overlapping things, and reading `[0]` off each meant a
             linked pair anywhere further along was invisible — the reader's own
             note stayed hidden exactly when there were two marks on the words.
             GPT Sol, reviewing the built code, 2026-08-28. */
          const idsOn = (el: Element | null | undefined, attr: string): string[] =>
            el?.getAttribute(attr)?.split(" ").filter(Boolean) ?? [];
          const chatIds = idsOn((e.target as Element).closest?.("mark.chat"), "data-chat");
          const commentIds = idsOn((e.target as Element).closest?.("mark.cmt"), "data-comment");

          // The linked pair wins wherever it is in either list.
          const linked = commentIds.find((id) => {
            const own = comments.find((c) => c.id === id);
            return own?.threadId !== undefined && chatIds.includes(own.threadId);
          });
          if (linked) return onOpenComment(linked);
          if (chatIds[0]) return onOpenChat(chatIds[0]);
          if (commentIds[0]) onOpenComment(commentIds[0]);
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
                          <BlockRange
                            className="range"
                            range={node.range}
                            onJump={onJump}
                            linkBase={linkBase}
                          />
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
                // `kind-heading`, which gets more space above than below so a
                // heading groups with the section it introduces, and
                // `kind-caption`. Emitted for every kind so the next rule that
                // needs one does not have to change JSX.
                /* `ctx-*` is the other axis: the authored box a run of blocks
                   sits *inside* (`Block.context`, src/types.ts), rather than
                   what any one of them is. A heading in a callout is
                   `kind-heading ctx-callout` and gets both treatments, which is
                   the case `kind: "callout"` could not express — see
                   docs/plans/260831af-carrying-markup-facts-past-readability.md.
                   `kind-callout` is still emitted for revisions extracted in the
                   few hours that kind existed, and the stylesheet answers to
                   both. */
                /* **No class here says how tall this row's gutter is, and that
                   is the 2026-09-05 change.** `gutter-pad` used to, flooring
                   every owner's row at three slots so nothing could hang below
                   it into the next paragraph. The gutter now measures the room
                   the row already has and draws only what fits — styles.css §
                   the gutter — so *that* floor, the class and
                   `tests/gutter-pad-floor.test.tsx` have all gone, and a
                   one-line paragraph is 39.1px again rather than 87.1px. The
                   one-slot floor on `td.text` stays, because the collapsed
                   gutter still draws one 24px control.

                   The invariant they existed for is narrowed, not dropped:
                   nothing **closed** may be drawn below what its own row has
                   room for, the open "…" panel being a deliberate exception. It
                   is enforced a row at a time by a container query instead of a
                   class at a time from here. */
                /* `note` on every block of the notes region and `note-open` on
                   its first, which is the one that carries the rule across the
                   column and the heading. Both come off the note index rather
                   than off `block.role`, so the stylesheet and the hover card
                   agree about what a note is — notes-view.ts § isNoteBlock is
                   the one definition. See `noteStarts` above. */
                className={`text pin-right kind-${block.kind}${
                  block.context ? ` ctx-${block.context.type}` : ""
                } ${!block.gistable ? "opaque" : ""}${
                  hitStrength?.has(block.id) ? " has-hit" : ""
                }${
                  notes?.noteOf.has(block.id) ? " note" : ""
                }${noteStarts.get(block.id)?.opensRegion ? " note-open" : ""}`}
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
                {/* The reader's own column: the address of this paragraph, the
                    marks they have made on it, and — for a reader who can spend
                    — the door into chat that has always been here.
                    BlockGutter.tsx has the rule it follows and the slots it
                    is. */}
                <BlockGutter
                  id={block.id}
                  linkBase={linkBase}
                  comments={cmtsByBlock.get(block.id)}
                  chatCount={chatCounts.get(block.id) ?? 0}
                  onOpenComment={onOpenComment}
                  onChatAbout={onChatAbout}
                  onHelp={onHelp}
                  onJump={onJump}
                  announce={announce}
                />
                {/* **The heading the source never wrote.** Gwern's page ends
                    `## Bibliography` and then nine bare `<li>`s; Wikipedia
                    writes its own `References` and gets nothing from us. A real
                    element rather than CSS `content`, because it is a landmark
                    a reader may be scrolling to find and generated content is
                    neither selectable nor searchable in the page. */}
                {noteStarts.get(block.id)?.needsHeading && (
                  <div className="notes-head">Notes</div>
                )}
                {/* The author's own number, in the margin the note's prose is
                    indented by. `aria-hidden` because the note's `<li>` is
                    already announced as a list item and the number is a
                    landmark for the eye — the reader who needs to *know* which
                    note this is arrived by a marker, and the back-link beside
                    them says so. */}
                {noteStarts.has(block.id) && (
                  <span className="note-num" aria-hidden="true">
                    {noteStarts.get(block.id)?.label}
                  </span>
                )}
                <div
                  className="prose"
                  /* Looked up, not built here — and the lookup is the fix.
                     An object literal in this position is a new object every
                     render, which React reads as a change and answers with an
                     unconditional `innerHTML =`; `proseHtml` above has the
                     measurement. The map covers every block, so the fallback
                     is unreachable — it is here so that a block that somehow
                     escaped the memo still renders its own prose rather than
                     an empty paragraph. */
                  dangerouslySetInnerHTML={proseHtml.get(block.id) ?? { __html: block.html }}
                />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
    {/* One panel per gist column, laid over it, following the focus line —
        see useColumnContext.ts. `depths` and not `panels` alone: `columns` can
        be the leaf column on its own (`?cols=3`, or Para with every gist pill
        off), which passes `panels` and yields no levels at all — and then the
        hook measures every row on every scroll to decide which entry of nothing
        to highlight. Same waste `panels` was given its `columns.length` guard
        for in 2026-08-27; that guard simply cannot see the leaf column, because
        `levels` is what drops it. */}
    {panels && depths.length > 0 && (
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
    {/* One overlay for the whole article, always mounted and empty until a
        figure is pressed. Mounted rather than conditionally rendered because
        `showModal()` has to be called on an element that is already in the
        document, and a `<dialog>` that is not open occupies no space and paints
        nothing. */}
    {/* Where `announce` writes. Empty until a reader copies a permalink, and
        `.sr-only` rather than hidden, because a hidden live region announces
        nothing. */}
    <span ref={liveRef} className="sr-only" role="status" aria-atomic="true" />
    <Lightbox
      figure={zoomed}
      onClose={() => setZoomed(null)}
      /* The same jump every gist, spine segment and arrow key uses. The cast is
         the one `internalTarget` forces on every caller — it reads an id out of
         a stranger's href and returns a string. */
      onJump={(blockId) => onJump(blockId as BlockId)}
    />
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
