/**
 * **Author–year citations, read by code** — `(Craik, 1943)`, `(Bryson and Ho,
 * 1969)`, `Hafner et al. (2018)` — so the Bibliography stage has a count of
 * what the body cites that does not come from the model it is checking (plan
 * 261027b, feedback spya-ez2vus).
 *
 * The model listed 23 of the roughly 99 works LeCun's *A Path Towards
 * Autonomous Machine Intelligence* cites, said `capped: false`, and nothing
 * could tell: the coverage witness counted notes and reference blocks, and a
 * PDF made into an article has neither. `(Levine, 2021)` sat beside two works
 * the model did list.
 *
 * **Conservative on purpose.** A hit becomes a row a reader sees, so a citation
 * missed here costs what it cost before, and a false one puts a work that does
 * not exist on the list. Two shapes only:
 *
 * - **parenthetical** — names, an optional comma, and years, straight after an
 *   opening bracket (a few lowercase words such as `see for example` or `e.g.
 *   as in` may come between) or after a `;` inside one, and followed by `)`,
 *   `;` or `,`. An opening bracket the article never closes still counts: the
 *   item has to end like a citation, which is the check that matters;
 * - **narrative** — names, then the years in brackets: `Levine (2021)`.
 *
 * A name starts with a capital and is a word, not `GPT-3`; a first name that
 * is a month or a word such as `Figure`, `Table`, `Section` or `In` is not a
 * surname. Pure: text in, hits out.
 */

/** One citation's characters, and what code read from them. */
export interface AuthorYearCite {
  /** Offsets into the text: the names and years of this one item, `Levine, 2021`. */
  start: number;
  end: number;
  /** As the text gives them, particles kept: `["van den Oord"]`, `["Bryson", "Ho"]`. */
  surnames: string[];
  /** The names as the text writes them, a possessive off: `Kaplan et al`, `Bryson and Ho`. */
  names: string;
  etAl: boolean;
  /** Four digits and the text's letter, if any: `2018b`. */
  year: string;
  /**
   * `parenthetical` — `(Levine, 2021)` — or `narrative` — `Levine (2021)`. A
   * lone narrative name is also how a title is written before its year
   * (`Voyelles (1871)`), so `bodyAuthorYearCites` (src/bibliography.ts) keeps
   * one only in an article that cites author–year in the other forms too.
   */
  form: "parenthetical" | "narrative";
  /** One surname, no `et al.`: the shape a title shares. */
  lone: boolean;
}

const PARTICLE = String.raw`(?:(?:van|von|der|den|de|du|da|di|del|della|la|le|ten|ter)\s+)`;
/** A capitalised or uncased word, with apostrophes and hyphens inside: `LeCun`, `李`, `O'Brien`. */
const WORD = String.raw`(?:\p{Lu}|\p{Lo})[\p{L}'’]*(?:-\p{L}[\p{L}'’]*)*`;
const SURNAME = String.raw`${PARTICLE}*${WORD}`;
const AND = String.raw`(?:,?\s+(?:and|&)\s+|\s*&\s*)`;
/* In-text styles name only a handful of authors before switching to `et al.`.
   The bound also stops a malformed comma-list making the regexp retry every
   suffix of an arbitrarily long run. */
const NAMES = String.raw`${SURNAME}(?:\s+et\s+al\.?|(?:,\s+${SURNAME}){0,8}${AND}${SURNAME})?`;
const YEAR = String.raw`(?:1[5-9]\d\d|20\d\d)[a-z]?`;
const YEARS = String.raw`${YEAR}(?:,\s*${YEAR})*`;

/** A citation signal between the bracket and names: `see for example`, `e.g.,`, `see also`, `but see`, `for recent reviews, see`. A fixed list, not any lowercase words, which let `(released for Linux, 2020)` through (GPT Sol's code review). */
const LEAD = String.raw`(?:(?:but\s+)?(?:see(?:\s+also|\s+for\s+example|\s+e\.?g\.?,?)?|cf\.?|e\.?g\.?,?(?:\s+as\s+in)?|i\.?e\.?,?|as\s+in|for\s+example,?|for\s+(?:a\s+|recent\s+|the\s+)?reviews?,?\s+see|for\s+others,?\s+see)\s+)?`;
const PARENTHETICAL = new RegExp(
  String.raw`(?<=(?:\(|;\s*)${LEAD})(${NAMES}),?\s+(${YEARS})(?=\s*[);,])`,
  "gu",
);
const NARRATIVE = new RegExp(String.raw`(${NAMES})\s+\((${YEARS})(?=\s*[);,])`, "gu");
/**
 * The next item of a list whose items a comma separates —
 * `(Carruthers & Gennaro 2020, Rosenthal 2005)`, arXiv 2308.08708's house
 * style (report spya-d5e2jk, plan 261029b). Tried only straight after the
 * years of a parenthetical cite already read, so a year that was not itself a
 * citation (`(founded in 2019, Kenya 2021)`) never starts a list. After a real
 * one, `(Smith 2020, Kenya 2021)` still reads Kenya as an author: the grammar
 * cannot tell, and it is accepted on the measurement — on 2308.08708 the
 * continuation added 39 works and every one was real (GPT Sol's plan review).
 */
const NEXT_IN_LIST = new RegExp(String.raw`,\s*(${NAMES}),?\s+(${YEARS})(?=\s*[);,])`, "uy");

/**
 * **A line that is itself a reference entry** — `Russo, Lucio (2004). The
 * Forgotten Revolution…` — in a list the extraction did not mark as references
 * (a Wikipedia *Further reading*, say). Read as a citation it names the first
 * name, `Lucio`, as the author. The entry goes on after the year — its title —
 * which a sentence ending `… Levine (2021).` does not.
 */
