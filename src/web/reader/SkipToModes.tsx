/**
 * **"Skip to modes" — the reading view's first Tab stop** (plan 261007h §
 * F5b). Before it, a keyboard reader passed every spine sliver and four
 * buttons a paragraph to reach the dock's mode switcher; ⌘-K and `/` were the
 * only ways round. This is the standard remedy: a link that is invisible until
 * it has focus (dock.css § skip to modes) and hands focus to the mode switch.
 *
 * **An onClick, not a fragment link.** The switch is a `div` radiogroup with no
 * id and no tab stop of its own, and every radio in it is a tab stop
 * (Dock.tsx § the radiogroup), so the place to land is one radio: the checked
 * one, or the first when the open mode lives under More and none is checked.
 *
 * **Selected by the class and role the bar already carries** rather than a ref
 * through `Dock`'s props: the bar is a separate component with its own owner,
 * and `SKIP_TARGET` is the one place this selector is written. The bar is
 * always mounted in the reading view, signed in or out, wide or narrow; a bar
 * scrolled off a small screen comes back on its own focus
 * (`.dock:focus-within`, narrow-window.css). Pressed during the bar's
 * one-second entrance, when it is still `visibility: hidden`, focus does not
 * move — nothing breaks, and a second press works.
 *
 * keyboard.md § Tab, and the surfaces it walks through.
 */
import type { MouseEvent } from "react";

export const SKIP_TARGET = '.dock-modes-radios[role="radiogroup"] [role="radio"]';

function skip(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  const radios = [...document.querySelectorAll<HTMLElement>(SKIP_TARGET)];
  const target = radios.find((r) => r.getAttribute("aria-checked") === "true") ?? radios[0];
  target?.focus();
}

export function SkipToModes() {
  return (
    // biome-ignore lint/a11y/useValidAnchor: a skip link is a link by convention (it is what a screen-reader user's links list offers), and its target, a radio in the dock, has no id to put in the href — so the onClick does the moving
    <a className="skip-to-modes" href="#" onClick={skip}>
      Skip to modes
    </a>
  );
}
