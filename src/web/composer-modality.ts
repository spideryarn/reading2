/**
 * **How the words in a chat box got there** — typed, dictated, or both — so
 * the question can be stored with its `modality` (report spya-z30x5n;
 * docs/plans/261011z-chat-messages-record-how-they-were-made.md).
 *
 * The box knows two writers apart because they are two callbacks: the
 * textarea's own `onChange` is the reader's keyboard (and paste, IME, undo),
 * and `useDictationField`'s `onChange` is a dictation landing. This only keeps
 * score of which has run since the box was last empty.
 *
 * **A box that began non-empty is `seeded`**, and its question is unrecorded
 * rather than guessed: a handed-over quote or a restored draft followed by one
 * keystroke is not a typed question, and we did not see those words arrive.
 * Emptying the box — a send, Escape, a select-all delete — starts a fresh
 * draft whose provenance we do see.
 */
import type { ComposerModality } from "../types.js";

export interface DraftProvenance {
  readonly dictated: boolean;
  readonly typed: boolean;
  readonly seeded: boolean;
}

/** A draft starting from `text`: seeded unless it is empty. */
export function freshProvenance(text: string): DraftProvenance {
  return { dictated: false, typed: false, seeded: text !== "" };
}

/** The box's value became `next`, written by the keyboard or by a dictation. */
export function afterChange(
  was: DraftProvenance,
  next: string,
  by: "keyboard" | "dictation",
): DraftProvenance {
  if (next === "") return freshProvenance("");
  return by === "keyboard" ? { ...was, typed: true } : { ...was, dictated: true };
}

/** What the question is stored as, or null when it cannot honestly be said. */
export function composerModality(p: DraftProvenance): ComposerModality | null {
  if (p.seeded) return null;
  if (p.dictated && p.typed) return "mixed";
  if (p.dictated) return "dictated";
  if (p.typed) return "typed";
  return null;
}
