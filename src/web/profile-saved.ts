/**
 * **The reader saved something about themselves** — *About you* or an
 * article's *why you're reading this* — said once, for whatever in this tab
 * was made from the old words.
 *
 * Two things were, and both forget here:
 *
 *  - **the link cards' summaries**, cached per tab
 *    (link-facts.ts § `forgetSummaries`), which until 2026-10-05 each of the
 *    four save functions called for itself;
 *  - **the command bar's short list from why you are reading**
 *    (CommandBar.tsx, plan 261005k, GPT Sol's F3), which a model wrote from
 *    both boxes. `usePurpose` reads once per slug and so cannot tell the bar
 *    that either changed; this can.
 *
 * So the save functions call `profileSaved()` and nothing else, and a third
 * thing made from the profile subscribes here rather than becoming a fifth
 * line in each of them. Callers: purpose.ts § `savePurpose`, `leavePurpose`;
 * useProfile.ts § `saveProfile`, `leaveProfile`.
 *
 * **A count, not an event with a payload.** A listener learns that something
 * changed and reads what it needs again: the two leaving saves fire before
 * the server has answered and again after, and a payload would have to say
 * which.
 *
 * **This tab only.** A save made in another tab or on another device is not
 * heard; the bar finds that out the next time it reads the profile.
 */
import { forgetSummaries } from "./link-facts.js";

let generation = 0;
const listeners = new Set<() => void>();

/** Say that the profile or a reason for reading was saved, or is on its way. */
export function profileSaved(): void {
  forgetSummaries();
  generation += 1;
  for (const listener of [...listeners]) listener();
}

/** How many saves this tab has made. Changes exactly when `profileSaved` is called. */
export function profileGeneration(): number {
  return generation;
}

/** Be told of every save. `useSyncExternalStore`'s shape: returns the way to stop. */
export function onProfileSaved(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
