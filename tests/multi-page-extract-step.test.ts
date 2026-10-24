/**
 * **Stage 2 reads every page stage 1 followed, each against its own address,
 * and makes one article of them** — through the real `extract` step, with the
 * stored bytes held in process. Plan
 * docs/plans/261024p-a-multi-page-article-imports-from-its-first-page.md §
 * Stage 2; the join itself is tests/read-parts.test.ts, the following is
 * tests/multi-page-fetch-step.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawManifest, RawPart } from "../src/fetch.js";

vi.mock("../src/fetch.js", async (original) => ({
  ...(await original<typeof import("../src/fetch.js")>()),
  readRawBytes: vi.fn(),
  readPartBytes: vi.fn(),
}));

const { readPartBytes, readRawBytes } = await import("../src/fetch.js");
const { STEPS, articleRegistryDeps, titleTidiers } = await import("../src/pipeline.js");
const { ruleTitleTidier } = await import("../src/title-tidy.js");
const { memoryArtefacts } = await import("./helpers/memory-artefacts.js");
const { nullCheckpointStore } = await import("../src/store/checkpoints.js");

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(readPartBytes).mockReset();
});

const SITE = "https://long-essay.example";
const prose = (what: string) =>
  `<p>${what}: a paragraph long enough that Readability keeps it as the article's prose rather than as a fragment of the page's chrome.</p>`;

/** A landing page under the 500-character floor on its own. */
const LANDING =
  `<html><head><title>The Long Essay</title></head><body><article><h1>The Long Essay</h1>${prose("The abstract")}` +
  `<nav><a href="/one">Chapter I</a> <a href="/chapters/two">Chapter II</a></nav></article></body></html>`;
const chapter = (n: string, img: string) =>
  `<html><head><title>Chapter ${n} | The Long Essay</title></head><body><article><h1>Chapter ${n}: the argument</h1>` +
  `${[1, 2, 3, 4, 5].map((k) => prose(`Chapter ${n}, paragraph ${k}`)).join("")}` +
  `<figure><img src="${img}" alt="A figure"><figcaption>Figure of chapter ${n}.</figcaption></figure></article></body></html>`;

const PARTS: Record<string, string> = {
  [`${SITE}/one`]: chapter("I", "fig-one.png"),
  [`${SITE}/chapters/two`]: chapter("II", "fig-two.png"),
};

async function extracted(parts: RawPart[] | undefined): Promise<string> {
  const store = memoryArtefacts();
  store.plant("s", "fetch", "raw", {
    kind: "html",
    file: "raw.html",
    requestedUrl: `${SITE}/`,
    url: `${SITE}/`,
    storedSha256: "a".repeat(64),
    ...(parts === undefined ? {} : { parts }),
  } as RawManifest);
  vi.mocked(readRawBytes).mockResolvedValue(new TextEncoder().encode(LANDING));
  vi.mocked(readPartBytes).mockImplementation(async (part) => new TextEncoder().encode(PARTS[part.url]!));
  vi.spyOn(articleRegistryDeps, "lookup").mockResolvedValue({ kind: "unavailable", why: "busy" });
  vi.spyOn(titleTidiers, "import").mockImplementation(ruleTitleTidier);
  const result = await STEPS.extract.run(
    { slug: "s", url: `${SITE}/`, report: () => {}, preview: () => {}, signal: new AbortController().signal, cacheArticle: false, power: "standard" },
    store,
    nullCheckpointStore(),
  );
  return result.parts?.extractedHtml ?? "";
}

const part = (url: string): RawPart => ({ url, storedSha256: "b".repeat(64), storedBytes: 1 });

describe("an article stage 1 followed across pages", () => {
  it("is every page, in order, each resolved against its own address", async () => {
    const html = await extracted([part(`${SITE}/one`), part(`${SITE}/chapters/two`)]);
    const at = (s: string) => html.indexOf(s);
    expect(at("The abstract")).toBeGreaterThan(-1);
    expect(at("Chapter I, paragraph 5")).toBeGreaterThan(at("The abstract"));
    expect(at("Chapter II, paragraph 1")).toBeGreaterThan(at("Chapter I, paragraph 5"));
    expect(html).toContain(`src="${SITE}/fig-one.png"`);
    expect(html).toContain(`src="${SITE}/chapters/fig-two.png"`);
    expect(vi.mocked(readPartBytes)).toHaveBeenCalledTimes(2);
  });

  it("is refused as too little to read when the landing page is all there is", async () => {
    const refused = await extracted(undefined).then(() => null, (err: unknown) => err);
    expect(refused).not.toBeNull();
    expect(String((refused as Error).message)).toMatch(/less than its own threshold/);
    expect(vi.mocked(readPartBytes)).not.toHaveBeenCalled();
  });
});
