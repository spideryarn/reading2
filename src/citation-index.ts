/**
 * **Who cites this article, from OpenAlex** — a list and a count, with no model
 * anywhere in it. Debate's Reception draws it as *Cited by*.
 * docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md,
 * whose § GPT Sol's plan review is where most of the rules below come from.
 *
 * ```
 * a usable DOI on the article, or arXiv's for its arxiv.org address:
 *   a row fresher than 7 days ─────────────────────► that row, checked against the article
 *   else ask OpenAlex, each request in its own polite turn:
 *     1. works/doi:<doi>              404 ► not-indexed (remembered)
 *        its title and an author must be the article's, else ► unconfirmed (nothing stored)
 *     2. works?filter=cites:<W id>    most cited first, one page of 100
 *        too large ► once more with 25 ► too-large
 *     store the row and its list together, then answer
 * no DOI, and a distinctive title and an author (plan 261011q):
 *   0. works?search.title=<words>    every time; a failure ► unavailable
 *      exactly one record passes `titleMatchOf`, else ► no-match (nothing stored)
 *   then as above from step 2, the row keyed openalex:w<digits>, with no DOI asked
 * otherwise ───────────────────────────────────────► no-doi          (nothing asked)
 * ```
 *
 * **A title search is held to more than a DOI is.** A DOI is itself evidence,
 * so its record needs only the whole title and one author. A search has none,
 * so `titleMatchOf` wants the whole title, a second fact (two of the authors,
 * or one and the year within one), and no other record passing as well. The
 * year is never a veto alone: OpenAlex gives *Attention Is All You Need*
 * (2017) as 2025.
 *
 * **The DOI is checked before it is trusted, on every way out.** A mistyped DOI
 * resolves perfectly to somebody else's paper, and an article's DOI is not
 * always one a registry agreed (src/article-registry.ts keeps an existing DOI
 * when its lookup fails). So OpenAlex's record must carry this article's whole
 * title **and** one of its authors — the same two tests an import applies to
 * Crossref — and the cache keeps OpenAlex's title and authors so that a cache
 * hit and a stale fallback are checked exactly as a fresh answer is. Without
 * that, a second article carrying the DOI by mistake would be handed the first
 * one's citers.
 *
 * **OpenAlex is an outside party, and everything it sends is text.** Every
 * string goes through `plainRegistryText` with a bound, ids and DOIs are kept
 * only when they have the right shape, and no address in the answer is kept at
 * all: the panel builds its links itself (src/citer-link.ts).
 *
 * **A count is never kept without its list.** If the second request fails, the
 * whole lookup is `unavailable` and nothing is stored. When OpenAlex cannot be
 * reached and an older row exists, that row is served with its own date.
 *
 * **Politeness is the shared limiter's** (src/bibliographic.ts §
 * `inServiceTurn`, rows in `bibliographic_services`): one request in flight,
 * starts 500 ms apart, and a 429 or 503 cools the service for every instance.
 * No API key: anonymous access is 1,000 credits a day, the first request costs
 * none and the second one. There is no per-DOI claim, so two readers opening
 * the same paper in the same second may each spend that credit.
 *
 * ## What may be logged from this file
 *
 * The cache key (a DOI's `WorkId` or `openalex:w…`), the outcome and counts.
 * Never a title or an author, nor the search's address, which carries the
 * title: the article's are the reader's business, and OpenAlex's are a
 * stranger's string.
 */

import { registryAuthorIsOurs, registryIsThisArticle } from "./article-registry.js";
import {
  type ServiceLimiter,
  type WorkAuthor,
  type WorkId,
  coolAfter,
  doiFor,
  inServiceTurn,
  list,
  parseWorkId,
  plainRegistryText,
  plausibleYear,
  record,
} from "./bibliographic.js";
import { tokens } from "./citation-lookup.js";
import { registryTitleIsDistinctive } from "./citation-registry.js";
import { OPENALEX_WORK_ID } from "./citer-link.js";
import { doiPath } from "./doi-url.js";
import { FetchFailure, fetchBibliographicJson } from "./fetch.js";
import { log, type Log } from "./log.js";
import { CONTACT_EMAIL } from "./site-text.js";
import type { Citer, CitersResult, Meta } from "./types.js";

