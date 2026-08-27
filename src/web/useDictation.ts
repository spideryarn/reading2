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
 *  - **Safari can run it on-device** (macOS 14.1+, iPadOS 14.5+), which matters
 *    because the iPad is the device this app frets most about. Whether it
 *    *does* is implementation-defined and Apple does not promise it, so the
 *    `network` error is handled on every browser rather than treated as a
 *    Chrome-only concern (GPT Sol's review, 2026-08-27, item 14).
 *
 * What we give up is **Firefox**, which has it behind a flag and so does not
 * have it. The button is not rendered there at all rather than rendered and
 * dead: `supported` below is the feature detect, and a control that is present
 * and does nothing teaches a reader they have failed at something.
 *
 * ## Three phases, not two
 *
 * `phase` is `idle | opening | listening`, and the middle one is the whole
 * point of the 2026-08-27 rewrite. Greg pressed the button and reported that
 * *"nothing seemed to happen"*. Measured in Chrome: `audiostart` lands **1.1
 * seconds** after `start()`, and no transcript for several seconds after that.
 * The old hook set `listening` synchronously on the line after `r.start()`, so
 * the button went orange a second before the microphone was open and anything
 * said into that second was gone with no sign it had been lost.
 *
 * Now `opening` means armed-but-deaf and says so, and the button only claims to
 * be listening at `audiostart`. Safari's automatic restart drops back to
 * `opening` until the next `audiostart`, because it genuinely is deaf again.
 *
 * ## One microphone, shared with the meter
 *
 * The level meter needs samples, and `SpeechRecognition` does not hand out its
 * `MediaStream`. The obvious answer — open a second `getUserMedia` for the
 * meter — is unsafe: **WebKit supports one microphone source at a time**, and a
 * second capture can kill the first or silently change the routing, so on an
 * iPad the meter could be showing a different microphone from the one being
 * transcribed (GPT Sol's review, items 1 and 2).
 *
 * The way out is that recent Chromium implements the spec's
 * `recognition.start(audioTrack)`, so **one** track feeds both. Whether a given
 * browser has it is asked by `beginCapture` in the only way that cannot lie —
 * by calling it with something that is not a track and seeing whether the
 * argument is type-checked or ignored — and that probe is the first thing that
 * happens, before any stream is opened. The reasoning is on `beginCapture`; the
 * short version is that a feature detect which can be wrong-positive here does
 * not degrade, it produces two concurrent captures and a meter drawn from a
 * different microphone than the words.
 *
 * Where the overload is missing — Safari today — we take **no** second stream
 * and drive the meter from the recogniser's own `soundstart`/`soundend`, which
 * is a real observation of the real audio, just a binary one. See `meter`.
 *
 * ## The things that go wrong
 *
 * 1. **Safari stops on a pause.** `continuous` is honoured loosely and the
 *    recogniser ends after a silence. So `onend` restarts it while the button
 *    is still armed, and only a second press stops it for real.
 * 2. **`no-speech` is not an error worth showing.** It fires constantly, on
 *    every ordinary gap. See [`dictation-errors.ts`](./dictation-errors.ts),
 *    which is also where the bug lived that made this whole rewrite necessary.
 * 3. **Interim results must not be committed.** The recogniser revises what it
 *    thought you said. Confirmed text and the interim tail are separate state
 *    here and only the confirmed half is handed to `onText`, or a mid-sentence
 *    guess gets saved and then appended to.
 * 4. **The `AudioContext` is one long-lived singleton, and it is never
 *    suspended between dictations.** One per page is Apple's own advice, and
 *    Safari has a hard limit that creating one per press walks into. It is
 *    also never suspended on stop, which looks like a leak and is a fix:
 *    `suspend()` is asynchronous, so a stop immediately followed by a start
 *    could have the suspend land *after* the new session read the state and
 *    found it running, leaving the meter dead for the rest of the page's life.
 *    Stopping the track is what releases the hardware. GPT Sol's code review,
 *    item 3.
 * 5. **It is only built where there is something to measure.** Safari takes the
 *    binary path and never gets a context at all.
 */
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { verdictFor } from "./dictation-errors.js";
import {
  audioConstraint,
  labelled,
  rememberDevice,
  rememberedDevice,
} from "./mic-devices.js";
import { type MicRecording, type MicTape, recordTrack } from "./mic-recording.js";
import { useAudioLevel } from "./useAudioLevel.js";

/* The API is prefixed in Safari and unprefixed in Chrome, and neither spelling
   is in TypeScript's DOM library — it is not a standard. Declared narrowly:
   only the handful of members used below, so this cannot quietly grow into a
   second, wrong copy of the spec. */
interface Recognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  /** The one-argument form is the spec's, and only recent Chromium has it. */
  start(audioTrack?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onsoundend: (() => void) | null;
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

/**
 * The page's one `AudioContext`, created on the first press and never closed.
 *
 * Apple's guidance is one long-lived context per page, and creating one per
 * dictation runs into a hard per-page limit on Safari after a few cycles. It is
 * created lazily rather than at module load because constructing one before any
 * user gesture is exactly what iOS refuses.
 */
let shared: AudioContext | null = null;
function audio(): AudioContext | null {
  if (shared && shared.state !== "closed") {
    /* Not awaited, and it must not be: this runs inside the click handler, and
       an `await` here would put everything after it outside the gesture — which
       is the thing the gesture requirement is about. */
    if (shared.state === "suspended") void shared.resume().catch(() => {});
    return shared;
  }
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    shared = new Ctx();
    if (shared.state === "suspended") void shared.resume().catch(() => {});
    return shared;
  } catch {
    return null;
  }
}

/** Armed but not yet hearing / hearing. Never both, never neither while armed. */
export type DictationPhase = "idle" | "opening" | "listening";

/** Where the moving bars are getting their number from. */
export type MeterKind =
  /** A real RMS off the same track the recogniser is transcribing. */
  | "measured"
  /** The recogniser's own `soundstart`/`soundend` — real, but on or off. */
  | "detected"
  /** Nothing to show. The bars are not rendered. */
  | "none";

export interface UseDictation {
  /** False on Firefox and anywhere else without the API. Render no button. */
  supported: boolean;
  phase: DictationPhase;
  /** Convenience for `phase !== "idle"`: the button is armed and its press stops it. */
  armed: boolean;
  /** The unconfirmed tail, for showing greyed after the text. Never saved. */
  interim: string;
  /** 0..1. A ref — read it in a rAF, never during render. */
  level: MutableRefObject<number>;
  meter: MeterKind;
  /**
   * Measuring, and nothing above the activity threshold for ten seconds.
   * **An observation, not a diagnosis** — nothing may tell the reader their
   * microphone is broken on the strength of it.
   */
  quiet: boolean;
  /** Start if stopped, stop if started. The button is a toggle, not a hold. */
  toggle(): void;
  /** `not-allowed` and friends, in the reader's words. `no-speech` never gets here. */
  error: string | null;
  /**
   * `Date.now()` at the first `audiostart` of this dictation, for the timer.
   * Null until the microphone is genuinely open — see {@link Session.audioAt}.
   */
  startedAt: number | null;
  /**
   * The browser's own name for the microphone we opened — the exact string the
   * reader will see in their system sound settings, which is why it is quoted
   * verbatim rather than tidied. Null on the binary path, where we open nothing.
   */
  deviceLabel: string | null;
  /** The remembered choice, for marking the picker. Null means "the browser's default". */
  deviceId: string | null;
  /**
   * A microphone was chosen and we could not open it, so something else is
   * being used. Said out loud rather than left for the reader to notice, since
   * transcribing from a device they did not pick is the failure this round is
   * about. GPT Sol's code review, item 2.
   */
  deviceUnavailable: boolean;
  /**
   * Choose a microphone, and restart on it if a dictation is running — a picker
   * that needs a second press to take effect looks broken, which is the whole
   * genre of bug this round is about.
   */
  chooseDevice(deviceId: string | null): void;
  /**
   * The audio of a dictation that ended having transcribed **nothing**, kept so
   * the reader can hear what we heard. Null the rest of the time, which is
   * almost always. See [mic-recording.ts](./mic-recording.ts).
   */
  recording: MicRecording | null;
  /** Throw the kept recording away. */
  clearRecording(): void;
}

/**
 * @param onText called with each **confirmed** phrase, to append where the
 * caret is. Never called with a guess.
 * @param onEnd called once on **every** transition out of armed, whatever
 * caused it — the reader pressing stop, a `network` error, a failed Safari
 * restart. It exists because dictated text was only ever committed by the stop
 * button: any other way of stopping left confirmed words sitting unsaved in a
 * box the reader believed had taken them. GPT Sol's review, item 12.
 */
/**
 * One press of the button, from the press to the last word.
 *
 * **A per-session object rather than a set of refs, and that is the fix for a
 * whole class of bug** (GPT Sol's code review, 2026-08-27, items 1 and 2). The
 * previous version inferred everything from one question — *is this still the
 * current recogniser?* — and that question was being asked to decide two
 * different things: whether to restart, and whether an `aborted` was one we
 * caused. A queued error from a recogniser we had already replaced then passed
 * the check and terminated the session that replaced it.
 *
 * Now each press gets one of these, and the two questions have two answers:
 * `stopRequested` says whether we asked for this, and `finished` says whether
 * this session has already had its ending.
 */
interface Session {
  r: Recognition;
  /** We called `stop()`. The `aborted` and the `onend` that follow are expected. */
  stopRequested: boolean;
  /** Its ending has already been delivered. Nothing more may come out of it. */
  finished: boolean;
  /** The track we opened and must stop. Null when the recogniser opened its own. */
  track: MediaStreamTrack | null;
  /**
   * When audio actually began — the first `audiostart`, not the press.
   *
   * The press is the wrong zero: there is a measured 1.1 seconds before the
   * microphone opens, and a timer counting it would claim a second of recording
   * that does not exist. Survives a Safari mid-session restart, because that is
   * still one dictation.
   */
  audioAt: number | null;
  /** How many confirmed phrases came out. Zero is what makes a recording worth offering. */
  confirmed: number;
  /** The recording of this press, if we own a track to record. */
  tape: MicTape | null;
}

/**
 * @param onText called with each **confirmed** phrase, to append where the
 * caret is. Never called with a guess.
 * @param onEnd called once per session that actually got going, on whatever
 * ended it — the reader pressing stop, a `network` error, a failed Safari
 * restart. It exists because dictated text was only ever committed by the stop
 * button: any other way of stopping left confirmed words sitting unsaved in a
 * box the reader believed had taken them. GPT Sol's plan review, item 12.
 *
 * **Once per *mounted* terminal session.** Unmounting mid-dictation aborts and
 * releases the microphone but does **not** call this: firing a save out of an
 * unmount cleanup is how you get a write racing a route change. A route that
 * needs to persist on navigation should commit on its own way out.
 * GPT Sol's code review, item 7.
 */
export function useDictation(onText: (text: string) => void, onEnd?: () => void): UseDictation {
  const [supported] = useState(() => ctor() !== null);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [ctx, setCtx] = useState<AudioContext | null>(null);
  const [hearing, setHearing] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(() => rememberedDevice());
  const [recording, setRecording] = useState<MicRecording | null>(null);
  const [deviceUnavailable, setDeviceUnavailable] = useState(false);
  /* Whether this component is still on the page. The tape's `stop()` is a
     promise, so it can resolve after an unmount; holding a reader's audio in a
     component nobody is looking at is the one outcome this feature must not
     have. */
  const mounted = useRef(true);

  const measured = useAudioLevel(track, ctx);
  const detectedLevel = useRef(0);
  /* One or the other, never a blend. `measured.measuring` only goes true once
     samples are genuinely flowing from a running context, so the fallback is
     what is showing during the opening gap as well as on Safari. */
  const meter: MeterKind = measured.measuring ? "measured" : phase === "idle" ? "none" : "detected";
  detectedLevel.current = hearing ? 1 : 0;

  const session = useRef<Session | null>(null);
  /**
   * The last session ever started, and **never cleared**.
   *
   * `session.current` answers "is one running?", which is not the same question
   * as "is this the most recent press?" — and the recording publisher needs the
   * second. Without it: press, stop with nothing said, press again, stop again,
   * and the first press's tape resolves last into a `session.current` that is
   * null again, publishing audio from two dictations ago under a strip that is
   * about neither. GPT Sol's code review, 2026-08-27, item 1.
   */
  const newest = useRef<Session | null>(null);
  const emit = useRef(onText);
  emit.current = onText;
  const ended = useRef(onEnd);
  ended.current = onEnd;

  /**
   * Deliver a session's ending, exactly once.
   *
   * The context is **not** suspended here, and that is a fix rather than an
   * omission: `suspend()` is asynchronous, so a stop immediately followed by a
   * start could have the suspend land *after* the new session checked the state
   * and found it `running`, leaving the meter dead for the rest of the page's
   * life with nothing to show for it. Stopping the track releases the hardware,
   * which is the part that matters; a context with nothing connected to it is
   * not doing anything worth reclaiming. GPT Sol's code review, item 3.
   */
  const finish = useCallback((s: Session, quiet = false) => {
    if (s.finished) return;
    s.finished = true;

    /* **The recording is kept only when nothing was transcribed**, and thrown
       away otherwise. One predicate, decided once, here — at the end, on the
       session's final count — rather than the two contradictory rules the plan
       first had (GPT Sol's plan review, 2026-08-27, item 2). So a dictation that
       produced words and *then* hit a `network` error keeps no audio: the
       reader already has what they said.

       Greg asked for it "if there's an error". His own failure raised no error
       — a silent microphone yields `no-speech`, which is deliberately
       suppressed because it fires on every ordinary pause, and Chrome then
       restarts happily. An error-only trigger would have been silent through
       the entire thing it was built for. "Nothing came back" is the condition
       that actually covers it, and it covers the real errors too.
       docs/plans/microphone-device-and-recording.md. */
    const tape = s.tape;
    const t = s.track;
    s.tape = null;
    s.track = null;

    /* **The recorder is drained before the track is released**, never the other
       way round: killing the track under a live recorder loses the final
       `dataavailable`, which is the tail of the file and the part somebody
       listening back is most likely to want. The wait is bounded inside the
       tape, so the microphone cannot be left open by a recorder that never
       finishes. GPT Sol's plan review, item 1. */
    if (!tape) {
      t?.stop();
    } else if (s.confirmed > 0) {
      // Nothing to keep, so nothing to wait for. `cancel` tells the recorder to
      // stop synchronously before the track goes.
      tape.cancel();
      t?.stop();
    } else {
      void tape.stop().then((r) => {
        t?.stop();
        /* Not after an unmount, and not over the top of a dictation the reader
           has since started: either would leave a reader's audio sitting in a
           component that is no longer about it. */
        if (r && mounted.current && session.current === null && newest.current === s) {
          setRecording(r);
        }
      });
    }
    if (session.current === s) {
      session.current = null;
      setPhase("idle");
      setInterim("");
      setHearing(false);
      setTrack(null);
      setStartedAt(null);
      setDeviceLabel(null);
    }
    if (!quiet) ended.current?.();
  }, []);

  const stop = useCallback(() => {
    const s = session.current;
    if (!s) return;
    /* **`stop()` first, `finish` from `onend`.** The old code settled — and so
       committed — and only then called `r.stop()`, which delivers one last
       result. That result arrived after the only save, so the final phrase of
       every dictation was one blur away from being lost.
       GPT Sol's code review, item 1. */
    s.stopRequested = true;
    // The button must react to the press now rather than when the recogniser
    // gets round to ending, so the visible state goes back immediately while
    // the session stays alive underneath to catch its last word.
    setPhase("idle");
    setHearing(false);
    try {
      s.r.stop();
    } catch {
      // It will never end on its own now, so this is the ending.
      finish(s);
      return;
    }
    /* A recogniser that never fires `onend` would leave this session alive for
       ever and its text uncommitted. Two seconds is far longer than a stop
       takes and far shorter than anybody would wait. */
    window.setTimeout(() => finish(s), 2000);
  }, [finish]);

  const start = useCallback(() => {
    const Ctor = ctor();
    if (!Ctor) return;

    const r = new Ctor();
    const s: Session = {
      r,
      stopRequested: false,
      finished: false,
      track: null,
      audioAt: null,
      confirmed: 0,
      tape: null,
    };

    r.continuous = true;
    r.interimResults = true;
    // The page's language, not a hardcoded locale: an app read in one language
    // and dictated in another is a reasonable thing to be, and guessing wrong
    // makes the transcript nonsense rather than merely worse.
    r.lang = document.documentElement.lang || navigator.language;

    r.onaudiostart = () => {
      if (session.current !== s || s.finished) return;
      setPhase("listening");
      /* The timer's zero, set once per dictation rather than once per
         `audiostart`: Safari restarts mid-session on a pause, and a clock that
         reset there would tell the reader they had been talking for two
         seconds after two minutes of it. */
      if (s.audioAt === null) {
        s.audioAt = Date.now();
        setStartedAt(s.audioAt);
        armTape(s);
      }
    };
    r.onsoundstart = () => {
      if (session.current === s && !s.finished) setHearing(true);
    };
    r.onsoundend = () => {
      if (session.current === s && !s.finished) setHearing(false);
    };

    r.onresult = (e) => {
      /* Guarded on **this session having finished**, not on it being the
         current one. A session we have asked to stop is still entitled to
         deliver the words the reader already said — that is the entire point of
         waiting for `onend` — and those words belong in the same box whether or
         not somebody has since pressed the button again. */
      if (s.finished) return;
      let confirmed = "";
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result) continue;
        if (result.isFinal) confirmed += result[0].transcript;
        else pending += result[0].transcript;
      }
      if (confirmed) {
        s.confirmed += 1;
        emit.current(confirmed);
      }
      if (session.current === s) setInterim(pending);
    };

    r.onerror = (e) => {
      if (s.finished) return;
      /* An error from a session that is no longer the current one must not be
         allowed to tear down the one that replaced it. It ends its own session
         quietly and says nothing: whatever it has to report is about a
         recogniser the reader has already moved on from.
         GPT Sol's code review, item 2. */
      if (session.current !== s) {
        finish(s, true);
        return;
      }
      const verdict = verdictFor(e.error, s.stopRequested);
      if (verdict.keepGoing) return;
      setError(verdict.message);
      finish(s);
    };

    r.onend = () => {
      if (s.finished) return;
      if (session.current !== s) {
        finish(s, true);
        return;
      }
      if (s.stopRequested) {
        // The ordinary stop, and the moment the last result has been and gone.
        finish(s);
        return;
      }
      /* Safari ends the session on a pause. Restart while the reader still
         wants it. Back to `opening`, because until the next `audiostart` the
         microphone genuinely is not listening. */
      try {
        setPhase("opening");
        setHearing(false);
        const t = s.track;
        if (t && t.readyState === "live") r.start(t);
        else r.start();
        return;
      } catch {
        /* The restart failed and there will be no further `onend` to try again
           from — so this is the end, and saying so is the difference between a
           stopped microphone and a button that claims to be listening to
           nothing. */
        setError("The microphone stopped unexpectedly. Press it again, or type instead.");
        finish(s);
      }
    };

    session.current = s;
    newest.current = s;
    setError(null);
    setPhase("opening");
    setDeviceUnavailable(false);
    /* A new press is the reader moving on. Whatever we kept from the last one
       goes now rather than lingering under a strip that is about this one. */
    setRecording(null);

    const preferred = rememberedDevice();
    void (async () => {
      const outcome = await beginCapture(r, () => session.current === s && !s.finished, preferred);
      if (session.current !== s || s.finished) return;
      if (outcome.kind === "started") {
        setDeviceUnavailable(preferred !== null && !outcome.honoured);
        if (outcome.track) {
          s.track = outcome.track;
          /* **The name of what we opened**, which is the piece that was
             missing. A meter reading zero and a meter pointed at a dead
             conferencing loopback are the same picture until something says
             which device produced it.
             docs/plans/microphone-device-and-recording.md. */
          setDeviceLabel(labelled(outcome.track));
          /* Both orders covered. `audiostart` is the recorder's zero, and it is
             measured at ~1.1s after this — but it is a task rather than a
             microtask, so it could in principle land before the assignment
             above. Whichever happens second arms the tape. */
          armTape(s);
          /* The context is created only now, and only when there is something
             to measure — Safari never gets one it cannot use. It is a shared
             singleton, so this is a get rather than a build most of the time. */
          setCtx(audio());
          setTrack(outcome.track);
          /* An externally ended track — the headset unplugged, the Continuity
             mic walking out of the room — otherwise leaves a meter measuring
             nothing and a button claiming to listen. GPT Sol's item 6. */
          outcome.track.addEventListener("ended", () => {
            if (session.current !== s || s.finished) return;
            setError("The microphone was disconnected. Press it again to start over.");
            finish(s);
          });
        }
        return;
      }
      setError("The microphone could not be started. Press it again, or type instead.");
      finish(s);
    })();
  }, [finish]);

  const toggle = useCallback(() => {
    if (session.current && !session.current.stopRequested) stop();
    else start();
  }, [start, stop]);

  /**
   * Pick a microphone.
   *
   * If a dictation is running it is **abandoned and restarted on the new
   * device**, rather than the choice taking effect on some later press. A
   * control that needs a second, undescribed action before anything changes is
   * the same genre of bug as the button that went orange a second early.
   *
   * The abandoned session is finished *before* `abort()` rather than after, so
   * that the `onend` the abort provokes finds `finished` already true and
   * cannot deliver a second ending. Quiet — no save — only when it had produced
   * nothing to save; words already spoken are still the reader's.
   */
  const chooseDevice = useCallback(
    (next: string | null) => {
      rememberDevice(next);
      setDeviceId(next);
      const s = session.current;
      if (!s || s.finished) return;
      s.stopRequested = true;
      /* The tape goes first and explicitly. `finish` would otherwise take its
         keep-the-audio branch and hold the old track live while it drained a
         recording that is about to be discarded anyway — two microphones open
         at once for as long as that took, which is the one invariant this
         feature is built around. There is nothing to keep here in any case: the
         reader is changing device, not reporting a failure. */
      s.tape?.cancel();
      s.tape = null;
      finish(s, s.confirmed === 0);
      try {
        s.r.abort();
      } catch {
        /* Already stopped. */
      }
      start();
    },
    [finish, start],
  );

  const clearRecording = useCallback(() => setRecording(null), []);

  /* Leaving the page with the microphone on. `abort` rather than `stop`,
     because `stop` delivers one last result and this component will not be
     there to receive it. The track goes with it, or the browser's recording
     indicator stays lit on a page nobody is looking at. `quiet`, because a
     save fired out of an unmount cleanup races the route change that caused
     it — see the note on `onEnd`. */
  useEffect(() => {
    /* Set on the way in as well as cleared on the way out. StrictMode mounts,
       unmounts and mounts again in development, and a flag only ever cleared
       would leave the second mount believing it was gone. */
    mounted.current = true;
    return () => {
      mounted.current = false;
      const s = session.current;
      if (!s) return;
      s.stopRequested = true;
      /* The tape goes with the page. A recording that outlived the component
         that was about it would be a reader's voice held by nothing anybody can
         see, which is worse than losing it. */
      s.tape?.cancel();
      s.tape = null;
      session.current = null;
      try {
        s.r.abort();
      } catch {
        /* Already gone. */
      }
      finish(s, true);
    };
  }, [finish]);

  return {
    supported,
    phase,
    armed: phase !== "idle",
    interim,
    level: measured.measuring ? measured.level : detectedLevel,
    meter,
    quiet: measured.quiet,
    toggle,
    error,
    startedAt,
    deviceLabel,
    deviceId,
    deviceUnavailable,
    chooseDevice,
    recording,
    clearRecording,
  };
}

