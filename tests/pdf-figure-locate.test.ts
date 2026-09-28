/**
 * src/pdf-figure-locate.ts — `judgeLocatedBox`, the rule a model's answer has
 * to pass before a picture is attached to a caption on the model's say-so.
 * Stage 2 of docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md.
 *
 * Plain boxes, no PDF: the real documents are in tests/collect-pdf-figures.test.ts.
 */
import { describe, expect, it } from "vitest";

import { judgeLocatedBox, type LocateInput } from "../src/pdf-figure-locate.js";
import type { ImagePaint } from "../src/pdf-figure-paint.js";

/** An A4 page whose origin is (0, 0). */
const A4 = { x0: 0, y0: 0, x1: 600, y1: 800 };

function paint(page: number, key: string | null, box: ImagePaint["box"], over: Partial<ImagePaint> = {}) {
  return {
    page,
    op: key ? ("xobject" as const) : ("other" as const),
    key,
    box,
    clip: A4,
    clipExact: true,
    appearanceExact: true,
    ...over,
  };
}

/**
 * box_2d is [ymin, xmin, ymax, xmax] from the top left, 0–1000. This turns a
 * box in points on `view` into that, so the tests can speak in points.
 */
function box2d(view: typeof A4, b: { x0: number; y0: number; x1: number; y1: number }): number[] {
  const w = view.x1 - view.x0;
  const h = view.y1 - view.y0;
  return [
    Math.round(((view.y1 - b.y1) / h) * 1000),
    Math.round(((b.x0 - view.x0) / w) * 1000),
    Math.round(((view.y1 - b.y0) / h) * 1000),
    Math.round(((b.x1 - view.x0) / w) * 1000),
  ];
}

/** Page 2 holds one picture, `fig`, in its top half. */
function onePicture(over: Partial<LocateInput> = {}): LocateInput {
  return {
    answer: { page: 2, box_2d: box2d(A4, { x0: 60, y0: 500, x1: 400, y1: 740 }) },
    sent: [
      { page: 1, view: A4 },
      { page: 2, view: A4 },
      { page: 3, view: A4 },
    ],
    usable: [{ page: 2, key: "fig", identity: "id-fig" }],
    blank: [],
    paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 })],
    taken: [],
    ...over,
  };
}

