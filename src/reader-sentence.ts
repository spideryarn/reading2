/**
 * **The sentence a streaming route may put in front of a reader**, given
 * whatever it caught after its headers went out.
 *
 * Until 2026-09-24 every streaming route in src/routes.ts wrote
 * `(err as Error).message` into its `error` frame, and four of them onto the
 * stored row as well — so a driver's message, a parser quoting its input or a
 * bare `TypeError("fetch failed")` reached the reader verbatim, and the client
 * could not tell it from a sentence the server meant (GPT Sol's F5 on
 * docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md).
 *
 * **No new convention.** A failure counts as written for a reader under either
 * of the two this codebase already has:
 *
 * - a declared `ReaderFacingFailure` on the error (`stageFailure`, read by
 *   `declaredFailure` in src/job-failure.ts), or
 * - a message that ends in a registered bracketed code from src/messages.ts —
 *   the same test `authored` in src/monitoring-scrub.ts applies before a
 *   message may go to Sentry, and the model-call layer's whole vocabulary.
 *
 * Anything else gets `ANSWER_GAVE_UP`, and the error itself goes to the log,
 * where `safeError` in src/log.ts decides how much of it is written down.
 */
import { declaredFailure } from "./job-failure.js";
import { errorFields, log } from "./log.js";
import { ANSWER_GAVE_UP, kindOfMessage } from "./messages.js";

/**
 * @param context what the log line should carry beside the error — a route
 *   name and a slug. Never prose.
 */
export function sayToReader(err: unknown, context: Record<string, string>): string {
  const declared = declaredFailure(err);
  if (declared) return declared.message;
  const message = err instanceof Error ? err.message : undefined;
  if (message && kindOfMessage(message) !== null) return message;
  log("http").error(
    { ...errorFields(err), ...context },
    "a streamed failure with no reader-facing sentence was withheld from the reader",
  );
  return ANSWER_GAVE_UP.message;
}
