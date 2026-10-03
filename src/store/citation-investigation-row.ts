/**
 * **A `CitationInvestigation` as `citation_investigations` columns, and back** —
 * the write half is src/store/pg-citation-investigations.ts, the read half
 * `loadCitations` in src/store/pg.ts. Its own file, importing nothing from
 * either, so src/store/pg.ts can use it without an import cycle.
 *
 * **The paper's columns (plan 261001a stage 3) are all null on an answer from
 * before that stage**, and that reads back as no `paper` at all — the row is
 * drawn as it was then. Every other state is read back only with the fields
 * its CHECKs promise; a row that breaks them throws rather than drawing a
 * paper we cannot vouch for.
 */
import type { citationInvestigations } from "../db/schema.js";
import type { PaperUnreadableReason } from "../messages.js";
import type { CitationInvestigation, InvestigatedPaper, PaperMatchedBy } from "../types.js";

/**
 * **Without `created_at`, on purpose.** That column is the first press's time
 * and only the database default writes it; `Columns` is what the upsert sets on
 * a later press, so leaving it out of the type is what stops a re-run naming
 * it and moving it. Nothing reads it back either — it is stored, not shown
 * (docs/plans/261003j-store-when-it-happened-timestamp-audit.md).
 */
type Row = Omit<typeof citationInvestigations.$inferSelect, "createdAt">;
type Columns = Omit<Row, "articleId" | "entryId" | "ownerId">;
type PaperColumns = Pick<
  Columns,
  | "paperState"
  | "paperRequestedUrl"
  | "paperFinalUrl"
  | "paperHost"
  | "paperWords"
  | "paperSentWords"
  | "paperChunks"
  | "paperMatchedBy"
  | "paperUnreadableWhy"
  | "paperEvidenceSha"
  | "paperSelectionVersion"
  | "paperReadAt"
  | "paperPassages"
>;

const NO_PAPER: PaperColumns = {
  paperState: null,
  paperRequestedUrl: null,
  paperFinalUrl: null,
  paperHost: null,
  paperWords: null,
  paperSentWords: null,
  paperChunks: null,
  paperMatchedBy: null,
  paperUnreadableWhy: null,
  paperEvidenceSha: null,
  paperSelectionVersion: null,
  paperReadAt: null,
  paperPassages: null,
};

/** The paper as columns — every one named, so a state cannot leave a stale value behind on an upsert. */
export function paperColumns(paper: InvestigatedPaper | undefined): PaperColumns {
  if (!paper) return NO_PAPER;
  const base = { ...NO_PAPER, paperState: paper.state, paperReadAt: new Date(paper.readAt) };
  switch (paper.state) {
    case "read":
      return {
        ...base,
        paperRequestedUrl: paper.requestedUrl,
        paperFinalUrl: paper.finalUrl,
        paperHost: paper.host,
        paperWords: paper.words,
        paperSentWords: paper.sentWords,
        paperChunks: paper.chunks,
        paperMatchedBy: paper.matchedBy,
        paperEvidenceSha: paper.evidenceSha,
        paperSelectionVersion: paper.selectionVersion,
        paperPassages: paper.passages,
      };
    case "no-address":
      return base;
    case "unreadable":
      return { ...base, paperRequestedUrl: paper.requestedUrl, paperHost: paper.host, paperUnreadableWhy: paper.unreadableWhy };
    case "not-the-full-text":
    case "not-confirmed":
      return { ...base, paperRequestedUrl: paper.requestedUrl, paperFinalUrl: paper.finalUrl, paperHost: paper.host };
    case "identity-conflict":
      return { ...base, paperRequestedUrl: paper.requestedUrl, paperHost: paper.host };
    default: {
      const never: never = paper;
      throw new Error(`unhandled paper state: ${JSON.stringify(never)}`);
    }
  }
}

function need<T>(value: T | null, column: string): T {
  if (value === null) throw new Error(`citation_investigations: ${column} is null where its paper state needs it`);
  return value;
}

/** The paper back from its columns, or `undefined` for an answer from before stage 3. */
export function paperFromRow(row: PaperColumns): InvestigatedPaper | undefined {
  const state = row.paperState;
  if (state === null) return undefined;
  const readAt = need(row.paperReadAt, "paper_read_at").toISOString();
  switch (state) {
    case "read":
      return {
        state,
        requestedUrl: need(row.paperRequestedUrl, "paper_requested_url"),
        finalUrl: need(row.paperFinalUrl, "paper_final_url"),
        host: need(row.paperHost, "paper_host"),
        words: need(row.paperWords, "paper_words"),
        sentWords: need(row.paperSentWords, "paper_sent_words"),
        chunks: need(row.paperChunks, "paper_chunks"),
        matchedBy: need(row.paperMatchedBy, "paper_matched_by") as PaperMatchedBy,
        evidenceSha: need(row.paperEvidenceSha, "paper_evidence_sha"),
        selectionVersion: need(row.paperSelectionVersion, "paper_selection_version"),
        readAt,
        passages: row.paperPassages,
      };
    case "no-address":
      return { state, readAt };
    case "unreadable":
      return {
        state,
        requestedUrl: need(row.paperRequestedUrl, "paper_requested_url"),
        host: need(row.paperHost, "paper_host"),
        unreadableWhy: need(row.paperUnreadableWhy, "paper_unreadable_why") as PaperUnreadableReason,
        readAt,
      };
    case "not-the-full-text":
    case "not-confirmed":
      return {
        state,
        requestedUrl: need(row.paperRequestedUrl, "paper_requested_url"),
        finalUrl: need(row.paperFinalUrl, "paper_final_url"),
        host: need(row.paperHost, "paper_host"),
        readAt,
      };
    case "identity-conflict":
      return {
        state,
        requestedUrl: need(row.paperRequestedUrl, "paper_requested_url"),
        host: need(row.paperHost, "paper_host"),
        readAt,
      };
    default:
      throw new Error(`citation_investigations: unknown paper_state ${JSON.stringify(state)}`);
  }
}

/** Every column but the key, the owner and `created_at` — so an upsert replaces the whole answer, the paper included. */
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
    ...paperColumns(inv.paper),
  };
}

/** One stored row as the type the owner's payload carries. */
export function investigationFromRow(row: Row): CitationInvestigation {
  const paper = paperFromRow(row);
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
    ...(paper ? { paper } : {}),
  };
}
