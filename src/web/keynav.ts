/**
 * Arrow-key navigation: ↑ / ↓ step through the article, and the pointer picks
 * the level they step by.
 *
 * Greg, 2026-08-25:
 *
 * > As an experiment, I want to use left and right arrows, and what they do
 * > should depend on where my mouse is. If it's in the L2 column, say,
 * > left/right should jump to the prev/next L2 item, and so on.
 *
 * So the keys carry the *direction* and the pointer carries the *stride*. Over
 * the spine, ↓ is "next part"; anywhere else it is "next paragraph" — the
 * fallback was "next section", the unit `?at=` stores, until 2026-10-01, when
 * Greg asked for ↑ / ↓ to "always do the same thing" and the section stride
 * moved to ← / → in Structure (`acrossDepth` below). Left and right were the
 * step keys on the first try and were the wrong axis — moving through the piece
 * is a downward motion at every level — Greg, same day, "let's switch to using
 * up/down instead of left/right".
 *
 * **← / → chose the stride until 2026-09-29**, stepping the aim across the gist
 * columns. The columns went with the Hierarchy mode
 * (docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md), and so did
 * that. ← / → are now the browser's, except in a mode that claims them —
 * Skim and Quiz, whose stops and questions they step (`horizontal`
 * below), and Structure, whose sections they step (`acrossDepth`).
 *
 * The table is deliberately not the source of the pointer's aim. Every zone
 * that means a granularity level tags itself with `data-nav-depth`, and this
 * file reads whatever is under the pointer — so the spine, which is not part of
 * the table at all, joins in by adding one attribute. See NAV_DEPTH_ATTR below.
 *
 * **It also owns the DOM half of a jump** — `measureOrigin` and `beginJump`,
 * below — because a jump starts from the same measurement a keypress does, and
 * the two must not disagree about which item the reader is in. The half that is
 * pure, and the reason the split runs where it does, is jump-history.ts.
 *
 * Related: docs/project/keyboard.md (the intent and the trade-offs),
 * position.ts (the same "which item am I in" arithmetic, for `?at=`),
 * scroll.ts (the one way anything scrolls to a block),
 * jump-history.ts (what a jump leaves on the history entry it pushes).
 */
import { useEffect, useRef } from "react";
import type { Block, BlockId } from "../types.js";
import { armJump, clearArmedJump, type JumpOrigin } from "./jump-history.js";
import { activeSectionIndex } from "./position.js";
import { dropPendingFlash, flashBlock, type FlashTarget, type JumpAim } from "./flash.js";
import {
  SCROLL_MS,
  abandonScroll,
  arrivalAnchor,
  glideTarget,
  isPassageOnScreen,
  scrollToBlock,
  stickyOffset,
} from "./scroll.js";
import { navigableItems, type Cell, type Geometry } from "./tree.js";
/* Typing somewhere? Then the arrows are the caret's, not ours. One copy for
   every shortcut, in a leaf module the Dock can import too — key-chord.ts. */
import { isTyping } from "./key-chord.js";
import { isFolded } from "./fold.js";

/**
 * The attribute a zone wears to say "arrows here mean this level".
 *
 * Resolved with `closest()`, so it can sit on a container — the whole spine is
 * one L1 zone — or on individual cells, and anything untagged falls through to
 * whatever the ancestor says. Off the tagged zones entirely (the masthead, the
 * controls bar) the arrows fall back to the section depth, which is the same
 * unit `?at=` stores.
 */
const NAV_DEPTH_ATTR = "data-nav-depth";

/**
 * How long we keep believing our own last jump instead of measuring.
 *
 * Scrolling is animated, so a second press that lands mid-flight would measure
 * a position halfway between two items and step from *that* — two presses, one
 * item of movement. Chaining from the last target instead makes rapid presses
 * count exactly. Comfortably longer than the jump itself, short enough that a
 * press after any real pause measures the world afresh.
 */
export const CHAIN_MS = SCROLL_MS + 400;

/* ----------------------------------------------------------------- pure -- */

/**
 * The row each cell of a geometry column starts on.
 *
 * A column's cells tile the article — every cell carries the `rowSpan` the
 * table renders it with — so running the spans up gives the item boundaries
 * directly, with no second walk of the tree and no chance of disagreeing with
 * what is on screen. Same trick as buildSections in position.ts.
 */
