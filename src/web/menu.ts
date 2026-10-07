/**
 * **What the app's two Radix `DropdownMenu`s share**: how the list looks, and
 * how a finger opens it. The shelf's "⋯" (`ShelfEntry.tsx` § `ShelfActionsMenu`)
 * had both to itself until 2026-10-07, when the bottom bar's More button became
 * the second menu (`Dock.tsx` § `DockMore`, plan 261007c). They live here so
 * the second is not a copy that drifts.
 */
import { type PointerEvent, type MouseEvent, useRef } from "react";

/**
 * The list's surface: the tooltip card's (styles/tooltip.css § .tooltip) in its
 * tokens — raised, opaque, the strong rule, the same shadow — because this is
 * the same kind of thing, drawn over the page. `z-[100]` for the reason
 * `.tooltip-anchor` gives: frontmost, the bar (96) and its drawer included.
 * Radix copies the content's z-index onto the wrapper it positions.
 *
 * Width is the caller's: the two menus hold different things.
 */
export const MENU_SURFACE =
  "tw:z-[100] tw:rounded-[5px] tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-1 tw:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_8px_24px_-6px_rgb(0_0_0/0.65)]";

/**
 * One menu item's look: finger-sized, and quiet until it is the one in focus.
 *
 * `min-h-10` — 40px, the house number for a thumb
 * (docs/project/narrow-windows.md § What a control owes a finger).
 * `data-highlighted` and `data-disabled` are the attributes Radix writes, so
 * the item needs no state of its own to know either.
 */
export const MENU_ITEM =
  "tw:flex tw:min-h-10 tw:cursor-default tw:select-none tw:items-center tw:gap-2.5 tw:rounded-[3px] tw:px-2.5 tw:py-1.5 tw:text-sm tw:leading-snug tw:text-foreground tw:no-underline tw:outline-none tw:data-highlighted:bg-highlight/10 tw:data-disabled:text-muted-foreground";

/**
 * **A finger opens the menu at the click, not at the press** — three handlers
 * for a `DropdownMenu.Trigger` whose `open` state the caller controls.
 *
 * Radix's trigger toggles on `pointerdown` for every pointer type, which is
 * right for a mouse and wrong for a finger: a finger that lands on the trigger
 * at the start of a scroll — of the shelf, or of the bottom bar, which scrolls
 * sideways on a phone — would open the menu, and a tap would draw the list
 * under the finger before it lifts. So a finger's press is taken at the click,
 * which is the browser's own verdict that this was a tap and not a scroll.
 *
 * **Decided at `pointerdown`, never read off the click**, because on iOS 18.2
 * and later a finger's click reports `pointerType` `mouse` (WebKit bug 282988)
 * while its `pointerdown` says `touch`. That bug is what stopped
 * `pressCapture` working on an iPad (ShelfEntry.tsx); this is the shape of the
 * fix.
 *
 * The starting state matters on a second tap. The trigger is outside the
 * portalled menu, so Radix's modal dismissal can close the menu during that
 * `pointerdown`; blindly toggling the latest state at `click` would then open
 * it again. Remembering `wasOpen` makes the click finish the transition the
 * finger began: closed to open, or open to closed.
 *
 * **One gesture's lifetime**, GPT Sol's plan review of 260915b: cleared by
 * `pointercancel` (the browser took the press for a scroll), consumed by the
 * click that reads it, and ignored by a keyboard's click — `detail === 0` —
 * because Enter and Space have already toggled the menu through Radix's own
 * key handler, and a "finger" left over from an earlier scroll must not toggle
 * it shut again. tests/shelf-actions-menu.test.tsx has a case for each.
 */
export function useFingerPressMenu(
  open: boolean,
  setOpen: (open: boolean) => void,
): {
  onPointerDown(e: PointerEvent): void;
  onPointerCancel(): void;
  onClick(e: MouseEvent): void;
} {
  const fingerPress = useRef<{ wasOpen: boolean } | null>(null);
  return {
    onPointerDown(e) {
      const finger = e.pointerType === "touch" || e.pointerType === "pen";
      fingerPress.current = finger ? { wasOpen: open } : null;
      /* `preventDefault` is what makes Radix stand aside: its
         `composeEventHandlers` runs ours first and skips its own toggle when
         the event comes back prevented (@radix-ui/primitive 1.1.7). It does
         not suppress the click that follows — the Pointer Events spec keeps
         the two apart — and that click is where we open. */
      if (finger) e.preventDefault();
    },
    onPointerCancel() {
      fingerPress.current = null;
    },
    onClick(e) {
      const press = fingerPress.current;
      fingerPress.current = null;
      if (press && e.detail !== 0) setOpen(!press.wasOpen);
    },
  };
}
