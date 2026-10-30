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
 * same look from the same kept answer: `answeredAt` is the kept row's own
 * time, `verdict` the hidden check's word, and `recallAfterDays` the
 * schedule the server worked out from the question's history — all three
 * stored since plan 261030c (Greg's option B on q-m9zkx3; privacy.md § Quiz
 * answers). This file only compares them with the clock.
 */
import type { KeptAnswer } from "./useQuiz.js";

/* **Due once the last answer is `recallAfterDays` old**, compared as instants
   (whole 24-hour days), so no time zone or calendar day comes into it. Until
   plan 261030c it was a flat three days for every answer; the schedule is now
   src/quiz-spacing.ts, on the server. */
const DAY_MS = 24 * 60 * 60 * 1000;

export type QuizLook = "none" | "answered" | "right" | "due";

/** Whole days since `answeredAt`; 0 for a time in the future (a fast clock). */
export function daysSince(answeredAt: string, now: number): number {
  const at = Date.parse(answeredAt);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.floor((now - at) / DAY_MS));
}

/**
 * Due over right over answered. A *right* answer that has come due is shown
 * due: it is time to try it from memory, and the green it earned a week ago
 * is not the point any more.
 */
export function quizLook(
  kept: Pick<KeptAnswer, "answeredAt" | "verdict" | "recallAfterDays"> | undefined,
  now: number,
): QuizLook {
  if (!kept) return "none";
  if (daysSince(kept.answeredAt, now) >= kept.recallAfterDays) return "due";
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
  kept: Pick<KeptAnswer, "answer" | "answeredAt" | "verdict" | "recallAfterDays"> | undefined,
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
      /* Qualified, because the check is fallible: what the deeper green says
         to a sighted reader, said to a screen reader. Not visible words (plan
         261029m, its Sol F6; kept in 261030c, where the code review's C3 to
         drop it was declined). */
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
  if (days === 1) return "a day ago";
  return `${days} days ago`;
}
