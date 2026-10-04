import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Put text on the clipboard, and say truthfully how it went.
 *
 * Every copy button in `src/web` needs the same four things, and until
 * 2026-10-04 each wrote them out by hand: the guard for a browser with no
 * clipboard, the promise handling, a "which press is this" token, and a timer
 * that takes the tick away again. The copies drifted; a fix for one reached two
 * of the eight and stopped. This hook is the one copy of all four. What a
 * button *shows* (the glyph, the words, the live region, where a failure is
 * said) stays with the button.
 * docs/plans/261004e-fifth-sweep-cluster-20-one-copy-hook-for-the-nine-clipboard-writers.md.
 *
 * ## The guard is a statement, and that is not style
 *
 * `navigator.clipboard?.writeText(text).then(…).catch(…)` looks like the same
 * thing and is not. Optional chaining short-circuits the *whole* chain, `.catch`
 * included: where there is no clipboard object the expression is `undefined`,
 * nothing throws, nothing rejects, and the state stays `"idle"`. That is a copy
 * button that quietly does nothing, which is the shape
 * docs/reusable/silent-success.md is about. And "no clipboard object" is not
 * exotic: `navigator.clipboard` is undefined in every insecure context, which
 * includes reaching this app at `http://192.168.1.x:5273` from a phone. It was
 * written the careless way first, in `ChatPanel`, and caught in review on
 * 2026-08-26.
 *
 * **The guard runs inside the click.** With no clipboard object the state is
 * `"failed"` and `said` has been called before `copy()` returns. `writeText` is
 * called before `copy()` returns too, so it is inside the reader's gesture,
 * which is when a browser is willing to allow it.
 *
 * ## The token: only the newest press may speak
 *
 * `writeText` is a promise, so two presses can be out at once and the *older*
 * one can settle last. Press twice, the second succeeds, the first is refused a
 * moment later: without a token the button says "failed" over a clipboard that
 * holds exactly what was asked for. So every `copy()` and every `reset()` bumps
 * a counter, and an outcome is acted on only if its press still holds the
 * newest number and the component is still mounted.
 *
 * **The check, the state and the caller's `said` are one step.** `copy()`
 * returns nothing rather than a promise carrying "was this the current press?",
 * because a reset or an unmount can land between the hook answering that and
 * the caller reading the answer. Here nothing can come between them.
 *
 * ## The timer: every outcome gets its full time
 *
 * One timer, in a ref, cleared and started again by every outcome that sets
 * state. The older shape hung the timer off an effect keyed on the state, and
 * setting `"copied"` over `"copied"` is a no-op React bails out of, so a second
 * success while the tick was showing got only what was left of the first one's
 * time.
 *
 * **While a press is out, nothing changes.** The feedback from the press before
 * it, and its timer, carry on until the new press settles.
 *
 * ## Two smaller things
 *
 * The mounted flag is set in the effect's setup as well as cleared in its
 * cleanup. The app mounts under StrictMode, which runs setup, cleanup, setup;
 * a flag that only started out true would be false for the life of the
 * component, and every copy would be dropped as "after unmount".
 *
 * `copy` and `reset` are the same two functions for the life of the component,
 * so they are safe in a dependency list. The timings are read when a press
 * settles, not when it starts, so a caller may pass a fresh object every
 * render. Both are required rather than defaulted, so that each caller's choice
 * is written at its call site.
 */

/** How one write went. */
export type CopyOutcome =
  | { result: "copied" }
  /** No `navigator.clipboard` at all: an insecure context, usually. */
  | { result: "unavailable" }
  /** `writeText` rejected, or threw. */
  | { result: "refused"; error: unknown };

export type CopyState = "idle" | "copied" | "failed";

export function useCopy(revert: {
  /** How long a tick shows. `null`: until a later press settles, or `reset()`. */
  copiedMs: number | null;
  /** How long a failure shows. `null`: until a later press settles, or `reset()`. */
  failedMs: number | null;
}): {
  state: CopyState;
  /**
   * Start a write. Returns nothing: there is no promise for a caller to drop.
   * `said` is called once with the outcome, in the same step that sets `state`,
   * and only if this press is still the newest and the component is mounted.
   */
  copy(text: string, said?: (outcome: CopyOutcome) => void): void;
  /** Back to idle now, and any press still out is overtaken. */
  reset(): void;
} {
  const [state, setState] = useState<CopyState>("idle");
  /** Bumped by every press and every reset. An outcome holding an older number is dropped. */
  const newest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  /* Read at the moment a press settles, so the object's identity never matters
     and `copy` need not be rebuilt when it changes. */
  const timings = useRef(revert);
  timings.current = revert;

  const stopTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopTimer();
    };
  }, [stopTimer]);

  /** The one place an outcome becomes state: the check, the state, the timer and `said`. */
  const settle = useCallback(
    (mine: number, outcome: CopyOutcome, said: ((outcome: CopyOutcome) => void) | undefined) => {
      if (!mounted.current || mine !== newest.current) return;
      const next = outcome.result === "copied" ? "copied" : "failed";
      setState(next);
      stopTimer();
      const ms = next === "copied" ? timings.current.copiedMs : timings.current.failedMs;
      if (ms !== null) {
        timer.current = setTimeout(() => {
          timer.current = null;
          setState("idle");
        }, ms);
      }
      said?.(outcome);
    },
    [stopTimer],
  );

  const copy = useCallback(
    (text: string, said?: (outcome: CopyOutcome) => void) => {
      const mine = ++newest.current;
      /* A statement, not an optional chain. The header says why. */
      if (!navigator.clipboard) {
        settle(mine, { result: "unavailable" }, said);
        return;
      }
      let write: Promise<void>;
      try {
        write = navigator.clipboard.writeText(text);
      } catch (error) {
        settle(mine, { result: "refused", error }, said);
        return;
      }
      /* Both handlers in one `then`, not `.then(…).catch(…)`: that form would
         hand a throw from the caller's own `said` to the failure handler, and
         report a copy that worked as refused. */
      void write.then(
        () => settle(mine, { result: "copied" }, said),
        (error: unknown) => settle(mine, { result: "refused", error }, said),
      );
    },
    [settle],
  );

  const reset = useCallback(() => {
    newest.current += 1;
    stopTimer();
    setState("idle");
  }, [stopTimer]);

  return { state, copy, reset };
}
