/**
 * **Reaching a mode the way a reader does, now that five of them are under
 * More** (plan 261007c).
 *
 * Until 2026-10-07 every mode was a `[role="radio"]` in `.dock-modes`, so a
 * test that looped over the radios had pressed every mode. Quotes, Glossary,
 * FAQ, Ideas and Timeline are items of a portalled Radix menu now, and such a
 * loop stays green while visiting none of them (GPT Sol, PR-10). A sweep goes
 * through `reachableModeLabels` and `pressModeByLabel` instead, and asserts
 * the **set** it visited.
 */
import { act } from "react";
import { flushSync } from "react-dom";

/** The More button, or `null` where the bar draws none. */
export function moreTrigger(root: ParentNode = document): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(".dock-more-trigger");
}

/** The open menu. Portalled to `document.body`, so never under the test's host. */
export function moreMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.dock-more-menu[role="menu"]');
}

export function moreItems(): HTMLElement[] {
  return [...(moreMenu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
}

/** What an item is called: its `data-mode-label`, which no second line of words can blur. */
export function itemLabel(item: Element): string {
  return item.getAttribute("data-mode-label") ?? "";
}

/**
 * Open More as a mouse does. Radix's trigger opens on `pointerdown`, not on
 * `click`, and jsdom has no `PointerEvent` — a `MouseEvent` of that type is
 * what tests/shelf-actions-menu.test.tsx uses for the same menu.
 */
export function openMore(root: ParentNode = document): HTMLElement {
  if (moreMenu() !== null) return moreMenu() as HTMLElement;
  const trigger = moreTrigger(root);
  if (trigger === null) throw new Error("the bar draws no More button");
  const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(down, "pointerType", { value: "mouse" });
  /* `flushSync` as well as `act`: several suites call this from inside an
     `act` of their own (`await act(async () => modeButton(m).click())`), and a
     nested `act` leaves the update queued until the outer one exits — so the
     menu would not be there to pick from. */
  act(() => {
    flushSync(() => {
      trigger.dispatchEvent(down);
    });
  });
  const menu = moreMenu();
  if (menu === null) throw new Error("pressing More opened no menu");
  return menu;
}

export function closeMore(): void {
  const menu = moreMenu();
  if (menu === null) return;
  act(() => {
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
}

/** The labels under More, in the menu's order. Leaves the menu shut. */
export function moreLabels(root: ParentNode = document): string[] {
  if (moreTrigger(root) === null) return [];
  openMore(root);
  const labels = moreItems().map(itemLabel);
  closeMore();
  return labels;
}

/**
 * Every mode this bar offers, by label: the radios, Marginalia's toggle, and
 * what is under More. A mode that is open *and* gathered is drawn in both
 * places and listed once.
 */
export function reachableModeLabels(root: ParentNode): string[] {
  const drawn = [
    ...root.querySelectorAll<HTMLElement>(
      '.dock-modes [role="radio"], .dock-modes [aria-pressed], .dock-modes a.dock-btn',
    ),
  ].map((el) => el.getAttribute("aria-label") ?? "");
  return [...new Set([...drawn, ...moreLabels(root)])];
}

/**
 * **The thing a reader presses to open the mode called `label`**: its bar
 * button where the bar draws one (a radio, or Marginalia's toggle), else its
 * item under More — in which case More is opened to find it and **left open**,
 * so the caller's `.click()` lands on a live item. `undefined` where the bar
 * offers the mode in neither place.
 *
 * For the many suites whose `modeButton(label).click()` was written when every
 * mode had a bar button. A gathered mode that is already open is drawn in the
 * bar, so a second press still finds the button that closes it.
 */
export function modeDoor(root: ParentNode, label: string): HTMLElement | undefined {
  const button = [
    ...root.querySelectorAll<HTMLElement>('.dock-modes [role="radio"], .dock-modes [aria-pressed]'),
  ].find((el) => el.getAttribute("aria-label") === label);
  if (button) return button;
  if (moreTrigger(root) === null) return undefined;
  openMore(root);
  const item = moreItems().find((el) => itemLabel(el) === label);
  if (!item) closeMore();
  return item;
}

/**
 * Press the mode called `label`: its bar button where it has one, else its
 * item under More. Says which door it used, and throws rather than skipping —
 * a sweep that could not reach a mode has not tested it.
 */
export function pressModeByLabel(root: ParentNode, label: string): "bar" | "more" {
  const button = [
    ...root.querySelectorAll<HTMLElement>('.dock-modes [role="radio"], .dock-modes [aria-pressed]'),
  ].find((el) => el.getAttribute("aria-label") === label);
  if (button) {
    act(() => button.click());
    return "bar";
  }
  openMore(root);
  const item = moreItems().find((el) => itemLabel(el) === label);
  if (!item) {
    closeMore();
    throw new Error(`no bar button and no More item called ${label}`);
  }
  act(() => item.click());
  return "more";
}
