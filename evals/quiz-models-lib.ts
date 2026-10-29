/**
 * **The quiz model comparison, the half that calls nothing** — the arms, the
 * smaller-questions prompt, the counters and the plan a dry run prints. The
 * runner is evals/quiz-models.ts; this half is a module of its own so
 * tests/quiz-models-eval.test.ts can hold it without an API key.
 *
 * Greg, 2026-10-29 (spya-jzgrua): *"Also, it seems quite expensive. Can we
 * experiment with evals with Haiku or Sonnet to see if they're good enough for
 * the quiz mode? … one hunch I have is more often but easier and smaller
 * quizzes."* Plan 261029i § Stage 4.
 */
import { QUIZ_SYSTEM, type QuizRun } from "../src/quiz.js";
import { modelFor } from "../src/models.js";
import type { Block } from "../src/types.js";

/** Haiku 5.5, in OpenRouter's spelling — the one both wires take. */
export const HAIKU = "anthropic/claude-haiku-5.5";

/** What writes and marks a quiz today, at standard power (Sonnet 5.5). */
export const CURRENT_WRITER = modelFor("quiz", "standard");
export const CURRENT_MARKER = modelFor("quiz-mark", "standard");

export type PromptArm = "current" | "smaller";

export interface WriteArm {
  readonly name: string;
  readonly model: string;
  readonly prompt: PromptArm;
}

/** The incumbent is first: every blind pair is it against one other arm. */
export const WRITE_ARMS: readonly WriteArm[] = [
  { name: "sonnet-current", model: CURRENT_WRITER, prompt: "current" },
  { name: "haiku-current", model: HAIKU, prompt: "current" },
  { name: "sonnet-smaller", model: CURRENT_WRITER, prompt: "smaller" },
  { name: "haiku-smaller", model: HAIKU, prompt: "smaller" },
];

export interface MarkArm {
  readonly name: string;
  readonly model: string;
}

export const MARK_ARMS: readonly MarkArm[] = [
  { name: "sonnet", model: CURRENT_MARKER },
  { name: "haiku", model: HAIKU },
];

/**
 * The committed corpus articles a batch is written for. The marking cases are
 * written against the first and only make sense there (evals/quiz-cases.ts).
 */
export const ARTICLES = ["noema-mythology-of-conscious-ai", "openai-huggingface"] as const;

/** Each arm is run this many times: two runs of one prompt can differ as much as two prompts (quiz.md). */
export const RUNS = 3;

/**
 * **The smaller-questions prompt: `QUIZ_SYSTEM` with three passages replaced.**
 *
 * Each replacement names the exact text it replaces and throws if that text is
 * gone, so an edit to the real prompt makes this arm refuse to run rather than
 * quietly become the current prompt under another name (silent-success.md).
 * The cap goes up with them, to `SMALLER_MAX_QUESTIONS`, in all three places
 * a cap lives: this prompt's HOW MANY, the request's "up to", and the
 * validator, which would otherwise keep the first twenty and drop the rest
 * (GPT Sol's plan review, F6). "More often" is then measured, by
 * `blocksBetween` below.
 */
export const SMALLER_MAX_QUESTIONS = 30;

export const SMALLER_REPLACEMENTS: readonly { readonly from: string; readonly to: string }[] = [
  {
    from: `Up to twenty. Fewer where the article does not support twenty`,
    to: `Up to ${SMALLER_MAX_QUESTIONS}. Fewer where the article does not support ${SMALLER_MAX_QUESTIONS}`,
  },
  {
    from: `- It can be answered in ONE OR TWO SENTENCES, without effort, by a reader who has
  been walked through the questions before it.`,
    to: `- It can be answered in A PHRASE OR ONE SHORT SENTENCE, without effort, by a
  reader who has been walked through the questions before it. Smaller and easier
  is better than thorough: a reader meets these while they read, and should be
  able to answer one in a few seconds.`,
  },
  {
    from: `- One or two sentences, WITH FULL STOPS.`,
    to: `- One short sentence, WITH A FULL STOP.`,
  },
  {
    from: `Cover the piece. The takeaways usually draw on all of it, so the path should
too; do not spend half the steps on its first third.`,
    to: `Cover the piece, and spread the questions evenly through it: a reader meets
each one soon after the passage it is about, so a long stretch with no question
is a long stretch with nothing to check. Do not spend half the steps on its first
third.`,
  },
];

