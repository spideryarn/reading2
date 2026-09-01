/**
 * The **quiz**: the questions the piece can ask you back.
 *
 *   npm run quiz -- data/noema-mythology-of-conscious-ai
 *
 * Review mode today is free recall — the reader says what they took from the
 * article and the model shows them where that comes apart. This is the other
 * half of it, where the questions come from the article instead. Full design,
 * the cross-family review that rewrote most of it, and the spike that measured
 * the rest: docs/plans/260831al-review-quiz-sub-mode.md.
 *
 * **Stage 2 wired it up.** It is a `StepName`, a `PipelineStep` in
 * src/pipeline.ts, a `quiz` jsonb column (drizzle/0046_quiz.sql),
 * `GET /api/quiz/:slug`, and a band behind `?mode=review&review=quiz`. Stage 1
 * was this file, src/quiz-mark.ts and evals/quiz.ts and nothing else —
 * deliberately, because in this feature the prompt *is* the product and
 * everything else is plumbing around a page of instructions. The registration
 * checklist is in the plan, and the two entries on it that fail *silently* are
 * `STAMP_SOURCE` and the stamp field names below;
 * tests/quiz-step-registration.test.ts asks for both.
 *
 * ## What the model is asked for, and what it is not
 *
 *   question         one question mark, one thing asked
 *   referenceAnswer  two or three sentences — a DRAFT, not an answer key
 *   band             easy | medium | hard — how the answer is REACHED
 *   value            1–5, how central the thing asked about is
 *   evidence         [{ blockId, quote }], validated as `ideas` validates them
 *
 * It is **not** asked for a 1–5 ease score, and that is the plan's finding
 * rather than a preference: the spike measured two runs on a real article and
 * `ease` never left 2–4 across 24 questions, so the scale it was sorting by had
 * four values and a five-way tie. A band is a judgement about *how the answer
 * is reached*, which a model can make consistently, rather than a guess at how
 * a stranger will do. `QuizBand` in src/types.ts has the table.
 *
 * ## The order, which is the feature Greg actually asked for
 *
 * > the questions should be ordered by a combination of ease and value (i.e.
 * > easy-first-then-getting-harder, and central-or-important-first).
 * >
 * > — Greg, 2026-08-31
 *
 * Two clauses, and they are ranked in the order he said them. The first draft
 * of the plan implemented them as `ease + value` descending, which is the
 * **opposite** of the first clause: hard-central `(1,5)` and easy-peripheral
 * `(5,1)` both sum to 6, and the value tie-break then puts the hard one first.
 * `orderQuestions` below is lexicographic instead — band, then value, then
 * document position — and tests/quiz.test.ts asserts the case that gets it
 * wrong.
 *
 * ## The quota, and what happens on a short article
 *
 * A batch is required to use both ends of the band scale, because asking nicely
 * does not work — that is what the spike measured. But "at least three easy and
 * three hard" is right for a full twelve and is an *instruction to pad* a piece
 * that only supports four questions, and padding here produces a question about
 * nothing rather than a weak one the reader can skip.
 *
 * **So the quota scales with the batch and is enforced against what survived**:
 * `bandQuota` is `min(3, floor(n / 4))`, which asks three of each end of a full
 * twelve, two of an eight, one of a four, and nothing at all of a batch of
 * three. A full batch that came back all-`medium` is a failed generation and
 * throws; a genuinely short article cannot fail on bands. The count rule is
 * unchanged and is a ceiling rather than a floor: **up to twelve, fewer where
 * the article does not support twelve.**
 *
 * That was the open decision the plan left for this stage, and it is recorded
 * here rather than in the plan because the arithmetic is the thing a future
 * reader will want to see.
 *
 * ## What the stage refuses
 *
 * - **A question whose evidence does not survive** — an id not in blocks.json,
 *   or a quote `findQuote` cannot locate — is dropped, as `ideas` drops an
 *   occurrence-less idea. Checking that an id exists proves only that a
 *   paragraph exists; the quote is what ties the reference answer to the page.
 * - **A batch with no surviving questions fails**, rather than writing an empty
 *   artefact. An empty quiz is indistinguishable from a working one until a
 *   reader opens it, and writing one makes the step report done for ever after.
 * - **An answer with no `questions` array at all fails** and says so. Unlike
 *   `timeline` there is no legitimate empty case here — every article can be
 *   asked about — so both roads lead to a throw and the message says which.
 *
 * ## No id inheritance, and therefore no baseline read
 *
 * `ideas` and `timeline` inherit ids across a re-run so a reader's `?idea=` and
 * `?event=` links survive. A quiz question has no consumer that outlives its
 * batch — no stored attempts, no `?quiz=<id>` link — so inheritance here would
 * be machinery serving nothing, and `generateQuiz` therefore takes no
 * `previous`. It arrives with the first thing that needs it, which is stored
 * attempts. **Nothing may call `readBaseline` for this kind**, because there is
 * no `BASELINE` row for it and that function throws for a kind with none.
 *
 * ## No profile in v1
 *
 * Stated rather than defaulted into. There is a real argument for one — how
 * hard a question is depends on who is reading, which is the argument `ideas`
 * accepted — and it is deferred because it costs six more touchpoints and makes
 * every quiz stale the moment somebody edits their profile. Adding it later
 * needs no migration, since `profileHash` is a field on a JSON artefact. Define
 * the bands for a well-read non-specialist first.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { partsOf } from "./arc.js";
import { type Article, readArticleFromDir } from "./article-input.js";
import { articleWithIds } from "./article-prompt.js";
import { articleWordCounts, isBodyEvidence } from "./block-policy.js";
import { stageCli } from "./cli-ledger.js";
import { loadEnvLocal } from "./env.js";
import { mintUniqueId } from "./ids.js";
/* One symbol, and it is imported rather than copied for the reason AGENTS.md
   gives about second copies: this is exactly the same question `ideas` asks
   when it decides whether two spellings name one thing, and a private
   near-duplicate of it here would drift. */
