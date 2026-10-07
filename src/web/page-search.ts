/**
 * **Search a page of sections, without a model** — the box above the Metadata
 * page's contents list (PageContents.tsx).
 *
 * Greg, SPIDERYARN-READING2-83, 2026-10-01:
 *
 * > Add a Search box (above the left-hand table-of-contents) to the Metadata
 * > page (and make sure it does a good job of finding things, including
 * > synonyms)
 *
 * A page with a dozen sections does not need an embedding or a model call per
 * keystroke; it needs the words a reader types to reach the section that means
 * them. Four things do that here, each pinned in tests/page-search.test.ts:
 *
 * - **A synonym table** (`METADATA_SYNONYMS`), hand-written for the words this page is
 *   about — *price* finds *What it cost*, *download* finds *Export*.
 * - **A light stem** on both sides, so *costs*, *sharing* and *authored* meet
 *   *cost*, *share* and *author*.
 * - **Prefix match**, so the list narrows while you are still typing.
 * - **Every word must hit** somewhere in a section, so a second word narrows
 *   rather than widens.
 *
 * **Ranked by where the word was found first, and how second.** Each query
 * word scores once, by its single best evidence: the section's own name, then
 * the keywords the page wrote for it, then its heading's one-line answer; and
 * within one place a whole word above a prefix above a synonym. The weights
 * double per place and no factor falls to a half, so a synonym in the name
 * still beats a whole word in the keywords. Ties keep page order.
 *
 * **Not the text inside a section, on Metadata.** A hit there would promise
 * "the right place" (Greg's words) and then land on the section's heading,
 * which for *AI processing* is screens above the line; and half the sections
 * unmount their body when shut, so it would find some words and not others.
 * Landing on the matching line is the deferred version, with a model or
 * embedding for paraphrase after it. GPT Sol, plan review; plan 261001s § The
 * search box.
 *
 * **Help does search the text, since 2026-10-07** (`SearchableSection.body`),
 * because neither reason holds there any more. A result is a whole page, and a
 * page is short, so landing at its top is landing on the place; and the words
 * are constants read from the files, mounted or not. It also has to: while
 * Help was one long page, a reader with a remembered phrase had the browser's
 * Find, and Find cannot see a page that is not open. Words found only in a
 * body rank below everything found the old way — see `searchSections`. GPT
 * Sol, plan review, R4:
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md.
 */

/**
 * One section as the search sees it — read off the DOM by PageContents, or
 * built from the typed section list by the Help page (help/HelpPage.tsx).
 */
export interface SearchableSection {
  id: string;
  label: string;
  /** The page's own extra words for it (`data-keywords`). */
  keywords: string;
  /** The heading's one-line answer, e.g. "$0.0123 · 12 calls". */
  aside: string;
  /**
   * The section's own words, as plain text — **only where a result is the
   * whole of what it names**, which today is a Help page. Metadata leaves it
   * out; the top of this file says why the two differ.
   */
  body?: string;
}

/**
 * **A page's own synonym groups.** Each inner list is one group of words that
 * mean the same thing on that page. A word may sit in only one group —
 * `groupsOf` below would silently keep the last.
 */
export type SynonymTable = readonly (readonly string[])[];

/**
 * Words that mean the same thing **on the Metadata page** — the default table,
 * since that page is where this search began. Not a thesaurus: each group is
 * the vocabulary a reader might bring to one of the page's questions. Another
 * page passes its own (Help's is `HELP_SYNONYMS` in src/web/help/help-content.tsx)
 * rather than adding its words here, where they would widen Metadata's matches
 * with words that mean nothing on it.
 */
