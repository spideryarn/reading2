/**
 * The rows this process is writing right now, counted per key.
 *
 * `pending` in the store does not mean "an answer is coming": it is written
 * before the model call so a crash leaves evidence. Only the running process
 * can tell a call in flight from one that died, so each streaming handler holds
 * a key from the pending row to the stored answer, and a sweep spares what is
 * held (src/routes.ts § `answering`, `searching`, `refereeing`, `pullingClaims`).
 *
 * **A count, not a flag and not one holder.** Two requests can hold one key: a
 * second press on a comment, a revision of a quick search, a criterion deleted
 * and re-posted, two tabs pulling claims. A flag is dropped by whichever
 * finishes first. One holder (a `Map<key, symbol>`, until plan 261005i § C) is
 * taken over by whichever *registers* last, and that is not always the newer
 * request: an older one whose `begin` answers late registers second, and its
 * exit then released the newer run's key.
 *
 * Nothing here stops or supersedes anything. It only stops a sweep from lying.
 */
export interface LiveKeys {
  /** Hold `key`. The release is idempotent: a second call releases nothing. */
  hold(key: string): () => void;
  /** Whether any request still holds `key`. */
  has(key: string): boolean;
  /** Every held key, once each. */
  keys(): IterableIterator<string>;
}

export function liveKeys(): LiveKeys {
  const held = new Map<string, number>();
  return {
    hold(key) {
      held.set(key, (held.get(key) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return; // a double release must not decrement someone else's
        released = true;
        const left = (held.get(key) ?? 1) - 1;
        if (left > 0) held.set(key, left);
        else held.delete(key);
      };
    },
    has: (key) => held.has(key),
    keys: () => held.keys(),
  };
}
