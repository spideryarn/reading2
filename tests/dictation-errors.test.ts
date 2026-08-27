/**
 * **Every way the microphone can stop must say something.**
 *
 * This file exists because of the bug it was written for. `useDictation`'s
 * `onerror` named four codes: two it swallowed (`no-speech`, `aborted`) and two
 * it apologised for (`not-allowed`, `service-not-allowed`). Every other code —
 * and the two that matter most in practice are `network` and `audio-capture` —
 * fell past both branches, **disarmed the recogniser, and turned the button off
 * with no message at all.**
 *
 * From the reader's chair that is indistinguishable from the feature not
 * existing: you press a microphone, it glows for a moment, it stops, and the
 * box is exactly as empty as it was. Greg hit it on 2026-08-27 and reported it
 * as "nothing seemed to happen" — docs/plans/microphone-level-meter.md.
 *
 * So the property under test is not "these four strings are right". It is
 * **totality**: any code at all, including one nobody has heard of, either
 * keeps the session going or produces a sentence. There is no third outcome.
 * That is why the last test throws random strings at it — a new code invented
 * by a browser in two years' time must land on the general message rather than
 * on silence.
 */
import { describe, expect, it } from "vitest";
import { KEEP_GOING, verdictFor } from "../src/web/dictation-errors.js";

/** The message, or a failure if the verdict was "keep going". Keeps the assertions readable. */
function messageFor(code: string, ours = false): string {
  const v = verdictFor(code, ours);
  if (v.keepGoing) throw new Error(`expected ${code} to stop, but it kept going`);
  return v.message;
}

describe("verdictFor", () => {
  it("keeps going on `no-speech`, which is not a failure at all", () => {
    // It fires on every ordinary gap while the reader thinks. A message for it
    // would mean an error appearing while the feature worked perfectly, which
    // is how you teach somebody to ignore the place errors appear.
    for (const code of KEEP_GOING) {
      expect(verdictFor(code)).toEqual({ keepGoing: true });
    }
  });

  it("swallows `aborted` only when we are the ones who aborted", () => {
    /* The distinction the old code did not draw, and it matters both ways:
       `aborted` is what our own stop() provokes, so reporting it would put an
       error on screen every time the reader pressed stop — but an `aborted`
       arriving while the reader still has the button armed is a real,
       unexplained termination, and swallowing that is the same silent-failure
       shape as the missing codes below. GPT Sol's review, 2026-08-27, item 10. */
    expect(verdictFor("aborted", true)).toEqual({ keepGoing: true });
    expect(verdictFor("aborted", false).keepGoing).toBe(false);
    expect(messageFor("aborted", false).length).toBeGreaterThan(10);
  });

  it("sends the reader to the microphone permission for `not-allowed`", () => {
    expect(messageFor("not-allowed")).toMatch(/blocked the microphone/i);
  });

  it("does NOT blame the microphone permission for `service-not-allowed`", () => {
    /* Per the spec this means the recognition *service* was refused, which is a
       different thing with a different fix. Both codes shared one string until
       2026-08-27, so half the time this sent somebody off to change a
       permission that was never the problem — the wrong-blame mistake
       docs/project/copy.md exists to stop. */
    const message = messageFor("service-not-allowed");
    expect(message).not.toMatch(/blocked the microphone/i);
    expect(message).toMatch(/speech recognition/i);
  });

  it("says the connection failed for `network`, because Chrome's speech is not on-device", () => {
    /* The one people will actually hit and the one hardest to guess at. Chrome
       ships the audio to Google; a captive portal, a VPN or a plane makes this
       fire, and the reader has no reason on earth to connect a microphone
       button to their internet connection unless we say so. */
    const message = messageFor("network");
    expect(message).toMatch(/connection|internet|offline/i);
    // And it must NOT tell them to check a permission, which is the wrong fix
    // and the expensive kind of wrong: they will go and change a setting.
    expect(message).not.toMatch(/blocked the microphone/i);
  });

  it("points at the input device for `audio-capture`", () => {
    expect(messageFor("audio-capture")).toMatch(/microphone|input device/i);
  });

  it("never returns silence for a code it has never seen", () => {
    for (const code of ["language-not-supported", "phrases-not-supported", "bad-grammar", "", "wat", "网络"]) {
      expect(messageFor(code).length).toBeGreaterThan(10);
    }
  });

  it("gives every message a full stop, because these are sentences and not codes", () => {
    for (const code of ["not-allowed", "service-not-allowed", "network", "audio-capture", "wat"]) {
      expect(messageFor(code).trim().endsWith(".")).toBe(true);
    }
  });
});
