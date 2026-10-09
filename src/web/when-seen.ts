/**
 * **Whether an element has come near the screen yet — once, and then for
 * good.** Plan 261009r.
 *
 * For work that only a reader looking at it needs: a Search list of 588 hits
 * shows about fifteen at a time, and formatting the words of all of them
 * (Excerpt.tsx, `lazy`) froze the page about 1.0 s longer than drawing them as
 * strings did, measured in Chrome. A row asks this, draws its plain string
 * until the answer is yes, and keeps its formatting once it has it — scrolling
 * away again undoes nothing.
 *
 * **Yes is the default, and no is something this does to one element at a
 * time**, the rule reveal-once.ts follows: with no `IntersectionObserver`
 * (jsdom, an old browser), one that throws, or a caller that has not asked,
 * the answer is yes at once, so every way this fails formats the row rather than leaving it a
 * string.
 *
 * One observer for the page, however many rows ask: an observer per row is
 * 588 observers for one search.
 */
import { type RefObject, useEffect, useState } from "react";

/**
 * How far off screen a row starts being formatted, so that while scrolling it
 * usually is before it arrives. `rootMargin` reaches past the window only;
 * the list scrolls inside the band, which `scrollMargin` reaches past where
 * the browser has it (and is ignored where it does not).
 */
const MARGIN = "400px 0px";

type Seen = () => void;

let observer: IntersectionObserver | null = null;
/** The constructor `observer` came from — a test swaps the global for its own. */
let madeWith: typeof IntersectionObserver | null = null;
const waiting = new Map<Element, Seen>();

function shared(): IntersectionObserver {
  if (!observer || madeWith !== IntersectionObserver) {
    const made = new IntersectionObserver(
      (entries, self) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const seen = waiting.get(entry.target);
          self.unobserve(entry.target);
          waiting.delete(entry.target);
          seen?.();
        }
      },
      { rootMargin: MARGIN, scrollMargin: MARGIN } as IntersectionObserverInit,
    );
    observer = made;
    madeWith = IntersectionObserver;
  }
  return observer;
}

/** `true` once `ref`'s element has come within `MARGIN` of the screen; `true` at once unless `enabled`. */
export function useSeenOnce(ref: RefObject<Element | null>, enabled: boolean): boolean {
  const watch = enabled && typeof IntersectionObserver !== "undefined";
  const [seen, setSeen] = useState(!watch);
  useEffect(() => {
    if (seen) return;
    /* `false` is the eager fallback, not a pause. Once this hook has answered
       yes it may not take that answer back if the caller enables watching
       later (for example, when an excerpt's block returns to its index). */
    if (!watch) {
      setSeen(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let io: IntersectionObserver;
    try {
      io = shared();
      /* Register before `observe`: native callbacks are queued, but this also
         makes a synchronous polyfill fail visible rather than losing yes. */
      waiting.set(el, () => setSeen(true));
      io.observe(el);
    } catch {
      waiting.delete(el);
      setSeen(true);
      return;
    }
    return () => {
      waiting.delete(el);
      io.unobserve(el);
    };
  }, [ref, seen, watch]);
  return seen || !watch;
}
