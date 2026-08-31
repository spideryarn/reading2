/**
 * **Talk into a text box.** Twice: the browser's own recogniser while you talk,
 * and a model on the words you actually said.
 *
 * The whole design, the measurements behind the model choice and the
 * alternatives are in
 * [docs/plans/260827x-dictation-two-pass.md](../../docs/plans/260827x-dictation-two-pass.md).
 * What follows is what somebody changing this file has to know.
 *
 * ## Two passes, and only one of them is the truth
 *
 * The live text is **decoration**. It exists so that a reader can see the
 * microphone is on and something is being heard, and it is thrown away and
 * replaced the moment the real transcript lands. That inversion is the point of
 * the 2026-08-27 rewrite: measured on OpenRouter the same day, every dedicated
 * speech-to-text model mangled this app's own vocabulary — `Spideryarn` came
 * back as *Spiderion*, the block id `spya-k3m9qt` as *"Spire k three m nine
 * q t"* — while a chat model **told what the words might be** got both right on
 * every run. So the second pass is not a better ear, it is a vocabulary, and
 * the vocabulary is assembled on the server from the article the reader is
 * looking at. [`src/transcribe.ts`](../transcribe.ts).
 *
 * This reverses the argument the previous version of this header made at
 * length, and it is worth saying which part of it fell. *"It is free and there
 * is no server in it"* was true and is now paid for on purpose. **The audio of
 * the reader's voice now crosses our server** — held in memory for one request,
 * never written down, never logged — and the reader is told so beside the
 * button rather than in a policy page. Greg's call, 2026-08-27, with the trade
 * put to him in those words.
 *
 * ## One capture, and it is always ours
 *
 * That is the change that makes the rest possible, and it costs Safari
 * something.
 *
 * The level meter needs samples and the recording needs bytes, and
 * `SpeechRecognition` hands out neither. The obvious answer — a second
 * `getUserMedia` — is unsafe: **WebKit supports one microphone source at a
 * time**, and a second capture can kill the first or silently reroute it. The
 * way out is the spec's `recognition.start(audioTrack)`, which recent Chromium
 * implements and WebKit does not.
 *
 * So on Chromium there is one track feeding three readers — the recogniser, the
 * meter's `AnalyserNode`, and the recorder. Everywhere else **we take the track
 * and the recogniser gets nothing**, where the old code did the opposite. That
 * is the reversal: Safari loses the live words it used to have and gains a
 * recording, a measured meter, and a transcript that gets the words right.
 * Firefox, which had no dictation at all, gains all three.
 *
 * | | live words | good transcript | meter |
 * |---|---|---|---|
 * | Chrome / Edge 135+ | yes | yes | measured |
 * | Safari, iPad | no | yes | measured |
 * | Firefox | no | yes | measured |
 *
 * `supported` therefore now means **"can open a microphone"**, not "has Web
 * Speech". A control that is present and does nothing teaches a reader they
 * have failed at something, so it is still a feature detect and the button is
 * still absent where it cannot work — there is just one more browser where it
 * can.
 *
 * ## Four phases
 *
 * `idle | opening | listening | transcribing`.
 *
 * `opening` is armed-but-deaf, and it is measured rather than assumed:
 * `audiostart` lands **1.1 seconds** after `start()` in Chrome, and the button
 * that went orange on the line after `start()` was lying for a second exactly
 * when the reader was watching it. Safari's automatic restart drops back to
 * `opening`, because it genuinely is deaf again.
 *
 * `transcribing` is the new one, and it is the two seconds between the reader
 * pressing stop and the good words arriving. The text box is `readOnly` for the
 * length of it — see [`useDictationField`](./useDictationField.ts), where that
 * turns out to delete a whole class of problem rather than merely hide it.
 *
 * ## The things that go wrong
 *
 * 1. **Safari stops on a pause.** `continuous` is honoured loosely and the
 *    recogniser ends after a silence. `onend` restarts it while the button is
 *    still armed. Only reachable where the recogniser is running at all.
 * 2. **`no-speech` is not an error worth showing.** It fires on every ordinary
 *    gap. See [`dictation-errors.ts`](./dictation-errors.ts).
 * 3. **Interim results must not be committed.** The recogniser revises what it
 *    thought you said, so confirmed text and the interim tail are separate
 *    state and only the confirmed half is handed to `onText`.
 * 4. **The `AudioContext` is one long-lived singleton, never suspended between
 *    dictations.** One per page is Apple's own advice, and Safari has a hard
 *    limit that creating one per press walks into. Not suspending on stop is a
 *    fix rather than a leak: `suspend()` is asynchronous, so a stop immediately
 *    followed by a start could have the suspend land *after* the new session
 *    read the state and found it running, leaving the meter dead for the rest
 *    of the page's life. Stopping the track releases the hardware.
 * 5. **A transcription in flight outlives the session that made it.** It is
 *    keyed to the session, aborted on unmount and on a new press, and its
 *    result is dropped unless it is still the newest thing anybody asked for.
 */
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { type TranscriptionResult, sendForTranscription } from "./dictation-upload.js";
import { type MicClaim, claimMicrophone, releaseMicrophone } from "./mic-lock.js";
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

