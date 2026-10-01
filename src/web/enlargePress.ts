/**
 * **When a press on a Diagram picture means Enlarge**, and when a press on its
 * overlay's backdrop means Close — the two halves of one gesture, shared by
 * `IllustratedView` and `SketchView`. Greg, 2026-09-05 (`spya-dfghb4`): *"If I
 * click on the Sketch or Illustrated images in Diagram, that should be
 * equivalent to clicking on Enlarge button for them"*; and 2026-09-11
 * (`spya-mghbv7`), *"click or double-click"*. Plan 261001l.
 */
import type { MouseEvent } from "react";

/**
 * A real pointer press, and nothing that only looks like one. Three things
 * arrive as a `click` and are not a reader pointing at the picture:
 *
 * - **keyboard, voice and assistive-technology activation** — `detail` is 0.
 *   `pointerType === ""` is not enough to tell: Pointer Events also permits it
 *   for a real pointer whose device type the browser cannot detect. The Sketch
 *   is a keyboard listbox, so Enter on it must not open the overlay; the
 *   Enlarge button is the keyboard's way in.
 * - **the end of a text-selection drag** across the Sketch's `<text>`, which
 *   can carry `detail: 1` — a selection that is not collapsed says so.
 * - a press something inside already handled and said so.
 *
 * GPT Sol's review of the plan, finding 1.
 */
export function pressEnlarges(event: MouseEvent): boolean {
  if (event.defaultPrevented) return false;
  if (event.detail < 1) return false;
  const selection = typeof window === "undefined" ? null : window.getSelection();
  return !(selection && !selection.isCollapsed);
}

/**
 * **The second click of a double-click is nobody's press in the overlay.** The
 * first click opens the modal; the second lands in the top layer, wherever the
 * pointer now is — the backdrop, whose light-dismiss shuts what the first click
 * just opened, or (found by the browser pass at 1280×800) an Illustrated row,
 * which closes the overlay and jumps the article. So each overlay swallows it
 * in the capture phase. For a click the browser emits, `detail` is the running
 * click count, so 2 and above is a later click of a multi-click; a deliberate
 * single press anywhere still does what it did.
 */
export function laterClickOfMany(event: MouseEvent): boolean {
  return event.detail > 1;
}
