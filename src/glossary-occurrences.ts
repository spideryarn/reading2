/**
 * **Where each glossary term is used, worked out against the article as it is
 * now** — one implementation for the three places that need it.
 *
 * - the writer (src/glossary.ts § `buildGlossary`), which stores the answer;
 * - the owner's read (src/store/pg.ts § `loadGlossary`);
 * - the visitor's read (src/store/public-reader.ts).
 *
 * The two reads match again rather than trusting the stored `entry.blocks`,
 * because those were worked out by whichever matcher was current when the list
 * was written. spya-n04d5p: *Delayed win-shift task* was stored with one block
 * of six, and a fix to the matcher (src/term-match.ts § `SEPARATOR`) would
 * otherwise have reached an existing list only when somebody pressed *Find
 * more* — and a visitor has no *Find more*. The prose underlines search only
 * the blocks named here (src/web/annotate.ts § `termMarks`), so a stale list
 * is a missing underline. Plan 261002c.
 *
 * It needs only each block's id and text, which both reads already hold, so
 * it costs a regex pass over data in memory and no query. **Type-only imports
 * and the matcher, nothing else**: the public read graph may not reach
 * src/glossary.ts (tests/public-imports.test.ts).
 */

import { formsOf, termAppears, termPattern } from "./term-match.js";
import type { BlockId } from "./types.js";

/** All a match needs from a block. A full `Block` and a fingerprint row both fit. */
export interface TextBlock {
  id: BlockId;
  text: string;
}

interface Locatable {
  name: string;
  aliases?: readonly string[];
  blocks: BlockId[];
}

/**
 * Every block that uses the term, in document order, under the shared rule.
 *
 * The model is never shown a block id and never returns one, so it cannot
 * invent one: matching the text can only be wrong about *where* a term is. An
 * empty answer is stored rather than smoothed over — see src/glossary.ts §
 * `findOccurrences` for why.
 */
export function occurrencesOf(
  entry: { name: string; aliases?: readonly string[] },
  blocks: readonly TextBlock[],
): BlockId[] {
  const pattern = termPattern(formsOf(entry));
  if (!pattern) return [];
  const found: BlockId[] = [];
  for (const block of blocks) {
    if (block.text && termAppears(block.text, pattern)) found.push(block.id);
  }
  return found;
}

/**
 * First use first; terms used nowhere last, in their existing order. The
 * reasoning is src/glossary.ts § `inDocumentOrder`, which is this.
 */
export function orderByFirstUse<E extends { blocks: readonly BlockId[] }>(
  entries: readonly E[],
  blocks: readonly TextBlock[],
): E[] {
  const position = new Map<BlockId, number>();
  for (const [i, b] of blocks.entries()) position.set(b.id, i);
  const rank = (entry: E): number => {
    const first = entry.blocks[0];
    if (first === undefined) return Number.MAX_SAFE_INTEGER;
    return position.get(first) ?? Number.MAX_SAFE_INTEGER;
  };
  // Index as the tie-break so two entries first used in one block keep a
  // reason for their order rather than an accident.
  return entries
    .map((entry, i) => ({ entry, i, rank: rank(entry) }))
    .sort((a, b) => (a.rank === b.rank ? a.i - b.i : a.rank - b.rank))
    .map((x) => x.entry);
}

/**
 * Each entry with its `blocks` worked out again, in first-use order. Returns
 * new objects; the stored entries are not touched.
 */
export function relocateEntries<E extends Locatable>(
  entries: readonly E[],
  blocks: readonly TextBlock[],
): E[] {
  return orderByFirstUse(
    entries.map((entry) => ({ ...entry, blocks: occurrencesOf(entry, blocks) })),
    blocks,
  );
}
