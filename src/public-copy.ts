/**
 * **Somebody else has already made this address public** — the add's second
 * question, after *"is it on your own shelf?"* and before any slot is spent.
 * Greg, 2026-10-09 (`spya-ahvk74`):
 *
 * > We should notice during the import process if a user tries to add an
 * > article that we already have as public, and ask them if they'd rather use
 * > the public one for free or have their own version which will use up one of
 * > their allotted slots.
 *
 * docs/plans/261009j-a-public-copy-offered-at-import.md.
 *
 * **No new ownerless read.** The candidates are Citations'
 * (src/store/pg-cited-in-spideryarn.ts § `citedCandidatesQuery`), whose `where`
 * is the whole defence: public and not archived, openable, a stranger's title
 * only as extracted, and a stranger's address only as `publicSourceUrl` passes
 * it. This file only matches among them, by `urlKey` — the rule a repeat paste
 * uses — and only among the ones that are not the reader's own.
 */

import { urlKey } from "./ingest.js";
import type { PublicCopyFound } from "./types.js";

/**
 * The part of a `CitedCandidate` (src/cited-in-spideryarn.ts) this reads,
 * spelled out rather than imported, because this file is on the browser's side
 * of the line too (`PublicCopyFound` is the wire) and that one is not.
 */
interface Candidate {
  slug: string;
  mine: boolean;
  urls: readonly string[];
  displayTitle: string | null;
  matchTitle: string | null;
}


/**
 * The public article at this `urlKey`, if a stranger has one. Several: the
 * first by slug, so the answer never depends on the order rows came back in.
 */
export function publicCopyAmong(
  candidates: readonly Candidate[],
  key: string,
): PublicCopyFound["publicCopy"] | undefined {
  if (key === "") return undefined;
  const match = candidates
    .filter((c) => !c.mine && c.urls.some((u) => urlKey(u) === key))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))[0];
  if (match === undefined) return undefined;
  return { slug: match.slug, title: match.displayTitle ?? match.matchTitle ?? match.slug };
}
