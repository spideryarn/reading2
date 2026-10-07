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
 * **What flashes is the verbatim cell**, `td.text`: the question is which
 * paragraph. (It was never the gist columns, which marked the current row
 * their own way until they went on 2026-09-29; `?text=0`, which turned the
 * prose column off, went with them.) **Skim narrows it to the quote's
 * own words** (`FlashTarget.passage`, plan 260928a § 7b), because its stop is
 * a quote rather than a paragraph. **A citation chip whose sentence quotes the
 * article narrows it too**, by another route: it has words but no mark, so the
 * words are found at the flash and painted as `Range`s (`FlashTarget.quotes`;
 * a reader's report, spya-hzpf9b). Every other caller washes the cell.
 *
 * **A flash nobody can see is held, not spent.** On a narrow window a mode's
 * band lies over the whole article (`.reader.band-covers`), so a flash fired
 * there would finish behind it. It is held instead and `flushPendingFlash` fires
 * it when the prose is exposed — Reader calls that when the band closes or
 * steps aside — so leaving the mode shows you where you landed. A newer jump
 * replaces a held one. Sol F2. Skim's ‹ › on a phone is the long-lived case
 * since 2026-10-03 (spya-kudr63): the band stays up for the whole walk, each
 * step drops the last held flash, and one that outlives a switch to another
 * covering band is dropped by Reader rather than played under it.
 *
 * Module state rather than React state because the cell is a DOM node the
 * memoised table owns, and re-rendering 2,000 rows to toggle one class would
 * be the wrong trade.
 */
import { findQuote } from "../quote-match.js";
import { RESERVED_ATTRS } from "../reserved.js";
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
  /**
   * **Words to find in the block and paint, where there is no mark to wash** —
   * the quotations in a citation chip's own sentence of a model's answer
   * (Cited.tsx § `cited`). A reader's report, spya-hzpf9b: the chip after *"an
   * intelligent data pattern"* washed a 250-word paragraph, and the sentence
   * could not be found in it. Plan
   * docs/plans/261003i-tutorial-leans-to-retention-a-softer-blurb-quote-links-that-show-the-quote.md.
   *
   * **Every one that is in the block is painted, and the rest are ignored.**
   * The sender is deliberately generous about which quotations belong to a
   * chip (citations.ts § `quotesBefore`), and this is why it can be: a
   * quotation that is not this block's words finds nothing here, so it can
   * never put a highlight on the wrong ones. None found, or a browser with no
   * highlight API, washes the cell as before.
   *
   * Not a `passage`, and it must not be sent as one: a passage is a key naming
   * marks annotate.ts has drawn, and `scrollToBlock` treats a key that resolves
   * to nothing as provisional and goes on re-measuring (scroll.ts § `aimAt`).
   * Nothing draws a mark for these words — they are located at the moment of
   * the flash and painted as `Range`s (`paintQuotes`, below).
   */
  quotes?: readonly string[] | undefined;
}

/**
 * **What a jump may say about where it lands, beyond the block**: a bare string
 * is a passage key, which is what every caller passed before `quote` existed
 * and what Skim and Citations still pass. keynav.ts § `beginJump` takes it
 * apart.
 */
export type JumpAim = string | FlashTarget;

/**
 * The one named highlight quotes are painted under (prose.css §
 * `::highlight(quote-flash)`). One name and one live flash, holding every
 * Range of it, so registering a new one replaces the old and there is never a
 * second to clear.
 */
export const QUOTE_HIGHLIGHT = "quote-flash";

/**
 * What is washing now, and the timer that will take the wash off. `quote` says
 * the wash is a registered highlight rather than a class on `els`.
 */
let live: { els: HTMLElement[]; quote: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
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
  if (live.quote) highlights()?.delete(QUOTE_HIGHLIGHT);
  live = null;
}

/**
 * The CSS Custom Highlight API's registry, or `null` where there is none —
 * jsdom, and Firefox before 140. Asked for at each use rather than once at
 * import, so a missing API is simply the old behaviour and never a throw.
 */
function highlights(): HighlightRegistry | null {
  if (typeof CSS === "undefined" || typeof Highlight !== "function") return null;
  return (CSS as { highlights?: HighlightRegistry }).highlights ?? null;
}

/**
 * Footnote controls: a marker in the prose, and a note's back-link. Stamped by
 * stage 2 and by nobody else (src/notes.ts), which is why they can be told
 * apart from the article's own characters.
 */
