/**
 * **Two things this page measures rather than guesses**: how much of itself the
 * bottom bar can afford to spell out, and how many columns the session list
 * gets.
 *
 * PORTED FROM src/web/dock-fit.ts (the ladder) and the argument in
 * src/web/layout.ts (the columns). Both are here rather than in two files
 * because they are the same idea twice, and the idea is the whole reason this
 * module exists:
 *
 * > When what has to fit is the CONTENT, a media query is the wrong tool. A
 * > breakpoint is right when the *window* is what changed; this bar keeps
 * > growing instead.
 * >
 * > — docs/project/narrow-windows.md
 *
 * The product learnt that the expensive way. Its bar dropped its labels at
 * `@media (max-width: 1100px)`, a number measured once when there were six
 * modes; at thirteen the spelled-out row wanted 1416px, so every window between
 * those two showed its labels *and* ran the last buttons off the right-hand
 * edge, with nothing on screen to say a button was missing. A fourth mode here
 * would do the same to this bar.
 */

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/* -------------------------------------------------------------- the bar -- */

/**
 * The rungs, widest first, as the class each puts on `.dock`.
 *
 * Rung 0 is the bar spelled out and carries no class. Each rung is strictly
 * narrower than the one above, which is what makes walking the list top-down
 * and stopping at the first fit correct.
 *
 *  - `dock-fit-1`: **Refresh loses its word.** The modes keep theirs. It is the
 *    one control here whose glyph is unambiguous without a label, which is the
 *    same test the product applies to its own app cluster.
 *  - `dock-fit-2`: the modes lose their labels too and everything closes up —
 *    except the mode you are actually in, which keeps its word at every rung
 *    (tailwind.css § the fit ladder for why that is affordable here and is not
 *    in the product).
 *
 * **Three rungs there, two here, and that is a decision rather than an
 * omission.** The product's middle rung shrinks the padding of a thirteen-mode
 * row by 0.15rem to buy back 11px; with four buttons there is nothing that rung
 * could save that rung 2 does not already.
 *
 * Past the last rung the row simply overflows, and `.dock` scrolls at every
 * width rather than clipping — the floor under this ladder, not another rung.
 */
export const DOCK_FIT_CLASSES = ["", "dock-fit-1", "dock-fit-2"] as const;

/** Every class this module owns, so `applyDockFit` can clear the others. */
const ALL_FIT = DOCK_FIT_CLASSES.filter((c) => c !== "");

/** Put one rung on the element and take the rest off. */
function applyDockFit(el: HTMLElement, level: number): void {
  const want = DOCK_FIT_CLASSES[level] ?? "";
  for (const c of ALL_FIT) el.classList.toggle(c, c === want);
}

/**
 * The narrowest rung the bar needs, left applied to `el` when this returns.
 *
 * **The one measurement, and it is the only honest one:**
 * `el.scrollWidth > el.clientWidth`. In particular **no slack term** —
 * `scrollWidth` is clamped to at least `clientWidth`, so `scrollWidth >
 * clientWidth - 8` is *always* true and a bar written that way compacts to its
 * smallest rung at every width. That was the first version of the product's
 * copy of this file.
 *
 * The same clamp is why the ladder is walked from the top down rather than
 * solved arithmetically: a rung that fits reports exactly `scrollWidth ===
 * clientWidth`, which says nothing about the room to spare. The only question
 * the DOM will answer is the yes/no one, asked once per rung.
 *
 * `current` is returned unchanged when the element has no layout at all
 * (`clientWidth` 0 — detached, `display: none`, or jsdom, which has no layout
 * engine). Measuring a zero-width box would otherwise answer "nothing fits" and
 * strip every label off a bar nobody is looking at.
 */
export function chooseDockFit(el: HTMLElement, current: number): number {
  if (el.clientWidth === 0) return current;
  const last = DOCK_FIT_CLASSES.length - 1;
  for (let level = 0; level < last; level++) {
    applyDockFit(el, level);
    if (el.scrollWidth <= el.clientWidth) return level;
  }
  applyDockFit(el, last);
  return last;
}

