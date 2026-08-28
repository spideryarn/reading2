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
import type { EmbeddingReason, StepName } from "./types.js";
import { MAX_UPLOAD_BYTES } from "./uploads.js";

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
export function kindOfMessage(message: string): FailureKind | null {
  const code = message.match(/\[([a-z0-9-]+)\]\s*$/)?.[1];
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
 * docs/postmortems/toc-max-tokens.md.
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
 * A claimant takes a job for one step and its lease says how long that step may
 * take. A lease that runs out means the process holding it is gone — frozen by
 * the host, restarted, or killed — and the job would otherwise sit `running`
 * for ever, holding the one running slot with it.
 *
 * The sentence says what happened and offers the retry, because this is the one
 * failure where retrying is not just permitted but likely to work: `stepIsDone`
 * derives what is finished from the artefacts, so a retry resumes rather than
 * starting again. What it deliberately does not do is *take the job over* by
 * itself. A lease that has expired does not prove the old claimant has stopped
 * — only that it stopped saying so — and two runners writing one article is
 * worse than one click. docs/plans/durable-queue-and-uploads.md § 2.
 */
export const INTERRUPTED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "This stopped part-way through, and whatever was running it did not come back. " +
    "The steps that finished are kept, so trying again picks up where it left off rather than " +
    "starting over. [jb-gone]",
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
  "ai-filtered": "blocked",
  "ai-no-room": "blocked",
  "ai-empty": "retry",
  /* Not a model call, and not the reader's fault either. `retry` on purpose:
     an interrupted job resumes from its artefacts rather than starting again,
     so another go is both allowed and cheap. See `INTERRUPTED`. */
  "jb-gone": "retry",
  /* Not a model call. `db-` rather than `ai-` so that a reader quoting four
     characters, and whoever they quote them to, can tell the two apart at a
     glance — see `STORAGE_BUSY`. */
  "db-busy": "retry",
  "db-failed": "bug",
  /* Uploading a file. `up-` for the same reason `db-` is not `ai-`: a reader
     quoting four characters should not have to explain which part of the app
     they were in. Two are `blocked` and two are `retry`, and the split is the
     whole reason these are registered rather than left to fall through — an
     unknown code means *offer another go*, so "that file isn't a PDF" would
     have come with a Retry button that cannot work. */
  "up-big": "blocked",
  "up-pdf": "blocked",
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
 */
export const ANSWER_OVERFLOWED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The answer was longer than there was room for, so it arrived incomplete and could not be used. " +
    "Asking for something narrower usually fits. [ai-overflowed]",
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
 * Six pipeline stages — arc, labels, summarise, toc, glossary, tweets — each
 * threw `Model refused: ${JSON.stringify(message.stop_details)}` until
 * 2026-08-26, and that string is not thrown away afterwards: `jobs.ts` copies a
 * step's error onto the job, and the job's error is rendered on the progress
 * card. So provider prose had a straight path to the screen through six doors,
 * found by review after seven other doors of the same shape had already been
 * closed. The lesson is the one that plan's Rule 1 already stated — **grep the
 * genre, not the list** (docs/plans/simplification-audit.md).
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

/* ---- uploading a file. docs/plans/pdf-upload-and-storage.md ------------- */

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
 * The distinction is the whole of docs/postmortems/toc-max-tokens.md — a button
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
export const UPLOAD_MISSING: ReaderFacingFailure = {
  kind: "blocked",
  message:
    "That file never finished arriving. An upload has two hours to complete, so a very slow " +
    "connection or an interrupted one will do this. Running this again will not help — there is " +
    "nothing there to read. Choose the file again. [up-gone]",
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

/** The call succeeded and the model said nothing. */
export function saidNothing(finishReason: string | null): ReaderFacingFailure {
  /* The filter case is `blocked`, not `retry`, and the sentence says less than
     it used to on purpose. It used to explain the refusal — "quoted material it
     reads as harmful out of context" — which we do not know and cannot check.
     Telling a reader a confident story about why a safety filter fired is worse
     than telling them it fired, because it is the kind of claim they have no way
     to test and might repeat. */
  if (finishReason === "content_filter") {
    return {
      kind: "blocked",
      message:
        "The AI service stopped itself answering this one — its safety filter caught something, and " +
        "it does not tell us what. Asking the same thing again will get the same result; asking about " +
        "a smaller piece of the article sometimes works. [ai-filtered]",
    };
  }
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
 * src/web/lib/supabase.ts and docs/plans/google-sign-in-production.md.
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
 * docs/research/public-access-how-others-do-it.md.
 *
 * **"Visitor" means anyone who does not own the document** — signed out, or
 * signed in and reading somebody else's. They get the same sentences, which is
 * the point: the question is *is this mine*, never *am I signed in*.
 * docs/plans/public-read-only-access.md.
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

/** What that label means, in the one sentence the bar has room for. */
export const SHARED_WITH_YOU =
  "Somebody shared this article with you. The whole piece is here to read, at every zoom level.";

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
 * `noun` is a noun phrase with its article: `"a glossary"`, `"a summary"`.
 */
export function notBuiltYet(noun: string): string {
  return `Nobody has built ${noun} for this piece yet.`;
}

/**
 * **It exists, and a shared link does not carry it yet.** A fourth state, and
 * it is temporary: slice 1b adds the public endpoints for glossary, summaries,
 * ideas and tweets, and this sentence goes with the slice that makes it false.
 *
 * It is worth having rather than folding into `notBuiltYet`, which would be a
 * lie about somebody's article, or into `signedInOnly`, which would promise
 * that an account is the fix when the fix is us shipping the endpoint.
 * `PublicMetadata.available` is the field that tells the two apart —
 * src/public-types.ts.
 */
export function notOnSharedLinksYet(noun: string): string {
  return `There is ${noun} for this piece, but a shared link does not carry it yet.`;
}

/**
 * **It exists and it costs money.** Chat, search, review, asking about a
 * passage: every one of them is a model call, and Greg's third decision is that
 * a logged-out visitor causes none.
 *
 * Different from both of the above and it has to read as different: the feature
 * is there, it works, and an account is genuinely the way to have it. That is
 * what makes the sign-up line beside this one an honest offer rather than a
 * toll booth.
 *
 * `feature` is capitalised, because it names a control the visitor just
 * pressed: `"Chat"`, `"Search"`.
 */
export function signedInOnly(feature: string): string {
  return `${feature} is for signed-in readers — it asks the model something, and a shared link spends nobody's money.`;
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

/* ── Sharing a document, for the owner ─────────────────────────────────────── */

/** The switch, off. */
export const SHARING_OFF = "Only you can read this.";

/** The switch, on. */
export const SHARING_ON = "Anyone with the link can read this, without signing in.";

/** What a visitor gets, in one line, on the card rather than behind a hover. */
export const SHARING_WHAT_VISITORS_SEE =
  "A visitor sees the article, its table of contents and every zoom level. They never see your " +
  "comments, your conversations, your searches or your notes, and nothing they do costs a model call.";

/**
 * **The honest limit, and we are the only ones saying it.**
 *
 * Not one product researched tells either the owner or the visitor that
 * unsharing cannot claw back a page a browser already has; every one of them
 * describes revocation purely as the next request being refused. Saying it
 * plainly is going further than the precedent, deliberately, and it is recorded
 * as a decision rather than left to look like a default.
 * docs/research/public-access-how-others-do-it.md.
 */
export const SHARING_CANNOT_UNRING =
  "Turning this off refuses the next request. It cannot take back a page somebody's browser already " +
  "has, or anything they copied out of it.";

/** The confirmation, which no other product asks for. */
export const SHARING_CONFIRM_TITLE = "Share the full text of this article?";

/**
 * Why we gate this and Notion, Figma and Readwise do not.
 *
 * They are all publishing **the owner's own document**. We are republishing
 * **somebody else's article**, extracted from a page they wrote, so the rights
 * question is ours and not theirs and the norm does not transfer.
 * docs/plans/public-read-only-access.md § Rights.
 */
export function sharingConfirmBody(title: string): string {
  return (
    `This puts the whole extracted text of “${title}” where anyone with the link can read it, ` +
    "without signing in."
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
   row already carries all four artefacts that can hold a `profileHash`, so
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
  "The summaries, glossaries and ideas here may have been written for your reader profile, and they " +
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
const OWNED_ARTEFACT: Partial<Record<StepName, string>> = {
  tweets: "your tweet thread",
  glossary: "your glossary",
  summary: "your summary",
  ideas: "your list of ideas",
};

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
 * rather than being dropped. Only four artefacts can carry a `profileHash` and
 * all four are in the table, so this is unreachable today — but a silently
 * shortened list is the failure that would matter here, since the whole point
 * of the sentence is that it is complete.
 */
export function sharingPersonalisedList(kinds: StepName[]): string {
  const nouns = kinds.map((k) => OWNED_ARTEFACT[k] ?? `your ${k}`);
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
