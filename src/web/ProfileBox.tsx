/**
 * One of the two profile textareas, with its microphone.
 *
 * Shared by `/profile` ("about you") and the metadata page ("why you're reading
 * this one") because the two differ only in their words and their cap — and
 * because a microphone written twice is a microphone that behaves two ways.
 * docs/project/reader-profile.md.
 *
 * ## What this component is careful about
 *
 * **Saving on blur, and the counter turning red before the server refuses.**
 * The cap is enforced server-side and *refused rather than truncated* — a
 * silently shortened profile is one the reader believes they gave and did not.
 * So `maxLength` is deliberately NOT set on the textarea: a `maxLength` would
 * swallow the paste at exactly the boundary the server would have complained
 * about, which is the same silent shortening wearing a different hat. The
 * counter turns red instead, the save goes anyway, and the server's refusal —
 * which names the limit — is what the reader sees. Their words stay in the box
 * the whole time.
 *
 * The one thing the counter must never do is *stop* them typing. A cap you can
 * see and go past is a cap you can decide about.
 *
 * **Dictated text goes in at the caret, not at the end.** A reader who clicks
 * into the middle of a sentence and starts talking means it there.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Mic, Square, TriangleAlert, X } from "lucide-react";
import { MicLevel } from "./MicLevel.js";
import { type MicDevice, listInputs } from "./mic-devices.js";
import { type MicRecording, formatDuration, recordingFilename } from "./mic-recording.js";
import { useDictation } from "./useDictation.js";
import { useNow } from "./useNow.js";

export function ProfileBox({
  id,
  label,
  hint,
  placeholder,
  value,
  onChange,
  onCommit,
  max,
  disabled,
  rows = 4,
}: {
  id: string;
  label: string;
  /** One line under the box saying what this changes. Not a tooltip: it is the promise. */
  hint: string;
  placeholder: string;
  value: string;
  onChange(next: string): void;
  /** Blur, or Cmd/Ctrl+Enter. The moment the reader chose. */
  onCommit(): void;
  max: number;
  disabled?: boolean;
  rows?: number;
}) {
  const box = useRef<HTMLTextAreaElement>(null);

  /* Inserted at the caret and the caret moved past it, so a second phrase lands
     after the first rather than at the same spot. Reading `value` from the prop
     rather than the DOM: React owns this input, and the two can disagree for a
     frame. */
  /* The caret to insert at, kept here rather than read off the DOM each time.
     Two final phrases can arrive between renders — the recogniser does not wait
     for React — and reading `value` and `selectionStart` fresh each time meant
     the second overwrote the first. So the position is advanced by us, and the
     text is read from a ref that is updated the moment we change it rather than
     when the prop comes back round. GPT Sol's review, 2026-08-26. */
  const live = useRef(value);
  live.current = value;
  const caret = useRef<number | null>(null);

  /* Committing on **every** way of stopping, not only on the stop button.
     Clicking the microphone takes the focus out of the box, so the blur has
     already saved the *pre-dictation* text; if dictation then ends any other
     way — a `network` error, a failed Safari restart — the confirmed words sat
     in the box unsaved while the reader believed they had been taken. The old
     code committed inside the stop handler alone, which covered exactly one of
     those paths. GPT Sol's review, 2026-08-27, item 12. */
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const finished = useCallback(() => {
    caret.current = null;
    commit.current();
  }, []);

  const dictation = useDictation((text) => {
    const el = box.current;
    const current = live.current;
    const at = caret.current ?? el?.selectionStart ?? current.length;
    const to = caret.current ?? el?.selectionEnd ?? current.length;
    /* A space between phrases, unless we are at the very start or there is
       already whitespace there. The recogniser hands back "the evidence" with
       no leading space, and three phrases in a row would otherwise read
       "the evidencenot the historyplease". */
    const needsSpace = at > 0 && !/\s$/.test(current.slice(0, at));
    const insert = `${needsSpace ? " " : ""}${text}`;
    const next = current.slice(0, at) + insert + current.slice(to);
    live.current = next;
    caret.current = at + insert.length;
    onChange(next);
    requestAnimationFrame(() => {
      const pos = caret.current;
      if (pos !== null) el?.setSelectionRange(pos, pos);
    });
  }, finished);

  const over = value.length > max;

  /* The device list is fetched when the picker is opened rather than kept in
     sync all the time: `enumerateDevices` returns **blank labels until
     microphone permission has been granted**, so a list gathered eagerly is a
     column of empty rows. By the time this control is reachable there is a live
     track, so the names are there. src/web/mic-devices.ts. */
  const [picking, setPicking] = useState(false);
  const [devices, setDevices] = useState<MicDevice[]>([]);
  useEffect(() => {
    if (!picking) return;
    let live = true;
    const refresh = () => {
      void listInputs().then((ds) => {
        if (live) setDevices(ds);
      });
    };
    refresh();
    // Plugging a headset in while the list is open should add it, rather than
    // making the reader close and reopen to find out. GPT Sol's review, item 7.
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      live = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, [picking]);

  /* What the strip says, in one place, because it is also what the live region
     says and the two must not be allowed to drift apart. */
  const listeningWords =
    dictation.phase === "opening"
      ? "Opening the microphone…"
      : dictation.quiet
        ? /* **Still not a diagnosis.** `quiet` means nothing crossed −55 dBFS
             for ten seconds, which a thinking reader in a quiet room produces
             too — so the sentence reports the threshold and then names the
             device as a separate fact, rather than becoming "no sound *from*
             X", which reads as a verdict on X. GPT Sol's review, item 8. */
          "No sound detected yet"
        : dictation.meter === "detected"
          ? /* On the binary path the bars say *whether* there is sound rather
               than how much, so the words say so too rather than letting the
               picture imply a measurement nobody took. */
            "Listening for sound"
          : "Listening";

  return (
    <div className="prof-box">
      <div className="prof-box-head">
        <label className="prof-box-label" htmlFor={id}>
          {label}
        </label>
        {dictation.supported && (
          <button
            type="button"
            /* Three phases, two of which are armed. `.on` — the orange — is
               only worn once `audiostart` has fired and the microphone is
               genuinely open; `.opening` is the second before that, and it
               looks different on purpose. The old code went orange on the line
               after `start()`, a measured 1.1 seconds before the microphone
               could hear anything, which meant the button's one piece of
               feedback was wrong exactly when the reader was watching it.
               docs/plans/microphone-level-meter.md. */
            className={`prof-mic${dictation.phase === "listening" ? " on" : ""}${
              dictation.phase === "opening" ? " opening" : ""
            }`}
            /* **An action button, not a toggle.** The name says what the
               press will do, and there is no `aria-pressed` — which is the
               same model the glyph already uses (a filled square meaning
               "stop"), so the icon, the tooltip and the announced name all say
               one thing. The APG allows either this or a fixed name carrying
               state in `aria-pressed`; what it does not allow is both at once,
               which is what was here before. Mixing them a second time via
               `title` is just as bad — with an `aria-label` present, an
               otherwise-unused `title` becomes the accessible *description*,
               so the two must agree rather than merely not collide.
               docs/research/microphone-library-options.md. */
            aria-label={dictation.armed ? "Stop dictating" : "Dictate"}
            title={dictation.armed ? "Stop dictating" : "Dictate"}
            disabled={disabled}
            onClick={() => {
              if (dictation.armed) {
                /* The commit now happens in `onEnd` rather than here, so that
                   every way of stopping saves and not just this one. */
                dictation.toggle();
                return;
              }
              // Where the reader had the caret when they pressed it. Read now,
              // because the button is about to take the focus.
              caret.current = box.current?.selectionStart ?? value.length;
              dictation.toggle();
            }}
          >
            {/* **A filled square, not `MicOff`.**
                `MicOff` is the icon for *muted*, so the one moment the
                microphone was live it wore the glyph for dead — and it said
                nothing about what pressing it would do. The rule is that the
                icon says what the press does, which is "stop" from the moment
                the button is armed, including through the `opening` second.
                The phase is carried by the colour, the pulse and the strip's
                own words; it does not need the glyph as well.
                docs/plans/microphone-device-and-recording.md. */}
            {dictation.armed ? (
              <Square size={11} fill="currentColor" strokeWidth={0} />
            ) : (
              <Mic size={14} />
            )}
          </button>
        )}
      </div>

      {/* **One live region, mounted for the life of the box.**
       *
        A `role="status"` that appears and disappears with the strip is a live
        region created *already containing* its message, which several screen
        readers do not announce at all — the announcement is of a change, and
        there was no change, there was a new element. So the region is always
        here, empty when there is nothing to say, and every visible copy of
        these words below is `aria-hidden` so nothing is read twice.
        `aria-atomic` because "No sound detected yet" is one sentence rather
        than an accumulation. GPT Sol's review, 2026-08-27, item 9. */}
      <p className="sr-only" role="status" aria-atomic="true">
        {dictation.error ?? (dictation.armed ? listeningWords : "")}
      </p>

      <textarea
        id={id}
        ref={box}
        className="prof-box-input"
        rows={rows}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter saves without leaving the box — the shortcut the
          // previous version's own background form used, and the one a person
          // who types a lot reaches for. Plain Enter is a newline: this is prose.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onCommit();
          }
        }}
      />

      {/* **The strip, and it is rendered whenever the microphone is armed** —
          not only when there is interim text to put in it, which is what the
          old code did. That conditional was most of the bug: for the several
          seconds between pressing the button and the first transcript coming
          back, the layout was byte-for-byte what it had been before the press,
          so the reader looking at the box — which is where the words are
          supposed to appear — saw nothing happen at all.

          **`aria-hidden` goes on the repeated parts, never on the strip
          itself.** It was on the whole `<p>` for a draft, which also hid the
          timer inside it — and the timer's `role="timer"` exists exactly so
          that it *is* exposed while not being announced. Hiding an ancestor
          takes a descendant out of the accessibility tree whatever its role.
          GPT Sol's code review, 2026-08-27, item 6. */}
      {dictation.armed && (
        <p className="prof-listening">
          <MicLevel level={dictation.level} detected={dictation.meter === "detected"} />
          {/* The live region above is already saying this. */}
          <span className="prof-listening-what" aria-hidden="true">
            {listeningWords}
          </span>
          {dictation.startedAt !== null && <Elapsed since={dictation.startedAt} />}
          {/* **The device's name, at the moment it is diagnostic and not
              before.** Nothing on this page said which microphone had produced
              the zero, so a meter reading nothing and a meter pointed at a dead
              conferencing loopback were the same picture. It is not shown while
              sound is arriving, where it is noise and the bars have already
              answered the question. */}
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
              guess is unusable. The confirmed text lands in the textarea. */}
          {dictation.interim && (
            <span className="prof-interim" aria-hidden="true">
              {dictation.interim}…
            </span>
          )}
        </p>
      )}

      {/* A microphone was chosen and could not be opened, so something else is
          being used. Said rather than left to be noticed — transcribing from a
          device the reader did not pick, silently, is the failure this whole
          round is about. */}
      {dictation.armed && dictation.deviceUnavailable && (
        <p className="prof-mic-warn">
          The microphone you chose isn't available. Using another one.
        </p>
      )}

      {/* The picker. Only reachable while a track is open, which is also the
          only state in which we know the device names — and only on the path
          where we own the track at all, since choosing a device the recogniser
          opens for itself is not something the API allows us to do. */}
      {picking && dictation.armed && dictation.deviceLabel && (
        <p className="prof-mic-picker">
          <label htmlFor={`${id}-mic`}>Microphone</label>
          <select
            id={`${id}-mic`}
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
            {/* A remembered device that is no longer in the list would
                otherwise be a `<select>` whose value matches no option — which
                renders as blank, or as whatever happens to be first, and either
                way tells the reader something untrue about what is selected.
                The preference is deliberately kept rather than cleared (see
                the plan), so it has to be visible and it has to say what it is.
                GPT Sol's code review, item 7. */}
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

      <div className="prof-box-foot">
        <p className="prof-box-hint">{hint}</p>
        <span className={`prof-count${over ? " over" : ""}`}>
          {value.length} / {max}
        </span>
      </div>

      {/* `aria-hidden`, because the live region at the top of the box is
          already carrying this sentence. Two copies in the accessibility tree
          is the error read twice. */}
      {dictation.error && (
        <p className="prof-box-error" aria-hidden="true">
          <TriangleAlert size={12} /> {dictation.error}
        </p>
      )}
    </div>
  );
}

/**
 * How long the microphone has been open, `m:ss`.
 *
 * **`role="timer"`, not `aria-hidden`.** The elapsed time is worth having if
 * you go looking for it, and `timer` is exposed but implicitly `aria-live:
 * off`, so it is not announced — which matters because the alternative is a
 * screen reader saying "zero one, zero two, zero three" for as long as somebody
 * dictates. GPT Sol's review, 2026-08-27, item 9.
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
 * **It is a download, and the copy does not promise more than that.** Greg
 * asked to "reveal it in the OS file explorer"; no web page can do that, so
 * this hands over a file and the browser's own downloads UI carries the *Show
 * in Folder* step. See [mic-recording.ts](./mic-recording.ts).
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
          to them eventually. GPT Sol's review, item 6. */}
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
