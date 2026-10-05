/**
 * **Where a row in Chat's list came from**, for its icon and tooltip
 * (plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D5).
 *
 * One pure function, so the order of the rules is in one place. Today it has
 * one rule: a stored origin. The plan's next stage adds the rest in this
 * order after it: a Remember kind, then an anchor, then a plain chat.
 *
 * `mode` is the mode whose icon the row wears (docs/project/icons.md: a
 * control that takes you into a mode uses that mode's icon). The icon itself
 * is chosen where it is drawn, so this file imports no component.
 */
import type { ThreadOrigin } from "../types.js";

export interface ThreadSource {
  mode: ThreadOrigin["mode"];
  /** The tooltip's first line. */
  label: string;
  /** The item's words when the chat started, for the tooltip's second line. */
  quote: string;
}

/** What the tooltip says for a chat started from one of Debate's claims. */
export const SOURCE_DEBATE_CLAIM = "Started from a claim in Debate";

export function threadSource(thread: { origin?: ThreadOrigin }): ThreadSource | null {
  const { origin } = thread;
  if (!origin) return null;
  switch (origin.mode) {
    case "debate":
      return { mode: "debate", label: SOURCE_DEBATE_CLAIM, quote: origin.quote };
    default:
      return origin.mode satisfies never;
  }
}
