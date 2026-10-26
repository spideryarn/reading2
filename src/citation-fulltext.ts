/**
 * **Papers that may cite a piece OpenAlex cannot list citers for** — the works
 * that matched OpenAlex's full-text search for the piece's title.
 * *After it*'s and Reception's *Possible citations*, under the `no-doi` and
 * `no-match` sentences. docs/plans/261026f-cited-by-when-there-is-no-doi-from-the-full-text-and-a-web-search.md;
 * the measurements are docs/investigations/261026a-cited-by-with-no-doi-full-text-and-web-search-recall-and-cost.md.
 *
 * ```
 * an article from a public address, with a distinctive title
 * (and six words or more when it has no year):
 *   with a year Y:
 *     1. works?filter=fulltext.search:"<words>",publication_year:<Y-10>-<Y-2>   the count only
 *     2. works?filter=fulltext.search:"<words>",publication_year:<Y-1>-<now>     one page of 25
 *     a phrase found at 3+ works before, and more than 5% of the rate since, ► common-phrase
 *   with none: only 2, with no year filter
 *   OpenAlex's count 0 ► none; else ► found
 * otherwise ───────────────────────────────────────────────► nothing asked (null)
 * ```
 *
 * **Free, so asked when Sources opens** (Greg's cost rule, 2026-10-25), and
 * only when the panel asks with `?with=possible`. Nothing is cached: the title
 * search beside it is made on every open too (plan 261011q), and a cache keyed
 * on a title says who reads what.
 *
 * **A sign, not a citation.** Measured on twelve no-DOI pieces, 33 of the 35
 * readable top-five hits whose list the gate lets through cite the piece. The
 * panel says *possible* and never adds them to a count.
 *
 * **What is sent** is what the title search already sends, the title's words,
 * lower-cased with the punctuation gone but an apostrophe inside a word kept
 * (`fulltextPhraseOf`), so nothing in a title can close the quotes or add a
 * filter; plus a year range. Never the authors,
 * never the text, and never for an uploaded file (`importedFromAPublicAddress`):
 * an upload's title may be the reader's own unpublished work.
 *
 * ## What may be logged from this file
 *
 * The outcome, the counts and the time. Never the title, the phrase or an
 * address, which carries the phrase.
 */

import { registryTitleIsDistinctive } from "./citation-registry.js";
import { tokens } from "./citation-lookup.js";
import { importedFromAPublicAddress } from "./citation-blurbs.js";
import { MAX_FULLTEXT_PHRASE } from "./citer-link.js";
import {
  type ArticleIdentity,
  type CitersDeps,
  articleYear,
  openAlexInTurn,
  parseOpenAlexCiters,
} from "./citation-index.js";
import { log as rootLog, type Log } from "./log.js";
import { CONTACT_EMAIL } from "./site-text.js";
import type { Meta, PossibleCiters } from "./types.js";

/** What the list needs to know of the article: its identity, and whether it was an upload. */
export type PossibleIdentity = ArticleIdentity & Pick<Meta, "filename">;

/** How many works one page lists. The rest are linked at OpenAlex, never fetched. */
export const POSSIBLE_PER_PAGE = 25;
/** With no year there is no gate, so the title itself has to carry the weight. */
export const MIN_WORDS_WITHOUT_YEAR = 6;
/**
 * **The gate's two windows, inclusive, for a piece of year Y.** *Before* is
 * Y-10 to Y-2, nine years in which no work can cite it; *since* is Y-1 to now,
 * the year before kept because preprints, editions and OpenAlex's dates put a
 * real citer there. The list is asked for over *since* alone.
 */
const BEFORE_FROM = 10;
const BEFORE_TO = 2;
const BEFORE_YEARS = BEFORE_FROM - BEFORE_TO + 1;
/** At least this many works before the piece, and… */
export const PHRASE_MIN_BEFORE = 3;
/** …a per-year rate strictly above this share of the per-year rate since, make the title a phrase. */
export const PHRASE_RATE_SHARE = 0.05;
/** A piece this many years old or less is listed newest first: its citers have not been cited yet. */
const RECENT_YEARS = 2;
/** Leading words a record of the piece may carry that its title does not (*A Verbalizable…*). */
const OWN_RECORD_ARTICLES: ReadonlySet<string> = new Set(["a", "an", "the"]);

