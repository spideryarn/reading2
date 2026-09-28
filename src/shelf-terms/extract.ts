/**
 * **Step 1 of the shelf's filter terms: one article's text → its candidate
 * phrases.** Pure, no I/O, no dependency.
 *
 * docs/plans/260928a-shelf-facet-terms.md § Step 1. The shelf-wide choice is
 * step 2, in ./choose.ts; this half is the one that gets stored, once per
 * `(revision, EXTRACTOR_VERSION)`, so anything that changes its output for the
 * same text must bump the version.
 *
 * ## The shape of it
 *
 * Hand-written and RAKE-shaped: tokenise; split into runs at stopwords and
 * punctuation; take every 1–3-gram inside a run. A `compromise` noun-phrase
 * extractor was measured against this in the spike and lost on speed, size
 * and coverage (the plan § Why not `compromise`), so there is no tagger —
 * which is why the "nounish" test below is a set of word lists and suffix
 * rules rather than parts of speech.
 *
 * ## English only, said out loud
 *
 * Every list here is English. An article whose prose is not is skipped with a
 * reason rather than contributing *les* and *dans* as topics (Sol F12).
 *
 * The lists are lifted from the spike (spike/facets/extract.ts), which is what
 * the plan's measurements were taken with.
 */
import { createHash } from "node:crypto";
import { isEmbeddable } from "../block-policy.js";
import type { Block } from "../types.js";

/**
 * Bump on any change that can alter the output for the same input text: a
 * list, a rule, the limit, the hash's canonical form — and a change to
 * `isEmbeddable` in src/block-policy.ts, which `segmentsFromBlocks` reads and
 * which cannot see this number. A bump writes new rows beside the old ones
 * (the plan § Storage), so it is cheap; forgetting one is not.
 */
export const EXTRACTOR_VERSION = 1;

export type SegmentKind = "title" | "heading" | "prose";

/**
 * One piece of counted text. The entry point takes these rather than blocks so
 * that something that is not an article — a bibliography entry's title and
 * abstract — can feed the same function (the plan § Step 1, "One entry point
 * takes plain text").
 */
export interface Segment {
  text: string;
  kind: SegmentKind;
}

/**
 * One phrase an article uses. **Three numbers, not one** (Sol F3): the spike
 * folded the title's weight into a single count, so one title occurrence read
 * as "used 3 times" in a tooltip and passed membership on its own.
 */
export interface Candidate {
  /** Lowercased, plural-folded tokens joined by one space — what topics are keyed and URL-addressed by. */
  key: string;
  /** The most frequent surface form in this article — lowercase on a tie, then code point. */
  label: string;
  /** Literal occurrences, title and headings included once each. What a tooltip says. */
  count: number;
  /** Occurrences in prose only. What membership tests. */
  bodyCount: number;
  /** Title ×3, headings ×2, prose ×1. What ranking uses. */
  score: number;
}

export type SkipReason = "not-english" | "no-text";

export interface Extraction {
  /** Counted prose words, unweighted — the denominator of the density threshold. */
  words: number;
  /** sha256 of the counted text in canonical form — exact-duplicate grouping (Sol F9). */
  textHash: string;
  skipped: SkipReason | null;
  /** Empty when skipped. Ranked; deterministic for the same segments. */
  candidates: Candidate[];
}

export interface ExtractOptions {
  /** How many candidates to keep. The plan's "top ~200". */
  limit?: number;
}

const DEFAULT_LIMIT = 200;
const WEIGHT: Record<SegmentKind, number> = { title: 3, heading: 2, prose: 1 };

/* ── English check ──────────────────────────────────────────────────────── */

/**
 * The commonest English function words. Ordinary English prose runs at about
 * 30–45% of these; French, Spanish and German share almost none of them.
 * Deliberately a separate, short list from `STOP`, which is tuned for
 * splitting runs and holds content words too.
 */
