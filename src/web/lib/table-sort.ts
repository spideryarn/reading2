/**
 * The URL is the sorting state — the pure half.
 *
 * TanStack Table owns the sorting *rules*; this owns how that state is spelled
 * in an address bar, and it is deliberately a pure module with no React and no
 * table in it, so both directions can be tested without either.
 *
 * `?by=length,title&dir=desc,asc` is TanStack's `SortingState` —
 * `[{ id: "length", desc: true }, { id: "title", desc: false }]` — written out
 * in a form a person can read in a link. Two parallel lists rather than one
 * `length:desc,title:asc` string, because nuqs parses a parameter at a time and
 * two simple lists beat one clever one.
 *
 * See docs/project/url-state.md § The library's own five.
 */
import type { SortingFn, SortingState } from "@tanstack/react-table";

/**
 * Case- and accent-insensitive, and `numeric` so "Part 2" precedes "Part 10".
 * Built once: constructing a collator per comparison is the expensive way to
 * sort a list.
 */
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * Sort strings the way a reader reads them.
 *
 * **Not TanStack's built-in `"text"`, and the difference is not cosmetic.**
 * That one lower-cases and compares with `<`, which is code-point order: it
 * sorts "Étude" after "zebra", because `É` is above `z` in Unicode. It also
 * puts "Part 10" before "Part 2". Both are wrong in the ordinary sense of
 * wrong, and both look like a sort that is working.
 *
 * Caught by tests/library-sorting.test.ts on the day the shelf moved to
 * TanStack — the hand-rolled version it replaced had used a collator, and the
 * built-in looked like a straight swap.
 *
 * Returns ascending order always; TanStack applies the descending inversion
 * itself.
 */
export function localeText<T>(): SortingFn<T> {
  return (rowA, rowB, columnId) => {
    const a = rowA.getValue(columnId) as string | undefined;
    const b = rowB.getValue(columnId) as string | undefined;
    // Both missing returns 0 rather than an arbitrary sign, so the next sort
    // key gets a turn. See `numberOrMissing` for why that matters so much.
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    return collator.compare(a, b);
  };
}

/**
 * Numbers and timestamps, with a missing value at the **low** end.
 *
 * ## Why not `sortUndefined: "last"`, which is the option for exactly this
 *
 * Because TanStack 8.21.3 gets it wrong when *both* values are missing.
 * `sortUndefined: "last"` returns `aUndefined ? 1 : -1` — and with both
 * undefined, `aUndefined` is true, so it returns `1` for `(a, b)` **and** `1`
 * for `(b, a)`. That is an inconsistent comparator, and it returns before the
 * next sort key is ever consulted.
 *
 * What that looks like: sort by Last opened, then by Title, over three articles
 * you have never opened. They should come out alphabetically. They come out in
 * whatever order the array was already in, because the comparison never gets
 * past the first key — and nothing about the result looks wrong.
 *
 * So `sortUndefined` is switched **off** for every column here, missing sorts
 * low (consistently, in both directions), and the rows whose *primary* key is
 * missing are moved to the bottom afterwards with `sinkLast`. That gets all
 * three properties at once: missing last whichever way the arrow points, later
 * keys still applied inside the missing group, and a comparator that is
 * actually a comparator.
 *
 * Found by a cross-family review, 2026-08-26, and confirmed against the
 * library's own source.
 */
export function numberOrMissing<T>(): SortingFn<T> {
  return (rowA, rowB, columnId) => {
    const a = rowA.getValue(columnId) as number | undefined;
    const b = rowB.getValue(columnId) as number | undefined;
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  };
}

/**
 * An ISO date string, accessor-ready for `numberOrMissing`.
 *
 * Parsed to a number, or `undefined` for absent and unparseable alike — the
 * rule `numberOrMissing` requires: a missing value must be `undefined`, never
 * `NaN`, which compares false in both directions and sorts as a value that
 * silently never moves.
 */
