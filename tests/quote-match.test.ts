/**
 * The quote matcher — src/quote-match.ts.
 *
 * Worth testing where most string handling is not, because **every way this can
 * be wrong is silent**. A quote that fails to match draws the wash over a whole
 * paragraph instead of a sentence; a quote that matches at the wrong offset
 * draws it over the wrong words. Neither throws, neither logs, and both look
 * like a styling problem rather than a text problem. See
 * docs/reusable/silent-success.md.
 *
 * The cases below are the four real differences between the string the model is
 * shown (`block.text`) and the string the browser renders — see the header of
 * the module — plus the offset-mapping arithmetic that turns a match in the
 * reduced space back into a span in the real one, which is the part with actual
 * arithmetic in it.
 */
import { describe, expect, it } from "vitest";
import { findQuote, quoteAppears, quoteFinder, snippet } from "../src/quote-match.js";

describe("findQuote", () => {
  it("finds an exact quote and reports its real offsets", () => {
    const text = "He rejects the idea that mind is software running on wet hardware.";
    const span = findQuote(text, "mind is software");
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toBe("mind is software");
  });

  it("finds a quote at the very start and the very end", () => {
    const text = "Alpha beta gamma";
    expect(findQuote(text, "Alpha")).toEqual({ start: 0, end: 5 });
    expect(findQuote(text, "gamma")).toEqual({ start: 11, end: 16 });
  });

  it("returns null when the quote is simply not there", () => {
    expect(findQuote("Alpha beta", "gamma")).toBeNull();
    expect(quoteAppears("Alpha beta", "gamma")).toBe(false);
  });

  it("returns null for an empty quote rather than matching at 0", () => {
    // A zero-length match at offset 0 would wash nothing and look like a bug in
    // whatever produced the empty string, three layers away.
    expect(findQuote("Alpha beta", "")).toBeNull();
    expect(findQuote("Alpha beta", "   ")).toBeNull();
  });

  /* The model retypes the quote rather than copying bytes, so all four of these
     are ordinary rather than exotic. */

  it("ignores case", () => {
    const text = "The Hard Problem is not the easy one.";
    expect(findQuote(text, "the hard problem")).toEqual({ start: 0, end: 16 });
  });

  it("collapses a run of whitespace in either string", () => {
    const text = "a line\n   broken   across two";
    const span = findQuote(text, "a line broken across two");
    expect(span).toEqual({ start: 0, end: text.length });
  });

  it("matches a curly apostrophe against a straight one, and back", () => {
    const curly = "Seth’s account of the self";
    expect(findQuote(curly, "Seth's account")).not.toBeNull();
    expect(findQuote("Seth's account of the self", "Seth’s account")).not.toBeNull();
  });

  it("matches an em dash against a hyphen", () => {
    expect(findQuote("feeling — not thinking", "feeling - not thinking")).not.toBeNull();
  });

  /**
   * The case the second pass exists for, and the one nobody would guess.
   *
   * `extractText` inserts a space at every nested block boundary, so a
   * paragraph containing a `<blockquote>` reads `…carbon. Living…` to the model
   * and `…carbon.Living…` to `Range.toString()`. The needle then has a space
   * the haystack cannot supply, and the careful pass rightly fails.
   */
  it("matches across a space the rendered text does not have", () => {
    const rendered = "about carbon.Living things are";
    const asTheModelSawIt = "carbon. Living things";
    const span = findQuote(rendered, asTheModelSawIt);
    expect(span).not.toBeNull();
    expect(rendered.slice(span!.start, span!.end)).toBe("carbon.Living things");
  });

  it("does not let the forgiving pass run when the careful one succeeds", () => {
    // "in the" appears twice with different spacing. The whitespace-preserving
    // pass finds the right one; a whitespace-stripping pass alone would be free
    // to match inside "inthe" first.
    const text = "in the beginning, and in the end";
    const span = findQuote(text, "in the end");
    expect(text.slice(span!.start, span!.end)).toBe("in the end");
  });

  /**
   * **One source character can become more than one, and the map used to
   * assume it could not.**
   *
   * `reduce` lowercases as it goes, and `"İ".toLowerCase()` is two code units.
   * The old loop pushed one map entry per *input* code unit, so from that
   * character onward `value` and `map` were out of step — and `findQuote`
   * returned a span an entire sentence too short. Nothing errored: the caller
   * in src/quotes.ts sliced the block by that span and stored `"T"` as a
   * verbatim quotation of the author, with no drop counted.
   *
   * Found by GPT Sol reviewing the built quotes stage, 2026-08-31, with this
   * exact string.
   */
  describe("characters that do not fold one-to-one", () => {
    it("spans the whole sentence when a character lowercases to two", () => {
      const text = "This sufficiently long sentence ends in İstanbul";
      const span = findQuote(text, text);
      expect(span).not.toBeNull();
      expect(text.slice(span!.start, span!.end)).toBe(text);
    });

    it("matches a needle typed in the other case, and still spans it all", () => {
      const text = "The city of İstanbul sits on two continents entirely.";
      const span = findQuote(text, "the city of İSTANBUL sits on two continents entirely.");
      expect(span).not.toBeNull();
      expect(text.slice(span!.start, span!.end)).toBe(text);
    });

    /* An astral character is a surrogate pair, so its end is `start + 2`. The
       arithmetic version of `endOf` cut it in half and produced a lone
       surrogate — a string that will not even render. */
    it("does not cut a surrogate pair in half at the end of a span", () => {
      const text = "A sentence that finishes on an emoji, right here 🎉";
      const span = findQuote(text, text);
      expect(span).not.toBeNull();
      const got = text.slice(span!.start, span!.end);
      expect(got).toBe(text);
      expect(got.endsWith("🎉")).toBe(true);
    });

    it("keeps the fold's own characters intact mid-span", () => {
      const text = "Straße is spelled with an eszett, which lowercases to itself.";
      const span = findQuote(text, text);
      expect(text.slice(span!.start, span!.end)).toBe(text);
    });
  });

  describe("choosing between repeats", () => {
    const text = "the self, and later the self again";

    it("takes the first occurrence when given no hint", () => {
      expect(findQuote(text, "the self")).toEqual({ start: 0, end: 8 });
    });

    it("takes the occurrence nearest the hint", () => {
      expect(findQuote(text, "the self", 20)).toEqual({ start: 20, end: 28 });
    });

    /**
     * The hint is a *disambiguator, never the anchor* — the rule from
     * docs/project/block-ids.md. A hint that points at nothing must not stop
     * the quote being found; it just stops helping.
     */
    it("still finds the quote when the hint is nonsense", () => {
      expect(findQuote(text, "the self", 9999)).toEqual({ start: 20, end: 28 });
      expect(findQuote(text, "the self", -5)).toEqual({ start: 0, end: 8 });
    });

    /**
     * The hint is compared in the **original** offset space, not the reduced
     * one. With whitespace collapsed ahead of it the two drift apart, and
     * comparing across them would pick the wrong repeat while looking correct.
     */
    it("compares the hint against real offsets, not reduced ones", () => {
      const spaced = "the self,          and later the self again";
      const second = spaced.lastIndexOf("the self");
      expect(findQuote(spaced, "the self", second)).toEqual({
        start: second,
        end: second + 8,
      });
    });
  });

  it("does not include trailing whitespace in the span", () => {
    const text = "alpha beta   gamma";
    const span = findQuote(text, "beta   ");
    expect(text.slice(span!.start, span!.end)).toBe("beta");
  });
});

