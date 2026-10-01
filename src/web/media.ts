import { useSyncExternalStore } from "react";

/**
 * `matchMedia`, for a caller that must not care whether it exists.
 *
 * **jsdom does not implement it**, so an unguarded call inside a `useState`
 * initialiser threw and took nine of `dock-questions-loading.test.tsx`'s tests
 * down with it — a bar that could not mount, from a hint that had nothing to do
 * with any of them. That is the useful half of the discovery: the same throw in
 * a browser without `matchMedia` would blank the reading view, and a hint is not
 * worth taking a page down for.
 *
 * **`false` for "cannot tell", and that is the right way round for both callers
 * here.** Every condition this feeds is a reason to *show* a strip of chrome
 * over somebody's article, so not knowing means not showing.
 *
 * Lives here rather than in `install-hint.ts`, which is where it was written,
 * because `small-screen-hint.ts` wants the identical question asked the
 * identical way. src/web/feedback-diagnostics.ts and src/web/scroll.ts ask
 * theirs differently on purpose — a third state for "cannot tell", and a live
 * `MediaQueryList` to subscribe to — and are deliberately not folded in.
 */
export function media(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/**
 * **`media`, as a hook that follows the viewport** — for a component whose
 * layout depends on the answer, so a phone turned on its side gets the new
 * answer without a reload.
 *
 * `false` when `matchMedia` is missing (jsdom, and the rule above), and a
 * `MediaQueryList` without `addEventListener` (older Safari has only
 * `addListener`) is read once rather than followed. One caller today: the
 * Remember composer's compact box on short bands (ChatPanel.tsx § Composer).
 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      if (typeof list.addEventListener !== "function") return () => {};
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => media(query),
    () => false,
  );
}