import { normaliseName } from "./ideas.js";
import { MODEL_REFUSED } from "./messages.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { CAPABLE_MODEL, effortFor } from "./models.js";
import { parseJsonFrom, readJsonOrNull, stripFence } from "./parse-json.js";
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
  Meta,
  Quiz,
  QuizBand,
  QuizDropped,
  QuizEvidence,
  QuizQuestion,
  QuizQuestionId,
  Tree,
} from "./types.js";

/**
 * Bumped whenever the prompt changes in a way that changes what a *question*
 * is.
 *
 * Exported so tests assert against the current value rather than pinning a
 * literal — a fixture that hardcodes the version tests the fixture.
 */
export const PROMPT_VERSION = "quiz/1";

/**
 * The most questions one batch may carry into the artefact.
 *
 * Greg asked for "batches of a dozen or so", and twelve is a **ceiling, not a
 * target**: the prompt says fewer is fine and the plan is explicit that a
 * minimum of six is an instruction to pad a short piece. Enforced here as well
 * as asked for in the prompt, because nothing makes a model obey a number.
 */
export const MAX_QUESTIONS = 12;

/**
 * The most pieces of evidence one question may carry.
 *
 * Three, matching the prompt's "one to three blocks" — and the spike found that
 * rule respected exactly, with zero invented ids out of 46 across two runs. If
 * the answer really lives in more than three blocks the question is too broad,
 * which is a reason to ask a different question rather than to raise this.
 */
export const MAX_EVIDENCE = 3;

/** The most of each end of the band scale a batch is ever required to carry. */
export const BAND_QUOTA_CAP = 3;

const BANDS: ReadonlySet<string> = new Set<QuizBand>(["easy", "medium", "hard"]);

/** The two ends the quota is about. `medium` is what is left over. */
const QUOTA_BANDS: readonly QuizBand[] = ["easy", "hard"];

/** Where a band sorts. Lower is earlier. */
const BAND_ORDER: Record<QuizBand, number> = { easy: 0, medium: 1, hard: 2 };

export type { Quiz, QuizBand, QuizEvidence, QuizQuestion, QuizQuestionId };

/**
 * The artefact's own types live in src/types.ts, beside `Ideas` and `Timeline`
 * and every other artefact's, and are re-exported here because this file is
 * what a caller already imports. `tests/client-imports.test.ts` is the reason:
 * the panel cannot reach a module with a CLI and a model call in it, so the
 * shape both sides speak has to live in a file that imports nothing.
 */
export type Dropped = QuizDropped;

export function emptyDropped(): QuizDropped {
  return {
    unknownIds: 0,
    unquoted: 0,
    truncated: 0,
    overCap: 0,
    malformed: 0,
    duplicate: 0,
    unanchored: 0,
  };
}

