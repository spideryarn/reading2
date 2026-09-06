/**
 * **Recovering the figures a PDF came with** — the second half of the `assets`
 * step, stage 4.5.
 *
 * Three files already own most of this and none of them is allowed to do the
 * others' job, which is the only thing worth knowing before editing here:
 *
 * - [`src/pdf-figures.ts`](pdf-figures.ts) holds every **rule** — is a decoded
 *   raster well-formed, does it draw anything, what does it look like as a PNG,
 *   which caption may claim it. Plain bytes, adversarial tests, no document in
 *   the room.
 * - [`src/pdf-figure-read.ts`](pdf-figure-read.ts) opens the **PDF** and hands
 *   back candidates, with the decode cap on the document and the scanned-page
 *   exclusion applied per page.
 * - [`src/store/blobs.ts`](store/blobs.ts) `storeRawSource` puts bytes under
 *   their own hash, create-only, and verifies a dedup hit rather than believing
 *   it.
 *
 * So what is left for this file is **the sequence and the bookkeeping**, and it
 * is deliberately thin. It is the twin of src/collect-assets.ts and not part of
 * it: that module is a network, a retry policy and a byte budget for URLs, and
 * none of that machinery applies to bytes we already hold. GPT Sol, D4-1.
 *
 * Stage C of
 * docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md.
 *
 * ## 1. Every marker gets an entry, and none may vanish
 *
 * A marker present in the blocks and missing from the manifest is
 * indistinguishable from a figure the reader was never promised. That is the
 * same distinction `AssetFailure`'s `out-of-time` exists to keep in
 * src/assets.ts — *we looked and refused* and *we never looked* are different
 * facts about the same blank space — and it is the one invariant here that
 * cannot be recovered downstream. GPT Sol, D4-3.
 *
 * `pairPageFigures` guarantees one outcome per marker and asserts it; this file
 * carries the guarantee the rest of the way, through an encode that threw, a
 * bucket that was down, a runaway guard and a clock that ran out. **A PDF that
 * will not reopen at all is no exception**: every marker in it gets an
 * `out-of-time` entry rather than the step throwing, because one bad document
 * must no more fail this step than one bad image fails the other half of it.
 *
 * ## 2. The document is opened only when there is something to open it for
 *
 * No markers, no `getDocument`. Three of the seven eval PDFs contain no raster
 * image anywhere and every web article has no PDF at all, so the ordinary case
 * has to cost nothing, and the cheapest way to make that true is to not be
 * called — the step checks `manifest.kind` before it reads a byte.
 *
 * ## 3. What the reader will actually download
 *
 * A cap on the encoded PNG, on the honest grounds — what we would ask a reader
 * to fetch — rather than on the 4.5 MB Vercel limit Sol's D5-2 reached for,
 * which is the **request body** and not the response
 * (docs/project/ingest-queue.md; `sendSource` already ends an entire uploaded
 * PDF through that same function, and `MAX_UPLOAD_BYTES` is 50 MB).
 *
 * The plan's number for that cap was wrong and the measurement is in
 * `MAX_FIGURE_BYTES` below, along with what it costs to keep the figure anyway.
 */

import type { PdfFigureEntry, PdfFigureFailure, PdfFigureMarker } from "./assets.js";
import { imageDimensions, sniffImage } from "./assets.js";
import { describeStorageFailure, MAX_IMAGE_BYTES } from "./collect-assets.js";
import {
  encodeFigurePng,
  type FigureOutcome,
  MAX_FIGURE_PIXELS,
  pairPageFigures,
  type PdfFigureFailure as PairingFailure,
} from "./pdf-figures.js";
import { readPdfRasters } from "./pdf-figure-read.js";
import { type RawSourceStore, storeRawSource } from "./store/blobs.js";

/**
 * The most bytes one recovered figure may be, encoded — **`MAX_IMAGE_BYTES`,
 * because there is no reason for the two halves of this step to have different
 * ideas of how big a picture may be.**
 *
 * **The number the plan gave was wrong, and measuring it is what found that.**
 * The plan says *"the largest figure measured anywhere in the corpus is
 * 756 KB"* and proposes 4 MiB on that basis. That measurement is the *Analog
 * Cognition* document's, and it does not survive the rest of the corpus: the
 * ball-lightning paper's page-3 figure is 2067 × 1741 of photographic RGB and
 * encodes to **9,355,050 bytes** as a filter-0 PNG (run 2026-09-06 against
 * `evals/pdf/harder/source.pdf`). A 4 MiB cap therefore refuses a real figure
 * in the repo's own fixtures, and refuses it silently.
 *
 * That is GPT Sol's SP-3 arriving on the first document that could produce it,
 * and the trade it names is real: the fix for a photograph is a lossy encoder,
 * and re-encoding to JPEG needs either the banned native decoder or an encoder
 * to maintain (Sol D5-1). Until somebody decides that is worth building, the
 * choice is between asking a reader for 9 MB and showing them nothing, and a
 * figure they can see is worth more.
 *
 * A figure over the cap is recorded `too-many-pixels` — the honest reason,
 * since what makes a PNG this large is pixels — rather than dropped.
 */
