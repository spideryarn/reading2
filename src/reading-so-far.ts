/**
 * **How much of the article the reader has read, as one line a chat turn is
 * told** — Greg's answer to docs/user-feedback/questions/q-rwkq2e.md:
 *
 * > I'm leaning towards A.
 * >
 * > — Greg, 2026-10-20 (`spya-p9bhxh`)
 *
 * Option A was one short line, "worked out the same way the quiz already
 * decides what you have read", which the chat uses to pitch its answer and
 * never mentions. Plan
 * docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md.
 *
 * **The quiz's rule, not a second one.** A block is read at `readLevel`'s
 * level 2 (70% of its reading time on screen, `isRead`), the share is by words
 * over body blocks (`countsTowardReadingTime`) — what Reader.tsx hands the
 * quiz as `bodyWords` — and only blocks in the current article count, so a
 * total left over from a re-extraction does not.
 *
 * **Coarse words, never a number.** Seconds on screen are a rough guide to
 * reading, and a model treats a percentage as a fact. The privacy page
 * promises a rough figure and nothing about which parts
 * (docs/project/privacy.md § Reading time): a finer line rewrites that first.
 */
import { countsTowardReadingTime } from "./block-policy.js";
import type { Block, BlockId } from "./types.js";
import { readBand, shareRead } from "./web/read-filter.js";
import { type ReadLevel, readLevel } from "./web/reading-time.js";

export const READING_SO_FAR_HEADING = "READING SO FAR";

/** The share of the body read, 0 to 1, by the quiz's rule. */
export function readingShare(seconds: Readonly<Record<string, number>>, blocks: readonly Block[]): number {
  const levels = new Map<BlockId, ReadLevel>();
  const words = new Map<BlockId, number>();
  for (const b of blocks) {
    if (!countsTowardReadingTime(b)) continue;
    words.set(b.id, b.words);
    levels.set(b.id, readLevel(seconds[b.id] ?? 0, b.words));
  }
  return shareRead(levels, words);
}

/**
 * The share in words a model will not mistake for a measurement, on the
 * masthead pie's bands (read-filter.ts § `readBand`) so the chat is never told
 * "about three quarters" while the pie says Finished. Started is split once
 * more, because a model can use the difference and the pie has no room for it.
 * Plan 261025j.
 */
export function shareWords(share: number): string {
  const band = readBand(share);
  switch (band) {
    case "none":
      return "little or none of it yet";
    case "started":
      return share < 0.15 ? "a small part of it" : "about a quarter of it";
    case "half":
      return "about half of it";
    case "most":
      return "about three quarters of it";
    case "finished":
      return "most or all of it";
    default: {
      const never: never = band;
      return never;
    }
  }
}

/**
 * The line, with its rule beside it so the two travel together.
 *
 * Three things GPT Sol's plan review (docs/plans/261020ac-plan-review-sol.md)
 * changed, each a sentence here:
 *
 * - **It is not the reader saying they have read it** (F1). Learn will not ask
 *   what they remember, and the guide treats them as about to read, until
 *   they *say* otherwise; a rough share must not count as saying so, or the
 *   line and those rules contradict each other.
 * - **Asked, it is told, not hidden** (F4). "Never mention it" would have a
 *   candid chat dodge "what can you see about my reading?". Unasked, it stays
 *   silent, as the profile does.
 * - **No "search" or "tool" in it** (F3): a help turn's final message must not
 *   name either (tests/help-prompt.test.ts). The phrase is coarse enough that
 *   a search carrying it would reveal next to nothing.
 */
export function readingSoFarLineFor(share: number): string {
  return `${READING_SO_FAR_HEADING} (a rough guide, from how long each part of the piece has been on their screen): ${shareWords(share)}.
Use it silently, to pitch your answer. It does not say which parts they have read, and it does not count as their telling you they have read any of it. If they ask what you know about their reading, say plainly that you are told roughly how much of the piece has been on their screen, and nothing about which parts.`;
}

export function readingSoFarLine(seconds: Readonly<Record<string, number>>, blocks: readonly Block[]): string {
  return readingSoFarLineFor(readingShare(seconds, blocks));
}
