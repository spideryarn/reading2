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

import { collectPdfFigures, MAX_FIGURE_BYTES, MAX_FIGURES } from "../src/collect-pdf-figures.js";
import { sniffImage } from "../src/assets.js";
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
    /* 2067 x 1741, the largest raster in the corpus — pinned in
       tests/pdf-figure-read.test.ts against the same fixture, so a disagreement
       between the two files is a disagreement about the same document. */
    expect([entry.width, entry.height]).toEqual([2067, 1741]);
    expect(entry.ext).toBe("png");
    expect(entry.contentType).toBe("image/png");
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(run.stored).toBe(1);
    /* **The measurement that changed the cap, pinned so it cannot quietly stop
       being true.** The plan proposed 4 MiB on the strength of a 756 KB largest
       figure — which is the *Analog Cognition* document's number, not the
       corpus's. This one is photographic RGB and encodes to about 9.4 MB, so a
       4 MiB cap would refuse a real figure in the repo's own fixtures. A range
       rather than an exact byte count: what is load-bearing is that it is over
       4 MiB, not what zlib settled on today. src/collect-pdf-figures.ts §
       `MAX_FIGURE_BYTES`; GPT Sol, SP-3. */
    expect(entry.bytes).toBeGreaterThan(4 * 1024 * 1024);
    expect(entry.bytes).toBeLessThan(16 * 1024 * 1024);
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
       images are the other half of it. `out-of-time` because nothing is known
       about any of these figures — not `no-raster`, which would claim we looked. */
    const markers = [marker(1), marker(2), marker(3)];
    const run = await collectPdfFigures({
      markers,
      pdf: new TextEncoder().encode("%PDF-1.4 but not really"),
      blobs: fakeBlobs(),
    });
    expect(run.entries).toHaveLength(markers.length);
    expect(run.entries.map((e) => e.ref)).toEqual(markers.map((m) => m.ref));
    expect(run.entries.every((e) => e.status === "failed" && e.reason === "out-of-time")).toBe(true);
  }, 60_000);

  it("records the markers past the runaway guard rather than dropping them", async () => {
    /* "No entry" has to go on meaning "this step never looked at it" for every
       marker the article has — the same choice `MAX_IMAGES` overflow makes in
       src/collect-assets.ts. */
    const markers = Array.from({ length: 5 }, (_, i) => marker(i + 1));
    const run = await collectPdfFigures({
      markers,
      pdf: await bytes(HARDER),
      blobs: fakeBlobs(),
      maxFigures: 2,
    });
    expect(run.entries).toHaveLength(5);
    expect(run.entries.map((e) => e.ref).sort()).toEqual(markers.map((m) => m.ref).sort());
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
    /* And the shipping cap is not the 4 MiB the plan proposed — see the
       measurement pinned in the first test in this file. Asserted rather than
       described so that lowering it back to 4 MiB is a red test rather than a
       corpus figure that quietly stops being recovered. */
    expect(MAX_FIGURE_BYTES).toBeGreaterThan(4 * 1024 * 1024);
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
