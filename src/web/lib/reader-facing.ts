/**
 * The two facts `describeFetchFailure` (src/web/useComments.ts) needs before it
 * will put a caught error's words in front of a reader — each set where it is
 * known, never guessed afterwards.
 *
 * Until 2026-09-24 that function passed **any** `Error`'s message through, on a
 * comment's word that "an Error we threw ourselves already carries a real
 * message from the server", and read every `TypeError` as a lost connection.
 * Neither was enforced, and React's own `Minified React error #185` reached a
 * reader as a chat answer's failure. See
 * docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md.
 *
 * A leaf module on purpose: several tests `vi.mock("…/lib/api.js")` wholesale,
 * and a class that lived there would be mocked away — `instanceof` against
 * `undefined` throws.
 */

/**
 * An error whose message somebody here wrote **for a reader** — the server's
 * own `{ error }` sentence (`HttpError` extends this), or a sentence the client
 * wrote at the throw site ("The answer stopped arriving. Try again.").
 *
 * Constructing one is the claim. Never pass it text that arrived from anywhere
 * else — another exception's message, a provider's body, the article.
 */
export class ReaderFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReaderFacingError";
  }
}

/**
 * Errors our own helpers saw come out of the transport — `fetch` rejecting, a
 * body that died mid-read. A brand rather than a wrapping class so the object is
 * untouched: its name, message, stack and `instanceof TypeError` are what they
 * were, and the sites that read those keep working.
 */
const unreachable = new WeakSet<object>();

/** Record that `e` is a transport failure. Returns it, for `throw markUnreachable(e)`. */
export function markUnreachable<T>(e: T): T {
  if (typeof e === "object" && e !== null) unreachable.add(e);
  return e;
}

/** Whether one of our helpers saw `e` come out of the transport. */
export function isUnreachable(e: unknown): boolean {
  return typeof e === "object" && e !== null && unreachable.has(e);
}
