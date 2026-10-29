/**
 * **Facts about the page, said once on `<html>` by the component that knows
 * them** — so the stylesheet can ask `:root[data-side-dialog]` instead of
 * `:root:has(.cmt-dialog)`.
 *
 * A `:has()` whose subject is the document root is answered by walking the
 * document, and on the reading view the document is the article: on a book
 * (87k nodes) at 6× throttle those rules cost more than a second a keystroke
 * in the Feedback box, because Chrome asks them again after almost any DOM
 * change. docs/project/performance.md § Style recalculation scales with the
 * article; plan 261029k § 1.2; postmortem 261029c. `tests/no-document-wide-has.test.ts`
 * refuses the shape coming back.
 *
 * Three rules make this safe to lean on:
 *
 * - **The flag is set from the state that renders the element**, by the
 *   component that renders it, in an insertion effect — before descendants'
 *   layout effects can measure the CSS, as `:has()` was.
 * - **Counted, not toggled.** Two owners can hold one flag (two side dialogs
 *   both say `side-dialog`); the attribute is present while the count is above
 *   zero. A lease is released at most once, so StrictMode's doubled effects
 *   cannot leave a count behind.
 * - **A closed union of names**, so a typo is a compile error rather than a
 *   rule that never matches.
 *
 * A flag from React state cannot be forged by an article's own markup, which
 * the `:has()` forms could be (an author's `<p class="controls">`; shell.css
 * § the bar that leaves while you read had to scope against it).
 */
import { type RefCallback, useCallback, useInsertionEffect } from "react";

/**
 * One name per fact; the attribute is `data-<name>`. The owner of each is
 * named beside it — and the rule that reads it says so too.
 */
export type RootFlag =
  /** The controls bar is drawn: `.controls` a child of `.reader`. Reader.tsx § `showBar`. */
  | "bar-drawn"
  /** Focus is inside that bar. Reader.tsx, `useFocusWithinFlag`. */
  | "bar-focus"
  /** The bar holds the headings breadcrumb. HeadingsCrumbs.tsx. */
  | "bar-crumbs"
  /** A `.mode-band` is drawn inside a `.reader.band-covers`. ModeSurface.tsx, FeatureBoundary.tsx (band-root-flags.ts). */
  | "band-covers"
  /** A fitted band — Outline's or Structure's — is drawn inside `.reader`. The same two. */
  | "band-fitted"
  /** Marginalia's "needs a wider window" line is drawn. MarginaliaColumn.tsx § `NarrowLine`. */
  | "marg-narrow"
  /** A `.return-chip` is drawn. ReturnChip.tsx and BandBackChip.tsx. */
  | "return-chip"
  /** The install hint is drawn, and focus is inside it. InstallHint.tsx. */
  | "install-hint"
  | "install-hint-focus"
  /** The Dock's drawer is open; focus is in the Dock; its More menu is open. Dock.tsx. */
  | "dock-drawer"
  | "dock-focus"
  | "dock-more-open"
  /** "Skip to modes" has brought the Dock in (`.dock[data-skip-arrived]`). SkipToModes.tsx. */
  | "dock-skip-arrived"
  /** A comment, chat or annotate dialog is drawn. CommentDialog, ChatDialog, AnnotateDialog. */
  | "side-dialog";

/** Hands a flag back. Calling it twice is calling it once. */
export type Release = () => void;

const counts = new Map<RootFlag, number>();

/**
 * **The imperative lease**, for an owner whose fact is not a render — "Skip to
 * modes" marks the Dock from a click handler. Everything else goes through
 * `useRootFlag`.
 */
export function acquireRootFlag(flag: RootFlag): Release {
  const n = (counts.get(flag) ?? 0) + 1;
  counts.set(flag, n);
  if (n === 1) document.documentElement.setAttribute(`data-${flag}`, "");
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const left = (counts.get(flag) ?? 1) - 1;
    if (left > 0) {
      counts.set(flag, left);
      return;
    }
    counts.delete(flag);
    document.documentElement.removeAttribute(`data-${flag}`);
  };
}

/** Hold `flag` while `on`, and let it go when `on` turns false or the component unmounts. */
export function useRootFlag(flag: RootFlag, on: boolean): void {
  /* `useLayoutEffect` is one phase too late here: React runs descendants'
     layout effects first, and a band or table child can measure the CSS
     variables this flag changes before its parent gets to set it. Insertion
     effects run after the DOM commit and before every layout effect. */
  useInsertionEffect(() => (on ? acquireRootFlag(flag) : undefined), [flag, on]);
}

/**
 * **Hold `flag` while focus is inside the element this ref is on** — the
 * stand-in for `:root:has(.x:focus-within)`. Put the returned ref on the
 * element; it is released when the element detaches or the component unmounts.
 *
 * **It asks where focus is rather than reading the event**, because focus can
 * leave without saying where to (GPT Sol, plan review of 261029k, P1): a null
 * `relatedTarget` (focus to `body`, to another frame, to another app), a
 * focused node removed — which fires no `focusout` in every engine — or the
 * window losing focus. So it reconciles from `focusIsWithin` on `focusin`, and
 * a microtask after `focusout`, after the window's `blur` and `focus`, and
 * after a change to the element's subtree.
 */
export function useFocusWithinFlag(flag: RootFlag): RefCallback<HTMLElement> {
  return useCallback((el: HTMLElement | null) => (el ? trackFocusWithin(el, flag) : undefined), [flag]);
}

/**
 * **What `:focus-within` asks, asked directly**: the focused element is this
 * one or inside it, and the document has focus — Blink's `:focus` does not
 * match in a window that is not focused, and `hasFocus()` is that test.
 *
 * Not `el.matches(":focus-within")`, which Sol's review proposed and which is
 * the same question in a browser: jsdom's selector engine (nwsapi) caches the
 * answer to that one selector string, so it went on answering the first
 * result it gave, and the tests below could not see this work. Measured
 * 2026-10-29: `false` before a focus, still `false` inside the `focusin`.
 */
export function focusIsWithin(el: Element): boolean {
  const active = el.ownerDocument.activeElement;
  return active !== null && el.contains(active) && el.ownerDocument.hasFocus();
}

/** The body of `useFocusWithinFlag`, for an element held by other means. Returns the stop. */
export function trackFocusWithin(el: HTMLElement, flag: RootFlag): () => void {
  let release: Release | null = null;
  let stopped = false;
  const sync = () => {
    if (stopped) return;
    const within = focusIsWithin(el);
    if (within && release === null) release = acquireRootFlag(flag);
    else if (!within && release !== null) {
      release();
      release = null;
    }
  };
  const soon = () => queueMicrotask(sync);
  el.addEventListener("focusin", sync);
  el.addEventListener("focusout", soon);
  window.addEventListener("blur", soon);
  window.addEventListener("focus", soon);
  const removed = new MutationObserver(sync);
  removed.observe(el, { childList: true, subtree: true });
  sync();
  return () => {
    stopped = true;
    el.removeEventListener("focusin", sync);
    el.removeEventListener("focusout", soon);
    window.removeEventListener("blur", soon);
    window.removeEventListener("focus", soon);
    removed.disconnect();
    release?.();
    release = null;
  };
}
