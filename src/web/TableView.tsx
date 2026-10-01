/**
 * The article's prose — one table row per block, and every mark, gutter and
 * door the modes put on it.
 *
 * **A table because it was the tabular granularity view**: gist columns coarse
 * to fine on the left, the prose on the right (granularity-zoom.md#the-tabular-view).
 * Those columns went with the Hierarchy mode on 2026-09-29
 * (docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md), and the
 * prose column is what is left. It stays a table because everything downstream
 * addresses it as one — `tr[data-block]` for the reading position and the
 * arrow keys, `td.text .prose` for comment offsets, `thead` for the sticky
 * offsets — and none of that was worth moving for its own sake.
 */
import {
  memo,
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Article,
  Block,
  BlockId,
  Comment,
  Crossref,
} from "../types.js";
import { XREF_NONCE, xrefTarget } from "./xref.js";
import { useRenderCount } from "./perf.js";
import type { Geometry } from "./tree.js";
import type { Fit } from "./layout.js";
import {
  annotateHtml,
  BAR_HUES,
  renderedText,
  resolveMark,
  termMarks,
  citeMarks,
  xrefMarks,
  type CiteSelection,
  type Mark,
  type TermSelection,
} from "./annotate.js";
import { readSelection, type SelectionAnchor } from "./selection.js";
import { rendersMaths } from "./maths-provenance.js";
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
import { BlockGutter } from "./BlockGutter.js";
import { commentsByBlock } from "./comment-nav.js";
import { costOn, NO_CLOCK, noteCost } from "./annotation-cost.js";
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
import { hasOriginalPdf, PdfFigureNotes, pdfFigureNotesIn } from "./PdfFigureNote.js";

/**
 * How long the live region stays empty between two announcements.
 *
 * Long enough for a screen reader to observe the clear as its own mutation,
 * short enough that a copy still feels acknowledged. It is a gap, not a delay
 * the reader waits on — the tick has already appeared.
 */
const ANNOUNCE_GAP_MS = 60;

/**
 * The empty list handed to every block that has no marks of a given kind.
 *
 * **A shared constant rather than a `[]` literal, and it is load-bearing.**
 * `proseHtml` decides a block can reuse last render's html by comparing its
 * three mark arrays **by identity**, and a fresh `[]` per block per render is a
 * different array every time — so a literal would miss on the ~455 unmarked
 * blocks of a 551-block article, which are exactly the blocks the reuse exists
 * for. Never mutated — and `readonly` rather than `Mark[]` so it cannot be:
 * everything here spreads it into a new array.
 */
const NO_MARKS: readonly Mark[] = [];

/**
 * What one block's prose was built from, beside the `{ __html }` built from it.
 *
 * The inputs are kept so the next render can ask "is any of this different?"
 * before parsing anything — see `proseHtml`, which is where the fields are
 * compared and where each one earns its place.
 */
interface ProseEntry {
  /**
   * The block's own html. **Stable identity is not immutable content**: a
   * re-extraction can change a block's html under the same id, so the content
   * is part of the key and the id alone never is (block-ids.md).
   */
  html: string;
  /** `marksByBlock`'s array for this block — comments and anchored chats. */
  cmts: readonly Mark[];
  /** `termMarksByBlock`'s array for this block — every glossary occurrence. */
  terms: readonly Mark[];
  /** The `hitMarks` prop's array for this block — the search's marks. */
  hits: readonly Mark[];
  /** `citeMarksByBlock`'s array for this block — every cited work placed here. */
  cites: readonly Mark[];
  /**
   * `xrefMarksByBlock`'s array for this block — the cross-references starting
   * here. In the key for the reason `cites` is: the links are a separate GET
   * that lands after the blocks, and a memo that ignored them drew them only
   * when something else happened to move (see the `proseHtml` dependencies).
   */
  xrefs: readonly Mark[];
  /**
   * `openTerm`, but **only when this block carries that term** — otherwise
   * null.
   *
   * The pressed term is global, so keying on it directly would invalidate every
   * block in the article on every press and buy nothing. What actually changes
   * a block's html is whether the term the reader just pressed, or the one they
   * pressed before, is in *this* block. The other three selections need no such
   * field: `open` is already folded into the arrays above, per block.
   */
  openTerm: string | null;
  /** What React is handed, and the object identity it compares. */
  out: { __html: string };
}

/**
 * The term the reader has pressed, **but only in the blocks it is actually
 * in** — null everywhere else.
 *
 * `openTerm` is one id for the whole article, so it is the wrong key for a
 * per-block cache: it changes on every press and would invalidate every block.
 * What changes a block's html is whether the newly or previously pressed term
 * has an occurrence in *this* block. See `ProseEntry.openTerm`.
 */
function pressedIn(terms: readonly Mark[], openTerm: string | null | undefined): string | null {
  if (!openTerm) return null;
  return terms.some((m) => m.id === openTerm) ? openTerm : null;
}

