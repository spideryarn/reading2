/**
 * **Getting the bitmaps out of a real PDF** — the impure half of figure
 * recovery, and the only half that opens a document.
 *
 * src/pdf-figures.ts holds the rules: is a decoded raster well-formed, does it
 * draw anything, what does it look like as a PNG, which caption may claim it.
 * Every one of those is decided on plain bytes and has a test that never opens a
 * file. **This file supplies the bytes**, and it is separate for exactly that
 * reason: the lifetime of a pdf.js worker has nothing to teach the rules, and
 * the rules should not have to boot a worker to be argued with.
 *
 * Stage B of
 * docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md.
 * Measurements below are this file's own, taken 2026-09-06 against the committed
 * fixtures, and tests/pdf-figure-read.test.ts pins every one of them.
 *
 * ## 1. The decode cap has to reach pdf.js, and it removes rather than reports
 *
 * `data.length === width * height * 4` means a 5000 × 4000 raster is 80 MB of
 * decoded bytes inside the function the pipeline runs in, with no rasteriser to
 * downscale with. So the cap cannot be a check afterwards: **building the
 * operator list is what decodes the image**, and by the time
 * `getOperatorList()` has resolved the buffer already exists and has already
 * been sent from the worker.
 *
 * `getDocument({ maxImageSize })` is the real gate. `pdf.worker.mjs:40299` tests
 * `w * h > maxImageSize` against the image *dictionary's* `/Width` and
 * `/Height`, before any decoding — verified by reading it, 2026-09-06. Sol D5-4.
 *
 * **The trap, and it is a silent-success shape.** The branch beside that test is
 * `if (!ignoreErrors) throw`, and `pdf.mjs:21565` sets
 * `ignoreErrors = src.stopAtErrors !== true`. With the options we pass — and
 * with the defaults — an oversized image is therefore **warned about on the
 * console and dropped from the operator list entirely**. Measured here with
 * `maxImageSize: 1_000_000` against evals/pdf/harder:
 *
 * ```
 * Warning: Image exceeded maximum allowed size and was removed.
 * cap=1000000 p3 keys=[]
 * ```
 *
 * Page 3 does have an image. With the cap on, it looks like a page that never
 * had one. **So a figure too big to decode is indistinguishable here from a
 * figure that was never a bitmap**, and nothing downstream can tell them apart
 * either: both arrive as an empty candidate list and become `no-raster`. That
 * ambiguity is accepted rather than hidden, and it constrains the *copy* — the
 * reader is told "nothing recoverable here", never "this figure is vector art".
 * docs/reusable/silent-success.md.
 *
 * If telling the two apart ever matters, the fix is written down rather than
 * left to be rediscovered: `pdf-lib` is already a dependency (`openPdfCuts` in
 * src/pdf-read.ts uses it) and can read a page's XObject `/Width` and `/Height`
 * out of the dictionary without decoding anything.
 *
 * ## 2. A page with no text layer is a photograph, and its image is the page
 *
 * evals/pdf/much-harder is 17 pages and 17 full-page images, every one opaque,
 * every one "real" by every rule in src/pdf-figures.ts. Attach one to a caption
 * and we staple an entire page of the book under it. The figure-record gate
 * alone is not enough — Sol D2-4 — so the exclusion is stated:
 *
 * > A page whose text layer holds fewer than `SCAN_WORDS_PER_PAGE` words is a
 * > photograph of a page. Take nothing from it.
 *
 * `SCAN_WORDS_PER_PAGE` comes from src/pdf.ts, which owns that judgement, so
 * there is no second threshold to keep in step. It is applied **per page rather
 * than per document**, which is strictly better: it also covers the mixed case,
 * a scanned plate bound into a typeset paper, which `Pass0.isScan` cannot see.
 * And it is computed here from `page.getTextContent()` rather than plumbed
 * across the stage boundary from pass 0 — we are already standing on the page,
 * and the call is nearly free.
 *
 * **Where the counting differs from pass 0, and it is deliberate.** Pass 0 drops
 * sideways runs from `PageText.words`, because an arXiv margin stamp is not
 * prose a transcription can be scored against. Here the question is only
 * *does this page have a text layer at all*, so every run counts. A genuine
 * photograph has zero either way; the only documents the difference can reach
 * are ones with a margin stamp and nothing else, and eight sideways words are
 * under the threshold regardless.
 *
 * **What the rule does not catch, measured.** Page 1 of the Wellcome scan is the
 * digitiser's own generated rights page: 95 words, so not a scanned page, and it
 * carries a 500 × 164 RGBA logo which is 58% opaque and perfectly "real". This
 * function therefore returns it. Nothing downstream shows it, because page 1 of
 * a scan gets `cover`/`publisher` records and never a `figure` one, and
 * src/pdf-figures.ts drops an unclaimed raster — but the honest statement is
 * *the scan rule excludes 16 of the 17 pages*, not all of them. See the plan's
 * report for the argument against adding a whole-document rule on top.
 *
 * ## 3. Only `paintImageXObject`, and the limit is recorded rather than hidden
 *
 * Inline images (`paintInlineImageXObject`) and the repeat operator
 * (`paintImageXObjectRepeat`) are out of scope for v1, along with every
 * vector-drawn figure, which this route cannot reach at all. Sol SP-2 asks that
 * this be recorded explicitly rather than presented as general PDF figure
 * recovery, so an operator we saw and did not read comes back in `unread` with
 * its reason, and the copy must not promise more than "where the figure is a
 * bitmap".
 *
 * A decoded XObject is also not *guaranteed* to equal the page's rendered
 * appearance once masks, blend modes and clipping are in play — Sol SP-1. Four
 * were checked by eye on the target document and were right; that reduces the
 * concern and does not settle it.
 *
 * ## 4. The bytes outlive the document, and the worker does not
 *
 * `RasterCandidate.data` is **pdf.js's own buffer, not a copy** — src/pdf-figures.ts
 * says so and depends on it, because copying four megabytes per figure to read
 * them once would be a real cost for nothing. Those buffers are ordinary heap by
 * the time we hold them: the worker transferred them across on the way in, and
 * `cleanup()`/`destroy()` empty the object *maps* without touching an array
 * anybody still references. So the candidates this returns are usable after the
 * document is gone, and tests/pdf-figure-read.test.ts encodes one to PNG after
 * the call returns rather than taking that on trust.
 *
 * The teardown itself is copied from `pass0` in src/pdf.ts, comment and all:
 * **`cleanup` releases page resources, `destroy` is what stops the worker**, in
 * a `finally`, each in its own try/catch. A version of that code which called
 * only `cleanup` leaked one worker per document — every successful parse, not
 * just the failures — and it went unnoticed because the line two hundred lines
 * above it already said which was which.
 */

