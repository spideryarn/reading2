/**
 * Stage C's impure half — src/collect-pdf-figures.ts, the sequence and the
 * bookkeeping between the rules, the PDF and the bucket.
 *
 * **The one invariant worth a whole file: every marker gets an entry.** A
 * marker in the blocks and no entry in the manifest is indistinguishable from a
 * figure the reader was never promised, and nothing downstream can tell them
 * apart — the same distinction `AssetFailure`'s `out-of-time` exists to keep in
 * src/assets.ts. GPT Sol, D4-3. So every path through this module is asked the
 * same question, and it is asked as a *count* rather than by looking for the
 * entry the test happens to expect.
 *
 * The rules themselves live in tests/pdf-figures.test.ts, adversarially, on
 * bytes; what pdf.js actually hands back lives in tests/pdf-figure-read.test.ts
 * against the committed fixtures. This file uses one real document — the
 * ball-lightning paper, four figures and a masthead — for the joined-up case,
 * and hand-built markers for the bookkeeping, because a bucket outage and a
 * hundred-figure article are not things a fixture can be.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import {
  collectPdfFigures,
  MAX_ARTICLE_FIGURE_BYTES,
  MAX_FIGURE_BYTES,
  MAX_FIGURES,
} from "../src/collect-pdf-figures.js";
import { sniffImage, type Assets } from "../src/assets.js";
import type { Block } from "../src/types.js";
import { MAX_FIGURE_EDGE } from "../src/pdf-figures.js";
import { RawDocumentUnavailable } from "../src/fetch.js";
import { recoverPdfFigures, STEPS } from "../src/pipeline.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import type { BlobHead, PutResult, RawSourceStore } from "../src/store/blobs.js";

const HARDER = "evals/pdf/harder/source.pdf";

async function bytes(file: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(file));
}

/**
 * A marker for a page, with a well-formed but arbitrary ref.
 *
 * Arbitrary is correct: nothing in this module re-mints a ref or checks one
 * against the document. The ref is minted once by `renderHtml` and is opaque
 * from here on, which is exactly the property that makes a carried-forward
 * manifest fail closed rather than match wrongly.
 */
function marker(page: number, ordinal = 1) {
  const ref = `pdffig1-${String(page).padStart(2, "0")}${String(ordinal).padStart(2, "0")}${"0".repeat(28)}`;
  return { ref: `${ref}.${page}.${ordinal}`, page, ordinal };
}

/** A bucket in a Map. Create-only, exactly like the real one. */
function fakeBlobs(): RawSourceStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async head(key): Promise<BlobHead | null> {
      const there = objects.get(key);
      return there ? { bytes: there.byteLength, contentType: null } : null;
    },
    async get(key): Promise<Uint8Array | null> {
      return objects.get(key) ?? null;
    },
    async putIfAbsent(key, value): Promise<PutResult> {
      if (objects.has(key)) return "already-there";
      objects.set(key, value);
      return "stored";
    },
    async remove(key): Promise<void> {
      objects.delete(key);
    },
  };
}

