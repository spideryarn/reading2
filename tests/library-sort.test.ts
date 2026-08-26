/**
 * How the shelf is ordered — src/web/library-sort.ts.
 *
 * The sort moved from the server into the browser on 2026-08-26, and three of
 * the rules that came with it are exactly the kind that look right in a browser
 * and are wrong: the fixture staying at the foot of every order, an article
 * with no value for the key sorting last in *both* directions, and equal rows
 * having a defined order at all. A shelf that quietly reshuffles on reload
 * looks like nothing in particular.
 *
 * Pure module, node environment, no React — same arrangement and same reason as
 * tests/library-hits.test.ts.
 *
 * See docs/project/library.md § Sorting the shelf.
 */
import { describe, expect, it } from "vitest";
import type { LibraryEntry } from "../src/types.js";
import {
  applyFilter,
  DEFAULT_SORT,
  directionLabel,
  isSortKey,
  nextSort,
  SORTS,
  sortEntries,
  sortSpec,
} from "../src/web/library-sort.js";

const entry = (over: Partial<LibraryEntry> & { slug: string }): LibraryEntry => ({
  title: over.slug,
  addedAt: "2026-08-01T00:00:00.000Z",
  words: 1000,
  minutes: 5,
  blocks: 10,
  parts: 2,
  sections: 4,
  comments: 0,
  opens: 0,
  has: { arc: false, tweets: false, glossary: false, summary: false },
  ...over,
});

const slugs = (list: LibraryEntry[]) => list.map((e) => e.slug);

describe("sortEntries", () => {
  it("orders by the key, both ways", () => {
    const list = [
      entry({ slug: "b", words: 2000 }),
      entry({ slug: "a", words: 500 }),
      entry({ slug: "c", words: 9000 }),
    ];
    expect(slugs(sortEntries(list, "length", "desc"))).toEqual(["c", "b", "a"]);
    expect(slugs(sortEntries(list, "length", "asc"))).toEqual(["a", "b", "c"]);
  });

  it("never mutates the array it is given", () => {
    // The array is React state. Sorting it in place changes a rendered list
    // without changing its identity — correct output, wrong render, later.
    const list = [entry({ slug: "b", words: 2 }), entry({ slug: "a", words: 1 })];
    const before = slugs(list);
    sortEntries(list, "length", "asc");
    expect(slugs(list)).toEqual(before);
  });

  it("keeps the fixture at the foot of every sort, in both directions", () => {
    // The server did this and the browser has to keep doing it: without the
    // rule, "longest first" puts a committed demo excerpt above the reader's
    // own library, and nothing about that looks like a bug.
    const list = [
      entry({ slug: "real", words: 100 }),
      entry({ slug: "example", words: 99999, fixture: true }),
    ];
    for (const dir of ["asc", "desc"] as const) {
      for (const { key } of SORTS) {
        expect(slugs(sortEntries(list, key, dir)).at(-1)).toBe("example");
      }
    }
  });

  it("sorts a missing value last whichever way the arrow points", () => {
    /* The one that would have been wrong if the absent case were multiplied by
       the direction. Ascending by "last opened" would then mean every article
       you have never opened at the top — a useful thing to want, and the reason
       the Unread filter exists rather than the sort's low end meaning it. */
    const list = [
      entry({ slug: "never" }),
      entry({ slug: "old", lastOpenedAt: "2026-01-01T00:00:00.000Z" }),
      entry({ slug: "new", lastOpenedAt: "2026-08-20T00:00:00.000Z" }),
    ];
    expect(slugs(sortEntries(list, "opened", "desc"))).toEqual(["new", "old", "never"]);
    expect(slugs(sortEntries(list, "opened", "asc"))).toEqual(["old", "new", "never"]);
  });

  it("treats an unparseable date as absent rather than as zero", () => {
    // `Date.parse("soon")` is NaN, and NaN in a subtraction makes every
    // comparison return NaN — a sort that silently does nothing at all.
    const list = [
      entry({ slug: "junk", addedAt: "soon" }),
      entry({ slug: "real", addedAt: "2026-08-02T00:00:00.000Z" }),
    ];
    expect(slugs(sortEntries(list, "added", "desc"))).toEqual(["real", "junk"]);
    expect(slugs(sortEntries(list, "added", "asc"))).toEqual(["real", "junk"]);
  });

  it("counts zero as a value, not as absent", () => {
    // `opens: 0` and `comments: 0` are answers. Only a date we do not have is
    // absent, and a falsy check here would have put every unopened article
    // below every opened one in both directions.
    const list = [entry({ slug: "none", opens: 0 }), entry({ slug: "some", opens: 3 })];
    expect(slugs(sortEntries(list, "opens", "asc"))).toEqual(["none", "some"]);
  });

  it("breaks ties by title and then slug, so the order is total", () => {
    const list = [
      entry({ slug: "z", title: "Same" }),
      entry({ slug: "a", title: "Same" }),
      entry({ slug: "m", title: "Another" }),
    ];
    // Same key value for all three, so the whole order comes from the tiebreak
    // — and it must not depend on the order the server sent them in.
    expect(slugs(sortEntries(list, "length", "desc"))).toEqual(["m", "a", "z"]);
    expect(slugs(sortEntries([...list].reverse(), "length", "desc"))).toEqual(["m", "a", "z"]);
  });

  it("sorts titles by what the reader sees, ignoring case and accents", () => {
    const list = [
      entry({ slug: "1", title: "zebra" }),
      entry({ slug: "2", title: "Étude" }),
      entry({ slug: "3", title: "Apple" }),
    ];
    expect(slugs(sortEntries(list, "title", "asc"))).toEqual(["3", "2", "1"]);
  });

  it("orders numbers in titles the way a person reads them", () => {
    const list = [entry({ slug: "a", title: "Part 10" }), entry({ slug: "b", title: "Part 2" })];
    expect(slugs(sortEntries(list, "title", "asc"))).toEqual(["b", "a"]);
  });

  it("falls back to the default sort for a key it does not know", () => {
    // The URL is user input. An unknown `?sort=` must degrade to the shelf's
    // ordinary order rather than to an empty list or a crash.
    expect(sortSpec("nonsense" as never).key).toBe(DEFAULT_SORT);
    expect(isSortKey("nonsense")).toBe(false);
    expect(isSortKey("opened")).toBe(true);
  });
});

