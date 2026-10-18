/**
 * **Papers close to this article that its Bibliography does not list, from
 * OpenAlex** — Sources' *Not cited*, with no model anywhere in it.
 * docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md, whose
 * § GPT Sol's plan review is where most of the rules below come from.
 *
 * ```
 * GET  (every open of the chip; never asks OpenAlex)
 *   no Bibliography ──────────────────────► no-bibliography
 *   no title and no prose ────────────────► no-query
 *   no stored search ─────────────────────► not-searched      (the panel offers the press)
 *   the stored search, filtered now ──────► found
 * POST (the owner's press: *Search OpenAlex for related work*)
 *   the same two refusals, then the owner's allowance ► rate-limited
 *   works?search.semantic=<title + opening>&filter=publication_year:<Y+1
 *     a failure, or an answer we cannot read ► unavailable   (nothing stored)
 *   store the parsed list under the article, then answer as GET does
 * ```
 *
 * **The search runs only on the owner's press** (F1). It sends the piece's
 * title and the opening of its text — its abstract, on a paper — to OpenAlex,
 * which no other request of ours does: Cited by sends only a DOI or a title. A
 * referee may have uploaded a confidential manuscript, so opening the chip
 * never sends anything, and the privacy page says what the press sends.
 *
 * **The query is the recipe `related-work/2`** (F7): the imported title, then
 * the article's own abstract when it has one, else the paragraphs of the
 * abstract section its Structure tree finds (`relatedWorkOpening`), else its
 * first paragraphs (body text, not headings, not notes), at most
 * `MAX_QUERY_BODY` characters cut at a word, with every email address taken
 * out. The year filter, `publication_year:<Y+1`, only when the piece's year is
 * known: a paper cannot have left out work published after it; and always a
 * type filter (`RELATED_WORK_TYPES`), so no erratum or front matter. The query and
 * the filter are hashed into the stored row's `fingerprint`, so a later `GET`
 * can say the article no longer asks the question that was searched.
 *
 * **The exclusion is ours, at read time, against the current Bibliography**
 * (F2, F3). OpenAlex's own `referenced_works` misses works a paper does cite —
 * Sutskever 2014 and ByteNet, for the Transformer — and telling a reviewer the
 * piece omits a work it cites is the worst error this view can make. So a
 * candidate is dropped when, in order:
 *
 * 1. **identifier** — its DOI is a row's `doi:`/`arxiv:` key or the DOI or
 *    arXiv id of the row's link, arXiv's `10.48550/arxiv.<id>` and the bare id
 *    being one identity; a row whose registry record says its identifier is
 *    another work's (`registry.kind === "conflict"`) lends none;
 * 2. **title** — both titles distinctive (`registryTitleIsDistinctive`) and
 *    agreeing by the registry's own lenient test (`registryTitleAgrees`), which
 *    already allows for a row title cut at its 120-character limit;
 * 3. **entry** — the candidate's distinctive title, or its main title before a
 *    colon, appears word for word in a row's `entry`, the article's own
 *    reference text.
 *
 * Never against the article's prose: a work merely discussed is not cited.
 * The piece itself is dropped by its DOI or arXiv id, or by its whole title
 * plus an author or the year — never by title alone. Each is lenient towards
 * dropping, because a work wrongly hidden costs less than a work wrongly
 * listed; and the panel still says *not among the works Spideryarn found in its
 * bibliography*, never *not cited*, with a warning when that list is stale or
 * capped (F4).
 *
 * **OpenAlex is an outside party, and everything it sends is text** (F5). The
 * address is built with `URLSearchParams`; every string goes through
 * `plainRegistryText` with a bound; ids and DOIs are kept only when they have
 * the right shape; the abstract is rebuilt from the inverted index with bounds
 * on its words, positions and length; duplicates (by id, DOI or title) are
 * dropped, the first kept. No address in the answer is kept at all: the panel
 * builds its links with `citerUrl` (src/citer-link.ts).
 *
 * **Politeness is the shared limiter's** (src/bibliographic.ts §
 * `inServiceTurn`), and **spend is the owner's allowance**
 * (`RELATED_WORK_RATE_POLICY`): no money, but OpenAlex's anonymous daily
 * allowance, which Cited by needs too. One search costs ten credits.
 *
 * **Two cold presses at once both ask** (F8). The button is held until the
 * answer is drawn, so the race is two tabs pressing in the same second; each
 * spends ten credits and the second write wins. Accepted: no claim table.
 *
 * ## What may be logged from this file
 *
 * The article's id, the outcome and counts. Never the query, the search's
 * address (which carries the query), the fingerprint's input, a title or an
 * author: the article's are the reader's business, and OpenAlex's are a
 * stranger's string.
 */

