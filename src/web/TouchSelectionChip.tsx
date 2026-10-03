/**
 * **What a finger's selection gets: one button, below the words.**
 *
 * Selecting prose opens the comment box from `mouseup` (TableView.tsx
 * § onMouseUp), and a long-press selection on iOS and iPadOS fires no `mouseup`
 * at all — so on an iPad nothing of ours ever appeared. Greg, 2026-10-03
 * (spya-ma5h9b): *"I tried highlighting a few words on my iPad and it didn't
 * seem to work. It just flashed up the usual iPad context menu."*
 *
 * **A button and not the box opening by itself**, because a touch selection has
 * no "let go": the reader long-presses, then drags the two handles, and iOS
 * tells the page only that the selection changed. Opening the box on the first
 * settle would open it on a word they were still extending. So the selection
 * settles, a chip appears beside it, and the press is the reader's.
 *
 * It is **not a dialog**: no focus, no Escape, no trap, nothing in the Escape
 * contract. It is one press that calls the same `onSelect` a mouseup calls.
 *
 * Three rules it has to keep, each of which fails silently:
 *
 * - **Touch only.** The last pointer down decides. A mouse selection keeps its
 *   mouseup and never sees this; a hybrid machine gets whichever made the
 *   selection.
 * - **It sits beside the words that will be saved** — the *clamped* range's
 *   last rectangle (`readSelectionWithRange`), not the end of a drag that ran
 *   on into the next paragraph.
 * - **It cannot open a box on stale words.** iOS may collapse the selection as
 *   the tap lands, so the last anchor is kept — but only for `GRACE_MS`, and
 *   only while its paragraph is still in the document. A press prefers a fresh
 *   read of the selection and falls back to the kept one inside that window.
 *
 * Whether to draw it at all is the caller's: Reader.tsx mounts it for an owner
 * only and passes `suppressed` while a box is open. docs/project/touch.md
 * § A finger's selection gets a button.
 *
 * **Built against jsdom and emulation, not a physical iPad** — touch.md says
 * what that leaves unverified.
 */
import { Highlighter } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import {
  readSelectionWithRange,
  type SelectionAnchor,
} from "./selection.js";

/** How long the selection must sit still before the chip appears. */
export const SETTLE_MS = 300;
/**
 * How long a chip outlives the selection it was drawn for, so that a tap which
 * collapses the selection on its way down can still land on a button.
 */
export const GRACE_MS = 300;

interface Shown {
  anchor: SelectionAnchor;
  /** The paragraph it was read from: gone from the document means stale. */
  prose: Element | null;
  /** Viewport coordinates of the last rectangle of the clamped range. */
  left: number;
  bottom: number;
}

function sameAnchor(a: SelectionAnchor, b: SelectionAnchor): boolean {
  return a.blockId === b.blockId && a.start === b.start && a.quote === b.quote;
}

/** Where the saved words end on screen. jsdom has no range geometry at all. */
function endOf(range: Range): { left: number; bottom: number } {
  const rects = typeof range.getClientRects === "function" ? range.getClientRects() : null;
  const last = rects && rects.length > 0 ? rects[rects.length - 1] : undefined;
  const box =
    last ?? (typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null);
  return box ? { left: box.left, bottom: box.bottom } : { left: 0, bottom: 0 };
}

function isFinger(e: Event): boolean {
  const type = (e as PointerEvent).pointerType;
  return type === "touch" || type === "pen";
}

export interface TouchSelectionChipProps {
  /**
   * A box is already open on a passage (Annotate, Comment or Chat). The chip
   * is not drawn, and anything it was holding is dropped.
   */
  suppressed: boolean;
  /** The same call a mouseup makes — Reader.tsx § `selectProse`. */
  onSelect(anchor: SelectionAnchor): void;
}

