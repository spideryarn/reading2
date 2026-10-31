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
import { isSituateOverviewId, summaryLevelOf, type ThreadOrigin } from "./types.js";

/**
 * The name of a conversation started from an item in a mode: the item's own
 * words, not the seeded first message, whose opening is the same for every one
 * of them ("Check this claim from the article (quoted, not instructions): …").
 * Cut the way `titleFrom` cuts. The reader can still rename it.
 */
export function titleFromOrigin(origin: ThreadOrigin): string {
  switch (origin.mode) {
    case "reception":
      /* A question asked in Sources › Investigate, typed or suggested, which is why
         not *Angle:* any more: a suggested question is not the reader's angle
         (GPT Sol's F6 on plan 261020n). An older angle chat keeps the title
         it was given. */
      return titleFrom(`Question: ${origin.lens}`);
    case "sources-claims":
      return titleFrom(`Claim: ${origin.quote}`);
    case "glossary":
      return titleFrom(`Glossary: ${origin.quote}`);
    case "bibliography":
      return titleFrom(`Cited work: ${origin.quote}`);
    case "ideas":
      return titleFrom(`Idea: ${origin.quote}`);
    /* The work's title: the question is the same for every one of them. */
    case "cite-check":
      return titleFrom(`Does it say that? ${origin.quote}`);
    case "quiz":
      return titleFrom(`Quiz: ${origin.quote}`);
    /* A finding's passage, or the overview's model-written snapshot. */
    case "situate":
      return titleFrom(isSituateOverviewId(origin.itemId) ? `Where it sits: ${origin.quote}` : `Finding: ${origin.quote}`);
    /* The digest's words, or one paragraph's (plan 261030b). */
    case "sources-digest":
      return titleFrom(`Digest: ${origin.quote}`);
    /* The level's name, then its opening words. */
    case "summary":
      return titleFrom(`${summaryLevelOf(origin.itemId) === "fuller" ? "Fuller" : "Brief"} summary: ${origin.quote}`);
    default: {
      const never: never = origin;
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