describe("judgeLocatedBox", () => {
  it("chooses the one picture the box lies inside", () => {
    expect(judgeLocatedBox(onePicture())).toEqual({ status: "chosen", page: 2, key: "fig", identity: "id-fig" });
  });

  it("chooses it when the box is only the chart part of a picture with a panel beside it", () => {
    /* Measured on the essay: the model boxes 57–73% of a diagram whose text
       panel it leaves out. The stored thing is the whole picture, so what
       matters is which picture the box points at. */
    const answer = { page: 2, box_2d: box2d(A4, { x0: 55, y0: 530, x1: 380, y1: 755 }) };
    expect(judgeLocatedBox(onePicture({ answer }))).toMatchObject({ status: "chosen", key: "fig" });
  });

  it("refuses when the model says no figure has this caption", () => {
    expect(judgeLocatedBox(onePicture({ answer: { page: null, box_2d: null } }))).toEqual({
      status: "refused",
      reason: "model-found-none",
    });
  });

  it("refuses an answer that is not the shape asked for", () => {
    for (const answer of [null, "page 2", { page: 2 }, { page: 2, box_2d: [1, 2, 3] }, { page: "2", box_2d: [1, 2, 3, 4] }]) {
      expect(judgeLocatedBox(onePicture({ answer }))).toEqual({ status: "refused", reason: "unreadable-answer" });
    }
  });

  it("refuses a box out of range or inside out", () => {
    for (const box_2d of [
      [-5, 100, 300, 600],
      [100, 100, 300, 1001],
      [300, 100, 100, 600],
      [100, 600, 300, 100],
      [100, 100, 100, 600],
    ]) {
      expect(judgeLocatedBox(onePicture({ answer: { page: 2, box_2d } }))).toEqual({ status: "refused", reason: "bad-box" });
    }
  });

  it("refuses a page it was not shown", () => {
    const answer = { page: 7, box_2d: box2d(A4, { x0: 60, y0: 500, x1: 400, y1: 740 }) };
    expect(judgeLocatedBox(onePicture({ answer }))).toEqual({ status: "refused", reason: "page-not-sent" });
  });

  it("refuses a box on a page with no picture — the vector figure v1 does not take", () => {
    const answer = { page: 3, box_2d: box2d(A4, { x0: 60, y0: 500, x1: 400, y1: 740 }) };
    expect(judgeLocatedBox(onePicture({ answer }))).toEqual({ status: "refused", reason: "not-one-picture" });
  });

  it("refuses a box that lies mostly outside the picture", () => {
    const answer = { page: 2, box_2d: box2d(A4, { x0: 60, y0: 100, x1: 400, y1: 600 }) };
    expect(judgeLocatedBox(onePicture({ answer }))).toEqual({ status: "refused", reason: "not-one-picture" });
  });

  it("refuses a box that is a sliver of a large picture", () => {
    const answer = { page: 2, box_2d: box2d(A4, { x0: 60, y0: 700, x1: 120, y1: 740 }) };
    expect(judgeLocatedBox(onePicture({ answer }))).toEqual({ status: "refused", reason: "not-one-picture" });
  });

  it("refuses a box that reaches into a second picture", () => {
    /* Panels of a composite figure are separately painted pictures; a box
       around the figure covers several, and storing one panel as the figure
       would be a wrong picture. */
    const panels = onePicture({
      answer: { page: 2, box_2d: box2d(A4, { x0: 60, y0: 300, x1: 540, y1: 740 }) },
      usable: [
        { page: 2, key: "fig", identity: "id-fig" },
        { page: 2, key: "panel-b", identity: "id-b" },
      ],
      paints: [paint(2, "fig", { x0: 50, y0: 400, x1: 550, y1: 760 }), paint(2, "panel-b", { x0: 50, y0: 290, x1: 550, y1: 390 })],
    });
    expect(judgeLocatedBox(panels)).toEqual({ status: "refused", reason: "not-one-picture" });

  });

  it("refuses a page carrying any image it cannot place — an inline image, a mask, a repeat", () => {
    /* One keyless paint is recorded per such operator at the transform's unit
       square, which is not where a repeat's placements are; so the page's
       pictures are not fully known, and neither is what else the box holds.
       GPT Sol, stage 2 plan review, finding 4. */
    const elsewhere = onePicture({
      paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 }), paint(2, null, { x0: 300, y0: 60, x1: 420, y1: 100 })],
    });
    expect(judgeLocatedBox(elsewhere)).toEqual({ status: "refused", reason: "unmeasured-image" });
  });

  it("refuses an unplaceable image even when its placeholder box appears off-page", () => {
    /* Repeat/group operators do not carry their real placements in the unit
       square recorded by the interpreter. An off-page placeholder therefore
       cannot prove the repeated images themselves are off-page. */
    const unknownPlacement = onePicture({
      paints: [
        paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 }),
        paint(2, null, { x0: -200, y0: -200, x1: -100, y1: -100 }),
      ],
    });
    expect(judgeLocatedBox(unknownPlacement)).toEqual({ status: "refused", reason: "unmeasured-image" });
  });

  it("refuses a picture whose appearance a mask or blend changed", () => {
    const masked = onePicture({ paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 }, { appearanceExact: false })] });
    expect(judgeLocatedBox(masked)).toEqual({ status: "refused", reason: "unmeasured-image" });
  });

  it("does not choose a picture clipped away entirely", () => {
    const gone = onePicture({ paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 }, { clip: null })] });
    expect(judgeLocatedBox(gone)).toEqual({ status: "refused", reason: "not-one-picture" });
  });

  it("refuses a picture the size of the page — a background or a scan, never a figure", () => {
    const answer = { page: 2, box_2d: box2d(A4, { x0: 100, y0: 200, x1: 500, y1: 700 }) };
    const background = onePicture({ answer, paints: [paint(2, "fig", { x0: 0, y0: 0, x1: 600, y1: 800 })] });
    expect(judgeLocatedBox(background)).toEqual({ status: "refused", reason: "background" });
  });

  it("refuses a picture that sits against another — a panel of a composite, not the figure", () => {
    /* A tight box around panel A of a four-panel figure passes every rule
       about the box, and would store panel A under the whole figure's caption.
       Panels touch or nearly do; the essay's second picture on a page is
       prose away. GPT Sol, stage 2 plan review, finding 2. */
    const panels = onePicture({
      usable: [
        { page: 2, key: "fig", identity: "id-fig" },
        { page: 2, key: "panel-b", identity: "id-b" },
      ],
      paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 }), paint(2, "panel-b", { x0: 50, y0: 300, x1: 550, y1: 474 })],
    });
    expect(judgeLocatedBox(panels)).toEqual({ status: "refused", reason: "assembly" });

    const apart = onePicture({
      usable: [
        { page: 2, key: "fig", identity: "id-fig" },
        { page: 2, key: "other", identity: "id-other" },
      ],
      paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 }), paint(2, "other", { x0: 50, y0: 60, x1: 550, y1: 300 })],
    });
    expect(judgeLocatedBox(apart)).toMatchObject({ status: "chosen", key: "fig" });
  });

  it("ignores a blank overlay painted over the picture", () => {
    /* The analog-cognition paper paints a fully transparent image over every
       figure; `classifyRaster` calls it blank and the pairing ignores it. */
    const overlaid = onePicture({
      blank: [{ page: 2, key: "overlay" }],
      paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 }), paint(2, "overlay", { x0: 0, y0: 0, x1: 600, y1: 800 })],
    });
    expect(judgeLocatedBox(overlaid)).toMatchObject({ status: "chosen", key: "fig" });
  });

  it("refuses a picture painted twice on the page", () => {
    const twice = onePicture({
      paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 }), paint(2, "fig", { x0: 50, y0: 50, x1: 550, y1: 330 })],
    });
    expect(judgeLocatedBox(twice)).toEqual({ status: "refused", reason: "painted-twice" });
  });

  it("takes a picture cut only near the page edge, and refuses one the page crops inside", () => {
    /* The essay's wide figures run off the right of the printed page, and
       Chrome clips them to its print frame — measured on page 2, the clip's
       right edge is 10 pt inside the page's. The embedded picture is the
       author's whole figure. A clip that cuts well inside the page means the
       page showed part of the picture on purpose. */
    const offEdge = onePicture({ paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 700, y1: 760 })] });
    expect(judgeLocatedBox(offEdge)).toMatchObject({ status: "chosen", key: "fig" });

    const printFrame = onePicture({
      paints: [paint(2, "fig", { x0: 75, y0: 480, x1: 650, y1: 760 }, { clip: { x0: 10, y0: 25, x1: 590, y1: 790 } })],
    });
    expect(judgeLocatedBox(printFrame)).toMatchObject({ status: "chosen", key: "fig" });

    const cropped = onePicture({
      paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 }, { clip: { x0: 50, y0: 480, x1: 420, y1: 760 } })],
    });
    expect(judgeLocatedBox(cropped)).toEqual({ status: "refused", reason: "clipped" });

    const unknown = onePicture({
      paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 }, { clipExact: false })],
    });
    expect(judgeLocatedBox(unknown)).toEqual({ status: "refused", reason: "clipped" });
  });

  it("refuses a picture another figure already has, by what it is rather than what pdf.js called it", () => {
    /* The same image can be painted on two pages, or embedded twice under two
       keys; comparing keys would give it to two captions. GPT Sol, finding 5. */
    expect(judgeLocatedBox(onePicture({ taken: ["id-fig"] }))).toEqual({ status: "refused", reason: "already-taken" });
    expect(judgeLocatedBox(onePicture({ taken: ["id-something-else"] }))).toMatchObject({ status: "chosen" });
  });

  it("reads the box against the page's own origin when the page is cropped", () => {
    /* The ball-lightning paper's pages start at (8.5, 8.5). PDFium renders the
       crop, so box_2d is a fraction of the crop, not of a page from (0, 0). */
    const cropped = { x0: 8.5, y0: 8.5, x1: 603.8, y1: 793.7 };
    const input = onePicture({
      sent: [{ page: 2, view: cropped }],
      answer: { page: 2, box_2d: box2d(cropped, { x0: 60, y0: 500, x1: 400, y1: 740 }) },
      paints: [paint(2, "fig", { x0: 50, y0: 480, x1: 550, y1: 760 }, { clip: cropped })],
    });
    expect(judgeLocatedBox(input)).toMatchObject({ status: "chosen", key: "fig" });
  });
});
