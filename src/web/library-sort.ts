/**
 * How the shelf is ordered, as data.
 *
 * Greg, 2026-08-26:
 *
 * > Make the set of docs on the homepage nicely sortable (e.g. by when added,
 * > when last opened, how many words, how many actions/interactions performed)
 * > … Maybe it's misleading to call this tabular, because I kind of like the
 * > rich cards that we have right now, so look for a best of all worlds.
 *
 * One table of sorts, used by three things — the chips above the shelf, the
 * cards, and the table's header row — so a key cannot exist in one and not the
 * others, and cannot be spelled differently in two of them. This is a module of
 * its own, and pure, for the same reason `library-hits.ts` is: the rules below
 * are the kind that fail silently in a browser and loudly in a test.
 *
 * ## Three rules, and why each one is here
 *
 * **The fixture is pinned last, in every sort and both directions.** It is a
 * committed placeholder rather than something the reader added, and the server
 * has always kept it at the foot of the shelf (src/api.ts § listArticles). Move
 * the sort into the browser without carrying that rule over and "longest first"
 * puts a demo excerpt above the reader's own library.
 *
 * **An article with no value for the key sorts last, in both directions.** The
 * direction toggle means "of the articles that have one, which end comes
 * first"; a missing value is not a small one. Sorting ascending by "last
 * opened" would otherwise fill the top of the shelf with everything you have
 * never opened — which is a useful thing to want, and is why the Unread filter
 * exists instead of being smuggled into the sort's low end.
 *
 * **Every comparison ends in a total order.** Ties fall through to the title
 * and then to the slug, which is unique. Without that last step the order of
 * equal rows depends on the order the server happened to send them, so a
 * reload can silently reshuffle the shelf and nothing looks broken.
 */
import type { LibraryEntry } from "../types.js";

export type SortKey = "added" | "opened" | "title" | "length" | "opens" | "questions";
export type SortDir = "asc" | "desc";
export type ShelfView = "cards" | "table";

/** Which half of the shelf a filter chip is asking for. */
export type ShelfFilter = "all" | "unread";

/**
 * `undefined` from `value` means **this article has no value for this key** —
 * never opened, no date we could parse — and is sorted last either way. `0`
 * and `""` are values and are not that.
 */
export interface SortSpec {
  key: SortKey;
  /** What the chip and the table header say. */
  label: string;
  /** The longer sentence, on the chip's `title` and the header's. */
  hint: string;
  /** Which way round a reader almost certainly means it, chosen on first click. */
  natural: SortDir;
  /** How to name the two ends of this key, ascending first: `["oldest", "newest"]`. */
  ends: [string, string];
  value(entry: LibraryEntry): number | string | undefined;
  /**
   * What the card should say on its meta line while this is the sort, or
   * `undefined` to leave the date it already shows.
   *
   * This is the "best of all worlds" half of the design: a card sorted by
   * something invisible is a list in an order the reader cannot check. When the
   * sort is one of the card's own facts — when it was added, how long it is —
   * there is nothing to add and this returns `undefined`.
   */
  note?(entry: LibraryEntry): string | undefined;
}

