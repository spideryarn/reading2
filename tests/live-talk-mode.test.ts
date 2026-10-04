/**
 * What a refused tap-to-talk event leaves behind (src/web/live/tap.ts).
 *
 * The hook's own tests (live-session-flow.test.tsx § tap to talk) drive this
 * through a fake data channel and reach a handful of the cells. This is the
 * regression table, written out rather than computed, so that a changed cell
 * is a changed line here. It does not prove which turn a refused event
 * belonged to: the rule is not told, and the hook's tests cover the sequences.
 */
import { describe, expect, it } from "vitest";
import { type TalkMode, type TapEventKind, type TapRefusal, tapRefusal } from "../src/web/live/tap.js";

const KINDS: readonly TapEventKind[] = ["entry", "clear", "commit", "response"];

/**
 * The states distinguished by this rule. `tap-sending` is two: inside Done's
 * tail, or waiting on a sent turn (including a reply owed before tap entry).
 */
const STATES = {
  "hands-free": { mode: "hands-free", submitted: false },
  "tap-idle": { mode: "tap-idle", submitted: false },
  "tap-talking": { mode: "tap-talking", submitted: false },
  "tap-sending, in the tail": { mode: "tap-sending", submitted: false },
  "tap-sending, commit gone": { mode: "tap-sending", submitted: true },
} as const satisfies Record<string, { mode: TalkMode; submitted: boolean }>;
type State = keyof typeof STATES;
const STATE_NAMES = Object.keys(STATES) as State[];

const KEEP: TapRefusal = { keep: true };
/** A refused `session.update`: the detector is still on, so listen as before. */
const LISTENING: TapRefusal = {
  keep: false,
  mode: "hands-free",
  mic: true,
  dropDebt: false,
  notice: "Tap to talk couldn’t start, so the conversation is listening as before.",
};
/** Back to Ready: microphone off, and the turn forgotten. */
const READY: TapRefusal = {
  keep: false,
  mode: "tap-idle",
  mic: false,
  dropDebt: true,
  notice: "Tap to talk: nope. Tap Talk to try again.",
};
/** A commit that went before a late entry refusal, itself refused. */
const REJECTED_WHILE_LISTENING: TapRefusal = {
  keep: false,
  mode: "hands-free",
  mic: true,
  dropDebt: true,
  notice: "Tap to talk: nope. The conversation is listening as before.",
};
/** A refused `response.create` after a commit that went through. */
const UNANSWERED: TapRefusal = {
  keep: false,
  mode: "tap-sending",
  mic: false,
  dropDebt: false,
  notice: "Tap to talk: nope. Reconnect to try again.",
};

describe("tapRefusal: what a refused tap event leaves behind", () => {
  const TABLE: Record<TapEventKind, Record<State, TapRefusal>> = {
    entry: {
      "hands-free": LISTENING,
      "tap-idle": LISTENING,
      "tap-talking": LISTENING,
      "tap-sending, in the tail": LISTENING,
      "tap-sending, commit gone": LISTENING,
    },
    clear: {
      "hands-free": KEEP,
      "tap-idle": READY,
      "tap-talking": READY,
      "tap-sending, in the tail": READY,
      /* Late: it must not undo a turn the service is already taking. */
      "tap-sending, commit gone": KEEP,
    },
    commit: {
      "hands-free": REJECTED_WHILE_LISTENING,
      "tap-idle": READY,
      "tap-talking": READY,
      "tap-sending, in the tail": READY,
      "tap-sending, commit gone": READY,
    },
    response: {
      "hands-free": KEEP,
      "tap-idle": READY,
      "tap-talking": READY,
      "tap-sending, in the tail": UNANSWERED,
      "tap-sending, commit gone": UNANSWERED,
    },
  };

  for (const kind of KINDS) {
    for (const state of STATE_NAMES) {
      it(`${kind} refused in ${state}`, () => {
        expect(tapRefusal(kind, STATES[state], "nope")).toEqual(TABLE[kind][state]);
      });
    }
  }

  it("says something when the service gave no message", () => {
    const sending = STATES["tap-sending, commit gone"];
    expect(tapRefusal("commit", sending, undefined)).toMatchObject({
      notice: "Tap to talk: that didn’t go through. Tap Talk to try again.",
    });
    expect(tapRefusal("response", sending, undefined)).toMatchObject({
      notice: "Tap to talk: the reply couldn’t start. Reconnect to try again.",
    });
  });
});
