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
 * **The device's name appears at the moment it is diagnostic and not before.**
 * Nothing on this page used to say which microphone had produced a zero, so a
 * meter reading nothing and a meter pointed at a dead conferencing loopback
 * were the same picture.
 */
import { Download, Loader2, Mic, Square, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { MicLevel } from "./MicLevel.js";
import { type MicDevice, listInputs } from "./mic-devices.js";
import { type MicRecording, formatDuration, recordingFilename } from "./mic-recording.js";
import type { UseDictation } from "./useDictation.js";
import { useNow } from "./useNow.js";

/**
 * What the strip says, in one place — because it is also what the live region
 * says, and the two must not be allowed to drift apart.
 */
function dictationWords(d: UseDictation): string {
  if (d.transcribing) return "Turning that into text…";
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
const DICTATION_PROMISE =
  "Your voice is sent to be transcribed, and isn't stored. The words appear when you stop.";

/** Ids have to be unique on a page with four of these. */
let promiseSeq = 0;

export function DictationButton({
  dictation,
  toggle,
  disabled,
}: {
  dictation: UseDictation;
  toggle(): void;
  disabled?: boolean | undefined;
}) {
  const busy = dictation.transcribing;
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
        <span className="sr-only">{DICTATION_PROMISE}</span>
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
      aria-label={busy ? "Turning your words into text" : dictation.armed ? "Stop dictating" : "Dictate"}
      /* The promise is the button's *description*, so focusing it reads the
         name and then the sentence. There is deliberately no `title`: with an
         `aria-label` present an unused `title` becomes the description anyway,
         so the slot was already spoken for. */
      aria-describedby={describedBy}
      /* **Disabled while transcribing, and that is not merely cosmetic.** The
         microphone is already off; a press here can only mean "start again",
         and starting again two hundred milliseconds before the words arrive
         throws away the dictation the reader just gave. */
      disabled={disabled || busy}
      onClick={toggle}
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
}: {
  dictation: UseDictation;
  /** For `aria-describedby` on the box, if the caller wants it. */
  id?: string | undefined;
}) {
  const [picking, setPicking] = useState(false);
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const busy = dictation.armed || dictation.transcribing;
  const words = dictationWords(dictation);

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
        <p className="prof-listening">
          {dictation.armed && (
            <MicLevel level={dictation.level} detected={dictation.meter === "detected"} />
          )}
          {dictation.transcribing && <Loader2 size={13} className="spin" aria-hidden="true" />}
          {/* The live region above is already saying this. */}
          <span className="prof-listening-what" aria-hidden="true">
            {words}
          </span>
          {dictation.armed && dictation.startedAt !== null && (
            <Elapsed since={dictation.startedAt} />
          )}
          {dictation.quiet && dictation.deviceLabel && (
            <>
              <span className="prof-mic-device" title={dictation.deviceLabel}>
                {dictation.deviceLabel}
              </span>
              <button
                type="button"
                className="prof-mic-change"
                onClick={() => setPicking((p) => !p)}
              >
                Change
              </button>
            </>
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

      {/* A microphone was chosen and could not be opened, so something else is
          being used. Said rather than left to be noticed. */}
      {dictation.armed && dictation.deviceUnavailable && (
        <p className="prof-mic-warn">The microphone you chose isn't available. Using another one.</p>
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
            <option value="">The browser's default</option>
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
        <SaveRecording recording={dictation.recording} onDiscard={dictation.clearRecording} />
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
 * The audio of a dictation that produced nothing, offered back.
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
}: {
  recording: MicRecording;
  onDiscard(): void;
}) {
  const save = () => {
    const url = URL.createObjectURL(recording.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = recordingFilename(new Date(), recording.ext);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <p className="prof-recording">
      <span className="prof-recording-what">
        Nothing was transcribed. The audio is still here if you want it.
      </span>
      <button type="button" className="prof-recording-save" onClick={save}>
        <Download size={12} />{" "}
        {/* Says which it is when it is only part of it, because "the recording"
            would be a claim about the whole of a session that ran past the cap. */}
        {recording.capped ? "Save the first" : "Save"} {formatDuration(recording.ms)}
      </button>
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
