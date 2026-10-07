/**
 * **Whether this mount of the reading view plays the bottom bar's entrance** —
 * absent for a second, then it fades and rises (styles/dock.css § the
 * entrance). Greg, 2026-10-06 (spya-dest8x):
 *
 * > One might be to draw a little bit of attention to the bottom bar, because
 * > obviously that's critical. So perhaps it appears, maybe it fades in or
 * > slowly rises to the top when the page, the article first loads after a
 * > second, so that the page can load and then it draws their eye to it.
 *
 * **Once per page load: the first `Reader` mount in this tab's JavaScript
 * lifetime**, for an owner or a signed-out visitor alike. A later article in
 * the same tab does not play it, nor does coming back from Metadata; a refresh
 * may. It was going to be once per article, and a regular opening ten articles
 * would have paid ten delays (GPT Sol, PR-6).
 * docs/plans/261007c-bottom-bar-rises-in-on-first-load-and-a-more-button-gathers-the-lesser-modes.md § D7.
 *
 * It plays for every reader, not only a new one: the client has no "new
 * reader" signal. One class to narrow or remove if that reads badly.
 */
import { useEffect, useState } from "react";

/** Has a reading view committed since this page loaded? */
let played = false;

/**
 * `true` for the whole of the first reading view's mount, `false` for every
 * mount after it.
 *
 * **The guard is read in render and written only in a committed effect.**
 * StrictMode renders twice and throws the first away, and a concurrent render
 * can be abandoned; a write during render, or in the state initialiser, would
 * spend the entrance on a render nobody saw (GPT Sol, PR-7).
 * tests/dock-entrance.test.tsx mounts under `<StrictMode>` for this — and
 * also reads this file's text, because StrictMode in jsdom keeps the first
 * result of a state initialiser, so a write inside one passes every rendered
 * case there while still being wrong for an abandoned render.
 *
 * **State, not a bare read**, so the answer holds for the life of the mount:
 * the class must stay on the bar after the effect has run, or the next render
 * would take it off mid-animation.
 */
export function useDockEntrance(): boolean {
  const [enter] = useState(() => !played);
  useEffect(() => {
    played = true;
  }, []);
  return enter;
}

/** The suite shares one module across cases; a page load does not. */
export function resetDockEntranceForTests(): void {
  played = false;
}