const NOTE_CONTROL = `[${RESERVED_ATTRS.noteRef}], [${RESERVED_ATTRS.noteBack}]`;

/**
 * **Where each of `quotes` is in the cell, as `Range`s** — one for every quote
 * that is there, none for one that is not.
 *
 * The cell's text is rebuilt here one text node at a time, with each node's
 * offset kept, because the answer has to be pairs of (node, offset) points and
 * `textContent` cannot be mapped back to them. `findQuote` does the matching —
 * forgiving of case, whitespace and curly quotes, the same rule every other
 * quote on the page is found by (src/quote-match.ts).
 *
 * **Footnote markers are left out of the text that is searched.** An article
 * prints them inside phrases: the DOM reads `Self2 as a process` where the
 * author wrote, and the model quotes, `Self as a process`. They are skipped by
 * **node** — the stamp stage 2 put on the marker — never by a digit pattern,
 * which would take the 2 out of `CO2` (src/blocks.ts § the same rule, for the
 * same reason). Because the offsets are into the nodes that were kept, the
 * Range still starts and ends in the right places and simply runs across the
 * marker.
 */
function quoteRanges(cell: HTMLElement, quotes: readonly string[]): Range[] {
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if (n.parentElement?.closest(NOTE_CONTROL)) continue;
    const node = n as Text;
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  /* The last node that begins before `offset` (`strictly`), or at or before
     it. The start of a span belongs to the node it is inside; the end, being
     exclusive, to the node it finishes in — so a quote ending exactly at a
     node boundary ends in that node rather than at offset 0 of the next. */
  const nodeAt = (offset: number, strictly: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n && (strictly ? n.start < offset : n.start <= offset)) return n;
    }
    return null;
  };
  const ranges: Range[] = [];
  for (const quote of quotes) {
    const span = findQuote(text, quote);
    if (span === null || span.end <= span.start) continue;
    const first = nodeAt(span.start, false);
    const last = nodeAt(span.end, true);
    if (!first || !last) continue;
    const range = document.createRange();
    range.setStart(first.node, span.start - first.start);
    range.setEnd(last.node, span.end - last.start);
    ranges.push(range);
  }
  return ranges;
}

/**
 * **Paint `quotes` inside the cell for `CITE_FLASH_MS`**, ending whatever was
 * washing before; `false` if none of them could be, and then the caller washes
 * the cell.
 *
 * Registered `Range`s rather than `<mark>`s, because the prose's marks are
 * annotate.ts's and are rebuilt from `Found`s on every change — a mark written
 * here would be one nothing else knows about, in the html every offset on the
 * page is measured against. A highlight touches no DOM at all.
 *
 * **It does not animate**: `::highlight()` takes colours and nothing else, so
 * the paint is a steady tint that goes when the timer does. That makes reduced
 * motion and ordinary motion the same thing here. It holds for the cited-words
 * length, not the paragraph's, for the reason that length exists — a few words
 * are a small patch (SPIDERYARN-READING2-7X).
 *
 * If the prose is re-rendered underneath it the Ranges collapse and the paint
 * goes early. Nothing is left behind, and the timer still clears the registry.
 */
