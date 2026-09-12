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
 * bucket that was down, a runaway guard, an article's byte budget and a clock
 * that ran out. **A PDF that will not reopen at all is no exception**: every
 * marker in it gets an `unreadable-pdf` entry rather than the step throwing,
 * because one bad document must no more fail this step than one bad image fails
 * the other half of it.
 *
 * **The clock is what makes the guarantee true rather than intended**, and it
 * was missing until 2026-09-06. Nothing between the deflate and the `put` takes
 * a signal, so a bucket that accepted a call and never answered meant this
 * function never returned at all — the invariant failing by never finishing,
 * which neither abort test could see because one starts already aborted and the
 * other rejects immediately. The whole run is now raced against
 * `PDF_FIGURES_BUDGET_MS` and every marker the race leaves behind is finalised
 * `out-of-time`, which is the shape src/collect-assets.ts already uses and gives
 * its reasons for. GPT Sol, C-1.
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
 * **The cap turned out to be the wrong instrument, though.** A photographic
 * figure encodes to 9 MB as a filter-0 PNG, and the only choices a byte cap
 * offers are refusing it or shipping it. Greg's answer on 2026-09-06 was
 * neither: `downscaleRaster` (src/pdf-figures.ts) throws away the resolution
 * the reading view was never going to render, in `storeOne` below, immediately
 * before the encode. The cap stays as a backstop, and `MAX_FIGURE_BYTES` has
 * the measurements and the arithmetic that now put it out of reach.
 *
 * ## 4. A figure drawn rather than pictured gets a second route
 *
 * docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md. A marker the bitmap
 * route refused `no-raster` — and only that refusal — is handed to it, when the
 * article supplied the marker's caption. Three more files, each owning one
 * thing: src/pdf-figure-layout.ts reads what is drawn where,
 * src/pdf-figure-region.ts decides which of it is this caption's (or, mostly,
 * that none is), and src/pdf-figure-render.ts draws that rectangle with PDFium.
 * src/pdf-figure-page.ts cuts the page PDFium is handed and walks its resources
 * for an image pdf.js may have dropped.
 *
 * What comes out is a raster like any other, and it is stored by the same
 * `storeOne` — the same downscale, caps, article budget and clock. What does
 * not come out keeps a word: `no-raster` when the page was not the narrow case
 * at all, `not-located`, `too-complex` or `render-failed` when it was.
 */

import type { PdfFigureEntry, PdfFigureFailure, PdfFigureMarker } from "./assets.js";
import { imageDimensions, sniffImage } from "./assets.js";
import { describeStorageFailure } from "./collect-assets.js";
import { readPdfPageLayouts } from "./pdf-figure-layout.js";
import { type FigurePage, type FigurePages, openFigurePages } from "./pdf-figure-page.js";
import { type DrawnFigureVerdict, locateDrawnFigure, type PageLayout } from "./pdf-figure-region.js";
import { type RenderFailure, renderPdfRegion } from "./pdf-figure-render.js";
import {
  type DecodedRaster,
  downscaleRaster,
  encodeFigurePng,
  MAX_FIGURE_PIXELS,
  pairPageFigures,
  type PdfFigureFailure as PairingFailure,
} from "./pdf-figures.js";
import { readPdfRasters } from "./pdf-figure-read.js";
import { type RawSourceStore, storeRawSource } from "./store/blobs.js";

