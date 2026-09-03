/**
 * Pipeline stage 5h — the **quotes**: the lines worth keeping, in the author's
 * own words.
 *
 * **There is no command line here.** Re-running this stage against one
 * article is a job, not a script:
 *
 *   POST /api/jobs { slug, steps: ["quotes"], force: ["quotes"] }
 *
 * That is the path the pipeline itself takes, so it exercises the store
 * writes — the half that actually breaks. The folder-reading CLI this file
 * used to carry was a second way to do the same thing, and was deleted on
 * 2026-09-01 (docs/project/ingest-queue.md § The pipeline is a list, not a function;
 * docs/plans/260831b-finish-the-database-move.md § sub-stage I).
 *
 * Greg, 2026-08-31:
 *
 * > Create a "Quotes" mode that extracts the most central, helpful, interesting
 * > quotes. By default, display them in order. But also have a sub-mode for
 * > ordering them by importance, and a sub-mode for ordering by how
 * > memorable/interesting/striking/lyrical/etc. And add a threshold UI bar, and
 * > a Prioritised mode. Take inspiration from the Glossary mode.
 *
 * The third question the band answers. The glossary asks *what does this word
 * mean*, the ideas ask *what do I have to hold*, and this asks *which lines is
 * it worth carrying out of here* — and it is the only one of the three whose
 * answer is **entirely the article's own prose**. Nothing this stage stores is
 * generated text except two numbers and one caption.
 *
 * *The article's*, and deliberately not *the author's* — see § Whose words
 * these are below. We can prove the words are in the piece; we cannot prove who
 * wrote them, and the promise this stage makes is the one it can keep.
 *
 * ## The one safety property
 *
 * **A quote that `findQuote` cannot locate in the article is dropped, never
 * stored.**
 *
 * Every other stage here can be wrong about a judgment. This one can be wrong
 * about *what the author wrote*, which is a different and worse kind of wrong:
 * a plausible paraphrase, in quotation marks, attributed to a real person, on a
 * page beside the real text. There is exactly one defence and it is
 * src/quote-match.ts, run over every block of the article. The drops are
 * counted and logged, because an invented quote silently discarded looks
 * identical to a quote the model chose not to return —
 * docs/reusable/silent-success.md.
 *
 * ## The model never names a block id
 *
 * This is the glossary's rule (`findOccurrences`) and not the ideas' rule
 * (`validateOccurrences`), and the choice is deliberate. An idea is a
 * proposition with no text of its own, so the only way back to the page is an
 * id the model supplies. A quote *is* text, so the model returns the words and
 * `locate` below finds the block. Three things fall out and all three are worth
 * having: the model cannot invent a location; a quote the model would have
 * misattributed is repaired rather than dropped; and the prompt can send
 * `articleText` rather than `articleWithIds`, which is what makes this stage
 * cache-compatible with the glossary (src/models.ts § ARTICLE_RENDERER —
 * compatible, and only a saving inside one job; see `cacheArticle` below).
 *
 * ## It replaces, it does not append
 *
 * The ideas' lifecycle, for the ideas' reason: a piece has a dozen quotable
 * lines rather than an encyclopaedia of terms, so there is nothing to paginate
 * and running the step again already *is* "find them again". That removes the
 * FORBIDDEN checklist, `existingFor`, "a stale list is not appended to", the
 * `passes` counter and the DELETE route at once. What it keeps is `idsByText`,
 * so a reader's `?quote=` links survive a rewrite.
 *
 * See docs/plans/260831j-quotes-mode.md and docs/project/quotes.md.
 */

import type Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { partsOf } from "./arc.js";
import type { Article } from "./article-input.js";
import { mintUniqueId } from "./ids.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL, effortFor } from "./models.js";
import { stageFailure } from "./job-failure.js";
import { MODEL_REFUSED } from "./messages.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { articleFingerprint, type BlockFingerprint, type MetaFingerprint } from "./source-hash.js";
import { findQuote, type Span } from "./quote-match.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import { parseJsonFrom, readJsonOrNull, stripFence } from "./parse-json.js";
import { articleText } from "./article-prompt.js";
import { articleWordCounts, isBodyEvidence } from "./block-policy.js";
import { PROFILE_RULES, hashProfile, profileSection } from "./profile.js";
import type { Block, BlockId, Meta, Quote, QuoteDrops, Quotes, Tree } from "./types.js";
import type { ArtifactStore } from "./store/artifacts.js";

/**
 * Bumped whenever the prompt changes in a way that changes what a quote *is*.
 *
 * Exported so tests assert against the current value rather than pinning a
 * literal that has to be edited on every bump — a fixture that hardcodes the
 * version tests the fixture.
 */
export const PROMPT_VERSION = "quotes/2";

/** The most quotes one call may return. A piece does not have forty good lines. */
export const MAX_QUOTES = 16;

/**
 * Shorter than this is a phrase, not a quotation.
 *
 * A six-word fragment is not a line worth keeping and it is the length at which
 * `findQuote`'s forgiving second pass starts matching things nobody meant —
 * that pass drops whitespace entirely, so a short needle has very little shape
 * left to be wrong about. The floor is a matcher precaution as much as an
 * editorial one.
 */
export const MIN_QUOTE_CHARS = 30;

/**
 * Longer than this is the paragraph, not a line out of it.
 *
 * Dropped rather than truncated, and that is the rule this stage cannot bend:
 * an ellipsis inside quotation marks attributed to a named author is a claim
 * about what they wrote.
 */
export const MAX_QUOTE_CHARS = 400;

/**
 * How many quotes to ask for — one per ~600 words, clamped to 4–16.
 *
 * Between the glossary's density (one per 400, clamped 6–20: a term is a word
 * the piece happens to use) and the ideas' (one per 800, clamped 3–10: an idea
 * is something the whole argument leans on). A padded quote list is not a weak
 * entry a reader can skip — it is a forgettable line presented as memorable,
 * which discredits the ones around it.
 */
export function suggestedQuotes(words: number): number {
  return Math.min(MAX_QUOTES, Math.max(4, Math.round(words / 600)));
}

