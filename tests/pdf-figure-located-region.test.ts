/**
 * **A composite figure rendered from the model's box** — `judgeLocatedRegion`,
 * src/pdf-figure-region.ts. Synthetic pages in PDF points, origin at the
 * bottom left. The three real figures behind report spya-pawfwx were run by
 * hand (the plan's § Stage 2); these pin the rules.
 *
 * The bar is Greg's (2026-10-01): *"I'd rather accidentally pull in a bit of
 * extra stuff that got included within the bounding box than have no figure
 * imported at all"*. So a stray line, unmeasured paint and a failed strict read
 * are accepted; a region tied to the wrong caption, or mostly something else,
 * is not. docs/plans/261001q-pdf-tables-and-composite-figures.md.
 */
import { describe, expect, it } from "vitest";
import {
  type InkBox,
  judgeLocatedRegion,
  type LocatedRegionInput,
  type PageBox,
  type PageLayout,
  type PageTextItem,
} from "../src/pdf-figure-region.js";

const A4: [number, number, number, number] = [0, 0, 595, 842];

function text(str: string, x: number, y: number, size = 9): PageTextItem {
  return { str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.45, height: size };
}

function layout(parts: Partial<PageLayout> = {}): PageLayout {
  return {
    view: A4,
    rotate: 0,
    ink: [],
    text: [],
    operators: 500,
    paths: 40,
    imageOps: 4,
    shadings: 0,
    unmeasuredPaint: 0,
    strictAgrees: true,
    ...parts,
  };
}

const picture = (x0: number, y0: number, x1: number, y1: number) => ({
  op: "xobject" as const,
  box: { x0, y0, x1, y1 },
  clip: { x0, y0, x1, y1 },
});

const CAPTION = "Fig 1. HER-2 immunohistochemical staining of three cases that had a negative sample.";

/** Prose above the figure, a 2×2 grid of photos with labels, the caption under it, prose below. */
const PROSE = "This paragraph is ordinary body text that runs across the whole column width.";
const PAGE_TEXT: PageTextItem[] = [
  text(PROSE, 60, 760, 10),
  text(PROSE, 60, 746, 10),
  text("Patient 221", 120, 600),
  text("Patient 228", 330, 600),
  text("Pre", 70, 520),
  text("Relapse", 60, 420),
  text(CAPTION, 60, 360),
  text(PROSE, 60, 300, 10),
  text(PROSE, 60, 286, 10),
];
const PICTURES = [picture(110, 480, 300, 590), picture(320, 480, 510, 590), picture(110, 380, 300, 470), picture(320, 380, 510, 470)];
const FRAME: InkBox = { x0: 50, y0: 372, x1: 540, y1: 620, rect: true };

/** The model's box around the grid, as a page box. */
const GRID_BOX: PageBox = { x0: 55, y0: 375, x1: 535, y1: 615 };

function judge(over: Partial<LocatedRegionInput> = {}, page: Partial<PageLayout> = {}) {
  return judgeLocatedRegion({
    layout: layout({ text: PAGE_TEXT, ink: [FRAME], ...page }),
    pictures: PICTURES,
    box: GRID_BOX,
    caption: CAPTION,
    ...over,
  });
}

describe("a composite figure the model boxed", () => {
  it("is rendered whole: every picture, its labels and its frame", () => {
    const verdict = judge();
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.region.x0).toBeLessThanOrEqual(50);
    expect(verdict.region.x1).toBeGreaterThanOrEqual(540);
    expect(verdict.region.y1).toBeGreaterThanOrEqual(620);
    /* The containment is the crop the renderer draws — region plus its pad. */
    expect(verdict.containment).toHaveLength(1);
    expect(verdict.containment[0]!.box.x0).toBeLessThan(verdict.region.x0);
  });

  it("snaps out to a picture the box cut through, so no panel is cut in half", () => {
    const tight = judge({ box: { x0: 115, y0: 385, x1: 430, y1: 585 } }, { ink: [] });
    expect(tight.ok).toBe(true);
    if (!tight.ok) return;
    /* The right-hand pictures were mostly inside (x 320–430 of 320–510): taken whole. */
    expect(tight.region.x1).toBeGreaterThanOrEqual(510);
  });

  it("does not snap to a picture it barely touches", () => {
    const touching = judge(
      { box: { x0: 105, y0: 375, x1: 330, y1: 595 }, pictures: [picture(110, 380, 300, 590), picture(320, 380, 510, 590)] },
      { ink: [] },
    );
    expect(touching.ok).toBe(true);
    if (!touching.ok) return;
    expect(touching.region.x1).toBeLessThan(400);
  });

  it("keeps a figure whose region takes in a stray line of prose — Greg's bar", () => {
    const stray = judge({}, { text: [...PAGE_TEXT, text(PROSE, 60, 610, 10)] });
    expect(stray.ok).toBe(true);
  });

  it("is not refused for paint pdf.js could not measure, or a strict read that disagrees", () => {
    expect(judge({}, { strictAgrees: false, shadings: 3, unmeasuredPaint: 2 }).ok).toBe(true);
  });

  it("takes the caption printed beside the figure as well as below it", () => {
    const beside = judge(
      { box: { x0: 55, y0: 375, x1: 400, y1: 615 }, pictures: [picture(110, 380, 300, 590)] },
      { ink: [], text: [text(PROSE, 60, 760, 10), text(CAPTION, 410, 560)] },
    );
    expect(beside).toMatchObject({ ok: true });
  });
});

describe("a region that is not this caption's figure", () => {
  it("is refused when the caption is not next to it", () => {
    /* A box around the prose at the top of the page, with the caption far below. */
    expect(judge({ box: { x0: 55, y0: 640, x1: 535, y1: 700 } }, { ink: [] })).toEqual({
      ok: false,
      detail: "caption-not-adjacent",
    });
  });

  it("is refused when it holds a table's caption — a box around the table", () => {
    const table = judge({}, { text: [...PAGE_TEXT, text("Table 3. HER-2 Status at Presentation", 120, 560)] });
    expect(table).toEqual({ ok: false, detail: "another-caption" });
  });

  it("is refused when another figure's caption is as near as its own", () => {
    const between = judge({}, { text: [...PAGE_TEXT, text("Fig 2. Something else entirely.", 60, 630)] });
    expect(between).toEqual({ ok: false, detail: "another-caption" });
  });

  it("is refused when the box is mostly prose", () => {
    const lines = Array.from({ length: 12 }, (_, i) => text(PROSE, 60, 340 - i * 12, 10));
    const prose = judge(
      { box: { x0: 55, y0: 200, x1: 535, y1: 352 }, pictures: [] },
      { ink: [], text: [text(CAPTION, 60, 360), ...lines] },
    );
    expect(prose).toEqual({ ok: false, detail: "mostly-prose" });
  });

  it("is refused when the caption is only mentioned mid-line in prose", () => {
    const mention = judge(
      {},
      { text: [text(PROSE, 60, 760, 10), text(`as shown in ${CAPTION}`, 60, 360), ...PAGE_TEXT.slice(2, 6)] },
    );
    expect(mention.ok).toBe(false);
  });

  it("does not snap to an `other` paint, whose box is a placeholder", () => {
    const other = judge(
      {
        pictures: [...PICTURES, { op: "other", box: { x0: 0, y0: 0, x1: 595, y1: 842 }, clip: null }],
      },
      { ink: [] },
    );
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.region.y1).toBeLessThan(700);
  });
});
