/**
 * **Simple's validation, and the one request it sends** —
 * docs/plans/260930i-simple-summaries-eli15-sub-mode.md § The artefact.
 *
 * Every bullet of the plan's validation list has a case here. Each one is a
 * way the stage would be wrong quietly: a paragraph with no door back to the
 * piece, or a digest where an orientation was asked for, looks exactly like one
 * that works (docs/reusable/silent-success.md).
 */
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/article-input.js";
import { SHAPE } from "../src/store/artifacts.js";
import type { Block, BlockId } from "../src/types.js";
import {
  MAX_WORDS,
  SIMPLE_SYSTEM,
  SIMPLE_VERSION,
  buildSimpleSummary,
  emptyDropped,
  generateSimpleSummary,
  inputFingerprint,
  simpleSystem,
} from "../src/simple-summary.js";
import { STAGE_EFFORT } from "../src/models.js";

/* ------------------------------------------------------- the stubbed model -- */

let answer = "";
let stop: string = "end_turn";
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
        stop_reason: stop,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        aborted: () => false,
        finalMessage: () => Promise.resolve(message),
      };
    },
  };
});

beforeEach(() => {
  answer = "";
  stop = "end_turn";
  sent.length = 0;
});

/* --------------------------------------------------------------- fixtures -- */

const block = (id: string, text: string, extra: Partial<Block> = {}): Block => ({
  id: id as BlockId,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
  ...extra,
});

const INTRO = block("spya-aaaaaa", "This paper asks whether a model can learn to read.");
const WHY = block("spya-bbbbbb", "Reading matters because most of what we know is written down.");
const RESULT = block("spya-cccccc", "The model read 38% faster, in this sample only.");
const METHOD = block("spya-dddddd", "We trained it on ten thousand pages.");
/* A supplement: never sent, so an id naming it is an invented one. */
const NOTE = block("spya-eeeeee", "Funding: a grant.", { treatment: "supplement" });

const BLOCKS = [INTRO, WHY, RESULT, METHOD, NOTE];
const EVIDENCE = BLOCKS.filter((b) => b.treatment !== "supplement");

const para = (text: string, ...ids: string[]) => ({ text, ids });

function build(paragraphs: unknown, dropped = emptyDropped()) {
  return buildSimpleSummary(
    { paragraphs },
    { slug: "s", evidence: EVIDENCE, sourceHash: "h", elapsedMs: 1, dropped, power: "standard" },
  );
}

/* ------------------------------------------------------------ validation -- */

