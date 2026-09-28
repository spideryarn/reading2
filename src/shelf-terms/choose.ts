/**
 * **Step 2 of the shelf's filter terms: every article's candidates → the
 * shelf's topics.** Pure, no I/O, and not cached: it runs on every shelf load,
 * over the stored output of step 1 (./extract.ts).
 *
 * docs/plans/260928a-shelf-facet-terms.md § Step 2. In one breath: an article
 * *has* a phrase when its prose uses it densely enough; exact copies are one
 * *work*; a phrase is a candidate when it covers between 3% and half of the
 * works; then a greedy pass takes the phrase that adds the most weighted,
 * not-yet-much-covered works, skipping any that restates a topic already
 * taken. Covered works are discounted rather than removed, which is what lets
 * topics overlap — Greg asked for "overlapping subsets".
 *
 * **A total order everywhere** (Sol F7): every iteration that can affect a
 * float sum or a tie runs over sorted keys, so the same shelf gives the same
 * topics however the articles and their candidates arrive. The tests shuffle
 * both to prove it.
 */
import { type Candidate, pickLabel } from "./extract.js";

/** One article, as step 2 needs it: step 1's stored output plus the slug. */
export interface ChooseArticle {
  slug: string;
  /** Counted prose words — `Extraction.words`. */
  words: number;
  /** `Extraction.textHash`; articles sharing one are one work. */
  textHash: string;
  /** Empty for an article step 1 skipped. */
  candidates: Candidate[];
}

export interface ShelfTermArticle {
  slug: string;
  /** The literal `Candidate.count` — what the tooltip says. */
  count: number;
}

export interface ShelfTerm {
  key: string;
  label: string;
  /**
   * Every **physical** article that is a member — copies included, so six
   * copies are six cards and a count of six (the plan § Step 2). By count
   * descending, then slug.
   */
  articles: ShelfTermArticle[];
}

export interface ChooseResult {
  /** In the order the greedy pass took them — best first. */
  terms: ShelfTerm[];
  /** Distinct works (text hashes) among the input. */
  works: number;
}

export interface ChooseOptions {
  /** K. Capped further at the number of works, so a small shelf gets fewer. */
  maxTerms?: number;
  /** Below this many works, no topics at all. */
  minWorks?: number;
  /** Membership needs `max(2, this × words / 1000)` prose occurrences. */
  densityPer1000?: number;
  /** A topic covers at least `max(2, ceil(this × works))` works… */
  minDfFraction?: number;
  /** …and at most `floor(this × works)`. */
  maxDfFraction?: number;
  /** Skip a candidate whose work set's Jaccard with a chosen topic's exceeds this. */
  jaccardMax?: number;
  /** …or exceeds this when the two share a word, after `stemForOverlap`. */
  sharedWordJaccardMax?: number;
}

