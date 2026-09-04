/**
 * Whether a failed ingest job is worth another go.
 *
 * The Retry button on a job card was offered under every failure, including the
 * ones that are arithmetic. `TooLongForOnePass` (src/token-budget.ts) is the
 * clearest: the article needs more output tokens than one response holds, and
 * pressing Retry makes the identical call and fails identically. See
 * docs/postmortems/260826a-toc-max-tokens.md.
 *
 * ## Why a `FailureKind` and not a `permanent` flag
 *
 * A boolean is the wrong concept, not merely a coarse one. Configuration
 * changes, providers change their policies, and websites change what they
 * serve, so nothing here is permanent. The question a card actually has to
 * answer is narrower and answerable: **should this unchanged attempt be offered
 * again now?** That is what `FailureKind` in src/messages.ts already means, and
 * three of its four members answer no.
 *
 * ## Why a field and not a bracketed code
 *
 * Read `kindOfMessage` in src/messages.ts before adding anything here. The codes
 * exist because the surfaces that store a model failure store `err.message` and
 * have nowhere else to put a kind — a comment, a chat turn, a search run. A job
 * is a struct with room for a field, so it takes the field. A workaround should
 * not be inherited by the case that does not need it.
 *
 * The one place this still reads a code is `failureKindOf` below, and only as a
 * fallback for errors thrown by the model-call layer, which is the layer that
 * has nowhere else to put it.
 *
 * ## Which way to be wrong
 *
 * An unrecognised failure offers the retry. That is for **compatibility**, not
 * because a wasted click is cheap: every job recorded before this field existed
 * carries nothing, and so does a job the restart sweep marked (`sweepStopped`
 * in src/jobs.ts), which is genuinely retryable. Note the difference from the
 * same choice in src/messages.ts, where the cost of a false retry is one click
 * — here it is minutes of pipeline and another billed model call, which is a
 * good deal worse. So a stage that knows its failure cannot come out
 * differently should say so, with `stageFailure` below.
 *
 * ## Two strings, not one
 *
 * A step's failure has two audiences and they want different sentences, so
 * since 2026-09-03 it carries both. `Error.message` is the **diagnostic**: it
 * goes to the **log**, and it may carry arithmetic, a file reference and an
 * instruction addressed to whoever tunes a prompt. `readerFailure` is the
 * **reader's**, and it is what src/jobs.ts persists onto `step.error` and
 * `job.error`, which are what the band and the shelf card render.
 *
 * `readerFailureOf` below is the seam, and it is a seam rather than a
 * convention because the convention had already failed eight times — see
 * `stepGaveUp` in src/messages.ts for the count and for what was rejected.
 * "Developer-facing" still means **safe to log**: it is not somewhere to put a
 * provider's error body back, which can echo the article
 * (src/anthropic-call.ts, docs/project/logging.md).
 *
 * ## The log, and **not** Sentry — the cost of the split, paid knowingly
 *
 * Sentry is stricter than the log, on purpose: `authored` in
 * src/monitoring-scrub.ts forwards an `Error.message` only when it ends in a
 * registered bracketed code, because a code is the one proof available that we
 * wrote every word of it. A diagnostic has no code — it is free text a step
 * wrote — so **Sentry withholds it.**
 *
 * **The obvious remedy is the one that must not be taken**: appending a code to
 * every diagnostic so it looks authored. See `stageFailure` below for the six
 * hours that lived in the tree and what it let through.
 *
 * The remedy that *is* taken is `{ authored }` on `stageFailure` — a throw site
 * saying it wrote every character of a diagnostic, one word, greppable, and
 * refused to anything interpolating text from outside. So the split costs
 * nothing at the two places where the sentence was worth having:
 * `anthropicCallFailed` and the ten `MODEL_REFUSED` throw sites still reach
 * Sentry, and still carry the code that
 * [tests/stop-details.test.ts](../tests/stop-details.test.ts) reads off the
 * **log** line to tell a refusal apart from a stage that died before it ever
 * called a model.
 *
 * What genuinely does not reach Sentry is every diagnostic nobody has made that
 * claim about — a step's free text, which is most of them and is where a
 * provider body or a stretch of the article turns up. Those events still arrive
 * with the exception's name, its full stack, the `status` tag and a
 * `message_withheld` marker saying why the message is bare; what is gone is the
 * sentence. Several were already in that position: `TooLongForOnePass` has
 * never carried a code and has never reached Sentry.
 */
