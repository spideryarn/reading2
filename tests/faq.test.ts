/**
 * **The FAQ stage's pure half, and the one request it sends** —
 * docs/plans/260916d-faq-mode.md.
 *
 * Every case here is a way the stage would be wrong quietly. A list of twelve
 * plausible questions under quotations the article never printed looks exactly
 * like one that works (docs/reusable/silent-success.md), so what is pinned is
 * what has no visible symptom: the words shown are the article's; a question
 * with nothing to point at is gone; the order is the reader's; the three empty
 * outcomes are three different answers; the request shares Ideas' cached
 * prefix; and an earlier forced step does not buy this model call.
 *
 * The stamp-and-stage agreement on the fingerprint is asked in
 * tests/stage-stamp-agreement.test.ts and, for an article with no metadata, in
 * tests/meta-fallback-fingerprint.test.ts — both carry a `faq` row.
 */
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/article-input.js";
import { cascadeForce } from "../src/jobs.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { FORCE_ONLY_WHEN_NAMED, STEP_ORDER, sharesArticleCache } from "../src/pipeline.js";
import { articleWithIdsFingerprint } from "../src/source-hash.js";
import { SHAPE } from "../src/store/artifacts.js";
import type { Block, FaqDropped } from "../src/types.js";
import {
  ANSWER_TOKENS,
  FAQ_SYSTEM,
  MAX_PASSAGES,
  MAX_QUESTIONS,
  MAX_QUOTE_CHARS,
  PROMPT_VERSION,
  buildFaq,
  emptyDropped,
  generateFaq,
  questionBudget,
  toQuestions,
  verifyPassage,
} from "../src/faq.js";

/* ------------------------------------------------------- the stubbed model -- */

/** What the next call answers, and every body the stub was handed. */
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
        aborted: () => false,
        finalMessage: () => Promise.resolve(message),
      };
    },
  };
});

beforeEach(() => {
  answer = "";
  sent.length = 0;
});

/* --------------------------------------------------------------- fixtures -- */

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

/** In document order — `spya-aaaaaa` is first on the page. */
const A = block(
  "spya-aaaaaa",
  "Entropy in a closed system never decreases. Things fall apart, and they stay apart.",
);
const B = block(
  "spya-bbbbbb",
  "A fridge can lower its local entropy only by exporting more to its surroundings.",
);
const C = block("spya-cccccc", "The author’s “second law” is a statement about probabilities, not certainties.");
const blocks: Block[] = [A, B, C];
const byId = new Map(blocks.map((b) => [b.id as string, b]));

const drops = (): FaqDropped => emptyDropped();

const q = (question: string, passages: { blockId: string; quote: string }[]) => ({
  question,
  passages,
});

/* ------------------------------------------------------------ one passage -- */

describe("a passage is believed only if the article backs it up", () => {
  it("drops an invented block id", () => {
    const d = drops();
    expect(verifyPassage({ blockId: "spya-zzzzzz", quote: "Things fall apart" }, byId, d)).toBeNull();
    expect(d.unknownIds).toBe(1);
  });

  it("drops a paraphrase", () => {
    const d = drops();
    expect(
      verifyPassage({ blockId: A.id, quote: "Entropy in a sealed system can never go down" }, byId, d),
    ).toBeNull();
    expect(d.unquoted).toBe(1);
  });

  it("drops a quote that is really in a different block than the one named", () => {
    const d = drops();
    expect(verifyPassage({ blockId: A.id, quote: "exporting more to its surroundings" }, byId, d)).toBeNull();
    expect(d.unquoted).toBe(1);
  });

  it("rejects a word split in two — `fall a part` is not `fall apart`", () => {
    /* The forgiving pass deletes whitespace and would accept this; a quotation
       shown to a reader is a claim that the article says these words. */
    const d = drops();
    expect(verifyPassage({ blockId: A.id, quote: "Things fall a part" }, byId, d)).toBeNull();
    expect(d.unquoted).toBe(1);
  });

  it("accepts straight quotes for curly ones, and stores the article's characters", () => {
    const d = drops();
    const found = verifyPassage({ blockId: C.id, quote: `The author's "second law" is a statement` }, byId, d);
    expect(found).not.toBeNull();
    expect(found?.quote).toBe("The author’s “second law” is a statement");
    expect(found?.start).toBe(0);
    expect(d).toEqual(emptyDropped());
  });

  it("drops a quote over the cap rather than cutting it", () => {
    const long = block("spya-dddddd", `${"word ".repeat(80).trim()}.`);
    const d = drops();
    const quote = long.text;
    expect(quote.length).toBeGreaterThan(MAX_QUOTE_CHARS);
    expect(verifyPassage({ blockId: long.id, quote }, new Map([[long.id, long]]), d)).toBeNull();
    expect(d.tooLong).toBe(1);
    expect(d.unquoted).toBe(0);
  });
});

