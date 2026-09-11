/**
 * **The article's own images, and what we know about them.**
 *
 * The pure half of hosting them: which URLs a block would have the reader's
 * browser fetch, what a downloaded file turns out to be, and the map the
 * reading view looks a URL up in. No network, no storage, no jsdom import — so
 * all of it is testable without any of those, and all of it is shared between
 * the pipeline and the browser rather than written twice.
 *
 * Step 2 of docs/plans/260829b-hosting-the-articles-images.md. The plan has the
 * reasoning; three things are worth knowing before editing anything here.
 *
 * ## 1. Both sides must read a URL the same way, so both sides use a DOM
 *
 * `blocks.json` stores `…&amp;s=3a2bee…`. `getAttribute("src")` returns
 * `…&s=3a2bee…`. Build the manifest from the stored string and look it up from
 * the DOM and **every entry misses** — no error, no broken image, just the
 * publisher's URL left in place and a feature that appears to do nothing. Five
 * of the corpus's thirteen images carry a query string like that.
 *
 * So `imageSourcesIn` takes a parsed root rather than a string, and the
 * pipeline hands it a jsdom node while the reading view hands it a browser one.
 * The *selection and the attribute read* — the part that has to agree — happens
 * exactly once, here.
 *
 * ## 2. The `src`, and not the `srcset`
 *
 * Measured on the real corpus: 13 `<img>` elements carry **46** `srcset`
 * candidates between them, all on one article. They are the same pictures at
 * different widths, so content addressing cannot dedup them — fetching every
 * candidate is 4× the requests and 2.7× the bytes to buy a reader nothing they
 * can see. And "the largest candidate" is not well defined once width
 * descriptors, density descriptors, media queries and `<picture>` types are all
 * in play. GPT Sol, 2026-08-29.
 *
 * An image is therefore rehosted **as a unit**: the `src` is fetched, and at
 * render `srcset`, `sizes` and any sibling `<source>` are removed — because a
 * browser handed a rewritten `src` and an untouched `srcset` prefers the
 * `srcset`, and goes on hot-linking while the page looks fixed.
 *
 * **Since 2026-09-11 the unit may carry one bigger picture**, and the `src` is
 * still its name. A publisher's `src` is often a thumbnail — 300 px on the
 * monkeys figure (SPIDERYARN-READING2-2B) — so the ⤢ had nothing to enlarge.
 * `preferredCandidateOf` picks **one** `srcset` candidate around 1,280 px, from
 * width descriptors only; the step fetches it first and falls back to the `src`.
 * The manifest is still keyed on the `src` (the candidate goes in `from`),
 * because that is what the reading view looks an element up by: key it on the
 * candidate and every lookup misses. Greg chose the trial, 2026-09-11;
 * docs/plans/260911a-figures-with-enough-resolution-to-read.md.
 *
 * ## 3. The extension is earned from the bytes, never claimed by the URL
 *
 * Publishers serve PNGs as `application/octet-stream`; bot walls serve HTML as
 * `image/jpeg`. This is the same lesson `sniffKind` already encodes for
 * documents (src/fetch.ts), for the same reason: a name that does not describe
 * its contents is the one thing content addressing must never store.
 *
 * ## 4. A PDF's own figures live here too, in their own collection
 *
 * An article made from a PDF has no `<img>` anywhere — stage 2 writes a
 * caption-only `<figure>` and a marker (src/pdf-figures.ts, src/pdf-read.ts).
 * The bytes behind those markers are recovered by the same step, and recorded
 * **beside** `entries` rather than inside it: `AssetEntry.url` promises the
 * exact string `getAttribute("src")` returns, and a pseudo-URL there would make
 * that promise false for every reader of the map. An additive
 * `pdfFigures?: PdfFigureEntry[]` is also the smaller change — `assets` is a
 * `jsonb` column typed as this interface (src/db/schema.ts), so it needs no
 * migration at all. GPT Sol, D4-2.
 */
import { RESERVED_ATTRS } from "./reserved.js";

/** The formats we host. Everything else stays hot-linked — see `sniffImage`. */
export type AssetExt = "png" | "jpeg" | "gif";

/**
 * Why an image is not stored. Reader-facing nowhere; this is for us.
 *
 * `storage` is the odd one and is the only reason here that is **not about the
 * image**: the bytes arrived and were a format we host, and putting them in the
 * bucket failed — a `CorruptObject` at a canonical name, or an outage. It is
 * separate from `network` because the two need different people. Folding it in
 * would file "a human with the service key has to look at this" under "try
 * again later". src/collect-assets.ts.
 */
