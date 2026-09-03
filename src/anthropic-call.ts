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
import { stageFailure } from "./job-failure.js";
import { NOT_CONFIGURED, providerHttpFailure } from "./messages.js";

/**
 * Call at the `catch` around a stage's `client.messages.stream(...)` /
 * `stream.finalMessage()`. Returns the `Error` to throw in its place.
 *
 * **The sentence is declared rather than merely written into the message.**
 * `stageFailure` carries the whole `ReaderFacingFailure`, so the ten stages
 * that call this keep their good copy across the seam src/jobs.ts now applies
 * — without it every one of them would fall back to `stepGaveUp`'s generic
 * line and a 429 would read like any other failure. One change here rather than
 * ten at the call sites, which is why the shared constructors were migrated
 * first. src/job-failure.ts, docs/project/copy.md.
 *
 * Note what has **not** come back: the SDK's own `Error.message`, built from
 * the upstream body. The diagnostic half of the seam is still only for things
 * safe to log, and that body can echo the article — see the header above.
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
    /* The diagnostic is the status and nothing else — the one fact about this
       failure that is ours to repeat. `status` also rides on the error itself,
       where `SAFE_ERROR_PROPS` (src/log.ts) already picks it up. */
    /* **`authored`, and the status is why it is safe to claim.** Every
       character of this is ours — a fixed sentence and a number the SDK gave us
       as a number, never a string it built from a body. That is the whole test
       `{ authored }` asks (src/job-failure.ts), and it is what puts the code on
       the end, which `tests/anthropic-call.test.ts` pins. */
    const out = stageFailure(failure, {
      authored: `Anthropic SDK request failed, status ${status}.`,
    }) as Error & {
      status?: number;
    };
    if (typeof err.status === "number") out.status = err.status;
    return out;
  }
  if (err instanceof AnthropicError) {
    /* Not an HTTP failure at all — the SDK refusing to run, most often no
       usable API key. Its own message can name an environment variable or a
       code path, which is an instruction for whoever runs this app, not
       something to hand a reader. Same call `NOT_CONFIGURED` already makes
       for the equivalent OpenRouter case.

       **Not carried through as the diagnostic either**, which the split above
       would have allowed and which was tried and backed out on 2026-09-03. The
       message is the SDK's own rather than an upstream body, so it is probably
       safe — but "probably" is not the standard this file works to, and
       `tests/anthropic-call.test.ts` has pinned since it was written that these
       words do not travel. Repeating them would also have put them in Sentry,
       via the code the diagnostic now carries (src/job-failure.ts §
       `diagnosticFor`), which is a wider audience than the one that argument
       was ever made about. What is lost is *which* config problem it was, and
       the stack in the log still says. */
    return stageFailure(NOT_CONFIGURED);
  }
  // Not the SDK's doing. Leave it alone rather than mislabel a bug in this
  // file's own code as a provider failure.
  return err instanceof Error ? err : new Error(String(err));
}