/**
 * What this artefact was written from: the blocks, the tree and the metadata
 * head — `articleFingerprint` in src/source-hash.ts, the same definition the
 * other five article-reading stages use.
 *
 * All three are inputs to the question the model was asked. `renderPrompt`
 * builds the skeleton out of `partsOf(tree)` so the model can weigh a line
 * against the shape of the argument, and `articleText` writes `TITLE:`, `BY:`
 * and `PUBLISHED IN:` above the prose.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprint | null,
): string {
  return articleFingerprint(blocks, tree, meta);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function score(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 1) return undefined;
  return value;
}

/** One quote as the model returns it, before any of it has been believed. */
interface RawQuote {
  text?: unknown;
  reason?: unknown;
  importance?: unknown;
  striking?: unknown;
}

/**
 * What was thrown away, and why — re-exported so this stage's callers and its
 * tests name it in one place.
 *
 * **The shape lives in src/types.ts** because it is part of the artefact:
 * `Quotes.discarded` carries it, so the panel can say *"three suggestions were
 * discarded because their wording could not be verified"* rather than leaving
 * the reader with a list that is quietly shorter than the model offered. A log
 * line is invisible to the person the drop happened to — GPT Sol, 2026-08-31.
 */
export type Dropped = QuoteDrops;

/** A fresh set of counters. One per run, threaded through by hand so nothing sums two runs. */
export function noneDropped(): Dropped {
  return { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 };
}

/**
 * **The 0–1 scores the model did not give us. Counts of FIELDS, not of quotes.**
 *
 * Its own shape rather than four more counters on `Dropped`, and the three
 * reasons are all in what `QuoteDrops` already is:
 *
 * - **Nothing here costs the reader a quote.** Every counter on `Dropped` is a
 *   line that is not in the list; every counter here is a line that IS in the
 *   list, carrying one number fewer. Summing the two would be nonsense, and a
 *   type you have to be warned not to add up is the wrong type.
 * - **`Dropped` rides the artefact and crosses to a visitor**
 *   (`Quotes.discarded`, and src/public-types.ts § `PublicQuotes`), because it
 *   is a fact about the list on their screen and the panel says so in a
 *   sentence. This is a fact about our prompt. It is logged and shown to
 *   nobody — a reader cannot act on a score the model failed to write.
 * - Every `quotes.json` written before today lacks these, so putting them on
 *   the stored shape would make the type a claim the data does not support.
 *
 * **Absent and rejected are counted apart because they are different
 * failures.** Absent is a field the model never wrote; rejected is one it wrote
 * wrong — not a number, not finite, or outside 0–1, which `score()` refuses
 * rather than clamps. A counter that only fired inside `score()` would never
 * see the first, which for the glossary (whose prompt *requires* both scores)
 * is precisely the contract violation worth watching.
 *
 * **Per field, and at parse time.** Per field rather than per quote because
 * "`striking` always missing" and "both missing" are different diagnoses. At
 * parse time — inside `place`, over the quotes it accepted — because the
 * question is *did the model obey us*, which is about its answer and not about
 * what survived `dedupeOverlaps` and `MAX_QUOTES` afterwards.
 *
 * Here a missing score is **by design**: the prompt permits omitting one, and
 * `priorityOf` takes a `max` over whichever arrived. A *rejected* one is not —
 * a model that started writing `"high"` for `0.8` would quietly stop the panel
 * offering prioritised order and nothing anywhere would say so.
 * docs/reusable/silent-success.md;
 * docs/plans/260903c-threshold-sliders-hide-below-threshold-items.md § Stage 1.
 *
 * The twin of `GlossaryScoreDrops` in src/glossary.ts. Keep them alike.
 */
export interface QuoteScoreDrops {
  /** `importance` was not there at all. */
  importanceAbsent: number;
  /** `importance` was there and `score()` refused it. */
  importanceRejected: number;
  /** `striking` was not there at all. */
  strikingAbsent: number;
  /** `striking` was there and `score()` refused it. */
  strikingRejected: number;
}

/** A fresh set. One per run, threaded by hand so nothing sums two runs. */
export function noQuoteScoreDrops(): QuoteScoreDrops {
  return { importanceAbsent: 0, importanceRejected: 0, strikingAbsent: 0, strikingRejected: 0 };
}

/**
 * Read one 0–1 score and say, in the counters, what happened to it.
 *
 * **`undefined` is absent; everything else `score()` refuses is rejected.** A
 * JSON `null` therefore lands in `rejected` — the model wrote a value and it
 * was not a number, and calling that "absent" would let a model answer `null`
 * every time without ever moving the counter that means it stopped obeying.
 *
 * Called only where a quote is about to be kept, so a quote dropped for any of
 * `Dropped`'s six reasons never contributes a missing score.
 */
function scoreCounting(
  value: unknown,
  scores: QuoteScoreDrops,
  absent: "importanceAbsent" | "strikingAbsent",
  rejected: "importanceRejected" | "strikingRejected",
): number | undefined {
  if (value === undefined) {
    scores[absent]++;
    return undefined;
  }
  const kept = score(value);
  if (kept === undefined) scores[rejected]++;
  return kept;
}

/** Where one occurrence of a quote sits. */
export interface Placement {
  blockId: BlockId;
  block: Block;
  span: Span;
}

/**
 * What the search found — **three answers, not two**, and the third is the
 * whole reason this is a type rather than `Placement | null`.
 *
 * `absent` is the model paraphrasing: the words are nowhere in the article.
 * `otherVoice` is the model copying correctly out of somebody else's mouth.
 * Those are opposite facts about a run and they are counted separately, so
 * collapsing them into one `null` would put a well-behaved model's honest
 * quotation of Ginsberg into the counter that means *the prompt has drifted*.
 */
export type Located =
  | { kind: "found"; at: Placement }
  | { kind: "otherVoice" }
  | { kind: "absent" };

/** No article has this many repeats of one sentence; the cap is a runaway guard. */
const MAX_OCCURRENCES_PER_BLOCK = 20;