/**
 * **One haystack, many needles** — the same search with the expensive half done
 * once.
 *
 * `findQuote` reduces the whole text on every call, which is right for one
 * question and quadratic for a caller asking thousands. src/shingles.ts asks
 * 2,455 of them of one page's extract, and that cost 8 seconds a row before
 * this existed.
 *
 * **The only thing worth testing is that it is the same function**, because a
 * faster matcher that answers differently is the exact shape of failure
 * docs/reusable/silent-success.md is about — the rows would still appear, with
 * quieter evidence on them.
 */
describe("quoteFinder", () => {
  const cases: [string, string][] = [
    ["He rejects the idea that mind is software.", "mind is software"],
    ["The Hard Problem is not the easy one.", "hard problem"],
    ["a line\nbroken   oddly across   several spaces", "line broken oddly"],
    ["it will fall apart in the end", "fall a part"],
    ["Alpha beta gamma", "gamma"],
    ["Alpha beta", "delta"],
    ["", "anything"],
    ["Alpha beta", ""],
    ["\u201cQuoted\u201d and em\u2014dashed", '"Quoted" and em-dashed'],
  ];

  it("answers exactly as findQuote does, in both modes", () => {
    for (const [text, quote] of cases) {
      for (const passes of ["forgiving", "spaced"] as const) {
        expect(quoteFinder(text, passes)(quote)).toEqual(findQuote(text, quote, undefined, passes));
      }
    }
  });

  it("takes the same hint, and takes it per question", () => {
    const text = "the same words, and later the same words again";
    const finder = quoteFinder(text);
    expect(finder("the same words", 30)).toEqual(findQuote(text, "the same words", 30));
    /* The haystack is prepared once; the hint is not part of it. */
    expect(finder("the same words")).toEqual(findQuote(text, "the same words"));
  });
});

describe("snippet", () => {
  const text = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi";

  it("returns the whole text, unmarked, when it fits", () => {
    expect(snippet("Short enough.", { start: 0, end: 5 }, 200)).toBe("Short enough.");
  });

  it("marks both cuts when it takes a slice from the middle", () => {
    const at = text.indexOf("theta");
    const out = snippet(text, { start: at, end: at + 5 }, 20);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toContain("theta");
  });

  it("does not put an opening ellipsis on a slice that starts at the start", () => {
    const out = snippet(text, { start: 0, end: 5 }, 20);
    expect(out.startsWith("…")).toBe(false);
    expect(out.endsWith("…")).toBe(true);
  });

  it("keeps the whole span even when it is longer than the budget", () => {
    // A budget smaller than the quote must not cut the quote in half — the
    // quote is the thing being shown.
    const out = snippet(text, { start: 0, end: text.length }, 5);
    expect(out).toBe(text);
  });
});
