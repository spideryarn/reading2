/**
 * **The address of a paper that cites the article, built by us.**
 *
 * OpenAlex is an outside party, so nothing it sends is used as a link: the
 * address is made here from the citing paper's DOI, or from its OpenAlex id
 * when it has none. Both were shape-checked before they were stored
 * (src/citation-index.ts), and the id is checked again here because this is
 * the line that puts it in an `href`.
 * docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md.
 *
 * **A module of its own so the browser can import it**: src/citation-index.ts
 * reaches the fetcher and the database. This file imports only src/doi-url.ts,
 * which imports nothing.
 */

import { doiUrl } from "./doi-url.js";

/** OpenAlex's id for a work, as it appears after `https://openalex.org/`. */
export const OPENALEX_WORK_ID = /^W\d{1,15}$/;
/** The longest full-text phrase the server makes from an article title. */
export const MAX_FULLTEXT_PHRASE = 300;

/** `https://doi.org/<doi>` when there is a DOI, else the work's OpenAlex page, else null. */
export function citerUrl(citer: { doi?: string; openalexId: string }): string | null {
  if (citer.doi !== undefined) return doiUrl(citer.doi);
  return OPENALEX_WORK_ID.test(citer.openalexId) ? `https://openalex.org/${citer.openalexId}` : null;
}

/**
 * **OpenAlex's own page for a full-text search**, the *See all* link under
 * *Possible citations* (plan 261026f): the same phrase and the same inclusive
 * year window as the count beside it. The phrase is ours, made from the
 * article's title by `fulltextPhraseOf`, and goes in as one encoded parameter,
 * so it cannot add a filter or change the address.
 */
export function openAlexFulltextPageUrl(phrase: string, fromYear: number | null, toYear: number | null): string {
  const range = fromYear === null || toYear === null ? "" : `,publication_year:${fromYear}-${toYear}`;
  return `https://openalex.org/works?${new URLSearchParams({ filter: `fulltext.search:"${phrase}"${range}` }).toString()}`;
}
