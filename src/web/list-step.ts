/**
 * **A list the keys step through, and the band's own scroller following it.**
 *
 * Shared by the modes whose ← / → walk a list in the band — Quotes and Search
 * (docs/project/keyboard.md § ← / → in Quotes, § ← / → in Search). The rules
 * are pure, so they are tested without a browser: tests/list-step.test.ts.
 */
import { type RefCallback, useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * The item a ← / → press goes to, from the one whose key is `current`.
 *
 * - **Nothing current, or a current item the list no longer shows** → the
 *   first, whichever way.
 * - **← on the first goes to the first again**: the page may be anywhere, and
 *   "you are already on it" is no answer to a reader asking to be taken there
 *   (SPIDERYARN-READING2-4K).
 * - **→ on the last is `null`**, and so is an empty list — no wrap, so the key
 *   goes back to the browser.
 *
 * `listed` is the list as the band shows it, in the reader's order and under
 * any bar, so "next" is the next row they can see — at the moment of the press,
 * if a streaming list has grown or reordered since the last one.
 */
export function stepByKey<T>(
  listed: readonly T[],
  keyOf: (item: T) => string,
  current: string | null,
  dir: -1 | 1,
): T | null {
  const at = current === null ? -1 : listed.findIndex((item) => keyOf(item) === current);
  if (at === -1) return listed[0] ?? null;
  return listed[Math.max(0, at + dir)] ?? null;
}

/**
 * **The selected row follows into view in its list** — by ‹ ›, by ← / →, or by
 * anything else that selects — so the reader can see which row they are on.
 *
 * - A row already fully in view is left alone, and it runs only when the
 *   selection changes, so a reader who scrolls the list by hand keeps their
 *   place until then. A streaming list that pushes the selected row away is
 *   not chased: the next press brings its row into view.
 * - **And again when the list comes back into view**, since a hidden list
 *   measures nothing: on a narrow window a step that jumps the article steps
 *   the band aside, and the reader returns to it later (Reader.tsx §
 *   `bandJump`) — OutlinePanel.tsx's `ResizeObserver`, for the same reason.
 * - The list's own `scrollTop`, never `scrollIntoView`, which scrolls every
 *   scrollable ancestor too, the page included.
 */
export function useFollowRow<E extends HTMLElement>(
  selected: string | null,
  find: (list: E, key: string) => HTMLElement | null | undefined,
): RefCallback<E> {
  /* A callback ref makes the element itself an effect dependency. An object
     ref changes silently, so a conditional list could leave the observer on
     its detached old node and never follow the replacement. */
  const [list, setList] = useState<E | null>(null);
  const listRef = useCallback((next: E | null) => setList(next), []);
  const finder = useRef(find);
  finder.current = find;
  useLayoutEffect(() => {
    if (!list || selected === null) return;
    const follow = () => {
      const row = finder.current(list, selected);
      if (!row) return;
      const to = followScrollTop(list, row);
      if (to !== null) list.scrollTop = to;
    };
    follow();
    if (typeof ResizeObserver === "undefined") return;
    let shown = list.clientHeight > 0;
    const watch = new ResizeObserver(() => {
      const now = list.clientHeight > 0;
      if (now && !shown) follow();
      shown = now;
    });
    watch.observe(list);
    return () => watch.disconnect();
  }, [list, selected]);
  return listRef;
}

/**
 * **Where a scrolled list's `scrollTop` should go so `row` is in view**, or
 * `null` when it already is, or when the list is hidden and measures nothing.
 */
export function followScrollTop(list: HTMLElement, row: HTMLElement): number | null {
  if (list.clientHeight <= 0) return null;
  const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  return scrollTopFor(list.scrollTop, list.clientHeight, top, row.offsetHeight);
}

/**
 * `followScrollTop`'s arithmetic over plain numbers, `top` in the list's own
 * coordinates. A row out of view goes a third of the way down, **but never so
 * far that a row which fits is cut at the foot**; a row taller than the list
 * starts at its top. The rule OutlinePanel.tsx § follow arrived at (GPT Sol's
 * plan review, 261003k, F2), which keeps its own copy only because its fisheye
 * wraps more around it.
 */
export function scrollTopFor(
  scrollTop: number,
  height: number,
  top: number,
  rowHeight: number,
): number | null {
  const bottom = top + rowHeight;
  if (top >= scrollTop && bottom <= scrollTop + height) return null;
  const third = top - height / 3;
  return Math.max(0, Math.min(top, Math.max(third, bottom - height)));
}