import {
  canRetry,
  codeOfMessage,
  type FailureKind,
  kindOfMessage,
  type ReaderFacingFailure,
  stepGaveUp,
} from "./messages.js";

/**
 * The four kinds, as a total map, so a fifth cannot be added without coming
 * here — the same discipline `RETRYABLE` in src/messages.ts follows and for the
 * same reason.
 *
 * It exists because a `failureKind` read off a thrown object is a value from
 * outside the type system: a JSON round-trip through `data/_jobs/`, or an error
 * built by a version of this code that knew a kind this one does not. Handing
 * that straight to `canRetry` would look it up in a `Record`, miss, and return
 * `undefined` — which is falsy, so an unrecognised kind would **hide** the
 * button. Exactly the wrong direction.
 */
const KNOWN_KINDS: Record<FailureKind, true> = {
  retry: true,
  ours: true,
  bug: true,
  blocked: true,
};

/**
 * An error that has said which kind of failure it is.
 *
 * Not exported: nothing outside this file should be reading the property. A
 * stage sets it with `stageFailure` and everything else asks `failureKindOf`,
 * which is what keeps the "an unrecognised kind offers the retry" rule in one
 * place instead of at each reader.
 */
interface KindedError {
  failureKind?: FailureKind;
  /**
   * **The sentence the reader gets**, when the throw site wrote them one.
   *
   * Separate from `Error.message`, which is the diagnostic: it goes to the log
   * — and to the log only, see § The log, and **not** Sentry above — and it is
   * free to carry arithmetic, a file reference and an instruction addressed to
   * whoever tunes a prompt. Nothing but `readerFailureOf` may read this, for
   * `failureKind`'s reason: the "nobody said, so fall back" rule belongs in one
   * place.
   */
  readerFailure?: ReaderFacingFailure;
}

/**
 * Throw this when a step's failure is one the pipeline has something to say
 * about — the kind it is, the sentence the reader gets, or both.
 *
 * One line at the throw site, and the reason it is a helper rather than an
 * `Object.assign` written out at each one is that it is greppable:
 * `stageFailure` finds every place in the pipeline that has made this claim,
 * which is the list anybody auditing it wants.
 *
 * ## The two forms, and which to use
 *
 * **`stageFailure(kind, { generic: detail })`** says only what kind of failure
 * it is. The reader gets `stepGaveUp`'s generic sentence for that kind
 * (src/messages.ts), naming the step and nothing else, and `detail` is the
 * diagnostic — log only, and see `{ generic }` below for what that word is
 * claiming.
 *
 * **`stageFailure(failure, detail?)`** says both, carrying a whole
 * `ReaderFacingFailure` — `kind` and reader sentence together, which is what
 * that type is for. Reach for this whenever the failure has something true and
 * useful to tell a reader; `detail` is what the log gets instead, and defaults
 * to the reader's own sentence when there is nothing more to say.
 *
 * Claiming a kind that is not `retry` is a claim about a **retry**, which is
 * narrower than a re-run: Retry skips every step that finished, so a stage that
 * failed over an artefact an earlier step already wrote will read the identical
 * artefact again. That is what makes a bad tree or a missing URL permanent and
 * a malformed model answer not.
 *
 * ## `{ authored }`, for a diagnostic the throw site wrote every character of
 *
 * A plain `detail` is free text and is treated as such: no code is added to it,
 * so `authored` in src/monitoring-scrub.ts withholds it from Sentry. That is
 * the right default, because most details are built from something that came
 * back over a wire.
 *
 * `{ authored }` is the throw site saying **I wrote every character of this and
 * none of it came from a provider, a document or a reader**. The code goes on,
 * and the sentence travels — to Sentry, and to a log line where the code is
 * what tells a refusal apart from a stage that died before it ever called a
 * model (tests/stop-details.test.ts makes exactly that distinction).
 *
 * It is a *claim*, deliberately, and one word at the throw site rather than a
 * flag threaded from somewhere else — so that grepping `authored:` returns
 * every place the claim has been made, which is the list an audit wants. What
 * it must never wrap is an interpolation of anything that arrived from
 * outside: `${err.message}`, a response body, a block of prose.
 *
 * ## `{ generic }`, for a throw site that means the reader to get the generic
 *
 * The two markers are parallel and each is a claim, made in one greppable word
 * at the throw site. `{ authored }` claims **I wrote every character of this,
 * so it is safe to send to Sentry**. `{ generic }` claims **I know the reader
 * gets a generic sentence here, and that is correct** — this is CLI misuse, a
 * broken invariant, a step run out of order, and there is nothing true and
 * useful to tell a reader beyond the name of the step that gave up.
 *
 * Until 2026-09-04 that form was `stageFailure(kind, detail)` — a bare second
 * string — and it read exactly like the other form, so **eight throw sites
 * wrote a real sentence for a reader and used the form that throws it away**.
 * The reported symptom was a 142-page PDF refused for its length telling the
 * reader only *"Extracting the article could not be done… [jb-step-no]"*; see
 * `stepGaveUp` in src/messages.ts and
 * docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md. Requiring
 * the word makes the ninth impossible to write by accident: the compiler
 * refuses the bare string, so whoever is writing the throw has to say which of
 * the two audiences they meant.
 *
 * **What this cannot catch, and it is not a small gap.** ⟨Sol⟩ It polices
 * `stageFailure` and nothing else. A bare `throw new Error("This PDF has 142
 * pages…")` intended for a reader still lands as the generic sentence, and no
 * type can tell that string from a diagnostic — two of the original eight were
 * exactly that, and were found by reading the code rather than by the compiler.
 * So `{ generic }` narrows the class; it does not close it.
 */
