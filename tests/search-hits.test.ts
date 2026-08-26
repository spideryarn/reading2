// @vitest-environment jsdom
/**
 * Turning a search into a list and marks — src/web/search-hits.ts.
 *
 * jsdom rather than the default node environment, for the reason
 * tests/annotate.test.ts gives: the offset space these spans live in is
 * *the browser's*, defined by the concatenation of a block's text nodes. A
 * hand-rolled equivalent tested in node would pass against itself and disagree
 * with Chrome.
 *
 * The property this file is really guarding is that **the panel and the prose
 * agree**. Both are computed from one `Found[]`, so a test that the list has
 * three rows and the marks cover three spans is a test that the reader is not
 * being told two different things.
 */
import { describe, expect, it } from "vitest";
import {
  blockStrength,
  findLiteral,
  hitMarks,
  MIN_FIND_CHARS,
  orderFound,
  resolveHits,
  type Found,
} from "../src/web/search-hits.js";
import type { Block, SearchHit } from "../src/types.js";

const block = (id: string, html: string, text?: string): Block => {
  const stripped = text ?? html.replace(/<[^>]+>/g, "");
  return {
    id,
    tag: "p",
    kind: "text",
    text: stripped,
    words: stripped.split(/\s+/).length,
    html,
    gistable: true,
  };
};

const BLOCKS = [
  block("spya-k3m9qt", "<p>He rejects the idea that mind is <em>software</em> running on wet hardware.</p>"),
  block("spya-p7w2dn", "<p>A thermostat has no interior at all.</p>"),
  block("spya-w4x8bn", "<p>Software is not the same as mind.</p>"),
];

describe("findLiteral", () => {
  it("finds every occurrence, in every block, case-insensitively", () => {
    const found = findLiteral(BLOCKS, "software");
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.blockId)).toEqual(["spya-k3m9qt", "spya-w4x8bn"]);
  });

  it("finds several occurrences within one block", () => {
    const found = findLiteral([block("spya-k3m9qt", "<p>the self, and later the self</p>")], "the self");
    expect(found).toHaveLength(2);
    expect(found[0]!.start).toBeLessThan(found[1]!.start);
  });

  /**
   * A match that spans an inline element is the case a naive implementation
   * gets wrong — `"mind is software"` crosses into an `<em>`, and there is no
   * substring of the *markup* that contains it. Working on the rendered text is
   * what makes it fall out.
   */
  it("matches across an inline tag", () => {
    const found = findLiteral(BLOCKS, "mind is software running");
    expect(found).toHaveLength(1);
    expect(found[0]!.blockId).toBe("spya-k3m9qt");
  });

  it("matches inside a longer word, because find-on-page does", () => {
    // Deliberately not the glossary's word-boundary rule. This is find-on-page,
    // and find-on-page has a meaning readers already hold.
    expect(findLiteral([block("spya-k3m9qt", "<p>thermostatic</p>")], "thermo")).toHaveLength(1);
  });

  it("finds nothing for a query too short to be a search", () => {
    expect(findLiteral(BLOCKS, "a")).toEqual([]);
    expect(findLiteral(BLOCKS, "")).toEqual([]);
    expect(findLiteral(BLOCKS, null)).toEqual([]);
    expect(MIN_FIND_CHARS).toBe(2);
  });

  it("reports no confidence rather than a made-up one", () => {
    // A literal match either is the text you typed or is not. Putting 100 on it
    // would print a number beside a meaning-hit's number that means something
    // different.
    expect(findLiteral(BLOCKS, "software")[0]!.confidence).toBeNull();
    expect(findLiteral(BLOCKS, "software")[0]!.reasoning).toBeNull();
  });

  it("gives every result a key unique within the set", () => {
    const found = findLiteral(BLOCKS, "the");
    expect(new Set(found.map((f) => f.key)).size).toBe(found.length);
  });
});