export const METADATA_SYNONYMS: SynonymTable = [
  ["cost", "price", "spend", "spent", "money", "dollar", "bill", "expense", "charge", "paid", "usage"],
  ["delete", "remove", "erase", "trash", "destroy", "bin", "purge", "rid"],
  ["archive", "hide", "shelve", "shelf", "unshelve"],
  ["share", "public", "private", "link", "visibility", "visible", "access", "publish", "permission"],
  ["export", "download", "backup", "save", "copy", "json"],
  ["rerun", "regenerate", "regen", "redo", "refresh", "retry", "rebuild", "again", "run", "restart",
    "reprocess", "recompute", "remake", "rewrite", "reanalyse", "reanalyze", "processing"],
  ["author", "writer", "byline", "wrote", "written"],
  ["reading", "read", "finished"],
  ["time", "duration", "long"],
  ["technical", "debug", "file", "storage", "raw", "slug", "internal"],
  ["glance", "stat", "statistic", "overview", "count", "length", "size"],
  ["pdf", "scan", "ocr", "extraction", "quality"],
  ["sentence", "summary", "gist", "tldr", "abstract"],
];

/**
 * Lower-cased, accents off, a plural / -ing / -ed and then a final -e taken
 * away — so *share*, *shares*, *sharing* and *shared* are all `shar`. Crude on
 * purpose: both sides go through it, so it only has to be consistent, not
 * right. Short words are left alone, or *is* and *as* would vanish.
 */
export function searchStem(word: string): string {
  let w = word;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Words of a string, normalised and stemmed. Punctuation splits words. */
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(searchStem);
}

/** Stemmed word → its stemmed group, for one table. */
type GroupIndex = ReadonlyMap<string, readonly string[]>;

/* Built once per table rather than once per query: the tables are module
   constants, so the array's identity is a sound cache key. */
const INDEXES = new WeakMap<SynonymTable, GroupIndex>();

function groupsOf(table: SynonymTable): GroupIndex {
  const cached = INDEXES.get(table);
  if (cached) return cached;
  const index = new Map<string, readonly string[]>();
  for (const group of table) {
    const stems = group.map(searchStem);
    for (const s of stems) index.set(s, stems);
  }
  INDEXES.set(table, index);
  return index;
}

/**
 * **Words a question is made of rather than about**, dropped from a query that
 * has anything else in it — so *how much did this cost* is a search for *cost*
 * and not a search that fails because no section says *did*. A query of only
 * these keeps them all, so *what it cost* still finds *What it cost*.
 */
const STOPWORDS = new Set(
  [
    "a", "an", "the", "of", "to", "in", "on", "for", "from", "with", "and", "or", "is", "are", "was",
    "were", "be", "been", "it", "its", "this", "that", "my", "me", "i", "you", "your", "we", "our",
    "how", "much", "many", "what", "which", "where", "when", "why", "do", "does", "did", "can",
    "show", "see", "find", "about", "make", "change", "used", "want", "need", "like", "article", "page",
    "please",
    /* Fragments produced when punctuation splits ordinary contractions:
       "what's", "you're", "I've", "I'll", "I'd", "can't". */
    "s", "re", "ve", "ll", "d", "m", "t",
  ].map(searchStem),
);

/** A query word shorter than this does not expand through the table by prefix. */
const MIN_PREFIX_EXPAND = 3;

/** The other words a query word stands for: its group's, or its prefix's groups'. */
function synonymsOf(term: string, groups: GroupIndex): Set<string> {
  const out = new Set<string>();
  for (const [s, group] of groups) {
    if (s === term || (term.length >= MIN_PREFIX_EXPAND && s.startsWith(term))) {
      for (const g of group) if (g !== term) out.add(g);
    }
  }
  return out;
}

/** Where in a section a word was found, best first. */
const FIELD_WEIGHT = { label: 8, keywords: 4, aside: 2 } as const;
type Field = keyof typeof FIELD_WEIGHT;
/**
 * A word found only in the section's `body`. Half of `aside`, as each place is
 * half the one above — but that is only the order *among* sections that needed
 * their body. Such a section is listed after every section that did not, by
 * `searchSections`, whatever the sums come to.
 */
const BODY_WEIGHT = 1;
/** Above a half, so the place a word was found outranks how — see the top. */
const PREFIX_FACTOR = 0.8;
const SYNONYM_FACTOR = 0.6;

/** How well one stemmed word set answers one query word: 0 for not at all. */
function hit(term: string, synonyms: Set<string>, have: readonly string[]): number {
  let best = 0;
  for (const w of have) {
    if (w === term) return 1;
    if (w.startsWith(term)) best = Math.max(best, PREFIX_FACTOR);
    else if (synonyms.has(w)) best = Math.max(best, SYNONYM_FACTOR);
  }
  return best;
}