describe("a real paper with four figures and a masthead", () => {
  it("recovers the figure on a page that has exactly one of each", async () => {
    const run = await collectPdfFigures({
      markers: [marker(3)],
      pdf: await bytes(HARDER),
      blobs: fakeBlobs(),
    });
    expect(run.entries).toHaveLength(1);
    const entry = run.entries[0]!;
    expect(entry.status).toBe("stored");
    if (entry.status !== "stored") return;
    /* 2067 × 1741 is the raster pdf.js decodes — pinned in
       tests/pdf-figure-read.test.ts against the same fixture, so a
       disagreement between the two files is a disagreement about the same
       document. What lands in the manifest is what a reader is *served*, and
       that is the halved copy: `downscaleRaster` takes an exact factor of two
       to bring 2067 inside `MAX_FIGURE_EDGE`. */
    expect([entry.width, entry.height]).toEqual([1034, 871]);
    expect(entry.ext).toBe("png");
    expect(entry.contentType).toBe("image/png");
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(run.stored).toBe(1);
    /* **The measurement the downscale exists for, pinned so it cannot quietly
       stop being true.** This figure is photographic RGB and encoded to
       9,355,050 bytes at full resolution — the number that forced the byte cap
       up to 16 MiB and left a reader fetching 9 MB for one picture. Halved, it
       is 2,349,789 bytes (run 2026-09-06 against this fixture).

       A range rather than the exact count, because what is load-bearing is
       that it is *well under* the 4 MiB the plan originally proposed, not what
       zlib settled on today. The lower bound is there so that a downscale
       which quietly stopped producing a picture — an all-zero raster deflates
       to almost nothing — is a red test rather than a small number that looks
       like a win. src/pdf-figures.ts § `MAX_FIGURE_EDGE`. */
    expect(entry.bytes).toBeGreaterThan(1024 * 1024);
    expect(entry.bytes).toBeLessThan(3 * 1024 * 1024);
  }, 60_000);

  it("puts real PNG bytes in the bucket, under a name that is their own hash", async () => {
    /* The manifest's claim, checked against the object rather than against
       itself: `sniffImage` on what actually landed, and the canonical name it
       landed under. A manifest that says `png` over bytes that are not one is
       the failure content addressing exists to make impossible. */
    const blobs = fakeBlobs();
    const run = await collectPdfFigures({ markers: [marker(6)], pdf: await bytes(HARDER), blobs });
    const entry = run.entries[0]!;
    expect(entry.status).toBe("stored");
    if (entry.status !== "stored") return;
    expect(blobs.objects.size).toBe(1);
    const [key, stored] = [...blobs.objects.entries()][0]!;
    expect(key).toContain(entry.sha256);
    expect(sniffImage(stored)?.ext).toBe("png");
    expect(stored.byteLength).toBe(entry.bytes);
  }, 60_000);

  it("refuses a page whose only picture the caption did not come with", async () => {
    /* Page 2 of the ball-lightning paper paints nothing. A caption there is a
       figure this route cannot reach — a vector drawing, or a bitmap the cap
       removed, and the two are indistinguishable by design (see
       src/pdf-figure-read.ts § 1), which is why the reason is `no-raster` and
       not "this figure is vector art". */
    const run = await collectPdfFigures({
      markers: [marker(2)],
      pdf: await bytes(HARDER),
      blobs: fakeBlobs(),
    });
    expect(run.entries).toEqual([
      expect.objectContaining({ status: "failed", reason: "no-raster", page: 2 }),
    ]);
  }, 60_000);

  it("refuses both captions on a page rather than choosing between them", async () => {
    /* Fable's call, and the reason it is not close: a picture under the wrong
       caption is a fabricated claim about the paper with the app's authority
       behind it, and the reader cannot detect it. A missing figure is visible.
       Both markers are refused and both are recorded. */
    const run = await collectPdfFigures({
      markers: [marker(3, 1), marker(3, 2)],
      pdf: await bytes(HARDER),
      blobs: fakeBlobs(),
    });
    expect(run.entries).toHaveLength(2);
    expect(run.entries.every((e) => e.status === "failed" && e.reason === "ambiguous")).toBe(true);
    expect(run.stored).toBe(0);
  }, 60_000);

  it("never opens the document when there is nothing to open it for", async () => {
    /* Three of the seven eval PDFs have no raster anywhere and every web
       article has no PDF at all, so the ordinary case has to cost nothing. The
       bytes here are not a PDF: reaching pdf.js with them would throw or
       report a failure, and a run of zero entries is the proof it did not. */
    const run = await collectPdfFigures({
      markers: [],
      pdf: new TextEncoder().encode("not a PDF at all"),
      blobs: fakeBlobs(),
    });
    expect(run.entries).toEqual([]);
    expect(run.failed).toBe(0);
  });
});

