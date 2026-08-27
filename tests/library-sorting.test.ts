/**
 * How the shelf is ordered — the real table, not a stand-in.
 *
 * ## Why this builds a TanStack table rather than testing a function
 *
 * The sort used to be a pure function of ours, and these rules were assertions
 * about it. Since 2026-08-26 they are **configuration**: `sortUndefined: "last"`
 * on the default column, `sortDescFirst` per column, `enableSortingRemoval:
 * false`, and accessors that must return `undefined` rather than `NaN`. A test
 * that re-implemented the comparator would go on passing while the config that
 * actually runs was wrong — which is the whole failure mode this repo keeps
 * writing up.
 *
 * So this drives `@tanstack/table-core` directly, with the same column
 * definitions the page uses, and asserts the order that comes out. No React and
 * no DOM: `createTable` is framework-agnostic, and nothing here renders a cell.
 *
 * The rules being pinned are the ones that look right in a browser and are
 * wrong — see docs/plans/library-sorting.md § Three rules a browser cannot check.
 */
import { describe, expect, it } from "vitest";
import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  type TableOptionsResolved,
  type TableState,
} from "@tanstack/table-core";
import type { LibraryEntry } from "../src/types.js";
import { CHIP_ORDER, DEFAULT_BY, libraryColumns } from "../src/web/library-columns.js";
import { sortingFromUrl } from "../src/web/lib/table-sort.js";
import type { Shelf } from "../src/web/ShelfEntry.js";
import { sinkLast } from "../src/web/lib/table-sort.js";
import { naturalDirections, toggleSort } from "../src/web/lib/DataTable.js";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");

/** Nothing here renders a cell, so the shelf's verbs are never reached. */
const NO_SHELF = {} as Shelf;

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

/**
 * A live table over the real columns.
 *
 * `createTable` wants its state managed from outside — that is what the React
 * adapter does — so this wires the smallest possible version of it. The data is
 * pre-sorted by slug for the same reason `useSortedTable` does it: TanStack's
 * last-resort tiebreak is `rowA.index`, so a stable incoming order is what
 * turns that into a real total order.
 */
function order(data: LibraryEntry[], sorting: SortingState): string[] {
  const ordered = [...data].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  let state: TableState;
  const options: TableOptionsResolved<LibraryEntry> = {
    data: ordered,
    columns: libraryColumns(NO_SHELF, NOW),
    state: {} as TableState,
    onStateChange: () => {},
    renderFallbackValue: null,
    getRowId: (row) => row.slug,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: true,
    enableSortingRemoval: false,
    // Off, exactly as the app has it — see the "missing" tests below.
    defaultColumn: { sortUndefined: false },
  };

  const table = createTable(options);
  state = { ...table.initialState, sorting };
  table.setOptions((prev) => ({ ...prev, state }));

  /* The same two sinks the page applies, in the same order — see Library.tsx.
     They are part of the ordering rule rather than a rendering detail, so a
     test of the order has to include them or it is testing something else. */
  const primary = sorting[0]?.id;
  const rows = table.getRowModel().rows;
  const missingLast = primary
    ? sinkLast(rows, (r) => r.getValue(primary) === undefined)
    : rows;
  return sinkLast(missingLast, (r) => !!r.original.fixture).map((r) => r.id);
}

const asc = (id: string): SortingState => [{ id, desc: false }];
const desc = (id: string): SortingState => [{ id, desc: true }];

/**
 * A live table whose sorting state can be driven, for testing what a click means.
 *
 * `toggleSort` is a rule we wrote *instead of* `column.getToggleSortingHandler()`,
 * so it has to be exercised against the real thing rather than described.
 */
function clickable(sorting: SortingState) {
  let state: TableState;
  const table = createTable<LibraryEntry>({
    data: [],
    columns: libraryColumns(NO_SHELF, NOW),
    state: {} as TableState,
    onStateChange: (updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
      table.setOptions((prev) => ({ ...prev, state }));
    },
    renderFallbackValue: null,
    getRowId: (row) => row.slug,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: true,
    enableSortingRemoval: false,
    defaultColumn: { sortUndefined: false },
  } as TableOptionsResolved<LibraryEntry>);
  state = { ...table.initialState, sorting };
  table.setOptions((prev) => ({ ...prev, state }));
  return table;
}

