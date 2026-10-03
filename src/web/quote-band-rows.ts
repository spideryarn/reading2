/**
 * **The Quotes band's rows: the model's quotes and the reader's own highlights,
 * as one list to draw — and nothing else's list.**
 *
 * Greg, 2026-10-03 (spya-ma5h9b), on whether a highlight belongs in Quotes:
 *
 * > highlights show up alongside quotes. They should obviously have a different
 * > color if it's from me, and they should have a tooltip. Actually, quotes
 * > should as well, maybe saying when it was applied and whether it's AI
 * > generated or human highlights.
 *
 * ## A projection for the panel, built at render
 *
 * `QuoteBandRow[]` exists only between `QuotesPanel` and its markup. Everything
 * else that reads quotes — `rankQuotes`, `visibleQuotes`, `markedQuotes`, the
 * bar's stops and its count, `steppable` and the ‹ › stepper, `?quote=`, the
 * prose's outlines and its card, the spine's strip, Skim, the stored and the
 * public artefact — stays `Quote[]` and the model's only. A reader's highlight
 * has no quote id, no score and its own selection state (`?note=`); letting it
 * into any of those would be a second id space behind one parameter. So this
 * function takes the list the panel has **already** ranked and filtered
 * (`shownAiQuotes`) and only places the reader's rows among it.
 * docs/plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md
 * § GPT Sol's plan review, Q2.
 *
 * ## The two `start`s are never compared
 *
 * `Quote.start` is an offset into `block.text`; `Comment.start` is an offset
 * into the block's *rendered* text, which differs wherever there is markup or
 * maths (docs/project/comments.md § Anchoring). Sorting one against the other
 * would be right most of the time and silently wrong the rest. So the
 * interleave is **by block only**: inside one block the reader's rows come
 * first, in their own `start` order, then the model's in the order they were
 * given. That is occasionally the wrong order within a single paragraph, and
 * it is the price of not inventing a comparison (Q1).
 */
import type { BlockId, Comment, HighlightColour, Quote } from "../types.js";
import type { QuoteRank } from "./params.js";
import { exactly } from "./relative-time.js";

/**
 * A comment that is a row in Quotes: **words selected, a colour, and not a
 * Referee placement.** An uncoloured comment or a bookmark never claimed the
 * words were worth keeping; a comment with a `criterionId` is a judgment on a
 * criterion that happens to be anchored, not a reading note (comments.md §
 * Every mark says which of three it is; Q8).
 */
export type ReaderRowComment = Comment & {
  quote: string;
  start: number;
  colour: HighlightColour;
};

/** One row of the band, and whose it is. */
export type QuoteBandRow =
  | { by: "ai"; quote: Quote }
  | { by: "reader"; comment: ReaderRowComment };

export function isReaderRow(comment: Comment): comment is ReaderRowComment {
  return (
    comment.quote !== undefined &&
    comment.colour !== undefined &&
    comment.criterionId === undefined
  );
}

/** The reader's comments that are rows here, in the order they arrived. */
export function readerRowComments(comments: readonly Comment[]): ReaderRowComment[] {
  return comments.filter(isReaderRow);
}

/** A block the article no longer has sorts after every block it does. */
const GONE = Number.MAX_SAFE_INTEGER;

/**
 * The band's rows.
 *
 * @param shownAiQuotes what the panel is showing of the model's list —
 *   `markedQuotes`' answer, already ordered and, in *prioritised*, already cut
 *   by the bar. **Its order is never changed here.**
 * @param reader the reader's rows (`readerRowComments`). The bar never hides
 *   one: they have no score for it to read.
 * @param rank the order actually in force (`effectiveRank`).
 * @param blocks the article's blocks, in reading order.
 *
 * - **In order, and prioritised**: reading order, both kinds, by block; the
 *   reader's first inside a block (the header says why).
 * - **Most important, most striking**: the reader's rows first, as one group in
 *   reading order, then the model's as ranked. They have no score, and
 *   "unscored last" would bury the lines the reader chose themselves.
 * - **A highlight whose block the article no longer has** goes last in its
 *   group: it is still the reader's, and still listed in the drawer.
 */
export function quoteBandRows(
  shownAiQuotes: readonly Quote[],
  reader: readonly ReaderRowComment[],
  rank: QuoteRank,
  blocks: readonly { id: BlockId }[],
): QuoteBandRow[] {
  const ai = shownAiQuotes.map((quote): QuoteBandRow => ({ by: "ai", quote }));
  if (reader.length === 0) return ai;

  const position = new Map<string, number>();
  blocks.forEach((block, i) => {
    position.set(block.id, i);
  });
  const at = (blockId: string): number => position.get(blockId) ?? GONE;

  /* The reader's own order: block, then THEIR `start` — one offset space, so
     this comparison is sound — then when they made it, so two highlights on
     the same words keep a stable order. */
  const mine = [...reader].sort(
    (a, b) =>
      at(a.blockId) - at(b.blockId) ||
      a.start - b.start ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  const yours = mine.map((comment): QuoteBandRow => ({ by: "reader", comment }));

  if (rank === "importance" || rank === "striking") return [...yours, ...ai];

  /* A merge, not a sort: the model's rows keep the order they were given, and
     each is preceded by every reader row at or before its block. `<=` is the
     whole of "the reader's first inside a block". A reader row on a block that
     is gone waits for the end, whatever the model's rows are on. */
  const out: QuoteBandRow[] = [];
  let next = 0;
  for (const row of shownAiQuotes) {
    const here = at(row.blockId);
    while (next < mine.length) {
      const block = at(mine[next]!.blockId);
      if (block === GONE || block > here) break;
      out.push(yours[next++]!);
    }
    out.push({ by: "ai", quote: row });
  }
  while (next < yours.length) out.push(yours[next++]!);
  return out;
}

/**
 * A count of the model's quotes, with the reader's own beside it: `14 quotes`
 * → `14 quotes + 3 yours`. **Appended, never added in**: "5 of 14" is what the
 * bar is holding back of the model's list, and a highlight is not in that list.
 */
export function withYours(count: string, yours: number): string {
  return yours > 0 ? `${count} + ${yours} yours` : count;
}

/**
 * **Who chose this quote, and when** — the last line of its card, in the band
 * and in the prose.
 *
 * `addedAt` is the quote's own time. A quote stored before that field existed
 * (2026-10-03) has none, and the list's `generatedAt` is only an upper bound —
 * the list was written at or after every quote in it — so the line says *on or
 * before*, rather than passing a bound off as a time. With neither (or neither
 * parseable) it still says who.
 */
export function aiProvenance(quote: Pick<Quote, "addedAt">, generatedAt: string | undefined): string {
  const added = exactly(quote.addedAt);
  if (added !== undefined) return `Chosen by the AI · ${added}`;
  const bound = exactly(generatedAt);
  return bound === undefined ? "Chosen by the AI" : `Chosen by the AI · on or before ${bound}`;
}

/**
 * The same line for a reader's row. **"saved", because that is what the date
 * is**: `createdAt`, when the comment was saved. A comment coloured later keeps
 * it, and when the colour went on is not stored (Q7; deferred).
 */
export function readerProvenance(comment: Pick<Comment, "createdAt">): string {
  const saved = exactly(comment.createdAt);
  return saved === undefined ? "Your highlight" : `Your highlight · saved ${saved}`;
}
