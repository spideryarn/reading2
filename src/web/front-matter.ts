/**
 * **The byline blocks under the title: authors, affiliations, contact lines.**
 *
 * Greg, spya-duh4w3, 2026-10-06: *"A lot of articles start with a list of
 * authors and maybe acknowledgements and a bunch of other stuff that's not
 * super interesting. I wonder if there's a way that we can identify them as
 * such and default collapse them so that you kind of jump straight into the
 * article itself when you first open it."*
 * docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md
 * § The rule, v1 has the reasoning, the plan review this answers, and what the
 * rule gives up.
 *
 * This file only says which blocks. The fold store hides them until the reader
 * asks (fold.ts § The front matter); nothing is removed from the article, and
 * models, exports and the other bands still see every block.
 *
 * **It fails towards showing.** No stored field says which blocks were the
 * byline, so this reads the words, and every block has to earn its place: it
 * needs evidence of its own that it is byline material, and it must not read
 * as a sentence. The first block that fails either ends the run. A byline left
 * on screen costs the reader a glance; a paragraph of the article hidden costs
 * them the paragraph.
 */
import type { Article, Author, Block, BlockId } from "../types.js";

/** As much of an article as the rule reads. A visitor's has no `authors`. */
export type FrontMatterArticle = Pick<Article, "blocks"> & {
  meta: { authors?: Author[] | undefined; byline?: string | undefined };
};

const NONE: readonly BlockId[] = [];

/** More blocks than this, or more words, and nothing is folded at all. */
const MAX_BLOCKS = 15;
const MAX_WORDS = 600;
/** One block longer than this is not a byline, whatever is in it. */
const MAX_BLOCK_WORDS = 300;
/** The largest share of a block's words that may start in lower case. */
const MAX_LOWER = 0.3;
/** Sentence words allowed: this many, or this share of the block if that is more. */
const MAX_SENTENCE_WORDS = 2;
const MAX_SENTENCE_SHARE = 0.04;
/**
 * A block that opens with a lead phrase may be all lower case if it is shorter
 * than this. Twenty and not the plan's first forty: on production a 33-word
 * block ran a corresponding author's address into a competing-interests
 * statement and the keywords, and those are not contact details.
 */
const LEAD_EXCUSE_WORDS = 20;

const LETTER = /\p{L}/u;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Words an affiliation is built from. Matched whole and with their capital:
 * "the school" in a sentence is not one. A heading is never let in by these
 * ("Why Medical School Costs So Much"), see `isRunHeading`.
 */
const INSTITUTION =
  /(?<!\p{L})(?:University|Université|Universität|Universidad|Università|Universiteit|Departments?|Institute|Institut|College|School|Faculty|Laboratory|Laboratories|Centre|Center|Hospital|Academy)(?!\p{L})/u;

/** How a contact or contribution line starts. Any capitals: "E-mail:", "EQUAL CONTRIBUTION". */
const LEAD = /correspondence|corresponding authors?|e-?mail:|equal contributions?|contributed equally|orcid/i;

/** Labels for authored material that can sit near a byline but is not author detail. */
const CONTENT_LABEL =
  /^(?:acknowledg(?:e)?ments?|keywords?|funding|competing interests?|conflicts? of interest|data availability)\s*:/i;

/** Organisation and job words that make a comma-split byline piece unsafe to treat as a person. */
const NON_PERSON_BYLINE =
  /(?:^The\b|\b(?:University|Université|Universität|Universidad|Università|Universiteit|Departments?|Institute|Institut|College|School|Faculty|Laborator(?:y|ies)|Centre|Center|Hospital|Academy|Times|Press|Journal|News|Correspondents?|Editors?|Reporters?|Writers?|Staff|Team|Group)\b)/u;

/** Small words an affiliation uses in lower case ("University of Toronto"). Not counted either way. */
const JOINING = new Set(["of", "and", "for", "the", "in", "at"]);