export function itemStarts(cells: Cell[]): number[] {
  const starts: number[] = [];
  let row = 0;
  for (const cell of cells) {
    starts.push(row);
    row += cell.rowSpan;
  }
  return starts;
}

/**
 * Where a keypress lands: the row to scroll to, or null if there is nowhere to
 * go (the ends of the article).
 *
 * ↓ is always the next item. ↑ is not its mirror: part-way into an item it
 * goes to the *top of the item you are in*, and only steps back to the previous
 * one once you are already there. That is the track-skip rule from every music
 * player, and it is what makes the pair reversible — ↓ then ↑ puts you back
 * exactly where you were, because a ↓ always leaves you on an item's first row.
 * The mirror version would instead skip the start of the thing you are reading,
 * which is the one place you are most likely to want.
 */
export function stepTarget(
  starts: number[],
  currentRow: number,
  dir: -1 | 1,
): number | null {
  if (starts.length === 0) return null;
  // The last item that has already begun at or above this row — the same
  // arithmetic as the reading-position code, over rows rather than pixels.
  const i = activeSectionIndex(starts, currentRow);
  if (dir === 1) return starts[i + 1] ?? null;
  if (currentRow > starts[i]!) return starts[i]!;
  return starts[i - 1] ?? null;
}

/**
 * The row starts each level steps by — `starts[depth]`, for every level of the
 * tree, because the pointer can aim at any of them (the spine means L1).
 *
 * An object rather than the bare array so the hooks that take it can be handed
 * one memoised value; a fresh one every render would tear down and rebuild
 * every listener every render. (It carried a `ladder` of rungs for ← / → too,
 * until those went on 2026-09-29.)
 */
export interface NavPlan {
  /** starts[depth] → the row each item at that depth begins on. Sparse. */
  starts: number[][];
}

export function navPlan(geometry: Geometry): NavPlan {
  /* Through `navigableItems`, so ↓ steps over the whole of the apparatus in one
     press rather than forty times through unlabelled endnote leaves — and, more
     to the point, so the row the keys land on is the same row Structure calls
     current and the same row `?at=` stores. src/web/tree.ts § navigableItems
     for why fixing only the visible list is what breaks them apart. */
  const startsOf = (column: readonly Cell[]): number[] =>
    navigableItems(column, geometry.supplementOf).map((item) => item.startRow);
  return { starts: geometry.cells.map(startsOf) };
}

/* ------------------------------------------------------------------ DOM -- */

/**
 * The row under the line we treat as "where you are reading".
 *
 * Exported for DiagramPanel.tsx and TermJump.tsx, which step from the same
 * place by the same rule — nothing that steps may disagree about which item the
 * reader is in.
 */
export function measureRow(): number {
  /* A centred arrival sits below the reading line, and until the reader moves
     it is the item they are in (scroll.ts § `anchor`, plan 260929a). */
  const held = anchoredRow();
  if (held !== null) return held;
  const { tops, skip } = rowTops();
  /* **Row 0 when no row can answer**, which is this function's contract and
     what its callers assume (jump-history.ts and ReturnChip.tsx say so;
     DiagramPanel reads `measuredRow ?? atRow` and indexes TermJump's rows).
     `activeSectionIndex` returns -1 once it is handed a `skip` and finds no
     eligible row. Here that means no rows on the page: folding always leaves
     its heading rows visible. The -1 reached DiagramPanel as a real row, so
     its card described nothing. */
  return Math.max(0, activeSectionIndex(tops, readingLine(), skip));
}

/** The anchored arrival's index among the article's rows, or `null`. */
function anchoredRow(): number | null {
  const a = arrivalAnchor();
  if (a === null) return null;
  const rows = document.querySelectorAll<HTMLElement>("tbody tr[data-block]");
  for (let i = 0; i < rows.length; i++) if (rows[i]!.dataset.block === a.id) return i;
  return null;
}

/**
 * Every article row's distance from the top of the viewport, in order, and
 * which rows are folded away — `activeSectionIndex`'s `skip`, so a folded row
 * tying with the next visible one is never the row the reader is in (fold.ts).
 */
function rowTops(): { tops: number[]; skip: (i: number) => boolean } {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("tbody tr[data-block]"));
  return {
    tops: rows.map((r) => r.getBoundingClientRect().top),
    skip: (i) => isFolded(rows[i]?.dataset.block ?? ""),
  };
}

