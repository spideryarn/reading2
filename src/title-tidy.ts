/**
 * **Very light tidying of an imported title**, and nothing a reader would call
 * an edit.
 *
 * Greg, 2026-10-04 (report `spya-fyj3m4`, over a PDF titled `THE ORDER OF
 * TIME`): "apply very light editing to the article title (e.g. this one is in
 * all caps) to make them more consistent and readable. Ideally follow the
 * author's intent and don't change the contents substantively".
 *
 * Two changes, and no others:
 *
 *  1. a title **wholly** in capitals becomes title case;
 *  2. trailing footnote markers (`*`, `†`, `‡`) come off.
 *
 * A title already in mixed case is never recased. Pure, no model, no network:
 * the rules and what they pass over are in
 * docs/plans/261005g-tidy-an-imported-title-and-keep-the-original.md, and the
 * style guides behind them in
 * docs/research/261005c-title-capitalisation-and-light-tidying-at-import.md.
 *
 * The caller keeps the original beside the result (`tidiedTitle`,
 * `Meta.titleOriginal`), so every change here can be undone.
 */

export interface TidyContext {
  /**
   * The article's own text, which is the only evidence here of which words are
   * acronyms: a title word the body writes in capitals stays in capitals.
   * Absent, no word is taken for one.
   */
  body?: string | null | undefined;
  /**
   * The language the page declares (`Meta.lang`). Recasing is English title
   * case, which is wrong for German, French and Spanish, so a declared
   * language that is not English turns it off. Absent is treated as English.
   */
  lang?: string | null | undefined;
}

/** `title` tidied, and the original when tidying changed it — the shape `Meta` spreads. */
export function tidiedTitle(title: string, context: TidyContext = {}): { title: string; titleOriginal?: string } {
  const tidy = tidyTitle(title, context);
  return tidy === title ? { title } : { title: tidy, titleOriginal: title };
}

export function tidyTitle(title: string, context: TidyContext = {}): string {
  const unmarked = title.replace(TRAILING_MARKERS, "");
  if (!mayRecase(unmarked, context.lang) || !isWhollyCapitals(unmarked)) return unmarked;
  return titleCase(unmarked, acronymsIn(context.body, unmarked));
}

/**
 * English title case is only right for English. A declared language settles
 * it. With none declared — every PDF — a title with a letter outside ASCII is
 * left as it came, since that is the cheapest sign of another language and
 * lower-casing has traps there (`İ`). An unaccented title in another language
 * (`EL ORDEN DEL TIEMPO`) gets English capitals; that is the known gap, and
 * the original is kept beside it.
 */
function mayRecase(title: string, lang: string | null | undefined): boolean {
  if (lang?.trim()) return /^en\b/i.test(lang.trim());
  return ![...title].some((ch) => hasCase(ch) && ch > "\u007f");
}

/**
 * Footnote markers at the very end, after a word of three letters or more —
 * which is what keeps `A*` (the search algorithm) and `C*` as they are.
 */
const TRAILING_MARKERS = /(?<=\p{L}{3})\s*[*†‡]+$/u;

const hasCase = (ch: string) => ch.toLowerCase() !== ch.toUpperCase();
const isUpper = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();

/** Gruber's list, which is the New York Times manual's. */
const SMALL = new Set(
  "a an and as at but by en for if in of on or the to v via vs".split(" "),
);

/** A numeral of two or more of I, V and X: no English word is spelt that way. */
const ROMAN = /^(?=[IVX]{2,}$)X{0,3}(IX|IV|V?I{0,3})$/;
/** `J.R.R` — the token's last full stop is trimmed off as punctuation before this is asked. */
const INITIALS = /^\p{L}(\.\p{L})+$/u;
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;

/**
 * **Wholly**, and long enough to be a title rather than a name: two words,
 * eight cased letters, every one of them a capital, and at least one word that
 * is neither small nor short — `BBC NEWS` and `DNA AND RNA` are mostly
 * acronyms, and with nothing to say which, they are left as they came.
 */
function isWhollyCapitals(title: string): boolean {
  const letters = [...title].filter(hasCase);
  if (letters.length < 8 || !letters.every(isUpper)) return false;
  const words = title.match(WORD) ?? [];
  if (words.length < 2) return false;
  return words.some((w) => w.length > 4 && !SMALL.has(w.toLowerCase()));
}

