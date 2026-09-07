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
  blockHues,
  blockMatches,
  blockStrength,
  findLiteral,
  hitMarks,
  MIN_FIND_CHARS,
  orderFound,
  keepAbove,
  applyConf,
  resolveHits,
  type Found,
} from "../src/web/search-hits.js";
import type { Block, SearchHit } from "../src/types.js";

/**
 * One switched-on search, wrapping a bare list of hits.
 *
 * `resolveHits` takes several searches at once since 2026-08-26 — see its own
 * note on why that is one pass and not three calls. Most of the tests below
 * predate that and are about one search, so they say `one(...)` and stay about
 * what they were about; the merging itself gets tests of its own at the end.
 */
const one = (hits: SearchHit[], slot = 0, id = "spya-run2aa") => [{ id, slot, hits }];

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
    const [found] = resolveHits(BLOCKS, one([hit()]));
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
    const [found] = resolveHits(BLOCKS, one([hit({ quote: "words that are not there" })]));
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
    const solo = [block("spya-k3m9qt", "<p>Not anymore. AI has blown this\nworld open.</p>")];
    const [found] = resolveHits(
      solo,
      // As the model retypes it: the newline has become a space.
      one([hit({ quote: "Not anymore. AI has blown this world open." })]),
    );
    expect(found!.whole).toBe(false);
    expect(found!.start).toBe(0);
  });

  it("drops a hit naming a block the article no longer has", () => {
    // Only reachable after a re-extraction. An id that is simply gone has
    // nowhere to point, and a row that does nothing when pressed is worse than
    // no row.
    expect(resolveHits(BLOCKS, one([hit({ blockId: "spya-zzzzzz" })]))).toEqual([]);
  });

  it("keeps two hits that quote the same words apart", () => {
    const found = resolveHits(BLOCKS, one([hit(), hit({ reasoning: "a different reason" })]));
    expect(found).toHaveLength(2);
    expect(found[0]!.key).not.toBe(found[1]!.key);
  });

  it("carries the model's reasoning through untouched", () => {
    const [found] = resolveHits(BLOCKS, one([hit({ reasoning: "States the position rejected." })]));
    expect(found!.reasoning).toBe("States the position rejected.");
  });
});

/**
 * Several switched-on searches merged into one list — the 2026-08-26 change.
 *
 * The property under every test here is that **a result can say which question
 * found it**. That is what the colour is for, and it is what a merged list
 * costs if it is got wrong: nine passages from three searches, and no way to
 * tell which is which.
 */
describe("resolveHits over several searches", () => {
  const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
    blockId: "spya-k3m9qt",
    quote: "mind is software",
    confidence: 85,
    reasoning: "why",
    ...over,
  });

  it("tags every result with the search and the slot it came from", () => {
    const found = resolveHits(BLOCKS, [
      { id: "spya-aaa2aa", slot: 3, hits: [hit()] },
      { id: "spya-bbb2bb", slot: 5, hits: [hit({ quote: "wet hardware" })] },
    ]);
    expect(found.map((f) => [f.runId, f.slot])).toEqual([
      ["spya-aaa2aa", 3],
      ["spya-bbb2bb", 5],
    ]);
  });

  /**
   * The bug this whole change would otherwise have shipped with.
   *
   * A key was `blockId:n` while only one search could be showing. With three on,
   * three searches that each found their second hit in the same paragraph all
   * produce `spya-k3m9qt:1` — React renders one and drops the rest, `openKey`
   * matches whichever comes first, and the mark in the prose belongs to a
   * different search from the row the reader pressed. Every one of those is
   * silent, which is why it is pinned rather than left to a rendering warning.
   */
  it("keeps the same hit in two different searches apart", () => {
    const found = resolveHits(BLOCKS, [
      { id: "spya-aaa2aa", slot: 0, hits: [hit()] },
      { id: "spya-bbb2bb", slot: 1, hits: [hit()] },
    ]);
    expect(found).toHaveLength(2);
    expect(new Set(found.map((f) => f.key)).size).toBe(2);
  });

  it("measures place against one ruler however many searches are on", () => {
    /* One pass, one ruler. Calling this three times and concatenating would
       build the scale three times from the same numbers — identical today, and
       a trap the moment the ruler stops being a pure function of the blocks. */
    const alone = resolveHits(BLOCKS, [{ id: "spya-aaa2aa", slot: 0, hits: [hit()] }]);
    const together = resolveHits(BLOCKS, [
      { id: "spya-aaa2aa", slot: 0, hits: [hit()] },
      { id: "spya-bbb2bb", slot: 1, hits: [hit({ blockId: "spya-p7w2dn", quote: "thermostat" })] },
    ]);
    expect(together[0]!.at).toBeCloseTo(alone[0]!.at, 10);
  });

  it("is empty when nothing is switched on", () => {
    /* Default-false: a reader who opens search mode has an unmarked article
       until they tick something. The same rule the glossary and the summaries
       follow, and here it is one empty array. */
    expect(resolveHits(BLOCKS, [])).toEqual([]);
  });
});

