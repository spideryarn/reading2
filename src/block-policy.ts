/**
 * **What each part of the machinery may do with a block** — five named
 * questions, in one place, instead of one Boolean asked to mean five things.
 *
 * ## Why this module exists
 *
 * Before it, `Block.gistable` was the only axis, and every consumer read it
 * directly and meant something different by it. Measured rather than reasoned
 * about (docs/plans/footnotes.md § `gistable: false` is not the switch):
 *
 * | consumer | what `gistable: false` did |
 * |---|---|
 * | src/library-search.ts, src/chat-tools.ts | skipped the block |
 * | src/article-prompt.ts | included every block regardless |
 * | src/labels.ts, src/toc.ts | no nav label, no gist |
 * | src/article-vectors.ts, src/similar.ts | not embedded |
 * | src/library-scalars.ts, src/web/stats.ts | counted anyway |
 *
 * So the obvious way to hide a footnote from the argument — set `gistable:
 * false` on it — produces the **opposite** of the intended policy: notes hidden
 * from search, present in every model prompt, and still on the clock.
 *
 * ## They are not five spellings of one formula
 *
 * Defining each of these as `gistable && treatment !== "supplement"` is the
 * obvious move and it is wrong in two of the five. GPT Sol was explicit about
 * this before any of it was built
 * (docs/plans/footnotes-stage345-upfront-sol.md, decision 3):
 *
 * - `isSearchable` — `gistable` alone, **supplements included**. A note is
 *   often the best sentence in the piece, and a reader who searches for it must
 *   find it.
 * - `countsTowardReadingTime` — **body only, regardless of `gistable`**. The
 *   clock counts the words a person reads; whether the ToC could write a row
 *   about a paragraph has nothing to do with how long it takes to read.
 *
 * The other three are the conjunction, and they are three names rather than one
 * because they are three policies that happen to agree today. `isEmbeddable`
 * and `isStructural` would part company the moment similarity wanted a heading.
 *
 * ## `gistable` stays, and this is its only policy-reading consumer
 *
 * `describeBlock` in src/blocks.ts knows things — a pull-quote that repeats
 * body text verbatim — that cannot be reconstructed from `kind` afterwards. So
 * the field keeps its job as the splitter's intrinsic *"this block has
 * independently describable prose"* fact (src/types.ts). What it stopped being
 * is the answer to any of the five questions below. Anything outside this
 * module that reads `block.gistable` to decide behaviour is a policy escaping
 * back into a Boolean.
 *
 * ## Dependency-free, deliberately
 *
 * The client imports this — src/web/stats.ts puts the reading time in the
 * masthead — so it must pull in nothing node-side. Same rule, and the same
 * reason, as src/reading-time.ts beside it. The one import is a type, and types
 * are erased.
 */
import type { Block } from "./types.js";

/**
 * The two fields the policies read, in the shape a caller can actually supply.
 *
 * `null` as well as `undefined` for `treatment`, and that is not defensive
 * padding: the filesystem store carries an **absent** field and Postgres
 * carries a **null** column, and there is one read — `scalarInputsQuery` in
 * src/store/pg.ts — that hands the raw aggregate straight to
 * `articleWordCounts` without going through a `Block` projection to normalise
 * it. A predicate that only understood `undefined` would count every note on
 * the shelf and nowhere else, and the two numbers disagreeing is exactly the
 * failure docs/reusable/silent-success.md is about.
 */
export type Treated = { treatment?: Block["treatment"] | null };
export type Gistable = { gistable: boolean };

/**
 * Body, as opposed to apparatus. The one place `"supplement"` is spelled.
 *
 * Not exported as a policy of its own: it is the shared *term*, and four of the
 * five predicates below are statements about it. Exported so a caller that
 * genuinely wants "is this the argument" — the word count's split, the diagram's
 * anchor edges — can say so without repeating the string.
 */
export function isBody(block: Treated): boolean {
  return block.treatment !== "supplement";
}

/**
 * **May a search hit on this block be shown?** — `gistable` alone.
 *
 * Supplements are **included**, and this is the predicate an over-eager
 * refactor breaks by making it look like the other four. Greg's policy is that
 * a note is part of the document a reader is looking through; hiding it from
 * search is the thing the whole feature exists not to do.
 *
 * Used by src/library-search.ts (the filesystem shelf search) and
 * src/chat-tools.ts (what chat may quote back). `pg-shelf.ts`'s SQL hard-codes
 * `gistable = true` and **must keep doing exactly that** — it is library
 * full-text search, and adding a treatment filter there would contradict this
 * line. tests/library-search.test.ts holds it.
 */
export function isSearchable(block: Gistable): boolean {
  return block.gistable;
}

