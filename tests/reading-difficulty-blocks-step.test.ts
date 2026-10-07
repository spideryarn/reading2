/**
 * **The `blocks` step rates the piece it has just split** — plan 261005j § Where
 * the rating comes from.
 *
 * What a reader would notice if it broke: every newly imported article reads at
 * the flat rate and says "not rated" (the call was never made, or its answer
 * was dropped), or an import fails because a rating could not be had.
 *
 * The model is never called here: `readingDifficultyDeps.rate` is the seam, the
 * way `articleRegistryDeps.lookup` is for the registry.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { STEPS, readingDifficultyDeps } from "../src/pipeline.js";
import { memoryArtefacts, type MemoryArtifactStore } from "./helpers/memory-artefacts.js";

const SENTENCE =
  "The committee met on a wet Tuesday and agreed, after some argument, that the bridge would have to be rebuilt before the winter floods arrived.";
/* Well over the call's 150-word minimum, in paragraphs the splitter keeps apart. */
const EXTRACTED = `<article><h1>The bridge</h1>${Array.from({ length: 12 }, (_, i) => `<p>${i + 1}. ${SENTENCE}</p>`).join("")}</article>`;

const run = (store: MemoryArtifactStore, signal = new AbortController().signal) =>
  STEPS.blocks.run(
    { power: "standard", slug: "a", report: () => {}, preview: () => {}, signal, cacheArticle: false },
    store,
    nullCheckpointStore(),
  );

function planted(): MemoryArtifactStore {
  const store = memoryArtefacts();
  store.plant("a", "extract", "extractedHtml", EXTRACTED);
  return store;
}

afterEach(() => vi.restoreAllMocks());

describe("the blocks step and the reading-difficulty rating", () => {
  it("stores the rating the call returns, with the model and the time", async () => {
    const rate = vi.spyOn(readingDifficultyDeps, "rate").mockResolvedValue({
      kind: "rated",
      language: 4,
      ideas: 2,
      reason: "Long sentences, but one simple story.",
      model: "deepseek/deepseek-v4.1-flash",
    });
    const before = Date.now();

    const result = await run(planted());

    const stored = result.parts?.readingDifficulty;
    expect(stored).toMatchObject({
      rated: true,
      language: 4,
      ideas: 2,
      reason: "Long sentences, but one simple story.",
      model: "deepseek/deepseek-v4.1-flash",
    });
    if (!stored?.rated) throw new Error("not rated");
    expect(Date.parse(stored.ratedAt)).toBeGreaterThanOrEqual(before);
    expect(stored.ratedAt).toBe(new Date(stored.ratedAt).toISOString());

    /* It was shown the paragraphs this step produced, as text. */
    expect(rate).toHaveBeenCalledTimes(1);
    const paragraphs = rate.mock.calls[0]?.[0] ?? [];
    expect(paragraphs.filter((p) => p.includes(SENTENCE))).toHaveLength(12);
    expect(paragraphs.join(" ")).not.toContain("<p>");
  });

  it("leaves the piece unrated, and still succeeds, when the call says it could not rate it", async () => {
    vi.spyOn(readingDifficultyDeps, "rate").mockResolvedValue({ kind: "unrated", why: "refused" });
    const result = await run(planted());
    expect(result.parts?.readingDifficulty).toEqual({ rated: false });
    expect(result.parts?.blocks).toBeDefined();
  });

  it("leaves the piece unrated, and still succeeds, when the call throws", async () => {
    vi.spyOn(readingDifficultyDeps, "rate").mockRejectedValue(new TypeError("fetch failed"));
    const result = await run(planted());
    expect(result.parts?.readingDifficulty).toEqual({ rated: false });
    expect(result.parts?.blocks).toBeDefined();
  });

  it("stops when the step itself was cancelled", async () => {
    const stop = new AbortController();
    vi.spyOn(readingDifficultyDeps, "rate").mockImplementation(async () => {
      stop.abort(new Error("cancelled"));
      throw stop.signal.reason;
    });
    await expect(run(planted(), stop.signal)).rejects.toThrow("cancelled");
  });
});
