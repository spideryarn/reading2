/**
 * **The flash on arrival**: the prose of the block a reader just jumped to
 * washes warm for about a second, so "which one is it" is answered on the page.
 *
 * Called from `beginJump` (keynav.ts), which every history-pushing jump passes
 * through — block links, search hits, the glossary's select, a diagram node, a
 * gist cell. Not from stepping (arrows, swipe, ‹ ›, comment Prev/Next), Back,
 * the return chip or arrival from a pasted link: stepping moves one item at a
 * time and a flash on every step is noise, and the others return the reader to
 * a place they chose to leave. The plan's Sol F7,
 * docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md.
 *
 * **The named exception is Skim** (src/web/modes/skim/SkimMode.tsx),
 * which flashes on every step — ‹ ›, ← →, the door, going round again — and on
 * a `?stop=` deep link. The rule above is about stepping to the *adjacent*
 * item; a Skim route is out of paper order, so each step lands anywhere
 * in the article and is a jump in all but name. Greg asked for a flash on
 * every step, 2026-09-28 — docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § 5a. It flashes the same way `beginJump` does, when the scroll settles.
 *
 * **What flashes is the verbatim cell**, `td.text`, never the gist columns: the
 * question is which paragraph, and the gist column already marks the current
 * row its own way. With the prose column off (`?text=0`) there is nothing to
 * flash and nothing is kept for later. **Skim narrows it to the quote's
 * own words** (`FlashTarget.passage`, plan 260928a § 7b), because its stop is
 * a quote rather than a paragraph; every other caller washes the cell.
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
import { blockRow, passageMarks } from "./rows.js";
import { reducedMotion } from "./scroll.js";

/** "A second or so" — Greg, 2026-09-28. The CSS animation runs the same length (tokens.css § --flash-ms). */
export const FLASH_MS = 1200;
/**
 * **A cited work's words wash for twice as long, and stronger** — on a few
 * words the paragraph's second was "a little bit too subtle and quick"
 * (Greg, SPIDERYARN-READING2-7X, plan 261001m). tokens.css § --cite-flash-ms.
 */
export const CITE_FLASH_MS = 2400;

/** The animated wash, and the still one reduced motion gets instead — on a cell. */
const MOVING = "block-flash";
const STILL = "block-flash-still";
/** The same pair on a passage's own `mark.hit` fragments (prose.css § the flash). */
const PASSAGE_MOVING = "passage-flash";
const PASSAGE_STILL = "passage-flash-still";
/** The same pair on any other element — a Metadata section (`flashElement`). */
const ELEMENT_MOVING = "element-flash";
const ELEMENT_STILL = "element-flash-still";
const ALL = [MOVING, STILL, PASSAGE_MOVING, PASSAGE_STILL, ELEMENT_MOVING, ELEMENT_STILL];

/**
 * **What to wash inside the block.** Omitted, the whole prose cell — every
 * caller but one. `passage` is a Found key (search-hits.ts § `Found.key`), the
 * id annotate.ts writes into each `mark.hit`'s `data-hit`: Skim passes
 * its stop's quote so the flash lands on the words it is taking you to, not
 * the paragraph around them (Greg, 2026-09-28; plan 260928a § 7b). A passage
 * that is not drawn — the quote not marked yet, or its text no longer found —
 * falls back to the cell, so a flash is never lost to a missing mark.
 */
export interface FlashTarget {
  passage?: string | null | undefined;
}

/** What is washing now, and the timer that will take the wash off. */
let live: { els: HTMLElement[]; timer: ReturnType<typeof setTimeout> } | null = null;
/** A flash waiting for the prose to be exposed. */
let pending: { id: BlockId; target: FlashTarget } | null = null;

/** A band is open and lying over the prose, not stepped aside. */
function proseCovered(): boolean {
  return document.querySelector(".reader.band-covers:not(.band-away) .mode-band") !== null;
}

function stop(): void {
  if (!live) return;
  clearTimeout(live.timer);
  for (const el of live.els) el.classList.remove(...ALL);
  live = null;
}

/**
 * Put `cls` on `els` for `ms`, ending whatever was washing before.
 * **Restartable**: take the class off, make the browser notice, put it back.
 * Without the reflow the removal and the re-add land in one style pass and the
 * animation does not start again, so a second click on the same link would look
 * like nothing happened.
 */
function wash(els: HTMLElement[], cls: string, ms: number): void {
  stop();
  for (const el of els) el.classList.remove(...ALL);
  void els[0]?.offsetWidth;
  for (const el of els) el.classList.add(cls);
  live = { els, timer: setTimeout(stop, ms) };
}

export function flashBlock(id: BlockId, target: FlashTarget = {}): void {
  pending = null;
  const cell = blockRow(id)?.querySelector<HTMLElement>("td.text") ?? null;
  if (!cell) return;
  if (proseCovered()) {
    pending = { id, target };
    return;
  }
  const marks = target.passage ? passageMarks(cell, target.passage) : [];
  const els = marks.length > 0 ? marks : [cell];
  const still = reducedMotion();
  const cls = marks.length > 0 ? (still ? PASSAGE_STILL : PASSAGE_MOVING) : still ? STILL : MOVING;
  const cited = marks.length > 0 && marks.every((m) => m.matches("mark.cite"));
  wash(els, cls, cited ? CITE_FLASH_MS : FLASH_MS);
}

/**
 * **The same flash on an element that is not a block** — a Metadata section
 * its contents list or search box just took the reader to (PageContents.tsx;
 * Greg, SPIDERYARN-READING2-7Y: *"expand that section (if needed) and flash to
 * show where it is in the page"*). The block flash's colour, length and
 * reduced-motion rule; none of its block machinery, because there is no band
 * to hide behind and no passage to narrow to. prose.css § the flash on arrival.
 */
export function flashElement(el: HTMLElement): void {
  wash([el], reducedMotion() ? ELEMENT_STILL : ELEMENT_MOVING, FLASH_MS);
}

/** The prose is exposed again: fire whatever was held for it. */
export function flushPendingFlash(): void {
  if (pending === null) return;
  const { id, target } = pending;
  pending = null;
  flashBlock(id, target);
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
