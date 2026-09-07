/**
 * **Did the reader get it right?** — asked in private, so the ladder can move.
 *
 * The adaptive quiz needs to know whether an answer was right. The quiz
 * deliberately refuses to tell the *reader* that: docs/project/quiz.md § What a
 * mark says, and what it may not — *"No score, no grade, no fraction, no 'mostly
 * right'. The reply confirms claims and points at passages; it never says how
 * the reader did."* `gradeWords` in src/quiz-mark.ts counts the grading
 * vocabulary on every real mark precisely to watch that rule leak.
 *
 * So the judgement is made **somewhere else, by a different call, out of the
 * reader's sight**, and this file is that somewhere else.
 *
 * ## Why it reads the mark rather than the article
 *
 * The obvious design was to make `QUIZ_MARK_SYSTEM` emit a hidden verdict of
 * its own — one call instead of two. A cross-family review talked me out of it
 * and the reasoning is worth keeping:
 *
 * > a slightly worse mark is visible on every answer. A missed adaptive move is
 * > invisible and comparatively harmless. The risk budget should favor the
 * > prose.
 *
 * That prompt spends two pages separating confirmation from grading. Asking the
 * same generation to decide a verdict *first* makes grading its opening framing
 * task, and "now write the prose as though you hadn't" does not undo the
 * conditioning. Worse, it would be unfalsifiable: quiz.md records two runs of an
 * *identical* prompt scoring 0 and 3 on `gradeWords`, so eight eval cases could
 * never prove the tone had survived.
 *
 * Reading the finished mark instead costs a second call and buys three things:
 * `QUIZ_MARK_SYSTEM` is untouched, the visible stream is byte-for-byte what it
 * was, and **the article is never sent** — the mark has already done the work of
 * comparing the answer against the piece, with citations, so this is a short
 * reading-comprehension task over three short texts. That is why it is quick
 * tier.
 *
 * ## It never throws, and absence is a designed outcome
 *
 * Every failure — a refusal, a timeout, an unparseable answer, an ill-posed
 * question the model declines to call — returns `undefined`, which
 * src/quiz-ladder.ts treats as *hold the band*. So the worst thing a broken
 * classifier can do to a reader is offer them another question at the same
 * level. Nothing goes red, nothing is retried, and the mark they are reading is
 * entirely unaffected: this call happens after the marking stream is complete.
 *
 * **Nothing here is logged or stored.** A per-answer right/wrong on a log line
 * is a stored grade wearing a different hat, and docs/project/privacy.md makes a
 * public promise about it. The one thing that reaches the log is that the call
 * happened, via the gateway's own meter, which is how it gets paid for.
 */
import { openRouterJson } from "./ai-call.js";
import { modelFor } from "./models.js";
import type { QuizVerdict } from "./types.js";

/**
 * The ceiling, and it is this low on purpose: the answer is one word. A model
 * that starts explaining itself is a model that has misunderstood the task, and
 * cutting it off costs nothing — an unparseable answer is `undefined`, which is
 * a case this design already handles well.
 */
const VERDICT_MAX_TOKENS = 8;

/**
 * How long the reader's tick may wait on this.
 *
 * The mark itself is already finished and on screen when this runs, so what
 * this deadline delays is the `done` frame — the answered tick, not a word of
 * what the reader is reading. Short, because a verdict that arrives after the
 * reader has pressed Next is worth nothing, and holding `done` is the one way
 * this feature could make the quiz feel slower than it was.
 */
const VERDICT_TIMEOUT_MS = 8_000;

/**
 * **One word, and it is not shown to anybody.**
 *
 * `unclear` is a real answer rather than a failure: a question the article does
 * not settle should not be graded either way, and the eval's `illPosed` case is
 * exactly that. It maps to `undefined` like every other non-answer, so the
 * caller has one absence to handle rather than two.
 */
