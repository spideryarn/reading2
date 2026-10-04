import { describe, expect, it } from "vitest";
import { type ArmFile, screenModes } from "../evals/paperwork/modes.js";

const quotes = (n: number) => ({
  quotes: { quotes: Array.from({ length: n }, (_, i) => ({ text: `Quote ${i}`, reason: "kept", blockId: "spya-qqq001" })) },
});

/* Only Quotes is under test; a real arm file holds every mode, so the rest are failures. */
const skipped = { error: "not under test" };
const file = (slug: string, outputs: ArmFile["outputs"]): ArmFile => ({
  slug,
  arm: "after",
  sourceSha256: {},
  outputs: {
    sketch: skipped, illustrated: skipped, faq: skipped, quiz: skipped, ideas: skipped,
    glossary: skipped, timeline: skipped, arc: skipped,
    ...outputs,
  },
});

describe("the paperwork-modes totals", () => {
  it("count the articles a mode failed on, not only the ones it answered", () => {
    const { totals, rows } = screenModes([
      file("one", { quotes: quotes(3) }),
      file("two", { quotes: { error: "refused" } }),
      file("three", { quotes: { error: "cut off" } }),
    ]);
    expect(totals["after\tquotes"]).toEqual({ attempted: 3, failed: 2, items: 3, byId: 0, byWords: 0 });
    expect(rows.filter((r) => r.includes("\tquotes\tERROR"))).toHaveLength(2);
  });

  it("show a mode that failed on every article, with no items", () => {
    const { totals } = screenModes([file("one", { quotes: { error: "refused" } })]);
    expect(totals["after\tquotes"]).toEqual({ attempted: 1, failed: 1, items: 0, byId: 0, byWords: 0 });
  });
});
