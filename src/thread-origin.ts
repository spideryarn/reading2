/**
 * **A thread's origin, between `ThreadOrigin` and its seven columns** on
 * `chat_threads` — both directions, in one file.
 *
 * The store, the export and the test seeder each name a thread's fields by
 * hand, and a field missed in one of them is lost without an error (`tools`
 * and `help` each went that way once). So the mapping is here and they call
 * it. Pure, with no store behind it, so src/store/export.ts can use it while
 * still reading the database directly.
 *
 * Plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D1;
 * the lens is docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md, A.
 */
import { currentOriginMode, type ThreadOrigin } from "./types.js";

/** The seven columns, as a row holds them. The last two are a quiz mark's (plan 261024i, stage 2). */
export interface OriginColumns {
  originMode: string | null;
  originItemId: string | null;
  originBlockId: string | null;
  originQuote: string | null;
  originLens: string | null;
  originBatchId: string | null;
  originAttemptId: string | null;
}

const NO_ORIGIN: OriginColumns = {
  originMode: null,
  originItemId: null,
  originBlockId: null,
  originQuote: null,
  originLens: null,
  originBatchId: null,
  originAttemptId: null,
};

/** What to write for a thread. All null for a thread with no origin. */
export function originColumns(origin: ThreadOrigin | undefined): OriginColumns {
  if (!origin) return { ...NO_ORIGIN };
  switch (origin.mode) {
    case "reception":
      /* A lens: the reader's angle, no block and no words. */
      return { ...NO_ORIGIN, originMode: "reception", originLens: origin.lens };
    case "sources-claims":
      /* A claim: its block and its words, no lens. */
      return { ...NO_ORIGIN, originMode: "sources-claims", originBlockId: origin.blockId, originQuote: origin.quote };
    case "glossary":
    case "bibliography":
    case "ideas":
    case "situate":
    case "sources-digest":
    case "summary":
      /* An id and a snapshot of the name (a finding's: its passage; a digest's
         or a summary level's: its opening words); no block, no lens. */
      return { ...NO_ORIGIN, originMode: origin.mode, originItemId: origin.itemId, originQuote: origin.quote };
    case "cite-check":
      /* A citation's check: the work's id, the citing block, the title; no lens. */
      return {
        ...NO_ORIGIN,
        originMode: "cite-check",
        originItemId: origin.itemId,
        originBlockId: origin.blockId,
        originQuote: origin.quote,
      };
    case "quiz":
      /* A mark: the question's id and words, its batch and its attempt. */
      return {
        ...NO_ORIGIN,
        originMode: "quiz",
        originItemId: origin.itemId,
        originQuote: origin.quote,
        originBatchId: origin.batchId,
        originAttemptId: origin.attemptId,
      };
    default:
      return origin satisfies never;
  }
}

/**
 * The columns back as the union, **as a fragment to spread**, so a thread with
 * no origin gets no `origin` key at all rather than `origin: undefined`.
 *
 * A mode this code does not know reads as no origin: the thread is still an
 * ordinary chat. So does a
 * row that is not one shape exactly, which the CHECKs refuse
 * (`chat_threads_origin_reception`, `chat_threads_origin_sources_claims`,
 * `chat_threads_origin_debate`, `chat_threads_origin_item`,
 * `chat_threads_origin_cite_check`, `chat_threads_origin_quiz`,
 * `chat_threads_origin_sources_digest`, `chat_threads_origin_summary`); half of one is
 * never read as the whole.
 *
 * **Not exhaustive by construction**: `originMode` is a string out of a
 * database, so a new arm of the union has to be added here by hand.
 */
export function originFromColumns(row: OriginColumns): { origin?: ThreadOrigin } {
  const {
    originItemId: itemId,
    originBlockId: blockId,
    originQuote: quote,
    originLens: lens,
    originBatchId: batchId,
    originAttemptId: attemptId,
  } = row;
  /* A row written before 2026-10-09 may say `citations`, read as
     `bibliography`, or `debate`, read by its shape as `reception` (a lens) or
     `sources-claims` (a claim) — `currentOriginMode`, plan 261009w. */
  const mode = currentOriginMode(row.originMode, lens);
  if (mode === "quiz") {
    if (itemId === null || quote === null || batchId === null || attemptId === null || blockId !== null || lens !== null) {
      return {};
    }
    return { origin: { mode: "quiz", batchId, itemId, attemptId, quote } };
  }
  /* Only a quiz mark names a batch or an attempt (`chat_threads_origin_quiz_only`). */
  if (batchId !== null || attemptId !== null) return {};
  if (
    mode === "glossary" ||
    mode === "bibliography" ||
    mode === "ideas" ||
    mode === "situate" ||
    mode === "sources-digest" ||
    mode === "summary"
  ) {
    if (itemId === null || quote === null || blockId !== null || lens !== null) return {};
    return { origin: { mode, itemId, quote } };
  }
  if (mode === "sources-claims" && itemId === null && blockId !== null && quote !== null && lens === null) {
    return { origin: { mode: "sources-claims", blockId, quote } };
  }
  if (mode === "cite-check" && itemId !== null && blockId !== null && quote !== null && lens === null) {
    return { origin: { mode: "cite-check", itemId, blockId, quote } };
  }
  if (mode === "reception" && itemId === null && blockId === null && quote === null && lens !== null) {
    return { origin: { mode: "reception", lens } };
  }
  return {};
}