export function at(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

/**
 * Which way round a column goes when the reader first picks it.
 *
 * This is TanStack's `sortDescFirst`, said in our own vocabulary because two
 * other things need it: the parser, to fill in a `dir` the URL did not carry,
 * and the chip, to name the end it is currently at. Passing it around as a
 * lookup keeps this module free of any particular table's columns.
 */
export type NaturalDirections = Readonly<Record<string, "asc" | "desc">>;

/**
 * `?by=` and `?dir=` → what TanStack wants.
 *
 * **`dir` is allowed to be shorter than `by`, or absent entirely**, and the
 * missing entries fall back to each column's natural end. That is what makes
 * `?by=title` a link somebody can type: without it, half a URL would mean an
 * empty sort rather than the obvious one. Anything in `by` that is not a known
 * column is dropped rather than passed through, because an id TanStack does not
 * recognise sorts by nothing while looking like it sorted.
 *
 * **Absent is spelt `null`, which is what the parser already returns**, and it
 * is a `null` rather than a defaulted `[]` for a reason that cost a day. The
 * callers used to write `rawDir ?? []` above a `useMemo`, which builds a fresh
 * array on every render — so the memo re-ran every render, the `SortingState`
 * it returned was new every render, and TanStack's sorted-row-model memo (keyed
 * on exactly that array) recomputed every render and queued a page-index reset,
 * which set state, which rendered again. The homepage sat there doing about 470
 * renders a second and locked up entirely on the first keystroke.
 * docs/postmortems/260827e-shelf-render-loop.md. Taking the `null` here means there is
 * no per-render array for anybody to build.
 */
export function sortingFromUrl(
  by: string[],
  dir: ("asc" | "desc")[] | null,
  natural: NaturalDirections,
  /** Where to land when nothing in `by` is usable. Never sort by nothing. */
  fallback: string[] = [],
): SortingState {
  const seen = new Set<string>();
  const out: SortingState = [];

  /* Paired by the position in `by`, and filtered *inside* the loop rather than
     before it. Filtering first and then using the surviving array's index is
     the version of this that reads fine and is wrong: `?by=nonsense,title` with
     `dir=desc,asc` would hand Title the direction meant for the id that was
     dropped. A cross-family review found exactly that, 2026-08-26.

     Duplicates are dropped for a related reason — `?by=title,title&dir=asc,desc`
     is two contradictory instructions about one column, and TanStack would
     apply the first and silently ignore the second. */
  by.forEach((id, i) => {
    if (!(id in natural) || seen.has(id)) return;
    seen.add(id);
    out.push({ id, desc: (dir?.[i] ?? natural[id]) === "desc" });
  });

  /* Never empty. An empty sort is not a state the reader can ask for or see the
     name of — every chip would read unpressed while the list sat in whatever
     order the data arrived in — so a URL that names nothing we recognise lands
     on the ordinary default instead. */
  if (out.length === 0 && fallback.length > 0) {
    return sortingFromUrl(fallback, null, natural);
  }
  return out;
}

/**
 * True when every entry is already at its column's natural end.
 *
 * Used to decide whether `?dir=` needs to be in the URL at all: if it says
 * nothing the columns would not have said themselves, leaving it out keeps
 * `?by=title` short *and* correct. It has to be a separate question from nuqs's
 * `clearOnDefault`, because the default here is per-column rather than a fixed
 * value — which is the bug this function was written to fix. `?by=title` was
 * giving Z-to-A, because `dir` had a parser default of `desc` and so never
 * reached the fallback above. Found by a cross-family review, 2026-08-26.
 */
export function isAllNatural(sorting: SortingState, natural: NaturalDirections): boolean {
  return sorting.every((s) => (s.desc ? "desc" : "asc") === natural[s.id]);
}

/** What TanStack has → what goes in the address bar. */
export function sortingToUrl(sorting: SortingState): {
  by: string[];
  dir: ("asc" | "desc")[];
} {
  return {
    by: sorting.map((s) => s.id),
    dir: sorting.map((s) => (s.desc ? "desc" : "asc")),
  };
}

/**
 * Compare two `by`/`dir` lists — nuqs needs this to know when a value is the
 * default and can be left out of the URL.
 *
 * Written out because `===` on two arrays is always false, so a parser without
 * it writes `?by=added&dir=desc` onto every link to the homepage.
 */
export function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Move the rows a predicate matches to the end, keeping both groups' order.
 *
 * The shelf's fixture is the case this exists for: it is a committed
 * placeholder rather than something the reader added, and it belongs at the
 * foot of every order in both directions. Doing it here rather than through
 * TanStack's row pinning is deliberate — pinning is a *feature*, something the
 * reader turns on for a row they care about, and using its state to express a
 * rule about our data would mean the day somebody wants real pinning they find
 * it already occupied.
 */
export function sinkLast<T>(rows: T[], sinks: (row: T) => boolean): T[] {
  const keep: T[] = [];
  const sunk: T[] = [];
  for (const row of rows) (sinks(row) ? sunk : keep).push(row);
  return sunk.length === 0 ? rows : [...keep, ...sunk];
}