const DEFAULTS: Required<ChooseOptions> = {
  maxTerms: 30,
  minWorks: 8,
  densityPer1000: 0.3,
  minDfFraction: 0.03,
  maxDfFraction: 0.5,
  jaccardMax: 0.7,
  sharedWordJaccardMax: 0.3,
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A crude suffix strip for the shared-word check only — *consciousness* and
 * *conscious*, *computational* and *computation* — so the spike's
 * *conscious AI* / *conscious experience* / *consciousness* triple cannot all
 * win (Sol F4). Keys are already plural-folded, so plurals need nothing here.
 * One suffix, and a stem of at least four letters, so it stays crude rather
 * than eager; if it proves too eager, near-synonyms stay a stated v1 limit.
 */
export function stemForOverlap(word: string): string {
  for (const suffix of ["ness", "ity", "al"])
    if (word.endsWith(suffix) && word.length - suffix.length >= 4)
      return word.slice(0, -suffix.length);
  return word;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function sharesWord(a: string, b: string): boolean {
  const stems = new Set(a.split(" ").map(stemForOverlap));
  return b.split(" ").some((w) => stems.has(stemForOverlap(w)));
}

/** A candidate topic that has passed membership and the band. */
interface Pool {
  key: string;
  label: string;
  /** Member works, sorted — the order every float sum runs in. */
  works: string[];
  workSet: Set<string>;
  quality: number;
  articles: ShelfTermArticle[];
}

/** One member article's facts for one key. */
interface Membership {
  hash: string;
  count: number;
  bodyCount: number;
  label: string;
}

/** key → slug → membership, and key → works whose stored candidates name it at all. */
interface Collected {
  members: Map<string, Map<string, Membership>>;
  dfAll: Map<string, Set<string>>;
}

function getOrSet<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  const found = map.get(key);
  if (found !== undefined) return found;
  const made = make();
  map.set(key, made);
  return made;
}

/**
 * Membership, per physical article: the phrase's prose count reaches
 * `max(2, 0.3 per 1,000 words)`. Scaled by length, because an absolute
 * threshold let a 152k-word book join every common word's set. **bodyCount,
 * never count or score**, so a title hit alone is not membership (Sol F3).
 *
 * `dfAll` is for idf and counts every stored candidate, member or not.
 */
function collect(articles: ChooseArticle[], densityPer1000: number): Collected {
  const members = new Map<string, Map<string, Membership>>();
  const dfAll = new Map<string, Set<string>>();
  for (const a of articles) {
    const need = Math.max(2, (densityPer1000 * a.words) / 1000);
    for (const c of a.candidates) {
      getOrSet(dfAll, c.key, () => new Set<string>()).add(a.textHash);
      if (c.bodyCount < need) continue;
      getOrSet(members, c.key, () => new Map<string, Membership>()).set(a.slug, {
        hash: a.textHash,
        count: c.count,
        bodyCount: c.bodyCount,
        label: c.label,
      });
    }
  }
  return { members, dfAll };
}

/**
 * One key's members → a pool entry, or null when it falls outside the band.
 * The band is over **works**, so five copies of one article cannot make a
 * five-article topic (Sol F9); the articles listed are physical.
 */
function toPool(
  key: string,
  m: Map<string, Membership>,
  dfSize: number,
  N: number,
  band: { minDf: number; maxDf: number },
): Pool | null {
  /* per work, its largest body count — copies are identical, so this is only
     a total order, not a choice */
  const tf = new Map<string, number>();
  for (const x of m.values()) tf.set(x.hash, Math.max(tf.get(x.hash) ?? 0, x.bodyCount));
  const works = [...tf.keys()].sort(byString);
  if (works.length < band.minDf || works.length > band.maxDf) return null;

  /* quality: mean over member works of (1 + ln tf) × idf, times `1 + (words − 1)`
     so a two-word phrase beats a single word of equal weight */
  const idf = Math.log(N / dfSize);
  let sum = 0;
  for (const w of works) sum += (1 + Math.log(tf.get(w) ?? 1)) * idf;
  const quality = (sum / works.length) * key.split(" ").length;

  const forms = new Map<string, number>();
  for (const x of m.values()) forms.set(x.label, (forms.get(x.label) ?? 0) + x.count);
  const articles = [...m.entries()]
    .map(([slug, x]) => ({ slug, count: x.count }))
    .sort((a, b) => b.count - a.count || byString(a.slug, b.slug));

  return {
    key,
    label: pickLabel([...forms.entries()].sort((a, b) => byString(a[0], b[0]))),
    works,
    workSet: new Set(works),
    quality,
    articles,
  };
}

/**
 * Does `pick` restate a topic already chosen? Two skips, not the plan's first
 * three: a "contains the other phrase" rule at 0.5 could never fire, because a
 * phrase that contains another always shares a word with it and the shared-word
 * rule's 0.3 is lower. Dropped rather than kept as a switch nobody can reach.
 */
function isRedundant(chosen: Pool[], pick: Pool, o: Required<ChooseOptions>): boolean {
  return chosen.some((t) => {
    const j = jaccard(t.workSet, pick.workSet);
    return (
      j > o.jaccardMax ||
      (sharesWord(t.key, pick.key) && j > o.sharedWordJaccardMax)
    );
  });
}

/**
 * Greedy coverage with overlap allowed: repeatedly take the largest
 * `quality × sqrt(Σ over its works of 1 / (1 + times already covered))`.
 * `pool` is sorted by key and the comparison is a strict `>`, so an exactly
 * equal gain goes to the smaller key.
 */
function greedy(pool: Pool[], K: number, o: Required<ChooseOptions>): Pool[] {
  const covered = new Map<string, number>();
  const chosen: Pool[] = [];
  let remaining = pool;
  while (chosen.length < K && remaining.length) {
    let best: Pool | null = null;
    let bestGain = 0;
    for (const c of remaining) {
      let g = 0;
      for (const w of c.works) g += 1 / (1 + (covered.get(w) ?? 0));
      const gain = c.quality * Math.sqrt(g);
      if (gain > bestGain) {
        bestGain = gain;
        best = c;
      }
    }
    if (!best) break;
    const pick = best;
    remaining = remaining.filter((c) => c !== pick);
    if (isRedundant(chosen, pick, o)) continue;
    chosen.push(pick);
    for (const w of pick.works) covered.set(w, (covered.get(w) ?? 0) + 1);
  }
  return chosen;
}

/**
 * The shelf's topics. The rules and their numbers are the plan's § Step 2; the
 * options exist for the tests and the report script, not for callers to tune.
 */
export function chooseTerms(articles: ChooseArticle[], opts: ChooseOptions = {}): ChooseResult {
  const o = { ...DEFAULTS, ...opts };
  const N = new Set(articles.map((a) => a.textHash)).size;
  /* On the 000…002 test shelf, 6 articles that are 2 works, every
     configuration the spike tried chose nothing useful. */
  if (N < o.minWorks) return { terms: [], works: N };

  const { members, dfAll } = collect(articles, o.densityPer1000);
  const band = {
    minDf: Math.max(2, Math.ceil(o.minDfFraction * N)),
    maxDf: Math.floor(o.maxDfFraction * N),
  };
  const pool: Pool[] = [];
  for (const key of [...members.keys()].sort(byString)) {
    const m = members.get(key);
    const p = m ? toPool(key, m, dfAll.get(key)?.size ?? 1, N, band) : null;
    if (p) pool.push(p);
  }

  const chosen = greedy(pool, Math.min(o.maxTerms, N), o);
  return {
    terms: chosen.map((t) => ({ key: t.key, label: t.label, articles: t.articles })),
    works: N,
  };
}

/* ── Measurement ────────────────────────────────────────────────────────── */

export interface ShelfTermMetrics {
  /** In-scope articles. */
  articles: number;
  terms: number;
  /** Share of in-scope articles in at least one topic. */
  coverage: number;
  meanTermsPerArticle: number;
  medianTermsPerArticle: number;
  /** Share of in-scope articles in two or more topics — how much they overlap. */
  shareWithTwoOrMore: number;
  /** Over every pair of topics' article sets: low means topics are not restating each other. */
  meanPairwiseJaccard: number;
  maxPairwiseJaccard: number;
  /** In-scope slugs in no topic, in the order given. */
  uncovered: string[];
}

/**
 * **The one definition** of coverage, overlap and redundancy (the plan §
 * Measurements), so the tests, the report script and the plan's table agree.
 * Counts physical articles, and only those in `articleSlugs`.
 */
export function shelfTermMetrics(terms: ShelfTerm[], articleSlugs: string[]): ShelfTermMetrics {
  const scope = new Set(articleSlugs);
  const per = new Map(articleSlugs.map((s) => [s, 0]));
  const sets = terms.map((t) => new Set(t.articles.map((a) => a.slug).filter((s) => scope.has(s))));
  for (const set of sets) for (const s of set) per.set(s, (per.get(s) ?? 0) + 1);
  const counts = [...per.values()];
  const n = counts.length;
  const share = (pred: (x: number) => boolean) => (n ? counts.filter(pred).length / n : 0);

  const sorted = [...counts].sort((a, b) => a - b);
  const median = !n
    ? 0
    : n % 2
      ? (sorted[(n - 1) / 2] ?? 0)
      : ((sorted[n / 2 - 1] ?? 0) + (sorted[n / 2] ?? 0)) / 2;

  const js: number[] = [];
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (a && b) js.push(jaccard(a, b));
    }

  return {
    articles: n,
    terms: terms.length,
    coverage: share((x) => x > 0),
    meanTermsPerArticle: n ? counts.reduce((s, x) => s + x, 0) / n : 0,
    medianTermsPerArticle: median,
    shareWithTwoOrMore: share((x) => x >= 2),
    meanPairwiseJaccard: js.length ? js.reduce((s, x) => s + x, 0) / js.length : 0,
    maxPairwiseJaccard: js.length ? Math.max(...js) : 0,
    uncovered: articleSlugs.filter((s) => per.get(s) === 0),
  };
}
