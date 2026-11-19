/**
 * **When a Quiz question comes back for another try from memory** — plan
 * docs/plans/261030c-quiz-keeps-right-or-wrong-and-spacing-adapts.md.
 *
 * > B
 * >
 * > — Greg, 2026-10-30 (spya-dxhyu2), choosing q-m9zkx3's "save right/wrong
 * > with each answer … got it wrong, back in a day; got it right, back in a
 * > week, then longer each time you get it right again"
 *
 * Pure, and run on the server, the one place that sees a question's whole
 * history (src/store/pg-quiz-attempts.ts). The browser receives the answer
 * as `recallAfterDays` and only compares it with the clock
 * (src/web/quiz-recall.ts § `quizLook`); it never works the schedule out.
 *
 * The verdict comes from a cheap hidden check that is sometimes wrong
 * (src/quiz-verdict.ts). So **an unjudged try is never wrong**: it is skipped
 * when counting, and when it is the newest, the question gets the neutral
 * three days rather than inheriting a long interval it has not earned (GPT
 * Sol's plan review, F2).
 */
import type { QuizVerdict } from "./types.js";

/** The neutral interval: nothing judged yet, or the newest try unjudged. 261029m's flat rule. */
export const RECALL_AFTER_DAYS = 3;
/** After a wrong. Greg's number. */
const AFTER_WRONG_DAYS = 1;
/** After a first right. Greg's number; each further right doubles it. */
const AFTER_FIRST_RIGHT_DAYS = 7;
/**
 * **Eight weeks, the ceiling.** A guess: four rights over two months is a
 * question the reader has, and one that comes back less often than this is in
 * an article they may never reopen. One wrong brings it back to a day.
 */
export const MAX_RECALL_AFTER_DAYS = 56;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One finished mark of one question, as the schedule needs it. */
export interface QuizTry {
  /** `quiz_attempts.id`. Not read here; it names the try in the store's order. */
  id: string;
  /** `NULL` in the table: the check failed or declined. Never read as wrong. */
  verdict: QuizVerdict | null;
  /** Epoch ms of `created_at`. */
  at: number;
}

/**
 * **Days until this question is due again**, counted from the newest try.
 *
 * `tries` is one question's history in one batch, **newest first, in the
 * store's own order** (`created_at desc, id desc`) — not re-sorted here,
 * because Postgres orders by the microsecond and a JS time cannot, so two
 * tries in one millisecond would otherwise be ordered differently here and in
 * the read that picked the latest answer (Sol's F3).
 *
 * - Nothing, or the newest unjudged → three days.
 * - Newest judged wrong → one day.
 * - Otherwise the run of rights back to the last wrong, **a right counting
 *   only when it is a day or more before the last one counted**, so answering
 *   again in one sitting does not climb the ladder: `7 × 2^(n−1)`, at most 56.
 */
export function recallAfterDays(tries: readonly QuizTry[]): number {
  const newest = tries[0];
  if (!newest || newest.verdict === null) return RECALL_AFTER_DAYS;
  if (newest.verdict === "wrong") return AFTER_WRONG_DAYS;
  let rights = 0;
  let lastCounted: number | null = null;
  for (const one of tries) {
    if (one.verdict === "wrong") break;
    if (one.verdict !== "right") continue;
    if (lastCounted === null || lastCounted - one.at >= DAY_MS) {
      rights++;
      lastCounted = one.at;
    }
  }
  return Math.min(MAX_RECALL_AFTER_DAYS, AFTER_FIRST_RIGHT_DAYS * 2 ** (rights - 1));
}

/**
 * **`recallAfterDays` off the wire, validated rather than cast** — a whole
 * number from 1 to the ceiling, or the neutral three days for anything else:
 * absent (a server from before 261030c, an offline copy), `null`, a fraction.
 * `undefined` reaching the comparison would make a question never due (Sol's F4).
 */
export function parseRecallAfterDays(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= MAX_RECALL_AFTER_DAYS
    ? raw
    : RECALL_AFTER_DAYS;
}

/**
 * **The history as of one try**: that try and everything older, in the given
 * (newest-first) order. What `record` schedules the mark it has just written
 * from, so a mark that landed a moment later is not counted into this one's
 * schedule (GPT Sol's plan review, F1). Empty — the neutral three days — if
 * the try is not there at all, which the insert just before it rules out.
 */
export function asOf(tries: readonly QuizTry[], id: string): QuizTry[] {
  const at = tries.findIndex((one) => one.id === id);
  return at < 0 ? [] : tries.slice(at);
}