/* -------------------------------------------------------------- the batch -- */

describe("turning the model's answer into questions", () => {
  it("drops a question whose every passage was dropped", () => {
    const d = drops();
    const out = toQuestions(
      [
        q("How can a fridge get colder?", [{ blockId: B.id, quote: "A fridge can lower its local entropy" }]),
        q("Is the law certain?", [{ blockId: "spya-zzzzzz", quote: "not certainties" }]),
      ],
      blocks,
      d,
    );
    expect(out.map((x) => x.question)).toEqual(["How can a fridge get colder?"]);
    expect(d.unanchored).toBe(1);
    expect(d.unknownIds).toBe(1);
  });

  it("merges a repeated question, and a repeated passage, into one", () => {
    const d = drops();
    const out = toQuestions(
      [
        q("How can a fridge get colder?", [
          { blockId: B.id, quote: "A fridge can lower its local entropy" },
          { blockId: B.id, quote: "A fridge can lower its local entropy" },
        ]),
        q("  how can a fridge get COLDER? ", [
          { blockId: A.id, quote: "Entropy in a closed system never decreases." },
        ]),
      ],
      blocks,
      d,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.question).toBe("How can a fridge get colder?");
    expect(out[0]?.passages.map((p) => p.blockId)).toEqual([A.id, B.id]);
    expect(d.duplicate).toBe(2);
  });

  it("puts passages and questions into reading order, whatever order the model used", () => {
    const d = drops();
    const out = toQuestions(
      [
        q("Is the law only probable?", [{ blockId: C.id, quote: "a statement about probabilities" }]),
        q("How can a fridge get colder?", [
          { blockId: B.id, quote: "exporting more to its surroundings" },
          { blockId: A.id, quote: "they stay apart" },
          { blockId: A.id, quote: "Entropy in a closed system" },
        ]),
      ],
      blocks,
      d,
    );
    expect(out.map((x) => x.question)).toEqual(["How can a fridge get colder?", "Is the law only probable?"]);
    expect(out[0]?.passages.map((p) => p.quote)).toEqual([
      "Entropy in a closed system",
      "they stay apart",
      "exporting more to its surroundings",
    ]);
    /* The stored shape carries no private `end`. */
    expect(Object.keys(out[0]?.passages[0] ?? {}).sort()).toEqual(["blockId", "quote", "start"]);
  });

  it("keeps at most three passages on a question", () => {
    const d = drops();
    const out = toQuestions(
      [
        q("Does it all hang together?", [
          { blockId: A.id, quote: "Entropy in a closed system" },
          { blockId: A.id, quote: "Things fall apart" },
          { blockId: B.id, quote: "A fridge can lower" },
          { blockId: C.id, quote: "not certainties" },
        ]),
      ],
      blocks,
      d,
    );
    expect(out[0]?.passages).toHaveLength(MAX_PASSAGES);
    expect(d.overCap).toBe(1);
  });

  it("keeps at most twelve questions — the first twelve the model listed", () => {
    const d = drops();
    const raw = Array.from({ length: MAX_QUESTIONS + 3 }, (_, i) =>
      q(`Question number ${i + 1}?`, [{ blockId: A.id, quote: "Things fall apart" }]),
    );
    const out = toQuestions(raw, blocks, d);
    expect(out).toHaveLength(MAX_QUESTIONS);
    expect(out.map((x) => x.question)).toContain("Question number 12?");
    expect(out.map((x) => x.question)).not.toContain("Question number 13?");
    expect(d.overCap).toBe(3);
    expect(new Set(out.map((x) => x.id)).size).toBe(MAX_QUESTIONS);
  });

  it("refuses a question over the length cap, and one with no text", () => {
    const d = drops();
    const out = toQuestions(
      [
        q(`${"Why ".repeat(60)}?`, [{ blockId: A.id, quote: "Things fall apart" }]),
        q("", [{ blockId: A.id, quote: "Things fall apart" }]),
        null,
      ],
      blocks,
      d,
    );
    expect(out).toEqual([]);
    expect(d.malformed).toBe(3);
  });
});

/* ------------------------------------------------------- the empty answers -- */

