// @vitest-environment jsdom
/**
 * **`data-bar-stuck`: the controls bar has reached the top of the window** —
 * `watchBarStuck` in src/web/scroll.ts.
 *
 * The attribute is what lets a bar holding the headings breadcrumb take the
 * strip above a mode band (crumbs.css § above the band). Set too early and
 * the bar's left end is behind the band, so the direction of each answer is
 * the thing under test: stuck only when the sentinel has gone off the *top*.
 *
 * jsdom has no IntersectionObserver, so this hands the watcher one and plays
 * its entries. Whether the bar then moves is a stylesheet fact
 * (tests/crumbs-narrow.test.ts) and a browser one
 * (docs/plans/261004a-headings-rail-uses-the-width-above-the-mode-band.md).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { watchBarStuck } = await import("../src/web/scroll.js");

type Callback = (entries: Pick<IntersectionObserverEntry, "isIntersecting" | "boundingClientRect">[]) => void;

let observers: { callback: Callback; observed: Element[]; disconnected: boolean }[] = [];
const realObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  observers = [];
  class FakeObserver {
    private readonly record: (typeof observers)[number];
    constructor(callback: Callback) {
      this.record = { callback, observed: [], disconnected: false };
      observers.push(this.record);
    }
    observe(el: Element) {
      this.record.observed.push(el);
    }
    disconnect() {
      this.record.disconnected = true;
    }
  }
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  globalThis.IntersectionObserver = realObserver;
  delete document.documentElement.dataset.barStuck;
});

/** Play one entry: is the sentinel in the window, and where is its top. */
function play(isIntersecting: boolean, top: number) {
  const o = observers[0];
  if (!o) throw new Error("no observer was created");
  o.callback([{ isIntersecting, boundingClientRect: { top } as DOMRectReadOnly }]);
}

describe("watchBarStuck", () => {
  it("watches the sentinel it is given", () => {
    const sentinel = document.createElement("div");
    const stop = watchBarStuck(sentinel);
    expect(observers.length).toBe(1);
    expect(observers[0]?.observed).toEqual([sentinel]);
    stop();
  });

  it("says stuck once the sentinel has left by the top, and takes it back", () => {
    const stop = watchBarStuck(document.createElement("div"));
    play(true, 120);
    expect(document.documentElement.dataset.barStuck).toBeUndefined();
    play(false, -1);
    expect(document.documentElement.dataset.barStuck).toBe("");
    play(true, 0);
    expect(document.documentElement.dataset.barStuck).toBeUndefined();
    stop();
  });

  it("does not say stuck for a sentinel that is out of the window below it", () => {
    const stop = watchBarStuck(document.createElement("div"));
    play(false, 2000);
    expect(document.documentElement.dataset.barStuck).toBeUndefined();
    stop();
  });

  it("clears the attribute and stops watching on teardown", () => {
    const stop = watchBarStuck(document.createElement("div"));
    play(false, -40);
    expect(document.documentElement.dataset.barStuck).toBe("");
    stop();
    expect(document.documentElement.dataset.barStuck).toBeUndefined();
    expect(observers[0]?.disconnected).toBe(true);
  });

  /* `disconnect()` does not drop entries already queued, so one can arrive
     after teardown, with nothing left to clear what it sets. */
  it("ignores an entry delivered after teardown", () => {
    const stop = watchBarStuck(document.createElement("div"));
    stop();
    play(false, -40);
    expect(document.documentElement.dataset.barStuck).toBeUndefined();
  });

  it("does nothing where there is no IntersectionObserver", () => {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    const stop = watchBarStuck(document.createElement("div"));
    expect(observers.length).toBe(0);
    stop();
    expect(document.documentElement.dataset.barStuck).toBeUndefined();
  });
});
