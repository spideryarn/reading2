/**
 * The pure half of recovering a figure from a PDF: is this decoded raster
 * worth keeping, is it well-formed enough to touch, what does it look like as
 * a PNG, and which caption — if any — is allowed to claim it.
 *
 * **Everything here is plain arrays of bytes.** No pdf.js, no PDF, no store,
 * no network. That is the whole reason src/pdf-figures.ts exists as its own
 * module: the rules that decide whether a reader sees a picture are the rules
 * a test can be adversarial about, and none of them needs a document to state.
 *
 * Two of these tests are the ones that matter, and both are about silence:
 *
 *  - **the blankness rule is exact, and nothing else.** Every one of the eight
 *    overlays in the target document is fully transparent; every one of the
 *    eight real figures is 32.5–100% opaque, and Kuhn's 119×119 logo — which a
 *    compression-based rule threw away — is 100% opaque. A rule that also
 *    guessed at "nearly one colour" would delete a faint line diagram and say
 *    nothing about it.
 *  - **the pairing gate refuses rather than guesses.** A picture under the
 *    wrong caption is a fabricated claim about the paper with the app's
 *    authority behind it, and the reader cannot detect it. A missing figure is
 *    visible. So one marker and one usable raster, or nothing.
 *
 * docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md, and
 * GPT Sol's review beside it — D3 (blankness), D5 (limits), I-6 (validation).
 */
import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  classifyRaster,
  downscaleRaster,
  encodeFigurePng,
  type FigureMarker,
  MAX_FIGURE_EDGE,
  MAX_FIGURE_PIXELS,
  pairPageFigures,
  pdfFigureRef,
  type RasterCandidate,
} from "../src/pdf-figures.js";

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

/** `width * height` copies of `pixel`, laid out the way pdf.js hands them over. */
function fill(width: number, height: number, pixel: readonly number[]): Uint8Array {
  const data = new Uint8Array(width * height * pixel.length);
  for (let i = 0; i < width * height; i++) data.set(pixel, i * pixel.length);
  return data;
}

function rgba(
  width: number,
  height: number,
  pixel: readonly [number, number, number, number],
  over: Partial<RasterCandidate> = {},
): RasterCandidate {
  return { page: 1, key: "img_p0_1", width, height, kind: 3, data: fill(width, height, pixel), ...over };
}

function rgb(
  width: number,
  height: number,
  pixel: readonly [number, number, number],
  over: Partial<RasterCandidate> = {},
): RasterCandidate {
  return { page: 1, key: "img_p0_1", width, height, kind: 2, data: fill(width, height, pixel), ...over };
}

function marker(over: Partial<FigureMarker> = {}): FigureMarker {
  return { ref: "pdffig1-aaaa", page: 1, ordinal: 1, ...over };
}

const SHA = "a".repeat(64);

/* ------------------------------------------------------------------ *
 * Blankness — the only rule, and it is exact
 * ------------------------------------------------------------------ */