export type AssetFailure =
  | "unsupported-format"
  | "too-big"
  | "not-found"
  | "blocked"
  | "network"
  | "storage"
  /**
   * The step's wall clock ran out before this image got a turn, or while it was
   * still on the wire. Nothing is known about the image at all.
   *
   * **Not `network`**, which promises the far end was asked and was slow, so a
   * re-run might do better — the difference is that this one is entirely about
   * us. **Not `budget`**, which is the *image-count* cap and means the article
   * has more than 200 figures; folding the two together would file "this
   * article is enormous" and "the pipeline is running slow today" under one
   * word with two different fixes. src/collect-assets.ts `ASSETS_BUDGET_MS`.
   */
  | "out-of-time"
  | "budget";

/** One image, as this revision found it. */
export type AssetEntry =
  | {
      /**
       * **The URL exactly as `getAttribute("src")` returns it** — decoded, not
       * the `&amp;` form that sits in the stored HTML. See the header.
       */
      url: string;
      status: "stored";
      /** Of the bytes we stored, which is the object's name. */
      sha256: string;
      ext: AssetExt;
      contentType: string;
      bytes: number;
      /**
       * **Where the bytes came from, when that was not `url`** — the `srcset`
       * candidate `preferredCandidateOf` chose. Absent means the bytes are
       * `url`'s own, which is every entry written before 2026-09-11 and every
       * image whose candidate failed.
       *
       * Recorded *beside* `url` and never instead of it: `url` is the lookup
       * key the reading view finds an element by, and keying on the candidate
       * would miss every entry, silently. See § 2 of the header.
       */
      from?: string;
    }
  | { url: string; status: "failed"; reason: AssetFailure; at: string };

/**
 * Every image this revision looked at.
 *
 * **Absent is a third state and not the same as empty.** No `Assets` at all
 * means the step has never run on this article — every one ingested before this
 * existed — and the reader must hot-link exactly as before. An `Assets` with no
 * `entries` means it ran and found no images. Collapsing those is how a feature
 * that has not shipped yet gets reported as one that failed.
 */
export interface Assets {
  /**
   * **A string, and it has to be.** `stampOf` (src/store/artifacts.ts) reads
   * this field only `if (typeof a.version === "string")`, so a number here is
   * silently dropped — and then a change to URL selection or sniffing would
   * leave every existing manifest reporting itself current on `sourceHash`
   * alone, and no article would ever re-run the step. GPT Sol, 2026-08-29.
   */
  version: "assets/2";
  /**
   * **What this step's own inputs hashed to** — `assetsInputHash`
   * (src/collect-assets.ts): the image URLs in the blocks and the PDF figure
   * markers in the blocks, and nothing else.
   *
   * It was `hashBlocks(blocks)` until 2026-09-06, and that was a live instance
   * of a family this codebase has already been bitten by and named
   * (src/pipeline.ts § `articleInputHash`): `hashBlocks` canonicalises a
   * block's `id`, `text`, `role` and `treatment` and **not** its `html`
   * (src/source-hash.ts), so adding a figure marker to a captioned figure
   * changed nothing it hashed. A carried-forward empty manifest would have gone
   * on reporting itself current and the step would never have run. GPT Sol,
   * D1-4.
   */
  sourceHash: string;
  fetchedAt: string;
  entries: AssetEntry[];
  /**
   * The figures a PDF came with — **absent unless the blocks carry at least one
   * marker.**
   *
   * Absent is the third state here exactly as it is for `entries` above: an
   * article ingested before this existed, an article that is not a PDF, and a
   * PDF whose transcription found no figures all look alike to a reader of this
   * field, and all three mean *there is nothing to draw*.
   *
   * **The marker is what decides, not the manifest.** A revision with markers
   * and no PDF behind them gets a list of `no-source` failures rather than an
   * absent field, because *we looked and there was no document* is a fact and
   * an absent field would report it as *nothing was ever here*. GPT Sol, C-2;
   * src/pipeline.ts § `recoverPdfFigures`. What must never
   * happen is a marker that is present in the blocks and missing from this
   * list: every one gets an entry, stored or failed, and
   * `pairPageFigures` (src/pdf-figures.ts) asserts that on the way through.
   * GPT Sol, D4-3.
   */
  pdfFigures?: PdfFigureEntry[];
}

