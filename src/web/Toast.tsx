/**
 * **A toast: one short message in the bottom corner that goes by itself.**
 *
 * Greg, 2026-09-29, about the Feedback dialog's thank-you:
 *
 * > Remove "It is filed" from the post-Feedback message. And in fact, that
 * > post-Feedback message should be a toast in the corner that disappears after
 * > a few seconds, rather than a blocking modal.
 *
 * FeedbackDialog.tsx is the one caller, so this is deliberately small: one
 * message at a time, no queue, no provider, no portal. A library (`sonner`) was
 * the simpler-to-write option passed over — one message from one caller does
 * not earn a dependency.
 * docs/plans/260929f-feedback-thank-you-as-a-toast-and-dictation-that-never-runs-out-of-tape.md
 * § Part A.
 *
 * What it promises, each pinned in tests/toast.test.tsx:
 *
 * - **It announces without stealing focus.** `role="status"` and
 *   `aria-live="polite"`, on a region that is in the document *before* anything
 *   is said in it — a live region inserted together with its words is often
 *   not announced at all.
 * - **It goes after `TOAST_MS`**, and **not while it is being read**: the clock
 *   stops while the pointer is over it or focus is inside it, and resumes with
 *   only the time that was left.
 * - **It has a close button**, for a reader who has read it and wants it gone.
 * - **A new message starts the clock again**, because it is keyed on `id`.
 *
 * No animation under `prefers-reduced-motion`: the stylesheet only animates
 * inside `(prefers-reduced-motion: no-preference)` (feedback.css § the toast).
 */
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

/** About five seconds — long enough to read two short sentences. */
export const TOAST_MS = 5000;

/** `id` distinguishes two messages with the same words, so each gets its own clock. */
export interface ToastMessage {
  id: number;
  text: string;
}

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss(): void;
}) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast ? <ToastCard key={toast.id} text={toast.text} onDismiss={onDismiss} /> : null}
    </div>
  );
}

function ToastCard({ text, onDismiss }: { text: string; onDismiss(): void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  /* The latest callback, so a parent re-rendering with a fresh closure does not
     restart the clock. */
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  /** What is left on the clock; spent down each time it is paused. */
  const remaining = useRef(TOAST_MS);
  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => dismiss.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pointer and focus handlers only pause the clock while the card is being read; they do nothing a reader acts on, and the one control inside is a real button.
    <div
      className="toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        /* Focus moving between two things inside the card is not leaving it. */
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <Check className="toast-icon" size={16} aria-hidden="true" />
      <p className="toast-text">{text}</p>
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss"
        onClick={() => dismiss.current()}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
