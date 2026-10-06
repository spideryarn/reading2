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
import { type FocusEvent, type PointerEvent, useEffect, useRef, useState } from "react";
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

/**
 * **The clock of a thing that goes by itself, and not while it is being read.**
 * It calls `onGone` after `ms`; it stops while a pointer is over the element
 * or focus is inside it, and resumes with only the time that was left. Spread
 * what it returns on the element.
 *
 * Shared by the toast and Marginalia's narrow-window line
 * (marginalia/MarginaliaColumn.tsx § `NarrowLine`), so there is one clock.
 *
 * **Pointer events, and a finger does not count as hovering.** A tap fires the
 * hover family too, and nothing need say it has left until the next tap
 * elsewhere, so a touch that stopped the clock could stop it for good
 * (docs/project/touch.md § a lift fires the hover events too; GPT Sol's F4 on
 * plan 261006i). A finger that wants it gone has the close button.
 */
export function useGoesByItself(ms: number, onGone: () => void) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  /* The latest callback, so a parent re-rendering with a fresh closure does not
     restart the clock. */
  const gone = useRef(onGone);
  gone.current = onGone;

  /** What is left on the clock; spent down each time it is paused. */
  const remaining = useRef(ms);
  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => gone.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused]);

  return {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch") setHovered(true);
    },
    onPointerLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: (e: FocusEvent<HTMLElement>) => {
      /* Focus moving between two things inside the element is not leaving it. */
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
    },
  };
}

function ToastCard({ text, onDismiss }: { text: string; onDismiss(): void }) {
  const reading = useGoesByItself(TOAST_MS, onDismiss);
  return (
    <div className="toast" {...reading}>
      <Check className="toast-icon" size={16} aria-hidden="true" />
      <p className="toast-text">{text}</p>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