/**
 * Why a figure marker ended up with no picture.
 *
 * The first seven are `PdfFigureFailure` in src/pdf-figures.ts, which decides
 * them on bytes; the last six are this step's, and cannot be decided there
 * because that module never encodes, stores, reads a bucket or watches a clock.
 *
 * **The six are six because folding them together loses the fix.** Until
 * 2026-09-06 four of them were spelled `out-of-time` — a missing object, a
 * hash-corrupt object, a PDF that would not open and a runaway guard all
 * reported as *the clock beat us* — so the one thing a reader of the manifest
 * wants (is this us, the bucket, the document, or this article's own size?)
 * was the one thing it did not say. That is the distinction `AssetFailure`
 * already keeps between `storage` and `network`, and it keeps it *because the
 * two need different people*. GPT Sol, C-4.
 * `pdfFigureFailure` in src/collect-pdf-figures.ts maps one union onto the
 * other with no default arm, so a new reason over there is a typecheck failure
 * here rather than a figure filed under whatever the fallback happened to be —
 * the shape `FAILURE_FOR` in src/collect-assets.ts already uses.
 *
 * **Spelled out rather than imported.** src/pdf-figures.ts reaches for
 * `node:crypto` and `node:zlib`, and this module is on the browser's side of
 * the fence (tests/client-imports.test.ts): a type-only import would be erased
 * at runtime and would still be an edge in the graph a bundler reads.
 */
export type PdfFigureFailure =
  /** No image operation on the page, or nothing left after the blank overlays. */
  | "no-raster"
  /** The page held more than one caption, more than one picture, or both. */
  | "ambiguous"
  | "unsupported-kind"
  | "grayscale-1bpp"
  | "bad-dimensions"
  | "too-many-pixels"
  | "byte-count-mismatch"
  /** The raster was fine and turning it into a PNG was not. */
  | "encode-failed"
  /**
   * **A bucket operation failed** — putting the PNG in, or getting the PDF back
   * out. `AssetFailure.storage`, and the same reason for being its own word: a
   * `CorruptObject` at a canonical name or a Storage outage needs a human with
   * the service key, and filing that under anything else files it under *try
   * again later*. src/collect-assets.ts.
   */
  | "storage"
  /**
   * **The PDF this article was made from is not there to look in.** Its
   * stage-1 manifest is missing or does not say it was a PDF at all, or the
   * object it names is gone, or what is at that name does not hash to it
   * (`RawDocumentUnavailable`, src/fetch.ts).
   *
   * Separate from `storage` because the fix is different and so is the person:
   * this one is re-fetch the article — or clear the object by hand — where
   * `storage` is fix the bucket. Separate from `out-of-time` because nobody's
   * clock ran out; the document really is not there, and a re-run will say the
   * same thing.
   */
  | "no-source"
  /**
   * **The bytes were read and verified and pdf.js would not open them.** A fact
   * about the document, and it is the reason a whole paper's figures share when
   * one bad document must not fail the step.
   *
   * Was folded into `out-of-time` until 2026-09-06, which erased what the hash
   * verification had just established — the bytes are exactly the ones the
   * manifest promises, so *we looked* is true and *we ran out of time* is not.
   * GPT Sol, C-4.
   */
  | "unreadable-pdf"
  /**
   * **The article's own cap, not this figure's.** More markers than the runaway
   * guard admits, or the article's shared byte budget was spent before this
   * figure's turn. `AssetFailure.budget` is the same word for the same fact, and
   * it is separate from `out-of-time` for the same reason: *this document is
   * enormous* and *the pipeline is running slow today* have two different fixes.
   * src/collect-pdf-figures.ts § `MAX_FIGURES`, § `MAX_ARTICLE_FIGURE_BYTES`.
   */
  | "budget"
  /**
   * **The step's wall clock ran out, or the caller cancelled it.** Nothing is
   * known about this figure at all — not that the document is bad, not that the
   * bucket is down. `PDF_FIGURES_BUDGET_MS`, src/collect-pdf-figures.ts.
   */
  | "out-of-time";

/**
 * One `<figure>` from a PDF, and what became of the picture behind it.
 *
 * Keyed by `ref`, which is the whole `data-spya-pdf-figure` value: the opaque
 * ref, the page and the ordinal (src/reserved.ts). The reading view matches it
 * exactly and therefore **fails closed** — a manifest carried into a revision
 * whose PDF has changed has no ref that matches, because the ref folds in the
 * raw PDF's sha256. GPT Sol, D1-5.
 *
 * Nothing in here is an object key, a bucket path or a sentence of ours: the
 * public DTO passes `Assets` through wholesale (src/public/dto.ts), so what a
 * stranger can read is the page number, an opaque string, a content hash and a
 * bounded reason. GPT Sol, I-9.
 */
export type PdfFigureEntry =
  | {
      ref: string;
      /** 1-based, the way a reader counts pages. Diagnostics, not addressing. */
      page: number;
      status: "stored";
      sha256: string;
      /** Always `png` today — src/pdf-figures.ts re-encodes rather than passing through. */
      ext: AssetExt;
      contentType: string;
      bytes: number;
      width: number;
      height: number;
    }
  | { ref: string; page: number; status: "failed"; reason: PdfFigureFailure; at: string };

/* ------------------------------------------------------------------ *
 * Finding the images
 * ------------------------------------------------------------------ */

