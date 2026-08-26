/**
 * Arrow-key navigation: ↑ / ↓ step through the article, ← / → pick the level
 * they step by, and the pointer picks it too.
 *
 * Greg, 2026-08-25:
 *
 * > As an experiment, I want to use left and right arrows, and what they do
 * > should depend on where my mouse is. If it's in the L2 column, say,
 * > left/right should jump to the prev/next L2 item, and so on.
 *
 * So the keys carry the *direction* and the pointer carries the *stride*. Over
 * the Sections column, ↓ is "next section"; slide the mouse right onto the
 * prose and the same key becomes "next paragraph"; onto the spine and it
 * becomes "next part". One pair of keys addresses every level the view is
 * already showing, without a modal state to get stuck in — the aim is wherever
 * you happen to be pointing, and you can see it before you press anything
 * (App.tsx puts the level in the controls bar, TableView lights the header).
 *
 * **↑ / ↓ take the step, ← / → choose the stride.** Left and right were the
 * step keys on the first try and were the wrong axis: this view spends
 * left-right on granularity, and moving through the piece is a downward motion
 * at every level (granularity-zoom.md#the-tabular-view) — Greg, same day,
 * "let's switch to using up/down instead of left/right". Which left the
 * sideways axis free for the sideways meaning it already had on screen, and
 * that is what ← / → now do, Greg 2026-08-26:
 *
 * > Let's use left/right to move the ToC-column-selection, so that I can choose
 * > the level of granularity with keyboard when jumping up/down.
 *
 * So the aim has two ways in and they are not two modes. The pointer aims
 * whenever it moves; ← / → aim when the mouse is not moving, and the next
 * mousemove hands it straight back. Both ends of the ladder are reachable —
 * Greg, 2026-08-26: "I need to be able to hit left all the way to be able to
 * select L0 (the Argument), and to be able to hit right all the way to select
 * the Text" — which is why the arc column is a rung of its own rather than an
 * alias for Parts, and why the prose and the leaf column beside it share one.
 * See navPlan. Off the ends the keys go back to the browser, which uses them to
 * pan a table wider than the window.
 *
 * The table is deliberately not the source of the pointer's aim. Every zone
 * that means a granularity level tags itself with `data-nav-depth`, and this
 * file reads whatever is under the pointer — so the spine, which is not part of
 * the table at all, joins in by adding one attribute. See NAV_DEPTH_ATTR below.
 *
 * Related: docs/project/keyboard.md (the intent and the trade-offs),
 * position.ts (the same "which item am I in" arithmetic, for `?at=`),
 * scroll.ts (the one way anything scrolls to a block).
 */
import { useEffect, useRef, useState } from "react";
import type { Block } from "../types.js";
import { activeSectionIndex } from "./position.js";
import { SCROLL_MS, scrollToBlock, stickyOffset } from "./scroll.js";
import type { Cell } from "./tree.js";

/**
 * The attribute a zone wears to say "arrows here mean this level".
 *
 * Resolved with `closest()`, so it can sit on a container — the whole spine is
 * one L1 zone — or on individual cells, and anything untagged falls through to
 * whatever the ancestor says. Off the tagged zones entirely (the masthead, the
 * controls bar) the arrows fall back to the section depth, which is the same
 * unit `?at=` stores.
 */
export const NAV_DEPTH_ATTR = "data-nav-depth";

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
 * The rungs ← / → step between, and the row starts each level steps by.
 *
 * One object rather than two lookups because the two have to agree: a rung the
 * arrows can select but cannot step through is a key that does nothing, and a
 * level with rows but no rung is a stride only the mouse can reach.
 *
 * **The ladder is the columns actually on screen**, not every level in the
 * tree. A stride whose column auto-fit has dropped would light no header and
 * change nothing visible, which is indistinguishable from a broken key.
 *
 * **`starts` is every level**, on screen or not, because the pointer can aim at
 * one the ladder does not carry — the spine means L1 whether or not the Parts
 * column survived the fit.
 *
 * The one substitution is the arc. When stage 5b has run, the L0 column draws
 * one cell per part rather than one cell for the article
 * (tree.ts § the arc), so L0 steps by part — the same stride as Parts, which is
 * exactly what "left all the way" is asking for: the argument's own column, not
 * a rung that dead-ends because the root is a single cell. Without the arc that
 * is what L0 is, and it is left off the ladder for having nowhere to go.
 */
export interface NavPlan {
  /** The rungs ← / → step between, coarsest first. */
  ladder: number[];
  /** starts[depth] → the row each item at that depth begins on. Sparse. */
  starts: number[][];
}

export function navPlan(
  cells: Cell[][],
  columns: number[],
  leafDepth: number,
  showText: boolean,
  hasArc: boolean,
): NavPlan {
  // The arc's cells are the parts' cells, by construction — so borrow the row
  // starts rather than recomputing them, and the two columns cannot drift.
  const starts: number[][] = cells.map((column, d) =>
    itemStarts(d === 0 && hasArc ? (cells[1] ?? column) : column),
  );
  const visible = new Set(columns);
  // The prose column is the finest granularity there is, and it means the same
  // stride as the leaf column beside it: one paragraph. Same rung, not a second.
  if (showText) visible.add(leafDepth);
  const ladder = [...visible]
    .filter((d) => (starts[d]?.length ?? 0) > 1)
    .sort((a, b) => a - b);
  return { ladder, starts };
}