describe("classifyRaster: blankness", () => {
  it("calls an RGBA image with no opaque byte anywhere blank", () => {
    /* The eight overlays in the target document, all of them: a caption
       backing box painted as a fully transparent image. Ship without this and
       every figure gets an empty rectangle stapled beside it, with nothing
       erroring. */
    expect(classifyRaster(rgba(8, 4, [255, 255, 255, 0]))).toEqual({ status: "blank" });
  });

  it("keeps the same image once a single byte of alpha is 1", () => {
    /* Exactly zero, not nearly zero. Alpha 1 out of 255 is invisible to a
       human and is still a drawing instruction; the rule has no tolerance
       precisely so that there is no threshold anybody has to defend. */
    const candidate = rgba(8, 4, [255, 255, 255, 0]);
    candidate.data[3 + 4 * 17] = 1;
    expect(classifyRaster(candidate).status).toBe("usable");
  });

  it("never calls an RGB image blank, however uniform", () => {
    /* kind 2 carries no alpha, so "draws nothing" is not a claim its bytes can
       support. An all-white RGB plate is a real plate. */
    expect(classifyRaster(rgb(16, 16, [255, 255, 255])).status).toBe("usable");
  });

  it("keeps a transparent sheet carrying one faint opaque line", () => {
    /* The false negative that would matter: a near-white line diagram, a faint
       grid, an axis rule. Sol D3-2 — keeping a flat rectangle is visible;
       deleting a figure is not. */
    const candidate = rgba(16, 16, [255, 255, 255, 0]);
    for (let x = 0; x < 16; x++) {
      const at = (8 * 16 + x) * 4;
      candidate.data.set([200, 200, 200, 255], at);
    }
    expect(classifyRaster(candidate).status).toBe("usable");
  });

  it("hands back exactly the bytes it was given, named", () => {
    const candidate = rgb(2, 1, [1, 2, 3]);
    expect(classifyRaster(candidate)).toEqual({
      status: "usable",
      raster: { kind: "rgb", width: 2, height: 1, data: candidate.data },
    });
    expect(classifyRaster(rgba(1, 1, [1, 2, 3, 4])).status).toBe("usable");
  });
});

/* ------------------------------------------------------------------ *
 * Validation — before anything allocates
 * ------------------------------------------------------------------ */

describe("classifyRaster: validation", () => {
  it("refuses a kind it does not decode, by name, and never as blank", () => {
    /* "Blank" is a claim about pixels. An unread kind is a claim about us, and
       filing one under the other is how a document full of figures we could
       have supported reports itself as a document full of empty overlays. */
    expect(classifyRaster({ ...rgb(2, 2, [0, 0, 0]), kind: 0 })).toEqual({
      status: "refused",
      reason: "unsupported-kind",
    });
    expect(classifyRaster({ ...rgb(2, 2, [0, 0, 0]), kind: 4 }).status).toBe("refused");
  });

  it("refuses GRAYSCALE_1BPP with a reason of its own", () => {
    /* kind 1 is packed bits, not bytes, so every length check below would be
       wrong about it. Nothing in the corpus exercises it, which is exactly why
       it gets its own word: the day one turns up, the manifest says so rather
       than saying "unsupported". */
    expect(classifyRaster({ ...rgb(8, 1, [0, 0, 0]), kind: 1, data: new Uint8Array(1) })).toEqual({
      status: "refused",
      reason: "grayscale-1bpp",
    });
  });

  it("refuses dimensions that are not positive whole numbers", () => {
    for (const [width, height] of [
      [0, 4],
      [4, 0],
      [-1, 4],
      [4, -1],
      [2.5, 4],
      [4, Number.NaN],
      [4, Number.POSITIVE_INFINITY],
    ] as const) {
      const candidate: RasterCandidate = { page: 1, key: "k", width, height, kind: 2, data: new Uint8Array(0) };
      expect(classifyRaster(candidate)).toEqual({ status: "refused", reason: "bad-dimensions" });
    }
  });

  it("refuses more pixels than we will decode, before touching the bytes", () => {
    /* width × height × 4 is the memory this would take inside the same Vercel
       function stage 2 runs in, and there is no rasteriser to downscale with.
       The check is on the numbers, so an oversized raster costs nothing. */
    const over = Math.ceil(Math.sqrt(MAX_FIGURE_PIXELS)) + 1;
    const candidate: RasterCandidate = {
      page: 1,
      key: "k",
      width: over,
      height: over,
      kind: 2,
      data: new Uint8Array(0),
    };
    expect(classifyRaster(candidate)).toEqual({ status: "refused", reason: "too-many-pixels" });
  });

  it("refuses dimensions far too large to multiply exactly", () => {
    /* **This does not prove what its first comment claimed, and the honest
       version is worth more than the flattering one.** GPT Sol, reviewing stage
       A: a bare `width * height > cap` would refuse 2^40 × 2^40 too, so this
       case would pass with the per-dimension guard deleted. And the arithmetic
       goes further than that — any product near the 12-million cap is exactly
       representable in a double, and a product big enough to round is already
       so far above the cap that it cannot round *down* to reach it. There is no
       input that slips through the naive comparison.

       So the per-dimension guard is not load-bearing for correctness. It is
       kept because it makes the safety local: `classifyRaster` refuses before
       multiplying, so a later reader does not have to reconstruct the
       floating-point argument to convince themselves the multiply is sound.
       What this test actually pins is that an absurd raster is refused for
       being too big, and it is named for that. */
    const huge = 2 ** 40;
    const candidate: RasterCandidate = {
      page: 1,
      key: "k",
      width: huge,
      height: huge,
      kind: 3,
      data: new Uint8Array(0),
    };
    expect(classifyRaster(candidate)).toEqual({ status: "refused", reason: "too-many-pixels" });
  });

  it("refuses a byte count that is not exactly width × height × channels", () => {
    /* Off by one in either direction. A short buffer would read past the end
       of a real image and a long one means we are not looking at what we think
       we are; either way the scanline walk that follows is nonsense. */
    const short = rgb(4, 4, [1, 2, 3]);
    short.data = short.data.slice(0, short.data.length - 1);
    expect(classifyRaster(short)).toEqual({ status: "refused", reason: "byte-count-mismatch" });

    const long = rgba(4, 4, [1, 2, 3, 4]);
    long.data = new Uint8Array([...long.data, 0]);
    expect(classifyRaster(long)).toEqual({ status: "refused", reason: "byte-count-mismatch" });

    /* And the classic: RGBA bytes wearing an RGB kind. */
    expect(classifyRaster({ ...rgba(4, 4, [1, 2, 3, 4]), kind: 2 }).status).toBe("refused");
  });
});