import { createHash } from "node:crypto";

import { registryAuthorIsOurs, registryIsThisArticle } from "./article-registry.js";
import {
  type ServiceLimiter,
  type WorkId,
  coolAfter,
  inServiceTurn,
  list,
  parseWorkId,
  plainRegistryText,
  plausibleYear,
  record,
} from "./bibliographic.js";
import { type ArticleIdentity, citersIdOf, openAlexAuthors } from "./citation-index.js";
import { tokens } from "./citation-lookup.js";
import { registryTitleIsDistinctive, rowWorkId, titlesDifferByObjectQualifier } from "./citation-registry.js";
import { OPENALEX_WORK_ID } from "./citer-link.js";
import { FetchFailure, fetchBibliographicJson } from "./fetch.js";
import { log, type Log } from "./log.js";
import { registryTitleAgrees } from "./paper-evidence.js";
import { CONTACT_EMAIL } from "./site-text.js";
import type { FetchAllowanceStore, RatePolicy, RelatedWorkStore } from "./store/contracts.js";
import { inAbstract } from "./skim.js";
import type { BlockKind, CitedWork, RelatedWork, RelatedWorkResult, Tree } from "./types.js";

/* ------------------------------------------------------------ the policy -- */

/**
 * The recipe's name, in the fingerprint. Change it when the query or the filter
 * would be built differently. `/2` (2026-10-11): the abstract's paragraphs
 * before the opening, email addresses taken out, and the type filter.
 */
export const RELATED_WORK_RECIPE = "related-work/2";

/** One page. Measured 2026-10-11: ten credits, 113 KB with abstracts, 1.7 s. */
export const RELATED_WORK_RESULTS = 25;

/** The longest opening (abstract or prose) put after the title, in characters, cut at a word. */
export const MAX_QUERY_BODY = 1000;
/** The longest title put in the query. A title longer than this is not a title. */
const MAX_QUERY_TITLE = 400;

/** Authors kept per work: enough to recognise the piece itself by. */
const MAX_AUTHORS = 20;
/** Authors a found answer carries per work; `authorCount` says how many there are. */
export const RELATED_WORK_AUTHORS = 6;
const MAX_TITLE = 1000;
const MAX_NAME = 200;
const MAX_VENUE = 300;

/** The abstract's opening, in characters, cut at a word. */
export const MAX_ABSTRACT = 400;
/** Only the first words of an abstract can reach `MAX_ABSTRACT`. Positions past this are ignored. */
const ABSTRACT_WORDS = 160;
/** At most this many entries of the inverted index are read, and this many positions in all. */
const ABSTRACT_MAX_KEYS = 5000;
const ABSTRACT_MAX_POSITIONS = 20000;
const ABSTRACT_MAX_WORD = 100;

/**
 * **How often one owner may search, and everybody together.** Guesses, as
 * every `RatePolicy`'s are (src/store/contracts.ts § `RatePolicy`). A search
 * is pressed once per article and kept, so ten an hour is a reader going down
 * a stack of papers; thirty a day a heavy day of it. The global fuse is half
 * of the anonymous allowance's hundred searches a day, so that a script cannot
 * take Cited by's share. Concurrency one: two tabs, not two readers. The lease
 * covers the limiter's wait and the fetcher's deadline with room.
 */
export const RELATED_WORK_RATE_POLICY: RatePolicy = {
  fills: 10,
  windowMs: 60 * 60 * 1000,
  concurrency: 1,
  leaseMs: 30_000,
  daily: { fills: 30, globalFills: 50, windowMs: 24 * 60 * 60 * 1000 },
};

/* ------------------------------------------------------------- the types -- */

