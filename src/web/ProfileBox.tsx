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
import { useCallback, useRef } from "react";
import { Mic, MicOff, TriangleAlert } from "lucide-react";
import { MicLevel } from "./MicLevel.js";
import { useDictation } from "./useDictation.js";

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
            /* Two names, because the button does two things and a reader using
               a screen reader gets no colour to tell them which. */
            aria-label={dictation.armed ? "Stop dictating" : "Dictate"}
            aria-pressed={dictation.armed}
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
            {dictation.armed ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
        )}
      </div>

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

          `role="status"` so the phase changes are announced rather than only
          coloured; the bars themselves are `aria-hidden`, since they are a
          picture of what this line already says in words. */}
      {dictation.armed && (
        <p className="prof-listening" role="status">
          <MicLevel level={dictation.level} detected={dictation.meter === "detected"} />
          <span className="prof-listening-what">
            {dictation.phase === "opening"
              ? "Opening the microphone…"
              : /* Neutral, and deliberately never an accusation. It says what
                   we have observed and stops. Telling somebody their input
                   device is broken on the strength of ten quiet seconds sends
                   them off to change settings that were fine — GPT Sol's
                   review, 2026-08-27, item 6. */
                dictation.quiet
                ? "Listening — no sound detected yet"
                : /* On the binary path the bars say *whether* there is sound
                     rather than how much, so the words say so too rather than
                     letting the picture imply a measurement nobody took. */
                  dictation.meter === "detected"
                  ? "Listening for sound"
                  : "Listening"}
          </span>
          {dictation.interim && <span className="prof-interim">{dictation.interim}…</span>}
        </p>
      )}

      <div className="prof-box-foot">
        <p className="prof-box-hint">{hint}</p>
        <span className={`prof-count${over ? " over" : ""}`}>
          {value.length} / {max}
        </span>
      </div>

      {dictation.error && (
        <p className="prof-box-error">
          <TriangleAlert size={12} /> {dictation.error}
        </p>
      )}
    </div>
  );
}
