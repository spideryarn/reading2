/**
 * The shelf — `listArticles` and `describeArticle` in src/api.ts.
 *
 * Runs against the real repository, which is the point: the committed
 * `example/` fixture must always list, because it is the only thing a fresh
 * clone has and an empty homepage looks like a broken one rather than an empty
 * shelf. See docs/project/library.md.
 */
import { cp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describeArticle, listArticles, loadArticle } from "../src/api.js";
import { deriveLibraryScalars } from "../src/library-scalars.js";
import { readingMinutes } from "../src/reading-time.js";
import { createComment } from "../src/comments.js";
import type { Block, Tree } from "../src/types.js";

/** A throwaway article under data/, which is gitignored. Removed after each test. */
const SLUG = "test-library-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
const EXAMPLE = path.resolve(import.meta.dirname, "..", "example");
afterEach(() => rm(DIR, { recursive: true, force: true }));

describe("listArticles", () => {
  it("always lists the committed fixture, whatever else is on disk", async () => {
    const articles = await listArticles();
    const fixture = articles.find((a) => a.slug === "example");
    expect(fixture).toBeDefined();
    expect(fixture?.fixture).toBe(true);
  });

  it("lists the fixture under a slug that opens it", async () => {
    // Not the slug inside example/meta.json — that one names the full article
    // the fixture is an excerpt of, and following it would open a different
    // piece (or, in a fresh clone, fall back here again by accident).
    const article = await loadArticle("example");
    expect(article.blocks.length).toBeGreaterThan(0);
  });

  it("gives every entry the counts a card needs", async () => {
    for (const a of await listArticles()) {
      expect(a.title, a.slug).toBeTruthy();
      expect(a.title, a.slug).not.toBe(a.slug); // a slug is not a title
      expect(a.words, a.slug).toBeGreaterThan(0);
      expect(a.blocks, a.slug).toBeGreaterThan(0);
      expect(a.minutes, a.slug).toBe(readingMinutes(a.words));
      expect(Number.isNaN(Date.parse(a.addedAt)), a.slug).toBe(false);
    }
  });

  it("puts real articles above the fixture, then newest first", async () => {
    const articles = await listArticles();
    const firstFixture = articles.findIndex((a) => a.fixture);
    if (firstFixture !== -1) {
      expect(articles.slice(firstFixture).every((a) => a.fixture)).toBe(true);
    }
    const real = articles.filter((a) => !a.fixture).map((a) => a.addedAt);
    expect([...real].sort().reverse()).toEqual(real);
  });
});

describe("counting a real article's comments", () => {
  it("counts them, rather than reporting none because the file isn't the shape it looks", async () => {
    // This is the test for a bug that shipped: `comments.json` is
    // `{ comments: [...] }` and NOT a bare array, so reading it as an array
    // counted every article as having none — and every article plausibly does
    // have none, so the wrong answer looked exactly like the right one
    // (docs/reusable/silent-success.md). Asserting a NON-ZERO count is the
    // whole point; an assertion that it is a number would have passed.
    await cp(EXAMPLE, DIR, { recursive: true });
    await createComment(SLUG, { blockId: "spya-k3m9qt", quote: "a quote", start: 0 });
    await createComment(SLUG, { blockId: "spya-k3m9qt", quote: "another", start: 8 });

    const entry = (await listArticles()).find((a) => a.slug === SLUG);
    expect(entry?.comments).toBe(2);
  });
});

describe("a half-built directory", () => {
  it("is skipped, not listed as an article that fails to open", async () => {
    // Extracted but never given a tree — which is exactly what `data/<slug>/`
    // looks like between `npm run extract` and `npm run toc`.
    await cp(EXAMPLE, DIR, { recursive: true });
    await rm(path.join(DIR, "tree.json"));
    expect((await listArticles()).some((a) => a.slug === SLUG)).toBe(false);
  });

  it("still lists one whose meta.json never got written", async () => {
    await cp(EXAMPLE, DIR, { recursive: true });
    await rm(path.join(DIR, "meta.json"));
    const entry = (await listArticles()).find((a) => a.slug === SLUG);
    // Title from the article's own first heading, date from the file's mtime.
    expect(entry?.title).toBeTruthy();
    expect(entry?.title).not.toBe(SLUG);
    expect(Number.isNaN(Date.parse(entry?.addedAt ?? ""))).toBe(false);
    expect(entry?.byline).toBeUndefined();
  });

  it("sorts on meta.fetchedAt where stage 2 recorded one", async () => {
    await cp(EXAMPLE, DIR, { recursive: true });
    const meta = { slug: SLUG, title: "Fresh", fetchedAt: "2099-01-01T00:00:00.000Z" };
    await writeFile(path.join(DIR, "meta.json"), JSON.stringify(meta), "utf8");
    const articles = await listArticles();
    expect(articles[0]?.slug).toBe(SLUG);
    expect(articles[0]?.addedAt).toBe(meta.fetchedAt);
  });
});

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
       docs/plans/library-read-latency.md: this chain had cases for its first
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