/* ------------------------------------------------------------ the policy -- */

/** How long an answer is an answer, found or not. Citations accrue; a week-old count is shown with its date. */
export const CITERS_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One page, most cited first. 39 citers measured 141 KB, because every author
 * comes with their affiliations and `select` cannot trim inside a field — so
 * 200 could pass the fetcher's megabyte and 100 usually will not.
 */
export const CITERS_PER_PAGE = 100;
/** The page asked for when the first was too large to read. */
export const CITERS_PER_PAGE_SMALL = 25;

const MAX_AUTHORS = 20;
const MAX_NAME = 200;
const MAX_VENUE = 300;
const MAX_KIND = 40;

/* ------------------------------------------------------------- the types -- */

/**
 * What this needs to know about the article: the DOI to ask about, and the
 * title and authors to check the answer against. **The title is the one the
 * article was imported with, never a reader's rename**, which would fail a
 * correct DOI (the route reads it with `loadArticleIdentity`).
 */
export type ArticleIdentity = Pick<Meta, "title" | "byline" | "authors" | "doi" | "url" | "publishedAt" | "publishedYear">;

/**
 * **What a list is cached under**: a DOI's `WorkId`, or OpenAlex's own id for a
 * work found by title, lower-cased (`openalex:w2626778328`), which is the shape
 * `citation_index_lookups_work_id` accepts.
 */
export type CitersKey = WorkId | `openalex:w${string}`;

/**
 * **The DOI to ask about**: the article's own usable DOI, or else the one its own address
 * names — an arxiv.org page, whose DOI is arXiv's at DataCite (`doiFor`).
 *
 * The address is the fallback for articles imported before an agreed arXiv
 * record put its DOI on the article (plan 261010n, report spya-sbj3yk): until
 * then every arXiv paper said "no DOI". It is no looser than `meta.doi`, because
 * the answer is checked against the title and an author on every way out.
 */
export function citersIdOf(article: ArticleIdentity): WorkId | null {
  /* Only a usable DOI has precedence. A legacy or hand-edited non-DOI value
     must not hide the valid arXiv address underneath it. */
  const own = article.doi ? parseWorkId(article.doi) : null;
  if (own?.startsWith("doi:")) return own;
  /* Only an arXiv page: the gap this closes is arXiv's, and an address that is a
     DOI's own (doi.org) gets its DOI put on the article at import (GPT Sol's F4). */
  const named = article.url ? parseWorkId(article.url) : null;
  return named?.startsWith("arxiv:") ? parseWorkId(doiFor(named)) : null;
}

/** The work a DOI resolves to at OpenAlex, in OpenAlex's own words. */
export interface CitedTarget {
  openalexId: string;
  /** Null when OpenAlex holds the work with no title, which nothing can be confirmed against. */
  title: string | null;
  /** Display names, at most 20. */
  authors: string[];
}

/** A parsed page of citers: OpenAlex's count, how many records came, how many we could not show. */
export interface CitersPage {
  count: number;
  returned: number;
  dropped: number;
  citers: Citer[];
}

/** What is remembered: an answer, never an error. */
export type FetchedCiters =
  | { kind: "not-indexed" }
  | ({ kind: "found"; target: CitedTarget & { title: string }; capped: boolean } & CitersPage);

/** A remembered answer, with when OpenAlex gave it and whether it is still fresh. */
export type StoredCiters = FetchedCiters & { fetchedAt: string; fresh: boolean };

/**
 * What `citersOf` needs from the database. src/store/pg-citation-index.ts is
 * the real one; tests hand in their own.
 */
export interface CitationIndexStore {
  /** The row for this DOI, fresh or not — or null. */
  read(id: CitersKey, freshMs: number): Promise<StoredCiters | null>;
  /** Replace the row and its list together. Returns when the database says it was fetched, ISO. */
  write(id: CitersKey, answer: FetchedCiters): Promise<string>;
}

