/**
 * **The mode the reader just pressed, named at the foot of its band for three
 * seconds.**
 *
 * > So if I'm on an iPad and I click on a mode, there's no tooltip, there's no
 * > heading, there's no explanation. Now, I don't want it to be intrusive, but
 * > there has to be some kind of indicator. So it could be that it shows the
 * > mode name at the top of the mode column for a couple of seconds …
 * >
 * > — Greg, 2026-09-12 (SPIDERYARN-READING2-3Q)
 *
 * The band's own title went on 2026-09-05 because the Dock names the mode —
 * but the Dock drops its labels whenever its row does not fit, which on an iPad
 * is always, and what a dropped label leaves behind is a hover card a finger
 * never sees. docs/plans/260915e-the-mode-names-itself-briefly-when-a-reader-opens-it.md.
 *
 * ## Bottom-left, standing on the band's foot
 *
 * > It's nice how it shows the Mode title at the top of the Mode column when
 * > clicking to a new Mode. But it gets in the way. Perhaps show it at the
 * > bottom-left (instead of the top-right) of the Mode column …
 * >
 * > — Greg, 2026-09-28
 *
 * The top was the band's first row — Search's box, Glossary's controls, the
 * first items of every list — which is what a reader who has just opened a mode
 * looks at first. But the band's literal bottom is no freer: eleven modes can
 * end in pinned furniture (Quotes' *Find more*, Chat's composer, Diagram's step row and
 * card). So the card stands **on** it, at the bottom-left of the scroller, and
 * `footRoom` below is how it knows how much room it takes.
 * docs/plans/260928a-the-mode-herald-moves-to-the-foot-of-the-band.md.
 *
 * ## What decides whether it shows is not in here
 *
 * This draws a press it is handed and says when it is finished with it.
 * **Which presses count is `Reader`'s**: a Dock button or a command-bar pick,
 * never a pasted `?mode=`, a Back step or a reload — the same *a mount is not a
 * click* line `activation.ts` draws for paid runs — and never Plain or
 * Hierarchy, which have no band to stand on.
 *
 * ## It never takes a tap
 *
 * The card is `pointer-events: none`, and **any press inside the band ends
 * it** — so the tap a reader aims at whatever the card is covering reaches that
 * thing *and* clears the card, rather than being spent on the card. Search is
 * why: its box is the band's first row and takes focus on mount, so a card that
 * caught taps would have hidden the one control the reader came for and eaten
 * their first press at it. Nothing in any band's first row acts on one tap in a
 * way that cannot be taken back — Chat's delete asks twice (`ArmedDelete`).
 * GPT Sol's plan review, 2026-09-15.
 *
 * ## Two regions, and the one a screen reader hears is always there
 *
 * **The status region is stable and carries only the sentence.** It is mounted
 * whether or not anything was pressed, because a live region inserted already
 * holding its text is not reliably announced; and the name is left out of it
 * because the Dock's radio has just announced exactly that. **The visible card
 * is `aria-hidden`** for the same reason — it is the name and the sentence
 * again. The card, not the region, is keyed on the press's nonce, so a second
 * press restarts the timer and the fade without remounting what is announced.
 */
import { useEffect, useLayoutEffect, useRef } from "react";

import { MODE_CATALOG } from "../mode-catalog.js";
import type { BandMode } from "../modes.js";
import { MODE_LABEL } from "../title-text.js";
import { keyboardInsetStyle, useVisualViewport } from "./useVisualViewport.js";

/**
 * How long the card stays, fade included — `mode-band.css` § the herald
 * spends the last sixth of it fading, and the two numbers are written as one
 * there. Three rather than Greg's *"a couple of seconds"* because it carries a
 * sentence as well as a name.
 */
export const HERALD_MS = 3000;

/** One press of a mode. `nonce` differs between two presses of the same mode. */
export interface HeraldPress {
  mode: BandMode;
  nonce: number;
}

export function ModeHerald({ press, onDone }: { press: HeraldPress | null; onDone(): void }) {
  /* **At the bottom, it has to know about iOS's keyboard.** Search focuses its
     box on mount, and WebKit leaves `position: fixed` under the keys rather than
     shrinking the layout viewport — so a card at the band's foot would be named
     to nobody. `--kb-inset` lifts it, as it lifts the three bottom-anchored
     dialogs; Chromium resizes instead and reports `0`. GPT Sol, 2026-09-28. */
  const visible = useVisualViewport(press !== null);
  return (
    <>
      <div className="sr-only" role="status">
        {press ? MODE_CATALOG[press.mode].description : ""}
      </div>
      <div className="mode-herald-slot" aria-hidden="true" style={keyboardInsetStyle(visible)}>
        {press && <Card key={press.nonce} mode={press.mode} onDone={onDone} />}
      </div>
    </>
  );
}

