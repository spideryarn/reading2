/**
 * **Step 2 of the shelf's filter terms: every article's candidates → the
 * shelf's topics.** Pure, no I/O, and not cached: it runs on every shelf load,
 * over the stored output of step 1 (./extract.ts).
 *
 * docs/plans/260928a-shelf-facet-terms.md § Step 2. In one breath: an article
 * *has* a phrase when its prose uses it densely enough; exact copies are one
 * *work*; a phrase is a candidate when it covers between 3% and half of the
 * works; then a greedy pass takes the phrase with the largest
 * `(Σ 0.2^times-already-covered) × quality`, skipping any that restates a
 * topic already taken and replacing one it contains. Covered works are
 * discounted rather than removed, which is what lets topics overlap — Greg
 * asked for "overlapping subsets". The order taken is the rank the row draws
 * in. Plan 260928d § Measurements says why this ranking and not the
 * lexicographic one that `qualityExponent: null` still offers.
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
  /**
   * Skip a candidate that adds at most one new work when this share of its
   * works is already in one chosen topic (|candidate ∩ chosen| / |candidate|)…
   */
  containmentMax?: number;
  /** …or this share, when the two share a word stem. */
  sharedWordContainmentMax?: number;
  /** Only this many candidates, the highest in quality, take part in the greedy pass. */
  qualityPool?: number;
  /**
   * A work whose article has fewer counted prose words than this adds nothing
   * to a candidate's coverage gain. It can still be a member and still counts.
   */
  minCoverageWords?: number;
  /**
   * Null: rank lexicographically (new works, then discounted coverage, then
   * quality). A number: rank by `discounted coverage × quality^this` instead.
   */
  qualityExponent?: number | null;
  /**
   * Quality is multiplied by `1 + this × (words − 1)`: at 1 a two-word phrase
   * counts double a single word of equal weight, at 0 not at all.
   */
  phraseBonus?: number;
}

const DEFAULTS: Required<ChooseOptions> = {
  maxTerms: 30,
  minWorks: 8,
  densityPer1000: 0.3,
  minDfFraction: 0.03,
  maxDfFraction: 0.5,
  jaccardMax: 0.7,
  sharedWordJaccardMax: 0.3,
  containmentMax: 0.9,
  sharedWordContainmentMax: 0.8,
  qualityPool: Number.POSITIVE_INFINITY,
  minCoverageWords: 0,
  qualityExponent: 1,
  phraseBonus: 1,
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
  fromPlural: boolean;
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
  const alias = shortPluralAliases(articles);
  for (const a of articles) {
    const need = Math.max(2, (densityPer1000 * a.words) / 1000);
    for (const [key, c] of mergeCandidates(a.candidates, alias)) {
      getOrSet(dfAll, key, () => new Set<string>()).add(a.textHash);
      if (c.bodyCount < need) continue;
      getOrSet(members, key, () => new Map<string, Membership>()).set(a.slug, {
        hash: a.textHash,
        count: c.count,
        bodyCount: c.bodyCount,
        label: c.label,
        fromPlural: c.fromPlural,
      });
    }
  }
  return { members, dfAll };
}

/**
 * **Short plurals the extractor cannot fold** (plan 260928d): `foldKey` returns
 * three letters or fewer whole, and keeps *-us* and *-os* (*virus*, *chaos*), so
 * *AIs*, *UIs*, *GPUs* and *NGOs* key as `ais`, `uis`, `gpus`, `ngos`. A key of
 * at most four characters ending in *s* aliases to its singular only when the
 * shelf has matching acronym surface forms (`AI` and `AIs`). The surface-form
 * evidence matters: two real keys such as *bu* and *bus* must stay distinct.
 * Folding here rather than in the extractor leaves every stored candidate row
 * valid — no `EXTRACTOR_VERSION` bump.
 */
function shortPluralAliases(articles: ChooseArticle[]): Map<string, string> {
  const forms = new Map<string, Set<string>>();
  for (const a of articles)
    for (const c of a.candidates) getOrSet(forms, c.key, () => new Set<string>()).add(c.label);
  const alias = new Map<string, string>();
  for (const [k, pluralForms] of forms) {
    const singular = k.slice(0, -1);
    const singularForms = forms.get(singular);
    if (k.length > 4 || !k.endsWith("s") || k.includes(" ") || !singularForms) continue;
    const hasAcronymPair = [...singularForms].some(
      (form) => /^[A-Z][A-Z0-9]+$/.test(form) && pluralForms.has(`${form}s`),
    );
    if (hasAcronymPair) alias.set(k, singular);
  }
  return alias;
}

