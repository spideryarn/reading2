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

const { abandonScroll, arrivalAnchor, scrollToBlock, scrollToTop, watchBarVisibility } = await import(
  "../src/web/scroll.js"
);
type ScrollOutcome = import("../src/web/scroll.js").ScrollOutcome;

let frames: FrameRequestCallback[] = [];
let now = 0;
const realNow = performance.now;
const realMatchMedia = window.matchMedia;
let started = 0;
let scrolls: number[] = [];

function flush(t: number) {
  now = started + t;
  const queued = frames;
  frames = [];
  for (const cb of queued) cb(now);
}

/**
 * Each row's top **in the document**, which a test may move — the way the
 * Skim door leaving the row above does. `getBoundingClientRect` answers
 * relative to the viewport, as a browser's does, so it moves as the page
 * scrolls. (It used to return a constant, which only worked while the target
 * was measured exactly once.)
 */
const docTop = new Map<string, number>();

function row(id: string, top: number): void {
  const tr = document.createElement("tr");
  tr.setAttribute("data-block", id);
  docTop.set(id, top);
  tr.getBoundingClientRect = () => {
    const t = (docTop.get(id) ?? 0) - window.scrollY;
    return { top: t, bottom: t + 20, height: 20 } as DOMRect;
  };
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
    scrolls.push(o.top);
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
  scrolls = [];
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

  it("moves at once for an instant move, and settles after one re-check", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "auto", done);
    expect(window.scrollY, "the move itself is not deferred").toBe(4000);
    expect(outcomes, "settled waits for the post-commit re-check").toEqual([]);
    flush(16);
    expect(outcomes).toEqual(["settled"]);
    expect(scrolls, "an unchanged target does not cause a second jump").toEqual([4000]);
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
    expect(window.scrollY, "no glide: the move is instant").toBe(4000);
    flush(16);
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

/**
 * **A glide aims at the element, not at the pixel it was at when asked.**
 *
 * Skim's "Next stop ›" door hangs inside the *current* stop's row. A
 * press measured the next stop's row at click time, and only then did React
 * move the door to the new row — so when the next stop was below, ~75px of door
 * vanished from above the target after it was measured, and the fixed-pixel
 * glide overshot by exactly that: the quote cut off under the top edge. Any
 * shift above the target during the travel — an image loading, a band opening
 * — is the same bug. docs/postmortems/260928c-a-scroll-aimed-at-a-pixel-not-at-the-element.md.
 */
describe("scrollToBlock re-aims while it travels", () => {
  it("lands on the row when the layout above it shifts before the first frame", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    docTop.set("spya-far", 3925); // the door leaves the row above, post-commit
    flush(50);
    flush(250);
    expect(outcomes).toEqual(["settled"]);
    expect(window.scrollY).toBe(3925);
  });

  it("lands on the row when something above it grows mid-glide", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    flush(50);
    docTop.set("spya-far", 4300); // an image above it loads
    flush(100);
    flush(250);
    expect(outcomes).toEqual(["settled"]);
    expect(window.scrollY).toBe(4300);
  });

  it("corrects an instant move after the commit, and only then says settled", () => {
    window.matchMedia = ((q: string) =>
      ({ matches: q.includes("reduce") }) as MediaQueryList) as typeof window.matchMedia;
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    docTop.set("spya-far", 3925);
    expect(outcomes, "not settled on a position measured before the commit").toEqual([]);
    flush(16);
    expect(window.scrollY).toBe(3925);
    expect(outcomes).toEqual(["settled"]);
    expect(scrolls, "the second jump exists only because the target moved").toEqual([4000, 3925]);
  });

  it("still stops dead for the reader's wheel after re-aiming", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    docTop.set("spya-far", 3925);
    flush(50);
    const at = window.scrollY;
    window.dispatchEvent(new Event("wheel"));
    flush(250);
    expect(outcomes).toEqual(["cancelled"]);
    expect(window.scrollY, "no frame after the wheel").toBe(at);
  });

  it("re-finds a row React replaces during the glide", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    document.querySelector('[data-block="spya-far"]')?.remove();
    row("spya-far", 4300);
    flush(250);
    expect(outcomes).toEqual(["settled"]);
    expect(window.scrollY).toBe(4300);
  });

  it("does not call a stale pixel settled when the row disappears", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    flush(50);
    document.querySelector('[data-block="spya-far"]')?.remove();
    flush(250);
    expect(outcomes).toEqual(["missing"]);
  });

  it("re-clamps against the page's current height", () => {
    docTop.set("spya-far", 19_000);
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    flush(50);
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 5000,
      configurable: true,
    });
    flush(250);
    expect(outcomes).toEqual(["settled"]);
    expect(window.scrollY).toBe(4100);
  });

  it("chases a moving row only for the bounded glide", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done);
    flush(50);
    docTop.set("spya-far", 4100);
    flush(100);
    docTop.set("spya-far", 4200);
    flush(150);
    docTop.set("spya-far", 4300);
    flush(250);
    expect(outcomes).toEqual(["settled"]);
    expect(window.scrollY).toBe(4300);

    docTop.set("spya-far", 4500);
    flush(500);
    expect(window.scrollY, "a shift after arrival is not chased").toBe(4300);
  });
});