export interface CitersDeps {
  store?: CitationIndexStore;
  limiter?: ServiceLimiter;
  fetchJson?: (url: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  log?: Log;
}

/* --------------------------------------------------------- the addresses -- */

const WORK_FIELDS = "id,doi,title,publication_year,cited_by_count,authorships";
const CITER_FIELDS = "id,doi,display_name,publication_year,cited_by_count,authorships,primary_location,type";

/** OpenAlex's record for a DOI. `mailto` is how it asks to be told who is calling, as Crossref does. */
export function openAlexWorkUrl(doi: string): string {
  return `https://api.openalex.org/works/doi:${doiPath(doi)}?select=${WORK_FIELDS}&mailto=${encodeURIComponent(CONTACT_EMAIL)}`;
}

/** The works that cite one OpenAlex id, most cited first, one page. */
export function openAlexCitersUrl(openalexId: string, perPage: number): string {
  return (
    `https://api.openalex.org/works?filter=cites:${encodeURIComponent(openalexId)}` +
    `&sort=cited_by_count:desc&per-page=${perPage}&select=${CITER_FIELDS}&mailto=${encodeURIComponent(CONTACT_EMAIL)}`
  );
}

/** How many records a title search reads. Ten: the exact title ranks near the top, and a page costs the same. */
export const TITLE_SEARCH_RESULTS = 10;
/** The longest query sent, in characters, cut at a word. */
const MAX_TITLE_QUERY = 300;
const SEARCH_FIELDS = "id,display_name,publication_year,authorships";

/**
 * **The words of a title, and nothing else**, as one lower-cased line for
 * `search.title` — or null when there are none. Lower case keeps OpenAlex's
 * `AND`, `OR` and `NOT` from being read as operators, and the punctuation goes
 * with `tokens`, the same split the title check uses.
 */
export function titleQueryOf(title: string): string | null {
  let query = "";
  for (const word of tokens(title)) {
    const next = query === "" ? word : `${query} ${word}`;
    if (next.length > MAX_TITLE_QUERY) break;
    query = next;
  }
  return query === "" ? null : query;
}

/** OpenAlex's works whose title has these words. A search parameter, not a `filter=`, so nothing in it can add one. */
export function openAlexTitleSearchUrl(query: string): string {
  const params = new URLSearchParams({
    "search.title": query,
    per_page: String(TITLE_SEARCH_RESULTS),
    select: SEARCH_FIELDS,
    mailto: CONTACT_EMAIL,
  });
  return `https://api.openalex.org/works?${params.toString()}`;
}

/* ------------------------------------------------------------ the parsing -- */

/** `https://openalex.org/W4399223951`, or the bare id, as `W4399223951` — or null. */
function workIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().replace(/^https:\/\/openalex\.org\//i, "");
  return OPENALEX_WORK_ID.test(id) ? id : null;
}

/** OpenAlex's `doi` (a `doi.org` address) as a bare lower-cased DOI, through the one parser of identifiers. */
function doiOf(value: unknown): string | undefined {
  const id = typeof value === "string" ? parseWorkId(value) : null;
  return id?.startsWith("doi:") ? id.slice("doi:".length) : undefined;
}

/** The display names in an `authorships` list, plain and bounded, and how many authorships there were. */
function authorsOf(value: unknown): { names: string[]; count: number } {
  const all = list(value);
  const names: string[] = [];
  for (const raw of all) {
    const name = plainRegistryText(record(record(raw)?.author)?.display_name, MAX_NAME);
    if (name !== null) names.push(name);
    if (names.length === MAX_AUTHORS) break;
  }
  return { names, count: Math.max(all.length, names.length) };
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** `works/doi:<doi>` as the work it names — or null when the answer has no usable id. */
export function parseOpenAlexWork(json: unknown): CitedTarget | null {
  const work = record(json);
  const openalexId = workIdOf(work?.id);
  if (work === null || openalexId === null) return null;
  return { openalexId, title: plainRegistryText(work.title), authors: authorsOf(work.authorships).names };
}

/**
 * One page of `works?filter=cites:…` — or null when it is not that shape.
 *
 * A record is dropped, and counted, when it has no title, when its id is not a
 * `W` id, or when its id or its DOI was already seen (first sighting kept). A
 * malformed DOI drops only the DOI. Nothing else in a record is read, so no
 * address in it can reach the page.
 */
export function parseOpenAlexCiters(json: unknown): CitersPage | null {
  const body = record(json);
  const total = count(record(body?.meta)?.count);
  if (body === null || total === null || !Array.isArray(body.results)) return null;
  const citers: Citer[] = [];
  const seenIds = new Set<string>();
  const seenDois = new Set<string>();
  for (const raw of body.results) {
    const work = record(raw);
    const openalexId = workIdOf(work?.id);
    const title = plainRegistryText(work?.display_name);
    if (work === null || openalexId === null || title === null) continue;
    const doi = doiOf(work.doi);
    if (seenIds.has(openalexId) || (doi !== undefined && seenDois.has(doi))) continue;
    seenIds.add(openalexId);
    if (doi !== undefined) seenDois.add(doi);
    const authors = authorsOf(work.authorships);
    const year = plausibleYear(work.publication_year);
    const venue = plainRegistryText(record(record(work.primary_location)?.source)?.display_name, MAX_VENUE);
    const kind = plainRegistryText(work.type, MAX_KIND);
    citers.push({
      openalexId,
      ...(doi !== undefined ? { doi } : {}),
      title,
      authors: authors.names,
      authorCount: authors.count,
      ...(year !== undefined ? { year } : {}),
      ...(venue !== null ? { venue } : {}),
      ...(kind !== null ? { kind } : {}),
      citedByCount: count(work.cited_by_count) ?? 0,
    });
  }
  return { count: total, returned: body.results.length, dropped: body.results.length - citers.length, citers };
}

/**
 * **OpenAlex's display names, in the shape `registryAuthorIsOurs` reads.**
 * Recognise a trailing generational suffix and explicit `Family, Given`
 * order before falling back to the last word as family name. For long names,
 * also try compound family endings: the shared check only looks three words
 * before the family, so a last-word split alone loses the first given name.
 * Each candidate retains the final surname and the first given name.
 */
export function openAlexAuthors(names: readonly string[]): WorkAuthor[] {
  const authors: WorkAuthor[] = [];
  for (const name of names) {
    const core = name.trim().replace(/(?:,?\s+)(?:jr\.?|sr\.?|ii|iii|iv)$/i, "").trim();
    const comma = core.indexOf(",");
    if (comma > 0) {
      const family = core.slice(0, comma).trim();
      const given = core.slice(comma + 1).trim();
      if (given) {
        authors.push({ family, given });
        continue;
      }
    }
    const words = core.split(/\s+/).filter((w) => w !== "");
    const family = words.pop();
    if (family === undefined) continue;
    authors.push(words.length > 0 ? { family, given: words.join(" ") } : { family });
    if (words.length > 3) {
      for (let at = 1; at < words.length; at++) {
        authors.push({ family: [...words.slice(at), family].join(" "), given: words.slice(0, at).join(" ") });
      }
    }
  }
  return authors;
}

/** The whole title and one author agree. With no title on OpenAlex's side, or no author on ours, they cannot. */
function isThisArticle(article: ArticleIdentity, target: CitedTarget): target is CitedTarget & { title: string } {
  return (
    target.title !== null &&
    registryIsThisArticle(article.title, target.title) &&
    registryAuthorIsOurs(article, openAlexAuthors(target.authors))
  );
}

/** The article's year: `publishedYear`, or the year of `publishedAt` — or undefined. */
function articleYear(article: ArticleIdentity): number | undefined {
  return article.publishedYear ?? plausibleYear(/^\d{4}/.exec(article.publishedAt ?? "")?.[0]);
}

/** Whether two OpenAlex display names could be two spellings of one person. */
function sameNamedPerson(one: string, two: string): boolean {
  const folded = (value: string) => tokens(value.normalize("NFD").replace(/\p{M}+/gu, "")).join(" ");
  const variants = (value: string) => openAlexAuthors([value]).map((author) => ({
    family: folded(author.family),
    given: tokens((author.given ?? "").normalize("NFD").replace(/\p{M}+/gu, ""))[0] ?? "",
  }));
  return variants(one).some((a) => variants(two).some((b) => {
    if (a.family === "" || a.family !== b.family) return false;
    /* A missing given name cannot prove these are different people. An
       initial and its expansion are the same identity for the same reason
       `registryAuthorIsOurs` accepts either as corroboration. */
    return a.given === "" || b.given === "" || a.given === b.given ||
      ((a.given.length === 1 || b.given.length === 1) && a.given[0] === b.given[0]);
  }));
}

/**
 * **How many different people among OpenAlex's names are ours**, each tested
 * on its own. Duplicate spellings of one person (including an initial beside
 * the full given name) count once: two strings are not two corroborating facts.
 */
function agreeingAuthors(article: ArticleIdentity, names: readonly string[]): number {
  const seen: string[] = [];
  for (const name of names) {
    if (tokens(name).length === 0 || seen.some((prior) => sameNamedPerson(prior, name))) continue;
    if (registryAuthorIsOurs(article, openAlexAuthors([name]))) seen.push(name);
  }
  return seen.length;
}

/** What a title search found: the one work that passes, or none. */
export type TitleMatch = { kind: "match"; target: CitedTarget & { title: string } } | { kind: "none" };

/**
 * **The one record in a title search that is this article** — see the header.
 * Null when the answer is not a search's. Each record passes only with the
 * whole title, and two of its authors among ours or one and the year within
 * one; two different passing works are `none`, because nothing here can tell
 * which is right.
 */
export function titleMatchOf(article: ArticleIdentity, json: unknown): TitleMatch | null {
  const body = record(json);
  if (body === null || !Array.isArray(body.results)) return null;
  const year = articleYear(article);
  const passing = new Map<string, CitedTarget & { title: string }>();
  for (const raw of body.results) {
    const work = record(raw);
    const openalexId = workIdOf(work?.id);
    const title = plainRegistryText(work?.display_name);
    if (work === null || openalexId === null || title === null) continue;
    if (!registryIsThisArticle(article.title, title)) continue;
    const authors = authorsOf(work.authorships).names;
    const agreeing = agreeingAuthors(article, authors);
    const theirYear = plausibleYear(work.publication_year);
    const yearAgrees = year !== undefined && theirYear !== undefined && Math.abs(year - theirYear) <= 1;
    if (agreeing >= 2 || (agreeing === 1 && yearAgrees)) passing.set(openalexId, { openalexId, title, authors });
  }
  const [only, ...more] = passing.values();
  return only !== undefined && more.length === 0 ? { kind: "match", target: only } : { kind: "none" };
}

/** Whether a title search may be made at all: a title that can be told apart, and an author to check. */
function searchableTitle(article: ArticleIdentity): string | null {
  const hasAuthor = (article.byline ?? "").trim() !== "" || (article.authors ?? []).length > 0;
  return hasAuthor && registryTitleIsDistinctive(article.title) ? titleQueryOf(article.title) : null;
}

/* ------------------------------------------------------------ the lookup -- */

interface Resolved {
  store: CitationIndexStore;
  limiter: ServiceLimiter;
  fetchJson: (url: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  log: Log;
}

async function resolveDeps(deps: CitersDeps): Promise<Resolved> {
  /* The Postgres stores are loaded only when nobody handed one in, so a test of
     the parsing or the orchestration never opens a database connection. */
  return {
    store: deps.store ?? (await import("./store/pg-citation-index.js")).pgCitationIndexStore,
    limiter: deps.limiter ?? (await import("./store/pg-bibliographic.js")).pgBibliographicStore,
    fetchJson: deps.fetchJson ?? ((url) => fetchBibliographicJson(url)),
    sleep: deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    log: deps.log ?? log("store").child({ lookup: "citation-index" }),
  };
}

/** One request, in its turn: the JSON, or the one-word reason there is none. */
type Got = { kind: "json"; json: unknown } | { kind: "missing" | "too-large" | "unavailable" };

/** `id` is what the log names: the cache key, or `title` for a search, whose address is never logged. */
async function get(id: CitersKey | "title", what: "work" | "citers" | "search", url: string, d: Resolved): Promise<Got> {
  const turn = await inServiceTurn("openalex", { store: d.limiter, sleep: d.sleep }, async (waitMs): Promise<Got> => {
    const started = Date.now();
    try {
      return { kind: "json", json: await d.fetchJson(url) };
    } catch (err) {
      if (!(err instanceof FetchFailure)) throw err;
      const fields = { id, what, status: err.status, code: err.code, ms: Date.now() - started, waitMs };
      if (err.status === 404 || err.status === 410) return { kind: "missing" };
      if (err.code === "too-large") {
        d.log.warn({ ...fields, outcome: "too-large" }, "citation index request");
        return { kind: "too-large" };
      }
      const cooldownMs = await coolAfter(err, "openalex", d.limiter);
      d.log.warn(
        { ...fields, outcome: cooldownMs !== null ? "cooling-down" : "error", ...(cooldownMs !== null ? { cooldownMs } : {}) },
        "citation index request",
      );
      return { kind: "unavailable" };
    }
  });
  if (turn.kind === "ran") return turn.value;
  d.log.info({ id, what, outcome: turn.why, at: turn.at }, "citation index request");
  return { kind: "unavailable" };
}

/** A work confirmed to be this article's, whose list may be asked for. */
type Confirmed = CitedTarget & { title: string };

/** What a fresh ask comes back with: something to remember, or one of the three answers that store nothing. */
type Asked = FetchedCiters | { kind: "unconfirmed" | "unavailable" | "too-large" };

/** Step 1, for a DOI: the work it resolves to, which must be this article's before its list is asked for. */
async function askWork(id: WorkId, article: ArticleIdentity, d: Resolved): Promise<Asked | { kind: "confirmed"; target: Confirmed }> {
  const doi = id.slice("doi:".length);
  const first = await get(id, "work", openAlexWorkUrl(doi), d);
  if (first.kind === "missing") return { kind: "not-indexed" };
  if (first.kind === "too-large") return { kind: "too-large" };
  if (first.kind !== "json") return { kind: "unavailable" };
  const target = parseOpenAlexWork(first.json);
  if (target === null) return { kind: "unavailable" };
  /* Before the second request, so a DOI that is not this article's costs
     OpenAlex nothing more and can never have a list fetched for it. */
  return isThisArticle(article, target) ? { kind: "confirmed", target } : { kind: "unconfirmed" };
}

/** Step 2: the works that cite a confirmed target, one page. */
async function askCiters(key: CitersKey, target: Confirmed, d: Resolved): Promise<Asked> {
  let second = await get(key, "citers", openAlexCitersUrl(target.openalexId, CITERS_PER_PAGE), d);
  /* The same request would be too large every time, so a retry of it is no
     use. A shorter page may fit, and is listed as what it is. */
  if (second.kind === "too-large") {
    second = await get(key, "citers", openAlexCitersUrl(target.openalexId, CITERS_PER_PAGE_SMALL), d);
    if (second.kind === "too-large") return { kind: "too-large" };
  }
  /* A 404 here would be OpenAlex denying a work it has just described. */
  if (second.kind !== "json") return { kind: "unavailable" };
  const page = parseOpenAlexCiters(second.json);
  if (page === null) return { kind: "unavailable" };
  return { kind: "found", target, ...page, capped: page.count > page.returned };
}

/** Step 0, for an article with no DOI: the one OpenAlex work its title and authors pick out. */
async function searchByTitle(
  query: string,
  article: ArticleIdentity,
  d: Resolved,
): Promise<{ kind: "match"; key: CitersKey; target: Confirmed } | { kind: "no-match" | "unavailable" }> {
  const got = await get("title", "search", openAlexTitleSearchUrl(query), d);
  /* A search has no 404 of its own: a missing answer is a broken one. */
  if (got.kind !== "json") return { kind: "unavailable" };
  const match = titleMatchOf(article, got.json);
  if (match === null) return { kind: "unavailable" };
  if (match.kind === "none") return { kind: "no-match" };
  return { kind: "match", key: `openalex:${match.target.openalexId.toLowerCase()}` as CitersKey, target: match.target };
}

/** How the list was reached. The panel says so when it was by title. */
type Via = Extract<CitersResult, { kind: "found" }>["via"];

/** A remembered answer, as this article may see it. */
function answerFor(article: ArticleIdentity, stored: FetchedCiters, fetchedAt: string, via: Via): CitersResult {
  if (stored.kind === "not-indexed") return { kind: "not-indexed" };
  if (!isThisArticle(article, stored.target)) return { kind: "unconfirmed" };
  return {
    kind: "found",
    via,
    target: { openalexId: stored.target.openalexId, title: stored.target.title },
    count: stored.count,
    returned: stored.returned,
    dropped: stored.dropped,
    capped: stored.capped,
    citers: stored.citers,
    fetchedAt,
  };
}

/** Where the list is, and how it was reached: by the DOI, or by a title search that has already confirmed its work. */
type Route =
  | { via: "doi"; key: WorkId }
  | { via: "title"; key: CitersKey; target: Confirmed };

/**
 * **The papers that cite this article** — see the header for the whole path.
 * Never throws for anything OpenAlex or the database does: both are
 * `unavailable`.
 */
export async function citersOf(article: ArticleIdentity, deps: CitersDeps = {}): Promise<CitersResult> {
  const id = citersIdOf(article);
  const query = id === null ? searchableTitle(article) : null;
  if (id === null && query === null) return { kind: "no-doi" };
  let d: Resolved;
  try {
    d = await resolveDeps(deps);
  } catch {
    /* There may be no logger yet, and an import or dependency error's message
       may contain a database parameter. The public outcome is still usable. */
    return { kind: "unavailable" };
  }
  const started = Date.now();
  const done = (key: CitersKey | "title", result: CitersResult, from: "cache" | "openalex" | "stale"): CitersResult => {
    d.log.info(
      {
        id: key,
        outcome: result.kind,
        from,
        ms: Date.now() - started,
        ...(result.kind === "found"
          ? { via: result.via, count: result.count, returned: result.returned, dropped: result.dropped, capped: result.capped }
          : {}),
      },
      "citation index lookup",
    );
    return result;
  };
  try {
    let route: Route;
    if (id !== null) {
      route = { via: "doi", key: id };
    } else {
      /* The search is made on every open; only the list it leads to is cached.
         A cache keyed on titles and authors is neither anonymous nor safe to
         share between articles (plan 261011q, GPT Sol's F3 and F7). */
      const searched = await searchByTitle(query ?? "", article, d);
      if (searched.kind !== "match") return done("title", { kind: searched.kind }, "openalex");
      route = { via: "title", key: searched.key, target: searched.target };
    }

    const stored = await d.store.read(route.key, CITERS_FRESH_MS);
    if (stored?.fresh) return done(route.key, answerFor(article, stored, stored.fetchedAt, route.via), "cache");

    let asked: Asked;
    if (route.via === "title") {
      asked = await askCiters(route.key, route.target, d);
    } else {
      const work = await askWork(route.key, article, d);
      asked = work.kind === "confirmed" ? await askCiters(route.key, work.target, d) : work;
    }
    if (asked.kind === "found" || asked.kind === "not-indexed") {
      const fetchedAt = await d.store.write(route.key, asked);
      return done(route.key, answerFor(article, asked, fetchedAt, route.via), "openalex");
    }
    /* OpenAlex could not be read, and an older list exists: serve it, with its
       own date, if it is still this article's. Not after `unconfirmed` — that
       is OpenAlex answering, and saying something else. */
    if (asked.kind !== "unconfirmed" && stored?.kind === "found") {
      const stale = answerFor(article, stored, stored.fetchedAt, route.via);
      if (stale.kind === "found") return done(route.key, stale, "stale");
    }
    return done(route.key, { kind: asked.kind }, "openalex");
  } catch {
    /* Error messages from a fetch seam can contain its whole URL, and database
       errors can include the title/authors being written. This module's log
       contract permits neither, so record only bounded, non-content fields. */
    d.log.error({ id: id ?? "title", outcome: "internal-error", ms: Date.now() - started }, "citation index lookup failed");
    return { kind: "unavailable" };
  }
}
