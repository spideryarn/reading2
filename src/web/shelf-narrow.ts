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

/**
 * **Whether these topics were named by a model as a coarse-to-fine tree**
 * (plan 261003f) rather than picked from the articles' own phrases: some topic
 * carries a `granularity`. A phrase topic never does, and `chosenBy: "model"`
 * alone does not say — a model also *scores* phrase topics.
 */
export function isModelNamed(terms: readonly Pick<ShelfTerm, "granularity">[]): boolean {
  return terms.some((t) => t.granularity !== undefined);
}

/**
 * **How many broader topics a topic is inside**: 0 for a broad subject and for
 * every phrase topic, 1 for a topic inside a subject, 2 for one inside that.
 *
 * Read off the `within` chain, which is the structure, rather than off the
 * `granularity` number, which is a judgement — but a finer topic
 * (`granularity > 0`) whose parent did not arrive is still 1, so it never
 * looks like a broad subject. Capped at `MAX_TOPIC_DEPTH`, which also ends a
 * chain that loops.
 */
export const MAX_TOPIC_DEPTH = 2;
export function topicDepth(
  term: Pick<ShelfTerm, "granularity" | "within">,
  byKey: ReadonlyMap<string, Pick<ShelfTerm, "within">>,
): number {
  if (!term.granularity || term.granularity <= 0) return 0;
  let depth = 1;
  let parent = term.within === undefined ? undefined : byKey.get(term.within);
  while (parent?.within !== undefined && depth < MAX_TOPIC_DEPTH) {
    depth++;
    parent = byKey.get(parent.within);
  }
  return depth;
}

/**
 * **The topics inside a chosen one come straight after it.** Greg,
 * 2026-10-03: *"if I pick neuroscience, then it'll hide all of the
 * non-neuroscience-related topic pills. And then I can easily filter down
 * within those at sort of increasing levels of granularity."*
 *
 * Hiding the zeros (`availableTopics`) does most of that, but not all: the
 * list arrives broad first, so with *Neuroscience* chosen, every other broad
 * subject that shares one article with it (*AI*, *Philosophy*) still sits
 * ahead of *Vision* and *Memory*, which are the next step down. So the topics
 * **directly** `within` a chosen one are gathered, in the order the server
 * sent them (broad first), just after the last chosen pill that is not itself
 * inside a chosen one. Nothing else moves, and the rest follow in rank order.
 * A topic two levels down waits until its parent is chosen.
 *
 * **A pill never moves when it is pressed.** One chosen at the top level is
 * the anchor, in its own place. One chosen from the gathered group stays in
 * the group, where it already was — which is why the group holds the chosen
 * and the unchosen alike, rather than only the unchosen: sending a pressed
 * *Vision* back to its rank place would jump it out from under the pointer.
 *
 * With nothing chosen, and for phrase topics (no `within`), it is the
 * identity. Applied after `availableTopics` and before the row takes its
 * first twelve.
 */
export function withinChosenFirst<T extends { key: string; within?: string }>(
  terms: readonly T[],
  chosen: ReadonlySet<string>,
): T[] {
  const inside = (t: T) => t.within !== undefined && chosen.has(t.within);
  let last = -1;
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i] as T;
    if (chosen.has(t.key) && !inside(t)) last = i;
  }
  if (last < 0) return [...terms];
  const head = terms.slice(0, last + 1).filter((t) => !inside(t));
  const tail = terms.slice(last + 1).filter((t) => !inside(t));
  return [...head, ...terms.filter(inside), ...tail];
}

/**
 * **The reader's own tags as filter facets** — one per tag on any entry in
 * scope, shaped like a topic so `topicMembers`, `withTopics` and
 * `topicCountsForVisible` serve both rows and every rule above holds for tags
 * unchanged: AND across everything chosen, one count formula.
 *
 * From the entries the shelf already holds rather than a request: every entry
 * carries its tags (`LibraryEntry.tags`). Most-used first, then by name. The
 * key is the tag itself, which is lowercase and holds no comma (src/tags.ts),
 * in its own `?tags=` list, so it cannot collide with a topic's key.
 * Plan 261003d.
 */
export function tagFacets(entries: readonly Pick<LibraryEntry, "slug" | "tags">[]): ShelfTerm[] {
  const by = new Map<string, { slug: string; count: number }[]>();
  for (const e of entries) {
    for (const tag of e.tags ?? []) {
      const list = by.get(tag);
      if (list) list.push({ slug: e.slug, count: 1 });
      else by.set(tag, [{ slug: e.slug, count: 1 }]);
    }
  }
  return [...by]
    .sort(([a, x], [b, y]) => y.length - x.length || (a < b ? -1 : a > b ? 1 : 0))
    .map(([tag, articles]) => ({ key: tag, label: tag, articles }));
}