/**
 * The line a row has to cross to count as the one being read — the sticky
 * chrome's lower edge, and one pixel past it so that a row resting exactly on
 * the edge counts as arrived.
 */
function readingLine(): number {
  return stickyOffset() + 1;
}

/* --------------------------------------------------------------- a jump -- */

/**
 * **Where the reader is standing, right now, measured rather than read.**
 *
 * Not `?at=`, and that is the finding this whole stage turns on. `?at=` is a
 * deliberately lossy record of the reading position, in three ways that all
 * make it the wrong thing to stamp (GPT Sol F1, 2026-09-06):
 *
 *  - it is **absent at the top of the article** (position.ts § positionToWrite,
 *    `if (atTop) return { at: null }`);
 *  - after a fine-grained jump it **deliberately holds the old fine block**
 *    while the reader scrolls around inside that block's section, so it can
 *    name block 12 while the reader is at block 15;
 *  - a scroll write is **queued behind a 300ms debounce** (params.ts §
 *    atParam), and a jump's `throttle(0)` *cancels* that queued write rather
 *    than flushing it, so the value in the address can be older still.
 *
 * `measureRow()` above asks the layout instead, over every `tr[data-block]`
 * rather than only the section rows — the same measurement the arrow keys
 * already move by, so a jump and a keypress cannot disagree
 * about which item the reader is in. That is why this pair lives here rather
 * than in jump-history.ts, which router.ts imports and which therefore has to
 * stay clear of the reading view's layout code (see that file's header).
 *
 * ## "Am I at the top" is a layout question, not a scroll-offset one
 *
 * The first cut asked `window.scrollY <= stickyOffset()`, copying the test
 * `positionToWrite` uses (App.tsx). That is wrong here, and not narrowly: the
 * masthead and the controls scroll away *above* the first row, so there is a
 * band several hundred pixels deep in which the reader has scrolled past the
 * offset and yet no article row has reached the reading line. `measureRow()`
 * clamps to row 0 throughout it, so a jump made from anywhere in that band
 * recorded the first block, and Back then put that paragraph under the chrome
 * with the masthead gone — which is F8 again, inside the window F8's own fix
 * left open. GPT Sol F13, 2026-09-06.
 *
 * So the question is put to the rows: **has the first one crossed the line?**
 * That is the same fact `measureRow` reads one array later, so the two cannot
 * drift apart. `positionToWrite` still asks it the old way, and is left alone:
 * a lagging `?at=` in that band writes a block the reader can see, which is
 * what that parameter is for, while a *jump origin* is a promise to put them
 * back exactly.
 */
export function measureOrigin(blocks: Block[]): JumpOrigin {
  /* Standing on a centred arrival: that is where Back should return them, not
     the block above it whose top happens to cross the line (plan 260929a, Sol F1). */
  const a = arrivalAnchor();
  if (a !== null && blocks.some((b) => b.id === a.id)) return { kind: "block", blockId: a.id as BlockId };
  const { tops, skip } = rowTops();
  const first = tops[0];
  /* No rows at all — an empty article, or a mode not drawing the table — or
     every row still below the line. Either way no block is under the reader,
     and `top` is what lets Back restore the actual top of the page rather than
     scrolling the first paragraph under the chrome. */
  if (first === undefined || first > readingLine()) return { kind: "top" };
  const block = blocks[activeSectionIndex(tops, readingLine(), skip)];
  /* More rows drawn than blocks handed in. Not reachable today, and a wrong
     block is worse than an honest "the beginning". */
  return block === undefined ? { kind: "top" } : { kind: "block", blockId: block.id };
}

