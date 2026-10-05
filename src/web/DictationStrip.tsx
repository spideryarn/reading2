/**
 * **Everything a dictating text box shows.** The button, and the line under it.
 *
 * Lifted out of `ProfileBox.tsx` on 2026-08-27, where all of it had lived since
 * dictation was one box's feature. Greg asked for the microphone in lots of
 * places, and a microphone written twice is a microphone that behaves two ways
 * — which is the same reason `ProfileBox` was shared between `/profile` and the
 * metadata page in the first place.
 *
 * Three pieces, and this is the middle one:
 *
 * | | what it is |
 * |---|---|
 * | [`useDictation`](./useDictation.ts) | the microphone, the recorder, the transcript |
 * | [`useDictationField`](./useDictationField.ts) | the caret, the span, the closed box |
 * | this | the pixels |
 *
 * ## The things in here that took a while to get right
 *
 * **The button is an action, not a toggle.** Its accessible name says what the
 * press will *do* — "Dictate" / "Stop dictating" — and there is no
 * `aria-pressed`. The APG allows either a moving name or a fixed name with the
 * state in `aria-pressed`, and what it does not allow is both at once, which is
 * what was here before. The glyph agrees: a filled square means stop.
 * docs/research/260827b-microphone-library-options.md.
 *
 * **`MicOff` is the icon for *muted*.** For one round the button wore it during
 * the single moment the microphone was live, which is the glyph for dead on the
 * one state that is alive.
 *
 * **The live region is mounted for the life of the box**, empty when there is
 * nothing to say. A `role="status"` that appears *already containing* its
 * message is not announced by several screen readers — the announcement is of a
 * change, and there was no change, there was a new element. Every visible copy
 * of those words is therefore `aria-hidden`, so nothing is read twice.
 *
 * **`aria-hidden` goes on the repeated parts, never on the strip itself.** It
 * was on the whole `<p>` for a draft, which also hid the timer inside it — and
 * the timer's `role="timer"` exists exactly so that it *is* exposed while not
 * being announced.
 *
 * **The device's name appears for as long as it is open.** Nothing on this page
 * used to say which microphone had produced a zero, and moving bars still do
 * not say whether the browser opened the device the reader meant.
 */