/**
 * The hook the bar uses: a ref for its root, and the class to render with.
 *
 * **The class is written twice and that is not a bug.** `chooseDockFit` mutates
 * `classList` because it has to — each rung must be on the element before the
 * next reflow can be read — and the returned `fitClass` puts the same value in
 * React's `className` so a re-render for any other reason does not throw the
 * measurement away.
 *
 * It re-measures when `content` changes (a string the caller builds out of
 * exactly the things that change the row's width — **if a future change makes
 * the row wider without changing that string, this is the line to add it to**),
 * on resize via a `ResizeObserver` on the bar itself, and when the fonts land.
 * The resize callback is coalesced through `requestAnimationFrame`, because a
 * `ResizeObserver` fires *during* layout and writing style from it
 * synchronously is how you get "loop completed with undelivered notifications".
 *
 * **It observes the bar and the trailing gutter, never the buttons.** Observing
 * the buttons would never stop: probing a rung changes their widths, which
 * fires the observer, which probes again. `.dock-tail` is `rem`-sized and
 * rung-independent, so it moves when the text metrics move — a reader changing
 * their browser's default font size, which changes no viewport — and never when
 * a rung is applied.
 */
export function useDockFit(content: string): { ref: RefObject<HTMLDivElement | null>; fitClass: string } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [level, setLevel] = useState(0);
  /* The DOM's truth, readable synchronously. `level` is the same number one
     render behind, and the measurement must not wait for a render to know where
     it currently stands. */
  const applied = useRef(0);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = chooseDockFit(el, applied.current);
    if (next === applied.current) return;
    applied.current = next;
    setLevel(next);
  }, []);

  // Before paint, so the bar is never seen at the wrong rung. `content` is a
  // re-run trigger rather than a value the effect reads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger
  useLayoutEffect(measure, [measure, content]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const soon = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
    ro?.observe(el);
    const tail = el.querySelector(".dock-tail");
    if (tail) ro?.observe(tail);
    if (!ro) window.addEventListener("resize", soon);
    /* The product reads `document.fonts` through its own fonts.ts, which knows
       about the engines that have none. Here the guard is inline, because one
       call site does not need a module. */
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.addEventListener?.("loadingdone", soon);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      fonts?.removeEventListener?.("loadingdone", soon);
      if (!ro) window.removeEventListener("resize", soon);
    };
  }, [measure]);

  const cls = DOCK_FIT_CLASSES[level] ?? "";
  return { ref, fitClass: cls ? ` ${cls}` : "" };
}

/* ---------------------------------------------------------- the columns -- */

/**
 * **The narrowest a session card may be drawn**, in CSS pixels.
 *
 * A card carries a status pill and an uptime on one line, a title, a
 * `repo · worktree` line, and a row of three mono handles that cannot be
 * hyphenated. 340 is the width at which the handle row stops wrapping to three
 * lines on the box's own session names.
 *
 * **This is the number the layout is derived FROM, and it is the only one
 * written down.** The product's equivalent constants live in
 * src/web/layout.ts, and its own doc is emphatic about why the breakpoint is
 * never written separately: *"the breakpoint is derived, not chosen"*
 * (docs/project/narrow-windows.md). A second constant saying "two columns above
 * 900px" is a copy that goes stale the first time a card grows a line.
 */
export const COLUMN_MIN_PX = 340;

/** No more than this, however wide the window. */
export const COLUMN_MAX = 3;

/**
 * How many columns fit in `width`.
 *
 * **Columns are given up, not wrapped**, which is the rule the reading view
 * follows: a row of things whose widths you do not control may wrap, but a
 * *column* that will not fit must be surrendered whole rather than squeezed —
 * a squeezed column is a card whose handle row is three lines deep, which is
 * worse than not having the column at all.
 *
 * `0` — jsdom, a detached node, a box that has not been laid out — is one
 * column rather than none, for the same reason `chooseDockFit` refuses to
 * measure a zero-width bar: the honest answer to "how wide is this?" when the
 * answer is "it is not on screen" is to change nothing.
 */
