/**
 * **Which stall a live session is in, if any.**
 *
 * A pure rule over facts the hook already keeps — no React, no clock of its
 * own, no network — so that each rule, and each case that must *not* trip it,
 * is a unit test (tests/live-stall.test.ts).
 *
 * ## Why this exists
 *
 * Report SPIDERYARN-READING2-42: on a phone, walking down the street with
 * noise-cancelling earbuds, the live conversation "just kept kind of hanging".
 * Every state below is one the outside world can put a session into — the phone
 * takes the microphone away, the mobile link wobbles, street noise holds a turn
 * open, a reply never starts — and before this, every one of them left the page
 * saying "Listening" or "Thinking" with nothing wrong on screen and nothing to
 * press but hang up. The fix is not to guess which of them happened to Greg; it
 * is to make each one say so, and to put **Reconnect** beside it.
 * docs/plans/260915b-live-conversation-stalls-visible-and-recoverable.md.
 *
 * ## The thresholds are generous on purpose
 *
 * A notice that fires on an ordinary conversation teaches the reader to ignore
 * it, and then it says nothing on the day it is true. A reader holding an
 * argument in their head can talk for twenty seconds; a slow mobile network is
 * not a broken one; a long spoken answer can go a while between transcript
 * events. Each constant below says what it is wider than.
 */

export type LiveStall =
  /** The microphone track is `muted`: the device is not giving us samples. */
  | "microphone-paused"
  /** The peer connection is `disconnected`, which it may yet recover from. */
  | "connection"
  /** The reader's turn has been open far longer than anybody talks. */
  | "open-turn"
  /** A reply is owed and has not started, or started and went silent. */
  | "no-reply";

/**
 * How long a turn may stay open before it is called stuck.
 *
 * Wider than anybody's single breath of speech, by a margin. It is only a
 * notice — the reader who really is still talking reads it and carries on — but
 * it is wrong for them, so it waits well past the twenty seconds a long thought
 * takes. What it catches is `speech_started` with no commit behind it: the
 * voice detector hearing a street as somebody who has not finished.
 */
export const OPEN_TURN_MS = 30_000;

/**
 * How long a reply may be owed before it is called missing.
 *
 * `semantic_vad` at `auto` waits up to about four seconds to decide a sentence
 * has ended, and a first audio event on mobile data can take a few more. Twelve
 * is three times the first and comfortably past the second.
 */
export const NO_REPLY_MS = 12_000;

/**
 * How long a reply that has started may go without a single event on the
 * channel, while nothing is audibly playing.
 *
 * Longer than `NO_REPLY_MS`, because a response in progress has already shown
 * the service is answering, and OpenAI promises no cadence for its transcript
 * deltas. While the companion is audibly speaking this rule does not apply at
 * all: the audio and the data channel are separate paths, and a long answer can
 * outrun its own transcript.
 */
export const RESPONSE_SILENT_MS = 20_000;

/** What the hook knows, at one moment. */
export interface StallFacts {
  now: number;
  /** The microphone track's `muted`, kept from its `mute` and `unmute` events. */
  micMuted: boolean;
  /** `RTCPeerConnection.connectionState`, as a string so tests need no DOM type. */
  connection: string;
  /** When the reader's current turn opened (`speech_started`), or null if none is open. */
  turnOpenSince: number | null;
  /**
   * When a reply became owed, or null when none is.
   *
   * Owed from a committed turn and from a `response.create` the hook actually
   * sent — **not** from a function output, because the continuation after a
   * tool is deliberately withheld until the response and every tool have
   * finished (./tool-responses.ts), and counting from the output would call
   * that deliberate wait a stall. Discharged by `response.created`.
   */
  owedSince: number | null;
  /** A response has been created and is not done. */
  responseActive: boolean;
  /** When anything last arrived on the data channel. */
  lastEventAt: number;
  /** The companion's audio is playing (`output_audio_buffer.started` … `.stopped`). */
  speaking: boolean;
  /** A server-side tool is running; it has its own deadline and its own label. */
  toolRunning: boolean;
}

/**
 * The stall, or null.
 *
 * **In the order the reader can act on them.** A paused microphone first,
 * because it is the one the reader can often fix without us — unlock the phone,
 * put the earbud back — and it is also a cause of the others: a microphone that
 * sends nothing can hold a turn open. Then the connection, which explains
 * everything after it. Then the turn and the reply, which are symptoms.
 */
export function stallOf(f: StallFacts): LiveStall | null {
  if (f.micMuted) return "microphone-paused";
  if (f.connection === "disconnected") return "connection";
  if (f.turnOpenSince !== null && f.now - f.turnOpenSince >= OPEN_TURN_MS) return "open-turn";
  /* A running tool is not a stall: it has a sixty-second deadline of its own
     and "Using tools…" on screen, which is the truth. */
  if (f.toolRunning) return null;
  /* The reader is still talking, so the reply is not late yet — the voice
     detector has not decided they have finished. */
  if (f.turnOpenSince !== null) return null;
  if (f.owedSince !== null && f.now - f.owedSince >= NO_REPLY_MS) return "no-reply";
  if (f.responseActive && !f.speaking && f.now - f.lastEventAt >= RESPONSE_SILENT_MS) return "no-reply";
  return null;
}