const ENGLISH_MARKERS = new Set(
  `the of and to a in is that it for was on with as are be this by not but or have from at which an they you we he his their has were been will would can there its what if so about more when who i`.split(
    " ",
  ),
);
/** Below this share of marker words, the prose is not English. */
const MIN_ENGLISH_RATIO = 0.1;
/**
 * Fewer prose tokens than this and the ratio is noise, so the text is not
 * judged at all: a 20-word note is extracted as English whatever it is.
 */
const MIN_TOKENS_TO_JUDGE = 30;

/* ── Word lists ─────────────────────────────────────────────────────────── */

/** Tokens that end a run. Function words, then vague content words, then scholarly furniture. */
const STOP = new Set(
  `a about above across after afterwards again against all almost alone along already also although always am among amongst an and another any anyhow anyone anything anyway anywhere are aren't around as at back be became because become becomes becoming been before beforehand behind being below beside besides between beyond both but by can cannot can't could couldn't did didn't do does doesn't doing don't done down due during each eg e.g either else elsewhere enough etc even ever every everyone everything everywhere except few first for former formerly from further get gets getting give given gives go goes going gone got had hadn't has hasn't have haven't having he he'd he'll he's hence her here hereafter hereby herein hers herself him himself his how however i i'd i'll i'm i've ie i.e if in indeed instead into is isn't it it's its itself just keep last latter least less let let's like likely made make makes making many may maybe me meanwhile might mine more moreover most mostly much must my myself namely neither never nevertheless next no nobody none nor not nothing now nowhere of off often on once one ones only onto or other others otherwise our ours ourselves out over own per perhaps please put quite rather really said same say says see seem seemed seeming seems seen several she she'd she'll she's should shouldn't since so some somehow someone something sometime sometimes somewhere still such than that that's the their theirs them themselves then thence there there's thereafter thereby therefore therein these they they'd they'll they're they've this those though through throughout thus to together too toward towards under until up upon us use used uses using very via was wasn't we we'd we'll we're we've well were weren't what what's whatever when whence whenever where whereas whereby wherever whether which while whither who who's whoever whole whom whose why will with within without won't would wouldn't yet you you'd you'll you're you've your yours yourself yourselves
  able actually already anything around away bad big came come comes coming different does done else enough example examples far fact find found get good great half hard high however important instead kind kinds know known large less little long look looking lot lots low new old part particular point possible pretty real really right seems sense sort sorts sure take taken takes thing things think thought three two four five six seven eight nine ten time times true try trying turn turns type types want wanted wants way ways whole work works worked working year years yes day days today tell told went want word words people person man men case cases end place places number numbers set sets form forms order level levels use useful usually simply simple clearly certain certainly especially generally given matter means mean meant need needs needed often probably quite rather second several similar third various whether yes zero
  paper papers article articles study studies section sections chapter figure figures fig table tables et al ibid op cit pp vol eds ed doi http https www com org html pdf retrieved accessed available online press university journal abstract introduction conclusion conclusions discussion result results method methods approach approaches author authors reader readers text page pages note notes read reading write writing written wrote question questions answer answers problem problems idea ideas term terms show shows shown suggest suggests suggested argue argues argued claim claims called call calls describe described describes consider considered provide provides provided include includes including included based basis within across important related relevant specific specifically overall main major key rather simply mr mrs dr st vs etc cf`.split(
    /\s+/,
  ),
);

/**
 * Light plural folding, so *networks* and *network* are one key. Not a
 * stemmer: *analysis*, *physics* and *consciousness* stay whole, and a
 * possessive loses its *'s*.
 */
