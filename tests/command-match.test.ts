/**
 * **The command bar's ranking, checked without rendering anything.**
 *
 * `rankModes` is a pure function of a string and a list precisely so that the
 * interesting cases can be stated here rather than through three layers of
 * markup — a tie, a word that is a prefix of one label and a substring of
 * another, a query with a doubled space in it. GPT Sol's F5 on
 * docs/plans/260906h-mode-catalog-and-a-command-bar.md is why the ranking is
 * five named tiers at all: "substring match, ordered somehow" is not a
 * specification and cannot be tested.
 *
 * ## The subset is the instrument
 *
 * `rankModes` takes the list to search, so most of these hand it three or five
 * modes rather than all fourteen. That is not a shortcut — it is what makes an
 * expectation about *tiers* readable: with all fourteen, one query's answer is
 * fourteen modes long and a change to one description rewrites the expectation
 * for reasons that have nothing to do with ranking. With five chosen modes, one
 * per tier, the assertion is the tier order and nothing else.
 *
 * **These do lean on the real catalog and the real labels**, deliberately: a
 * fixture would let the ranking pass here and be wrong about Hierarchy, which
 * is the mode a reader is most likely to reach for by a nickname (`toc`).
 * Where a test depends on a particular word, the comment says which word and
 * why it was chosen, so that whoever breaks it by editing copy can see what to
 * do.
 */
import { describe, expect, it } from "vitest";
import { MODES, type Mode } from "../src/modes.js";
import { canonical, rankModes } from "../src/web/command-match.js";

/**
 * **One mode per tier, for the query `"s"`**, and the whole point of the file.
 * Each line says which field carries the hit, because that is the fact the
 * ordering is about:
 *
 *  | mode | tier | why |
 *  |---|---|---|
 *  | `search` | label-prefix | *Search* begins with it |
 *  | `diagram` | alias-prefix | its alias *sketch* begins with it |
 *  | `ideas` | label-substring | *Ideas* has an `s`, not at the front |
 *  | `timeline` | alias-substring | *Timeline* has no `s`; its alias *dates* does |
 *  | `remember` | description-substring | neither *Remember* nor *recall* has one; its sentence does |
 *
 * `"s"` rather than a longer word because a single letter is the only query
 * that can reach all five tiers at once across five different modes.
 */
const ONE_PER_TIER: readonly Mode[] = ["search", "diagram", "ideas", "timeline", "remember"];

describe("rankModes ranks by how a query hits a mode", () => {
  it("puts the five tiers in order: label-prefix, alias-prefix, label-, alias-, description-substring", () => {
    expect(rankModes("s", ONE_PER_TIER)).toEqual([
      "search",
      "diagram",
      "ideas",
      "timeline",
      "remember",
    ]);
  });

  /**
   * **The ordering is the tiers and not the input**, which is the half the test
   * above cannot show on its own: handed in already-sorted, a function that did
   * no ranking at all would pass it.
   */
  it("reorders a list handed in worst-tier-first", () => {
    expect(rankModes("s", [...ONE_PER_TIER].reverse())).toEqual([
      "search",
      "diagram",
      "ideas",
      "timeline",
      "remember",
    ]);
  });

  it("prefers a label prefix to an alias prefix", () => {
    /* `sketch` is Diagram's alias and `Summary` is a label, so a matcher that
       ranked aliases first — or ranked nothing — would answer the other way. */
    expect(rankModes("s", ["diagram", "summary"])).toEqual(["summary", "diagram"]);
  });

  it("prefers a prefix to a substring of the same field", () => {
    /* Both hits are on the **label**: `Search` begins with `s` and `Ideas`
       merely contains one. So this separates the two label tiers from each
       other, where the test above separates labels from aliases. */
    expect(rankModes("s", ["ideas", "search"])).toEqual(["search", "ideas"]);
  });

  it("finds a mode by its alias alone", () => {
    /* `toc` was Hierarchy's name until 2026-08-29 and is still what most people
       call the thing, so it is the alias most likely to be typed. Nothing else
       in the app contains the letters. */
    expect(rankModes("toc", MODES)).toEqual(["hierarchy"]);
  });
});

describe("rankModes breaks ties in the order it was handed", () => {
  /**
   * **The tie-break is the promise that makes the result total.**
   *
   * `Search` and `Summary` are both label-prefix matches for `"s"`, so nothing
   * about the query separates them and the only honest answer is *the order the
   * Dock draws them in* — which arrives as the order of the array. Both
   * directions are asserted, because a function that always returned one fixed
   * order would pass either one alone.
   */
  it("keeps two equal matches in input order, whichever order that is", () => {
    expect(rankModes("s", ["search", "summary"])).toEqual(["search", "summary"]);
    expect(rankModes("s", ["summary", "search"])).toEqual(["summary", "search"]);
  });

  it("keeps every mode in input order for an empty query", () => {
    /* The bar opens showing everything, so the reader can see what there is to
       ask for rather than guessing a first letter. */
    expect(rankModes("", MODES)).toEqual([...MODES]);
    expect(rankModes("", [...MODES].reverse())).toEqual([...MODES].reverse());
  });

  it("treats a query of nothing but whitespace as empty", () => {
    expect(rankModes("   ", ["chat", "plain"])).toEqual(["chat", "plain"]);
  });
});

describe("rankModes normalises what the reader typed", () => {
  it("ignores case", () => {
    expect(rankModes("TOC", MODES)).toEqual(["hierarchy"]);
  });

  it("ignores padding", () => {
    expect(rankModes("  toc  ", MODES)).toEqual(["hierarchy"]);
  });

  /**
   * **The doubled internal space, which is the one that is easy to get wrong.**
   *
   * `peer review` is Referee's alias, and GPT Sol reproduced the hole on
   * 2026-09-07: a normaliser that trims and lowercases but does not *collapse*
   * lets `"peer  review"` sit in a table looking correct and match nothing. The
   * same function guards the table itself — tests/mode-catalog.test.ts imports
   * this one — so the two cannot disagree.
   */
  it("collapses runs of internal whitespace", () => {
    expect(rankModes("peer  review", MODES)).toEqual(["referee"]);
    expect(rankModes("PEER \t REVIEW ", MODES)).toEqual(["referee"]);
  });

  it("matches nothing when nothing matches, rather than falling back to everything", () => {
    /* The empty query returns all fourteen, so a matcher that treated "no hits"
       as "no filter" would be indistinguishable from one that worked, right up
       until a reader typed a typo and got the whole list back. */
    expect(rankModes("zzzq", MODES)).toEqual([]);
  });
});

describe("canonical is the one normaliser", () => {
  it("lowercases, trims and collapses", () => {
    expect(canonical("  Peer   Review ")).toBe("peer review");
    expect(canonical("TOC")).toBe("toc");
    expect(canonical("a\t\nb")).toBe("a b");
  });

  /**
   * **Idempotent**, which is what lets `rankModes` canonicalise input a caller
   * may already have canonicalised without the answer depending on how many
   * times it happened.
   */
  it("is idempotent", () => {
    for (const s of ["  Peer   Review ", "toc", "", "   ", "A B  C"]) {
      expect(canonical(canonical(s))).toBe(canonical(s));
    }
  });
});