const FIELDS = "id,doi,display_name,publication_year,cited_by_count,authorships,primary_location,type";

/** What would be asked, or null when nothing should be. */
export interface FulltextQuestion {
  phrase: string;
  year: number | undefined;
}

/**
 * **The title as the phrase OpenAlex's full-text search is sent**: NFKC,
 * lower-cased, letter-and-digit runs joined by single spaces — `tokens`'
 * split, but **keeping an apostrophe inside a word**. `titleQueryOf` drops it
 * (*don't* → *dont*), which `search.title` forgives and the full-text index
 * does not: *Do Things that Don't Scale* matches 31 works with it and none
 * without. An apostrophe cannot end the quoted phrase, add a filter or name an
 * operator, so it is the one mark let through. Null when there are no words.
 */
export function fulltextPhraseOf(title: string): string | null {
  const words = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  let phrase = "";
  for (const word of words) {
    const next = phrase === "" ? word : `${phrase} ${word}`;
    if (next.length > MAX_FULLTEXT_PHRASE) break;
    phrase = next;
  }
  return phrase === "" ? null : phrase;
}

/**
 * **Whether to ask at all, and with what words.** Null for an upload, a title
 * too plain to be the piece's own (`registryTitleIsDistinctive`: *Simulators*),
 * or, with no year to gate it by, one under six words. A year after `now` is
 * no year: its windows would be empty or in the future.
 */
export function fulltextQuestionOf(article: PossibleIdentity, now: number): FulltextQuestion | null {
  if (!importedFromAPublicAddress(article)) return null;
  if (!registryTitleIsDistinctive(article.title)) return null;
  const phrase = fulltextPhraseOf(article.title);
  if (phrase === null) return null;
  const stated = articleYear(article);
  const year = stated !== undefined && stated <= now ? stated : undefined;
  if (year === undefined && tokens(article.title).length < MIN_WORDS_WITHOUT_YEAR) return null;
  return { phrase, year };
}

/**
 * **The works whose full text has the phrase**, one page or only the count,
 * within a year range. A `filter=` built from the phrase's words alone: they
 * have no quotation mark, comma or pipe in them to end the phrase or add a
 * filter, and lower case keeps OpenAlex from reading `AND`, `OR` or `NOT`.
 */
export function openAlexFulltextUrl(
  phrase: string,
  years: { from: number; to: number } | { after: number } | null,
  page: { perPage: number; order: "newest" | "most-cited" } | "count",
): string {
  const range = years === null ? "" : "from" in years ? `,publication_year:${years.from}-${years.to}` : `,publication_year:>${years.after}`;
  const params = new URLSearchParams({ filter: `fulltext.search:"${phrase}"${range}` });
  if (page === "count") {
    params.set("per_page", "1");
    params.set("select", "id");
  } else {
    params.set("per_page", String(page.perPage));
    params.set("sort", page.order === "newest" ? "publication_date:desc" : "cited_by_count:desc,publication_date:desc");
    params.set("select", FIELDS);
  }
  params.set("mailto", CONTACT_EMAIL);
  return `https://api.openalex.org/works?${params.toString()}`;
}

/**
 * **Is the title a phrase rather than the piece's?** A work dated before the
 * piece cannot cite it, so the rate at which the words turn up before is the
 * rate at which they turn up by accident. `before` is the count over the
 * *before* window (nine years), `since` over Y-1 to `now` inclusive. A phrase
 * when `before` is at least three **and** `before / 9` is strictly more than
 * 5% of `since / (now - Y + 2)` — so *since* being zero with three or more
 * before is a phrase too (*Fashionable Problems*, 23 against none). `year` is
 * at most `now` (`fulltextQuestionOf`), so the divisor is at least two.
 */
export function isCommonPhrase(before: number, since: number, year: number, now: number): boolean {
  if (before < PHRASE_MIN_BEFORE) return false;
  const sinceYears = Math.max(1, now - year + 2);
  return before / BEFORE_YEARS > PHRASE_RATE_SHARE * (since / sinceYears);
}

