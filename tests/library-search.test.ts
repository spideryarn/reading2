/**
 * `parseQuery` and `fold` — what is left of `src/library-search.ts`.
 *
 * **This file used to drive `searchLibrary`**, the filesystem library search,
 * against real files under `data/`. That function went on 2026-09-05 with the
 * rest of the filesystem store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * the stage-G section). What ships is `pgLibrarySearch`, and
 * `tests/store-shelf-pg.test.ts` § *searching* already held a counterpart for
 * almost every case that was here: finding a passage and carrying the whole
 * paragraph, ignoring non-gistable blocks, ranking a dense short paragraph above
 * a long thin one, saying when it capped, an archived article leaving the index
 * entirely, `excludeSlug` applying before the cap and doing nothing for a slug
 * that is not there, and an empty query answering with nothing.
 *
 * **What had no home is what this file is now.** `parseQuery` and `fold` are
 * exported for `src/chat-tools.ts` — chat parses the reader's words with this
 * exact function rather than a second one — and for
 * `evals/embedding-retrieval.ts`, whose literal baseline is the scan
 * `searchLibrary` used to run. Neither had a single direct test: the three
 * `fold` cases in `tests/library-hits.test.ts` are the **client's** copy in
 * `src/web/library-hits.ts`, a different function with a different job (it
 * carries an offset map). So the folding and quoting rules were reaching two
 * callers through nothing at all, and they are here now.
 *
 * **Two cases died with the walk**, and neither has a home:
 *
 * - *"still finds a passage inside a footnote"* — `isSearchable` is the one
 *   block predicate of the five that **includes** supplements, and nothing in
 *   `tests/store-shelf-pg.test.ts` puts a supplement in the corpus. The
 *   Postgres side answers this with the `tsvector` trigger's block filter
 *   rather than with `isSearchable`, so it is not the same claim in a new
 *   place; it is a claim about a different mechanism that nobody has written.
 * - *"requires every term, not any of them"* — an AND at the **matcher**, which
 *   is now `websearch_to_tsquery`'s own default rather than a loop we own.
 *   § *understands websearch syntax rather than throwing on it* is what stands
 *   in its place. The parser's half of it — that a bare query yields several
 *   terms for a caller to require all of — is the first case below.
 */
import { describe, expect, it } from "vitest";
import { fold, parseQuery } from "../src/library-search.js";

describe("parseQuery", () => {
  it("gives back every word, for a caller that will require all of them", () => {
    // The matcher ANDs these. That rule lives with whoever is matching —
    // `pgLibrarySearch`, `searchArticleWords` in src/chat-tools.ts, the
    // baseline in evals/embedding-retrieval.ts — and all three get the same
    // list because they all call this.
    expect(parseQuery("qualia hard problem")).toEqual({
      terms: ["qualia", "hard", "problem"],
      phrases: [],
    });
  });

  it("folds while it parses, so the caller never has to remember to", () => {
    // A caller that folded the haystack and not the needle would match nothing
    // and report it as "no hits", which is the shape of failure this whole
    // module is arranged against.
    expect(parseQuery("Gödel  DÖNER")).toEqual({ terms: ["godel", "doner"], phrases: [] });
  });

  it("drops one-character terms, which match everything and rank nothing", () => {
    // Postgres throws them away too, as stop words — differently, and that
    // difference is declared in `parseQuery`'s docstring rather than pretended
    // away.
    expect(parseQuery("a qualia I").terms).toEqual(["qualia"]);
  });

  it("keeps a quoted phrase whole, spaces and all", () => {
    // Pulled out *before* the whitespace split, or the phrase's inner spaces
    // would become term boundaries and `"hard problem"` would be two terms that
    // may sit paragraphs apart.
    expect(parseQuery('"hard problem" qualia')).toEqual({
      terms: ["qualia"],
      phrases: ["hard problem"],
    });
  });

  it("takes curly quotes too, because that is what the keyboard produces", () => {
    // A phrase typed on a Mac with smart quotes on must not silently become
    // two loose terms — the results would be plausible and wrong.
    expect(parseQuery("“hard problem”").phrases).toEqual(["hard problem"]);
  });

  it("answers an empty or whitespace query with nothing to look for", () => {
    // Every caller checks `needles.length === 0` and returns no hits. An empty
    // needle list that reached a substring scan would match every paragraph in
    // the library.
    expect(parseQuery("")).toEqual({ terms: [], phrases: [] });
    expect(parseQuery("   ").terms).toEqual([]);
    expect(parseQuery('""').phrases).toEqual([]);
  });
});

describe("fold", () => {
  it("folds case and accents, so godel finds Gödel", () => {
    // The ordinary thing a reader does, and the thing a naive `toLowerCase`
    // gets wrong silently. NFKD then strip the combining marks.
    expect(fold("Gödel")).toBe("godel");
    expect(fold("CAFÉ")).toBe("cafe");
  });

  it("flattens the punctuation the article has and the keyboard does not", () => {
    expect(fold("don’t")).toBe("don't");
    expect(fold("“quoted”")).toBe('"quoted"');
    expect(fold("a—b")).toBe("a-b");
  });

  it("is not length-preserving, which is why no offset may cross it", () => {
    /* The hazard written out in the function's own docstring: NFKD expands the
       `fi` ligature to two characters, so an offset taken in the folded text
       and used against the original drifts by one per ligature before it — with
       no error and nothing to grep for. An earlier draft of the deleted
       `searchLibrary` did exactly that to cut a snippet. This is the assertion
       that says the hazard is real rather than folklore. */
    expect(fold("ﬁn").length).toBe(3);
    expect("ﬁn".length).toBe(2);
  });
});
