/**
 * **The mode the reader just pressed, named over the top of its band for three
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
import { useEffect, useRef } from "react";

import { MODE_CATALOG } from "../mode-catalog.js";
import type { Mode } from "../modes.js";
import { MODE_LABEL } from "../title-text.js";

/**
 * How long the card stays, fade included — `mode-band.css` § the herald
 * spends the last sixth of it fading, and the two numbers are written as one
 * there. Three rather than Greg's *"a couple of seconds"* because it carries a
 * sentence as well as a name.
 */
export const HERALD_MS = 3000;

/** One press of a mode. `nonce` differs between two presses of the same mode. */
export interface HeraldPress {
  mode: Mode;
  nonce: number;
}

export function ModeHerald({ press, onDone }: { press: HeraldPress | null; onDone(): void }) {
  return (
    <>
      <div className="sr-only" role="status">
        {press ? MODE_CATALOG[press.mode].description : ""}
      </div>
      <div className="mode-herald-slot" aria-hidden="true">
        {press && <Card key={press.nonce} mode={press.mode} onDone={onDone} />}
      </div>
    </>
  );
}

function Card({ mode, onDone }: { mode: Mode; onDone(): void }) {
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
    <div className="mode-herald">
      <span className="mode-herald-name">{MODE_LABEL[mode]}</span>
      <span className="mode-herald-what">{MODE_CATALOG[mode].description}</span>
    </div>
  );
}