const ENTRY_LINE = new RegExp(String.raw`^(?:\p{Lu}|\p{Lo})[^()]{0,200}\(${YEAR}\)[.:]\s+\S`, "u");

/**
 * The lowercase word before a lone narrative name that makes it the end of a
 * title or a place — *the Dial of Destiny (2023)*, *in Paris (2019)* — rather
 * than an author. *The work of Levine (2021)* is lost with them: the safe side.
 */
const BEFORE_A_TITLE = /(?:^|\s)(?:of|in|at|on|to|from|the|a|an)\s+$/u;

/** First words that are not a surname, even capitalised before a year. */
const NOT_A_NAME = new Set(
  [
    "in", "on", "at", "by", "for", "from", "since", "until", "before", "after", "during", "the", "a",
    "an", "and", "or", "see", "cf", "eg", "ie", "figure", "fig", "figs", "table", "section", "sec",
    "chapter", "chap", "appendix", "eq", "equation", "page", "pp", "vol", "volume", "no", "note",
    "version", "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
    "sep", "sept", "oct", "nov", "dec", "spring", "summer", "autumn", "fall", "winter", "this",
    "that", "these", "those", "it", "we", "our", "windows", "war", "nature", "science",
    "cell", "lancet",
  ],
);

/** The surnames in a names run, particles kept, `et al.` and the joiners gone. */
function surnamesOf(names: string): { surnames: string[]; etAl: boolean } {
  const etAl = /\s+et\s+al\.?$/u.test(names);
  const bare = names.replace(/\s+et\s+al\.?$/u, "");
  const surnames = bare
    .split(/\s*,\s*(?:(?:and|&)\s+)?|\s+(?:and|&)\s+|\s*&\s*/u)
    .map((s) => s.trim().replace(/['’]s$/u, ""))
    .filter(Boolean);
  return { surnames, etAl };
}

/** Lower case, accents off: `Dürer` and `Durer` are one name. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The surname that names the work: the last word of the first author's, so
 * `van den Oord` and `Oord`, or `Yann LeCun` and `LeCun`, agree.
 */
export function surnameKey(surname: string): string {
  const words = fold(surname).trim().split(/\s+/u);
  return words[words.length - 1] ?? "";
}

/** `levine 2021`, `ha 2018b` — the first author's surname and the year. */
export function citeKey(cite: Pick<AuthorYearCite, "surnames" | "year">): string {
  return `${surnameKey(cite.surnames[0] ?? "")} ${cite.year}`;
}

/** Every author–year citation in `text`, in order; one per year when an item names several. */
export function authorYearCites(text: string): AuthorYearCite[] {
  const found = new Map<number, AuthorYearCite[]>();
  /* Starts matched by PARENTHETICAL or NARRATIVE themselves. Continuations
     are separate returned hits, but not separate evidence that an ENTRY_LINE
     is prose: one comma-list in an unmarked reference entry is still one
     independently found citation shape. */
  const directStarts = new Set<number>();
  /** The item `names` + `years` at `start`, if its names are a citation's; `length` runs to the end of its years. */
  const read = (names: string, years: string, start: number, length: number, form: AuthorYearCite["form"]) => {
    const { surnames, etAl } = surnamesOf(names);
    const first = surnames[0];
    if (first === undefined || NOT_A_NAME.has(fold(first.split(/\s+/u)[0]!))) return undefined;
    /* A surname in a cased script has a lowercase letter: not `IV` of a
       manual's edition, not `OECD`. Scripts without case (`李`) still count. */
    if (!surnames.every((s) => /\p{Ll}/u.test(s) || !/[\p{Lu}\p{Lt}]/u.test(s))) return undefined;
    const lone = surnames.length === 1 && !etAl;
    if (form === "narrative" && lone && BEFORE_A_TITLE.test(text.slice(0, start))) return undefined;
    /* A narrative cite's own bracket closes it: `Levine (2021)`, not `Levine (2021`. */
    const end = start + length + (form === "narrative" && text[start + length] === ")" ? 1 : 0);
    return years.split(/,\s*/u).map((year) => ({ start, end, surnames, names: names.replace(/['’]s$/u, ""), etAl, year, form, lone }));
  };
  for (const pattern of [PARENTHETICAL, NARRATIVE]) {
    for (const m of text.matchAll(pattern)) {
      const start = m.index!;
      if (found.has(start)) continue;
      const form = pattern === PARENTHETICAL ? ("parenthetical" as const) : ("narrative" as const);
      const cites = read(m[1]!, m[2]!, start, m[0].length, form);
      if (cites === undefined) continue;
      found.set(start, cites);
      directStarts.add(start);
      /* The rest of a comma-separated list, each item read from where the last one's years end. */
      for (let at = cites[0]!.end; form === "parenthetical"; ) {
        NEXT_IN_LIST.lastIndex = at;
        const next = NEXT_IN_LIST.exec(text);
        if (next === null) break;
        const nextStart = at + next[0].indexOf(next[1]!);
        const more = read(next[1]!, next[2]!, nextStart, at + next[0].length - nextStart, "parenthetical");
        if (more === undefined || found.has(nextStart)) break;
        found.set(nextStart, more);
        at = more[0]!.end;
      }
    }
  }
  /* A stray reference-entry block normally contains one author-year shape.
     Do not let that heuristic discard a prose block merely because its first
     sentence starts `Smith (2020).`: two independently matched shapes are
     prose evidence. */
  if (ENTRY_LINE.test(text) && directStarts.size <= 1) return [];
  return [...found.entries()].sort(([a], [b]) => a - b).flatMap(([, cites]) => cites);
}