/**
 * Armed but not yet hearing, hearing, or turning what was heard into words.
 *
 * `transcribing` is not "armed": the microphone is off and the reader has
 * stopped talking. It is armed for the *button*, though, in the sense that the
 * dictation is not over — which is why `armed` below is a separate word and not
 * a synonym for `phase !== "idle"` any more.
 */
export type DictationPhase = "idle" | "opening" | "listening" | "transcribing";

/** Where the moving bars are getting their number from. */
export type MeterKind =
  /** A real RMS off the same track the recogniser is transcribing. */
  | "measured"
  /** The recogniser's own `soundstart`/`soundend` — real, but on or off. */
  | "detected"
  /** Nothing to show. The bars are not rendered. */
  | "none";

export interface UseDictation {
  /**
   * The browser can open a microphone. Render no button where it cannot.
   *
   * **This used to mean "has Web Speech" and no longer does.** The live text is
   * decoration and the transcript is the truth, so a browser without a
   * recogniser can still dictate perfectly well — Firefox now gets the button
   * for the first time. See the header.
   */
  supported: boolean;
  phase: DictationPhase;
  /**
   * The microphone is on and a press of the button stops it.
   *
   * **Not `phase !== "idle"`.** During `transcribing` the microphone is off,
   * the reader has already pressed stop, and a second press must not be read as
   * "stop" again — there is nothing left to stop.
   */
  armed: boolean;
  /**
   * The words are being turned into text and the box should be closed for
   * editing. Roughly two seconds. See `useDictationField`.
   */
  transcribing: boolean;
  /**
   * This browser gives live words while you talk. False on Safari and Firefox,
   * where the strip has to say something else — a reader watching an empty box
   * needs telling that the words come at the end, not that nothing is working.
   */
  liveText: boolean;
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
  /**
   * The recogniser, or **null on a browser that has none** — Firefox.
   *
   * Optional since 2026-08-27, and the reason is a bug rather than tidiness.
   * `supported` was widened to mean *"can open a microphone"* because the live
   * text is decoration and the transcript is the truth, so Firefox got a
   * button — and `start()` still began `if (!Ctor) return`, so that button did
   * nothing at all, on the one browser the change was advertised as adding.
   * A control that is present and dead teaches a reader they have failed at
   * something. GPT Sol's code review, 2026-08-27, item 6.
   */
  r: Recognition | null;
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
  /** True where the recogniser is running on our track and words will arrive. */
  live: boolean;
  /**
   * Where this dictation was going, **read when it started rather than when it
   * finishes.**
   *
   * A ref read at upload time answers "what is the current context", which is
   * not the same question: a reader who dictates into one article's chat box
   * and navigates while the upload is in flight would have their words
   * transcribed against a different article's glossary. GPT Sol's code review,
   * item 1.
   */
  where: DictationContext;
  /**
   * This session's claim on the page's one microphone, and the resolver that
   * tells the next claimant the device is free. See [mic-lock.ts](./mic-lock.ts).
   */
  claim: MicClaim;
  freed: () => void;
  /**
   * Aborts the transcription request this session started.
   *
   * On the session rather than in a ref because a second press must be able to
   * kill the first press's request specifically, and a ref would only ever hold
   * the newest.
   */
  upload: AbortController | null;
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
export interface DictationOptions {
  /**
   * Each **confirmed** live phrase, to append where the caret is. Never called
   * with a guess, and never called at all on a browser without the track
   * overload — see `liveText`.
   */
  onText(text: string): void;
  /**
   * The real transcript, once. **This replaces everything `onText` produced**,
   * and a caller that appends it instead of replacing it will double every
   * dictation on Chromium and be right by accident everywhere else.
   *
   * Not called when the transcription failed or when the reader said nothing.
   */
  onTranscript?(text: string): void;
  /**
   * Called once per session that actually got going, on whatever ended it — the
   * reader pressing stop, a `network` error, a failed Safari restart.
   *
   * **After the transcript, not before it.** It exists so that dictated text is
   * saved by every way of stopping rather than only by the stop button, and
   * firing it while the good words were still in flight would save the
   * decoration and then change the box underneath it.
   */
  onEnd?(): void;
  /**
   * Where the reader is dictating, which is how the server decides what
   * vocabulary to prime the model with. `{ kind: "article", slug }` is the one
   * that scores best, because the article's glossary is the vocabulary.
   */
  context: DictationContext;
}

/** Mirrors `Where` in [src/transcribe.ts](../transcribe.ts). */
export type DictationContext = { kind: "profile" } | { kind: "article"; slug: string };

export function useDictation(options: DictationOptions): UseDictation {
  const { onText, onTranscript, onEnd, context } = options;
  /* **"Can open a microphone", not "has Web Speech".** The live half is
     optional now; the recording is not. See the header. */
  const [supported] = useState(() => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
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
  /* Whether *this* dictation will produce live words. Not a constant: it is a
     property of the capture that actually opened, and a `start()` that refused
     turns a live browser into a silent one for one press. */
  const [liveText, setLiveText] = useState(false);
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
  const transcribed = useRef(onTranscript);
  transcribed.current = onTranscript;
  /* A ref rather than a dependency: `context` is an object literal at every
     call site, so depending on it would rebuild `start` on every render and
     take the whole session machinery with it. */
  const whereRef = useRef(context);
  whereRef.current = context;

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
  /**
   * Deliver a session's ending, exactly once — and, on the way, turn the
   * recording into the words that actually get saved.
   *
   * This is where the two passes meet, so the order matters and is:
   *
   * 1. stop the recorder and **wait for it**, then release the track;
   * 2. send the audio and wait for the transcript;
   * 3. hand the transcript over;
   * 4. only then call `onEnd`, which is what saves.
   *
   * Step 4 last is the whole point. `onEnd` is the caller's cue to persist what
   * is in the box, and firing it before the transcript arrived would save the
   * decoration and then silently change the box underneath it — which reads to
   * a reader as their text being edited after they saved it.
   *
   * Step 1's order is older and just as load-bearing: killing the track under a
   * live recorder loses the final `dataavailable`, which is the tail of the
   * file. The wait is bounded inside the tape, so a recorder that never
   * finishes cannot strand the microphone open.
   *
   * The `AudioContext` is **not** suspended here, and that is a fix rather than
   * an omission: `suspend()` is asynchronous, so a stop immediately followed by
   * a start could have the suspend land *after* the new session checked the
   * state and found it `running`, leaving the meter dead for the rest of the
   * page's life. Stopping the track releases the hardware, which is the part
   * that matters.
   *
   * @param quiet the session was **abandoned** — an unmount, or the reader
   * changing microphone mid-dictation. No transcript, no save, no audio kept.
   */
  const finish = useCallback((s: Session, quiet = false) => {
    if (s.finished) return;
    s.finished = true;

    const tape = s.tape;
    const t = s.track;
    s.tape = null;
    s.track = null;

    /* Whether this session is the one the visible state is about. Read once,
       here, because everything below is asynchronous and `session.current` will
       have moved on by the time some of it runs. */
    const current = session.current === s;
    if (current) {
      session.current = null;
      setInterim("");
      setHearing(false);
      setTrack(null);
      setStartedAt(null);
      setDeviceLabel(null);
    }

    /* **The device is free the moment its track is stopped**, and every path
       below has to say so exactly once. A claim never released locks the
       microphone for the rest of the page's life; one released early lets the
       next claimant open a second capture while this one is still open.

       This was written into the plan and then, for one round, not into the
       code — with the result that a device change asked the *previous* holder
       to stop and, because that holder was still registered, stopped the
       session that was replacing it. `tests/dictation-recording.test.ts` caught
       it; nothing on screen would have. */
    const free = () => {
      releaseMicrophone(s.claim);
      s.freed();
    };

    if (quiet) {
      s.upload?.abort();
      tape?.cancel();
      t?.stop();
      free();
      if (current) setPhase("idle");
      return;
    }

    if (!tape) {
      /* **Nothing was ever recorded**, so there is no authoritative pass and the
         reader has only whatever the browser's recogniser managed — which on
         Safari and Firefox is nothing at all.
         
         Three ways here: the microphone never opened; the reader stopped inside
         the second before `audiostart`; or every `MediaRecorder` container this
         browser claims to support failed to start. The third used to be
         completely silent, which is the worst of the three because it is the
         only one where everything looked like it was working.
         GPT Sol's code review, item 6. */
      t?.stop();
      free();
      if (current) {
        setPhase("idle");
        if (s.audioAt !== null && s.confirmed === 0) {
          setError("That wasn't recorded, so there was nothing to transcribe. Try again, or type it. [mic-no-tape]");
        }
      }
      /* The same rule as `done`: a session the reader has moved on from, or a
         component that has gone, does not get to commit. */
      if (mounted.current && newest.current === s) ended.current?.();
      return;
    }

    if (current) setPhase("transcribing");

    /* **Whether this session still owns the screen.** `newest` rather than
       `session.current`, which is null by now for every finished session:
       without it, a second press's transcript could land while the first
       press's was still in flight and the loser would overwrite the winner. */
    const stillOurs = () => mounted.current && newest.current === s;
    const done = () => {
      if (!stillOurs()) {
        /* **A session the reader has moved on from does not get to commit.**
           `ended` is the caller's cue to persist what is in the box — and for a
           stale session that box now belongs to a *newer* dictation, so firing
           here would clear the new session's span and save somebody else's
           half-finished text. It used to fire on any mounted component, which
           is the wrong question. GPT Sol's code review, item 1. */
        return;
      }
      setPhase("idle");
      ended.current?.();
    };

    /**
     * What the transcript turned out to be, and what that leaves the reader
     * with. Split out of the `then` below so that each half is one decision
     * rather than a ladder of six.
     *
     * The predicate running through all of it is **"did anything come back"**,
     * not "was there an error". Greg's own failure raised no error at all — a
     * silent microphone yields `no-speech`, which is suppressed because it
     * fires on every ordinary pause — so an error-only rule would have been
     * silent through the entire thing this exists for.
     */
    const landed = (recorded: MicRecording, result: TranscriptionResult) => {
      if (result.ok && result.text) {
        transcribed.current?.(result.text);
        return;
      }
      if (result.ok) {
        /* A success with nothing in it: the model heard no speech. If the
           recogniser heard none either, the reader is entitled to hear what we
           heard. */
        if (s.confirmed === 0) {
          setError("We didn't catch any words in that. The audio is below if you want it. [mic-silent]");
          setRecording(recorded);
        }
        return;
      }
      if ("abandoned" in result) {
        /* Aborted by an unmount or a second press. The caller has already sent
           every abandoned case away; reaching here means the abort came from
           somewhere else, and there is nothing to say about it. */
        return;
      }
      /* **It failed, and what that costs depends on the browser.** On Chromium
         the live words are in the box and the reader merely has the worse
         version; elsewhere the box is empty and the whole dictation is gone. So
         the audio comes back exactly when nothing else did. */
      setError(result.message);
      if (s.confirmed === 0) setRecording(recorded);
    };

    void tape.stop().then(async (recorded) => {
      /* The recorder is drained *before* the track is released — killing the
         track under a live recorder loses the final `dataavailable`, which is
         the tail of the file. Only then is the device somebody else's to take;
         the transcription that follows needs no microphone. */
      t?.stop();
      free();
      if (!recorded) {
        /* The recorder produced nothing worth offering — too short, errored,
           zero bytes. On Chromium the live words are still in the box and are
           all the reader gets; elsewhere the box is empty and they need
           telling, because an empty box after a minute of talking is the one
           outcome that must never be silent. */
        if (stillOurs() && s.confirmed === 0) {
          setError("We didn't catch that. Press the microphone and try again. [mic-empty]");
        }
        done();
        return;
      }
      if (!stillOurs()) {
        /* Unmounted, or a newer press owns the box. The audio goes with it
           rather than being held by a component nobody is looking at. */
        done();
        return;
      }

      s.upload = new AbortController();
      const result = await sendForTranscription(
        recorded.blob,
        recorded.mimeType,
        s.where,
        s.upload.signal,
      );
      if (!stillOurs()) return;
      landed(recorded, result);
      done();
    }).catch(() => {
      /* **Nothing above is allowed to reject, and this is here because "not
         allowed to" is not a guarantee.** If it did, `free()` would never run
         and the page's microphone would stay claimed for ever — every later
         press waiting on a `released` that nobody will resolve, with no error
         anywhere. So the device goes back and the box is handed back, whatever
         happened. */
      t?.stop();
      free();
      if (stillOurs()) setError("Something went wrong while transcribing that. [mic-unexpected]");
      done();
    });
  }, []);

  const stop = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.stopRequested = true;
    /* The button must react to the press *now* rather than when the recogniser
       gets round to ending. `transcribing` and not `idle`: the microphone is
       off, which is what the reader asked for, but the dictation is not over
       and a box that went back to normal here would invite the edit that
       `readOnly` exists to prevent. */
    setPhase("transcribing");
    setHearing(false);

    if (!s.live) {
      /* No recogniser was ever started — Safari, Firefox, or a `start()` that
         refused. There is no `onend` coming, so this is the ending, and it goes
         straight to draining the tape. */
      finish(s);
      return;
    }

    /* **`stop()` first, `finish` from `onend`.** The old code settled — and so
       committed — and only then called `r.stop()`, which delivers one last
       result. That result arrived after the only save, so the final phrase of
       every dictation was one blur away from being lost.
       GPT Sol's code review, item 1. */
    try {
      s.r?.stop();
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

  /* `stop` by reference, because the microphone claim is built inside `start`
     and has to be able to ask this session to stop — while `stop` itself is
     declared above `start` and captured by value. A ref rather than reordering
     the two, since `stop` legitimately closes over `finish`. */
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const start = useCallback(() => {
    /* Null on Firefox. Everything below is written so that the dictation runs
       without one: the track is ours, the recorder is ours, and the transcript
       is what the reader gets. What is missing is the live words, and the strip
       says so in as many words. */
    const Ctor = ctor();
    const r = Ctor ? new Ctor() : null;
    const s: Session = {
      r,
      stopRequested: false,
      finished: false,
      track: null,
      audioAt: null,
      confirmed: 0,
      tape: null,
      live: false,
      where: whereRef.current,
      upload: null,
      /* Filled in on the next two lines — a `Session` is built in one literal so
         that no field can be forgotten, and these two have to refer to it. */
      claim: null as unknown as MicClaim,
      freed: () => {},
    };
    /**
     * The tape ran out, so the dictation is over.
     *
     * **This did not used to end anything** — the recording stopped, dictation
     * carried on, and the file said it was only the beginning. Harmless while
     * the recording was a souvenir; wrong now that it is the source of the
     * transcript, because the words after the cap would be transcribed from
     * audio that does not contain them and the result would replace the whole
     * of what was said. GPT Sol's plan review, item 2.
     */
    const capped = () => {
      if (session.current !== s || s.finished) return;
      setError("That was as much as we can transcribe at once. The rest wasn't recorded. [mic-full]");
      stopRef.current();
    };

    s.claim = {
      /* **Only if this session is still the running one.** The claim reaches
         `stop` through a ref, and `stop` acts on whatever session is current —
         so a stale claim asking to be stopped would stop whichever dictation
         happened to be running instead, which is the opposite of what a lock is
         for. Found by the device-change test. */
      stop: () => {
        if (session.current === s && !s.finished) stopRef.current();
      },
      released: new Promise<void>((resolve) => {
        s.freed = resolve;
      }),
    };

    /* **All of this is the *live* half, and Firefox has none of it.** Wrapped
       rather than sprinkled with `?.` so that the shape is obvious: everything
       inside needs a recogniser, and everything outside — the track, the
       recorder, the meter, the upload — does not. On a browser without one the
       block is skipped and the dictation is exactly as good, minus the words
       that appear while you talk. */
    if (r) {
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
          armTape(s, capped);
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
        /* The recogniser ends the session on a pause. Restart while the reader
           still wants it. Back to `opening`, because until the next
           `audiostart` the microphone genuinely is not listening. */
        const t = s.track;
        if (t?.readyState !== "live") {
          /* **No bare `r.start()` here, and that is the point.** It used to
             fall through to one when our track had gone — which asks the
             recogniser to open a capture of its own, on a page whose entire
             design is that every capture is ours. The track ending *is* the end
             of the dictation; the `ended` listener says so, and this says the
             same thing for the case where `onend` gets here first.
             GPT Sol's code review, 2026-08-27, item 4. */
          setError("The microphone stopped unexpectedly. Press it again, or type instead. [mic-stopped]");
          finish(s);
          return;
        }
        try {
          setPhase("opening");
          setHearing(false);
          r.start(t);
          return;
        } catch {
          /* The restart failed and there will be no further `onend` to try again
             from — so this is the end, and saying so is the difference between a
             stopped microphone and a button that claims to be listening to
             nothing. */
          setError("The microphone stopped unexpectedly. Press it again, or type instead. [mic-stopped]");
          finish(s);
        }
      };

      /* **A new press kills the last press's transcription.** Without this the
         old request runs to completion, is dropped by `stillOurs`, and is paid
         for — and on a slow connection two overlapping uploads of a megabyte each
         is a real cost for an answer nobody will ever see. */
      newest.current?.upload?.abort();
    }

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
      /* **Before `getUserMedia`, and that is the whole point** — the gap this
         closes is between one instance opening a device and another instance
         still holding one, and a claim taken afterwards is a claim on something
         that has already gone wrong. If another box on this page was dictating,
         it is asked to stop the ordinary way (keeping its words) and this waits
         for its track actually to go. GPT Sol's plan review, item 1. */
      await claimMicrophone(s.claim);
      if (session.current !== s || s.finished) {
        releaseMicrophone(s.claim);
        s.freed();
        return;
      }
      const outcome = await beginCapture(
        Ctor,
        r,
        () => session.current === s && !s.finished,
        preferred,
      );
      if (session.current !== s || s.finished) {
        /* The reader stopped, or moved on, while the microphone was opening.
           `beginCapture` has already released anything it opened. */
        return;
      }
      if (outcome.kind !== "started") {
        setError("The microphone could not be started. Press it again, or type instead. [mic-no-start]");
        finish(s);
        return;
      }

      s.live = outcome.live;
      setLiveText(outcome.live);
      setDeviceUnavailable(preferred !== null && !outcome.honoured);
      s.track = outcome.track;
      /* **The name of what we opened**, which is the piece that was missing. A
         meter reading zero and a meter pointed at a dead conferencing loopback
         are the same picture until something says which device produced it.
         docs/plans/260827k-microphone-device-and-recording.md. */
      setDeviceLabel(labelled(outcome.track));
      /* The context is created only now, and only when there is something to
         measure. It is a shared singleton, so this is a get rather than a build
         most of the time. */
      setCtx(audio());
      setTrack(outcome.track);
      /* An externally ended track — the headset unplugged, the Continuity mic
         walking out of the room — otherwise leaves a meter measuring nothing
         and a button claiming to listen. */
      outcome.track.addEventListener("ended", () => {
        if (session.current !== s || s.finished) return;
        setError("The microphone was disconnected. Press it again to start over. [mic-unplugged]");
        finish(s);
      });

      if (!outcome.live) {
        /* **No recogniser, so no `audiostart` is ever coming** — and the timer,
           the recorder and the word "listening" all hang off that event. On
           this path the track being live *is* the microphone being open, so
           this is the same moment by a different name. Miss it and the strip
           says "Opening the microphone…" for the whole dictation and the
           recording never starts. */
        s.audioAt = Date.now();
        setStartedAt(s.audioAt);
        setPhase("listening");
        armTape(s, capped);
        return;
      }
      /* Both orders covered. `audiostart` is the recorder's zero, and it is
         measured at ~1.1s after the track arrives — but it is a task rather
         than a microtask, so it could in principle land before the assignment
         above. Whichever happens second arms the tape. */
      armTape(s, capped);
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
        s.r?.abort();
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
      /* **Before the `session.current` check, because an upload outlives its
         session.** `finish` clears `session.current` and *then* starts the
         request, so by the time a reader navigates away mid-transcription there
         is nothing for the guard below to find — and the request ran to
         completion, and was paid for, for an answer nobody would ever see.
         `newest` is the one that still points at it. GPT Sol's code review,
         item 8. */
      newest.current?.upload?.abort();
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
        s.r?.abort();
      } catch {
        /* Already gone. */
      }
      finish(s, true);
    };
  }, [finish]);

