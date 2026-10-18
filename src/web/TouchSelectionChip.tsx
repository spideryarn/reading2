/**
 * **What a finger's selection gets: one button, docked at the screen edge away from the words.**
 *
 * Selecting prose highlights it from `mouseup` (TableView.tsx § onMouseUp), and
 * a long-press selection on iOS and iPadOS fires no `mouseup` at all — so on an
 * iPad nothing of ours ever appeared. Greg, 2026-10-03 (spya-ma5h9b): *"I tried
 * highlighting a few words on my iPad and it didn't seem to work. It just
 * flashed up the usual iPad context menu."*
 *
 * **A button and not the highlight applying by itself**, because a touch
 * selection has no "let go": the reader long-presses, then drags the two
 * handles, and iOS tells the page only that the selection changed. Acting on
 * the first settle would highlight a word they were still extending — and the
 * same long-press is how a reader copies or looks a word up with the system's
 * own menu. So the selection settles, a chip appears beside it, and the press
 * is the reader's. **Since 2026-10-04 that press applies the highlight** and
 * opens the comment's box on it; Reader.tsx § `selectProse` then clears the
 * selection, which puts the OS handles and callout away.
 *
 * It is **not a dialog**: no focus, no Escape, no trap, nothing in the Escape
 * contract. It is one press that calls the same `onSelect` a mouseup calls.
 *
 * Three rules it has to keep, each of which fails silently:
 *
 * - **Touch only.** The last pointer down decides. A mouse selection keeps its
 *   mouseup and never sees this; a hybrid machine gets whichever made the
 *   selection.
 * - **It answers to the words that will be saved** — the *clamped* range
 *   (`readSelectionWithRange`), not a drag that ran on into the next
 *   paragraph — and docks at the screen edge with more room (`placeFor`).
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
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  readSelectionWithRange,
  sameAnchor,
  type SelectionAnchor,
} from "./selection.js";

/** How long the selection must sit still before the chip appears. */
export const SETTLE_MS = 300;
/**
 * How long a chip outlives the selection it was drawn for, so that a tap which
 * collapses the selection on its way down can still land on a button.
 */
export const GRACE_MS = 300;

/** Which screen edge the chip docks at: the one further from the words. */
export type ChipEdge = "top" | "bottom";

interface Shown {
  anchor: SelectionAnchor;
  /** The paragraph it was read from: gone from the document means stale. */
  prose: Element | null;
  edge: ChipEdge;
  /** Viewport x of the last rectangle of the clamped range. */
  left: number;
}

interface ArmedPress {
  shown: Shown;
  /** A collapse after this press began may use the held anchor until here. */
  fallbackUntil: number;
}

/**
 * Where the chip docks for the saved words, or `null` when they are not on screen.
 *
 * **The edge with more room between it and the words**, because iOS draws its
 * own selection menu right beside them — above when there is room, below when
 * there isn't — and over whatever of ours is there. Greg, 2026-10-18
 * (spya-bynh22), on an iPhone: *"I could see the iPhone, like, default
 * standard menu for copy and other stuff on top, and I could see there was
 * something underneath it."* No supported web API hides or moves that menu
 * while keeping native selection, so ours keeps away. A selection tall enough
 * to leave no room at either edge gets the larger of two small gaps; nothing
 * can promise clearance there.
 *
 * Measured against the layout viewport (`innerHeight`), the one the fixed
 * chip is positioned in, so the edge chosen and the edge drawn agree. A
 * pinch-zoomed reader sees only part of it, and the chip may then be off the
 * glass; it was before this too, and handling zoom properly needs the visual
 * viewport's offsets threaded into the CSS — left for when it is asked for
 * (docs/plans/261018c-… § Review of the code). The horizontal position still
 * follows the words' end (`left`); only the vertical one docks, since the
 * collision is vertical.
 *
 * **Off-screen words get no chip**: pressing it would open the box on a passage
 * the reader could not see (browser check, 2026-10-03). jsdom has no range
 * geometry at all, and there the chip docks at the bottom, at the left edge.
 */
function placeFor(range: Range): Pick<Shown, "edge" | "left"> | null {
  const rects = typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
  if (rects.length === 0 && typeof range.getBoundingClientRect === "function") {
    rects.push(range.getBoundingClientRect());
  }
  const last = rects[rects.length - 1];
  if (!last) return { edge: "bottom", left: 0 };
  const height = window.innerHeight;
  const top = Math.max(0, Math.min(...rects.map((r) => r.top)));
  const bottom = Math.min(height, Math.max(...rects.map((r) => r.bottom)));
  if (bottom < 0 || top > height) return null;
  return { edge: height - bottom >= top ? "bottom" : "top", left: last.left };
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
  /* A suppressed chip is an unmounted chip, not merely hidden. That makes an
     open box a synchronous reset of its listeners, timers and kept anchor,
     without a cleanup function setting React state after unmount. */
  return suppressed ? null : <ActiveTouchSelectionChip onSelect={onSelect} />;
}