/**
 * What this artefact was written from: **the blocks, the tree and the
 * metadata** — `articleWithIdsFingerprint`, the same one `ideas` and `sketch`
 * use, because this stage renders the article with ids and must move when they
 * do.
 *
 * The tree is in it for `ideas`' reason: the prompt shows the model the
 * skeleton before the article, so re-cutting the sections changes the question
 * being asked while every block stays byte-identical.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  return articleWithIdsFingerprint(blocks, tree, meta);
}

/** Does this artefact still describe the article, tree and metadata on disk? */
export function isStale(
  quiz: Quiz,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return quiz.sourceHash !== inputFingerprint(blocks, tree, meta);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** One question as the model returns it, before any of it has been believed. */
interface RawQuestion {
  question?: unknown;
  referenceAnswer?: unknown;
  band?: unknown;
  value?: unknown;
  evidence?: unknown;
}

interface RawEvidence {
  blockId?: unknown;
  quote?: unknown;
}

/**
 * **How many of each end a batch of this size has to carry.**
 *
 * `min(3, floor(n / 4))` — three of each end of a full twelve, two of an eight,
 * one of a four, none of a batch of three. See the header for why this scales
 * rather than being a flat three: a flat quota on a short article is an
 * instruction to pad, and the count rule is a ceiling rather than a floor.
 *
 * Measured against what **survived** validation, not against what the model
 * returned. A batch whose three `easy` questions were all dropped as unanchored
 * is a batch with no easy questions in it, whatever the model intended.
 */
export function bandQuota(kept: number): number {
  return Math.min(BAND_QUOTA_CAP, Math.floor(Math.max(0, kept) / 4));
}

/** Which ends of the scale this batch is short of, and by how much. */
export function quotaShortfall(
  questions: readonly QuizQuestion[],
): { band: QuizBand; want: number; have: number }[] {
  const want = bandQuota(questions.length);
  if (want === 0) return [];
  const out: { band: QuizBand; want: number; have: number }[] = [];
  for (const band of QUOTA_BANDS) {
    const have = questions.filter((q) => q.band === band).length;
    if (have < want) out.push({ band, want, have });
  }
  return out;
}

/**
 * Believe a piece of evidence only if the article backs it up — **the id must
 * exist, and the words must be there.** The same discipline as
 * `validateOccurrences` in src/ideas.ts and src/timeline.ts.
 *
 * `"spaced"` rather than the default forgiving match, for the reason
 * src/quote-match.ts § `passes` gives: the forgiving pass deletes whitespace
 * entirely and so accepts a word the model split in two, and a located quote
 * here is being read as a claim that the model **copied** the article rather
 * than as a best effort at drawing a mark. The reader is shown these words
 * under "where to look".
 *
 * **The block's characters are stored, never the model's typing.** `findQuote`
 * is deliberately forgiving about case and whitespace, so a match is not a
 * promise that the two strings are equal — and what the panel shows as a
 * quotation has to be what the article says.
 */
export function validateEvidence(
  raw: unknown,
  blocks: readonly Block[],
  dropped: QuizDropped,
): QuizEvidence[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const out: QuizEvidence[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    /* Per element, before any field is read: a `null` or a bare string in the
       array throws on the first property access and would take the whole
       question with it. src/glossary.ts § `toEntries` had exactly this bug. */
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const e = item as RawEvidence;
    const blockId = text(e.blockId) as BlockId;
    const block = byId.get(blockId);
    if (!block) {
      dropped.unknownIds++;
      continue;
    }
    const typed = text(e.quote);
    const span = typed ? findQuote(block.text, typed, undefined, "spaced") : null;
    if (!span) {
      dropped.unquoted++;
      continue;
    }
    out.push({
      blockId,
      quote: block.text.slice(span.start, span.end),
      /* A disambiguator between repeats, never the anchor — the client re-finds
         the words itself in the *rendered* text, which is a different offset
         space from `block.text`. docs/project/block-ids.md. */
      start: span.start,
    });
  }
  if (out.length > MAX_EVIDENCE) {
    dropped.truncated += out.length - MAX_EVIDENCE;
    return out.slice(0, MAX_EVIDENCE);
  }
  return out;
}

/**
 * A `value` we can sort by, or `null` if the model did not give one.
 *
 * Out of range is **clamped rather than dropped**, and that asymmetry is
 * deliberate: `value: 7` is a good question with a sloppy number on it, and
 * throwing away the question over the number costs the reader something real.
 * A `value` that is not a number at all is different — there is nothing to
 * clamp, and the field is the sort key within a band, so the question has no
 * place to go.
 */
function readValue(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.min(5, Math.max(1, Math.round(raw)));
}

/**
 * Turn what the model said into questions, believing as little of it as
 * possible.
 *
 * The drop rule is **a question, a reference answer, a usable band, a usable
 * value, and at least one surviving piece of evidence**. The first four are
 * what makes a question askable; the fifth is what makes it checkable, and it
 * is the one `ideas` shares.
 *
 * Everything else degrades rather than failing the batch: eleven good questions
 * must not be lost because one came back with `band: "trivial"`.
 */
export function toQuestions(
  raw: unknown,
  blocks: readonly Block[],
  taken: Set<string>,
  dropped: QuizDropped,
): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  const seen = new Set<string>();
  const raws = Array.isArray(raw) ? raw : [];
  for (const [i, item] of raws.entries()) {
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const r = item as RawQuestion;
    const question = text(r.question);
    const referenceAnswer = text(r.referenceAnswer);
    const bandText = text(r.band).toLowerCase();
    const value = readValue(r.value);
    if (!question || !referenceAnswer || !BANDS.has(bandText) || value === null) {
      dropped.malformed++;
      continue;
    }
    /* Before the evidence, because a duplicate costs nothing to reject and
       validating its quotes would inflate the counters with work we are about
       to throw away. A model that asks the same thing twice has spent one of
       the twelve on nothing, which is worth counting. */
    const key = normaliseName(question);
    if (seen.has(key)) {
      dropped.duplicate++;
      continue;
    }
    const evidence = validateEvidence(r.evidence, blocks, dropped);
    if (evidence.length === 0) {
      dropped.unanchored++;
      continue;
    }
    seen.add(key);
    out.push({
      id: mintUniqueId(taken),
      question,
      referenceAnswer,
      evidence,
      band: bandText as QuizBand,
      value,
    });
    /* **The cap is enforced here, not merely requested in the prompt.** Nothing
       makes the model obey a number, and everything else in this file believes
       as little as possible of what came back. */
    if (out.length === MAX_QUESTIONS) {
      dropped.overCap += Math.max(0, raws.length - i - 1);
      break;
    }
  }
  return out;
}