export function foldKey(token: string): string {
  const w = token
    .normalize("NFC")
    .replace(/[‐‑]/g, "-")
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/'s$/, "")
    .replace(/'$/, "");
  if (w.length <= 3) return w;
  if (/ies$/.test(w) && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ss|sh|ch|x)es$/.test(w)) return w.slice(0, -2);
  if (/(ss|is|us|as|os|ics)$/.test(w)) return w;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

/**
 * Common English words that are fine inside a phrase and useless as a topic on
 * their own. Deliberately **not** topical words (science, theory, model,
 * network, memory, language, history, mind). Folded, like keys.
 */
const GENERIC = new Set(
  `ability access account act action activity add age agree allow amount area argument aspect attempt attention average avoid base begin beginning belief believe best better big bit body book bottom break bring build building business buy care carry cause center centre century chance change character child choice choose clear close common community company complete concern condition context continue control cost country couple course create current deal decide decision deep degree depend design detail develop development die difference direct direction discover early easy effect effort element end enter entire environment event evidence exactly exist expect experience explain face fail family feel field final follow force free friend full future game general goal group grow growth hand happen head hear help hold home hope hour house human image imagine impact increase individual interest interesting issue job join large late later lead learn leave life light line list live local lose love main maintain manage mark market material meaning measure member minute miss moment month move name nation natural nature nearly normal notice object offer office open opportunity option outside pass past pay period physical picture plan play position power practice prepare present pressure produce product program project property provide public purpose quality quickly range rate reach ready reason receive recent recently record reduce region remain remember report represent require resource response rest return reveal rise risk role room rule run save scale school seek sell send series serve service short side sign significant single situation size small social society space speak special stage stand standard start state stay step stop story strong structure student subject success support system task team tend test top total track trade understand unit value view voice wait walk watch week wide win wonder world young thinking feeling living person`
    .split(/\s+/)
    .map(foldKey),
);

/** Irregular verbs and common adjectives that a tagger-free extractor would otherwise let through. */
const VERBISH = new Set(
  `saw seen went gone took taken gave given knew known felt told found became left kept began begun brought wrote written stood heard meant ran sat sit spoke spoken thought bought caught taught teach teaches fell grew held led lost paid sent spent won wore chose broke drove ate drew flew hid hit let rode rose shook sang slept stole swam threw understood woke explain ignore rich poor hard soft easy fast slow nice fine huge tiny whole middle front back inside toward starting finally quickly slowly nearly exactly simply mostly entirely partly perhaps else anyway maybe instead rather decent halfway`.split(
    /\s+/,
  ),
);

/**
 * Does this word look like a noun, by shape? Not an irregular verb, not an
 * *-ly* adverb, not an *-ed* participle (with *need*, *speed*, *bed* and the
 * like spared).
 */
function nounishShape(word: string): boolean {
  if (VERBISH.has(word)) return false;
  if (/ly$/.test(word) && word.length > 4) return false;
  if (/ed$/.test(word) && word.length > 4 && !/(eed|need|speed|seed|breed|bed|red)$/.test(word))
    return false;
  return true;
}

/**
 * The plan's "nounish" test (§ Step 1). A single word must pass the shape test
 * **and** not be on the generic list; a phrase's last word must pass the shape
 * test only. Applying the generic list to phrase heads too would drop
 * *conscious experience*, *AI systems* and *neural activity* — topics the
 * spike measured with — because *experience*, *system* and *activity* are
 * useless alone and fine as a head.
 */
function nounish(key: string): boolean {
  const words = key.split(" ");
  const head = words[words.length - 1] ?? "";
  if (words.length === 1 && GENERIC.has(head)) return false;
  return nounishShape(head);
}

/** Can this token sit inside a run? */
function tokenOk(token: string): boolean {
  const low = token.toLowerCase().replace(/’/g, "'");
  if (STOP.has(low) || STOP.has(foldKey(low))) return false;
  if (/\d/.test(token)) return false; // numbers, years, reference marks
  if (/^[A-Z]{2}$/.test(token)) return true; // AI, UK
  if (low.replace(/[-']/g, "").length < 3) return false;
  if (/^-|-$/.test(token)) return false;
  return true;
}

/** Where a run must end even between two good tokens. */
const PUNCT_SPLIT = /[.,;:!?()"“”«»[\]{}—–/|•…*=+<>#@&%$^~_\\]+|\s[-']\s|--/;
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/* ── Counting ───────────────────────────────────────────────────────────── */

interface Tally {
  count: number;
  bodyCount: number;
  score: number;
  forms: Map<string, number>;
}

function addRun(tallies: Map<string, Tally>, run: string[], kind: SegmentKind): void {
  for (let i = 0; i < run.length; i++)
    for (let n = 1; n <= 3 && i + n <= run.length; n++) {
      const tokens = run.slice(i, i + n);
      const key = tokens.map(foldKey).join(" ");
      const surface = tokens.join(" ");
      let t = tallies.get(key);
      if (!t) {
        t = { count: 0, bodyCount: 0, score: 0, forms: new Map() };
        tallies.set(key, t);
      }
      t.count += 1;
      if (kind === "prose") t.bodyCount += 1;
      t.score += WEIGHT[kind];
      t.forms.set(surface, (t.forms.get(surface) ?? 0) + 1);
    }
}

const isLower = (s: string) => s === s.toLowerCase();

/**
 * Most occurrences, then all-lowercase, then code point — a total order, so
 * the label does not depend on which form was met first (Sol F7). Shared with
 * ./choose.ts, which picks a shelf-wide label by the same rule.
 */
export function pickLabel(forms: Iterable<[string, number]>): string {
  let best: string | null = null;
  let bestN = -1;
  for (const [form, n] of forms) {
    if (best === null || n > bestN) {
      best = form;
      bestN = n;
      continue;
    }
    if (n < bestN) continue;
    const a = isLower(form);
    const b = isLower(best);
    if ((a && !b) || (a === b && form < best)) best = form;
  }
  return best ?? "";
}

/** Whitespace-collapsed, NFC — so a re-extraction that only moved spaces hashes the same. */
function canonical(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * The counted text's hash. Kind is part of it, so the same words promoted
 * from prose to a heading are a different text — they count differently.
 */
function hashSegments(segments: Segment[]): string {
  const h = createHash("sha256");
  for (const s of segments) h.update(`${s.kind}\t${canonical(s.text)}\n`);
  return h.digest("hex");
}

/** Ranking: score with a mild bonus per extra word — a phrase is rarer, and says more. */
const rank = (c: Candidate) => c.score * (1 + 0.5 * (c.key.split(" ").length - 1));

/**
 * Segments → candidates. The single entry point for step 1 (the plan § Step
 * 1). `words`, `textHash` and `skipped` are returned whatever happens, so a
 * skipped article is still counted and still grouped with its copies.
 */
export function extractCandidates(segments: Segment[], opts: ExtractOptions = {}): Extraction {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const textHash = hashSegments(segments);
  const { words, markers } = countProse(segments);
  if (words === 0) return { words, textHash, skipped: "no-text", candidates: [] };
  if (words >= MIN_TOKENS_TO_JUDGE && markers / words < MIN_ENGLISH_RATIO)
    return { words, textHash, skipped: "not-english", candidates: [] };

  const tallies = new Map<string, Tally>();
  for (const s of segments) tallySegment(tallies, s);
  return { words, textHash, skipped: null, candidates: ranked(tallies, limit) };
}

/** Prose tokens, and how many of them are English function words. */
function countProse(segments: Segment[]): { words: number; markers: number } {
  let words = 0;
  let markers = 0;
  for (const s of segments) {
    if (s.kind !== "prose") continue;
    for (const m of s.text.matchAll(TOKEN)) {
      words += 1;
      if (ENGLISH_MARKERS.has(m[0].toLowerCase())) markers += 1;
    }
  }
  return { words, markers };
}

/** Split one segment into runs at punctuation and stopwords, and count every n-gram in each run. */
function tallySegment(tallies: Map<string, Tally>, s: Segment): void {
  /* NFC keeps canonically equivalent accents under one key. U+2010 and U+2011
     are word-joining hyphens, so give them the same token form as ASCII `-`;
     en/em dashes remain punctuation boundaries. */
  const text = s.text.normalize("NFC").replace(/[‐‑]/g, "-");
  for (const chunk of text.split(PUNCT_SPLIT)) {
    if (!chunk) continue;
    let run: string[] = [];
    for (const m of chunk.matchAll(TOKEN)) {
      const token = m[0].replace(/['’]s$/i, "").replace(/[-'’]+$/, "");
      if (tokenOk(token)) {
        run.push(token);
        continue;
      }
      if (run.length) addRun(tallies, run, s.kind);
      run = [];
    }
    if (run.length) addRun(tallies, run, s.kind);
  }
}

/** Nounish keys only, ranked, then by key — a total order — and cut at `limit`. */
function ranked(tallies: Map<string, Tally>, limit: number): Candidate[] {
  const all: Candidate[] = [];
  for (const [key, t] of tallies) {
    if (!nounish(key)) continue;
    all.push({
      key,
      label: pickLabel(t.forms),
      count: t.count,
      bodyCount: t.bodyCount,
      score: t.score,
    });
  }
  all.sort((a, b) => rank(b) - rank(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return all.slice(0, limit);
}

/* ── Blocks → segments ──────────────────────────────────────────────────── */

/**
 * The block fields the adapter reads, in the shape both stores supply:
 * Postgres gives `null` where the `Block` type has an absent field.
 * `revision_blocks` in src/db/schema.ts has every one of them as a column.
 */
export interface SegmentBlock {
  text: string;
  kind: string;
  level?: number | null;
  role?: string | null;
  treatment?: Block["treatment"] | null;
  gistable: boolean;
}

/**
 * Headings that start back matter. Whole-heading matches only, optionally
 * numbered and punctuated, so *Notes on the Synthesis of Form* is still an
 * ordinary heading. The spike found these in 12 of 41 real articles, not
 * flagged as footnotes, filling the candidates with surnames and journal names
 * (the plan § What text is read).
 */
const BACK_MATTER =
  /^(?:(?:\d+(?:\.\d+)*|[ivxlcdm]+|[a-z])[.)]?\s+)?(?:references|reference list|bibliography|works cited|notes|endnotes|footnotes|notes and references|acknowledge?ments?|further reading|see also|external links|sources|citations)\s*[.:]?$/i;

/** Kinds that carry no prose of their own: code, figures, and `other` — which is where tables go (src/blocks.ts). */
const NOT_PROSE = new Set(["code", "media", "other"]);

/**
 * Title and blocks → the segments step 1 counts.
 *
 * Reads what `isEmbeddable` (src/block-policy.ts) says is gistable body text,
 * minus footnotes by role as well as by treatment, minus code, media and
 * tables, and minus everything under a back-matter heading until a heading
 * at the same or a higher level that is not itself back matter. A heading
 * with no level counts as level 1.
 */
export function segmentsFromBlocks(title: string | null, blocks: SegmentBlock[]): Segment[] {
  const out: Segment[] = [];
  if (title?.trim()) out.push({ text: title, kind: "title" });
  let skipAtOrBelow: number | null = null;
  for (const b of blocks) {
    if (b.kind === "heading") {
      const level = b.level ?? 1;
      if (BACK_MATTER.test(b.text.trim())) {
        skipAtOrBelow = skipAtOrBelow === null ? level : Math.min(skipAtOrBelow, level);
        continue;
      }
      if (skipAtOrBelow !== null && level <= skipAtOrBelow) skipAtOrBelow = null;
    }
    if (skipAtOrBelow !== null) continue;
    if (b.role === "footnote" || !isEmbeddable(b) || NOT_PROSE.has(b.kind)) continue;
    out.push({ text: b.text, kind: b.kind === "heading" ? "heading" : "prose" });
  }
  return out;
}
