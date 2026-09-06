/**
 * Stage B — src/pdf-figure-read.ts, the half that opens a real PDF.
 *
 * **These are integration tests against the committed fixtures**, deliberately,
 * because the thing stage B can get wrong is not a rule — src/pdf-figures.ts
 * owns the rules and tests/pdf-figures.test.ts is adversarial about them on
 * bytes. What stage B can get wrong is *what pdf.js actually hands back*: which
 * operator, which object store, which page, what the cap silently removes, and
 * whether a page with no text layer costs us two megabytes of decode. None of
 * that can be mocked into existence.
 *
 * The numbers below were measured against these four files on 2026-09-06 and
 * are pinned rather than described, so a pdf.js upgrade that changes an object
 * key or a decoded kind goes red here rather than in production.
 *
 * Whole file: about 7 s on the shared box, and most of it is the 11.5 MB
 * ball-lightning paper and its 49 megapixels of decode.
 *
 * The last block mocks pdf.js instead, for the things no fixture in the repo
 * exercises: the teardown order, the ordering that makes a scanned page cheap,
 * an object that never resolves, an inline image and the repeat operator.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { readPdfRasters } from "../src/pdf-figure-read.js";
import { classifyRaster, encodeFigurePng } from "../src/pdf-figures.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const EASY = "evals/pdf/easy/source.pdf";
const HARDER = "evals/pdf/harder/source.pdf";
const SCAN = "evals/pdf/much-harder/source.pdf";
const KUHN = "evals/pdf/titles/kuhn-landscape-of-consciousness/source.pdf";

/**
 * sha256 of the decoded RGB bytes of the ball-lightning paper's page-3 figure —
 * 2067 × 1741 × 3 = 10,795,941 bytes, the largest raster in the corpus.
 *
 * Taken from a run against the committed fixture, 2026-09-06. It is the one
 * assertion here about the *pixels* rather than about their shape; see the test
 * that uses it.
 */
const FIGURE_P3_SHA256 = "c37eaea051ed2eea7904724edee3ad366b89b2c7faddc2bd7ef456e2443a4081";

async function bytes(file: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(file));
}

/** `page:key widthxheight kind`, which is the whole of what a candidate claims. */
function shape(c: { page: number; key: string; width: number; height: number; kind: number }) {
  return `${c.page}:${c.key} ${c.width}x${c.height} k${c.kind}`;
}

describe("a document with no raster image anywhere", () => {
  it("yields nothing from all eight pages, and reports neither a skip nor an unread op", async () => {
    // evals/pdf/easy is 8 pages of prose and 0 image operators. Whatever this
    // feature costs, it has to cost nothing here — three of the seven eval PDFs
    // contain no bitmap at all.
    const out = await readPdfRasters({ data: await bytes(EASY), pages: [1, 2, 3, 4, 5, 6, 7, 8] });
    expect(out.candidates).toEqual([]);
    expect(out.skippedPages).toEqual([]);
    expect(out.unread).toEqual([]);
  });

  it("never opens the document at all when no page is asked for", async () => {
    // Not a micro-optimisation: the assets step will call this for every PDF
    // article, and most have no figure markers. The proof is that five bytes
    // which are not a PDF do not make it throw — nothing parsed them.
    const out = await readPdfRasters({ data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), pages: [] });
    expect(out).toEqual({ candidates: [], skippedPages: [], unread: [] });
  });
});

describe("Kuhn's first page, where a compression rule went wrong", () => {
  it("hands back all three images, the 119x119 logo included, and all three are usable", async () => {
    // The 119x119 sits at 0.0165 deflated bytes per pixel — *below* the band the
    // eight known-blank overlays occupy — while carrying 58 colours. The rule
    // that measured compression called it blank. Nothing in stage B measures
    // compression, and `classifyRaster` calls it usable because 100% of its
    // pixels are opaque. Pinned so the wrong rule cannot come back quietly.
    const out = await readPdfRasters({ data: await bytes(KUHN), pages: [1, 2, 3] });
    expect(out.candidates.map(shape)).toEqual([
      "1:img_p0_1 119x119 k2",
      "1:img_p0_2 248x271 k2",
      "1:img_p0_3 236x298 k2",
    ]);
    expect(out.candidates.map((c) => classifyRaster(c).status)).toEqual([
      "usable",
      "usable",
      "usable",
    ]);
    // Pages 2 and 3 are prose: looked at, nothing found, nothing skipped.
    expect(out.skippedPages).toEqual([]);
    expect(out.unread).toEqual([]);
  });
});

