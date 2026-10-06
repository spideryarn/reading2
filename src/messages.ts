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
/* **The one module this file may take an origin from**, and its header says
   why: this one is inside the browser client's type closure, and src/source.ts
   — where the fact belongs — reaches src/fetch.ts's untyped packages. */
import type { DocumentOrigin } from "./document-origin.js";
import type { Mode } from "./modes.js";
import type { DateRejection, EmbeddingReason, FetchFailureCode, StepName } from "./types.js";
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
  const known = CODE_KINDS[code] ?? RETIRED_CODE_KINDS[code];
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
 * **The glossary's *Dig deeper* (was "Check the web").** It is the only control that term has ever
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
  /* The browser's half of `ai-unexpected` — see `PAGE_FAULT`. */
  "web-unexpected": "bug",
  /* A streamed answer that failed for a reason nobody declared — see
     `ANSWER_GAVE_UP`. `retry`, for `readerFailureOf`'s reason. */
  "ai-gave-up": "retry",
  /* The browser could not reach the server at all — see `COULD_NOT_REACH`. */
  "net-down": "retry",
  /* Sentences answered with a 5xx on purpose, registered here so `handleApi`
     can distinguish them from a dependency's or JS engine's words. The auth,
     mic and live declarations live at their throw sites rather than here. */
  "auth-down": "retry",
  "mic-not-set-up": "ours",
  "mic-unreadable": "retry",
  "mic-no-upstream": "retry",
  "mic-upstream": "retry",
  "live-not-set-up": "ours",
  /* Registered for `LIVE_UPSTREAM`, which src/live.ts throws as a declared
     failure. The diagnostic beside it carries OpenAI's own body and must never
     end in this code, or it would read as authored. */
  "live-upstream": "retry",
  "jb-slot-held": "bug",
  /* Citations' *Investigate* — src/citation-investigate.ts. */
  "cite-quoted": "retry",
  "cite-no-extract": "retry",
  "cite-unfinished": "retry",
  "cite-investigate-resting": "blocked",
  /* *Dig deeper* — src/dig-deeper.ts. */
  "dig-resting": "blocked",
  "dig-no-search": "retry",
  "cite-lookup-failed": "retry",
  "cite-gone": "blocked",
  "guess-resting": "blocked",
  "ai-not-set-up": "ours",
  /* The command bar's suggestions — see `REASON_NOT_READ`. */
  "bar-reason-unread": "retry",
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
  "ai-no-room": "retry",
  "ai-empty": "retry",
  /* `ANSWER_UNUSABLE`, below: a Referee run whose every row was thrown away.
     `retry` because the sentence ends "asking again usually works", which is
     true. It is a fact about that answer, never about the paper.

     **It took four days to register and a month to move here.** The code was
     first raised from two sentences in the runners' own files, both of which
     had asked in prose since 2026-09-02 to be registered, and one of which said
     exactly why it would not happen: *"Skipping the second has no symptom here
     — `kindOfMessage` returns null, `worthRetrying` says yes, and Retry is the
     right answer anyway."* Being right by a default's coincidence is not the
     same as being declared; tests/every-ai-code-is-registered.test.ts is what
     now says so. The two sentences became one, in this file, on 2026-10-04
     (plan 261004c § R6), which also settled the "one distinct sentence, one
     code" rule they had been breaking.

     **Registering a code is not only bookkeeping**, which GPT Sol pointed out
     and this entry was the first case of: `authored()` in
     src/monitoring-scrub.ts is `kindOfMessage(message) !== null`, so a message
     ending in a registered code has its **full text forwarded to Sentry**
     instead of being withheld. That is correct here, because the sentence is a
     fixed literal with nothing interpolated into it, which is exactly what
     that allowlist is for. Any sentence given this code must stay free of
     article prose and of anything a reader typed (docs/project/logging.md).
     `monitoring-scrub.ts` calls the vocabulary closed because
     "tests/messages.test.ts round-trips every sentence in that file", and
     since the move that is true of this one too. */
  "ai-unusable": "retry",
  /* Not a model call, and not the reader's fault either. `retry` on purpose:
     an interrupted job resumes from its artefacts rather than starting again,
     so another go is both allowed and cheap. See `INTERRUPTED`. */
  "jb-gone": "retry",
  /* **The two refusals *Dig deeper* on a glossary entry can give**, and the only `gl-` pair.
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
  /* **A glossary answer that hit its ceiling**, refused rather than shown or
     saved as whole. `retry`, `ai-mark-cut-off`'s reason: a second go usually
     fits. See `GLOSSARY_CUT_OFF`. */
  "gl-cut-off": "retry",
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
  /* **The two ways a publication is refused**, and the pair exists because the
     difference between them is money. `PublishRefused` (src/store/pg-revisions.ts)
     carried free text and no kind until 2026-09-07, so every refusal fell
     through to `retry` — and on 2026-09-05 one article was refused four times in
     thirteen minutes, each attempt completing and paying for its model call
     before meeting the identical, deterministic refusal, and each telling the
     reader that trying again was worth a go.

     `jb-publish-refused` is `bug` because the reader has no move: the remedy —
     re-running the `structure` step — belongs to whoever runs the app, and a
     *retry* is not it, since a retry skips every step that finished and reads
     the same artefacts back. `jb-publish-moved` is `retry` because for that one
     the old sentence was true all along: another publication landed first, and
     the next attempt starts from where the article now is. See
     `PUBLICATION_REFUSED` below. */
  "jb-publish-refused": "bug",
  "jb-publish-moved": "retry",
  /* **The steps that know why they stopped** — seven when this note was
     written, eight since the capability floor joined them on 2026-09-06, and
     all but one `blocked`: see § the steps that know why they stopped below for
     what that narrows and why. They are `jb-` rather than `ai-` because none of
     them is a model call: five are a document that is not there, is not what it
     claims, or has too few words in it to build from, and three are a Sketch
     that has to be drawn before the painting can be.

     `jb-source-damaged` is the one `bug` of them: a stored object that does not
     hash to its own name is an invariant of ours that broke, and it is the only
     one the reader has no move against. */
  "jb-source-gone": "blocked",
  "jb-source-damaged": "bug",
  "jb-no-article": "blocked",
  /* The capability floor, 2026-09-06: Readability handed back a parse it had
     itself concluded had failed, and stage 2 used to publish it. Its own code
     rather than `jb-no-article`'s because a code names a branch — there the
     library found nothing at all, here it found too little. */
  "jb-too-little-text": "blocked",
  /* **The same two findings about a file off a reader's disk**, 2026-09-08.
     Same `kind` and the same step, and separate codes because they are separate
     *sentences*: the fetched pair send the reader to the address the page came
     from, and an upload has none. See `documentHasNoArticle` for why that was
     a live copy bug rather than a tidy-up, and docs/project/copy.md for the
     rule that made two codes compulsory once the sentences differed. */
  "jb-file-no-article": "blocked",
  "jb-file-too-little-text": "blocked",
  /* Stage 3's own, and the one the first sweep missed: it is reachable from an
     uploaded *scan*, where a PDF's only text is a publisher record that
     `renderHtml` withholds. ⟨GPT Sol, F24⟩ See `articleHadNoText`. */
  "jb-file-no-text": "blocked",
  "jb-no-text": "blocked",
  "jb-no-sketch": "blocked",
  "jb-sketch-stale": "blocked",
  "jb-sketch-profile": "blocked",
  /* A step that reads the structure, on an article still showing the stand-in
     outline it opened with. See `STRUCTURE_NOT_BUILT`. */
  "jb-no-structure": "blocked",
  "structure-check": "retry",
  /* The Skim's two refusals: no usable Quotes, or only abstract Quotes.
     See `SKIM_NO_QUOTES` and `SKIM_ONLY_ABSTRACT_QUOTES`. */
  "jb-no-quotes": "blocked",
  "jb-only-abstract-quotes": "blocked",
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
  "ai-pdf-incomplete": "retry",
  /* The two token-budget failures, split from their own diagnostics on
     2026-09-03. `ai-too-long` is arithmetic done before the call and
     `ai-over-room` is the call coming back cut off; both withhold the button,
     for the reasons at `TooLongForOnePass` and `truncationFailure` in
     src/token-budget.ts. */
  "ai-too-long": "blocked",
  "ai-over-room": "bug",
  /* Writing quiz questions, `quiz-`. `retry`, and it means it: the batch is
     written afresh on every call, so a second one genuinely can come out
     better. See `QUIZ_NOTHING_ANCHORED`. Its sibling `quiz-spread` went on
     2026-09-30 with the band spread it refused
     (docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md). */
  "quiz-unanchored": "retry",
  /* Not a model call. `db-` rather than `ai-` so that a reader quoting four
     characters, and whoever they quote them to, can tell the two apart at a
     glance — see `STORAGE_BUSY`. */
  "db-busy": "retry",
  "db-failed": "bug",
  /* The database is ahead of this code, most likely mid-deploy. CHAT_BEING_UPDATED. */
  "db-updating": "retry",
  /* Reading something back out of this app's own API, `rd-`. Not a model call,
     not the database as the reader meets it, and not a job — it is the *check*
     that failed, behind a page that is still on screen. Its own prefix for the
     reason `db-` and `up-` have theirs: four characters should tell whoever is
     helping which part of the app the reader was in. See THREAD_RECHECK_FAILED. */
  "rd-recheck": "retry",
  /* The same family: a panel's opening list read, given up on at its deadline.
     See LIST_LOAD_TIMED_OUT. */
  "rd-timeout": "retry",
  /* And the Referee band's scan read, given up on at *its* deadline. See
     SCAN_TIMED_OUT. */
  "rd-scan-timeout": "retry",
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
  /* The same refusal for a document fetched by address. See FETCH_TOO_BIG. */
  "fetch-big": "blocked",
  /* The rest of the `fetch-` family: one for each other way a fetch by address
     can fail, and two for the catch-all. Registered because their kinds are not
     uniform, which is `up-`'s reason above. See `fetchFailed`. */
  "fetch-address": "blocked",
  "fetch-scheme": "blocked",
  "fetch-private": "blocked",
  "fetch-no-site": "retry",
  "fetch-unreachable": "retry",
  "fetch-certificate": "blocked",
  "fetch-slow": "retry",
  "fetch-redirects": "blocked",
  "fetch-login": "blocked",
  "fetch-refused": "blocked",
  "fetch-not-found": "blocked",
  "fetch-rate": "retry",
  "fetch-site-trouble": "retry",
  "fetch-type": "blocked",
  "fetch-empty": "retry",
  "fetch-declined": "blocked",
  "fetch-incomplete": "retry",
  /* Not one of the fetcher's codes: a paper source's own PDF address answered
     that it has no such document. See `FETCH_PAPER_MISSING`. */
  "fetch-paper-missing": "blocked",
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
  /* Caught before any request: the two new-password boxes disagree. */
  "auth-password-mismatch": "retry",
  "auth-password-set": "retry",
  /* Signed in, but the SDK never said whether the link was a recovery. */
  "auth-kind": "retry",
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
  /* A file whose bytes are already on this reader's shelf, or on their way
     there in another tab. `blocked`: another go is the same file. See
     `alreadyOnYourShelf` and `ALREADY_ON_ITS_WAY`; three codes because three sentences. */
  "up-dup": "blocked",
  "up-dup-archived": "blocked",
  "up-dup-wait": "blocked",
  /* A paper on the shelf with only its title and abstract read, and something
     asked of it that needs the whole article — plan 261001m. `blocked`: the
     same request gets the same answer until *Read this* has run, and that is
     what every one of these sentences says. See `NOT_READ_YET` below. */
  "np-read": "blocked",
  "np-share": "blocked",
  "np-power": "blocked",
  "np-reset": "blocked",
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
     which another go cannot fix. `fb-list` is the transient failure to read the
     reports back. See § feedback below, and
     docs/project/feedback.md. */
  "fb-send": "retry",
  "fb-store": "ours",
  "fb-list": "retry",
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
  /* Switching an article to High-powered AI with too little allowance left.
     `blocked` like the three quota refusals: another press is the same sum. */
  "pay-high-power": "blocked",
  /* A paper added without AI processing that does not fit, and *Read this*
     pressed twice on one paper — `minimalQuotaReached` and
     `READ_THIS_ALREADY_RUNNING`. `blocked`: another press is the same answer. */
  "pay-minimal": "blocked",
  "pay-reading": "blocked",
  /* Stripe had a bad minute. The one `pay-` code where another go is exactly
     the right thing to offer — see `BILLING_UNREACHABLE`, and note it is a
     different situation from `pay-off`, which is a deployment with no Stripe. */
  "pay-down": "retry",
};

/**
 * Codes no live message mints, kept because stored sentences outlive the code
 * path that wrote them.
 *
 * These stay separate from `CODE_KINDS`: that table is checked against the
 * messages this module can produce now, while `kindOfMessage` is also an
 * authorship and classification boundary for historical job errors. Removing
 * a factory must not turn one of our old sentences into untrusted prose.
 */
