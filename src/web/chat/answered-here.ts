/**
 * **The typed-guide answers this tab watched being written**, by reply id:
 * marked when this tab's own eligible stream delivers its `done` frame
 * (`ChatController`), never from a row loaded, recovered, or seen pending
 * after a reload. Volatile, so a reload forgets it.
 *
 * What it is for: the guide's offer to save that is marked `now` saves itself
 * only on an answer marked here, and only once per field
 * (src/web/GuideSaveOffer.tsx), so a remount, a reload or a second sight of
 * the same answer never saves it again. Plan
 * docs/plans/261011s-the-guide-saves-your-reason-and-about-you-at-once-when-the-words-are-yours.md,
 * after GPT Sol's plan review (a rendered `pending` is not a sound signal).
 */
const answered = new Set<string>();
const taken = new Set<string>();
const work = new Map<string, Promise<void>>();

const keyed = (replyId: string, key: string): string => `${replyId}\u0000${key}`;

/** This tab's stream finished the answer with this id. */
export function markAnsweredHere(replyId: string): void {
  answered.add(replyId);
}

/**
 * **True once**, for an answer this tab watched being written and a key not
 * taken before (the field, so each of an answer's two cards gets one go).
 */
export function takeAnsweredHere(replyId: string, key: string): boolean {
  if (!answered.has(replyId)) return false;
  const k = keyed(replyId, key);
  if (taken.has(k)) return false;
  taken.add(k);
  return true;
}

/**
 * Keep the autonomous write visible to another mount of the same card. A
 * PATCH cannot safely be cancelled at unmount — it may already have landed —
 * so the new card waits for this promise and then reads the store again.
 */
export function trackAnsweredHereWork(replyId: string, key: string, run: () => Promise<void>): Promise<void> {
  const k = keyed(replyId, key);
  const existing = work.get(k);
  if (existing) return existing;
  const pending = run().finally(() => {
    if (work.get(k) === pending) work.delete(k);
  });
  work.set(k, pending);
  return pending;
}

/** The autonomous write still running for this answer and field, if any. */
export function answeredHereWork(replyId: string, key: string): Promise<void> | undefined {
  return work.get(keyed(replyId, key));
}

/** For tests: forget everything. */
export function forgetAnsweredHere(): void {
  answered.clear();
  taken.clear();
  work.clear();
}
