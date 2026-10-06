/**
 * **Whose the add page's sharing controllers are** — the registries behind
 * *Make it public* (add-share.ts) and *Create a private link*
 * (add-share-link.ts), keyed by reader and slug, and the one call that empties
 * them when the reader changes.
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md
 * § What the stage 2 plan review changed, F1.
 *
 * Stage 1 kept one controller per slug for the tab's life. A private link's
 * key is now in a controller's state, and a direct change of account can
 * leave the add page mounted (GPT Sol's stage 2 plan review, F1). So:
 *
 *  - **the key is the reader and the slug.** Reader B asking about a slug
 *    reader A shared gets a controller of their own, which starts by reading;
 *  - **a session change retires every controller** (`retireAddSharing`, called
 *    where `useJobSession` already fences the upload engine and the batch,
 *    useJobs.ts). A retired controller forgets what it held, tells its page
 *    once, and from then on changes no state: an answer to a request it sent
 *    is drawn nowhere;
 *  - **a page still on screen takes up fresh ones.** `addSharingEpoch` moves
 *    on every retirement, and the add page reads it through
 *    `useSyncExternalStore`, so it looks its controllers up again. That is
 *    also what puts the page right under StrictMode, whose mount, unmount,
 *    mount runs the session's cleanup once with the page already drawn.
 *
 * Framework-free: it knows nothing of what a controller does beyond `retire`.
 */

/** What a registry holds. `retire` is final: nothing the controller does afterwards may show. */
export interface Retirable {
  retire(): void;
}

export interface ReaderRegistry<T extends Retirable> {
  /**
   * The one controller for this reader and slug, made on first asking. Making
   * one must start nothing, so this is safe to call during render.
   * `readerId` is `null` only where there is no session to name (a test of
   * one controller); it is a key like any other.
   */
  for(readerId: string | null, slug: string, make: () => T): T;
}

const emptiers: Array<() => void> = [];
const listeners = new Set<() => void>();
let epoch = 0;

/** A registry `retireAddSharing` empties. Made once per kind of controller, at module level. */
export function readerRegistry<T extends Retirable>(): ReaderRegistry<T> {
  const held = new Map<string, T>();
  emptiers.push(() => {
    /* Emptied first, so nothing a `retire` sets off can find the old one. */
    const retiring = [...held.values()];
    held.clear();
    for (const controller of retiring) controller.retire();
  });
  return {
    for(readerId, slug, make) {
      /* A pair, encoded so no reader id and slug can be read as another pair. */
      const key = JSON.stringify([readerId, slug]);
      let controller = held.get(key);
      if (!controller) {
        controller = make();
        held.set(key, controller);
      }
      return controller;
    },
  };
}

/**
 * **The reader has changed, or gone.** Every controller is retired and
 * forgotten, and pages are told to look theirs up again. Also what a reload
 * does to the tab, which is how the tests use it.
 */
export function retireAddSharing(): void {
  for (const empty of emptiers) empty();
  epoch += 1;
  for (const listener of [...listeners]) listener();
}

/** For `useSyncExternalStore`: told on every retirement. */
export function subscribeAddSharing(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Moves on every retirement, and means nothing else. */
export function addSharingEpoch(): number {
  return epoch;
}