/**
 * Words that make a sentence. **Lower case only, and compared as written**:
 * Will and Can are given names, and `I` is not here because it is an initial
 * ("Victor I. Petrov").
 */
const SENTENCE_WORDS = new Set([
  "is", "are", "was", "were", "been", "we", "our", "you", "it", "its", "they", "their",
  "that", "this", "these", "those", "which", "there", "have", "has", "had", "not", "can",
  "will", "but", "if", "because", "however",
]);

/** The headings a byline is filed under. Compared without capitals or a closing colon. */
const LABELS = new Set(["authors", "affiliations", "article info", "correspondence"]);

const words = (text: string): string[] => text.trim().split(/\s+/).filter((w) => w !== "");
/** A word without the punctuation and footnote marks around it. */
const bare = (word: string): string => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const collapse = (text: string): string => text.trim().replace(/\s+/g, " ");

/**
 * The names the article says wrote it: `meta.authors`, and `meta.byline` split
 * into its people.
 *
 * A byline derived from `authors` is joined with `;` (types.ts § `byline`).
 * One a PDF's front page gave is the page's own line, "Taylor Webb1,*, Keith J.
 * Holyoak1 , and Hongjing Lu1,2", so it is also split on commas, "and" and
 * "&", and each piece loses the footnote marks at its ends. Measured on
 * production, 2026-10-07: eight papers whose first block under the title is
 * exactly that line had no other evidence on it (plan § Measured before it
 * lands).
 *
 * **Two to five words, and never a lone surname**: Long, Young, Field and Li
 * are words, and "Hasson, Uri" yields nothing. Comma-split organisation and
 * job fragments are dropped too: treating "The New York Times" or "Senior
 * Correspondent" as a person makes an ordinary title-cased deck evidence for
 * hiding. A byline that is not a list of names ("Jane Roe Affiliation: …",
 * stored on old arXiv imports) is one long piece and yields nothing either.
 */
function authorNames(meta: FrontMatterArticle["meta"]): string[] {
  const fromByline = (meta.byline ?? "")
    .split(/[;,&]|\sand\s/)
    .map((piece) => collapse(piece.replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, "")))
    .filter((piece) => !NON_PERSON_BYLINE.test(piece));
  const given = [...(meta.authors ?? []).map((a) => a.name), ...fromByline];
  return given.map(collapse).filter((name) => {
    const n = words(name).length;
    return n >= 2 && n <= 5;
  });
}

/**
 * Where `name` is in `text` as a whole phrase with its capitals, or -1. A
 * footnote mark may be glued to either end: a digit or a symbol
 * ("Layfield1,2*"), or after the name one lower-case letter that is itself
 * followed by a real digit or footnote symbol ("Singha,1", a superscript
 * `a`). A longer surname ending `a,` without that mark may not.
 */
function findName(text: string, name: string): number {
  return findNames(text, name)[0] ?? -1;
}

/** Every place `name` is in `text` by `findName`'s rule, in order. */
function findNames(text: string, name: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    const before = text[at - 1] ?? " ";
    const end = at + name.length;
    const after = text[end] ?? " ";
    const letterMark = /^\p{Ll}(?:[,;]?)[\d*∗†‡§¶‖]/u.test(text.slice(end));
    if (!LETTER.test(before) && (!LETTER.test(after) || letterMark)) found.push(at);
  }
  return found;
}

/**
 * Known names are evidence when removing all of them leaves only byline
 * separators and marks. A real footnote mark on one known name is enough on
 * its own, preserving partial metadata lists whose other authors are unknown.
 * Unmatched words stay visible, including title-cased decks that name one or
 * more of the authors.
 */
