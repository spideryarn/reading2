/**
 * src/pdf-figure-region.ts — which drawing, if any, belongs to a caption on a
 * page that has no picture in it.
 *
 * **Every layout here is synthetic and each test asserts one intention.** The
 * governing rule is 260906a's — *a missing figure is visible, a wrong one is
 * not* — so most of these are refusals, and the ones that are not are the
 * shapes docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md says the
 * route exists for. The real pages (MDPI p8, arXiv p2 and p3) are exercised
 * end to end in tests/collect-pdf-figures.test.ts; this file is where the
 * adversarial layouts GPT Sol listed live (F1, F11–F13), because no committed
 * PDF has them.
 *
 * Coordinates are PDF points with the origin at the bottom left, exactly as
 * pdf.js hands them back: bigger y is higher up the page.
 */
import { describe, expect, it } from "vitest";

import {
  ADMIT_DISCONNECTED_DRAWINGS,
  type DrawnFigureInput,
  type InkBox,
  locateDrawnFigure,
  MAX_INK_COMPONENTS,
  MAX_PAGE_OPERATORS,
  MAX_PAGE_PATHS,
  type PageLayout,
  type PageTextItem,
} from "../src/pdf-figure-region.js";

const A4: [number, number, number, number] = [0, 0, 595, 842];

/** A run of upright text. Width defaults to something plausible for the size. */
function text(str: string, x: number, y: number, opts: { size?: number; width?: number } = {}): PageTextItem {
  const size = opts.size ?? 9;
  return { str, transform: [size, 0, 0, size, x, y], width: opts.width ?? str.length * size * 0.45, height: size };
}

function ink(x0: number, y0: number, x1: number, y1: number, rect = false): InkBox {
  return rect ? { x0, y0, x1, y1, rect } : { x0, y0, x1, y1 };
}

function layout(parts: Partial<PageLayout> = {}): PageLayout {
  return {
    view: A4,
    rotate: 0,
    ink: [],
    text: [],
    operators: 500,
    paths: 40,
    imageOps: 0,
    shadings: 0,
    unmeasuredPaint: 0,
    ...parts,
  };
}

function input(page: PageLayout, caption: string, extra: Partial<DrawnFigureInput> = {}): DrawnFigureInput {
  return { layout: page, caption, markersOnPage: 1, imageInResources: false, unmeasuredPaint: false, ...extra };
}

/* ------------------------------------------------------------------ *
 * The ordinary page: prose, a drawing, its caption, more prose
 * ------------------------------------------------------------------ */

const CAPTION = "Figure 3. The widget assembly process in three stages, from raw parts to the finished widget.";

const PROSE_ABOVE = text("This paragraph is ordinary body text that runs across the whole column.", 72, 700, {
  size: 10,
  width: 450,
});
const CAPTION_LINES = [
  text("Figure 3. The widget assembly process in three stages, from", 72, 400, { width: 450 }),
  text("raw parts to the finished widget.", 72, 388, { width: 180 }),
];
const PROSE_BELOW = text("And the body text carries on underneath the caption as it always does.", 72, 360, {
  size: 10,
  width: 450,
});
/** Two panels and a connector, and a label set as text inside the left one. */
const DRAWING = [ink(100, 430, 300, 650), ink(310, 430, 500, 650), ink(295, 530, 315, 540)];
const LABEL = text("input", 110, 440, { size: 7, width: 20 });

function ordinaryPage(parts: Partial<PageLayout> = {}): PageLayout {
  return layout({
    ink: DRAWING,
    text: [PROSE_ABOVE, LABEL, ...CAPTION_LINES, PROSE_BELOW],
    ...parts,
  });
}

