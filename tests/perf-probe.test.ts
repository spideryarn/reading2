// @vitest-environment jsdom
/**
 * **The probe must not be able to break the page it measures.**
 *
 * `src/web/perf.ts` monkey-patches `setTimeout`, `setInterval`,
 * `requestAnimationFrame` and `fetch`. That is a reasonable thing for a
 * profiler to do and an unreasonable thing to get wrong, because the failure
 * mode is the nastiest one available: the app misbehaves *only while being
 * measured*, so every attempt to reproduce it without the probe succeeds and
 * the probe looks innocent.
 *
 * It shipped with exactly that bug. `setTimeout(fn, ms, a, b)` calls `fn(a, b)`,
 * and the wrapper dropped the extra arguments — so any code using that form
 * would have seen `undefined` parameters, but only under `?perf=1`. Hence the
 * forwarding test below, which is the reason this file exists.
 *
 * The other half is that it must be **inert when off**, which is what makes it
 * safe to ship enabled-by-a-query-parameter rather than stripped from the
 * build.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REAL = {
  setTimeout: window.setTimeout,
  setInterval: window.setInterval,
  requestAnimationFrame: window.requestAnimationFrame,
  fetch: window.fetch,
};

/** Put the globals back between tests. `startPerf` guards on its own `on` flag
 *  so it only ever patches once per module load, but leaving a patched global
 *  behind would make the "off" test depend on running first. */
function restore(): void {
  window.setTimeout = REAL.setTimeout;
  window.setInterval = REAL.setInterval;
  window.requestAnimationFrame = REAL.requestAnimationFrame;
  window.fetch = REAL.fetch;
  delete (window as unknown as Record<string, unknown>).__perf;
}

/** `location.search` is read once, at `startPerf`, so it has to be set before
 *  the import that calls it. jsdom allows the whole URL to be replaced. */
function setSearch(search: string): void {
  window.history.replaceState({}, "", `/${search}`);
}

beforeEach(() => {
  restore();
  // jsdom does not define `localStorage` under every origin, and the probe has
  // to survive that too — see `sticky()` in perf.ts.
  try {
    localStorage.clear();
  } catch {
    /* nothing to clear */
  }
  vi.resetModules();
});
afterEach(restore);

describe("the perf probe", () => {
  it("touches nothing when it has not been asked for", async () => {
    setSearch("");
    // A fresh module instance per test, because `startPerf` latches on its own
    // `on` flag and would decline to patch a second time. `vi.resetModules`
    // rather than a cache-busting query string: Vite cannot resolve a dynamic
    // import whose specifier is not statically analysable.
    const { startPerf, useRenderCount } = await import("../src/web/perf.js");
    startPerf();

    expect({
      setTimeout: window.setTimeout === REAL.setTimeout,
      setInterval: window.setInterval === REAL.setInterval,
      raf: window.requestAnimationFrame === REAL.requestAnimationFrame,
      fetch: window.fetch === REAL.fetch,
      exposed: (window as unknown as Record<string, unknown>).__perf,
    }).toEqual({
      setTimeout: true,
      setInterval: true,
      raf: true,
      fetch: true,
      exposed: undefined,
    });

    // And the hook is safe to call outside React when nothing is counting.
    expect(() => useRenderCount("nothing")).not.toThrow();
  });

  it("forwards the extra arguments setTimeout is allowed to take", async () => {
    setSearch("?perf=1");
    const { startPerf } = await import("../src/web/perf.js");
    startPerf();
    expect(window.setTimeout).not.toBe(REAL.setTimeout);

    const got = await new Promise<unknown[]>((resolve) => {
      window.setTimeout((...args: unknown[]) => resolve(args), 0, "first", 2);
    });
    expect(got).toEqual(["first", 2]);
  });

  it("calls a timer handler with the receiver the browser would have given it", async () => {
    setSearch("?perf=1");
    const { startPerf } = await import("../src/web/perf.js");
    startPerf();

    // A `function`, not an arrow: an arrow has no `this` of its own and would
    // pass whatever the test file's scope has, proving nothing.
    const receiver = await new Promise<unknown>((resolve) => {
      window.setTimeout(function (this: unknown) {
        resolve(this);
      }, 0);
    });
    expect(receiver).toBe(window);
  });

  it("charges elapsed time to the state it elapsed under, not the one it moved to", async () => {
    setSearch("?perf=1");
    const { startPerf } = await import("../src/web/perf.js");
    startPerf();
    const perf = (
      window as unknown as {
        __perf: { report(): { visible: { wallMs: number }; hidden: { wallMs: number } } };
      }
    ).__perf;

    // A `visibilitychange` listener runs AFTER the browser has flipped the
    // state, so a probe that reads `visibilityState` at that moment bills the
    // stretch that just ended to the state it is entering. Nothing has been
    // hidden here, so every millisecond so far belongs to `visible`.
    await new Promise((r) => REAL.setTimeout.call(window, r, 20));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    const report = perf.report();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect({ visibleGotTime: report.visible.wallMs > 0, hiddenGotNone: report.hidden.wallMs < 5 }).toEqual(
      { visibleGotTime: true, hiddenGotNone: true },
    );
  });

  it("counts a timer it wrapped, and hands back a handle clearTimeout accepts", async () => {
    setSearch("?perf=1");
    const { startPerf } = await import("../src/web/perf.js");
    startPerf();
    const perf = (window as unknown as { __perf: { report(): { visible: { timers: number } } } }).__perf;

    // Cleared before it fires: it must NOT be counted, because the whole point
    // of the number is work that actually happened.
    const doomed = window.setTimeout(() => {}, 5);
    clearTimeout(doomed);

    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 0);
    });

    expect(perf.report().visible.timers).toBe(1);
  });
});
