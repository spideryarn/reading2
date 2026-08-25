import { useEffect, useState } from "react";

/**
 * "Has this been going long enough to be worth mentioning?"
 *
 * The rule is the original app's, and it is the one people get wrong most
 * often (docs/project/original-version/design-system.md § Loading states):
 *
 * > Under 1 second: No loading indicator needed (distracting)
 * > 1-2 seconds: Simple spinner with minimal text
 *
 * A spinner that appears and vanishes inside 200ms is worse than nothing,
 * because the flicker reads as breakage rather than as progress. On a warm
 * cache almost every fetch in this app finishes inside that window, so the
 * indicator was pure flicker in the common case and only useful in the rare
 * one.
 *
 * Returns false while `active` is true but has not yet lasted `delayMs`, and
 * true after. Goes back to false the moment `active` does, so a message never
 * outlives the wait it describes.
 *
 * The other half of that doc's advice — *name the step*, "Extracting with
 * Readability" rather than "Loading…" — is not something a hook can do. It
 * belongs at each call site, and every caller of this hook should be passing a
 * sentence that says what is happening.
 */

/**
 * The threshold, and **the only copy of it**.
 *
 * 600ms rather than their flat 1,000. The rule says "under 1 second: no
 * indicator", and 600 sits inside that while still clearing the flicker window
 * comfortably — on localhost almost every fetch in this app beats it, so the
 * content simply appears rather than announcing itself first.
 *
 * The number arrived here from the metadata page, which reached the same rule
 * independently and on the same day, with its own constant and its own timer.
 * That is two copies of a number that must agree — precisely the complaint the
 * metadata page's own plan makes about the two copies of `WPM = 230` it found
 * while being written. Metadata.tsx now imports this one.
 */
export const SLOW_AFTER_MS = 600;

export function useSlow(active: boolean, delayMs: number = SLOW_AFTER_MS): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    // Not `setSlow(false)` here as well: this effect re-runs whenever `active`
    // flips, and the branch above already covers the only case where it needs
    // clearing. Clearing it on every run would restart the timer's visible
    // state each time a parent re-rendered with `active` unchanged.
    const t = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);

  return slow;
}