/**
 * Start recording, **at `audiostart` and not before**.
 *
 * `getUserMedia` hands back a track that is already live, a measured 1.1
 * seconds before the recogniser reports the microphone open. A recorder started
 * when the track arrives therefore captures that second and a bit, and the
 * saved file is longer than the timer beside it claims — a small lie, but
 * exactly the kind this round exists to stop telling. So the timer's zero and
 * the recording's zero are the same event. GPT Sol's plan review, item 4.
 *
 * Needs both the track and `audioAt`, and is called from whichever arrives
 * second. Does nothing twice.
 */
function armTape(s: Session): void {
  if (s.tape || s.finished || !s.track || s.audioAt === null) return;
  s.tape = recordTrack(s.track);
}

type CaptureOutcome =
  /** Running. `track` is ours to own and stop, or null if the recogniser opened its own. */
  | {
      kind: "started";
      track: MediaStreamTrack | null;
      /**
       * We opened the microphone the reader asked for.
       *
       * False whenever a preference existed and the track did not come from
       * that exact device — including when we opened no track at all and the
       * recogniser went off to find its own, which is the case that otherwise
       * transcribes from some other microphone in total silence.
       */
      honoured: boolean;
    }
  /** It did not start, and the reader needs telling. */
  | { kind: "failed" };