describe("every marker gets an entry, whatever went wrong", () => {
  it("records one per marker when the document will not open at all", async () => {
    /* A PDF that cannot be reopened is a fault about the document rather than
       about any figure, and it must not take the step down: the article's web
       images are the other half of it.

       **`unreadable-pdf`, and it was `out-of-time` until 2026-09-06.** The bytes
       reached us and were verified against the hash the manifest names; saying
       the clock beat us erases exactly what that verification established, and
       sends whoever reads the manifest looking for a slow pipeline instead of a
       broken document. GPT Sol, C-4. Not `no-raster` either, which would claim
       we looked inside. */
    const markers = [marker(1), marker(2), marker(3)];
    const run = await collectPdfFigures({
      markers,
      pdf: new TextEncoder().encode("%PDF-1.4 but not really"),
      blobs: fakeBlobs(),
    });
    expect(run.entries).toHaveLength(markers.length);
    expect(run.entries.map((e) => e.ref)).toEqual(markers.map((m) => m.ref));
    expect(run.entries.every((e) => e.status === "failed" && e.reason === "unreadable-pdf")).toBe(
      true,
    );
  }, 60_000);

  it("records the markers past the runaway guard rather than dropping them", async () => {
    /* "No entry" has to go on meaning "this step never looked at it" for every
       marker the article has — the same choice `MAX_IMAGES` overflow makes in
       src/collect-assets.ts, and now with the same word for it: `budget` is
       *this document is enormous*, which has a different fix from *the pipeline
       is running slow today*. GPT Sol, C-4. */
    const markers = Array.from({ length: 5 }, (_, i) => marker(i + 1));
    const run = await collectPdfFigures({
      markers,
      pdf: await bytes(HARDER),
      blobs: fakeBlobs(),
      maxFigures: 2,
    });
    expect(run.entries).toHaveLength(5);
    expect(run.entries.map((e) => e.ref).sort()).toEqual(markers.map((m) => m.ref).sort());
    expect(run.entries.slice(2).every((e) => e.status === "failed" && e.reason === "budget")).toBe(
      true,
    );
    expect(MAX_FIGURES).toBeGreaterThan(5);
  }, 60_000);

  it("records a bucket that refuses the bytes, and carries on", async () => {
    const blobs = fakeBlobs();
    blobs.putIfAbsent = async () => {
      throw new Error("Storage put failed (503)");
    };
    const run = await collectPdfFigures({
      markers: [marker(3), marker(6)],
      pdf: await bytes(HARDER),
      blobs,
    });
    expect(run.entries).toHaveLength(2);
    expect(run.entries.every((e) => e.status === "failed" && e.reason === "storage")).toBe(true);
    /* Handed back for the step to log, redacted and bounded — this module does
       not log, because it is not in src/log.ts's component list. */
    expect(run.storageErrors[0]).toContain("503");
  }, 60_000);

  it("records a figure too big to deliver rather than storing it", async () => {
    const run = await collectPdfFigures({
      markers: [marker(3)],
      pdf: await bytes(HARDER),
      blobs: fakeBlobs(),
      maxBytes: 1024,
    });
    expect(run.entries).toEqual([
      expect.objectContaining({ status: "failed", reason: "too-many-pixels" }),
    ]);
    expect(run.stored).toBe(0);
    /* And the shipping cap is a backstop rather than the control: the largest
       PNG this module can now produce is a 1600 × 1600 RGBA raster, whose
       filter-0 scanlines are 10,241,600 bytes before deflate — which cannot
       expand them by more than a fraction of a percent. Asserted rather than
       described so that lowering the cap under that ceiling, and reinstating
       the silent refusal a 4 MiB cap caused once already, is a red test.
       src/collect-pdf-figures.ts § `MAX_FIGURE_BYTES`. */
    expect(MAX_FIGURE_BYTES).toBeGreaterThan(MAX_FIGURE_EDGE * (1 + MAX_FIGURE_EDGE * 4));
  }, 60_000);

  it("records every marker when the step is aborted, and stores nothing after", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const markers = [marker(3), marker(6)];
    const run = await collectPdfFigures({
      markers,
      pdf: await bytes(HARDER),
      blobs: fakeBlobs(),
      signal: aborted.signal,
    });
    expect(run.entries).toHaveLength(markers.length);
    expect(run.stored).toBe(0);
    expect(run.entries.every((e) => e.status === "failed")).toBe(true);
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 * The wall clock
 * ------------------------------------------------------------------ */

describe("the step's own deadline", () => {
  /**
   * **The test the two abort tests above could not be.**
   *
   * One of them starts already aborted and the other rejects immediately, so
   * both stayed green while a hang in the bucket meant `collectPdfFigures` never
   * returned at all — no entries finalised, no manifest written, and the whole
   * *every marker gets an entry* invariant failing by never finishing. Aborting
   * the job changed nothing, because neither `encodeFigurePng` nor
   * `storeRawSource` takes a signal. GPT Sol, C-1.
   *
   * So the fixture is the one that would have caught it: a bucket that accepts
   * the call and never answers. The fix is the shape src/collect-assets.ts
   * already uses — race the whole run against the clock, then write an entry for
   * every marker the race left behind — because racing is the only thing that
   * bounds a step whose storage layer takes no signal.
   */
  it("hands back a complete manifest when the bucket never answers", async () => {
    const blobs = fakeBlobs();
    blobs.putIfAbsent = () => new Promise<PutResult>(() => {});
    const markers = [marker(3), marker(6)];
    const run = await collectPdfFigures({
      markers,
      pdf: await bytes(HARDER),
      blobs,
      budgetMs: 4_000,
    });
    expect(run.entries).toHaveLength(markers.length);
    expect(run.entries.map((e) => e.ref)).toEqual(markers.map((m) => m.ref));
    expect(run.entries.every((e) => e.status === "failed" && e.reason === "out-of-time")).toBe(true);
    expect(run.stored).toBe(0);
  }, 30_000);

  it("stores nothing once its clock has run out", async () => {
    /* The other half of C-1: an abort during the encode could still store that
       figure afterwards, because nothing between the deflate and the `put`
       looked at the signal. A `budgetMs` of one millisecond fires before the
       document is even open, and the bucket has to be empty a second later —
       *after* whatever was in flight has had time to finish and try. */
    const blobs = fakeBlobs();
    const run = await collectPdfFigures({
      markers: [marker(3)],
      pdf: await bytes(HARDER),
      blobs,
      budgetMs: 1,
    });
    expect(run.entries).toHaveLength(1);
    expect(run.stored).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(blobs.objects.size).toBe(0);
  }, 30_000);

  /**
   * **The snapshot was one field short of complete.** GPT Sol, D-4, 2026-09-06.
   *
   * `entries` is built synchronously after the race and the counters are copied
   * by value, so both were already safe. `storageErrors` was handed out **by
   * reference** — and `storeOne`'s `catch` pushes into it, so a `put` that
   * rejected after the race had been won reached into an array the caller was
   * already holding, minutes after the run it describes had returned. Nothing
   * throws and nothing is logged: a manifest simply grows a complaint about a
   * figure it had already finalised as `out-of-time`.
   *
   * The fixture is deterministic rather than timed: the fake bucket takes the
   * run away from underneath itself the instant the `put` is reached, so this
   * cannot flake on a busy box the way a `budgetMs` chosen to land inside an
   * encode would.
   */
  it("hands back a storage-error list that a straggler cannot grow", async () => {
    const blobs = fakeBlobs();
    const stop = new AbortController();
    const put: { reject: ((err: Error) => void) | null } = { reject: null };
    blobs.putIfAbsent = () =>
      new Promise<PutResult>((_, reject) => {
        put.reject = reject;
        stop.abort();
      });

    const run = await collectPdfFigures({
      markers: [marker(3)],
      pdf: await bytes(HARDER),
      blobs,
      signal: stop.signal,
    });
    expect(put.reject, "the put has to have been reached, or this proves nothing").not.toBeNull();
    expect(run.storageErrors).toEqual([]);

    /* The bucket answers at last, long after anybody stopped waiting. */
    put.reject?.(new Error("Storage put failed (503)"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(run.storageErrors).toEqual([]);
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 * What the whole article may cost
 * ------------------------------------------------------------------ */

describe("the article's shared byte budget", () => {
  it("is small enough to make the runaway guard mean something", () => {
    /* **The arithmetic that made this necessary**: the marker count is capped
       and the per-figure size is capped, and multiplying the two gave one
       document leave to store 100 × 12 MiB. A cap on each part is not a cap on
       the whole. GPT Sol, C-3. */
    expect(MAX_ARTICLE_FIGURE_BYTES).toBeLessThan(MAX_FIGURES * MAX_FIGURE_BYTES);
  });

  it("records the figures it has no room left for, rather than dropping them", async () => {
    /* Measured rather than guessed, in two passes over the same fixture: the
       first learns what page 3 costs, the second gives the article exactly that
       and no more. So the first figure is stored and fills the budget, and the
       second is recorded `budget` — *this article is enormous*, which is a
       different fact with a different fix from `out-of-time`. */
    const generous = await collectPdfFigures({
      markers: [marker(3)],
      pdf: await bytes(HARDER),
      blobs: fakeBlobs(),
    });
    const first = generous.entries[0]!;
    expect(first.status).toBe("stored");
    if (first.status !== "stored") return;

    const blobs = fakeBlobs();
    const run = await collectPdfFigures({
      markers: [marker(3), marker(6)],
      pdf: await bytes(HARDER),
      blobs,
      maxArticleBytes: first.bytes,
    });
    expect(run.entries).toHaveLength(2);
    expect(run.entries[0]!.status).toBe("stored");
    expect(run.entries[1]).toMatchObject({ status: "failed", reason: "budget" });
    expect(run.stored).toBe(1);
    expect(blobs.objects.size).toBe(1);
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 * The pipeline's half — finding the document to look in
 * ------------------------------------------------------------------ */

/** A block carrying one figure marker, as `renderHtml` writes one. */
function figureBlock(ref: string): Block {
  return {
    id: `spya-b${ref.slice(-4)}`,
    tag: "figure",
    kind: "text",
    text: "Fig 1",
    words: 1,
    html: `<figure data-spya-pdf-figure="${ref}"><figcaption>Fig 1</figcaption></figure>`,
    gistable: true,
  };
}

const CTX = {
  slug: "a",
  report: () => {},
  signal: new AbortController().signal,
  cacheArticle: false,
};

describe("recoverPdfFigures", () => {
  const blocks = [figureBlock(marker(3).ref), figureBlock(marker(6).ref)];

  /**
   * **The markers are discovered before the source is**, and the order is the
   * whole finding.
   *
   * `recoverPdfFigures` returned on `manifest?.kind !== "pdf"` *before* it had
   * looked for a marker, so an inconsistent revision — valid markers, a raw
   * manifest that is missing or says HTML — produced no `pdfFigures` at all.
   * That is indistinguishable from *there was nothing here to look at*, which is
   * the one distinction this whole feature's manifest exists to keep. GPT Sol,
   * C-2.
   */
  it("records every marker when there is no raw manifest at all", async () => {
    const store = memoryArtefacts();
    const run = await recoverPdfFigures(CTX, store, blocks);
    expect(run?.entries).toHaveLength(2);
    expect(run?.entries.every((e) => e.status === "failed" && e.reason === "no-source")).toBe(true);
  });

  it("records every marker when the article did not come from a PDF", async () => {
    const store = memoryArtefacts();
    store.plant("a", "fetch", "raw", { file: "raw.html", kind: "html" });
    const run = await recoverPdfFigures(CTX, store, blocks);
    expect(run?.entries).toHaveLength(2);
    expect(run?.entries.every((e) => e.status === "failed" && e.reason === "no-source")).toBe(true);
  });

  it("still costs nothing on an article that has no markers", async () => {
    /* `undefined`, not an empty run: *there was nothing here to look at* has to
       stay distinguishable from *we looked and could not*. src/assets.ts. */
    const store = memoryArtefacts();
    expect(await recoverPdfFigures(CTX, store, [])).toBeUndefined();
  });

  /**
   * **A missing object and a bucket that is down need different people**, which
   * is the distinction `AssetFailure` already keeps between `storage` and
   * `network` and the one this catch erased: every `readRawBytes` failure was
   * recorded `out-of-time`, with nothing logged. GPT Sol, C-4.
   */
  it("tells a document that is not there from a bucket that will not answer", async () => {
    const store = memoryArtefacts();
    store.plant("a", "fetch", "raw", { file: "raw.pdf", kind: "pdf", storedSha256: "f".repeat(64) });

    const gone = await recoverPdfFigures(CTX, store, blocks, {
      readBytes: () => {
        throw new RawDocumentUnavailable("missing", "the object is not there");
      },
    });
    expect(gone?.entries.every((e) => e.status === "failed" && e.reason === "no-source")).toBe(true);

    const down = await recoverPdfFigures(CTX, store, blocks, {
      readBytes: () => {
        throw new Error("Storage get failed (503): upstream connect error");
      },
    });
    expect(down?.entries.every((e) => e.status === "failed" && e.reason === "storage")).toBe(true);
  });

  it("puts the failed figures on the manifest the step writes", async () => {
    /* End to end through the step, because the two halves are spread onto one
       `Assets` and a run that recorded everything correctly and handed it to
       nobody would look exactly like this feature working. */
    const store = memoryArtefacts();
    store.plant("a", "hierarchy", "blocks", { blocks });
    const out = await STEPS.assets.run(CTX, store, nullCheckpointStore());
    const assets = out.parts?.assets as Assets;
    expect(assets.entries).toEqual([]);
    expect(assets.pdfFigures).toHaveLength(2);
    expect(assets.pdfFigures?.every((e) => e.status === "failed")).toBe(true);
  });
});
