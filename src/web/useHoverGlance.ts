/**
 * **A mouse that rests on a row goes there** — Structure's Hover view
 * (Greg, 2026-10-23, spya-kaxamm; docs/plans/261024k-structure-hover-submode.md).
 *
 * One controller for the whole panel, so the two columns cannot each be
 * waiting on a row at once. The guards, each the whole of something that would
 * otherwise go wrong:
 *
 *  - **A dwell.** A mouse crossing from column A to column B passes over the
 *    parts between; without a pause before acting, each would be a jump (the
 *    menu-aim problem). Moving onto another row restarts the wait; leaving
 *    the row ends it.
 *  - **One physical move, at most one glance.** Every glance moves the prose,
 *    which re-lays out column B and can re-window column A, so a row slides
 *    under a mouse that has not moved — and browsers differ over which events
 *    they send for that. So a glance is armed only by `pointermove`, never by
 *    an enter, and after one fires, nothing arms again until a move arrives at
 *    *different* coordinates. That is what makes a still mouse unable to set
 *    off a glance, then another, for ever.
 *  - **A press, the wheel or a key cancels a wait**, and a wait that ends while
 *    a jump is still gliding gives way to it: a click inside the dwell is a
 *    real jump (history, flash), and a glance landing a moment later would
 *    replace its glide with a quiet move. The press also fences its coordinates
 *    as a fired glance does, because a relayout during the click can otherwise
 *    report a same-place move and arm a fresh wait behind it. GPT Sol, plan
 *    review, finding 2; code review of the built change, 2026-10-24.
 *
 * Mouse only: a finger has no hover, and keeps the tap. A row the reader is
 * already in is never gone to, and wandering inside one row goes once.
 */
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { glideTarget } from "./scroll.js";

/** How long the mouse rests before a row is gone to. Tuned in the browser spike, plan 261024k. */
export const GLANCE_DWELL_MS = 150;

export interface GlanceHandlers {
  onPointerMove(e: ReactPointerEvent): void;
  onPointerLeave(): void;
  onPointerDown(e: ReactPointerEvent): void;
}

export type GlanceAt = (key: string, here: boolean, go: () => void) => GlanceHandlers;

export function useHoverGlance(active: boolean, focusRow: number): GlanceAt {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The row the wait is running for. */
  const pending = useRef<string | null>(null);
  /** The row last gone to, until the mouse leaves it. */
  const done = useRef<string | null>(null);
  /** Where the mouse last moved to, and where it was when the last glance fired. */
  const at = useRef<{ x: number; y: number } | null>(null);
  const firedAt = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);

  /* `here` and `go` belong to the projection that rendered the handlers.
     Retire an armed closure before a changed reading position can make its
     captured `here=false` stale, and synchronously when Hover is left. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: active and focusRow are deliberate triggers; cancel does not otherwise need to read them.
  useLayoutEffect(cancel, [active, focusRow, cancel]);

  useEffect(() => {
    /* StructurePanel stays mounted when Hover becomes Fisheye. Leave no
       global listeners behind in the other view. */
    if (!active) return;
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("keydown", cancel);
    /* A hybrid device can leave its mouse hovering over a row while a finger
       presses elsewhere, so the row's own pointerdown is not enough. */
    window.addEventListener("pointerdown", cancel);
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("pointerdown", cancel);
      cancel();
    };
  }, [active, cancel]);

  return useCallback(
    (key, here, go) => ({
      onPointerMove(e) {
        if (!active || e.pointerType !== "mouse") return;
        const xy = { x: e.clientX, y: e.clientY };
        at.current = xy;
        if (firedAt.current !== null) {
          if (firedAt.current.x === xy.x && firedAt.current.y === xy.y) return;
          firedAt.current = null;
        }
        if (here) {
          cancel();
          return;
        }
        if (done.current === key || pending.current === key) return;
        cancel();
        pending.current = key;
        timer.current = setTimeout(() => {
          timer.current = null;
          pending.current = null;
          if (glideTarget() !== null) return;
          done.current = key;
          firedAt.current = at.current;
          go();
        }, GLANCE_DWELL_MS);
      },
      onPointerLeave() {
        if (pending.current === key) cancel();
        if (done.current === key) done.current = null;
      },
      onPointerDown(e) {
        cancel();
        /* Browsers may report pointer movement when the click's scroll changes
           the layout even though the mouse stayed still. Treat the press as
           the last completed action until a genuinely different coordinate
           arrives, just as a completed glance is treated above. */
        const xy = { x: e.clientX, y: e.clientY };
        at.current = xy;
        firedAt.current = xy;
      },
    }),
    [active, cancel],
  );
}
