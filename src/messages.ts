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
 * 2. **Say whose problem it is.** There are three kinds and they need different
 *    behaviour from the reader: *try again* (transient), *nothing you can do*
 *    (this app's own account or configuration), and *this is a bug here*.
 *    Telling someone to try again when retrying cannot possibly work is the
 *    worst of the three, because they will do it repeatedly.
 * 3. **Say what to do next**, when there is anything.
 * 4. **Never repeat what the provider said.** Its error body is the one place an
 *    upstream might echo the article back — see `providerRefused` in
 *    src/openrouter-stream.ts, and docs/project/logging.md.
 * 5. **Carry a short code at the end** for whoever is supporting this. It is in
 *    brackets and last, so it is skippable by a reader who does not want it and
 *    quotable by one reporting a problem.
 */

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
 */
export function canRetry(kind: FailureKind): boolean {
  return kind === "retry";
}

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
        "This app cannot sign in to the AI service — its key is missing or no longer valid. " +
        "That is a setup problem here, not anything you did, and it needs fixing before any of the AI " +
        "features will work. [ai-key]",
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
        "The AI service would not answer this one. That is usually its safety filter reacting to " +
        "something in the article or the question, or a limit on this app's account. Asking the same " +
        "thing again will get the same answer; asking something narrower sometimes gets through. [ai-refused]",
    };
  }
  if (status === 404) {
    return {
      kind: "ours",
      message:
        "The AI model this app asked for is not available. That is a configuration problem here rather " +
        "than a problem with your article, so trying again will not help until somebody changes a " +
        "setting. [ai-no-model]",
    };
  }
  if (status === 400 || status === 422) {
    return {
      kind: "bug",
      message:
        "The AI service rejected this request as malformed. That is a bug in this app rather than " +
        "anything about your article, and trying again will get the same result. [ai-bad-request]",
    };
  }
  if (status === 413) {
    return {
      kind: "blocked",
      message:
        "This was too much text for the AI service to take in one go. Trying again will send exactly " +
        "the same thing, so it needs to be smaller — a shorter selection, or a narrower question about " +
        "a long article. [ai-too-big]",
    };
  }
  if (status === 408 || status === 504) {
    return {
      kind: "retry",
      message:
        "The AI service took too long to answer and gave up. Trying again often works, especially on a " +
        "shorter piece. [ai-timeout]",
    };
  }
  if (status >= 500) {
    return {
      kind: "retry",
      message:
        "The AI service is having trouble at its end. This is usually over in a minute or two — try " +
        "again then. [ai-upstream]",
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
 * Kept separate from the HTTP cases because the reader may be looking at half an
 * answer, and the sentence has to make sense underneath one.
 */
export const PROVIDER_FAILED_MID_ANSWER: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The AI service hit a problem part-way through answering. Anything above this point is what " +
    "arrived before it stopped. Trying again starts a fresh answer. [ai-interrupted]",
};

/** A reply that was not the shape we can read at all. */
export const PROVIDER_UNREADABLE: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The AI service sent something this app could not make sense of. That is usually a blip — trying " +
    "again is worth a go. [ai-unreadable]",
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
    "answer. That is a setup problem here rather than anything you did, and it needs somebody with " +
    "access to fix it — trying again will not help. [ai-not-set-up]",
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

/** The connection ended mid-answer, with no sign it had finished. */
export const ENDED_UNFINISHED: ReaderFacingFailure = {
  kind: "retry",
  message:
    "The answer stopped arriving before it was finished — the connection ended early. What is above " +
    "this point is real, it is just not all of it. Trying again starts a fresh answer. [ai-cut-off]",
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
        "a smaller piece of the article often works. [ai-filtered]",
    };
  }
  if (finishReason === "length") {
    return {
      kind: "retry",
      message:
        "The AI service ran out of room before it wrote anything, which usually means it was given " +
        "too much at once. Asking about a shorter stretch of the article should get an answer. [ai-no-room]",
    };
  }
  return {
    kind: "retry",
    message: "The AI service answered without saying anything. Trying again is worth a go. [ai-empty]",
  };
}
