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
 * reaches the fetcher and the database. This file imports nothing.
 */

/** OpenAlex's id for a work, as it appears after `https://openalex.org/`. */
export const OPENALEX_WORK_ID = /^W\d{1,15}$/;

/** `https://doi.org/<doi>` when there is a DOI, else the work's OpenAlex page, else null. */
export function citerUrl(citer: { doi?: string; openalexId: string }): string | null {
  if (citer.doi !== undefined) return `https://doi.org/${citer.doi}`;
  return OPENALEX_WORK_ID.test(citer.openalexId) ? `https://openalex.org/${citer.openalexId}` : null;
}
