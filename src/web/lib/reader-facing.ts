/**
 * The two facts `describeFetchFailure` (src/web/lib/describe-failure.ts) needs before it
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
 * Nearly a leaf on purpose — its one import is src/messages.ts, itself a leaf:
 * several tests `vi.mock("…/lib/api.js")` wholesale,
 * and a class that lived there would be mocked away — `instanceof` against
 * `undefined` throws.
 */

import { COULD_NOT_REACH } from "../../messages.js";

/**
 * **What to say when the request never got a response at all**, for every
 * place in the client that says it.
 *
 * A built page says `COULD_NOT_REACH` and nothing else. The development build
 * — `npm run dev`, where this failure is most often the dev server having
 * restarted or stopped — says so, and keeps the browser's own words in brackets
 * so the failure is still searchable. Those words are never shown on a built
 * page: they are the browser's, and a `TypeError` from somewhere unexpected
 * can carry more than "Failed to fetch" (GPT Sol, F3 on plan 260924a).
 *
 * @param detail the transport error's own message, for the development build.
 */
export function couldNotReach(detail?: string): string {
  if (import.meta.env.PROD) return COULD_NOT_REACH.message;
  const why = detail ? ` (${detail})` : "";
  return `Couldn't reach the dev server — is \`npm run dev\` still running?${why} [net-down]`;
}

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