/**
 * Whether this block is drawn from exactly what last render's entry was drawn
 * from — the equality contract `proseHtml` reuses on, in one place.
 *
 * **Identity for the arrays, value for the html.** `===` is cheap and exact;
 * comparing their contents would be a second pass over every mark in the
 * article to save a pass over one block.
 *
 * **What identity survives, and what it does not.** The three producers hand a
 * block back its own array across the two gestures this exists for: a
 * **selection change** — a different comment, chat, term or search result
 * pressed, where only the blocks losing and gaining the ring get new arrays —
 * and a **streamed delta**, where the comment objects and the array are all
 * replaced but no anchor moves. They preserve nothing across a genuine change
 * to a source: one moved anchor rebuilds every resolved array, a new `terms`
 * rebuilds every term array, and a new `Found[]` rebuilds every base hit array.
 * So writing one comment re-annotates every block that carries a comment or a
 * chat, not only the block that gained it — the html usually comes back
 * identical and React is handed the object it already has, but the parse is
 * paid. That is the intended shape: the gestures that repeat are the ones made
 * cheap.
 *
 * The html is compared by value because a re-extraction produces an equal
 * string in a new `Block`, and rebuilding 551 unchanged paragraphs on a
 * refetch would give back what this exists to save. `ProseEntry` says what
 * each field is for.
 */
function sameInputs(
  had: ProseEntry,
  block: Block,
  cmts: readonly Mark[],
  terms: readonly Mark[],
  hits: readonly Mark[],
  cites: readonly Mark[],
  xrefs: readonly Mark[],
  openTerm: string | null,
): boolean {
  return (
    had.html === block.html &&
    had.cmts === cmts &&
    had.terms === terms &&
    had.hits === hits &&
    had.cites === cites &&
    had.xrefs === xrefs &&
    had.openTerm === openTerm
  );
}

/**
 * Every comment's and every chat's **anchor**, as one string.
 *
 * The key `marksByBlock` reuses its resolution on, and the whole point is what
 * it leaves out: the body, the answer, the status, the object and the array.
 * Those change on every streamed token; where the words sit does not.
 *
 * The quote's length goes in ahead of the quote so no arrangement of separators
 * inside a quote can spell another record, and each entry says whether it is a
 * comment or a chat, so a comment and a conversation sharing one anchor cannot
 * trade places unnoticed.
 */
function anchorKey(comments: readonly Comment[], chats: readonly AnchoredThread[]): string {
  const parts: string[] = [];
  for (const c of comments) {
    /* A whole-block bookmark has no words to find, and `-` cannot be a length,
       so it cannot spell a quoted record. */
    parts.push(
      c.quote === undefined
        ? `c\n${c.id}\n${c.blockId}\n-`
        : `c\n${c.id}\n${c.blockId}\n${c.start}\n${c.quote.length}\n${c.quote}`,
    );
  }
  for (const t of chats) {
    const a = t.anchor;
    parts.push(`t\n${t.id}\n${a.blockId}\n${a.start}\n${a.quote.length}\n${a.quote}`);
  }
  return parts.join("\n");
}

/**
 * Where each comment and chat's words actually are, grouped by block.
 *
 * The expensive half of `marksByBlock`: a `renderedText` parse and a search per
 * anchor. Resolution can fail — the paragraph was edited and the quote is gone
 * — and then that comment simply draws no mark. It is still in the list and
 * still openable; what it must never do is underline whatever text now happens
 * to sit at that offset. See annotate.ts § Why the offsets are DOM offsets.
 *
 * Nothing here knows which comment is open: `applyOpen` puts that on top.
 */
function resolveAnchors(
  comments: readonly Comment[],
  chats: readonly AnchoredThread[],
  byId: ReadonlyMap<BlockId, Block>,
): ReadonlyMap<BlockId, readonly Mark[]> {
  const byBlock = new Map<BlockId, Mark[]>();
  const push = (blockId: BlockId, mark: Mark) => {
    const list = byBlock.get(blockId) ?? [];
    list.push(mark);
    byBlock.set(blockId, list);
  };
  for (const c of comments) {
    /* **A whole-block bookmark draws no mark**, and that is the design rather
       than a gap: underlining every word would make every tap in the paragraph
       open the note. Its gutter mark is the whole of it — `commentsByBlock`
       groups on `blockId` alone, so it is still counted there. */
    if (c.quote === undefined) continue;
    const block = byId.get(c.blockId);
    if (!block) continue;
    /* **Not the offset, in a block that had maths drawn into it** — a formula's
       symbols are shorter than its source, so an anchor made before the render
       could otherwise move to a repeat of its words. maths.ts § What it costs a
       comment. */
    const found = resolveMark(renderedText(block.html), c, {
      offsetTrusted: !rendersMaths(block),
    });
    if (!found) continue;
    push(c.blockId, { id: c.id, ...found });
  }
  for (const t of chats) {
    const block = byId.get(t.anchor.blockId);
    if (!block) continue;
    const found = resolveMark(renderedText(block.html), t.anchor, {
      offsetTrusted: !rendersMaths(block),
    });
    if (!found) continue;
    push(t.anchor.blockId, { id: t.id, ...found, kind: "chat" });
  }
  return byBlock;
}

/**
 * The same marks with the open comment's and open chat's flagged — **and every
 * other block's array handed back unchanged, by identity.**
 *
 * That last clause is the entire reason this is a second pass rather than an
 * `open:` written in the loop above. `proseHtml` compares these arrays by
 * identity to decide whether a block's html can be reused, so a pass that
 * rebuilt them all would make every selection change cost an article's worth of
 * `annotateHtml`. Only the block losing the ring and the block gaining it get a
 * new array; a block that was never involved gets the array it already had.
 *
 * `open` is omitted rather than set to `false` on the marks that are not
 * pressed, because annotate.ts only ever reads it for truth — and because a
 * `false` here would be a second spelling of the same mark.
 */