export function stageFailure(kind: FailureKind, detail: { generic: string }): Error;
export function stageFailure(
  failure: ReaderFacingFailure,
  detail?: string | { authored: string },
): Error;
export function stageFailure(
  what: FailureKind | ReaderFacingFailure,
  detail?: string | { authored: string } | { generic: string },
): Error {
  if (typeof what === "string") {
    /* **The type changed and the runtime deliberately did not.** `detail` is
       `{ generic }` by the overload above, but a bare string still becomes the
       diagnostic exactly as it did before 2026-09-04 — for the untyped callers
       JavaScript can still produce, and because dropping a diagnostic on the
       floor to punish the old spelling would take a log line away without
       anything going red. The compiler is where that form is refused. */
    const diagnostic =
      typeof detail === "string"
        ? detail
        : detail !== undefined && "generic" in detail
          ? detail.generic
          : "";
    return Object.assign(new Error(diagnostic), {
      failureKind: what,
    });
  }
  if (detail !== undefined && typeof detail !== "string" && "authored" in detail) {
    return Object.assign(new Error(coded(detail.authored, what)), {
      failureKind: what.kind,
      readerFailure: what,
    });
  }
  /**
   * **The detail goes on verbatim, and is not dressed up to look authored.**
   *
   * For six hours on 2026-09-03 this appended the reader sentence's bracketed
   * code to `detail`, so that `authored` in src/monitoring-scrub.ts would
   * forward the diagnostic to Sentry. That was wrong, and the way it was wrong
   * is worth keeping: `authored` does not ask *"is there a code"*, it treats a
   * registered code as **proof that we wrote the whole string**, which is why
   * `sanitise` then forwards it verbatim. Appending one lets any text buy that
   * proof — and a step's `detail` is free text, which is exactly where a
   * provider body or a stretch of the article turns up. GPT Sol reproduced it:
   *
   *     stageFailure(MODEL_REFUSED, "ARTICLE_SENTINEL: private prose")
   *     → Sentry: "ARTICLE_SENTINEL: private prose [ai-model-refused]"
   *     → withheld: false
   *
   * So an uncoded diagnostic is withheld from Sentry, and that is the correct
   * outcome rather than a gap. `tests/job-failure.test.ts` § the diagnostic
   * does not buy its way past monitoring drives `sanitise` itself, so this
   * cannot come back by anybody reasoning about it again.
   */
  return Object.assign(new Error(typeof detail === "string" ? detail : what.message), {
    failureKind: what.kind,
    readerFailure: what,
  });
}