/* ------------------------------------------------------------------ *
 * The downscale
 * ------------------------------------------------------------------ */

/** A raster the validator has agreed to, so nothing here builds one by hand. */
function usable(candidate: RasterCandidate) {
  const verdict = classifyRaster(candidate);
  if (verdict.status !== "usable") throw new Error(`expected usable, got ${verdict.status}`);
  return verdict.raster;
}

/** A candidate whose pixels are given outright rather than repeated. */
function pixels(width: number, height: number, kind: 2 | 3, values: readonly number[]): RasterCandidate {
  const data = new Uint8Array(values);
  expect(data.length).toBe(width * height * (kind === 3 ? 4 : 3));
  return { page: 1, key: "img_p0_1", width, height, kind, data };
}

describe("downscaleRaster", () => {
  it("returns a raster already inside the bound as the very same object", () => {
    /* Not "equal to" — the same object. A figure small enough to keep is
       provably untouched, and costs nothing to prove it. */
    const raster = usable(rgb(40, 30, [1, 2, 3]));
    expect(downscaleRaster(raster, 1600)).toBe(raster);
    expect(downscaleRaster(raster)).toBe(raster);
  });

  it("leaves a raster exactly on the threshold alone, and shrinks the next pixel up", () => {
    const onIt = usable(rgb(1600, 2, [4, 5, 6]));
    expect(downscaleRaster(onIt, 1600)).toBe(onIt);

    const overIt = usable(rgb(1601, 2, [4, 5, 6]));
    const smaller = downscaleRaster(overIt, 1600);
    expect(smaller).not.toBe(overIt);
    /* One pixel over the bound is still a whole factor of two: there is no
       fractional scaling here, and 801 × 1 is the honest consequence. */
    expect([smaller.width, smaller.height]).toEqual([801, 1]);
  });

  it("uses MAX_FIGURE_EDGE when it is not told otherwise", () => {
    const big = usable(rgb(MAX_FIGURE_EDGE * 2, 4, [7, 7, 7]));
    const smaller = downscaleRaster(big);
    expect(Math.max(smaller.width, smaller.height)).toBeLessThanOrEqual(MAX_FIGURE_EDGE);
  });

  it("averages a 4× box down to values that can be computed by hand", async () => {
    /* Two 4 × 4 boxes side by side, so every destination pixel is sixteen
       source pixels and the arithmetic is stated rather than reimplemented.
       Left box: red runs 0, 16, 32 … 240, which sums to 1920 and averages to
       120; green is 10 throughout and blue 200. Right box: red 7 throughout,
       blue 255 throughout, and green is 0 on the top two rows and 100 on the
       bottom two, averaging 50. */
    const values: number[] = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        if (x < 4) values.push((y * 4 + x) * 16, 10, 200);
        else values.push(7, y < 2 ? 0 : 100, 255);
      }
    }
    const smaller = downscaleRaster(usable(pixels(8, 4, 2, values)), 2);
    expect([smaller.width, smaller.height]).toEqual([2, 1]);
    expect([...smaller.data]).toEqual([120, 10, 200, 7, 50, 255]);
  });

  it("averages a partial edge box over what is actually there", () => {
    /* Three pixels into two: the second destination pixel has only one source
       pixel under it, and averaging it as though it had two — over the zeroes
       past the end of the row — would halve it. */
    const smaller = downscaleRaster(usable(pixels(3, 1, 2, [10, 10, 10, 20, 20, 20, 90, 90, 90])), 2);
    expect([smaller.width, smaller.height]).toEqual([2, 1]);
    expect([...smaller.data]).toEqual([15, 15, 15, 90, 90, 90]);
  });

  it("does not darken the edge of a transparent region — the alpha fringe", () => {
    /* **The test this function exists for.** Column 0 is opaque white; columns
       1–3 are fully transparent, and their colour bytes are black, which is
       what an unwritten RGBA buffer holds. The first destination pixel
       straddles the boundary: two opaque white pixels and two transparent
       black ones.
     *
     * An unweighted average reads those black bytes and returns 128 — a grey
     * halo around every transparent edge, which reads as a rendering fault
     * rather than as a resize. Weighting the colour by alpha returns 255: the
     * transparent pixels contribute nothing to the colour and everything to
     * the alpha, which is the whole point. */
    const values: number[] = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (x === 0) values.push(255, 255, 255, 255);
        else values.push(0, 0, 0, 0);
      }
    }
    const smaller = downscaleRaster(usable(pixels(4, 4, 3, values)), 2);
    expect([smaller.width, smaller.height]).toEqual([2, 2]);

    /* Full brightness kept, and the coverage halved — 255 and 128, not 128
       and 128. */
    expect([...smaller.data.slice(0, 4)]).toEqual([255, 255, 255, 128]);
    /* And a destination pixel with nothing opaque under it stays exactly
       transparent, rather than acquiring a colour nobody can see. */
    expect([...smaller.data.slice(4, 8)]).toEqual([0, 0, 0, 0]);
  });

  it("weights by alpha without disturbing a uniformly opaque image", () => {
    /* The weighting must be invisible where there is nothing to weight: an
       image of one alpha everywhere has to average exactly as RGB would. */
    const values: number[] = [];
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) values.push((y * 2 + x) * 40, 60, 100, 200);
    }
    const smaller = downscaleRaster(usable(pixels(2, 2, 3, values)), 1);
    expect([smaller.width, smaller.height]).toEqual([1, 1]);
    /* (0 + 40 + 80 + 120) / 4 = 60, and the alpha comes through untouched. */
    expect([...smaller.data]).toEqual([60, 60, 100, 200]);
  });

  it("keeps the aspect ratio, to within the pixel integer sides allow", () => {
    const smaller = downscaleRaster(usable(rgb(900, 759, [1, 2, 3])), 300);
    expect([smaller.width, smaller.height]).toEqual([300, 253]);
    expect(Math.abs(smaller.width / smaller.height - 900 / 759)).toBeLessThan(0.01);
    expect(smaller.data.length).toBe(300 * 253 * 3);
  });

  it("never produces a side of zero, however extreme the shape", () => {
    /* A 1-pixel-tall strip divided by four is a quarter of a pixel, and a
       zero-height raster is not an image — `encodeFigurePng` would write an
       IHDR no decoder accepts, and nothing else here would notice. */
    const strip = downscaleRaster(usable(rgb(5000, 1, [9, 9, 9])), 1600);
    expect([strip.width, strip.height]).toEqual([1250, 1]);
    expect([...strip.data.slice(0, 3)]).toEqual([9, 9, 9]);

    const tiny = downscaleRaster(usable(rgb(2, 1, [4, 5, 6])), 1);
    expect([tiny.width, tiny.height]).toEqual([1, 1]);
  });

  it("leaves a 1 × 1 raster alone at any bound", () => {
    const one = usable(rgb(1, 1, [7, 8, 9]));
    expect(downscaleRaster(one, 1)).toBe(one);
    expect(downscaleRaster(one)).toBe(one);
  });

  it("keeps the kind it was given", () => {
    expect(downscaleRaster(usable(rgb(10, 10, [1, 2, 3])), 2).kind).toBe("rgb");
    expect(downscaleRaster(usable(rgba(10, 10, [1, 2, 3, 4])), 2).kind).toBe("rgba");
  });

  it("refuses a bound that is not a positive whole number", () => {
    const raster = usable(rgb(10, 10, [1, 2, 3]));
    expect(() => downscaleRaster(raster, 0)).toThrow(/positive whole number/);
    expect(() => downscaleRaster(raster, 2.5)).toThrow(/positive whole number/);
  });
});