describe("the plain case", () => {
  it("takes everything drawn between the caption and the prose above it", () => {
    const verdict = locateDrawnFigure(input(ordinaryPage(), CAPTION));
    expect(verdict).toEqual({ ok: true, region: { x0: 100, y0: 430, x1: 500, y1: 650 } });
  });

  it("stops at the prose above, and leaves a drawing beyond it alone", () => {
    /* Another figure's drawing above the paragraph: out of the band, so neither
       taken nor a reason to refuse. The ceiling is the paragraph. */
    const page = ordinaryPage({ ink: [...DRAWING, ink(100, 720, 500, 800)] });
    const verdict = locateDrawnFigure(input(page, CAPTION));
    expect(verdict.ok && verdict.region.y1).toBe(650);
  });
});

/* ------------------------------------------------------------------ *
 * Eligibility — the page, before anything is located on it
 * ------------------------------------------------------------------ */

describe("which pages are eligible", () => {
  it("refuses a page with two figure markers on it", () => {
    expect(locateDrawnFigure(input(ordinaryPage(), CAPTION, { markersOnPage: 2 }))).toEqual({
      ok: false,
      reason: "not-eligible",
      detail: "several-markers",
    });
  });

  it("refuses a page that prints two figure captions, even with one marker (Sol F13)", () => {
    /* The transcription found one caption; the page has two. The second one's
       drawing is exactly what the band rule could take by mistake. */
    const page = ordinaryPage({
      text: [PROSE_ABOVE, LABEL, ...CAPTION_LINES, text("Figure 4. A second picture on the same page.", 72, 200)],
    });
    expect(locateDrawnFigure(input(page, CAPTION))).toEqual({
      ok: false,
      reason: "not-eligible",
      detail: "several-captions",
    });
  });

  it("counts an unpunctuated Figure N opening as a second printed caption", () => {
    const page = ordinaryPage({
      text: [PROSE_ABOVE, LABEL, ...CAPTION_LINES, text("Figure 4 The second apparatus on this page", 72, 200)],
    });
    expect(locateDrawnFigure(input(page, CAPTION))).toEqual({
      ok: false,
      reason: "not-eligible",
      detail: "several-captions",
    });
  });

  it("refuses a page whose operator list paints any image at all", () => {
    expect(locateDrawnFigure(input(ordinaryPage({ imageOps: 1 }), CAPTION))).toMatchObject({
      ok: false,
      reason: "not-eligible",
    });
  });

  it("refuses a page whose resources hold an image pdf.js may have dropped", () => {
    /* The image pdf.js removed for size never reaches its operator list; the
       resources are the only place it is still visible. Sol F2. */
    expect(locateDrawnFigure(input(ordinaryPage(), CAPTION, { imageInResources: true }))).toEqual({
      ok: false,
      reason: "not-eligible",
      detail: "image-resource",
    });
  });

  it("refuses resource paint that pdf.js did not expose as paths", () => {
    expect(locateDrawnFigure(input(ordinaryPage(), CAPTION, { unmeasuredPaint: true }))).toEqual({
      ok: false,
      reason: "not-eligible",
      detail: "unmeasured-paint",
    });
  });

  it("refuses layout paint whose bounds could not be measured", () => {
    expect(locateDrawnFigure(input(ordinaryPage({ unmeasuredPaint: 1 }), CAPTION))).toEqual({
      ok: false,
      reason: "not-located",
      detail: "unbounded-ink",
    });
  });

  it("refuses a rotated page rather than reconciling two coordinate engines", () => {
    expect(locateDrawnFigure(input(ordinaryPage({ rotate: 90 }), CAPTION))).toEqual({
      ok: false,
      reason: "not-eligible",
      detail: "rotated",
    });
  });

  it("refuses a view box that does not start at the origin", () => {
    expect(locateDrawnFigure(input(ordinaryPage({ view: [0, 20, 595, 862] }), CAPTION))).toEqual({
      ok: false,
      reason: "not-eligible",
      detail: "offset-view-box",
    });
  });

  it("calls a page with too many operators too complex, and never locates on it", () => {
    expect(
      locateDrawnFigure(input(ordinaryPage({ operators: MAX_PAGE_OPERATORS + 1 }), CAPTION)),
    ).toEqual({ ok: false, reason: "too-complex", detail: "operators" });
    expect(locateDrawnFigure(input(ordinaryPage({ paths: MAX_PAGE_PATHS + 1 }), CAPTION))).toEqual({
      ok: false,
      reason: "too-complex",
      detail: "paths",
    });
  });
});

