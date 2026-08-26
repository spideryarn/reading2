/**
 * Whether a failed ingest job is worth another go.
 *
 * The Retry button on a job card was offered under every failure, including the
 * ones that are arithmetic. `TooLongForOnePass` (src/token-budget.ts) is the
 * clearest: the article needs more output tokens than one response holds, and
 * pressing Retry makes the identical call and fails identically. See
 * docs/postmortems/toc-max-tokens.md.
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
 */
import { canRetry, type FailureKind, kindOfMessage } from "./messages.js";

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
}

/**
 * Throw this when a step's failure cannot come out differently unchanged.
 *
 * One line at the throw site, and the reason it is a helper rather than an
 * `Object.assign` written out four times is that it is greppable: `stageFailure`
 * finds every place in the pipeline that has made this claim, which is the list
 * anybody auditing it wants.
 *
 * Make the claim only when it is true of a **retry**, which is a narrower thing
 * than a re-run: Retry skips every step that finished, so a stage that failed
 * over an artefact an earlier step already wrote will read the identical
 * artefact again. That is what makes a bad tree or a missing URL permanent and
 * a malformed model answer not.
 */
export function stageFailure(kind: FailureKind, message: string): Error {
  return Object.assign(new Error(message), { failureKind: kind });
}

/**
 * What kind of failure this is, if it said.
 *
 * Two sources, in order. The **field** is the real one and the one a stage
 * should set. The **bracketed code** is the fallback, for the model-call layer:
 * `anthropicCallFailed` (src/anthropic-call.ts) throws
 * `providerHttpFailure(status).message`, and the six stages that can meet a
 * refusal throw `MODEL_REFUSED.message` — sentences that already carry their
 * kind because they had nowhere else to carry it. Reading it here is not a
 * second mechanism; it is the same one, arriving through the door
 * src/messages.ts built for it.
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
