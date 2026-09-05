/**
 * One banner, once, telling a phone reader why the article and the mode panel
 * never seem to be on screen together.
 *
 * They are not: past a crossover the band covers the article instead of sitting
 * beside it, which is a deliberate layout decision (layout.ts §
 * `bandCoversProse`) and reads from the outside as the text having vanished.
 * The decision of whether to say so at all is `small-screen-hint.ts`;
 * everything here is the banner.
 *
 * **In flow at the top of the reading view, not a fixed strip above the dock.**
 * That slot already has an occupant — `InstallHint`, with `--hint-h` and
 * `.offline-strip` stacked on it — and a second would mean a second token and an
 * ordering question between two sentences that have nothing to do with each
 * other. Here it costs one reflow, once, before the reader has started reading,
 * and then scrolls away like the masthead. Which is right for something you read
 * once and never again.
 *
 * docs/plans/260905e-a-small-screen-banner-on-a-phone.md.
 */
import { useState } from "react";
import { X } from "lucide-react";
import {
  moreRoomSideways,
  readMachine,
  rememberDismissed,
  shouldWarnSmallScreen,
} from "./small-screen-hint.js";

export function SmallScreenHint({ bandCovers }: { bandCovers: boolean }) {
  /* Lazy initialiser rather than an effect, `InstallHint`'s reason:
     `readMachine` touches `localStorage` and `matchMedia`, and running it in
     render on every update would ask the same unchanging questions of the
     browser dozens of times a scroll.

     **The dismissal is this one bit and not a second `useState` beside it.**
     Two would be two ways to be hidden, and the × would have to write both. */
  const [machine, setMachine] = useState(readMachine);

  /* `bandCovers` comes from the render rather than from `machine`, so this
     answer follows a rotation without a listener of our own: `useWindowWidth`
     in App.tsx already re-measures on `resize` and `orientationchange`, and
     `bandCoversProse` is computed from it. Turn a phone that is wide enough
     sideways and the banner goes — which is the banner's own advice, taken. */
  if (!shouldWarnSmallScreen({ ...machine, bandCovers })) return null;

  /* Read raw, in render, and both sides from the same source — mixing App's
     notch-adjusted width with a raw `innerHeight` would be the one way to get a
     near-square window's answer wrong.

     **It follows a rotation and not every resize, and the difference is real.**
     The parent's state is the *width*, so a resize that changes only the height
     — iOS collapsing its own toolbar is the everyday one — produces the same
     value and React need not render again, leaving this answer stale until
     something else moves. A rotation always changes the width, which is the
     case the sentence is about, so the cost is a phone that briefly still
     offers landscape while its browser chrome slides away. Not worth a second
     subscription. GPT Sol, 2026-09-05. */
  const sideways = moreRoomSideways({ width: window.innerWidth, height: window.innerHeight });

  return (
    /* `role="note"` rather than `status` or `alert`, `InstallHint`'s reason:
       nothing has happened, and a live region would interrupt a screen-reader
       user mid-sentence about a layout constraint they are not meeting.

       **Plain classes rather than Tailwind utilities**, unlike `SharedNotice`
       two lines below it in the same flow. `.small-screen-hint` is a small
       system — a shell, a paragraph, a close button, and a rule that hides it
       under a covering band — and systems live in styles.css while utilities
       own one-off adjustments inside a component
       (docs/project/design-css-overview.md § Which mechanism owns what). So it
       is styled beside `.install-hint`, which it is a sibling of in every
       other way.

       This comment used to give a different reason: that `tw:bg-surface-raised`
       and `tw:border-rule` were missing from the `@theme inline` bridge and
       compiled to nothing at all. They were, and they are not now (260905f) —
       which is why the reason had to change rather than the code. */
    <div className="small-screen-hint" role="note">
      {/* Every clause is one of Greg's, in order: designed for a bigger screen;
          one or the other, not both; you switch between them; Plain is the way
          back to the text; try landscape; work in progress. The only one that
          moves is the landscape sentence, which is dropped where it would be
          advice to do what the reader is already doing. */}
      <p className="small-screen-hint-text">
        <b>Spideryarn is designed for a larger screen.</b> There&rsquo;s room here for the article{" "}
        <i>or</i> a mode panel, not both, so you switch between them — <b>Plain</b> is the way back
        to the article.{sideways ? " Landscape gives you a bit more room." : ""} Showing both is
        work in progress.
      </p>
      {/* 32px, `InstallHint`'s reason and its number: a control the reader
          presses once and never finds again, and one the size of a mode button
          would read as an equal of the things beside it. Past the 24px CSS
          minimum either way. */}
      <button
        type="button"
        className="small-screen-hint-close"
        onClick={() => {
          rememberDismissed();
          setMachine((m) => ({ ...m, dismissed: true }));
        }}
        title="Don't show this again"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