const RETIRED_CODE_KINDS: Readonly<Record<string, FailureKind>> = {
  /* The band-spread refusal retired with the quiz's bands in quiz/5. */
  "quiz-spread": "retry",
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
 * lookup did not** — it drained `explain()` and showed a spinner, so "above
 * this point" was an empty space and the sentence described a screen the reader
 * was not looking at. It streams since 2026-09-10, but the lesson stands: a
 * message in one file, used by callers with different interfaces, has to
 * survive all of them. Found by review, 2026-08-26.
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
 * **Referee: the model answered, and not one row of the answer could be kept.**
 *
 * Thrown by both Referee runners: `runCriterionStream`
 * (src/referee-criteria-run.ts) when every result row was discarded, and
 * `runClaimsStream` (src/referee-claims-run.ts) when every claim was.
 *
 * There are three outcomes a run can have, not two: the model found passages,
 * the model found nothing, and *the model returned something nothing could be
 * made of*. The third had no sentence until 2026-09-01. Its rows were dropped
 * and counted, correctly, and then the run was stored `done` with no results,
 * so the panel printed "the model did not find a passage for this", which is
 * the sentence for the second outcome and false for the third ⟨GPT Sol's
 * finding 4, docs/plans/260831an-referee-mode-stage3b5c-review-sol.md⟩. *Found
 * nothing* and *found things I could not use* call for different actions, so
 * they must not print the same sentence. For Claims the wrong one would read
 * as *the paper makes no claims*, a finding that sub-mode exists not to make.
 *
 * So this is a **failed run** rather than an empty one: the row goes to
 * `status: "error"`, the panel prints this and offers Try again, and a retry
 * resets the row. A *partial* loss is still a success: one usable row means
 * the run ran, and the rows that were dropped stay a log line.
 *
 * **One sentence, deliberately true of every discard path.** A row is thrown
 * away for a quote that is not in the paper, for a block id the paper does not
 * have, for a missing valence on a `diverging` criterion, and for having no
 * anchor at all. "Nothing it returned could be used" covers all four. Until
 * 2026-10-04 there were two sentences sharing this one code, one in each
 * runner's file: Criteria's said the model "pointed at passages", which a row
 * with no anchor never did, and Claims' (`CLAIMS_UNUSABLE`) said nothing "could
 * be found in the paper", which is not why a shapeless row is dropped. Plan
 * 261004c § R6.
 *
 * The rule it must keep: **a null result is evidence about the model, never a
 * claim about the paper.** tests/referee-copy-is-about-the-model.test.ts holds
 * it to that. And it is a fixed literal with nothing interpolated, which is
 * what lets its full text go to Sentry (see `ai-unusable` in `CODE_KINDS`).
 */
export const ANSWER_UNUSABLE: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The model answered, but nothing it returned could be used, so there is nothing to show. " +
    "That is about the answer rather than about the paper, and asking again usually works. " +
    "[ai-unusable]",
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
 * Six pipeline stages — arc, labels, structure, glossary, tweets, quotes — each
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

/**
 * **The work was done, and the store would not take it** — and it will not take
 * it next time either.
 *
 * `PublishRefused` (src/store/pg-revisions.ts) is the last gate before a draft
 * becomes the article: it refuses a draft with no blocks, no tree, a tree
 * `checkTree` rejects, a `structure` run that did not finish or ran against
 * different blocks, or a revision that is not this article's to publish. Until
 * 2026-09-07 it carried a list of free-text reasons and nothing else, so
 * `failureKindOf` (src/job-failure.ts) found nothing to read and fell through
 * to `retry`.
 *
 * What that cost is the whole of
 * docs/postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md.
 * A `checkTree` rule tightened over already-stored trees took roughly one
 * article in twenty off the air permanently, and each attempt to publish
 * *anything* for one of them — glossary, quotes, debate — completed its model
 * call, paid for it, and was then refused at the door. Four times on one
 * article in thirteen minutes, one of them $0.2454, every one of them shown
 * this file's `retry` sentence: *"a step that stops like this often comes out
 * differently on a second attempt — so trying again is worth a go"*.
 *
 * **`bug`, not `blocked`.** `blocked` is the one non-retryable kind that admits
 * a way out, and there is none here that a reader can take: the remedy is
 * re-running the `structure` step, which is an instruction for whoever runs the
 * app. And note that a **retry** is not that re-run — Retry skips every step
 * that finished, so it reads the identical tree back and stops in the same
 * place (src/job-failure.ts § `stageFailure`).
 *
 * **It does not say which reason it was**, and that is deliberate rather than
 * lazy. The reasons name node ids, block indices and hashes: a diagnostic for
 * whoever runs the app, addressed to somebody who cannot run anything. They go
 * to the log instead (src/jobs.ts § `endAsStorageFailure`), and thirteen
 * sentences, twelve of which say the same thing to a reader, is not the fix.
 *
 * **What it does not claim, and why the first draft claimed both.** ⟨Sol,
 * 2026-09-07⟩ It opened *"This finished its work"* and promised *"Nothing was
 * published and your library is unchanged"*. The first is false for the two
 * refusals raised while the draft is being **opened**, before a single step
 * runs; the second is false for the branch that refuses a revision which is
 * *already published*, where the work is on the shelf already. One sentence
 * stands in for eight throw sites, so it may only claim what is true at all of
 * them — the ordinary hazard of shared copy, and the reason to write the
 * narrow claim rather than the vivid one.
 */
export const PUBLICATION_REFUSED: ReaderFacingFailure = {
  kind: "bug",
  message:
    "The app would not save this article's latest result — it found something about the article " +
    "it will not publish. It has been recorded and needs fixing here; asking again would stop in " +
    "the same place. [jb-publish-refused]",
};

/**
 * **The other publication refusal, and the one where another go is the answer.**
 *
 * A draft may only replace the revision it was copied from
 * (`publishRevisionIn`, src/store/pg-revisions.ts). When the article has moved
 * on underneath it, publishing now would discard whatever landed first — so it
 * is refused, and nothing is lost by refusing it.
 *
 * `retry`, and it means it: the next attempt begins a fresh draft from what the
 * article is serving now, so the identical work over the newer base is exactly
 * what happens. This is the case that makes the refusal a **distinction** rather
 * than a blanket "never retry a publication" — get this one wrong in the other
 * direction and the fix for `PUBLICATION_REFUSED` is a second bug, withholding
 * a button that would have worked.
 *
 * It says *something else finished* rather than naming revision ids, for
 * `PUBLICATION_REFUSED`'s reason: the ids are the diagnostic and belong in the
 * log.
 */
export const PUBLICATION_MOVED_ON: ReaderFacingFailure = {
  kind: "retry",
  message:
    "Something else finished for this article while this was working, so saving now would have " +
    "thrown that away. Nothing was published and your library is unchanged. Starting this again " +
    "picks up from where the article is now. [jb-publish-moved]",
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

/**
 * **The page opened and there was no article in it** — `ReadabilityRefused`'s
 * sentence, in the two framings the reader can actually be in.
 *
 * **It does not say "Readability"**, which is the name of a library the reader
 * has never heard of and the whole reason this sentence exists — the diagnostic
 * keeps that word, for the log. And it names the usual causes rather than
 * guessing between them: they call for the same move.
 *
 * **A factory over the origin since 2026-09-08, and it was a constant written
 * for a fetched page.** Uploading a web page became possible on 2026-09-07
 * (docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md) and this
 * sentence went on saying *"the page that was fetched"* and *"it is the address
 * it came from that needs looking at"* to somebody who had handed us a file off
 * their disk. There is no address. It sent them to look at something that does
 * not exist, and it withheld the one move that does work — saving the page
 * again from the browser it still opens in.
 *
 * Found by Fable while arbitrating a *different* question, and made much more
 * visible the same day: stage 1 stopped asking uploads *"is this a document"*
 * and started asking *"is this provably something else"*, so far more odd files
 * now reach this stage
 * (docs/plans/260908a-match-the-documents-leading-tokens-instead-of-searching-for-markup.md).
 *
 * **One function rather than two constants**, so the pair is one fact: a third
 * framing, or a change to the causes, has one place to go and cannot land in
 * half of them. The origin is decided by `cameFromAnUpload` (src/fetch.ts) at
 * the throw site — the same evidence the masthead uses to say *"you uploaded
 * this"* — rather than by a flag of this module's own.
 *
 * **Its own code for the uploaded branch**, which departs from the plan that
 * asked for this and follows docs/project/copy.md instead: *"what must never
 * happen is two different sentences sharing a code"*, checked by
 * tests/messages.test.ts. `[jb-no-article]` keeps its meaning — a fetched page
 * with no article in it — so no support conversation that quoted it is
 * orphaned, and the new code tells whoever is helping that this was a file
 * before they ask.
 */
export function documentHasNoArticle(origin: DocumentOrigin): ReaderFacingFailure {
  if (origin === "upload") {
    return {
      kind: "blocked",
      /* **The causes are the ones an upload usually has.** Somebody *can* save
         a login wall or an error page to disk — the sentence is not claiming
         otherwise, and "usually" is doing that work — but neither is a common
         way to arrive here, and a list of five is a list nobody finishes. A
         page saved mid-script and a fragment of a page are what actually turn
         up. ⟨GPT Sol, F27: the first draft of this comment said "nobody
         uploads one on purpose", which is too absolute.⟩

         The move is the [up-pdf] refusal's move, in the same words, because it
         is the same move: this file cannot become a different file, and the
         browser that still renders the page can write one. **"the original
         page", not "the page"**, which would leave the reader wondering whether
         we mean the file they just sent. ⟨Sol, F27⟩ */
      message:
        "There was no article to find in the file you uploaded. That is usually a page saved " +
        "before its own scripts had filled it in, or a piece of a page rather than a whole one. " +
        "Sending the same file again cannot change that. If you can still open the original page " +
        "in a browser, saving it again from there usually produces a copy this app can read. " +
        "[jb-file-no-article]",
    };
  }
  return {
    kind: "blocked",
    message:
      "There was no article to find on the page that was fetched. That is usually a login wall, an " +
      "error page, or a page whose words only appear once its own scripts have run — and this step " +
      "would be handed the same page again, so it is the address it came from that needs looking " +
      "at. [jb-no-article]",
  };
}

/**
 * **The document came back, and there was not enough of it to read** — the
 * capability floor's sentence, and the count is in it deliberately.
 *
 * A factory rather than a constant for that reason before it took an origin:
 * *"there was no article"* is a verdict the reader can only take on trust,
 * where *"185 characters"* is a fact they can check against the page they were
 * looking at. It is also the fastest way for somebody reporting this to say
 * which page they meant.
 *
 * **It says "usually", and it never says this is an error page.** The rule that
 * produced it does not know that: it reads no markup and makes no claim about
 * what the page *is* — only that there is too little text here to build
 * anything from, which is equally true of a genuinely tiny real page
 * (src/extract.ts § `capabilityFloor`). So the causes are named as the usual
 * ones and the short-honest-page case is named beside them, because a reader
 * whose genuinely 300-character page was refused must not be told they were
 * shown a wall.
 *
 * **Its own code rather than `documentHasNoArticle`'s**, on the rule the
 * failures either side of it already follow: a code names a branch, and a
 * reader quoting four characters should land whoever is helping on the right
 * one. The move is the same for all of them; the finding is not. Both of this
 * one's codes carry `too-little-text` for that reason, and they differ in the
 * half that changes what to do — see `documentHasNoArticle` for the origin
 * split and why the uploaded branch is not the same string with a word swapped.
 *
 * The floor is Readability's own constant, not ours —
 * docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md § C1a.
 */
export function documentHadTooLittleText(
  origin: DocumentOrigin,
  chars: number,
): ReaderFacingFailure {
  /* **The threshold is not in either sentence, only the count.** The reader has
     no use for our number and cannot act on it — and `tests/messages.test.ts`
     reads any bare 400-599 in a sentence as a leaked HTTP status, which 500
     is. The count is the fact about *their* page; the threshold is ours. */
  if (origin === "upload") {
    return {
      kind: "blocked",
      message:
        `There was not enough in the file you uploaded to build an article from — only ${chars} ` +
        "characters of it could be read as article text. That is usually a page saved before its " +
        "own scripts had filled it in, or a piece of a page rather than a whole one, though a " +
        "genuinely very short page ends the same way. Sending the same file again cannot change " +
        "the count. If you can still open the original page in a browser, saving it again from " +
        "there usually produces a copy this app can read. [jb-file-too-little-text]",
    };
  }
  return {
    kind: "blocked",
    /* **"could be read as article text", not "of text"**, which the reader
       would hear as the whole page. It is the count of what the extractor got
       out of it: Medium's 404 shell has 249 characters visible and this
       reports 185, and a sentence that conflated the two would send somebody
       to count words on a page. GPT Sol, 2026-09-06. */
    message:
      `There was not enough on the page that was fetched to build an article from — only ${chars} ` +
      "characters of it could be read as article text. That is usually a login wall, an error " +
      "page, or a page whose words only appear once its own scripts have run, though a genuinely " +
      "very short page ends the same way — and this step would be handed the same page again, so " +
      "it is the address it came from that needs looking at. [jb-too-little-text]",
  };
}

/**
 * **The document was read, an article came out of it, and it had no text in
 * it** — one branch further along than `documentHasNoArticle`, in stage 3
 * rather than stage 2, and deliberately its own sentence: there the page gave
 * up no article at all, here one was extracted and there was nothing in it. The
 * reader's move is the same; a shared sentence would need a shared code, and a
 * code names a branch.
 *
 * **It was a constant with the address ending, and the sweep that split its two
 * neighbours missed it.** ⟨GPT Sol, F24, 2026-09-08 — found independently on
 * both sides, and the reproduction is Sol's.⟩ It is reachable from an uploaded
 * **PDF**, which is the shape neither of us was looking for: a scan whose only
 * text is a `publisher` record passes the extractor, `renderHtml` in
 * src/pdf-read.ts then withholds that record on purpose, and stage 3 is handed
 * a document with no prose in it. So the reader who uploaded a scan was sent to
 * look at the address it came from.
 *
 * That is the same defect as the one this stage exists to fix, one step later,
 * and it is written up here rather than only in the plan because the *lesson*
 * is about sweeps: mine was `src/messages.ts` grepped for "address", which
 * found this line, and I had it filed as out of scope on a guess about
 * reachability. The guess is the thing
 * docs/postmortems/260907c-a-heuristic-promoted-to-a-gate.md is about.
 *
 * The causes differ by origin the same way `documentHasNoArticle`'s do, with
 * one addition: for an upload this is very often a **scan of a page** — an
 * image with no text layer — which is a real thing to tell somebody, and has no
 * fetched equivalent worth naming.
 */
export function articleHadNoText(origin: DocumentOrigin): ReaderFacingFailure {
  if (origin === "upload") {
    return {
      kind: "blocked",
      /* **Two causes, and they do not share a remedy** — which is why this one
         sentence has two, where its neighbours have one. ⟨GPT Sol, F28⟩ The
         first draft named the scan and then offered the *saved page's* way out,
         *"open the original in a browser and save it again"*, which for an
         image-only PDF produces the identical image-only PDF. Telling somebody
         to do the thing that cannot work is docs/project/copy.md § rule 2, and
         it is worse here than saying nothing, because the advice sounds
         plausible enough to try twice.

         **"an image of the words rather than the words themselves"** does the
         explaining that "scan" alone does not: a reader who can *see* text on
         every page has no reason to guess that none of it is text, and without
         that clause "try a copy whose words can be selected" reads as nonsense
         about a document they are looking at the words of. */
      message:
        "The file you uploaded was read, and there was no article text in it to build from. That " +
        "is usually a scan or a photograph of a page — an image of the words rather than the " +
        "words themselves — or a page saved before its own scripts had filled it in. Sending the " +
        "same file again cannot change that. For a scan, a copy whose words can be selected or " +
        "searched is what goes through; for a saved page, letting the original finish loading and " +
        "saving it again usually produces one this app can read. [jb-file-no-text]",
    };
  }
  return {
    kind: "blocked",
    message:
      "The page was read, and there was no article text in it to build from. A paywall, an error " +
      "page, or a page whose words only appear once its own scripts have run all end this way, and " +
      "this step would read the same extracted page again — so it is the address the article came " +
      "from that needs looking at. [jb-no-text]",
  };
}

/**
 * **The Skim refuses without Quotes**, the way painting refuses without
 * a Sketch: its stops *are* the quotes, so there is nothing to put in order.
 * `blocked` because a retry would find the same empty list. The client asks for
 * `quotes` first in the same job when it knows there are none
 * (docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md), so
 * a reader meets this only when Quotes ran and kept nothing, or when the quotes
 * all sit on paragraphs the article no longer has.
 */
export const SKIM_NO_QUOTES: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "There are no quotes for this article yet, and Skim is a route through its quotes. " +
    "Open Quotes and choose them first, then open this again. Until there are some, this will " +
    "come back the same way. [jb-no-quotes]",
};

/** Quotes exist, but the route deliberately cannot use the abstract's. */
export const SKIM_ONLY_ABSTRACT_QUOTES: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "The only quotes Skim can use are in this article's abstract. Skim leaves the " +
    "abstract out, so it has no stops to plan. Planning it again now will come back the same way. " +
    "Open Quotes and use Find more; once it finds a line from the body, plan the route again. " +
    "[jb-only-abstract-quotes]",
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
    "The sketch of this article was drawn before your reader profile said what it says now, so " +
    "the painting would be made for an earlier reading of it. Draw the Sketch again — it is the chip one to " +
    "the left — and then press this one. Until it is redrawn, this will come back the same " +
    "way. [jb-sketch-profile]",
};

