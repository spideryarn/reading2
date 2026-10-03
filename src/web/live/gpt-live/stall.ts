/**
 * **Is GPT-Live owing the reader a reply it has not started?**
 *
 * A pure rule over facts `useGptLive` keeps: no clock of its own, no React.
 * It is the GPT-Live half of `../stall.ts` and answers one of that file's
 * four questions, `"no-reply"`. The microphone and connection stalls are
 * shared and stay there; the open-turn stall has no counterpart, because
 * nothing on this wire says a turn is open.
 * docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md § Lifecycle and stalls.
 *
 * ## Why it is per delegation
 *
 * The spike's eleventh run: the backend looked the passage up, wrote the
 * right answer, and the voice never said it. So "the backend finished" starts
 * a debt. GPT Sol's review (F7) gave the order a single debt would miss: the
 * tool finishes, the voice says "one moment", the backend's final response
 * completes, and nothing follows. The filler was speech, and it came before
 * there was an answer to speak, so it must pay nothing.
 *
 * ## The rules
 *
 * - **A delegation owes speech from the moment its final backend response
 *   completes** until a companion fragment that *began* after that moment.
 * - **A delegation that is still running owes nothing and suspends the
 *   reader's clock.** Its tools have a deadline and a label of their own.
 * - **With no delegation running, a reply is owed from the reader's last
 *   words** until a companion fragment that began after them. If a delegation
 *   ended after those words (finished or failed), the clock starts again from
 *   that ending.
 * - Owed for `GPT_LIVE_NO_REPLY_MS` is a stall.
 *
 * ## What it can and cannot tell apart
 *
 * A fragment carries no delegation id, so speech cannot be matched to the
 * delegation it answers. The rule is the conservative one: **speech pays
 * every delegation whose final came before it, and none whose final came
 * after it.** So with two delegations, an answer to the first does not clear
 * the second if the second finished later. But if both finished and then one
 * answer was spoken, both are paid, and a second answer that never comes is
 * not noticed. Erring that way is deliberate: a notice that fires on a
 * working conversation teaches the reader to ignore it.
 *
 * The same holds for filler that is still being spoken as the final arrives:
 * its later words began after the final, and pay. In the spike's `allow`
 * trace that is exactly what the voice does, and the answer follows 600 ms
 * later in one unbroken run, so no rule on the timing of speech alone can
 * separate the two.
 *
 * ## Two clocks
 *
 * A final is timed by when it arrived. A fragment is timed on the session
 * timeline (`start_ms`), and arrives some hundreds of milliseconds after it
 * was spoken. Comparing a fragment's *arrival* with the final would let
 * filler spoken just before the final pay for it. `sessionZero` estimates
 * where the session timeline's zero sits on the caller's clock, so the
 * caller can say when a fragment *began*: `zero + start_ms`.
 */
import type { LiveStall } from "../stall.js";

/**
 * How long a reply may be owed before it is called missing.
 *
 * Longer than Realtime's twelve seconds. The spike's voice began the answer
 * 1.4 s after the backend finished in one run and 0.5 s in another; twenty is
 * far past both, and GPT-Live may rightly stay quiet for a while when the
 * reader is thinking out loud.
 */
export const GPT_LIVE_NO_REPLY_MS = 20_000;

/** One delegation, as far as the stall rule cares. */
export interface DelegationDebt {
  id: string;
  /**
   * When its final backend response completed, on the caller's clock. Null
   * while it is still running. A failed delegation is not listed at all: the
   * caller removes it and records the time in `delegationEndedAt`.
   */
  finalAt: number | null;
}

/** What the hook knows, at one moment. All times on one clock. */
export interface GptLiveStallFacts {
  now: number;
  /** When the reader's latest fragment ended, or null if the reader has not spoken. */
  readerLastAt: number | null;
  /** When the companion's latest fragment began, or null if it has not spoken. */
  companionLastBeganAt: number | null;
  /** Every delegation that has not failed. Paid ones may stay listed; they are ignored. */
  delegations: readonly DelegationDebt[];
  /** When a delegation last ended, final or failed, or null if none has. */
  delegationEndedAt: number | null;
}

/** When the oldest unpaid reply became owed, or null if nothing is owed. */
export function replyOwedSince(f: GptLiveStallFacts): number | null {
  const paid = (since: number) => f.companionLastBeganAt !== null && f.companionLastBeganAt > since;
  let oldest: number | null = null;
  let running = false;
  for (const delegation of f.delegations) {
    if (delegation.finalAt === null) {
      running = true;
      continue;
    }
    if (paid(delegation.finalAt)) continue;
    oldest = oldest === null ? delegation.finalAt : Math.min(oldest, delegation.finalAt);
  }
  /* The reader's own debt. Suspended while a delegation runs, and restarted
     from the last delegation to end after the reader spoke: the wait for a
     tool is not the voice being late. */
  if (!running && f.readerLastAt !== null) {
    const since = Math.max(f.readerLastAt, f.delegationEndedAt ?? f.readerLastAt);
    if (!paid(since)) oldest = oldest === null ? since : Math.min(oldest, since);
  }
  return oldest;
}

/** `"no-reply"` when a reply has been owed for `GPT_LIVE_NO_REPLY_MS`, else null. */
export function gptLiveStallOf(f: GptLiveStallFacts): Extract<LiveStall, "no-reply"> | null {
  const since = replyOwedSince(f);
  return since !== null && f.now - since >= GPT_LIVE_NO_REPLY_MS ? "no-reply" : null;
}

/**
 * Where the session timeline's zero sits on the caller's clock, re-estimated
 * with each fragment.
 *
 * A fragment cannot arrive before it has ended, so `arrivedAt - endMs` is
 * never earlier than the true zero, and the smallest value seen is the best
 * estimate. It is late by the shortest transcript delay seen, a few hundred
 * milliseconds in the spike, so filler that ends within that much of the
 * final can still be counted as beginning after it.
 */
export function sessionZero(previous: number | null, arrivedAt: number, endMs: number): number {
  const estimate = arrivedAt - endMs;
  return previous === null ? estimate : Math.min(previous, estimate);
}
