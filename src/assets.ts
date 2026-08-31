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
 * ## 3. The extension is earned from the bytes, never claimed by the URL
 *
 * Publishers serve PNGs as `application/octet-stream`; bot walls serve HTML as
 * `image/jpeg`. This is the same lesson `sniffKind` already encodes for
 * documents (src/fetch.ts), for the same reason: a name that does not describe
 * its contents is the one thing content addressing must never store.
 */

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
  version: "assets/1";
  /** The blocks hash this was built from — the ordinary freshness stamp. */
  sourceHash: string;
  fetchedAt: string;
  entries: AssetEntry[];
}

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
    const src = element.getAttribute("src");
    if (src === null) continue;
    const url = src.trim();
    if (!isRehostableUrl(url) || seen.has(url)) continue;
    seen.add(url);
    found.push(url);
  }
  return found;
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