/**
 * **A step that reads the article's structure was asked to run before the
 * structure exists.** An article that opened early is published with a
 * stand-in outline cut from its headings, and the job that builds the real
 * structure failed or has not run; `runStep` (src/jobs.ts) refuses every step
 * after `structure` but `assets` until it has.
 *
 * `blocked`, so no Retry is offered, and so the sentence has to carry the way
 * out itself: the Structure band is where the structure is built.
 * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md § Review record, F4.
 */
export const STRUCTURE_NOT_BUILT: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "The structure of this article has not been built yet, and this is made from the structure. " +
    "Open Structure and build it there, then run this again. Until it is built, this will come " +
    "back the same way. [jb-no-structure]",
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

/** A bounded structural recovery could not establish which source page the records belong to. */
export function pdfPagesIncomplete(pages: readonly number[]): ReaderFacingFailure {
  const noun = pages.length === 1 ? "page" : "pages";
  return {
    kind: "retry",
    message:
      `The AI could not produce a complete, correctly ordered reading of ${noun} ${pages.join(", ")} ` +
      `of this PDF, even when ${noun === "page" ? "it was" : "they were"} read separately. No ` +
      `article was built from the incomplete result. Trying again may produce a usable reading. ` +
      `[ai-pdf-incomplete]`,
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
 *
 * It said until 2026-10-05 that "reading a long piece in sections is not built
 * yet". Structure and labels do read one in sections now and no longer end
 * here; every other `budgetFor` caller still can, so the message stays and the
 * clause went — docs/plans/261005c-long-document-follow-ups-stale-sentence-run-codex-overwrite-guard-breadcrumb-paragraph-source-guess-page-cap.md § (e).
 */
export const ARTICLE_TOO_LONG_FOR_ONE_PASS: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "This article is longer than this step can handle in one go. Trying again will not help — " +
    "the article is the same length each time — but a shorter piece will work. [ai-too-long]",
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
 * **The two ways *Dig deeper* on a glossary entry cannot run**, and they are not the same fact.
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
 * **The same limit, met by an address rather than a file.** The fetch stopped
 * at `MAX_UPLOAD_BYTES` (`DEFAULTS.maxBytes` in src/fetch.ts is that constant),
 * so the number here and the number in the dialog are one number.
 *
 * `blocked` because this document cannot fit under the cap. A URL may change,
 * but retrying the same document cannot make it fit. Until 2026-10-04 this
 * failure had no sentence of its own, so the
 * job card gave it the generic copy and a Retry that fetched up to the limit
 * again and failed again
 * (docs/plans/261004k-one-size-limit-for-an-upload-and-an-address.md).
 *
 * Raised by the pipeline's fetch step and nowhere else. A link preview or a
 * figure that is too big is refused under its own, smaller cap and never
 * reaches a reader as this.
 */
export const FETCH_TOO_BIG: ReaderFacingFailure = {
  kind: "blocked",
  message:
    `The document at that address is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB, ` +
    "which is the most this app can take. Trying again with the same document will not help. " +
    "Choose a smaller document, or save a shorter extract of this one as a file. [fetch-big]",
};

/**
 * **Every other way a fetch by address can fail, each with its own sentence.**
 *
 * Until 2026-10-04 `too-large` above was the only one. The rest took
 * `stepGaveUp`'s generic copy, which is `retry`, so a page that is not there
 * was offered a Retry that asked the same address and got the same answer
 * (docs/plans/261004l-four-small-queued-fixes-fetch-failure-sentences-composer-focus-stale-remember-param-marginalia-head-at-the-top.md § A).
 *
 * **The kind answers one question: will the Retry button on this job card
 * help?** It is not `FetchFailure.retryable`, which asks whether *the fetcher*
 * should try again within the same second, and gives no sentence.
 *
 * - `blocked` where the address or the site is the obstacle and will be the
 *   same obstacle next time. Each of those names the step that can work
 *   instead: check the address, or save the page as a PDF and upload the file,
 *   which the add-article dialog takes.
 * - `retry` where a later go can come out differently. Two of those are
 *   deliberately generous. `dns` covers a name that does not exist and a
 *   resolver's blip alike; the fetcher tells them apart for its own automatic
 *   retries, and the card offers Retry for both because withholding a button
 *   that would have worked is the worse mistake. `empty` is `retry` because we
 *   do not know whether an empty body will last, not because it usually will
 *   not.
 *
 * **No sentence names the address, the host or the status.** A stored failure
 * message is not a place for a reading history (docs/project/logging.md), and
 * a status is not an explanation (docs/project/copy.md, rule 1). Several codes
 * are also raised part-way down a chain of redirects, so a sentence may not
 * assume the address at fault is the one the reader typed.
 *
 * `http-error` is absent on purpose: it is two answers, decided by its status,
 * in `fetchFailed` below.
 */
const FETCH_FAILED: Record<Exclude<FetchFailureCode, "http-error">, ReaderFacingFailure> = {
  "invalid-url": {
    kind: "blocked",
    message:
      "That address, or one the site redirected to, is not a web address this app can read. " +
      "Trying again with the same address will not help. Check it for a slip or a missing part " +
      "and add it again, or save the page as a PDF and upload the file. [fetch-address]",
  },
  "unsupported-scheme": {
    kind: "blocked",
    message:
      "This app only opens addresses that begin with http or https, and that address, or one " +
      "the site redirected to, begins with something else. Trying again will not help. If the " +
      "page opens in your browser, save it as a PDF and upload the file. [fetch-scheme]",
  },
  "blocked-address": {
    kind: "blocked",
    message:
      "That address leads somewhere private rather than to the public web, and this app does " +
      "not open those. Trying again will not help. If you can open the page yourself, save it " +
      "as a PDF and upload the file. [fetch-private]",
  },
  dns: {
    kind: "retry",
    message:
      "This app could not find a site at that address. That is usually a slip in the address, " +
      "and now and then a passing fault in looking the name up. Check the address first. If it " +
      "is right, trying again in a minute is worth a go. [fetch-no-site]",
  },
  connection: {
    kind: "retry",
    message:
      "The site at that address did not answer, or the connection dropped part-way. That is " +
      "usually passing, so waiting a minute and trying again often works. [fetch-unreachable]",
  },
  certificate: {
    kind: "blocked",
    message:
      "The site's security certificate did not check out, so this app did not read the page " +
      "over that connection. That is the site's to fix, and trying again will not help until " +
      "it does. If the page opens in your browser, save it as a PDF and upload the file. " +
      "[fetch-certificate]",
  },
  timeout: {
    kind: "retry",
    message:
      "The site took too long to answer, so this app stopped waiting. A slow site often " +
      "answers on a second attempt, so trying again is worth a go. [fetch-slow]",
  },
  "too-many-redirects": {
    kind: "blocked",
    message:
      "That address kept redirecting to another address without ever arriving at a page. " +
      "Trying again would go round the same way. If the page opens in your browser, save it as " +
      "a PDF and upload the file. [fetch-redirects]",
  },
  unauthorized: {
    kind: "blocked",
    message:
      "That page is only shown to people signed in to its site, and this app cannot sign in " +
      "for you. Trying again will not help. If you can open the page yourself, save it as a " +
      "PDF and upload the file. [fetch-login]",
  },
  forbidden: {
    kind: "blocked",
    message:
      "The site refused to give this app the page. Sites that turn away automated readers " +
      "answer this way, and this one will most likely answer the same again. If the page opens " +
      "in your browser, save it as a PDF and upload the file. [fetch-refused]",
  },
  "not-found": {
    kind: "blocked",
    message:
      "There is no page at that address. The site said so, and trying again will get the same " +
      "answer. Check the address for a slip or a missing part, and add it again. [fetch-not-found]",
  },
  "rate-limited": {
    kind: "retry",
    message:
      "The site asked this app to slow down, because it has had too many requests lately. " +
      "Waiting a few minutes and trying again usually works. [fetch-rate]",
  },
  "server-error": {
    kind: "retry",
    message:
      "The site ran into trouble of its own while answering. That is usually passing, so " +
      "waiting a few minutes and trying again is worth a go. [fetch-site-trouble]",
  },
  "too-large": FETCH_TOO_BIG,
  "unsupported-type": {
    kind: "blocked",
    message:
      "What is at that address is not a web page or a PDF, and those are the two things this " +
      "app can read. Trying again will not help. If it is a document you can open, save it as " +
      "a PDF and upload the file. [fetch-type]",
  },
  empty: {
    kind: "retry",
    message:
      "The site answered with an empty page. This app cannot tell whether that will last, so " +
      "trying again is worth a go. If it comes back empty again and the page opens in your " +
      "browser, save it as a PDF and upload the file. [fetch-empty]",
  },
};

/** `http-error` with a status the site will give again. See `fetchFailed`. */
const FETCH_DECLINED: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "The site answered, but would not hand over the page, and it will most likely answer the " +
    "same way again. Check the address. If the page opens in your browser, save it as a PDF " +
    "and upload the file. [fetch-declined]",
};

/** `http-error` with any other status, or none. See `fetchFailed`. */
const FETCH_INCOMPLETE: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The site did not send the whole page in a form this app could use. That can be passing, " +
    "so trying again is worth a go. If it keeps happening and the page opens in your browser, " +
    "save it as a PDF and upload the file. [fetch-incomplete]",
};

/**
 * **A paper whose PDF is not where its source usually keeps it.**
 *
 * For a link a paper source recognises (src/paper-sources.ts) the fetch step
 * asks for the paper's PDF at an address it worked out, never the page that
 * was pasted. When the last of those addresses answers that it has no such
 * document, `not-found`'s sentence would be wrong: it tells the reader to
 * check their address for a slip, and their address is fine. What is missing is
 * an address they never saw. ⟨GPT Sol's plan review, G12⟩
 *
 * `blocked`: the same address answers the same way next time. The way out is
 * the one every `blocked` fetch names, an upload, and here the reader has a
 * page in front of them with the PDF's real link on it.
 *
 * Raised by the pipeline's fetch step and nowhere else, and only for a paper
 * source: an ordinary address that is absent still gets `[fetch-not-found]`.
 *
 * **Written without Greg**, on 2026-10-06, and recorded as his to change:
 * docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md
 * § What a wrong rule costs. It does not say "we found the page": the pasted
 * page is never fetched. And it does say to check the link, because for a
 * source whose rule is complete (arXiv) a missing paper is a mistyped id.
 */
export const FETCH_PAPER_MISSING: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "This site did not have the paper where it usually keeps it. Trying again will not help. " +
    "Check the link is right, or download the PDF from the site and upload it here. " +
    "[fetch-paper-missing]",
};

