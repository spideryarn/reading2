/**
 * The validation half of semantic search — `validateHits` and `parseHits` in
 * src/search.ts.
 *
 * The model call itself is not tested and deliberately is not: it is a network
 * request whose answer is a judgment, and a test that asserted what a model
 * says about a paragraph would be asserting today's weather. What *is* tested
 * is everything between the model's answer and the disk, because that is where
 * this feature can be wrong without anybody noticing.
 *
 * The thing to hold on to: **an empty result is a legitimate answer here.**
 * "Nothing in this article matches that" is something a reader sees and
 * believes. So every way a good answer could be silently reduced to an empty
 * one — a parse failure, a hallucinated id, a paraphrased quote — has a test,
 * and each of them is also counted in the log line for the same reason.
 * docs/reusable/silent-success.md.
 */
import { describe, expect, it } from "vitest";
import { MAX_HITS, parseHits, validateHits } from "../src/search.js";
import type { Block } from "../src/types.js";

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const BLOCKS = [
  block("spya-k3m9qt", "He rejects the idea that mind is software running on wet hardware."),
  block("spya-p7w2dn", "A thermostat has no interior. There is nothing it is like to be one."),
];

const hit = (over: Record<string, unknown> = {}) => ({
  blockId: "spya-k3m9qt",
  quote: "mind is software",
  confidence: 85,
  reasoning: "States the position being rejected.",
  ...over,
});

describe("parseHits", () => {
  it("reads a bare JSON object", () => {
    expect(parseHits('{"hits":[]}')).toEqual({ hits: [] });
  });

  it("reads one wrapped in a code fence", () => {
    expect(parseHits('```json\n{"hits":[]}\n```')).toEqual({ hits: [] });
  });

  it("reads one with a preamble in front of it", () => {
    // Told "JSON and nothing else", a model still sometimes says "Here you go:".
    // Losing a good answer to a politeness would be a silly way to fail.
    expect(parseHits('Here you go:\n{"hits":[]}')).toEqual({ hits: [] });
  });

  /**
   * The two failures that must be loud.
   *
   * Returning `{hits: []}` for either would store an empty result that looks
   * exactly like "nothing in this article matches" — the one failure a reader
   * could not possibly diagnose, and the one this whole file is about.
   */
  it("throws rather than returning nothing when there is no object at all", () => {
    expect(() => parseHits("I could not find anything.")).toThrow(/JSON object/);
  });

  it("throws on an object that is there but malformed", () => {
    expect(() => parseHits('{"hits": [oops]}')).toThrow(/not valid JSON/);
  });

  it("says a truncated answer was cut off, not that there was no answer", () => {
    // What a response cut off by `max_tokens` looks like: valid up to the point
    // it stops. It is the most likely real failure here, because the answer's
    // size grows with the hit count and nothing else — so it gets its own
    // sentence rather than being reported as a missing object.
    expect(() => parseHits('{"hits":[{"blockId":"spya-k3m9qt","quo')).toThrow(/cut off/);
  });
});

