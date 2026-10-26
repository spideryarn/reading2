/**
 * **The later works that cite the piece, with their abstracts** — Situate's own
 * question of OpenAlex (plan 261024o § The step, 4; GPT Sol's S6).
 *
 * Not `citersOf` (src/citation-index.ts): its `Citer` holds no abstract, its
 * cache is shared with Reception's *Cited by*, and widening either for one
 * owner-only step would change what every reader's panel stores. So this asks
 * its own page — the 40 most-cited citing works, with `abstract_inverted_index`
 * — and **reuses everything else**: the identity confirmation (the DOI's record
 * must carry the article's title and an author, or for an arXiv paper at its own
 * arXiv address two of its authors; or one title-search work, which may be
 * twin records asked about together, `cites:W1|W2`: plan 261025h, decision 2),
 * the shared polite limiter, and the citers' text parser. Nothing is cached:
 * Situate runs on a press, a few times a day at most.
 *
 * Free: OpenAlex's anonymous allowance, two or three requests a run.
 *
 * ## What may be logged
 *
 * The outcome and counts — `citation-index.ts`'s rule. Never a title, an
 * author or an address.
 */

import { plainRegistryText, record, list } from "./bibliographic.js";
import {
  type ArticleIdentity,
  type CitersDeps,
  citedIds,
  confirmedWorkOf,
  openAlexInTurn,
  parseOpenAlexCiters,
} from "./citation-index.js";
import { citerUrl } from "./citer-link.js";
import { abstractFromInvertedIndex } from "./related-work.js";
import type { SituateCiter, SituateCitersResult } from "./situate.js";
import { CONTACT_EMAIL } from "./site-text.js";
import { MAX_CITERS } from "./situate.js";

const FIELDS = "id,doi,display_name,publication_year,cited_by_count,abstract_inverted_index";

/** The works citing these OpenAlex ids (`citedIds`), most cited first, `MAX_CITERS` of them, with abstracts. */
export function situateCitersUrl(openalexIds: string): string {
  return (
    `https://api.openalex.org/works?filter=cites:${encodeURIComponent(openalexIds)}` +
    `&sort=cited_by_count:desc&per-page=${MAX_CITERS}&select=${FIELDS}&mailto=${encodeURIComponent(CONTACT_EMAIL)}`
  );
}

/**
 * One page, as citers with abstracts. **`parseOpenAlexCiters` decides every
 * field it knows** — the id's shape, the title's plainness, the DOI, the year,
 * the dedupe — and this only adds each kept record's abstract, matched by its
 * id. A work with no abstract is left out: nothing in it could bear a quote.
 */
export function parseSituateCiters(json: unknown): SituateCiter[] | null {
  const page = parseOpenAlexCiters(json);
  if (page === null) return null;
  const abstracts = new Map<string, string>();
  for (const raw of list(record(json)?.results)) {
    const work = record(raw);
    const id = typeof work?.id === "string" ? work.id.trim().replace(/^https:\/\/openalex\.org\//i, "") : null;
    const abstract = abstractFromInvertedIndex(work?.abstract_inverted_index);
    if (id !== null && abstract !== null && !abstracts.has(id)) abstracts.set(id, abstract);
  }
  const out: SituateCiter[] = [];
  for (const citer of page.citers) {
    const abstract = abstracts.get(citer.openalexId);
    const url = citerUrl(citer);
    const title = plainRegistryText(citer.title, 400);
    if (!abstract || url === null || title === null) continue;
    out.push({
      openalexId: citer.openalexId,
      title,
      ...(citer.year !== undefined ? { year: citer.year } : {}),
      citedByCount: citer.citedByCount,
      abstract,
      url,
    });
  }
  return out;
}

/** The later works that cite this article, or why there are none to read. Never throws. */
export async function situateCiters(
  article: ArticleIdentity | null,
  deps: CitersDeps = {},
): Promise<SituateCitersResult> {
  if (article === null) return { kind: "no-identity" };
  try {
    const confirmed = await confirmedWorkOf(article, deps);
    switch (confirmed.kind) {
      case "confirmed":
        break;
      case "no-doi":
        return { kind: "no-identity" };
      case "not-indexed":
        return { kind: "not-indexed" };
      case "unconfirmed":
      case "no-match":
        return { kind: "unconfirmed" };
      case "unavailable":
      case "too-large":
        return { kind: "unavailable" };
      default: {
        const never: never = confirmed;
        return never;
      }
    }
    const got = await openAlexInTurn(confirmed.key, situateCitersUrl(citedIds(confirmed.target)), deps);
    if (got.kind !== "json") return { kind: "unavailable" };
    const citers = parseSituateCiters(got.json);
    return citers === null ? { kind: "unavailable" } : { kind: "found", citers };
  } catch {
    /* A fetch seam's error can carry its address, and the address carries the
       DOI or the title. Nothing of it is logged here; the outcome is enough. */
    return { kind: "unavailable" };
  }
}
