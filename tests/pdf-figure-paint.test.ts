/**
 * src/pdf-figure-paint.ts — the pure interpreter that turns pdf.js's operator
 * list into painted boxes and the counts the region rules decide on (GPT Sol
 * F34, docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md).
 *
 * Driven here with an operator table of its own rather than pdf.js's, so every
 * rule is argued on plain arrays. The real pages it has to agree with are in
 * tests/pdf-figure-page.test.ts and tests/collect-pdf-figures.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  type GraphicsState,
  gStateEntryUnmeasured,
  initialState,
  interpretOperators,
  isRectangle,
  IDENTITY,
  miterFactor,
  multiply,
  type PaintOpCodes,
  strokeExtentFactor,
  transformBox,
} from "../src/pdf-figure-paint.js";

const C: PaintOpCodes = {
  save: 1,
  restore: 2,
  transform: 3,
  paintFormXObjectBegin: 4,
  paintFormXObjectEnd: 5,
  clip: 6,
  eoClip: 7,
  setLineWidth: 8,
  setLineJoin: 9,
  setMiterLimit: 10,
  setGState: 11,
  setStrokeRGBColor: 12,
  setFillRGBColor: 13,
  setStrokeTransparent: 14,
  setFillTransparent: 15,
  constructPath: 16,
  endPath: 17,
  shadingFill: 18,
  stroke: 19,
  closeStroke: 20,
  fill: 21,
  eoFill: 22,
  fillStroke: 23,
  eoFillStroke: 24,
  closeFillStroke: 25,
  closeEOFillStroke: 26,
  paintImageXObject: 27,
  paintImageXObjectRepeat: 28,
  paintInlineImageXObject: 29,
  paintInlineImageXObjectGroup: 30,
  paintImageMaskXObject: 31,
  paintImageMaskXObjectGroup: 32,
  paintImageMaskXObjectRepeat: 33,
  paintSolidColorImageMask: 34,
};

const VIEW = [0, 0, 595, 842];

type Op = [number, unknown[]?];

function run(ops: Op[]) {
  return interpretOperators(
    ops.map((op) => op[0]),
    ops.map((op) => op[1] ?? []),
    C,
    VIEW,
  );
}

/** pdf.js's buffer for `re`: moveTo, three lineTos, closePath. */
function rectBuffer(x0: number, y0: number, x1: number, y1: number): number[] {
  return [0, x0, y0, 1, x1, y0, 1, x1, y1, 1, x0, y1, 4];
}

/** A `constructPath` of a rectangle painted with `paint`. */
function rect(paint: number, x0: number, y0: number, x1: number, y1: number): Op {
  return [C.constructPath, [paint, [rectBuffer(x0, y0, x1, y1)], [x0, y0, x1, y1]]];
}

