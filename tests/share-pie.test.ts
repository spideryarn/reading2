/**
 * The small pie's geometry — src/web/SharePie.tsx § `pieSlice`.
 * docs/plans/261003e-quiz-read-so-far-as-a-small-pie-chart.md.
 */
import { describe, expect, it } from "vitest";
import { pieSlice } from "../src/web/SharePie.js";

const R = 6;

describe("pieSlice", () => {
  it("draws nothing for none, or for a share that is not a finite number", () => {
    expect(pieSlice(0, R)).toEqual({ kind: "none" });
    expect(pieSlice(-0.2, R)).toEqual({ kind: "none" });
    expect(pieSlice(Number.NaN, R)).toEqual({ kind: "none" });
    expect(pieSlice(Number.POSITIVE_INFINITY, R)).toEqual({ kind: "none" });
    expect(pieSlice(Number.NEGATIVE_INFINITY, R)).toEqual({ kind: "none" });
  });

  it("draws a whole disc only for all of it", () => {
    expect(pieSlice(1, R)).toEqual({ kind: "full" });
    expect(pieSlice(1.5, R)).toEqual({ kind: "full" });
  });

  it("starts at twelve o'clock and goes clockwise: a quarter ends at three", () => {
    expect(pieSlice(0.25, R)).toEqual({ kind: "slice", d: "M0 0 L0 -6 A6 6 0 0 1 6 0 Z" });
  });

  it("flips the large-arc flag only past half", () => {
    expect(pieSlice(0.5, R)).toEqual({ kind: "slice", d: "M0 0 L0 -6 A6 6 0 0 1 0 6 Z" });
    expect(pieSlice(0.75, R)).toEqual({ kind: "slice", d: "M0 0 L0 -6 A6 6 0 1 1 -6 0 Z" });
  });

  it("draws the exact share at the edges, never rounded to none or all", () => {
    expect(pieSlice(0.001, R)).toEqual({
      kind: "slice",
      d: "M0 0 L0 -6 A6 6 0 0 1 0.037699 -5.999882 Z",
    });
    expect(pieSlice(0.999, R)).toEqual({
      kind: "slice",
      d: "M0 0 L0 -6 A6 6 0 1 1 -0.037699 -5.999882 Z",
    });

    /* Three-decimal coordinates used to round both of these endpoints back to
       0,-6. SVG omits an arc whose start and end coincide, so the first drew
       none (unsurprising) and the second also drew none — nearly all looked
       like nothing. These are plausible one-word edges in a long piece. */
    expect(pieSlice(0.000001, R)).toEqual({
      kind: "slice",
      d: "M0 0 L0 -6 A6 6 0 0 1 0.000038 -6 Z",
    });
    expect(pieSlice(0.999999, R)).toEqual({
      kind: "slice",
      d: "M0 0 L0 -6 A6 6 0 1 1 -0.000038 -6 Z",
    });
  });
});