/**
 * The least of a DOM this module needs.
 *
 * Structural rather than `Element`, because the main tsconfig has no `DOM` lib
 * — and because saying exactly what is required makes it obvious that a jsdom
 * node and a browser node are equally acceptable, which is the whole point.
 */
export interface AttributeReader {
  getAttribute(name: string): string | null;
}

export interface ParsedRoot {
  querySelectorAll(selectors: string): Iterable<AttributeReader>;
}

/**
 * `img` and only `img`.
 *
 * Not "anything with a `src`". The real corpus has a YouTube `<iframe>` that
 * survives into `blocks.json`, and a `<video poster>` is a still we have no
 * story for yet. Widening this is a decision, not a tidy-up.
 */
export const IMAGE_SELECTOR = "img[src]";

/**
 * Is this something we could fetch and would want to?
 *
 * **Absolute http(s) only.** A `data:` URI is already inline and costs nothing
 * to leave alone. A relative URL after stage 2 means Readability had no base to
 * resolve against, which is a different bug and not one to paper over here.
 *
 * **Protocol-relative (`//host/x.png`) is refused rather than repaired**, and
 * the thing that refuses it is `new URL` with no base, which cannot parse one.
 * A browser would read it as the page's own scheme; supplying a scheme here
 * would mean guessing, and a guess fetches a real file from a real server —
 * the wrong one, quietly. Readability absolutises every `src` it emits, so it
 * should not arise anyway.
 *
 * **So do not give `new URL` a base.** A second argument would make every
 * relative and protocol-relative URL above suddenly parse and become
 * fetchable, and nothing here would say so. An explicit `startsWith("//")`
 * branch used to sit below as a belt to that brace; it was removed because
 * deleting it changed no test — an untested guard that reads as protection is
 * worse than the sentence you are reading.
 */
export function isRehostableUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * **The URL one `<img>` would have the browser fetch**, or `null` for one we
 * would leave alone.
 *
 * Split out of the walk below on 2026-09-06, when the reading view finally
 * acquired a second caller — and split out rather than re-typed there, because
 * this one expression is the whole of the agreement described in § 1 above. The
 * pipeline builds a manifest keyed on what this returns and the browser looks
 * an element up by what this returns, so `getAttribute`, the `trim` and the
 * rehostable test cannot drift apart between them: there is one copy.
 *
 * Re-typing it would not throw. It would miss every entry, silently, and the
 * feature would appear to do nothing.
 */
export function imageSourceOf(element: AttributeReader): string | null {
  const src = element.getAttribute("src");
  if (src === null) return null;
  const url = src.trim();
  return isRehostableUrl(url) ? url : null;
}

/**
 * Every image URL in `root` worth fetching, in document order, each once.
 *
 * Deduped because one picture used twice is one object and one request, and
 * because the manifest is keyed by URL — two entries for one key is a shape the
 * index below could not represent honestly.
 */
