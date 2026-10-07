/**
 * **An image manifest made after the reader pressed Stop is kept, and is not
 * current.**
 *
 * Since 2026-10-07 a Stop that lands while an import's last step is finishing
 * keeps and publishes the article (Greg: *"err on the side of caution, and keep
 * & publish"*; docs/plans/261007f-stop-during-the-last-step-keeps-and-publishes.md).
 * The last step of an ordinary import is `assets`, and it answers an abort by
 * returning: every image it had not fetched is recorded `failed: "network"`.
 * Stamped current, that manifest would make every later ordinary run skip the
 * step, and the missing images would never be fetched. So the step stamps it
 * not current, and `stepIsDone` — the question the next run asks — says so.
 *
 * Offline: blocks with no images, so nothing dials. What is under test is the
 * stamp, which does not depend on how many images there were.
 */
import { describe, expect, it } from "vitest";

import type { Assets } from "../src/assets.js";
import { ASSETS_VERSION, assetsInputHash } from "../src/collect-assets.js";
import { STEPS, stepIsDone, type StepContext } from "../src/pipeline.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import type { Block } from "../src/types.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";

const SLUG = "a";

const blocks: Block[] = [
  {
    id: "spya-aaaaaa",
    tag: "p",
    kind: "text",
    text: "A paragraph with no pictures in it.",
    words: 7,
    html: "<p>A paragraph with no pictures in it.</p>",
    gistable: true,
  } as Block,
];

function ctxWith(signal: AbortSignal): StepContext {
  return {
    slug: SLUG,
    report: () => {},
    preview: () => {},
    signal,
    cacheArticle: false,
    power: "standard",
  } as unknown as StepContext;
}

/** Run the real step, plant what it returned, and ask the next run's question. */
async function runThenAsk(signal: AbortSignal) {
  const store = memoryArtefacts();
  store.plant(SLUG, "structure", "blocks", { blocks });
  const ctx = ctxWith(signal);
  const product = await STEPS.assets.run(ctx, store, nullCheckpointStore());
  const assets = product.parts?.assets as Assets;
  store.plant(SLUG, "assets", "assets", assets);
  /* The next run's question is asked with a live signal, as a new claim's is. */
  const current = await stepIsDone(STEPS.assets, ctxWith(new AbortController().signal), store);
  return { assets, current };
}

describe("the image step, stopped part-way", () => {
  it("is current after an ordinary run (the control)", async () => {
    const { assets, current } = await runThenAsk(new AbortController().signal);
    expect(assets.sourceHash).toBe(assetsInputHash(blocks));
    expect(assets.version).toBe(ASSETS_VERSION);
    expect(current, "an ordinary run's manifest must stay current, or every import re-fetches").toBe(true);
  });

  it("returns its manifest after a Stop, and the next ordinary run does not count it current", async () => {
    const stop = new AbortController();
    stop.abort();
    const { assets, current } = await runThenAsk(stop.signal);
    expect(Array.isArray(assets.entries), "the manifest is still returned, so it can be kept").toBe(true);
    expect(assets.sourceHash).not.toBe(assetsInputHash(blocks));
    expect(current, "a manifest made under a Stop must not make the next run skip the step").toBe(false);
  });
});