describe("resolveHits", () => {
  const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
    blockId: "spya-k3m9qt",
    quote: "mind is software",
    confidence: 85,
    reasoning: "why",
    ...over,
  });

  it("finds the model's quote in the rendered prose", () => {
    const [found] = resolveHits(BLOCKS, [hit()]);
    expect(found!.whole).toBe(false);
    expect(found!.confidence).toBe(85);
    expect(found!.end - found!.start).toBe("mind is software".length);
  });

  /**
   * The `whole` fallback, which is a fallback and not a failure.
   *
   * The model named a block and said why, and that much is still true when the
   * exact words have moved. Marking nothing throws away a good answer over a
   * whitespace difference; marking the wrong words is worse than either.
   */
  it("marks the whole block when the quote cannot be found, and says so", () => {
    const [found] = resolveHits(BLOCKS, [hit({ quote: "words that are not there" })]);
    expect(found!.whole).toBe(true);
    expect(found!.start).toBe(0);
    expect(found!.end).toBeGreaterThan(0);
  });

  /**
   * The regression that real data found on the day this was built.
   *
   * A quote that happens to be the *whole block* produces a span with exactly
   * the shape the not-found fallback produces, so the first version told them
   * apart by comparing the quote against the block's text — and the model had
   * retyped a line break as a space, so a perfectly good exact match was
   * reported as "the exact words have moved".
   *
   * The fix is to stop inferring: `findQuote` already says whether it found
   * anything, and that answer is the only thing allowed to decide this. A
   * derived fact that *usually* agrees with a known one is the shape of most of
   * the bugs in docs/reusable/silent-success.md.
   */
  it("does not call a whole-block quote a fallback just because it covers the block", () => {
    const one = [block("spya-k3m9qt", "<p>Not anymore. AI has blown this\nworld open.</p>")];
    const [found] = resolveHits(one, [
      // As the model retypes it: the newline has become a space.
      hit({ quote: "Not anymore. AI has blown this world open." }),
    ]);
    expect(found!.whole).toBe(false);
    expect(found!.start).toBe(0);
  });

  it("drops a hit naming a block the article no longer has", () => {
    // Only reachable after a re-extraction. An id that is simply gone has
    // nowhere to point, and a row that does nothing when pressed is worse than
    // no row.
    expect(resolveHits(BLOCKS, [hit({ blockId: "spya-zzzzzz" })])).toEqual([]);
  });

  it("keeps two hits that quote the same words apart", () => {
    const found = resolveHits(BLOCKS, [hit(), hit({ reasoning: "a different reason" })]);
    expect(found).toHaveLength(2);
    expect(found[0]!.key).not.toBe(found[1]!.key);
  });

  it("carries the model's reasoning through untouched", () => {
    const [found] = resolveHits(BLOCKS, [hit({ reasoning: "States the position rejected." })]);
    expect(found!.reasoning).toBe("States the position rejected.");
  });
});

/**
 * Where in the article a result falls — the second thing every row shows, and
 * the only thing a literal result shows besides its words.
 *
 * The property worth guarding is that the ruler is **characters, not blocks**.
 * A block-index denominator is the obvious implementation and it is wrong in a
 * way nobody would notice by looking: an article whose last third is twenty
 * one-line list items would report a hit in its long opening paragraph as
 * halfway through, because half the *blocks* are behind it.
 */
