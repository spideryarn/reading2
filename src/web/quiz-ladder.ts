/**
 * **The premise rule** — whether a step on the quiz's path is shown with the
 * thread it leans on, or asked on its own.
 *
 * Since `quiz/5` the quiz is a path, not a pool: the model sets the questions
 * in the order they build on one another, towards the two to four takeaways
 * that matter, and the reader walks that order front to back. **The path never
 * reorders.** What adapts is how much help a step carries. A question may have
 * a `premise` — one sentence restating the answer to the step immediately
 * before it — and it is shown unless the reader has just shown they have it:
 * they came here with Next, from that step, and it was judged right. Get a step
 * right and the next asks you to carry the thread yourself; get it wrong, skip
 * it, jump in from the list or step back with Previous, and the step hands you
 * the thread first.
 *
 * That keeps Greg's decision of 2026-09-06 — the quiz adapts to the reader and
 * the reader has no control to tune — which until 2026-09-30 was kept by a
 * band ladder in this file: right stepped up a band, wrong stepped down, over a
 * pool the server had sorted easy → hard
 * (docs/plans/260907d-make-the-quiz-adaptive.md for what it was and why). A
 * sequence whose questions lean on one another cannot be hopped across by
 * band, so the ladder went and this rule replaced it, which is adaptivity as
 * scaffolding rather than as a difficulty dial. GPT Sol's F1 on
 * docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md
 * proposed it. Nothing on screen names a level, as before.
 *
 * ## This file does not sort
 *
 * The order is the artefact's and it is the path. `QuizPanel` has always said
 * that a panel which sorted would be *"a second opinion about the same list,
 * and two lists drift"*, and on a path it would be worse than that: step 6
 * would be asked before the step 5 it leans on. **No `.sort()` may ever appear
 * in this file.** If one does, the thing the path forbids has happened.
 *
 * ## Absence is an outcome, not an error
 *
 * `undefined` for a verdict is normal and frequent: the classifier failed or
 * timed out, the mark never finished, the reader skipped the question, or
 * their attempt failed. Every one of those **shows** the premise, and so does
 * every way of arriving that is not Next. So every failure in this feature is
 * quiet and errs towards help — the worst a broken classifier can do is hand
 * the reader a thread they already had.
 */
import type { QuizQuestion, QuizVerdict } from "../types.js";

/**
 * **Why this file sits in `src/web/` and not beside `src/quiz.ts`.**
 *
 * `tests/client-imports.test.ts` refuses any import from `src/web/` out into
 * `src/`, because *"one `import type` away from a node module is one careless
 * edit away from a broken browser bundle"* — and its header is explicit that
 * the fix when it fails is **never** to add the offender to the allowlist, but
 * to move the shared thing into a module that imports nothing.
 *
 * Nothing on the server decides what a reader is shown: the server writes the
 * path once, and the walk is entirely the reader's side of it. The one thing
 * both sides speak is `QuizVerdict`, so that lives in `src/types.ts` with the
 * other shared shapes and this file is plain client code.
 */

/**
 * **Whether the question on screen is shown with its premise.**
 *
 * `false` if it has none. Otherwise shown, **unless** the reader came here
 * with Next from the step immediately before, and that step's latest verdict
 * this session is `right` — the one piece of evidence the session has that
 * they are holding the thread this premise restates. Everything else shows it:
 *
 * - **`arrivedByNext` false** — a pick from the list, a step back with
 *   Previous, the opening question, a new batch. A `right` on the step before,
 *   given some time ago and followed by a detour, is not the reader carrying
 *   that thread *here*. GPT Sol's R2-1 on the plan: keyed on the verdict
 *   alone, a reader who answered step 4 right, wandered off to step 9 and came
 *   back to step 5 from the list would be asked step 5 bare.
 * - **`batchHasGaps`** — validation dropped a question in the middle of the
 *   path (`QuizDropped.gaps`), so for some step the "step before" on screen is
 *   not the one its premise restates, and a verdict on it proves nothing. The
 *   premise is then the only bridge across the hole, and it is always shown.
 *   Batch-wide rather than per-step, because the artefact counts gaps and does
 *   not say where they are; showing a premise a reader did not need costs a
 *   sentence, and hiding one they did costs the step.
 *
 * Keying on the step *before*, and only that one, is right because the
 * prompt asks every premise to restate only the immediately preceding
 * question's answer. If that ever loosens, this rule is what has to change.
 *
 * **Stateless on purpose**: it reads what it is given and nothing else, so
 * there is no "current help level" anywhere to drift from the question on
 * screen. The panel owns remembering how the reader arrived and what the
 * verdicts were.
 */
export function showPremise({
  question,
  previousVerdict,
  arrivedByNext,
  batchHasGaps,
}: {
  question: QuizQuestion;
  /** The latest verdict this session on the question before this one on the path. */
  previousVerdict: QuizVerdict | undefined;
  /** The reader reached this question by pressing Next on the one before it. */
  arrivedByNext: boolean;
  /** `quiz.dropped.gaps > 0`. */
  batchHasGaps: boolean;
}): boolean {
  if (!question.premise) return false;
  if (batchHasGaps) return true;
  return !(arrivedByNext && previousVerdict === "right");
}
