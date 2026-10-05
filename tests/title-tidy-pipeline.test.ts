/** The title held at all three pipeline seams, with Postgres's normalization. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawManifest } from "../src/fetch.js";
import type { Meta } from "../src/types.js";
import { metaColumns } from "../src/store/artifacts-pg.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";

vi.mock("../src/fetch.js", async (original) => ({
  ...(await original<typeof import("../src/fetch.js")>()),
  readRawBytes: vi.fn(),
}));
vi.mock("../src/pdf-read.js", async (original) => ({
  ...(await original<typeof import("../src/pdf-read.js")>()),
  runPdfExtract: vi.fn(),
}));
const { readRawBytes } = await import("../src/fetch.js");
const { runPdfExtract } = await import("../src/pdf-read.js");
const { STEPS, titleTidiers, metadataReaders, articleRegistryDeps } = await import("../src/pipeline.js");

afterEach(() => vi.restoreAllMocks());

type Seam = "html" | "pdf" | "metadata";
const RAW = "THE ORDER OF TIME";
const HELD = "The order of time";
async function run(seam: Seam, previous?: Meta, raw = RAW, full = true, signal = new AbortController().signal) {
  const store = memoryArtefacts();
  store.plant("s", "fetch", "raw", {
    kind: seam === "html" ? "html" : "pdf", file: seam === "html" ? "raw.html" : "raw.pdf",
    url: "https://example.org/paper", requestedUrl: "https://example.org/paper", contentType: "application/pdf", encoding: "utf-8",
    bytes: 100, storedBytes: 100, sha256: "a".repeat(64), storedSha256: "a".repeat(64), fetchedAt: "2024-01-01T00:00:00Z",
  } satisfies RawManifest);
  if (previous) {
    const columns = metaColumns(previous);
    /* Both metadata and extract read these same columns in Postgres. */
    store.plant("s", "extract", "meta", { slug: "s", title: columns.title, titleOriginal: columns.titleOriginal });
    if (full) store.plant("s", "extract", "extractedHtml", "<p>Already read.</p>");
  }
  vi.spyOn(articleRegistryDeps, "lookup").mockResolvedValue({ kind: "unavailable", why: "busy" });
  const tidy = vi.spyOn(titleTidiers, "import").mockResolvedValue({ title: "The Order of Time", titleOriginal: raw });
  vi.mocked(readRawBytes).mockResolvedValue(new TextEncoder().encode(
    `<html><head><title>${raw}</title></head><body><article><h1>${raw}</h1>${"<p>A careful discussion of entropy and the arrow of time in open quantum systems.</p>".repeat(30)}</article></body></html>`,
  ));
  vi.spyOn(metadataReaders, "pdf").mockResolvedValue({
    title: raw, authors: [], abstract: "An abstract.", doi: null, from: "model", textChars: 100, answeredBy: "fixture",
  });
  vi.mocked(runPdfExtract).mockImplementation(async (opts) => ({
    meta: { slug: "s", ...await opts.titleTidier!(raw, { signal: opts.signal }), source: "pdf" },
    extractedHtml: "<p>A paper.</p>", transcript: [], pages: 1, chunks: 1, records: 0, stripped: 0,
    retries: [], isScan: false, recall: 1, usage: { input: 0, output: 0 }, frontMatterUsage: { input: 0, output: 0 },
  }) as unknown as Awaited<ReturnType<typeof runPdfExtract>>);
  const result = await STEPS[seam === "metadata" ? "metadata" : "extract"].run({
    slug: "s", url: "https://example.org/paper", signal, report: () => {}, preview: () => {}, cacheArticle: false, power: "standard",
  }, store, nullCheckpointStore());
  return { meta: result.parts?.meta, tidy, signal };
}

describe.each(["html", "pdf", "metadata"] as const)("%s title seam", (seam) => {
  it("holds the stored pair when the raw title repeats", async () => {
    const { meta, tidy } = await run(seam, { slug: "s", title: HELD, titleOriginal: RAW });
    expect(meta).toMatchObject({ title: HELD, titleOriginal: RAW });
    expect(tidy).not.toHaveBeenCalled();
  });
  it("holds the pair during minimal-to-full Read this", async () => {
    const { meta, tidy } = await run(seam, { slug: "s", title: HELD, titleOriginal: RAW }, RAW, false);
    expect(meta).toMatchObject({ title: HELD, titleOriginal: RAW });
    expect(tidy).not.toHaveBeenCalled();
  });
  it("asks on the first import, with the step's own signal", async () => {
    const { meta, tidy, signal } = await run(seam);
    expect(meta).toMatchObject({ title: "The Order of Time", titleOriginal: RAW });
    expect(tidy).toHaveBeenCalledOnce();
    expect(tidy.mock.calls[0]?.[1]?.signal).toBe(signal);
  });
  it("asks about a title stored unchanged before any tidying", async () => {
    const { meta, tidy } = await run(seam, { slug: "s", title: RAW });
    expect(meta).toMatchObject({ title: "The Order of Time", titleOriginal: RAW });
    expect(tidy).toHaveBeenCalledOnce();
  });
  it("asks when a different raw title arrives", async () => {
    const { tidy } = await run(seam, { slug: "s", title: "Other", titleOriginal: "OTHER" });
    expect(tidy).toHaveBeenCalledOnce();
  });
  it("compares the incoming title in the same plain form as the stored original", async () => {
    const raw = seam === "html" ? "THE &lt;i&gt;ORDER&lt;/i&gt; OF TIME" : "THE <i>ORDER</i> OF TIME";
    const { meta, tidy } = await run(seam, { slug: "s", title: HELD, titleOriginal: RAW }, raw);
    expect(meta).toMatchObject({ title: HELD, titleOriginal: RAW });
    expect(tidy).not.toHaveBeenCalled();
  });
});
