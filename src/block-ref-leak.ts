/**
 * **A passage named by our handle for it, in words a reader sees.**
 *
 * Until 2026-09-28, `articleWithIds` (src/article-prompt.ts) showed the article
 * as numbered, id-tagged blocks; the structure prompts still do. A model shown
 * that machinery sometimes names a passage by it instead of by what it says:
 * *"you can see it again later, in block 39"*, *"Block [spya-dfqq59] gives the
 * publication details"*. The number is one the reader has never seen, and an
 * id becomes a chip showing six random characters, so the sentence points at
 * nothing they can recognise.
 * docs/plans/260928c-block-refs-shown-to-readers.md.
 *
 * This is the one definition of that leak, used by the tests and by the log
 * lines of chat and Explain. It is deliberately narrow: the word *block*
 * followed by a number or an id. "Section 4" and "[10]" are left alone, because
 * an article numbers its own sections and references, and a reader can find
 * those. **It still over-counts one case**: an article whose own subject has
 * numbered blocks ("block 3 of the trial", a genomics paper's "Blocks 1-4") —
 * so it is a screen for a log line, never a guard that rewrites an answer.
 */

/** "block 39", "block [39]", "blocks 27–28", "block #3" — a prompt ordinal. */
const BLOCK_NUMBER = /\bblocks?\s+(?:#\s*\d+|\[\s*\d+\s*\]|\d+)/gi;

/**
 * "block spya-dfqq59", "Block [spya-dfqq59]", "the next block, spya-f6sbgx" —
 * an id used as the passage's name. A little punctuation may sit between.
 */
const BLOCK_ID = /\bblocks?[\s,:(]+\[?\s*spya-[a-z0-9]{6}/gi;

/** Every internal block reference in `text`, as written, in order. */
export function blockRefLeaks(text: string): string[] {
  const found: { at: number; text: string }[] = [];
  for (const re of [BLOCK_NUMBER, BLOCK_ID]) {
    for (const m of text.matchAll(re)) found.push({ at: m.index, text: m[0] });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.text);
}

/**
 * Every id-shaped string in `text`, for an answer that is **rendered as plain
 * text** (Explain, src/web/CommentDialog.tsx), where any id at all reaches the
 * reader as `spya-f6sbgx`. Chat turns ids into links, so it counts only
 * `blockRefLeaks`.
 */
export function rawIds(text: string): string[] {
  return text.match(/spya-[a-z0-9]{6}/g) ?? [];
}
