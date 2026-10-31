/**
 * **The ask box**: one line for the reader's own question, and a button with
 * Chat's two bubbles that hands it on. Enter or the button gives the words,
 * trimmed, to `onAsk`, and empties the box: the words have become a chat's
 * first question. It starts no job and has no waiting state; where the answer
 * goes is the caller's.
 *
 * Lifted from Sources › Investigate's private `QuestionBox` (plan
 * docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md
 * § The ask box) so the box under the sources digest and under Summary's
 * Brief and Fuller is the same control rather than a copy
 * (docs/project/controls.md § Controls that do the same job look the same).
 *
 * The field is Glossary's *Look up a term* (`.gloss-ask`): the same input,
 * the reader's face from voices.css, and room left for the band's (i). The
 * row wraps the button under the field in a narrow band, and the button is a
 * finger's height on a touch screen (origin-chat.css § the ask box). A
 * caller's class (`className`) adds placement only.
 */
import { MessagesSquare } from "lucide-react";
import { useState } from "react";

import { isImeComposing } from "./key-chord.js";

export interface AskBoxProps {
  /** The trimmed, non-empty words, on Enter or the button. */
  onAsk(words: string): void;
  /**
   * The most the field takes, counted before trimming, so the box refuses
   * only what the receiver would refuse, or a little more: the harmless
   * direction (GlossaryPanel.tsx § `AskATerm`).
   */
  maxLength: number;
  placeholder: string;
  /** The field's accessible name. */
  label: string;
  /** The button's words. */
  send: string;
  /** The button's tooltip: what a press does. */
  tip: string;
  className?: string;
}

export function AskBox({ onAsk, maxLength, placeholder, label, send, tip, className }: AskBoxProps) {
  const [draft, setDraft] = useState("");
  const words = draft.trim();
  return (
    <div className={className ? `gloss-ask ask-box ${className}` : "gloss-ask ask-box"}>
      <form
        className="gloss-ask-row ask-box-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (words === "") return;
          onAsk(words);
          /* The words have become a chat's first question. */
          setDraft("");
        }}
      >
        <input
          className="gloss-ask-input"
          type="text"
          /* Enter submits this form. */
          enterKeyHint="go"
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            /* Accepting an IME candidate is not a request to send. Cancel
               implicit submission, including engines that report 229 instead
               of isComposing; an ordinary Enter still uses the form. */
            if (e.key === "Enter" && isImeComposing(e)) e.preventDefault();
          }}
        />
        <button type="submit" className="gloss-btn ask-box-send" disabled={words === ""} data-tip={tip}>
          <MessagesSquare size={12} aria-hidden="true" />
          {send}
        </button>
      </form>
    </div>
  );
}
