/**
 * One of the two profile textareas, with its microphone.
 *
 * Shared by `/profile` ("about you") and the metadata page ("why you're reading
 * this one") because the two differ only in their words and their cap — and
 * because a microphone written twice is a microphone that behaves two ways.
 * docs/project/reader-profile.md.
 *
 * **The microphone is no longer written here.** It moved out on 2026-08-27 into
 * [`useDictationField`](./useDictationField.ts) and
 * [`DictationStrip`](./DictationStrip.tsx), because Greg asked for it in lots
 * of places and the argument that made this component shared in the first place
 * applies one level up. What is left here is a box with a hint and a counter.
 *
 * ## What this component is still careful about
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
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { sendForTranscription } from "./dictation-upload.js";
import { useDictationField } from "./useDictationField.js";

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

  /* **The whole of the microphone, in one call.** The caret, the span the
     dictation occupies, closing the box while the transcript is on its way, and
     committing on *every* way of stopping rather than only the stop button —
     all of it is [`useDictationField`](./useDictationField.ts) now.

     `context` is `profile`, which is what tells the server to prime the model
     with the reader's own existing profile text. Their field's jargon, in their
     own spelling, is the best guess available at what they are about to say
     more of. src/transcribe.ts. */
  const dictate = useDictationField({
    value,
    onChange,
    onCommit,
    box,
    context: { kind: "profile" },
    transcribe: sendForTranscription,
  });
  const dictation = dictate.dictation;

  const over = value.length > max;

  return (
    <div className="prof-box">
      <div className="prof-box-head">
        <label className="prof-box-label" htmlFor={id}>
          {label}
        </label>
        {/* The button carries its own promise — see `DICTATION_PROMISE` in
            DictationStrip.tsx. It used to be written here, which is why chat
            and the comment dialog grew microphones with no notice at all. */}
        {dictation.supported && (
          <DictationButton dictation={dictation} toggle={dictate.toggle} disabled={disabled} />
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
        /* **Closed while the transcript is on its way**, so there is no such
           thing as an edit racing the words that are about to replace what is
           in the box. `readOnly` rather than `disabled`, which would take the
           focus away and drop the caret we are about to insert at.
           See useDictationField. */
        readOnly={dictate.readOnly}
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

      <DictationStrip dictation={dictation} />

      <div className="prof-box-foot">
        <p className="prof-box-hint">{hint}</p>
        <span className={`prof-count${over ? " over" : ""}`}>
          {value.length} / {max}
        </span>
      </div>
    </div>
  );
}
