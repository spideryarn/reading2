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
 * ## It appends, since 2026-09-11 — and replaces only a list the article left
 *
 * From 2026-08-31 it replaced, on the ideas' reasoning that a piece has a
 * dozen quotable lines and running the step again already *is* "choose them
 * again". Greg asked twice for the opposite — report 27, then SPIDERYARN-
 * READING2-2W: *"Remove the "Choose them again" button, and add a "Find more"
 * button"* — so a forced run on a list written from this same article now
 * **extends** it: every quote the reader has keeps its words, its scores and
 * its id, and the model is asked for more, with the taken lines listed. That is
 * the glossary's shape (src/glossary.ts § existingFor), reused rather than
 * reinvented, with one deliberate difference — see `existingFor` below. A list
 * the article has moved out from under is still replaced, with every id minted
 * fresh so a reader's `?quote=` link cannot silently move to changed words.
 *
 * See docs/plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md,
 * docs/plans/260831j-quotes-mode.md and docs/project/quotes.md.
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
import { parseJsonAnswer, readJsonOrNull } from "./parse-json.js";
import { articleText } from "./article-prompt.js";
import { articleWordCounts, isBodyEvidence } from "./block-policy.js";
import { PROFILE_RULES, hashProfile, profileSection } from "./profile.js";
import {
  MAX_QUOTES_TOTAL,
  type Block,
  type BlockId,
  type Meta,
  type Quote,
  type QuoteDrops,
  type Quotes,
  type Tree,
} from "./types.js";
import type { ArtifactStore } from "./store/artifacts.js";

/**
 * Bumped whenever the prompt changes in a way that changes what a quote *is*.
 *
 * Exported so tests assert against the current value rather than pinning a
 * literal that has to be edited on every bump — a fixture that hardcodes the
 * version tests the fixture.
 *
 * **`quotes/3`, 2026-09-05: `suggestedQuotes` doubled.** The prompt's words did
 * not move; the number in `Choose up to ${count} quotes` did, and how many lines
 * a piece offers is exactly *what a quote is* — half the length of the list is
 * the editorial claim. So every existing list now says *"These were chosen by
 * an earlier version of the prompt"*, which is `outdated` and its own quiet
 * sentence, and deliberately not the `stale` banner next to it: nothing about
 * the article moved, so none of those lines has stopped being in it.
 *
 * **`quotes/4`, 2026-09-11: importance first, and more of them.** Greg,
 * SPIDERYARN-READING2-2W: *"make a small tweak to the prompt to emphasise
 * important rather than striking when highlighting them"* — and the count went
 * from one per ~300 words to one per ~200. A list written before this keeps
 * every line it has: a Find more on it appends lines chosen by this prompt, and
 * **the list keeps its older stamp**, because most of it still is the older
 * prompt's choosing — so it stays *outdated*, and says it includes such lines
 * (`existingFor`, `buildQuotes`). A stale list is replaced and stamped afresh.
 *
 * **`quotes/5`, 2026-09-11: one point, one quote.** Greg, SPIDERYARN-
 * READING2-2X: *"slightly emphasise diversity (i.e. to avoid ending up with
 * loads of quotes that say basically the same thing)"*. A short paragraph and
 * one clause, in the two places a repeat can come from: `SYSTEM` asks for a
 * line that says something the others do not, which is the first pass —
 * `quotes/4`'s importance-first plus a larger count invites the thesis
 * restated five ways — and Find more's taken list now rules out a taken line's
 * point in other words as well as its sentence. Nothing mechanical can check this: `dedupeOverlaps`
 * compares spans, and two sentences making one point share none.
 *
 * **`quotes/6`, 2026-09-12: long enough to stand on their own.** Greg,
 * SPIDERYARN-READING2-3C: a quote that *"only has real meaning in the context of
 * the wider block that it's part of"* is too short, and one *"could almost be an
 * entire block if the whole block is really, really good"*. The prompt's own
 * `LONG ENOUGH TO STAND ALONE` section makes that the test, and
 * `MAX_QUOTE_CHARS` went from 400 to 1,200 with it — the prompt alone could not
 * have done it, because three paragraphs in four of the article he was reading
 * were longer than 400. docs/plans/260912e-quotes-long-enough-to-stand-on-their-own.md.
 */
