/**
 * **Which articles are on screen, and what every topic chip counts** — the
 * shelf's narrowing, as pure functions.
 *
 * One function narrows the shelf — the active list and, when `?archived=1` is
 * on, the archived articles merged into the same array (plan 260929a) — in one
 * order: **scope → search → Unread → topics** (GPT Sol F6 on plan 260928a).
 * Scope is which array you hand it; the rest is here. Library.tsx calls it
 * above the cards/table branch, so both views obey it and there is no second
 * list to disagree with.
 *
 * And **one formula for every count** (Sol F11):
 *
 *     visible = scope ∩ search ∩ Unread ∩ every selected topic
 *     a chip's count = |visible ∩ its articles|
 *
 * so a selected chip's count is exactly the number of articles shown. Counts
 * are physical slugs — six copies of one article are six cards and a count of
 * six — never the grouped "works" the server chose topics over.
 *
 * docs/project/shelf-terms.md.
 */
import type { LibraryEntry, LibraryTermsResponse } from "../types.js";
import { fold, queryTerms } from "./library-hits.js";

export type ShelfTerm = LibraryTermsResponse["terms"][number];

/**
 * The cards whose visible words contain every term typed.
 *
 * AND across terms, substring within one — so "seth noema" finds the article by
 * that author on that site, and "consc" finds "consciousness" while you are
 * still typing it. Deliberately over exactly the four fields a card renders:
 * matching something invisible would look like a bug from the outside.
 *
 * Lived in Library.tsx until 2026-09-28; moved here so the archived list is
 * searched by the same rule rather than a copy of it — and generic since
 * 2026-10-02, so the public articles under Include public are too (plan 261002b).
 */
export function filterEntries<
  T extends Pick<LibraryEntry, "title"> & {
    byline?: string | null;
    siteName?: string | null;
    gist?: string | null;
  },
>(articles: readonly T[], query: string): T[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [...articles];
  return articles.filter((a) => {
    const hay = fold([a.title, a.byline, a.siteName, a.gist].filter(Boolean).join(" "));
    return terms.every((t) => hay.includes(t));
  });
}

export interface Narrowing {
  /** What is in the search box. */
  query: string;
  /** The Unread chip: only articles never opened. */
  unread: boolean;
}

/** Search, then Unread — the part of the order that does not need the topics. */
export function narrowBeforeTopics(
  entries: readonly LibraryEntry[],
  { query, unread }: Narrowing,
): LibraryEntry[] {
  const found = filterEntries(entries, query);
  return unread ? found.filter((a) => a.opens === 0) : found;
}

/**
 * The member slugs of each chosen topic, in the order chosen.
 *
 * A key that is not among `terms` contributes nothing — neither an empty set
 * (which would empty the shelf) nor an error. Deciding *whether* a key applies
 * is `chosenTopics`' job; this only looks them up.
 */
export function topicMembers(
  terms: readonly ShelfTerm[],
  chosen: readonly string[],
): ReadonlySet<string>[] {
  const byKey = new Map(terms.map((t) => [t.key, t]));
  const sets: ReadonlySet<string>[] = [];
  for (const key of chosen) {
    const term = byKey.get(key);
    if (term) sets.push(new Set(term.articles.map((a) => a.slug)));
  }
  return sets;
}

/** Keep the entries in every set — AND, so two topics show articles with both. */
export function withTopics<T extends { slug: string }>(
  entries: readonly T[],
  members: readonly ReadonlySet<string>[],
): T[] {
  if (members.length === 0) return [...entries];
  return entries.filter((e) => members.every((m) => m.has(e.slug)));
}

/**
 * **Whether an entry is on the shelf only because Archived is on.**
 *
 * `archivedAt` is the server's own flag — set on every entry of the archived
 * listing and on the answer to an archiving PATCH, absent everywhere else
 * (`LibraryEntry.archivedAt` in src/types.ts) — so a merged row carries its
 * state with it rather than by which array it came from. One function, so the
 * card, the table row, the actions and the count all read it the same way.
 */
export function isArchived(entry: Pick<LibraryEntry, "archivedAt">): boolean {
  return !!entry.archivedAt;
}

/** The whole order, for one array: search → Unread → topics. */
export function narrowShelf(
  entries: readonly LibraryEntry[],
  narrowing: Narrowing & { topics: readonly ReadonlySet<string>[] },
): LibraryEntry[] {
  return withTopics(narrowBeforeTopics(entries, narrowing), narrowing.topics);
}

/**
 * **The chosen keys that apply**, given what the URL asks for and the topics
 * loaded so far.
 *
 * Before any topics have loaded, nothing applies — so a link carrying
 * `?topics=` cannot flash an empty shelf while the request is in flight. After,
 * a key not among the topics is left out; dropping it from the URL is the
 * caller's (it needs to know the load was complete, not partial).
 */
export function chosenTopics(
  requested: readonly string[],
  terms: readonly ShelfTerm[] | null,
): string[] {
  if (!terms) return [];
  const keys = new Set(terms.map((t) => t.key));
  return requested.filter((k) => keys.has(k));
}

/**
 * What each chip says: `|visible ∩ its articles|`, where `visible` is
 * `visibleBeforeTopics` (scope ∩ search ∩ Unread, as slugs) narrowed by every
 * selected topic.
 *
 * Keys not among `terms` are ignored in `selected`, for the reason under
 * `topicMembers`. Every term gets an entry, zeros included — a zero is what
 * takes an unselected chip off the row (`availableTopics`).
 */
export function topicCounts(
  visibleBeforeTopics: Iterable<string>,
  selected: readonly string[],
  terms: readonly ShelfTerm[],
): Map<string, number> {
  const visible = withTopics(
    [...visibleBeforeTopics].map((slug) => ({ slug })),
    topicMembers(terms, selected),
  );
  return topicCountsForVisible(
    visible.map((v) => v.slug),
    terms,
  );
}

/** Count each term in rows that have already passed every narrowing. */
export function topicCountsForVisible(
  visible: Iterable<string>,
  terms: readonly ShelfTerm[],
): Map<string, number> {
  const shown = new Set(visible);
  const counts = new Map<string, number>();
  for (const term of terms) {
    let n = 0;
    for (const a of term.articles) if (shown.has(a.slug)) n++;
    counts.set(term.key, n);
  }
  return counts;
}

/**
 * **The topics worth offering now**: every topic with something left to show,
 * plus every chosen one — in the server's rank order, never re-sorted.
 *
 * Greg, 2026-09-29 (SPIDERYARN-READING2-4Y): *"if I pick one of the
 * faceted-search-topic-pills, it should hide (or shunt to the right) any
 * topic-pills that match 0 of the filtered articles on the shelf"*. Hidden,
 * not shunted: the row is for choosing the next filter, and a chip that leads
 * to an empty shelf is noise. A **chosen** topic at zero stays, or it could not
 * be removed. Plan 260929a § Stage 2.
 *
 * Applied **before** the collapsed row takes its first twelve (GPT Sol R5), so
 * the row has no holes where zeros used to be, and "All N topics" counts what
 * it would show.
 */
export function availableTopics<T extends { key: string }>(
  terms: readonly T[],
  count: (key: string) => number,
  chosen: ReadonlySet<string>,
): T[] {
  return terms.filter((t) => count(t.key) > 0 || chosen.has(t.key));
}