import { loadPdfjs, SCAN_WORDS_PER_PAGE } from "./pdf.js";
import { MAX_FIGURE_PIXELS, type RasterCandidate } from "./pdf-figures.js";

/**
 * How long one image object may take to arrive before we give up on it.
 *
 * `page.objs.get(key, callback)` registers a callback against a promise the
 * worker resolves; a key the worker never resolves would otherwise hold this
 * step until the platform killed the function. Fifteen seconds is far outside
 * anything measured — the whole 14-page ball-lightning paper, five images and
 * 49 megapixels of decode, takes about five seconds end to end — so a timeout
 * here means something is wrong rather than something is slow.
 */
export const FIGURE_OBJECT_TIMEOUT_MS = 15_000;

/** pdf.js's own types, reached through the loader so nothing else imports it. */
type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>;
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;

/** Why we looked at a page and took nothing from it. */
export type PageSkip =
  /**
   * Fewer than `SCAN_WORDS_PER_PAGE` words in the text layer. The image on this
   * page *is* the page. See the header.
   */
  | "scanned"
  /** Asked for a page the document does not have. A bug upstream, not a fact about the PDF. */
  | "out-of-range";

/** Why we saw an image operator and did not produce a candidate for it. */
export type UnreadReason =
  /** `paintInlineImageXObject`. Out of scope for v1 — Sol SP-2. */
  | "inline-image"
  /** `paintImageXObjectRepeat`. Ditto. */
  | "repeated-image"
  /** The object never resolved inside `FIGURE_OBJECT_TIMEOUT_MS`. */
  | "timeout"
  /**
   * The object resolved to nothing, or to something without the three fields
   * every decoded image has. Distinct from a timeout: the worker answered, and
   * the answer was not an image.
   */
  | "not-an-image";

export interface PdfRasterRead {
  /**
   * Every image we decoded, in page then paint order. Hand these straight to
   * `pairPageFigures` — classification is its job, not this one's, so that no
   * caller is ever in a position to count "usable" differently from the gate.
   */
  candidates: RasterCandidate[];
  /** Pages we declined to open the operator list for, and why. */
  skippedPages: { page: number; reason: PageSkip }[];
  /** Image operators we saw and did not read. The v1 limits, itemised. */
  unread: { page: number; key: string; reason: UnreadReason }[];
}

