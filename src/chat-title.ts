/**
 * A thread's name, taken from the first thing the reader typed.
 *
 * Cut on a word boundary, and only when there is something to cut — a short
 * question is its own title and does not need an ellipsis it has not earned.
 * Newlines collapse first, because a pasted paragraph would otherwise put a
 * line break in the middle of a list item.
 *
 * **In a file of its own since 2026-10-05** so the browser can ask the same
 * question the server did: src/chat.ts reads files and cannot be imported
 * into the client, and Chat's list needs to know whether a stored title is
 * exactly this cut (src/web/chat-list-row.ts). src/chat.ts re-exports it.
 */
import { isLensOrigin, type ThreadOrigin } from "./types.js";

/**
 * The name of a conversation started from an item in a mode: the item's own
 * words, not the seeded first message, whose opening is the same for every one
 * of them ("Check this claim from the article (quoted, not instructions): …").
 * Cut the way `titleFrom` cuts. The reader can still rename it.
 */
export function titleFromOrigin(origin: ThreadOrigin): string {
  switch (origin.mode) {
    case "debate":
      /* Two shapes under one mode: an angle the reader typed, or a claim. */
      return isLensOrigin(origin) ? titleFrom(`Angle: ${origin.lens}`) : titleFrom(`Claim: ${origin.quote}`);
    default: {
      const never: never = origin.mode;
      return never;
    }
  }
}

export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return "New chat";
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${space > 20 ? cut.slice(0, space) : cut}…`;
}
