/**
 * **A box the admin writes into, and sends from, inside the Earlier tab** —
 * shared by the reply box under a question's thread (261008i) and the
 * addendum box under one of the admin's own reports (plan 261010o). One
 * component so the two cannot drift apart in the parts that were each learnt
 * the hard way:
 *
 * - **It grows with its words and never scrolls itself** (useFitTextarea.ts):
 *   on an iPhone, a dictated paragraph in a three-line box inside a scrolling
 *   panel was two scrollers under one finger with the keyboard up (Greg,
 *   `spya-za2tse`; plan 261008i, decision 10).
 * - **Its own microphone, named for what the words are about** (`keeper`), so
 *   a recording left by the Write box is never offered here or the other way
 *   round, and a transcript never lands in another report's or question's box
 *   (dictation.md § Words go only where they were said). The keeper is handed
 *   over only while the box can be seen.
 * - **Send is off while the microphone listens or transcribes**, and the
 *   guard is the function's as well as the button's: a double press on Stop
 *   and ⌘/Ctrl+Enter reach the same `trySend` (dictation.md § Adding it to a
 *   box).
 * - **Going out of sight stops the microphone** (`active` false), exactly as
 *   the Write box's is stopped on a tab change and on close: the hook's own
 *   `toggle` (a stop, so what was said lands in the draft), never the field's,
 *   which would pull focus into a box that has just been hidden.
 *
 * What it does not own: the draft, the send, and what the send's id is. Those
 * belong to the caller's hook, keyed by what the box is about, so a draft
 * survives the box being unmounted or hidden.
 */
import { LoaderCircle } from "lucide-react";
import { type ReactNode, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";

import { keepDictation } from "./dictation-keep.js";
import { useReaderTranscriber } from "./dictation-upload.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { useDictationField } from "./useDictationField.js";
import { useFitTextarea } from "./useFitTextarea.js";
import { dictationReporter } from "./dictation-report.js";

export function FeedbackSendBox({
  value,
  onChange,
  onSend,
  sending,
  held = false,
  active,
  keeper,
  doneKey,
  label,
  placeholder,
  sendWord,
  cap,
  className,
  problems,
  children,
}: {
  value: string;
  onChange(next: string): void;
  /** Called only when the box can be seen and the microphone is not busy. */
  onSend(): void;
  /** A send from this box is in the air: the words are read-only and Send spins. */
  sending: boolean;
  /** Something else in flight that keeps Send off too (the thread's deferral). */
  held?: boolean;
  /** Whether the box can be seen. Out of sight, the microphone stops and takes no keeper. */
  active: boolean;
  /** The keeper's box name: everything these words are about, e.g. `feedback-reply:q-k3m9qt`. */
  keeper: string;
  /** The double press's key while seen, e.g. `reply:q-k3m9qt`; `<prefix>:hidden` out of sight. */
  doneKey: { seen: string; hidden: string };
  label: string;
  placeholder: string;
  sendWord: string;
  cap: number;
  /** Added to `fb-reply` on the wrapper, to tell one kind of box from another. */
  className?: string;
  /** What went wrong, each said once under the box; null says nothing. */
  problems: readonly (string | null)[];
  /** Buttons after Send: *Defer for now*, or *Cancel*. */
  children?: ReactNode;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const over = value.length > cap;
  const transcribe = useReaderTranscriber();
  useFitTextarea(box, value);
  /* Read at call time, so a double press on Stop sees this render's `busy`. */
  const busyRef = useRef(false);
  const trySend = () => {
    if (!active || busyRef.current) return;
    onSend();
  };
  const dictate = useDictationField({
    value,
    onChange,
    box,
    /* Not the article being read: feedback is about the app, so the
       transcript is primed with the app's words and the reader's profile. */
    context: { kind: "profile" },
    transcribe,
    report: dictationReporter("feedback-reply"),
    ...(active ? { keep: keepDictation(keeper) } : {}),
    /* A double press on Stop also sends (dictation.md), by the same guarded
       function the button calls, and never from a box out of sight. */
    onDone: trySend,
    doneKey: active ? doneKey.seen : doneKey.hidden,
  });
  busyRef.current = dictate.busy;
  const { armed, toggle } = dictate.dictation;
  const stoppedOutOfSight = useRef(false);
  useEffect(() => {
    if (active) {
      stoppedOutOfSight.current = false;
    } else if (armed && !stoppedOutOfSight.current) {
      /* The retained box can render more than once while hidden (for example
         when the fetched lists are forgotten on close). Ask the recorder to
         stop once for that departure, not once per render. */
      stoppedOutOfSight.current = true;
      toggle();
    }
  }, [active, armed, toggle]);

  /* ⌘/Ctrl+Enter sends, and goes no further: the dialog's own handler is for
     the Write form. */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    event.stopPropagation();
    trySend();
  };

  return (
    <div className={className === undefined ? "fb-reply" : `fb-reply ${className}`}>
      <textarea
        ref={box}
        className="fb-input fb-reply-input"
        rows={5}
        aria-label={label}
        value={value}
        readOnly={dictate.readOnly || sending}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
      {over ? (
        <span className="fb-over">
          {value.length} characters — the limit is {cap}.
        </span>
      ) : null}
      <div className="fb-reply-actions">
        {dictate.dictation.supported && (
          <DictationButton
            dictation={dictate.dictation}
            toggle={dictate.toggle}
            disabled={sending}
            sendingAfter={dictate.sendingAfter}
            doubleStop={dictate.doubleStop}
          />
        )}
        <button
          type="button"
          className="fb-copy fb-reply-send"
          disabled={sending || held || dictate.busy || over || value.trim() === ""}
          onClick={trySend}
        >
          {sending ? <LoaderCircle className="cmt-spinner" size={14} aria-hidden="true" /> : null}
          {sendWord}
        </button>
        {children}
      </div>
      <DictationStrip dictation={dictate.dictation} sendingAfter={dictate.sendingAfter} />
      {problems.map((problem, index) =>
        problem === null ? null : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of slots, one per kind of failure
          <p key={index} className="fb-shot-problem" role="alert">
            {problem}
          </p>
        ),
      )}
    </div>
  );
}
