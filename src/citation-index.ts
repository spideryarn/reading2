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
 *        its title and an author must be the article's, with the bounded arXiv exception below,
 *        else ► unconfirmed (nothing stored)
 *     2. works?filter=cites:<W id>    most cited first, one page of 100
 *        too large ► once more with 25 ► too-large
 *     store the row and its list together, then answer
 * no DOI, and a distinctive title and an author (plan 261011q):
 *   0. works?search.title=<words>    every time; a failure ► unavailable
 *      exactly one work passes `titleMatchOf` — one record, or twins — else ► no-match
 *   then as above from step 2, the row keyed openalex:w<digits>[|w<digits>…], with no DOI asked
 * otherwise ───────────────────────────────────────► no-doi          (nothing asked)
 * a list of more than TOPIC_MIN_CITERS whose work has a keyword says `topic: { keyword }`;
 * and only on ?about=topic:
 *   3. works?filter=cites:<ids>&search.title_and_abstract="<keyword>"
 *      its own row, keyed <key>#topic; a failure ► the plain list
 * ```
 *
 * **A title search is held to more than a DOI is.** A DOI is itself evidence,
 * so its record needs only the whole title and one author. A search has none,
 * so `titleMatchOf` wants the whole title, a second fact (two of the authors,
 * or one and the year within one), and no other work passing as well. The
 * year is never a veto alone: OpenAlex gives *Attention Is All You Need*
 * (2017) as 2025.
 *
 * **Twins are one work** (plan 261025h, decision 2; GPT Sol's F9). OpenAlex
 * holds *The Extended Mind* twice, W393180982 and W4239232206, and a rule that
 * refused every second passing record gave a landmark no citers at all. Records
 * that each pass, share the whole title, each carry two of the piece's authors
 * (all of them when it has fewer than two) and two of one another's, and whose
 * years are within one, are joined: the target names the first and lists the
 * others in `alsoHeldAs`, and the citers are asked with OpenAlex's union
 * filter, `cites:W1|W2`, so the count and the rows are OpenAlex's own for the
 * union rather than a sum we made. Any other second passing record is still
 * `no-match`: the most cited is not evidence of which is right.
 *
 * **The topic view** (decision 10; F15). For a landmark, the most-cited citers
 * cite it in passing (investigation 261025a § 5). When a work has more than
 * `TOPIC_MIN_CITERS` citers and OpenAlex gives it a keyword, the list offers a
 * second view, the citers whose title or abstract has that keyword, which the
 * reader chooses. That list is asked for only when chosen (`about: "topic"`;
 * GPT Sol's S1-F5), kept as a row of its own, and its count shown on the plain
 * list once it is known. The keyword is OpenAlex's own, never a model's, and
 * nothing of the article is sent for it.
 *
 * **The DOI is checked before it is trusted, on every way out.** A mistyped DOI
 * resolves perfectly to somebody else's paper, and an article's DOI is not
 * always one a registry agreed (src/article-registry.ts keeps an existing DOI
 * when its lookup fails). So OpenAlex's record must carry this article's whole
 * title **and** one of its authors — the same two tests an import applies to
 * Crossref — and the cache keeps OpenAlex's title and authors so that a cache
 * hit and a stale fallback are checked exactly as a fresh answer is. Without
 * that, a second article carrying the DOI by mistake would be handed the first
 * one's citers. **One exception, for the arXiv DOI named by the article's own
 * arXiv address**: two distinct structured author matches stand in for the title,
 * because arXiv retitles between versions and OpenAlex has given one arXiv
 * record a merged deposit's title (`isThisArticle`).
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

/**
 * **More citers than this, and the list offers its topic view.** A heuristic
 * from four pieces (investigation 261025a § 5), not a validated boundary: the
 * keyword gave two landmarks their debate and cost a 196-citer paper its two
 * best citers. Above it the second view is offered, never applied (decision 10).
 */
export const TOPIC_MIN_CITERS = 1000;

/** At most this many OpenAlex records are joined as one work. More is not twins; it is a muddle. */
export const MAX_TWINS = 4;

/** The longest keyword kept, in characters. OpenAlex's run to three or four words. */
const MAX_KEYWORD = 100;

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
 * work found by title, lower-cased (`openalex:w2626778328`) — every joined
 * record's, ascending and `|`-separated, for twins
 * (`openalex:w393180982|w4239232206`), so the key says which records were
 * joined — and either with `#topic` for the topic view's list. The shapes
 * `citation_index_lookups_work_id` accepts.
 */