interface Merged {
  count: number;
  bodyCount: number;
  label: string;
  /** Only the plural was in this article, so its label is not the singular's form. */
  fromPlural: boolean;
}

/** One article's candidates with short plurals added into their singulars. */
function mergeCandidates(cands: Candidate[], alias: Map<string, string>): Map<string, Merged> {
  const out = new Map<string, Merged>();
  for (const c of cands) {
    const target = alias.get(c.key);
    const key = target ?? c.key;
    const plural = target !== undefined;
    const had = out.get(key);
    if (!had) {
      out.set(key, { count: c.count, bodyCount: c.bodyCount, label: c.label, fromPlural: plural });
      continue;
    }
    had.count += c.count;
    had.bodyCount += c.bodyCount;
    /* the singular's surface form wins, whichever order they arrive in */
    if (!plural) {
      had.label = c.label;
      had.fromPlural = false;
    }
  }
  return out;
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
  phraseBonus: number,
): Pool | null {
  /* per work, its largest body count — copies are identical, so this is only
     a total order, not a choice */
  const tf = new Map<string, number>();
  for (const x of m.values()) tf.set(x.hash, Math.max(tf.get(x.hash) ?? 0, x.bodyCount));
  const works = [...tf.keys()].sort(byString);
  if (works.length < band.minDf || works.length > band.maxDf) return null;

  /* quality: mean over member works of (1 + ln tf) × idf, times
     `1 + phraseBonus × (words − 1)` so a phrase can beat a single word of equal weight */
  const idf = Math.log(N / dfSize);
  let sum = 0;
  for (const w of works) sum += (1 + Math.log(tf.get(w) ?? 1)) * idf;
  const quality = (sum / works.length) * (1 + phraseBonus * (key.split(" ").length - 1));

  /* The label is the singular's form when any article used the singular. */
  const all = [...m.values()];
  const singular = all.filter((x) => !x.fromPlural);
  const forms = new Map<string, number>();
  for (const x of singular.length ? singular : all)
    forms.set(x.label, (forms.get(x.label) ?? 0) + x.count);
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

/** Share of `pick`'s works that `chosen` already has — directional, unlike Jaccard. */
function containment(pick: Pool, chosen: Pool): number {
  let inter = 0;
  for (const w of pick.works) if (chosen.workSet.has(w)) inter++;
  return pick.works.length ? inter / pick.works.length : 0;
}

/**
 * Does `pick` restate a topic already chosen? Jaccard above `jaccardMax`; or
 * above `sharedWordJaccardMax` when the two share a word stem; or — plan
 * 260928d, Sol R2 — `pick` adds at most one new work and sits inside a chosen
 * topic (≥ 0.8 of it with a shared stem, ≥ 0.9 regardless). The last is
 * directional on purpose: a big topic that contains a small chosen one is not
 * skipped for it, because it reaches works the small one does not.
 */
function isRedundant(
  chosen: Pool[],
  pick: Pool,
  newWorks: number,
  o: Required<ChooseOptions>,
): boolean {
  return chosen.some((t) => {
    const j = jaccard(t.workSet, pick.workSet);
    const shared = sharesWord(t.key, pick.key);
    /* A genuinely larger later candidate may replace this chosen subset in
       `admit`; do not let the symmetric Jaccard rule discard it first. */
    if (
      shared &&
      pick.works.length > t.works.length &&
      containment(t, pick) >= o.sharedWordContainmentMax
    )
      return false;
    if (j > o.jaccardMax || (shared && j > o.sharedWordJaccardMax)) return true;
    if (newWorks > 1) return false;
    const inside = containment(pick, t);
    return inside >= o.containmentMax || (shared && inside >= o.sharedWordContainmentMax);
  });
}

/** How a candidate compares at one greedy step. */
interface Step {
  /** Works no chosen topic has yet. */
  fresh: number;
  /** Σ over its works of 0.2^(times already covered) — the once-covered still count a little. */
  discounted: number;
}

/**
 * Strictly better, lexicographically: more new works; then more discounted
 * coverage; then quality. Plan 260928d § Stage 1, Sol R3 — coverage first in
 * fact, not a product that a large enough quality gap can overturn.
 */
function better(a: Step, qa: number, b: Step, qb: number, exponent: number | null): boolean {
  if (exponent !== null) return a.discounted * qa ** exponent > b.discounted * qb ** exponent;
  if (a.fresh !== b.fresh) return a.fresh > b.fresh;
  if (a.discounted !== b.discounted) return a.discounted > b.discounted;
  return qa > qb;
}

/**
 * Greedy coverage with overlap allowed. The order taken is the **rank**, which
 * the row draws in. `pool` is sorted by key and `better` is strict, so an
 * exact tie goes to the smaller key.
 */
function greedy(pool: Pool[], K: number, o: Required<ChooseOptions>, short: ReadonlySet<string>): Pool[] {
  const covered = new Map<string, number>();
  const chosen: Pool[] = [];
  /* A topic with no quality (idf 0: every work mentions it) is never a topic.
     `qualityPool` limits the pass to the best in quality; it exists for the
     lexicographic order, where coverage alone let the most-covering words on
     the local shelf (process, research, mistake) crowd out every real topic.
     Back in key order, which is what makes an exact tie go to the smaller key. */
  let remaining = eligible(pool, o.qualityPool);
  while (chosen.length < K && remaining.length) {
    let best: Pool | null = null;
    let bestStep: Step = { fresh: -1, discounted: -1 };
    for (const c of remaining) {
      const step = measure(c, covered, short);
      if (!best || better(step, c.quality, bestStep, best.quality, o.qualityExponent)) {
        best = c;
        bestStep = step;
      }
    }
    if (!best) break;
    const pick = best;
    remaining = remaining.filter((c) => c !== pick);
    if (!isRedundant(chosen, pick, bestStep.fresh, o)) admit(chosen, pick, covered, o);
  }
  return chosen;
}

function measure(c: Pool, covered: ReadonlyMap<string, number>, short: ReadonlySet<string>): Step {
  const step: Step = { fresh: 0, discounted: 0 };
  for (const w of c.works) {
    /* a short work is a member but earns no coverage: chasing a 99-word note
       is what put *mistake* and *board* in the first twelve (plan 260928d) */
    if (short.has(w)) continue;
    const n = covered.get(w) ?? 0;
    if (n === 0) step.fresh += 1;
    step.discounted += 0.2 ** n;
  }
  return step;
}

/**
 * Add `pick` to `chosen`. A chosen topic that shares a stem with `pick` and
 * sits mostly inside it (*AI systems*, taken early for its quality, inside
 * *AI*) is replaced by `pick`, in its place — the row shows one of the two,
 * and the one that reaches more of the shelf. The lexicographic order takes
 * a superset first, so there this almost never fires.
 */
function admit(
  chosen: Pool[],
  pick: Pool,
  covered: Map<string, number>,
  o: Required<ChooseOptions>,
): void {
  const absorbed = chosen.filter(
    (t) => sharesWord(t.key, pick.key) && containment(t, pick) >= o.sharedWordContainmentMax,
  );
  for (const t of absorbed) for (const w of t.works) covered.set(w, (covered.get(w) ?? 1) - 1);
  const first = absorbed[0];
  if (first) {
    const kept = chosen.filter((t) => t === first || !absorbed.includes(t));
    kept[kept.indexOf(first)] = pick;
    chosen.splice(0, chosen.length, ...kept);
  } else chosen.push(pick);
  for (const w of pick.works) covered.set(w, (covered.get(w) ?? 0) + 1);
}

/** The `n` best in quality, above zero, back in key order. */
function eligible(pool: Pool[], n: number): Pool[] {
  return [...pool]
    .filter((c) => c.quality > 0)
    .sort((a, b) => b.quality - a.quality || byString(a.key, b.key))
    .slice(0, n)
    .sort((a, b) => byString(a.key, b.key));
}

/** Every candidate that passes membership and the band, sorted by key. */
function buildPool(articles: ChooseArticle[], N: number, o: Required<ChooseOptions>): Pool[] {
  const { members, dfAll } = collect(articles, o.densityPer1000);
  const band = {
    minDf: Math.max(2, Math.ceil(o.minDfFraction * N)),
    maxDf: Math.floor(o.maxDfFraction * N),
  };
  const pool: Pool[] = [];
  for (const key of [...members.keys()].sort(byString)) {
    const m = members.get(key);
    const p = m ? toPool(key, m, dfAll.get(key)?.size ?? 1, N, band, o.phraseBonus) : null;
    if (p) pool.push(p);
  }
  return pool;
}

/**
 * **For measurement only**: every candidate the chooser could pick from, as
 * a `ShelfTerm`, by key. Its union is the coverage ceiling; the report runs an
 * unweighted max-coverage greedy over it as the baseline (plan 260928d, Sol R5).
 */
export function candidateTopics(articles: ChooseArticle[], opts: ChooseOptions = {}): ShelfTerm[] {
  const o = { ...DEFAULTS, ...opts };
  const N = new Set(articles.map((a) => a.textHash)).size;
  if (N < o.minWorks) return [];
  return eligible(buildPool(articles, N, o), opts.qualityPool ?? Number.POSITIVE_INFINITY).map(
    (p) => ({ key: p.key, label: p.label, articles: p.articles }),
  );
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

  const short = new Set(articles.filter((a) => a.words < o.minCoverageWords).map((a) => a.textHash));
  const chosen = greedy(buildPool(articles, N, o), Math.min(o.maxTerms, N), o, short);
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
    maxPairwiseJaccard: js.reduce((m, x) => Math.max(m, x), 0),
    uncovered: articleSlugs.filter((s) => per.get(s) === 0),
  };
}