/* ------------------------------------------------------------------ *
 * The PNG
 * ------------------------------------------------------------------ */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Chunk {
  type: string;
  data: Uint8Array;
}

/** Walk a PNG's chunks, checking every CRC against node's own implementation. */
function chunksOf(png: Uint8Array): Chunk[] {
  expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = Buffer.from(png.slice(at + 4, at + 8)).toString("latin1");
    const data = png.slice(at + 8, at + 8 + length);
    /* node:zlib's crc32, not ours — an independent witness to the table in
       the module, which is the only way that table's test can fail. */
    expect(view.getUint32(at + 8 + length)).toBe(crc32(Buffer.from(png.slice(at + 4, at + 8 + length))));
    chunks.push({ type, data });
    at += 12 + length;
  }
  return chunks;
}

/** The scanlines a filter-0 PNG should inflate back to. */
function scanlines(width: number, height: number, channels: number, pixels: Uint8Array): number[] {
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    out.push(0);
    out.push(...pixels.slice(y * width * channels, (y + 1) * width * channels));
  }
  return out;
}

describe("encodeFigurePng", () => {
  it("writes an RGB raster as colour type 2 and inflates back to the pixels", async () => {
    const candidate = rgb(3, 2, [10, 20, 30]);
    candidate.data.set([200, 100, 50], 3 * 4); // one pixel unlike the rest
    const verdict = classifyRaster(candidate);
    if (verdict.status !== "usable") throw new Error(`expected usable, got ${verdict.status}`);

    const png = await encodeFigurePng(verdict.raster);
    const chunks = chunksOf(png);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    /* PNG requires `IEND` to carry no payload, and nothing else here would
       notice one that did: the CRC of a non-empty `IEND` is as valid as the CRC
       of an empty one, so a writer that put bytes in it would pass every other
       assertion in this file. GPT Sol, reviewing stage A. */
    expect(chunks.at(-1)!.data.length).toBe(0);

    const ihdr = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset, chunks[0]!.data.byteLength);
    expect(ihdr.getUint32(0)).toBe(3);
    expect(ihdr.getUint32(4)).toBe(2);
    expect(chunks[0]!.data[8]).toBe(8); // bit depth
    expect(chunks[0]!.data[9]).toBe(2); // colour type: truecolour
    expect([...chunks[0]!.data.slice(10)]).toEqual([0, 0, 0]); // deflate, adaptive, no interlace

    expect([...inflateSync(Buffer.from(chunks[1]!.data))]).toEqual(scanlines(3, 2, 3, candidate.data));
  });

  it("writes an RGBA raster as colour type 6, alpha intact", async () => {
    /* These figures carry real alpha, and it has to survive: a figure with a
       transparent background that got flattened to black would be unreadable
       on the light figure sheet the reading view puts under it. */
    const candidate = rgba(2, 2, [9, 8, 7, 128]);
    const verdict = classifyRaster(candidate);
    if (verdict.status !== "usable") throw new Error(`expected usable, got ${verdict.status}`);

    const png = await encodeFigurePng(verdict.raster);
    const chunks = chunksOf(png);
    expect(chunks[0]!.data[9]).toBe(6);
    const ihdr = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset, chunks[0]!.data.byteLength);
    expect(ihdr.getUint32(0)).toBe(2);
    expect(ihdr.getUint32(4)).toBe(2);
    expect([...inflateSync(Buffer.from(chunks[1]!.data))]).toEqual(scanlines(2, 2, 4, candidate.data));
  });

  it("survives a raster tall enough to need more than one deflate block", async () => {
    const candidate = rgb(64, 200, [1, 2, 3]);
    for (let i = 0; i < candidate.data.length; i++) candidate.data[i] = i % 251;
    const verdict = classifyRaster(candidate);
    if (verdict.status !== "usable") throw new Error("expected usable");
    const png = await encodeFigurePng(verdict.raster);
    const chunks = chunksOf(png);
    expect([...inflateSync(Buffer.from(chunks[1]!.data))]).toEqual(scanlines(64, 200, 3, candidate.data));
  });
});

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

