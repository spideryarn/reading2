// @vitest-environment jsdom
/**
 * The address of a library hit, and the folding behind it — src/web/library-hits.ts.
 *
 * ## Why this file exists
 *
 * `libraryHitHref` was three lines inside a React component. The repo has no
 * React test runner and its vitest environment is `node`, so the one rule that
 * actually matters about those three lines — **which parameters the link has to
 * carry** — could not be pinned by anything at all. It then lost one of them,
 * and the symptom was a link where every present parameter was correct, the
 * reader landed on exactly the right paragraph, and nothing was highlighted.
 * Found by driving a browser, which is an expensive way to find a missing query
 * parameter.
 *
 * Adding a component test runner to catch that would have been framework churn
 * ([AGENTS.md](../AGENTS.md)). Moving the rule into a pure function was not, and
 * this is the guard that makes the move worth it.
 *
 * See docs/plans/260826k-library-shelf-actions-and-search.md.
 *
 * jsdom, since 2026-10-03: the round trip below runs the link's `find` through
 * the reading view's real `findLiteral`, which renders html. The first version
 * of this file checked the link against its own idea of the destination, and
 * pinned `find=cafe` — a term the destination cannot match
 * (docs/plans/261003h-shelf-link-sends-the-hits-own-spelling-and-foldwithmap-offsets.md).
 */
import { describe, expect, it } from "vitest";
import { fold as serverFold } from "../src/library-search.js";
import { fold, foldWithMap, libraryHitHref, queryTerms } from "../src/web/library-hits.js";
import { findLiteral } from "../src/web/search-hits.js";
import type { Block, LibraryHit } from "../src/types.js";

const hit = (text: string, over: Partial<LibraryHit> = {}): LibraryHit => ({
  slug: "an-article",
  title: "An Article",
  titleOverridden: false,
  blockId: "spya-k3m9qt",
  text,
  rank: 1,
  archived: false,
  ...over,
});

/** The query string of a href, as a `URLSearchParams`. */
const params = (href: string) => new URLSearchParams(href.slice(href.indexOf("?")));

describe("where a library hit leads", () => {
  it("carries all four parameters", () => {
    /* **The test this file was written for.** Each of these fails silently on
       its own: no `at` lands you at the top, no `mode` gives you a page with
       nothing listening for `find`, no `find` gives you nothing to highlight,
       and no `match` opens the wrong kind of panel. */
    const p = params(libraryHitHref(hit("a paragraph about qualia and such"), "qualia"));
    expect(p.get("at")).toBe("spya-k3m9qt");
    expect(p.get("mode")).toBe("search");
    expect(p.get("find")).toBe("qualia");
    expect(p.get("match")).toBe("words");
  });

  it("sends ONE term, not the whole query", () => {
    // In-article search matches `find` as a single literal substring, so a
    // two-word query highlighted nothing at all.
    const p = params(libraryHitHref(hit("conscious experience is the thing"), "conscious experience"));
    expect(p.get("find")).toBe("conscious");
  });

  it("picks a term that actually occurs in THIS hit", () => {
    // Otherwise the highlight is a word the reader cannot see, which is the
    // same outcome as no highlight but harder to explain.
    const p = params(libraryHitHref(hit("only the second word appears: experience"), "qualia experience"));
    expect(p.get("find")).toBe("experience");
  });

  it("degrades to the paragraph alone when no term occurs", () => {
    /* A stemmed Postgres match can find a block that contains none of the typed
       characters. Landing on the right paragraph with no panel is a good
       outcome; opening an empty search panel is not. */
    const href = libraryHitHref(hit("nothing relevant here"), "qualia");
    const p = params(href);
    expect(p.get("at")).toBe("spya-k3m9qt");
    expect(p.get("mode")).toBeNull();
    expect(p.get("find")).toBeNull();
  });

  it("ignores the syntax only Postgres understands", () => {
    // `OR` is a word to the highlighter, and a quoted phrase is not a literal
    // it can match — so neither may become the thing we ask to highlight.
    expect(params(libraryHitHref(hit("writing about writing"), "writing OR qualia")).get("find")).toBe(
      "writing",
    );
    expect(params(libraryHitHref(hit("the hard problem"), '"hard problem"')).get("find")).toBe("hard");
  });

  it("percent-encodes what it puts in the query string", () => {
    const href = libraryHitHref(hit("a café in paris"), "café");
    expect(href).toContain("find=caf%C3%A9");
    expect(params(href).get("find")).toBe("café");
  });

  it("sends the HIT'S OWN spelling, not the folded one", () => {
    // Find-on-page folds case only, so `cafe` finds nothing in "café".
    expect(params(libraryHitHref(hit("a café in paris"), "cafe")).get("find")).toBe("café");
    expect(params(libraryHitHref(hit("they don’t say"), "don't")).get("find")).toBe("don’t");
    expect(params(libraryHitHref(hit("an eﬃcient market"), "efficient")).get("find")).toBe("eﬃcient");
  });

  it("widens a one-character spelling, which find-on-page would refuse", () => {
    /* `ffi` is three characters typed and one in the article. A `find` of one
       character is "not searching yet" to `findLiteral`. */
    expect(params(libraryHitHref(hit("an eﬃcient market"), "ffi")).get("find")).toBe("ﬃc");
    // Nothing to the right: widen left instead.
    expect(params(libraryHitHref(hit("a baﬃ"), "ffi")).get("find")).toBe("aﬃ");
    // Nothing either side: the paragraph alone, as for no term at all.
    expect(params(libraryHitHref(hit("ﬃ"), "ffi")).get("find")).toBeNull();
    // A space to the right is no help — `find` is trimmed — so left it is.
    expect(params(libraryHitHref(hit("aﬃ b"), "ffi")).get("find")).toBe("aﬃ");
    // And a term that cannot be widened gives way to the next one.
    expect(params(libraryHitHref(hit("ﬃ and plain"), "ffi plain")).get("find")).toBe("plain");
  });
});