describe("the ball-lightning paper", () => {
  it("finds its five images on pages 1, 3, 6, 7 and 11, at the recorded sizes", async () => {
    const out = await readPdfRasters({
      data: await bytes(HARDER),
      pages: Array.from({ length: 14 }, (_, i) => i + 1),
    });
    expect(out.candidates.map(shape)).toEqual([
      // p1 is the journal's masthead, and it is a perfectly real image. Nothing
      // here excludes it: page 1 gets `publisher`/`cover` records rather than a
      // `figure` one, so src/pdf-figures.ts leaves it unclaimed. The gate does
      // this filtering, not a threshold.
      "1:img_p0_1 200x70 k2",
      "3:img_p2_1 2067x1741 k2",
      "6:img_p5_1 2067x1225 k2",
      "7:img_p6_1 2067x3329 k2",
      "11:img_p10_1 2067x1523 k2",
    ]);
    expect(out.skippedPages).toEqual([]);
    expect(out.unread).toEqual([]);
  }, 60_000);

  it("hands back exactly width x height x 3 bytes for every one of them", async () => {
    // The candidate's dimensions are a *claim* until `classifyRaster` checks
    // them; this is the check that the claim matches the buffer on a real
    // document, which is what `byte-count-mismatch` exists to catch.
    const out = await readPdfRasters({ data: await bytes(HARDER), pages: [3, 6, 7, 11] });
    for (const c of out.candidates) expect(c.data.length).toBe(c.width * c.height * 3);
    expect(out.candidates.every((c) => classifyRaster(c).status === "usable")).toBe(true);
  }, 60_000);

  it("leaves the caller's own bytes alone", async () => {
    // pdf.js takes ownership of the array it is given and transfers the buffer
    // to its worker, leaving the caller holding a detached one. The assets step
    // has just hashed those bytes and wants them again, so this copies — the
    // same trap, and the same fix, as `pass0` in src/pdf.ts.
    const data = await bytes(EASY);
    const length = data.length;
    await readPdfRasters({ data, pages: [1] });
    expect(data.length).toBe(length);
    expect(data.byteLength).toBeGreaterThan(0);
  });
});

