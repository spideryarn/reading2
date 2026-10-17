/**
 * **The stops: the threshold values at which the list on screen changes** —
 * src/web/threshold.ts § the stops.
 *
 * Greg, 2026-10-17 (spya-t80rep): *"changing the threshold value when it has no
 * effect on the number that pass the filter isn't that helpful. I'd rather
 * that, as I slide it, it jumps to the values that will affect the number of
 * results shown."* Every assertion here is checked against `applyThreshold`
 * itself — a stop that does not change the visible count is the bug.
 *
 * docs/plans/261017f-threshold-sliders-jump-between-the-values-that-change-the-count.md.
 */
import { describe, expect, it } from "vitest";
import {
  applyThreshold,
  floorToGateStep,
  nearestStop,
  stepToStop,
  thresholdStops,
} from "../src/web/threshold.js";

const scoreOf = (n: number | null | undefined) => n;
const shown = (items: (number | null)[], t: number) => applyThreshold(items, t, scoreOf).visible.length;

describe("thresholdStops", () => {
  it("is the distinct scores, ascending, with the unscored left out", () => {
    expect(thresholdStops([0.5, null, 0.2, 0.5, 0.9], scoreOf)).toEqual([0.2, 0.5, 0.9]);
  });

  it("floors onto the grid when given one, so an item survives its own stop", () => {
    /* 0.8 × 0.8 is 0.6400000000000001; the stop has to be 0.64, and the item
       has to survive it. */
    const items = [0.8 * 0.8, 0.581, 0.589];
    const stops = thresholdStops(items, scoreOf, floorToGateStep);
    expect(stops).toEqual([0.58, 0.64]);
    for (const s of stops) expect(applyThreshold(items, s, scoreOf).visible.length).toBeGreaterThan(0);
  });

  it("is empty when nothing is scored", () => {
    expect(thresholdStops([null, undefined], scoreOf)).toEqual([]);
  });

  it("every stop shows a different count from its neighbours", () => {
    const items = [0.1, 0.1, 0.3, 0.35, 0.7, null];
    const stops = thresholdStops(items, scoreOf);
    const counts = stops.map((s) => shown(items, s));
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThan(counts[i - 1]!);
  });
});

describe("stepToStop", () => {
  const items = [0.2, 0.5, 0.9];
  const stops = [0.2, 0.5, 0.9];

  it("moves up to the next stop that changes the list, from a stop", () => {
    expect(stepToStop(stops, 0.2, 1)).toBe(0.5);
    expect(stepToStop(stops, 0.5, 1)).toBe(0.9);
  });

  it("from between two stops, skips the one that would change nothing", () => {
    /* At 0.3 the list is "≥ 0.5" already. Going to 0.5 would leave it as it
       is — the exact complaint — so up goes to 0.9. */
    const next = stepToStop(stops, 0.3, 1);
    expect(next).toBe(0.9);
    expect(shown(items, next)).toBeLessThan(shown(items, 0.3));
    expect(shown(items, 0.5)).toBe(shown(items, 0.3));
  });

  it("moves down to the largest stop below, from a stop or between two", () => {
    expect(stepToStop(stops, 0.9, -1)).toBe(0.5);
    expect(stepToStop(stops, 0.6, -1)).toBe(0.5);
    expect(shown(items, 0.5)).toBeGreaterThan(shown(items, 0.6));
  });

  it("stays put past either end", () => {
    expect(stepToStop(stops, 0.9, 1)).toBe(0.9);
    expect(stepToStop(stops, 0.95, 1)).toBe(0.95);
    expect(stepToStop(stops, 0.2, -1)).toBe(0.2);
    expect(stepToStop(stops, 0.1, -1)).toBe(0.1);
  });

  it("from below the lowest stop, up skips the lowest (it shows the same list)", () => {
    expect(stepToStop(stops, 0.1, 1)).toBe(0.5);
  });

  it("from above the top stop, down comes back to the top", () => {
    expect(stepToStop(stops, 0.95, -1)).toBe(0.9);
  });

  it("is unmoved with no stops", () => {
    expect(stepToStop([], 0.3, 1)).toBe(0.3);
  });
});

describe("nearestStop", () => {
  it("snaps to the closer stop, and ties go up", () => {
    expect(nearestStop([0.2, 0.5, 0.9], 0.3)).toBe(0.2);
    expect(nearestStop([0.2, 0.5, 0.9], 0.4)).toBe(0.5);
    expect(nearestStop([0.2, 0.6], 0.4)).toBe(0.6);
    expect(nearestStop([0.2, 0.5, 0.9], 0)).toBe(0.2);
    expect(nearestStop([0.2, 0.5, 0.9], 1)).toBe(0.9);
  });

  it("passes the value through with no stops", () => {
    expect(nearestStop([], 0.37)).toBe(0.37);
  });
});
