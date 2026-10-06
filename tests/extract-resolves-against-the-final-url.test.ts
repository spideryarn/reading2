/**
 * **Stage 2 resolves a page's relative links against the address its bytes came
 * from, not the address the job was queued with.**
 *
 * arXiv's HTML names its figures relatively (`<img src="2608.13566v1/x1.png">`),
 * which is right against `arxiv.org/html/2608.13566` and wrong against the
 * `abs/` address the reader pasted. The same was true of any page that was
 * redirected and uses relative links (docs/project/fetching.md § What's still
 * loose, item 1). The `extract` step now hands `runExtract` the manifest's final
 * URL, and the job's own only for a manifest that has none.
 * docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md
 * § Caller 3.
 *
 * Through the real step, with the source bytes held in process.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawManifest } from "../src/fetch.js";

vi.mock("../src/fetch.js", async (original) => ({
  ...(await original<typeof import("../src/fetch.js")>()),
  readRawBytes: vi.fn(),
}));

const { readRawBytes } = await import("../src/fetch.js");
const { STEPS, articleRegistryDeps, titleTidiers } = await import("../src/pipeline.js");
const { ruleTitleTidier } = await import("../src/title-tidy.js");
const { memoryArtefacts } = await import("./helpers/memory-artefacts.js");
const { nullCheckpointStore } = await import("../src/store/checkpoints.js");

afterEach(() => vi.restoreAllMocks());

const JOB_ADDRESS = "https://arxiv.org/abs/2608.13566";
const FINAL_ADDRESS = "https://arxiv.org/html/2608.13566";

const PAGE =
  "<html><head><title>Entropy and the arrow of time in open quantum systems</title></head><body><article>" +
  "<h1>Entropy and the arrow of time in open quantum systems</h1>" +
  "<p>A careful discussion of entropy and the arrow of time in open quantum systems. We measure the system and consider what this means for time and physics.</p>".repeat(15) +
  '<figure><img src="2608.13566v1/x1.png" alt="The apparatus"><figcaption>Figure 1: the apparatus.</figcaption></figure>' +
  '<p>The details are in <a href="2608.13566v1/appendix">the appendix</a>, which follows the argument above step by step.</p>' +
  "<p>A careful discussion of entropy and the arrow of time in open quantum systems. We measure the system and consider what this means for time and physics.</p>".repeat(15) +
  "</article></body></html>";

/** The extracted page, for a manifest with this final URL (or none). */
async function extracted(finalUrl: string | undefined): Promise<string> {
  const store = memoryArtefacts();
  store.plant("s", "fetch", "raw", {
    kind: "html", file: "raw.html",
    ...(finalUrl === undefined ? {} : { requestedUrl: JOB_ADDRESS, url: finalUrl }),
    contentType: "text/html", encoding: "utf-8", bytes: 100, sha256: "a".repeat(64),
    storedSha256: "a".repeat(64), storedBytes: 100, fetchedAt: "2026-10-05T00:00:00Z",
  } satisfies RawManifest);
  vi.mocked(readRawBytes).mockResolvedValue(new TextEncoder().encode(PAGE));
  vi.spyOn(articleRegistryDeps, "lookup").mockResolvedValue({ kind: "unavailable", why: "busy" });
  vi.spyOn(titleTidiers, "import").mockImplementation(ruleTitleTidier);
  const result = await STEPS.extract.run({
    slug: "s", url: JOB_ADDRESS, report: () => {}, preview: () => {},
    signal: new AbortController().signal, cacheArticle: false, power: "standard",
  }, store, nullCheckpointStore());
  return result.parts?.extractedHtml ?? "";
}

describe("the base a fetched page's relative links resolve against", () => {
  it("is the manifest's final URL when the bytes came from somewhere other than the job's address", async () => {
    const html = await extracted(FINAL_ADDRESS);
    expect(html).toContain('src="https://arxiv.org/html/2608.13566v1/x1.png"');
    expect(html).toContain('href="https://arxiv.org/html/2608.13566v1/appendix"');
    expect(html).not.toContain("https://arxiv.org/abs/2608.13566v1/");
  });

  it("is the job's address when the manifest has none", async () => {
    const html = await extracted(undefined);
    expect(html).toContain('src="https://arxiv.org/abs/2608.13566v1/x1.png"');
    expect(html).toContain('href="https://arxiv.org/abs/2608.13566v1/appendix"');
  });
});