/**
 * Something that is definitely not a `MediaStreamTrack`, for the probe below.
 * Frozen so it cannot be mistaken for state.
 */
const NOT_A_TRACK = Object.freeze({});

/**
 * Open the microphone where it can be shared, and start the recogniser on it.
 *
 * ## The probe, and why the obvious feature detect was unsound
 *
 * The meter wants the same audio the recogniser is transcribing, which the spec
 * allows via `recognition.start(audioTrack)` and recent Chromium implements.
 * Asking whether *this* browser implements it is the hard part, because
 * `start.length` is 0 and **a browser without the overload silently ignores an
 * extra argument** — so handing it a track looks exactly like sharing one while
 * it goes and opens a second capture of its own.
 *
 * The first version guessed from `"processLocally" in Ctor.prototype` and
 * relied on a `TypeError` to catch a wrong guess. GPT Sol's code review (item 4)
 * took that apart correctly: a wrong-positive browser does not throw, it
 * ignores — and Chromium shipped `processLocally` well before it shipped this
 * overload, so that population is real rather than theoretical. The failure it
 * produces is the exact one all this exists to avoid: two concurrent captures,
 * and a meter drawn from a different microphone than the words.
 *
 * So we ask the only question that cannot lie, and we ask it **first**:
 *
 * ```js
 * r.start(NOT_A_TRACK)
 * ```
 *
 * WebIDL converts arguments before the method body runs, so a browser with the
 * overload throws `TypeError` and **has not started anything** — proof of the
 * capability, paid for with nothing. A browser without it ignores the argument
 * and starts on its own capture, which is the start we wanted anyway; we simply
 * never open a stream, and the meter falls back to `soundstart`/`soundend`.
 *
 * Either way there is exactly one capture, on every browser, with no guessing
 * and no window in which there are two. Verified in Chrome 151 on 2026-08-27:
 * `TypeError: parameter 1 is not of type 'MediaStreamTrack'`.
 */
