/**
 * How big one model response is allowed to be — and why that is a function of
 * the article rather than a constant.
 *
 * Three stages (toc, arc, tweets) each make one streamed call and each has to
 * pass a `max_tokens`. All three used to pass a number somebody had typed once:
 * 32,000 for the tree, 16,000 for the other two. On 2026-08-25 the first stage
 * met an article long enough to blow through its number and the ingest failed
 * with "Hit max_tokens — the JSON is truncated. Raise it and retry." Retrying
 * made the identical call and failed identically. See
 * docs/postmortems/toc-max-tokens.md.
 *
 * **`max_tokens` is not an output cap. It is an output-plus-reasoning cap.**
 * That is the whole reason a typed-in number is the wrong shape of answer. On
 * every model this app can use (src/models.ts) the thinking tokens come out of
 * the same allowance as the answer, `budget_tokens` no longer exists, and the
 * depth of thinking is steered only by `output_config.effort`. So the budget
 * has to be written as what it actually is: room for the answer, plus room for
 * the thinking that precedes it.
 *
 * Both terms grow with the article, and they grow differently:
 *
 * - The **answer** grows in a way each stage knows exactly. Stage 4 writes one
 *   nav label per gistable block, so its answer is linear in block count; the
 *   arc writes one sentence per part; a thread is a fixed handful of posts.
 *   Each stage estimates its own, because only it knows the shape of its JSON.
 * - The **thinking** grows with the input, and we do not get to say by how
 *   much. That is what `THINKING_HEADROOM` is: not a promise, a reservation.
 *
 * See docs/project/table-of-contents.md#the-budget.
 */
import { stageFailure } from "./job-failure.js";
import type { FailureKind } from "./messages.js";

/**
 * The ceiling on a single streamed response.
 *
 * 128,000 is what the Claude 5 family allows, which is what src/models.ts
 * currently names — **it is a property of that choice, not of this file.** A
 * move down to Haiku or an older model would make this number a lie, and a lie
 * in the safe direction is not on offer: `budgetFor` would hand back a
 * `max_tokens` the API rejects, or worse, accepts and truncates. Anything that
 * edits src/models.ts should look here.
 *
 * Streaming is what makes a number this large usable at all — the SDK refuses
 * large `max_tokens` on a non-streaming request, because the HTTP timeout will
 * beat the model to the end. All three stages already stream.
 */
export const MODEL_MAX_TOKENS = 128_000;

/**
 * Room reserved for the model's own reasoning, on top of whatever the answer
 * needs.
 *
 * **40,000 has a source, and a caveat that matters more than the number.**
 *
 * The run that started all this had 48,107 tokens of article in front of it,
 * `effort: "high"`, and a 32,000-token allowance. It hit the cap having emitted
 * about 20,000 characters of JSON — five or six thousand tokens of answer — so
 * roughly 26,000 tokens had gone on thinking. 40,000 is that with half again
 * on top.
 *
 * Then the same article was run again at 77,100, and **failed again**: 40,000
 * characters of answer this time, about 13,000 tokens, leaving some 64,000 of
 * thinking. The reservation had not been too small. Adaptive thinking at
 * `effort: "high"` had simply expanded to fill the new room.
 *
 * So the caveat: **this constant cannot rescue a call on its own.** It is the
 * slack that stops a well-behaved call from failing at the margin, and it is
 * not a leash. The leash is `effort`, which each stage sets for itself — see
 * `EFFORT` in src/toc.ts and in src/labels.ts. If this stops being enough
 * again, the answer is almost certainly a lower effort rather than a bigger
 * number here.
 *
 * The sentence there before named a stage and the value it had, and by
 * 2026-08-30 the value had changed and the sentence had not. Two agents read it
 * as fact and neither checked, because a comment stating a fact is not
 * something you go and verify. Point at where a setting lives; do not copy what
 * it currently is — AGENTS.md § How we write docs here.
 *
 * It does not scale with the input, which is a deliberate simplification: two
 * measurements at one article length are not enough to fit a line to. A flat
 * reservation that is too generous costs nothing — `max_tokens` is a ceiling,
 * not a purchase, and unused allowance is not billed.
 *
 * **This is the reservation for a call that reads the whole article**, which is
 * what all three stages did when it was measured. A call that reads one section
 * and writes a dozen labels does not need it and should pass its own, smaller
 * figure to `budgetFor` — see `LABEL_HEADROOM` in src/labels.ts. Inheriting
 * 40,000 onto every small batch would be the wrong lesson from this number.
 */
export const THINKING_HEADROOM = 40_000;

/**
 * Thrown *before* the call when the answer cannot fit in one response at all.
 *
 * A separate class because the two failures want different words in front of a
 * reader: this one says the article is too long for the way the stage is
 * built, and no retry will change that. Hitting `max_tokens` mid-answer says
 * the estimate below was wrong, which is a different problem with a different
 * fix.
 */
export class TooLongForOnePass extends Error {
  /**
   * `blocked`, so the job card does not offer a Retry that cannot work.
   *
   * This is the failure docs/postmortems/toc-max-tokens.md was written about:
   * the button was there, Greg pressed it, and it made the identical call.
   * Nothing about the second attempt is different — the block count comes off a
   * `blocks.json` that a completed step already wrote, and Retry never re-runs a
   * step that finished — so the arithmetic lands in exactly the same place.
   *
   * `blocked` rather than a fifth kind of its own, and the reason is that
   * `FailureKind` is a list of things a *reader* can do next: this is a request
   * that cannot pass a size boundary, which is the same next step as a provider
   * refusing an over-long prompt. See src/job-failure.ts.
   */
  readonly failureKind: FailureKind = "blocked";

