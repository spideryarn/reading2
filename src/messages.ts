/**
 * What the reader is told when something goes wrong.
 *
 * Every sentence a reader can see because a model call failed is written here
 * and nowhere else. The rules these follow, and why, are in
 * docs/project/copy.md — read that before adding one.
 *
 * The short version, because it is what makes these different from the strings
 * they replaced:
 *
 * 1. **Say what happened, in words that do not assume any of this.** "The AI
 *    service is busy", not "HTTP 429". The reader is here to read an article.
 * 2. **Say whose problem it is.** There are four kinds and they need different
 *    behaviour from the reader: *try again* (transient), *nothing you can do*
 *    (this app's own account or configuration), *this is a bug here*, and
 *    *refused, and it will be refused again* (a safety rule, a size limit) —
 *    the last being the one where the reader can still get somewhere by asking
 *    for less. Telling someone to try again when retrying cannot possibly work
 *    is the worst mistake available here, because they will do it repeatedly.
 * 3. **Say what to do next**, when there is anything.
 * 4. **Never repeat what the provider said.** Its error body is the one place an
 *    upstream might echo the article back — see `ProviderRefused` in
 *    src/ai-call.ts, and docs/project/logging.md.
 * 5. **Carry a short code at the end** for whoever is supporting this. It is in
 *    brackets and last, so it is skippable by a reader who does not want it and
 *    quotable by one reporting a problem.
 */
import { readableDay } from "./billing-plan.js";
import type { Mode } from "./modes.js";
import type { DateRejection, EmbeddingReason, StepName } from "./types.js";
import { MAX_PAGES, MAX_UPLOAD_BYTES } from "./uploads.js";

/**
 * Which kind of failure this is, which decides what the reader should do.
 *
 * **Three of the four mean retrying cannot work.** That is the point of the
 * type, and `canRetry` below is the one question the interface has to ask it:
 * a Retry button under a message that says "trying again will not help" is the
 * exact mistake docs/project/copy.md was written to stop, and offering it is a
 * worse version of the mistake than writing the sentence badly, because the
 * reader can act on a button.
 */
export type FailureKind =
  /** Transient. Retrying is the right move. */
  | "retry"
  /** This app's account or configuration. Retrying cannot help. */
  | "ours"
  /** A defect here. Retrying cannot help, and someone should hear about it. */
  | "bug"
  /**
   * The service refused *this request* and will refuse it again unchanged — a
   * safety filter, a size limit, a rule about what may be asked.
   *
   * Separate from `ours` because it is a different sentence and a different
   * next step: nothing here is misconfigured, and the reader may well be able
   * to get an answer by asking for less. Added 2026-08-26 after review pointed
   * out that 403 and 413 were being reported as a broken API key and as a blip
   * respectively, neither of which is true.
   */
  | "blocked";

export interface ReaderFacingFailure {
  kind: FailureKind;
  /** The whole sentence(s) shown to the reader, code included. */
  message: string;
}

/**
 * Whether to offer the reader another go.
 *
 * Derived rather than stored, so a new kind cannot be added without deciding
 * this — the compiler makes you come here.
 *
 * **A total map rather than `kind === "retry"`, which is what makes that last
 * sentence true.** It was written as the comparison, and a fifth member of
 * `FailureKind` would have compiled without touching this function and quietly
 * become non-retryable — so the cost this comment claims to charge for a new
 * kind was never actually collected. Found by a GPT Sol review on 2026-08-26,
 * while it was answering whether a fifth kind was affordable. A missing key
 * here is a type error, which is the entire reason for the shape.
 *
 * A map and not a `switch` with a throwing `default`: `FailureKind` is closed
 * and declared in this file, so the right failure is a red compile, not a
 * crash at runtime on a value somebody added upstream.
 */
const RETRYABLE: Record<FailureKind, boolean> = {
  retry: true,
  ours: false,
  bug: false,
  blocked: false,
};

export function canRetry(kind: FailureKind): boolean {
  return RETRYABLE[kind];
}

/**
 * The kind of failure a stored message describes, read back out of its code.
 *
 * ## Why this exists rather than a `kind` field on the wire
 *
 * The interface has to know whether to offer another go, and by the time it is
 * rendering, all it has is a sentence: `ProviderRefused` throws an `Error`, and
 * what gets stored — on a comment, a chat message, a search run, a glossary
 * lookup — is `err.message` and nothing else. Threading a `kind` alongside it
 * means a new field on four persisted types and a column on each of their
 * Postgres tables, in the middle of the migration that is adding those tables.
 *
 * So the code carries it. That is a **narrow** widening of what the bracketed
 * code is for, and worth being honest about: docs/project/copy.md introduces it
 * as a support reference, something a reader can quote. It is now also read by
 * one function. What makes that safe is not care, it is the test —
 * tests/messages.test.ts round-trips every message in this file through here
 * and fails if the answer differs from its declared `kind`. A code that stops
 * agreeing with its message is a red test, not a wrong button.
 *
 * ## What it does with a message it does not recognise
 *
 * Returns `null`, and **every caller must treat that as "offer the retry".**
 * Two things arrive here that this file did not write: errors stored before it
 * existed, and failures that are not model failures at all — a dropped
 * connection, a 500 from our own server. Guessing "permanent" for those would
 * hide a button that would have worked, which is the worse of the two
 * mistakes: an offered retry that fails costs a click, a withheld one costs the
 * reader the feature.
 */
/**
 * The bracketed code at the end of a stored message, or null.
 *
 * Split out of `kindOfMessage` on 2026-09-01 for one caller that wants the
 * **code itself** rather than the kind it maps to: `isInterrupted` in
 * src/job-state.ts asks *is this the specific ending `[jb-gone]` names*, and
 * `retry` — which is what `jb-gone` maps to — is shared with a dozen ordinary
 * failures that are nothing of the sort.
 *
 * One regex in one place. The alternative was `job.error === INTERRUPTED.message`
 * at the call site, which made a classifier out of prose that is free to be
 * reworded and would have silently reclassified every job already stored.
 */
export function codeOfMessage(message: string): string | null {
  return message.match(/\[([a-z0-9-]+)\]\s*$/)?.[1] ?? null;
}

export function kindOfMessage(message: string): FailureKind | null {
  const code = codeOfMessage(message);
  if (!code) return null;
  const known = CODE_KINDS[code];
  if (known) return known;
  /* `[ai-409]` and friends — the fall-through branches, which mint a code from
     the status. Same rule they use: a refusal we have no theory about will be
     refused again, anything else gets the benefit of the doubt. */
  const status = code.match(/^ai-(\d{3})$/)?.[1];
  if (status) return Number(status) >= 400 && Number(status) < 500 ? "blocked" : "retry";
  return null;
}

/**
 * Should the interface offer another go under this failure?
 *
 * The one question a component asks about a stored error, so that the answer is
 * given in one place rather than at each affordance. **An unrecognised message
 * means yes** — see `kindOfMessage` for why that is the safe direction.
 *
 * Note what this deliberately does not do: it does not decide what to show
 * *instead* of the button. The message already says why retrying will not work
 * and what the reader can do about it; a second widget explaining the same
 * thing would be the app talking over itself.
 *
 * ## The two places that deliberately do not ask
 *
 * There are five surfaces where a failure can appear, and three consult this.
 * The other two are not oversights:
 *
 * **The glossary's "Check the web".** It is the only control that term has ever
 * had — it *is* the first attempt and the retry, because a failed lookup leaves
 * `entry.lookup` undefined and the button simply comes back. Hiding it would
 * take away the only route to a lookup for that term, permanently, on the
 * strength of a failure that may have been about this app's credit an hour ago.
 * The other three surfaces all have another way through (close and reselect,
 * rephrase in the box, edit the question), which is exactly what makes hiding a
 * button safe there and not here.
 *
 * **AddArticle's Retry**, which restarts a pipeline job. This one is a real
 * gap, not a decision, and the reason recorded here has gone stale: it said job
 * errors carry no code. Some do now — `anthropicCallFailed`
 * (src/anthropic-call.ts) throws `providerHttpFailure(status).message`, code
 * and all, and the Anthropic stages surface it.
 *
 * But the failure that most needs this still carries nothing.
 * `TooLongForOnePass` (src/token-budget.ts) is arithmetic: a second attempt
 * cannot succeed, and the button is offered anyway. See
 * docs/postmortems/260826a-toc-max-tokens.md.
 *
 * The fix wants a structured `FailureKind` on the job rather than a code parsed
 * back out of a sentence. A job is a struct with room for a field; the stored
 * messages this file serves are not, and that constraint is the *only* reason
 * the code carries the kind — see `kindOfMessage`. A workaround should not be
 * inherited by the case that does not need it.
 */
export function worthRetrying(message: string | null | undefined): boolean {
  if (!message) return true;
  const kind = kindOfMessage(message);
  return kind === null || canRetry(kind);
}

/**
 * Every fixed code this file can produce, and what it means.
 *
 * Next to the messages rather than in the client, so there is one file to
 * change and the round-trip test can see both halves at once.
 *
 * **Exported only so a test can compare it against the messages themselves.**
 * Nothing should read a kind out of here directly — `kindOfMessage` is the way
 * in, because it also handles the codes that are minted from a status and are
 * therefore not in this table. The test asserts these keys are exactly the
 * codes the file's messages carry, which is what stops this table and the
 * messages becoming two lists maintained by memory.
 */
/**
 * **Nobody came back for this job.**
 *
 * A claimant takes a job and its lease says how long it may hold it. A lease
 * that runs out means the process holding it is gone — frozen by the host,
 * restarted, or killed — and the job would otherwise sit `running` for ever,
 * blocking its article and counting against the concurrency cap.
 *
 * The sentence says what happened and offers the retry, because this is the one
 * failure where retrying is not just permitted but likely to work: `stepIsDone`
 * derives what is finished from the artefacts, so a retry resumes rather than
 * starting again. What it deliberately does not do is *take the job over* by
 * itself. A lease that has expired does not prove the old claimant has stopped
 * — only that it stopped saying so — and two runners writing one article is
 * worse than one click. docs/plans/260827h-durable-queue-and-uploads.md § 2.
 *
 * **Two situations, one sentence, and the second one is the commoner.** A lapsed
 * lease is a claimant that really has gone; a claimant that reaches its own
 * deadline mid-step and hands the job back is *choosing* to stop, which "did not
 * come back" describes a little generously. It is the same thing from the
 * reader's side — something was running their article and is not any more,
 * nobody did it to them, and pressing the button resumes — so it stays one
 * sentence rather than two. It is now also what the **step** says in that case,
 * not just the job: src/jobs.ts § `DeadlineReached`, and `STEP_STOPPED` below
 * for the accusation that fixed.
 *
 * **But the second situation reaches this sentence only at the end now**, since
 * 2026-09-04. A claimant that runs out of time hands the job back to the queue
 * instead of ending it (`pauseForDeadline`, src/store/jobs.ts) — that is a
 * `queued` row with no sentence on it at all, which is right, because nothing
 * has ended and there is nothing for a reader to do. Only when the windows are
 * gone does the overrun end here, and then the wording is exact: three
 * claimants have now failed to come back with it.
 */
/**
 * **The stable half of `INTERRUPTED`**, and the only half anything may classify
 * on.
 *
 * `isInterrupted` in src/job-state.ts turns a stored job into the reader-facing
 * state *interrupted*, and it asks this rather than comparing the sentence:
 * every job already in the database carries the wording of the day it was
 * settled, so a reworded sentence must not be able to reclassify history. Named
 * and interpolated below so the two cannot drift apart — a code the message
 * does not actually end with is a classifier that quietly matches nothing.
 */
export const INTERRUPTED_CODE = "jb-gone";

export const INTERRUPTED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "This stopped part-way through, and whatever was running it did not come back. " +
    "The steps that finished are kept, so trying again picks up where it left off rather than " +
    `starting over. [${INTERRUPTED_CODE}]`,
};

export const CODE_KINDS: Record<string, FailureKind> = {
  "ai-busy": "retry",
  "ai-no-credit": "ours",
  "ai-key": "ours",
  "ai-no-model": "ours",
  "ai-refused": "blocked",
  "ai-model-refused": "blocked",
  "ai-too-big": "blocked",
  "ai-bad-request": "bug",
  "ai-timeout": "retry",
  "ai-upstream": "retry",
  "ai-interrupted": "retry",
  "ai-unreadable": "retry",
  "ai-unexpected": "bug",
  "ai-not-set-up": "ours",
  "ai-overflowed": "retry",
  "ai-slow": "retry",
  "ai-stalled": "retry",
  "ai-cut-off": "retry",
  /* Beside `ai-overflowed` rather than merged with it — see `MARK_CUT_OFF` for
     why a mark cannot take that one's advice. */
  "ai-mark-cut-off": "retry",
  /* The same diagnosis as `ai-overflowed` reported to a screen with no scoping
     control — see `ANSWER_OVERFLOWED_FIXED_ASK`, and `MARK_CUT_OFF` above it for
     the precedent this follows. */
  "ai-overflowed-no-ask": "retry",
  "ai-filtered": "blocked",
  "ai-no-room": "blocked",
  "ai-empty": "retry",
  /* **Raised outside this file**, by `CLAIMS_UNUSABLE` (src/referee-claims-run.ts)
     and `ANSWER_UNUSABLE` (src/referee-criteria-run.ts): the model answered and
     none of what came back could be found in the paper. `retry` because both
     sentences end "asking again usually works", which is true — it is a fact
     about that answer, never about the paper.

     Both sites had asked in prose since 2026-09-02 to be registered here, and
     `referee-criteria-run.ts` said exactly why it would not happen: *"Skipping
     the second has no symptom here — `kindOfMessage` returns null,
     `worthRetrying` says yes, and Retry is the right answer anyway."* It was
     right, and being right by a default's coincidence is not the same as being
     declared. tests/every-ai-code-is-registered.test.ts is what now says so.

     **Registering a code is not only bookkeeping**, which GPT Sol pointed out
     and this entry is the first case of: `authored()` in src/monitoring-scrub.ts
     is `kindOfMessage(message) !== null`, so a message ending in a registered
     code has its **full text forwarded to Sentry** instead of being withheld.
     That is correct for these two — both are fixed literals with nothing
     interpolated into them, which is exactly what that allowlist is for. But
     note what it means for the next sentence given this code: it must stay free
     of article prose and of anything a reader typed (docs/project/logging.md).
     `monitoring-scrub.ts`'s own reasoning says the vocabulary is closed because
     "tests/messages.test.ts round-trips every sentence in that file", and these
     two sentences are not in this file — which is the sharpest argument for
     moving them here, still open, and belonging to docs/project/copy.md's own
     batch rather than to this line.

     **Two different sentences share this one code**, which the "one distinct
     sentence, one code" rule says they must not — see
     docs/plans/260906h-improve-the-codebase-fourth-sweep.md § T2.8. Recorded
     rather than fixed here: unifying them or splitting the code changes what a
     reader is shown, which is copy.md's call and not a sweep's. */
  "ai-unusable": "retry",
  /* Not a model call, and not the reader's fault either. `retry` on purpose:
     an interrupted job resumes from its artefacts rather than starting again,
     so another go is both allowed and cheap. See `INTERRUPTED`. */
  "jb-gone": "retry",
  /* **The two refusals "Check the web" can give**, and the only `gl-` pair.
     Neither is a model call and neither is a fault: one says the article never
     quotes the term, the other that the glossary no longer fits the article.
     `blocked` because both refuse again unchanged — see
     `GLOSSARY_TERM_NOT_QUOTED` for why they carry codes at all. */
  "gl-not-quoted": "blocked",
  "gl-stale": "blocked",
  /* **The three ways the *Look up a term* box comes back empty.** All
     `blocked`: each refuses again unchanged, and each names a different way
     through — chat, a different spelling, or nothing at all. Three codes rather
     than one because they are three facts, which is the lesson of
     docs/postmortems/260904c-the-glossary-said-the-term-was-not-there.md
     applied on the same code path a day later. See `ASKED_TERM_ABSENT`. */
  "gl-ask-absent": "blocked",
  "gl-ask-part-word": "blocked",
  "gl-ask-no-prose": "blocked",
  /* **Debate's own, and the only `db-`.** `retry` because the model choosing
     not to search, and a provider falling back to one that dropped the tool,
     both come out differently next time. See `DEBATE_SEARCH_DID_NOT_RUN` for
     why a search that did not run is a *failure* rather than an empty result. */
  "db-no-search": "retry",
  /* **The four generic step failures**, `stepGaveUp` above — one per kind, and
     that is why there are four rather than one. The kind is what decides
     whether a Retry appears, and a single sentence would have had to either
     promise a retry under a failure stored as `bug` or withhold one under a
     blip. Registered like everything else here, because `readerFailureOf`
     (src/job-failure.ts) is not the only reader: `monitoring-scrub.ts` uses
     this table to decide whether a sentence is provably ours and may go to
     Sentry, and an unregistered code is withheld. */
  "jb-step-again": "retry",
  "jb-step-ours": "ours",
  "jb-step-bug": "bug",
  "jb-step-no": "blocked",
  /* Not a failure at all — the reader pressed Stop. `retry` because a stopped
     job resumes from its artefacts, the same reason `jb-gone` is. See
     `STEP_STOPPED`. */
  "jb-stopped": "retry",
  /* **The seven steps that know why they stopped**, and six of them are
     `blocked` — see § the steps that know why they stopped below for what that
     narrows and why. They are `jb-` rather than `ai-` because none of them is a
     model call: four are a document that is not there, is not what it claims, or
     has no words in it, and three are a Sketch that has to be drawn before the
     painting can be.

     `jb-source-damaged` is the one `bug` of the seven: a stored object that does
     not hash to its own name is an invariant of ours that broke, and it is the
     only one of the seven the reader has no move against. */
  "jb-source-gone": "blocked",
  "jb-source-damaged": "bug",
  "jb-no-article": "blocked",
  "jb-no-text": "blocked",
  "jb-no-sketch": "blocked",
  "jb-sketch-stale": "blocked",
  "jb-sketch-profile": "blocked",
  /* Reading a PDF. The split of prefix is the rule in docs/project/copy.md read
     both ways: `pdf-` for the two refusals that are arithmetic over bytes we
     already hold, `ai-pdf-` for the two that are an answer the service came
     back with. `ai-pdf-cut-off` is the one `bug` of the four, matching
     `ai-over-room` — it is our own room for the answer set too low. */
  "pdf-pages": "blocked",
  "pdf-chunk-big": "blocked",
  /* The two files pdf.js will not open. `blocked` and not `retry`, which is the
     whole of the finding they were added for: nothing declared reads as *nobody
     said*, and nobody said means offer another go — so a password-protected
     PDF had a Retry button that could not ever work. See `PDF_LOCKED`. */
  "pdf-locked": "blocked",
  "pdf-damaged": "blocked",
  "ai-pdf-cut-off": "bug",
  "ai-pdf-filtered": "blocked",
  /* The two token-budget failures, split from their own diagnostics on
     2026-09-03. `ai-too-long` is arithmetic done before the call and
     `ai-over-room` is the call coming back cut off; both withhold the button,
     for the reasons at `TooLongForOnePass` and `truncationFailure` in
     src/token-budget.ts. */
  "ai-too-long": "blocked",
  "ai-over-room": "bug",
  /* Writing quiz questions, `quiz-`. Both are `retry` and both mean it: the
     batch is written afresh on every call, so a second one genuinely can come
     out better. See `quizBandsNotSpread` and `QUIZ_NOTHING_ANCHORED`. */
  "quiz-spread": "retry",
  "quiz-unanchored": "retry",
  /* Not a model call. `db-` rather than `ai-` so that a reader quoting four
     characters, and whoever they quote them to, can tell the two apart at a
     glance — see `STORAGE_BUSY`. */
  "db-busy": "retry",
  "db-failed": "bug",
  /* Reading something back out of this app's own API, `rd-`. Not a model call,
     not the database as the reader meets it, and not a job — it is the *check*
     that failed, behind a page that is still on screen. Its own prefix for the
     reason `db-` and `up-` have theirs: four characters should tell whoever is
     helping which part of the app the reader was in. See THREAD_RECHECK_FAILED. */
  "rd-recheck": "retry",
  /* Uploading a file. `up-` for the same reason `db-` is not `ai-`: a reader
     quoting four characters should not have to explain which part of the app
     they were in. **Their kinds are not uniform**, which is the whole reason
     they are registered rather than left to fall through: an unknown code means
     *offer another go*, so "that file isn't a PDF" would have come with a Retry
     button that cannot work. (This carried a tally — "two are blocked and two
     are retry" — until 2026-09-04, by which time it had been wrong through three
     separate additions, this stage's included. A count written in prose beside
     the list it counts goes stale on the next line added, and no test can see
     it, so there is no count here now.) */
  "up-big": "blocked",
  "up-pdf": "blocked",
  /* The page cap, as the *upload record* states it. The job card gets
     `pdf-pages` instead, which names the count — see `UPLOAD_TOO_MANY_PAGES`
     for why one refusal needs two sentences. */
  "up-pages": "blocked",
  /* Signing in, `auth-`. Only one of the four is not `retry`, and that one is
     the reason they are registered at all: a provider switched off on the
     project is `ours`, so no interface offers a Retry that would do exactly the
     same thing again. See AUTH_PROVIDER_OFF. */
  "auth-provider": "ours",
  "auth-denied": "retry",
  "auth-oauth": "retry",
  "auth-exchange": "retry",
  /* Both `blocked` rather than `retry`, changed 2026-08-27 when the acquisition
     step made the button real. `kind` answers "will another go at *this job*
     help", and for these two it will not: the step would read the same damaged
     object, or the same absent one, out of the same staging key. What helps is
     a new upload, which is what both sentences now say. */
  "up-off": "ours",
  "up-sum": "blocked",
  "up-gone": "blocked",
  /* **`retry`, and it is the only upload code that is.** Every other one
     describes a file that will never be readable — the wrong bytes, too many
     bytes, too many pages, nothing there at all — while this one describes one
     that is not there *yet*, which is an ordinary state now that the reader gets
     the ingest's address before the bytes have finished moving. Another go is
     exactly what helps. See `UPLOAD_STILL_ARRIVING`. */
  "up-wait": "retry",
  /* These two were missing until 2026-08-26, so `kindOfMessage` returned null
     for `NO_RESPONSE` and `TOOL_CALL_LOST` and the interface was guessing on
     both. It guessed right — both are `retry`, and null means offer the retry —
     which is exactly why nothing ever looked wrong.

     The cross-check in tests/messages.test.ts was written to catch this and did
     not, because it compared this table against a second hand-written list that
     was missing the same two messages. Two lists that agree while both being
     wrong are not a check. That test now collects the messages out of this
     module instead, so only one of the two lists is maintained by hand and it
     is this one. Found by a GPT Sol review. */
  "ai-no-response": "retry",
  "ai-tool-lost": "retry",
  "ai-tool-loop": "retry",
  /* Placing passages by meaning — Force's dotted lines, Drift and Trail's dots.
     Registered from the day they were written, unlike the `[emb1]` and `[emb2]`
     they replace: those were inline in src/routes.ts and in no table at all, so
     an account that may not use the model came out as a retryable blip and
     Sentry withheld the sentence that explained it. See `PLACING_*` below. */
  "ai-embed-account": "ours",
  "ai-embed-down": "retry",
  "ai-embed-busy": "retry",
  /* Filing a bug report, `fb-`. The distinction is worth more here than
     anywhere else in this table: `fb-send` is the request that reports failures
     having failed, so an interface that told the reader "that is a bug, tell
     somebody" at that exact moment would have handed them a loop. `retry`, and
     the dialog puts a Copy button beside it for the case where it keeps failing.
     `fb-store` is a deployment running without the database reports are kept in,
     which another go cannot fix. See § feedback below, and
     docs/project/feedback.md. */
  "fb-send": "retry",
  "fb-store": "ours",
  /* The subscription allowance, `pay-`. All six are registered rather than
     left to fall through, and the four `blocked` ones are the reason: an
     unrecognised code means *offer another go*, so "you have used all three of
     your free articles" would have arrived with a Retry button beside it —
     pressing it does not move the count, and a button that cannot work is the
     mistake this table exists to prevent. `pay-off` is `ours`: a deployment
     with no Stripe configured is nothing the reader can act on.
     docs/project/billing.md. */
  "pay-free": "blocked",
  "pay-limit": "blocked",
  "pay-lapsed": "blocked",
  "pay-off": "ours",
  /* Pressing *Manage billing* with nothing to manage. `blocked` for the same
     reason as the three above: another press gives the same answer, so a Retry
     button beside it would be a button that cannot work. */
  "pay-none": "blocked",
  /* Stripe had a bad minute. The one `pay-` code where another go is exactly
     the right thing to offer — see `BILLING_UNREACHABLE`, and note it is a
     different situation from `pay-off`, which is a deployment with no Stripe. */
  "pay-down": "retry",
};