describe("graphics-state interpretation", () => {
  it("measures a painted path through the current transform", () => {
    const summary = run([[C.transform, [2, 0, 0, 2, 10, 10]], rect(C.fill, 0, 0, 10, 10)]);
    expect(summary.ink).toEqual([{ x0: 10, y0: 10, x1: 30, y1: 30, rect: true }]);
    expect(summary.paths).toBe(1);
    expect(summary.unmeasuredPaint).toBe(0);
  });

  it("restores the transform a `save` kept", () => {
    const summary = run([[C.save], [C.transform, [2, 0, 0, 2, 10, 10]], [C.restore], rect(C.fill, 0, 0, 10, 10)]);
    expect(summary.ink).toEqual([{ x0: 0, y0: 0, x1: 10, y1: 10, rect: true }]);
  });

  it("applies a form's matrix and clips to its bounding box, until the form ends", () => {
    /* A clipped rectangle keeps its rectangle flag — the visible part of a
       closed box is still reported as one. */
    const summary = run([
      [C.paintFormXObjectBegin, [[1, 0, 0, 1, 100, 100], [0, 0, 50, 50]]],
      rect(C.fill, 0, 0, 80, 80),
      [C.paintFormXObjectEnd],
      rect(C.fill, 0, 0, 80, 80),
    ]);
    expect(summary.ink).toEqual([
      { x0: 100, y0: 100, x1: 150, y1: 150, rect: true },
      { x0: 0, y0: 0, x1: 80, y1: 80, rect: true },
    ]);
  });

  it("clips later paint to a rectangular clip, and counts any other clip unmeasured", () => {
    const clipped = run([[C.clip], rect(C.endPath, 0, 0, 100, 100), rect(C.fill, 50, 50, 200, 200)]);
    expect(clipped.ink).toEqual([{ x0: 50, y0: 50, x1: 100, y1: 100, rect: true }]);
    expect(clipped.unmeasuredPaint).toBe(0);
    const triangle = [0, 0, 0, 1, 100, 0, 1, 50, 80, 4];
    const odd = run([[C.clip], [C.constructPath, [C.endPath, [triangle], [0, 0, 100, 80]]]]);
    expect(odd.unmeasuredPaint).toBe(1);
  });

  it("does not count white paint as ink — unless it is an artboard round two drawings", () => {
    const white: Op[] = [[C.setFillRGBColor, ["#FFFFFF"]], rect(C.fill, 0, 0, 300, 300), [C.setFillRGBColor, ["#000000"]]];
    expect(run([...white, rect(C.fill, 10, 10, 20, 20)]).ink).toHaveLength(1);
    expect(run([...white, rect(C.fill, 10, 10, 20, 20), rect(C.fill, 100, 100, 120, 120)]).ink).toHaveLength(3);
  });

  it("counts zero alpha, a soft mask and a blend mode as paint it cannot measure", () => {
    expect(run([[C.setGState, [[["ca", 0]]]]]).unmeasuredPaint).toBe(1);
    expect(run([[C.setGState, [[["SMask", {}]]]]]).unmeasuredPaint).toBe(1);
    expect(run([[C.setGState, [[["BM", "Multiply"]]]]]).unmeasuredPaint).toBe(1);
    expect(run([[C.setGState, [[["ca", 1]]]]]).unmeasuredPaint).toBe(0);
    expect(run([[C.setFillTransparent]]).unmeasuredPaint).toBe(1);
  });

  it("stops reading a `gs` at its first unmeasurable entry, as it always has", () => {
    const state: GraphicsState = initialState(VIEW);
    const entries = [
      ["ca", 0],
      ["LW", 7],
    ];
    expect(entries.some((entry) => gStateEntryUnmeasured(state, entry))).toBe(true);
    expect(state.lineWidth).toBe(1);
  });

  it("measures a thin stroke and refuses one that can reach past the crop's padding", () => {
    expect(run([rect(C.stroke, 10, 10, 100, 100)]).unmeasuredPaint).toBe(0);
    expect(run([[C.setLineWidth, [20]], rect(C.stroke, 10, 10, 100, 100)]).unmeasuredPaint).toBe(1);
    expect(run([[C.setGState, [[["LW", 20]]]], rect(C.stroke, 10, 10, 100, 100)]).unmeasuredPaint).toBe(1);
  });

  it("counts images and shadings rather than boxing them", () => {
    const summary = run([[C.paintImageXObject], [C.paintSolidColorImageMask], [C.shadingFill]]);
    expect([summary.imageOps, summary.shadings, summary.ink.length]).toEqual([2, 1, 0]);
  });
});

describe("path and stroke measurement", () => {
  it("recognises a closed rectangle, and nothing else, as one", () => {
    expect(isRectangle(rectBuffer(0, 0, 10, 20), IDENTITY)).toBe(true);
    expect(isRectangle([0, 0, 0, 1, 10, 0, 1, 5, 8, 4], IDENTITY)).toBe(false);
    expect(isRectangle(rectBuffer(0, 0, 10, 0), IDENTITY)).toBe(false);
    expect(isRectangle(rectBuffer(0, 0, 10, 20), [0, 0, 0, 0, 0, 0])).toBe(false);
  });

  it("gives a right-angle mitre √2 and an acute one more, while under its limit", () => {
    expect(strokeExtentFactor([0, 0, 0, 1, 10, 0, 1, 10, 10], 0, 10)).toBeCloseTo(Math.SQRT2);
    /* A 27° join: its mitre is 1 / sin(13.3°) ≈ 4.3 radii, under a limit of 10. */
    expect(strokeExtentFactor([0, 0, 0, 1, 10, 0, 1, 0, 5], 0, 10)).toBeGreaterThan(4);
    expect(strokeExtentFactor([0, 0, 0, 1, 10, 0, 1, 0, 5], 1, 10)).toBeCloseTo(Math.SQRT2);
    expect(strokeExtentFactor([7, 1, 2], 0, 10)).toBe(10);
  });

  it("bevels a join whose mitre is past the limit", () => {
    expect(miterFactor([10, 0], [-10, 1], 4)).toBeCloseTo(Math.SQRT2);
  });

  it("composes matrices in PDF's order", () => {
    const box = transformBox(multiply([1, 0, 0, 1, 5, 0], [2, 0, 0, 2, 0, 0]), 0, 0, 1, 1);
    expect(box).toEqual({ x0: 5, y0: 0, x1: 7, y1: 2 });
  });
});