/**
 * The most bytes one recovered figure may be, encoded — **a backstop rather
 * than the control, because `MAX_FIGURE_EDGE` is now the thing that decides
 * what a reader downloads.**
 *
 * The history is worth keeping, because both previous numbers were wrong in
 * the same direction. The plan proposed 4 MiB on the strength of *"the largest
 * figure measured anywhere in the corpus is 756 KB"* — the *Analog Cognition*
 * document's number, not the corpus's. Measured against
 * `evals/pdf/harder/source.pdf` on 2026-09-06 the ball-lightning paper's
 * page-3 figure is 2067 × 1741 of photographic RGB and encoded to **9,355,050
 * bytes**, so 4 MiB refused a real figure in the repo's own fixtures, silently.
 * The cap went up to `MAX_IMAGE_BYTES` (16 MiB) to let it through, which
 * removed the refusal and left a reader fetching 9 MB for one picture.
 *
 * **Greg's call on 2026-09-06 was to fix the pixels rather than the cap** —
 * `downscaleRaster`, src/pdf-figures.ts — and the same corpus re-measured
 * afterwards:
 *
 * | figure | before | after |
 * | --- | --- | --- |
 * | ball lightning p3, 2067 × 1741 | 9,355,050 | **2,349,789** at 1034 × 871 |
 * | ball lightning p11, 2067 × 1523 | 2,917,234 | 985,154 at 1034 × 762 |
 * | ball lightning p7, 2067 × 3329 | 3,432,261 | 822,724 at 689 × 1110 |
 * | everything else in the corpus | ≤ 756 KB | unchanged, all inside the bound |
 *
 * So **12 MiB, and it is chosen so that it cannot fire.** A figure that reaches
 * here is at most 1600 × 1600 px, which as raw RGBA scanlines is 10,241,600
 * bytes; deflate's worst case is an expansion of about 0.03%, so no PNG this
 * module can now produce reaches 12 MiB — by arithmetic rather than by luck.
 * That is the property worth having after the day a 4 MiB cap quietly threw a
 * real fixture away: the downscale is what bounds the download, and the cap is
 * only here to catch a bug in it. The largest real figure is 5.4× under it.
 *
 * A figure over the cap is recorded `too-many-pixels` — the honest reason,
 * since what makes a PNG this large is pixels — rather than dropped.
 */
export const MAX_FIGURE_BYTES = 12 * 1024 * 1024;

/**
 * A runaway guard on how many figures one document may have.
 *
 * A hundred is far more than any paper and far less than a malformed
 * transcription could produce. Everything past it is recorded rather than
 * dropped, exactly as `MAX_IMAGES` overflow is in src/collect-assets.ts, so
 * "no entry" keeps meaning "this step never looked at it".
 */
export const MAX_FIGURES = 100;

/**
 * **The most one article's figures may cost, all told.**
 *
 * A cap on each part is not a cap on the whole, and until 2026-09-06 there was
 * no cap on the whole: the marker count was bounded at 100 and the encoded PNG
 * at 12 MiB, which between them gave one document leave to put **1.2 GiB** in
 * the bucket. GPT Sol, C-3.
 *
 * **64 MiB, which is `MAX_ARTICLE_BYTES` in src/collect-assets.ts, and the
 * agreement is deliberate rather than accidental.** The two halves of this step
 * are alternatives, not additions: an article made from a PDF has no `<img>`
 * anywhere, and a web article has no PDF to look in, so whichever half runs, an
 * article costs at most this. Spelled here rather than imported because the two
 * answer different questions — that one bounds what arrives over a network,
 * this one bounds what we make out of bytes we already hold — and a shared
 * constant would make tuning one silently tune the other.
 *
 * The worst article we hold is the ball-lightning paper, and **summing the
 * table in `MAX_FIGURE_BYTES` above** — a sum, not a fresh measurement — puts
 * its four figures at about 4.9 MB. So the number we actually see clears this
 * by an order of magnitude, which is the property src/collect-assets.ts chooses
 * its caps for and says so about: a guard, not a fit.
 *
 * Everything past it is recorded `budget` rather than dropped.
 */
export const MAX_ARTICLE_FIGURE_BYTES = 64 * 1024 * 1024;