/**
 * A provider call that came back with an HTTP status instead of an answer.
 *
 * The status is mapped rather than shown, because a number is not an
 * explanation. What the reader needs from each of these is different: 429 means
 * wait, 402 means this app is out of money and waiting will not fix it, 401
 * means nobody here is getting an answer until a key is replaced.
 */
export function providerHttpFailure(status: number): ReaderFacingFailure {
  if (status === 429) {
    return {
      kind: "retry",
      message:
        "The AI service is busy right now. Waiting a few seconds and trying again usually works. [ai-busy]",
    };
  }
  if (status === 402) {
    return {
      kind: "ours",
      message:
        "This app has run out of credit with the AI service, so it cannot answer until that is topped up. " +
        "Nothing you can do from here, and trying again will not help. [ai-no-credit]",
    };
  }
  if (status === 401) {
    return {
      kind: "ours",
      message:
        "This app cannot sign in to the AI service — its key is missing or no longer valid. That needs " +
        "fixing here, and until it is, none of the AI features will work. [ai-key]",
    };
  }
  /* Deliberately *not* folded in with 401, though it is the obvious pairing and
     was written that way first. OpenRouter returns 403 for its safety and
     prompt-injection guardrails, for spend limits, and for models an account is
     not allowlisted for — so "the key is invalid, no AI feature will work" was
     wrong about the cause and wrong about the scope, and would have sent
     somebody to check a key that was fine. We cannot tell which of those it is
     without reading the body, and the body is the one thing we may not repeat
     (rule 4 in docs/project/copy.md), so the message says the true and useful
     part and stops. */
  if (status === 403) {
    return {
      kind: "blocked",
      message:
        "The AI service refused to answer this one, and it does not say why — that can be its safety " +
        "rules, or a limit on this app's account. Asking the same thing again will most likely get the " +
        "same refusal; asking something narrower sometimes gets through. [ai-refused]",
    };
  }
  if (status === 404) {
    return {
      kind: "ours",
      message:
        "The AI model this app is set up to use is not available. That needs fixing here, and trying " +
        "again will not help until it is. [ai-no-model]",
    };
  }
  if (status === 400 || status === 422) {
    return {
      kind: "bug",
      message:
        "The AI service rejected this request as malformed. That is a bug in this app, and trying " +
        "again will get the same result. [ai-bad-request]",
    };
  }
  if (status === 413) {
    return {
      kind: "blocked",
      message:
        "That was more text than the AI service will take in one go, and trying again sends the same " +
        "amount. Select a shorter passage, or ask about a smaller part of the article. [ai-too-big]",
    };
  }
  if (status === 408 || status === 504) {
    return {
      kind: "retry",
      message:
        "The AI service took too long to answer and gave up. Trying again often works, and asking " +
        "something narrower works more often still. [ai-timeout]",
    };
  }
  if (status >= 500) {
    return {
      kind: "retry",
      message:
        "The AI service is having trouble at its end. Nothing here can fix it, and it usually passes " +
        "on its own — waiting a little and trying again is the thing to do. [ai-upstream]",
    };
  }
  /* An unrecognised 4xx is a refusal, and a refusal repeated unchanged is
     refused again — so the old "trying again is worth a go" here was advice
     against the odds. Everything else (an unrecognised 3xx, a status this code
     has no theory about) keeps the benefit of the doubt. */
  if (status >= 400 && status < 500) {
    return {
      kind: "blocked",
      message:
        "The AI service turned this request down and did not say why. Sending the same thing again " +
        `will most likely get the same answer. [ai-${status}]`,
    };
  }
  return {
    kind: "retry",
    message: `The AI service did not answer, and did not say why. Trying again is worth a go. [ai-${status}]`,
  };
}

/**
 * A call that started answering and then failed part-way.
 *
 * Kept separate from the HTTP cases because the reader **may** be looking at half
 * an answer, and the sentence has to make sense underneath one.
 *
 * "May", not "is", and that is the correction: this used to say *"Anything above
 * this point is what arrived before it stopped"*, which assumes the reader
 * watched the text arrive. Comments and chat stream, so they do. **The glossary
 * lookup does not** — it drains `explain()` and shows a spinner, so "above this
 * point" was an empty space and the sentence described a screen the reader was
 * not looking at. A message in one file, used by callers with different
 * interfaces, has to survive all of them. Found by review, 2026-08-26.
 */
export const PROVIDER_FAILED_MID_ANSWER: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The AI service began answering and then hit a problem, so whatever arrived is all there is. " +
    "Trying again starts a fresh answer. [ai-interrupted]",
};

/** A reply that was not the shape we can read at all. */
export const PROVIDER_UNREADABLE: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The AI service sent back something this app could not read at all. That is usually a one-off, " +
    "so asking again generally works. [ai-unreadable]",
};

/**
 * The app has no API key at all, so no model call can be made.
 *
 * This one used to read *"OPENROUTER_API_KEY is not set. Put it in .env.local —
 * see docs/project/setup-dev.md"*, in three files, and it reached the reader's
 * screen. That is an instruction to edit a dotfile in a repository they do not
 * have, naming an environment variable and a documentation path, handed to
 * somebody who came here to read an article. Rule 1 in docs/project/copy.md
 * exists for exactly this sentence.
 *
 * The developer-facing version is not lost — it is logged, where whoever can
 * act on it will see it, which is the split logging.md describes.
 */
export const NOT_CONFIGURED: ReaderFacingFailure = {
  kind: "ours",
  message:
    "This app has not been set up to talk to the AI service yet, so none of the AI features can " +
    "answer. It needs somebody with access to finish setting it up; trying again will not help. " +
    "[ai-not-set-up]",
};

/**
 * The model's answer stopped mid-structure because it ran out of room.
 *
 * Distinct from `ENDED_UNFINISHED`, which is a connection ending early. This is
 * the ceiling we set being reached, and the reader's lever is different: a
 * narrower ask returns a shorter answer that fits.
 *
 * **It said *"Asking for something narrower usually fits"* flatly until
 * 2026-09-02, and for three of its four callers that was an instruction to press
 * a control that does not exist.** `parseHits` in src/search.ts raises this, and
 * `parseHits` is search's parser *and* Referee mode's: a criterion run, a claims
 * pull and a Mirror run all end here. Only Search has an ask to narrow — the
 * reader typed it. Claims pulls the paper's own claims and has no scoping
 * control of any kind, Mirror reads the referee's comments and has none either,
 * and a criterion's words are a saved row rather than a box on this screen.
 * Found in a browser pass on Claims, 2026-09-02
 * (docs/plans/260902f-make-referee-mode-understandable.md § four things the pass
 * turned up).
 *
 * The first fix conditioned the advice rather than deleting it — *"where you
 * asked a question of your own, asking something narrower usually does"* — and
 * **a cross-family review, 2026-09-02, showed that still misses.** A criterion
 * *is* the referee's own question, so the condition reads as satisfied on the
 * one screen it was written to exclude; and an errored criterion offers *Try
 * again* and nothing else, so acting on it means abandoning the row and writing
 * a different criterion. A condition a reader can read as true while the control
 * it names is absent is worse than no advice, because it sends them hunting.
 *
 * **So it split, and this half keeps the code and the advice.** Search is the
 * caller: its reader typed the ask, and narrowing genuinely is the better lever
 * — the answer's length grows with the number of hits and nothing else, so a
 * smaller question is a shorter answer rather than a re-roll of the same one.
 * `ANSWER_OVERFLOWED_FIXED_ASK` is the other half, and it is the default;
 * src/search.ts § `AskKind` is what chooses.
 *
 * **The split is `MARK_CUT_OFF`'s shape rather than a new idea.** That message
 * exists for exactly this reason — one diagnosis, a caller who cannot take the
 * advice — and it took its own code, because two sentences under one code makes
 * the code useless for the one job it has. `tests/messages.test.ts` enforces
 * that, which is how a first attempt at sharing `[ai-overflowed]` between both
 * halves was caught. Search keeps this code because it is the one already
 * quoted in the wild, and its meaning here has not changed.
 */
export const ANSWER_OVERFLOWED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The answer was longer than there was room for, so it arrived incomplete and could not be used. " +
    "Trying again sometimes gets one that fits, and asking something narrower usually does. " +
    "[ai-overflowed]",
};

/**
 * The same failure, reported to a screen with **nothing to narrow**: a criterion
 * run, a claims pull, a Mirror run.
 *
 * See `ANSWER_OVERFLOWED` above for why there are two of these and why this one
 * is the default that `parseHits` uses unless told otherwise. The retry is the
 * whole of the advice because the retry is the whole of the lever: all three of
 * those screens draw a *Try again* and none of them draws a scoping control.
 *
 * Its own code for `MARK_CUT_OFF`'s reason — one sentence per code — and the
 * name says what distinguishes it: the reader has no ask of their own here.
 */
export const ANSWER_OVERFLOWED_FIXED_ASK: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The answer was longer than there was room for, so it arrived incomplete and could not be used. " +
    "Trying again sometimes gets one that fits. [ai-overflowed-no-ask]",
};

/**
 * The model declined to produce the answer at all.
 *
 * Anthropic's `stop_reason: "refusal"`, which arrives with a `stop_details`
 * object. **That object does not reach the reader and does not reach a log**,
 * for the same reason `ProviderRefused` drops OpenRouter's error body: it is
 * the provider's own words about a request that contained the whole article,
 * and we cannot promise it holds none of it back.
 *
 * Six pipeline stages — arc, labels, hierarchy, glossary, tweets, quotes — each
 * threw `Model refused: ${JSON.stringify(message.stop_details)}` until
 * 2026-08-26, and that string is not thrown away afterwards: `jobs.ts` copies a
 * step's error onto the job, and the job's error is rendered on the progress
 * card. So provider prose had a straight path to the screen through six doors,
 * found by review after seven other doors of the same shape had already been
 * closed. The lesson is the one that plan's Rule 1 already stated — **grep the
 * genre, not the list** (docs/plans/260826m-simplification-audit.md).
 *
 * Be honest about the cost, as `ProviderRefused` is: something was lost.
 * `stop_details` is occasionally the fastest explanation of why a stage failed.
 * What remains is `stop_reason`, the stage and the elapsed time, which is what
 * separates a refusal from a timeout.
 */
export const MODEL_REFUSED: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "The AI service declined to do this one, and what it said about why is not something this app " +
    "passes on. Running it again will most likely get the same answer. [ai-model-refused]",
};

/**
 * The app hit something it had no plan for, on a request.
 *
 * **This is the one message here that is not about a model call**, which is a
 * deliberate widening of what this file covers and worth knowing about: the
 * rules in docs/project/copy.md are about what the reader sees when something
 * fails, and a 500 is that whether or not a model was involved.
 *
 * It exists because the last-resort catch in src/vercel.ts sent
 * `(err as Error).message` straight to the client. That is the raw text of
 * whatever escaped every other handler — a driver's message, a parse error
 * quoting its input, an SDK error built from an upstream body. None of it is
 * ours to publish, and the reader could do nothing with it either way. The
 * whole error still goes to the log, where somebody can act on it.
 */
export const UNEXPECTED_FAILURE: ReaderFacingFailure = {
  kind: "bug",
  message:
    "Something went wrong inside this app while handling that request, and it was not something the " +
    "app knew how to explain. It has been recorded, and it needs fixing here rather than by you. " +
    "[ai-unexpected]",
};

/* ------------------------------------------------------- a step that gave up -- */

/**
 * **What the reader is told when a pipeline step failed and nobody wrote them a
 * sentence about it.**
 *
 * The safety net on the seam described in docs/project/copy.md § The seam
 * between the two audiences. A step throws; src/jobs.ts copies something onto
 * `step.error` and `job.error`; those are persisted and rendered. Until
 * 2026-09-03 what it copied was `Error.message`, so a step's *diagnostic* was
 * published — which had already leaked provider prose through six stages, a
 * `src/token-budget.ts` reference through eight, and a source-file reference
 * plus band arithmetic through the quiz.
 *
 * **So the default is generic, and a useful sentence has to be declared.** The
 * alternative considered and rejected was an allowlist of steps trusted to
 * write their own: one new `throw` inside an approved step leaks immediately,
 * and nothing goes red. The cost is honest — an unmigrated failure says less
 * than its diagnostic did — and it is recoverable, because the diagnostic still
 * reaches **the log**. Publishing an unaudited internal string is neither.
 * ⟨Sol, 2026-09-03⟩
 *
 * The log and not Sentry: Sentry withholds any message it cannot prove we wrote
 * every word of, which a step's free-text diagnostic is not. That cost, and the
 * tempting fix that must not be taken, are in src/job-failure.ts § The log, and
 * not Sentry.
 *
 * **There is no type-level way to do better**, written down so the next person
 * does not spend an afternoon finding out: TypeScript has no checked
 * exceptions, so `PipelineStep.run()`'s signature (src/pipeline.ts) cannot
 * constrain what is thrown through it. A `Result` return could, and would still
 * need this net for the exceptions nobody planned — which is most of them.
 *
 * **Total over `FailureKind`, so a fifth kind is a red compile** rather than a
 * quiet fall-through — the shape `RETRYABLE` above and `KNOWN_KINDS` in
 * src/job-failure.ts already keep, for the same reason.
 *
 * `step` is the step's own **label** — "Fetching the page", "Writing the
 * questions" — which is the word the reader is already watching on the card and
 * in the band. Naming the step is the one thing this sentence knows about the
 * failure, and it is the rule ingest already follows: each step is named, not
 * counted.
 */
const STEP_GAVE_UP: Record<FailureKind, (step: string) => string> = {
  retry: (step) =>
    `${step} did not finish. What went wrong has been recorded for whoever supports this app, ` +
    `and a step that stops like this often comes out differently on a second attempt — so ` +
    `trying again is worth a go. [jb-step-again]`,
  ours: (step) =>
    `${step} did not finish, and the reason is something about how this app is set up rather ` +
    `than anything about the article or about you. Nothing you can do from here will change ` +
    `that, and trying again will not help until somebody fixes it. [jb-step-ours]`,
  bug: (step) =>
    `${step} did not finish, and it stopped on a defect in this app rather than on anything you ` +
    `did. It has been recorded, it needs fixing here, and trying again will not help until it ` +
    `is. [jb-step-bug]`,
  /* **No remedy, because a total fallback has none to offer.** This ended *"A
     shorter piece sometimes gets through"* for six hours, borrowed from the
     `blocked` messages that really are about size. It is not true of every
     `blocked` step: `RawDocumentUnavailable` and `NoBlocksProduced`
     (src/pipeline.ts) have nothing to do with length, and pointing a reader at
     a shorter article would send them off doing the wrong thing — the exact
     cost docs/project/copy.md's opening paragraph names. The only claim a
     sentence standing in for *every* blocked failure can make is that repeating
     the identical request will not change it. ⟨Sol, 2026-09-03⟩ A step that has
     a real way out should declare its own message and say so. */
  blocked: (step) =>
    `${step} could not be done for this article as it stands, and asking for it again unchanged ` +
    `would most likely come back the same way. [jb-step-no]`,
};

/**
 * The generic sentence for one kind of failure of one named step.
 *
 * Read through `readerFailureOf` in src/job-failure.ts rather than called
 * directly: that is where "nobody said, so offer the retry" lives, and it
 * belongs in one place.
 */
export function stepGaveUp(kind: FailureKind, step: string): ReaderFacingFailure {
  return { kind, message: STEP_GAVE_UP[kind](step) };
}

/**
 * **The reader stopped it**, which is not a failure and must not read as one.
 *
 * A cancel unwinds through `runStep`'s catch like everything else, so for the
 * first six hours of the seam's life it was handed `stepGaveUp`'s copy — which
 * says the problem *has been recorded* on a branch that deliberately skips
 * Sentry, and which inherits the *kind* of whatever was in flight when Stop
 * landed. A refusal racing a Stop therefore left *asking again will be refused*
 * on a step of a job that was about to be marked retryable. GPT Sol's stage 2
 * review; src/jobs.ts § the catch in `runStep`.
 *
 * `retry`, and it means it: Retry skips every step that finished, so a stopped
 * job really does pick up rather than start over. That is `INTERRUPTED`'s
 * promise too, and this is deliberately **not** that message — an interruption
 * is *nobody came back*, and telling somebody who pressed Stop that something
 * went wrong is the app not listening (src/job-state.ts § the eight states).
 *
 * **And the same distinction runs the other way, which cost a reader a false
 * accusation for a day.** The claimant's 740 s deadline aborts the *same*
 * controller Stop does, so until 2026-09-04 an overrun was shown this sentence
 * — *"You stopped this before it finished"* — to somebody who had pressed
 * nothing. That case takes `INTERRUPTED` now, decided on the abort's typed
 * reason rather than on the fact of it: src/jobs.ts § `DeadlineReached`.
 *
 * The step is not named here, unlike `stepGaveUp`: the shelf card draws this
 * directly under `step.label`, and the band does not draw it at all.
 */
export const STEP_STOPPED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "You stopped this before it finished. Whatever had already been done is kept, so starting it " +
    "again picks up from there rather than beginning over. [jb-stopped]",
};

/* --------------------------------------- the steps that know why they stopped -- */

/**
 * **The seven pipeline refusals that had a sentence and could not deliver it.**
 *
 * Each of these was already written out at its throw site, in prose meant for a
 * reader, and each went through `stageFailure(kind, detail)` — the form that
 * says only what *kind* of failure it is and treats the sentence as a log-only
 * diagnostic. **That form no longer exists**: since 2026-09-04 it is spelled
 * `stageFailure(kind, { generic: detail })`, so a throw site has to say which
 * audience it meant and a ninth of these cannot be written by accident
 * (src/job-failure.ts § `{ generic }`). So the reader got `stepGaveUp`'s generic copy for `blocked`,
 * which names the step and nothing else, and most of them withheld the Retry
 * button as well: a dead end and no explanation.
 * docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md.
 *
 * They are here rather than at the throw sites for the reason everything else
 * in this file is: a sentence a reader can see is copy, it follows
 * docs/project/copy.md, and it needs a registered code so `kindOfMessage` and
 * `monitoring-scrub.ts` can both read it.
 *
 * **Six are `blocked`, and three of those narrow an earlier `ours`.** The
 * illustrate refusals were tagged `ours` on the argument that a retry would
 * find the identical Sketch and fail identically — right about the *button*,
 * which both kinds withhold, and wrong about the kind. `ours` means *this app
 * is misconfigured, stop and tell somebody* (docs/project/copy.md § the four
 * rules), and none of those is: nothing is broken, and the reader has a real
 * move — draw the Sketch, add the article again, try a different page. That is
 * `blocked`'s definition, and `blocked` is the one non-retryable kind that
 * admits a way out.
 *
 * **The seventh is `SOURCE_DOCUMENT_DAMAGED`, and it is a `bug`**, because it
 * is the one where the reader has no move at all. See it below.
 */
export const SOURCE_DOCUMENT_GONE: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "The copy of this document that this app kept is not where it should be, so there is nothing " +
    "left to build the article from. Running this again would look in the same place; adding the " +
    "article again, from its address or by uploading the file, is what fixes it. [jb-source-gone]",
};

/**
 * **The copy is there and is the wrong bytes**, which is not the same failure as
 * it being absent and does not have the same way out.
 *
 * This sentence used to be `SOURCE_DOCUMENT_GONE`'s: one message covered all
 * three of `RawDocumentUnavailable`'s reasons, and it told the reader that
 * adding the article again is what fixes it. For `corrupt` that is **false**, and
 * the errors themselves say so — *"Nothing here will overwrite it … so it needs
 * clearing by hand"* (`readRawBytes` and `overlongObject`, src/fetch.ts). The
 * object is content-addressed: re-fetching the same document computes the same
 * hash, finds an object already at that name, and leaves the bad one exactly
 * where it was. So the old sentence sent a reader round a loop that cannot
 * terminate — the expensive mistake docs/project/copy.md § rule 2 names.
 * GPT Sol, reviewing the built stage 1, finding 4.
 *
 * **`bug`, not `blocked` and not `ours`.** All three withhold the button, so the
 * choice is only about what the reader is told, and `blocked` is *"ask for less,
 * or accept the no"* — a way out this reader has not got. Between the other two:
 * `ours` is an account or a configuration, and this is neither. That an object
 * at a content-addressed name hashes to that name is an invariant this app keeps
 * and has failed to keep, which is `bug`'s definition, and it is the kind that
 * says *it has been recorded and it needs fixing here*.
 *
 * The diagnostic beside it carries the key and both hashes, which is what
 * somebody clearing the object needs and nothing the reader can use.
 */
export const SOURCE_DOCUMENT_DAMAGED: ReaderFacingFailure = {
  kind: "bug",
  message:
    "The copy of this document that this app kept is damaged — what is stored under its name is " +
    "not the file that name promises, so there is nothing to build the article from. Adding the " +
    "article again will not replace it: that copy is filed under a fingerprint of its own " +
    "contents, and nothing here overwrites one. It has been recorded, and it needs fixing here " +
    "rather than by you. [jb-source-damaged]",
};

export const PAGE_HAS_NO_ARTICLE: ReaderFacingFailure = {
  kind: "blocked",
  /* **It does not say "Readability"**, which is the name of a library the
     reader has never heard of and the whole reason this sentence exists — the
     diagnostic keeps that word, for the log. And it names the three usual
     causes rather than guessing between them: they call for the same move. */
  message:
    "There was no article to find on the page that was fetched. That is usually a login wall, an " +
    "error page, or a page whose words only appear once its own scripts have run — and this step " +
    "would be handed the same page again, so it is the address it came from that needs looking " +
    "at. [jb-no-article]",
};

export const ARTICLE_HAD_NO_TEXT: ReaderFacingFailure = {
  kind: "blocked",
  /* The next failure along from `PAGE_HAS_NO_ARTICLE` and deliberately its own
     sentence: there the page gave up no article at all, here one was extracted
     and had no text in it. The reader's move is the same, but a shared sentence
     would need a shared code, and a code names a branch. */
  message:
    "The page was read, and there was no article text in it to build from. A paywall, an error " +
    "page, or a page whose words only appear once its own scripts have run all end this way, and " +
    "this step would read the same extracted page again — so it is the address the article came " +
    "from that needs looking at. [jb-no-text]",
};

/**
 * **The three ways painting the argument refuses**, one sentence each.
 *
 * They were one helper taking a free string until 2026-09-03, which is two
 * faults in one: three different situations answered to one code, and any text
 * at all could be minted into a *coded* `ReaderFacingFailure` — the provenance
 * `monitoring-scrub.ts` is told to trust. `ILLUSTRATE_REFUSAL` in
 * src/pipeline.ts is the closed union that replaced it. ⟨Sol, 2026-09-03⟩
 *
 * **They name the chip and not the step**, which is the wording their throw
 * site already insisted on: this is read by somebody looking at a band of
 * chips, not at a pipeline. src/web/DiagramPanel.tsx puts Illustrated
 * immediately right of Sketch, and tests/illustrated-view.test.tsx pins that
 * order precisely because "the chip one to the left" would otherwise go quietly
 * wrong.
 */
export const ILLUSTRATE_NO_SKETCH: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "There is no sketch of this article yet, and the painting is made from the sketch rather than " +
    "from the article. Draw the Sketch first — it is the chip one to the left — and then press " +
    "this one again. Until there is one, this will come back the same way. [jb-no-sketch]",
};

export const ILLUSTRATE_SKETCH_STALE: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "The sketch of this article is out of date — the article has moved underneath it, so painting " +
    "it would give you a picture of an argument that is no longer there. Draw the Sketch again — " +
    "it is the chip one to the left — and then press this one. Until it is redrawn, this will " +
    "come back the same way. [jb-sketch-stale]",
};

export const ILLUSTRATE_SKETCH_PROFILE: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "The sketch of this article was drawn for a different reader profile, so the painting would " +
    "be made for somebody else's reading of it. Draw the Sketch again — it is the chip one to " +
    "the left — and then press this one. Until it is redrawn, this will come back the same " +
    "way. [jb-sketch-profile]",
};

/* ----------------------------------------------------- asking the web (debate) -- */