/**
 * **A record of the piece itself**, not a citer: the same words as its title,
 * or those words after a leading *A*, *An* or *The* that one of them carries
 * and the other does not (OpenAlex holds the reported piece as *A Verbalizable
 * Representations…*). Nothing wider: *Response to <the title>*, *Comment on …*
 * and *Revisiting …* are citers (Sol's plan review, F5).
 */
export function isThePiecesOwnRecord(workTitle: string, pieceTitle: string): boolean {
  const bare = (words: string[]) => (words.length > 1 && OWN_RECORD_ARTICLES.has(words[0]!) ? words.slice(1) : words);
  const work = bare(tokens(workTitle));
  const piece = bare(tokens(pieceTitle));
  return piece.length > 0 && work.length === piece.length && work.every((word, i) => word === piece[i]);
}

/** Newest first for a recent piece or one with no year; most cited first otherwise. */
export function orderFor(year: number | undefined, now: number): "newest" | "most-cited" {
  return year === undefined || now - year <= RECENT_YEARS ? "newest" : "most-cited";
}

/** What `possibleCitersOf` needs: the citers' own seams, and a clock for the year. */
export interface PossibleDeps extends CitersDeps {
  now?: () => Date;
}

/**
 * **The possible citations, or null when nothing should be asked.** Never
 * throws: anything OpenAlex or the limiter does is `unavailable`.
 */
export async function possibleCitersOf(article: PossibleIdentity, deps: PossibleDeps = {}): Promise<PossibleCiters | null> {
  const now = (deps.now ?? (() => new Date()))().getUTCFullYear();
  const question = fulltextQuestionOf(article, now);
  if (question === null) return null;
  const log: Log = deps.log ?? rootLog("store").child({ lookup: "citation-fulltext" });
  const started = Date.now();
  const done = (result: PossibleCiters, fields: Record<string, number | string> = {}): PossibleCiters => {
    log.info({ outcome: result.kind, ms: Date.now() - started, ...fields }, "citation fulltext lookup");
    return result;
  };
  const { phrase, year } = question;
  try {
    let before: number | null = null;
    if (year !== undefined) {
      const counted = await openAlexInTurn(
        "fulltext",
        openAlexFulltextUrl(phrase, { from: year - BEFORE_FROM, to: year - BEFORE_TO }, "count"),
        deps,
        "fulltext-count",
      );
      before = counted.kind === "json" ? (parseOpenAlexCiters(counted.json)?.count ?? null) : null;
      if (before === null) return done({ kind: "unavailable" });
    }
    const order = orderFor(year, now);
    const fromYear = year === undefined ? null : year - BEFORE_TO + 1;
    const toYear = year === undefined ? null : now;
    const listed = await openAlexInTurn(
      "fulltext",
      openAlexFulltextUrl(
        phrase,
        fromYear === null || toYear === null ? null : { from: fromYear, to: toYear },
        { perPage: POSSIBLE_PER_PAGE, order },
      ),
      deps,
      "fulltext-list",
    );
    const page = listed.kind === "json" ? parseOpenAlexCiters(listed.json) : null;
    if (page === null) return done({ kind: "unavailable" });
    if (before !== null && year !== undefined && isCommonPhrase(before, page.count, year, now)) {
      return done({ kind: "common-phrase" }, { before, since: page.count });
    }
    const citers = page.citers.filter((c) => !isThePiecesOwnRecord(c.title, article.title));
    if (page.count === 0) return done({ kind: "none" }, { since: page.count });
    const ownRecords = page.citers.length - citers.length;
    const observedEveryResult = page.returned === page.count;
    const everyObservedResultIsOwn = page.dropped === 0 && page.returned > 0 && ownRecords === page.returned;
    if (observedEveryResult && everyObservedResultIsOwn) return done({ kind: "none" }, { since: page.count });
    return done(
      { kind: "found", total: page.count, dropped: page.dropped + ownRecords, order, phrase, fromYear, toYear, citers },
      { since: page.count, listed: citers.length, ...(before !== null ? { before } : {}) },
    );
  } catch {
    /* A fetch seam's message can carry its address, which carries the phrase. */
    log.error({ outcome: "internal-error", ms: Date.now() - started }, "citation fulltext lookup failed");
    return { kind: "unavailable" };
  }
}