describe("the three empty outcomes", () => {
  const opts = () => ({ slug: "s", blocks, sourceHash: "h", elapsedMs: 1, dropped: emptyDropped() });

  it("fails an answer with no questions array", () => {
    expect(() => buildFaq({}, opts())).toThrow(/no `questions` array/);
    expect(() => buildFaq({ questions: "none" }, opts())).toThrow(/no `questions` array/);
  });

  it("accepts a deliberate empty list, and the store accepts it too", () => {
    const faq = buildFaq({ questions: [] }, opts());
    expect(faq.questions).toEqual([]);
    expect(faq.version).toBe(PROMPT_VERSION);
    expect(faq.generator).toBe(CAPABLE_MODEL);
    /* The store's spellings of the stamp, which `stampOf` reads. */
    expect(faq.sourceHash).toBe("h");
    const shape = SHAPE.faq;
    expect(shape.field).toBe("questions");
    expect(shape.ok(faq.questions)).toBe(true);
  });

  it("fails, with the counts, when the model named questions and every one was dropped", () => {
    const o = opts();
    expect(() =>
      buildFaq(
        {
          questions: [
            q("Is it certain?", [{ blockId: "spya-zzzzzz", quote: "x" }]),
            q("Does it hold?", [{ blockId: A.id, quote: "Things fall a part" }]),
          ],
        },
        o,
      ),
    ).toThrow(/named 2 questions.*2 with no usable passage, 1 passages naming a block id.*1 whose quote/);
  });
});

/* ------------------------------------------------------------ the request -- */

/** The real `example/` fixture: a tree, blocks and metadata the stages accept. */
let example: Article;
beforeAll(async () => {
  const { readArticleFromDir } = await import("./helpers/article-from-dir.js");
  example = await readArticleFromDir(path.resolve(import.meta.dirname, "..", "example"));
});

describe("the request", () => {
  it("is Ideas' byte for byte up to the breakpoint, and hashes the real null meta", async () => {
    const article: Article = { ...example, meta: null };
    const quotable = article.blocks.find((b) => b.text.split(/\s+/).length > 8);
    if (!quotable) throw new Error("the fixture has no block long enough to quote");
    const words = quotable.text.split(/\s+/).slice(0, 6).join(" ");
    answer = JSON.stringify({
      questions: [q("Why does this follow?", [{ blockId: quotable.id, quote: words }])],
    });
    const run = await generateFaq({ article, cacheArticle: true });

    answer = JSON.stringify({
      ideas: [
        {
          name: "Entropy rises",
          provenance: "introduced",
          statement: "It does.",
          occurrences: [{ blockId: quotable.id, quote: words }],
        },
      ],
    });
    const { generateIdeas } = await import("../src/ideas.js");
    await generateIdeas({ article, previous: null, cacheArticle: true });

    const [faqCall, ideasCall] = sent;
    expect(faqCall?.task).toBe("faq");
    const system = (c: typeof faqCall) => (c?.body as { system: unknown[] }).system;
    expect(system(faqCall)[0]).toEqual(system(ideasCall)[0]);
    expect(system(faqCall)[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(system(faqCall)[1]).toEqual({ type: "text", text: FAQ_SYSTEM });

    expect(run.faq.sourceHash).toBe(articleWithIdsFingerprint(article.blocks, article.tree, null));
    expect(run.faq.questions).toHaveLength(1);
  });

  it("is in the ids cache group with ideas, timeline, quiz and sketch, and no other", () => {
    expect(sharesArticleCache("faq", ["ideas"])).toBe(true);
    expect(sharesArticleCache("quiz", ["faq"])).toBe(true);
    expect(sharesArticleCache("faq", ["arc", "tweets", "glossary", "quotes"])).toBe(false);
    /* And contiguous with them in `STEP_ORDER`. */
    const at = (s: (typeof STEP_ORDER)[number]) => STEP_ORDER.indexOf(s);
    expect(at("faq")).toBe(at("quiz") + 1);
    expect(at("sketch")).toBe(at("faq") + 1);
  });

  it("offers an upper budget, never a floor, and sizes the answer from the caps", () => {
    expect(questionBudget(0)).toBe(1);
    expect(questionBudget(1_800)).toBe(3);
    expect(questionBudget(100_000)).toBe(MAX_QUESTIONS);
    expect(ANSWER_TOKENS).toBeGreaterThan(MAX_QUESTIONS * 400);
    expect(FAQ_SYSTEM).toMatch(/None is fine/);
    expect(FAQ_SYSTEM).toMatch(/plainer than the article, never further from it/);
  });
});

/* ----------------------------------------------------------- the spending -- */

describe("forcing", () => {
  it("is not swept in by an earlier forced step", () => {
    expect(FORCE_ONLY_WHEN_NAMED.has("faq")).toBe(true);
    expect(cascadeForce([...STEP_ORDER], new Set(["fetch"])).has("faq")).toBe(false);
    expect(cascadeForce(["ideas", "quiz", "faq"], new Set(["ideas"])).has("faq")).toBe(false);
    /* Named, it is forced like anything else. */
    expect(cascadeForce(["ideas", "faq"], new Set(["faq"])).has("faq")).toBe(true);
  });
});
