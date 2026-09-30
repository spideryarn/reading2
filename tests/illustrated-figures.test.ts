/**
 * `src/illustrated-figures.ts` — which of the paper's stored figures the
 * Illustrated brief is offered, and with what bytes.
 * docs/plans/260930f-illustrated-diagram-draws-on-the-paper-figures.md.
 */
import { describe, expect, it } from "vitest";

import { type Assets, type PdfFigureEntry, pdfFigureMarkerValue } from "../src/assets.js";
import {
  figureCandidates,
  figuresFingerprint,
  loadArticleFigures,
  MAX_FIGURE_BYTES,
  MAX_FIGURES_OFFERED,
} from "../src/illustrated-figures.js";
import type { Block } from "../src/types.js";

const marker = (n: number) =>
  pdfFigureMarkerValue({ figureRef: `pdffig1-${"fedcba9876543210".repeat(2)}`, page: n, ordinal: 1 });

function block(id: string, html: string, text: string): Block {
  return {
    id,
    tag: "figure",
    kind: "media",
    text,
    words: text.split(/\s+/).length,
    html,
    gistable: false,
    isStructural: false,
  } as Block;
}

const figureBlock = (id: string, n: number, caption: string) =>
  block(id, `<figure data-spya-pdf-figure="${marker(n)}"><figcaption>${caption}</figcaption></figure>`, caption);

const hash = (c: string) => c.repeat(64);

function stored(n: number, c: string): PdfFigureEntry {
  return {
    ref: marker(n),
    page: n,
    status: "stored",
    sha256: hash(c),
    ext: "png",
    contentType: "image/png",
    bytes: 100,
    width: 800,
    height: 600,
  };
}

/** A PNG whose IHDR says `width` × `height`, and nothing after it. */
function png(width: number, height: number, pad = 0): Uint8Array {
  const bytes = new Uint8Array(33 + pad);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const BLOCKS: Block[] = [
  block("spya-aaaaaa", "<p>Opening prose.</p>", "Opening prose."),
  figureBlock("spya-bbbbbb", 3, "Figure 1. The model."),
  // A web image is not a figure in v1, stored or not.
  block("spya-cccccc", `<p><img src="https://example.test/chart.png"></p>`, "A chart."),
  figureBlock("spya-dddddd", 4, "Figure 2. A logo-sized thing."),
  figureBlock("spya-eeeeee", 5, "Figure 3. Failed to recover."),
];

const ASSETS: Assets = {
  version: "assets/2",
  sourceHash: "x",
  fetchedAt: "2026-09-30T00:00:00Z",
  entries: [
    {
      url: "https://example.test/chart.png",
      status: "stored",
      sha256: hash("c"),
      ext: "png",
      contentType: "image/png",
      bytes: 100,
    },
  ],
  pdfFigures: [
    stored(3, "b"),
    stored(4, "d"),
    { ref: marker(5), page: 5, status: "failed", reason: "not-located", at: "t" },
  ],
};

describe("figureCandidates", () => {
  it("finds every stored PDF figure in reading order, with its block and caption, and no web image", () => {
    expect(figureCandidates(BLOCKS, ASSETS)).toEqual([
      { block: "spya-bbbbbb", caption: "Figure 1. The model.", sha256: hash("b"), ext: "png" },
      { block: "spya-dddddd", caption: "Figure 2. A logo-sized thing.", sha256: hash("d"), ext: "png" },
    ]);
  });

  it("has none when stage 4.5 never ran, or found no figures", () => {
    expect(figureCandidates(BLOCKS, undefined)).toEqual([]);
    const { pdfFigures: _none, ...noFigures } = ASSETS;
    expect(figureCandidates(BLOCKS, noFigures)).toEqual([]);
  });

  it("refuses a figure ref that two blocks carry, as the assets step does", () => {
    const twice = [...BLOCKS, figureBlock("spya-ffffff", 3, "Figure 1. The model.")];
    expect(figureCandidates(twice, ASSETS).map((c) => c.block)).toEqual(["spya-dddddd"]);
  });
});

describe("figuresFingerprint", () => {
  it("is empty without stored figures, so a figure-less article hashes as before", () => {
    expect(figuresFingerprint(undefined)).toBe("");
    expect(figuresFingerprint({ ...ASSETS, pdfFigures: [] })).toBe("");
  });

  it("names every stored figure, and moves when one arrives", () => {
    const before = figuresFingerprint({ ...ASSETS, pdfFigures: [stored(3, "b")] });
    expect(before).toBe(`${hash("b")}.png`);
    expect(figuresFingerprint(ASSETS)).toBe(`${hash("b")}.png,${hash("d")}.png`);
  });
});

describe("loadArticleFigures", () => {
  const bytes: Record<string, Uint8Array> = {
    [hash("b")]: png(800, 600),
    [hash("d")]: png(64, 64),
  };
  const read = async (sha256: string) => bytes[sha256] ?? null;

  it("drops what is too small to be a figure, and letters the rest without a gap", async () => {
    const survey = await loadArticleFigures(BLOCKS, ASSETS, read);
    expect(survey.figures.map((f) => [f.label, f.block, f.ext, f.bytes])).toEqual([
      ["FIGURE A", "spya-bbbbbb", "png", 33],
    ]);
    expect(survey.figures[0]?.dataUrl.startsWith("data:image/png;base64,iVBORw0KGgo")).toBe(true);
    expect(survey.stored).toBe(2);
    expect(survey.skipped).toMatchObject({ tooSmall: 1, unreadable: 0 });
  });

  it("leaves out a figure it cannot read, or that is too big to send, and carries on", async () => {
    const survey = await loadArticleFigures(BLOCKS, ASSETS, async (sha256) => {
      if (sha256 === hash("b")) throw new Error("bucket down");
      return png(1200, 900, MAX_FIGURE_BYTES);
    });
    expect(survey.figures).toEqual([]);
    expect(survey.skipped).toMatchObject({ unreadable: 1, tooBig: 1 });
  });

  it(`offers at most ${MAX_FIGURES_OFFERED}, the first in reading order`, async () => {
    const n = MAX_FIGURES_OFFERED + 2;
    const many = Array.from({ length: n }, (_, i) =>
      figureBlock(`spya-m${String(i).padStart(5, "0")}`, i + 1, `Figure ${i + 1}.`),
    );
    const assets: Assets = {
      ...ASSETS,
      pdfFigures: many.map((_, i) => ({ ...stored(i + 1, "0"), sha256: String(i).padStart(64, "0") })),
    };
    const survey = await loadArticleFigures(many, assets, async () => png(800, 600));
    expect(survey.figures).toHaveLength(MAX_FIGURES_OFFERED);
    expect(survey.figures[0]?.block).toBe("spya-m00000");
    expect(survey.figures.at(-1)?.label).toBe(`FIGURE ${String.fromCharCode(64 + MAX_FIGURES_OFFERED)}`);
    expect(survey.skipped.overCap).toBe(2);
  });
});