/**
 * What the recipe and the self-exclusion need about the article. **The title
 * is the imported one or the first heading, never a reader's rename and never
 * the slug** — null when there is neither. `abstract` is a minimal paper's own
 * (`Meta.abstract`).
 */
export type RelatedWorkArticle = Omit<ArticleIdentity, "title"> & { title: string | null; abstract?: string };

/** The Bibliography as the exclusion reads it: its rows, and the two facts that make it untrustworthy. */
export interface RelatedWorkBibliography {
  citations: readonly CitedWork[];
  /** It describes an older version of the article. */
  stale: boolean;
  /** It says it left works out (`Bibliography.capped`). */
  capped: boolean;
}

/** A kept search: OpenAlex's parsed answer, before any exclusion. */
export interface RelatedWorkSearch {
  fingerprint: string;
  /** The piece's year the search was limited to, or null. */
  yearLimit: number | null;
  works: RelatedWork[];
}

export type StoredRelatedWork = RelatedWorkSearch & { searchedAt: string };

/**
 * **Everything one request needs, read in one snapshot by the owner's loader**
 * (src/store/pg-related-work.ts, F6): the article as imported, its opening
 * paragraphs, its current Bibliography, and the kept search. Somebody else's
 * slug never gets this far: the loader's 404.
 */
export interface RelatedWorkLoaded {
  articleId: string;
  article: RelatedWorkArticle;
  /** The first body paragraphs' text, in order — enough to fill `MAX_QUERY_BODY`. */
  opening: readonly string[];
  /** Null when the article has no Bibliography yet. */
  bibliography: RelatedWorkBibliography | null;
  stored: StoredRelatedWork | null;
}

/** The store's contract lives with the others (src/store/contracts.ts § `RelatedWorkStore`). */
export type { RelatedWorkStore };

/**
 * **The store and the allowance are handed in, never imported** — the route
 * passes the guarded ones from src/store/index.ts. Importing them here would
 * close a cycle, because the loader in src/store/pg-related-work.ts reads this
 * file's parser. The limiter and the fetcher default as Cited by's do.
 */
export interface RelatedWorkDeps {
  store: RelatedWorkStore;
  allowance: Pick<FetchAllowanceStore, "take" | "finish">;
  limiter?: ServiceLimiter;
  fetchJson?: (url: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  log?: Log;
}

/* ------------------------------------------------------------ the recipe -- */

/** `text` cut at a word to at most `max` characters, whitespace collapsed — or "" when there is none. */
function cutAtWord(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : flat.slice(0, max)).trim();
}

/**
 * **An email address is personal data, and OpenAlex is an outside party**, so
 * no word with an `@` between two other characters is ever sent — a paper's
 * author list carries its authors' addresses, and the opening can be it when
 * the tree finds no abstract. Brackets and punctuation round it go too.
 */
function withoutEmails(text: string): string {
  return text.replace(/\S+@\S+/g, " ");
}

/** A block as the opening reads it: its place, its kind, its text, and the three marks that rule it out. */
export interface OpeningBlock {
  id: string;
  kind: BlockKind;
  text: string;
  role: string | null;
  treatment: string | null;
  note: string | null;
}

/** Body prose: a text block that is not a note, a supplement or a classified block (a footnote, a reference). */
function isOpeningProse(block: OpeningBlock): boolean {
  return block.kind === "text" && block.role === null && block.treatment === null && block.note === null && block.text.trim() !== "";
}

/** The first texts of `blocks`, in order, until there is enough for `MAX_QUERY_BODY`. */
function enough(blocks: readonly OpeningBlock[]): string[] {
  const out: string[] = [];
  let length = 0;
  for (const block of blocks) {
    if (length > MAX_QUERY_BODY) break;
    const text = block.text.trim();
    out.push(text);
    length += text.length + 1;
  }
  return out;
}

/**
 * **What follows the title in the query**: the abstract's paragraphs when the
 * Structure tree has an abstract section (`inAbstract`, src/skim.ts, the same
 * test Skim uses to leave the abstract out), else the first body paragraphs.
 * Without this, a paper whose front matter is a permissions notice and an
 * author list was searched by those (the Transformer, 2026-10-11). Positions
 * are resolved by block index (docs/project/block-ids.md), so `blocks` is the
 * whole article in order.
 */
