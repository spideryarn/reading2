/**
 * **The flash on arrival**: the prose of the block a reader just jumped to
 * washes warm for about a second, so "which one is it" is answered on the page.
 *
 * Called from one place, `beginJump` (keynav.ts), which every history-pushing
 * jump passes through — block links, search hits, the glossary's select, a
 * diagram node, a gist cell. Not from stepping (arrows, swipe, ‹ ›, comment
 * Prev/Next), Back, the return chip or arrival from a pasted link: stepping
 * moves one item at a time and a flash on every step is noise, and the others
 * return the reader to a place they chose to leave. The plan's Sol F7,
 * docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md.
 *
 * **What flashes is the verbatim cell**, `td.text`, never the gist columns: the
 * question is which paragraph, and the gist column already marks the current
 * row its own way. With the prose column off (`?text=0`) there is nothing to
 * flash and nothing is kept for later.
 *
 * **A flash nobody can see is held, not spent.** On a narrow window a mode's
 * band lies over the whole article (`.reader.band-covers`), so a flash fired
 * there would finish behind it. It is held instead and `flushPendingFlash` fires
 * it when the prose is exposed — Reader calls that when the band closes or
 * steps aside — so leaving the mode shows you where you landed. A newer jump
 * replaces a held one. Sol F2.
 *
 * Module state rather than React state because the cell is a DOM node the
 * memoised table owns, and re-rendering 2,000 rows to toggle one class would
 * be the wrong trade.
 */
import type { BlockId } from "../types.js";
import { blockRow } from "./rows.js";
import { reducedMotion } from "./scroll.js";

/** "A second or so" — Greg, 2026-09-28. The CSS animation runs the same length. */
export const FLASH_MS = 1200;

/** The animated wash, and the still one reduced motion gets instead. */
const MOVING = "block-flash";
const STILL = "block-flash-still";

/** The cell washing now, and the timer that will take the wash off it. */
let live: { cell: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;
/** A flash waiting for the prose to be exposed. */
let pending: BlockId | null = null;

/** A band is open and lying over the prose, not stepped aside. */
function proseCovered(): boolean {
  return document.querySelector(".reader.band-covers:not(.band-away) .mode-band") !== null;
}

function stop(): void {
  if (!live) return;
  clearTimeout(live.timer);
  live.cell.classList.remove(MOVING, STILL);
  live = null;
}

export function flashBlock(id: BlockId): void {
  pending = null;
  const cell = blockRow(id)?.querySelector<HTMLElement>("td.text") ?? null;
  if (!cell) return;
  if (proseCovered()) {
    pending = id;
    return;
  }
  stop();
  /* **Restartable**: take the class off, make the browser notice, put it back.
     Without the reflow the removal and the re-add land in one style pass and
     the animation does not start again, so a second click on the same link
     would look like nothing happened. */
  cell.classList.remove(MOVING, STILL);
  void cell.offsetWidth;
  cell.classList.add(reducedMotion() ? STILL : MOVING);
  live = { cell, timer: setTimeout(stop, FLASH_MS) };
}

/** The prose is exposed again: fire whatever was held for it. */
export function flushPendingFlash(): void {
  if (pending === null) return;
  const id = pending;
  pending = null;
  flashBlock(id);
}

/** A newer jump has begun: forget the older landing held behind the band. */
export function dropPendingFlash(): void {
  pending = null;
}

/** The reading view is leaving: forget held work and cancel the live timer. */
export function resetFlash(): void {
  pending = null;
  stop();
}
