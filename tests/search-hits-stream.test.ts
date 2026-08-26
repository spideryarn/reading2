/**
 * `hitExtractor` in src/search-hits-stream.ts — the brace counter that turns
 * the search model's one streamed JSON object into hits the panel can show
 * as they arrive, rather than after the whole reply lands.
 *
 * The thing every test here is really checking: whatever `push` is fed, and
 * however it's chopped up, the extractor either emits a hit that is exactly
 * what a whole-response `JSON.parse` would have produced for that element,
 * or it emits nothing for it. Never something else, never something twice.
 */
import { describe, expect, it } from "vitest";
import { hitExtractor } from "../src/search-hits-stream.js";

/** A realistic reply: preamble, a code fence, and hits exercising the tricky bits. */
function buildResponse() {
  const hits = [
    {
      blockId: "spya-abc123",
      // Braces inside a string must not open or close anything.
      quote: "the set { a, b, c } has three members",
      confidence: 90,
      reasoning: "mentions a set written with braces { like this }",
    },
    {
      blockId: "spya-def456",
      // A quote character inside the string, escaped — must not end the string.
      quote: 'he called it "the wet hardware" problem',
      confidence: 70,
      reasoning: "direct quote",
    },
    {
      blockId: "spya-ghi789",
      // Two literal backslashes right before the closing quote: raw JSON has
      // four backslash characters here. An off-by-one on the escape flag
      // would read the fourth as escaping the closing quote and run the
      // string past it.
      quote: "a path like C:\\\\",
      confidence: 60,
      reasoning: "escape test",
    },
    {
      blockId: "spya-jkl012",
      quote: "an emoji in the wild 🔥 right there",
      confidence: 55,
      reasoning: "unicode test",
    },
    {
      blockId: "spya-nest01",
      quote: "a hit with a nested object in it",
      confidence: 40,
      reasoning: "nested object test",
      // Not part of the prompt's contract, but if it ever showed up this
      // must not itself be emitted as a second hit.
      meta: { note: "nested, should not be emitted separately" },
    },
  ];
  const raw = `Here you go:\n\`\`\`json\n${JSON.stringify({ hits })}\n\`\`\`\n`;
  return { hits, raw };
}