describe("where in the article", () => {
  /* A local factory: the one in `resolveHits` above is scoped to that block,
     and reaching for it would tie two describes together for four characters. */
  const modelHit = (over: Partial<SearchHit> = {}): SearchHit => ({
    blockId: "spya-k3m9qt",
    quote: "mind is software",
    confidence: 85,
    reasoning: "why",
    ...over,
  });

  it("puts the first words at the start and the last at the end", () => {
    const blocks = [
      block("spya-k3m9qt", "<p>alpha and more words here</p>"),
      block("spya-p7w2dn", "<p>middle of the piece entirely</p>"),
      block("spya-w4x8bn", "<p>and finally omega</p>"),
    ];
    const [first] = findLiteral(blocks, "alpha");
    const [last] = findLiteral(blocks, "omega");
    expect(first!.at).toBeLessThan(0.1);
    expect(last!.at).toBeGreaterThan(0.85);
  });

  /* `"e"` was the query here first, which searches for nothing at all —
     `MIN_FIND_CHARS` rejects a single character, so the loop ran zero times and
     the assertion was never reached. A test that cannot fail. Caught by a GPT
     Sol review, 2026-08-26. */
  it("is always between 0 and 1, over a query that matches a lot", () => {
    const found = findLiteral(BLOCKS, "he");
    expect(found.length).toBeGreaterThan(1);
    for (const f of found) {
      expect(f.at).toBeGreaterThanOrEqual(0);
      expect(f.at).toBeLessThanOrEqual(1);
    }
  });

  /**
   * The two string spaces, and why the ruler is built from only one of them.
   *
   * `block.text` collapses whitespace and inserts a space at every nested block
   * boundary; `renderedText` concatenates text nodes raw. This block is written
   * so the two lengths differ a lot — `text` is a third the length of what the
   * browser renders. Measuring the ruler in one and the offset in the other put
   * the bar somewhere that was never checkable by looking at it.
   */
  it("measures the ruler in the same string space the offsets live in", () => {
    const wide = `<p>alpha${"&nbsp; ".repeat(120)}omega</p>`;
    const blocks = [
      block("spya-k3m9qt", wide, "alpha omega"),
      block("spya-p7w2dn", "<p>tail of the piece</p>"),
    ];
    const [found] = findLiteral(blocks, "omega");
    // The rendered first block is ~840 characters and the second is 17, so a
    // match at the end of the first is close to — but not past — its own share.
    expect(found!.at).toBeGreaterThan(0.9);
    expect(found!.at).toBeLessThan(1);
    // Measured in `block.text` the first block is 11 characters against the
    // second's 17, which would have put this hit before the halfway mark.
    expect(found!.at).toBeGreaterThan(0.5);
  });

  /**
   * The block-count bug, written as the test that catches it.
   *
   * One enormous paragraph followed by four tiny ones. A match at the top of
   * the big paragraph is at the very start of the *article*; counted in blocks
   * it would be at the start too — so the discriminating case is the match in
   * the FIRST of the tiny blocks, which is 5/6 of the way through the text and
   * only 1/5 of the way through the block list.
   */
  it("weighs blocks by how much text they hold, not by how many there are", () => {
    const blocks = [
      block("spya-k3m9qt", `<p>${"long ".repeat(200)}needle</p>`),
      block("spya-p7w2dn", "<p>tiny marker one</p>"),
      block("spya-w4x8bn", "<p>tiny two</p>"),
      block("spya-z2h6vr", "<p>tiny three</p>"),
      block("spya-b8n4gm", "<p>tiny four</p>"),
    ];
    const [found] = findLiteral(blocks, "marker");
    expect(found!.at).toBeGreaterThan(0.9);
  });

  it("separates two matches inside one long paragraph", () => {
    const blocks = [block("spya-k3m9qt", `<p>needle ${"filler ".repeat(300)}needle</p>`)];
    const [early, late] = findLiteral(blocks, "needle");
    expect(early!.at).toBeLessThan(0.1);
    expect(late!.at).toBeGreaterThan(0.9);
  });

  it("gives a resolved model hit the same measure as a literal one", () => {
    const [literal] = findLiteral(BLOCKS, "thermostat");
    const [resolved] = resolveHits(BLOCKS, [
      modelHit({ blockId: "spya-p7w2dn", quote: "thermostat has no interior" }),
    ]);
    expect(resolved!.at).toBeCloseTo(literal!.at, 2);
  });

  /* An article with no text at all divides by its own length. Flooring the
     denominator is what keeps that a 0 rather than a NaN, which CSS renders as
     a collapsed bar and nobody reads as an error. */
  it("does not produce NaN for an empty article", () => {
    const found = findLiteral([block("spya-k3m9qt", "<p></p>", "")], "ab");
    expect(found).toEqual([]);
    const resolved = resolveHits([block("spya-k3m9qt", "<p></p>", "")], [
      modelHit({ blockId: "spya-k3m9qt", quote: "gone" }),
    ]);
    expect(Number.isNaN(resolved[0]!.at)).toBe(false);
  });
});