/**
 * **The sentence for one `FetchFailure`**, given its code and the status it
 * kept. Called by the pipeline's fetch step and nowhere else: a link preview, a
 * figure and a bibliographic lookup classify a failed fetch their own way and
 * never put it on a job card.
 *
 * **Total, with no default arm**: `FETCH_FAILED` is a `Record` over the union,
 * so a new code is a red compile here rather than a failure that quietly takes
 * the generic sentence and a Retry.
 *
 * **`http-error` is the fetcher's catch-all, and it is not one kind.**
 * `classifyStatus` in src/fetch.ts sends every status it has no name for there
 * (400, 405, 413, 451 and the rest of the unnamed 4xx), and so do a body that
 * arrived in part and a redirect that named no destination. A 4xx is the site
 * refusing this request, and it will refuse it again, so that half is
 * `blocked`. The exceptions are 408 and 425, which are about the moment and not
 * the request. Everything else, a missing status included, is `retry`: we do
 * not know it is lasting. ⟨GPT Sol's plan review, F1⟩
 *
 * `status` is compared and never printed, so a value that is not a number
 * falls to `retry` and reaches nobody.
 */
export function fetchFailed(code: FetchFailureCode, status: number | null): ReaderFacingFailure {
  if (code !== "http-error") return FETCH_FAILED[code];
  const refused =
    typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 425;
  return refused ? FETCH_DECLINED : FETCH_INCOMPLETE;
}

/**
 * The bytes are neither a PDF nor a web page, whatever the file is called.
 *
 * `blocked` for the same reason: renaming a file does not change what is in it.
 * Phrased around the *contents* rather than the name, because a `.pdf` that is
 * really something else is exactly the case this catches, and telling somebody
 * their PDF is not a PDF without saying why reads like a bug.
 *
 * **Two kinds since 2026-09-07** (docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md).
 * The constant was `UPLOAD_NOT_A_PDF`, and the rename is worth the churn because
 * the compiler does it for free. **The `[up-pdf]` code and the `"not-a-pdf"`
 * `RejectReason` did not move**, and those are the two that matter: a code is
 * what a reader quotes back to us (docs/project/copy.md), and the reason is a
 * string already written into `uploads.reason` rows that a rename would orphan
 * for nothing. Neither is a spelling anybody but us reads.
 */
export const UPLOAD_UNREADABLE_FILE: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "That file isn't a PDF or a web page inside, whatever its name says. Sending it again will " +
    "not help, because it will be the same file — but if it opens in a PDF reader or a browser, " +
    "saving it again from there usually produces one this app can read. [up-pdf]",
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

/**
 * The database holds a kind of conversation this copy of the app has no name
 * for: `UnknownStoredThreadKind` in src/types.ts, which carries this sentence
 * and a 409.
 *
 * In practice that is the few minutes of a deploy that renames a kind, when the
 * database has already been changed and the new code is not serving yet. The
 * app refuses to read or change the article's conversations rather than treat
 * one as an ordinary chat. "Most likely", because the same refusal would fire
 * for a row that was simply wrong, and this must not be false then. `retry`: a
 * reload after the deploy is the whole fix.
 */
export const CHAT_BEING_UPDATED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "This app is most likely being updated right now, so it could not open this article's " +
    "conversations, and it has changed nothing. Reloading the page in a minute or two and trying " +
    "again usually works. [db-updating]",
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

/**
 * A panel's saved list never arrived, so the panel stopped waiting for it.
 *
 * Saved searches, referee criteria and comments each read their whole list when
 * they open, and hold Run / Find / Save until it has — see
 * src/web/lib/opening-read.ts. This is the sentence for the third way that wait
 * ends. **One sentence for all three panels**, for the reason
 * `THREAD_RECHECK_FAILED` gives: a noun each would be three sentences under one
 * code. "Saved list" is true of all three.
 *
 * It says what the reader can safely infer: this page may be missing earlier
 * items, the button is working again, and a reload makes another attempt. It
 * does not claim the unseen rows still exist or promise that a future write
 * will succeed; this timed-out read can establish neither.
 */
export const LIST_LOAD_TIMED_OUT: ReaderFacingFailure = {
  kind: "retry",
  message:
    "Things you saved for this article took too long to arrive, so this app stopped waiting. " +
    "You can add something now; reload the page to try showing the earlier items again. " +
    "[rd-timeout]",
};

/**
 * Referee's check of the source document for hidden instructions was given up
 * on at its deadline — `useSourceScan` (src/web/useSourceScan.ts), sixty
 * seconds, through the same finite read as the lists above.
 *
 * Its own sentence rather than `LIST_LOAD_TIMED_OUT`, because nothing here was
 * saved by the reader and nothing is unlocked by the wait ending. Its own code
 * so whoever is helping can tell the two reads apart.
 *
 * It says the check **did not finish**, not that it found nothing: the notice
 * it lands in (`SourceScanNotice`) is at pains that a failed check is neither a
 * warning nor a clean bill, and this must not undo that. And it says to reload,
 * because the hook has no retry of its own, on purpose — its header says why.
 * `retry` because another attempt can work; the attempt is the reload.
 */
export const SCAN_TIMED_OUT: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The check took too long to answer, so this app stopped waiting for it. It did not finish, " +
    "so it says nothing either way about this document. Reload the page to run the check again. " +
    "[rd-scan-timeout]",
};

/**
 * **The command bar was asked to suggest from why you are reading, and the
 * reason could not be read** (src/routes.ts § `suggestFromWhyReading`, plan
 * 261005k, GPT Sol's F6). A failed read is never "you have not said why": told
 * that, a reader types over the sentence they already wrote. Nothing was sent
 * to a model, so trying again costs nothing.
 */
export const REASON_NOT_READ: ReaderFacingFailure = {
  kind: "retry",
  message:
    "This app could not read why you're reading this article just now, so it had nothing to suggest " +
    "from. What you wrote is still saved. Trying again in a moment usually works. [bar-reason-unread]",
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
 * Delete refused: a finished import of this article still holds a quota slot
 * that was never settled — `strandedReservation` in src/store/pg-shelf.ts,
 * which has the reasoning for a 500 rather than a 409.
 *
 * Moved here and coded on 2026-09-24 because `handleApi` now lets a 5xx's
 * message reach the reader only when it is declared or coded (plan 260924a
 * § Stage 2c); as a bare string it would have become `UNEXPECTED_FAILURE` and
 * lost "nothing has been deleted", which is the part the reader needs.
 */
export const DELETE_HELD_BY_UNSETTLED_SLOT: ReaderFacingFailure = {
  kind: "bug",
  message:
    "This article cannot be deleted: one of its finished imports is still holding a quota slot " +
    "that was never settled, and deleting it would spend that slot for ever. Nothing has been " +
    "deleted, and this has been reported; it needs fixing here rather than by you. [jb-slot-held]",
};

/**
 * Live voice could not start because OpenAI would not hand over a session —
 * `mintLiveToken` in src/live.ts.
 *
 * A declared failure since 2026-09-24 (plan 260924a § Stage 2c, GPT Sol's F10).
 * The old throw put OpenAI's own response body, 400 characters of it, into the
 * message and ended it in `[live-upstream]`, so it reached the reader and the
 * client recognised it by the code. `handleApi` now lets a 5xx's words out only
 * when declared or coded, so the body stays in the diagnostic (the log) and this
 * sentence — still ending in the code `startupMessage` in
 * src/web/live/useLiveConversation.ts looks for — is what travels.
 */
export const LIVE_UPSTREAM: ReaderFacingFailure = {
  kind: "retry",
  message:
    "Live voice could not start, because the voice service did not hand over a session. Trying " +
    "again in a moment usually works; typing carries on as normal. [live-upstream]",
};

/**
 * The request never got a response at all — the reader's connection, or the
 * server not being there.
 *
 * Until 2026-09-24 five places in the client said *"is `npm run dev` still
 * running?"* here, to readers on production who have never heard of it. The
 * development build still adds that hint — `couldNotReach` in
 * src/web/lib/reader-facing.ts — and this is what everyone else reads. It does
 * not guess which side is at fault, because the client cannot tell.
 */
export const COULD_NOT_REACH: ReaderFacingFailure = {
  kind: "retry",
  message:
    "Couldn't reach the server, so nothing was sent or received just now. That is usually the " +
    "connection; trying again once it is back should work. [net-down]",
};

/**
 * A streamed answer failed after its headers went out, for a reason nobody
 * wrote the reader a sentence about.
 *
 * The streaming routes in src/routes.ts used to put `(err as Error).message`
 * in their `error` frame and on the stored row — whatever a driver, a parser or
 * a `fetch` happened to say reached the reader verbatim (plan 260924a § Stage
 * 2b, GPT Sol's F5). `sayToReader` in src/reader-sentence.ts now sends a
 * declared sentence or this one, and the real error goes to the log.
 *
 * **`retry` rather than `UNEXPECTED_FAILURE`'s `bug`**, for the reason
 * `readerFailureOf` in src/job-failure.ts gives: nobody said what kind it was,
 * so the reader keeps the offer of another go. These routes are model calls,
 * and an undeclared failure there is most often a connection that broke.
 */
export const ANSWER_GAVE_UP: ReaderFacingFailure = {
  kind: "retry",
  message:
    "This answer stopped for a reason this app could not explain to you; what happened has been " +
    "recorded. It was not anything you did, and trying again is worth a go. [ai-gave-up]",
};

/**
 * The page caught an exception nobody wrote a sentence for.
 *
 * The browser's half of `UNEXPECTED_FAILURE`, and for the same reason: the text
 * of whatever escaped — React's own `Minified React error #185`, a `TypeError`
 * from a bug, a parser's complaint — is not ours to publish and says nothing a
 * reader can act on. It reached a reader on 2026-09-12 as a chat answer's
 * failure (docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md).
 *
 * Says **not necessarily the server**, because the one time it was seen the
 * server had finished the answer and the page lost it — so reloading is the
 * honest next step, not asking again. Raised by `describeFetchFailure` in
 * src/web/lib/describe-failure.ts, which also reports the exception to Sentry.
 */
export const PAGE_FAULT: ReaderFacingFailure = {
  kind: "bug",
  message:
    "This page ran into a fault of its own while handling that, so what you see may be out of date " +
    "rather than lost — reloading the page usually shows whatever the server did finish. It is a bug " +
    "in this app that needs fixing here, not something you did. [web-unexpected]",
};

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

/**
 * A glossary explanation ran into its token ceiling and stopped part-way.
 *
 * `MARK_CUT_OFF`'s reasoning, for the glossary: `explainStream` keeps a
 * truncated answer for a comment, which has nowhere to say it was cut, but the
 * glossary's only reader of a finished answer draws it as finished — so a cut
 * one is refused rather than shown, or saved, as whole.
 * docs/plans/260910g-stream-glossary-answers-as-they-arrive.md.
 */
export const GLOSSARY_CUT_OFF: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The explanation ran past the room it had and stopped part-way, so it is not shown as a " +
    "whole answer. Trying again usually gets one that fits. [gl-cut-off]",
};

/** The call succeeded and the model said nothing. */
export function saidNothing(finishReason: string | null): ReaderFacingFailure {
  if (finishReason === "content_filter") return FILTER_STOPPED_IT;
  /* **What `length` with no text actually means.** Not that the input was too
     big — the input does not count against `max_tokens` at all, and a prompt
     too long for the model is refused before anything streams. The completion
     allowance was used before this caller received text. Reasoning is one way
     that happens, and it is what happened on every long paper Referee Claims
     was given until 2026-09-28
     (docs/postmortems/260928b-a-lesson-kept-in-a-helper-does-not-reach-the-other-wire.md).
     The sentence here used to blame the input and advise asking about a
     shorter stretch — a control that Claims, Criteria and Mirror do not have,
     and a diagnosis that was false for every caller. It must not replace that
     diagnosis with "thinking", either: `saidNothing` is shared by callers that
     can receive tool-call and other non-text deltas, and it is not passed the
     usage counters that could distinguish them.

     `retry`, because the amount of reasoning varies between otherwise
     identical runs — 2.4x in the long-paper measurement — and these fixed-ask
     callers give the reader no way to make a narrower request. `blocked` means
     an unchanged request will be refused again; that is not known here. */
  if (finishReason === "length") {
    return {
      kind: "retry",
      message:
        "The AI service used all the room it had before it produced any text. That is a limit on " +
        "our side rather than anything about the article, and trying again can come out " +
        "differently. [ai-no-room]",
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
    "If the link opens in a new tab, come back to this tab afterwards to carry on where you left off. " +
    "[auth-confirm]"
  );
}

/**
 * A password-reset link has been asked for. Not an error.
 *
 * **It does not say whether the address has an account.** GoTrue answers the
 * same for an address it has never seen, so we could not say if we wanted to,
 * and a sentence that did would tell a stranger who reads here.
 *
 * **"In this browser"** because the link is PKCE: the verifier that finishes it
 * was written to this browser's storage when the reader pressed the button, and
 * the link opened anywhere else ends at `[auth-nosession]`: without the stored
 * verifier the SDK does not recognise the URL as a PKCE callback, so it never
 * attempts an exchange. The installed SDK's `_isPKCECallback` decides this.
 * docs/plans/261001i-password-reset.md.
 */
export function authResetSent(email: string): string {
  return (
    `If there is a Spideryarn account for ${email}, a link to choose a new password is on its way. ` +
    "Open it in this browser. [auth-reset-sent]"
  );
}

/**
 * A link exchanged into a session, but the SDK never said whether it was a
 * password recovery. It promises to, so this is our invariant failing, not the
 * reader's doing — and guessing "sign-in" would quietly break the email's
 * promise of a new password. The reader *is* signed in, so the sentence says so
 * first. GPT Sol, plan review of 261001i, finding 2.
 */
export const AUTH_KIND_UNKNOWN: ReaderFacingFailure = {
  kind: "retry",
  message:
    "You are signed in, but this page could not tell whether your link was a password reset. To " +
    "choose a new password, sign out from your profile and ask for a link again. [auth-kind]",
};

/**
 * Setting the new password threw rather than answering: the connection, or
 * storage the SDK could not write. GoTrue's own refusals (too short, the same as
 * the old one) are shown in its words instead, as the sign-in form does.
 */
export const AUTH_PASSWORD_SET_FAILED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "Your new password could not be saved. Check your connection and try again. [auth-password-set]",
};

