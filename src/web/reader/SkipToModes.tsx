/**
 * **"Skip to modes" — the reading view's first Tab stop** (plan 261007h §
 * F5b). Before it, a keyboard reader passed every spine sliver and four
 * buttons a paragraph to reach the dock's mode switcher; ⌘-K and `/` were the
 * only ways round. This is the standard remedy: a link that is invisible until
 * it has focus (dock.css § skip to modes) and hands focus to the mode switch.
 *
 * Normal activation lands on the checked radio, or the first when the open
 * mode lives under More. The first radio also gets a fragment id, so native
 * link activation has a real destination instead of the document's top.
 *
 * **Selected by the class and role the bar already carries** rather than a ref
 * through `Dock`'s props: the bar is a separate component with its own owner,
 * and `SKIP_TARGET` is the one place this selector is written. The bar is
 * always mounted in the reading view, signed in or out, wide or narrow; a bar
 * scrolled off a small screen comes back on its own focus
 * (`.dock:focus-within`, narrow-window.css). An explicit skip finishes the
 * entrance for both the bar and its install hint before trying to focus a
 * radio: a hidden destination cannot receive focus.
 *
 * **The hint's half is a lease on `<html>`** (`dock-skip-arrived`,
 * root-flags.ts) rather than `:root:has(.dock[data-skip-arrived])`, which
 * walked the article on every change (plan 261029k). The dock's own marker
 * stays an attribute on `.dock`, written by the click as before; the lease is
 * taken with it and held until this link unmounts, which is when `Reader` —
 * and the Dock it draws, and the marker on it — goes.
 *
 * keyboard.md § Tab, and the surfaces it walks through.
 */
import { type MouseEvent, useLayoutEffect, useRef } from "react";
import { acquireRootFlag, type Release } from "../root-flags.js";

export const SKIP_TARGET = '.dock-modes-radios[role="radiogroup"] [role="radio"]';
const DESTINATION = "reader-mode-switch";

/** Mark the dock as arrived and focus the mode switch. Returns whether a dock was marked. */
function skip(e: MouseEvent<HTMLAnchorElement>): boolean {
  e.preventDefault();
  const radios = [...document.querySelectorAll<HTMLElement>(SKIP_TARGET)];
  const target = radios.find((r) => r.getAttribute("aria-checked") === "true") ?? radios[0];
  const dock = target?.closest(".dock");
  dock?.setAttribute("data-skip-arrived", "");
  target?.focus({ preventScroll: true });
  return dock != null;
}

export function SkipToModes() {
  const arrived = useRef<Release | null>(null);
  /* Layout cleanup, not passive cleanup: the root flag stands in for
     `.dock[data-skip-arrived]`, so it must disappear in the same pre-paint
     commit as the Dock and its own marker. */
  useLayoutEffect(
    () => () => {
      arrived.current?.();
      arrived.current = null;
    },
    [],
  );
  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(SKIP_TARGET);
    if (!target) return;
    target.id = DESTINATION;
    return () => {
      if (target.id === DESTINATION) target.removeAttribute("id");
    };
  }, []);

  return (
    <a
      className="skip-to-modes"
      href={`#${DESTINATION}`}
      onClick={(e) => {
        if (skip(e) && arrived.current === null) arrived.current = acquireRootFlag("dock-skip-arrived");
      }}
    >
      Skip to modes
    </a>
  );
}
