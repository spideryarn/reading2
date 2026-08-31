/**
 * Running several paid model calls at once, and stopping the rest when one
 * fails.
 *
 * Two stages now do this — `src/labels.ts` labels sections four at a time, and
 * `src/pdf-read.ts` transcribes PDF chunks — and both need the same three
 * things, none of which `Promise.all` gives on its own.
 *
 * **This module exists because the second caller arrived.** `allOrStop` was
 * written inside src/labels.ts and is still exported from there; the copy there
 * should import this one and go away. It was not moved in the same change
 * because that file was being rewritten by somebody else at the time, and
 * editing a file another session is mid-way through is how work gets lost —
 * docs/project/version-control.md.
 */

/**
 * `Promise.all`, but the caller gets to stop the work that has not finished.
 *
 * **The default behaviour is the bug this replaces.** `Promise.all` rejects on
 * the first failure and leaves every other promise running. For four batches of
 * text that is untidy; for a queue of PDF chunks it is a doomed run that keeps
 * buying answers nobody will read, and the bill arrives anyway.
 *
 * `stop` is where the caller aborts in-flight requests and clears the queue.
 * **Both are needed and neither reaches the other's work**: `abort` cancels
 * what is already in the air, `clear` drops what has not started. And with
 * p-queue specifically, `clear` alone is not enough in the other direction —
 * it never settles a cleared task's promise, so the `Promise.all` here would
 * wait forever on tasks that will now never run. That is why every caller must
 * also pass its `signal` to `queue.add`, so a queued task settles as aborted
 * rather than never settling at all. GPT-5.6-sol found that one, 2026-08-26.
 *
 * The original error is rethrown, not wrapped: the caller wants to know which
 * chunk failed and why, and `stop` is cleanup rather than a second opinion.
 */
export async function allOrStop<T>(work: Promise<T>[], stop: () => void): Promise<T[]> {
  try {
    return await Promise.all(work);
  } catch (err) {
    stop();
    throw err;
  }
}
