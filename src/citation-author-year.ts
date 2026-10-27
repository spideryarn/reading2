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
/** A capitalised word, letters, apostrophes and hyphens inside: `LeCun`, `O'Brien`, `Grill-Spielberg`. */
const WORD = String.raw`\p{Lu}[\p{L}'’]*(?:-\p{L}[\p{L}'’]*)*`;
const SURNAME = String.raw`${PARTICLE}*${WORD}`;
const AND = String.raw`(?:,?\s+(?:and|&)\s+|\s*&\s*)`;
const NAMES = String.raw`${SURNAME}(?:\s+et\s+al\.?|(?:,\s+${SURNAME})*${AND}${SURNAME})?`;
const YEAR = String.raw`(?:1[5-9]\d\d|20\d\d)[a-z]?`;
const YEARS = String.raw`${YEAR}(?:,\s*${YEAR})*`;

/** Up to four lowercase words between the bracket and the names: `see for example`, `e.g. as in`. */
const LEAD = String.raw`(?:[\p{Ll}][\p{Ll}.,]*\s+){0,4}`;
const PARENTHETICAL = new RegExp(
  String.raw`(?<=(?:\(|;\s*)${LEAD})(${NAMES}),?\s+(${YEARS})(?=\s*[);,])`,
  "gu",
);
const NARRATIVE = new RegExp(String.raw`(${NAMES})\s+\((${YEARS})(?=\s*[);,])`, "gu");

/**
 * **A line that is itself a reference entry** — `Russo, Lucio (2004). The
 * Forgotten Revolution…` — in a list the extraction did not mark as references
 * (a Wikipedia *Further reading*, say). Read as a citation it names the first
 * name, `Lucio`, as the author. The entry goes on after the year — its title —
 * which a sentence ending `… Levine (2021).` does not.
 */
const ENTRY_LINE = new RegExp(String.raw`^\p{Lu}[^()]{0,200}\(${YEAR}\)[.:]\s+\S`, "u");

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
    "that", "these", "those", "it", "we", "our",
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
  if (ENTRY_LINE.test(text)) return [];
  const found = new Map<number, AuthorYearCite[]>();
  for (const pattern of [PARENTHETICAL, NARRATIVE]) {
    for (const m of text.matchAll(pattern)) {
      const names = m[1]!;
      const start = m.index!;
      if (found.has(start)) continue;
      const { surnames, etAl } = surnamesOf(names);
      const first = surnames[0];
      if (first === undefined || NOT_A_NAME.has(fold(first.split(/\s+/u)[0]!))) continue;
      /* A surname has a lowercase letter: not `IV` of a manual's edition, not `OECD`. */
      if (!surnames.every((s) => /\p{Ll}/u.test(s))) continue;
      const lone = surnames.length === 1 && !etAl;
      if (pattern === NARRATIVE && lone && BEFORE_A_TITLE.test(text.slice(0, start))) continue;
      /* A narrative cite's own bracket closes it: `Levine (2021)`, not `Levine (2021`. */
      const end = start + m[0].length + (pattern === NARRATIVE && text[start + m[0].length] === ")" ? 1 : 0);
      found.set(
        start,
        m[2]!.split(/,\s*/u).map((year) => ({
          start,
          end,
          surnames,
          names: names.replace(/['’]s$/u, ""),
          etAl,
          year,
          form: pattern === PARENTHETICAL ? ("parenthetical" as const) : ("narrative" as const),
          lone,
        })),
      );
    }
  }
  return [...found.entries()].sort(([a], [b]) => a - b).flatMap(([, cites]) => cites);
}