export type BaseCitersKey = WorkId | `openalex:w${string}`;
export type CitersKey = BaseCitersKey | `${BaseCitersKey}#topic`;

/** The key a title search's work is cached under: every record's id, lower-cased, ascending. */
function titleKeyOf(target: Pick<CitedTarget, "openalexId" | "alsoHeldAs">): BaseCitersKey {
  const ids = [target.openalexId, ...(target.alsoHeldAs ?? [])]
    .map((id) => id.toLowerCase())
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return `openalex:${ids.join("|")}` as BaseCitersKey;
}

/** The prefix of every DOI arXiv mints, as `parseWorkId` writes it: lower case. */
const ARXIV_DOI = "doi:10.48550/arxiv.";

/** The arXiv DOI independently named by the article's own arxiv.org address. */
function arxivDoiAtAddress(article: ArticleIdentity): WorkId | null {
  const named = article.url ? parseWorkId(article.url) : null;
  return named?.startsWith("arxiv:") ? parseWorkId(doiFor(named)) : null;
}

/**
 * **The DOI to ask about**: the article's own usable DOI, or else the one its own address
 * names — an arxiv.org page, whose DOI is arXiv's at DataCite (`doiFor`).
 *
 * The address is the fallback for articles imported before an agreed arXiv
 * record put its DOI on the article (plan 261010n, report spya-sbj3yk): until
 * then every arXiv paper said "no DOI". The answer is checked against the
 * article on every way out; `isThisArticle` owns the exact evidence required.
 */
export function citersIdOf(article: ArticleIdentity): WorkId | null {
  /* Only a usable DOI has precedence. A legacy or hand-edited non-DOI value
     must not hide the valid arXiv address underneath it. */
  const own = article.doi ? parseWorkId(article.doi) : null;
  if (own?.startsWith("doi:")) return own;
  /* Only an arXiv page: the gap this closes is arXiv's, and an address that is a
     DOI's own (doi.org) gets its DOI put on the article at import (GPT Sol's F4). */
  return arxivDoiAtAddress(article);
}

/** The work a DOI resolves to at OpenAlex, in OpenAlex's own words. */
export interface CitedTarget {
  openalexId: string;
  /**
   * The other records of the same work, joined as twins (`titleMatchOf`), `W…`
   * each. Absent for one record, and always for a DOI's: a DOI names one.
   */
  alsoHeldAs?: string[];
  /** Null when OpenAlex holds the work with no title, which nothing can be confirmed against. */
  title: string | null;
  /** Display names, at most 20. */
  authors: string[];
  /** OpenAlex's top keyword for the work, plain and bounded. Absent when it gives none. */
  keyword?: string;
}