import { Download, Loader2, Mic, RotateCcw, Square, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { MicLevel } from "./MicLevel.js";
import { type MicDevice, listInputs } from "./mic-devices.js";
import { type MicRecording, formatDuration, recordingFilename } from "./mic-recording.js";
import type { DictationRecording, UseDictation } from "./useDictation.js";
import { useNow } from "./useNow.js";
import { useOnline } from "./useOnline.js";

/** The chosen microphone could not be used. Each name only if the browser gave it. */
export function deviceUnavailableWords(wanted: string | null, using: string | null): string {
  const chosen = wanted ? `the microphone you chose (${wanted})` : "the microphone you chose";
  const instead = using ? `, so this is using ${using}.` : ". Using another one.";
  return `Couldn't use ${chosen}${instead}`;
}

/**
 * **What a double press on Stop will do in this box**, for the three places
 * that say so. Most boxes send. The command bar does not — "send" in this app
 * means posting into a conversation — and its done action is whatever Enter
 * does with the phrase: run the row it names, or ask what it meant. So it says
 * Enter, which is true of both (Greg's yes to the bar, 2026-10-05, plan 261005a).
 */
export type DoneAction = "send" | "enter";
const DONE_WORDS: Record<DoneAction, { again: string; button: string; strip: string }> = {
  send: {
    again: "Send when the words arrive",
    button: "Turning your words into text, then sending",
    strip: "Turning that into text, then sending…",
  },
  enter: {
    again: "Press Enter when the words arrive",
    button: "Turning your words into text, then pressing Enter",
    strip: "Turning that into text, then pressing Enter…",
  },
};

/**
 * What the strip says, in one place — because it is also what the live region
 * says, and the two must not be allowed to drift apart.
 */
function dictationWords(d: UseDictation, sendingAfter: boolean, done: DoneAction): string {
  if (d.transcribing) {
    return sendingAfter ? DONE_WORDS[done].strip : "Turning that into text…";
  }
  if (d.phase === "opening") return "Opening the microphone…";
  if (d.quiet) {
    /* **Not a diagnosis.** `quiet` means nothing crossed −55 dBFS for ten
       seconds, which a thinking reader in a quiet room produces too — so the
       sentence reports the observation and the device is named as a separate
       fact beside it, rather than becoming "no sound *from* X", which reads as
       a verdict on X. */
    return "No sound detected yet";
  }
  if (d.meter === "detected") {
    // On the binary path the bars say *whether* there is sound rather than how
    // much, so the words say so too rather than letting the picture imply a
    // measurement nobody took.
    return "Listening for sound";
  }
  /* **The one sentence that is about this browser rather than this moment.** On
     Safari and Firefox there is no recogniser, so nothing appears in the box
     until the reader stops — and a reader watching an empty box needs telling
     that, or they conclude it is broken and press the button again. */
  return d.liveText ? "Listening" : "Listening — the words appear when you stop";
}

/**
 * **What the reader is told before they press it**, and it is one sentence in
 * one place.
 *
 * The audio leaves the machine now — that is the trade this feature made, and
 * Greg made it knowingly — so a reader is owed the fact before the button, not
 * in a policy page. It lives here rather than in `ProfileBox` because it
 * belongs to *the button*: for one round it was written into the profile box
 * alone, and chat and the comment dialog then grew microphones with no notice
 * at all while a project doc claimed one sat beside every one of them.
 * GPT Sol's code review, 2026-08-27, item 10.
 */
/**
 * **It used to end "and isn't stored", and that stopped being true on
 * 2026-09-07.**
 *
 * Dictation moved to `openai/gpt-transcribe`, which cannot be routed with zero
 * data retention — OpenRouter does not apply the flag on its transcription
 * endpoint, rather than refusing it
 * (docs/plans/260907c-dictation-onto-an-openai-transcriber.md).
 *
 * Three words in it are load-bearing, and a shorter draft lost two of them to
 * GPT Sol's review:
 *
 * - **"OpenRouter and OpenAI"**, not "OpenAI". Both receive the recording, and
 *   naming only the far end of the chain misdescribes who has it.
 * - **"on our servers"**, not "we don't keep a copy". When a transcription
 *   fails, `mic-recording.ts` deliberately holds the Blob in the tab so the
 *   reader can download what they said — so an unqualified "we don't keep it"
 *   is wrong about the reader's own browser.
 * - **"they may keep it under their own policies"** under-claims on purpose,
 *   and a future edit will want to warm it up. OpenAI's per-endpoint table
 *   gives `/v1/audio/transcriptions` no retention at all, so *"and they don't
 *   either"* is probably true. Probably is not the standard for the line beside
 *   a button: `gpt-transcribe` is listed under two OpenAI endpoints whose
 *   retention differs, and nothing documents which of them OpenRouter calls.
 *   It also replaced *"we can't promise they don't"*, which GPT Sol found
 *   grammatically ambiguous — "they don't" could be read as attaching to *"save
 *   it on our servers"*, which would say nothing at all.
 *
 * `/privacy` has room to set the position out; this has a line, so it takes the
 * half we can stand behind. Read docs/project/privacy.md § Where a reader's
 * voice goes before changing it.
 */
const DICTATION_PROMISE =
  "Your voice goes to OpenRouter and OpenAI to be transcribed. We don't save it on our servers; they may keep it under their own policies.";

/**
 * **What the button says instead when there is no network**, and why it is not
 * merely disabled.
 *
 * The words that get saved come from `POST /api/transcribe`, so with no
 * connection a dictation is a minute of talking and then a failure. Greg asked
 * for exactly this, 2026-09-05: *"If it's offline before, we should disable the
 * mic input button."*
 *
 * It takes the description slot from `DICTATION_PROMISE` while it applies. The
 * promise is a fact about a control the reader cannot use yet; the reason they
 * cannot use it is the more urgent of the two, and there is one slot.
 *
 * Only ever shown on a `navigator.onLine` of `false`, which is the one
 * direction that value can be trusted — [`useOnline.ts`](./useOnline.ts).
 */
const DICTATION_OFFLINE =
  "Dictation needs an internet connection, and your browser says there isn't one.";

/** Ids have to be unique on a page with four of these. */
let promiseSeq = 0;

export function DictationButton({
  dictation,
  toggle,
  disabled,
  again,
  sendingAfter,
  done = "send",
}: {
  dictation: UseDictation;
  toggle(): void;
  disabled?: boolean | undefined;
  /** What the double press does here, for the button's name. `DoneAction`. */
  done?: DoneAction | undefined;
  /**
   * **The second press of a double press on Stop**: `useDictationField().again`,
   * which is there only for the moment after Stop in which a second press
   * counts. A double press also sends (Greg, spya-rp8676), and a `disabled`
   * button is sent no click at all — so while this is given the button stays
   * live, is named for what a press does, and its only press is this one. It
   * never starts a dictation there. When the moment has passed, or the press
   * was taken, this is gone and the button is disabled as it always was.
   */
  again?: (() => void) | undefined;
  /** The second press was taken; the name says what happens next. */
  sendingAfter?: boolean | undefined;
}) {
  const busy = dictation.transcribing;
  /* Live through the gap, for the second press. Not when the box itself has
     switched the button off. */
  const pressable = busy && again !== undefined && !disabled;
  /* **Read here rather than passed in**, so that all six boxes get it from one
     place and a seventh cannot forget. `false` only; see `useOnline.ts`. */
  /* **Only while idle**, because this one control is also Stop. Disabling it on
     `offline` while a dictation is running would trap the recording: the reader
     could not stop the microphone, and since 2026-09-05 a recogniser losing its
     connection no longer ends the dictation either, so nothing else would.
     GPT Sol's plan review, F1 — a P0 the first implementation had. Stopping
     always works; the guard is about starting something that cannot. */
  const offline = !useOnline() && !dictation.armed && !dictation.transcribing;
  /* Stable across renders, and unique per button: `useState` with an
     initialiser rather than a counter read during render, which would hand two
     buttons the same id under StrictMode's double invocation. */
  const [describedBy] = useState(() => `mic-promise-${++promiseSeq}`);
  return (
    <>
      {/* **Before the button in the DOM**, so somebody arriving by keyboard
          meets it on the way to the control rather than after it. Visually
          nothing: it is a fact about how the control works, not a warning about
          whether it does. */}
      <span id={describedBy} className="prof-mic-note">
        <span className="sr-only">{offline ? DICTATION_OFFLINE : DICTATION_PROMISE}</span>
      </span>
    <button
      type="button"
      /* Four phases, three appearances. `.on` — the orange — is worn only once
         `audiostart` has fired and the microphone is genuinely open; `.opening`
         is the second before that and looks different on purpose. The old code
         went orange on the line after `start()`, a measured 1.1 seconds before
         the microphone could hear anything, which meant the button's one piece
         of feedback was wrong exactly when the reader was watching it. */
      className={`prof-mic${dictation.phase === "listening" ? " on" : ""}${
        dictation.phase === "opening" ? " opening" : ""
      }${busy ? " busy" : ""}`}
      /* **The reason goes in the name when the control is dead.** A disabled
         button announces its name and its disabled state and nothing else, so a
         name that still says "Dictate" tells somebody the one thing they can
         already see. Ordered before `armed` because a dictation cannot be
         running while the browser reports no network at all. */
      aria-label={
        offline
          ? DICTATION_OFFLINE
          : busy
            ? sendingAfter
              ? DONE_WORDS[done].button
              : pressable
                ? DONE_WORDS[done].again
                : "Turning your words into text"
            : dictation.armed
              ? "Stop dictating"
              : "Dictate"
      }
      /* The promise is the button's *description*, so focusing it reads the
         name and then the sentence. There is deliberately no `title`: with an
         `aria-label` present an unused `title` becomes the description anyway,
         so the slot was already spoken for. */
      aria-describedby={describedBy}
      /* **The one case where a `title` is right on this button.** The comment
         below says there is deliberately none, and that holds for the working
         control: with an `aria-label` present an unused `title` becomes the
         description, and that slot carries the promise. Offline, the label and
         the description are already saying this same sentence, so the tooltip
         adds no third voice — and it is the only way a mouse user finds out why
         the button is dead. */
      {...(offline ? { title: DICTATION_OFFLINE } : {})}
      /* **Disabled while transcribing, and that is not merely cosmetic.** The
         microphone is already off; a press here can only mean "start again",
         and starting again two hundred milliseconds before the words arrive
         throws away the dictation the reader just gave. */
      disabled={disabled || (busy && !pressable) || offline}
      onClick={pressable ? again : toggle}
    >
      {busy ? (
        <Loader2 size={13} className="spin" />
      ) : dictation.armed ? (
        <Square size={11} fill="currentColor" strokeWidth={0} />
      ) : (
        <Mic size={14} />
      )}
      </button>
    </>
  );
}

/**
 * The line under the box: the meter, what is happening, how long for, which
 * microphone, and anything that went wrong.
 *
 * Rendered whenever the microphone is armed **or** a transcript is on its way —
 * not only when there is interim text to put in it, which is what the old code
 * did. That conditional was most of the original bug: for the several seconds
 * between pressing the button and the first transcript coming back, the layout
 * was byte-for-byte what it had been before the press, so the reader looking at
 * the box saw nothing happen at all.
 */
export function DictationStrip({
  dictation,
  id,
  sendingAfter = false,
  done = "send",
}: {
  dictation: UseDictation;
  /** For `aria-describedby` on the box, if the caller wants it. */
  id?: string | undefined;
  /** What the double press does here, for the sentence. `DoneAction`. */
  done?: DoneAction | undefined;
  /** `useDictationField().sendingAfter`: a double press on Stop was taken. */
  sendingAfter?: boolean | undefined;
}) {
  const [picking, setPicking] = useState(false);
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const busy = dictation.armed || dictation.transcribing;
  const words = dictationWords(dictation, sendingAfter, done);

  /* The device list is fetched when the picker is opened rather than kept in
     sync all the time: `enumerateDevices` returns **blank labels until
     microphone permission has been granted**, so a list gathered eagerly is a
     column of empty rows. By the time this control is reachable there is a live
     track, so the names are there. */
  useEffect(() => {
    if (!picking) return;
    let alive = true;
    const refresh = () => {
      void listInputs().then((ds) => {
        if (alive) setDevices(ds);
      });
    };
    refresh();
    // Plugging a headset in while the list is open should add it, rather than
    // making the reader close and reopen to find out.
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, [picking]);

  return (
    <>
      {/* One live region, mounted for the life of the box. See the header. */}
      <p className="sr-only" role="status" aria-atomic="true" id={id}>
        {dictation.error ?? (busy ? words : "")}
      </p>

      {busy && (
        /* **`quiet` looks like a warning**, because the faint grey it used to
           share with "Listening" was not something anybody noticed. The words
           stay an observation rather than a diagnosis — `audio-level.ts` says
           why — and the warm colour is `.prof-mic-warn`'s: a fact worth
           knowing, not a failure. Greg, SPIDERYARN-READING2-7Z; plan 261001k. */
        <p className={`prof-listening${dictation.quiet ? " quiet" : ""}`}>
          {dictation.armed && (
            <MicLevel level={dictation.level} detected={dictation.meter === "detected"} />
          )}
          {dictation.quiet && (
            <TriangleAlert size={13} className="prof-quiet-icon" aria-hidden="true" />
          )}
          {dictation.transcribing && <Loader2 size={13} className="spin" aria-hidden="true" />}
          {/* The live region above is already saying this. */}
          <span className="prof-listening-what" aria-hidden="true">
            {words}
          </span>
          {dictation.armed && dictation.startedAt !== null && (
            <Elapsed since={dictation.startedAt} />
          )}
          {/* Outside the live region and hidden from it: the recogniser revises
              this several times a second, and a screen reader re-reading each
              guess is unusable. The confirmed text lands in the box. */}
          {dictation.interim && (
            <span className="prof-interim" aria-hidden="true">
              {dictation.interim}…
            </span>
          )}
        </p>
      )}

      {/* **Which microphone, for as long as one is open** — not only once ten
          quiet seconds have passed. Bars moving prove that *a* microphone hears
          sound, not that it is the one the reader meant: Greg's Mac listened to
          something other than his webcam, which was the system input, and the
          transcriber heard no words (spya-g8byyd, plan 261001q). Its own line,
          because in the row above it was the one item allowed to shrink, and on
          a phone it shrank to nothing. "Your choice" comes from the remembered
          pick, not from the label, which says nothing reliable about it. */}
      {dictation.armed && dictation.deviceLabel && (
        <p className="prof-mic-line">
          <span className="prof-mic-line-key">Microphone:</span>{" "}
          <span className="prof-mic-device" title={dictation.deviceLabel}>
            {dictation.deviceLabel}
          </span>
          {dictation.deviceId !== null && !dictation.deviceUnavailable && (
            <span className="prof-mic-chosen"> (your choice)</span>
          )}{" "}
          <button
            type="button"
            className="prof-mic-change"
            aria-label={`Change microphone, currently ${dictation.deviceLabel}`}
            aria-expanded={picking}
            onClick={() => setPicking((p) => !p)}
          >
            Change
          </button>
        </p>
      )}

      {/* A microphone was chosen and could not be opened, so something else is
          being used. Said rather than left to be noticed — and since
          2026-10-01 both by name where the browser gave names, because "using
          another one" left Greg unable to tell whether anything was wrong
          (spya-k3q9mc). "Couldn't use", not "isn't connected": all we know is
          that asking for it by id failed. */}
      {dictation.armed && dictation.deviceUnavailable && (
        <p className="prof-mic-warn">
          {deviceUnavailableWords(dictation.deviceUnavailable.wanted, dictation.deviceLabel)}
        </p>
      )}

      {picking && dictation.armed && dictation.deviceLabel && (
        <p className="prof-mic-picker">
          <label htmlFor="dictation-mic">Microphone</label>
          <select
            id="dictation-mic"
            value={dictation.deviceId ?? ""}
            onChange={(e) => {
              dictation.chooseDevice(e.target.value || null);
              setPicking(false);
            }}
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
            {/* A remembered device that is no longer in the list would otherwise
                be a `<select>` whose value matches no option — which renders as
                blank, or as whatever happens to be first, and either way tells
                the reader something untrue about what is selected. The
                preference is deliberately kept rather than cleared. */}
            {dictation.deviceId && !devices.some((d) => d.deviceId === dictation.deviceId) && (
              <option value={dictation.deviceId}>Your usual microphone (not available now)</option>
            )}
          </select>
          <span className="prof-mic-picker-note">Restarts dictation on the one you choose.</span>
        </p>
      )}

      {dictation.recording && (
        <SaveRecording
          recording={dictation.recording}
          onDiscard={dictation.clearRecording}
          onRetry={dictation.canRetry ? dictation.retry : null}
          keptOnDevice={dictation.keptOnDevice}
        />
      )}

      {/* `aria-hidden`, because the live region above is already carrying this
          sentence. Two copies in the accessibility tree is the error read
          twice. */}
      {dictation.error && (
        <p className="prof-box-error" aria-hidden="true">
          <TriangleAlert size={12} /> {dictation.error}
        </p>
      )}
    </>
  );
}

/**
 * How long the microphone has been open, `m:ss`.
 *
 * **`role="timer"`, not `aria-hidden`.** The elapsed time is worth having if you
 * go looking for it, and `timer` is exposed but implicitly `aria-live: off`, so
 * it is not announced — which matters because the alternative is a screen
 * reader saying "zero one, zero two, zero three" for as long as somebody
 * dictates.
 *
 * The clock is `useNow`, which stops in a hidden tab and re-reads on return, so
 * a reader who switches away and comes back sees the true elapsed time rather
 * than a number that stopped counting while the microphone did not.
 */
function Elapsed({ since }: { since: number }) {
  const now = useNow(1000);
  return (
    <span className="prof-elapsed" role="timer">
      {formatDuration(Math.max(0, now - since))}
    </span>
  );
}

/**
 * The audio of a dictation that produced nothing, offered back — and, when the
 * reason was a failure rather than an answer, a second go at it.
 *
 * **It is a download, and the copy does not promise more than that.** Greg asked
 * to "reveal it in the OS file explorer"; no web page can do that, so this hands
 * over a file and the browser's own downloads UI carries the *Show in Folder*
 * step. See [mic-recording.ts](./mic-recording.ts).
 *
 * The object URL is created on the click and revoked a minute later rather than
 * held for the life of the row — the same shape as
 * [SourceLink](./SourceLink.tsx), and for the same reason: a URL that exists
 * only around the moment it is used cannot be leaked by a component that
 * unmounts at the wrong time.
 */
function SaveRecording({
  recording,
  onDiscard,
  onRetry,
  keptOnDevice,
}: {
  recording: DictationRecording;
  /**
   * A copy is on this device and every write of it landed, so closing the page
   * will not lose it — Greg's *"say, look, it failed but nothing's been lost"*.
   * Plan 260929h.
   */
  keptOnDevice: boolean;
  onDiscard(): void;
  /**
   * Send the same audio again, or null when that could not help.
   *
   * Null after `[mic-silent]` — a *successful* transcription of a recording
   * with no speech in it. The audio is still worth offering there (the reader
   * can hear what we heard) and a second identical request is not.
   */
  onRetry: (() => void) | null;
}) {
  /* A retry is a request, so with no network it is a button that cannot work.
     Same rule and same direction as the microphone button above: `false` is
     trusted, `true` is not. */
  const online = useOnline();
  const save = (part: MicRecording, n?: number) => {
    const url = URL.createObjectURL(part.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = recordingFilename(new Date(), part.ext, n);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  /* One part is today's single button, unchanged; several get one each. */
  const only = recording.parts.length === 1 ? recording.parts[0] : undefined;

  return (
    <p className="prof-recording">
      {/* **One sentence for both cases, because there are two now.** It used to
          say "Nothing was transcribed", which was true while the audio was kept
          only when the box was empty. Since 2026-09-05 it is kept whenever the
          transcription failed — including when the recogniser's rough words are
          in the box — and that sentence would then be false. The error line
          above already says what happened; this row's job is the audio. */}
      <span className="prof-recording-what">
        {keptOnDevice
          ? "The audio is kept on this device, even if you close the page."
          : "The audio is still here if you want it."}
      </span>
      {onRetry && (
        /* **First, and it is the primary action.** Everything else in this row
           is salvage — a file to keep, a thing to throw away — and the reader's
           actual want is the words. Greg asked for it by name, 2026-09-05.
           `title` rather than a disabled button with no reason on it, for the
           offline case. */
        <button
          type="button"
          className="prof-recording-retry"
          onClick={onRetry}
          disabled={!online}
          {...(online ? {} : { title: DICTATION_OFFLINE })}
        >
          <RotateCcw size={12} /> Try again
        </button>
      )}
      {only ? (
        <button type="button" className="prof-recording-save" onClick={() => save(only)}>
          <Download size={12} />{" "}
          {/* Says which it is when it is only part of it, because "the recording"
              would be a claim about the whole of a session that ran past the cap. */}
          {only.capped ? "Save the first" : "Save"} {formatDuration(only.ms)}
        </button>
      ) : (
        /* **One button per part** for a dictation long enough to have been
           recorded in several (plan 260929f): each part is its own file, and
           there is no joining two into one playable file in the browser. */
        recording.parts.map((part, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts are a fixed, ordered list for the life of this row
            key={i}
            type="button"
            className="prof-recording-save"
            onClick={() => save(part, i + 1)}
          >
            <Download size={12} /> Save part {i + 1} ({formatDuration(part.ms)})
          </button>
        ))
      )}
      {/* Deleting it is the reader's to do, rather than something that happens
          to them eventually. */}
      <button
        type="button"
        className="prof-recording-drop"
        onClick={onDiscard}
        aria-label="Discard the recording"
        title="Discard the recording"
      >
        <X size={12} />
      </button>
    </p>
  );
}
