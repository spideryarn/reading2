/**
 * **What a refused tap-to-talk event leaves behind, as a plain value.**
 *
 * A pure rule over facts the hook already keeps — no React, no clock, no data
 * channel — so refusal outcomes have unit tests (tests/live-talk-mode.test.ts)
 * as well as the sequences a fake session reaches. The hook
 * (`useLiveConversation`) keeps everything else: sending the events, the
 * microphone track, Done's timer, and the three short gates on Talk, Done and
 * a new call's mode, which are one condition each and stay where they are used.
 * docs/plans/261004e-sweep-cluster-22-live-tap-policy-as-a-pure-function.md.
 */

/**
 * **Who decides when the reader's turn starts and ends.**
 *
 * `hands-free` is the conversation as it has always been: the microphone is
 * open and OpenAI's voice detector decides. In a street that detector can hear
 * the traffic as somebody who has not finished, and hold the turn open for
 * ever (spya-kzdmhb; the one `LiveStall-open-turn` event, 2026-09-30, was a
 * 74-second turn that never closed). So the `open-turn` notice offers **tap to
 * talk**, which is OpenAI's documented push-to-talk: `turn_detection: null`, a
 * clear when the reader taps Talk, and a commit when they tap Done, with the
 * microphone track disabled in between so noise never reaches the service.
 *
 * **Not** "disable the track and let the detector close the turn on the
 * silence". The first draft did that; nothing documents that a disabled WebRTC
 * track sends silence rather than nothing, or that semantic VAD closes an
 * unfinished-sounding turn on it. GPT Sol, plan review, 2026-10-03.
 * docs/plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md.
 *
 * It lasts for the call and survives a Reconnect, including the pickers'; a
 * start the reader makes themselves is hands-free again. There is no way back
 * within a call, because that would need a second copy of the server's
 * turn-detection settings.
 */
export type TalkMode =
  | "hands-free"
  /** Ready: the detector is off and nothing is being sent. */
  | "tap-idle"
  /** Between Talk and Done. */
  | "tap-talking"
  /**
   * From Done until the reply begins, or entered with a reply already owed.
   * Nothing else says the companion is busy in that gap, and Talk in it would
   * start a turn over the one being sent.
   */
  | "tap-sending";

/**
 * What one of tap to talk's client events was for: the `session.update` that
 * turns the detector off, a buffer clear, Done's commit, or the
 * `response.create` that follows it.
 */
export type TapEventKind = "entry" | "clear" | "commit" | "response";

/** What a refused tap event leaves behind. See `tapRefusal`. */
export type TapRefusal =
  /** Nothing changes, and the reader is told nothing. */
  | { keep: true }
  /**
   * Every one of these also stops waiting for a commit and cancels a Done
   * still in its tail: after any of them, no tap turn is in flight that the
   * hook will ask a reply for.
   */
  | {
      keep: false;
      mode: TalkMode;
      /** Whether the microphone track is enabled afterwards. */
      mic: boolean;
      /** The service never took this turn, so no reply is owed for it. */
      dropDebt: boolean;
      /** The sentence the reader sees. */
      notice: string;
    };

/**
 * **An error against one of tap to talk's own events is a notice, and this is
 * what it does to the call.** Every other provider error ends the session,
 * which is right for errors nobody planned for. These are planned for: a Done
 * over an empty buffer, a `session.update` the service will not take. Hanging
 * up on the reader for either would be worse than the noise was.
 *
 * `submitted`: the mode is `tap-sending` with no Done tail pending, so a
 * sent turn is awaiting a reply (possibly owed before tap entry).
 * **A refusal can be late.** Talk's clear is sent long before
 * the commit and its error can arrive after it; that must not undo a turn the
 * service is taking. GPT Sol, plan review of 261004e, F1: it used to forget
 * the awaited commit, and the acknowledgement that followed asked for no reply.
 *
 * **A manual turn is only ever awaited in `tap-sending`.** The entry refusal
 * gives the call back to the voice detector, and with it the job of asking for
 * replies: a turn already sent is left owed (the `no-reply` notice and
 * Reconnect), not answered by a second `response.create` racing the
 * detector's. An earlier draft kept waiting for the commit in hands-free, and
 * the code review found three ways for that to go wrong
 * (docs/postmortems/261004h-recovery-mode-is-not-the-lifetime-of-a-pending-command.md).
 */
export function tapRefusal(
  kind: TapEventKind,
  at: { mode: TalkMode; submitted: boolean },
  message: string | undefined,
): TapRefusal {
  switch (kind) {
    case "entry":
      /* The detector is still on, so the call is what it was before the reader
         asked: listening, whatever they have pressed since. */
      return {
        keep: false,
        mode: "hands-free",
        mic: true,
        dropDebt: false,
        notice: "Tap to talk couldn’t start, so the conversation is listening as before.",
      };
    case "clear":
      /* Entering sends the update and then a clear. If both are refused, the
         update's recovery has already restored hands-free; the following clear
         error must not mute it again or replace its explanation. */
      if (at.mode === "hands-free") return { keep: true };
      /* Late: the turn this clear opened has since been sent. */
      if (at.mode === "tap-sending" && at.submitted) return { keep: true };
      return ready(message);
    case "commit":
      /* A commit is only sent from tap mode, so this one went before a late
         entry refusal. That left its reply owed; the service never took the
         turn, so it is not. The detector stays on. */
      if (at.mode === "hands-free") {
        return {
          keep: false,
          mode: "hands-free",
          mic: true,
          dropDebt: true,
          notice: `Tap to talk: ${message ?? "that didn’t go through"}. The conversation is listening as before.`,
        };
      }
      return ready(message);
    case "response":
      if (at.mode === "hands-free") return { keep: true };
      /* The commit succeeded, so the reader's item is already in both the
         provider conversation and our ledger. Calling it Ready would put a new
         turn behind an unanswered one and stop the ledger harvesting later
         exchanges. Keep the turn closed and its reply debt honest; Reconnect
         is the recovery for a session that refused to answer. */
      if (at.mode === "tap-sending") {
        return {
          keep: false,
          mode: "tap-sending",
          mic: false,
          dropDebt: false,
          notice: `Tap to talk: ${message ?? "the reply couldn’t start"}. Reconnect to try again.`,
        };
      }
      return ready(message);
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

/**
 * A refused clear or commit: back to Ready, whatever it was. Not recording
 * onto a buffer whose state is unknown, and not owing a reply to a turn the
 * service never took.
 */
function ready(message: string | undefined): TapRefusal {
  return {
    keep: false,
    mode: "tap-idle",
    mic: false,
    dropDebt: true,
    notice: `Tap to talk: ${message ?? "that didn’t go through"}. Tap Talk to try again.`,
  };
}
