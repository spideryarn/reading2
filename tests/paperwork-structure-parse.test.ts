import { describe, expect, it } from "vitest";
import { structureAnswerFields } from "../evals/paperwork/structure-parse.js";
import type { Block } from "../src/types.js";

const blocks: Block[] = Array.from({ length: 4 }, (_, i) => ({
  id: `spya-row00${i}`,
  tag: i % 2 === 0 ? "h2" : "p",
  kind: i % 2 === 0 ? "heading" : "text",
  ...(i % 2 === 0 ? { level: 2 } : {}),
  text: `Block ${i}`,
  words: 2,
  html: `<p>Block ${i}</p>`,
  gistable: true,
}));

describe("the structure validity row", () => {
  it("records build and drop fields for a parsed starts-only answer", () => {
    const fields = structureAnswerFields(
      JSON.stringify({
        root: {
          title: "Whole",
          gist: "The article has two useful parts.",
          question: "Whole — how do the parts fit?",
          children: [
            {
              title: "First",
              gist: "The first part opens the claim.",
              question: "First — how does it begin?",
              start: blocks[0]!.id,
            },
            {
              title: "Duplicate",
              gist: "This duplicate is dropped.",
              question: "Duplicate — why is it dropped?",
              start: blocks[0]!.id,
            },
            {
              title: "Second",
              gist: "The second part closes the claim.",
              question: "Second — how does it close?",
              start: blocks[2]!.id,
            },
          ],
        },
      }),
      blocks,
      "row-test",
    );
    expect(fields).toMatchObject({
      parsed: true,
      treeBuilds: true,
      droppedChildren: 1,
      droppedAuthoredHeadings: 0,
      depth1Count: 2,
      refusedInventedStart: false,
    });
  });

  it("records an invented start as a parsed refusal", () => {
    const fields = structureAnswerFields(
      JSON.stringify({
        root: {
          title: "Whole",
          gist: "The article has one part.",
          question: "Whole — what does it claim?",
          children: [
            {
              title: "Lost",
              gist: "The start was invented.",
              question: "Lost — where did it go?",
              start: "spya-zzzzzz",
            },
          ],
        },
      }),
      blocks,
      "row-test",
    );
    expect(fields).toMatchObject({
      parsed: true,
      treeBuilds: false,
      refusedInventedStart: true,
    });
  });
});
