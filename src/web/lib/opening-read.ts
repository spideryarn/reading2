/**
 * **The read that fills a panel's saved list, with an end.**
 *
 * Three panels — saved searches (`useSearch`), referee criteria (`useCriteria`)
 * and comments (`useComments`) — fetch their whole list once when they open, and
 * each lets the reader add a row of their own. The list arrives as one snapshot
 * that *replaces* what is on screen, so a row the reader created while that
 * snapshot was still in the air was wiped from the tab the moment it landed.
 * docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md.
 *
 * The fix Greg chose (2026-09-11) is an order rather than a merge: the reader
 * may type while the list loads, and Run / Find / Save wait until the read has
 * **settled** — answered, failed, or given up on. That needs the third ending
 * to exist, because `apiFetch` has no deadline of its own and a read that never
 * answers would otherwise hold the button off for ever. This is that ending.
 *
 * ## The order at the deadline, and why it is this order
 *
 * 1. **The snapshot loses its right to commit.** The returned promise settles
 *    with `OpeningReadTimedOut` — `Promise.race` settles once, so an answer
 *    arriving afterwards has nowhere to go. That is the part doing the work.
 * 2. The request is aborted, which is courtesy: it frees the connection, and
 *    an aborted GET is never answered from the offline copy (`attempt` in
 *    api.ts). Nothing depends on the abort landing.
 * 3. The caller's `catch` marks the load failed and `loaded`, which is what
 *    enables the writes.
 *
 * Only in that order is a write made after the deadline safe: invalidate
 * first, and there is no later snapshot to erase it.
 *
 * Recovery stays a page reload in v1. An in-place retry would be a second
 * snapshot racing the reader's writes — the same bug again — and would need
 * this gate again or a merge (the plan's reconciliation stages).
 */
import { LIST_LOAD_TIMED_OUT } from "../../messages.js";
import { apiFetch, readJson } from "./api.js";

/**
 * How long a panel waits for its saved list before giving up on it.
 *
 * Fifteen seconds is far past an ordinary answer — one indexed query behind a
 * serverless function, a second or two even from a cold start — and short
 * enough that a reader whose request has vanished is not left in front of a
 * Run button that will not run. It bounds the *whole* read, headers and body,
 * because a body that stops arriving strands the button exactly as well.
 */
export const OPENING_READ_DEADLINE_MS = 15_000;

/** The read was given up on at the deadline. Its message is the reader's. */
export class OpeningReadTimedOut extends Error {
  constructor() {
    super(LIST_LOAD_TIMED_OUT.message);
    this.name = "OpeningReadTimedOut";
  }
}

export interface OpeningRead<T> {
  /** The parsed body, or `OpeningReadTimedOut`, or whatever the read threw. */
  body: Promise<T>;
  /** The panel is going away: stop the clock and the request. */
  abandon(): void;
}

export function openingRead<T>(url: string): OpeningRead<T> {
  const request = new AbortController();
  let clock: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    clock = setTimeout(() => {
      reject(new OpeningReadTimedOut());
      request.abort();
    }, OPENING_READ_DEADLINE_MS);
  });
  const read = apiFetch(url, { signal: request.signal }).then((r) => readJson<T>(r));
  return {
    body: Promise.race([read, deadline]).finally(() => clearTimeout(clock)),
    abandon() {
      clearTimeout(clock);
      request.abort();
    },
  };
}
