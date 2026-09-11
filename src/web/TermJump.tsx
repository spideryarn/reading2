/**
 * **G, from the paragraph you are on, to its term in the glossary.**
 *
 * A term in the prose is a `<mark>`, and a mark takes no focus — deliberately,
 * because an article can underline several hundred of them and a tab stop each
 * would bury everything else (ProseHoverCard.tsx § `focusable`). So a keyboard
 * reader could see an underlined word and had no way to its entry short of
 * tabbing through every paragraph's gutter to reach it.
 *
 * Greg's choice, 2026-09-11, of the two the plan offered: **jump to the
 * glossary row that already exists** rather than open a list of the paragraph's
 * terms in a card of its own. The row is the definition; the band already
 * draws it, keeps it open and gives it a keyboard (docs/plans/260908f §
 * M). So this file adds a key and a return journey, and no surface.
 *
 * - **Which paragraph.** The row whose permalink or prose link holds the focus.
 *   Other row controls keep their own unmodified letters. Otherwise, with
 *   nothing focused at all and the prose visible, the row at the reading line:
 *   `measureRow`, the same measurement the arrow keys step from, so ↓ to a
 *   paragraph and then G agree about which one it is. Focus anywhere else — the
 *   Dock, a panel's button — and the key is not ours.
 * - **Which term.** The ones the reader can see underlined in that row, read
 *   off the rendered marks rather than off `entry.blocks`, so the answer is what
 *   is on screen even where the list was written for an older extraction.
 *   Reading order, each once; a term inside the focused element — a link whose
 *   words are a term — goes first. G again walks to the next and wraps.
 * - **Where the focus goes.** Onto that term's row in the band, which the
 *   opener has just expanded, and the list scrolls to it; **the article does
 *   not move**. `onOpenTerm` is the hover card's own "in the glossary" button,
 *   which sets `?term=` and the mode and never jumps the prose.
 * - **The way back.** Escape, while the glossary itself owns the press, returns
 *   the focus to what held it — or, when nothing did, to that paragraph's
 *   permalink — and the press stops there. A surface opened in front gets its
 *   own first Escape.
 *
 * **Mounted by ProseHoverCard, not by Reader**, because that component is where
 * the terms and the opener already meet outside Reader.tsx, and the key is the
 * keyboard's version of the card's foot button. It renders one `sr-only` live
 * region and nothing else.
 */
import { useCallback, useEffect, useRef } from "react";
import type { BlockId, GlossaryEntry } from "../types.js";
import { measureRow } from "./keynav.js";

/** The key. Lower-case only: Shift+G, ⌘G and the rest belong to somebody else. */
export const TERM_JUMP_KEY = "g";

/** How long the band gets to draw the row before we say we could not find it. */
const FIND_ROW_MS = 1500;
/** The live region's blank between two messages — TableView.tsx § `announce`. */
const ANNOUNCE_GAP_MS = 50;

/** Where a jump started, which is where Escape goes back to. */
interface Origin {
  blockId: BlockId;
  /** What held the focus, or `null` when nothing did. */
  returnTo: HTMLElement | null;
  /**
   * Which of the row's prose links that was, if it was one — because it will
   * not survive the jump. Opening a term re-renders the prose's HTML (the
   * open term gets its wash, annotate.ts § `data-term-open`), so the `<a>` the
   * reader was on is replaced by an identical one; the gutter's permalink is a
   * React element and stays. Found in Chrome: the first cut sent Escape to the
   * permalink instead.
   */
  linkIndex: number | null;
  /** The term this paragraph's last G landed on, so the next one moves on. */
  termId: string;
}

/** Typing somewhere? Then a g is a letter. keynav.ts § `isTyping`, same list. */
function isTyping(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.isContentEditable === true) return true;
  /* jsdom has no `isContentEditable`, and a future composer may put the event
     target below its editing host. Honour the nearest explicit value; `false`
     starts a non-editable island inside an editor. */
  const host = el.closest<HTMLElement>("[contenteditable]");
  return host !== null && host.getAttribute("contenteditable")?.toLowerCase() !== "false";
}

/**
 * The first element matching `selector` whose `attr` is `value`. Compared
 * rather than put in the selector, so no id has to be escaped into one; a
 * keypress can afford a walk over a few hundred rows.
 */
function byAttr(selector: string, attr: string, value: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (el.getAttribute(attr) === value) return el;
  }
  return null;
}

function rowOf(blockId: BlockId): HTMLElement | null {
  return byAttr("tbody tr[data-block]", "data-block", blockId);
}