/** Every record whose citers the list is, for `cites:`: the target, then its twins, `|` meaning or. */
export function citedIds(target: Pick<CitedTarget, "openalexId" | "alsoHeldAs">): string {
  return [target.openalexId, ...(target.alsoHeldAs ?? [])].join("|");
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

const WORK_FIELDS = "id,doi,title,publication_year,cited_by_count,authorships,keywords";
const CITER_FIELDS = "id,doi,display_name,publication_year,cited_by_count,authorships,primary_location,type";

/** OpenAlex's record for a DOI. `mailto` is how it asks to be told who is calling, as Crossref does. */
export function openAlexWorkUrl(doi: string): string {
  return `https://api.openalex.org/works/doi:${doiPath(doi)}?select=${WORK_FIELDS}&mailto=${encodeURIComponent(CONTACT_EMAIL)}`;
}

/**
 * The works that cite these OpenAlex ids (`citedIds`: one, or twins joined by
 * `|`, which OpenAlex reads as or), most cited first, one page — and, given a
 * keyword, only those whose title or abstract has it as a phrase. The keyword
 * is a parameter of its own, so nothing in it can add a filter.
 */
export function openAlexCitersUrl(openalexIds: string, perPage: number, keyword?: string): string {
  return (
    `https://api.openalex.org/works?filter=cites:${encodeURIComponent(openalexIds)}` +
    (keyword !== undefined ? `&search.title_and_abstract=${encodeURIComponent(`"${keyword}"`)}` : "") +
    `&sort=cited_by_count:desc&per-page=${perPage}&select=${CITER_FIELDS}&mailto=${encodeURIComponent(CONTACT_EMAIL)}`
  );
}

/** How many records a title search reads. Ten: the exact title ranks near the top, and a page costs the same. */
export const TITLE_SEARCH_RESULTS = 10;
/** The longest query sent, in characters, cut at a word. */
const MAX_TITLE_QUERY = 300;
const SEARCH_FIELDS = "id,display_name,publication_year,authorships,keywords";

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

/**
 * **OpenAlex's top keyword for a work**: the `keywords` entry with the highest
 * score (the first of equals), plain, bounded and without quotation marks,
 * since it is sent back as a phrase — or undefined when none has a word in it.
 */
export function topKeywordOf(value: unknown): string | undefined {
  let best: { keyword: string; score: number } | undefined;
  for (const raw of list(value)) {
    const entry = record(raw);
    const keyword = plainRegistryText(entry?.display_name, MAX_KEYWORD)?.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
    const score = typeof entry?.score === "number" && Number.isFinite(entry.score) ? entry.score : 0;
    if (!keyword || tokens(keyword).length === 0) continue;
    if (best === undefined || score > best.score) best = { keyword, score };
  }
  return best?.keyword;
}

/** `works/doi:<doi>` as the work it names — or null when the answer has no usable id. */
export function parseOpenAlexWork(json: unknown): CitedTarget | null {
  const work = record(json);
  const openalexId = workIdOf(work?.id);
  if (work === null || openalexId === null) return null;
  const keyword = topKeywordOf(work.keywords);
  return {
    openalexId,
    title: plainRegistryText(work.title),
    authors: authorsOf(work.authorships).names,
    ...(keyword !== undefined ? { keyword } : {}),
  };
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

/** The whole title and one author agree, or the bounded arXiv exception does. */
function isThisArticle(article: ArticleIdentity, target: CitedTarget): target is CitedTarget & { title: string } {
  if (target.title === null) return false;
  if (registryIsThisArticle(article.title, target.title)) {
    return registryAuthorIsOurs(article, openAlexAuthors(target.authors));
  }
  /* **An arXiv DOI's record may carry another title** — two distinct structured
     author matches stand in for it, but only when the article's own arXiv address
     independently names that DOI. OpenAlex merged a stranger's deposit into
     arXiv 2308.08708 and took its title while keeping the arXiv paper's authors
     and 196 real citers (investigation 261025a). Binding the exception to the
     address keeps a mistyped DOI, or an author's later page carrying an older
     DOI, from borrowing that older paper's citers. Not for any other DOI: there
     the title is the test. */
  const id = citersIdOf(article);
  return id?.startsWith(ARXIV_DOI) === true &&
    arxivDoiAtAddress(article) === id &&
    twoStructuredAuthorsAgree(article, target.authors);
}

/** The article's year: `publishedYear`, or the year of `publishedAt` — or undefined. */
export function articleYear(article: ArticleIdentity): number | undefined {
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

/** Names that are independently identifiable, with spelling and initial variants counted once. */
function distinctNames(names: readonly string[]): string[] {
  const distinct: string[] = [];
  for (const name of names) {
    if (tokens(name).length > 0 && !distinct.some((prior) => sameNamedPerson(prior, name))) {
      distinct.push(name);
    }
  }
  return distinct;
}

/**
 * Whether two distinct OpenAlex authors match two distinct structured article
 * authors. The free-text byline deliberately cannot supply this evidence:
 * `registryAuthorIsOurs` scans the whole string, so `J. Smith Jones` can match
 * both John Smith and Jane Jones, and adjacent authors can be recombined across
 * their boundary. A title can tolerate that loose corroboration; no-title
 * confirmation cannot.
 */
function twoStructuredAuthorsAgree(article: ArticleIdentity, targetNames: readonly string[]): boolean {
  const ours = distinctNames((article.authors ?? []).map((author) => author.name));
  return matchedAuthors(ours, distinctNames(targetNames)) >= 2;
}

/**
 * **A byline's people, each as one name** (Sol's S1-F1 and S1-F7). With a
 * semicolon, the semicolons (and *and*, *&*) separate people and a comma
 * stays inside a name: `Smith, Jane; Jones, John` is Jane Smith and John
 * Jones. Without one, commas separate too — unless every piece is one or two
 * words, there is an even number of them, and every other one, from the
 * first, is a single word: then they pair as surname and given name
 * (`Smith, Jane, Jones, John`). A two-person byline of single names would be
 * read that way too; it is rare, and structured authors win when present.
 */
export function bylineAuthors(byline: string): string[] {
  const words = (part: string) => tokens(part).length;
  const surnameFirst = (name: string) => {
    const [family, ...given] = name.split(",").map((part) => part.trim());
    return given.length === 1 && given[0] !== "" && family !== "" ? `${given[0]} ${family}` : name;
  };
  if (byline.includes(";")) {
    return byline.split(/\s*;\s*|\s+(?:and|&)\s+/i).map((part) => part.trim()).filter((part) => words(part) > 0).map(surnameFirst);
  }
  const parts = byline.split(/\s*,\s*|\s+(?:and|&)\s+/i).map((part) => part.trim()).filter((part) => words(part) > 0);
  const paired = parts.length >= 2 && parts.length % 2 === 0 &&
    parts.every((part, at) => (at % 2 === 0 ? words(part) === 1 : words(part) <= 2));
  if (!paired) return parts;
  const people: string[] = [];
  for (let at = 0; at < parts.length; at += 2) people.push(`${parts[at + 1]} ${parts[at]}`);
  return people;
}

/**
 * **The article's authors as separate people**: its structured names, else its
 * byline read by `bylineAuthors` — never the byline as one bag of words, in
 * which `Jane Alice Smith, John Bob Jones` holds a John Smith (Sol's S1-F1).
 * Spelling and initial variants of one person count once.
 */
function articleAuthorNames(article: Pick<ArticleIdentity, "authors" | "byline">): string[] {
  const structured = (article.authors ?? []).map((author) => author.name);
  return distinctNames(structured.length > 0 ? structured : bylineAuthors(article.byline ?? ""));
}

/**
 * **How many of our authors can be paired with theirs, one to one** — the
 * largest matching, each pair agreeing by `registryAuthorIsOurs` on that one
 * article author's name alone. One OpenAlex name never stands for two of ours,
 * nor two of theirs for one of ours. Both lists are already distinct people.
 */
function matchedAuthors(ours: readonly string[], theirs: readonly string[]): number {
  const agrees = ours.map((ourName) =>
    theirs.map((theirName) => registryAuthorIsOurs({ authors: [{ name: ourName, affiliations: [] }] }, openAlexAuthors([theirName]))));
  const ownerOf: (number | undefined)[] = theirs.map(() => undefined);
  /* Augmenting paths: lists are at most twenty names, so this is cheap. */
  const assign = (ourAt: number, seen: boolean[]): boolean => {
    for (let theirAt = 0; theirAt < theirs.length; theirAt++) {
      if (!agrees[ourAt]?.[theirAt] || seen[theirAt]) continue;
      seen[theirAt] = true;
      const owner = ownerOf[theirAt];
      if (owner === undefined || assign(owner, seen)) {
        ownerOf[theirAt] = ourAt;
        return true;
      }
    }
    return false;
  };
  let matched = 0;
  for (let ourAt = 0; ourAt < ours.length; ourAt++) {
    if (assign(ourAt, theirs.map(() => false))) matched++;
  }
  return matched;
}

/** **How many different people among OpenAlex's names are ours**, matched one to one (`matchedAuthors`). */
function agreeingAuthors(article: ArticleIdentity, names: readonly string[]): number {
  return matchedAuthors(articleAuthorNames(article), distinctNames(names));
}

/** What a title search found: the one work that passes, or none. */
export type TitleMatch = { kind: "match"; target: CitedTarget & { title: string } } | { kind: "none" };

/** A record that passed, with what the twin rule reads. */
type Passing = CitedTarget & { title: string; year: number | undefined; agreeing: number };

/** How many of the piece's authors a twin must carry: two, or all of them when it has fewer. */
function twinAuthorsNeeded(article: ArticleIdentity): number {
  return Math.min(2, Math.max(1, articleAuthorNames(article).length));
}

/** How many different people two records' author lists share. */
function sharedAuthors(one: readonly string[], two: readonly string[]): number {
  return distinctNames(one).filter((name) => two.some((other) => sameNamedPerson(name, other))).length;
}

/**
 * **Whether these passing records are one work held more than once** (plan
 * 261025h, decision 2): the same whole title, each carrying `need` of the
 * piece's authors and `need` of each other's, and years within one. Every
 * pair is tested, so a third record cannot ride in on the first two.
 */
function areTwins(records: readonly Passing[], need: number): boolean {
  if (records.length < 2 || records.length > MAX_TWINS) return false;
  return records.every((one, at) =>
    one.agreeing >= need &&
    records.slice(at + 1).every((two) =>
      registryIsThisArticle(one.title, two.title) &&
      sharedAuthors(one.authors, two.authors) >= need &&
      one.year !== undefined && two.year !== undefined && Math.abs(one.year - two.year) <= 1,
    ));
}

/**
 * **The one work in a title search that is this article** — see the header.
 * Null when the answer is not a search's. Each record passes only with the
 * whole title, and two of its authors among ours or one and the year within
 * one. One passing record is the match; several are one match only when they
 * are twins (`areTwins`), the first in OpenAlex's order named and the others
 * in `alsoHeldAs`. Anything else is `none`: nothing here can tell which of
 * two different works is right, and the most cited is not evidence.
 */
export function titleMatchOf(article: ArticleIdentity, json: unknown): TitleMatch | null {
  const body = record(json);
  if (body === null || !Array.isArray(body.results)) return null;
  const year = articleYear(article);
  const passing = new Map<string, Passing>();
  for (const raw of body.results) {
    const work = record(raw);
    const openalexId = workIdOf(work?.id);
    const title = plainRegistryText(work?.display_name);
    if (work === null || openalexId === null || title === null || passing.has(openalexId)) continue;
    if (!registryIsThisArticle(article.title, title)) continue;
    const authors = authorsOf(work.authorships).names;
    const agreeing = agreeingAuthors(article, authors);
    const theirYear = plausibleYear(work.publication_year);
    const yearAgrees = year !== undefined && theirYear !== undefined && Math.abs(year - theirYear) <= 1;
    if (agreeing < 2 && !(agreeing === 1 && yearAgrees)) continue;
    const keyword = topKeywordOf(work.keywords);
    passing.set(openalexId, { openalexId, title, authors, year: theirYear, agreeing, ...(keyword !== undefined ? { keyword } : {}) });
  }
  const records = [...passing.values()];
  const [first, ...others] = records;
  if (first === undefined) return { kind: "none" };
  if (others.length > 0 && !areTwins(records, twinAuthorsNeeded(article))) return { kind: "none" };
  const keyword = records.find((r) => r.keyword !== undefined)?.keyword;
  return {
    kind: "match",
    target: {
      openalexId: first.openalexId,
      ...(others.length > 0 ? { alsoHeldAs: others.map((r) => r.openalexId) } : {}),
      title: first.title,
      authors: first.authors,
      ...(keyword !== undefined ? { keyword } : {}),
    },
  };
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
    /* OpenAlex's key, when one is set, as its header (plan 261018o): ten times the free daily budget. */
    fetchJson: deps.fetchJson ?? ((url) => fetchBibliographicJson(url, { registryKey: "openalex" })),
    sleep: deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    log: deps.log ?? log("store").child({ lookup: "citation-index" }),
  };
}

/** One request, in its turn: the JSON, or the one-word reason there is none. */
type Got = { kind: "json"; json: unknown } | { kind: "missing" | "too-large" | "unavailable" };

/**
 * `id` is what the log names: the cache key, or `title` for a search, or
 * `fulltext` for src/citation-fulltext.ts's — whose addresses are never logged.
 */
async function get(
  id: CitersKey | "title" | "fulltext",
  what: "work" | "citers" | "search" | "situate-citers" | "fulltext-count" | "fulltext-list",
  url: string,
  d: Resolved,
): Promise<Got> {
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

/**
 * Step 2: the works that cite a confirmed target — every record of it, in one
 * union request — one page. Step 3 is the same with the topic's keyword.
 */
async function askCiters(key: CitersKey, target: Confirmed, d: Resolved, keyword?: string): Promise<Asked> {
  const ids = citedIds(target);
  let second = await get(key, "citers", openAlexCitersUrl(ids, CITERS_PER_PAGE, keyword), d);
  /* The same request would be too large every time, so a retry of it is no
     use. A shorter page may fit, and is listed as what it is. */
  if (second.kind === "too-large") {
    second = await get(key, "citers", openAlexCitersUrl(ids, CITERS_PER_PAGE_SMALL, keyword), d);
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
): Promise<{ kind: "match"; key: BaseCitersKey; target: Confirmed } | { kind: "no-match" | "unavailable" }> {
  const got = await get("title", "search", openAlexTitleSearchUrl(query), d);
  /* A search has no 404 of its own: a missing answer is a broken one. */
  if (got.kind !== "json") return { kind: "unavailable" };
  const match = titleMatchOf(article, got.json);
  if (match === null) return { kind: "unavailable" };
  if (match.kind === "none") return { kind: "no-match" };
  return { kind: "match", key: titleKeyOf(match.target), target: match.target };
}

/* ------------------------------------------- for Situate (src/situate-citers.ts) -- */

/**
 * **The OpenAlex work confirmed to be this article**, by exactly the path
 * `citersOf` takes — the DOI's checked record (including its bounded arXiv
 * exception), or the one title-search work, twins and all — and **nothing
 * cached**. For Situate's own question of the citers (plan 261024o, GPT Sol's
 * S6): it wants their abstracts, which neither `Citer` nor this module's cache
 * holds, so it asks its own page rather than widening either, with `citedIds`
 * so that a work held twice is asked about once, as one.
 */
export async function confirmedWorkOf(
  article: ArticleIdentity,
  deps: CitersDeps = {},
): Promise<
  | { kind: "confirmed"; key: CitersKey; target: CitedTarget & { title: string } }
  | { kind: "no-doi" | "not-indexed" | "unconfirmed" | "no-match" | "unavailable" | "too-large" }
> {
  const id = citersIdOf(article);
  const query = id === null ? searchableTitle(article) : null;
  if (id === null && query === null) return { kind: "no-doi" };
  const d = await resolveDeps(deps);
  if (id === null) {
    const searched = await searchByTitle(query ?? "", article, d);
    return searched.kind === "match" ? { kind: "confirmed", key: searched.key, target: searched.target } : searched;
  }
  const work = await askWork(id, article, d);
  if (work.kind === "confirmed") return { kind: "confirmed", key: id, target: work.target };
  return work.kind === "found" ? { kind: "unavailable" } : work;
}

/**
 * **One OpenAlex request in its polite turn** — the shared limiter, the
 * cooling after a 429, the bounded log — for a caller asking its own question.
 * `key` is what the log names; the address is never logged. `what` says which
 * question it was: Situate's citers unless told otherwise.
 */
export async function openAlexInTurn(
  key: CitersKey | "fulltext",
  url: string,
  deps: CitersDeps = {},
  what: "situate-citers" | "fulltext-count" | "fulltext-list" = "situate-citers",
): Promise<{ kind: "json"; json: unknown } | { kind: "missing" | "too-large" | "unavailable" }> {
  return get(key, what, url, await resolveDeps(deps));
}

/** How the list was reached. The panel says so when it was by title. */
type Via = Extract<CitersResult, { kind: "found" }>["via"];
type Found = Extract<CitersResult, { kind: "found" }>;

/** A remembered answer, as this article may see it. */
function answerFor(article: ArticleIdentity, stored: FetchedCiters, fetchedAt: string, via: Via): CitersResult {
  if (stored.kind === "not-indexed") return { kind: "not-indexed" };
  if (!isThisArticle(article, stored.target)) return { kind: "unconfirmed" };
  const { openalexId, title, alsoHeldAs } = stored.target;
  return {
    kind: "found",
    via,
    target: { openalexId, title, ...(alsoHeldAs !== undefined && alsoHeldAs.length > 0 ? { alsoHeldAs } : {}) },
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
  | { via: "title"; key: BaseCitersKey; target: Confirmed };

/** A list's answer, where it came from, and the confirmed work behind it when it is a list. */
interface Listed {
  result: CitersResult;
  from: "cache" | "openalex" | "stale";
  target: Confirmed | null;
}

/** Steps 1–2: the cached list when fresh, else OpenAlex's, else an older list of this article's. */
async function theList(route: Route, article: ArticleIdentity, d: Resolved): Promise<Listed> {
  const of = (stored: FetchedCiters, fetchedAt: string, from: Listed["from"]): Listed => {
    const result = answerFor(article, stored, fetchedAt, route.via);
    return { result, from, target: result.kind === "found" && stored.kind === "found" ? stored.target : null };
  };
  const stored = await d.store.read(route.key, CITERS_FRESH_MS);
  if (stored?.fresh) return of(stored, stored.fetchedAt, "cache");

  let asked: Asked;
  if (route.via === "title") {
    asked = await askCiters(route.key, route.target, d);
  } else {
    const work = await askWork(route.key, article, d);
    asked = work.kind === "confirmed" ? await askCiters(route.key, work.target, d) : work;
  }
  if (asked.kind === "found" || asked.kind === "not-indexed") {
    const fetchedAt = await d.store.write(route.key, asked);
    return of(asked, fetchedAt, "openalex");
  }
  /* OpenAlex could not be read, and an older list exists: serve it, with its
     own date, if it is still this article's. Not after `unconfirmed` — that
     is OpenAlex answering, and saying something else. */
  if (asked.kind !== "unconfirmed" && stored?.kind === "found") {
    const stale = of(stored, stored.fetchedAt, "stale");
    if (stale.result.kind === "found") return stale;
  }
  return { result: { kind: asked.kind }, from: "openalex", target: null };
}

/** The topic view's list, and where it came from — its own provenance, never the plain list's (Sol's S1-F6). */
interface TopicListed {
  result: Found;
  from: Listed["from"];
}

/**
 * **The topic view's row, as it stands**, never asking OpenAlex: what labels
 * the plain list with a count once the reader has asked for the view. Null
 * when there is none, or it was filtered by another keyword. A database
 * failure is null too: the plain list does not depend on it.
 */
async function storedTopic(key: BaseCitersKey, keyword: string, d: Resolved): Promise<StoredCiters | null> {
  try {
    const stored = await d.store.read(`${key}#topic`, CITERS_FRESH_MS);
    return stored?.kind === "found" && stored.target.keyword === keyword ? stored : null;
  } catch {
    d.log.warn({ id: `${key}#topic`, outcome: "internal-error" }, "citation index topic");
    return null;
  }
}

/**
 * Step 3, **only on `about: "topic"`** (Sol's S1-F5): the citers that mention
 * the work's keyword, in their own row beside the list's (`<key>#topic`),
 * fresh for as long, else asked of OpenAlex, else an older row of the same
 * keyword. Null when there is none to show: the plain list is answered.
 */
async function theTopicList(
  key: BaseCitersKey,
  target: Confirmed,
  keyword: string,
  article: ArticleIdentity,
  via: Via,
  d: Resolved,
): Promise<TopicListed | null> {
  const topicKey: CitersKey = `${key}#topic`;
  const of = (stored: FetchedCiters, fetchedAt: string, from: Listed["from"]): TopicListed | null => {
    const result = answerFor(article, stored, fetchedAt, via);
    return result.kind === "found" ? { result, from } : null;
  };
  try {
    const same = await storedTopic(key, keyword, d);
    if (same?.fresh) return of(same, same.fetchedAt, "cache");
    const asked = await askCiters(topicKey, target, d, keyword);
    if (asked.kind === "found") return of(asked, await d.store.write(topicKey, asked), "openalex");
    return same !== null ? of(same, same.fetchedAt, "stale") : null;
  } catch {
    /* The plain list is answered. Nothing of the error is logged: a fetch
       seam's message can carry its address, which carries the keyword. */
    d.log.warn({ id: topicKey, outcome: "internal-error" }, "citation index topic");
    return null;
  }
}

/** What a caller may ask of `citersOf` beyond the article. */
export interface CitersOptions {
  /** `topic`: the topic view's list, filtered by the work's keyword, when there is one. */
  about?: "topic";
}

/**
 * **The papers that cite this article** — see the header for the whole path —
 * or, with `about: "topic"`, those of them that mention the work's keyword.
 * Never throws for anything OpenAlex or the database does: both are
 * `unavailable`.
 */
export async function citersOf(article: ArticleIdentity, deps: CitersDeps = {}, opts: CitersOptions = {}): Promise<CitersResult> {
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
        ...(opts.about !== undefined ? { about: opts.about } : {}),
        ...(result.kind === "found"
          ? {
              via: result.via,
              count: result.count,
              returned: result.returned,
              dropped: result.dropped,
              capped: result.capped,
              records: 1 + (result.target.alsoHeldAs?.length ?? 0),
              ...(result.topic?.count !== undefined ? { topicCount: result.topic.count } : {}),
            }
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

    const listed = await theList(route, article, d);
    const list = listed.result;
    const keyword = listed.target?.keyword;
    if (list.kind !== "found" || listed.target === null || keyword === undefined || list.count <= TOPIC_MIN_CITERS) {
      return done(route.key, list, listed.from);
    }
    /* Decision 10: offered beside the list, never applied in its place, and
       its list fetched only when the reader asks for it (Sol's S1-F5). */
    if (opts.about === "topic") {
      const topic = await theTopicList(route.key, listed.target, keyword, article, route.via, d);
      if (topic !== null) {
        const label = { keyword, count: topic.result.count };
        return done(`${route.key}#topic`, { ...topic.result, topic: label, filteredBy: keyword }, topic.from);
      }
      return done(route.key, { ...list, topic: { keyword } }, listed.from);
    }
    const known = await storedTopic(route.key, keyword, d);
    const label = known?.kind === "found" ? { keyword, count: known.count } : { keyword };
    return done(route.key, { ...list, topic: label }, listed.from);
  } catch {
    /* Error messages from a fetch seam can contain its whole URL, and database
       errors can include the title/authors being written. This module's log
       contract permits neither, so record only bounded, non-content fields. */
    d.log.error({ id: id ?? "title", outcome: "internal-error", ms: Date.now() - started }, "citation index lookup failed");
    return { kind: "unavailable" };
  }
}