/**
 * Every place these words appear, in document order, block by block.
 *
 * **Every place, not the first** — which is the fix for a real hole. `locate`
 * used to take the first match and hand it straight to `authorVoice`, so a
 * sentence that appeared once inside a pull-quote and again in the author's own
 * prose was rejected on the first occurrence and the second was never
 * considered. The reader lost a legitimate line and the counter blamed the
 * model. GPT Sol, 2026-08-31.
 *
 * Later occurrences inside one block are found by slicing and re-searching.
 * `span.end` comes from `Reduced.ends`, so it is always a character boundary —
 * slicing there cannot cut a surrogate pair in half.
 */
export function* occurrences(quote: string, blocks: readonly Block[]): Generator<Placement> {
  for (const block of blocks) {
    if (!block.text) continue;
    let from = 0;
    for (let n = 0; n < MAX_OCCURRENCES_PER_BLOCK; n++) {
      const span = findQuote(block.text.slice(from), quote, undefined, "spaced");
      if (!span) break;
      yield {
        blockId: block.id,
        block,
        span: { start: from + span.start, end: from + span.end },
      };
      from += span.end;
      if (from >= block.text.length) break;
    }
  }
}

/**
 * Where in the article these words are — **the safety property, in one
 * function so that it is one answer.**
 *
 * The model is never shown a block id and never returns one, so it cannot be
 * wrong about *where*; it can only be wrong about *what*, and that is exactly
 * what this catches. Words that are nowhere in the article are not the
 * article's words, and a quote we cannot find is dropped rather than shown.
 *
 * **Every block, in document order, and every occurrence within a block** — the
 * first one in the author's own voice wins. Searching the whole article rather
 * than one block the model named is what repairs a misattribution instead of
 * dropping it; walking past a rejected occurrence is what stops a pull-quote
 * shadowing the same sentence in the prose.
 *
 * `findQuote` and never a string compare, because it is the rule the browser
 * will use to draw the marks — and `"spaced"`, because the forgiving second
 * pass deletes whitespace and would accept a word the model split in two.
 */
export function locate(quote: string, blocks: readonly Block[]): Located {
  let sawSomething = false;
  for (const at of occurrences(quote, blocks)) {
    sawSomething = true;
    if (authorVoice(at.block, at.span)) return { kind: "found", at };
  }
  return sawSomething ? { kind: "otherVoice" } : { kind: "absent" };
}

/**
 * Is this passage plausibly **in the article's own voice**, rather than
 * something it is quoting?
 *
 * The honest answer to a question we cannot fully answer, and the shape of it
 * matters more than either check inside it. `findQuote` proves the words are in
 * the article. **It says nothing about who wrote them** — and an article is full
 * of other people's sentences. `data/meditations-on-moloch` carries twenty
 * `kind: "quote"` blocks, and the first of them is Ginsberg's *Howl*. It is
 * exactly the striking passage this stage is built to reach for, it verifies
 * perfectly, and offering it in a list headed by the essay's author would be
 * this feature's worst failure wearing its verification badge.
 *
 * Two refusals:
 *
 *  - **a `quote` block** — a `<blockquote>`. Whoever wrote it, the piece has
 *    typographically disowned it. This loses a real thing: an author quoting
 *    their own earlier work, which the Moloch essay also does. That is an
 *    accepted loss, because a reader looking at the list cannot tell the two
 *    apart and we cannot either.
 *  - **a span sitting inside quotation marks** in an ordinary paragraph.
 *
 * ## The second one is deliberately independent of the model's boundaries
 *
 * The first version compared the single characters either side of the span, and
 * GPT Sol walked round it three ways on 2026-08-31. All three are the same
 * mistake — trusting the model to have drawn the span where a person would:
 *
 *  1. **The marks came back inside the quote.** `“…”` included, so the
 *     character before the span was the colon and the character after was
 *     nothing. Answered by peeling the span's own edges first, and treating a
 *     mark found there as evidence *for* the refusal rather than against it.
 *  2. **The closing mark was one character further out.** The model left the
 *     full stop behind, so the character after the span was `.` and not `”`.
 *     Answered by stepping over sentence punctuation before looking.
 *  3. **British-style single quotation marks.** `‘…’` was excluded with the
 *     apostrophes. Answered by including the *curly* singles, which are
 *     typography rather than punctuation inside a word.
 *
 * The straight `'` stays out, and that is the one real trade left: `'…'` around
 * a sentence is ambiguous with an apostrophe, and dropping an author's own
 * emphasised line is worse than keeping a quoted one. A publisher who uses
 * straight singles for direct speech gets past this.
 *
 * **What none of it catches:** an inline quotation with no marks at all, an
 * indirect one, a translated one. Block text carries no provenance, so nothing
 * at this layer can. The answer is either provenance recorded during
 * extraction, or — which is what we do — a promise that matches what the
 * machine can prove: these are **verbatim passages from this article**, not a
 * claim about who wrote them. docs/project/quotes.md § Whose words these are.
 */
export function authorVoice(block: Block, span: Span): boolean {
  /* `kind`, not `tag`. The tag is whatever the publisher wrote; `kind` is
     stage 3's own classification and is what every other consumer here reads
     (src/block-policy.ts). */
  if (block.kind === "quote") return false;

  const text = block.text;
  /* **Peel the span's own edges first.** A mark the model included is the
     strongest evidence there is that this is a quotation — it is the one thing
     the model definitely saw — so finding one here counts towards the refusal
     rather than hiding it, which is what comparing the outside characters
     alone did. */
  let from = span.start;
  let to = span.end;
  while (from < to && OPENERS.has(text[from] ?? "")) from++;
  while (to > from && CLOSERS.has(text[to - 1] ?? "")) to--;
  const openerInside = from > span.start;
  const closerInside = to < span.end;

  /* Outward, skipping the whitespace that is never part of either answer. */
  let before = from - 1;
  while (before >= 0 && /\s/.test(text[before] ?? "")) before--;
  const openerBefore = OPENERS.has(text[before] ?? "");

  /* Outward again, but stepping over the sentence's own punctuation: a closing
     mark sits *after* the full stop, and the model routinely leaves the stop
     behind. */
  let after = to;
  while (after < text.length && SENTENCE_END.has(text[after] ?? "")) after++;
  while (after < text.length && /\s/.test(text[after] ?? "")) after++;
  const closerAfter = CLOSERS.has(text[after] ?? "");

  return !((openerInside || openerBefore) && (closerInside || closerAfter));
}

