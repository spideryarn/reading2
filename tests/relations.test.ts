/**
 * **The `relations` step's pure half, and the one request it sends** —
 * docs/plans/261003f-marginalia-relation-words-and-timeline-events.md § Stage 2.
 *
 * What is pinned is what has no visible symptom: which paragraphs are asked
 * about (never the first, never a heading or a short line, never the
 * apparatus); that each kind of bad row is counted under its own name; that a
 * sparse answer FAILS rather than being stored looking like a quiet article
 * (GPT Sol, P1-5); and that an article with nothing to label spends nothing.
 */
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/article-input.js";
import { cascadeForce } from "../src/jobs.js";
import { HIGH_POWER_MODEL } from "../src/high-power-model.js";
import { paperwork } from "../src/paperwork.js";
import { DEFAULT_INGEST_STEPS, FORCE_ONLY_WHEN_NAMED, STEP_ORDER } from "../src/pipeline.js";
import { SHAPE } from "../src/store/artifacts.js";
import { RELATIONS, type Block, type BlockId, type Tree } from "../src/types.js";
import {
  PARAGRAPH_MIN_WORDS,
  PROMPT_VERSION,
  RELATIONS_OUTPUT_SCHEMA,
  RELATIONS_SYSTEM,
  NOTE_MAX_WORDS,
  answerTokens,
  eligibleParagraphs,
  generateRelations,
  inputFingerprint,
  isOutdated,
  isStale,
  renderPrompt,
  noteCap,
  toNotes,
  toRelations,
} from "../src/relations.js";

/* ------------------------------------------------------- the stubbed model -- */

let answer = "";
const sent: { task: string; body: unknown }[] = [];

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (task: string, body: unknown) => {
      sent.push({ task, body: JSON.parse(JSON.stringify(body)) });
      const message = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text: answer, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        finalMessage: async () => message,
        stream: { finalMessage: async () => message },
      };
    },
  };
});

beforeEach(() => {
  answer = "";
  sent.length = 0;
});

/* ----------------------------------------------------------------- fixtures -- */

const LONG = "one two three four five six seven eight nine ten eleven twelve thirteen";

function block(id: string, over: Partial<Block> = {}): Block {
  const text = over.text ?? LONG;
  return {
    id: id as BlockId,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
    ...over,
  } as Block;
}

const ids = (...names: string[]): BlockId[] => names.map((n) => n as BlockId);

/** The real `example/` fixture's tree, under blocks of our own. */
let TREE: Tree;
beforeAll(async () => {
  const { readArticleFromDir } = await import("./helpers/article-from-dir.js");
  const example = await readArticleFromDir(path.resolve(import.meta.dirname, "..", "example"));
  TREE = example.tree;
});

function article(blocks: Block[]): Article {
  return { slug: "a-piece", blocks, tree: TREE, meta: null } as unknown as Article;
}

/* ------------------------------------------------------- eligibleParagraphs -- */

describe("eligibleParagraphs", () => {
  const blocks = [
    block("spya-hhhhhh", { kind: "heading", tag: "h2", text: "A heading that is certainly long enough to pass the floor if it were prose" } as Partial<Block>),
    block("spya-aaaaaa"),
    block("spya-ssssss", { text: "Too short to be a paragraph." }),
    block("spya-bbbbbb"),
    block("spya-nnnnnn", { treatment: "supplement", role: "footnote" }),
    block("spya-cccccc"),
  ];

  it("lists body paragraphs of a sentence or more, each with the one before it", () => {
    expect(eligibleParagraphs(blocks)).toEqual([
      { id: "spya-bbbbbb", previous: "spya-aaaaaa" },
      { id: "spya-cccccc", previous: "spya-bbbbbb" },
    ]);
  });

  it("leaves out the first paragraph, which has nothing before it", () => {
    expect(eligibleParagraphs(blocks).map((p) => p.id)).not.toContain("spya-aaaaaa");
  });

  it("leaves out headings, short lines and anything that is not the body", () => {
    const listed = eligibleParagraphs(blocks).map((p) => p.id);
    expect(listed).not.toContain("spya-hhhhhh");
    expect(listed).not.toContain("spya-ssssss");
    expect(listed).not.toContain("spya-nnnnnn");
  });

  it("counts exactly the floor as a paragraph, and one word under as not", () => {
    const at = Array.from({ length: PARAGRAPH_MIN_WORDS }, () => "w").join(" ");
    const under = Array.from({ length: PARAGRAPH_MIN_WORDS - 1 }, () => "w").join(" ");
    expect(
      eligibleParagraphs([block("spya-aaaaaa"), block("spya-bbbbbb", { text: at })]),
    ).toHaveLength(1);
    expect(
      eligibleParagraphs([block("spya-aaaaaa"), block("spya-bbbbbb", { text: under })]),
    ).toHaveLength(0);
  });

  it("is empty for an article with fewer than two paragraphs", () => {
    expect(eligibleParagraphs([])).toEqual([]);
    expect(eligibleParagraphs([block("spya-aaaaaa")])).toEqual([]);
  });

  it("keeps the same floor as the margin's own (src/web/marginalia/notes.ts)", async () => {
    const client = await import("../src/web/marginalia/notes.js");
    expect(PARAGRAPH_MIN_WORDS).toBe(client.PARAGRAPH_MIN_WORDS);
  });
});