/**
 * **The search tool was offered and either did not run or would not account for
 * itself** — src/debate.ts, and the one failure this mode has that no other
 * stage can have.
 *
 * `retry`, and that is the right kind rather than the generous one: the model
 * *chose* not to search, or a provider fell back to one that dropped the tool,
 * and both come out differently on another attempt.
 *
 * **Why this is a failure at all**, which is the whole design of the mode in
 * one sentence: a model that did not search still answers, plausibly, from
 * memory — and what it produces is not an empty panel but a *full* one, of real
 * URLs it happens to know. Every rule in `readGroup` then drops every row as
 * uncited, and the reader sees "the search found nothing" over a search that
 * never happened. Those are two different facts and the panel must not print one
 * for the other. docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md
 * § 2, where the three empty states are tabulated.
 *
 * It also covers the case where the count is simply not in the response.
 * OpenRouter has renamed that field twice (`whereSearchCountCameFrom`,
 * src/openrouter-stream.ts), and an unreadable count is indistinguishable from
 * a model that chose not to search — so this fails rather than guessing, because
 * the guess that costs nothing to make is the one that would publish a
 * fabrication.
 */
export const DEBATE_SEARCH_DID_NOT_RUN: ReaderFacingFailure = {
  kind: "retry",
  message:
    "This mode goes out to the web, and this time the search either did not run or did not report " +
    "back — so anything the AI said would have come from memory rather than from pages we could " +
    "show you. Nothing has been kept. Trying again usually works. [db-no-search]",
};

/* ------------------------------------------------------------- reading a PDF -- */

/**
 * **The two refusals that happen before a PDF is sent anywhere**, and so are
 * arithmetic rather than anything a model said.
 *
 * `pdf-` rather than `ai-`, which docs/project/copy.md reserves for a model
 * call: no call is made on either of these paths and no money is spent finding
 * out. The two below them keep `ai-` for the same rule read the other way —
 * those are answers that came back from the service.
 *
 * Both `blocked`, and both mean it. The page count and the encoded size are
 * facts about bytes stage 1 has already cached, and Retry never re-runs the
 * step that produced them, so a second attempt counts the same pages and
 * encodes the same megabytes.
 */
export function pdfTooManyPages(pages: number, limit: number): ReaderFacingFailure {
  return {
    kind: "blocked",
    message:
      /* **Not "reads at most 250 of them"**, which the reader can hear as a
         promise to read the first 250 and stop — this refuses the document
         whole, and nothing of it is read. GPT Sol, 2026-09-04. */
      `This PDF has ${pages} pages, and this app takes documents of at most ${limit}. That ` +
      `is a limit on what reading a document is allowed to cost rather than a technical one, so ` +
      `the same file will be refused the same way — a shorter document, or the part of this one ` +
      `you actually want, will go through. [pdf-pages]`,
  };
}

/**
 * **The two ways a PDF never gets read at all**, because pdf.js will not open
 * it — and until 2026-09-04 neither of them had a sentence.
 *
 * `runPdfExtract` translated its page-cap refusal out of `pass0` and rethrew
 * everything else bare, so a locked or damaged file arrived at
 * `readerFailureOf` with nothing declared. Nothing declared reads as *nobody
 * said*, and nobody said means `retry` — so **the reader was handed a Retry
 * button for a file that will never open**, which is the one copy mistake
 * docs/project/copy.md calls expensive: they press it, four or five times, and
 * conclude the app is broken. Found by GPT Sol reviewing stages 4 and 5 of
 * docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md, in the input
 * class stage 1 of that plan had not audited.
 *
 * `pdf-` rather than `ai-`, like the two refusals above: no call is made and no
 * money is spent finding out. Both `blocked` rather than `bug` — nothing here is
 * broken and nothing is misconfigured, the file simply cannot be read — and
 * `blocked` is the one non-retryable kind where the reader still has a move,
 * which both of these have: **another copy of the file**. That is why they say
 * so, and why they are two sentences rather than one. "This PDF could not be
 * opened" would be true of both and would leave somebody with a locked file
 * hunting for damage that is not there.
 */
export const PDF_LOCKED: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "This PDF is locked with a password, so there is no way in to read it. Opening it again " +
    "would meet the same lock — a copy saved or exported without the password is what would go " +
    "through. [pdf-locked]",
};

export const PDF_DAMAGED: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "This file could not be opened as a PDF at all: it is damaged, or it is not really a PDF. " +
    "The bytes are the same every time they are read, so this will come back the same way — " +
    "downloading or exporting the document again, and adding that copy, is what would " +
    "help. [pdf-damaged]",
};

export function pdfChunkTooBig(megabytes: number, limit: number): ReaderFacingFailure {
  return {
    kind: "blocked",
    message:
      `Part of this PDF is too large to send to the AI service in one piece — ${megabytes} MB, ` +
      `where ${limit} MB is the most a single request can carry. The file is the same size every ` +
      `time, so this will come back the same way; a PDF with fewer or smaller images in it will ` +
      `go through. [pdf-chunk-big]`,
  };
}

/**
 * **The two ways a chunk of a PDF comes back unusable**, named by their pages.
 *
 * The pages are the point. Both were bare `throw new Error` until 2026-09-03,
 * so the reader was told only that the step did not finish — and for a
 * hundred-page document, *which* pages is the difference between a fault they
 * can see and one they cannot.
 *
 * **The kinds differ, and the difference is whose limit was reached.** A
 * truncated answer is this app's `max_tokens` set too low for those pages,
 * which is `bug` — the same diagnosis and the same wording as
 * `ANSWER_RAN_PAST_ITS_ROOM` above. A safety filter is the service refusing, and
 * refusing the same pages again, which is `blocked`.
 */
export function pdfPagesCutOff(pages: readonly number[]): ReaderFacingFailure {
  return {
    kind: "bug",
    message:
      `The AI service was given less room than pages ${pages.join(", ")} of this document needed, ` +
      `so its reading of them came back cut off and could not be used. That is a limit set ` +
      `wrongly in this app rather than anything about the document or about you: it has been ` +
      `recorded, it needs fixing here, and another go is unlikely to help until it ` +
      `is. [ai-pdf-cut-off]`,
  };
}

export function pdfPagesFiltered(pages: readonly number[]): ReaderFacingFailure {
  return {
    kind: "blocked",
    /* **Not a word of what the service said**, which is rule 4 — its own name
       for the refusal (`RECITATION` and the like) stays in the log. And no
       remedy, because the one the diagnostic offers is *"a smaller chunk
       sometimes gets through"* and the reader cannot choose the chunk size. */
    message:
      `The AI service's safety filter stopped it reading pages ${pages.join(", ")} of this ` +
      `document, so there is no transcription of them to build the article from. It decides that ` +
      `on the words it is shown rather than on anything you did, and shown the same pages it will ` +
      `most likely answer the same way. [ai-pdf-filtered]`,
  };
}

/* ----------------------------------------------------- more than one response -- */

/**
 * **The article needs more room than one model response has**, worked out
 * before the call rather than discovered by it — `TooLongForOnePass` in
 * src/token-budget.ts.
 *
 * The developer half is the exception's own message, which names the two token
 * figures and the doc; it stays on `Error.message`, goes to the log, and is
 * what somebody re-tuning the constants needs. This half is what the reader
 * gets, and it deliberately says nothing about tokens: they did not choose a
 * number and cannot change one.
 *
 * `blocked` rather than `bug`, matching the exception's own declared kind and
 * for its stated reason — a request that cannot pass a size boundary, where the
 * reader's move is a shorter piece.
 */
export const ARTICLE_TOO_LONG_FOR_ONE_PASS: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "This article is longer than this step can handle in one go, and reading a long piece in " +
    "sections is not built yet. Trying again will not help — the article is the same length each " +
    "time — but a shorter piece will work. [ai-too-long]",
};

/**
 * **The answer ran past the room it was given and arrived unfinished**, which
 * is a budget in this app set wrongly rather than anything about the article —
 * `truncationFailure` in src/token-budget.ts.
 *
 * The two audiences docs/project/copy.md recorded and did not split are split
 * here: `truncatedMessage` keeps the arithmetic — how much of the spend went on
 * the answer and how much on the reasoning, which is the thing that took a bug
 * two six-minute runs to work out — and travels on `Error.message` to the log.
 * This sentence is what reaches the card.
 *
 * `bug`, the kind the exception already declared, and the wording keeps its
 * hedge: the model's output varies between calls, so *unlikely* rather than
 * *cannot*. The button is hidden either way, and a hidden button under a claim
 * of certainty is the pair that has to stay honest.
 */
export const ANSWER_RAN_PAST_ITS_ROOM: ReaderFacingFailure = {
  kind: "bug",
  message:
    "The AI service was given less room than this article's answer needed, so what came back was " +
    "cut off and could not be used. That is a limit set wrongly in this app rather than anything " +
    "about the article or about you: it has been recorded, it needs fixing here, and trying again " +
    "is unlikely to help until it is. [ai-over-room]",
};

/* ------------------------------------------------------------------------ quiz -- */

/**
 * **The batch came back without both ends of the scale.**
 *
 * Written inline at its throw site on 2026-09-03 and moved here the next day —
 * inline because at that moment one string had to be both the reader's sentence
 * and the developer's, and the reader won the tie. With the seam split it can
 * be what it should have been: a `ReaderFacingFailure` with a kind and a code,
 * while the band arithmetic goes to the log.
 *
 * The wording is unchanged from the reviewed version, and two phrases in it are
 * load-bearing:
 *
 * - **"survived checking against it"** rather than "the AI service wrote", with
 *   `survived` the count of what got through validation. A draft said "wrote",
 *   which is false the moment anything is dropped: twelve back with seven
 *   unanchored reported that the service wrote five. It is also the panel's own
 *   phrase for the same event (src/web/QuizPanel.tsx), so a reader who meets
 *   both gets one vocabulary. ⟨Sol⟩
 * - **"cover the full range"** rather than "build up from easier to harder":
 *   easy-plus-medium with no hard *does* build up, it just stops short, and a
 *   claim the reader can see is false costs the rest of the sentence. ⟨Sol⟩
 *
 * `gap` is `missingEndsInReaderWords` (src/quiz.ts) — the missing end said to
 * somebody who has never heard of a band. The words `easy` and `hard` appear in
 * it doing ordinary work in an English sentence; the band as a *name* never
 * does, because the panel shows neither band nor value.
 */
export function quizBandsNotSpread(survived: number, gap: string): ReaderFacingFailure {
  return {
    kind: "retry",
    message:
      `Of the questions written for this article, ${survived} survived checking against it — but ` +
      `${gap}, so they would not cover the full range from easier to harder. Writing the ` +
      `questions again usually gets a better spread. [quiz-spread]`,
  };
}

/**
 * **Every question named a passage the article does not contain.**
 *
 * The other way the quiz build refuses a paid answer, and it had the same
 * fault: its sentence was a tally of drop reasons — unanchored, unknown ids,
 * unquoted, malformed, duplicates — which is exactly what somebody debugging
 * the validator wants and exactly nothing a reader can act on. The tally stays
 * on `Error.message`.
 *
 * `retry`, and honestly so: the questions are written afresh each time, and a
 * batch that anchored to nothing is the kind of answer a second call usually
 * does better on.
 */
export const QUIZ_NOTHING_ANCHORED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "None of the questions written for this article could be tied back to a passage in it, so " +
    "there was nothing to check your answers against. Writing the questions again usually " +
    "works. [quiz-unanchored]",
};

/* -------------------------------------------------------------------- glossary -- */

/**
 * **The two ways "Check the web" cannot run**, and they are not the same fact.
 *
 * A lookup is [`explain`](explain.ts) with a different selection: it needs a
 * passage of the article to anchor the question to, and it finds one by walking
 * `entry.blocks` — the occurrences the glossary stage recorded. There are two
 * ways that walk can come back empty, and until 2026-09-04 they shared one
 * sentence, which **named the term and said it "does not appear in this
 * article"**. A reader met that under a row headed with the term, beside the
 * entry's own definition, and reported it as the app denying that the entry
 * existed — which is exactly what it reads like:
 *
 * > it said that the phrase in the glossary when I was checking didn't exist
 * > even though it clearly did, because there was a glossary entry for it and I
 * > can see it right there on the page
 * >
 * > — a reader, 2026-09-04
 *
 * So: two sentences, two codes, and **neither of them names the term**. The
 * failure is rendered inside the selected entry's own row
 * ([`GlossaryPanel.tsx`](web/GlossaryPanel.tsx) § `Looked`), so the name is
 * already on screen a line above — repeating it bought nothing and cost the
 * reader their confidence in the list.
 *
 * **`blocked`, both of them**, which is the kind for *refused, and refused
 * again unchanged*: nothing is broken, nothing is misconfigured, and there is a
 * way through that is not pressing the same button. It changes no behaviour
 * here — the Check-the-web button deliberately does not consult
 * `worthRetrying`, for the reason set out in that function's docstring — so the
 * kind is doing its other job, which is telling `kindOfMessage` what a stored
 * sentence meant.
 *
 * **`GLOSSARY_TERM_NOT_QUOTED` says what was searched for, not why it was not
 * found.** A draft said the article *"names the idea rather than quoting it"*,
 * which is the usual cause and not the only one — a hallucinated entry and a
 * set of aliases too narrow to match are both live possibilities that
 * `buildGlossary` allows for (glossary.ts § `findOccurrences`). All the scan
 * establishes is that no name the glossary holds appears in the piece, so that
 * is what the sentence claims. ⟨Sol⟩
 *
 * **They carry codes, which docs/project/copy.md's *a refusal that is an answer
 * gets no code* rule would not have given them.** The rule is right about
 * `ARTICLE_IS_BUSY`, where a code would have invited a bug report about the
 * system working. It is wrong here, and this bug is the proof: a reader did
 * report it, was right to, and had to paraphrase the sentence — which left
 * three candidate branches to tell apart from prose. Four characters would have
 * ended that in a minute. A refusal a reader may reasonably question gets a
 * code.
 */
export const GLOSSARY_TERM_NOT_QUOTED: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "This entry is here, but none of the words the glossary has for it — the term or its other " +
    "names — appear anywhere in the article, and a check on the web is anchored to a passage of " +
    "the piece. There is no passage to anchor this one to, so pressing the button again will not " +
    "help. [gl-not-quoted]",
};

/**
 * **The glossary outlived the article it was written against.**
 *
 * A reachable state rather than a defensive one: a glossary is *carried* into
 * every new revision (`glossary: "carry"`, [pg-revisions.ts](store/pg-revisions.ts)),
 * so a re-extraction leaves the old list attached to new blocks. It is
 * `GlossaryResponse.stale`, and the panel is already showing the banner that
 * says so when this fires — **which is why the sentence points at that banner's
 * *Find them again*.** It pointed there rather than at *Start again* in the foot
 * because they were different operations and the foot draws progress instead of
 * its buttons while a job is in flight; the banner is the one certainly on
 * screen at the moment this sentence arrives. ⟨Sol⟩ *Start again* has since gone
 * (`Foot` in src/web/GlossaryPanel.tsx), so the banner is now the only thing it
 * could point at — but the reason it was already the right one still holds.
 *
 * **It makes no claim about where the term is used**, and two drafts did before
 * settling here. *"The passage it points at is no longer there"* is false when
 * the block survived and the words did not; *"no longer uses this one where the
 * list says it does"* is false when the list says nowhere, which is exactly the
 * carried-and-empty entry this branch most often meets. A stale list cannot say
 * where — or whether — the piece uses the term, and that is the whole of what is
 * known. ⟨Sol, twice⟩
 */
export const GLOSSARY_OUT_OF_DATE: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "This list of terms was written for an earlier version of the article, so it cannot say " +
    "where — or whether — the piece uses this one. Checking it will not help until the terms are " +
    "found again: the banner at the top of the panel has the button. [gl-stale]",
};

/**
 * **The three ways the glossary's *Look up a term* box comes back empty**, and
 * they are three because they want three different things from the reader.
 *
 * The box is the answer to *"I would like to be able to type into a search box
 * in the glossary for a particular term and for it to look for that term"*
 * (a reader, 2026-09-04, `[SPIDERYARN-READING2-Y]`). It scans the article with
 * `term-match.ts`'s rule — case, plurals and possessives folded, and nothing
 * else — and explains the passage it finds.
 *
 * Written **immediately after** the postmortem whose named class is *collapsed
 * diagnosis* (260904c), on the same code path, so the split is deliberate
 * rather than lucky:
 *
 * 1. {@link ASKED_TERM_ABSENT} — the words are nowhere in the piece, not even
 *    inside a longer one. **Chat is the way through**, because chat may answer
 *    from outside the article and the glossary may not.
 * 2. {@link ASKED_TERM_PART_WORD} — the characters *are* in the piece, but never
 *    with a boundary on both sides. The reader has a move the first case does
 *    not give them: type the word as the piece writes it.
 * 3. {@link ASKED_TERM_NO_PROSE} — there was no prose to search. This one is
 *    **not a claim about the term at all**, and that is why it exists: without
 *    it, an article the extractor left with no text would answer every question
 *    with *"the piece does not use those words"*, which is the reported bug's
 *    exact shape — a confident sentence over an empty scan.
 *
 * **None of them names the term back at the reader.** It is in the box they
 * typed it into, a line above; repeating it is what turned a refusal into a
 * denial last time.
 *
 * **No "did you mean…".** Considered and rejected on 2026-09-04: the shared
 * matcher gives no typo tolerance at all, and the word a reader wants is as
 * often a lowercase idea as a proper noun, so there is no candidate list worth
 * ranking yet. Guessing badly here would be worse than the honest handoff.
 */
export const ASKED_TERM_ABSENT: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "Those words are not in this article — not in that form, a plural or a possessive, and not " +
    "inside a longer word either. The glossary only ever explains what the piece itself says, so " +
    "there is nothing here to explain and asking again will not help. Chat can answer from " +
    "outside the article. [gl-ask-absent]",
};

/**
 * **The characters are there and they never stand on their own** — see
 * {@link ASKED_TERM_ABSENT} for why this is its own sentence.
 *
 * The commonest way to reach it is a stem: *"axiom"* against a piece that says
 * *axiomatic*. (Not *"axi"* against *axis* — a draft of this comment said so and
 * it is false, because `termPattern`'s optional plural makes *axis* a match.
 * ⟨Sol⟩)
 *
 * **It claims exactly what the second scan establishes, and one draft claimed
 * more.** That draft said *"every time inside a longer word"*, and the
 * counterexample is a term with punctuation at its edge: `-bar` against an
 * article that says `foo-bar` fails the bounded scan — the character before the
 * hyphen is a letter — and passes the loose one, yet `-bar` is right there,
 * starting with its own separator. What is true in *every* case this branch
 * fires on is the thing the lookarounds actually tested: a letter or a digit is
 * run up against the characters, on one side or the other. So that is what the
 * sentence says. Claiming a word, or a typo, is the reported bug's own fault in
 * a friendlier tone. ⟨Sol⟩
 */
export const ASKED_TERM_PART_WORD: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "Those characters do turn up in the article, but never standing on their own — every time, a " +
    "letter or a digit runs straight into them, so there is no phrase here to explain and asking " +
    "for the same ones again will not help. Try the words as the piece writes them, or ask chat, " +
    "which can answer from outside the article. [gl-ask-part-word]",
};

/**
 * **Nothing was searched**, so nothing may be concluded about the term.
 *
 * **Reachable by construction, and never yet seen.** `assertSomethingWasProduced`
 * (src/blocks.ts) requires *a* block and not a block with words in it, and
 * figures, images and embeds carry no `text` — so an article of nothing but
 * pictures is storable and the reading view will open a glossary band over it.
 * It has not happened: 0 of 52 revisions in the local corpus on 2026-09-04
 * (`bool_or(text <> '')` over `spideryarn.revision_blocks`).
 *
 * Kept anyway, and the number is the argument rather than against it: the
 * alternative to this sentence is `ASKED_TERM_ABSENT` — a confident claim about
 * the reader's words over a scan that read nothing, which is the reported bug's
 * exact shape.
 */
export const ASKED_TERM_NO_PROSE: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "There is no prose in this article to search, so asking again will not help — and this says " +
    "nothing about the words you typed. [gl-ask-no-prose]",
};

/* ---------------------------------------------------------- placing passages -- */

/**
 * **The three ways the pictures that read passages for meaning can fail** —
 * Force's dotted lines, and Drift and Trail's dots.
 *
 * They arrived here on 2026-08-28, from two sentences written inline in
 * src/routes.ts as `[emb1]` and `[emb2]`. Being outside this file cost more
 * than tidiness:
 *
 * - **Neither code was in `CODE_KINDS`**, so `kindOfMessage` returned `null`
 *   for both. `worthRetrying` reads that as *yes*, which is the safe direction
 *   for an unknown blip and the wrong one for the failure that was actually
 *   happening — an account not allowed to use the model, which no amount of
 *   trying again can fix.
 * - **`monitoring-scrub.ts` reads the same table** to decide whether a sentence
 *   is provably ours and may therefore be sent to Sentry. An unregistered code
 *   is withheld, so the one message that said what was wrong was the one
 *   monitoring could not repeat. ⟨Sol⟩
 *
 * One sentence per `EmbeddingReason` in src/embeddings.ts, and the mapping is
 * `embeddingFailure` below. The reader is never told which of the two `config`
 * causes it was — a key that is missing and an account that may not use the
 * model call for exactly the same thing from them, which is nothing. That
 * distinction is in the log, for the person who can act on it.
 *
 * **"the model that reads passages for what they are about"** rather than "the
 * embedding model": rule 1 in docs/project/copy.md. A reader who came here to
 * read an article has no idea what an embedding is, and does not need one.
 */
export const PLACING_NOT_CONFIGURED: ReaderFacingFailure = {
  kind: "ours",
  /* **It does not say which** — the first draft said "its account is not allowed
     to", and `config` also covers a key that is simply not set. A sentence that
     names a cause its own reason cannot guarantee is a sentence that will be
     wrong on some Tuesday, and the reader's move is identical either way. ⟨Sol⟩
     Which one it was is in the log, for the person who can act on it. */
  message:
    "This app is not set up to use the model that reads passages for what they are about. Nothing " +
    "you can do from here will change that, and trying again will not help until somebody fixes " +
    "it. [ai-embed-account]",
};

export const PLACING_UNREACHABLE: ReaderFacingFailure = {
  kind: "retry",
  /* **"did not answer with anything usable" rather than "could not be
     reached"**, because this covers three things and only one of them is a
     network: a socket that never opened, a deadline of ours, and a 200 carrying
     something that is not vectors. A *refusal* is not here at all — those have a
     status, and `placingFailed` hands them to `providerHttpFailure`, which has
     a sentence for each. ⟨Sol⟩ */
  message:
    "The model that reads passages for what they are about did not answer with anything usable. " +
    "Waiting a few seconds and trying again usually works. [ai-embed-down]",
};

export const PLACING_BUSY: ReaderFacingFailure = {
  kind: "retry",
  /* Ours, and the sentence says so rather than blaming the AI service: this is
     `MAX_INFLIGHT` in src/article-vectors.ts refusing to start a fifth article,
     and nothing upstream has been asked anything. */
  message:
    "This app is already placing passages for as many articles as it can at once. Waiting a few " +
    "seconds and trying again usually works. [ai-embed-busy]",
};

/**
 * Which of the three the reader is shown, from the `reason` on the failure.
 *
 * **A total map rather than a `switch` with a default**, for the reason
 * `RETRYABLE` above gives: a fourth `EmbeddingReason` should not be able to
 * arrive here and fall into whichever branch happens to be last. Adding one
 * fails to compile until somebody writes its sentence.
 *
 * `import type` on `EmbeddingReason`, and that is load-bearing: `embeddings.ts`
 * reaches this module through `ai-call.ts`, so a value import here would close
 * the cycle. Erased at compile time, it creates no edge at all — the same trick
 * and the same reason as `AiJob` in [`ai-call.ts`](ai-call.ts).
 */
const PLACING: Record<EmbeddingReason, ReaderFacingFailure> = {
  config: PLACING_NOT_CONFIGURED,
  provider: PLACING_UNREACHABLE,
  busy: PLACING_BUSY,
};

/**
 * **A refusal with a status is answered by the status, not by the reason.**
 *
 * `provider` covers everything the upstream can do wrong, and the first version
 * of this mapped all of it to one retryable sentence — so an invalid key,
 * exhausted credit, a 403 and a payload too big were each answered with *"waiting
 * a few seconds and trying again usually works"*. That is precisely the mistake
 * this whole change was written to stop, reintroduced one layer up. ⟨Sol⟩ found
 * it by running the statuses rather than by reading the claim.
 *
 * The fix is not a fourth reason. `providerHttpFailure` has mapped a status to
 * the right kind and the right sentence since long before this feature existed,
 * and it is exhaustive where a reason cannot be: 402 is `ours`, 403 and 413 are
 * `blocked`, 429 and 5xx are `retry`. Deferring to it is one line and no new
 * vocabulary.
 *
 * What is lost is the mention of *placing passages* — and it is not lost to the
 * reader, because the two pictures say which of them failed before showing this
 * sentence (`DiagramPanel.tsx`). The server's half is about the failure; the
 * client's half is about the feature.
 */
