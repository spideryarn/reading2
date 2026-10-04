/**
 * **What Crossref or DataCite says about the article itself** — its journal
 * and the day it was published — kept only when the registry's title is the
 * article's own, corroborated by an author.
 * docs/plans/261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md
 *
 * Two halves. The candidates are found without a model: the identifiers
 * printed at the front of a PDF, or declared by a web page. Then each goes
 * through stage 1's `lookupWork` (src/bibliographic.ts), and a record is this
 * article's only when its complete title and an author agree — a DOI on
 * a first page may be a cited work's or the journal issue's.
 *
 * It never fails an import: an unreachable registry, a miss and a disagreement
 * all leave `meta` exactly as it was.
 *
 * ## What may be logged from this file
 *
 * Nothing; src/pipeline.ts logs the outcome and the counts. Never a title.
 */
import { parseWorkId, realIsoDay, type LookupResult, type WorkId } from "./bibliographic.js";
import { registryTitleIsDistinctive, safeLookup, titlesDifferByObjectQualifier } from "./citation-registry.js";
import { tokens } from "./citation-lookup.js";
import { publishedYearOf, type Meta } from "./types.js";

/** Candidates asked about for one article. Each is a bounded request; three is a first page's worth. */
export const MAX_OWN_IDS = 3;
/** How far into a PDF its own identifier is looked for: the first page, and the one after a publisher's cover. */
const FRONT_PAGES = 2;

const DOI_IN_TEXT = /\b10\.\d{4,9}\/[^\s"'<>]+/g;
const ARXIV_IN_TEXT = /\barxiv:\s*(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})/gi;

/** Running text and meta tags can wrap an identifier in the same punctuation. */
function unwrappedIdentifier(value: string): string {
  return value.replace(/^[\s<(]+/, "").replace(/[.,;:)\]}>\s]+$/, "");
}

function unique(ids: readonly (WorkId | null)[]): WorkId[] {
  const seen = new Set<WorkId>();
  for (const id of ids) if (id !== null) seen.add(id);
  return [...seen].slice(0, MAX_OWN_IDS);
}

/**
 * Every DOI and arXiv stamp printed on a PDF's first two pages, in reading
 * order. Any record type: the DOI strip is furniture the reading view hides,
 * and it is exactly the line wanted here.
 */
export function ownIdsOfPdf(records: readonly { page: number; text: string }[]): WorkId[] {
  if (records.length === 0) return [];
  const first = Math.min(...records.map((r) => r.page));
  const found: { at: number; id: WorkId | null }[] = [];
  let base = 0;
  for (const r of records) {
    if (r.page < first + FRONT_PAGES) {
      for (const m of r.text.matchAll(DOI_IN_TEXT)) {
        /* A text layer can print the journal's address straight after the
           DOI with no space, and a DOI's own suffix never starts a new one. */
        const doi = m[0].replace(/(?:www\.|https?:).*$/i, "");
        found.push({ at: base + m.index, id: parseWorkId(unwrappedIdentifier(doi)) });
      }
      for (const m of r.text.matchAll(ARXIV_IN_TEXT)) {
        found.push({ at: base + m.index, id: m[1] ? parseWorkId(`arxiv:${m[1]}`) : null });
      }
    }
    base += r.text.length + 1;
  }
  return unique(found.sort((a, b) => a.at - b.at).map((f) => f.id));
}

/** A web page's own identifier: its `citation_doi`, then one carried in its address. */
export function ownIdsOfPage(page: { doi: string | undefined; url: string | null }): WorkId[] {
  return unique([page.doi ? parseWorkId(page.doi) : null, page.url ? parseWorkId(page.url) : null]);
}

const DOI_META = new Set(["citation_doi", "prism.doi", "dc.identifier"]);

