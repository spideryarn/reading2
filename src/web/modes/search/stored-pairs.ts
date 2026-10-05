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
 * **Per browser.** A pair left behind on one device is not tidied on another;
 * both rows stay there, which is what happened everywhere before this.
 *
 * **Everything unreadable is read as no pairs**, so storage that throws, or
 * holds something else, leaves the list alone. Nothing here is trusted
 * further than that: `tidyPair` checks each record against the loaded rows
 * before anything is deleted. The one failure not covered: a `removeItem`
 * that throws leaves its record, in a storage that can still be read later.
 */

/** Each pair is stored under this prefix followed by its thorough row's id. */
export const THOROUGH_PAIR_PREFIX = "spya.search.thoroughPair.";

export interface StoredPair {
  slug: string;
  quickId: string;
  /** The thorough row, by the id the server is using. */
  meaningId: string;
  /** The trimmed words both were asked with. */
  words: string;
}

function isStoredPair(value: unknown): value is StoredPair {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.slug === "string" &&
    typeof v.quickId === "string" &&
    typeof v.meaningId === "string" &&
    typeof v.words === "string"
  );
}

/** Every readable record, in no particular order. */
function all(): StoredPair[] {
  const pairs: StoredPair[] = [];
  try {
    const store = window.localStorage;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key?.startsWith(THOROUGH_PAIR_PREFIX)) continue;
      try {
        const parsed: unknown = JSON.parse(store.getItem(key) ?? "null");
        // The key is the identity: a record filed under another id is not believed.
        if (isStoredPair(parsed) && key === THOROUGH_PAIR_PREFIX + parsed.meaningId) {
          pairs.push(parsed);
        }
      } catch {
        // Not JSON: not a pair.
      }
    }
  } catch {
    return [];
  }
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

export const storedPairs = {
  /** The pairs written for this article. */
  of: (slug: string): StoredPair[] => all().filter((p) => p.slug === slug),
  add: put,
  /**
   * The pair this thorough row is half of is not to be tidied: settled,
   * thrown away, or chosen by the reader. Does nothing for any other row.
   */
  forget: drop,
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
  invalidate(id: string): void {
    drop(id);
    for (const pair of all()) if (pair.quickId === id) drop(pair.meaningId);
  },
};
