/**
 * **The figures a PDF came with, and the rules that decide whether a reader
 * ever sees one.**
 *
 * The pure half of recovering them: is a decoded raster well-formed, does it
 * draw anything at all, what does it look like as a PNG, and which caption — if
 * any — is allowed to claim it. **No pdf.js, no PDF, no network, no store, no
 * jsdom.** Everything here is decided on plain arrays of bytes, so every rule
 * has a test that can be adversarial about it without a document in the room.
 * src/assets.ts is the same shape for the same reason, and its header says so.
 *
 * Stage A of
 * docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md; the
 * measurements below are that plan's, taken 2026-09-06. Reading the XObjects
 * out of a real document is stage B, and lives elsewhere on purpose: the
 * lifetime of a pdf.js worker has nothing to teach the rules in this file.
 *
 * ## 1. Blankness is exact, and it is the only rule of its kind
 *
 * Half the image operations in the target document draw nothing. Every figure
 * page carries the picture **and** a caption backing box painted as an image,
 * and measured across the whole corpus the separation is total:
 *
 * | document | images | opaque pixels |
 * | --- | --- | --- |
 * | Analog Cognition | the 8 overlays | **0.0%** — every alpha byte zero |
 * | Analog Cognition | the 8 real figures | 32.5–100% |
 * | Kuhn | a 119×119 logo | 100% |
 * | ball lightning | all 5, masthead included | 100% |
 *
 * So the rule is *an image with no opaque byte in it draws nothing*, and there
 * is no constant in it to tune and no document it was fitted to.
 *
 * **The clause that is deliberately absent is the interesting one.** The first
 * draft also discarded an image whose pixels were all within tolerance of one
 * colour. Nothing in the corpus needs it, and it introduces the one false
 * negative that matters: a near-white line diagram, a faint grid or a solid
 * plate deleted with nobody told. Keeping a flat rectangle is visible; deleting
 * a real figure is silent. GPT Sol, D3-2. An earlier, compression-based rule —
 * deflated bytes per pixel — is absent for the same reason with evidence
 * attached: it called Kuhn's 58-colour logo blank.
 *
 * `RGB_24BPP` is never blank. It carries no alpha, so "draws nothing" is not a
 * claim its bytes can support.
 *
 * ## 2. Validate before allocating, and refuse a kind rather than guessing
 *
 * `data.length === width * height * 4` means a 5000×4000 raster is 80 MB of
 * decoded bytes inside the same function the pipeline runs in, with no
 * rasteriser to downscale with. Dimensions are therefore checked as *numbers*,
 * before the byte count is looked at, so an oversized image costs arithmetic
 * rather than memory. Sol I-6, Fable.
 *
 * `GRAYSCALE_1BPP` gets refused with its own word. Nothing in the corpus
 * produces one — which is exactly why: if one turns up, the manifest should say
 * *this document had a kind we do not read* rather than folding it in with the
 * unknown kinds, and rather than the far worse alternative of calling it blank.
 * Packed bits are not bytes, so every length check here would be wrong about it.
 *
 * ## 3. One marker, one raster, or nothing at all
 *
 * The gate attaches a picture to a caption **only** when a page holds exactly
 * one figure marker and exactly one usable raster. Not the biggest, not the
 * first, not the nearest.
 *
 * > A picture under the wrong caption is a fabricated claim about the paper,
 * > rendered at the verbatim level with the app's authority behind it, and the
 * > reader has no way to detect it. A missing figure is visible; a swapped one
 * > looks correct.
 * >
 * > — Fable, arbitrating this on 2026-09-06
 *
 * Order carries no information either: on p11 of the target document the real
 * image is painted before the overlay and on p16 after it.
 *
 * **Every marker gets an outcome, paired or refused, and none may vanish.**
 * That is the same distinction `AssetFailure`'s `out-of-time` exists to keep in
 * src/assets.ts — *we looked and refused* and *we never looked* are different
 * facts about the same blank space, and only the manifest can tell them apart.
 *
 * ## 4. The ref is opaque because assets outlive the document they came from
 *
 * A stored asset is carried into a new revision (src/store/pg-revisions.ts), so
 * a ref of `page:3` would cheerfully serve the *previous* PDF's page three
 * under the new document's caption. `pdfFigureRef` mints one from a version
 * tag, the raw PDF's sha256, the page, the figure's ordinal on that page and a
 * digest of the caption, so an exact-match lookup fails closed until extraction
 * runs again. Sol D1-5.
 */
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { deflate } from "node:zlib";

