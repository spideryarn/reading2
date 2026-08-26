/**
 * The URL is the sorting state — src/web/lib/table-sort.ts.
 *
 * Pure, no React, no table. The rules here are the ones a browser cannot show
 * you: a link that half-specifies an order, a default that gets stamped onto
 * every URL because two arrays are never `===`, and a row that has to stay at
 * the bottom of every sort.
 */
import { describe, expect, it } from "vitest";
import {
  isAllNatural,
  sameList,
  sinkLast,
  sortingFromUrl,
  sortingToUrl,
  type NaturalDirections,
} from "../src/web/lib/table-sort.js";

const natural: NaturalDirections = { added: "desc", title: "asc", length: "desc" };

describe("sortingFromUrl", () => {
  it("pairs by and dir positionally", () => {
    expect(sortingFromUrl(["length", "title"], ["desc", "asc"], natural)).toEqual([
      { id: "length", desc: true },
      { id: "title", desc: false },
    ]);
  });

  it("falls back to each column's own end when dir is absent", () => {
    /* This is what lets `?by=title` be a link somebody can type. Note the two
       columns get *different* answers from the same missing parameter — which
       is why a parser default of `desc` would have been wrong. */
    expect(sortingFromUrl(["title"], [], natural)).toEqual([{ id: "title", desc: false }]);
    expect(sortingFromUrl(["added"], [], natural)).toEqual([{ id: "added", desc: true }]);
  });

  it("fills in only the entries dir is missing", () => {
    expect(sortingFromUrl(["length", "title"], ["asc"], natural)).toEqual([
      { id: "length", desc: false },
      { id: "title", desc: false },
    ]);
  });

  it("drops a column the table does not have", () => {
    /* The URL is user input. An id TanStack does not recognise sorts by nothing
       while looking like it sorted — so a mangled link has to degrade to the
       ordinary page rather than to a silent no-op. */
    expect(sortingFromUrl(["nonsense", "title"], [], natural)).toEqual([
      { id: "title", desc: false },
    ]);
  });

  it("keeps dir paired to the position in `by`, not to what survived", () => {
    /* The one that reads fine and is wrong. Filtering unknown ids *before*
       mapping and then using the surviving array's index hands Title the
       direction that was meant for the id we dropped — so a link built by
       someone else, or an id we renamed, silently reverses a column. Found by
       a cross-family review, 2026-08-26. */
    expect(sortingFromUrl(["nonsense", "title"], ["desc", "asc"], natural)).toEqual([
      { id: "title", desc: false },
    ]);
    expect(sortingFromUrl(["", "length"], ["asc", "desc"], natural)).toEqual([
      { id: "length", desc: true },
    ]);
  });

  it("drops a repeated column rather than sorting by it twice", () => {
    // `?by=title,title&dir=asc,desc` is two contradictory instructions about
    // one column; TanStack would apply the first and ignore the second without
    // saying so.
    expect(sortingFromUrl(["title", "title"], ["asc", "desc"], natural)).toEqual([
      { id: "title", desc: false },
    ]);
  });

  it("falls back rather than returning an empty sort", () => {
    /* An empty sort is not a state a reader can ask for or see the name of:
       every chip reads unpressed and the list sits in whatever order the data
       arrived in. So a URL naming nothing we recognise lands on the default. */
    expect(sortingFromUrl(["nonsense"], [], natural, ["added"])).toEqual([
      { id: "added", desc: true },
    ]);
    expect(sortingFromUrl([], [], natural, ["added"])).toEqual([{ id: "added", desc: true }]);
    // Without a fallback it is still allowed to be empty — the caller decides.
    expect(sortingFromUrl(["nonsense"], [], natural)).toEqual([]);
  });
});

describe("isAllNatural", () => {
  it("is true only when every key is at its own natural end", () => {
    /* This is what decides whether `?dir=` goes in the URL at all, and it has
       to be a separate question from nuqs's `clearOnDefault` because the
       default is per column rather than one value. Giving `dir` a parser
       default of `["desc"]` instead made `?by=title` sort Z-to-A — the exact
       thing the per-column fallback exists to prevent. */
    expect(isAllNatural([{ id: "title", desc: false }], natural)).toBe(true);
    expect(isAllNatural([{ id: "added", desc: true }], natural)).toBe(true);
    expect(isAllNatural([{ id: "title", desc: true }], natural)).toBe(false);
    expect(
      isAllNatural([{ id: "added", desc: true }, { id: "title", desc: true }], natural),
    ).toBe(false);
    expect(isAllNatural([], natural)).toBe(true);
  });
});

describe("sortingToUrl", () => {
  it("round-trips", () => {
    const sorting = [
      { id: "length", desc: true },
      { id: "title", desc: false },
    ];
    const url = sortingToUrl(sorting);
    expect(url).toEqual({ by: ["length", "title"], dir: ["desc", "asc"] });
    expect(sortingFromUrl(url.by, url.dir, natural)).toEqual(sorting);
  });
});

describe("sameList", () => {
  it("compares contents, because two arrays are never ===", () => {
    /* nuqs uses this to recognise the default and leave it out of the URL.
       Without it, every link to the homepage carries `?by=added&dir=desc`. */
    expect(sameList(["added"], ["added"])).toBe(true);
    expect(sameList(["added"], ["title"])).toBe(false);
    expect(sameList(["added"], ["added", "title"])).toBe(false);
    expect(sameList([], [])).toBe(true);
  });
});

describe("sinkLast", () => {
  it("moves the matches to the end, keeping both groups in order", () => {
    expect(sinkLast(["a", "X", "b", "Y"], (v) => v === v.toUpperCase())).toEqual([
      "a",
      "b",
      "X",
      "Y",
    ]);
  });

  it("returns the original array when nothing sinks", () => {
    // Identity matters: this feeds a `useMemo` whose result decides whether the
    // whole list re-renders.
    const rows = ["a", "b"];
    expect(sinkLast(rows, () => false)).toBe(rows);
  });

  it("does not mutate what it is given", () => {
    const rows = ["a", "X", "b"];
    sinkLast(rows, (v) => v === "X");
    expect(rows).toEqual(["a", "X", "b"]);
  });
});
