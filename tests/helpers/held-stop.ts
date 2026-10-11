/**
 * **The held Stop, on a hand-cranked clock**, for suites that run the real
 * `useDictation` on real timers. On a box with an `onDone`, a Stop press waits
 * `DOUBLE_PRESS_MS` for a second one before it stops anything (plan 261011y);
 * this catches exactly that timer, so a test can say "and now the hold runs
 * out" without sleeping, and without faking the timers the rest of the suite
 * settles on. Call it in a `beforeEach`, after any other `setTimeout` spy;
 * `vi.restoreAllMocks()` takes it away.
 */
import { vi } from "vitest";
import { DOUBLE_PRESS_MS } from "../../src/web/useDictationField.js";

export interface HeldStops {
  /** Holds started and neither run out nor cleared. */
  pending(): number;
  /** Run out every pending hold, as the clock would. */
  expire(): void;
}

export function captureHeldStops(): HeldStops {
  const held = new Map<number, () => void>();
  let next = -1;
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  vi.spyOn(window, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms === DOUBLE_PRESS_MS) {
      const id = next--;
      held.set(id, fn);
      return id;
    }
    return realSetTimeout(fn, ms, ...rest);
  }) as typeof window.setTimeout);
  vi.spyOn(window, "clearTimeout").mockImplementation(((id?: number) => {
    if (id !== undefined && held.delete(id)) return;
    realClearTimeout(id);
  }) as typeof window.clearTimeout);
  return {
    pending: () => held.size,
    expire() {
      const due = [...held.values()];
      held.clear();
      for (const fn of due) fn();
    },
  };
}