export function placingFailed(
  reason: EmbeddingReason,
  status: number | null = null,
): ReaderFacingFailure {
  if (reason === "provider" && status !== null) return providerHttpFailure(status);
  return PLACING[reason];
}

/**
 * The database would not do what the app asked of it.
 *
 * **The second widening of this file, and the reason is not the reader — it is
 * the store.** `UNEXPECTED_FAILURE` above widened it from model calls to any
 * failed request; these two go further, and exist because a Drizzle error's
 * `message` is
 *
 *     Failed query: insert into "comments" … values ($1, $2, …)
 *     params: <every bound value>
 *
 * — which here means the reader's selected quote and the model's whole answer.
 * That message went to the client, to the log, and into the row's own `error`
 * column, from where the next failed query flattened it in one level deeper.
 * So `src/store/db-errors.ts` translates every error leaving a Postgres store
 * into one of these two, and the untranslated one never leaves the seam.
 *
 * Two rather than one because the reader's next move genuinely differs, and the
 * SQLSTATE says which: a connection that dropped or a deadlock that lost is a
 * blip, and a constraint that refused the row will refuse it again for ever.
 * Guessing "retry" for both would have somebody clicking at a foreign key.
 */
export const STORAGE_BUSY: ReaderFacingFailure = {
  kind: "retry",
  message:
    "This app could not reach its database just then, so that did not go through. It is usually a " +
    "moment's trouble rather than anything lasting — waiting a few seconds and trying again " +
    "generally works. [db-busy]",
};

/* ---- uploading a file. docs/plans/260826u-pdf-upload-and-storage.md ------------- */

/**
 * Too big, refused before the upload starts rather than after it finishes.
 *
 * `blocked`: the same file is the same size next time, so a Retry under this
 * would be a button that cannot work — the mistake docs/postmortems has a whole
 * file about. The size is named because "too big" without a number leaves the
 * reader guessing whether to try a slightly smaller one.
 *
 * It deliberately does **not** say "nothing was uploaded". That is true of the
 * check before the grant is minted and false if the bucket refuses mid-transfer,
 * and a sentence that is sometimes false is worse than one that never claims it.
 */
export const UPLOAD_TOO_BIG: ReaderFacingFailure = {
  kind: "blocked",
  message:
    `That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB, which is the most ` +
    "this app can take. Sending it again will not help — it will be the same size. A smaller " +
    "file, or a shorter extract from this one, will. [up-big]",
};

/**
 * The bytes are not a PDF, whatever the file is called.
 *
 * `blocked` for the same reason: renaming a file does not change what is in it.
 * Phrased around the *contents* rather than the name, because a `.pdf` that is
 * really something else is exactly the case this catches, and telling somebody
 * their PDF is not a PDF without saying why reads like a bug.
 */
export const UPLOAD_NOT_A_PDF: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "That file isn't a PDF inside, whatever its name says. Sending it again will not help, " +
    "because it will be the same file — but if it opens in a PDF reader, saving it again from " +
    "there usually produces one this app can read. [up-pdf]",
};

/**
 * What arrived is not what was sent.
 *
 * **`blocked`, and it was `retry` until 2026-08-27** — which was written with
 * the right instinct and the wrong subject. Trying again *is* the right move
 * here: a mismatch means the transfer was damaged, and transfers usually
 * succeed. But `kind` does not answer "should the reader try again", it answers
 * "will the **Retry button on this job card** help", and it will not: Retry
 * re-runs the steps that did not finish, and this step would read the same
 * damaged object out of the same staging key and refuse it again, for ever.
 *
 * The distinction is the whole of docs/postmortems/260826a-toc-max-tokens.md — a button
 * that cannot work — and it only became visible when the acquisition step was
 * built, because until then nothing could press it. So the sentence says what
 * to do instead, the way `UPLOAD_TOO_BIG` does: a *new upload*, not another go
 * at this one. Says whose problem it is too — nobody's fault here, not the
 * reader's file — because the natural reading of "checksum" is that the file is
 * broken.
 */
export const UPLOAD_CHECKSUM: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "The file that arrived isn't quite the file that was sent, so something went wrong on the " +
    "way. Running this again will not help — it would read the same damaged copy. The file " +
    "itself is fine: choosing it again usually works. [up-sum]",
};

/**
 * We never received it, or it sat too long.
 *
 * `blocked` for the same reason as `UPLOAD_CHECKSUM` above, and changed at the
 * same moment: there is nothing at that key, so re-running the step that looks
 * there finds nothing again. What helps is choosing the file once more, which
 * mints a fresh grant at a fresh key.
 *
 * Two hours is the grant's life and it is Supabase's number, not ours
 * (src/source.ts). Named in the sentence because "it expired" without a
 * duration tells the reader nothing about whether they were slow or we were
 * broken.
 */
/**
 * **The bytes are still on their way.**
 *
 * The readiness gate's refusal: `POST /api/jobs {uploadId}` asks Storage
 * whether the staging object is there, and answers this when it is not. Nothing
 * is claimed, nothing is queued, and no quota slot is spent — so unlike every
 * other refusal on that route, this one costs the reader nothing and is
 * expected to be temporary.
 *
 * It exists because the reader now reaches `/add/upload/<id>` at byte zero
 * rather than at the last byte (docs/plans/260903j-background-pdf-upload-so-add-does-not-wait.md).
 * Reloading that page, or opening it in a second tab, used to be impossible
 * before the file had landed and is now the ordinary thing to do — and without
 * this the job was queued over an object that was not there, which
 * `acquireUpload` answers with `UPLOAD_MISSING`, terminally. A reader's own
 * reload destroyed their upload.
 *
 * **`retry`, where no other `up-` code is.** Another go is precisely what helps,
 * and the page does it for them: it waits, and posts again when
 * `GET /api/uploads/:id` says the object has arrived. (It said "the other three"
 * until 2026-09-04, when there were six; see the tally note in `CODE_KINDS`.)
 *
 * **It names another go even though the page takes it for the reader**, because
 * `tests/messages.test.ts` requires every `retry` sentence to say what would
 * help — and the requirement is right here rather than merely satisfied: this
 * message reaches a person only when the automatic wait is not running, which
 * is exactly when pressing the button is the thing to do.
 */
export const UPLOAD_STILL_ARRIVING: ReaderFacingFailure = {
  kind: "retry",
  message:
    "That file is still on its way — nothing has been lost. Trying again in a moment will " +
    "work, and this page does that for you as long as a Spideryarn tab stays open. [up-wait]",
};

export const UPLOAD_MISSING: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "That file never finished arriving. An upload has two hours to complete, so a very slow " +
    "connection or an interrupted one will do this. Running this again will not help — there is " +
    "nothing there to read. Choose the file again. [up-gone]",
};

/**
 * **The page cap, as the upload record states it** — and, as it stands, **a
 * sentence no reader ever sees.** Read this before editing it.
 *
 * `RejectReason` maps an enum to a *static* failure (src/source.ts), so nothing
 * on that side can say "142 pages"; the number is only known where the counting
 * happened. So the record takes this, and the job — the thing the reader is
 * actually looking at — takes `pdfTooManyPages`, which names the count and the
 * limit. Splitting them is what lets the state machine record *why* an upload
 * was refused without either half inventing a number it does not have.
 *
 * **The limit is in this sentence and the count is not, which is the cost of it
 * being static.** Until 2026-09-04 neither was: `MAX_PAGES` lived in
 * src/pdf-read.ts, which pulls in pdf.js and p-queue, and this module is
 * imported by the browser. It is in src/uploads.ts now — beside
 * `MAX_UPLOAD_BYTES`, which this module has always named — so the limit can be
 * stated here. The *count* still cannot, because a static value cannot know it;
 * that is why `pdfTooManyPages` takes both as arguments.
 *
 * `blocked` for the same reason as the ones above it: the file has the same
 * number of pages every time it is counted.
 *
 * ## Unreachable, deliberately, and kept anyway ⟨GPT Sol, 2026-09-04⟩
 *
 * Both queue origins persist and render `pdfTooManyPages(count, limit)` — the
 * browser run confirmed the reader sees `[pdf-pages]` — and the upload endpoint
 * exposes only the raw `RejectReason` enum, which nothing renders through
 * `rejectionMessage`. `refuseAnOverlongPdf` (src/pipeline.ts) does not even go
 * through `acquireUpload`'s `refuse`: it writes the reason onto the row itself,
 * precisely so the *job* can carry the better sentence. So this paragraph is
 * live copy with no live reader.
 *
 * **Deleting it costs more than keeping it, which is the whole argument.**
 * `REJECTIONS` is `Record<RejectReason, ReaderFacingFailure>` — total by type —
 * and `REJECT_REASONS` is derived from it, so removing this entry means either
 * making the map partial or hand-writing a second list. That totality is a real
 * safety property: it is what makes a *new* reject reason with no sentence, no
 * code and no kind fail the compiler, which is the failure
 * docs/postmortems/260826a-toc-max-tokens.md is about and the one
 * `too-many-pages` itself nearly repeated. Trading a constraint for a deleted
 * paragraph is the wrong way round.
 *
 * **So it stays, and the risk is named rather than removed:** the risk is
 * *drift* — this sentence and `pdfTooManyPages` describing the same refusal
 * differently, with nothing to notice, because the invariants in
 * tests/messages.test.ts and tests/source.test.ts check its code and its kind and
 * cannot check whether it still agrees with its twin. **Edit the two together.**
 * If the upload endpoint ever renders a rejection reason, this is the sentence
 * it renders, and the drift stops being theoretical.
 */
export const UPLOAD_TOO_MANY_PAGES: ReaderFacingFailure = {
  kind: "blocked",
  message:
    `That PDF has more than the ${MAX_PAGES} pages this app takes in one document. That is a ` +
    "limit on what reading a document is allowed to cost rather than a technical one, so the " +
    "same file will come back the same way — a shorter document, or the part of this one you " +
    "actually want, will go through. [up-pages]",
};

/**
 * This installation cannot take uploads at all.
 *
 * Not a failure of the reader's file, and not a transient one. **Two different
 * things can be missing**, and the sentence covers both rather than naming
 * either, because the reader can act on neither:
 *
 *  - no object store for the browser to write to (no Supabase credentials), and
 *    there is no way to fake one from a server that refuses request bodies over
 *    4.5 MB — see src/store/blobs.ts;
 *  - or a store, but nowhere to *remember* the upload between the two requests
 *    it takes, which is a serverless function's filesystem — see
 *    `recordsSurviveTheRequest` in src/upload-records.ts.
 *
 * The second is the one worth refusing loudly: everything about it works right
 * up until the reader has spent minutes sending an 11 MB file, and then answers
 * "no such upload". A limitation said at the door is a limitation; the same
 * limitation found at the end is [a silent success](docs/reusable/silent-success.md).
 *
 * `ours`, because nothing refused anything — this server is short a setting.
 */
export const UPLOAD_UNAVAILABLE: ReaderFacingFailure = {
  kind: "ours",
  message:
    "Uploading isn't switched on here — this server isn't set up to take a file yet. Trying " +
    "again will not help until somebody finishes setting up its file storage. A web page still " +
    "works: paste its address in the box above instead. [up-off]",
};

/** @see STORAGE_BUSY — the other half, for a database that answered "no". */
export const STORAGE_FAILED: ReaderFacingFailure = {
  kind: "bug",
  message:
    "This app asked its database for something it would not do, so that did not go through. That is " +
    "a bug here rather than anything you did, and trying again will not help until somebody fixes " +
    "it. It has been recorded. [db-failed]",
};

/* ── Checking whether there is a newer one ────────────────────────────────── */

/**
 * **A re-read that failed behind something that is still on screen.**
 *
 * The thread page reads `GET /api/tweets/:slug` on mount, and again whenever a
 * job that writes a thread finishes. This sentence is for the second one: it
 * runs behind a page the reader is already looking at, so its failure must not
 * take that page away — src/web/Tweets.tsx keeps what it has and says this
 * beside it.
 *
 * It is here because the first version of that guard interpolated
 * `(err as Error).message` into a sentence written inline in the component, and
 * in the commonest case that message is the browser's own *"Failed to fetch"*.
 * A raw exception is worse than the HTTP status docs/project/copy.md's first
 * rule already rejects: a status at least describes something that happened to
 * a request. The raw message now goes to the browser console, where whoever can
 * act on it will see it — the same split src/web/lib/api.ts already makes for
 * every failure it builds. Found by a GPT Sol review, 2026-08-28.
 *
 * ## It has to be true with no thread on screen as well as with one
 *
 * The reader can be looking at either. A 404 leaves the page saying nobody has
 * written a thread yet, and *a job having just written one* is exactly when
 * this re-read runs — so the absent thread is the claim most likely to be out
 * of date, not the least. Hence "what is on this page" rather than "the posts
 * below", which would describe an empty page in the case that matters most.
 *
 * ## A const, not a factory taking a noun
 *
 * The glossary, the quotes and the ideas all reload behind what is on
 * screen, so `recheckFailed(noun)` is the obvious shape. It is the wrong one:
 * two nouns are two different sentences sharing one code, and *that* is the one
 * thing tests/messages.test.ts forbids outright — a code names a branch, and a
 * code that names two is no use to whoever is being quoted it. A second surface
 * that wants this wants its own sentence and its own code.
 *
 * `retry`, and not a close call. Nothing refused anything, nothing here is
 * misconfigured, and reloading the page really is the fix.
 */
export const THREAD_RECHECK_FAILED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "This app could not check whether there is a newer thread for this article, so what is on this " +
    "page may not be the latest. Nothing has been changed or lost — reloading the page tries " +
    "again. [rd-recheck]",
};

/** The overall deadline fired. `seconds` is that deadline, not elapsed time. */
export function tookTooLong(seconds: number): ReaderFacingFailure {
  return {
    kind: "retry",
    message:
      `The AI service did not finish within ${seconds} seconds, so this app stopped waiting. ` +
      "Long articles and complicated questions take longer; trying again, or asking something " +
      "narrower, usually gets there. [ai-slow]",
  };
}

/** The stream went quiet. Different from slow: nothing arrived at all for a while. */
export function wentQuiet(seconds: number): ReaderFacingFailure {
  return {
    kind: "retry",
    message:
      `The answer stopped arriving part-way through and nothing more came for ${seconds} seconds, ` +
      "so this app stopped waiting. That is usually the connection rather than the article. " +
      "Trying again starts a fresh answer. [ai-stalled]",
  };
}

/**
 * The request went out and nothing came back — not an error, not a status, not
 * a header.
 *
 * Its own message rather than `ENDED_UNFINISHED`, because nothing ended: the
 * answer never started, so there is no partial text on screen and telling the
 * reader that "what did arrive is real" would be describing an empty row. This
 * is the reader's own connection or something between it and us, and a retry
 * genuinely is the thing to do.
 *
 * Raised by the client rather than the server — see `OPEN_TIMEOUT_MS` in
 * src/web/useChat.ts, which exists because a `fetch` that never resolves was
 * the last way left to strand an answer on "thinking…" for ever.
 */
export const NO_RESPONSE: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The question was sent and nothing came back at all, so this app stopped waiting. That is the " +
    "connection rather than the article or the AI service. Trying again is usually all it takes. " +
    "[ai-no-response]",
};

/**
 * The connection ended mid-answer, with no sign it had finished.
 *
 * Same correction as `PROVIDER_FAILED_MID_ANSWER` above, for the same reason:
 * not every caller has been showing the reader words as they land.
 */
export const ENDED_UNFINISHED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The answer stopped arriving before it was finished — the connection ended early. What did " +
    "arrive is real, it is just not all of it. Trying again starts a fresh answer. [ai-cut-off]",
};

/**
 * The model asked for a tool and the request for it arrived in pieces we could
 * not put back together.
 *
 * Its own message rather than `ENDED_UNFINISHED`, because the two send a reader
 * to different places. That one is a connection dying, which is the network. This
 * is a well-formed response whose tool call did not survive reassembly — nothing
 * is wrong with the reader's connection, and a retry genuinely is likely to work
 * because the next stream will be framed differently.
 *
 * It exists at all because the alternative was storing whatever preamble had
 * arrived ("Let me check that for you.") as a finished answer. See
 * docs/project/chat-tools.md.
 */
export const TOOL_CALL_LOST: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The AI service started to look something up and the request for it arrived garbled, so this " +
    "app stopped rather than answer from half of it. Trying again usually works. [ai-tool-lost]",
};

/**
 * The model spent its last chance asking for another tool instead of answering.
 *
 * Chat withholds our tools on the final round, and tells it so, in the hope of
 * prose. Withholding alone removes the *schema*; it does not remove the pattern,
 * and by that point the model is looking at three of its own turns full of tool
 * calls. A model that has been searching for three rounds can and does ask for a
 * fourth, and there is nothing on the other end to answer it.
 *
 * Its own message because the alternative was `saidNothing` — *"finished without
 * saying anything at all"* — which is not true and sends the reader to the wrong
 * place. It did say something. It asked for a tool nobody could give it, and the
 * app threw the request away. Telling somebody their question came back blank
 * when it actually came back mid-search is the kind of wrong sentence that costs
 * an afternoon. See docs/project/chat-tools.md.
 *
 * `retry` because the next attempt is a different sample and may go another
 * way. **"May", not "usually"** — nobody has watched this happen enough times to
 * say how often a plain retry gets there, and a message that promises a rate we
 * have not measured is the same overclaim as `[ai-empty]`'s *"asking again
 * usually gets an answer"*, which is the sentence this one exists to stop being
 * said. The advice a reader can actually act on is the second half: a narrower
 * question needs fewer searches to answer. Wording corrected after a GPT Sol
 * review, 2026-08-26.
 */
export const KEPT_ASKING_FOR_TOOLS: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The AI service spent this whole answer looking things up and never got to the answer itself. " +
    "Trying again may work; asking about one thing at a time works better. [ai-tool-loop]",
};

/**
 * **A safety filter stopped the model**, whether it had written anything first
 * or not.
 *
 * `blocked`, not `retry`, and the sentence says less than it used to on
 * purpose. It used to explain the refusal — "quoted material it reads as
 * harmful out of context" — which we do not know and cannot check. Telling a
 * reader a confident story about why a safety filter fired is worse than
 * telling them it fired, because it is the kind of claim they have no way to
 * test and might repeat.
 *
 * A const rather than a branch inside `saidNothing`, because `finish_reason:
 * "content_filter"` also arrives *after* some text — a mark two sentences in
 * when the filter caught something — and that is the same fact told to the
 * reader the same way. One copy, so the two cannot drift into two accounts of
 * one event. src/quiz-mark.ts is the second caller.
 */
export const FILTER_STOPPED_IT: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "The AI service stopped itself answering this one — its safety filter caught something, and " +
    "it does not tell us what. Asking the same thing again will get the same result; asking about " +
    "a smaller piece of the article sometimes works. [ai-filtered]",
};

/**
 * **A mark that ran into the ceiling and stopped mid-sentence.**
 *
 * Its own sentence rather than `ANSWER_OVERFLOWED`, and the difference is the
 * advice rather than the diagnosis. That one ends *"asking for something
 * narrower usually fits"*, which is a lever the person who asked the question
 * can pull. Here the reader asked nothing — they answered a question the
 * article put to them — so there is nothing of theirs to narrow, and telling
 * them to narrow it would send them to a control that does not exist.
 *
 * `retry` because the ceiling is ours (`MARK_MAX_TOKENS`, src/quiz-mark.ts) and
 * generous: a reply that hit it is a model that went long this once, not a
 * request that cannot fit. The next sample is usually shorter.
 */
export const MARK_CUT_OFF: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The reply about your answer ran past the room it had and stopped part-way, so it is not a " +
    "whole mark. Trying again usually gets one that fits. [ai-mark-cut-off]",
};

/** The call succeeded and the model said nothing. */
export function saidNothing(finishReason: string | null): ReaderFacingFailure {
  if (finishReason === "content_filter") return FILTER_STOPPED_IT;
  /* `blocked`, not `retry`, and the reasoning has to match 413's or one of them
     is wrong. 413 is `blocked` because resending an unchanged request sends the
     same too-large thing. This is the same situation arriving by another door:
     the input ate the whole budget and nothing came out. The sentence never
     invited a retry anyway — its only advice was to ask about less — so with
     `retry` the button and the prose disagreed, and the button was the one the
     reader could act on. */
  if (finishReason === "length") {
    return {
      kind: "blocked",
      message:
        "The AI service ran out of room before it wrote anything, which usually means it was given " +
        "too much at once. Sending the same thing again will hit the same ceiling; asking about a " +
        "shorter stretch of the article should get an answer. [ai-no-room]",
    };
  }
  return {
    kind: "retry",
    message: "The AI service finished without saying anything at all. Asking again usually gets an answer. [ai-empty]",
  };
}

/* ── Signing in ────────────────────────────────────────────────────────────────
 *
 * The five sentences a reader can meet on the way in. They were inline in
 * SignInControls.tsx and AuthCallback.tsx until 2026-08-27, when GPT Sol
 * pointed out that docs/project/copy.md says every failure message lives here
 * and registers its kind — and that the rule had been written for model calls
 * and then quietly not applied to the one screen a reader meets *before* any
 * model call exists.
 *
 * The `kind` is doing real work on this handful. The provider-off one is
 * `ours` — nothing the reader does will help, and the sentence has to say so
 * rather than invite a retry that cannot succeed, which is the mistake
 * copy.md exists to stop.
 */

/**
 * The provider is switched off on this Supabase project.
 *
 * Written the day the live site returned Supabase's own
 * `{"msg":"Unsupported provider: provider is not enabled"}` as a bare page of
 * JSON, because `signInWithOAuth` navigates rather than requests and there was
 * nothing of ours left on screen. See `googleSignInAvailable` in
 * src/web/lib/supabase.ts and docs/plans/260827i-google-sign-in-production.md.
 *
 * `ours`, not `retry`: pressing the button again will do exactly this again.
 * The sentence has to hand the reader the door that *is* open.
 */
export const AUTH_PROVIDER_OFF: ReaderFacingFailure = {
  kind: "ours",
  message:
    "Signing in with Google is not switched on for this site yet — nothing you did, and pressing it " +
    "again will not help. Use an email address and password below instead. [auth-provider]",
};

/**
 * The reader pressed cancel, or the provider declined. Not a failure of ours.
 *
 * `retry` rather than `blocked`, which is the opposite of how it first reads. A
 * cancel is not a refusal that will repeat — the reader chose it, and choosing
 * differently is the whole of the fix.
 */
export const AUTH_DENIED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "You cancelled, or the sign-in was declined. Nothing has changed — press the button again when " +
    "you are ready. [auth-denied]",
};

/**
 * The provider sent us back an error code.
 *
 * **Provider-neutral, which it was not until 2026-08-27.** Both branches said
 * "Google", and `signUp` sends its confirmation link to the same callback — so
 * an expired email confirmation told the reader that Google had refused
 * something Google had never been asked. Sol found it reviewing a change two
 * files away.
 *
 * The code is ours to show and is quotable in a bug report. `error_description`
 * deliberately is not: it is the provider's own text, and copy.md's fourth rule
 * is a privacy rule rather than a style one.
 */
export function authProviderRefused(code: string): ReaderFacingFailure {
  return {
    /* `retry`, because we do not know what the code means and the honest advice
       is another go. `blocked` would put "this will fail identically" in front
       of a reader whose session merely expired. */
    kind: "retry",
    message: `That sign-in was refused (${code}). Try again, or use an email address. [auth-oauth]`,
  };
}

/**
 * The one-time code did not exchange.
 *
 * The commonest real cause is a PKCE verifier that is not in this browser — the
 * sign-in was started somewhere else, or storage was cleared in between — so
 * the advice is the one thing that actually fixes it.
 */
export const AUTH_EXCHANGE_FAILED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "That sign-in could not be completed. If you started it in another browser or window, start " +
    "again in this one. [auth-exchange]",
};

/** A sign-up that needs its email confirming before it will work. Not an error. */
export function authConfirmationSent(email: string): string {
  return (
    `Check ${email} for a confirmation link. The account will not work until you have clicked it. ` +
    "[auth-confirm]"
  );
}