/**
 * **Band, then value, then where the answer sits on the page.**
 *
 * Greg's two clauses, ranked in the order he stated them, with a third key
 * because ties are the common case rather than the edge case — the spike found
 * four distinct scores over twelve questions, with a five-way tie in one run.
 * "Then the model's own order" would therefore mean *arbitrary* for most of the
 * list; document order is the honest answer to "these two are equally easy and
 * equally central", and it reads well, because a tied group arrives in the
 * order the reader met it.
 *
 * **Pure**, and exported so it can be tested without a model. The order is
 * fixed at write time and never re-derived, for the reason `inReadingOrder` in
 * src/ideas.ts learned first: anything that walks the list to assign a number
 * or a colour would move every row on the page if the list re-sorted itself
 * between reads.
 */
export function orderQuestions(
  questions: readonly QuizQuestion[],
  blocks: readonly { id: BlockId }[],
): QuizQuestion[] {
  const position = new Map<BlockId, number>();
  for (const [i, b] of blocks.entries()) position.set(b.id, i);
  /* `MAX_SAFE_INTEGER` for an id we do not know, so it sorts LAST. Defaulting
     to 0 would put a question nobody can check at the top of the list, which is
     the wrong direction to be wrong in. */
  const rank = (q: QuizQuestion): number => {
    let first = Number.MAX_SAFE_INTEGER;
    for (const e of q.evidence) {
      const at = position.get(e.blockId);
      if (at !== undefined && at < first) first = at;
    }
    return first;
  };
  return questions
    .map((question, i) => ({ question, i, rank: rank(question) }))
    .sort((a, b) => {
      const bands = BAND_ORDER[a.question.band] - BAND_ORDER[b.question.band];
      if (bands !== 0) return bands;
      if (a.question.value !== b.question.value) return b.question.value - a.question.value;
      if (a.rank !== b.rank) return a.rank - b.rank;
      // Index last, so two questions alike on every key have a reason for their
      // order rather than an accident of sort stability.
      return a.i - b.i;
    })
    .map((x) => x.question);
}

