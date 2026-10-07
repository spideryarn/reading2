/**
 * **Is the page a web search found the paper the reader uploaded?** The pure
 * half of an upload's guessed web address —
 * docs/plans/260929g-canonical-link-for-an-uploaded-paper.md § What counts as
 * "an exact match" — code.
 *
 * The model only points into the search results (src/citation-find.ts §
 * `findWorkPage`); the page it points at is read by `readPaperText`
 * (src/paper-text.ts), and then **this file decides**. A wrong link is worse
 * than none, because the reader will cite it, so every doubt here resolves to
 * "not the same paper". There is no I/O in this file: the route hands it the
 * upload's text and the candidate's, and stores what it says.
 *
 * A candidate is this paper only if all three hold:
 *
 * 1. **Title, exactly** — the same significant words in the same order.
 * 2. **First author**, when the upload names one.
 * 3. **One independent agreement** — the candidate's *own* DOI or arXiv id is
 *    among the upload's, or its text says what the upload's opening says.
 *    When the upload names no author, the text must agree whatever the
 *    identifier says.
 *
 * And a candidate whose own identifier contradicts the upload's is a no
 * whatever else agrees (`conflicts`, below).
 */
import { identifiersIn, wordsOf } from "./citations.js";
import { doiUrl } from "./doi-url.js";
import type { PaperMeta, PaperText } from "./paper-text.js";
import type { Author, SearchEvidence } from "./types.js";

/** Fewer significant title words than this and an exact title match is not evidence — "Deep Learning" is a hundred papers. */
export const MIN_TITLE_WORDS = 3;
/** A PDF with no title of its own begins with its title; this is how far in we look for it. */
const TITLE_RUN_WINDOW = 80;
/** How far into the candidate's text the first author's surname may be — the byline, with room for a cover page. */
const AUTHOR_WINDOW = 2000;
const SHINGLE = 4;
/** Fewer distinct shingles than this and "half of them agree" is a handful of phrases, not a passage. */
export const MIN_SHINGLES = 20;
const SHINGLE_SHARE = 0.5;

export interface PaperIdentityInput {
  /** The revision's title. */
  title: string;
  /** The uploaded file's name, when there was one — a title equal to its stem is the fallback, not a title. */
  filename: string | null;
  authors: readonly Author[];
  /** The raw text of the stored source's first pages: pass 0 of pages 1–2 for a PDF, the page's text for HTML. */
  firstPagesText: string;
  /** An HTML upload's own scholarly meta tags. */
  uploadMeta?: Pick<PaperMeta, "doi" | "authors">;
  /** The article's opening body prose, ~150 words after the front matter. */
  opening: string;
}

export interface PaperIdentity {
  titleWords: string[];
  /** Folded, lower-cased; null when the upload names no author, "" when it names one we cannot read. */
  surname: string | null;
  /** Lower-cased, bare. May include cited works' — see `conflicts`. */
  dois: string[];
  /** Without a version. */
  arxivs: string[];
  /** The opening prose's distinct 4-word shingles. */
  shingles: string[];
}

type ReadPaper = Extract<PaperText, { kind: "read" }>;

/** What the judge needs of a candidate: the page as read, and the search result the model pointed at. */
export interface SourceCandidate {
  read: Pick<ReadPaper, "url" | "format" | "text" | "title" | "meta">;
  result: Pick<SearchEvidence, "url" | "title">;
}

export type NotSameWhy = "title-mismatch" | "author-mismatch" | "identifier-conflict" | "no-agreement";

export type SamePaperVerdict =
  | { same: true; matchedBy: "doi" | "arxiv"; canonicalUrl: string }
  | { same: true; matchedBy: "content"; canonicalUrl: null }
  | { same: false; why: NotSameWhy };

/**
 * The upload's identity, or null when it has no title worth matching — one
 * that fell back to the filename, or one too short to be evidence.
 */
export function paperIdentity(input: PaperIdentityInput): PaperIdentity | null {
  const titleWords = wordsOf(input.title);
  if (titleWords.length < MIN_TITLE_WORDS) return null;
  if (input.filename && squashed(input.title) === squashed(input.filename.replace(/\.[a-z0-9]{1,5}$/i, ""))) {
    return null;
  }
  const ids = ownIds([input.firstPagesText, input.uploadMeta?.doi ?? ""]);
  const firstAuthor = input.authors[0]?.name ?? input.uploadMeta?.authors?.[0];
  return {
    titleWords,
    /* An author whose surname we cannot read is still an author: "" matches
       nothing, so the author rule fails rather than being skipped. */
    surname: firstAuthor ? (surnameOf(firstAuthor) ?? "") : null,
    dois: ids.dois,
    arxivs: ids.arxivs,
    shingles: [...shinglesOf(input.opening)],
  };
}