describe("hitExtractor", () => {
  it("extracts every hit when fed the whole response in one push", () => {
    const { hits, raw } = buildResponse();
    const ex = hitExtractor();
    const out = ex.push(raw);
    expect(out).toEqual(hits);
    expect(ex.text()).toBe(raw);
  });

  it("braces inside a quoted string do not affect nesting", () => {
    const { raw } = buildResponse();
    const ex = hitExtractor();
    const [first] = ex.push(raw);
    expect((first as { quote: string }).quote).toBe("the set { a, b, c } has three members");
  });

  it("an escaped quote inside a string does not end it", () => {
    const { raw } = buildResponse();
    const ex = hitExtractor();
    const out = ex.push(raw);
    const second = out[1] as { quote: string };
    expect(second.quote).toBe('he called it "the wet hardware" problem');
  });

  it("a run of backslashes right before the closing quote is read correctly", () => {
    const { raw } = buildResponse();
    const ex = hitExtractor();
    const out = ex.push(raw);
    const third = out[2] as { quote: string };
    expect(third.quote).toBe("a path like C:\\\\");
  });

  it("does not emit a nested object inside a hit as its own hit", () => {
    const { raw } = buildResponse();
    const ex = hitExtractor();
    const out = ex.push(raw);
    expect(out).toHaveLength(5);
    expect((out[4] as { meta: unknown }).meta).toEqual({
      note: "nested, should not be emitted separately",
    });
  });

  it("does not emit the outer response object itself", () => {
    const { raw } = buildResponse();
    const ex = hitExtractor();
    const out = ex.push(raw);
    for (const item of out) {
      expect(item).not.toHaveProperty("hits");
    }
  });

  it("ignores prose before the object and the ```json fence", () => {
    const raw = 'Sure, here are the matches:\n```json\n{"hits": [{"blockId":"spya-a","quote":"q","confidence":10,"reasoning":"r"}]}\n```';
    const ex = hitExtractor();
    const out = ex.push(raw);
    expect(out).toEqual([{ blockId: "spya-a", quote: "q", confidence: 10, reasoning: "r" }]);
  });

  it("produces the same hits, in the same order, character by character as fed whole", () => {
    const { hits, raw } = buildResponse();
    const ex = hitExtractor();
    const out: unknown[] = [];
    for (const ch of Array.from(raw)) {
      out.push(...ex.push(ch));
    }
    expect(out).toEqual(hits);
    expect(ex.text()).toBe(raw);
  });

  it("produces the same hits when split at a fixed, non-random set of points", () => {
    const { hits, raw } = buildResponse();
    // Picked by hand to land inside a string, on a brace, mid-escape, and
    // mid-surrogate-pair (see the unicode test below for that one on its
    // own) — not evenly spaced, and not derived from Math.random().
    const splits = [0, 1, 3, 7, 12, 12, 20, 33, 41, 55, 89, 90, 91, 100, 130, 150, 200, 250, raw.length];
    const ex = hitExtractor();
    const out: unknown[] = [];
    let at = 0;
    for (const to of splits) {
      if (to <= at) continue;
      out.push(...ex.push(raw.slice(at, to)));
      at = to;
    }
    if (at < raw.length) out.push(...ex.push(raw.slice(at)));
    expect(out).toEqual(hits);
    expect(ex.text()).toBe(raw);
  });

  it("emits nothing twice, regardless of chunking", () => {
    const { hits, raw } = buildResponse();
    const ex = hitExtractor();
    const seen: unknown[] = [];
    // Feed it in small fixed-size chunks.
    for (let i = 0; i < raw.length; i += 3) {
      seen.push(...ex.push(raw.slice(i, i + 3)));
    }
    expect(seen).toHaveLength(hits.length);
    expect(seen).toEqual(hits);
  });

  it("emits nothing for a trailing partial object at end of stream", () => {
    const { hits, raw } = buildResponse();
    // Cut off partway through the last hit's object, before its closing brace.
    const cutAt = raw.lastIndexOf('"nested, should not be emitted separately"');
    const truncated = raw.slice(0, cutAt + 10);
    const ex = hitExtractor();
    const out = ex.push(truncated);
    // The four complete hits before the cut arrived; the fifth, unfinished,
    // did not.
    expect(out).toEqual(hits.slice(0, 4));
    // Nothing is lost: the caller still has every character fed to it, for
    // the final strict parse.
    expect(ex.text()).toBe(truncated);
  });

  it("does not corrupt a surrogate pair split across a chunk boundary", () => {
    const { hits, raw } = buildResponse();
    const emojiIndex = raw.indexOf("🔥");
    // Split right between the emoji's two UTF-16 code units.
    const splitAt = emojiIndex + 1;
    const ex = hitExtractor();
    const out = [...ex.push(raw.slice(0, splitAt)), ...ex.push(raw.slice(splitAt))];
    expect(out).toEqual(hits);
    const fourth = out[3] as { quote: string };
    expect(fourth.quote).toBe("an emoji in the wild 🔥 right there");
  });

  it("returns an empty array of hits for {\"hits\": []}", () => {
    const ex = hitExtractor();
    const out = ex.push('{"hits": []}');
    expect(out).toEqual([]);
    expect(ex.text()).toBe('{"hits": []}');
  });

  it("ignores anything after the outer object closes", () => {
    const raw =
      '{"hits": [{"blockId":"spya-a","quote":"q","confidence":10,"reasoning":"r"}]}\n\nHope that helps! Here is a stray brace: }';
    const ex = hitExtractor();
    const out = ex.push(raw);
    expect(out).toEqual([{ blockId: "spya-a", quote: "q", confidence: 10, reasoning: "r" }]);
  });

  /**
   * The defect GPT Sol found: a sibling array is not the hits array, however
   * it is positioned. The old version keyed off "the first `[` one level
   * inside the outer object", which made objects inside `notes` stream as
   * hits — not a late hit, a WRONG one, since the reader would see a
   * highlight the authoritative result never contained.
   */
  describe("only the array whose key is literally `hits`", () => {
    it("ignores an array under an earlier sibling key", () => {
      const validHit = { blockId: "spya-real1", quote: "the real hit", confidence: 80, reasoning: "r" };
      const raw = JSON.stringify({
        notes: [{ blockId: "spya-fake1", quote: "not a hit", confidence: 99, reasoning: "decoy" }],
        hits: [validHit],
      });
      const ex = hitExtractor();
      const out = ex.push(raw);
      expect(out).toEqual([validHit]);
    });

    it("ignores an array under a LATER sibling key too — position alone never decides it", () => {
      const validHit = { blockId: "spya-real2", quote: "the real hit", confidence: 80, reasoning: "r" };
      const raw = JSON.stringify({
        hits: [validHit],
        notes: [{ blockId: "spya-fake2", quote: "not a hit", confidence: 99, reasoning: "decoy" }],
      });
      const ex = hitExtractor();
      const out = ex.push(raw);
      expect(out).toEqual([validHit]);
    });

    it("is not fooled by the word \"hits\" appearing as some OTHER key's value", () => {
      // The real `"hits"` key still closes, immediately before the real
      // array, overwriting whatever this unrelated value left behind — see
      // the module docstring.
      const validHit = { blockId: "spya-real3", quote: "the real hit", confidence: 80, reasoning: "r" };
      const raw = JSON.stringify({ notes: "hits", hits: [validHit] });
      const ex = hitExtractor();
      const out = ex.push(raw);
      expect(out).toEqual([validHit]);
    });

    it("still finds the key when it arrives split across a chunk boundary", () => {
      const validHit = { blockId: "spya-real4", quote: "the real hit", confidence: 80, reasoning: "r" };
      const raw = JSON.stringify({
        notes: [{ blockId: "spya-fake4", quote: "not a hit", confidence: 99, reasoning: "decoy" }],
        hits: [validHit],
      });
      // Split right inside the literal `"hits"` key itself.
      const splitAt = raw.indexOf('"hits"') + 3;
      const ex = hitExtractor();
      const out = [...ex.push(raw.slice(0, splitAt)), ...ex.push(raw.slice(splitAt))];
      expect(out).toEqual([validHit]);
    });
  });
});