describe("blockHues", () => {
  const hit = (blockId: string, quote: string): SearchHit => ({
    blockId,
    quote,
    confidence: 80,
    reasoning: "",
  });

  it("lists every search that matched anywhere in a block, once each", () => {
    /* Coarser than the marks on purpose: two hits from one search in one
       paragraph is one segment, because the bar answers "is any of my searches
       in here" rather than "which of them is in this clause". */
    const found = resolveHits(BLOCKS, [
      { id: "spya-aaa2aa", slot: 6, hits: [hit("spya-k3m9qt", "mind is software"), hit("spya-k3m9qt", "wet hardware")] },
      { id: "spya-bbb2bb", slot: 2, hits: [hit("spya-k3m9qt", "mind is software")] },
    ]);
    expect(blockHues(found).get("spya-k3m9qt")).toEqual([2, 6]);
  });

  it("sorts the slots, so one pair of searches draws one bar everywhere", () => {
    const found = resolveHits(BLOCKS, [
      { id: "spya-bbb2bb", slot: 7, hits: [hit("spya-k3m9qt", "mind is software")] },
      { id: "spya-aaa2aa", slot: 1, hits: [hit("spya-k3m9qt", "wet hardware")] },
    ]);
    expect(blockHues(found).get("spya-k3m9qt")).toEqual([1, 7]);
  });

  it("gives a literal match no hue at all", () => {
    /* A words search has no saved search behind it and no colour, and the
       stylesheet falls back to the one fixed search hue when `data-hues` is
       absent. A slot of 0 here would silently paint every literal match in the
       first categorical colour instead. */
    expect(blockHues(findLiteral(BLOCKS, "thermostat")).size).toBe(0);
  });
});

describe("findLiteral and the offsets it reports", () => {
  /* Lowercasing is **not length-preserving**, and the whole matcher was built
     on the assumption that it is: find the needle in a lowercased haystack,
     then use that index against the original. `İ` (U+0130) lowercases to two
     code units, so every offset after one is out by one — and the same trap is
     already written down at src/library-search.ts § foldWithMap, which is what
     makes this a bug we knew about and had not looked for here.

     Nothing crashes. The wash in the prose starts one letter late, the snippet
     in the panel starts one letter late, and the "42% in" is shifted. Raised by
     a GPT Sol review, 2026-08-26. */
  const turkish = [
    block("spya-t1u2v3", "<p>İstanbul and the needle in it.</p>"),
  ];

  it("reports offsets in the original text, not in a lowercased copy of it", () => {
    const [hit] = findLiteral(turkish, "needle");
    const text = "İstanbul and the needle in it.";
    expect(hit).toBeDefined();
    expect(text.slice(hit!.start, hit!.end)).toBe("needle");
  });

  it("still finds a match whose own case differs from the query", () => {
    const [hit] = findLiteral(turkish, "NEEDLE");
    const text = "İstanbul and the needle in it.";
    expect(text.slice(hit!.start, hit!.end)).toBe("needle");
  });

  it("still case-folds a script that lives above the BMP", () => {
    /* The fix for the offset bug walks code points rather than code units, and
       this is the check that it does. Lowercasing half a surrogate pair returns
       that half unchanged, so a code-unit walk would trade the `İ` failure for
       silently never matching Adlam, Deseret or Osage — Adlam being a script in
       daily use for Fulani. */
    const upper = String.fromCodePoint(0x1e900);
    const lower = String.fromCodePoint(0x1e922);
    const adlam = [block("spya-a1d2l3", `<p>${upper}${lower} here.</p>`)];
    const [found] = findLiteral(adlam, `${lower}${lower}`);
    expect(found).toBeDefined();
    expect(found!.start).toBe(0);
    expect(found!.end).toBe(upper.length + lower.length);
  });

  it("finds every occurrence, without overlapping them", () => {
    const twice = [block("spya-t9u9v9", "<p>Mind and mind and MIND.</p>")];
    const spans = findLiteral(twice, "mind").map((f) => [f.start, f.end]);
    expect(spans).toEqual([
      [0, 4],
      [9, 13],
      [18, 22],
    ]);
  });
});