/**
 * **How long the whole PDF half may take, wall clock.**
 *
 * It had none until 2026-09-06, and the absence was worse than a generous
 * number: `storeRawSource` takes no `AbortSignal` and neither does
 * `encodeFigurePng`, so a bucket that accepted a `put` and never answered meant
 * this function **never returned** — no entries finalised, no manifest written,
 * and aborting the job changed nothing. The one invariant this module exists
 * for fails by never finishing, which is the failure mode neither abort test
 * could see. GPT Sol, C-1.
 *
 * 180s, the same number as `ASSETS_BUDGET_MS`, for the reason
 * `MAX_ARTICLE_FIGURE_BYTES` above gives: the two halves are alternatives, so
 * the `assets` step's worst case stays what `tests/jobs-lease-budget.test.ts`
 * costs it at whichever kind of article turns up. That test's sum is about *an
 * ordinary web page*, where this clock never starts at all.
 *
 * Sized against the work rather than against the ceiling, which is the mistake
 * `ASSETS_BUDGET_MS` records making. MEASURED 2026-09-06 through
 * `tests/collect-pdf-figures.test.ts` against `evals/pdf/harder/source.pdf`:
 * about **1.7s** per figure, cold, to open the document, decode the page,
 * downscale and deflate. A real paper has four to ten figures, so the ordinary
 * case is two orders of magnitude inside this and the budget exists only for
 * the pathological one — a bucket that never answers, or the 100 figures
 * `MAX_FIGURES` admits, which at that rate would not finish inside it. A
 * document that genuinely outruns the clock has every remaining marker recorded
 * `out-of-time`, which is the honest answer and the thing the invariant is for.
 */
export const PDF_FIGURES_BUDGET_MS = 180_000;

export interface CollectPdfFiguresOptions {
  /** Every marker in the article's blocks — `pdfFigureMarkersIn`, src/collect-assets.ts. */
  markers: readonly PdfFigureMarker[];
  /** The whole PDF. Copied before pdf.js sees it, by `readPdfRasters`. */
  pdf: Uint8Array;
  /**
   * Each marker's `<figcaption>` text, by ref — `pdfFigureCaptionsIn`,
   * src/collect-assets.ts. **What turns the drawn-figure route on**: a marker
   * with no caption here is never tried by it and keeps the bitmap route's
   * answer, so a caller that passes none gets exactly the behaviour this
   * module had before the route existed.
   */
  captions?: ReadonlyMap<string, string>;
  blobs?: RawSourceStore;
  signal?: AbortSignal;
  now?: () => Date;
  maxImagePixels?: number;
  /**
   * The caps and the clock, injected, defaulting to the policy above.
   *
   * **This is a probe rather than a convenience**, and the reasoning is
   * `CollectAssetsOptions.limits`' word for word: the real article budget is
   * 64 MiB and the real deadline is three minutes, so a test that exercised
   * either honestly would have to build 64 MiB of fixtures or wait three
   * minutes — and every fixture would then sit so far inside the limit that the
   * limit was tested by nothing at all. Production passes none of these.
   */
  maxBytes?: number;
  maxFigures?: number;
  maxArticleBytes?: number;
  budgetMs?: number;
  /** Page-layout reader injection for deterministic deadline tests. */
  readLayouts?: typeof readPdfPageLayouts;
}

export interface PdfFiguresRun {
  /** One per marker, in the order the markers arrived. Never shorter. */
  entries: PdfFigureEntry[];
  stored: number;
  /** How many of `stored` were drawn from the page rather than decoded from a bitmap. */
  drawn: number;
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
  const limits: Limits = {
    maxFigures: options.maxFigures ?? MAX_FIGURES,
    maxBytes: options.maxBytes ?? MAX_FIGURE_BYTES,
    maxArticleBytes: options.maxArticleBytes ?? MAX_ARTICLE_FIGURE_BYTES,
    blobs: options.blobs,
  };

  const looked = options.markers.slice(0, limits.maxFigures);
  const overflow = options.markers.slice(limits.maxFigures);

