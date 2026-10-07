import { describe, expect, it } from "vitest";
import { stopBlocksAtDepth } from "../scripts/skim-coverage-route.js";
import type { Skim } from "../src/types.js";

describe("Skim's coverage report", () => {
  it("measures the stops the pass walks, including only the earlier stops carried into it", () => {
    const skim: Pick<Skim, "stops"> = {
      stops: [
        { quoteId: "q-gist-only", depth: 1, role: null },
        { quoteId: "q-carried", depth: 1, role: null, again: [2] },
        { quoteId: "q-more", depth: 2, role: null },
        { quoteId: "q-most", depth: 3, role: null },
      ],
    };
    const blocks = new Map<string, string>([
      ["q-gist-only", "b-gist-only"],
      ["q-carried", "b-carried"],
      ["q-more", "b-more"],
      ["q-most", "b-most"],
    ]);

    expect(stopBlocksAtDepth(skim, blocks, 2)).toEqual({
      blockIds: ["b-carried", "b-more"],
      unresolved: 0,
    });
  });

  it("does not let a carried stop create a pass for the report", () => {
    const skim: Pick<Skim, "stops"> = {
      stops: [{ quoteId: "q-gist", depth: 1, role: null, again: [2] }],
    };
    expect(stopBlocksAtDepth(skim, new Map([["q-gist", "b-gist"]]), 2)).toEqual({
      blockIds: [],
      unresolved: 0,
    });
  });
});