  constructor(
    readonly stage: string,
    readonly answerTokens: number,
  ) {
    super(
      `The ${stage} needs about ${answerTokens.toLocaleString()} tokens for this article, and one ` +
        `model response holds ${MODEL_MAX_TOKENS.toLocaleString()} including the model's own ` +
        `reasoning. This article has to be processed in sections, which is not built yet — see ` +
        `docs/project/table-of-contents.md#long-articles.`,
    );
    this.name = "TooLongForOnePass";
  }
}

/**
 * The `max_tokens` for one call, given what the stage thinks its answer costs.
 *
 * **It throws rather than clamping when the answer will not fit.** Clamping to
 * the ceiling would be the friendlier-looking choice and it is the wrong one:
 * the call would run for several minutes, cost real money, and come back
 * truncated — the exact failure this function exists to prevent, arrived at
 * more slowly. Refusing up front costs nothing and says something true.
 *
 * The floor matters as much as the ceiling. A short article's answer might be
 * 300 tokens, and 300 + headroom is still the right budget, because the
 * headroom is the part that was never about the answer.
 */
export function budgetFor(
  stage: string,
  answerTokens: number,
  headroom: number = THINKING_HEADROOM,
): number {
  if (!Number.isFinite(answerTokens) || answerTokens < 0) {
    throw new Error(`${stage}: answerTokens must be a non-negative number, got ${answerTokens}`);
  }
  if (!Number.isFinite(headroom) || headroom < 0) {
    throw new Error(`${stage}: headroom must be a non-negative number, got ${headroom}`);
  }
  const wanted = Math.ceil(answerTokens) + Math.ceil(headroom);
  if (wanted > MODEL_MAX_TOKENS) throw new TooLongForOnePass(stage, Math.ceil(answerTokens));
  return wanted;
}

/**
 * What to say when a call comes back with `stop_reason: "max_tokens"`.
 *
 * The old message — "Hit max_tokens — the JSON is truncated. Raise it and
 * retry." — was an instruction to a programmer, printed next to a Retry button
 * for a reader, and following it did nothing: Retry re-ran the same call with
 * the same number. This one is addressed to whoever is looking at it, and it
 * carries the two figures that let the constants above be re-tuned.
 */
export function truncatedMessage(
  stage: string,
  maxTokens: number,
  answerTokens: number,
  spent: { outputTokens: number; answerChars: number },
  headroom: number = THINKING_HEADROOM,
): string {
  /* The subtraction is done here rather than left to the reader, because doing
     it by hand is what took two runs to work out the first time. `output_tokens`
     counts the thinking and the visible answer together — the API does not
     separate them — so the visible half is estimated from the characters that
     actually arrived, at the ~3 characters per token that JSON full of block ids
     costs. Approximate, and it does not need to be better than that: the
     question it answers is "which half ran away", and the two halves differ by
     a factor, not by a rounding. */
  const answerSpent = Math.round(spent.answerChars / 3);
  const thinkingSpent = Math.max(0, spent.outputTokens - answerSpent);
  return (
    `The ${stage} ran past its ${maxTokens.toLocaleString()}-token budget and came back ` +
    `unfinished. It was sized for an answer of about ${answerTokens.toLocaleString()} tokens plus ` +
    `${headroom.toLocaleString()} for reasoning. What it actually spent: about ` +
    `${answerSpent.toLocaleString()} tokens of answer and ${thinkingSpent.toLocaleString()} of ` +
    `reasoning. Whichever of those two overran is the one to change — see src/token-budget.ts. ` +
    `Retrying is unlikely to come out differently until it does.`
  );
}

/**
 * The same thing as a failure the job card can classify: **`bug`**.
 *
 * ## Why the wording softened
 *
 * This used to end *"Retrying will fail the same way until it does"*, which is
 * a proof rather than a reading of the evidence. `TooLongForOnePass` above
 * really is arithmetic — the same block count gives the same estimate every
 * time — but this is not. The model's output varies between calls, and what we
 * have is two observations on one article
 * (docs/postmortems/toc-max-tokens.md). That is evidence, not a law.
 *
 * So the sentence now says *unlikely*, and the button is hidden. Those two have
 * to agree, and the honest way to make them agree is to soften the sentence
 * rather than to leave a Retry under a claim of certainty. Raised by GPT Sol.
 *
 * ## Why `bug` rather than `blocked`
 *
 * `blocked` is a request that cannot pass a boundary, and the reader's move is
 * to ask for less. Nobody asked for anything here — a stage sized its own call
 * wrongly. `bug` is the kind whose definition is *"a defect here. Retrying
 * cannot help, and someone should hear about it"*, and the fix is a constant in
 * this file, which the message already names.
 *
 * ## Why this returns the error rather than the string
 *
 * So that `throw new Error(truncationFailure(…))` does not compile. Every stage
 * that meets a truncation used to build its own `new Error` around the message,
 * and a sixth stage added tomorrow would have copied that line — which is how
 * the tag goes missing from exactly one of six places and nothing says so. The
 * type is the guard, rather than a test that has to remember to look.
 *
 * `truncatedMessage` stays exported for the one caller that needs the sentence
 * without the kind: `src/labels.ts` wraps it in a `BatchIncomplete`, which the
 * stage catches and retries itself. See the note at that throw site.
 */
export function truncationFailure(
  stage: string,
  maxTokens: number,
  answerTokens: number,
  spent: { outputTokens: number; answerChars: number },
  headroom: number = THINKING_HEADROOM,
): Error {
  return stageFailure(
    "bug",
    truncatedMessage(stage, maxTokens, answerTokens, spent, headroom),
  );
}