import { imageDimensions, sniffImage } from "./assets.js";

const deflateAsync = promisify(deflate);

/* ------------------------------------------------------------------ *
 * Rasters
 * ------------------------------------------------------------------ */

/**
 * The `kind` numbers pdf.js stamps on a decoded image. Its own names, kept
 * because the only place they are ever compared against is a buffer that came
 * from it.
 */
export const PDFJS_GRAYSCALE_1BPP = 1;
export const PDFJS_RGB_24BPP = 2;
export const PDFJS_RGBA_32BPP = 3;

/**
 * The most pixels we will carry through this module.
 *
 * A guard, not a corpus-derived claim: the largest figure measured anywhere in
 * the corpus is 2067 px wide and nowhere near this. 12 million pixels is 48 MB
 * as RGBA, which is survivable in one function invocation and ruinous as a
 * habit.
 *
 * **The real cap has to be pdf.js's own** — `getDocument({ maxImageSize })`,
 * which checks width × height *before* decoding, because by the time an
 * operator list exists the buffer has already been built and sent. That belongs
 * to stage B; this one is the backstop for anything that gets here anyway, and
 * for the arithmetic below, which must not overflow.
 */
export const MAX_FIGURE_PIXELS = 12_000_000;

/**
 * One image pdf.js handed back on one page, exactly as it came.
 *
 * `width`, `height` and `kind` are **claims** until `classifyRaster` has looked
 * at them — that is the whole reason this type is separate from
 * `DecodedRaster` below, which only that function can produce.
 */
export interface RasterCandidate {
  /** 1-based, the way a reader counts pages. */
  page: number;
  /** pdf.js's own object key (`img_p2_1`). Diagnostics and pinning only. */
  key: string;
  width: number;
  height: number;
  kind: number;
  data: Uint8Array;
}

/** The two layouts we read. Named rather than numbered, past the validator. */
export type RasterKind = "rgb" | "rgba";

/** Bytes per pixel, by layout. */
export const CHANNELS: Record<RasterKind, 3 | 4> = { rgb: 3, rgba: 4 };

/**
 * A raster that has been checked: positive whole dimensions inside the cap, a
 * kind we read, and a byte count that is exactly right for both.
 *
 * **Only `classifyRaster` constructs one**, which is what lets everything
 * downstream — the encoder above all — index `data` without asking again.
 *
 * `data` is **the candidate's own buffer, not a copy**: copying four megabytes
 * per figure to re-read them once would be a real cost for no benefit here. It
 * does mean the buffer belongs to whoever decoded it, so stage B has to encode
 * a raster before it destroys the pdf.js document the bytes came from.
 */