function applyOpen(
  base: ReadonlyMap<BlockId, readonly Mark[]>,
  openComment: string | null,
  openChat: string | null,
): ReadonlyMap<BlockId, readonly Mark[]> {
  if (openComment === null && openChat === null) return base;
  const isOpen = (m: Mark) => (m.kind === "chat" ? m.id === openChat : m.id === openComment);
  const out = new Map(base);
  for (const [blockId, marks] of base) {
    if (!marks.some(isOpen)) continue;
    out.set(
      blockId,
      marks.map((m): Mark => (isOpen(m) ? { ...m, open: true } : m)),
    );
  }
  return out;
}

/* ------------------------------------------------ selecting a block by tap --
 *
 * **On a touch device the gutter's affordances are drawn on the selected row
 * and nowhere else** (styles/gutter.css § the touch reveal), so a finger needs
 * a way to say which row that is. This is it, and the whole reason it is a
 * named predicate rather than an `onClick` on the `<tr>` is that the `<tr>`
 * version has no policy: some nested taps would select and others would not,
 * according to which handler cancelled first, which element called
 * `stopPropagation`, and whether the hover card had already swallowed the
 * click at document capture. Sol walked all nine cases on 2026-09-07 and they
 * did not form a rule. Written as policy it can be tested; written as
 * propagation it could only be discovered.
 * docs/plans/260908e-gutter-icons-on-touch-only-when-a-block-is-selected.md.
 */

/**
 * **`(hover: hover)`, asked once and read live.**
 *
 * The exclusion list below is worth nothing while a second writer can set the
 * same state, and on a touch device there is one: a tap fires the compatibility
 * mouse events, `mouseenter` among them, so `hoveredRow` was being written by
 * every tap on the row regardless of what the tap landed on. **This is measured
 * rather than feared** — the reproduction in the plan doc watched a Chromium tap
 * set and hold `row-active` on the commit *before* any click handler existed,
 * and `onMouseEnter` was the only writer there was. So the comment that used to
 * say "a finger fires no `mouseenter`" was exactly backwards. GPT Sol, 2026-09-08.
 *
 * Gating the hover writers on the same capability the stylesheet asks about
 * leaves one path on each kind of device: hover on a pointer, this predicate on
 * a finger. It also settles what iOS does with `mouseleave` — nothing, because
 * nothing is listening.
 *
 * **Asked at event time rather than cached**, which is the same shape
 * `scroll.ts` uses for `prefers-reduced-motion`. It follows a mouse being
 * plugged into an iPad with no listener and no re-render, it is a microsecond
 * against a pointer crossing a row, and a value fixed at module load could not
 * be exercised by a test at all. `true` where the question cannot be asked — no
 * `window`, or a `matchMedia` a privacy extension has removed — so anything that
 * is not a browser behaves as it always did.
 */
const canHover = (): boolean =>
  typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? true
    : window.matchMedia("(hover: hover)").matches;

/** Everything inside `td.text` that a tap already means something else by. */
const NOT_A_BLOCK_SELECTION = [
  /* Following it is the point of tapping it, and selecting the row it is
     leaving would leave the selection behind on a row nobody is on. */
  "a[href]",
  /* Every `<mark>` the annotator draws **except a quote**: a comment, a chat
     anchor, a search hit, a glossary term. `mouseup` has already acted on these
     (below), and a glossary term's click never even arrives — useHoverCard
     cancels it at document capture. Naming them means the answer is the same
     either way.

     **A quote is the one mark nothing acts on, and since 2026-09-08 it is on
     the page in every mode** — so a blanket `"mark"` would turn up to 32 of an
     article's best sentences into dead zones for the tap that selects a
     paragraph, which is how a finger reaches the gutter and therefore how a
     reader annotates (docs/project/touch.md). The list below says "a quote and
     nothing else": a quote that *also* carries a comment, a chat anchor, a
     glossary term or a search's wash keeps the exclusion, because there the tap
     does mean something. GPT Sol found this, reviewing
     docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md — the plan
     had recorded "nothing clicks a `mark.hit`" as a reason there was nothing to
     worry about, which was true and was the wrong conclusion.

     A search-only hit stays excluded, which is what it is today; whether that is
     right is not this change's question.

     **`mark.hit:not([data-quote])` is redundant today** — every hit without a
     quote tier gets `data-wash` (annotate.ts § `washes`) — and is kept as the
     one entry that states the rule rather than a consequence of it. If the two
     ever disagree, exclusion wins: `closest` takes the list as an OR.

     **The one case this still gets wrong**: a quote inside a `<mark>` the
     *article itself* wrote. `annotateHtml` nests its own mark inside the
     author's, so the inner quote matches nothing here but its ancestor matches
     `mark:not(.hit)`, and `closest` walks up to it. Rare enough to name rather
     than engineer around — source `<mark>` survives sanitising but loses our
     reserved classes (src/sanitize-policy.ts) — and the real fix is to decide
     from the nearest *generated* mark while checking interactive ancestors
     separately. GPT Sol, 2026-09-08. */
  "mark:not(.hit)",
  "mark.hit.cmt",
  "mark.hit.chat",
  "mark.hit.term",
  /* **A citation inside a quoted sentence**, added 2026-09-16 with the fifth
     `MarkKind`. A bare `mark.cite` is already caught by `mark:not(.hit)` above;
     this is the case that is not, and leaving it out would have made a citation
     inside a quote behave differently from a glossary term inside a quote for no
     reason a reader could see.

     It belongs on this list for the list's own stated reason — *a tap on it
     already means something*: `mark.cite` is in the hover card's `tapSelector`,
     so the first tap opens the work's card. That is what makes this an exclusion
     rather than a dead zone, and it is why the card's touch half could not be
     deferred: without it, this line would take the tap away and give nothing
     back. ProseHoverCard.tsx § tapSelector. */
  "mark.hit.cite",
  /* **A cross-reference inside a quoted sentence**, for the citation's reason
     one line up: a bare `mark.xref` is caught by `mark:not(.hit)`, and a tap
     on one already means something — it jumps (the `<tbody>` click below). */
  "mark.hit.xref",
  "mark.hit[data-wash]",
  "mark.hit:not([data-quote])",
  /* The ⤢ on a figure, and every control in the gutter. The gutter's own
     buttons also call `stopPropagation`, and that is exactly what this list
     exists not to depend on. */
  "button",
  /* **And the picture itself, which is the other zoom surface.** The delegated
     handler on `<tbody>` says "a picture is its own button" and opens the
     lightbox for a bare `<img>` or `<svg>` inside a `.zoomable` wrapper — so
     excluding only the ⤢ would select the row on the way past and open the
     overlay over a freshly-painted wash. Written with the handler's own
     selector, verbatim, so the two cannot drift apart; a picture inside a link
     is caught by `a[href]` above, exactly as it is there. GPT Sol, 2026-09-08. */
  `.prose .${ZOOM_WRAP_CLASS} :is(img, svg)`,
  "[role='button']",
  /* **The OPEN "…" panel, and only that.** A closed gutter is
     `pointer-events: none`, so a tap on its blank strip never lands here at
     all — it falls through to this cell and selects the row, which is the
     finger's version of "hovering blank gutter still reveals the icons" and is
     wanted rather than tolerated. The open panel takes its hit-testing back
     deliberately, because it is opaque and the paragraph behind it must not be
     pressable through it (gutter.css § the gutter), so its padding and border
     are a real target with no handler — and this is what stops one selecting
     the row underneath. */
  ".blk-gutter",
  /* A footnote marker that the source wrote without an href. */
  "[role='doc-noteref']",
  ".footnote-ref",
].join(", ");

