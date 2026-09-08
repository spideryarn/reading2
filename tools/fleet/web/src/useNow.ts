/**
 * A clock that ticks, so "12s ago" becomes "13s ago" without a fetch.
 *
 * **The age on this page must move even when nothing else does.** That is the
 * whole point of it: a number frozen at "4s ago" while the poll has been dead
 * for ten minutes is precisely the failure this dashboard exists to make
 * impossible, and it is what you get if the age is only recomputed when new
 * data arrives.
 *
 * One second, and one interval for the whole page — every age is derived from
 * this single `now`, so nothing on screen can disagree with anything else about
 * what time it is.
 */
import { useEffect, useState } from "react";

export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