  return {
    supported,
    phase,
    /* Armed means *the microphone is on*. `transcribing` is deliberately not
       armed: the reader has already pressed stop and there is nothing left for
       a second press to stop. */
    armed: phase === "opening" || phase === "listening",
    transcribing: phase === "transcribing",
    liveText,
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
function armTape(s: Session, capped: () => void): void {
  if (s.tape || s.finished || !s.track || s.audioAt === null) return;
  s.tape = recordTrack(s.track, capped);
}

type CaptureOutcome =
  /** Running. `track` is ours to own and stop; `live` says whether words will arrive. */
  | {
      kind: "started";
      track: MediaStreamTrack;
      /**
       * The recogniser is running on our track and will produce live text.
       *
       * False on Safari and Firefox, where there will be no words until the
       * transcript comes back. Not a failure — the meter, the timer and the
       * recording all work, and the transcript is the authoritative half
       * anyway.
       */
      live: boolean;
      /**
       * We opened the microphone the reader asked for.
       *
       * False whenever a preference existed and the track did not come from
       * that exact device.
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
 * Whether a given `SpeechRecognition` implementation's `start` takes a track.
 *
 * Cached because the probe costs something on the browsers that fail it — see
 * `probeTrackOverload` — and the answer cannot change for a given constructor.
 *
 * **Keyed on the constructor rather than held in a plain `let`**, which is not
 * only tidiness: a bare flag is a module-level global that one implementation's
 * answer leaks out of, and the one place two implementations exist in a single
 * process is the test fixture that drives Chrome's shape and Safari's in the
 * same file. A cache nothing can reset makes the second of those tests pass or
 * fail depending on which ran first — which is a test suite lying about the
 * code rather than the code being wrong.
 */
const overloads = new WeakMap<RecognitionCtor, boolean>();

/**
 * Ask whether `recognition.start(audioTrack)` exists, **without ever opening a
 * second microphone.**
 *
 * This is the sharpest edge in the file, so the whole argument is here.
 *
 * The meter and the recorder want the same audio the recogniser is
 * transcribing, which the spec allows via `recognition.start(audioTrack)` and
 * Chromium 135+ implements. Asking whether *this* browser implements it is hard
 * because `start.length` is 0 and **a browser without the overload silently
 * ignores an extra argument** — so handing it a track looks exactly like
 * sharing one while it goes off and opens a capture of its own.
 *
 * So we ask the only question that cannot lie:
 *
 * ```js
 * r.start(NOT_A_TRACK)
 * ```
 *
 * WebIDL converts arguments before the method body runs, so a browser with the
 * overload throws `TypeError` and **has not started anything** — proof of the
 * capability, paid for with nothing. Verified in Chrome 151 on 2026-08-27:
 * `TypeError: parameter 1 is not of type 'MediaStreamTrack'`.
 *
 * **A browser without it ignores the argument and starts.** Under the old
 * design that was free, because starting was what we wanted next anyway. Under
 * this one it is precisely what must not happen: we are about to open our own
 * capture, and a recogniser holding one of its own is the two-microphone state
 * the whole design exists to avoid.
 *
 * The answer is that `abort()` is called **in the same synchronous turn as
 * `start()`**, before control returns to the event loop. `start()` queues a
 * task to request the audio; the abort runs before that task can, so on the
 * browsers that fail this probe the microphone is never opened at all. It is
 * also asked exactly once per page and the answer cached, so even if a browser
 * were to grab the device synchronously, it would be one moment on the first
 * press and never concurrent with ours — the track below is not requested until
 * after this returns.
 *
 * @param r a recogniser that must not be used afterwards if this returns false.
 */
async function probeTrackOverload(Ctor: RecognitionCtor, r: Recognition): Promise<boolean> {
  const known = overloads.get(Ctor);
  if (known !== undefined) return known;
  let takes = false;
  try {
    (r as unknown as { start(t: unknown): void }).start(NOT_A_TRACK);
  } catch (err) {
    takes = err instanceof TypeError;
  }
  overloads.set(Ctor, takes);
  if (takes) return true;

  /* **The abort is synchronous and the wait is not, and both are needed.**
   *
   * An earlier version aborted in the same turn as the `start()` and went
   * straight on to `getUserMedia`, reasoning that `start()` merely *queues* a
   * task to ask for audio so an abort beating that task means nothing was ever
   * opened. GPT Sol's code review (item 4) checked that against the spec and it
   * is not a guarantee: `abort()` promises disconnection and a later `end`, not
   * synchronous release of the device.
   *
   * So we wait for the terminal event, which is the only thing that actually
   * says *the recogniser has let go*. Bounded, because a browser that never
   * fires it must not be able to stop dictation for ever — and paid once per
   * page, since the answer is cached above.
   */
  try {
    r.abort();
  } catch {
    /* Never started, or already stopped. Nothing to wait for either way. */
    return false;
  }
  await new Promise<void>((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      r.onend = null;
      resolve();
    };
    const timer = window.setTimeout(done, PROBE_RELEASE_MS);
    r.onend = done;
  });
  return false;
}

/**
 * How long to wait for an aborted probe recogniser to say it has let go.
 *
 * Long enough for an `end` that is coming, short enough that a browser which
 * never sends one costs the reader a fifth of a second on their first press and
 * nothing afterwards.
 */
const PROBE_RELEASE_MS = 200;

/**
 * Open the microphone, and start the recogniser on it where that is possible.
 *
 * **The order is the design.** The probe first, because it must not run while
 * we hold a track; then `getUserMedia`, which is now unconditional — the
 * recogniser is never allowed to open its own capture, on any browser, so a
 * failure to open ours is a failure to dictate rather than a fallback onto
 * something we cannot record.
 */
async function beginCapture(
  Ctor: RecognitionCtor | null,
  r: Recognition | null,
  stillWanted: () => boolean,
  preferred: string | null,
): Promise<CaptureOutcome> {
  /* **No recogniser at all is a perfectly good dictation** — Firefox — so this
     is a `false` rather than a refusal. The track still opens, the recorder
     still runs, and the transcript is still what the reader gets. */
  const live = Ctor && r ? await probeTrackOverload(Ctor, r) : false;
  if (!navigator.mediaDevices?.getUserMedia) return { kind: "failed" };

  let track: MediaStreamTrack | null = null;
  /* **Whether the reader got the microphone they asked for.** Set only where
     the `exact` request itself succeeded, so a fallback and a refusal both
     report false rather than being told apart by inspecting a track we may not
     have. */
  let honoured = preferred === null;
  /**
   * Only a *missing device* earns a second attempt on the browser's default.
   *
   * Retrying on any failure at all would quietly turn a refused permission into
   * a start on some other microphone with nothing on screen saying so — the
   * silent substitution this whole area exists to end.
   */
  const deviceMissing = (err: unknown) => {
    /* Read off the object rather than through `instanceof Error`. What
       `getUserMedia` rejects with here is an `OverconstrainedError`, which is
       **not** reliably an `Error` subclass — it is its own interface carrying a
       `constraint` property, and the check that assumed otherwise silently
       never fell back at all. */
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
       should still be the choice when it comes back. */
    if (preferred && deviceMissing(err)) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        track = stream.getAudioTracks()[0] ?? null;
      } catch {
        track = null;
      }
    } else {
      track = null;
    }
  }

  if (!track) return { kind: "failed" };
  if (!stillWanted()) {
    // The reader stopped while we were opening. Do not leave the device on.
    track.stop();
    return { kind: "failed" };
  }

  if (!live || !r) {
    /* No overload or no recogniser at all, so no live text. The recogniser is simply never started —
       which is the whole of what "one capture" means on Safari, and the
       opposite of what this code did before 2026-08-27. */
    return { kind: "started", track, live: false, honoured };
  }
  try {
    r.start(track);
    return { kind: "started", track, live: true, honoured };
  } catch {
    /* **The recogniser refused, and that is no longer fatal.** It used to be:
       there was nothing else to dictate with. Now the track is open, the
       recording is running and the transcript will arrive, so the honest
       outcome is a dictation with no live words rather than no dictation.
       Every exception here is covered, `InvalidStateError` included. */
    return { kind: "started", track, live: false, honoured };
  }
}