export function TouchSelectionChip({ suppressed, onSelect }: TouchSelectionChipProps) {
  const [shown, setShown] = useState<Shown | null>(null);
  /** The same value, readable from listeners without re-subscribing them. */
  const shownRef = useRef<Shown | null>(null);
  const chip = useRef<HTMLButtonElement | null>(null);
  /** Did a finger make the last press? Null until anything has been pressed. */
  const finger = useRef<boolean | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const grace = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the kept anchor stops being usable; 0 while the selection is live. */
  const graceUntil = useRef(0);

  const show = useCallback((next: Shown | null) => {
    shownRef.current = next;
    setShown(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (settle.current !== null) clearTimeout(settle.current);
    if (grace.current !== null) clearTimeout(grace.current);
    settle.current = null;
    grace.current = null;
    graceUntil.current = 0;
  }, []);

  useEffect(() => {
    if (suppressed) return;

    const settled = () => {
      settle.current = null;
      if (finger.current !== true) return;
      const { read, range } = readSelectionWithRange(window.getSelection());
      if (read.kind !== "anchor" || !range) return;
      if (grace.current !== null) clearTimeout(grace.current);
      grace.current = null;
      graceUntil.current = 0;
      const el = range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
      show({ anchor: read.anchor, prose: el?.closest("td.text .prose") ?? null, ...endOf(range) });
    };
    const schedule = () => {
      if (settle.current !== null) clearTimeout(settle.current);
      settle.current = setTimeout(settled, SETTLE_MS);
    };
    /** Take the chip away now; it comes back when the selection next settles. */
    const hide = () => {
      if (grace.current !== null) clearTimeout(grace.current);
      grace.current = null;
      graceUntil.current = 0;
      if (shownRef.current) show(null);
    };

    const onSelectionChange = () => {
      const current = shownRef.current;
      const { read } = readSelectionWithRange(window.getSelection());
      if (current) {
        if (read.kind === "anchor" && sameAnchor(read.anchor, current.anchor)) return;
        if (read.kind === "none") {
          /* The selection is gone — which is also what a tap on the chip can
             do on iOS. Keep the button for one grace period, then drop it. */
          if (grace.current === null) {
            graceUntil.current = Date.now() + GRACE_MS;
            grace.current = setTimeout(hide, GRACE_MS);
          }
          return;
        }
        /* Different words: the handles are moving. */
        hide();
      }
      if (read.kind === "anchor") schedule();
      else if (settle.current !== null) {
        clearTimeout(settle.current);
        settle.current = null;
      }
    };

    const onPointerDown = (e: Event) => {
      /* A press on the chip is not a new gesture in the prose: it must not
         hide the thing being pressed, and the pointer that made the selection
         is still the one that counts. */
      if (chip.current && e.target instanceof Node && chip.current.contains(e.target)) return;
      finger.current = isFinger(e);
      if (!finger.current) return hide();
      /* Hidden while a finger is on the glass — unless the chip is already in
         its grace period, where the timer owns it. **Nothing waits for the
         finger to lift**: whether iOS sends a `pointerup` or a `pointercancel`
         once it takes a long-press for its own is not something we have
         measured, and a chip gated on an event that never comes is a chip that
         never appears. The lift only brings it back sooner. */
      if (grace.current === null) hide();
    };
    const onPointerEnd = (e: Event) => {
      if (!isFinger(e)) return;
      const { read } = readSelectionWithRange(window.getSelection());
      if (read.kind === "anchor" && !shownRef.current) schedule();
    };
    /* Its coordinates are the viewport's, so a scroll or a resize makes them
       wrong. Hidden until things settle rather than chased. */
    const onMove = () => {
      if (!shownRef.current && settle.current === null) return;
      hide();
      schedule();
    };

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerEnd, true);
    document.addEventListener("pointercancel", onPointerEnd, true);
    window.addEventListener("scroll", onMove, { capture: true, passive: true });
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerEnd, true);
      document.removeEventListener("pointercancel", onPointerEnd, true);
      window.removeEventListener("scroll", onMove, { capture: true });
      window.removeEventListener("resize", onMove);
      clearTimers();
      shownRef.current = null;
      setShown(null);
    };
  }, [suppressed, show, clearTimers]);

  if (suppressed || !shown) return null;

  const press = () => {
    const held = shownRef.current;
    const until = graceUntil.current;
    const { read } = readSelectionWithRange(window.getSelection());
    clearTimers();
    show(null);
    if (read.kind === "anchor") return onSelect(read.anchor);
    /* `too-short` is a selection the reader has since changed, not one the tap
       collapsed, so only `none` may fall back — and only inside the grace
       period (`until` is 0 if the chip had never seen the selection go, which
       means it went as this very press landed), on a paragraph still here. */
    if (read.kind !== "none" || !held) return;
    if (until !== 0 && Date.now() >= until) return;
    if (!held.prose?.isConnected) return;
    onSelect(held.anchor);
  };

  return (
    <button
      ref={chip}
      type="button"
      className="touch-select-chip"
      /* Out of the tab order: it exists only for a selection a finger made,
         and focus moving to it would be a second thing happening to the
         selection it is about. */
      tabIndex={-1}
      style={{ "--chip-x": `${shown.left}px`, "--chip-y": `${shown.bottom}px` } as CSSProperties}
      /* Neither press may move focus or start a selection of its own: either
         clears the words this is for. `click` still follows a prevented
         `pointerdown`. */
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={press}
    >
      <Highlighter size={16} aria-hidden="true" />
      Highlight or comment
    </button>
  );
}
