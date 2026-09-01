/**
 * The current time, re-read slowly, so relative dates stay true.
 *
 * "3 minutes ago" written once at mount is wrong five minutes later, and a
 * reader who leaves the shelf open — which is what a shelf is for — watches it
 * quietly rot. So the clock is read on a timer rather than at render.
 *
 * **Read once per render and passed down**, never called separately by each
 * thing that prints a date: two `Date.now()` calls in one paint can straddle a
 * minute boundary and put "2 minutes ago" on the card and "3 minutes ago" in
 * the table for the same article.
 *
 * A minute is the right interval because it is the smallest unit anything here
 * prints. Anything faster re-renders the shelf for no visible change; anything
 * slower shows a stale number for longer than the number's own precision.
 *
 * **`null` turns the clock off**, for a surface whose value nothing currently
 * reads — a finished job card, a band behind an idle button. Two callers wanted
 * that and both wrote `useNow(86_400_000)` with a comment calling it "one timer
 * that never fires". It fires: once a day, for the life of the tab, per card.
 * Harmless, and not what the comment said, which is the part worth fixing — a
 * comment nothing measures is a perfectly good reason to believe something
 * false. GPT Sol, 2026-09-01: *"supporting a disabled interval would be
 * cleaner."*
 */
import { useEffect, useState } from "react";

const A_MINUTE = 60_000;

export function useNow(everyMs: number | null = A_MINUTE): number {
  // The initialiser is a function, so the clock is read once at mount rather
  // than on every render and thrown away.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    /* **Not while the tab is hidden.** "3 minutes ago" going stale matters
       only to somebody reading it, and nobody is: this hook exists so a shelf
       left open does not quietly rot, and a shelf in a background tab is not
       being looked at to rot in front of. Left running it re-rendered the whole
       library once a minute, all night, to change no pixel anybody saw.

       The catch-up on return is the whole reason this is safe. Coming back
       reads the clock immediately rather than up to a minute later, so the
       reader never sees the stale number the pause created — which is the one
       failure this could have introduced, and the one it must not. */
    const tick = () => setNow(Date.now());
    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      if (everyMs === null) return;
      if (timer === undefined) timer = setInterval(tick, everyMs);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      /* **Nothing to catch up on when the clock is off**, and reading it here
         would be worse than a no-op: it would re-render every idle card in the
         app each time the reader came back to the tab, which is the cost this
         whole branch exists to avoid. */
      if (everyMs === null) return;
      tick();
      start();
    };

    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [everyMs]);

  return now;
}