/**
 * An authored diagnostic, with the reader sentence's code on the end of it.
 *
 * The code is not decoration and it is not only about Sentry. `authored` in
 * src/monitoring-scrub.ts reads it as provenance, and a **log** reader reads it
 * as identity: tests/stop-details.test.ts pins `[ai-model-refused]` on the log
 * line precisely because absence proves nothing — a stage that died on a
 * missing file before it ever reached a model also contains no sentinel, and
 * the code is the only thing that tells the two apart.
 *
 * Already coded is left alone: it came from somewhere that had already made
 * this decision, and two codes name no branch at all.
 */
function coded(text: string, failure: ReaderFacingFailure): string {
  if (codeOfMessage(text) !== null) return text;
  const code = codeOfMessage(failure.message);
  return code === null ? text : `${text} [${code}]`;
}

/**
 * **The sentence to persist on `step.error` and `job.error`**, given whatever a
 * step threw.
 *
 * This is the seam. Everything a reader is ever shown about a failed step comes
 * through here, and it has exactly two branches: the throw site declared a
 * sentence, or it did not and gets a generic one for its kind.
 *
 * **Undeclared falls through to generic rather than to the error's own text.**
 * That is the whole point, and it is the choice this seam did not make for its
 * first year: `src/jobs.ts` copied `(err as Error).message`, which published
 * whatever a step happened to put in an exception. The known cost is at
 * `stepGaveUp` in src/messages.ts, along with the allowlist that was rejected
 * and the type-level enforcement that does not exist.
 *
 * **Unknown maps to the retryable sentence**, the same compatibility rule
 * `failureKindOf` keeps below: nobody said, so offer another go. A reader must
 * not be told to try again under a failure stored as `ours` or `bug`, and must
 * not have the offer withheld because a kind went unrecorded.
 *
 * @param step the failed step's **label** — see `stepGaveUp`.
 */
export function readerFailureOf(err: unknown, step: string): ReaderFacingFailure {
  const declared = (err as KindedError | null | undefined)?.readerFailure;
  /* Shape-checked rather than trusted. `readerFailure` is read off a thrown
     value, so it is outside the type system in exactly the way `KNOWN_KINDS`
     above describes — and a malformed one here would put `undefined` on a
     reader's screen. */
  if (
    typeof declared === "object" &&
    declared !== null &&
    typeof declared.message === "string" &&
    declared.message !== "" &&
    typeof declared.kind === "string" &&
    declared.kind in KNOWN_KINDS
  ) {
    return declared;
  }
  return stepGaveUp(failureKindOf(err) ?? "retry", step);
}

/**
 * What kind of failure this is, if it said.
 *
 * Two sources, in order. The **field** is the real one and the one a stage
 * should set, and since 2026-09-03 every failure in the pipeline that had a
 * kind worth knowing sets it: `stageFailure` writes the field, and
 * `anthropicCallFailed` and the ten `MODEL_REFUSED` throw sites go through it.
 *
 * The **bracketed code** is the fallback, and it is now a fallback for history
 * rather than for a live mechanism. This paragraph described the live one until
 * that day — those stages threw the reader's coded sentence *as*
 * `Error.message`, having nowhere else to put a kind — and the split gave them
 * somewhere. What still arrives by code is a job settled before the split and
 * read back off disk, and any error whose message happens to be one of
 * src/messages.ts's sentences. Both should keep answering, so the branch stays.
 *
 * `undefined` means nobody said, and every caller must read that as "offer the
 * retry".
 */
export function failureKindOf(err: unknown): FailureKind | undefined {
  const declared = (err as KindedError | null | undefined)?.failureKind;
  if (typeof declared === "string" && declared in KNOWN_KINDS) return declared;
  const message = (err as Error | null | undefined)?.message;
  return typeof message === "string" ? (kindOfMessage(message) ?? undefined) : undefined;
}

/**
 * Should the card offer to run this job again?
 *
 * The one question the interface asks, so the answer is given here rather than
 * at the button — the same argument `worthRetrying` makes in src/messages.ts.
 *
 * It deliberately does not decide what to show *instead*. The failed step's own
 * message is already on the card and already says why another attempt will not
 * help; a second widget explaining the same thing would be the app talking over
 * itself.
 */
export function jobWorthRetrying(job: { failureKind?: FailureKind }): boolean {
  return job.failureKind === undefined || canRetry(job.failureKind);
}
