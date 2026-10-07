/**
 * **The marketing pages' fade-ins: each section rises in the first time it
 * enters the window, and then stays.** Plan 261007h, F5c.
 *
 * Until 2026-10-07 `.site-reveal` was a CSS scroll-driven animation
 * (`animation-timeline: view()`), which is reversible by nature: progress is a
 * function of scroll position, so a section you had already read faded out
 * again when you scrolled back up past it. A reveal is a one-way event, which
 * a timeline cannot express and an `IntersectionObserver` can.
 *
 * **Visible is the default, and hiding is something this script does to one
 * element at a time.** styles/site.css hides only `[data-reveal-waiting]`, an
 * attribute set here on a section that is below the window when it starts, and
 * swapped for `data-shown` (and the section unobserved) the first time it
 * crosses in. So every way this can fail to run shows everything (GPT Sol,
 * plan review R16): no `IntersectionObserver`, a reader who asked for less
 * motion, a start that throws, a section added after the script stopped, and
 * print (site.css § print overrides the hidden state outright). A root flag
 * that hid every `.site-reveal` would hide a late one nobody had observed.
 *
 * **A section already on screen at the start is never hidden**, so nothing the
 * reader is looking at blinks out and back in when the effect runs after paint.
 *
 * **Sections that arrive later are picked up** by a `MutationObserver`.
 * `PublicShowcase` currently mounts its section immediately; its fetch adds
 * articles inside that section, rather than a new reveal target.
 *
 * Returns the stop, which un-hides whatever is still waiting — the page calls
 * this from an effect (`useRevealOnce`), so a client-side move between `/`,
 * `/features` and `/pricing` tears one page's watch down and starts the next.
 * The shape is `watchBarStuck`'s (scroll.ts).
 */
import { useEffect } from "react";

const WAITING = "data-reveal-waiting";
const SHOWN = "data-shown";

export function watchReveals(root: ParentNode = document): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};

  let io: IntersectionObserver | undefined;
  let mo: MutationObserver | undefined;
  const stop = () => {
    io?.disconnect();
    mo?.disconnect();
    for (const el of root.querySelectorAll(`[${WAITING}]`)) el.removeAttribute(WAITING);
  };
  try {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.removeAttribute(WAITING);
          entry.target.setAttribute(SHOWN, "");
          observer.unobserve(entry.target);
        }
      },
      /* Use the whole viewport: even vertical percentage root margins resolve
         against its width, so an inset can erase a wide, short window's root
         or keep a section at the page's foot from ever entering it. */
    );
    io = observer;
    const take = (el: Element) => {
      if (el.hasAttribute(SHOWN) || el.hasAttribute(WAITING)) return;
      if (el.getBoundingClientRect().top < window.innerHeight) {
        el.setAttribute(SHOWN, "");
        return;
      }
      el.setAttribute(WAITING, "");
      observer.observe(el);
    };
    root.querySelectorAll(".site-reveal").forEach(take);
    if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver((records) => {
        for (const r of records) {
          for (const node of r.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (node.matches(".site-reveal")) take(node);
            node.querySelectorAll(".site-reveal").forEach(take);
          }
        }
      });
      mo.observe(root, { childList: true, subtree: true });
    }
  } catch {
    stop();
    return () => {};
  }
  return stop;
}

/** `watchReveals` over the whole document for as long as the page is mounted. */
export function useRevealOnce(): void {
  useEffect(() => watchReveals(document), []);
}