export const PROMPT_VERSION = "quotes/6";

/**
 * The most quotes one call may return — **one pass**, not the whole list.
 *
 * **40 since 2026-09-11**, with the count (SPIDERYARN-READING2-2W: *"Try and
 * find more quotes by default"*). The list as a whole is bounded by
 * `MAX_QUOTES_TOTAL`, because Find more adds to it.
 *
 * **Doubled from 16 on 2026-09-05**, when the prose started marking every
 * visible quote rather than only the selected one. Greg asked for "many more"
 * in the same breath as the highlighter — the list stopped being a list you
 * read and became the marks you skim the article by, and sixteen marks in an
 * eight-thousand-word piece is not a highlighted article.
 *
 * Thirty-two and not a hundred, because the ceiling is still an editorial claim
 * and not a budget: every row says *this line is worth carrying out of here*,
 * and the `?bar=` slider can hide a padded quote but cannot make it good.
 */
export const MAX_QUOTES = 40;

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
 * Longer than this is more than a reader will read as one quote in a list —
 * about 200 words, a long paragraph.
 *
 * **1,200 since 2026-09-12; 400 before**, when the docstring here said *"longer
 * than this is the paragraph, not a line out of it"* and the prompt said the
 * same. That was the rule Greg asked to be undone (SPIDERYARN-READING2-3C): a
 * quote should stand on its own, and may be the whole paragraph when the whole
 * paragraph is that good. Measured that day, 53 of the 69 paragraphs in the
 * article he was reading were over 400, and the model had learnt to stay far
 * below it — median 148 characters, a sixth of the paragraph each came from.
 * Counted over exactly what this stage chooses from (`isBodyEvidence`), 1,200
 * covers all 141 blocks of the noema fixture and 89 of the entropy paper's 99 —
 * an editorial ceiling, not a promise that every good block can be quoted
 * whole. It is a guess at where a quote stops being one, and the prompt reads it
 * from here.
 *
 * Dropped rather than truncated, and that is the rule this stage cannot bend:
 * an ellipsis inside quotation marks attributed to a named author is a claim
 * about what they wrote.
 *
 * **The answer's token allowance is computed from this** (`answerTokensFor`),
 * because undersizing that does not degrade — it loses the whole pass.
 * docs/plans/260912e-quotes-long-enough-to-stand-on-their-own.md.
 */
export const MAX_QUOTE_CHARS = 1200;

/**
 * The tokens one pass's answer may need, for `count` quotes — what
 * `generateQuotes` hands `budgetFor`.
 *
 * **Per quote, from `MAX_QUOTE_CHARS`**, so the two cannot come apart: it was
 * `500 + count * 220` while quotes were at most 400 characters, and raising the
 * ceiling without this would have let a pass of long quotes run out of room.
 * Undersizing does not degrade — `truncationFailure` throws and the reader loses
 * the whole pass. So **one token per character of quote**, which no ordinary
 * text comes near: English runs about four characters a token. A paper's maths
 * and symbols are what can push a stretch towards one — a ratio
 * of three was the first draft, and GPT Sol showed it was not a safe bound for
 * exactly the articles this change is for. 100 more covers the reason, the two
 * scores and the JSON around them. Even this is a corpus bound rather than a
 * guarantee: a rare symbol can cost several tokens.
 *
 * `max_tokens` is a ceiling and not a charge, so the generosity costs nothing
 * unless the model uses it: forty maximum-length quotes come to 52,500, inside
 * what one call may ask for with the 40,000 of thinking headroom on top
 * (src/token-budget.ts). The model reads the whole piece and thinks inside
 * `budgetFor`'s headroom, not inside this.
 */
export function answerTokensFor(count: number): number {
  return 500 + count * (MAX_QUOTE_CHARS + 100);
}