/* -------------------------------------------------------------- toRelations -- */

describe("toRelations", () => {
  const eligible = ids("spya-bbbbbb", "spya-cccccc", "spya-dddddd", "spya-eeeeee");

  it("keeps one relation per listed paragraph", () => {
    const { relations, dropped } = toRelations(
      [
        { blockId: "spya-bbbbbb", relation: "but" },
        { blockId: "spya-cccccc", relation: "therefore" },
        { blockId: "spya-dddddd", relation: "and-also" },
        { blockId: "spya-eeeeee", relation: "contrast" },
      ],
      eligible,
    );
    expect(relations).toEqual({
      "spya-bbbbbb": "but",
      "spya-cccccc": "therefore",
      "spya-dddddd": "and-also",
      "spya-eeeeee": "contrast",
    });
    expect(dropped).toEqual({ unknown: 0, repeated: 0, offList: 0, missing: 0 });
  });

  it("counts each kind of drop under its own name, and the first answer wins", () => {
    const { relations, dropped } = toRelations(
      [
        { blockId: "spya-bbbbbb", relation: "but" },
        { blockId: "spya-bbbbbb", relation: "therefore" }, // repeated
        { blockId: "spya-zzzzzz", relation: "but" }, // unknown
        { blockId: "spya-cccccc", relation: "however" }, // offList
        { blockId: "spya-dddddd", relation: "restates" },
        "nonsense", // unreadable: an id nobody listed
      ],
      eligible,
    );
    expect(relations).toEqual({ "spya-bbbbbb": "but", "spya-dddddd": "restates" });
    expect(dropped).toEqual({ unknown: 2, repeated: 1, offList: 1, missing: 2 });
  });

  it("an off-list word does not use the paragraph up: a later valid row still counts", () => {
    const { relations, dropped } = toRelations(
      [
        { blockId: "spya-bbbbbb", relation: "SO" },
        { blockId: "spya-bbbbbb", relation: "therefore" },
        { blockId: "spya-cccccc", relation: "but" },
      ],
      ids("spya-bbbbbb", "spya-cccccc"),
    );
    expect(relations).toEqual({ "spya-bbbbbb": "therefore", "spya-cccccc": "but" });
    expect(dropped).toEqual({ unknown: 0, repeated: 0, offList: 1, missing: 0 });
  });

  it("FAILS when fewer than half the listed paragraphs are answered", () => {
    expect(() =>
      toRelations([{ blockId: "spya-bbbbbb", relation: "but" }], eligible),
    ).toThrow(/1 of 4/);
  });

  it("accepts exactly half", () => {
    const { relations, dropped } = toRelations(
      [
        { blockId: "spya-bbbbbb", relation: "but" },
        { blockId: "spya-cccccc", relation: "but" },
      ],
      eligible,
    );
    expect(Object.keys(relations)).toHaveLength(2);
    expect(dropped.missing).toBe(2);
  });

  it("fails on an answer with no array in it", () => {
    expect(() => toRelations(undefined, eligible)).toThrow(/no `relations` array/);
  });

  it("an empty list of paragraphs is an empty answer, not a failure", () => {
    expect(toRelations([], [])).toEqual({
      relations: {},
      dropped: { unknown: 0, repeated: 0, offList: 0, missing: 0 },
    });
  });
});