/* ── A shared document ─────────────────────────────────────────────────────────
 *
 * **None of these is a failure, and none of them carries a bracketed code.**
 * Everything above this line is something that went wrong; everything below it
 * is the app describing a boundary that is working exactly as intended. A
 * `[code]` on one of these would be a support reference for a non-event, and
 * `kindOfMessage` would then be asked to classify a sentence that has no kind —
 * so they are plain strings, the shape `authConfirmationSent` above already
 * uses. docs/project/copy.md's four rules still apply; only the code does not.
 *
 * They are here rather than beside the components for the reason copy.md gives
 * for the rest of the file: **the sentences a reader sees live in one place.**
 * These are the ones a stranger meets, which makes them the sentences most
 * likely to be the only thing anybody ever reads of this app.
 *
 * The three distinct sentences below must not blur into one, and there is a
 * worked example of what happens when they do. Unpublishing a Notion page makes
 * every old link land on a plain *"page could not be found"* — never existed,
 * was unshared, and you may not see it, all answered identically. The products
 * that get it right name the cause: Loom says *"Due to the privacy settings for
 * this video, it cannot be played here at this time"*, Google Docs pairs
 * *"View only"* with *"Request edit access"*.
 * docs/research/260828a-public-access-how-others-do-it.md.
 *
 * **"Visitor" means anyone who does not own the document** — signed out, or
 * signed in and reading somebody else's. They get the same sentences, which is
 * the point: the question is *is this mine*, never *am I signed in*.
 * docs/plans/260827ai-public-read-only-access.md.
 */

/**
 * The label on the read-only bar. Two words, and they are Google Docs'.
 *
 * The one literal, persistent, non-dismissible read-only label the research
 * found in the wild — everybody else communicates read-only-ness by what is
 * *missing* from the chrome, which is no use at all to a stranger who has never
 * seen the editable version and has no baseline to notice an absence.
 *
 * A label, not a call to action, and **not dismissible**: it is a statement
 * about what this page is, not a notification about something that happened.
 */
export const VIEW_ONLY = "View only";

/**
 * What that label means, in the one sentence the bar has room for.
 *
 * **It said *"Somebody shared this article with you"* until 2026-09-04**, and
 * that sentence assumed a person had sent this reader a link. Since
 * `GET /api/public/library` and the shelf at `/read/public`, a visitor may well
 * have arrived from a list nobody pointed them at — so the old opening was
 * false for exactly the readers the shelf was built to bring, and it told them
 * they had a relationship with somebody they do not have.
 *
 * *Shared publicly* rather than *listed on the public shelf*: naming a page the
 * visitor has not seen is an invitation with no context, and the second
 * sentence — untouched, because it was always the part doing the work — already
 * tells them what they have got. GPT Sol found this, and the neighbouring
 * worktree that owns the visitor's copy agreed the wording.
 */
export const SHARED_WITH_YOU =
  "This article was shared publicly. The whole piece is here to read, at every zoom level.";

/**
 * The ask, and it is to join rather than to unlock this page.
 *
 * The New York Times' own reported figure is that free registration lifted paid
 * conversion by more than 40%, ahead of any change to the meter; Substack
 * pitches the ongoing free thing rather than the one document. So the ask is
 * *"make a free account"*, and every place it appears sits next to the specific
 * thing the visitor has just found they could not do — never a banner the eye
 * stops seeing.
 */
export const MAKE_AN_ACCOUNT = "Make a free account";

/* ── When we cannot tell whose this is ─────────────────────────────────────────
   Four sentences for one state: the reader has a session the browser still
   believes in, and `GET /api/article/:slug` answered 401 anyway — after
   `apiFetch` had already refreshed once and retried once (src/web/lib/api.ts).

   A 401 is *we do not know whose this is*, and it says **nothing** about
   whether the piece is world-readable, so the public route is still asked and
   both answers decide. The two arms below are the two rows of that table, and
   they carry different actions because the same two lines — a local sign-out
   and a reload of this address — land the reader somewhere different in each.
   docs/plans/260902j-public-read-only-access-audit-and-improvements.md § C3. */

/**
 * **Shared, and the session could not be confirmed.**
 *
 * Beside `SHARED_WITH_YOU` rather than instead of it: both are true, and the
 * one the reader arrived for is still the piece in front of them. It is written
 * as *what you are getting* rather than *what went wrong*, because the outcome
 * — the whole article, read-only — is the same thing a stranger with the link
 * gets, and that is not a failure.
 */
export const SESSION_UNCONFIRMED =
  "We couldn't confirm that you're signed in, so you're reading this the way anyone with the link would.";

/**
 * The same fact, small enough for the sticky chip.
 *
 * The chip is the only read-only chrome that survives a narrow window with a
 * mode band open (src/web/PublicChrome.tsx § SharedNotice), so the *fact* has to
 * fit here even though the action cannot.
 */
export const SESSION_UNCONFIRMED_CHIP = "sign-in unconfirmed";

/**
 * The action beside `SESSION_UNCONFIRMED`, and the label is the honest one.
 *
 * Signed out at `/read/:slug` the app does not show sign-in — it goes straight
 * back through `ArticlePage` with no reader (src/web/App.tsx), so on a shared
 * article this reload returns the reader to this same page as an ordinary
 * visitor. Calling it *"sign in again"* would be a button that does not do what
 * it says; GPT Sol caught exactly that in the first draft of this fix.
 */
export const CONTINUE_SIGNED_OUT = "Continue signed out";

/** The heading of the whole page for the other row: 401, and not shared either. */
export const REAUTH_REQUIRED_HEADING = "We couldn't confirm your sign-in";

/**
 * **And it must not say whether the document exists.**
 *
 * Same rule as `NOT_SHARED`: a slug you do not own is a 404 and never a 403.
 * Here we know even less — a 401 leaves us unable to say whose it is — so the
 * sentence claims nothing about the article at all, only about the session.
 */
export const REAUTH_REQUIRED =
  "Your session couldn't be confirmed, so we can't tell whether this document is yours. Sign in again and you'll come back to this page.";

/**
 * And here the label *is* honest, for the opposite reason.
 *
 * The same reload on an unshared address reaches `LandingPage`, which draws the
 * sign-in controls itself and leaves the address in the address bar — so
 * signing in lands the reader back here (src/web/auth-return.ts).
 */
export const SIGN_IN_AGAIN = "Sign in again";

/**
 * **The artefact was never built.** The first of the three, and the only one
 * with no precedent anywhere: none of the products researched has a pipeline
 * that can simply not have run.
 *
 * Greg's rule, 2026-08-27: *see what has been generated; be told plainly about
 * what hasn't.* This is the second half, and it is as much of the work as the
 * first — a gap where a glossary would be teaches a visitor that the feature is
 * broken.
 *
 * **It is the only artefact sentence now.** Two others stood beside it until
 * slice 1b: *"There is a glossary for this piece, but a shared link does not
 * carry it yet"*, and *"A shared link does not carry a glossary yet"* for when
 * a second request had failed and we did not know which of the two was true.
 * A shared link carries all four artefacts now, and there is no second request
 * to fail, so both were deleted with the `VisitorGap` members that produced
 * them — src/web/visitor.ts. A sentence with no cause is one that gets shown by
 * mistake.
 *
 * `noun` is a noun phrase with its article: `"a glossary"`, `"a summary"`.
 */
export function notBuiltYet(noun: string): string {
  return `Nobody has built ${noun} for this piece yet.`;
}

/**
 * **Somebody built it and it came back with nothing in it.**
 *
 * The state absence cannot express: *there is no glossary key on this payload*
 * is a different fact from *there is one and its list is empty*. The first
 * means nobody has run the step; the second would mean somebody ran it and it
 * found nothing.
 *
 * **No artefact in the database is in that second state, and none can be.** All
 * three builders refuse to write an empty result, each with the same reason
 * spelled out beside the throw — src/glossary.ts § buildGlossary,
 * src/ideas.ts, src/tweets.ts: *writing it would make the
 * step report done for ever after.* There were four until src/summarise.ts went
 * with Summary mode on 2026-08-31. Checked against every stored artefact on
 * 2026-08-29; every one is absent or non-empty.
 *
 * So this sentence is **insurance, not a screen anybody reaches today**, and it
 * is left in with that said out loud rather than deleted, because the three
 * throws are one refactor away from being relaxed for an article that genuinely
 * has no jargon — and the failure mode if they are is the client calling the
 * owner a liar about their own pipeline.
 * docs/plans/260827ai-public-read-only-access.md § The state that cannot happen.
 *
 * `noun` is capitalised and carries its article: `"A glossary"`, `"A summary"`.
 */
export function builtButEmpty(noun: string): string {
  return `${noun} was built for this piece, and it came back with nothing in it.`;
}

/**
 * **It exists, it costs money, and it belongs to somebody.** Chat, search,
 * review, asking about a passage: every one is a model call, and Greg's third
 * decision is that a logged-out visitor causes none.
 *
 * ## It said "for signed-in readers" and that was wrong for half its audience
 *
 * A visitor is *anyone who does not own the document* — signed out, or signed
 * in and reading somebody else's. Telling the second kind that a feature is
 * "for signed-in readers" tells them to do a thing they have already done, and
 * signing in leaves them on exactly this page. GPT Sol, 2026-08-28.
 *
 * So the wording is **ownership-neutral**: it names whose the feature is rather
 * than what the reader is missing, which is true for both kinds of visitor and
 * stays true when stage 3 lets a second reader hold the same article.
 *
 * `feature` is capitalised, because it names a control the visitor just
 * pressed: `"Chat"`, `"Search"`.
 */
export function ownersOnly(feature: string): string {
  return `${feature} is for whoever added this article — asking costs a model call, and a shared link spends nobody's money.`;
}

/**
 * **It is somebody's, and it is not yours.** The comments, the conversations
 * and the searches on a document belong to whoever added it.
 *
 * Greg's fifth decision, 2026-08-27: a public visitor sees *none* of the
 * owner's annotations. "Share this along with my questions" is a separate,
 * later, opt-in switch, so this sentence is about a boundary rather than about
 * a missing feature.
 */
export function readersOwnWork(plural: string): string {
  return `${plural} belong to whoever added this article. A shared link carries the piece, never anybody's notes about it.`;
}

/**
 * **The document is not shared** — the 404, for somebody signed in.
 *
 * A stranger gets the landing page instead, exactly as they do at every other
 * address they are not entitled to; a signed-in reader has already proved they
 * are a person, so there is nothing left to protect by showing them the pitch
 * rather than the answer.
 *
 * **It must not confirm that the document exists.** The rule already holds for
 * signed-in readers — a slug you do not own is a 404, never a 403 — and it
 * holds here for the same reason. Hence the conditional second sentence: it
 * tells somebody who was sent a link what to do without telling somebody
 * guessing slugs whether they guessed right.
 */
export const NOT_SHARED =
  "This document isn't shared. If somebody sent you the link, ask them to turn sharing on for it.";

/* ── An address that is nobody's ───────────────────────────────────────────── */

/**
 * **The heading of the 404 page** — src/web/NotFoundPage.tsx.
 *
 * *"There's nothing at this address"* and not *"Page not found"*: the reader is
 * not looking for a page, they are looking at an address bar with something
 * wrong in it, and the address is the thing they can act on. It also happens to
 * be true of the two cases the words have to cover at once — a link that was
 * never right, and one that used to be.
 *
 * Until 2026-09-03 there was no such page: every unrecognised address rendered
 * the shelf, which is a plausible page at an address that means nothing, so a
 * stale link failed without ever saying it had. docs/plans/260903j-not-found-page.md.
 */
export const NOT_FOUND_HEADING = "There's nothing at this address";

/**
 * **It does not guess which of the two happened**, and that is the whole of the
 * wording.
 *
 * We cannot tell a typo from a link that has rotted — the router sees the same
 * unmatched string either way — and the two want different things from the
 * reader. So the sentence offers both and commits to neither, in that order,
 * because a mistyped address is much the commoner of them.
 *
 * **And it says nothing about an article.** `/read/<a slug that is not even
 * well-formed>` lands here, so a sentence mentioning documents would be
 * claiming something about an address we never looked up. A *valid* slug that
 * is not the reader's does not reach this page at all — it stays a `read`
 * route, and the server's answer draws `NOT_SHARED`, which is the sentence
 * written for that case.
 *
 * **"Address", not "link".** Greg reached this by typing `/asdf` into the
 * address bar, which is not a link at all; the word has to cover both ways of
 * getting here. GPT Sol's review, 2026-09-03.
 */
export const NOT_FOUND =
  "The address may be mistyped, or it may point at something that has since moved.";

/** The way out, signed in. `/`, which is the shelf for a reader who has one. */
export const NOT_FOUND_TO_SHELF = "Go to your shelf";

/**
 * The way out for a stranger — **the same address, a different word for it.**
 *
 * `/` is the landing page when nobody is signed in and the shelf when somebody
 * is (src/web/App.tsx), so the link never has to decide where home is; only
 * what to call it. Offering *"your shelf"* to somebody with no account would be
 * a promise the click cannot keep.
 */
export const NOT_FOUND_TO_HOME = "Go to the home page";

/* ── The shelf of public articles ──────────────────────────────────────────── */

/**
 * **`/read/public` — the other shelf**, and everything on it is written here.
 *
 * The owner's shelf and this one are two different lists and must not sound like
 * one narrowed: that one is *your articles*, this one is *what anybody has
 * shared*, and nobody's private reading is in it.
 * docs/project/public-shelf.md, and src/web/PublicLibraryPage.tsx is the page.
 *
 * **Every sentence here says the limit of the list out loud**, which is the one
 * rule this section has that the neighbouring ones do not. A list that answers
 * *what is there* is read as complete unless it says otherwise, and this one is
 * not: past a cap the tail is cut (`PUBLIC_SHELF_TRUNCATED`), and the query
 * silently drops a shared article that is archived or whose revision has no
 * readable blocks (src/store/public-library.ts § `publicLibraryQuery`).
 *
 * **So no sentence here claims the list is complete**, in either direction, and
 * it took two passes to get there. The first draft of the lede ended *"an
 * article that is not listed here is one nobody has shared"* — absence implying
 * unshared, false three ways. The second opened *"Every article somebody using
 * Spideryarn has made public"* — the same claim from the other end, and GPT Sol
 * caught that the fix had left it standing. What survives says only what the
 * page holds and what it does not hold, both of which the `where` clause can
 * only ever confirm. docs/reusable/silent-success.md.
 */
export const PUBLIC_SHELF_HEADING = "Shared articles";

/**
 * **The line under the heading, and its last clause is the load-bearing one.**
 *
 * *"nobody's private reading is on this page"* is there to stop the obvious
 * wrong reading — that a page called *Shared articles* might be a window onto
 * somebody's shelf. It is the reader-facing half of the decision in
 * docs/project/library.md § The Shared badge: this shelf is not the owner's
 * shelf filtered, and it is not a selection made by us either.
 *
 * **It is a claim about the page, not about the world**, and that distinction
 * cost two rewrites rather than one, which is why it is written out here.
 *
 * The first draft ended *"an article that is not listed here is one nobody has
 * shared"* — absence implying unshared. False: a shared article that has been
 * archived, or whose current revision has no tree or no blocks, or that falls
 * past the row cap, is shared and absent
 * (src/store/public-library.ts § `publicLibraryQuery`).
 *
 * The second opened *"Every article somebody using Spideryarn has made
 * public"*, and **that is the identical claim read from the other end** — it
 * asserts the list is the whole set, which the same four exclusions falsify. It
 * survived the first fix because the fix was aimed at the sentence rather than
 * at the claim; GPT Sol's review of this stage caught it, 2026-09-04.
 *
 * So it opens with a bare plural. *"Articles people … have chosen to make
 * public"* says what is here and quantifies nothing, and the `where` clause has
 * no way to make it false.
 *
 * **"without an account" rather than "for free"**, because the fact worth
 * stating is that there is nothing to press before reading, and *free* is a
 * claim about price on a page that has nothing to do with the plans.
 */
export const PUBLIC_SHELF_LEDE =
  "Articles people using Spideryarn have chosen to make public. You can open any of them without " +
  "an account, and nobody's private reading is on this page.";

/**
 * **Nobody has shared anything**, which is an answer about the world rather than
 * a missing page — so the route answers 200 with an empty list and this is what
 * is drawn over it (src/store/public-library.ts § `scrubbed`).
 *
 * The second sentence exists so that an empty page is distinguishable from a
 * broken one: it says what would have to happen for something to appear, which
 * is the difference between *there is nothing* and *nothing loaded*.
 *
 * **"on this shelf" and not "shared yet"**, for the reason the lede's own note
 * gives at length: an empty list is a fact about the query's answer, and
 * *"nothing has been shared yet"* would be a claim about the world that the
 * readability bar and the archived filter can both falsify.
 *
 * The second sentence had the same fault in miniature and lost it the same way.
 * *"An article appears here when its owner turns sharing on for it"* promises
 * an implication the query does not honour; *"it fills up as people share"*
 * says which way the page tends without promising anything about one article.
 */
export const PUBLIC_SHELF_EMPTY =
  "There is nothing on this shelf yet. It fills up as people share the articles they are reading.";

/**
 * **The cap, said out loud** — `truncated` on the wire
 * (src/public-library-types.ts), which exists for exactly this sentence.
 *
 * **No number in it**, deliberately. The cap is `PUBLIC_LIBRARY_LIMIT` in
 * src/store/public-library.ts and is a ceiling rather than a page size, so it can
 * be raised in one edit — and a sentence naming 200 would then be a false one
 * that nothing would report. Saying *which* end is kept is the useful half
 * anyway: the list is ordered by when each article was shared, newest first.
 *
 * Nothing can reach it today. It is drawn rather than deferred because a cap
 * reported by nobody is a list that quietly stops being the list.
 */
export const PUBLIC_SHELF_TRUNCATED =
  "There are more shared articles than this page shows. The list is capped, and what it shows " +
  "is the most recently shared.";

/**
 * Said only once the wait is worth mentioning — `useSlow` owns the threshold,
 * and on a warm fetch this never appears. The shelf's own line for the same
 * moment is *"Reading the shelf…"*; this one names a different list, because a
 * stranger has no shelf and would not know which was meant.
 */
export const PUBLIC_SHELF_SLOW = "Reading the shared articles…";

/**
 * The read failed — a 500 from the listing, or the request never arrived.
 *
 * A plain sentence rather than a `ReaderFacingFailure`, like `NOT_SHARED` and
 * `NOT_FOUND` above: those carry a code because they are raised by the server
 * and quoted back to us in a bug report, and this one is the client's own
 * account of a fetch it watched fail. It says nothing about why, because the
 * client cannot tell a database fault from a lost connection, and guessing is
 * how a page ends up telling a reader on a train that our server is down.
 */
export const PUBLIC_SHELF_FAILED = "We couldn't read the list of shared articles just now.";

/** The button beside it. Retrying is honest here — nothing was written. */
export const PUBLIC_SHELF_RETRY = "Try again";

/**
 * `12,975 words`, on a card.
 *
 * **Words rather than minutes**, and that is the wire's decision rather than
 * this file's: `PublicLibraryEntry` carries `words` and no reading time, because
 * a card is not worth a second projection to keep in step with the reader's own
 * (src/store/public-library.ts § `PUBLIC_LIBRARY_CARD`). The owner's card says
 * both; this one says the fact the server actually sent.
 *
 * `toLocaleString`, so a long piece is not a wall of digits.
 */
export function publicShelfWords(words: number): string {
  return `${words.toLocaleString()} words`;
}

/**
 * `Shared 3 days ago` — **the field the list is ordered by, on the card that the
 * order put there.**
 *
 * The owner's shelf follows the same rule for the same reason (ShelfEntry.tsx §
 * `ShelfCard`): a card sorted by something it does not show is a list in an
 * order the reader cannot check. Here the order is `public_at` descending, so
 * this is the line that answers *why is this one at the top*.
 *
 * `when` is already-formatted — `timeAgo` in src/web/relative-time.ts, which
 * hands back a date rather than a count past about a month. So this reads
 * *"Shared 3 days ago"* or *"Shared 12 Aug 2026"*, and both are sentences.
 */
export function publicShelfShared(when: string): string {
  return `Shared ${when}`;
}

/* ── The showcase, on the pages a stranger reads first ─────────────────────── */

/**
 * **The block on `/` and `/features` that sends a stranger to a real article** —
 * src/web/PublicShowcase.tsx, and stage 4c of
 * docs/plans/260904b-pricing-page-and-public-showcase.md.
 *
 * These three sentences are in this file rather than inline on the two pages,
 * which is not what the marketing pages usually do (their copy carries a comment
 * naming its source, docs/project/positioning.md § Whose words). The reason is
 * that **two pages draw the same block**: a sentence written twice is two
 * sentences that will differ by the second edit, and the drift both callers exist
 * to avoid is exactly the drift `SHARING_ON` and its three dependants were pulled
 * together to avoid. The provenance rule still applies and these are `[tissue]` —
 * an agent's connecting words, approved as a class by Greg on 2026-09-04 for this
 * plan, and the next dictation pass may replace them.
 *
 * **Every one of them has to be true when the block shows no articles at all**,
 * which is the constraint that shaped them. The listing is fetched after the
 * page draws and may fail, be empty, or be slow, and the heading and the sentence
 * are already on screen by then. So neither says *here are three articles*, and
 * neither claims anything about how many there are — the same rule the shelf's
 * own copy follows above, for the same reason: say what the page holds, never
 * how much of the world it holds.
 *
 * **All three lost a first draft to that rule**, which is why it is spelled out
 * rather than assumed. GPT Sol's review of this stage, 2026-09-05:
 *
 * - The heading was *"See it on a real article."* — an invitation the block
 *   cannot honour in exactly the states it is drawn in anyway, because a failed
 *   read and an empty shelf both leave it standing over no article at all. A bare
 *   plural naming what the shelf is made of is true in every state.
 * - The link was *"All the shared articles →"*, and swapping *all* for *every*
 *   is not a fix: both assert the shelf is the whole set, which the archived
 *   filter, the readability bar and the row cap each falsify.
 * - The lede opened by restating what sharing is, which was true but was also
 *   the shelf's own first sentence written a second time.
 */
export const PUBLIC_SHOWCASE_HEADING = "Articles people have made public.";

/**
 * The sentence under it.
 *
 * **A fact about what a public article is, not about what is on the shelf right
 * now.** It would be much better copy to say *"here are three people's
 * articles"*, and it would be false for as long as the fetch is in the air and
 * for ever if it fails.
 *
 * *"one"* is a category rather than a pointer into the list above it — *"one of
 * these"* would be the pointer, and it is the version that stops being true the
 * moment the list is empty.
 *
 * *"with no account"* rather than *"free"*, following `PUBLIC_SHELF_LEDE`: the
 * fact worth stating is that there is nothing to press before reading, and *free*
 * is a claim about price on a block that has nothing to do with the plans.
 *
 * It deliberately does **not** list what a public article carries — the outline,
 * the glossary, the ideas, the quotes. Both pages already say that a few lines
 * above (LandingPage.tsx's bento, FeaturesPage.tsx § the library), and a second
 * copy here is a second inventory to keep in step with what a visitor actually
 * gets, which is a list that has already grown once.
 */
export const PUBLIC_SHOWCASE_LEDE =
  "Anybody can open one and read it, with no account and nothing to sign up for first.";

/**
 * The way to `/read/public` from the block — **and the only sentence that is
 * drawn before the network is asked and survives it failing.**
 *
 * One constant rather than a line on each page, for the reason at the head of
 * this section: the two callers must not come to call the same shelf two things.
 * The arrow matches the two links already on those pages
 * (*"Everything it does, with pictures →"*, *"Pricing, and what a month's
 * allowance means →"*), so a third link in the same family does not read as a
 * different kind of thing.
 *
 * **"Browse", because every quantifier is a claim this shelf cannot keep.** The
 * first draft was *"All the shared articles →"*, and *all* and *every* are the
 * same assertion: that what is behind the link is the whole set. It is not — the
 * query drops an article that is archived, or whose revision has no readable
 * blocks, or that falls past the row cap
 * (src/store/public-library.ts § `publicLibraryQuery`) — so this is the claim
 * `PUBLIC_SHELF_LEDE` above took two rewrites to stop making, arriving in a link
 * label where nobody was looking for it. GPT Sol, 2026-09-05. A verb and a bare
 * plural name the action and the page, which is all a link owes.
 */
export const PUBLIC_SHELF_BROWSE_LINK = "Browse shared articles →";

/* ── If something here is yours ────────────────────────────────────────────── */

