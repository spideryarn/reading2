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
 * keyboard.md § Tab, and the surfaces it walks through.
 */
import { type MouseEvent, useLayoutEffect } from "react";

export const SKIP_TARGET = '.dock-modes-radios[role="radiogroup"] [role="radio"]';
const DESTINATION = "reader-mode-switch";

function skip(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  const radios = [...document.querySelectorAll<HTMLElement>(SKIP_TARGET)];
  const target = radios.find((r) => r.getAttribute("aria-checked") === "true") ?? radios[0];
  target?.closest(".dock")?.setAttribute("data-skip-arrived", "");
  target?.focus({ preventScroll: true });
}

export function SkipToModes() {
  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(SKIP_TARGET);
    if (!target) return;
    target.id = DESTINATION;
    return () => {
      if (target.id === DESTINATION) target.removeAttribute("id");
    };
  }, []);

  return (
    <a className="skip-to-modes" href={`#${DESTINATION}`} onClick={skip}>
      Skip to modes
    </a>
  );
}