/**
 * The title's words that the body writes in capitals: at least twice, and
 * **never any other way** — which is how a text treats `NASA` and is not how
 * it treats a word out of a running head, which turns up in the prose too.
 *
 * Two things are not evidence. The title's own appearances are taken out
 * first: a page's `<h1>` and a book's running head repeat it in the very
 * capitals being judged, and counted they would vote for themselves. And a
 * body printed mostly in capitals says nothing about any one word.
 */
function acronymsIn(body: string | null | undefined, title: string): ReadonlySet<string> {
  const found = new Set<string>();
  if (!body) return found;
  /* A small word is never an acronym here: a running head has `OF` in it too. */
  const wanted = new Set((title.match(WORD) ?? []).filter((w) => w.length > 1 && !SMALL.has(w.toLowerCase())));
  if (!wanted.size) return found;
  const prose = body.split(title).join(" ");
  const cased = [...prose].filter(hasCase);
  if (cased.filter(isUpper).length * 2 > cased.length) return found;
  const counts = new Map<string, { upper: number; other: number }>();
  for (const word of prose.match(WORD) ?? []) {
    const key = word.toUpperCase();
    if (!wanted.has(key)) continue;
    const count = counts.get(key) ?? { upper: 0, other: 0 };
    if (word === key) count.upper += 1;
    else count.other += 1;
    counts.set(key, count);
  }
  for (const [word, { upper, other }] of counts) if (upper >= 2 && other === 0) found.add(word);
  return found;
}

function titleCase(title: string, acronyms: ReadonlySet<string>): string {
  const tokens = title.split(/(\s+)/);
  const wordAt = tokens.map((t, i) => (/[\p{L}\p{N}]/u.test(t) ? i : -1)).filter((i) => i >= 0);
  const first = wordAt[0];
  const last = wordAt[wordAt.length - 1];
  /* The first word of a subtitle is a first word. */
  let opens = true;
  return tokens
    .map((token, i) => {
      if (!wordAt.includes(i)) {
        if (/[-–—]/.test(token)) opens = true;
        return token;
      }
      const edge = opens || i === first || i === last;
      opens = /[:?!–—]["'”’)\]]*$/.test(token);
      return recase(token, edge, acronyms);
    })
    .join("");
}

/** One whitespace-delimited token: its punctuation kept, its hyphenated parts each recased. */
function recase(token: string, edge: boolean, acronyms: ReadonlySet<string>): string {
  const shape = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(token);
  const [lead, core, trail] = [shape?.[1] ?? "", shape?.[2] ?? token, shape?.[3] ?? ""];
  /* `J.R.R.`, and the spaced `J. A. Smith`, whose `A.` is not the article. */
  if (INITIALS.test(core) || ([...core].length === 1 && trail.startsWith("."))) return token;
  const parts = core.split(/([-/])/);
  const recased = parts.map((part, i) => {
    if (i % 2) return part;
    /* A small word is a capital at the title's edge and at a compound's end. */
    const capitalSmall = (edge && i === 0) || (parts.length > 1 && i === parts.length - 1);
    return recaseWord(part, capitalSmall, acronyms);
  });
  return lead + recased.join("") + trail;
}

function recaseWord(word: string, capitalSmall: boolean, acronyms: ReadonlySet<string>): string {
  if (!word || /\p{N}/u.test(word) || ROMAN.test(word)) return word;
  /* `ROVELLI'S`, `DON'T`, `O'BRIEN`: the part before the apostrophe is the word. */
  const [, head = word, mark = "", tail = ""] = /^([^'’]*)(['’]?)(.*)$/su.exec(word) ?? [];
  const lower = head.toLowerCase();
  const recasedHead = acronyms.has(head)
    ? head
    : SMALL.has(lower) && !capitalSmall
      ? lower
      : capital(lower);
  /* A name's second half is a capital (`O'Brien`, `D'Artagnan`); a contraction's
     or a possessive's is not (`Don't`, `I'll`, `Rovelli's`). */
  const recasedTail = head.length === 1 && tail.length > 2 ? capital(tail.toLowerCase()) : tail.toLowerCase();
  return recasedHead + mark + recasedTail;
}

const capital = (lower: string) => {
  const [first = "", ...rest] = [...lower];
  return first.toUpperCase() + rest.join("");
};