/**
 * How many quotes to ask for — one per ~200 words, clamped to 10–40.
 *
 * **One per ~300, clamped 8–32, from 2026-09-05 until 2026-09-11**, when Greg
 * asked again for more by default (SPIDERYARN-READING2-2W). A 4,000-word piece
 * now asks for 20 rather than 13. Still unmeasured in the sense that matters —
 * nobody has read the tail of a 40-quote list and said it was worth having —
 * and still affordable for the reason below: the bar hides the tail.
 *
 * **It was one per 600, clamped 4–16, until 2026-09-05**, which put it between
 * the glossary's density (one per 400, clamped 6–20: a term is a word the piece
 * happens to use) and the ideas' (one per 800, clamped 3–10: an idea is
 * something the whole argument leans on). Both of those are lists you read.
 * This one is now the marks on the article as well, so the right comparison is
 * a person with a highlighter: denser than the glossary, and the floor matters
 * more than the ceiling, because four marks in a short piece read as an
 * accident rather than as a pass through it.
 *
 * The warning it replaces is still true and still the reason there is a ceiling
 * at all: a padded quote list is not a weak entry a reader can skip — it is a
 * forgettable line presented as memorable, which discredits the ones around it.
 * The `?bar=` slider now hides the tail of a long list, which is what makes the
 * higher number affordable; it is not what makes a bad line good.
 */
