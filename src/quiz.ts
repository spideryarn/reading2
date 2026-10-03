/**
 * The **quiz**: the questions the piece can ask you back.
 *
 * **There is no command line here.** Re-running this stage against one
 * article is a job, not a script:
 *
 *   POST /api/jobs { slug, steps: ["quiz"], force: ["quiz"] }
 *
 * That is the path the pipeline itself takes, so it exercises the store
 * writes — the half that actually breaks. The folder-reading CLI this file
 * used to carry was a second way to do the same thing, and was deleted on
 * 2026-09-01 (docs/project/ingest-queue.md § The pipeline is a list, not a function;
 * docs/plans/260831b-finish-the-database-move.md § sub-stage I).
 *
 * Remember mode today is free recall — the reader says what they took from the
 * article and the model shows them where that comes apart. This is the other
 * half of it, where the questions come from the article instead. Full design,
 * the cross-family review that rewrote most of it, and the spike that measured
 * the rest: docs/plans/260831al-review-quiz-sub-mode.md.
 *
 * **Stage 2 wired it up.** It is a `StepName`, a `PipelineStep` in
 * src/pipeline.ts, a `quiz` jsonb column (drizzle/0046_quiz.sql),
 * `GET /api/quiz/:slug`, and a band behind `?mode=remember&remember=quiz`. Stage 1
 * was this file, src/quiz-mark.ts and evals/quiz.ts and nothing else —
 * deliberately, because in this feature the prompt *is* the product and
 * everything else is plumbing around a page of instructions. The registration
 * checklist is in the plan, and the two entries on it that fail *silently* are
 * `STAMP_SOURCE` and the stamp field names below;
 * tests/quiz-step-registration.test.ts asks for both.
 *
 * ## What the model is asked for, and what it is not
 *
 *   premise          optional: one sentence restating the answer just
 *                    before — shown or hidden by the walk
 *   question         one question mark, one thing asked, answerable in a
 *                    sentence or two, whole without its premise
 *   referenceAnswer  one or two sentences — a DRAFT, not an answer key
 *   evidence         [{ blockId, quote }], validated as `ideas` validates them
 *
 * **In order.** The array the model returns is the path the reader walks, and
 * nothing here re-sorts it.
 *
 * ## A path, not a pool, since 2026-09-30
 *
 * > For the quiz mode, maybe what we want is, like, more questions, but try and
 * > make them easier, where maybe only a sentence or two is needed, and make the
 * > questions build on one another gradually, and so that each answer is not
 * > that effortful, but that by the time you've answered a whole bunch of them,
 * > you know, you've kind of gradually built up towards an understanding of why
 * > it is the way, you know, what the key takeaways are.
 * >
 * > — Greg, 2026-09-29 (SPIDERYARN-READING2-5W)
 *
 * Until then a batch was twelve independent questions, each tagged with a
 * `band` (easy / medium / hard) and a `value` (1–5), sorted band → value →
 * document position here and walked by an adaptive ladder in the panel. A
 * sequence whose questions lean on one another cannot be sorted by band or
 * hopped across by a ladder without breaking the steps that keep each one small,
 * so the band, the value, the sort, the spread gate and the ladder all went
 * together. What they were for — *start easy, stay at the right level* — the
 * path does by construction: every step is small.
 * docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md, and
 * docs/plans/260907d-make-the-quiz-adaptive.md for what was retired.
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
 * ## The profile: read and recorded, but not in the stamp
 *
 * Until 2026-09-30 the quiz ignored the profile. Greg, SPIDERYARN-READING2-6Q:
 * *"if I've said I want to understand their methods, most of the questions
 * should be about the methods, not an even spread across the paper."* So the
 * rendered profile the job already carries is handed to the prompt, in its own
 * section (`readerSection`) rather than the shared `profileSection`, because
 * the shared one promises the profile changes nothing about the article's
 * proportions and here the proportions are the point.
 *
 * 6Q let only the reason for reading move the path and kept *About you* to
 * vocabulary. Greg reversed that the next day: *"Quiz should definitely adapt
 * heavily based on User-profile and Why-are-you-reading"* (2026-10-01). Both
 * halves now move which parts are asked about, what kind of question is set
 * and how it is pitched, with one counterweight — the piece's own point stays
 * on the path however narrow the goal.
 * docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md.
 *
 * **It records which profile it was written for** (`profileHash`, since
 * 2026-10-02), so the Quiz band can carry the *written for your profile* badge
 * and its Regenerate. Greg: *"it needs a "Regenerate for my profile". That's
 * more important, ok to lose answers."* That field was held back until the
 * label that reads it arrived, because `ProfileCarrying` in src/store/pg.ts is
 * derived from every artefact type with one and would have put the quiz in
 * the owner's *make public* dialog — about a mode a shared link never carries.
 * It arrived with the label, and with `NeverShared` there, which keeps it out.
 * docs/plans/261002f-quiz-regenerate-for-my-profile.md.
 *
 * Two things it deliberately does not do, each Greg's or forced:
 *
 * - **Not in the stamp.** Changing your goal does not make a quiz stale or
 *   rewrite one; the badge says *older profile* and its Regenerate, or *Write
 *   them again*, is a forced run that resolves the profile at the press. Greg:
 *   *"no automatic regeneration needed for v1."*
 * - **Not `PROFILE_RULES`.** They speak of words spent and length, and carry a
 *   web-search rule the quiz has no use for; the quiz needs the path and the
 *   balance in its own terms, and two rules for one thing would disagree.
 *
 * docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md.
 */

