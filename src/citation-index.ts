/**
 * **Who cites this article, from OpenAlex** — a list and a count, with no model
 * anywhere in it. Debate's Reception draws it as *Cited by*.
 * docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md,
 * whose § GPT Sol's plan review is where most of the rules below come from.
 *
 * ```
 * no DOI on the article ───────────────────────────► no-doi          (nothing asked)
 * a row fresher than 7 days ───────────────────────► that row, checked against the article
 * else ask OpenAlex, each request in its own polite turn:
 *   1. works/doi:<doi>              404 ► not-indexed (remembered)
 *      its title and an author must be the article's, else ► unconfirmed (nothing stored)
 *   2. works?filter=cites:<W id>    most cited first, one page of 100
 *      too large ► once more with 25 ► too-large
 *   store the row and its list together, then answer
 * ```
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
 * The DOI's `WorkId`, the outcome and counts. Never a title or an author: the
 * article's are the reader's business, and OpenAlex's are a stranger's string.
 */

import { registryAuthorIsOurs, registryIsThisArticle } from "./article-registry.js";
import {
  type ServiceLimiter,
  type WorkAuthor,
  type WorkId,
  coolAfter,
  doiPath,
  inServiceTurn,
  list,
  parseWorkId,
  plainRegistryText,
  plausibleYear,
  record,
} from "./bibliographic.js";
import { OPENALEX_WORK_ID } from "./citer-link.js";
import { FetchFailure, fetchBibliographicJson } from "./fetch.js";
import { errorFields, log, type Log } from "./log.js";
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
export type ArticleIdentity = Pick<Meta, "title" | "byline" | "authors" | "doi">;

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
  read(id: WorkId, freshMs: number): Promise<StoredCiters | null>;
  /** Replace the row and its list together. Returns when the database says it was fetched, ISO. */
  write(id: WorkId, answer: FetchedCiters): Promise<string>;
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
 * **OpenAlex's display names, in the shape `registryAuthorIsOurs` reads.** It
 * prints a name given-first (`Michael G. Levin`), so the last word is the
 * family name and the rest the given names; a single word is a family name
 * alone. A two-word family name (`van Gelder`) still agrees, because the check
 * looks for the given name among the words before the family name.
 */
export function openAlexAuthors(names: readonly string[]): WorkAuthor[] {
  const authors: WorkAuthor[] = [];
  for (const name of names) {
    const words = name.trim().split(/\s+/).filter((w) => w !== "");
    const family = words.pop();
    if (family === undefined) continue;
    authors.push(words.length > 0 ? { family, given: words.join(" ") } : { family });
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

async function get(id: WorkId, what: "work" | "citers", url: string, d: Resolved): Promise<Got> {
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

/** What a fresh ask comes back with: something to remember, or one of the three answers that store nothing. */
type Asked = FetchedCiters | { kind: "unconfirmed" | "unavailable" | "too-large" };

async function ask(id: WorkId, article: ArticleIdentity, d: Resolved): Promise<Asked> {
  const doi = id.slice("doi:".length);
  const first = await get(id, "work", openAlexWorkUrl(doi), d);
  if (first.kind === "missing") return { kind: "not-indexed" };
  if (first.kind !== "json") return { kind: "unavailable" };
  const target = parseOpenAlexWork(first.json);
  if (target === null) return { kind: "unavailable" };
  /* Before the second request, so a DOI that is not this article's costs
     OpenAlex nothing more and can never have a list fetched for it. */
  if (!isThisArticle(article, target)) return { kind: "unconfirmed" };

  let second = await get(id, "citers", openAlexCitersUrl(target.openalexId, CITERS_PER_PAGE), d);
  /* The same request would be too large every time, so a retry of it is no
     use. A shorter page may fit, and is listed as what it is. */
  if (second.kind === "too-large") {
    second = await get(id, "citers", openAlexCitersUrl(target.openalexId, CITERS_PER_PAGE_SMALL), d);
    if (second.kind === "too-large") return { kind: "too-large" };
  }
  /* A 404 here would be OpenAlex denying a work it has just described. */
  if (second.kind !== "json") return { kind: "unavailable" };
  const page = parseOpenAlexCiters(second.json);
  if (page === null) return { kind: "unavailable" };
  return { kind: "found", target, ...page, capped: page.count > page.returned };
}

/** A remembered answer, as this article may see it. */
function answerFor(article: ArticleIdentity, stored: FetchedCiters, fetchedAt: string): CitersResult {
  if (stored.kind === "not-indexed") return { kind: "not-indexed" };
  if (!isThisArticle(article, stored.target)) return { kind: "unconfirmed" };
  return {
    kind: "found",
    count: stored.count,
    returned: stored.returned,
    dropped: stored.dropped,
    capped: stored.capped,
    citers: stored.citers,
    fetchedAt,
  };
}

/**
 * **The papers that cite this article** — see the header for the whole path.
 * Never throws for anything OpenAlex or the database does: both are
 * `unavailable`.
 */
export async function citersOf(article: ArticleIdentity, deps: CitersDeps = {}): Promise<CitersResult> {
  const id = article.doi ? parseWorkId(article.doi) : null;
  /* An arXiv id is not asked about: OpenAlex is asked by DOI, and an agreed
     arXiv record does not put a DOI on the article today. */
  if (id === null || !id.startsWith("doi:")) return { kind: "no-doi" };
  const d = await resolveDeps(deps);
  const started = Date.now();
  const done = (result: CitersResult, from: "cache" | "openalex" | "stale"): CitersResult => {
    d.log.info(
      {
        id,
        outcome: result.kind,
        from,
        ms: Date.now() - started,
        ...(result.kind === "found"
          ? { count: result.count, returned: result.returned, dropped: result.dropped, capped: result.capped }
          : {}),
      },
      "citation index lookup",
    );
    return result;
  };
  try {
    const stored = await d.store.read(id, CITERS_FRESH_MS);
    if (stored?.fresh) return done(answerFor(article, stored, stored.fetchedAt), "cache");

    const asked = await ask(id, article, d);
    if (asked.kind === "found" || asked.kind === "not-indexed") {
      const fetchedAt = await d.store.write(id, asked);
      return done(answerFor(article, asked, fetchedAt), "openalex");
    }
    /* OpenAlex could not be read, and an older list exists: serve it, with its
       own date, if it is still this article's. Not after `unconfirmed` — that
       is OpenAlex answering, and saying something else. */
    if (asked.kind !== "unconfirmed" && stored?.kind === "found") {
      const stale = answerFor(article, stored, stored.fetchedAt);
      if (stale.kind === "found") return done(stale, "stale");
    }
    return done({ kind: asked.kind }, "openalex");
  } catch (err) {
    d.log.error({ id, outcome: "store", ms: Date.now() - started, ...errorFields(err) }, "citation index lookup failed");
    return { kind: "unavailable" };
  }
}
