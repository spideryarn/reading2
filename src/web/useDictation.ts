/**
 * **Talk into a textarea.** The browser's own speech recognition, not a round
 * trip to a model.
 *
 * Greg asked for a microphone and hoped OpenRouter could do the transcribing.
 * It can — there is a real `/api/v1/audio/transcriptions` endpoint, and
 * `input_audio` parts in chat completions besides — and we are not using it.
 * The reasons, so nobody has to re-derive them
 * (docs/plans/reader-profile.md § The microphone):
 *
 *  - **It is free and there is no server in it.** No route, no base64 upload,
 *    no error copy, no audio of the reader's voice crossing anything of ours.
 *  - **It gives live text while you talk**, which for two sentences into a box
 *    is a better experience than a spinner and then a paragraph.
 *  - **Safari runs it on-device** (macOS 14.1+, iPadOS 14.5+), which matters
 *    because the iPad is the device this app frets most about. Chrome sends
 *    audio to Google — hence the button being armed per press rather than a
 *    mode you can leave running.
 *
 * What we give up is **Firefox**, which has it behind a flag and so does not
 * have it. The button is not rendered there at all rather than rendered and
 * dead: `supported` below is the feature detect, and a control that is present
 * and does nothing teaches a reader they have failed at something.
 *
 * ## The three things that go wrong
 *
 * All three are handled here rather than left to the caller, because all three
 * look like the feature simply not working.
 *
 * 1. **Safari stops on a pause.** `continuous` is honoured loosely and the
 *    recogniser ends after a silence. So `onend` restarts it while the button
 *    is still armed, and only a second press stops it for real.
 * 2. **`no-speech` is not an error worth showing.** It fires constantly, on
 *    every ordinary gap. Only `not-allowed` and `service-not-allowed` reach the
 *    reader, and what they say is that the browser blocked the microphone —
 *    docs/project/copy.md, which is about saying whose problem it is.
 * 3. **Interim results must not be committed.** The recogniser revises what it
 *    thought you said. Confirmed text and the interim tail are separate state
 *    here and only the confirmed half is handed to `onText`, or a mid-sentence
 *    guess gets saved and then appended to.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/* The API is prefixed in Safari and unprefixed in Chrome, and neither spelling
   is in TypeScript's DOM library — it is not a standard. Declared narrowly:
   only the handful of members used below, so this cannot quietly grow into a
   second, wrong copy of the spec. */
interface Recognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseDictation {
  /** False on Firefox and anywhere else without the API. Render no button. */
  supported: boolean;
  listening: boolean;
  /** The unconfirmed tail, for showing greyed after the text. Never saved. */
  interim: string;
  /** Start if stopped, stop if started. The button is a toggle, not a hold. */
  toggle(): void;
  /** `not-allowed` and friends, in the reader's words. `no-speech` never gets here. */
  error: string | null;
}

/**
 * @param onText called with each **confirmed** phrase, to append where the
 * caret is. Never called with a guess.
 */
export function useDictation(onText: (text: string) => void): UseDictation {
  const [supported] = useState(() => ctor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<Recognition | null>(null);
  /* Whether the reader still wants this on. Read inside `onend`, which fires on
     every pause in Safari — a state variable read through that closure would be
     whatever it was when the handler was attached, so the restart would keep
     going after a stop. */
  const armed = useRef(false);
  const emit = useRef(onText);
  emit.current = onText;

  const stop = useCallback(() => {
    armed.current = false;
    setListening(false);
    setInterim("");
    recognition.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = ctor();
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    // The page's language, not a hardcoded locale: an app read in one language
    // and dictated in another is a reasonable thing to be, and guessing wrong
    // makes the transcript nonsense rather than merely worse.
    r.lang = document.documentElement.lang || navigator.language;

    r.onresult = (e) => {
      let confirmed = "";
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result) continue;
        if (result.isFinal) confirmed += result[0].transcript;
        else pending += result[0].transcript;
      }
      if (confirmed) emit.current(confirmed);
      setInterim(pending);
    };

    r.onerror = (e) => {
      /* Everything except the two that are the reader's browser refusing is
         swallowed. `no-speech` fires on every ordinary gap; `aborted` is what
         our own `stop()` produces. Showing either would mean an error message
         appearing while the feature was working perfectly, which is the fastest
         way to teach somebody to ignore the error area. */
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Your browser blocked the microphone. Allow it for this site and try again.");
        armed.current = false;
        setListening(false);
      }
    };

    r.onend = () => {
      // Safari ends the session on a pause. Restart while the reader still
      // wants it; otherwise this is the real stop.
      if (armed.current) {
        try {
          r.start();
          return;
        } catch {
          // Already starting. Not a failure — the next `onend` will handle it.
          return;
        }
      }
      setListening(false);
      setInterim("");
    };

    recognition.current = r;
    armed.current = true;
    setError(null);
    try {
      r.start();
      setListening(true);
    } catch {
      // `start()` on an already-running recogniser throws. Nothing is wrong.
      setListening(true);
    }
  }, []);

  const toggle = useCallback(() => {
    if (armed.current) stop();
    else start();
  }, [start, stop]);

  /* Leaving the page with the microphone on. `abort` rather than `stop`,
     because `stop` delivers one last result and this component will not be
     there to receive it. */
  useEffect(
    () => () => {
      armed.current = false;
      recognition.current?.abort();
    },
    [],
  );

  return { supported, listening, interim, toggle, error };
}