describe("orderFound", () => {
  /* `row`, not `at` — `Found` has a field of that name now (where in the article
     the passage falls), and a factory that shadowed it would make every literal
     below read as though it were setting one thing while setting another. */
  const row = (index: number, start: number, confidence: number | null): Found => ({
    key: `${index}:${start}`,
    blockId: "spya-k3m9qt",
    index,
    start,
    end: start + 4,
    confidence,
    reasoning: null,
    short: "",
    long: "",
    at: 0,
    whole: false,
  });

  it("puts the article's own order first by default", () => {
    const out = orderFound([row(5, 0, 30), row(1, 0, 90)], "document");
    expect(out.map((f) => f.index)).toEqual([1, 5]);
  });

  it("breaks a document tie on where in the paragraph the match is", () => {
    const out = orderFound([row(1, 40, 30), row(1, 2, 30)], "document");
    expect(out.map((f) => f.start)).toEqual([2, 40]);
  });

  it("puts the strongest first when asked", () => {
    const out = orderFound([row(1, 0, 30), row(5, 0, 90)], "confidence");
    expect(out.map((f) => f.confidence)).toEqual([90, 30]);
  });

  it("falls back to document order when nothing has a confidence", () => {
    // Which is every result in words mode, so this is the ordinary case rather
    // than an edge one.
    const out = orderFound([row(5, 0, null), row(1, 0, null)], "confidence");
    expect(out.map((f) => f.index)).toEqual([1, 5]);
  });

  it("does not reorder the array it was given", () => {
    // The caller's array is memoised upstream, and the marks were computed from
    // it. Sorting in place would reorder a set already on screen.
    const input = [row(5, 0, 30), row(1, 0, 90)];
    orderFound(input, "confidence");
    expect(input.map((f) => f.index)).toEqual([5, 1]);
  });
});

describe("hitMarks", () => {
  const found = findLiteral(BLOCKS, "software");

  it("groups marks by the block they are in", () => {
    const marks = hitMarks(found, null);
    expect([...marks.keys()].sort()).toEqual(["spya-k3m9qt", "spya-w4x8bn"]);
  });

  it("tags every mark as a hit, so the stylesheet can tell it from a comment", () => {
    for (const list of hitMarks(found, null).values()) {
      for (const m of list) expect(m.kind).toBe("hit");
    }
  });

  it("draws a literal match at full strength", () => {
    const [first] = hitMarks(found, null).get("spya-k3m9qt")!;
    expect(first!.strength).toBe(1);
  });

  /**
   * The floor is the point of the mapping. A wash at 0.2 of a 50%-confidence
   * match is not subtle, it is invisible — and an invisible mark is
   * indistinguishable from a bug.
   */
  it("keeps a weak match visible rather than letting it fade to nothing", () => {
    const weak = resolveHits(BLOCKS, [
      { blockId: "spya-k3m9qt", quote: "mind is software", confidence: 0, reasoning: "" },
    ]);
    const [mark] = hitMarks(weak, null).get("spya-k3m9qt")!;
    expect(mark!.strength).toBeGreaterThan(0.3);
    expect(mark!.strength).toBeLessThan(0.5);
  });

  it("scales strength with confidence", () => {
    const make = (confidence: number) =>
      hitMarks(
        resolveHits(BLOCKS, [
          { blockId: "spya-k3m9qt", quote: "mind is software", confidence, reasoning: "" },
        ]),
        null,
      ).get("spya-k3m9qt")![0]!.strength!;
    expect(make(100)).toBeGreaterThan(make(50));
    expect(make(50)).toBeGreaterThan(make(10));
  });

  it("marks only the pressed result as open", () => {
    const key = found[0]!.key;
    const marks = hitMarks(found, key);
    expect(marks.get("spya-k3m9qt")![0]!.open).toBe(true);
    expect(marks.get("spya-w4x8bn")![0]!.open).toBeUndefined();
  });

  it("is empty when nothing was found, so the prose is untouched", () => {
    expect(hitMarks([], null).size).toBe(0);
  });
});

describe("blockStrength", () => {
  it("reports the strongest match in each block, not the sum of them", () => {
    // Opacity that accumulated would make two middling matches look more
    // certain than either of them is — a claim nobody made.
    const hits: SearchHit[] = [
      { blockId: "spya-k3m9qt", quote: "mind is software", confidence: 40, reasoning: "" },
      { blockId: "spya-k3m9qt", quote: "wet hardware", confidence: 90, reasoning: "" },
    ];
    expect(blockStrength(resolveHits(BLOCKS, hits)).get("spya-k3m9qt")).toBeCloseTo(0.9);
  });

  it("names only the blocks that actually matched", () => {
    const strength = blockStrength(findLiteral(BLOCKS, "thermostat"));
    expect([...strength.keys()]).toEqual(["spya-p7w2dn"]);
  });
});