describe("the card's note", () => {
  it("says something for every sort whose key the card does not already show", () => {
    // The point of the note: a card sorted by something invisible is a list in
    // an order the reader cannot check.
    const e = entry({ slug: "a", opens: 2, comments: 1, lastOpenedAt: "2026-08-20T00:00:00.000Z" });
    for (const key of ["opened", "opens", "questions"] as const) {
      expect(sortSpec(key).note?.(e)).toBeTruthy();
    }
    // Added and length are already on the card. Nothing to add.
    expect(sortSpec("added").note).toBeUndefined();
    expect(sortSpec("length").note).toBeUndefined();
  });

  it("says 'never opened' rather than nothing", () => {
    const e = entry({ slug: "a" });
    expect(sortSpec("opened").note?.(e)).toBe("never opened");
    expect(sortSpec("opens").note?.(e)).toBe("never opened");
  });
});

describe("applyFilter", () => {
  it("keeps only what has never been opened", () => {
    const list = [entry({ slug: "read", opens: 4 }), entry({ slug: "not", opens: 0 })];
    expect(slugs(applyFilter(list, "unread"))).toEqual(["not"]);
    expect(slugs(applyFilter(list, "all"))).toEqual(["read", "not"]);
  });

  it("leaves the fixture in", () => {
    // It is the demonstration of the reading view, and hiding it from the one
    // filter a new reader is likeliest to press would empty a fresh shelf.
    const list = [entry({ slug: "example", fixture: true })];
    expect(slugs(applyFilter(list, "unread"))).toEqual(["example"]);
  });
});

describe("nextSort", () => {
  it("reverses the key you are already on", () => {
    expect(nextSort("added", "desc", "added")).toEqual({ by: "added", dir: "asc" });
    expect(nextSort("added", "asc", "added")).toEqual({ by: "added", dir: "desc" });
  });

  it("starts a new key at its own natural end, not the one you were on", () => {
    /* The half that is easy to leave out. Going from "newest first" to Title
       must not mean Z-to-A: `desc` was carried over from a key where it meant
       something else. */
    expect(nextSort("added", "desc", "title")).toEqual({ by: "title", dir: "asc" });
    expect(nextSort("title", "asc", "length")).toEqual({ by: "length", dir: "desc" });
  });
});

describe("directionLabel", () => {
  it("names the end in the key's own words", () => {
    // Not "ascending"/"descending", which say nothing about dates or lengths.
    expect(directionLabel("added", "desc")).toBe("newest first");
    expect(directionLabel("added", "asc")).toBe("oldest first");
    expect(directionLabel("title", "asc")).toBe("A to Z");
  });
});