/** The artefact, from what the model said plus what we could verify of it. */
export function buildQuiz(
  parsed: { questions?: unknown },
  opts: {
    slug: string;
    blocks: readonly Block[];
    sourceHash: string;
    elapsedMs: number;
    dropped: QuizDropped;
  },
): Quiz {
  /* **The shape of the answer, before the shape of anything in it.**
     `questions` absent, `null`, or an object rather than an array would all
     otherwise reach the loop, come back as `[]` and fall into the empty check
     below — which throws either way, but says the model named nothing when in
     fact it answered something we could not read. Two different failures, two
     different sentences. src/timeline.ts § `buildTimeline`. */
  if (!Array.isArray(parsed.questions)) {
    throw new Error(
      "The model's answer has no `questions` array in it, so there is nothing to read. " +
        "That is a failed answer rather than an empty one — an article this stage has " +
        "nothing to ask about does not exist.",
    );
  }

  /* The batch id is minted first and reserved, so no question can be given the
     same id as the batch it is in. Both are `spya-` ids by construction. */
  const taken = new Set<string>();
  const batchId = mintUniqueId(taken);
  const fresh = toQuestions(parsed.questions, opts.blocks, taken, opts.dropped);
  const d = opts.dropped;

  if (fresh.length === 0) {
    throw new Error(
      `The model named ${parsed.questions.length} questions and none of them could be ` +
        "anchored to the article, so there is nothing to write. " +
        `Dropped: ${d.unanchored} with no usable passage, ${d.unknownIds} pieces of evidence ` +
        `naming a block id that is not in this article, ${d.unquoted} whose quote could not be ` +
        `found in the block it named, ${d.malformed} malformed, ${d.duplicate} duplicates.`,
    );
  }

  /* **Structural, because a nagging sentence in the prompt could not achieve
     it.** The spike asked for a spread twice and got 2–4 both times. See
     `bandQuota` for why the requirement scales with what survived rather than
     being a flat three. */
  const short = quotaShortfall(fresh);
  if (short.length > 0) {
    throw new Error(
      `The batch does not use both ends of the band scale, so the reader would meet ${fresh.length} ` +
        "questions in an order that means nothing. " +
        short.map((s) => `wanted ${s.want} "${s.band}", got ${s.have}`).join("; ") +
        ". A batch of this size has to carry both ends — src/quiz.ts § bandQuota. " +
        "Run it again; if it keeps landing here, the prompt's spread rule is the thing to change.",
    );
  }

  return {
    version: PROMPT_VERSION,
    /* **`CAPABLE_MODEL`, the name, not the address.** Every staleness check
       compares a stored `generator` against this constant, and the prefixed
       OpenRouter spelling is how we reach the model rather than what it is
       called. src/models.ts § the third spelling. */
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    /* **`sourceHash`, `version`, `generator` — the store's spellings, off the
       artefact.** `stampOf` (src/store/artifacts.ts) reads these three names
       and no others; `inputHash`, `promptVersion` and `model` are the in-memory
       `StepStamp` names and appear nowhere on disk. Spelling them the other way
       makes `stampOf` return `{}`, `sameStamp` answer false on every
       comparison, and the step re-run on every job for ever — writing a
       perfectly good artefact each time, with nothing going red. GPT Sol's
       finding 3, and tests/quiz.test.ts asserts it. */
    sourceHash: opts.sourceHash,
    batchId,
    questions: orderQuestions(fresh, opts.blocks),
    dropped: { ...opts.dropped },
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

/**
 * The quiz on disk, or null — for this file's own CLI and the eval.
 *
 * Every road to `null` is the same road: no file, a truncated one, a document
 * of the wrong shape. Acceptable here because there is nothing to inherit — see
 * the header on id inheritance — so the worst case of being wrong is a
 * regeneration a person asked for.
 */
export async function readQuiz(dir: string): Promise<Quiz | null> {
  const found = await readJsonOrNull<Quiz>(path.join(dir, "quiz.json"));
  /* A truncated write parses as `null`, and `null` is a perfectly good JSON
     document — without this a caller would report "nobody has written the
     questions for this one yet", the artefact gone and nothing saying so. */
  if (!found || typeof found !== "object" || !Array.isArray(found.questions)) return null;
  return found;
}

export interface QuizRun {
  quiz: Quiz;
  blocks: number;
  words: number;
  dropped: QuizDropped;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
}

/**
 * **The generation prompt.**
 *
 * House style is `REVIEW_SYSTEM`'s in src/converse.ts: shouted section
 * headings, rules stated as prohibitions with the reason attached, the failure
 * named rather than gestured at. Several rules here are the fix for something
 * the spike actually produced on `data/noema-mythology-of-conscious-ai`, and
 * those are the ones tests/quiz.test.ts pins by name.
 */
export const QUIZ_SYSTEM = `You are setting short-answer questions on an article, for the person who has
just read it.

They will answer in a couple of sentences, from memory, WITHOUT the piece in
front of them. Every question must be answerable that way: from what the article
says, by somebody who read it once and was paying attention.

WHAT A GOOD QUESTION IS

- It has an answer the article actually gives, and the article settles it.
- It asks for understanding, not for a token to be retrieved. "What year did X
  happen" is a lookup; "why does the author think X had to happen when it did"
  is a question. Prefer the second, always.
- It can be answered in one to three sentences. If a full answer needs a
  paragraph, it is really three questions — ask the best one.
- It stands on its own. The reader sees the question and nothing else.
- It uses the article's own vocabulary for the things the article names, and
  ordinary words for everything else.

ONE QUESTION MARK, ONE THING ASKED

The test is removal, not phrasing: if you can delete one half of the sentence
and the other half is still a whole question, it was two questions with a
conjunction hiding the seam. Ask the better one.

  BAD   What does Seth say we should do, and not do, given our uncertainty?
  GOOD  What does Seth say we should not do, given our uncertainty?

  BAD   What is substrate independence and why does Seth reject it?
  GOOD  Why does Seth reject substrate independence?

Never append "and why?" to a question. It is the commonest form of this and it
survives every other check, because it reads as one question with its reason
attached. Ask the why on its own — it is always the better half, and the what is
usually contained in the answer to it.

  BAD   What does Seth say we should never deliberately try to do, and why?
  GOOD  Why does Seth say nobody should set out to build a conscious machine?

This is a rule about the SHAPE of the sentence rather than a preference about
length. A reader answering two questions in a couple of sentences answers
neither, and the second half is usually the one they drop.

WHAT IS NOT A QUESTION HERE

- Anything answerable without having read the piece. If a well-informed person
  could answer it from general knowledge, it tests nothing.
- Anything answerable from the title, or from the wording of the question. Never
  put the answer in the question.
- A question about the article as an OBJECT — its structure, its length, how
  many arguments it makes, what its sections are called. The reader is being
  asked about the subject, not about the document.
- A QUESTION ABOUT WHERE SOMETHING SITS IN THE PIECE. The reader is answering
  from memory of the SUBJECT and has no idea which paragraph, section or part
  of the argument you mean. This is the single most common way to write a
  question that reads well and cannot be answered, and it usually arrives as a
  clause at the FRONT, before the question has started:

    BAD   In the essay's closing argument, what kind of soul does Seth say
          actually matters?
    GOOD  What kind of soul does Seth say actually matters?

    BAD   The article ends by comparing two things. Which?
    BAD   Early on, what does Seth say about Blake Lemoine?
    BAD   In the section about computation, why…

  Before you write a question down, read its first eight words. If any of them
  locate the answer in the document rather than in the subject, delete them —
  the question is almost always better without.
- Trivia: a name, date or number that carries no weight in the argument.
- A question whose answer is a matter of opinion, or one the piece raises and
  deliberately leaves open. If the article does not settle it, there is nothing
  to check an answer against.

THE REFERENCE ANSWER

Write the answer you would accept, in plain words.

It is a DRAFT, NOT AN ANSWER KEY. Somebody else will mark the reader's attempt
against the ARTICLE, with your answer beside them as one reader's version of it,
and they are told to side with the reader if you and the article disagree. So
write the best answer you can and do not write it as though it were the only
one.

- Say only what the article says. Where you are stating the author's view rather
  than a fact, say so — "he argues that…".
- Include the part of the answer a reader is most likely to leave out.
- Do not include anything the question did not ask for.
- Two or three sentences, WITH FULL STOPS. One sentence held together by
  semicolons is three sentences with the punctuation filed off, and it is what
  comes out if you do not watch for it.
- If you cannot write a confident answer from the article's own words, the
  question is wrong. Drop it and set a different one.

WHERE THE ANSWER LIVES

Every block of the article below has an id like spya-k3m9qt. Each question names
the blocks its answer actually comes from — the ones that carry it, not the ones
nearby — with a quote from each.

  "blockId" — MUST be one of the ids listed below. Never invent one, and never
              guess at one you half-remember. A wrong id points the reader at
              the wrong paragraph, which is worse than nothing.
  "quote"   — copied VERBATIM from that block, character for character. Not a
              paraphrase, not tidied up. If you cannot copy it exactly, leave
              that piece of evidence out.

One to three blocks per question. If the answer really lives in more than three,
the question is too broad. A question you cannot anchor at all will be thrown
away, so do not offer it.

BAND — HOW THE ANSWER IS REACHED

Not how clever the reader is. How the answer is got to:

  "easy"   — stated in one passage, and the reader is recalling it.
  "medium" — a distinction or a connection the article draws between two
             statements.
  "hard"   — a move the argument makes across several passages, which the reader
             has to reconstruct.

THE SPREAD IS NOT OPTIONAL

A full batch must contain at least three "easy" and at least three "hard". A
batch that does not is thrown away whole and the article is asked again, so this
is not a target to aim near — it is a condition.

It is here because it does not happen by itself. Asked politely for a spread, a
model returns twelve questions in the middle and the reader then meets them in
an arbitrary order, which is the whole thing this ordering exists to prevent.

If you cannot find three easy questions worth asking, you have not looked at the
parts of the piece a reader remembers most easily. If you cannot find three hard
ones, you have not found what the argument actually turns on.

VALUE — HOW CENTRAL THE THING ASKED ABOUT IS

  5 — you cannot say you have read this piece without knowing this
  4 — a load-bearing part of the argument
  3 — worth knowing, and it supports something that matters
  2 — true and worth asking, and the main argument survives without it
  1 — true, and nothing else in the piece leans on it

Band and value are different axes and must not be collapsed into one. The
hardest question about the central claim is band "hard", value 5. Something
memorable that the argument does not lean on is band "easy", value 2. Both exist
in most pieces.

HOW MANY

Up to twelve. Fewer where the article does not support twelve — a short piece
gets a short quiz, and that is a correct answer. Do not pad: a padded question
is a question about nothing, which is worse than a weak one the reader can skip.

Cover the piece. Do not set eight questions on its first third.

OUTPUT

JSON only, no prose, no code fence:

{"questions": [
  {
    "question": "...",
    "referenceAnswer": "...",
    "band": "easy|medium|hard",
    "value": 4,
    "evidence": [{"blockId": "spya-k3m9qt", "quote": "..."}]
  }
]}

Every field is required on every question.

THE ANSWER MUST PARSE. Inside a string, use only the article's own quotation
marks, which are curly, or single quotes. A straight double quote inside a
string ends the string, and one of them loses the whole batch. Never put a real
line break inside a string either.`;

/**
 * What the model is shown: the skeleton, then the instruction.
 *
 * The skeleton before the full text, in the order `arc`, `glossary`, `ideas`
 * and `timeline` already use — it is what lets the model judge what the
 * argument turns on rather than what the article says most often, which is
 * exactly the judgement the `hard` band and the `value` scale both depend on.
 * It is also why this stage's freshness hash covers the tree.
 *
 * **Nothing about the reader goes in here**, and nothing about the call: the
 * article part above carries the cache breakpoint, and this stage shares that
 * prefix with `ideas`, `sketch` and `timeline` (`ARTICLE_RENDERER` in
 * src/models.ts).
 */
export function renderPrompt(opts: { tree: Tree }): string {
  const skeleton = partsOf(opts.tree)
    .map((p, i) => `PART ${i + 1}: ${p.title}\n  ${p.gist ?? "(no gist)"}`)
    .join("\n\n");

  return `Set the quiz for this article — up to ${MAX_QUESTIONS} questions.

=== ITS SHAPE ===

${skeleton}`;
}

/**
 * Read the model's answer, fence and all.
 *
 * `stripFence` then `parseJsonFrom`, never a bare `JSON.parse` —
 * src/parse-json.ts § `stripFence` has the reasoning.
 */
function parseJson(raw: string): { questions?: unknown } {
  return parseJsonFrom<{ questions?: unknown }>(stripFence(raw), "the model's answer");
}

/**
 * The answer budget, in tokens.
 *
 * Twelve questions, each carrying a question, two or three sentences of
 * reference answer, two scores and up to three verbatim quotes — call it 500
 * tokens apiece with the JSON around it, and then room to be wrong about that.
 * Undersizing does not degrade: it throws `truncationFailure` and loses the
 * whole pass, so this sits well clear rather than close.
 */
export const ANSWER_TOKENS = 10_000;

export async function generateQuiz(opts: {
  /**
   * **The article, handed in — never a directory to open.**
   *
   * src/article-input.ts. A stage's `stamp` asks the *store* for blocks, tree
   * and metadata, and every stage that also opened its own files hashed one
   * article and generated from another. On a laptop those are the same bytes;
   * through a job-scoped `/tmp` on a deployment they are not, and the result is
   * a stale artefact reporting itself current for ever. So **do not reach for
   * `fs` in here.**
   */
  article: Article;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  /** Mark the article as a cache breakpoint — see src/glossary.ts for the note. */
  cacheArticle?: boolean;
}): Promise<QuizRun> {
  const { blocks, tree, meta: articleMeta } = opts.article;

  /* **Two values, deliberately.** `articleWithIds` needs a head to write its
     `TITLE:` line, so an article with no metadata gets a stub — and the stub is
     for the PROMPT and stops there. The fingerprint is handed the real
     `articleMeta`, `null` and all, because the pipeline's `stamp` reads the
     article and sees `null`: hash the stub instead and this stage writes a
     fingerprint the stamp can never reproduce, so every article without
     metadata reports stale for ever with nothing red anywhere.

     **Nothing may go on that stub that the fingerprint does not represent.**
     `articleWithIdsFingerprint` resolves `fallbackHeadTitle` itself, so the one
     field here is covered and a second one would not be.
     src/ideas.ts has the long version, and tests/meta-fallback-fingerprint.test.ts
     asks the property itself. */
  const meta: Meta = articleMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);
  const sourceHash = inputFingerprint(blocks, tree, articleMeta);

  /* **The argument, not the apparatus** — applied at the call site, as
     src/ideas.ts explains: filtering inside `articleWithIds` would be right for
     the pipeline stages and wrong for search, explain and converse. */
  const evidence = blocks.filter(isBodyEvidence);
  const words = articleWordCounts(blocks).body;
  const started = Date.now();
  const maxTokens = budgetFor("quiz", ANSWER_TOKENS);

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "quiz",
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: effortFor("quiz") },
        /* Article first, then this stage's instructions. The cache prefix runs
           from the top of the request, so anything ahead of the article that
           differs between stages breaks the match before it starts. */
        system: [
          {
            type: "text" as const,
            /* **`articleWithIds`, not `articleText`** — every piece of evidence
               is a block id the model has to name, so the ids have to be on the
               page. `ideas` shipped once with the other renderer and every
               occurrence was dropped as an invented id, with the stage
               reporting that the model had returned nothing. `ARTICLE_RENDERER`
               in src/models.ts is where that fact is recorded. */
            text: articleWithIds(meta, evidence),
            ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
          },
          { type: "text" as const, text: QUIZ_SYSTEM },
        ],
        messages: [{ role: "user", content: renderPrompt({ tree }) }],
      },
      { ...(opts.signal ? { signal: opts.signal } : {}) },
    );

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        // Throttled: the model emits deltas far faster than anyone reads them,
        // and each of these is a write the job poller may pick up.
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`${Math.round(chars / 1000)}k characters of questions so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper
       is what records what this call cost. src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  if (wasRefused(message)) {
    /* `stop_details` is neither thrown nor logged — it is the provider's own
       words about a request that carried the whole article. src/messages.ts. */
    throw new Error(MODEL_REFUSED.message);
  }
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure("quiz", maxTokens, ANSWER_TOKENS, {
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
  const quiz = buildQuiz(parseJson(raw), {
    slug: opts.article.slug,
    blocks,
    sourceHash,
    elapsedMs: Date.now() - started,
    dropped,
  });

  /* **The file is written by the caller, not here** — the shape `sketch`,
     `ideas`, `quotes` and `timeline` already have. A generator that also writes
     works on a laptop and cannot work through a store that puts the artefact in
     a Postgres column. */
  return {
    quiz,
    blocks: blocks.length,
    words,
    dropped,
    model: CAPABLE_MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    elapsedMs: Date.now() - started,
  };
}

const BAND_MARK: Record<QuizBand, string> = { easy: "·  ", medium: "·· ", hard: "···" };

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: tsx src/quiz.ts <dir with blocks.json + tree.json>");
    console.error("Running it again replaces the quiz — it does not append, and ids do not carry.");
    process.exit(1);
  }
  /* **In `main`, never in `generateQuiz`.** The server already loaded
     `.env.local` before any stage runs, so doing it inside the generator would
     be a no-op there and an import of `node:fs` into a path that does not need
     one. `tests/paid-cli-ledger.test.ts` holds this rule for every stage CLI. */
  loadEnvLocal();
  const article = await readArticleFromDir(dir);
  // Before the call, not after: this is the only thing on screen while the
  // model works, and printing it afterwards makes the command look hung.
  console.log(`Setting the quiz with ${CAPABLE_MODEL}…`);
  const run = await generateQuiz({
    article,
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });

  const outFile = path.join(dir, "quiz.json");
  await writeFile(outFile, JSON.stringify(run.quiz, null, 2), "utf-8");

  const { quiz, dropped } = run;
  const count = (band: QuizBand) => quiz.questions.filter((q) => q.band === band).length;
  console.log(
    `\n${run.blocks} blocks, ${run.words} words → ${quiz.questions.length} questions ` +
      `(${count("easy")} easy, ${count("medium")} medium, ${count("hard")} hard), ` +
      `batch ${quiz.batchId}`,
  );
  for (const [i, q] of quiz.questions.entries()) {
    console.log(`\n${String(i + 1).padStart(2)}. ${BAND_MARK[q.band]} v${q.value}  ${q.question}`);
    console.log(`      ${q.referenceAnswer}`);
    console.log(`      ${q.evidence.map((e) => e.blockId).join(" ")}`);
  }
  console.log(`\nTokens:  ${run.inputTokens} in, ${run.outputTokens} out`);
  console.log(`Elapsed: ${(run.elapsedMs / 1000).toFixed(1)}s`);
  console.log(
    `Dropped: ${dropped.unanchored} unanchored, ${dropped.unknownIds} bad ids, ` +
      `${dropped.unquoted} unquoted, ${dropped.malformed} malformed, ` +
      `${dropped.duplicate} duplicates, ${dropped.truncated} pieces of evidence over the cap, ` +
      `${dropped.overCap} questions over the cap`,
  );
  console.log(`\nWrote ${outFile}`);
}

/* **`stageCli`, which is the guard and the ledger together.** Awaited rather
   than `void`ed: flushing the ledger, and any failure in it, are part of the
   command finishing rather than something the process might exit before doing.
   src/cli-ledger.ts says what the one line replaces and why it is one line. */
await stageCli(import.meta.url, main);
