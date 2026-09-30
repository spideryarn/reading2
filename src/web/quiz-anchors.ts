/**
 * **Where each quiz question sits in the prose** — after the block holding its
 * last evidence passage, in document order. No DOM, no React: `Reader` draws,
 * this decides.
 *
 * > if you've generated quiz questions, it should always show them in situ in
 * > the text, whether you're in quiz mode or not.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-6V)
 *
 * **The last passage, not the first**: only after it has the reader met all of
 * what the question is about, which is the "what did you take away from that
 * last section?" Greg remembered from decorated.html. Questions that land on
 * the same block keep the path's order, so a later step never shows above the
 * one it builds on. docs/plans/260930i-quiz-questions-in-the-prose-and-in-trajectory-stops.md.
 */
import type { BlockId, QuizQuestion } from "../types.js";

/**
 * Block id → the questions to hang after it, in path order.
 *
 * A question none of whose evidence blocks is still in the article is not
 * placed: there is nowhere true to put it. Ids are compared as ids and
 * ordered by their index in `blockOrder`, never by the id string
 * (docs/project/block-ids.md).
 */
export function questionsByAnchor(
  questions: readonly QuizQuestion[],
  blockOrder: readonly BlockId[],
): Map<BlockId, QuizQuestion[]> {
  const index = new Map(blockOrder.map((id, i) => [id, i] as const));
  const out = new Map<BlockId, QuizQuestion[]>();
  for (const q of questions) {
    let anchor: BlockId | null = null;
    let at = -1;
    for (const e of q.evidence) {
      const i = index.get(e.blockId);
      if (i !== undefined && i > at) {
        at = i;
        anchor = e.blockId;
      }
    }
    if (anchor === null) continue;
    const list = out.get(anchor);
    if (list) list.push(q);
    else out.set(anchor, [q]);
  }
  return out;
}