/** Parsed to a number, or `undefined` for absent and unparseable alike. */
function at(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

/**
 * `25 Aug` — short, because it sits on a line that already has three other
 * facts on it. The tooltip carries the exact time.
 */
function shortDate(iso: string | undefined): string | undefined {
  const t = at(iso);
  return t === undefined
    ? undefined
    : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * The sorts, in the order the chips appear.
 *
 * `added` is first and is the default, so a reader who touches nothing gets
 * exactly the shelf they had before any of this existed.
 */
export const SORTS: SortSpec[] = [
  {
    key: "added",
    label: "Added",
    hint: "When the article was fetched and built",
    natural: "desc",
    ends: ["oldest first", "newest first"],
    value: (e) => at(e.addedAt),
  },
  {
    key: "opened",
    label: "Last opened",
    hint: "When you last opened the reading view",
    natural: "desc",
    ends: ["longest ago first", "most recent first"],
    value: (e) => at(e.lastOpenedAt),
    note: (e) => {
      const when = shortDate(e.lastOpenedAt);
      return when ? `opened ${when}` : "never opened";
    },
  },
  {
    key: "title",
    label: "Title",
    hint: "Alphabetically, ignoring case and accents",
    natural: "asc",
    ends: ["A to Z", "Z to A"],
    value: (e) => e.title,
  },
  {
    key: "length",
    label: "Length",
    hint: "How many words the article is",
    natural: "desc",
    ends: ["shortest first", "longest first"],
    value: (e) => e.words,
  },
  {
    key: "opens",
    label: "Times opened",
    hint: "How many times you have opened it",
    natural: "desc",
    ends: ["least opened first", "most opened first"],
    value: (e) => e.opens,
    note: (e) =>
      e.opens === 0 ? "never opened" : e.opens === 1 ? "opened once" : `opened ${e.opens} times`,
  },
  {
    key: "questions",
    label: "Questions",
    hint: "How many questions you have asked about it",
    natural: "desc",
    ends: ["fewest first", "most first"],
    value: (e) => e.comments,
    note: (e) =>
      e.comments === 0
        ? "no questions"
        : e.comments === 1
          ? "1 question"
          : `${e.comments} questions`,
  },
];

export const DEFAULT_SORT: SortKey = "added";

const BY_KEY = new Map(SORTS.map((s) => [s.key, s]));

/** The spec for a key, falling back to the default rather than throwing. */
export function sortSpec(key: SortKey): SortSpec {
  return BY_KEY.get(key) ?? BY_KEY.get(DEFAULT_SORT)!;
}

export function isSortKey(v: string): v is SortKey {
  return BY_KEY.has(v as SortKey);
}

/**
 * Case- and accent-insensitive, and `numeric` so "Part 2" precedes "Part 10".
 * Built once: constructing a collator per comparison is the expensive way to
 * sort a list.
 */
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function compare(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * The shelf, ordered. Never mutates its input — the array it is given is React
 * state, and sorting in place would mutate a rendered list without changing its
 * identity, which is the version of this bug that renders correctly until it
 * suddenly does not.
 */
export function sortEntries(
  entries: LibraryEntry[],
  key: SortKey,
  dir: SortDir,
): LibraryEntry[] {
  const spec = sortSpec(key);
  const flip = dir === "desc" ? -1 : 1;

  return [...entries].sort((x, y) => {
    // The fixture is not the reader's article. Last, always, in both directions.
    if (!!x.fixture !== !!y.fixture) return x.fixture ? 1 : -1;

    const a = spec.value(x);
    const b = spec.value(y);
    // Absent sorts last whichever way the arrow points — so this comparison is
    // NOT multiplied by `flip`. See the header comment.
    if (a === undefined || b === undefined) {
      if (a === b) return tiebreak(x, y);
      return a === undefined ? 1 : -1;
    }

    const c = compare(a, b) * flip;
    return c !== 0 ? c : tiebreak(x, y);
  });
}

/** Title, then slug — and the slug is unique, so this is a total order. */
function tiebreak(x: LibraryEntry, y: LibraryEntry): number {
  const byTitle = collator.compare(x.title, y.title);
  return byTitle !== 0 ? byTitle : x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0;
}

/**
 * The Unread chip.
 *
 * "Not opened" rather than "not read", because opening is all we record — see
 * docs/project/library.md § Shelf state.
 *
 * **The fixture is not exempt**, unlike in the sort. An earlier version of this
 * comment said it was, on the reasoning that hiding it would empty a fresh
 * shelf — but a fresh shelf has never opened anything, so the fixture is
 * unopened too and stays. Once you *have* opened it, it is read, and a filter
 * called Unread that shows you something you have read is a filter that has to
 * explain itself. A cross-family review caught the comment claiming an
 * exception the code did not make, 2026-08-26.
 */
export function applyFilter(entries: LibraryEntry[], filter: ShelfFilter): LibraryEntry[] {
  return filter === "unread" ? entries.filter((e) => e.opens === 0) : entries;
}

/**
 * What clicking a sort chip — or a table header — should do.
 *
 * **A key you are already on reverses; a key you are not on starts at its own
 * natural end.** That is one rule for both views, and it is here rather than in
 * either of them so they cannot implement it twice and differently. The second
 * half matters more than it looks: without it, switching from "newest first" to
 * Title would hand you Z-to-A, because `desc` was carried across from a key
 * where `desc` meant something else entirely.
 */
export function nextSort(
  key: SortKey,
  dir: SortDir,
  clicked: SortKey,
): { by: SortKey; dir: SortDir } {
  if (clicked !== key) return { by: clicked, dir: sortSpec(clicked).natural };
  return { by: key, dir: dir === "asc" ? "desc" : "asc" };
}

/** `newest first` — this key's own name for this end of it. */
export function directionLabel(key: SortKey, dir: SortDir): string {
  return sortSpec(key).ends[dir === "asc" ? 0 : 1];
}