describe("the photographic scan", () => {
  it("takes nothing from any of its sixteen scanned pages", async () => {
    // 17 pages, 17 full-page images, every one opaque and 'real' by every rule
    // in src/pdf-figures.ts. Attach one to a caption and the whole page of the
    // book gets stapled under it. The exclusion is the text layer: a page with
    // fewer than SCAN_WORDS_PER_PAGE words is a photograph of a page.
    const out = await readPdfRasters({
      data: await bytes(SCAN),
      pages: Array.from({ length: 17 }, (_, i) => i + 1),
    });
    expect(out.skippedPages).toEqual(
      Array.from({ length: 16 }, (_, i) => ({ page: i + 2, reason: "scanned" })),
    );
    // Not one 661x1024 page-photograph ever became a candidate.
    expect(out.candidates.filter((c) => c.height === 1024)).toEqual([]);
  }, 60_000);

  it("still returns page 1's logo, because page 1 is not a scanned page", async () => {
    // **This disagrees with the plan, and the plan is wrong.** It says the
    // Wellcome file is "one full-page scan image per page, every one 661x1024",
    // and concludes stage B yields nothing from it. Measured here: page 1 is
    // Wellcome's own generated rights page, 95 words — five times the
    // threshold — carrying a 500x164 RGBA logo that is 58% opaque. The scan
    // rule excludes sixteen of the seventeen pages, not all of them.
    //
    // It reaches no reader: page 1 of a scan gets `cover`/`publisher` records
    // and never a `figure` one, so nothing asks for it, and an unclaimed raster
    // is dropped by the gate in src/pdf-figures.ts. Recorded rather than
    // rounded off, because "every page is a scan" is the kind of near-miss that
    // becomes an assumption somewhere else later.
    const out = await readPdfRasters({ data: await bytes(SCAN), pages: [1] });
    expect(out.candidates.map(shape)).toEqual(["1:img_p0_1 500x164 k3"]);
    expect(out.skippedPages).toEqual([]);
  });

  it("reads its sixteen scanned pages in well under a second", async () => {
    // Sixteen full-page images at about 2 MB decoded each, and this is measured
    // at ~85 ms, because `getOperatorList` — which is what decodes them — is
    // never called on a scanned page. A *bound*, not the proof: reversing the
    // two calls costs about 2 s here, which is two orders of magnitude and
    // still inside any threshold this shared box could carry safely. The proof
    // that the order is the way round it claims to be is the mocked test at the
    // bottom of this file, which asserts `getOperatorList` is never called.
    const data = await bytes(SCAN);
    const started = Date.now();
    const out = await readPdfRasters({ data, pages: Array.from({ length: 16 }, (_, i) => i + 2) });
    expect(out.candidates).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("the decode cap, and what it hides", () => {
  it("removes an oversized image from the operator list entirely, saying nothing", async () => {
    // The trap, pinned. `maxImageSize` reaches pdf.js itself and is checked
    // against the image dictionary's /Width and /Height before any decoding —
    // which is the point, since building the operator list is what decodes. But
    // pdf.js's `ignoreErrors` defaults on, so the refused image is warned about
    // on the console and **dropped from the operator list**: page 3 then looks
    // exactly like a page that never had a bitmap.
    //
    // So `unread` stays empty here. We cannot record what we were never told
    // about, and the manifest's reason has to be honest about the ambiguity —
    // "nothing recoverable here", never "this figure is vector art".
    const out = await readPdfRasters({
      data: await bytes(HARDER),
      pages: [1, 3],
      maxImagePixels: 1_000_000,
    });
    expect(out.candidates.map(shape)).toEqual(["1:img_p0_1 200x70 k2"]);
    expect(out.unread).toEqual([]);
    expect(out.skippedPages).toEqual([]);
  }, 60_000);
});

describe("an abort that used to look like a scanned page", () => {
  it("rejects rather than returning a page it never managed to read", async () => {
    /* **The bug this is written after, and it is worth understanding rather
       than just pinning.** Aborting mid-page destroys the worker; pdf.js then
       answers the `getTextContent()` already in flight with an *empty result*
       instead of an error. An empty text layer is precisely what a photograph
       of a page looks like, so the scan rule agreed with it, recorded page 7 as
       `"scanned"`, and `readPdfRasters` **returned successfully** — no throw, no
       warning, a real figure simply absent from a document that has one.

       GPT Sol found it reviewing stage B and reproduced it five times against
       this fixture, aborting between 0 and 100 ms:

           {"candidates":[],"skippedPages":[{"page":7,"reason":"scanned"}],"unread":[]}

       Two rules agreeing with each other, neither able to tell a destroyed
       worker from a blank page — docs/reusable/silent-success.md, and the
       reason the fix is a check at the return rather than a nicer error inside
       the page read.

       **Driven by the fake rather than by a timer against a real PDF**, and
       that is not a shortcut — it is the difference between a test and a
       coincidence. The first version of this test aborted a real read of page 7
       after 40 ms and passed *with the fix removed*: loading pdf.js takes
       1.5–1.8 s on the first document a process sees, so the abort was landing
       inside `loadPdfjs` and being caught by the check that already existed,
       and the test never once reached the code it was written for. Timing the
       abort to land inside the page read means guessing at a decode's duration
       on a shared box.

       The fake aborts from *inside* `getTextContent` and then answers it with
       an empty text layer, which is exactly the sequence pdf.js produces when
       its worker is destroyed under an in-flight call. Deterministic, and it
       fails without the fix. */
    const controller = new AbortController();
    const { fresh } = await withFakePdfjs({ abortDuringText: controller });
    await expect(
      fresh({ data: new Uint8Array([1, 2, 3]), pages: [1], signal: controller.signal }),
    ).rejects.toThrow();
  });

  it("rejects when the signal is already aborted, without opening anything", async () => {
    await expect(
      readPdfRasters({
        data: await bytes(HARDER),
        pages: [7],
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
  }, 60_000);
});

describe("the bytes outlive the document", () => {
  it("encodes a PNG from a raster after the pdf.js document has been destroyed", async () => {
    // `RasterCandidate.data` is pdf.js's own buffer rather than a copy, and this
    // function tears the document down in a `finally` before it returns. So the
    // property everything downstream depends on is that `cleanup()` and
    // `destroy()` empty the object *maps* without touching an array we still
    // hold. Asserted rather than assumed: a detached or zeroed buffer would
    // encode to a valid PNG of the right size and be entirely black.
    const out = await readPdfRasters({ data: await bytes(KUHN), pages: [1] });
    const first = out.candidates[0];
    expect(first).toBeDefined();
    const verdict = classifyRaster(first!);
    expect(verdict.status).toBe("usable");
    if (verdict.status !== "usable") return;

    const png = await encodeFigurePng(verdict.raster);
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBe(119);
    expect(new DataView(png.buffer, png.byteOffset).getUint32(20)).toBe(119);
    // Kuhn's logo is 69.7% ink. All-zero bytes would mean a buffer we lost.
    expect(verdict.raster.data.some((b) => b !== 0)).toBe(true);
  });

  it("hands back the very pixels the document holds, not merely a buffer of the right size", async () => {
    /* **Every other fixture assertion in this file pins metadata.** Page, key,
       width, height, kind, byte count — and `classifyRaster` on an RGB raster
       establishes only that the shape is coherent. GPT Sol B-4: arbitrary
       same-length non-zero bytes would satisfy the lot of them, so nothing here
       yet says the pixels are *this figure's* pixels rather than some other
       page's, or a buffer pdf.js reused under us.

       A digest of one substantial real figure closes that, and the ball
       lightning paper's page 3 is the one to use: 2067 × 1741, the largest in
       the corpus, and the fixture is committed so the bytes cannot drift. If
       this ever goes red without the fixture changing, the decode is returning
       something other than what the file contains — which is worth far more
       than a dimension check. */
    const out = await readPdfRasters({ data: await bytes(HARDER), pages: [3] });
    const first = out.candidates[0];
    expect(first).toBeDefined();
    expect([first!.width, first!.height, first!.kind]).toEqual([2067, 1741, 2]);
    const digest = createHash("sha256").update(first!.data).digest("hex");
    expect(digest).toBe(FIGURE_P3_SHA256);
  });
});

/* ------------------------------------------------------------------ *
 * What no fixture in the repo can show us
 * ------------------------------------------------------------------ */

/** The fake module's operator numbers — pdf.js's own, as it happens. */
const OPS_PAINT = 85;
const OPS_INLINE = 86;
const OPS_REPEAT = 88;

/**
 * A pdf.js stand-in, loaded in place of the real one for the block below.
 *
 * `vi.doMock` rather than `vi.mock` on purpose: `vi.mock` is hoisted to the top
 * of the file and would replace pdf.js for the integration tests above, which
 * are the point of this file. This is scoped to a fresh module graph instead.
 */
async function withFakePdfjs(fake: {
  numPages?: number;
  words?: string;
  ops?: { fn: number; args: unknown[] }[];
  objects?: Record<string, unknown>;
  /** Keys the store registers a callback for and never calls back. */
  neverResolve?: string[];
  throwOnGetPage?: boolean;
  /** `cleanup()` rejects — the case that decides whether `destroy()` still runs. */
  failCleanup?: boolean;
  /**
   * Abort this the moment `getTextContent()` is called, and then answer it with
   * an empty text layer — which is what pdf.js really does once its worker has
   * been destroyed under an in-flight call. See the abort test.
   */
  abortDuringText?: AbortController;
}) {
  const OPS = {
    paintImageXObject: OPS_PAINT,
    paintInlineImageXObject: OPS_INLINE,
    paintImageXObjectRepeat: OPS_REPEAT,
  };
  const calls: string[] = [];
  const store = {
    get(objId: string, callback?: (value: unknown) => void) {
      if (fake.neverResolve?.includes(objId)) return undefined;
      callback?.(fake.objects?.[objId]);
      return undefined;
    },
    has: () => true,
  };
  const getOperatorList = vi.fn(async () => ({
    fnArray: (fake.ops ?? []).map((o) => o.fn),
    argsArray: (fake.ops ?? []).map((o) => o.args),
  }));
  const page = {
    objs: store,
    commonObjs: store,
    getTextContent: async () => {
      if (fake.abortDuringText) {
        fake.abortDuringText.abort();
        /* Empty, exactly as pdf.js answers a call whose worker has just been
           destroyed — no error, no items. That is the whole bug. */
        return { items: [] as { str: string }[] };
      }
      return {
        items: (fake.words ?? Array(30).fill("word").join(" ")).split(" ").map((str) => ({ str })),
      };
    },
    getOperatorList,
  };
  vi.resetModules();
  vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
    OPS,
    getDocument: () => ({
      destroy: async () => {
        calls.push("destroy");
      },
      promise: Promise.resolve({
        numPages: fake.numPages ?? 1,
        getPage: async () => {
          if (fake.throwOnGetPage) throw new Error("pdf.js fell over on this page");
          return page;
        },
        cleanup: async () => {
          calls.push("cleanup");
          if (fake.failCleanup) throw new Error("pdf.js could not release the page resources");
        },
      }),
    }),
  }));
  const { readPdfRasters: fresh } = await import("../src/pdf-figure-read.js");
  return { fresh, calls, getOperatorList };
}

afterEach(() => {
  /* The fake is scoped to one test. Leaving it installed would hand a later
     test a document with no images in it and a green assertion that proves
     nothing — the shape docs/reusable/silent-success.md is about. */
  vi.doUnmock("pdfjs-dist/legacy/build/pdf.mjs");
  vi.resetModules();
});

describe("teardown", () => {
  it("cleans up and then destroys, exactly once each, on the happy path", async () => {
    // `cleanup` releases page resources; **`destroy` is what stops the worker**.
    // A version of the same code in src/pdf.ts called only the first, for
    // months, and leaked one worker per document — every successful parse, not
    // just the failures. That is the bug this asserts against, and the real
    // fixtures above cannot see it: pdf.js under Node uses a same-thread fake
    // worker, so a leaked one shows up in neither a handle count nor a hang.
    const { fresh, calls } = await withFakePdfjs({
      ops: [{ fn: OPS_PAINT, args: ["img_x"] }],
      objects: { img_x: { width: 2, height: 1, kind: 2, data: new Uint8Array(6) } },
    });
    const out = await fresh({ data: new Uint8Array([1, 2, 3]), pages: [1] });
    expect(out.candidates.map((c) => c.key)).toEqual(["img_x"]);
    expect(calls).toEqual(["cleanup", "destroy"]);
  });

  it("still destroys the worker when cleanup rejects", async () => {
    /* **The test above would stay green with both guards deleted**, because its
       fake `cleanup` always resolves — so a rewrite to two plain sequential
       `await`s would pass it while reintroducing the exact leak the `finally`
       exists to prevent: a rejecting `cleanup` skipping the `destroy` after it,
       and a worker left running for every document that hits it. GPT Sol B-3,
       reviewing stage B. The two calls are guarded separately for this reason,
       and this is the case that says so. */
    const { fresh, calls } = await withFakePdfjs({ failCleanup: true });
    await fresh({ data: new Uint8Array([1, 2, 3]), pages: [1] });
    expect(calls).toEqual(["cleanup", "destroy"]);
  });

  it("cleans up and destroys when reading a page throws", async () => {
    const { fresh, calls } = await withFakePdfjs({ throwOnGetPage: true });
    await expect(fresh({ data: new Uint8Array([1, 2, 3]), pages: [1] })).rejects.toThrow(/fell over/);
    expect(calls).toEqual(["cleanup", "destroy"]);
  });
});

describe("operators and objects a fixture never produces", () => {
  it("gives up on an object that never resolves, and says so rather than hanging", async () => {
    const { fresh } = await withFakePdfjs({
      ops: [{ fn: OPS_PAINT, args: ["img_stuck"] }],
      neverResolve: ["img_stuck"],
    });
    const out = await fresh({
      data: new Uint8Array([1, 2, 3]),
      pages: [1],
      objectTimeoutMs: 20,
    });
    expect(out.candidates).toEqual([]);
    expect(out.unread).toEqual([{ page: 1, key: "img_stuck", reason: "timeout" }]);
  });

  it("records an inline image and a repeat operator as read limits rather than dropping them", async () => {
    // Sol SP-2: handling only `paintImageXObject` misses inline images, the
    // repeat operator and every vector-drawn figure. That is an acceptable v1
    // limit **if it is recorded explicitly** rather than presented as general
    // PDF figure recovery — so they come back in `unread` with their reason.
    const { fresh } = await withFakePdfjs({
      ops: [
        { fn: OPS_INLINE, args: [{}] },
        { fn: OPS_REPEAT, args: ["img_tile", 4] },
      ],
    });
    const out = await fresh({ data: new Uint8Array([1, 2, 3]), pages: [1] });
    expect(out.candidates).toEqual([]);
    expect(out.unread).toEqual([
      { page: 1, key: "inline@0", reason: "inline-image" },
      { page: 1, key: "img_tile", reason: "repeated-image" },
    ]);
  });

  it("records an object that answers with something that is not an image", async () => {
    const { fresh } = await withFakePdfjs({
      ops: [{ fn: OPS_PAINT, args: ["img_odd"] }],
      objects: { img_odd: { width: 2, height: 1, kind: 2 } },
    });
    const out = await fresh({ data: new Uint8Array([1, 2, 3]), pages: [1] });
    expect(out.unread).toEqual([{ page: 1, key: "img_odd", reason: "not-an-image" }]);
  });

  it("names a page the document does not have rather than silently ignoring it", async () => {
    // A page number out of range is a bug in whatever minted the markers, not a
    // fact about the PDF, and the two must not look alike in a manifest.
    const { fresh } = await withFakePdfjs({ numPages: 2 });
    const out = await fresh({ data: new Uint8Array([1, 2, 3]), pages: [0, 3, 1.5] });
    expect(out.skippedPages).toEqual([
      { page: 0, reason: "out-of-range" },
      { page: 1.5, reason: "out-of-range" },
      { page: 3, reason: "out-of-range" },
    ]);
  });

  it("skips a page with a thin text layer without asking for its operator list", async () => {
    // **The assertion that matters is that `getOperatorList` was never called**,
    // and it is the whole cost story: building the operator list is what decodes
    // every image on the page, so a rule that skipped the *candidates* rather
    // than the *call* would return the same empty list having paid two megabytes
    // per page for it. A test that only checked "nothing came back" would pass
    // against that. The same shape as tests/pdf-page-cap.test.ts, and for the
    // same reason.
    //
    // Nineteen words, one under SCAN_WORDS_PER_PAGE.
    const { fresh, getOperatorList } = await withFakePdfjs({
      words: Array(19).fill("word").join(" "),
      ops: [{ fn: OPS_PAINT, args: ["img_page"] }],
      objects: { img_page: { width: 2, height: 1, kind: 2, data: new Uint8Array(6) } },
    });
    const out = await fresh({ data: new Uint8Array([1, 2, 3]), pages: [1] });
    expect(getOperatorList).not.toHaveBeenCalled();
    expect(out.candidates).toEqual([]);
    expect(out.skippedPages).toEqual([{ page: 1, reason: "scanned" }]);
  });

  it("does look at a page one word over the threshold", async () => {
    // The other side of the boundary, so the threshold is pinned rather than
    // merely present: twenty words is SCAN_WORDS_PER_PAGE exactly, and the rule
    // is "fewer than".
    const { fresh, getOperatorList } = await withFakePdfjs({
      words: Array(20).fill("word").join(" "),
      ops: [{ fn: OPS_PAINT, args: ["img_page"] }],
      objects: { img_page: { width: 2, height: 1, kind: 2, data: new Uint8Array(6) } },
    });
    const out = await fresh({ data: new Uint8Array([1, 2, 3]), pages: [1] });
    expect(getOperatorList).toHaveBeenCalledTimes(1);
    expect(out.candidates.map((c) => c.key)).toEqual(["img_page"]);
    expect(out.skippedPages).toEqual([]);
  });

  it("asks for a page once even when two markers name it", async () => {
    const { fresh } = await withFakePdfjs({
      numPages: 3,
      ops: [{ fn: OPS_PAINT, args: ["img_a"] }],
      objects: { img_a: { width: 2, height: 1, kind: 2, data: new Uint8Array(6) } },
    });
    const out = await fresh({ data: new Uint8Array([1, 2, 3]), pages: [2, 2, 2] });
    expect(out.candidates.map((c) => c.page)).toEqual([2]);
  });
});