describe("validateHits", () => {
  it("keeps a good hit and records nothing dropped", () => {
    const { hits, dropped } = validateHits({ hits: [hit()] }, BLOCKS);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ blockId: "spya-k3m9qt", confidence: 85 });
    expect(dropped).toEqual({ unknownIds: 0, unquoted: 0, clamped: 0, subOne: 0, truncated: 0 });
  });

  it("records where the quote sits, so a repeat can be told from its twin later", () => {
    const { hits } = validateHits({ hits: [hit()] }, BLOCKS);
    const text = BLOCKS[0]!.text;
    expect(text.slice(hits[0]!.start!, hits[0]!.start! + hits[0]!.quote.length)).toBe(
      hits[0]!.quote,
    );
  });

  /**
   * The article's own words, not the model's retyping of them.
   *
   * `findQuote` is forgiving about whitespace and curly quotes, so the two can
   * differ — and storing the model's version would mean the stored quote does
   * not appear in the article, which is precisely the property this validation
   * exists to guarantee for the client.
   */
  it("stores the block's own characters, not the model's version of them", () => {
    const curly = block("spya-w4x8bn", "Seth’s account — the interoceptive one — is different.");
    const { hits } = validateHits(
      { hits: [hit({ blockId: "spya-w4x8bn", quote: "Seth's account - the interoceptive one" })] },
      [curly],
    );
    expect(hits[0]!.quote).toBe("Seth’s account — the interoceptive one");
    expect(curly.text).toContain(hits[0]!.quote);
  });

  it("drops a hit naming a block this article does not have, and counts it", () => {
    const { hits, dropped } = validateHits({ hits: [hit({ blockId: "spya-zzzzzz" })] }, BLOCKS);
    expect(hits).toHaveLength(0);
    expect(dropped.unknownIds).toBe(1);
  });

  it("drops a hit whose quote is not in the block it named, and counts it", () => {
    // A paraphrase rather than a quote. The reader would get a highlight over
    // the whole paragraph or over nothing, with no way to know why.
    const { hits, dropped } = validateHits(
      { hits: [hit({ quote: "he thinks minds need bodies" })] },
      BLOCKS,
    );
    expect(hits).toHaveLength(0);
    expect(dropped.unquoted).toBe(1);
  });

  it("drops a hit whose quote is in a *different* block from the one it named", () => {
    const { hits, dropped } = validateHits(
      { hits: [hit({ blockId: "spya-p7w2dn", quote: "mind is software" })] },
      BLOCKS,
    );
    expect(hits).toHaveLength(0);
    expect(dropped.unquoted).toBe(1);
  });

  describe("the confidence unit", () => {
    it("clamps a value above 100 and counts the clamp", () => {
      const { hits, dropped } = validateHits({ hits: [hit({ confidence: 140 })] }, BLOCKS);
      expect(hits[0]!.confidence).toBe(100);
      expect(dropped.clamped).toBe(1);
    });

    it("clamps a negative one", () => {
      const { hits, dropped } = validateHits({ hits: [hit({ confidence: -3 })] }, BLOCKS);
      expect(hits[0]!.confidence).toBe(0);
      expect(dropped.clamped).toBe(1);
    });

    /**
     * **The unit-drift alarm.** A model answering in 0–1 rather than 0–100 is
     * the exact bug the version this is borrowed from shipped, and the point of
     * the test is what does *not* happen: the value is not rescaled. Rescaling
     * is a guess about which unit was meant, and a confident wrong guess paints
     * the whole article at the wrong intensity with nothing to see. Counting it
     * makes it findable in a log line instead.
     */
    it("counts a fractional confidence without rescaling it", () => {
      const { hits, dropped } = validateHits({ hits: [hit({ confidence: 0.85 })] }, BLOCKS);
      expect(dropped.subOne).toBe(1);
      expect(hits[0]!.confidence).toBe(1);
    });

    it("assumes the middle when the model gives no number at all", () => {
      const { hits } = validateHits({ hits: [hit({ confidence: undefined })] }, BLOCKS);
      expect(hits[0]!.confidence).toBe(50);
    });
  });

  it("caps the list and says how many it dropped", () => {
    const many = Array.from({ length: MAX_HITS + 5 }, () => hit());
    const { hits, dropped } = validateHits({ hits: many }, BLOCKS);
    expect(hits).toHaveLength(MAX_HITS);
    // A silent cap reads as "that is everything there was". Counting it is what
    // makes it a decision rather than a disappearance.
    expect(dropped.truncated).toBe(5);
  });

  it("survives a reply with the wrong shape entirely", () => {
    for (const junk of [{}, { hits: null }, { hits: "nope" }, [], null]) {
      expect(validateHits(junk, BLOCKS).hits).toEqual([]);
    }
  });

  it("skips a hit that is not an object without taking the rest down with it", () => {
    const { hits } = validateHits({ hits: [null, "nope", hit()] }, BLOCKS);
    expect(hits).toHaveLength(1);
  });
});
