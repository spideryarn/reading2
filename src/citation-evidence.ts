/**
 * **The evidence a cited work's blurb may be written from — and nothing else.**
 * Plan 261017h stage 3a: docs/plans/261017h-stage-3-design-citation-blurbs.md
 * § 3, as amended by its design review (G6, G9, G10); and plan 261018o stage 1
 * (docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md,
 * as amended by its review: R2, R5, R6), which added two sources each switched
 * on only by its key. No model is called here, nothing is stored, and nothing
 * reaches the screen: this is the cascade that says, for each row of a
 * Bibliography, either *here is an abstract we are sure is this work's* or
 * *why there is none*.
 *
 * **Three phases** (R6), so that every work is known by an identifier before
 * anybody is asked for its abstract:
 *
 * ```
 * 1. resolve  DOI / arXiv id ─► lookupWork (cached; Crossref, DataCite) ─► identity agreed? ─► its abstract ─► done
 *             title only, imported from a web address ─► Crossref query.bibliographic ─► the strict rule ─► its abstract ─► done
 *                                                        └─ no match, OpenAlex keyed ─► OpenAlex search.title ─► the same rule
 *             … each one left with a confirmed id and no abstract goes on:
 * 2. Semantic Scholar by DOI or arXiv id   (its key AND its approval only)   ─► its id and title agree ─► its abstract ─► done
 * 3. OpenAlex by DOI ─► a reconstruction (never a book or a chapter; not for an arXiv id, nor a Crossref title match)
 * ```
 *
 * **The title search is a stated, bounded exception** to src/bibliographic.ts's
 * "identifiers only" (its header says so, and why): at most
 * `MAX_TITLE_SEARCHES` a run, Crossref's and OpenAlex's together, the shared
 * limiter, and **only when the caller says the article came from a public web
 * address** (G6) — an uploaded file may be a confidential manuscript whose
 * reference list names its authors' unpublished work. The *unpublished* word
 * list below is a second guard, not the claim.
 *
 * **With no key, neither new source is asked and nothing is logged as a
 * failure**: exactly the cascade of 261017h — down to a DOI row going on to
 * OpenAlex in the same worker that looked it up, not waiting for phase 3. A bad or absent optional source
 * falls through to the next phase; it never suppresses one (R6).
 *
 * **Pure, with its dependencies handed in** (`EvidenceDeps`); the real ones
 * are `citationEvidenceDeps()`, which is also where the environment's keys are
 * read (src/registry-keys.ts) — this file never reads them, and never holds a
 * key's value: a request names its registry and src/fetch.ts attaches the
 * header. Every row given comes back answered exactly once, as a
 * `RowEvidence`:
 *
 * - `evidence` — the text, where it came from, a link built by code, when it
 *   was read, and its hash. `kind` says whose words they are: the author's
 *   abstract, or OpenAlex's reconstruction of one, which is labelled as such
 *   (the spike's Searle reprint was a reconstruction that said the opposite of
 *   Searle — docs/investigations/261017c-citation-blurbs-cost-and-quality.md).
 * - `no-evidence` — why not. A *registry* negative carries `checkedAt`, and is
 *   worth asking again after `REGISTRY_NEGATIVE_TTL_MS` (G9); a *structural*
 *   one (a label, an unpublished work, no identity to look up) is not.
 * - `transient` — the registry was busy or cooling, OpenAlex or Semantic
 *   Scholar refused us, the run's cap or budget ran out. Never stored; the
 *   next run asks again.
 *
 * ## What may be logged from this file
 *
 * Row ids, services, statuses and counts. Never a title, an author or a query:
 * they are the article's characters. Never a key: none passes through here.
 */

import { createHash } from "node:crypto";

import {
  coolAfter,
  doiFor,
  inServiceTurn,
  list,
  lookupWork,
  parseWorkId,
  plausibleYear,
  record,
  registryAbstract,
  type ServiceLimiter,
  type UnavailableWhy,
  type WorkId,
} from "./bibliographic.js";
import { tokens, surnameOf } from "./citation-lookup.js";
import {
  type LookupWork,
  mapLimited,
  registryFor,
  registryTitleIsDistinctive,
  rowWorkId,
  safeLookup,
  titlesDifferByObjectQualifier,
} from "./citation-registry.js";
import { doiPath } from "./doi-url.js";
import { FetchFailure, fetchBibliographicJson } from "./fetch.js";
import { log as rootLog, type Log } from "./log.js";
import { authorYearLabel } from "./paper-evidence.js";
import { optionalSources, type OptionalSources, type RegistryKeyName } from "./registry-keys.js";
import { CONTACT_EMAIL } from "./site-text.js";
import type { CitedWork } from "./types.js";
import { evidenceUrl, isSemanticScholarPaperId } from "./work-id.js";

export { evidenceUrl, REGISTRY_NEGATIVE_TTL_MS } from "./work-id.js";

/* ------------------------------------------------------------ the policy -- */

/** At most this many title queries a run — Crossref's and OpenAlex's together, the bounded exception's bound. */
export const MAX_TITLE_SEARCHES = 60;
/** Identifier lookups in flight at once, and title searches at once, each. */
export const EVIDENCE_CONCURRENCY = 2;
/**
 * Semantic Scholar requests in flight at once. One: the service has one slot
 * and a start every 1.1 s (src/bibliographic.ts § `SPACING_MS`), so a second
 * worker would only wait out the slot's 3 s and come back `busy`.
 */
const SEMANTIC_SCHOLAR_CONCURRENCY = 1;
/** After this long no lookup or cooldown wait starts; the rows left are transient. */
export const LOOKUP_BUDGET_MS = 120_000;
/** The most of an abstract a prompt is given. */
export const EVIDENCE_CAP = 2_500;
/**
 * Bump when what counts as evidence changes, so a stored hash says which rules
 * made it. `/2` since 2026-10-18: Semantic Scholar's abstracts and OpenAlex's
 * title matches count (plan 261018o, R3).
 */
const EVIDENCE_HASH_DOMAIN = "citation-evidence/2";

