/**
 * **How much author data one article may carry**, from either source — a web
 * page's `citation_author` tags (src/meta-authors.ts) or a PDF's front page
 * (src/pdf-authors.ts).
 *
 * Both are a stranger's text, and the list becomes `meta.byline`, which every
 * paid prompt prints on its `BY:` line and every page load ships. Without a cap
 * a page with three thousand `citation_author` tags — a real shape for a
 * high-energy physics collaboration — is a 60 KB byline in front of every
 * model call. GPT Sol, plan review of 260929d, P1.
 *
 * - **100 authors.** A web page with more keeps its first hundred, in order; a
 *   PDF answer with more is refused whole, since there the list is a model's
 *   proposal rather than the page's declaration.
 * - **10 affiliations each**, the rest dropped (web) or refused (PDF).
 * - **120 characters a name, 300 an affiliation.** A value over the cap is
 *   dropped (web) or refused (PDF); either is a sign the text is not what its
 *   tag says it is.
 */
import type { Author } from "./types.js";

export const AUTHOR_LIMITS = {
  maxAuthors: 100,
  maxAffiliations: 10,
  maxNameChars: 120,
  maxAffiliationChars: 300,
} as const;

/**
 * **`article_revisions.authors`, read back as the shape it claims to be.**
 *
 * The column's CHECK only says "an array" (src/db/schema.ts) — anything inside
 * is ours to hold to, and a JSONB column has more than one writer over its life
 * (a backfill, an import, a hand-run fix). A value that is not a list of
 * `{name, affiliations[]}` strings reads as *no list*, so the reading view
 * falls back to the byline rather than crashing on `author.affiliations.map`.
 * GPT Sol, plan review of 260929d, P2.
 */
export function decodeAuthors(value: unknown): Author[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > AUTHOR_LIMITS.maxAuthors) return null;
  const out: Author[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { name, affiliations } = item as { name?: unknown; affiliations?: unknown };
    if (typeof name !== "string" || name === "" || name.length > AUTHOR_LIMITS.maxNameChars) return null;
    if (
      !Array.isArray(affiliations) ||
      affiliations.length > AUTHOR_LIMITS.maxAffiliations ||
      !affiliations.every(
        (a) => typeof a === "string" && a.length > 0 && a.length <= AUTHOR_LIMITS.maxAffiliationChars,
      )
    ) {
      return null;
    }
    out.push({ name, affiliations: affiliations as string[] });
  }
  return out;
}