export interface ReadPdfRastersInput {
  /**
   * The whole PDF. **Copied before pdf.js sees it**, for the same reason `pass0`
   * copies: pdf.js takes ownership of the array it is given, transfers the
   * underlying buffer to its worker, and leaves the caller holding a detached
   * one. The caller here is the assets step, which has just hashed those bytes
   * and will want them again.
   */
  data: Uint8Array;
  /**
   * The 1-based pages worth looking at — in practice, the pages carrying figure
   * markers. **Empty means the document is never opened at all**, which is what
   * makes this free on the great majority of articles: three of the seven eval
   * PDFs contain no raster image anywhere.
   */
  pages: readonly number[];
  /**
   * Handed to pdf.js as `maxImageSize`, and it is a real cap rather than a
   * check — see the header, including what it costs in ambiguity.
   */
  maxImagePixels?: number;
  objectTimeoutMs?: number;
  /**
   * The step's deadline. `destroy()` is what an abort does, because it is the
   * only thing that ends a loading task — the same bound, and the same honest
   * limit, as `countPdfPages` in src/pdf.ts: pdf.js hands work back at its own
   * `await` points, so the abort lands between them.
   */
  signal?: AbortSignal;
}

/**
 * Open a PDF, and hand back the raster images painted on the pages asked for.
 *
 * The document is opened once and torn down before this returns; the byte
 * arrays in the result outlive it (header, §4). Nothing here decides whether an
 * image is *usable* — `classifyRaster` and `pairPageFigures` in
 * src/pdf-figures.ts do that, on bytes, where they can be argued with.
 */
export async function readPdfRasters(input: ReadPdfRastersInput): Promise<PdfRasterRead> {
  const result: PdfRasterRead = { candidates: [], skippedPages: [], unread: [] };
  /* Sorted and de-duplicated, so a caller that passes one page per figure marker
     — two markers on page 7 — does not make us decode page 7 twice. */
  const wanted = [...new Set(input.pages)].sort((a, b) => a - b);
  if (wanted.length === 0) return result;

  input.signal?.throwIfAborted();
  const data = new Uint8Array(input.data);
  const pdfjs = await loadPdfjs();
  /* Loading pdf.js is 1.5–1.8 s on the first PDF a process sees, and the
     deadline may have passed inside it. Same check, same reason, as `pass0`. */
  input.signal?.throwIfAborted();

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    maxImageSize: input.maxImagePixels ?? MAX_FIGURE_PIXELS,
  });
  const giveUp = () => {
    void loadingTask.destroy();
  };
  input.signal?.addEventListener("abort", giveUp, { once: true });

  let doc: PdfDocument | undefined;
  try {
    doc = await loadingTask.promise;
    for (const page of wanted) {
      input.signal?.throwIfAborted();
      if (!Number.isSafeInteger(page) || page < 1 || page > doc.numPages) {
        result.skippedPages.push({ page, reason: "out-of-range" });
        continue;
      }
      await readOnePage(pdfjs, doc, page, input.objectTimeoutMs ?? FIGURE_OBJECT_TIMEOUT_MS, result);
    }
    return result;
  } catch (err) {
    /* An abort is why this failed, so it is what the caller is told. pdf.js's
       own "Worker was destroyed" is a fact about our teardown, not the file. */
    input.signal?.throwIfAborted();
    throw err;
  } finally {
    input.signal?.removeEventListener("abort", giveUp);
    /* `cleanup` releases page resources; **`destroy` is what stops the worker**.
       Both, in this order, each allowed to fail on its own — neither may replace
       the error that brought us here. See the `finally` in `pass0`, and the day
       calling only the first cost one leaked worker per document. */
    try {
      await doc?.cleanup?.();
    } catch {
      /* Being torn down regardless. */
    }
    try {
      await loadingTask.destroy();
    } catch {
      /* Ditto. */
    }
  }
}

/**
 * One page: is it a photograph, and if not, what did it paint?
 *
 * `getTextContent()` comes **first and `getOperatorList()` second**, and that
 * order is the whole cost story. The operator list is what decodes every image
 * on the page; the text content is cheap. So a scanned page — 17 of them in the
 * Wellcome fixture, two megabytes of decode each — costs a text call and
 * nothing else.
 */
