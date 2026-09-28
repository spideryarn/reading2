/**
 * **A reader never sees our handle for a passage.** docs/plans/260928c-block-refs-shown-to-readers.md.
 *
 * Three things, each of which went red before the fix:
 *
 *  - the detector finds every leak the plain-words eval recorded, verbatim, and
 *    leaves the article's own numbering alone;
 *  - the article a citing prompt is shown carries no block number to copy;
 *  - the prompts that are shown ids are told, next to the ids, what they are
 *    for; and Explain, whose answer is plain text, is told never to write one.
 *
 * What this cannot see: whether a model obeys. That is the log counter's job
 * (`blockRefLeaks` on chat's and Explain's finished-answer lines).
 */
import { describe, expect, it } from "vitest";
import { BLOCK_ID_NOTE, articleWithIds } from "../src/article-prompt.js";
import { blockRefLeaks, rawIds } from "../src/block-ref-leak.js";
import { buildExplainMessages } from "../src/explain.js";
import { EXPAND_SYSTEM } from "../src/hierarchy-expand.js";
import { structureRequest } from "../src/hierarchy.js";
import type { Block, Meta } from "../src/types.js";

describe("blockRefLeaks", () => {
  /* Verbatim from evals/results/plain-words/answers/ and artefacts/, and from
     local chat threads, 2026-09-28. */
  const leaks: [string, string[]][] = [
    [
      "which is exactly the phenomenon this whole note is building toward (you can see the contrast surface again later, in block 39, where the \"semi-distributed\" code's units are described",
      ["block 39"],
    ],
    ["Concretely (as the article works out later, in blocks 27–28), if you measure", ["blocks 27"]],
    [
      "the actual definitions come next in the text (block spya-f6sbgx defines mutual information, and spya-p4pyuy defines transfer entropy",
      ["block spya-f6sbgx"],
    ],
    [
      "Reading spya-vys3vj as the bridge between the cell-biology material (blocks 52, 58) and that summary paragraph",
      ["blocks 52"],
    ],
    ["This sentence is the hinge before block spya-da9tvt, where he explicitly draws", ["block spya-da9tvt"]],
    ["Block [spya-dfqq59] just gives the publication details: London : W. Tweedie", ["Block [spya-dfqq59"]],
    ["as the article says in Block #3.", ["Block #3"]],
    [
      "the actual definitions come next, in the next block, spya-f6sbgx and spya-p4pyuy",
      ["block, spya-f6sbgx"],
    ],
  ];

  for (const [text, found] of leaks) {
    it(`finds ${found.join(", ")}`, () => {
      expect(blockRefLeaks(text)).toEqual(found);
    });
  }

  it("rawIds finds every id, for an answer shown as plain text", () => {
    expect(rawIds("defined in spya-f6sbgx and [spya-p4pyuy].")).toEqual(["spya-f6sbgx", "spya-p4pyuy"]);
    expect(rawIds("defined where he talks about entropy.")).toEqual([]);
  });

  it("leaves the article's own numbering and ordinary uses of the word alone", () => {
    for (const text of [
      "Section 4 derives the bound, and reference [10] gives the proof.",
      "These are the building blocks of the argument.",
      "He rejects substrate independence [spya-k3m9qt].",
      "A block of flats, a mental block, a blockchain.",
    ]) {
      expect(blockRefLeaks(text), text).toEqual([]);
    }
  });
});

describe("what a citing prompt is shown", () => {
  const meta: Meta = { title: "T", byline: null, siteName: null, url: null } as unknown as Meta;
  const blocks = [
    { id: "spya-aaaaaa", tag: "p", text: "One.", html: "<p>One.</p>" },
    { id: "spya-bbbbbb", tag: "p", text: "Two.", html: "<p>Two.</p>" },
  ] as unknown as Block[];

  it("has ids to cite and no block number to copy", () => {
    const article = articleWithIds(meta, blocks);
    expect(article).toContain("spya-aaaaaa: One.");
    expect(article).not.toMatch(/^\[\d+\]/m);
  });
});

describe("what the prompts are told", () => {
  it("the article carries the note, and its examples are ones the detector catches", () => {
    const article = articleWithIds({ title: "T" } as Meta, [
      { id: "spya-aaaaaa", tag: "p", text: "One.", html: "<p>One.</p>" },
    ] as unknown as Block[]);
    expect(article).toContain(BLOCK_ID_NOTE);
    expect(blockRefLeaks(BLOCK_ID_NOTE).length).toBe(2);
  });

  it("the hierarchy prompts, which render their own numbered blocks, say it too", () => {
    const body = [{ id: "spya-aaaaaa", tag: "p", text: "One.", html: "<p>One.</p>", gistable: true }];
    for (const system of [structureRequest(body as unknown as Block[]).system, EXPAND_SYSTEM]) {
      expect(system).toMatch(/never names a passage as "block 12" or by its id/);
    }
  });

  it("Explain, whose answer is shown as plain text, is told never to write an id", () => {
    const messages = buildExplainMessages({ title: "T" } as Meta, [], "spya-aaaaaa", "q");
    expect(JSON.stringify(messages[0])).toContain("a block id in it reaches the reader as a");
  });
});