  /**
   * **A map keyed by ref, and the array is built from it at the very end.**
   *
   * Because the run is raced against a clock (below), work can still be in
   * flight when the manifest is handed back — a `put` inside a bucket that has
   * stopped answering. Its bookkeeping is then harmless: it writes into this
   * map, which nobody reads any more, rather than pushing a figure into an
   * array a caller is already holding. `collectAssets` keeps its entries in a
   * `Map` for exactly this reason.
   */
  const book: Ledger = {
    entries: new Map(),
    stored: 0,
    drawn: 0,
    failed: 0,
    deduped: 0,
    bytes: 0,
    storageErrors: [],
  };
  /**
   * **First writer wins**, so that a straggler cannot overwrite the entry the
   * finaliser already wrote for it, nor count itself twice.
   */
  const record = (entry: PdfFigureEntry): void => {
    if (book.entries.has(entry.ref)) return;
    book.entries.set(entry.ref, entry);
    if (entry.status === "stored") {
      book.stored += 1;
      book.bytes += entry.bytes;
    } else book.failed += 1;
  };
  const fail = (marker: PdfFigureMarker, reason: PdfFigureFailure): void => {
    record({ ref: marker.ref, page: marker.page, status: "failed", reason, at: at() });
  };

  /* Past the runaway guard, and recorded before anything else happens so that
     a clock that runs out cannot lose them either. `budget` rather than
     `out-of-time`: this article is enormous, which has a different fix from the
     pipeline running slow. src/collect-assets.ts makes both choices already. */
  for (const marker of overflow) fail(marker, "budget");

  /**
   * **The step's wall clock, as an `AbortSignal`** — composed with the caller's,
   * the way `collectAssets` composes its own and src/fetch.ts does one layer
   * down. Both mean the same thing to a figure that never got its turn, so both
   * arrive as `out-of-time`, and the two are never told apart by reading an
   * error.
   */
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error("pdf figures budget spent")),
    options.budgetMs ?? PDF_FIGURES_BUDGET_MS,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  const stopped = new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

  const everyFigure = async (): Promise<void> => {
    const read = await readRasters(looked, options, signal);
    if (read === null) {
      /* **Asked of the signal, never of the error** — the rule `reasonFor` in
         src/collect-assets.ts states at length. A pdf.js throw and an abort
         reach here as the same `null`, and only one of them is a fact about the
         document; when our own clock or the caller stopped it, the finaliser's
         `out-of-time` is the honest reason and this claims nothing. */
      if (!signal.aborted) for (const marker of looked) fail(marker, "unreadable-pdf");
      return;
    }

    const { outcomes } = pairPageFigures({ markers: looked, candidates: read });
    /* The drawn route's candidates: refused `no-raster` by the bitmap route,
       and captioned by the article. Everything else is decided above. */
    const candidates = outcomes.flatMap((outcome) =>
      outcome.status === "refused" && outcome.reason === "no-raster" && options.captions?.has(outcome.marker.ref)
        ? [outcome.marker]
        : [],
    );

    /* Preserve the bitmap route's outputs: everything it already decided is
       stored or recorded before the new layout/render work starts. Otherwise a
       slow drawn page can spend the clock and turn an unrelated decoded bitmap
       into `out-of-time`. Final assembly below restores marker order. */
    for (const outcome of outcomes) {
      if (outcome.status === "refused") {
        if (!candidates.includes(outcome.marker)) fail(outcome.marker, pdfFigureFailure(outcome.reason));
        continue;
      }
      /* Stop rather than record: every marker left is finalised below, which is
         the one place that decides what an unfinished run says. */
      if (signal.aborted) return;
      await storeOne(outcome.marker, outcome.raster, limits, signal, book, record, at);
    }

    if (signal.aborted || candidates.length === 0) return;
    const drawn = await drawnRoute(candidates, options, signal);
    /* The layout read did not come back. An abort claims nothing and leaves the
       markers to the finaliser; anything else leaves the bitmap route's answer
       standing. */
    if (!drawn) {
      if (!signal.aborted) for (const marker of candidates) fail(marker, "no-raster");
      return;
    }
    for (const marker of candidates) {
      if (signal.aborted) return;
      const result = await drawn.draw(marker);
      if (result.status === "stopped") return;
      if (result.status === "refused") {
        fail(marker, result.reason);
        continue;
      }
      if (signal.aborted) return;
      await storeOne(marker, result.raster, limits, signal, book, record, at);
      if (book.entries.get(marker.ref)?.status === "stored") book.drawn += 1;
    }
  };

  /**
   * **Raced, not awaited, and the race is the guarantee** — `collectAssets`
   * says it first and this is the same sentence. Aborting the signal is enough
   * for `readPdfRasters`, which takes one. It is not enough for the step:
   * `storeRawSource` takes no signal, so a bucket that never answers walks
   * straight past the deadline with nothing able to interrupt it. Racing the
   * whole run is what makes the budget hold whatever any one figure is stuck
   * inside — the difference between a limit and an intention.
   */
  const work = everyFigure();
  /* So that a rejection arriving after the race has been won is not an
     unhandled one. `work` itself still settles into the race, so a throw that
     gets there first propagates exactly as it did before. */
  void work.catch(() => {});
  try {
    await Promise.race([work, stopped]);
  } finally {
    /* Or the timer keeps the process alive for the rest of the three minutes,
       on every CLI run of a paper that took four seconds. */
    clearTimeout(timer);
  }

  /**
   * Whatever the race left behind.
   *
   * Every marker gets an entry, which is the invariant this whole module is
   * for: a marker in the blocks and nothing in the manifest is indistinguishable
   * from a figure the reader was never promised. Empty in the ordinary case,
   * where `work` won.
   */
  for (const marker of looked) if (!book.entries.has(marker.ref)) fail(marker, "out-of-time");

  /* Marker order, not completion order, and taken synchronously here so that
     nothing still in flight can join the list after it is decided. */
  const entries: PdfFigureEntry[] = [];
  for (const marker of options.markers) {
    const entry = book.entries.get(marker.ref);
    if (entry) entries.push(entry);
  }
  return {
    entries,
    stored: book.stored,
    drawn: book.drawn,
    failed: book.failed,
    deduped: book.deduped,
    bytes: book.bytes,
    /* **A copy, not `book.storageErrors` itself**, which is the same sentence
       the entries loop above makes and the one place it was not being said.
       `storeOne`'s `catch` pushes into this array, and a `put` that rejects
       *after* the race has been won still reaches that line — so handing the
       ledger's own array out let a straggler mutate an object the caller was
       already holding, minutes after the run it describes had returned. The
       numbers beside it are safe for free, being copied by value; an array is
       the one field in this object where "returned" and "finished" are not the
       same thing. GPT Sol, D-4, 2026-09-06. */
    storageErrors: [...book.storageErrors],
    elapsedMs: Date.now() - startedAt,
  };
}