describe("the shelf's order", () => {
  it("sorts by the key, both ways", () => {
    const list = [
      entry({ slug: "b", words: 2000 }),
      entry({ slug: "a", words: 500 }),
      entry({ slug: "c", words: 9000 }),
    ];
    expect(order(list, desc("length"))).toEqual(["c", "b", "a"]);
    expect(order(list, asc("length"))).toEqual(["a", "b", "c"]);
  });

  it("keeps the fixture at the foot of every sort, in both directions", () => {
    /* The server has always done this and the browser has to keep doing it:
       without the rule, "longest first" puts a committed demo excerpt above the
       reader's own library, and nothing about that looks like a bug. */
    const list = [
      entry({ slug: "real", words: 100, opens: 0, comments: 0 }),
      entry({ slug: "example", words: 99999, opens: 99, comments: 99, fixture: true }),
    ];
    for (const id of ["added", "opened", "title", "length", "opens", "questions"]) {
      expect(order(list, asc(id)).at(-1)).toBe("example");
      expect(order(list, desc(id)).at(-1)).toBe("example");
    }
  });

  it("lands a bare URL on last-opened, most recent first", () => {
    /* **The shelf's resting state, pinned as behaviour rather than as a
       string.** Greg asked for this on 2026-08-27, and the version of this test
       that asserts `DEFAULT_BY[0] === "opened"` would pass while the shelf came
       out oldest-first — the direction is `sortDescFirst` on the column, which
       is somewhere else entirely. So this goes through the parser the page
       goes through, with the empty `by`/`dir` a bare `/` actually carries, and
       then asks the table what order that produces. */
    const natural = naturalDirections(libraryColumns(NO_SHELF, NOW));
    const resting = sortingFromUrl([], [], natural, DEFAULT_BY);
    expect(resting).toEqual([{ id: "opened", desc: true }]);

    const list = [
      entry({ slug: "yesterday", lastOpenedAt: "2026-08-25T00:00:00.000Z" }),
      entry({ slug: "today", lastOpenedAt: "2026-08-26T09:00:00.000Z" }),
      entry({ slug: "never" }),
    ];
    expect(order(list, resting)).toEqual(["today", "yesterday", "never"]);
  });

  it("puts the default sort's chip first in the row", () => {
    /* The chip row leads with whatever the shelf's resting state is, so that
       the order you are already in is the leftmost thing you see. Two constants
       in one file, and nothing but this connects them — CHIP_ORDER was quietly
       reordered by a refactor once already (2026-08-26). */
    expect(CHIP_ORDER[0]).toBe(DEFAULT_BY[0]);
    for (const id of DEFAULT_BY) expect(CHIP_ORDER).toContain(id);
  });

  it("sorts a missing value last whichever way the arrow points", () => {
    /* Ascending by "last opened" must not fill the top of the shelf with
       everything you have never opened: that is a useful thing to want, and it
       is what the Unread chip is for. */
    const list = [
      entry({ slug: "never" }),
      entry({ slug: "old", lastOpenedAt: "2026-01-01T00:00:00.000Z" }),
      entry({ slug: "new", lastOpenedAt: "2026-08-20T00:00:00.000Z" }),
    ];
    expect(order(list, desc("opened"))).toEqual(["new", "old", "never"]);
    expect(order(list, asc("opened"))).toEqual(["old", "new", "never"]);
  });

  it("treats an unparseable date as absent rather than as zero", () => {
    /* `Date.parse("soon")` is NaN, and NaN in a comparison is false in both
       directions — a sort that silently does nothing. The accessor has to
       return `undefined`, because that is the only thing `sortUndefined` looks
       for. */
    const list = [
      entry({ slug: "junk", addedAt: "soon" }),
      entry({ slug: "real", addedAt: "2026-08-02T00:00:00.000Z" }),
    ];
    expect(order(list, desc("added"))).toEqual(["real", "junk"]);
    expect(order(list, asc("added"))).toEqual(["real", "junk"]);
  });

  it("counts zero as a value, not as absent", () => {
    // `opens: 0` and `comments: 0` are answers. If the accessor returned
    // `undefined` for them, every unopened article would sit below every opened
    // one in both directions.
    const list = [entry({ slug: "none", opens: 0 }), entry({ slug: "some", opens: 3 })];
    expect(order(list, asc("opens"))).toEqual(["none", "some"]);
    expect(order(list, desc("opens"))).toEqual(["some", "none"]);
  });

  it("gives equal rows a defined order that survives a reshuffle", () => {
    /* TanStack's last-resort tiebreak is `rowA.index` — *the order the data
       arrived in*. So this only holds because the data is sorted by slug before
       the table sees it. Without that, a reload could reorder equal rows and
       nothing would look wrong. */
    const list = [entry({ slug: "z" }), entry({ slug: "a" }), entry({ slug: "m" })];
    expect(order(list, desc("length"))).toEqual(["a", "m", "z"]);
    expect(order([...list].reverse(), desc("length"))).toEqual(["a", "m", "z"]);
  });

  it("sorts titles by what the reader sees, ignoring case and accents", () => {
    /* **This is why the title column does not use TanStack's built-in `"text"`
       sort.** That one lower-cases and compares with `<`, which is code-point
       order: it puts "Étude" after "zebra", because É is above z in Unicode.
       The built-in looked like a straight swap for the collator it replaced,
       and this assertion is the only thing that said otherwise. */
    const list = [
      entry({ slug: "1", title: "zebra" }),
      entry({ slug: "2", title: "Étude" }),
      entry({ slug: "3", title: "Apple" }),
    ];
    expect(order(list, asc("title"))).toEqual(["3", "2", "1"]);
  });

  it("orders numbers in titles the way a person reads them", () => {
    // The other half of what the collator buys, and the other half `"text"`
    // would have got wrong: "Part 10" is not before "Part 2".
    const list = [entry({ slug: "a", title: "Part 10" }), entry({ slug: "b", title: "Part 2" })];
    expect(order(list, asc("title"))).toEqual(["b", "a"]);
  });

  it("applies the second key inside the group whose first key is missing", () => {
    /* **The test that says why `sortUndefined` is switched off.** TanStack's
       `sortUndefined: "last"` returns `aUndefined ? 1 : -1` — with both values
       missing, `aUndefined` is true, so it answers `1` for `(a, b)` and `1` for
       `(b, a)`. That is not a comparator, and it returns before the second key
       is ever consulted: these three would come out in whatever order the array
       was already in, alphabetically sorted by nothing, looking fine.

       Found by a cross-family review, 2026-08-26, and confirmed against the
       library's source. */
    const list = [
      entry({ slug: "1", title: "Zulu" }),
      entry({ slug: "2", title: "Alpha" }),
      entry({ slug: "3", title: "Mike" }),
    ];
    expect(
      order(list, [
        { id: "opened", desc: true },
        { id: "title", desc: false },
      ]),
    ).toEqual(["2", "3", "1"]);
  });

  it("still puts the missing group last when a second key is in play", () => {
    // The two rules have to hold together: ordered within themselves by the
    // second key, and below everything that has a value for the first.
    const list = [
      entry({ slug: "never-z", title: "Zulu" }),
      entry({ slug: "never-a", title: "Alpha" }),
      entry({ slug: "opened", title: "Mike", lastOpenedAt: "2026-08-20T00:00:00.000Z" }),
    ];
    expect(
      order(list, [
        { id: "opened", desc: true },
        { id: "title", desc: false },
      ]),
    ).toEqual(["opened", "never-a", "never-z"]);
  });

  it("sorts by a second key when the first ties", () => {
    /* Multi-sort is the thing TanStack was adopted for, so it is worth an
       assertion rather than a browser click: same length, ordered by title. */
    const list = [
      entry({ slug: "a", words: 100, title: "Beta" }),
      entry({ slug: "b", words: 100, title: "Alpha" }),
      entry({ slug: "c", words: 900, title: "Zeta" }),
    ];
    expect(
      order(list, [
        { id: "length", desc: true },
        { id: "title", desc: false },
      ]),
    ).toEqual(["c", "b", "a"]);
  });
});

