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
 * One address at a time, and only for a minute. A reader change or arrival at a
 * different add address clears it, so an interrupted navigation cannot answer a
 * later reader's or later paste's choice.
 */

import { normaliseUrl } from "../ingest.js";
import { forgetOnReaderChange } from "./lib/reader-change.js";

const FRESH_MS = 60_000;

let marked: { url: string; at: number } | null = null;

/* An intent belongs to the reader who pressed the public article's link. A
   second reader in the same tab must never inherit a choice that spends one of
   their articles. */
forgetOnReaderChange(() => {
  marked = null;
});

/** The address `addHref` was built from, compared as the add page normalises it. */
export function markOwnCopy(url: string): void {
  marked = { url: normaliseUrl(url), at: Date.now() };
}

/** Whether the add page at this address was asked for an own copy. Answers true once. */
export function takeOwnCopyIntent(url: string): boolean {
  const mark = marked;
  /* Any Add-page arrival consumes the one-shot. If it is for another address,
     the intended navigation was interrupted or superseded; leaving the mark
     behind could turn a later ordinary paste into a paid own-copy request. */
  marked = null;
  return mark !== null && mark.url !== "" && mark.url === normaliseUrl(url) && Date.now() - mark.at <= FRESH_MS;
}
