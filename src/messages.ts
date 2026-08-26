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

/** Which kind of failure this is, which decides what the reader should do. */
export type FailureKind =
  /** Transient. Retrying is the right move. */
  | "retry"
  /** This app's account or configuration. Retrying cannot help. */
  | "ours"
  /** A defect here. Retrying cannot help, and someone should hear about it. */
  | "bug";

export interface ReaderFacingFailure {
  kind: FailureKind;
  /** The whole sentence(s) shown to the reader, code included. */
  message: string;
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
  if (status === 401 || status === 403) {
    return {
      kind: "ours",
      message:
        "This app cannot sign in to the AI service — its key is missing or no longer valid. " +
        "That is a setup problem here, not anything you did, and it needs fixing before any of the AI " +
        "features will work. [ai-key]",
    };
  }
  if (status === 404) {
    return {
      kind: "ours",
      message:
        "The AI model this app asked for is not available. That is a configuration problem here rather " +
        "than a problem with your article. [ai-no-model]",
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
  return {
    kind: "retry",
    message: `The AI service refused this request and did not say why. Trying again is worth a go. [ai-${status}]`,
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
  const why =
    finishReason === "content_filter"
      ? "Its safety filter stopped it, which can happen on quoted material it reads as harmful out of context. "
      : finishReason === "length"
        ? "It ran out of room before writing anything, which usually means the article is very long. "
        : "";
  return {
    kind: "retry",
    message: `The AI service answered without saying anything. ${why}Trying again is worth a go. [ai-empty]`,
  };
}
