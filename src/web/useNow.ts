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
 */
import { useEffect, useState } from "react";

const A_MINUTE = 60_000;

export function useNow(everyMs: number = A_MINUTE): number {
  // The initialiser is a function, so the clock is read once at mount rather
  // than on every render and thrown away.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);

  return now;
}