export function relatedWorkOpening(blocks: readonly OpeningBlock[], tree: Tree | null): string[] {
  const prose = blocks.filter(isOpeningProse);
  if (tree !== null) {
    const index = new Map(blocks.map((block, at) => [block.id, at] as const));
    const abstract = prose.filter((block) => inAbstract(block.id, index, tree));
    if (abstract.length > 0) return enough(abstract);
  }
  return enough(prose);
}

/**
 * **The words sent to OpenAlex** (`related-work/2`): the title, then the
 * abstract if there is one, else the opening paragraphs, together at most
 * `MAX_QUERY_BODY` characters after the title. Null when there is neither a
 * title nor any prose.
 */
export function relatedWorkQueryOf(article: RelatedWorkArticle, opening: readonly string[]): string | null {
  const title = cutAtWord(withoutEmails(article.title ?? ""), MAX_QUERY_TITLE);
  const abstract = withoutEmails(article.abstract ?? "").trim();
  const body = cutAtWord(abstract !== "" ? abstract : withoutEmails(opening.join(" ")), MAX_QUERY_BODY);
  const query = [title, body].filter((part) => part !== "").join(" ");
  return query === "" ? null : query;
}

/** The piece's year: `publishedYear`, or the year of `publishedAt` — or null. */
export function relatedWorkYearOf(article: Pick<RelatedWorkArticle, "publishedAt" | "publishedYear">): number | null {
  return plausibleYear(article.publishedYear) ?? plausibleYear(/^\d{4}/.exec(article.publishedAt ?? "")?.[0]) ?? null;
}

/** The recipe's version and a sha256 of what was asked. Never logged: its input is the article's words. */
export function relatedWorkFingerprint(query: string, yearLimit: number | null): string {
  const hash = createHash("sha256").update(`${query}\n${yearLimit ?? ""}`, "utf8").digest("hex");
  return `${RELATED_WORK_RECIPE}:${hash}`;
}

/** What one search would ask, or null when there is nothing to ask with. */
export function relatedWorkInputOf(
  loaded: Pick<RelatedWorkLoaded, "article" | "opening">,
): { query: string; yearLimit: number | null; fingerprint: string } | null {
  const query = relatedWorkQueryOf(loaded.article, loaded.opening);
  if (query === null) return null;
  const yearLimit = relatedWorkYearOf(loaded.article);
  return { query, yearLimit, fingerprint: relatedWorkFingerprint(query, yearLimit) };
}

/**
 * **The kinds of work a piece could have cited**, as OpenAlex types them —
 * one filter value, `|` meaning or. A positive list rather than a list of
 * exclusions, so a type OpenAlex adds later is left out until somebody decides:
 * errata, paratext (*Proceedings of the First Workshop on…*), editorials,
 * letters, peer reviews and retractions never reach the list. A conference
 * paper is an `article` to OpenAlex.
 */
export const RELATED_WORK_TYPES = "article|preprint|review|book-chapter|book|dissertation|report";

const SEARCH_FIELDS =
  "id,doi,display_name,publication_year,authorships,primary_location,cited_by_count,abstract_inverted_index";

/**
 * OpenAlex's semantic search for these words, published before the year after
 * `yearLimit` when there is one, and of the types in `RELATED_WORK_TYPES`. A search parameter and a separately built
 * `filter`, so nothing in the query can add a filter.
 */
export function openAlexRelatedUrl(query: string, yearLimit: number | null): string {
  const params = new URLSearchParams({ "search.semantic": query });
  const filters = [...(yearLimit !== null ? [`publication_year:<${yearLimit + 1}`] : []), `type:${RELATED_WORK_TYPES}`];
  params.set("filter", filters.join(","));
  params.set("per_page", String(RELATED_WORK_RESULTS));
  params.set("select", SEARCH_FIELDS);
  params.set("mailto", CONTACT_EMAIL);
  return `https://api.openalex.org/works?${params.toString()}`;
}

/* ------------------------------------------------------------ the parsing -- */

