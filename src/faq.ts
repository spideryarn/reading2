/**
 * Pipeline stage 5p — the **FAQ**: the questions a careful first-time reader
 * would put to this piece while reading it — the "wait, but…" moments — each
 * with the passages where the piece itself responds.
 *
 * docs/plans/260916d-faq-mode.md is the design, and GPT Sol's review of it
 * (docs/plans/260916d-faq-mode-review-sol.md) is where most of the rules below come from.
 *
 * **There is no command line here.** Re-running it against one article is a job:
 *
 *   POST /api/jobs { slug, steps: ["faq"], force: ["faq"] }
 *
 * ## What it shares with `ideas`, and what it deliberately does not
 *
 * **The request is Ideas' byte for byte up to the breakpoint** —
 * `articleWithIds(meta, blocks.filter(isBodyEvidence))` first, carrying the
 * cache breakpoint, then this stage's instructions — so it joins the
 * `ideas`/`timeline`/`quiz`/`sketch` cached prefix (src/models.ts §
 * `ARTICLE_RENDERER`). The user message carries the tree skeleton, which is why
 * the tree is in the fingerprint.
 *
 * What it does not share:
 *
 * 1. **No id inheritance and no previous-artefact read at all.** Nothing
 *    addresses a question yet — no `?faq=`, no per-question reader state — so
 *    ids are minted fresh per run for React keys, as `quiz` decided.
 * 2. **Every passage is verified the Citations way**: the id must be a block in
 *    the body evidence, `findQuote(…, "spaced")` must find the words in *that*
 *    block, and what is stored is `block.text.slice(start, end)`. Ideas' default
 *    forgiving match accepts `fall a part` for `fall apart`; a quotation shown
 *    under a question is a claim that the article says those words.
 * 3. **An overlong quote is dropped, never truncated** — a cut quotation inside
 *    quotation marks is a misquotation.
 * 4. **No profile** in the prompt or in the stamp, in v1.
 * 5. **An empty `questions: []` is a valid artefact.** The prompt says fewer, or
 *    none, is fine, and means it. What is not valid is a missing answer, or a
 *    non-empty one that validation empties — both throw.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { partsOf } from "./arc.js";
import type { Article } from "./article-input.js";
import { articleWithIds } from "./article-prompt.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { articleWordCounts, isBodyEvidence } from "./block-policy.js";
import { normaliseName } from "./ideas.js";
import { mintUniqueId } from "./ids.js";
import { stageFailure } from "./job-failure.js";
import { MODEL_REFUSED } from "./messages.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL, effortFor } from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import { findQuote } from "./quote-match.js";
import {
  articleWithIdsFingerprint,
  type BlockFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import type {
  Block,
  BlockId,
  Faq,
  FaqDropped,
  FaqPassage,
  FaqQuestion,
  Meta,
  Tree,
} from "./types.js";

export type { Faq, FaqDropped, FaqPassage, FaqQuestion } from "./types.js";

/**
 * Bumped whenever the prompt changes what a question *is*. Exported so tests
 * compare against the constant rather than a literal.
 */
export const PROMPT_VERSION = "faq/1";

/** The only hard number on quantity. The prompt's budget is an upper bound under it. */
export const MAX_QUESTIONS = 12;

/** Passages per question. More than three and the question is too broad. */
export const MAX_PASSAGES = 3;

/** A question is one sentence. Longer is not a question we can show. */
export const MAX_QUESTION_CHARS = 200;

/** A passage is a quotation, not a paragraph. Over this it is dropped, never cut. */
export const MAX_QUOTE_CHARS = 300;

/** Body words per question in the prompt's upper budget. */
export const WORDS_PER_QUESTION = 600;

/**
 * The prompt's **upper** budget: one question per ~600 body words, at least
 * one and at most `MAX_QUESTIONS`. Never a target — the prompt says fewer, or
 * none, is fine, because a count to reach is what turns a list of real
 * questions into a tour of the sections (Sol F5).
 */