/* ------------------------------------------------------------------ *
 * Finding the caption, not a mention of it
 * ------------------------------------------------------------------ */

describe("finding the caption", () => {
  const caption = "Figure 2. The widget assembly process in three stages, from raw parts.";
  const drawing = [ink(100, 430, 500, 650)];
  const captionLine = text(caption, 72, 400, { width: 450 });

  it("finds the caption and not a body sentence that mentions the figure", () => {
    const page = layout({
      ink: drawing,
      text: [
        text("As Figure 2 shows, the widget is assembled from its parts in order.", 72, 700, {
          size: 10,
          width: 450,
        }),
        captionLine,
      ],
    });
    expect(locateDrawnFigure(input(page, caption))).toEqual({
      ok: true,
      region: { x0: 100, y0: 430, x1: 500, y1: 650 },
    });
  });

  it("conservatively refuses a line-start body reference as a possible second caption", () => {
    /* Text alone cannot distinguish an unpunctuated caption from "Figure 2
       shows…" at the start of body prose. The safe answer is a false refusal,
       not allowing an unpunctuated second caption to attach its drawing. */
    const page = layout({
      ink: drawing,
      text: [
        text("Figure 2 shows the lattice for the widget assembled from its parts.", 72, 700, {
          size: 10,
          width: 450,
        }),
        captionLine,
      ],
    });
    expect(locateDrawnFigure(input(page, caption))).toEqual({
      ok: false,
      reason: "not-eligible",
      detail: "several-captions",
    });
  });

  it("finds a caption split across runs and across lines", () => {
    const split = "Figure 7. Partial information lattices, for two and for three predictor variables.";
    const page = layout({
      ink: drawing,
      text: [
        text("Figure 7.", 72, 400, { width: 36 }),
        text("Partial information lat-", 112, 400, { width: 96 }),
        text("tices, for two and for three predictor variables.", 72, 388, { width: 200 }),
      ],
    });
    expect(locateDrawnFigure(input(page, split)).ok).toBe(true);
  });

  it("refuses a caption the page does not print", () => {
    expect(
      locateDrawnFigure(input(ordinaryPage(), "Figure 3. Something this page never says anywhere.")),
    ).toEqual({ ok: false, reason: "not-located", detail: "caption-not-found" });
  });
});

/* ------------------------------------------------------------------ *
 * Ownership — GPT Sol's F1, F11 and F12 layouts, and Fable's ruling
 * ------------------------------------------------------------------ */