/**
 * **Whether this click is a reader choosing this block**, rather than reaching
 * for something inside it.
 *
 * `detail === 0` is a click no pointer produced — a keyboard or
 * assistive-technology activation, which fires `click` with no preceding
 * `mouseenter`. Without this guard, tabbing to a link in the prose and pressing
 * Enter would move the selected row and paint the wash, on input that never
 * touched the row. GPT Sol, 2026-09-07.
 */
function isBlockSelectionTap(event: {
  target: EventTarget | null;
  detail: number;
}): boolean {
  if (event.detail === 0) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return target.closest(NOT_A_BLOCK_SELECTION) === null;
}

interface Props {
  article: Article;
  /** Built once in Reader, because the reading-position code needs it too. */
  geometry: Geometry;
  /** The prose column's width, and whether it overflows. See layout.ts. */
  layout: Fit;
  /* **No gist columns since 2026-09-29** — no `columns`, no `showText`, and no
     `sections` or `layoutKey`, which only the fisheye panels over those
     columns read. docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md. */
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
  onSelect(anchor: SelectionAnchor): void;
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
   * The reader pressed the bookmark button beside a paragraph — resolves to
   * whether it was stored. Absent for a visitor, passed the same way as the two
   * above; BlockGutter.tsx has the argument.
   */
  onBookmark?: ((blockId: BlockId) => Promise<boolean>) | undefined;
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
   * The works the piece cites, and the verified places it cites them.
   *
   * The whole list, in every mode, since 2026-09-16
   * (SPIDERYARN-READING2-3M) — and the whole list rather than the part above the
   * threshold bar, because `?citebar=` is reachable only from Citations mode
   * while these marks are visible from every one of them. `citeMarks` in
   * annotate.ts has the argument.
   *
   * **No pressed-one prop beside it**, unlike `terms`/`openTerm`: nothing
   * selects a citation from the band yet (`?cite=` is deferred), so there is no
   * second state to keep off the scan's key.
   *
   * Optional, so an article with no citations — and every test that renders this
   * table without them — goes on working unchanged.
   */
  cites?: readonly CiteSelection[] | undefined;
  /**
   * **The cross-references to draw** — the owner's validated links, or null for
   * a visitor, a stale artefact, or none generated (useCrossrefs.ts decides).
   * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md.
   *
   * The same array is what a click resolves against: `xrefTarget` reads `to`
   * from here by the index the mark names, never from the DOM. Optional, for
   * `cites`' reason.
   */
  xrefs?: readonly Crossref[] | null | undefined;
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
  hitMarks?: ReadonlyMap<BlockId, readonly Mark[]> | undefined;
  hitStrength?: Map<BlockId, number> | undefined;
  /** The palette slots of every search that matched in each block — `blockHues`. */
  hitHues?: Map<BlockId, number[]> | undefined;
  /**
   * This page's address with `at` dropped — `"/read/x?mode=summary"`. What the
   * 551 block permalinks in the gutter are built from.
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
  /**
   * **The article's slug, from the route** — for the *view the original*
   * control beside a PDF's figures (PdfFigureNote.tsx).
   *
   * A prop rather than `article.meta.slug`, and the reason is `Origin`'s in
   * Metadata.tsx: an address with no article of its own is answered with a
   * fixture's meta, so the two can disagree, and a control that opens *a
   * document* must be about the one the reader is standing on. It is also a
   * string, so it cannot cost this memo a render.
   */
  slug: string;
  /**
   * **One thing to hang after one block's prose**, or nothing — the open
   * mode's door into the rest of the page. Trajectory's "Next stop ›" is the
   * one user (TrajectoryPanel.tsx § TrajectoryDoor): after the current stop's
   * block, where a reader who has just read it has their eyes and thumb.
   *
   * On the path `PdfFigureNotes` already takes — a sibling after `.prose`,
   * never markup inside the block, so no comment anchor moves (selection.ts
   * roots its offsets at `td.text .prose`). One slot rather than a map because
   * one mode is open at a time and each would hang one thing.
   *
   * **Memoise it in the caller**: a fresh object every render costs this memo
   * every render.
   */
  afterBlock?: { blockId: BlockId; node: ReactElement } | null | undefined;
  /**
   * **The quiz's questions, each after the block it is about** — in every mode,
   * not the open mode's, which is why this is a second prop and not a wider
   * `afterBlock`: that one stays one mode's single slot, and a standing feature
   * of the article is braided into it by nothing. Drawn on the same path, a
   * sibling after `.prose`, and **before** `afterBlock`, so in Trajectory the
   * question sits between the stop's passage and its door.
   * QuizInProse.tsx; SPIDERYARN-READING2-6V.
   *
   * **Memoise it in the caller**, for `afterBlock`'s reason.
   */
  quizAfter?: ReadonlyMap<BlockId, ReactElement> | null | undefined;
  /**
   * **Annotations mode's notes, each beside its block** — absolutely
   * positioned just past the cell's right edge (marginalia.css), so they scroll
   * with their row and sit level with it. Out of flow, so they cost the prose
   * no height, and outside `.prose`, so selection offsets (selection.ts) never
   * see them. AnnotationsColumn.tsx.
   *
   * **Memoise it in the caller**, for `afterBlock`'s reason.
   */
  margin?: ReadonlyMap<BlockId, ReactElement> | null | undefined;
}