export function questionBudget(words: number): number {
  return Math.min(MAX_QUESTIONS, Math.max(1, Math.round(words / WORDS_PER_QUESTION)));
}

/**
 * The answer budget in tokens, **derived from the field caps** (Sol F10):
 * a base for the JSON around the list, plus per question the question, up to
 * three quotes and their ids and punctuation — at a conservative three
 * characters a token. Undersizing does not degrade: it throws
 * `truncationFailure` and loses the whole pass.
 */
export const ANSWER_TOKENS =
  400 +
  MAX_QUESTIONS *
    Math.ceil((MAX_QUESTION_CHARS + 40 + MAX_PASSAGES * (MAX_QUOTE_CHARS + 60)) / 3);

/**
 * What this artefact was written from: the blocks, the tree (the skeleton is in
 * the user message) and the cited metadata head — `articleWithIdsFingerprint`,
 * the one `ideas` and `quiz` use. The stamp in src/pipeline.ts hands it the
 * real, nullable meta, and so does `generateFaq`.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  return articleWithIdsFingerprint(blocks, tree, meta);
}

/** Does this artefact still describe the article, tree and metadata? */
export function isStale(
  faq: Faq,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return faq.sourceHash !== inputFingerprint(blocks, tree, meta);
}

export function emptyDropped(): FaqDropped {
  return {
    unknownIds: 0,
    unquoted: 0,
    tooLong: 0,
    duplicate: 0,
    unanchored: 0,
    overCap: 0,
    malformed: 0,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

interface RawQuestion {
  question?: unknown;
  passages?: unknown;
}

interface RawPassage {
  blockId?: unknown;
  quote?: unknown;
}

/** A verified passage, with the end offset kept for deduplication only. */
interface Located extends FaqPassage {
  end: number;
}

/**
 * Believe a passage only if the article backs it up — the id is a block in the
 * body evidence, and the words are in that block with their spacing intact.
 * The stored quote is the article's characters, never the model's.
 */
export function verifyPassage(
  raw: unknown,
  byId: ReadonlyMap<string, Block>,
  dropped: FaqDropped,
): Located | null {
  if (!raw || typeof raw !== "object") {
    dropped.malformed++;
    return null;
  }
  const p = raw as RawPassage;
  const block = byId.get(text(p.blockId));
  if (!block) {
    dropped.unknownIds++;
    return null;
  }
  const typed = text(p.quote);
  const span = typed ? findQuote(block.text, typed, undefined, "spaced") : null;
  if (!span) {
    dropped.unquoted++;
    return null;
  }
  if (span.end - span.start > MAX_QUOTE_CHARS) {
    dropped.tooLong++;
    return null;
  }
  return {
    blockId: block.id,
    quote: block.text.slice(span.start, span.end),
    start: span.start,
    end: span.end,
  };
}

interface Draft {
  /** The model's index of the first time this question appeared. */
  index: number;
  question: string;
  passages: Located[];
}

/**
 * Turn what the model said into questions, believing as little as possible.
 *
 * In the model's order: a question that repeats an earlier one (normalised
 * text) is **merged** into it — its passages join the first one's — and counted
 * as a duplicate. Passages are deduplicated on `{blockId, start, end}`, the
 * first `MAX_PASSAGES` survivors kept. A question left with none is dropped
 * (`unanchored`). Then the cap, in the model's order, and only then reading
 * order — so the cap keeps the questions the model listed first, and the
 * reader meets them in the order the piece raises them.
 */
export function toQuestions(
  raw: readonly unknown[],
  blocks: readonly Block[],
  dropped: FaqDropped,
): FaqQuestion[] {
  const byId = new Map(blocks.map((b) => [b.id as string, b]));
  const drafts = new Map<string, Draft>();
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const r = item as RawQuestion;
    const question = text(r.question);
    if (!question || question.length > MAX_QUESTION_CHARS) {
      dropped.malformed++;
      continue;
    }
    const key = normaliseName(question);
    let draft = drafts.get(key);
    if (draft) {
      dropped.duplicate++;
    } else {
      draft = { index, question, passages: [] };
      drafts.set(key, draft);
    }
    for (const p of Array.isArray(r.passages) ? r.passages : []) {
      const located = verifyPassage(p, byId, dropped);
      if (!located) continue;
      const same = draft.passages.some(
        (q) => q.blockId === located.blockId && q.start === located.start && q.end === located.end,
      );
      if (same) {
        dropped.duplicate++;
        continue;
      }
      if (draft.passages.length >= MAX_PASSAGES) {
        dropped.overCap++;
        continue;
      }
      draft.passages.push(located);
    }
  }

  const anchored: Draft[] = [];
  for (const draft of drafts.values()) {
    if (draft.passages.length === 0) {
      dropped.unanchored++;
      continue;
    }
    anchored.push(draft);
  }
  /* `drafts` iterates in insertion order, which is the model's order of first
     appearance — so the cap below keeps the first twelve the model listed. */
  if (anchored.length > MAX_QUESTIONS) {
    dropped.overCap += anchored.length - MAX_QUESTIONS;
    anchored.length = MAX_QUESTIONS;
  }
  return inReadingOrder(anchored, blocks);
}

/**
 * Passages in document order, and questions ranked by their earliest surviving
 * passage — independent of the order the model listed them in, with the
 * model's index as the tie-break (Sol F12). Fixed at write time.
 */
function inReadingOrder(drafts: readonly Draft[], blocks: readonly Block[]): FaqQuestion[] {
  const position = new Map<BlockId, number>();
  for (const [i, b] of blocks.entries()) position.set(b.id, i);
  const at = (p: Located): number => position.get(p.blockId) ?? Number.MAX_SAFE_INTEGER;
  const byPlace = (a: Located, b: Located): number =>
    at(a) - at(b) || a.start - b.start || a.end - b.end;

  const taken = new Set<string>();
  return drafts
    .map((d) => ({ d, passages: [...d.passages].sort(byPlace) }))
    .sort((a, b) => {
      const first = byPlace(a.passages[0]!, b.passages[0]!);
      return first !== 0 ? first : a.d.index - b.d.index;
    })
    .map(({ d, passages }) => ({
      id: mintUniqueId(taken),
      question: d.question,
      passages: passages.map(({ blockId, quote, start }) => ({ blockId, quote, start })),
    }));
}

/**
 * The artefact, from what the model said plus what we could verify of it.
 *
 * **Three empty outcomes** (Sol F8):
 * - no `questions` array — a failed answer, so it throws;
 * - `questions: []` — the model found nothing worth asking, a real answer;
 * - a non-empty array that validation empties — throws, with the counts, and
 *   nothing is written.
 */
export function buildFaq(
  parsed: { questions?: unknown },
  opts: {
    slug: string;
    blocks: readonly Block[];
    sourceHash: string;
    elapsedMs: number;
    dropped: FaqDropped;
  },
): Faq {
  if (!Array.isArray(parsed.questions)) {
    throw new Error(
      "The model's answer has no `questions` array in it, so there is nothing to read. " +
        "That is a failed answer rather than an empty one.",
    );
  }
  const d = opts.dropped;
  const questions = toQuestions(parsed.questions, opts.blocks, d);
  if (parsed.questions.length > 0 && questions.length === 0) {
    throw new Error(
      `The model named ${parsed.questions.length} questions and none of them could be ` +
        "anchored to the article, so there is nothing to write. " +
        `Dropped: ${d.unanchored} with no usable passage, ${d.unknownIds} passages naming a ` +
        `block id that is not in this article, ${d.unquoted} whose quote could not be found ` +
        `in the block it named, ${d.tooLong} quotes over ${MAX_QUOTE_CHARS} characters, ` +
        `${d.malformed} malformed, ${d.duplicate} duplicates.`,
    );
  }
  return {
    version: PROMPT_VERSION,
    /* `CAPABLE_MODEL`, the name — every staleness check compares against it. */
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    /* The store's spellings (`sourceHash`, `version`, `generator`), which
       `stampOf` reads — src/store/artifacts.ts. */
    sourceHash: opts.sourceHash,
    questions,
    dropped: { ...d },
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

export const FAQ_SYSTEM = `You are writing the FAQ for the article above — but not the usual kind.

WHAT THIS FAQ IS

The questions a careful, intelligent first-time reader would put to THIS piece
WHILE READING IT: the "wait, but…" moments. For each question, you point to the
one to three passages where the piece itself responds to it.

You do NOT write answers. The passages are the answer, in the article's own
words. The reader follows them back into the text and judges for themselves.

THE KINDS OF QUESTION THAT BELONG, MOST VALUABLE FIRST

- An objection the piece anticipates. "But doesn't X contradict Y?" — pointing
  to where the author deals with it.
- A move that needs clarifying. "Why say A here, when B was just conceded?" —
  pointing to where the piece explains itself.
- How one thing bears on another. "How does X bear on Y?" — pointing to the
  passages the reader needs to put side by side.
- An implication. "Does this commit the author to Z?" — pointing to where the
  piece says so, or comes closest.

THE RULE THAT MATTERS MOST

Skip any question a reader could answer by reading the passage in front of
them. Ask the one they would have AFTER reading it. The question is a doubt, a
tension or a connection a thoughtful reader actually feels at that point — not
a restatement of what the paragraph already says.

WHAT DOES NOT BELONG

- Whole-piece questions: "What is this article about?", "What are the main
  points?", "What does the author conclude?". That is a summary with question
  marks on it, and this is not the summary.
- A tour of the sections, one question each. Do not cover the piece part by
  part. Many parts raise no question worth asking; some raise two.
- A question whose whole answer is the meaning of one term ("What is X?",
  "What does the author mean by X?"). That is the glossary.
- Recall or trivia: a name, a date, a number, "what example does the author
  give". That is a quiz, and it asks the reader rather than the piece.
- Anything only the wider world can answer — what critics think, whether it is
  true, what happened next. The article must be where the response is.
- A question the piece does not respond to. If no passage actually addresses
  it, leave it out.

FOR EXAMPLE

An essay argues that a fridge does not break the second law of thermodynamics.

BAD — "What is the second law of thermodynamics?"
A definition. The glossary's job.

BAD — "What does the article say about fridges?"
A summary of a section wearing a question mark.

BAD — "What is the main argument of the essay?"
A whole-piece question.

GOOD — "If entropy can only increase, how can a fridge make its inside colder?"
The objection a careful reader raises, in the article's own terms, and the
piece answers it in a particular place.

WRITING THE QUESTION

- One sentence, one thing asked, under ${MAX_QUESTION_CHARS} characters, ending
  in a question mark.
- Ask it as the reader would, not as a description of the page: never "Why does
  the author say…" when "Why…" will do, and never locate it in the document
  ("In the third section…").
- Use the article's own words for the things the article names — those are the
  reader's handholds, and what they meet again in the passages — and ordinary
  words for everything else: plainer than the article, never further from it.

WHERE THE PIECE RESPONDS

Every block of the article above has an id like spya-k3m9qt. Each question
names one to three passages.

  "blockId" — MUST be one of the ids listed in the article. Never invent one and
              never guess at one you half-remember.
  "quote"   — copied VERBATIM from that block, character for character: the
              words, the spacing and the punctuation. Not a paraphrase, not
              tidied up, no "..." to skip words. At most ${MAX_QUOTE_CHARS}
              characters — the sentence or clause that responds, not the whole
              paragraph. A quote that is too long, or not found exactly in the
              block you named, is thrown away.

A question with no passage that survives is thrown away, so do not offer one
you cannot anchor.

HOW MANY

The user message gives an upper limit. It is a ceiling, not a target. Fewer is
fine. None is fine: if the piece raises no question worth asking, return an
empty list. A padded question is worse than a missing one.

OUTPUT

JSON only, no prose, no code fence:

{"questions": [
  {
    "question": "...?",
    "passages": [{"blockId": "spya-k3m9qt", "quote": "..."}]
  }
]}

THE ANSWER MUST PARSE. Inside a string, a straight double quote ends the
string, so if the article's quotation marks are straight ones, escape them as
\\". Never put a real line break inside a string.`;

/**
 * The user message: the budget, then the skeleton — the shape of the argument,
 * which is why the tree is in the fingerprint. Nothing about the reader.
 */
export function renderPrompt(opts: { tree: Tree; count: number }): string {
  const skeleton = partsOf(opts.tree)
    .map((p, i) => `PART ${i + 1}: ${p.title}\n  ${p.gist ?? "(no gist)"}`)
    .join("\n\n");
  return `Write the FAQ for this article: up to ${opts.count} questions. Fewer is fine, and none is fine.

=== ITS SHAPE ===

${skeleton}`;
}

function parseJson(raw: string): { questions?: unknown } {
  return parseJsonAnswer<{ questions?: unknown }>(raw, "the model's answer");
}

export interface FaqRun {
  faq: Faq;
  blocks: number;
  words: number;
  dropped: FaqDropped;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  maxTokens: number;
  elapsedMs: number;
}

export async function generateFaq(opts: {
  /** The article, handed in — never a directory to open. src/article-input.ts. */
  article: Article;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  /** Mark the article as a cache breakpoint — see src/glossary.ts for the note. */
  cacheArticle?: boolean;
}): Promise<FaqRun> {
  const { blocks, tree, meta: realMeta } = opts.article;

  /* **Two values, deliberately** — the stub is for the prompt's head and the
     fingerprint gets the real nullable meta, which is what the stamp hashes.
     Nothing may go on the stub that the fingerprint does not represent:
     src/ideas.ts has the long version, tests/meta-fallback-fingerprint.test.ts
     asks the property. */
  const meta: Meta = realMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);
  const sourceHash = inputFingerprint(blocks, tree, realMeta);

  /* The body only, applied here at the call site as `ideas` does — the same
     bytes, which is the cache share. And passages are verified against the
     same set, so an id from the bibliography is an invented one. */
  const evidence = blocks.filter(isBodyEvidence);
  const words = articleWordCounts(blocks).body;
  const count = questionBudget(words);
  const started = Date.now();
  const maxTokens = budgetFor("faq", ANSWER_TOKENS);

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "faq",
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: effortFor("faq") },
        /* Article first, then this stage's instructions: byte-identical to
           `ideas`, `timeline`, `quiz` and `sketch` up to the breakpoint. */
        system: [
          {
            type: "text" as const,
            text: articleWithIds(meta, evidence),
            ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
          },
          { type: "text" as const, text: FAQ_SYSTEM },
        ],
        messages: [{ role: "user", content: renderPrompt({ tree, count }) }],
      },
      { ...(opts.signal ? { signal: opts.signal } : {}) },
    );

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`up to ${count} questions, ${Math.round(chars / 1000)}k characters so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper
       is what records what this call cost. src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  if (wasRefused(message)) {
    throw stageFailure(MODEL_REFUSED, {
      authored: "the model answered with stop_reason: refusal",
    });
  }
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure("faq", maxTokens, ANSWER_TOKENS, {
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

  const dropped = emptyDropped();
  const faq = buildFaq(parseJson(raw), {
    slug: opts.article.slug,
    blocks: evidence,
    sourceHash,
    elapsedMs: Date.now() - started,
    dropped,
  });

  /* Nothing is written here — the caller writes through the store. */
  return {
    faq,
    blocks: blocks.length,
    words,
    dropped,
    model: CAPABLE_MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    maxTokens,
    elapsedMs: Date.now() - started,
  };
}
