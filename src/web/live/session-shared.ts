/**
 * **What the two live-conversation hooks share that is not React.**
 *
 * `useLiveConversation` (OpenAI Realtime) and `gpt-live/useGptLive` (GPT-Live)
 * are two wires behind one `LiveApi`, built side by side to be compared, and
 * one of them will be deleted
 * (docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md).
 * Everything here was lifted out of the Realtime hook unchanged on 2026-10-03,
 * comments and all, so that the second hook uses the same clocks and the same
 * sentences rather than copies that drift. When one engine goes, fold this
 * back into the survivor or leave it; nothing here knows about either wire.
 *
 * **A module of its own rather than exports on the Realtime hook**, because
 * tests mock that module whole (tests/conversation-band-live.test.tsx), and a
 * value imported from a mocked module is not there.
 *
 * Not here: the microphone acquisition, the peer-connection setup, the commit
 * queue, the caps effect and the unmount effect. Those are woven through each
 * hook's own refs and staleness checks, and `useGptLive` has its own copy of
 * each. Its header lists them.
 */

/**
 * How long the channel is held open after the reader hangs up.
 *
 * Not a guess at the network. It is the window in which OpenAI delivers the
 * things that arrive *after* the audio stops — above all
 * `…input_audio_transcription.completed` for the sentence just spoken, which
 * routinely lands after the answer to it. Closing at once keeps the answer and
 * loses the question, in the reader's own transcript, with nothing to show it
 * happened.
 *
 * It ends early whenever the ledger has nothing unfinished, so a reader who
 * stops after a completed answer waits for none of it.
 */
export const HANGUP_GRACE_MS = 2_500;

/** How often the grace window asks whether it can stop waiting. */
export const GRACE_POLL_MS = 100;

/**
 * **The two caps, and why a live session needs any.**
 *
 * The meter measures this now (./meter.ts), but measuring is not limiting:
 * nothing on our server can end somebody's session, so the only thing standing
 * between a forgotten tab and an hour of billed room noise is a clock in the
 * browser. OpenAI ends a session at sixty minutes, which bounds the damage and
 * does not prevent it.
 *
 * Two clocks rather than one, because they answer different questions. The idle
 * one is the useful one: a reader who has stopped talking has stopped having a
 * conversation, whatever the tab still shows. The wall clock is the backstop
 * for a room that is never quiet — a fan, a television, an open window — where
 * the voice detector keeps finding speech that is not the reader's.
 *
 * Generous on purpose. A conversation with long pauses for thinking is exactly
 * what this feature is for (`semantic_vad` in src/live.ts exists for the same
 * reason), so the idle cap must not cut off somebody who is reading a paragraph
 * before they answer.
 */
export const IDLE_CAP_MS = 5 * 60_000;
export const SESSION_CAP_MS = 20 * 60_000;

/**
 * How long the seeding barrier may stay up before the session is called failed.
 *
 * Generous, because it covers the channel opening as well as the round trip for
 * every seeded item, and a slow connection is not a broken one. It is a deadline
 * on something going *wrong* rather than on the network being quick.
 */
export const SEED_TIMEOUT_MS = 15_000;
export const TOOL_TIMEOUT_MS = 60_000;
export const DISCONNECT_GRACE_MS = 8_000;

/** How often a live session asks ./stall.ts whether it is stuck. */
export const STALL_TICK_MS = 1_000;

/**
 * How long a stall must last before Sentry hears about it.
 *
 * A Bluetooth route change can mute the microphone for a fraction of a second,
 * and a report per blip would bury the ones that matter. The notice is shown at
 * once regardless; this only decides what is worth writing down.
 */
export const STALL_REPORT_AFTER_MS = 5_000;

/**
 * The sentence for a start that failed.
 *
 * `alsoUnavailable` is anything else in a server message that means "live
 * voice is not available", beyond the two tags and a network failure. The
 * Realtime hook passes the name of the server's credential, which its route
 * could once say in an error; that name stays in that file, which the spend
 * scan (tests/no-undeclared-spend.test.ts) already knows about, rather than in
 * a module both engines import.
 */
export function startupMessage(error: unknown, alsoUnavailable?: RegExp): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Microphone access was blocked. Allow it in your browser, then try Live again, or carry on typing.";
    if (error.name === "NotFoundError") return "No microphone is available. Connect one and try Live again, or carry on typing.";
    if (error.name === "NotReadableError") return "The microphone could not be opened. Check whether another app is using it, then try again.";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/\[live-(?:not-set-up|upstream)\]|fetch|network|load failed/i.test(message) || alsoUnavailable?.test(message)) {
    console.error("[live] voice startup failed", error instanceof Error ? error.name : "unknown");
    return "Live voice is unavailable right now. Try again, or carry on typing or dictation.";
  }
  return message;
}

/**
 * A track that carries silence, so an offer can have audio in it with no
 * permission prompt.
 *
 * A gain of zero rather than a muted track: a muted track is still a
 * `getUserMedia` track and still needs the grant. This is an oscillator that is
 * never audible, which is a real `MediaStreamTrack` from the peer connection's
 * point of view and costs the reader nothing because there is no reader.
 */
export function silentTrack(ctx: AudioContext): MediaStreamTrack {
  const dest = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain).connect(dest);
  osc.start();
  const track = dest.stream.getAudioTracks()[0];
  if (!track) throw new Error("no synthetic audio track [live-no-track]");
  return track;
}

/**
 * **`show_passage`, answered in the browser** — the one tool with no server
 * behind it. Both engines handle it the same way: read the ids, record the
 * pointer, and tell the model how many passages the reader was shown.
 *
 * The ids are not checked against the article here. The pointer is drawn by
 * `PassageLinks`, which skips an id it cannot find, and the server checks them
 * again when the exchange is written (`parseSpokenPassages` in src/routes.ts).
 */
export function shownPassage(args: Record<string, unknown>): {
  blockIds: string[];
  why: string;
  /** What the model is told. */
  output: string;
  /** For the tools strip, which hides this tool; kept for the stored receipt's shape. */
  label: string;
  detail: string;
} {
  const blockIds = Array.isArray(args.blockIds) ? args.blockIds.map(String) : [];
  const why = typeof args.why === "string" ? args.why : "";
  return {
    blockIds,
    why,
    output: `Showed the reader ${blockIds.length} passage${blockIds.length === 1 ? "" : "s"}.`,
    label: "pointed at",
    detail: blockIds.join(" "),
  };
}
