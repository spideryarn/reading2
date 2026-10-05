/**
 * **What a row in Chat's list of conversations calls its conversation** —
 * plan 261005h.
 *
 * > In chat mode, when I'm looking at it in portrait mode on an iPhone, it
 * > truncates both the thread title and the first response a little bit too
 * > aggressively, so it's quite hard to tell what each chat's really about.
 * >
 * > — Greg, 2026-10-05 (`spya-svsbae`)
 *
 * The stylesheet was not what cut the title. A conversation's stored title is
 * the first sixty characters of its first question and a `…` (`titleFrom` in
 * src/chat-title.ts), so two questions that open alike are stored alike, and
 * the row had nothing longer to draw. The question itself is in the thread, so
 * the list reads it from there. Nothing stored changes, which is why
 * conversations made before this get the longer row too.
 */
import { titleFrom } from "../chat-title.js";
import type { ChatThread } from "../types.js";

/**
 * The most of a first question a row puts in the page. The stylesheet's line
 * clamp is what a reader meets first (styles/mode-band.css); this only stops a
 * pasted page becoming a list item.
 */
export const ROW_TITLE_MAX = 240;

/**
 * The first question in full, when the title is only its cut-off start;
 * otherwise the title.
 *
 * **Exactly the server's cut, not any prefix** (GPT Sol, plan review): a
 * reader who renames a conversation to `Explain…` has named it, and a looser
 * test would have drawn their question back over the name. A rename that is
 * character for character what `titleFrom` would have made cannot be told
 * from no rename, and gets the question — which is what it abbreviates.
 */
export function rowTitle(thread: Pick<ChatThread, "title" | "messages">): string {
  const { title } = thread;
  const first = thread.messages.find((m) => m.role === "user");
  if (!first || !title.endsWith("…") || titleFrom(first.text) !== title) return title;
  const question = first.text.replace(/\s+/g, " ").trim();
  if (question.length <= ROW_TITLE_MAX) return question;
  /* A UTF-16 cut can land between an emoji's surrogate pair. Drop the first
     half rather than drawing the replacement character before the ellipsis. */
  const cut = question.slice(0, ROW_TITLE_MAX).replace(/[\uD800-\uDBFF]$/, "");
  const space = cut.lastIndexOf(" ");
  return `${space > title.length ? cut.slice(0, space) : cut}…`;
}