/** The outcome for one marker, as a string, so the assertions read as English. */
function verdicts(result: ReturnType<typeof pairPageFigures>): string[] {
  return result.outcomes.map((o) => (o.status === "paired" ? `paired:${o.key}` : `refused:${o.reason}`));
}

describe("pairPageFigures", () => {
  it("attaches when a page holds exactly one marker and exactly one usable raster", () => {
    const result = pairPageFigures({
      markers: [marker({ ref: "r1", page: 3 })],
      candidates: [rgb(4, 4, [1, 2, 3], { page: 3, key: "img_p2_1" })],
    });
    expect(verdicts(result)).toEqual(["paired:img_p2_1"]);
    expect(result.unclaimed).toEqual([]);
  });

  it("attaches through a blank overlay, whichever order it was painted in", () => {
    /* This is the target document: every figure page carries the picture and a
       fully transparent overlay, and on p11 the real one is painted first while
       on p16 it is second. Anything that assumed an order is already wrong. */
    const picture = rgb(4, 4, [1, 2, 3], { page: 3, key: "img_p2_2" });
    const overlay = rgba(8, 2, [255, 255, 255, 0], { page: 3, key: "img_p2_1" });
    for (const candidates of [
      [overlay, picture],
      [picture, overlay],
    ]) {
      const result = pairPageFigures({ markers: [marker({ page: 3 })], candidates });
      expect(verdicts(result)).toEqual(["paired:img_p2_2"]);
    }
  });

  it("refuses two markers on one page, and drops neither", () => {
    const result = pairPageFigures({
      markers: [marker({ ref: "r1", page: 3, ordinal: 1 }), marker({ ref: "r2", page: 3, ordinal: 2 })],
      candidates: [rgb(4, 4, [1, 2, 3], { page: 3 })],
    });
    expect(verdicts(result)).toEqual(["refused:ambiguous", "refused:ambiguous"]);
    expect(result.outcomes.map((o) => o.marker.ref)).toEqual(["r1", "r2"]);
  });

  it("refuses two usable rasters under one caption", () => {
    /* The wrong one of these under that caption is a claim about the paper the
       reader has no way to check. */
    const result = pairPageFigures({
      markers: [marker({ page: 7 })],
      candidates: [
        rgb(4, 4, [1, 2, 3], { page: 7, key: "a" }),
        rgb(4, 4, [4, 5, 6], { page: 7, key: "b" }),
      ],
    });
    expect(verdicts(result)).toEqual(["refused:ambiguous"]);
    /* And both pictures are recorded as having gone nowhere. That is the
       measurement the next version needs before it can argue that order- or
       geometry-matching would have been safe here. */
    expect(result.unclaimed).toEqual([
      { page: 7, key: "a" },
      { page: 7, key: "b" },
    ]);
  });

  it("says no-raster for a marker whose page offers nothing usable", () => {
    expect(verdicts(pairPageFigures({ markers: [marker({ page: 5 })], candidates: [] }))).toEqual([
      "refused:no-raster",
    ]);
    const onlyBlank = pairPageFigures({
      markers: [marker({ page: 5 })],
      candidates: [rgba(4, 4, [0, 0, 0, 0], { page: 5 })],
    });
    expect(verdicts(onlyBlank)).toEqual(["refused:no-raster"]);
  });

  it("keeps the refusal's own name when the only raster was refused, not blank", () => {
    const result = pairPageFigures({
      markers: [marker({ page: 5 })],
      candidates: [{ ...rgb(4, 4, [0, 0, 0], { page: 5 }), kind: 1, data: new Uint8Array(2) }],
    });
    expect(verdicts(result)).toEqual(["refused:grayscale-1bpp"]);
  });

  it("records a usable raster no marker claimed, and invents no marker for it", () => {
    /* Page 1's masthead and Kuhn's logo arrive this way: a real picture on a
       page the model gave no figure record. It is recorded and not attached. */
    const result = pairPageFigures({
      markers: [],
      candidates: [rgb(4, 4, [1, 2, 3], { page: 1, key: "img_p0_1" })],
    });
    expect(result.outcomes).toEqual([]);
    expect(result.unclaimed).toEqual([{ page: 1, key: "img_p0_1" }]);
  });

  it("does not let one page's raster reach another page's caption", () => {
    /* **The picture is on the SECOND marker's page, deliberately.** GPT Sol
       found the first version of this test asserting almost nothing: its raster
       sat on page 3 and the page-3 marker came first, so an implementation that
       simply handed the first raster to the first marker — the obvious wrong
       one — satisfied it exactly. Putting the picture behind the later caption
       is what makes this a claim about grouping rather than about order. */
    const result = pairPageFigures({
      markers: [marker({ ref: "r1", page: 3 }), marker({ ref: "r2", page: 4 })],
      candidates: [rgb(4, 4, [1, 2, 3], { page: 4, key: "four" })],
    });
    expect(verdicts(result)).toEqual(["refused:no-raster", "paired:four"]);
  });

  it("gives every marker exactly one entry, in the order they were given", () => {
    /* Sol D4-3: none may vanish. "We looked and refused" and "we never looked"
       are different facts about the same blank space, and only the manifest
       can tell them apart. */
    const markers = [
      marker({ ref: "r1", page: 3 }),
      marker({ ref: "r2", page: 4 }),
      marker({ ref: "r3", page: 4 }),
      marker({ ref: "r4", page: 9 }),
    ];
    const result = pairPageFigures({
      markers,
      candidates: [
        rgb(4, 4, [1, 2, 3], { page: 3, key: "a" }),
        rgb(4, 4, [1, 2, 3], { page: 4, key: "b" }),
        rgba(4, 4, [0, 0, 0, 0], { page: 9, key: "c" }),
      ],
    });
    expect(result.outcomes.map((o) => o.marker.ref)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(verdicts(result)).toEqual([
      "paired:a",
      "refused:ambiguous",
      "refused:ambiguous",
      "refused:no-raster",
    ]);
  });

  it("refuses to carry on if a marker is offered twice", () => {
    /* The internal invariant, stated where it can fail: one image per marker,
       one marker per image. A duplicate ref means whatever minted them lost
       the page or the ordinal, and pairing on top of that would attach a
       picture to a caption that is not the one it came with. */
    const twice = [marker({ ref: "same", page: 3 }), marker({ ref: "same", page: 4 })];
    expect(() =>
      pairPageFigures({ markers: twice, candidates: [rgb(4, 4, [1, 2, 3], { page: 3 })] }),
    ).toThrow(/ref/);
  });
});

/* ------------------------------------------------------------------ *
 * The ref
 * ------------------------------------------------------------------ */

describe("pdfFigureRef", () => {
  const base = { rawSha256: SHA, page: 3, ordinal: 1, caption: "Figure 1. A plot." };

  it("is the same string every time for the same figure", () => {
    expect(pdfFigureRef(base)).toBe(pdfFigureRef({ ...base }));
    expect(pdfFigureRef(base)).toMatch(/^pdffig1-[0-9a-f]{32}$/);
  });

  it("mints this exact string, which every other test here would let change", () => {
    /* **A golden vector, because a ref is a stored identifier.** GPT Sol,
       reviewing stage A: every other assertion in this block pins determinism,
       shape, or sensitivity to one field, and all of them would still pass if
       the separator, the field order, the caption-hashing scheme or the outer
       algorithm changed. The refs sitting in a stored manifest would then stop
       matching the refs sitting in the stored html — and nothing would say so,
       because `PDF_FIGURE_REF_VERSION` would still be `pdffig1`. That is the
       exact failure the version tag exists to make visible, happening under the
       version that promised it had not.

       So the literal is the contract. When this goes red the answer is almost
       never to update the number: it is to bump the version tag, because every
       ref already stored under the old scheme has just stopped meaning what it
       says. */
    expect(pdfFigureRef(base)).toBe("pdffig1-36aeeb468c2fc161037b25d138d539f2");
  });

  it("changes when the PDF does", () => {
    /* The one that matters. Assets are carried into a new revision, so a ref
       that meant "page 3" would happily serve the previous document's page
       three under the new document's caption. */
    expect(pdfFigureRef({ ...base, rawSha256: "b".repeat(64) })).not.toBe(pdfFigureRef(base));
  });

  it("changes with the page, the ordinal and the caption", () => {
    expect(pdfFigureRef({ ...base, page: 4 })).not.toBe(pdfFigureRef(base));
    expect(pdfFigureRef({ ...base, ordinal: 2 })).not.toBe(pdfFigureRef(base));
    expect(pdfFigureRef({ ...base, caption: "Figure 1. A different plot." })).not.toBe(pdfFigureRef(base));
  });

  it("does not confuse a page with an ordinal", () => {
    /* Joining the fields with nothing between them would make 1/23 and 12/3
       the same figure. */
    expect(pdfFigureRef({ ...base, page: 1, ordinal: 23 })).not.toBe(
      pdfFigureRef({ ...base, page: 12, ordinal: 3 }),
    );
  });

  it("is unmoved by whitespace the renderer might change", () => {
    expect(pdfFigureRef({ ...base, caption: "  Figure 1.\n A plot. " })).toBe(pdfFigureRef(base));
  });

  it("refuses to mint a ref from something that is not a PDF hash", () => {
    /* Fail loudly here rather than quietly minting a ref that no lookup can
       ever match. */
    for (const rawSha256 of ["", "abc", SHA.toUpperCase(), `${SHA}00`]) {
      expect(() => pdfFigureRef({ ...base, rawSha256 })).toThrow();
    }
    expect(() => pdfFigureRef({ ...base, page: 0 })).toThrow();
    expect(() => pdfFigureRef({ ...base, ordinal: 1.5 })).toThrow();
  });
});