/**
 * **The link a person follows when a piece published here is theirs**, drawn on
 * the two surfaces a stranger meets a republished article on: the foot of
 * `/read/public`, and the visitor's own details page for one article
 * (src/web/PublicLibraryPage.tsx, src/web/PublicPages.tsx). It goes to
 * `TAKEDOWN_HREF` — a section on `/privacy` rather than a page of its own,
 * argued in src/web/router.ts and again beside the section itself.
 *
 * **Written to somebody who does not have an account**, which is what makes it
 * different from every other sentence in this file. "Yours" here means *you
 * wrote it or you hold the rights to it* — not the owner's sense of "your
 * articles", which is a reader's shelf. On the shelf page there is nothing else
 * for the word to attach to; on the article page the sentence beside it settles
 * it.
 *
 * **One sentence doing both jobs**, deliberately: it is the link text *and* the
 * whole of the offer, so there is no lead-in prose to keep in step with it and
 * no second wording to drift. Quiet rather than loud — a report link with a
 * warning colour on every card would read as a warning about each article, and
 * the piece it is next to is almost always shared perfectly legitimately.
 */
export const TAKEDOWN_LINK = "If something here is yours, ask us to take it down";

/**
 * **The line under the shelf's lede**, and the replacement for `TAKEDOWN_LINK`
 * at the foot of that page — moved on Greg's ask, 2026-09-06: *"we have this
 * note … Let's move that to the top."*
 *
 * **It is three checkable facts and then an offer, in that order**, and that
 * ordering is the whole design. `TAKEDOWN_LINK` alone at the top of the page
 * would make the first thing anybody reads a note about takedowns, which reads
 * as a warning about the articles underneath it — the exact failure the foot
 * placement was chosen to avoid (docs/project/public-shelf.md). Saying what
 * these articles *are* first turns the offer into a consequence of behaving
 * openly rather than into an apology.
 *
 * **Two readers, one sentence.** A visitor browsing wants to know whose these
 * are; an author who arrived from a search wants to know whether we are hiding
 * anything. The facts serve both, which is why none of them is a reassurance:
 * *written by somebody else*, *published somewhere else first*, *each links
 * back*. All three are visible on the page itself within one click.
 *
 * **No completeness claim**, following every other sentence in this section:
 * *"Every article here"* is about the page in front of the reader and not about
 * the world, so the four exclusions in `publicLibraryQuery` cannot falsify it.
 *
 * The second sentence is the link, and the first is not, because the offer is
 * the only part of it that goes anywhere.
 */
export const PUBLIC_SHELF_PROVENANCE =
  "Every article here was written by somebody else and published somewhere else first, and each " +
  "one links back to its original.";

/** The offer, and the link out of it. Reads on from `PUBLIC_SHELF_PROVENANCE`. */
export const PUBLIC_SHELF_TAKEDOWN = "If one is yours and you'd rather it weren't, ask us to take it down.";

/**
 * **The hover on the line above**, and the one place in this app where a
 * `ControlTip` sits on a link to a *page* rather than on a control.
 *
 * > add a rich tooltip (see tooltips.md) to it, explaining that we have set up
 * > the SEO canonical link to point to your original page … etc etc
 * >
 * > — Greg, 2026-09-06
 *
 * **Greg named five things and two of them are false**, which is why this is a
 * `ControlTip` and not the five-claim panel the brief describes. Zero-data
 * retention is set on dictation and nothing else (`AI_JOB_ROUTE`,
 * src/ai-call.ts), and the canonical link is real but inert because no search
 * engine is allowed to fetch the page in the first place. The five claims live
 * on `/features/public-readable-sharing`, said accurately and at length; this
 * card's job is to make somebody want to open it.
 *
 * So it obeys the idiom rather than fighting it
 * (docs/project/tooltips.md § `ControlTip`): `what` is what pressing the link
 * does, `how` is the two things a reader could not have guessed and that
 * actually settle the question — **we are not in search engines at all**, which
 * is the strong true version of Greg's canonical claim and the one a
 * rights-holder is really asking about, and **you do not have to prove
 * anything**, which is the only sentence here that is an action.
 */
export const TAKEDOWN_TIP_HEAD = "What we do with a shared article";
export const TAKEDOWN_TIP_WHAT =
  "Opens the page that sets out what happens when a reader makes an article public here: what goes " +
  "out, what stays with the original, and how to have yours removed.";
export const TAKEDOWN_TIP_HOW =
  "None of these pages is in a search engine — every one is served noindex and our robots.txt " +
  "disallows crawling. If a piece is yours, one email takes it down, and you don't have to prove " +
  "anything first.";

/**
 * The heading of the section at the other end of it, on `/privacy`.
 *
 * Here rather than inline in the page because two things need to agree on it —
 * the page draws it, and tests/takedown-privacy-section.test.tsx checks that
 * the anchor the link points at is the section that carries it. The rest of that
 * page's prose is JSX, and stays JSX: it is a policy read top to bottom, not a
 * set of strings other surfaces reuse (src/web/PrivacyPage.tsx § Prose in JSX).
 */
export const TAKEDOWN_HEADING = "If something here is yours";

/* ── Sharing a document, for the owner ─────────────────────────────────────── */

/** The switch, off. */
export const SHARING_OFF = "Only you can read this.";

/**
 * **The switch, on — and the promise it makes changed on 2026-09-04.**
 *
 * It used to say *"Anyone with the link can read this, without signing in."*,
 * which is a promise about **reachability by link**. `GET /api/public/library`
 * now lists every public article, so a shared article can be found by somebody
 * who was never sent one, and the old sentence was untrue rather than merely
 * incomplete. Greg chose to list every public article and change the promise
 * rather than narrow the listing:
 * docs/plans/260904b-pricing-page-and-public-showcase.md § 1.
 *
 * **It stays one short sentence because it is three surfaces**, not one — the
 * sharing card's line, the shelf badge's hover (`SHARING_BADGE`), and half of
 * the masthead's mark (`SHARING_MARK_PUBLIC`, which appends *"Change who can
 * read it."*). So the listing is a clause inside the existing sentence and not
 * a second sentence after it: a badge tooltip and a link's description have to
 * read as one voice, and two sentences read as a correction of the first.
 */
export const SHARING_ON = "Anyone can read this without signing in, and it's listed publicly.";

/**
 * **The three tooltips on the three controls**, and the first one is the one
 * that earns its keep.
 *
 * > the Share button should visibly be a button with rich tooltip
 * >
 * > — Greg, 2026-09-04
 *
 * `SHARING_OPEN_TIP` answers the question an owner actually has with the
 * pointer over that button: *if I press this, is it done?* It is not — the
 * press opens a confirmation — and until 2026-09-04 the only way to find that
 * out was to press it, on the one control in this app whose act cannot be
 * un-rung (`SHARING_CANNOT_UNRING`). That is a bad way to learn it.
 *
 * The other two say what their button does to a page that is already out, which
 * is the same distinction from the other side: `Stop sharing` refuses the next
 * request and nothing more, and `Copy` puts an address on the clipboard without
 * changing anything at all.
 *
 * **`SHARING_COPY_TIP` lost the words *"by anyone who has this address"* on
 * 2026-09-04.** They were there to make the point that copying changes nothing,
 * and once a public article is listed (`SHARING_ON`) they read instead as a
 * claim about *who can reach it* — the one thing on this card that is no longer
 * true. The point survives; the clause that had quietly become a promise does
 * not.
 */
export const SHARING_OPEN_TIP =
  "Nothing goes out yet. This opens a list of exactly what a visitor would get, and asks you to " +
  "confirm before anything leaves.";

/** @see SHARING_OPEN_TIP */
export const SHARING_STOP_TIP =
  "Takes the public page down, so the next request for it is refused. What somebody has already " +
  "read or copied stays with them.";

/** @see SHARING_OPEN_TIP */
export const SHARING_COPY_TIP =
  "Puts the link on your clipboard. Copying it shares nothing on its own — the article is already " +
  "readable without it.";

/**
 * **The same fact, small enough for a corner of a card on the shelf.**
 *
 * The owner's own word for it — the sharing card says *"Shared since …"* — and
 * deliberately not `VIEW_ONLY` above, which is the *visitor's* side of this one
 * fact and says something else entirely: that one means *you may not change
 * this*, this one means *anyone can read this, and it is listed*. Collapsing them
 * into one word would put the visitor's sentence on the owner's shelf.
 *
 * Only ever drawn on a shared article. There is no private twin, because the
 * shelf is almost all private and a chip on every card is decoration rather
 * than information — docs/plans/260902j-public-read-only-access-audit-and-improvements.md
 * § Cluster E, where Greg's decision is *a badge, not a filter*. `SHARING_ON`
 * is what the badge says on hover, so the shelf and the sharing card give one
 * sentence between them rather than two near-misses.
 */
export const SHARING_BADGE = "Shared";

/**
 * **The mark at the top of the article, in two states, each of them a whole
 * sentence and a destination.**
 *
 * Greg, 2026-09-04:
 *
 * > Make it a bit clearer at the top of an article page with an icon if it's
 * > public or not - actually, make that a clickable button with clear tooltip
 * > that takes you to the profile to change whether the article is
 * > private/public
 *
 * Built on `SHARING_ON` and `SHARING_OFF` rather than written afresh, so the
 * masthead, the sharing card and the shelf badge cannot drift into three
 * near-misses of one sentence — which is exactly how the dock's tooltip came
 * apart from the band's ([visitor.ts § markedModes](web/visitor.ts)). What is
 * added is only the half a tooltip on a *link* has to carry that a label does
 * not: where pressing it goes.
 *
 * **There is a private twin here, unlike on the shelf.** The badge has none
 * because a chip on every card is decoration; this is one mark on one article,
 * and the question it answers — *would the link I am about to paste work?* — is
 * asked exactly as often about a private article as a public one. An icon that
 * appears only when shared answers it by absence, which is indistinguishable
 * from a mark that has not loaded.
 */
export const SHARING_MARK_PUBLIC = `${SHARING_ON} Change who can read it.`;

/** The other state of the mark above. */
export const SHARING_MARK_PRIVATE = `${SHARING_OFF} Share it with anyone.`;

/**
 * **The second paragraph of the mark's card, which is the one worth hovering
 * for** — added 2026-09-06, when the mark's tooltip became a `ControlTip`
 * rather than a bare sentence (src/web/Masthead.tsx § `SharingMark`).
 *
 * `ControlTip`'s rule is that the second paragraph says the thing a reader
 * cannot work out by pressing the control, and for this one that is the same
 * fact from either side: **sharing is not symmetrical**. Turning it on can be
 * turned off, and turning it off does not reach what has already been read —
 * `SHARING_CANNOT_UNRING` is the long version, said at the point of no return.
 * An owner deciding whether to press this deserves the short version here,
 * before they get to the confirmation.
 *
 * The private twin says the smaller thing, and says it because the absence of a
 * warning is not itself reassuring: an owner who has just read what publishing
 * costs should be told plainly that none of it has happened.
 */
export const SHARING_MARK_HOW_PUBLIC =
  "Taking it down again refuses the next request, and no more than that — whatever somebody has " +
  "already read or copied stays with them.";

/** @see SHARING_MARK_HOW_PUBLIC */
export const SHARING_MARK_HOW_PRIVATE =
  "Nothing has left your account: the article, your notes and your comments are yours alone until " +
  "you say otherwise.";

/**
 * **The mark's *name*, which is not its tooltip** — and the two have to differ.
 *
 * Floating UI gives the tooltip to the link as `aria-describedby`, so an
 * `aria-label` holding the same sentence has a screen reader read it twice: once
 * as the link's name, once as its description. GPT Sol, finding 5, 2026-09-04.
 *
 * So the name is what a link's name should be — the state, and where pressing
 * it goes — and the tooltip stays the sentence. Short enough to be worth hearing
 * in a list of links, which is the other thing a name is for.
 *
 * `SHARING_BADGE` is the shelf's word for the same state and is deliberately
 * reused: an owner who has met *Shared* on a card should meet the same word here
 * rather than a synonym.
 */
export const SHARING_MARK_NAME_PUBLIC = `${SHARING_BADGE} — change who can read this`;

/** The other state of the name above. There is no shelf word for this one. */
export const SHARING_MARK_NAME_PRIVATE = "Private — change who can read this";

/**
 * **What a shared link carries, in one line, for the visitor** — the reader of
 * the page a shared link actually reaches.
 *
 * *"and whatever the model has written about it" was added 2026-09-02*, and it
 * is a correction rather than a flourish. Since slice 1b a shared link has
 * carried the glossary, the ideas, the quotes and the tweet thread, and this
 * sentence still named only the article and its tree — true, and true by
 * omission of the four things an owner would most want to have been told.
 *
 * **And the last clause was a live falsehood for a day.** It ended *"It never
 * carries the comments, conversations, searches or notes of whoever added
 * it."* Comments started crossing on 2026-09-04 and searches a few hours later
 * (docs/plans/260904c-more-modes-on-a-shared-link.md), so this page told the
 * visitor that the comments in the drawer beside it had not been shared. Found
 * by GPT Sol reviewing the other half of the same day's work, and handed over
 * by the session that got the review.
 *
 * The lesson is the one this file keeps relearning and is worth stating on the
 * constant it bit: **a sentence that enumerates what does *not* cross is a
 * promise with no test behind it**, and it goes stale in the one direction that
 * matters. `tests/shared-inventory.test.ts` holds the owner's list to the
 * projection; there is nothing equivalent for prose, so the clause left here is
 * the shortest one that is still worth saying — conversations, which are
 * deferred by decision rather than by accident (chat-tools.md).
 *
 * **And the positive half is prose here for one reason only: its audience has
 * no list.** *"the marks, notes and searches of whoever added it"* is three
 * items enumerated beside a derived inventory of the same facts, which is
 * exactly the shape that killed `NOT_SHARED_NOTE` the same evening — so the
 * difference has to be said rather than assumed. The owner has
 * [shared-inventory.ts](web/shared-inventory.ts), swept from the modes, and
 * gets no sentence. A visitor has nothing to read but this. **It is not a
 * summary to be kept in step with that list**, and whoever next adds something
 * to a shared link should ask whether this sentence has become false rather
 * than whether it has become incomplete. GPT Sol, 2026-09-04, unprompted, on
 * this very rewrite.
 *
 * ## It used to be drawn on the owner's card as well, and both problems with
 * ## that had one cause: it was written for two audiences and fitted neither
 *
 * **It appeared on a *private* article's card**, in the present indicative,
 * directly under *"Only you can read this."* — two paragraphs contradicting
 * each other on a skim, on the one control in this app where a state that looks
 * wrong is worth most. Greg, 2026-09-03: *"That's a fair description of what
 * would be true IF it was Public-readable. But it's not."*
 *
 * **And on the shared card it was redundant**, sitting immediately above the
 * itemised list that says the same thing better: `SHARED_HEADING` and the two
 * below it, swept from the modes by
 * [shared-inventory.ts](web/shared-inventory.ts) so it cannot fall behind them,
 * with `NOT_SHARED_NOTE` as the one-line summary. The same list is what the
 * confirmation box answers *"what would publishing do?"* with, so the box does
 * not get the sentence either. One fact, on that card, once.
 *
 * **What was lost with it, stated rather than glossed:** *"nothing they do
 * costs a model call"*, which the inventory only implies by listing Chat,
 * Search, Remember and Referee as owner-only. It is said outright to the person
 * who meets it — `visitorSentence` (web/visitor.ts) — and no longer to the
 * owner. Worth a line back if an owner ever asks whether a link can spend their
 * money.
 *
 * ## Why the visitor's copy is the one that survived
 *
 * Because it is the audience with no list to read. And the sentence it was
 * given was the owner's: *"They never see **your** comments, **your**
 * conversations"*, on a page whose reader has none, describing themselves in
 * the third person. The owner's side and the visitor's side of one fact are
 * meant to be **different sentences** — `SHARING_BADGE` above says why, and
 * `VIEW_ONLY` is the other half of it — and the way that goes wrong is two
 * constants drifting a few words apart, as the dock's tooltip did against the
 * band's ([visitor.ts § markedModes](web/visitor.ts)). One audience, one
 * sentence, nothing to keep in step.
 */
export const SHARED_LINK_CARRIES =
  "A shared link carries the article, its table of contents, every zoom level, and the reading " +
  "aids written for it — the summaries, the glossary, the ideas, the quotes. It also carries the " +
  "marks, notes and searches of whoever added it. Their conversations with the model are not " +
  "part of it.";

/**
 * **The honest limit, and we are the only ones saying it.**
 *
 * Not one product researched tells either the owner or the visitor that
 * unsharing cannot claw back a page a browser already has; every one of them
 * describes revocation purely as the next request being refused. Saying it
 * plainly is going further than the precedent, deliberately, and it is recorded
 * as a decision rather than left to look like a default.
 *
 * **It now names the list, after an argument it lost** (2026-09-04). The first
 * version of this stage left the sentence alone, reasoning that delisting was
 * already covered by "the next request is refused". GPT Sol showed that it is
 * not, on two counts. A request for the *list* is not refused — it answers 200
 * with the article simply absent (src/store/public-library.ts), so the words
 * did not describe what happens. And the omission was the wrong way round for
 * the owner: publishing had just been widened to *found by a stranger*, and
 * this is the sentence that says how far turning it off reaches, so the
 * reassuring half was the half missing.
 * docs/research/260828a-public-access-how-others-do-it.md.
 */
export const SHARING_CANNOT_UNRING =
  "Turning this off takes it off the public list and refuses the next request for it. It cannot " +
  "take back a page somebody's browser already has, or anything they copied out of it.";

/**
 * **What taking it down costs, said as a consequence and not as a gate.**
 *
 * A public article counts as **half** an article against the allowance
 * (src/billing/half-units.ts), so making one private again puts the other half
 * back — and on the free tier, whose allowance is lifetime, there is no next
 * month to rescue anybody from that.
 *
 * Three rules decided this sentence and all three are Fable's, 2026-09-04:
 *
 * - **Unsharing is never harder than sharing.** So there is no tick-box, no
 *   second confirmation and no warning tint: a cost attached to taking something
 *   down is a cost attached to acting on a complaint, and we built a takedown
 *   route the same week that asks owners to do exactly that. It sits beside
 *   `SHARING_CANNOT_UNRING` as one more fact about the press.
 * - **It says reading is never limited**, because that is what somebody reading
 *   the word *allowance* on a page about taking their own article down will
 *   actually be worried about.
 * - **Money never appears inside the sharing confirmation.** This is rendered in
 *   the `shared` branch of AccessSharing.tsx and nowhere else. The confirmation
 *   is where the rights tick-box lives, and a discount printed beside it makes
 *   the inducement ours and weakens exactly the thing that tick-box is for.
 *
 * **No number in it**, which is a decision rather than an omission. The number
 * would be this article's charged ledger rows, and reading those on the path
 * that opens an article is the aggregate `readBillingSummary` gives a whole
 * paragraph to avoiding (src/billing/summary.ts). A statement of consequence
 * does not need the arithmetic; the count is on `/profile`, where the ledger is
 * already being read.
 *
 * **And it is conditional, since 2026-09-05**, because for two owners it was
 * simply false: an article added before billing launched has no ledger row at
 * all, and one charged before `ingest_events.article_id` existed resolves to
 * nothing and costs full price either way. Both were told that taking their
 * article down would cost them, and it would not.
 *
 * That is worse here than an ordinary inaccuracy. This sentence is on the press
 * a takedown asks an owner to make, and the rule above is that **unsharing is
 * never harder than sharing** — a cost attached to taking something down is a
 * cost attached to acting on a complaint. An *invented* cost is the sharpest
 * version of exactly that. GPT Sol, 2026-09-05. The condition is stated in
 * words rather than computed: knowing which owner is which means an aggregate
 * on the path that opens an article, which is the thing this comment already
 * refuses.
 */
export const UNSHARING_COSTS_ALLOWANCE =
  "If this article counts against your allowance, being public halves what it costs — so making " +
  "it private again uses that half back up. Nothing you have added goes anywhere, and reading is " +
  "never limited.";

/** The confirmation, which no other product asks for. */
export const SHARING_CONFIRM_TITLE = "Share the full text of this article?";

/**
 * Why we gate this and Notion, Figma and Readwise do not.
 *
 * They are all publishing **the owner's own document**. We are republishing
 * **somebody else's article**, extracted from a page they wrote, so the rights
 * question is ours and not theirs and the norm does not transfer.
 * docs/plans/260827ai-public-read-only-access.md § Rights.
 *
 * **It says the article will be found, and lists nothing** — 2026-09-04, both
 * halves deliberate.
 *
 * *Found*, because "anyone with the link" was the whole of what an owner was
 * being asked to agree to and it is not the whole of it any more: the article
 * joins a public listing, so somebody who was never sent the link can arrive at
 * it. That is the fact a confirmation exists to put in front of somebody.
 *
 * *Nothing enumerated*, because the `Inventory` drawn directly beneath this
 * paragraph is derived from the modes (web/shared-inventory.ts) and cannot fall
 * behind them, while a prose list beside it goes stale the day another artefact
 * starts being shared — saved searches are one stage away, and nobody re-reads
 * a confirmation dialog when adding a row. PrivacyPage.tsx promises *"The
 * sharing card lists exactly what will go out before you turn it on"*, and it
 * is the inventory that keeps that true.
 */
export function sharingConfirmBody(title: string): string {
  return (
    `This puts the whole extracted text of “${title}” where anyone can read it without ` +
    "signing in, and lists it publicly — so somebody who was never sent the link can find it."
  );
}

/* The three things the dialog can say about personalisation, and they are three
   rather than one for the reason the visitor's four sentences are four: *we
   could not tell*, *none were*, and *these were* are different facts, and a
   single hedged sentence covering all three tells an owner nothing they can act
   on. `ArticleMetadata.sharing.personalised` is what chooses between them.

   This file went through a wrong turn worth recording, because the comment that
   was here asserted it confidently. On 2026-08-28 it looked as though naming
   the artefacts would mean widening `REVISION_READ_POLICY`, and the general
   warning was written up as the permanent answer. It would not: the revision
   row already carries all five artefacts that can hold a `profileHash`, so
   reading it was free, and `personalised` was built the same afternoon. The
   sentence below is the fallback again rather than the answer. */

/**
 * **We could not tell.** The whole `sharing` block is absent — a store with no
 * column to read, which today means the filesystem one.
 *
 * A hedge, and honest as a hedge: it says *may have been* because nothing here
 * knows. What it must never become is the sentence for `personalised: []`,
 * which is a different and much stronger claim.
 *
 * What it says that a general warning usually leaves out is the half worth
 * keeping in all three states — the leak is what a personalised artefact **left
 * out**, not what it quotes. src/profile.ts forbids quoting the profile and
 * carries a verbatim example of what not to do, but a prompt is not an
 * enforcement mechanism, and the terms a glossary skipped are inferable from
 * the ones it kept.
 *
 * **"The pipeline" is not in it**, deliberately. That is our word for our
 * machinery, and copy.md's first rule is to say what happened in words that
 * assume nothing — the owner is a reader who marked a document shareable, not
 * somebody operating a build.
 */
export const SHARING_PERSONALISED =
  "The glossaries, ideas and quotes here may have been written for your reader profile, and they " +
  "go out exactly as they are. None of them quotes it — but what a profile made them skip is still " +
  "visible in what they kept.";

/**
 * **None were.** `personalised: []`, from a store that can say.
 *
 * Worth a sentence rather than silence: the owner is being asked to make a
 * rights statement about somebody else's article, and *nothing here was shaped
 * by you* is a real fact that removes a real worry. Saying nothing would leave
 * them to assume the general case.
 */
export const SHARING_NOT_PERSONALISED =
  "Nothing here was written for your reader profile.";

/** What the owner's own copy of each artefact is called, in a sentence. */
/* Exported for one reason: `tests/messages.test.ts` holds it against
   `ProfileCarrying` from the store, which this file may not import — it has to
   stay a leaf (tests/client-imports.test.ts), and the rule refuses even an
   erased `import type`. The exhaustiveness check therefore lives where both
   halves can be seen at once. */
export const OWNED_ARTEFACT = {
  tweets: "your tweet thread",
  glossary: "your glossary",
  ideas: "your list of ideas",
  quotes: "your set of quotes",
  sketch: "your sketch diagram",
  illustrated: "your illustrated diagram",
  /* `satisfies`, not an annotation. `Partial<Record<StepName, string>>` as the
     declared type makes every value `string | undefined`, and the coverage
     check in tests/messages.test.ts would then be unsatisfiable without a cast
     — a cast that would make it pass whatever this table said. This keeps the
     keys checked against `StepName` and the shape exact. */
} satisfies Partial<Record<StepName, string>>;

