/**
 * Turn a failure from the Anthropic SDK's own request into a safe,
 * reader-facing `Error` — the request-failure analogue of `providerRefused`
 * in src/openrouter-stream.ts, for the ten pipeline stages that talk to the
 * SDK directly (arc, glossary, hierarchy, ideas, labels, quiz, quotes, sketch,
 * timeline, tweets) rather than through OpenRouter. The list is whatever
 * `grep -rn anthropicCallFailed src/` says: it read "six" and named a deleted
 * `summarise` until 2026-09-03, and the counts below reason from it.
 *
 * ## Why this exists
 *
 * `providerRefused` closed this leak for OpenRouter's HTTP responses, and
 * `MODEL_REFUSED` closed it for Anthropic's `stop_reason: "refusal"`. Neither
 * touches the case this file is for: the SDK's own request failing — a 429, a
 * bad key, a network drop, anything that makes `stream.finalMessage()`
 * reject rather than resolve. Verified against the installed SDK
 * (`node_modules/@anthropic-ai/sdk/core/error.js`, `APIError.makeMessage`):
 * **`Error.message` on a thrown `APIError` is built directly from the
 * upstream response body** — `${status} ${error.message}`, or the whole body
 * JSON-stringified if there is no `.message` on it. Nothing in these ten
 * stages caught that. It propagated to src/jobs.ts, which both logs it
 * (`errorFields` keeps `message` and `stack` on the thrown value — see
 * docs/project/logging.md) and stores it on the job, and
 * src/web/AddArticle.tsx renders `step.error` straight onto the screen. What
 * every one of these ten requests carries is the whole article, so an
 * upstream that echoes any of it back in an error body has a direct line to
 * both the log and the reader.
 *
 * ## What is kept, and what is honestly lost
 *
 * The HTTP status is kept on the returned `Error` — `status` is already in
 * `SAFE_ERROR_PROPS` (src/log.ts), so it reaches the log without the message
 * carrying anything. The stage and the elapsed time are already on the
 * caller's log line (src/jobs.ts: `step`, `ms`). Lost, honestly: the
 * upstream's own explanation of *why*, which is sometimes the fastest way to
 * tell a bad key from a rate limit from a size limit apart — the same trade
 * `providerRefused` makes, for the same reason.
 */
import { AnthropicError, APIError } from "@anthropic-ai/sdk";
import { NOT_CONFIGURED, providerHttpFailure } from "./messages.js";

/**
 * Call at the `catch` around a stage's `client.messages.stream(...)` /
 * `stream.finalMessage()`. Returns the `Error` to throw in its place.
 */
export function anthropicCallFailed(err: unknown): Error {
  if (err instanceof APIError) {
    /* `APIConnectionError`/`APIConnectionTimeoutError`/`APIUserAbortError`
       are all `APIError` subclasses with `status: undefined` — a network
       failure or the reader hitting Stop, never carrying an upstream body.
       They fall into the 5xx bucket ("trouble at its end, try again"), which
       is the closest existing sentence and — for the abort case — moot
       anyway: src/jobs.ts decides "cancelled" from the abort signal, not
       from what this throws. */
    const status = typeof err.status === "number" ? err.status : 503;
    const failure = providerHttpFailure(status);
    const out = new Error(failure.message) as Error & { status?: number };
    if (typeof err.status === "number") out.status = err.status;
    return out;
  }
  if (err instanceof AnthropicError) {
    /* Not an HTTP failure at all — the SDK refusing to run, most often no
       usable API key. Its own message can name an environment variable or a
       code path, which is an instruction for whoever runs this app, not
       something to hand a reader. Same call `NOT_CONFIGURED` already makes
       for the equivalent OpenRouter case. */
    return new Error(NOT_CONFIGURED.message);
  }
  // Not the SDK's doing. Leave it alone rather than mislabel a bug in this
  // file's own code as a provider failure.
  return err instanceof Error ? err : new Error(String(err));
}