/**
 * **Start a jump: measure where the reader is, arm it, move them.**
 *
 * Returns whether anything happened, so the caller knows whether to record the
 * destination as the position it has already synced.
 *
 * `push` is the one address write, and it is the *destination* only —
 * `setAt(target, { history: "push", limitUrlUpdates: throttle(0) })` in
 * App.tsx, unchanged from before this stage. The predecessor's `?at=` is
 * rewritten by the wrapper that intercepts this very push, not by a second
 * setter here. **Two `setAt` calls in one tick would not be a transaction**:
 * nuqs stores pending updates in a `Map` keyed by parameter name, so the
 * second overwrites the first and the predecessor rewrite would simply never
 * happen, silently (nuqs/dist/debounce-*.js § ThrottledQueue.push). GPT Sol
 * F11, 2026-09-06.
 *
 * ## Why the whole jump is abandoned when you are already there
 *
 * A jump to the block you are standing on should not cost a press of Back. It
 * must also not cost a *scroll*: the history write and `scrollToBlock` used to
 * be independent statements, so suppressing only the push would leave the
 * movement — and a tall paragraph can be crossing the reading line while its
 * top is far above the viewport, so "the same block" and "no movement" are not
 * the same statement. Search deliberately calls `onJump` even when its result
 * is already on screen (App.tsx), which makes that reachable, and the reader
 * would be moved with no chip and no way back.
 *
 * **So clicking a search result for the paragraph you are already reading
 * moves nothing and pushes nothing — but it flashes.** Until 2026-09-28 it did
 * nothing at all, accepted on 2026-09-06 as the price of not making an
 * irreversible move; do not "fix" it by putting the scroll back, because that
 * reintroduces the move (making it reversible needs a finer origin than a
 * block id — a design, not a patch; GPT Sol F10). The flash answers "which one
 * is it" without moving anybody and without costing a Back. Any glide still in
 * flight is stopped first, so a block the page is being carried past does not
 * flash and then leave (Sol F1 on
 * docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md).
 *
 * ## The flash, on both branches
 *
 * The moved branch flashes when the scroll reports `settled` and not before —
 * a flash that finishes mid-glide is a flash nobody saw, and one whose glide
 * the reader's wheel cancelled would be in the wrong place (scroll.ts §
 * `ScrollOutcome`). Only this function flashes: stepping calls `scrollToBlock`
 * directly and stays quiet (flash.ts).
 *
 * `passage` narrows that flash for the one history-pushing jump whose
 * destination is finer than a block: a Skim row is a quote. Omitted by
 * every other caller, so their block wash is unchanged (plan 260928a § 7b).
 *
 * **`aim` is that passage key, or a `FlashTarget`** — the second for a citation
 * chip whose sentence quotes the article, whose `quotes` narrow the *paint* and
 * nothing else (flash.ts § `FlashTarget.quotes`; a reader's report,
 * spya-hzpf9b). Only the passage half reaches `alreadyThere` and
 * `scrollToBlock`: a quote names no drawn mark, and the scroll would treat it
 * as a passage still to arrive and go on re-measuring. So a quote jump scrolls
 * exactly as a bare block jump does, centred on the block.
 */
export function beginJump(
  blocks: Block[],
  target: BlockId,
  push: (id: BlockId) => void,
  aim?: JumpAim,
): boolean {
  const given: FlashTarget = typeof aim === "string" ? { passage: aim } : (aim ?? {});
  const passage = given.passage ?? undefined;
  const flash: FlashTarget = given.quotes === undefined ? { passage } : { passage, quotes: given.quotes };
  clearArmedJump();
  /* A held landing belongs to the last jump. Supersede it when the next jump
     begins, not only if that next scroll eventually settles: if the reader
     cancels the newer glide, exposing the prose must not resurrect the older
     destination. */
  dropPendingFlash();
  const origin = measureOrigin(blocks);
  if (alreadyThere(origin, target, passage)) {
    /* Only a glide in flight needs stopping; with none, `abandonScroll` would
       only drop the arrival anchor the reader is standing on (plan 260929a). */
    if (glideTarget() !== null) abandonScroll();
    flashBlock(target, flash);
    return false;
  }
  /* `from` is the whole address, not just the path: it is what lets the wrapper
     tell this jump's push from one made after the reader has been somewhere
     else and come back. jump-history.ts § `from`. */
  armJump({
    pathname: location.pathname,
    from: location.pathname + location.search,
    origin,
    target,
  });
  push(target);
  /* Centred, so the reader sees what surrounds it — Greg, SPIDERYARN-READING2-4M
     (scroll.ts § `ScrollAlign`). */
  scrollToBlock(
    target,
    "smooth",
    (outcome) => {
      if (outcome === "settled") flashBlock(target, flash);
    },
    { align: "centre", passage },
  );
  return true;
}

