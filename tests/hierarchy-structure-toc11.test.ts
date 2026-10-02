import { describe, expect, it } from "vitest";
import { buildTree, parseStructureAnswer, STRUCTURE_OUTPUT_SCHEMA, structureRequest, type BuildReport } from "../src/hierarchy.js";
import { assertNoBlockIdEnums, validateAnthropicJsonSchema } from "../src/messages-structured-output.js";
import type { Block } from "../src/types.js";

const blocks: Block[] = Array.from({ length: 4 }, (_, i) => ({
  id: `spya-toc11${i}`,
  tag: i % 2 === 0 ? "h2" : "p",
  kind: i % 2 === 0 ? "heading" : "text",
  ...(i % 2 === 0 ? { level: 2 } : {}),
  text: `Block ${i}`,
  words: 2,
  html: `<p>Block ${i}</p>`,
  gistable: true,
}));

const emptyReport = (): BuildReport => ({
  repairs: [],
  droppedChildren: [],
  droppedHeadings: [],
  collapsedRungs: [],
  droppedQuestions: [],
});

describe("toc/11's structured starts-only answer", () => {
  it("passes Anthropic's validator and forbids an enum on every start", () => {
    expect(validateAnthropicJsonSchema(STRUCTURE_OUTPUT_SCHEMA)).toBe(STRUCTURE_OUTPUT_SCHEMA);
    expect(() => assertNoBlockIdEnums(STRUCTURE_OUTPUT_SCHEMA, ["start"])).not.toThrow();
  });

  it("carries the schema on the request without losing low effort", () => {
    const format = structureRequest(blocks).params.output_config;
    expect(format).toEqual({
      effort: "low",
      format: { type: "json_schema", schema: STRUCTURE_OUTPUT_SCHEMA },
    });
  });

  it("parses and builds a starts-only answer through production's converter", () => {
    const report = emptyReport();
    const { root } = parseStructureAnswer(
      JSON.stringify({
        root: {
          title: "Whole",
          gist: "The whole article has two parts.",
          question: "Whole — how do the two parts fit?",
          children: [
            {
              title: "First",
              gist: "The first part begins the account.",
              question: "First — how does the account begin?",
              start: blocks[0]!.id,
            },
            {
              title: "Second",
              gist: "The second part finishes the account.",
              question: "Second — how does the account finish?",
              start: blocks[2]!.id,
            },
          ],
        },
      }),
      blocks,
      report,
    );
    const tree = buildTree(root, {}, blocks, "toc11", report);
    expect(tree.nodes[tree.rootId]?.range).toEqual([blocks[0]!.id, blocks[3]!.id]);
    expect(tree.nodes[tree.rootId]?.children).toHaveLength(2);
  });

  it("refuses an invented start with the existing message", () => {
    expect(() =>
      parseStructureAnswer(
        JSON.stringify({
          root: {
            title: "Whole",
            gist: "The whole article.",
            question: "Whole — what does it claim?",
            children: [
              {
                title: "Lost",
                gist: "This start was invented.",
                question: "Lost — where did it go?",
                start: "spya-zzzzzz",
              },
            ],
          },
        }),
        blocks,
        emptyReport(),
      ),
    ).toThrow('Node range not in blocks.json — at root > child 1: start "spya-zzzzzz"');
  });
});