export function smallerInstructions(base: string = QUIZ_SYSTEM): string {
  let out = base;
  for (const { from, to } of SMALLER_REPLACEMENTS) {
    const at = out.indexOf(from);
    if (at < 0 || out.indexOf(from, at + 1) >= 0) {
      throw new Error(
        `The smaller-questions arm could not find exactly one copy of a passage it replaces in QUIZ_SYSTEM: ${JSON.stringify(from.slice(0, 60))}…. The real prompt has changed; rewrite SMALLER_REPLACEMENTS against it.`,
      );
    }
    out = out.slice(0, at) + to + out.slice(at + from.length);
  }
  return out;
}

/** What `generateQuiz`'s `experiment` gets for one arm. */
export function experimentFor(arm: WriteArm): { model: string; instructions?: string; maxQuestions?: number } {
  return arm.prompt === "smaller"
    ? { model: arm.model, instructions: smallerInstructions(), maxQuestions: SMALLER_MAX_QUESTIONS }
    : { model: arm.model };
}

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** One batch, counted. Nothing here is a verdict: the read is. */
export interface BatchStats {
  questions: number;
  premised: number;
  dropped: number;
  gaps: number;
  questionWords: number;
  answerWords: number;
  /**
   * **How often a reader meets a question**: the mean number of body blocks
   * between one question's anchor (its last evidence block, where the margin
   * and the prose draw it) and the next, in document order. Lower is more often.
   */
  blocksBetween: number;
  /** The longest such stretch, so one bunched-up batch is not averaged away. */
  longestGap: number;
}

export function batchStats(run: Pick<QuizRun, "quiz" | "dropped">, blocks: readonly Block[]): BatchStats {
  const { questions } = run.quiz;
  const position = new Map(blocks.map((b, i) => [b.id, i]));
  const anchors = questions
    .map((q) => Math.max(...q.evidence.map((e) => position.get(e.blockId) ?? -1)))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  const gaps = anchors.slice(1).map((p, i) => p - (anchors[i] ?? p));
  const d = run.dropped;
  return {
    questions: questions.length,
    premised: questions.filter((q) => q.premise).length,
    dropped: d.unanchored + d.unknownIds + d.unquoted + d.malformed + d.duplicate + d.overCap,
    gaps: d.gaps ?? 0,
    questionWords: mean(questions.map((q) => words(q.question))),
    answerWords: mean(questions.map((q) => words(q.referenceAnswer))),
    blocksBetween: mean(gaps),
    longestGap: gaps.length ? Math.max(...gaps) : 0,
  };
}

/** One call the run will make. */
export interface PlannedCall {
  readonly half: "write" | "mark";
  readonly arm: string;
  readonly model: string;
  readonly article: string;
  readonly run: number;
  /** The marking case, for a mark. */
  readonly caseName?: string;
  /** Rough dollars, for the dry run's total. */
  readonly estimate: number;
}

/**
 * **What one call costs, roughly** — production's ledger for Sonnet 5.5
 * (plan 261029c: a quiz $0.17 median, $0.24 mean; a mark about $0.08), and half
 * that for Haiku, Haiku 4.5's ratio to Sonnet in src/pricing.ts (Haiku 5.5 is
 * not in the table yet). An estimate for deciding to run, not a measurement:
 * the run's own ledger rows are the measurement.
 */
const ESTIMATE = { write: 0.24, mark: 0.08 } as const;
const estimate = (half: "write" | "mark", model: string): number =>
  ESTIMATE[half] * (model === HAIKU ? 0.5 : 1);

export function plan(caseNames: readonly string[]): PlannedCall[] {
  const calls: PlannedCall[] = [];
  for (let run = 1; run <= RUNS; run++) {
    for (const article of ARTICLES)
      for (const arm of WRITE_ARMS)
        calls.push({ half: "write", arm: arm.name, model: arm.model, article, run, estimate: estimate("write", arm.model) });
    for (const arm of MARK_ARMS)
      for (const caseName of caseNames)
        calls.push({
          half: "mark",
          arm: arm.name,
          model: arm.model,
          article: ARTICLES[0],
          run,
          caseName,
          estimate: estimate("mark", arm.model),
        });
  }
  return calls;
}

/**
 * **Which of two arms is shown as A**, decided by a seed rather than a coin, so
 * a rerun of the report labels the same pairs the same way and the key file can
 * be checked against it. FNV-1a over the pair's name.
 */
export function incumbentIsA(pairName: string): boolean {
  let h = 0x811c9dc5;
  for (const ch of pairName) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2 === 0;
}
