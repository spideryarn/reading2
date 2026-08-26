/**
 * The arithmetic behind "scroll the panel to the row the reader is on".
 *
 * All of it is `followDelta`, and it is a separate function from the hook for
 * one reason: the two things that can be wrong here are *how far* and *when*,
 * and only the first is testable without a browser. The second — that the panel
 * moves when the target changes and never because the reader touched it — is a
 * property of the effect's dependency list, and is checked in a browser.
 *
 * The case worth naming is the last one. A row taller than the panel cannot be
 * shown whole, and the tempting implementation ("scroll until the bottom is in
 * view") silently pushes the title off the top — which is the half a reader
 * needs. See src/web/follow.ts.
 */
import { describe, expect, it } from "vitest";
import { comfort, followDelta } from "../src/web/follow.js";

/** A panel 400px tall, sitting 100px down the viewport. */
const BOX = { top: 100, bottom: 500 };
const M = 40;

describe("followDelta", () => {
  it("does not move a row that is comfortably in view", () => {
    expect(followDelta(BOX, { top: 200, bottom: 260 }, M)).toBe(0);
  });

  it("scrolls up to bring back a row above the top", () => {
    // Negative: `scrollTop` decreases, the content moves down.
    expect(followDelta(BOX, { top: 20, bottom: 80 }, M)).toBe(-120);
  });

  it("scrolls down to bring in a row below the bottom", () => {
    expect(followDelta(BOX, { top: 520, bottom: 560 }, M)).toBe(100);
  });

  it("counts the margin as out of view, so a row never hugs an edge", () => {
    /* A row sitting on the very bottom edge is technically visible and
       useless: the next section's title, which is what a reader moving
       forwards is about to want, is off the bottom. */
    expect(followDelta(BOX, { top: 430, bottom: 470 }, M)).toBeGreaterThan(0);
    expect(followDelta(BOX, { top: 110, bottom: 150 }, M)).toBeLessThan(0);
  });

  it("keeps the top of a too-tall row rather than its bottom", () => {
    /* 600px of row in 400px of panel. Scrolling until the bottom cleared the
       margin would put the title 260px above the panel — the reader would be
       looking at the tail of a summary with no idea whose it is. The clamp
       lands the top on its margin instead. */
    const target = { top: 300, bottom: 900 };
    const delta = followDelta(BOX, target, M);
    expect(delta).toBe(160); // top 300 → 140, which is BOX.top + M
    expect(target.top - delta).toBe(BOX.top + M);
  });
});

describe("comfort", () => {
  it("is a share of a short panel and a fixed strip of a tall one", () => {
    /* Both halves matter. A fixed 72px in a 200px panel is most of what the
       reader can see; 25% of a 900px panel is a third of the way down, and
       every step would be a long slide. */
    expect(comfort(200)).toBe(50);
    expect(comfort(900)).toBe(72);
  });

  it("always leaves room for the row itself", () => {
    for (const h of [0, 60, 200, 400, 1200]) expect(comfort(h) * 2).toBeLessThanOrEqual(h || 0);
  });
});