/** The ids on a set of marks, in document order, each once. */
function idsOn(marks: Iterable<Element>, known: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const m of marks) {
    for (const id of (m.getAttribute("data-term") ?? "").split(" ")) {
      if (id && known.has(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/**
 * The terms a row shows, in the order G walks them: those inside `first` (the
 * focused link, say), then the rest of the paragraph's in reading order.
 */
export function termsInRow(
  row: Element,
  known: ReadonlySet<string>,
  first: Element | null = null,
): string[] {
  const all = idsOn(row.querySelectorAll(".prose mark.term"), known);
  if (!first || !row.contains(first)) return all;
  const lead = idsOn(first.querySelectorAll("mark.term"), known);
  return [...lead, ...all.filter((id) => !lead.includes(id))];
}

/** The term after `current` in `ids`, wrapping; the first when `current` is not there. */
export function nextTerm(ids: readonly string[], current: string | null): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  return ids[(at + 1) % ids.length] ?? null;
}

/** A plain g, pressed where a g is not a letter and no modal owns the keys. */
function isOurKey(e: KeyboardEvent): boolean {
  if (e.key !== TERM_JUMP_KEY) return false;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return false;
  /* During IME composition some browsers still expose the physical letter;
     keyCode 229 is the older composition sentinel used by the same engines. */
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.defaultPrevented || isTyping(e.target as Element | null)) return false;
  /* A native modal owns the keyboard; the article is inert behind it. */
  return document.querySelector("dialog[open]") === null;
}

function proseLinks(row: Element): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>(".prose a[href]")];
}

/**
 * The two row controls from which G has an unambiguous paragraph meaning.
 * Other focusable descendants — figure buttons, disclosures and future
 * composite widgets — own their unmodified letters themselves.
 */
function rowOrigin(focused: Element, row: Element): HTMLElement | null {
  if (!(focused instanceof HTMLElement)) return null;
  if (!focused.matches(".blk-permalink, .prose a[href]")) return null;
  return row.contains(focused) ? focused : null;
}

/** Scroll only the glossary's own scroller, never the page behind it. */
function revealInList(button: HTMLElement): void {
  const list = button.closest<HTMLElement>(".gloss-list");
  const item = button.closest<HTMLElement>("li");
  if (!list || !item) return;
  const listRect = list.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
    list.scrollTop += itemRect.top - listRect.top;
  }
}

/** What held the focus when the jump began, or the element that has replaced it. */
function holder(from: Origin, row: Element | null): HTMLElement | null {
  if (from.returnTo?.isConnected) return from.returnTo;
  if (row && from.linkIndex !== null) return proseLinks(row)[from.linkIndex] ?? null;
  return null;
}

/**
 * Which paragraph a press starts from, and what to give the focus back to.
 *
 * `null` when the press is not ours — focus on any control other than the
 * paragraph's permalink/prose links, or no visible prose to infer from.
 * `"gone"` when G comes from the band after a jump whose paragraph has since
 * left the page.
 */
function startingPoint(
  prior: Origin | null,
  focused: Element | null,
): { blockId: BlockId; row: HTMLElement; returnTo: HTMLElement | null } | "gone" | null {
  if (prior && focused?.closest(".gloss-list")) {
    /* Back in the band from a jump: G again moves on through the same paragraph. */
    const row = rowOf(prior.blockId);
    return row ? { blockId: prior.blockId, row, returnTo: holder(prior, row) } : "gone";
  }
  const nothing = focused === null || focused === document.body;
  /* A modeless dialog does not make the page inert, so focus can fall back to
     body while Chat, Comment, a drawer or a hover card is still in front. Body
     is not evidence that the reader means the article in that state. */
  if (nothing && document.querySelector('[role="dialog"]') !== null) return null;
  /* With a covering band the table still exists and still has geometry, but it
     is not what the reader can see. Do not infer an origin through it. */
  if (nothing && document.querySelector(".reader.band-covers .mode-band") !== null) return null;
  const row = nothing
    ? document.querySelectorAll<HTMLElement>("tbody tr[data-block]")[measureRow()]
    : focused.closest<HTMLElement>("tbody tr[data-block]");
  const blockId = row?.getAttribute("data-block") as BlockId | null | undefined;
  if (!row || !blockId) return null;
  const returnTo = nothing ? null : rowOrigin(focused!, row);
  if (!nothing && !returnTo) return null;
  return { blockId, row, returnTo };
}

