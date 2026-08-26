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
import { useRef } from "react";
import { Mic, MicOff, TriangleAlert } from "lucide-react";
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
  const dictation = useDictation((text) => {
    const el = box.current;
    const at = el?.selectionStart ?? value.length;
    const to = el?.selectionEnd ?? value.length;
    /* A space between phrases, unless we are at the very start or there is
       already whitespace there. The recogniser hands back "the evidence" with
       no leading space, and three phrases in a row would otherwise read
       "the evidencenot the historyplease". */
    const needsSpace = at > 0 && !/\s$/.test(value.slice(0, at));
    const insert = `${needsSpace ? " " : ""}${text}`;
    onChange(value.slice(0, at) + insert + value.slice(to));
    requestAnimationFrame(() => {
      const next = at + insert.length;
      el?.setSelectionRange(next, next);
    });
  });

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
            className={`prof-mic${dictation.listening ? " on" : ""}`}
            /* Two names, because the button does two things and a reader using
               a screen reader gets no colour to tell them which. */
            aria-label={dictation.listening ? "Stop dictating" : "Dictate"}
            aria-pressed={dictation.listening}
            title={dictation.listening ? "Stop dictating" : "Dictate"}
            disabled={disabled}
            onClick={dictation.toggle}
          >
            {dictation.listening ? <MicOff size={14} /> : <Mic size={14} />}
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

      {/* The unconfirmed tail, shown greyed and never saved. Without it a reader
          watching the box mid-sentence sees nothing happen for a second or two
          and presses the button again. */}
      {dictation.interim && <p className="prof-interim">{dictation.interim}…</p>}

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