/**
 * **Is the reader already looking at what this jump is for?** Then it flashes
 * rather than moves (above). Passage-aware since plan 260929a (Sol F2): a jump
 * that names a quote is "there" only when that quote is — the anchor of the
 * last centred arrival names it exactly, or, with no anchor, its marks are in
 * view — because the block under the reading line can be a long paragraph
 * whose quote is a screen further down.
 */
function alreadyThere(origin: JumpOrigin, target: BlockId, passage: string | undefined): boolean {
  if (origin.kind !== "block" || origin.blockId !== target) return false;
  if (passage === undefined) return true;
  const a = arrivalAnchor();
  if (a !== null) return a.id === target && a.passage === passage;
  return isPassageOnScreen(target, passage);
}

/**
 * Wire up ↑ / ↓, aimed by the pointer, and ← / → for a mode that claims them.
 *
 * Nothing here touches the URL. It scrolls, and the reading-position listener
 * in App.tsx notices and writes `?at=` exactly as it does for a wheel — which
 * is also the answer to "does a keypress push a history entry?": no. A stride
 * you take twenty times must not cost twenty presses of Back
 * (docs/project/url-state.md#position-replaces-history-deliberate-acts-push).
 */
export function useArrowNav(
  /** The row starts — see navPlan. Memoise it. */
  plan: NavPlan,
  blocks: Block[],
  fallbackDepth: number,
  /**
   * Whether the keys are live. False while the bottom drawer is open (App.tsx):
   * the reader is looking at a panel, not at the article, and scrolling the
   * page underneath a dim they cannot see through loses them their place
   * without ever looking like it did anything.
   *
   * Only the *keys* go quiet. The pointer keeps aiming, so closing the drawer
   * resumes exactly where it left off rather than snapping back to the section.
   */
  enabled = true,
  /**
   * **← / → for a mode that has a sideways of its own** — Skim's stops
   * or Quiz's questions (docs/project/keyboard.md § ← / → in Skim and
   * § ← / → in Quiz). While it is given, ← / → go to it, after every
   * guard below has passed; it answers whether it took the key, and `false` —
   * the end of the route, which does not wrap — hands the key back to the
   * browser, the concession ↑ / ↓ make at the ends of the article. `null` or
   * absent is every other mode, where ← / → are the browser's.
   *
   * Read through a ref, so a handler that is a fresh closure every render does
   * not tear down and rebuild the listeners every render.
   */
  horizontal: ((dir: -1 | 1) => boolean) | null = null,
  /**
   * **← / → as a stride of their own** — the depth they step at, or `null`.
   * Structure passes the section depth, so ← / → move to the previous or next
   * lowest-level section (docs/project/keyboard.md § ← / → in Structure). The
   * step is ↑ / ↓'s own — the same `stepTarget`, the same chain — so ← in the
   * middle of a section goes to its start, exactly as ↑ does. A `horizontal`
   * handler, when one is given, wins; the two are never both set today, since
   * each belongs to one mode.
   */
  acrossDepth: number | null = null,
): void {
  const sideways = useRef(horizontal);
  sideways.current = horizontal;
  /** Last known pointer position, for a fresh hit-test at keypress time. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /**
   * The aimed depth. A ref, not state: nothing on screen shows the aim any
   * more (the tint over the aimed gist column went with the columns), so a
   * pointer crossing from the spine to the prose re-renders nothing.
   */
  const aim = useRef(fallbackDepth);
  /** The row our own last jump was headed for. See CHAIN_MS. */
  const chain = useRef<number | null>(null);

  useEffect(() => {
    let timer = 0;

    const resolve = (el: Element | null | undefined): number => {
      const zone = el?.closest?.(`[${NAV_DEPTH_ATTR}]`);
      const d = Number(zone?.getAttribute(NAV_DEPTH_ATTR));
      // A depth the plan has no rows for has nothing to step through, so it is
      // not an aim — fall back rather than swallow the keypress.
      return Number.isInteger(d) && plan.starts[d] ? d : fallbackDepth;
    };

    // `event.target` is the element under the pointer, handed to us for free —
    // no hit-test per mousemove. The keypress does its own elementFromPoint
    // because the page can scroll sideways under a pointer that never moved.
    const onMove = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      aim.current = resolve(e.target as Element | null);
    };

    // The reader took the page back by hand, so our idea of where the last jump
    // was heading is worthless.
    const drop = () => {
      chain.current = null;
    };

    /** Where the pointer is aiming right now. */
    const currentAim = (): number => {
      const p = pointer.current;
      // A fresh hit-test rather than the last mousemove's target: the page can
      // scroll sideways under a pointer that never moved.
      return p ? resolve(document.elementFromPoint(p.x, p.y)) : aim.current;
    };

    const onKey = (e: KeyboardEvent) => {
      if (!enabled) return;
      const across = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      const steps = e.key === "ArrowUp" || e.key === "ArrowDown";
      if (across === 0 && !steps) return;
      // Cmd+↓ jumps to the end of the document, Cmd+← is Back, Alt+↓ and
      // Shift+↓ have their own meanings, and none of them is ours.
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // Auto-repeat is deliberately ignored: thirty smooth scrolls a second is
      // a blur you cannot read, and you would arrive somewhere you never saw.
      if (e.repeat) return;
      if (isTyping(e.target)) return;
      /**
       * **Somebody nearer the keypress already dealt with it.**
       *
       * This listener is on `window`, in the bubble phase, so it sees every
       * arrow press in the app — including the ones a focused widget has
       * already handled. The diagram's picture is a `role="tree"` whose ↑ / ↓
       * step one node *and take the article with them*; without this guard the
       * same press then also ran the whole step below, and the reader got one
       * press moving them one node and one section at once — two distances,
       * one key, and neither of them wrong on its own.
       *
       * `defaultPrevented` rather than a list of elements to exclude, because
       * the list is the thing that goes stale: a widget that grows arrow-key
       * handling later has to remember to come back here, and nothing would
       * fail if it did not. Calling `preventDefault()` is already what a
       * handler does to say "this key was mine".
       */
      if (e.defaultPrevented) return;

      // ← / → belong to a mode that claims them, and otherwise to the browser.
      // See `horizontal` above.
      if (across !== 0) {
        /* **Not from inside a dialog.** A comment's dialog focuses its Close
           button and has ‹ › of its own, and a key pressed there is not a
           request to step the band behind it. Scoped to where the key was
           pressed rather than to "a dialog is open": the comment dialog is
           modeless, and a reader who clicks back into the page means the page.
           GPT Sol's review of plan 260930h, finding 1. */
        if ((e.target as Element | null)?.closest?.('dialog, [role="dialog"]')) return;
        const mine = sideways.current;
        if (mine) {
          if (mine(across)) e.preventDefault();
          return;
        }
        if (acrossDepth !== null && plan.starts[acrossDepth]) step(acrossDepth, across, e);
        return;
      }

      const d = currentAim();
      aim.current = d;
      step(d, e.key === "ArrowUp" ? -1 : 1, e);
    };

    /** One step at depth `d`, chained from our own last target. */
    const step = (d: number, dir: -1 | 1, e: KeyboardEvent) => {
      /* **Over a folded section, never into it.** `scrollToBlock` unfolds
         whatever it is sent to, so a folded row left in the list would make ↓
         open every section it met (fold.ts). Filtered here, at the press,
         because folding changes nothing the plan is memoised on. */
      const starts = (plan.starts[d] ?? []).filter((row) => {
        const id = blocks[row]?.id;
        return id === undefined || !isFolded(id);
      });
      const target = stepTarget(starts, chain.current ?? measureRow(), dir);
      const block = target === null ? undefined : blocks[target];
      // No preventDefault when we do nothing: at the ends of the article the
      // keypress goes back to the browser, so ↓ on the last paragraph still
      // scrolls the last screenful into view instead of dying silently.
      if (!block) return;
      e.preventDefault();

      chain.current = target;
      window.clearTimeout(timer);
      timer = window.setTimeout(drop, CHAIN_MS);
      scrollToBlock(block.id);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", drop, { passive: true });
    window.addEventListener("pointerdown", drop, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", drop);
      window.removeEventListener("pointerdown", drop);
      window.clearTimeout(timer);
      /* The timer that would have dropped the chain is gone, so drop it now:
         otherwise a mode change mid-chain (which changes `acrossDepth`) leaves
         a stale target that nothing ever expires. GPT Sol's plan review, 261001q. */
      drop();
    };
  }, [plan, blocks, fallbackDepth, enabled, acrossDepth]);
}
