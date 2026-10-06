/**
 * **What this tab forgets when its reader changes.**
 * docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 2.
 *
 * Some of what a reader typed or was shown is kept at module level, keyed by
 * the article's slug, so that it outlives a mode change: an unsent chat
 * question, the search words, "on your shelf". It outlives a change of reader
 * the same way, and the next reader on the same slug was shown it.
 *
 * A store calls `forgetOnReaderChange` once, at module scope.
 * [`session.ts`](./session.ts), the tab's one subscription to the SDK, calls
 * `noteReader` on every session it adopts, after it has replaced what it
 * holds and before it tells any subscriber. `useSession` is one of those
 * subscribers, so the stores are empty before React hears of the next reader.
 *
 * **A change is from a known reader to anybody else**, sign-out included. Not
 * the first event of a tab (nobody was known), not a refreshed token for the
 * same reader, and not signed-out to signed-in: what a visitor typed is
 * nobody else's.
 *
 * Imports nothing, so a store may import it without `api.ts` importing a
 * store. Not `jobEngine.epoch()`, which marks the same moment: that moves in
 * `useJobSession`'s layout effect, after the render that first saw the new
 * reader, and it would put the whole engine behind a module that holds a
 * string.
 */
const forgetters = new Set<() => void>();
let reader: string | null = null;

/** Run `forget` whenever the tab's reader changes. For module scope: never removed. */
export function forgetOnReaderChange(forget: () => void): void {
  forgetters.add(forget);
}

/** The tab's reader is now `id`, or nobody. Called by lib/session.ts § `adopt`. */
export function noteReader(id: string | null): void {
  const previous = reader;
  reader = id;
  if (previous === null || previous === id) return;
  for (const forget of [...forgetters]) {
    /* One store that throws must not leave the others holding A's words, or
       stop the session's subscribers from being told. */
    try {
      forget();
    } catch {
      // Nothing to tell anybody: the next store still has to be emptied.
    }
  }
}