function ActiveTouchSelectionChip({ onSelect }: Pick<TouchSelectionChipProps, "onSelect">) {
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
  /** A press is valid only if its pointerdown still found this chip's words. */
  const armedPress = useRef<ArmedPress | null>(null);

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
      const place = placeFor(range);
      if (!place) return;
      show({ anchor: read.anchor, prose: el?.closest("td.text .prose") ?? null, ...place });
    };
    const schedule = () => {
      if (settle.current !== null) clearTimeout(settle.current);
      settle.current = setTimeout(settled, SETTLE_MS);
    };
    /** Take the chip away now; it comes back when the selection next settles. */
    const hide = () => {
      if (settle.current !== null) clearTimeout(settle.current);
      if (grace.current !== null) clearTimeout(grace.current);
      settle.current = null;
      grace.current = null;
      graceUntil.current = 0;
      armedPress.current = null;
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
      /* Hidden while a finger is on the glass. **Nothing waits for the finger
         to lift**: whether iOS sends a `pointerup` or a `pointercancel` once it
         takes a long-press for its own is not something we have measured, and
         a chip gated on an event that never comes is a chip that never
         appears. The lift only brings it back sooner. */
      hide();
    };
    const onPointerEnd = (e: Event) => {
      if (!isFinger(e)) return;
      const { read } = readSelectionWithRange(window.getSelection());
      if (read.kind === "anchor" && !shownRef.current) schedule();
    };
    /* Its coordinates are the viewport's, so a scroll or a resize makes them
       wrong. Hidden until things settle rather than chased. */
    const onMove = () => {
      if (!shownRef.current && settle.current === null) {
        /* Nothing shown and nothing pending — but a finger's selection that
           was held back for being off screen (`placeFor`) may be scrolling into
           view, and only a scroll can tell us. `settled` does the real read. */
        const live = window.getSelection();
        if (finger.current === true && live && !live.isCollapsed) schedule();
        return;
      }
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
      armedPress.current = null;
      finger.current = null;
    };
  }, [show, clearTimers]);

  if (!shown) return null;

  const armPress = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const held = shownRef.current;
    if (!held?.prose?.isConnected) {
      armedPress.current = null;
      return;
    }
    const { read } = readSelectionWithRange(window.getSelection());
    const now = Date.now();
    const live = read.kind === "anchor" && sameAnchor(read.anchor, held.anchor);
    const observedCollapse = read.kind === "none" && graceUntil.current > now;
    armedPress.current = live || observedCollapse
      ? { shown: held, fallbackUntil: live ? now + GRACE_MS : graceUntil.current }
      : null;
  };

  const press = () => {
    const held = shownRef.current;
    const armed = armedPress.current;
    armedPress.current = null;
    if (!held) return;
    const { read } = readSelectionWithRange(window.getSelection());
    clearTimers();
    show(null);
    if (!held.prose?.isConnected) return;
    if (read.kind === "anchor") {
      /* The chip belongs to the words it was drawn beside. A changed live
         selection which omitted `selectionchange` must settle and earn its
         own chip rather than borrowing this one. */
      if (sameAnchor(read.anchor, held.anchor)) onSelect(read.anchor);
      return;
    }
    /* `too-short` is a selection the reader has since changed, not one the tap
       collapsed, so only `none` may fall back. The pointerdown must have
       validated these exact words before the collapse; `graceUntil === 0`
       never means unlimited grace for a silently stale selection. */
    if (read.kind !== "none" || armed?.shown !== held) return;
    if (Date.now() >= armed.fallbackUntil) return;
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
      data-edge={shown.edge}
      style={{ "--chip-x": `${shown.left}px` } as CSSProperties}
      /* Neither press may move focus or start a selection of its own: either
         can clear the words this is for. The action itself is on pointerup, so
         it does not depend on a cancelled pointerdown producing a click. */
      onPointerDown={armPress}
      /* Commit at the pointer's own end. WebKit is not required to synthesize
         a click after a cancelled pointerdown; `onClick` below is only the
         compatibility/accessibility fallback. `show(null)` makes a following
         click a no-op. */
      onPointerUp={press}
      onPointerCancel={() => {
        armedPress.current = null;
      }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={press}
    >
      <Highlighter size={16} aria-hidden="true" />
      Highlight or comment
    </button>
  );
}
