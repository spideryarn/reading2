/**
 * **A text box as tall as what is in it**, so it never scrolls inside itself
 * and the page around it is the one scroller.
 *
 * > show the whole answer and don't put my answer in a scrollable box.
 * >
 * > — Greg, 2026-10-03 (spya-qnrxuw, Quiz)
 *
 * > I recorded something with voice into the little reply box and then tried
 * > to edit it, and the keyboard popped up, and somehow I couldn't actually
 * > ever see the... I couldn't scroll properly to actually get to the right
 * > bit of the input box.
 * >
 * > — Greg, 2026-10-08 (spya-za2tse, the Feedback dialog's reply box)
 *
 * Two scrollers under one finger, with the keyboard taking half the screen, is
 * the second report; one scroller is the fix, and Safari reveals the caret in
 * it by itself. Written for QuizPanel's answer box and moved here when the
 * reply box needed it (plan 261008f, F9).
 *
 * Chat's composer's mechanism without its roof: `auto` first, or the box could
 * only ever grow. `rows` is the floor. **Measured again when the width
 * changes, and not only when the words do**: rotate an iPad under a long
 * answer and more lines wrap inside a height nobody re-asked for, with the
 * overflow hidden. The passed-over line of CSS is `field-sizing: content`: no
 * Firefox, and in iOS Safari only from 26.2.
 *
 * `mounted` is whether the box is in the document, which is when there is an
 * element to measure and watch; `value` is what changed it.
 */
import { type RefObject, useEffect, useLayoutEffect } from "react";

export function useFitTextarea(box: RefObject<HTMLTextAreaElement | null>, value: string, mounted = true): void {
  const fitBox = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    /* `scrollHeight` stops inside the border and the box is `border-box`. */
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect measures the DOM, and `value` is what changed it; `mounted` is the box arriving
  useLayoutEffect(fitBox, [value, mounted]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `mounted` is the box mounting and unmounting, which is when there is an element to watch
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    /* Width only: the fit itself changes the height, and reacting to that
       would be a loop. */
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitBox();
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [mounted]);
}