/** A paragraph as the reading view holds it. */
const block = (text: string): Block => ({
  id: "spya-k3m9qt",
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

describe("the round trip: the link's term, through the reading view's own matcher", () => {
  /* **The test the first version of this file should have had.** Producer and
     destination composed, rather than the producer checked against a value
     somebody typed. Each row is [what the article says, what the reader typed]. */
  const ROWS: [string, string, string][] = [
    ["a control, so this test is known to be able to pass", "a plain paragraph", "plain"],
    ["an accent", "a café in paris", "cafe"],
    ["an accent, typed with it", "a café in paris", "café"],
    ["an umlaut", "what Gödel proved", "godel"],
    ["a curly apostrophe", "they don’t say", "don't"],
    ["a ligature", "an eﬃcient market", "efficient"],
    ["a ligature and nothing else", "an eﬃcient market", "ffi"],
    ["an emoji before the word", "😀 café", "cafe"],
    ["a decomposed accent before the word", "a\u0301 café", "cafe"],
    ["a decomposed accent on the word", "a cafe\u0301 here", "cafe"],
    ["a dotted capital I before the word", "İ café", "cafe"],
    ["widening at the start", "ﬃc", "ffi"],
    ["widening at the end", "aﬃ", "ffi"],
    ["an astral neighbour on the right", "ﬃ😀", "ffi"],
    ["an astral neighbour on the left", "😀ﬃ", "ffi"],
    ["a space on the right and usable text on the left", "aﬃ b", "ffi"],
    ["a final sigma", "ΟΔΟΣ", "οδος"],
    ["reordered Hebrew marks", "ב\u05bc\u05b7ית", "ב\u05b7\u05bcית"],
  ];
  it.each(ROWS)("%s", (_name, text, query) => {
    const find = params(libraryHitHref(hit(text), query)).get("find");
    expect(find).not.toBeNull();
    expect(findLiteral([block(text)], find)).not.toHaveLength(0);
  });

  it("finds unchanged spelling even when rendering changes text elsewhere", () => {
    const text = "The symbol \\(\\alpha\\) is beside a café";
    const rendered = { ...block(text), html: "<p>The symbol α is beside a <em>café</em></p>" };
    const find = params(libraryHitHref(hit(text), "cafe")).get("find");
    expect(findLiteral([rendered], find)).toMatchObject([
      { blockId: rendered.id, start: 25, end: 29 },
    ]);
  });

  it("cannot find source spelling that rendering replaces", () => {
    const text = "The symbol \\(\\alpha\\) is here";
    const rendered = { ...block(text), html: "<p>The symbol α is here</p>" };
    const find = params(libraryHitHref(hit(text), "alpha")).get("find");
    expect(find).toBe("alpha");
    expect(findLiteral([block(text)], find)).not.toHaveLength(0);
    expect(findLiteral([rendered], find)).toHaveLength(0);
  });
});

describe("folding", () => {
  it("folds case, accents and curly punctuation", () => {
    expect(fold("Gödel")).toBe("godel");
    expect(fold("don’t")).toBe("don't");
    expect(fold("a—b")).toBe("a-b");
  });

  it("maps a folded offset back to the whole source character", () => {
    /* Folding is NOT length-preserving: NFKD expands `ﬁ` to `fi`. An offset
       carried straight across drifts by a character per ligature, with no error
       and nothing to grep for — and an earlier version recorded only each
       source character's start, so a match ending inside a ligature cut it off.
       Both ends are recorded now, and this is what says so. */
    const { folded, starts, ends } = foldWithMap("aﬁx");
    expect(folded).toBe("afix");
    // `af` in the folded string ends inside the ligature, whose source span is
    // the single character at index 1.
    expect(starts[0]).toBe(0);
    expect(ends[1]).toBe(2);
    expect("aﬁx".slice(starts[0] as number, ends[1] as number)).toBe("aﬁ");
  });

  it("iterates by code point, so an astral character is one character", () => {
    const { starts, ends } = foldWithMap("a😀b");
    // The emoji occupies two UTF-16 units; its span must cover both.
    expect((ends[1] as number) - (starts[1] as number)).toBe(2);
  });

  /** The source text under a folded match — what every caller does with the map. */
  const under = (text: string, term: string): string => {
    const { folded, starts, ends } = foldWithMap(text);
    const i = folded.indexOf(term);
    expect(i).toBeGreaterThanOrEqual(0);
    return text.slice(starts[i] as number, ends[i + term.length - 1] as number);
  };

  it("has one map entry per UTF-16 unit of the folded text", () => {
    /* Callers index the map with `indexOf`, which counts UTF-16 units. One
       entry per code POINT put every offset after an emoji out by one. */
    for (const s of ["😀 café", "a😀b😀c", "a\u0301 café", "𐐀𐐁 x", "eﬃcient ½ İ"]) {
      const { folded, starts, ends } = foldWithMap(s);
      expect(starts).toHaveLength(folded.length);
      expect(ends).toHaveLength(folded.length);
    }
    expect(under("😀 café", "cafe")).toBe("café");
  });

  it("does not lose the width of a character that folds to nothing", () => {
    // A combining mark folds to "", and the next offset was read from the last
    // entry PUSHED — so everything after it slid one to the left.
    expect(under("a\u0301 café", "cafe")).toBe("café");
    expect(under("\u0301café", "cafe")).toBe("café");
  });

  it("keeps a letter's combining marks inside its span", () => {
    expect(under("a cafe\u0301 here", "cafe")).toBe("cafe\u0301");
  });

  it("keeps exact spans across astral units, removed marks, expansions and contextual case", () => {
    expect(foldWithMap("😀a\u0301ﬃΣ")).toEqual({
      folded: "😀affiς",
      starts: [0, 0, 2, 4, 4, 4, 5],
      ends: [2, 2, 4, 5, 5, 5, 6],
    });
  });
});

describe("the two folds are twins", () => {
  /* src/web/library-hits.ts and src/library-search.ts each say they must stay
     twins, and until 2026-10-03 nothing imported both. They had already parted:
     this one lowercased a character at a time, so a word-final Σ came out σ
     here and ς there, and it normalised a code point at a time, so pointed
     Hebrew typed in the usual order came out in a different order. */
  const STRINGS = [
    "plain ASCII, Mixed Case",
    "Gödel café naïve",
    "decomposed cafe\u0301",
    "don’t “quote” ‘single’ „low“ ‛rev",
    "a—b – c",
    "eﬃcient ﬁsh ½ ²",
    "İstanbul and ı",
    "ΟΔΟΣ ΟΔΟΣ. ΣΟΦΟΣ",
    "\u05D1\u05BC\u05B7\u05D9\u05B4\u05EA",
    "😀 emoji 𐐀𐐁 deseret",
    "\u0301leading mark",
    "한국어 ｆｕｌｌｗｉｄｔｈ",
    // Halfwidth katakana: U+FF9E is a letter that NFKD turns into a combining mark.
    "\uff76\uff9e\u0301\u05bc\uff9e",
    "A\u05b0\uff9e and \uff8a\uff9f\u05b0\uff9f",
    // Lone surrogates, including a pair exposed when an intervening mark is removed.
    "\ud801\u0301\udc00 Σ\ud800\udfff",
    "",
  ];
  it.each(STRINGS)("fold(%j) is the server's", (s) => {
    expect(fold(s)).toBe(serverFold(s));
  });
  it.each(STRINGS)("foldWithMap(%j) has server parity and ordered source spans", (s) => {
    const { folded, starts, ends } = foldWithMap(s);
    expect(folded).toBe(serverFold(s));
    expect(starts).toHaveLength(folded.length);
    expect(ends).toHaveLength(folded.length);
    for (let i = 0; i < folded.length; i++) {
      expect(starts[i]).toBeGreaterThanOrEqual(i === 0 ? 0 : starts[i - 1]!);
      expect(ends[i]).toBeGreaterThan(starts[i]!);
      expect(ends[i]).toBeLessThanOrEqual(s.length);
      if (i > 0) expect(ends[i]).toBeGreaterThanOrEqual(ends[i - 1]!);
    }
  });
});

describe("query terms", () => {
  it("drops the syntax neither matcher shares", () => {
    expect(queryTerms('writing OR "hard problem" -qualia')).toEqual(["writing", "hard", "problem"]);
  });

  it("drops terms too short to rank anything", () => {
    expect(queryTerms("a of the")).toEqual(["of", "the"]);
  });
});