/** The two new-password boxes disagree. Caught before anything is sent. */
export const AUTH_PASSWORD_MISMATCH: ReaderFacingFailure = {
  kind: "retry",
  message: "Those two passwords are not the same. Type the new one in both boxes again. [auth-password-mismatch]",
};

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
 * **The same place, for somebody who came by a private link**, in place of the
 * sentence above. Greg asked for it when he approved the link (plan 261005e
 * § What Greg decided): the page says it is a private link, not visible to
 * anyone without it.
 *
 * Drawn when the server says `sharedBy: "link"`, which it says only of an
 * article that is not public. A public article opened with a key gets the
 * sentence above, because public wins.
 */
export const SHARED_BY_PRIVATE_LINK =
  "This is a private link. This article isn't listed anywhere, and nobody can see it without the link.";

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
 * back through `ArticlePage` with no reader (src/web/article/ArticlePage.tsx), so on a shared
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
 * **The artefact was never built.** One of the two `VisitorGap` sentences, and
 * the only one with no precedent anywhere: none of the products researched has
 * a pipeline that can simply not have run.
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
 * A shared link carries those four artefacts now, and there is no second request
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

/* **`readersOwnWork` was here, and it is gone** — deleted 2026-09-08 with the
   `readers-own` VisitorGap variant that was its only caller (web/visitor.ts).

   It said: *"X belong to whoever added this article. A shared link carries the
   piece, never anybody's notes about it."* Greg's fifth decision, 2026-08-27,
   and true for eight days: on 2026-09-04 a shared link started carrying the
   owner's comments (260904c § Stage 3).

   **Not because the opt-in it anticipated arrived — Greg declined that.** Sol
   argued for keeping the variant on the grounds that it is the right sentence
   for a public article whose owner has *not* opted into sharing reader work,
   and 260904c agrees that is true and conditional on a consent flag, which is
   in that plan's § Not doing. With no flag there is no such state and no
   producer. **If a consent flag ever arrives, this sentence and the
   `readers-own` variant come back with it** — that instruction is 260904c's and
   this is the second place it is written down.

   Recorded here rather than only in the history because of what happened in
   between. 260904c decided the member "goes"; nobody deleted it, and the
   drawer's own comment in Dock.tsx has said it was gone since that day. So for
   four days there was a dead, false, still-exported sentence that every check
   agreed was fine, and on 2026-09-07 the Comments button was written from half
   of it — read out to visitors directly above the comments it told them they
   would not be given (260907b § The find). A message with no caller is not
   inert: it is a sentence waiting to be copied. */

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
 *
 * ## `LABEL` rather than `HEADING`, since 2026-09-16
 *
 * **This is the page's shared reader-facing name**, not just the words over the
 * list: the `<h1>` (PublicLibraryPage.tsx), the footer row
 * (src/web/SiteFooter.tsx § `LINKS`) and the command bar
 * (src/web/CommandBar.tsx). It was `PUBLIC_SHELF_HEADING` until the footer link
 * arrived, and the rename is the same call `CHANGELOG_LABEL` records
 * (src/web/router.ts): a name that says where a string is drawn goes stale the
 * first time it is drawn somewhere else, and then it argues against reuse — the
 * next person reads `HEADING` and writes a second literal for their nav link
 * rather than importing this.
 *
 * **Which is exactly what had happened.** The command bar called this page
 * *"Public shelf"*, a literal of its own, taken from the name
 * docs/project/public-shelf.md uses — and *that* is the internal name, the same
 * mistake `CHANGELOG_LABEL`'s note describes about *Changelog*. It now reads
 * this constant, with *public shelf* kept as an alias.
 *
 * **Two literals of these words survive**, deliberately and not happily: the
 * browser tab (src/web/page-title.ts § `public-library`) and the *← Back* link
 * on `/features/public-readable-sharing`. Both already say the right thing, so
 * folding them in would change no behaviour, and GPT Sol's review of
 * docs/plans/260916a-add-a-link-to-the-public-shelf-in-the-site-footer.md called
 * it more than that change needed. They are named here so the next person to
 * touch either does not have to find out on their own.
 *
 * **The prose on `/privacy` still says "our public shelf"** and should. That is
 * a sentence describing the thing, not a name for a destination a reader
 * presses, and the two are allowed to differ.
 */
export const PUBLIC_SHELF_LABEL = "Shared articles";

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

/**
 * **The banner on a shared article** — three more lines in the visitor's
 * `SharedNotice` (src/web/PublicChrome.tsx), on Greg's ask, 2026-09-29:
 *
 * > For anything public readable, let's make sure there's a banner at the top
 * > … that highlights the URL where it came from … if you're the, you know, IP
 * > owner and you don't want this to be public readable, that email … hello at
 * > spideryarn.com and we'll take it down. And … that we explicitly use models
 * > that don't train on your content, and then point them to the privacy page.
 *
 * docs/plans/261002g-a-banner-on-every-public-readable-article.md.
 *
 * **Pointers, not restatements.** What *taken down* means, what to put in the
 * email and how long it takes belong to `/privacy` § If something here is
 * yours, and the hedge on the training promise belongs to `/privacy`'s
 * paragraph about providers. These lines say the mailbox and the promise, and
 * link to the place that qualifies each — the link is load-bearing (GPT Sol,
 * plan review). **No "provide evidence"**: Greg's transcript starts that clause
 * and drops it, and `/privacy` promises the opposite.
 *
 * **"Source", not "first published at".** The address is stage 1's post-redirect
 * URL, or for an upload a page we matched, and neither proves which copy came
 * first (GPT Sol, plan review P1-2). The guessed leads are the metadata page's
 * own words for the same two kinds (Metadata.tsx § `GuessedLine`).
 *
 * Second person is the author here, as on the sharing page
 * (docs/project/public-readable-sharing.md § The page has two readers).
 * tests/shared-notice-banner.test.tsx pins the training phrases against the two
 * pages that make the same promise.
 */
export const BANNER_SOURCE = "Source:";
export const BANNER_SOURCE_GUESS_CANONICAL = "Probably the original:";
export const BANNER_SOURCE_GUESS_MATCHING = "A page that matches this paper:";
/** Then the address as a `mailto:` link, then `BANNER_TAKEDOWN_AFTER`. */
export const BANNER_TAKEDOWN_BEFORE = "If this is yours and you'd rather it weren't here, email";
export const BANNER_TAKEDOWN_AFTER = "and we'll take it down.";
/** The link to `TAKEDOWN_HREF`, after the sentence above. */
export const BANNER_TAKEDOWN_LINK = "What that involves";
/** Then a link to `/privacy` reading `BANNER_TRAINING_LINK`, then a full stop. */
export const BANNER_TRAINING =
  "Nobody trains a model on it — a commitment we hold ourselves to, explained in our";
export const BANNER_TRAINING_LINK = "privacy policy";

/* ── Sharing a document, for the owner ─────────────────────────────────────── */

/** The switch, off. */
export const SHARING_OFF = "Only you can read this.";

/**
 * **The switch, off, while the article has a private link** (plan 261005e).
 * The sentence above would be false then, on the card whose job is to say who
 * can read the article. The card draws this one in its place.
 */
export const SHARING_OFF_WITH_LINK =
  "This is not public. You can read it, and so can anyone who has the private link.";

/**
 * **The switch, off, when the card could not read whether there is a private
 * link.** It says what it knows and makes no claim about who else can read.
 */
export const SHARING_OFF_LINK_UNKNOWN = "This is not public.";

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
 * sharing card's line, the shelf badge's hover (`SHARING_BADGE`), and the
 * masthead's mark while the article is known to be unarchived. The masthead
 * substitutes `SHARING_MARK_ON_ARCHIVED` or
 * `SHARING_MARK_ON_ARCHIVE_UNKNOWN` when the listing clause cannot be made.
 * So the listing is a clause inside the existing sentence and not a second
 * sentence after it: a badge tooltip and a link's description have to read as
 * one voice, and two sentences read as a correction of the first.
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
 * What the Copy button says when the copy did not happen — no clipboard in
 * this browser, or one that refused. It names the way round, because the link
 * is in a box beside the button and selects itself on focus.
 * AccessSharing.tsx § `CopyLink`.
 */
export const SHARING_COPY_FAILED =
  "Your browser would not allow the copy. Select the link and copy it by hand.";

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
 * **The mark at the top of the article, in two states — and where pressing it
 * goes, said apart from the state.**
 *
 * These two were the state with the destination glued on — *"Only you can read
 * this. Share it with anyone."* — until 2026-10-02. Greg (spya-d886ah): *"One
 * sentence is a statement of the current state. The other is a potential
 * action. But there's no explanation of what this means or how this
 * functionality works, or any UI differentiation between these two kinds of
 * sentence."* So the state is `SHARING_ON`/`SHARING_OFF` alone again, in the
 * card's `what`; what sharing means is `SHARING_MARK_HOW_*`; and these are the
 * press, in `ControlTip`'s `press` line, styled as a different kind of sentence.
 * docs/plans/261002e-sharing-mark-tooltip-separates-state-from-action.md.
 *
 * **They name the Metadata page, not *Access & sharing*, because that is where
 * the link lands** — the top of the page, where `Share…` is the first button
 * (Metadata.tsx § `TopActions`). Landing on the section itself is deferred in
 * the plan; when it lands, these get shorter.
 *
 * The history below is of the version these replaced.
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
export const SHARING_MARK_PRESS_PUBLIC =
  "Press to go to this article's Metadata page, where you can stop sharing it.";

/** The other state of the mark above. */
export const SHARING_MARK_PRESS_PRIVATE =
  "Press to go to this article's Metadata page, where Share… starts it.";

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
 * **The private twin says what sharing would be**, since 2026-10-02. It used to
 * say only that nothing had left the account, and Greg's report on this card
 * (spya-d886ah) was that it offered sharing with *"no explanation of what this
 * means or how this functionality works"*. So: what a shared article is (a page
 * anyone can read, listed — `SHARING_ON`), what rides on it (`ALWAYS_SHARED`,
 * and *most* of the AI's work because some modes stay behind — Chat among
 * them; shared-inventory.ts derives the list, and the card names none so it
 * cannot fall out of step), and that pressing Share… does not do it
 * (`SHARING_OPEN_TIP`). Every clause is one of those three, checked against
 * them, so this does not become a fourth near-miss of the same promise.
 */
export const SHARING_MARK_HOW_PUBLIC =
  "Stopping sharing refuses the next request for it and takes it off the public list — whatever " +
  "somebody has already read or copied stays with them.";

/**
 * **`SHARING_ON` for an article that is shared and archived**, where its second
 * half is false: archiving takes a public article off the public list while its
 * link keeps working (src/store/public-library.ts § the `archivedAt` clause).
 * A surface that knows both facts draws this: the masthead's mark and the paper
 * card (`PaperCard.tsx`). The sharing card and the shelf badge still say
 * `SHARING_ON` — deferred in
 * docs/plans/261002e-sharing-mark-tooltip-separates-state-from-action.md.
 */
export const SHARING_MARK_ON_ARCHIVED =
  "Anyone with the link can read this without signing in. It's archived, so it isn't listed publicly.";

/**
 * **The public state while the archive question is unknown.** Public visibility
 * still proves that the direct link works (`publicSlug` ignores `archived_at`),
 * but the public listing requires `archived_at is null`, so silence about the
 * archive state cannot honestly promise the listing. `useArchive` reaches this
 * state when the article payload cannot say, or after both a write and its
 * verifying read fail.
 */
export const SHARING_MARK_ON_ARCHIVE_UNKNOWN =
  "Anyone can read this without signing in. Whether it's listed publicly couldn't be confirmed.";