/** Crossref types a book-looking entry may match (G10). `book-chapter` is not one. */
export const ACCEPTED_BOOK_TYPES = ["book", "monograph", "edited-book", "reference-book"] as const;
/** Crossref types a title search never accepts: a review, a figure or a table, a dataset. */
const REFUSED_TYPES = new Set(["peer-review", "component", "dataset"]);
/**
 * OpenAlex types a title search never accepts, in OpenAlex's own vocabulary
 * (help.openalex.org/data/work-types; R6): a review **of** the work, an
 * erratum, a retraction notice, paratext (a cover, a front matter), a peer
 * review — and Crossref's refusals, a dataset and supplementary material.
 * `review` (a review article) is a work in its own right, as at Crossref.
 */
const OPENALEX_SEARCH_REFUSED_TYPES = new Set([
  "book-review",
  "erratum",
  "retraction",
  "paratext",
  "peer-review",
  "dataset",
  "supplementary-materials",
]);
/** OpenAlex types whose "abstract" is not the cited work's own: a reprint's chapter, a whole book. */
const OPENALEX_REFUSED_TYPES = new Set(["book", "book-chapter"]);

/* ------------------------------------------------------------- the types -- */

export type EvidenceKind = "author-abstract" | "registry-reconstruction";
export type EvidenceSource = "crossref" | "datacite" | "openalex" | "semantic-scholar";

export interface Evidence {
  kind: EvidenceKind;
  source: EvidenceSource;
  /** How the work was reached: by the row's own identifier, or by a title search. */
  via: "id" | "title";
  workId: WorkId;
  /** Built by code from `workId`: a doi.org or arxiv.org address, never a registry's or a model's. */
  url: string;
  host: string;
  /** When the text was read, ISO. */
  readAt: string;
  /** The abstract, plain, at most `EVIDENCE_CAP`. */
  text: string;
  /** A hash of the text and where it came from, which an artefact may keep in its place. */
  evidenceHash: string;
  /**
   * **Semantic Scholar's own id for the paper**, forty hex characters — only
   * on its evidence. The card links to the paper's page there, which its
   * licence asks of anything that shows its data.
   */
  paperId?: string;
}

/** No evidence, for a reason that will not change until the row does. */
export type StructuralWhy =
  /** No DOI or arXiv id, and not a title-only row we may search — or a title too weak, or no author, to search by. */
  | "no-identifier-or-title"
  /** The title is an author–year label ("Zacks et al. (2007)"), which no record is titled. */
  | "label-only"
  /** The entry says the work is unpublished, in preparation, under review, submitted or forthcoming. */
  | "unpublished"
  /** A title-only row in an article not imported from a public web address (G6). */
  | "title-search-off";

/** No evidence, because of what a registry said today; asked again after `REGISTRY_NEGATIVE_TTL_MS` (G9). */
export type RegistryWhy = "not-found" | "no-abstract" | "not-identified" | "conflict";

/** No answer this run, and none stored: the next run asks again. */
export type TransientWhy = UnavailableWhy | "over-budget" | "over-cap" | "openalex-off" | "semantic-scholar-off";

export type RowEvidence =
  | { state: "evidence"; evidence: Evidence }
  | { state: "no-evidence"; why: StructuralWhy }
  | { state: "no-evidence"; why: RegistryWhy; checkedAt: string }
  | { state: "transient"; why: TransientWhy };

/** What the cascade reads of a Bibliography row. */
export type EvidenceRow = Pick<CitedWork, "id" | "title" | "url" | "linkFrom"> &
  Partial<Pick<CitedWork, "authors" | "year" | "entry" | "reference" | "registry">>;

export interface EvidenceOptions {
  /**
   * **True only for an article imported from a public web address** (G6). An
   * uploaded file gets identifier lookups alone.
   */
  titleSearch: boolean;
  /** The step claim's deadline. A caller may omit it outside a claimed job. */
  deadlineAt?: number;
  /** Time kept clear before `deadlineAt` for publication and later work. */
  deadlineMarginMs?: number;
}

export interface EvidenceDeps {
  lookup: LookupWork;
  /**
   * One GET for JSON. `registryKey` names the registry whose key the real
   * fetch attaches as a header (src/fetch.ts § `fetchBibliographicJson`) —
   * by name: the value never reaches this file.
   */
  fetchJson: (url: string, registryKey?: RegistryKeyName) => Promise<unknown>;
  limiter: ServiceLimiter;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: Log;
  /** Tests shorten it; the step uses `LOOKUP_BUDGET_MS`. */
  lookupBudgetMs?: number;
  /**
   * **Which optional sources this run may ask** (src/registry-keys.ts §
   * `OptionalSources`). Absent: neither — the keyless cascade.
   */
  sources?: OptionalSources;
}

export interface EvidenceCounts {
  rows: number;
  evidence: number;
  /** Every outcome, keyed `state:why` (or `evidence:<kind>`). */
  outcomes: Record<string, number>;
  /** Every title query, Crossref's and OpenAlex's: the number `MAX_TITLE_SEARCHES` caps. */
  titleQueries: number;
  /** Of those, OpenAlex's. */
  openAlexTitleQueries: number;
  /** OpenAlex by DOI, for a reconstruction. */
  openAlexQueries: number;
  semanticScholarQueries: number;
}

/**
 * The real dependencies: the shared, cached lookup; the allow-listed JSON
 * fetch; the Postgres limiter; and the optional sources the environment
 * switches on **now** — read per run, so a key added is seen on the next one.
 */
export async function citationEvidenceDeps(): Promise<EvidenceDeps> {
  return {
    lookup: lookupWork,
    fetchJson: (url, registryKey) => fetchBibliographicJson(url, registryKey === undefined ? {} : { registryKey }),
    limiter: (await import("./store/pg-bibliographic.js")).pgBibliographicStore,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: Date.now,
    log: rootLog("pipeline").child({ lookup: "citation-evidence" }),
    sources: optionalSources(),
  };
}

/* ------------------------------------------------------------ the text -- */

/** The opening of `text`, at most `EVIDENCE_CAP`, cut at a word. */
function capped(text: string): string {
  if (text.length <= EVIDENCE_CAP) return text;
  const cut = text.slice(0, EVIDENCE_CAP);
  const atWord = cut.replace(/\s+\S*$/, "");
  return (atWord.length > EVIDENCE_CAP / 2 ? atWord : cut).trimEnd();
}

