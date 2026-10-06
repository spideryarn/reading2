/**
 * **The thorough searches this browser started by itself, remembered across a
 * reload** — plan 261004l § Follow-up, for Greg's Q-reload.
 *
 * A quick row's thorough search is swapped in only by the tab that asked,
 * while Search mode stays open (auto-thorough.ts). Leave, reload or close the
 * tab mid-search and the server keeps both rows. Which thorough row belongs to
 * which quick row is known only to the hook that launched it, and the saved
 * rows cannot say: a reader who asks quick and thorough for the same words by
 * hand, and ticks them their own way, leaves the very same two rows. So the
 * pair is written here when it is launched and forgotten when it is settled,
 * and the next load of the list tidies only the pairs still written.
 *
 * **One key per pair, named by the thorough row's id.** Not one key holding a
 * list: two tabs each reading the list, changing it and writing it back can
 * put a forgotten pair back, and a forgotten pair that returns has a later
 * load delete a quick row the reader kept (GPT Sol's code review, R1). With a
 * key each, forgetting is one `removeItem` and nothing another tab writes can
 * undo it.
 *
 * **Per browser, and per reader.** A pair left behind on one device is not
 * tidied on another; both rows stay there, which is what happened everywhere
 * before this. And since 2026-10-06 each record says whose it is (`readerId`),
 * because two readers can use one browser profile and a record holds the
 * words one of them searched for. Everything here answers for one reader:
 *
 * - **Another reader's record is never returned and never removed.** It is
 *   theirs to tidy when they come back, so signing out clears nothing. Their
 *   words do stay in storage meanwhile; they are handed to no code running as
 *   anybody else.
 * - **The key does not change**, and does not need the reader in it: a row id
 *   is the server's and belongs to one reader, and one key per pair is the
 *   property the paragraph above is about.
 * - **A record with no reader, written before that day, is removed when it is
 *   read**, not adopted: it holds somebody's words and cannot say whose. The
 *   price is the one already documented, a pair not tidied after a reload.
 *
 * docs/project/auth.md § Browser storage that is a reader's is keyed by that
 * reader; docs/plans/261006h-browser-storage-keyed-by-reader-and-the-feedback-switch-test.md.
 *
 * **Everything unreadable is read as no pairs**, so storage that throws, or
 * holds something else, leaves the list alone. Nothing here is trusted
 * further than that: `tidyPair` checks each record against the loaded rows
 * before anything is deleted. The one failure not covered: a `removeItem`
 * that throws leaves its record, in a storage that can still be read later.
 */
import { storageReader } from "../../lib/storage-reader.js";

/** Each pair is stored under this prefix followed by its thorough row's id. */
export const THOROUGH_PAIR_PREFIX = "spya.search.thoroughPair.";

export interface StoredPair {
  /** Whose pair this is: `storageReader` of the reader who launched it. */
  readerId: string;
  slug: string;
  quickId: string;
  /** The thorough row, by the id the server is using. */
  meaningId: string;
  /** The trimmed words both were asked with. */
  words: string;
}

/** A record as written before 2026-10-06, or since: everything but whose it is. */
function isPairShaped(value: unknown): value is Omit<StoredPair, "readerId"> & { readerId?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.slug === "string" &&
    typeof v.quickId === "string" &&
    typeof v.meaningId === "string" &&
    typeof v.words === "string"
  );
}

/**
 * Every readable record of this reader's, in no particular order. A legacy
 * record met on the way is removed (the module comment's last bullet).
 */
function all(readerId: string | null): StoredPair[] {
  const reader = storageReader(readerId);
  const pairs: StoredPair[] = [];
  const legacy: string[] = [];
  try {
    const store = window.localStorage;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key?.startsWith(THOROUGH_PAIR_PREFIX)) continue;
      try {
        const parsed: unknown = JSON.parse(store.getItem(key) ?? "null");
        // The key is the identity: a record filed under another id is not believed.
        if (!isPairShaped(parsed) || key !== THOROUGH_PAIR_PREFIX + parsed.meaningId) continue;
        if (typeof parsed.readerId !== "string") legacy.push(parsed.meaningId);
        else if (parsed.readerId === reader) pairs.push({ ...parsed, readerId: parsed.readerId });
      } catch {
        // Not JSON: not a pair.
      }
    }
  } catch {
    return [];
  }
  // After the walk: removing a key while counting through them skips one.
  for (const meaningId of legacy) drop(meaningId);
  return pairs;
}

function drop(meaningId: string): void {
  try {
    window.localStorage.removeItem(THOROUGH_PAIR_PREFIX + meaningId);
  } catch {
    // See the last paragraph of the module comment.
  }
}

function put(pair: StoredPair): void {
  try {
    window.localStorage.setItem(THOROUGH_PAIR_PREFIX + pair.meaningId, JSON.stringify(pair));
  } catch {
    // Storage is full or refused: this pair is not tidied after a reload, as before.
  }
}

/**
 * Is the record under this id somebody else's? Only a record that says so,
 * readably: nothing there, something unreadable and a legacy record are all
 * this reader's to remove.
 */
function anothers(meaningId: string, reader: string): boolean {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(THOROUGH_PAIR_PREFIX + meaningId) ?? "null");
    return isPairShaped(parsed) && typeof parsed.readerId === "string" && parsed.readerId !== reader;
  } catch {
    return false;
  }
}

export interface StoredPairs {
  /** This reader's pairs for this article. */
  of(slug: string): StoredPair[];
  add(pair: Omit<StoredPair, "readerId">): void;
  /**
   * The pair this thorough row is half of is not to be tidied: settled,
   * thrown away, or chosen by the reader. Does nothing for any other row.
   */
  forget(meaningId: string): void;
  /**
   * This row, quick or thorough, is about to stop being the answer that was
   * recorded: revised, retried or deleted. Called at the gesture rather than
   * left to the effect that notices the change, because a revision and
   * leaving Search mode can land in one batch, and then no effect runs
   * (GPT Sol's code review, R2).
   *
   * **A row that `begin` answers under another id is invalidated too, not
   * followed.** Following means reading the record and writing it back under
   * the new id, and a tab that forgets it in between has its forgetting
   * undone (the same review, S1). It is rare, and the price is one pair not
   * tidied after a reload.
   */
  invalidate(id: string): void;
}

/**
 * **One reader's pairs**: every verb reads, writes and removes that reader's
 * records and nobody else's. Made per reader rather than taking the reader as
 * an argument of each verb, so no caller can leave it off one of them.
 *
 * `forget` and `invalidate` check whose a record is before removing it. A row
 * id is minted at random in the browser (`mintId`), so it is not unique across
 * readers by construction, only in practice; without the check a collision
 * would remove another reader's record.
 */
export function storedPairsFor(readerId: string | null): StoredPairs {
  const reader = storageReader(readerId);
  const forget = (meaningId: string): void => {
    if (!anothers(meaningId, reader)) drop(meaningId);
  };
  return {
    of: (slug) => all(readerId).filter((p) => p.slug === slug),
    add: (pair) => {
      // Never over another reader's record, for the reason above.
      if (!anothers(pair.meaningId, reader)) put({ ...pair, readerId: reader });
    },
    forget,
    invalidate(id) {
      forget(id);
      for (const pair of all(readerId)) if (pair.quickId === id) drop(pair.meaningId);
    },
  };
}