export interface DecodedRaster {
  readonly kind: RasterKind;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/**
 * Why a raster was not usable — and none of these is *blank*, which is a
 * separate verdict about pixels rather than about the image's shape.
 *
 * Written for a human reading a manifest six months from now, in the spirit of
 * `AssetFailure` (src/assets.ts). `bad-dimensions` and `byte-count-mismatch`
 * are kept apart because they say different things about where the fault is:
 * the first is a header we do not believe, the second is a buffer that does not
 * match a header we did.
 */
export type RasterRefusal =
  /** A `kind` we do not read at all. Not blank — see the header. */
  | "unsupported-kind"
  /**
   * `GRAYSCALE_1BPP`. Its own word rather than `unsupported-kind`, because the
   * corpus never produced one and the day a document does, that is the thing
   * worth learning from the manifest rather than a fact averaged away.
   */
  | "grayscale-1bpp"
  | "bad-dimensions"
  | "too-many-pixels"
  | "byte-count-mismatch";

/** What we make of one candidate. */
export type RasterVerdict =
  | { status: "usable"; raster: DecodedRaster }
  /** Every alpha byte is zero: it paints nothing, and it is not a failure. */
  | { status: "blank" }
  | { status: "refused"; reason: RasterRefusal };

/**
 * Is this decoded image worth keeping, and can we trust its shape?
 *
 * The order is deliberate and is the part to preserve: **kind, then dimensions,
 * then the pixel cap, then the byte count, then blankness.** Everything before
 * the byte count is arithmetic on three numbers, so a raster claiming to be
 * 40,000 × 40,000 is refused without anything touching a buffer. Sol I-6.
 *
 * The overflow-safe step is checking each side against the cap *before*
 * multiplying: `width * height` for two safe integers can be 2^80, which a
 * double rounds, and a rounded comparison is one that can pass. Once both sides
 * are inside the cap the product is under 1.5e14 and exact, and so is the byte
 * count that follows.
 */
export function classifyRaster(candidate: RasterCandidate): RasterVerdict {
  const kind = rasterKind(candidate.kind);
  if (typeof kind !== "string") return { status: "refused", reason: kind.reason };

  const { width, height } = candidate;
  if (!isPositiveWholeNumber(width) || !isPositiveWholeNumber(height)) {
    return { status: "refused", reason: "bad-dimensions" };
  }
  if (width > MAX_FIGURE_PIXELS || height > MAX_FIGURE_PIXELS) {
    return { status: "refused", reason: "too-many-pixels" };
  }
  if (width * height > MAX_FIGURE_PIXELS) return { status: "refused", reason: "too-many-pixels" };

  if (candidate.data.length !== width * height * CHANNELS[kind]) {
    return { status: "refused", reason: "byte-count-mismatch" };
  }

  if (kind === "rgba" && isFullyTransparent(candidate.data)) return { status: "blank" };
  return { status: "usable", raster: { kind, width, height, data: candidate.data } };
}

/** pdf.js's number, or the reason we will not read it. */
function rasterKind(kind: number): RasterKind | { reason: RasterRefusal } {
  if (kind === PDFJS_RGB_24BPP) return "rgb";
  if (kind === PDFJS_RGBA_32BPP) return "rgba";
  if (kind === PDFJS_GRAYSCALE_1BPP) return { reason: "grayscale-1bpp" };
  return { reason: "unsupported-kind" };
}

function isPositiveWholeNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Every fourth byte, and it must be **exactly** zero.
 *
 * No tolerance, and that is the point: alpha 1 out of 255 is invisible to a
 * person and is still a drawing instruction, so there is no threshold here for
 * anybody to argue about later.
 */
function isFullyTransparent(data: Uint8Array): boolean {
  for (let at = 3; at < data.length; at += 4) {
    if (data[at] !== 0) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * The PNG
 * ------------------------------------------------------------------ */

/**
 * A validated raster as a minimal PNG: 8 bits, no interlacing, filter 0 on
 * every scanline, colour type 2 for RGB and 6 for RGBA.
 *
 * **Re-encoded rather than passed through**, even where the PDF held a JPEG:
 * it drops whatever ancillary metadata the document carried and lets the route
 * that serves it state a content type it can stand behind. PNG rather than
 * anything smaller because re-encoding to JPEG needs either the banned native
 * decoder — `@napi-rs/canvas` is 34 MB of Vercel bundle and
 * tests/pdf-bundle-trace.test.ts refuses it — or an encoder to maintain. Sol
 * D5-1, and the same decision src/illustrated-image.ts already made.
 *
 * **Written by hand rather than taken from a dependency**, which is the choice
 * `SIGNATURES` in src/assets.ts made and gives its reasons for. A filter-0 PNG
 * is a length, a type, a payload and a CRC, four times over.
 *
 * **The deflate is async, and it matters.** `deflateSync` on a multi-megabyte
 * raster blocks the whole process: the stage's wall-clock budget stops meaning
 * anything while one figure encodes, and unrelated requests in the same
 * function wait behind it. Sol D5-5.
 *
 * The result is checked against src/assets.ts's own reader — signature and
 * IHDR dimensions — before it is handed back, because those two files arrive at
 * a PNG's header from opposite directions and a disagreement between them is
 * the cheapest possible witness that this writer is wrong. Sol D5-1.
 */
export async function encodeFigurePng(raster: DecodedRaster): Promise<Uint8Array> {
  const { width, height, kind } = raster;
  const channels = CHANNELS[kind];
  const stride = width * channels;

  /* One filter byte per row, then the row. Filter 0 — "none" — because the
     alternatives buy compression at the price of a per-row heuristic, and the
     figures this handles are already the small half of the article's bytes. */
  const raw = Buffer.allocUnsafe(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const at = y * (1 + stride);
    raw[at] = 0;
    raw.set(raster.data.subarray(y * stride, (y + 1) * stride), at + 1);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = kind === "rgba" ? 6 : 2; // truecolour, with alpha or without
  ihdr[10] = 0; // compression: deflate, the only one there is
  ihdr[11] = 0; // filter method: adaptive, the only one there is
  ihdr[12] = 0; // interlace: none

  const idat = await deflateAsync(raw);

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  const bytes = new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
  const sniffed = sniffImage(bytes);
  const dimensions = imageDimensions(bytes);
  if (sniffed?.ext !== "png" || dimensions?.width !== width || dimensions.height !== height) {
    throw new Error(`pdf-figures: wrote a PNG that does not read back as ${width}×${height}`);
  }
  return bytes;
}

/** Length, type, payload, CRC over the type and the payload. */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.allocUnsafe(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * The reflected CRC-32 every PNG chunk ends with, table built once.
 *
 * `node:zlib` exports a `crc32` of its own, and this is not it — deliberately.
 * The test inflates and re-checks the output with *that* one, so a mistake in
 * this table is a red test rather than a file some viewers open and others
 * refuse.
 */
const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

/**
 * One `<figure>` in the article that came from a PDF page, as the renderer
 * wrote it.
 *
 * `ref` is `pdfFigureRef`'s output and is the only thing that survives into the
 * stored HTML; `page` and `ordinal` are here so the gate can group without
 * having to invert an opaque string.
 */
export interface FigureMarker {
  ref: string;
  /** 1-based. */
  page: number;
  /** Which figure this is on that page, 1-based. */
  ordinal: number;
}

/**
 * Why a marker ends up with no picture. `RasterRefusal` plus the two verdicts
 * that are about the *page* rather than about any one image.
 *
 * Stage A produces exactly these. The step that stores the bytes will need more
 * — an encode that failed, a bucket that was down, a budget that ran out — and
 * they belong in this union when there is code that can produce them, not
 * before.
 */
export type PdfFigureFailure =
  | RasterRefusal
  /**
   * The page did not hold exactly one marker and exactly one usable raster. Two
   * captions, two pictures, or both: we refuse rather than choose. See the
   * header.
   */
  | "ambiguous"
  /**
   * The page offered nothing to attach — no image operations at all, or nothing
   * left after the blank overlays. The commonest outcome by far, and an honest
   * one: a vector-drawn figure gets nothing from this route.
   */
  | "no-raster";

/** What became of one marker. Exactly one of these exists per marker. */
export type FigureOutcome =
  | {
      status: "paired";
      marker: FigureMarker;
      /** The candidate's pdf.js key, so stage B can pin this against a document. */
      key: string;
      raster: DecodedRaster;
    }
  | { status: "refused"; marker: FigureMarker; reason: PdfFigureFailure };

export interface FigurePairing {
  /** One entry per marker, in the order the markers arrived. */
  outcomes: FigureOutcome[];
  /**
   * Usable rasters that ended up attached to nothing — a masthead on page 1, a
   * publisher's logo, a full-page scan, **and both pictures on a page the gate
   * called ambiguous**. Recorded rather than dropped so that the next version
   * can measure what refusing them cost: the marker's own `ambiguous` says a
   * caption got nothing, and this says what was standing next to it.
   */
  unclaimed: { page: number; key: string }[];
}

/**
 * Decide, page by page, which caption gets which picture — and mostly, that
 * none does.
 *
 * **Classification happens in here rather than in the caller**, and that is a
 * safety property rather than a convenience: "usable" is what the gate counts,
 * so no caller may be in a position to count something else. Hand it the raw
 * candidates.
 *
 * Throws if the markers it was given are not distinct, which is a bug in
 * whatever minted them rather than a condition of the document. Sol D2-2 asks
 * for the invariant to be asserted rather than assumed; the assertion is here,
 * before anything is attached, because the failure it guards against — one
 * picture reaching two captions, or a ref that means two figures — is precisely
 * the silent corruption the whole gate exists to prevent.
 */
export function pairPageFigures(input: {
  markers: readonly FigureMarker[];
  candidates: readonly RasterCandidate[];
}): FigurePairing {
  assertDistinctRefs(input.markers);

  const markersByPage = new Map<number, FigureMarker[]>();
  for (const marker of input.markers) push(markersByPage, marker.page, marker);

  const { usableByPage, refusalByPage } = classifyByPage(input.candidates);
  const claimed = new Set<string>();
  const outcomes: FigureOutcome[] = [];
  for (const marker of input.markers) {
    const markersHere = markersByPage.get(marker.page) ?? [];
    const usableHere = usableByPage.get(marker.page) ?? [];
    if (markersHere.length !== 1 || usableHere.length > 1) {
      outcomes.push({ status: "refused", marker, reason: "ambiguous" });
      continue;
    }
    const only = usableHere[0];
    if (!only) {
      outcomes.push({
        status: "refused",
        marker,
        reason: refusalByPage.get(marker.page) ?? "no-raster",
      });
      continue;
    }
    claimed.add(`${marker.page}\u0000${only.key}`);
    outcomes.push({ status: "paired", marker, key: only.key, raster: only.raster });
  }

  const unclaimed: { page: number; key: string }[] = [];
  for (const [page, list] of usableByPage) {
    for (const { key } of list) {
      if (!claimed.has(`${page}\u0000${key}`)) unclaimed.push({ page, key });
    }
  }

  assertNothingVanishedOrDoubled(input.markers, outcomes);
  return { outcomes, unclaimed };
}

/** One usable picture on one page, and the key it came back under. */
interface UsableRaster {
  key: string;
  raster: DecodedRaster;
}

/**
 * Every candidate judged once, gathered by page.
 *
 * The **first refusal** on a page is kept beside the usable list so that a page
 * whose only image was a kind we do not read reports that, rather than the
 * generic `no-raster` — the difference between "this document has figures we
 * could learn to read" and "this document's figures are vectors".
 */
function classifyByPage(candidates: readonly RasterCandidate[]): {
  usableByPage: Map<number, UsableRaster[]>;
  refusalByPage: Map<number, RasterRefusal>;
} {
  const usableByPage = new Map<number, UsableRaster[]>();
  const refusalByPage = new Map<number, RasterRefusal>();
  for (const candidate of candidates) {
    const verdict = classifyRaster(candidate);
    if (verdict.status === "blank") continue;
    if (verdict.status === "refused") {
      if (!refusalByPage.has(candidate.page)) refusalByPage.set(candidate.page, verdict.reason);
      continue;
    }
    push(usableByPage, candidate.page, { key: candidate.key, raster: verdict.raster });
  }
  return { usableByPage, refusalByPage };
}

function push<T>(byPage: Map<number, T[]>, page: number, value: T): void {
  const list = byPage.get(page);
  if (list) list.push(value);
  else byPage.set(page, [value]);
}

/**
 * Two markers with one ref is a bug in whatever minted them — a lost page or a
 * lost ordinal — and pairing on top of it would attach a picture to a caption
 * it did not come with. Refuse the whole document rather than half of it.
 */
function assertDistinctRefs(markers: readonly FigureMarker[]): void {
  const seen = new Set<string>();
  for (const marker of markers) {
    if (seen.has(marker.ref)) {
      throw new Error(`pdf-figures: two figure markers share the ref ${marker.ref}`);
    }
    seen.add(marker.ref);
  }
}

/**
 * The two things that must be true of any pairing, checked rather than trusted.
 *
 * Both failures are invisible from the outside — a marker silently absent from
 * the manifest reads exactly like a figure the reader was never promised, and a
 * raster attached twice reads exactly like two figures that happen to look
 * alike. Neither can be caught downstream, so it is caught here.
 */
function assertNothingVanishedOrDoubled(
  markers: readonly FigureMarker[],
  outcomes: readonly FigureOutcome[],
): void {
  if (outcomes.length !== markers.length) {
    throw new Error(`pdf-figures: ${markers.length} markers produced ${outcomes.length} outcomes`);
  }
  const usedRefs = new Set<string>();
  const usedImages = new Set<string>();
  for (const outcome of outcomes) {
    if (usedRefs.has(outcome.marker.ref)) {
      throw new Error(`pdf-figures: the ref ${outcome.marker.ref} was decided twice`);
    }
    usedRefs.add(outcome.marker.ref);
    if (outcome.status !== "paired") continue;
    const image = `${outcome.marker.page}\u0000${outcome.key}`;
    if (usedImages.has(image)) {
      throw new Error(`pdf-figures: the image ${outcome.key} was attached to two captions`);
    }
    usedImages.add(image);
  }
}

/* ------------------------------------------------------------------ *
 * The ref
 * ------------------------------------------------------------------ */

/**
 * The version tag every ref carries. Bump it when anything about what a ref
 * *means* changes — which page numbering, which caption text — so that every
 * carried-forward entry stops matching at once instead of matching wrongly.
 */
export const PDF_FIGURE_REF_VERSION = "pdffig1";

/**
 * The opaque name for one figure in one PDF.
 *
 * Opaque because a legible one would be a lie waiting to happen: a stored asset
 * is carried into a new revision (src/store/pg-revisions.ts), so a ref meaning
 * "page 3" would keep matching after the document underneath it changed, and
 * the reader would be shown the old document's page three under the new
 * document's caption with nothing anywhere reporting a problem. Folding the raw
 * PDF's sha256 in makes an exact-match lookup **fail closed** until extraction
 * has run against the document actually in hand. Sol D1-5.
 *
 * The caption is included because a page can hold more than one figure and
 * because a re-extraction that reads the caption differently is a re-extraction
 * whose refs should not match. It is trimmed and its internal whitespace
 * collapsed first — the renderer's line breaking is not a fact about the paper.
 *
 * The fields are joined with a separator none of them can contain, all of them
 * being hex or a decimal integer: without one, page 1 figure 23 and page 12
 * figure 3 would be the same figure.
 *
 * Throws on anything that is not a lowercase sha256 and two positive whole
 * numbers, because a malformed ref does not fail here — it fails much later, as
 * a lookup that never matches and a figure that never appears.
 */
export function pdfFigureRef(input: {
  rawSha256: string;
  page: number;
  ordinal: number;
  caption: string;
}): string {
  if (!/^[0-9a-f]{64}$/.test(input.rawSha256)) {
    throw new Error("pdf-figures: a figure ref needs the raw PDF's lowercase sha256");
  }
  if (!isPositiveWholeNumber(input.page) || !isPositiveWholeNumber(input.ordinal)) {
    throw new Error(`pdf-figures: bad page/ordinal ${input.page}/${input.ordinal} for a figure ref`);
  }
  const caption = input.caption.replace(/\s+/g, " ").trim();
  const captionDigest = createHash("sha256").update(caption, "utf8").digest("hex");
  const digest = createHash("sha256")
    .update(
      [PDF_FIGURE_REF_VERSION, input.rawSha256, String(input.page), String(input.ordinal), captionDigest].join(
        "\n",
      ),
      "utf8",
    )
    .digest("hex");
  /* Half a sha256. The ref only has to be unguessable-by-accident and unique
     within one article; the whole thing would double the length of an attribute
     that sits in every figure's stored HTML. */
  return `${PDF_FIGURE_REF_VERSION}-${digest.slice(0, 32)}`;
}