/**
 * **A centred jump, and the arrival it leaves** — plan 260929a § 3, GPT Sol F1
 * and F2. Rows are 20px tall in a 900px window with no bars, so a centred row
 * sits 440px down: `spya-far` (at 4000) lands at 3560.
 */
describe("a centred jump", () => {
  it("lands the row in the middle of the window, and leaves an anchor while the reader stays", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-far", "smooth", done, { align: "centre" });
    flush(250);
    expect(outcomes).toEqual(["settled"]);
    expect(window.scrollY).toBe(3560);
    expect(arrivalAnchor()).toEqual({ id: "spya-far", passage: undefined });
    /* The glide's own trailing scroll event is inside its quiet window. */
    window.dispatchEvent(new Event("scroll"));
    expect(arrivalAnchor(), "our own last frame is not the reader leaving").not.toBeNull();
    /* The reader scrolling, afterwards, ends it. */
    now = started + 1000;
    window.dispatchEvent(new Event("scroll"));
    expect(arrivalAnchor()).toBeNull();
  });

  it("gives the anchor up when the reader scrolls during the glide's trailing quiet window", () => {
    scrollToBlock("spya-far", "smooth", undefined, { align: "centre" });
    flush(250);
    expect(arrivalAnchor()).not.toBeNull();

    /* Still inside the 150ms retained for the glide's delayed scroll event —
       but this event arrived at a different pixel, so it is the reader. */
    Object.defineProperty(window, "scrollY", { value: 3610, writable: true, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    expect(arrivalAnchor()).toBeNull();
  });

  it("lets the controls bar answer a reader scroll during that quiet window", () => {
    const stopWatching = watchBarVisibility();
    try {
      scrollToBlock("spya-far", "smooth", undefined, { align: "centre" });
      flush(250);
      /* The glide's own delayed event changes no pixel and stays quiet. */
      window.dispatchEvent(new Event("scroll"));
      flush(251);
      expect(document.documentElement.dataset.bars).toBeUndefined();

      /* The reader moves more than BAR_HIDE_AFTER before the window expires. */
      Object.defineProperty(window, "scrollY", { value: 3610, writable: true, configurable: true });
      window.dispatchEvent(new Event("scroll"));
      flush(252);
      expect(document.documentElement.dataset.bars).toBe("hidden");
    } finally {
      stopWatching();
    }
  });

  it("gives the anchor up to the next movement of any kind", () => {
    scrollToBlock("spya-far", "smooth", undefined, { align: "centre" });
    flush(250);
    expect(arrivalAnchor()).not.toBeNull();
    started = now;
    scrollToBlock("spya-here", "smooth");
    expect(arrivalAnchor()).toBeNull();
  });

  it("keeps the anchor when abandonScroll has no movement to abandon", () => {
    scrollToBlock("spya-far", "smooth", undefined, { align: "centre" });
    flush(250);
    expect(arrivalAnchor()).not.toBeNull();
    abandonScroll();
    expect(arrivalAnchor()).not.toBeNull();
  });

  it("drops an anchor whose block is no longer in the article", () => {
    scrollToBlock("spya-far", "smooth", undefined, { align: "centre" });
    flush(250);
    document.querySelector('[data-block="spya-far"]')?.remove();
    expect(arrivalAnchor()).toBeNull();
  });

  it("leaves no anchor for a top-aligned movement", () => {
    scrollToBlock("spya-far", "smooth");
    flush(250);
    expect(window.scrollY).toBe(4000);
    expect(arrivalAnchor()).toBeNull();
  });

  it("does not settle at once on a passage whose marks are not drawn yet — it takes the corrective frame (Sol F2)", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-here", "smooth", done, { align: "centre", passage: "q:spya-here:0" });
    expect(outcomes, "no distance, but the aim was provisional").toEqual([]);
    flush(16);
    expect(outcomes).toEqual(["settled"]);
    expect(arrivalAnchor()).toEqual({ id: "spya-here", passage: "q:spya-here:0" });
  });

  it("still settles at once with no distance and nothing provisional", () => {
    const { outcomes, done } = recorder();
    scrollToBlock("spya-here", "smooth", done, { align: "centre" });
    expect(outcomes).toEqual(["settled"]);
  });
});