/** @see SHARING_MARK_HOW_PUBLIC */
export const SHARING_MARK_HOW_PRIVATE =
  "Sharing gives it a public page that anyone can read without signing in, listed publicly: the " +
  "article, most of what the AI made of it, and your comments. Nothing goes until you have seen " +
  "the full list and confirmed.";

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
  "aids written for it — including the summaries, glossary, ideas, quotes, timeline, skim, " +
  "FAQ, citations and Debate. It also carries the " +
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
 * (src/billing/points.ts), so making one private again puts the other half
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
export function sharingConfirmBody(title: string | null): string {
  /* No title: the add page asks while the article is still importing, and an
     import may not have found one yet (`SHARE_AT_ADD_LABEL`, below). */
  const named = title === null ? "this article" : `“${title}”`;
  return (
    `This puts the whole extracted text of ${named} where anyone can read it without ` +
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
  /* Owner-only, and listed all the same, for `illustrated`'s reason: its
     `profileHash` is the reader's own, and `ProfileCarrying` asks. */
  skim: "your route through the quotes",
  simple: "your plain-words summary",
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

/* ------------------------------------------- while an article is importing --
   The same switch, offered on the add page before the article exists, and the
   address the import will have. Greg, 2026-10-05 (spya-h7skj5, spya-e9t58e);
   docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md.
   Drawn by src/web/AddShare.tsx, `JobCard` (src/web/AddArticle.tsx) and
   src/web/article/StillBeingAdded.tsx.

   The confirmation is the Metadata card's own, word for word
   (`SHARING_CONFIRM_TITLE`, `sharingConfirmBody`, `SHARING_RIGHTS_CONFIRM`).
   What is written here is only what is true of an import and not of an
   article. */

/**
 * The tip on a job card's copy-the-link button.
 *
 * **It promises the address of this import, not of the article for good**: a
 * Retry can come back under another slug (`slugForRetry`, src/jobs.ts), and a
 * failed or cancelled import leaves the address leading nowhere. GPT Sol's
 * plan review, P2-6.
 */
export const IMPORT_LINK_COPY_TIP =
  "Copy the link this import's article will have. It opens for you once the import has " +
  "finished, and for anyone else only if you share it. If the import fails, the link leads " +
  "nowhere.";

/** The copy did not happen. The card has no box holding the link, so this is followed by the address itself. */
export const IMPORT_LINK_COPY_FAILED = "Your browser would not allow the copy. The link is";

/** The add page's third box. */
export const SHARE_AT_ADD_LABEL = "Make it public";

/** Under the label, before anything is pressed. Nothing goes out on the tick: it opens the confirmation. */
export const SHARE_AT_ADD_WHAT =
  "Anyone can read it without signing in, and it is listed publicly, once the import has " +
  "finished. Ticking this shows what would be shared and asks you to confirm.";

/**
 * **The import adopted an article already on the shelf** (`freeSlug`,
 * src/jobs.ts), which may have a glossary, notes and comments. The add page
 * offers no switch over those: the Metadata card lists what that article
 * really carries. GPT Sol's plan review, P2-2.
 */
export const SHARE_AT_ADD_ALREADY_AN_ARTICLE =
  "This article is already on your shelf. Share it from Access & sharing on its Metadata page.";

/** Confirmed, and not sent yet: the import has not made the article's row. */
export const SHARE_AT_ADD_WAITING = "Will be made public as soon as the import is ready for it.";

/**
 * The switch is on. **"Once the import has finished"**, because a public
 * article with nothing published is readable by nobody
 * (src/store/public-reader.ts § `publicCurrentRevisionQuery`).
 */
export const SHARE_AT_ADD_ON =
  "Public. Other people can read it at this link once the import has finished.";

/** Five minutes of *not yet* while the job sat queued. `settle` sends it again at completion. */
export const SHARE_AT_ADD_GAVE_UP =
  "Not shared: the import had not started after five minutes. It will be tried again when the " +
  "import finishes.";

/**
 * A write did not come back, and it may have taken effect:
 * `SHARING_WRITE_UNCERTAIN` says why. That one says *reload the page*, which
 * on the add page would start the import again.
 */
export const SHARE_AT_ADD_UNKNOWN =
  "That did not come back, so we cannot say whether it took effect. Check Access & sharing on " +
  "the article's Metadata page.";

/**
 * **The page was reloaded after this tab asked to make the article public,
 * and the import has not published.** *Asked*, not *made*: the mark is
 * written before the request and kept through an answer that never came, so
 * that it took is not established (GPT Sol's fix check, F18). Nothing on the server can be asked about
 * visibility until it has, so the box does not claim either state: it is
 * drawn ticked, with this, and unticking sends the private write. The tab's
 * own memory is a hint and not an answer (src/web/add-share.ts §
 * `ShareIo.marks`). GPT Sol's code review, F10.
 */
export const SHARE_AT_ADD_RECALLED =
  "You asked to make this public before this page was reloaded, and we cannot read back " +
  "whether it is until the import has finished. Untick this to make it private.";

/** The owner opened the import's address before the article was published. src/web/article/StillBeingAdded.tsx. */
export const STILL_BEING_ADDED_HEADING = "Still being added";
export const STILL_BEING_ADDED =
  "This article is still being imported. It opens here when the import has finished.";

/* ------------------------------------------------------ the private link --
   The owner's other control on the same card: a link that lets anyone who has
   it read the article, without listing it. Plan 261005e. Drawn by
   src/web/PrivateLink.tsx.

   The rights tick-box above and the inventory below are the public switch's
   own and are reused as they are: a private link republishes the same text,
   to fewer people. What is written here is only what differs. */

/** The control's heading. */
export const PRIVATE_LINK_HEADING = "Private link";

export const SHARING_MARK_NAME_LINK = "Private link — manage sharing";
export const SHARING_MARK_PRESS_LINK =
  "Press to go to this article's Metadata page, where you can turn off its private link.";

/** What a private link is, said under the control in both states. */
export const PRIVATE_LINK_WHAT =
  "Anyone who has the link can read this without signing in, and can pass it on. A private link " +
  "does not list the article anywhere.";

/**
 * **Both are on.** Public wins: the article is readable with any key or none,
 * so the owner must not think turning the link off closes it.
 */
export const PRIVATE_LINK_ALSO_PUBLIC =
  "This article is also public, so its ordinary address works without the link. Turning the " +
  "link off will not make the article private.";

export const PRIVATE_LINK_CONFIRM_TITLE = "Share the full text of this article by a private link?";

/** The confirmation's first sentence. `sharingConfirmBody` is its public twin. */
export function privateLinkConfirmBody(title: string): string {
  return (
    `This puts the whole extracted text of “${title}” where anyone who has the link can read ` +
    "it without signing in. Making this link does not list the article anywhere, but anyone you send the link to can pass it on."
  );
}

/** What turning the link off can and cannot do. `SHARING_CANNOT_UNRING` is its public twin. */
export const PRIVATE_LINK_CANNOT_UNRING =
  "Turning the link off refuses the next request made with it, and making a link again makes a " +
  "new one. It cannot take back a page somebody's browser already has, or anything they copied " +
  "out of it.";

/** A write is in flight. */
export function privateLinkInFlight(to: "on" | "off"): string {
  return to === "on" ? "Creating the link…" : "Turning the link off…";
}

/** The read failed, so nothing was asked of the server and nothing changed. */
export const PRIVATE_LINK_UNKNOWN =
  "We could not check whether this article has a private link, so nothing is offered here — " +
  "reload the page to try again. Nothing has been changed.";

/** A write did not come back. It may have taken effect: `SHARING_WRITE_UNCERTAIN` says why. */
export const PRIVATE_LINK_WRITE_UNCERTAIN =
  "That did not come back, so we cannot say whether it took effect — it may have. Reload the " +
  "page to see whether the link is on.";

/** The three tooltips on the three controls. */
export const PRIVATE_LINK_OPEN_TIP =
  "Nothing goes out yet. This opens a list of exactly what somebody with the link would get, " +
  "and asks you to confirm before a link is made.";
export const PRIVATE_LINK_STOP_TIP =
  "The link stops working, so the next request made with it is refused. What somebody has " +
  "already read or copied stays with them.";
export const PRIVATE_LINK_COPY_TIP =
  "Puts the link on your clipboard. Anyone you send it to can read the article, and can send " +
  "it on.";

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
      "its links — not a summary of it — and the links we drew between its own passages, where there are any.",
  },
  {
    key: "pictures",
    label: "Its pictures",
    /* **Which server sends the bytes has changed once already, so the sentence
       names both.** Until the images were rehosted every `<img>` pointed at the
       publisher and this row said so; since then a visitor's browser asks our
       public asset route first (src/web/rehost.ts) and falls back to the
       publisher only for a picture we hold no copy of. GPT Sol's C3 on plan
       261005e found the old sentence still here. */
    detail:
      "Every image in the article. A visitor's browser gets them from the copy we keep, or from " +
      "the publisher where we have no copy.",
  },
  {
    key: "provenance",
    label: "Where it came from",
    /* **"where we have one", because sometimes we do not publish it.** An
       uploaded PDF has no address at all, and `publicSourceUrl` (src/urls.ts)
       refuses some of the ones we do have — a `user:pw@` address among them. The
       masthead already draws the absence honestly; a flat promise of a link here
       would be the one row of this list the article itself contradicts.

       **And for an upload, the page we matched it to**, since 2026-10-02: a
       found source guess crosses to a visitor's banner (plan 261002g,
       `PublicArticle.sourceGuess`), so the owner is told it goes out.

       **And the journal and when it was published**, since 2026-10-04 (plan
       261004h): the day, or the year alone for a paper dated only to a year.
       "Where we know them", because most articles have neither. */
    detail:
      "The article's title, byline, publication, language and one-line excerpt; its journal and " +
      "when it was published, where we know them; plus a source link where we have one — for an " +
      "uploaded file, that may be a page we found that matches it.",
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
 * **The artefacts that cross but have no mode of their own** — this one and
 * `SHARED_THREAD` below.
 *
 * `SHARED_TWEETS` was here first, and GPT Sol pointed out on 2026-09-02 that
 * the arc was in the same position and quietly missing: `available.arc` was
 * computed, sent, and never read. From 2026-09-29 to 2026-10-03 the thread was
 * a mode, and the sweep over `MODES` listed it instead; it is back as a row of
 * its own now that it is one of Summary's views.
 *
 * The arc is the extra rung Outline draws when there is one, so Outline is
 * shared either way and the arc is a separate row rather than a condition on it.
 */
export const SHARED_ARC = {
  key: "arc",
  label: "The arc",
  detail: "One sentence per part saying where the argument has got to — the top rung of Outline.",
};

/**
 * **The thread, which crosses when there is one and has no mode to be swept.**
 *
 * It is Summary's Thread view since 2026-10-03, and Summary is `available` to
 * a visitor whatever is stored (src/web/visitor.ts § `POLICY`), so the sweep's
 * Summary row cannot say whether a thread goes out. This row can: it is listed
 * as shared when `available.tweets`, and under *if built* otherwise — exactly
 * where the Tweets mode's row stood (src/web/shared-inventory.ts).
 * `key` is the wire key, as the arc's is. The sentence is the one that row
 * carried, and `SHARED_TWEETS.detail` before it.
 * docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md.
 */
export const SHARED_THREAD = {
  key: "tweets",
  label: "The thread",
  detail: "The article rewritten as a numbered thread, each post linked to where it came from.",
};

/**
 * **What never goes out, whatever the switch says.**
 *
 * The modes among these — Chat, Remember and Referee — are not listed
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
  /* **"where there are gists", here and on Structure**, because a *provisional* tree has
     none: it is carved from the author's own headings while the real one is
     still being written, and `publicTree` publishes that state on purpose so a
     visitor is not shown empty cells with no way to read them
     (src/public/dto.ts § `provisional`). A flat promise of a gist per section is
     a claim about an article that has finished ingesting, and these rows are
     shown about articles that have not. GPT Sol's review, 2026-09-02. */
  /* The plain-words paragraphs since 2026-10-01, when the outline of gists left
     Summary (docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md);
     this sentence went on describing the gists until 2026-10-03. The thread has
     a row of its own, `SHARED_THREAD`. */
  summary: "The piece in plain words, in a few short paragraphs, where they have been written.",
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
  /* **"where there are gists"**, for the reason the note above `summary`
     gives: a provisional tree has none, and this row is read about articles
     that have not finished ingesting (src/public/dto.ts § `provisional`).

     It named "those same headings and gists" until 2026-09-29, pointing at the
     Hierarchy row above it; that mode retired into this one, so this row says
     what the content is itself. Since 2026-09-10 it is also the nested list
     Outline used to be, which is why it names both arrangements. */
  structure:
    "The headings and the model's one-line gist for each section, arranged as two linked " +
    "columns or, on a narrow screen, one nested list — where there are gists.",
  /* "The model found", because the list is its reading — a work cited only by
     name in running text is on it only if the model noticed it — while the
     links are not the model's: each is one the article gave, or a search that
     says it is one (src/citations.ts § linkFor). */
  citations:
    "The works the model found this piece citing, with a link for each and why the piece uses it.",
  /* "The model thought", because the questions and which passage answers each
     are its reading; the passages themselves are the article's words (src/faq.ts
     § verifyPassage). */
  faq:
    "The questions the model thought a careful reader would ask this piece, each with the passages where it responds.",
  /* The stops are the article's own quotes; the order, the depth and the role
     line are the model's reading (src/skim.ts). */
  skim:
    "A route through this piece's quotes, in the order the model thought best for you, walked a little deeper each time round.",
  /* What the column draws is all built elsewhere: the tree's question for each
     part, the arc, and the ideas where they have been made. So the row names
     those, and says they sit beside the text — the one thing this mode adds is
     where they are put. */
  marginalia:
    "Notes beside the text: the question each part answers, where the argument has got to, and " +
    "the ideas the piece assumes, where those have been made.",
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
    "The piece gives no year for all or part of this date, and we have no publication date to " +
    "take one from. We have not worked out a date from these words.",
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
 * heard of it is not missing from this answer; it is in the other search,
 * which since 2026-10-03 is the Claims sub-mode (`debateClaimsHandoff`).
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
 * **A visitor's empty search, said without the count the owner is told.**
 *
 * The owner's two sentences above tell *came back with nothing* from *came back
 * with pages we could not check*, off `returnedSources` — and that count is a
 * fact about our search, which does not cross to a shared link (src/public-
 * types.ts § `PublicDebateGroup`). Collapsing the two into the first would say
 * something false in the common case, so a visitor gets one sentence that is
 * true of both. Since 2026-09-29, plan 260929c stage 4.
 */
export const DEBATE_RESPONSES_NONE_SHARED =
  "The search kept no page that responds to this piece by name — either it found none, or none it " +
  "found could be checked against the words it returned.";

/** …and the same for the search about what the piece claims. */
export const DEBATE_CLAIMS_NONE_SHARED =
  "The search kept nobody writing about what this piece claims — either it found no one, or " +
  "nothing it found could be checked against the words it returned.";

/**
 * **Rows the shared link leaves out, said rather than silently missing** — the
 * visitor's foot line, one per search that lost any. The public boundary drops
 * a row whose source address carries a password or names a private machine,
 * and a row whose words carry an address the boundary refused (src/public/
 * dto.ts § `publicDebate`); `n` is computed there. 260905f § What is counted:
 * a shorter list with no sentence is the failure this exists to prevent.
 *
 * `search` is the panel's own name for the search, so each sentence says which.
 */
export function debateWithheldOnSharedLink(search: string, n: number): string {
  return (
    `${search} kept ${n} more ${n === 1 ? "result that is" : "results that are"} not shown on a ` +
    `shared link, because ${n === 1 ? "it names an address" : "they name addresses"} we do not publish.`
  );
}

/**
 * **The heading over Reception's title-only rows** — the pages that name this
 * piece by its title and neither link nor quote it. Since 2026-10-03, when the
 * identification slider that used to hide them went (src/web/debate-levels.ts).
 *
 * A heading in our voice, so it states only what was checked: the title was
 * found in the page's extract. It does not say the page is *not* about this
 * piece — a paper that cites it, and a published reply, both look like this —
 * and it does not say it is. That is the reader's call, from the row.
 */
export const DEBATE_TITLE_ONLY = "Names this piece by its title only";

/**
 * **The button under Reception's empty sentence, when Claims has rows** — it
 * switches sub-mode. It replaced *"What follows takes up what it argues."*,
 * which handed over to rows below it on the one mixed list; since 2026-10-03
 * those rows are a sub-mode away. Without it, *no page responds to this piece*
 * is a dead end on a paper whose only findings are about its claims.
 */
export function debateClaimsHandoff(sources: number): string {
  return `See the ${sources} ${sources === 1 ? "source" : "sources"} on what it claims`;
}

/**
 * **What each of Debate's two searches is, said once before the button and
 * once in the band's (i).** The sub-mode control's own cards say the same of
 * each (src/web/sub-modes.ts § `DEBATE_SUB_MODES`); no sentence sits under the
 * control, because docs/project/mode.md bans a description line there.
 */
export const DEBATE_BEFORE_SEARCH =
  "Two searches of the open web. Reception: what others have written about this piece. " +
  "Claims: what has been written about the claims it makes. It takes about a minute and " +
  "costs real money. Many pieces have no reception at all. Searched once and kept.";

/* ---- Reception's *Cited by*: the papers that cite the piece, from OpenAlex ----

   One plain sentence per outcome of `CitersResult` (src/types.ts), so the
   reader is never left with a blank where a list might have been. Plan
   261004h, and its review's F3, F5 and F6. */

export const CITERS_HEADING = "Cited by";
export const CITERS_LOADING = "Looking up which papers cite this piece…";
export const CITERS_NO_DOI = "This piece has no DOI on record, so we cannot look up who cites it.";
export const CITERS_NOT_INDEXED = "OpenAlex, the index we ask, has no record of this piece.";
/**
 * **Not "the DOI belongs to another work"**: what failed is our check that the
 * record is this piece — its title and an author must both agree — and a piece
 * with no byline fails it with a perfectly good DOI.
 */
export const CITERS_UNCONFIRMED =
  "We could not confirm that the DOI on record is this piece's own, so we have not listed who cites it.";
/** The one outcome with a Try again beside it. */
export const CITERS_UNAVAILABLE = "We could not reach OpenAlex just now.";
/** No Try again: the same request would be too large again. */
export const CITERS_TOO_LARGE = "OpenAlex's list for this piece is too large for us to read yet.";
export const CITERS_NONE = "OpenAlex knows this piece and lists no paper citing it yet.";
/** Under every list: the list is a list, and nothing here says what a citing paper thinks. */
export const CITERS_UNREAD = "We have not read what any of them says about it.";
/** What the band's (i) says of the section, for the owner. */
export const CITERS_ABOUT =
  "Cited by is OpenAlex's list of the papers that cite this piece. To get it we send OpenAlex " +
  "the piece's DOI and our contact address, never its text or reader details. No AI is involved, " +
  "and we have not read the papers.";

const papers = (n: number): string => (n === 1 ? "1 paper" : `${n} papers`);

/**
 * **What a found list says about itself**, one sentence per fact.
 *
 * Three numbers can differ and each difference has its own reason, so each gets
 * its own sentence rather than one "the 100 most cited of 389" that is false
 * the moment a record is dropped (GPT Sol's F5): OpenAlex's `count`; how many
 * we `listed`; whether the page limit left some out (`capped`, of `returned`
 * asked for); and how many records could not be shown (`dropped`).
 *
 * @param day the day OpenAlex answered, already formatted, or undefined.
 */
export function citersLines(
  found: { count: number; returned: number; dropped: number; capped: boolean; listed: number },
  day: string | undefined,
): string[] {
  if (found.count === 0 && found.returned === 0) return [CITERS_NONE];
  const lines = [
    `${papers(found.count)} ${found.count === 1 ? "cites" : "cite"} this piece, by OpenAlex's count${day ? ` on ${day}` : ""}.`,
  ];
  if (found.listed === 0) {
    lines.push("None of them could be shown here.");
    return lines;
  }
  if (found.capped) {
    lines.push(
      found.dropped === 0
        ? `The ${found.listed} most cited are listed.`
        : `We asked for the ${found.returned} most cited, and ${found.listed} are listed.`,
    );
  } else {
    lines.push(found.listed === found.count ? "Most cited first." : `${found.listed} are listed, most cited first.`);
  }
  if (found.dropped > 0) {
    lines.push(
      found.dropped === 1
        ? "1 record could not be shown: it has no title, an invalid identifier, or it repeats another."
        : `${found.dropped} records could not be shown: they have no title, an invalid identifier, or repeat another.`,
    );
  }
  lines.push(CITERS_UNREAD);
  return lines;
}

/** *"cited 34 times"*, on a citing paper's own line. */
export function citedTimes(n: number): string {
  return n === 1 ? "cited once" : `cited ${n} times`;
}

/** A claim row without `bears` survives every bar without clearing its judgment. */
export const DEBATE_UNJUDGED = "Not judged for relevance by the AI";

/**
 * Where Debate's threads box would be, when the call that makes it failed
 * (plan 260930j). Says the list is whole, because the reader's next question is
 * whether they are missing sources, and they are not.
 */
export const DEBATE_THREADS_FAILED =
  "The AI could not pick out the threads these sources share this time. Every source it found is still listed below.";

/** The line over *date*'s rows with no year found on the page. */
export const DEBATE_UNDATED = "No year found on these pages";

/**
 * The line in `more` under a row's title, authors and year when any of them is
 * the AI's reading (the plan's F2: found in the page's extract proves the words
 * are on the page, not that they are *this* page's byline). `parts` names only
 * the ones shown — *"Authors and year"* — so the engine's own title is never
 * called the AI's.
 */
export function debateWorkFieldsNote(parts: readonly string[]): string {
  const [first = "", ...rest] = parts;
  const last = rest.pop();
  const head = [first, ...rest].join(", ");
  const list = last === undefined ? head : `${head} and ${last}`;
  const subject = list.charAt(0).toUpperCase() + list.slice(1);
  return (
    `${subject} as the AI read ${parts.length === 1 ? "it" : "them"} off the page; ` +
    `${parts.length === 1 ? "it was" : "each was"} found in the page's extract.`
  );
}

/**
 * **Which Debate fields came from a registry** (plan 261001a stage 6): the
 * identifier is the page address's own, and the record was kept only because
 * its title agreed with the page's. `parts` names only fields actually used,
 * so a missing registry year cannot claim an extracted year as Crossref's.
 */
export function debateRegistryNote(
  source: "crossref" | "datacite",
  parts: readonly ("full title" | "authors" | "year")[],
): string {
  const name = source === "crossref" ? "Crossref" : "DataCite";
  const [first = "", ...rest] = parts;
  const last = rest.pop();
  const head = [first, ...rest].join(", ");
  const list = last === undefined ? head : `${head} and ${last}`;
  const subject = list.charAt(0).toUpperCase() + list.slice(1);
  return `${subject} from ${name}, under the identifier this page's address carries — its title there agrees with the page's.`;
}

/**
 * **What the quotation was checked against, which is not the page.**
 *
 * The survivor bias this discloses is real and is the reason it is on screen
 * rather than in a doc: every quotation here had to be found in the slice a
 * search engine chose, so what survives is biased toward passages a search
 * engine surfaced — which is not the same as the passages that matter.
 */
/* **"here", not "below"**, and it is not a style preference: this sentence is
   drawn twice, at the foot of the list and inside every row's `more` (it was
   the ⓘ card until 2026-09-29), and in both places
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
   in src/pipeline.ts runs extraction, structure and gists at ingest, and a PDF
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

/* `REFEREE_TEXT_ALREADY_SENT_SHORT`, the sentence's first clause, was here as
   the always-visible label of the notice's collapse (2026-09-02 to 2026-10-03).
   The notice is behind the band's Notices button now and prints in full when
   opened, so nothing reads it. Whether a one-line fact should stay on screen
   is [Q-referee-notices-hidden] in
   docs/plans/261003k-referee-mode-puts-the-actions-first-and-the-notices-behind-one-button.md. */

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
 * **It is printed where the search is caused: at the top of the Candidates
 * panel, on screen before the first turn and beside the composer after it.**
 * From 2026-09-06 to 2026-10-03 the Candidates chip itself started the run, so
 * this sentence had to be on screen before any chip was pressed and was drawn
 * above the chips in all four sub-modes — and read *"Opening Candidates may
 * send…"*. Greg, 2026-10-03 (`spya-vbeyse`), met that as one of *"a whole bunch
 * of warnings"* over the mode's actions. Candidates went back behind its
 * button (src/web/activation.ts § REFEREE_TARGET), opening it sends nothing,
 * and the sentence moved to the panel whose controls it is about. It is also
 * in the band's Notices box, so the list of where text goes is whole in one
 * place.
 *
 * Visible text and not a tooltip, for the reason docs/project/referee-mode.md
 * gives — *"a tooltip is not read by anybody in a hurry"* — and because a touch
 * device has no hover at all.
 *
 * If the chip ever starts the run again, this goes back above the chips with
 * it. docs/plans/261003k-referee-mode-puts-the-actions-first-and-the-notices-behind-one-button.md.
 */
export const REFEREE_CANDIDATES_REACHES_SEARCH =
  "Candidates may send terms drawn from this paper to a search engine, which is a different " +
  "third party from the model provider.";

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

/**
 * **The reader's earlier reports would not load** — the Feedback dialog's
 * Earlier tab. docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md.
 *
 * `retry`, and the panel offers Try again beside it: nothing is lost by a read
 * failing, and the one thing worth saying is that the reports themselves are
 * safe — a reader who cannot see their list may otherwise wonder whether what
 * they sent went anywhere.
 */
export const FEEDBACK_EARLIER_FAILED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "Your earlier feedback would not load just now. What you sent is safe with us — trying again " +
    "in a moment usually works. [fb-list]",
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
 * rare: the offer needs enough points freed for `admitsIngest` to pass again,
 * which is one article's worth for the ordinary refusal and only grows for a reader who has unshared their way
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
   * and then lapsed is at 600 points against a free budget of 600, and
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
 * **Switching High-powered AI on needs more allowance than is left** — the
 * refusal `PUT /api/article/:slug/high-power` answers with a 402.
 *
 * Its own sentence rather than `ingestQuotaReached`, for two reasons. The rule is
 * a different one: an upgrade must fit whole (`used + cost <= budget`), where an
 * ingest may overdraw by half an article, so "the allowance is spent" can be false
 * while this still refuses. And it carries **no sharing offer**: that list answers
 * the ingest wall's question, and following it could publish an article and
 * still leave the switch refused. GPT Sol, plan review finding 2, 2026-09-30.
 *
 * It states the price in articles, never in money — docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md, part 3.
 */
export function highPowerNoRoom(quota: {
  /** When a paid allowance starts again. Absent for the free tier, whose allowance is lifetime. */
  resetAt?: Date;
}): ReaderFacingFailure {
  /* One sentence for a private and a public article alike — it names both
     prices — so the code stands for one wording (tests/messages.test.ts). */
  const more = quota.resetAt
    ? `until your allowance starts again on ${readableDay(quota.resetAt)}`
    : "until you subscribe, and the pricing page sets that up";
  return {
    kind: "blocked",
    message:
      "Switching on High-powered AI counts as one more article against your allowance — half " +
      "of one if the article is shared publicly — and there is not that much left. Trying " +
      `again will not help ${more}. Nothing has changed, and reading is never limited. ` +
      "[pay-high-power]",
  };
}

/**
 * **A paper added without AI processing does not fit** — the refusal a minimal
 * reservation answers with a 402 (`withMinimalSlot`, src/billing/admission.ts).
 *
 * Its own sentence rather than `ingestQuotaReached`, because the rule is its
 * own: a minimal paper must fit whole (`admitsMinimal`, `used + 2 <= budget`),
 * where an ingest may overdraw by half an article, so "the allowance is spent"
 * would sometimes be false. It carries **no sharing offer**, for the reason
 * `highPowerNoRoom` gives.
 *
 * **It says how many papers still fit**, which is `minimalHeadroom` — an exact
 * count of the adds that would be admitted, not a rounding of usage. A single
 * refused paper always has `fits: 0`; a batch's door can ask before it starts,
 * and then the number is the one worth saying. Plan 261001m.
 */
export function minimalQuotaReached(quota: {
  /** How many more papers would be admitted. */
  fits: number;
  /** When a paid allowance starts again. Absent for the free tier, whose allowance is lifetime. */
  resetAt?: Date;
}): ReaderFacingFailure {
  const room =
    quota.fits === 0
      ? "There is no room left in your allowance for another paper"
      : `Your allowance has room for ${quota.fits} more ${quota.fits === 1 ? "paper" : "papers"}`;
  const more = quota.resetAt
    ? `until your allowance starts again on ${readableDay(quota.resetAt)}`
    : "until you subscribe, and the pricing page sets that up";
  return {
    kind: "blocked",
    message:
      `A paper added without AI processing counts as 1/100 of an article. ${room}, and ` +
      `trying again will not help ${more}. Everything you have added stays where it is, and ` +
      "reading is never limited. [pay-minimal]",
  };
}

/**
 * ***Read this* pressed on a paper that is already being read through.** One
 * at a time per paper, so the credit for what it already paid is taken once
 * (`reserveUpgrade`, src/store/pg-billing.ts). `blocked` rather than `retry`:
 * pressing again while it runs gives the same answer, and when it finishes the
 * paper is read and there is nothing to press.
 */
export const READ_THIS_ALREADY_RUNNING: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "This paper is already being read through. Pressing again will not help, because it is the " +
    "same paper, and it opens in full when that finishes. [pay-reading]",
};

/* ------------------------------------------- a paper not yet read through --
   Plan 261001m § The thin article. A *minimal* paper is on the shelf with only
   its title, authors and abstract read; anything that needs the whole article
   refuses it, and every sentence says the one thing that changes the answer —
   *Read this*. "Read through" rather than "AI-processed" in the reader's own
   words: Greg's phrase is the shelf's marker, and a refusal is about what the
   reader asked for, not about how we work. */

/**
 * **The general refusal**: chat, a mode, a search, anything that reads the
 * article's text. `loadArticle` throws it as `NotProcessed`
 * (src/not-processed.ts), so every caller gets the same sentence.
 */
export const NOT_READ_YET: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "This paper has not been read through yet — only its title and abstract are here — so " +
    "trying again will not help. Press Read this to make the full article first. [np-read]",
};

