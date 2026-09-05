/**
 * `describeArticle` — the shelf card, assembled from things already in memory.
 *
 * Pure: no filesystem, no database. The function lives in
 * src/library-scalars.ts, beside `deriveLibraryScalars`, which is where it
 * moved on 2026-09-05 when src/api.ts was deleted with the filesystem store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G).
 *
 * **Three `describe` blocks went with that file**, and they were the reason
 * this suite ran against the real repository: `listArticles` reading `data/`
 * and the committed `example/` fixture, a comment count read out of
 * `comments.json`, and a half-built `data/<slug>/` being skipped rather than
 * listed. Their Postgres counterparts are `tests/store-shelf-pg.test.ts` (the
 * shelf's reads and writes) and `tests/store-parity.test.ts` (the whole corpus
 * listed, dated and ordered). The one claim with no counterpart is the
 * `example/` fixture always listing, and it went with the fixture's shelf entry
 * rather than with this file. See docs/project/library.md.
 */
import { describe, expect, it } from "vitest";
import { deriveLibraryScalars, describeArticle } from "../src/library-scalars.js";
import { readingMinutes } from "../src/reading-time.js";
import type { Block, Tree } from "../src/types.js";

describe("describeArticle", () => {
  /**
   * **It receives the five numbers now; it does not derive them.**
   *
   * It used to take `blocks` and `tree` and compute `words`, `blocks`, `parts`,
   * `sections` and the blurb — which made it a second implementation of
   * `deriveLibraryScalars`, and a review had already caught the two disagreeing
   * about the `excerpt` rung. So the fallback chain's own cases moved to
   * tests/store-revision-policy.test.ts, where that function lives, and what is
   * left here is what this function still decides: the shape of the entry.
   *
   * The chain is exercised through the real function rather than by handing
   * these tests literal scalars, so "describeArticle prints the blurb it was
   * given" and "the blurb is the one the rules produce" are both covered and
   * neither is assumed.
   */
  const blocks: Block[] = [
    { id: "spya-aaaaaa", tag: "p", kind: "text", text: "a", words: 500, html: "", gistable: true },
    { id: "spya-bbbbbb", tag: "p", kind: "text", text: "b", words: 500, html: "", gistable: true },
  ];
  const range: [string, string] = ["spya-aaaaaa", "spya-bbbbbb"];
  const tree: Tree = {
    version: "v",
    generator: "g",
    slug: "s",
    rootId: "n1",
    nodes: {
      n1: { id: "n1", depth: 0, parent: null, children: ["n2"], range, title: "T", gist: "The gist." },
      n2: { id: "n2", depth: 1, parent: "n1", children: [], range, title: "P" },
    },
  };
  const base = {
    slug: "s",
    meta: { slug: "s", title: "T" },
    scalars: deriveLibraryScalars({ blocks, tree }),
    comments: 0,
    addedAt: "2026-08-25T00:00:00.000Z",
  };

  /** The same tree with one rung of the blurb's fallback removed. */
  const withoutRootField = (field: "gist" | "summary"): Tree => {
    const copy = JSON.parse(JSON.stringify(tree)) as Tree;
    const root = copy.nodes.n1;
    if (!root) throw new Error("fixture lost its root");
    delete (root as unknown as Record<string, unknown>)[field];
    return copy;
  };

  /** The root of a copy, for a test that needs to write to it. */
  const rootOf = (t: Tree): Record<string, unknown> => {
    const root = t.nodes.n1;
    if (!root) throw new Error("fixture lost its root");
    return root as unknown as Record<string, unknown>;
  };

  it("prints the word count it was given, and turns it into minutes", () => {
    const entry = describeArticle(base);
    expect(entry.words).toBe(1000);
    expect(entry.minutes).toBe(readingMinutes(1000));
  });

  it("prints parts and sections, which are counted by depth and not by position", () => {
    const entry = describeArticle(base);
    expect(entry.parts).toBe(1);
    expect(entry.sections).toBe(0);
  });

  it("blurbs with the root gist — the whole piece in one sentence", () => {
    expect(describeArticle(base).gist).toBe("The gist.");
  });

  it("falls to the root summary when there is no gist", () => {
    /* **The rung nothing tested.** GPT Sol's sixth finding on
       docs/plans/260828c-library-read-latency.md: this chain had cases for its first
       rung and for its absence, and none for either of the two in between, so a
       change that dropped `root.summary` altogether would have gone green. */
    const noGist = withoutRootField("gist");
    rootOf(noGist).summary = "The root summary.";
    expect(describeArticle({ ...base, scalars: deriveLibraryScalars({ blocks, tree: noGist }) }).gist).toBe(
      "The root summary.",
    );
  });

  it("falls to the excerpt when the tree says nothing about itself", () => {
    const bare = withoutRootField("gist");
    expect(
      describeArticle({
        ...base,
        scalars: deriveLibraryScalars({ blocks, tree: bare, excerpt: "What the page says." }),
      }).gist,
    ).toBe("What the page says.");
  });

  it("leaves the blurb absent rather than substituting something narrower", () => {
    // No gist, no summary, no excerpt. The tempting fallback is the first arc
    // sentence, which describes the END OF PART ONE and would read as a
    // description of the article — wrong, and wrong in a way that looks right.
    const bare = withoutRootField("gist");
    const entry = describeArticle({ ...base, scalars: deriveLibraryScalars({ blocks, tree: bare }) });
    expect(entry.gist).toBeUndefined();
    /* Absent, not present-and-undefined: `exactOptionalPropertyTypes` is on and
       the two serialise the same, so `toBeUndefined` alone cannot tell them
       apart. */
    expect("gist" in entry).toBe(false);
  });

  it("omits fields it has no value for, rather than carrying undefined", () => {
    const entry = describeArticle(base);
    expect("byline" in entry).toBe(false);
    expect("fixture" in entry).toBe(false);
  });
});
