/**
 * **What you have read** — the reading-time levels turned into a yes or no per
 * block, a yes or no per quiz question, and a share of the piece. No DOM, no
 * clock: `useReadingTime` measures, `reading-time.ts` grades, this decides.
 *
 * > if there's a tick box that defaults to only show me questions for stuff
 * > I've read, and then it would only show quiz questions for the stuff that
 * > the user has read.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-61)
 *
 * docs/plans/260930e-quiz-only-asks-about-what-you-have-read.md is the
 * argument for each rule here.
 */
import type { BlockId, QuizQuestion } from "../types.js";
import type { ReadLevel } from "./reading-time.js";
import type { ReadingTimeStatus } from "./useReadingTime.js";

/**
 * What the quiz is handed about the reader's reading: the levels, whether they
 * can be believed yet, and the words the share is measured in. Absent when
 * reading time is off, which is not the same as having read nothing.
 */
export interface ReadSoFar {
  levels: ReadonlyMap<BlockId, ReadLevel>;
  status: Exclude<ReadingTimeStatus, "off">;
  /** Body blocks only, id to words — see `shareRead`. */
  bodyWords: ReadonlyMap<BlockId, number>;
}

/**
 * The level at which a block counts as read: on screen for at least 70% of
 * the time it takes to read it. Higher is too strict — a brisk reader lands
 * about there on most paragraphs — and below is scrolling past, which is what
 * the quiz filter exists to leave out.
 *
 * **The 70% is the rule; the level number follows it.** It was 3 until
 * 261002e slowed the levels down (reading-time.ts § `readLevel`) and kept a
 * boundary at 0.7 so this could stay put.
 */
export const READ_ENOUGH: ReadLevel = 2;

export function isRead(levels: ReadonlyMap<BlockId, ReadLevel>, id: BlockId): boolean {
  return (levels.get(id) ?? 0) >= READ_ENOUGH;
}

/**
 * A question is about what you have read when **every** passage its
 * reference answer stands on is read. One unread passage among its evidence
 * and the question is partly about something you have not seen.
 *
 * **And every one of them is still in the article.** Reading time keeps totals
 * for block identities a re-extraction removed, and a block the page has no
 * word count for is measured against one second, so an old id reaches level 4
 * almost at once. A stale quiz citing it would otherwise count as read. GPT
 * Sol's finding 4 on the plan.
 */
export function questionIsRead(
  question: QuizQuestion,
  levels: ReadonlyMap<BlockId, ReadLevel>,
  current: { has(id: BlockId): boolean },
): boolean {
  return (
    question.evidence.length > 0 &&
    question.evidence.every((e) => current.has(e.blockId) && isRead(levels, e.blockId))
  );
}

/**
 * The share of the piece read, by words, 0 to 1. Words rather than blocks, so
 * a read heading does not count for as much as a read page. Zero for a piece
 * with no words, rather than dividing by zero.
 *
 * `words` is the caller's choice of what counts, and the reading view passes
 * **body blocks only** (`isBody`, src/block-policy.ts) — the reading-time
 * clock's rule, and the blocks the quiz is written from — so a skipped
 * bibliography does not hold a reader under 100%. GPT Sol's finding 5.
 */
/** The last of an ascending list below `at` — `findLast`, which the web target's lib does not have. */
export function lastBefore(ascending: readonly number[], at: number): number | undefined {
  for (let i = ascending.length - 1; i >= 0; i--) {
    const n = ascending[i] as number;
    if (n < at) return n;
  }
  return undefined;
}

/**
 * The share as words: "about 40%", never "0%" for a little and never "100%"
 * for nearly all — a reader who has read a sentence has not read none of it,
 * and one who has skipped a paragraph has not read all of it.
 */
export function readShareLabel(share: number): string {
  if (!(share > 0)) return "none";
  if (share >= 1) return "all";
  const pct = Math.round(share * 100);
  if (pct < 1) return "under 1%";
  if (pct > 99) return "over 99%";
  return `about ${pct}%`;
}

export function shareRead(levels: ReadonlyMap<BlockId, ReadLevel>, words: ReadonlyMap<BlockId, number>): number {
  let total = 0;
  let read = 0;
  for (const [id, n] of words) {
    const w = Math.max(0, n);
    total += w;
    if (isRead(levels, id)) read += w;
  }
  return total > 0 ? read / total : 0;
}
