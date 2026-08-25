/**
 * Arrow-key navigation, aimed by the pointer.
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
 * **The keys are ↑ / ↓, not ← / →** — Greg, same day: "let's switch to using
 * up/down instead of left/right". Left and right were the first try and were
 * the wrong axis: this view spends left-right on granularity, and moving
 * through the piece is a downward motion at every level
 * (granularity-zoom.md#the-tabular-view). Pointing sideways to say *how far* and
 * pressing downwards to say *go* now agree with what the screen shows. It also
 * hands ← / → back to the browser, which needs them to pan a table wider than
 * the window.
 *
 * The table is deliberately not the source of that aim. Every zone that means
 * a granularity level tags itself with `data-nav-depth`, and this file reads
 * whatever is under the pointer — so the spine, which is not part of the table
 * at all, joins in by adding one attribute. See NAV_DEPTH_ATTR below.
 *
 * Related: docs/project/keyboard.md (the intent and the trade-offs),
 * position.ts (the same "which item am I in" arithmetic, for `?at=`),
 * scroll.ts (the one way anything scrolls to a block).
 */
import { useEffect, useRef, useState } from "react";
import type { Block } from "../types.js";
import { activeSectionIndex } from "./position.js";
import { SCROLL_MS, scrollToBlock, stickyOffset } from "./scroll.js";
import type { Cell, Geometry } from "./tree.js";

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
const CHAIN_MS = SCROLL_MS + 400;

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

/* ------------------------------------------------------------------ DOM -- */

/** The row under the line we treat as "where you are reading". */
function measureRow(): number {
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
  geometry: Geometry,
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
  /** The row our own last jump was headed for. See CHAIN_MS. */
  const chain = useRef<number | null>(null);

  useEffect(() => {
    let timer = 0;

    const resolve = (el: Element | null | undefined): number => {
      const zone = el?.closest?.(`[${NAV_DEPTH_ATTR}]`);
      const d = Number(zone?.getAttribute(NAV_DEPTH_ATTR));
      // A depth with no column in the geometry has no items to step through,
      // so it is not an aim — fall back rather than swallow the keypress.
      return Number.isInteger(d) && geometry.cells[d] ? d : fallbackDepth;
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
      setAim(resolve(e.target as Element | null));
    };

    // The reader took the page back by hand, so our idea of where the last jump
    // was heading is worthless.
    const drop = () => {
      chain.current = null;
    };

    const onKey = (e: KeyboardEvent) => {
      if (!enabled) return;
      const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      if (dir === 0) return;
      // Cmd+↓ jumps to the end of the document, Alt+↓ and Shift+↓ have their own
      // meanings, and none of them is ours.
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // Auto-repeat is deliberately ignored: thirty smooth scrolls a second is
      // a blur you cannot read, and you would arrive somewhere you never saw.
      if (e.repeat) return;
      if (isTyping(e.target)) return;

      const p = pointer.current;
      const d = p ? resolve(document.elementFromPoint(p.x, p.y)) : aim.current;
      setAim(d);

      const starts = itemStarts(geometry.cells[d] ?? []);
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
    };
  }, [geometry, blocks, fallbackDepth, enabled]);

  return depth;
}