import type Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { partsOf } from "./arc.js";
import type { Article } from "./article-input.js";
import { articleWithIds } from "./article-prompt.js";
import { articleWordCounts, isBodyEvidence } from "./block-policy.js";
import { mintUniqueId } from "./ids.js";
/* One symbol, and it is imported rather than copied for the reason AGENTS.md
   gives about second copies: this is exactly the same question `ideas` asks
   when it decides whether two spellings name one thing, and a private
   near-duplicate of it here would drift. */
import { normaliseName } from "./ideas.js";
import { stageFailure } from "./job-failure.js";
import { MODEL_REFUSED, QUIZ_NOTHING_ANCHORED } from "./messages.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { effortFor, generatorFor, type ModelPower } from "./models.js";
import { parseJsonAnswer, readJsonOrNull } from "./parse-json.js";
import {
  assertNoBlockIdEnums,
  validateAnthropicJsonSchema,
  withMessagesJsonSchema,
} from "./messages-structured-output.js";
import { findQuote } from "./quote-match.js";
import {
  articleWithIdsFingerprint,
  type BlockFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import { plainWords } from "./plain-words.js";
import { paperwork } from "./paperwork.js";
import { hashProfile } from "./profile.js";
import type {
  Block,
  BlockId,
  Meta,
  Quiz,
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
 *
 * **`quiz/3`, 2026-09-05: the batch leads much easier.** The distribution the
 * prompt asks for moved (five easy and two hard, from three and three), the
 * definition of `easy` moved with it, and the questions are now asked to sit on
 * what the argument leans on. That is squarely "what a question is" — unlike
 * the 2026-09-03 edit recorded below `QUIZ_SYSTEM`, which deleted a false claim
 * about our own failure handling and deliberately did not bump. A reader with a
 * quiz gets the `outdated` sentence and a *Write them again* button, which is
 * the honest offer: theirs is a harder quiz than the one this prompt now sets.
 *
 * `quiz/4`, 2026-09-28: the prompt's own plain-words wording gave way to the shared `plainWords` section, one rule for every prompt (Greg, 2026-09-28; docs/plans/260926a-plainer-summaries-and-glossary.md, stage 3).
 *
 * **`quiz/5`, 2026-09-30: a path, not a pool.** Up to twenty smaller questions,
 * each answerable in a sentence or two and leaning on the ones before, ending at
 * the piece's takeaways and why they hold; no band, no value. See the header.
 * Every stored quiz is `outdated` after this, which is right: it is a pool, and
 * its reader is offered the path.
 *
 * **Not bumped for the reader (6Q, 2026-09-30; 261001c, 2026-10-01)**, although
 * a profiled quiz is a different quiz: the change reaches only requests that
 * carry a profile, a no-profile request is byte-for-byte what it was, and a
 * bump would mark every stored quiz outdated — the no-profile ones for nothing.
 * The profile is not in the stamp either (see the header), so a reader picks up
 * the new rules at *Write them again*.
 *
 * `quiz/6`, 2026-10-02: the request gained `QUIZ_OUTPUT_SCHEMA`; the prompt
 * text is unchanged.
 *
 * `quiz/7`, 2026-10-03: the prompt gained the shared paperwork section,
 * `paperwork("pick")` from src/paperwork.ts (Greg, 2026-10-01, spya-k930hy;
 * docs/plans/261003d-paperwork-in-every-whole-piece-mode.md).
 */
export const PROMPT_VERSION = "quiz/7";

/**
 * The most questions one batch may carry into the artefact.
 *
 * **Twenty, since 2026-09-30**, from twelve: Greg asked for *"more questions,
 * but … easier"*, and a path of small steps needs more of them to arrive
 * anywhere. Still a **ceiling, not a target** — the prompt says a short piece
 * gets a short path, and a minimum would be an instruction to pad. Enforced here
 * as well as asked for in the prompt, because nothing makes a model obey a
 * number.
 */
export const MAX_QUESTIONS = 20;

/**
 * The most pieces of evidence one question may carry.
 *
 * Three, matching the prompt's "one to three blocks" — and the spike found that
 * rule respected exactly, with zero invented ids out of 46 across two runs. If
 * the answer really lives in more than three blocks the question is too broad,
 * which is a reason to ask a different question rather than to raise this.
 */
export const MAX_EVIDENCE = 3;

export type { Quiz, QuizEvidence, QuizQuestion, QuizQuestionId };

/**
 * The artefact's own types live in src/types.ts, beside `Ideas` and `Timeline`
 * and every other artefact's, and are re-exported here because this file is
 * what a caller already imports. `tests/client-imports.test.ts` is the reason:
 * the panel cannot reach a module with a model call in it, so the
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
    gaps: 0,
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
  premise?: unknown;
  referenceAnswer?: unknown;
  evidence?: unknown;
}

interface RawEvidence {
  blockId?: unknown;
  quote?: unknown;
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
 * The premise, if it is one worth showing — or `undefined`.
 *
 * **It degrades, never fails the question.** A premise is optional help; a
 * question whose premise is wrong is still a question. So an empty one, one
 * that merely repeats the question, or one that contains the question's own
 * reference answer outright (the giveaway the prompt forbids, caught at its
 * crudest) is removed and the question kept. Subtler giveaways are the eval's
 * to find, not a string match's.
 */
function readPremise(raw: unknown, question: string, referenceAnswer: string): string | undefined {
  const premise = text(raw);
  if (!premise) return undefined;
  const p = normaliseName(premise);
  if (p === normaliseName(question)) return undefined;
  if (p.includes(normaliseName(referenceAnswer))) return undefined;
  return premise;
}

/**
 * Turn what the model said into questions, believing as little of it as
 * possible.
 *
 * The drop rule is **a question, a reference answer, and at least one
 * surviving piece of evidence**. The first two are what makes a question
 * askable; the third is what makes it checkable, and it is the one `ideas`
 * shares.
 *
 * Everything else degrades rather than failing the batch: nineteen good
 * questions must not be lost because one came back malformed. **The order is
 * kept** — it is the path — so a dropped question leaves a gap one step wide;
 * the prompt's premise rule is what keeps the next step answerable across it.
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
  /* **Drops since the last kept question.** They become `gaps` only when a
     later question is kept, because a drop at the very end shortens the path
     and a drop in the middle breaks it — and only the second is worth a
     signal. docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md
     § F4, which also says why this counts rather than failing the batch. */
  let pending = 0;
  const drop = (reason: "malformed" | "duplicate" | "unanchored") => {
    dropped[reason]++;
    pending++;
  };
  for (const [i, item] of raws.entries()) {
    if (!item || typeof item !== "object") {
      drop("malformed");
      continue;
    }
    const r = item as RawQuestion;
    const question = text(r.question);
    const referenceAnswer = text(r.referenceAnswer);
    if (!question || !referenceAnswer) {
      drop("malformed");
      continue;
    }
    /* Before the evidence, because a duplicate costs nothing to reject and
       validating its quotes would inflate the counters with work we are about
       to throw away. A model that asks the same thing twice has spent one of
       the twenty on nothing, which is worth counting. */
    const key = normaliseName(question);
    if (seen.has(key)) {
      drop("duplicate");
      continue;
    }
    const evidence = validateEvidence(r.evidence, blocks, dropped);
    if (evidence.length === 0) {
      drop("unanchored");
      continue;
    }
    seen.add(key);
    dropped.gaps = (dropped.gaps ?? 0) + pending;
    pending = 0;
    const premise = readPremise(r.premise, question, referenceAnswer);
    out.push({
      id: mintUniqueId(taken),
      question,
      ...(premise ? { premise } : {}),
      referenceAnswer,
      evidence,
    });
    /* **The cap is enforced here, not merely requested in the prompt.** Nothing
       makes the model obey a number, and everything else in this file believes
       as little as possible of what came back.

       **What that number is worth knowing about.** It counts the elements after
       the break — the ones this loop never examines — so it is a hint and not a
       finding. A non-zero count is consistent with this bug and equally
       consistent with the model appending junk or a duplicate, and on a path
       it means the model walked further than we keep — the end of its route,
       which is where the takeaways are. Worth watching for that reason. Read it as "how much of the
       answer went unread", and if you want to know whether a usable question
       was in there, look at the raw answer. */
    if (out.length === MAX_QUESTIONS) {
      dropped.overCap += Math.max(0, raws.length - i - 1);
      break;
    }
  }
  return out;
}

/** The artefact, from what the model said plus what we could verify of it. */
export function buildQuiz(
  parsed: { questions?: unknown },
  opts: {
    slug: string;
    blocks: readonly Block[];
    sourceHash: string;
    /** The power it was written at — the stamp names the model (plan 260930f). */
    power: ModelPower;
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
    /* The tally is the diagnostic and `QUIZ_NOTHING_ANCHORED` is the reader's
       sentence — five drop reasons are what somebody debugging the validator
       reads and nothing a reader can act on. src/job-failure.ts § Two strings,
       not one. */
    throw stageFailure(
      QUIZ_NOTHING_ANCHORED,
      `The model named ${parsed.questions.length} questions and none of them could be ` +
        "anchored to the article, so there is nothing to write. " +
        `Dropped: ${d.unanchored} with no usable passage, ${d.unknownIds} pieces of evidence ` +
        `naming a block id that is not in this article, ${d.unquoted} whose quote could not be ` +
        `found in the block it named, ${d.malformed} malformed, ${d.duplicate} duplicates.`,
    );
  }

  return {
    version: PROMPT_VERSION,
    /* **`CAPABLE_MODEL`, the name, not the address.** Every staleness check
       compares a stored `generator` against this constant, and the prefixed
       OpenRouter spelling is how we reach the model rather than what it is
       called. src/models.ts § the third spelling. */
    generator: generatorFor(opts.power),
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
    /* The model's order, untouched: it is the path the reader walks. */
    questions: fresh,
    dropped: { ...opts.dropped },
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

/**
 * The quiz on disk, or null — for the API's filesystem read path and the eval.
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
 * House style is `REMEMBER_SYSTEM`'s in src/converse.ts: shouted section
 * headings, rules stated as prohibitions with the reason attached, the failure
 * named rather than gestured at. Several rules here are the fix for something
 * the spike actually produced on `data/noema-mythology-of-conscious-ai`, and
 * those are the ones tests/quiz.test.ts pins by name.
 *
 * **What a `PROMPT_VERSION` bump is for**, since the call has been made both
 * ways here: it marks every stored quiz `outdated`, which rebuilds nothing but
 * puts a *Write them again* button in front of every reader who has one. So it
 * goes up when what a *question* is changes — `quiz/3` (easier, 2026-09-05),
 * `quiz/5` (a path, 2026-09-30) — and not for a wording fix, like the
 * 2026-09-03 edit that deleted a false promise of a retry.
 *
 * **The prompt describes what a good quiz is, and none of our machinery.** Two
 * of the old sections broke that rule and went stale within a day (a retry that
 * never existed; a floor the gate enforced that the prompt then advertised).
 * The history is in the commit log and in docs/plans/260903c-… and 260905g-….
 *
 * **Why the path's rules are shaped the way they are**
 * (docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md):
 *
 * - The takeaways are decided **privately** and never output. A field for them
 *   would be a summary the reader never asked for, and a thing to validate.
 * - The premise restates **only the answer immediately before**, and adds
 *   nothing. That is what lets the walk key its show/hide on the previous
 *   question's verdict alone (src/web/quiz-ladder.ts § `showPremise`), and
 *   "adds nothing" is the guard against the paraphrased giveaway a string match
 *   cannot catch — the premise that restates the last answer and then states
 *   the next step as well. GPT Sol's R2-1 and R2-4.
 * - The question must be whole **without** its premise, with the backward
 *   pointers ("this", "that result") named as banned, because a reader who got
 *   the last one right sees the question alone.
 * - "Two things joined by and" now has a cheap fix the old prompt lacked: set
 *   them as two steps. That is the path doing the work the ban used to do by
 *   prohibition alone.
 */
export const QUIZ_SYSTEM = `You are setting short-answer questions on an article, for the person who has
just read it.

They will answer from memory, WITHOUT the piece in front of them, one question at
a time, in the order you set them. Every question must be answerable that way:
from what the article says, by somebody who read it once and was paying
attention, and who has been walked through the questions before it.

THE QUIZ IS A PATH

This is not a pile of separate questions. It is a route, walked in small steps,
that ends with the reader understanding what the piece is for.

Before you write a question, decide privately what a reader should come away
with — the two to four takeaways that matter most — and why each one holds, in
the article's own terms. Do not write them down. The quiz is the way there.

Then walk it:

- START WITH WHAT THE PIECE PLAINLY SAYS. The first questions are about things the
  article states outright, that a reader recalls without effort.
- EACH QUESTION LEANS ON THE ONES BEFORE IT. Once the reader has said what X is,
  the next question can ask what X is for, or what follows from it, or what the
  author sets against it. Every step is small.
- END AT THE TAKEAWAYS, AND AT WHY THEY HOLD. The last few questions ask the reader
  to put the earlier steps together: what the piece is really claiming, and why
  the author thinks it is true. Even these are one small step from the question
  before — if the last question is a leap, the path is missing steps. Add them.

The reader should never feel a question is hard. They should feel, by the end,
that they have understood something.

THE PREMISE — HOW A STEP LEANS ON THE ONE BEFORE

Most questions after the first few carry a "premise": ONE sentence restating the
answer to the question IMMEDIATELY BEFORE this one, which this question builds
on. It is how the steps stay small, and it is what makes the quiz a path rather
than a list. If a question does not lean on the one just before it, leave the
premise out.

  BEFORE    What does Seth say brains do that computers do not?
  PREMISE   Seth ties consciousness to being alive, not to computing.
  QUESTION  Why does Seth doubt that a faster computer would ever be conscious?

The reader who got the question before right sees the QUESTION alone. The reader
who missed it, skipped it or jumped here sees the PREMISE first. Every rule below
exists because of that:

- THE PREMISE RESTATES THE ANSWER JUST GIVEN, AND ADDS NOTHING. No new
  consequence, reason or inference — above all, not the next step, because the
  next step is what this question asks for.

    BAD   PREMISE   Seth ties consciousness to being alive, so a computer, which
                    is not alive, could not be conscious however fast it ran.
          QUESTION  Why does Seth doubt a faster computer would be conscious?
    GOOD  PREMISE   Seth ties consciousness to being alive, not to computing.
          QUESTION  Why does Seth doubt a faster computer would be conscious?

- IF THE PREMISE SAYS SOMETHING NO QUESTION ASKED, A STEP IS MISSING. The
  premise may only say what the question just before it asked for. When you
  want the reader to know a new thing before this question, that new thing is
  its own step: ask it as a question first, then lean on it here. Never slip it
  in through a premise.

- CONTEXT IS NOT A PREMISE. A dense piece — a paper above all — tempts you to
  use the premise to set the scene: what was measured, on what, by which
  method. Do not. If the reader needs that setting to understand the question,
  put it briefly IN THE QUESTION ("In the mouse cortical cultures, how did…"),
  or make it a step of its own. A premise that sets the scene is hidden from
  exactly the reader who was doing well, and leaves them a question about a
  setting they were never given.

    BEFORE    What is synergy, in the article's sense?
    BAD       PREMISE   The researchers applied the method to thousands of
                        groups of three neurons in mouse brain tissue.
    GOOD      PREMISE   Synergy is information that only the sources together
                        carry, not either one alone.

    BEFORE    What does Seth call the idea that the right computation is enough
              for consciousness?
    BAD       PREMISE   Seth thinks brains, unlike computers, cannot be split
                        into software and hardware.
    GOOD      PREMISE   Seth calls it computational functionalism.

- THE QUESTION MUST BE A WHOLE QUESTION WITHOUT ITS PREMISE. Name the thing. No
  "this", "that", "these", "it", "the result", "the previous answer", "given
  this", "if so" pointing back at the premise or the question before.

    BAD   QUESTION  Why does that rule out a conscious computer?
    BAD   QUESTION  What does this imply about simulated brains?
    GOOD  QUESTION  Why does Seth doubt a faster computer would be conscious?

- A PREMISE DOES NOT MAKE A BIG STEP SMALL. "Why does the whole argument hold?"
  is still a leap with a sentence in front of it. If getting from the premise to
  the answer takes more than a sentence of thought, a step is missing. Add it.

EVERY QUESTION IS SMALL

- It can be answered in ONE OR TWO SENTENCES, without effort, by a reader who has
  been walked through the questions before it. If the reader would have to stop and work
  something out, it is two steps. Ask the first one, then the second.
- It has an answer the article actually gives, and the article settles it.
- It asks for understanding, not for a token to be retrieved. "What year did X
  happen" is a lookup; "why does the author think X had to happen when it did"
  is a question. Small is not the same as trivial.

ONE QUESTION MARK, ONE THING ASKED

The test is removal, not phrasing: if you can delete one half of the sentence
and the other half is still a whole question, it was two questions with a
conjunction hiding the seam. On a path the fix is easy: they are two steps, so
set them as two.

  BAD   What does Seth say we should do, and not do, given our uncertainty?
  GOOD  What does Seth say we should not do, given our uncertainty?

  BAD   What is substrate independence and why does Seth reject it?
  GOOD  What is substrate independence?  …then…  Why does Seth reject it?

Never append "and why?" to a question. It is the commonest form of this and it
survives every other check, because it reads as one question with its reason
attached. Ask the why on its own, as the next step.

This is a rule about the SHAPE of the sentence rather than a preference about
length. A reader answering two questions in a couple of sentences answers
neither, and the second half is usually the one they drop.

WHAT IS NOT A QUESTION HERE

- Anything answerable without having read the piece. If a well-informed person
  could answer it from general knowledge, it tests nothing.
- Anything answerable from the title, or from the wording of the question or its
  premise. Never put a question's own answer in either.
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
  the question is almost always better without. (A premise is about the
  subject — "Seth ties consciousness to being alive." — and is not this.)
- Trivia: a name, date or number that carries no weight in the argument.
- A question whose answer is a matter of opinion, or one the piece raises and
  deliberately leaves open. If the article does not settle it, there is nothing
  to check an answer against.

KEEP TO WHAT MATTERS

The path goes through what the argument leans on. A detail nothing rests on is a
detour, however neatly it asks — leave it out. The claim the whole piece rests on
is usually also the one it states most plainly, once, in a sentence a reader
remembers: that is a good early step, not only a destination.

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
- One or two sentences, WITH FULL STOPS. One sentence held together by
  semicolons is several sentences with the punctuation filed off, and it is what
  comes out if you do not watch for it. If the answer needs three, the question
  was two steps.
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

HOW MANY

Up to twenty. Fewer where the article does not support twenty — a short piece
gets a short path, and that is a correct answer. Do not pad: a padded question
is a question about nothing, which is worse than one fewer step.

Cover the piece. The takeaways usually draw on all of it, so the path should
too; do not spend half the steps on its first third.

${plainWords("ask", "explain")}

${paperwork("pick")}

OUTPUT

JSON only, no prose, no code fence. The questions in the order the reader walks
them:

{"questions": [
  {
    "premise": "...",
    "question": "...",
    "referenceAnswer": "...",
    "evidence": [{"blockId": "spya-k3m9qt", "quote": "..."}]
  }
]}

"premise" is optional: leave it out of a question that leans on nothing
earlier. Every other field is required on every question.

THE ANSWER MUST PARSE. Inside a string, use only the article's own quotation
marks, which are curly, or single quotes. A straight double quote inside a
string ends the string, and one of them loses the whole batch. Never put a real
line break inside a string either.`;

/**
 * The rules for a request that says who is reading, or why — sent as a system
 * block of their own **only when there is a profile**, so a request without one
 * is byte-for-byte the request every quiz got before 6Q (GPT Sol, plan review
 * F8: a conditional paragraph still speaks to a model whose condition is
 * absent). The block sits after the article's cache breakpoint, so carrying it
 * or not costs the shared article prefix nothing.
 *
 * Greg, 2026-10-01: *"Quiz should definitely adapt heavily based on
 * User-profile and Why-are-you-reading"* — both lines, which parts, what kind
 * of question, how it is pitched; with the piece's own point kept on the path.
 * docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md.
 */
export const QUIZ_READER_RULES = `IF THE REQUEST SAYS WHO IS READING, OR WHY

This request ends with a note about the reader: a line about who they are, a
line saying why they are reading this piece, or both. Set the quiz FOR THIS
READER, not for everyone. The note shapes three things: which parts of the
piece you ask about, what kind of question you set, and how you pitch it.

- WHICH PARTS. A reason for reading decides most of the path: choose the
  takeaways that matter for that reason, and spend most of the questions on the
  parts of the piece that bear on it. A reader who came for the methods gets a
  path mostly about the methods, not an even spread across the piece. A line
  about who they are moves the path too, towards what a person like them would
  most want from this piece: what bears on their field, their work, what they
  would do with it. With only who they are, it leads. The rule above about
  covering the whole piece gives way to this.
- WITH BOTH, the reason leads and who they are chooses within it: of the parts
  that bear on the reason, who they are decides which get most of the steps and
  which come first. Two readers with the same reason and different work should
  get visibly different quizzes. A trial's statistician and its clinician, both
  reading "for the methods", are not asked about the same methods: the one
  about how the analysis was done, the other about who was enrolled and how
  they were treated.
- PERSONALISE AMONG WHAT MATTERS. Choose among the consequential parts of the
  piece, the ones its argument leans on. A note never turns a detail nothing
  rests on into a good question.
- WHAT KIND OF QUESTION. Fit what this reader will do with the piece. Someone
  who will apply it gets more questions about how a thing is done, what it
  needs and where it breaks; someone weighing it up, more about the evidence
  and how far it reaches; someone new to the field, more about what things are
  and why they matter. Whatever the kind, the article answers it.
- HOW IT IS PITCHED. Assume the background they claim. A question they could
  answer from their own knowledge without having read the piece tests nothing
  for them, so leave it out, however useful it would be to somebody else. An
  expert needs fewer setup steps and a newcomer more and smaller ones — but
  never drop a step about what THIS piece says that a later question leans on.
  Use their field's words without explaining them. Never put enough in a
  question or premise to answer it.
- THE PIECE'S POINT IS STILL ON THE PATH. However narrow what they are after,
  the path ends where the piece ends up. Its last steps — normally three or
  four in a path of twenty, one or two in a short one — are a connected run
  that asks what the piece as a whole concludes, and the main evidence it gives
  for that, even when neither is what they came for. In a long path, one closing
  question about the conclusion is not enough: ask for the evidence too. Take
  these steps from setup, not from the steps about what they are after; keep
  setup to the few steps the later ones need. The part they came for is
  understood in the light of the whole, not instead of it. Do not pad the quiz
  to fit them in.
- IT IS STILL A PATH. Start with what the piece plainly says and lean each step
  on the one before. A few early steps may set up what the later ones need —
  what was studied, what the author is arguing against — so that the steps
  about what they are after have something to lean on.
- IT NEVER CHANGES WHAT THE ARTICLE SAYS. Every question is about the subject,
  answered by the article, anchored in its words. The note changes which parts
  you ask about and how, never what the piece says about them.
- If the piece has little on what they are after, set the path you would have
  set anyway, and never say so.
- Never address the reader, and never say or hint that a note was given — in
  a question, a premise or a reference answer. Nothing is asked "because" of it.
  The subjects the note names are ordinary words: use them wherever the
  article does.

    BAD   QUESTION  Since you came for the methods: how did the authors
                    measure synergy?
    GOOD  QUESTION  How did the authors measure synergy?`;

/**
 * What the model is shown: the skeleton, then the instruction.
 *
 * The skeleton before the full text, in the order `arc`, `glossary`, `ideas`
 * and `timeline` already use — it is what lets the model judge what the
 * argument turns on rather than what the article says most often, which is
 * exactly the judgement the takeaways at the end of the path depend on.
 * It is also why this stage's freshness hash covers the tree.
 *
 * **The reader goes here and nowhere earlier.** The article part above carries
 * the cache breakpoint, and this stage shares that prefix with `ideas` and
 * `timeline` (`ARTICLE_RENDERER` in src/models.ts), so the one
 * thing that varies per reader is in this, the last part.
 *
 * With no profile this varying user message is byte-for-byte what it was before
 * the reader arrived — Greg's *"the same as today when there isn't"*, which
 * tests/profile-prompts.test.ts asks of these bytes. Since 261001c so is the
 * whole request: the reader rules are a system block of their own
 * (`QUIZ_READER_RULES`), sent only with a profile.
 */
export function renderPrompt(opts: { tree: Tree; profile: string | null }): string {
  const skeleton = partsOf(opts.tree)
    .map((p, i) => `PART ${i + 1}: ${p.title}\n  ${p.gist ?? "(no gist)"}`)
    .join("\n\n");

  return `Set the quiz for this article — up to ${MAX_QUESTIONS} questions.

=== ITS SHAPE ===

${skeleton}${readerSection(opts.profile)}`;
}

/**
 * The profile, for this stage — **not `profileSection`**, whose reminder says
 * the profile changes nothing about the article's proportions. Here both
 * halves are meant to change exactly that; the binding rules are in
 * `QUIZ_READER_RULES`, a system block sent only with a profile, where the
 * profile cannot reach them. Empty — not a heading over nothing — when there is
 * no profile, for the reason `renderProfile` gives.
 */
function readerSection(profile: string | null): string {
  if (!profile) return "";
  return `

=== WHY THIS READER IS HERE ===

${profile}

Set the quiz for this reader: aim the path at what they are after, choose the
kind of question that fits what they will do with the piece, and pitch it to
the background they claim — keeping the piece's own point on the path.
Everything is still about what the article says. Do not address the reader and
do not mention this.`;
}

/**
 * Read the model's answer, fence, preamble, sign-off and all.
 *
 * `parseJsonAnswer`, never a bare `JSON.parse` — src/parse-json.ts has the
 * reasoning.
 */
function parseJson(raw: string): { questions?: unknown } {
  return parseJsonAnswer<{ questions?: unknown }>(raw, "the model's answer");
}

const quizStringSchema = { type: "string" } as const;
const quizEvidenceSchema = {
  type: "object",
  properties: { blockId: quizStringSchema, quote: quizStringSchema },
  required: ["blockId", "quote"],
  additionalProperties: false,
} as const;

/** The question shape in `QUIZ_SYSTEM`; only `premise` may be omitted. */
export const QUIZ_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          premise: quizStringSchema,
          question: quizStringSchema,
          referenceAnswer: quizStringSchema,
          evidence: { type: "array", items: quizEvidenceSchema },
        },
        required: ["question", "referenceAnswer", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

validateAnthropicJsonSchema(QUIZ_OUTPUT_SCHEMA);
assertNoBlockIdEnums(QUIZ_OUTPUT_SCHEMA, ["blockId"]);

/**
 * The answer budget, in tokens.
 *
 * Twenty questions, each carrying a question, one or two sentences of
 * reference answer and up to three verbatim quotes — call it 400 tokens apiece
 * with the JSON around it, and then room to be wrong about that. (Twelve at the
 * old length measured about 5–9k output tokens, 2026-09-30.)
 * Undersizing does not degrade: it throws `truncationFailure` and loses the
 * whole pass, so this sits well clear rather than close.
 */
export const ANSWER_TOKENS = 14_000;

/**
 * **The whole allowance: the answer plus the shared thinking room**, exported
 * so tests/jobs-lease-budget.test.ts can hold it inside one job claim.
 *
 * It was 14k + 64k for an hour on 2026-09-30, after a long paper (*A landscape
 * of consciousness*) spent 48,896 of 54k — the path prompt plans before it
 * writes. GPT Sol's D1 showed the extra was unusable: a call that fills 78k
 * streams for about 1,027 s and the job claim ends at 740 s, so the job would
 * be killed and the paid call lost anyway. At 54k the ceiling is ~711 s and
 * fits. **The honest limit is time, not tokens**: a paper that needs more
 * thinking than this needs a smaller job, not a bigger number here.
 * docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md.
 */
export const QUIZ_MAX_TOKENS = budgetFor("quiz", ANSWER_TOKENS);

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
  /** Which capable model writes it — the article's High-powered AI setting (plan 260930f). */
  power: ModelPower;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts — or
   * `null`. Frozen on the job when it was posted; see the header.
   */
  profile?: string | null;
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
  const maxTokens = QUIZ_MAX_TOKENS;

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "quiz",
      withMessagesJsonSchema({
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
          ...(opts.profile ? [{ type: "text" as const, text: QUIZ_READER_RULES }] : []),
        ],
        messages: [{ role: "user", content: renderPrompt({ tree, profile: opts.profile ?? null }) }],
      }, QUIZ_OUTPUT_SCHEMA),
      { power: opts.power, ...(opts.signal ? { signal: opts.signal } : {}) },
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
    throw stageFailure(MODEL_REFUSED, {
      authored: "the model answered with stop_reason: refusal",
    });
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
  const quiz: Quiz = {
    ...buildQuiz(parseJson(raw), {
      power: opts.power,
      slug: opts.article.slug,
      blocks,
      sourceHash,
      elapsedMs: Date.now() - started,
      dropped,
    }),
    /* Recorded for the badge, never compared by the step — see the header. */
    profileHash: opts.profile ? hashProfile(opts.profile) : null,
  };

  /* **The file is written by the caller, not here** — the shape `sketch`,
     `ideas`, `quotes` and `timeline` already have. A generator that also writes
     works on a laptop and cannot work through a store that puts the artefact in
     a Postgres column. */
  return {
    quiz,
    blocks: blocks.length,
    words,
    dropped,
    model: generatorFor(opts.power),
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    elapsedMs: Date.now() - started,
  };
}

/**
 * **What an old client tab needs to read a new quiz.** Kept until there is
 * an enforceable client-version boundary: a tab can stay open for longer than
 * any date we might pick, and the fields cost one spread (GPT Sol's R2-3).
 *
 * A browser tab opened before `quiz/5` still runs the band ladder, which reads
 * `question.band` on every Next and throws on a question that has none. So the
 * GET route adds `band: "easy", value: 3` to any question without them. An old
 * ladder given an all-easy batch walks it front to back — which is the path.
 *
 * **In the response only, never the artefact.** Writing made-up bands into
 * the store would leave a fake judgement behind in every quiz for ever; this
 * is one spread per request, and deleting it later needs no migration.
 * GPT Sol's F2 on docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md.
 */
export function withOldClientBands<R extends { quiz: Quiz }>(response: R): R {
  return {
    ...response,
    quiz: {
      ...response.quiz,
      questions: response.quiz.questions.map((q) => ({ band: "easy", value: 3, ...q })),
    },
  };
}
