/**
 * **A `CitationInvestigation` as `citation_investigations` columns, and back** —
 * the write half is src/store/pg-citation-investigations.ts, the read half
 * `loadCitations` in src/store/pg.ts. Its own file, importing nothing from
 * either, so src/store/pg.ts can use it without an import cycle.
 */
import type { citationInvestigations } from "../db/schema.js";
import type { CitationInvestigation } from "../types.js";

type Row = typeof citationInvestigations.$inferSelect;
type Columns = Omit<Row, "articleId" | "entryId" | "ownerId">;

/** Every column but the key and the owner — so an upsert replaces the whole answer. */
export function investigationColumns(inv: CitationInvestigation): Columns {
  return {
    answer: inv.answer,
    sources: inv.sources,
    extractsRead: inv.extractsRead,
    longestExtractWords: inv.longestExtractWords,
    matchedHost: inv.matchedHost,
    searches: inv.searches,
    searchesFrom: inv.searchesFrom,
    model: inv.model,
    contextHash: inv.contextHash,
    promptVersion: inv.promptVersion,
    at: new Date(inv.at),
  };
}

/** One stored row as the type the owner's payload carries. */
export function investigationFromRow(row: Row): CitationInvestigation {
  return {
    answer: row.answer,
    sources: row.sources,
    extractsRead: row.extractsRead,
    longestExtractWords: row.longestExtractWords,
    matchedHost: row.matchedHost,
    searches: row.searches,
    searchesFrom: row.searchesFrom,
    model: row.model,
    at: row.at.toISOString(),
    contextHash: row.contextHash,
    promptVersion: row.promptVersion,
  };
}
