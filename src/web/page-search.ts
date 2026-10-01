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
 * - **A synonym table** (`SYNONYMS`), hand-written for the words this page is
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
 * **Not the text inside a section.** A hit there would promise "the right
 * place" (Greg's words) and then land on the section's heading, which for *AI
 * processing* is screens above the line; and half the sections unmount their
 * body when shut, so it would find some words and not others. Landing on the
 * matching line is the deferred version, with a model or embedding for
 * paraphrase after it. GPT Sol, plan review; plan 261001s § The search box.
 */

/** One section as the search sees it — read off the DOM by PageContents. */
export interface SearchableSection {
  id: string;
  label: string;
  /** The page's own extra words for it (`data-keywords`). */
  keywords: string;
  /** The heading's one-line answer, e.g. "$0.0123 · 12 calls". */
  aside: string;
}

/**
 * Words that mean the same thing **on this page**. Not a thesaurus: each group
 * is the vocabulary a reader might bring to one of the page's questions. A word
 * may sit in only one group — `GROUP_OF` below would silently keep the last.
 */
const SYNONYMS: readonly (readonly string[])[] = [
  ["cost", "price", "spend", "spent", "money", "dollar", "bill", "expense", "charge", "paid", "usage"],
  ["delete", "remove", "erase", "trash", "destroy", "bin", "purge"],
  ["archive", "hide", "shelve", "shelf", "unshelve"],
  ["share", "public", "private", "link", "visibility", "visible", "access", "publish", "permission"],
  ["export", "download", "backup", "save", "copy", "json"],
  ["rerun", "regenerate", "redo", "refresh", "retry", "rebuild", "again", "run", "restart", "processing"],
  ["author", "writer", "byline", "wrote", "written", "who"],
  ["reading", "progress", "read", "finished", "time"],
  ["technical", "debug", "file", "storage", "raw", "slug", "internal"],
  ["glance", "stat", "statistic", "overview", "count", "length", "word", "size"],
  ["pdf", "scan", "ocr", "extraction", "quality"],
  ["sentence", "summary", "gist", "tldr", "abstract"],
];

/**
 * Lower-cased, accents off, a plural / -ing / -ed and then a final -e taken
 * away — so *share*, *shares*, *sharing* and *shared* are all `shar`. Crude on
 * purpose: both sides go through it, so it only has to be consistent, not
 * right. Short words are left alone, or *is* and *as* would vanish.
 */
function stem(word: string): string {
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
    .map(stem);
}

const GROUP_OF = new Map<string, readonly string[]>();
for (const group of SYNONYMS) {
  const stems = group.map(stem);
  for (const s of stems) GROUP_OF.set(s, stems);
}

/**
 * **Words a question is made of rather than about**, dropped from a query that
 * has anything else in it — so *how much did this cost* is a search for *cost*
 * and not a search that fails because no section says *did*. A query of only
 * these keeps them all, so *what it cost* still finds *What it cost*.
 */
const STOPWORDS = new Set(
  [
    "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "is", "are", "was", "it", "its",
    "this", "that", "my", "me", "i", "how", "much", "many", "what", "which", "where", "when", "why",
    "do", "does", "did", "can", "show", "see", "find", "about", "article", "page",
  ].map(stem),
);

/** A query word shorter than this does not expand through the table by prefix. */
const MIN_PREFIX_EXPAND = 3;

/** The other words a query word stands for: its group's, or its prefix's groups'. */
function synonymsOf(term: string): Set<string> {
  const out = new Set<string>();
  for (const [s, group] of GROUP_OF) {
    if (s === term || (term.length >= MIN_PREFIX_EXPAND && s.startsWith(term))) {
      for (const g of group) if (g !== term) out.add(g);
    }
  }
  return out;
}

/** Where in a section a word was found, best first. */
const FIELD_WEIGHT = { label: 8, keywords: 4, aside: 2 } as const;
type Field = keyof typeof FIELD_WEIGHT;
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
 * answers nothing, and the caller shows its whole list instead.
 */
export function searchSections(query: string, sections: readonly SearchableSection[]): string[] {
  const all = words(query);
  if (all.length === 0) return [];
  const content = all.filter((t) => !STOPWORDS.has(t));
  const terms = content.length > 0 ? content : all;
  const expanded = terms.map((t) => ({ term: t, synonyms: synonymsOf(t) }));
  const scored: { id: string; score: number; order: number }[] = [];
  sections.forEach((section, order) => {
    const fields: Record<Field, string[]> = {
      label: words(section.label),
      keywords: words(section.keywords),
      aside: words(section.aside),
    };
    let score = 0;
    for (const { term, synonyms } of expanded) {
      let best = 0;
      for (const field of Object.keys(FIELD_WEIGHT) as Field[]) {
        best = Math.max(best, FIELD_WEIGHT[field] * hit(term, synonyms, fields[field]));
      }
      if (best === 0) return; // every word must hit somewhere
      score += best;
    }
    scored.push({ id: section.id, score, order });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((s) => s.id);
}
