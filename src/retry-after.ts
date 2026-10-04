/**
 * `Retry-After`, as a number of milliseconds to wait. The one parser.
 *
 * **There were two until 2026-10-04**, both exported and both called
 * `retryAfterMs`: one in the model gateway (src/ai-call.ts) and one in the page
 * fetcher (src/fetch.ts). They disagreed about `0`, `1.5`, `0x10`, `-5` and a
 * date already past, and neither knew about the other. The gateway's own
 * comment had predicted it: a second parser "would be a second opinion about
 * what a minute means".
 *
 * **A leaf, importing nothing**, because both sides need it and neither should
 * import the other: the fetcher is DNS, undici and the blob store, and the
 * gateway has no business loading that for a few pure lines.
 *
 * Callers: `ProviderRefused` (src/ai-call.ts), `readBody` (src/fetch.ts) and
 * the deepening wave (src/structure-deepen.ts), which meets its 429s on the
 * Anthropic SDK's road and so has an `APIError` with a `Headers` on it rather
 * than a `ProviderRefused`.
 *
 * Plan: docs/plans/261004c-fifth-sweep-cluster-12-model-call-plumbing.md § R2.
 */

/** Seconds: digits and nothing else. RFC 9110 `delay-seconds` is `1*DIGIT`. */
const SECONDS = /^\d+$/;

/**
 * A date that names its own zone: `GMT` (the two forms HTTP sends today), its
 * synonyms, or a numeric offset. Anything else is the asctime form or a
 * server's own variation on it, and gets `GMT` put on the end.
 */
const SAYS_ITS_ZONE = /(?:\b(?:GMT|UTC?|Z)|[+-]\d{2}:?\d{2})$/i;

/**
 * What the server asked for, or `null` for "no usable instruction".
 *
 * `nowMs` is passed in rather than read, so a test can say what time it is and
 * a caller with its own clock (src/fetch.ts § `opts.now`) uses that clock.
 *
 * **What the server actually said, not what a caller can afford.** Nothing is
 * clamped here. The gateway's parser clamped to 30 s until 2026-09-04, which
 * meant a header saying ten minutes and one saying thirty seconds arrived
 * indistinguishable, so the one caller that wanted to decide about a long wait
 * could not tell there had been one, and asked again well inside a window the
 * provider had just told it was closed ⟨GPT Sol, 2026-09-04⟩. How long a wait is
 * affordable is a property of the caller's deadline, and the callers have one
 * each (src/pdf-read.ts § `MAX_RETRY_AFTER_MS`, src/embeddings.ts §
 * `backoffMs`, src/fetch.ts § `retryDelayMs`).
 *
 * Four decisions, each made on purpose:
 *
 * - **Seconds are digits only.** `1.5`, `0x10`, `-5`, `+5` and `1e3` are not a
 *   number of seconds. `Number()` reads all five, which is how the gateway's
 *   parser turned `0x10` into sixteen seconds.
 *
 * - **A date starts with a letter.** Every HTTP-date form starts with the name
 *   of a weekday. Without this, V8's lenient `Date.parse` reads `1.5` as a day
 *   in 2001 and `-5` as a year.
 *
 * - **An HTTP date is UTC, including the form that does not say so.** The
 *   asctime form (`Sun Oct  4 12:00:30 2026`) carries no zone, and `Date.parse`
 *   reads a zone-less date in the machine's local time. On a machine in London
 *   in summer a wait of thirty seconds parsed as an hour ago. Both old parsers
 *   had this ⟨GPT Sol, reviewing the plan, 2026-10-04⟩.
 *
 * - **A wait that is not positive is `null`.** That covers `0` and a date
 *   already past. `null` means "use your own backoff" at every caller, and it
 *   is the safe reading: a `0` passed through makes the page fetcher retry at
 *   once, makes the width gate (src/concurrency.ts) skip its cool-off, and
 *   makes embeddings retry a 429 with no wait. The option passed over was to
 *   keep `0` as "the server said now" and have each caller floor it, which is
 *   more faithful to the header and leaves five callers each needing to
 *   remember.
 *
 * The answer is `null` or a finite number above zero, so a caller can do
 * arithmetic on it without checking. And it is a parsed number, never a
 * string: nothing a server wrote leaves this function.
 */
export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  let ms: number;
  if (SECONDS.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else if (/^[A-Za-z]/.test(trimmed)) {
    ms = Date.parse(SAYS_ITS_ZONE.test(trimmed) ? trimmed : `${trimmed} GMT`) - nowMs;
  } else {
    return null;
  }
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}
