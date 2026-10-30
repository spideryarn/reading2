/**
 * **How an answered Quiz question looks, and when it is time to recall it
 * again** — plan 261029m.
 *
 * > find a way to give positive feedback for them answering, and even more
 * > positive feedback if they got it right, and maybe some other indication if
 * > it's sort of stale or previous and you think that it's time that they
 * > reminded themselves. So if you want to build in a kind of basic version of
 * > the spacing effect somehow, that could be good.
 * >
 * > — Greg, 2026-10-29 (spya-v2aehw)
 *
 * Pure, so both surfaces (the margin's line, the band's question) draw the
 * same look from the same kept answer. Nothing here is stored: `answeredAt` is
 * the kept row's own time, and `verdict` is the hidden check's word from a mark
 * given this visit, held in memory only (privacy.md § Quiz answers).
 */
import type { KeptAnswer } from "./useQuiz.js";

/**
 * **Due once the last answer is this many days old** — 72 hours, compared as
 * instants, so no time zone or calendar day comes into it. A product
 * heuristic, not a number the research picks: retrieval beat re-reading at two
 * days and a week in the studies our evidence note cites, and three days is
 * short enough that a reader who takes a week over an article meets it. Fixed,
 * not expanding: an expanding schedule needs each try's history and how well
 * it went, and the verdict is not stored (plan 261029m § The spacing rule).
 */
export const RECALL_AFTER_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type QuizLook = "none" | "answered" | "right" | "due";

/** Whole days since `answeredAt`; 0 for a time in the future (a fast clock). */
export function daysSince(answeredAt: string, now: number): number {
  const at = Date.parse(answeredAt);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.floor((now - at) / DAY_MS));
}

/**
 * Due over right over answered. A due answer is days old, so it never carries
 * this visit's verdict anyway; the order only says which wins if it somehow did.
 */
export function quizLook(kept: Pick<KeptAnswer, "answeredAt" | "verdict"> | undefined, now: number): QuizLook {
  if (!kept) return "none";
  if (daysSince(kept.answeredAt, now) >= RECALL_AFTER_DAYS) return "due";
  if (kept.verdict === "right") return "right";
  return "answered";
}

/**
 * **The look, given the words in this surface's box.** *Right* belongs to the
 * answer that was judged; with different words in the box (the other surface
 * marked, this one holds a draft) it would vouch for words nobody judged, so it
 * steps down to plain answered. GPT Sol's plan review of 261029m, F4.
 */
export function quizLookFor(
  kept: Pick<KeptAnswer, "answer" | "answeredAt" | "verdict"> | undefined,
  now: number,
  draft: string,
): QuizLook {
  const look = quizLook(kept, now);
  const words = draft.trim();
  if (look === "right" && kept && words !== "" && words !== kept.answer) return "answered";
  return look;
}

/** The class each look wears, on the margin's line and the band's question alike. */
export function quizLookClass(look: QuizLook): string {
  switch (look) {
    case "none":
      return "";
    case "answered":
      return "quiz-answered";
    case "right":
      return "quiz-answered quiz-right";
    case "due":
      return "quiz-answered quiz-due";
    default: {
      const never: never = look;
      return never;
    }
  }
}

/** What a screen reader hears after the question's words. */
export function quizLookSpoken(look: QuizLook, days: number): string {
  switch (look) {
    case "none":
      return "";
    case "answered":
      return " (answered)";
    case "right":
      return " (answered; the check thought it looked right)";
    case "due":
      return ` (answered ${agoWords(days)}: worth trying again from memory)`;
    default: {
      const never: never = look;
      return never;
    }
  }
}

/** "5 days ago", "a week ago" — the box's line and the spoken suffix share it. */
export function agoWords(days: number): string {
  if (days >= 14) return `${Math.floor(days / 7)} weeks ago`;
  if (days >= 7) return "a week ago";
  return `${days} days ago`;
}
