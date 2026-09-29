/**
 * **The route as a sparkline** — src/web/route-spark.ts (plan 260929f § 2).
 */
import { describe, expect, it } from "vitest";
import { sparkline, sparkWidth } from "../src/web/route-spark.js";

const BOX = { width: 100, height: 24, pad: 4 };

describe("the route sparkline", () => {
  it("puts one dot per stop, left to right, at its height in the article", () => {
    const { dots, runs } = sparkline([0, 1, 0.5], BOX);
    expect(dots).toEqual([
      { index: 0, x: 4, y: 4 },
      { index: 1, x: 50, y: 20 },
      { index: 2, x: 96, y: 12 },
    ]);
    expect(runs).toEqual(["4,4 50,20 96,12"]);
  });

  it("breaks the line at a stop with no position, and draws no dot for it (Sol F7)", () => {
    const { dots, runs } = sparkline([0, null, 0.5, 1], BOX);
    expect(dots.map((d) => d.index)).toEqual([0, 2, 3]);
    /* A lone dot before the gap is no line; the two after it are one. */
    expect(runs).toHaveLength(1);
    expect(runs[0]!.split(" ")).toHaveLength(2);
  });

  it("centres a single stop, and clamps a position outside 0–1", () => {
    expect(sparkline([2], BOX).dots).toEqual([{ index: 0, x: 50, y: 20 }]);
  });

  it("is six pixels a stop, within bounds", () => {
    expect([sparkWidth(1), sparkWidth(10), sparkWidth(36)]).toEqual([40, 60, 72]);
  });
});