function paintQuotes(cell: HTMLElement, quotes: readonly string[]): boolean {
  const registry = highlights();
  if (registry === null) return false;
  const ranges = quoteRanges(cell, quotes);
  if (ranges.length === 0) return false;
  stop();
  registry.set(QUOTE_HIGHLIGHT, new Highlight(...ranges));
  live = { els: [], quote: true, timer: setTimeout(stop, CITE_FLASH_MS) };
  return true;
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
  live = { els, quote: false, timer: setTimeout(stop, ms) };
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
  /* Drawn marks win: they are the passage as the page already shows it.
     Quotes are for the jump that has none. */
  if (marks.length === 0 && target.quotes?.length && paintQuotes(cell, target.quotes)) return;
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

/**
 * **Flash when the scroll has stopped, not when it starts.** The wash holds for
 * about a third of `FLASH_MS` and then fades; fired at the click, a smooth
 * scroll across a long page would spend the hold travelling and land on the
 * fade. There is no settle callback for `scrollIntoView`, and `scrollend` is
 * not everywhere yet, so: wait until no scroll event has arrived for
 * `SCROLL_IDLE_MS`. A section already in place never scrolls, and flashes after
 * that one short wait. `SCROLL_MAX_MS` is the ceiling, for a scroll that keeps
 * being nudged (an image loading above it, say).
 */
const SCROLL_IDLE_MS = 120;
const SCROLL_MAX_MS = 1500;

/**
 * **How long a layout change may still move the page back onto the section.**
 * Measured on a cold load of `/help#mode-skim` (4x CPU throttle, no cache):
 * the scroll was asked for while the web fonts were still loading, they landed
 * about half a second later and the text above the heading reflowed 960px
 * shorter — but Chrome's smooth scroll keeps the target it computed at the
 * start, so it went on to the old one and left the heading 880px above the
 * window. Two seconds covers that with room; the reader's own input ends it
 * sooner.
 */
const SETTLE_MS = 2000;
/** Input that means the reader is moving the page themselves. */
const READER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * **Scroll `el` to the top of the window, then `flashElement` it once the
 * scroll has settled** — see the constants above for why it waits. Smooth
 * unless the reader asked for reduced motion. Returns a cancel, for a caller
 * that is about to scroll somewhere else or unmount.
 *
 * **It stays on `el` while the page settles** (`SETTLE_MS`, `keepAligned`): a
 * web font landing or the page changing size asks for the same scroll again,
 * in the same manner, which retargets one still in flight. The reader's first
 * wheel, key, touch or press ends that at once — never fight the reader. It is
 * here rather than in the Help page because Metadata's sections are exposed to
 * the same thing (an aside or a font arriving above the section), and asking
 * again when nothing moved scrolls nowhere. The flash still fires once.
 *
 * Two callers: Metadata's contents list and search box (PageContents.tsx §
 * reveal, which moved this here), and the Help page's arrival at a fragment
 * (help/HelpPage.tsx § Arriving, a question on the questions' page).
 */
export function scrollToAndFlash(el: HTMLElement): () => void {
  let finished = false;
  let idle = setTimeout(done, SCROLL_IDLE_MS);
  const cap = setTimeout(done, SCROLL_MAX_MS);
  window.addEventListener("scroll", onScroll, { passive: true });
  const behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth";
  /* Optional-called: jsdom has none. */
  const align = () => el.scrollIntoView?.({ behavior, block: "start" });
  align();
  const stopSettling = keepAligned(el, align);
  function onScroll(): void {
    clearTimeout(idle);
    idle = setTimeout(done, SCROLL_IDLE_MS);
  }
  function stopFlashWait(): void {
    if (finished) return;
    finished = true;
    clearTimeout(idle);
    clearTimeout(cap);
    window.removeEventListener("scroll", onScroll);
  }
  function done(): void {
    if (finished) return;
    stopFlashWait();
    if (el.isConnected) flashElement(el);
  }
  return () => {
    stopFlashWait();
    stopSettling();
  };
}

/**
 * **Call `align` whenever layout may have moved `el`**, for `SETTLE_MS` or
 * until the reader moves the page; returns the stop. Two signals: a web font
 * finishing (`loadingdone`, and `fonts.ready` for one already under way), and
 * the body or `el` changing size. Each is optional — jsdom has neither
 * `document.fonts` nor `ResizeObserver`.
 */
function keepAligned(el: HTMLElement, align: () => void): () => void {
  let stopped = false;
  const realign = () => {
    if (!stopped && el.isConnected) align();
  };
  /* A ResizeObserver reports every target once on `observe`, which is not a
     change; so compare each target's size with the last one it reported. */
  const sizes = new Map<Element, string>();
  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          let changed = false;
          for (const e of entries) {
            const size = `${e.contentRect.width}x${e.contentRect.height}`;
            const before = sizes.get(e.target);
            sizes.set(e.target, size);
            if (before !== undefined && before !== size) changed = true;
          }
          if (changed) realign();
        })
      : null;
  ro?.observe(document.body);
  ro?.observe(el);
  const fonts = (document as { fonts?: FontFaceSet }).fonts;
  fonts?.addEventListener?.("loadingdone", realign);
  if (fonts?.status === "loading") void fonts.ready?.then(realign);
  const timer = setTimeout(stop, SETTLE_MS);
  for (const type of READER_INPUT) window.addEventListener(type, stop, { capture: true, passive: true });
  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    ro?.disconnect();
    fonts?.removeEventListener?.("loadingdone", realign);
    for (const type of READER_INPUT) window.removeEventListener(type, stop, { capture: true });
  }
  return stop;
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
