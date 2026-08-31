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
 */
import { describe, expect, it } from "vitest";
import { fold, foldWithMap, libraryHitHref, queryTerms } from "../src/web/library-hits.js";
import type { LibraryHit } from "../src/types.js";

const hit = (text: string, over: Partial<LibraryHit> = {}): LibraryHit => ({
  slug: "an-article",
  title: "An Article",
  blockId: "spya-k3m9qt",
  text,
  rank: 1,
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
    const p = params(libraryHitHref(hit("a café in paris"), "café"));
    expect(p.get("find")).toBe("cafe");
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
});

describe("query terms", () => {
  it("drops the syntax neither matcher shares", () => {
    expect(queryTerms('writing OR "hard problem" -qualia')).toEqual(["writing", "hard", "problem"]);
  });

  it("drops terms too short to rank anything", () => {
    expect(queryTerms("a of the")).toEqual(["of", "the"]);
  });
});