/* ------------------------------------------------------------ the request -- */

describe("generateRelations", () => {
  const blocks = [block("spya-aaaaaa"), block("spya-bbbbbb"), block("spya-cccccc")];

  it("an article with fewer than two paragraphs stores an empty artefact and calls no model", async () => {
    const run = await generateRelations({ article: article([block("spya-aaaaaa")]), power: "standard" });
    expect(sent).toHaveLength(0);
    expect(run.relations.relations).toEqual({});
    expect(run.relations.version).toBe(PROMPT_VERSION);
    expect(run.called).toBe(false);
    expect(SHAPE.relations.ok(run.relations.relations)).toBe(true);
  });

  it("sends the article with ids first, then the instructions, and lists the paragraphs in order", async () => {
    answer = JSON.stringify({
      relations: [
        { blockId: "spya-bbbbbb", relation: "but" },
        { blockId: "spya-cccccc", relation: "therefore" },
      ],
    });
    const run = await generateRelations({
      article: article(blocks),
      power: "standard",
      cacheArticle: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.task).toBe("relations");
    const body = sent[0]!.body as {
      system: { text: string; cache_control?: unknown }[];
      messages: { content: string }[];
      output_config: { format?: { schema?: unknown } };
    };
    expect(body.system[0]!.text).toContain("spya-aaaaaa");
    expect(body.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[1]!.text).toBe(RELATIONS_SYSTEM);
    const user = body.messages[0]!.content;
    expect(user.indexOf("spya-bbbbbb")).toBeGreaterThan(-1);
    expect(user.indexOf("spya-bbbbbb")).toBeLessThan(user.indexOf("spya-cccccc"));
    expect(body.output_config.format?.schema).toEqual(RELATIONS_OUTPUT_SCHEMA);

    expect(run.called).toBe(true);
    expect(run.relations.relations).toEqual({ "spya-bbbbbb": "but", "spya-cccccc": "therefore" });
    expect(run.relations.sourceHash).toBe(inputFingerprint(blocks, TREE, null));
    expect(isStale(run.relations, blocks, TREE, null)).toBe(false);
    expect(isStale(run.relations, [...blocks, block("spya-dddddd")], TREE, null)).toBe(true);
  });

  it("changes the fingerprint when the same words stop or start being an eligible paragraph", () => {
    const asText = [block("spya-aaaaaa"), block("spya-bbbbbb")];
    const asHeading = [
      asText[0]!,
      block("spya-bbbbbb", { kind: "heading", tag: "h2", text: asText[1]!.text }),
    ];
    expect(inputFingerprint(asHeading, TREE, null)).not.toBe(
      inputFingerprint(asText, TREE, null),
    );
  });

  it("does not change the fingerprint for a tree-only change the request never sees", () => {
    const changedTree = structuredClone(TREE);
    changedTree.nodes[changedTree.rootId]!.gist = "Different generated navigation prose.";
    expect(inputFingerprint(blocks, changedTree, null)).toBe(
      inputFingerprint(blocks, TREE, null),
    );
  });

  it("treats a relation from an older model generation as outdated", () => {
    expect(isOutdated({ version: PROMPT_VERSION, generator: "an-older-model" })).toBe(true);
    expect(isOutdated({ version: PROMPT_VERSION, generator: HIGH_POWER_MODEL })).toBe(false);
  });

  it("fails, storing nothing, when the model answers fewer than half", async () => {
    const many = [
      block("spya-aaaaaa"),
      block("spya-bbbbbb"),
      block("spya-cccccc"),
      block("spya-dddddd"),
      block("spya-eeeeee"),
    ];
    answer = JSON.stringify({ relations: [{ blockId: "spya-bbbbbb", relation: "but" }] });
    await expect(
      generateRelations({ article: article(many), power: "standard" }),
    ).rejects.toThrow(/1 of 4/);
  });
});

/* ------------------------------------------------- the prompt and the schema -- */

describe("the prompt", () => {
  it("defines every relation on the list, and no other", () => {
    for (const r of RELATIONS) expect(RELATIONS_SYSTEM).toContain(`"${r}"`);
    expect(RELATIONS_OUTPUT_SCHEMA.properties.relations.items.properties.relation.enum).toEqual([
      ...RELATIONS,
    ]);
  });

  it("classifies every listed paperwork paragraph instead of telling the model to omit it", () => {
    expect(RELATIONS_SYSTEM).toContain(paperwork("relation"));
    expect(RELATIONS_SYSTEM).not.toContain("Choose nothing from it alone");
    expect(RELATIONS_SYSTEM).toContain("still gets one relation");
  });

  it("never makes block ids an enum", () => {
    expect(RELATIONS_OUTPUT_SCHEMA.properties.relations.items.properties.blockId).toEqual({
      type: "string",
    });
  });

  it("names each paragraph and the one before it", () => {
    const text = renderPrompt([{ id: "spya-bbbbbb" as BlockId, previous: "spya-aaaaaa" as BlockId }]);
    expect(text).toContain("spya-bbbbbb");
    expect(text).toContain("spya-aaaaaa");
  });

  it("sizes the answer to the list", () => {
    expect(answerTokens(100)).toBeGreaterThan(answerTokens(10));
    expect(answerTokens(100)).toBeGreaterThanOrEqual(100 * 30);
  });
});

/* ------------------------------------------------------------ registration -- */

describe("where the step sits", () => {
  it("is right after faq, is not in an ordinary ingest, and is forced only by name", () => {
    expect(STEP_ORDER.indexOf("relations")).toBe(STEP_ORDER.indexOf("faq") + 1);
    expect(DEFAULT_INGEST_STEPS).not.toContain("relations");
    expect(FORCE_ONLY_WHEN_NAMED.has("relations")).toBe(true);
    expect(cascadeForce([...STEP_ORDER], new Set(["fetch"])).has("relations")).toBe(false);
    expect(cascadeForce(["faq", "relations"], new Set(["relations"])).has("relations")).toBe(true);
  });
});

/* ------------------------------------------------------------------- notes -- */

/* The notes the same call may write — plan 261011o. What is pinned is what
   has no visible symptom: a note whose quote is not in its passage, or whose
   link names a real but wrong passage, is dropped and counted rather than
   drawn; the cap is applied last, so a bad row never uses up a slot; and a bad
   note never costs the relation words. */
describe("toNotes", () => {
  const body = [
    block("spya-aaaaaa", { text: "The trial cut errors by 12% in the first year." }),
    block("spya-bbbbbb", { text: "Results: an 8% reduction in errors over the same year." }),
    block("spya-cccccc", { text: "Calibration means the stated odds match how often things happen." }),
  ];
  const tension = {
    blockId: "spya-aaaaaa",
    kind: "tension",
    quote: "cut errors by 12%",
    text: "Here 12%; the results give 8% for the same year.",
    to: "spya-bbbbbb",
    toQuote: "an 8% reduction in errors",
  };
  const explain = {
    blockId: "spya-cccccc",
    kind: "explain",
    quote: "stated odds match",
    text: "If it says 70%, it should happen about seven times in ten.",
    to: null,
    toQuote: null,
  };

  it("keeps a good note, storing the article's characters for both quotes", () => {
    const { notes, dropped } = toNotes(
      [{ ...tension, quote: "cut  errors by 12%" }, explain],
      body,
      8,
    );
    expect(notes).toEqual([
      {
        blockId: "spya-aaaaaa",
        kind: "tension",
        text: tension.text,
        quote: "cut errors by 12%",
        to: "spya-bbbbbb",
        toQuote: "an 8% reduction in errors",
      },
      { ...explain, quote: "stated odds match" },
    ]);
    expect(Object.values(dropped).every((n) => n === 0)).toBe(true);
  });

  it("drops a quote that is not in its passage, at either end", () => {
    expect(toNotes([{ ...tension, quote: "cut errors by 20%" }], body, 8).dropped.unquoted).toBe(1);
    /* A real passage, the wrong one: the confident wrong join the quote is for. */
    expect(toNotes([{ ...tension, to: "spya-cccccc" }], body, 8).dropped.unquoted).toBe(1);
  });

  it("drops a recall or tension with no other passage, an explain with one, and a note pointing at itself", () => {
    const { notes, dropped } = toNotes(
      [
        { ...tension, to: null, toQuote: null },
        { ...explain, to: "spya-aaaaaa", toQuote: "cut errors" },
        { ...tension, to: "spya-aaaaaa", toQuote: "12%" },
      ],
      body,
      8,
    );
    expect(notes).toEqual([]);
    expect(dropped.badTarget).toBe(3);
  });

  it("counts each other kind of bad row under its own name", () => {
    const { dropped } = toNotes(
      [
        "not an object",
        { ...tension, blockId: "spya-zzzzzz" },
        { ...tension, kind: "praise" },
        { ...explain, text: "" },
        { ...explain, text: Array.from({ length: NOTE_MAX_WORDS + 1 }, () => "w").join(" ") },
        explain,
        explain,
      ],
      body,
      8,
    );
    expect(dropped).toMatchObject({ malformed: 1, unknown: 1, offList: 1, badText: 2, repeated: 1 });
  });

  it("applies the cap last, in the model's order, so a bad row never takes a slot", () => {
    const { notes, dropped } = toNotes([{ ...tension, quote: "not there" }, explain, tension], body, 1);
    expect(notes.map((n) => n.blockId)).toEqual(["spya-cccccc"]);
    expect(dropped).toMatchObject({ unquoted: 1, overCap: 1 });
  });

  it("reads a missing or malformed list as no notes, and never throws", () => {
    expect(toNotes(undefined, body, 8).notes).toEqual([]);
    expect(toNotes({ notes: [] }, body, 8).notes).toEqual([]);
  });

  it("caps an article at one note per eight paragraphs, at least two and at most eight", () => {
    expect(noteCap(1)).toBe(2);
    expect(noteCap(24)).toBe(3);
    expect(noteCap(1000)).toBe(8);
  });
});

describe("generateRelations, with notes", () => {
  const blocks = [
    block("spya-aaaaaa", { text: "The trial cut errors by 12% in the first year, which is the headline claim." }),
    block("spya-bbbbbb", { text: "Results: an 8% reduction in errors over the same year, in the same group of people." }),
    block("spya-cccccc"),
  ];

  it("stores the notes beside the words, and a bad note does not fail the run", async () => {
    answer = JSON.stringify({
      notes: [
        {
          blockId: "spya-bbbbbb",
          kind: "tension",
          quote: "an 8% reduction in errors",
          text: "Here 8%; the opening says 12% for the same year.",
          to: "spya-aaaaaa",
          toQuote: "cut errors by 12%",
        },
        { blockId: "spya-cccccc", kind: "recall", quote: "nowhere", text: "x", to: "spya-aaaaaa", toQuote: "y" },
      ],
      relations: [
        { blockId: "spya-bbbbbb", relation: "but" },
        { blockId: "spya-cccccc", relation: "and-also" },
      ],
    });
    const run = await generateRelations({ article: article(blocks), power: "standard" });
    expect(run.relations.relations).toEqual({ "spya-bbbbbb": "but", "spya-cccccc": "and-also" });
    expect(run.relations.notes?.map((n) => [n.blockId, n.kind, n.to])).toEqual([
      ["spya-bbbbbb", "tension", "spya-aaaaaa"],
    ]);
    expect(run.relations.notesDropped?.unquoted).toBe(1);
  });

  it("an answer with no notes at all still stores the words, with none", async () => {
    answer = JSON.stringify({
      relations: [
        { blockId: "spya-bbbbbb", relation: "but" },
        { blockId: "spya-cccccc", relation: "and-also" },
      ],
    });
    const run = await generateRelations({ article: article(blocks), power: "standard" });
    expect(run.relations.notes).toEqual([]);
  });

  it("asks for the notes first, in the schema and in the user message", () => {
    expect(Object.keys(RELATIONS_OUTPUT_SCHEMA.properties)).toEqual(["notes", "relations"]);
    const user = renderPrompt([{ id: "spya-bbbbbb" as BlockId, previous: "spya-aaaaaa" as BlockId }]);
    expect(user.indexOf("margin notes")).toBeLessThan(user.indexOf("bears on the paragraph before it"));
    expect(RELATIONS_OUTPUT_SCHEMA.properties.notes.items.properties.to).toEqual({ type: ["string", "null"] });
  });

  it("budgets for a full set of notes at their longest, as well as the words", () => {
    expect(answerTokens(64)).toBeGreaterThanOrEqual(64 * 30 + noteCap(64) * 300);
  });

  it("carries the plain-words rule, now that the step writes prose a reader sees", () => {
    expect(RELATIONS_SYSTEM).toContain("PLAIN WORDS");
  });
});