function hasNameEvidence(text: string, names: readonly string[]): boolean {
  const matches = [...new Set(names)].flatMap((name) =>
    findNames(text, name).map((at) => ({ at, name })),
  );
  if (matches.length === 0) return false;
  if (
    matches.some(({ at, name }) => {
      const after = text.slice(at + name.length);
      return (
        /^\p{Ll}(?:[,;]?)[\d*∗†‡§¶‖]/u.test(after) ||
        /^(?:[,;]?\d|[*∗†‡§¶‖])/u.test(after)
      );
    })
  ) {
    return true;
  }

  /* Each character is taken out once. Two known names can start at the same
     place ("Jane Roe" and "Jane Roe Smith"); cut one after the other, the
     second cut ran on into words that are nobody's name. */
  const named = new Set<number>();
  for (const { at, name } of matches) {
    for (let i = at; i < at + name.length; i++) named.add(i);
  }
  const rest = Array.from({ length: text.length }, (_, i) => (named.has(i) ? "" : text[i])).join("");
  return !LETTER.test(rest.replace(/\band\b/giu, ""));
}

/** Test 1: something in the block says it is byline material. */
function hasEvidence(text: string, names: readonly string[]): boolean {
  return (
    EMAIL.test(text) ||
    INSTITUTION.test(text) ||
    opensWithLead(text) ||
    hasNameEvidence(text, names)
  );
}

/** Whether a lead phrase starts the block, allowing only observed label prefixes. */
function opensWithLead(text: string): boolean {
  const lead = LEAD.exec(text);
  if (lead === null) return false;
  const before = words(text.slice(0, lead.index))
    .map(bare)
    .filter((w) => LETTER.test(w))
    .join(" ")
    .toLowerCase();
  if (before === "") return true;
  if (
    /^(?:for|address for)$/u.test(before) &&
    /^(?:correspondence|corresponding authors?|e-?mail:)/i.test(lead[0])
  ) {
    return true;
  }
  return (
    /^(?:(?:these|all|both|the) )?authors?$/u.test(before) &&
    /^contributed equally$/i.test(lead[0])
  );
}

/** A short lead line whose lowercase words are part of a known label, not enough to make it prose. */
function leadExcusesLowercase(text: string): boolean {
  if (!opensWithLead(text)) return false;
  const lead = LEAD.exec(text);
  if (lead === null) return false;
  if (/equal contributions?|contributed equally/i.test(lead[0])) return true;
  if (/^\s*:/u.test(text.slice(lead.index + lead[0].length))) return true;
  if (EMAIL.test(text)) return true;
  const label = text.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").trim();
  return /^corresponding authors?$/i.test(label);
}

/**
 * Test 2: whether the block reads as prose. Two measures, plus conservative
 * guards for shapes those measures cannot recognise.
 *
 * - **Mostly lower case.** An affiliation is mostly capitalised and a sentence
 *   is not: this is what stops a standfirst such as "Researchers at Stanford
 *   University developed a cheaper method…". Emails, links, numbers and the
 *   joining words are left out of the count. A short block that opens with a
 *   lead phrase is excused, because "These authors contributed equally to this
 *   work" is all lower case.
 * - **Sentence words.** More than a couple of them and it is a sentence, even
 *   one written in capitals.
 * - **The measures' blind spots stay visible.** A labelled acknowledgement,
 *   keyword or funding statement is not author detail. A word in a script
 *   without upper/lower case cannot count as evidence of an affiliation, and
 *   a short institution-heavy line with a lowercase word and sentence-ending
 *   punctuation is treated as prose. Known short contribution/contact labels
 *   retain their narrow exception.
 */
