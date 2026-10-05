/**
 * **The transport retry's policy, in one place**: how many goes, how long
 * between them, and which HTTP statuses mean "not now".
 *
 * Two wires share it and neither owns it: the Messages wire
 * ([`messages-stream.ts`](messages-stream.ts) § `streamMessage`) and the five
 * OpenRouter seams ([`ai-call.ts`](ai-call.ts) § `asTransportAttempts`). Each
 * decides for itself *what counts as a failure worth asking again*, because
 * that depends on what its errors look like; the numbers are the same.
 *
 * `src/pdf-read.ts` and `src/embeddings.ts` keep their own, on purpose: their
 * loops also handle a 429 and `Retry-After`, which this policy never touches.
 *
 * docs/project/ai-gateway.md § "A transport blip is retried, and every attempt
 * is a row".
 */

/**
 * **Three goes in total, not three retries** — `src/pdf-read.ts` §
 * `TRANSPORT_ATTEMPTS` is the precedent and uses the same number.
 */
export const TRANSPORT_ATTEMPTS = 3;

/**
 * The first wait; the second is three times it, each with ±25% jitter. Short on
 * purpose: what this retries is a dropped connection or a provider's bad second,
 * and a reader may be watching. A step's deadline is a minute or more
 * (src/jobs.ts), so both waits together are a small part of it.
 */
export const TRANSPORT_BACKOFF_MS = 500;

/**
 * The statuses that mean "not now" rather than "not this request".
 *
 * **Not 429**, though it is the most transient of all. A rate limit is a queue,
 * and the callers that meet one already have a policy this loop would trample:
 * `src/structure-deepen.ts` turns a 429 into `ExpansionRateLimited`, honours
 * its `Retry-After` and narrows a shared `WidthGate`. Two blind retries in
 * here would hide two of every three 429s from that gate and ignore the delay
 * the provider asked for. GPT Sol, reviewing plan 261003m. 409 is here because
 * the Anthropic SDK's own retry treats it as a lock timeout.
 */
export const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 409, 500, 502, 503, 504, 529]);

/** The wait after attempt `attempt` (1-based) failed: about 0.5 s, then about 1.5 s. */
export function backoffMs(attempt: number): number {
  return TRANSPORT_BACKOFF_MS * 3 ** (attempt - 1) * (0.75 + Math.random() / 2);
}

/**
 * Wait, or reject the moment the signal fires — a Stop must not sit out a
 * backoff. The rejection is a plain marker: each wire turns it into the abort
 * its own callers recognise.
 */
export function waitOrStop(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