function evidenceOf(
  kind: EvidenceKind,
  source: EvidenceSource,
  via: Evidence["via"],
  workId: WorkId,
  readAt: string,
  abstract: string,
  paperId?: string,
): Evidence {
  const url = evidenceUrl(workId);
  const text = capped(abstract);
  const evidenceHash = createHash("sha256")
    .update([EVIDENCE_HASH_DOMAIN, kind, source, workId, text].join("\n"), "utf8")
    .digest("hex")
    .slice(0, 16);
  return {
    kind,
    source,
    via,
    workId,
    url,
    host: new URL(url).hostname,
    readAt,
    text,
    evidenceHash,
    ...(paperId !== undefined ? { paperId } : {}),
  };
}

/**
 * OpenAlex's `abstract_inverted_index` as text — word → positions, back into
 * order. Positions past 2,000 are dropped (OpenAlex's own index is capped near
 * there, and a malformed one must not allocate an enormous array).
 */
export function invertedToText(index: unknown): string | null {
  const words: string[] = [];
  for (const [word, positions] of Object.entries(record(index) ?? {})) {
    for (const p of list(positions)) {
      if (typeof p === "number" && Number.isInteger(p) && p >= 0 && p < 2000) words[p] = word;
    }
  }
  return registryAbstract(words.filter((w) => w !== undefined).join(" "));
}

/* ------------------------------------------------------- the row's shape -- */

