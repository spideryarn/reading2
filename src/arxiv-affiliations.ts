/**
 * **An arXiv HTML paper's affiliations, read by the PDF path's authors pass.**
 *
 * A LaTeXML title block gives every author's name in markup that says exactly
 * which span is the name (`latexmlAuthorNames`, src/latexml.ts), but not which
 * of the contacts beside it is the institution: a rule of one affiliation per
 * `ltx_role_affiliation` contact was wrong on 7 of 19 pages, silently
 * (docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md).
 * So the names come from the markup, as before, and the affiliations from the
 * same model call a PDF import makes (src/pdf-authors.ts), **held to the page by
 * the same check**: every affiliation must be the page's own consecutive words,
 * and the names the model returns must be the markup's names, in order, every
 * one. Anything short of that is no affiliations at all, and the names stay as
 * they were.
 *
 * The title block is handed over as the PDF pass's records: one byline record
 * holding the markup's names, and one record per author holding that author's
 * name and everything LaTeXML set beside it. The prompt, the schema and the
 * check are the PDF path's, unchanged — one reader to keep right, not two.
 *
 * Greg, 2026-10-09 (q-qjbb9a, 1A): *"1A as long as it's not too complicated or
 * costly."* docs/plans/261009m-arxiv-html-affiliations-by-the-authors-pass.md.
 */
import { errorFields, log } from "./log.js";
import { type AuthorsReader, affiliationPrintedIn, readAuthors } from "./pdf-authors.js";
import type { FrontMatterItem } from "./pdf-frontmatter.js";
import type { Author } from "./types.js";

/** What `latexmlTitleBlock` (src/latexml.ts) reads off the page before it is rewritten. */
export interface TitleBlock {
  names: readonly string[];
  /** One line per author: the name and everything beside it. */
  creators: readonly string[];
}

const BYLINE_ID = "names";

/** The title block as the PDF authors pass's records. Exported for the test. */
export function titleBlockRecords(block: TitleBlock): FrontMatterItem[] {
  return [
    { id: BYLINE_ID, index: 0, page: 1, type: "paragraph", text: block.names.join(", ") },
    ...block.creators.map((text, i) => ({ id: `author-${i + 1}`, index: i + 1, page: 1, type: "paragraph" as const, text })),
  ];
}

/**
 * The authors with their affiliations, or `null` with why — a refusal is the
 * ordinary outcome of anything not checking out, and the caller keeps the
 * names-only list it already has. An abort is re-thrown; any other failure is
 * the caller's to log.
 */
export async function readArxivAffiliations(
  block: TitleBlock,
  reader: AuthorsReader,
  signal?: AbortSignal,
): Promise<{ authors: Author[] } | { authors: null; note: string }> {
  const verdict = await readAuthors(titleBlockRecords(block), [BYLINE_ID], reader, signal);
  if (!verdict.authors) return { authors: null, note: verdict.note ?? "the authors pass named nobody" };
  /* **The markup's names, every one, in order** — `verifyAuthors` holds each
     name to the byline's words and lets nobody be skipped, but a model that
     split "Ashish Vaswani" into two people would still pass it. */
  const same =
    verdict.authors.length === block.names.length && verdict.authors.every((a, i) => a.name === block.names[i]);
  if (!same) return { authors: null, note: "the authors pass's names were not the title block's" };
  /* **Each affiliation printed beside its own author.** `verifyAuthors` finds
     an affiliation anywhere on the page, which is all a PDF can offer; here the
     markup says which text is whose, so "Google Research" for Vaswani — printed,
     but beside Parmar — is refused (GPT Sol, plan review of 261009m). An
     institution printed once for several authors is refused with it: the
     safe way to be wrong. */
  const own = verdict.authors.every((a, i) =>
    a.affiliations.every((affiliation) => affiliationPrintedIn(block.creators[i] ?? "", affiliation)),
  );
  if (!own) return { authors: null, note: "the authors pass gave an author an affiliation printed beside somebody else" };
  /* Nobody given an institution is the model saying the page prints none,
     which is not worth a list that says so. */
  if (verdict.authors.every((a) => a.affiliations.length === 0)) {
    return { authors: null, note: "the authors pass found no affiliations" };
  }
  return { authors: verdict.authors };
}

/**
 * What `runExtract` is handed to read affiliations with (src/extract.ts): the
 * authors with their affiliations, or `null` to keep the names alone.
 */
export type AffiliationReader = (block: TitleBlock) => Promise<Author[] | null>;

/**
 * **The pipeline's reader, degrading as the PDF path's `authorsOrNothing`
 * does**: a refusal or a failed call is logged and is `null`, so the import
 * goes on with the names alone; an abort is re-thrown. The log line carries a
 * refusal's fixed sentence and a count, never a word of the page.
 */
export function arxivAffiliationReader(reader: AuthorsReader, ctx: { slug: string; signal: AbortSignal }): AffiliationReader {
  return async (block) => {
    try {
      const verdict = await readArxivAffiliations(block, reader, ctx.signal);
      if (verdict.authors) return verdict.authors;
      log("pipeline").info(
        { slug: ctx.slug, step: "extract", authors: block.names.length },
        `extract ${ctx.slug}: no affiliations for the arXiv title block: ${verdict.note}`,
      );
      return null;
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      log("pipeline").warn(
        { slug: ctx.slug, step: "extract", ...errorFields(err) },
        `extract ${ctx.slug}: the arXiv affiliations call was no help; keeping the names alone`,
      );
      return null;
    }
  };
}
