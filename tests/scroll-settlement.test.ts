// @vitest-environment jsdom
/**
 * **How a scroll ended** — `scrollToBlock`'s third argument (src/web/scroll.ts).
 *
 * The flash on arrival (docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md,
 * Sol F1) fires only when the reader has really landed. A timer set to
 * `SCROLL_MS` would flash a block the reader's wheel had already carried them
 * away from, so the glide itself reports: `settled` on its last frame (or at
 * once, for an instant move or no distance), `cancelled` when a wheel, a touch
 * or a newer scroll stops it, `missing` when there is no row to go to.
 *
 * Same hand-owned clock and frame queue as tests/scroll-glide.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { abandonScroll, scrollToBlock, scrollToTop } = await import("../src/web/scroll.js");
type ScrollOutcome = import("../src/web/scroll.js").ScrollOutcome;

let frames: FrameRequestCallback[] = [];
let now = 0;
const realNow = performance.now;
const realMatchMedia = window.matchMedia;
let started = 0;

function flush(t: number) {
  now = started + t;
  const queued = frames;
  frames = [];
  for (const cb of queued) cb(now);
}

function row(id: string, top: number): void {
  const tr = document.createElement("tr");
  tr.setAttribute("data-block", id);
  tr.getBoundingClientRect = () => ({ top, height: 20 }) as DOMRect;
  document.querySelector("tbody")?.append(tr);
}

beforeEach(() => {
  frames = [];
  now = 1000;
  started = now;
  performance.now = () => now;
  globalThis.CSS = { escape: (s: string) => s } as unknown as typeof globalThis.CSS;
  document.body.innerHTML = "<table><tbody></tbody></table>";
  row("spya-far", 4000);
  row("spya-here", 0);
  Object.defineProperty(document.documentElement, "scrollHeight", { value: 20_000, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  window.scrollTo = ((o: { top: number }) => {
    Object.defineProperty(window, "scrollY", { value: o.top, writable: true, configurable: true });
  }) as typeof window.scrollTo;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    frames[id - 1] = () => {};
  }) as typeof window.cancelAnimationFrame;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  window.matchMedia = realMatchMedia;
});

afterEach(() => {
  scrollToTop();
  performance.now = realNow;
  window.matchMedia = realMatchMedia;
});

function recorder(): { outcomes: ScrollOutcome[]; done: (o: ScrollOutcome) => void } {
  const outcomes: ScrollOutcome[] = [];
  return { outcomes, done: (o) => void outcomes.push(o) };
}

describe("scrollToBlock says how it ended", () => {
  it("settles on the glide's last frame, and not before", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    flush(50);
    expect(outcomes, "mid-glide is not a landing").toEqual([]);
    flush(250);
    expect(outcomes).toEqual(["settled"]);
    expect(window.scrollY).toBe(4000);
  });

  it("settles at once for an instant move", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "auto", done);
    expect(outcomes).toEqual(["settled"]);
  });

  it("settles at once when there is no distance to cover", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-here", "smooth", done);
    expect(outcomes).toEqual(["settled"]);
    expect(frames).toEqual([]);
  });

  it("settles at once under reduced motion, which never glides", () => {
    window.matchMedia = ((q: string) =>
      ({ matches: q.includes("reduce") }) as MediaQueryList) as typeof window.matchMedia;
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    expect(outcomes).toEqual(["settled"]);
  });

  it("is cancelled by the reader's wheel", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    flush(50);
    window.dispatchEvent(new Event("wheel"));
    flush(500);
    expect(outcomes).toEqual(["cancelled"]);
  });

  it("is cancelled by a touch off a swipe surface", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    document.body.dispatchEvent(new Event("touchstart", { bubbles: true }));
    expect(outcomes).toEqual(["cancelled"]);
  });

  it("is cancelled by a newer scroll, which reports for itself", () => {
    const first = recorder();
    const second = recorder();
    scrollToBlock("spya-far", "smooth", first.done);
    flush(50);
    started = now;
    scrollToBlock("spya-far", "smooth", second.done);
    expect(first.outcomes).toEqual(["cancelled"]);
    flush(300);
    expect(second.outcomes).toEqual(["settled"]);
    expect(first.outcomes, "the first is told once").toEqual(["cancelled"]);
  });

  it("is cancelled by a newer scroll whose target is missing", () => {
    const first = recorder();
    const second = recorder();
    scrollToBlock("spya-far", "smooth", first.done);
    flush(50);
    scrollToBlock("spya-nowhere", "smooth", second.done);
    expect(first.outcomes, "the newer request owns settlement even when it cannot move").toEqual([
      "cancelled",
    ]);
    expect(second.outcomes).toEqual(["missing"]);
    flush(500);
    expect(first.outcomes, "the cancelled frame cannot settle later").toEqual(["cancelled"]);
  });

  it("is cancelled by abandonScroll and by scrollToTop", () => {
    const a = recorder();
    scrollToBlock("spya-far", "smooth", a.done);
    abandonScroll();
    expect(a.outcomes).toEqual(["cancelled"]);
    const b = recorder();
    started = now;
    scrollToBlock("spya-far", "smooth", b.done);
    scrollToTop();
    expect(b.outcomes).toEqual(["cancelled"]);
  });

  it("says missing when the article has no such row", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-nowhere", "smooth", done);
    expect(outcomes).toEqual(["missing"]);
  });

  it("keeps the old two-argument call working", () => {
    scrollToBlock("spya-far");
    flush(300);
    expect(window.scrollY).toBe(4000);
  });
});