/** `https://openalex.org/W…`, or the bare id, as `W…` — or null. */
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

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * **The opening of an abstract, from OpenAlex's inverted index** (`{ word:
 * [positions] }`), cut at a word to `MAX_ABSTRACT` — or null. Bounded on every
 * axis a stranger controls: how many entries are read, how many positions in
 * all, how far in a position may be, and how long a word may be. A position
 * nobody filled is skipped rather than guessed.
 */
export function abstractFromInvertedIndex(value: unknown): string | null {
  const index = record(value);
  if (index === null) return null;
  const words: (string | undefined)[] = [];
  let keys = 0;
  let positions = 0;
  for (const raw in index) {
    if (!Object.hasOwn(index, raw)) continue;
    if (++keys > ABSTRACT_MAX_KEYS || positions >= ABSTRACT_MAX_POSITIONS) break;
    const at = index[raw];
    const word = plainRegistryText(raw, ABSTRACT_MAX_WORD);
    if (word === null) continue;
    for (const position of list(at)) {
      if (++positions > ABSTRACT_MAX_POSITIONS) break;
      if (typeof position === "number" && Number.isInteger(position) && position >= 0 && position < ABSTRACT_WORDS) {
        words[position] = word;
      }
    }
  }
  const text = plainRegistryText(words.filter((w) => w !== undefined).join(" "), MAX_ABSTRACT + 200);
  return text === null ? null : cutAtWord(text, MAX_ABSTRACT) || null;
}

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

/** A title as the words that identify it, for telling duplicates apart. */
function titleKey(title: string): string {
  return tokens(title).join(" ");
}

/** The three identities used to keep one suggestion once, on fresh and stored answers alike. */
function relatedWorkKeys(work: Pick<RelatedWork, "openalexId" | "doi" | "title">): string[] {
  return [
    `id:${work.openalexId}`,
    `title:${titleKey(work.title)}`,
    ...(work.doi !== undefined ? [`doi:${work.doi}`] : []),
  ];
}

/** Add `work`'s identities to `seen`, unless any is there already. */
function firstRelatedWork(work: Pick<RelatedWork, "openalexId" | "doi" | "title">, seen: Set<string>): boolean {
  const keys = relatedWorkKeys(work);
  if (keys.some((key) => seen.has(key))) return false;
  for (const key of keys) seen.add(key);
  return true;
}

/**
 * **One page of `works?search.semantic=…`**, in OpenAlex's order (closest
 * first) — or null when it is not that shape. A record is dropped when it has
 * no title or no `W` id, or repeats an id, a DOI or a title already seen (the
 * first sighting kept: an arXiv preprint and its proceedings version are one
 * suggestion). A malformed DOI drops only the DOI.
 */
export function parseOpenAlexRelated(json: unknown): RelatedWork[] | null {
  const body = record(json);
  if (body === null || !Array.isArray(body.results)) return null;
  const works: RelatedWork[] = [];
  const seen = new Set<string>();
  for (const raw of body.results.slice(0, RELATED_WORK_RESULTS * 2)) {
    const work = record(raw);
    const openalexId = workIdOf(work?.id);
    const title = plainRegistryText(work?.display_name, MAX_TITLE);
    if (work === null || openalexId === null || title === null || titleKey(title) === "") continue;
    const doi = doiOf(work.doi);
    const authors = authorsOf(work.authorships);
    const year = plausibleYear(work.publication_year);
    const venue = plainRegistryText(record(record(work.primary_location)?.source)?.display_name, MAX_VENUE);
    const citedByCount = count(work.cited_by_count);
    const abstract = abstractFromInvertedIndex(work.abstract_inverted_index);
    const parsed: RelatedWork = {
      openalexId,
      ...(doi !== undefined ? { doi } : {}),
      title,
      authors: authors.names,
      authorCount: authors.count,
      ...(year !== undefined ? { year } : {}),
      ...(venue !== null ? { venue } : {}),
      ...(citedByCount !== undefined ? { citedByCount } : {}),
      ...(abstract !== null ? { abstract } : {}),
    };
    if (!firstRelatedWork(parsed, seen)) continue;
    works.push(parsed);
    if (works.length === RELATED_WORK_RESULTS) break;
  }
  return works;
}

/**
 * **A stored work, checked again** — the database's JSON is not trusted to be
 * the shape it was written in (nothing revalidates stored JSON). Null when it
 * is not a work.
 */
export function relatedWorkOf(value: unknown): RelatedWork | null {
  const work = record(value);
  if (work === null) return null;
  const openalexId = typeof work.openalexId === "string" && OPENALEX_WORK_ID.test(work.openalexId) ? work.openalexId : null;
  const title = plainRegistryText(work.title, MAX_TITLE);
  if (openalexId === null || title === null || titleKey(title) === "") return null;
  const doi = typeof work.doi === "string" ? doiOf(work.doi) : undefined;
  const authors = list(work.authors)
    .map((name) => plainRegistryText(name, MAX_NAME))
    .filter((name): name is string => name !== null)
    .slice(0, MAX_AUTHORS);
  const year = plausibleYear(work.year);
  const venue = plainRegistryText(work.venue, MAX_VENUE);
  const citedByCount = count(work.citedByCount);
  const abstract = plainRegistryText(work.abstract, MAX_ABSTRACT);
  return {
    openalexId,
    ...(doi !== undefined ? { doi } : {}),
    title,
    authors,
    authorCount: Math.max(count(work.authorCount) ?? 0, authors.length),
    ...(year !== undefined ? { year } : {}),
    ...(venue !== null ? { venue } : {}),
    ...(citedByCount !== undefined ? { citedByCount } : {}),
    ...(abstract !== null ? { abstract } : {}),
  };
}

/**
 * **A stored answer, re-checked as a list**: items validated, duplicates dropped
 * and the same result bound as a fresh OpenAlex answer enforced. At most twice
 * the bound is inspected, so malformed stored JSON cannot make a read unbounded.
 */
export function relatedWorksOf(value: unknown): RelatedWork[] | null {
  if (!Array.isArray(value)) return null;
  const works: RelatedWork[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, RELATED_WORK_RESULTS * 2)) {
    const work = relatedWorkOf(raw);
    if (work === null || !firstRelatedWork(work, seen)) continue;
    works.push(work);
    if (works.length === RELATED_WORK_RESULTS) break;
  }
  return works;
}

/* --------------------------------------------------------- the exclusion -- */

/** One identity for arXiv's DataCite DOI and the bare arXiv id: `doi:10.48550/arxiv.<id>` → `arxiv:<id>`. */
function canonicalId(id: WorkId): WorkId {
  const arxiv = /^doi:10\.48550\/arxiv\.(.+)$/.exec(id);
  return (arxiv?.[1] ? parseWorkId(`arxiv:${arxiv[1]}`) : null) ?? id;
}

/** A work's DOI as one identity, or null. */
function workIdentity(work: Pick<RelatedWork, "doi">): WorkId | null {
  const id = work.doi !== undefined ? parseWorkId(work.doi) : null;
  return id === null ? null : canonicalId(id);
}

/**
 * The identities a Bibliography row vouches for: its `doi:`/`arxiv:` key and
 * its link's DOI or arXiv id — none when its registry record says the
 * identifier names another work.
 */
function rowIdentities(row: CitedWork): WorkId[] {
  if (row.registry?.kind === "conflict") return [];
  const ids: WorkId[] = [];
  const keyed = /^(doi|arxiv):/i.test(row.key) ? parseWorkId(row.key) : null;
  if (keyed !== null) ids.push(canonicalId(keyed));
  const linked = rowWorkId(row);
  if (linked !== null) ids.push(canonicalId(linked));
  return ids;
}

/** Whether `needle`'s words appear, in order and together, among `hay`'s. */
function containsRun(hay: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let at = 0; at + needle.length <= hay.length; at++) {
    if (needle.every((word, i) => hay[at + i] === word)) return true;
  }
  return false;
}

/** The title, and its main title before a colon or a dash when that is distinctive on its own. */
function titleForms(title: string): string[] {
  const main = /^(.+?)\s*(?::|\s[-–—]\s)\s*\S/.exec(title)?.[1];
  return main !== undefined && registryTitleIsDistinctive(main) ? [title, main] : [title];
}

/**
 * Tier 2: the two titles name one work. Both distinctive; a correction or
 * supplement is another object. **A row title cut at its 120-character limit
 * needs nothing of its own**: `registryTitleAgrees` takes one title opening the
 * other, or 80% of the row's significant words in the candidate's, and a cut
 * title loses at most its last word to the cut.
 */
function titlesAgree(candidate: string, row: string): boolean {
  if (!registryTitleIsDistinctive(candidate) || !registryTitleIsDistinctive(row)) return false;
  if (titlesDifferByObjectQualifier(candidate, row)) return false;
  return registryTitleAgrees(candidate, row);
}

/** Tier 3: the candidate's distinctive title, word for word, in the article's own reference text. */
function titleInEntry(candidate: string, entry: string | undefined): boolean {
  if (entry === undefined) return false;
  const words = tokens(entry);
  return titleForms(candidate).some((form) => registryTitleIsDistinctive(form) && containsRun(words, tokens(form)));
}

/** **Is this work one the Bibliography lists?** The three tiers in the header, in order. */
export function inBibliography(work: Pick<RelatedWork, "doi" | "title">, rows: readonly CitedWork[]): boolean {
  const id = workIdentity(work);
  if (id !== null && rows.some((row) => rowIdentities(row).includes(id))) return true;
  if (rows.some((row) => titlesAgree(work.title, row.title))) return true;
  return rows.some((row) => titleInEntry(work.title, row.entry));
}

/**
 * **Is this work the piece itself?** By its DOI or arXiv id, or by the whole
 * title (`registryIsThisArticle`) and one of its authors or the year within
 * one — never by the title alone, which a thesis and its paper share.
 */
export function isThisPiece(work: Pick<RelatedWork, "doi" | "title" | "authors" | "year">, article: RelatedWorkArticle): boolean {
  const id = workIdentity(work);
  if (id !== null) {
    const own = [article.doi ? parseWorkId(article.doi) : null, citersIdOf({ ...article, title: article.title ?? "" })];
    if (own.some((mine) => mine !== null && canonicalId(mine) === id)) return true;
  }
  if (article.title === null || !registryIsThisArticle(article.title, work.title)) return false;
  if (registryAuthorIsOurs(article, openAlexAuthors(work.authors))) return true;
  const year = relatedWorkYearOf(article);
  return year !== null && work.year !== undefined && Math.abs(year - work.year) <= 1;
}

/** The works neither in the Bibliography nor the piece itself, and how many the Bibliography took out. */
export function notInBibliography(
  works: readonly RelatedWork[],
  rows: readonly CitedWork[],
  article: RelatedWorkArticle,
): { works: RelatedWork[]; excluded: number } {
  const kept: RelatedWork[] = [];
  let excluded = 0;
  for (const work of works) {
    if (isThisPiece(work, article)) continue;
    if (inBibliography(work, rows)) {
      excluded++;
      continue;
    }
    kept.push({ ...work, authors: work.authors.slice(0, RELATED_WORK_AUTHORS) });
  }
  return { works: kept, excluded };
}

/* ------------------------------------------------------------ the answers -- */

function answerFor(
  stored: StoredRelatedWork,
  bibliography: RelatedWorkBibliography,
  article: RelatedWorkArticle,
  fingerprint: string,
): RelatedWorkResult {
  const { works, excluded } = notInBibliography(stored.works, bibliography.citations, article);
  return {
    kind: "found",
    works,
    excluded,
    bibliographyStale: bibliography.stale,
    bibliographyCapped: bibliography.capped,
    yearLimited: stored.yearLimit,
    queryChanged: stored.fingerprint !== fingerprint,
    searchedAt: stored.searchedAt,
  };
}

/**
 * **`GET /api/related-work/:slug`** — the kept search, filtered against the
 * Bibliography as it is now, or why there is none. Never asks OpenAlex.
 */
export function relatedWorkAnswer(loaded: RelatedWorkLoaded): RelatedWorkResult {
  if (loaded.bibliography === null) return { kind: "no-bibliography" };
  const input = relatedWorkInputOf(loaded);
  if (input === null) return { kind: "no-query" };
  if (loaded.stored === null) return { kind: "not-searched" };
  return answerFor(loaded.stored, loaded.bibliography, loaded.article, input.fingerprint);
}

/* ------------------------------------------------------------- the search -- */

interface Resolved {
  store: RelatedWorkStore;
  allowance: Pick<FetchAllowanceStore, "take" | "finish">;
  limiter: ServiceLimiter;
  fetchJson: (url: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  log: Log;
}

async function resolveDeps(deps: RelatedWorkDeps): Promise<Resolved> {
  /* The limiter is loaded only when nobody handed one in, so a test of the
     orchestration never opens a database connection. */
  return {
    store: deps.store,
    allowance: deps.allowance,
    limiter: deps.limiter ?? (await import("./store/pg-bibliographic.js")).pgBibliographicStore,
    /* OpenAlex's key, when one is set, as its header (plan 261018o): ten times the free daily budget. */
    fetchJson: deps.fetchJson ?? ((url) => fetchBibliographicJson(url, { registryKey: "openalex" })),
    sleep: deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    log: deps.log ?? log("store").child({ lookup: "related-work" }),
  };
}

/** The one request, in its turn: the JSON, or null. Logs only the article id, the status and the outcome. */
async function ask(articleId: string, url: string, d: Resolved): Promise<unknown> {
  const turn = await inServiceTurn("openalex", { store: d.limiter, sleep: d.sleep }, async (waitMs) => {
    const started = Date.now();
    try {
      return { json: await d.fetchJson(url) };
    } catch (err) {
      if (!(err instanceof FetchFailure)) throw err;
      const cooldownMs = await coolAfter(err, "openalex", d.limiter);
      d.log.warn(
        {
          articleId,
          status: err.status,
          code: err.code,
          ms: Date.now() - started,
          waitMs,
          outcome: cooldownMs !== null ? "cooling-down" : "error",
          ...(cooldownMs !== null ? { cooldownMs } : {}),
        },
        "related work request",
      );
      return null;
    }
  });
  if (turn.kind === "ran") return turn.value?.json ?? null;
  d.log.info({ articleId, outcome: turn.why, at: turn.at }, "related work request");
  return null;
}

/**
 * **`POST /api/related-work/:slug`** — the owner's press: search OpenAlex,
 * keep the parsed answer under the article, and answer as `GET` would. Never
 * throws for anything OpenAlex, the allowance or the database does: all are
 * `unavailable` (or `rate-limited`).
 */
export async function searchRelatedWork(loaded: RelatedWorkLoaded, deps: RelatedWorkDeps): Promise<RelatedWorkResult> {
  const bibliography = loaded.bibliography;
  if (bibliography === null) return { kind: "no-bibliography" };
  const input = relatedWorkInputOf(loaded);
  if (input === null) return { kind: "no-query" };
  let d: Resolved;
  try {
    d = await resolveDeps(deps);
  } catch {
    /* There may be no logger yet, and an import error's message may carry a
       database parameter. */
    return { kind: "unavailable" };
  }
  const started = Date.now();
  const done = (result: RelatedWorkResult, extra: Record<string, unknown> = {}): RelatedWorkResult => {
    d.log.info(
      {
        articleId: loaded.articleId,
        outcome: result.kind,
        ms: Date.now() - started,
        ...(result.kind === "found" ? { listed: result.works.length, excluded: result.excluded } : {}),
        ...extra,
      },
      "related work search",
    );
    return result;
  };
  let token: string | null = null;
  try {
    const allowance = await d.allowance.take("related-work-search", RELATED_WORK_RATE_POLICY);
    if (allowance.kind !== "allowed") return done({ kind: "rate-limited" }, { why: allowance.kind });
    token = allowance.id;
    const json = await ask(loaded.articleId, openAlexRelatedUrl(input.query, input.yearLimit), d);
    const works = json === null ? null : parseOpenAlexRelated(json);
    if (works === null) return done({ kind: "unavailable" });
    const search: RelatedWorkSearch = { fingerprint: input.fingerprint, yearLimit: input.yearLimit, works };
    const searchedAt = await d.store.write(loaded.articleId, search);
    return done(answerFor({ ...search, searchedAt }, bibliography, loaded.article, input.fingerprint), {
      returned: works.length,
    });
  } catch {
    /* A fetch seam's error can carry its whole address, which carries the
       query, and a database error can carry the titles being written. This
       module's log contract permits neither. */
    d.log.error({ articleId: loaded.articleId, outcome: "internal-error", ms: Date.now() - started }, "related work search failed");
    return { kind: "unavailable" };
  } finally {
    if (token !== null) {
      try {
        await d.allowance.finish(token);
      } catch {
        /* The lease runs out on its own. */
      }
    }
  }
}