async function beginCapture(
  r: Recognition,
  stillWanted: () => boolean,
  preferred: string | null,
): Promise<CaptureOutcome> {
  let takesTrack = false;
  try {
    (r as unknown as { start(t: unknown): void }).start(NOT_A_TRACK);
    /* No throw: the argument was ignored and the recogniser is now running on
       its own capture. Nothing more to do, and nothing to share — and no way to
       have honoured a device choice, because this is the branch where the API
       never let us make one. */
    return { kind: "started", track: null, honoured: false };
  } catch (err) {
    if (err instanceof TypeError) takesTrack = true;
    else return { kind: "failed" };
  }
  if (!takesTrack || !navigator.mediaDevices?.getUserMedia) {
    try {
      r.start();
      return { kind: "started", track: null, honoured: false };
    } catch {
      return { kind: "failed" };
    }
  }

  let track: MediaStreamTrack | null = null;
  /* **Whether the reader got the microphone they asked for.** Set only where
     the `exact` request itself succeeded, so a fallback, a refusal and a
     recogniser-opened capture all report false rather than being told apart by
     inspecting a track we may not have. */
  let honoured = preferred === null;
  /**
   * Only a *missing device* earns a second attempt on the browser's default.
   *
   * The first version retried on any failure at all, which quietly turned a
   * refused permission into a start on some other microphone with nothing on
   * screen saying so — the same class of silent substitution this round exists
   * to end. GPT Sol's plan review, item 3. A `NotAllowedError` falls through
   * instead to the recogniser's own start, which produces a real error code and
   * the copy in [dictation-errors.ts](./dictation-errors.ts).
   */
  const deviceMissing = (err: unknown) => {
    /* Read off the object rather than through `instanceof Error`. What
       `getUserMedia` rejects with here is an `OverconstrainedError`, which is
       **not** reliably an `Error` subclass — it is its own interface carrying a
       `constraint` property, and the check that assumed otherwise silently
       never fell back at all. Caught by the test below rather than by anybody
       reading it. */
    const name = (err as { name?: unknown } | null)?.name;
    return name === "OverconstrainedError" || name === "NotFoundError";
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(audioConstraint(preferred));
    track = stream.getAudioTracks()[0] ?? null;
    if (track) honoured = true;
  } catch (err) {
    /* The remembered microphone is gone — unplugged, or its id rotated when
       site data was cleared. `exact` rejects rather than substituting, which is
       what we want, and this is the one place that then asks plainly instead.
       **The preference is not forgotten**: a headset unplugged for an afternoon
       should still be the choice when it comes back, and the cost of keeping it
       is one rejected call per press. The strip names whatever we did open, so
       a fallback is visible rather than silent. */
    if (preferred && deviceMissing(err)) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        track = stream.getAudioTracks()[0] ?? null;
      } catch {
        track = null;
      }
    } else {
      /* Refused, or no device at all. **A meter that cannot get samples must
         never be what stops dictation**, so this is silent here: the recogniser
         opens its own device below and produces a real error code with real
         copy if that fails too. GPT Sol's earlier plan review, item 11. */
      track = null;
    }
  }
  if (!stillWanted()) {
    // The reader stopped while we were opening. Do not leave the device on.
    track?.stop();
    return { kind: "failed" };
  }
  try {
    if (track) {
      r.start(track);
      return { kind: "started", track, honoured };
    }
    /* No track — refused, busy, or none at all. The recogniser opens its own,
       which is what keeps a meter that cannot get samples from being the thing
       that stops dictation. But it may well be a *different* microphone from
       the one that was chosen, and there is no way from here to find out which,
       so this says plainly that the choice was not honoured rather than
       leaving the reader with a strip that mentions no device at all.
       GPT Sol's code review, item 2. */
    r.start();
    return { kind: "started", track: null, honoured: false };
  } catch {
    /* Every exception here is a failure, `InvalidStateError` included. A
       recogniser constructed moments ago cannot legitimately be "already
       running", and treating that as nothing-to-do left the button saying
       "Opening the microphone…" for ever. GPT Sol's code review, item 5. */
    track?.stop();
    return { kind: "failed" };
  }
}