function readsAsProse(text: string): boolean {
  if (CONTENT_LABEL.test(text)) return true;
  const all = words(text);
  let counted = 0;
  let lower = 0;
  let uncased = 0;
  let sentence = 0;
  for (const word of all) {
    const w = bare(word);
    if (SENTENCE_WORDS.has(w)) sentence++;
    if (word.includes("@") || /^(?:https?:|www\.)/i.test(w)) continue;
    const first = w[0];
    if (first === undefined || !LETTER.test(first) || JOINING.has(w.toLowerCase())) continue;
    counted++;
    if (first === first.toLowerCase() && first === first.toUpperCase()) uncased++;
    else if (first === first.toLowerCase()) lower++;
  }
  if (sentence > Math.max(MAX_SENTENCE_WORDS, MAX_SENTENCE_SHARE * all.length)) return true;
  if (uncased > 0) return true;
  const leadException = all.length < LEAD_EXCUSE_WORDS && leadExcusesLowercase(text);
  if (lower > 0 && /[.!?]["')\]]*$/u.test(text.trim()) && !leadException) return true;
  if (leadException) return false;
  return counted > 0 && lower / counted > MAX_LOWER;
}

/**
 * **A heading is in the run only if it is an author's name or a known label.**
 * Never on the strength of an institution word: "Why Medical School Costs So
 * Much" has one and is capitalised throughout. A name may carry its footnote
 * marks ("Jane Roe1,*") and nothing else.
 */
function isRunHeading(text: string, names: readonly string[]): boolean {
  const flat = collapse(text);
  if (LABELS.has(flat.toLowerCase().replace(/[:.]$/, ""))) return true;
  return names.some((name) => {
    const at = findName(flat, name);
    return at >= 0 && !LETTER.test(flat.slice(0, at) + flat.slice(at + name.length));
  });
}

/**
 * **A heading or a paragraph of text, and nothing else.** A table, a quote, a
 * figure or a caption is the article's own even when it names a college: on
 * the local database three Wikipedia imports folded their infobox, which is a
 * table directly under the title. No byline in production is anything but a
 * paragraph (2026-10-07).
 */
function isByline(block: Block, names: readonly string[]): boolean {
  if (block.kind === "heading") return isRunHeading(block.text, names);
  if (block.kind !== "text") return false;
  const text = collapse(block.text);
  return (
    words(text).length <= MAX_BLOCK_WORDS && hasEvidence(text, names) && !readsAsProse(text)
  );
}

/**
 * **The ids of one unbroken run of byline blocks at the top of the article, in
 * order.** Empty when there is none.
 *
 * **Where it starts.** An `h1` at block 0 is the title and is never in the
 * run, whatever it says; the run then starts under it, after the masthead's
 * echo, `echo`, when that hides the old wrapper's reading-time line at block 1
 * (masthead-echo.ts). With no `h1` there, the run starts at block 0: a web
 * article imported since 649dc7828 (2026-10-07) has its title only in the
 * masthead, and block 0 is the first thing the page has, which on an arXiv
 * HTML page is the author list. Either way it takes each block for as long as
 * `isByline` holds, so an old PDF that opens with a journal's furniture, or an
 * essay that opens with its first sentence, gets nothing folded.
 *
 * Block 0 hidden is not new to the consumers: the echo already hides it, and
 * a run row, like an echo row, is not `isFoldedAway` (fold.ts), so the first
 * section is still named, focused and stepped to by its first visible row.
 *
 * Then three refusals:
 *
 * - a run does not end on a heading: a label with its lines still showing
 *   under it would be folded away from them;
 * - more than `MAX_BLOCKS` blocks or `MAX_WORDS` words is not a byline, and
 *   nothing is folded rather than the first fifteen;
 * - and what is left may be nothing.
 */
export function frontMatter(
  article: FrontMatterArticle,
  echo: ReadonlySet<BlockId>,
): readonly BlockId[] {
  const { blocks } = article;
  const names = authorNames(article.meta);
  let from = blocks[0]?.tag === "h1" ? 1 : 0;
  while (blocks[from] !== undefined && echo.has(blocks[from]!.id)) from++;
  const run: Block[] = [];
  for (let i = from; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (!isByline(block, names)) break;
    run.push(block);
  }
  while (run.length > 0 && run[run.length - 1]!.kind === "heading") run.pop();
  if (run.length === 0 || run.length > MAX_BLOCKS) return NONE;
  const total = run.reduce((n, b) => n + words(b.text).length, 0);
  if (total > MAX_WORDS) return NONE;
  return run.map((b) => b.id);
}