describe("blockMatches", () => {
  const hit = (blockId: string, quote: string): SearchHit => ({
    blockId,
    quote,
    confidence: 80,
    reasoning: "",
  });

  it("keeps the literal matcher's null, where blockHues drops it", () => {
    /* The one difference between the two, and the reason there are two. The
       paragraph bar has a fallback for a colourless match — the fixed search
       hue it always had — so `blockHues` can drop the null. The spine has no
       fallback: dropping it there would mean the rail showed every search that
       cost money and **nothing at all** in words mode, which is the matcher a
       reader is most likely to be using. Silent, and backwards. */
    const literal = blockMatches(findLiteral(BLOCKS, "thermostat"));
    expect(literal.size).toBeGreaterThan(0);
    for (const match of literal.values()) {
      expect(match.searches).toEqual([{ runId: null, slot: null }]);
    }
  });

  it("counts every match in a block, not every search that found one", () => {
    /* `searches` answers "whose", `count` answers "how much". Two hits from one
       search is one entry and two matches, and conflating them would make a
       paragraph the model quoted five times look exactly like one it quoted
       once — which is the question "how common" is asking. */
    const found = resolveHits(BLOCKS, [
      {
        id: "spya-aaa2aa",
        slot: 6,
        hits: [hit("spya-k3m9qt", "mind is software"), hit("spya-k3m9qt", "wet hardware")],
      },
    ]);
    const match = blockMatches(found).get("spya-k3m9qt");
    expect(match?.searches).toEqual([{ runId: "spya-aaa2aa", slot: 6 }]);
    expect(match?.count).toBe(2);
  });

  it("adds up the counts of several searches in one block, in palette order", () => {
    const found = resolveHits(BLOCKS, [
      { id: "spya-aaa2aa", slot: 6, hits: [hit("spya-k3m9qt", "mind is software")] },
      { id: "spya-bbb2bb", slot: 2, hits: [hit("spya-k3m9qt", "wet hardware")] },
    ]);
    const match = blockMatches(found).get("spya-k3m9qt");
    expect(match?.searches.map((x) => x.slot)).toEqual([2, 6]);
    expect(match?.count).toBe(2);
  });

  it("keeps two searches apart when the palette has wrapped and they share a hue", () => {
    /* **The bug this shape exists to prevent.** Slots repeat past the eighth
       search (hit-colours.ts § assignSlots) and select-all switches on every
       saved search there is, so keying identity off the slot merges the ninth
       search with whichever earlier one shares its hue — one entry instead of
       two, one lane in the rail carrying the union of two searches' shapes.
       Raised by a GPT Sol review, 2026-08-26. */
    const found = resolveHits(BLOCKS, [
      { id: "spya-aaa2aa", slot: 3, hits: [hit("spya-k3m9qt", "mind is software")] },
      { id: "spya-zzz2zz", slot: 3, hits: [hit("spya-k3m9qt", "wet hardware")] },
    ]);
    const match = blockMatches(found).get("spya-k3m9qt");
    expect(match?.searches).toEqual([
      { runId: "spya-aaa2aa", slot: 3 },
      { runId: "spya-zzz2zz", slot: 3 },
    ]);
    expect(match?.count).toBe(2);
  });

  it("orders a block's searches the same way whatever order the results came in", () => {
    /* By slot, so the same pair of searches draws the same thing in every
       paragraph they share — the reason `annotateHtml` sorts its stripes. The
       reader can change the result order with the sort control, and that must
       not rearrange anything drawn. */
    const runs = [
      { id: "spya-bbb2bb", slot: 7, hits: [hit("spya-k3m9qt", "mind is software")] },
      { id: "spya-aaa2aa", slot: 1, hits: [hit("spya-k3m9qt", "wet hardware")] },
    ];
    const forward = blockMatches(resolveHits(BLOCKS, runs)).get("spya-k3m9qt");
    const backward = blockMatches(resolveHits(BLOCKS, [...runs].reverse())).get("spya-k3m9qt");
    expect(forward?.searches.map((x) => x.slot)).toEqual([1, 7]);
    expect(backward?.searches).toEqual(forward?.searches);
  });

  it("agrees with blockHues about which colours matched where", () => {
    /* They are one implementation and two views of it, and this is the check
       that keeps them that way — the failure if they drift is the paragraph bar
       and the rail disagreeing about the same paragraph, which is exactly the
       invariant the whole feature is built around (search-hits.ts, top). */
    const found = resolveHits(BLOCKS, [
      { id: "spya-aaa2aa", slot: 6, hits: [hit("spya-k3m9qt", "mind is software")] },
      { id: "spya-bbb2bb", slot: 2, hits: [hit("spya-k3m9qt", "wet hardware")] },
    ]);
    const hues = blockHues(found);
    for (const [id, match] of blockMatches(found)) {
      expect(hues.get(id)).toEqual([
        ...new Set(match.searches.map((x) => x.slot).filter((x) => x !== null)),
      ]);
    }
  });

  it("gives the paragraph bar one segment when two searches share a hue", () => {
    /* The bar is *divided into colours*. Two segments of the same colour side
       by side is not a division, it is a wider segment drawn as two — and the
       gradient would put a seam in the middle of it. The rail wants both; the
       bar wants one. */
    const found = resolveHits(BLOCKS, [
      { id: "spya-aaa2aa", slot: 3, hits: [hit("spya-k3m9qt", "mind is software")] },
      { id: "spya-zzz2zz", slot: 3, hits: [hit("spya-k3m9qt", "wet hardware")] },
    ]);
    expect(blockHues(found).get("spya-k3m9qt")).toEqual([3]);
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
    const [resolved] = resolveHits(
      BLOCKS,
      one([modelHit({ blockId: "spya-p7w2dn", quote: "thermostat has no interior" })]),
    );
    expect(resolved!.at).toBeCloseTo(literal!.at, 2);
  });

  /* An article with no text at all divides by its own length. Flooring the
     denominator is what keeps that a 0 rather than a NaN, which CSS renders as
     a collapsed bar and nobody reads as an error. */
  it("does not produce NaN for an empty article", () => {
    const found = findLiteral([block("spya-k3m9qt", "<p></p>", "")], "ab");
    expect(found).toEqual([]);
    const resolved = resolveHits(
      [block("spya-k3m9qt", "<p></p>", "")],
      one([modelHit({ blockId: "spya-k3m9qt", quote: "gone" })]),
    );
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
    /* Ordering knows nothing about which search a result came from, so these are
       inert here. They are written out rather than cast away because the typed
       fixture is what makes `npm run typecheck` a gate on this file at all —
       vitest transpiles without checking, so an incomplete `Found` passes every
       test and fails the build. Caught by a GPT Sol review, 2026-08-26. */
    runId: null,
    slot: null,
    index,
    start,
    end: start + 4,
    confidence,
    /* Nothing here is a referee's for/against criterion, which is the only
       source that carries one. Written out rather than left off, for the reason
       the note above gives about the typed fixture being the gate. */
    valence: null,
    reasoning: null,
    short: "",
    long: "",
    at: 0,
    whole: false,
    /* Not a quote. See `Found.quoteTier`. */
    quoteTier: null,
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

  it("orders prioritised by place, exactly as document does", () => {
    // The filtering is what makes prioritised different; the sort is not.
    const rows = [row(5, 0, 90), row(1, 0, 30)];
    expect(orderFound(rows, "prioritised").map((f) => f.index)).toEqual(
      orderFound(rows, "document").map((f) => f.index),
    );
  });
});

describe("the prioritised threshold", () => {
  /* `runId`, not the confidence, is what makes a hit literal rather than the
     model's — so it is a parameter here. GPT Sol's review pointed out that
     fixtures written with `runId: null` throughout cannot tell the two apart,
     which is exactly the distinction `clears` is reasoning about. */
  const row = (index: number, confidence: number | null, runId: string | null = null): Found => ({
    key: `k${index}`,
    blockId: "spya-k3m9qt",
    runId,
    slot: null,
    index,
    start: 0,
    end: 4,
    confidence,
    valence: null,
    reasoning: null,
    short: "",
    long: "",
    at: 0,
    whole: false,
    /* Not a quote. See `Found.quoteTier`. */
    quoteTier: null,
  });

  it("keeps what survives the bar and drops what does not", () => {
    const rows = [row(1, 80), row(2, 50), row(3, 20)];
    expect(keepAbove(rows, 50).map((f) => f.index)).toEqual([1, 2]);
    /* One pass, and the panel's `N of M` and its foot line both come out of it.
       Asserted as an identity between the parts rather than as two separate
       numbers: **a count that disagrees with the list under it** is the failure
       the shared threshold module exists to make impossible. */
    const out = applyConf(rows, 50);
    expect(out.visible).toEqual(keepAbove(rows, 50));
    expect(out.hiddenCount).toBe(1);
    expect(out.visible.length + out.hiddenCount).toBe(rows.length);
  });

  it("keeps a model hit whose stored confidence is missing", () => {
    /* Typed non-null and enforced by validateHits, but saved JSON is cast
       rather than re-validated on the way back in, so a null can reach here
       from an old file. Showing it is the lossless direction — a result the
       reader can see and judge beats one withheld on a missing field. */
    expect(keepAbove([row(1, null, "spya-k3m9qt")], 90)).toHaveLength(1);
  });

  it("keeps a result with no confidence at any bar at all", () => {
    /* The one line in this feature that must not be got wrong. Every result in
       words mode has a null confidence, so treating null as zero would empty
       the list the moment an `?order=prioritised` link was opened there —
       silently, since "Nothing matched" is what an empty list already says.
       Absent is not low: the same rule `orderFound` follows when it sorts a
       literal match as certain. */
    const words = [row(1, null), row(2, null)];
    expect(keepAbove(words, 100).map((f) => f.index)).toEqual([1, 2]);
    expect(keepAbove(words, 0)).toHaveLength(2);
    /* And they are counted as unscored survivors rather than as hits that
       cleared the bar, so the foot line under a words search says nothing is
       hidden rather than claiming a judgment was made. */
    const out = applyConf(words, 100);
    expect(out.hiddenCount).toBe(0);
    expect(out.unscoredCount).toBe(2);
  });

  it("is inclusive at the bar, so the printed number means what it says", () => {
    // A row printed "50" must not vanish at a threshold of 50 — the reader can
    // see the number and would read that as a bug.
    expect(keepAbove([row(1, 50)], 50)).toHaveLength(1);
  });

  it("says out loud how many it has hidden, in the panel's own noun", () => {
    /* Search prints the same foot line the other two thresholds now do —
       `hiddenNote` in threshold.ts, with "passage" as the noun. The wording is
       covered verbatim in tests/threshold.test.ts; what matters here is that
       the number handed to it is this list's hidden count. */
    const rows = [row(1, 80), row(2, 20)];
    expect(applyConf(rows, 90).hiddenCount).toBe(2);
    expect(applyConf(rows, 0).hiddenCount).toBe(0);
    expect(applyConf(rows, 50).hiddenCount).toBe(1);
    // An empty result set is the search's problem to explain, not the bar's —
    // and the panel does not draw a slider over one.
    expect(applyConf([], 50).hiddenCount).toBe(0);
  });
});

describe("hitMarks", () => {
  const found = findLiteral(BLOCKS, "software");

  /* Every case in this block is a *search*, which never carries a valence — so
     the ramp handed in is inert here and `"rg"` is only what the parameter
     requires. It is required rather than defaulted for the reason `hitMarks`
     gives: forgetting to thread `?refscale=` would otherwise look exactly like
     choosing red↔green on purpose. The ramp is exercised in
     tests/referee-criteria-resolve.test.ts, where a passage actually has a
     direction. */

  it("groups marks by the block they are in", () => {
    const marks = hitMarks(found, null, "rg");
    expect([...marks.keys()].sort()).toEqual(["spya-k3m9qt", "spya-w4x8bn"]);
  });

  it("tags every mark as a hit, so the stylesheet can tell it from a comment", () => {
    for (const list of hitMarks(found, null, "rg").values()) {
      for (const m of list) expect(m.kind).toBe("hit");
    }
  });

  it("draws a literal match at full strength", () => {
    const [first] = hitMarks(found, null, "rg").get("spya-k3m9qt")!;
    expect(first!.strength).toBe(1);
  });

  /**
   * The floor is the point of the mapping. A wash at 0.2 of a 50%-confidence
   * match is not subtle, it is invisible — and an invisible mark is
   * indistinguishable from a bug.
   */
  it("keeps a weak match visible rather than letting it fade to nothing", () => {
    const weak = resolveHits(
      BLOCKS,
      one([{ blockId: "spya-k3m9qt", quote: "mind is software", confidence: 0, reasoning: "" }]),
    );
    const [mark] = hitMarks(weak, null, "rg").get("spya-k3m9qt")!;
    expect(mark!.strength).toBeGreaterThan(0.3);
    expect(mark!.strength).toBeLessThan(0.5);
  });

  it("scales strength with confidence", () => {
    const make = (confidence: number) =>
      hitMarks(
        resolveHits(
          BLOCKS,
          one([{ blockId: "spya-k3m9qt", quote: "mind is software", confidence, reasoning: "" }]),
        ),
        null,
        "rg",
      ).get("spya-k3m9qt")![0]!.strength!;
    expect(make(100)).toBeGreaterThan(make(50));
    expect(make(50)).toBeGreaterThan(make(10));
  });

  it("marks only the pressed result as open", () => {
    const key = found[0]!.key;
    const marks = hitMarks(found, key, "rg");
    expect(marks.get("spya-k3m9qt")![0]!.open).toBe(true);
    expect(marks.get("spya-w4x8bn")![0]!.open).toBeUndefined();
  });

  it("is empty when nothing was found, so the prose is untouched", () => {
    expect(hitMarks([], null, "rg").size).toBe(0);
  });

  /**
   * **The `unpressed` cache's immutability, as a compiler rule rather than a
   * sentence.**
   *
   * `hitMarks` hands back arrays and a map it keeps in a `WeakMap` keyed on the
   * `Found[]` — so a caller that pushed into one would poison every later
   * result for that search, and one that edited a `Found` in place would get
   * marks at the offsets it used to have. A GPT Sol review demonstrated both by
   * probe (docs/plans/260905i-stage2-review-sol.md § F22); no caller does
   * either, which is exactly why the guarantee needed something stronger than a
   * docstring nobody has to read.
   *
   * There is nothing to run: the assertions are the three `@ts-expect-error`
   * directives, and **only `npm run typecheck` evaluates them** — vitest strips
   * them, so this stays green in the runner however the types are weakened.
   * Drop a `readonly` and typecheck reports `Unused '@ts-expect-error'`.
   */
  it("refuses at compile time to let a caller mutate what it cached", () => {
    const refused = (marks: ReturnType<typeof hitMarks>, hits: Found[]) => {
      // @ts-expect-error the map is the cache itself; writing to it is writing to the cache.
      marks.set("spya-k3m9qt", []);
      // @ts-expect-error the arrays are shared: a push poisons every later result.
      marks.get("spya-k3m9qt")?.push({ id: "x", start: 0, end: 1, kind: "hit" });
      // @ts-expect-error the cache is keyed on this array's identity, not its contents.
      hits[0]!.start = 5;
    };
    expect(typeof refused).toBe("function");
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
    expect(blockStrength(resolveHits(BLOCKS, one(hits))).get("spya-k3m9qt")).toBeCloseTo(0.9);
  });

  it("names only the blocks that actually matched", () => {
    const strength = blockStrength(findLiteral(BLOCKS, "thermostat"));
    expect([...strength.keys()]).toEqual(["spya-p7w2dn"]);
  });
});
