/**
 * `describeFetchFailure` — the one rule for what a reader is shown about a
 * caught failure. Its own module since 2026-09-24 (plan 260924a § Stage 2c), so
 * the shelf, the job engine and the admin pages use it without importing a
 * comments hook; it used to live in src/web/useComments.ts.
 */
import { PAGE_FAULT, wentQuiet } from "../../messages.js";
import { captureClientFailure } from "../monitoring.js";
import { couldNotReach, isUnreachable, ReaderFacingError } from "./reader-facing.js";
import { StreamStalled } from "./sse.js";

/**
 * The sentence a reader sees for a caught failure — and only three kinds of
 * error get to choose it: a stalled stream, a lost connection our helpers
 * marked as one, and a `ReaderFacingError` (the server's own `{ error }`, or a
 * sentence the client wrote for a reader). Anything else gets `PAGE_FAULT` and
 * is reported, because its words were never written for a reader — see
 * src/web/lib/reader-facing.ts and docs/project/copy.md.
 *
 * `fetch` rejects with a bare `TypeError` for every transport-level failure —
 * server down, connection reset, request cut off mid-flight — and **its wording
 * is the browser's**: "Failed to fetch" in Chrome, "Load failed" in Safari,
 * "NetworkError when attempting to fetch resource." in Firefox. So a lost
 * connection is recognised by the mark `apiFetch` puts on it, never by the
 * words — four callers used to match Chrome's string exactly, and a reader on
 * an iPad was shown "Load failed" (plan 260924a § Stage 2c).
 *
 * In the development build the original text is kept in parentheses so the
 * message is still searchable; a built page never shows it (`couldNotReach`).
 */
export function describeFetchFailure(error: Error): string {
  /* A stream that stopped delivering bytes. `StreamStalled`'s own message is
     written for whoever is reading a stack trace — "the stream sent nothing for
     60s" — and `wentQuiet` is the same fact said to a reader, with the bracketed
     code every other failure here carries. */
  if (error instanceof StreamStalled) return wentQuiet(error.seconds).message;
  /* A lost connection, but only one our own helpers **saw** come out of the
     transport — `apiFetch`, `readJson`, `readEvents` mark it there. Not "any
     `TypeError`": every JavaScript bug is one of those too, and telling a
     reader "couldn't reach the server" over `Cannot read properties of
     undefined` is a false claim with the bug's text in brackets. */
  if (isUnreachable(error)) return couldNotReach(error.message);
  /* A sentence somebody here wrote for a reader — the server's own `{ error }`
     (`HttpError`), or one the client wrote at the throw site. The class is the
     claim; see src/web/lib/reader-facing.ts. */
  if (error instanceof ReaderFacingError) return error.message;
  /* Anything else is an exception nobody wrote for a reader: React's own
     `Minified React error #185` reached one here on 2026-09-12, printed as a
     chat answer's failure after the server had finished it. Its words go to the
     console and to Sentry (whose scrubber withholds an unauthored message);
     the reader gets the page's own sentence.
     docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md */
  console.error("[describeFetchFailure] an exception with no reader-facing sentence", error);
  captureClientFailure(error, { where: "describeFetchFailure" }, { neverAuthored: true });
  return PAGE_FAULT.message;
}