describe("proving the drawing belongs to this caption", () => {
  it("refuses side-by-side figures over stacked captions, whichever caption asks", () => {
    const left = "Figure 1. The left-hand apparatus as it was built in the laboratory.";
    const right = "Figure 2. The right-hand apparatus after the modification described above.";
    const page = layout({
      ink: [ink(80, 450, 290, 650), ink(305, 450, 515, 650)],
      text: [PROSE_ABOVE, text(left, 72, 425, { width: 450 }), text(right, 72, 410, { width: 450 })],
    });
    /* Two markers is the case as the plan states it… */
    expect(locateDrawnFigure(input(page, left, { markersOnPage: 2 })).ok).toBe(false);
    /* …and the same page with only one marker recognised must not hand both
       drawings to the upper caption, nor the empty band to the lower one. */
    expect(locateDrawnFigure(input(page, left)).ok).toBe(false);
    expect(locateDrawnFigure(input(page, right)).ok).toBe(false);
  });

  it("refuses a page carrying a page-sized path — a border, a watermark, a background", () => {
    const page = ordinaryPage({ ink: [...DRAWING, ink(20, 20, 575, 822)] });
    expect(locateDrawnFigure(input(page, CAPTION))).toEqual({
      ok: false,
      reason: "not-located",
      detail: "page-sized-ink",
    });
  });

  it("takes the whole of a wide multi-panel figure over a narrow caption", () => {
    const caption = "Figure 5. Three panels.";
    const page = layout({
      ink: [ink(80, 430, 245, 600), ink(250, 430, 345, 600), ink(350, 430, 515, 600)],
      text: [PROSE_ABOVE, text(caption, 260, 400, { width: 90 }), PROSE_BELOW],
    });
    expect(locateDrawnFigure(input(page, caption))).toEqual({
      ok: true,
      region: { x0: 80, y0: 430, x1: 515, y1: 600 },
    });
  });

  describe("on a two-column page", () => {
    const caption = "Figure 6. Sensor placement on the left-hand rig used in the trials.";
    const leftColumn = [
      text("Left column prose that sits above the figure and is long enough.", 50, 620, { size: 10, width: 240 }),
      text(caption, 50, 400, { width: 240 }),
    ];
    const rightColumn = Array.from({ length: 20 }, (_, i) =>
      text("words in the right column that make up an ordinary line of prose", 305, 420 + i * 12, {
        size: 10,
        width: 240,
      }),
    );
    const figure = ink(60, 420, 280, 600);

    it("takes the figure when nothing else is in the band", () => {
      expect(locateDrawnFigure(input(layout({ ink: [figure], text: leftColumn }), caption)).ok).toBe(true);
    });

    it("refuses when the other column's drawing sits in the band", () => {
      const page = layout({ ink: [figure, ink(320, 500, 530, 560)], text: leftColumn });
      expect(locateDrawnFigure(input(page, caption))).toEqual({
        ok: false,
        reason: "not-located",
        detail: "other-ink-in-band",
      });
    });

    it("refuses a half-width figure with the other column's prose in the band", () => {
      /* F12 is deliberately band-wide: a text-wrapped layout is outside the
         narrow single-float case even when that prose would miss the crop. */
      const page = layout({ ink: [figure], text: [...leftColumn, ...rightColumn] });
      expect(locateDrawnFigure(input(page, caption))).toEqual({
        ok: false,
        reason: "not-located",
        detail: "foreign-text",
      });
    });
  });

  it("refuses text in the band that touches no drawing — a DRAFT between two panels (Sol F12)", () => {
    const panels = [ink(100, 430, 250, 650), ink(350, 430, 500, 650)];
    const page = layout({
      ink: panels,
      text: [PROSE_ABOVE, text("DRAFT", 285, 540, { width: 30 }), ...CAPTION_LINES, PROSE_BELOW],
    });
    expect(locateDrawnFigure(input(page, CAPTION))).toEqual({
      ok: false,
      reason: "not-located",
      detail: "foreign-text",
    });
    /* The same page without it is taken, so the refusal is about the word. */
    expect(locateDrawnFigure(input(layout({ ...page, text: [PROSE_ABOVE, ...CAPTION_LINES] }), CAPTION)).ok).toBe(
      true,
    );
  });

  it("refuses a crop whose renderer padding would include the matched caption", () => {
    const nearCaption = ordinaryPage({ ink: [ink(100, 411, 500, 650)] });
    expect(locateDrawnFigure(input(nearCaption, CAPTION))).toEqual({
      ok: false,
      reason: "not-located",
      detail: "prose-in-region",
    });
  });

  it("does not count the running header's rule or text as part of the figure", () => {
    /* MDPI's rule sits at y = 771 on the report's page, inside the band, because
       nothing but the header is above the figure; its text sits at 779. */
    const page = layout({
      ink: [ink(100, 430, 500, 700), ink(40, 780, 555, 780.4)],
      text: [text("Journal 2022, 24, 930", 40, 790, { size: 8 }), ...CAPTION_LINES, PROSE_BELOW],
    });
    expect(locateDrawnFigure(input(page, CAPTION))).toEqual({
      ok: true,
      region: { x0: 100, y0: 430, x1: 500, y1: 700 },
    });
  });

  it("refuses paint whose extent the operator list does not give", () => {
    expect(locateDrawnFigure(input(ordinaryPage({ shadings: 1 }), CAPTION))).toEqual({
      ok: false,
      reason: "not-located",
      detail: "unbounded-ink",
    });
  });
});

