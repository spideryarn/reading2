/**
 * Keeping a panel's own scroller pointed at the row the reader is on.
 *
 * Greg, 2026-08-26:
 *
 * > If I'm in "Summary" mode, can we highlight and scroll to the relevant
 * > Summary section that corresponds to the current position of the text?
 *
 * The highlight is a class. This file is the *scroll* half, and the whole of
 * the difficulty is that **the reader can scroll this panel too**. That is what
 * separates it from ContextPanel, which is `overflow: hidden` and moves only
 * when this code moves it — there, "put the current item on the focus line" is
 * unambiguous, because nothing else ever touches `scrollTop`.
 *
 * ## Nudge, don't yank
 *
 * Two rules, and between them they mean the panel never takes the scroll off
 * somebody who is using it:
 *
 *  1. **Move only when the target has changed.** Not on every render, and not
 *     on a timer. The trigger is the reader crossing into a different section
 *     of the article — which is a thing they did, so a response to it is not a
 *     surprise. A reader browsing the outline while the article stays put sees
 *     the panel do nothing at all.
 *  2. **Move only if the target is not comfortably visible.** If they have
 *     already got the row on screen, wherever they have put it is better than
 *     wherever we would have put it.
 *
 * Note what rule 1 buys, because it is the reason there is no scroll listener
 * here: the classic version of this feature watches the panel's own `scroll`
 * events to tell "the reader moved it" from "I moved it", and that check is
 * where the bug lives, because a programmatic scroll fires exactly the same
 * event — a smooth one fires dozens of them, arriving *after* the flag that was
 * meant to cover them has been cleared. Keying on the target instead means the
 * question never has to be asked.
 *
 * The cost is honest and worth writing down: closing or opening sections
 * reflows the list without changing which row is current, so the current row
 * can drift out of view and stay there until the reader crosses a section
 * boundary. The caller handles that by re-running on the things that reflow the
 * list; a re-run with the row already in view costs one `getBoundingClientRect`
 * and moves nothing.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { POSITION_SETTLE_MS } from "./params.js";
import { reducedMotion } from "./scroll.js";

/** A vertical span in viewport coordinates — what `getBoundingClientRect` gives. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * How much room to leave between the row and the edge it was scrolled past.
 *
 * A share of the panel rather than a fixed number of pixels, capped, and the
 * cap is what matters: at 25% of a tall panel the row would land a third of the
 * way down and every step would be a long slide, while a fixed 72px in a short
 * panel would be most of the visible height and there would be nowhere left to
 * put the row.
 *
 * It is deliberately generous rather than minimal. A row nudged to sit exactly
 * on the bottom edge is technically visible and useless — the next section's
 * title, which is what a reader moving forwards is about to want, is off the
 * bottom. The margin is the lookahead.
 */
export function comfort(height: number): number {
  return Math.min(72, height * 0.25);
}

/**
 * How far to scroll, and the answer is usually zero.
 *
 * Positive moves the content up (`scrollTop` increases). Both spans are in the
 * same coordinate system; only their difference is used, so it does not matter
 * which.
 *
 * The two clamps are one rule seen twice: **the top of the row wins.** A row
 * taller than the panel cannot be shown whole, and of the two ends the title is
 * the one worth having — so scrolling down is capped at whatever would put the
 * top on its margin, and never further.
 */
export function followDelta(box: Span, target: Span, margin: number): number {
  const above = target.top - (box.top + margin);
  const below = target.bottom - (box.bottom - margin);
  if (above < 0) return above;
  if (below > 0) return Math.min(below, above);
  return 0;
}

/** The attribute `useFollow` finds its target by. */
export const FOLLOW_ATTR = "data-follow";

/**
 * How long a move takes. Short — this is a panel catching up with the reader,
 * not a journey. `scroll.ts` uses the same easing on the article for the same
 * reason.
 */
const SLIDE_MS = 260;
const ease = (t: number) => 1 - (1 - t) ** 3;

/**
 * How long the panel is left alone after the reader has scrolled it themselves.
 *
 * The one hole in "move only when the target changes", and it exists because
 * the target changes *late*: `?at=` is debounced, so a reader who stops
 * scrolling the article, moves to the panel and gives it a flick can have the
 * delayed update arrive on top of them. GPT Sol's review, 2026-08-26, and this
 * is the half of it that was worth conceding.
 *
 * **Derived from the debounce rather than written down as a number**, because
 * that is the window it exists to cover, and a hardcoded 400 would quietly stop
 * covering it the day somebody tuned the debounce — the same agreement-between-
 * two-files trap ContextPanel's LEAD/TAIL avoid. docs/reusable/silent-success.md.
 *
 * What makes this *not* the "was that scroll mine or theirs" guess the rest of
 * this file is built to avoid: the signal is `wheel` and `touchmove`, which are
 * the reader's hand and nothing else. No programmatic scroll has ever fired
 * one. A `scroll` event would have been the ambiguous signal, and there is
 * deliberately no listener for it here.
 *
 * `pointerdown` is deliberately not in that list either: a click on a summary
 * row is a pointer event on this panel, and counting it would suppress the
 * follow that the click's own jump is supposed to cause.
 */
const HANDS_OFF_MS = POSITION_SETTLE_MS + 120;