async function readOnePage(
  pdfjs: Pdfjs,
  doc: PdfDocument,
  page: number,
  timeoutMs: number,
  into: PdfRasterRead,
): Promise<void> {
  const proxy = await doc.getPage(page);
  if ((await pageWords(proxy)) < SCAN_WORDS_PER_PAGE) {
    into.skippedPages.push({ page, reason: "scanned" });
    return;
  }

  const ops = await proxy.getOperatorList();
  for (let at = 0; at < ops.fnArray.length; at++) {
    const fn = ops.fnArray[at];
    if (fn === pdfjs.OPS.paintInlineImageXObject || fn === pdfjs.OPS.paintInlineImageXObjectGroup) {
      /* An inline image has no object id — its bytes are in the content stream —
         so the position in the operator list is the only name it has. */
      into.unread.push({ page, key: `inline@${at}`, reason: "inline-image" });
      continue;
    }
    if (fn === pdfjs.OPS.paintImageXObjectRepeat) {
      into.unread.push({ page, key: String(ops.argsArray[at]?.[0] ?? ""), reason: "repeated-image" });
      continue;
    }
    if (fn !== pdfjs.OPS.paintImageXObject) continue;

    const key = ops.argsArray[at]?.[0];
    if (typeof key !== "string") {
      into.unread.push({ page, key: String(key), reason: "not-an-image" });
      continue;
    }
    /* pdf.js keeps an image used on one page in that page's own store and one
       shared between pages in the document-wide store, and tells them apart by
       a `g_` prefix on the id. Asking the wrong store gets a key that never
       resolves — i.e. a timeout — rather than an error. */
    const store = key.startsWith("g_") ? proxy.commonObjs : proxy.objs;
    const image = await resolveObject(store, key, timeoutMs);
    if (image === TIMED_OUT) {
      into.unread.push({ page, key, reason: "timeout" });
      continue;
    }
    const candidate = asCandidate(page, key, image);
    if (!candidate) {
      into.unread.push({ page, key, reason: "not-an-image" });
      continue;
    }
    into.candidates.push(candidate);
  }
}

/** Every word in the text layer, upright or not. See the header on the divergence. */
async function pageWords(proxy: {
  getTextContent: () => Promise<{ items: unknown[] }>;
}): Promise<number> {
  const content = await proxy.getTextContent();
  let text = "";
  for (const item of content.items) {
    if (item && typeof item === "object" && "str" in item) text += `${String(item.str)} `;
  }
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.split(" ").length : 0;
}

/** Distinguishable from any value pdf.js could hand back, which `undefined` is not. */
const TIMED_OUT = Symbol("pdf-figure-read: object never resolved");

/**
 * `objs.get(key, callback)`, with a deadline.
 *
 * The callback form is the only safe one: **`get` without a callback throws**
 * when the object has not resolved yet, and "not yet" is the normal state
 * straight out of `getOperatorList()` for anything the worker is still sending.
 *
 * The timeout does not cancel anything — there is nothing to cancel — so the
 * callback may still fire afterwards, and `settled` is what stops it resolving a
 * promise that has already lost the race.
 */
function resolveObject(
  store: { get: (objId: string, callback?: (value: unknown) => void) => unknown },
  key: string,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(TIMED_OUT);
    }, timeoutMs);
    /* Not `unref`'d on purpose: this promise is always awaited, so the timer is
       cleared on every path and cannot hold the process open. */
    try {
      store.get(key, (value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      });
    } catch {
      /* A store that refuses the key outright — the wrong store, a malformed id
         — reports as a timeout, because to the caller it is the same fact: we
         asked for the object and did not get it. It resolves immediately rather
         than after the deadline, since there is nothing left to wait for. */
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(TIMED_OUT);
      }
    }
  });
}

/**
 * pdf.js's decoded image, if that is what this is.
 *
 * **Deliberately incurious about the numbers.** `width`, `height` and `kind` are
 * copied across as claims; `classifyRaster` in src/pdf-figures.ts is the only
 * thing allowed to believe them, and it is where the adversarial tests are. All
 * this asks is whether the three fields and a byte array are present at all —
 * which is the difference between "the worker answered with an image" and "the
 * worker answered with something else".
 */
function asCandidate(page: number, key: string, value: unknown): RasterCandidate | null {
  if (!value || typeof value !== "object") return null;
  const image = value as { width?: unknown; height?: unknown; kind?: unknown; data?: unknown };
  if (typeof image.width !== "number" || typeof image.height !== "number") return null;
  if (typeof image.kind !== "number") return null;
  if (!(image.data instanceof Uint8Array) && !(image.data instanceof Uint8ClampedArray)) return null;
  return {
    page,
    key,
    width: image.width,
    height: image.height,
    kind: image.kind,
    /* A view, not a copy — see the header. `Uint8ClampedArray` is the same bytes
       under a different clamping rule for writes, and nothing here writes. */
    data:
      image.data instanceof Uint8Array
        ? image.data
        : new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
  };
}