export function TermJump({
  entries,
  onOpenTerm,
}: {
  entries: readonly GlossaryEntry[];
  /** Show this term in the glossary band — Reader's `openTermInGlossary`. */
  onOpenTerm(id: string): void;
}) {
  const live = useRef<HTMLSpanElement>(null);
  const origin = useRef<Origin | null>(null);
  /** Bumped per jump, so a slow search for one row cannot focus it after the next. */
  const op = useRef(0);
  const announceTimer = useRef<number | null>(null);
  const known = useRef<ReadonlyMap<string, GlossaryEntry>>(new Map());
  known.current = new Map(entries.map((e) => [e.id, e]));
  const open = useRef(onOpenTerm);
  open.current = onOpenTerm;

  const announce = useCallback((said: string) => {
    const region = live.current;
    if (!region) return;
    if (announceTimer.current !== null) window.clearTimeout(announceTimer.current);
    region.textContent = "";
    announceTimer.current = window.setTimeout(() => {
      announceTimer.current = null;
      if (live.current) live.current.textContent = said;
    }, ANNOUNCE_GAP_MS);
  }, []);

  useEffect(() => {
    /**
     * Put the focus on the term's row once the band has drawn it.
     *
     * Polled a frame at a time rather than awaited, because the row appears
     * after two writes to the address and a mode change, none of which this
     * component can see settle. `preventScroll`, and the list scrolled by hand:
     * a plain `focus()` scrolls every scrollable ancestor it needs to, and the
     * page is one of them — which is the article moving under the reader.
     */
    const focusRow = (termId: string, mine: number) => {
      const until = performance.now() + FIND_ROW_MS;
      const look = () => {
        if (mine !== op.current) return;
        const btn = byAttr(".gloss-list li[data-term-id]", "data-term-id", termId)?.querySelector<HTMLElement>(
          ".gloss-term-btn",
        );
        if (btn) {
          btn.focus({ preventScroll: true });
          revealInList(btn);
          return;
        }
        if (performance.now() > until) {
          const name = known.current.get(termId)?.name ?? "That term";
          announce(`${name} is not in the glossary list.`);
          return;
        }
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    };

    const onKey = (e: KeyboardEvent) => {
      if (!isOurKey(e)) return;
      const prior = origin.current;
      const from = startingPoint(prior, document.activeElement);
      if (from === null) return;
      if (from === "gone") {
        e.preventDefault();
        origin.current = null;
        op.current++;
        announce("That paragraph is no longer on the page.");
        return;
      }
      const { blockId, row, returnTo } = from;

      e.preventDefault();
      /* Cancel any earlier row search even when this press finds no term. */
      const mine = ++op.current;
      const ids = termsInRow(row, new Set(known.current.keys()), returnTo);
      const same = prior?.blockId === blockId ? prior.termId : null;
      const termId = nextTerm(ids, same);
      if (termId === null) {
        origin.current = null;
        announce("No glossary terms in this paragraph.");
        return;
      }
      const at = returnTo ? proseLinks(row).indexOf(returnTo) : -1;
      origin.current = { blockId, returnTo, linkIndex: at === -1 ? null : at, termId };
      open.current(termId);
      const name = known.current.get(termId)?.name ?? "";
      announce(`${name}, ${ids.indexOf(termId) + 1} of ${ids.length} in this paragraph.`);
      focusRow(termId, mine);
    };

    /**
     * **Escape goes back to the paragraph**, and stops there.
     *
     * Only while the focus is somewhere in the glossary list *and* a G put it
     * there; an Escape with no jump behind it is not ours. `document`, bubble,
     * with `stopPropagation` — tier T2 of the escape inventory, the gutter's
     * "…" disclosure's own claim (BlockGutter.tsx § Escape): the reader is
     * standing where we put them, so the press is the way back, and a modeless
     * dialog listening on `window` behind the band must not also close on it.
     * A native modal outranks this, as everywhere.
     */
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      const from = origin.current;
      if (!from || !(document.activeElement?.closest(".gloss-list") ?? null)) return;
      if (document.querySelector("dialog[open]") !== null) return;
      /* Another T2 surface gets its own first Escape. `stopPropagation()` does
         not stop a sibling listener on `document`, so without this explicit
         yield an open gutter and this return journey both acted on one press. */
      if (document.querySelector(".blk-gutter[data-open]") !== null) return;
      /* **Not where the band has the whole page.** In a narrow window the band
         covers the article (`band-covers`, narrow-windows.md), so the paragraph
         is underneath it and focusing it would put the focus somewhere nobody
         can see. The way back there is the one the hover card's button leaves
         too — the Dock's modes, or Back — and the press goes on as if we were
         not here. Found in Chrome at 420px. */
      if (document.querySelector(".reader.band-covers") !== null) return;
      e.stopPropagation();
      origin.current = null;
      op.current++;
      const row = rowOf(from.blockId);
      const back = holder(from, row) ?? row?.querySelector<HTMLElement>(".blk-permalink");
      if (!back) {
        announce("That paragraph is no longer on the page.");
        return;
      }
      /* The paragraph is still where the reader left it; focusing must not move it. */
      back.focus({ preventScroll: true });
    };

    /** A return journey ends when the reader moves focus somewhere else. */
    const onFocus = (e: FocusEvent) => {
      if (!origin.current) return;
      const target = e.target as Element | null;
      if (target?.closest(".gloss-list")) return;
      origin.current = null;
      op.current++;
    };

    window.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onEscape);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("keydown", onEscape);
      document.removeEventListener("focusin", onFocus);
      op.current++;
      if (announceTimer.current !== null) {
        window.clearTimeout(announceTimer.current);
        announceTimer.current = null;
      }
    };
  }, [announce]);

  return <span ref={live} className="sr-only term-jump-status" role="status" aria-atomic="true" />;
}
