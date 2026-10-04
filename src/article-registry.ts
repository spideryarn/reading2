/**
 * **What Crossref or DataCite says about the article itself** — its journal
 * and the day it was published — kept only when the registry's title is the
 * article's own.
 * docs/plans/261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md
 *
 * Two halves. The candidates are found without a model: the identifiers
 * printed at the front of a PDF, or declared by a web page. Then each goes
 * through stage 1's `lookupWork` (src/bibliographic.ts), and a record is this
 * article's only when `registryIsThisArticle` says the titles agree — a DOI on
 * a first page may be a cited work's or the journal issue's, and that check is
 * the only thing between it and a wrong date.
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
import type { Meta } from "./types.js";

/** Candidates asked about for one article. Each is a bounded request; three is a first page's worth. */
export const MAX_OWN_IDS = 3;
/** How far into a PDF its own identifier is looked for: the first page, and the one after a publisher's cover. */
const FRONT_PAGES = 2;
/** The shorter title must be at least this long before "the same, plus a subtitle" counts. */
const MIN_SHARED_WORDS = 4;

const DOI_IN_TEXT = /\b10\.\d{4,9}\/[^\s"'<>]+/g;
const ARXIV_IN_TEXT = /\barxiv:\s*(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})/gi;

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
        found.push({ at: base + m.index, id: parseWorkId(m[0].replace(/[.,;:)\]}>]+$/, "")) });
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
  let doi: string | undefined;
  for (const el of Array.from(doc.querySelectorAll("meta"))) {
    const name = (el.getAttribute("name") ?? el.getAttribute("property") ?? "").trim().toLowerCase();
    const content = el.getAttribute("content")?.trim();
    if (!content || !DOI_META.has(name)) continue;
    const found = DOI_IN_TEXT.exec(content)?.[0];
    DOI_IN_TEXT.lastIndex = 0;
    if (found && parseWorkId(found) !== null) {
      doi = found;
      break;
    }
  }
  return ownIdsOfPage({ doi, url });
}

/**
 * **Is the registry's record this article?** The same words in the same order,
 * or one title is the other plus a subtitle (Crossref keeps a subtitle in its
 * own field). Both must be distinctive, and a correction, reply or supplement
 * to the work is another object.
 */
export function registryIsThisArticle(articleTitle: string, registryTitle: string): boolean {
  if (!registryTitleIsDistinctive(articleTitle) || !registryTitleIsDistinctive(registryTitle)) return false;
  if (titlesDifferByObjectQualifier(articleTitle, registryTitle)) return false;
  const a = tokens(articleTitle.replace(/<[^>]*>/g, " "));
  const b = tokens(registryTitle.replace(/<[^>]*>/g, " "));
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short.every((word, i) => long[i] === word)) return false;
  return short.length === long.length || short.length >= MIN_SHARED_WORDS;
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
 * either side there is nothing to agree, and the answer is no.
 */
export function registryAuthorIsOurs(
  meta: Pick<Meta, "byline" | "authors">,
  authors: readonly { family: string }[],
): boolean {
  const ours = authorWords(meta);
  return authors.some((a) => {
    const family = nameWords(a.family);
    return family.length > 0 && family.every((word) => ours.has(word));
  });
}

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
 * it is the publisher's claim and may carry a time.
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
    return {
      outcome: "agreed",
      asked,
      meta: {
        ...meta,
        ...(meta.doi === undefined && id.startsWith("doi:") ? { doi: record.doi } : {}),
        ...(journal !== undefined ? { journal } : {}),
        ...(day !== undefined ? { publishedAt: day } : {}),
      },
    };
  }
  return { meta, outcome: "none-agreed", asked };
}
