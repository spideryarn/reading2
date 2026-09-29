/**
 * **A `CitationLookup` as `citation_finds` columns, and back** — the write
 * half is src/store/pg-citation-finds.ts, the read half `loadCitations` in
 * src/store/pg.ts. One file so the two cannot disagree about a column.
 *
 * The read is strict, as the CHECKs are: a row whose columns do not make a
 * whole lookup reads as none, rather than as a half-lookup the panel would
 * have to guess about. docs/plans/260929g-check-a-cited-paper-supports-the-claim.md.
 */
import type { citationFinds } from "../db/schema.js";
import type { CitationLookup, CitationLookupState, CitationSupport } from "../types.js";

type Row = typeof citationFinds.$inferSelect;
type LookupColumns = Pick<
  Row,
  | "lookupState"
  | "lookupSupport"
  | "lookupSupportQuote"
  | "lookupPaperDoes"
  | "lookupPaperDoesQuote"
  | "lookupExcerptWords"
  | "lookupContextHash"
  | "lookupEvidenceHash"
>;

const STATES: readonly CitationLookupState[] = ["assessed", "no-extract", "not-identified", "unreadable"];
const SUPPORTS: readonly CitationSupport[] = ["supports", "partly", "not-in-extract"];

/** The columns for one lookup — every one of them, null when there is none, so an upsert clears an old reading. */
export function lookupColumns(lookup: CitationLookup | undefined): LookupColumns {
  if (!lookup) {
    return {
      lookupState: null,
      lookupSupport: null,
      lookupSupportQuote: null,
      lookupPaperDoes: null,
      lookupPaperDoesQuote: null,
      lookupExcerptWords: null,
      lookupContextHash: null,
      lookupEvidenceHash: null,
    };
  }
  const assessed = lookup.state === "assessed" ? lookup : null;
  return {
    lookupState: lookup.state,
    lookupSupport: assessed?.verdict.support ?? null,
    lookupSupportQuote: assessed && assessed.verdict.support !== "not-in-extract" ? assessed.verdict.quote : null,
    lookupPaperDoes: assessed?.paperDoes?.says ?? null,
    lookupPaperDoesQuote: assessed?.paperDoes?.quote ?? null,
    lookupExcerptWords: assessed?.excerptWords ?? null,
    lookupContextHash: lookup.contextHash,
    lookupEvidenceHash: lookup.evidenceHash,
  };
}

/** One stored row's lookup, or `undefined` for a find made before lookups, or a row that is not a whole one. */
export function lookupFromRow(
  row: LookupColumns & Pick<Row, "host" | "searches" | "model" | "foundAt">,
): CitationLookup | undefined {
  const state = STATES.find((s) => s === row.lookupState);
  if (!state || !row.lookupContextHash || !row.lookupEvidenceHash) return undefined;
  const base = {
    host: row.host,
    searches: row.searches,
    model: row.model,
    at: row.foundAt.toISOString(),
    contextHash: row.lookupContextHash,
    evidenceHash: row.lookupEvidenceHash,
  };
  if (state !== "assessed") return { ...base, state };

  const support = SUPPORTS.find((s) => s === row.lookupSupport);
  if (!support || row.lookupExcerptWords === null) return undefined;
  let verdict: Extract<CitationLookup, { state: "assessed" }>["verdict"];
  if (support === "not-in-extract") verdict = { support };
  else if (row.lookupSupportQuote) verdict = { support, quote: row.lookupSupportQuote };
  else return undefined;
  const paperDoes =
    row.lookupPaperDoes && row.lookupPaperDoesQuote
      ? { says: row.lookupPaperDoes, quote: row.lookupPaperDoesQuote }
      : undefined;
  return {
    ...base,
    state,
    excerptWords: row.lookupExcerptWords,
    verdict,
    ...(paperDoes ? { paperDoes } : {}),
  };
}