/** `ownIdsOfPage`, off a document's scholarly meta tags. Read before Readability, which rewrites the document. */
export function ownIdsOfDocument(doc: Document, url: string | null): WorkId[] {
  let declared: WorkId | null = null;
  for (const el of Array.from(doc.querySelectorAll("meta"))) {
    const name = (el.getAttribute("name") ?? el.getAttribute("property") ?? "").trim().toLowerCase();
    const content = el.getAttribute("content")?.trim();
    if (!content || !DOI_META.has(name)) continue;
    /* Parse the declared value whole. A URL or ISBN containing a DOI is not
       a declaration that the DOI identifies this page. */
    const found = parseWorkId(unwrappedIdentifier(content));
    if (found) {
      declared = found;
      break;
    }
  }
  return unique([declared, ...ownIdsOfPage({ doi: undefined, url })]);
}

/**
 * **Is the registry's record this article?** The same words and maths operators in the same order,
 * with no extra words on either side. A subtitle can name another work by
 * the same author, so a shared prefix is insufficient. Both must be distinctive,
 * and a correction, reply or supplement to the work is another object.
 */
export function registryIsThisArticle(articleTitle: string, registryTitle: string): boolean {
  if (!registryTitleIsDistinctive(articleTitle) || !registryTitleIsDistinctive(registryTitle)) return false;
  if (titlesDifferByObjectQualifier(articleTitle, registryTitle)) return false;
  /* Word folding alone erases x+y versus x-y. Keep operators in their places
     between the words while ignoring prose punctuation and registry markup. */
  const titleParts = (title: string) => title.replace(/<[^>]*>/g, " ")
    .normalize("NFKC")
    .split(/([\p{Sm}*/()\[\]{}-])/u)
    .flatMap((part, i) => i % 2 === 1 ? [part] : tokens(part));
  const a = titleParts(articleTitle);
  const b = titleParts(registryTitle);
  return a.length === b.length && a.every((word, i) => b[i] === word);
}

/** Letters and digits, lower-cased, accents off: `Müller` and `Muller` are one name. */
function nameWords(value: string): string[] {
  return tokens(value.normalize("NFD").replace(/\p{M}+/gu, ""));
}

function authorWords(meta: Pick<Meta, "byline" | "authors">): Set<string> {
  return new Set(nameWords([meta.byline ?? "", ...(meta.authors ?? []).map((a) => a.name)].join(" ")));
}

/**
 * **One of the registry's authors is one of the article's.** A cited work can
 * share an exact title with the piece that cites it (a thesis and its paper),
 * so a title alone does not say whose DOI was printed on the first page —
 * src/source-guess.ts § `isSamePaper` meets the same case. With no author on
 * either side there is nothing to agree, and the answer is no. A free-text
 * byline needs a full registry name; a surname alone can be an ordinary word.
 * Structured authors are checked separately, never as one bag of words.
 */
export function registryAuthorIsOurs(
  meta: Pick<Meta, "byline" | "authors">,
  authors: readonly { family: string; given?: string }[],
): boolean {
  /* The same given name, or the same initial where either side prints one:
     a registry's `Michael J.` and `M.` are both a byline's `Michael Levin`. */
  const sameGiven = (a: string | undefined, b: string | undefined) =>
    a !== undefined && b !== undefined && (a === b || ((a.length === 1 || b.length === 1) && a[0] === b[0]));
  return authors.some((a) => {
    const family = nameWords(a.family);
    if (family.length === 0) return false;
    const given = nameWords(a.given ?? "");
    /* The family name whole, with the first given name among the words just
       before it (`Michael J. Levin`) or straight after it (`Levin, Michael`). */
    const fullNameIn = (name: string) => {
      const words = nameWords(name);
      return words.some((_, at) => {
        if (!family.every((word, j) => words[at + j] === word)) return false;
        const before = words.slice(Math.max(0, at - GIVEN_WORDS_BEFORE), at);
        return before.some((word) => sameGiven(word, given[0])) || sameGiven(words[at + family.length], given[0]);
      });
    };
    if (given.length > 0) {
      return (meta.authors ?? []).some((author) => fullNameIn(author.name)) || fullNameIn(meta.byline ?? "");
    }
    return (meta.authors ?? []).some((author) => {
      const words = nameWords(author.name);
      return words.length >= family.length && family.every((word, i) => words[words.length - family.length + i] === word);
    });
  });
}

