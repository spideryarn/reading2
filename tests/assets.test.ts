// @vitest-environment jsdom
/**
 * The pure half of hosting an article's images: which URLs we would fetch, and
 * what the bytes turn out to be.
 *
 * **Everything here runs under jsdom on purpose**, because the one thing this
 * module exists to get right is that the pipeline reads a URL the same way the
 * browser will. `blocks.json` stores `&amp;`; `getAttribute` returns `&`. Key
 * the manifest on one and look it up with the other and every lookup misses —
 * with no error, no missing image, and a feature that appears to do nothing.
 * Five of the thirteen images in the real corpus are like that.
 *
 * docs/plans/260829b-hosting-the-articles-images.md § trap 3.
 */
import { describe, expect, it } from "vitest";

import {
  assetIndex,
  type Assets,
  imageSourcesIn,
  isRehostableUrl,
  matchesMagic,
  parsePdfFigureMarker,
  pdfFigureMarkersIn,
  pdfFigureMarkerValue,
  sniffImage,
} from "../src/assets.js";

/** Parse like the client does — `innerHTML` on a detached node. */
function host(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

const NOEMA =
  "https://noemamag.imgix.net/2026/01/anil.jpg?fm=pjpg&amp;ixlib=php-3.3.1&amp;s=3a2bee71";
/** The same URL as the DOM hands it back. */
const NOEMA_DECODED =
  "https://noemamag.imgix.net/2026/01/anil.jpg?fm=pjpg&ixlib=php-3.3.1&s=3a2bee71";

describe("imageSourcesIn", () => {
  it("returns the URL the DOM decodes, not the one in the file", () => {
    /* The whole point of the module. If this ever returns the `&amp;` form,
       every client lookup misses and nothing anywhere throws. */
    expect(imageSourcesIn(host(`<p><img src="${NOEMA}"></p>`))).toEqual([NOEMA_DECODED]);
  });

  it("finds images wherever they sit", () => {
    const found = imageSourcesIn(
      host(
        `<figure><img src="https://a.example/1.png"><figcaption>x</figcaption></figure>` +
          `<p>words <a href="https://b.example"><img src="https://a.example/2.png"></a></p>` +
          `<picture><source srcset="https://a.example/3.png"><img src="https://a.example/4.png"></picture>`,
      ),
    );
    expect(found).toEqual([
      "https://a.example/1.png",
      "https://a.example/2.png",
      "https://a.example/4.png",
    ]);
  });

  it("does not collect srcset candidates", () => {
    /* We fetch the `src` and delete `srcset` at render. Collecting candidates
       here would be 46 URLs for the corpus's 13 images — the same pictures at
       different widths, which content addressing cannot dedup. */
    const found = imageSourcesIn(
      host(
        `<img src="https://a.example/1.png" srcset="https://a.example/1-2x.png 2x, https://a.example/1-3x.png 3x">`,
      ),
    );
    expect(found).toEqual(["https://a.example/1.png"]);
  });

  it("is images only, not everything with a src", () => {
    /* The real corpus has a YouTube iframe that survives into blocks.json. */
    const found = imageSourcesIn(
      host(
        `<iframe src="https://www.youtube.com/embed/abc"></iframe>` +
          `<video src="https://a.example/v.mp4" poster="https://a.example/p.png"></video>` +
          `<script src="https://a.example/x.js"></script>` +
          `<img src="https://a.example/1.png">`,
      ),
    );
    expect(found).toEqual(["https://a.example/1.png"]);
  });

  it("keeps document order and says each URL once", () => {
    const found = imageSourcesIn(
      host(
        `<img src="https://a.example/b.png"><img src="https://a.example/a.png">` +
          `<img src="https://a.example/b.png">`,
      ),
    );
    expect(found).toEqual(["https://a.example/b.png", "https://a.example/a.png"]);
  });

  it("skips what cannot or should not be fetched", () => {
    const found = imageSourcesIn(
      host(
        `<img src="data:image/png;base64,iVBORw0KGgo=">` +
          `<img src="/relative.png">` +
          `<img src="//protocol.example/x.png">` +
          `<img src="">` +
          `<img src="   ">` +
          `<img alt="no src at all">` +
          `<img src="javascript:alert(1)">` +
          `<img src="https://a.example/keep.png">`,
      ),
    );
    expect(found).toEqual(["https://a.example/keep.png"]);
  });
});

describe("isRehostableUrl", () => {
  it("takes absolute http and https and nothing else", () => {
    expect(isRehostableUrl("https://a.example/x.png")).toBe(true);
    expect(isRehostableUrl("http://a.example/x.png")).toBe(true);
    expect(isRehostableUrl("data:image/png;base64,iVBOR")).toBe(false);
    expect(isRehostableUrl("javascript:alert(1)")).toBe(false);
    expect(isRehostableUrl("file:///etc/passwd")).toBe(false);
    expect(isRehostableUrl("/relative.png")).toBe(false);
    /* Protocol-relative is a real URL to a browser and not to `new URL`. After
       Readability every src is absolute, so this is refused rather than guessed
       at: guessing a scheme is how you fetch the wrong thing silently. */
    expect(isRehostableUrl("//a.example/x.png")).toBe(false);
    expect(isRehostableUrl("")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Sniffing
 * ------------------------------------------------------------------ */

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const GIF87 = Uint8Array.from([...Buffer.from("GIF87a"), 1, 0, 1, 0]);
const GIF89 = Uint8Array.from([...Buffer.from("GIF89a"), 1, 0, 1, 0]);

describe("sniffImage", () => {
  it("names the three formats the corpus actually has", () => {
    expect(sniffImage(PNG)).toEqual({ ext: "png", contentType: "image/png" });
    expect(sniffImage(JPEG)).toEqual({ ext: "jpeg", contentType: "image/jpeg" });
    expect(sniffImage(GIF87)).toEqual({ ext: "gif", contentType: "image/gif" });
    expect(sniffImage(GIF89)).toEqual({ ext: "gif", contentType: "image/gif" });
  });

  it("refuses everything else by name", () => {
    const webp = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
    const avif = Uint8Array.from([0, 0, 0, 0x20, ...Buffer.from("ftypavif")]);
    const svg = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    const html = Uint8Array.from(Buffer.from("<!doctype html><html><body>nope"));
    for (const bytes of [webp, avif, svg, html]) expect(sniffImage(bytes)).toBeNull();
  });

  it("says nothing about bytes it does not have", () => {
    /* A truncated header must not match. Note these pass on the byte
       comparison alone — see the length-check test below, which is the one
       that actually exercises the guard. */
    expect(sniffImage(new Uint8Array(0))).toBeNull();
    expect(sniffImage(PNG.slice(0, 4))).toBeNull();
    expect(sniffImage(JPEG.slice(0, 2))).toBeNull();
    expect(sniffImage(Uint8Array.from(Buffer.from("GIF8")))).toBeNull();
  });

  it("is the length check stopping a signature that ends in a wildcard", () => {
    /* **This test exists because deleting the length check reddened nothing.**
       None of the three real signatures ends in a `null`, so a short buffer is
       always caught by the byte comparison instead — `undefined !== 0x89` —
       and every assertion above passed for a reason unrelated to the guard it
       claimed to be about.

       With a trailing wildcard, length is the only thing left: without the
       check, three bytes match a four-byte pattern and a truncated download is
       stored under a name promising a whole file. */
    const trailingWildcard = [0x41, 0x42, 0x43, null];
    expect(matchesMagic(Uint8Array.from([0x41, 0x42, 0x43, 0x44]), trailingWildcard)).toBe(true);
    expect(matchesMagic(Uint8Array.from([0x41, 0x42, 0x43]), trailingWildcard)).toBe(false);
    expect(matchesMagic(new Uint8Array(0), trailingWildcard)).toBe(false);
  });

  it("believes the bytes over the name", () => {
    /* Publishers serve PNGs as application/octet-stream and bot walls serve
       HTML as image/jpeg. The extension we store is earned, never claimed. */
    expect(sniffImage(PNG)?.ext).toBe("png");
    expect(sniffImage(Uint8Array.from(Buffer.from("<!doctype html>")))).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The index the reader looks things up in
 * ------------------------------------------------------------------ */

describe("assetIndex", () => {
  const assets: Assets = {
    version: "assets/2",
    sourceHash: "abc",
    fetchedAt: "2026-08-29T00:00:00.000Z",
    entries: [
      {
        url: NOEMA_DECODED,
        status: "stored",
        sha256: "a".repeat(64),
        ext: "jpeg",
        contentType: "image/jpeg",
        bytes: 1234,
      },
      { url: "https://a.example/gone.png", status: "failed", reason: "not-found", at: "2026-08-29T00:00:00.000Z" },
    ],
  };

  it("finds a stored entry by the URL the DOM produces", () => {
    const index = assetIndex(assets);
    expect(index.get(NOEMA_DECODED)?.sha256).toBe("a".repeat(64));
  });

  it("holds only stored entries, so a failure reads as absent", () => {
    /* A failed entry must not be rewritable. Three states, not two: stored,
       failed, and never-looked-at — and the last two both mean "leave the
       publisher URL alone", which is what an absent index entry says. */
    const index = assetIndex(assets);
    expect(index.has("https://a.example/gone.png")).toBe(false);
    expect(index.size).toBe(1);
  });

  it("is empty for an article the step never ran on", () => {
    expect(assetIndex(undefined).size).toBe(0);
    expect(assetIndex({ ...assets, entries: [] }).size).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * The PDF figure markers
 * ------------------------------------------------------------------ */

/** A well-formed ref, shaped exactly as `pdfFigureRef` mints one. */
const REF = `pdffig1-${"0123456789abcdef".repeat(2)}`;

describe("parsePdfFigureMarker", () => {
  it("reads back what pdfFigureMarkerValue wrote", () => {
    const value = pdfFigureMarkerValue({ figureRef: REF,page: 12, ordinal: 3 });
    expect(parsePdfFigureMarker(value)).toEqual({ ref: value, page: 12, ordinal: 3 });
  });

  it("keeps page 1 figure 23 and page 12 figure 3 apart", () => {
    /* Without a separator the two would spell the same marker, which is the
       collision `pdfFigureRef` joins its own fields to avoid. */
    expect(pdfFigureMarkerValue({ figureRef: REF,page: 1, ordinal: 23 })).not.toBe(
      pdfFigureMarkerValue({ figureRef: REF,page: 12, ordinal: 3 }),
    );
  });

  it("refuses anything that is not one of ours", () => {
    for (const bad of [
      "",
      REF,
      `${REF}.3`,
      `${REF}.0.1`,
      `${REF}.03.1`,
      `${REF}.3.1.1`,
      `${REF}.-3.1`,
      "pdffig1-notahexdigestnotahexdigestno.3.1",
      `${REF.toUpperCase()}.3.1`,
      "<img src=x>",
    ]) {
      expect(parsePdfFigureMarker(bad), bad).toBeNull();
    }
  });

  it("refuses a page number no document could have, rather than parsing it to Infinity", () => {
    /* **`Number("9".repeat(400))` is `Infinity`, and `JSON.stringify(Infinity)`
       is `null`** — so before the grammar bounded these two fields, a forged
       attribute could put a `page: null` into a manifest whose type says
       `number`, and out through the public DTO to a stranger. Verified by GPT
       Sol, C-5. Six digits is the bound, which is beyond any document that
       exists and provably inside `Number.MAX_SAFE_INTEGER`. */
    expect(parsePdfFigureMarker(`${REF}.${"9".repeat(400)}.1`)).toBeNull();
    expect(parsePdfFigureMarker(`${REF}.1.${"9".repeat(400)}`)).toBeNull();
    expect(parsePdfFigureMarker(`${REF}.1234567.1`)).toBeNull();
    /* And the bound is a bound, not a ban: the largest page it does admit still
       parses to a safe integer. */
    const most = parsePdfFigureMarker(`${REF}.999999.999999`);
    expect(most?.page).toBe(999_999);
    expect(Number.isSafeInteger(most?.ordinal)).toBe(true);
  });

  it("goes on parsing a ref whose version tag it has never seen", () => {
    /* A `PDF_FIGURE_REF_VERSION` bump must land as a lookup that misses, not as
       a marker nothing can read: the entry it no longer matches is the point. */
    expect(parsePdfFigureMarker(`pdffig9-${"a".repeat(32)}.2.1`)?.page).toBe(2);
  });
});

describe("pdfFigureMarkersIn", () => {
  it("finds the markers a PDF's figures carry, in document order", () => {
    const root = host(
      `<figure data-spya-pdf-figure="${REF}.3.1"><figcaption>Fig 1</figcaption></figure>` +
        `<p>prose</p>` +
        `<figure data-spya-pdf-figure="${REF}.4.1"><figcaption>Fig 2</figcaption></figure>`,
    );
    expect(pdfFigureMarkersIn(root).map((m) => m.page)).toEqual([3, 4]);
  });

  it("ignores a forged or malformed value rather than carrying it", () => {
    /* A web article cannot hold a figure of ours: the ref folds in a raw PDF's
       sha256, so there is no manifest entry a forgery could match, and stage 2
       scrubs every arriving copy anyway. This is the belt to that braces — a
       value nothing can explain is one nothing should index by. */
    const root = host(
      `<figure data-spya-pdf-figure="page:3"><figcaption>x</figcaption></figure>` +
        `<figure data-spya-pdf-figure=""><figcaption>y</figcaption></figure>`,
    );
    expect(pdfFigureMarkersIn(root)).toEqual([]);
  });

  it("refuses both elements when one ref is carried twice", () => {
    /* **It kept the first until 2026-09-06**, and that is what makes this a
       decision rather than a tidy-up: the manifest is keyed by ref, so the one
       entry would have been looked up by both `<figure>`s and the same picture
       would have appeared under two different captions — a fabricated claim
       about the paper that the reader cannot detect. Refusing both leaves two
       captions with no picture, which is visible. GPT Sol, C-5. */
    const root = host(
      `<figure data-spya-pdf-figure="${REF}.3.1"><figcaption>a</figcaption></figure>` +
        `<figure data-spya-pdf-figure="${REF}.3.1"><figcaption>b</figcaption></figure>`,
    );
    expect(pdfFigureMarkersIn(root)).toEqual([]);
  });

  it("keeps the innocent markers around a repeated one", () => {
    /* The refusal is per ref, not per document: a renderer bug on one figure
       must not cost the reader the other seven. */
    const root = host(
      `<figure data-spya-pdf-figure="${REF}.3.1"><figcaption>a</figcaption></figure>` +
        `<figure data-spya-pdf-figure="${REF}.3.1"><figcaption>b</figcaption></figure>` +
        `<figure data-spya-pdf-figure="${REF}.4.1"><figcaption>c</figcaption></figure>`,
    );
    expect(pdfFigureMarkersIn(root).map((m) => m.page)).toEqual([4]);
  });
});
