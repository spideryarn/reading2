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
 *
 * **It saves itself after a pause, says so, and questions a reader leaving
 * with words unsaved.** Greg, 2026-09-30 (spya-czbj9r):
 *
 * > make it clearer when it has saved (e.g. show some loading spinner and then
 * > green-checkmark or similar. And if I try and close the page before it has
 * > saved, either warn the user, or auto-save. Maybe auto-save any time it has
 * > been idle for a few seconds? Perhaps this could be a reusable
 * > text-input-box auto-save component …
 *
 * This box is that component: both of its pages hand it a `SaveState` (from
 * [`useAutosavedText`](./useAutosavedText.ts), which does the saving) and get
 * the timer, the warning and the status line without writing any of them.
 * docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md.
 */
import { Check, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { keepDictation } from "./dictation-keep.js";
import { sendForTranscription } from "./dictation-upload.js";
import { Tooltip } from "./Tooltip.js";
import { warnBeforeUnload } from "./unload-guard.js";
import type { SaveState } from "./useAutosavedText.js";
import { useDictationField } from "./useDictationField.js";

/**
 * How long the box must sit still before it saves. Long enough to be a pause
 * rather than a gap between words; short enough that closing the tab a moment
 * after the last word usually finds it already saved.
 */
export const AUTOSAVE_IDLE_MS = 2_000;

/** Text the server may not have, as the status line knows it: what the warning asks about. */
function pending(s: SaveState): boolean {
  return s.kind === "dirty" || s.kind === "saving" || s.kind === "error";
}

/**
 * **Saved after a pause.** Calls `commit` once the text has sat still for `ms`.
 *
 * It takes the facts it acts on rather than a `SaveState`, because two of
 * them cannot be read off one:
 *
 * - **Armed only while `dirty`.** Never over a refusal: a timer re-armed by
 *   `error` would retry a refused save for as long as the page stayed open. A
 *   keystroke is what earns a new attempt, and it clears the error to dirty.
 * - **Keyed on the text and on `inFlight`.** Load S, type A, its write goes,
 *   type back to S: the box says clean and nothing is armed. When A lands the
 *   box is dirty against A with no keystroke to start the pause, and nothing
 *   sent S until a blur. A write ending restarts it. GPT Sol's F2.
 *
 * `paused` is for a box that must not save yet (disabled, or dictating).
 */
export function useIdleCommit({
  text,
  dirty,
  inFlight,
  paused,
  ms,
  commit,
}: {
  text: string;
  dirty: boolean;
  inFlight: boolean;
  paused: boolean;
  ms: number;
  commit(): void;
}): void {
  /* Read by a timer that outlives the render it was set up in. */
  const latest = useRef({ dirty, paused, commit });
  latest.current = { dirty, paused, commit };
  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` and `inFlight` are the triggers. Every keystroke, and every write ending, restarts the pause; `dirty` is read as it stands then.
  useEffect(() => {
    if (paused || !latest.current.dirty) return;
    const t = window.setTimeout(() => {
      if (!latest.current.paused) latest.current.commit();
    }, ms);
    return () => window.clearTimeout(t);
  }, [text, inFlight, paused, ms]);
}

/**
 * **Leaving with words unsaved is questioned.** Desktop only in practice:
 * iOS does not fire `beforeunload`, which is why the save behind these boxes
 * also saves on `visibilitychange` and fires a `keepalive` on `pagehide`
 * (useAutosavedText.ts). Attached only while something is unsaved, because a
 * page with a `beforeunload` listener is kept out of some browsers'
 * back-forward cache whether or not the listener ever objects.
 *
 * The caller says what unsaved means. For the add page that includes words
 * typed before there is an article to save them to (plan 261004l, Sol's F6).
 */
export function useUnsavedWarning(unsaved: boolean): void {
  useEffect(() => {
    if (!unsaved) return;
    /* The shared guard, so a page that reloads itself for a new build hears
       the same fact the reader is warned by — safe-to-reload.ts. */
    return warnBeforeUnload("unsaved");
  }, [unsaved]);
}

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
  save,
  inFlight = false,
  onBusyChange,
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
  /** Where the save stands. The page owns the save; the box owns saying so. */
  save: SaveState;
  /**
   * Whether a write is on the wire, including one for older text
   * (`useAutosavedText`'s `inFlight`). `save` cannot say: it reads `clean`
   * when the box has moved back to the loaded value under an older write. The
   * idle timer restarts when it ends, and the leave warning counts it.
   */
  inFlight?: boolean;
  /**
   * Told when the microphone goes on, or its words start or stop being on
   * their way. For a container that can be dismissed from under the box — the
   * profile popover — because dictation's unmount *aborts*, and a panel closed
   * mid-sentence would throw the spoken words away. A page that cannot be
   * dismissed has no use for it. ProfilePanel.tsx.
   */
  onBusyChange?(busy: boolean): void;
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
    keep: keepDictation(`profile:${id}`),
  });
  const dictation = dictate.dictation;

  const over = value.length > max;

  /* The microphone is on, or its words are still on their way. */
  const busy = dictation.armed || dictation.transcribing;

  /* Through a ref, so a caller passing a fresh arrow each render does not
     re-announce an unchanged `busy`. */
  const tell = useRef(onBusyChange);
  tell.current = onBusyChange;
  useEffect(() => {
    tell.current?.(busy);
  }, [busy]);

  /* **Saved after a pause** (`useIdleCommit` above has the two rules).

     Not while dictating, nor while the transcript is coming back, which can
     take longer than the pause. The dictation commits for itself when its words
     land, and a save before then is a save of the recogniser's rough guesses,
     or of the box without the words at all. GPT Sol's plan review, item 3. */
  useIdleCommit({
    text: value,
    dirty: save.kind === "dirty",
    inFlight,
    paused: Boolean(disabled) || busy,
    ms: AUTOSAVE_IDLE_MS,
    commit: onCommit,
  });

  useUnsavedWarning(pending(save) || inFlight);

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

      <SaveStatus save={save} />
    </div>
  );
}

/**
 * The line that says where the save is. Mounted for the life of the box and
 * `aria-live`, so what is announced is the change. Exported for the add
 * page's box, which is not a `ProfileBox` (it has no microphone) and says the
 * same things once its article exists.
 *
 * **Quiet unless something failed.** Greg, 2026-10-05:
 *
 * > can we make it a bit less visually intrusive, e.g. a faint green tick that
 * > appears when it saves (with a tooltip) and then fades away, with no scary
 * > "unsaved" indicator.
 *
 * So the words do not change while the reader types or a write is out: there
 * is no *Unsaved changes* and no *Saving…*. A save that landed mounts a tick,
 * which CSS fades and then hides (profile.css § `.prof-save-tick`); it exists
 * only in `saved`, so the next save mounts a new one and the fade runs again.
 * A refusal is the one thing that takes the line over, and it stays until the
 * next keystroke: losing the reader's words silently is worse than a label.
 * What still guards words that are not saved yet is the leave warning
 * (`useUnsavedWarning`), which says nothing until it is needed.
 */
export function SaveStatus({ save }: { save: SaveState }) {
  return (
    <p className={`prof-save is-${save.kind}`} aria-live="polite">
      {saveWords(save)}
    </p>
  );
}

/** The promise, standing in every state where nothing has gone wrong. */
const QUIET = <span className="prof-save-words">Saves as you type.</span>;

function saveWords(save: SaveState) {
  switch (save.kind) {
    case "loading":
      return "Loading…";
    case "clean":
    case "dirty":
    case "saving":
      return QUIET;
    case "saved":
      return (
        <>
          {QUIET}
          <SavedTick />
          {/* Polite announcements may wait longer than the visual tick. */}
          <span className="sr-only">Saved</span>
        </>
      );
    case "error":
      return (
        <>
          <TriangleAlert size={12} aria-hidden="true" /> Not saved — {save.message}
        </>
      );
    default: {
      const never: never = save;
      return never;
    }
  }
}

function SavedTick() {
  const [finished, setFinished] = useState(false);
  if (finished) return null;
  /* The tooltip is portalled outside the hidden span. Unmount it explicitly
     when the animation ends, including after the reduced-motion hold. */
  return (
    <Tooltip content="Saved" placement="top">
      <span className="prof-save-tick" aria-hidden="true" onAnimationEnd={() => setFinished(true)}>
        <Check size={13} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