/** Sharing a minimal paper. Nothing to share but a title and an abstract. */
export const NOT_READ_YET_SHARE: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "A paper that has not been read through yet cannot be shared, and trying again will not " +
    "help. Press Read this first, and then you can share the full article. [np-share]",
};

/** High-powered AI on a minimal paper: there is no article for it to power yet. */
export const NOT_READ_YET_HIGH_POWER: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "High-powered AI works on a paper that has been read through, and this one has not been " +
    "yet, so trying again will not help. Press Read this first. [np-power]",
};

/** *Start again* on a minimal paper: there is nothing made yet to start again from. */
export const NOT_READ_YET_RESET: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "There is nothing to start again yet: this paper has not been read through, so trying again " +
    "will not help. Press Read this to make the full article. [np-reset]",
};

/**
 * **A file already on this reader's shelf**, or on its way there from another
 * tab — the minimal upload's duplicate check (src/minimal-paper.ts). The
 * response carries the existing article's slug beside it when there is one.
 */
export function alreadyOnYourShelf(where: { archived: boolean }): ReaderFacingFailure {
  return {
    kind: "blocked",
    message: where.archived
      ? "That file is already on your shelf, in your archived articles, so it was not added " +
        "again. Adding the same file will not help. [up-dup-archived]"
      : "That file is already on your shelf, so it was not added again. Adding the same file " +
        "will not help. [up-dup]",
  };
}