/**
 * **These were**, named — Sol's improvement on the plan's first draft, and the
 * thing that turns a sentence nobody reads into a specific fact about the
 * document being shared.
 *
 * ## The phrasing dodges number agreement on purpose
 *
 * One artefact and three need the same sentence, and the obvious construction
 * needs `was`/`were`, `it`/`them` and `is`/`are` picked apart by count — five
 * ternaries in a sentence, each of them a place to get it wrong for the case
 * nobody tested. Making **the model** the subject of the second half removes
 * all of it: *what it made the model leave out* reads identically for one
 * artefact and for four.
 *
 * The dash after the list does the same job for the first half.
 *
 * A `StepName` with no entry in `OWNED_ARTEFACT` falls back to *"your <name>"*
 * rather than being dropped. Only six artefacts can carry a `profileHash` and
 * all six are in the table, so this is unreachable today — but a silently
 * shortened list is the failure that would matter here, since the whole point
 * of the sentence is that it is complete.
 */
export function sharingPersonalisedList(kinds: StepName[]): string {
  /* `Object.hasOwn` rather than indexing by `StepName`: the table's type is now
     exactly its five keys, which is what makes the coverage check in
     tests/messages.test.ts mean anything — and a `StepName` is deliberately not
     one of them. The fallback below is still the answer for any other step. */
  const nouns = kinds.map((k) =>
    Object.hasOwn(OWNED_ARTEFACT, k)
      ? OWNED_ARTEFACT[k as keyof typeof OWNED_ARTEFACT]
      : `your ${k}`,
  );
  const list =
    nouns.length <= 1
      ? (nouns[0] ?? "")
      : `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
  return (
    `${list} — written for your reader profile, and shared exactly as written. Nothing here quotes ` +
    "your profile, but what it made the model leave out is still visible in what it kept."
  );
}

/**
 * **We never found out**, and no write was attempted.
 *
 * The filesystem store has no column, or the page's metadata fetch failed. The
 * second sentence is the load-bearing one and it is true *only* in this case:
 * nothing was asked of the server, so whatever was true before still is.
 */
export const SHARING_UNKNOWN =
  "We could not check who can read this, so nothing is offered here — reload the page to try " +
  "again. Nothing has been changed.";

/**
 * **A write failed, and it may have taken effect anyway.**
 *
 * Split from `SHARING_UNKNOWN` on 2026-08-28 after GPT Sol found the card
 * saying *"whatever it was before is unchanged"* to an owner whose publish had
 * committed and whose response was lost. That is the one sentence this control
 * must never say wrongly: it tells somebody their article is private while
 * anybody with the link can read it.
 *
 * The route writes and *then* reads back to build its reply, and both stores
 * persist before rebuilding the representation — so every failure mode after
 * the write is a failure that leaves the write standing. Delete on this page
 * learned the same thing on 2026-08-27 and its comment is the long version.
 *
 * So this says the honest thing, which is that we do not know — and points at
 * the one action that settles it.
 */
export const SHARING_WRITE_UNCERTAIN =
  "That did not come back, so we cannot say whether it took effect — it may have. Reload the page " +
  "to see who can read this now.";

/** A write is in flight. Says which way, because the two are not equally urgent. */
export function sharingInFlight(to: "private" | "public"): string {
  return to === "public" ? "Sharing this article…" : "Turning sharing off…";
}

/** The box the owner ticks, which the server refuses the request without. */
export const SHARING_RIGHTS_CONFIRM =
  "I have the right to share this article's text.";

/* ------------------------------------------------- the sharing inventory --
   The owner's list of what a shared link carries. Greg, 2026-09-02: *"Better
   still, dynamically generate a list of what will be shared … And maybe even a
   list of what won't be shared."*

   **The words are here; which bucket each lands in is decided by
   `sharedInventory` in src/web/shared-inventory.ts**, which sweeps `MODES`
   through `visitorGap`. That split is the whole design — see that file — and it
   is why every note below is *descriptive only*. A note that also said "and
   this stays private" would be a second claim about the bucket, made in a file
   that cannot see the bucket, and it would be wrong the day the bucket changed.
   Timeline is the live example: Greg has already said he would like it
   public-readable (docs/plans/260831i-timeline-mode.md § Making a mode
   public-readable), and when that lands its row moves and its sentence should
   not have to.

   So the *reason* lives in the three headings, once each, where it is a fact
   about the column rather than about the row. */

/**
 * **We could not list what this would share — so we do not offer to share it.**
 *
 * The one state where the switch is asymmetric, and GPT Sol asked for it,
 * 2026-09-02: keeping the card usable when `available` is absent was right, but
 * letting an owner *publish* under a silently missing inventory defeats the
 * whole feature at exactly the moment it is failing. Unsharing stays available
 * — taking an article back is never the risky direction.
 */
export const SHARING_INVENTORY_UNKNOWN =
  "We could not work out what a shared link would carry for this article, so sharing is not " +
  "offered here — reload the page to try again. Nothing has been changed.";

/**
 * The three columns, and the sentence under each.
 *
 * **`SHARED_HEADING` lost *"with the link"* on 2026-09-04**, and it was the last
 * link-shaped phrase left in the owner's dialog. It sat directly under
 * `sharingConfirmBody`, which now says the article is listed publicly and can be
 * found by somebody who was never sent the link — so the heading contradicted
 * the paragraph above it on the one card where a state that looks wrong is worth
 * most. *Opens* rather than *reads*, because the column is about what arrives
 * with the page rather than about how much of it anybody gets through.
 */
export const SHARED_HEADING = "Anyone who opens it gets these";
/**
 * **And none of it can spend your money** — the sentence that came back on
 * 2026-09-04, having been dropped on 2026-09-02.
 *
 * The note above `NOT_SHARED_HEADING` used to carry *"nothing they do costs a
 * model call"* and it went with the rest of that paragraph, recorded at the
 * time as *"worth a line back if an owner ever asks whether a link can spend
 * their money."* Diagram and Search moved into this column two days later, and
 * both are things that cost the owner real money to make — so an owner reading
 * *Search* here would reasonably wonder whether a stranger can ask one.
 *
 * **It is the one prose claim on this card with a test behind it.**
 * `tests/public-network-trace.test.tsx` pins a signed-out reader at zero
 * requests outside `/api/public/` and zero requests that are not `GET`, through
 * every mode. So this is not a promise about intent, it is a statement of what
 * the suite refuses to let change — which is exactly what the deleted note was
 * not.
 *
 * **It reads doubly true now that the article is listed rather than only
 * linked** (`SHARING_ON`, above): the reader who finds this piece was never
 * sent anything by anybody, and they still cannot spend a penny of the owner's.
 */
export const SHARED_NOTE =
  "Reading any of this is free: nothing a visitor does can spend a model call, and nothing they " +
  "do adds to it.";
export const SHARED_IF_BUILT_HEADING = "Not built yet — and these would go out too";
export const SHARED_IF_BUILT_NOTE =
  "Building one later, while the article is still shared, publishes it. Nothing asks you again.";
export const NOT_SHARED_HEADING = "These stay with you";
/* **`NOT_SHARED_NOTE` was deleted on 2026-09-04**, and the deletion is the fix
   rather than a tidy-up. It said *"A shared link carries the piece and what the
   model wrote about it, never your own work on it"* — a hand-written summary of
   a **derived** list, sitting under the third column of a card whose first
   column, that same day, began listing *Your comments and notes*. So the card
   said both things at once.

   GPT Sol found it and recommended deletion over rewording, and the reason
   generalises: the two notes that remain are about *this column* (`SHARED_IF_BUILT_NOTE`
   says what happens if you build one later) and cannot be contradicted by the
   sweep, while a note summarising the whole card can, and did. The heading
   above already says what the column is. `SHARED_HEADING`'s column has no note
   for the same reason and never needed one. */

/* There is deliberately **no per-row "nobody has built one" sentence**, and
   there was for one draft. It replaced the row's own description, so the
   not-built Glossary chip lost the only text saying what a glossary is — and
   with it the clarification that the owner's lookups are not part of it. The
   heading and its note above already say "not built yet" and "these would go
   out too", once each, for the whole column; saying it again on every chip was
   the same fact three times and cost the one fact that was not repeated
   anywhere. GPT Sol's review, 2026-09-02. */

/**
 * **What every shared link carries, whatever has or has not been generated.**
 *
 * Not derived, because none of these is a mode and `visitorGap` therefore has
 * nothing to say about them. Each is settled somewhere else — the projection in
 * src/public/dto.ts and the reader's `select` in src/store/public-reader.ts —
 * and `tests/shared-inventory.test.ts` is what holds these three sentences to
 * what those two files actually do.
 */
export const ALWAYS_SHARED = [
  {
    key: "text",
    label: "The article's text",
    detail:
      "Every paragraph, heading, list and footnote we extracted, in full, with its formatting and " +
      "its links — not a summary of it.",
  },
  {
    key: "pictures",
    label: "Its pictures",
    /* **Not "served from our copy", which the first draft said and which is not
       true today.** The `assets` step stores the bytes and the manifest crosses
       in the payload, but nothing in `src/web/` reads it yet: every `<img>` in
       `block.html` still points at the publisher, for a visitor exactly as for
       the owner (docs/plans/260829b-hosting-the-articles-images.md). The sentence
       says what a visitor gets — the pictures, and the record — and stays true
       whichever server ends up sending the bytes. */
    detail:
      "Every image in the article. A visitor's browser fetches them from the publisher, exactly " +
      "as yours does.",
  },
  {
    key: "provenance",
    label: "Where it came from",
    /* **"where we have one", because sometimes we do not publish it.** An
       uploaded PDF has no address at all, and `publicSourceUrl` (src/urls.ts)
       refuses some of the ones we do have — a `user:pw@` address among them. The
       masthead already draws the absence honestly; a flat promise of a link here
       would be the one row of this list the article itself contradicts. */
    detail:
      "The title the page itself carried, the byline, the publication, the language, the " +
      "publication's own one-line excerpt, and a link back to the original where we have one.",
  },
  {
    /**
     * **This row moved out of `NEVER_SHARED` on 2026-09-04**, and it is the one
     * line in either list that changed what it promised rather than being
     * added to it. Greg decided that a shared link carries the reader's own
     * marks and notes; the sentence it used to sit under said they never left.
     * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3.
     *
     * **"and what the model answered when you asked" is the load-bearing
     * half.** An owner reading "Comments and notes" pictures their own
     * sentences; the thing they would not predict from the label is that the
     * *answers* go too, and those can be long, can cite the web, and were
     * written for them rather than for an audience. The old wording listed the
     * answers as well, and it was listing what stayed behind — so the words
     * survive and the bucket is the change.
     *
     * What is not said here, deliberately: nothing about referee notes or
     * half-finished questions. Neither crosses — `PUBLIC_COMMENTS_WHERE` in
     * src/store/public-reader.ts refuses both in SQL — and a promise that has
     * to enumerate its exceptions is a promise a reader stops trusting.
     */
    key: "comments",
    label: "Your comments and notes",
    detail:
      "Every passage you bookmarked or annotated, what you wrote about it, and what the model " +
      "answered when you asked.",
  },
] as const;

/**
 * **The two artefacts that cross but have no mode of their own**, and they are
 * two rather than one.
 *
 * `SHARED_TWEETS` was alone here until GPT Sol pointed out, 2026-09-02, that the
 * arc is in exactly the same position and was quietly missing: `available.arc`
 * was computed, sent, and never read, so an article with no arc listed nothing
 * under *not built yet* and an owner could not tell whether one existed. The
 * comment beside the tweets line claimed it was "the one artefact with no mode
 * of its own", which was the mistake stated out loud and still not noticed.
 *
 * The thread is a page beside the article (`VIEW_LABEL`, src/title-text.ts); the
 * arc is the extra rung Outline draws when there is one, so Outline is shared
 * either way and the arc is a separate row rather than a condition on it.
 */
export const SHARED_TWEETS = {
  key: "tweets",
  label: "Tweets",
  detail: "The article rewritten as a numbered thread.",
};

export const SHARED_ARC = {
  key: "arc",
  label: "The arc",
  detail: "One sentence per part saying where the argument has got to — the top rung of Outline.",
};

/**
 * **What never goes out, whatever the switch says.**
 *
 * The modes among these — Chat, Search, Remember, Referee — are not listed
 * here: they arrive from the sweep, which is what keeps a mode added next month
 * on this side of the line without anybody editing this file. What is here is
 * the things that are not modes at all.
 *
 * **It was six rows and is five.** `comments` moved to `ALWAYS_SHARED` on
 * 2026-09-04, which is the only time a row has crossed between these two lists.
 * That is worth knowing before moving a second one: a row here is a promise
 * somebody has already read, and moving it is a change to what they agreed to
 * rather than a change to a list.
 * docs/plans/260904c-more-modes-on-a-shared-link.md.
 */
export const NEVER_SHARED = [
  {
    key: "lookups",
    label: "Glossary lookups",
    detail:
      "A term you asked about, its answer and its citations. They sit beside the glossary and do " +
      "not leave with it.",
  },
  {
    key: "profile",
    label: "Your reader profile",
    detail:
      "What you wrote about yourself and why you are reading this. It may have shaped some of " +
      "what goes out, but it is never sent.",
  },
  {
    key: "rename",
    label: "Your name for it",
    detail: "If you renamed this on your shelf, visitors see the title the page itself carried.",
  },
  {
    key: "original",
    label: "The file you uploaded",
    detail: "A PDF or a scan stays yours. Visitors read the text we extracted, not your bytes.",
  },
  {
    /**
     * **Narrowed on 2026-09-02, because the first version was false.** It said
     * *"which model wrote what, which prompt version, when it ran, and what it
     * cost"*, and the first two of those **do** cross: `publicTree` and
     * `publicArc` (src/public/dto.ts) publish `version` and `generator`
     * deliberately, as facts about which of our generators wrote the structure.
     * GPT Sol's review found it. What genuinely never leaves is the money, the
     * clock and the person — so that is what the row now claims.
     */
    key: "provenance-internal",
    label: "What it cost, and who it was for",
    detail:
      "What each model call cost, how long it took, and which reader profile it ran under.",
  },
] as const;

/**
 * **What each mode holds, in the owner's own vocabulary** — and nothing about
 * whether it is shared.
 *
 * A total `Record<Mode, string>` rather than a partial one, so a fifteenth mode
 * is a red compiler here rather than a blank row in a list an owner is reading
 * before publishing somebody else's article.
 *
 * `plain` has an entry it never uses: `sharedInventory` skips it, because
 * `ALWAYS_SHARED` above already says "the article's text" in words that do not
 * need the reader to know the bar has a Plain button. The entry stays so the
 * record stays total.
 */
export const OWNER_MODE_NOTE: Record<Mode, string> = {
  plain: "The article on its own, with no panel open.",
  /* **"where there are gists", on all three**, because a *provisional* tree has
     none: it is carved from the author's own headings while the real one is
     still being written, and `publicTree` publishes that state on purpose so a
     visitor is not shown empty cells with no way to read them
     (src/public/dto.ts § `provisional`). A flat promise of a gist per section is
     a claim about an article that has finished ingesting, and these rows are
     shown about articles that have not. GPT Sol's review, 2026-09-02. */
  hierarchy:
    "The nested table of contents and the zoom levels — the headings, and the model's one-line " +
    "gist for each section where there are gists.",
  outline: "The whole piece as one nested list, from those same headings and gists.",
  summary: "The one-line gist written for each section, down the page, where there is one.",
  glossary:
    "The terms the model pulled out of the piece, and what each one means here. Your lookups are " +
    "listed separately and are not part of this.",
  ideas: "The propositions the model says the piece assumes or argues for.",
  quotes: "The lines the model picked out, in the article's own words.",
  timeline: "When the piece says things happened, in the order it says they happened.",
  /* **Not "the tree, the neighbours, the projection"**, which this said until
     2026-09-04 and which named one picture that was cut on 2026-08-30 and two
     that are behind the experimental switch. What a reader without that switch
     gets is the Sketch and only the Sketch (docs/project/diagram.md). */
  diagram: "The drawing of the argument, and the caption written under it.",
  chat: "Your conversations with the article, and where in it each one is anchored.",
  /* Both halves, because the second is the one an owner would not predict from
     the label: the questions are **in their own words**, which is the one field
     of a saved run that is disclosure rather than article prose
     (src/public-types.ts § PublicSearchRun). Whether a visitor can ask a *new*
     one is not said on the row — it is said once, for the whole column, in
     `SHARED_NOTE` below. */
  search: "The questions you have put to this piece, in your words, and the passages they found.",
  remember: "What you said you took from the piece, and the quizzes on it.",
  referee: "Your peer-review pass over the piece: your criteria, and what it found against them.",
  /* **"went looking for", not "found"**, and the tense is the whole row. This
     is the only mode whose content is not in the article, so an owner reading
     this line has to be told what was searched rather than what exists — and
     the commonest honest answer is that nobody has written about their piece
     (src/debate.ts § the search never comes back empty). A row promising
     *"what other people said about this"* would be a claim about the web that
     an empty panel then contradicts. */
  debate:
    "What we went looking for on the open web: replies to this piece, and the argument around " +
    "the claims it makes.",
};

/* ---------------------------------------------------------------- timeline --
   What the reader is told when the piece dates something and we could not read
   the date, and when the piece has no chronology in it at all.

   Both are sentences about a **negative result rather than a failure**, which
   is the reason they are here beside `builtButEmpty` rather than in the panel:
   the mistake they exist to prevent is the panel drawing them like an error, or
   drawing two of them the same. docs/plans/260831i-timeline-mode.md § Three outcomes.  */

/**
 * **The date column, when the piece dates an event and we could not read it.**
 *
 * Short because of where it sits: a column about twenty characters wide, in a
 * list where — on an article with no publication date — **every** dated row is
 * `noYearFrame`. A full sentence repeated down twenty rows is a wall, so the
 * column carries a label and `dateRejectedWhy` carries the explanation on the
 * row the reader opens.
 *
 * Lower case, and no full stop: these are labels standing where a date would
 * be, not sentences. "26 May" has no full stop either.
 *
 * A total record rather than a function with a default, so a fourth refusal is
 * a red compile rather than a silently reused sentence.
 */
export const DATE_REJECTED_SHORT: Record<DateRejection, string> = {
  noYearFrame: "dated — but which year?",
  phraseNotInOccurrence: "dated — not in this passage",
  unparseablePhrase: "dated — we could not read it",
};

/**
 * **The same three facts at length**, for the row the reader has opened.
 *
 * The distinction that matters, and the reason these are three sentences rather
 * than one: `noYearFrame` is a fact about **us** — the article did its job and
 * we have nothing to resolve it against — where `phraseNotInOccurrence` is a
 * fact about the extraction, and the reader should read those differently. It
 * is also the majority case on this shelf, because the publication date only
 * arrives on re-extraction.
 */
export const DATE_REJECTED_WHY: Record<DateRejection, string> = {
  noYearFrame:
    "The piece gives a day and a month here but never the year, and we have no publication date " +
    "for it to take the year from. Re-adding the article will usually fix it.",
  phraseNotInOccurrence:
    "The date this event was placed by is not in the passage below, so we did not use it. The " +
    "event and the passage are the article's; the date was not.",
  unparseablePhrase:
    "The piece puts a time on this in words we could not read as a date. The passage below is " +
    "where it says so.",
};

/**
 * **The piece has no chronology in it, and that is a real answer.**
 *
 * Most articles do not tell a story in time, so this is the commonest outcome
 * of the whole mode and it must not read as a failure or offer a retry —
 * running it again would find the same nothing and cost another model call.
 */
export const TIMELINE_NO_CHRONOLOGY =
  "This piece does not tell a story in time — nothing in it is placed in a sequence.";

/**
 * **Fewer events than make a chronology.**
 *
 * The rows still show; what is withdrawn is the claim. An article that mentions
 * two dates in passing, presented under a heading as *a timeline*, is the panel
 * overclaiming — and the reader cannot tell the difference from the rows alone.
 * The threshold and the reasoning for it are in src/web/TimelinePanel.tsx.
 */
export const TIMELINE_THIN =
  "This piece is not really telling a story in time. Here is everything it puts in a sequence.";

/* ------------------------------------------------------------------ debate --
   What the reader is told when the open web had nothing for this piece — and
   the two ways that can be true.

   Here beside the timeline's pair, and for the same reason: these are sentences
   about a **negative result rather than a failure**, and the mistake they exist
   to prevent is the panel drawing them like an error or drawing two of them the
   same. The difference matters more here than anywhere else in the app, because
   the empty answer is this mode's **commonest correct output** — most pieces
   have no critical reception at all — so it is the sentence a reader will meet
   again and again, and one that overclaims is a lie repeated.

   **Never *"No one has written about this."*** OpenRouter reports a search
   *count* and never the *queries* (docs/project/chat-tools.md), so what we hold
   is evidence of a bounded search, not a claim about the web. Every sentence
   below is about *this search*, and the grammar is what carries that.
   docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md § 2.  */

/* **These are lead sentences now, not the contents of a headed section.** Until
   2026-09-06 the panel drew two headed groups, so each of these sat under a
   heading that said which of the two searches it was about, and none of them had
   to name its own search. The heading is gone — one list, each row
   self-labelling — so **every sentence here has to say which search it is
   about in its own words**, and that is why the two "unverified" forms were
   rewritten rather than moved.
   docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md § 1. */

/**
 * **No page came back that responds to this piece.** The first of the two forms
 * the lead sentence takes.
 *
 * `returnedSources === 0`: the pass ran, it reported a positive search count —
 * zero would have failed the whole step — and not one admissible page came back
 * with it.
 *
 * **It says *by name*, and that is the whole of the claim.** What a direct row
 * has to prove is that the page identifies *this* article — its address, its
 * words, or its title. A page that argues against the piece without ever having
 * heard of it is not missing from this answer; it is in the rest of the list,
 * which is what `DEBATE_CLAIMS_FOLLOW` goes on to say.
 */
export const DEBATE_RESPONSES_NONE = "No page the search found responds to this piece by name.";

/**
 * **Pages came back, and not one of them could be checked.** The second form,
 * and a different fact from the sentence above — which is why this one carries
 * the count and that one cannot.
 *
 * Every quotation is located in the *extract the search engine returned*, which
 * ran 236–4,945 characters in the Stage 0 measurements, of pages that may run to
 * tens of thousands. So a real, apt quotation that simply falls outside that
 * slice loses its row (Sol's F18). That is the right direction to fail in — we
 * lose a true row rather than admit an unchecked one — and it is emphatically
 * not the same news as *nothing came back*.
 *
 * The number is `returnedSources`: **pages the search returned**, not rows the
 * model reported and not rows we refused. A reader told *"4 pages"* can weigh
 * how thin the answer is; told nothing, they cannot tell this sentence from the
 * one above it.
 */
export function debateResponsesUnverified(pages: number): string {
  return (
    `The search found ${pages} ${pages === 1 ? "page" : "pages"} that might respond to this ` +
    `piece, but ${pages === 1 ? "it could not be checked" : "none could be checked"} against ` +
    "the words it returned."
  );
}

/** The same pair for the other search, which asks about the claims rather than the piece. */
export const DEBATE_CLAIMS_NONE =
  "This search did not find anyone writing about what this piece claims.";

/** …and the same distinction, which is why these are four sentences and not two. */
export function debateClaimsUnverified(pages: number): string {
  return (
    `The search found ${pages} ${pages === 1 ? "page" : "pages"} that might answer what this ` +
    `piece claims, but ${pages === 1 ? "it could not be checked" : "none could be checked"} ` +
    "against the words it returned."
  );
}

/**
 * **What the reader is looking at instead.**
 *
 * Appended to whichever of the two sentences above fired for the *direct*
 * search, and only when there are claim rows below it to be looking at. Without
 * it the lead is a dead end — *no page responds to this piece* over a list of
 * rows, with nothing saying what the rows are. With it, the empty answer reads
 * as a finding and a hand-off rather than as a broken panel, which is what Greg
 * asked for.
 */
export const DEBATE_CLAIMS_FOLLOW = "What follows takes up what it argues.";

/**
 * **The order means nothing, said out loud.**
 *
 * Greg asked for *"ideally from authoritative sources"* and there is no honest
 * way to rank authority: any list we maintain is wrong per domain, and on an ML
 * paper the sharpest critique is routinely a pseudonymous blog. So the host
 * leads every row — the one authority signal a reader can judge, free — and
 * this says the position of a row carries no claim, because a reader looking at
 * a list will otherwise assume it does.
 */
export const DEBATE_NO_RANKING =
  "These are in the order the search returned them — no ranking by prominence or authority is " +
  "applied, and the site each one is on is the thing to judge them by.";

/**
 * **What the quotation was checked against, which is not the page.**
 *
 * The survivor bias this discloses is real and is the reason it is on screen
 * rather than in a doc: every quotation here had to be found in the slice a
 * search engine chose, so what survives is biased toward passages a search
 * engine surfaced — which is not the same as the passages that matter.
 */
/* **"here", not "below"**, and it is not a style preference: this sentence is
   drawn twice, at the foot of the lists and on every ⓘ card, and in both places
   the quotations it is about are *above* it. It said "below" while it sat in the
   panel head, and moving it left the word pointing at nothing. */
export const DEBATE_EXTRACTS_ONLY =
  "Every quotation here was found in the extract the search returned for that page, not in the " +
  "whole page.";

/* ----------------------------------------------------------------- referee --
   What a peer reviewer is told in Referee mode, and what everybody is told at
   the point of adding an article.

   Not a failure and not an error, which is the thing to keep hold of when these
   get styled: nothing has gone wrong, and nothing here is a refusal. They are
   facts about where the text goes, put where a person can see them.
   docs/project/copy.md's first rule still governs the words — say what happens,
   in words that assume none of this.

   **The tense is the whole point of these two.** The first draft of Referee
   mode carried a notice saying that using it would send the manuscript to a
   third-party service. That was false, and falsely reassuring: by the time
   anybody reaches Referee mode the text has *already* gone — `DEFAULT_INGEST_STEPS`
   in src/pipeline.ts runs extraction, hierarchy and gists at ingest, and a PDF
   is read by a model before it is anything else. GPT Sol's review of the plan
   found it and called it the most serious thing in the draft. So the sentence
   at the *add* surface is present tense and comes first in the reader's life,
   and the one in the mode is past tense and does not pretend a choice is still
   open. docs/plans/260831an-referee-mode-for-peer-reviewers.md § Confidentiality.

   There is deliberately **no acknowledgement to tick** in either place. A box
   that says "I understand" in front of something already done would imply that
   ticking it makes prohibited use permissible, which is the opposite of true. A
   blocking attestation at ingest is a real product question and it is Greg's,
   not ours. */

/**
 * **One sentence at the point of adding an article**, before any of it happens.
 *
 * True of everything this app does, so it belongs on that page whatever happens
 * to Referee mode — and it is the sentence that makes the past-tense notice
 * below honest rather than a surprise. No gate, no checkbox, no attestation:
 * the reader is told, and then they decide.
 *
 * It says *processing* rather than naming steps or the provider. Which model
 * ran which stage is our machinery and changes; that the text leaves this app
 * is the fact a person needs. src/web/AddArticle.tsx is where it is shown.
 */
export const ADDING_SENDS_TEXT_AWAY =
  "The article's text is sent to a third-party model provider for processing.";

/**
 * **The same fact, in the past tense, for the surfaces that never got to ask.**
 *
 * `/add/<url>` and `/add/upload/<id>` are direct-entry pages for bookmarklets
 * and shared links (src/web/AddPage.tsx). They exist precisely so that the
 * whole request fits in an address, which means there is no form, no Add
 * button and no moment before the POST: the page queues ingestion from its
 * first effect. By the time anybody can read a word on it, the article's text
 * is already on its way.
 *
 * So this is `ADDING_SENDS_TEXT_AWAY` with its tense corrected, and **the
 * asymmetry between the two is the point rather than an inconsistency to tidy
 * up**. Above, the reader still has a choice, so the sentence is present tense
 * and sits beside the control that makes it. Here the choice is already spent,
 * and a present-tense warning about something already done is simply false —
 * the same mistake, and the same fix, as `REFEREE_TEXT_ALREADY_SENT` below.
 * Anyone tempted to make the three agree should change the *page*, not the
 * copy: a confirmation gate on a deliberately frictionless surface is a product
 * decision and it is Greg's.
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md § Confidentiality.
 *
 * Still no acknowledgement to tick, for the reason the block comment above
 * gives: a box saying "I understand" in front of something already done would
 * imply that ticking it made it permissible.
 */
export const DIRECT_ADD_SENT_TEXT_AWAY =
  "The article's text has been sent to a third-party model provider for processing.";

/**
 * **What a peer reviewer is told, in the past tense, because it has happened.**
 *
 * Every publisher and funder checked — NIH, NSF, Elsevier, Springer Nature,
 * Wiley, NeurIPS, ICLR — treats sending a manuscript under review to a
 * third-party AI service as a confidentiality breach *in itself*, separately
 * from anything about who writes the review. Naming them rather than saying
 * "publishers generally" is deliberate: a referee can go and check the one that
 * applies to them, and a vague warning is the kind a person scrolls past.
 *
 * **It names the audience the mode is for** — public preprints, open-review
 * submissions, and drafts shared with the reader with the author's consent —
 * rather than telling somebody to check an agreement they have already
 * breached. That is the honest instruction at this point in the story: the
 * text has gone, so the useful sentence is about which manuscripts belong here
 * at all.
 *
 * No hedging, and it must not be styled as an alarm — see
 * src/web/styles.css § referee mode.
 */
export const REFEREE_TEXT_ALREADY_SENT =
  "This article's text has already been sent to a third-party model provider — that happened when " +
  "it was added to your library. NIH, NSF, Elsevier, Springer Nature, Wiley, NeurIPS and ICLR all " +
  "count sending a manuscript that is under review to a third-party AI service as a breach of " +
  "confidentiality on its own, whoever writes the review. This mode is meant for public preprints, " +
  "open-review submissions, and drafts shared with you with the author's consent.";

/**
 * **The same fact in one line, for the shut state of the notice.**
 *
 * The notice in Referee mode is collapsed until a referee opens it — Greg,
 * 2026-09-02 — and a collapse that took the fact away with the paragraph would
 * be a dismissal wearing a chevron. So the fact itself is the label on the
 * control: whatever the referee does, this sentence is on screen.
 *
 * It is the first clause of `REFEREE_TEXT_ALREADY_SENT` and nothing else. The
 * long sentence is left exactly as it was reviewed — what is behind the
 * disclosure is *which venues call that a breach, and which manuscripts this
 * mode is for*, which is the part somebody reads once.
 */
export const REFEREE_TEXT_ALREADY_SENT_SHORT =
  "This article's text has already been sent to a third-party model provider.";

/**
 * **The second fact, and it applies to the venues that said yes.**
 *
 * A separate sentence rather than a fourth clause above, because it is for a
 * different reader — somebody whose venue permits this — and burying it in the
 * paragraph they have just decided does not apply to them is how it gets
 * missed.
 */
export const REFEREE_DECLARE_IT =
  "Venues that permit AI assistance nearly always require you to say that you used it.";

/**
 * **The third fact, and the only one in the future tense.**
 *
 * Everything else in this notice is about something that has already happened —
 * the article's text reached a model provider when it was added. This is about
 * something that has *not*, and that the referee is one press away from causing:
 * Candidates is the only control in the mode that reaches a **search engine**,
 * which is a different third party from the model provider, at a different time.
 *
 * **It is here, above the chips, rather than on the chip's tooltip**, and that
 * placement is the whole point. Candidates used to sit behind a labelled button
 * whose *visible words* named both parties before either was reached; on
 * 2026-09-06 the chip itself started the run, which moved the disclosure on that
 * button to after the fact. A `ControlTip` is not a replacement —
 * docs/project/referee-mode.md § Four labels changed says it outright, *"a
 * tooltip is not read by anybody in a hurry"*, which is what a referee is. So
 * the sentence moved to the one place that is on screen before any chip has been
 * pressed.
 *
 * **Never behind the collapse, and drawn above it.** The two sentences it sits
 * over fold away into `REFEREE_TEXT_ALREADY_SENT_SHORT`; this one does not,
 * because folding a warning about something that has not happened yet is
 * dismissing it. It is *above* them rather than below because the box is a
 * 40%-height scroller, and underneath them an expanded notice pushes this out of
 * sight while the Candidates chip stays on screen.
 *
 * If Candidates ever goes back behind a button, this line goes with it.
 * docs/plans/260906b-opening-a-mode-starts-it-generating.md § Stage 4.
 */
export const REFEREE_CANDIDATES_REACHES_SEARCH =
  "Opening Candidates may send terms drawn from this paper to a search engine, which is a " +
  "different third party from the model provider.";

/* ------------------------------------------------------------- feedback -- */

/**
 * **The report did not reach us**, and the reader still has the only copy.
 *
 * `retry` rather than `bug`, and the distinction earns its keep here more than
 * anywhere else in this file: the request that failed *is* the one that reports
 * failures. If the API or Postgres is down, the feedback channel is down with
 * it — that is the cost the plan accepts for relaying through our own server
 * rather than posting to Sentry from the browser
 * (docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md § The
 * browser posts to us). A reader told "that is a bug, tell somebody" at the
 * exact moment the way to tell somebody has broken has been handed a loop.
 *
 * So the sentence does the one thing that works when the channel is down: it
 * says the words are still on screen, and gives somewhere else to put them.
 * FeedbackDialog.tsx renders a Copy button and an email link beside it.
 */
export const FEEDBACK_SEND_FAILED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "That report did not get through. Your words are still in the box above — trying again in a " +
    "moment usually works, and if it does not, the Copy button puts the whole report on your " +
    "clipboard so you can send it by email instead. [fb-send]",
};

/**
 * Feedback is asking for a database this deployment does not have.
 *
 * `ours`, not `retry`: the filesystem store answers this route with a 501 by
 * design (src/store/index.ts), so trying again is the one thing guaranteed not
 * to work. It is a developer-machine sentence rather than one a reader meets,
 * and it is written plainly anyway because the whole point of copy.md is that
 * we do not know in advance who is reading.
 */
export const FEEDBACK_NOT_AVAILABLE: ReaderFacingFailure = {
  kind: "ours",
  message:
    "This copy of the app cannot file reports — it is running without the database they are kept " +
    "in. Trying again will not help. The Copy button below puts the report on your clipboard. " +
    "[fb-store]",
};

/* ---- the subscription allowance. docs/project/billing.md ----------------------- */

/** One article, as a refusal names it. Structural, so no import crosses here. */
interface NamedArticle {
  readonly title: string;
}

/**
 * **The most articles an offer will name before it goes back to counting.**
 *
 * Three is where a sentence stops being readable, and the cases beyond it are
 * rare: the offer needs `used − budget + 1` half-units freed, which is one for
 * the ordinary refusal and only grows for a reader who has unshared their way
 * well past the wall.
 */
const MOST_NAMED_ARTICLES = 3;

/** In quotes, and short enough that the rest of the sentence survives it. */
function quotedTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return `“${clean.length <= 60 ? clean : `${clean.slice(0, 59).trimEnd()}…`}”`;
}

/**
 * *sharing “A”*, *sharing “A” and “B”*, *sharing “A”, “B” and “C”* — and, past
 * {@link MOST_NAMED_ARTICLES}, a count with the qualifier that keeps it true.
 *
 * The qualifier is *counted against this allowance* rather than *of your
 * articles*: the reader's library also holds articles with no ledger row, which
 * sharing would not move, and nothing on screen tells the two apart.
 */
function sharingOffer(chosen: readonly [NamedArticle, ...NamedArticle[]]): string {
  const [first, ...others] = chosen;
  if (chosen.length > MOST_NAMED_ARTICLES) {
    return `sharing ${chosen.length} of the articles counted against this allowance`;
  }
  const list = others.reduce(
    (so_far, article, i) =>
      i === others.length - 1
        ? `${so_far} and ${quotedTitle(article.title)}`
        : `${so_far}, ${quotedTitle(article.title)}`,
    quotedTitle(first.title),
  );
  return `sharing ${list}`;
}

/**
 * The account has added everything its plan allows.
 *
 * **`blocked`, and the `pay-` prefix is new.** `blocked` is what `kind` is for:
 * it answers "will another go at this help", and the answer is no — the count
 * does not move because a button was pressed twice. What it must not be is
 * `retry`, which would put a Retry button on a wall.
 *
 * It stretches `blocked` slightly, and knowingly. copy.md describes that kind as
 * a refusal the reader can get past *by asking for less*, and here they get past
 * it by paying or by waiting. The alternative was a fifth kind for one case, and
 * the thing `kind` is actually consulted for — should we offer another go —
 * gives the same answer either way.
 *
 * **The third sentence is for somebody whose plan has ended**, and it exists
 * because the other two would lie to them. The free count is lifetime and
 * includes paid months, so a reader who took forty articles on Reader and
 * cancelled is past the free allowance permanently — that is the policy Greg
 * chose on 2026-09-03, over tier-scoping the count or granting a fresh
 * allowance on cancel. What it must not do is *read* as a policy failure:
 * "you have added all 3 articles a free account can add", to somebody who has
 * added forty, looks like arithmetic going wrong. So the ended plan is named,
 * resubscribing is the way back, and the numbers stay out of it.
 *
 * **All three sentences end by saying reading is unaffected**, which is the one thing
 * a reader will actually be worried about and the one promise this product makes
 * about money (Greg, 2026-09-02: *"if a user has hit their quota, they should
 * still be able to read their existing and Public-readable articles"*). Neither
 * says "upgrade" as a bare instruction: the free one names where the button is,
 * because a sentence telling somebody to do a thing without saying where is a
 * sentence that makes them hunt.
 *
 * **Each sentence names the page its own link goes to, and they are not all the
 * same page.** Both said *"the Upgrade button on your profile page"* until
 * 2026-09-04, when the buying moved to `/pricing`; both then said *"the pricing
 * page"*, and for `pay-lapsed` that was **false** — GPT Sol, reviewing stage 1
 * of docs/plans/260904b-pricing-page-and-public-showcase.md. `hasLapsed`
 * (src/store/pg-billing.ts) includes `unpaid` and `incomplete`, for which
 * `summary.purchase` answers `{ kind: "none" }` (src/billing/summary.ts), so
 * `/pricing` draws such an account no plan button at all — and an `unpaid` or
 * `incomplete` account, sent there by that sentence, arrived at a page with
 * prices and nothing to press. (The field was `canCheckout` until 2026-09-04;
 * the fact it decides is the same one.)
 *
 * `QuotaNotice` (src/web/QuotaNotice.tsx) draws the link, and it picks the
 * destination from the same code that picked the sentence, so the prose and the
 * button under it cannot disagree about where the way out is. Change a
 * destination there and change the sentence here, in the same edit.
 *
 * A factory rather than a constant because the numbers have to be in it —
 * "you've reached your limit" without the limit leaves the reader unable to tell
 * whether it is the plan or a fault. Registered in `FROM_FACTORIES` in
 * tests/messages.test.ts, since `CONSTANTS` cannot see it.
 */
export function ingestQuotaReached(quota: {
  limit: number;
  /** When the allowance resets. Absent for the free tier, whose limit is lifetime. */
  resetAt?: Date;
  /**
   * This account had a subscription and no longer has an entitled one.
   *
   * From the billing row rather than from the numbers — `Refused.lapsed` in
   * src/store/pg-billing.ts.
   */
  lapsed?: boolean;
  /**
   * **The articles this reader could share to make room** — absent when sharing
   * every one of them still would not.
   *
   * A public article counts as half against the allowance, so sharing is a way
   * out of this refusal as well as buying. **The list is computed and never
   * assumed**: `Refused.shareToMakeRoom` (src/store/pg-billing.ts) groups the
   * charged rows by article inside the entitlement window and takes the largest
   * groups first, so the sentence appears only when it is true. It is therefore
   * silent for the reader who has already shared everything, and for the reader
   * whose charged rows all predate the discount and cannot be cheapened at all.
   *
   * **Copy cannot rescue a false offer; conditionality has to** (Fable,
   * 2026-09-04), which is why this is data rather than a flag and why there is
   * no unconditional version of the sentence.
   *
   * **And they are named rather than counted**, since 2026-09-05. *Sharing one
   * of your articles would make room* is a true sentence about a set the reader
   * cannot see: a grandfathered article carries no ledger row, looks exactly
   * like the others, and sharing it moves nothing. Sharing is irreversible in
   * the way that matters, so an offer that can send somebody to the wrong
   * article is worse than no offer. `Refused.shareToMakeRoom` has the case.
   *
   * **All three refusals carry it.** Excluding `pay-lapsed` was the plan's first
   * answer and was wrong as a class — a Reader who added three private articles
   * and then lapsed is at six half-units against a free budget of six, and
   * sharing one of them makes room. GPT Sol, 2026-09-04.
   */
  shareToMakeRoom?: readonly [NamedArticle, ...NamedArticle[]];
}): ReaderFacingFailure {
  const kept =
    "Everything you have already added stays exactly where it is — reading is never limited.";

  /* Leading space, and empty when there is nothing true to offer, so each arm
     reads as one sentence stream rather than as a slot with a gap in it. */
  const share =
    quota.shareToMakeRoom === undefined
      ? ""
      : ` A public article counts as half, so ${sharingOffer(quota.shareToMakeRoom)} would make room.`;

  if (quota.lapsed) {
    return {
      kind: "blocked",
      message:
        `Your subscription has ended, so this account is back to the free allowance of ` +
        `${quota.limit} articles — and those are already spent. Trying again will not help. ` +
        `Resubscribing adds more, and your profile page is where that starts.${share} ${kept} ` +
        "[pay-lapsed]",
    };
  }

  if (!quota.resetAt) {
    return {
      kind: "blocked",
      message:
        /* **The allowance is spent, rather than "you have added all N".** Once
           a public article costs half a slot, six articles can sit against an
           allowance of three and be refused — so a sentence claiming the reader
           added exactly three is false for precisely the account reading it.
           The limit is still named, because "you have reached your limit"
           without the limit leaves nobody able to tell a plan from a fault. */
        `A free account can add ${quota.limit} articles, and this account's allowance is spent. ` +
        "Trying again will not help — the count will be the same. A subscription adds more, " +
        `and the pricing page sets one up.${share} ${kept} [pay-free]`,
    };
  }

  /* Day, month and year, in the reader's words rather than an ISO stamp, and
     `UTC` so the sentence does not change depending on where the server is
     standing — the boundary itself is Stripe's, and it is not to the hour
     anyway. All of which is now said once, in `readableDay`: this used to spell
     the same four options out again, and the only thing keeping the refusal and
     the /profile page naming one day was a sentence in billing-plan.ts saying
     they must. */
  const when = readableDay(quota.resetAt);
  return {
    kind: "blocked",
    message:
      /* The same correction as the free arm above: the allowance is what is
         spent, and how many articles it took to spend it is not this sentence's
         business — unsharing can leave forty against an allowance of twenty. */
      `This billing period covers ${quota.limit} articles, and the allowance is spent. Trying ` +
      `again will not help until your allowance starts again on ${when}.${share} ${kept} [pay-limit]`,
  };
}