/** How many words before a family name a given name may sit: itself and two middle names or initials. */
const GIVEN_WORDS_BEFORE = 3;

/** Stop starting lookups after this long. One already started keeps `lookupWork`'s own bounds. */
const LOOKUP_BUDGET_MS = 10_000;

export interface RegistryFactsDeps {
  lookup: (id: WorkId) => Promise<LookupResult>;
  signal?: AbortSignal | undefined;
  /** Tests make the budget deterministic. */
  now?: () => number;
}

/**
 * - `no-candidate` — nothing to ask about, or no title or author worth checking against.
 * - `agreed` — a record's title was the article's, and its facts were taken.
 * - `none-agreed` — every candidate was missing, unreachable or another work.
 */
export type RegistryOutcome = "no-candidate" | "agreed" | "none-agreed";

export interface RegistryFacts {
  meta: Meta;
  outcome: RegistryOutcome;
  asked: number;
}

/**
 * `meta` with the journal, the DOI and the publication day of the first
 * candidate whose record is this article. The article's own DOI, when it has
 * one, is asked about first. The page's own `publishedAt` is never replaced:
 * it is the publisher's claim and may carry a time. A record that states no
 * whole day gives its year instead (`publishedYear`), and never a made-up day.
 */
export async function withRegistryFacts(
  meta: Meta,
  candidates: readonly WorkId[],
  deps: RegistryFactsDeps,
): Promise<RegistryFacts> {
  const ids = unique([meta.doi ? parseWorkId(meta.doi) : null, ...candidates]);
  if (ids.length === 0 || !registryTitleIsDistinctive(meta.title) || authorWords(meta).size === 0) {
    return { meta, outcome: "no-candidate", asked: 0 };
  }
  const now = deps.now ?? Date.now;
  const started = now();
  let asked = 0;
  for (const id of ids) {
    /* One lookup can take most of half a minute against a slow registry
       (src/bibliographic.ts § the claim lease); the budget stops a second and
       third being started behind it. */
    if (deps.signal?.aborted || (asked > 0 && now() - started > LOOKUP_BUDGET_MS)) break;
    asked++;
    const answer = await safeLookup(deps.lookup, id);
    if (answer.kind !== "found") continue;
    const { record } = answer;
    if (!registryIsThisArticle(meta.title, record.title) || !registryAuthorIsOurs(meta, record.authors)) continue;
    const day = meta.publishedAt === undefined ? realIsoDay(record.published) : undefined;
    /* Crossref's `container-title` is where the piece appeared. DataCite's
       venue falls back to the depositing publisher, which is a repository's
       name and not a journal — except for arXiv, where it is the answer. */
    const journal = record.source === "crossref" || id.startsWith("arxiv:") ? record.venue : undefined;
    /* **A day or a year, never both** (plan 261004h). The year is kept only
       when the article ends up with no day, its own or the registry's; a year
       and a month is kept as the year. A carried minimal-paper year survives
       an agreeing record with no usable date, just as a carried day does.
       Ordinary re-extraction does not carry either date into this function. */
    const { publishedYear: carried, ...rest } = meta;
    const year = rest.publishedAt === undefined && day === undefined
      ? publishedYearOf(record.year) ?? publishedYearOf(carried)
      : undefined;
    return {
      outcome: "agreed",
      asked,
      meta: {
        ...rest,
        ...(meta.doi === undefined && id.startsWith("doi:") ? { doi: record.doi } : {}),
        ...(journal !== undefined ? { journal } : {}),
        ...(day !== undefined ? { publishedAt: day } : {}),
        ...(year !== undefined ? { publishedYear: year } : {}),
      },
    };
  }
  return { meta, outcome: "none-agreed", asked };
}