/**
 * **Memoised** — one of two in `src/web`; `Spine` is the other.
 *
 * `useReadingPosition` writes `?at=` to the address as sections pass the
 * reading line — a deliberate feature (docs/project/url-state.md) — and that
 * re-renders `Reader` **87–88 times during one scroll** of a 551-block article,
 * measured 2026-09-04. None of this table's 29 props depends on `at`, so every
 * one of those renders reconciled 551 rows, their cells, `thead`, `colgroup`
 * and `Lightbox` to produce the same tree.
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
  layout,
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
  onBookmark,
  terms,
  cites,
  xrefs,
  openTerm,
  hitMarks,
  hitStrength,
  hitHues,
  linkBase,
  slug,
  afterBlock,
  quizAfter,
  margin,
}: Props) {
  useRenderCount("TableView");
  const { blocks } = article;
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
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
   * The article's blocks by id, for `resolveAnchors` above — which is where
   * comments and chats are resolved against the prose they were made on, and
   * what happens when a quote is gone.
   */
  /* Indexed once. The loop below used to do `blocks.find` per comment, which is
     O(comments x blocks) plus a DOM parse each time — and folding every anchored
     conversation into the same pass would have multiplied a cost that was
     already the expensive half of this memo. */
  const byId: ReadonlyMap<BlockId, Block> = useMemo(
    () => new Map(blocks.map((b) => [b.id, b])),
    [blocks],
  );

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

  /**
   * Last render's anchor resolution, and the two things it depended on.
   *
   * A cache keyed on value equality, which is what makes writing to it during
   * render safe — the same argument `proseCache` below makes. What is stored is
   * a pure function of `anchorKey(comments, chats)` and the block map, so a
   * double-invoked or abandoned render can only ever hand back something a
   * fresh computation would have produced.
   */
  const marksCache = useRef<{
    /** The semantic anchors, as a string — see `anchorKey`. */
    key: string;
    /** The block map those anchors were resolved against. */
    blocks: ReadonlyMap<BlockId, Block>;
    /** The resolution, with nothing marked open. */
    base: ReadonlyMap<BlockId, readonly Mark[]>;
    /** Which comment and chat were open when `out` was built. */
    open: string;
    /** `base` with `open` applied — what the memo actually returned. */
    out: ReadonlyMap<BlockId, readonly Mark[]>;
  } | null>(null);

  /**
   * Where every comment and every anchored chat sits in the prose, as marks.
   *
   * ## Resolution is keyed on the anchors, not on the comments
   *
   * `useComments.ts` § the `delta` branch calls
   * `put({ ...rest, id, status: "pending", answer: text })` on **every streamed
   * token**, so the comment object and the whole `comments` array are replaced
   * while `blockId`, `quote` and `start` are untouched. A memo keyed on either
   * identity therefore re-resolves the article's anchors dozens of times per
   * answer. So the key is `anchorKey` — the semantic anchor inputs — plus the
   * block map, which stands in for the block content: `byId` is rebuilt only
   * when `article.blocks` is, and nothing on the client mutates a blocks array
   * in place (search-hits.ts § `pages` has the long version of that argument).
   *
   * ## And `open` is applied afterwards, per block
   *
   * **The value of this is not the handful of parses it saves.** Five comments
   * on a 551-block article cost five `renderedText` calls; the measurement in
   * docs/plans/260905i-… says so plainly. It is that the **per-block arrays
   * survive a selection change by identity**, which is the precondition for
   * `proseHtml` below reusing anything at all. Before this, opening one dialog
   * gave every block in the article a new marks array, so every marked block
   * re-annotated — 96 `annotateHtml` calls to move one ring. A future reader
   * looking at the parse count alone will conclude this is elaborate machinery
   * for nothing; the win is one memo further down.
   *
   * So: the resolution is reused when the anchors have not moved, the
   * open-applied map is reused when the selection has not moved either, and
   * only the blocks holding the previously or newly open id get a new array.
   *
   * Chats and comments share one map rather than living in two, because they
   * are resolved the same way against the same prose and change on the same
   * clock — a reader asking a question. The glossary's marks are a second map
   * precisely because they change on a different one.
   */
  const marksByBlock = useMemo(() => {
    /* Off by default; see src/web/annotation-cost.ts, including why this ms
       *contains* the `renderedText` and `resolveMark` ms and must not be added
       to them. Timed whenever the probe is on at all: this is one of the two
       numbers the decision rule is applied to, and it is charged on the reuse
       path too — a memo body that ran and decided to do nothing is still this
       memo's time. */
    const timing = costOn();
    const t0 = timing ? performance.now() : NO_CLOCK;
    const key = anchorKey(comments, chats);
    const had = marksCache.current;
    const kept = had !== null && had.key === key && had.blocks === byId;
    const base = kept ? had.base : resolveAnchors(comments, chats, byId);
    const open = `${openComment ?? ""}\n${openChat ?? ""}`;
    const out = kept && had.open === open ? had.out : applyOpen(base, openComment, openChat);
    marksCache.current = { key, blocks: byId, base, open, out };
    if (timing) noteCost("marksByBlock", t0);
    return out;
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
   * The citations, by block — a third map, for the reason there is a second.
   *
   * It changes on its own clock: the glossary moves when a term is pressed and
   * the comments move on every streamed token, while this changes only when the
   * citations list itself is replaced, which is once a run. Folding it into
   * either of the others would recompute that one every time this one did not.
   *
   * Empty whenever the article has no citations, which is still the ordinary
   * case, and then the prose is untouched exactly as it was before. `citeMarks`
   * in annotate.ts, and note what it does NOT do: a place it cannot re-find
   * draws nothing rather than the whole block.
   */
  const citeMarksByBlock = useMemo(() => citeMarks(blocks, cites ?? []), [blocks, cites]);

  /**
   * The cross-references, placed. Its own memo for `citeMarksByBlock`'s reason:
   * it changes only when the links are replaced. `XREF_NONCE` is this page
   * load's, and the same one `xrefTarget` checks — xref.ts.
   */
  const xrefMarksByBlock = useMemo(
    () => xrefMarks(blocks, xrefs ?? [], XREF_NONCE),
    [blocks, xrefs],
  );

  /**
   * Last render's `{ __html }` objects **and what each was built from**, so an
   * unchanged block can be handed back the one React has already seen without
   * being computed again — see `proseHtml` below for why each half matters.
   *
   * A cache keyed on value equality, which is what makes writing to it during
   * render safe: an entry is a pure function of the inputs stored beside it, so
   * a double-invoked or abandoned render can only ever hand back something a
   * fresh computation would have produced. Nothing reads it for correctness.
   */
  const proseCache = useRef<Map<BlockId, ProseEntry>>(new Map());

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
   *
   * ## Why the entry keeps the inputs as well — the 2026-09-06 half
   *
   * Not rewriting the DOM is not the same as not *computing* the html, and the
   * measurement in docs/plans/260905i-… is about the second. A glossary press
   * on a 551-block article ran `addZoomHandles` **551 times** — including on
   * the ~455 blocks with no mark at all, whose html cannot have changed — and
   * `annotateHtml` **96 times**, to alter one block. ~40% and ~55% of a memo
   * that costs ~30ms against an 8ms budget.
   *
   * So each entry keeps the inputs it was built from, and a block whose inputs
   * are all unchanged is skipped entirely: neither call happens and the entry
   * is passed straight through. The equality contract is `ProseEntry` above,
   * and four parts of it are easy to get subtly wrong:
   *
   * - **The key is the source arrays, by identity**, not the composite `marks`
   *   array built below — that one is freshly allocated every pass and can
   *   never equal itself. `NO_MARKS` is what makes the unmarked majority
   *   compare equal at all.
   * - **`openTerm` is stored per block, not globally.** It is one id for the
   *   whole article, so keying on it directly would invalidate every block on
   *   every press.
   * - **`hitMarks` had to be split first.** `hitMarks()` in search-hits.ts used
   *   to bake `open` into fresh arrays for every block whenever the pressed
   *   result changed, so this key would have missed everywhere; § `unpressed`
   *   there is the other half of this change.
   * - **A block is always rebuilt from all its kinds at once**, which is what
   *   keeps a comment and a term over the same words in one shared `<mark>`.
   *
   * The map is rebuilt fresh every run, exactly as it was before, so a block
   * that leaves the article evicts itself and nothing here is unbounded.
   */
  const proseHtml = useMemo(() => {
    /* Off by default; see src/web/annotation-cost.ts, including why this ms
       *contains* the `annotateHtml` and `addZoomHandles` ms and must not be
       added to them. Timed whenever the probe is on at all: this is the other
       number the decision rule is applied to. */
    const timing = costOn();
    const t0 = timing ? performance.now() : NO_CLOCK;
    const was = proseCache.current;
    const byBlock = new Map<BlockId, ProseEntry>();
    for (const block of blocks) {
      /* Both kinds in one call. `annotateHtml` cuts each text node at every
         mark boundary in one pass, so a comment and a term over the same words
         produce one <mark> carrying both classes — two nested ones would read
         as a rendering bug. Concatenating here is what gives it the chance. */
      const found = termMarksByBlock.get(block.id) ?? NO_MARKS;
      const cmts = marksByBlock.get(block.id) ?? NO_MARKS;
      const hits = hitMarks?.get(block.id) ?? NO_MARKS;
      const cited = citeMarksByBlock.get(block.id) ?? NO_MARKS;
      const linked = xrefMarksByBlock.get(block.id) ?? NO_MARKS;
      const pressed = pressedIn(found, openTerm);
      const had = was.get(block.id);
      if (had && sameInputs(had, block, cmts, found, hits, cited, linked, pressed)) {
        /* Nothing this block is drawn from has changed, so neither has its
           html. The entry — and with it the `{ __html }` object React compares
           — is passed through untouched. */
        byBlock.set(block.id, had);
        continue;
      }
      const marks = [
        ...cmts,
        /* The pressed term's `open`, applied here rather than carried through
           the scan — see the `openTerm` prop. A plain `.map` over marks that
           have already been found, so a press costs no regex and no reparse of
           anything except the blocks it actually appears in. */
        ...(pressed ? found.map((m) => (m.id === pressed ? { ...m, open: true } : m)) : found),
        ...hits,
        ...cited,
        ...linked,
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
         Both halves of that are load-bearing; see the docstring above. The
         inputs changed and the output still can be identical — a comment
         resolving to the same span in a re-extracted paragraph, say — and then
         React must still be handed the object it already has. */
      byBlock.set(block.id, {
        html: block.html,
        cmts,
        terms: found,
        hits,
        cites: cited,
        xrefs: linked,
        openTerm: pressed,
        out: had && had.out.__html === withHandles ? had.out : { __html: withHandles },
      });
    }
    proseCache.current = byBlock;
    if (timing) noteCost("proseHtml", t0);
    return byBlock;
    /* **`citeMarksByBlock` was missing here until 2026-09-16**, and the feature
       it belongs to did not work — intermittently, which is the worst way for it
       not to work. The memo read the map and did not depend on it, so a
       citations list arriving after the first render (it is a separate GET; the
       blocks are in the payload) changed nothing on screen. Any *other*
       dependency moving afterwards recomputed it and the marks appeared, so one
       article had them and the next did not.
       tests/prose-not-rebuilt.test.tsx has the reproduction.

       `xrefMarksByBlock` is here for the same reason from the start: the
       cross-references are a separate GET too. tests/xref-prose.test.tsx. */
  }, [blocks, marksByBlock, termMarksByBlock, hitMarks, citeMarksByBlock, xrefMarksByBlock, openTerm]);

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
  /**
   * **The figures a PDF came with, and what became of each** —
   * PdfFigureNote.tsx.
   *
   * Memoised for `proseHtml`'s reason and keyed on the whole article: this
   * component re-renders on a pointer crossing from one row to the next, and
   * the answer changes only when the article does. `article.assets` is half the
   * input and `article.blocks` is the other, and both arrive together.
   *
   * Empty for every article that did not come from a PDF, which is almost all
   * of them, and the walk that produces it is one `String.includes` per block.
   */
  const figureNotes = useMemo(() => pdfFigureNotesIn(article), [article]);
  /* One boolean for the whole article: is there an original to open at all.
     PdfFigureNote.tsx § `hasOriginalPdf` — which is also the ownership gate,
     and says why that is safe and where to look if it stops being. */
  const canOpenSource = hasOriginalPdf(article);

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

  return (
    <>
    <table
      /* `only-prose` — the article is the only column there is. It used to hide
         the table head as well, which was worth 40px of a 390px landscape
         viewport where a third of the height is already bars; the head has had
         no height in any mode since 2026-09-05 (styles.css § the head with no
         row), so that rule went and this class is now only what centres the
         masthead over a centred column (styles.css § plain, centred).

         Since the gist columns went on 2026-09-29 it is always true, and it
         stays because the stylesheet keys off it. */
      className={`zoom reading only-prose${layout.overflowing ? " overflowing" : ""}`}
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
      {/* **A head with no height**, kept for the screen reader's column
          header and for the sticky offsets that measure it (styles.css § the
          head with no row). The gist columns' headers went on 2026-09-29. */}
      <thead>
        <tr>
          {/* The prose column is the finest granularity there is, so ↑ / ↓
              over it step one paragraph at a time. Leaves are 1:1 with blocks
              (src/hierarchy.ts). */}
          <th scope="col" data-nav-depth={geometry.leafDepth} className="text pin-right">
            <span className="sr-only">Text verbatim</span>
          </th>
        </tr>
      </thead>
      {/* The click being handled is on a real <a> inside the prose, or on a
          cross-reference mark. Enter on a focused link fires a click that
          bubbles to exactly this handler, so the keydown handler below must
          never act on a link — it would run the jump twice. It acts only on a
          cross-reference, which is not a native link and gets no such click.
          (This was a biome-ignore for useKeyWithClickEvents until the keydown
          handler existed, 2026-09-30.) */}
      <tbody
        ref={bodyRef}
        /* On a pointer only — see `canHover` above. A finger's selection is set
           deliberately and must not be cleared by a compatibility mouse event
           that no reader produced. */
        onMouseLeave={() => {
          if (canHover()) setHoveredRow(null);
        }}
        /* **Enter on a focused cross-reference jumps** (Sol F6). A `<mark>`
           with `role="link"` is not a link: the browser sends no click for
           Enter on it, so without this the one Tab stop `annotateHtml` gives a
           phrase would be a stop that goes nowhere. The same nonce-checked
           resolution as the click, and nothing else here listens for keys —
           Enter on a real `<a>` fires a click, which is why the comment above
           says a keydown handler would jump twice for those. */
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.defaultPrevented) return;
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          const xrefTo = xrefTarget(e.target, xrefs);
          if (!xrefTo) return;
          e.preventDefault();
          onJump(xrefTo);
        }}
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
          /* **A cross-reference is not a link, and a modified click on one does
             nothing** — this line returns for it as for everything else. There
             is no `href` behind the mark, so ⌘-click cannot mean "in a new tab"
             here, and turning it into an in-place jump would answer a question
             the reader did not ask. Stated rather than hidden: Sol F6 on
             docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md. */
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          /* **A cross-reference jumps** — resolved through the nonce, with `to`
             read from the artefact by index and never from the DOM, so a
             `class="xref"` the article wrote itself is an underline that does
             nothing (xref.ts). First, because it wins the words it is on: a
             term, a citation, a comment or a search's wash under it has
             already stood aside (`onMouseUp` below, ProseHoverCard's
             selectors). An author's link never contains one — `xrefMarks`
             drops those — so the link logic below is not being pre-empted.

             **Unless the click ends a selection**: the drag was the reader
             choosing words, and `onMouseUp` has already turned it into a
             question. */
          const xrefTo = xrefTarget(e.target, xrefs);
          if (xrefTo) {
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) return;
            e.preventDefault();
            onJump(xrefTo);
            return;
          }
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
          //
          // **And a drag we refuse is still a drag.** `readSelection` used to
          // answer `null` both for "no selection" and for "shorter than the
          // floor", so a skid inside a commented phrase fell all the way
          // through to the mark logic at the bottom of this handler and opened
          // that comment — the exact opposite of the rule above, over words the
          // reader never clicked. The two are separate variants now, and
          // `too-short` stops here: nothing opens, and the reader drags again.
          const read = readSelection(window.getSelection());
          if (read.kind === "anchor") return onSelect(read.anchor);
          if (read.kind === "too-short") return;
          /* A link inside a commented passage is a link. `annotateHtml` puts
             the <mark> *inside* the <a>, so without this a click on one would
             open the comment on mouseup and then jump on click — two answers to
             one click, in that order. Following the link is the one the reader
             asked for. */
          if ((e.target as Element).closest?.("a[href]")) return;
          /* **A cross-reference wins the words it is on** (Sol F5), for the
             link's reason just above: a comment or a chat under it would open
             here on mouseup and the click would then jump — two answers to one
             press. After the selection test on purpose: a drag across a
             cross-reference is still a question. Only a nonce-valid mark:
             a forged `class="xref"` leaves the comment its click. */
          if (xrefTarget(e.target, xrefs)) return;
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
            /* On a pointer only. A tap fires this too, and unguarded it would
               set the row whatever the tap landed on — which is the whole
               exclusion list below, bypassed. `canHover` above has the
               measurement. */
            onMouseEnter={() => {
              if (canHover()) setHoveredRow(row);
            }}
            className={hoveredRow === row ? "row-active" : undefined}
          >
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: there is deliberately no keyboard equivalent. This exists so a finger can say which row it is on, and `isBlockSelectionTap` refuses a click no pointer produced for exactly that reason — a keyboard reader reaches the gutter by tabbing to it, where `:focus-visible` reveals it at full strength on any row. */}
              <td
                data-nav-depth={geometry.leafDepth}
                /* **Selecting this block**, which on a touch device is what
                   draws its gutter — see `isBlockSelectionTap` above for the
                   policy and why it is one. On a pointer device `mouseenter`
                   has already set the same value, so this is a no-op there. */
                onClick={(e) => {
                  if (isBlockSelectionTap(e.nativeEvent)) setHoveredRow(row);
                }}
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
                  onBookmark={onBookmark}
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
                  dangerouslySetInnerHTML={proseHtml.get(block.id)?.out ?? { __html: block.html }}
                />
                {/* **After the prose, and outside it.** A PDF figure that could
                    not be recovered gets one muted line here, and every PDF
                    figure gets a way back to the page it was on. It is a sibling
                    of `.prose` rather than markup inside the block for the
                    reason `notes-head` above is a real element: `selection.ts`
                    roots comment offsets at `td.text .prose`, so a generated
                    sentence written into `block.html` would shift every anchor
                    in that block, silently. PdfFigureNote.tsx; GPT Sol, I-4. */}
                {figureNotes.has(block.id) && (
                  <PdfFigureNotes
                    notes={figureNotes.get(block.id) ?? []}
                    slug={slug}
                    canOpenSource={canOpenSource}
                  />
                )}
                {/* The quiz's questions on this block — `Props.quizAfter`. */}
                {quizAfter?.get(block.id)}
                {/* The open mode's door, after its block — `Props.afterBlock`. */}
                {afterBlock?.blockId === block.id && afterBlock.node}
                {/* Annotations' notes, right of the cell — `Props.margin`. */}
                {margin?.get(block.id)}
              </td>
          </tr>
        ))}
      </tbody>
    </table>
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