/**
 * **How much of the band's bottom belongs to a pinned foot**, in px: the band's
 * bottom minus the bottom of its **last child that grows**.
 *
 * Every band is a flex column whose scroller is the child with `flex: 1`, and a
 * pinned row — `ModeSurface`'s `foot`, Chat's and Remember's composer — is a
 * direct child after it. Reading the layout rather than naming the foot classes
 * is what lets a new band be right without anyone remembering this.
 * A band where nothing grows gets `0` rather than a guess: its content ends
 * where it ends, and the card goes to the band's bottom edge.
 *
 * **A grower that does not scroll is a wrapper, so look inside it.** Sketch's
 * band child is `.sk`, which grows and holds its own growing `.sk-scroll` and,
 * after it, the pinned `.sk-card` — measured at `.sk` it leaves no room and the
 * card lies on the Sketch card (GPT Sol, 2026-09-28). A grower that **does**
 * scroll is where this stops: what is inside a scroller is content, and a
 * growing item in there can run far past the band.
 */
export function footRoom(band: Element): number {
  let grows = lastGrower(band);
  if (grows === null) return 0;
  while (!scrolls(grows)) {
    const inner = lastGrower(grows);
    if (inner === null) break;
    grows = inner;
  }
  return Math.max(0, Math.round(band.getBoundingClientRect().bottom - grows.getBoundingClientRect().bottom));
}

function lastGrower(parent: Element): Element | null {
  let grows: Element | null = null;
  for (const child of parent.children) {
    if (Number.parseFloat(getComputedStyle(child).flexGrow) > 0) grows = child;
  }
  return grows;
}

function scrolls(el: Element): boolean {
  const { overflowY } = getComputedStyle(el);
  return overflowY === "auto" || overflowY === "scroll";
}

function Card({ mode, onDone }: { mode: BandMode; onDone(): void }) {
  const card = useRef<HTMLDivElement>(null);
  /* **Measured on arrival and again whenever the band changes shape**, because
     a foot can arrive after the card does: a panel's foot often renders once
     its artefact has loaded, which can be inside the three seconds. A child added
     or removed is a mutation; a composer growing a line is a resize. Written
     onto the slot as `--herald-foot`, which mode-band.css § the herald turns
     into the room under the card, and taken off again when the card goes. */
  useLayoutEffect(() => {
    const slot = card.current?.parentElement;
    if (!slot) return;
    const band = document.querySelector(".mode-band");
    const measure = () => slot.style.setProperty("--herald-foot", `${band ? footRoom(band) : 0}px`);
    measure();
    const resized = band && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    const mutated = new MutationObserver(() => {
      measure();
      watch();
    });
    const watch = () => {
      if (!band) return;
      resized?.disconnect();
      mutated.disconnect();

      /* Watch every layout level `footRoom` reads, but stop at the scroller.
         Sketch's `.sk` is the reason the direct children were not enough: its
         outer box always fills the band, while `.sk-scroll` shrinks when the
         nested `.sk-card` arrives or changes height. Observing into a scroller
         would instead turn every streaming chat token and expanding list row
         into a measurement of furniture that cannot affect the foot. */
      let parent: Element | null = band;
      while (parent) {
        resized?.observe(parent);
        mutated.observe(parent, { childList: true });
        const grows = lastGrower(parent);
        if (grows === null) break;
        for (const child of parent.children) resized?.observe(child);
        parent = !scrolls(grows) ? grows : null;
      }
    };
    watch();
    return () => {
      mutated.disconnect();
      resized?.disconnect();
      slot.style.removeProperty("--herald-foot");
    };
  }, []);
  /* **A ref, because `Reader` passes a fresh arrow on every render** and it
     renders on every scroll. With `onDone` in the effect's dependencies the
     timer would restart each time and a reader who kept scrolling would never
     see it go. The timer belongs to the press, which is what the key says. */
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const timer = setTimeout(() => done.current(), HERALD_MS);
    /* Capture, so a control that stops propagation still clears the card.
       Pointer input covers a tap and the start of a touch scroll; keyboard
       input covers the other immediate-use path, especially typing into the
       Search field that the band focuses on mount. Only inside the band: input
       on the prose, command bar or Dock is about something else, and the card
       is not in its way. */
    const usedBand = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(".mode-band")) done.current();
    };
    document.addEventListener("pointerdown", usedBand, true);
    document.addEventListener("keydown", usedBand, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", usedBand, true);
      document.removeEventListener("keydown", usedBand, true);
    };
  }, []);
  return (
    <div className="mode-herald" ref={card}>
      <span className="mode-herald-name">{MODE_LABEL[mode]}</span>
      <span className="mode-herald-what">{MODE_CATALOG[mode].description}</span>
    </div>
  );
}