/** The caps, as one thing, so a test can replace them together. */
interface Limits {
  maxFigures: number;
  maxBytes: number;
  maxArticleBytes: number;
  blobs: RawSourceStore | undefined;
}

/** The running total, kept apart from the run so a straggler cannot reach it. */
interface Ledger {
  entries: Map<string, PdfFigureEntry>;
  stored: number;
  drawn: number;
  failed: number;
  deduped: number;
  bytes: number;
  storageErrors: string[];
}

/**
 * One raster, from either route: encode it, check it, store it.
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
  marker: PdfFigureMarker,
  raster: DecodedRaster,
  limits: Limits,
  signal: AbortSignal,
  book: Ledger,
  record: (entry: PdfFigureEntry) => void,
  at: () => string,
): Promise<void> {
  const fail = (reason: PdfFigureFailure): void => {
    record({ ref: marker.ref, page: marker.page, status: "failed", reason, at: at() });
  };
  /* **The article's share, asked before the encode as well as after it.** The
     check that matters is the one below, over the size we actually made; this
     one is only so that an article with no room left does not go on decoding
     and deflating a hundred pictures to refuse every one of them. */
  if (limits.maxArticleBytes - book.bytes <= 0) {
    fail("budget");
    return;
  }
  let png: Uint8Array;
  try {
    /* Downscaled first, and this is the only place it happens: the manifest's
       `width`/`height` are read back off the PNG below, so they describe the
       image a reader is actually served rather than the raster pdf.js decoded.
       The raster's own dimensions stay pinned in tests/pdf-figure-read.test.ts,
       which is where a claim about the document belongs. */
    png = await encodeFigurePng(downscaleRaster(raster));
  } catch {
    /* Nothing of the error is kept. It can only be our own writer disagreeing
       with our own reader — `encodeFigurePng` is the only thing that throws —
       and that is a bug to find in a test, not a sentence to put in a manifest
       a stranger can read (Sol I-9). */
    fail("encode-failed");
    return;
  }
  if (png.byteLength > limits.maxBytes) {
    fail("too-many-pixels");
    return;
  }
  /* **The article's own budget, over the size we actually made.** Unlike the
     network half, which has to reserve a worst case before it dials because it
     cannot know what is coming, this knows exactly what the figure costs before
     it stores a byte of it — so the budget is enforced rather than approximated.
     Recorded rather than dropped, and the run carries on: a later figure may
     still fit, and every marker gets an entry either way. GPT Sol, C-3. */
  if (png.byteLength > limits.maxArticleBytes - book.bytes) {
    fail("budget");
    return;
  }
  const sniffed = sniffImage(png);
  const size = imageDimensions(png);
  if (!sniffed || !size) {
    fail("encode-failed");
    return;
  }
  /* **After the encode and before the put**, because the deflate is the long
     part and nothing inside it takes a signal: without this, a step aborted
     mid-encode went on to store that figure anyway, in a bucket nobody was
     waiting on any more. GPT Sol, C-1. Nothing is recorded here — the finaliser
     owns what an unfinished run says. */
  if (signal.aborted) return;
  try {
    const put = limits.blobs
      ? await storeRawSource(png, sniffed.ext, limits.blobs)
      : await storeRawSource(png, sniffed.ext);
    if (put.outcome === "already-there") book.deduped += 1;
    record({
      ref: marker.ref,
      page: marker.page,
      status: "stored",
      sha256: put.sha256,
      ext: sniffed.ext,
      contentType: sniffed.contentType,
      bytes: png.byteLength,
      width: size.width,
      height: size.height,
    });
  } catch (err) {
    /* A `CorruptObject` at a canonical name, a Storage outage, a bug. Carried
       past, because one figure must never fail the step — and handed to the
       caller to log, because this module is not in src/log.ts's component list
       and the step already owns a `pipeline` logger. src/collect-assets.ts. */
    if (book.storageErrors.length < 5) book.storageErrors.push(describeStorageFailure(err));
    fail("storage");
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
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof readPdfRasters>>["candidates"] | null> {
  if (markers.length === 0) return [];
  try {
    const read = await readPdfRasters({
      data: options.pdf,
      /* One page per marker; `readPdfRasters` sorts and de-duplicates, so two
         figures on page 7 do not decode page 7 twice. */
      pages: markers.map((m) => m.page),
      maxImagePixels: options.maxImagePixels ?? MAX_FIGURE_PIXELS,
      /* **The step's clock as well as the caller's.** It was the caller's alone
         until 2026-09-06, so the deadline could not reach the one part of this
         module that does take a signal. */
      signal,
    });
    return read.candidates;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The drawn route
 * ------------------------------------------------------------------ */

/** What became of one candidate on the drawn route. */
type DrawnResult =
  | { status: "drawn"; raster: DecodedRaster }
  | { status: "refused"; reason: PdfFigureFailure }
  /** The signal fired first. Nothing is claimed; the finaliser decides. */
  | { status: "stopped" };

/**
 * The drawn route for these candidates, or `null` when their pages' layouts
 * could not be read at all — `null` for the same reason `readRasters` returns
 * one, and handled the same way by the caller.
 *
 * The layouts are read once, up front, for every candidate page: they are
 * boxes and text, a few kilobytes a page. The pdf-lib parse the cut needs is
 * paid only when some page gets as far as needing one, and only once.
 */
async function drawnRoute(
  candidates: readonly PdfFigureMarker[],
  options: CollectPdfFiguresOptions,
  signal: AbortSignal,
): Promise<{ draw(marker: PdfFigureMarker): Promise<DrawnResult> } | null> {
  let layouts: Map<number, PageLayout | null>;
  try {
    layouts = await (options.readLayouts ?? readPdfPageLayouts)({
      data: options.pdf,
      pages: candidates.map((m) => m.page),
      signal,
    });
  } catch {
    return null;
  }
  /* The article's claim about each page, counted over **every** marker it has —
     not just the candidates, and not just the ones inside the runaway guard. */
  const markersOnPage = new Map<number, number>();
  for (const marker of options.markers) markersOnPage.set(marker.page, (markersOnPage.get(marker.page) ?? 0) + 1);
  let pages: Promise<FigurePages> | null = null;

  return {
    async draw(marker) {
      const layout = layouts.get(marker.page);
      /* A page we could not read is a page we cannot show is eligible. */
      if (!layout) return { status: "refused", reason: "no-raster" };
      const base = {
        layout,
        caption: options.captions?.get(marker.ref) ?? "",
        markersOnPage: markersOnPage.get(marker.page) ?? 0,
      };
      /* Once without the resource walk, which needs pdf-lib and a cut: nearly
         every refusal is decided here, for the price of arithmetic… */
      const first = locateDrawnFigure({ ...base, imageInResources: false, unmeasuredPaint: false });
      if (!first.ok) return { status: "refused", reason: verdictFailure(first) };

      let page: FigurePage;
      try {
        pages ??= openFigurePages(options.pdf);
        page = await (await pages).cut(marker.page);
      } catch {
        return { status: "refused", reason: "render-failed" };
      }
      /* …and again with it, so that the rule lives in one place and the walk's
         answer is decided by the same function as everything else. */
      const verdict = locateDrawnFigure({
        ...base,
        imageInResources: page.imageInResources,
        unmeasuredPaint: page.unmeasuredPaint,
      });
      if (!verdict.ok) return { status: "refused", reason: verdictFailure(verdict) };

      if (signal.aborted) return { status: "stopped" };
      const rendered = await renderPdfRegion({
        onePagePdf: page.bytes,
        region: verdict.region,
        /* What the locator measured, carried rather than recomputed: the
           render's paint must fall inside it (Sol F35). */
        containment: verdict.containment,
        view: { width: layout.view[2] - layout.view[0], height: layout.view[3] - layout.view[1] },
      });
      return rendered.ok
        ? { status: "drawn", raster: rendered.raster }
        : { status: "refused", reason: renderFailure(rendered.failure) };
    },
  };
}

/**
 * The locator's refusal, as the manifest's word. `not-eligible` keeps the
 * bitmap route's `no-raster`: the page was not the narrow case at all, which is
 * exactly what `no-raster` has always said.
 */
function verdictFailure(verdict: Exclude<DrawnFigureVerdict, { ok: true }>): PdfFigureFailure {
  switch (verdict.reason) {
    case "not-eligible":
      return "no-raster";
    case "too-complex":
      return "too-complex";
    case "not-located":
      return "not-located";
    default: {
      const never: never = verdict;
      throw new Error(`collect-pdf-figures: unmapped locator verdict ${String(never)}`);
    }
  }
}

/**
 * The renderer's refusal, as the manifest's word. Two of them are not faults in
 * the renderer: a page whose size the two engines disagree about fails
 * eligibility rule 3, so it is `no-raster` like every other ineligible page;
 * and a region that draws nothing is a region we could not stand behind.
 */
function renderFailure(failure: RenderFailure): PdfFigureFailure {
  switch (failure) {
    case "init":
    case "load":
    case "region":
    case "render":
      return "render-failed";
    case "geometry-mismatch":
      return "no-raster";
    case "blank":
    case "unmeasured-paint":
      return "not-located";
    default: {
      const never: never = failure;
      throw new Error(`collect-pdf-figures: unmapped render failure ${String(never)}`);
    }
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