/**
 * **May an automatic model call read this block as evidence about the piece?**
 * — body only.
 *
 * The summaries, the arc, the ideas, the glossary and the tweet thread all
 * describe the argument, and a bibliography is not part of the argument.
 *
 * **The split does not follow the two prompt builders**, which is the trap.
 * `articleText` and `articleWithIds` in src/article-prompt.ts look like the
 * seam — bare text for the stages that do not cite, ids for the stages that do
 * — and they are not: `ideas` is automatic and sends ids, while `explain`,
 * `search` and `converse` are *asked* and send ids too. Filtering inside the
 * builders is right three times and silently leaves `ideas` reading the
 * bibliography. **So this is applied at the call site**, once per stage, and
 * the request-path stages deliberately do not apply it — a reader who asks a
 * question about a footnote must get an answer about the footnote.
 *
 * Not `gistable`: a code block or a figure caption in the body is evidence the
 * automatic stages see today, and taking it away would be a separate decision
 * nobody has made.
 */
export function isBodyEvidence(block: Treated): boolean {
  return isBody(block);
}

/**
 * **May this block be embedded?** — `gistable` and body.
 *
 * Feeds similarity (src/similar.ts) and the diagram's semantic edges through
 * src/article-vectors.ts. A hundred endnotes embedded alongside the prose make
 * every "related passage" answer about the bibliography.
 *
 * Both of those cache their answers, and both key the cache on a `RECIPE`
 * string precisely because `hashBlocks` cannot see a change to *this* rule.
 * Changing the predicate means bumping the recipe in the same edit, or a cached
 * answer computed under the old rule reports itself current for ever
 * (src/similar.ts § `RECIPE`).
 */
export function isEmbeddable(block: Gistable & Treated): boolean {
  return block.gistable && isBody(block);
}

/**
 * **May the tree write a navigable row about this block?** — `gistable` and
 * body.
 *
 * Nav labels, the ToC's coverage ratio, `planBatches`'s "every block is in
 * exactly one batch", and `assertEveryBlockLabelled`. Those last two throw, so
 * they have to move to this predicate in the same edit as the first two or the
 * pipeline stops on its own assertions.
 *
 * **This does not change the tree's shape.** Leaves still tile every block,
 * notes included — what changes is which of them get a *label*. A row a reader
 * can jump to is a different thing from a row that exists, and the supplement
 * node that gives the apparatus one visible row of its own is stage 4.
 *
 * On a heavily cited piece this is a third of the labelling bill: 41 of gwern's
 * 175 nav labels and 121 of wikipedia's 335 were being bought for footnotes
 * (docs/plans/footnotes.md § Stage 3's input).
 */
export function isStructural(block: Gistable & Treated): boolean {
  return block.gistable && isBody(block);
}

/**
 * **Does this block's word count belong on the clock?** — body only, whatever
 * `gistable` says.
 *
 * The visible one. A reader deciding whether to start gwern was being told 73
 * minutes for an article whose argument is 55; the other eighteen were its
 * endnotes, which nobody reads front to back.
 *
 * `gistable` is deliberately not consulted. A pull-quote that repeats the
 * paragraph above it is `gistable: false` and its words are still on the page
 * and still under the reader's eye — the clock is a statement about reading,
 * not about what the ToC can describe. This is the second of the two predicates
 * that is **not** the conjunction, and inverting it is the mutation that proves
 * these tests can fail.
 */
export function countsTowardReadingTime(block: Treated): boolean {
  return isBody(block);
}

/** The article's words, split by what a reader is actually being asked to read. */
export interface WordCounts {
  /** The argument. This is the number the shelf card and the masthead say out loud. */
  body: number;
  /** Footnotes, endnotes, bibliography — everything `treatment: "supplement"`. */
  supplement: number;
  /** Every block's words. Kept because "plus 1,300 words of notes" needs both halves. */
  total: number;
}

/**
 * **The numerator, derived once.**
 *
 * src/reading-time.ts exists because two places say the duration out loud and
 * nothing would ever have told us they had drifted. It shares the
 * words-per-minute formula and **not** the numerator, so the two callers each
 * summed `b.words` themselves and agreed only by coincidence. Now there are
 * six: the shelf card (src/library-scalars.ts), the masthead
 * (src/web/stats.ts), and the three stages that pick how much output to ask a
 * model for from the article's length (src/tweets.ts, src/ideas.ts,
 * src/glossary.ts). Prompts that exclude the notes while the output sizes
 * include them is the same braiding one layer down.
 *
 * **Not split per `role`.** `docs/plans/footnotes.md` sketched
 * `{ body, footnotes, references, total }`, and only `"footnote"` is ever
 * assigned in v1 — the other four roles are produced by nothing, so a
 * `references` field would be a number that is always zero and a reader-facing
 * label that is always wrong. `treatment` is the axis the policy is actually
 * stated on; when a second role starts being assigned, split it then.
 */
export function articleWordCounts(blocks: readonly (Treated & { words: number })[]): WordCounts {
  let body = 0;
  let total = 0;
  for (const block of blocks) {
    total += block.words;
    if (countsTowardReadingTime(block)) body += block.words;
  }
  return { body, supplement: total - body, total };
}