/** |A ∩ B| / min(|A|, |B|): 1 when the smaller set sits wholly inside the larger. */
export function overlapCoefficient(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const min = Math.min(a.size, b.size);
  return min === 0 ? 0 : inter / min;
}

export interface ShelfTermHeadMetrics {
  /** Share of in-scope articles in at least one of the first 5 / 8 / 12 topics. */
  coverageAt5: number;
  coverageAt8: number;
  coverageAt12: number;
  /** Over every pair among the first 12 topics' article sets. */
  meanJaccard12: number;
  maxJaccard12: number;
  meanOverlap12: number;
  maxOverlap12: number;
}

/**
 * **What a reader sees first** (plan 260928d § Stage 1): coverage of the first
 * few topics **in the order given** — pass the order the row draws them in —
 * and how much the first twelve restate each other. Physical articles, only
 * those in `articleSlugs`, like `shelfTermMetrics`.
 */
export function shelfTermHeadMetrics(
  terms: ShelfTerm[],
  articleSlugs: string[],
): ShelfTermHeadMetrics {
  const scope = new Set(articleSlugs);
  const sets = terms.map((t) => new Set(t.articles.map((a) => a.slug).filter((s) => scope.has(s))));
  const coverageAt = (k: number) => {
    if (!scope.size) return 0;
    const hit = new Set<string>();
    for (const set of sets.slice(0, k)) for (const s of set) hit.add(s);
    return hit.size / scope.size;
  };
  const head = sets.slice(0, 12);
  const js: number[] = [];
  const os: number[] = [];
  for (let i = 0; i < head.length; i++)
    for (let j = i + 1; j < head.length; j++) {
      const a = head[i];
      const b = head[j];
      if (a && b) {
        js.push(jaccard(a, b));
        os.push(overlapCoefficient(a, b));
      }
    }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
  return {
    coverageAt5: coverageAt(5),
    coverageAt8: coverageAt(8),
    coverageAt12: coverageAt(12),
    meanJaccard12: mean(js),
    maxJaccard12: max(js),
    meanOverlap12: mean(os),
    maxOverlap12: max(os),
  };
}