/* ------------------------------------------------------------------ *
 * Drawings that do not touch — Fable's ruling, 2026-09-12
 * ------------------------------------------------------------------ */

describe("a figure made of drawings that do not touch", () => {
  /** Figure 2's shape: two separate drawings, both over a full-width caption. */
  const twoLattices = ordinaryPage({ ink: [ink(100, 430, 250, 650), ink(310, 430, 500, 650)] });

  it("is admitted by default, as ruled", () => {
    expect(ADMIT_DISCONNECTED_DRAWINGS).toBe(true);
    expect(locateDrawnFigure(input(twoLattices, CAPTION))).toEqual({
      ok: true,
      region: { x0: 100, y0: 430, x1: 500, y1: 650 },
    });
  });

  it("is refused with the switch off, so the switch is one line", () => {
    expect(locateDrawnFigure(input(twoLattices, CAPTION, { admitDisconnected: false }))).toEqual({
      ok: false,
      reason: "not-located",
      detail: "disconnected",
    });
    /* A connected figure is unaffected by the switch. */
    expect(locateDrawnFigure(input(ordinaryPage(), CAPTION, { admitDisconnected: false })).ok).toBe(true);
  });

  it("refuses a component that is a box with text in it — an equation, a sidebar (Sol F11)", () => {
    /* Sol's counterexample: a plot in one column, a boxed equation in the
       other, one full-width caption under both. */
    const page = layout({
      ink: [ink(100, 430, 270, 650), ink(325, 470, 500, 600, true)],
      text: [PROSE_ABOVE, text("E = mc2", 380, 530, { width: 40 }), ...CAPTION_LINES, PROSE_BELOW],
    });
    expect(locateDrawnFigure(input(page, CAPTION))).toEqual({
      ok: false,
      reason: "not-located",
      detail: "boxed-text",
    });
    /* The same rectangle with nothing in it is a panel frame, and is taken. */
    const empty = layout({ ...page, text: [PROSE_ABOVE, ...CAPTION_LINES, PROSE_BELOW] });
    expect(locateDrawnFigure(input(empty, CAPTION)).ok).toBe(true);
  });

  it("refuses a component smaller than the smallest figure — an ornament, a logo, a stray mark", () => {
    const page = ordinaryPage({ ink: [...DRAWING, ink(470, 670, 490, 690)] });
    expect(locateDrawnFigure(input(page, CAPTION))).toEqual({
      ok: false,
      reason: "not-located",
      detail: "small-component",
    });
  });

  it("does not let a touching label enlarge a too-small drawing past the component minimum", () => {
    const page = layout({
      ink: [ink(100, 430, 120, 450), ink(160, 430, 180, 450)],
      text: [PROSE_ABOVE, text("shared label", 115, 425, { size: 50, width: 50 }), ...CAPTION_LINES],
    });
    expect(locateDrawnFigure(input(page, CAPTION))).toEqual({
      ok: false,
      reason: "not-located",
      detail: "small-component",
    });
  });

  it("refuses more separate drawings than a figure has panels", () => {
    const panels = (n: number) =>
      Array.from({ length: n }, (_, i) => ink(80 + i * 62, 430, 80 + i * 62 + 50, 500));
    expect(locateDrawnFigure(input(ordinaryPage({ ink: panels(MAX_INK_COMPONENTS) }), CAPTION)).ok).toBe(true);
    expect(locateDrawnFigure(input(ordinaryPage({ ink: panels(MAX_INK_COMPONENTS + 1) }), CAPTION))).toEqual({
      ok: false,
      reason: "not-located",
      detail: "too-many-components",
    });
  });
});