/**
 * The ids of the sections that answer `query`, best first. An empty query
 * answers nothing, and the caller shows its whole list instead. `synonyms` is
 * the page's own table; omitted, it is Metadata's.
 *
 * **Every word must hit somewhere — among the words that mean anything here.**
 * Question furniture (*my*, *with*, *please*, and *get* only in *get rid*) is
 * removed above. Then, when no section answers every word, a word that no
 * section answers at all (*zebra*) is set aside and the rest tried again, so
 * one unexpected word does not empty the list. Words that each mean something
 * on the page must still agree: *delete cost* finds nothing rather than both,
 * so a word the page knows only ever narrows. Not "rank by how many words
 * hit", which would widen. Greg, `spya-nkjpte` ("more flexible/forgiving");
 * GPT Sol, plan review of 261002c, P1.
 *
 * **The trade, taken on purpose.** The set-aside word may have been a
 * qualifier: with the experimental *Whole article* row hidden, *redo the
 * whole article* answers as *redo* — AI processing, where every other redo
 * lives. The code review preferred strict AND here; "nothing matched" is the
 * exact complaint this answers, so a near answer wins. Plan 261002c § After
 * GPT Sol's code review.
 *
 * **A section that needed its `body` comes after every section that did
 * not.** A word counts in the body only when the name, the keywords and the
 * aside all missed it, and a section with any such word is ranked below all
 * the others, however well its other words did. So whenever a query was
 * answered before its page gave its sections a body, that answer is still the
 * top of the list, in the same order, and the body only adds rows beneath.
 * (What does change: a word that only a body knows is no longer a word no
 * section answers, so it is not set aside.) A section with no body, which is
 * every one on Metadata, is unaffected.
 */
export function searchSections(
  query: string,
  sections: readonly SearchableSection[],
  synonyms: SynonymTable = METADATA_SYNONYMS,
): string[] {
  const all = words(query);
  if (all.length === 0) return [];
  const content = all.filter(
    (t, i) => !STOPWORDS.has(t) && !(t === "get" && all[i + 1] === "rid"),
  );
  const terms = content.length > 0 ? content : all;
  const groups = groupsOf(synonyms);
  const expanded = terms.map((t) => ({ term: t, synonyms: synonymsOf(t, groups) }));
  /* Each section's best score for each query word, 0 for a miss. */
  const rows = sections.map((section, order) => {
    const fields: Record<Field, string[]> = {
      label: words(section.label),
      keywords: words(section.keywords),
      aside: words(section.aside),
    };
    const body = section.body === undefined ? [] : words(section.body);
    /* Which query words only the body answered: § the last paragraph above. */
    const fromBody: boolean[] = [];
    const scores = expanded.map(({ term, synonyms }, i) => {
      let best = 0;
      for (const field of Object.keys(FIELD_WEIGHT) as Field[]) {
        best = Math.max(best, FIELD_WEIGHT[field] * hit(term, synonyms, fields[field]));
      }
      fromBody[i] = best === 0;
      return best > 0 ? best : BODY_WEIGHT * hit(term, synonyms, body);
    });
    return { id: section.id, order, scores, fromBody };
  });
  const answering = (wanted: readonly number[]) =>
    rows
      .filter((r) => wanted.every((i) => (r.scores[i] ?? 0) > 0))
      .map((r) => ({
        ...r,
        score: wanted.reduce((sum, i) => sum + (r.scores[i] ?? 0), 0),
        neededBody: wanted.some((i) => r.fromBody[i] === true),
      }))
      .sort((a, b) => Number(a.neededBody) - Number(b.neededBody) || b.score - a.score || a.order - b.order)
      .map((r) => r.id);
  const every = terms.map((_, i) => i);
  const found = answering(every);
  if (found.length > 0) return found;
  const known = every.filter((i) => rows.some((r) => (r.scores[i] ?? 0) > 0));
  return known.length > 0 && known.length < every.length ? answering(known) : [];
}