const VERDICT_SYSTEM = `You are reading a short exchange about an article: a question, what a reader
wrote from memory, and the feedback they were given.

Decide one thing only: did the reader's answer get the question right?

Answer with EXACTLY ONE WORD, lowercase, and nothing else:

right    — the reader answered the question. Wording unlike the feedback's is
           still right, and so is reaching the point by another route or from a
           different passage. A partial answer is right when what is missing
           does not change whether the question was answered.
wrong    — the reader contradicted the piece, or missed something that does
           change whether the question was answered, or did not attempt it.
unclear  — you cannot tell, or the question is not settled by the article, or
           the feedback itself says the question asks for more than the piece
           establishes.

The feedback you are given is deliberately written NOT to say how the reader
did — it confirms what holds and points at passages. Do not expect a verdict in
it; work out yourself what it implies. If the feedback defends the reader
against a wrong draft answer, the reader was RIGHT.`;

/**
 * Turn whatever came back into a verdict, or into nothing.
 *
 * Deliberately strict about the shape and forgiving about the trimmings: a
 * model that answers `"Right."` meant `right`, and a model that answers with a
 * paragraph has not done the task and gets `undefined`. Anything unrecognised
 * is absence, never a guess — a wrong guess mis-pitches the next question,
 * where absence merely holds the band.
 */
export function parseVerdict(raw: unknown): QuizVerdict | undefined {
  if (typeof raw !== "string") return undefined;
  const word = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (word === "right") return "right";
  if (word === "wrong") return "wrong";
  /* `unclear`, an empty answer, a refusal, or prose — all the same outcome. */
  return undefined;
}

export interface VerdictRequest {
  question: string;
  /** What the reader wrote. Never logged, never stored — as everywhere else. */
  answer: string;
  /** The mark they were just shown, complete. */
  mark: string;
  /** The reader navigating away takes this with it, as it does the mark. */
  signal?: AbortSignal | undefined;
}

/**
 * Ask, and never make a fuss about it.
 *
 * Resolves to `undefined` on every failure path rather than rejecting, so no
 * caller has to remember that a broken verdict must not break a mark. That
 * guarantee is the point of the function, and tests/quiz-verdict.test.ts is
 * mostly about it.
 */
export async function classifyVerdict(
  req: VerdictRequest,
): Promise<QuizVerdict | undefined> {
  /* Nothing to judge. Skipped before the meter, so an empty answer is not a
     call that cost money to learn nothing. */
  if (!req.answer.trim() || !req.mark.trim()) return undefined;

  const deadline = AbortSignal.timeout(VERDICT_TIMEOUT_MS);
  const signal = req.signal
    ? AbortSignal.any([req.signal, deadline])
    : deadline;

  try {
    const call = await openRouterJson(
      "quiz-verdict",
      {
        model: modelFor("quiz-verdict"),
        max_tokens: VERDICT_MAX_TOKENS,
        messages: [
          { role: "system", content: VERDICT_SYSTEM },
          {
            /* The reader's own words last, as `markAnswerStream` orders them,
               so the thing being judged is the last thing read. */
            role: "user",
            content:
              `THE QUESTION\n\n${req.question}\n\n` +
              `THE FEEDBACK THEY WERE GIVEN\n\n${req.mark}\n\n` +
              `THE READER'S ANSWER\n\n"""\n${req.answer}\n"""\n\n` +
              `One word: right, wrong, or unclear.`,
          },
        ],
      },
      { signal },
    );

    const body = call.json as
      | { choices?: { message?: { content?: unknown } }[] }
      | null;
    return parseVerdict(body?.choices?.[0]?.message?.content);
  } catch {
    /* **Swallowed on purpose, and not logged.** A refusal, a timeout, the
       reader navigating away — all of them mean the same thing to the ladder,
       and none of them is worth a line in a log that would then have to be
       scrubbed of what it was judging. The gateway has already metered the
       attempt, which is the part that has to survive. */
    return undefined;
  }
}
