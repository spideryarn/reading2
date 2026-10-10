/**
 * **Reveal, then commit, for one control with a card** — the rule in
 * docs/project/touch.md: a finger's first tap opens the card (and the card
 * says "Tap again to do it."), the second tap acts; a mouse click acts at once.
 *
 * Written for Bibliography's two paid buttons, *Look it up* and *Investigate*,
 * where one tap on a phone both opened the card and spent the money (plan
 * 260930a § Review log, Browser check). It mirrors the shelf row's shape
 * (ShelfEntry.tsx § `armed` / `ActionTip`: an `armed` state with `byTouch`,
 * a controlled tooltip, and only a card a finger opened taken down on commit)
 * but not its moment of decision. The shelf reads `pointerType` off the
 * *click*, which on iOS 18.2 and later says `mouse` for a finger (WebKit bug
 * 282988), so its reveal never ran on an iPad. This records the press at its
 * `pointerdown`, which iOS reports correctly, and decides at the click — the
 * fix the spine got (Spine.tsx § `bandClick`, plan 260924c), and touch.md's
 * rule for any new tap rule. ShelfEntry is left alone: a finger no longer
 * meets that row (plan 260915b), and sharing this would change a pen's
 * behaviour there for no reader's benefit.
 *
 * One control per hook, not one hook per row as the shelf has: the two
 * buttons live in different components, and a card each is all they need.
 */
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** How long a press recorded at `pointerdown` may wait for its click (Spine.tsx § PRESS_MS). */
const PRESS_MS = 2_000;

export const TAP_AGAIN = "Tap again to do it.";

interface Press {
  finger: boolean;
  /** Whether the card was open when this press began — only that may commit a finger. */
  wasOpen: boolean;
  at: number;
}

export interface TapReveal {
  /** The tooltip's controlled open state. */
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The card's `tap` line: only when a finger opened it and a second tap would act. */
  tap: string | undefined;
  /** Spread on the trigger: records what made each press. */
  onPointerDown(e: ReactPointerEvent): void;
  onPointerCancel(): void;
  /**
   * Call first in the trigger's click handler. `true`: act. `false`: the card
   * was revealed instead, and the click did nothing else.
   */
  commit(e: ReactMouseEvent): boolean;
}

/** A keyboard's, voice's or script's click — no pointer made it (Spine.tsx § isKeyboardClick). */
function isKeyboardClick(click: string | undefined, detail: number): boolean {
  return click === "" || (click === undefined && detail < 1);
}

/**
 * @param commits Whether a second tap would actually do anything. False for a
 *   control held closed, and then the card says nothing about tapping again
 *   (ShelfEntry.tsx § ActionTip `commits`).
 */
export function useTapReveal(commits: boolean): TapReveal {
  const [armed, setArmed] = useState<{ byTouch: boolean } | null>(null);
  const press = useRef<Press | null>(null);
  const open = armed !== null;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      /* `pen` as well as `touch`: touch.md § An Apple Pencil counts as a finger. */
      press.current = {
        finger: e.pointerType === "touch" || e.pointerType === "pen",
        wasOpen: open,
        at: e.timeStamp,
      };
    },
    [open],
  );

  /**
   * **A card a finger opened does not survive a scroll** — touch.md's rule for
   * the spine and the glossary. A finger is not resting on the control, so the
   * card would ride with it to the edge of its scroller and stay there.
   * Capture on `document`, because a scroll does not bubble and the control
   * may be inside a panel with a scroller of its own (Structure's band). Only
   * while such a card is open, so nobody else pays for it. Plan 261003c.
   */
  const byTouch = armed?.byTouch ?? false;
  useEffect(() => {
    if (!byTouch) return;
    const close = () => {
      /* The press too: one begun with the card open and scrolled before its
         click would otherwise commit blind. GPT Sol, plan review of 261003c. */
      press.current = null;
      setArmed((prev) => (prev?.byTouch ? null : prev));
    };
    document.addEventListener("scroll", close, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", close, { capture: true });
  }, [byTouch]);

  const onPointerCancel = useCallback(() => {
    press.current = null;
  }, []);

  const commit = useCallback((e: ReactMouseEvent): boolean => {
    const native = e.nativeEvent as Partial<PointerEvent>;
    const click = native.pointerType;
    const p = press.current;
    press.current = null;
    if (isKeyboardClick(click, e.detail)) {
      setArmed((prev) => (prev?.byTouch ? null : prev));
      return true;
    }
    const fresh = p !== null && e.timeStamp - p.at <= PRESS_MS ? p : null;
    /* No record: a pointer's click whose press this button never saw (a finger
       moved onto it by touch adjustment, or a press the browser cancelled).
       It may reveal, never act — nothing of its own saw the card open. A mouse
       always leaves a record, since its `pointerdown` lands here. Spine.tsx §
       bandClick, GPT Sol's rule there. */
    const reveal = fresh === null ? true : fresh.finger && !fresh.wasOpen;
    if (reveal) {
      setArmed({ byTouch: true });
      return false;
    }
    /* Only a card a finger opened is taken down on commit — a mouse's
       hover-opened card stays while the pointer is still on the button
       (ShelfEntry.tsx § pressCapture). */
    setArmed((prev) => (prev?.byTouch ? null : prev));
    return true;
  }, []);

  return {
    open,
    onOpenChange: (v) => setArmed((prev) => (v ? (prev ?? { byTouch: false }) : null)),
    tap: commits && armed?.byTouch ? TAP_AGAIN : undefined,
    onPointerDown,
    onPointerCancel,
    commit,
  };
}