describe("what a click on a sort control means", () => {
  it("reverses the column that is already the only key", () => {
    const table = clickable(desc("added"));
    toggleSort(table, "added", false);
    expect(table.getState().sorting).toEqual([{ id: "added", desc: false }]);
  });

  it("starts a new column at its own natural end", () => {
    // Going from "newest first" to Title must not mean Z-to-A: `desc` was
    // carried over from a key where it meant something else.
    const table = clickable(desc("added"));
    toggleSort(table, "title", false);
    expect(table.getState().sorting).toEqual([{ id: "title", desc: false }]);
  });

  it("shift adds a second key rather than replacing", () => {
    const table = clickable(desc("questions"));
    toggleSort(table, "title", true);
    expect(table.getState().sorting).toEqual([
      { id: "questions", desc: true },
      { id: "title", desc: false },
    ]);
  });

  it("collapses a compound sort on a plain click — including on its LAST key", () => {
    /* **The case TanStack gets differently.** Its own handler treats a plain
       click on the last key of a compound sort as "toggle this one's
       direction", keeping the rest — so the reader can sit in a two-key order
       with no obvious way back to one. Clicking an *earlier* key does replace,
       which is what makes the inconsistency hard to notice by hand.

       Found by a cross-family review, 2026-08-26. */
    const table = clickable([
      { id: "length", desc: true },
      { id: "title", desc: false },
    ]);
    toggleSort(table, "title", false);
    expect(table.getState().sorting).toEqual([{ id: "title", desc: false }]);
  });

  it("collapses on a plain click on an earlier key too", () => {
    const table = clickable([
      { id: "length", desc: true },
      { id: "title", desc: false },
    ]);
    toggleSort(table, "length", false);
    expect(table.getState().sorting).toEqual([{ id: "length", desc: true }]);
  });

  it("never lands on no sorting at all", () => {
    /* `enableSortingRemoval: false`. "Unsorted" has no meaning here — the list
       would fall back to whatever order the data arrived in, which is a state
       the reader cannot ask for or see the name of. */
    const table = clickable(desc("added"));
    for (let i = 0; i < 4; i++) toggleSort(table, "added", false);
    expect(table.getState().sorting).toHaveLength(1);
  });
});