/** "A, B, and C (2019)" — the three-or-more-author label `authorYearLabel` does not cover. */
const LABEL_LIST = /^[\p{Lu}][\p{L}'’-]+(?:,\s+[\p{Lu}][\p{L}'’-]+)*,?\s+and\s+[\p{Lu}][\p{L}'’-]+\s+\(\d{4}[a-z]?\)$/u;

function isLabel(title: string): boolean {
  return authorYearLabel(title) !== null || LABEL_LIST.test(title.trim());
}

/** Words that say a work is not (yet) published — a reference a manuscript makes to its authors' own work. */
const UNPUBLISHED = /\b(?:in preparation|under review|submitted|forthcoming|unpublished|personal communication)\b/i;

function saysUnpublished(row: EvidenceRow): boolean {
  return [row.title, row.year, row.entry, row.reference?.quote].some((s) => s !== undefined && UNPUBLISHED.test(s));
}

/** An entry that names a book: an ISBN, a Press, Publishers, Books, or an editor. */
const BOOK_LOOKING = /\bISBN\b|\bPress\b|\bPublishers?\b|\bBooks\b|\((?:Ed|Eds)\.?\)/i;

function looksLikeABook(row: EvidenceRow): boolean {
  return [row.entry, row.reference?.quote].some((s) => s !== undefined && BOOK_LOOKING.test(s));
}

function yearOf(year: string | undefined): number | undefined {
  return plausibleYear(year?.match(/\b\d{4}\b/)?.[0]);
}

/* ------------------------------------------------- the strict title rule -- */

function titleWords(title: string): string {
  return tokens(title.replace(/<[^>]*>/g, " ")).join(" ");
}

/** The part of a title before its first subtitle (": " or "? "), as words. */
function headWords(title: string): string {
  return titleWords(title.split(/[:?]\s/)[0] ?? "");
}

/** Equal once normalised, or one is the other plus a subtitle — and never a correction or another object. */
function titlesAgree(recordTitle: string, workTitle: string): boolean {
  const a = titleWords(recordTitle);
  const b = titleWords(workTitle);
  if (a === "" || b === "") return false;
  if (titlesDifferByObjectQualifier(recordTitle, workTitle)) return false;
  return a === b || headWords(recordTitle) === b || headWords(workTitle) === a;
}

/**
 * **A registry's search item, in the few words the strict rule reads** — so
 * one rule judges Crossref's and OpenAlex's items alike (R6), and each
 * registry's own shapes and type vocabulary stay in its adapter below.
 */
interface CandidateWork {
  title: string;
  /** The **first** author's name as the registry gives it, or null. */
  firstAuthor: string | null;
  year: number | undefined;
  /** `book` for a whole book's types, `refused` for a kind that is never the cited work, else `work`. */
  kind: "book" | "work" | "refused";
  /** The DOI it is registered under, as a `doi:` id, or null. */
  doi: WorkId | null;
}

function doiIdOf(value: unknown): WorkId | null {
  const id = typeof value === "string" ? parseWorkId(value) : null;
  return id?.startsWith("doi:") ? id : null;
}

/** Crossref's first author's family name (`sequence: "first"`, else the first listed), or null. */
function crossrefFirstAuthor(item: Record<string, unknown>): string | null {
  const authors = list(item.author).map(record).filter((a) => a !== null);
  const first = authors.find((a) => a.sequence === "first") ?? authors[0];
  const family = first?.family ?? first?.name;
  return typeof family === "string" && family.trim() !== "" ? family : null;
}

function crossrefTitle(item: Record<string, unknown>): string {
  const title = list(item.title)[0];
  const subtitle = list(item.subtitle)[0];
  if (typeof title !== "string") return "";
  return typeof subtitle === "string" && subtitle.trim() !== "" ? `${title}: ${subtitle}` : title;
}

/** A Crossref `works?query.bibliographic=` item, as the rule reads it. */
function crossrefCandidate(raw: unknown): CandidateWork | null {
  const item = record(raw);
  if (item === null) return null;
  const type = typeof item.type === "string" ? item.type : "";
  return {
    title: crossrefTitle(item),
    firstAuthor: crossrefFirstAuthor(item),
    year: plausibleYear(list(list(record(item.issued)?.["date-parts"])[0])[0]),
    kind: REFUSED_TYPES.has(type)
      ? "refused"
      : (ACCEPTED_BOOK_TYPES as readonly string[]).includes(type)
        ? "book"
        : "work",
    doi: doiIdOf(item.DOI),
  };
}

/**
 * OpenAlex's first author: the authorship whose `author_position` is
 * `"first"` — never merely the first listed — by its `raw_author_name` (the
 * byline as printed), else the author's `display_name`.
 */
function openAlexFirstAuthor(item: Record<string, unknown>): string | null {
  const first = list(item.authorships)
    .map(record)
    .find((a) => a?.author_position === "first");
  const name = first?.raw_author_name ?? record(first?.author)?.display_name;
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

/** An OpenAlex `works?search.title=` result, as the rule reads it. */
function openAlexCandidate(raw: unknown): CandidateWork | null {
  const item = record(raw);
  if (item === null) return null;
  const type = typeof item.type === "string" ? item.type : "";
  return {
    title: typeof item.display_name === "string" ? item.display_name : "",
    firstAuthor: openAlexFirstAuthor(item),
    year: plausibleYear(item.publication_year),
    kind: OPENALEX_SEARCH_REFUSED_TYPES.has(type) ? "refused" : type === "book" ? "book" : "work",
    doi: doiIdOf(item.doi),
  };
}

/**
 * **Whether a registry's search item is this row's work** — the strict rule
 * (design § 3, G10), every clause required, over both registries' items
 * (R6):
 *
 * - the titles agree: equal once normalised, or equal up to a subtitle, with no
 *   object qualifier between them (a correction, a reply, a supplement);
 * - **the registry's first author** has the row's first author's surname — a
 *   second author's agreement is not enough, and neither is the year alone;
 * - the years are within one of each other, when both give one;
 * - the item is not of a kind that is never the cited work (a peer review, a
 *   component or a dataset at Crossref; OpenAlex's list above);
 * - an entry that looks like a book matches only a book-type record
 *   (`ACCEPTED_BOOK_TYPES`; OpenAlex's `book`), never a chapter or an article.
 */
function candidateIdentifies(candidate: CandidateWork | null, row: EvidenceRow): boolean {
  if (candidate === null) return false;
  if (!titlesAgree(candidate.title, row.title)) return false;
  const surname = surnameOf(row.authors ?? null);
  const first = candidate.firstAuthor;
  if (surname === null || first === null || !tokens(first).includes(surname)) return false;
  const rowYear = yearOf(row.year);
  if (rowYear !== undefined && candidate.year !== undefined && Math.abs(rowYear - candidate.year) > 1) return false;
  if (candidate.kind === "refused") return false;
  if (looksLikeABook(row) && candidate.kind !== "book") return false;
  return true;
}

/** Whether a Crossref search item is this row's work, under the strict rule. */
export function crossrefItemIdentifies(raw: unknown, row: EvidenceRow): boolean {
  return candidateIdentifies(crossrefCandidate(raw), row);
}

/** Whether an OpenAlex search result is this row's work, under the same rule. */
export function openAlexItemIdentifies(raw: unknown, row: EvidenceRow): boolean {
  return candidateIdentifies(openAlexCandidate(raw), row);
}

/** The longest query sent, in characters, cut at a word. */
const MAX_QUERY = 300;

/** Words, joined by spaces, up to `MAX_QUERY` characters. */
function queryOf(words: readonly string[]): string {
  let query = "";
  for (const word of words) {
    const next = query === "" ? word : `${query} ${word}`;
    if (next.length > MAX_QUERY) break;
    query = next;
  }
  return query;
}

export function crossrefSearchUrl(query: string): string {
  const params = new URLSearchParams({
    "query.bibliographic": query,
    rows: "5",
    select: "DOI,title,subtitle,type,abstract,author,issued",
    mailto: CONTACT_EMAIL,
  });
  return `https://api.crossref.org/works?${params.toString()}`;
}

/**
 * **OpenAlex's title search** — `search.title`, which searches the title
 * alone (a bare `search=` reaches abstracts and full text too), works with a
 * DOI only, five results, and only the fields the strict rule reads (R6). The
 * key is a header, never a parameter here (R10).
 */
export function openAlexSearchUrl(titleQuery: string): string {
  const params = new URLSearchParams({
    "search.title": titleQuery,
    filter: "has_doi:true",
    per_page: "5",
    select: "id,doi,display_name,type,publication_year,authorships",
    mailto: CONTACT_EMAIL,
  });
  return `https://api.openalex.org/works?${params.toString()}`;
}

export function openAlexAbstractUrl(doi: string): string {
  return `https://api.openalex.org/works/doi:${doiPath(doi)}?select=display_name,type,abstract_inverted_index&mailto=${encodeURIComponent(CONTACT_EMAIL)}`;
}

/**
 * **Semantic Scholar's paper, by the id we already hold** — `DOI:` or
 * `ARXIV:`, and the abstract's fields only. Never `tldr`, which is a model's
 * summary, not the author's words.
 */
export function semanticScholarUrl(id: WorkId): string {
  const paper = id.startsWith("arxiv:") ? `ARXIV:${id.slice("arxiv:".length)}` : `DOI:${doiPath(doiFor(id))}`;
  return `https://api.semanticscholar.org/graph/v1/paper/${paper}?fields=paperId,title,abstract,externalIds,year`;
}

/* ------------------------------------------------------------ the cascade -- */

/** Which queue a row joins, or its answer already. */
type Route = { kind: "id"; id: WorkId } | { kind: "title"; surname: string } | { kind: "done"; answer: RowEvidence };

function routeOf(row: EvidenceRow, options: EvidenceOptions, checkedAt: string): Route {
  const id = rowWorkId(row);
  if (id !== null) {
    if (row.registry?.kind === "conflict") return { kind: "done", answer: { state: "no-evidence", why: "conflict", checkedAt } };
    return { kind: "id", id };
  }
  if (row.linkFrom !== "search") return { kind: "done", answer: { state: "no-evidence", why: "no-identifier-or-title" } };
  if (saysUnpublished(row)) return { kind: "done", answer: { state: "no-evidence", why: "unpublished" } };
  if (isLabel(row.title)) return { kind: "done", answer: { state: "no-evidence", why: "label-only" } };
  if (!options.titleSearch) return { kind: "done", answer: { state: "no-evidence", why: "title-search-off" } };
  const surname = surnameOf(row.authors ?? null);
  if (!registryTitleIsDistinctive(row.title) || surname === null) {
    return { kind: "done", answer: { state: "no-evidence", why: "no-identifier-or-title" } };
  }
  return { kind: "title", surname };
}

/**
 * **A work phase 1 has identified, with no abstract yet** — what phases 2 and
 * 3 ask about. `reconstruct` says whether OpenAlex's reconstruction may stand
 * in (phase 3): yes for a DOI the row gave and for a work OpenAlex's own title
 * search found; not for an arXiv id (DataCite already gave what arXiv has) nor
 * for a Crossref title match, as in 261017h.
 */
interface Pending {
  state: "pending";
  id: WorkId;
  via: Evidence["via"];
  reconstruct: boolean;
}

/** The run's state shared by every worker: the breakers and the counts. */
interface Run {
  d: EvidenceDeps;
  sources: OptionalSources;
  checkedAt: () => string;
  openAlexOff: boolean;
  semanticScholarOff: boolean;
  titleQueries: number;
  openAlexTitleQueries: number;
  openAlexQueries: number;
  semanticScholarQueries: number;
  /** No lookup or cooldown wait continues at or after this moment. */
  stopAt: number;
}

function negative(why: RegistryWhy, run: Run): RowEvidence {
  return { state: "no-evidence", why, checkedAt: run.checkedAt() };
}

/**
 * **What an OpenAlex request's failure means**, for either kind of request —
 * or null for a 404, which the caller reads as "nothing". A 401, or a 403
 * while we send a key, is ours to fix: logged at error, OpenAlex off for the
 * run. Keyless, a 403 is OpenAlex's free budget running out and a 429 its
 * pace: off for the run, at warn.
 */
async function openAlexFailure(err: FetchFailure, rowId: string, what: "doi" | "title", run: Run): Promise<RowEvidence | null> {
  const { d } = run;
  const status = err.status;
  if (status === 404 || status === 410) return null;
  if (status === 401 || (status === 403 && run.sources.openAlexKeyed)) {
    /* A key we sent and it refused, or one it now demands: ours to fix, not a busy service. */
    run.openAlexOff = true;
    d.log.error({ row: rowId, service: "openalex", what, status, outcome: "configuration" }, "citation evidence");
    return { state: "transient", why: "openalex-off" };
  }
  if (status === 403 || status === 429) {
    run.openAlexOff = true;
    await coolAfter(err, "openalex", d.limiter);
    d.log.warn({ row: rowId, service: "openalex", what, status, outcome: "off-for-run" }, "citation evidence");
    return { state: "transient", why: "openalex-off" };
  }
  const cooldownMs = await coolAfter(err, "openalex", d.limiter);
  d.log.warn({ row: rowId, service: "openalex", what, status, code: err.code, outcome: cooldownMs !== null ? "cooling-down" : "error" }, "citation evidence");
  return { state: "transient", why: cooldownMs !== null ? "cooling-down" : "error" };
}

/** Phase 3: OpenAlex's reconstruction of a confirmed DOI's abstract, or why not. */
async function fromOpenAlex(rowId: string, p: Pending, run: Run): Promise<RowEvidence> {
  if (run.openAlexOff) return { state: "transient", why: "openalex-off" };
  const { d } = run;
  const doi = doiFor(p.id);
  run.openAlexQueries++;
  type Got = { kind: "json"; json: unknown } | { kind: "answer"; answer: RowEvidence };
  const turn = await inServiceTurn("openalex", { store: d.limiter, sleep: d.sleep }, async (): Promise<Got> => {
    /* Another row may have tripped the breaker while this one waited for its turn. */
    if (run.openAlexOff) return { kind: "answer", answer: { state: "transient", why: "openalex-off" } };
    try {
      return { kind: "json", json: await d.fetchJson(openAlexAbstractUrl(doi), "openalex") };
    } catch (err) {
      if (!(err instanceof FetchFailure)) throw err;
      return { kind: "answer", answer: (await openAlexFailure(err, rowId, "doi", run)) ?? negative("no-abstract", run) };
    }
  });
  if (turn.kind === "refused") return { state: "transient", why: turn.why };
  if (turn.value.kind === "answer") return turn.value.answer;
  const work = record(turn.value.json);
  const type = typeof work?.type === "string" ? work.type : "";
  /* A reprint's chapter or a whole book: the "abstract" is somebody's stitching of the text (Searle). */
  if (OPENALEX_REFUSED_TYPES.has(type)) return negative("no-abstract", run);
  const text = invertedToText(work?.abstract_inverted_index);
  if (text === null) return negative("no-abstract", run);
  return { state: "evidence", evidence: evidenceOf("registry-reconstruction", "openalex", p.via, p.id, run.checkedAt(), text) };
}

/**
 * **Whether Semantic Scholar's paper is the work we asked about** — the id we
 * asked by is not proof, because the same DOI can be attached to the wrong
 * paper there (the spike saw it). Every clause required: its own `paperId` is
 * forty hex; one of its own external ids, **re-parsed** rather than trusted,
 * is the one we asked by (`doiFor` makes an arXiv id and arXiv's DOI the same
 * thing); and its title agrees with the row's under the strict rule's
 * `titlesAgree`.
 */
function semanticScholarIdentifies(paper: Record<string, unknown> | null, id: WorkId, row: EvidenceRow): boolean {
  if (paper === null || !isSemanticScholarPaperId(paper.paperId)) return false;
  const ids = record(paper.externalIds);
  const theirs = [
    typeof ids?.DOI === "string" ? parseWorkId(ids.DOI) : null,
    typeof ids?.ArXiv === "string" ? parseWorkId(`arxiv:${ids.ArXiv}`) : null,
  ];
  if (!theirs.some((t) => t !== null && doiFor(t) === doiFor(id))) return false;
  return typeof paper.title === "string" && titlesAgree(paper.title, row.title);
}

/**
 * Phase 2: **Semantic Scholar's abstract for a work we hold by id**, or null
 * when it has none we can be sure is this work's (the caller goes on to phase
 * 3), or transient. A 401 or 403 is a key it refused — ours to fix: logged at
 * error, the source off for the run. A 429 also turns it off for the run, as
 * OpenAlex's does: it is paced well under its limit, so one means we are not
 * the only caller.
 */
async function fromSemanticScholar(row: EvidenceRow, p: Pending, run: Run): Promise<RowEvidence | null> {
  if (run.semanticScholarOff) return { state: "transient", why: "semantic-scholar-off" };
  const { d } = run;
  type Got = { kind: "json"; json: unknown } | { kind: "answer"; answer: RowEvidence | null };
  const turn = await inServiceTurn("semantic-scholar", { store: d.limiter, sleep: d.sleep }, async (): Promise<Got> => {
    if (run.semanticScholarOff) return { kind: "answer", answer: { state: "transient", why: "semantic-scholar-off" } };
    run.semanticScholarQueries++;
    try {
      return { kind: "json", json: await d.fetchJson(semanticScholarUrl(p.id), "semantic-scholar") };
    } catch (err) {
      if (!(err instanceof FetchFailure)) throw err;
      const status = err.status;
      if (status === 404 || status === 410) return { kind: "answer", answer: null };
      if (status === 401 || status === 403) {
        run.semanticScholarOff = true;
        d.log.error({ row: row.id, service: "semantic-scholar", status, outcome: "configuration" }, "citation evidence");
        return { kind: "answer", answer: { state: "transient", why: "semantic-scholar-off" } };
      }
      const cooldownMs = await coolAfter(err, "semantic-scholar", d.limiter);
      if (status === 429) {
        run.semanticScholarOff = true;
        d.log.warn({ row: row.id, service: "semantic-scholar", status, outcome: "off-for-run" }, "citation evidence");
        return { kind: "answer", answer: { state: "transient", why: "semantic-scholar-off" } };
      }
      d.log.warn(
        { row: row.id, service: "semantic-scholar", status, code: err.code, outcome: cooldownMs !== null ? "cooling-down" : "error" },
        "citation evidence",
      );
      return { kind: "answer", answer: { state: "transient", why: cooldownMs !== null ? "cooling-down" : "error" } };
    }
  });
  if (turn.kind === "refused") return { state: "transient", why: turn.why };
  if (turn.value.kind === "answer") return turn.value.answer;
  const paper = record(turn.value.json);
  if (!semanticScholarIdentifies(paper, p.id, row)) {
    d.log.info({ row: row.id, service: "semantic-scholar", outcome: "not-identified" }, "citation evidence");
    return null;
  }
  const abstract = registryAbstract(paper?.abstract);
  if (abstract === null) return null;
  return {
    state: "evidence",
    evidence: evidenceOf("author-abstract", "semantic-scholar", p.via, p.id, run.checkedAt(), abstract, paper?.paperId as string),
  };
}

/** Phase 1 for a row with a DOI or arXiv id: the shared lookup, its identity, its abstract — or the id, pending. */
async function byIdentifier(row: EvidenceRow, id: WorkId, run: Run): Promise<RowEvidence | Pending> {
  const result = await safeLookup(run.d.lookup, id);
  if (result.kind === "unavailable") return { state: "transient", why: result.why };
  if (result.kind === "not-found") return negative("not-found", run);
  const verdict = registryFor(row, result);
  if (verdict === null) return negative("not-identified", run);
  if (verdict.kind === "conflict") return negative("conflict", run);
  const rec = result.record;
  if (rec.abstract !== undefined) {
    const readAt = rec.abstractReadAt ?? run.checkedAt();
    return { state: "evidence", evidence: evidenceOf("author-abstract", rec.source, "id", id, readAt, rec.abstract) };
  }
  /* arXiv's own DOIs live at DataCite, which already gave what it has: OpenAlex is not asked (Semantic Scholar may be). */
  const arxiv = id.startsWith("arxiv:") || doiFor(id).startsWith("10.48550/");
  const pending: Pending = { state: "pending", id, via: "id", reconstruct: !arxiv };
  /* **Keyless, OpenAlex straight away, in this worker** — exactly the cascade
     before the phases (stage 1's code review, F4). Waiting for phase 3 would
     let a lookup that began inside the budget and ended past it lose its
     OpenAlex request, which no keyless run used to. A keyed run takes the
     phased path, so Semantic Scholar is asked first. */
  const keyless = !run.sources.semanticScholar && !run.sources.openAlexKeyed;
  return keyless && pending.reconstruct ? await fromOpenAlex(row.id, pending, run) : pending;
}

type TitleAttempt =
  | { kind: "json"; json: unknown }
  | { kind: "transient"; why: TransientWhy; cooldownMs?: number }
  | { kind: "refused"; why: "cooling-down" | "busy" };

/** One Crossref title request, including the shared limiter and the hard query cap. */
async function titleAttempt(row: EvidenceRow, surname: string, run: Run): Promise<TitleAttempt> {
  const { d } = run;
  const turn = await inServiceTurn("crossref", { store: d.limiter, sleep: d.sleep }, async (): Promise<TitleAttempt> => {
    /* Retries count against the same hard cap as first attempts: the stated
       exception is at most sixty network queries, not sixty rows plus
       however many a provider asks us to repeat. */
    if (run.titleQueries >= MAX_TITLE_SEARCHES) return { kind: "transient", why: "over-cap" };
    run.titleQueries++;
    try {
      return { kind: "json", json: await d.fetchJson(crossrefSearchUrl(queryOf([...tokens(row.title), surname]))) };
    } catch (err) {
      if (!(err instanceof FetchFailure)) throw err;
      const cooldownMs = await coolAfter(err, "crossref", d.limiter);
      d.log.warn(
        { row: row.id, service: "crossref", what: "title-search", status: err.status, code: err.code, outcome: cooldownMs !== null ? "cooling-down" : "error" },
        "citation evidence",
      );
      return cooldownMs === null
        ? { kind: "transient", why: "error" }
        : { kind: "transient", why: "cooling-down", cooldownMs: Math.max(cooldownMs, 1_000) };
    }
  });
  return turn.kind === "refused" ? { kind: "refused", why: turn.why } : turn.value;
}

/** A successful Crossref search through the strict rule: evidence, the match's id pending, or not found. */
function titleAnswer(json: unknown, row: EvidenceRow, run: Run): RowEvidence | Pending {
  const items = list(record(record(json)?.message)?.items);
  for (const raw of items) {
    const candidate = crossrefCandidate(raw);
    if (!candidateIdentifies(candidate, row) || candidate?.doi == null) continue;
    const abstract = registryAbstract(record(raw)?.abstract);
    if (abstract === null) return { state: "pending", id: candidate.doi, via: "title", reconstruct: false };
    return { state: "evidence", evidence: evidenceOf("author-abstract", "crossref", "title", candidate.doi, run.checkedAt(), abstract) };
  }
  return negative("not-found", run);
}

/**
 * **OpenAlex's title search, for a row Crossref's could not find** — with its
 * key only, inside the same cap. One request, no retry: a refusal makes the
 * row transient, and the next run asks again. A match must carry a DOI; its
 * abstract then comes from phases 2 and 3.
 */
async function openAlexByTitle(row: EvidenceRow, run: Run): Promise<RowEvidence | Pending> {
  if (run.openAlexOff) return { state: "transient", why: "openalex-off" };
  const { d } = run;
  type Got = { kind: "json"; json: unknown } | { kind: "answer"; answer: RowEvidence };
  const turn = await inServiceTurn("openalex", { store: d.limiter, sleep: d.sleep }, async (): Promise<Got> => {
    if (run.openAlexOff) return { kind: "answer", answer: { state: "transient", why: "openalex-off" } };
    if (run.titleQueries >= MAX_TITLE_SEARCHES) return { kind: "answer", answer: { state: "transient", why: "over-cap" } };
    run.titleQueries++;
    run.openAlexTitleQueries++;
    try {
      return { kind: "json", json: await d.fetchJson(openAlexSearchUrl(queryOf(tokens(row.title))), "openalex") };
    } catch (err) {
      if (!(err instanceof FetchFailure)) throw err;
      return { kind: "answer", answer: (await openAlexFailure(err, row.id, "title", run)) ?? negative("not-found", run) };
    }
  });
  if (turn.kind === "refused") return { state: "transient", why: turn.why };
  if (turn.value.kind === "answer") return turn.value.answer;
  for (const raw of list(record(turn.value.json)?.results)) {
    const candidate = openAlexCandidate(raw);
    if (candidateIdentifies(candidate, row) && candidate?.doi != null) {
      return { state: "pending", id: candidate.doi, via: "title", reconstruct: true };
    }
  }
  return negative("not-found", run);
}

/** Phase 1 for a title-only row: one Crossref search, or a bounded retry after a short cooldown — then OpenAlex's, keyed. */
async function byTitle(row: EvidenceRow, surname: string, run: Run): Promise<RowEvidence | Pending> {
  for (;;) {
    if (run.d.now() >= run.stopAt) return { state: "transient", why: "over-budget" };
    const attempt = await titleAttempt(row, surname, run);
    if (attempt.kind === "json") {
      const answer = titleAnswer(attempt.json, row, run);
      const notFound = answer.state === "no-evidence" && answer.why === "not-found";
      if (!notFound || !run.sources.openAlexKeyed) return answer;
      if (run.d.now() >= run.stopAt) return { state: "transient", why: "over-budget" };
      return await openAlexByTitle(row, run);
    }
    if (attempt.why !== "cooling-down") return { state: "transient", why: attempt.why };
    const minimum = attempt.kind === "transient" ? (attempt.cooldownMs ?? 0) : 0;
    if (!(await waitOutCooldown("crossref", run, minimum))) {
      return { state: "transient", why: "over-budget" };
    }
  }
}

/**
 * Wait until the shared limiter says a provider's cooldown has ended, but
 * never beyond this run's lookup budget or the claim deadline margin. A
 * cooldown set by the request that called us supplies its `Retry-After` as a
 * minimum wait; an inherited cooldown is polled because the store owns its
 * exact end time.
 */
async function waitOutCooldown(service: "crossref", run: Run, minimumMs = 0): Promise<boolean> {
  const { d } = run;
  let allowance = run.stopAt - d.now();
  if (allowance <= 0 || minimumMs > allowance) return false;
  if (minimumMs > 0) await d.sleep(minimumMs);
  allowance -= minimumMs;
  while (await d.limiter.coolingDown(service)) {
    const remaining = Math.min(allowance, run.stopAt - d.now());
    if (remaining <= 0) return false;
    const pause = Math.min(1_000, remaining);
    await d.sleep(pause);
    allowance -= pause;
  }
  return d.now() < run.stopAt;
}

const ERROR: RowEvidence = { state: "transient", why: "error" };
const OVER_BUDGET: RowEvidence = { state: "transient", why: "over-budget" };

/** One worker's call, with a throw from a dependency read as a transient error rather than a lost run. */
async function guarded<T>(rowId: string, run: Run, ask: () => Promise<T>): Promise<T | RowEvidence> {
  try {
    return await ask();
  } catch (err) {
    run.d.log.warn({ row: rowId, outcome: "error", err: err instanceof Error ? err.name : typeof err }, "citation evidence");
    return ERROR;
  }
}

/**
 * **A pending work's answer, from what phases 2 and 3 said** — the first
 * abstract wins, in cascade order; then a Semantic Scholar that could not be
 * asked keeps the row transient (it may hold the abstract next run); then
 * whatever OpenAlex said; and with neither, the registry had no abstract.
 */
function settled(s2: RowEvidence | null | undefined, oa: RowEvidence | undefined, run: Run): RowEvidence {
  if (s2?.state === "evidence") return s2;
  if (oa?.state === "evidence") return oa;
  if (s2?.state === "transient") return s2;
  return oa ?? negative("no-abstract", run);
}

/**
 * **Phases 2 and 3, over every work phase 1 left pending** — Semantic Scholar
 * one at a time (its key and approval only), then OpenAlex's reconstruction
 * for what is still without an abstract and may have one. One answer per
 * pending work, in order.
 */
async function abstractsFor(
  pending: readonly { row: EvidenceRow; p: Pending }[],
  run: Run,
  mayStart: () => boolean,
): Promise<RowEvidence[]> {
  const s2 = run.sources.semanticScholar
    ? await mapLimited(
        pending,
        SEMANTIC_SCHOLAR_CONCURRENCY,
        ({ row, p }) => guarded(row.id, run, () => fromSemanticScholar(row, p, run)),
        mayStart,
      )
    : null;
  /* `undefined` there is a work the budget did not start; `null` is a paper with nothing for us. */
  const s2Of = (i: number): RowEvidence | null | undefined => {
    if (s2 === null) return undefined;
    const value = s2.values[i];
    return value === undefined ? OVER_BUDGET : value;
  };
  const third = pending.flatMap((x, i) => (s2Of(i)?.state !== "evidence" && x.p.reconstruct ? [{ ...x, i }] : []));
  const oa = await mapLimited(
    third,
    EVIDENCE_CONCURRENCY,
    ({ row, p }) => guarded(row.id, run, () => fromOpenAlex(row.id, p, run)),
    mayStart,
  );
  const oaOf = new Map(third.map((x, j) => [x.i, oa.values[j] ?? OVER_BUDGET]));
  return pending.map((_, i) => settled(s2Of(i), oaOf.get(i), run));
}

function outcomeKey(answer: RowEvidence): string {
  return answer.state === "evidence"
    ? `evidence:${answer.evidence.kind}`
    : answer.state === "no-evidence"
      ? `no-evidence:${answer.why}`
      : `transient:${answer.why}`;
}

/** A run's shared state, its budget starting at `started`. */
function newRun(d: EvidenceDeps, options: EvidenceOptions, started: number): Run {
  const budget = d.lookupBudgetMs ?? LOOKUP_BUDGET_MS;
  return {
    d,
    sources: d.sources ?? { semanticScholar: false, openAlexKeyed: false },
    checkedAt: () => new Date(d.now()).toISOString(),
    openAlexOff: false,
    semanticScholarOff: false,
    titleQueries: 0,
    openAlexTitleQueries: 0,
    openAlexQueries: 0,
    semanticScholarQueries: 0,
    stopAt: Math.min(
      started + budget,
      options.deadlineAt === undefined
        ? Number.POSITIVE_INFINITY
        : options.deadlineAt - (options.deadlineMarginMs ?? 0),
    ),
  };
}

/** What `resolveWorkId` found: the work's identifier and how, or why there is none, or not this time. */
export type ResolvedWork =
  | { kind: "id"; id: WorkId; via: Evidence["via"] }
  | { kind: "none"; why: StructuralWhy | RegistryWhy }
  | { kind: "transient"; why: TransientWhy };

/**
 * **Phase 1 alone, for one row: which work this is, by identifier** — the
 * row's own DOI or arXiv id, or the DOI the strict title rule found (Crossref,
 * then OpenAlex with its key), under every refusal phase 1 has: a registry
 * conflict, an unpublished work, a label, an upload's title row (G6), a title
 * too weak to search. **No abstract is asked for**, and nothing is stored.
 *
 * For a web note (src/citation-web-note.ts, plan 261018o R1): a page is the
 * work's own only by this identifier, so a row this answers `none` for gets no
 * web search at all. A row's own id is taken as the row gives it — the
 * `bibliography` step already compared it with the registry's record and a
 * disagreement is `registry.kind === "conflict"`, refused here.
 */
export async function resolveWorkId(row: EvidenceRow, options: EvidenceOptions, d: EvidenceDeps): Promise<ResolvedWork> {
  const run = newRun(d, options, d.now());
  const route = routeOf(row, options, run.checkedAt());
  if (route.kind === "id") return { kind: "id", id: route.id, via: "id" };
  const answer = route.kind === "done" ? route.answer : await guarded(row.id, run, () => byTitle(row, route.surname, run));
  if (answer.state === "pending") return { kind: "id", id: answer.id, via: answer.via };
  if (answer.state === "evidence") return { kind: "id", id: answer.evidence.workId, via: answer.evidence.via };
  if (answer.state === "transient") return { kind: "transient", why: answer.why };
  return { kind: "none", why: answer.why };
}

/**
 * **The evidence for every row, by entry id** — each row answered once.
 * Phase 1's identifier lookups and title searches run as two queues of
 * `EVIDENCE_CONCURRENCY` side by side; then phase 2 asks Semantic Scholar one
 * at a time, and phase 3 OpenAlex, about what is still pending. No phase
 * starts anything after the budget, and title searches stop at
 * `MAX_TITLE_SEARCHES`, in list order.
 */
export async function collectEvidence(
  rows: readonly EvidenceRow[],
  options: EvidenceOptions,
  d: EvidenceDeps,
): Promise<{ byEntry: Map<string, RowEvidence>; counts: EvidenceCounts }> {
  const started = d.now();
  const run = newRun(d, options, started);
  const byEntry = new Map<string, RowEvidence>();
  const ids: { row: EvidenceRow; id: WorkId }[] = [];
  const titles: { row: EvidenceRow; surname: string }[] = [];
  for (const row of rows) {
    const route = routeOf(row, options, run.checkedAt());
    if (route.kind === "done") byEntry.set(row.id, route.answer);
    else if (route.kind === "id") ids.push({ row, id: route.id });
    else if (titles.length < MAX_TITLE_SEARCHES) titles.push({ row, surname: route.surname });
    else byEntry.set(row.id, { state: "transient", why: "over-cap" });
  }
  const mayStart = () => d.now() < run.stopAt;

  /* Phase 1: every row to an answer, or to a confirmed id still without an abstract. */
  const [byId, byTitles] = await Promise.all([
    mapLimited(ids, EVIDENCE_CONCURRENCY, ({ row, id }) => guarded(row.id, run, () => byIdentifier(row, id, run)), mayStart),
    mapLimited(titles, EVIDENCE_CONCURRENCY, ({ row, surname }) => guarded(row.id, run, () => byTitle(row, surname, run)), mayStart),
  ]);
  const pending: { row: EvidenceRow; p: Pending }[] = [];
  for (const [queue, done] of [[ids, byId], [titles, byTitles]] as const) {
    for (const [i, { row }] of queue.entries()) {
      /* A row the budget did not start has no value: transient, asked next run. */
      const answer = done.values[i] ?? OVER_BUDGET;
      if (answer.state === "pending") pending.push({ row, p: answer });
      else byEntry.set(row.id, answer);
    }
  }

  const abstracts = await abstractsFor(pending, run, mayStart);
  for (const [i, { row }] of pending.entries()) byEntry.set(row.id, abstracts[i] ?? OVER_BUDGET);

  const outcomes: Record<string, number> = {};
  let evidence = 0;
  for (const answer of byEntry.values()) {
    const key = outcomeKey(answer);
    outcomes[key] = (outcomes[key] ?? 0) + 1;
    if (answer.state === "evidence") evidence++;
  }
  const counts: EvidenceCounts = {
    rows: rows.length,
    evidence,
    outcomes,
    titleQueries: run.titleQueries,
    openAlexTitleQueries: run.openAlexTitleQueries,
    openAlexQueries: run.openAlexQueries,
    semanticScholarQueries: run.semanticScholarQueries,
  };
  d.log.info({ ...counts, ms: d.now() - started, titleSearch: options.titleSearch, sources: run.sources }, "citation evidence");
  return { byEntry, counts };
}
