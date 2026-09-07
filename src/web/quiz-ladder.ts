/**
 * The adaptive quiz ladder — which question to ask next.
 *
 * Get one right and the next is harder; get one wrong and the next is easier.
 * Greg chose this on 2026-09-06 in place of the difficulty slider he had asked
 * for, and the reason it is better is that it is *not a control*: the reader
 * never learns what `band` or `value` mean, and never tunes anything.
 * docs/plans/260907d-make-the-quiz-adaptive.md.
 *
 * ## This file does not sort, and that is the whole of its relationship to the
 * invariant
 *
 * `QuizPanel` has always said that a panel which sorted would be *"a second
 * opinion about the same list, and two lists drift"*. An adaptive walk plainly
 * changes the order the reader meets the questions in, so pretending selection
 * is not ordering would be sophistry — a cross-family review said exactly that
 * about the first draft of the plan, and it was right. The invariant is
 * **amended** rather than reinterpreted:
 *
 * > The server remains the sole authority for the static ranking. Adaptive
 * > traversal may change the cross-band encounter order, but it must preserve
 * > the server's relative order **within** every band, and the client must
 * > never sort.
 *
 * That is what `firstUnseenInBand` below does and all it does: a scan of the
 * server's array, front to back, for the first question in a band that has not
 * been seen. Because `orderQuestions` has already sorted band → value desc →
 * document position, "the first unseen `hard`" *is* "the highest-value,
 * earliest unseen `hard`" — for free, with no comparator here. There is exactly
 * one opinion about which `hard` question is the best one, and it lives in
 * src/quiz.ts.
 *
 * **No `.sort()` may ever appear in this file.** If one does, the thing the
 * invariant forbids has happened.
 *
 * ## No rung
 *
 * There is deliberately no "current difficulty" state anywhere. The target is
 * computed from the band of the question **actually being answered**, so a
 * hidden rung and the question on screen cannot drift apart, and a reader who
 * picks a question by hand out of *Show all twelve* needs no special case.
 *
 * ## Absence is an outcome, not an error
 *
 * `undefined` for a verdict is normal and frequent: the classifier failed or
 * timed out, the mark never finished, the reader skipped the question, their
 * attempt failed, or they edited the answer the mark was about. It holds the
 * band. Every failure in this feature is therefore quiet — the worst a broken
 * classifier can do is offer another question at the same level.
 */
import type { QuizBand, QuizQuestion, QuizQuestionId, QuizVerdict } from "../types.js";

/**
 * **Why this file sits in `src/web/` and not beside `src/quiz.ts`.**
 *
 * `tests/client-imports.test.ts` refuses any import from `src/web/` out into
 * `src/`, because *"one `import type` away from a node module is one careless
 * edit away from a broken browser bundle"* — and its header is explicit that
 * the fix when it fails is **never** to add the offender to the allowlist, but
 * to move the shared thing into a module that imports nothing.
 *
 * Nothing on the server walks the ladder: the server ranks the batch once, and
 * the walk is entirely the reader's side of it. The one thing both sides speak
 * is `QuizVerdict`, so that lives in `src/types.ts` with the other shared
 * shapes and this file is plain client code. The first cut of this work put the
 * ladder in `src/` and the allowlist test caught it.
 */

/**
 * Which bands to try, in order, given the band just answered and how it went.
 *
 * **Total on purpose.** Every row names all three bands, so the search always
 * terminates with an answer while any question is unseen — there is no "and
 * then anything" case to get wrong, and no undefined behaviour to discover in
 * production. The shape is *target first, then continue in the verdict's
 * direction, then reverse*, bounded at both ends: `right` at `hard` and `wrong`
 * at `easy` stay where they are, because inventing a fourth rung is a feature
 * nobody asked for.
 *
 * A table rather than arithmetic over an ordered enum: nine cells that can be
 * read and tested one at a time beat a clever `clamp(index ± 1)` whose edges
 * have to be reasoned about.
 */
const SEARCH: Record<"right" | "wrong" | "none", Record<QuizBand, readonly QuizBand[]>> = {
  right: {
    easy: ["medium", "hard", "easy"],
    medium: ["hard", "medium", "easy"],
    hard: ["hard", "medium", "easy"],
  },
  wrong: {
    easy: ["easy", "medium", "hard"],
    medium: ["easy", "medium", "hard"],
    hard: ["medium", "easy", "hard"],
  },
  none: {
    easy: ["easy", "medium", "hard"],
    medium: ["medium", "easy", "hard"],
    hard: ["hard", "medium", "easy"],
  },
};

/**
 * The first question in `band` that nobody has seen yet, in **the server's
 * order**.
 *
 * The one place this module touches the array, and it reads it front to back
 * without reordering anything. See the header.
 */
function firstUnseenInBand(
  questions: readonly QuizQuestion[],
  seen: ReadonlySet<QuizQuestionId>,
  band: QuizBand,
): QuizQuestion | undefined {
  return questions.find((q) => q.band === band && !seen.has(q.id));
}

/**
 * **Which question to ask next.**
 *
 * `from` is the question the reader is leaving — its *band* is the rung, which
 * is why no rung is stored — and `verdict` is how their answer to it was
 * judged, or `undefined` if it was not judged at all.
 *
 * Returns `undefined` only when every question has been seen, which is the
 * panel's cue to disable Next. There is no wrap-around: a reader who has
 * answered all twelve is finished, and handing them question one again would be
 * the quiz pretending to have more to say.
 *
 * **Exhaustion is not adaptation.** A struggling reader who uses up every
 * `easy` and `medium` question will eventually be handed a `hard` one, because
 * the alternative is ending their quiz — which this feature refuses to do, on
 * the grounds that ending someone's quiz because they are getting things wrong
 * is a verdict about the reader delivered by a machine. The plan says so out
 * loud rather than calling the last question successful adaptation.
 */
export function nextQuestion(
  questions: readonly QuizQuestion[],
  seenIds: readonly QuizQuestionId[],
  from: QuizBand,
  verdict: QuizVerdict | undefined,
): QuizQuestion | undefined {
  const seen = new Set(seenIds);
  for (const band of SEARCH[verdict ?? "none"][from]) {
    const found = firstUnseenInBand(questions, seen, band);
    if (found) return found;
  }
  return undefined;
}

/**
 * Where the quiz opens: the front of the server's array.
 *
 * **Not "the easiest question"**, though it usually is one. That claim was in
 * the plan's first draft and is false: `missingBandEnds` exempts any batch
 * below `SPREAD_FROM` from the spread rule, so a three-question article may
 * contain no `easy` question at all. What is true is that `orderQuestions` puts
 * the highest-value question of the lowest band present at the front, which is
 * the right place to start either way.
 *
 * Deterministic rather than "an easy one at random": two readings of the same
 * article should open the same way, and the worked trace in the plan needs to
 * be reproducible.
 */
export function firstQuestion(
  questions: readonly QuizQuestion[],
): QuizQuestion | undefined {
  return questions[0];
}