export const MAX_FIGURE_BYTES = MAX_IMAGE_BYTES;

/**
 * A runaway guard on how many figures one document may have.
 *
 * A hundred is far more than any paper and far less than a malformed
 * transcription could produce. Everything past it is recorded rather than
 * dropped, exactly as `MAX_IMAGES` overflow is in src/collect-assets.ts, so
 * "no entry" keeps meaning "this step never looked at it".
 */
export const MAX_FIGURES = 100;

export interface CollectPdfFiguresOptions {
  /** Every marker in the article's blocks — `pdfFigureMarkersIn`, src/collect-assets.ts. */
  markers: readonly PdfFigureMarker[];
  /** The whole PDF. Copied before pdf.js sees it, by `readPdfRasters`. */
  pdf: Uint8Array;
  blobs?: RawSourceStore;
  signal?: AbortSignal;
  now?: () => Date;
  maxImagePixels?: number;
  maxBytes?: number;
  maxFigures?: number;
}

export interface PdfFiguresRun {
  /** One per marker, in the order the markers arrived. Never shorter. */
  entries: PdfFigureEntry[];
  stored: number;
  failed: number;
  /** Stored bytes that were already ours — two revisions of the same paper. */
  deduped: number;
  bytes: number;
  /**
   * Redacted storage failures, at most a handful, for the step's own log line.
   * Bounded and reused from src/collect-assets.ts rather than re-derived: the
   * lesson there — one string, redacted as one string, cut once at the end — is
   * the whole reason that function is exported.
   */
  storageErrors: string[];
  elapsedMs: number;
}

/**
 * Recover what can be recovered, and record what cannot.
 *
 * Writes nothing but blobs: the manifest goes back to the caller, so the step
 * is the only thing that knows where an artefact lives — the same split
 * `collectAssets` makes, and for the same reason.
 */
export async function collectPdfFigures(
  options: CollectPdfFiguresOptions,
): Promise<PdfFiguresRun> {
  const startedAt = Date.now();
  const now = options.now ?? (() => new Date());
  const at = () => now().toISOString();
  const limit = options.maxFigures ?? MAX_FIGURES;
  const maxBytes = options.maxBytes ?? MAX_FIGURE_BYTES;

  const looked = options.markers.slice(0, limit);
  const overflow = options.markers.slice(limit);

  const run: PdfFiguresRun = {
    entries: [],
    stored: 0,
    failed: 0,
    deduped: 0,
    bytes: 0,
    storageErrors: [],
    elapsedMs: 0,
  };
  const fail = (marker: PdfFigureMarker, reason: PdfFigureFailure): void => {
    run.entries.push({ ref: marker.ref, page: marker.page, status: "failed", reason, at: at() });
    run.failed += 1;
  };

  const read = await readRasters(looked, options);
  if (read === null) {
    /* The document would not open, or the clock ran out inside it. Nothing is
       known about any figure, which is what `out-of-time` says — the one reason
       in the union that is entirely about us rather than about the picture. */
    for (const marker of looked) fail(marker, "out-of-time");
    for (const marker of overflow) fail(marker, "out-of-time");
    run.elapsedMs = Date.now() - startedAt;
    return run;
  }

  const { outcomes } = pairPageFigures({ markers: looked, candidates: read });
  for (const outcome of outcomes) {
    if (outcome.status === "refused") {
      fail(outcome.marker, pdfFigureFailure(outcome.reason));
      continue;
    }
    /* Aborted between figures rather than mid-encode: the deflate is one
       `await` and there is nothing to cancel inside it, so the honest place to
       notice is here, and every marker left gets `out-of-time` below. */
    if (options.signal?.aborted) {
      fail(outcome.marker, "out-of-time");
      continue;
    }
    await storeOne(outcome, { maxBytes, blobs: options.blobs }, run, fail, at);
  }

  /* Past the runaway guard. Recorded rather than dropped, so that "no entry"
     keeps meaning "this step never looked at it" for every marker the article
     has. src/collect-assets.ts makes the same choice for `MAX_IMAGES`. */
  for (const marker of overflow) fail(marker, "out-of-time");

  run.elapsedMs = Date.now() - startedAt;
  return run;
}

