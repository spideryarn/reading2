import { describe, expect, it } from "vitest";
import { quoteCheck } from "../evals/learn-tutorial.js";
import type { Block } from "../src/types.js";

const blocks: Block[] = [{
  id: "spya-ajt4fw",
  tag: "p",
  kind: "text",
  text: "The Self is an intelligent data pattern, which facilitates its own transformation through new architectures.",
  words: 18,
  html: "<p>The Self is an intelligent data pattern, which facilitates its own transformation through new architectures.</p>",
  gistable: true,
}];

describe("Tutorial's quotation screen", () => {
  it("recognises an unlinked phrase with a comma inside the closing mark", () => {
    // The question in entropy-after-1, richRecall turn 2: the screen missed it.
    const check = quoteCheck('Given that phrase, "facilitates its own transformation," what does it suggest?', blocks);
    expect(check.article).toBe(1);
    expect(check.unlinked).toHaveLength(1);
  });

  it("requires even a short ellipsis piece to occur in the cited block", () => {
    const check = quoteCheck('"not … an intelligent data pattern" [spya-ajt4fw]', blocks);
    expect(check.article).toBe(0);
    expect(check.altered).toHaveLength(1);
  });

  it("accepts short ellipsis pieces that really do occur in order", () => {
    const check = quoteCheck('"is … an intelligent data pattern" [spya-ajt4fw]', blocks);
    expect(check.article).toBe(1);
    expect(check.altered).toEqual([]);
    expect(check.unlinked).toEqual([]);
  });

  it("keeps internal punctuation before an ellipsis as part of the quotation", () => {
    const check = quoteCheck('"The Self; … an intelligent data pattern" [spya-ajt4fw]', blocks);
    expect(check.article).toBe(0);
    expect(check.altered).toHaveLength(1);
  });
});
