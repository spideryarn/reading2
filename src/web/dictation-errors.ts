/**
 * **What the reader is told when the microphone stops.**
 *
 * Split out of [`useDictation.ts`](./useDictation.ts) on 2026-08-27, for one
 * reason: the version that lived inside the `onerror` handler was *partial*,
 * and a partial map here is a button that turns itself off in silence.
 *
 * It named four codes. Two it swallowed, two it apologised for, and everything
 * else fell past both branches, disarmed, and said nothing. The two that fell
 * through are the two people actually hit:
 *
 * - **`network`** — Chrome's Web Speech API is not necessarily on-device; it
 *   can ship the audio to a server. A captive portal, a VPN, a plane, an office
 *   proxy: this fires, the button goes out, and the reader has no reason on
 *   earth to connect a microphone to their internet connection unless we say
 *   so.
 * - **`audio-capture`** — no working input device. The headset that
 *   disconnected, the wrong thing selected in macOS Sound settings.
 *
 * So the shape here is a **total** function: every string in, a verdict out.
 * Not a lookup with a hole in it. Only the errors that need a *different action
 * from the reader* are named — permission, connection, input device, language —
 * and everything else lands on one general sentence, which is worse copy than a
 * specific one and infinitely better than nothing. That is deliberately not an
 * exhaustive enumeration of the spec: the spec gains codes (`phrases-not-
 * supported` is recent, `bad-grammar` is legacy) and a list that has to be kept
 * complete to be correct would go stale into silence again.
 * GPT Sol's review, 2026-08-27, item 10.
 *
 * The four rules these follow are docs/project/copy.md — say what happened
 * without assuming they know what any of this is, say *whose* problem it is,
 * say what to do next, and never blame the wrong thing, because telling
 * somebody to change a permission when their wifi is down sends them off to
 * break a setting that was fine.
 *
 * There are no bracketed codes on these, unlike src/messages.ts. Those exist
 * for failures a person might report to whoever runs the server; these are all
 * facts about the reader's own machine, which nobody here can look up.
 */

/**
 * The one code that is **never** a failure: `no-speech`.
 *
 * It fires on every ordinary gap while the reader is thinking — it is the most
 * common event this API emits — and showing a message for it would mean an
 * error appearing on screen while the feature worked perfectly, which is the
 * fastest way to teach somebody to ignore the place errors appear.
 *
 * `aborted` is deliberately **not** here; see {@link verdictFor}.
 */
export const KEEP_GOING = ["no-speech"] as const;

export type DictationVerdict =
  /** Not a failure. Stay armed, say nothing. */
  | { keepGoing: true }
  /** Stop, and tell the reader this. */
  | { keepGoing: false; message: string };

const MESSAGES: Record<string, string> = {
  "not-allowed":
    "Your browser blocked the microphone. Allow it for this site and try again.",
  /* Not the same sentence as `not-allowed`, though the old code used one string
     for both. Per the spec this means the *recognition service* was refused,
     which is a different thing from the microphone permission and has a
     different fix — sending someone to the microphone permission when the
     service is what was refused is the wrong-blame mistake copy.md exists to
     stop. GPT Sol's review, 2026-08-27, item 10. */
  "service-not-allowed":
    "Your browser would not allow speech recognition on this page. You can still type.",
  /* Deliberately does not lead with "try again". Retrying is exactly what
     somebody does with a connection error, and it cannot work until the
     connection does. */
  network:
    "Speech recognition needs an internet connection, and the connection failed. Check you are online, then press the microphone again.",
  "audio-capture":
    "No microphone was available. Check the input device your computer is set to use.",
  "language-not-supported":
    "Speech recognition does not support this page's language. You can still type.",
  "phrases-not-supported":
    "Speech recognition does not support this page's language. You can still type.",
  "bad-grammar":
    "Speech recognition does not support this page's language. You can still type.",
};

/**
 * The sentence for a code we have never seen.
 *
 * Vague on purpose — it is the honest limit of what we know — but it still does
 * the two jobs: it says the microphone stopped, so the button going out is
 * explained rather than mysterious, and it says the box still works, so nobody
 * concludes they have lost the ability to fill it in.
 */
const GENERAL = "The microphone stopped unexpectedly. Press it again, or type instead.";

/**
 * @param code the `error` property of a `SpeechRecognition` error event.
 * @param ours whether *this app* is what stopped the recogniser. It only
 * matters for `aborted`, and it matters a lot: `aborted` is what our own
 * `stop()` and `abort()` provoke, so swallowing it is right — but `aborted`
 * arriving while the reader still has the button armed is a real, unexplained
 * termination and must not be silent just because it shares a name with the
 * ordinary case. Swallowing every `aborted` was the previous behaviour and is
 * the same silent-failure shape as the missing codes above.
 * GPT Sol's review, 2026-08-27, item 10.
 */
export function verdictFor(code: string, ours = false): DictationVerdict {
  if ((KEEP_GOING as readonly string[]).includes(code)) return { keepGoing: true };
  if (code === "aborted" && ours) return { keepGoing: true };
  return { keepGoing: false, message: MESSAGES[code] ?? GENERAL };
}
