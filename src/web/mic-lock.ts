/**
 * **One microphone per page, whoever asks for it.**
 *
 * Everything else about dictation is careful that a single `useDictation` never
 * opens two captures — the `NOT_A_TRACK` probe, the removal of the recogniser's
 * own `start()`, the ordering in `beginCapture`. None of that helps with the
 * thing this file is for, which GPT Sol's plan review (2026-08-27, item 1) put
 * plainly: *"separate hook instances in chat and the comment dialog can
 * otherwise open two tracks."*
 *
 * That stopped being hypothetical the moment the microphone went into more than
 * one box. `/profile` alone has two `ProfileBox`es on it, each with its own
 * hook, each perfectly correct on its own. Two buttons, two `getUserMedia`
 * calls, two live captures — and on WebKit, which supports one microphone
 * source at a time, that is the failure the whole design is built to avoid,
 * arriving by a door nobody was watching.
 *
 * So the claim is page-wide and lives here rather than in the hook.
 *
 * ## Asked to stop, not shot
 *
 * A second claim does not seize the device. It asks the current holder to
 * **stop properly** — which for a running dictation means the words already
 * spoken are kept, committed and transcribed, exactly as if the reader had
 * pressed stop themselves. Anything else would make clicking the wrong
 * microphone a way of deleting what you had just said.
 *
 * Then it waits. `released` resolves when that holder's track is actually
 * stopped, and the new claim does not touch `getUserMedia` until it has —
 * because "the old one is stopping" and "the old one has stopped" are the two
 * states this file exists to tell apart.
 */

/** A live claim on the page's microphone. */
export interface MicClaim {
  /** Ask this holder to end its dictation the ordinary way, keeping its words. */
  stop(): void;
  /** Resolves once this holder's track is stopped and the device is free. */
  released: Promise<void>;
}

/**
 * Whoever the page will have to wait for next: a promise that settles when
 * **every** claim taken so far has let go.
 *
 * A single `holder` variable is the obvious shape and it is wrong, in a way
 * GPT Sol's code review (2026-08-27, item 3) worked out and this comment exists
 * to stop anyone re-introducing. With one holder:
 *
 * ```
 * A claims          holder = A            A is live
 * B claims          holder = B            B stops A, waits on A.released
 * C claims          holder = C            C stops B — and B has no track yet,
 *                                         so B.released resolves at once and C
 *                                         opens a device while A is still live
 * ```
 *
 * The bug is that B was installed as holder *before it had acquired anything*,
 * so C waited on the wrong thing. A queue fixes it by construction: each claim
 * waits on the whole chain behind it rather than on the most recent link, so C
 * cannot start until A has genuinely gone, whatever happens to B.
 */
let queue: Promise<void> = Promise.resolve();
/** The claim that has been asked most recently. Asked to stop by the next one. */
let latest: MicClaim | null = null;

/**
 * Take the page's microphone, waiting for everyone before you to let go.
 *
 * **Await this before `getUserMedia`, not after.** The whole value of it is the
 * gap it closes, and a claim taken after the device is already open is a claim
 * on something that has already gone wrong.
 */
export async function claimMicrophone(claim: MicClaim): Promise<void> {
  const before = queue;
  const previous = latest;
  latest = claim;
  /* **Extend the chain rather than replace it.** `queue` becomes "everything up
     to and including this claim has let go", so the next claimant waits for all
     of it — including any link that never acquired a device and resolved
     immediately. A `.catch` on the way in, because one holder whose release
     rejects must not wedge the microphone for the rest of the page's life. */
  queue = before.then(
    () => claim.released,
    () => claim.released,
  ).catch(() => {});
  if (previous) previous.stop();
  try {
    await before;
  } catch {
    /* Somebody upstream failed to release cleanly. They have still lost the
       device as far as we are concerned. */
  }
}

/**
 * Give it back. Does nothing if somebody else has since been asked.
 *
 * The queue is what the next claimant waits on, and it drains by itself as each
 * `released` settles; this only clears the "who do I ask to stop" pointer.
 */
export function releaseMicrophone(claim: MicClaim): void {
  if (latest === claim) latest = null;
}

/** For tests: forget every claim. Never called by the app. */
export function resetMicrophoneLock(): void {
  latest = null;
  queue = Promise.resolve();
}