export function suggestedQuotes(words: number): number {
  return Math.min(MAX_QUOTES, Math.max(10, Math.round(words / 200)));
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
export function dedupeOverlaps(
  placed: Placed[],
  dropped: Dropped,
  /**
   * Spans already on the reader's list — an append's `takenSpans`. **They win
   * every clash, whatever their length**: they are seeded as kept before the
   * longest-first pass starts, so a new line can only ever be dropped against
   * them, never the other way round. The reader's list must not change under
   * them because they asked for more.
   */
  taken: readonly TakenSpan[] = [],
): Placed[] {
  const byLength = [...placed]
    .map((p, i) => ({ p, i, len: p.span.end - p.span.start }))
    .sort((a, b) => (a.len === b.len ? a.i - b.i : b.len - a.len));
  const kept: TakenSpan[] = [...taken];
  const out: Placed[] = [];
  for (const { p } of byLength) {
    const clash = kept.some(
      (k) => k.blockId === p.blockId && p.span.start < k.span.end && k.span.start < p.span.end,
    );
    if (clash) {
      dropped.overlapping++;
      continue;
    }
    kept.push({ blockId: p.blockId, span: p.span });
    out.push(p);
  }
  return out;
}

/** Where a quote already on the list sits, in `locate`'s coordinates. */
export interface TakenSpan {
  blockId: BlockId;
  span: Span;
}

/**
 * The spans of the quotes an append is extending, for `dedupeOverlaps`.
 *
 * `start` disambiguates repeats when it exists; either way the stored words are
 * re-found with the same matcher that admitted them. A quote whose block the
 * article no longer has cannot clash with anything and is simply absent here —
 * but an append only happens against an unmoved article (`existingFor`), so
 * that is a belt rather than a case.
 */
export function takenSpans(existing: readonly Quote[], blocks: readonly Block[]): TakenSpan[] {
  const text = new Map(blocks.map((b) => [b.id, b.text] as const));
  const out: TakenSpan[] = [];
  for (const quote of existing) {
    const body = text.get(quote.blockId);
    if (body === undefined) continue;
    /* Re-find it through the same matcher that admitted it; `start` is only the
       tie-break between repeated passages, never an anchor (Quote in types.ts).
       Early artefacts can lack it and can carry the model's straight dash or
       quote where the article has a curly one. `indexOf`, or trusting
       `start + text.length`, then misses the existing span and lets Find more
       add an overlapping version. The article's span supplies both ends. */
    const span = findQuote(body, quote.text, quote.start, "spaced");
    if (!span) continue;
    out.push({ blockId: quote.blockId, span });
  }
  return out;
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
 * Put a pass's new quotes into document order around the list the reader
 * already has, without ever reordering that existing list.
 *
 * A valid `Quotes` artefact is already in document order, so sorting the whole
 * concatenated list and merging this way have the same visible result. The
 * distinction is a preservation guarantee: if an old or hand-migrated artefact
 * is not perfectly ordered, Find more still cannot change the order the reader
 * had. Existing wins a tie, just as it wins an overlapping span.
 */
function mergeInDocumentOrder(
  existing: readonly Quote[],
  added: readonly Quote[],
  blocks: readonly Block[],
): Quote[] {
  const position = new Map<BlockId, number>();
  const text = new Map<BlockId, string>();
  for (const [i, block] of blocks.entries()) {
    position.set(block.id, i);
    text.set(block.id, block.text);
  }
  const key = (quote: Quote): readonly [number, number] => {
    const body = text.get(quote.blockId);
    const recovered =
      quote.start === undefined && body !== undefined
        ? findQuote(body, quote.text, undefined, "spaced")?.start
        : undefined;
    return [
      position.get(quote.blockId) ?? Number.MAX_SAFE_INTEGER,
      quote.start ?? recovered ?? 0,
    ];
  };
  const before = (a: Quote, b: Quote): boolean => {
    const [aBlock, aStart] = key(a);
    const [bBlock, bStart] = key(b);
    return aBlock < bBlock || (aBlock === bBlock && aStart < bStart);
  };

  const out: Quote[] = [];
  let next = 0;
  for (const kept of existing) {
    while (next < added.length && before(added[next]!, kept)) out.push(added[next++]!);
    out.push(kept);
  }
  while (next < added.length) out.push(added[next++]!);
  return out;
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
 * The list a forced run **appends to**, or null for a run that writes a list
 * of its own — the glossary's `existingFor`, and one condition shorter.
 *
 * **Only the article moving refuses an append.** A list whose `sourceHash` no
 * longer matches holds block ids that may be gone and words that may no longer
 * be in the piece, so extending it would add true lines to a list that is no
 * longer true — that one is replaced with fresh ids. Inheriting an id across
 * changed source text would silently move a reader's link to different words.
 *
 * **An older prompt version does not refuse, and that is the deliberate
 * difference from the glossary.** There, appending across a version "certified
 * rather than replaced" a `glossary/1` entry: its blended prose survived under
 * a `glossary/2` label that described it falsely. A quote has no prose of ours
 * to be false — its words are the author's, sliced out of the block and
 * verified — and **the certification is avoided at the stamp instead**: an
 * append keeps the list's own, older `version` (`buildQuotes`), so the list
 * goes on saying it holds lines an earlier prompt chose. Keeping them is what
 * the reader asked for — *"add a "Find more" button"*, in place of the one
 * that threw the list away — and refusing would make the first Find more on
 * every list written before `quotes/4` silently replace it.
 *
 * **Nor does a different profile.** Find more continues the list rather than
 * choosing it for somebody else, and sends the list's own setting; the glossary
 * refuses because its `difficulty` is relative to the reader, and a quote's
 * words are not. The one state where two profiles' choices can meet in a list
 * is the one where the badge is already warning about it — `buildQuotes` says
 * why the old stamp is kept.
 *
 * GPT Sol objected to both on the plan, as provenance written falsely into a
 * file; Fable arbitrated, 2026-09-11, for keeping the append and making the
 * stamps honest about a mixed list rather than refusing to make one.
 * docs/plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md.
 */
export function existingFor(onDisk: Quotes | null, sourceHash: string): Quotes | null {
  if (!onDisk || onDisk.sourceHash !== sourceHash) return null;
  return onDisk;
}

/**
 * The artefact, from what the model said plus what we could verify of it —
 * **and, on an append, the list it is extending**.
 *
 * An empty *fresh* result throws. Nothing to say is not a degenerate success —
 * it is a model call that produced nothing, and writing it would make the step
 * report done for ever after while the panel showed an empty band.
 *
 * **An append that adds nothing does not throw.** The prompt tells the model an
 * empty list is a real answer, and it is: the piece has no more lines worth
 * keeping. The list is written back with `lastAdded: 0`, and the panel says
 * so — without that sentence a Find more that found nothing would look exactly
 * like a button that did nothing (docs/reusable/silent-success.md).
 */
export function buildQuotes(
  parsed: { quotes?: unknown },
  opts: {
    slug: string;
    /**
     * The blocks the model was shown and new quotes may be found in. This is the
     * body-evidence subset in production.
     */
    blocks: readonly Block[];
    /**
     * Every article block, solely for the final document-order merge.
     *
     * A quote kept from an older pass may now be outside `blocks` because the
     * body-evidence policy changed without the article changing. Sorting the
     * merged list against the evidence subset would rank that existing quote as
     * missing and move it to the end — altering the list on a request for more.
     * Optional only for the pure helper's existing callers; production passes
     * the full article.
     */
    documentBlocks?: readonly Block[];
    sourceHash: string;
    /** The rendered profile this was written from, or null for none. */
    profile?: string | null;
    elapsedMs: number;
    /** Ids from the list this run is replacing — see `idsByText`. */
    inherit?: Map<string, string> | null;
    /**
     * The list this run is **appending to** — `existingFor`. Mutually exclusive
     * with `inherit`: production passes `existing` or neither; `inherit` remains
     * only for the tested same-article rewrite helper.
     */
    existing?: Quotes | null;
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
  const previous = opts.existing?.quotes ?? [];
  const placed = dedupeOverlaps(
    /* `undefined` falls through to `place`'s own default, so the one place a
       fresh set is minted stays in one place. */
    place(parsed.quotes, opts.blocks, opts.dropped, opts.scores),
    opts.dropped,
    takenSpans(previous, opts.blocks),
  );

  /* Ids already spent, so a fresh quote cannot be minted onto an id the
     inheritance is about to hand to a different one — or onto one the list
     being extended already uses. */
  const taken = new Set<string>([
    ...(opts.inherit?.values() ?? []),
    ...previous.map((q) => q.id),
  ]);
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
  const documentBlocks = opts.documentBlocks ?? opts.blocks;
  const ordered = inDocumentOrder(inheritIds(minted, opts.inherit ?? null), documentBlocks);
  if (ordered.length > MAX_QUOTES) opts.dropped.overCap += ordered.length - MAX_QUOTES;
  /* **The total ceiling cuts only new lines**, in document order for the same
     reason the per-pass cap does, and never a quote the reader already has. */
  const room = Math.max(0, MAX_QUOTES_TOTAL - previous.length);
  const pass = ordered.slice(0, MAX_QUOTES);
  if (pass.length > room) opts.dropped.overCap += pass.length - room;
  const added = pass.slice(0, room);

  if (previous.length === 0 && added.length === 0) {
    throw new Error("The model returned no quotes we could find in the article. Nothing to write.");
  }

  /* The drop counts and the time accumulate across passes, as the glossary's
     time does: `discarded` is a fact about the list on the screen — that it is
     shorter than what was produced — and after two passes that is both passes. */
  const before = opts.existing?.discarded;
  const discarded: QuoteDrops = { ...opts.dropped };
  if (before) {
    for (const key of Object.keys(discarded) as (keyof QuoteDrops)[]) {
      discarded[key] += before[key] ?? 0;
    }
  }

  return {
    /* **On an append, the list keeps the version it had.** `version` says which
       prompt chose these lines, and after a Find more on a `quotes/3` list most
       of them still were — restamping it `quotes/4` would clear the *outdated*
       banner over lines the current prompt never chose, and would do it even
       when the pass added nothing. Versions only move forwards, so the kept
       one is the oldest in the list, and *outdated* stays true, and the banner
       says *"These include lines chosen by an earlier version"*, which is true
       whether some or all of them were. GPT Sol on the plan; Fable arbitrated
       the shape, 2026-09-11. `generator` is the model, which has one value. */
    version: opts.existing ? opts.existing.version : PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    /* `null`, never absent. Absent means "written before this existed"; `null`
       means "written deliberately without a profile", and the panel needs to
       tell those two apart to decide whether its checkbox starts ticked.
       src/profile.ts § profileIsStale.

       **On an append, the list's own stamp is kept** — the pass that started
       it — and the panel sends the list's own setting, so the stamp is exact
       except in one state: the reader has changed or deleted their profile
       since. That is precisely the state in which the badge already says
       *"Written for a profile you have changed since"*, and keeping the old
       stamp keeps that warning up over a list that is now partly the old
       profile's; restamping would take it down. `existingFor` has the rest.
       `?? null` so that a list written before the field existed is stamped as
       what it was: chosen for nobody in particular. */
    profileHash: opts.existing
      ? (opts.existing.profileHash ?? null)
      : opts.profile
        ? hashProfile(opts.profile)
        : null,
    quotes: opts.existing ? mergeInDocumentOrder(previous, added, documentBlocks) : added,
    /* A copy, not the live object. `dropped` is threaded through by reference
       so the counters accumulate across `place` and `dedupeOverlaps`, and
       storing the reference would let a later mutation edit an artefact that
       has already been built. */
    discarded,
    passes: (opts.existing?.passes ?? (opts.existing ? 1 : 0)) + 1,
    lastAdded: added.length,
    generatedAt: new Date().toISOString(),
    elapsedMs: (opts.existing?.elapsedMs ?? 0) + opts.elapsedMs,
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
 * **Four states, and the same table as the glossary's and the ideas'**. This
 * stage appends **only when `sourceHash` matches**; a mismatch is a legitimate
 * replace with fresh ids rather than a fault.
 *
 * | | what it means | what happens |
 * |---|---|---|
 * | no previous quotes | a first run for this article | mint, quietly |
 * | ones whose `sourceHash` differs | the article's text or its tree moved | mint, quietly — **correct, not an error** |
 * | ones this store cannot read | we cannot tell which of those two it was | **the stage fails** |
 * | the store read throws | an infrastructure fault | **propagates; the stage fails** |
 *
 * Row two is `generateQuotes`'s to decide and not this function's, which is why
 * this hands back the artefact rather than a map of ids: the source comparison
 * decides between preserving the whole list and replacing it with fresh ids.
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

/* Exported for tests/quotes-stand-alone.test.ts, which holds that the length
   rule the model is told is the one `place` enforces. Both said 400 from the
   day the stage was built, as two separate literals nothing tied together. */
export const SYSTEM = `You are choosing the QUOTES worth keeping from this article: the
passages that matter most to what it is saying, which a reader would want to
carry out of it. A quote is a passage, not a line: one sentence, several
sentences, or a whole paragraph — as much as it takes to make sense on its own.

THE ABSOLUTE RULE

Every quote must be copied from the article VERBATIM — character for character,
exactly as it appears there. Not paraphrased, not tidied, not shortened with an
ellipsis, not stitched together from two places. If you cannot copy a passage
exactly, leave it out.

This is not a style preference. Everything you return is shown to the reader in
quotation marks, attributed to the author, beside the real text. A passage that
is nearly what they wrote is a false claim about a real person. Anything we
cannot find in the article is thrown away, so an approximation costs you the
entry and gains nothing.

WHAT EARNS A QUOTE

A passage earns its place for one of two reasons, and IMPORTANCE COMES FIRST.

- It CARRIES THE ARGUMENT. The point the piece turns on; the claim the rest is
  spent defending; the finding and what it shows; the objection stated in the
  author's own voice; the distinction everything after it depends on. These are
  what the list is for: a reader skimming only the quotes you choose should come
  away with the piece's argument.
- It IS WELL PUT. The passage you would repeat to somebody. Memorable, exact,
  surprising, funny, or simply better written than the sentences around it.

The best quotes are both. When choosing, look for the important passages first
and do not pass over one because it is plainly written. A passage that is only
well put still earns a place, but only when it is exceptionally so — a striking
sentence on a side point is worth less here than a plain one the argument rests
on.

LONG ENOUGH TO STAND ALONE

This matters as much as choosing well. Each quote is read on its own, in a
list, with nothing around it — the reader has not got the article open. A quote
that only makes sense once they go back to the paragraph it came from has
failed, however good the paragraph is.

The commonest way it fails is stopping too soon: taking the sentence that sets
something up and leaving the payoff in the next one. An opening question
without its answer; a problem without what the piece says about it; a result
without the comparison or the consequence that makes it a result. Keep reading
past your first sentence, and take the quote as far as its point goes.

  BAD  — "The study set out to answer a simple question."
         The set-up. The answer is in the next sentence, so that is where the
         quote ends.
  GOOD — "The study set out to answer a simple question: do people who sleep
         less remember less? They do, but only for faces — for words and
         places, a short night made no measurable difference."

Before you keep a quote, read it as if you had never seen the article. If you
would ask "and so?" or "which is what?", the answer is in the sentences after
it — take them too. If it leans on what came before ("This is why it fails"),
start earlier or choose another.

So expect many quotes to run to two or three sentences, and some to a whole
paragraph. Take the whole paragraph when all of it earns its place — when it is
the argument stated whole, and cutting it anywhere would lose something the
reader needs. Do not take one just because it is there: when a paragraph's point
is complete in one of its sentences, that sentence is the quote, and every
sentence added to it is one more the reader has to get through.

WHAT DOES NOT

- Scaffolding. "In this essay I will argue that ...", "But first, some
  background", "Let us turn to the second objection." That includes a
  sentence about what the piece itself is or is not trying to do — its scope,
  its audience, what it will cover — however complete it sounds on its own.
  Standing alone is necessary, not sufficient: the quote still has to say
  something about the subject, not about the article.
- A piece cut out of the middle of a sentence. Start where a sentence starts
  (or a clause that reads as one), so the quote has its own subject — "are more
  pious in church than in the family" is half a thought, however true — and end
  where a sentence ends.
- A statement of fact with nothing of the author in it. A date, a figure, a
  definition anyone would write the same way.
- A passage the piece is QUOTING rather than saying. Anything inside quotation
  marks, and anything in an indented block quote, belongs to whoever it was
  taken from. Skip it, however good it is — those are thrown away anyway, so
  offering one costs you the entry and gains nothing.
- Two overlapping versions of one passage. Pick the form that stands alone
  best; one of them will be thrown away anyway.
- Anything under ${MIN_QUOTE_CHARS} characters or over ${MAX_QUOTE_CHARS}. Under that
  it is a phrase; over it, it is more than a reader will read as one quote. Both
  are thrown away.

SPREAD THEM OUT, AND DO NOT REPEAT A POINT

Take them from across the whole piece. Three quotes from one paragraph and none
from the second half is a list about the opening, not about the article.

Each quote should say something the others do not. A piece often makes its
central point several times in different words; keep the best statement of it
and let the rest go. Five lines that all say the same thing are one quote and
four repetitions.

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
  /**
   * The quotes already on the list, on a Find more — `existingFor` — or empty
   * for a list of its own.
   *
   * **Here, in the user message, and never in `system`.** The article is the
   * cached system block, and it has to be byte-identical between a first pass
   * and every append after it or each pass pays for it again. The glossary
   * learnt that the expensive way (its `renderPrompt`).
   */
  existing: readonly Quote[];
}): string {
  const { tree, count, existing } = opts;
  const skeleton = partsOf(tree)
    .map((p, i) => `PART ${i + 1}: ${p.title}\n  ${p.gist ?? "(no gist)"}`)
    .join("\n\n");

  /* Near the top, where it will be read, and before the shape — the reader is
     context for *choosing* the lines, and the choosing is what the rest of this
     prompt is about. src/profile.ts § PROFILE_RULES. */
  const who = profileSection(opts.profile);

  /* The glossary's FORBIDDEN checklist, cut down to what a quote can do wrong:
     it cannot be a synonym, but it can be the same sentence again, or a
     longer or shorter cut of one already taken — which `dedupeOverlaps` would
     throw away anyway, so saying so up front saves the model the entry. And
     it can be a taken line's point in different words, which nothing
     downstream catches, so only the prompt can (`quotes/5`). */
  const already =
    existing.length === 0
      ? ""
      : `
=== ALREADY ON THE LIST ===

The reader already has these. Find up to ${count} MORE — lines that are not
these, and do not overlap them: not the same sentence again, not a longer or
shorter cut of one of them, and not a point one of them already makes, in other
words. Every one of these is kept whatever you return.

${existing.map((q) => `- ${q.text}`).join("\n")}

If there are genuinely no more lines worth keeping, return {"quotes": []}. That
is a real answer and a better one than padding.
`;

  const ask =
    existing.length === 0
      ? `Choose up to ${count} quotes. Fewer is fine — a short piece has few
lines worth keeping, and a list padded to a number is worse than a short list.`
      : `Choose up to ${count} MORE quotes. Fewer is fine, and none is fine.`;

  return `${ask}
${who ? `\n${who}\n` : ""}${already}
=== ITS SHAPE ===

${skeleton}`;
}

/**
 * Read the model's answer, fence, preamble, sign-off and all.
 *
 * `parseJsonAnswer`, never a bare `JSON.parse` — src/parse-json.ts has the
 * reasoning, and the short version is that nothing in this file logs and that is
 * not enough, because a thrown error is logged where it is caught and V8 quotes
 * the input in it.
 */
function parseJson(raw: string): { quotes?: unknown } {
  return parseJsonAnswer(raw, "the quotes response");
}

/**
 * Stage 5h over a data directory: one model call, and the artefact handed back.
 *
 * **It writes nothing**, which is the converted shape `sketch` introduced —
 * see the note in `generateSketch` (src/sketch.ts). The pipeline step returns it
 * as `parts` and the store writes it.
 *
 * **It appends to a list written from this same article, and replaces one the
 * article has left** — `existingFor`, and the header. `previous` is read to
 * decide which, for the taken list the prompt carries, and for the ids.
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
  /* **Append** to a list written from this same article — Find more. That is
     every previous list `existingFor` does not refuse, and it refuses only a
     moved article. */
  const existing = existingFor(onDisk, sourceHash);
  /* **No ids are inherited any more, and a stale replace mints every one
     fresh.** Ids came across only on a replace of an unmoved list, and since
     2026-09-11 an unmoved list is always appended to — so the one replace left
     is of a list the article moved out from under, where inheriting would
     carry a reader's `?quote=` link onto words from a different version of the
     piece. GPT Sol, on the plan, which had got this backwards. `idsByText`
     and `buildQuotes`' `inherit` stay, tested, for the day a same-article
     rewrite comes back; nothing in production passes one today. */

  /* **The argument, not the apparatus** — the same filter every article-reading
     stage applies at its call site rather than inside the prompt builders.
     Sharper here than anywhere: a bibliography entry or a footnote is not a
     line worth keeping, and it is exactly the kind of self-contained,
     confidently-worded sentence a model reaches for. It is also the half of the
     article `locate` must not search, or a quote lifted from a reference list
     would resolve to a real block and look verified. src/block-policy.ts. */
  const evidence = blocks.filter(isBodyEvidence);
  const words = articleWordCounts(blocks).body;
  /* **Never ask for more than the list has room for.** The answer's token
     allowance scales with `count`, so a Find more on a list one short of
     `MAX_QUOTES_TOTAL` would otherwise pay for forty lines and keep one. GPT
     Sol, on the plan. */
  const room = existing ? MAX_QUOTES_TOTAL - existing.quotes.length : MAX_QUOTES_TOTAL;
  const count = Math.min(suggestedQuotes(words), room);
  const started = Date.now();

  /* **At the ceiling there is nothing to ask**, so no call is made. The panel
     does not offer Find more there; this is for a request that arrives anyway —
     a second tab, a hand-written POST — and it answers the way a pass that
     found nothing does, so the reader is told the same true thing. */
  if (existing && count <= 0) {
    const dropped = noneDropped();
    return {
      quotes: buildQuotes({ quotes: [] }, {
        slug: tree.slug,
        blocks: evidence,
        documentBlocks: blocks,
        sourceHash,
        profile: opts.profile ?? null,
        elapsedMs: 0,
        existing,
        dropped,
      }),
      blocks: blocks.length,
      words,
      dropped,
      scores: noQuoteScoreDrops(),
      model: CAPABLE_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      elapsedMs: 0,
    };
  }

  /* Bounded by `count`, which is bounded by MAX_QUOTES — and per quote by
     MAX_QUOTE_CHARS, which is the whole reason it is a function
     (`answerTokensFor`). Undersizing this does not degrade: it throws
     `truncationFailure` and loses the whole pass. */
  const answerTokens = answerTokensFor(count);
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
            content: renderPrompt({
              tree,
              count,
              profile: opts.profile ?? null,
              existing: existing?.quotes ?? [],
            }),
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
        report(
          `up to ${count} ${existing ? "more " : ""}quotes, ${Math.round(chars / 1000)}k characters so far`,
        );
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
    documentBlocks: blocks,
    sourceHash,
    profile: opts.profile ?? null,
    elapsedMs: Date.now() - started,
    existing,
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