/**
 * The three codes `ingestQuotaReached` can end with — *the wall said no*.
 *
 * A list rather than a prefix test, and the difference is the point: `pay-off`,
 * `pay-down` and `pay-none` are also `pay-` codes and none of them is a quota
 * refusal. A deployment with no Stripe configured, a bad minute at Stripe, and
 * a Portal press with nothing to manage are all things a reader can do nothing
 * about by subscribing, and offering them an Upgrade link would be an offer
 * that leads nowhere.
 *
 * **Kept beside the function that produces them**, so a fourth refusal added
 * above is one line away from the list that decides what is drawn around it —
 * and `tests/billing-plan.test.ts` asserts the two agree, by building all three
 * messages and comparing their codes against this array.
 */
export type QuotaCode = "pay-free" | "pay-limit" | "pay-lapsed";

/* A union rather than three loose strings, so that a fourth refusal added above
   makes every `switch` over this go red at compile time — `QuotaNotice` chooses
   a *destination* per code, and a code with no destination must not be able to
   fall through to a default that sends somebody to the wrong page. */
export const QUOTA_CODES: readonly QuotaCode[] = ["pay-free", "pay-limit", "pay-lapsed"];

/**
 * **Is this failure the quota refusing an ingest?**
 *
 * The one question `QuotaNotice` (src/web/QuotaNotice.tsx) asks before putting a
 * link beside a sentence. **Which** page that link goes to is
 * `quotaRefusalCode`'s answer, below, and it is not the same for all three.
 *
 * Asked of the **message**, because that is all a client has where these are
 * read: `readJson` throws the server's own sentence and the code is the last
 * thing in it. Reading the code rather than matching the prose is the rule
 * `kindOfMessage` already follows — the wording is free to be reworded, and a
 * classifier built out of prose silently reclassifies everything the day
 * somebody improves a sentence.
 *
 * The 402 would work too, and is not used: `statusOf` is available at the fetch
 * but not from the durable `lastFailure` string the add page keeps, and one
 * question with two spellings is one place for them to disagree.
 */
export function isQuotaRefusal(message: string | null | undefined): boolean {
  return quotaRefusalCode(message) !== null;
}

/**
 * **Which** quota refusal this is, or `null` for anything else.
 *
 * The same question as `isQuotaRefusal` and one answer further on, because the
 * three refusals do not share a remedy: a free account can buy, a subscriber at
 * their monthly limit has nothing to buy and is waiting for a date, and a lapsed
 * one may or may not be able to start again. `QuotaNotice` sends each of them
 * somewhere different, and the finding that made this necessary is in the
 * comment on `ingestQuotaReached` above (GPT Sol, 2026-09-04).
 *
 * **Still the bracketed code, never the prose.** `find` rather than `includes`
 * so the answer comes back as the union and a caller can `switch` on it
 * exhaustively; `includes` would have handed back a `boolean` and left the
 * caller to re-parse the string it had just classified.
 */
export function quotaRefusalCode(message: string | null | undefined): QuotaCode | null {
  if (!message) return null;
  const code = codeOfMessage(message);
  if (code === null) return null;
  return QUOTA_CODES.find((known) => known === code) ?? null;
}

/**
 * Billing is configured wrongly, or not at all, on this deployment.
 *
 * `ours` rather than `retry` or `blocked`: nothing the reader does changes it,
 * and it is not a refusal of what they asked for. It is what a checkout or a
 * portal route answers when `stripeConfigProblem()` has something to say — a
 * missing key, or a key from the wrong mode (src/billing/stripe.ts). Reachable
 * on a developer's machine and, if we ever get it wrong, in production; written
 * plainly for both, because copy.md's whole point is that we do not know who is
 * reading.
 */
export const BILLING_NOT_AVAILABLE: ReaderFacingFailure = {
  kind: "ours",
  message:
    "Subscriptions are not set up on this copy of the app, so there is nothing to buy here just " +
    "now. Trying again will not help — it needs somebody to configure it. Nothing you have is " +
    "affected, and reading carries on as normal. [pay-off]",
};

/**
 * Stripe itself refused or could not be reached.
 *
 * **Different from `BILLING_NOT_AVAILABLE`, and the difference is what the
 * reader should do.** That one is a deployment with no Stripe configured, which
 * no amount of trying will change. This one is a bad minute at Stripe — a
 * timeout, a rate limit, a 500 from their side — so `retry` is honest and a
 * Retry button beside it can work.
 *
 * It exists because without it every Stripe SDK failure left this app answering
 * **500 with Stripe's own sentence in it** (GPT Sol, 2026-09-03). That breaks two
 * rules at once: copy.md's *never show the provider's words*, and the one about
 * a status meaning what it says — a failure at Stripe is not a fault in this
 * server's arithmetic.
 */
export const BILLING_UNREACHABLE: ReaderFacingFailure = {
  kind: "retry",
  message:
    "We could not reach Stripe just now, so there is nothing to send you to yet. Nothing has " +
    "been charged and nothing has changed. Try again in a minute. [pay-down]",
};

/**
 * They asked for the billing portal and have never subscribed.
 *
 * `blocked` rather than `bug`: nothing is broken and the reader has not done
 * anything wrong — there is simply no billing history to manage, because the
 * Stripe customer that would hold one is created by the *first* checkout.
 *
 * **It has to say out loud that asking again gives the same answer**, and that
 * is a rule rather than a flourish: `tests/messages.test.ts` fails a `blocked`
 * message that does not. The first draft of this one did not, and the test
 * caught it. It names the way forward, as the `pay-` messages do, and it ends
 * where they all end: nothing about reading changes.
 */
export const NOTHING_TO_MANAGE: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "There is no billing to manage on this account yet — billing details only exist once you " +
    "have subscribed at least once, so asking again will give the same answer. The Upgrade " +
    "button on your profile page is where that starts. Everything you have already added stays " +
    "exactly where it is, and reading is never limited. [pay-none]",
};