/* The marks a publisher's typography actually uses. Straight doubles, both
   curly directions, the two guillemets, the German low opener — and the curly
   SINGLES, which arrived after review: `‘…’` is ordinary British direct speech
   and excluding it let every such quotation through.

   Deliberately NOT the straight apostrophe. `'…'` around a sentence is
   ambiguous with a possessive or a contraction, and dropping the author's own
   emphasised line is a worse error than keeping a quoted one. */
const OPENERS: ReadonlySet<string> = new Set(['"', "“", "«", "„", "‘"]);
const CLOSERS: ReadonlySet<string> = new Set(['"', "”", "»", "“", "’"]);

/** Punctuation that can sit between the quoted words and the closing mark. */
const SENTENCE_END: ReadonlySet<string> = new Set([...".,;:!?…"]);

/** A located quote, before it has an id or has been checked against its neighbours. */
interface Placed {
  text: string;
  blockId: BlockId;
  span: Span;
  reason?: string;
  importance?: number;
  striking?: number;
}

/**
 * Turn what the model said into located quotes, believing as little of it as
 * possible.
 *
 * The drop rule is **words we can find, of a sensible length**. Everything else
 * degrades to a default rather than failing the batch: fifteen good quotes must
 * not be lost because one came back with `importance: "high"`.
 *
 * The order of the three checks is deliberate. Length first, because it is free
 * and because a two-word "quote" put through `locate` would search the whole
 * article with a needle that has no shape. Then `locate`, which is the
 * expensive and the load-bearing one.
 */
export function place(
  raw: unknown,
  blocks: readonly Block[],
  dropped: Dropped,
  /**
   * The scores the model did not give us — `QuoteScoreDrops`, mutated in place.
   *
   * **Optional**, and a fresh set when it is left out, so a caller that only
   * cares what was thrown away does not have to invent one. `buildQuotes`
   * always passes one through.
   */
  scores: QuoteScoreDrops = noQuoteScoreDrops(),
): Placed[] {
  const out: Placed[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    /* Per element, before any field is read. A `null` or a bare string in the
       array throws on the first property access and takes the whole batch with
       it — the salvage this function advertises has to cover the array's
       elements and not only the fields inside them. src/glossary.ts §
       `toEntries` had exactly this bug and it was found in review. */
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const q = item as RawQuote;
    const quote = text(q.text);
    if (!quote) {
      dropped.malformed++;
      continue;
    }
    if (quote.length < MIN_QUOTE_CHARS || quote.length > MAX_QUOTE_CHARS) {
      dropped.wrongLength++;
      continue;
    }
    const found = locate(quote, blocks);
    if (found.kind === "absent") {
      dropped.unfound++;
      continue;
    }
    if (found.kind === "otherVoice") {
      dropped.otherVoice++;
      continue;
    }
    const at = found.at;
    /* **The article's characters, not the model's string** — the second half of
       the safety property, and the half that was missing until GPT Sol's review
       on 2026-08-31.
    
       `findQuote` is an equivalence relation, not an identity test: it folds
       curly quotes to straight ones and collapses runs of whitespace, so a match
       says *these are the same passage*, never *these are the same characters*.
       Storing the model's typing therefore put words in the author's mouth on
       every fold — a straightened apostrophe at best, and, before `locate` was
       narrowed to the whitespace-preserving pass, a word the model had split in
       two.
    
       Slicing the block makes the model's text a **locator and nothing else**.
       Whatever it typed, what is stored, shown and attributed is what the
       article says. It also makes the client's job easier: `resolveQuote`
       re-finds these words in the rendered text, and it is now looking for the
       real ones. */
    const exact = at.block.text.slice(at.span.start, at.span.end);
    const reason = text(q.reason);
    const importance = scoreCounting(
      q.importance,
      scores,
      "importanceAbsent",
      "importanceRejected",
    );
    const striking = scoreCounting(q.striking, scores, "strikingAbsent", "strikingRejected");
    out.push({
      text: exact,
      blockId: at.blockId,
      span: at.span,
      ...(reason ? { reason } : {}),
      ...(importance === undefined ? {} : { importance }),
      ...(striking === undefined ? {} : { striking }),
    });
  }
  return out;
}

/**
 * Two quotes may not cover the same words.
 *
 * Overlapping spans in one block would draw two marks over one passage and
 * offer the reader the same line twice — and where one contains the other, the
 * shorter adds nothing the longer does not already say.
 *
 * **The longer span wins**, which is the glossary's `richness` argument one
 * door along: *"keep whichever came first" is not a tie-break, it is a coin
 * toss*, and here it would systematically keep the fragment over the sentence,
 * because a model listing its favourite lines tends to give the short punchy
 * form first. Ties go to the earlier one, which is stable and arbitrary rather
 * than arbitrary and unstable.
 *
 * Comparison is on `[start, end)` in `block.text`, which is the space `locate`
 * answered in. Touching but not overlapping — one ends exactly where the next
 * begins — is two quotes, not one.
 */
export function dedupeOverlaps(placed: Placed[], dropped: Dropped): Placed[] {
  const byLength = [...placed]
    .map((p, i) => ({ p, i, len: p.span.end - p.span.start }))
    .sort((a, b) => (a.len === b.len ? a.i - b.i : b.len - a.len));
  const kept: Placed[] = [];
  for (const { p } of byLength) {
    const clash = kept.some(
      (k) => k.blockId === p.blockId && p.span.start < k.span.end && k.span.start < p.span.end,
    );
    if (clash) {
      dropped.overlapping++;
      continue;
    }
    kept.push(p);
  }
  return kept;
}

