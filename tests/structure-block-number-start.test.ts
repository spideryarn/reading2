/**
 * **`toc/13`: a child's `start` is the block's number, `[582]`, not its id.**
 * docs/plans/261020aa-structure-answers-the-block-number-not-its-id.md.
 *
 * Copying `[582] spya-xcf0dz` the model wrote `spya-582xcf0dz`; constrained to
 * the id's pattern it wrote a neighbour's id. Asked for 582, it wrote 582.
 */
import { describe, expect, it } from "vitest";
import { toc12System } from "../evals/structure-id-pattern/run.js";
import { renderBlocks } from "../src/structure-prompt.js";
import { startAsId } from "../src/structure-starts.js";
import { parseWholeDocumentAnswer, STRUCTURE_OUTPUT_SCHEMA, SYSTEM, wholeDocumentRequest, type BuildReport } from "../src/structure.js";
import type { UnresolvedStarts } from "../src/start-ranges.js";
import type { Block } from "../src/types.js";

const blocks: Block[] = Array.from({ length: 12 }, (_, i) => ({
  id: `spya-n${"abcdefghjkmn"[i]}mber`,
  tag: i % 4 === 0 ? "h2" : "p",
  kind: i % 4 === 0 ? "heading" : "text",
  ...(i % 4 === 0 ? { level: 2 } : {}),
  text: `Block ${i}`,
  words: 2,
  html: `<p>Block ${i}</p>`,
  gistable: true,
}));
const id = (i: number) => blocks[i]!.id;

const emptyReport = (): BuildReport => ({
  repairs: [],
  droppedChildren: [],
  rangelessChildren: [],
  droppedHeadings: [],
  collapsedRungs: [],
  unresolvedStarts: [],
  droppedQuestions: [],
});

const answer = (...starts: unknown[]) =>
  JSON.stringify({
    root: {
      title: "Whole",
      gist: "g",
      question: "q",
      children: starts.map((start, k) => ({ title: `Part ${k}`, gist: "g", question: "q", start })),
    },
  });

function ranges(raw: string, unresolved: UnresolvedStarts = "refuse") {
  const report = emptyReport();
  const { root } = parseWholeDocumentAnswer(raw, blocks, report, unresolved);
  return { ranges: root.children?.map((c) => c.range), report };
}

describe("the prompt and the schema ask for the number", () => {
  it("types every child's start as an integer, at both depths", () => {
    const chapter = (STRUCTURE_OUTPUT_SCHEMA as unknown as {
      properties: { root: { properties: { children: { items: {
        properties: { start: unknown; children: { items: { properties: { start: unknown } } } };
      } } } } };
    }).properties.root.properties.children.items;
    expect(chapter.properties.start).toEqual({ type: "integer" });
    expect(chapter.properties.children.items.properties.start).toEqual({ type: "integer" });
  });

  it("says what the number is, and no longer asks for the id", () => {
    expect(SYSTEM).toContain('the number in square brackets of the first block it');
    expect(SYSTEM).toContain('"start": <firstBlockNumber>');
    expect(SYSTEM).not.toContain("<firstBlockId>");
    expect(SYSTEM).not.toContain('"start": the id of the first block');
  });

  it("numbers the blocks it sends the way the answer is read", () => {
    expect(wholeDocumentRequest(blocks).user.split("\n\n")[5]).toBe(`[5] ${id(5)} <p>: Block 5`);
    expect(renderBlocks(blocks)).toContain(`[8] ${id(8)} <h2>: Block 8`);
  });

  it("is exactly the measured line arm: toc/12's prompt with two passages swapped", () => {
    const toc12 = toc12System(SYSTEM);
    expect(toc12).toContain('Give each child one "start": the id of the first block it covers.');
    expect(toc12).toContain('"start": "<firstBlockId>"');
  });
});

describe("a number resolves to the block it numbers", () => {
  it("builds the tiling from integer starts", () => {
    expect(ranges(answer(0, 4, 8)).ranges).toEqual([
      [id(0), id(3)],
      [id(4), id(7)],
      [id(8), id(11)],
    ]);
  });

  it("maps only an integer in range", () => {
    expect(startAsId(4, blocks)).toBe(id(4));
    for (const bad of [12, -1, 4.5, Number.NaN]) expect(startAsId(bad, blocks)).toBe(bad);
    expect(startAsId(id(4), blocks)).toBe(id(4));
  });

  it("refuses a number past the end on a first answer, and drops it on the last", () => {
    expect(() => ranges(answer(0, 4, 99, 8))).toThrow(/Node range not in blocks\.json — at root > child 3: start not a block id \(a number\)/);
    expect(() => ranges(answer(0, 4, 99, 8), "recover")).toThrow(/root > child 3/);
    const dropped = ranges(answer(0, 4, 99, 8, 10), "recover-or-drop");
    expect(dropped.report.droppedChildren).toEqual(["root > child 3"]);
  });

  it("still reads a stored toc/12 answer, whose starts are ids", () => {
    expect(ranges(answer(id(0), id(4), id(8))).ranges).toEqual(ranges(answer(0, 4, 8)).ranges);
  });
});