/**
 * Where ← / → move the aim, or null if there is no rung that way.
 *
 * `current` need not be on the ladder — the pointer can aim at the spine (L1)
 * while the Parts column is hidden — so an absent one is treated as sitting
 * *between* rungs and the key moves to the neighbour on that side. Null at the
 * ends rather than wrapping: the same choice ↑ / ↓ make, and for the same
 * reason — a stride you can run off the end of is one you can feel the shape
 * of, and wrapping from Paragraphs to the argument is a jump nobody asked for.
 */
export function nextAim(
  ladder: number[],
  current: number,
  dir: -1 | 1,
): number | null {
  if (ladder.length === 0) return null;
  const at = ladder.indexOf(current);
  // Not on the ladder: `below` is how many rungs are coarser than the aim, so
  // it is also the index of the first finer one — which is where → goes, and
  // one before it is where ← goes.
  const below = ladder.filter((d) => d < current).length;
  const i = at === -1 ? (dir === 1 ? below : below - 1) : at + dir;
  return ladder[i] ?? null;
}

/* ------------------------------------------------------------------ DOM -- */

/**
 * The row under the line we treat as "where you are reading".
 *
 * Exported for swipe.ts, which steps from the same place by the same rule — a
 * finger and a key must not disagree about which item the reader is in.
 */
export function measureRow(): number {
  const rows = document.querySelectorAll<HTMLElement>("tbody tr[data-block]");
  const tops = Array.from(rows, (r) => r.getBoundingClientRect().top);
  return activeSectionIndex(tops, stickyOffset() + 1);
}

/** Typing somewhere? Then the arrows are the caret's, not ours. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable === true
  );
}

/**
 * Wire up ↑ / ↓ and report the depth they are currently aimed at, so the view
 * can say so.
 *
 * Nothing here touches the URL. It scrolls, and the reading-position listener
 * in App.tsx notices and writes `?at=` exactly as it does for a wheel — which
 * is also the answer to "does a keypress push a history entry?": no. A stride
 * you take twenty times must not cost twenty presses of Back
 * (docs/project/url-state.md#position-replaces-history-deliberate-acts-push).
 */
export function useArrowNav(
  /**
   * The ladder and the row starts — see navPlan. Memoise it: a fresh object
   * every render would tear down and rebuild every listener every render.
   */
  plan: NavPlan,
  blocks: Block[],
  fallbackDepth: number,
  /**
   * Whether the keys are live. False while the bottom drawer is open (App.tsx):
   * the reader is looking at a panel, not at the article, and scrolling the
   * page underneath a dim they cannot see through loses them their place
   * without ever looking like it did anything.
   *
   * Only the *keys* go quiet. The pointer keeps aiming, so the controls bar
   * still says which level ↑/↓ would step by, and closing the drawer resumes
   * exactly where it left off rather than snapping back to the section.
   */
  enabled = true,
): number {
  const [depth, setDepth] = useState(fallbackDepth);
  /** Last known pointer position, for a fresh hit-test at keypress time. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** The aimed depth, mirrored out of state so the key handler can't go stale. */
  const aim = useRef(fallbackDepth);
  /**
   * The depth ← / → last chose, or null while the pointer is in charge.
   *
   * This is the piece of state the pointer-aimed design was built to avoid, so
   * it is deliberately the weakest kind: the very next mousemove drops it. You
   * can hold a level without holding the mouse still, and you take it back by
   * doing the thing you would have done anyway.
   */
  const locked = useRef<number | null>(null);
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

    const setAim = (d: number) => {
      if (d === aim.current) return;
      aim.current = d;
      setDepth(d);
    };

    // `event.target` is the element under the pointer, handed to us for free —
    // no hit-test per mousemove. The keypress does its own elementFromPoint
    // because the page can scroll sideways under a pointer that never moved.
    const onMove = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      // Moving the mouse is how you take the aim back off the keyboard. No
      // threshold and no timeout: the reader's hand is the only thing that
      // decides, and a lock that expired on its own would change what ↓ means
      // while they were looking at the page rather than at the pointer.
      locked.current = null;
      setAim(resolve(e.target as Element | null));
    };

    // The reader took the page back by hand, so our idea of where the last jump
    // was heading is worthless.
    const drop = () => {
      chain.current = null;
    };

    /** Where the aim is right now: the keyboard's choice, else the pointer's. */
    const currentAim = (): number => {
      // The lock is dropped rather than clamped when its rung goes away — a
      // resize that drops the Sections column should hand the aim back to the
      // pointer, not silently move it to a level nobody chose.
      if (locked.current !== null && plan.ladder.includes(locked.current)) {
        return locked.current;
      }
      locked.current = null;
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
      // ← / → hold the line for a different reason — the ladder is three or four
      // rungs long, so a held key would arrive at the end before you saw it move.
      if (e.repeat) return;
      if (isTyping(e.target)) return;

      // ← / → change the stride rather than taking one: they move the aim
      // across the columns, which is what the pointer does when you slide it
      // sideways (docs/project/keyboard.md § choosing the level without a mouse).
      if (across !== 0) {
        const next = nextAim(plan.ladder, currentAim(), across);
        // Off the end of the ladder we hand the key back, so ← / → still pan a
        // table wider than the window once there is no column left that way.
        if (next === null) return;
        e.preventDefault();
        locked.current = next;
        setAim(next);
        return;
      }

      const dir = e.key === "ArrowUp" ? -1 : 1;
      const d = currentAim();
      setAim(d);

      const target = stepTarget(
        plan.starts[d] ?? [],
        chain.current ?? measureRow(),
        dir,
      );
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
    };
  }, [plan, blocks, fallbackDepth, enabled]);

  return depth;
}