/**
 * Document order: whichever line the article says first comes first.
 *
 * The reader's own order through the piece, which is a real order rather than a
 * judgment about what matters — and it is what Greg asked for as the default
 * (*"By default, display them in order"*). The panel's ranked orders are
 * controls the reader presses; this is what the artefact stores.
 *
 * Ties inside one block break on the offset, so two quotes from one paragraph
 * come out in reading order rather than in whatever order the model listed
 * them. The array index is the last tie-break so the sort is stable for a
 * reason rather than by accident.
 */
export function inDocumentOrder(quotes: Quote[], blocks: readonly Block[]): Quote[] {
  const position = new Map<BlockId, number>();
  for (const [i, b] of blocks.entries()) position.set(b.id, i);
  return quotes
    .map((quote, i) => ({
      quote,
      i,
      rank: position.get(quote.blockId) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort(
      (a, b) =>
        a.rank - b.rank || (a.quote.start ?? 0) - (b.quote.start ?? 0) || a.i - b.i,
    )
    .map((x) => x.quote);
}

/**
 * A quote reduced to the form two typings of it have in common.
 *
 * **Comparison key only** — nothing normalised here is ever shown or stored.
 * The same four kinds of noise `normaliseTerm` strips in src/glossary.ts, plus
 * double quotes, because a model returning a line that itself contains a
 * quotation will sometimes straighten the inner marks and sometimes not.
 *
 * It deliberately does **not** stem, singularise or drop stop-words. This key
 * decides whether a rewritten list inherits a reader's `?quote=` link, and an
 * over-eager key hands a link to a *different sentence*, which is worse than
 * letting the link go: a dead `?quote=` opens the list, where a wrongly
 * inherited one opens somebody else's words wearing the reader's bookmark.
 */
export function normaliseQuote(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

/**
 * The ids the previous artefact used, by normalised quote — so a rewrite keeps
 * the reader's `?quote=` links pointing at the same words.
 *
 * **Names are display; ids are identity.** The prose of a quote is the
 * author's, so unlike a glossary entry it does not get rewritten between runs —
 * which makes this key unusually reliable. What it cannot survive is the model
 * returning the same sentence with one more clause on the end: that is a
 * different key, a fresh id, and a dead link. Correct rather than clever — a
 * near-match rule here would hand a link to words the reader did not bookmark.
 */
export function idsByText(onDisk: Quotes | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const quote of onDisk?.quotes ?? []) {
    const key = normaliseQuote(quote.text);
    if (key && !out.has(key)) out.set(key, quote.id);
  }
  return out;
}

function inheritIds(fresh: Quote[], inherit: Map<string, string> | null): Quote[] {
  if (!inherit || inherit.size === 0) return fresh;
  const used = new Set<string>();
  return fresh.map((quote) => {
    const old = inherit.get(normaliseQuote(quote.text));
    /* `used`, because two fresh quotes can normalise to one old key and an id
       handed out twice is worse than a new one — `?quote=` would then address
       whichever the panel happened to find first. */
    if (!old || used.has(old)) return quote;
    used.add(old);
    return { ...quote, id: old };
  });
}

/**
 * The artefact, from what the model said plus what we could verify of it.
 *
 * An empty result throws. Nothing to say is not a degenerate success — it is a
 * model call that produced nothing, and writing it would make the step report
 * done for ever after while the panel showed an empty band.
 */
export function buildQuotes(
  parsed: { quotes?: unknown },
  opts: {
    slug: string;
    blocks: readonly Block[];
    sourceHash: string;
    /** The rendered profile this was written from, or null for none. */
    profile?: string | null;
    elapsedMs: number;
    /** Ids from the list this run is replacing — see `idsByText`. */
    inherit?: Map<string, string> | null;
    dropped: Dropped;
    /**
     * The scores the model did not give us — `QuoteScoreDrops`, mutated in
     * place. **Optional, unlike `dropped`**, because it never reaches the
     * artefact this function returns: nothing is stored and nothing is shown,
     * so a caller that does not log has no use for it. `generateQuotes` always
     * passes one. The same arrangement as `buildGlossary`'s.
     */
    scores?: QuoteScoreDrops;
  },
): Quotes {
  const placed = dedupeOverlaps(
    /* `undefined` falls through to `place`'s own default, so the one place a
       fresh set is minted stays in one place. */
    place(parsed.quotes, opts.blocks, opts.dropped, opts.scores),
    opts.dropped,
  );

  /* Ids already spent, so a fresh quote cannot be minted onto an id the
     inheritance is about to hand to a different one. */
  const taken = new Set<string>(opts.inherit?.values() ?? []);
  const minted: Quote[] = placed.map((p) => ({
    id: mintUniqueId(taken),
    blockId: p.blockId,
    text: p.text,
    start: p.span.start,
    ...(p.reason ? { reason: p.reason } : {}),
    ...(p.importance === undefined ? {} : { importance: p.importance }),
    ...(p.striking === undefined ? {} : { striking: p.striking }),
  }));

  /* **The cap is applied in document order, not in the model's order.** Cutting
     the model's own list would silently keep whichever end of the article it
     happened to enumerate first; cutting in reading order at least fails
     legibly, as "it stops part-way down the piece". `overCap` counts it either
     way, which is what makes the choice checkable rather than a preference. */
  const ordered = inDocumentOrder(inheritIds(minted, opts.inherit ?? null), opts.blocks);
  if (ordered.length > MAX_QUOTES) opts.dropped.overCap += ordered.length - MAX_QUOTES;
  const quotes = ordered.slice(0, MAX_QUOTES);

  if (quotes.length === 0) {
    throw new Error("The model returned no quotes we could find in the article. Nothing to write.");
  }

  return {
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    /* `null`, never absent. Absent means "written before this existed"; `null`
       means "written deliberately without a profile", and the panel needs to
       tell those two apart to decide whether its checkbox starts ticked.
       src/profile.ts § profileIsStale. */
    profileHash: opts.profile ? hashProfile(opts.profile) : null,
    quotes,
    /* A copy, not the live object. `dropped` is threaded through by reference
       so the counters accumulate across `place` and `dedupeOverlaps`, and
       storing the reference would let a later mutation edit an artefact that
       has already been built. */
    discarded: { ...opts.dropped },
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

/**
 * Do these quotes still describe the article on disk?
 *
 * Pure. `GET /api/quotes/:slug` calls it and puts the answer in the response,
 * so the panel can say the list is out of date — which matters more here than
 * anywhere else in the band: a stale quote list is a set of *block ids that may
 * no longer exist*, so pressing a row could jump nowhere, and the words
 * themselves may no longer be in the piece.
 */
export function isStale(
  quotes: Quotes,
  /* `readonly`, like `inputFingerprint` above and like the same parameter in
     ideas, timeline, quiz, sketch and arc. Nothing here mutates the array, and
     a caller holding a `readonly BlockFingerprint[]` was the one thing that
     made this signature different from its five peers'. */
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprint | null,
): boolean {
  return quotes.sourceHash !== inputFingerprint(blocks, tree, meta);
}

/**
 * The quotes on disk, or null — for the API's filesystem read path, and **not
 * for the pipeline**, which asks `previousQuotesFrom` below.
 *
 * Every road to `null` here is the same road: no file, a truncated one, a
 * document of the wrong shape. That is right for the panel, which has one thing
 * to say either way, and wrong for the stage, which loses every `?quote=` link
 * on one of them.
 */
export async function readQuotes(dir: string): Promise<Quotes | null> {
  const found = await readJsonOrNull<Quotes>(path.join(dir, "quotes.json"));
  /* A truncated write parses as `null`, and `null` is a perfectly good JSON
     document. Without this check the panel reports "nobody has found the quotes
     for this one yet" — the artefact gone, and nothing anywhere saying so. */
  if (!found || typeof found !== "object" || !Array.isArray(found.quotes)) return null;
  return found;
}

/**
 * There is a previous `quotes` artefact, this store cannot read it, and we are
 * not guessing which of the two harmless cases it would have been.
 *
 * The sibling of `GlossaryBaselineUnusable` and `IdeasBaselineUnusable`, and a
 * separate type rather than a shared one because the sentence a person needs is
 * about *this* artefact: which links go dead, and where to put the file back.
 */
export class QuotesBaselineUnusable extends Error {
  constructor(readonly slug: string) {
    super(
      `quotes "${slug}": there is a previous quotes artefact and this store cannot read it — it ` +
        "will not parse, is of the wrong shape, or is past the size the store reads back.\n" +
        "Every id in it is one a reader's `?quote=` links name (docs/project/quotes.md), so " +
        "carrying on would mint a fresh id for every quote and orphan all of them, quietly.\n" +
        "Nothing has been written — the quotes are still the previous run's.\n" +
        "Put it back from a backup, or delete it deliberately if this article's quotes really are " +
        "starting again from nothing.",
    );
    this.name = "QuotesBaselineUnusable";
  }
}

/**
 * The previous quotes, **from the store** — the only thing this stage reads the
 * old artefact for, and the thing landing D would otherwise take away.
 *
 * **Four states, and the same table as the glossary's and the ideas'**, for the
 * same reason: this stage inherits ids **only when `sourceHash` matches**, so a
 * mismatch is a legitimate refusal to inherit rather than a fault.
 *
 * | | what it means | what happens |
 * |---|---|---|
 * | no previous quotes | a first run for this article | mint, quietly |
 * | ones whose `sourceHash` differs | the article's text or its tree moved | mint, quietly — **correct, not an error** |
 * | ones this store cannot read | we cannot tell which of those two it was | **the stage fails** |
 * | the store read throws | an infrastructure fault | **propagates; the stage fails** |
 *
 * Row two is `generateQuotes`'s to decide and not this function's, which is why
 * this hands back the artefact rather than a map of ids: an id inherited across
 * a re-extraction would carry a reader's link onto a quote from a different
 * text, and the comparison that stops that wants the whole artefact.
 *
 * Row three is the one that has to be told from row one. A truncated
 * `quotes.json` still holds every id; a person with a backup can put it back,
 * and minting over it takes that away while reporting success.
 */
export async function previousQuotesFrom(
  store: Pick<ArtifactStore, "readBaseline">,
  slug: string,
): Promise<Quotes | null> {
  const outcome = await store.readBaseline(slug, "quotes", "quotes");
  if (outcome.state === "unusable") throw new QuotesBaselineUnusable(slug);
  return outcome.state === "ok" ? outcome.value : null;
}

export interface QuotesRun {
  quotes: Quotes;
  blocks: number;
  words: number;
  dropped: Dropped;
  /**
   * The scores this run asked for and did not get — `QuoteScoreDrops`.
   *
   * Beside `dropped` and not inside it, and **not on the artefact**: read the
   * docstring on `QuoteScoreDrops` before moving either of those.
   */
  scores: QuoteScoreDrops;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /* What the cache did on this call. Reported next to the token counts because
     a cache that has silently stopped hitting is indistinguishable from one that
     is working — same answer, no error, a bigger bill.
     docs/reusable/silent-success.md. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
}

const SYSTEM = `You are choosing the QUOTES worth keeping from this article: the
lines a reader would want to carry out of it.

THE ABSOLUTE RULE

Every quote must be copied from the article VERBATIM — character for character,
exactly as it appears there. Not paraphrased, not tidied, not shortened with an
ellipsis, not stitched together from two places. If you cannot copy a line
exactly, leave it out.

This is not a style preference. Everything you return is shown to the reader in
quotation marks, attributed to the author, beside the real text. A line that is
nearly what they wrote is a false claim about a real person. Anything we cannot
find in the article is thrown away, so an approximation costs you the entry and
gains nothing.

WHAT EARNS A QUOTE

A line earns its place for one of two reasons, and either one alone is enough.

- It CARRIES THE ARGUMENT. The sentence the piece turns on; the claim the rest
  is spent defending; the objection stated in the author's own voice; the
  distinction everything after it depends on.
- It IS WELL PUT. The line you would repeat to somebody. Memorable, exact,
  surprising, funny, or simply better written than the sentences around it.

The best quotes are both. Many good ones are only one, and a line that is only
one is still worth having — do not pass over the piece's central claim because
it is plainly written, and do not pass over its best-written sentence because
the argument would survive without it.

WHAT DOES NOT

- Scaffolding. "In this essay I will argue that ...", "But first, some
  background", "Let us turn to the second objection."
- A sentence that needs the paragraph around it to mean anything. A quote is
  shown on its own, so a line beginning "This is why it fails" is useless.
- A statement of fact with nothing of the author in it. A date, a figure, a
  definition anyone would write the same way.
- A line the piece is QUOTING rather than saying. Anything inside quotation
  marks, and anything in an indented block quote, belongs to whoever it was
  taken from. Skip it, however good it is — those are thrown away anyway, so
  offering one costs you the entry and gains nothing.
- Two overlapping versions of one line. Pick the form that stands alone best;
  one of them will be thrown away anyway.
- Anything under 30 characters or over 400. Below that it is a phrase; above it
  it is the paragraph, and both are thrown away.

SPREAD THEM OUT

Take them from across the whole piece. Three quotes from one paragraph and none
from the second half is a list about the opening, not about the article.

THE SCORES

"importance" 0-1: how much of the article's argument rests on this line. 0 is an
aside; 1 is the sentence the piece exists to say.

"striking" 0-1: how memorable and well put it is. 0 is functional prose; 1 is
the line a reader would quote to somebody else a week later.

These are two different questions and a line may be high on one and low on the
other. That is the normal case, and answering them independently is what makes
them worth having. Do not inflate either, and do not let one drag the other up.

THE REASON

"reason" is one short sentence on why THIS line, and the reader sees it only if
they ask for it — so make it worth asking for.

Say what the line DOES: which move in the argument it is, or what makes the
phrasing land. Do NOT describe the page the reader is looking at. If your
sentence would begin "The author says ...", "Quoted here to ...", "This passage
argues ...", "Used to introduce ..." — you are narrating a page they can already
see, and the caption is wasted. Leave it out rather than write one of those; an
absent reason is a real answer.

  BAD  — "The author argues that writing and thinking are inseparable."
         That is the sentence, said again, worse.
  GOOD — "The claim the rest of the essay is spent defending."
  GOOD — "Names the objection more sharply than the objectors do."

WRITING

- "text": the article's words, verbatim, nothing else.
- "reason": one plain sentence, or absent. No Markdown. Ordinary words, with the
  article's own for the things it names: plainer than the article, never further
  from it.

OUTPUT

JSON only, no prose, no code fence:

{"quotes": [
  {
    "text": "...",
    "reason": "...",
    "importance": 0.0,
    "striking": 0.0
  }
]}

"reason", "importance" and "striking" may each be omitted. "text" may not.

${PROFILE_RULES}`;

/**
 * What the model is shown.
 *
 * The skeleton before the full text, for the same reason the arc, the glossary
 * and the ideas do it: it is what lets the model weigh a line against the shape
 * of the argument rather than against how well it happens to read on its own.
 * `importance` is unanswerable without it.
 *
 * **The article is not in here**, deliberately. It is a cached `system` block —
 * see `generateQuotes` — so what is left is only the part that changes.
 */
/* Exported for tests/profile-prompts.test.ts, which pins the two things a
   profile must do here: arrive when there is one, and leave no trace when there
   is not. Same reason src/glossary.ts and src/tweets.ts export theirs. */
export function renderPrompt(opts: {
  tree: Tree;
  count: number;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts.
   *
   * It changes *which* lines are worth keeping — what is a well-known
   * formulation to a specialist is the sentence of the piece to somebody
   * meeting the idea — and it must not change what the words are. In the user
   * prompt and never the `system` block: the article is up there with the
   * breakpoint on it, and this changes between readers.
   */
  profile: string | null;
}): string {
  const { tree, count } = opts;
  const skeleton = partsOf(tree)
    .map((p, i) => `PART ${i + 1}: ${p.title}\n  ${p.gist ?? "(no gist)"}`)
    .join("\n\n");

  /* Near the top, where it will be read, and before the shape — the reader is
     context for *choosing* the lines, and the choosing is what the rest of this
     prompt is about. src/profile.ts § PROFILE_RULES. */
  const who = profileSection(opts.profile);

  return `Choose up to ${count} quotes. Fewer is fine — a short piece has few
lines worth keeping, and a list padded to a number is worse than a short list.
${who ? `\n${who}\n` : ""}
=== ITS SHAPE ===

${skeleton}`;
}

/**
 * Read the model's answer, fence and all.
 *
 * `stripFence` then `parseJsonFrom`, never a bare `JSON.parse` — src/parse-json.ts
 * § `stripFence` has the reasoning, and the short version is that nothing in this
 * file logs and that is not enough, because a thrown error is logged where it is
 * caught and V8 quotes the input in it.
 */
function parseJson(raw: string): { quotes?: unknown } {
  return parseJsonFrom(stripFence(raw), "the quotes response");
}

/**
 * Stage 5h over a data directory: one model call, and the artefact handed back.
 *
 * **It writes nothing**, which is the converted shape `sketch` introduced —
 * see the note in `generateSketch` (src/sketch.ts). The pipeline step returns it
 * as `parts` and the store writes it.
 *
 * **It replaces.** There is no append path and therefore no `existing`, no
 * FORBIDDEN list and no "a stale list is not appended to" rule — see the header.
 * `previous` is read for its ids and for nothing else.
 *
 * Exported because two callers run this stage and they must not drift —
 * `main()` below, and the ingest queue in the server process (src/pipeline.ts).
 */
export async function generateQuotes(opts: {
  /**
   * The article, read once by whoever has a store or a directory —
   * src/article-input.ts. This stage no longer knows where one comes from.
   */
  article: Article;
  onProgress?: (detail: string) => void;
  /** Cancel the call. The queue passes its job's signal — src/jobs.ts. */
  signal?: AbortSignal;
  /**
   * Mark the article as a cache breakpoint.
   *
   * Off by default, because a cache write costs 1.25x and a prefix nobody reads
   * never earns it back. This stage makes one call per run, so it caches
   * nothing for itself; the entry pays off only if a stage in the same group
   * runs **later in the same job** inside the TTL. **Its group is `glossary`** —
   * same effort, same renderer (src/models.ts § ARTICLE_RENDERER).
   *
   * That is narrower than it sounds and the plan first overstated it: a reader
   * who opens the glossary and then the quotes has made two jobs, so neither
   * marks anything and neither reads anything. The saving is real for
   * `steps: ["glossary","quotes"]` and for nothing else. src/jobs.ts sets this
   * from the steps the job actually has left. GPT Sol, 2026-08-31.
   */
  cacheArticle?: boolean;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts.
   *
   * **Frozen by whoever queued the job, not read here**, so that a reader who
   * edits their profile mid-run does not get an artefact stamped with a profile
   * only half of it was written from. src/jobs.ts resolves it once and carries
   * it.
   */
  profile?: string | null;
  /**
   * The quotes this article already has, or `null` **only** when it genuinely
   * has none — `previousQuotesFrom` above is how the pipeline gets it.
   *
   * **Required, and that is the point of it.** An optional parameter is exactly
   * what a later landing could drop and still compile, and the symptom would be
   * every `?quote=` link in the database going dead while the step reported
   * success. A required one cannot be.
   */
  previous: Quotes | null;
}): Promise<QuotesRun> {
  const { blocks, tree } = opts.article;
  /* **`null` straight through, and no stub.** Unlike `ideas` and `sketch`, this
     stage does not synthesise a head when there is no metadata — `articleText`
     simply loses those lines — so the one value goes to the prompt and to the
     fingerprint alike and the two sides cannot disagree. Optional, and only
     ever used to tell the model what it is reading; an article with no metadata
     is not worth failing the whole stage over. */
  const meta: Meta | null = opts.article.meta;

  const sourceHash = inputFingerprint(blocks, tree, meta);
  const onDisk = opts.previous;
  /* Ids come across only when the article has not moved. A quote inherited
     across a re-extraction would carry a reader's `?quote=` link onto words
     from a different version of the piece. */
  const inherit = onDisk && onDisk.sourceHash === sourceHash ? idsByText(onDisk) : null;

  /* **The argument, not the apparatus** — the same filter every article-reading
     stage applies at its call site rather than inside the prompt builders.
     Sharper here than anywhere: a bibliography entry or a footnote is not a
     line worth keeping, and it is exactly the kind of self-contained,
     confidently-worded sentence a model reaches for. It is also the half of the
     article `locate` must not search, or a quote lifted from a reference list
     would resolve to a real block and look verified. src/block-policy.ts. */
  const evidence = blocks.filter(isBodyEvidence);
  const words = articleWordCounts(blocks).body;
  const count = suggestedQuotes(words);
  const started = Date.now();

  /* Bounded by `count`, which is bounded by MAX_QUOTES. Each quote is up to
     MAX_QUOTE_CHARS of prose plus a short reason and two numbers — call it 180
     tokens — and the allowance still scales with the article because the model
     reads the whole piece and thinks about it inside this same number. See
     src/token-budget.ts. Undersizing this does not degrade: it throws
     `truncationFailure` and loses the whole pass. */
  const answerTokens = 500 + count * 220;
  const maxTokens = budgetFor("quotes", answerTokens);

  /* The request itself, wrapped: a 429/401/etc from the SDK is not caught
     anywhere upstream of here, and the installed SDK builds `Error.message`
     from the upstream error body — the one place it can echo back part of what
     we sent, which is the whole article. See src/anthropic-call.ts. */
  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "quotes",
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: effortFor("quotes") },
        /* Two system blocks, breakpoint on the first, and the article goes
           *before* this stage's instructions because the cache prefix runs from
           the very top of the request. These are byte-for-byte the bytes
           `glossary` sends, which is the whole of the sharing — see
           `cacheArticle` above. */
        system: [
          {
            type: "text" as const,
            text: articleText(meta, evidence),
            ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
          },
          { type: "text" as const, text: SYSTEM },
        ],
        messages: [
          {
            role: "user",
            content: renderPrompt({ tree, count, profile: opts.profile ?? null }),
          },
        ],
      },
      { ...(opts.signal ? { signal: opts.signal } : {}) },
    );

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        // Throttled: the model emits deltas far faster than anyone can read
        // them, and every one of these is a write the job poller may pick up.
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`up to ${count} quotes, ${Math.round(chars / 1000)}k characters so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper is
       what records what this call cost. The stream's own method works and
       records nothing. See src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  if (wasRefused(message)) {
    /* `stop_details` is deliberately neither thrown nor logged — it is the
       provider's own words about a request that carried the whole article, and
       this error is copied onto the job and shown on the progress card. */
    throw stageFailure(MODEL_REFUSED, {
      authored: "the model answered with stop_reason: refusal",
    });
  }
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure("quotes", maxTokens, answerTokens, {
      outputTokens: message.usage.output_tokens,
      answerChars: message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .reduce((n, b) => n + b.text.length, 0),
    });
  }

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const dropped = noneDropped();
  const scores = noQuoteScoreDrops();
  /* **`evidence`, not `blocks`** — `locate` must search exactly the text the
     model was shown. Searching the whole article would let a quote lifted out
     of a footnote or a reference list resolve to a real block and arrive
     wearing the same verification as every other row. The two lists have to be
     the same list, which is why this reads the one variable. */
  const quotes = buildQuotes(parseJson(raw), {
    slug: tree.slug,
    blocks: evidence,
    sourceHash,
    profile: opts.profile ?? null,
    elapsedMs: Date.now() - started,
    inherit,
    dropped,
    scores,
  });

  return {
    quotes,
    blocks: blocks.length,
    words,
    dropped,
    scores,
    model: CAPABLE_MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    elapsedMs: Date.now() - started,
  };
}