export function chooseColumns(width: number, max = COLUMN_MAX): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.min(max, Math.floor(width / COLUMN_MIN_PX)));
}

/**
 * A ref to hang on the container, and the number of columns its width affords.
 *
 * A `ResizeObserver` on the container rather than a listener on the window,
 * because the thing that decides this is how much room the list has — which a
 * scrollbar appearing, or browser zoom, changes without the window resizing.
 * Coalesced through `requestAnimationFrame` for the reason above.
 *
 * **It cannot feed back on itself**: the column count changes what is *inside*
 * the container and never the container's own width, which is `100%` of `main`.
 *
 * ## A CALLBACK REF, and it has to be
 *
 * The obvious version is a `useRef` read inside a `useEffect(…, [max])`, and it
 * was wrong in a way nothing caught: **the element the ref points at is not
 * there when that effect first runs.** `SessionsPanel` returns an early "No
 * sessions." card before any data has arrived, so on the first mount there is
 * no container to measure; the effect reads `null`, gives up, and — because
 * `max` never changes — never runs again. The list then sits at one column for
 * the life of the tab, with a 740px card and half the window empty beside it.
 *
 * Two things made it invisible. It fails only when the panel's first render is
 * the empty one, which is *always* true in the browser and *never* true in a
 * test that pushes state before asserting. And the fallback is one column,
 * which is the phone layout and looks completely intentional. Found by
 * screenshotting a 1280px window, 2026-09-08, which is the only thing that
 * could have found it — docs/reusable/silent-success.md.
 *
 * A callback ref is React's answer: it fires with the node whenever the node
 * changes, including from `null` to a real element three seconds later, so the
 * effect below depends on the element rather than on the render that mounted
 * it.
 */
export function useColumns(max = COLUMN_MAX): {
  ref: (node: HTMLDivElement | null) => void;
  columns: number;
} {
  const [ref, setRef] = useState<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    const el = ref;
    if (!el) return;
    let raf = 0;
    const measure = (): void => {
      setColumns(chooseColumns(el.clientWidth, max));
    };
    const soon = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
    ro?.observe(el);
    if (!ro) window.addEventListener("resize", soon);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      if (!ro) window.removeEventListener("resize", soon);
    };
  }, [ref, max]);

  return { ref: setRef, columns };
}

/**
 * Deal `items` into `columns` lists, in order, without breaking one up.
 *
 * The session list's three bands are the items, and **order is the whole
 * point**: "needs you" must be the first thing in the first column at every
 * width, because it is the reason the page exists. So this front-loads —
 * three bands into two columns is `[[needs, working], [quiet]]`, never
 * `[[needs], [working, quiet]]`, which would put the two urgent bands in
 * different places depending on the window.
 *
 * Empty bands are the caller's problem: it filters them out first, so a fleet
 * with nothing blocked does not draw a blank first column with two full ones
 * beside it.
 *
 * **It balances by band, not by row count.** Twelve quiet sessions beside one
 * blocked one still gets a column each, so the columns can be very uneven. That
 * is deliberate for now — a band is a heading and a meaning, and splitting one
 * across two columns to even up the heights would cost more than the ragged
 * bottom edge does.
 */
export function spreadIntoColumns<T>(items: readonly T[], columns: number): T[][] {
  const cols = Math.max(1, Math.min(Math.floor(columns), items.length || 1));
  const out: T[][] = [];
  const base = Math.floor(items.length / cols);
  let extra = items.length % cols;
  let at = 0;
  for (let c = 0; c < cols; c++) {
    const take = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    out.push(items.slice(at, at + take));
    at += take;
  }
  return out;
}
