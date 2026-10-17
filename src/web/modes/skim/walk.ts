/**
 * **What Skim's two walks share** — the route's (`useSkimMode`, SkimMode.tsx)
 * and the figures' (`useFiguresWalk`, FiguresWalk.tsx). Each is its own
 * component with its own hook, and the band draws one or the other on
 * `?depth=` (plan 261011b § How it is built). What they must not disagree
 * about lives here, once: how a deep link or an opening is claimed, how the
 * controller is published to `Reader`, and how a figure is arrived at.
 */
import { type MutableRefObject, useLayoutEffect, useRef } from "react";
import type { BlockId } from "../../../types.js";
import { type Figure, figureName } from "../../../figures.js";
import type { Voice } from "../../voice.js";
import { dropPendingFlash, flashBlock } from "../../flash.js";
import { scrollToBlock } from "../../scroll.js";
import type { SkimArrival, SkimControl } from "./SkimMode.js";

/**
 * **This mount claims the arrival before it waits for data.** The mailbox is
 * cleared in a layout effect, while the claimed token stays in this walk's
 * ref. If the reader leaves before the route or Quotes resolve, the ref goes
 * with the walk: Back cannot inherit the old press and turn traversal into a
 * fresh push. A ref survives StrictMode's synthetic effect replay, so the
 * first setup may claim it without the second losing it (code review F2).
 *
 * **A switch between walks arms it too** (GPT Sol's plan review F4): pressing
 * *Figures* in a pass, or a pass in Figures, puts the target stop in the
 * mailbox before the one URL write, and the walk that mounts claims it here.
 */
export function useClaimedArrival(arrival: SkimArrival): MutableRefObject<SkimArrival> {
  const claimed = useRef<SkimArrival>({ stop: null, open: false });
  useLayoutEffect(() => {
    /* StrictMode runs this setup twice around a synthetic cleanup. The second
       sees an empty mailbox and must leave the first setup's local claim alone. */
    if (arrival.stop === null && !arrival.open) return;
    claimed.current = { stop: arrival.stop, open: arrival.open };
    arrival.stop = null;
    arrival.open = false;
  }, [arrival]);
  return claimed;
}

/**
 * **Take the claimed arrival, once**: `"link"` for a `?stop=` deep link (or a
 * switch between walks), arrived at without a push; `"opening"` for opening
 * the mode, a jump that pushes; `null` for nothing. Consumed before anything
 * is done with it, so a second run — StrictMode, a re-render — finds nothing.
 */
export function takeArrival(claimed: SkimArrival): "link" | "opening" | null {
  if (claimed.stop !== null) {
    claimed.stop = null;
    claimed.open = false;
    return "link";
  }
  if (!claimed.open) return null;
  claimed.open = false;
  return "opening";
}

/**
 * **Publish the controller to `Reader`**, in a layout effect, and clear it in
 * a layout cleanup that runs on unmount and only then — passage-lifecycle.ts §
 * Rule 3, and why it is a layout cleanup: the walk going away is cleared
 * before the incoming one publishes. `control` must change only when what it
 * says does (`SkimControl`).
 */
export function usePublishedControl(
  control: SkimControl | null,
  onControl: (control: SkimControl | null) => void,
): void {
  useLayoutEffect(() => {
    onControl(control);
  }, [control, onControl]);
  /* Its own effect, depending on the setter alone. */
  useLayoutEffect(() => () => onControl(null), [onControl]);
}

/**
 * **Arriving at a figure**: its block centred and, once the glide settles,
 * flashed whole — there is no quote to narrow to (plan 261011b, Sol F5). The
 * route's `arrive` (SkimMode.tsx) is this with a passage; the reasons for
 * `scrollToBlock` rather than a jump, and for dropping a held flash first,
 * are written there.
 */
export function arriveAtBlock(block: BlockId): void {
  dropPendingFlash();
  scrollToBlock(
    block,
    "smooth",
    (outcome) => {
      if (outcome === "settled") flashBlock(block);
    },
    { align: "centre" },
  );
}

/**
 * **A figure's words on its row and under the door: its caption, else its
 * name** — the author's words in the author's face, or *"Table 2"*, which is
 * ours. Both walks draw a figure with it: the Figures walk's rows, and a figure
 * stop on the route (plan 261017d).
 */
export function figureLabel(figure: Figure): { text: string; voice: Voice } {
  return figure.caption ? { text: figure.caption, voice: "author" } : { text: figureName(figure), voice: "ui" };
}