export function imageSourcesIn(root: ParsedRoot): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const element of root.querySelectorAll(IMAGE_SELECTOR)) {
    const url = imageSourceOf(element);
    if (url === null || seen.has(url)) continue;
    seen.add(url);
    found.push(url);
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * A bigger picture than the `src`, when the publisher offers one
 * ------------------------------------------------------------------ */

/**
 * **The width we go looking for**, in image pixels.
 *
 * A proposal Greg chose to trial on 2026-09-11, not a measured optimum. The
 * reading column is ~660 CSS px and the ⤢ panel up to 1,600, so ~1,280 is the
 * column at 2× or most of the panel at 1× — enough for a label to be read in
 * either, and a long way short of the 1,920 and 2,880 publishers also offer.
 */
export const PREFERRED_IMAGE_WIDTH = 1280;

/**
 * Bounds on what the parser will read — a `srcset` is the publisher's text and
 * the walk is over every image of every article. Past either, it is not a list
 * we try to understand, and the image keeps its `src`.
 */
const MAX_SRCSET_CHARS = 8192;
const MAX_SRCSET_CANDIDATES = 32;

/** HTML's ASCII whitespace, which is what separates a `srcset`'s tokens. */
const SRCSET_SPACE = /[\t\n\f\r ]/;

/** One width descriptor, surrounded only by the whitespace HTML permits here. */
const SRCSET_WIDTH = /^[\t\n\f\r ]*([1-9][0-9]{0,4})w[\t\n\f\r ]*$/;

/** The first non-space code unit at or after `at`. */
function afterSrcsetSpaces(srcset: string, at: number): number {
  while (at < srcset.length && SRCSET_SPACE.test(srcset[at] as string)) at += 1;
  return at;
}

/** One candidate beginning at `at`, and where its delimiter sits. */
function widthCandidateAt(
  srcset: string,
  at: number,
): { url: string; width: number; delimiter: number } | null {
  const start = at;
  while (at < srcset.length && !SRCSET_SPACE.test(srcset[at] as string)) at += 1;
  const url = srcset.slice(start, at);
  if (url.endsWith(",")) return null;

  const from = at;
  while (at < srcset.length && srcset[at] !== ",") {
    if (srcset[at] === "(") return null;
    at += 1;
  }
  const descriptor = SRCSET_WIDTH.exec(srcset.slice(from, at));
  if (!descriptor) return null;
  return { url, width: Number(descriptor[1]), delimiter: at };
}

/**
 * A `srcset` whose every candidate carries a **width descriptor** — `600w` —
 * or `null` for anything else.
 *
 * A tokenizer after the HTML standard's "parse a srcset attribute", cut down to
 * the one form we act on and made to **refuse rather than guess** on everything
 * else: a density descriptor (`2x`), a candidate with no descriptor, a `h`
 * descriptor, a `(`, a zero or absurd width, two candidates claiming the same
 * width, an empty comma-delimited candidate, non-ASCII descriptor whitespace,
 * or a list past the bounds above. A mixed list is refused whole, not filtered
 * — a candidate we cannot read is one we cannot rank. Refusing costs the reader
 * nothing they have today: the image keeps its `src`.
 *
 * The URL token is a run of non-space characters, so a `data:` URL's own comma
 * does not split it; a URL token *ending* in commas is a candidate with no
 * descriptor, which is refused.
 */
export function widthCandidatesOf(srcset: string): { url: string; width: number }[] | null {
  if (srcset.length > MAX_SRCSET_CHARS) return null;
  const found: { url: string; width: number }[] = [];
  const widths = new Set<number>();
  let at = afterSrcsetSpaces(srcset, 0);
  if (at >= srcset.length || srcset[at] === ",") return null;
  for (;;) {
    const candidate = widthCandidateAt(srcset, at);
    if (!candidate || widths.has(candidate.width)) return null;
    widths.add(candidate.width);
    found.push({ url: candidate.url, width: candidate.width });
    if (found.length > MAX_SRCSET_CANDIDATES) return null;
    if (candidate.delimiter >= srcset.length) break;
    at = afterSrcsetSpaces(srcset, candidate.delimiter + 1);
    if (at >= srcset.length || srcset[at] === ",") return null;
  }
  return found.length > 0 ? found : null;
}

/**
 * **The one `srcset` candidate worth fetching instead of `src`**, or `null`.
 *
 * The smallest candidate at least `PREFERRED_IMAGE_WIDTH` wide, else the widest
 * there is. `null` whenever `widthCandidatesOf` refuses, when any candidate is
 * not an absolute http(s) URL (`isRehostableUrl`, the same test the `src` gets),
 * and when the choice *is* the `src` — there is nothing to fetch twice.
 *
 * **Only the `<img>`'s own `srcset`.** A sibling `<source>` is never read: it is
 * chosen by `type` or `media` — a format we may not host, or a different crop
 * for a different screen — and the reading view deletes it anyway. The widest
 * candidate may in principle be narrower than the `src` (the list is the
 * publisher's claim and the `src` has no descriptor); the byte and time caps
 * still hold, and the plan names it as a known edge.
 *
 * What is chosen here is only ever a *preference*. The step fetches it through
 * the same guarded fetch as the `src` — address guard, redirect checks, byte
 * cap — and falls back to the `src` if it fails or is not a format we host.
 */
export function preferredCandidateOf(element: AttributeReader, src: string): string | null {
  const srcset = element.getAttribute("srcset");
  if (srcset === null) return null;
  const candidates = widthCandidatesOf(srcset);
  if (!candidates?.every((c) => isRehostableUrl(c.url))) return null;
  const ascending = [...candidates].sort((a, b) => a.width - b.width);
  const chosen =
    ascending.find((c) => c.width >= PREFERRED_IMAGE_WIDTH) ?? ascending[ascending.length - 1];
  if (!chosen || chosen.url === src) return null;
  return chosen.url;
}

/** One image the step will fetch: its name, and the bigger picture to try first. */
export interface ImageCandidate {
  /** `imageSourceOf`'s answer, and the manifest key. */
  src: string;
  /** `preferredCandidateOf`'s answer: fetched first, recorded as `from`. */
  preferred: string | null;
}

/**
 * **`imageSourcesIn`, with each image's preferred candidate beside it** — the
 * pipeline's walk. The browser keeps `imageSourcesIn`, which never parses a
 * `srcset`, and the two agree on the `src`s because both are `imageSourceOf`
 * over the same selector with the same first-wins dedupe;
 * tests/figure-candidates.test.ts holds them to it.
 *
 * One picture used twice is one entry, and the first occurrence's `srcset`
 * decides — the manifest is keyed by `src`, so a second candidate for the same
 * key has nowhere to go.
 */
export function imageCandidatesIn(root: ParsedRoot): ImageCandidate[] {
  const found: ImageCandidate[] = [];
  const seen = new Set<string>();
  for (const element of root.querySelectorAll(IMAGE_SELECTOR)) {
    const src = imageSourceOf(element);
    if (src === null || seen.has(src)) continue;
    seen.add(src);
    found.push({ src, preferred: preferredCandidateOf(element, src) });
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * Finding the PDF figures
 * ------------------------------------------------------------------ */

/** Every `<figure>` stage 2 marked as having come from a PDF page. */
export const PDF_FIGURE_SELECTOR = `[${RESERVED_ATTRS.pdfFigure}]`;

/**
 * Where one figure sits in the PDF it came from, and the string that says so.
 *
 * `page` and `ordinal` are both 1-based. They travel in the attribute rather
 * than being recovered from the ref because **a digest cannot be inverted**:
 * the assets step pairs markers to images one page at a time and has no other
 * way to learn which page a caption was on, and the ordinal is one of the ref's
 * own inputs. src/reserved.ts § `pdfFigure` has the rest of the argument.
 */
export interface PdfFigureMarker {
  /**
   * **The whole attribute value, not the digest inside it** — because this is
   * the string the manifest is keyed by and the reading view looks up, and one
   * lookup key is safer than three fields that have to agree.
   *
   * So `pdfFigureMarkerValue` takes `figureRef` and this gives back `ref`: the
   * asymmetry is deliberate and is the only thing to know about the pair.
   */
  ref: string;
  page: number;
  ordinal: number;
}

/**
 * The attribute value for one marker: `<figureRef>.<page>.<ordinal>`.
 *
 * `figureRef` is `pdfFigureRef`'s output (src/pdf-figures.ts) — the opaque
 * half, which is what makes a lookup fail closed once the PDF underneath has
 * changed. The result is what `PdfFigureMarker.ref` will be.
 *
 * `.` as the separator because a ref is `[a-z0-9]+-[0-9a-f]{32}` and the two
 * numbers are decimal, so none of the three parts can contain one — the same
 * reasoning `pdfFigureRef` gives for its own join, and for the same reason:
 * without a separator, page 1 figure 23 and page 12 figure 3 would spell the
 * same marker.
 */
export function pdfFigureMarkerValue(input: {
  figureRef: string;
  page: number;
  ordinal: number;
}): string {
  return `${input.figureRef}.${input.page}.${input.ordinal}`;
}

/**
 * A marker value read back, or `null` for anything that is not one.
 *
 * **Deliberately strict**, and the version tag is deliberately *not* pinned: a
 * `PDF_FIGURE_REF_VERSION` bump must go on parsing here so the entry it no
 * longer matches is a miss rather than a crash. What is pinned is the shape —
 * a tag, thirty-two hex digits, and two positive integers with no leading zeros
 * — because everything downstream indexes by this string and a value it cannot
 * explain is a value it should not carry.
 *
 * `null` is *not one of ours*, which is what a forged attribute on a web
 * article looks like, and what a value truncated by some future editor looks
 * like too. Both mean the same thing to every caller: there is no figure here.
 *
 * **The two numbers are bounded to six digits, and that is the safe-integer
 * check.** `[1-9][0-9]*` accepted a page of arbitrary length, and `Number` of a
 * 400-digit decimal is `Infinity`, which `JSON.stringify` writes as `null` — so
 * a forged attribute could put a `page: null` into a manifest typed `number`
 * and out through the public DTO. Verified by GPT Sol, C-5. Six digits caps
 * both at 999,999, which is beyond any document that exists and *provably*
 * inside `Number.MAX_SAFE_INTEGER` — a bound in the grammar rather than a
 * second test after it, so there is one place the shape is decided.
 */
const MARKER = /^([a-z][a-z0-9]*-[0-9a-f]{32})\.([1-9][0-9]{0,5})\.([1-9][0-9]{0,5})$/;

export function parsePdfFigureMarker(value: string): PdfFigureMarker | null {
  const trimmed = value.trim();
  const match = MARKER.exec(trimmed);
  if (!match) return null;
  return { ref: trimmed, page: Number(match[2]), ordinal: Number(match[3]) };
}

/**
 * Every PDF figure marker in `root`, in document order, each once.
 *
 * The twin of `imageSourcesIn` above and structural for the same reason: the
 * pipeline hands it a jsdom node and the reading view hands it a browser one,
 * and the *selection and the attribute read* — the part that has to agree —
 * happens exactly once, here.
 *
 * **`ref` is the whole attribute value**, so a marker is one string to look up
 * and not three fields to keep in step.
 *
 * ## A repeated ref refuses *both*, and it used to silently keep the first
 *
 * Two `<figure>`s carrying one ref is a bug in the renderer, and the manifest
 * cannot describe it honestly: it is keyed by ref, so one entry is all there
 * is. Keeping the first occurrence meant both elements looked that one entry up
 * and **the same picture appeared under two different captions** — a fabricated
 * claim about the paper, with the app's authority behind it, and invisible to
 * the reader. That is precisely what `pairPageFigures` (src/pdf-figures.ts)
 * refuses `ambiguous` for one page at a time, and the silent dedupe here meant
 * production could never reach its duplicate-ref assertion at all. GPT Sol,
 * C-5.
 *
 * So a ref seen more than once yields **no** marker, and both `<figure>`s stay
 * caption-only — the same trade Fable's call made and for the same reason: a
 * missing figure is visible, a wrong one is not. It is not recorded as a
 * failure either, because a marker that was never returned was never promised
 * to anybody; the invariant every later stage carries is that every marker
 * *this walk hands back* gets an entry.
 */
export function pdfFigureMarkersIn(root: ParsedRoot): PdfFigureMarker[] {
  const parsed: PdfFigureMarker[] = [];
  const times = new Map<string, number>();
  for (const element of root.querySelectorAll(PDF_FIGURE_SELECTOR)) {
    const raw = element.getAttribute(RESERVED_ATTRS.pdfFigure);
    if (raw === null) continue;
    const marker = parsePdfFigureMarker(raw);
    if (!marker) continue;
    parsed.push(marker);
    times.set(marker.ref, (times.get(marker.ref) ?? 0) + 1);
  }
  return parsed.filter((marker) => times.get(marker.ref) === 1);
}

/* ------------------------------------------------------------------ *
 * What the bytes are
 * ------------------------------------------------------------------ */

export interface SniffedImage {
  ext: AssetExt;
  contentType: string;
}

/**
 * The three signatures, as bytes. `null` in a pattern matches anything.
 *
 * Hand-written rather than taken from a library, and that is a reversal worth
 * recording. The first draft of the plan recommended `image-size` pinned at
 * `2.0.2`, on the stated basis that all three of its 2025 infinite-loop
 * advisories were fixed there. Checked against the GitHub advisory API on
 * 2026-08-29, that was wrong: the 2025 advisory (GHSA-m5qc-5hw7-8vg7) is fixed
 * in 2.0.2 and lists *three affected ranges*, while **GHSA-w3rx-r6r6-pgpr**
 * (ICNS) and **GHSA-5p2g-fcmc-qvqq** (JXL and HEIF) affect `<= 2.0.2` with no
 * patched release at all — both filed a week after the maintainer archived the
 * repository. GPT Sol caught it.
 *
 * Three fixed-offset comparisons are genuinely short, and they cannot loop.
 */
const SIGNATURES: { ext: AssetExt; contentType: string; magic: (number | null)[] }[] = [
  {
    ext: "png",
    contentType: "image/png",
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  /* SOI plus the first byte of the next marker. `FF D8` alone is two bytes and
     matches far too much. */
  { ext: "jpeg", contentType: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  /* `GIF87a` and `GIF89a` — the version digit is the only difference. */
  { ext: "gif", contentType: "image/gif", magic: [0x47, 0x49, 0x46, 0x38, null, 0x61] },
];

/**
 * What these bytes actually are, or `null` for anything we do not host.
 *
 * **Length is checked before content**, which is not a formality: a truncated
 * download shares its leading bytes with the real thing, and a comparison that
 * ran off the end of a short buffer would read `undefined !== 0x89` as a
 * mismatch by luck rather than by rule. A four-byte prefix of a PNG must not be
 * called a PNG, because the name we store is a promise about the file.
 *
 * `null` is not an error. It is "we do not host this", and the caller records
 * `unsupported-format` and leaves the image hot-linked — which is what happens
 * to every WebP, AVIF and SVG today. Widening this list means deciding how the
 * new format is served; SVG in particular is a document that runs script when
 * navigated to, and the sandbox CSP that would contain it is not carried into
 * the `blob:` URL an owned asset reaches the page through.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  for (const { ext, contentType, magic } of SIGNATURES) {
    if (matchesMagic(bytes, magic)) return { ext, contentType };
  }
  return null;
}

/**
 * Does `bytes` start with this signature? `null` in the pattern matches any
 * single byte.
 *
 * **Exported so the length check has a test that can fail.** Breaking that
 * check reddened nothing when this was inlined, because none of the three
 * signatures above ends in a wildcard — so a short buffer was caught by the
 * byte comparison instead (`undefined !== 0x89`), and the assertion passed for
 * a reason that had nothing to do with the guard it named. A signature ending
 * in `null` is the case where length is the *only* thing standing between a
 * truncated download and a name asserting it is a whole file, and
 * tests/assets.test.ts now builds exactly that.
 * docs/reusable/silent-success.md.
 */
export function matchesMagic(bytes: Uint8Array, magic: readonly (number | null)[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    const want = magic[i];
    if (want !== null && want !== undefined && bytes[i] !== want) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * How big the picture is
 * ------------------------------------------------------------------ */

/**
 * **What a picture says its own size is, read out of its header** — or `null`
 * when the bytes do not say, which is *we do not know* rather than *zero*.
 *
 * Hand-written header reads, no library and no native dependency, which is the
 * choice `SIGNATURES` above already made and gives its reasons for: `image-size`
 * has two unpatched advisories against `<= 2.0.2` and an archived repository,
 * and `@napi-rs/canvas` would decode the whole picture — width × height × 4
 * bytes — to answer a question the first few dozen bytes already answer.
 *
 * Tested against the real plates in `evals/results/illustrated-2026-09-03b/`,
 * which is the only way to know a marker walk is right.
 *
 * This lives here, beside `sniffImage`, because there are now two callers:
 * `readPlate` in src/ai-call.ts, whose private `pngDimensions` this replaces at
 * its own invitation — *"if a second ever wants it, that is where it should
 * move"* — and `storePlateImage` in src/illustrated-image.ts, which needs the
 * numbers for the artefact rather than for a bound.
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const sniffed = sniffImage(bytes);
  if (!sniffed) return null;
  if (sniffed.ext === "png") return pngDimensions(bytes);
  if (sniffed.ext === "jpeg") return jpegDimensions(bytes);
  return null;
}

/**
 * A PNG's stated dimensions.
 *
 * IHDR is the first chunk and its two big-endian `uint32`s sit at a fixed
 * offset, so this is a read rather than a parse — no loop, nothing to run away
 * with.
 */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  /* 8 signature bytes + 4 length + 4 type + 8 of IHDR. */
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * A JPEG's dimensions, from the first Start-Of-Frame marker.
 *
 * Unlike PNG this is a **walk**, because a JPEG's SOF sits after however many
 * APPn, DQT and COM segments the encoder felt like emitting — 20 bytes into the
 * plates OpenRouter returns, 600-odd into one carrying an ICC profile. Three
 * things make the walk safe rather than a place to run away with:
 *
 *  - every step moves forward by at least one byte, and the loop is bounded by
 *    the buffer's own length;
 *  - a segment length under 2 is refused rather than treated as a delta, or a
 *    stream of `FF C0 00 00` would advance by nothing forever;
 *  - anything it cannot follow returns `null`, which the caller reads as *we do
 *    not know*.
 *
 * `0xFF` is also the fill byte, so a run of them between segments is skipped
 * rather than parsed. `0xD0`–`0xD9` (restart markers, SOI, EOI) and `0x01` are
 * standalone and carry no length. `0xC4`, `0xC8` and `0xCC` sit inside the
 * `C0`–`CF` range and are *not* frame headers — DHT, JPG and DAC — which is the
 * one thing a naive `>= 0xC0 && <= 0xCF` test gets wrong, and it gets it wrong
 * by reading a Huffman table's first bytes as a picture's size.
 */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let at = 2; // past SOI, which `sniffImage` has already vouched for
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    let marker = bytes[at + 1] as number;
    /* Fill bytes: any number of extra `FF`s may precede the marker itself. */
    while (marker === 0xff && at + 2 < bytes.length) {
      at += 1;
      marker = bytes[at + 1] as number;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    const length = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      /* marker(2) + length(2) + precision(1) + height(2) + width(2) */
      if (at + 9 > bytes.length) return null;
      const height = ((bytes[at + 5] as number) << 8) | (bytes[at + 6] as number);
      const width = ((bytes[at + 7] as number) << 8) | (bytes[at + 8] as number);
      return { width, height };
    }
    at += 2 + length;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Looking one up
 * ------------------------------------------------------------------ */

/** A stored entry, narrowed — the only kind the reading view may act on. */
export type StoredAsset = Extract<AssetEntry, { status: "stored" }>;

/**
 * URL → the object to serve instead, for the images that have one.
 *
 * **Failed entries are deliberately absent rather than present-and-marked.** A
 * caller asking "do I have a copy of this?" gets one answer for *failed* and
 * for *never looked at*, and that is correct: both mean leave the publisher's
 * URL exactly where it is. Putting failures in the map would invite a caller to
 * branch on them, and the only branch is the one it already takes.
 *
 * `undefined` in means an article the step has never run on, and an empty map
 * out means the same thing to every reader of it.
 */
export function assetIndex(assets: Assets | undefined): Map<string, StoredAsset> {
  const index = new Map<string, StoredAsset>();
  for (const entry of assets?.entries ?? []) {
    if (entry.status === "stored") index.set(entry.url, entry);
  }
  return index;
}