/**
 * Move `el.scrollTop` to `to` over `SLIDE_MS`, and hand back the way to stop.
 *
 * **Our own animation rather than `scrollTo({ behavior: "smooth" })`**, and
 * both halves of that are the point:
 *
 *  - *It can be cancelled.* A native smooth scroll has no handle. When the
 *    reader crosses into a new section while the last move is still running,
 *    and the new row happens to be in view already, the correct thing to do is
 *    **stop** — and with `behavior: "smooth"` there is no way to say so, so the
 *    old animation carries on to a destination chosen for a row that is no
 *    longer current and drags the new one off the screen. Nothing errors; the
 *    panel simply drifts to the wrong place. GPT Sol's review, 2026-08-26.
 *  - *The reader can take it back mid-flight.* A wheel or a finger on the panel
 *    stops it where it is, which is the same bail-out `scroll.ts` gives the
 *    article. A native smooth scroll fights that on some browsers and yields on
 *    others.
 *
 * The clock is the `requestAnimationFrame` timestamp rather than `Date.now()`,
 * so the first frame defines zero and a long first paint does not eat the
 * animation.
 */
function slide(el: HTMLElement, to: number): () => void {
  const from = el.scrollTop;
  const distance = to - from;
  let frame = 0;
  /* `null` rather than `0`, because zero is a legal `requestAnimationFrame`
     timestamp — rare, but a sentinel that a real value can equal is a bug
     waiting for the one browser that starts its clock at the page load. */
  let started: number | null = null;
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    el.removeEventListener("wheel", stop);
    el.removeEventListener("touchstart", stop);
  };
  const tick = (now: number) => {
    if (started === null) started = now;
    const t = Math.min(1, (now - started) / SLIDE_MS);
    el.scrollTop = from + distance * ease(t);
    if (t < 1) frame = requestAnimationFrame(tick);
    else stop();
  };
  el.addEventListener("wheel", stop, { passive: true });
  el.addEventListener("touchstart", stop, { passive: true });
  frame = requestAnimationFrame(tick);
  return stop;
}

/**
 * Scroll `box` to whichever descendant carries `data-follow="<id>"`, when `id`
 * changes and the row is not already comfortably in view.
 *
 * `reflow` is a list of values that change the *heights* in the box without
 * changing which row is current — the Length control, the Depth control, the
 * set of closed sections. Re-running on them is what stops the mark drifting
 * off the top after the reader shortens every row in the panel at once.
 *
 * The very first placement is instant. Sliding smoothly from the top of a list
 * the reader has not looked at yet is animating a journey they never took.
 */
export function useFollow(
  box: RefObject<HTMLElement | null>,
  id: string | null,
  reflow: readonly unknown[],
) {
  const placed = useRef(false);
  /** Stops the move in flight, if there is one. */
  const running = useRef<(() => void) | null>(null);
  /** When the reader last scrolled this panel with their own hand. */
  const touched = useRef(0);

  // Stop animating a panel that is being taken off the screen.
  useLayoutEffect(() => () => running.current?.(), []);

  // `wheel` and `touchmove` are the reader and nobody else — see HANDS_OFF_MS.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const note = () => {
      touched.current = Date.now();
    };
    el.addEventListener("wheel", note, { passive: true });
    el.addEventListener("touchmove", note, { passive: true });
    return () => {
      el.removeEventListener("wheel", note);
      el.removeEventListener("touchmove", note);
    };
  }, [box]);

  /* `useLayoutEffect`, not `useEffect`: the first placement is a correction to
     where the panel is *painted*, and an effect that runs after paint shows the
     reader one frame of an outline scrolled to the top before it jumps to where
     they actually are.

     The reflow values are re-run triggers, not values read inside. Spread into
     the array rather than passed as one, because an array literal is a new
     object on every render and would re-run this every time — which would still
     move nothing, but only by luck. The caller must therefore pass a list of
     **constant length**: React compares dependency arrays by index, and a list
     that grows silently starts comparing the wrong pairs. */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;

    /* **Before every early return below**, not after them. The move that was
       running was aimed at a row that is no longer the question, so it stops
       here whatever happens next — including when there is now no row at all,
       which is what `deep: 0` and a reader scrolling back above the first
       section both produce. Stopping it is also what makes "the new row is
       already in view, do nothing" mean *nothing*: leave it running and the
       panel keeps sliding towards a number chosen for the previous row, and
       takes the new one off the screen on the way. */
    running.current?.();
    running.current = null;

    if (id === null) return;
    const row = el.querySelector<HTMLElement>(`[${FOLLOW_ATTR}="${CSS.escape(id)}"]`);
    if (!row) return;

    // The reader has this panel in their hand; the article can wait.
    if (Date.now() - touched.current < HANDS_OFF_MS) return;

    // Set before the delta check, not after it. `first` means "we had not yet
    // had a row to place", and a mount whose row is *already* in view is a
    // placement that happened to need no movement — the reader's next step is
    // then an ordinary one and should slide like one. Flipping this only on an
    // actual move would make that step instant instead, for no reason a reader
    // could see.
    const first = !placed.current;
    placed.current = true;
    const delta = followDelta(
      el.getBoundingClientRect(),
      row.getBoundingClientRect(),
      comfort(el.clientHeight),
    );
    if (delta === 0) return;

    const to = el.scrollTop + delta;
    if (first || reducedMotion()) el.scrollTop = to;
    else running.current = slide(el, to);
  }, [box, id, ...reflow]);
}
