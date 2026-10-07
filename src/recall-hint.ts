/**
 * **Recall's hint: the last paragraph of an answer, kept behind a button.**
 *
 * Recall (`kind === "learn"`) ends most replies with a question, and the
 * model writes a hint for it in the same reply, as a last paragraph beginning
 * `Hint:`. The stored text is what the model wrote, hint and all; this file is
 * the one place that says which part is the hint. Shared by the server, the
 * browser and the eval, so it imports nothing but types.
 *
 * **Every deviation fails open.** `splitHint` splits only on the exact shape
 * below and otherwise returns the text whole, so a hint in a wrong spelling is
 * shown in plain sight and nothing the model wrote is ever lost.
 *
 * Greg's report `spya-fryxrf`;
 * docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md.
 */

import type { ChatMessage, ThreadKind } from "./types.js";

/** The marker the prompt asks for, exactly. `LEARN_SYSTEM` in src/converse.ts. */
export const HINT_MARKER = "Hint:";

export interface SplitHint {
  /** What is drawn as the answer. The whole text when there is no hint. */
  body: string;
  /** The hint's words without the marker, or null when nothing was split off. */
  hint: string | null;
}

/** A blank line: a newline, then at least one more with only spaces between. */
const BLANK_LINE = /\r?\n(?:[ \t]*\r?\n)+/g;

/**
 * Does the body end with a question? Its last sentence ends in `?`, and after
 * the mark only closing quotation marks, closing brackets and bracketed block
 * ids may follow. An id there is allowed and not required: whether the question
 * carries one is the eval's business, not the split's (the plan, F5).
 */
const ENDS_WITH_QUESTION =
  /[?？](?:\s*(?:\]\([^)\n]*\)|["'”’»)\]]|[*_~`]+|\[\s*(?:spya-[a-z0-9]{6}[\s,;]*)+\]))*$/;

/** Shared with the eval so a hint the panel hides is measured as a nudge there too. */
export function endsWithRecallQuestion(text: string): boolean {
  return ENDS_WITH_QUESTION.test(text);
}

/**
 * Split a Recall answer into its body and its hint.
 *
 * Splits only when all of these hold: the *final* paragraph begins exactly
 * `Hint:` straight after a blank line; the hint is not empty; and the body
 * before it ends with a question.
 */
export function splitHint(text: string): SplitHint {
  const whole: SplitHint = { body: text, hint: null };
  const trimmed = text.trimEnd();

  let last: RegExpExecArray | undefined;
  for (const match of trimmed.matchAll(BLANK_LINE)) last = match;
  if (!last) return whole;

  const final = trimmed.slice(last.index + last[0].length);
  if (!final.startsWith(HINT_MARKER)) return whole;
  const hint = final.slice(HINT_MARKER.length).trim();
  if (hint === "") return whole;

  const body = trimmed.slice(0, last.index).trimEnd();
  if (!endsWithRecallQuestion(body)) return whole;
  return { body, hint };
}

/**
 * **An answer as the reader saw it**: the body, plus the hint only if they
 * opened it. For readers of a conversation that were not there — Live's seed
 * and the `reader_notes` transcript — which must not be told the reader was
 * given a clue they never looked at.
 *
 * Recall's own later turns do **not** use this: the model sees what it wrote,
 * and its prompt says never to assume the hint was opened.
 */
export function answerAsSeen(
  message: Pick<ChatMessage, "role" | "text" | "hintOpenedAt">,
  kind: ThreadKind | undefined,
): string {
  if (kind !== "learn" || message.role !== "assistant") return message.text;
  if (message.hintOpenedAt !== undefined) return message.text;
  return splitHint(message.text).body;
}