/**
 * One paired raster: encode it, check it, store it.
 *
 * **The PNG is sniffed and measured after encoding rather than trusted**, and
 * not only as a formality — `encodeFigurePng` already checks its own output
 * against src/assets.ts's reader and throws if it disagrees. What this adds is
 * the *manifest's* claim: the `ext`, the `contentType` and the `width`/`height`
 * a reader will be served are read back off the bytes we are about to store,
 * which is the same rule `sniffImage` enforces for a downloaded image — the
 * name we store is a promise about the file.
 */
async function storeOne(
  outcome: Extract<FigureOutcome, { status: "paired" }>,
  limits: { maxBytes: number; blobs: RawSourceStore | undefined },
  run: PdfFiguresRun,
  fail: (marker: PdfFigureMarker, reason: PdfFigureFailure) => void,
  at: () => string,
): Promise<void> {
  let png: Uint8Array;
  try {
    png = await encodeFigurePng(outcome.raster);
  } catch {
    /* Nothing of the error is kept. It can only be our own writer disagreeing
       with our own reader — `encodeFigurePng` is the only thing that throws —
       and that is a bug to find in a test, not a sentence to put in a manifest
       a stranger can read (Sol I-9). */
    fail(outcome.marker, "encode-failed");
    return;
  }
  if (png.byteLength > limits.maxBytes) {
    fail(outcome.marker, "too-many-pixels");
    return;
  }
  const sniffed = sniffImage(png);
  const size = imageDimensions(png);
  if (!sniffed || !size) {
    fail(outcome.marker, "encode-failed");
    return;
  }
  try {
    const put = limits.blobs
      ? await storeRawSource(png, sniffed.ext, limits.blobs)
      : await storeRawSource(png, sniffed.ext);
    if (put.outcome === "already-there") run.deduped += 1;
    run.entries.push({
      ref: outcome.marker.ref,
      page: outcome.marker.page,
      status: "stored",
      sha256: put.sha256,
      ext: sniffed.ext,
      contentType: sniffed.contentType,
      bytes: png.byteLength,
      width: size.width,
      height: size.height,
    });
    run.stored += 1;
    run.bytes += png.byteLength;
  } catch (err) {
    /* A `CorruptObject` at a canonical name, a Storage outage, a bug. Carried
       past, because one figure must never fail the step — and handed to the
       caller to log, because this module is not in src/log.ts's component list
       and the step already owns a `pipeline` logger. src/collect-assets.ts. */
    if (run.storageErrors.length < 5) run.storageErrors.push(describeStorageFailure(err));
    run.entries.push({
      ref: outcome.marker.ref,
      page: outcome.marker.page,
      status: "failed",
      reason: "storage",
      at: at(),
    });
    run.failed += 1;
  }
}

/**
 * The candidates, or `null` when the document itself could not be read.
 *
 * **`null` rather than a throw**, and the difference is what the reader sees: a
 * PDF that will not reopen is a fault worth recording against every figure in
 * it, and it must not take the whole `assets` step — and therefore the
 * article's web images — down with it. One bad document must never fail the
 * step is the same rule `collectAssets` states about one bad image.
 */
async function readRasters(
  markers: readonly PdfFigureMarker[],
  options: CollectPdfFiguresOptions,
): Promise<Awaited<ReturnType<typeof readPdfRasters>>["candidates"] | null> {
  if (markers.length === 0) return [];
  try {
    const read = await readPdfRasters({
      data: options.pdf,
      /* One page per marker; `readPdfRasters` sorts and de-duplicates, so two
         figures on page 7 do not decode page 7 twice. */
      pages: markers.map((m) => m.page),
      maxImagePixels: options.maxImagePixels ?? MAX_FIGURE_PIXELS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return read.candidates;
  } catch {
    return null;
  }
}

/**
 * The gate's reason, as the manifest's reason.
 *
 * **Exhaustive over `PdfFigureFailure` from src/pdf-figures.ts with no default
 * arm**, so a reason added there is a typecheck failure here rather than a
 * figure filed under whatever the fallback happened to be. `FAILURE_FOR` in
 * src/collect-assets.ts is the same shape for the same reason.
 *
 * The two unions are spelled separately rather than shared because src/assets.ts
 * is on the browser's side of the fence and src/pdf-figures.ts reaches for
 * `node:crypto` and `node:zlib`; this function is the seam that keeps them
 * honest.
 */
function pdfFigureFailure(reason: PairingFailure): PdfFigureFailure {
  switch (reason) {
    case "no-raster":
      return "no-raster";
    case "ambiguous":
      return "ambiguous";
    case "unsupported-kind":
      return "unsupported-kind";
    case "grayscale-1bpp":
      return "grayscale-1bpp";
    case "bad-dimensions":
      return "bad-dimensions";
    case "too-many-pixels":
      return "too-many-pixels";
    case "byte-count-mismatch":
      return "byte-count-mismatch";
    default: {
      const never: never = reason;
      throw new Error(`collect-pdf-figures: unmapped pairing failure ${String(never)}`);
    }
  }
}
