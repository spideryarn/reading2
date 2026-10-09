/**
 * **"I want my own copy", carried from a public article's link to the add page.**
 *
 * The add page asks a reader whether they would rather read the public copy
 * somebody already made of an address (plan 261009j). A reader who pressed
 * *Add a private copy to your shelf* on that public article has already
 * answered, so `PrivateCopy` (PublicChrome.tsx) marks the address here as its
 * link is pressed, and the add page takes the mark once for that address and
 * posts `ownCopy: true` straight away.
 *
 * **Module state, not the URL.** The query string and fragment of an `/add/`
 * address belong to the pasted URL (router.ts § `addUrlFrom`), so the intent
 * cannot ride there. A link opened in a new tab loses the mark, and that reader
 * is asked: a redundant question, never a wrong charge.
 *
 * One address at a time, and only for a minute, so a mark nobody took does not
 * answer a paste of the same address much later.
 */

import { normaliseUrl } from "../ingest.js";

const FRESH_MS = 60_000;

let marked: { url: string; at: number } | null = null;

/** The address `addHref` was built from, compared as the add page normalises it. */
export function markOwnCopy(url: string): void {
  marked = { url: normaliseUrl(url), at: Date.now() };
}

/** Whether the add page at this address was asked for an own copy. Answers true once. */
export function takeOwnCopyIntent(url: string): boolean {
  const mark = marked;
  if (mark === null || mark.url === "" || mark.url !== normaliseUrl(url) || Date.now() - mark.at > FRESH_MS) return false;
  marked = null;
  return true;
}