/** The same, while the other copy is still being added. */
export const ALREADY_ON_ITS_WAY: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "That file is already being added to your shelf, from another upload of the same file, so " +
    "it was not added twice. Adding it again will not help. [up-dup-wait]",
};

/**
 * The codes a refusal of the article allowance can end with — *the wall said no*.
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
 * and `tests/billing-plan.test.ts` asserts the producers agree with this array.
 */
export type QuotaCode = "pay-free" | "pay-limit" | "pay-lapsed" | "pay-minimal";

/* A union rather than loose strings, so that another refusal added above
   makes every `switch` over this go red at compile time — `QuotaNotice` chooses
   a *destination* per code, and a code with no destination must not be able to
   fall through to a default that sends somebody to the wrong page. */
export const QUOTA_CODES: readonly QuotaCode[] = [
  "pay-free",
  "pay-limit",
  "pay-lapsed",
  "pay-minimal",
];

/**
 * **Is this failure the quota refusing an ingest?**
 *
 * The one question `QuotaNotice` (src/web/QuotaNotice.tsx) asks before putting a
 * link beside a sentence. **Which** page that link goes to is
 * `quotaRefusalCode`'s answer, below, and it is not the same for all of them.
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
 * the refusals do not share a remedy: a free account can buy, a subscriber at
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

/* ------------------------------------------------ citations: find it --
   Citations mode's *Find it on the web*, one searched row at a time —
   src/citation-find.ts, docs/plans/260911g-citations-mode.md § Stage 3. A
   failed call uses the house failures above (`providerHttpFailure`,
   `tookTooLong`, `PROVIDER_UNREADABLE`); these two are the outcomes that are
   not failures. */

/**
 * **A search ran and nothing it returned was plainly this work's own page.** A
 * negative result, not a fault — so it is quiet, it says nothing was kept, and
 * it points at what is still there. It does not say the work is not online:
 * one search not finding it is all we know.
 */
export const CITATION_NO_MATCH =
  "No page the search found was clearly this work's own, so nothing was kept. The Scholar search is still there.";

/**
 * `CITATION_NO_MATCH` for a row the article gave a link for — looked up for
 * what its search extract says (plan 260929g R-3). The link stays whatever
 * happens, so this says that rather than pointing at a Scholar search the row
 * does not have.
 */
export const CITATION_LOOKUP_NO_MATCH =
  "No page the search found was clearly this work's own, so nothing was read from it. The article's own link is still there.";

/* --------------------------------------------- Citations' *Investigate* --
   src/citation-investigate.ts, docs/plans/260930a-citations-investigate-one-work-on-demand.md.
   Every one of these reaches the reader as the whole of what they see in place
   of the answer: the client replaces the streamed text on an error. */

/**
 * **The quote guard stopped the answer** (src/investigate-quote-guard.ts): it
 * put quotation marks round words we could not find in the article, the work's
 * title or *Look it up*'s verified quotes. The wording is the plan's. `retry`,
 * because a fresh answer usually paraphrases where this one quoted.
 */
export const CITATION_INVESTIGATE_QUOTED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "This answer tried to quote a source directly, which we can't check, so it was stopped and not kept. " +
    "Digging deeper again usually gets one that says it in its own words. [cite-quoted]",
};

/** The search came back with no extract to read, so an answer could only have been from memory. */
export const CITATION_INVESTIGATE_NOTHING_READ: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The web search came back with nothing to read about this work, so no answer was kept. " +
    "Trying again may find more. [cite-no-extract]",
};

/**
 * The stream ended some way other than a clean finish — an unrecognised stop,
 * a request for a tool, or a reader-side abort. Only a finished answer is kept.
 */
export const CITATION_INVESTIGATE_UNFINISHED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The answer stopped before it was clearly finished, so none of it is kept. Trying again starts " +
    "a fresh one. [cite-unfinished]",
};

/**
 * ***Dig deeper* refused by its allowance** (`DIG_DEEPER_RATE_POLICY`,
 * src/dig-deeper.ts) — one sentence per reason, Investigate's three below in
 * shape. Said of the action rather than of a glossary entry or a comment,
 * because the one allowance covers both buttons. They say only that this
 * request changed nothing: the first glossary press may have no earlier answer.
 */
export const DIG_DEEPER_BUSY =
  "Another Dig deeper is still running. Wait for it to finish, then try this one.";
export const DIG_DEEPER_LIMITED =
  "You have dug deeper a lot recently. Try again in a while; this request did not change anything.";
/** The 503 of the three, so it carries a code, as `CITATION_INVESTIGATE_RESTING` does. */
export const DIG_DEEPER_RESTING: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "Dig deeper has done as many as it can for today, so asking again today will get the same " +
    "answer. Try again tomorrow; this request did not change anything. [dig-resting]",
};

/**
 * **The forced search did not happen, or nobody can say it did** — the search
 * step's usage reported zero searches, or no count at all (src/dig-deeper.ts §
 * `searchFirst`). The press stops before the answer, because an answer under a
 * *from a web search* label with no search behind it is the one thing this
 * action promises not to be.
 */
export const DIG_DEEPER_NO_SEARCH: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The web search this needs did not run, so nothing was asked and nothing changed. " +
    "Trying again usually works. [dig-no-search]",
};

/**
 * Citations' *Dig deeper* (was *Investigate*) refused by its allowance
 * (`INVESTIGATE_RATE_POLICY`) — one sentence per reason. "On a cited work",
 * because this allowance is not the glossary's and comments' one
 * (`DIG_DEEPER_BUSY` above): a dig running there does not refuse this.
 */
export const CITATION_INVESTIGATE_BUSY =
  "Another Dig deeper on a cited work is still running. Wait for it to finish, then try this one.";
export const CITATION_INVESTIGATE_LIMITED =
  "You have dug deeper into a lot of works recently. Try again in a while — the row's link is still there.";
/** The 503 of the three, so it carries a code; the two 429s pass as they are. */
export const CITATION_INVESTIGATE_RESTING: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "Dig deeper on cited works has done as many as it can for today, so asking again today will get the same " +
    "answer. Try again tomorrow — the row's link is still there. [cite-investigate-resting]",
};

/**
 * **The first step's call failed** (plan 260930d P-5): the quick check that
 * looks for the work's own page was refused, timed out, could not be read, or
 * never reached the provider. The press stops there, so the longer call is
 * never made and nothing more is paid for.
 */
export const CITATION_INVESTIGATE_LOOKUP_FAILED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The quick check that looks for this work's own page failed, so the longer investigation " +
    "was not started and nothing more was spent. Trying again starts over. [cite-lookup-failed]",
};

/**
 * The list was made again while the first step ran, and this work is no
 * longer on it (plan 260930d P-3). The quick check, if it found a page, is
 * kept; nothing more was spent.
 */
export const CITATION_INVESTIGATE_GONE: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "The list of citations was made again while this ran, and this work is no longer on it, so " +
    "the longer investigation was not started, and pressing again here will not help. [cite-gone]",
};

/* ------------------------------------ an upload looking for its own page --
   src/source-guess-run.ts. The request is fired when an owner opens an upload
   and nobody waits on it, so these are rarely read — but a refusal is still
   an answer, and a 503 reaches a reader only when it is coded. */
export const SOURCE_GUESS_BUSY =
  "We are already looking for where your uploaded papers came from. This one will be looked for next time you open it.";
export const SOURCE_GUESS_LIMITED =
  "We have looked for a lot of your uploads' web pages recently. This one will be looked for another time.";
export const SOURCE_GUESS_RESTING: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "We have done as many web searches for uploaded papers as we can for today, so opening it " +
    "again today will get the same answer. It will be looked for another day. [guess-resting]",
};

/* ------------------------------------------ citations: reading the paper --
   src/paper-text.ts § `readPaperText` — fetching a cited work so its text can
   be checked against what the article says it says (plan 260929g). Not a
   failure of ours in any of these cases: the paper was not there to read, and
   each sentence says which way. The union lives here rather than beside the
   fetch because this file must stay a leaf (tests/client-imports.test.ts). */

/** Why a cited work's text could not be read. A closed set; each has a sentence below. */
export type PaperUnreadableReason =
  | "invalid-url"
  | "blocked"
  | "refused"
  | "not-found"
  | "site-error"
  | "network"
  | "timeout"
  | "too-large"
  | "not-a-document"
  | "paywall-or-empty"
  | "scan"
  | "damaged";

const PAPER_UNREADABLE: Record<PaperUnreadableReason, string> = {
  "invalid-url": "We could not get the paper because the link to it is not a web address we can open.",
  blocked: "We could not get the paper because its link points somewhere private, which we never fetch.",
  refused:
    "We could not get the paper because the site would not let us read it — publishers often turn away automated readers.",
  "not-found": "We could not get the paper because there is nothing at that address any more.",
  "site-error": "We could not get the paper because the site answered with an error.",
  network: "We could not get the paper because we could not reach the site.",
  timeout: "We could not get the paper because the site took too long to answer.",
  "too-large": "We could not get the paper because it is too long for us to read in one go.",
  "not-a-document": "We could not get the paper because the link leads to a file that is not a web page or a PDF.",
  "paywall-or-empty":
    "We could not get the paper because the page had no text of the paper on it — it may be behind a paywall or a login.",
  scan: "We could not get the paper because it is a scanned image with no text we can read.",
  damaged: "We could not get the paper because the PDF would not open — it may be locked or damaged.",
};

/** The reader's sentence for a paper that could not be read. */
export function paperUnreadableSentence(why: PaperUnreadableReason): string {
  return PAPER_UNREADABLE[why];
}

/* ------------------------------------------------------------------------ *
 * The line at the top of the Structure band while the real structure is on
 * its way — src/web/modes/structure/StructureArriving.tsx,
 * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md.
 * ------------------------------------------------------------------------ */

/**
 * The band is showing a stand-in outline, and the real one is being built.
 *
 * **It does not say the rows are the article's own headings**, which the first
 * draft did. Where an article has no usable headings the stand-in cuts windows
 * and names them from their opening words (src/heading-tree.ts), and even a
 * headed article can gain subdivisions the author never wrote. GPT Sol's plan
 * review, F6. A visitor is shown this one too.
 */
export const STRUCTURE_ARRIVING = "This is a temporary outline. The full structure is not available yet.";

/**
 * No job is building it and the tree is still the stand-in: the job failed, or
 * was stopped, or never ran. Not a `ReaderFacingFailure` — the job's own
 * failure is on its own record with its own code; this is the band saying what
 * it can see, beside the button that starts another.
 */
export const STRUCTURE_STALLED = "The full structure is not available.";

/** The owner's way out of `STRUCTURE_STALLED`. Never drawn for a visitor. */
export const STRUCTURE_BUILD = "Build it";

/** The live tree read failed; this offers a read retry, not another paid build. */
export const STRUCTURE_CHECK_FAILED =
  "The structure could not be checked. Try again in a few seconds. [structure-check]";

/**
 * The structure was built, and from blocks that are not the ones on screen —
 * a Rebuild in another tab while this one was open. Swapping the tree in would
 * point its rows at the wrong paragraphs, so the page asks for the one thing
 * that puts both right. Nothing reloads by itself: a reload drops a typed draft
 * and a streaming answer.
 */
export const STRUCTURE_READY_RELOAD = "The structure is ready. Reload the page to see it.";