export function isSamePaper(identity: PaperIdentity, candidate: SourceCandidate): SamePaperVerdict {
  const { read, result } = candidate;
  /* The candidate's own identifiers come from its addresses and its meta tags
     only — never its body text, which cites other works. */
  const own = ownIds([read.url, result.url, read.meta?.doi ?? ""]);
  if (conflicts(identity.dois, own.dois) || conflicts(identity.arxivs, own.arxivs)) {
    return { same: false, why: "identifier-conflict" };
  }
  if (!titleMatches(identity.titleWords, candidate)) return { same: false, why: "title-mismatch" };
  if (identity.surname !== null && !authorAppears(identity.surname, read)) return { same: false, why: "author-mismatch" };

  /* With no author to check, a title and an identifier are not enough: the
     upload's first pages carry cited works' DOIs too, and a cited work can
     share an exact title (a thesis and its paper, a dataset and its paper).
     Then the text must agree as well — and when the identifier also agrees,
     the link is still the canonical one. (Plan review round 2, Sol F1.) */
  const content = contentAgrees(identity.shingles, read.text);
  if (identity.surname === null && !content) return { same: false, why: "no-agreement" };

  const doi = own.dois.find((d) => identity.dois.includes(d));
  if (doi) return { same: true, matchedBy: "doi", canonicalUrl: doiUrl(doi) };
  const arxiv = own.arxivs.find((a) => identity.arxivs.includes(a));
  if (arxiv) return { same: true, matchedBy: "arxiv", canonicalUrl: `https://arxiv.org/abs/${arxiv}` };
  if (content) return { same: true, matchedBy: "content", canonicalUrl: null };
  return { same: false, why: "no-agreement" };
}

/**
 * **The text says the same thing**: at least half of the upload opening's
 * distinct shingles are in the candidate's text. Shingles, not one exact run,
 * because the two texts came through different readers (a model's
 * transcription; HTML or pdf.js) that disagree on hyphens and spacing.
 */
function contentAgrees(ours: readonly string[], theirText: string): boolean {
  if (ours.length < MIN_SHINGLES) return false;
  const theirs = shinglesOf(theirText);
  return ours.filter((s) => theirs.has(s)).length >= SHINGLE_SHARE * ours.length;
}

/**
 * **A conflict: the upload carries identifiers of this kind, and the candidate
 * carries one that is none of them.**
 *
 * The upload's list is every identifier on its first two pages, so it can
 * hold cited works' identifiers and miss its own (pass 0 drops arXiv's
 * sideways stamp; a publisher may print the DOI only on the last page). So a
 * candidate DOI absent from that list does not prove a different paper — but
 * it is the safe way to be wrong: it only ever costs a link, never gives a
 * wrong one. The looser rule (conflict only when the upload's *own* DOI is
 * known) would need us to tell the upload's DOI from a cited one, which is
 * exactly what the plan measured we cannot do from the text.
 */
function conflicts(upload: readonly string[], candidate: readonly string[]): boolean {
  return upload.length > 0 && candidate.some((id) => !upload.includes(id));
}

/** DOIs lower-cased; arXiv ids without a version; arXiv's own DOI (`10.48550/arXiv.<id>`) counted as the arXiv id too. */
function ownIds(strings: readonly string[]): { dois: string[]; arxivs: string[] } {
  const found = identifiersIn(strings.filter(Boolean));
  const dois = [...new Set(found.dois.map((d) => d.toLowerCase()))];
  const arxivs = new Set(found.arxivs);
  for (const d of dois) {
    const m = /^10\.48550\/arxiv\.(.+?)(?:v\d+)?$/.exec(d);
    if (m?.[1]) arxivs.add(m[1]);
  }
  return { dois, arxivs: [...arxivs] };
}

function titleMatches(want: readonly string[], { read }: SourceCandidate): boolean {
  /* The fetched page has to name the paper itself. A search annotation is only
     a pointer to that page; after a redirect or a stale result it may describe
     a different document, and evidence from the two must never be combined. */
  const titles = [read.meta?.title, read.title];
  if (titles.some((t) => t && sameWords(wordsOf(t), want))) return true;
  /* A bare PDF has no title we trust (paper-text.ts: its metadata title is too
     often a filename), but a paper's PDF begins with its title. A run, not a
     bag, and near the top: a paper that cites this one has its title too, but
     in the references, not in the first eighty words. */
  if (read.format === "pdf" && !read.meta?.title && !read.title) {
    const head = wordsOf(unbroken(read.text)).slice(0, TITLE_RUN_WINDOW);
    for (let i = 0; i + want.length <= head.length; i++) {
      if (want.every((w, j) => head[i + j] === w)) return true;
    }
  }
  return false;
}

function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

function authorAppears(surname: string, read: SourceCandidate["read"]): boolean {
  if (read.meta?.authors?.some((a) => namesOf(a).includes(surname))) return true;
  return namesOf(read.text.slice(0, AUTHOR_WINDOW * 12)).slice(0, AUTHOR_WINDOW).includes(surname);
}

/**
 * A name's words, diacritics folded (Müller = Muller: one side came through a
 * model, the other through HTML or pdf.js) and with no stopword list —
 * `wordsOf` would drop a surname like "An".
 */
function namesOf(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
}

/** "Ana Müller" and "Müller, Ana" both → "muller". A surname of one letter is no evidence, so null. */
function surnameOf(name: string): string | null {
  const comma = name.indexOf(",");
  const words = namesOf(comma > 0 ? name.slice(0, comma) : name);
  return words.at(-1) ?? null;
}

/**
 * Mend what the two sides disagree on before comparing words: a word broken
 * across a PDF line (`infor- mation`), and soft hyphens. Ligatures (`ﬁ`) are
 * `wordsOf`'s NFKC.
 */
function unbroken(text: string): string {
  return text.replace(/­/g, "").replace(/(\p{L})-\s+(\p{Ll})/gu, "$1$2");
}

/** Distinct 4-word runs over significant words — stopwords and punctuation are where transcriptions differ. */
function shinglesOf(text: string): Set<string> {
  const words = wordsOf(unbroken(text));
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= words.length; i++) out.add(words.slice(i, i + SHINGLE).join(" "));
  return out;
}

function squashed(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