/**
 * The baseline a coverage-first chooser is judged against: plain greedy
 * maximum coverage of physical in-scope articles, ignoring quality — at each
 * step the topic reaching the most not-yet-covered articles, ties by key.
 */
export function maxCoverageOrder(terms: ShelfTerm[], articleSlugs: string[], k: number): ShelfTerm[] {
  const scope = new Set(articleSlugs);
  const hit = new Set<string>();
  const left = [...terms].sort((a, b) => byString(a.key, b.key));
  const out: ShelfTerm[] = [];
  while (out.length < k && left.length) {
    let bestAt = 0;
    let bestN = -1;
    left.forEach((t, i) => {
      const n = t.articles.filter((a) => scope.has(a.slug) && !hit.has(a.slug)).length;
      if (n > bestN) {
        bestN = n;
        bestAt = i;
      }
    });
    const [pick] = left.splice(bestAt, 1);
    if (!pick) break;
    out.push(pick);
    for (const a of pick.articles) hit.add(a.slug);
  }
  return out;
}

/**
 * The order the row drew topics in before plan 260928d: most articles first,
 * ties by label. Kept for the report's "before" column only.
 */
export function byArticleCount(terms: ShelfTerm[]): ShelfTerm[] {
  return [...terms].sort(
    (a, b) => b.articles.length - a.articles.length || a.label.localeCompare(b.label),
  );
}