describe("buildSimpleSummary", () => {
  it("keeps good paragraphs whole, in the model's order, stamped with SIMPLE_VERSION", () => {
    const out = build([
      para("It asks whether a model can read.", INTRO.id),
      para("It matters because most knowledge is written.", WHY.id),
      para("It read 38% faster, in this sample.", RESULT.id, METHOD.id),
    ]);
    expect(out.paragraphs).toEqual([
      { text: "It asks whether a model can read.", ids: [INTRO.id] },
      { text: "It matters because most knowledge is written.", ids: [WHY.id] },
      { text: "It read 38% faster, in this sample.", ids: [RESULT.id, METHOD.id] },
    ]);
    expect(out.version).toBe(SIMPLE_VERSION);
    expect(out.sourceHash).toBe("h");
    expect(SHAPE.simple.ok(out.paragraphs)).toBe(true);
  });

  it("fails on an answer with no paragraphs array", () => {
    expect(() =>
      buildSimpleSummary({ summary: "x" }, { slug: "s", evidence: EVIDENCE, sourceHash: "h", elapsedMs: 1, dropped: emptyDropped(), power: "standard" }),
    ).toThrow(/no `paragraphs` array/);
    expect(() =>
      buildSimpleSummary(null, { slug: "s", evidence: EVIDENCE, sourceHash: "h", elapsedMs: 1, dropped: emptyDropped(), power: "standard" }),
    ).toThrow(/no `paragraphs` array/);
  });

  it("fails on more than four paragraphs rather than cutting", () => {
    const five = [INTRO, WHY, RESULT, METHOD, INTRO].map((b, i) => para(`Paragraph ${i}.`, b.id));
    expect(() => build(five)).toThrow(/5 paragraphs and the limit is 4/);
  });

  it("fails over the word ceiling rather than cutting", () => {
    const long = Array.from({ length: MAX_WORDS }, () => "word").join(" ");
    expect(() => build([para(long, INTRO.id), para("And one more.", WHY.id)])).toThrow(
      new RegExp(`${MAX_WORDS + 3} words and the limit is ${MAX_WORDS}`),
    );
    /* At the ceiling exactly is fine. */
    const at = Array.from({ length: MAX_WORDS - 2 }, () => "word").join(" ");
    expect(build([para(at, INTRO.id), para("Two words.", WHY.id)]).paragraphs).toHaveLength(2);
  });

  it("drops and counts an unknown id, a supplement's id and a non-string id", () => {
    const dropped = emptyDropped();
    const out = build(
      [
        para("One.", "spya-zzzzzz", INTRO.id),
        { text: "Two.", ids: [NOTE.id, 42, WHY.id] },
      ],
      dropped,
    );
    expect(out.paragraphs.map((p) => p.ids)).toEqual([[INTRO.id], [WHY.id]]);
    expect(dropped.unknownIds).toBe(3);
  });

  it("dedupes ids, caps them at three, and counts both", () => {
    const dropped = emptyDropped();
    const out = build(
      [para("One.", INTRO.id, INTRO.id, WHY.id, RESULT.id, METHOD.id), para("Two.", WHY.id)],
      dropped,
    );
    expect(out.paragraphs[0]?.ids).toEqual([INTRO.id, WHY.id, RESULT.id]);
    expect(dropped.duplicateIds).toBe(1);
    expect(dropped.overCap).toBe(1);
  });

  it("drops a paragraph with no surviving id — every paragraph is a door", () => {
    const dropped = emptyDropped();
    const out = build(
      [
        para("About.", INTRO.id),
        para("Why it matters, resting on nothing.", "spya-zzzzzz"),
        { text: "No ids at all." },
        para("Key idea.", RESULT.id),
      ],
      dropped,
    );
    expect(out.paragraphs.map((p) => p.text)).toEqual(["About.", "Key idea."]);
    expect(dropped.unanchored).toBe(2);
  });

  it("drops an empty paragraph and a non-object, and counts them", () => {
    const dropped = emptyDropped();
    const out = build(
      [para("  ", INTRO.id), "a string", para("About.", INTRO.id), para("Why.", WHY.id)],
      dropped,
    );
    expect(out.paragraphs).toHaveLength(2);
    expect(dropped.empty).toBe(1);
    expect(dropped.malformed).toBe(1);
  });

  it("fails with fewer than two surviving paragraphs, saying why", () => {
    expect(() => build([para("About.", INTRO.id), para("Why.", "spya-zzzzzz")])).toThrow(
      /Only 1 of the model's 2 paragraphs.*1 with no usable passage/,
    );
    expect(() => build([])).toThrow(/Only 0 of the model's 0/);
  });
});

/* ------------------------------------------------------------ the request -- */

let example: Article;
beforeAll(async () => {
  const { readArticleFromDir } = await import("./helpers/article-from-dir.js");
  example = await readArticleFromDir(path.resolve(import.meta.dirname, "..", "example"));
});

describe("the request", () => {
  const article = (): Article => ({ ...example, slug: "simple-test", blocks: BLOCKS });

  it("fails on malformed JSON and stores nothing", async () => {
    answer = "{ this is not json";
    await expect(generateSimpleSummary({ power: "standard", article: article() })).rejects.toThrow();
  });

  it("fails on a refusal", async () => {
    stop = "refusal";
    answer = "";
    await expect(generateSimpleSummary({ power: "standard", article: article() })).rejects.toThrow();
  });

  it("fails on a max_tokens stop rather than parsing half an answer", async () => {
    stop = "max_tokens";
    answer = JSON.stringify({ paragraphs: [para("About.", INTRO.id), para("Why.", WHY.id)] });
    await expect(generateSimpleSummary({ power: "standard", article: article() })).rejects.toThrow();
  });

  it("reports what it dropped on the run, and does not store it", async () => {
    answer = JSON.stringify({
      paragraphs: [para("About.", INTRO.id, "spya-zzzzzz"), para("Why.", WHY.id, WHY.id)],
    });
    const run = await generateSimpleSummary({ power: "standard", article: article() });
    expect(run.dropped.unknownIds).toBe(1);
    expect(run.dropped.duplicateIds).toBe(1);
    expect(run.words).toBe(2);
    expect("dropped" in run.simpleSummary).toBe(false);
  });

  it("sends Ideas' article bytes and an exact request fingerprint, at high effort, under its own task", async () => {
    const noMeta: Article = { ...example, meta: null };
    const [first, second] = noMeta.blocks.filter((b) => b.treatment !== "supplement");
    if (!first || !second) throw new Error("fixture needs two body blocks");
    answer = JSON.stringify({ paragraphs: [para("About.", first.id), para("Why.", second.id)] });
    const run = await generateSimpleSummary({ power: "standard", article: noMeta, cacheArticle: true });

    answer = JSON.stringify({ ideas: [] });
    const { generateIdeas } = await import("../src/ideas.js");
    await generateIdeas({ power: "standard", article: noMeta, previous: null, cacheArticle: true }).catch(() => undefined);

    const [call, ideasCall] = sent;
    if (!call || !ideasCall) throw new Error("expected both calls");
    expect(call.task).toBe("simple");
    const body = call.body as { system: unknown[]; output_config: { effort: string } };
    expect(body.system[0]).toEqual((ideasCall.body as { system: unknown[] }).system[0]);
    expect(body.system[1]).toEqual({ type: "text", text: SIMPLE_SYSTEM });
    expect(body.output_config.effort).toBe("high");
    expect(STAGE_EFFORT.simple).toBe("high");
    expect(run.simpleSummary.sourceHash).toBe(inputFingerprint(noMeta.blocks, noMeta.tree, null));
  });

  it("does not go stale when only a supplement block, which the request omits, changes", () => {
    const changed = BLOCKS.map((b) => (b.id === NOTE.id ? { ...b, text: "Another grant." } : b));
    expect(inputFingerprint(changed, example.tree, example.meta)).toBe(
      inputFingerprint(BLOCKS, example.tree, example.meta),
    );
    const edited = BLOCKS.map((b) => (b.id === RESULT.id ? { ...b, text: "It read 40% faster." } : b));
    expect(inputFingerprint(edited, example.tree, example.meta)).not.toBe(
      inputFingerprint(BLOCKS, example.tree, example.meta),
    );
  });

  it("ships the fifteen-year-old pitch, and the probe's twelve is a different prompt", () => {
    expect(SIMPLE_SYSTEM).toBe(simpleSystem(15));
    expect(SIMPLE_SYSTEM).toContain("fifteen-year-old");
    expect(simpleSystem(12)).not.toBe(SIMPLE_SYSTEM);
    expect(SIMPLE_SYSTEM).toContain("PLAIN WORDS");
  });
});
